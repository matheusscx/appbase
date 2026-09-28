# Feature: Compras — recibir mercadería (pieza 1)

**Status**: Complete (piezas 1 a 4); pieza 5 (la deuda con el proveedor) en curso — tarea 1 de
`docs/superpowers/plans/2026-09-28-compras-deuda-proveedor.md`
**Last Updated**: 2026-09-28

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
- **Pieza 5 (en curso):** cada compra confirmada deja deuda con su proveedor, con vencimiento; el
  total del documento, cuando el tipo lo lleva, es el transcrito (nunca calculado). Sección:
  [La deuda con el proveedor](#la-deuda-con-el-proveedor-pieza-5). Spec:
  [`2026-09-28-compras-deuda-proveedor-design.md`](../superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md).
- **Piezas siguientes, cada una con su spec:** los pagos a proveedores (dentro de la pieza 5) y los
  gastos sin stock.
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

Spec: [`2026-09-28-compras-deuda-proveedor-design.md`](../superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md).
**Solo la tarea 1: el modelo, el total y el vencimiento.** Los pagos (`pagos_proveedor`,
`POST /compras/pagos`, "Por pagar") llegan en tareas siguientes del mismo frente.

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

### Permisos de esta tarea

`PATCH /compras/:id/documento` va con `Actualizar` (no con el `Pagar` nuevo): corregir lo
transcrito es lo mismo que corregir un precio, y las dos tareas ya podían hacerlo. El permiso
`Pagar` se siembra en esta tarea (acción del módulo `Compras`, y un fixture `compras.paga`) pero
**ningún endpoint lo exige todavía** — lo usan `POST /compras/pagos`, `GET /compras/por-pagar` y
los datos de pago del listado/detalle, en las tareas siguientes. El rol `Compras · Encargado`
arranca **sin** `Pagar` a propósito (spec § 9, decisión 7b): "el bodeguero recibe, el dueño paga".

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
| `GET /compras` (paginado; filtros `estado`, `proveedorId`, `faltaCosto`, `desde`, `hasta`) | Leer |
| `GET /compras/:id`: encabezado, líneas, historial y motivo de anulación | Leer |
| `GET /compras/tipos-documento` · `GET /compras/proveedores` | Leer |
| `GET /compras/productos`: productos e ingredientes con stock, lo que se puede comprar | Crear |
| `GET /compras/:id/lineas/:lineaId/unidades`: las series de la línea, disponibles en su ubicación | Actualizar |
| `POST /compras` · `PATCH /compras/:id` (reemplaza el borrador entero) · `DELETE /compras/:id` | Crear |
| `POST /compras/:id/confirmar` | Crear |
| `PATCH /compras/:id/lineas/:lineaId` con `{ precioUnitario?, cantidad?, series?, unidadIds? }` | Actualizar |
| `PATCH /compras/:id/descuento` con `{ descuentoTotal }` (clave obligatoria; `null` lo quita) | Actualizar |
| `PATCH /compras/:id/documento` con `{ totalDocumento?, fechaVencimiento? }` (ausente no toca; ver [La deuda con el proveedor](#la-deuda-con-el-proveedor-pieza-5)) | Actualizar |
| `POST /compras/:id/anular` con `{ motivo }` | Anular |
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
  `terceros.plazo_pago_dias` (pieza 5).
- **Kardex:** `movimientos_inventario` gana `compra_linea_id`, `secuencia` (bigserial, el orden de
  aplicación) y `costo_informado`, y el motivo `correccion_compra`.
- **`compras/deuda.ts`** (pieza 5): `vencimiento` y `totalCompra`, puras y con sus unitarios — ver
  [La deuda con el proveedor](#la-deuda-con-el-proveedor-pieza-5).
- **Seed:** módulo `Compras` y sus permisos, el rol `Compras · Encargado` y tres fixtures
  parciales para los 403 (`compras.lectura`, `compras.carga`, `compras.correccion`). Ids
  420–446. El permiso `Pagar`, su entrada en `Compras` y el rol/fixture `Compras · Paga` /
  `compras.paga` (pieza 5, tarea 1): ids 452–455.

## Frontend

- `pages/compras/index.vue`: el listado, con las insignias *Borrador*, *Confirmada*, *Anulada* y
  **Falta costo**, y sus filtros.
- `pages/compras/[id].vue`: la carga del borrador —selector de unidad y presentación, el lápiz,
  la cuenta a la vista (pieza 2 § 6, ver arriba)— y el modal de confirmar con el resumen. De la
  pieza 5: "Total del documento" (requerido/opcional/oculto según el tipo) y "Vence el" (sugerida
  desde el plazo del proveedor, editable).
- `components/compras/PresentacionModal.vue`: crear, corregir y retirar una presentación
  (pieza 2). `presentacion: null` crea; con una, edita.
- `components/compras/CompraConfirmada.vue`: el detalle de una confirmada, con
  `CorregirLineaModal`, `DescuentoModal` y `AnularCompraModal`. Cada acción aparece solo con su
  permiso.
- `composables/useCompras.ts`: los tipos del detalle y lo que se manda (`cuerpoCorreccion`,
  `cuerpoDescuento`), fuera de los `.vue`. De la pieza 2: `etiquetaPresentacion`,
  `unidadDeLinea`, `cuentaPresentacion` y `cantidadLineaConfirmada`. De la pieza 5:
  `cuerpoDocumento` (el pedazo del body de `totalDocumento`/`fechaVencimiento`) y
  `fechaVencimientoSugerida` (espejo en JS de `deuda.ts → vencimiento`, sin la tipeada).

---

## Testing

- **Unitarios:** `compras.service.spec.ts`, `inventario.service.spec.ts` (la cuenta rehecha, con
  los números de la spec), `reparto-descuento.spec.ts`, `lectura-dte.service.spec.ts`
  (`planAprendizaje`, `normalizarRut`) y `useDte.spec.ts` (el lector del XML, front).
- **E2E de la API:** `test/compras.e2e-spec.ts` (borrador, confirmar, rehacer la cuenta, corregir,
  anular, permisos y aislamiento), `test/kardex-secuencia.e2e-spec.ts` (la secuencia sigue el
  orden de aplicación bajo concurrencia) y `test/compras-dte.e2e-spec.ts` (la lectura del XML y el
  aprendizaje al guardar).
- **Front:** los specs de componente de `components/compras/` (incluido
  `PresentacionModal.nuxt.spec.ts` y `CargarDteModal.nuxt.spec.ts`) y `compras-carga.nuxt.spec.ts`.
- **Navegador:** `frontend/e2e/compras/compras-por-pantalla.spec.ts` — los pasos del smoke,
  como el encargado, más el test de que la lista de productos del formulario es la de Compras
  y no el catálogo de ítems —, `compras-presentacion.spec.ts` (pieza 2): crear una
  presentación desde la línea, confirmar y corregir en cajas, y el lápiz corrigiendo el
  contenido antes de confirmar; y `compras-dte.spec.ts` (piezas 3-4): cargar, aprender y calzar
  solo desde el XML. Ver [El smoke, automatizado](#el-smoke-automatizado).

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
