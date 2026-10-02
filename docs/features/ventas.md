# Feature: Procesamiento de ventas (transaccional)

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-01

---

## Overview

### What is it?

Endpoint transaccional que registra una venta completa en una sola operación atómica: cabecera + líneas + reglas aplicadas (descuentos/recargos/impuestos) + datos del cliente + pagos, con descuento automático de stock. Canal **físico** únicamente en esta versión.

### Why does it exist?

Es el corazón del POS: sin él no hay ventas registradas. Concentra en una sola transacción de base de datos todas las tablas involucradas para garantizar consistencia.

### Scope

- **In scope**: canal `fisico`, pagos inline con auto-estado (`pagada`/`pendiente`), cálculo de vuelto, movimientos de inventario y caja dentro de la transacción, historial en `/ventas`, POS en `/ventas/pos`.
- **Out of scope**: canal `online`/caja virtual, notas de crédito.

---

## API Endpoints

### GET /api/tipos-documento

Lista los tipos de documento tributarios **activos** del país del tenant, ordenados por nombre.

```
GET /api/tipos-documento
Authorization: Bearer <token-con-tenant_id>

Response (200):
[
  {
    "id": "uuid",
    "nombre": "Boleta de Venta",
    "codigo": "39",
    "customerRequerido": false,
    "esBoleta": true
  },
  {
    "id": "uuid",
    "nombre": "Factura Electrónica",
    "codigo": "33",
    "customerRequerido": true,
    "esBoleta": false
  }
]
```

Usada en el frontend para renderizar el selector de documento y aplicar fricción (cliente obligatorio en Factura, opcional en Boleta).

**El documento por defecto de las pantallas es el marcado `esBoleta`, nunca el primero de la lista**
(`tipoDocumentoPorDefecto`, `useVenta.ts`): el orden es por nombre y la boleta no tiene por qué
salir primera. Si el país no tiene boleta (AR/CO/MX hoy), la pantalla no elige ninguno: es lo
mismo que hace el servidor cuando la venta no trae tipo (`resolverTipoDocumento`).

### POST /api/ventas

Crea una venta completa.

```
POST /api/ventas
Authorization: Bearer <token-con-tenant_id>
Idempotency-Key: <uuid por intento de cobro>

Request:
{
  "tipoDocumentoId": "uuid",                    // opcional: sin él, la boleta del país
  "lineas": [
    {
      "itemId": "uuid",
      "cantidad": "1",
      "personalizacion": { ... },               // opcional (recetas y combos)
      "descuentoIds": ["uuid"],                 // opcional
      "recargoIds":   ["uuid"],                 // opcional
      "impuestoIds":  ["uuid"],                 // opcional
      "unidadIds":    ["uuid"],                 // modo serie
      "loteId":       "uuid"                    // modo lote
    }
  ],
  "pagos": [
    { "metodoPagoId": "uuid", "monto": "1069810.0000", "referencia": "opt",
      "numeroDocumento": "opt", "claseDocumento": "voucher | boleta (opt)" }
  ],
  "customer": { "nombre": "Juan Pérez", "rut": "12.345.678-9" },  // opcional
  "comentario": "string",                       // opcional
  "metodoPagoId": "uuid",                       // para el motor de precios (desc/recargos por método)
  "descuentosVentaIds": ["uuid"],               // descuentos a nivel de venta
  "recargosVentaIds":  ["uuid"]
}

Response (201):
{
  "id": "uuid",
  "canal": "fisico",
  "estado": "pagada | pendiente",
  "totalFinal": "1069810.000000",
  ...
}
```

**Errores:**
- `400` — sin caja abierta para el usuario
- `400` — `tipoDocumentoId` de otro país, inexistente, inactivo o la nota de crédito
- `400` — el tipo de la venta es `customer_requerido` (la Factura) y no viene `customer`, o
  viene con el nombre en blanco
- `400` — excedente de pago sin método con `permite_vuelto = true`
- `400` — `metodoPagoId` no habilitado para el tenant (rollback completo)
- `400` — stock insuficiente (rollback completo)
- `400` — falta la cabecera `Idempotency-Key` o no es un UUID
- `422` — la misma `Idempotency-Key` con otros datos (body con `ventaId`)

**El tipo de documento lo decide el servidor** (2026-10-01, spec
[`emision-por-venta`](../superpowers/specs/2026-10-01-emision-por-venta-design.md) § 3.3).
`tipoDocumentoId` ya no se copia a ciegas del body: tiene que ser del **país del tenant**,
estar **activo** y **no** ser la nota de crédito (esa nace de un reembolso); si no, 400 con
el motivo en español. Sin `tipoDocumentoId`, la venta nace con **la boleta del país**
(`tipos_documento_tributario.es_boleta`, sembrada en la Boleta chilena, código 39). Un país sin
boleta sembrada (AR/CO/MX) deja el tipo en `null`, como antes. Una venta **`online`** lleva siempre la
boleta del país y el `tipoDocumentoId` del body ni se mira: el canal que se guarda en la
venta decide. Todo sale de **una sola lectura** por venta (`resolverTipoDocumento`), sin
importar cuántas líneas lleve.

**`customer_requerido` lo exige el servidor** (2026-10-02). Si el tipo **resuelto** lo tiene (la
Factura), la venta sin `customer` —o con el nombre en blanco: la pantalla hace `trim`— es un 400
y no se escribe nada. Hasta esa fecha lo controlaba solo la pantalla, y un `POST` directo creaba
una Factura sin receptor. Se mira el tipo resuelto y no el pedido, así que una venta online con
una Factura en el body sigue naciendo boleta sin pedir nada. El chequeo vive en
`resolverTipoDocumento`, por donde pasan **todos** los caminos que crean una venta desde un
pedido: el POS, el cierre de cuenta de salones (`POST /cuentas/:id/cerrar`, que deja la cuenta
abierta ante el 400), la tienda online y las suscripciones. La nota de crédito no pasa: su tipo lo
fija el sistema y no es `customer_requerido`. Un `customer` que no es un objeto (un array) es 400
del pipe (`@IsObject()`), en los dos DTO. Vale igual con `facturador = 'externo'`, como en la pantalla.
Exige el customer, no su RUT: lo que la Factura necesita del receptor es materia del frente fiscal.

Como toda venta nace con tipo, **el tipo ya no impide anular**: anular mira los documentos emitidos,
ver `POST /ventas/:id/anular`.
La boleta es única por país (`uq_tipo_documento_boleta_pais`, gemelo del índice de la NC).

**Los documentos de la venta (2026-10-02, [ADR-028](../adr/028-emision-registrada-por-venta.md)).**
Al crear la venta, y dentro de su misma transacción, el servidor deja una fila por documento en
`venta_documentos`: quién lo emitió y por cuánto. El cliente **nunca** manda quién emitió: lo
resuelve el servidor con el `emisor` de cada medio de pago (`tenant_metodo_pago.emisor`:
`sistema`, `maquina` o `nadie`) y con `tenants.facturador` (`sistema` o `externo`). Lo que sí
manda el cajero, opcional, es el número y la clase de lo que emitió la máquina
(`numeroDocumento`, máx. 40 y sin caracteres de control; `claseDocumento`: `voucher` o `boleta`); en un pago cuyo medio no
es de la máquina se ignoran sin error.

| La venta es… | Documentos que deja |
|---|---|
| de **$0** | ninguno (el mínimo de la boleta es $1) |
| de un país **sin boleta sembrada** (sin tipo) | ninguno: no cambia |
| **online** | uno del sistema por el total, sin mirar el medio |
| **factura** | uno por el **total**, se pague o no: del sistema, o `externo` con el tipo factura y sin número si el comercio factura por fuera |
| **boleta** | uno por cada pago de la `maquina` (con su pago, número y clase si vinieron); una fila `nadie` por la suma de los pagos en `nadie`; una boleta del sistema por los pagos `sistema` más lo **no pagado** (o, con `facturador = externo`, lo no pagado va en un `externo` con el tipo boleta y sin número) |

El monto de cada documento es lo **aplicado a la venta**: sin propina ni vuelto. Lo entregado se
documenta al entregarlo, se haya pagado o no (la mesa que paga $40.000 con tarjeta y debe
$60.000 queda con el voucher por $40.000 y una boleta por $60.000 al cerrar); el pago posterior
de esa deuda no genera documento. La suma de los documentos es el `totalFinal`. Los documentos
del sistema y los `externo` congelan sus baldes (neto afecto, neto exento y la suma de todos los
impuestos), a prorrata de las porciones de la venta cuando cubren solo una parte. Todo sale de
lo que ya está en memoria: sin lecturas nuevas.

**El abono no documenta, salvo el voucher duplicado** (`POST /pagos`, E1 y E1b). Lo que paga ya
estaba documentado al entregar, así que un pago con un medio `sistema` o `nadie` no crea ningún
documento. Un pago con un medio de la `maquina` sí deja anotado un documento `maquina` con
`es_duplicado = true`, su `pago_id` y el número y la clase si el cajero los tipeó: la máquina
imprime un voucher que vale como boleta sobre algo ya documentado, y el contador necesita saber
cuál corregir. Solo se anota si la venta tiene algún documento vigente que no sea duplicado (una
venta de $0 o de un país sin boleta no tiene nada que duplicar; una fila `nadie` no cuenta como
documentada), no cuenta para la cobertura del
total ni para los topes de una corrección, y **nunca rechaza el cobro**.

**Un cobro que se repite no se registra dos veces** (2026-09-19,
[ADR-026](../adr/026-idempotencia-de-cobros.md)). La cabecera `Idempotency-Key` es
obligatoria y la genera el cliente **por intento de cobro**. Con la misma clave, el reintento
—el cajero que vuelve a confirmar después de un corte— **no crea otra venta**: devuelve la
respuesta del primer intento, boleta incluida, más `repetida: true`, y la pantalla la imprime
con el aviso *"Este cobro ya había entrado"*. Con la misma clave y **otros datos** (cambió
tarjeta por efectivo) responde 422 con el `ventaId` de la venta que sí entró, y la pantalla
ofrece *Ver venta*. Un primer intento rechazado no deja rastro, así que el reintento corregido
corre como nuevo. La clave es por usuario: la de otro no reproduce nada.
El callback de Webpay llama al service sin clave; ya es idempotente por orden (ADR-009).

**Una línea no lleva precio (2026-08-30).** El precio sale de `item.precioBase` —más lo
que agregue la personalización— y lo calcula el servidor. Hasta esa fecha había un
`precioUnitario` opcional y estrictamente positivo (decisión del owner del 2026-08-11: el
`0` era el único camino para dejar una línea sin monto **sin rastro de quién la regaló**).
Se sacó entero: no lo alimentaba ningún cliente —el POS no lo incluye en
`toVentaLineasBody`, la tienda lo evita a propósito y `cerrarCuenta` arma el body en el
servidor— y era el segundo canal por el que un precio podía entrar desde afuera. La venta
gratis legítima sigue existiendo por los dos caminos de siempre: un ítem con
`precio_base` 0, o un descuento, que queda en la traza del cálculo con su regla y su monto.

Un cliente que todavía mande `precioUnitario` recibe un **400 que nombra el campo**: el
`ValidationPipe` global rechaza lo que el DTO no declara (`forbidNonWhitelisted`, desde el
2026-09-27; antes se le ignoraba en silencio y la venta se cobraba al precio de catálogo). Mismo
comportamiento en `POST /api/calculo-precios/calcular`, donde el campo también se fue.
Ver `docs/features/motor-calculo-precios.md` § *El precio de una línea lo calcula el
servidor*.

### POST /api/ventas/:id/anular

Anula una venta — el *void* del dominio, distinto de la devolución. Permiso propio
`Ventas/Anular` (no `Actualizar`: es la operación más sensible del módulo y el mercado la
trata aparte), con el alcance de caja del detalle: una venta ajena es 404 (ver
[Quién ve qué](#quién-ve-qué-el-eje-cajasleer)).

```
POST /api/ventas/{id}/anular
Request: { "motivo": "Ingresada por error", "reponerStock": true, "externoHecho": false }  // externoHecho es opcional
Response (201): { "id": "uuid", "estado": "cancelada", "stockRepuesto": true, "motivo": "..." }
```

**Solo aplica a una venta `pendiente`, sin pagos y sin ninguna corrección vigente, y mira lo emitido, no la etiqueta** (spec
`emision-por-venta` § 3.5, E8 y E10). El `tipo_documento_id` no impide anular: toda venta nace con
la boleta del país. Lo que decide es `venta_documentos`, solo los documentos **vigentes**
(`descarte IS NULL`), leídos y actualizados en la misma transacción y después del lock de la venta
(`lockVentaOriginal`). La regla vive en **un solo lugar**, `VentaDocumentosService.evaluarAnulacion`
(devuelve `anulable` / `bloqueada` con su motivo / `pregunta_externo`). Las preguntas previas
—el estado, los pagos y las correcciones— también viven en un solo lugar (`motivoQueImpideAnular`).
Una venta con una nota de crédito (`venta_referencia_id` apuntando a ella, vigente) no se anula: la
nota "no vuelve plata" parcial la deja `pendiente` y sin pagos, y anularla repondría el stock dos veces
y dejaría una nota viva sobre una venta cancelada (400 *"La venta ya tiene una nota de crédito: lo que
queda se rebaja con otra nota, no se anula."*; owner, 2026-10-02). Es una consulta (`LIMIT 1`), y el
detalle reutiliza las notas que ya cargó. `cancelarUnaVez`
y el `anulable` del detalle (`GET /ventas/:id`, abajo) llaman a las dos, así que la pantalla no
replica la regla:

| Documento vigente | Qué pasa |
|---|---|
| `sistema` en `armado` | No bloquea. Se anula y queda descartado con `armado_sin_enviar` (E8): todavía no salió al SII |
| `sistema` en `enviado` | 400, va por nota de crédito (hoy ninguno: no hay envío) |
| `maquina` | 400, va por nota de crédito: la máquina ya emitió |
| `externo` con número | 400 (*"Ya está hecho: se revierte con una nota de crédito, hecha por fuera y anotada con su número."*), sin preguntar: el número salió del otro facturador, el documento existe |
| `externo` sin número y sin `externoHecho` | 400 (*"Esta venta tiene un documento hecho por fuera: falta decir si ya lo hiciste en tu facturador."*) |
| `externo` sin número, `externoHecho: true` | 400, el mismo "Ya está hecho" |
| `externo` sin número, `externoHecho: false` | Se anula; el `externo` queda descartado con `afirmado_no_hecho`, con el usuario y la hora: es el único registro de quién lo afirmó |
| `nadie` | No bloquea ni se descarta |

El descarte pone `descarte`, `descartado_el = NOW()` y `descartado_por_usuario_id` (el del token)
con **un solo `UPDATE`** y **sin borrar filas**: queda el registro de que existieron. Un bloqueo gana
sobre la pregunta (con una máquina no se pregunta por el externo), y todo ocurre **antes** de
reponer stock, así que un 400 no deja movimientos a medias.

`externoHecho?: boolean` en `CancelarVentaDto`: **ausente y `false` son dos conductas distintas**
(el controller lo pasa tal cual, sin `?? false`). La pregunta de la pantalla sola no alcanza: el
servidor la exige. Todo lo demás —una venta cobrada, ya enviada— se revierte con nota de crédito;
una venta pendiente cuyo documento ya está hecho, con la nota **"No vuelve plata"** (la única que
admite una venta sin pagos: la deuda baja, y en 0 la venta queda `pagada`).

**El detalle de la venta dice cuánto queda por acreditar** (2026-09-04). `GET /ventas/:id`
devuelve `disponibleNotaCredito: { total, porPorcion: [{ clasificacion, monto }] }`, para que la
pantalla muestre el tope **antes** de que el operador tipee en vez de que lo descubra con un 400.
Lo calcula el backend a propósito: el navegador no replica la cuantización del motor.

- `total` es `total_final − Σ notas previas`, que es el tope que la emisión **exige**; no la suma
  de las porciones, que hoy coincide pero no está garantizado.
- `porPorcion` es el remanente de cada porción fiscal, y es lo que decide si una devolución
  entra: la serie de notas no puede acreditar más IVA del que la venta cobró.
- **En cero cuando el documento no admite nota de crédito** — es otra nota de crédito, no está
  pagada, pagada parcial ni pendiente (la pendiente admite solo "no vuelve plata", y por eso el
  detalle le ofrece solo esa opción), no tiene `config_calculo` congelada, o el país del tenant no tiene tipo
  de documento NC. Prometer un monto sobre un documento que la emisión rechaza de plano es el
  mismo error que el campo vino a evitar, al revés.
- ⚠️ Es el tope del **documento**. Con un pago en efectivo hay además un tope del efectivo que **no
  se publica**: exponerlo permitía sondear cuánto había en caja con un solo request rechazado.
- **`opcionesDevolucion`, `esCorreccion` y `esNotaCredito`** (2026-10-02): las opciones de "¿por
  dónde vuelve la plata?" —una por pago que puede recibir la devolución, y "no vuelve plata" solo
  con saldo— las calcula el backend con la **misma** resolución que usa la nota al crearse
  (`VentaDocumentosService.documentoQueCorrige`); una corrección es lo que tiene
  `venta_referencia_id`, y `esNotaCredito` solo si además lleva el tipo NC (la devolución interna
  no). Ver [reembolsos-nota-credito.md](reembolsos-nota-credito.md#una-corrección-lleva-su-documento-según-por-dónde-vuelve-la-plata-2026-10-02).

- `motivo` obligatorio, mínimo 10 caracteres: una anulación sin explicación no sirve como
  auditoría. Queda en `ventas.motivo_cancelacion`, junto con `cancelada_el` y
  `cancelada_por_usuario_id`.
- `reponerStock` (default `true` en la API) devuelve al kardex lo que la venta descontó, con motivo
  **`anulacion`** — distinto de `devolucion`, porque anular una venta mal ingresada y que
  un cliente devuelva mercadería son eventos distintos. En `false` el descuento original
  queda como pérdida (equivalente a la "Anulación no Recuperable" de Toteat).
- **Lo que se devuelve sale del kardex, no de las líneas de la venta** (2026-08-22). La
  regla es "revertir las salidas que esta venta produjo", y quien las conoce es
  `movimientos_inventario`. Tres consecuencias que la lista de líneas no daba:
  una línea de **receta o combo** repone sus ingredientes/componentes (no tiene stock
  propio: antes desaparecía en silencio y la respuesta igual decía que había repuesto);
  un ingrediente **no bloqueante que se vendió sin stock** no vuelve, porque nunca salió;
  y **editar la receta después de vender** no cambia lo que hay que devolver.
- Reponer stock exige que **todo lo que salió** sea `modo_inventario='cantidad'`; serie y
  lote se rechazan con el mismo mensaje que la devolución de una NC (registrarlo a mano
  desde Inventario). Se valida antes de mover nada: no deja media reposición hecha.
- **`stockRepuesto` dice lo que pasó, no lo que se pidió:** una venta que no movió
  inventario (puros servicios) responde `false` aunque `reponerStock` viniera en `true`.
- Reponer toma un `FOR UPDATE` por ítem, así que la anulación ordena por `itemId` con el
  **mismo comparador que la venta** y reintenta ante `40P01`, igual que `crear()`. Dos
  órdenes distintos volverían a hacer posible el cruce que el orden fijo evita.

**Errores:** `400` motivo corto · `400` estado distinto de `pendiente` · `400` con pagos ·
`400` con un documento emitido por la máquina o ya enviado · `400` con un documento hecho por
fuera (sin respuesta, o ya hecho) · `400` reponer stock de serie/lote · `403` sin permiso.

**El default del checkbox de reposición lo decide la cocina, no la API** (decisión del
owner 2026-08-15; caso mixto cerrado el 2026-08-23). En la pantalla, "Reponer el stock que
la venta descontó" nace **destildado** si la venta salió de una cuenta de salón con
**alguna** línea ya enviada a cocina, y explica por qué. La razón es del local, no técnica:
reponer comida que ya se cocinó mete al inventario ingredientes que **físicamente no
existen**, y eso es peor que no reponer.

- Es **un solo checkbox para toda la venta** y basta con que **una** línea se haya
  despachado. Partirlo por línea sería más fino y menos usable: el cajero está anulando la
  venta entera, no reconciliando el inventario plato por plato.
- Es un **default, no un bloqueo**: el cajero lo tilda igual si la mercadería sigue
  vendible (la botella que volvió cerrada).
- La venta de POS, que no viene de ninguna cuenta, sigue naciendo **tildada**.
- El dato lo expone `GET /ventas/:id` como `tieneLineasDespachadas` (ver abajo). El
  **backend no cambia**: sigue haciendo lo que `reponerStock` diga.

Origen de la decisión: `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`.

### GET /api/ventas/resumen

KPIs globales del tenant (no dependen de la página actual del listado). Sin fecha: suma
desde siempre. Respeta "solo mis cajas" como el listado (`filtroDeMisCajas`).

```
GET /api/ventas/resumen
Authorization: Bearer <token-con-tenant_id>

Response (200):
{
  "totalVentas": 42,
  "totalFacturado": "1230000.0000",
  "totalBruto": "1250000.0000",
  "totalNotasCredito": "20000.0000",
  "saldoPendiente": "85000.0000"
}
```

Qué es cada número, y el porqué:

- **Las canceladas no cuentan en ninguno** (owner, 2026-10-01): una mesa anulada no es
  venta, no se factura y no se debe. Antes seguía sumando en los cuatro.
- **`totalVentas`** cuenta ventas, no correcciones: una nota de crédito no es una venta.
- **`totalFacturado` es el neto**: `totalBruto − totalNotasCredito`. Los dos campos
  aparte son lo que la pantalla muestra debajo ("bruto $X · notas de crédito −$Y", solo si
  hay notas). Mismo criterio que el vendido del dashboard
  ([`dashboard-inicio.md`](./dashboard-inicio.md)), salvo que acá no hay fecha: es el
  acumulado.
- **`saldoPendiente`** es la suma del saldo **por venta**, y el saldo por venta es **una sola
  expresión** escrita una vez (`backend/src/modules/ventas/saldo-venta.ts`):
  `total − Σ aplicado a la venta − Σ correcciones "no vuelve plata"`, con piso en 0 (lo que
  queda a favor del cliente no es plata por cobrar). La leen "Por cobrar" del dashboard, este
  resumen, el saldo de cada fila del listado y del detalle, el tope del abono y el "no vuelve
  plata" de las correcciones: ninguno la recalcula.
  - **Una corrección que devolvió plata no cambia lo que se debe**: ni la de efectivo (sale de la
    caja), ni la de un medio que se reversa por fuera (tarjeta), ni el `REFUND` de pasarela. Con
    $100 de total, $60 pagados, `REFUND` y nota de $20, se deben $40. Solo "no vuelve plata"
    rebaja la deuda (2026-10-02, tarea 14 del frente de emisión; cierra el D10 de la spec del
    vendido neto).
  - Una corrección sin `devolucion_via` (anterior al campo; hoy ni el seed ni los tests las
    crean) cuenta como "con plata" si tiene salida de caja y como "no vuelve plata" si no, que es
    lo que hacía la fórmula anterior.

**Una corrección se reconoce por `ventas.venta_referencia_id IS NOT NULL`**, no por el tipo
de documento. La nota hereda la caja de la venta que corrige, así que cae en el mismo
alcance de "mis cajas". Que sea esa columna y no el tipo del país es deliberado: la
devolución interna que construye el frente de emisión corrige una venta sin ser documento
tributario, y así resta sola. Antes el resumen comparaba contra el id del tipo del país
(`tipoNotaCreditoDelTenant`), un mecanismo distinto del que usaba el dashboard.

**Frontend (`pages/ventas/index.vue`):** las tarjetas "Ventas registradas", "Total facturado"
y "Saldo pendiente" muestran "—" solo en la primera carga. Después de un cobro, una
anulación o una nota de crédito desde el drawer la página **vuelve a pedir el resumen**, en
vez de parchar el saldo con el de la fila: el saldo de la fila lo recalcula el backend (cambia el estado y
el saldo, y el resumen saca las canceladas). Si dos recargas se solapan, solo cuenta la
respuesta de la última.

### GET /api/ventas

Lista paginada de ventas del tenant autenticado. Query params: `page` (default 1), `pageSize` (default 15, max 100), `estado`, `canal`, `documento`. La respuesta incluye campos enriquecidos por fila: `montoPagado` (suma de pagos menos vuelto), `saldo` (la expresión única del saldo, no `total − montoPagado`; una corrección da 0) y el resumen de quién emitió (`emisores`, `tieneDuplicado`).

```
GET /api/ventas?page=1&pageSize=15&estado=pendiente&canal=fisico&documento=sin_numero

Response (200):
{
  "data": [
    {
      "id": "uuid",
      "canal": "fisico",
      "estado": "pagada",
      "totalFinal": "1069810.0000",
      "montoPagado": "1069810.0000",
      "saldo": "0.0000",
      "fecha": "2026-06-29T...",
      "creadoEl": "2026-06-29T...",
      "emisores": ["maquina", "sistema"],
      "tieneDuplicado": false
    }
  ],
  "meta": { "page": 1, "pageSize": 15, "total": 42, "totalPages": 3 }
}
```

**`documento` — quién emitió** (spec `emision-por-venta` § 3.7, [ADR-028](../adr/028-emision-registrada-por-venta.md)).
Es lo que deja al comercio revisar sus ventas sin documento, sus vouchers sin número y los
duplicados para el contador. Un valor que no es uno de los seis es un 400, y ausente es "sin
filtro". Cada valor es un `EXISTS` sobre `venta_documentos`, sobre los documentos **vigentes**
(`descarte IS NULL` y `eliminado_el IS NULL`): lo que una anulación descartó no cuenta.

| `documento` | La venta tiene algún documento vigente… |
|---|---|
| `sistema` | del sistema |
| `maquina` | de la máquina que **no** es el voucher duplicado |
| `externo` | hecho por fuera |
| `sin_numero` | de la máquina o hecho por fuera, sin número |
| `sin_documento` | `nadie`: un tramo que nadie documentó |
| `duplicado` | `es_duplicado` (voucher de un abono sobre una deuda ya documentada, E1b) |

- **Las correcciones y las ventas canceladas quedan fuera de todos los valores**
  (`venta_referencia_id IS NOT NULL` o `estado = 'cancelada'`): las correcciones llevan sus
  propios documentos y no son una venta que revisar (la fila `nadie` de una devolución interna
  no es un faltante), y en una cancelada no hay nada pendiente que documentar. Lo de las
  canceladas es una defensa: hoy no hay forma de que una conserve un documento vigente que el
  filtro encontraría (los del sistema y los de afuera se descartan al anular, y un `nadie`
  nace de un pago, que impide anular). Sin filtro, ambas siguen en el listado.
- **`sin_numero` ignora al sistema y a `nadie`**: el sistema todavía no folia (ADR-010) y una fila
  `nadie` no lleva número. El voucher duplicado **sí** cuenta si no tiene número: también se
  completa con `PATCH /documentos/:id`.
- **`maquina` no incluye al duplicado**: una venta cuyo único documento de la máquina es el
  voucher duplicado se ve con `sistema` y con `duplicado`, no con `maquina`.
- **El resumen por fila sale de la misma consulta**, una agregación sobre los documentos
  vigentes (no una consulta por fila). `emisores` son los emisores de esos documentos, sin
  repetir y ordenados, **sin contar el voucher duplicado** (así dice lo mismo que el filtro
  `maquina`); `tieneDuplicado` lo avisa aparte. El resumen muestra solo documentos vigentes
  (los descartados al anular no figuran), de modo que una venta anulada trae `[]` mientras no
  conserve ninguno. A diferencia de los filtros, el resumen no mira el estado de la venta. En
  una corrección son los de su propio documento.

**Frontend (`pages/ventas/index.vue`):** un selector "Documento" junto a los de estado y canal
(sus opciones y etiquetas viven en `useDocumentosVenta.ts`, derivadas de un solo mapa) y una
columna "Documento" con un badge por fila: los emisores ("Máquina + Sistema"), en aviso si alguno
es "Sin documento", más un badge "Duplicado". Las correcciones no llevan badge.

### GET /api/ventas/:id

Retorna la venta con sus relaciones expandidas: `detalles`, `descuentos`, `recargos`, `impuestos`, `customer`, `pagos`. Incluye `montoPagado`, `saldo` (la expresión única) y `puedeAbonar` (estado que admite abono **y** saldo > 0): la pantalla no resta ni replica el estado.

**Los documentos y lo que el backend decide sobre ellos** (spec `emision-por-venta` § 3.4 y § 3.5,
[ADR-028](../adr/028-emision-registrada-por-venta.md)). La pantalla solo los muestra:

- **`documentos[]`**: los de la venta **y los de sus correcciones** (`venta_referencia_id`), en una
  sola consulta. Cada uno trae `id`, `ventaId` (la venta o la corrección a la que pertenece: es el
  id de la ruta del `PATCH`), `emisor`, `tipoDocumento` (`{ id, codigo, nombre }` o `null`),
  `claseMaquina`, `numero`, `estadoEnvio`, `monto`, `pagoId`, `documentoCorregidoId`, `esDuplicado`,
  el descarte: `descarte`, `descartadoEl` y `descartadoPorNombre`, y `numerosBorrados` (cada borrado
  del número, el más nuevo primero; `[]` si nunca se borró). **Incluye los descartados**:
  qué documento "vale" lo dice `descarte`, no su presencia. El tipo y quien descartó se resuelven
  por `JOIN` **sin filtrar borrados**, a propósito: un documento ya emitido conserva su tipo y su
  historial aunque el catálogo o la cuenta se borren después (el porqué está escrito en la consulta).
- **`tipoDocumento`**: `{ id, codigo, nombre, esBoleta }` o `null`. `esBoleta` sale del catálogo
  (`tipos_documento_tributario.es_boleta`, en la misma consulta de la cabecera) y es lo que usa la
  pantalla de anular para decir "esta factura" o "este documento". No se deduce del nombre ni del
  código; `false` si el tipo se borró del catálogo.
- **`anulable`**: estado `pendiente`, sin pagos, sin notas de crédito y `evaluarAnulacion` (sin `externoHecho`) en
  `anulable` o `pregunta_externo`. Es la misma regla que `POST /anular`, no una copia.
- **`anularPreguntaExterno`**: `anulable` **y** hay un `externo` vigente sin número (hay que
  preguntar "¿ya lo hiciste en tu facturador?" antes de anular). Es `false` si la venta no es
  anulable, aunque tenga un `externo`.
- **`abonoConMaquinaDuplica`**: un abono pagado con la máquina **duplicaría** un documento. Es
  `true` si la venta puede abonarse (`puedeAbonar`: `pendiente` o `pagada_parcial`, el mismo corte
  de `registrarAbono`, y con saldo según la expresión única: la propina no lo baja y lo que una
  nota "no vuelve plata" perdonó tampoco se debe) y su
  deuda ya está documentada, con **el mismo predicado** que usa el abono para anotar el duplicado
  (`VentaDocumentosService.ventaDocumentada`: algún documento vigente, no duplicado y que no sea
  `nadie`). La pantalla de abono avisa con esto, sin bloquear.

### PATCH /api/ventas/:id/documentos/:documentoId

Anota **después** el número de un documento de la máquina (el voucher, el folio) o de uno hecho por
fuera (spec § 3.4). Sirve también para el voucher duplicado del abono (E1b).

```
PATCH /api/ventas/{id}/documentos/{documentoId}
Request: { "numero": "445566", "clase": "voucher" }   // clase es opcional, y solo con la máquina
Response (200): el documento actualizado, con la forma de `documentos[]` del detalle
```

- **Permiso:** `Ventas:Crear`, con el mismo alcance de caja que `GET /ventas/:id`
  (`resolverAlcanceDerivadoDeCaja`, eje `Cajas:Leer`): una venta que no es del cajero es **404**,
  no 403. El `tenant_id` sale del token; el body solo trae lo tipeado.
- **`numero`**: mismas reglas que `numeroDocumento` del cobro (sin espacios en los extremos, máx. 40,
  sin caracteres de control) y **no vacío**: vacío o en blanco es 400. Reescribir un número ya
  anotado se permite. **`clase`** ausente conserva la que había; `null` es 400; con un documento
  `externo`, 400.
- **Solo aplica a un documento vigente** (`descarte IS NULL`, no borrado), de emisor `maquina` o
  `externo`, **de esa venta** y de ese tenant. Cualquier otro (del `sistema`, una fila `nadie`, uno
  descartado, uno de otra venta, de una corrección o de otro tenant) es **404**.
- **Concurrencia:** toma el mismo `FOR UPDATE` de la venta que `POST /anular`, dentro de una
  transacción, antes de leer y escribir. Sin él, anotar el número de un `externo` correría contra
  una anulación que lo declara no hecho (E10) y el documento quedaría descartado **con** número.
- La escritura vive en `VentaDocumentosService.completarNumero(manager, { tenantId, documentoId,
  numero, clase? })`, que **no recibe nada del request** (ni usuario ni venta) y **valida el número por
  su cuenta** (no vacío, máx. 40, sin caracteres de control): una integración futura con el facturador
  externo llama ese mismo método, sin pasar por el DTO. Anotar el número de un `externo`
  cambia lo que decide `anulable`: con número, anular es 400 sin preguntar.

### POST /api/ventas/:id/documentos/:documentoId/borrar-numero

Borra el número de un documento **hecho por fuera** (`externo`), y deja registrado quién, cuándo y
qué decía (PRODUCTO § 10, owner 2026-10-02). La venta vuelve a "sin número", así que anular **vuelve a
preguntar** "¿ya lo hiciste en tu facturador?" (E10). Sin esto, un número anotado por error ("1" en
una factura que no se hizo) obligaba a ir por nota de crédito, porque con número el documento se da
por hecho.

```
POST /api/ventas/{id}/documentos/{documentoId}/borrar-numero     // sin body
Response (201): el documento sin número, con la forma de `documentos[]` del detalle
```

- **Permiso:** `Ventas:Anular` (no `Crear`: quien puede anular puede corregir el número). Mismo
  alcance de caja que `GET /ventas/:id` y que el `PATCH`: una venta que no es del cajero es **404**,
  no 403. El usuario sale del token; el número que había lo lee el servidor.
- **Es un `POST` y no un `DELETE`**: no se borra ninguna fila. El documento sigue y el borrado queda
  como un hecho aparte.
- **Solo un `externo` vigente (`descarte IS NULL`, no borrado), de esa venta y de ese tenant, y con
  número.** Cualquier otro (máquina, sistema, `nadie`, descartado, de otra venta, de una corrección
  o de otro tenant) es **404**; un `externo` sin número (o en blanco, el mismo criterio con que anular
  lo da por no hecho) es **400**.
- **Mismo `FOR UPDATE` de la venta** que `POST /anular` y que el `PATCH`, en una transacción y después
  del alcance de caja (`VentasService.tomarDocumentoDeLaVenta`, compartido con el `PATCH`).
- **El registro:** una fila por borrado en `venta_documento_numero_borrados` (`numero_anterior`,
  `usuario_id`, `creado_el` = cuándo), escrita por `VentaDocumentosService.borrarNumero` en la misma
  transacción. **Cada borrado es una fila nueva y las anteriores no se tocan**: anotar un número,
  borrarlo, anotar otro y borrarlo deja dos filas. Por eso es una tabla de eventos (el patrón de
  `garzon_pin_evento`) y no columnas en `venta_documentos`, que guardan solo el último. **Solo se
  registra el borrado**: reescribir un número con el `PATCH` no deja nada.
- El detalle los trae en `documentos[].numerosBorrados` (`numeroAnterior`, `borradoEl`,
  `borradoPorNombre`), en **una** consulta por lote (`documento_id = ANY($2)`) para todos los
  documentos. El `JOIN` al usuario **no filtra borrados**, a propósito: quién borró un número no se
  pierde porque su cuenta se dé de baja después.

`tieneLineasDespachadas` (booleano) dice si la venta salió de una **cuenta de salón con
alguna línea ya enviada a cocina**. Es el único consumidor de ese puente hacia salones, y
existe para el default del checkbox de anulación (arriba). Se resuelve con un `EXISTS`
dentro de la misma consulta de la cabecera —`cuentas` → `cuenta_lineas` con
`cantidad_enviada > 0`—, así que no agrega ni una ida a la base; `cantidad_enviada` vive
solo en `cuenta_lineas`, nunca en `venta_detalles`. `false` en la venta de POS.

### GET /api/ventas/:id/boleta

Reimprime la boleta de una venta **pagada o anulada** (2026-09-17; el estado, 2026-09-18):
devuelve `BoletaVenta`, el
mismo payload que arma el servidor al cobrar (`POST /cuentas/:id/cerrar` y `POST /ventas`,
ver [`impresion-termica.md`](./impresion-termica.md)) — no un recálculo, así que reimprimir
y el original dan el mismo papel. `BoletaVenta.estado` viaja en el payload: una venta
`cancelada` sale marcada `ANULADA`. La que todavía no se cobró del todo (`pendiente`,
`pagada_parcial`) da **400** — su papel saldría con los pagos incompletos y sin nada que diga
que sigue abierta. El filtro vive en `reimprimirBoleta`, no en `armarBoleta`: el cobro del
POS también arma la boleta de una venta que queda pendiente.

**Permiso, en dos capas (owner, 2026-09-30 — `docs/agent/pendientes.md` § 3):**
`Ventas:Anular` (el encargado) reimprime con el alcance de siempre
(`resolverAlcanceDerivadoDeCaja`). `Ventas:Leer` a secas (la cajera) reimprime solo si la
venta es visible bajo ESE MISMO alcance (`filtroDeMisCajas`: su caja en cualquier estado, más
las `online`) — si no, **404**, ni se entera de que existe, igual que `findOne`— y, de las que
sí ve, solo la de su propia caja mientras esa caja siga `abierta` — si no (su caja ya
cerrada/en conciliación, o la `online`, sin dueño), **403** con un mensaje que dice que la
reimprime el encargado. Sin lock entre el chequeo de caja y el armado: la caja podría
cerrarse en el medio de las dos consultas; se acepta porque esto solo imprime un papel.

Exige `@RequiresPermiso('Ventas', 'Anular')` — el del encargado, sin permiso nuevo — y
hereda el **mismo alcance por caja** que `GET /ventas/:id` (§ "Quién ve qué" abajo): la
boleta trae pagos con su monto, el vuelto y el cajero, el mismo dato con el que se
reconstruía el esperado de una caja ajena.

`GET /ventas/:id` no sirve para esto: no trae `venta_detalles.personalizacion`, así que un
plato con ingredientes sacados o extras saldría distinto al original.

---

## Quién ve qué: el eje `Cajas:Leer`

`Ventas:Leer` es el **piso** —dice si podés entrar—; el que dice **cuánto ves** es un eje
aparte, y lo gobierna un permiso de otro módulo. La regla completa tiene **tres** ramas:

| Situación | Alcance | Por qué |
|---|---|---|
| Tiene `Cajas:Leer` | **Todo el tenant** | Es el nivel de supervisión. |
| No lo tiene, y el tenant **no contrató** el módulo `Cajas` | **Todo el tenant** | Ahí la supervisión no existe como concepto: `Cajas:Leer` es inobtenible **incluso para el admin**, así que acotar sería permanente e irreversible por configuración. Es el caso de la tienda **solo online**. |
| No lo tiene, y el tenant **sí contrató** `Cajas` | **Lo de sus cajas** | Que no lo tenga es una decisión de configuración, no una ausencia del concepto. |

📌 **`MiCaja` y `Cajas` se venden juntos, y con `Ventas` presencial** (regla del owner,
2026-08-22). No son dos productos: son **dos alcances de permiso modelados como módulos** — uno
es la operación del cajero sobre su propio turno y el otro la supervisión de las cajas ajenas, y
sueltos no sirven. Esa convención es la que hace que la rama 2 solo alcance a la tienda **solo
online**, que es su justificación escrita.
⚠️ **Nada en el código la sostiene:** el alta de tenant **no contrata ningún módulo**
(`tenant_modulos` arranca vacío) y se agregan de a uno por `POST /admin/tenants/:id/modules`, sin
endpoint para quitarlos. O sea que un tenant con `MiCaja` y sin `Cajas` es construible por
descuido al dar de alta, y ahí sus cajeros se verían la plata entre ellos. Es un error de
aprovisionamiento, no un paquete que exista — se decidió **no** codificar la dependencia entre
módulos, que hoy el catálogo no tiene.

⚠️ **`MiCaja:Leer` no entra en la regla, y es a propósito.** La primera versión lo usaba y era
**fail-open**: sacarle `MiCaja:Leer` a un rol que conserva `MiCaja:Crear` le concedía
visibilidad total, y `Crear` alcanza para operar caja de punta a punta. Quitar un permiso no
puede conceder acceso. Detalle en el docblock de `resolverAlcanceDerivadoDeCaja`.

**Por qué el eje de caja y no uno propio:** ni `ventas` ni `pagos` guardan quién los hizo —solo
`caja_id`—, así que la autoría **se deriva de la caja** (`caja_id → cajas.usuario_id`), exacto
porque una caja abierta pertenece a un solo usuario. El permiso que decide *"¿ves cajas
ajenas?"* es entonces el mismo que decide *"¿ves ventas ajenas?"*. Mecánica y las **dos**
funciones que no hay que confundir (la de caja lanza 403, esta no) en
[`patterns/backend.md` §16](../patterns/backend.md).

**De dónde salió (2026-08-22).** Antes de esto, un cajero con `Ventas:Leer` listaba **todas** las
ventas del tenant y podía abrir el detalle de cualquiera — y el detalle trae `caja_id`, `monto`
y `vuelto` **por pago**, así que era el camino largo para reconstruir el esperado de una caja
ajena. Ahora el detalle de una venta que no es suya responde **404**, y en el detalle de una
venta propia el `caja_id` de un pago que no es suyo **viaja en `null`**.

**Lo que arregla es más grande que el modo ciego:** hasta acá cualquier cajero veía la
facturación entera del local. Medido después de construir el eje: el admin ve 87 pagos de 18
cajas, el cajero ve 3, de las 2 suyas.

⚠️ **El detalle de una venta ajena responde `404`, no `403`** — un `403` confirmaría que existe.

**Las escrituras sobre una venta por su id también lo respetan** (2026-10-02):
`POST /ventas/:id/notas-credito`, `POST /ventas/:id/anular`, `PATCH /ventas/:id/documentos/:documentoId`
y `POST …/borrar-numero` pasan por el mismo alcance (`exigirVentaVisible`, antes del lock de la
venta) y responden **404** sobre una venta ajena. El permiso de la escritura (`Nota de crédito`,
`Anular`, `Crear`) es el piso; el eje dice sobre qué ventas. Antes, quien tenía el permiso
operaba sobre ventas que `GET /ventas/:id` le ocultaba. Lo fija
`visibilidad-ventas-pagos.e2e-spec.ts` con un usuario propio sin `Cajas:Leer`: la venta ajena
da 404 y la propia pasa. El reembolso de pasarela, que crea su nota desde el sistema, no pasa
por este alcance. El **abono** (`POST /pagos`, con el `ventaId` en el body) tiene el mismo
alcance desde la misma fecha: una deuda de otra caja la cobra solo quien tiene `Cajas:Leer`
(owner; ver [`pagos.md`](./pagos.md#quién-ve-qué-el-eje-cajasleer)).

⚠️ **La venta `canal='online'` la ve cualquiera con `Ventas:Leer`**, aunque no sea de nadie: va
siempre contra la caja **virtual** del tenant, que nunca se cuenta físicamente, así que no puede
revelar el esperado de ningún cajón que alguien vaya a arquear. Sus **pagos** también entran en
el listado, por la misma razón — si no, la misma fila tendría dos reglas distintas y los KPI de
pagos quedarían descuadrados contra los de ventas.
⚠️ **Eso vale mientras online exija pago completo.** No es una propiedad del canal: descansa en
que `crear` rechaza una venta online sin pago total y en que el abono opera siempre sobre caja
física. Si algún día se habilita pago contra entrega o abono parcial online, hay que volver a
mirar este filtro.

⛔ **Lo que NO arregla, y conviene no confundirlo:** el cajero **sigue pudiendo deducir el
esperado de su PROPIA caja** sumando sus propios pagos — verificado corriendo la demostración
otra vez con el eje puesto: dedujo 20.357 contra 20.357 reales. Y está bien que pueda, porque
esos pagos los cobró él. Cerrarlo exigiría quitarle su propio historial de ventas, que es la
misma aritmética que hizo descartar el ocultamiento del resultado post-conteo.
**Corolario:** contra la caja propia, el modo ciego es **fricción, no barrera** — evita el
maquillaje casual, no a quien lleva la cuenta. Lo que sí garantiza, y antes no, es que **no vea
la plata de otros**.

⚠️ **Tampoco cerraba los dos oráculos** del modo ciego (el `422` de
`POST /caja/:id/movimientos` y el de la nota de crédito en efectivo). No salen de un listado
sino del borde aceptar/rechazar de una validación legítima.
✅ **Resueltos por RASTRO el 2026-08-23**, que es lo que el owner había decidido: el chequeo
queda intacto y el intento rechazado se registra en `caja_intentos_rechazados` para que lo
lea el supervisor. Del lado de ventas cambia **solo el mensaje**: el `422` del tope de la
devolución en efectivo ya **no interpola el monto disponible** —era un oráculo de UN request,
que entregaba el efectivo cobrado de la venta sin emitir ninguna NC— y el tope en sí, el
monto de la NC y la semántica del documento no se tocaron. Detalle del mecanismo y de la
lectura del supervisor en
[`features/gestion-cajas.md`](./gestion-cajas.md#rastro-de-intentos-rechazados).

## Backend

### Module & Services

- **Module**: `src/modules/ventas/ventas.module.ts`
- **Controller**: `src/modules/ventas/ventas.controller.ts`
- **Service**: `src/modules/ventas/ventas.service.ts`

### Entities & Database

| Entity | Tabla |
|--------|-------|
| `Venta` | `ventas` |
| `VentaDetalle` | `venta_detalles` |
| `VentaDescuento` | `ventas_descuentos` |
| `VentaRecargo` | `ventas_recargos` |
| `VentaImpuesto` | `ventas_impuestos` |
| `VentaCustomer` | `venta_customer` |
| `VentaDocumento` | `venta_documentos` (módulo `venta-documentos`, ADR-028) |
| `Pago` | `pagos` |
| `TipoDocumentoTributario` | `tipos_documento_tributario` |

Todas con soft delete (`eliminado_el`) y triada de auditoría. PKs UUID con `type: 'uuid'` (ADR-004).

**La línea es un snapshot, no un puntero al catálogo.** `venta_detalles` congela
`descripcion`, `clasificacion_tributaria`, `precio_unitario`, `tasa_cambio` y —desde el
2026-08-02— **`unidad_codigo_base`**: en qué unidad está `cantidad`. Sin ella el número no
tiene magnitud (`2` no dice si son 2 unidades o 2 kg) y había que leer `items` para saberlo.
Es `NOT NULL`; para servicios, recetas y combos vale `'unidad'`.

Distinta de `unidad_codigo_presentacion`, que es nullable y solo existe cuando la línea se
vendió por presentación ("2 cajas"): describe **cómo se pidió**, no en qué unidad está el
número con el que calculó el motor.

⚠️ Hoy esa unidad **no puede derivar**: `items.service.ts` bloquea cambiarla en un producto
con movimientos no-`ajuste`, vender siempre registra uno y nada soft-borra movimientos
(medido 2026-08-02). Congelarla es **defensa en profundidad** —que la línea no dependa de un
guard de otro módulo— y sobre todo hace que el dato **exista en la venta**, que es lo que el
detalle necesita para mostrar "2,5 kg" en vez de "2,5". Ver también el congelado de reglas en
[`motor-calculo-precios.md`](motor-calculo-precios.md).

### Flujo transaccional (`crear`)

1. Verificar caja abierta (`cajaService.findActiva`)
2. Cargar items + resolver moneda oficial (`pais.moneda_oficial_id` — ADR-005 y ADR-021)
3. Convertir precios a moneda oficial (`precioOrigen × tasa_cambio`)
4. Llamar `calculoPreciosService.calcular` → importes autoritativos
5. Calcular excedente; validar `permite_vuelto` si hay excedente; determinar estado
6. `db.transaccion`: **reclamar la `Idempotency-Key`** (primera sentencia; si ya estaba, reproducir y cortar acá) → guardar cabecera → detalles → trazas de reglas → customer → inventario (`salida/venta` por producto) → pagos → movimientos de caja (efectivo) → **documentos de la venta** (`VentaDocumentosService.documentarVenta`) → guardar la respuesta junto a la clave

### Dependencias reutilizadas

| Servicio | Uso |
|----------|-----|
| `CalculoPreciosService.calcular` | Fuente autoritativa de todos los importes |
| `InventarioService.registrarMovimiento(manager, ...)` | Ya manager-aware, entra en la misma TX |
| `CajaService.findActiva` | Busca caja física abierta |
| `CajaService.registrarMovimientoEnTransaccion(manager, ...)` | Nuevo método extraído para entrar en la TX |

---

## Nuevos estados de venta

| Estado | Cuándo se asigna |
|--------|-----------------|
| `pendiente` | La venta se crea sin pagos y con total > 0 |
| `pagada_parcial` | Hay algo aplicado y todavía hay saldo |
| `pagada` | El saldo llega a 0 —con un abono, o porque una nota "no vuelve plata" perdonó lo que se debía—, **incluido el caso de total $0 sin ninguna línea de pago** |
| `cancelada` | Anulación explícita |

**Una venta de total $0 es una venta PAGADA, sin línea de pago.** Es el caso real de una
promoción que descuenta el 100%: la venta existió, descuenta stock, emite su documento y
**no** aparece como deuda. El estado se deriva siempre del saldo
(`recalcularEstadoDeLaVenta`), sin condicionarlo a que existan pagos — condicionarlo dejaba esa
venta en `pendiente` con saldo $0, arrastrándose en los listados de deuda. Ni el POS ni la
tienda registran un pago de $0 con un método elegido a dedo: simplemente no mandan pagos.

⚠️ Esto **no** afloja la regla de que *"las ventas online requieren el pago completo"*, que
es anterior e independiente: una venta `online` con total > 0 y sin pagos sigue rechazándose
con `400`. Lo que cambió es qué estado se calcula, no quién puede crear una venta sin pagar.

**No existe `borrador`** (eliminado del enum el 2026-07-27): la venta en construcción vive
en `cuenta`/`cuenta_lineas` de salones, que es el *open ticket* del dominio; un estado
paralelo en `ventas` sería una segunda forma de resolver lo mismo.

`cancelada` la asigna `POST /ventas/:id/anular` (ver abajo), acotada al subconjunto seguro.

El saldo es `total_final − Σ(pago_aplicaciones.monto WHERE tipo = 'venta') − Σ correcciones "no
vuelve plata"`, sobre **lo aplicado a la venta** y no sobre el bruto cobrado. Y el estado se
**re-deriva de ese saldo en un solo lugar** (`recalcularEstadoDeLaVenta`, `saldo-venta.ts`) cada
vez que algo mueve lo que se debe: crear la venta, un abono y una corrección "no vuelve plata"
(que puede dejar la venta en `pagada`).

La distinción no es cosmética: un pago puede repartirse entre venta y propina
(`pago_aplicaciones` guarda el split), así que `Σ(pago.monto − pago.vuelto)` contaría la
propina como si pagara la venta y la dejaría en `pagada` con parte del total sin cobrar.
Misma fuente en `listar()`, `resumen()` y `registrarAbono()`: todos incluyen la expresión única
del saldo (`saldo-venta.ts`), que además resta lo que las notas "no vuelve plata" perdonaron (ver
`GET /api/ventas/resumen` y PRODUCTO § 10).

---

## Frontend (POS)

Interfaz de punto de venta para crear una venta desde el catálogo hasta el cobro final.

### Ruta y Componente Principal

- **Ruta**: `/ventas/pos` (`app/pages/ventas/pos.vue`)
- **Layout**: Dos paneles — catálogo + buscador a la izquierda, carrito + desglose + cobro a la derecha
- **Gate**: Panel bloqueante si no hay caja abierta (verifica estado en el store de cajas)

### Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `CatalogoGrid` | `app/components/ventas/CatalogoGrid.vue` | Buscador de items + grilla de productos; emite `add` al carrito |
| `ClienteForm` | `app/components/ventas/ClienteForm.vue` | Datos del cliente (nombre, RUT, dirección, teléfono, email); exporta tipo `CustomerForm` |
| `CarritoPanel` | `app/components/ventas/CarritoPanel.vue` | Líneas del carrito con `AppCantidadInput` (±, selector de unidad de la misma magnitud), selector de tipo de documento, desglose, botón Cobrar |
| `CobroModal` | `app/components/ventas/CobroModal.vue` | Modal de pagos múltiples con distintos métodos, cálculo de vuelto, confirmación y emisión de POST /api/ventas |
| `DocumentoNumeroCampos` | `app/components/ventas/DocumentoNumeroCampos.vue` | "N° del comprobante" + selector opcional "Es voucher / Es boleta de la máquina"; lo usan el cobro, el abono y "Completar número" |

| `AppCantidadInput` | `app/components/AppCantidadInput.vue` | Stepper + selector de unidad (misma magnitud); emite cantidad canónica y presentación |

**Número del comprobante al cobrar (2026-10-02, emisión por venta).** Bajo un pago cuyo medio
emite con la máquina (`emisor === 'maquina'` en `GET /metodos-pago`), `CobroModal` muestra dos
campos opcionales: "N° del comprobante" y "Es voucher / Es boleta de la máquina". Viajan en el pago
(`numeroDocumento`, `claseDocumento`) por `POST /ventas` y `POST /cuentas/:id/cerrar`; lo tipeado
antes de cambiar a otro medio no viaja. El cajero **no elige quién emite**: lo resuelve el servidor
con la regla del medio. Sin número se completa después desde el detalle de la venta.

### Cantidad con unidad de presentación

- Cada línea guarda **cantidad canónica** (`cantidad`, unidad base del ítem) para precio/stock y **presentación** (`cantidadPresentacion` + `unidadCodigoPresentacion`) para UI/tickets.
- Helpers en `app/utils/cantidad-presentacion.ts`; catálogo de unidades vía `useUnidadesMedidaStore().ensureLoaded()`.
- POST `/ventas` envía ambos campos cuando el operador eligió una unidad distinta a la base (ej. `500 g` → canónica `0.5` kg).

### Composable & Lógica Pura

- **`useVenta.ts`** (`app/composables/useVenta.ts`): Helpers puros sin Nuxt ni Vue (100% testeables con Vitest)
  - `puedeCobrar(tipoDoc, customer)` — valida si se puede proceder a cobro (Boleta sin cliente OK; Factura requiere nombre)
  - `resumenCobro(carrito, detalles)` — resume montos por tipo de descuento/recargo/impuesto
  - `sumaPagos(pagos)` — suma total de pagos para calcular vuelto
  - `setMontoPago(total, pagos, indice, monto)` — fija el monto de un pago y los demás absorben el excedente (reducen desde el primero, con piso 0; nunca aumentan solos). El pago nuevo se prellena con el restante y los pagos en $0 se omiten al confirmar
  - `resumenCobro` marca `excedenteSinVuelto` cuando los pagos con métodos sin vuelto superan el total (ese excedente no se puede devolver); el vuelto solo se acredita si proviene de métodos con vuelto
  - `toCalculoInput(carrito, metodoPago, descuentosVenta, recargosVenta)` — estructura payload para `/calculo-precios/calcular`

- **Estado reactivo**: `ref` del carrito; el resultado del cálculo lo maneja
  `useResultadoCalculado()` (debounce 300 ms), que lo mantiene atado al carrito que lo
  produjo — ver `docs/patterns/frontend.md` §10.1. El botón Cobrar espera un cálculo
  vigente antes de abrir el modal: el `:total` que se cobra sale de ahí.

### Fricción por Documento

- **Boleta**: cliente opcional — se puede cobrar sin datos del comprador.
- **Factura**: cliente obligatorio — campo de nombre debe estar completado para habilitar botón "Cobrar".
- **Validación en cliente** vía `puedeCobrar()` y cambio de estado del botón Cobrar. Es
  comodidad: el servidor rechaza con 400 la venta de un tipo `customer_requerido` sin cliente
  (ver "El tipo de documento lo decide el servidor").

### Testing

```bash
cd frontend && npm test -- app/composables/useVenta.spec.ts    # 15/15 Vitest
```

---

## Testing

```bash
# Unit tests (6 casos: estado pagada/pendiente, vuelto, inventario, servicio-sin-stock)
cd backend && npm test -- --testPathPatterns=ventas

# E2E tests (9 casos contra Docker PostgreSQL)
cd backend && npm run test:e2e -- --testPathPatterns=ventas --forceExit
```

---

## Frontend — historial y detalle de ventas

Implementado en 2026-06-30; rutas unificadas en 2026-07-01.

### Páginas (rutas canónicas)

| Página | Ruta | Descripción |
|--------|------|-------------|
| Historial de ventas | `/ventas` | Tabla con filtros, KPIs; fila clickeable abre detalle |
| Detalle de venta | `/ventas?venta={uuid}` | Drawer lateral (`VentaDetalleDrawer`): líneas, totales, pagos, saldo; botón "Registrar pago" para `pendiente`/`pagada_parcial`; sección "Documentos"; botón "Reimprimir boleta" (ver abajo) |
| Punto de venta | `/ventas/pos` | Crear venta (ver sección POS arriba) |

**Reimprimir boleta (2026-09-17; camino angosto de la cajera, 2026-09-30):** visible en una
venta `pagada` o `cancelada` (`puedeReimprimir`) y con `Ventas:Anular` (el encargado, alcance
de siempre) **o**, sin ese permiso, solo si la venta es de la caja FÍSICA propia y esa caja
sigue `estado === 'abierta'` — `en_conciliacion` NO cuenta, mismo corte que
`CajaService.bloquearCajaAbierta`. Gemelo exacto de `GET /ventas/:id/boleta`
(`VentasService.reimprimirBoleta` / `reimprimirBoletaPropia`, detalle más arriba): permiso y
estado los enforcea la ruta, el `v-if` solo evita ofrecer lo que el backend va a rechazar (404
si la cajera no ve la venta, 403 si la ve pero no cumple la regla angosta — el toast muestra
ese mensaje del backend tal cual). Una venta `online` cuelga de la caja virtual (sin dueño) y
nunca matchea la caja activa del usuario, así que cae afuera sin chequeo aparte. Al apretarlo
(no al abrir el drawer) pide `GET /ventas/:id/boleta` e imprime con `buildBoletaTicket`
marcada `COPIA` (+ `ANULADA` si la venta se anuló) + la fecha/hora de la reimpresión
(`ticket-builder.ts`, detalle en
[`impresion-termica.md`](./impresion-termica.md)). `BoletaVenta` es un tipo único,
compartido con `useSalones.ts` y `pos.vue` desde `~/types/boleta.ts`.

### Redirects de compatibilidad

| Ruta legacy | Destino |
|-------------|---------|
| `/ventas/historial` | `/ventas` (conserva query string) |
| `/ventas/:id` | `/ventas?venta=:id` |

### Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `VentaDetalleDrawer` | `app/components/ventas/VentaDetalleDrawer.vue` | Detalle expandible, pagos, abono |
| `AbonoModal` | `app/components/pagos/AbonoModal.vue` | Abono a venta pendiente/parcial |

**Sección "Documentos" del drawer (2026-10-02, emisión por venta).** Lista los documentos de la
venta y de sus correcciones (`documentos[]` del detalle): quién lo emitió ("El sistema", "La
máquina", "Hecho por fuera", "Nadie"), el tipo o la clase (voucher / boleta de la máquina), el
número o "Sin número", el monto, qué documento corrige si es una corrección, y "Duplicado — para el
contador" si es el voucher duplicado del abono. Un documento del sistema dice "Armado, sin enviar
al SII"; uno descartado, "Descartado al anular" y, si fue `afirmado_no_hecho`, "<usuario> dijo que
no estaba hecho, <fecha>". Una venta sin documentos dice "Sin documento". **"Completar número"**
(solo `maquina` y `externo` vigentes sin número, con `Ventas:Crear`) abre el campo en la fila y hace
`PATCH /ventas/{ventaId del documento}/documentos/{id}`: el de una corrección lleva el id de la
corrección. Después se vuelve a pedir el detalle, porque con número un documento externo cambia
`anulable`. **"Borrar número"** (solo un `externo` vigente **con** número, y solo con
`Ventas:Anular`) pregunta antes de llamar al backend ("¿Borrar el número?": qué número es y que queda
registrado); al confirmar hace `POST …/borrar-numero` (también con el `ventaId` del documento), muestra
el documento sin número —y entonces "Completar número" vuelve a ofrecerse— y vuelve a pedir el detalle:
que anular pregunte otra vez lo dice `anularPreguntaExterno`. Bajo cada documento se lista el registro
("<usuario> borró el número <anterior>, <fecha>"), el más nuevo primero.

**Anular desde el drawer.** El botón sale solo con `anulable` del backend y `Ventas:Anular`: la
pantalla no mira estado, pagos ni tipo. Con `anularPreguntaExterno`, `AnularVentaModal` pregunta
"¿Ya hiciste esta factura en tu facturador?" ("este documento" si `tipoDocumento.esBoleta`). El
botón no se habilita hasta contestar. "No" anula mandando `externoHecho: false`; "Sí" no anula:
explica que va por nota de crédito, hecha por fuera y anotada con su número (en el drawer: "Nota
de crédito" → "No vuelve plata"). Sin la pregunta no se
manda `externoHecho`.

### AbonoModal

`app/components/pagos/AbonoModal.vue` — modal para registrar abonos a ventas pendientes:
- Props: `ventaId`, `saldo` (monto pendiente), `metodos` (métodos de pago del tenant), `abonoConMaquinaDuplica` (del detalle)
- Con `abonoConMaquinaDuplica` y un pago con un medio de la máquina avisa antes de confirmar: *"Esta venta ya tiene su boleta. El voucher de este pago también vale como boleta y la duplica. El cobro sigue, y queda marcado para que el contador lo corrija."* No bloquea, y ahí mismo ofrece el número y la clase del voucher (sin la bandera no avisa ni los pide: el servidor los ignoraría)
- Reutiliza helpers de `useVenta.ts`: `resumenCobro`, `setMontoPago`, `sumaPagos`, `PagoInput`
- Al confirmar: `POST /pagos` con `{ ventaId, pagos: [...] }`; emite `success` para que la página recargue

---

## Pendiente (fase futura)

- **Filtrado avanzado en historial** — Rango de fechas, búsqueda por cliente, exportación
- **Comprobante imprimible** — Generación y descarga de PDF del comprobante de venta
- **Descuentos/recargos manuales** — Aplicación inline de descuentos o recargos por línea o a nivel de venta
- **Canal online** — Soporte de ventas en canal `online` con caja virtual automática
- **Notas de crédito** — Creación de notas de crédito referenciando ventas originales

---

## Notes

- `tenant_id` y `usuario_id` siempre del JWT, nunca del body.
- El estado se determina como `pagada` si `sumaPagos - excedente ≥ totalFinal`.
- Efectivo heuristic: `permite_vuelto = true` en `tenant_metodo_pago` indica método en efectivo.
- Plan de implementación: `docs/superpowers/plans/2026-06-29-procesamiento-ventas.md`.
