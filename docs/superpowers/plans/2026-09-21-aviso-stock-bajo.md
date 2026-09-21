# Plan: aviso de stock bajo (punto de reorden)

> **Para agentes:** ejecutar con `superpowers:subagent-driven-development` o
> `superpowers:executing-plans`, tarea por tarea, marcando los checkboxes.

**Status:** Draft
**Date:** 2026-09-21
**Owner:** Cesar Matheus
**Spec:** [`../specs/2026-09-21-aviso-stock-bajo-design.md`](../specs/2026-09-21-aviso-stock-bajo-design.md)
— el plan argumenta desde la spec; leer las dos.

**Goal:** un mínimo por (producto, ubicación) que nace vacío; un bloque en el dashboard que no crece
aunque haya 40 productos bajo el mínimo; una marca en un listado nuevo de inventario que sí trae la
lista completa; el traslado precargado a quien tiene el permiso; y lo ya pedido (una compra en
borrador) deja de urgir.

**Arquitectura:** todo dentro de `InventarioModule` — entidad `stock_minimo` (registrada en
`app.module.ts`, sin repo inyectado, igual que `StockUbicacion`), tres endpoints nuevos, una
pantalla nueva `pages/inventario/stock-minimo.vue` y un bloque nuevo `InicioStockBajo.vue`.

**Fuera de alcance** (no tocar): el mínimo calculado o sugerido —solo se deja la columna `origen`,
sin escribirla nunca en `'sistema'`—, la orden de compra a proveedor, cualquier forma de "silenciar
por N días", y el vencimiento como señal de aviso.

---

## Global Constraints

Valen para **todas** las tareas.

- **`tenant_id` sale del token** (`req.user.tenantId`), nunca del body, query ni ruta.
- **Cantidades con `Decimal.js`**, nunca `number` nativo: `minimo` y `stock` son strings
  `numeric(18,4)`.
- **Soft delete filtrado en toda lectura nueva**: `eliminado_el IS NULL` en cada `SELECT`/`JOIN`
  (`items`, `ubicaciones`, `stock_minimo`, `compras`).
- **Sin N+1**: el bloque son dos consultas fijas (spec § 3.1); el listado es `COUNT` +
  `SELECT ... LIMIT/OFFSET` (patrón § 10 de `docs/patterns/backend.md`). Nunca una consulta por fila.
- **Tokens semánticos de Nuxt UI**, nunca Tailwind hardcodeado (`design:check` lo bloquea).
  `useApiFetch`/`$fetch`, nunca axios. Utilidades de presentación en composables de
  `app/composables/`, nunca locales a un `.vue`.
- **Bloque de UUIDs de seed reservado: `550e8400-e29b-41d4-a716-446655440481` a `…495`.** El más
  alto en uso hoy es `…449`. Antes de fijar **cada** ID, grep contra el **código** y no contra
  `docs/` — un plan que nombra un ID en prosa lo hace aparecer "ocupado" al revés.
  Solo se necesitan IDs si al llegar a la Tarea 6 no existe ya en el seeder un rol con permisos
  parciales de `Inventario` reutilizable (`Leer` sin `Crear` ni `Actualizar`): verificar primero.
- **Entorno**: `./scripts/entorno.sh db` alcanza para todo el `test:e2e` de este frente.
  `./scripts/entorno.sh stack` recién en la Tarea 8 (Playwright). **No hay turno que pedir.**
  `scripts/db-aislada.sh` ya no existe: no usarlo.
- **Revisiones con Sonnet**: `model: 'sonnet'` explícito en toda llamada a `Agent`. Antes de cada
  revisión, escribir **qué no se verificó** —una duda concreta, no "revisá todo"— y delegar eso.
  Medido en otro frente: una duda puntual volvió en ~2,5 min y ~71k tokens y encontró más que las
  rondas de "revisá todo" (~10 min, 140-190k).
- **Nunca `--no-verify`.** Stagear por ruta explícita, nunca `git add -A`.
- **No mergear ni pushear.** Avisar a la orquestadora al cerrar **cada** tarea, no solo al final.
- **Documentación viva en el commit que la cierra**: `docs/features/aviso-stock-bajo.md` desde
  `docs/features/TEMPLATE.md`, link en `docs/README.md`, fila en `docs/ESTADO.md`.

### Gate de cierre de cada tarea

```bash
cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
```

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Más la revisión independiente del paso 7 de `verify-feature` (`domain-reviewer`, y
`api-security-reviewer` en las tareas que tocan controller, DTO, entidad o permiso). El pre-commit
exige el recibo para el diff exacto que se va a commitear: re-stagear antes de pedir la
re-revisión.

⚠️ Correr **una sola suite** de e2e necesita que el patrón incluya `.e2e-spec`: si el worktree se
llama como el frente, un patrón más corto matchea la ruta entera y corren las ~90 suites.

---

## Contratos compartidos

```ts
export interface StockMinimoFila {
  itemId: string;
  itemNombre: string;
  ubicacionId: string;
  ubicacionNombre: string;
  minimo: string;           // numeric(18,4)
  origen: 'manual' | 'sistema';
  stock: string;            // COALESCE(su.stock, 0)
  bajoMinimo: boolean;
  enCamino: boolean;        // hay una compra 'borrador' con este item + ubicacion
}

export interface StockBajoResumen {
  total: number;
  porUbicacion: { ubicacionId: string; ubicacionNombre: string; cantidad: number }[]; // <= 4
}
```

Los nombres y tipos de acá son los que mandan.

---

## Tarea 1 — La tabla `stock_minimo` y su upsert

Fija el modelo de datos. No expone ningún endpoint.

**Archivos:** crear `backend/src/modules/inventario/entities/stock-minimo.entity.ts`; modificar
`backend/src/app.module.ts` (agregar la entidad al array, igual que `StockUbicacion`); test en
`backend/src/modules/inventario/inventario.service.spec.ts`.

- [ ] **Paso 1: unit test que falla** — `upsertMinimo(tenantId, itemId, ubicacionId, minimo)`:
      rechaza si el ítem no es `tipo='producto'` con el mensaje existente *"El item no tiene control
      de stock"*; rechaza si la ubicación no es del tenant; hace el `ON CONFLICT ... DO UPDATE` con
      `eliminado_el = NULL`. Afirmar sobre el SQL, no sobre un mock que ya devuelve el resultado.
      Test propio para `minimo = null` → soft-delete.
- [ ] **Paso 2: correrlo y confirmar que falla.**
- [ ] **Paso 3: implementar** la entidad y el método.
- [ ] **Paso 4: confirmar verde** más `typecheck`.
- [ ] **Paso 5: gate y commit** — `feat(inventario): la tabla de mínimo por ubicación, sin endpoint todavía`.

---

## Tarea 2 — `GET /inventario/stock-minimo` (listado paginado con la marca)

**Archivos:** el controller y el service de `inventario`; crear
`dto/find-stock-minimo.dto.ts` (extiende el DTO de paginación, filtro opcional `soloBajoMinimo`);
test `backend/test/stock-minimo.e2e-spec.ts`.

- [ ] **Paso 1: e2e que falla** — 200 con `Inventario:Leer` y 403 con un rol real sin el permiso
      (no admin); un ítem con mínimo y stock por debajo sale con `bajoMinimo: true`; el mismo con
      una compra `borrador` sale con `enCamino: true`; un ítem con mínimo pero **sin fila** en
      `stock_ubicacion` sale con stock 0 y `bajoMinimo: true`; los tres modos comparan igual.
- [ ] **Paso 2: correrlo y confirmar que falla.**
- [ ] **Paso 3: el DTO de query.**
- [ ] **Paso 4: implementar el service** — `WHERE` compartido → `COUNT(*)` → página, con el
      `LEFT JOIN` a `stock_ubicacion` y el `EXISTS` de compras de la spec § 3.2.
- [ ] **Paso 5: la ruta** con `@RequiresPermiso('Inventario', 'Leer')`.
- [ ] **Paso 6: confirmar verde.**
- [ ] **Paso 7: gate y commit** — `feat(inventario): listado de stock por ubicación con marca de mínimo`.

---

## Tarea 3 — `PUT /inventario/stock-minimo/:itemId/:ubicacionId`

**Archivos:** el mismo controller y service; crear `dto/set-stock-minimo.dto.ts`; el mismo e2e.

- [ ] **Paso 1: e2e que falla** — 200 cargando un mínimo nuevo; 200 limpiándolo y el listado deja
      de marcarlo; **200 recargando el mismo par después de limpiarlo** (este es el caso que se
      rompe sin el revivir-no-reinsertar de la spec § 1); 400 si el ítem no es producto; 400 con
      una ubicación de otro tenant; 403 con un rol real que tiene `Leer` pero no `Actualizar`.
- [ ] **Paso 2: correrlo y confirmar que falla.**
- [ ] **Paso 3: el DTO** (`minimo: string | null`, `>= 0`).
- [ ] **Paso 4: implementar** con el `upsertMinimo` de la Tarea 1.
- [ ] **Paso 5: la ruta** con `@RequiresPermiso('Inventario', 'Actualizar')`.
- [ ] **Paso 6: confirmar verde.**
- [ ] **Paso 7: gate y commit** — `feat(inventario): cargar y limpiar el mínimo por ubicación`.

---

## Tarea 4 — `GET /inventario/stock-bajo/resumen`

**Archivos:** el mismo controller y service; test `backend/test/stock-bajo-resumen.e2e-spec.ts`.

- [ ] **Paso 1: e2e que falla** — 200 con el permiso y 403 sin él; con nada bajo el mínimo,
      `{ total: 0, porUbicacion: [] }`; con dos ubicaciones afectadas, las dos ordenadas por
      cantidad descendente; **la prueba del ruido** (spec § 8): sembrar pares bajo el mínimo en más
      de 4 ubicaciones y afirmar `porUbicacion.length <= 4` con `total` igual a la cuenta real,
      mayor que la suma de las 4 filas mostradas; una compra `borrador` saca el par, una
      `confirmada` que no alcanza **no** lo saca, una `anulada` lo devuelve.
- [ ] **Paso 2: correrlo y confirmar que falla.**
- [ ] **Paso 3: implementar** las dos consultas fijas de la spec § 3.1.
- [ ] **Paso 4: la ruta.**
- [ ] **Paso 5: confirmar verde.**
- [ ] **Paso 6: gate y commit** — `feat(inventario): el resumen de stock bajo, agrupado por ubicación`.

---

## Tarea 5 — `destinoId` opcional en el traslado precargado

**Archivos:** `frontend/app/pages/inventario/traslados.vue` (la lectura de la query) y su spec.

- [ ] **Paso 1: spec que falla** — con `destinoId` en la query, el drawer abre con ese destino y no
      con el local; **sin** `destinoId` (el caso del toast de rechazo de venta, que no cambia),
      sigue cayendo al local. El segundo es un test de regresión explícito para no romper el caller
      existente.
- [ ] **Paso 2: correrlo y confirmar que falla.**
- [ ] **Paso 3: implementar** el default en cascada, y limpiar también `destinoId` de la query al
      cerrar el drawer.
- [ ] **Paso 4: confirmar verde.**
- [ ] **Paso 5: gate y commit** — `fix(inventario): el traslado precargado acepta un destino explícito`.

---

## Tarea 6 — Pantalla `stock-minimo.vue` y su link

**Archivos:** crear `frontend/app/pages/inventario/stock-minimo.vue` y su spec; modificar el layout
del dashboard (el link va dentro del bloque ya gateado por `Inventario:Leer`).

- [ ] **Paso 1: verificar los fixtures de permiso** en el seeder. Si no existe un rol con **solo**
      `Inventario:Leer`, agregarlo con IDs del bloque reservado (grep de verificación primero).
- [ ] **Paso 2: specs de componente que fallan** — sin `Inventario:Leer` la página no monta ninguna
      llamada; con `Leer` pero sin `Actualizar`, la tabla se ve y el input de mínimo no está
      disponible; con `Actualizar`, guarda con `PUT`; el botón de traslado aparece solo con
      `Inventario:Crear` **real** y navega con el destino de la fila.
- [ ] **Paso 3: correrlos y confirmar que fallan.**
- [ ] **Paso 4: implementar la página** — tabla paginada del servidor, columna de mínimo editable
      gateada por `usePermisosCrud('Inventario').puedeActualizar`, columna de estado
      (`bajoMinimo`/`enCamino`), y la acción de traslado gateada por `.puedeCrear`.
- [ ] **Paso 5: el link del nav.**
- [ ] **Paso 6: confirmar verde.**
- [ ] **Paso 7: gate y commit** — `feat(inventario): pantalla de mínimo por ubicación, con marca y traslado`.

---

## Tarea 7 — `InicioStockBajo.vue` en el dashboard

**Archivos:** crear `frontend/app/components/inicio/InicioStockBajo.vue` y su spec; modificar
`frontend/app/pages/index.vue` (la grilla de "Ahora").

- [ ] **Paso 1: spec que falla** — sin `Inventario:Leer` no se pide la ruta; con el permiso se pide
      una vez y se refresca con `useRefrescoPeriodico` (timers falsos); con `total: 0` el bloque
      dice que no hay nada bajo el mínimo; con `total > 0` muestra el número y hasta 4 filas; un 403
      oculta el bloque sin toast, igual que `InicioCajas`.
- [ ] **Paso 2: correrlo y confirmar que falla.**
- [ ] **Paso 3: implementar** el componente y montarlo.
- [ ] **Paso 4: confirmar verde.**
- [ ] **Paso 5: gate y commit** — `feat(inicio): bloque de stock bajo, agrupado por ubicación`.

---

## Tarea 8 — E2E de navegador y documentación viva

Necesita `./scripts/entorno.sh stack`.

**Archivos:** crear `frontend/e2e/inventario/stock-minimo.spec.ts` y
`docs/features/aviso-stock-bajo.md`; modificar `docs/README.md` y `docs/ESTADO.md`.

- [ ] **Paso 1: el smoke por pantalla**, entrando con un **rol real** de `Inventario` y no con
      admin: cargar un mínimo, ver la marca, ver el bloque del dashboard con el número correcto,
      disparar el traslado precargado y verificar que abre con el destino correcto cuando la
      ubicación baja es una bodega, y que un rol sin `Inventario:Crear` ve el aviso **sin** botón.
- [ ] **Paso 2: correrlo.**
- [ ] **Paso 3: documentar** la feature, el link y la fila de estado. Una línea densa, sin
      superlativos ni conteos de completitud: describir el criterio.
- [ ] **Paso 4: gate completo** sobre el conjunto de las ocho tareas.
- [ ] **Paso 5: avisar a la orquestadora** que el frente está listo para la revisión de rama.

---

## Decisions / Open questions

| Decisión | Quién |
|---|---|
| Las seis decisiones de producto | owner, 2026-09-20 (`docs/agent/pendientes.md` § 4) |
| Tabla propia en vez de columna en `stock_ubicacion` | spec § 1 |
| Solo `borrador` cuenta como "en camino" | spec § 2 |
| "Baja de urgencia" se implementa como exclusión completa | spec § 2 |
| Pantalla nueva en vez de embeberla en el catálogo de Items | spec § 3.2 |
| Cargar el mínimo pide `Inventario:Actualizar` | spec § 4 |
| `destinoId` opcional y retrocompatible en traslados | spec § 5 |

**Abiertas** — las tres de la spec § 9, todas sobre qué pasa con un mínimo cargado cuando se borra
el ítem, se borra la bodega o se desactiva la bodega. **No frenan la Tarea 1**: la columna
`eliminado_el` alcanza para las dos primeras sin fijar la conducta fina. Confirmarlo antes de
escribir el DTO de limpieza si el owner contesta antes.
