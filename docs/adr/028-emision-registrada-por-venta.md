# ADR-028: La emisión se registra por venta — una tabla de documentos, el emisor sale del medio de pago y de lo que declara el comercio

**Status**: Accepted

**Date**: 2026-10-02

## Context

Hasta ahora una venta tenía una **etiqueta**, no un documento: `ventas.tipo_documento_id`, que el
servidor copiaba del body sin validar. No decía quién había emitido nada. Y en la práctica el
documento tributario de un local no lo hace siempre el sistema: la máquina de tarjeta emite su
voucher (que algunos locales usan como boleta), el comercio puede facturar en otro software, y hay
medios (una transferencia, un vale) que el dueño decide no documentar. El sistema llevaba bien la
venta y la plata, y lo tributario quedaba sin registro.

La spec [`2026-10-01-emision-por-venta-design.md`](../superpowers/specs/2026-10-01-emision-por-venta-design.md)
fija las reglas de negocio (decididas por el owner) y el diseño. Este ADR recoge **la decisión
estructural** y su porqué; la spec es la autoridad de las reglas, y este frente es fiscal, así
que va solo (`CLAUDE.md`, ADR-010).

## Decision

**Cada venta registra, dentro de la transacción que la crea, qué documentos tiene y quién emitió
cada uno.** Es una tabla nueva, `venta_documentos`, con una fila por documento, que
`VentaDocumentosService.documentarVenta` escribe al final de `crearEnTransaccion` (el único
lugar por el que pasan POS, salones, online y suscripción).

### El emisor lo declara el comercio; el servidor lo resuelve

- **Por medio de pago** (`tenant_metodo_pago.emisor`): `'sistema'` (arma la boleta), `'maquina'`
  (la emite el POS de tarjeta) o `'nadie'` (queda sin documento y la responsabilidad es del
  comercio). Va en `tenant_metodo_pago` y no en `metodos_pago`, porque el catálogo es global y
  la regla sería la misma para todos los comercios (E4). Un comercio nuevo trae `'sistema'` en
  todos: es el error barato, se corrige con una NC (E3).
- **Por comercio** (`tenants.facturador`, `'sistema' | 'externo'`): quién hace las facturas
  **y lo que queda debiendo**. Si es `'externo'` (el facturador gratuito del SII, su software
  contable), la venta queda con un documento hecho por fuera y su número, como el voucher de la
  máquina (E2, E9). La regla de cada medio decide solo las boletas de lo **pagado**.
- **El cliente nunca manda quién emitió ni qué documento corrige.** Manda qué pasó: con qué
  medio pagó y el número que tipeó (`PagoVentaDto.numeroDocumento` / `claseDocumento`, opcionales
  y ignorados en un medio que no es de la máquina). Un campo de más en el body es un 400.
- **El `canal` guardado decide lo online.** El cliente declara *dónde* ocurrió la venta y el
  servidor deriva *quién* emite, igual que hoy el canal elige la caja virtual. Costo si está
  mal: un cajero que marca como online una venta física recibe la boleta del sistema; el
  arreglo sería validar el canal, y queda fuera de este frente.

### Qué documentos deja una venta (spec § 3.3)

En este orden: una venta de **$0 no lleva documento** (E6: el mínimo de la boleta es $1, Res. Ex.
SII N°60/2023); una venta **sin tipo de documento** (un país sin boleta sembrada: AR, CO, MX) no
cambia y **no lleva ningún documento, ni del sistema ni de la máquina ni `nadie`**: el voucher
que vale como boleta y el "nadie" son semántica chilena, y el frente fiscal de esos países es
otro, así que un documento `sistema` sin tipo no significaría nada (spec § 3.3 y § 6); la
**venta online** la documenta el sistema, sin mirar la regla del medio (E5: en lo online no hay
máquina, y "crédito → la máquina" la dejaría sin documento). Es un pago anterior a la entrega, y
documentarlo antes es válido: un anticipo no obliga a emitir boleta ni factura, pero si igual se
emite el IVA se devenga por ese monto y no corresponde nota de crédito (Oficio SII N° 3.008 del
4-nov-2016); el momento del **envío** lo decide el frente de la emisión. Una
**factura** lleva un documento por el total, se pague o no, del sistema o `externo` (E2); y una
**boleta** se parte por los pagos: un documento por cada pago `maquina` (con su `pago_id`), una
fila `nadie` por la suma de los de `nadie`, una boleta del sistema por los de `sistema`, y **lo no
pagado** según el facturador. La suma de los documentos que no son duplicados es el `total_final`.

### Por qué el documento nace con la entrega

**Lo entregado se documenta al entregarlo, se haya pagado o no** (E1). Un restaurante vende en
el momento en que sirve (Res. Ex. SII 58/2003) y una tienda documenta al entregar (art. 55 del DL
825). Una mesa de $100.000 que paga $40.000 con tarjeta y se va debiendo $60.000 queda, al
cerrar, con el voucher por $40.000 y una boleta del sistema por $60.000; **el pago posterior de
esa deuda no genera documento**. En POS y salones crear la venta *es* la entrega: no hay un paso
de entrega aparte, así que `documentarVenta` corre una sola vez, al crearla. Esto reemplaza a
"lo no pagado se documenta al pagarlo", que contradecía la ley.

La única excepción es el **voucher duplicado** (E1b): una deuda ya documentada que se paga con
tarjeta de la máquina. El voucher también vale como boleta y duplica la del sistema, y el SII no
lo resuelve por escrito; el cobro no se bloquea, el pago queda marcado (`es_duplicado`) para que
el contador lo corrija, y ese documento no cuenta para la cobertura ni para los topes de una
corrección. Lo escribe `registrarDuplicadoDeAbono`, que `registrarAbono` llama **una vez, con todos los
pagos del abono**, y que escribe un duplicado por cada pago cuyo medio es `maquina` y solo si la venta tiene algún documento vigente que no sea duplicado
(una venta de $0 o de un país sin boleta no tiene nada que duplicar). Ese "¿ya está documentada?"
es un predicado único, `VentaDocumentosService.ventaDocumentada` (vigente, no duplicado y con
emisor distinto de `nadie`): lo comparte el abono con el `abonoConMaquinaDuplica` del detalle,
para que el aviso de la pantalla y lo que el abono después escribe no puedan desalinearse.

### La tabla, y lo que decide su forma

- **Los baldes congelados** (`monto_afecto`, `monto_exento`, `monto_impuestos`) los llevan los
  documentos del sistema y los externos. Si el documento cubre la venta entera son los de la
  venta; si cubre una parte, se reparten a prorrata de las porciones afecta y exenta con el
  mismo reparto y el mismo cuantizador que la NC por monto
  (`componerBaldes`, sobre `repartirAjuste`/`tasaEfectiva`/`descomponer`, sin modificarlas). Un
  solo camino, sin rama para "cubre todo". Medido en la tarea 1 sobre 20.000 ventas simuladas en CLP, partidas en 2 o 3
  documentos (plan `docs/superpowers/plans/2026-10-01-emision-por-venta.md`, sección "Medido en
  la tarea 1" § 3; generador propio, solo CLP y `nivelRedondeo = 'linea'`, no medido con
  `'documento'`): la identidad `afecto + exento + impuestos = monto` no se rompe en ninguno de
  los 49.606 documentos, y la suma de los documentos de una venta difiere de los baldes de la
  venta en 4.039 de las 20.000 (20,2 %), con un máximo de 2 minor units en el neto y 1 en el
  impuesto. El test unitario del servicio fija un caso concreto con diferencia distinta de cero y la cota sobre
  todas las particiones en dos documentos.
- **`monto_impuestos` es una columna**: la suma de todos los impuestos del documento. Es lo que
  congelan `ventas.total_impuestos` y `venta_detalles.impuesto_aplicado`, y la NC compone con una
  tasa efectiva por porción, nunca por impuesto. ADR-010 nombra cuatro baldes (`neto afecto /
  exento / IVA / adicionales`); la venta no congela IVA y adicionales por separado en ninguna
  columna, así que si el emisor del SII los necesita por documento, **se derivan de
  `ventas_impuestos` a prorrata**: no están congelados en el documento.
- **Folio ≠ PK** (ADR-010): el folio del sistema no existe y no se inventa. `numero` es un dato
  externo —el de la máquina o el del otro facturador— y nace nulo hasta que se tipea.
- **`estado_envio`** es `'armado'` para el sistema; `'enviado'` queda reservado a la emisión.
- **Una corrección se reconoce por `venta_referencia_id`**, no por el tipo de documento (E7): la
  devolución interna no es un documento tributario y no lleva el tipo NC. La tabla guarda
  `documento_corregido_id` para qué documento corrige cada una; lo escribe
  `VentaDocumentosService.documentarCorreccion`, y qué documento corrige lo decide **por dónde
  vuelve la plata** (`documentoQueCorrige`; detalle y topes en
  [reembolsos-nota-credito.md](../features/reembolsos-nota-credito.md#una-corrección-lleva-su-documento-según-por-dónde-vuelve-la-plata-2026-10-02)).
  **Cada pago apunta al documento que lo cubre** (`pagos.documento_id`, escrito en la misma
  transacción: al cobrar, su voucher o la boleta / factura / fila `nadie` del cierre; al abonar, el
  documento de la deuda —el hecho por fuera si lo hay, si no el del sistema—, nunca el voucher
  duplicado), y `documentoQueCorrige` lo lee en vez de inferirlo. Se enlaza porque el emisor de un
  medio puede cambiar entre la venta y el reembolso: inferirlo del medio de hoy movía el pago a otro
  documento. Un pago sin documento (venta de $0, país sin boleta, o que fue todo propina) queda en
  `NULL`. Cada cobro y cada abono escriben todos sus enlaces con **un** `UPDATE`.
  **Cada corrección registra por dónde volvió la plata** (`ventas.devolucion_via`: `'pago'`,
  `'sin_plata'` o `'pasarela'`, y `devolucion_pago_id` con el pago): es la auditoría de ese dato
  y lo que hace de "no vuelve plata" una **serie** —el saldo que queda por rebajar descuenta
  lo ya rebajado sin plata—; las que volvieron por un pago devolvieron plata por fuera y no lo
  tocan.
- **El descarte** (`descarte`, `descartado_el`, `descartado_por_usuario_id`) deja registro al
  anular, sin borrar nada. Una boleta del sistema **solo armada, sin enviar al SII, no cuenta
  como emitida**: la venta se anula y esa boleta queda `'armado_sin_enviar'` (E8). Un documento
  hecho por fuera **se pregunta** al anular, "¿ya hiciste esta factura en tu facturador?"
  (E10): si sí, va por NC hecha por fuera; si no, se anula y queda `'afirmado_no_hecho'` con
  quién lo afirmó y cuándo, que es el único registro de esa afirmación. Se descartaron "impide
  solo si tiene número" y "nunca se anula". Las dos reglas viven en un solo lugar,
  `VentaDocumentosService.evaluarAnulacion` (devuelve `anulable` con los descartes, `bloqueada`
  con su motivo, o `pregunta_externo`), y `descartarAlAnular` las aplica dentro de la transacción
  de `cancelarUnaVez`, después del lock de la venta. Solo cuentan los documentos vigentes
  (`descarte IS NULL`): una `maquina` o un `sistema` `enviado` bloquean, y un `externo` con
  número bloquea sin preguntar (el número salió del otro facturador, así que el documento
  existe). `externoHecho` ausente y `false` son dos conductas distintas, por eso el DTO y el
  controller no le ponen default. Lo previo a mirar los documentos —que la venta esté
  `pendiente`, sin pagos y sin ninguna nota de crédito (tarea 15)— también es una sola regla (`motivoQueImpideAnular`, en ventas), y
  `cancelarUnaVez` y el `anulable` del detalle llaman a las dos.
- Las columnas cerradas (`emisor`, `clase_maquina`, `estado_envio`, `descarte`) siguen la forma
  de lo nuevo: `@Check` + `type: 'text'` explícito + una unión de TS exportada, no un `enum`
  nativo (cambiar los valores obligaría a `ALTER TYPE`).

### El detalle decide, la pantalla muestra; y el número se completa después

`GET /ventas/:id` devuelve `documentos[]` (los de la venta y los de sus correcciones, en una
consulta) y tres banderas calculadas en el backend con las reglas de arriba, no replicadas en
el cliente: `anulable`, `anularPreguntaExterno` (anulable **y** con un `externo` sin número) y
`abonoConMaquinaDuplica` (admite abonos, tiene saldo —lo aplicado a la venta, sin propina— y la
deuda ya está documentada). Los `JOIN` al tipo de documento y al usuario que descartó **no filtran
borrados**, a propósito: un documento ya emitido conserva su tipo y su historial aunque el
catálogo o la cuenta se hayan borrado después.

El número del voucher o del documento hecho por fuera se completa con
`PATCH /ventas/:id/documentos/:documentoId`. Delega en `VentaDocumentosService.completarNumero`,
que no recibe nada del request (una integración futura con el facturador llama el mismo método) y
solo escribe sobre un documento vigente de la `maquina` o `externo`. El endpoint toma el mismo
`FOR UPDATE` de la venta que la anulación: sin él, anotar el número de un `externo` correría
contra una anulación que lo declara no hecho (E10) y el documento quedaría descartado con número.

### Borrar el número de un documento hecho por fuera, y por qué cada borrado es una fila

Con número, un documento `externo` se da por hecho y anular va por nota de crédito. Un número
anotado por error ("1" en una factura que nunca se hizo) obligaba entonces a una nota de crédito
que nadie debía emitir. El owner decidió (2026-10-02, PRODUCTO § 10) que **quien puede anular
ventas puede borrar ese número**, que queda registrado quién, cuándo y qué decía, y que la venta
vuelve a "sin número": al anular se pregunta otra vez (E10). Es
`POST /ventas/:id/documentos/:documentoId/borrar-numero` (`Ventas:Anular`, mismo alcance de caja y
mismo lock de la venta que el `PATCH`), y un `POST` porque no se borra ninguna fila.

**El registro es una tabla de eventos, `venta_documento_numero_borrados`, con una fila por borrado,
y no tres columnas en `venta_documentos`** (`numero_borrado`, `numero_borrado_el`,
`numero_borrado_por_usuario_id`). Las columnas guardan solo el último borrado, y el caso que importa
es justo el que las pisa: se anota un número, se borra, se anota otro, se borra. Se pierde quién borró
el primero y qué decía, que es lo que el owner pidió conservar y lo que hace reversible la acción.
Sigue el patrón de `garzon_pin_evento` (hechos con hora que se insertan y nunca se editan, `creado_el`
es el momento, sin relaciones declaradas, índice en la entity). Solo se registra el **borrado**: reescribir
un número con el `PATCH` no deja nada, porque el owner pidió el rastro de lo que se borra y no el de cada
edición. El detalle trae los borrados de cada documento en `numerosBorrados`, en una consulta por lote.

### Dónde vive

Un módulo propio, **`VentaDocumentosModule`**, que importan ventas y (desde que el abono escribe
el duplicado) pagos, y que **no importa a ninguno de los dos**. `PagosModule` es dependencia de
`VentasModule`, así que el servicio no puede vivir en ventas; ponerlo en pagos haría de pagos el
dueño de una tabla de ventas. No necesita imports: recibe por parámetro lo que ya está en
memoria al crear la venta (las porciones salen de las líneas, el emisor de cada pago sale de la
misma lectura de `tenant_metodo_pago` que ya hacía `PagosService.registrar`, y `facturador`, de
la consulta de la moneda oficial). **`documentarVenta` no suma lecturas nuevas**, y los documentos
se insertan con un solo `save` del array. El alta de la venta, en cambio, sí suma una:
`resolverTipoDocumento` (el tipo pedido y la boleta activa del país, en una sola consulta).

## Consequences

**Positivo**

- Cada venta deja dicho qué documentos tiene, quién los emitió y con qué montos y baldes, sin que
  el cliente pueda inventarlo. Es el insumo que el emisor futuro lee sin recalcular.
- El sistema puede decir "esta venta ya tiene una boleta de la máquina" o "este documento lo hizo
  el comercio por fuera", que es lo que hace falta para anular y corregir sin pisar a nadie.
- El comercio elige su forma de trabajar sin que el código ramifique por cliente: son dos
  declaraciones, por medio y por comercio.

**Negativo**

- Una tabla más que escribir en cada venta, dentro de su transacción.
- **Solo los documentos `sistema` y `externo` llevan baldes; los de `maquina` y `nadie` no
  llevan ninguno, por diseño.** Por eso la suma de los baldes de los documentos de una venta es
  **menor** que los baldes de la venta, por porciones enteras, siempre que exista un voucher o
  una parte `nadie`: lo que cubre la máquina no está en ningún balde. Y entre los documentos
  `sistema` y `externo`, cada uno se cuantiza por su cuenta, lo que deja un **residuo pequeño**
  (unas pocas minor units; el caso concreto está fijado en `venta-documentos.service.spec.ts`). Es la misma clase de
  residuo que el de una serie de NC, que ADR-010 deja como decisión del owner: lo que baja en un
  balde sube en el otro, y cada documento cierra exacto a su `monto`.
- El `canal` que manda el cliente decide quién documenta lo online (ver arriba).
- Un país sin boleta sembrada queda con ventas sin documento hasta el frente fiscal de ese país.

**Neutral**

- No se integra el envío al SII ni se emite folio: sigue diferido (ADR-010). Esto solo registra.

Ver [ADR-010](./010-preparacion-sii-datos-fiscales.md), la spec del frente y
[`features/ventas.md`](../features/ventas.md).
