# Mermas tipificadas y valorizadas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar mermas de insumos con causa tipificada por tenant, congelar el costo en el kardex y exponer el valorizado (`cantidad × costo_unitario`) en listados y UX dedicada, sin que el ajuste genérico de stock ofrezca “Merma” sin causa.

**Architecture:** Tabla `causas_merma` (por tenant, defaults `es_fijo`) + FK nullable `causa_merma_id` en `movimientos_inventario`. Módulo Nest `mermas` con CRUD de causas (admin) y `POST/GET /mermas` (operación Inventario). Reusa `InventarioService.registrarMovimiento` y `CatalogService.convertirUnidad`. La merma **nunca** actualiza `item_producto.costo_actual`.

**Tech Stack:** NestJS + TypeORM (`synchronize: true` en dev), PostgreSQL 15, Decimal.js, Jest + supertest, Nuxt 4 + Nuxt UI, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-15-mermas-valorizadas-design.md`](../specs/2026-07-15-mermas-valorizadas-design.md) — pieza 4 de 5 del cluster food-service.

## Global Constraints

- **Trabajar y commitear directamente sobre `main`.** No crear ramas ni PRs.
- **Toda aritmética de dinero/cantidades usa Decimal.js.** Nunca `number` nativo para montos.
- **Toda columna PK/FK de UUID declara `type: 'uuid'` explícito** (ADR-004).
- **Soft delete en todo:** `eliminado_el`; lecturas filtran `IS NULL`.
- **`tenant_id` siempre del token**, nunca del body.
- **Design System:** solo tokens semánticos Nuxt UI (`text-muted`, `bg-default`, `divide-default`).
- **Seed:** IDs fijos `550e8400-e29b-41d4-a716-446655440XXX`. Rango libre para esta feature: **0266–0279** (recetas usó 0256–0265).
- **Merma nunca actualiza `costo_actual`:** aunque envíen `costoUnitario` en `POST /mermas`, solo congela en el movimiento (`motivo !== 'compra'` ya lo garantiza `InventarioService`; no tocar esa regla).
- **Selects de lectura** usan el patrón SQL raw del proyecto (`dataSource.query` / `manager.query` con `eliminado_el IS NULL`). Mutaciones con transaction cuando haya varios writes.
- **Permisos:** causas → catálogo admin (`TenantAdminGuard` en mutaciones, como impuestos). Mermas → reutilizar módulo RBAC **Inventario** (`Leer` listado, `Crear` registro). Sin nuevo `modulo_app`.

## File Structure

**Backend — crear:**
- `backend/src/modules/mermas/entities/causa-merma.entity.ts`
- `backend/src/modules/mermas/dto/create-causa-merma.dto.ts`
- `backend/src/modules/mermas/dto/update-causa-merma.dto.ts`
- `backend/src/modules/mermas/dto/create-merma.dto.ts`
- `backend/src/modules/mermas/dto/find-mermas.dto.ts`
- `backend/src/modules/mermas/causas-merma.service.ts` + `.spec.ts`
- `backend/src/modules/mermas/mermas.service.ts` + `.spec.ts`
- `backend/src/modules/mermas/causas-merma.controller.ts`
- `backend/src/modules/mermas/mermas.controller.ts`
- `backend/src/modules/mermas/mermas.module.ts`
- `backend/test/mermas.e2e-spec.ts`

**Backend — modificar:**
- `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts` — `causaMermaId`
- `backend/src/modules/inventario/inventario.service.ts` — param + validación + INSERT + listado kardex
- `backend/src/modules/inventario/inventario.service.spec.ts`
- `backend/src/modules/items/dto/ajuste-stock.dto.ts` — quitar `'merma'`
- `backend/src/modules/items/items.service.spec.ts` — rechazo motivo merma si aplica vía DTO
- `backend/src/modules/tenants/tenants.service.ts` — sembrar 5 causas fijas al crear tenant
- `backend/src/modules/seeder/seeder.service.ts` + `seeder.module.ts` — `seedCausasMerma`
- `backend/src/app.module.ts` — entity + `MermasModule`
- `startup-pos.sql` — `causas_merma` + columna FK

**Frontend — crear/modificar:**
- Create: `frontend/app/pages/configuracion/causas-merma.vue`
- Create: `frontend/app/pages/configuracion/mermas.vue`
- Modify: `frontend/app/pages/configuracion.vue` — nav links
- Modify: `frontend/app/pages/configuracion/items.vue` — quitar Merma de `motivoOpts`
- Modify: `frontend/app/pages/configuracion/inventario.vue` — causa + costo perdido en mermas

**Docs:**
- `docs/features/mermas-valorizadas.md`, `docs/README.md`, `docs/ESTADO.md`, spec → `Status: Done`

---

### Task 1: Modelo de datos (`causas_merma` + `causa_merma_id` en kardex)

Fundación: sin esquema no hay CRUD ni registro. Deliverable: entidades registradas; con stack arriba TypeORM crea tablas.

**Files:**
- Create: `backend/src/modules/mermas/entities/causa-merma.entity.ts`
- Modify: `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `startup-pos.sql`

**Interfaces:**
- Produces: entity `CausaMerma`; columna `MovimientoInventario.causaMermaId: string | null`

- [ ] **Step 1: Entidad `CausaMerma`**

```typescript
// backend/src/modules/mermas/entities/causa-merma.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('causas_merma')
export class CausaMerma {
  @PrimaryGeneratedColumn('uuid', { name: 'causa_merma_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ name: 'es_fijo', type: 'boolean', default: false })
  esFijo: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 2: Columna en `MovimientoInventario`**

Después de `costoUnitario` en `movimiento-inventario.entity.ts`:

```typescript
  @Column({ name: 'causa_merma_id', type: 'uuid', nullable: true })
  causaMermaId: string | null;
```

- [ ] **Step 3: Registrar en `app.module.ts`**

Import y agregar `CausaMerma` al array `entities` (junto a entidades de inventario/items). Aún no registrar el módulo completo (Task 2).

- [ ] **Step 4: Documentar en `startup-pos.sql`**

Antes de `movimientos_inventario` (o justo después de tablas de items), agregar:

```sql
CREATE TABLE "causas_merma" (
  "causa_merma_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"         TEXT NOT NULL,
  "activo"         BOOLEAN NOT NULL DEFAULT true,
  "es_fijo"        BOOLEAN NOT NULL DEFAULT false,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_causas_merma_tenant_nombre"
  ON "causas_merma" ("tenant_id", lower("nombre")) WHERE "eliminado_el" IS NULL;
```

En `movimientos_inventario`, agregar columna:

```sql
  "causa_merma_id"   UUID REFERENCES "causas_merma" ("causa_merma_id"),
```

> Nota: TypeORM `synchronize` crea la tabla/columna; el índice parcial se asegura en el seed (Task 3) con `CREATE UNIQUE INDEX IF NOT EXISTS`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/mermas/entities/causa-merma.entity.ts \
  backend/src/modules/inventario/entities/movimiento-inventario.entity.ts \
  backend/src/app.module.ts startup-pos.sql
git commit -m "$(cat <<'EOF'
feat(mermas): agrega esquema causas_merma y FK en kardex

EOF
)"
```

---

### Task 2: CRUD `/causas-merma`

Deliverable: admin puede listar/crear/editar/borrar causas custom; fijas rechazan patch/delete; delete en uso rechazado.

**Files:**
- Create: DTOs, `causas-merma.service.ts`, `.spec.ts`, `causas-merma.controller.ts`, `mermas.module.ts` (solo causas por ahora)
- Modify: `app.module.ts` — import `MermasModule`

**Interfaces:**
- Produces:
  - `CausasMermaService.findAll(tenantId, opts?: { soloActivas?: boolean }): Promise<CausaMermaListItem[]>`
  - `create(tenantId, dto): Promise<{ id }>`
  - `update(tenantId, id, dto): Promise<{ id }>`
  - `remove(tenantId, id): Promise<void>`
  - `assertCausaActiva(manager | dataSource, tenantId, causaMermaId): Promise<{ id; nombre }>` (reusado por Task 5)
  - `CausaMermaListItem { id; nombre; activo; esFijo }`

- [ ] **Step 1: DTOs**

```typescript
// create-causa-merma.dto.ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCausaMermaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
```

```typescript
// update-causa-merma.dto.ts
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCausaMermaDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nombre?: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
```

- [ ] **Step 2: Tests fallando** (`causas-merma.service.spec.ts`)

Montar TestingModule con `getRepositoryToken(CausaMerma)`, `getDataSourceToken()`, mock `query` / `transaction`. Casos:

1. `create` inserta con `es_fijo=false` y nombre trim.
2. `create` rechaza nombre duplicado vivo (case-insensitive).
3. `update` / `remove` de `es_fijo=true` → `BadRequestException` «No se puede modificar/eliminar una causa fija del sistema».
4. `remove` con movimientos vivos (`COUNT > 0`) → BadRequest «está en uso».
5. `remove` soft-delete OK si no hay uso.

Run: `cd backend && npm test -- causas-merma.service.spec.ts`  
Expected: FAIL (service inexistente).

- [ ] **Step 3: Implementar `CausasMermaService`**

Lógica clave (SQL raw, soft delete):

```typescript
async findAll(tenantId: string, soloActivas = false) {
  const rows = await this.dataSource.query(
    `SELECT causa_merma_id, nombre, activo, es_fijo
     FROM causas_merma
     WHERE tenant_id = $1 AND eliminado_el IS NULL
       ${soloActivas ? 'AND activo = true' : ''}
     ORDER BY es_fijo DESC, nombre ASC`,
    [tenantId],
  );
  return rows.map((r) => ({
    id: r.causa_merma_id,
    nombre: r.nombre,
    activo: r.activo,
    esFijo: r.es_fijo,
  }));
}

async create(tenantId: string, dto: CreateCausaMermaDto) {
  const nombre = dto.nombre.trim();
  await this.assertNombreUnico(tenantId, nombre);
  const rows = await this.dataSource.query(
    `INSERT INTO causas_merma (tenant_id, nombre, activo, es_fijo)
     VALUES ($1,$2,$3,false) RETURNING causa_merma_id`,
    [tenantId, nombre, dto.activo ?? true],
  );
  return { id: rows[0].causa_merma_id };
}

async update(tenantId: string, id: string, dto: UpdateCausaMermaDto) {
  const causa = await this.findOneOrFail(tenantId, id);
  if (causa.es_fijo) {
    throw new BadRequestException(
      'No se puede modificar una causa fija del sistema',
    );
  }
  if (dto.nombre !== undefined) {
    await this.assertNombreUnico(tenantId, dto.nombre.trim(), id);
  }
  // UPDATE dinámico nombre/activo + actualizado_el = NOW()
  return { id };
}

async remove(tenantId: string, id: string) {
  const causa = await this.findOneOrFail(tenantId, id);
  if (causa.es_fijo) {
    throw new BadRequestException(
      'No se puede eliminar una causa fija del sistema',
    );
  }
  const uso: { cnt: string }[] = await this.dataSource.query(
    `SELECT COUNT(*)::text AS cnt FROM movimientos_inventario
     WHERE causa_merma_id = $1 AND eliminado_el IS NULL`,
    [id],
  );
  if (parseInt(uso[0].cnt, 10) > 0) {
    throw new BadRequestException(
      'No se puede eliminar: la causa está en uso en movimientos de merma',
    );
  }
  await this.dataSource.query(
    `UPDATE causas_merma SET eliminado_el = NOW(), actualizado_el = NOW()
     WHERE causa_merma_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
    [id, tenantId],
  );
}

/** Usado por MermasService dentro de transaction */
async assertCausaActiva(
  runner: { query: (sql: string, params?: unknown[]) => Promise<any> },
  tenantId: string,
  causaMermaId: string,
): Promise<{ id: string; nombre: string }> {
  const rows = await runner.query(
    `SELECT causa_merma_id, nombre FROM causas_merma
     WHERE causa_merma_id = $1 AND tenant_id = $2
       AND activo = true AND eliminado_el IS NULL`,
    [causaMermaId, tenantId],
  );
  if (!rows.length) {
    throw new BadRequestException('Causa de merma no válida o inactiva');
  }
  return { id: rows[0].causa_merma_id, nombre: rows[0].nombre };
}
```

`assertNombreUnico`: `SELECT 1 WHERE tenant_id=$1 AND lower(nombre)=lower($2) AND eliminado_el IS NULL` (+ `AND causa_merma_id <> $3` en update).

- [ ] **Step 4: Controller + module**

```typescript
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('causas-merma')
export class CausasMermaController {
  constructor(private readonly service: CausasMermaService) {}

  @Get()
  findAll(@Req() req: Request, @Query('soloActivas') soloActivas?: string) {
    const user = req.user as { tenantId: string };
    return this.service.findAll(user.tenantId, soloActivas === 'true');
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateCausaMermaDto) {
    const user = req.user as { tenantId: string };
    return this.service.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateCausaMermaDto) {
    const user = req.user as { tenantId: string };
    return this.service.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.service.remove(user.tenantId, id);
  }
}
```

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([CausaMerma]),
    InventarioModule,
    CatalogModule,
  ],
  controllers: [CausasMermaController],
  providers: [CausasMermaService],
  exports: [CausasMermaService],
})
export class MermasModule {}
```

Registrar `MermasModule` en `app.module.ts` `imports`.

- [ ] **Step 5: Correr tests**

`cd backend && npm test -- causas-merma.service.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/mermas backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(mermas): CRUD de causas de merma por tenant

EOF
)"
```

---

### Task 3: Seed de causas fijas (crear tenant + seeder Paris/Falabella)

Deliverable: todo tenant nuevo nace con las 5 causas; Paris/Falabella también tras `docker-compose up`.

**Files:**
- Modify: `tenants.service.ts`, `seeder.service.ts`, `seeder.module.ts`

**Constante compartida de nombres (inline en ambos sitios o exportar de un helper en el módulo mermas):**

```typescript
export const CAUSAS_MERMA_FIJAS = [
  'Vencimiento',
  'Deterioro',
  'Robo',
  'Error operativo',
  'Otro',
] as const;
```

Preferible: `backend/src/modules/mermas/causas-merma.defaults.ts` y usarlo desde tenants + seeder.

- [ ] **Step 1: Helper + seed al crear tenant**

En `tenants.service.ts` `create()`, dentro de la misma transaction, después de la caja virtual:

```typescript
for (const nombre of CAUSAS_MERMA_FIJAS) {
  await manager.query(
    `INSERT INTO causas_merma (tenant_id, nombre, activo, es_fijo)
     VALUES ($1, $2, true, true)`,
    [savedTenant.id, nombre],
  );
}
```

- [ ] **Step 2: `seedCausasMerma` en seeder**

IDs Paris `0266–0270`, Falabella `0271–0275`. Idempotente por `causa_merma_id`.

```typescript
private async seedCausasMerma(): Promise<void> {
  const PARIS = '550e8400-e29b-41d4-a716-446655440007';
  const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
  const uuid = (n: number) =>
    `550e8400-e29b-41d4-a716-44665544${String(n).padStart(4, '0')}`;
  const nombres = [...CAUSAS_MERMA_FIJAS];

  await this.dataSource.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_causas_merma_tenant_nombre
    ON causas_merma (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
  `);

  let id = 266;
  for (const tenantId of [PARIS, FALABELLA]) {
    for (const nombre of nombres) {
      const causaId = uuid(id++);
      const exists = await this.dataSource.query(
        `SELECT 1 FROM causas_merma WHERE causa_merma_id = $1`,
        [causaId],
      );
      if (!exists.length) {
        await this.dataSource.query(
          `INSERT INTO causas_merma
             (causa_merma_id, tenant_id, nombre, activo, es_fijo)
           VALUES ($1,$2,$3,true,true)`,
          [causaId, tenantId, nombre],
        );
      }
    }
  }
}
```

Llamar desde `onApplicationBootstrap` después de `seedTenants()` (y antes de items si hace falta). Registrar `CausaMerma` en `seeder.module.ts` `forFeature` si el seeder usa el repo; si solo usa `dataSource.query`, no hace falta.

- [ ] **Step 3: Verificar manualmente** (opcional con stack up)

Tras reiniciar backend, en replica/DB:

```sql
SELECT nombre, es_fijo FROM causas_merma
WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440007' AND eliminado_el IS NULL
ORDER BY nombre;
```

Expected: 5 filas fijas.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/mermas/causas-merma.defaults.ts \
  backend/src/modules/tenants/tenants.service.ts \
  backend/src/modules/seeder/seeder.service.ts \
  backend/src/modules/seeder/seeder.module.ts
git commit -m "$(cat <<'EOF'
feat(mermas): siembra causas fijas al crear tenant y en seed

EOF
)"
```

---

### Task 4: Endurecer kardex + quitar `merma` del ajuste genérico

Deliverable: `motivo=merma` exige `causaMermaId`; ajuste stock ya no acepta `merma`.

**Files:**
- Modify: `inventario.service.ts`, `inventario.service.spec.ts`
- Modify: `ajuste-stock.dto.ts`
- Modify: tests items si hacen assert sobre MOTIVOS

**Interfaces:**
- Consumes: —
- Produces: `RegistrarMovimientoParams.causaMermaId?: string | null`; `MovimientoListItem.causaMermaId`, `causaNombre`, `costoPerdido`

- [ ] **Step 1: Tests inventario**

Agregar casos en `inventario.service.spec.ts`:

1. `registrarMovimiento` con `motivo: 'merma'` sin `causaMermaId` → BadRequest «La merma requiere una causa tipificada».
2. `motivo: 'ajuste_manual'` con `causaMermaId` → BadRequest «causa_merma_id solo aplica a merma».
3. `motivo: 'merma'` + `causaMermaId` incluye la columna en el INSERT (assert `query` llamada con SQL que contiene `causa_merma_id`).

Run → FAIL primero, luego implementar.

- [ ] **Step 2: Cambios en `RegistrarMovimientoParams` + `registrarMovimiento`**

Al inicio del método, después de validar cantidad:

```typescript
if (params.motivo === 'merma' && !params.causaMermaId) {
  throw new BadRequestException(
    'La merma requiere una causa tipificada',
  );
}
if (params.motivo !== 'merma' && params.causaMermaId) {
  throw new BadRequestException(
    'causa_merma_id solo aplica a merma',
  );
}
```

Actualizar INSERT:

```sql
INSERT INTO movimientos_inventario
  (tenant_id, item_id, tipo, motivo, cantidad,
   stock_anterior, stock_resultante, venta_id, usuario_id, comentario,
   costo_unitario, causa_merma_id)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING movimiento_id
```

Pasar `params.causaMermaId ?? null`.

- [ ] **Step 3: Ampliar `findMovimientos` para causa + costo perdido**

En el SELECT del listado:

```sql
mv.causa_merma_id,
cm.nombre AS causa_nombre,
...
LEFT JOIN causas_merma cm
  ON cm.causa_merma_id = mv.causa_merma_id AND cm.eliminado_el IS NULL
```

En `mapMovimientoRow`:

```typescript
causaMermaId: r.causa_merma_id,
causaNombre: r.causa_nombre,
costoPerdido:
  r.motivo === 'merma' && r.costo_unitario != null
    ? new Decimal(r.cantidad).mul(r.costo_unitario).toFixed(4)
    : null,
```

Extender interfaces `MovimientoListItem` / `MovimientoRow`.

- [ ] **Step 4: Quitar `'merma'` de `AjusteStockDto`**

```typescript
const MOTIVOS = [
  'compra',
  'devolucion',
  'ajuste_manual',
  'inventario_inicial',
];
```

(`FindMovimientosDto` **mantiene** `'merma'` para filtrar el kardex.)

- [ ] **Step 5: Tests PASS + commit**

```bash
cd backend && npm test -- inventario.service.spec.ts
git add backend/src/modules/inventario backend/src/modules/items/dto/ajuste-stock.dto.ts
git commit -m "$(cat <<'EOF'
feat(inventario): exige causa en merma y saca merma del ajuste genérico

EOF
)"
```

---

### Task 5: `POST /mermas` + `GET /mermas`

Deliverable: registro tipificado con conversión de unidad, reglas de costo, listado valorizado.

**Files:**
- Create: `create-merma.dto.ts`, `find-mermas.dto.ts`, `mermas.service.ts`, `.spec.ts`, `mermas.controller.ts`
- Modify: `mermas.module.ts` — registrar controller/service

**Interfaces:**
- Consumes: `CausasMermaService.assertCausaActiva`, `InventarioService.registrarMovimiento`, `CatalogService.convertirUnidad`
- Produces:
  - `MermasService.registrar(tenantId, usuarioId, dto): Promise<MermaResponse>`
  - `MermasService.findAll(tenantId, query): Promise<PaginatedResponse<MermaListItem>>`
  - `MermaResponse { movimientoId; stockResultante; costoUnitario; costoPerdido; causaNombre }`
  - `MermaListItem { id; itemId; itemNombre; cantidad; costoUnitario; costoPerdido; causaMermaId; causaNombre; comentario; creadoEl; usuarioNombre }`

- [ ] **Step 1: DTOs**

```typescript
// create-merma.dto.ts
export class CreateMermaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  @IsString()
  @IsOptional()
  unidadCodigo?: string;

  @IsUUID()
  causaMermaId: string;

  @IsString()
  @IsOptional()
  comentario?: string;

  @IsNumberString()
  @IsOptional()
  costoUnitario?: string;
}
```

```typescript
// find-mermas.dto.ts
export class FindMermasDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsUUID() causaMermaId?: string;
  @IsOptional() @IsDateString() desde?: string;
  @IsOptional() @IsDateString() hasta?: string;
}
```

- [ ] **Step 2: Tests fallando** (`mermas.service.spec.ts`)

1. Happy path: producto con `costo_actual`, sin `costoUnitario` en DTO → llama `registrarMovimiento` con `motivo:'merma'`, `tipo:'salida'`, sin forzar costo (congela vigente); response `costoPerdido = cantidad × costo`.
2. Producto sin `costo_actual` y sin `costoUnitario` → BadRequest «El producto no tiene costo actual; indica costoUnitario para valorizar esta merma».
3. Producto sin `costo_actual` + `costoUnitario` → registra; mock verifica que **no** hay `UPDATE item_producto SET costo_actual`.
4. `unidadCodigo` distinta de base → llama `convertirUnidad` y pasa cantidad convertida.
5. Causa inactiva → BadRequest vía `assertCausaActiva`.

- [ ] **Step 3: Implementar `MermasService.registrar`**

```typescript
async registrar(tenantId: string, usuarioId: string, dto: CreateMermaDto) {
  return this.dataSource.transaction(async (manager) => {
    const itemRows: {
      tipo: string;
      unidad_medida: string | null;
      modo_inventario: string | null;
      costo_actual: string | null;
      nombre: string;
    }[] = await manager.query(
      `SELECT i.tipo, i.nombre, p.unidad_medida, p.modo_inventario, p.costo_actual
       FROM items i
       LEFT JOIN item_producto p ON p.item_id = i.item_id
       WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL
       FOR UPDATE OF i`,
      [dto.itemId, tenantId],
    );
    if (!itemRows.length) throw new NotFoundException('Item no encontrado');
    if (itemRows[0].tipo !== 'producto') {
      throw new BadRequestException('Solo se puede mermar un producto');
    }

    const causa = await this.causasService.assertCausaActiva(
      manager,
      tenantId,
      dto.causaMermaId,
    );

    let cantidad = new Decimal(dto.cantidad);
    if (cantidad.lessThanOrEqualTo(0) || cantidad.isNaN()) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }
    let cantidadStr = cantidad.toString();

    const unidadBase = itemRows[0].unidad_medida ?? 'unidad';
    if (dto.unidadCodigo && dto.unidadCodigo !== unidadBase) {
      if (itemRows[0].modo_inventario !== 'cantidad') {
        throw new BadRequestException(
          'Los productos por serie o lote solo admiten su unidad base',
        );
      }
      cantidadStr = await this.catalogService.convertirUnidad(
        cantidadStr,
        dto.unidadCodigo,
        unidadBase,
      );
    }

    const costoActual = itemRows[0].costo_actual;
    let costoUnitarioParam: string | null | undefined = dto.costoUnitario ?? null;
    if (costoActual == null && (dto.costoUnitario == null || dto.costoUnitario === '')) {
      throw new BadRequestException(
        'El producto no tiene costo actual; indica costoUnitario para valorizar esta merma',
      );
    }
    if (dto.costoUnitario != null && dto.costoUnitario !== '') {
      const c = new Decimal(dto.costoUnitario);
      if (c.isNaN() || c.lessThanOrEqualTo(0)) {
        throw new BadRequestException('El costo unitario debe ser mayor a 0');
      }
      costoUnitarioParam = c.toString();
    } else {
      costoUnitarioParam = undefined; // congela vigente en InventarioService
    }

    const mov = await this.inventarioService.registrarMovimiento(manager, {
      tenantId,
      itemId: dto.itemId,
      usuarioId,
      tipo: 'salida',
      motivo: 'merma',
      cantidad: cantidadStr,
      comentario: dto.comentario ?? null,
      causaMermaId: dto.causaMermaId,
      costoUnitario: costoUnitarioParam,
    });

    const costoCongelado =
      costoUnitarioParam ?? costoActual!;
    const costoPerdido = new Decimal(cantidadStr)
      .mul(costoCongelado)
      .toFixed(4);

    return {
      movimientoId: mov.movimientoId,
      stockResultante: mov.stockResultante,
      costoUnitario: costoCongelado,
      costoPerdido,
      causaNombre: causa.nombre,
    };
  });
}
```

> Tras `registrarMovimiento`, el costo congelado real puede venir del param o del vigente. Si `costoUnitarioParam` es `undefined`, usar `costoActual` leído antes (ya validado no-null en ese branch).

- [ ] **Step 4: `findAll`**

Filtro `mv.motivo = 'merma' AND mv.tenant_id = $1` + filtros opcionales; JOIN item + causa + usuario; mapear `costoPerdido` igual que Task 4.

- [ ] **Step 5: Controller**

```typescript
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('mermas')
export class MermasController {
  constructor(private readonly mermasService: MermasService) {}

  @Get()
  @RequiresPermiso('Inventario', 'Leer')
  findAll(@Req() req: Request, @Query() query: FindMermasDto) {
    const user = req.user as { tenantId: string };
    return this.mermasService.findAll(user.tenantId, query);
  }

  @Post()
  @RequiresPermiso('Inventario', 'Crear')
  create(@Req() req: Request, @Body() dto: CreateMermaDto) {
    const user = req.user as { tenantId: string; id: string };
    return this.mermasService.registrar(user.tenantId, user.id, dto);
  }
}
```

Inyectar `InventarioService`, `CatalogService`, `CausasMermaService` en `MermasService`. Exportar providers en el module.

- [ ] **Step 6: Tests PASS + commit**

```bash
cd backend && npm test -- mermas.service.spec.ts
git add backend/src/modules/mermas
git commit -m "$(cat <<'EOF'
feat(mermas): registra y lista mermas tipificadas valorizadas

EOF
)"
```

---

### Task 6: E2E `mermas.e2e-spec.ts`

Deliverable: flujo causa custom → merma → listado con `costoPerdido` → ajuste con `merma` = 400.

**Files:**
- Create: `backend/test/mermas.e2e-spec.ts`

Seguir patrón de `backend/test/recetas.e2e-spec.ts` (login Paris admin, abrir caja solo si el test lo necesita — mermas **no** requieren caja).

- [ ] **Step 1: Escenarios**

1. `GET /causas-merma` → ≥ 5 fijas.
2. `POST /causas-merma` `{ nombre: 'Rotura envase' }` → 201.
3. Crear producto de prueba con stock y `costo` (vía `POST /items`) **o** usar carne molida seed `...0257` si existe.
4. `POST /mermas` con causa fija Vencimiento + cantidad → 201, body con `costoPerdido`.
5. `GET /mermas` → incluye fila con `causaNombre` y `costoPerdido`.
6. `POST /items/:id/ajuste-stock` con `{ motivo: 'merma', ... }` → 400 (validación DTO).
7. `PATCH` causa fija → 400; `DELETE` causa en uso → 400.

- [ ] **Step 2: Run**

```bash
cd backend && npm run test:e2e -- mermas.e2e-spec.ts
```

Expected: PASS (stack DB disponible).

- [ ] **Step 3: Commit**

```bash
git add backend/test/mermas.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(mermas): E2E de causas, registro y rechazo en ajuste

EOF
)"
```

---

### Task 7: Frontend — causas de merma + nav

Deliverable: página CRUD en configuración; fijas con badge y sin editar/borrar.

**Files:**
- Create: `frontend/app/pages/configuracion/causas-merma.vue`
- Modify: `frontend/app/pages/configuracion.vue`

Baseline UI: `configuracion/categorias.vue` / `roles/index.vue` (badge `esFijo`).

- [ ] **Step 1: Nav**

En `configuracion.vue`, junto a Inventario (visible si `esAdmin`):

```typescript
if (permissionsStore.esAdmin) {
  items.push({
    label: 'Causas de merma',
    icon: 'i-lucide-tags',
    to: '/configuracion/causas-merma',
  })
}
```

Y para operación (Inventario Leer):

```typescript
if (permissionsStore.esAdmin || permissionsStore.can('Inventario', 'Leer')) {
  items.push({
    label: 'Mermas',
    icon: 'i-lucide-trash-2',
    to: '/configuracion/mermas',
  })
}
```

(La página mermas se crea en Task 8; el link puede añadirse en Task 8 si preferís no 404 — o stub mínimo.)

- [ ] **Step 2: Página causas**

- Listado `GET /causas-merma`
- Drawer crear/editar (`nombre`, `activo`)
- Columnas: nombre, activo, badge «Fija» si `esFijo`
- Acciones editar/eliminar solo si `!esFijo`
- Tokens semánticos; `CrudPageHeader` + `CrudTable` + `AppDrawer`

- [ ] **Step 3: Commit**

```bash
git add frontend/app/pages/configuracion/causas-merma.vue frontend/app/pages/configuracion.vue
git commit -m "$(cat <<'EOF'
feat(frontend): CRUD de causas de merma en configuración

EOF
)"
```

---

### Task 8: Frontend — registrar/listar mermas + kardex + quitar Merma del ajuste

Deliverable: operación completa + UX de costo sin `costo_actual` + kardex muestra causa/costo.

**Files:**
- Create: `frontend/app/pages/configuracion/mermas.vue`
- Modify: `items.vue` (`motivoOpts` sin Merma)
- Modify: `inventario.vue` (columnas causa / costo perdido)

- [ ] **Step 1: Quitar Merma del ajuste en `items.vue`**

En `motivoOpts`, eliminar `{ label: 'Merma', value: 'merma' }`. Dejar filtro/lectura en kardex intacto.

- [ ] **Step 2: Página `mermas.vue`**

- Listado `usePaginatedList` → `/mermas` con filtros item / causa / fechas.
- Columnas: fecha, producto, cantidad, causa, costo unitario, **costo perdido** (`formatMonto`), comentario.
- Botón «Registrar merma» → `AppDrawer`:
  - producto (`GET /items?tipo=producto`)
  - cantidad (`UInput` `inputmode="decimal"`, string)
  - unidad (`unidadMedida` del producto + unidades compatibles del catálogo si ya existe pattern en items)
  - causa (`GET /causas-merma?soloActivas=true`)
  - comentario opcional
  - costo unitario: prefill con `costoActual` del producto seleccionado; editable
- Si producto seleccionado tiene `costoActual == null`:
  1. Abrir `UModal` informativo (lectura obligatoria confirmar):
     > «Este producto no tiene costo actual. El monto que indiques valoriza solo esta merma y no actualiza el costo del producto.»
  2. Campo costo unitario requerido antes de enviar.
- `POST /mermas` → toast success con `costoPerdido` formateado → refresh list.

- [ ] **Step 3: Kardex `inventario.vue`**

Extender interfaz `Movimiento`:

```typescript
causaNombre?: string | null
costoUnitario?: string | null
costoPerdido?: string | null
```

- En celda motivo: si `motivo === 'merma' && causaNombre`, mostrar `Merma · ${causaNombre}`.
- Columna opcional «Costo perdido»: `formatMonto(costoPerdido)` solo si hay valor; si no `—`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/configuracion/mermas.vue \
  frontend/app/pages/configuracion/items.vue \
  frontend/app/pages/configuracion/inventario.vue \
  frontend/app/pages/configuracion.vue
git commit -m "$(cat <<'EOF'
feat(frontend): operación de mermas valorizadas y kardex tipificado

EOF
)"
```

---

### Task 9: Docs vivas + spec Done

**Files:**
- Create: `docs/features/mermas-valorizadas.md` (desde `TEMPLATE.md`)
- Modify: `docs/README.md`, `docs/ESTADO.md`
- Modify: spec → `Status: Done`

- [ ] **Step 1: Feature doc** — overview, endpoints `/causas-merma` y `/mermas`, reglas de costo, fuera de alcance.
- [ ] **Step 2: ESTADO** — fila «Mermas tipificadas y valorizadas | ✅ Implementado (2026-07-15)»
- [ ] **Step 3: README** — link al feature doc
- [ ] **Step 4: Spec status Done**
- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs(mermas): feature, estado y cierra spec pieza 4

EOF
)"
```

---

## Verification (aceptación)

- [ ] Admin CRUD causas custom; no edita/borra fijas.
- [ ] `POST /mermas` descuenta stock, congela costo, response con `costoPerdido`.
- [ ] Sin `costo_actual`: UI modal + `costoUnitario` obligatorio; producto no cambia de costo.
- [ ] Listado y kardex muestran causa y valorizado.
- [ ] `AjusteStockDto` y UI de items ya no ofrecen `merma`.
- [ ] `npm test` (causas + mermas + inventario) y E2E mermas en verde.

## Decisions (plan)

| Tema | Elección |
|---|---|
| Módulo Nest | Un solo `MermasModule` (causas + mermas) |
| Permisos mermas | Reusar RBAC Inventario (sin nuevo módulo app) |
| Índice único nombre | Parcial `(tenant_id, lower(nombre))` vía SQL en seed + `startup-pos.sql` |
| Conversión | Misma ruta que `ajustarStock` (pre-`registrarMovimiento`) |

---

## Self-review (plan vs spec)

| Spec | Task |
|---|---|
| Tabla `causas_merma` + defaults fijos | 1, 2, 3 |
| FK `causa_merma_id` en kardex | 1, 4 |
| CRUD `/causas-merma` | 2, 7 |
| `POST/GET /mermas` + valorizado | 5, 8 |
| Quitar merma del ajuste | 4, 8 |
| Modal sin `costo_actual`; no pisar costo | 5, 8 |
| Seed tenant + Paris | 3 |
| Kardex causa + costo | 4, 8 |
| E2E | 6 |
| Docs | 9 |

Sin placeholders TBD. Firmas coherentes (`causaMermaId`, `costoPerdido`, `assertCausaActiva`).
