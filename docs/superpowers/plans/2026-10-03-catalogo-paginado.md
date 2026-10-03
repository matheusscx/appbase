# Plan: catálogo paginado en el servidor y búsqueda en el servidor

> **Para agentes:** sub-skill requerida: superpowers:subagent-driven-development (recomendada) o
> superpowers:executing-plans. Las tareas usan checkboxes (`- [ ]`).

**Status:** Draft · **Date:** 2026-10-03 · **Owner:** Cesar Matheus

**Goal:** que el ítem 101 se pueda encontrar, vender y elegir. La grilla de venta pide al servidor
una página ordenada y buscada, y los selectores buscan en el servidor.

**Architecture:**
- `GET /items` suma `tipo` como lista, `ids`, `modoInventario` y `orden=disponibilidad`. Este
  último ordena en dos pasos en el servicio, porque la disponibilidad se calcula en TypeScript.
- El frontend suma un composable para la grilla (`useCatalogoVenta`), y un caché por pantalla
  (`useItemsPorId`) más un componente (`AppItemSelect`) para los selectores.

**Tech Stack:** NestJS + SQL crudo (`Db`), class-validator · Nuxt 4 + Nuxt UI v4 (`USelectMenu`,
`UPagination`) · Jest + supertest · Vitest (`mountSuspended`) · Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md`](../specs/2026-10-03-catalogo-paginado-design.md).
Leerla entera antes de la primera tarea: el plan argumenta desde ella.

## Global Constraints

- `MAX_PAGE_SIZE` sigue en **100**. La grilla pide `pageSize=48`; los selectores, `pageSize=20`.
- Sin los parámetros nuevos, `GET /items` responde **exactamente** lo de hoy (orden por
  `i.nombre`, un `tipo`, mismas columnas).
- **Orden de la grilla** (`orden=disponibilidad`):
  1. lo pedible primero (producto o ingrediente con `stockDisponible > 0`; receta o combo con
     `disponible ?? 1 > 0`; cualquier otro tipo es no pedible);
  2. después `Intl.Collator('es')` sobre `nombre`;
  3. después `item_id`.
- Sin `pg_trgm` ni dependencias nuevas. El índice va en la entity:
  `(tenant_id, tipo) WHERE eliminado_el IS NULL`.
- No cambian: `onCatalogoAdd`, la firma de `descontarStockCatalogo` ni la forma de `ItemCatalogo`
  (coordinado con el frente de serie a través de la orquestadora).
- Toda consulta nueva filtra `eliminado_el IS NULL`, sin N+1: la cantidad de consultas no crece
  con la página ni con el catálogo.
- Esperar 300 ms después de la última tecla, tanto en la grilla como en los selectores.
- Si una carga de la grilla falla, **no borra** lo que ya estaba en pantalla.
- **Suites pesadas por turno** (`test:e2e` completo, Playwright, `npm test` completo del
  frontend): pedirlas a la orquestadora con "pido turno: <suite>" y liberarlas con los conteos. Lo
  liviano (lint, typecheck, un spec suelto, build) no pide turno.
- **Commits:** solo dos (fin de la Fase A y fin de la Fase B), sobre la rama del worktree, con
  el recibo de `verify-feature` y **sin `--no-verify`**. Las tareas terminan stageando por ruta,
  nunca con `git add -A`. Lo integra la orquestadora.
- **Rutas absolutas o `git -C`:** el cwd se resetea en los worktrees.
  `WT=/Users/m2pro/cmatheus/startup-app/.claude/worktrees/quizzical-allen-919d2e`.

## Context

Hoy hay 22 llamadas en 11 pantallas que piden `pageSize=100` sin paginar. El detalle de cada
pantalla y los bugs que esconde el tope están en la spec, § 1. La base de este worktree
(`entorno.sh db`, puerto 5433) **ya tiene cargado el catálogo sintético** de la medición, en el
tenant Demo Restaurante (`…440007`). Por eso hay que resetearla antes de cualquier e2e
(Tarea 3).

## Scope / Out of scope

- **Entra:** spec §§ 3–5, y el cierre de las dos entradas de `pendientes.md` § 3 (la 🔺 y la de
  los 133 KB).
- **Fuera:** `GET /compras/productos`, que no pagina (se anota en el backlog en la Tarea 15). Y el
  `estadoPago` de `GET /compras` que cita `docs/features/compras.md`: es otro listado.

---

# Fase A — backend, grilla y salón (commit 1)

### Tarea 1: `tipo` como lista, `orden=disponibilidad`, índice, y medición (con freno)

**Files:**
- Create: `backend/src/modules/items/catalogo-orden.ts`, `backend/src/modules/items/catalogo-orden.spec.ts`
- Modify: `backend/src/modules/items/dto/query-items.dto.ts`, `backend/src/modules/items/dto/query-items.dto.spec.ts`
- Modify: `backend/src/modules/items/items.service.ts` (`buildFindAllFilters` ~:607, `findAll` ~:687)
- Modify: `backend/src/modules/items/entities/item.entity.ts` (el `@Index` nuevo), `startup-pos.sql` (la misma definición, como referencia)
- Test: `backend/src/modules/items/items.service.spec.ts` (`describe('findAll')`)

**Interfaces:**
- Produce: `QueryItemsDto.tipo?: TipoItem[]` (**pasa a ser array**: un valor suelto llega como
  `['producto']`), `QueryItemsDto.orden?: 'nombre' | 'disponibilidad'`.
- Produce: `compararPorDisponibilidad(a, b, disponible, stockDisponible): number` y
  `esPedible(tipo, disponible, stockDisponible): boolean`, en `catalogo-orden.ts`.

- [ ] **Paso 1: tests del orden (puros) que fallan.** En `catalogo-orden.spec.ts`:

```ts
import { compararPorDisponibilidad, esPedible } from './catalogo-orden';

const fila = (item_id: string, tipo: string, nombre: string) => ({ item_id, tipo, nombre });

describe('esPedible', () => {
  it('producto: pedible solo con stockDisponible > 0', () => {
    expect(esPedible('producto', undefined, '0.5000')).toBe(true);
    expect(esPedible('producto', undefined, '0.0000')).toBe(false);
    expect(esPedible('producto', undefined, '-2.0000')).toBe(false);
    expect(esPedible('producto', undefined, undefined)).toBe(false);
  });
  it('receta y combo: null es "sin bloqueantes", no "sin stock"', () => {
    expect(esPedible('receta', null, undefined)).toBe(true);
    expect(esPedible('combo', 0, undefined)).toBe(false);
    expect(esPedible('receta', -2, undefined)).toBe(false);
  });
  it('cualquier otro tipo no es pedible (igual que el cliente de hoy)', () => {
    expect(esPedible('servicio', undefined, undefined)).toBe(false);
  });
});

describe('compararPorDisponibilidad', () => {
  const disp = new Map<string, number | null>([['r-neg', -2], ['r-null', null]]);
  const stock = new Map<string, string>([['p-0', '0.0000'], ['p-3', '3.0000'], ['p-b', '1.0000']]);
  const ordenar = (filas: ReturnType<typeof fila>[]) =>
    [...filas].sort((a, b) => compararPorDisponibilidad(a, b, disp, stock)).map((f) => f.item_id);

  it('pedibles primero, después por nombre en español, después por id', () => {
    expect(
      ordenar([
        fila('p-0', 'producto', 'Agua'),
        fila('r-neg', 'receta', 'Ñoquis'),
        fila('p-3', 'producto', 'Ñandú'),
        fila('r-null', 'receta', 'Empanada'),
        fila('p-b', 'producto', 'empanada'),
      ]),
    ).toEqual(['p-b', 'r-null', 'p-3', 'p-0', 'r-neg']);
  });
});
```

  Medido con el Node del repo: `new Intl.Collator('es').compare('empanada','Empanada')` da `-1`
  (minúscula primero), y `Ñ` ordena después de `E` y antes de `Z`. El `toEqual` de arriba está
  armado con eso. Agregar además el caso del desempate: dos filas que se llaman `'Pan'`, con ids
  `'b'` y `'a'`, tienen que salir `['a', 'b']`.

- [ ] **Paso 2: correr y ver el fallo.**
  `npx --prefix $WT/backend jest $WT/backend/src/modules/items/catalogo-orden.spec.ts`.
  Esperado: FAIL, `Cannot find module './catalogo-orden'`.

- [ ] **Paso 3: implementar `catalogo-orden.ts`.**

```ts
import Decimal from 'decimal.js';

/**
 * El orden de la grilla de venta (`GET /items?orden=disponibilidad`). Es el que
 * calculaba `compararCatalogo` en `CatalogoGrid.vue` hasta el 2026-10-03, ahora en
 * el servidor: paginar con el orden en el cliente lo cambiaba de una página a la
 * otra. Spec: docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md § 3.2.
 */
const COLLATOR = new Intl.Collator('es');

export function esPedible(
  tipo: string,
  disponible: number | null | undefined,
  stockDisponible: string | null | undefined,
): boolean {
  if (tipo === 'receta' || tipo === 'combo') return (disponible ?? 1) > 0;
  if (tipo === 'producto' || tipo === 'ingrediente') {
    return stockDisponible != null && new Decimal(stockDisponible).greaterThan(0);
  }
  return false;
}

export function compararPorDisponibilidad(
  a: { item_id: string; tipo: string; nombre: string },
  b: { item_id: string; tipo: string; nombre: string },
  disponible: Map<string, number | null>,
  stockDisponible: Map<string, string>,
): number {
  const pa = esPedible(a.tipo, disponible.get(a.item_id), stockDisponible.get(a.item_id));
  const pb = esPedible(b.tipo, disponible.get(b.item_id), stockDisponible.get(b.item_id));
  if (pa !== pb) return pa ? -1 : 1;
  return COLLATOR.compare(a.nombre, b.nombre) || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0);
}
```

  Correr de nuevo. Esperado: PASS.

- [ ] **Paso 4: tests de DTO que fallan.** En `query-items.dto.spec.ts`, con el molde de los
  casos existentes (`plainToInstance` + `validate`):
  - `tipo: 'producto,receta'` → `['producto','receta']`;
  - `tipo: 'producto'` → `['producto']`;
  - `tipo: 'producto,pizza'` → error de validación;
  - `orden: 'disponibilidad'` pasa;
  - `orden: 'precio'` → error.

  Recordar (memoria del repo): estos tests no ejercen el pipe global; el 400 real lo cubre el e2e
  de la Tarea 3.

- [ ] **Paso 5: implementar el DTO.**
  - `tipo` con un `@Transform` que parte por coma, hace trim y deduplica (molde: `parseTurnoIds`
    en `propinas/dto/query-propina-reporte.dto.ts`), más `@IsIn(TIPOS_ITEM, { each: true })`.
  - Sacar el tipo literal a `const TIPOS_ITEM = [...] as const` en el mismo archivo.
  - `orden` con `@IsIn(['nombre', 'disponibilidad'])`.

  Correr los specs del DTO. Esperado: PASS.

- [ ] **Paso 6: test de servicio que falla: `tipo` como lista.** En `items.service.spec.ts`
  (`describe('findAll')`), con el molde de `'filtra por búsqueda…'` (:180):
  `findAll(TENANT, { tipo: ['producto', 'combo'] })` debe mandar `i.tipo = ANY($2)` con
  `['producto','combo']` como segundo parámetro. **Ajustar** el caso existente
  `{ tipo: 'receta' } as any` (:247) a `{ tipo: ['receta'] }`.

- [ ] **Paso 7: implementar en `buildFindAllFilters`.** Cambiar `AND i.tipo = $n` por
  `AND i.tipo = ANY($n)` con `params.push(query.tipo)`, solo si `query.tipo?.length`. Correr el
  `describe('findAll')`. Esperado: PASS.

- [ ] **Paso 8: test de servicio que falla: `orden=disponibilidad` arma la página desde el paso
  1.** Fijar con el mock de `dataSource.query`, en este orden:
  1. el paso liviano devuelve 3 filas: `p-sin` (producto `'Agua'`, `stock_vendible '0'`), `p-con`
     (producto `'Zapallo'`, `'5'`) y `r` (receta `'Burger'`);
  2. lo comprometido por las cuentas abiertas devuelve `[]`;
  3. los ingredientes de la receta devuelven `[]` (`disponible` queda en `null`, o sea pedible);
  4. el paso 2 (`WHERE i.item_id = ANY`) devuelve las filas completas **en otro orden**;
  5. lo que haga falta para `comboIdsConGrupos` (sin combos, nada).

  Con `page: 1, pageSize: 2`, afirmar:
  - `data.map(d => d.id)` es `['r', 'p-con']`: Burger y Zapallo son pedibles, y por nombre
    Burger va antes;
  - `meta.total` es `3`;
  - la consulta del paso 2 recibe `[['r','p-con'], TENANT, UBICACION_LOCAL_ID]`.

  ⚠️ El mock no ve la forma del SQL (memoria del repo): este test fija el **armado de la
  página**; el orden real lo fija el e2e de la Tarea 3.

- [ ] **Paso 9: implementar.**
  - Extraer de `findAll` el bloque que va desde `comboIdsConGrupos` hasta el `rows.map(...)`
    final a un `private async armarFilasListado(tenantId, query, rows, dispPorId,
    stockDispPorId)`. Lo usan los dos caminos; no se duplica.
  - En `findAll`: `if (query.orden === 'disponibilidad') return
    this.findAllPorDisponibilidad(tenantId, query);`.
  - El paso 1:

```ts
const localId = await this.ubicacionesService.localDe(tenantId);
const livianas: { item_id: string; tipo: string; nombre: string; stock_vendible: string | null }[] =
  await this.db.query(
    `SELECT i.item_id, i.tipo, i.nombre, su.stock AS stock_vendible
       FROM items i
       LEFT JOIN stock_ubicacion su
         ON su.item_id = i.item_id AND su.ubicacion_id = $${params.length + 1}` + where,
    [...params, localId],
  );
```

  - Con esas filas: los mismos `recetaIds`/`comboIds`/`productos` que hoy, y **una** llamada a
    `calcularDisponibilidadBatch`.
  - `sort` con `compararPorDisponibilidad`, y `slice(offset, offset + pageSize)`.
  - El paso 2, si hay ids:
    `this.baseQuery(3) + ' WHERE i.item_id = ANY($1) AND i.tenant_id = $2'` con
    `[ids, tenantId, localId]`.
  - Reordenar por la posición en `ids` y pasar por `armarFilasListado` con los mismos mapas de
    disponibilidad.
  - `meta: buildPaginationMeta(page, pageSize, livianas.length)`.
  - Comentario de por qué no va en SQL: spec § 3.2, una línea y el link.

  Correr el `describe('findAll')` completo. Esperado: PASS, sin tocar los casos viejos.

- [ ] **Paso 10: índice.**
  - En `item.entity.ts`, al lado del `@Index` existente:
    `@Index('idx_items_tenant_tipo_vivo', ['tenantId', 'tipo'], { where: '"eliminado_el" IS NULL' })`,
    con un comentario de una línea que apunte a la medición de la spec (§ 1).
  - La misma definición en `startup-pos.sql`, junto a la tabla `items`.
  - En `backend/test/esquema.e2e-spec.ts`, un caso con el molde del de :124: el índice existe, es
    `btree (tenant_id, tipo)` y tiene `WHERE (eliminado_el IS NULL)`.

- [ ] **Paso 11: medición con freno.**
  1. La base de 5433 todavía tiene el catálogo sintético. Si no lo tiene (por ejemplo, ya se
     reseteó), cargarlo con el script del Apéndice A.
  2. Levantar el backend contra esa base:
     `cd $WT/backend && PORT=3101 npm run start:dev`, en background, y esperar `Nest application
     successfully started`.
  3. Medir **5 veces** cada URL:

```bash
TOKEN=$(...)   # login admin.paris@paris.cl / admin + switch-tenant a …440007 (molde: e2e/support/api.ts tokenDe)
for u in "tipo=producto,receta,combo&activo=true&orden=disponibilidad&pageSize=48" \
         "tipo=producto,receta,combo&activo=true&orden=disponibilidad&pageSize=48&search=leche" \
         "tipo=producto&activo=true&pageSize=100"; do
  for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total} %{size_download}\n" \
    -H "Authorization: Bearer $TOKEN" "http://localhost:3101/api/items?$u"; done; done
```

  - Anotar la mediana de cada una.
  - ⛔ **Freno:** si la mediana de la primera URL pasa de **100 ms**, parar y reportar con los
    números. No seguir con la Tarea 2.
  - Bajar el backend. **No tocar ningún `.ts` con el backend corriendo** (se re-siembra).

- [ ] **Paso 12: lint y typecheck, y stagear.**
  `npm --prefix $WT/backend run lint:check && npm --prefix $WT/backend run typecheck`, y después
  `git -C $WT add` de los archivos de esta tarea, por ruta.

### Tarea 2: `ids` y `modoInventario`

**Files:**
- Modify: `backend/src/modules/items/dto/query-items.dto.ts` (+ `.spec.ts`)
- Modify: `backend/src/modules/items/items.service.ts` (`buildFindAllFilters`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Produce: `QueryItemsDto.ids?: string[]` (máximo 100, UUID cada uno) y
  `QueryItemsDto.modoInventario?: 'cantidad' | 'lote' | 'serie'`.

- [ ] **Paso 1: tests de DTO que fallan.**
  - `ids: 'a,b'` con UUID válidos da un array de 2;
  - un no-UUID da error;
  - 101 ids dan error (`ArrayMaxSize(100)`, molde: `compras/dto/pago-proveedor.dto.ts:71`);
  - `modoInventario: 'serie'` pasa;
  - `modoInventario: 'kilo'` da error.
- [ ] **Paso 2:** correr y ver el FAIL.
- [ ] **Paso 3: implementar el DTO.** El `@Transform` de partir por coma queda **una sola vez**
  en el archivo, reusado por `tipo` e `ids` (segundo uso, no se extrae a `common/`); después,
  `@IsUUID('4', { each: true })`, `@ArrayMaxSize(100)` y `@IsIn([...], ...)` donde corresponda.
  Correr. Esperado: PASS.
- [ ] **Paso 4: tests de servicio que fallan.**
  - `findAll(TENANT, { ids: [A, B] })` manda `i.item_id = ANY($2)` con `[A, B]`.
  - `findAll(TENANT, { modoInventario: 'cantidad' })` manda un `EXISTS` sobre `item_producto`
    con `modo_inventario = $2`. **Afirmar sobre la cláusula, no sobre `toContain('modo')`**: el
    comentario del SQL también lo contiene (memoria del repo).
- [ ] **Paso 5: implementar en `buildFindAllFilters`.**

```ts
if (query.ids?.length) {
  where += ` AND i.item_id = ANY($${idx++})`;
  params.push(query.ids);
}
// EXISTS y no el alias `ip`: este `where` también alimenta el COUNT sin JOIN (mismo motivo que `sinCosto`).
if (query.modoInventario) {
  where += ` AND EXISTS (SELECT 1 FROM item_producto ipm
                          WHERE ipm.item_id = i.item_id AND ipm.modo_inventario = $${idx++})`;
  params.push(query.modoInventario);
}
```

  `item_producto` no tiene `eliminado_el` (el borrado vive en `items`, que ya está filtrado).
  Correr el `describe('findAll')`. Esperado: PASS.
- [ ] **Paso 6:** lint, typecheck y stagear por ruta.

### Tarea 3: e2e del catálogo paginado (backend)

**Files:**
- Create: `backend/test/catalogo-paginado.e2e-spec.ts`

**Interfaces:**
- Consume: todo lo de las Tareas 1 y 2 por HTTP.

- [ ] **Paso 1: escribir el spec** con el molde de `items-pausados.e2e-spec.ts`:
  - el arranque (`validacionGlobal`, `cookieParser`), el `login` a Paris y el `afterAll` que
    acumula fallos;
  - `abrirCaja` de `helpers/caja`;
  - una `marca` única por corrida.

  En el `beforeAll`, crear **105 productos** por `POST /api/items`, uno por uno (el camino real),
  llamados `${marca} P001` … `${marca} P105`:
  - los que tienen número múltiplo de 3 con `stock: '0'`;
  - el resto con `stock: '5'`;
  - todos con `costo: '500'`.

  Casos:
  - **Recorre sin repetir ni saltear.** Con `?tipo=producto,receta,combo&activo=true&orden=disponibilidad&search=${marca}&pageSize=48`
    y `todasLasPaginas` de `helpers/paginacion.ts`, se recorren 105 ids distintos (el helper ya
    lo afirma).
  - **El orden.** Las primeras 70 filas son las de stock 5, en orden de nombre; las últimas 35,
    las de stock 0, en orden de nombre.
  - **El 101 se encuentra.** `search=${marca} P101` devuelve una fila, `P101`.
  - **El 101 se vende.** `POST /api/ventas` con esa línea y el molde de venta de
    `items-pausados` (caja abierta, efectivo y boleta del seed) devuelve 201.
  - **Lista inválida.** `tipo=producto,pizza` da 400.
  - **Demasiados ids.** `ids` con 101 UUIDs da 400.
  - **`ids` resuelve.** `ids=<id P101>,<id P002>` devuelve exactamente esos 2.
  - **Aislamiento de tenant.** Con `loginSegundoTenant` (`helpers/segundo-tenant`), `ids=<id
    P101>` devuelve `data: []`.
  - **`modoInventario=cantidad` con `search=${marca}`** devuelve los 105.
  - **Sin parámetros nuevos, nada cambia.** `tipo=producto&search=${marca}&pageSize=100`
    devuelve 100 filas ordenadas por nombre puro, con P003 en su lugar alfabético.

  `afterAll`: cerrar la caja y hacer `DELETE /api/items/:id` de los 105. El borrado es soft:
  `items.service` marca `eliminado_el`.
- [ ] **Paso 2: resetear la base** (tiene el catálogo sintético) y correr el spec solo:
  `$WT/scripts/reset-db.sh`, y después
  `npx --prefix $WT/backend jest --config $WT/backend/test/jest-e2e.json $WT/backend/test/catalogo-paginado.e2e-spec.ts`.
  Esperado: PASS. Si algo falla, primero `reset-db.sh --verificar`.
- [ ] **Paso 3: mutante que revierte.** Volver temporalmente `compararPorDisponibilidad` a
  comparar solo por nombre, con un `return COLLATOR.compare(...)` al principio. El caso de orden
  tiene que fallar. Revertir el mutante, mirar la hora de reinicio del watcher si hubiera uno
  corriendo, y volver a correr el spec hasta verlo en verde.
- [ ] **Paso 4:** stagear por ruta.

### Tarea 4: `useCatalogoVenta`

**Files:**
- Create: `frontend/app/composables/useCatalogoVenta.ts`, `frontend/app/composables/useCatalogoVenta.nuxt.spec.ts`

**Interfaces:**
- Produce:

```ts
export const PAGE_SIZE_CATALOGO = 48
export function useCatalogoVenta(opts: {
  tipos: Array<'producto' | 'receta' | 'combo'>
  /**
   * Query extra fijo por pantalla. Lo pidió la orquestadora para el frente de serie: la tienda
   * va a mandar un filtro propio (nombre a confirmar, p. ej. `vendibleOnline=true`). Ese filtro
   * tiene que vivir en `buildFindAllFilters` para que lo vean los dos caminos de `findAll`.
   */
  filtros?: Record<string, string>
  /** Cada carga que falla, ya descartadas las respuestas viejas. Sin esto, en silencio (salón). */
  onError?: (e: unknown) => void
}): {
  items: Ref<ItemCatalogo[]>
  total: Ref<number>
  page: Ref<number>
  busqueda: Ref<string>
  loading: Ref<boolean>
  pageSize: number
  /** Carga inicial, con `loading`. */
  cargar: () => Promise<void>
  /** Vuelve a pedir la página y la búsqueda actuales, sin `loading` (el refresco de fondo del salón). */
  refrescar: () => Promise<void>
}
```

- [ ] **Paso 1: tests que fallan** (`// @vitest-environment nuxt`, con `mockNuxtImport('useApiFetch', …)`
  como `pos.nuxt.spec.ts:122`, montando el composable dentro de un componente de prueba con
  `mountSuspended`, y `vi.useFakeTimers()` para los 300 ms). Casos:
  1. `cargar()` pide `/items?tipo=producto%2Creceta%2Ccombo&activo=true&orden=disponibilidad&page=1&pageSize=48`
     (o con `,` sin codificar: afirmar parseando con `URLSearchParams`, no por string).
  2. Tipear en `busqueda` no pide nada antes de 300 ms; a los 300 pide una vez, con `search` y
     `page=1`.
  3. Con `page = 3`, cambiar la búsqueda vuelve a `page = 1` y hace **un solo** pedido.
  4. **Turnos:** dos `refrescar()` seguidos donde el primero responde último dejan los `items`
     del segundo.
  5. **Un fallo no borra:** cargar, después `refrescar()` que rechaza; los `items` siguen siendo
     los de antes y `onError` se llamó una vez.
  6. **Página fuera de rango:** con `page = 3`, una respuesta con `total = 50` (son 2 páginas)
     lleva `page` a 2 y vuelve a pedir.
  7. **Filtros por pantalla:** con `filtros: { vendibleOnline: 'true' }`, el pedido lleva ese
     parámetro además de los fijos.
- [ ] **Paso 2:** `npx --prefix $WT/frontend vitest run app/composables/useCatalogoVenta.nuxt.spec.ts`.
  Esperado: FAIL.
- [ ] **Paso 3: implementar.**

```ts
import type { ItemCatalogo } from '~/composables/useVenta'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

/** 48 entra parejo en la grilla de 2 y de 3 columnas (`CatalogoGrid.vue`). */
export const PAGE_SIZE_CATALOGO = 48
const ESPERA_BUSQUEDA_MS = 300

/**
 * La grilla de venta (POS, salón, tienda), paginada y buscada en el servidor:
 * spec docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md § 4. El
 * orden también lo pone el servidor (`orden=disponibilidad`); acá no se ordena
 * ni se filtra nada.
 */
export function useCatalogoVenta(opts: {
  tipos: Array<'producto' | 'receta' | 'combo'>
  filtros?: Record<string, string>
  onError?: (e: unknown) => void
}) {
  const apiUrl = useRuntimeConfig().public.apiUrl
  const items = ref<ItemCatalogo[]>([])
  const total = ref(0)
  const page = ref(1)
  const busqueda = ref('')
  const loading = ref(false)
  let terminoActivo = ''
  // Descarta la respuesta que llega tarde (mismo criterio que tenía el salón con `secuenciaItems`).
  let turno = 0
  let espera: ReturnType<typeof setTimeout> | null = null

  async function refrescar() {
    const mio = ++turno
    const params = new URLSearchParams({
      ...opts.filtros,
      tipo: opts.tipos.join(','),
      activo: 'true',
      orden: 'disponibilidad',
      page: String(page.value),
      pageSize: String(PAGE_SIZE_CATALOGO),
    })
    if (terminoActivo) params.set('search', terminoActivo)
    try {
      const res = await useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?${params}`)
      if (mio !== turno) return
      const ultima = Math.max(1, Math.ceil(res.meta.total / PAGE_SIZE_CATALOGO))
      if (page.value > ultima) {
        page.value = ultima // el watch de `page` vuelve a pedir
        return
      }
      items.value = res.data
      total.value = res.meta.total
    }
    catch (e: unknown) {
      // Lo que ya estaba en pantalla se queda: un corte de wifi no vacía la grilla a mitad de servicio.
      if (mio === turno) opts.onError?.(e)
    }
  }

  async function cargar() {
    loading.value = true
    try { await refrescar() }
    finally { loading.value = false }
  }

  watch(busqueda, (q) => {
    if (espera) clearTimeout(espera)
    espera = setTimeout(() => {
      espera = null
      terminoActivo = q.trim()
      if (page.value !== 1) page.value = 1
      else void refrescar()
    }, ESPERA_BUSQUEDA_MS)
  })
  watch(page, () => { void refrescar() })
  onBeforeUnmount(() => { if (espera) clearTimeout(espera) })

  return { items, total, page, busqueda, loading, pageSize: PAGE_SIZE_CATALOGO, cargar, refrescar }
}
```

- [ ] **Paso 4:** correr el spec. Esperado: PASS. Mutante: sacar el `if (mio !== turno) return`;
  el caso 4 tiene que fallar. Revertir el mutante.
- [ ] **Paso 5:** stagear por ruta.

### Tarea 5: `CatalogoGrid` deja de filtrar y de ordenar, y pagina

**Files:**
- Modify: `frontend/app/components/ventas/CatalogoGrid.vue`
- Test: `frontend/app/components/ventas/CatalogoGrid.nuxt.spec.ts`

**Interfaces:**
- Produce: props `items: ItemCatalogo[]`, `loading?: boolean`, `total: number` y
  `pageSize: number`; `defineModel<string>('busqueda', { default: '' })` y
  `defineModel<number>('page', { default: 1 })`. El emit `add` no cambia.

- [ ] **Paso 1: tests que fallan.**
  - Tipear en el input emite `update:busqueda`.
  - Con `total: 100, pageSize: 48` aparece `UPagination`, y al cambiar de página emite
    `update:page`.
  - Con `total: 10` no aparece.
  - **Respeta el orden que llega:** con `[sinStock, conStock]` las tarjetas salen en ese orden
    (antes las reordenaba).
  - **Borrar** el caso `'el disponible negativo también ordena al final…'` (:137): ese orden
    ahora lo fijan `catalogo-orden.spec.ts` y el e2e. Dejar una línea en el `describe` que diga
    dónde se mudó.
  - El helper `montar` pasa `total: items.length, pageSize: 48`.
- [ ] **Paso 2:** `npx --prefix $WT/frontend vitest run app/components/ventas/CatalogoGrid.nuxt.spec.ts`.
  Esperado: FAIL.
- [ ] **Paso 3: implementar.**
  - Borrar `compararCatalogo` y `filtrados`.
  - El `v-for` recorre `items`, y el vacío mira `!items.length`.
  - El input pasa a `v-model="busqueda"`.
  - Debajo del bloque con scroll:
    `<div v-if="total > pageSize" class="flex justify-center shrink-0"><UPagination v-model:page="page" :items-per-page="pageSize" :total="total" /></div>`
    (molde: `pages/compras/index.vue:233`).
  - `sinStockVisual`, `puedeAgregar` y `tieneStock` quedan como están.
  - Comentario de una línea arriba del `v-for`: el orden lo pone el servidor
    (`orden=disponibilidad`).
- [ ] **Paso 4:** correr el spec, `npm --prefix $WT/frontend run design:check` y stagear.

### Tarea 6: POS y tienda

**Files:**
- Modify: `frontend/app/pages/ventas/pos.vue` (`items`/`loadingCatalogo` ~:57-62; `cargar()` ~:155-180; el template ~:355)
- Modify: `frontend/app/pages/tienda/index.vue` (:13-40 y :94)
- Test: `frontend/app/pages/ventas/pos.nuxt.spec.ts` (:134 rama `/items`; :220-226), `frontend/app/pages/tienda/index.nuxt.spec.ts` (:32)

**Interfaces:**
- Consume: `useCatalogoVenta` (Tarea 4) y las props y modelos de `CatalogoGrid` (Tarea 5).

- [ ] **Paso 1: ajustar los specs para que fallen.**
  - En `pos.nuxt.spec.ts`, el caso de :220 ("3 URLs con `tipo` producto/receta/combo") pasa a ser
    **1 URL**, con `tipo` = `producto,receta,combo`, `activo=true` y `orden=disponibilidad`.
  - Agregar un caso: con un ítem en el carrito, la tarjeta de ese ítem muestra el disponible
    descontado. `descontarStockCatalogo` sigue sobre la página.
  - En `tienda/index.nuxt.spec.ts`, la URL lleva `tipo=producto` y `orden=disponibilidad`.
- [ ] **Paso 2:** correr los dos specs. Esperado: FAIL.
- [ ] **Paso 3: implementar en `pos.vue`.**

```ts
const catalogo = useCatalogoVenta({
  tipos: ['producto', 'receta', 'combo'],
  onError: e => toast.add({ title: apiErrorMsg(e, 'Error al cargar el catálogo'), color: 'error' }),
})
const items = catalogo.items
const loadingCatalogo = catalogo.loading
```

  - Sacar los tres `useApiFetch` de `/items` del `Promise.all` de `cargar()` y sumar
    `catalogo.cargar()`.
  - Borrar el comentario de "los pausados no vienen… 100 lugares": ya no aplica.
  - `items.value = descontarStockCatalogo(items.value, lineasVenta)` después del cobro **queda**.
  - Template:
    `<VentasCatalogoGrid v-model:busqueda="catalogo.busqueda.value" v-model:page="catalogo.page.value" :items="itemsVisibles" :total="catalogo.total.value" :page-size="catalogo.pageSize" :loading="loadingCatalogo" @add="onCatalogoAdd" />`.
    Si `vue-tsc` se queja de `.value` en el template, desestructurar los refs al top-level.
  - **No tocar** `onCatalogoAdd` (lo toca el frente de serie).
- [ ] **Paso 4: lo mismo en `tienda/index.vue`**, con `tipos: ['producto']`. Si el frente de
  serie ya está en `main` cuando se rebasea, su filtro de la tienda pasa por `filtros` (spec del
  composable, caso 7).
- [ ] **Paso 5:** correr los dos specs (PASS), `npm --prefix $WT/frontend run typecheck:ratchet` y
  stagear.

### Tarea 7: salón

**Files:**
- Modify: `frontend/app/pages/salones/index.vue` (`items` ~:89; `secuenciaItems`/`refrescarItems`/`programarRefrescoItems` ~:975-1030; `cargarCatalogo` ~:1084; el template ~:3093)
- Test: `frontend/app/pages/salones/index.nuxt.spec.ts` (rama `/items` ~:746; asserts de cantidad de URLs en :1425, :2125, :2140, :2164, :2168, :4395, :4400; el caso de :1421; y el de :4364)

**Interfaces:**
- Consume: `useCatalogoVenta` sin `onError`, para conservar el silencio del 403 del garzón.

- [ ] **Paso 1: ajustar el spec para que falle.**
  - La rama `/items` del mock parsea `tipo` como **lista**
    (`new URLSearchParams(url.split('?')[1]).get('tipo')?.split(',')`) y filtra
    `catalogoItemsMock` por inclusión.
  - Cada "3" que cuenta URLs por refresco pasa a **1**, incluidos los `+ 3`.
  - El caso de :1421 pasa a llamarse "la consulta del catálogo lleva `activo=true` y los tres
    tipos".
  - El caso de :4364 ("un refresco que falla deja la grilla como estaba") queda igual: lo cubre
    el composable.
- [ ] **Paso 2:** `npx --prefix $WT/frontend vitest run app/pages/salones/index.nuxt.spec.ts`.
  Esperado: FAIL en los conteos.
- [ ] **Paso 3: implementar.**
  - `const catalogo = useCatalogoVenta({ tipos: ['producto', 'receta', 'combo'] })`;
    `items = catalogo.items`.
  - Borrar `secuenciaItems` y `refrescarItems`; `programarRefrescoItems` llama a
    `catalogo.refrescar()`.
  - En `cargarCatalogo`, `catalogo.cargar()` reemplaza la llamada vieja.
  - Mantener el docblock del refresco que **no borra**, recortado a lo que sigue siendo cierto y
    con un puntero al composable. Lo de "cada tipo conserva lo suyo" ya no aplica: es una sola
    llamada.
  - El `watch` de la firma de la cuenta y `REFRESCO_ITEMS_MS` no se tocan.
  - Template: igual que en el POS.
- [ ] **Paso 4: medir los bytes del refresco.** Con el catálogo sintético (Apéndice A) y el
  backend de la Tarea 1, comparar
  `curl -s -o /dev/null -w "%{size_download}"` de la URL nueva (48 ítems) contra la suma de las
  tres viejas. Anotar los dos números para la entrada de `resueltos.md`.
- [ ] **Paso 5:** correr el spec (PASS), typecheck y stagear.

### Tarea 8: Playwright — vender el 101

**Files:**
- Create: `frontend/e2e/ventas/catalogo-paginado.spec.ts`

- [ ] **Paso 1: escribir el spec.** Molde: `e2e/ventas/pos.spec.ts`, con `tokenDe`, `abrirCaja`,
  `crearProducto`, la baja de ítems en el `afterEach` y la red de seguridad del escenario.
  - Crear **101 productos** con la marca de la corrida, el 101 con un nombre distinguible.
  - **POS:** tipear la marca + `101` en el buscador de la grilla; la tarjeta aparece; agregarla;
    cobrar en efectivo; ver el toast de venta.
  - **Paginación:** con el buscador en la marca, cambiar a la página 3 con `UPagination` y ver una
    tarjeta que en la página 1 no estaba.
  - **Salón:** con el molde de `e2e/salones/cuenta-hasta-cobro.spec.ts` (garzón propio, no Ana),
    buscar el 101 en la grilla de la cuenta y agregarlo.
  - Correr el POS **como cajera**: `tokenDe` con las credenciales del rol cajero que use el
    seed. Si no hay una, preguntar antes de correr como admin (memoria: "Probar pantallas con el
    rol real").
- [ ] **Paso 2: pedir turno, correr y liberar.** Pedir "pido turno: Playwright" y esperar "turno
  tuyo". Antes de correr, `$WT/scripts/entorno.sh stack`, y mirar `RestartCount` y `OOMKilled`
  de los contenedores. Correr `npm --prefix $WT/frontend run e2e -- e2e/ventas/catalogo-paginado.spec.ts`
  y liberar el turno con los conteos.
- [ ] **Paso 3:** stagear por ruta.

### Tarea 9: docs de la Fase A, gate entero y commit 1

- [ ] **Paso 1: docs.**
  - Crear `docs/features/catalogo-paginado.md` desde `TEMPLATE.md`. Va el porqué, no el código:
    el orden en dos pasos y por qué no va en SQL, qué hace el refresco del salón, y que no hay
    trigram, con el umbral para reconsiderarlo.
  - Link en `docs/README.md`.
  - En `docs/patterns/backend.md`: "un orden derivado en TS se pagina en dos pasos" (una
    entrada corta con el link).
  - En `docs/patterns/frontend.md`: la grilla con `useCatalogoVenta`.
  - Si cambió algo de la entrada de la grilla en `docs/features/salones-mesas.md`, ajustarlo
    (grepear "refresc" y "/items").
- [ ] **Paso 2: gate entero, ejecutado y no afirmado.** Cada comando en una llamada aparte y
  mirando el exit code, sin `| tail`. Turnos para los pesados.

```bash
cd $WT/backend && npm run lint:check
cd $WT/backend && npm run typecheck
cd $WT/backend && npm test
$WT/scripts/reset-db.sh
cd $WT/backend && npm run test:e2e        # pido turno: test:e2e
$WT/scripts/reset-db.sh --verificar
cd $WT/frontend && npm run build
cd $WT/frontend && npm test               # pido turno: npm test frontend
cd $WT/frontend && npm run typecheck:ratchet
cd $WT/frontend && npm run design:check
```

- [ ] **Paso 3: verificar y commitear.**
  - Invocar el skill `verify-feature` (revisión independiente, paso 7) con la duda concreta:
    *"¿el paso 1 de `findAllPorDisponibilidad` filtra lo mismo que el `COUNT` viejo, incluido el
    ítem de ajuste y el borrado?"*.
  - Recibo atado a lo staged; re-stagear si hubo cambios.
  - Revisar `git -C $WT diff --cached --stat` y commitear
    `feat(catalogo): la grilla de venta pagina, ordena y busca en el servidor`.
  - **Todavía no se integra**: la entrada se cierra con la Fase B.

---

# Fase B — selectores con búsqueda en el servidor (commit 2)

> **La forma exacta del caché y del componente la fija la Tarea 10.** Las Tareas 11 a 14 copian
> esa forma: ajustarlas si la 10 cambió algún nombre, y decirlo en su reporte.

### Tarea 10: `useItemsPorId`, `AppItemSelect` y `promociones.vue`

**Files:**
- Create: `frontend/app/composables/useItemsPorId.ts` (+ `.nuxt.spec.ts`)
- Create: `frontend/app/components/AppItemSelect.vue` (+ `.nuxt.spec.ts`)
- Modify: `frontend/app/pages/configuracion/promociones.vue` (`cargarCatalogos` :188-208; `itemsOpts` :49-54; selector :521-529; `abrirEditar` :235-255)
- Test: `frontend/app/pages/configuracion/promociones.nuxt.spec.ts` (:117)

**Interfaces (contrato que consumen las Tareas 11–14):**

```ts
export interface FiltrosItems {
  tipo?: string[]
  activo?: boolean
  modoInventario?: 'cantidad' | 'lote' | 'serie'
}
export function useItemsPorId<T extends { id: string, nombre: string }>(): {
  /** Todo lo que la pantalla ya vio (búsquedas + resueltos). Única fuente para las cuentas. */
  porId: Map<string, T>            // reactive
  buscar: (termino: string, filtros: FiltrosItems) => Promise<T[]>   // pageSize=20, guarda en porId
  /** Pide `ids=` de los que faltan en `porId`, en tandas de 100. Sin filtros: un elegido pausado igual se resuelve. */
  resolver: (ids: string[]) => Promise<void>
  /** Para lo que la pantalla crea o edita sin pasar por el servidor (p. ej. `syncItemVendible`). */
  registrar: (item: T) => void
}
```

  `<AppItemSelect>`:
  - props `catalogo` (lo que devuelve `useItemsPorId`), `filtros?`, `multiple?`, `excluir?:
    string[]`, `etiqueta?: (item) => string`, `placeholder?`, `disabled?` y `clear?`;
  - `v-model` es `string | string[] | null`;
  - pasa `data-qa` y los atributos sueltos al `USelectMenu`.

- [ ] **Paso 1: tests del caché que fallan.**
  - `buscar('pan', { tipo: ['producto'], activo: true })` pide `search=pan`, `pageSize=20`,
    `tipo=producto` y `activo=true`, y deja los resultados en `porId`.
  - `resolver([a, b, a])` con `a` ya en el caché pide solo `ids=b`.
  - `resolver` con 150 ids hace 2 pedidos (100 + 50).
  - `resolver([])` no pide nada.
- [ ] **Paso 2: implementar `useItemsPorId`.** Un `reactive(new Map())` y `URLSearchParams`. No
  pagina más allá de la primera página: un selector muestra 20 y se sigue tipeando.
- [ ] **Paso 3: tests del componente que fallan.** Molde de montaje: `CatalogoGrid.nuxt.spec.ts`.
  1. Al abrir pide `buscar('')`; tipear espera 300 ms y pide con el término.
  2. **Unión con los elegidos:** con `v-model = [x]`, donde `x` está en `porId` pero no en los
     resultados, la opción de `x` existe con su etiqueta.
  3. Con `v-model = [y]`, donde `y` no está en `porId`, llama a `resolver([y])` al montar.
  4. `excluir` saca ids de los resultados, pero **nunca** a un elegido.
- [ ] **Paso 4: implementar `AppItemSelect.vue`.**
  - `<script setup lang="ts" generic="T extends { id: string, nombre: string }">`.
  - `USelectMenu` con `ignore-filter`, `v-model:search-term`, `value-key="value"` y
    `:loading="buscando"`; abre con `@update:open`.
  - Turnos con el patrón de `useCatalogoVenta`, para que una búsqueda vieja no pise a la nueva.
  - Opciones: primero los elegidos, leídos de `porId`, y después los resultados sin repetir ni
    excluidos, mapeados a `{ value: id, label: etiqueta(item) }`.
  - Un `watch` de los elegidos con `immediate` llama a `catalogo.resolver(ids)`.
  - Un error de búsqueda va a toast, con `apiErrorMsg`.
- [ ] **Paso 5: `promociones.vue`.**
  - Sacar `/items?pageSize=100` de `cargarCatalogos` (`/categorias` queda).
  - `const catalogoItems = useItemsPorId<ItemCatalogo>()`.
  - El selector de :521 pasa a `<AppItemSelect v-model="scope.itemIds" multiple :catalogo="catalogoItems" :etiqueta="i => i.categoriaNombre ? `${i.nombre} (${i.categoriaNombre})` : i.nombre" />`.
  - En `abrirEditar`, `await catalogoItems.resolver(todos los itemIds de todos los alcances)`
    antes de abrir.
  - Sin filtros: hoy entran todos los tipos, también los pausados, y se conserva.
- [ ] **Paso 6: spec de la pantalla.**
  - Ajustar el mock de :117 para que responda según `search` e `ids`.
  - Caso nuevo: editar una promoción cuyo alcance tiene un ítem que **no** está en la primera
    búsqueda muestra su nombre.
  - **Mutante que revierte:** sacar el `resolver` de `abrirEditar`; el caso nuevo tiene que
    fallar. Revertir.
- [ ] **Paso 7:** typecheck, `design:check` y stagear. En el reporte de la tarea va la forma
  final del contrato, para las Tareas 11–14.

### Tarea 11: `configuracion/items.vue` (componentes de combo, ingredientes, extras)

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue`:
  - `cargarItemsVendibles` :363-375 y `itemsVendibles`/`itemsVendiblesOpts` :359-362;
  - `productosIngrediente` :349-357 y su carga en `cargarCatalogos` :1246;
  - `syncItemVendible` :453-466, `syncProductoIngrediente` :435-451, `removeItemLocal` :468-474;
  - `costoComboPreview` :933-945 y `costoRecetaCalculado` :900-930;
  - `abrirEditar` :1370-1417;
  - los selectores :2479-2484, :2538-2543 y :2600-2605.
- Test: `frontend/app/pages/configuracion/items.nuxt.spec.ts`

- [ ] **Paso 1: tests que fallan.**
  - Editar un combo cuyo componente no aparece en la primera búsqueda muestra su nombre y suma
    su `costoActual` al preview. Hoy suma 0 en silencio: es el bug de spec § 1.
  - Lo mismo para una receta con un ingrediente así: el costo de la receta lo incluye.
- [ ] **Paso 2: implementar.** Dos cachés:
  - `catalogoVendibles`, con filtro `tipo: ['producto','receta','servicio']`;
  - `catalogoIngredientes`, con filtro `tipo: ['ingrediente']`.

  Las cuentas leen `catalogoX.porId.get(id)` en vez de `.find` sobre la lista. `abrirEditar`
  resuelve componentes, ingredientes y extras en **una** llamada por caché, antes de llenar el
  formulario. `syncItemVendible` y `syncProductoIngrediente` pasan a `registrar(item)`, y
  `removeItemLocal` a `porId.delete(id)`. La tabla principal (`usePaginatedList`) no se toca.
- [ ] **Paso 3:** mutante (sacar el `resolver` de `abrirEditar`: el caso del costo falla), correr
  el spec, typecheck y stagear.

### Tarea 12: `configuracion/grupos-modificadores.vue`

**Files:**
- Modify: `frontend/app/pages/configuracion/grupos-modificadores.vue` (`cargarItemsCatalogo` :309-322; `itemsCatalogo` :88; `familiaDeItem` :142-145; `opcionesDisponibles` :157-173; `abrirEditar` :381-396; el selector :721-727)
- Test: `frontend/app/pages/configuracion/grupos-modificadores.nuxt.spec.ts` (:109)

- [ ] **Paso 1: test que falla.** Editar un grupo con una opción cuyo ítem no aparece en la
  primera búsqueda: la fila muestra el nombre y la unidad, y la validación de familia de :413
  **corre** sobre esa fila.
- [ ] **Paso 2: implementar.**
  - Un caché, con filtro según la familia del grupo: `tipo: ['ingrediente']` o
    `['producto','receta','servicio']`, lo mismo que hoy decide `opcionesDisponibles`.
  - `excluir` = los ids de las filas hermanas.
  - `familiaDeItem` y las unidades leen `porId`.
  - `abrirEditar` resuelve todos los `opciones[].itemId`.
  - Sacar `cargarItemsCatalogo` y sus 4 pedidos.
- [ ] **Paso 3:** mutante, spec, typecheck y stagear.

### Tarea 13: inventario y mermas

**Files:**
- Modify: `frontend/app/pages/inventario/traslados.vue` (`cargarCatalogos` :129-148; `onSeleccionarItem` :237-278; `abrirDesdeQuery` :312-332; el selector :614-625)
- Modify: `frontend/app/pages/inventario/recuentos/index.vue` (:79-101, :112, el selector :280-289)
- Modify: `frontend/app/pages/inventario/index.vue` (:94-121, :163-203, los selectores :318 y :447)
- Modify: `frontend/app/pages/mermas.vue` (:76-79, :105-130, :146-151, los selectores :276 y :406)
- Test: los cuatro `.nuxt.spec.ts` de esas pantallas

- [ ] **Paso 1: tests que fallan.**
  - **traslados:** `?itemId=<id de un producto en modo serie que no está en la primera búsqueda>`
    abre la línea en modo serie, no en `'cantidad'` (bug de spec § 1).
  - **recuentos:** la búsqueda pide `modoInventario=cantidad` en el servidor.
  - **inventario y mermas:** el selector de filtro manda `itemId` al listado y "vacío" es todos.
- [ ] **Paso 2: implementar.** Un caché por pantalla, con
  `tipo: ['producto','ingrediente']`.
  - Las lecturas del elegido (`productoSeleccionado`, `productoAjusteSeleccionado`, el
    `producto` de `onSeleccionarItem`) leen `porId`.
  - `abrirDesdeQuery` hace `await resolver([itemId])` antes de `onSeleccionarItem`.
  - En recuentos, `filtros.modoInventario = 'cantidad'`, y se borra el `.filter` de :81.
  - Los filtros de mermas e inventario pierden el "Todos" de mentira y pasan a vacío con `clear`
    (spec § 5).
- [ ] **Paso 3:** mutante (traslados sin el `resolver`: el caso de serie falla), specs, typecheck y
  stagear.

### Tarea 14: `tienda/suscripciones.vue`

**Files:**
- Modify: `frontend/app/pages/tienda/suscripciones.vue` (`abrirCrear` :216-235; `itemsSuscribibles`/`itemsSuscribiblesOpts` :133, :174-179; `itemSeleccionado` :144-146; el selector :486-495)
- Test: `frontend/app/pages/tienda/suscripciones.nuxt.spec.ts` (si no existe, crearlo con el molde de `tienda/index.nuxt.spec.ts`)

- [ ] **Paso 1: test que falla.** Buscar pide `tipo=suscripcion&activo=true&search=…`;
  `itemSeleccionado` lee `porId`, y los días y el preview de precio siguen funcionando con un
  ítem que llegó por búsqueda.
- [ ] **Paso 2: implementar.**
  - Etiqueta: `nombre · formatMonto(precioBase, monedaId) · frecuencia`, la de :174-179.
  - El `.filter(i => i.frecuencia)` queda, aplicado a las opciones.
  - Sacar la carga perezosa de 100.
- [ ] **Paso 3:** spec, typecheck y stagear.

### Tarea 15: Playwright de un selector, docs, cierre de las entradas, gate y commit 2

- [ ] **Paso 1: Playwright.**
  - En `frontend/e2e/configuracion/`, un spec que crea 101 productos y edita un combo para
    sumarle el 101 buscándolo en el selector: guarda, reabre, y el componente se ve con su
    nombre.
  - Correrlo con el rol de configuración de ítems del seed (admin, si es admin-only:
    `TenantAdminGuard`; mirar el guard de `POST /items`).
  - Pedir turno.
- [ ] **Paso 2: docs.**
  - En `docs/features/catalogo-paginado.md`, la sección de selectores.
  - En `docs/patterns/frontend.md`: "selector de ítems = `AppItemSelect` + `useItemsPorId`;
    nunca `pageSize=100` como fuente de opciones", con el porqué.
  - `docs/ESTADO.md`: fila nueva, o actualizar la del catálogo de ítems, con la fecha.
  - En `docs/features/compras.md:407-414`, reescribir el puntero a la entrada (ya cerrada): el
    `estadoPago` de `GET /compras` sigue pendiente aparte.
  - Mudar las **dos** entradas de `pendientes.md` § 3 a `resueltos.md` con lo medido (tiempos de
    la Tarea 1, bytes de la Tarea 7, el índice).
  - Anotar en `pendientes.md` § 2 que `GET /compras/productos` no pagina (trae todo de una vez).
- [ ] **Paso 3: barrido de lo que quedó.** Este comando tiene que dar **0** líneas fuera de specs
  y docs:

```bash
grep -rn "pageSize=100\|pageSize: 100" $WT/frontend/app --include='*.vue' --include='*.ts' | grep -v 'spec.ts'
```

- [ ] **Paso 4: gate entero**, igual que en la Tarea 9, Paso 2 (con turnos), más el Playwright de
  las Tareas 8 y 15.
- [ ] **Paso 5: verificar, commitear y avisar.**
  - `verify-feature` con la duda concreta: *"¿alguna cuenta de una pantalla sigue leyendo de una
    lista y no de `porId`?"*.
  - Commit `feat(catalogo): los selectores de ítems buscan en el servidor`.
  - `git -C $WT rebase main`. Si el rebase toca `pos.vue` o `salones/index.vue` (frente de
    serie), volver a correr sus specs y el Playwright afectado.
  - Mandar a la orquestadora "listo para integrar: <rama> <SHA>", con lo que se corrió y sus
    conteos.

---

## Verification

Es la spec, § 7. Cada tarea trae su test que falla antes de implementar, y los mutantes de las
Tareas 3, 4, 10, 11, 12 y 13 prueban que el test caza el bug **revirtiendo** el código, no solo
rompiéndolo.

## Decisions / Open questions

- Decisiones: spec, § 2.
- **Abierta, con freno:** el tiempo de `orden=disponibilidad` (Tarea 1, Paso 11). Si pasa de
  100 ms, se para y se reabre la decisión 4 de la spec.

## Apéndice A — catálogo sintético para medir

Corre sobre la base de **este** worktree (`pg_quizzical-allen-919d2e`, 5433) y nunca sobre la del
checkout principal. Después hay que correr `reset-db.sh` antes de cualquier e2e.

```sql
\set T '''550e8400-e29b-41d4-a716-446655440007'''
\set T2 '''550e8400-e29b-41d4-a716-446655440040'''
\set M '''550e8400-e29b-41d4-a716-446655440003'''
-- :L = ubicación local del tenant T:
--   SELECT ubicacion_id FROM ubicaciones WHERE tenant_id = :T AND tipo = 'local' AND eliminado_el IS NULL;
BEGIN;
CREATE TEMP TABLE w(p text); INSERT INTO w VALUES ('Leche'),('Pan'),('Queso'),('Yogur'),('Arroz'),('Fideos'),('Aceite'),('Azucar'),('Cafe'),('Te'),('Galletas'),('Jugo'),('Bebida'),('Cerveza'),('Vino'),('Jabon'),('Shampoo'),('Detergente'),('Papel'),('Atun'),('Salsa'),('Harina'),('Sal'),('Mantequilla'),('Chocolate');
INSERT INTO items(tenant_id,moneda_id,nombre,descripcion,precio_base,tipo,activo)
SELECT :T2::uuid,:M::uuid,(SELECT p FROM w OFFSET (g%25) LIMIT 1)||' marca '||g,'desc '||g,1000,'producto',true FROM generate_series(1,45000) g;
INSERT INTO items(tenant_id,moneda_id,nombre,descripcion,precio_base,tipo,activo)
SELECT :T::uuid,:M::uuid,'SP '||(SELECT p FROM w OFFSET (g%25) LIMIT 1)||' '||md5(g::text)::varchar(6)||' '||g,'desc '||g,1000,'producto',(g%20<>0) FROM generate_series(1,5000) g;
INSERT INTO items(tenant_id,moneda_id,nombre,precio_base,tipo,activo) SELECT :T::uuid,:M::uuid,'SI ingrediente '||g,0,'ingrediente',true FROM generate_series(1,300) g;
INSERT INTO items(tenant_id,moneda_id,nombre,precio_base,tipo,activo) SELECT :T::uuid,:M::uuid,'SR receta '||g,5000,'receta',true FROM generate_series(1,600) g;
INSERT INTO items(tenant_id,moneda_id,nombre,precio_base,tipo,activo) SELECT :T::uuid,:M::uuid,'SC combo '||g,9000,'combo',true FROM generate_series(1,100) g;
INSERT INTO item_producto(item_id,unidad_medida,modo_inventario) SELECT item_id,'unidad','cantidad' FROM items WHERE tipo IN ('producto','ingrediente') AND item_id NOT IN (SELECT item_id FROM item_producto);
INSERT INTO item_receta(item_id) SELECT item_id FROM items WHERE tipo='receta' AND item_id NOT IN (SELECT item_id FROM item_receta);
INSERT INTO item_combo(item_id) SELECT item_id FROM items WHERE tipo='combo' AND item_id NOT IN (SELECT item_id FROM item_combo);
INSERT INTO stock_ubicacion(item_id,ubicacion_id,stock)
SELECT i.item_id,:L::uuid, CASE WHEN random()<0.3 THEN 0 ELSE floor(random()*50) END FROM items i
 WHERE i.tenant_id=:T::uuid AND (i.nombre LIKE 'SP %' OR i.nombre LIKE 'SI %');
INSERT INTO receta_ingredientes(tenant_id,receta_item_id,ingrediente_item_id,cantidad,unidad_codigo)
SELECT :T::uuid, r.item_id, ing.item_id, 1, 'unidad'
FROM (SELECT item_id, row_number() over () rn FROM items WHERE tenant_id=:T::uuid AND nombre LIKE 'SR %') r
JOIN LATERAL (SELECT item_id FROM items WHERE tenant_id=:T::uuid AND nombre LIKE 'SI %' ORDER BY md5(item_id::text||r.rn) LIMIT 4) ing ON true;
INSERT INTO combo_componentes(tenant_id,combo_item_id,componente_item_id,cantidad)
SELECT :T::uuid, c.item_id, x.item_id, 1
FROM (SELECT item_id, row_number() over () rn FROM items WHERE tenant_id=:T::uuid AND nombre LIKE 'SC %') c
JOIN LATERAL (SELECT item_id FROM items WHERE tenant_id=:T::uuid AND (nombre LIKE 'SR %' OR nombre LIKE 'SP %') ORDER BY md5(item_id::text||c.rn) LIMIT 3) x ON true;
COMMIT;
ANALYZE;
```

Se corre con
`docker exec -i pg_quizzical-allen-919d2e psql -U dev_user -d tecnica_db -v ON_ERROR_STOP=1 -v L="'<uuid local>'" < synth.sql`.
