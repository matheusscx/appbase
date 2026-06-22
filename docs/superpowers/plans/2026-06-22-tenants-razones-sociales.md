# Gestión de Tenants y Razones Sociales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que el admin de un tenant edite los datos de su empresa y gestione sus razones sociales desde `/configuracion`.

**Architecture:** Se extienden los módulos `catalog` y `tenants` existentes — no se crea ningún módulo nuevo. Backend primero (TDD), luego frontend. Los guards `TenantAdminGuard` y `TenantGuard` ya existen; solo se aplican a las rutas nuevas. El `tenantId` siempre proviene del JWT, nunca del body.

**Tech Stack:** NestJS + TypeORM + PostgreSQL (backend), Nuxt 4 + @nuxt/ui + useApiFetch (frontend), Jest (tests unitarios).

## Global Constraints

- Trabajar directamente en `main` — no crear ramas.
- Soft delete en todo: marcar `eliminado_el`, nunca borrar filas. Toda lectura filtra `eliminado_el IS NULL`.
- Columnas UUID en entidades TypeORM **deben** declarar `type: 'uuid'` explícitamente (ADR-004).
- `tenantId` siempre del token (`req.user.tenantId`), nunca del body del request.
- Stack corre con `docker-compose up`. Los tests se ejecutan con `cd backend && npm test`.
- Frontend usa `useApiFetch` + `useRuntimeConfig().public.apiUrl` (no axios, no `$fetch` directo).
- Prefijo global de API: `/api` — todas las URLs del frontend deben incluirlo (`${apiUrl}/catalog/paises`).
- IDs fijos del seed siguen el patrón `550e8400-e29b-41d4-a716-446655440XXX`. El siguiente libre es `056` (hasta `055` ya están usados).
- Docs vivas: actualizar `CLAUDE.md`, `docs/MIGRACION-FUNCIONALIDADES.md` y crear `docs/features/tenants-razones-sociales.md` en el mismo commit final.

---

## File Map

### Backend — crear
- `backend/src/modules/tenants/entities/razon-social.entity.ts` — entidad TypeORM para `razones_sociales`
- `backend/src/modules/tenants/dto/create-razon-social.dto.ts` — DTO de creación
- `backend/src/modules/tenants/dto/update-razon-social.dto.ts` — DTO de actualización (PartialType)
- `backend/src/modules/tenants/dto/update-my-tenant.dto.ts` — DTO para PATCH /tenants/me

### Backend — modificar
- `backend/src/modules/catalog/catalog.service.ts` — agregar `findAllPaises()` y `findAllProvincias()`
- `backend/src/modules/catalog/catalog.module.ts` — registrar `Pais` y `Provincia` en TypeOrmModule
- `backend/src/modules/catalog/catalog.controller.ts` — agregar GET /catalog/paises y /catalog/provincias
- `backend/src/modules/tenants/tenants.module.ts` — registrar `RazonSocial` en TypeOrmModule
- `backend/src/modules/tenants/tenants.service.ts` — agregar `updateMine()` y CRUD de razones sociales
- `backend/src/modules/tenants/tenants.controller.ts` — agregar PATCH /tenants/me y rutas /razones-sociales
- `backend/src/modules/seeder/seeder.service.ts` — agregar `seedRazonesSociales()`
- `backend/src/modules/seeder/seeder.module.ts` — registrar `RazonSocial` en TypeOrmModule

### Frontend — crear
- `frontend/app/pages/configuracion/empresa.vue` — form de edición de datos del tenant
- `frontend/app/pages/configuracion/razones-sociales.vue` — tabla + modal CRUD de razones sociales

### Frontend — modificar
- `frontend/app/pages/configuracion.vue` — agregar ítems de nav "Empresa" y "Razones sociales"

### Docs — crear/modificar
- `docs/features/tenants-razones-sociales.md` — feature doc (desde TEMPLATE.md)
- `docs/README.md` — agregar link a la feature doc
- `CLAUDE.md` — actualizar tabla "Estado actual" fila #4 a ✅
- `docs/MIGRACION-FUNCIONALIDADES.md` — actualizar tabla fila #4 a ✅

---

### Task 1: Catalog — endpoints de país y provincia

**Files:**
- Modify: `backend/src/modules/catalog/catalog.module.ts`
- Modify: `backend/src/modules/catalog/catalog.service.ts`
- Modify: `backend/src/modules/catalog/catalog.controller.ts`
- Test: `backend/src/modules/catalog/catalog.service.spec.ts` (crear)

**Interfaces:**
- Produce: `CatalogService.findAllPaises(): Promise<Pais[]>`, `CatalogService.findAllProvincias(paisId?: string): Promise<Provincia[]>`
- Consumes: entidades `Pais` y `Provincia` de `catalog/entities/`

- [ ] **Step 1: Escribir los tests fallidos**

Crear `backend/src/modules/catalog/catalog.service.spec.ts`:

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CatalogService } from './catalog.service';
import { ModuloApp } from './entities/modulo-app.entity';
import { Permiso } from './entities/permiso.entity';
import { Pais } from './entities/pais.entity';
import { Provincia } from './entities/provincia.entity';

const mockPais: Pais = {
  paisId: 'pais-uuid',
  nombre: 'Chile',
  codigoIso: 'CL',
  zonaHorariaPrincipal: 'America/Santiago',
  monedaOficialId: null,
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null as unknown as Date,
};

const mockProvincia: Provincia = {
  provinciaId: 'prov-uuid',
  paisId: 'pais-uuid',
  nombre: 'Región Metropolitana',
  zonaHoraria: 'America/Santiago',
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null as unknown as Date,
};

describe('CatalogService', () => {
  let service: CatalogService;
  let paisRepo: { find: jest.Mock };
  let provinciaRepo: { find: jest.Mock };

  beforeEach(async () => {
    paisRepo = { find: jest.fn() };
    provinciaRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: getRepositoryToken(ModuloApp), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Permiso), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Pais), useValue: paisRepo },
        { provide: getRepositoryToken(Provincia), useValue: provinciaRepo },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
  });

  describe('findAllPaises', () => {
    it('retorna todos los paises', async () => {
      paisRepo.find.mockResolvedValue([mockPais]);
      const result = await service.findAllPaises();
      expect(result).toEqual([mockPais]);
      expect(paisRepo.find).toHaveBeenCalledWith({
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('findAllProvincias', () => {
    it('retorna todas las provincias sin filtro', async () => {
      provinciaRepo.find.mockResolvedValue([mockProvincia]);
      const result = await service.findAllProvincias();
      expect(result).toEqual([mockProvincia]);
      expect(provinciaRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { nombre: 'ASC' },
      });
    });

    it('filtra por paisId cuando se provee', async () => {
      provinciaRepo.find.mockResolvedValue([mockProvincia]);
      const result = await service.findAllProvincias('pais-uuid');
      expect(result).toEqual([mockProvincia]);
      expect(provinciaRepo.find).toHaveBeenCalledWith({
        where: { paisId: 'pais-uuid' },
        order: { nombre: 'ASC' },
      });
    });
  });
});
```

- [ ] **Step 2: Correr los tests — deben fallar**

```bash
cd backend && npm test -- --testPathPattern=catalog.service.spec
```

Expected: FAIL — `service.findAllPaises is not a function`

- [ ] **Step 3: Registrar Pais y Provincia en catalog.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuloApp } from './entities/modulo-app.entity';
import { Permiso } from './entities/permiso.entity';
import { Pais } from './entities/pais.entity';
import { Provincia } from './entities/provincia.entity';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModuloApp, Permiso, Pais, Provincia])],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
```

- [ ] **Step 4: Agregar métodos en catalog.service.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ModuloApp } from './entities/modulo-app.entity';
import { Permiso } from './entities/permiso.entity';
import { Pais } from './entities/pais.entity';
import { Provincia } from './entities/provincia.entity';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ModuloApp)
    private readonly moduloAppRepo: Repository<ModuloApp>,
    @InjectRepository(Permiso)
    private readonly permisoRepo: Repository<Permiso>,
    @InjectRepository(Pais)
    private readonly paisRepo: Repository<Pais>,
    @InjectRepository(Provincia)
    private readonly provinciaRepo: Repository<Provincia>,
  ) {}

  findAllModulos(): Promise<ModuloApp[]> {
    return this.moduloAppRepo.find();
  }

  findAllPermisos(): Promise<Permiso[]> {
    return this.permisoRepo.find();
  }

  findAllPaises(): Promise<Pais[]> {
    return this.paisRepo.find({
      order: { nombre: 'ASC' },
    });
  }

  findAllProvincias(paisId?: string): Promise<Provincia[]> {
    return this.provinciaRepo.find({
      where: paisId ? { paisId } : {},
      order: { nombre: 'ASC' },
    });
  }
}
```

- [ ] **Step 5: Agregar endpoints en catalog.controller.ts**

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('modulos')
  findAllModulos() {
    return this.catalogService.findAllModulos();
  }

  @Get('permisos')
  findAllPermisos() {
    return this.catalogService.findAllPermisos();
  }

  @Get('paises')
  findAllPaises() {
    return this.catalogService.findAllPaises();
  }

  @Get('provincias')
  findAllProvincias(@Query('paisId') paisId?: string) {
    return this.catalogService.findAllProvincias(paisId);
  }
}
```

- [ ] **Step 6: Correr los tests — deben pasar**

```bash
cd backend && npm test -- --testPathPattern=catalog.service.spec
```

Expected: PASS — 3 tests

- [ ] **Step 7: Lint**

```bash
cd backend && npm run lint
```

Expected: sin errores

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/catalog/
git commit -m "feat(catalog): agregar endpoints GET /paises y /provincias con filtro por paisId"
```

---

### Task 2: PATCH /tenants/me — edición de datos del propio tenant

**Files:**
- Create: `backend/src/modules/tenants/dto/update-my-tenant.dto.ts`
- Modify: `backend/src/modules/tenants/tenants.service.ts`
- Modify: `backend/src/modules/tenants/tenants.controller.ts`
- Test: `backend/src/modules/tenants/tenants.service.spec.ts` (crear)

**Interfaces:**
- Consumes: `TenantGuard` + `TenantAdminGuard` (ya existen)
- Produce: `TenantsService.updateMine(tenantId: string, dto: UpdateMyTenantDto): Promise<Tenant>`

- [ ] **Step 1: Crear update-my-tenant.dto.ts**

```typescript
// backend/src/modules/tenants/dto/update-my-tenant.dto.ts
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdateMyTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nombre?: string;

  @IsOptional()
  @IsEmail()
  correo?: string;

  @IsOptional()
  @IsUUID()
  provinciaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string | null;

  @IsOptional()
  @IsString()
  direccion?: string | null;
}
```

- [ ] **Step 2: Escribir test para updateMine**

Crear `backend/src/modules/tenants/tenants.service.spec.ts`:

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Tenant } from './entities/tenant.entity';
import { UsuarioTenant } from './entities/usuario-tenant.entity';
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from './entities/caja.entity';
import { RazonSocial } from './entities/razon-social.entity';
import type { UpdateMyTenantDto } from './dto/update-my-tenant.dto';

const mockTenant: Tenant = {
  id: 'tenant-uuid',
  provinciaId: 'prov-uuid',
  nombre: 'Paris',
  correo: 'contacto@paris.cl',
  telefono: '+56226005000',
  direccion: 'Av. Kennedy 9001',
  calculoDescuentos: 'base',
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null,
};

describe('TenantsService', () => {
  let service: TenantsService;
  let tenantRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    softDelete: jest.Mock;
    create: jest.Mock;
  };
  let razonSocialRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock; query: jest.Mock };

  beforeEach(async () => {
    tenantRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      softDelete: jest.fn(),
      create: jest.fn(),
    };
    razonSocialRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      softDelete: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(),
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(UsuarioTenant), useValue: { findOne: jest.fn(), save: jest.fn(), create: jest.fn(), softDelete: jest.fn() } },
        { provide: getRepositoryToken(TenantModulo), useValue: { find: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(TenantFormulaPrecio), useValue: { find: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(Caja), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(RazonSocial), useValue: razonSocialRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  describe('updateMine', () => {
    it('actualiza los campos del tenant', async () => {
      const dto: UpdateMyTenantDto = { nombre: 'Paris Updated' };
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });
      tenantRepo.save.mockResolvedValue({ ...mockTenant, nombre: 'Paris Updated' });

      const result = await service.updateMine('tenant-uuid', dto);

      expect(result.nombre).toBe('Paris Updated');
      expect(tenantRepo.save).toHaveBeenCalled();
    });

    it('lanza NotFoundException si el tenant no existe', async () => {
      tenantRepo.findOne.mockResolvedValue(null);
      await expect(service.updateMine('no-existe', {})).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 3: Correr el test — debe fallar**

```bash
cd backend && npm test -- --testPathPattern=tenants.service.spec
```

Expected: FAIL — `service.updateMine is not a function`

- [ ] **Step 4: Agregar updateMine en tenants.service.ts**

Al final del bloque "Tenant-active group" (después de `findModules`), agregar:

```typescript
async updateMine(tenantId: string, dto: UpdateMyTenantDto): Promise<Tenant> {
  const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
  Object.assign(tenant, dto);
  return this.tenantRepo.save(tenant);
}
```

Y agregar el import al inicio del archivo:
```typescript
import { UpdateMyTenantDto } from './dto/update-my-tenant.dto';
```

- [ ] **Step 5: Agregar PATCH /tenants/me en tenants.controller.ts**

En `TenantsController`, agregar después de `@Get('me')`:

```typescript
@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Patch('me')
updateMine(@Req() req: Request, @Body() dto: UpdateMyTenantDto) {
  const user = req.user as { tenantId: string };
  return this.tenantsService.updateMine(user.tenantId, dto);
}
```

Agregar imports necesarios en `tenants.controller.ts`:
```typescript
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { UpdateMyTenantDto } from './dto/update-my-tenant.dto';
```

**Nota:** `TenantAdminGuard` solo se aplica al `PATCH`, no al `GET`. El decorador `@UseGuards` en la clase aplica `JwtAuthGuard + TenantGuard` a todos, pero se puede anotar el método individualmente para agregar `TenantAdminGuard` solo ahí.

- [ ] **Step 6: Correr tests — deben pasar**

```bash
cd backend && npm test -- --testPathPattern=tenants.service.spec
```

Expected: PASS — 2 tests

- [ ] **Step 7: Lint**

```bash
cd backend && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/tenants/dto/update-my-tenant.dto.ts \
        backend/src/modules/tenants/tenants.service.ts \
        backend/src/modules/tenants/tenants.controller.ts \
        backend/src/modules/tenants/tenants.service.spec.ts
git commit -m "feat(tenants): agregar PATCH /tenants/me con TenantAdminGuard"
```

---

### Task 3: Entidad y CRUD de razones sociales (backend)

**Files:**
- Create: `backend/src/modules/tenants/entities/razon-social.entity.ts`
- Create: `backend/src/modules/tenants/dto/create-razon-social.dto.ts`
- Create: `backend/src/modules/tenants/dto/update-razon-social.dto.ts`
- Modify: `backend/src/modules/tenants/tenants.module.ts`
- Modify: `backend/src/modules/tenants/tenants.service.ts`
- Modify: `backend/src/modules/tenants/tenants.controller.ts`
- Test: `backend/src/modules/tenants/tenants.service.spec.ts` (ampliar)

**Interfaces:**
- Consumes: `RazonSocial` entity, `CreateRazonSocialDto`, `UpdateRazonSocialDto`
- Produce:
  - `TenantsService.findRazonesSociales(tenantId: string): Promise<RazonSocial[]>`
  - `TenantsService.createRazonSocial(tenantId: string, dto: CreateRazonSocialDto): Promise<RazonSocial>`
  - `TenantsService.updateRazonSocial(tenantId: string, id: string, dto: UpdateRazonSocialDto): Promise<RazonSocial>`
  - `TenantsService.removeRazonSocial(tenantId: string, id: string): Promise<void>`

- [ ] **Step 1: Crear la entidad razon-social.entity.ts**

```typescript
// backend/src/modules/tenants/entities/razon-social.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('razones_sociales')
export class RazonSocial {
  @PrimaryGeneratedColumn('uuid', { name: 'razon_social_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ length: 100 })
  nombre: string;

  @Column({ length: 50 })
  rut: string;

  @Column({ length: 255, nullable: true, type: 'varchar' })
  direccion: string | null;

  @Column({ length: 50, nullable: true, type: 'varchar' })
  telefono: string | null;

  @Column({ default: false })
  habilitado: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 2: Crear create-razon-social.dto.ts**

```typescript
// backend/src/modules/tenants/dto/create-razon-social.dto.ts
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateRazonSocialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  rut: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  direccion?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  telefono?: string | null;

  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;
}
```

- [ ] **Step 3: Crear update-razon-social.dto.ts**

```typescript
// backend/src/modules/tenants/dto/update-razon-social.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateRazonSocialDto } from './create-razon-social.dto';

export class UpdateRazonSocialDto extends PartialType(CreateRazonSocialDto) {}
```

- [ ] **Step 4: Escribir tests para el CRUD de razones sociales**

Ampliar `backend/src/modules/tenants/tenants.service.spec.ts` — agregar dentro del `describe('TenantsService')` después del bloque `updateMine`:

```typescript
const mockRazonSocial: RazonSocial = {
  id: 'rs-uuid',
  tenantId: 'tenant-uuid',
  nombre: 'Paris SPA',
  rut: '76.123.456-7',
  direccion: 'Av. Kennedy 9001',
  telefono: null,
  habilitado: false,
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null,
};
```

Y agregar estos describe blocks:

```typescript
describe('findRazonesSociales', () => {
  it('retorna las razones sociales del tenant', async () => {
    razonSocialRepo.find.mockResolvedValue([mockRazonSocial]);
    const result = await service.findRazonesSociales('tenant-uuid');
    expect(result).toEqual([mockRazonSocial]);
    expect(razonSocialRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-uuid' },
      order: { nombre: 'ASC' },
    });
  });
});

describe('createRazonSocial', () => {
  it('crea y retorna la razon social', async () => {
    razonSocialRepo.create.mockReturnValue(mockRazonSocial);
    razonSocialRepo.save.mockResolvedValue(mockRazonSocial);
    const dto = { nombre: 'Paris SPA', rut: '76.123.456-7' };
    const result = await service.createRazonSocial('tenant-uuid', dto);
    expect(result).toEqual(mockRazonSocial);
    expect(razonSocialRepo.create).toHaveBeenCalledWith({
      tenantId: 'tenant-uuid',
      nombre: 'Paris SPA',
      rut: '76.123.456-7',
    });
  });
});

describe('updateRazonSocial', () => {
  it('actualiza la razon social', async () => {
    razonSocialRepo.findOne.mockResolvedValue({ ...mockRazonSocial });
    razonSocialRepo.save.mockResolvedValue({ ...mockRazonSocial, nombre: 'Paris SA' });
    const result = await service.updateRazonSocial('tenant-uuid', 'rs-uuid', { nombre: 'Paris SA' });
    expect(result.nombre).toBe('Paris SA');
  });

  it('lanza NotFoundException si no pertenece al tenant', async () => {
    razonSocialRepo.findOne.mockResolvedValue(null);
    await expect(
      service.updateRazonSocial('tenant-uuid', 'otro-id', { nombre: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('removeRazonSocial', () => {
  it('hace soft delete de la razon social', async () => {
    razonSocialRepo.findOne.mockResolvedValue(mockRazonSocial);
    razonSocialRepo.softDelete.mockResolvedValue({ affected: 1 });
    await service.removeRazonSocial('tenant-uuid', 'rs-uuid');
    expect(razonSocialRepo.softDelete).toHaveBeenCalledWith('rs-uuid');
  });

  it('lanza NotFoundException si no pertenece al tenant', async () => {
    razonSocialRepo.findOne.mockResolvedValue(null);
    await expect(
      service.removeRazonSocial('tenant-uuid', 'no-existe'),
    ).rejects.toThrow(NotFoundException);
  });
});
```

También necesitas importar `RazonSocial` al inicio del spec:
```typescript
import { RazonSocial } from './entities/razon-social.entity';
```

- [ ] **Step 5: Correr tests — deben fallar**

```bash
cd backend && npm test -- --testPathPattern=tenants.service.spec
```

Expected: FAIL — `service.findRazonesSociales is not a function`

- [ ] **Step 6: Registrar RazonSocial en tenants.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entities/tenant.entity';
import { UsuarioTenant } from './entities/usuario-tenant.entity';
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from './entities/caja.entity';
import { RazonSocial } from './entities/razon-social.entity';
import { TenantsService } from './tenants.service';
import {
  AdminTenantsController,
  TenantsController,
} from './tenants.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      UsuarioTenant,
      TenantModulo,
      TenantFormulaPrecio,
      Caja,
      RazonSocial,
    ]),
  ],
  controllers: [AdminTenantsController, TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
```

- [ ] **Step 7: Agregar el repo de RazonSocial en tenants.service.ts**

En el constructor de `TenantsService`, agregar después del repo de `Caja`:

```typescript
@InjectRepository(RazonSocial)
private readonly razonSocialRepo: Repository<RazonSocial>,
```

Y el import:
```typescript
import { RazonSocial } from './entities/razon-social.entity';
```

- [ ] **Step 8: Agregar métodos CRUD en tenants.service.ts**

Al final de `TenantsService`, agregar:

```typescript
// ─────────────────────────────────────────────────────────────────────────
// Razones sociales
// ─────────────────────────────────────────────────────────────────────────

findRazonesSociales(tenantId: string): Promise<RazonSocial[]> {
  return this.razonSocialRepo.find({
    where: { tenantId },
    order: { nombre: 'ASC' },
  });
}

createRazonSocial(
  tenantId: string,
  dto: CreateRazonSocialDto,
): Promise<RazonSocial> {
  const rs = this.razonSocialRepo.create({ tenantId, ...dto });
  return this.razonSocialRepo.save(rs);
}

async updateRazonSocial(
  tenantId: string,
  id: string,
  dto: UpdateRazonSocialDto,
): Promise<RazonSocial> {
  const rs = await this.razonSocialRepo.findOne({
    where: { id, tenantId },
  });
  if (!rs) throw new NotFoundException(`Razón social ${id} no encontrada`);
  Object.assign(rs, dto);
  return this.razonSocialRepo.save(rs);
}

async removeRazonSocial(tenantId: string, id: string): Promise<void> {
  const rs = await this.razonSocialRepo.findOne({
    where: { id, tenantId },
  });
  if (!rs) throw new NotFoundException(`Razón social ${id} no encontrada`);
  await this.razonSocialRepo.softDelete(id);
}
```

Agregar imports de DTOs:
```typescript
import { CreateRazonSocialDto } from './dto/create-razon-social.dto';
import { UpdateRazonSocialDto } from './dto/update-razon-social.dto';
```

- [ ] **Step 9: Agregar rutas en tenants.controller.ts**

En `TenantsController`, agregar antes del cierre de la clase:

```typescript
@Get('razones-sociales')
findRazonesSociales(@Req() req: Request) {
  const user = req.user as { tenantId: string };
  return this.tenantsService.findRazonesSociales(user.tenantId);
}

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Post('razones-sociales')
createRazonSocial(@Req() req: Request, @Body() dto: CreateRazonSocialDto) {
  const user = req.user as { tenantId: string };
  return this.tenantsService.createRazonSocial(user.tenantId, dto);
}

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Patch('razones-sociales/:id')
updateRazonSocial(
  @Req() req: Request,
  @Param('id') id: string,
  @Body() dto: UpdateRazonSocialDto,
) {
  const user = req.user as { tenantId: string };
  return this.tenantsService.updateRazonSocial(user.tenantId, id, dto);
}

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Delete('razones-sociales/:id')
@HttpCode(HttpStatus.NO_CONTENT)
removeRazonSocial(@Req() req: Request, @Param('id') id: string) {
  const user = req.user as { tenantId: string };
  return this.tenantsService.removeRazonSocial(user.tenantId, id);
}
```

Agregar imports faltantes en `tenants.controller.ts`:
```typescript
import { CreateRazonSocialDto } from './dto/create-razon-social.dto';
import { UpdateRazonSocialDto } from './dto/update-razon-social.dto';
```

- [ ] **Step 10: Correr tests — deben pasar**

```bash
cd backend && npm test -- --testPathPattern=tenants.service.spec
```

Expected: PASS — todos los tests

- [ ] **Step 11: Lint**

```bash
cd backend && npm run lint
```

- [ ] **Step 12: Commit**

```bash
git add backend/src/modules/tenants/
git commit -m "feat(tenants): agregar entidad RazonSocial y CRUD /tenants/razones-sociales"
```

---

### Task 4: Seed de razones sociales de desarrollo

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Modify: `backend/src/modules/seeder/seeder.module.ts`

**Interfaces:**
- Consumes: entidad `RazonSocial`, IDs de tenants de dev (`550e8400-e29b-41d4-a716-446655440007` = Paris, `550e8400-e29b-41d4-a716-446655440040` = Falabella)
- IDs libres a usar: `056`, `057` (los últimos usados llegan a `055`)

- [ ] **Step 1: Registrar RazonSocial en seeder.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeederService } from './seeder.service';
import { Moneda } from '../catalog/entities/moneda.entity';
import { Pais } from '../catalog/entities/pais.entity';
import { Provincia } from '../catalog/entities/provincia.entity';
import { ModuloApp } from '../catalog/entities/modulo-app.entity';
import { Permiso } from '../catalog/entities/permiso.entity';
import { ModuloAppPermiso } from '../catalog/entities/modulo-app-permiso.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from '../tenants/entities/tenant-formula-precio.entity';
import { Usuario } from '../users/usuario.entity';
import { RazonSocial } from '../tenants/entities/razon-social.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Moneda,
      Pais,
      Provincia,
      ModuloApp,
      Permiso,
      ModuloAppPermiso,
      Tenant,
      TenantModulo,
      TenantFormulaPrecio,
      Usuario,
      RazonSocial,
    ]),
  ],
  providers: [SeederService],
})
export class SeederModule {}
```

- [ ] **Step 2: Agregar repo e inyección en seeder.service.ts**

Al inicio del archivo, agregar el import:
```typescript
import { RazonSocial } from '../tenants/entities/razon-social.entity';
```

En el constructor, agregar después del `@InjectRepository(Usuario)` block:
```typescript
@InjectRepository(RazonSocial)
private readonly razonSocialRepo: Repository<RazonSocial>,
```

- [ ] **Step 3: Agregar seedRazonesSociales en onApplicationBootstrap**

En `onApplicationBootstrap`, agregar la llamada después de `await this.seedTenants()`:
```typescript
await this.seedRazonesSociales();
```

- [ ] **Step 4: Agregar el método seedRazonesSociales**

Agregar al final de la clase, antes del cierre:

```typescript
private async seedRazonesSociales(): Promise<void> {
  const razones: Partial<RazonSocial>[] = [
    {
      id: '550e8400-e29b-41d4-a716-446655440056',
      tenantId: '550e8400-e29b-41d4-a716-446655440007',
      nombre: 'Paris S.A.',
      rut: '76.123.456-7',
      direccion: 'Av. Presidente Kennedy 9001, Las Condes',
      telefono: '+56226005000',
      habilitado: true,
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440057',
      tenantId: '550e8400-e29b-41d4-a716-446655440040',
      nombre: 'Falabella Retail S.A.',
      rut: '96.654.390-9',
      direccion: 'Av. Presidente Kennedy 6400, Las Condes',
      telefono: '+56226007000',
      habilitado: true,
    },
  ];

  for (const data of razones) {
    const exists = await this.razonSocialRepo.findOne({
      where: { id: data.id },
    });
    if (!exists) {
      await this.razonSocialRepo.save(this.razonSocialRepo.create(data));
    }
  }
}
```

- [ ] **Step 5: Verificar que el backend arranca sin errores**

```bash
docker-compose down -v && docker-compose up --build
```

Expected: backend inicia, seed corre sin errores, logs muestran "Running dev seed..."

- [ ] **Step 6: Lint**

```bash
cd backend && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/seeder/
git commit -m "feat(seeder): agregar seed de razones sociales para tenants de dev"
```

---

### Task 5: Frontend — /configuracion/empresa

**Files:**
- Create: `frontend/app/pages/configuracion/empresa.vue`
- Modify: `frontend/app/pages/configuracion.vue`

**Interfaces:**
- Consumes: `GET ${apiUrl}/tenants/me`, `GET ${apiUrl}/catalog/paises`, `GET ${apiUrl}/catalog/provincias?paisId=`, `PATCH ${apiUrl}/tenants/me`
- Consumes: `useApiFetch`, `useRuntimeConfig().public.apiUrl`, `useToast()`

- [ ] **Step 1: Agregar nav items en configuracion.vue**

En el bloque `if (permissionsStore.esAdmin)`, agregar después de los items existentes (antes de `]`):

```typescript
{
  label: 'Empresa',
  icon: 'i-heroicons-building-office-2',
  to: '/configuracion/empresa',
},
{
  label: 'Razones sociales',
  icon: 'i-heroicons-document-text',
  to: '/configuracion/razones-sociales',
},
```

- [ ] **Step 2: Crear frontend/app/pages/configuracion/empresa.vue**

```vue
<script setup lang="ts">
interface Pais {
  paisId: string
  nombre: string
  codigoIso: string
}

interface Provincia {
  provinciaId: string
  paisId: string
  nombre: string
}

interface TenantMe {
  id: string
  nombre: string
  correo: string
  telefono: string | null
  direccion: string | null
  provinciaId: string
}

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const loading = ref(false)
const saving = ref(false)

const paises = ref<Pais[]>([])
const provincias = ref<Provincia[]>([])

const form = ref({
  nombre: '',
  correo: '',
  telefono: '',
  direccion: '',
  paisId: '',
  provinciaId: '',
})

async function cargar() {
  loading.value = true
  try {
    const [tenant, ps] = await Promise.all([
      useApiFetch<TenantMe>(`${apiUrl}/tenants/me`),
      useApiFetch<Pais[]>(`${apiUrl}/catalog/paises`),
    ])
    paises.value = ps
    form.value.nombre = tenant.nombre
    form.value.correo = tenant.correo
    form.value.telefono = tenant.telefono ?? ''
    form.value.direccion = tenant.direccion ?? ''
    form.value.provinciaId = tenant.provinciaId

    // Cargar todas las provincias para inferir el país actual
    const todasProvincias = await useApiFetch<Provincia[]>(`${apiUrl}/catalog/provincias`)
    const provinciaActual = todasProvincias.find(p => p.provinciaId === tenant.provinciaId)
    if (provinciaActual) {
      form.value.paisId = provinciaActual.paisId
      await cargarProvincias(provinciaActual.paisId)
    }
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar datos de la empresa', color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function cargarProvincias(paisId: string) {
  provincias.value = await useApiFetch<Provincia[]>(
    `${apiUrl}/catalog/provincias?paisId=${paisId}`,
  )
}

async function onPaisChange(paisId: string) {
  form.value.provinciaId = ''
  provincias.value = []
  if (paisId) {
    await cargarProvincias(paisId)
  }
}

async function guardar() {
  saving.value = true
  try {
    await useApiFetch(`${apiUrl}/tenants/me`, {
      method: 'PATCH',
      body: {
        nombre: form.value.nombre,
        correo: form.value.correo,
        telefono: form.value.telefono || null,
        direccion: form.value.direccion || null,
        provinciaId: form.value.provinciaId,
      },
    })
    toast.add({ title: 'Datos de empresa actualizados', color: 'success' })
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al guardar', color: 'error' })
  }
  finally {
    saving.value = false
  }
}

const paisItems = computed(() =>
  paises.value.map(p => ({ label: p.nombre, value: p.paisId })),
)

const provinciaItems = computed(() =>
  provincias.value.map(p => ({ label: p.nombre, value: p.provinciaId })),
)

onMounted(cargar)
</script>

<template>
  <div class="space-y-6 max-w-lg">
    <div>
      <h2 class="text-lg font-semibold">
        Empresa
      </h2>
      <p class="text-sm text-gray-500">
        Datos de tu organización.
      </p>
    </div>

    <div
      v-if="loading"
      class="py-8 text-center text-sm text-gray-500"
    >
      Cargando…
    </div>

    <UCard v-else>
      <div class="space-y-4">
        <UFormField label="Nombre">
          <UInput v-model="form.nombre" placeholder="Nombre de la empresa" />
        </UFormField>

        <UFormField label="Correo">
          <UInput v-model="form.correo" type="email" placeholder="contacto@empresa.cl" />
        </UFormField>

        <UFormField label="Teléfono">
          <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
        </UFormField>

        <UFormField label="Dirección">
          <UInput v-model="form.direccion" placeholder="Av. Ejemplo 123, Ciudad" />
        </UFormField>

        <UFormField label="País">
          <USelectMenu
            v-model="form.paisId"
            :items="paisItems"
            value-key="value"
            label-key="label"
            placeholder="Selecciona un país"
            @update:model-value="onPaisChange"
          />
        </UFormField>

        <UFormField label="Provincia / Región">
          <USelectMenu
            v-model="form.provinciaId"
            :items="provinciaItems"
            value-key="value"
            label-key="label"
            placeholder="Selecciona una provincia"
            :disabled="!form.paisId"
          />
        </UFormField>

        <div class="flex justify-end pt-2">
          <UButton
            :loading="saving"
            :disabled="saving"
            @click="guardar"
          >
            Guardar cambios
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
```

- [ ] **Step 3: Verificar en navegador**

Con el stack corriendo (`docker-compose up`):
1. Ir a `http://localhost:5173/configuracion/empresa`
2. Verificar que carga el nombre, correo, teléfono y dirección del tenant actual
3. Verificar que el select de país muestra "Chile" seleccionado y el de provincia muestra "Región Metropolitana"
4. Editar el nombre y guardar — verificar toast de éxito

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/configuracion.vue \
        frontend/app/pages/configuracion/empresa.vue
git commit -m "feat(frontend): agregar página /configuracion/empresa con form editable"
```

---

### Task 6: Frontend — /configuracion/razones-sociales

**Files:**
- Create: `frontend/app/pages/configuracion/razones-sociales.vue`

**Interfaces:**
- Consumes: `GET ${apiUrl}/tenants/razones-sociales`, `POST`, `PATCH /:id`, `DELETE /:id`
- Consumes: `useApiFetch`, `useRuntimeConfig().public.apiUrl`, `useToast()`

- [ ] **Step 1: Crear frontend/app/pages/configuracion/razones-sociales.vue**

```vue
<script setup lang="ts">
interface RazonSocial {
  id: string
  nombre: string
  rut: string
  direccion: string | null
  telefono: string | null
  habilitado: boolean
}

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const razones = ref<RazonSocial[]>([])
const loading = ref(false)
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)

const emptyForm = () => ({
  nombre: '',
  rut: '',
  direccion: '',
  telefono: '',
  habilitado: false,
})
const form = ref(emptyForm())

async function cargar() {
  loading.value = true
  try {
    razones.value = await useApiFetch<RazonSocial[]>(`${apiUrl}/tenants/razones-sociales`)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar razones sociales', color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function abrirCrear() {
  editingId.value = null
  form.value = emptyForm()
  modalOpen.value = true
}

function abrirEditar(rs: RazonSocial) {
  editingId.value = rs.id
  form.value = {
    nombre: rs.nombre,
    rut: rs.rut,
    direccion: rs.direccion ?? '',
    telefono: rs.telefono ?? '',
    habilitado: rs.habilitado,
  }
  modalOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      rut: form.value.rut,
      direccion: form.value.direccion || null,
      telefono: form.value.telefono || null,
      habilitado: form.value.habilitado,
    }
    if (editingId.value) {
      await useApiFetch(`${apiUrl}/tenants/razones-sociales/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      toast.add({ title: 'Razón social actualizada', color: 'success' })
    }
    else {
      await useApiFetch(`${apiUrl}/tenants/razones-sociales`, {
        method: 'POST',
        body,
      })
      toast.add({ title: 'Razón social creada', color: 'success' })
    }
    modalOpen.value = false
    await cargar()
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al guardar', color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/tenants/razones-sociales/${id}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Razón social eliminada', color: 'success' })
    await cargar()
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al eliminar', color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          Razones sociales
        </h2>
        <p class="text-sm text-gray-500">
          Datos legales para facturación del tenant.
        </p>
      </div>
      <UButton
        icon="i-heroicons-plus"
        @click="abrirCrear"
      >
        Nueva razón social
      </UButton>
    </div>

    <UCard>
      <div
        v-if="loading"
        class="py-8 text-center text-sm text-gray-500"
      >
        Cargando…
      </div>
      <div
        v-else-if="!razones.length"
        class="py-8 text-center text-sm text-gray-500"
      >
        No hay razones sociales registradas.
      </div>
      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="rs in razones"
          :key="rs.id"
          class="flex items-center justify-between py-3"
        >
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ rs.nombre }}
            </p>
            <p class="text-sm text-gray-500">
              RUT: {{ rs.rut }}
            </p>
            <p
              v-if="rs.direccion"
              class="text-sm text-gray-400 truncate"
            >
              {{ rs.direccion }}
            </p>
            <UBadge
              :color="rs.habilitado ? 'success' : 'neutral'"
              variant="subtle"
              size="xs"
              class="mt-1"
            >
              {{ rs.habilitado ? 'Habilitada' : 'Deshabilitada' }}
            </UBadge>
          </div>
          <div class="flex gap-2 shrink-0 ml-4">
            <UButton
              icon="i-heroicons-pencil-square"
              color="neutral"
              variant="ghost"
              @click="abrirEditar(rs)"
            />
            <UButton
              icon="i-heroicons-trash"
              color="error"
              variant="ghost"
              @click="() => { confirmDeleteId = rs.id; confirmModalOpen = true }"
            />
          </div>
        </li>
      </ul>
    </UCard>

    <!-- Modal crear/editar -->
    <UModal
      v-model:open="modalOpen"
      :title="editingId ? 'Editar razón social' : 'Nueva razón social'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Nombre legal" required>
            <UInput v-model="form.nombre" placeholder="Empresa S.A." />
          </UFormField>
          <UFormField label="RUT" required>
            <UInput v-model="form.rut" placeholder="76.123.456-7" />
          </UFormField>
          <UFormField label="Dirección">
            <UInput v-model="form.direccion" placeholder="Av. Ejemplo 123" />
          </UFormField>
          <UFormField label="Teléfono">
            <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
          </UFormField>
          <UFormField label="Habilitada">
            <UToggle v-model="form.habilitado" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="modalOpen = false">
            Cancelar
          </UButton>
          <UButton :loading="saving" @click="guardar">
            Guardar
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal confirmación eliminar -->
    <UModal
      v-model:open="confirmModalOpen"
      title="Eliminar razón social"
    >
      <template #body>
        <p class="text-sm">
          ¿Estás seguro de que quieres eliminar esta razón social? Esta acción no se puede deshacer.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="confirmModalOpen = false; confirmDeleteId = null">
            Cancelar
          </UButton>
          <UButton
            color="error"
            @click="confirmDeleteId && eliminar(confirmDeleteId)"
          >
            Eliminar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
```

- [ ] **Step 2: Verificar en navegador**

Con el stack corriendo:
1. Ir a `http://localhost:5173/configuracion/razones-sociales`
2. Verificar que se muestran las razones sociales sembradas en seed (Paris S.A., Falabella Retail S.A.)
3. Crear una nueva razón social — verificar que aparece en la lista
4. Editar una — verificar que los cambios se reflejan
5. Eliminar una — verificar confirmación y que desaparece de la lista

- [ ] **Step 3: Commit**

```bash
git add frontend/app/pages/configuracion/razones-sociales.vue
git commit -m "feat(frontend): agregar página /configuracion/razones-sociales con CRUD"
```

---

### Task 7: Docs vivas

**Files:**
- Create: `docs/features/tenants-razones-sociales.md`
- Modify: `docs/README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/MIGRACION-FUNCIONALIDADES.md`

- [ ] **Step 1: Crear docs/features/tenants-razones-sociales.md**

Tomar `docs/features/TEMPLATE.md` como base. El contenido:

```markdown
# Feature: Gestión de Tenants y Razones Sociales

**Módulo:** Configuración — Empresa / Razones sociales  
**Estado:** ✅ Implementado  
**Fecha:** 2026-06-22

## Qué hace

Permite al administrador de un tenant editar los datos de su propia empresa (nombre, correo, teléfono, dirección, provincia) y gestionar el CRUD de sus razones sociales (datos legales para facturación).

## Rutas backend

| Método | Ruta | Guard | Descripción |
|---|---|---|---|
| GET | /api/catalog/paises | JwtAuth | Lista todos los países |
| GET | /api/catalog/provincias?paisId= | JwtAuth | Lista provincias, filtrable por país |
| GET | /api/tenants/me | JwtAuth + Tenant | Datos del tenant activo |
| PATCH | /api/tenants/me | JwtAuth + Tenant + TenantAdmin | Edita datos del tenant |
| GET | /api/tenants/razones-sociales | JwtAuth + Tenant | Lista razones sociales del tenant |
| POST | /api/tenants/razones-sociales | JwtAuth + Tenant + TenantAdmin | Crea razón social |
| PATCH | /api/tenants/razones-sociales/:id | JwtAuth + Tenant + TenantAdmin | Edita razón social |
| DELETE | /api/tenants/razones-sociales/:id | JwtAuth + Tenant + TenantAdmin | Soft delete |

## Páginas frontend

- `/configuracion/empresa` — Form editable con datos del tenant + selector de país/provincia
- `/configuracion/razones-sociales` — Tabla + modal CRUD; visible solo para admins del tenant

## Tablas DB

- `tenants` — se edita vía PATCH /tenants/me
- `razones_sociales` — CRUD completo con soft delete
- `pais`, `provincia` — solo lectura (catálogos)

## Decisiones de diseño

- `tenantId` siempre del JWT, nunca del body.
- `TenantAdminGuard` protege mutaciones (POST/PATCH/DELETE); GET solo requiere `TenantGuard`.
- Sub-tenants (`sub_tenants`) fuera de alcance: tabla reservada.
- `calculo_descuentos` no es editable aquí: corresponde a config de precios.
- `habilitado` default `false` en razones sociales: el admin activa explícitamente.
```

- [ ] **Step 2: Actualizar docs/README.md**

Agregar en la sección de features (buscar el bloque de links existente):
```markdown
- [Gestión de tenants y razones sociales](features/tenants-razones-sociales.md)
```

- [ ] **Step 3: Actualizar fila #4 en CLAUDE.md**

En la tabla "Estado actual", cambiar:
```
| Gestión de tenants y razones sociales | 🔲 Por construir |
```
por:
```
| Gestión de tenants y razones sociales | ✅ Implementado |
```

- [ ] **Step 4: Actualizar tabla en docs/MIGRACION-FUNCIONALIDADES.md**

En la tabla "Estado de Implementación (2026-06-20)", cambiar la fila:
```
| 4. Gestión de tenants y razones sociales | 🔲 | 🔲 | |
```
por:
```
| 4. Gestión de tenants y razones sociales | ✅ | ✅ | PATCH /tenants/me + CRUD /razones-sociales; páginas /configuracion/empresa y /configuracion/razones-sociales |
```

- [ ] **Step 5: Commit final**

```bash
git add docs/features/tenants-razones-sociales.md \
        docs/README.md \
        CLAUDE.md \
        docs/MIGRACION-FUNCIONALIDADES.md
git commit -m "docs: agregar feature doc y actualizar estado de feature #4 (tenants/razones sociales)"
```
