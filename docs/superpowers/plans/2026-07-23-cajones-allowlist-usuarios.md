# Allow-list cajón ↔ usuario (Configuración → Cajas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que el admin defina **qué usuarios pueden abrir qué cajones** (allow-list N‑a‑N), gestionado desde Configuración → Cajas, sin enforcement al abrir (eso es el sub-proyecto 3).

**Architecture:** Se **extiende el módulo `cajones`** (del sub-1) con una entidad de mapeo `cajon_usuario` (N‑a‑N, tenant-owned, soft delete) y dos endpoints (`GET`/`PUT /cajones/:id/usuarios`) gateados por permisos RBAC `Cajas` (`Leer`/`Actualizar`). El `PUT` es un **replace-set**: recibe el conjunto entero de `usuarioIds` y hace el diff (soft-delete de los que salieron, alta de los que entraron) en una transacción. El frontend suma una acción "Usuarios" por cajón con un drawer de checkboxes. No se toca la tabla `cajas` ni el enforcement al abrir.

**Tech Stack:** NestJS + TypeORM (Postgres), Nuxt 4 (Vue 3) + Nuxt UI, Jest + supertest (e2e).

**Spec:** `docs/superpowers/specs/2026-07-23-cajones-allowlist-usuarios-design.md`

## Global Constraints

- **`tenant_id` siempre del token** (`req.user.tenantId`), nunca del body/query/param.
- **Soft delete en todo**: quitar una habilitación = `softDelete` (marca `eliminado_el`); nunca borrado físico. `@DeleteDateColumn` excluye soft-deleted automáticamente en `find`/`count`.
- **PK/FK con `type: 'uuid'` explícito** (ADR-004): `cajon_usuario_id` es `@PrimaryGeneratedColumn('uuid', { name: 'cajon_usuario_id' })`; `cajon_id`/`usuario_id`/`tenant_id` son `@Column({ type: 'uuid' })`.
- **Pertenencia al tenant se valida contra `usuarios_tenants`** (entidad `UsuarioTenant`), NO contra `usuarios.tenant_id` (no existe esa columna). Un `usuarioId` que no es miembro del tenant → **400 `BadRequestException`**.
- **Índice único parcial** en la entidad: `(cajon_id, usuario_id) WHERE eliminado_el IS NULL` — una habilitación viva no se repite.
- **Sin N+1**: la validación de pertenencia es **una** query (`count` con `In(ids)`); el diff usa operaciones batch (`softDelete` con `In(ids)`, `save(array)`).
- **Transacción**: el diff del `PUT` va dentro de `this.dataSource.transaction(async (manager) => { ... })` (convención del repo: `@InjectDataSource()`).
- **RBAC por endpoint** (`@RequiresPermiso('Cajas', <permiso>)`; la clase `CajonesController` ya está bajo `JwtAuthGuard + TenantGuard + PermisosGuard`): `GET`→`Leer`, `PUT`→`Actualizar`. Se **reutiliza** el módulo `Cajas` (sin permiso nuevo). El admin `es_fijo` los obtiene por short-circuit.
- **Regla de lista vacía (semántica, no se enforcea acá):** cajón sin asignados = permisivo (abierto a cualquiera con `MiCaja:Crear`). Array vacío en el `PUT` es válido.
- **Terminología (no mezclar):** entidad `CajonUsuario`/tabla `cajon_usuario` = la habilitación; `cajones` = el mueble (sub-1); `cajas` = la sesión (**sin tocar**). Etiqueta UI: "Cajas".
- **Frontend:** `useApiFetch` (nunca axios); tokens semánticos de Nuxt UI (sin Tailwind hardcodeado); la página no contiene lógica de negocio.
- **Sin seed de datos de allow-list** (YAGNI): el "Mostrador" sembrado queda sin asignados (estado permisivo válido y representativo). Solo se registra la entidad para `synchronize`.

---

### Task 1: Backend — entidad `cajon_usuario`, DTO y métodos de service (con unit tests)

**Files:**
- Create: `backend/src/modules/cajones/entities/cajon-usuario.entity.ts`
- Create: `backend/src/modules/cajones/dto/set-cajon-usuarios.dto.ts`
- Modify: `backend/src/modules/cajones/cajones.service.ts` (inyectar repos + `DataSource`; agregar `getUsuarios`/`setUsuarios`/`getCajonOrFail`)
- Modify: `backend/src/modules/cajones/cajones.module.ts` (`forFeature([Cajon, CajonUsuario, UsuarioTenant])`)
- Modify: `backend/src/app.module.ts` (registrar `CajonUsuario` en el array `entities`)
- Test: `backend/src/modules/cajones/cajones.service.spec.ts` (agregar casos)

**Interfaces:**
- Consumes: `Cajon` (sub-1), `UsuarioTenant` (de `../tenants/entities/usuario-tenant.entity`).
- Produces: `CajonUsuario` (entity); `CajonesService.getUsuarios(tenantId: string, cajonId: string): Promise<string[]>` y `CajonesService.setUsuarios(tenantId: string, cajonId: string, usuarioIds: string[]): Promise<string[]>`.

- [ ] **Step 1: Crear la entidad**

`backend/src/modules/cajones/entities/cajon-usuario.entity.ts`:

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

// Índice único parcial: una habilitación viva (cajón, usuario) no se repite.
// Al quitar y re-habilitar, la fila anterior queda soft-deleted y se crea una nueva
// (el WHERE eliminado_el IS NULL lo permite).
@Entity('cajon_usuario')
@Index('ux_cajon_usuario_cajon_usuario', ['cajonId', 'usuarioId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class CajonUsuario {
  @PrimaryGeneratedColumn('uuid', { name: 'cajon_usuario_id' })
  id: string;

  @Column({ name: 'cajon_id', type: 'uuid' })
  cajonId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 2: Crear el DTO**

`backend/src/modules/cajones/dto/set-cajon-usuarios.dto.ts`:

```typescript
import { IsArray, IsUUID } from 'class-validator';

export class SetCajonUsuariosDto {
  // Array vacío es válido: deja el cajón sin asignados (permisivo).
  @IsArray()
  @IsUUID('4', { each: true })
  usuarioIds: string[];
}
```

- [ ] **Step 3: Registrar la entidad en el módulo y en app.module**

En `backend/src/modules/cajones/cajones.module.ts`, importar las dos entidades y ampliar `forFeature`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cajon } from './entities/cajon.entity';
import { CajonUsuario } from './entities/cajon-usuario.entity';
import { UsuarioTenant } from '../tenants/entities/usuario-tenant.entity';
import { CajonesService } from './cajones.service';
import { CajonesController } from './cajones.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Cajon, CajonUsuario, UsuarioTenant])],
  controllers: [CajonesController],
  providers: [CajonesService],
  exports: [CajonesService],
})
export class CajonesModule {}
```

En `backend/src/app.module.ts`, agregar el import de `CajonUsuario` junto al de `Cajon` (línea ~80) y sumar `CajonUsuario,` al array `entities` (justo después de `Cajon,`, línea ~160):

```typescript
import { CajonUsuario } from './modules/cajones/entities/cajon-usuario.entity';
```

- [ ] **Step 4: Escribir los unit tests (fallan primero)**

En `backend/src/modules/cajones/cajones.service.spec.ts`, **reemplazar el bloque de imports y el `beforeEach`** para inyectar los nuevos providers, y **agregar** el `describe` de allow-list. Los imports arriba del archivo pasan a:

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CajonesService } from './cajones.service';
import { Cajon } from './entities/cajon.entity';
import { CajonUsuario } from './entities/cajon-usuario.entity';
import { UsuarioTenant } from '../tenants/entities/usuario-tenant.entity';
```

El `beforeEach` pasa a construir también los mocks nuevos (reemplaza el `providers` actual):

```typescript
  let cuRepo: {
    find: jest.Mock;
  };
  let utRepo: {
    count: jest.Mock;
  };
  let manager: {
    softDelete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    cuRepo = { find: jest.fn() };
    utRepo = { count: jest.fn() };
    manager = {
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    };
    dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajonesService,
        { provide: getRepositoryToken(Cajon), useValue: repo },
        { provide: getRepositoryToken(CajonUsuario), useValue: cuRepo },
        { provide: getRepositoryToken(UsuarioTenant), useValue: utRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<CajonesService>(CajonesService);
  });
```

Y agregar al final del archivo (dentro del `describe('CajonesService', ...)`, junto a los tests existentes) estos casos:

```typescript
  describe('allow-list de usuarios', () => {
    const CAJON = 'cajon-uuid';

    it('getUsuarios devuelve los ids habilitados y valida el cajón', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      cuRepo.find.mockResolvedValue([
        { usuarioId: 'u1' },
        { usuarioId: 'u2' },
      ]);
      const res = await service.getUsuarios(TENANT, CAJON);
      expect(res).toEqual(['u1', 'u2']);
    });

    it('getUsuarios lanza 404 si el cajón no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getUsuarios(TENANT, CAJON)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('setUsuarios agrega los que entran y no borra nada cuando parte vacío', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      utRepo.count.mockResolvedValue(2);
      cuRepo.find.mockResolvedValue([]); // sin habilitaciones vivas
      const res = await service.setUsuarios(TENANT, CAJON, ['u1', 'u2']);
      expect(res).toEqual(['u1', 'u2']);
      expect(manager.softDelete).not.toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('setUsuarios hace el diff: quita uno, agrega otro, conserva el resto', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      utRepo.count.mockResolvedValue(2);
      cuRepo.find.mockResolvedValue([
        { id: 'r-a', usuarioId: 'A' },
        { id: 'r-b', usuarioId: 'B' },
      ]);
      const res = await service.setUsuarios(TENANT, CAJON, ['A', 'C']);
      expect(res).toEqual(['A', 'C']);
      // quita B
      expect(manager.softDelete).toHaveBeenCalledWith(CajonUsuario, {
        id: expect.anything(),
      });
      // agrega solo C (no re-crea A)
      const saved = manager.save.mock.calls[0][0] as Array<{ usuarioId: string }>;
      expect(saved).toHaveLength(1);
      expect(saved[0].usuarioId).toBe('C');
    });

    it('setUsuarios idempotente: mismo set no borra ni crea', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      utRepo.count.mockResolvedValue(1);
      cuRepo.find.mockResolvedValue([{ id: 'r-a', usuarioId: 'A' }]);
      await service.setUsuarios(TENANT, CAJON, ['A']);
      expect(manager.softDelete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('setUsuarios rechaza (400) un usuario que no es del tenant', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      utRepo.count.mockResolvedValue(1); // pidieron 2, solo 1 es miembro
      await expect(
        service.setUsuarios(TENANT, CAJON, ['A', 'ajeno']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('setUsuarios con array vacío deja el cajón sin asignados (borra los vivos)', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      cuRepo.find.mockResolvedValue([{ id: 'r-a', usuarioId: 'A' }]);
      const res = await service.setUsuarios(TENANT, CAJON, []);
      expect(res).toEqual([]);
      expect(utRepo.count).not.toHaveBeenCalled(); // no valida si no hay ids
      expect(manager.softDelete).toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('setUsuarios lanza 404 si el cajón no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.setUsuarios(TENANT, CAJON, ['A']),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
```

- [ ] **Step 5: Correr los tests para verificar que fallan**

Run: `cd backend && npm test -- src/modules/cajones/cajones.service.spec.ts`
Expected: FAIL — `service.getUsuarios is not a function` / `setUsuarios is not a function`.

- [ ] **Step 6: Implementar los métodos en el service**

En `backend/src/modules/cajones/cajones.service.ts`, ampliar imports, constructor y agregar los métodos. Los imports arriba pasan a:

```typescript
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { Cajon } from './entities/cajon.entity';
import { CajonUsuario } from './entities/cajon-usuario.entity';
import { UsuarioTenant } from '../tenants/entities/usuario-tenant.entity';
import { CreateCajonDto } from './dto/create-cajon.dto';
import { UpdateCajonDto } from './dto/update-cajon.dto';
```

El constructor pasa a:

```typescript
  constructor(
    @InjectRepository(Cajon)
    private readonly cajonRepo: Repository<Cajon>,
    @InjectRepository(CajonUsuario)
    private readonly cajonUsuarioRepo: Repository<CajonUsuario>,
    @InjectRepository(UsuarioTenant)
    private readonly usuarioTenantRepo: Repository<UsuarioTenant>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}
```

Y agregar estos métodos (los métodos `create`/`update`/`remove`/`validarNombreUnico` existentes **no se tocan**):

```typescript
  async getUsuarios(tenantId: string, cajonId: string): Promise<string[]> {
    await this.getCajonOrFail(tenantId, cajonId);
    const rows = await this.cajonUsuarioRepo.find({
      where: { cajonId, tenantId },
      order: { creadoEl: 'ASC' },
    });
    return rows.map((r) => r.usuarioId);
  }

  async setUsuarios(
    tenantId: string,
    cajonId: string,
    usuarioIds: string[],
  ): Promise<string[]> {
    await this.getCajonOrFail(tenantId, cajonId);
    const ids = [...new Set(usuarioIds)];

    if (ids.length > 0) {
      const miembros = await this.usuarioTenantRepo.count({
        where: { tenantId, usuarioId: In(ids) },
      });
      if (miembros !== ids.length) {
        throw new BadRequestException(
          'Algún usuario no pertenece a este tenant',
        );
      }
    }

    const vivos = await this.cajonUsuarioRepo.find({
      where: { cajonId, tenantId },
    });
    const vivosIds = new Set(vivos.map((r) => r.usuarioId));
    const querido = new Set(ids);
    const quitar = vivos.filter((r) => !querido.has(r.usuarioId));
    const agregar = ids.filter((id) => !vivosIds.has(id));

    await this.dataSource.transaction(async (manager) => {
      if (quitar.length > 0) {
        await manager.softDelete(CajonUsuario, {
          id: In(quitar.map((r) => r.id)),
        });
      }
      if (agregar.length > 0) {
        await manager.save(
          agregar.map((usuarioId) =>
            manager.create(CajonUsuario, { tenantId, cajonId, usuarioId }),
          ),
        );
      }
    });

    return ids;
  }

  private async getCajonOrFail(
    tenantId: string,
    cajonId: string,
  ): Promise<Cajon> {
    const cajon = await this.cajonRepo.findOne({
      where: { id: cajonId, tenantId },
    });
    if (!cajon) throw new NotFoundException(`Cajón ${cajonId} no encontrado`);
    return cajon;
  }
```

- [ ] **Step 7: Correr los tests para verificar que pasan**

Run: `cd backend && npm test -- src/modules/cajones/cajones.service.spec.ts`
Expected: PASS (los 7 del sub-1 + los 8 nuevos = 15).

- [ ] **Step 8: Typecheck y lint**

Run: `cd backend && npm run typecheck && npm run lint:check`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/cajones backend/src/app.module.ts
git commit -m "feat(cajones): allow-list cajón↔usuario — entidad + service (get/set) + unit tests"
```

---

### Task 2: Backend — endpoints `GET`/`PUT /cajones/:id/usuarios` + e2e

**Files:**
- Modify: `backend/src/modules/cajones/cajones.controller.ts` (dos endpoints nuevos)
- Test: `backend/test/cajones.e2e-spec.ts` (agregar un `describe` de allow-list)

**Interfaces:**
- Consumes: `CajonesService.getUsuarios`/`setUsuarios` (Task 1); `SetCajonUsuariosDto` (Task 1).
- Produces: rutas `GET/PUT /api/cajones/:id/usuarios`.

- [ ] **Step 1: Agregar los endpoints al controller**

En `backend/src/modules/cajones/cajones.controller.ts`, agregar el import del DTO y `Put`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
```

```typescript
import { SetCajonUsuariosDto } from './dto/set-cajon-usuarios.dto';
```

Y agregar dentro de la clase (después de `remove`):

```typescript
  @RequiresPermiso('Cajas', 'Leer')
  @Get(':id/usuarios')
  getUsuarios(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.getUsuarios(user.tenantId, id);
  }

  @RequiresPermiso('Cajas', 'Actualizar')
  @Put(':id/usuarios')
  setUsuarios(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SetCajonUsuariosDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.setUsuarios(user.tenantId, id, dto.usuarioIds);
  }
```

- [ ] **Step 2: Verificar que compila**

Run: `cd backend && npm run typecheck && npm run lint:check`
Expected: sin errores.

- [ ] **Step 3: Escribir el e2e (falla primero)**

> Requiere Postgres arriba (`docker-compose up`) o CI. Reusa los helpers/tokens del `describe` existente de `cajones.e2e-spec.ts` (`login`, `tokenAdmin`, `tokenVendedor`, `tokenFalabella`, `PARIS_TENANT_ID`, `FALABELLA_TENANT_ID`, el array `creados` y su cleanup). Los `usuarioIds` reales del tenant Paris se obtienen dinámicamente de `GET /api/tenants/members` (evita hardcodear ids de seed).

En `backend/test/cajones.e2e-spec.ts`, agregar la interfaz de miembro cerca de las otras interfaces:

```typescript
interface Member {
  usuarioId: string;
}
```

Y agregar este `describe` **anidado dentro** del `describe('Cajones (e2e) ...')` existente (para reusar `app`, `tokenAdmin`, etc.), después de los tests del sub-1:

```typescript
  describe('allow-list de usuarios por cajón', () => {
    let cajonId: string;
    let miembros: string[];

    beforeAll(async () => {
      const resMiembros = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      miembros = (resMiembros.body as Member[]).map((m) => m.usuarioId);
      expect(miembros.length).toBeGreaterThanOrEqual(2);

      const resCajon = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: `E2E AllowList ${Date.now()}` });
      cajonId = (resCajon.body as CajonResponse).id;
      creados.push(cajonId);
    });

    it('admin asigna un conjunto y GET lo devuelve', async () => {
      const set = [miembros[0], miembros[1]];
      const resPut = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ usuarioIds: set });
      expect(resPut.status).toBe(200);

      const resGet = await request(app.getHttpServer())
        .get(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resGet.status).toBe(200);
      expect((resGet.body as string[]).sort()).toEqual([...set].sort());
    });

    it('reemplazar el conjunto refleja el diff (quita uno, agrega ninguno nuevo)', async () => {
      const resPut = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ usuarioIds: [miembros[0]] });
      expect(resPut.status).toBe(200);

      const resGet = await request(app.getHttpServer())
        .get(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resGet.body as string[]).toEqual([miembros[0]]);
    });

    it('un usuarioId ajeno al tenant devuelve 400', async () => {
      const resPut = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ usuarioIds: ['00000000-0000-4000-8000-000000000000'] });
      expect(resPut.status).toBe(400);
    });

    it('vendedor sin Cajas:Actualizar recibe 403 en el PUT', async () => {
      const resPut = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({ usuarioIds: [miembros[0]] });
      expect(resPut.status).toBe(403);
    });

    it('aislamiento: Falabella no puede tocar el allow-list de un cajón de Paris (404)', async () => {
      const resPut = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenFalabella}`)
        .send({ usuarioIds: [] });
      expect(resPut.status).toBe(404);
    });
  });
```

- [ ] **Step 4: Correr el e2e**

Run: `cd backend && npm run test:e2e -- cajones.e2e-spec.ts`
Expected: PASS (los 4 del sub-1 + los 5 nuevos = 9). (Requiere `docker-compose up`.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/cajones/cajones.controller.ts backend/test/cajones.e2e-spec.ts
git commit -m "feat(cajones): endpoints GET/PUT /cajones/:id/usuarios (allow-list) + e2e"
```

---

### Task 3: Frontend — acción "Usuarios" por cajón + drawer de checkboxes

**Files:**
- Modify: `frontend/app/pages/configuracion/cajas.vue`

**Interfaces:**
- Consumes: `GET/PUT /cajones/:id/usuarios` (Task 2); `GET /tenants/members` (existente).

- [ ] **Step 1: Agregar estado, tipos y funciones al `<script setup>`**

En `frontend/app/pages/configuracion/cajas.vue`, agregar la interfaz `Member` junto a `Cajon`:

```typescript
interface Member {
  usuarioId: string
  nombre: string
  apellido: string | null
}
```

Y agregar el estado del drawer de usuarios (después de las líneas del drawer de edición, junto a `toggling`):

```typescript
const usuariosDrawerOpen = ref(false)
const usuariosCajonId = ref<string | null>(null)
const usuariosCajonNombre = ref('')
const miembros = ref<Member[]>([])
const miembrosCargados = ref(false)
const seleccionados = ref<string[]>([])
const loadingUsuarios = ref(false)
const savingUsuarios = ref(false)
```

Agregar las funciones (después de `eliminar`):

```typescript
function toggleSeleccion(usuarioId: string, marcado: boolean) {
  if (marcado) {
    if (!seleccionados.value.includes(usuarioId)) seleccionados.value = [...seleccionados.value, usuarioId]
  }
  else {
    seleccionados.value = seleccionados.value.filter(id => id !== usuarioId)
  }
}

async function abrirUsuarios(c: Cajon) {
  usuariosCajonId.value = c.id
  usuariosCajonNombre.value = c.nombre
  usuariosDrawerOpen.value = true
  loadingUsuarios.value = true
  try {
    const [mem, asignados] = await Promise.all([
      miembrosCargados.value
        ? Promise.resolve(miembros.value)
        : useApiFetch<Member[]>(`${apiUrl}/tenants/members`),
      useApiFetch<string[]>(`${apiUrl}/cajones/${c.id}/usuarios`),
    ])
    miembros.value = mem
    miembrosCargados.value = true
    seleccionados.value = asignados
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar usuarios'), color: 'error' })
    usuariosDrawerOpen.value = false
  }
  finally {
    loadingUsuarios.value = false
  }
}

async function guardarUsuarios() {
  if (!usuariosCajonId.value) return
  savingUsuarios.value = true
  try {
    await useApiFetch(`${apiUrl}/cajones/${usuariosCajonId.value}/usuarios`, {
      method: 'PUT',
      body: { usuarioIds: seleccionados.value },
    })
    toast.add({ title: 'Usuarios actualizados', color: 'success' })
    usuariosDrawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar usuarios'), color: 'error' })
  }
  finally {
    savingUsuarios.value = false
  }
}
```

- [ ] **Step 2: Agregar el botón de acción en la columna**

En el `<template #acciones-cell>`, agregar (antes del botón de editar) un botón "Usuarios" gateado por `puedeActualizar` (asignar usuarios = editar la config del cajón):

```vue
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-users"
            color="neutral"
            variant="ghost"
            @click="abrirUsuarios(row.original)"
          />
```

- [ ] **Step 3: Agregar el drawer de usuarios**

Después del `AppDrawer` de edición existente (antes del `CrudModal`), agregar:

```vue
    <AppDrawer v-model:open="usuariosDrawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">Usuarios habilitados — {{ usuariosCajonNombre }}</span>
      </template>

      <template #body>
        <div v-if="loadingUsuarios" class="py-8 text-center text-sm text-muted">
          Cargando…
        </div>
        <div v-else class="space-y-4">
          <p class="text-sm text-muted">
            Marcá quién puede abrir esta caja. Si no seleccionás a nadie, cualquiera con permiso de caja puede abrirla.
          </p>
          <div v-if="miembros.length === 0" class="text-sm text-muted">
            No hay usuarios en el tenant.
          </div>
          <div v-else class="space-y-2">
            <div v-for="m in miembros" :key="m.usuarioId" class="flex items-center gap-2">
              <UCheckbox
                :model-value="seleccionados.includes(m.usuarioId)"
                @update:model-value="(v: boolean) => toggleSeleccion(m.usuarioId, v)"
              />
              <span class="text-sm text-default">{{ m.nombre }} {{ m.apellido ?? '' }}</span>
            </div>
          </div>
        </div>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { usuariosDrawerOpen = false }">
          Cancelar
        </UButton>
        <UButton :loading="savingUsuarios" @click="guardarUsuarios">
          Guardar
        </UButton>
      </template>
    </AppDrawer>
```

- [ ] **Step 4: Verificar build, typecheck y design**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/configuracion/cajas.vue
git commit -m "feat(cajones): acción Usuarios por cajón (allow-list) en Configuración → Cajas"
```

---

### Task 4: Docs + esquema de referencia

**Files:**
- Modify: `docs/features/gestion-cajas.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/agent/investigaciones/2026-07-23-gestion-caja.md` (§9)
- Modify: `startup-pos.sql`

- [ ] **Step 1: Documentar en `gestion-cajas.md`**

Agregar una subsección "Autorización: qué usuarios abren qué cajones (allow-list)" bajo la sección de definición de cajones del sub-1, que explique:
- La entidad `cajon_usuario` (mapeo N‑a‑N tenant-owned: `cajon_id`, `usuario_id`, soft delete, índice único parcial).
- Los endpoints `GET /cajones/:id/usuarios` (`Cajas:Leer`) y `PUT /cajones/:id/usuarios` (`Cajas:Actualizar`, replace-set).
- La **regla de lista vacía = permisivo** (cajón sin asignados = abierto a cualquiera con `MiCaja:Crear`), y que el **enforcement al abrir llega en el sub-proyecto 3** (hoy el mapeo se persiste pero no bloquea nada).
- La **ortogonalidad**: `MiCaja:Crear` = "puede operar caja"; el allow-list = "en cuáles cajones". Se cruzan al abrir.
- Nota: la pertenencia se valida contra `usuarios_tenants` (miembros del tenant).

- [ ] **Step 2: Actualizar `docs/ESTADO.md`**

Agregar una fila para "Allow-list cajón↔usuario (Configuración → Cajas)" con estado ✅ y la fecha 2026-07-23, siguiendo el formato de las filas existentes.

- [ ] **Step 3: Marcar el sub-proyecto en la investigación §9**

En `docs/agent/investigaciones/2026-07-23-gestion-caja.md`, en el roadmap §9, actualizar el item 2 a implementado y enlazar la spec y el plan:

```markdown
- [x] **2. Autorización: qué usuarios abren qué cajones** — ✅ implementado (definición del
  allow-list; enforcement al abrir en el sub-3). Mapeo N‑a‑N `cajon_usuario`, gestión desde el
  cajón (`GET`/`PUT /cajones/:id/usuarios`, permisos `Cajas`). Lista vacía = permisivo. Spec:
  [`2026-07-23-cajones-allowlist-usuarios-design.md`](../../superpowers/specs/2026-07-23-cajones-allowlist-usuarios-design.md) ·
  Plan: [`2026-07-23-cajones-allowlist-usuarios.md`](../../superpowers/plans/2026-07-23-cajones-allowlist-usuarios.md).
```

- [ ] **Step 4: Agregar la tabla al esquema de referencia `startup-pos.sql`**

Agregar cerca de la tabla `cajones` (después de su índice, ~línea 840), como documentación del esquema (en dev la crea `synchronize`):

```sql
CREATE TABLE "cajon_usuario" (
  "cajon_usuario_id" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "cajon_id"         UUID          NOT NULL REFERENCES "cajones" ("cajon_id"),
  "usuario_id"       UUID          NOT NULL REFERENCES "usuarios" ("usuario_id"),
  "tenant_id"        UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "creado_el"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "eliminado_el"     TIMESTAMPTZ
);
CREATE UNIQUE INDEX "ux_cajon_usuario_cajon_usuario"
  ON "cajon_usuario" ("cajon_id", "usuario_id")
  WHERE "eliminado_el" IS NULL;
```

- [ ] **Step 5: Commit**

```bash
git add docs/features/gestion-cajas.md docs/ESTADO.md docs/agent/investigaciones/2026-07-23-gestion-caja.md startup-pos.sql
git commit -m "docs(cajones): documentar allow-list cajón↔usuario + esquema de referencia"
```

---

## Verificación final (gate completo)

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Todo verde. Verificar además: `tenant_id` siempre del token; soft delete en todo; enforcement real por `@RequiresPermiso` (usuario sin `Cajas:Actualizar` → 403); validación de pertenencia contra `usuarios_tenants` (usuario ajeno → 400); sin N+1 (validación en un `count`, diff batch); el diff dentro de una transacción; la tabla `cajas` y el `caja.controller/service` **sin tocar**; **sin enforcement al abrir** (eso es el sub-proyecto 3).
