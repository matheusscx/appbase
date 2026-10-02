# Feature: Reembolsos — visibilidad en ventas + Nota de Crédito interna

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-02

---

## Overview

### What is it?

Todo reembolso aprobado de una orden de pasarela (total o parcial) **ligada a una
venta** deja su corrección en ventas (2026-10-02, spec `2026-10-01-emision-por-venta`
§ 3.6, ADR-028): una nota de crédito por el monto reembolsado, que referencia la venta
original y corrige el documento de esa venta. **No hay casilla ni campo que la pida.**
El REFUND queda ligado a ella (`pasarela_transacciones.correccion_venta_id`).

Desde el drawer de Órdenes el admin puede además:

- **Elegir ítems que se acreditan en esa nota** (`devoluciones`): cantidades por
  línea. Cualquier ítem vendido se acredita y la reposición al stock es una
  elección por línea (2026-09-04). Las devoluciones de stock viajan **dentro** de la
  corrección: ya no existe el camino que solo mueve inventario sin documento.

Además, el módulo de Ventas ahora **muestra los reembolsos siempre** (haya o no NC):
sección "Reembolsos" y "Documentos relacionados" en el detalle de la venta, y badges
derivados "Reemb. parcial" / "Reembolsada" / "NC" en el listado.

### Why does it exist?

Antes, el reembolso vivía solo en el módulo pasarela: la venta y sus pagos no se
enteraban, y los reportes seguían mostrando el total cobrado completo. La NC es el
tratamiento contable estándar (en Chile anula/corrige boletas y facturas) y queda
lista para el día en que se integre facturación electrónica.

### Scope

- Incluido: **todo reembolso aprobado de una orden con venta deja su nota de crédito
  (2026-10-02; ya no es elegible) y el REFUND queda ligado a ella**; devolución de stock
  elegible por línea, dentro de esa nota; **acreditación por línea de cualquier ítem vendido, reponga
  o no el stock (2026-09-04)**; visibilidad de reembolsos en detalle/listado de
  ventas;
  badges derivados (no son estados nuevos en BD); **NC manual desde el detalle
  de venta con egreso de caja elegible (2026-07-11)**.
- NO incluido (futuro): emisión tributaria real (SII/folios); **la REPOSICIÓN**
  en modos `serie`/`lote` (requiere elegir unidades/lote — se hace manual desde
  Inventario); egreso en el ledger de `pagos`; devolución de dinero por el
  método de pago original (el egreso es efectivo de caja).

  ⚠️ **Ojo con el primero:** desde el 2026-09-04 un ítem `serie`/`lote` **sí se
  acredita por línea**. Lo único que sigue afuera es que vuelva al stock.

---

## API Endpoints

### Reembolso extendido (existente, campo nuevo opcional)

```
POST /api/pasarela/admin/ordenes/:id/reembolsos
Authorization: Bearer <JWT>   (permiso Pasarelas:Reembolsar)

Request:
{
  "monto": "1100",
  "devoluciones": [                                    // opcional: ítems que se acreditan en la nota
    { "itemId": "uuid", "cantidad": "2" }
  ]
}

Response (200): orden pública + extras
{
  ..., "reembolsoAprobado": true,
  "notaCreditoId": "uuid",        // la corrección que dejó el reembolso (= correccion_venta_id del REFUND)
  "warning": "..."                // si el reembolso se procesó pero la corrección falló
}
```

- **El body ya no tiene `generarNotaCredito`**: mandarlo da 400 (el pipe global rechaza lo
  que el DTO no declara, `forbidNonWhitelisted`). Vale igual para la API externa
  (`POST /pasarela/api/cobros/:ordenId/reembolsos`), que usa el mismo DTO.
- Si la corrección falla después de un reembolso aprobado, **el reembolso NO se
  revierte** (la plata ya volvió por el proveedor): la respuesta trae `warning`, el
  error queda en logs y el REFUND queda **sin** `correccion_venta_id`. Eso —un REFUND
  aprobado de una orden con venta y ese campo nulo— es la señal de que falta la
  corrección. Si la corrección se creó pero no se pudo ligar al REFUND, la respuesta
  trae `notaCreditoId` **y** `warning`.
- Una orden sin venta vinculada (`orden.venta_id` null) no tiene lado de ventas que
  corregir: se reembolsa sin corrección y **sin aviso** (es legítimo). Solo si se pidieron
  `devoluciones` responde `warning` (no hay venta donde aplicarlas).

### GET /ventas/:id (campos nuevos)

- `ventaReferenciaId`, `tipoDocumento {id, codigo, nombre}`.
- `esCorreccion` (la venta apunta a otra: una NC **o una devolución interna**) y
  `esNotaCredito` (corrección **con el tipo NC**: falso en la devolución interna,
  que lleva el tipo nulo). Los dos salen de `venta_referencia_id`, no del tipo de
  documento — ver [Una corrección lleva su documento](#una-corrección-lleva-su-documento-según-por-dónde-vuelve-la-plata-2026-10-02).
- `opcionesDevolucion[]`: "¿por dónde vuelve la plata?", una entrada por pago que
  puede recibir la devolución y "no vuelve plata" solo si la venta tiene saldo
  (`{ pagoId | null, sinPlata, metodo, monto, mueveCaja, registro }`). Salen de la
  **misma resolución** que usa la nota al crearse, así que la pantalla ofrece lo
  que el servidor acepta y no replica la regla. Vacío en una corrección o en una
  venta que no admite nota.
- `detalles[]`: + `itemId`, `modoInventario` (`null` = servicio), `cantidadDevuelta`.
- `reembolsos[]`: REFUNDs de las órdenes de pasarela vinculadas
  (`{id, monto, estado, fecha, ordenId, codigoOrden}`).
- `notasCredito[]`: NCs hijas (`{id, totalFinal, fecha, comentario}`).
- `disponibleNotaCredito` (2026-09-04): `{ total, porPorcion: [{clasificacion,
  monto}] }` — cuánto queda por acreditar, en total y por porción fiscal, **en
  cero cuando el documento no admite nota de crédito**. Detalle y su porqué en
  [`ventas.md`](ventas.md).

### GET /ventas (listado)

- `totalReembolsado` (Σ REFUND aprobados de órdenes vinculadas), `esCorreccion` y
  `esNotaCredito`.
- `GET /ventas/resumen` **excluye** las correcciones (NC y devoluciones internas) de los
  KPIs, por `venta_referencia_id`.

---

## Backend

- **Corrección** = venta con `venta_referencia_id` → venta original, estado `pagada`,
  caja/canal/moneda copiados de la original. **La venta original nunca cambia de
  estado.** Su `tipo_documento_id` es la fila "Nota de Crédito" **del país del tenant**
  (`activo: false`, para que no aparezca en el selector del POS) **salvo en la devolución
  interna**, que lo lleva nulo. Una corrección **no se corrige** (400).
- **La NC se compone: tiene líneas, neto e IVA** (2026-09-04). Dejó de ser un
  monto suelto con los totales copiados. Sigue sin pasar por el motor de precios
  —no hay precio que calcular, hay plata que ya se devolvió— pero **todo se
  deriva del documento que corrige**:

  | | De dónde sale |
  |---|---|
  | Línea de devolución | el ítem devuelto, valuado a **lo que costó en esa boleta** (`Σ total_linea / Σ cantidad` del ítem), no al precio de lista: `total_linea` ya lleva adentro el descuento de línea, el recargo y el prorrateo del descuento de venta |
  | Línea de ajuste | el resto del monto, en el ítem de sistema **"Ajuste"**, partido en una línea afecta y una exenta según la proporción del **remanente** (original − NCs previas − lo que esta misma nota devuelve) |
  | Neto e IVA de cada línea | la **tasa efectiva** de esa porción en la venta original (`Σ impuesto / Σ neto`), y el impuesto **por resta** para que `neto + impuesto = bruto` cierre exacto |
  | Totales de la cabecera | `total_bruto = Σ subtotal` (el neto, como en una venta normal), `total_impuestos = Σ impuesto`, `total_final = monto`, y las dos `base_ventas_*` como en `crear` |
  | Filas de `ventas_impuestos` | los impuestos que esa porción llevaba en el original, con el importe repartido entre ellos a prorrata |

  **La tasa se deriva de importes congelados y no se lee del catálogo** porque
  `item_impuestos` es por ítem: dos líneas afectas de la misma venta pueden
  llevar impuestos distintos y no existe "la tasa" que leer. La NC corrige aquel
  documento, así que hereda su criterio — el mismo principio que el redondeo.

  **Cualquier ítem vendido se acredita por línea, reponga o no el stock**
  (2026-09-04). `devoluciones` dejó de significar *"ítems a devolver a stock"* y
  significa *"ítems que se acreditan"*; la reposición es una propiedad de cada
  línea (`reponerStock`, ausente = repone si el ítem puede). Antes, nombrar un
  ítem exigía `modo_inventario = 'cantidad'`, así que recetas, combos y
  servicios no se podían acreditar por línea: caían al balde de ajuste y la nota
  decía *"Ajuste"* en vez del nombre del plato. **La razón de ese corte era el
  inventario**, así que hoy dispara según lo que el camino pida del stock:

  | Camino | Política ante una línea que no repone |
  |---|---|
  | Nota manual (`POST /ventas/:id/notas-credito`) | rechaza **solo si se PIDIÓ** reponer algo que no puede; lo que no repone se acredita igual |
  | Nota por el webhook de reembolso | **nunca rechaza**: el hook corre después del commit y un throw pierde el evento (`cobros.service.ts` lo traga como warning). Se acredita y no se repone |

  (Hubo una tercera fila, la devolución de stock **sin** documento, que exigía que toda línea
  reponga. Se eliminó el 2026-10-02 con el camino: todo reembolso deja nota.)

  **Acreditar menos de lo que vale la mercadería se acepta, y las líneas se
  escalan** (2026-09-04). Es un caso real —cargo por reposición, producto que
  vuelve dañado, un monto acordado en el mostrador— y hasta ese día se rechazaba
  con 400 en el camino manual. Se revirtió tras la investigación de mercado: ni
  el SII lo prohíbe (cantidad y precio unitario son **condicionales** en la Zona
  Detalle de una NC) ni el mercado lo rechaza (de 11 productos relevados, uno
  solo). Las líneas se bajan a prorrata con `repartirProporcional` para sumar
  exactamente el monto —no dividiendo línea por línea, que con un factor que no
  divide exacto deja la suma corrida— y **la que queda en cero no se escribe**,
  misma regla que el reparto del ajuste.

  - **El motivo pasa a ser obligatorio** cuando eso ocurre: es lo único que va a
    explicar, en el documento, por qué la línea vale menos que la mercadería. Es
    el patrón de Square y Toast —donde el monto es libre, el motivo es
    obligatorio— y reemplaza a la confirmación modal, que ninguno de los 11
    productos usa. Viaja **pegado al nombre del ítem** en la línea (*"Empanada ·
    Volvieron abiertas"*), no en su lugar: el documento tiene que decir las dos
    cosas.
  - **El precio unitario de una línea escalada sale de su propio importe**
    (`bruto / cantidad`), no del valor congelado: si no, la pantalla afirmaría
    `7 × $1.190 = $368`. La línea **no** escalada conserva el valor de la boleta
    — derivarlo también ahí movería el número persistido en más de la mitad de
    las líneas y volvería el precio unitario una propiedad de cada nota.
  - **Lo que se escala es la plata, no las unidades.** El movimiento de
    inventario sigue siendo por lo que físicamente volvió.
  - ⚠️ **Lo que se pierde, dicho de frente:** con las líneas escaladas el
    documento deja de decir cuánto valía la mercadería. Square guarda los dos
    números en campos distintos y nosotros no podemos, porque nuestras líneas
    tienen que sumar `total_final` — **exigencia nuestra, no requisito fiscal**.
    El dato no se pierde del todo: la cantidad devuelta queda en
    `movimientos_inventario` con su costo congelado, atada a la nota.

  **Lo que la propia nota devuelve deja de atraer ajuste.** El remanente
  descuenta las NCs previas *y* las líneas de devolución de esta misma nota. Sin
  eso, el ajuste puede acreditar de una porción más de lo que esa porción tenía
  y la nota siguiente arranca con remanente negativo: una línea de nota de
  crédito con importe e impuesto en negativo. El piso en cero que sigue al
  descuento es red, no regla.

  **Ninguna porción fiscal se acredita más de una vez, y por eso hay un segundo
  tope.** El tope global (`Σ NCs ≤ total_final`) mira el bruto y no ve la
  porción: una nota por monto libre se come capacidad afecta, y la devolución
  siguiente —valuada a su valor congelado— la vuelve a usar. Cada documento
  cierra bien por separado y **la serie acredita más IVA del que la venta
  cobró**. Medido: venta de 8.330 afecto (IVA 1.330) + 3.000 exento, una nota
  libre de 1.000 y otra que devuelve las 7 unidades ⇒ 1.447 de IVA acreditado
  contra 1.330 cobrado. Por eso una devolución cuya porción ya está acreditada
  se rechaza con 400 (camino manual) o queda fuera del documento (webhook), con
  el stock volviendo igual.

  📌 **Es el único rechazo de los ANTERIORES que sobrevive** —el frente agregó
  dos propios: motivo faltante al escalar, y pedir reponer lo que no puede— y
  sobrevive porque es invariante
  fiscal y no preferencia de producto: el error no se ve en el documento, se ve
  sumando la serie. Y **se evalúa sobre las líneas ya escaladas**: sobre los
  valores crudos rechazaría casos que el escalado deja perfectamente adentro
  —devolver 2.380 acreditando 500 asigna 500 a la porción afecta, no 2.380—.

  ⚠️ **El corte cierra el bruto, no el último peso del IVA.** El bruto acreditado
  por porción nunca pasa el original (medido: 0 violaciones en 16.000 secuencias
  de hasta 4 notas), pero cada nota descompone su propio bruto y cuantiza a la
  escala de la moneda, así que partir un bruto en varios documentos acumula
  residuo: **12,15 % de las series multi-nota acredita 1 o 2 minor units de IVA
  de más, con 2 como techo** (100.000 series). No escala con el monto. Sacarlo
  exigiría derivar el neto de cada nota contra el remanente de la serie: es
  decisión del owner, no está tomada.

  ⚠️ **Costo del corte, en el mostrador:** la última unidad de un ítem cuyo valor
  unitario no divide exacto puede no entrar. Con `total_linea` 1.001 en 3
  unidades cada una vale 334, y la tercera pide 334 contra 333 que quedan. Es 1
  minor unit y la mercadería vuelve igual desde Inventario; por eso el mensaje
  del 400 **no** lo atribuye solo a notas anteriores. La devolución se rechaza
  **completa**, no a medias: dejar la porción exenta adentro y la afecta afuera
  partiría el documento sin decírselo a nadie.

  **El movimiento de inventario corre solo sobre las líneas de devolución que
  reponen.** La de ajuste cuelga de un `servicio` y `registrarMovimiento` rechaza
  con 400 todo lo que no sea producto: sin ese corte, agregar la línea de ajuste
  haría fallar el reembolso entero. Desde el 2026-09-04 se agrega el filtro por
  `reponeStock`, porque una línea se puede acreditar sin volver al stock.

  ⚠️ **Y por eso el tope por cantidad dejó de contar solo movimientos.** Mientras
  toda línea aceptada movía stock, el movimiento ERA el rastro de la unidad; con
  líneas que se acreditan sin reponer, ese contador se quedaba ciego y dos notas
  seguidas podían acreditar la misma receta —el documento afirmando que volvieron
  2 unidades de una venta de 1—. El tope por porción no lo tapa: mira plata, no
  cantidad. Hoy `unidadesComprometidasPorItem` toma, **por documento**, el mayor
  entre lo acreditado en líneas y lo movido en stock (mayor y no suma: la línea
  que repone deja las dos huellas).
- **El ítem de sistema "Ajuste"** (`items.es_ajuste_nota_credito`, único vivo por
  tenant vía índice parcial): `venta_detalles.item_id` es NOT NULL, así que la
  línea de ajuste necesita colgar de algún ítem, y tiene que ser un `servicio`
  porque solo `tipo='producto'` tiene stock. Se siembra al crear el tenant, se
  excluye de todos los listados del catálogo y `remove()` lo rechaza. La NC lo
  pide con **find-or-create**: el webhook de reembolso no puede perder un evento
  ya consumado porque falte un dato de configuración.
- La aritmética vive aparte, pura y testeable sin Postgres:
  `ventas/nota-credito-composicion.ts`.
- `VentasService.crearNotaCredito`
  (`ventas.service.ts`): transacción propia con `FOR UPDATE` sobre la venta
  original (serializa NCs concurrentes). Validaciones: Σ(NCs) ≤ `total_final`;
  cantidad devuelta ≤ vendida − ya devuelta —contando lo acreditado por las notas
  hijas y no solo los movimientos de stock, porque desde el 2026-09-04 una línea
  se puede acreditar sin reponer—; y la política de reposición del camino
  (`validarDevolucionesReembolso`): la nota manual rechaza solo si se PIDE
  reponer lo que no puede y la nota por webhook nunca rechaza (un throw pierde el
  evento).
- **Borde de módulos**: `ReembolsoCallbackRegistry` en pasarela (mismo patrón §13
  que `PagoCallbackRegistry`); `VentasReembolsoHandler` (módulo ventas) se
  registra en `onModuleInit`. La pasarela nunca importa ventas.
- **Hook post-commit**: `CobrosService.reembolsar` dispara el handler DESPUÉS del
  commit de la transacción del reembolso (dentro se auto-bloquearía con el
  `FOR UPDATE` de la orden y un fallo de la NC revertiría un reembolso ya
  ejecutado por el proveedor). Corre para **todo** REFUND aprobado de una orden con
  venta, pida devoluciones o no.
- **El vínculo REFUND → corrección** (2026-10-02): el handler **no** toca
  `pasarela_transacciones`; devuelve `{ correccionVentaId }` y `CobrosService`, que es
  dueño de esa tabla, lo escribe con `TransaccionesService.vincularCorreccion`: un
  `UPDATE` chico, filtrado por `tenant_id` y por el `transaccion_id` del REFUND, que
  escribe una sola vez (`correccion_venta_id IS NULL`) y no toca `estado` ni nada de lo
  que informó la pasarela. Es lo único que se escribe sobre una fila ya registrada: el
  vínculo nace **después** del commit del REFUND porque la corrección la crea el hook. El
  evento (`ReembolsoAprobadoEvento`) no lleva el id del REFUND: el handler no lo necesita.
  `vincularCorreccion` devuelve si ligó una fila: si no (error o `affected != 1`) la respuesta
  trae `notaCreditoId` **y** `warning`, y queda en el log — un REFUND sin vínculo nunca es
  silencioso.
- **Usuario `null` por la llave de API**: la ruta m2m no tiene usuario, así que el evento y
  `CrearNotaCreditoParams.usuarioId` son `string | null`. Solo lo consume el movimiento de
  stock (`movimientos_inventario.usuario_id`, uuid nulo); mover caja exige usuario y esa rama
  no corre para la vía `pasarela` (`documentoQueCorrige` devuelve `mueveCaja: false`; la rama
  rechaza un usuario nulo por si acaso). Antes iba `''`: el INSERT fallaba (22P02) y la
  corrección entera se perdía.
- **El `warning` no filtra texto de la base**: al cliente —también el de la llave de API— solo
  llega el mensaje de una `HttpException` (un motivo de negocio, p. ej. "no se puede emitir una
  nota sobre otra nota"); cualquier otro error da un texto fijo y el detalle queda en el log.
- `devoluciones` del DTO tiene tope de 200 líneas (`@ArrayMaxSize`), el mismo que las líneas
  de una compra.
- Índices nuevos: `pasarela_ordenes(venta_id)`, `pasarela_transacciones(orden_id)`
  (para el agregado de REFUNDs del listado de ventas).

## Cuál fila es la nota de crédito la dice el catálogo, no el código (2026-09-03)

`tipos_documento_tributario` lleva **`es_nota_credito`**, y el flujo de reembolso
resuelve `tenant → provincia → país → la fila marcada de ese país`. Sin ese tipo,
una corrección **con documento** se rechaza con 400 (la devolución interna no lo
necesita: lleva el tipo nulo). El tipo **ya no sirve para reconocer** una corrección
—los topes, el listado y los resúmenes miran `venta_referencia_id`—, solo para
**escribirlo** en la fila de la NC.

**El bug que esto cierra.** Hasta esa fecha el id salía de una constante
`TIPO_DOCUMENTO_NC_ID` con la fila **chilena código 61**, y se usaba sin mirar el
país: una devolución en un tenant argentino congelaba un documento chileno.
[ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) es explícito en que lo
que se congela en la transacción es justo lo que después no se corrige.

**Qué se sembró y qué no.** Chile mantiene sus documentos de verdad (39/33/61).
De Argentina, Colombia y México se sembró **solo la nota de crédito interna** —sin
código tributario, `activo: false`, sin emisión—, que no es un documento
tributario sino el marcador que el reembolso necesita. Qué emite un local en esos
países entra cuando abra el frente fiscal de cada uno, que el owner decidió que va
a ser **progresivo** (2026-09-03). Relevamiento de las cuatro autoridades:
[`agent/investigaciones/2026-09-03-facturacion-electronica-latam.md`](../agent/investigaciones/2026-09-03-facturacion-electronica-latam.md).

⚠️ **Los resúmenes excluyen las correcciones por `venta_referencia_id IS NULL`**, no por
el tipo: la devolución interna no lo lleva y, filtrando por tipo, se sumaría como una
venta más con signo positivo. Sin tipo que comparar tampoco existe el caso "el país no
lo tiene": el filtro nunca se cae (el hueco que tenía el `IS DISTINCT FROM NULL`, que
dejaba afuera toda venta sin tipo, desapareció con él). Lo fijan `test/venta-correcciones.e2e-spec.ts`
y el spec de `VentasService.resumen`.

## Una corrección lleva su documento, según por dónde vuelve la plata (2026-10-02)

Spec `emision-por-venta` § 3.6, [ADR-028](../adr/028-emision-registrada-por-venta.md). Una
corrección sigue siendo una fila de `ventas` compuesta como siempre; lo nuevo es **su
documento** (`venta_documentos`), que sale de **qué documento corrige**, y eso lo decide el
usuario diciendo **por dónde vuelve la plata**: uno de los pagos de la venta, o "no vuelve
plata". El cliente nunca manda el documento ni quién emitió.

| El documento corregido lo emitió… | La corrección lleva | `tipo_documento_id` de la fila |
|---|---|---|
| el sistema | NC `sistema` / `armado`, con baldes de **sus propias líneas** | el tipo NC del país |
| la máquina | NC `maquina` sin número (la hace la máquina y el sistema la anota) | el tipo NC |
| otro facturador | NC `externo` sin número, con baldes | el tipo NC |
| nadie | **devolución interna**: fila `nadie` | **nulo** |

**Qué documento corrige cada vía** (`VentaDocumentosService.documentoQueCorrige`, una sola
resolución que comparten la creación de la nota y las `opcionesDevolucion` del detalle):

- **Un pago** (`devolucion: { pagoId }`): el documento al que **ese pago está enlazado**
  (`pagos.documento_id`, que tiene que ser de **esa venta y de ese tenant**: un `pagoId` ajeno o
  inexistente es el mismo 400). Se escribe en la misma transacción que el pago: al cobrar, el pago
  de la máquina lleva su voucher, los del `sistema` la boleta (o la factura), los de `nadie` la fila
  nadie, y en una factura u online todos el único documento; al abonar, **el pago del abono lleva
  el documento de la deuda** (el hecho por fuera si lo hay, si no la boleta del sistema o la
  factura), **nunca** el voucher duplicado (E1b). Se **enlaza y no se infiere** porque el emisor de
  un medio puede cambiar entre la venta y el reembolso: el reembolso sigue corrigiendo el documento
  que de verdad cubrió ese pago. Un pago sin enlace en una venta con documentos (el que fue todo
  propina, o una venta anterior a este enlace) no se adivina: 400.
- **"No vuelve plata"** (`devolucion: { sinPlata: true }`): solo con saldo (400 si no), y corrige
  el documento de lo **no pagado**: la boleta del sistema, el hecho por fuera o la factura.
  Nunca una devolución interna. **No pasa del saldo** que la venta todavía debe: total − lo
  aplicado − **lo ya rebajado sin plata por correcciones anteriores** (`ventas.devolucion_via =
  'sin_plata'`), bajo el mismo lock. Es una **serie**: con abonos el saldo puede ser menor que
  el documento de lo debido, y sin restar lo rebajado dos notas "sin plata" rebajarían 60.000
  sobre una deuda de 40.000. Las notas que volvieron por un pago (o por la pasarela) no lo
  tocan: devolvieron plata por fuera y la deuda sigue igual. El 400 no dice ningún monto. Un solo
  cálculo (`corregibles`) decide el tope y si el modal la ofrece. Cada corrección deja anotado
  por dónde volvió la plata (`devolucion_via`, `devolucion_pago_id`), que además es la auditoría
  de ese dato.
- **Si el pago es en efectivo** (`metodos_pago.es_efectivo`) la plata sale de la caja física,
  con sus dos topes de siempre; **si no**, no se mueve caja (la reversa se hace en la máquina o
  en el banco). Es por **pago** y no por "efectivo": hay máquinas que emiten también el
  efectivo, y una venta puede tener dos pagos en efectivo. La vía `pasarela` (el reembolso de
  una orden) **nunca** mueve caja y **nunca rechaza**: la plata ya volvió por el proveedor y un
  hecho consumado se registra. No mira los pagos de la venta (`CobrosService.vincularVenta` liga
  una orden a cualquier venta): corrige el **único documento válido** de la venta (vigente y no
  duplicado); con ninguno, o con más de uno (inalcanzable hoy: online y factura son un solo
  documento, y queda un `warn` con la venta y la orden), la corrección sale sin fila de
  documento, con el tipo NC, como siempre. Una orden ligada a una corrección sí falla (no se
  corrige una corrección) y la pasarela lo devuelve como `warning`. Una venta que **nunca tuvo documentos** (país sin boleta) se corrige como siempre,
  con el tipo NC y sin fila de documento.

**Los topes.** Los dos de hoy (el total de la venta y el efectivo) más **uno por documento**: lo
corregido de un documento no pasa su `monto`, bajo el mismo lock. Todos cuentan **toda corrección**
(`venta_referencia_id`), la devolución interna incluida: la que sacó efectivo cuenta en el tope
del efectivo, y la que acreditó una porción fiscal cuenta en la composición por porción. El
mensaje del tope por documento no interpola ningún número (la fuga 5 del modo ciego sigue
cerrada). `exigirTipoNotaCredito` ya no corre al abrir la transacción: solo si la corrección
lleva el tipo.

## Redondeo: la NC hereda el criterio del documento que corrige (2026-08-21)

**La regla.** Una NC no redondea con las preferencias vigentes del tenant: lee el
`config_calculo` **congelado en la venta original** —escala de la moneda y modo de
redondeo— y cuantiza con ése. Después **congela el suyo propio**, copiando ese mismo
snapshot en la NC, para que pueda leerse sola sin ir a buscar la venta que corrige.

**Por qué.** La NC corrige *aquel* documento. Si el admin cambió el `modo_redondeo` de
`FLOOR` a `HALF_UP` entremedio, una NC que use el criterio de hoy puede no cuadrar contra
la venta que dice anular. El congelado es la misma idea de
[ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) aplicada al redondeo, y usa la
misma función `cuantizar()` del motor de precios — no una fórmula propia, que derivaría en
silencio el día que el helper cambie.

### La excepción del webhook: un hecho consumado se registra, no se rechaza

Desde el frente de redondeo, la plata que **una persona** ingresa por API se **rechaza con
400** si trae más decimales de los que la moneda admite (ver
[backend.md](../patterns/backend.md)). **El callback de reembolso de la pasarela queda
afuera de esa regla, a propósito.**

| | Camino manual (`POST /ventas/:id/notas-credito`) | Callback de la pasarela |
|---|---|---|
| Qué es el monto | Una **intención** que se puede corregir | Un **hecho consumado**: la plata ya volvió al cliente |
| Decimales de más | **400** — el cajero corrige y reintenta | **Se cuantiza** y se sigue |
| Sin `config_calculo` en la venta | **400 ruidoso** — algo se rompió aguas arriba | Se persiste sin cuantizar antes que perder el evento |
| Traza | El error mismo | `logger.warn` con el **número original** que informó la pasarela |

**Rechazar el callback no deshace el cobro: solo pierde el evento.** El reembolso ya
ocurrió del lado del proveedor, así que un 400 dejaría el sistema sin registro de plata que
sí se movió, y sin NC que la explique. Por eso se cuantiza —con el criterio congelado en la
venta, no con el vigente— y se deja en el log el valor exacto que llegó, para poder
reconstruirlo después. Si el monto ya venía bien no se loguea nada.

⚠️ Esto es también por qué el guard de `config_calculo` faltante vive **detrás** de
`validarVentaElegible`: ese flag solo lo manda el camino manual. Un guard incondicional
haría que el webhook perdiera exactamente el evento que esta excepción protege.

Dónde vive: `VentasReembolsoHandler.cuantizarMontoReembolso`
(`ventas/reembolso-callback.handler.ts`) y el cierre de línea de
`VentasService.crearNotaCredito`.

## Frontend

- `ordenes/ReembolsoModal.vue`: prop `ventaId`; con venta vinculada muestra la lista
  de líneas (inputs decimales string; máximo = vendida − ya devuelta). **Ya no tiene la
  casilla "Generar nota de crédito"** (2026-10-02): el reembolso siempre deja la nota, y
  el body nunca lleva `generarNotaCredito` (el backend lo rechazaría con 400). Respuesta
  con `warning` → toast warning.
  La lista (`DevolucionInventarioLista`) es compartida con la NC y desde el 2026-10-02 tiene
  un solo modo —acredita cualquier ítem vendido, con switch de reponer por fila—: el modo
  "solo stock" (líneas que no reponen deshabilitadas) y la normalización al destildar la casilla
  existían solo para el camino sin documento, que se eliminó.
- `ventas/VentaDetalleDrawer.vue`: badges "Nota de Crédito" / "Devolución interna" (según
  `esNotaCredito`, dentro de `esCorreccion`) y "Reembolsada parcial/totalmente" (derivados); cards "Reembolsos" y
  "Documentos relacionados" (links venta original ↔ NCs vía `/ventas?venta=<id>`).
  **Sobre una corrección** (2026-09-04; `esCorreccion` desde 2026-10-02: una devolución
  interna no lleva el tipo NC y antes se pintaba como una venta): el rótulo de la tabla dice
  "Líneas de la nota" y cada línea muestra su **porción fiscal** (`afecto` / `exento`) en
  un badge. No es cosmética: las dos líneas de ajuste llevan la misma glosa —la
  que escribió el operador— y sin la porción el documento muestra dos filas
  idénticas con importes distintos. El resto del drawer ya servía sin tocarlo:
  la tabla de líneas con sus reglas congeladas y la fila "Impuestos" de los
  totales existían desde antes.
- `ventas/NotaCreditoModal.vue` (2026-09-04; umbral exacto 2026-09-14; **"¿Por dónde vuelve la
  plata?" 2026-10-02**): la casilla "devolver dinero" se reemplazó por un selector con una opción
  por pago (*"Efectivo · $60.000"*, *"Tarjeta de débito · $40.000"*) y "No vuelve plata" solo
  si el backend la mandó (hay saldo), todo de `opcionesDevolucion`. Con varias opciones no viene
  ninguna elegida (un default movería plata de la caja sin decisión); con una sola, sí. Debajo,
  en una línea, **qué registro va a quedar** (`registro` del backend: nota de crédito del
  sistema, de la máquina, hecha por fuera o devolución interna). La opción en efectivo no se
  puede elegir sin caja física abierta. El body lleva `devolucion`, nunca el documento. Además muestra el
  **disponible por porción fiscal** debajo del total —solo si hay más de una: en
  una venta toda afecta repetir el total es ruido—, un **switch de reponer por
  fila** (deshabilitado con su nota en lo que no puede volver al stock) y **pide
  el motivo** cuando lo marcado vale más que el monto.
  ⚠️ **Pide, nunca bloquea**: el único guard sigue siendo el backend. Pero desde
  el 2026-09-14 esa cuenta es un **gemelo exacto** de la del backend, no una
  aproximación: `useDevolucionInventario.valorDevueltoCuantizado` valúa cada
  línea a `Σ total_linea / Σ cantidad` (dividiendo antes de multiplicar, mismo
  orden que `ventas.service.ts` — el orden vive ahí, no en el motor de
  cálculo) y la **cuantiza con la escala y el `modo_redondeo`
  congelados de esa venta** (`venta.configCalculo`, que ahora viaja hasta el
  modal con `decimalesMoneda` incluido), por línea y antes de sumar — igual que
  el backend. La comparación es `>` estricto, gemela de `seEscalo` en
  `ventas.service.ts`, no `≥`: el margen que compensaba la falta de
  cuantización ya no hace falta. En una venta sin `config_calculo` congelada el
  resultado queda sin cuantizar, pero no cambia nada: el único camino que arma
  este modal fija `validarVentaElegible: true`, y con eso el backend rechaza
  cualquier nota manual sobre esa venta antes de llegar a valuar algo. Cierre
  medido en `docs/agent/resueltos.md`.
- `pages/ventas/index.vue`: badges "NC" / "Dev. interna" (por `esCorreccion`/`esNotaCredito`)
  / "Reemb. parcial" / "Reembolsada" junto al estado.

## NC manual desde el detalle de venta (2026-07-11)

```
POST /api/ventas/:id/notas-credito
Authorization: Bearer <JWT>   (permiso dedicado Ventas:Nota de crédito)

Request:  { "monto": "5000", "comentario": "...",
            "devolucion": { "pagoId": "uuid" } | { "sinPlata": true },   // obligatoria, exactamente una
            "devoluciones": [{ "itemId": "uuid", "cantidad": "1" }] }
Response 201: { "id": "<uuid NC>", "totalFinal": "5000.0000",
                "movimientoCajaId": "<uuid>" | null }
```

- Elegibilidad: venta `pagada`/`pagada_parcial` de cualquier canal, nunca sobre
  otra corrección (`venta_referencia_id`). La venta original no cambia de estado.
- `devolucion` dice por dónde vuelve la plata (ver la sección de arriba): de ahí sale el
  documento que corrige. Un body con `devolverDinero` (la casilla de antes) es 400.
  Con un **pago en efectivo**: movimiento `salida` ("Devolución · Nota de crédito") en la
  caja física abierta del usuario, en la **misma transacción** que la NC
  (todo-o-nada; valida saldo suficiente). Sin caja o sin saldo → 422.
- **Tope de la devolución en efectivo (2026-07-27):** `Σ(pagos en efectivo aplicados
  a la venta) − Σ(ya devuelto en efectivo por correcciones anteriores)`. El saldo global de la
  caja no alcanza como control: viene de otras ventas, así que sin este tope se puede
  sacar plata que esta venta nunca ingresó, y dar billetes por una compra con tarjeta.
  Excederlo → 422.
  **Acota el dinero, no el documento.** La NC puede seguir emitiéndose por el total
  (tope `total_final − Σ NCs previas`, regla dura del SII): anular una venta cobrada a
  medias es legítimo —borra la cuenta por cobrar—, devolver efectivo que nunca entró no.
  La devolución por el medio de pago original (tarjeta vía Transbank) ya existe en el
  módulo `pasarela` y **no pasa por este camino**; componer ambas patas en una sola
  operación es tema abierto:
  `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md` §6.
- Backend: `VentasService.crearNotaCreditoDesdeVenta` → `crearNotaCredito` con
  `validarVentaElegible` y `via` (`{ tipo: 'pago', pagoId }` | `{ tipo: 'sin_plata' }`); el
  flujo de reembolsos de pasarela llama con `via: { tipo: 'pasarela', documentoId }` (ver
  `viaDeReembolsoPasarela`, que nunca lanza) y no mueve caja.
- Frontend: botón "Nota de crédito" en `VentaDetalleDrawer` +
  `ventas/NotaCreditoModal.vue` (opciones de `opcionesDevolucion`; la de efectivo se
  deshabilita sin caja abierta — `GET /caja/activa`; devolución de stock igual al
  `ReembolsoModal`).
- La lógica de devolución a inventario compartida entre `NotaCreditoModal` y
  `ReembolsoModal` vive en `composables/useDevolucionInventario.ts` (helpers
  puros con spec Vitest: agrupación por ítem, validación, payload) + el
  componente presentacional `components/DevolucionInventarioLista.vue`.
- Spec: `docs/superpowers/specs/2026-07-11-nota-credito-pos-design.md`.

## Testing

- `venta-correcciones.e2e-spec.ts` (2026-10-02): el documento de cada vía —el pago en
  efectivo y el de tarjeta de un pago mixto, "no vuelve plata" sobre la mesa que debe, el pago
  de un abono con tarjeta, la factura, el efectivo emitido por la máquina—, la devolución interna
  (tipo nulo, cuenta en los tres topes, no suma a `/ventas/resumen` ni al dashboard), el tope por
  documento, `opcionesDevolucion` y que cada opción crea la nota que anunció, y los 400 del
  `devolucion` mal formado o con un `pagoId` ajeno.
- `ventas.service.spec.ts`: crearNotaCredito (composición por monto libre y con
  devoluciones, validaciones de monto/cantidades/modo/tenant, la original no se
  toca), findOne/listar/resumen con los campos nuevos.
- `nota-credito-composicion.spec.ts`: la aritmética sola —tasa efectiva,
  descomposición por resta, reparto del ajuste y **el escalado de las líneas de
  devolución**— con `decimalesMoneda: 0`, que es la escala que más residuo
  produce.
- `nota-credito-composicion.e2e-spec.ts`: el camino de la app sobre una venta
  mixta real — dos líneas y totales derivados, el corte de inventario en la línea
  de ajuste, la proporción tomada del remanente con una NC previa, el
  find-or-create del ítem de sistema y, desde el 2026-09-04: **la receta
  acreditada por línea sin mover inventario**, `reponerStock: false`, el
  **escalado** con su motivo obligatorio, la línea que queda en cero y no se
  escribe, el tope por porción sobre las líneas ya escaladas, y el disponible por
  porción —también sobre un documento que no admite nota—.
- `nota-credito-por-pais.e2e-spec.ts`: la forma del catálogo de documentos.
- `reembolso-callback.handler.spec.ts`: registro en el registry y delegación; todo
  reembolso crea la corrección, también el que no trae devoluciones.
- `cobros.service.spec.ts`: hook post-commit (evento completo, la corrección se liga
  al REFUND, warning sin revertir —con la corrección sin ligar—, rechazado no dispara,
  orden sin venta sin aviso, sin handler, usuario `null` por la llave de API, el texto de un
  error que no es de negocio no llega al cliente, un vínculo que no tocó fila no es silencioso).
- `transacciones.service.spec.ts`: `vincularCorreccion` acotado al tenant, escribe una vez y
  devuelve si ligó una fila.
- `create-reembolso.dto.spec.ts`: validación anidada del DTO y el tope de 200 `devoluciones`.
- `pasarela-reembolso.e2e-spec.ts` (2026-10-02): por la API real, con el proveedor doblado:
  el REFUND aprobado sin devoluciones deja la nota sobre la boleta y `correccion_venta_id`;
  dos reembolsos parciales, cada uno con su nota; `generarNotaCredito` da 400 por la ruta del
  admin y por la de la llave de API; la orden sin venta se reembolsa sin nota ni aviso; y la
  corrección que falla deja el REFUND aprobado, sin vínculo y con `warning`; y, por la llave de
  API, una devolución que repone stock de un producto propio: la nota sale, el REFUND queda
  ligado y el movimiento de stock queda con `usuario_id` NULL (por la ruta del admin lleva el
  usuario del token).
- `ReembolsoModal.nuxt.spec.ts`: sin casilla, y el body no lleva `generarNotaCredito`.

## Referencias

- Spec: `docs/superpowers/specs/2026-07-10-reembolso-nc-visibilidad-design.md`
- Plan: `docs/superpowers/plans/2026-07-10-reembolso-nc-visibilidad.md`
