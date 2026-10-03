# Feature: Compras — recibir mercadería (pieza 1)

**Status**: Complete (piezas 1 a 5). Pieza 5 (la deuda con el proveedor y sus pagos) cerró el
2026-09-29 con las cinco tareas de
`docs/superpowers/plans/2026-09-28-compras-deuda-proveedor.md`. Los gastos sin stock, la pieza
que sigue, todavía no tiene spec (`docs/agent/pendientes.md`).
**Last Updated**: 2026-09-29

Spec: [`2026-09-18-compras-recepcion-design.md`](../superpowers/specs/2026-09-18-compras-recepcion-design.md) ·
plan: [`2026-09-18-compras-recepcion.md`](../superpowers/plans/2026-09-18-compras-recepcion.md) ·
decisiones del owner: [`investigaciones/2026-09-18-compras.md`](../agent/investigaciones/2026-09-18-compras.md) § 5.
Pieza 3-4 (lectura del XML): spec [`2026-09-27-compras-xml-dte-design.md`](../superpowers/specs/2026-09-27-compras-xml-dte-design.md).

---

## Overview

### What is it?

El encargado carga lo que llegó: proveedor, documento (factura, boleta, guía… o "sin
documento"), la ubicación donde entra y una línea por producto, con cantidad, unidad y precio.
Guarda un **borrador** mientras junta los papeles y lo **confirma** cuando la mercadería está en
el local. Al confirmar, el stock sube y el costo promedio (CPP) se recalcula.

Después puede **completar** el precio de una línea que llegó sin factura, **corregir** precio o
cantidad, cargar el **descuento al total** y **anular** la compra. Cada corrección rehace el
costo desde esa compra en adelante, sin tocar lo que ya se vendió.

### Why does it exist?

Antes de este módulo el stock entraba por el ajuste manual con motivo `compra`: una cantidad y un
costo sueltos, sin documento, sin proveedor y sin forma de corregirlos. Y el costo es la fuente de
todo lo demás: márgenes, food-cost, mermas valorizadas y el reporte de varianza, que espera a
compras.

### Scope

- **Pieza 1 (esta sección):** borrador, confirmar, completar y corregir precio y cantidad,
  descuento al total, anular, historial de correcciones y el módulo `Compras` con sus cuatro
  permisos.
- **Pieza 2:** la unidad de compra por proveedor ("Caja (12)", "Saco (25 kg)"): tabla
  `presentaciones_compra`, su CRUD (`GET/POST/PATCH/DELETE /compras/presentaciones`), la línea con
  presentación —validación del borrador, el helper único de cantidad base, confirmar con lo
  congelado, corregir con lo congelado y el detalle— y la pantalla (el selector combinado, el
  lápiz, la cuenta a la vista). Sección: [La unidad de compra por proveedor](#la-unidad-de-compra-por-proveedor-pieza-2).
  Spec: [`2026-09-27-compras-unidad-de-compra-design.md`](../superpowers/specs/2026-09-27-compras-unidad-de-compra-design.md).
- **Piezas 3 y 4:** el encargado sube el XML de la factura electrónica (DTE) del SII y el mismo
  borrador de siempre queda pre-llenado; la primera vez asocia cada línea a mano, y el sistema
  aprende el código del proveedor para que la próxima factura calce sola. Sección:
  [La lectura del XML y el aprendizaje](#la-lectura-del-xml-y-el-aprendizaje). Spec:
  [`2026-09-27-compras-xml-dte-design.md`](../superpowers/specs/2026-09-27-compras-xml-dte-design.md).
- **Pieza 5:** cada compra confirmada deja deuda con su proveedor, con vencimiento; el total del
  documento, cuando el tipo lo lleva, es el transcrito (nunca calculado); un pago se reparte
  entre sus compras o queda a favor; el efectivo sale de la caja de quien paga en el mismo acto;
  la compra al contado se registra en un solo gesto; y "Por pagar" muestra lo que se debe por
  proveedor. Sección: [La deuda con el proveedor](#la-deuda-con-el-proveedor-pieza-5). Spec:
  [`2026-09-28-compras-deuda-proveedor-design.md`](../superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md).
- **Pieza siguiente, con su propia spec:** los gastos sin stock.
- **Fuera:** orden de compra, devolución al proveedor, moneda extranjera, conectarse al SII
  (Portal MIPYME, casilla de intercambio) para traer el XML solo o para aceptar/reclamar un DTE, y
  verificar su firma digital. ⛔ **Todo lo fiscal** va en su propio frente: mientras tanto, el
  costo es lo que dice la línea del documento, y el IVA incluido o no recuperable no se decide acá.

---

## Las decisiones que la sostienen

| Decisión | Por qué |
|---|---|
| El precio puede faltar al recibir y se completa después | La mercadería llega el lunes y la factura el miércoles: el stock no puede esperar |
| Lo que ya salió conserva su costo; la cuenta se rehace "como si el precio hubiera llegado el lunes" | Reescribir el costo de lo vendido cambiaría márgenes ya reportados |
| Documento siempre, con "Sin documento"; folio obligatorio si hay documento, único por proveedor y tipo | Por ley el folio es único por emisor y tipo. Una anulada libera el suyo |
| Proveedor siempre | La compra sin proveedor no se puede pagar ni auditar |
| Descuento al total repartido según el valor de cada línea; lo regalado es una línea a $0 | NIC 2: los descuentos restan costo. El regalo lo reparte solo el CPP |
| Una ubicación por compra | Una factura entra a un lugar; si hay que moverla, es un traslado |
| Módulo propio `Compras` | El que recibe no es el que paga, y colgarlo de Inventario daría compras a todo el que cuenta stock |
| Anular pide motivo y deja la compra a la vista, tachada | Nunca se borra; la salida del stock y el costo rehecho quedan en el kardex |

Las del **2026-09-19**, tomadas al construir:

- **`movimientos_inventario.costo_informado`**: si el movimiento trajo su costo. Sin costo, el
  kardex congela el CPP de ese momento, y "entró a $1.000" y "entró sin costo cuando el CPP era
  $1.000" se leían igual. Sin esta columna, 10 kg que entraron sin costo se promediaban como si
  hubieran costado $1.000 ($1.285,71 en vez de $1.400).
- **En serie, bajar la cantidad saca solo unidades que trajo esa línea**, no cualquiera que esté
  en stock: si no, las series de la factura no cuadran con su cantidad.
- **Anular la única compra con costo de un producto que no tenía lo deja sin costo**, como antes.
  La `correccion_compra` acepta un costo nulo; `ajuste_costo` lo sigue exigiendo.

---

## Cómo se calcula el costo

### Confirmar

Cada línea entra al kardex por `InventarioService.registrarMovimiento` (motivo `compra`, colgada
de la línea), con su costo por unidad base: el precio tipeado, convertido de la unidad de la
factura a la del producto y con su parte del descuento. Una línea sin precio entra **sin costo** y
no mueve el CPP. En la línea quedan congelados el stock total y el CPP de **justo antes** de su
entrada: el punto de partida para rehacer la cuenta.

Confirmar y corregir costean con **la misma función** (`costearCompra`). Si costearan distinto, la
cuenta rehecha partiría de otro número.

### Rehacer la cuenta (`InventarioService.recalcularCostoDesdeCompra`)

Parte del punto congelado en la primera línea de la compra con ese producto y recorre el kardex
del producto, en **todas** las ubicaciones, por `secuencia`: el orden real de aplicación.
`creado_el` no sirve para esto, porque es la hora en que **empezó** cada transacción. Reglas:

- **La entrada original de una línea** cuenta con la cantidad y el costo que la línea tiene
  **hoy**, en su lugar original. Sus diferencias de cantidad y la salida de su anulación se saltan,
  porque ya están contadas ahí. Una compra anulada no entra.
- **`compra` sin línea** (el atajo del ajuste de stock), **`anulacion` y `devolucion`** promedian
  con su costo congelado **si lo trajeron** (`costo_informado`). Si no, solo suman stock.
- **`ajuste_costo`** reinicia el costo al suyo. **`correccion_compra`** es un resultado, no un
  hecho: no toca nada.
- **Todo lo demás** (ventas, mermas, recuentos, traslados) mueve stock sin tocar el costo.
- Con el stock en cero o menos, la entrada siguiente reinicia el costo, igual que el CPP.

Si el resultado difiere del vigente, lo escribe con una **`correccion_compra`** (ajuste de valor,
cantidad 0). **Ningún movimiento pasado cambia su costo congelado.** Tomate: 5 kg a $1.000,
entran 20 kg sin precio, se venden 8 y la factura llega a $1.500 → **$1.400**, y lo vendido queda
a $1.000.

---

## La deuda con el proveedor (pieza 5)

Spec: [`2026-09-28-compras-deuda-proveedor-design.md`](../superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md)
(`Status: Done`). Esta sección es el modelo, el total y el vencimiento (tarea 1); pagar y anular
un pago, confirmar con `pago`, el recorte, las lecturas y "Por pagar" están más abajo.

### El total, según el tipo de documento

Cada `tipos_documento_compra` declara qué total lleva (`total_documento`):

| Valor | Qué significa | Ejemplo (Chile) |
|---|---|---|
| `obligatorio` | El total **transcrito**: se tipea, o sale del XML (`MntTotal`, tarea 4). El sistema **no lo calcula ni lo valida** contra el neto de las líneas — la diferencia es el impuesto, y eso es del frente fiscal (⛔ fuera de esta pieza) | Factura, factura exenta, factura de compra |
| `opcional` | Se recibe sin él y se completa cuando llega la factura que lo trae | Guía de despacho |
| `suma_lineas` | Σ cantidad × precio − descuento, como siempre — cuantizado **una sola vez**, con `cuantizar` del motor de precios y el modo de redondeo del tenant, importada sin modificarla (`compras/deuda.ts → totalCompra`) | Boleta, sin documento |

**Por qué transcrito y no calculado:** una factura con IVA (neto $100.000 + $19.000 = $119.000)
haría que el sistema calculara $100.000 y mostrara $19.000 "a favor" falsos si sumara las líneas
—que guardan el neto (spec compras-recepción § 9)—. El costo: un campo más al cargar una factura a
mano, que puede no calzar con las líneas sin que el sistema lo note (deliberado: validarlo es
fiscal).

`compras.total_documento` (`numeric(18,4)`, `CHECK > 0`) es null en un `suma_lineas`, y en un
`opcional` hasta que se carga. El borrador (`POST`/`PATCH /compras`) lo acepta opcional;
**confirmar exige el total si el tipo es `obligatorio`** (400 "Falta el total del documento") y lo
deja intacto en los demás. Corregirlo después de confirmar es `PATCH /compras/:id/documento`
(mismo permiso que corregir un precio: `Actualizar`) — `totalDocumento: null` solo se acepta en un
tipo `opcional`, y en un `suma_lineas` cualquier valor es 400.

### El vencimiento

Se fija al **confirmar** (`compras.fecha_vencimiento`, `date` nullable): la fecha tipeada en el
borrador (o la que trajo el XML, `FchVenc`, tarea 4) manda; si no hay ninguna, es
`fecha_documento` + el plazo de pago del proveedor (`terceros.plazo_pago_dias`, `int`,
`CHECK > 0`), o **30 días** si el proveedor no tiene uno cargado. Se corrige después con el mismo
`PATCH /compras/:id/documento`.

**Por qué desde `fecha_documento` y no desde la recepción:** la compra no guarda cuándo llegó la
factura (`fecha_documento` es la del papel; `confirmado_el` es cuándo llegó la *mercadería*, que
puede ser antes). Y por qué 30 días es el default: es el de la propia ley (19.983, art. 2, texto de
la ley 21.131) — si la factura no menciona plazo, se entiende pagadera a los 30 días corridos de
la recepción. Como la recepción nunca es anterior a la emisión, el vencimiento calculado desde
`fecha_documento` cae el mismo día o antes que el legal: nunca después.

La aritmética vive en un solo lugar, `compras/deuda.ts` (`vencimiento`, `totalCompra`), con sus
unitarios — el mismo criterio que `rango-fecha.util.ts` para el día del negocio.

### Permisos de la tarea 1

`PATCH /compras/:id/documento` va con `Actualizar` (no con `Pagar`): corregir lo transcrito es lo
mismo que corregir un precio, y las dos tareas ya podían hacerlo. El rol `Compras · Encargado`
arranca **sin** `Pagar` a propósito (spec § 9, decisión 7b): "el bodeguero recibe, el dueño paga".

---

## Pagar y anular un pago (pieza 5, tarea 2)

Spec [`2026-09-28-compras-deuda-proveedor-design.md`](../superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md)
§ 5, § 8 (solo `GET /compras/pagos`), § 9 y § 11. "Por pagar" (`GET /compras/por-pagar`) y
confirmar con `{ pago }` (spec § 7) están en la sección de la tarea 3, más abajo; las pantallas
(`por-pagar.vue`, `PagarProveedorModal.vue`, `AnularPagoModal.vue`), en la de la tarea 5, al final.

### El modelo

`pagos_proveedor` (un pago real: plata que salió, por un medio, un día) y
`pago_proveedor_aplicaciones` (cuánto de ese pago cubre cada compra). **La deuda se deriva al
leer** (total − aplicaciones vivas), nunca se guarda: no hay columna de saldo que desincronizar.
**Las aplicaciones no se editan**: un ajuste futuro (§ 6, recorte por corrección) marcará
`eliminado_el` e insertará otra fila por el resto — esta tarea solo las crea. `pagos_proveedor.id`
se pre-genera con `randomUUID()` (`@PrimaryColumn`, no `@PrimaryGeneratedColumn`): el fondeo
(`compras/deuda.ts → fondear`) necesita poder nombrarlo como fuente ANTES del `INSERT`, para que
una aplicación pueda salir partida entre el saldo a favor y el pago nuevo en la misma pasada.
`movimientos_caja.pago_proveedor_id` (nullable, sin `@ManyToOne`, mismo patrón que `venta_id` y
`pago_id`) es la salida — o, al anular, la entrada reversa — de un pago en efectivo.

### `fondear` (`compras/deuda.ts`)

Función pura: reparte las aplicaciones pedidas contra las fuentes de plata disponibles, **el
saldo a favor primero** (sus pagos más viejos primero — el llamador arma ese orden por `fecha`
ASC) **y recién después el pago nuevo** (spec § 5.1). Procesa las aplicaciones en el orden en que
llegan (la pantalla decide la propuesta; el servidor valida el reparto, no lo decide) y puede
partir una sola aplicación en varias filas si ninguna fuente sola la cubre. No valida topes de
negocio (eso lo hace el service con lo que leyó bajo lock, antes de llamarla): si las fuentes no
alcanzan para lo pedido, revierte con un error genérico — señal de que el caller no validó.

### `POST /compras/pagos`

```
{ proveedorId, monto, metodoPagoId?, referencia?,
  aplicaciones: [{ compraId, monto }] }        // vacía = anticipo
```

- `monto` ≥ 0. **`monto` = 0 con aplicaciones** usa el saldo a favor (decisión 5): no crea fila
  en `pagos_proveedor` ni toca caja — la respuesta trae `id: null`.
- 400 si: el proveedor no existe (**404** si es de otro tenant) o no está activo; una compra no
  existe (**404** otro tenant) o no es del proveedor / no está `confirmada` / se repite en el
  reparto; una aplicación supera la deuda **conocida** de su compra (sin tope si el total es
  desconocido, decisión 8 — llega a la tarea 4); el reparto pedido supera lo disponible (saldo a
  favor + `monto`).
- **Efectivo** (`metodos_pago.es_efectivo`): la caja la resuelve el servidor
  (`CajaService.findActiva(tenantId, usuarioId)`), nunca el body (invariante 1, decisión 3). Sin
  caja abierta: 400. Con caja: la **misma** validación que la salida manual
  (`calcularEsperadoEfectivo` + `IntentoRechazadoError('Saldo insuficiente en caja', { tipo:
  'pago_proveedor', motivo: 'saldo_insuficiente', … })`) y la salida con
  `registrarMovimientoEnTransaccion` (`tipo: 'salida'`, `pagoProveedorId`), en la MISMA
  transacción que el pago.
- **Idempotencia:** exige `Idempotency-Key`, operación `'compras.pago'` (`huellaDe`), huella del
  DTO entero (sin datos sensibles).

### `POST /compras/pagos/:id/anular` con `{ motivo }`

Marca el pago `anulado` y `eliminado_el` en sus aplicaciones vivas: las compras vuelven a deber.
**Efectivo con su caja todavía abierta:** solo el dueño de esa caja puede anular (403 si no), y se
genera la **entrada** reversa en esa misma caja. **Con la caja ya cerrada (o en conciliación):** no
toca ninguna caja (decisión 6) — la deuda vuelve igual. Sin `Idempotency-Key`: no cobra, no le
aplica ADR-026.

### La composición del spike (por qué el 422 deja rastro Y el reintento reproduce)

```
cajaService.conRastroDeRechazo(tenantId, () =>
  idempotencia.ejecutar({ ... , operacion: 'compras.pago' }, () =>
    db.transaccion((manager) => pagarEnTransaccion(manager, ...))
  , () => null)
)
```

`conRastroDeRechazo` es el borde MÁS externo, fuera de cualquier transacción. `ejecutar` abre su
PROPIA `db.transaccion`, reclama la clave PRIMERO y recién ahí corre `pagarEnTransaccion` (que
reusa esa misma transacción vía ALS, `docs/patterns/backend.md` § 9). Si `pagarEnTransaccion`
tira `IntentoRechazadoError` (sin plata en caja), **toda** la transacción de `ejecutar` revierte
—el reclamo de la clave incluido— porque el throw sale de su callback antes del `UPDATE …
respuesta`; es la garantía que `idempotencia.service.ts` ya documenta ("un rechazo… no deja
rastro, y el reintento con la misma clave corre de verdad"). Recién ahí, con la transacción ya
deshecha, `conRastroDeRechazado` escribe la fila del rastro con `db.sinTransaccion` — nunca
compite por el lock que la transacción revertida soltó.

`pagarEnTransaccion(manager, tenantId, usuarioId, dto)` se expone aparte de `registrarPago`
(el método público que arma la composición de arriba) **para que la tarea 3 lo reuse desde
`confirmar`** (spec § 7: confirmar y pagar en la MISMA transacción, sin una `IdempotenciaService`
anidada — `confirmar` decide su propia idempotencia y rastro para su operación compuesta).

### Orden de locks (spec § 11)

Las compras del reparto (`FOR UPDATE OF c`, `ORDER BY compra_id`) → los pagos vigentes del
proveedor que pueden fondear (`FOR UPDATE`, `ORDER BY pago_proveedor_id`) → la caja
(`bloquearCajaAbierta`, al final, solo si el medio es efectivo). Pagar no toca stock: salta del
primer lock al segundo. `anularPago` sigue el mismo orden: primero lockea las compras que sus
aplicaciones tocan (leídas sin lock antes, porque cambiarlas exige lockear primero ESE mismo pago
— ver el comentario en `anularPagoEnTransaccion`), después el pago, después la caja si corresponde.
Cada `ORDER BY` tiene su unitario que afirma sobre el SQL (`compras.service.spec.ts`, describe
"orden de locks").

### Permisos

`GET /compras/medios-pago` · `GET /compras/pagos` · `POST /compras/pagos` ·
`POST /compras/pagos/:id/anular`: **`Pagar`**, no `Actualizar` ni `Anular` (el de la compra) — spec
§ 9, decisión 7: quien se equivoca de monto lo deshace desde su propia caja, sin permiso sobre el
resto de la compra.

---

## Confirmar con pago, el recorte y las lecturas de deuda (pieza 5, tarea 3)

Spec § 6, § 7, § 8, § 9, § 11 y § 12. La compra al contado en un solo gesto, que corregir o
anular una compra deje la deuda bien sola, y las lecturas que alimentan "Por pagar" (la
pantalla, en la sección de la tarea 5, al final).

### La compra al contado, en un gesto (`POST /compras/:id/confirmar`)

`{ pago?: { monto, metodoPagoId, referencia? } }`, opcional. Sin `pago`, confirmar sigue exactamente
igual que antes (nadie necesita `Pagar` para confirmar una compra sin pagarla). Con `pago`:

- El controller resuelve `Compras:Pagar` A MANO (`@RequiresPermiso` no puede condicionar por el
  body) — sin el permiso, 403 **antes** de tocar nada. Y exige `Idempotency-Key` (es un cobro).
- `confirmarEnTransaccion` arma, al final (después de mover el stock y fijar el estado
  `confirmada`), una única aplicación a **esta** compra por `min(monto, total)` — o por `monto`
  entero si el total todavía es desconocido (decisión 8) — y llama a `pagarEnTransaccion`
  (tarea 2) **en la misma transacción**. Si el pago revienta (sin caja, sin plata), la excepción
  se lleva puesto TODO: el estado, el stock movido, el reclamo de la clave — "confirmar con un
  pago que falla no confirma nada" sale gratis de compartir una sola transacción.
- **La composición cambia respecto de `registrarPago`:** `conRastroDeRechazo` sigue siendo el
  borde más externo, pero el reintento de deadlock (`conReintentoGenerico`, NO atado a
  `db.transaccion`) pasa a envolver a `idempotencia.ejecutar(...)` **entero**, en vez de ir
  adentro como el `conReintento` de siempre. Por qué: `ejecutar` abre su PROPIA transacción cada
  vez que se lo llama; si un `40P01` la aborta, se lleva puesto el reclamo de la clave —nada
  quedó comprometido—, así que reintentar el `ejecutar()` completo es un intento limpio. Ponerlo
  adentro (como confirmar sin pago) no serviría: ahí `db.transaccion` REUSA el manager activo de
  `ejecutar`, y un `40P01` deja esa transacción abortada — el "reintento" fallaría de nuevo contra
  la misma conexión rota. Operación nueva en `huella.ts`: `'compras.confirmar'`.

### El recorte (spec § 6)

Cuando el total de una compra confirmada **baja o pasa a conocerse**, sus aplicaciones de pago se
recortan en la misma transacción hasta que el aplicado no supere el total nuevo — **de la más
nueva a la más vieja** (la primera pagada es la que menos se toca). El sobrante de cada aplicación
tocada vuelve a su pago como saldo a favor (decisiones 5 y 8): `recortar` (`compras/deuda.ts`) es
pura y solo decide los montos; el service (`recortarAplicaciones`) hace la escritura — nunca
`UPDATE` del monto: borra (`eliminado_el`) y, si queda un resto, inserta otra fila.

**Todo lo que puede escribir `precio_unitario`, `cantidad`, `descuento_total`, `total_documento` o
`estado = 'anulada'` de una compra confirmada, y dónde engancha el recorte:**

| Método | Qué escribe | Recorta cuándo |
|---|---|---|
| `corregirLinea` / `corregirCantidad` | `precio_unitario`, `cantidad` | Solo en `suma_lineas` (en `obligatorio`/`opcional` la deuda es el total transcrito, decisión 10: una línea no la toca) — con el total resultante conocido |
| `corregirDescuento` | `descuento_total` | Solo en `suma_lineas`, igual que arriba |
| `actualizarDocumento` | `total_documento` | Si el nuevo valor no es `null` (bajar a `null` en un `opcional` vuelve el total desconocido, no lo baja: nada que recortar) |
| `anular` | `estado = 'anulada'` | Siempre, con `totalNuevo = '0'` — decisión 6b: "esta compra no debe nada" es EXACTAMENTE recortar hasta 0, mismo camino, sin un `if` aparte |

No hay otro método que toque esas columnas de una compra `confirmada`: `crearBorrador` /
`actualizarBorrador` / `confirmar` (sin `pago`) operan sobre un borrador, que no tiene
aplicaciones.

**Duda del revisor, contestada:** una aplicación de un pago anulado, o de una compra anulada, NO
se cuenta en ninguna lectura de deuda — `anularPago` marca `eliminado_el` en TODAS las
aplicaciones del pago, y `anular` (vía `recortarAplicaciones(..., '0')`) marca `eliminado_el` en
TODAS las de la compra. Toda lectura de "aplicado" (`SELECT ... WHERE eliminado_el IS NULL`) ya
excluye los dos casos: no hace falta filtrar por el estado de `pagos_proveedor` además, porque
"vigente" y "aplicación viva" coinciden por construcción.

Orden de locks: las compras que el recorte toca ya están lockeadas por el llamador (primero, spec
§ 11); `recortarAplicaciones` toma los pagos que fondean esa compra `FOR UPDATE ORDER BY
pago_proveedor_id` — con su unitario sobre el SQL (`compras.service.spec.ts`).

### Lo que ve el dueño (spec § 8, decisión 12)

"El bodeguero recibe y el dueño paga": lo que se debe lo ve solo quien tiene `Pagar`.

- **`GET /compras/por-pagar`** (`Pagar`): una fila por proveedor con la deuda conocida, lo
  vencido, lo que vence en 7 días, cuántas compras tienen el total desconocido y el saldo a
  favor — ordenada por vencido y después por lo que vence pronto. Sin deuda y sin saldo a favor,
  el proveedor no aparece.
- **`GET /compras/por-pagar/:proveedorId`** (`Pagar`): sus compras confirmadas con deuda o total
  desconocido (una `pagada` no entra), con estado derivado y vencimiento; sus pagos vigentes con
  saldo a favor > 0.
- **`GET /compras` y `GET /compras/:id`** siguen con `Leer`. El controller resuelve `Pagar` (sin
  bloquear la ruta) y se lo pasa al service, que arma la respuesta con o sin la parte de pago:
  `estadoPago`, `deuda`, `deudaMinima` y `vencida` en cada fila del listado; además `aplicado` y
  `pagos` (los que cubren la compra) en el detalle. **Sin `Pagar` esas claves no viajan** (`undefined`, que
  `JSON.stringify` omite) — nunca `null`: el dato no se esconde en la pantalla, se omite en la
  respuesta (invariante 6). El filtro `estadoPago` de `GET /compras` es 403 sin `Pagar`. Lo que
  el bodeguero transcribe (`total`, `totalDocumento`, `fechaVencimiento`) sigue llegando siempre.
- **Estado derivado** (`compras/deuda.ts → estadoPagoCompra`, pura): `pagada` (deuda 0), `parcial`
  (aplicado > 0 y deuda > 0), `pendiente` (sin aplicado); con total desconocido, `falta_total`
  (`obligatorio`/`opcional` sin transcribir) o `falta_precio` (`suma_lineas` con alguna línea sin
  precio); encima, `vencida` si queda deuda (o el total ni se sabe) y ya pasó el vencimiento. "Hoy"
  es el día del NEGOCIO del tenant (`rango-fecha.util.ts → diaNegocioTenant` +
  `diaNegocioEnZona`) — **no** `fechaLocalTenant` (hora de reloj sin corte): lo hace cumplir
  `dia-negocio.invariant.spec.ts`, que prohíbe ese import fuera de la allowlist del motor de
  precios y promociones.
  - **`falta_precio` trae además `deudaMinima`** ("al menos $X", spec § 4.1 y decisión 8): Σ
    cantidad × precio de las líneas que SÍ tienen precio, cuantizada una sola vez con el mismo
    `cuantizar` que usa `totalCompra` (sin término de descuento — un descuento no puede existir
    mientras falte el precio de una línea, lo exige `validarDescuento`), menos lo aplicado, nunca
    negativa. El SQL de `SELECT_CABECERA`/`comprasConfirmadasParaDeuda` ya suma solo sobre las
    líneas con precio: `cantidad * precio_unitario` da `NULL` en las que no lo tienen, y `SUM`
    ignora los `NULL`. **Sin NINGUNA línea con precio no hay mínimo** (decisión 8b, owner
    2026-09-29): `bruto` es `NULL` en ese caso, y `compras.service.ts → totalMinimoConocido`
    devuelve `null` en vez de cuantizar 0 — la pantalla dice solo "falta el precio", nunca "al
    menos $0". Una línea con precio `'0'` (el regalo) SÍ es un mínimo conocido: `bruto` ahí es
    `'0'`, no `NULL`, y `deudaMinima` sale `'0'` de verdad. **`falta_total` no tiene mínimo**
    (decisión 10: el neto de las líneas no es la deuda de una factura con documento) — ahí
    `deudaMinima` siempre es `null`. En cualquier otro estado también es `null`: solo tiene valor
    en `falta_precio`, y solo cuando al menos una línea tiene precio.
- **Una consulta por lectura, sin N+1.** El total de un `suma_lineas` pasa por `cuantizar`
  (Decimal.js: no se reimplementa en SQL), así que `GET /compras/por-pagar` y
  `.../por-pagar/:proveedorId` agregan SQL crudo (compras confirmadas + saldo a favor por
  proveedor) y terminan la cuenta en memoria. `GET /compras`/`:id` hacen lo mismo salvo que,
  además, el filtro `estadoPago` no se puede empujar a `WHERE`: con ese filtro presente se trae
  TODO lo que cumple el resto de los filtros (sigue siendo una consulta) y se pagina en memoria
  en vez de `LIMIT`/`OFFSET` — costo aceptado dado el volumen de compras de un tenant.
  **Decisión técnica de la sesión que implementó la pieza (2026-09-29), no consultada al
  owner:** la alternativa sería reimplementar `cuantizar` —con su modo de redondeo por
  tenant— en SQL, exactamente lo que las Global Constraints del plan prohíben ("importando
  `cuantizar` del motor **sin modificarlo**"). Si el volumen de compras de un tenant algún día
  lo justifica, la solución es una columna materializada del total (con su propio frente de
  sincronización), no una segunda cuantización en `WHERE`. No "arreglar" esto agregando una
  expresión de redondeo en SQL.
  ⚠️ **Deuda conocida, cruzada con el backlog:** este `estadoPago` que trae TODO a memoria antes
  de paginar es el mismo problema, en otra pantalla, que la entrada con prioridad de
  [`pendientes.md`](../agent/pendientes.md) § 3 *"las pantallas de venta cargan solo los
  primeros 100 ítems"* (owner, 2026-09-28: la grilla tiene que paginar y buscar en el
  servidor) — acá el listado de compras filtrado por `estadoPago` tiene el mismo defecto de
  fondo (paginar bien exige que el filtro nazca en el servidor, no que se aplique después de
  traer la página). No se resuelve acá: cuando ese frente encare la paginación server-side en
  serio, esta lectura de `GET /compras` es candidata al mismo arreglo.
- **Las escrituras sobre una confirmada devuelven los mismos campos de pago que `GET
  /compras/:id`, sin un `GET` aparte.** `corregirLinea`, `corregirDescuento`,
  `actualizarDocumento`, `anular` y `confirmar` (con o sin `pago`) resuelven `Pagar` en su
  propio controller — el mismo `tienePermisoPagar(u)` que usan las lecturas — y se lo pasan al
  `findOne` final. El body de, por ejemplo, `POST /compras/:id/confirmar` sin `pago` ya trae
  `estadoPago`/`deuda`/`vencida` si quien confirmó tiene `Pagar` (el dueño confirmando sin pagar
  es el caso común, no uno raro): no hace falta un `GET /compras/:id` posterior para verlos.
  `findOne`'s `tienePagar = false` por default queda solo para `crearBorrador`/
  `actualizarBorrador`, que operan sobre un borrador sin aplicaciones.

### Permisos de la tarea 3

`GET /compras/por-pagar` · `.../por-pagar/:proveedorId`: **`Pagar`**. `POST /compras/:id/confirmar`
con `pago`: **`Crear` + `Pagar`**, sin `pago`: solo `Crear` (como siempre). `GET /compras` ·
`GET /compras/:id`: **`Leer`**, con los campos de pago solo si además hay `Pagar`.

---

## Las pantallas de la deuda: total, vencimiento y "¿la pagaste ya?" (pieza 5, tarea 4)

### `pages/terceros.vue`

"Plazo de pago (días)" en el drawer de alta/edición (`plazoPagoDias`, spec § 2 decisión 4):
número entero, vacío = 30 días. Sigue la misma convención que el resto de los campos de texto
del formulario (`|| undefined`): un campo ya cargado no se puede vaciar de vuelta a "sin
plazo" desde acá — el mismo límite que tienen `rut`, `nombreLegal`, etc., no algo nuevo de
esta tarea.

### `useDte.ts`: `MntTotal`, `FchVenc` y `FmaPago`

`DocumentoDte` suma `fechaVencimiento` (`FchVenc`, `IdDoc`) y `fmaPago` (`FmaPago`: `'1'`
contado, `'2'` crédito, `'3'` sin costo). `montoTotal` (`MntTotal`) ya se leía desde la pieza
de lectura del XML. Fixtures nuevos en `__fixtures__/dte/`: `contado-fma-pago-1.xml` (sin
`FchVenc`) y `credito-fchvenc.xml` (con `FchVenc`).

### `pages/compras/[id].vue`: la carga precarga el total y el vencimiento

Al cargar desde el XML (`onCargarDte`), si el tipo elegido lleva total transcrito (no
`suma_lineas`) se precarga `totalDocumento` con `MntTotal`; `fechaVencimiento` se precarga con
`FchVenc` si vino, y si no, la sugerencia por plazo del proveedor la completa sola (el watch
que ya existía desde la tarea 1). ⚠️ La visibilidad de "Total del documento" se resuelve
DIRECTO contra el catálogo de tipos en ese instante (`tipos.value.find(...)`), no contra el
`computed` `totalDocumentoVisible`: ese `computed` se limpia con un `watch` que solo dispara en
la TRANSICIÓN visible→oculto, y si el tipo que trae el XML ya era `suma_lineas` desde antes (no
hay transición), el total precargado quedaría puesto sin que nadie lo borre.

### El modal de confirmar: "¿La pagaste ya?"

Solo con `Compras:Pagar` (decisión 7 y 12): No / "Sí, la pagué", con medio de pago
(`GET /compras/medios-pago`) y monto — propuesto en el total que se le va a deber (§ 4.1: lo
transcrito, o la suma de las líneas). `FmaPago = 1` (contado) propone "Sí" al abrir el modal;
cualquier otro valor (o su ausencia) deja "No". El body de `pago` (`{ monto, metodoPagoId,
referencia? }`) viaja con la `Idempotency-Key` de `useIntentoCobro` (ámbito `compra:<id>`),
solo cuando "Sí, la pagué" está elegido — sin `pago`, `POST /confirmar` no manda la cabecera
(el backend no la exige en ese camino).

**El aviso de efectivo sin caja abierta es estático, no un chequeo previo:** la pantalla NO
llama a `GET /caja/activa` para saber si el que paga tiene su caja abierta, porque esa ruta
exige `MiCaja:Leer` — un permiso que el que paga (`Compras:Pagar`) puede no tener (son ejes
distintos: "el bodeguero recibe y el dueño paga" no dice nada de quién administra su propia
caja). En vez de eso, eligiendo un medio con `esEfectivo` se muestra una frase fija ("Sale de
tu caja física abierta…") y el 400 real del backend ("Para pagar en efectivo necesitás tu caja
abierta") se maneja como cualquier otro error de confirmar, con el toast de siempre. Spec § 10
pedía "el aviso antes de mandar, y el 400 igual" — acá el aviso es genérico en vez de
condicionado a un estado que la pantalla no puede consultar sin pedir un permiso de más.

### `CompraConfirmada.vue`

Total y vencimiento se muestran siempre (leyendo `compra.totalDocumento`/`fechaVencimiento`);
"Corregir total o vencimiento" (nuevo `CorregirDocumentoModal.vue`, `PATCH
/compras/:id/documento`) solo con `Actualizar`, el mismo permiso que corregir una línea. Con
`Pagar` además: pagado (`compra.aplicado`), deuda (`useCompras() → textoDeuda`: el monto exacto,
o "Al menos $X" con `compra.deudaMinima` en `falta_precio`, o "falta el total" en `falta_total`
— decisión 10, ahí no hay mínimo), la insignia de estado (`useCompras() → insigniaPago`, que en
`falta_precio` también muestra "Al menos $X" cuando `deudaMinima` vino) y la tabla de pagos que
aplicaron algo a esta compra (`compra.pagos`) — nada de esto se evalúa si `compra.estadoPago` no
vino en la respuesta (decisión 12: el backend lo omite sin `Pagar`, nunca lo manda en `null`).

`CorregirDocumentoModal.vue` arma el body con `useCompras() → cuerpoActualizarDocumento`: solo
lo que cambió (comparado como `Decimal`, no como texto — lo que trae el `GET` es
`numeric(18,4)` y lo tipeado no), `totalDocumento: null` solo en un tipo `opcional`, y en un
`obligatorio` vaciar el campo no manda nada (el backend lo exige).

### Testing

Vitest: `useDte.spec.ts` (los tres campos nuevos, con los fixtures); `useCompras.spec.ts`
(`cuerpoActualizarDocumento`, `insigniaPago`, `textoDeuda`); `CompraConfirmada.nuxt.spec.ts` (total/
vencimiento, el botón de corregir por permiso, la sección de pago por permiso y por
`estadoPago`); `CorregirDocumentoModal.nuxt.spec.ts` (solo lo que cambió, `null` vs sin body
según el tipo); `compras-pago-al-confirmar.nuxt.spec.ts` (la precarga del XML, "¿la pagaste
ya?" por permiso, `FmaPago`, el body y la `Idempotency-Key` de confirmar con pago);
`terceros.nuxt.spec.ts` (`plazoPagoDias` al editar y al crear).

---

## "Por pagar", pagar, anular y el cierre del frente (pieza 5, tarea 5)

Spec § 5.1, § 5.2, § 8 y § 10. La pantalla del dueño (decisión 9), el pago repartido con la
propuesta desde la más vieja (decisión 2), y anular un pago (decisión 6).

### `pages/compras/por-pagar.vue`

Pantalla entera detrás de `Compras:Pagar` con **middleware de ruta** (`definePageMeta({
middleware: ['auth', 'permiso'], permiso: 'Compras:Pagar' })`, `docs/patterns/frontend.md` §
1.2) — no un `v-if` por control: "el bodeguero recibe y el dueño paga" (decisión 12) hace que
sea la pantalla ENTERA la que es de quien paga, así que cubre también la URL escrita a mano. La
entrada de navegación (Compras ▸ Por pagar, en `composables/useMenuLateral.ts`) se gatea con el mismo permiso, no con `Leer`
como el resto de Compras — es la excepción a la regla de § 1 del pattern frontend ("el link se
gatea con `Leer`"): acá la pregunta que importa es "¿puede pagar?", porque no hay nada más que
esta pantalla ofrezca a quien solo puede leer.

Una fila por proveedor (`GET /compras/por-pagar`), con lo que se debe, lo vencido, lo que vence
en 7 días y el saldo a favor; al tocar uno, sus compras abiertas y sus pagos vigentes con saldo
a favor (`GET /compras/por-pagar/:proveedorId`), y el botón **Pagar**. Pagar o anular un pago
recarga los dos (`recargarTodo`): la deuda y el saldo a favor cambiaron en los dos lados. La
columna **Debe** de las compras abiertas usa `useCompras() → textoDeuda`: el monto si se conoce,
"Al menos $X" con la `deudaMinima` de una `falta_precio`, o "falta el total" en una `falta_total`.

### `components/compras/PagarProveedorModal.vue`

Monto, medio de pago (solo si el monto es positivo: `monto` 0 con aplicaciones es "usar el
saldo a favor", decisión 5, y ahí no hace falta medio), referencia, y el **reparto propuesto**
— editable —, con lo que no se reparte dicho en pantalla ("Lo que no se reparte queda a favor
del proveedor: $X"). Cada fila muestra "Debe $X" (`useCompras() → textoDeuda`): el monto exacto,
o "Al menos $X" con la `deudaMinima` de la compra en `falta_precio` (spec § 4.1, decisión 8) —
antes era un texto fijo sin monto ("al menos lo que se sepa del total"), reemplazado al sumar
`deudaMinima` a la respuesta. Se abre desde "Por pagar" (el proveedor entero) y también desde
`CompraConfirmada.vue` (con deuda pendiente: recarga esa compra sola al cerrar, vía
`recargarTrasPago`, porque el pago pudo repartirse a otras compras del mismo proveedor además
de esta).

**La propuesta** (`useCompras() → proponerReparto`, pura y testeada con Vitest): el saldo a
favor primero, después la compra más vieja por `fechaVencimiento` y, a igualdad o sin
vencimiento, por `fechaDocumento` — mismo criterio que fondea el servidor (spec § 5.1,
decisión 2). Se regenera cada vez que cambia el monto tipeado, **hasta que alguien edita una
fila a mano** (`repartoTocado`): desde ahí la pantalla no vuelve a pisar lo editado, y
"Recalcular propuesta" es la única forma de volver a la sugerencia automática. Solo se mandan
aplicaciones con monto > 0 — el DTO de `POST /compras/pagos` exige `monto` positivo por línea
(spec § 5.1) — y el servidor **valida el reparto que llega, no lo recalcula**: la propuesta es
enteramente de pantalla.

La clave de idempotencia (`useIntentoCobro`, ámbito `pago-proveedor:<proveedorId>`) persiste
entre aperturas del modal para el mismo proveedor: si el modal se cierra y se reabre tras un
corte de red, el reintento con la misma clave reproduce el pago en vez de pagar dos veces.

### `components/compras/AnularPagoModal.vue`

Motivo obligatorio, `POST /compras/pagos/:id/anular`. El aviso de caja cerrada (decisión 6) es
**estático, no un chequeo previo** — mismo criterio que el aviso de efectivo sin caja de "¿la
pagaste ya?" (tarea 4): la pantalla no puede saber si la caja de ese día sigue abierta sin
pedir un permiso de caja que quien tiene `Pagar` puede no tener, así que el `UAlert` siempre
dice que, si el pago fue en efectivo y la caja ya cerró, anular no le devuelve plata a ninguna
caja.

### Insignia de pago y filtro en `pages/compras/index.vue`

Con `Compras:Pagar` (mismo `computed` que `CompraConfirmada.vue`, no `usePermisosCrud`: `Pagar`
no es uno de los cuatro CRUD), una columna **Pago** con la insignia de `useCompras() →
insigniaPago` — en `falta_precio` con `deudaMinima`, la insignia lee "Al menos $X" en vez de
"Falta el precio" a secas —, y un `UFormField` "Estado de pago" que filtra `GET
/compras?estadoPago=`. Sin
`Pagar`, ni la columna se agrega (`columns` es un `computed` que la omite entera, no la oculta
con CSS) ni el filtro aparece — y aunque alguien forzara el filtro por query string, el backend
lo rechaza con 403 (decisión 12, ya cubierto por el e2e de la API).

### Testing

Vitest: `useCompras.spec.ts` (`proponerReparto`, la escena de Don Pedro y el resto de spec §
12); `PagarProveedorModal.nuxt.spec.ts` (la propuesta, que editar una fila detiene la
regeneración automática, "Recalcular propuesta", y el body exacto de `POST /compras/pagos`);
`AnularPagoModal.nuxt.spec.ts` (motivo obligatorio, el body, el aviso siempre visible);
`CompraConfirmada.nuxt.spec.ts` (el botón "Pagar" con deuda pendiente y su ausencia en una
`pagada`); `compras/index.nuxt.spec.ts` (la insignia y el filtro, presentes solo con `Pagar`);
`compras/por-pagar.nuxt.spec.ts` (la lista, y que tocar un proveedor carga su detalle y el
botón Pagar).

Navegador (`e2e/compras/compras-deuda-proveedor.spec.ts`, como `compras.paga`): recibir la
feria y pagarla al contado en un gesto —el efectivo baja de verdad en la caja física de quien
paga, verificado cerrando esa caja y comprobando que el arqueo cuadra con lo que debería quedar
después del pago—; pagar dos compras de un proveedor desde "Por pagar", con la propuesta
cubriéndolas enteras. Y como el bodeguero, sin `Pagar`
(`e2e/compras/compras-deuda-proveedor-bodeguero.spec.ts`): la navegación no ofrece "Por pagar";
entrar por URL a `/compras/por-pagar` lo frena el middleware (termina en `/ventas`); el listado
de compras no lleva insignia ni filtro de pago; y confirmar una compra no ofrece "¿la pagaste
ya?". El 403 de la API detrás de cada uno de estos escondites está en
`backend/test/compras.e2e-spec.ts` y `backend/test/compras-pagos.e2e-spec.ts` (spec § 12).

---

## La unidad de compra por proveedor (pieza 2)

Una línea puede ir en una unidad del catálogo (`unidadCodigo`) o en una **presentación** del
proveedor para ese producto (`presentacionId`) — nunca las dos, nunca ninguna (400). El CRUD de
presentaciones vive en `PresentacionesCompraService` (los cuatro endpoints `/compras/presentaciones`
de la tabla de arriba, spec pieza 2 § 5); esta sección es la línea que las consume
(`ComprasService`, spec pieza 2 § 3.2 y § 4).

**Qué se congela al confirmar, y por qué.** `presentacion_nombre` y `contenido_base` (cuántas
unidades base trae UNA presentación) se copian a la línea. Sin esto, el detalle de una compra
confirmada tendría que leer una presentación que después se editó o se retiró — una lectura sin
el filtro de `eliminado_el` que además cambiaría un número ya confirmado. Con lo congelado: una
compra confirmada con "Caja (12)" sigue diciendo 12 aunque la caja pase a 6, y **corregir la
cantidad usa el congelado, nunca el vivo** (bajar de 10 a 8 cajas saca 24 unidades, no 12, si la
caja cambió a 6 después de confirmar).

**`unidad_codigo` queda NULL en vez de rellenarse con la unidad base** cuando la línea va en
presentación (`CHECK chk_compra_lineas_unidad_o_presentacion`: exactamente una de las dos). Es a
propósito: un camino que se olvidara de la presentación y asumiera `unidad_codigo` revienta en la
conversión (con `null`) en vez de leer "10 cajas" como 10 unidades sin aviso.

**El único lugar que calcula la cantidad base de una línea** es `cantidadEnBase`
(`compras.service.ts`, función pura y exportada, junto a sus tres llamadores): la validación del
borrador, confirmar y la corrección de cantidad pasan por ahí. Si alguno convirtiera por su
cuenta, ese sería el camino que lee cajas como unidades.

| Situación | Resultado |
|---|---|
| Presentación retirada entre el borrador y confirmar | 400 al confirmar, nombra el producto (`"<nombre>" ya no existe o fue retirada: elegí otra unidad`); no entra nada, la compra sigue en borrador |
| Presentación de otro proveedor | 400 al guardar el borrador |
| Presentación de otro producto (de la línea) | 400 al guardar el borrador |
| Producto por serie | 400 al crear la presentación y al usarla en una línea: igual hay que tipear cada serie, así que la caja no ahorra nada |
| Producto por lote | Se acepta: el lote entero entra en una línea (10 cajas de 12 del lote L123 → 120 en ese lote) |
| Presentación editada antes de confirmar (el borrador la usa) | El borrador toma la que esté "ese día": creada con 24, editada a 12 antes de confirmar → entran 120 |
| Retirar una presentación de una compra ya confirmada | No cambia el detalle: lo congelado no se mueve |

**El body de la línea** (`POST /compras`, `PATCH /compras/:id`):

```
{ itemId, cantidad, precioUnitario?, series?, lote?, unidadCodigo?, presentacionId? }
```

con exactamente una de `unidadCodigo` / `presentacionId`.

**El detalle de la compra** (`GET /compras/:id`), por línea, suma:

```ts
unidadCodigo: string | null;          // null si va en presentación
presentacion: { id, nombre, contenido, unidadCodigo } | null;
```

En un borrador, `presentacion` sale de la presentación viva (o `null` si fue retirada — la
pantalla la muestra sin unidad y pide elegir otra; no se lee la fila borrada). En una confirmada
sale de lo congelado, con `contenido` y `unidadCodigo` en la unidad base del producto.

Spec: [`2026-09-27-compras-unidad-de-compra-design.md`](../superpowers/specs/2026-09-27-compras-unidad-de-compra-design.md)
§ 3.2, § 4 y § 5.

### La pantalla (`pages/compras/[id].vue`)

- **El selector de unidad**, en cada línea, combina las unidades del catálogo con las
  presentaciones del proveedor para ese producto ("Caja (12)") y, al final, **"+ Nueva
  presentación…"** — deshabilitada sin proveedor o producto, ausente en serie (igual hay que
  tipear cada serie). Los tres valores se distinguen por prefijo (`u:<codigo>`, `p:<id>`,
  `nueva`); la traducción es de la página, no del composable, porque solo la usa ella.
- **"+ Nueva presentación…"** abre `PresentacionModal.vue` (molde: `DescuentoModal.vue`) para
  crear una: nombre, contenido y unidad (solo las compatibles con la base del producto; fija
  si la base es `unidad`). Al guardar, la línea la toma sola.
- **El lápiz** (junto al selector, solo si la línea tiene una presentación elegida) abre el
  mismo modal para corregirla o retirarla. Retirar pide confirmar **en el mismo modal** (un
  segundo botón *Sí, retirar*) y deja en la unidad base **toda línea que la usaba**, no solo
  la que abrió el modal.
- **La cuenta a la vista**, debajo de la línea (`cuentaPresentacion` en `useCompras.ts`):
  *"= 120 unidad · $800 c/u"*. No es el costo —el servidor lo calcula al confirmar, con la
  conversión de unidad y el descuento repartido— así que el costo por unidad se formatea con
  `formatCostoDisplay` (mismo criterio que el costo por unidad elegida del ajuste de stock,
  `docs/patterns/frontend.md` § 8): los decimales de la moneda oficial son el piso, no el
  techo, hasta `ESCALA_COSTO`. La función recibe la config de la moneda oficial como
  parámetro, no el store: `useCompras` sigue sin depender de Pinia.
- **Cambiar de proveedor** devuelve a la unidad base las líneas con presentación, con un
  toast que dice cuántas. Es un gesto explícito del `@update:model-value` del selector de
  proveedor, no un `watch` sobre `proveedorId` — un `watch` dispararía el mismo revert al
  **cargar** un borrador existente, que asigna `proveedorId` con el mismo mecanismo (mismo
  criterio que "cambiar el selector de unidad limpia el costo": `docs/patterns/frontend.md`
  § 8). Las presentaciones del proveedor sí se piden con un `watch` — ahí no hay side effect
  que distinga cargar de elegir, y es una sola llamada por proveedor, nunca por línea.
- **La compra confirmada** (`CompraConfirmada.vue`): la línea se lee *"10 Caja (12) · 120
  unidad"* (`cantidadLineaConfirmada`); el historial y `AnularCompraModal` muestran la unidad
  o la presentación con `unidadDeLinea`. `CorregirLineaModal` pide la cantidad en la unidad de
  la línea ("Cantidad (Caja (12))").

---

## La lectura del XML y el aprendizaje

Spec [`2026-09-27-compras-xml-dte-design.md`](../superpowers/specs/2026-09-27-compras-xml-dte-design.md):
el encargado sube el XML de la factura electrónica (DTE) del SII, desde **Nueva compra**, y el
borrador de siempre queda pre-llenado — nunca un segundo flujo. El XML se lee en el **navegador**
(`DOMParser`, `composables/useDte.ts`); al servidor viaja el JSON ya plano (`bodyLectura`), nunca
el archivo. Por eso el borrador sale tan confiable como uno tipeado a mano y pasa por las mismas
validaciones de `POST /compras`: no verificamos la firma digital del DTE (backlog), así que el
chequeo "la factura es para tu empresa" es un resguardo contra errores, no un control de
seguridad.

### El flujo

1. **El modal** (`components/compras/CargarDteModal.vue`) rechaza lo que no es un DTE: sin
   `Documento/Encabezado/IdDoc/TipoDTE`, más de 2 MB, o con `<!DOCTYPE`/`<!ENTITY` — XXE y "billion
   laughs" solo entran por ahí y un DTE nunca los trae. Si el envío trae varios documentos, el
   encargado elige cuál.
2. `POST /compras/dte/lectura` (abajo) resuelve el proveedor por RUT, el tipo de documento, si el
   folio ya está cargado y qué asociaciones ya conoce `codigos_proveedor`.
3. **Bloqueos**, con el mensaje exacto: el RUT receptor no es una razón social del tenant; el tipo
   es nota de crédito/débito (56/61 — fiscal y deuda, van aparte) o no tiene fila; la factura ya
   está cargada (con un botón **Abrir**, que navega a ella); el RUT del emisor no calza con ningún
   proveedor — ahí el encargado elige uno (`proveedorId`), y "no encontramos el RUT…, pedile a
   quien tenga el módulo Terceros que lo cree" si no hay candidatos.
4. Sin bloqueo, el formulario de siempre se pre-llena: proveedor, tipo de documento, folio, fecha
   del documento. **La ubicación ("Entra a") nunca se pre-llena** — ni con el XML ni con la carga
   manual: a qué local o bodega entra la mercadería lo decide el encargado, la factura no lo dice.
5. Cada línea del XML llega con su texto (*"COCA COLA 350ML CJ12 · 10 CJ · $9.600"*, con el
   `PrcItem` de la factura) y una insignia: **"calzó por código"** si `codigos_proveedor` ya la
   conoce (producto y unidad/presentación pre-llenados) o **"por asociar"** si no (producto y
   unidad vacíos, cantidad y precio del XML). **El precio unitario editable** es `MontoItem ÷
   QtyItem`, que puede no ser igual al `PrcItem` del texto cuando la línea trae descuento o
   recargo (`DescuentoMonto`/`RecargoMonto`, Formato DTE pág. 41): ahí la línea muestra además
   "Incluye el descuento o recargo de la línea de la factura" para explicar la diferencia entre
   los dos números. Elegir el producto en una línea del XML **no** hereda su unidad base
   (`onSeleccionarItem`): "3 CJ" no es "3 unidad", y la real sale de elegirla — salvo serie/lote,
   que solo admiten la base de todos modos.
6. **"No es mercadería"** aparta una línea (flete, garantía de envase…) a una sección plegable,
   con **"Traer de vuelta"**; aparta **todas** las líneas con la misma clave, no solo la que abrió
   el botón, y "Traer de vuelta" siempre vuelve por asociar. Las ya aprendidas como
   `no_mercaderia` llegan apartadas directamente, sin que nadie las toque.
7. El descuento de la factura se precarga con `descuentoDeFactura` — en $ tal cual, en % sobre la
   suma de `MontoItem` de las líneas con el mismo `IndExe` que el `IndExeDR` del descuento (afectas
   si los dos están ausentes) — **solo si** ninguna línea que HOY queda en la compra está sin precio
   y el documento no trae los precios con IVA incluido; si no, un aviso explica por qué no se cargó.
   Esto se reevalúa cada vez que cambian las líneas de la compra, no solo al leer: una línea sin
   precio (el flete, típicamente) puede seguir bloqueándolo hasta que se aparta con "No es
   mercadería", y ahí se destraba solo, sin que nadie toque el campo — se llena **como mucho una
   vez por lectura**, así que si el encargado ya tipeó o borró el descuento a mano no se pisa. Un
   recargo global no se carga (la compra no tiene recargos): aviso con el monto.
8. **Guardar** exige que toda línea del XML tenga producto y unidad o presentación, y cantidad
   (*"Faltan N líneas por asociar"*). Al guardar, cada línea con `claveProveedor` y las
   `apartadas` enseñan su destino — ver "Qué se aprende" abajo.
9. **Salir sin guardar** después de leer un XML pide confirmación (`onBeforeRouteLeave`,
   precedente `pages/salones/index.vue`, más `beforeunload` al cerrar la pestaña). Guardar limpia
   ese estado **antes** de navegar, para no frenar su propio redirect; un 409 de folio repetido al
   guardar no lo limpia, así que el guard sigue activo hasta que se corrija el folio. Solo aplica a
   una compra que vino del XML: la carga manual no pide nada de esto.

### `POST /compras/dte/lectura`

Bajo `JwtAuthGuard + TenantGuard + PermisosGuard`, permiso **Compras · Crear** (el mismo de
guardar el borrador) — es una lectura, pero va por POST por el tamaño del body.

```
body: { emisorRut, receptorRut, tipoDte, folio, proveedorId?, claves: string[] }
respuesta: {
  receptorEsDelTenant, proveedor, candidatos, tipoDocumento, compraExistente,
  asociaciones: { clave, destino: {itemId, presentacionId|unidadCodigo} | 'no_mercaderia' | null, nota? }[]
}
```

Consultas fijas, ninguna por línea: la razón social receptora, el proveedor por `rut`/`rut_fiscal`
(con o sin puntos), el tipo por código, la compra existente por (proveedor, tipo, folio, no
anulada), y las claves con `= ANY($1)`. `tenant_id` sale del token, nunca del body. Sin proveedor
resuelto, `asociaciones` sale vacía y la pantalla vuelve a llamar con el `proveedorId` elegido; con
`proveedorId`, un RUT que no calza con el guardado del proveedor es 400 — el mismo bloqueo que al
guardar.

### Qué se aprende, dónde y cuándo

**`codigos_proveedor`** (nueva): lo que el sistema aprendió de la factura de un proveedor — "su
código CC350-12 es la Coca-Cola en Caja (12)", o "su FLETE no es mercadería". Única viva por
`(tenant_id, proveedor_id, clave)` (índice único parcial); **reaprender no pisa**: marca la fila
vieja con `eliminado_el` e inserta otra (el owner pide reversibilidad), y con el **mismo** destino
no escribe nada.

Se aprende **al guardar el borrador** (`POST /compras` y `PATCH /compras/:id`), en la misma
transacción — no al confirmar: con "se asocia todo antes de guardar" (decisión del owner),
guardar es el primer momento en que todo está decidido.

- Cada **línea** con `claveProveedor` (+ `descripcionProveedor`) enseña su destino: el `itemId` de
  la línea, con su `presentacionId` o su `unidadCodigo` (los dos ya validados como del proveedor y
  del producto). Una línea tipeada a mano, sin clave, no toca la tabla.
- El body puede traer **`apartadas: [{ clave, descripcion }]`** (hasta 60): las líneas del XML
  marcadas "no es mercadería" se aprenden con `no_mercaderia = true`, no se cargan como línea.
- **`rutProveedor`** (proveedor elegido a mano porque el RUT del XML no calzó): si tenía `rut` y
  `rut_fiscal` vacíos, se guarda en `rut_fiscal` tal como vino en el XML; si tenía alguno y
  ninguno calza, 400 (el mismo mensaje de la lectura) y el borrador no se guarda.
- La misma clave usada dos veces en la misma factura para destinos distintos (una línea y una
  apartada, por ejemplo) es 400 que nombra la clave: es un error de captura, no algo que el sistema
  pueda decidir por su cuenta.
- Tres statements fijos por guardado (`SELECT … FOR UPDATE` de las vivas que la factura toca,
  `UPDATE` de las que cambian de destino, `INSERT` de las nuevas), nunca uno por línea. Sin claves
  ni apartadas, no consulta nada.
- **Confirmar, el kardex y el CPP no cambian:** el aprendizaje no altera qué se recibe ni cómo se
  costea.

Se **usa** al leer (`POST /compras/dte/lectura`, arriba): si el destino se retiró o se borró
después, la línea llega **por asociar** con una nota genérica ("la presentación a la que apuntaba
fue retirada" / "el producto al que apuntaba ya no está") — la nota no nombra la fila retirada a
propósito: nombrarla obligaría a leerla sin el filtro de `eliminado_el` (invariante 3) para un
texto de ayuda.

### La pantalla

`components/compras/CargarDteModal.vue` (el modal) y `pages/compras/[id].vue` (el formulario
pre-llenado, con la franja *"Cargado desde la factura 33 N° 123 · Distribuidora Andina · Aceptar
o reclamar esta factura se sigue haciendo en el SII"* y los avisos debajo). El lector (bytes →
documento) y la aplicación de la respuesta del servidor a las líneas del formulario son funciones
puras en `composables/useDte.ts` (`leerDte`, `bodyLectura`, `repartirLineas`,
`lineaFormDesdeDte`, `descuentoDeFactura`, `precargaDescuento`, `debeLlenarDescuentoDte`,
`textoLinea`, `mensajeCompraExistente`) — la página solo las cablea, sin lógica de negocio propia
(`docs/patterns/frontend.md`). El descuento (`precargaDescuento`) se recalcula en un `computed`
reactivo a las líneas que quedan en la compra, no una sola vez al leer (F1, ronda 1); llenar el
campo solo una vez por lectura es `debeLlenarDescuentoDte`.

**No cambia:** el listado, la compra confirmada, corregir, anular. Guardada, la compra no guarda
que vino del XML.

### Testing

- **Unitario, el lector (`useDte.spec.ts`, con `happy-dom`):** tildes en ISO-8859-1; un envío con
  varios documentos y un DTE suelto; `<!DOCTYPE` y un archivo que no es DTE, rechazados; el precio
  con el descuento de la línea ($9.120, no $9.600); `MntBruto=1` sin precios; descuento global en
  $ y en % (2% de $105.000 = $2.100); un recargo → aviso; una línea sin código → clave por texto.
- **E2E de la API (`compras-dte.e2e-spec.ts`, y el guardado en `compras.e2e-spec.ts`):** proveedor
  por `rut`/`rut_fiscal`, con y sin puntos; desconocido y dos con el mismo RUT → pregunta; receptor
  de otra empresa → bloqueado; nota de crédito → sin tipo; folio en borrador/confirmada → ya
  cargada, en anulada → libre; código hacia una presentación retirada → por asociar con nota;
  reaprender deja la anterior con `eliminado_el`; el RUT se guarda solo si estaba vacío, otro RUT →
  400; una línea manual no enseña; aislamiento por tenant y permisos (403 sin Crear).
- **Front, componente:** `CargarDteModal.nuxt.spec.ts` (los cinco bloqueos; el body exacto de
  `POST /compras/dte/lectura` contra lo que declara el DTO, porque el mock de `useApiFetch`
  contesta 200 a cualquier cosa) y `compras-carga.nuxt.spec.ts` (el pre-llenado, las líneas por
  asociar y apartadas, `armarBody` sin esparcir el documento entero, el guard de salida).
- **Navegador (`compras-dte.spec.ts`):** como `encargado.compras`, con un XML de fixture propio
  (`e2e/compras/fixtures/andina-dte.xml`, en ISO-8859-1, con una tilde) y RUT/folio generados por
  corrida — así no depende del seed ni de una corrida anterior. Primera factura: la Coca (con su
  "Caja (12)" ya creada por API) llega por asociar y se asocia; la Fanta se asocia a su producto y
  a una Caja (12) creada desde la línea; el flete va a "No es mercadería"; confirmar sube el stock
  (+120). Segunda factura, otro folio: las dos líneas llegan **calzadas por código**, con el flete
  ya apartado, sin tocar nada salvo la ubicación (que el XML nunca precarga). Un 409 de folio
  repetido al guardar no pierde el formulario ni suelta el guard de salida — se corrige el folio y
  guarda igual. Subir otra vez la primera factura → "ya está cargada", con **Abrir**. Salir con el
  XML leído sin guardar → pide confirmación.

---

## El orden de bloqueo

Todo lo que mueve stock en compras bloquea en el orden de `docs/patterns/backend.md` §15:
**la compra** (`FOR UPDATE`) → **la ubicación** (`bloquearContraBorrado`, `FOR SHARE`) → **todos
los productos de la compra**, en un solo statement ordenado por `item_id` → los movimientos → las
cuentas, también por `item_id`. Confirmar, corregir la cantidad y anular toman el lock de todos
los productos **antes** de mover, porque el recosteo puede rehacer la cuenta de otros productos de
la misma compra y los tomaría fuera de orden.

---

## Bordes

- **La bodega de la compra se vació y se borró** antes de que llegue la factura: la
  `correccion_compra` va al local (el lock da 404 sobre una ubicación borrada). Corregir la
  cantidad o anular sobre una ubicación borrada es 400.
- **Bajar una cantidad o anular lo que ya salió:** 400 con el producto, la ubicación y cuánto
  queda. En lote decide el saldo **del lote**, no el del producto. Anular es todo o nada.
- **Un lote que ya no existe:** bajar o anular es 400, en vez de salir de otro lote por FIFO.
- **Un producto en la papelera:** corregir o anular es 400.
- **El descuento** exige todas las líneas con precio y no puede superar el total. Un 0 es "sin
  descuento". Un descuento por la factura entera deja la mercadería a $0, y ese 0 es elegido; un
  0,0000 que deja una conversión, sola o con un descuento parcial, es 400.

---

## API Endpoints

Todas bajo `JwtAuthGuard + TenantGuard + PermisosGuard`, con el `tenant_id` del token.

| Endpoint | Permiso |
|---|---|
| `GET /compras` (paginado; filtros `estado`, `proveedorId`, `faltaCosto`, `desde`, `hasta`, `estadoPago`) — con `Pagar` suma `estadoPago`/`deuda`/`vencida` por fila (ver [Confirmar con pago, el recorte y las lecturas de deuda](#confirmar-con-pago-el-recorte-y-las-lecturas-de-deuda-pieza-5-tarea-3)); `estadoPago` es 403 sin `Pagar` | Leer |
| `GET /compras/:id`: encabezado, líneas, historial y motivo de anulación — con `Pagar` suma `aplicado` y `pagos` | Leer |
| `GET /compras/tipos-documento` · `GET /compras/proveedores` | Leer |
| `GET /compras/productos`: productos e ingredientes con stock, lo que se puede comprar | Crear |
| `GET /compras/:id/lineas/:lineaId/unidades`: las series de la línea, disponibles en su ubicación | Actualizar |
| `POST /compras` · `PATCH /compras/:id` (reemplaza el borrador entero) · `DELETE /compras/:id` | Crear |
| `POST /compras/:id/confirmar` con `{ pago? }` opcional (con `Idempotency-Key` solo si viene `pago`) | Crear (+ `Pagar` si viene `pago`) |
| `PATCH /compras/:id/lineas/:lineaId` con `{ precioUnitario?, cantidad?, series?, unidadIds? }` | Actualizar |
| `PATCH /compras/:id/descuento` con `{ descuentoTotal }` (clave obligatoria; `null` lo quita) | Actualizar |
| `PATCH /compras/:id/documento` con `{ totalDocumento?, fechaVencimiento? }` (ausente no toca; ver [La deuda con el proveedor](#la-deuda-con-el-proveedor-pieza-5)) | Actualizar |
| `POST /compras/:id/anular` con `{ motivo }` | Anular |
| `GET /compras/medios-pago`: los medios habilitados del tenant, con `esEfectivo` | Pagar |
| `GET /compras/por-pagar`: una fila por proveedor con lo que se debe (ver [Confirmar con pago, el recorte y las lecturas de deuda](#confirmar-con-pago-el-recorte-y-las-lecturas-de-deuda-pieza-5-tarea-3)) | Pagar |
| `GET /compras/por-pagar/:proveedorId`: sus compras con deuda y sus pagos con saldo a favor | Pagar |
| `GET /compras/pagos?proveedorId=`: los pagos del proveedor, con sus aplicaciones | Pagar |
| `POST /compras/pagos` (con `Idempotency-Key`) con `{ proveedorId, monto, metodoPagoId?, referencia?, aplicaciones }` (ver [Pagar y anular un pago](#pagar-y-anular-un-pago-pieza-5-tarea-2)) | Pagar |
| `POST /compras/pagos/:id/anular` con `{ motivo }` | Pagar |
| `GET /compras/presentaciones?proveedorId=`: las vivas del proveedor | Crear |
| `POST /compras/presentaciones` con `{ proveedorId, itemId, nombre, contenido, unidadCodigo }` | Crear |
| `PATCH /compras/presentaciones/:id` con `{ nombre?, contenido?, unidadCodigo? }` (ausente no toca; `null` es 400) | Crear |
| `DELETE /compras/presentaciones/:id` (204; retira, marca `eliminado_el`) | Crear |
| `POST /compras/dte/lectura` con `{ emisorRut, receptorRut, tipoDte, folio, proveedorId?, claves }`: lo que el sistema sabe de una factura leída en el navegador (ver [La lectura del XML y el aprendizaje](#la-lectura-del-xml-y-el-aprendizaje)) | Crear |

**Las cuatro rutas de `presentaciones` son pieza 2** (spec compras-unidad-de-compra § 5): cómo le
viene un producto a un proveedor ("Caja (12)", "Saco (25 kg)"), por (proveedor, producto). `Crear`
en las cuatro porque se crean, corrigen y retiran en plena carga del borrador — es operación del
módulo, no configuración del admin. Nombre repetido entre las vivas del mismo par: 409. Proveedor
que no es proveedor vivo, producto sin stock, por serie o contenido fuera de la unidad
compatible/precisión: 400.

**Las listas que usa la pantalla son de Compras, no de Ítems** (owner, 2026-09-19): quien recibe
mercadería elige el producto sin permiso sobre el catálogo, que muestra precios de venta y deja
editarlos. Con `/items`, el encargado de compras recibía 403 y no podía cargar una compra.

`precioUnitario` va a escala de costo (`@EsCosto`); `descuentoTotal`, a la de la moneda
(`@EsMontoCobrado`), las dos con `EscalaMonedaPipe`. En la corrección de línea, precio y cantidad
**no aceptan null**: ausente es "no se toca".

---

## Backend

- **Módulo:** `backend/src/modules/compras/` (`ComprasService`, `ComprasController`,
  `reparto-descuento.ts`).
- **Tablas:** `compras` (encabezado; `folio` único por proveedor y tipo salvo anuladas;
  `total_documento`/`fecha_vencimiento` de la pieza 5), `compra_lineas` (con lo congelado al
  confirmar: `cantidad_base`, `costo_unitario_base`, `movimiento_id`, `stock_total_anterior`,
  `costo_producto_anterior`), `compra_linea_cambios` (historial append-only) y
  `tipos_documento_compra` (catálogo por país; `total_documento` clasifica el tipo, pieza 5).
  `terceros.plazo_pago_dias` (pieza 5). `pagos_proveedor` y `pago_proveedor_aplicaciones` (tarea
  2, ver [Pagar y anular un pago](#pagar-y-anular-un-pago-pieza-5-tarea-2)).
  `movimientos_caja.pago_proveedor_id` (tarea 2, en `backend/src/modules/caja/`).
- **Kardex:** `movimientos_inventario` gana `compra_linea_id`, `secuencia` (bigserial, el orden de
  aplicación) y `costo_informado`, y el motivo `correccion_compra`.
- **`compras/deuda.ts`** (pieza 5): `vencimiento` y `totalCompra` (tarea 1), `fondear` (tarea
  2), y `recortar` + `estadoPagoCompra` (tarea 3) — todas puras y con sus unitarios. Ver
  [La deuda con el proveedor](#la-deuda-con-el-proveedor-pieza-5),
  [Pagar y anular un pago](#pagar-y-anular-un-pago-pieza-5-tarea-2) y
  [Confirmar con pago, el recorte y las lecturas de deuda](#confirmar-con-pago-el-recorte-y-las-lecturas-de-deuda-pieza-5-tarea-3).
  `huella.ts` suma la operación `'compras.confirmar'` (confirmar con `pago`, distinta de
  `'compras.pago'` de `POST /compras/pagos`).
- **Seed:** módulo `Compras` y sus permisos, el rol `Compras · Encargado` y tres fixtures
  parciales para los 403 (`compras.lectura`, `compras.carga`, `compras.correccion`). Ids
  420–446. El permiso `Pagar`, su entrada en `Compras` y el rol/fixture `Compras · Paga` /
  `compras.paga` (pieza 5, tarea 1): ids 452–455. **Bug de la tarea 1, cerrado en la tarea 2:**
  `compras.paga` tenía rol y permisos pero le faltaba la fila en `usuarios_tenants` — sin ella,
  `switch-tenant` daba 403 antes de llegar a ningún guard. El fixture no tenía consumidor hasta
  el e2e de pagar (`compras-pagos.e2e-spec.ts`), que fue quien lo encontró.

## Frontend

- `pages/compras/index.vue`: el listado, con las insignias *Borrador*, *Confirmada*, *Anulada* y
  **Falta costo**, y sus filtros. De la pieza 5 (tarea 5): la columna **Pago** (insignia) y el
  filtro "Estado de pago", solo con `Compras:Pagar`.
- `pages/compras/[id].vue`: la carga del borrador —selector de unidad y presentación, el lápiz,
  la cuenta a la vista (pieza 2 § 6, ver arriba)— y el modal de confirmar con el resumen. De la
  pieza 5: "Total del documento" (requerido/opcional/oculto según el tipo) y "Vence el" (sugerida
  desde el plazo del proveedor, editable).
- `pages/compras/por-pagar.vue` (pieza 5, tarea 5, nueva): la pantalla del dueño — ver
  ["Por pagar", pagar, anular y el cierre del frente](#por-pagar-pagar-anular-y-el-cierre-del-frente-pieza-5-tarea-5).
- `components/compras/PresentacionModal.vue`: crear, corregir y retirar una presentación
  (pieza 2). `presentacion: null` crea; con una, edita.
- `components/compras/CompraConfirmada.vue`: el detalle de una confirmada, con
  `CorregirLineaModal`, `DescuentoModal` y `AnularCompraModal`. Cada acción aparece solo con su
  permiso. De la pieza 5 (tarea 5): el botón "Pagar" (con `PagarProveedorModal`) cuando queda
  deuda y hay `Pagar`.
- `components/compras/PagarProveedorModal.vue` y `AnularPagoModal.vue` (pieza 5, tarea 5,
  nuevos): ver la sección de la tarea 5.
- `composables/useCompras.ts`: los tipos del detalle y lo que se manda (`cuerpoCorreccion`,
  `cuerpoDescuento`), fuera de los `.vue`. De la pieza 2: `etiquetaPresentacion`,
  `unidadDeLinea`, `cuentaPresentacion` y `cantidadLineaConfirmada`. De la pieza 5:
  `cuerpoDocumento` (el pedazo del body de `totalDocumento`/`fechaVencimiento`),
  `fechaVencimientoSugerida` (espejo en JS de `deuda.ts → vencimiento`, sin la tipeada) y, de la
  tarea 5, `proponerReparto` (la propuesta de reparto de `PagarProveedorModal`, pura).
- `composables/useMenuLateral.ts` (pieza 5, tarea 5, entonces en `layouts/dashboard.vue`): la entrada "Por pagar" del grupo Compras, gateada con
  `Compras:Pagar` (no con `Leer`, a diferencia del resto de Compras — ver la sección de la
  tarea 5).

---

## Testing

- **Unitarios:** `compras.service.spec.ts` (incluye el orden de locks de pagar/anular y las
  validaciones de la tarea 2), `deuda.spec.ts` (`vencimiento`, `totalCompra`, `fondear`),
  `inventario.service.spec.ts` (la cuenta rehecha, con los números de la spec),
  `reparto-descuento.spec.ts`, `lectura-dte.service.spec.ts` (`planAprendizaje`, `normalizarRut`)
  y `useDte.spec.ts` (el lector del XML, front).
- **E2E de la API:** `test/compras.e2e-spec.ts` (borrador, confirmar, rehacer la cuenta, corregir,
  anular, permisos y aislamiento — incluye el fixture `compras.paga` como primer consumidor de
  `usuarios_tenants`), `test/compras-pagos.e2e-spec.ts` (tarea 2: fondeo, anticipo, usar el saldo
  con `monto` 0, efectivo con y sin caja, el rastro de un rechazo, anular con la caja abierta/
  cerrada/ajena, la idempotencia, los permisos y el aislamiento), `test/kardex-secuencia.e2e-spec.ts`
  (la secuencia sigue el orden de aplicación bajo concurrencia) y `test/compras-dte.e2e-spec.ts`
  (la lectura del XML y el aprendizaje al guardar).
- **Front:** los specs de componente de `components/compras/` (incluido
  `PresentacionModal.nuxt.spec.ts`, `CargarDteModal.nuxt.spec.ts`, `PagarProveedorModal.nuxt.spec.ts`
  y `AnularPagoModal.nuxt.spec.ts`), `compras-carga.nuxt.spec.ts`, `compras/index.nuxt.spec.ts` y
  `compras/por-pagar.nuxt.spec.ts`.
- **Navegador:** `frontend/e2e/compras/compras-por-pantalla.spec.ts` — los pasos del smoke,
  como el encargado, más el test de que la lista de productos del formulario es la de Compras
  y no el catálogo de ítems —, `compras-presentacion.spec.ts` (pieza 2): crear una
  presentación desde la línea, confirmar y corregir en cajas, y el lápiz corrigiendo el
  contenido antes de confirmar; `compras-dte.spec.ts` (piezas 3-4): cargar, aprender y calzar
  solo desde el XML; `compras-deuda-proveedor.spec.ts` (pieza 5, tarea 5, como `compras.paga`):
  pagar al confirmar con el efectivo bajando de verdad en su caja, y pagar dos compras desde
  "Por pagar"; y `compras-deuda-proveedor-bodeguero.spec.ts` (como `encargado.compras`, sin
  `Pagar`): sin "¿la pagaste ya?", sin "Por pagar" en la navegación ni en la insignia del
  listado, y el middleware de ruta frenando la URL directa. Ver
  [El smoke, automatizado](#el-smoke-automatizado).

---

## El smoke, automatizado

Los pasos que antes se recorrían a mano —los que enumera la tabla de abajo— viven en
[`compras-por-pantalla.spec.ts`](../../frontend/e2e/compras/compras-por-pantalla.spec.ts).
Piden el stack arriba (`docker-compose up`) y la base recién sembrada
(`./scripts/reset-db.sh`), y desde `frontend/` se corren con:

```bash
npm run e2e -- e2e/compras/
```

**Entra como `encargado.compras` / `admin`, no como admin del tenant**, y eso no es
decoración: con admin, que lo puede todo, un 403 en una ruta de otro módulo no se ve —pasó,
la carga del borrador pedía `/items` y el encargado no podía cargar una compra—. El spec
descarta la sesión de admin que deja `auth.setup.ts` y entra por la pantalla de login.

| Paso | Qué asevera por pantalla | Test |
|---|---|---|
| 1 · Cargar con una línea sin precio | El formulario entero: proveedor, documento con folio, ubicación y dos líneas. Queda **Borrador**, y el listado **todavía no** dice *Falta costo* (ver abajo) | *cargar con una línea sin precio y confirmar* |
| 2 · Confirmar así | El resumen dice cuántas líneas entran y adónde **antes** de mover stock. Entran las dos, la que va sin precio deja el costo promedio donde estaba, y **ahí sí** el listado marca *Falta costo* | *cargar con una línea sin precio y confirmar* |
| 3 · Completar el precio | La insignia se apaga, el historial lo anota y recién ahí se ofrece el descuento | *completar el precio, cargar el descuento y anular* |
| 4 · Bajar una cantidad | El historial lo anota **como cantidad con su unidad**, no como plata; el stock baja y el costo se rehace | *bajar una cantidad…* |
| 4b · Bajar sin saldo | El 400 llega a la pantalla **con el número** («quedan 2»), el modal sigue abierto y la línea no se movió | *bajar por debajo de lo que queda…* |
| 5 · Anular | Frena, resume lo que sale, exige motivo, y después lo deja a la vista sin dejar corregir | *completar el precio, cargar el descuento y anular* |
| 6 · Crear una presentación desde la línea, confirmar y corregir en cajas (pieza 2) | El selector queda en "Caja (12)" tras crearla; la línea muestra "= 120 unidad"; la confirmada dice "10 Caja (12) · 120 unidad"; corregir pide la cantidad en cajas y el historial la anota así; por API, el stock y el costo quedan en la unidad base | `compras-presentacion.spec.ts` |
| 7 · El lápiz corrige la presentación antes de confirmar (pieza 2) | Creada con 24 por API, el lápiz la corrige a 12 en pantalla; la cuenta pasa a "= 120 unidad"; el borrador confirmado entra con 120, no con 240 | `compras-presentacion.spec.ts` |
| 8 · Cargar la primera factura desde el XML (piezas 3-4) | La Coca (con su "Caja (12)" ya creada por API) llega **por asociar** y se asocia; la Fanta se asocia a su producto y a una Caja (12) creada desde la línea; el flete se aparta con "No es mercadería"; confirmar sube el stock (+120) | `compras-dte.spec.ts` |
| 9 · La segunda factura calza sola, y el 409 de folio repetido no pierde el formulario | Otro folio, mismo proveedor: las dos líneas llegan **calzadas por código**, con el flete ya apartado, sin tocar nada salvo la ubicación; un folio repetido al guardar muestra el 409 sin perder lo tipeado y sin soltar el guard de salida; subir de nuevo la primera factura → "ya está cargada", con **Abrir**; salir con el XML leído sin guardar → pide confirmación | `compras-dte.spec.ts` |

⚠️ **Corrección al smoke viejo:** decía que un **borrador** sin precio aparece en el listado
con la insignia *Falta costo*. No es así, y el código nunca lo hizo: `mapCabecera` la calcula
como `estado === 'confirmada' && sinPrecio`, y el filtro *«Solo las que les falta costo»* usa
la misma condición. Es coherente con lo que la insignia significa —mercadería que **ya entró**
con un costo sin completar—: un borrador no movió stock ni costo, así que no le debe nada a
nadie. El test lo afirma en las dos direcciones, y por eso el paso 1 y el 2 se leen juntos.

El control transversal —**Inventario → movimientos**, donde cada corrección deja **su propia
fila** en vez de reescribir las anteriores— lo asevera el test del paso 4, y lo mira **como
admin, en un contexto aparte**: el encargado de compras no tiene el módulo Inventario, así
que con su sesión eso sería probar un 403.

**Qué no duplica, y por qué.** Las cuentas —el CPP, el reparto del descuento, y **qué número
trae** el 400 cuando no queda saldo— las prueba `backend/test/compras.e2e-spec.ts`. Repetirlas
por navegador costaría minutos y no atajaría ningún bug que la API deje pasar. ⚠️ **Ojo con la
tentación de leer eso de más:** que ese mensaje **llegue a la pantalla** sí se asevera acá
(fila 4b), y no es lo mismo — depende de que `apiErrorMsg` desenvuelva el error de `$fetch`, y
si eso se rompe el encargado lee "Error al corregir la línea" a secas mientras el gate de la
API sigue en verde. El *contenido* del mensaje es de la API; la *entrega*, del navegador. Por
pantalla se asevera lo que **solo
puede romperse del lado del cliente**: el cuerpo que arma el formulario (un precio vacío que
viajara como `0` sería un precio de regalo perfectamente válido para la API, y ensuciaría el
costo promedio sin que ningún test de API lo notara, porque la API nunca manda `''`), lo que
la pantalla dice antes y después de mover plata, y que cada acción le llegue al rol que la
ejecuta. Lo que el servidor decidió se lee una sola vez al final, por API.

**Los datos los crea el propio spec** —productos, proveedor y stock previo, por API como
admin—: del seed usa el usuario, el local del tenant y los tipos de documento. No depende de
*Distribuidora Andina* ni del stock de los productos demo, que se agota entre corridas.

---

## Related Features

- [bodegas-y-traslados.md](./bodegas-y-traslados.md): el stock por ubicación y el orden de
  bloqueo.
- [ADR-016](../adr/016-costeo-promedio-ponderado-movil.md): el CPP, que pondera con el stock total
  del producto.
- [inventario-serializado.md](./inventario-serializado.md): serie y lote.
