# Feature: Recuento de inventario (conteo físico)

**Status**: Complete
**Owner**: SDD Team
**Last Updated**: 2026-07-26

---

## Overview

### What is it?

Una sesión de conteo físico con ciclo de vida (`borrador → aplicado | cancelado`) que
compara lo contado contra el stock del sistema y, al aplicar, mueve el kardex por la
**diferencia** encontrada, con una causa tipificada. No es un ajuste inmediato: se crea
la sesión, se cuenta a lo largo del tiempo (puede cruzar turnos), y solo al aplicar se
toca stock real.

### Why does it exist?

`movimientos_inventario` registra entradas y salidas, pero hasta ahora no había forma de
decir "conté y hay esto". El único ajuste disponible era `PATCH /items/:id/stock`
(`docs/features/inventario-kardex.md`), que es **relativo** e inmediato: sin conteo,
sin revisión, sin registro de por qué el sistema y la realidad no coincidían.

Eso dejaba dos huecos:

- **Operativo.** El stock deriva de la realidad sin que nadie lo detecte, hasta que una
  venta falla por stock insuficiente.
- **De negocio.** El reporte de varianza teórico-vs-real (AVT, el patrón de Toast/xtraCHEF
  en food-service) necesita tres insumos: recetas costeadas ✅, mermas tipificadas ✅ y
  conteos por período ❌. Este trabajo cierra el tercero — es el insumo que le faltaba al
  sub-proyecto siguiente, el reporte de varianza en sí.

### Scope

- Included in this version:
  - Sesión de recuento con ciclo de vida (`borrador → aplicado | cancelado`)
  - Solo productos en `modo_inventario = 'cantidad'`
  - Catálogo propio de causas de diferencia (`motivo_diferencia_inventario`), con causa
    por defecto de la sesión + override por línea
  - Aplicar genera movimientos de kardex `motivo='recuento'` calculando la diferencia
    como **delta**, no como absoluto (ver "Por qué la diferencia es un delta")
  - Frontend: listado y detalle de sesiones, pantalla de catálogo de causas
- NOT included (future):
  - Modos `serie` y `lote` (anotado en `docs/agent/pendientes.md`)
  - Cycle count programado (recordatorio de "contá esto cada N días")
  - Conteo ciego (ocultar el stock del sistema mientras se cuenta)
  - Reporte de varianza teórico-vs-real (AVT) — sub-proyecto siguiente
  - Importar conteos desde CSV o lectora de códigos

---

## Por qué la diferencia es un delta, no un absoluto

Es el punto no obvio del diseño. El caso que lo obliga:

> Contás 11.800 unidades a las 10:00. Antes de aplicar, a las 14:00, se vendieron 500 en
> el medio. Si el recuento **setea** el stock al valor contado (11.800), pisás esas ventas
> y el stock queda inflado en 500.

La regla:

```
Al contar (cargar la línea):   delta = cantidad_contada − stock_sistema     [congelado ahí]
Al aplicar:                    stock_final = stock_vigente + delta
```

El conteo descubre una diferencia real — un faltante o un sobrante — que sigue siendo
real **independientemente** de lo que se haya vendido después. `stock_sistema` se congela
en la línea al crear la sesión (el momento del conteo); al aplicar, el delta se suma sobre
el stock **vigente** en ese instante (leído bajo `FOR UPDATE` dentro de
`InventarioService.registrarMovimiento`), no sobre el valor contado.

Odoo setea el stock a un absoluto porque asume que la ubicación se bloquea durante el
conteo (nadie vende de ahí mientras se cuenta). Un POS de venta física no puede darse ese
lujo: sigue vendiendo mientras alguien cuenta. El delta es la única semántica que nunca
queda mal, sin importar el orden en que se cuente y se aplique — incluida la sesión que
tarda horas o cruza turnos.

El movimiento resultante en el kardex lleva `cantidad = |delta|` y `tipo = 'entrada'` si
el delta es positivo (sobrante), `'salida'` si es negativo (faltante).

---

## Por qué el catálogo de causas es propio (no reusa `causas_merma`)

Tres razones, en orden de peso:

1. **El espacio de causas es distinto, no un subconjunto.** Un recuento puede dar
   **sobrante** — contaste más de lo que decía el sistema. Ninguna causa de merma explica
   un sobrante (una merma es, por definición, pérdida). Y las causas típicas de un
   desajuste de inventario (error de recepción, error de registro) no son mermas: son
   desincronización entre sistema y realidad, no pérdida física.
2. **Reusar `causas_merma` ensuciaría el reporte de mermas**, mezclando pérdida
   observada (una merma declarada explícitamente) con desajuste de inventario (una
   diferencia descubierta al contar) — dos métricas que se leen distinto y que el AVT
   necesita separadas.
3. **Hay precedente explícito de separar por dominio en este proyecto:** la tabla de
   causas de diferencia de caja se llama `motivo_diferencia_caja`, nombrada por su
   dominio a propósito, no `causas_genericas`.

El movimiento del kardex conserva `motivo='recuento'` siempre — **la causa es un
atributo del movimiento (`motivo_diferencia_id`), no lo reclasifica.** El AVT sigue
leyendo `recuento` como su propio bucket y, además, puede desglosar la varianza por
causa cuando la necesite.

Causas fijas sembradas por tenant (`es_fijo=true`, no editables ni eliminables):
**Merma no declarada**, **Robo**, **Error de recepción**, **Error de registro**,
**Sobre-porcionado**, **Otro**. Las tres primeras solo explican faltantes; *Error de
recepción* y *Error de registro* explican faltante **y** sobrante.

**Causa por defecto de la sesión + override por línea:** en un conteo real casi todo cae
en una misma causa y una o dos líneas tienen explicación propia. Exigir causa en cada
línea reproduce el problema que se quería evitar: el operador elige lo primero de la
lista con tal de terminar. La causa se persiste **por línea** (`motivo_diferencia_id`,
`NULL` = usa el default de la sesión), así que el reporte no pierde granularidad aunque
la carga sea rápida.

---

## Por qué contar y aplicar tienen permisos distintos

Crear la sesión, cargar conteos, editar la sesión y cancelar exigen `Inventario/Crear`;
**aplicar exige `Inventario/Actualizar`.** Esto rompe a propósito la convención del resto
del backend, donde una ruta `PATCH`/mutación de estado normalmente pide `Actualizar` — y
es una decisión explícita del owner, no un descuido.

**Aplicar mueve stock real.** Un recuento separa a quien **cuenta** de quien **aprueba**:
si contar exigiera el mismo permiso que aplicar (`Actualizar`), cualquiera que pudiera
contar también podría aplicar, y la separación operativa se cae — el conteo dejaría de
ser una propuesta revisable y volvería a ser un ajuste inmediato, exactamente lo que este
diseño existe para evitar. Crear, cargar, editar y cancelar no tocan stock: son la
preparación de la propuesta, y quedan bajo `Inventario/Crear`.

### Cómo se prueba la asimetría

Durante meses no se probaba con nada: el seed solo tenía usuarios admin, que tienen
los dos permisos, así que la separación existía en el diseño pero **ninguna prueba ni
verificación manual podía ejercerla**. Un bug de UI que le escondía "Aplicar" al
aprobador pasó lint, typecheck, unit, e2e y build sin que nada pudiera detectarlo.

El seed de desarrollo trae ahora los dos lados (`seedRolesInventario`, tenant Paris,
contraseña `admin` como el resto):

| Usuario | Rol | Permisos |
|---|---|---|
| `contador@paris.cl` | Inventario · Conteo | `Inventario` Leer + Crear, `Items` Leer |
| `aprobador@paris.cl` | Inventario · Aprobación | `Inventario` Leer + Actualizar, `Items` Leer |

Ambos necesitan `Items/Leer` porque las dos pantallas listan productos (`GET /items`)
para elegir qué contar y para filtrar el kardex; sin ese permiso el rol no puede ni
empezar un recuento.

El e2e `Recuentos — la asimetría contar/aprobar` recorre el ciclo completo con los dos
roles y afirma los 403 cruzados. Es lo que impide que la separación vuelva a quedar sin
cobertura.

El catálogo de causas (`/api/motivos-diferencia-inventario`) es CRUD bajo
`TenantAdminGuard`, siguiendo la regla del proyecto de que catálogos y configuración son
admin-only con lectura abierta; las features operativas usan `@RequiresPermiso`.

---

## API Endpoints

`tenant_id` y `usuario_id` salen siempre del token, nunca del body ni de la ruta.

| Endpoint | Qué hace | Permiso |
|---|---|---|
| `POST /api/recuentos` | Crea la sesión en `borrador` con sus líneas; congela `stock_sistema` de cada una | `Inventario/Crear` |
| `GET /api/recuentos` | Lista sesiones (paginado) con estado, fecha y diferencia neta | `Inventario/Leer` |
| `GET /api/recuentos/:id` | Detalle con líneas: stock del sistema, contado y diferencia. Incluye las de productos eliminados con la sesión abierta, marcadas con `itemEliminado` — el detalle y `cantidadLineas` del listado cuentan lo mismo | `Inventario/Leer` |
| `PATCH /api/recuentos/:id/lineas/:lineaId` | Carga `cantidadContada` y/o override `motivoDiferenciaId` de una línea | `Inventario/Crear` |
| `PATCH /api/recuentos/:id` | Cambia `motivoDiferenciaDefaultId` y/o `comentario` de la sesión | `Inventario/Crear` |
| `POST /api/recuentos/:id/cancelar` | Pasa a `cancelado` sin tocar stock | `Inventario/Crear` |
| `POST /api/recuentos/:id/aplicar` | Genera los movimientos de kardex y pasa a `aplicado` | **`Inventario/Actualizar`** |
| `GET`/`POST`/`PATCH`/`DELETE /api/motivos-diferencia-inventario` | Catálogo de causas | Lectura abierta (autenticado); mutación `TenantAdminGuard` |

### POST /api/recuentos

```
POST /api/recuentos

Authorization: Bearer <token>

Request:
{
  "itemIds": ["uuid-item-1", "uuid-item-2"],
  "comentario": "Recuento mensual bodega principal"
}

Response (201):
{ "id": "uuid-recuento" }
```

Valida que cada item exista en el tenant y tenga control de stock (`tipo='producto'`/
`'ingrediente'` con fila en `item_producto`); si no, rechaza toda la creación con 400
genérico (`'El item no tiene control de stock'`, sin nombre — no hay fila resuelta para
nombrar). Si el item existe pero su `modo_inventario` no es `'cantidad'`, el 400 sí
nombra el producto. Congela `stock_sistema` de cada línea con una sola query batcheada
(`WHERE item_id = ANY($1)`), nunca una por item.

**Rechaza con `400` si alguno de los productos ya está en otra sesión en
`borrador`**, nombrando esa sesión: dos conteos simultáneos del mismo producto
descuentan el faltante dos veces (ver §"Por qué la mitigación anterior del doble
conteo no servía"). El bloqueo es por sesión abierta, no permanente.

### PATCH /api/recuentos/:id/lineas/:lineaId

```
PATCH /api/recuentos/1234.../lineas/5678...

Request:
{ "cantidadContada": "11800.0000", "motivoDiferenciaId": null }

Response (200):
{
  "lineaId": "uuid-linea",
  "itemId": "uuid-item",
  "stockSistema": "12300.0000",
  "cantidadContada": "11800.0000",
  "diferencia": "-500.0000",
  "motivoDiferenciaId": null
}
```

`null` explícito en `cantidadContada` limpia el conteo cargado; `null` en
`motivoDiferenciaId` limpia el override de línea (vuelve a usar el default de la sesión);
`undefined` (campo ausente) deja el valor sin tocar. `diferencia` es informativa
(`cantidad_contada − stock_sistema`): no es lo que se aplica — ver "Por qué la diferencia
es un delta".

### POST /api/recuentos/:id/aplicar

```
POST /api/recuentos/1234.../aplicar

Response (200):
{
  "recuentoId": "uuid-recuento",
  "lineasAplicadas": 3,
  "lineasDescartadas": [
    { "itemId": "uuid-item-x", "itemNombre": "Producto X", "razon": "El producto fue eliminado" }
  ]
}
```

Corre en **una sola transacción**: valida y calcula el delta de todas las líneas antes
de mover cualquier stock (si falta causa en cualquiera, 400 sin tocar nada); luego, por
cada línea con delta ≠ 0, llama a `InventarioService.registrarMovimiento` con
`motivo='recuento'` y el `motivo_diferencia_id` resuelto (override o default), y guarda
el `movimiento_id` en la línea. Si el delta dejaría el stock negativo, la salida se
rechaza como cualquier salida del kardex (invariante del proyecto).

---

## Backend

### Module & Services

- **Módulo recuentos**: `backend/src/modules/recuentos/recuentos.module.ts`
- **Controller**: `backend/src/modules/recuentos/recuentos.controller.ts`
- **Service**: `backend/src/modules/recuentos/recuentos.service.ts`
- **Módulo catálogo**: `backend/src/modules/motivos-diferencia-inventario/`

### Entity & Database

**`motivo_diferencia_inventario`** (catálogo por tenant, misma forma que `causas_merma`
y `motivo_diferencia_caja`):

| Column | Type | Notes |
|---|---|---|
| `motivo_diferencia_inventario_id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `nombre` | TEXT | Único por `(tenant_id, lower(nombre))` donde `eliminado_el IS NULL` |
| `activo` | BOOLEAN | Default `true` |
| `es_fijo` | BOOLEAN | Los del sistema no se editan ni eliminan |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | |

**`recuento_inventario`** (la sesión):

| Column | Type | Notes |
|---|---|---|
| `recuento_id` | UUID PK | |
| `tenant_id` | UUID FK | Del token |
| `estado` | TEXT | `'borrador'` \| `'aplicado'` \| `'cancelado'` — los dos últimos terminales |
| `motivo_diferencia_default_id` | UUID FK NULL | Requerido al aplicar solo si hay líneas con diferencia sin override |
| `comentario` | TEXT NULL | |
| `usuario_creador_id` | UUID FK | |
| `usuario_aplicador_id` | UUID FK NULL | Quién aplicó — puede no ser quien contó |
| `aplicado_el` | TIMESTAMPTZ NULL | |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | |

**`recuento_inventario_linea`**:

| Column | Type | Notes |
|---|---|---|
| `linea_id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `recuento_id` | UUID FK | |
| `item_id` | UUID FK | |
| `stock_sistema` | NUMERIC(18,4) | Congelado al agregar la línea — la base del delta |
| `cantidad_contada` | NUMERIC(18,4) NULL | `NULL` = todavía sin contar |
| `motivo_diferencia_id` | UUID FK NULL | Override; `NULL` = usa el default de la sesión |
| `movimiento_id` | UUID FK NULL | El movimiento del kardex generado al aplicar |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | |

Único por `(recuento_id, item_id)` donde `eliminado_el IS NULL` — un producto no se
cuenta dos veces en la misma sesión.

**`movimientos_inventario`** — columna nueva: `motivo_diferencia_id` (UUID FK NULL),
solo poblada en `motivo='recuento'`. `motivo` suma el valor `'recuento'`. Detalle
completo de la regla del kardex: [`inventario-kardex.md`](./inventario-kardex.md) §
"Regla del recuento: delta, no absoluto".

### DTOs

- `CreateRecuentoDto` — `itemIds: string[]` (no vacío, UUIDs únicos), `comentario?`
- `UpdateRecuentoDto` — `motivoDiferenciaDefaultId?: string | null`, `comentario?`
- `UpdateRecuentoLineaDto` — `cantidadContada?: string | null`, `motivoDiferenciaId?: string | null`

### Key Methods

**RecuentosService**

- `create(tenantId, usuarioId, dto)` — valida items (existen, `modo_inventario='cantidad'`),
  crea la sesión y sus líneas con `stock_sistema` congelado, en una transacción.
- `findAll(tenantId, query)` / `findOne(tenantId, id)` — listado paginado y detalle con
  diferencia calculada en vivo (informativa).
- `updateLinea(tenantId, id, lineaId, dto)` — carga conteo y/o override de causa; solo en
  `borrador`.
- `update(tenantId, id, dto)` — causa por defecto y comentario de la sesión; solo en
  `borrador`.
- `cancelar(tenantId, id)` — pasa a `cancelado`, no toca stock.
- `aplicar(tenantId, usuarioId, id)` — calcula el delta de cada línea contada, resuelve
  la causa (override o default), llama a `InventarioService.registrarMovimiento` por
  línea con `motivo='recuento'`, y cierra la sesión en `aplicado`. Todo en una sola
  transacción; si cualquier validación falla, no se aplica ninguna línea.

---

## Frontend

### Pages

- `pages/inventario/recuentos/index.vue` — listado de sesiones: estado, fecha, cantidad
  de líneas y diferencia neta.
- `pages/inventario/recuentos/[id].vue` — detalle: selector de causa por defecto, tabla
  con una fila por producto (stock del sistema, input de contado, diferencia calculada en
  vivo con Decimal.js, selector de causa para override), y el botón de aplicar con un
  resumen de cuántas líneas se van a mover.

Tokens semánticos de Nuxt UI. La diferencia se muestra con color semántico
(`text-error` faltante / `text-success` sobrante), no con Tailwind hardcodeado.

---

## Data Flow

### Crear sesión → contar → aplicar

```
[Usuario elige productos a contar]
  ↓ POST /api/recuentos { itemIds }
[Backend congela stock_sistema de cada línea en una transacción]
  ↓
[Sesión en 'borrador', usuario carga conteos a lo largo del turno/día]
  ↓ PATCH /api/recuentos/:id/lineas/:lineaId { cantidadContada }
[Backend guarda el conteo; diferencia informativa = contado - stock_sistema]
  ↓
[Usuario con permiso Inventario/Actualizar revisa y aplica]
  ↓ POST /api/recuentos/:id/aplicar
[Backend, en una transacción:
   1. valida causa presente en cada línea con diferencia
   2. por línea: delta = cantidad_contada - stock_sistema (congelado)
   3. registrarMovimiento(motivo='recuento', cantidad=|delta|, tipo=entrada/salida)
      sobre el stock VIGENTE (no el contado)
   4. sesión → 'aplicado']
  ↓
[Kardex tiene un movimiento por línea con diferencia ≠ 0, con su motivo_diferencia_id]
```

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/recuentos/recuentos.service.spec.ts
npm test -- modules/motivos-diferencia-inventario/motivos-diferencia-inventario.service.spec.ts
npm test -- common/utils/pg-returning.util.spec.ts
```

Cobertura: cálculo del delta y su signo; línea sin contar se ignora; delta se aplica
sobre el stock vigente y no sobre el congelado; rechazo por stock negativo resultante;
resolución override-o-default de la causa; `unwrap()` desenvolviendo `[rows, rowCount]`
y dejando pasar `rows` sin tocar (incluido resultado vacío); catálogo: nombre duplicado
por tenant, `es_fijo` protegido en update/delete, rechazo de borrado en uso,
`soloActivas`.

### E2E Tests

```bash
npm run test:e2e -- recuentos.e2e.spec.ts
```

Escenarios: crear sesión → cargar conteos → aplicar → stock cambia por el delta, hay un
movimiento `motivo='recuento'` por línea con su `motivo_diferencia_id`, sesión queda
`aplicado`; el caso de venta concurrente entre contar y aplicar (el que justifica todo
el diseño del delta); regresión de `causas_merma` y `motivo_diferencia_caja` sin cambios
tras adoptar `unwrap()` compartido.

### Manual Testing (Swagger)

1. Abrir http://localhost:3000/api/docs
2. Autenticar con Bearer token
3. `POST /recuentos` con un par de `itemIds` de productos en modo `cantidad`
4. `PATCH /recuentos/:id/lineas/:lineaId` cargando `cantidadContada`
5. `POST /recuentos/:id/aplicar` y verificar `GET /inventario/movimientos?motivo=recuento`

### Manual Testing (Frontend)

1. `docker-compose up`
2. Navegar a `/inventario/recuentos` → "Nuevo recuento", elegir productos
3. En el detalle, cargar conteos y ver la diferencia en vivo
4. Aplicar y verificar el toast de resultado (incluye líneas descartadas si las hay)

---

## Acceptance Criteria

- [x] Endpoints implementados y testeados (unit + e2e)
- [x] Frontend: listado y detalle de sesiones
- [x] Tablas nuevas creadas (`recuento_inventario`, `recuento_inventario_linea`,
      `motivo_diferencia_inventario`) + columna `motivo_diferencia_id` en
      `movimientos_inventario`
- [x] DTOs con `class-validator`
- [x] Unit tests pasan
- [x] E2E tests pasan
- [x] API docs (Swagger decorators)
- [x] Feature docs (este archivo)
- [x] Code reviewed

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Aplicar una sesión con causa desactivada entre la carga y el aplicar | Movimiento quedaría con causa muerta en el kardex | `aplicar` revalida `activo=true` de todas las causas resueltas justo antes de mover stock, en una sola query batcheada y **con `FOR SHARE`**: sin el lock, un `DELETE` o una desactivación se cuela entre la validación y los `INSERT` (el `EXISTS` del catálogo no ve movimientos sin commitear). Del otro lado, `remove`/`update` del catálogo corren en transacción y toman la fila `FOR UPDATE`, así que esperan el commit |
| Producto que cambia de `modo_inventario` mientras la sesión está en borrador | El kardex rechazaría la línea con "faltan las series", sin decir cuál | `aplicar` revalida `modo_inventario = 'cantidad'` por línea y nombra el producto. Pasa con productos sin movimientos, que sí admiten el cambio de modo |
| Deadlock contra una venta simultánea | Postgres aborta una de las dos (40P01) y el usuario ve un 500 | `aplicar` lockea por `item_id` ascendente, pero una venta lockea en el orden del carrito, que arma el cliente — y sus recetas y combos no pueden garantizar ningún orden. En vez de imponérselo a ventas, `aplicar` **reintenta una vez** ante 40P01: el rollback dejó la transacción sin efecto, así que el reintento es seguro |
| Producto eliminado entre contar y aplicar | Fallaría toda la sesión | La línea se descarta (`lineasDescartadas` en la respuesta) y el resto se aplica igual. El detalle la **muestra** con `itemEliminado: true` en vez de esconderla: filtrarla ahí la hacía desaparecer sin aviso mientras `findAll` la seguía contando en `cantidadLineas` —el listado decía 12 y el detalle mostraba 11—, y el que cuenta no veía por qué le sobraba una |
| Dos sesiones en `borrador` sobre el mismo producto | **El faltante se descuenta dos veces** | `create` lo **bloquea**: si el producto ya está en una sesión en `borrador`, el `400` nombra esa sesión. Ver abajo por qué la mitigación anterior no servía |
| Delta dejaría stock negativo | Saldo inconsistente | Rechazo con el producto nombrado — misma invariante que cualquier salida del kardex |

### Por qué la mitigación anterior del doble conteo no servía

Esta tabla decía, sobre dos sesiones en `borrador` con el mismo producto: *"cada
línea congela su propio `stock_sistema`; el delta se calcula contra ese
congelado, así que aplicar ambas en cualquier orden da el mismo resultado
final"*. **Es cierto y es irrelevante:** la independencia del orden no es
corrección — da el mismo resultado *equivocado*.

Con números: stock de sistema 10, dos personas cuentan 8 cada una en su propia
sesión. Cada una guarda delta −2, y aplicadas las dos el stock queda en **6**, no
en 8. El faltante real se descuenta dos veces y se genera uno que no existió.

Eso es peor que un hueco no considerado: el próximo que lo mirara encontraba la
fila de la tabla y creía que estaba resuelto.

⚠️ **El delta congelado no se tocó.** Recalcular el ajuste contra el stock del
momento de aplicar era la otra salida posible y **se descartó**: contradice el
comentario que llama al delta *"el corazón del diseño"*. Lo que se bloquea es la
segunda sesión.

⚠️ **El guard es check-then-act y ningún índice lo respalda.** Dos `create()`
simultáneos con el mismo ítem lo pasan los dos: el único índice único es
`(recuento_id, item_id)`, o sea **dentro** de una sesión. Cerrar esa carrera es
trabajo de la tanda de concurrencia (§5 de `docs/agent/pendientes.md`); el guard
cubre el caso real, que es una persona abriendo una sesión cuando ya hay otra.

El bloqueo es por sesión **abierta**, no un veto permanente: aplicada o cancelada
la primera, el producto vuelve a estar disponible.

---

## Related Features

- [Gestión de Inventario (Kardex)](./inventario-kardex.md) — el kardex donde aterriza el
  movimiento `motivo='recuento'`
- [Mermas tipificadas y valorizadas](./mermas-valorizadas.md) — catálogo hermano
  (`causas_merma`), deliberadamente no compartido con este
- [Inventario serializado](./inventario-serializado.md) — modos `serie`/`lote`, fuera de
  alcance de este recuento (`docs/agent/pendientes.md`)

---

## Notes

- **Investigación de mercado de origen:**
  [`docs/agent/investigaciones/2026-07-26-inventario.md`](../agent/investigaciones/2026-07-26-inventario.md)
  §4 (Odoo: on-hand vs counted; Square: full count con revisión/aprobación; Toast/xtraCHEF:
  Actual vs Theoretical). Es insumo cruzado contra el proyecto, no copiado — el propio
  delta-vs-absoluto es la desviación deliberada frente a Odoo, justificada porque un POS
  sigue vendiendo durante el conteo.
- **Spec de diseño completa** (decisiones y alternativas descartadas):
  `docs/superpowers/specs/2026-07-26-recuento-inventario-design.md`.
- **`unwrap()` compartido:** este trabajo centralizó el helper que resuelve la trampa de
  pg (`INSERT/UPDATE ... RETURNING` llega como `[rows, rowCount]`) en
  `backend/src/common/utils/pg-returning.util.ts`, usado por los tres catálogos
  (`causas_merma`, `motivo_diferencia_caja`, `motivo_diferencia_inventario`). El CRUD de
  catálogos en sí **no** se extrajo a una base compartida: los dos catálogos existentes
  divergen a propósito en política de `es_fijo` y validación de uso al eliminar — ver la
  spec de diseño § "El helper `unwrap()` compartido" para el detalle completo.
