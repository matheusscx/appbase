# Compras, pieza 1: recibir mercadería

**Fecha:** 2026-09-18 · **Tipo:** spec de diseño
**Frente:** *"Compras: carga manual, y el DTE del SII como atajo encima"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md) § 3. Es la **pieza 1 de 4** de la primera
fase. Las otras tres llevan su propia spec: (2) la unidad de compra por proveedor, (3) la deuda
con el proveedor y sus pagos, con la salida de caja, y (4) los gastos sin stock con categoría.
**Investigación y decisiones:** [`2026-09-18-compras.md`](../../agent/investigaciones/2026-09-18-compras.md),
§ 5 y § 5b.

> ✅ **El CPP ya pondera con el stock total del producto** (`6f5a1821`, 2026-09-18; ADR-016,
> addendum; `docs/agent/resueltos.md`). Es `SUM(stock)` de `stock_ubicacion` en las ubicaciones
> no eliminadas, leído bajo el lock de `item_producto`, **solo** en las entradas que recalculan.
> El kardex sigue guardando el saldo **por ubicación**, así que el stock total histórico no está
> escrito en ningún lado: § 4.3 lo reconstruye desde el valor congelado en la línea
> (`stock_total_anterior`) más las cantidades de los movimientos posteriores.

---

## 1. El problema que cierra

Hoy una compra es una entrada suelta de stock: `PATCH /items/:id/stock` con `motivo='compra'`, un
ítem por llamada, sin proveedor, sin documento y con el costo que se tipee en ese momento. No hay
forma de:

- cargar **una factura** con sus líneas como una unidad;
- recibir la mercadería **el lunes sin precio** y completar el costo cuando llega la factura el
  miércoles;
- corregir un precio o una cantidad mal tipeados sin pisar el costo promedio entero
  (`ajuste_costo`);
- saber qué se le compró a quién, ni evitar cargar dos veces la misma factura.

## 2. Las decisiones que la sostienen

Todas son del owner, 2026-09-18.

| Decisión | Por qué importa |
|---|---|
| **Se recibe sin orden de compra** | Así reciben 6 de los 7 POS relevados. El pedido sigue por fuera |
| **Tipo de documento siempre, con "sin documento" como opción; folio obligatorio si hay documento** | La feria existe y no da papel. El folio es la llave contra el duplicado |
| **El folio repetido se bloquea**, no solo se avisa | Por ley el folio es único por emisor y tipo de documento, así que un repetido es siempre un error |
| **Proveedor siempre**, también sin documento, con uno genérico ("Feria") si hace falta | Siempre se puede contestar *"¿cuánto le compré a quién?"*, y la pieza 2 tiene de dónde colgarse |
| **Una ubicación por compra** | Lo más rápido de cargar. Si el camión deja en dos lugares, son dos compras o una compra y un traslado |
| **Se tipea el precio unitario**, con el total de la línea calculado al lado | Es la columna que el encargado reconoce en la factura |
| **El precio puede faltar al recibir** y se completa después | *"Llega el lunes, la factura el miércoles"*. No se tipea un costo estimado |
| **Lo que salió mientras faltaba el precio se queda con el costo que tenía** (escuela A) | El hecho se congela cuando ocurre, igual que la merma sin costo. Costo asumido: esa diferencia no aparece en ningún reporte |
| **El costo se rehace desde la recepción** cuando se completa o corrige | *"Como si el precio hubiera llegado el lunes"*, también con compras en medio. La alternativa de una sola cuenta se equivoca un 11 % en el ejemplo de § 4.3 |
| **Precio y cantidad se pueden corregir en la línea**, con historial | El ajuste de costo pisa el promedio entero y deja la compra con el dato malo |
| **Se puede anular**, con motivo y permiso propio | La factura cargada dos veces o al proveedor equivocado |
| **Borrador** antes de confirmar | Una factura de 30 líneas no se carga de un tirón, y es lo que va a producir la lectura del DTE en la fase 2 |
| **Descuento al total repartido por valor; lo regalado entra como línea a $0** | NIC 2: los descuentos se restan del costo. El regalo lo reparte solo el CPP (§ 4.2) |
| **Las líneas sin precio se encuentran con una marca y un filtro** en el listado | Sin contador en el menú |
| **Permisos en un módulo propio `Compras`** | El bodeguero recibe y el dueño paga (pieza 3). Colgar de Inventario daría compras a todo el que cuenta stock |
| **El atajo "compra" del ajuste de stock se mantiene por ahora** | Como Bsale y Square. Se revisa cuando Compras esté en uso. Costo asumido: esa compra no aparece en la deuda ni en los reportes de compras |
| **Todo en la moneda oficial, sin flete** | Poco frecuente en el tipo de cliente |
| **Un borrador descartado no va a la papelera**: sigue siendo soft delete, pero no se ofrece para restaurar. Por eso `compras` no tiene `eliminado_por`, la columna que decide qué entra a la papelera. Decisión del owner al ejecutar la tarea 5 | No movió stock ni plata, y restaurarlo chocaría con el folio que otro borrador ya tomó. Costo asumido: si se descarta por error, la factura se vuelve a cargar |
| **Se compran productos e ingredientes** (los dos tipos con `item_producto`), aprobado por el owner al ejecutar la tarea 3 | Un restaurante compra sobre todo ingredientes: la harina, el tomate. Es la misma pareja que ya aceptan mermas y el ajuste de stock. La primera versión de esta spec decía solo `producto` |

## 3. Modelo de datos

### 3.1 `compras`, el encabezado

| Columna | Tipo | Nota |
|---|---|---|
| `compra_id` | `uuid` PK | |
| `tenant_id` | `uuid` NOT NULL | |
| `proveedor_id` | `uuid` NOT NULL | `terceros`, de tipo `proveedor` |
| `tipo_documento_compra_id` | `uuid` NOT NULL | § 3.3 |
| `folio` | `varchar(40)` NULL | Obligatorio si el tipo lo pide (`requiere_folio`) |
| `fecha_documento` | `date` NOT NULL | La del papel, no la de la carga |
| `ubicacion_id` | `uuid` NOT NULL | Adonde entra todo |
| `estado` | `text` NOT NULL | `borrador` \| `confirmada` \| `anulada` |
| `descuento_total` | `numeric(18,4)` NULL | Monto a la escala de la moneda oficial |
| `observacion` | `text` NULL | |
| `creado_por`, `confirmado_por`, `confirmado_el`, `anulado_por`, `anulado_el`, `motivo_anulacion` | | Auditoría |
| `creado_el`, `actualizado_el`, `eliminado_el` | | Solo un **borrador** descartado se borra (soft delete). **Sin `eliminado_por`**: un borrador descartado no va a la papelera (§ 2) |

**Índice único parcial contra el duplicado:** `(tenant_id, proveedor_id,
tipo_documento_compra_id, folio)` con `folio IS NOT NULL AND estado <> 'anulada' AND
eliminado_el IS NULL`. El service lo pre-chequea para devolver un 409 que **nombra la compra
existente**, y el índice es la red contra la carrera.

"Falta costo" **no es un estado**: se deriva de una compra `confirmada` con alguna línea sin
precio.

### 3.2 `compra_lineas`

| Columna | Tipo | Nota |
|---|---|---|
| `compra_linea_id` | `uuid` PK | |
| `compra_id`, `tenant_id`, `item_id` | `uuid` NOT NULL | El ítem es `producto` o `ingrediente` (los dos con `item_producto`) |
| `cantidad` | `numeric(18,4)` NOT NULL | Como se tipeó, `> 0` |
| `unidad_codigo` | `text` NOT NULL | Compatible con la unidad base del producto |
| `precio_unitario` | `numeric(18,4)` NULL | **Por unidad tipeada.** Null = falta costo. `>= 0` (el 0 es el regalo) |
| `series` / `lote` | `jsonb` NULL | Lo que el modo pide, guardado desde el borrador |
| `orden` | `int` NOT NULL | El de la factura |
| **Congelado al confirmar** | | |
| `cantidad_base` | `numeric(18,4)` | Convertida a la unidad base |
| `costo_unitario_base` | `numeric(18,4)` NULL | Después de convertir y de repartir el descuento. Null si falta el precio |
| `movimiento_id` | `uuid` | La entrada original en el kardex |
| `stock_total_anterior`, `costo_producto_anterior` | `numeric(18,4)` | El stock total del producto y su CPP justo antes de la entrada: el punto de partida de § 4.3 |

### 3.3 `tipos_documento_compra`, un catálogo por país

`pais_id`, `nombre`, `codigo` (null si no es tributario), `requiere_folio`, `activo`. Es una tabla y
no un enum, por la misma regla que los documentos de venta. Va **aparte** de
`tipos_documento_tributario` porque esa tabla alimenta el selector del POS.

- **Chile:** Factura (33), Factura exenta (34), Factura de compra (46), Guía de despacho (52),
  Boleta (39) y Sin documento.
- **Los demás países:** "Factura" y "Sin documento", sin código, para no inventar documentos de
  otro país.

### 3.4 Kardex

- `movimientos_inventario.compra_linea_id` (`uuid` NULL). La compra se deriva por la línea.
- `movimientos_inventario.secuencia` (`bigserial`): el orden **real** de aplicación. `creado_el`
  es la hora en que **empezó** la transacción, así que dos transacciones que compiten por el lock
  del producto pueden quedar ordenadas al revés. La secuencia se toma al insertar, bajo el lock del
  producto, y por eso respeta el orden en que se aplicaron.
- **El motivo `compra` cubre todo lo que mueve stock por una compra:** la entrada original, la
  diferencia de una corrección de cantidad (entrada o salida) y la salida de la anulación. La
  varianza suma el neto de un solo motivo.
- `movimientos_inventario.costo_informado` (`boolean` NOT NULL, default false), que escribe
  `registrarMovimiento`: true cuando el movimiento trajo su costo. Hace falta porque, cuando una
  entrada llega sin costo, el kardex congela en `costo_unitario` el CPP de ese momento, y desde
  ahí "trajo $1.000" y "no trajo costo y el CPP era $1.000" se leen igual. La columna guarda el
  hecho, no la regla: cuál entrada promedia lo sigue decidiendo el código, el mismo en los dos
  lados (§ 4.3). Decisión del owner, 2026-09-19.
- **Motivo nuevo `correccion_compra`**, de tipo `ajuste`, con cantidad 0: el cambio de CPP que
  produce § 4.3, con el costo anterior y el nuevo. No entra en `MOTIVOS_QUE_RECALCULAN_CPP` porque
  su costo **es** el resultado. Tampoco entra en `MOTIVOS_SOBRE_ITEM_ELIMINADO`: una línea de un
  producto en la papelera no se corrige (lado seguro del default).

### 3.5 `compra_linea_cambios`, el historial

`compra_linea_id`, `campo` (`precio` \| `cantidad`), `valor_anterior`, `valor_nuevo`,
`usuario_id`, `movimiento_id` (la diferencia de stock o la `correccion_compra`) y `creado_el`.
El descuento al total se registra en el historial de cada línea que cambió de costo.

**Sin backfill:** no hay datos productivos. Se cambian las entidades, se registran en el array
`entities` de `app.module.ts`, se actualizan el seeder y `startup-pos.sql` (como documentación) y se
resetea.

## 4. Flujo y costo

### 4.1 Borrador

Se crea, se edita (encabezado y líneas, reemplazo completo) y se descarta. No mueve stock ni costo.
El folio duplicado se chequea también acá, para avisar temprano; el que manda es el de confirmar.

### 4.2 Confirmar

Es una sola transacción, con reintento ante deadlock como en `traslados`. Los productos se
bloquean en el orden de ADR-020 (`FOR UPDATE` sobre `item_producto`, ordenados por `item_id`), para
no cruzarse con `ventas.crear()`.

1. **Valida:** proveedor activo de tipo `proveedor`; tipo de documento activo del país del tenant;
   folio si el tipo lo pide; que no haya duplicado; ubicación activa; al menos una línea; cada
   ítem `producto` o `ingrediente`, no eliminado, con unidad compatible; series o lote según el
   modo.
2. **Reparte el descuento al total** entre las líneas con precio, según su valor
   (`cantidad × precio_unitario`), a la escala de la moneda oficial. El residuo se asigna para que la
   suma calce **exacto** con el descuento. Una línea a $0 no recibe descuento. El criterio para
   asignar el residuo sale de medir el que ya usa la nota de crédito
   ([`2026-08-22-descomposicion-nota-credito.md`](../../agent/investigaciones/2026-08-22-descomposicion-nota-credito.md)),
   no de copiarlo a ciegas.
3. **Convierte** a la unidad base con `convertirCostoUnitario`, que conserva
   `cantidad × costo`, y congela `costo_unitario_base` a escala de costo (4).
4. **Registra una entrada `compra` por línea** vía `InventarioService.registrarMovimiento`, que
   sigue siendo el único que escribe el kardex y `costo_actual`. Una línea sin precio entra sin
   costo y no mueve el CPP, como hoy.
5. **Congela** en la línea el `movimiento_id`, `stock_total_anterior` y `costo_producto_anterior`.

**El regalo no necesita lógica propia.** Mientras no haya salidas entre medio, el CPP secuencial
de varias entradas es el total de valor sobre el total de unidades. Doce cajas de Coca-Cola a $9.600
más una a $0, sin stock previo, dan $115.200 / 156 latas = **$738**. Lo que falta es el test que lo
pruebe.

### 4.3 Rehacer la cuenta

Es un método **nuevo de `InventarioService`**, porque es el único dueño de `costo_actual`. Se
invoca al completar o corregir un precio, al corregir una cantidad, al cambiar el descuento y al
anular.

Por cada producto afectado, bajo su lock:

1. Parte del `stock_total_anterior` y el `costo_producto_anterior` de **la primera línea de esa
   compra con ese producto**.
2. Recorre los movimientos del producto **en todas las ubicaciones**, desde esa entrada, por
   `secuencia`, filtrando `eliminado_el IS NULL` **del movimiento**. **No** filtra por la
   ubicación eliminada: mientras tuvo stock, ese stock entró en el peso del CPP de su momento, y
   si se filtrara la cuenta rehecha no coincidiría con la original. Coincide exacto porque una
   ubicación se borra vacía: desde `8dadb792`, `registrarMovimiento` toma `FOR SHARE` sobre la
   ubicación y el borrado espera a quien escribe stock en ella. La `correccion_compra` va a la
   ubicación de la compra si sigue viva, y si no, al local: ese lock da 404 sobre una ubicación
   ya borrada. El stock total va sumando las cantidades con su
   signo desde `stock_total_anterior`:
   - **Entrada original de una línea de compra:** entra con la cantidad y el costo **vigentes de la
     línea**, no con los del momento en que se movió. Si la compra está anulada, se salta.
   - **Diferencias de cantidad y salidas de anulación de una línea:** se saltan, porque ya
     quedaron contadas en la entrada original.
   - **Entrada `compra` sin línea** (el atajo del ajuste de stock, que se mantiene): promedia
     con su costo congelado. Si no trae costo, solo suma stock.
   - **`anulacion` y `devolucion`:** promedian con su costo congelado, como hoy. Sin costo,
     solo suman stock.
   - **Qué es "trae costo"** en esas tres: `costo_informado` (§ 3.4), no `costo_unitario`, que
     sin costo guarda el CPP de su momento. Tomate: 5 kg a $1.000, entran 20 kg sin precio,
     entran 10 kg por el ajuste de stock **sin costo**, y la factura llega a $1.500. Da
     **$1.400**, porque los 10 kg no mueven el promedio, igual que cuando entraron. Promediarlos
     con el $1.000 congelado daría $1.285,71, sin que nada lo avise (owner, 2026-09-19).
   - **`ajuste_costo`:** reinicia el costo al suyo.
   - **`correccion_compra`:** se salta, porque es un resultado y no un hecho.
   - **Todo lo demás** (ventas, mermas, recuentos, traslados, ajustes): mueve el stock sin tocar el
     costo.
   - **Stock en cero o menos antes de una entrada:** esa entrada reinicia el costo, igual que
     `calcularCostoPromedio`.
3. Si el costo resultante es distinto del `costo_actual`, lo escribe con una `correccion_compra`.
   **Ningún movimiento pasado cambia su costo congelado:** lo vendido queda como estaba.

**Los números que el test tiene que reproducir** (tomate):

| Caso | Resultado |
|---|---|
| Hay 5 kg a $1.000. Entran 20 kg sin precio, se venden 8 y se completan a $1.500 | **$1.400** (el costo de lo vendido queda en $1.000) |
| Igual, pero el martes entran 10 kg a $1.200 con factura | **$1.326** (la alternativa de "sumar la diferencia" daba $1.474) |

**Lo que se asume:**
- Si una corrección hacia abajo deja el stock recalculado en cero o menos en algún punto, aplica la
  regla de reinicio.
- El recorrido es acotado: son los movimientos de un producto desde una recepción, días o semanas.

### 4.4 Corregir una línea confirmada

- **Precio:** actualiza la línea, guarda el historial y rehace la cuenta (§ 4.3).
- **Cantidad:** mueve la diferencia en la ubicación de la compra (entrada o salida `compra`,
  colgada de la línea) y rehace la cuenta.
  - Si baja y no alcanza, es **400** con el producto, la ubicación y cuánto queda.
  - En **serie**, subir pide las series nuevas y bajar pide cuáles salen, que tienen que estar en
    stock en esa ubicación.
  - En **lote**, la diferencia va al mismo lote.
- **Descuento al total:** se acepta solo si **todas** las líneas tienen precio. Cambiarlo reparte de
  nuevo (§ 4.2, paso 2) y rehace la cuenta de cada producto cuyo costo cambió.

### 4.5 Anular

Pide motivo. Es una salida `compra` por línea, en la ubicación de la compra. Si **alguna** no
alcanza, no anula nada (todo en una transacción) y el 400 dice cuál. Después rehace la cuenta como
si la compra no hubiera existido y la deja `anulada`: se sigue viendo, tachada, y nunca se borra.
Una compra anulada libera su folio para cargarla bien.

## 5. Permisos y API

**Módulo `Compras`**, contratable (`tenant_modulos`), con acciones que ya existen en el catálogo de
permisos:

| Acción | Habilita |
|---|---|
| `Leer` | Listado, detalle e historial |
| `Crear` | Crear, editar y descartar borradores, y confirmar |
| `Actualizar` | Completar o corregir precio y cantidad, y el descuento al total |
| `Anular` | Anular una confirmada |

**Seed:** el Admin, como siempre; el rol Encargado recibe las cuatro acciones; y el módulo se
habilita en los tenants demo. Los ids fijos siguen el patrón desde el primer número libre, que el
plan verifica en el seeder al escribirlo.

| Endpoint | Permiso |
|---|---|
| `GET /compras`: paginado, con filtros `estado`, `proveedorId`, `faltaCosto`, `desde`, `hasta` | Leer |
| `GET /compras/:id`: encabezado, líneas e historial | Leer |
| `GET /compras/tipos-documento`: los del país del tenant | Leer |
| `GET /compras/proveedores`: terceros activos de tipo `proveedor` | Leer |
| `POST /compras`, `PATCH /compras/:id`, `DELETE /compras/:id` (solo borradores) | Crear |
| `POST /compras/:id/confirmar` | Crear |
| `PATCH /compras/:id/lineas/:lineaId` con `{ precioUnitario? , cantidad?, series?, unidadIds? }` | Actualizar |
| `PATCH /compras/:id/descuento` con `{ descuentoTotal }` | Actualizar |
| `POST /compras/:id/anular` con `{ motivo }` | Anular |

- **`/compras/proveedores` es propio a propósito:** el bodeguero no necesita permiso de Terceros
  para elegir a quién le compró. Crear un proveedor sigue siendo de Terceros.
- **El `tenant_id` sale del token.** Los montos llegan como string, con Decimal.js:
  `precioUnitario` con `@EsCosto()` y `descuentoTotal` con `@EsMontoCobrado()`, porque es plata del
  papel, a la escala de la moneda.
- **Errores:**
  - **409** con folio repetido, nombrando la compra existente.
  - **409** si se edita como borrador una confirmada.
  - **400** si bajar o anular deja sin stock.
  - **400** si se carga el descuento con líneas sin precio.
  - **403** sin el permiso.

## 6. Pantallas

- **Menú:** "Compras", con `Compras:Leer`.
- **Listado (`/compras`):**
  - Columnas: fecha del documento, proveedor, documento (tipo y folio), ubicación, líneas, total y
    estado.
  - Insignias *Borrador*, *Confirmada*, *Anulada* (la fila tachada) y **Falta costo**.
  - Filtros por estado, proveedor, fechas y "Solo las que les falta costo".
- **Cargar (`/compras/nueva` y `/compras/:id` en borrador), página propia y no drawer:**
  - **Arriba:** proveedor, tipo, folio (oculto con "sin documento"), fecha y ubicación.
  - **Líneas:** producto, cantidad, unidad (solo las compatibles), precio unitario opcional con el
    total calculado al lado, y series o lote según el modo.
  - **Pie:** subtotal, descuento (deshabilitado mientras falte un precio, diciendo por qué) y total.
  - *Guardar borrador*, y *Confirmar recepción*, que abre un modal con el resumen antes de mover
    stock. **Sin guardado automático.**
- **Detalle de una confirmada:**
  - *Corregir* por línea, con un modal que muestra el valor actual y el nuevo.
  - *Completar* en las que les falta costo.
  - El historial a la vista.
  - *Anular* abre un modal que **frena**: pide el motivo y dice cuánto stock sale de dónde.
- **Reglas del front:**
  - Tokens semánticos de Nuxt UI y `useApiFetch`.
  - El formato de plata y el total mostrado van en composables de `app/composables/`.
  - El total de la línea en pantalla es solo para comparar con el papel: **el costo lo calcula el
    servidor.**

## 7. Pruebas

Se escriben primero. Cada mutante **revierte al código anterior**, no solo rompe la línea nueva.

- **Unitarias del reparto:**
  - la suma calza exacto con el descuento, con el residuo asignado;
  - una línea a $0 no recibe descuento;
  - la conversión de unidad conserva `cantidad × costo`.
- **Unitarias de § 4.3, con valores que discriminen** (ni factores iguales ni el 1):
  - las dos filas de la tabla del tomate;
  - un `ajuste_costo` en medio;
  - una corrección de cantidad hacia arriba y hacia abajo;
  - una anulación ("como si no hubiera existido");
  - el stock que pasa por cero;
  - dos compras corregidas del mismo producto que no se pisan;
  - el regalo ($738).
- **e2e por HTTP:**
  - borrador → confirmar;
  - folio duplicado (409), "sin documento" sin folio y un folio liberado por una anulación;
  - completar y corregir el precio;
  - corregir la cantidad hacia arriba y hacia abajo, con el 400;
  - anular, y el 400 cuando algo ya se vendió;
  - cada acción sin su permiso es 403;
  - aislamiento entre tenants;
  - los modos serie y lote;
  - **una compra a la bodega con stock en el local**, que es el caso que hoy calcularía mal.
- **Componente:** la página de carga (el total de línea y el descuento deshabilitado).
- **Smoke test en el navegador** antes de cerrar, con la base reseteada **antes**.

## 8. Documentación, en el mismo commit que el código

- `docs/features/compras.md`, desde `TEMPLATE.md`, con su link en `docs/README.md`.
- Una fila en `docs/ESTADO.md`.
- `startup-pos.sql`.
- Los motivos del kardex en el docblock de la entidad y en el filtro de motivos de
  `inventario/index.vue`.
- El backlog.

## 9. Fuera de esta pieza

- **Pieza 2:** la unidad de compra por proveedor ("caja de 12").
- **Pieza 3:** la deuda con el proveedor y sus pagos, con la salida de caja.
- **Pieza 4:** los gastos sin stock con categoría.
- Orden de compra, devolución al proveedor, moneda extranjera, flete y la lectura del DTE del SII.
- ⛔ **Todo lo fiscal**, en su propio frente: si el IVA no recuperable y el ILA suben el costo.
  Mientras tanto, **el costo es lo que dice la línea del documento**: el neto en una factura, el
  total en una boleta.

## 10. Dependencias y orden

1. ✅ **El frente del CPP con stock total**, cerrado en `6f5a1821` (2026-09-18).
2. Esta pieza, en un **worktree**. La spec queda en main.
3. Después, las piezas 2 a 4, cada una con su spec.
