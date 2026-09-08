# Feature: Bodegas y traslados

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-09-06

---

## Overview

### What is it?

El stock deja de ser un escalar por tenant. Cada tenant tiene una o más **ubicaciones**
tipadas `'local'` o `'bodega'`, y el saldo de un ítem se guarda **por ubicación**
(`stock_ubicacion`, PK `(item_id, ubicacion_id)`). El **local** —una fila por tenant,
sembrada al crearlo, que no se borra ni se desactiva— es la única ubicación que vende: toda
venta descuenta de ahí. Una **bodega** solo guarda stock y nunca vende. `POST /traslados`
mueve stock entre dos ubicaciones del mismo tenant en un solo acto, con origen, destino y
motivo tipado.

### Why does it exist?

Antes de este frente, `item_producto.stock` era una columna: una sola bolsa de stock por
ítem por tenant. Un tenant con un depósito aparte de su local no tenía forma de decirlo —o
mentía el disponible (el POS ofrecía mercadería que estaba en otro edificio), o operaba como
dos tenants con dos catálogos. La causa completa, con la investigación que fijó el corte
frente a "sucursal": [`agent/investigaciones/2026-09-03-bodega-vs-sucursal.md`](../agent/investigaciones/2026-09-03-bodega-vs-sucursal.md).

### El corte: qué es una bodega, y qué no

El corte es de Bsale y lo endurece el SII, no es una preferencia de modelado:

> *"Desde una bodega no podrás hacer ventas."*

| | **Bodega** | **Sucursal** (fuera de alcance) |
|---|---|---|
| Guarda stock | sí | sí |
| Vende | **no** | sí |
| Existencia fiscal | **ninguna** — no se declara, no tiene código, no aparece en ningún documento | `CdgSIISucur` en cada DTE |

Ese "no vende" es lo que mantiene este frente adentro de inventario y afuera de lo fiscal. Si
una bodega vendiera, de qué bodega salió cada venta pasaría a ser un hecho fiscal, y por
[ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) un hecho fiscal no capturado en la
transacción no se reconstruye después. Como una bodega no vende, no hay ningún hecho fiscal
nuevo que congelar — y por eso **sucursal sigue explícitamente afuera**: el día que entre,
trae esa consecuencia fiscal propia (de qué sucursal salió cada venta), que este frente no
resuelve.

Lo que este modelo tampoco da: separar cocina y barra como dos stocks **vendibles**
distintos. Las dos venden, así que ninguna es una bodega — esa es la discusión de sucursal.

### Scope

- Included in this version:
  - Ubicaciones tipadas `'local' | 'bodega'`, admin-only, con papelera
  - Saldo por `(ítem, ubicación)` en los tres modos de inventario (`cantidad`, `serie`, `lote`)
  - Traslados como documento interno, con motivo tipado por catálogo (`motivo_traslado`)
  - Compra, merma, recuento y ajuste manual con `ubicacionId` obligatorio
  - `GET /items` con el stock desglosado en `stock` (total), `stockVendible` (el del local) y
    `stockDisponible`
  - El 400 por falta de stock nombra dónde está la mercadería, con el traslado precargado a
    un clic para quien tiene el permiso
- NOT included (future):
  - **La emisión del DTE 52.** Ver la sección dedicada más abajo — es la exclusión que más
    importa no perder de vista.
  - Sucursal, con su propia consecuencia fiscal
  - Costeo por ubicación (ver "Por qué el costo no se parte")
  - FIFO automático en salida de lotes/series al trasladar (si no se elige unidad/lote, el
    chokepoint auto-selecciona FIFO; el usuario no puede pedir "el lote más nuevo")

---

## Las siete decisiones del owner (2026-09-03/06)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿De dónde sale el stock al vender? | **Del local, siempre.** Una ubicación `tipo='local'` por tenant, y toda venta descuenta de ahí. Las bodegas guardan y no venden nunca |
| 2 | ¿El traslado es en uno o dos pasos? | **Un solo acto**: sale del origen y entra al destino en la misma transacción. Sin estado "en tránsito" ni recepción |
| 3 | ¿El costo es por bodega? | **No.** Un solo `costo_actual` por producto para todo el tenant, como hoy. El traslado mueve kilos, no plata |
| 4 | ¿Qué operaciones dicen dónde ocurrieron? | **Todas**: compra, merma, recuento y ajuste manual. El recuento se hace **por ubicación elegida** |
| 5 | ¿Qué número muestra la lista de productos? | **El total** de todas las ubicaciones; el detalle del producto desglosa por lugar |
| 6 | ¿El traslado puede llevarse lo que una mesa ya pidió? | **No.** Salir del local topea contra lo apartado |
| 7 | ¿Qué modos de inventario entran? | **Los tres**: `cantidad`, `serie` y `lote` |

### Lo que la decisión 1 significa, y su precio

Con 0 kg en el local y 10 en el subsuelo, el POS y el salón dicen que no hay. Es correcto: si
se dejara vender contra la bodega, el sistema prometería comida que no está donde se cocina.

El precio es que la lista de productos dice 20 kg y el POS dice que no hay, los dos con
razón — uno contesta *cuánto tengo* y el otro *cuánto puedo vender*. Por eso `GET /items`
expone los tres números por separado en vez de uno solo que intente responder las dos
preguntas:

| Campo | Significa |
|---|---|
| `stock` | el **total** del tenant, sumando todas las ubicaciones |
| `stockVendible` | lo que hay **en el local** |
| `stockDisponible` | `stockVendible − comprometido` (lo que una mesa puede pedir) |

`stockDisponible` **no cambia de significado** con este frente — sigue siendo "lo que la mesa
puede pedir" — solo se angosta al local, así que el salón y el POS, que ya lo leían, no se
tocaron. El que sí cambia de significado es `stock`: pasa de ser el único número a ser el
total, y cualquier lector que lo usaba para decidir una venta tiene que revisarse — hoy los
que deciden ventas ya leen `stockDisponible`.

### Por qué el costo no se parte por ubicación (decisión 3)

`item_producto.costo_actual` es un promedio ponderado móvil
([ADR-016](../adr/016-costeo-promedio-ponderado-movil.md)) que hoy leen las recetas, los
combos, el simulador de desfase de costos y las mermas valorizadas como **un solo número por
producto**. Partirlo por ubicación obliga a contestar de qué bodega es el costo de una
receta, y eso es abrir el motor de costeo — que por `CLAUDE.md` va en su propio frente y con
el sistema quieto, no colgado de este.

El precio, dicho de frente: una merma en la bodega se valoriza con el promedio mezclado de
todas las ubicaciones del tenant, no con lo que costó ese kilo en particular. Un traslado
tampoco lleva costo: la entrada al destino congela el `costo_actual` vigente sin pasar
ninguno (`TrasladosService.moverLinea`), porque pasarlo volvería a promediarlo contra sí
mismo e inflaría la valorización en cada traslado.

### Por qué un traslado son dos filas de kardex, no una

Un traslado genera **dos filas** en `movimientos_inventario` —salida en el origen, entrada en
el destino— colgadas del mismo `traslado_id`; el documento `traslados` es el que lleva
origen, destino y motivo. La razón es `stock_anterior`/`stock_resultante`: como ahora son
saldos **por ubicación**, en una sola fila no hay dónde escribir los dos.

---

## El orden de bloqueo de filas — la parte delicada

El lock de stock **sigue anclado en `item_producto`**, nunca se mudó a `stock_ubicacion`: la
fila de `item_producto` siempre existe (es la del producto mismo), mientras que la fila de
`stock_ubicacion` puede no existir todavía para un ítem que nunca se movió en esa ubicación —
y `FOR UPDATE` sobre una fila inexistente no lockea nada. Detalle completo, con la carrera que
se midió y el test que la fija: [`patterns/backend.md`](../patterns/backend.md) §15.

**El traslado es una forma de deadlock que antes no existía**: es la única operación que toma
**dos filas del mismo ítem** a la vez (origen y destino). Dos traslados cruzados del mismo
producto —uno bodega→local y otro local→bodega, al mismo tiempo— se bloquearían en cruz si
cada uno lockeara primero su origen.

Como el ancla es `item_producto` y no `stock_ubicacion`, un traslado lockea **una sola fila
por ítem** sin importar cuántas ubicaciones toque — así que dos traslados opuestos del mismo
producto piden la misma fila y uno espera al otro; no pueden abrazarse entre sí por esto. Lo
que sigue en pie es el ciclo **entre ítems distintos**: dos traslados con los mismos dos
productos en orden inverso sí podrían cerrarlo, y por eso `TrasladosService.crear` ordena sus
locks por `item_id` — el mismo contrato de siempre (`ventas.crear()`, `validarStockAlPedir`),
extendido acá.

✅ **Medido el 2026-09-07, y la garantía es del código.** Se preguntaba si el orden de bloqueo
lo fijaba el `ORDER BY` del lock o el plan que arma Postgres para `WHERE item_id = ANY($1)`.
El `EXPLAIN` pone el nodo `LockRows` **arriba** del `Sort`, y comprobado de afuera con tres
sesiones: con `ORDER BY item_id` se bloquea la fila menor primero, con `DESC` la mayor. El
orden del array no interviene nunca. Lo que protege al caso contra el deadlock, además, es que
los locks se pidan **todos en un statement**: romper eso —volver a uno por línea, en orden del
body— sí lo rompe, medido. Detalle en el docblock del caso e2e y en
[`patterns/backend.md` § 15](../patterns/backend.md).

---

## El tope del traslado es asimétrico (decisión 6)

- **Sacar del local** topea contra `stockDisponible`: no se puede trasladar lo que una mesa
  ya pidió.
- **Sacar de una bodega** topea contra su stock físico y nada más: en una bodega no hay nada
  apartado, porque de ahí no se vende.

Con esto el traslado es la operación más cuidadosa de las cuatro que tocan stock: la merma,
el recuento y el ajuste manual siguen sin mirar lo apartado y pueden dejar una mesa trabada.
Es un agujero conocido y anotado (no de este frente), no algo que este frente cierre.

---

## El rechazo dice dónde está la mercadería

El 400 al pedir un ítem sin stock nombra el ingrediente que faltó y ahora también el lugar:
*"Sin carne en el local — hay 10 kg en Bodega Subsuelo"*. Tiene dos caras según el permiso,
porque trasladar es `Inventario/Crear` y el garzón no lo tiene:

- Al **garzón**: informativo. Sabe que existe y a quién pedírsela; un botón no le sirve.
- A quien **sí** tiene el permiso (POS, inventario): el mismo mensaje con el traslado
  precargado a un clic.

Al revés —un botón para todos— el garzón tocaría un botón que le devuelve un 403 en medio del
servicio.

**Las tres puertas del salón muestran el mismo toast**: agregar un producto, agregar una receta
y **subir la cantidad de una línea ya pedida**. Las tres rebotan por el mismo chokepoint de
stock del backend, así que el mensaje —y el botón, para quien lo tiene— es uno solo. La regla
al agregar una puerta nueva: si el rechazo puede ser por stock, va por `useRechazoPorStock`, no
por un `toast.add` propio.

---

## Bordes

| Situación | Qué hace |
|---|---|
| Borrar una bodega con stock adentro | **400**, con el mensaje diciendo cuánto queda. Se vacía con un traslado primero. Soft delete + papelera, como el resto de los catálogos de configuración |
| Desactivar una bodega con stock | Se puede: deja de ser **destino** válido, pero sigue sirviendo de **origen**. Si no, la mercadería quedaría encerrada sin forma de sacarla |
| Traslado a sí misma (`origenId === destinoId`) | 400 |
| Traslado que deja el local bajo lo apartado | 400 nombrando el ítem y la cantidad que falta |
| Producto que nunca estuvo en el destino | Se crea la fila de `stock_ubicacion` en 0 y se suma. No existe el error "ese producto no vive acá" |
| Modo `serie` | Se trasladan **IMEIs elegidos** (o FIFO entre los que están en el origen, si no se eligen); una unidad `vendido` o `baja` no se mueve |
| Modo `lote` | Se traslada cantidad **de un lote concreto** (o FIFO entre los lotes con saldo, si no se elige uno); si no hay esa cantidad en el origen, 400 |
| Producto eliminado | **Se puede trasladar**: `'traslado'` está en la allowlist de motivos permitidos sobre ítems borrados — si no, una bodega llena de producto discontinuado no se vaciaría nunca |

---

## API Endpoints

### `GET|POST /ubicaciones`, `PATCH|DELETE /ubicaciones/:id`, `POST /ubicaciones/:id/restaurar`

Catálogo de configuración: lectura abierta a cualquier usuario del tenant, escritura
**admin-only** (`TenantAdminGuard`) — mismo patrón que `causas-merma` y
`motivos-diferencia-inventario`. `POST`/`PATCH` validan `CreateUbicacionDto`/
`UpdateUbicacionDto` (`nombre`, `tipo` en la creación, `activo`). `DELETE` es soft-delete con
los guards de la tabla de Bordes arriba.

### `GET|POST /motivos-traslado`, `PATCH|DELETE /motivos-traslado/:id`, `POST /motivos-traslado/:id/restaurar`

Mismo patrón admin-only. Catálogo por tenant con filas fijas sembradas (`es_fijo=true`:
traslado interno, consignación, entrega gratuita, ventas por efectuar…) que no se editan ni
eliminan; el admin puede agregar motivos custom. El motivo nace **tipado y no como texto
libre** porque el SII distingue tipos de traslado — nacer con esa forma evita migrar después,
el día que la emisión del DTE 52 entre.

### `POST /traslados`

Permiso `Inventario:Crear` (se reusa, no se inventó `Inventario:Trasladar` — el traslado es
un solo acto, sin el paso de aprobación que sí justificó separar permisos en el recuento).

```
POST /api/traslados
Authorization: Bearer <token>

Request (CreateTrasladoDto):
{
  "origenId": "<uuid>",
  "destinoId": "<uuid>",
  "motivoTrasladoId": "<uuid>",
  "comentario": "Reposición de cocina",
  "lineas": [
    { "itemId": "<uuid>", "cantidad": "5" },
    { "itemId": "<uuid>", "cantidad": "2", "loteId": "<uuid>" },
    { "itemId": "<uuid>", "cantidad": "1", "unidadIds": ["<uuid-imei>"] }
  ]
}
```

`lineas` acepta entre 1 y 200 líneas (el techo acota cuánto puede retener el lock ancla de
cada ítem, que también sirve a las ventas de ese producto). `unidadIds`/`loteId` son
opcionales — sin ellos, el chokepoint auto-selecciona FIFO. La respuesta se relee entera con
`GET /traslados/:id` al final de la transacción, para no mantener dos constructores de la
misma forma.

### `GET /traslados`, `GET /traslados/:id`

Permiso `Inventario:Leer`. El listado pagina cabeceras con el conteo de productos movidos
(agregado en la misma consulta, nunca una por traslado); el detalle reconstruye las líneas
**desde el kardex** — el documento no repite cantidades — con un renglón por producto, no por
movimiento.

### `GET /items`, `GET /items/:id`

`GET /items` gana `stock` (total), `stockVendible` (del local) y mantiene `stockDisponible`
con su significado angostado al local. `GET /items/:id` gana el desglose por ubicación.

### Compra, merma, recuento, ajuste manual

Ganan `ubicacionId` **obligatorio** en el body — obligatorio y no opcional-con-default,
porque un default silencioso metería stock en el local cada vez que alguien se olvide de
mandarlo. Detalle de cada endpoint: [`inventario-kardex.md`](./inventario-kardex.md),
[`mermas-valorizadas.md`](./mermas-valorizadas.md),
[`recuento-inventario.md`](./recuento-inventario.md).

---

## Backend

### Module & Services

- `src/modules/ubicaciones/` — `UbicacionesService.localDe(tenantId)` resuelve "el local" del
  tenant. ⚠️ **No es un default para el body**: compra, merma, recuento y ajuste manual exigen
  `ubicacionId` y nunca caen acá (ver arriba). Lo usan los caminos donde la ubicación **no la
  elige el cliente**: la venta —que siempre descuenta del local—, los tres números de
  `GET /items` y el ajuste de costo, que es plata y no mueve cantidad
- `src/modules/motivos-traslado/`
- `src/modules/traslados/` — `TrasladosService.crear` / `findAll` / `findOne`
- `src/modules/inventario/inventario.service.ts` — `registrarMovimiento` sigue siendo el
  único chokepoint de escritura; gana `ubicacionId` como parámetro obligatorio

### Entity & Database

**Tablas nuevas:**

| Tabla | Qué guarda |
|---|---|
| `ubicaciones` | `tenant_id`, `nombre`, `tipo` (`'local'\|'bodega'`), `activo`, soft delete |
| `stock_ubicacion` | PK `(item_id, ubicacion_id)`, `stock` — único dueño del saldo del sistema |
| `lote_ubicacion` | PK `(lote_id, ubicacion_id)`, `cantidad` — reemplaza a `item_lote.cantidad_disponible`, que se eliminó |
| `traslados` | `tenant_id`, `ubicacion_origen_id`, `ubicacion_destino_id`, `motivo_traslado_id`, `comentario`, `usuario_id`, soft delete — el documento interno |
| `motivo_traslado` | catálogo por tenant, filas fijas + custom, `es_fijo`/`activo` |

**Columnas nuevas:** `movimientos_inventario.ubicacion_id` (obligatoria) y `.traslado_id`
(nula salvo `motivo='traslado'`, las dos filas de un traslado comparten el valor);
`item_unidad.ubicacion_id`. `item_producto.stock` **se eliminó**.

Quién escribe `stock_ubicacion` depende del modo del producto — el mismo reparto que ya
existía un nivel más arriba:

| Modo | Dueño del saldo | `stock_ubicacion` |
|---|---|---|
| `cantidad` | `stock_ubicacion` misma | se escribe |
| `serie` | `item_unidad.ubicacion_id` | se **recalcula** contando unidades |
| `lote` | `lote_ubicacion` | se **recalcula** sumando |

No hubo migración: no hay datos productivos, así que se cambió la entity, se actualizó el
seeder (local + una bodega demo por tenant relevante, con stock repartido entre las dos) y se
reseteó la base.

### DTOs

- `CreateUbicacionDto` / `UpdateUbicacionDto`
- `CreateMotivoTrasladoDto` / `UpdateMotivoTrasladoDto`
- `CreateTrasladoDto` (con `LineaTrasladoDto[]` anidado)
- `AjusteStockDto`, `CreateMermaDto`, `CreateRecuentoDto` ganaron `ubicacionId: string`
  (`@IsUUID()`, requerido)

---

## Frontend

| Pantalla | Qué es / qué gana |
|---|---|
| `configuracion/ubicaciones.vue` | Nueva. Admin-only, calcada de `configuracion/causas-merma.vue`: el local arriba (no editable de tipo, no borrable), las bodegas abajo |
| `configuracion/motivos-traslado.vue` | Nueva. Mismo patrón |
| `inventario/traslados.vue` | Nueva. Formulario *de dónde → a dónde → qué → por qué*, más el histórico con el documento navegable |
| `configuracion/items.vue` (lista) | La columna Stock pasa a decir el **total**; el detalle desglosa por ubicación |
| `inventario/index.vue` (kardex) | Columna Ubicación, filtro por ubicación, y el ajuste pide dónde |
| `mermas.vue` | Selector de ubicación — se merma lo que se pudrió ahí |
| `inventario/recuentos/` | La sesión nace atada a una ubicación, elegida al crearla |
| `salones/` y el POS | **Nada.** El salón y el POS ya leían `stockDisponible`, que viene angostado al local desde el backend — donde trabaja el garzón no se enteran de que existen las bodegas |

**La regla que protege al tenant sin bodegas:** mientras exista una sola ubicación, todo
selector de ubicación se **esconde** —escondido, no deshabilitado— y el `ubicacionId` lo
completa el frontend solo. La primera bodega los hace aparecer en las cuatro pantallas.

La misma condición gobierna **lo que solo informa**: con una sola ubicación, la columna
Ubicación del kardex y su filtro tampoco se dibujan, y la ubicación del encabezado de una
sesión de recuento no se muestra. No es la misma razón que la del selector —acá no hay nada
que completar— pero sí el mismo criterio: un dato que siempre dice lo mismo es ruido.

---

## ⛔ El DTE 52 no se emite

El registro interno de un traslado **no reemplaza** el documento que tiene que viajar con la
mercadería. En Chile, mover mercadería por vía pública exige guía de despacho electrónica
(DTE 52) aunque no haya venta — el traslado interno usa código 5 y el motivo debe declararse
(Resolución 154 del SII). **Tener el traslado registrado no es estar en regla**: el tenant
sigue emitiendo esa guía por fuera, igual que hoy hace con las boletas.

El criterio es el mismo que ya se aplicó a la nota de crédito bajo
[ADR-010](../adr/010-preparacion-sii-datos-fiscales.md): se congela el hecho —origen, destino,
motivo tipado, qué se movió— y se difiere lo que solo transmite o formatea. No se construyó
infraestructura DTE especulativa. El motivo nace tipado (catálogo, no texto libre)
precisamente para que el día que la emisión entre, no haga falta migrar el dato.

---

## Testing

### E2E (backend)

```bash
npm run test:e2e -- traslados
npm run test:e2e -- ubicaciones
npm run test:e2e -- motivos-traslado
npm run test:e2e -- items-stock-por-ubicacion
npm run test:e2e -- inventario-serie-ubicacion
npm run test:e2e -- inventario-lote-ubicacion
npm run test:e2e -- recuentos-stock-por-ubicacion
npm run test:e2e -- sobreventa-concurrente-ubicacion
```

Casos que importan por lo que prueban, no por su nombre: traslado feliz en los tres modos,
tope contra lo apartado (origen local) vs. tope físico (origen bodega), borrar una bodega con
stock, y **dos traslados cruzados del mismo par de productos** — el caso que ejercita el
orden de locks descrito arriba (ver el docblock del test para la medición completa: qué
mutante lo mata y cuáles no).

Los cuatro endpoints que escriben eligiendo ubicación —merma, ajuste manual, recuento y
traslado— tienen además **probado por HTTP que el campo es obligatorio**: sin él, 400. Es la
única red que existe sobre ese "requerido", porque un test de DTO con `plainToInstance` +
`validate` dispara los decoradores pero no el `ValidationPipe`.

Los de recuento y traslado afirman además **que el 400 nombra su campo** (y el de traslado,
que no nombra el otro de los dos): es lo que distingue "rebotó por lo que queríamos" de
"rebotó". Los de merma y ajuste manual todavía miran solo el status.

### E2E (frontend)

`frontend/app/pages/configuracion/ubicaciones.nuxt.spec.ts`,
`motivos-traslado.nuxt.spec.ts`, `inventario/traslados.nuxt.spec.ts`, más los specs de
`items.vue` que cubren el desglose por ubicación y el selector que se esconde con una sola
ubicación.

---

## Related Features

- [`inventario-kardex.md`](./inventario-kardex.md) — el kardex, `registrarMovimiento`, y el
  desglose completo de `motivo='traslado'`
- [`inventario-serializado.md`](./inventario-serializado.md) — modos `serie`/`lote` que este
  frente extiende a "por ubicación"
- [`recuento-inventario.md`](./recuento-inventario.md) — el recuento por ubicación elegida
- [`mermas-valorizadas.md`](./mermas-valorizadas.md) — la merma con `ubicacionId` obligatorio
- [`patterns/backend.md`](../patterns/backend.md) §15 — el orden de locks completo
- [ADR-007](../adr/007-inventario-serie-lote.md) · [ADR-016](../adr/016-costeo-promedio-ponderado-movil.md) · [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md)
- [`agent/investigaciones/2026-09-03-bodega-vs-sucursal.md`](../agent/investigaciones/2026-09-03-bodega-vs-sucursal.md)

---

## Notes

Backlog que este frente dejó anotado, con su porqué: [`agent/pendientes.md`](../agent/pendientes.md).
Los seis huecos con los que cerró se resolvieron el 2026-09-07, y ese mismo día salieron los
dos mecánicos que quedaban: el 400 de "campo de ubicación requerido" de recuentos y traslados,
y el barrido de las citas al plan y a la spec borrados. Lo que sigue anotado en la § 1 del
backlog son dos residuos de ese barrido —las citas `spec § N` que no dicen de qué spec son, y
las `Tarea N` del plan borrado—. Cierre completo, con lo construido y lo resuelto después:
[`agent/resueltos.md`](../agent/resueltos.md).
