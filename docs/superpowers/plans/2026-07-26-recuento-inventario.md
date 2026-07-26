# Recuento de inventario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesión de conteo físico con ciclo de vida (borrador → aplicado) que compara lo contado contra el stock del sistema y aplica la diferencia al kardex con una causa tipificada.

**Architecture:** Una sesión (`recuento_inventario`) con una línea por producto (`recuento_inventario_linea`). Cada línea **congela** `stock_sistema` al crearse; el delta se calcula ahí y al aplicar se **suma al stock vigente**, no lo reemplaza. Aplicar corre en una transacción y genera un movimiento por línea con delta ≠ 0 vía `inventarioService.registrarMovimiento`, con `motivo='recuento'` y `tipo='entrada'|'salida'` según el signo.

**Tech Stack:** NestJS + TypeORM (SQL raw vía `manager.query`), PostgreSQL 15, Decimal.js, Jest + supertest (e2e), Nuxt 4 + Nuxt UI.

**Spec:** [`docs/superpowers/specs/2026-07-26-recuento-inventario-design.md`](../specs/2026-07-26-recuento-inventario-design.md)

## Global Constraints

- **`tenant_id` sale siempre del token**, nunca del body/query/ruta. `usuario_id` igual.
- **Dinero y cantidades con Decimal.js**, nunca `number` nativo. Persistir con `.toFixed(4)` (`NUMERIC(18,4)`).
- **Soft delete:** toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`. Nunca `DELETE` físico.
- **Nunca una query por iteración (N+1).** Incluye la siembra: un `INSERT` multi-fila, no un loop.
- **Toda entidad nueva va TAMBIÉN en el array `entities` de `app.module.ts`**, no solo en `forFeature`. No hay `autoLoadEntities`; ni el typecheck ni los unit tests lo detectan — solo el e2e real.
- **Permisos con enforcement real** (guard por ruta). Catálogos y configuración = `TenantAdminGuard`; features operativas = `@RequiresPermiso`.
- Documentación en el mismo commit que el código.
- **Commitear directo sobre `main`.** No crear ramas ni PRs.
- No refactorizar fuera del alcance. Sin `TODO`, sin código comentado, sin código muerto.
- Seeder: IDs fijos con patrón `550e8400-e29b-41d4-a716-446655440XXX`, siguiente libre desde **`...440292`** (verificar con `grep -o "446655440[0-9]\{3\}" backend/src/modules/seeder/seeder.service.ts | sort -u | tail -1`).
- **Solo `modo_inventario='cantidad'`.** Serie y lote quedan fuera y están registrados en `docs/agent/pendientes.md`.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/src/common/utils/pg-returning.util.ts` | **Nuevo** — `unwrap()` compartido | 1 |
| `backend/src/modules/motivos-diferencia/motivos-diferencia.service.ts` | Adopta el `unwrap()` compartido | 1 |
| `backend/src/modules/mermas/causas-merma.service.ts` | Adopta `unwrap()` (cierra el latente) | 1 |
| `backend/src/modules/motivos-diferencia-inventario/` | **Nuevo módulo** — catálogo de causas | 2 |
| `backend/src/modules/recuentos/` | **Nuevo módulo** — sesión, líneas, aplicar | 3, 4, 5 |
| `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts` | Columna `motivoDiferenciaId` | 3 |
| `backend/src/modules/tenants/tenants.service.ts` | Siembra las causas al crear tenant | 2 |
| `backend/src/modules/seeder/seeder.service.ts` | Causas fijas en dev + datos de ejemplo | 2 |
| `startup-pos.sql` | 3 tablas nuevas + columna en el kardex | 2, 3 |
| `frontend/app/pages/inventario/recuentos/index.vue` | **Nuevo** — listado de sesiones | 6 |
| `frontend/app/pages/inventario/recuentos/[id].vue` | **Nuevo** — detalle y carga de conteos | 6 |
| `frontend/app/pages/configuracion/motivos-diferencia-inventario.vue` | **Nuevo** — catálogo | 6 |

---

## Task 1: `unwrap()` compartido

**Files:**
- Create: `backend/src/common/utils/pg-returning.util.ts`, `backend/src/common/utils/pg-returning.util.spec.ts`
- Modify: `backend/src/modules/motivos-diferencia/motivos-diferencia.service.ts:32-37` (borrar el local, importar el compartido)
- Modify: `backend/src/modules/mermas/causas-merma.service.ts:58-63, 101-106` (adoptarlo)
- Modify: `docs/agent/pendientes.md` (cerrar el latente), `docs/patterns/backend.md`

**Interfaces:**
- Consumes: nada.
- Produces: `export function unwrap<T>(raw: unknown): T[]` en `backend/src/common/utils/pg-returning.util.ts`. Las tareas 2 y 3-5 lo importan desde ahí.

**Contexto:** TypeORM sobre pg devuelve `INSERT/UPDATE ... RETURNING` como `[rows, rowCount]`, no como `rows`. `motivos-diferencia.service.ts` lo resuelve con un `unwrap()` local; `causas-merma.service.ts` **no lo tiene** y tipa el resultado directo — está registrado como latente en `pendientes.md`. Esta tarea centraliza el helper y cierra el latente. **No cambia comportamiento observable**: los tests existentes de ambos catálogos deben pasar sin tocarlos.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/common/utils/pg-returning.util.spec.ts`:

```typescript
import { unwrap } from './pg-returning.util';

describe('unwrap — RETURNING de pg vía TypeORM', () => {
  it('desenvuelve la forma [rows, rowCount]', () => {
    const raw = [[{ id: 'a' }, { id: 'b' }], 2];
    expect(unwrap<{ id: string }>(raw)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('deja pasar la forma rows sin tocarla', () => {
    const raw = [{ id: 'a' }];
    expect(unwrap<{ id: string }>(raw)).toEqual([{ id: 'a' }]);
  });

  it('devuelve [] con resultado vacío', () => {
    expect(unwrap([])).toEqual([]);
  });

  it('devuelve [] cuando la forma envuelta trae filas vacías', () => {
    expect(unwrap([[], 0])).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx jest src/common/utils/pg-returning.util.spec.ts --silent=false`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Crear el helper**

`backend/src/common/utils/pg-returning.util.ts`:

```typescript
/**
 * TypeORM + pg: `INSERT/UPDATE ... RETURNING` llega como `[rows, rowCount]`,
 * no como `rows`. Tipar el resultado directo compila pero devuelve la forma
 * equivocada en runtime — un bug silencioso que ya apareció dos veces en este
 * repo. Toda query con RETURNING pasa por acá.
 */
export function unwrap<T>(raw: unknown): T[] {
  return Array.isArray((raw as unknown[])[0])
    ? ((raw as T[][])[0] ?? [])
    : ((raw as T[]) ?? []);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npx jest src/common/utils/pg-returning.util.spec.ts --silent=false`
Expected: PASS (4 tests).

- [ ] **Step 5: Migrar `motivos-diferencia.service.ts`**

Borrar la función local (líneas 32-37, incluido su comentario) y agregar arriba:

```typescript
import { unwrap } from '../../common/utils/pg-returning.util';
```

El resto del archivo no cambia — las llamadas a `unwrap<Row>(...)` siguen igual.

- [ ] **Step 6: Adoptar `unwrap()` en `causas-merma.service.ts`**

Agregar el import:

```typescript
import { unwrap } from '../../common/utils/pg-returning.util';
```

En `create()` (línea ~58), reemplazar:

```typescript
    const rows: CausaMermaRow[] = await this.dataSource.query(
```

por:

```typescript
    const rows = unwrap<CausaMermaRow>(
      await this.dataSource.query(
```

cerrando el paréntesis extra al final de esa llamada. Hacer lo mismo en `update()` (línea ~101). **No cambiar ninguna otra cosa** de ese archivo: ni la política de `es_fijo`, ni el chequeo de uso al borrar.

- [ ] **Step 7: Correr los tests de los dos catálogos y verificar que pasan sin cambios**

Run: `cd backend && npx jest causas-merma motivos-diferencia --silent=false && npm run typecheck`
Expected: PASS, **sin haber modificado ningún archivo `.spec.ts`**. Si un test falla, el cambio alteró comportamiento — revertir y revisar.

- [ ] **Step 8: Documentar**

- En `docs/patterns/backend.md`, agregar la regla: toda query con `RETURNING` pasa por `unwrap()` de `common/utils/pg-returning.util.ts`, con el porqué (la forma `[rows, rowCount]`).
- En `docs/agent/pendientes.md`, **borrar** la entrada que empieza con ``- [ ] **`causas-merma.service.ts` — mismo latente `UPDATE ... RETURNING` sin unwrap`` — queda resuelta.

- [ ] **Step 9: Commit**

```bash
git add backend/src/common/utils/ backend/src/modules/motivos-diferencia/ backend/src/modules/mermas/causas-merma.service.ts docs/
git commit -m "refactor(common): centralizar unwrap() de RETURNING y cerrar el latente de causas-merma"
```

---

## Task 2: Catálogo `motivo_diferencia_inventario`

**Files:**
- Modify: `startup-pos.sql` (tabla nueva)
- Create: `backend/src/modules/motivos-diferencia-inventario/` — `entities/motivo-diferencia-inventario.entity.ts`, `motivos-diferencia-inventario.defaults.ts`, `motivos-diferencia-inventario.service.ts`, `motivos-diferencia-inventario.controller.ts`, `motivos-diferencia-inventario.module.ts`, `dto/create-motivo-diferencia-inventario.dto.ts`, `dto/update-motivo-diferencia-inventario.dto.ts`, `motivos-diferencia-inventario.service.spec.ts`
- Modify: `backend/src/app.module.ts` (módulo + **array `entities`**)
- Modify: `backend/src/modules/tenants/tenants.service.ts` (siembra al crear tenant)
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Test: `backend/test/recuentos.e2e-spec.ts` (nuevo)

**Interfaces:**
- Consumes: `unwrap()` de Task 1.
- Produces: `MotivosDiferenciaInventarioService.assertMotivoActivo(runner, tenantId, motivoId): Promise<{ id: string; nombre: string }>` — la Task 5 la usa para validar el motivo al aplicar. Y `MotivoDiferenciaInventarioListItem { id, nombre, activo, esFijo }`.

**Contexto:** modelar el service sobre `causas-merma.service.ts` (es el precedente más cercano: mismo dominio, y **valida uso antes de eliminar**, que es lo que necesitamos). **No** copiar la política de `motivos-diferencia.service.ts` de bloquear solo el rename en un `es_fijo`: acá un `es_fijo` no se modifica ni se elimina, como en causas de merma.

- [ ] **Step 1: Agregar la tabla al esquema**

En `startup-pos.sql`, junto a `causas_merma`:

```sql
-- Causas de diferencia detectada en un recuento físico. Catálogo por tenant.
-- NO se reusa causas_merma: un recuento puede dar SOBRANTE, y ninguna causa de
-- merma lo explica. Ver ADR/spec de recuento de inventario.
CREATE TABLE "motivo_diferencia_inventario" (
  "motivo_diferencia_inventario_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"         TEXT NOT NULL,
  "activo"         BOOLEAN NOT NULL DEFAULT true,
  "es_fijo"        BOOLEAN NOT NULL DEFAULT false,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_motivo_dif_inv_tenant_nombre"
  ON "motivo_diferencia_inventario" ("tenant_id", lower("nombre")) WHERE "eliminado_el" IS NULL;
```

- [ ] **Step 2: Crear las causas fijas**

`backend/src/modules/motivos-diferencia-inventario/motivos-diferencia-inventario.defaults.ts`:

```typescript
// Cubren las dos direcciones: las tres primeras explican faltantes; "Error de
// recepción" y "Error de registro" explican faltante Y sobrante.
export const MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS = [
  'Merma no declarada',
  'Robo',
  'Error de recepción',
  'Error de registro',
  'Sobre-porcionado',
  'Otro',
] as const;
```

- [ ] **Step 3: Escribir el test que falla**

`backend/src/modules/motivos-diferencia-inventario/motivos-diferencia-inventario.service.spec.ts`, siguiendo el estilo de mock de `causas-merma.service.spec.ts`:

```typescript
describe('MotivosDiferenciaInventarioService', () => {
  it('rechaza un nombre duplicado en el mismo tenant', async () => {
    // mock: assertNombreUnico encuentra una fila
    await expect(
      service.create(TENANT_ID, { nombre: 'Robo' }),
    ).rejects.toThrow('Ya existe un motivo de diferencia con el nombre "Robo"');
  });

  it('rechaza modificar un motivo fijo del sistema', async () => {
    // mock: findOneOrFail devuelve esFijo: true
    await expect(
      service.update(TENANT_ID, MOTIVO_ID, { nombre: 'Otro nombre' }),
    ).rejects.toThrow('No se puede modificar un motivo fijo del sistema');
  });

  it('rechaza eliminar un motivo en uso en movimientos', async () => {
    // mock: findOneOrFail esFijo false; COUNT devuelve 1
    await expect(service.remove(TENANT_ID, MOTIVO_ID)).rejects.toThrow(
      'No se puede eliminar: el motivo está en uso en movimientos de recuento',
    );
  });

  it('assertMotivoActivo rechaza un motivo inactivo o de otro tenant', async () => {
    // mock: query devuelve []
    await expect(
      service.assertMotivoActivo(runner, TENANT_ID, MOTIVO_ID),
    ).rejects.toThrow('Motivo de diferencia no válido o inactivo');
  });

  it('findAll con soloActivas filtra los inactivos', async () => {
    // mock: verificar que el SQL emitido incluye "AND activo = true"
    await service.findAll(TENANT_ID, true);
    const sql = String(dataSource.query.mock.calls[0][0]);
    expect(sql).toContain('AND activo = true');
  });
});
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `cd backend && npx jest motivos-diferencia-inventario --silent=false`
Expected: FAIL — el service no existe.

- [ ] **Step 5: Implementar entidad, DTOs, service, controller y módulo**

**Entidad** (`entities/motivo-diferencia-inventario.entity.ts`): mapear las columnas del Step 1. **Todas las columnas UUID declaran `type: 'uuid'` explícito** — lo exige el test de invariante del ADR-004.

**DTOs:** `CreateMotivoDiferenciaInventarioDto { nombre: string (IsString, IsNotEmpty); activo?: boolean }`, `UpdateMotivoDiferenciaInventarioDto` con los dos opcionales.

**Service:** copiar la estructura de `backend/src/modules/mermas/causas-merma.service.ts` cambiando tabla, PK (`motivo_diferencia_inventario_id`), sustantivo de los mensajes ("motivo de diferencia"), y usando `unwrap()` de Task 1 en `create()` y `update()`. Métodos: `findAll(tenantId, soloActivas)`, `create`, `update`, `remove`, y:

```typescript
async assertMotivoActivo(
  runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  tenantId: string,
  motivoId: string,
): Promise<{ id: string; nombre: string }> {
  const rows = (await runner.query(
    `SELECT motivo_diferencia_inventario_id, nombre
       FROM motivo_diferencia_inventario
      WHERE motivo_diferencia_inventario_id = $1 AND tenant_id = $2
        AND activo = true AND eliminado_el IS NULL`,
    [motivoId, tenantId],
  )) as { motivo_diferencia_inventario_id: string; nombre: string }[];
  if (!rows.length) {
    throw new BadRequestException('Motivo de diferencia no válido o inactivo');
  }
  return { id: rows[0].motivo_diferencia_inventario_id, nombre: rows[0].nombre };
}
```

El chequeo de uso en `remove()` cuenta sobre `movimientos_inventario.motivo_diferencia_id` (la columna la agrega la Task 3; hasta entonces el `COUNT` sobre una columna inexistente falla — **por eso el chequeo de uso se escribe en la Task 3, Step 6**, no acá; en esta tarea `remove()` solo valida `es_fijo`).

**Controller:** `@Controller('motivos-diferencia-inventario')` con `@UseGuards(JwtAuthGuard, TenantGuard)`; `GET` abierto a cualquier usuario del tenant y `POST`/`PATCH`/`DELETE` con `@UseGuards(TenantAdminGuard)` — mismo patrón que `causas-merma.controller.ts`.

**Módulo** y registro en `app.module.ts`: **el módulo en `imports` Y la entidad en el array `entities`.**

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest motivos-diferencia-inventario --silent=false && npm run typecheck`
Expected: PASS (5 tests).

- [ ] **Step 7: Sembrar las causas al crear un tenant**

En `tenants.service.ts`, después del bloque `// 7b` de motivos de diferencia de caja, agregar un `INSERT` **multi-fila** (no un loop — el N+1 es invariante del proyecto, y los bloques 7 y 7b preexistentes quedan como están, fuera de alcance):

```typescript
      // 7c. Sembrar los motivos de diferencia de inventario del sistema
      const valores = MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS.map(
        (_, i) => `($1, $${i + 2}, true, true)`,
      ).join(', ');
      await manager.query(
        `INSERT INTO motivo_diferencia_inventario (tenant_id, nombre, activo, es_fijo)
         VALUES ${valores}`,
        [savedTenant.id, ...MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS],
      );
```

- [ ] **Step 8: Sembrar en el seeder de desarrollo**

En `seeder.service.ts`, sembrar las 6 causas para los tenants de dev con IDs fijos desde `550e8400-e29b-41d4-a716-446655440292` (verificar el siguiente libre antes). Un `INSERT` multi-fila.

- [ ] **Step 9: E2E del catálogo**

Crear `backend/test/recuentos.e2e-spec.ts` con la estructura de `backend/test/mermas.e2e-spec.ts`:

```typescript
  it('GET /motivos-diferencia-inventario trae las 6 causas fijas del seed', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const nombres = (body as { nombre: string }[]).map((m) => m.nombre);
    expect(nombres).toEqual(
      expect.arrayContaining([
        'Merma no declarada', 'Robo', 'Error de recepción',
        'Error de registro', 'Sobre-porcionado', 'Otro',
      ]),
    );
    expect((body as { esFijo: boolean }[]).filter((m) => m.esFijo)).toHaveLength(6);
  });

  it('PATCH sobre una causa fija devuelve 400', async () => {
    const { body: lista } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    const fija = (lista as { id: string; esFijo: boolean }[]).find((m) => m.esFijo)!;

    await request(app.getHttpServer())
      .patch(`/api/motivos-diferencia-inventario/${fija.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Renombrada' })
      .expect(400);
  });
```

Run: `cd backend && npx jest --config test/jest-e2e.json recuentos`
Expected: PASS. Requiere `docker-compose up` y el seeder corrido — si las causas no aparecen, `docker-compose restart backend` (hay `synchronize: true` en dev, así que la tabla nueva se crea al reiniciar). **No correr `docker-compose down -v`: destruye el volumen y es decisión del owner.**

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/motivos-diferencia-inventario/ backend/src/app.module.ts backend/src/modules/tenants/ backend/src/modules/seeder/ backend/test/recuentos.e2e-spec.ts startup-pos.sql
git commit -m "feat(inventario): catálogo de motivos de diferencia de recuento"
```

---

## Task 3: Esquema del recuento + crear, listar y ver una sesión

**Files:**
- Modify: `startup-pos.sql` (2 tablas + columna en `movimientos_inventario`)
- Modify: `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts`
- Create: `backend/src/modules/recuentos/` — `entities/recuento-inventario.entity.ts`, `entities/recuento-inventario-linea.entity.ts`, `recuentos.service.ts`, `recuentos.controller.ts`, `recuentos.module.ts`, `dto/create-recuento.dto.ts`, `recuentos.service.spec.ts`
- Modify: `backend/src/app.module.ts`, `backend/src/modules/motivos-diferencia-inventario/motivos-diferencia-inventario.service.ts` (chequeo de uso)
- Test: `backend/test/recuentos.e2e-spec.ts`

**Interfaces:**
- Consumes: `unwrap()` (Task 1); el catálogo (Task 2).
- Produces: `RecuentosService.findOne(tenantId, recuentoId): Promise<RecuentoDetalle>` donde `RecuentoDetalle = { id, estado, motivoDiferenciaDefaultId, comentario, creadoEl, aplicadoEl, lineas: RecuentoLinea[] }` y `RecuentoLinea = { lineaId, itemId, itemNombre, unidadMedida, stockSistema: string, cantidadContada: string | null, diferencia: string | null, motivoDiferenciaId: string | null }`. Las tareas 4 y 5 lo consumen.

- [ ] **Step 1: Agregar las tablas y la columna al esquema**

En `startup-pos.sql`:

```sql
-- Sesión de conteo físico. La diferencia se aplica como DELTA sobre el stock
-- vigente al momento de aplicar, no seteando el stock al valor contado: entre
-- contar y aplicar el POS sigue vendiendo.
CREATE TABLE "recuento_inventario" (
  "recuento_id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                     UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "estado"                        TEXT NOT NULL DEFAULT 'borrador',  -- 'borrador' | 'aplicado' | 'cancelado'
  "motivo_diferencia_default_id"  UUID REFERENCES "motivo_diferencia_inventario" ("motivo_diferencia_inventario_id"),
  "comentario"                    TEXT,
  "usuario_creador_id"            UUID NOT NULL REFERENCES "usuarios" ("usuario_id"),
  "usuario_aplicador_id"          UUID REFERENCES "usuarios" ("usuario_id"),
  "aplicado_el"                   TIMESTAMPTZ,
  "creado_el"                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"                TIMESTAMPTZ,
  "eliminado_el"                  TIMESTAMPTZ
);

CREATE TABLE "recuento_inventario_linea" (
  "linea_id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "recuento_id"           UUID NOT NULL REFERENCES "recuento_inventario" ("recuento_id"),
  "item_id"               UUID NOT NULL REFERENCES "items" ("item_id"),
  "stock_sistema"         NUMERIC(18,4) NOT NULL,   -- congelado al crear la línea; base del delta
  "cantidad_contada"      NUMERIC(18,4),            -- NULL = todavía sin contar
  "motivo_diferencia_id"  UUID REFERENCES "motivo_diferencia_inventario" ("motivo_diferencia_inventario_id"),
  "movimiento_id"         UUID REFERENCES "movimientos_inventario" ("movimiento_id"),
  "creado_el"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"        TIMESTAMPTZ,
  "eliminado_el"          TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_recuento_linea_item_vivo"
  ON "recuento_inventario_linea" ("recuento_id", "item_id") WHERE "eliminado_el" IS NULL;
```

Y en `movimientos_inventario`, después de `causa_merma_id`:

```sql
  "motivo_diferencia_id" UUID REFERENCES "motivo_diferencia_inventario" ("motivo_diferencia_inventario_id"),
  -- solo en motivo='recuento'; NULL en el resto
```

Actualizar el comentario de `motivo` para incluir `'recuento'`.

- [ ] **Step 2: Escribir el test que falla**

En `backend/src/modules/recuentos/recuentos.service.spec.ts`:

```typescript
describe('RecuentosService — crear sesión', () => {
  it('congela el stock del sistema en cada línea', async () => {
    // mock: el SELECT de items devuelve stock '12400' para ITEM_ID
    await service.create(TENANT_ID, USUARIO_ID, { itemIds: [ITEM_ID] });

    const insertLinea = manager.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('INSERT INTO recuento_inventario_linea'),
    );
    expect(insertLinea![1]).toEqual(expect.arrayContaining(['12400']));
  });

  it('rechaza un producto en modo serie o lote', async () => {
    // mock: el SELECT devuelve modo_inventario 'serie'
    await expect(
      service.create(TENANT_ID, USUARIO_ID, { itemIds: [ITEM_ID] }),
    ).rejects.toThrow('El recuento solo admite productos por cantidad');
  });

  it('rechaza un item sin control de stock', async () => {
    // mock: el SELECT no devuelve fila de item_producto
    await expect(
      service.create(TENANT_ID, USUARIO_ID, { itemIds: [ITEM_ID] }),
    ).rejects.toThrow('El item no tiene control de stock');
  });

  it('rechaza crear una sesión sin items', async () => {
    await expect(
      service.create(TENANT_ID, USUARIO_ID, { itemIds: [] }),
    ).rejects.toThrow('El recuento necesita al menos un producto');
  });
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd backend && npx jest recuentos.service --silent=false`
Expected: FAIL — el service no existe.

- [ ] **Step 4: Implementar entidades, DTO, service y controller**

**Entidades** de las dos tablas, con `type: 'uuid'` explícito en todas las columnas UUID. Registrar **el módulo en `imports` y las dos entidades en el array `entities`** de `app.module.ts`.

**`CreateRecuentoDto`**: `{ itemIds: string[] (@IsArray, @IsUUID('4', { each: true }), @ArrayNotEmpty); comentario?: string }`.

**`create(tenantId, usuarioId, dto)`** — en una transacción:
1. **Una sola query** trae los items pedidos con su `tipo`, `stock`, `modo_inventario`, `unidad_medida` y `nombre`, filtrando `eliminado_el IS NULL`:
   ```sql
   SELECT i.item_id, i.nombre, i.tipo, p.stock, p.modo_inventario, p.unidad_medida
     FROM items i
     JOIN item_producto p ON p.item_id = i.item_id
    WHERE i.item_id = ANY($1) AND i.tenant_id = $2 AND i.eliminado_el IS NULL
   ```
   **Nunca una query por item** — es invariante del proyecto.
2. Si falta alguno de los `itemIds` en el resultado → `El item no tiene control de stock`.
3. Si alguno tiene `modo_inventario !== 'cantidad'` → `El recuento solo admite productos por cantidad` (nombrando el producto).
4. `INSERT` de la sesión en `borrador`.
5. **Un solo `INSERT` multi-fila** de las líneas, con `stock_sistema` tomado del `stock` leído.

**`findAll(tenantId, query)`** — listado paginado con estado, fecha, cantidad de líneas y diferencia neta, resuelto con agregación en la misma query (no un `COUNT` por fila).

**`findOne(tenantId, recuentoId)`** — la sesión con sus líneas, en **dos queries** (una la sesión, otra las líneas con `JOIN items`), calculando `diferencia = cantidad_contada − stock_sistema` con Decimal.js cuando `cantidad_contada` no es NULL.

**Controller** `@Controller('recuentos')` con `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`:
`POST` → `@RequiresPermiso('Inventario', 'Crear')`; `GET` y `GET /:id` → `@RequiresPermiso('Inventario', 'Leer')`.

- [ ] **Step 5: Agregar la columna a la entidad del kardex**

En `movimiento-inventario.entity.ts`, junto a `causaMermaId`:

```typescript
  @Column({ name: 'motivo_diferencia_id', type: 'uuid', nullable: true })
  motivoDiferenciaId: string | null;
```

Y actualizar el comentario de `motivo` para incluir `'recuento'`.

- [ ] **Step 6: Completar el chequeo de uso del catálogo**

Ahora que la columna existe, agregar en `motivos-diferencia-inventario.service.ts`, dentro de `remove()` y antes del soft delete:

```typescript
    const uso: { cnt: string }[] = await this.dataSource.query(
      `SELECT COUNT(*)::text AS cnt FROM movimientos_inventario
        WHERE motivo_diferencia_id = $1 AND eliminado_el IS NULL`,
      [id],
    );
    if (parseInt(uso[0].cnt, 10) > 0) {
      throw new BadRequestException(
        'No se puede eliminar: el motivo está en uso en movimientos de recuento',
      );
    }
```

El test del Step 3 de la Task 2 que cubría este caso ahora debe pasar.

- [ ] **Step 7: Correr los tests**

Run: `cd backend && npx jest recuentos motivos-diferencia-inventario --silent=false && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: E2E de creación**

Agregar a `backend/test/recuentos.e2e-spec.ts` un caso que cree un producto con stock conocido, cree la sesión y verifique que el detalle devuelve `stockSistema` igual a ese stock, `cantidadContada` null y `estado: 'borrador'`.

Run: `cd backend && npx jest --config test/jest-e2e.json recuentos`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/recuentos/ backend/src/modules/inventario/ backend/src/modules/motivos-diferencia-inventario/ backend/src/app.module.ts backend/test/recuentos.e2e-spec.ts startup-pos.sql
git commit -m "feat(inventario): sesión de recuento con líneas y stock congelado"
```

---

## Task 4: Cargar conteos, editar la sesión y cancelar

**Files:**
- Modify: `backend/src/modules/recuentos/recuentos.service.ts`, `recuentos.controller.ts`, `recuentos.service.spec.ts`
- Create: `backend/src/modules/recuentos/dto/update-recuento.dto.ts`, `dto/update-recuento-linea.dto.ts`
- Test: `backend/test/recuentos.e2e-spec.ts`

**Interfaces:**
- Consumes: `findOne` (Task 3).
- Produces: `PATCH /recuentos/:id/lineas/:lineaId` y `PATCH /recuentos/:id` — la Task 5 asume que una línea contada tiene `cantidad_contada` no nula.

- [ ] **Step 1: Escribir el test que falla**

```typescript
describe('RecuentosService — cargar conteos', () => {
  it('guarda la cantidad contada de una línea', async () => {
    await service.updateLinea(TENANT_ID, RECUENTO_ID, LINEA_ID, {
      cantidadContada: '11800',
    });
    const update = manager.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('UPDATE recuento_inventario_linea'),
    );
    expect(update![1]).toEqual(expect.arrayContaining(['11800']));
  });

  it('rechaza cargar un conteo en una sesión aplicada', async () => {
    // mock: la sesión devuelve estado 'aplicado'
    await expect(
      service.updateLinea(TENANT_ID, RECUENTO_ID, LINEA_ID, { cantidadContada: '1' }),
    ).rejects.toThrow('El recuento ya fue aplicado');
  });

  it('rechaza una cantidad contada negativa', async () => {
    await expect(
      service.updateLinea(TENANT_ID, RECUENTO_ID, LINEA_ID, { cantidadContada: '-5' }),
    ).rejects.toThrow('La cantidad contada no puede ser negativa');
  });

  it('cancelar deja la sesión en cancelado sin tocar stock', async () => {
    await service.cancelar(TENANT_ID, RECUENTO_ID);
    const upd = manager.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("estado = 'cancelado'"),
    );
    expect(upd).toBeDefined();
    const tocaStock = manager.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('UPDATE item_producto'),
    );
    expect(tocaStock).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npx jest recuentos.service -t "cargar conteos" --silent=false`
Expected: FAIL — los métodos no existen.

- [ ] **Step 3: Implementar**

**DTOs:** `UpdateRecuentoLineaDto { cantidadContada?: string (@IsNumberString); motivoDiferenciaId?: string (@IsUUID) }` — `cantidadContada` en `null` explícito limpia el conteo. `UpdateRecuentoDto { motivoDiferenciaDefaultId?: string (@IsUUID); comentario?: string }`.

**Guard de estado:** un helper privado `assertBorrador(tenantId, recuentoId)` que lea el estado y lance `El recuento ya fue aplicado` o `El recuento fue cancelado`. Lo usan `updateLinea`, `update` y `cancelar`.

**`updateLinea`**: valida cantidad ≥ 0 con Decimal.js; si viene `motivoDiferenciaId`, valida con `assertMotivoActivo` del catálogo; hace un `UPDATE` de la línea filtrando por `recuento_id`, `linea_id`, `tenant_id` y `eliminado_el IS NULL`.

**`update`**: si viene `motivoDiferenciaDefaultId`, valida con `assertMotivoActivo`.

**`cancelar`**: `UPDATE ... SET estado = 'cancelado'` solo si el estado actual es `borrador`.

**Rutas:** `PATCH /:id/lineas/:lineaId`, `PATCH /:id` y `POST /:id/cancelar`, todas con `@RequiresPermiso('Inventario', 'Crear')`.

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npx jest recuentos --silent=false && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/recuentos/
git commit -m "feat(inventario): carga de conteos, edición y cancelación de un recuento"
```

---

## Task 5: Aplicar el recuento

**Files:**
- Modify: `backend/src/modules/recuentos/recuentos.service.ts`, `recuentos.controller.ts`, `recuentos.service.spec.ts`
- Test: `backend/test/recuentos.e2e-spec.ts`
- Docs: `docs/features/inventario-kardex.md`

**Interfaces:**
- Consumes: `registrarMovimiento` de `InventarioService` (acepta `motivo`, `tipo`, `cantidad`, `comentario`); `assertMotivoActivo` del catálogo.
- Produces: `POST /recuentos/:id/aplicar` → `{ recuentoId, lineasAplicadas: number, lineasDescartadas: { itemId, itemNombre, razon }[] }`.

**Contexto — el corazón del diseño:** la diferencia es un **delta**, no un absoluto.

```
Al contar:   delta = cantidad_contada − stock_sistema     (stock_sistema congelado en la línea)
Al aplicar:  stock_final = stock_vigente + delta
```

Si contás 11.800 a las 10:00 y aplicás a las 14:00 habiendo vendido 500, setear el stock a 11.800 pisaría esas ventas. El conteo descubrió un faltante de 600; ese faltante es real sin importar lo que se vendió después. Como `registrarMovimiento` ya aplica un delta (suma en `entrada`, resta en `salida`) sobre el stock que lee bajo `FOR UPDATE`, **basta con pasarle `cantidad = |delta|` y el `tipo` correcto** — no hay que calcular el stock final a mano.

**`registrarMovimiento` necesita aceptar `motivoDiferenciaId`**: agregar el campo opcional a `RegistrarMovimientoParams` y al `INSERT` del kardex, poblándolo solo cuando el motivo es `'recuento'` (mismo patrón que `causaMermaId`).

- [ ] **Step 1: Escribir el test que falla**

```typescript
describe('RecuentosService — aplicar', () => {
  it('genera una salida cuando el contado es menor que el sistema', async () => {
    // línea: stock_sistema '12400', cantidad_contada '11800' → delta -600
    await service.aplicar(TENANT_ID, USUARIO_ID, RECUENTO_ID);
    expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tipo: 'salida', motivo: 'recuento', cantidad: '600' }),
    );
  });

  it('genera una entrada cuando el contado es mayor', async () => {
    // línea: stock_sistema '4000', cantidad_contada '4200' → delta +200
    await service.aplicar(TENANT_ID, USUARIO_ID, RECUENTO_ID);
    expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tipo: 'entrada', motivo: 'recuento', cantidad: '200' }),
    );
  });

  it('ignora las líneas sin contar', async () => {
    // dos líneas: una contada, otra con cantidad_contada NULL
    const res = await service.aplicar(TENANT_ID, USUARIO_ID, RECUENTO_ID);
    expect(inventarioService.registrarMovimiento).toHaveBeenCalledTimes(1);
    expect(res.lineasAplicadas).toBe(1);
  });

  it('no genera movimiento cuando el delta es cero', async () => {
    // línea: stock_sistema '8000', cantidad_contada '8000'
    const res = await service.aplicar(TENANT_ID, USUARIO_ID, RECUENTO_ID);
    expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    expect(res.lineasAplicadas).toBe(0);
  });

  it('usa el override de la línea por sobre la causa por defecto', async () => {
    // sesión con default MOTIVO_A; línea con motivo_diferencia_id MOTIVO_B
    await service.aplicar(TENANT_ID, USUARIO_ID, RECUENTO_ID);
    expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ motivoDiferenciaId: MOTIVO_B }),
    );
  });

  it('rechaza aplicar si hay diferencias y no hay causa por defecto ni override', async () => {
    // sesión sin default; línea con delta -600 y sin motivo propio
    await expect(
      service.aplicar(TENANT_ID, USUARIO_ID, RECUENTO_ID),
    ).rejects.toThrow('Falta la causa de la diferencia');
  });

  it('rechaza aplicar una sesión ya aplicada', async () => {
    // mock: estado 'aplicado'
    await expect(
      service.aplicar(TENANT_ID, USUARIO_ID, RECUENTO_ID),
    ).rejects.toThrow('El recuento ya fue aplicado');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npx jest recuentos.service -t "aplicar" --silent=false`
Expected: FAIL — el método no existe.

- [ ] **Step 3: Extender `registrarMovimiento` con `motivoDiferenciaId`**

En `backend/src/modules/inventario/inventario.service.ts`, agregar a `RegistrarMovimientoParams`:

```typescript
  motivoDiferenciaId?: string | null; // solo en motivo='recuento'
```

Validar la coherencia junto a la de `causaMermaId` que ya existe:

```typescript
    if (params.motivo !== 'recuento' && params.motivoDiferenciaId) {
      throw new BadRequestException('motivo_diferencia_id solo aplica a recuento');
    }
```

Y agregar la columna al `INSERT INTO movimientos_inventario` con su parámetro `params.motivoDiferenciaId ?? null`, **cuidando que el número de columnas y de `$n` siga cuadrando**.

- [ ] **Step 4: Implementar `aplicar`**

En `recuentos.service.ts`, dentro de `this.dataSource.transaction`:

1. Leer la sesión con `FOR UPDATE`; si el estado no es `borrador`, lanzar `El recuento ya fue aplicado` o `El recuento fue cancelado`.
2. Leer las líneas con `JOIN items` filtrando `eliminado_el IS NULL` en ambas tablas. Las líneas cuyo item ya no exista o esté eliminado van a `lineasDescartadas` con `razon: 'El producto fue eliminado'`.
3. Para cada línea con `cantidad_contada` no nula:
   ```typescript
   const delta = new Decimal(linea.cantidad_contada).minus(linea.stock_sistema);
   if (delta.isZero()) continue;
   const motivoId = linea.motivo_diferencia_id ?? sesion.motivo_diferencia_default_id;
   if (!motivoId) {
     throw new BadRequestException(
       `Falta la causa de la diferencia para "${linea.item_nombre}"`,
     );
   }
   const mov = await this.inventarioService.registrarMovimiento(manager, {
     tenantId, itemId: linea.item_id, usuarioId,
     tipo: delta.isPositive() ? 'entrada' : 'salida',
     motivo: 'recuento',
     cantidad: delta.abs().toFixed(4),
     motivoDiferenciaId: motivoId,
     comentario: sesion.comentario ?? null,
   });
   ```
   Guardar `mov.movimientoId` en la línea.
4. `UPDATE` de la sesión: `estado = 'aplicado'`, `usuario_aplicador_id`, `aplicado_el = NOW()`.

**Validá la causa antes de empezar a mover stock**, no en medio del loop: si falta en la última línea, ya moviste las anteriores (la transacción revierte igual, pero el mensaje de error llega después de trabajo inútil).

**Stock negativo:** no hace falta chequearlo acá. `registrarMovimiento` ya rechaza una salida que dejaría stock negativo (`Stock insuficiente para la salida`), y al estar todo en una transacción, ninguna línea queda aplicada. Agregá un test que lo confirme.

**Ruta:** `POST /:id/aplicar` con `@RequiresPermiso('Inventario', 'Actualizar')` — distinto del permiso de contar, a propósito.

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx jest recuentos --silent=false && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: E2E del flujo completo, incluida la venta concurrente**

Agregar a `backend/test/recuentos.e2e-spec.ts` el caso que justifica todo el diseño:

```typescript
  it('aplica el delta sobre el stock vigente, no el contado (venta entre contar y aplicar)', async () => {
    // Producto con stock 1000.
    // 1. Crear recuento → la línea congela stock_sistema = 1000.
    // 2. Cargar cantidadContada = 900  → delta -100.
    // 3. Vender/ajustar 200 fuera del recuento → stock vigente 800.
    // 4. Aplicar.
    // Esperado: 800 - 100 = 700.  (Si seteara el absoluto daría 900: mal.)
    const { body: detalle } = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(new Decimal(detalle.stock).toFixed(4)).toBe('700.0000');
  });

  it('el movimiento generado lleva motivo recuento y su causa', async () => {
    const { body: kardex } = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}&motivo=recuento`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(kardex.data.length).toBeGreaterThan(0);
    expect(kardex.data[0].motivo).toBe('recuento');
    expect(kardex.data[0].motivoDiferenciaId).toBeTruthy();
  });
```

**Importante:** `'recuento'` tiene que estar en la constante `MOTIVOS` de `backend/src/modules/inventario/dto/find-movimientos.dto.ts`, o el filtro `?motivo=recuento` devuelve 400. Agregalo y verificá que el e2e de arriba pasa. Exponé también `motivoDiferenciaId` en el mapper de `findMovimientos` (agregándolo al `SELECT` que ya existe — **no** una query por fila).

Run: `cd backend && npx jest --config test/jest-e2e.json recuentos`
Expected: PASS.

- [ ] **Step 7: Documentar**

En `docs/features/inventario-kardex.md`, agregar `motivo='recuento'`, la columna `motivo_diferencia_id`, y la regla del delta con el ejemplo de la venta concurrente.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/recuentos/ backend/src/modules/inventario/ backend/test/recuentos.e2e-spec.ts docs/features/inventario-kardex.md
git commit -m "feat(inventario): aplicar el recuento como delta sobre el stock vigente"
```

---

## Task 6: Frontend

**Files:**
- Create: `frontend/app/pages/inventario/recuentos/index.vue`, `frontend/app/pages/inventario/recuentos/[id].vue`, `frontend/app/pages/configuracion/motivos-diferencia-inventario.vue`
- Modify: la navegación donde vivan los links de inventario y de configuración

**Interfaces:**
- Consumes: todos los endpoints de las tareas 2-5.
- Produces: nada.

**Antes de escribir cualquier `.vue`, invocá la skill `nuxt-ui`.** Convenciones no negociables: tokens semánticos de Nuxt UI, **nunca Tailwind hardcodeado** (los colores financieros son excepción solo de Caja); `$fetch`/`useApiFetch`, nunca axios; las utilidades de presentación van en composables de `app/composables/`, nunca locales a un `.vue`; las páginas no contienen lógica de negocio. Leé `docs/patterns/frontend.md` y `frontend/docs/DESIGN-SYSTEM.md`.

- [ ] **Step 1: Pantalla del catálogo de causas**

`configuracion/motivos-diferencia-inventario.vue`, siguiendo la pantalla de causas de merma que ya existe: tabla con nombre, activo y badge de "fijo"; crear y editar en modal; las fijas no se editan ni eliminan (el backend ya lo rechaza, pero la UI no debe ofrecer la acción).

- [ ] **Step 2: Listado de recuentos**

`inventario/recuentos/index.vue`: tabla con fecha, estado (badge de tres vías: borrador / aplicado / cancelado), cantidad de líneas, diferencia neta y quién lo creó. Botón de "Nuevo recuento" que abre un selector múltiple de productos (solo `modo_inventario='cantidad'`) y crea la sesión.

- [ ] **Step 3: Detalle de un recuento**

`inventario/recuentos/[id].vue`:
- Selector de causa por defecto de la sesión, y campo de comentario.
- Tabla con una fila por producto: nombre, unidad, stock del sistema (solo lectura), input de cantidad contada, **diferencia calculada en vivo**, y selector de causa para el override.
- La diferencia usa color semántico: `text-error` si es negativa, `text-success` si es positiva, neutro si es cero.
- La aritmética en vivo usa **Decimal.js**, igual que el backend. Si el cálculo se necesita en más de una pantalla, va a un composable.
- Botón "Aplicar" con un resumen ("se van a mover N líneas") y confirmación. Deshabilitado si el estado no es `borrador`.
- Tras aplicar, mostrar `lineasDescartadas` en el toast si viene con contenido.
- En estado `aplicado` o `cancelado` la pantalla es de solo lectura.

- [ ] **Step 4: Build, typecheck y design check**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: los tres en verde.

- [ ] **Step 5: Smoke test en el navegador**

Con `docker-compose up` corriendo: crear un recuento con dos productos, cargar un conteo con faltante y otro con sobrante, poner una causa por defecto y un override en una línea, aplicar, y verificar en `/inventario` que aparecen los dos movimientos con `motivo='recuento'`. **Los drawers y las tablas no tienen test unitario: build y typecheck no ven bugs de runtime** (auto-imports de Nuxt que faltan, componentes duplicados).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/
git commit -m "feat(inventario): pantallas de recuento y catálogo de causas de diferencia"
```

---

## Task 7: Documentación de cierre y gate completo

**Files:**
- Create: `docs/features/recuento-inventario.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/README.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md`

- [ ] **Step 1: Escribir la feature doc**

`docs/features/recuento-inventario.md`, desde la plantilla. Debe explicar **el porqué**, no repetir el código:
- Qué problema resuelve (el stock deriva de la realidad sin que nadie lo detecte).
- **Por qué la diferencia es un delta y no un absoluto**, con el ejemplo de la venta concurrente.
- **Por qué el catálogo de causas es propio y no reusa las de merma**: un recuento puede dar sobrante, y ninguna causa de merma lo explica; además reusar ensuciaría el reporte de mermas.
- Por qué contar y aplicar tienen permisos distintos.
- Qué queda fuera: modos serie y lote, cycle count programado, conteo ciego, y el reporte de varianza (AVT), que es el sub-proyecto siguiente.

- [ ] **Step 2: Actualizar índice, estado y producto**

- `docs/README.md`: link a la feature nueva.
- `docs/ESTADO.md`: fila de la funcionalidad con fecha.
- `docs/PRODUCTO.md`: la regla de negocio del recuento y de la diferencia como delta.

- [ ] **Step 3: Correr el gate completo**

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Los siete en verde. **`test:e2e` completo, no un subset.**

Si el e2e falla por contaminación de la BD local (stock de seed agotado, causa duplicada, caja ya abierta), **no es regresión**: pedile al owner que corra `docker-compose down -v && docker-compose up -d`, esperá a ver `Seed complete` en `docker logs tecnica_backend`, y corré la suite **una sola vez**. Correrla dos veces seguidas contamina la BD y los números de la segunda no son válidos. **Nunca corras `down -v` vos: destruye el volumen y es decisión del owner.**

- [ ] **Step 4: Revisión independiente**

Invocar la skill `verify-feature`, que cierra con el sub-agente `domain-reviewer` de contexto fresco sobre el diff (N+1, dinero-Decimal, soft delete, alcance).

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(inventario): feature de recuento físico + estado y producto"
```

---

## Self-review

**Cobertura de la spec:**

| Sección de la spec | Tarea |
|---|---|
| §2.1 solo modo `cantidad` | 3 (validación al crear la línea) |
| §2.2 sesión con ciclo de vida | 3, 4, 5 |
| §2.3 catálogo propio, causa como atributo | 2, 5 |
| §2.4 causa default + override por línea | 4 (carga), 5 (resolución) |
| §2.5 / §4 delta, no absoluto | 5 (Step 4 y el e2e del Step 6) |
| §2.6 `entrada`/`salida`, no `ajuste` | 5 |
| §2.7 / §6 solo `unwrap()` se centraliza | 1 |
| §3 modelo de datos | 2 (catálogo), 3 (recuento + columna del kardex) |
| §5 flujo y API | 3 (crear/listar/ver), 4 (cargar/editar/cancelar), 5 (aplicar) |
| §7 casos borde | 3 (modo, tipo de item), 4 (estados, negativo), 5 (sin contar, delta 0, causa faltante, item eliminado, stock negativo) |
| §8 frontend | 6 |
| §10 testing | en cada tarea + gate en 7 |
| §11 documentación | 1, 5, 7 |

**Nota de ejecución:** el caso borde "dos sesiones en borrador con el mismo producto" (§7) no lleva test propio: sale por construcción de que cada línea congela su propio `stock_sistema` y el delta se aplica sobre el stock vigente. Si al implementar aparece que no es así, agregar el test.
