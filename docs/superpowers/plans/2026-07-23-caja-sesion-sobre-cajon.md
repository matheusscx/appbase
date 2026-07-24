# Sesión de caja sobre un cajón — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar el cajón físico con la sesión de caja: la `cajas` gana `cajon_id` y la apertura valida cajón **autorizado + libre + activo** (el allow-list del sub-2 recién acá se hace valer).

**Architecture:** Se toca el módulo `caja` existente (entity, DTO, service `abrir`, listados) y el módulo `cajones` (guard de integridad). `abrir` pasa a correr dentro de una transacción con `FOR UPDATE`; la unicidad de sesión por cajón la garantiza un índice único parcial + el catch de la violación 23505. La caja `virtual` no se toca (`cajon_id` null). Terminología sin rename.

**Tech Stack:** NestJS + TypeORM (Postgres, SQL crudo vía `dataSource`/`manager.query`), Nuxt 4 (Vue 3) + Nuxt UI, Jest + supertest (e2e).

**Spec:** `docs/superpowers/specs/2026-07-23-caja-sesion-sobre-cajon-design.md`

## Global Constraints

- **`tenant_id`/`usuario_id` siempre del token**, nunca del body/query/param.
- **Soft delete en todo**; toda lectura filtra `eliminado_el IS NULL`. Nunca DELETE físico.
- **Dinero con Decimal.js** (ya se usa en el módulo); no romper ese patrón en lo que toques.
- **`cajon_id` en `cajas`**: `@Column({ name: 'cajon_id', type: 'uuid', nullable: true })` — física lo lleva, virtual null.
- **Índice único parcial** en la entidad `Caja`: `@Index('ux_cajas_cajon_abierta', ['cajonId'], { unique: true, where: "estado = 'abierta' AND \"eliminado_el\" IS NULL" })` — una sesión abierta por cajón; los NULL (virtual) no participan.
- **`cajonId` obligatorio** al abrir caja física (`@IsUUID('4')` en `AbrirCajaDto`).
- **Orden de validación en `abrir`**: (1) usuario libre → 409, (2) cajón válido/activo → 404/409, (3) autorizado (allow-list no vacía sin el usuario) → 403; vacía = permisivo, (4) libre → 409, todo bajo transacción con `FOR UPDATE`; la colisión concurrente la ataja el índice único (23505 → 409).
- **Permisos ya existentes** (no crear nuevos): abrir = `MiCaja:Crear` (endpoint ya gateado); picker = `MiCaja:Crear`; integridad reusa los guards de `Cajas` del módulo cajones.
- **Sin N+1**: picker en una query; validaciones de `abrir` son queries acotadas por cajón; integridad = una query de existencia.
- **NO tocar**: motor de precios, `movimientos_inventario`, JWT, la caja `virtual`, ni el modelo del "esperado" (§3 diferido). Sin backfill de cajas viejas.
- **Frontend**: `useApiFetch` (nunca axios); tokens semánticos de Nuxt UI; sin lógica de negocio en páginas.

---

### Task 1: Backend — `cajon_id` en la sesión + `abrir` valida autorizado/libre/activo

**Files:**
- Modify: `backend/src/modules/caja/entities/caja.entity.ts` (columna `cajonId` + `@Index`)
- Modify: `backend/src/modules/caja/dto/abrir-caja.dto.ts` (`cajonId`)
- Modify: `backend/src/modules/caja/caja.service.ts` (`abrir`)
- Test: `backend/src/modules/caja/caja.service.spec.ts` (casos de `abrir`)

**Interfaces:**
- Produces: `CajaService.abrir(tenantId, usuarioId, dto: AbrirCajaDto): Promise<Caja>` (misma firma; ahora requiere `dto.cajonId` y valida).

- [ ] **Step 1: Agregar `cajonId` + índice a la entidad**

En `backend/src/modules/caja/entities/caja.entity.ts`, agregar `Index` al import de typeorm y el decorador de clase + la columna (después de `usuarioId`):

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

// Índice único parcial: máximo una sesión abierta por cajón (backstop duro bajo
// concurrencia). La virtual tiene cajon_id null → no participa del índice único.
@Entity('cajas')
@Index('ux_cajas_cajon_abierta', ['cajonId'], {
  unique: true,
  where: "estado = 'abierta' AND \"eliminado_el\" IS NULL",
})
export class Caja {
```

Y la columna (después de `usuarioId`):

```typescript
  @Column({ name: 'cajon_id', type: 'uuid', nullable: true })
  cajonId: string | null;
```

- [ ] **Step 2: Agregar `cajonId` al DTO**

`backend/src/modules/caja/dto/abrir-caja.dto.ts`:

```typescript
import { IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class AbrirCajaDto {
  @IsUUID('4')
  cajonId: string;

  @IsNumberString()
  saldoInicial: string;

  @IsOptional()
  @IsString()
  comentario?: string;
}
```

- [ ] **Step 3: Escribir los unit tests de `abrir` (fallan primero)**

En `backend/src/modules/caja/caja.service.spec.ts`, agregar (o crear el archivo si no existe siguiendo el patrón del repo). Este helper de manager despacha `query` según la tabla del SQL:

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CajaService } from './caja.service';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';

const TENANT = 'tenant-uuid';
const USER = 'user-uuid';
const CAJON = 'cajon-uuid';

// Respuestas por tabla que consulta abrir(): cajon (SELECT ... FROM cajones),
// allow-list total (COUNT ... cajon_usuario sin usuario_id), mi-allow
// (COUNT ... cajon_usuario con usuario_id), ocupadas (SELECT ... FROM cajas ... FOR UPDATE).
interface AbrirMocks {
  cajon?: Array<{ cajon_id: string; activo: boolean }>;
  allowTotal?: number;
  miAllow?: number;
  ocupadas?: Array<{ caja_id: string }>;
}

function makeManager(m: AbrirMocks) {
  return {
    query: jest.fn((sql: string) => {
      if (/FROM cajones/i.test(sql)) return Promise.resolve(m.cajon ?? []);
      if (/FROM cajon_usuario/i.test(sql)) {
        // el que filtra por usuario_id es "mi-allow"
        if (/usuario_id\s*=/i.test(sql)) {
          return Promise.resolve([{ total: m.miAllow ?? 0 }]);
        }
        return Promise.resolve([{ total: m.allowTotal ?? 0 }]);
      }
      if (/FROM cajas/i.test(sql)) return Promise.resolve(m.ocupadas ?? []);
      return Promise.resolve([]);
    }),
    create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
  };
}

describe('CajaService.abrir', () => {
  let service: CajaService;
  let cajaRepo: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock; query: jest.Mock };
  let manager: ReturnType<typeof makeManager>;

  function build(mocks: AbrirMocks, existente: Caja | null = null) {
    cajaRepo.findOne.mockResolvedValue(existente);
    manager = makeManager(mocks);
    dataSource.transaction.mockImplementation(
      (cb: (m: typeof manager) => unknown) => cb(manager),
    );
  }

  beforeEach(async () => {
    cajaRepo = { findOne: jest.fn() };
    dataSource = { transaction: jest.fn(), query: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaService,
        { provide: getRepositoryToken(Caja), useValue: cajaRepo },
        { provide: getRepositoryToken(MovimientoCaja), useValue: {} },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = module.get<CajaService>(CajaService);
  });

  const dto = { cajonId: CAJON, saldoInicial: '0', comentario: undefined };

  it('abre sobre un cajón autorizado (allow-list vacía) y libre', async () => {
    build({ cajon: [{ cajon_id: CAJON, activo: true }], allowTotal: 0, ocupadas: [] });
    const res = await service.abrir(TENANT, USER, dto);
    expect(res).toMatchObject({ cajonId: CAJON, tipo: 'fisica', estado: 'abierta' });
    expect(manager.save).toHaveBeenCalled();
  });

  it('rechaza si el usuario ya tiene una caja abierta (409)', async () => {
    build({}, { id: 'x' } as Caja);
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rechaza cajón inexistente (404)', async () => {
    build({ cajon: [] });
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza cajón inactivo (409)', async () => {
    build({ cajon: [{ cajon_id: CAJON, activo: false }] });
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza si la allow-list no está vacía y el usuario no está (403)', async () => {
    build({ cajon: [{ cajon_id: CAJON, activo: true }], allowTotal: 2, miAllow: 0 });
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite si la allow-list contiene al usuario', async () => {
    build({ cajon: [{ cajon_id: CAJON, activo: true }], allowTotal: 2, miAllow: 1, ocupadas: [] });
    const res = await service.abrir(TENANT, USER, dto);
    expect(res).toMatchObject({ cajonId: CAJON });
  });

  it('rechaza si el cajón ya tiene una caja abierta (409)', async () => {
    build({ cajon: [{ cajon_id: CAJON, activo: true }], allowTotal: 0, ocupadas: [{ caja_id: 'otra' }] });
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 4: Correr para verificar que falla**

Run: `cd backend && npm test -- src/modules/caja/caja.service.spec.ts`
Expected: FAIL (la lógica nueva de `abrir` aún no valida cajón).

- [ ] **Step 5: Reescribir `abrir` en el service**

En `backend/src/modules/caja/caja.service.ts`, asegurar que estén importados `ForbiddenException`, `NotFoundException`, `ConflictException` de `@nestjs/common` y `QueryFailedError` de `typeorm` (agregarlos si faltan). Reemplazar el método `abrir` por:

```typescript
  async abrir(
    tenantId: string,
    usuarioId: string,
    dto: AbrirCajaDto,
  ): Promise<Caja> {
    const existente = await this.findActiva(tenantId, usuarioId);
    if (existente) {
      throw new ConflictException('Ya tienes una caja abierta');
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        // 2. Cajón válido + activo (del tenant, no borrado)
        const cajonRows: { cajon_id: string; activo: boolean }[] =
          await manager.query(
            `SELECT cajon_id, activo FROM cajones
              WHERE cajon_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
            [dto.cajonId, tenantId],
          );
        const cajon = cajonRows[0];
        if (!cajon) throw new NotFoundException('Cajón no encontrado');
        if (!cajon.activo) throw new ConflictException('El cajón está inactivo');

        // 3. Autorizado — allow-list del sub-2. Vacía = permisivo.
        const totalRows: { total: number }[] = await manager.query(
          `SELECT COUNT(*)::int AS total FROM cajon_usuario
            WHERE cajon_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
          [dto.cajonId, tenantId],
        );
        if ((totalRows[0]?.total ?? 0) > 0) {
          const miRows: { total: number }[] = await manager.query(
            `SELECT COUNT(*)::int AS total FROM cajon_usuario
              WHERE cajon_id = $1 AND tenant_id = $2 AND usuario_id = $3
                AND eliminado_el IS NULL`,
            [dto.cajonId, tenantId, usuarioId],
          );
          if ((miRows[0]?.total ?? 0) === 0) {
            throw new ForbiddenException(
              'No estás autorizado a abrir este cajón',
            );
          }
        }

        // 4. Cajón libre — lockea las sesiones abiertas de ese cajón
        const ocupadas: { caja_id: string }[] = await manager.query(
          `SELECT caja_id FROM cajas
            WHERE cajon_id = $1 AND tenant_id = $2
              AND estado = 'abierta' AND eliminado_el IS NULL
            FOR UPDATE`,
          [dto.cajonId, tenantId],
        );
        if (ocupadas.length > 0) {
          throw new ConflictException('El cajón ya tiene una caja abierta');
        }

        // 5. Crear la sesión física sobre el cajón
        const caja = manager.create(Caja, {
          tenantId,
          usuarioId,
          cajonId: dto.cajonId,
          tipo: 'fisica',
          estado: 'abierta',
          saldoInicial: dto.saldoInicial,
          comentario: dto.comentario,
        });
        return await manager.save(caja);
      });
    } catch (e) {
      // Backstop de concurrencia: dos aperturas simultáneas sobre el mismo cajón
      // → una viola el índice único parcial (23505).
      if (e instanceof QueryFailedError && (e as { code?: string }).code === '23505') {
        throw new ConflictException('El cajón ya tiene una caja abierta');
      }
      throw e;
    }
  }
```

- [ ] **Step 6: Correr los tests**

Run: `cd backend && npm test -- src/modules/caja/caja.service.spec.ts`
Expected: PASS (7 casos de `abrir`).

- [ ] **Step 7: Typecheck y lint**

Run: `cd backend && npm run typecheck && npm run lint:check`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/caja/entities/caja.entity.ts backend/src/modules/caja/dto/abrir-caja.dto.ts backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.service.spec.ts
git commit -m "feat(caja): cajon_id en la sesión + abrir valida autorizado/libre/activo"
```

---

### Task 2: Backend — picker de cajones disponibles + integridad (cajón en uso)

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (`cajonesDisponibles`)
- Modify: `backend/src/modules/caja/caja.controller.ts` (`GET /caja/cajones-disponibles`)
- Modify: `backend/src/modules/cajones/cajones.service.ts` (guard de integridad en `update`/`remove`)
- Modify: `backend/src/modules/cajones/cajones.module.ts` (`forFeature` suma `Caja`)
- Test: `backend/src/modules/cajones/cajones.service.spec.ts` (integridad)

**Interfaces:**
- Consumes: `Caja` entity (con `cajonId`, Task 1).
- Produces: `CajaService.cajonesDisponibles(tenantId, usuarioId): Promise<{ cajonId: string; nombre: string }[]>`; endpoint `GET /api/caja/cajones-disponibles`.

- [ ] **Step 1: Método `cajonesDisponibles` en `caja.service.ts`**

Agregar (una sola query: activos, autorizados con regla lista-vacía, sin sesión abierta):

```typescript
  async cajonesDisponibles(
    tenantId: string,
    usuarioId: string,
  ): Promise<{ cajonId: string; nombre: string }[]> {
    const rows: { cajon_id: string; nombre: string }[] =
      await this.dataSource.query(
        `SELECT cj.cajon_id, cj.nombre
           FROM cajones cj
          WHERE cj.tenant_id = $1
            AND cj.activo = true
            AND cj.eliminado_el IS NULL
            -- autorizado: allow-list vacía (permisivo) o el usuario está en ella
            AND (
              NOT EXISTS (
                SELECT 1 FROM cajon_usuario cu
                 WHERE cu.cajon_id = cj.cajon_id AND cu.eliminado_el IS NULL
              )
              OR EXISTS (
                SELECT 1 FROM cajon_usuario cu
                 WHERE cu.cajon_id = cj.cajon_id AND cu.usuario_id = $2
                   AND cu.eliminado_el IS NULL
              )
            )
            -- libre: sin sesión abierta
            AND NOT EXISTS (
              SELECT 1 FROM cajas c
               WHERE c.cajon_id = cj.cajon_id
                 AND c.estado = 'abierta' AND c.eliminado_el IS NULL
            )
          ORDER BY cj.nombre ASC`,
        [tenantId, usuarioId],
      );
    return rows.map((r) => ({ cajonId: r.cajon_id, nombre: r.nombre }));
  }
```

- [ ] **Step 2: Endpoint en `caja.controller.ts`**

Agregar (junto a los demás `@Get`), gateado por `MiCaja:Crear` (quien puede abrir):

```typescript
  @Get('cajones-disponibles')
  @RequiresPermiso('MiCaja', 'Crear')
  cajonesDisponibles(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.cajaService.cajonesDisponibles(u.tenantId!, u.id);
  }
```

> Ubicarlo **antes** del handler `@Get(':id')` para que la ruta literal no sea capturada por el parámetro.

- [ ] **Step 3: Registrar `Caja` en el módulo cajones e inyectar el repo**

En `backend/src/modules/cajones/cajones.module.ts`, sumar `Caja` al `forFeature`:

```typescript
import { Caja } from '../caja/entities/caja.entity';
// ...
  imports: [TypeOrmModule.forFeature([Cajon, CajonUsuario, UsuarioTenant, Caja])],
```

En `backend/src/modules/cajones/cajones.service.ts`, importar `Caja` e inyectar su repo en el constructor:

```typescript
import { Caja } from '../caja/entities/caja.entity';
// en el constructor, junto a los otros @InjectRepository:
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
```

- [ ] **Step 4: Guard de integridad en `update`/`remove`**

En `cajones.service.ts`, agregar un helper y llamarlo antes de desactivar/borrar. En `update`, **solo** cuando `dto.activo === false`; en `remove`, siempre:

```typescript
  private async asegurarSinSesionAbierta(
    tenantId: string,
    cajonId: string,
    accion: 'desactivar' | 'eliminar',
  ): Promise<void> {
    const abiertas = await this.cajaRepo.count({
      where: { tenantId, cajonId, estado: 'abierta' },
    });
    if (abiertas > 0) {
      throw new ConflictException(
        `El cajón tiene una caja abierta; ciérrala antes de ${accion}.`,
      );
    }
  }
```

En `update`, dentro del bloque que aplica `activo`, antes de asignarlo:

```typescript
    if (dto.activo != null) {
      if (dto.activo === false) {
        await this.asegurarSinSesionAbierta(tenantId, id, 'desactivar');
      }
      cajon.activo = dto.activo;
    }
```

En `remove`, después del `getCajonOrFail`/`findOne` y antes del `softDelete`:

```typescript
    await this.asegurarSinSesionAbierta(tenantId, id, 'eliminar');
```

- [ ] **Step 5: Unit tests de integridad**

En `backend/src/modules/cajones/cajones.service.spec.ts`, agregar el provider del repo de `Caja` al `beforeEach` (junto a los otros): `let cajaRepo: { count: jest.Mock }` con `cajaRepo = { count: jest.fn() }` y `{ provide: getRepositoryToken(Caja), useValue: cajaRepo }` (importar `Caja` de `../caja/entities/caja.entity`). Agregar los casos:

```typescript
  describe('integridad de cajón en uso', () => {
    it('remove rechaza si el cajón tiene una caja abierta (409)', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', tenantId: TENANT });
      cajaRepo.count.mockResolvedValue(1);
      await expect(service.remove(TENANT, 'x')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('remove borra si no hay caja abierta', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', tenantId: TENANT });
      cajaRepo.count.mockResolvedValue(0);
      await service.remove(TENANT, 'x');
      expect(repo.softDelete).toHaveBeenCalled();
    });

    it('update rechaza desactivar un cajón con caja abierta (409)', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', tenantId: TENANT, nombre: 'M', activo: true });
      cajaRepo.count.mockResolvedValue(1);
      await expect(
        service.update(TENANT, 'x', { activo: false }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
```

Asegurar que `ConflictException` esté importado en el spec (ya lo está por los tests del sub-1).

- [ ] **Step 6: Correr los tests**

Run: `cd backend && npm test -- src/modules/cajones/cajones.service.spec.ts && npm run typecheck && npm run lint:check`
Expected: PASS; sin errores.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.controller.ts backend/src/modules/cajones/cajones.service.ts backend/src/modules/cajones/cajones.module.ts backend/src/modules/cajones/cajones.service.spec.ts
git commit -m "feat(caja): picker de cajones disponibles + bloquear cajón en uso"
```

---

### Task 3: Backend — e2e de apertura sobre cajón

**Files:**
- Test: `backend/test/caja.e2e-spec.ts` (agregar un `describe` de apertura sobre cajón)

**Interfaces:**
- Consumes: `POST /api/caja/abrir` (con `cajonId`), `GET /api/caja/cajones-disponibles`, `POST /api/cajones`, `PATCH/DELETE /api/cajones/:id`, `PUT /api/cajones/:id/usuarios`.

- [ ] **Step 1: Leer el e2e existente**

Leer `backend/test/caja.e2e-spec.ts` para reusar su bootstrap, el helper `login`/`switch-tenant`, los tokens (admin/vendedor de Paris) y el patrón de cierre de cajas en `afterAll` (para no dejar sesiones abiertas que ensucien reruns locales — ver memoria de polución e2e).

- [ ] **Step 2: Escribir el `describe` de apertura sobre cajón**

Agregar (anidado o como bloque nuevo reusando el bootstrap). Crea un cajón dedicado por test para aislar del estado, y **cierra la caja** que abra. Escenarios:

```typescript
  describe('apertura sobre cajón (e2e)', () => {
    let cajonId: string;

    beforeAll(async () => {
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: `E2E Apertura ${Date.now()}` });
      cajonId = r.body.id as string;
    });

    it('el cajón aparece en cajones-disponibles del admin', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(r.status).toBe(200);
      expect((r.body as Array<{ cajonId: string }>).some((c) => c.cajonId === cajonId)).toBe(true);
    });

    it('abrir sin cajonId es rechazado (400)', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ saldoInicial: '0' });
      expect(r.status).toBe(400);
    });

    it('abre sobre el cajón, queda ocupado, y un segundo intento del mismo usuario da 409', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ cajonId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = abrir.body.id as string;

      // el cajón ya no aparece disponible
      const disp = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect((disp.body as Array<{ cajonId: string }>).some((c) => c.cajonId === cajonId)).toBe(false);

      // no se puede desactivar un cajón con caja abierta
      const desactivar = await request(app.getHttpServer())
        .patch(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activo: false });
      expect(desactivar.status).toBe(409);

      // cerrar para dejar limpio
      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ montoContado: '0' });
      expect([200, 201]).toContain(cerrar.status);
    });

    it('un usuario no autorizado (allow-list no vacía sin él) recibe 403', async () => {
      // restringir el cajón al admin: el vendedor queda fuera
      const adminId = await usuarioIdDe(tokenAdmin);
      await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ usuarioIds: [adminId] });

      const r = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({ cajonId, saldoInicial: '0' });
      expect(r.status).toBe(403);

      // limpiar el allow-list
      await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ usuarioIds: [] });
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    });
  });
```

Donde `usuarioIdDe(token)` obtiene el `usuarioId` del propio usuario vía `GET /api/tenants/members` (o el endpoint que exponga el id del usuario autenticado); implementarlo como helper local reusando el patrón del e2e de cajones (miembros del tenant), matcheando por correo del admin. Si el e2e ya tiene un helper de "yo", reusarlo.

- [ ] **Step 3: Correr el e2e**

Run: `cd backend && npm run test:e2e -- caja.e2e-spec.ts`
Expected: PASS (los existentes + los nuevos). (Requiere `docker-compose up`.)

- [ ] **Step 4: Commit**

```bash
git add backend/test/caja.e2e-spec.ts
git commit -m "test(caja): e2e apertura sobre cajón (autorizado/libre/ocupado/integridad)"
```

---

### Task 4: Backend — mostrar el cajón en listados de sesión

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (`abiertas`, `historial` — SQL + DTOs + maps)

**Interfaces:**
- Produces: `CajaAbierta` y `CajaHistorialItem` ganan `cajonNombre: string | null`.

- [ ] **Step 1: `abiertas` — sumar el cajón**

En `caja.service.ts`, en `abiertas`: agregar `cj.nombre AS cajon_nombre` al `SELECT`, `LEFT JOIN cajones cj ON cj.cajon_id = c.cajon_id AND cj.eliminado_el IS NULL`, y `cj.nombre` al `GROUP BY`. Agregar `cajon_nombre: string | null` al tipo de fila. En el `.map`, agregar `cajonNombre: r.cajon_nombre` al objeto retornado. Agregar `cajonNombre: string | null` a la interfaz `CajaAbierta`.

- [ ] **Step 2: `historial` — sumar el cajón**

En `historial`: agregar `cj.nombre AS cajon_nombre` al `SELECT` de la query de datos y `LEFT JOIN cajones cj ON cj.cajon_id = c.cajon_id AND cj.eliminado_el IS NULL`. Agregar `cajon_nombre: string | null` al tipo de fila y al parámetro de `mapCajaHistorialRow`; en el map agregar `cajonNombre: r.cajon_nombre`. Agregar `cajonNombre: string | null` a la interfaz `CajaHistorialItem`.

- [ ] **Step 3: Typecheck, lint y unit**

Run: `cd backend && npm run typecheck && npm run lint:check && npm test -- src/modules/caja`
Expected: sin errores; unit verdes (las interfaces nuevas no rompen los tests existentes).

- [ ] **Step 4: Verificación manual opcional**

Con `docker-compose up`, `GET /api/caja/abiertas` como admin devuelve cada sesión con `cajonNombre` (o null para la virtual). Si no es práctico, alcanza con typecheck + el e2e de Task 3.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts
git commit -m "feat(caja): exponer cajonNombre en listados de sesión (supervisión/Mi caja)"
```

---

### Task 5: Frontend — selector de cajón al abrir + mostrar el cajón

**Files:**
- Modify: `frontend/app/components/caja/CajaAperturaForm.vue` (selector de cajón)
- Modify: `frontend/app/components/caja/CajaAbiertasGrid.vue` (mostrar cajón) — verificar nombre real del componente que lista sesiones abiertas
- Modify (si aplica): `frontend/app/components/caja/CajaHistorial.vue` (columna cajón)

**Interfaces:**
- Consumes: `GET /caja/cajones-disponibles` → `{ cajonId, nombre }[]`; `POST /caja/abrir` con `cajonId`; `cajonNombre` en los ítems de sesión.

- [ ] **Step 1: Leer los componentes reales**

Leer `CajaAperturaForm.vue`, `CajaAbiertasGrid.vue` y `CajaHistorial.vue` para conocer su estructura real (cómo arman el body de `abrir`, qué campos muestran, el patrón `useApiFetch`/`apiUrl`, tokens de Nuxt UI). Seguir sus convenciones; lo de abajo es el qué, adaptá al cómo del componente.

- [ ] **Step 2: Selector de cajón en `CajaAperturaForm.vue`**

- Al montar (o al abrir el form), cargar `const cajones = await useApiFetch<{ cajonId: string; nombre: string }[]>(\`${apiUrl}/caja/cajones-disponibles\`)`.
- Agregar un `USelectMenu`/`USelect` (según lo que use el resto del form) con las opciones `cajones` (label `nombre`, value `cajonId`), enlazado a un ref `cajonId`.
- Incluir `cajonId` en el body del `POST /caja/abrir`.
- Si `cajones` viene vacío, deshabilitar el submit y mostrar un mensaje ("No hay cajas disponibles para abrir. Pedí al administrador que te habilite una.").
- Manejar el error del `POST` con toast (reusar `apiErrorMsg` si el componente ya lo usa) — los 403/404/409 del backend deben mostrarse legibles.

- [ ] **Step 3: Mostrar el cajón en las sesiones**

- En el componente que lista sesiones abiertas (`CajaAbiertasGrid.vue`) y en `CajaHistorial.vue`, mostrar `item.cajonNombre` (con fallback `'—'` cuando es null). Ajustar la interfaz TS local del ítem para incluir `cajonNombre: string | null`.

- [ ] **Step 4: Verificar build, typecheck y design**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/caja
git commit -m "feat(caja): selector de cajón al abrir + mostrar cajón en sesiones"
```

---

### Task 6: Docs + esquema de referencia

**Files:**
- Modify: `docs/features/gestion-cajas.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/agent/investigaciones/2026-07-23-gestion-caja.md` (§9)
- Modify: `startup-pos.sql`

- [ ] **Step 1: Documentar en `gestion-cajas.md`**

Agregar/actualizar la sección de apertura: la caja física se abre **sobre un cajón** (`cajonId` obligatorio); validaciones autorizado (allow-list, **acá se hace valer**) + libre + activo; el picker `GET /caja/cajones-disponibles`; la integridad (no desactivar/borrar cajón con sesión abierta → 409); que la virtual sigue con `cajon_id` null. Nota: cierra la **estructura** del refactor (opción A); las features de negocio (§3 esperado, §6 cierre forzado, §5 blind count) quedan diferidas.

- [ ] **Step 2: `docs/ESTADO.md`**

Agregar fila ✅ "Sesión de caja sobre cajón" (2026-07-23) y marcar el refactor de caja (estructura, sub-1+2+3) como completo, siguiendo el formato existente.

- [ ] **Step 3: Investigación §9**

En `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9, marcar el ítem 3 implementado y enlazar spec + plan:

```markdown
- [x] **3. Sesión sobre cajón + terminología** — ✅ implementado. La sesión (`cajas`) gana
  `cajon_id`; la apertura valida autorizado (allow-list) + libre + activo; unicidad de sesión
  por cajón; integridad (cajón en uso); terminología sin rename. Cierra la estructura (opción A).
  Spec: [`2026-07-23-caja-sesion-sobre-cajon-design.md`](../../superpowers/specs/2026-07-23-caja-sesion-sobre-cajon-design.md) ·
  Plan: [`2026-07-23-caja-sesion-sobre-cajon.md`](../../superpowers/plans/2026-07-23-caja-sesion-sobre-cajon.md).
```

- [ ] **Step 4: `startup-pos.sql`**

En la definición de la tabla `cajas`, agregar la columna `"cajon_id" UUID REFERENCES "cajones" ("cajon_id")` (nullable) y, tras la tabla, el índice:

```sql
CREATE UNIQUE INDEX "ux_cajas_cajon_abierta"
  ON "cajas" ("cajon_id")
  WHERE "estado" = 'abierta' AND "eliminado_el" IS NULL;
```

(Ubicar la columna de forma consistente con las demás de `cajas`; es documentación de referencia — en dev la crea `synchronize`.)

- [ ] **Step 5: Commit**

```bash
git add docs/features/gestion-cajas.md docs/ESTADO.md docs/agent/investigaciones/2026-07-23-gestion-caja.md startup-pos.sql
git commit -m "docs(caja): documentar sesión sobre cajón + esquema de referencia"
```

---

## Verificación final (gate completo)

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Todo verde. Verificar además: `tenant_id`/`usuario_id` del token; soft delete; `abrir` valida en orden (usuario libre → cajón válido/activo → autorizado → libre) bajo transacción; unicidad de sesión por cajón (índice + 23505→409); integridad (cajón en uso → 409); la caja **virtual** sin afectar (`cajon_id` null, no pasa por `abrir`); sin tocar motor de precios/inventario/JWT ni el modelo del "esperado". Smoke navegador: abrir eligiendo cajón, cajón ocupado no disponible, nombre del cajón visible en supervisión.
