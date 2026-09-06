# El stock deja de ser un escalar: bodegas y traslados

**Diseño aprobado por el owner el 2026-09-06.** Sale de
[`pendientes.md` § 4](../../agent/pendientes.md) y de la investigación
[`2026-09-03-bodega-vs-sucursal.md`](../../agent/investigaciones/2026-09-03-bodega-vs-sucursal.md),
que fijó el corte con Bsale y la consecuencia fiscal.

⛔ **Toca `movimientos_inventario` y el orden de bloqueo de filas.** Lo primero obliga a
consultar antes de escribir (`CLAUDE.md`), y ya está consultado: este documento es esa
consulta. Lo segundo es la familia que cerró la auditoría del 2026-08-15 — se extiende, no se
reabre (§ 5).

📌 **Lo que NO entra:** la emisión del DTE 52. El traslado queda como documento **interno**,
sin emisión, con el mismo criterio de [ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md)
que ya se aplicó a la nota de crédito. Y **sucursal** sigue explícitamente afuera.

---

## 1. El problema, en una escena

Un local con la cocina arriba y una bodega en el subsuelo. Llegan 20 kg de carne y se bajan al
subsuelo. La mesa 4 pide una hamburguesa.

Hoy el sistema **no puede representar nada de eso**: `item_producto.stock` es una columna, una
fila por ítem — una sola bolsa de stock por tenant. Los 20 kg del subsuelo y los 10 de la
cocina son el mismo número, y el sistema le promete a la mesa carne que está dos pisos abajo
de la plancha.

La consecuencia práctica de hoy es que un tenant con un depósito aparte **no tiene forma de
decirlo**: o miente el disponible, o opera como dos tenants con dos catálogos.

---

## 2. Qué es una bodega, y qué no

El corte es de Bsale y lo endurece el SII, así que no es una preferencia de modelado:

> *"Desde una bodega no podrás hacer ventas."*

| | **Bodega** | **Sucursal** (fuera de alcance) |
|---|---|---|
| Guarda stock | sí | sí |
| Vende | **no** | sí |
| Existencia fiscal | **ninguna** — no se declara, no tiene código, no aparece en ningún documento | `CdgSIISucur` en cada DTE |

**Ese "no vende" es lo que mantiene este frente adentro de inventario.** Si una bodega
vendiera, de qué bodega salió cada venta sería un hecho fiscal, y por ADR-010 un hecho fiscal
no capturado en la transacción no se reconstruye. Como no vende, no hay hecho fiscal nuevo que
congelar.

---

## 3. Las siete decisiones del owner (2026-09-06)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿De dónde sale el stock al vender? | **Del local, siempre.** Hay una ubicación `tipo='local'` por tenant y toda venta descuenta de ahí. Las bodegas guardan y no venden nunca |
| 2 | ¿El traslado es en uno o dos pasos? | **Un solo acto**: sale del origen y entra al destino en la misma transacción. Sin estado "en tránsito" ni recepción |
| 3 | ¿El costo es por bodega? | **No.** Un solo `costo_actual` por producto para todo el tenant, como hoy. El traslado mueve kilos, no plata |
| 4 | ¿Qué operaciones dicen dónde ocurrieron? | **Todas**: compra, merma, recuento y ajuste manual. El recuento se hace **por bodega** |
| 5 | ¿Qué número muestra la lista de productos? | **El total** de todas las ubicaciones; el detalle del producto desglosa por lugar |
| 6 | ¿El traslado puede llevarse lo que una mesa ya pidió? | **No.** Salir del local topea contra lo apartado |
| 7 | ¿Qué modos de inventario entran? | **Los tres**: `cantidad`, `serie` y `lote` |

### 3.1 Lo que la decisión 1 significa, y su precio

Con 0 kg en el local y 10 en el subsuelo, **el POS y el salón dicen que no**. Es correcto: si
dejáramos vender contra la bodega, el sistema prometería comida que no está donde se cocina.

El precio es que **la lista dirá 20 kg y el POS dirá que no hay**, los dos con razón — uno
contesta *cuánto tengo* y el otro *cuánto puedo vender*. Si la pantalla no lo explica se lee
como un bug (§ 7).

📌 **Y lo que este modelo no da:** separar cocina y barra como dos stocks **vendibles**
distintos. Las dos venden, así que eso no es una bodega — es la discusión de sucursal, con su
consecuencia fiscal propia.

### 3.2 Por qué el costo no se parte (decisión 3)

`item_producto.costo_actual` es un promedio ponderado móvil
([ADR-016](../../adr/016-costeo-promedio-ponderado-movil.md)) que hoy leen las recetas, los
combos, el simulador de desfases y las mermas valorizadas, como **un solo número por
producto**. Partirlo por ubicación obliga a contestar de qué bodega es el costo de una receta,
y eso es abrir el motor de costeo — que por `CLAUDE.md` va en su propio frente y con el sistema
quieto.

⚠️ **El precio, dicho de frente:** una merma en la bodega se valoriza con el promedio mezclado
de las dos ubicaciones, no con lo que costó ese kilo en particular.

---

## 4. Modelo de datos

### 4.1 Tablas nuevas

**`ubicaciones`** — `tenant_id`, `nombre`, `tipo` (`'local' | 'bodega'`), `activo`, timestamps,
soft delete.

Cada tenant nace con **exactamente una** fila `tipo='local'`, sembrada al crear el tenant junto
al rol admin, la fórmula de precio y la caja virtual — la convención que ya usa el repo. Es la
que vende: **no se elimina ni se desactiva**. Su nombre es editable (si en el local le dicen
"Cocina", dice Cocina).

**`stock_ubicacion`** — PK `(item_id, ubicacion_id)`, `stock`.
**`item_producto.stock` se elimina.**

Esta tabla es **la única superficie de lectura** de stock: no importa el modo del producto,
todos preguntan acá. Quién la **escribe** depende del modo, y es el mismo reparto que ya existe
hoy un nivel más arriba:

| Modo | Dueño del saldo | `stock_ubicacion` |
|---|---|---|
| `cantidad` | `stock_ubicacion` misma | se escribe |
| `serie` | `item_unidad.ubicacion_id` (columna nueva) | se **recalcula** contando unidades |
| `lote` | `lote_ubicacion` (tabla nueva) | se **recalcula** sumando |

**`lote_ubicacion`** — PK `(lote_id, ubicacion_id)`, `cantidad`. Es lo que permite que un mismo
lote esté partido entre el subsuelo y la cocina. **`item_lote.cantidad_disponible` se
elimina** y se deriva sumando; `cantidad_inicial` se queda. Está contenido: hoy lo leen
`inventario.service.ts` y un solo lugar más (`items.service.ts:2966`, el listado de lotes de un
producto).

**`traslados`** — `tenant_id`, `ubicacion_origen_id`, `ubicacion_destino_id`,
`motivo_traslado_id`, `comentario`, `usuario_id`, timestamps, soft delete. Es el documento
interno.

**`motivos_traslado`** — catálogo por tenant con filas fijas sembradas (traslado interno,
consignación, entrega gratuita, ventas por efectuar…), mismo patrón que `causas_merma` y
`motivos_diferencia_inventario`, que ya tienen `es_fijo` y toggle de `activo`.

⚠️ **El motivo nace tipado y no como texto libre** porque el SII distingue tipos de traslado;
nacer con esa forma evita migrar después.

### 4.2 Columnas nuevas

`movimientos_inventario` gana **`ubicacion_id`** (obligatoria) y **`traslado_id`** (nula salvo
traslado), más el motivo `'traslado'`. `item_unidad` gana `ubicacion_id`.

`stock_anterior` / `stock_resultante` pasan a significar el saldo **de esa ubicación**.

### 4.3 Por qué un traslado son dos filas, no una

El backlog pide que *"los movimientos ganen origen y destino"*. Lo cumplimos, pero **no
literalmente como está redactado ahí**, y conviene que se lea acá y no que aparezca después:

un traslado genera **dos filas de kardex** —salida en el origen, entrada en el destino—
colgadas de un mismo `traslado_id`; el documento `traslados` es el que lleva origen, destino y
motivo. La razón es `stock_anterior`/`stock_resultante`: como ahora son saldos **por
ubicación**, en una sola fila no hay dónde escribir los dos.

### 4.4 Sin migración

No hay datos productivos. El seeder siembra el local y el stock nace ahí; no se diseña backfill
ni deprecación.

---

## 5. Backend: chokepoint, locks y topes

### 5.1 El chokepoint se queda donde está

`registrarMovimiento` sigue siendo **la única puerta** por la que pasa todo movimiento de
stock. Gana `ubicacionId` como parámetro **obligatorio**.

**El test-invariante se muda con él.** Hoy hay un spec que falla si alguien escribe
`item_producto.stock` fuera de `inventario.service.ts`; pasa a custodiar las tres puertas
nuevas — `stock_ubicacion`, `lote_ubicacion` e `item_unidad.ubicacion_id`. Si ese spec no
crece, el chokepoint deja de existir el día que alguien escriba la tabla nueva desde otro
service.

### 5.2 El orden de locks — la parte delicada

Hoy el sistema toma `FOR UPDATE OF ip` sobre `item_producto` y **ordena por `item_id`**: el
`ORDER BY` de `items.service.ts:4627` **es** el contrato de bloqueo, y salió de la auditoría de
deadlocks del 2026-08-15. Con la tabla nueva el lock se muda a `stock_ubicacion` y la clave de
orden pasa a ser **`(item_id, ubicacion_id)`**.

⛔ **El traslado es una forma de deadlock que hoy no existe**: es la única operación que toma
**dos filas del mismo ítem** a la vez. Dos traslados cruzados del mismo producto —uno
bodega→local y otro local→bodega, en el mismo instante— se bloquean en cruz si cada uno lockea
primero su origen.

Por eso el traslado **no lockea en orden origen→destino**: ordena sus filas por
`(item_id, ubicacion_id)` como todos los demás. Es la misma regla que cerró esa familia,
extendida a la clave nueva. `docs/patterns/backend.md` §15 se actualiza en el mismo commit.

### 5.3 El tope del traslado es asimétrico

- **Sacar del local** topea contra `stockDisponible` — no te podés llevar lo que la mesa 4 ya
  pidió (decisión 6).
- **Sacar de una bodega** topea contra su stock físico y nada más: en una bodega no hay nada
  apartado, porque de ahí no se vende.

📌 Con esto el traslado es **la operación más cuidadosa de las cuatro**: la merma, el recuento
y el ajuste manual siguen sin mirar lo apartado y pueden dejar la mesa trabada. Es un agujero
conocido y anotado; la decisión fue **no sumarle una puerta más**, aunque quede la
inconsistencia visible hasta que esos tres se arreglen.

### 5.4 Los tres números de la API

| Campo | Significa | Quién lo usa |
|---|---|---|
| `stock` | el **total** del tenant, sumando ubicaciones | la lista de productos |
| `stockVendible` | lo que hay **en el local** | nuevo, informativo |
| `stockDisponible` | `stockVendible − comprometido` | el salón, el drawer de personalización, el POS |

La gracia está en la tercera fila: **`stockDisponible` no cambia de significado** —sigue siendo
"lo que la mesa puede pedir"— solo se angosta al local, así que sus lectores actuales siguen
leyendo el campo correcto sin tocarse. El que **sí** cambia de significado es `stock`, y ahí hay
que revisar caso por caso quién lo lee para decidir una venta.

`GET /items/:id` gana el desglose por ubicación.

### 5.5 Endpoints

- CRUD `/ubicaciones` y `/motivos-traslado` — **admin-only** (`TenantAdminGuard`, lectura
  abierta), como el resto de catálogos de configuración.
- `POST /traslados` con sus líneas, `GET /traslados`, `GET /traslados/:id` —
  `@RequiresPermiso('Inventario', 'Crear')`. Se reusa ese permiso en vez de inventar
  `Inventario/Trasladar`: el traslado es un solo acto y no tiene el paso de aprobación que
  justificó separar permisos en el recuento.
- `GET /inventario/movimientos` gana filtro por ubicación.
- Compra, merma, ajuste manual y recuento ganan `ubicacionId` **obligatorio** en el body —
  obligatorio y no opcional-con-default, porque un default silencioso mete stock en el local
  cada vez que alguien se olvide de mandarlo.

### 5.6 N+1

El saldo por ubicación de un listado se resuelve en **una consulta por request** y se reparte
por `Map`, igual que ya hace el comprometido en `items.service.ts:964`. Nunca una consulta por
fila.

---

## 6. Frontend

**Tres pantallas nuevas.** Dos de configuración admin-only, calcadas de
`configuracion/causas-merma.vue`: **Ubicaciones** (el local arriba, no borrable; las bodegas
abajo) y **Motivos de traslado**. Y una de operación, `inventario/traslados.vue`: el formulario
*de dónde → a dónde → qué → por qué*, más el histórico con el documento navegable.

| Pantalla existente | Qué gana |
|---|---|
| `configuracion/items.vue` (lista) | la columna Stock pasa a decir el **total**; el detalle desglosa por ubicación |
| `inventario/index.vue` (kardex) | columna **Ubicación**, filtro por ubicación, y el ajuste pide dónde |
| `mermas.vue` | selector de ubicación — se merma lo que se pudrió **ahí** |
| `inventario/recuentos/` | la sesión nace atada a una ubicación |
| `salones/` y el POS | **nada** |

📌 Esa última fila es el premio del diseño: el salón y el POS ya leen `stockDisponible`, y ese
número viene angostado al local desde el backend. Donde trabaja el garzón no se enteran de que
existen las bodegas.

**La regla que protege al tenant sin bodegas:** mientras exista una sola ubicación, **todo
selector de ubicación se esconde** —escondido, no deshabilitado— y el `ubicacionId` lo completa
el frontend. La primera bodega los hace aparecer en las cuatro pantallas.

**Tokens semánticos de Nuxt UI**, nada de Tailwind hardcodeado; las pantallas nuevas nacen con
su `.nuxt.spec.ts` al lado.

---

## 7. El rechazo tiene que decir dónde está la carne

Hoy el 400 al pedir nombra el ingrediente que faltó. Pasa a nombrar también el lugar:
*"Sin carne en el local — hay 10 kg en Bodega Subsuelo"*.

Y tiene **dos caras según el permiso**, porque trasladar es `Inventario/Crear` y el garzón no
lo tiene:

- al **garzón**: informativo. Sabe que existe y a quién pedírsela; un botón no le sirve.
- a quien **sí** tiene el permiso (POS, inventario): el mismo mensaje con el traslado a un clic.

Al revés —botón para todos— el garzón toca un botón que le devuelve un 403 en medio del
servicio.

---

## 8. Bordes

| Situación | Qué hace |
|---|---|
| Borrar una bodega con stock adentro | **400**, y el mensaje dice cuánto queda. Se vacía con un traslado primero. Soft delete + papelera, como los otros 16 recursos |
| Desactivar una bodega con stock | Se puede: deja de ser **destino** válido, pero sigue sirviendo de **origen**. Si no, la mercadería queda encerrada sin forma de sacarla |
| Traslado a sí misma | 400 |
| Traslado que deja el local bajo lo apartado | 400 nombrando el ítem y la cantidad que falta |
| Producto que nunca estuvo en el destino | Se crea la fila en 0 y se suma. No existe el error "ese producto no vive acá" |
| Modo `serie` | Se trasladan **IMEIs elegidos**, no una cantidad suelta. Una unidad `vendido` o `baja` no se mueve |
| Modo `lote` | Se traslada cantidad **de un lote concreto**; si no hay esa cantidad en el origen, 400 |
| Producto eliminado | **Se puede trasladar**: `traslado` entra a la lista de motivos permitidos sobre ítems borrados, o una bodega llena de producto discontinuado no se vacía nunca |

---

## 9. Una deuda que este frente dispara y no puede esquivar

La constante de reintento ante deadlock está duplicada a propósito entre `ventas.service.ts` y
`salones.service.ts`, con un comentario que dice literalmente: *"el que necesite una tercera
copia, extrae las tres"*.

**Traslados es la tercera copia.** La extracción entra en esta tanda — no es refactor fuera de
alcance, es una condición que el código dejó escrita de antemano.

---

## 10. Verificación

El gate completo de `CLAUDE.md`, **entero y no por partes**, con `reset-db.sh` antes del e2e y
`--verificar` después. Lo específico de este frente:

- ⛔ **e2e de API es la red principal**, porque el SQL vive adentro de template literals y el
  typechecker no lo mira: borrar `item_producto.stock` rompe **al correr la consulta**, no al
  compilar. Casos: traslado feliz, tope contra lo apartado, **dos traslados cruzados** (§ 5.2),
  serie, lote, y borrar una bodega con stock.
- **e2e de navegador en el salón**, justamente porque el salón *no cambia*: un cambio invisible
  en el número que lee es donde esto rompe sin que ningún unitario se entere.
- **El invariante de chokepoint ampliado** a las tres puertas nuevas (§ 5.1).
- **El seeder** siembra el local de cada tenant, una bodega demo y stock **repartido entre las
  dos**: con todo el stock en el local, cualquier medición de plan de consulta mide un caso que
  no existe.

---

## 11. Documentación viva

Seis lugares afirman hoy que esto no existe, y dejar uno vivo manda al próximo a no buscar:

| Archivo | Qué dice hoy |
|---|---|
| [`PRODUCTO.md:449`](../../PRODUCTO.md) | *"fuera de alcance: bodegas/almacenes y stock por bodega, traspasos"* |
| [`DIFERENCIADORES.md:283-289`](../../DIFERENCIADORES.md) | *"hoy no hay multi-bodega ni traslados"* |
| [`features/inventario-kardex.md:38-39`](../../features/inventario-kardex.md) | bodegas y traspasos como no-alcance |
| [`features/mermas-valorizadas.md:37`](../../features/mermas-valorizadas.md) | *"multi-bodega / ubicaciones"* como no-alcance |
| `CLAUDE.md`, regla de inventario | *"`item_producto.stock` es saldo materializado"* — deja de ser cierto |
| [`pendientes.md`](../../agent/pendientes.md) § 4 | la entrada se cierra a [`resueltos.md`](../../agent/resueltos.md) |

Más: feature doc nuevo `docs/features/bodegas-y-traslados.md` (desde `TEMPLATE.md`), su link en
`docs/README.md`, la fila en [`ESTADO.md`](../../ESTADO.md) y `docs/patterns/backend.md` §15
por el orden de locks.

⚠️ Y un detalle chico con dientes: `ESTADO.md:30` dice que el stock físico *"sigue significando
lo que hay en bodega"*, usando "bodega" como sinónimo coloquial de depósito. Después de esta
feature esa frase pasa a decir algo falso y confuso a la vez.

---

## 12. Relacionados

- [`investigaciones/2026-09-03-bodega-vs-sucursal.md`](../../agent/investigaciones/2026-09-03-bodega-vs-sucursal.md) — el relevamiento que fijó el corte
- [ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md) — congelar el hecho fiscal, diferir lo que transmite
- [ADR-016](../../adr/016-costeo-promedio-ponderado-movil.md) — el CPP que la decisión 3 deja intacto
- [ADR-007](../../adr/007-inventario-serie-lote.md) — los modos `serie` y `lote` que la decisión 7 incluye
- [`features/inventario-kardex.md`](../../features/inventario-kardex.md) · [`features/recuento-inventario.md`](../../features/recuento-inventario.md) · [`features/salones-mesas.md`](../../features/salones-mesas.md)
