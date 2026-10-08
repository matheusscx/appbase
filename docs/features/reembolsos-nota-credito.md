# Feature: Reembolsos — visibilidad en ventas + Nota de Crédito interna

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-04 ("Generar nota" para el REFUND que quedó sin nota)

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
  línea. Cualquier ítem vendido se acredita, y en la línea con stock de por medio
  hay que decir si lo devuelto **se recupera o se pierde** (2026-10-04, ver
  [abajo](#se-recupera-o-se-pierde-2026-10-04)). Las devoluciones de stock viajan
  **dentro** de la corrección: ya no existe el camino que solo mueve inventario sin
  documento.

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
  Inventario), ni la merma de serie/lote cuando se pierden; egreso en el ledger de
  `pagos`; devolución de dinero por el método de pago original (el egreso es
  efectivo de caja).

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
    { "itemId": "uuid", "cantidad": "2", "stock": "recupera" }   // "stock": ver más abajo
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
  revierte** (la plata ya volvió por el proveedor): la respuesta trae `warning` (sin
  `notaCreditoId`), el error queda en logs con la orden y el REFUND, y el REFUND queda
  **sin** `correccion_venta_id`. Eso —un REFUND aprobado de una orden con venta y ese
  campo nulo— es la señal de que falta la corrección. Que no se pueda ligar al REFUND
  cuenta como que la corrección falló: se revierte con el vínculo (ver
  "El vínculo REFUND → corrección" en [Backend](#backend)). La nota que faltó la genera el
  botón "Generar nota" del drawer de la orden (ver
  [abajo](#generar-nota-un-refund-aprobado-que-quedó-sin-nota-2026-10-04)).
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
  (`{ pagoId | null, sinPlata, metodo, monto, sinConfirmar, mueveCaja, registro }`;
  `sinConfirmar` es lo que un REFUND sin confirmar ya le descontó a `monto`, o `null`). Salen de la
  **misma resolución** que usa la nota al crearse, así que la pantalla ofrece lo
  que el servidor acepta y no replica la regla. Vacío en una corrección o en una
  venta que no admite nota.
- `detalles[]`: + `itemId`, `modoInventario` (`null` = sin fila en `item_producto`:
  servicio, receta o combo), `cantidadDevuelta` y `devolucionStock` (`sin_stock` |
  `recuperable` | `solo_perdida`: qué preguntarle a la línea, ver
  [abajo](#se-recupera-o-se-pierde-2026-10-04)).
- `reembolsos[]`: REFUNDs de las órdenes de pasarela vinculadas
  (`{id, monto, estado, fecha, ordenId, codigoOrden}`).
- `notasCredito[]`: NCs hijas (`{id, totalFinal, fecha, comentario}`).
- `disponibleNotaCredito` (2026-09-04): `{ total, porPorcion: [{clasificacion,
  monto}] }` — cuánto queda por acreditar, en total y por porción fiscal, **en
  cero cuando el documento no admite nota de crédito**. Detalle y su porqué en
  [`ventas.md`](ventas.md).
- El receptor (2026-10-04): `receptorEsEmisor`, `receptorSugerido` y
  `tipoDocumento.rutChileno` — ver [La nota de crédito lleva el receptor](#la-nota-de-crédito-lleva-el-receptor-de-la-venta-que-corrige-2026-10-04).

### GET /ventas (listado)

- `totalReembolsado` (Σ REFUND aprobados de órdenes vinculadas), `esCorreccion` y
  `esNotaCredito`.
- `GET /ventas/resumen` **resta** las correcciones (NCs y devoluciones internas, reconocidas
  por `venta_referencia_id`): no las cuenta como ventas y las descuenta de "Total facturado".
  Del saldo pendiente solo descuenta las que **no devolvieron plata** ("No vuelve plata"): una
  corrección que sí la devolvió no cambia lo que se debe (detalle en [`ventas.md`](ventas.md)).

---

## Backend

- **Corrección** = venta con `venta_referencia_id` → venta original, estado `pagada`,
  caja/canal/moneda copiados de la original. **La venta original no cambia de
  estado por la corrección**, salvo "No vuelve plata", que si deja la deuda en 0 la pasa a
  `pagada`. Su `tipo_documento_id` es la fila "Nota de Crédito" **del país del tenant**
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

  **Cualquier ítem vendido se acredita por línea** (2026-09-04). `devoluciones`
  dejó de significar *"ítems a devolver a stock"* y significa *"ítems que se
  acreditan"*. Antes, nombrar un ítem exigía `modo_inventario = 'cantidad'`, así
  que recetas, combos y servicios no se podían acreditar por línea: caían al balde
  de ajuste y la nota decía *"Ajuste"* en vez del nombre del plato. Qué pasa con
  el stock lo dice desde el 2026-10-04 la respuesta de cada línea (`stock`), con
  una política por camino:

  | Camino | Línea con stock sin respuesta, o con una que no se puede cumplir |
  |---|---|
  | Nota manual (`POST /ventas/:id/notas-credito`) | 400 con el nombre del ítem |
  | Reembolso de pasarela, **antes** de llamar al proveedor (tx0) | el mismo 400: no sale plata ni queda `REFUND` |
  | Nota por el webhook de reembolso (post-commit) | **nunca rechaza**: un throw pierde el evento (`cobros.service.ts` lo traga como warning). Sin respuesta —solo la `metadata` de un `REFUND` anterior a la pregunta— se acredita y no se mueve stock |

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
  dos propios: motivo faltante al escalar, y pedir reponer lo que no puede (hoy:
  la respuesta a "¿se recupera o se pierde?", 2026-10-04)— y
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

  **El movimiento de inventario corre solo sobre las líneas de devolución con
  respuesta.** La de ajuste cuelga de un `servicio` y nunca mueve stock.

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
  se puede acreditar sin reponer—; y la respuesta de cada línea con stock
  (`validarDevolucionesReembolso`, ver [¿Se recupera o se pierde?](#se-recupera-o-se-pierde-2026-10-04)):
  la nota manual y el reembolso antes del proveedor rechazan, la nota por webhook
  nunca (un throw pierde el evento).
- **Borde de módulos**: `ReembolsoCallbackRegistry` en pasarela (mismo patrón §13
  que `PagoCallbackRegistry`); `VentasReembolsoHandler` (módulo ventas) se
  registra en `onModuleInit`. La pasarela nunca importa ventas.
- **Hook post-commit**: `CobrosService.reembolsar` dispara el handler DESPUÉS del
  commit de la transacción del reembolso (dentro se auto-bloquearía con el
  `FOR UPDATE` de la orden y un fallo de la NC revertiría un reembolso ya
  ejecutado por el proveedor). Corre para **todo** REFUND aprobado de una orden con
  venta, pida devoluciones o no.
- **El vínculo REFUND → corrección** (2026-10-02): el handler **no** toca
  `pasarela_transacciones`. `CobrosService`, que es dueño de esa tabla, le pasa en el
  evento cómo ligar (`ReembolsoAprobadoEvento.ligarCorreccion`), y el handler se lo da a
  `crearNotaCredito` como `enLaTransaccion`: corre **dentro de la transacción de la
  corrección, con su `manager`, antes del commit**. Escribe con
  `TransaccionesService.vincularCorreccion`: un `UPDATE` chico, filtrado por `tenant_id` y
  por el `transaccion_id` del REFUND, que escribe una sola vez (`correccion_venta_id IS
  NULL`) y no toca `estado` ni nada de lo que informó la pasarela. Es lo único que se
  escribe sobre una fila ya registrada: el vínculo nace **después** del commit del REFUND
  porque la corrección la crea el hook. Si el `UPDATE` falla o no liga ninguna fila
  (`affected != 1`), `ligarCorreccion` lanza y **la corrección se revierte con él**: quedan
  dos estados, ligada o sin corrección, y nunca el tercero. **Por qué** (cerrado el
  2026-10-02): con el `UPDATE` suelto, después del commit de la corrección, un vínculo
  fallido dejaba la corrección **y** el REFUND sin ligar, y el tope del pago único
  (`devolvibleDelPagoUnico`) restaba las dos — los $30.000 que quedaban de una venta de
  $100.000 con un REFUND de $70.000 no salían ni por el POS ni por la pasarela.
- **Usuario `null` por la llave de API**: la ruta m2m no tiene usuario, así que el evento y
  `CrearNotaCreditoParams.usuarioId` son `string | null`. Solo lo consume el movimiento de
  stock (`movimientos_inventario.usuario_id`, uuid nulo); mover caja exige usuario y esa rama
  no corre para la vía `pasarela` (`documentoQueCorrige` devuelve `mueveCaja: false`; la rama
  rechaza un usuario nulo por si acaso). Antes iba `''`: el INSERT fallaba (22P02) y la
  corrección entera se perdía.
- **El `warning` no filtra texto de la base**: al cliente —también el de la llave de API— solo
  llega el mensaje de una `HttpException` (un motivo de negocio, p. ej. "no se puede emitir una
  nota sobre otra nota"); cualquier otro error da un texto fijo y el detalle queda en el log.
- `devoluciones` del DTO tiene tope de 500 líneas (`@ArrayMaxSize`), como la nota manual: ver
  el contrato de abajo. Hasta el 2026-10-08 era 200, el de las líneas de una compra.
- Índices nuevos: `pasarela_ordenes(venta_id)`, `pasarela_transacciones(orden_id)`
  (para el agregado de REFUNDs del listado de ventas).

## ¿Se recupera o se pierde? (2026-10-04)

Decisión del owner (2026-08-23, en [`resueltos.md`](../agent/resueltos.md) § *"La nota de crédito
miente distinto sobre la misma línea de receta"*): al hacer la nota, el sistema **pregunta siempre
que haya stock de por medio** —el producto suelto, la receta, el combo— si lo devuelto se recupera
o se pierde. Una hamburguesa ya armada no vuelve a ser pan y carne, una que nunca salió de la
cocina sí; y la botella puede volver rota. Spec:
[`2026-10-04-nc-recupera-o-pierde-design.md`](../superpowers/specs/2026-10-04-nc-recupera-o-pierde-design.md).

**El contrato** — una línea de `devoluciones`, igual en la nota manual (`DevolucionNotaCreditoDto`)
y en los dos `POST …/reembolsos` de la pasarela (`DevolucionLineaDto`); es el que reusa el botón
"Generar nota" de un `REFUND` sin nota:

```jsonc
{ "itemId": "uuid", "cantidad": "1", "stock": "recupera" | "pierde" }
```

| La línea… (`detalles[].devolucionStock` del detalle) | `stock` |
|---|---|
| no sacó nada del inventario: servicio, o receta cuyos ingredientes no salieron (`sin_stock`) | **prohibido**: 400 *"no sacó nada del inventario"* |
| sacó solo inventario por `cantidad` (`recuperable`) | **obligatorio**: `recupera` o `pierde`; sin él, 400 *"Falta decir si «X» se recupera…"* |
| sacó algo de serie o lote (`solo_perdida`) | **obligatorio**; `recupera` es 400 (la vuelta va por Inventario) |

`stock: null` es 400 siempre (lo rechaza el DTO); ausente es 400 solo en la línea con stock. El campo de antes, `reponerStock`, ya no existe: el pipe lo rechaza.

**Hasta 500 líneas** en los tres DTOs (`@ArrayMaxSize(MAX_LINEAS_POR_VENTA)`; la 501 es 400 del pipe): se acepta
una línea por ítem distinto de la venta (repetido es 400), y una venta tiene a lo sumo 500 líneas
(`CreateVentaDto.lineas`). Con menos, el tope cortaba una nota válida: medido el 2026-10-08, una
venta con 201 ítems distintos se devolvía entera con 201 líneas. El peor caso, 500 productos con
`pierde` (1000 movimientos de inventario), tardó ~1,5 s. Decidido por la Sesión de esfuerzo
máximo (2026-10-08), por construcción. Vale también para la venta de una cuenta de salón, que se
crea sin pasar por `CreateVentaDto`: la cuenta tiene el mismo tope de líneas desde el 2026-10-08
([salones-mesas.md](salones-mesas.md) § Tope de líneas de una cuenta).

**Qué devuelve una línea: lo que salió por ella.** La misma fuente que revierte `cancelar` —el
kardex de la venta, motivo `venta`— acotada a las líneas devueltas: desde el 2026-10-04 cada salida
de una venta lleva su línea (`movimientos_inventario.venta_detalle_id`), también la de cada
ingrediente, componente y opción. Por cada ítem que salió por las líneas del ítem devuelto vuelve
`r4(salido·(R+q)/V) − r4(salido·R/V)` (`cantidadADevolver`: `V` vendidas, `R` ya acreditadas, `q`
devueltas), así una serie de notas parciales suma exacto lo que salió. El producto suelto vuelve tal
cual (`q`). Un ingrediente no bloqueante que se vendió sin stock no vuelve: nunca salió. Una receta
o un combo vendidos antes de la columna no tienen salidas ligadas: no preguntan ni mueven nada.
⚠️ Mientras la nota devuelva **por ítem** y no por línea, dos líneas del mismo ítem personalizadas
distinto (una hamburguesa sin queso y otra con) **se promedian**: vuelve la proporción de lo que
salió por las dos. Las vueltas llevan en `venta_detalle_id` la **primera línea vendida del ítem**,
y es la que miran las dos lecturas (`salidasPorItemVendido` y el contador).

**La respuesta queda guardada** en la `metadata` del `REFUND`, escrita en tx0: la leen quien crea
la nota después —el hook, el aclarado por saldo, el admin que marca *Salió* y "Generar nota", que
la precarga—, y nadie vuelve a preguntar ni a deducir.

**Cómo se decidió:** la pregunta, sus dos destinos, la causa fija y el costo de la vuelta son del
owner (2026-08-23, 2026-09-29 y 2026-08-15); el resto —la causa fija y solo de la nota, el par al
mismo costo sin promediar, la columna de la línea con su reparto, el contrato, la frontera de serie y
lote, sin default en pantalla y el find-or-create sin adoptar un motivo propio— fue decidido por la Sesión de esfuerzo máximo (2026-10-04), derivado de las decisiones del owner.

| Respuesta | En el kardex, por ítem que salió (solo `cantidad`) |
|---|---|
| **Se recupera** | entrada `devolucion` al costo con que salió; el CPP se recalcula (como al anular) |
| **Se pierde** | entrada `devolucion` + salida `merma` con la causa fija **"Devolución"**, **las dos al costo con que salió**; la entrada **no promedia** (`sinPromediar`, y `costo_informado` en falso para que "rehacer la cuenta" tampoco). Stock neto cero, CPP intacto |

Los dos movimientos llevan `venta_id` = la nota y `venta_detalle_id` = la línea vendida que
revierten. Por qué el mismo costo y sin promediar: con el CPP de hoy congelado en la entrada y el de
la salida en la merma, varianza vería el teórico en 0 unidades pero con plata; y promediada, la
entrada arrastraría el CPP del stock que queda hacia un costo que no volvió. La merma la ven el
reporte de mermas, el "Pérdidas" del Inicio y el costo de la baja del kardex como cualquier otra ([`mermas-valorizadas.md`](mermas-valorizadas.md)). Serie y lote: *se recupera* sigue
afuera (Inventario) y *se pierde* no mueve nada —la unidad ya está vendida—; un combo con un
componente en lote mueve solo lo que es `cantidad`.

**La nota guarda lo que devolvió** (`ventas.devoluciones`, `jsonb`: `[{ itemId, cantidad, stock }]`
tal como se aceptó, también lo que quedó fuera del documento, y `[]` si no devolvió nada), y el
contador de unidades ya devueltas (`unidadesComprometidasPorItem`) suma de ahí, sin mirar líneas ni
movimientos. Antes reconstruía "qué devolvió cada nota" desde esas dos proyecciones, que pierden
datos: una receta escalada a $0 fuera del documento (o la porción agotada del webhook) devolvía sus
ingredientes sin dejar línea, y un celular con serie que "se pierde" no deja ni línea ni movimiento,
así que la misma unidad podía volver dos veces (lo levantó la revisión independiente). Una nota
anterior al 2026-10-04 (`NULL`) se sigue contando por sus huellas, como entonces. De paso queda
registrado lo que contestó el cajero, que para serie y lote no quedaba en ningún lado. Decidido por
la Sesión de esfuerzo máximo (2026-10-04); técnico.

**La pantalla** (`DevolucionInventarioLista`, compartida por `NotaCreditoModal` y `ReembolsoModal`):
por línea con stock, *Vuelve al stock* / *Se perdió*, **ninguna elegida de antemano** (los dos
destinos son comunes y un default se confirmaría sin mirar); *Vuelve al stock* deshabilitada en
serie/lote, y Confirmar deshabilitado mientras falte una respuesta.

## Generar nota: un REFUND aprobado que quedó sin nota (2026-10-04)

Si la corrección de un `REFUND` aprobado falla (el tope global, el del documento, un país sin tipo
NC, un error de base), la plata ya volvió por Transbank y la boleta queda sin corregir. **Decidido
(owner, 2026-10-02):** el historial de la orden lo marca *"Sin nota de crédito"* y un botón
**"Generar nota"** emite la corrección por el monto de ese `REFUND`. Descartados: dejarlo a soporte
y el reintento automático (la app no repite sola lo que falló). Spec:
[`2026-10-04-generar-nota-de-refund-sin-nota-design.md`](../superpowers/specs/2026-10-04-generar-nota-de-refund-sin-nota-design.md).

```
POST /api/pasarela/admin/ordenes/:id/reembolsos/:transaccionId/nota
Authorization: Bearer <JWT>          (Pasarelas:Reembolsar)
Idempotency-Key: <uuid por intento>  (obligatoria)

Request:  { "devoluciones": [{ "itemId": "uuid", "cantidad": "1", "stock": "pierde" }] }   // opcional
Response 201: { ...orden pública, "reembolso": {...}, "notaCreditoId": "uuid", "repetida"?: true }
```

- **El monto no viaja y el proveedor no se llama.** Es el del `REFUND`, cuantizado como en el hook.
  Solo la ruta del admin (la API externa no tiene drawer).
- **Un solo camino con el hook:** `CobrosService.corregirReembolso` arma el evento —con
  `ligarCorreccion`— y **lanza**; el hook lo envuelve en `aplicarPostReembolso`, que degrada a
  `warning` (allá la plata ya volvió y el evento no se puede perder), y el botón deja subir el
  error (acá no hay nada consumado: el admin corrige y reintenta). Lo demás es lo del hook: vía
  `pasarela` (sin caja, anota el pago único), el comentario *"NC por reembolso orden X"*, el
  escalado sin motivo obligatorio y la porción agotada fuera del documento.
- **Las líneas** se precargan de lo que declaró el reembolso (`metadata.devoluciones`, que
  `GET /pasarela/admin/ordenes/:id` publica por transacción junto con `correccionVentaId`) y se
  pueden editar. **Solo la ruta del admin los publica** (`obtenerOrden(…, { vistaAdmin: true })`):
  la de la llave de API (`GET /pasarela/api/ordenes/:id`) es un contrato externo, y un campo entra
  ahí por decisión propia, no de arrastre de una pantalla (Sesión de esfuerzo máximo, 2026-10-06,
  técnico, a partir del hallazgo del revisor de seguridad). Las líneas se pueden editar: desde el reembolso pudo entrar otra nota que devolvió esas unidades. El servidor
  las revalida con la regla de la nota manual (`'rechazar'`) bajo el lock de la venta.
- **Solo un `REFUND` aprobado** de una orden con venta: el sin confirmar se aclara en su tarjeta
  (*Volver a consultar / Salió / No salió*) y deja su nota ahí; uno rechazado es 400, uno de otra
  orden 404.

**Una nota por intento** ([ADR-026](../adr/026-idempotencia-de-cobros.md): el efecto está entero
en la base, así que es `ejecutar`, no el `ejecutarConEfectoExterno` del reembolso). La clave viaja
en el evento (`idempotencia`, operación `pasarela.generarNota`) y la nota la reclama como primera
sentencia de su transacción, dentro del loop de deadlock. La huella es la orden, el `REFUND` y las
líneas normalizadas y ordenadas. Contrato visible, el del gemelo "la nota que se reintenta":

| Segundo clic | Respuesta | Pantalla |
|---|---|---|
| Misma clave, mismo pedido (el corte) | 201 con la nota que entró y `repetida: true` | *"Esta nota ya se había generado: no se emitió dos veces."* |
| Misma clave, otro pedido | 422 *"Esta nota ya se había generado con otros datos…"* con `ventaId` = la nota | el modal se cierra y la orden se recarga |
| Otra clave con el `REFUND` ya ligado (otra pestaña, otro admin) | **409** *"Este reembolso ya tiene su nota de crédito."* con `notaCreditoId` | igual que el 422 |

El 409 no se reproduce como éxito: le diría a otro admin que generó una nota que no generó.

**Lo que se mira después del reclamo** va en `alTomarLaVenta` (`CrearNotaCreditoParams`), que la
nota corre justo después del `FOR UPDATE` de la venta: que el `REFUND` siga sin corrección —leído
con la transacción de la nota; todo escritor del vínculo tiene ese lock— y las líneas. Antes del
reclamo haría rebotar la reproducción. Orden de locks: venta → fila del `REFUND`, el del hook; la
orden no se bloquea.

**A quién se atribuye.** La fila de la nota no lleva usuario: lo atribuido son sus movimientos de
stock. Son de quien hizo la **declaración**: quien pidió el reembolso si lo confirmado es lo que
declaró (con la normalización de la huella), y quien hizo clic si lo cambió o el `REFUND` no lo
guardó. Quien hizo clic queda siempre en el reclamo (`solicitudes_idempotentes`).

**Borde aceptado: la venta ya corregida entera.** Si otras notas ya acreditaron todo (dos pagos y
una nota del POS por cada uno, por ejemplo), el botón da 400 *"La venta ya está corregida entera
por sus notas de crédito: no queda nada que acreditar."* cada vez, y el `REFUND` sigue marcado. El
mensaje nombra la causa para que nadie reintente a ciegas; sin cifras ni número de nota (una venta
no tiene número). Vale para todo camino con lo disponible en cero, la nota manual incluida. Qué
hacer con esa marca (ligarla a la nota que ya existe, o descartarla con un motivo) es pregunta
del owner si aparece en uso real ([`pendientes.md`](../agent/pendientes.md)).

**Cómo se decidió:** el botón y su alcance son del owner (2026-10-02); el contrato visible deriva
de su decisión del 2026-10-03 (la nota que se reintenta); la atribución, de ADR-029. El resto —la
precarga editable, el 409, el corte en `corregirReembolso`, el permiso `Pasarelas:Reembolsar` y la
atribución por declaración— lo decidió la Sesión de esfuerzo máximo (2026-10-04).

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

📌 **Los resúmenes ya no dependen de este tipo, y las correcciones RESTAN.** `GET /ventas/resumen`
y el dashboard reconocen una corrección por `ventas.venta_referencia_id IS NOT NULL`, no por
`es_nota_credito` ni por el id del tipo del país: la devolución interna no lleva el tipo y,
filtrando por tipo, no restaría. La corrección no cuenta como venta y **resta** del vendido y del
facturado; del saldo de la venta que corrige resta solo si no devolvió plata ("No vuelve plata"). Antes el resumen comparaba contra ese id y, si el
país no tenía el tipo, el filtro había que **soltarlo entero** (un `IS DISTINCT FROM NULL` deja
afuera toda venta sin tipo de documento, que son la mayoría, y los KPIs daban casi cero). Esa
trampa ya no existe: sin tipo que comparar el filtro nunca se cae. Los topes de la corrección
tampoco miran el tipo desde el frente de emisión (2026-10-02, ver "Los topes" más abajo). Lo
fijan `test/venta-correcciones.e2e-spec.ts` y el spec de `VentasService.resumen`.

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
  el documento de lo **no pagado**: la boleta del sistema, el hecho por fuera o la factura. Es la
  única nota que admite una venta `pendiente` (sin pagos, el saldo es el total).
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
  una orden) **nunca** mueve caja y la **corrección** no se topa por pago: la plata ya volvió por el
  proveedor y un hecho consumado se registra. (El tope se aplica **antes**, al pedir el REFUND:
  ver "Tope por pago".) Del pago solo mira cuántos hay (`CobrosService.vincularVenta`
  liga una orden a cualquier venta): con **exactamente uno** lo anota en `devolucion_pago_id` para
  que lo devuelto gaste su tope; con 0 o más de uno, no anota ninguno. Corrige el **único
  documento válido** de la venta (vigente y no duplicado); con ninguno, o con más de uno
  (inalcanzable hoy: online y factura son un solo documento, y queda un `warn` con la venta y la
  orden), la corrección sale sin fila de documento, con el tipo NC, como siempre. **Sí puede
  rechazar**, por lo que no depende del pago: el tope global (la suma de las correcciones no pasa
  el total de la venta), el tope por documento, o un país sin tipo de nota de crédito sembrado
  (`exigirTipoNotaCredito`). Entonces la corrección **se pierde**: la pasarela degrada el error a
  `warning` en la respuesta y al log, y el reembolso ya hecho queda sin nota. Una orden ligada a una
  corrección también falla (no se corrige una corrección) y se devuelve igual como `warning`. Una venta que **nunca tuvo documentos** (país sin boleta) se corrige como siempre,
  con el tipo NC y sin fila de documento.

**Los topes.** Los dos de hoy (el total de la venta y el efectivo) más **uno por documento**: lo
corregido de un documento no pasa su `monto`, bajo el mismo lock. Todos cuentan **toda corrección**
(`venta_referencia_id`), la devolución interna incluida: la que sacó efectivo cuenta en el tope
del efectivo, y la que acreditó una porción fiscal cuenta en la composición por porción. El
mensaje del tope por documento no interpola ningún número (la fuga 5 del modo ciego sigue
cerrada). `exigirTipoNotaCredito` ya no corre al abrir la transacción: solo si la corrección
lleva el tipo.

- **Tope por pago (2026-10-02):** una corrección con `devolucion_via = 'pago'` no pasa de
  `aplicado a la venta por ese pago − Σ total_final de las correcciones vigentes con
  devolucion_pago_id = ese pago`. `corregibles` lo trae en la misma lectura de los pagos
  (`devolvible`; sin una consulta por pago) y `crearNotaCreditoEnTransaccion` lo aplica bajo el
  lock de la venta, después del tope por documento (que no acota por pago cuando el medio emite
  `sistema`: su documento es la boleta de toda la venta). Rige para todo pago, efectivo incluido:
  ahí corre **después** del tope del efectivo de la venta, para que el 422 con su rastro siga siendo
  lo que ve quien prueba cuánto efectivo hay. 400 sin cifras (fuga 5). Lo que el comercio quiera
  acreditar de más va por "No vuelve plata", topada por el saldo. Único camino que escribe
  `devolucion_via = 'pago'`.
  - **Lo devuelto cuenta sea cual sea la vía:** el reembolso de pasarela es un hecho consumado y no
    se topa, pero cuando la venta tiene **exactamente un pago** su corrección anota ese pago en
    `devolucion_pago_id` (la vía sigue siendo `'pasarela'`) y gasta su tope; con 0 o más de uno
    queda sin pago (elegir uno sería adivinar).
  - **El REFUND de la pasarela también lo respeta, antes de llamar al proveedor (2026-10-02):**
    el modal de la nota del POS ofrece el pago de Webpay de una venta online como "por la
    tarjeta", así que esa nota gasta el tope de ese pago; sin este chequeo, un `REFUND` de la misma
    orden devolvía la plata otra vez (el proveedor la saca y después la corrección falla por el tope
    global, solo con un `warning`). `CobrosService.reembolsar` le pregunta a ventas (por el
    `ReembolsoCallbackRegistry`, la pasarela no importa ventas) con la transacción del reembolso:
    ventas toma el `FOR UPDATE` de la venta —el mismo de la nota— y usa **la misma cuenta** que el
    tope de la nota (`devolvibleDelPagoUnico` sobre `corregibles`), no una copia. Con **un único**
    pago es lo que ese pago puede devolver (incluidas las notas "por el pago" del POS); con 0 o más
    de uno no hay tope (no se adivina por cuál volvió la plata, igual que `viaDeReembolsoPasarela`;
    inalcanzable hoy: la venta online y la de una suscripción nacen con un solo pago), y una orden
    sin venta, o con una venta que ya no existe, se reembolsa como siempre. 400 sin cifras; si no
    alcanza **la pasarela no se llama** y no queda ningún REFUND. Orden de bloqueo: orden → venta
    (la nota del POS toma solo la venta; ningún camino toma la venta y después la orden).
    **Lo que el REFUND devolvió y aún no tiene su corrección también gasta el tope** (medido: el
    lock cubría "la nota primero, el REFUND después", pero el REFUND libera el lock al commitear y
    su corrección la crea el hook **después**; una nota del POS lanzada hasta ~5 ms detrás pasaba el
    tope y la plata salía dos veces, y lo mismo si el hook fallaba). `corregibles` resta de
    `devolvible`, con un **único** pago, los REFUND aprobados de las órdenes de la venta con
    `correccion_venta_id IS NULL` (misma lectura de los pagos, sin consulta extra; escala 6 contra
    4 resuelta con Decimal). Ligado el REFUND a su corrección deja de contar ahí y cuenta solo por ella
    (`devolucion_pago_id`): nunca por las dos (entre la nota del hook y el vínculo hay un instante
    de sobreconteo, del lado seguro). Como es la cuenta compartida, la ven la nota del POS, el tope
    del REFUND y las opciones de la pantalla. La corrección del propio REFUND no se frena a sí misma:
    la vía `pasarela` no pasa por `corregibles` (sus topes son el global y el del documento).
  - **Lo que un REFUND sin confirmar pudo haber devuelto también gasta el tope (2026-10-04,
    decisión del owner):** un `REFUND` en `iniciada`/`error` (Transbank no contestó, ADR-029) pudo
    haber devuelto la plata, y **nada lo aclara solo**: no hay cron ni aclarado al abrir la orden;
    lo aclara una persona en Pasarela (reintento, otro reembolso de la orden, *Volver a consultar*
    o *Salió/No salió*). Antes la nota del POS lo ignoraba: con $17.000 sin confirmar ofrecía
    $100.000 por el pago y, si después se aclaraba "salió", la corrección del REFUND fallaba por el
    tope global y al cliente le volvían $117.000. Ahora `corregibles` lo resta, con un **único**
    pago, en la misma lectura (columna `sin_confirmar`), y el detalle dice por qué ofrece menos:
    *"$17.000 en un reembolso por Transbank sin confirmar"* (`sinConfirmar` de la opción). "No
    salió" lo saca de la cuenta y vuelve solo; "salió" lo pasa a aprobado y a su corrección, que
    ahora entra. **Costo aceptado:** si no salió, esos $17.000 no se devuelven por la tarjeta hasta
    que el admin lo aclare. Descartadas: frenar la nota hasta aclarar, y que el POS consulte a
    Transbank. El tope del REFUND usa la misma cuenta, así que en su re-verificación (tx1) el propio
    reembolso, ya en `iniciada`, se excluiría a sí mismo: va **por id** (`excluirReembolsoId`), y
    otro sin confirmar de la venta sí cuenta. Mientras tx1 está en vuelo no hay hueco: tiene el
    `FOR UPDATE` de la venta, así que la nota del POS espera. El "Cobrado/Devuelto"
    (`devuelto-venta.ts`) **no** cuenta lo sin confirmar: es un reporte de hechos, y el REFUND entra
    al aclararse, con su fecha (`fecha_transaccion`, la del intento). Costo: el devuelto de un día
    pasado cambia cuando se aclara un sin confirmar de ese día.
  - **La pantalla ofrece lo que el servidor acepta:** `opcionesDevolucion` trae en `monto` lo que
    cada pago todavía puede devolver y no ofrece el que ya devolvió todo; el modal propone y topa el
    monto con esa opción (`topeDeOpcion`, además del disponible de la venta).
  - **La propina no cuenta:** el tope es lo que el pago aplicó a la venta (`pago_aplicaciones`
    tipo `venta`), no lo cobrado en la tarjeta.

## La nota de crédito lleva el receptor de la venta que corrige (2026-10-04)

Frente fiscal propio; decisiones del owner en [`resueltos.md`](../agent/resueltos.md) ("La nota
de crédito lleva el receptor…"), spec
[`2026-10-04-receptor-de-nota-de-credito-design.md`](../superpowers/specs/2026-10-04-receptor-de-nota-de-credito-design.md).
El SII exige `RUTRecep` y `RznSocRecep` en **toda** nota de crédito (Formato DTE v2.5, págs.
19-21; giro, dirección y comuna son opcionales ahí). `crearNotaCreditoEnTransaccion` —la nota
manual y la del webhook— resuelve el receptor bajo el lock de la venta:

| La venta que corrige… | La corrección lleva |
|---|---|
| tiene customer | una **copia** de sus filas de `venta_customer`, todas las columnas (`tercero_id` incluido). Mandar `receptor` es 400: la nota va al mismo cliente que la venta |
| no tiene, y el body trae `receptor` (`{ nombre, rut }`) | ese receptor: nombre sin blancos (≤ 100); en Chile el RUT se valida y se guarda normalizado, en otro país (en pausa) como vino |
| no tiene, ni hay `receptor` | si la corrección lleva tipo NC, **`ventas.receptor_es_emisor = true`**: "a nombre del propio emisor" (FAQ SII 001.380.6571.003). La devolución interna no es documento tributario y no lleva la marca |

- **Se copia, no se lee al emitir:** el receptor es un hecho de la nota (ADR-010), y así se lee
  sola, como su `config_calculo`. El detalle y el ticket de la nota lo muestran sin ir a buscarlo
  a otra venta.
- **La marca congela el hecho, no los datos del local:** el RUT y la razón social del emisor
  se derivan al emitir. Sin ella, el emisor de mañana no distingue "faltó el dato" de "nadie lo
  pidió". `@Check`: solo `true` en una corrección; `DEFAULT false`, sin backfill.
- **La serie de una venta sin customer:** el detalle devuelve `receptorSugerido` (`{ nombre,
  rut }` de la última nota de la venta con receptor, en la misma consulta de la cabecera) y el
  modal lo precarga editable (owner, 2026-10-04): si el sistema ya sabe quién es el comprador,
  "a nombre del emisor" no corresponde. El servidor congela lo que llega en el body, así que las
  notas de esa serie pueden llevar receptores distintos.
- **Idempotencia:** `receptor` entra en la huella; reintentar con otro es otra nota (422). Sin
  receptor la clave no aparece, así que la huella es la de antes del campo y una clave emitida
  antes del deploy se sigue reproduciendo.

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
  un solo modo —acredita cualquier ítem vendido; desde el 2026-10-04 con la pregunta "¿vuelve
  al stock o se perdió?" por fila en vez del switch de reponer—: el modo
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
  plata?" 2026-10-02**; **"¿vuelve al stock o se perdió?" 2026-10-04**, arriba): la casilla "devolver dinero" se reemplazó por un selector con una opción
  por pago (*"Efectivo · $60.000"*, *"Tarjeta de débito · $40.000"*) y "No vuelve plata" solo
  si el backend la mandó (hay saldo), todo de `opcionesDevolucion`. Con varias opciones no viene
  ninguna elegida (un default movería plata de la caja sin decisión); con una sola, sí. Debajo,
  en una línea, **qué registro va a quedar** (`registro` del backend: nota de crédito del
  sistema, de la máquina, hecha por fuera o devolución interna). La opción en efectivo no se
  puede elegir sin caja física abierta. El body lleva `devolucion`, nunca el documento. Además muestra el
  **disponible por porción fiscal** debajo del total —solo si hay más de una: en
  una venta toda afecta repetir el total es ruido—, la pregunta **"¿vuelve al
  stock o se perdió?"** por fila (ver arriba) y **pide el motivo** cuando lo
  marcado vale más que el monto.
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
- `ordenes/OrdenDetalleDrawer.vue` + `ordenes/GenerarNotaModal.vue` (2026-10-04): el `REFUND`
  aprobado de una orden con venta y sin `correccionVentaId` lleva el badge *"Sin nota de crédito"*
  y, con `Pasarelas:Reembolsar`, el botón *"Generar nota"* (`esRefundSinNota`). El modal muestra
  el monto fijo y la `DevolucionInventarioLista` precargada (`useDevolucionInventario.precargar`);
  sin las líneas de la venta no deja generar. Clave de `useIntentoCobro`, ámbito
  `gn:<transaccionId>`. Un reembolso que sale con `warning` recarga la orden para que la marca y
  la precarga vengan del servidor.
- `pages/ventas/index.vue`: badges "NC" / "Dev. interna" (por `esCorreccion`/`esNotaCredito`)
  / "Reemb. parcial" / "Reembolsada" junto al estado.

## NC manual desde el detalle de venta (2026-07-11)

```
POST /api/ventas/:id/notas-credito
Authorization: Bearer <JWT>   (permiso dedicado Ventas:Nota de crédito)
Idempotency-Key: <uuid por intento de emisión>   (obligatoria, ADR-026)

Request:  { "monto": "5000", "comentario": "...",
            "devolucion": { "pagoId": "uuid" } | { "sinPlata": true },   // obligatoria, exactamente una
            "devoluciones": [{ "itemId": "uuid", "cantidad": "1" }] }
Response 201: { "id": "<uuid NC>", "totalFinal": "5000.0000",
                "movimientoCajaId": "<uuid>" | null }
```

- **Una nota por intento de emisión** (2026-10-03, [ADR-026](../adr/026-idempotencia-de-cobros.md)):
  sin la cabecera, 400. Con la misma clave y el mismo pedido, el reintento —el cajero que vuelve
  a confirmar después de un corte— **no emite otra nota ni saca otra vez el efectivo**: devuelve
  la nota que entró más `repetida: true`. Con la misma clave y otro pedido (otro monto, otro
  pago, otras devoluciones u otro comentario), 422 *"Esta nota de crédito ya se había emitido
  con otros datos"* con el id de esa nota en `ventaId`. Detalle y pantalla en
  [ventas.md](ventas.md#una-nota-de-crédito-que-se-reintenta-no-se-emite-dos-veces-2026-10-03).
- Elegibilidad: venta `pagada`/`pagada_parcial` de cualquier canal, o `pendiente` **solo con
  "No vuelve plata"** (owner, 2026-10-02: la distribuidora que factura en otro sistema, vende a
  30 días y el cliente devuelve todo; el comercio hace la nota en su facturador y la anota acá
  con su número). Una `pendiente` no tiene pago por el que vuelva plata: una nota "por un pago"
  sobre ella es 400 con el motivo. Nunca sobre una `cancelada` ni sobre otra corrección
  (`venta_referencia_id`). La venta original no cambia de estado por la nota, salvo que "No
  vuelve plata" deje la deuda en 0: entonces `recalcularEstadoDeLaVenta` la pasa a `pagada`.
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
  (tipo nulo, cuenta en los tres topes, **resta** de `/ventas/resumen` y del dashboard sin contar como venta), el tope por
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
  acreditada por línea** (desde el 2026-10-04, recuperada repone su ingrediente),
  el producto que se pierde (entrada + merma), el
  **escalado** con su motivo obligatorio, la línea que queda en cero y no se
  escribe, el tope por porción sobre las líneas ya escaladas, y el disponible por
  porción —también sobre un documento que no admite nota—.
- `nota-credito-por-pais.e2e-spec.ts`: la forma del catálogo de documentos.
- `reembolso-callback.handler.spec.ts`: registro en el registry y delegación; todo
  reembolso crea la corrección, también el que no trae devoluciones.
- `cobros.service.spec.ts`: hook post-commit (evento completo, warning sin revertir,
  rechazado no dispara, orden sin venta sin aviso, sin handler, usuario `null` por la llave de
  API, el texto de un error que no es de negocio no llega al cliente) y el vínculo: el
  `ligarCorreccion` del evento liga ese REFUND con el `manager` que le pasan, lanza si no tocó
  ninguna fila, y `CobrosService` no liga por fuera del handler.
- `transacciones.service.spec.ts`: `vincularCorreccion` acotado al tenant, escribe una vez,
  devuelve si ligó una fila y, con un `manager`, escribe con ese.
- `create-reembolso.dto.spec.ts`: validación anidada del DTO y el tope de 500 `devoluciones`.
- `topes-dto.e2e-spec.ts` (2026-10-08): el tope de `devoluciones` de los tres DTOs por HTTP, y
  una venta de 500 ítems distintos cuya nota entera es 201 (con 501, 400 y ninguna nota).
- `pasarela-reembolso.e2e-spec.ts` (2026-10-02): por la API real, con el proveedor doblado:
  el REFUND aprobado sin devoluciones deja la nota sobre la boleta y `correccion_venta_id`;
  dos reembolsos parciales, cada uno con su nota; `generarNotaCredito` da 400 por la ruta del
  admin y por la de la llave de API; la orden sin venta se reembolsa sin nota ni aviso; y la
  corrección que falla deja el REFUND aprobado, sin vínculo y con `warning`; un vínculo que
  falla revierte la corrección y el pago ofrece los $30.000 que quedan (no los descuenta dos
  veces); y, por la llave de
  API, una devolución que repone stock de un producto propio: la nota sale, el REFUND queda
  ligado y el movimiento de stock queda con `usuario_id` NULL (por la ruta del admin lleva el
  usuario del token).
- `ReembolsoModal.nuxt.spec.ts`: sin casilla, el body no lleva `generarNotaCredito`, y una línea
  con stock no deja confirmar sin "¿vuelve al stock o se perdió?".
- `nota-credito-recupera-o-pierde.e2e-spec.ts` (2026-10-04): la venta liga cada salida a su
  línea; `devolucionStock` del detalle; los 400 (sin respuesta, respuesta en un servicio,
  `reponerStock`); recuperar y perder una receta (stock, CPP, la merma en `GET /mermas`); una serie
  de notas parciales que cierra exacto; el combo cuya Bebida no se descuenta de la suelta; la causa
  "Devolución" (fija, rechazada en `POST /mermas`, sembrada al crear el tenant y find-or-create
  concurrente). En `pasarela-reembolso.e2e-spec.ts`, el REFUND sin respuesta rebota antes del
  proveedor y el que se pierde deja la merma.

- `pasarela-generar-nota.e2e-spec.ts` (2026-10-04): la nota por el monto del `REFUND` sin
  llamar al proveedor; la línea declarada y quién queda en el kardex (quien pidió / quien hizo
  clic); reproducción, 422, 409 y dos clics concurrentes con claves distintas (una nota); la línea
  sin respuesta y la revalidación contra otra nota posterior; la venta corregida entera; rechazado,
  de otra orden, sin cabecera, con `monto` en el body; permisos con un rol real (403 con solo
  `Leer`); y que la ruta de la llave de API no publica `correccionVentaId` ni `devoluciones`.
  `cobros.service.spec.ts` fija el evento, lo que se mira antes y después del reclamo, y que el
  hook no cambió. Frente: `GenerarNotaModal.nuxt.spec.ts`, `OrdenDetalleDrawer.nuxt.spec.ts` y
  Playwright `nota-credito-generar-de-reembolso.spec.ts` (orden inyectada, venta real).

## Referencias

- Spec: `docs/superpowers/specs/2026-07-10-reembolso-nc-visibilidad-design.md`
- Plan: `docs/superpowers/plans/2026-07-10-reembolso-nc-visibilidad.md`
