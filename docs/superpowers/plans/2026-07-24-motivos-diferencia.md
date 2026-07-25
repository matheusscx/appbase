# Motivos categorizados de diferencia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada línea del arqueo que descuadra (diferencia ≠ 0) exige un motivo categorizado; el admin gestiona el catálogo de motivos por tenant.

**Architecture:** Sub-proyecto C del refactor de arqueo, sobre A (multi-medio) y B (ciego), ambos en `main`. Un catálogo tenant-owned `motivo_diferencia_caja` (CRUD admin-only, espeja `causas-merma`) + dos columnas en `caja_arqueo_medio` (`motivo_diferencia_id`, `comentario_diferencia`). El motivo se captura **inline en el cierre normal** (bloqueante, cajero) y **post-cierre en modo ciego** (`PATCH` admin-only). Red de seguridad: sin motivos activos, la diferencia se justifica con comentario obligatorio.

**Tech Stack:** NestJS + TypeORM + PostgreSQL 15 (`synchronize` en dev/CI, sin migraciones); Nuxt 4 + Vue 3 + Pinia + Nuxt UI; Decimal.js.

**Spec:** `docs/superpowers/specs/2026-07-24-motivos-diferencia-design.md`

## Global Constraints

Toda tarea hereda estas reglas (violarlas = detenerse y reportar, no corregir):

- **`tenant_id`/`usuario_id` SIEMPRE del token JWT**, nunca del body/query/ruta.
- **Soft delete en todo**: toda `SELECT`/`UPDATE`/`INSERT` nueva filtra/respeta `eliminado_el IS NULL`.
- **Dinero con Decimal.js**: la `diferencia` (de A) es Decimal; una línea "descuadra" si `!new Decimal(diferencia).isZero()`. Nunca `number` nativo.
- **No tocar el sistema JWT, el motor de precios ni `movimientos_inventario`.** El motivo se **congela** con el arqueo y **no** altera esperado/contado/diferencia (el hecho transaccional de A/B queda intacto).
- **Autorización según el patrón del repo:** el catálogo es configuración → **`TenantAdminGuard`** para escribir, **lectura abierta** al tenant (`JwtAuthGuard`+`TenantGuard`). El `PATCH` de justificación ciega es **`TenantAdminGuard`** (admin-only). El cierre normal sigue **owner-only `MiCaja:Actualizar`** (dentro de `cerrar`, sin cambio de guard).
- **`es_fijo`** bloquea **rename y delete**, pero **permite** togglear `activo` y `requiere_comentario` (divergencia deliberada de `causas-merma`).
- **Entidad nueva** → registrarla en el array `entities` de `app.module.ts` **y** en el `forFeature` de su módulo (no hay `autoLoadEntities`).
- **`type: 'uuid'` explícito** en PK/FK (ADR-004).
- **Trabajo directo sobre `main`** (sin ramas/PR). Commits frecuentes por tarea.

---

## Estructura de archivos

**Backend — módulo nuevo `motivos-diferencia` (espeja `mermas/causas-merma.*`):**
- Create: `backend/src/modules/motivos-diferencia/entities/motivo-diferencia-caja.entity.ts`
- Create: `backend/src/modules/motivos-diferencia/motivos-diferencia.defaults.ts`
- Create: `backend/src/modules/motivos-diferencia/dto/create-motivo-diferencia.dto.ts`
- Create: `backend/src/modules/motivos-diferencia/dto/update-motivo-diferencia.dto.ts`
- Create: `backend/src/modules/motivos-diferencia/motivos-diferencia.service.ts`
- Create: `backend/src/modules/motivos-diferencia/motivos-diferencia.controller.ts`
- Create: `backend/src/modules/motivos-diferencia/motivos-diferencia.module.ts`
- Create: `backend/src/modules/motivos-diferencia/motivos-diferencia.service.spec.ts`

**Backend — cambios en caja + wiring:**
- Modify: `backend/src/app.module.ts` (registrar entidad + módulo)
- Modify: `backend/src/modules/caja/caja.module.ts` (importar `MotivosDiferenciaModule`)
- Modify: `backend/src/modules/caja/entities/caja-arqueo-medio.entity.ts` (2 columnas)
- Modify: `backend/src/modules/caja/dto/linea-cierre.dto.ts` (2 campos opcionales)
- Create: `backend/src/modules/caja/dto/justificar-diferencias.dto.ts`
- Modify: `backend/src/modules/caja/caja.service.ts` (`cerrar` enforcement; `obtenerArqueo` read; `justificarDiferencias`; `LineaArqueo`)
- Modify: `backend/src/modules/caja/caja.controller.ts` (`PATCH /:id/arqueo/motivos`)
- Modify: `backend/src/modules/seeder/seeder.service.ts` (`seedMotivosDiferencia`)
- Modify: `backend/src/modules/tenants/tenants.service.ts` (seed en `create`)
- Modify: `backend/src/modules/caja/caja.service.spec.ts`, `caja.controller.spec.ts`, `backend/test/caja.e2e-spec.ts`, `backend/test/motivos-diferencia.e2e-spec.ts` (nuevo)

**Frontend:**
- Modify: `frontend/app/stores/caja.ts` (`ArqueoLinea` + motivo; `motivos` state; `cargarMotivos`; `justificarDiferencias`; `cerrar` payload)
- Create: `frontend/app/pages/configuracion/motivos-diferencia.vue`
- Modify: nav de Configuración (donde se listan los links)
- Modify: `frontend/app/components/caja/CajaCierreDrawer.vue` (motivo por línea que descuadra, modo normal)
- Modify: `frontend/app/components/caja/CajaArqueoTable.vue` (columna Motivo + justificación admin)

**Docs:** `docs/features/gestion-cajas.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/investigaciones/2026-07-23-gestion-caja.md`, `startup-pos.sql`.

---

### Task 1: Catálogo backend — entidad + CRUD + registro

Módulo `motivos-diferencia` espejando `causas-merma`, con la divergencia `es_fijo` (permite `activo`/`requiere_comentario`) y la columna `requiere_comentario`. Sin seed todavía (Task 2). Deliverable: un admin gestiona motivos vía API; lectura abierta.

**Files:** los 8 `Create` del módulo + `Modify app.module.ts`.

**Interfaces:**
- Produces: `MotivoDiferenciaListItem { id: string; nombre: string; activo: boolean; requiereComentario: boolean; esFijo: boolean }`. `MotivosDiferenciaService.findAll(tenantId, soloActivas?) / create / update / remove`, y helpers `assertMotivoValido(runner, tenantId, motivoId): Promise<{ id: string; nombre: string; requiereComentario: boolean }>` y `hayMotivosActivos(runner, tenantId): Promise<boolean>` (consumidos por caja en Tasks 3-4).

- [ ] **Step 1: Entidad**

`backend/src/modules/motivos-diferencia/entities/motivo-diferencia-caja.entity.ts`:

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('motivo_diferencia_caja')
export class MotivoDiferenciaCaja {
  @PrimaryGeneratedColumn('uuid', { name: 'motivo_diferencia_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ name: 'requiere_comentario', type: 'boolean', default: false })
  requiereComentario: boolean;

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

- [ ] **Step 2: Defaults**

`backend/src/modules/motivos-diferencia/motivos-diferencia.defaults.ts`:

```ts
export const MOTIVOS_DIFERENCIA_DEFAULTS: {
  nombre: string;
  requiereComentario: boolean;
}[] = [
  { nombre: 'falta de efectivo', requiereComentario: false },
  { nombre: 'sobra de efectivo', requiereComentario: false },
  { nombre: 'divergencia de tarjeta', requiereComentario: false },
  { nombre: 'error de lanzamiento manual', requiereComentario: false },
  { nombre: 'pago no registrado', requiereComentario: false },
  { nombre: 'error operacional', requiereComentario: false },
  { nombre: 'otro', requiereComentario: true },
];
```

- [ ] **Step 3: DTOs**

`dto/create-motivo-diferencia.dto.ts`:

```ts
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateMotivoDiferenciaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsBoolean()
  @IsOptional()
  requiereComentario?: boolean;
}
```

`dto/update-motivo-diferencia.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMotivoDiferenciaDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  nombre?: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsBoolean()
  @IsOptional()
  requiereComentario?: boolean;
}
```

- [ ] **Step 4: Escribir los tests del service (fallan)**

`motivos-diferencia.service.spec.ts` (mock `DataSource.query`; espeja el estilo de `caja.service.spec` que ya mockea `dataSource.query`):

```ts
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { MotivosDiferenciaService } from './motivos-diferencia.service';

const TENANT = 't1';

describe('MotivosDiferenciaService', () => {
  let service: MotivosDiferenciaService;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn();
    const mod = await Test.createTestingModule({
      providers: [
        MotivosDiferenciaService,
        { provide: getDataSourceToken(), useValue: { query } },
      ],
    }).compile();
    service = mod.get(MotivosDiferenciaService);
  });

  it('findAll con soloActivas filtra activo=true', async () => {
    query.mockResolvedValueOnce([]);
    await service.findAll(TENANT, true);
    expect(query.mock.calls[0][0]).toContain('AND activo = true');
    expect(query.mock.calls[0][0]).toContain('eliminado_el IS NULL');
  });

  it('create inserta con es_fijo=false y requiere_comentario del DTO', async () => {
    query.mockResolvedValueOnce([]); // assertNombreUnico
    query.mockResolvedValueOnce([
      { motivo_diferencia_id: 'm1', nombre: 'x', activo: true, requiere_comentario: true, es_fijo: false },
    ]);
    const res = await service.create(TENANT, { nombre: 'x', requiereComentario: true });
    expect(res).toMatchObject({ id: 'm1', requiereComentario: true, esFijo: false });
    expect(query.mock.calls[1][0]).toContain('INSERT INTO motivo_diferencia_caja');
  });

  it('update de un motivo fijo BLOQUEA nombre', async () => {
    query.mockResolvedValueOnce([
      { motivo_diferencia_id: 'm1', nombre: 'otro', activo: true, requiere_comentario: true, es_fijo: true },
    ]); // findOneOrFail
    await expect(
      service.update(TENANT, 'm1', { nombre: 'nuevo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update de un motivo fijo PERMITE activo y requiere_comentario', async () => {
    query.mockResolvedValueOnce([
      { motivo_diferencia_id: 'm1', nombre: 'otro', activo: true, requiere_comentario: true, es_fijo: true },
    ]); // findOneOrFail
    query.mockResolvedValueOnce([
      { motivo_diferencia_id: 'm1', nombre: 'otro', activo: false, requiere_comentario: false, es_fijo: true },
    ]); // UPDATE RETURNING
    const res = await service.update(TENANT, 'm1', { activo: false, requiereComentario: false });
    expect(res.activo).toBe(false);
    expect(res.requiereComentario).toBe(false);
  });

  it('remove de un motivo fijo BLOQUEA', async () => {
    query.mockResolvedValueOnce([
      { motivo_diferencia_id: 'm1', nombre: 'otro', activo: true, requiere_comentario: true, es_fijo: true },
    ]); // findOneOrFail
    await expect(service.remove(TENANT, 'm1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 5: Ejecutar → fallan**

Run: `cd backend && npm test -- motivos-diferencia.service`
Expected: FAIL (`MotivosDiferenciaService` no existe).

- [ ] **Step 6: Service**

`motivos-diferencia.service.ts` (mismo estilo raw parametrizado que `causas-merma.service.ts`, con las divergencias marcadas):

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateMotivoDiferenciaDto } from './dto/create-motivo-diferencia.dto';
import { UpdateMotivoDiferenciaDto } from './dto/update-motivo-diferencia.dto';

export interface MotivoDiferenciaListItem {
  id: string;
  nombre: string;
  activo: boolean;
  requiereComentario: boolean;
  esFijo: boolean;
}

interface Row {
  motivo_diferencia_id: string;
  nombre: string;
  activo: boolean;
  requiere_comentario: boolean;
  es_fijo: boolean;
}

type Runner = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const COLS =
  'motivo_diferencia_id, nombre, activo, requiere_comentario, es_fijo';

function toItem(r: Row): MotivoDiferenciaListItem {
  return {
    id: r.motivo_diferencia_id,
    nombre: r.nombre,
    activo: r.activo,
    requiereComentario: r.requiere_comentario,
    esFijo: r.es_fijo,
  };
}

@Injectable()
export class MotivosDiferenciaService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    soloActivas = false,
  ): Promise<MotivoDiferenciaListItem[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT ${COLS} FROM motivo_diferencia_caja
       WHERE tenant_id = $1 AND eliminado_el IS NULL
         ${soloActivas ? 'AND activo = true' : ''}
       ORDER BY es_fijo DESC, nombre ASC`,
      [tenantId],
    );
    return rows.map(toItem);
  }

  async create(
    tenantId: string,
    dto: CreateMotivoDiferenciaDto,
  ): Promise<MotivoDiferenciaListItem> {
    const nombre = dto.nombre.trim();
    await this.assertNombreUnico(tenantId, nombre);
    const rows: Row[] = await this.dataSource.query(
      `INSERT INTO motivo_diferencia_caja
         (tenant_id, nombre, activo, requiere_comentario, es_fijo)
       VALUES ($1, $2, $3, $4, false)
       RETURNING ${COLS}`,
      [tenantId, nombre, dto.activo ?? true, dto.requiereComentario ?? false],
    );
    return toItem(rows[0]);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMotivoDiferenciaDto,
  ): Promise<MotivoDiferenciaListItem> {
    const motivo = await this.findOneOrFail(tenantId, id);
    // Divergencia de causas-merma: en un fijo se bloquea SOLO el rename.
    if (motivo.esFijo && dto.nombre !== undefined) {
      throw new BadRequestException(
        'No se puede renombrar un motivo fijo del sistema',
      );
    }
    if (dto.nombre !== undefined) {
      await this.assertNombreUnico(tenantId, dto.nombre.trim(), id);
    }

    const sets = ['actualizado_el = NOW()'];
    const params: unknown[] = [];
    let idx = 1;
    if (dto.nombre !== undefined) {
      sets.push(`nombre = $${idx++}`);
      params.push(dto.nombre.trim());
    }
    if (dto.activo !== undefined) {
      sets.push(`activo = $${idx++}`);
      params.push(dto.activo);
    }
    if (dto.requiereComentario !== undefined) {
      sets.push(`requiere_comentario = $${idx++}`);
      params.push(dto.requiereComentario);
    }

    params.push(id, tenantId);
    const rows: Row[] = await this.dataSource.query(
      `UPDATE motivo_diferencia_caja SET ${sets.join(', ')}
       WHERE motivo_diferencia_id = $${idx++} AND tenant_id = $${idx}
         AND eliminado_el IS NULL
       RETURNING ${COLS}`,
      params,
    );
    if (!rows.length) {
      throw new NotFoundException(`Motivo ${id} no encontrado`);
    }
    return toItem(rows[0]);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const motivo = await this.findOneOrFail(tenantId, id);
    if (motivo.esFijo) {
      throw new BadRequestException(
        'No se puede eliminar un motivo fijo del sistema',
      );
    }
    await this.dataSource.query(
      `UPDATE motivo_diferencia_caja SET eliminado_el = NOW(), actualizado_el = NOW()
       WHERE motivo_diferencia_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
  }

  /** Valida que un motivo pertenezca al tenant y esté activo (para el cierre/justificación). */
  async assertMotivoValido(
    runner: Runner,
    tenantId: string,
    motivoId: string,
  ): Promise<{ id: string; nombre: string; requiereComentario: boolean }> {
    const rows = (await runner.query(
      `SELECT motivo_diferencia_id, nombre, requiere_comentario
       FROM motivo_diferencia_caja
       WHERE motivo_diferencia_id = $1 AND tenant_id = $2
         AND activo = true AND eliminado_el IS NULL`,
      [motivoId, tenantId],
    )) as {
      motivo_diferencia_id: string;
      nombre: string;
      requiere_comentario: boolean;
    }[];
    if (!rows.length) {
      throw new BadRequestException('Motivo de diferencia no válido o inactivo');
    }
    return {
      id: rows[0].motivo_diferencia_id,
      nombre: rows[0].nombre,
      requiereComentario: rows[0].requiere_comentario,
    };
  }

  async hayMotivosActivos(runner: Runner, tenantId: string): Promise<boolean> {
    const rows = (await runner.query(
      `SELECT 1 FROM motivo_diferencia_caja
       WHERE tenant_id = $1 AND activo = true AND eliminado_el IS NULL LIMIT 1`,
      [tenantId],
    )) as unknown[];
    return rows.length > 0;
  }

  private async findOneOrFail(
    tenantId: string,
    id: string,
  ): Promise<MotivoDiferenciaListItem> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT ${COLS} FROM motivo_diferencia_caja
       WHERE motivo_diferencia_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Motivo ${id} no encontrado`);
    }
    return toItem(rows[0]);
  }

  private async assertNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const params: unknown[] = [tenantId, nombre];
    let sql = `SELECT 1 FROM motivo_diferencia_caja
      WHERE tenant_id = $1 AND lower(nombre) = lower($2) AND eliminado_el IS NULL`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND motivo_diferencia_id <> $3`;
    }
    const rows: unknown[] = await this.dataSource.query(sql, params);
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe un motivo con el nombre "${nombre}"`,
      );
    }
  }
}
```

- [ ] **Step 7: Controller**

`motivos-diferencia.controller.ts` (espeja `causas-merma.controller.ts`):

```ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { MotivosDiferenciaService } from './motivos-diferencia.service';
import { CreateMotivoDiferenciaDto } from './dto/create-motivo-diferencia.dto';
import { UpdateMotivoDiferenciaDto } from './dto/update-motivo-diferencia.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('motivos-diferencia')
export class MotivosDiferenciaController {
  constructor(private readonly service: MotivosDiferenciaService) {}

  @Get()
  findAll(@Req() req: Request, @Query('soloActivas') soloActivas?: string) {
    const user = req.user as { tenantId: string };
    return this.service.findAll(user.tenantId, soloActivas === 'true');
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateMotivoDiferenciaDto) {
    const user = req.user as { tenantId: string };
    return this.service.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateMotivoDiferenciaDto,
  ) {
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

- [ ] **Step 8: Módulo**

`motivos-diferencia.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MotivosDiferenciaService } from './motivos-diferencia.service';
import { MotivosDiferenciaController } from './motivos-diferencia.controller';

@Module({
  controllers: [MotivosDiferenciaController],
  providers: [MotivosDiferenciaService],
  exports: [MotivosDiferenciaService],
})
export class MotivosDiferenciaModule {}
```

- [ ] **Step 9: Registrar en `app.module.ts`**

Importar y agregar: `import { MotivoDiferenciaCaja } from './modules/motivos-diferencia/entities/motivo-diferencia-caja.entity';` y `import { MotivosDiferenciaModule } from './modules/motivos-diferencia/motivos-diferencia.module';`. Añadir `MotivoDiferenciaCaja,` al array `entities` (junto a `CausaMerma`, línea ~197) y `MotivosDiferenciaModule,` al array `imports` de `@Module`.

- [ ] **Step 10: Tests verdes + gate + commit**

Run: `cd backend && npm test -- motivos-diferencia.service`
Expected: PASS (5/5).
Run: `cd backend && npm run lint:check && npm run typecheck && npm test -- motivos-diferencia`
Expected: verde.

```bash
git add backend/src/modules/motivos-diferencia backend/src/app.module.ts
git commit -m "feat(motivos): catálogo CRUD de motivos de diferencia (admin-only, es_fijo togglable)"
```

---

### Task 2: Seed de los 7 motivos por defecto

Siembra en las dos rutas que usa `causas-merma`: `seeder.service` (bootstrap, tenants demo con UUID fijo) y `tenants.service.create` (tenant nuevo vía API, UUID generado por la DB).

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts` (nuevo `seedMotivosDiferencia`, llamado junto a `seedCausasMerma`)
- Modify: `backend/src/modules/tenants/tenants.service.ts:153-160` (loop de seed en `create`)

**Interfaces:**
- Consumes: `MOTIVOS_DIFERENCIA_DEFAULTS` (Task 1).

- [ ] **Step 1: `seedMotivosDiferencia` en el seeder**

En `seeder.service.ts`: importar `import { MOTIVOS_DIFERENCIA_DEFAULTS } from '../motivos-diferencia/motivos-diferencia.defaults';`. Agregar la llamada junto a `await this.seedCausasMerma();` (línea ~157): `await this.seedMotivosDiferencia();`. Agregar el método (espeja `seedCausasMerma`, bloque de UUID libre **291–304**: 7 motivos × 2 tenants):

```ts
  private async seedMotivosDiferencia(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const uuid = (n: number) =>
      `550e8400-e29b-41d4-a716-44665544${String(n).padStart(4, '0')}`;

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_motivo_diferencia_tenant_nombre
      ON motivo_diferencia_caja (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);

    let id = 291;
    for (const tenantId of [PARIS, FALABELLA]) {
      for (const m of MOTIVOS_DIFERENCIA_DEFAULTS) {
        const motivoId = uuid(id++);
        const exists: unknown[] = await this.dataSource.query(
          `SELECT 1 FROM motivo_diferencia_caja WHERE motivo_diferencia_id = $1`,
          [motivoId],
        );
        if (!exists.length) {
          await this.dataSource.query(
            `INSERT INTO motivo_diferencia_caja
               (motivo_diferencia_id, tenant_id, nombre, activo, requiere_comentario, es_fijo)
             VALUES ($1, $2, $3, true, $4, true)`,
            [motivoId, tenantId, m.nombre, m.requiereComentario],
          );
        }
      }
    }
  }
```

- [ ] **Step 2: Seed en `tenants.service.create`**

En `tenants.service.ts`, tras el loop de `CAUSAS_MERMA_FIJAS` (línea ~160), agregar (importar `MOTIVOS_DIFERENCIA_DEFAULTS`):

```ts
      // 7b. Sembrar los motivos de diferencia por defecto del sistema
      for (const m of MOTIVOS_DIFERENCIA_DEFAULTS) {
        await manager.query(
          `INSERT INTO motivo_diferencia_caja
             (tenant_id, nombre, activo, requiere_comentario, es_fijo)
           VALUES ($1, $2, true, $3, true)`,
          [savedTenant.id, m.nombre, m.requiereComentario],
        );
      }
```

- [ ] **Step 3: Verificar por arranque real**

Run: `cd backend && npm run lint:check && npm run typecheck && npm test -- tenants`
Expected: verde (los tests de tenants no deben romper).

(La siembra real se valida en el e2e de Task 5 y el smoke; el seeder corre al arrancar el stack.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/seeder/seeder.service.ts backend/src/modules/tenants/tenants.service.ts
git commit -m "feat(motivos): seed de los 7 motivos por defecto (seeder + creación de tenant)"
```

---

### Task 3: `caja_arqueo_medio` columns + enforcement del cierre normal

Agrega las 2 columnas y hace que `cerrar` exija/congele motivo+comentario por cada línea con diferencia ≠ 0. Inyecta `MotivosDiferenciaService` en `CajaService`.

**Files:**
- Modify: `caja/entities/caja-arqueo-medio.entity.ts` (2 columnas)
- Modify: `caja/dto/linea-cierre.dto.ts` (2 campos)
- Modify: `caja/caja.module.ts` (importar `MotivosDiferenciaModule`)
- Modify: `caja/caja.service.ts` (constructor + `cerrar`)
- Test: `caja/caja.service.spec.ts`

**Interfaces:**
- Consumes: `MotivosDiferenciaService.assertMotivoValido(manager, tenantId, motivoId)`, `.hayMotivosActivos(manager, tenantId)` (Task 1).
- Produces: `cerrar` congela `motivo_diferencia_id` + `comentario_diferencia` en las líneas que descuadran.

- [ ] **Step 1: Columnas en la entidad**

En `caja-arqueo-medio.entity.ts`, tras `diferencia` (línea 42):

```ts
  @Column({ name: 'motivo_diferencia_id', type: 'uuid', nullable: true })
  motivoDiferenciaId: string | null;

  @Column({ name: 'comentario_diferencia', type: 'text', nullable: true })
  comentarioDiferencia: string | null;
```

- [ ] **Step 2: Campos en `LineaCierreDto`**

En `linea-cierre.dto.ts`, agregar (importar `IsOptional`, `IsString`, `MaxLength`):

```ts
  @IsOptional()
  @IsUUID('4')
  motivoDiferenciaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentarioDiferencia?: string;
```

- [ ] **Step 3: Wiring del módulo**

En `caja.module.ts`, importar `MotivosDiferenciaModule` y agregarlo al array `imports`.

- [ ] **Step 4: Escribir los tests de `cerrar` (fallan)**

En `caja.service.spec.ts`, dentro de `describe('cerrar', ...)`, agregar (el mock ya tiene `managerMock` y `dataSource`; agregar el provider de `MotivosDiferenciaService` al `TestingModule` con `assertMotivoValido`/`hayMotivosActivos` mockeados). Casos:

```ts
    it('400 si una línea descuadra y NO trae motivo (habiendo motivos activos)', async () => {
      // arqueo: efectivo esperado 1000, contado 900 → diferencia -100
      jest.spyOn(service, 'calcularArqueo').mockResolvedValueOnce([
        { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, esperado: '1000.0000', requiereConteo: true },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, usuarioId: USUARIO_ID });
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, {
          lineas: [{ metodoPagoId: null, montoContado: '900' }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si el motivo requiere_comentario y no viene comentario', async () => {
      jest.spyOn(service, 'calcularArqueo').mockResolvedValueOnce([
        { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, esperado: '1000.0000', requiereConteo: true },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      motivosService.assertMotivoValido.mockResolvedValueOnce({ id: 'm-otro', nombre: 'otro', requiereComentario: true });
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, usuarioId: USUARIO_ID });
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, {
          lineas: [{ metodoPagoId: null, montoContado: '900', motivoDiferenciaId: 'm-otro' }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('red de seguridad: sin motivos activos, 400 sin comentario', async () => {
      jest.spyOn(service, 'calcularArqueo').mockResolvedValueOnce([
        { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, esperado: '1000.0000', requiereConteo: true },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(false);
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, usuarioId: USUARIO_ID });
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, {
          lineas: [{ metodoPagoId: null, montoContado: '900' }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('congela motivo+comentario cuando la línea descuadra y trae motivo válido', async () => {
      jest.spyOn(service, 'calcularArqueo').mockResolvedValueOnce([
        { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, esperado: '1000.0000', requiereConteo: true },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      motivosService.assertMotivoValido.mockResolvedValueOnce({ id: 'm1', nombre: 'falta de efectivo', requiereComentario: false });
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, usuarioId: USUARIO_ID });
      await service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, {
        lineas: [{ metodoPagoId: null, montoContado: '900', motivoDiferenciaId: 'm1' }],
      } as any);
      const saved = managerMock.save.mock.calls.find((c) => Array.isArray(c[1]))?.[1];
      expect(saved[0]).toMatchObject({ motivoDiferenciaId: 'm1', diferencia: '-100.0000' });
    });

    it('línea que cuadra (diferencia 0) NO exige motivo', async () => {
      jest.spyOn(service, 'calcularArqueo').mockResolvedValueOnce([
        { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, esperado: '1000.0000', requiereConteo: true },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, usuarioId: USUARIO_ID });
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, {
          lineas: [{ metodoPagoId: null, montoContado: '1000' }],
        } as any),
      ).resolves.toBeDefined();
    });
```

Añadir al setup del `TestingModule` de `caja.service.spec`: `const motivosService = { assertMotivoValido: jest.fn(), hayMotivosActivos: jest.fn() };` y el provider `{ provide: MotivosDiferenciaService, useValue: motivosService }`.

- [ ] **Step 5: Ejecutar → fallan**

Run: `cd backend && npm test -- caja.service`
Expected: FAIL (cerrar aún no valida motivos; falta el provider).

- [ ] **Step 6: Inyectar el service + enforcement en `cerrar`**

En `caja.service.ts`: importar `MotivosDiferenciaService` y agregarlo al constructor (`private readonly motivosService: MotivosDiferenciaService`). En `cerrar`, **reemplazar de una sola vez las líneas 493-524** (el build de `contadoPorClave`, el chequeo de claves ajenas, y el `lineasResueltas`) por el bloque de abajo — construye los tres mapas (contado/motivo/comentario) UNA vez, conserva el chequeo de claves ajenas al arqueo tal cual está hoy, calcula `hayMotivos`, y reescribe `lineasResueltas`. No dejar el build viejo de `contadoPorClave` (quedaría duplicado):

```ts
      // Contado + motivo + comentario declarados, por clave de línea.
      const contadoPorClave = new Map<string, string>();
      const motivoPorClave = new Map<string, string | undefined>();
      const comentarioPorClave = new Map<string, string | undefined>();
      for (const linea of dto.lineas) {
        const clave = claveDe(linea.metodoPagoId);
        contadoPorClave.set(clave, linea.montoContado);
        motivoPorClave.set(clave, linea.motivoDiferenciaId);
        comentarioPorClave.set(clave, linea.comentarioDiferencia);
      }

      // ... (el chequeo de claves ajenas al arqueo queda igual) ...

      const hayMotivos = await this.motivosService.hayMotivosActivos(
        manager,
        tenantId,
      );

      // Resolver contado/diferencia + validar obligatorias + justificación.
      const lineasResueltas = await Promise.all(
        arqueo.map(async (l) => {
          const clave = claveDe(l.metodoPagoId);
          const contadoRaw = contadoPorClave.get(clave);
          const obligatoria = l.esEfectivo || l.requiereConteo;
          if (obligatoria && contadoRaw === undefined) {
            throw new BadRequestException(`Falta el conteo de ${l.nombre}`);
          }
          const contado =
            contadoRaw === undefined ? null : new Decimal(contadoRaw).toFixed(4);
          const diferencia =
            contado === null
              ? null
              : new Decimal(contado).minus(l.esperado!).toFixed(4);

          let motivoDiferenciaId: string | null = null;
          let comentarioDiferencia: string | null = null;
          if (diferencia !== null && !new Decimal(diferencia).isZero()) {
            const motivoId = motivoPorClave.get(clave);
            const comentario = comentarioPorClave.get(clave)?.trim() || null;
            if (hayMotivos) {
              if (!motivoId) {
                throw new BadRequestException(
                  `Falta el motivo de la diferencia de ${l.nombre}`,
                );
              }
              const motivo = await this.motivosService.assertMotivoValido(
                manager,
                tenantId,
                motivoId,
              );
              if (motivo.requiereComentario && !comentario) {
                throw new BadRequestException(
                  `El motivo "${motivo.nombre}" exige un comentario`,
                );
              }
              motivoDiferenciaId = motivo.id;
              comentarioDiferencia = comentario;
            } else {
              // Red de seguridad: sin motivos activos, comentario obligatorio.
              if (!comentario) {
                throw new BadRequestException(
                  `Falta justificar la diferencia de ${l.nombre}`,
                );
              }
              comentarioDiferencia = comentario;
            }
          }
          return { ...l, contado, diferencia, motivoDiferenciaId, comentarioDiferencia };
        }),
      );
```

En el `manager.save(CajaArqueoMedio, ...)` (líneas 527-540), agregar al `manager.create`:
```ts
            motivoDiferenciaId: l.motivoDiferenciaId,
            comentarioDiferencia: l.comentarioDiferencia,
```

- [ ] **Step 7: Ejecutar → pasan + gate**

Run: `cd backend && npm test -- caja.service`
Expected: PASS.
Run: `cd backend && npm run lint:check && npm run typecheck && npm test -- caja`
Expected: verde.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/caja/entities/caja-arqueo-medio.entity.ts \
        backend/src/modules/caja/dto/linea-cierre.dto.ts \
        backend/src/modules/caja/caja.module.ts \
        backend/src/modules/caja/caja.service.ts \
        backend/src/modules/caja/caja.service.spec.ts
git commit -m "feat(caja): cierre normal exige y congela motivo por línea que descuadra"
```

---

### Task 4: Lectura del motivo en `obtenerArqueo` + `PATCH` de justificación ciega (admin-only)

`obtenerArqueo` (caja cerrada) devuelve el motivo (nombre + comentario) por línea; nuevo `PATCH /caja/:id/arqueo/motivos` (admin-only) justifica una caja cerrada.

**Files:**
- Modify: `caja/caja.service.ts` (`LineaArqueo`; query congelada de `obtenerArqueo`; `justificarDiferencias`)
- Create: `caja/dto/justificar-diferencias.dto.ts`
- Modify: `caja/caja.controller.ts` (`PATCH /:id/arqueo/motivos` con `TenantAdminGuard`)
- Test: `caja.service.spec.ts`, `caja.controller.spec.ts`

**Interfaces:**
- Consumes: `assertMotivoValido`, `hayMotivosActivos` (Task 1).
- Produces: `LineaArqueo` gana `motivoDiferenciaId?: string | null`, `motivoNombre?: string | null`, `comentarioDiferencia?: string | null`. `justificarDiferencias(tenantId, cajaId, lineas): Promise<{ ciego: boolean; lineas: LineaArqueo[] }>`.

- [ ] **Step 1: `LineaArqueo` gana los campos de motivo**

En `caja.service.ts`, interfaz `LineaArqueo` (línea 65-73), agregar:
```ts
  motivoDiferenciaId?: string | null;
  motivoNombre?: string | null;
  comentarioDiferencia?: string | null;
```

- [ ] **Step 2: La query congelada devuelve el motivo**

En `obtenerArqueo`, en la rama de caja cerrada (query de líneas 431-449), agregar el JOIN + columnas y mapearlas:

```sql
              md.nombre AS motivo_nombre,
              am.motivo_diferencia_id,
              am.comentario_diferencia
       FROM caja_arqueo_medio am
       LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = am.metodo_pago_id
       LEFT JOIN motivo_diferencia_caja md
              ON md.motivo_diferencia_id = am.motivo_diferencia_id
             AND md.eliminado_el IS NULL
       LEFT JOIN tenant_metodo_pago tmp ...
```
(añadir `motivo_nombre`, `motivo_diferencia_id`, `comentario_diferencia` a los tipos de fila y al `.map`, con `motivoDiferenciaId: r.motivo_diferencia_id ?? null`, `motivoNombre: r.motivo_nombre ?? null`, `comentarioDiferencia: r.comentario_diferencia ?? null`.)

- [ ] **Step 3: DTO del PATCH**

`caja/dto/justificar-diferencias.dto.ts`:

```ts
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LineaJustificacionDto {
  @ValidateIf((_o, v) => v !== null)
  @IsUUID('4')
  metodoPagoId: string | null;

  @IsOptional()
  @IsUUID('4')
  motivoDiferenciaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentarioDiferencia?: string;
}

export class JustificarDiferenciasDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaJustificacionDto)
  lineas: LineaJustificacionDto[];
}
```

- [ ] **Step 4: Escribir los tests (fallan)**

En `caja.service.spec.ts`, `describe('justificarDiferencias', ...)`:

```ts
  describe('justificarDiferencias', () => {
    it('actualiza el motivo de una línea congelada que descuadra', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'cerrada' });
      // línea congelada con diferencia ≠ 0
      dataSource.query.mockResolvedValueOnce([
        { metodo_pago_id: null, esperado: '1000.0000', contado: '900.0000', diferencia: '-100.0000' },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      motivosService.assertMotivoValido.mockResolvedValueOnce({ id: 'm1', nombre: 'falta de efectivo', requiereComentario: false });
      dataSource.query.mockResolvedValueOnce(undefined); // UPDATE
      // obtenerArqueo de relectura:
      cajaRepo.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'cerrada' });
      dataSource.query.mockResolvedValueOnce([]);

      await expect(
        service.justificarDiferencias(TENANT_ID, CAJA_ID, [
          { metodoPagoId: null, motivoDiferenciaId: 'm1' },
        ]),
      ).resolves.toBeDefined();
    });

    it('400 si la caja no está cerrada', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'abierta' });
      await expect(
        service.justificarDiferencias(TENANT_ID, CAJA_ID, []),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
```

En `caja.controller.spec.ts`, agregar `justificarDiferencias: jest.fn()` al mock del service y un test de delegación con el `tenantId` del token.

- [ ] **Step 5: Ejecutar → fallan**

Run: `cd backend && npm test -- caja.service caja.controller`
Expected: FAIL.

- [ ] **Step 6: Implementar `justificarDiferencias`**

En `caja.service.ts` (nuevo método):

```ts
  async justificarDiferencias(
    tenantId: string,
    cajaId: string,
    lineas: {
      metodoPagoId: string | null;
      motivoDiferenciaId?: string;
      comentarioDiferencia?: string;
    }[],
  ): Promise<{ ciego: boolean; lineas: LineaArqueo[] }> {
    await this.dataSource.transaction(async (manager) => {
      const caja = await manager.findOne(Caja, {
        where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
      });
      if (!caja) throw new NotFoundException('Caja no encontrada');
      if (caja.estado !== 'cerrada') {
        throw new BadRequestException('La caja no está cerrada');
      }

      const filas: {
        metodo_pago_id: string | null;
        diferencia: string | null;
      }[] = await manager.query(
        `SELECT metodo_pago_id, diferencia FROM caja_arqueo_medio
         WHERE caja_id = $1 AND eliminado_el IS NULL`,
        [cajaId],
      );
      const claveDe = (id: string | null) => id ?? 'EFECTIVO';
      const difPorClave = new Map(
        filas.map((f) => [claveDe(f.metodo_pago_id), f.diferencia]),
      );
      const hayMotivos = await this.motivosService.hayMotivosActivos(
        manager,
        tenantId,
      );

      for (const l of lineas) {
        const clave = claveDe(l.metodoPagoId);
        const dif = difPorClave.get(clave);
        if (dif == null || new Decimal(dif).isZero()) continue; // solo descuadres
        const comentario = l.comentarioDiferencia?.trim() || null;
        let motivoId: string | null = null;
        let comentarioFinal: string | null = null;
        if (hayMotivos) {
          if (!l.motivoDiferenciaId) {
            throw new BadRequestException('Falta el motivo de la diferencia');
          }
          const motivo = await this.motivosService.assertMotivoValido(
            manager,
            tenantId,
            l.motivoDiferenciaId,
          );
          if (motivo.requiereComentario && !comentario) {
            throw new BadRequestException(
              `El motivo "${motivo.nombre}" exige un comentario`,
            );
          }
          motivoId = motivo.id;
          comentarioFinal = comentario;
        } else {
          if (!comentario) {
            throw new BadRequestException('Falta justificar la diferencia');
          }
          comentarioFinal = comentario;
        }
        await manager.query(
          `UPDATE caja_arqueo_medio
             SET motivo_diferencia_id = $1, comentario_diferencia = $2
           WHERE caja_id = $3 AND tenant_id = $4
             AND ${l.metodoPagoId === null ? 'metodo_pago_id IS NULL' : 'metodo_pago_id = $5'}
             AND eliminado_el IS NULL`,
          l.metodoPagoId === null
            ? [motivoId, comentarioFinal, cajaId, tenantId]
            : [motivoId, comentarioFinal, cajaId, tenantId, l.metodoPagoId],
        );
      }
    });
    // Relectura con el arqueo revelado (ciego:false, caja cerrada).
    return this.obtenerArqueo(tenantId, /*usuarioId*/ '', cajaId, true);
  }
```

> Nota: la relectura usa `obtenerArqueo` con `tieneVerTodas=true` porque el llamador ya pasó `TenantAdminGuard` (admin del tenant); `usuarioId` no se usa en la rama de caja cerrada de `obtenerArqueo` (solo `verificarAccesoCaja`, que con `tieneVerTodas=true` no exige owner). Confirmar que `verificarAccesoCaja` no lo requiere.

- [ ] **Step 7: Endpoint en el controller**

En `caja.controller.ts`: importar `Patch` de `@nestjs/common`, `TenantAdminGuard` y `JustificarDiferenciasDto`. Agregar (junto a los otros `:id/...`, después de `arqueo`):

```ts
  @Patch(':id/arqueo/motivos')
  @UseGuards(TenantAdminGuard)
  justificarDiferencias(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: JustificarDiferenciasDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.justificarDiferencias(u.tenantId!, cajaId, dto.lineas);
  }
```

- [ ] **Step 8: Ejecutar → pasan + gate + commit**

Run: `cd backend && npm run lint:check && npm run typecheck && npm test -- caja`
Expected: verde.

```bash
git add backend/src/modules/caja/caja.service.ts \
        backend/src/modules/caja/caja.controller.ts \
        backend/src/modules/caja/dto/justificar-diferencias.dto.ts \
        backend/src/modules/caja/caja.service.spec.ts \
        backend/src/modules/caja/caja.controller.spec.ts
git commit -m "feat(caja): PATCH admin-only justifica diferencias en cierre ciego + arqueo lee el motivo"
```

---

### Task 5: E2E — CRUD admin-only + cierre normal con motivo + justificación ciega

**Files:**
- Create: `backend/test/motivos-diferencia.e2e-spec.ts`
- Modify: `backend/test/caja.e2e-spec.ts` (casos de motivo en el cierre y la justificación ciega)

**Interfaces:** consume `GET/POST/PATCH/DELETE /api/motivos-diferencia`, `POST /api/caja/:id/cerrar` (con motivo), `PATCH /api/caja/:id/arqueo/motivos`. Reusa helpers de `caja.e2e-spec` (`tokenSupervisor` es admin; un token no-admin si existe, o crear uno).

- [ ] **Step 1: E2E del CRUD**

`motivos-diferencia.e2e-spec.ts` (espeja el bootstrap de `caja.e2e-spec` para levantar la app y loguear). Casos:
- `GET /api/motivos-diferencia` con admin → 200 y contiene "otro".
- `GET /api/motivos-diferencia?soloActivas=true` → 200.
- `POST` con admin → 201 (crea custom, `esFijo:false`).
- `POST` con un token **no-admin** → 403.
- `PATCH` sobre un fijo cambiando `nombre` → 400; cambiando `activo` → 200.
- `DELETE` sobre un fijo → 400; sobre el custom creado → 204.

```ts
it('POST /motivos-diferencia por no-admin → 403', async () => {
  const r = await request(app.getHttpServer())
    .post('/api/motivos-diferencia')
    .set('Authorization', `Bearer ${tokenNoAdmin}`)
    .send({ nombre: `x ${Date.now()}` });
  expect(r.status).toBe(403);
});
```

- [ ] **Step 2: E2E del cierre normal con motivo**

En `caja.e2e-spec.ts` (bloque arqueo, tenant NO ciego): abrir caja, cerrar con efectivo que **descuadra** (contado ≠ esperado) **sin** motivo → 400; con `motivoDiferenciaId` de un motivo activo del tenant → 201; el `GET /api/caja/:id/arqueo` de la caja cerrada devuelve la línea con `motivoNombre` no nulo.

- [ ] **Step 3: E2E de la justificación ciega**

Con `arqueo_ciego=true`: abrir, cerrar con descuadre (en ciego el cierre no pide motivo) → 201; la línea queda sin motivo; `PATCH /api/caja/:id/arqueo/motivos` por **no-admin** → 403; por **admin** con motivo válido → 200 y el `GET` posterior muestra `motivoNombre`. Restaurar `arqueo_ciego=false` en `finally`.

- [ ] **Step 4: Ejecutar + commit**

Run: `cd backend && npm run test:e2e -- caja motivos-diferencia`
Expected: PASS (las suites tocadas verdes; fallos ajenos por polución de stock no son regresión — verdad = CI).

```bash
git add backend/test/motivos-diferencia.e2e-spec.ts backend/test/caja.e2e-spec.ts
git commit -m "test(motivos): e2e CRUD admin-only + cierre con motivo + justificación ciega"
```

---

### Task 6: Frontend — store + página de configuración

**Files:**
- Modify: `frontend/app/stores/caja.ts`
- Create: `frontend/app/pages/configuracion/motivos-diferencia.vue`
- Modify: el nav de Configuración (donde están los links de `configuracion/*`)

**Interfaces:**
- Produces (store): `MotivoDiferencia { id, nombre, activo, requiereComentario, esFijo }`; `motivos: Ref<MotivoDiferencia[]>`; `cargarMotivos(soloActivas?)`; `justificarDiferencias(cajaId, lineas)`. `ArqueoLinea` gana `motivoDiferenciaId?`, `motivoNombre?`, `comentarioDiferencia?`. `cerrar` payload de línea gana `motivoDiferenciaId?`, `comentarioDiferencia?`.

- [ ] **Step 1: Tipos + acciones en el store**

En `stores/caja.ts`: extender `ArqueoLinea`:
```ts
  motivoDiferenciaId?: string | null
  motivoNombre?: string | null
  comentarioDiferencia?: string | null
```
Agregar el tipo y estado:
```ts
export interface MotivoDiferencia {
  id: string
  nombre: string
  activo: boolean
  requiereComentario: boolean
  esFijo: boolean
}
```
```ts
  const motivos = ref<MotivoDiferencia[]>([])

  async function cargarMotivos(soloActivas = false): Promise<void> {
    motivos.value = await useApiFetch<MotivoDiferencia[]>(
      `${config.public.apiUrl}/motivos-diferencia${soloActivas ? '?soloActivas=true' : ''}`,
    )
  }

  async function justificarDiferencias(
    cajaId: string,
    lineas: { metodoPagoId: string | null, motivoDiferenciaId?: string, comentarioDiferencia?: string }[],
  ): Promise<{ ciego: boolean, lineas: ArqueoLinea[] }> {
    const res = await useApiFetch<{ ciego: boolean, lineas: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/arqueo/motivos`,
      { method: 'PATCH', body: { lineas } },
    )
    arqueo.value = res.lineas
    return res
  }
```
Extender el tipo del payload de `cerrar` (línea de `lineas`):
```ts
    payload: { lineas: { metodoPagoId: string | null, montoContado: string, motivoDiferenciaId?: string, comentarioDiferencia?: string }[], comentario?: string },
```
Exponer `motivos`, `cargarMotivos`, `justificarDiferencias` en el `return`.

- [ ] **Step 2: Página de configuración**

`configuracion/motivos-diferencia.vue` espejando `causas-merma.vue`, con **dos divergencias**: (a) el campo `requiereComentario` en el form/tabla; (b) un motivo `esFijo` **permite** togglear `activo` y editar `requiereComentario` (el switch de la tabla y el drawer NO se deshabilitan por `esFijo`), pero **sí** se bloquea el rename (input `nombre` disabled si `esFijo`) y el delete (botón disabled si `esFijo`). El `guardar` de un fijo manda solo `activo`/`requiereComentario` (no `nombre`). Endpoint base `/motivos-diferencia`. Título "Motivos de diferencia", descripción "Tipifica por qué descuadra una caja al cerrar. Los motivos fijos no se renombran ni se eliminan, pero podés activarlos/desactivarlos."

- [ ] **Step 3: Link en el nav de Configuración**

Agregar el link a `configuracion/motivos-diferencia` en el mismo lugar donde está `configuracion/causas-merma` (buscar "Causas de merma" en el componente de navegación de Configuración; agregar una entrada análoga "Motivos de diferencia").

- [ ] **Step 4: Gate + commit**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: verde.

```bash
git add frontend/app/stores/caja.ts frontend/app/pages/configuracion/motivos-diferencia.vue frontend/app
git commit -m "feat(motivos): store + página de configuración de motivos de diferencia"
```

---

### Task 7: Frontend — captura del motivo en el drawer (modo normal)

Cuando una línea tiene diferencia en vivo ≠ 0 (modo normal), el drawer pide motivo + comentario.

**Files:**
- Modify: `frontend/app/components/caja/CajaCierreDrawer.vue`

**Interfaces:**
- Consumes: `cajaStore.motivos`, `cajaStore.cargarMotivos`, `cajaStore.arqueoCiego`.

- [ ] **Step 1: Cargar motivos al abrir + estado local**

En el `<script setup>`: en el `watch(open)` que llama `cargarArqueo`, agregar `await cajaStore.cargarMotivos(true)` (solo activos). Estado local:
```ts
const motivoPorClave = ref<Record<string, string>>({})
const comentarioDiferPorClave = ref<Record<string, string>>({})
```
Helper: una línea "descuadra" si `diferenciaDe(l)` no es null y `!diferenciaDe(l)!.isZero()`. El motivo se pide solo en **modo normal** (`!ciego`), porque en ciego el drawer no muestra diferencia.

- [ ] **Step 2: UI por línea que descuadra**

En el template, dentro de cada línea (obligatorias e informativas), tras el bloque de "Diferencia", cuando `!ciego && diferenciaDe(l) && !diferenciaDe(l)!.isZero()`:
```vue
            <template v-if="!ciego && diferenciaDe(l) && !diferenciaDe(l)!.isZero()">
              <USelect
                :model-value="motivoPorClave[claveDe(l)] ?? ''"
                :items="cajaStore.motivos.map(m => ({ label: m.nombre, value: m.id }))"
                placeholder="Motivo de la diferencia"
                class="w-full"
                @update:model-value="(v: string) => { motivoPorClave[claveDe(l)] = v }"
              />
              <UInput
                v-if="motivoRequiereComentario(claveDe(l))"
                :model-value="comentarioDiferPorClave[claveDe(l)] ?? ''"
                placeholder="Comentario (requerido)"
                class="w-full"
                @update:model-value="(v: string) => { comentarioDiferPorClave[claveDe(l)] = v }"
              />
            </template>
```
`motivoRequiereComentario(clave)` = el motivo elegido tiene `requiereComentario`, o **no hay motivos activos** (`cajaStore.motivos.length === 0` → red de seguridad: se usa un `UInput` de comentario sin `USelect`).

- [ ] **Step 3: Extender el gate + payload**

`obligatoriasCompletas` (o un nuevo `puedeConfirmar`) exige además: cada línea con diferencia ≠ 0 en vivo tiene motivo (si hay motivos) **o** comentario (red de seguridad), y comentario si el motivo `requiereComentario`. En `cerrarCaja`, al construir `lineas`, incluir `motivoDiferenciaId` y `comentarioDiferencia` por clave cuando corresponda.

- [ ] **Step 4: Gate + commit**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: verde.

```bash
git add frontend/app/components/caja/CajaCierreDrawer.vue
git commit -m "feat(caja): drawer de cierre pide motivo por línea que descuadra (modo normal)"
```

---

### Task 8: Frontend — columna Motivo + justificación admin en el detalle

**Files:**
- Modify: `frontend/app/components/caja/CajaArqueoTable.vue`

**Interfaces:**
- Consumes: `cajaStore.justificarDiferencias`, `cajaStore.motivos`, `cajaStore.cargarMotivos`. Nueva prop `puedeJustificar: boolean` + `cajaId: string` (los pasan `mi-caja/[id].vue` y `cajas/[id].vue`; `puedeJustificar = perms.esAdmin`).

- [ ] **Step 1: Columna Motivo (lectura)**

En `CajaArqueoTable.vue`, agregar una columna "Motivo": muestra `l.motivoNombre` (+ `l.comentarioDiferencia` en subtexto si existe); si `l.diferencia != null && !new Decimal(l.diferencia).isZero() && !l.motivoNombre` → "Sin justificar" (color de atención permitido en caja).

- [ ] **Step 2: Justificación admin (inline)**

Nuevas props `puedeJustificar?: boolean`, `cajaId?: string`. Si `puedeJustificar` y hay líneas "Sin justificar" (o para editar), mostrar por línea un `USelect` de `cajaStore.motivos` + comentario y un botón "Guardar" que llama `cajaStore.justificarDiferencias(cajaId, [...])`. Cargar `cajaStore.cargarMotivos(true)` en `onMounted` del componente cuando `puedeJustificar`. En `mi-caja/[id].vue` y `cajas/[id].vue`, pasar `:puede-justificar="perms.esAdmin"` y `:caja-id="cajaId"` al `<CajaArqueoTable>`.

- [ ] **Step 3: Gate + commit**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: verde.

```bash
git add frontend/app/components/caja/CajaArqueoTable.vue frontend/app/pages/mi-caja/[id].vue frontend/app/pages/cajas/[id].vue
git commit -m "feat(caja): detalle muestra el motivo y permite justificar (admin) las diferencias"
```

---

### Task 9: Docs + `startup-pos.sql`

**Files:** `startup-pos.sql`, `docs/features/gestion-cajas.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/investigaciones/2026-07-23-gestion-caja.md`.

- [ ] **Step 1: SQL**

En `startup-pos.sql`: agregar la tabla `motivo_diferencia_caja` (cerca de `causas_merma`, mismas columnas que la entidad + índice único `(tenant_id, lower(nombre)) WHERE eliminado_el IS NULL`) y las 2 columnas nuevas en `caja_arqueo_medio` (`motivo_diferencia_id UUID`, `comentario_diferencia TEXT`).

- [ ] **Step 2: `gestion-cajas.md`**

Sección "Motivos categorizados de diferencia": catálogo tenant-owned admin-only (lectura abierta), `es_fijo` (rename/delete bloqueados, `activo`/`requiere_comentario` togglables), captura inline en cierre normal (cajero, bloqueante) vs justificación post-cierre en ciego (`PATCH` admin-only, "pendiente" hasta justificar), red de seguridad (sin motivos → comentario). Diferidos: reporte over/short, umbral.

- [ ] **Step 3: ESTADO + pendientes + investigación**

`docs/ESTADO.md`: fila "Motivos de diferencia" implementado (2026-07-24). En `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9 / `docs/agent/pendientes.md`: marcar **C hecho**; reporte over/short y umbral (§6) siguen diferidos.

- [ ] **Step 4: Verificar enlaces + commit**

Run: el pre-commit corre `check-docs-links` sobre los `.md` staged (no usar `--no-verify`).

```bash
git add startup-pos.sql docs/features/gestion-cajas.md docs/ESTADO.md docs/agent/pendientes.md docs/agent/investigaciones/2026-07-23-gestion-caja.md
git commit -m "docs(caja): motivos categorizados de diferencia (sub-proyecto C) + SQL"
```

---

## Cierre del sub-proyecto (tras Task 9)

Gate completo (coincide con CI):

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Más **smoke navegador** (rebuild de contenedores): (1) Config → Motivos de diferencia: crear/editar/desactivar; un fijo no se renombra/elimina pero se activa/desactiva y se togglea `requiere_comentario`. (2) Cierre **normal** con descuadre → el drawer pide motivo (y comentario si "otro"), bloquea sin él; el detalle muestra el motivo congelado. (3) Modo **ciego**: cerrar con descuadre → detalle muestra "Sin justificar"; un admin justifica con el selector; un no-admin no ve el selector. Consola sin errores.

Un fallo e2e local en suites ajenas a caja/motivos por polución de stock no es regresión (verdad = CI con DB fresca).

## Self-Review (cobertura del plan vs. spec)

- **Tabla `motivo_diferencia_caja`** (tenant-owned, único case-insensitive, soft-delete): Task 1 (entidad) + Task 9 (SQL). ✓
- **CRUD admin-only, lectura abierta, `es_fijo` togglable en activo/requiere_comentario**: Task 1 (backend) + Task 6 (config page). ✓
- **`requiere_comentario` configurable**: Task 1 (columna/DTO/service) + Task 6/7 (UI). ✓
- **Columnas en `caja_arqueo_medio`**: Task 3 (entidad) + Task 9 (SQL). ✓
- **Cierre normal bloqueante con motivo (cajero)**: Task 3 (enforcement) + Task 7 (drawer). ✓
- **Justificación ciega post-cierre admin-only (`PATCH`)**: Task 4 (backend) + Task 8 (detalle). ✓
- **Red de seguridad (sin motivos → comentario)**: Task 3 (cerrar) + Task 4 (justify) + Task 7/8 (UI). ✓
- **Lectura del motivo en el arqueo** (`LineaArqueo` + `obtenerArqueo`): Task 4 (backend) + Task 6 (store) + Task 8 (tabla). ✓
- **Seed de los 7 (`es_fijo`, "otro" requiere_comentario) en seeder + create**: Task 2. ✓
- **Testing** unit + e2e + smoke: Tasks 1, 3, 4, 5 + cierre. ✓
- **Docs + SQL**: Task 9. ✓

Consistencia de tipos: `MotivoDiferenciaListItem`/`MotivoDiferencia` (id, nombre, activo, requiereComentario, esFijo) idéntico back↔front. `assertMotivoValido`/`hayMotivosActivos` firmas iguales entre Task 1 (impl) y Tasks 3-4 (consumo). `LineaArqueo` con `motivoDiferenciaId/motivoNombre/comentarioDiferencia` idéntico en Task 4 (back) y Task 6 (store). Payload de `cerrar` y de `justificarDiferencias` con `motivoDiferenciaId`/`comentarioDiferencia` consistente back↔front.
