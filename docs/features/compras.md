# Feature: Compras — recibir mercadería (pieza 1)

**Status**: Complete (piezas 1 y 2 de 4)
**Last Updated**: 2026-09-27

Spec: [`2026-09-18-compras-recepcion-design.md`](../superpowers/specs/2026-09-18-compras-recepcion-design.md) ·
plan: [`2026-09-18-compras-recepcion.md`](../superpowers/plans/2026-09-18-compras-recepcion.md) ·
decisiones del owner: [`investigaciones/2026-09-18-compras.md`](../agent/investigaciones/2026-09-18-compras.md) § 5.

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
- **Pieza 2 (en construcción):** la unidad de compra por proveedor ("Caja (12)", "Saco (25 kg)"):
  tabla `presentaciones_compra`, su CRUD (`GET/POST/PATCH/DELETE /compras/presentaciones`) y el
  seed (tarea 1); la línea con presentación —validación del borrador, el helper único de cantidad
  base, confirmar con lo congelado, corregir con lo congelado y el detalle— (tarea 2, esta
  sección: [La unidad de compra por proveedor](#la-unidad-de-compra-por-proveedor-pieza-2)). Falta
  la pantalla (tarea 3). Spec:
  [`2026-09-27-compras-unidad-de-compra-design.md`](../superpowers/specs/2026-09-27-compras-unidad-de-compra-design.md).
- **Piezas siguientes, cada una con su spec:** la deuda con el proveedor y sus pagos, y los gastos
  sin stock.
- **Fuera:** orden de compra, devolución al proveedor, moneda extranjera, flete y la lectura del
  DTE del SII. ⛔ **Todo lo fiscal** va en su propio frente: mientras tanto, el costo es lo que
  dice la línea del documento.

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
  conversión de unidad y el descuento repartido— así que no cuantiza a la escala de la moneda
  ni depende de su store: hasta 2 decimales, solo para comparar con el papel.
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
| `POST /compras/:id/anular` con `{ motivo }` | Anular |
| `GET /compras/presentaciones?proveedorId=`: las vivas del proveedor | Crear |
| `POST /compras/presentaciones` con `{ proveedorId, itemId, nombre, contenido, unidadCodigo }` | Crear |
| `PATCH /compras/presentaciones/:id` con `{ nombre?, contenido?, unidadCodigo? }` (ausente no toca; `null` es 400) | Crear |
| `DELETE /compras/presentaciones/:id` (204; retira, marca `eliminado_el`) | Crear |

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
- **Tablas:** `compras` (encabezado; `folio` único por proveedor y tipo salvo anuladas),
  `compra_lineas` (con lo congelado al confirmar: `cantidad_base`, `costo_unitario_base`,
  `movimiento_id`, `stock_total_anterior`, `costo_producto_anterior`), `compra_linea_cambios`
  (historial append-only) y `tipos_documento_compra` (catálogo por país).
- **Kardex:** `movimientos_inventario` gana `compra_linea_id`, `secuencia` (bigserial, el orden de
  aplicación) y `costo_informado`, y el motivo `correccion_compra`.
- **Seed:** módulo `Compras` y sus permisos, el rol `Compras · Encargado` y tres fixtures
  parciales para los 403 (`compras.lectura`, `compras.carga`, `compras.correccion`). Ids
  420–446.

## Frontend

- `pages/compras/index.vue`: el listado, con las insignias *Borrador*, *Confirmada*, *Anulada* y
  **Falta costo**, y sus filtros.
- `pages/compras/[id].vue`: la carga del borrador —selector de unidad y presentación, el lápiz,
  la cuenta a la vista (pieza 2 § 6, ver arriba)— y el modal de confirmar con el resumen.
- `components/compras/PresentacionModal.vue`: crear, corregir y retirar una presentación
  (pieza 2). `presentacion: null` crea; con una, edita.
- `components/compras/CompraConfirmada.vue`: el detalle de una confirmada, con
  `CorregirLineaModal`, `DescuentoModal` y `AnularCompraModal`. Cada acción aparece solo con su
  permiso.
- `composables/useCompras.ts`: los tipos del detalle y lo que se manda (`cuerpoCorreccion`,
  `cuerpoDescuento`), fuera de los `.vue`. De la pieza 2: `etiquetaPresentacion`,
  `unidadDeLinea`, `cuentaPresentacion` y `cantidadLineaConfirmada`.

---

## Testing

- **Unitarios:** `compras.service.spec.ts`, `inventario.service.spec.ts` (la cuenta rehecha, con
  los números de la spec), `reparto-descuento.spec.ts`.
- **E2E de la API:** `test/compras.e2e-spec.ts` (borrador, confirmar, rehacer la cuenta, corregir,
  anular, permisos y aislamiento) y `test/kardex-secuencia.e2e-spec.ts` (la secuencia sigue el
  orden de aplicación bajo concurrencia).
- **Front:** los specs de componente de `components/compras/` (incluido
  `PresentacionModal.nuxt.spec.ts`) y `compras-carga.nuxt.spec.ts`.
- **Navegador:** `frontend/e2e/compras/compras-por-pantalla.spec.ts` — los pasos del smoke,
  como el encargado, más el test de que la lista de productos del formulario es la de Compras
  y no el catálogo de ítems — y `compras-presentacion.spec.ts` (pieza 2): crear una
  presentación desde la línea, confirmar y corregir en cajas, y el lápiz corrigiendo el
  contenido antes de confirmar. Ver [El smoke, automatizado](#el-smoke-automatizado).

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
