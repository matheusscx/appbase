# El catálogo de grupos del combo se carga por lote — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que resolver la personalización de un combo cueste un número **fijo** de consultas, en vez de dos por cada (componente con grupos × unidad). Y con eso cerrar la entrada de rendimiento de la tanda 🔴, que quedó medida y sin frente abierto.

**Architecture:** `resolverGruposDeItem` hoy hace sus dos consultas de catálogo (grupos asociados + opciones) cada vez que se la llama, y `resolverPersonalizacionCombo` la llama en un `for` con `await` por cada unidad de cada componente — repitiendo **las mismas dos consultas** con los mismos parámetros. El cambio separa *cargar el catálogo* de *resolver la elección*: un helper carga el catálogo de N items en dos consultas (`ANY` + el `unnest` de pares que ya existe), y la resolución por unidad se hace en memoria contra ese catálogo. La firma pública de `resolverGruposDeItem` gana un parámetro **opcional al final**, así los tres llamadores no se tocan.

**Tech Stack:** NestJS + TypeORM sobre PostgreSQL 15, Jest (unit con mock del `EntityManager`, e2e con supertest), Docker Compose.

**Medición que origina el plan** (2026-08-20, stack real, base recién sembrada, 30 reps tras 3 de calentamiento, fixtures propias por cliente):

| Carrito de 5 líneas | 1 cliente (p50) | 10 en paralelo (p50 / p95) | throughput |
|---|---|---|---|
| producto simple | 13.8 ms | 38.4 / 45.7 ms | 236 ventas/s |
| receta sin grupos | 16.9 ms | 47.5 / 52.7 ms | 197 ventas/s |
| receta con 2 grupos | 25.4 ms | 65.1 / 72.0 ms | 145 ventas/s |
| combo (1 receta ×2 unidades, 2 grupos c/u) | 34.0 ms | 84.2 / 91.3 ms | 112 ventas/s |

Consultas reales contadas del log de Postgres (`log_statement='all'`, tramos marcados con un `SELECT` propio por `psql`), venta completa de 1 línea / 5 líneas: simple 35/47, receta 40/68, receta con grupos 49/113, **combo 61/173**.

## Global Constraints

- **Commitear directo sobre `main`.** Nada de ramas, PRs ni worktrees: `docker-compose` no ve los archivos de un worktree y el e2e daría verde sin probar nada.
- **`./scripts/reset-db.sh` ANTES de cada `npm run test:e2e`**, y `--verificar` después si algo falla raro. El e2e corre **entero**, nunca un subset, y **corre solo** (ni el gate del frontend ni otro agente editando `.ts` en paralelo: el compose bind-montea el fuente y re-siembra a mitad de suite).
- **Comprobar exit codes, nunca la última línea de un pipe.** En zsh el array es `$pipestatus` (minúscula).
- **Commits intermedios con `git commit --no-verify`**; los de solo-docs sin él.
- **Invariantes** (`CLAUDE.md`): `tenant_id` del token; dinero con `Decimal.js`; toda lectura filtra `eliminado_el IS NULL`; nunca una query por iteración.
- **Conducta idéntica, sin excepción.** Esto es rendimiento: ningún mensaje de error, ningún orden de validación y ningún snapshot puede cambiar. El criterio no es opinión: `test/combos.e2e-spec.ts`, `test/grupos-modificadores.e2e-spec.ts` y `test/grupos-modificadores-overrides.e2e-spec.ts` quedan **verdes sin tocarlos**.
- **No se toca el motor de cálculo de precios.** Este trabajo cambia cuándo se leen los catálogos, no qué se calcula con ellos.

---

### Task 1: Separar cargar el catálogo de resolver la elección

**Files:**
- Modify: `backend/src/modules/items/items.service.ts`
- Read: `backend/src/modules/ventas/ventas.service.ts:294-312` y `backend/src/modules/salones/salones.service.ts:655-670` (los llamadores que NO se tocan)

**Interfaces:**
- Produces: un helper privado que dado un array de `itemIds` devuelve el catálogo de grupos de cada uno en **dos** consultas, y `resolverGruposDeItem(manager, tenantId, itemId, gruposDto, catalogoPrecargado?)` con el nuevo parámetro **opcional y último**.
- Consumes: nada nuevo.

**Contexto que el implementador necesita** (los números de línea son del 2026-08-20; **si el código dice otra cosa, gana el código: pará y reportá**):

- `resolverGruposDeItem` (`items.service.ts:2394`) hace dos consultas: los grupos asociados al item (`item_grupos_modificadores` ⋈ `grupos_modificadores`) y las opciones de todos esos grupos (una sola, con `unnest($2::uuid[], $3::uuid[])` sobre los pares grupo↔`item_grupo_id`, porque el override es por par). La segunda no se dispara si no hay asociados.
- `resolverPersonalizacionCombo` (`items.service.ts:2537`) hace: (1) grupos propios del combo, (2) `combo_componentes` de tipo receta, (3) un `SELECT DISTINCT item_id` para saber **qué componentes tienen ≥1 grupo**, y (5) un `for` que por cada componente con grupos y cada unidad `1..cantidad` llama a `resolverGruposDeItem`. Con `cantidad = 2` eso repite las mismas dos consultas dos veces.
- La consulta (3) **desaparece**: el catálogo por lote ya dice quién tiene grupos (los que traen asociados). No la dejes al lado del lote "por las dudas".
- La consulta de opciones agrupa hoy por `grupo_modificador_id`. Al cargar N items en una sola pasada eso ya no alcanza para volver a mapear cada fila a su item: el par es (grupo, `item_grupo_id`) y `item_grupo_id` **sí** es único por (item, grupo). Traelo en el `SELECT` y armá el índice con él.
- Un combo puede tener el mismo componente varias veces por `cantidad`, y dos componentes distintos pueden compartir grupo. El catálogo se indexa **por item**, no por grupo.

- [x] **Step 1: Extraer el catálogo sin cambiar ninguna conducta**

Sacá las dos consultas de `resolverGruposDeItem` a un helper que reciba un array de `itemIds` y devuelva un `Map<itemId, catálogo>`. `resolverGruposDeItem` pasa a: si no le pasaron catálogo, lo carga para `[itemId]`; después resuelve **con el mismo código de validación que ya tiene**, sin mover un mensaje de error de lugar.

Corré `npm test -- items.service`. Los mocks **sí** hay que tocarlos —la consulta de asociaciones devuelve una columna nueva (`item_id`) y las filas de opciones necesitan `item_grupo_id` para volver a su item—, pero eso es la *forma del resultado SQL*, no la conducta. Lo que no puede moverse es ninguna aserción: `precioExtraTotal`, el snapshot y los mensajes de error quedan idénticos. Si tenés que cambiar una aserción, pará y reportá.

- [x] **Step 2: El combo carga el catálogo una vez**

En `resolverPersonalizacionCombo`: leé `combo_componentes`, cargá el catálogo por lote para el combo **y** sus componentes receta en una sola llamada al helper, y usalo tanto para los grupos propios como para cada (componente, unidad).

Cuidá el **orden de los errores**: hoy un `grupoId` propio inválido tira antes que cualquier validación de `componentes`. Cargar el catálogo antes mueve *consultas*, no *throws* — la resolución de los grupos propios tiene que seguir ocurriendo antes de validar los componentes que mandó el front.

Actualizá los mocks de `items.service.spec.ts:3089+` (`describe('resolverPersonalizacionCombo')`): son cadenas de `mockResolvedValueOnce` que hoy declaran una repetición por unidad. Las aserciones de resultado (`precioExtraTotal`, `snapshot.componentes`) **no cambian**; si alguna te obliga a cambiarla, pará y reportá.

- [x] **Step 3: Verificación**

`npm run lint:check && npm run typecheck && npm test` en verde, con exit code comprobado.

---

### Task 2: El test que fija el conteo, y el mutante que lo prueba

**Files:**
- Modify: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: el helper de la Task 1.
- Produces: un test anti-N+1 que falla si el catálogo vuelve a cargarse por unidad.

**Contexto:** el archivo ya tiene el patrón de test de conteo (buscá los que cuentan `managerMock.query.mock.calls` para la bandeja de desfases). `resueltos.md` dejó anotado que los combos se ejercitaban **con un solo combo**, así que un N+1 ahí no lo cazaba nadie: este test es esa red.

- [ ] **Step 1: Conteo constante en las dos dimensiones**

Un combo con **dos** componentes receta con grupos y `cantidad = 3` cada uno (6 unidades) tiene que costar el **mismo** número de consultas que uno con `cantidad = 1` — y el test tiene que decir el número exacto, no "menos que antes". Contá contra el mock y afirmá el total.

Las dos dimensiones importan: `cantidad` (unidades del mismo componente) y cantidad de componentes distintos. Un test que solo mueva una deja la otra sin red.

- [ ] **Step 2: Mutante que REVIERTE**

Revertí el cuerpo del `for` al código anterior —volver a llamar `resolverGruposDeItem` sin catálogo precargado por cada unidad— y verificá que el test de la Task 2 **falla**. No alcanza con un mutante que rompa: tiene que ser el código de antes, porque lo que se prueba es que el test habría cazado el bug.

Revertí el mutante y verificá con `git status --porcelain` **vacío** (ojo: `git checkout <commit> -- archivo` deja el cambio *staged*).

---

### Task 3: Medir el después, con el mismo instrumento

**Files:**
- Create: `docs/superpowers/plans/2026-08-20-catalogo-de-grupos-por-lote.md` ya existe; acá solo se agregan los números medidos al ledger de la tanda.

**Contexto:** el script de medición vive en el scratchpad de la sesión (`bench-personalizacion.mjs`) y corre contra el stack de docker-compose sin tocar `backend/src` (no re-siembra). Los números de "antes" están en el encabezado de este plan.

- [ ] **Step 1: Correr la misma medición sobre el código nuevo**

`./scripts/reset-db.sh` primero. Mismos parámetros (`SLOTS=10 REPS=30`). Lo que se compara es la fila del combo: 34.0 ms secuencial y 84.2 / 91.3 ms con 10 en paralelo, 112 ventas/s.

Y el conteo de consultas por el log de Postgres: **61** consultas para una venta de 1 línea de combo, **173** para 5 líneas. Si el conteo no baja, el cambio no sirvió y hay que decirlo, no maquillarlo.

---

### Task 4: Cierre documental de la entrada de rendimiento

**Files:**
- Modify: `docs/agent/pendientes.md` (sección 🔴), `docs/agent/resueltos.md`, `CLAUDE.md`
- Modify si corresponde: `docs/patterns/backend.md`

**Contexto:** la entrada *"N+1 al resolver personalización de recetas/combos"* está `[~]` desde el 2026-07-27 y trae una medición del 2026-08-11 con **tres afirmaciones que la medición nueva contradice**. Al mudarla a `resueltos.md` el texto de cierre tiene que dejar las tres, porque son el rastro del error:

1. *"Las llamadas por línea corren dentro de un `Promise.all`, o sea en paralelo"* — **falso**. Las 68 sentencias de una venta de 5 recetas salen todas por el **mismo** backend de Postgres (PID único en el log): el `Promise.all` corre sobre el manager de la transacción, o sea una sola conexión, y `pg` las encola. Son viajes en serie.
2. *"3 queries fijas por línea"* es el **piso**: es 3 solo si el ítem no tiene grupos de modificadores asociados. Con grupos son 4, y la medición del 2026-08-11 usó justamente la forma más barata.
3. El combo **nunca se midió**, y tenía un N+1 propio que la entrada no nombra — el que cierra este plan.

Además: lo que domina el costo por venta **no es la personalización**. De las 61 consultas de un combo de una línea, ~17 son configuración fija del tenant (unidades, monedas, tenant, fórmula de precio, país, descuentos, recargos, impuestos, tramos, métodos de pago, tipos de regla) y 15 son inventario. Eso va anotado como frente **medido y no tomado**, con su número, para que quien lo lea no tenga que volver a medirlo.

Anotá también, con el mismo criterio: `SELECT Tenant` sale **dos veces con el mismo parámetro** en cada venta (`TenantGuard` valida que el tenant existe; `getPreferenciasFinancieras` lo relee para las preferencias). Se dejó: sacarlo exige que el guard le pase la fila al service, o sea acoplar el servicio al estado del request por dos consultas. Y el par de `TipoRegla` que aparece seguido **no** es un duplicado: verifiqué los parámetros y son conjuntos distintos (descuentos por un lado, recargos e impuestos por el otro).

- [ ] **Step 1: Mudar la entrada y dejar la sección 🔴 con un solo frente**

La entrada sale de `pendientes.md` y entra a `resueltos.md` con su cierre. La sección 🔴 queda con **redondeo de plata** como único frente abierto: revisá el título de la sección, el ancla del enlace de arriba del archivo y la lista de *"🛑 Detenerse y preguntar"* de `CLAUDE.md`, que nombra "rendimiento (N+1) o redondeo de plata" como par. Es el mismo barrido que hubo que hacer cuando salió conexiones: buscá **por contenido**, no por la forma del enlace.

- [ ] **Step 2: Gate completo y revisión independiente**

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Con `reset-db.sh` antes del e2e y el e2e corriendo solo. Después, la revisión independiente del diff completo (`verify-feature` paso 7) — el pre-commit la exige porque el diff toca un service de backend.
