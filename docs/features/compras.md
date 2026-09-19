# Feature: Compras — recibir mercadería (pieza 1)

**Status**: Complete (pieza 1 de 4)
**Last Updated**: 2026-09-19

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

- **Esta pieza:** borrador, confirmar, completar y corregir precio y cantidad, descuento al total,
  anular, historial de correcciones y el módulo `Compras` con sus cuatro permisos.
- **Piezas siguientes, cada una con su spec:** la unidad de compra por proveedor ("caja de 12"),
  la deuda con el proveedor y sus pagos, y los gastos sin stock.
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
- `pages/compras/[id].vue`: la carga del borrador, y el modal de confirmar con el resumen.
- `components/compras/CompraConfirmada.vue`: el detalle de una confirmada, con
  `CorregirLineaModal`, `DescuentoModal` y `AnularCompraModal`. Cada acción aparece solo con su
  permiso.
- `composables/useCompras.ts`: los tipos del detalle y lo que se manda (`cuerpoCorreccion`,
  `cuerpoDescuento`), fuera de los `.vue`.

---

## Testing

- **Unitarios:** `compras.service.spec.ts`, `inventario.service.spec.ts` (la cuenta rehecha, con
  los números de la spec), `reparto-descuento.spec.ts`.
- **E2E de la API:** `test/compras.e2e-spec.ts` (borrador, confirmar, rehacer la cuenta, corregir,
  anular, permisos y aislamiento) y `test/kardex-secuencia.e2e-spec.ts` (la secuencia sigue el
  orden de aplicación bajo concurrencia).
- **Front:** los specs de componente de `components/compras/` y `compras-carga.nuxt.spec.ts`.
- **Navegador:** `frontend/e2e/compras/compra-confirmada.spec.ts` (completar, descontar y anular
  por pantalla).

---

## Smoke manual

Para correr a mano en el navegador, con `docker-compose up` y la base recién sembrada
(`./scripts/reset-db.sh`). **Se entra como `encargado.compras` / `admin`, no como admin del
tenant**: el rol es lo que las suites no miran igual, y con admin un 403 en una ruta de otro
módulo no se ve (pasó: el encargado no podía cargar una compra). El seed trae el proveedor
*Distribuidora Andina* y los productos del tenant Paris.

1. **Cargar una compra con una línea sin precio.** Compras → *Nueva*. Proveedor, Documento,
   Fecha, *Entra a* (la ubicación), y dos líneas: una con precio y otra con **Precio unitario
   vacío**. Guardar. → Queda **Borrador**, y en el listado aparece con la insignia **Falta
   costo**.
2. **Confirmar así, sin ese precio.** El modal resume lo que va a entrar. Al confirmar, el
   stock de los dos productos sube. El de la línea sin precio **entra igual**: congela el
   costo promedio que ya tenía, no lo ensucia con un cero.
3. **Completar el precio que faltaba.** En la compra confirmada, corregir esa línea y poner el
   precio de la factura. → El costo promedio del producto se recalcula, la insignia *Falta
   costo* desaparece y el **historial** de la línea muestra el cambio.
4. **Corregir una cantidad.** En una línea con precio, bajar la cantidad (llegaron menos). →
   El stock baja, el costo se rehace y el historial lo anota. Si de ese producto ya salió
   mercadería y no queda saldo, el rebote es 400 diciendo cuánto queda: eso también es un
   resultado correcto.
5. **Anular otra compra.** Cargar y confirmar una segunda compra, y anularla con un motivo. →
   El stock vuelve a donde estaba, la compra queda **Anulada** con su motivo a la vista, y ya
   no se puede corregir.

Lo que conviene mirar de reojo en cada paso: **Inventario → movimientos** del producto, que
es donde se ve si la cuenta cierra —cada corrección deja su propia fila, no reescribe las
anteriores—.

---

## Related Features

- [bodegas-y-traslados.md](./bodegas-y-traslados.md): el stock por ubicación y el orden de
  bloqueo.
- [ADR-016](../adr/016-costeo-promedio-ponderado-movil.md): el CPP, que pondera con el stock total
  del producto.
- [inventario-serializado.md](./inventario-serializado.md): serie y lote.
