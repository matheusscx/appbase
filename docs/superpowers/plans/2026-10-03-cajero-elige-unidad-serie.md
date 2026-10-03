# Quien vende elige qué unidad con serie sale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft · **Date:** 2026-10-03 · **Owner:** Cesar Matheus

**Goal:** Ninguna unidad de un producto con número de serie sale de stock sin que alguien la
nombre. En el POS la elige el cajero y en el salón el garzón al pedir. Los caminos donde
nadie puede elegir (combos, grupos, tienda online, merma) se cierran.

**Architecture:** La regla vive en el chokepoint (`InventarioService.moverSerie`), que deja
de auto-seleccionar FIFO y valida con un método compartido. Ese método lockea
`item_producto` → `item_unidad ORDER BY unidad_id` y rechaza las unidades apartadas por otra
cuenta abierta. El salón guarda las unidades en `cuenta_lineas.unidad_ids`, y el apartado se
deriva de las cuentas abiertas, sin estado `reservado`. El frontend agrega un selector
compartido que usan el POS y el salón.

**Tech Stack:** NestJS + TypeORM (SQL crudo vía `manager.query`), Postgres 18, Nuxt 4 +
Nuxt UI v4, Jest (unit + e2e supertest), Vitest (`*.nuxt.spec.ts`), Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-03-cajero-elige-unidad-serie-design.md`](../specs/2026-10-03-cajero-elige-unidad-serie-design.md).
Léanla entera antes de cualquier tarea: la § 2 tiene las decisiones del owner y la § 5 la
tabla de puertas del salón.

## Global Constraints

- `tenant_id` sale del token, nunca del body/query/param. Dinero con Decimal.js.
- Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL` (también `cuentas`, `cuenta_lineas`,
  `item_unidad`, `mesas`, `ubicaciones`). Ninguna query por iteración (N+1).
- Orden de bloqueo global: cuenta → `item_producto` (por `item_id`) → `item_unidad`
  (por `unidad_id`). Nunca lockear unidades en el orden que mandó el cliente.
- Columnas nuevas con `type` explícito en `@Column` (memoria: `import type` rompe `design:type`).
- Sin dependencias nuevas. Sin `TODO`, sin código comentado.
- Textos de error en español, nombrando producto/serie/mesa, como los vecinos.
- Frontend: `$fetch`/`useApiFetch`; tokens semánticos de Nuxt UI (`design:check`); la lógica
  de presentación en `app/composables/`, nunca local a un `.vue`.
- **No tocar** el bloque de carga del catálogo de `pos.vue` / `salones/index.vue` /
  `tienda/index.vue` más allá de lo que dice cada tarea, ni `CatalogoGrid.vue` (frente de
  paginación en paralelo). No tocar `moverLote` (frente FEFO en paralelo).
- **Implementadores: stagean por ruta (`git add <rutas>`), NO commitean.** El recibo de la
  revisión y el commit los hace el controlador al cierre (el pre-commit exige el recibo de
  `verify-feature` para diffs de services y `.vue`). Nunca `git add -A`, nunca `--no-verify`.
- **No tocar un `.ts` del backend con un e2e corriendo.** Las suites pesadas (`test:e2e`
  completo, Playwright, `npm test` completo del frontend) piden turno a la orquestadora.
  Los implementadores corren solo los specs de su tarea.
- Entorno del worktree: `./scripts/entorno.sh db` para `test:e2e`; `./scripts/entorno.sh stack`
  recién para Playwright/smoke. `./scripts/reset-db.sh` antes de cada corrida e2e.

---

### Task 1: Chokepoint — la salida de modo serie exige unidades y respeta el apartado

**Files:**
- Modify: `backend/src/modules/salones/entities/cuenta-linea.entity.ts` (columna `unidadIds`)
- Modify: `backend/src/modules/inventario/inventario.service.ts` (`RegistrarMovimientoParams`,
  método nuevo `bloquearUnidadesParaSalida`, rama salida de `moverSerie`)
- Test: `backend/src/modules/inventario/inventario.service.spec.ts`
- Test (ajustar): `backend/test/traslados.e2e-spec.ts` (el caso "Serie FIFO traslado E2E",
  ~línea 720), `backend/test/orden-locks-desfases.e2e-spec.ts` (si vende serie sin unidades)

**Interfaces:**
- Produces:
  - `CuentaLinea.unidadIds: string[]` → columna `unidad_ids uuid[] NOT NULL DEFAULT '{}'`:
    `@Column({ name: 'unidad_ids', type: 'uuid', array: true, default: () => "'{}'" })`.
  - `RegistrarMovimientoParams.cuentaId?: string | null`: la cuenta abierta dueña de la
    salida. Las unidades apartadas por ESA cuenta pueden salir.
  - `InventarioService.bloquearUnidadesParaSalida(manager: EntityManager, p: { tenantId: string; itemId: string; ubicacionId: string; unidadIds: string[]; cuentaId?: string | null }): Promise<{ unidad_id: string; serie: string; condicion: string }[]>`.
    Público, porque lo usa el salón (Task 6). Devuelve las filas en orden de `unidad_id`.

**Contrato de `bloquearUnidadesParaSalida`** (en este orden):
1. `unidadIds` vacío → 400 `Elegí qué unidades salen: «<nombre>» tiene número de serie`.
   Para nombrar el producto, leerlo en la misma query del lock del paso 3.
2. Repetidas en la lista (`new Set(ids).size !== ids.length`) → 400
   `Una unidad viene repetida`.
3. `SELECT … FROM item_producto ip JOIN items i … WHERE ip.item_id=$1 AND i.tenant_id=$2 FOR UPDATE OF ip`.
   Re-lockear dentro de `registrarMovimiento` no cuesta nada, y el salón lo necesita
   porque un PATCH de unidades con la misma cantidad no pasa por `validarStockAlPedir`.
4. `SELECT unidad_id, serie, condicion, estado, item_id, ubicacion_id FROM item_unidad WHERE unidad_id = ANY($1) AND tenant_id = $2 AND eliminado_el IS NULL ORDER BY unidad_id FOR UPDATE`.
   - Una fila faltante o de otro ítem → 400 `Unidad <id> no pertenece a este producto`
     (no distingue tenant: no oráculo).
   - Otra ubicación → el mismo 400 que hoy (`La unidad X está en <ubicación>, no en <ubicación>`),
     con la consulta de nombres que ya existe, ahora **una sola vez** para todas las fuera de lugar.
   - `estado !== 'disponible'` → 400 `La unidad <serie> no está disponible (estado: <estado>)`.
5. Apartado: una consulta (con la cuenta y el nombre de la mesa por JOIN):
   ```sql
   SELECT x.unidad_id, me.nombre AS mesa_nombre
     FROM cuenta_lineas cl
     JOIN cuentas c ON c.cuenta_id = cl.cuenta_id AND c.tenant_id = $1
      AND c.estado = 'abierta' AND c.eliminado_el IS NULL
     JOIN mesas me ON me.mesa_id = c.mesa_id AND me.eliminado_el IS NULL
     CROSS JOIN LATERAL unnest(cl.unidad_ids) AS x(unidad_id)
    WHERE cl.tenant_id = $1 AND cl.eliminado_el IS NULL
      AND x.unidad_id = ANY($2::uuid[])
      AND c.cuenta_id IS DISTINCT FROM $3
   ```
   (Verificar nombres reales de `mesas`/columna `nombre` en su entity antes de escribirla.)
   Hay fila → 400 `La unidad <serie> está apartada en la cuenta de <mesa>`.

**Rama salida de `moverSerie`** (no la entrada; la entrada de traslado no cambia):
reemplazar el bloque de auto-selección y el loop de `SELECT … FOR UPDATE` por unidad por
`bloquearUnidadesParaSalida(...)` con `params.cuentaId`. Después va el chequeo
`unidadIds.length` vs `cantidad`, que ya existe; mantenerlo **después** del chequeo de vacío
para que el mensaje de "elegí" gane. Las escrituras quedan en UNA sentencia:
`UPDATE item_unidad SET estado=$1, venta_id=$2 WHERE unidad_id = ANY($3)` (o
`SET ubicacion_id=$1` en traslado). Validación del destino del traslado: sin cambios.
`permiteSalidaParcial` sigue sin aplicar a serie.

- [ ] **Step 1: Escribir los tests unitarios que fallan** en `inventario.service.spec.ts`.
  Seguir el molde de mocks de `manager.query` que ya usa el archivo y reemplazar el test que
  fija la auto-selección FIFO. Casos:
  - salida serie sin `unidadIds` → rechaza con `Elegí qué unidades salen` y no escribe;
  - con unidades repetidas → `Una unidad viene repetida`;
  - lockea unidades con `ORDER BY unidad_id` en una sola query (aserción sobre el SQL de la
    cláusula, no un `toContain` que pueda matchear un comentario: memoria
    "test que afirma sobre el SQL");
  - unidad apartada por otra cuenta → `está apartada en la cuenta de Mesa 4`;
  - unidad apartada por la cuenta propia (`cuentaId` igual) → pasa;
  - venta → `UPDATE … estado='vendido'` con `ANY`, una sola sentencia.
- [ ] **Step 2: Correrlos y verlos fallar:** `cd backend && npx jest src/modules/inventario/inventario.service.spec.ts`.
- [ ] **Step 3: Implementar** columna, parámetro, método y rama salida según el contrato.
- [ ] **Step 4: Correr unit:** el spec de arriba en verde; `npm run typecheck && npm run lint:check`.
- [ ] **Step 5: Ajustar los e2e que fijaban el FIFO** (traslados: el caso pasa a mandar las
  unidades o a afirmar el rechazo, lo que mida lo que el test protegía; leer su comentario)
  y agregar en `inventario-serie-ubicacion.e2e-spec.ts` dos casos por la API real:
  `PATCH /items/:id/stock` salida serie sin `unidadIds` → 400, y `POST /traslados` de una
  línea serie sin `unidadIds` → 400. Correr esos specs: `./scripts/reset-db.sh && cd backend && npx jest --config test/jest-e2e.json test/traslados.e2e-spec.ts test/inventario-serie-ubicacion.e2e-spec.ts`.
- [ ] **Step 6: Stagear** por ruta. No commitear.

---

### Task 2: Venta — `unidadIds` obligatorio para productos con serie

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (validación al resolver líneas, ~714;
  paso de `cuentaId` en 7f, ~1088)
- Modify: `backend/src/modules/salones/salones.service.ts` (`cerrarCuenta`, ~2270: mandar
  `unidadIds: l.unidadIds` en cada línea con unidades)
- Create: `backend/test/venta-serie.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 (`cuentaId` en `RegistrarMovimientoParams`, `CuentaLinea.unidadIds`).
- Produces: el contrato HTTP de `POST /ventas`: `lineas[i].unidadIds` obligatorio si el
  producto es modo serie.

**Reglas** (validar al resolver las líneas, con `modo_inventario` de `cargarBasePorIds`,
antes de cualquier escritura):
- producto modo serie sin `unidadIds` o con lista vacía → 400 `Elegí qué unidades salen: «<nombre>» tiene número de serie`;
- `cantidad` no entera, o distinta de `unidadIds.length` → 400 `«<nombre>»: la cantidad (N) no coincide con las unidades elegidas (M)`;
- la misma unidad en dos líneas del carrito → 400 `Una unidad viene repetida en la venta`;
- `unidadIds` en un ítem que no es producto modo serie → 400 `«<nombre>» no tiene número de serie: no lleva unidades`;
- línea con serie con `unidadCodigoPresentacion` distinta de la unidad base → 400 (misma
  regla y texto que la merma: `Los productos por serie o lote solo admiten su unidad base`);
- en 7f, pasar `cuentaId` (el parámetro de `crearEnTransaccion`) a `registrarMovimiento`.

- [ ] **Step 1: e2e que falla** (`venta-serie.e2e-spec.ts`). Arma su propio producto modo
  serie vía `POST /items`, con dos series (`nuevo`, `usado`) en el local, y su propia caja
  (helpers de `test/helpers/caja.ts`). Casos:
  - **escena del owner:** se vende el usado → `GET /items/:id/unidades` muestra el usado
    `vendido` y el nuevo `disponible`;
  - sin `unidadIds` → 400 y el stock no se movió;
  - cantidad 2 con una unidad → 400;
  - la misma unidad en dos líneas → 400;
  - `unidadIds` a un producto modo cantidad → 400;
  - unidad de otro producto → 400;
  - unidad en la bodega → 400 nombrando dónde está;
  - **carrera:** dos ventas de la misma unidad con `test/helpers/carrera.ts` → exactamente
    una 201 y una 400, ningún 500/deadlock.
- [ ] **Step 2: Verlo fallar** (reset-db + correr solo ese spec).
- [ ] **Step 3: Implementar** las reglas y el `cuentaId`, y en `cerrarCuenta` el envío de
  `unidadIds`.
- [ ] **Step 4: Verde** el spec nuevo + `test/ventas*.e2e-spec.ts` relacionados + typecheck/lint.
- [ ] **Step 5: Stagear.**

---

### Task 3: Configuración — combos, grupos y cambio de modo no admiten serie

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (validación de componentes de combo,
  ~6040; cambio de `modoInventario` en el update, ~2129-2160)
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts` (~163, opciones vendibles)
- Test: `backend/src/modules/items/items.service.spec.ts`,
  `backend/src/modules/grupos-modificadores/grupos-modificadores.service.spec.ts`,
  `backend/test/venta-serie.e2e-spec.ts` (un caso por regla, por la API real)

**Reglas:**
- Componente de combo de tipo `producto` con `modo_inventario = 'serie'` → 400
  `«<nombre>» tiene número de serie: no puede ser parte de un combo`. Hace falta que
  `filasValidacionPorIds` traiga `modo_inventario`; verificar si ya lo trae.
- Opción de grupo de familia vendible que es producto modo serie → 400
  `«<nombre>» tiene número de serie: no puede ser opción de un grupo`.
- Update de un producto a `modoInventario: 'serie'` cuando es componente vivo de un combo
  vivo, u opción viva de un grupo vivo → 400
  `«<nombre>» es parte de un combo o grupo: no puede pasar a número de serie`. Va en una
  consulta (`EXISTS … UNION ALL EXISTS …`), con `eliminado_el IS NULL` en cada tabla.
- [ ] **Step 1: Tests que fallan** (unit + los tres casos e2e).
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde** + typecheck/lint. Correr además `test/combos*.e2e-spec.ts` y
  `test/grupos*.e2e-spec.ts` si existen, por si algún fixture usaba un producto serie.
- [ ] **Step 5: Stagear.**

---

### Task 4: Tienda online y merma

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`buildFindAllFilters`, ~607) y el DTO
  de query de `GET /items` (buscar el que usa `findAll`)
- Modify: `backend/src/modules/online/online.service.ts` (checkout, junto al chequeo de `activo`, ~283)
- Modify: `backend/src/modules/mermas/mermas.service.ts` (antes de `registrarMovimiento`, ~205)
- Modify: `frontend/app/pages/tienda/index.vue` (la llamada a `useCatalogoVenta`, ~13: pasarle
  `filtros: { vendibleOnline: 'true' }`; es lo único que se toca ahí. El composable ya acepta
  `filtros` desde la integración de la paginación, 8b6a8faf)
- Modify: `frontend/app/pages/mermas.vue` (junto a `productoSeleccionado`, ~120): si el
  producto elegido es `modoInventario === 'serie'`, un `UAlert` con el mismo texto del 400 y
  el botón Registrar deshabilitado. El `AppItemSelect` y `FILTROS_PRODUCTO` no se tocan
- Test: `backend/test/venta-serie.e2e-spec.ts` (o un spec propio `tienda-merma-serie.e2e-spec.ts`),
  unit de `online.service.spec.ts` y `mermas.service.spec.ts`

**Reglas:**
- `GET /items?vendibleOnline=true` excluye `modo_inventario = 'serie'`. El filtro va en
  `buildFindAllFilters`, **no** en el SELECT, porque el frente de paginación reusa ese `where`
  en su orden de dos pasos. Valor booleano del DTO con el mismo molde que `activo`.
- Checkout online con una línea de producto modo serie → 400 `«<nombre>» se vende solo en el local`,
  **antes** de `pagosRedirect.iniciar` (no queda orden creada).
- `POST /mermas` de un producto modo serie → 400 `«<nombre>» tiene número de serie: dalo de baja desde Ajuste de stock, eligiendo la unidad`.
- [ ] **Step 1: Tests que fallan:**
  - el listado con y sin el filtro;
  - checkout rechazado sin orden creada;
  - merma rechazada, sin movimiento y con el stock intacto.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar** backend y las dos líneas de frontend.
- [ ] **Step 4: Verde.** Correr el spec de la pantalla de mermas si fija su selector.
- [ ] **Step 5: Stagear.**

---

### Task 5: Lectura — unidades vendibles y serie en el detalle de venta

**Files:**
- Modify: `backend/src/modules/items/items.controller.ts` (`GET :id/unidades`, query `vendibles`)
- Modify: `backend/src/modules/items/items.service.ts` (`findUnidades`, ~3070)
- Modify: `backend/src/modules/ventas/ventas.service.ts` (armado del detalle, ~4140-4170)
- Test: `backend/test/venta-serie.e2e-spec.ts`

**Interfaces:**
- Produces (HTTP):
  - `GET /items/:id/unidades?vendibles=true` → mismas filas que hoy, solo `disponible` del
    **local** (`UbicacionesService.localDe`) y sin las apartadas en una cuenta abierta (mismo
    `unnest` que la Task 1, sin excluir ninguna cuenta), ordenadas por condición
    (`nuevo` primero, después `reacondicionado`, después `usado`) y después por serie.
  - `GET /ventas/:id` → cada línea agrega `unidades: { serie: string; condicion: string }[]`
    (`[]` si no aplica). Sale de **una** consulta por venta:
    `movimientos_inventario` (venta_id, tipo salida) → `movimiento_inventario_detalle` →
    `item_unidad`, agrupada por `item_id` en memoria.
- [ ] **Step 1: e2e que falla:**
  - `vendibles=true` no trae la de la bodega ni la apartada por una mesa;
  - sin el flag, el resultado no cambia;
  - el detalle de la venta de la Task 2 trae la serie y la condición vendidas.
- [ ] **Step 2: Verlo fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde** + typecheck/lint.
- [ ] **Step 5: Stagear.**

---

### Task 6: Salón — la línea de cuenta lleva sus unidades

**Files:**
- Modify: `backend/src/modules/salones/dto/add-linea.dto.ts`, `update-linea.dto.ts`
  (`unidadIds?: string[]`, `@IsOptional() @IsArray() @IsUUID(undefined, { each: true })`,
  `@ArrayMaxSize(200)` como los vecinos; en `UpdateLineaDto`, `cantidad` pasa a opcional:
  se manda `cantidad` **o** `unidadIds`)
- Modify: `backend/src/modules/salones/salones.service.ts`: `agregarLinea` (~780),
  `actualizarLinea` (~1009), `fusionarCuentas` (~1881), `armarDetalle` (las unidades por
  línea), y el tipo `CuentaLineaDetalle`
- Test: `backend/src/modules/salones/salones.service.spec.ts`, Create `backend/test/salon-serie.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 `bloquearUnidadesParaSalida` y `CuentaLinea.unidadIds`. Task 2 (`cerrarCuenta`
  ya manda las unidades).
- Produces: `CuentaLineaDetalle.unidades: { id: string; serie: string; condicion: string }[]`
  (`[]` en líneas sin serie), leídas en **una** consulta por cuenta.

**Reglas** (todas bajo el lock de la cuenta, que ya se toma):
- `agregarLinea` de un producto modo serie:
  - `unidadIds` obligatorio, con `dto.cantidad === unidadIds.length` entera;
  - las unidades pasan por `bloquearUnidadesParaSalida({ …, ubicacionId: local, cuentaId: null })`.
    Con `null` también rechaza las ya apartadas por **esta** cuenta: no se puede pedir dos
    veces la misma;
  - se fusiona igual que hoy, y en la fusión `match.unidadIds = [...match.unidadIds, ...nuevas]`;
  - `unidadIds` en un ítem sin serie → 400.
- `actualizarLinea` de una línea con serie:
  - exige `unidadIds` (el conjunto nuevo); con `cantidad` sola → 400
    `Cambiá las unidades de «<nombre>», no la cantidad`;
  - la cantidad nueva es `unidadIds.length`, y el tope de `cantidad_enviada` sigue igual;
  - las nuevas (las que no estaban) pasan por `bloquearUnidadesParaSalida` con `cuentaId: null`,
    y las que se quedan no se revalidan;
  - `validarStockAlPedir` sigue corriendo con previas/nuevas como hoy.
- `fusionarCuentas`: donde hoy suma cantidades a la línea destino, concatena también `unidadIds`;
  donde reasigna `cuentaId`, las unidades viajan solas.
- `quitarLinea` y `cancelarCuenta` (sin motivo): sin cambios. Liberan porque la línea o la
  cuenta dejan de contar.
- [ ] **Step 1: Tests que fallan** (unit del merge/concat + e2e con la API real):
  - pedir con unidad; pedir la misma unidad en otra mesa → 400 nombrando la mesa;
  - venderla por POS mientras está en la mesa → 400;
  - cambiar unidades por PATCH;
  - PATCH con `cantidad` sola en una línea con serie → 400;
  - fusionar dos cuentas con unidades;
  - cerrar la cuenta → las unidades quedan `vendido` y el detalle de la venta las muestra;
  - quitar la línea → la unidad vuelve a salir en `vendibles=true`.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde** el spec nuevo + `test/salones*.e2e-spec.ts` + `test/reserva-stock-mesa.e2e-spec.ts` + typecheck/lint.
- [ ] **Step 5: Stagear.**

---

### Task 7: Salón — anular y cancelar con motivo una línea con serie

**Files:**
- Modify: `backend/src/modules/salones/dto/anular-linea.dto.ts` (`unidadIds?: string[]`)
- Modify: `backend/src/modules/salones/salones.service.ts` (`escribirAnulacionDeLinea` ~1291,
  `escribirAnulacionEnLinea` ~1462, `escribirCancelacionConMotivo` ~1698)
- Modify: `backend/src/modules/items/items.service.ts` (`consumirLineaAnulada`, rama producto
  ~4642: recibe y pasa `unidadIds` y `cuentaId`; actualizar el docblock ~4604 que hoy describe el FIFO)
- Test: `backend/test/salon-serie.e2e-spec.ts`, unit de `salones.service.spec.ts` / `items.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`cuentaId`), Task 6 (`CuentaLinea.unidadIds`).
- Produces: `consumirLineaAnulada(…, params & { unidadIds?: string[]; cuentaId?: string })`.

**Reglas:**
- `anularLinea` en una línea con serie:
  - `unidadIds` obligatorio, con `length === cantidad` y subconjunto de `linea.unidadIds`;
    si no → 400 `Elegí cuáles unidades de «<nombre>» se anulan`;
  - las anuladas salen de `linea.unidadIds`;
  - con motivo merma o cortesía, `consumirLineaAnulada` las pasa al chokepoint con `cuentaId`
    y quedan `baja`;
  - con `no_elaborado` no hay movimiento y quedan libres.
- En anulación de serie **no** se saltea en silencio: si el chokepoint rechaza una unidad
  nombrada, es una invariante rota y la anulación aborta. Verificar que `moverConsumoOSaltear`
  no lo degrade a advertencia (su catch mira el prefijo `Stock insuficiente`, y los mensajes
  de la Task 1 no lo usan; dejarlo explícito en un test).
- `escribirCancelacionConMotivo`, por línea con serie:
  - `cantidad_enviada = 0` → se libera (como hoy, sin movimiento);
  - `cantidad_enviada = cantidad` → se anulan todas sus unidades;
  - en otro caso → 400 `Anulá primero «<nombre>» eligiendo cuál salió`, antes de escribir
    nada. Precalcular en el loop de lectura, no a mitad de las escrituras.
- [ ] **Step 1: Tests que fallan** (e2e):
  - anular 1 de 2 con merma → esa queda `baja`, la otra sigue en la línea;
  - anular con `no_elaborado` → la unidad vuelve a `vendibles`;
  - anular sin `unidadIds` → 400;
  - cancelar con motivo con la línea despachada a medias → 400 y nada cambió;
  - cancelar con motivo con la línea despachada entera → todas `baja`.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde** + `test/anular*.e2e-spec.ts` / `test/cancelar*.e2e-spec.ts` existentes + typecheck/lint.
- [ ] **Step 5: Stagear.**

---

### Task 8: Frontend — selector de unidades y carrito del POS

Antes de escribir: invocar la skill `nuxt-ui` (memoria del owner) y leer `docs/patterns/frontend.md`
y `frontend/docs/DESIGN-SYSTEM.md`.

**Files:**
- Create: `frontend/app/components/ventas/UnidadesSerieModal.vue` (+ `UnidadesSerieModal.nuxt.spec.ts`)
- Create o Modify: un composable para la carga, `frontend/app/composables/useUnidadesSerie.ts`
  (`cargarVendibles(itemId)` → `GET /items/:id/unidades?vendibles=true`; `etiquetaCondicion(c)`
  y `colorCondicion(c)` con los tokens semánticos). Antes de crearlo, buscar si ya hay
  helpers de condición en `configuracion/items.vue` y extraerlos si es la tercera vez.
- Modify: `frontend/app/composables/useVenta.ts`:
  - `ItemCatalogo.modoInventario?: string | null`;
  - `CarritoLinea.unidades?: { id: string; serie: string; condicion: string }[]`;
  - `agregarLinea` acepta unidades;
  - una función `setUnidades(lineas, index, unidades)` que fija `cantidad = unidades.length`;
  - `toVentaLineasBody` manda `unidadIds`.
- Modify: `frontend/app/components/ventas/CarritoPanel.vue`: en una línea con unidades, las
  series como badges y un botón "Cambiar unidades" en vez de `AppCantidadInput`; emite
  `cambiar-unidades`.
- Modify: `frontend/app/pages/ventas/pos.vue`: en `onCatalogoAdd`, si
  `item.modoInventario === 'serie'` abre el modal. El handler del modal y de
  `cambiar-unidades` va en el script; **no tocar** `cargar()`.
- Test: `useVenta` (spec existente), `CarritoPanel.nuxt.spec.ts`, el spec nuevo del modal.

**Contrato del modal:**
- Props: `open`, `item: { id, nombre }`, `seleccionadas: string[]` (las ya en la línea),
  `excluir: string[]` (las de otras líneas del mismo ítem en esta pantalla).
- Emite `confirm: [{ id, serie, condicion }[]]`.
- Lista lo de `cargarVendibles`, más las `seleccionadas` aunque ya no vengan como vendibles
  (en el salón están apartadas por la propia cuenta: las pasa el llamador). Las `excluir` no
  se muestran.
- Buscador por serie (filtra; Enter con una sola coincidencia la marca, que es lo que permite
  escanear), casillas, condición como `UBadge`, garantía si hay.
- "Confirmar (N)" deshabilitado con 0 elegidas. Sin unidades → estado vacío
  `No hay unidades de «<nombre>» en el local`.

- [ ] **Step 1: Specs que fallan:**
  - `useVenta`: `toVentaLineasBody` manda `unidadIds`, y `setUnidades` fija la cantidad;
  - el modal: buscar, marcar, confirmar y las excluidas;
  - `CarritoPanel`: muestra las series y no el input de cantidad.
- [ ] **Step 2: Verlos fallar:** `cd frontend && npx vitest run <specs>`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde** + `npm run typecheck:ratchet && npm run design:check`.
- [ ] **Step 5: Stagear.**

---

### Task 9: Frontend — salón

Antes de escribir: skill `nuxt-ui`.

**Files:**
- Modify: `frontend/app/composables/useSalones.ts`:
  - `agregarLinea(cuentaId, itemId, cantidad, personalizacion?, unidadIds?)`;
  - `actualizarLinea` acepta `{ unidadIds }`;
  - `anularLinea` acepta `unidadIds`;
  - el tipo `CuentaLineaDetalle.unidades`.
- Modify: `frontend/app/pages/salones/index.vue`:
  - en `addProducto`, si es modo serie abre `UnidadesSerieModal` (`excluir` = las de las
    otras líneas de la cuenta) y al confirmar llama `agregarLinea` con las unidades;
  - la línea con unidades muestra las series y "Cambiar unidades" en vez de
    `AppCantidadInput` (modal con `seleccionadas` = las de la línea → `actualizarLinea({ unidadIds })`);
  - **no tocar** `refrescarItems()` / la carga del catálogo.
- Modify: `frontend/app/components/salones/AnularLineaModal.vue`: si la línea trae `unidades`,
  casillas por unidad en vez del input numérico, y emite `{ cantidad: String(n), unidadIds, motivoBajaId }`.
  El tope sigue siendo `cantidadEnviada`: no se pueden marcar más de esas.
- Test: `AnularLineaModal` (spec nuevo o existente) y el spec de `useSalones` si existe.
- [ ] **Step 1: Specs que fallan** (el modal de anular con unidades; el api manda `unidadIds`).
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde** + `typecheck:ratchet` + `design:check`.
- [ ] **Step 5: Stagear.**

---

### Task 10: Frontend — detalle de venta

**Files:**
- Modify: `frontend/app/components/ventas/VentaDetalleDrawer.vue` (tipo de línea, ~73, y la
  fila: bajo la línea, `Serie A1 · nuevo` por unidad, con la misma etiqueta de condición de
  `useUnidadesSerie`)
- Test: `VentaDetalleDrawer.nuxt.spec.ts`
- [ ] **Step 1: Spec que falla** (una línea con `unidades` muestra serie y condición; sin unidades, nada).
- [ ] **Step 2: Verlo fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde.**
- [ ] **Step 5: Stagear.**

---

### Task 11: Playwright — POS y salón

**Files:**
- Create: `frontend/e2e/ventas/venta-serie.spec.ts`, `frontend/e2e/salones/salon-serie.spec.ts`
  (seguir el molde de los specs vecinos de esas carpetas y de `e2e/support`; el login va por
  el setup de Playwright, nunca tipeando credenciales a mano)

**Casos:**
- Setup por API: un producto modo serie propio con una unidad `nuevo` y una `usado` en el
  local.
- **POS:** tocar el producto → el modal lista las dos con su condición → elegir la usada →
  el carrito muestra su serie → cobrar → el detalle de la venta muestra `Serie <usada> · usado`.
- **Salón:** con un garzón propio (no Ana del seed: memoria "el garzón del seed se pisa"),
  abrir una mesa → agregar el producto eligiendo la nueva → la línea muestra la serie →
  cobrar → la venta queda con esa serie.
- [ ] **Step 1:** `./scripts/entorno.sh stack`, mirar `RestartCount`/`OOMKilled` de los contenedores, y pedir turno de Playwright.
- [ ] **Step 2:** escribir los specs y correrlos (`cd frontend && npx playwright test <specs>`).
- [ ] **Step 3: Stagear.**

---

### Task 12: Documentación (mismo commit que el código)

**Files:**
- `docs/features/inventario-serializado.md`:
  - la regla nueva (nadie elige por vos; el apartado por cuenta; `vendibles`; combos, grupos,
    tienda y merma cerrados), sacando el "FIFO automático";
  - Last Updated;
  - el seeder que la doc promete y no existe (iPhone/Paracetamol): verificar contra el seed y
    corregir la línea si miente.
- `docs/adr/007-inventario-serie-lote.md`: nota bajo Date. La salida de modo serie siempre
  nombra sus unidades (2026-10-03). `reservado` sigue sin productor: el apartado se deriva de
  la cuenta abierta, y por qué.
- `docs/features/ventas.md` y la doc de salones (`docs/features/` del salón): el contrato de
  `unidadIds`.
- `docs/ESTADO.md`: fila de la feature.
- `docs/agent/pendientes.md`:
  - mudar la entrada de la § 3 a `docs/agent/resueltos.md` con el detalle del fix;
  - en la entrada de la § 6 "Serie y lote están a medias", anotar que la merma ya **rechaza**
    serie (la mitad barata) y que el soporte sigue abierto;
  - dejar la sección vacía solo con su encabezado si queda así (memoria).
- `docs/patterns/backend.md`: si el método compartido de validación + lock establece un
  patrón nuevo, una línea; si no, nada.
- Borrar este plan y la spec (`docs/superpowers/README.md`: lo implementado se elimina; la
  historia queda en git).
- [ ] **Step 1: Escribir** las docs.
- [ ] **Step 2:** `node scripts/check-docs-links.mjs` (o lo que use el pre-commit) en verde.
- [ ] **Step 3: Stagear.**

---

### Cierre (controlador)

- [ ] Skill `verify-feature` completa: el gate entero, backend (`lint:check`, `typecheck`,
  `npm test`, `test:e2e`) y frontend (`build`, `npm test`, `typecheck:ratchet`, `design:check`),
  con turnos para lo pesado y `reset-db.sh` antes y `--verificar` después del e2e.
- [ ] Playwright completo en local (turno).
- [ ] Smoke en el navegador con la **cajera** (POS) y con un **garzón** (salón), no admin.
- [ ] Revisión independiente (paso 7 de `verify-feature`) con el diff staged → recibo → commit
  sin `--no-verify`.
- [ ] `git -C <worktree> rebase main`. Si main tocó `inventario.service.ts`, `pos.vue`,
  `salones/index.vue`, `tienda/index.vue` o `useVenta.ts`, re-correr lo afectado.
- [ ] Avisar a la orquestadora: `listo para integrar: <rama> <SHA>` + conteos.
