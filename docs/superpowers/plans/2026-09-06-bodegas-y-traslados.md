# Plan: Bodegas y traslados — el stock deja de ser un escalar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft
**Date:** 2026-09-06
**Owner:** Cesar Matheus
**Spec:** [`../specs/2026-09-06-bodegas-y-traslados-design.md`](../specs/2026-09-06-bodegas-y-traslados-design.md)

**Goal:** que un tenant pueda tener bodegas que guardan stock sin venderlo, mover mercadería
entre ellas y el local con un documento interno, y que toda venta descuente **del local**.

**Architecture:** `item_producto.stock` (un escalar por ítem) se reemplaza por
`stock_ubicacion (item_id, ubicacion_id)`, que pasa a ser la única superficie de lectura de
stock. El chokepoint `InventarioService.registrarMovimiento` sigue siendo la única puerta de
escritura y gana `ubicacionId` obligatorio. La mudanza se hace en tres tiempos —**expandir**
(escribir en las dos), **girar** (leer de la nueva), **contraer** (borrar la vieja)— para que
cada commit deje `main` funcionando.

**Tech Stack:** NestJS + TypeORM (`synchronize: true`, sin migraciones), PostgreSQL 15,
Nuxt 4 + Nuxt UI, Jest + supertest (e2e de API), Playwright (e2e de navegador), Decimal.js.

---

## Global Constraints

Copiadas de `CLAUDE.md` y de la spec. **Aplican a todas las tareas**, no se repiten en cada una.

- **`tenant_id` sale siempre del token**, nunca del body, query ni ruta.
- **Dinero y cantidades con `Decimal.js`**, nunca `number` nativo.
- **Soft delete en todo.** Nunca `DELETE` físico; toda lectura filtra `eliminado_el IS NULL`
  salvo excepción con el porqué escrito **en la propia consulta**.
- **Nunca una query por iteración (N+1).** El dato derivado por fila se resuelve con `JOIN`,
  agregación, o batch con `WHERE id = ANY($1)`.
- **PK/FK con `type: 'uuid'` explícito** (ADR-004, hay test + CI que lo fuerzan).
- **`@Column` con tipo explícito.** Estrechar el tipo TS a una unión sin `type:` deja
  `design:type` en `Object` y **rompe el arranque**; solo lo caza el e2e.
- **Entidad nueva → también al array `entities` de `backend/src/app.module.ts`.** No hay
  `autoLoadEntities`; `forFeature` solo no alcanza, y ni el unitario ni el typecheck lo cazan.
- **El esquema sale de las entities** (`synchronize: true`). `startup-pos.sql` es documentación:
  se actualiza, no se ejecuta. **No se escriben migraciones ni backfills** — no hay datos
  productivos: se cambia la entity, se actualiza el seeder y se resetea la base.
- **Frontend:** tokens semánticos de Nuxt UI, **nunca** Tailwind hardcodeado. `$fetch` /
  `useApiFetch`, nunca axios. Lógica de presentación en `app/composables/`, no dentro del `.vue`.
- **No refactorizar fuera del alcance.** La única excepción autorizada es la Tarea 5, que el
  código pidió por escrito.
- **Commits directos a `main`**, sin ramas ni PRs. El gate de cierre es obligatorio antes de
  cada commit (`verify-feature`), y el pre-commit exige el recibo de la revisión independiente
  cuando el diff toca services de backend o `.vue` de `pages`/`components`.
- **⚠️ No tocar un `.ts` del backend con el e2e corriendo**: el watcher recompila y **vuelve a
  sembrar**, y salen decenas de fallos que no son regresiones. Ante un e2e raro, la primera
  pregunta la contesta `./scripts/reset-db.sh --verificar`.

### Nombres que este plan fija (usar exactamente estos)

| Nombre | Qué es |
|---|---|
| `Ubicacion` / tabla `ubicaciones` | entidad de lugar; `tipo` es `'local'` o `'bodega'` |
| `StockUbicacion` / tabla `stock_ubicacion` | saldo por `(item_id, ubicacion_id)` |
| `LoteUbicacion` / tabla `lote_ubicacion` | saldo de un lote por ubicación |
| `Traslado` / tabla `traslados` | documento interno de un traslado |
| `MotivoTraslado` / tabla `motivo_traslado` | catálogo tipado del motivo |
| `UbicacionesService.localDe(tenantId)` | devuelve el `ubicacion_id` del local del tenant |
| `stockVendible` | campo de API: lo que hay en el local |
| `stockDisponible` | campo de API: `stockVendible − comprometido` (**no cambia de nombre**) |

---

## Estructura de archivos

**Backend — se crean:**

| Archivo | Responsabilidad |
|---|---|
| `src/modules/ubicaciones/entities/ubicacion.entity.ts` | la entidad de lugar |
| `src/modules/ubicaciones/ubicaciones.service.ts` | CRUD + `localDe()` + validación de borrado con stock |
| `src/modules/ubicaciones/ubicaciones.controller.ts` | rutas admin-only |
| `src/modules/ubicaciones/ubicaciones.module.ts` | wiring |
| `src/modules/ubicaciones/dto/{create,update,query}-ubicacion.dto.ts` | validación de entrada |
| `src/modules/items/entities/stock-ubicacion.entity.ts` | saldo por ítem y lugar |
| `src/modules/items/entities/lote-ubicacion.entity.ts` | saldo por lote y lugar |
| `src/modules/traslados/entities/traslado.entity.ts` | el documento interno |
| `src/modules/traslados/traslados.service.ts` | el traslado: dos filas de kardex, locks, topes |
| `src/modules/traslados/traslados.controller.ts` | rutas con `@RequiresPermiso('Inventario','Crear')` |
| `src/modules/traslados/dto/create-traslado.dto.ts` | líneas del traslado |
| `src/modules/motivos-traslado/**` | catálogo, calcado de `motivos-diferencia-inventario/` |
| `src/common/db/reintento-deadlock.ts` | la constante y `esDeadlock`, hoy duplicados (Tarea 5) |

**Backend — se modifican:** `inventario.service.ts` (el chokepoint), `items.service.ts` (los
listados y `validarStockAlPedir`), `ventas.service.ts`, `salones.service.ts`,
`mermas.service.ts`, `recuentos.service.ts`, `grupos-modificadores.service.ts`,
`catalog.service.ts`, `tenants.service.ts` (siembra el local), `seeder.service.ts`,
`app.module.ts`, y `common/invariants/costo-stock-choke-point.invariant.spec.ts`.

**Frontend — se crean:** `pages/configuracion/ubicaciones.vue`,
`pages/configuracion/motivos-traslado.vue`, `pages/inventario/traslados.vue`,
`composables/useUbicaciones.ts`, más un `.nuxt.spec.ts` por pantalla.

**Frontend — se modifican:** `pages/configuracion/items.vue`, `pages/inventario/index.vue`,
`pages/mermas.vue`, `pages/inventario/recuentos/*`.

---

## Por qué el orden es este

La mudanza del saldo (Tareas 2-4) va en **expandir → girar → contraer** por una razón concreta:
este repo commitea directo a `main`, así que **cada commit tiene que dejar la app funcionando**.
Borrar `item_producto.stock` y arreglar sus ~29 lectores en un solo commit es una tarda de un
día entero con `main` roto en el medio.

Parado al final de cada tarea, el usuario ve: T2 → nada cambió; T3 → nada cambió; T4 → nada
cambió. Ningún estado intermedio es peor que el inicial. Recién la Tarea 9 hace visible el
traslado.

---

## Tarea 1: Ubicaciones — la entidad, su CRUD y el local sembrado

Al terminar: un admin puede crear, renombrar, desactivar y borrar bodegas. Cada tenant nace con
su ubicación `local`. **Nada del stock cambia todavía.**

**Files:**
- Create: `backend/src/modules/ubicaciones/entities/ubicacion.entity.ts`
- Create: `backend/src/modules/ubicaciones/ubicaciones.service.ts`
- Create: `backend/src/modules/ubicaciones/ubicaciones.controller.ts`
- Create: `backend/src/modules/ubicaciones/ubicaciones.module.ts`
- Create: `backend/src/modules/ubicaciones/dto/create-ubicacion.dto.ts`
- Create: `backend/src/modules/ubicaciones/dto/update-ubicacion.dto.ts`
- Create: `backend/src/modules/ubicaciones/dto/query-ubicaciones.dto.ts`
- Test: `backend/src/modules/ubicaciones/ubicaciones.service.spec.ts`
- Test: `backend/test/ubicaciones.e2e-spec.ts`
- Modify: `backend/src/app.module.ts` (import del módulo **y** array `entities`)
- Modify: `backend/src/modules/tenants/tenants.service.ts:316` (siembra, junto a la caja virtual)
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Create: `frontend/app/pages/configuracion/ubicaciones.vue` + `.nuxt.spec.ts`

**Interfaces:**
- Produces:
  - `class Ubicacion` (tabla `ubicaciones`), campos `id`, `tenantId`, `nombre`, `tipo`, `activo`
  - `UbicacionesService.localDe(tenantId: string): Promise<string>` — el `ubicacion_id` del
    local. **Todas las tareas siguientes lo usan.**
  - `UbicacionesService.findAll(tenantId, opts): Promise<UbicacionListItem[]>`
  - `GET|POST|PATCH|DELETE /ubicaciones`, `POST /ubicaciones/:id/restaurar`

- [ ] **Step 1: Escribir el test unitario que falla**

`backend/src/modules/ubicaciones/ubicaciones.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { UbicacionesService } from './ubicaciones.service';

describe('UbicacionesService', () => {
  const db = { query: jest.fn() };
  const service = new UbicacionesService(db as never);

  beforeEach(() => db.query.mockReset());

  it('localDe devuelve el ubicacion_id del local del tenant', async () => {
    db.query.mockResolvedValueOnce([{ ubicacion_id: 'u-local' }]);
    await expect(service.localDe('t1')).resolves.toBe('u-local');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/tipo\s*=\s*'local'/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
  });

  it('no deja borrar el local', async () => {
    db.query.mockResolvedValueOnce([{ tipo: 'local', nombre: 'Local' }]);
    await expect(service.remove('t1', 'usr', 'u-local')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('no deja borrar una bodega con stock adentro, y dice cuánto queda', async () => {
    db.query
      .mockResolvedValueOnce([{ tipo: 'bodega', nombre: 'Subsuelo' }])
      .mockResolvedValueOnce([{ items_con_stock: '2' }]);
    await expect(service.remove('t1', 'usr', 'u-bodega')).rejects.toThrow(
      /2 producto/,
    );
  });
});
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd backend && npm test -- ubicaciones.service.spec`
Expected: FAIL — `Cannot find module './ubicaciones.service'`

- [ ] **Step 3: La entidad**

`backend/src/modules/ubicaciones/entities/ubicacion.entity.ts`:

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * Un lugar donde vive stock. `tipo` es el corte que define todo el resto:
 * el `local` **vende** (toda venta descuenta de él) y una `bodega` solo
 * guarda. Ese corte es también el que mantiene a las bodegas fuera de lo
 * fiscal: una bodega no se declara al SII y no aparece en ningún documento
 * (ver la spec § 2 y ADR-010).
 *
 * Cada tenant tiene exactamente una fila `tipo='local'`, sembrada al crearlo.
 * No se elimina ni se desactiva.
 */
@Index('idx_ubicaciones_tenant', ['tenantId'])
@Entity('ubicaciones')
export class Ubicacion {
  @PrimaryGeneratedColumn('uuid', { name: 'ubicacion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  // `type: 'text'` explícito y no inferido: estrechar el tipo TS a una unión
  // sin declarar el tipo de columna deja `design:type` en `Object` y TypeORM
  // **no arranca**. No lo caza ni el unitario ni el typecheck, solo el e2e.
  @Column({ type: 'text' })
  tipo: 'local' | 'bodega';

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({
    name: 'actualizado_el',
    type: 'timestamptz',
    nullable: true,
  })
  actualizadoEl: Date | null;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
```

- [ ] **Step 4: El service**

Calcar la forma de `modules/motivos-diferencia-inventario/motivos-diferencia-inventario.service.ts`
(mismo `Db`, mismo `unwrap`, misma traducción de colisión de nombre con
`traducirColisionDeNombre`, mismo `restaurar`). Lo propio de esta entidad son estos tres
métodos:

```ts
/**
 * El `ubicacion_id` del local del tenant. Es el default de toda operación de
 * inventario que no elija lugar y el único origen del que sale una venta.
 *
 * No recibe `EntityManager`: `Db.query` resuelve solo el manager de la
 * transacción activa (ADR-020), así que llamarlo adentro de una transacción
 * lee lo que esa transacción ve.
 */
async localDe(tenantId: string): Promise<string> {
  const rows = (await this.db.query(
    `SELECT ubicacion_id FROM ubicaciones
      WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
    [tenantId],
  )) as { ubicacion_id: string }[];
  if (!rows.length) {
    // Un tenant sin local es un tenant que no puede vender. Se siembra al
    // crearlo, así que llegar acá significa una fila borrada a mano.
    throw new InternalServerErrorException(
      'El tenant no tiene ubicación local',
    );
  }
  return rows[0].ubicacion_id;
}

async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
  const filas = (await this.db.query(
    `SELECT tipo, nombre FROM ubicaciones
      WHERE ubicacion_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
    [id, tenantId],
  )) as { tipo: string; nombre: string }[];
  if (!filas.length) throw new NotFoundException('Ubicación no encontrada');

  if (filas[0].tipo === 'local') {
    throw new BadRequestException(
      'El local no se puede eliminar: es la ubicación desde la que se vende',
    );
  }

  // Vaciar antes de borrar. Sin esto el stock queda colgado de una fila
  // borrada: invisible en todo listado y sin forma de sacarlo.
  const conStock = (await this.db.query(
    `SELECT COUNT(*) AS items_con_stock
       FROM stock_ubicacion
      WHERE ubicacion_id = $1 AND stock <> 0`,
    [id],
  )) as { items_con_stock: string }[];
  const cuantos = Number(conStock[0].items_con_stock);
  if (cuantos > 0) {
    throw new BadRequestException(
      `"${filas[0].nombre}" todavía tiene ${cuantos} producto(s) con stock. ` +
        'Trasladá lo que queda antes de eliminarla.',
    );
  }

  await this.db.query(
    `UPDATE ubicaciones
        SET eliminado_el = NOW(), eliminado_por = $3
      WHERE ubicacion_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
    [id, tenantId, usuarioId],
  );
}
```

⚠️ `stock_ubicacion` todavía no existe cuando se escribe esta tarea. El unitario la mockea; el
**e2e de esta tarea no ejercita ese camino** y se agrega en la Tarea 2, que es la que crea la
tabla. Dejar el `SELECT` escrito ahora evita que el borrado nazca sin la defensa y que alguien
la agregue después "cuando se acuerde".

- [ ] **Step 5: Controller y módulo**

Calcar `motivos-diferencia-inventario.controller.ts` **entero**: `@UseGuards(JwtAuthGuard,
TenantGuard)` a nivel clase, y `@UseGuards(TenantAdminGuard)` en `POST`, `PATCH`, `DELETE` y
`restaurar`. El `GET` queda **sin** `TenantAdminGuard`: lectura abierta, escritura admin-only —
es el patrón de todos los catálogos de configuración.

Registrar `UbicacionesModule` en `app.module.ts` **y agregar `Ubicacion` al array `entities`**.
Sin lo segundo el arranque falla y no lo caza ni el unitario ni el typecheck.

- [ ] **Step 6: Correr el unitario — tiene que pasar**

Run: `cd backend && npm test -- ubicaciones.service.spec`
Expected: PASS, 3 tests

- [ ] **Step 7: Sembrar el local al crear el tenant**

En `backend/src/modules/tenants/tenants.service.ts`, dentro de `crear`, inmediatamente después
del bloque `// 6. Create caja virtual` (línea ~316):

```ts
// 6d. Ubicación local: el lugar del que sale toda venta. Se siembra acá —y
// no on-demand— por lo mismo que la caja virtual y el rol admin: el tenant
// nace completo. Un tenant sin local no puede vender.
await manager.query(
  `INSERT INTO ubicaciones (tenant_id, nombre, tipo, activo)
   VALUES ($1, 'Local', 'local', true)`,
  [savedTenant.id],
);
```

Y el mismo `INSERT` en `seeder.service.ts` para los tenants del seed. Para el tenant demo,
sembrar **además** una bodega llamada `Bodega Subsuelo` con id fijo del patrón
`550e8400-e29b-41d4-a716-446655440XXX` — el siguiente libre al 2026-09-06 es **`...440383`**;
reconfirmalo con:

```bash
grep -o "550e8400-e29b-41d4-a716-4466554[0-9]\{5\}" backend/src/modules/seeder/seeder.service.ts | sort -u | tail -3
```

- [ ] **Step 8: El e2e de API**

`backend/test/ubicaciones.e2e-spec.ts` — cubrir, con los helpers de `backend/test/`:

1. `GET /ubicaciones` de un tenant recién creado devuelve **exactamente una** fila, `tipo: 'local'`
2. `POST /ubicaciones` con `tipo: 'bodega'` la crea; con `tipo: 'local'` devuelve **400**
   (el local es uno y se siembra, no se crea)
3. `DELETE` sobre el local devuelve **400**
4. `DELETE` sobre una bodega vacía devuelve **204**, y `POST /ubicaciones/:id/restaurar` la trae
5. Un usuario no-admin recibe **403** en `POST`/`PATCH`/`DELETE` y **200** en `GET`
6. Aislamiento: un tenant no ve las ubicaciones del otro

Run: `./scripts/reset-db.sh && cd backend && npm run test:e2e -- ubicaciones`
Expected: PASS

- [ ] **Step 9: La pantalla**

`frontend/app/pages/configuracion/ubicaciones.vue`, calcada de
`frontend/app/pages/configuracion/causas-merma.vue` (misma tabla, mismo drawer de alta/edición,
mismo toggle de `activo`, mismo `incluirEliminados` y restaurar). Las dos diferencias:

- el **local** se dibuja arriba, separado, con un badge que lo identifica, sin botón de eliminar
- el mensaje de error del `DELETE` con stock se muestra tal cual viene del backend (ya nombra
  el lugar y cuántos productos quedan); no reescribirlo en el cliente

Con su `.nuxt.spec.ts` al lado, calcado de `causas-merma.nuxt.spec.ts`.

⚠️ El mock de `useApiFetch` contesta 200 a cualquier body: verificá que el body que el spec
afirma **pase el DTO real** del backend, o el test congela un caso imposible.

- [ ] **Step 10: Gate y commit**

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Revisión independiente (`verify-feature` paso 7) sobre el diff staged, y después:

```bash
git add backend/src/modules/ubicaciones backend/src/app.module.ts \
        backend/src/modules/tenants/tenants.service.ts \
        backend/src/modules/seeder/seeder.service.ts \
        backend/test/ubicaciones.e2e-spec.ts \
        frontend/app/pages/configuracion/ubicaciones.vue \
        frontend/app/pages/configuracion/ubicaciones.nuxt.spec.ts
git commit -m "feat(bodegas): ubicaciones, con el local sembrado por tenant"
```

---

## Tarea 2: EXPANDIR — `stock_ubicacion` nace y el chokepoint escribe en las dos

Al terminar: cada movimiento de stock escribe el saldo **en las dos tablas**, que quedan
siempre iguales. Nadie lee la nueva todavía. **Para el usuario no cambia nada.**

**Files:**
- Create: `backend/src/modules/items/entities/stock-ubicacion.entity.ts`
- Modify: `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts`
  (columna `ubicacion_id`)
- Modify: `backend/src/modules/inventario/inventario.service.ts` (`RegistrarMovimientoParams`,
  `registrarMovimiento`, el `INSERT INTO movimientos_inventario` de la línea 311,
  `moverCantidad`, `moverSerie`, `moverLote`)
- Modify: los **17 call sites** de `registrarMovimiento` (lista abajo)
- Modify: `backend/src/app.module.ts` (array `entities`), `seeder.service.ts`
- Test: `backend/src/modules/inventario/inventario.service.spec.ts` (existente, se agrega)
- Test: `backend/test/stock-ubicacion-paridad.e2e-spec.ts`

**Interfaces:**
- Consumes: `UbicacionesService.localDe(tenantId)` (Tarea 1)
- Produces:
  - `class StockUbicacion` (tabla `stock_ubicacion`), PK compuesta `(itemId, ubicacionId)`
  - `RegistrarMovimientoParams.ubicacionId: string` — **obligatorio**, sin default

### Los 17 call sites que hay que tocar

| Archivo | Líneas |
|---|---|
| `modules/mermas/mermas.service.ts` | 171 |
| `modules/ventas/ventas.service.ts` | 866, 1268, 1919, 2099 |
| `modules/inventario/inventario.service.ts` | 450 (interno, `registrarAjusteCosto`) |
| `modules/items/items.service.ts` | 1316, 1335, 1357, 1908, 2899, 3837, 3845, 4000, 4007, 4135 |
| `modules/recuentos/recuentos.service.ts` | 694 |

**En esta tarea los 17 pasan `ubicacionId: await this.ubicacionesService.localDe(tenantId)`.**
Las Tareas 10-12 cambian los que tienen que elegir lugar de verdad (merma, recuento, ajuste).

⛔ **`ubicacionId` es obligatorio y no opcional-con-default.** Un default silencioso mete stock
en el local cada vez que alguien se olvide de pasarlo, y el olvido no se ve: el número queda
bien en el tenant de un solo lugar y mal en todos los demás. Que el compilador liste los 17 es
el punto.

- [ ] **Step 1: Escribir el test que falla**

Agregar en `backend/src/modules/inventario/inventario.service.spec.ts`:

```ts
it('escribe el saldo en stock_ubicacion además de item_producto', async () => {
  // El fixture usa 7 y 3 —no 1 y 1— a propósito: con factores iguales, un
  // mutante que sume donde debe restar sobrevive.
  mockQuery(/FROM item_producto/, [
    { stock: '7', modo_inventario: 'cantidad', costo_actual: '100',
      item_nombre: 'Carne', item_eliminado_el: null },
  ]);

  await service.registrarMovimiento(manager, {
    tenantId: 't1', itemId: 'i1', ubicacionId: 'u-local',
    tipo: 'salida', motivo: 'venta', cantidad: '3', usuarioId: null,
  });

  const upserts = manager.query.mock.calls
    .map((c) => c[0] as string)
    .filter((sql) => /INSERT INTO stock_ubicacion/.test(sql));
  expect(upserts).toHaveLength(1);
  // El parámetro, no el SQL: un `toContain` sobre el texto matchea también el
  // comentario de la consulta.
  const params = manager.query.mock.calls.find(
    (c) => /INSERT INTO stock_ubicacion/.test(c[0] as string),
  )![1] as string[];
  expect(params).toEqual(expect.arrayContaining(['4', 'i1', 'u-local']));
});

it('rechaza un movimiento sin ubicacionId', async () => {
  await expect(
    service.registrarMovimiento(manager, {
      tenantId: 't1', itemId: 'i1', ubicacionId: '',
      tipo: 'salida', motivo: 'venta', cantidad: '1', usuarioId: null,
    }),
  ).rejects.toThrow(/ubicaci/i);
});
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd backend && npm test -- inventario.service.spec`
Expected: FAIL — el objeto no acepta `ubicacionId` (error de tipos) y no hay `INSERT INTO
stock_ubicacion`

- [ ] **Step 3: La entidad**

`backend/src/modules/items/entities/stock-ubicacion.entity.ts`:

```ts
import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * Saldo de un producto **en un lugar**. Reemplaza a `item_producto.stock`,
 * que era un escalar por ítem — una sola bolsa por tenant.
 *
 * Es la **única superficie de lectura** de stock: no importa el modo del
 * producto, todos preguntan acá. Quién la escribe sí depende del modo, y es
 * el mismo reparto que ya existía un nivel más arriba:
 *
 * - `cantidad` → esta tabla es el dueño del saldo
 * - `serie`    → el dueño es `item_unidad.ubicacion_id`; acá se recalcula contando
 * - `lote`     → el dueño es `lote_ubicacion`; acá se recalcula sumando
 *
 * Se escribe **solo** desde `inventario.service.ts` (`registrarMovimiento`),
 * y hay un test-invariante que falla si alguien más la toca:
 * `common/invariants/costo-stock-choke-point.invariant.spec.ts`.
 *
 * No lleva `tenant_id`: cuelga de `items` (vía `item_id`) y de `ubicaciones`,
 * que sí lo tienen. El acote por tenant vive en el JOIN al padre, igual que
 * en `item_producto` (ver `docs/patterns/backend.md`, "Tablas sin tenant_id").
 */
@Index('idx_stock_ubicacion_ubicacion', ['ubicacionId'])
@Entity('stock_ubicacion')
export class StockUbicacion {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @PrimaryColumn({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  stock: string;
}
```

El índice por `ubicacion_id` es el que sirve al "¿qué hay en esta bodega?" del recuento y del
borrado; la PK ya cubre el acceso por ítem.

- [ ] **Step 4: El chokepoint**

En `inventario.service.ts`:

1. Agregar a `RegistrarMovimientoParams`, arriba de `tipo`:

```ts
  /**
   * Dónde ocurre el movimiento. Obligatorio y sin default: un default
   * silencioso mete stock en el local cada vez que un llamador se olvide de
   * pasarlo, y el olvido es invisible en un tenant de una sola ubicación.
   */
  ubicacionId: string;
```

2. Al principio de `registrarMovimiento`, antes del `SELECT ... FOR UPDATE`:

```ts
if (!params.ubicacionId) {
  throw new BadRequestException('El movimiento necesita una ubicación');
}
```

3. La fila de kardex guarda **dónde** pasó. En
   `movimiento-inventario.entity.ts`:

```ts
  /**
   * Dónde ocurrió el movimiento. `stock_anterior` y `stock_resultante` pasan a
   * ser los saldos **de esta ubicación**, no del tenant — que es la razón por
   * la que un traslado son dos filas y no una con origen y destino: en una
   * sola no hay dónde escribir los dos saldos (spec § 4.3).
   */
  @Column({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;
```

   Y el `INSERT INTO movimientos_inventario` de la línea 311 la incluye. ⚠️ Es
   **obligatoria**: una fila de kardex sin lugar no se puede reconstruir después, y este es el
   momento en que cuesta cero.

4. En `moverCantidad`, `moverSerie` y `moverLote`, **al lado** de cada
   `UPDATE item_producto SET stock = ...` (líneas 534, 813, 831), agregar el upsert:

```ts
// EXPANDIR (Tarea 2 del plan de bodegas): se escriben las dos tablas
// mientras los lectores se mudan. `item_producto.stock` se borra en la
// Tarea 4 y este comentario se va con él.
await manager.query(
  `INSERT INTO stock_ubicacion (item_id, ubicacion_id, stock)
   VALUES ($1, $2, $3)
   ON CONFLICT (item_id, ubicacion_id) DO UPDATE SET stock = EXCLUDED.stock`,
  [params.itemId, params.ubicacionId, stockResultante.toString()],
);
```

⚠️ En `moverSerie`/`moverLote` el saldo que va acá es el **recalculado** (el `COUNT`/`SUM` de
las líneas 806-831), no una suma propia: si se calcula aparte se convierte en un segundo saldo
que puede derivar del primero.

- [ ] **Step 5: Los 17 call sites**

En cada service que llama al chokepoint, inyectar `UbicacionesService` en el constructor y
pasar el local. Ejemplo, `mermas.service.ts:171`:

```ts
const mov = await this.inventarioService.registrarMovimiento(manager, {
  tenantId,
  itemId: dto.itemId,
  ubicacionId: await this.ubicacionesService.localDe(tenantId),
  tipo: 'salida',
  // …el resto, sin cambios
});
```

⚠️ **`localDe` no va adentro de un bucle.** Donde el llamador registra N movimientos
(`ventas.service.ts:866`, `items.service.ts:3837/3845/4000/4007`), resolverlo **una vez antes
del loop** y pasar la variable. Una consulta por línea de venta es un N+1 en el camino más
caliente del sistema.

⚠️ **`ventas.service.ts` y `salones.service.ts` no cambian su orden de bloqueo en esta tarea**:
el `FOR UPDATE` sigue sobre `item_producto`. La mudanza del lock es la Tarea 4.

- [ ] **Step 6: Registrar la entidad y correr los unitarios**

`StockUbicacion` al array `entities` de `app.module.ts`. Después:

Run: `cd backend && npm test`
Expected: PASS. Si rompen decenas de unitarios de otros services, es el constructor: agregar el
mock de `UbicacionesService` a sus `beforeEach`. Tocar un constructor ya rompió 96 unitarios
una vez.

- [ ] **Step 7: El e2e de paridad**

`backend/test/stock-ubicacion-paridad.e2e-spec.ts`. Es la red que prueba que la doble escritura
no derivó, y **se borra en la Tarea 4** cuando la tabla vieja deja de existir:

1. Comprar 20 de un producto → `item_producto.stock` y `stock_ubicacion` del local coinciden
2. Vender 3 → siguen coincidiendo
3. Mermar 2 → siguen coincidiendo
4. Aplicar un recuento con diferencia → siguen coincidiendo
5. Un producto `modo_inventario='serie'`: entrada de 2 series y salida de 1 → coinciden
6. Un producto `modo_inventario='lote'`: entrada y salida → coinciden

Run: `./scripts/reset-db.sh && cd backend && npm run test:e2e`
Expected: PASS. Después: `./scripts/reset-db.sh --verificar`

- [ ] **Step 8: Gate, revisión y commit**

Gate completo (los seis comandos), revisión independiente sobre el diff staged, y:

```bash
git commit -m "feat(bodegas): stock_ubicacion y el chokepoint con ubicación obligatoria"
```

---

## Tarea 3a: GIRAR (1/2) — `items.service.ts` lee de la tabla nueva

Al terminar: `GET /items` y `GET /items/:id` devuelven `stock` (total), `stockVendible` (local)
y `stockDisponible` (local − comprometido), calculados desde `stock_ubicacion`. La doble
escritura sigue. **Para el usuario de un solo local, los tres números son iguales y nada
cambia.**

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` — líneas 317, 348, 608, 735, 774,
  1007-1093, 3642, 4622-4630, 4745, 4841, 4869
- Modify: `backend/src/modules/items/items.controller.ts` (tipos de respuesta)
- Test: `backend/src/modules/items/items.service.spec.ts`
- Test: `backend/test/items-stock-por-ubicacion.e2e-spec.ts`

**Interfaces:**
- Consumes: `StockUbicacion`, `UbicacionesService.localDe` (Tareas 1-2)
- Produces: los tres campos de la § 5.4 de la spec en `GET /items` y `GET /items/:id`, más
  `desglosePorUbicacion: { ubicacionId, nombre, stock }[]` en `GET /items/:id`

- [ ] **Step 1: El test que falla**

```ts
it('stock es el total, stockVendible es el del local', async () => {
  // 20 en la bodega y 10 en el local: números distintos a propósito, para
  // que un mutante que devuelva el total donde va el vendible no sobreviva.
  mockStockUbicacion([
    { item_id: 'i1', ubicacion_id: 'u-local', stock: '10' },
    { item_id: 'i1', ubicacion_id: 'u-bodega', stock: '20' },
  ]);
  mockComprometido(new Map([['i1', new Decimal('4')]]));

  const [item] = await service.findAll('t1', {});

  expect(item.stock).toBe('30.0000');
  expect(item.stockVendible).toBe('10.0000');
  expect(item.stockDisponible).toBe('6.0000');
});
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `cd backend && npm test -- items.service.spec`
Expected: FAIL — `stockVendible` no existe y `stock` devuelve `'10'`

- [ ] **Step 3: Reemplazar las lecturas**

Cada `JOIN item_producto ip` que traía `ip.stock` pasa a traer **dos** agregados. La forma, en
una sola consulta por request y **nunca una por fila**:

```sql
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(su.stock), 0)                                    AS total,
         COALESCE(SUM(su.stock) FILTER (WHERE su.ubicacion_id = $L), 0) AS vendible
    FROM stock_ubicacion su
   WHERE su.item_id = ip.item_id
) s ON TRUE
```

donde `$L` es el `ubicacion_id` del local, resuelto **una vez por request** con `localDe`.

`disponibleDe(...)` (`items.service.ts:117`) pasa a restar el comprometido de **`vendible`**, no
de `total`. Es el cambio de una línea del que depende que el salón siga diciendo la verdad:

```ts
function disponibleDe(
  comprometido: Map<string, Decimal>,
  itemId: string,
  vendible: string,   // ← antes era `stock`
): string {
  return new Decimal(vendible).minus(comprometido.get(itemId) ?? 0).toFixed(4);
}
```

- [ ] **Step 4: `validarStockAlPedir` mira el local**

En `items.service.ts:4622`, el `SELECT … FOR UPDATE OF ip` pasa a `stock_ubicacion`
**acotado al local**, conservando el `ORDER BY` que es el contrato de bloqueo:

```sql
SELECT su.item_id, su.stock, ip.unidad_medida
  FROM stock_ubicacion su
  JOIN item_producto ip ON ip.item_id = su.item_id
  JOIN items i          ON i.item_id  = su.item_id
 WHERE su.item_id = ANY($1::uuid[])
   AND su.ubicacion_id = $3
   AND i.tenant_id = $2
   AND i.eliminado_el IS NULL
 ORDER BY su.item_id, su.ubicacion_id
 FOR UPDATE OF su
```

⛔ **El `ORDER BY` es el contrato de bloqueo, no cosmética.** Cambió de `ip.item_id` a
`(su.item_id, su.ubicacion_id)` porque la clave del saldo cambió. El `FOR UPDATE OF su` y no
`FOR UPDATE` a secas: sin el `OF`, Postgres lockea también `items` e `item_producto`, huella de
locks nueva en el camino más caliente. Ver spec § 5.2.

- [ ] **Step 5: El desglose en `GET /items/:id`**

Una consulta por request, no una por ubicación:

```sql
SELECT su.ubicacion_id, u.nombre, su.stock
  FROM stock_ubicacion su
  JOIN ubicaciones u ON u.ubicacion_id = su.ubicacion_id
 WHERE su.item_id = $1 AND u.eliminado_el IS NULL
 ORDER BY (u.tipo = 'local') DESC, u.nombre
```

El local primero, después las bodegas por nombre.

- [ ] **Step 6: Correr unitarios y e2e**

Run: `cd backend && npm test -- items.service.spec`
Expected: PASS

`backend/test/items-stock-por-ubicacion.e2e-spec.ts`: crear una bodega, mover stock **por SQL
directo a `stock_ubicacion`** (todavía no hay endpoint de traslado), y verificar los tres
números en `GET /items` y el desglose en `GET /items/:id`.

⚠️ Ese SQL directo es una muleta de esta tarea. En la Tarea 9, cuando exista `POST /traslados`,
**este e2e se reescribe para montar el escenario por la API**: un escenario que solo se puede
armar con SQL suele ser un escenario imposible, y ahí el test congela un caso que no existe.

- [ ] **Step 7: Gate, revisión y commit**

```bash
git commit -m "feat(bodegas): items lee el stock por ubicación (total, vendible, disponible)"
```

---

## Tarea 3b: GIRAR (2/2) — el resto de los lectores

Al terminar: ningún `SELECT` del backend lee `item_producto.stock`. La doble escritura sigue.
**Para el usuario no cambia nada.**

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts:1241, 2361, 2893`
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts:293, 367, 874`
- Modify: `backend/src/modules/recuentos/recuentos.service.ts:174`
- Modify: `backend/src/modules/mermas/mermas.service.ts:112, 261`
- Modify: `backend/src/modules/catalog/catalog.service.ts`
- Test: los `.spec.ts` de cada uno + `backend/test/` existentes

- [ ] **Step 1: Encontrar lo que queda**

```bash
cd backend && grep -rn "ip\.stock\|p\.stock\|item_producto ip\|item_producto p" src --include="*.ts" | grep -v "\.spec\.ts"
```

Cada resultado es un lector que hay que decidir. **La pregunta por cada uno es la misma:
¿este número decide una venta, o informa?**

| Decide una venta | Informa |
|---|---|
| va contra el **local** (`ubicacion_id = $local`) | va contra el **total** (`SUM`) |
| `ventas.service.ts` (el tope al cobrar), `grupos-modificadores` (opciones sin stock), el drawer | `catalog.service.ts`, los listados de administración |

⛔ **No hay un default correcto.** Un lector que "informa" pero en realidad frena una venta
promete mercadería que está en el subsuelo. Si al mirar uno no está claro de qué lado cae,
**parar y preguntar** en vez de elegir.

- [ ] **Step 2: Test por lector antes de tocarlo**

Por cada archivo, un caso con **stock repartido**: 10 en el local y 20 en la bodega, afirmando
qué número devuelve. Un fixture con todo en el local **no discrimina** y deja el mutante vivo.

- [ ] **Step 3: Migrar y verificar**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 4: El e2e completo, entero**

Run: `./scripts/reset-db.sh && cd backend && npm run test:e2e`
Expected: PASS. Después `./scripts/reset-db.sh --verificar`.

⚠️ Correr **la suite entera**, no el subset de los archivos tocados: acá es donde aparece el
lector que nadie listó.

- [ ] **Step 5: Gate, revisión y commit**

```bash
git commit -m "feat(bodegas): los lectores restantes de stock miran la ubicación que les toca"
```

---

## Tarea 4: CONTRAER — `item_producto.stock` se borra y el lock se muda

Al terminar: existe **un solo dueño del saldo**. El test-invariante custodia la tabla nueva.
**Para el usuario no cambia nada.**

**Files:**
- Modify: `backend/src/modules/items/entities/item-producto.entity.ts` (borrar `stock`)
- Modify: `backend/src/modules/inventario/inventario.service.ts` (sacar los 3 `UPDATE
  item_producto SET stock`, mudar el `FOR UPDATE`)
- Modify: `backend/src/modules/salones/salones.service.ts` (comentarios del contrato de locks)
- Modify: `backend/src/common/invariants/costo-stock-choke-point.invariant.spec.ts`
- Modify: `backend/src/modules/seeder/seeder.service.ts` (los 5 `INSERT`/`UPDATE` de stock)
- Modify: `startup-pos.sql`, `docs/patterns/backend.md` §15
- Delete: `backend/test/stock-ubicacion-paridad.e2e-spec.ts` (ya no hay dos tablas que comparar)

- [ ] **Step 1: Ampliar el invariante primero**

En `costo-stock-choke-point.invariant.spec.ts`, agregar un tercer `it` que barra las **tres**
puertas nuevas:

```ts
it('nadie escribe stock_ubicacion, lote_ubicacion ni item_unidad.ubicacion_id fuera de inventario.service', () => {
  const srcRoot = join(__dirname, '..', '..');
  const offenders: string[] = [];

  for (const file of findTsFiles(srcRoot)) {
    if (ARCHIVOS_AUTORIZADOS.some((a) => file.endsWith(a))) continue;
    const contenido = readFileSync(file, 'utf8');
    const sospechoso = extraeTemplateLiterals(contenido).some(
      (chunk) =>
        /INSERT\s+INTO\s+stock_ubicacion/i.test(chunk) ||
        /UPDATE\s+stock_ubicacion/i.test(chunk) ||
        /INSERT\s+INTO\s+lote_ubicacion/i.test(chunk) ||
        /UPDATE\s+lote_ubicacion/i.test(chunk) ||
        /UPDATE\s+item_unidad[\s\S]*ubicacion_id\s*=\s*\$/i.test(chunk),
    );
    if (sospechoso) offenders.push(file);
  }

  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Verificar que el invariante nuevo PASA hoy y que puede fallar**

Run: `cd backend && npm test -- costo-stock-choke-point`
Expected: PASS

Ahora el mutante: pegar un `UPDATE stock_ubicacion SET stock = $1` en un service cualquiera
(por ejemplo `mermas.service.ts`) y volver a correr.
Expected: **FAIL**, nombrando ese archivo. Revertir el mutante.

⚠️ Tras revertir, **verificar en los logs de docker que el backend reinició**: el watcher
recompila y re-siembra, y el fuente limpio no prueba que el proceso lo esté.

- [ ] **Step 3: Borrar la columna y la doble escritura**

- Sacar `stock` de `item-producto.entity.ts`. Con `synchronize: true` la columna se cae sola en
  el próximo arranque; **no se escribe migración**.
- Sacar los tres `UPDATE item_producto SET stock = $1` de `inventario.service.ts` (534, 813,
  831) y el comentario "EXPANDIR" que puso la Tarea 2.
- En el seeder, los `INSERT INTO item_producto (…, stock, …)` pasan a insertar la fila sin
  stock y a sembrar `stock_ubicacion` — **repartido entre el local y `Bodega Subsuelo`** para
  el tenant demo (ver Step 5).

- [ ] **Step 4: Mudar el `FOR UPDATE` del chokepoint**

En `registrarMovimiento` (línea ~153), el `SELECT … FOR UPDATE OF ip` pasa a lockear el saldo:

```sql
SELECT su.stock, ip.modo_inventario, ip.costo_actual,
       i.nombre AS item_nombre, i.eliminado_el AS item_eliminado_el
  FROM stock_ubicacion su
  JOIN item_producto ip ON ip.item_id = su.item_id
  JOIN items i          ON i.item_id  = su.item_id
 WHERE su.item_id = $1 AND su.ubicacion_id = $3 AND i.tenant_id = $2
 ORDER BY su.item_id, su.ubicacion_id
 FOR UPDATE OF su
```

⛔ Tres cosas que **no** cambian y hay que conservar tal cual: el `OF su` (sin el `OF`,
Postgres lockea `items` e `item_producto` y aparece huella de locks nueva en el camino
caliente); la **ausencia** del filtro `i.eliminado_el IS NULL`, que es deliberada y está
explicada en el comentario que ya vive ahí — filtrarlo haría que anular una venta de un ítem
borrado después dejara de reponer; y el mensaje genérico cuando no hay filas, que protege el
acote por tenant.

⚠️ Si el producto no tiene fila en esa ubicación todavía, el `SELECT` no devuelve nada y hoy
eso significa "el item no tiene control de stock". Hay que distinguir los dos casos: **sin fila
en `stock_ubicacion` pero con fila en `item_producto`** es saldo cero, no error — se inserta la
fila en 0 y se sigue (spec § 8, "Producto que nunca estuvo en el destino").

Actualizar los comentarios de `ventas.service.ts:833` y `salones.service.ts:759-880`, que
nombran `item_producto` como el objeto del lock, y `docs/patterns/backend.md` §15.

- [ ] **Step 5: El seed reparte el stock**

En `seeder.service.ts`, el tenant demo queda con stock **en las dos ubicaciones**, no todo en el
local.

⛔ **No es cosmética del seed: es parte de la medición.** Un `EXPLAIN` mide el plan que tu
distribución de datos permite. Con el 100% de las filas en el local, un índice por
`ubicacion_id` "no sirve" — y esa conclusión sería falsa. Ya pasó una vez con un índice parcial.

- [ ] **Step 6: Reset, e2e entero, y borrar el e2e de paridad**

```bash
./scripts/reset-db.sh
cd backend && npm run test:e2e
./scripts/reset-db.sh --verificar
```

Expected: PASS. Acá es donde aparece cualquier `SELECT ip.stock` que haya sobrevivido a la
Tarea 3: el SQL vive en template literals y **el typechecker no lo mira**, así que revienta al
correr la consulta, no al compilar.

Borrar `backend/test/stock-ubicacion-paridad.e2e-spec.ts`: comparaba dos tablas y ahora hay una.

- [ ] **Step 7: Gate, revisión y commit**

```bash
git commit -m "feat(bodegas): item_producto.stock se borra; el saldo tiene un solo dueño"
```

---

## Tarea 5: La tercera copia — extraer el reintento de deadlock

El código dejó esta tarea escrita de antemano. `ventas.service.ts:60-79` dice, sobre
`MAX_REINTENTOS_DEADLOCK` y `esDeadlock`, duplicados con `salones.service.ts`:

> *"Está duplicado a propósito: extraerlo obligaba a tocar este camino, el de la venta. Al tocar
> uno, tocar el otro; **el que necesite una tercera copia, extrae las tres**."*

La Tarea 9 es la tercera copia. **Esto no es refactor fuera de alcance: es una condición
explícita**, y va antes para que el traslado nazca usando el helper y no una cuarta copia.

**Files:**
- Create: `backend/src/common/db/reintento-deadlock.ts`
- Create: `backend/src/common/db/reintento-deadlock.spec.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts:60-90`
- Modify: `backend/src/modules/salones/salones.service.ts` (la copia gemela)

**Interfaces:**
- Produces: `MAX_REINTENTOS_DEADLOCK: number`, `esDeadlock(e: unknown): boolean`

- [ ] **Step 1: Copiar los dos comentarios existentes al archivo nuevo, no reescribirlos**

Los docblocks de `ventas.service.ts:60-79` explican **por qué dos reintentos y no más** y
**por qué se miran `code` y `driverError`**. Ese razonamiento se mueve entero al archivo nuevo.
Reescribirlo de memoria pierde el porqué, que es lo único que el código no dice solo.

Reemplazar la nota del "extrae las tres" por una que diga quiénes son los consumidores hoy
(ventas, salones, traslados).

- [ ] **Step 2: El test**

`reintento-deadlock.spec.ts`: `esDeadlock` reconoce el `40P01` en **las dos formas** — `code` en
la raíz y `code` dentro de `driverError` —, y devuelve `false` para cualquier otro código. Las
dos formas importan: cuál llega depende de dónde se lance, y confundirse ahí significa no
reintentar nunca.

- [ ] **Step 3: Reemplazar las dos copias por el import y correr todo**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS. Sin cambios de conducta: es una extracción.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(db): el reintento de deadlock vive en un solo lugar"
```

---

## Tarea 6: Modo `serie` — cada IMEI sabe dónde está

**Files:**
- Modify: `backend/src/modules/items/entities/item-unidad.entity.ts` (columna `ubicacion_id`)
- Modify: `backend/src/modules/inventario/inventario.service.ts` (`moverSerie`, líneas 556-650,
  y el recálculo de la 806)
- Modify: `backend/src/modules/items/items.service.ts` (el listado de unidades)
- Test: `backend/src/modules/inventario/inventario.service.spec.ts`
- Test: `backend/test/inventario-serie-ubicacion.e2e-spec.ts`

**Interfaces:**
- Consumes: `StockUbicacion`, `RegistrarMovimientoParams.ubicacionId`
- Produces: `ItemUnidad.ubicacionId: string` — dónde está esa unidad física

- [ ] **Step 1: El test que falla**

```ts
it('la unidad nace en la ubicación del movimiento', async () => { /* entrada serie con
   ubicacionId 'u-bodega' → el INSERT de item_unidad lleva 'u-bodega' */ });

it('una salida serie solo consume unidades de esa ubicación', async () => { /* dos unidades,
   una en el local y otra en la bodega; salida en el local con el unidadId de la bodega → 400 */ });

it('stock_ubicacion se recalcula contando solo las unidades de esa ubicación', async () => {
  /* 3 unidades en el local y 2 en la bodega → stock_ubicacion del local = 3, no 5 */ });
```

⚠️ Los fixtures usan **3 y 2**, no 1 y 1: con cantidades iguales, un mutante que cuente todas
las unidades del ítem en vez de las de la ubicación **sobrevive**.

- [ ] **Step 2: Correr y ver fallar**

Run: `cd backend && npm test -- inventario.service.spec`

- [ ] **Step 3: La columna**

En `item-unidad.entity.ts`:

```ts
/** Dónde está físicamente esta unidad. Una unidad está en un solo lugar. */
@Column({ name: 'ubicacion_id', type: 'uuid' })
ubicacionId: string;
```

- [ ] **Step 4: `moverSerie`**

- **Entrada**: el `INSERT INTO item_unidad` (línea ~562) lleva `params.ubicacionId`.
- **Salida**: el `SELECT estado, item_id, tenant_id FROM item_unidad` (línea ~616) suma
  `AND ubicacion_id = $N`, y el 400 dice **dónde está** la unidad, no solo que no se puede:
  *"La unidad IMEI-123 está en Bodega Subsuelo, no en el local"*.
- **Recálculo** (línea ~806): el `COUNT(*)` suma `AND ubicacion_id = $N`, y el resultado va al
  upsert de `stock_ubicacion` **de esa ubicación**.

⚠️ Una unidad `vendido` o `baja` no cambia de lugar y no entra en el conteo — el filtro por
`estado` que ya existe se conserva tal cual.

- [ ] **Step 5: Correr unitarios y e2e**

```bash
cd backend && npm test -- inventario.service.spec
./scripts/reset-db.sh && npm run test:e2e -- serie
```

- [ ] **Step 6: Gate, revisión y commit**

```bash
git commit -m "feat(bodegas): cada unidad serializada sabe en qué ubicación está"
```

---

## Tarea 7: Modo `lote` — un lote puede estar partido entre dos lugares

**Files:**
- Create: `backend/src/modules/items/entities/lote-ubicacion.entity.ts`
- Modify: `backend/src/modules/items/entities/item-lote.entity.ts` (borrar `cantidadDisponible`)
- Modify: `backend/src/modules/inventario/inventario.service.ts` (`moverLote`, líneas 660-790, y
  el recálculo de la 825)
- Modify: `backend/src/modules/items/items.service.ts:2966` (el listado de lotes)
- Modify: `backend/src/app.module.ts` (array `entities`)
- Test: `backend/src/modules/inventario/inventario.service.spec.ts`
- Test: `backend/test/inventario-lote-ubicacion.e2e-spec.ts`

**Interfaces:**
- Produces: `class LoteUbicacion`, PK `(loteId, ubicacionId)`, columna `cantidad`

- [ ] **Step 1: El test que falla**

```ts
it('el mismo lote puede tener saldo en dos ubicaciones', async () => {
  /* lote L1: 8 en el local, 5 en la bodega. stock_ubicacion del local = 8, de la bodega = 5 */
});

it('una salida de lote no puede sacar de una ubicación más de lo que ese lote tiene ahí', async () => {
  /* L1 con 5 en la bodega; salida de 8 en la bodega → 400 nombrando el lote */
});

it('el vencimiento del lote es uno solo, no cambia por ubicación', async () => {
  /* fecha_vencimiento vive en item_lote y no se duplica */
});
```

- [ ] **Step 2: Correr y ver fallar**

- [ ] **Step 3: La entidad**

```ts
import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * Saldo de un lote **en un lugar**. Existe porque un mismo lote puede estar
 * partido: 8 kg de la partida en la cocina y 5 en el subsuelo.
 *
 * Reemplaza a `item_lote.cantidad_disponible`, que era un escalar por lote.
 * Lo que **no** se parte es la identidad del lote —código, elaboración y
 * vencimiento— que sigue viviendo una sola vez en `item_lote`.
 *
 * Es el dueño del saldo en modo `lote`; `stock_ubicacion` se recalcula
 * sumando esta tabla, y se escribe solo desde `inventario.service.ts`.
 */
@Index('idx_lote_ubicacion_ubicacion', ['ubicacionId'])
@Entity('lote_ubicacion')
export class LoteUbicacion {
  @PrimaryColumn({ name: 'lote_id', type: 'uuid' })
  loteId: string;

  @PrimaryColumn({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  cantidad: string;
}
```

- [ ] **Step 4: `moverLote` y el listado**

- Las cuatro lecturas de `cantidad_disponible` (líneas 666, 717, 762, 824) pasan a
  `lote_ubicacion.cantidad` **acotadas por ubicación**.
- El FIFO de la salida (línea ~717, `WHERE cantidad_disponible > 0` con su `ORDER BY`) recorre
  solo los lotes **con saldo en esa ubicación**. Conservar el criterio de orden que ya tiene:
  el vencimiento manda, y eso no cambia por ubicación.
- `items.service.ts:2966` (el listado de lotes de un producto) devuelve `cantidadDisponible`
  como **suma** de `lote_ubicacion`, más el desglose por lugar.
- Borrar `cantidadDisponible` de `item-lote.entity.ts`; `cantidadInicial` **se queda**.
- `LoteUbicacion` al array `entities` de `app.module.ts`.

- [ ] **Step 5: Correr todo**

```bash
cd backend && npm test
./scripts/reset-db.sh && npm run test:e2e && ./scripts/reset-db.sh --verificar
```

- [ ] **Step 6: Gate, revisión y commit**

```bash
git commit -m "feat(bodegas): un lote puede estar repartido entre ubicaciones"
```

---

## Tarea 8: El catálogo de motivos de traslado

**Files:**
- Create: `backend/src/modules/motivos-traslado/**` — calcar **entero** el directorio
  `backend/src/modules/motivos-diferencia-inventario/` (entity, service, controller, module,
  dto/, defaults, spec)
- Modify: `backend/src/app.module.ts` (módulo **y** `entities`)
- Modify: `backend/src/modules/tenants/tenants.service.ts` (siembra, junto al bloque `7c`)
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Create: `frontend/app/pages/configuracion/motivos-traslado.vue` + `.nuxt.spec.ts`
- Test: `backend/test/motivos-traslado.e2e-spec.ts`

**Interfaces:**
- Produces: `class MotivoTraslado` (tabla `motivo_traslado`), `MOTIVOS_TRASLADO_FIJOS`,
  `GET|POST|PATCH|DELETE /motivos-traslado`

- [ ] **Step 1: Los motivos fijos**

`backend/src/modules/motivos-traslado/motivos-traslado.defaults.ts`:

```ts
/**
 * El motivo nace **tipado** y no como texto libre porque el SII distingue
 * tipos de traslado, y nacer con esa forma evita migrar después. Estos son
 * los que aplican a un traslado entre ubicaciones propias.
 *
 * ⛔ Esta lista NO emite nada. El documento chileno del traslado es el DTE 52
 * y **viaja con la mercadería**; nuestro registro interno no lo reemplaza —
 * el tenant lo emite por fuera, igual que hoy hace con las boletas. Tener el
 * traslado registrado no es lo mismo que estar en regla (ADR-010).
 */
export const MOTIVOS_TRASLADO_FIJOS = [
  'Traslado interno',
  'Ventas por efectuar',
  'Consignación',
  'Entrega gratuita',
  'Devolución a proveedor',
] as const;
```

⚠️ **No colgar esto de `tipos_documento` ni de una constante que apunte a la fila chilena.**
Ese error ya se cometió una vez con la nota de crédito y se arregló el 2026-09-03: lo que marca
"este es el documento X" se resuelve **por país**. Acá el problema se esquiva porque el traslado
**no emite ningún documento tributario**: es un catálogo propio y nada más. El día que entre la
emisión, ese mapeo se resuelve por país en su propio frente.

- [ ] **Step 2: Calcar el módulo, el e2e y la pantalla**

El service, el controller (admin-only en escritura, `GET` abierto), los DTOs, el `restaurar` y
la colisión de nombre salen del molde sin cambios de forma. La pantalla se calca de
`frontend/app/pages/configuracion/causas-merma.vue`.

- [ ] **Step 3: Gate, revisión y commit**

```bash
git commit -m "feat(bodegas): catálogo de motivos de traslado"
```

---

## Tarea 9: El traslado — dos filas de kardex y un documento

La tarea central. Al terminar, `POST /traslados` mueve mercadería entre ubicaciones en **un solo
acto atómico**, dejando dos filas de kardex y un documento interno.

**Files:**
- Create: `backend/src/modules/traslados/entities/traslado.entity.ts`
- Create: `backend/src/modules/traslados/traslados.service.ts`
- Create: `backend/src/modules/traslados/traslados.controller.ts`
- Create: `backend/src/modules/traslados/traslados.module.ts`
- Create: `backend/src/modules/traslados/dto/create-traslado.dto.ts`
- Create: `backend/src/modules/traslados/traslados.service.spec.ts`
- Create: `backend/test/traslados.e2e-spec.ts`
- Modify: `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts`
  (columna `traslado_id`, nullable)
- Modify: `backend/src/modules/inventario/inventario.service.ts` (`RegistrarMovimientoParams`
  gana `trasladoId?: string | null`; el `INSERT` de la línea 311 lo persiste; motivo
  `'traslado'` en la lista de motivos válidos y en `MOTIVOS_SOBRE_ITEM_ELIMINADO`)
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `UbicacionesService.localDe`, `registrarMovimiento`, `MotivoTraslado`,
  `MAX_REINTENTOS_DEADLOCK` / `esDeadlock` (Tarea 5)
- Produces:
  - `class Traslado` — `id`, `tenantId`, `ubicacionOrigenId`, `ubicacionDestinoId`,
    `motivoTrasladoId`, `comentario`, `usuarioId`
  - `TrasladosService.crear(tenantId, usuarioId, dto): Promise<TrasladoDetalle>`
  - `POST /traslados`, `GET /traslados`, `GET /traslados/:id`

### El DTO

```ts
export class LineaTrasladoDto {
  @IsUUID() itemId: string;

  // Cantidad como string y validada como número decimal: `Decimal.js`, nunca
  // `number` nativo.
  @IsNumberString() cantidad: string;

  // Modo `serie`: qué unidades concretas se mueven. Modo `lote`: de qué lote.
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) unidadIds?: string[];
  @IsOptional() @IsUUID() loteId?: string;
}

export class CreateTrasladoDto {
  @IsUUID() origenId: string;
  @IsUUID() destinoId: string;
  @IsUUID() motivoTrasladoId: string;
  @IsOptional() @IsString() @MaxLength(500) comentario?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => LineaTrasladoDto)
  lineas: LineaTrasladoDto[];
}
```

⚠️ **`tenantId` no está en el DTO y no puede estarlo**: sale del token.

- [ ] **Step 1: Los tests que fallan — el corazón de la tarea**

`traslados.service.spec.ts`:

```ts
it('genera DOS movimientos de kardex, uno por ubicación, con el mismo traslado_id', async () => {
  // 5 kg de la bodega al local
  await service.crear('t1', 'usr', { origenId: 'u-bod', destinoId: 'u-loc', /* … */ });

  const movs = inventarioService.registrarMovimiento.mock.calls.map((c) => c[1]);
  expect(movs).toHaveLength(2);
  expect(movs[0]).toMatchObject({ tipo: 'salida',  ubicacionId: 'u-bod', motivo: 'traslado' });
  expect(movs[1]).toMatchObject({ tipo: 'entrada', ubicacionId: 'u-loc', motivo: 'traslado' });
  expect(movs[0].trasladoId).toBe(movs[1].trasladoId);
});

it('rechaza origen igual a destino', async () => {
  await expect(
    service.crear('t1', 'usr', { origenId: 'u-loc', destinoId: 'u-loc', /* … */ }),
  ).rejects.toThrow(BadRequestException);
});

it('sacar del LOCAL topea contra lo apartado, no contra lo físico', async () => {
  // 400 g físicos en el local, 400 g apartados por una cuenta abierta.
  mockStockLocal('0.4000');
  mockComprometido(new Map([['i1', new Decimal('0.4')]]));
  await expect(
    service.crear('t1', 'usr', { origenId: 'u-loc', destinoId: 'u-bod',
      lineas: [{ itemId: 'i1', cantidad: '0.4' }], /* … */ }),
  ).rejects.toThrow(/apartad|pedid/i);
});

it('sacar de una BODEGA topea solo contra lo físico', async () => {
  // Mismo escenario, al revés: en una bodega no hay nada apartado porque de
  // ahí no se vende. 400 g en la bodega, 400 g apartados en el local → pasa.
  mockStockBodega('0.4000');
  mockComprometido(new Map([['i1', new Decimal('0.4')]]));
  await expect(
    service.crear('t1', 'usr', { origenId: 'u-bod', destinoId: 'u-loc',
      lineas: [{ itemId: 'i1', cantidad: '0.4' }], /* … */ }),
  ).resolves.toBeDefined();
});

it('no traslada a una ubicación desactivada, pero sí desde una', async () => {
  // Asimetría deliberada: si una bodega desactivada no pudiera ser origen,
  // su mercadería quedaría encerrada sin forma de sacarla.
});

it('lockea las filas ordenadas por (itemId, ubicacionId), NO origen→destino', async () => {
  // Dos ítems, traslado del local a la bodega. El orden de los locks pedidos
  // tiene que ser el orden de la clave, con los dos ítems intercalados por
  // ubicación — no "primero todo el origen, después todo el destino".
});
```

⛔ **El último test es el que importa más y el que más fácil se escribe mal.** Ver Step 3.

- [ ] **Step 2: Correr y ver fallar**

Run: `cd backend && npm test -- traslados.service.spec`
Expected: FAIL — no existe el módulo

- [ ] **Step 3: El servicio — el orden de locks**

```ts
/**
 * Un traslado es la **única** operación que toca dos filas de saldo del mismo
 * ítem a la vez, y por eso introduce una forma de deadlock que no existía:
 * dos traslados cruzados del mismo producto —uno bodega→local y otro
 * local→bodega, en el mismo instante— se bloquean en cruz si cada uno lockea
 * primero su propio origen.
 *
 * Por eso NO se lockea en orden origen→destino. Se arma la lista completa de
 * pares (itemId, ubicacionId) que el traslado va a tocar, se ORDENA por esa
 * clave, y se lockea en ese orden — la misma regla que cerró la familia de
 * deadlocks de la auditoría del 2026-08-15, extendida a la clave nueva.
 *
 * `docs/patterns/backend.md` §15.
 */
const pares = dto.lineas.flatMap((l) => [
  { itemId: l.itemId, ubicacionId: dto.origenId },
  { itemId: l.itemId, ubicacionId: dto.destinoId },
]);
pares.sort(
  (a, b) =>
    a.itemId.localeCompare(b.itemId) ||
    a.ubicacionId.localeCompare(b.ubicacionId),
);
```

El resto del método, en orden:

1. Validar `origenId !== destinoId`, que las dos existan, sean del tenant y no estén eliminadas,
   y que **el destino esté activo** (el origen puede estar desactivado).
2. Validar el motivo contra `motivo_traslado` (del tenant, activo, no eliminado).
3. Abrir la transacción con `db.transaccion` y el reintento de la Tarea 5.
4. Tomar los locks en el orden de arriba.
5. **El tope**: si el origen es el local, `disponible = stock − comprometido`
   (`itemsService.comprometidoPorItem`); si es una bodega, `disponible = stock`. El 400 nombra
   el producto, la cantidad que falta y **el lugar**.
6. Insertar la fila de `traslados`.
7. Por cada línea, **dos** `registrarMovimiento` con el mismo `trasladoId`: `salida` en el
   origen y `entrada` en el destino.

⚠️ **La entrada en el destino no recalcula el CPP.** El costo es uno solo por producto para todo
el tenant (spec § 3.2): un traslado mueve kilos, no plata. Pasar `costoUnitario` en la entrada
volvería a promediar el costo contra sí mismo e inflaría la valorización en cada traslado.
`registrarMovimiento` ya congela el `costo_actual` vigente cuando no se le pasa costo — que es
exactamente lo que queremos.

- [ ] **Step 4: El motivo `'traslado'` y el vínculo con el documento**

`MovimientoInventario` gana la columna que ata las dos filas a su documento:

```ts
  /**
   * El documento interno que generó este movimiento. Nulo salvo en los dos
   * movimientos de un traslado, que comparten el mismo valor: es lo que
   * permite reconstruir "estos 5 kg salieron de acá y entraron allá" a
   * partir del kardex.
   */
  @Column({ name: 'traslado_id', type: 'uuid', nullable: true })
  trasladoId: string | null;
```

`RegistrarMovimientoParams` gana `trasladoId?: string | null` y el `INSERT` de la línea 311 lo
persiste. Agregar `'traslado'` al comentario de motivos de la entidad y **a
`MOTIVOS_SOBRE_ITEM_ELIMINADO`**. Sin lo segundo, una bodega llena de producto discontinuado no
se puede vaciar nunca (spec § 8, última fila).

- [ ] **Step 5: Controller**

`@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)` a nivel clase;
`@RequiresPermiso('Inventario', 'Crear')` en `POST` y `@RequiresPermiso('Inventario', 'Leer')`
en los `GET`. Registrar módulo y `Traslado` en `app.module.ts`.

- [ ] **Step 6: Correr unitarios**

Run: `cd backend && npm test -- traslados.service.spec`
Expected: PASS

- [ ] **Step 7: El e2e, con el caso concurrente**

`backend/test/traslados.e2e-spec.ts`:

1. Traslado feliz bodega→local: los dos saldos se mueven, hay 2 movimientos con el mismo
   `traslado_id`, y `GET /items` refleja el cambio en `stockVendible` pero **no en `stock`**
   (el total no cambió: la mercadería no entró ni salió de la empresa)
2. Origen = destino → 400
3. Cantidad mayor que el saldo del origen → 400 nombrando el lugar
4. **Sacar del local lo que una cuenta abierta ya pidió → 400** (montar la cuenta por la API de
   salones, no por SQL)
5. **Sacar de la bodega con esa misma cuenta abierta → 200**
6. Destino desactivado → 400; origen desactivado → 200
7. Modo serie: trasladar un IMEI concreto; trasladar uno que está en otra ubicación → 400
8. Modo lote: trasladar parte de un lote; el vencimiento sigue siendo uno solo
9. **Dos traslados cruzados en paralelo** del mismo producto (local→bodega y bodega→local,
   `Promise.all`): los dos terminan, ninguno devuelve 500, y los saldos finales cuadran

⛔ El caso 9 es el que prueba el Step 3. Si pasa con el `sort` **y también sin él**, el test no
está midiendo nada: sacá el `sort`, confirmá que **falla**, y volvé a ponerlo. Un mutante que
sobrevive es sospechoso del control antes que de la línea.

⚠️ Y usar un **garzón propio** para el caso 4: la sesión es única por garzón y hay seis specs
que comparten a Ana.

- [ ] **Step 8: Reescribir el e2e de la Tarea 3a**

`backend/test/items-stock-por-ubicacion.e2e-spec.ts` montaba su escenario con SQL directo a
`stock_ubicacion` porque no existía el traslado. Ahora existe: **rehacerlo por la API**. Un
escenario que solo se puede montar con SQL suele ser un escenario imposible.

- [ ] **Step 9: Gate, revisión y commit**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e && ./scripts/reset-db.sh --verificar
```

```bash
git commit -m "feat(bodegas): traslado entre ubicaciones, con documento interno y dos filas de kardex"
```

---

## Tarea 10: La merma elige ubicación (backend + pantalla)

Primera de las tres operaciones que pasan a decir dónde ocurrieron. Backend y frontend van
**juntos en la misma tarea**: si el backend exige `ubicacionId` antes de que la pantalla lo
mande, la merma deja de funcionar entre un commit y el siguiente.

**Files:**
- Create: `frontend/app/composables/useUbicaciones.ts` + `.spec.ts`
- Modify: `backend/src/modules/mermas/dto/create-merma.dto.ts`
- Modify: `backend/src/modules/mermas/mermas.service.ts:171`
- Modify: `frontend/app/pages/mermas.vue` + su spec
- Test: `backend/test/mermas.e2e-spec.ts` (existente)

**Interfaces:**
- Produces: `useUbicaciones()` → `{ ubicaciones, local, hayBodegas, cargar }`.
  **Lo consumen las Tareas 11, 12 y 13.**

- [ ] **Step 1: El composable**

`frontend/app/composables/useUbicaciones.ts`. Va en `composables/` y no adentro de un `.vue`
porque lo usan cuatro pantallas; `hayBodegas` es la que decide si el selector se dibuja:

```ts
/**
 * Las ubicaciones del tenant, para los selectores de inventario.
 *
 * `hayBodegas` es la que gobierna la regla de la spec § 6: mientras exista una
 * sola ubicación, **el selector no se dibuja** (escondido, no deshabilitado) y
 * el `ubicacionId` lo completa el cliente con el local. Sin esto, el tenant que
 * nunca va a tener una bodega paga un campo obligatorio que siempre dice lo
 * mismo, en cuatro pantallas.
 */
export function useUbicaciones() {
  const ubicaciones = useState<Ubicacion[]>('ubicaciones', () => [])
  const local = computed(() => ubicaciones.value.find((u) => u.tipo === 'local') ?? null)
  const hayBodegas = computed(() => ubicaciones.value.some((u) => u.tipo === 'bodega'))
  // …cargar() con useApiFetch
  return { ubicaciones, local, hayBodegas, cargar }
}
```

Su spec cubre las tres: con solo el local `hayBodegas` es `false`; con una bodega es `true`;
con una bodega **eliminada** vuelve a `false`.

- [ ] **Step 2: El test de backend que falla**

En `mermas.service.spec.ts`: una merma con `ubicacionId` de una bodega registra el movimiento
**en esa bodega**, no en el local. Y sin `ubicacionId` → 400.

- [ ] **Step 3: DTO y service**

`CreateMermaDto` gana `@IsUUID() ubicacionId: string` — **requerido**, no opcional. En
`mermas.service.ts:171`, `ubicacionId: dto.ubicacionId` en vez de `localDe(tenantId)`.

⚠️ Requerido de verdad: omitir la clave, mandarla vacía y mandarla `null` son tres conductas
distintas, y un DTO que la acepta ausente deja al backend elegir por su cuenta.

- [ ] **Step 4: La pantalla**

`mermas.vue`: selector de ubicación **arriba del producto** (se merma lo que se pudrió *ahí*, y
el lugar acota qué productos tienen stock), visible solo si `hayBodegas`. Cuando no se dibuja,
manda `local.value.id`.

⚠️ Al cambiar de ubicación con el formulario a medio llenar, **limpiar la cantidad**. Es el
mismo criterio que ya usa el ajuste de costo al cambiar de unidad o de producto: el número
pertenecía a un contexto, y dejarlo no lo deja viejo — lo deja **reinterpretado**.

- [ ] **Step 5: Correr, gate y commit**

```bash
cd backend && npm test -- mermas && npm run test:e2e -- mermas
cd frontend && npm test -- mermas
```

```bash
git commit -m "feat(bodegas): la merma dice en qué ubicación ocurrió"
```

---

## Tarea 11: El recuento se hace por ubicación

**Files:**
- Modify: `backend/src/modules/recuentos/entities/recuento-inventario.entity.ts` (columna
  `ubicacion_id`)
- Modify: `backend/src/modules/recuentos/recuentos.service.ts:174, 266, 579, 694, 752`
- Modify: `backend/src/modules/recuentos/dto/` (el DTO de crear sesión)
- Modify: `frontend/app/pages/inventario/recuentos/index.vue` y `[id].vue` + specs
- Test: `backend/test/recuentos.e2e-spec.ts` (existente)

- [ ] **Step 1: El test que falla**

```ts
it('la sesión de recuento solo trae los productos con saldo en SU ubicación', async () => {
  /* i1 con 10 en el local y 0 en la bodega; sesión sobre la bodega → i1 aparece con
     stockSistema 0, no 10 */
});

it('aplicar el recuento mueve el saldo de esa ubicación y ninguna otra', async () => {
  /* recuento en la bodega con diferencia +3 → stock_ubicacion de la bodega sube 3,
     el del local no se mueve */
});
```

⚠️ El segundo test es el que cuida la propiedad más importante del recuento, que **no** cambia:
la diferencia se aplica como **delta** sobre el saldo vigente, no como valor absoluto, para no
pisar las ventas que ocurrieron mientras se contaba. Ahora el delta es sobre el saldo *de esa
ubicación*.

- [ ] **Step 2: Correr y ver fallar**

- [ ] **Step 3: La columna y el service**

`RecuentoInventario` gana `ubicacion_id` (`type: 'uuid'`, obligatoria). El `SELECT` de la línea
174, que arma las líneas de la sesión, `JOIN stock_ubicacion` acotado a la ubicación de la
sesión. El `registrarMovimiento` de la 694 pasa la ubicación de la sesión.

⛔ **Una sesión de recuento no puede cambiar de ubicación** una vez creada: las líneas ya
contadas se refieren a lo que había *ahí*. El `PATCH` de la sesión rechaza `ubicacionId`.

- [ ] **Step 4: Las pantallas**

El alta de sesión pide la ubicación (solo si `hayBodegas`); el detalle la muestra en el
encabezado, no editable.

- [ ] **Step 5: Correr, gate y commit**

```bash
git commit -m "feat(bodegas): el recuento se hace por ubicación"
```

---

## Tarea 12: El ajuste de stock y la entrada por compra eligen ubicación

**Files:**
- Modify: `backend/src/modules/items/dto/ajuste-stock.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts:1908, 2899, 4135` (los caminos de ajuste
  manual y entrada por compra)
- Modify: `backend/src/modules/inventario/dto/` (el DTO de ajuste de costo **no** lleva
  ubicación: el costo es del tenant, no del lugar)
- Modify: `frontend/app/pages/inventario/index.vue` + spec
- Test: `backend/test/inventario.e2e-spec.ts` (existente)

- [ ] **Step 1: El test que falla**

```ts
it('la entrada por compra suma al lugar elegido', async () => { /* … */ });

it('el ajuste de COSTO no pide ubicación', async () => {
  // El costo es un promedio por producto para todo el tenant (spec § 3.2).
  // Pedirle una ubicación sugeriría que hay un costo por lugar, y no lo hay.
});
```

- [ ] **Step 2: Correr, implementar, correr**

`ubicacionId` requerido en el DTO de ajuste de stock y de entrada por compra; **ausente** en el
de ajuste de costo. En la pantalla, el selector aparece en los dos primeros drawers y no en el
tercero.

- [ ] **Step 3: El kardex muestra dónde**

`GET /inventario/movimientos` gana `ubicacionId` como filtro opcional y devuelve el nombre de la
ubicación en cada fila; la tabla de `inventario/index.vue` gana la columna **Ubicación** y el
filtro. La columna se dibuja siempre que `hayBodegas`.

- [ ] **Step 4: Gate y commit**

```bash
git commit -m "feat(bodegas): el ajuste de stock y la compra eligen ubicación; el kardex la muestra"
```

---

## Tarea 13: La pantalla de traslados

**Files:**
- Create: `frontend/app/pages/inventario/traslados.vue` + `.nuxt.spec.ts`
- Modify: la navegación de `inventario/` (entrada al menú)

- [ ] **Step 1: El spec de pantalla que falla**

```ts
it('no deja confirmar con origen igual a destino', () => { /* botón deshabilitado */ })
it('el disponible que muestra por línea es el del ORIGEN elegido', () => {
  // 10 en el local y 20 en la bodega: eligiendo la bodega como origen tiene
  // que decir 20. Números distintos a propósito.
})
it('al cambiar el origen, limpia las líneas ya cargadas', () => {
  // Las cantidades se eligieron contra el disponible del origen anterior.
})
```

- [ ] **Step 2: La pantalla**

Formulario *origen → destino → motivo → líneas*, más el histórico paginado con el detalle
navegable de cada traslado (sus dos movimientos de kardex).

⚠️ **El disponible que se muestra por línea sale del backend, no se calcula en el cliente.**
Restar localmente lo que la pantalla ya cargó, cuando el servidor también lo resta, es el mismo
bug que se arregló en el salón el 2026-09-02: mostraba 0 donde había 2.

⚠️ Y una regla que este proyecto ya pagó cinco veces: **todo `await` que precede a un pintado o
a un envío tiene que revalidar contra qué se está trabajando al volver**. Si el usuario cambia
el origen mientras el disponible se está cargando, la respuesta vieja no puede pintar sobre el
origen nuevo.

⛔ **Antes de cerrar: smoke test en el navegador real** (DevTools, no Claude Browser). Ni el
build, ni el typecheck, ni las revisiones ven un auto-import de Nuxt que falta o un drift entre
componentes duplicados; y esta pantalla no tiene gemela de la que copiar comportamiento.

- [ ] **Step 3: Gate y commit**

```bash
git commit -m "feat(bodegas): pantalla de traslados con su histórico"
```

---

## Tarea 14: El catálogo de productos muestra el total y desglosa

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue` + spec

- [ ] **Step 1: El spec que falla**

```ts
it('la columna Stock muestra el total de todas las ubicaciones', () => { /* 30, no 10 */ })
it('el detalle del producto desglosa por ubicación, el local primero', () => { /* … */ })
it('sin bodegas, no dibuja ninguna columna ni sección de ubicación', () => { /* … */ })
```

- [ ] **Step 2: Implementar**

La columna `Stock` lee `stock` (el total). En el detalle, una sección con el desglose que ya
devuelve `GET /items/:id`, el local arriba.

⚠️ **Nombrar los dos números distinto en la pantalla.** La lista dice *"Stock total"* y el salón
sigue diciendo *"Disponible"*. Si los dos se llaman "Stock", alguien va a ver 30 en la lista,
leer "sin stock" en el salón, y abrir un ticket. Los dos tienen razón; la pantalla tiene que
dejarlo obvio sin que haga falta explicarlo.

- [ ] **Step 3: Gate y commit**

```bash
git commit -m "feat(bodegas): el catálogo muestra el total y desglosa por ubicación"
```

---

## Tarea 15: El rechazo dice dónde está la mercadería

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (el 400 de `validarStockAlPedir`)
- Modify: `backend/src/modules/ventas/ventas.service.ts` (el 400 del tope al cobrar)
- Modify: `frontend/app/pages/salones/index.vue`, `frontend/app/pages/ventas/pos.vue`
- Test: `backend/test/reserva-stock-mesa.e2e-spec.ts` (existente), specs de pantalla

- [ ] **Step 1: El test que falla**

```ts
it('el 400 nombra el ingrediente Y dónde está lo que falta', async () => {
  // 0 en el local, 10 en la bodega
  // → "Sin Carne en el local — hay 10 kg en Bodega Subsuelo"
});

it('si no hay en ninguna parte, no inventa una bodega', async () => {
  // 0 en todos lados → el mensaje de siempre, sin la segunda mitad
});
```

- [ ] **Step 2: Implementar el mensaje**

El backend devuelve el mensaje **completo** y también los datos sueltos (`itemNombre`,
`faltante`, `ubicaciones: [{ nombre, stock }]`), para que el cliente pueda ofrecer la acción sin
parsear texto.

- [ ] **Step 3: Las dos caras del mensaje**

- **Salón** (el garzón, sin `Inventario/Crear`): el mensaje y nada más.
- **POS e inventario** (con el permiso): el mismo mensaje **y** el botón que abre el traslado
  precargado con ese producto, esa cantidad y esa bodega como origen.

⛔ La condición se evalúa contra el permiso real del usuario, no contra la pantalla. Un botón
para todos le devuelve un 403 al garzón en medio del servicio.

- [ ] **Step 4: Gate, smoke test en navegador y commit**

Probar en el navegador real las dos caras, con dos usuarios distintos.

```bash
git commit -m "feat(bodegas): el rechazo por stock dice dónde está la mercadería"
```

---

## Tarea 16: Documentación viva y cierre del backlog

Va al final **y en un commit propio**: los seis lugares que hoy dicen que esto no existe se
actualizan cuando ya existe.

**Files:**
- Create: `docs/features/bodegas-y-traslados.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/README.md` (link), `docs/ESTADO.md` (fila nueva + la frase de la línea 30)
- Modify: `docs/PRODUCTO.md:449`, `docs/DIFERENCIADORES.md:283-289`
- Modify: `docs/features/inventario-kardex.md:38-39`, `docs/features/mermas-valorizadas.md:37`
- Modify: `CLAUDE.md` (la regla de inventario), `docs/patterns/backend.md` §15
- Modify: `docs/agent/pendientes.md` (borrar la entrada), `docs/agent/resueltos.md` (agregarla)
- Modify: `startup-pos.sql`
- Delete: `docs/superpowers/plans/2026-09-06-bodegas-y-traslados.md` y su spec (la convención
  del repo: los planes de features terminadas se borran, la historia queda en git)

- [ ] **Step 1: Barrer, no ir a los seis de memoria**

```bash
cd /Users/m2pro/cmatheus/startup-app
grep -rn -i "bodega\|multi-bodega\|traspaso\|stock por bodega" docs/ CLAUDE.md --include="*.md" | grep -v "docs/superpowers\|docs/agent/investigaciones"
```

La lista de seis se armó el 2026-09-06. **Volver a barrer**: si entre medio alguien escribió un
séptimo, dejarlo vivo manda al próximo agente a no buscar lo que sí existe.

- [ ] **Step 2: Las frases concretas**

- `CLAUDE.md`: *"`item_producto.stock` es saldo materializado"* → el saldo es
  `stock_ubicacion` por `(ítem, ubicación)`, y la venta sale del local.
- `ESTADO.md:30`: la frase *"el stock físico, que sigue significando lo que hay en bodega"* usa
  "bodega" como sinónimo coloquial de depósito. Después de esta feature dice algo **falso y
  confuso a la vez**: reescribirla, no parcharla.
- `PRODUCTO.md:449` y `features/*`: sacar bodegas del no-alcance; **traspasos** sigue afuera solo
  en lo que respecta a la emisión del DTE 52.

⚠️ **Reescribir, no anexar.** Un frente anterior se descartó entero por correcciones pegadas al
final en vez de integradas en el texto.

- [ ] **Step 3: El feature doc**

`docs/features/bodegas-y-traslados.md` describe **el porqué y las reglas de negocio**, no repite
el código: el corte local/bodega y por qué mantiene esto fuera de lo fiscal, las siete
decisiones del owner con su fecha, por qué el costo no se parte, por qué el traslado son dos
filas de kardex, y el orden de locks con su razón.

⛔ Y lo que **no** está cubierto, escrito con todas las letras: **el DTE 52 no se emite**. El
registro interno no reemplaza el documento que viaja con la mercadería; el tenant lo emite por
fuera, igual que hoy hace con las boletas. **Tener el traslado registrado no es estar en regla.**

- [ ] **Step 4: Cerrar el backlog**

Mover la entrada de `pendientes.md` a `resueltos.md` con lo que se construyó y lo que quedó
afuera. Y revisar el párrafo de "Detenerse y preguntar" de `CLAUDE.md`: si nombra este frente,
se actualiza **en el mismo commit**. Nombrar ahí un frente cerrado hace frenar al próximo agente
por algo que ya no existe — ya pasó cuatro veces.

- [ ] **Step 5: Gate final completo y commit**

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

```bash
git commit -m "docs(bodegas): documentación viva y cierre del frente"
```

⚠️ Este push toca entidades: además del CI, **revisar el deployment de Railway**. Un `push` a
`main` despliega, y un cambio de esquema puede tumbar el arranque allá aunque acá esté verde.

---

## Verificación final del frente completo

Cuando las 16 tareas estén cerradas:

- [ ] `./scripts/reset-db.sh` y el gate de los seis comandos, entero
- [ ] `./scripts/reset-db.sh --verificar` después del e2e
- [ ] **Revisión de rama** sobre el diff completo del frente, no solo por tarea: caza las
      contradicciones **entre** tareas —un seed que una tarea cambia y rompe el e2e de otra—
      que ninguna revisión por-tarea puede ver
- [ ] Smoke test en el navegador real: crear una bodega, trasladar, ver el rechazo con su
      mensaje, y confirmar que el salón sigue funcionando igual
- [ ] `./scripts/smoke-produccion.sh` con el deploy de Railway en SUCCESS

## Decisiones abiertas

Ninguna bloquea la ejecución. Las tres que el owner puede querer revisar sobre la marcha:

1. **Producto eliminado se puede trasladar** (Tarea 9, Step 4). Decisión del agente, no del
   owner: sin eso una bodega de producto discontinuado no se vacía nunca.
2. **`Inventario/Crear` en vez de un permiso propio `Inventario/Trasladar`.** El traslado es un
   solo acto y no tiene el paso de aprobación que justificó separar permisos en el recuento.
3. **La merma, el recuento y el ajuste siguen sin mirar lo apartado.** Es un agujero conocido y
   anotado en el backlog, anterior a este frente. El traslado **sí** lo mira (decisión 6), así
   que queda una inconsistencia visible hasta que esos tres se arreglen — deliberada: la
   alternativa era sumar una cuarta puerta al agujero.
