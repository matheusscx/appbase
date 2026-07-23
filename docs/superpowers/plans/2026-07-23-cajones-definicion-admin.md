# Definición de cajones (Configuración → Cajas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introducir el **cajón físico** como entidad tenant-owned que el admin define en Configuración → Cajas (CRUD), sin tocar aún la sesión de caja.

**Architecture:** Módulo backend standalone `cajones` (entity + DTOs + service + controller), gateado por **permisos RBAC del módulo `Cajas`** (`@RequiresPermiso` + `PermisosGuard`) — se extiende el módulo `Cajas` existente con `Crear`/`Actualizar`/`Eliminar`. Página de config `configuracion/cajas.vue` con `useApiFetch` directo (molde `recargos.vue`), nav y botones gateados por `Cajas`. Tabla `cajones` creada por `synchronize` en dev. No se toca la tabla `cajas` ni el controller/service de `MiCaja`/`Cajas` (solo se agregan permisos al módulo `Cajas` vía seed).

**Tech Stack:** NestJS + TypeORM (Postgres), Nuxt 4 (Vue 3) + Nuxt UI, Jest + supertest (e2e).

**Spec:** `docs/superpowers/specs/2026-07-23-cajones-definicion-admin-design.md`

## Global Constraints

- **`tenant_id` siempre del token** (`req.user.tenantId`), nunca del body/query/param.
- **Soft delete en todo**: `DELETE` = `softDelete` (marca `eliminado_el`); nunca borrado físico. TypeORM con `@DeleteDateColumn` **excluye soft-deleted automáticamente** en `find`/`findOne`/`count`.
- **PK/FK con `type: 'uuid'` explícito** (ADR-004): `cajon_id` es `@PrimaryGeneratedColumn('uuid', { name: 'cajon_id' })`.
- **`nombre` único por tenant** entre no-borrados → **409 `ConflictException`** (idiomático: el módulo `caja` ya usa 409). Doble enforcement: check de `count` en el service (mensaje amable, como `recargos`) **+** índice único parcial en la entidad (`@Index … WHERE eliminado_el IS NULL`, garantía dura bajo concurrencia).
- **RBAC por endpoint** (`@RequiresPermiso('Cajas', <permiso>)`; clase bajo `JwtAuthGuard + TenantGuard + PermisosGuard`): GET→`Leer`, POST→`Crear`, PATCH→`Actualizar`, DELETE→`Eliminar`. Se **extiende el módulo `Cajas`** (id `...440282`) con `Crear`/`Actualizar`/`Eliminar` (hoy solo tiene `Leer`). El admin `es_fijo` los obtiene por short-circuit. `RbacModule` es `@Global` → `PermisosGuard` resuelve sin imports extra.
- **Terminología (no mezclar):** entidad/tabla `cajones` (`Cajon`) = el mueble físico; tabla `cajas` (`Caja`) = la sesión/turno, **no se toca en este sub-proyecto**. Etiqueta UI: "Cajas". Reusar el módulo de permisos `Cajas` NO es tocar la tabla `cajas` ni el caja.controller/service — solo se agregan filas `modulo_app_permiso`.
- **Reconciliaciones con la spec:** `DELETE` devuelve **200** (default de Nest para void, como `recargos`), no 204. La spec decía "409" para duplicado — se implementa con `ConflictException` (409); "204" en delete se ajusta a 200.
- **Frontend:** `useApiFetch` (nunca axios); tokens semánticos de Nuxt UI (sin Tailwind hardcodeado); la página no contiene lógica de negocio.
- **Seed:** IDs fijos patrón `550e8400-e29b-41d4-a716-446655440XXX`; libres: **440286** (cajón Paris `...440007`), **440287** (cajón Falabella `...440040`), **440288/289/290** (`modulo_app_permiso` Cajas↔Crear/Actualizar/Eliminar). Permisos globales: Leer `...440012`, Crear `...440013`, Actualizar `...440014`, Eliminar `...440015`.

---

### Task 1: Backend — entidad `cajones`, DTOs y service (con unit tests)

**Files:**
- Create: `backend/src/modules/cajones/entities/cajon.entity.ts`
- Create: `backend/src/modules/cajones/dto/create-cajon.dto.ts`
- Create: `backend/src/modules/cajones/dto/update-cajon.dto.ts`
- Create: `backend/src/modules/cajones/cajones.service.ts`
- Test: `backend/src/modules/cajones/cajones.service.spec.ts`

**Interfaces:**
- Produces: `Cajon` (entity), `CajonesService` con `findAll(tenantId: string): Promise<Cajon[]>`, `create(tenantId, dto: CreateCajonDto): Promise<Cajon>`, `update(tenantId, id, dto: UpdateCajonDto): Promise<Cajon>`, `remove(tenantId, id): Promise<void>`.

- [ ] **Step 1: Crear la entidad**

`backend/src/modules/cajones/entities/cajon.entity.ts`:

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

// Índice único parcial: nombre único por tenant entre no-borrados. Es la garantía
// dura (bajo concurrencia el check de `count` del service podría saltearse); el
// service igual valida primero para devolver un 409 con mensaje amable.
@Entity('cajones')
@Index('ux_cajones_tenant_nombre', ['tenantId', 'nombre'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class Cajon {
  @PrimaryGeneratedColumn('uuid', { name: 'cajon_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 2: Crear los DTOs**

`backend/src/modules/cajones/dto/create-cajon.dto.ts`:

```typescript
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCajonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nombre: string;
}
```

`backend/src/modules/cajones/dto/update-cajon.dto.ts`:

```typescript
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCajonDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
```

- [ ] **Step 3: Escribir el unit test (falla primero)**

`backend/src/modules/cajones/cajones.service.spec.ts`:

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CajonesService } from './cajones.service';
import { Cajon } from './entities/cajon.entity';

const TENANT = 'tenant-uuid';

describe('CajonesService', () => {
  let service: CajonesService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajonesService,
        { provide: getRepositoryToken(Cajon), useValue: repo },
      ],
    }).compile();

    service = module.get<CajonesService>(CajonesService);
  });

  it('findAll filtra por tenant y ordena por nombre', async () => {
    repo.find.mockResolvedValue([]);
    await service.findAll(TENANT);
    expect(repo.find).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      order: { nombre: 'ASC' },
    });
  });

  it('create rechaza nombre duplicado con 409', async () => {
    repo.count.mockResolvedValue(1);
    await expect(
      service.create(TENANT, { nombre: 'Mostrador' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('create guarda cuando el nombre es único', async () => {
    repo.count.mockResolvedValue(0);
    const res = await service.create(TENANT, { nombre: 'Mostrador' });
    expect(repo.save).toHaveBeenCalled();
    expect(res).toMatchObject({ tenantId: TENANT, nombre: 'Mostrador' });
  });

  it('update lanza 404 si el cajón no existe', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.update(TENANT, 'x', { nombre: 'A' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update renombra validando unicidad y togglea activo', async () => {
    repo.findOne.mockResolvedValue({
      id: 'x',
      tenantId: TENANT,
      nombre: 'Viejo',
      activo: true,
    });
    repo.count.mockResolvedValue(0);
    const res = await service.update(TENANT, 'x', { nombre: 'Nuevo', activo: false });
    expect(res).toMatchObject({ nombre: 'Nuevo', activo: false });
  });

  it('remove hace soft delete', async () => {
    repo.findOne.mockResolvedValue({ id: 'x', tenantId: TENANT });
    await service.remove(TENANT, 'x');
    expect(repo.softDelete).toHaveBeenCalledWith({ id: 'x', tenantId: TENANT });
  });

  it('remove lanza 404 si no existe', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.remove(TENANT, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 4: Correr el test para verificar que falla**

Run: `cd backend && npm test -- src/modules/cajones/cajones.service.spec.ts`
Expected: FAIL — `Cannot find module './cajones.service'` (aún no existe).

- [ ] **Step 5: Implementar el service**

`backend/src/modules/cajones/cajones.service.ts`:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Cajon } from './entities/cajon.entity';
import { CreateCajonDto } from './dto/create-cajon.dto';
import { UpdateCajonDto } from './dto/update-cajon.dto';

@Injectable()
export class CajonesService {
  constructor(
    @InjectRepository(Cajon)
    private readonly cajonRepo: Repository<Cajon>,
  ) {}

  findAll(tenantId: string): Promise<Cajon[]> {
    return this.cajonRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  async create(tenantId: string, dto: CreateCajonDto): Promise<Cajon> {
    await this.validarNombreUnico(tenantId, dto.nombre);
    const cajon = this.cajonRepo.create({ tenantId, nombre: dto.nombre });
    return this.cajonRepo.save(cajon);
  }

  async update(tenantId: string, id: string, dto: UpdateCajonDto): Promise<Cajon> {
    const cajon = await this.cajonRepo.findOne({ where: { id, tenantId } });
    if (!cajon) throw new NotFoundException(`Cajón ${id} no encontrado`);
    if (dto.nombre != null && dto.nombre !== cajon.nombre) {
      await this.validarNombreUnico(tenantId, dto.nombre, id);
      cajon.nombre = dto.nombre;
    }
    if (dto.activo != null) cajon.activo = dto.activo;
    return this.cajonRepo.save(cajon);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const cajon = await this.cajonRepo.findOne({ where: { id, tenantId } });
    if (!cajon) throw new NotFoundException(`Cajón ${id} no encontrado`);
    await this.cajonRepo.softDelete({ id, tenantId });
  }

  private async validarNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const count = await this.cajonRepo.count({
      where: excludeId
        ? { tenantId, nombre, id: Not(excludeId) }
        : { tenantId, nombre },
    });
    if (count > 0) {
      throw new ConflictException(`Ya existe un cajón con el nombre "${nombre}"`);
    }
  }
}
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `cd backend && npm test -- src/modules/cajones/cajones.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Typecheck y lint**

Run: `cd backend && npm run typecheck && npm run lint:check`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/cajones
git commit -m "feat(cajones): entidad y service de definición de cajones + unit tests"
```

---

### Task 2: Backend — controller, módulo y registro + e2e

**Files:**
- Create: `backend/src/modules/cajones/cajones.controller.ts`
- Create: `backend/src/modules/cajones/cajones.module.ts`
- Modify: `backend/src/app.module.ts` (import + array `imports`)
- Test: `backend/test/cajones.e2e-spec.ts`

**Interfaces:**
- Consumes: `CajonesService` (Task 1).
- Produces: rutas `GET/POST/PATCH/DELETE /api/cajones` (admin-only).

- [ ] **Step 1: Crear el controller**

`backend/src/modules/cajones/cajones.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { CajonesService } from './cajones.service';
import { CreateCajonDto } from './dto/create-cajon.dto';
import { UpdateCajonDto } from './dto/update-cajon.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('cajones')
export class CajonesController {
  constructor(private readonly cajonesService: CajonesService) {}

  @RequiresPermiso('Cajas', 'Leer')
  @Get()
  findAll(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.findAll(user.tenantId);
  }

  @RequiresPermiso('Cajas', 'Crear')
  @Post()
  create(@Req() req: Request, @Body() dto: CreateCajonDto) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.create(user.tenantId, dto);
  }

  @RequiresPermiso('Cajas', 'Actualizar')
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCajonDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.update(user.tenantId, id, dto);
  }

  @RequiresPermiso('Cajas', 'Eliminar')
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.remove(user.tenantId, id);
  }
}
```

> `PermisosGuard` resuelve `RbacService` (módulo `@Global`) — el `cajones.module.ts` **no** necesita importar `RbacModule`.

- [ ] **Step 2: Crear el módulo**

`backend/src/modules/cajones/cajones.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cajon } from './entities/cajon.entity';
import { CajonesService } from './cajones.service';
import { CajonesController } from './cajones.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Cajon])],
  controllers: [CajonesController],
  providers: [CajonesService],
  exports: [CajonesService],
})
export class CajonesModule {}
```

- [ ] **Step 3: Registrar en `app.module.ts`**

En `backend/src/app.module.ts`, agregar el import junto a los demás módulos (justo después del import de `CajaModule`):

```typescript
import { CajonesModule } from './modules/cajones/cajones.module';
```

Y agregar `CajonesModule,` al array `imports: [ ... ]` (justo después de `CajaModule,`).

- [ ] **Step 4: Verificar que compila y arranca**

Run: `cd backend && npm run typecheck && npm run lint:check`
Expected: sin errores.

- [ ] **Step 5: Escribir el e2e**

> Requiere Postgres arriba (`docker-compose up`) o CI. Passwords de dev = `admin` para todos los usuarios sembrados. `admin.paris@paris.cl` es admin `es_fijo` de Paris → short-circuit, obtiene todos los permisos de `Cajas`. `vendedor@paris.cl` tiene `MiCaja` pero **no** `Cajas` → 403 en `/cajones`. `contacto@falabella.cl` es admin `es_fijo` de Falabella (otro tenant); si no lo fuera, usar el admin real de Falabella.

`backend/test/cajones.e2e-spec.ts`:

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const VENDEDOR_PARIS = { email: 'vendedor@paris.cl', pass: 'admin' }; // MiCaja, sin Cajas
const ADMIN_FALABELLA = { email: 'contacto@falabella.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface CajonResponse {
  id: string;
  nombre: string;
  activo: boolean;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
  tenantId: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Cajones (e2e) — CRUD admin-only + aislamiento', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenFalabella: string;
  const creados: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    tokenAdmin = await login(app, ADMIN_PARIS.email, ADMIN_PARIS.pass, PARIS_TENANT_ID);
    tokenVendedor = await login(app, VENDEDOR_PARIS.email, VENDEDOR_PARIS.pass, PARIS_TENANT_ID);
    tokenFalabella = await login(app, ADMIN_FALABELLA.email, ADMIN_FALABELLA.pass, FALABELLA_TENANT_ID);
  });

  afterAll(async () => {
    for (const id of creados) {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    }
    await app.close();
  });

  it('admin crea, lista, renombra/desactiva y borra un cajón', async () => {
    const nombre = `E2E Cajón ${Date.now()}`;
    const resCrear = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(resCrear.status).toBe(201);
    const id = (resCrear.body as CajonResponse).id;
    creados.push(id);

    const resLista = await request(app.getHttpServer())
      .get('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resLista.status).toBe(200);
    expect((resLista.body as CajonResponse[]).some((c) => c.id === id)).toBe(true);

    const resPatch = await request(app.getHttpServer())
      .patch(`/api/cajones/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `${nombre} v2`, activo: false });
    expect(resPatch.status).toBe(200);
    expect((resPatch.body as CajonResponse).activo).toBe(false);

    const resDel = await request(app.getHttpServer())
      .delete(`/api/cajones/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDel.status).toBe(200);
  });

  it('nombre duplicado en el mismo tenant devuelve 409', async () => {
    const nombre = `Dup ${Date.now()}`;
    const r1 = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(r1.status).toBe(201);
    creados.push((r1.body as CajonResponse).id);

    const r2 = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(r2.status).toBe(409);
  });

  it('vendedor (no admin) recibe 403 en todos los endpoints', async () => {
    const get = await request(app.getHttpServer())
      .get('/api/cajones')
      .set('Authorization', `Bearer ${tokenVendedor}`);
    expect(get.status).toBe(403);

    const post = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ nombre: 'X' });
    expect(post.status).toBe(403);
  });

  it('aislamiento multi-tenant: Falabella no ve un cajón de Paris', async () => {
    const nombre = `Solo Paris ${Date.now()}`;
    const resCrear = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(resCrear.status).toBe(201);
    creados.push((resCrear.body as CajonResponse).id);

    const resFalabella = await request(app.getHttpServer())
      .get('/api/cajones')
      .set('Authorization', `Bearer ${tokenFalabella}`);
    expect(resFalabella.status).toBe(200);
    expect((resFalabella.body as CajonResponse[]).some((c) => c.nombre === nombre)).toBe(false);
  });
});
```

- [ ] **Step 6: Correr el e2e**

Run: `cd backend && npm run test:e2e -- cajones.e2e-spec.ts`
Expected: PASS (4 tests). (Requiere `docker-compose up`.)

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/cajones/cajones.controller.ts backend/src/modules/cajones/cajones.module.ts backend/src/app.module.ts backend/test/cajones.e2e-spec.ts
git commit -m "feat(cajones): controller admin-only + registro en app.module + e2e"
```

---

### Task 3: Backend — seed (permisos RBAC del módulo `Cajas` + cajones demo)

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Modify: `backend/src/modules/seeder/seeder.module.ts` (registrar `Cajon` en `forFeature`)

**Interfaces:**
- Consumes: `Cajon` entity (Task 1); módulo `Cajas` (`...440282`) y permisos globales `CREAR`/`ACTUALIZAR`/`ELIMINAR` ya sembrados.

- [ ] **Step 1: Inyectar el repo y el import**

En `backend/src/modules/seeder/seeder.service.ts`:
1. Agregar el import junto a los demás de entities:

```typescript
import { Cajon } from '../cajones/entities/cajon.entity';
```

2. Agregar al constructor (junto a los otros `@InjectRepository`):

```typescript
    @InjectRepository(Cajon)
    private readonly cajonRepo: Repository<Cajon>,
```

3. Registrar `Cajon` en el `TypeOrmModule.forFeature([...])` del `seeder.module.ts` (agregar el import de `Cajon` y sumarlo al array).

- [ ] **Step 2: Agregar el método de seed idempotente**

Agregar el método (junto a `seedCajasVirtuales`), copiando el patrón find-or-create:

```typescript
  private async seedCajones(): Promise<void> {
    const cajones: Array<{ id: string; tenantId: string; nombre: string }> = [
      {
        id: '550e8400-e29b-41d4-a716-446655440286',
        tenantId: '550e8400-e29b-41d4-a716-446655440007', // Paris
        nombre: 'Mostrador',
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440287',
        tenantId: '550e8400-e29b-41d4-a716-446655440040', // Falabella
        nombre: 'Mostrador',
      },
    ];

    for (const data of cajones) {
      const exists = await this.cajonRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.cajonRepo.save(
          this.cajonRepo.create({
            id: data.id,
            tenantId: data.tenantId,
            nombre: data.nombre,
          }),
        );
      }
    }
  }
```

- [ ] **Step 3: Invocar el método en el flujo de seed**

Ubicar la llamada existente `await this.seedCajasVirtuales();` en el método orquestador del seeder y agregar debajo:

```typescript
    await this.seedCajones();
```

- [ ] **Step 4: Sembrar los permisos RBAC del módulo `Cajas`**

En `seeder.service.ts`, en el método que construye el array `entries: Partial<ModuloAppPermiso>[]` (asociaciones módulo↔permiso), **justo después** de la fila `Cajas`↔`LEER` (`moduloAppPermisoId: '...440283'`, `moduloAppId: '...440282'`), agregar tres filas usando las constantes `CREAR`/`ACTUALIZAR`/`ELIMINAR` ya definidas en ese método:

```typescript
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440288',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Cajas
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440289',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Cajas
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440290',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Cajas
        permisoId: ELIMINAR,
      },
```

Los `tenant_modulos` de `Cajas` (Paris `...440284`, Falabella `...440285`) ya existen — no se agregan. El admin `es_fijo` obtiene estos permisos por short-circuit.

- [ ] **Step 5: Verificar que el seed corre y crea la tabla + filas**

Run: `cd backend && npm run typecheck && npm run lint:check`
Expected: sin errores. (En dev, `synchronize` crea la tabla `cajones` al arrancar; con `docker-compose up` el seed inserta los dos cajones y las asociaciones de permiso. Verificación manual opcional: `GET /api/cajones` como admin de Paris devuelve "Mostrador".)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/seeder
git commit -m "feat(cajones): seed permisos Cajas (Crear/Actualizar/Eliminar) + cajón demo por tenant"
```

---

### Task 4: Frontend — página `configuracion/cajas.vue` + entrada de nav

**Files:**
- Create: `frontend/app/pages/configuracion/cajas.vue`
- Modify: `frontend/app/pages/configuracion.vue` (agregar item de nav)

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /cajones` (Task 2).

- [ ] **Step 1: Crear la página**

`frontend/app/pages/configuracion/cajas.vue`:

```vue
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface Cajon {
  id: string
  nombre: string
  activo: boolean
}

const runtimeConfig = useRuntimeConfig()
const toast = useToast()
const perms = usePermissionsStore()
const apiUrl = runtimeConfig.public.apiUrl

const cajones = ref<Cajon[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const emptyForm = () => ({ nombre: '', activo: true })
const form = ref(emptyForm())

const drawerTitle = computed(() => (editingId.value ? 'Editar caja' : 'Nueva caja'))
const submitLabel = computed(() => (editingId.value ? 'Guardar' : 'Crear'))

// Gateo de UX (el backend igual enforcea con @RequiresPermiso)
const puedeCrear = computed(() => perms.esAdmin || perms.can('Cajas', 'Crear'))
const puedeActualizar = computed(() => perms.esAdmin || perms.can('Cajas', 'Actualizar'))
const puedeEliminar = computed(() => perms.esAdmin || perms.can('Cajas', 'Eliminar'))

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

async function cargar() {
  loading.value = true
  try {
    cajones.value = await useApiFetch<Cajon[]>(`${apiUrl}/cajones`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar cajas'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: Cajon) {
  const idx = cajones.value.findIndex(c => c.id === saved.id)
  if (idx >= 0) cajones.value[idx] = saved
  else cajones.value.push(saved)
  cajones.value = [...cajones.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(c: Cajon) {
  resetDrawer()
  editingId.value = c.id
  form.value = { nombre: c.nombre, activo: c.activo }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const isNew = !editingId.value
    const body = { nombre: form.value.nombre, activo: form.value.activo }
    const saved = isNew
      ? await useApiFetch<Cajon>(`${apiUrl}/cajones`, { method: 'POST', body: { nombre: body.nombre } })
      : await useApiFetch<Cajon>(`${apiUrl}/cajones/${editingId.value}`, { method: 'PATCH', body })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Caja creada' : 'Caja actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(c: Cajon) {
  if (toggling.has(c.id)) return
  toggling.add(c.id)
  const prev = c.activo
  c.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/cajones/${c.id}`, { method: 'PATCH', body: { activo: c.activo } })
    toast.add({ title: c.activo ? 'Caja activada' : 'Caja desactivada', color: 'success' })
  }
  catch (e: unknown) {
    c.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(c.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/cajones/${id}`, { method: 'DELETE' })
    cajones.value = cajones.value.filter(c => c.id !== id)
    toast.add({ title: 'Caja eliminada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

onMounted(() => {
  cargar()
})

const columns: TableColumn<Cajon>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Cajas"
      description="Cajones físicos del local (Mostrador, Delivery, Barra…)."
    >
      <template #actions>
        <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrear">
          Nueva caja
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="cajones" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <p class="font-medium truncate">
          {{ row.original.nombre }}
        </p>
      </template>

      <template #activo-cell="{ row }">
        <div class="flex justify-end">
          <USwitch
            :model-value="row.original.activo"
            :disabled="toggling.has(row.original.id) || !puedeActualizar"
            @update:model-value="toggleActivo(row.original)"
          />
        </div>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex justify-end gap-2">
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            @click="abrirEditar(row.original)"
          />
          <UButton
            v-if="puedeEliminar"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay cajas registradas.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="cajon-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Mostrador" autofocus />
          </UFormField>

          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
          Cancelar
        </UButton>
        <UButton type="submit" form="cajon-form" :loading="saving">
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar caja"
      message="¿Estás seguro de que quieres eliminar esta caja? Esta acción no se puede deshacer."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
```

- [ ] **Step 2: Agregar la entrada de navegación**

En `frontend/app/pages/configuracion.vue`, agregar un **bloque condicional propio** (fuera del bloque `esAdmin`, junto a los de Salones/Impresoras), gateado por `Cajas:Leer`:

```typescript
  if (permissionsStore.esAdmin || permissionsStore.can('Cajas', 'Leer')) {
    items.push({
      label: 'Cajas',
      icon: 'i-lucide-inbox',
      to: '/configuracion/cajas',
    })
  }
```

- [ ] **Step 3: Verificar build, typecheck y design**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/configuracion/cajas.vue frontend/app/pages/configuracion.vue
git commit -m "feat(cajones): página Configuración → Cajas (CRUD)"
```

---

### Task 5: Docs + esquema de referencia

**Files:**
- Modify: `docs/features/gestion-cajas.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/agent/investigaciones/2026-07-23-gestion-caja.md` (§9)
- Modify: `startup-pos.sql`

- [ ] **Step 1: Documentar en `gestion-cajas.md`**

Agregar una sección "Definición de cajones (Configuración → Cajas)" que explique:
- La entidad `cajones` (tenant-owned: `cajon_id`, `tenant_id`, `nombre`, `activo`, soft delete).
- Los endpoints `GET/POST/PATCH/DELETE /cajones`, gateados por `@RequiresPermiso('Cajas', Leer/Crear/Actualizar/Eliminar)` — el módulo `Cajas` se **extendió** con las acciones de escritura (antes solo `Leer`), gobernando tanto la supervisión de sesiones como la definición de cajones.
- La regla: `nombre` único por tenant → 409.
- **Nota de terminología:** `cajones` (mueble físico, este módulo) ≠ `cajas` (la sesión/turno). Sub-proyecto 1 de 3 del refactor general (ver investigación §9); el vínculo `cajon_id` en la sesión llega en el sub-proyecto 3.

Actualizar también la tabla de permisos en `docs/features/roles-permisos.md` si lista las acciones por módulo (agregar `Crear`/`Actualizar`/`Eliminar` a `Cajas`).

- [ ] **Step 2: Actualizar `docs/ESTADO.md`**

Agregar una fila para "Definición de cajones (Configuración → Cajas)" con estado ✅ y la fecha, siguiendo el formato de las filas existentes.

- [ ] **Step 3: Marcar el sub-proyecto en la investigación §9**

En `docs/agent/investigaciones/2026-07-23-gestion-caja.md`, en el roadmap §9, actualizar el item 1 a implementado y enlazar este plan:

```markdown
- [x] **1. Definición de cajones (admin)** — ✅ implementado. CRUD de cajones físicos por
  tenant (entidad `cajones`, config admin-only). Spec:
  [`2026-07-23-cajones-definicion-admin-design.md`](../../superpowers/specs/2026-07-23-cajones-definicion-admin-design.md) ·
  Plan: [`2026-07-23-cajones-definicion-admin.md`](../../superpowers/plans/2026-07-23-cajones-definicion-admin.md).
```

- [ ] **Step 4: Agregar la tabla al esquema de referencia `startup-pos.sql`**

Agregar cerca de la tabla `cajas` (línea ~790), como documentación del esquema (en dev la crea `synchronize`):

```sql
CREATE TABLE "cajones" (
  "cajon_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "creado_el" timestamptz NOT NULL DEFAULT now(),
  "actualizado_el" timestamptz NOT NULL DEFAULT now(),
  "eliminado_el" timestamptz
);
CREATE UNIQUE INDEX "ux_cajones_tenant_nombre"
  ON "cajones" ("tenant_id", "nombre")
  WHERE "eliminado_el" IS NULL;
```

- [ ] **Step 5: Commit**

```bash
git add docs/features/gestion-cajas.md docs/ESTADO.md docs/agent/investigaciones/2026-07-23-gestion-caja.md startup-pos.sql
git commit -m "docs(cajones): documentar definición de cajones + esquema de referencia"
```

---

## Verificación final (gate completo)

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Todo verde. Verificar además: `tenant_id` siempre del token; soft delete en todo; enforcement real por `@RequiresPermiso` (usuario sin `Cajas` → 403); sin refactor fuera de alcance; la tabla `cajas` y el **controller/service** de `caja` (`MiCaja`/`Cajas`) **sin tocar** — al módulo de permisos `Cajas` solo se le agregan filas `modulo_app_permiso`.
