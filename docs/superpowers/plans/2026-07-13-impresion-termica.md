# Impresión Térmica (Comandas, Precuenta, Boleta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir imprimir comandas de cocina/barra, precuenta y boleta en impresoras térmicas desde el navegador, vía QZ Tray, ruteando comandas por categoría del ítem.

**Architecture:** Módulo backend nuevo `impresoras` (CRUD, RBAC propio) + extensión de `categorias` (ruteo por categoría → impresora) y `cuenta_lineas` (diff de lo ya enviado a cocina) + dos endpoints en dos fases: `GET /cuentas/:id/comanda/pendiente` (calcula el diff, **sin** persistir) y `POST /cuentas/:id/comanda` (confirma: persiste `cantidad_enviada` **solo tras** una impresión exitosa en el navegador). En el frontend, un composable `useImpresoras` envuelve `qz-tray` (impresión directa desde el navegador a impresoras de red/USB) y arma los tickets con funciones puras testeables (`utils/ticket-builder.ts`), consumidas desde `pages/salones/index.vue` (comanda, precuenta, boleta) y `pages/ventas/pos.vue` (boleta).

**Tech Stack:** NestJS + TypeORM (backend), Nuxt 4 + Vue 3 + `@nuxt/ui` v4 + Pinia (frontend), `qz-tray` (puente navegador↔impresora), Decimal.js, Vitest + Jest.

## Global Constraints

- Soft delete en todo: `@DeleteDateColumn({ name: 'eliminado_el' })`; toda lectura filtra `eliminado_el IS NULL`.
- `type: 'uuid'` explícito en toda columna PK/FK de UUID.
- `tenant_id` siempre del token (`req.user.tenantId`), nunca del body.
- Dinero/porcentajes/cantidades: Decimal.js, nunca `number` nativo; porcentajes en decimal.
- Campos `numeric` viajan como **string** de punta a punta (backend `@IsNumberString`, frontend `UInput inputmode="decimal"`, nunca `type="number"`).
- Dev: schema gestionado por TypeORM `synchronize` (no hay migraciones manuales) — basta con declarar las columnas en las entities.
- Iconos frontend: Lucide (`i-lucide-{name}`). Llamadas API: `useApiFetch`, nunca `$fetch`/axios directo.
- Sin notas por ítem, sin reimpresión de comandas, sin impresoras de rol dual — fuera de alcance v1 (ver spec).
- **Comanda a prueba de fallos (dos fases):** el cálculo del diff NO persiste nada; `cantidad_enviada` se marca **solo después** de que el navegador confirma la impresión (`GET .../comanda/pendiente` → imprimir vía QZ → `POST .../comanda`). Como no hay reimpresión, avanzar el diff antes de imprimir perdería la comanda si QZ Tray falla; con dos fases, un fallo deja todo pendiente y reintentable.
- **`qz-tray` es solo-navegador:** cargarlo de forma perezosa (`await import('qz-tray')` dentro de la función), nunca en el top-level del módulo — el import a nivel de módulo se evalúa en SSR (habilitado por defecto) y rompe el render del servidor.
- **Tickets:** los builders devuelven `string[]` de líneas *lógicas* (sin `\n`); el composable las une con `\n` antes de enviarlas a QZ (raw ESC/POS interpreta `0x0A` como avance de línea). No agregar `\n` en el builder — rompería sus tests de membresía de array.

Spec de referencia: `docs/superpowers/specs/2026-07-13-impresion-termica-design.md`.

---

### Task 1: Módulo backend `impresoras` (CRUD + RBAC)

**Files:**
- Create: `backend/src/modules/impresoras/entities/impresora.entity.ts`
- Create: `backend/src/modules/impresoras/dto/create-impresora.dto.ts`
- Create: `backend/src/modules/impresoras/dto/update-impresora.dto.ts`
- Create: `backend/src/modules/impresoras/impresoras.service.ts`
- Create: `backend/src/modules/impresoras/impresoras.service.spec.ts`
- Create: `backend/src/modules/impresoras/impresoras.controller.ts`
- Create: `backend/src/modules/impresoras/impresoras.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `Impresora` entity (`id, tenantId, nombre, rol: 'comanda'|'boleta', tipoConexion: 'red'|'sistema', host, puerto, nombreCola, activo, creadoEl, actualizadoEl, eliminadoEl`), consumida por Task 3 (SalonesService), Task 4 (seeder) y por el frontend (Task 6).
- Produces: `ImpresorasService.listar(tenantId, rol?)`, `.crear(tenantId, dto)`, `.actualizar(tenantId, id, dto)`, `.eliminar(tenantId, id)`.
- Produces: rutas `GET/POST /impresoras`, `PATCH/DELETE /impresoras/:id`, permiso RBAC `Impresoras` (`Leer/Crear/Actualizar/Eliminar`).

- [x] **Step 1: Crear la entity `Impresora`**

```typescript
// backend/src/modules/impresoras/entities/impresora.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export type RolImpresora = 'comanda' | 'boleta';
export type TipoConexionImpresora = 'red' | 'sistema';

/**
 * Impresora térmica configurada por el tenant. `rol` determina su uso:
 * 'comanda' (cocina/barra, ruteada desde categorias.impresora_id) o
 * 'boleta' (precuenta/boleta). La impresión real ocurre en el navegador vía
 * QZ Tray — esta tabla solo guarda cómo alcanzarla (red TCP o cola del SO).
 * Ver docs/features/impresion-termica.md.
 */
@Entity('impresoras')
export class Impresora {
  @PrimaryGeneratedColumn('uuid', { name: 'impresora_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'text' })
  rol: RolImpresora;

  @Column({ name: 'tipo_conexion', type: 'text' })
  tipoConexion: TipoConexionImpresora;

  @Column({ type: 'varchar', length: 255, nullable: true })
  host: string | null;

  @Column({ type: 'int', nullable: true })
  puerto: number | null;

  @Column({ name: 'nombre_cola', type: 'varchar', length: 100, nullable: true })
  nombreCola: string | null;

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

- [x] **Step 2: Crear los DTOs**

```typescript
// backend/src/modules/impresoras/dto/create-impresora.dto.ts
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import type { RolImpresora, TipoConexionImpresora } from '../entities/impresora.entity';

export class CreateImpresoraDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsIn(['comanda', 'boleta'])
  rol: RolImpresora;

  @IsIn(['red', 'sistema'])
  tipoConexion: TipoConexionImpresora;

  @ValidateIf((o: CreateImpresoraDto) => o.tipoConexion === 'red')
  @IsString()
  @IsNotEmpty()
  host?: string;

  @ValidateIf((o: CreateImpresoraDto) => o.tipoConexion === 'red')
  @IsInt()
  @Min(1)
  puerto?: number;

  @ValidateIf((o: CreateImpresoraDto) => o.tipoConexion === 'sistema')
  @IsString()
  @IsNotEmpty()
  nombreCola?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
```

```typescript
// backend/src/modules/impresoras/dto/update-impresora.dto.ts
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import type { RolImpresora, TipoConexionImpresora } from '../entities/impresora.entity';

export class UpdateImpresoraDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @IsOptional()
  @IsIn(['comanda', 'boleta'])
  rol?: RolImpresora;

  @IsOptional()
  @IsIn(['red', 'sistema'])
  tipoConexion?: TipoConexionImpresora;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  puerto?: number;

  @IsOptional()
  @IsString()
  nombreCola?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
```

- [x] **Step 3: Escribir el test del service (falla — el service no existe todavía)**

```typescript
// backend/src/modules/impresoras/impresoras.service.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ImpresorasService } from './impresoras.service';
import { Impresora } from './entities/impresora.entity';

const TENANT = 'tenant-uuid';
const IMPRESORA = 'impresora-uuid';

describe('ImpresorasService', () => {
  let service: ImpresorasService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpresorasService,
        { provide: getRepositoryToken(Impresora), useValue: repo },
      ],
    }).compile();

    service = module.get<ImpresorasService>(ImpresorasService);
  });

  describe('listar', () => {
    it('filtra por tenant y opcionalmente por rol', async () => {
      repo.find.mockResolvedValue([]);
      await service.listar(TENANT, 'comanda');
      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: TENANT, rol: 'comanda' },
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('crear', () => {
    it('crea una impresora de red con host y puerto', async () => {
      const result = await service.crear(TENANT, {
        nombre: 'Cocina',
        rol: 'comanda',
        tipoConexion: 'red',
        host: '192.168.1.50',
        puerto: 9100,
      });

      expect(repo.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        nombre: 'Cocina',
        rol: 'comanda',
        tipoConexion: 'red',
        host: '192.168.1.50',
        puerto: 9100,
        nombreCola: null,
        activo: true,
      });
      expect(result).toMatchObject({ nombre: 'Cocina' });
    });

    it('rechaza una impresora de red sin host o puerto', async () => {
      await expect(
        service.crear(TENANT, {
          nombre: 'Cocina',
          rol: 'comanda',
          tipoConexion: 'red',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('crea una impresora de sistema con nombreCola', async () => {
      const result = await service.crear(TENANT, {
        nombre: 'Caja',
        rol: 'boleta',
        tipoConexion: 'sistema',
        nombreCola: 'EPSON_TM_T20',
      });

      expect(result).toMatchObject({ nombreCola: 'EPSON_TM_T20', host: null, puerto: null });
    });

    it('rechaza una impresora de sistema sin nombreCola', async () => {
      await expect(
        service.crear(TENANT, {
          nombre: 'Caja',
          rol: 'boleta',
          tipoConexion: 'sistema',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('actualizar', () => {
    it('lanza NotFound si la impresora no pertenece al tenant', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.actualizar(TENANT, IMPRESORA, { nombre: 'Otra' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('actualiza los campos provistos', async () => {
      repo.findOne.mockResolvedValue({
        id: IMPRESORA,
        tenantId: TENANT,
        nombre: 'Cocina',
        activo: true,
      });

      const result = await service.actualizar(TENANT, IMPRESORA, { activo: false });

      expect(result.activo).toBe(false);
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('eliminar', () => {
    it('hace soft delete de la impresora del tenant', async () => {
      repo.findOne.mockResolvedValue({ id: IMPRESORA, tenantId: TENANT });
      await service.eliminar(TENANT, IMPRESORA);
      expect(repo.softDelete).toHaveBeenCalledWith({ id: IMPRESORA, tenantId: TENANT });
    });
  });
});
```

- [x] **Step 4: Ejecutar el test y confirmar que falla**

Run: `cd backend && npx jest impresoras.service`
Expected: FAIL — no se puede resolver `./impresoras.service` (el archivo no existe).

- [x] **Step 5: Implementar `ImpresorasService`**

```typescript
// backend/src/modules/impresoras/impresoras.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Impresora, RolImpresora } from './entities/impresora.entity';
import { CreateImpresoraDto } from './dto/create-impresora.dto';
import { UpdateImpresoraDto } from './dto/update-impresora.dto';

@Injectable()
export class ImpresorasService {
  constructor(
    @InjectRepository(Impresora)
    private readonly impresoraRepo: Repository<Impresora>,
  ) {}

  listar(tenantId: string, rol?: RolImpresora): Promise<Impresora[]> {
    return this.impresoraRepo.find({
      where: rol ? { tenantId, rol } : { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  crear(tenantId: string, dto: CreateImpresoraDto): Promise<Impresora> {
    this.validarConexion(dto);
    const impresora = this.impresoraRepo.create({
      tenantId,
      nombre: dto.nombre,
      rol: dto.rol,
      tipoConexion: dto.tipoConexion,
      host: dto.tipoConexion === 'red' ? (dto.host ?? null) : null,
      puerto: dto.tipoConexion === 'red' ? (dto.puerto ?? null) : null,
      nombreCola: dto.tipoConexion === 'sistema' ? (dto.nombreCola ?? null) : null,
      activo: dto.activo ?? true,
    });
    return this.impresoraRepo.save(impresora);
  }

  async actualizar(
    tenantId: string,
    id: string,
    dto: UpdateImpresoraDto,
  ): Promise<Impresora> {
    const impresora = await this.getOrThrow(tenantId, id);
    if (dto.nombre !== undefined) impresora.nombre = dto.nombre;
    if (dto.rol !== undefined) impresora.rol = dto.rol;
    if (dto.tipoConexion !== undefined) impresora.tipoConexion = dto.tipoConexion;
    if (dto.host !== undefined) impresora.host = dto.host;
    if (dto.puerto !== undefined) impresora.puerto = dto.puerto;
    if (dto.nombreCola !== undefined) impresora.nombreCola = dto.nombreCola;
    if (dto.activo !== undefined) impresora.activo = dto.activo;
    return this.impresoraRepo.save(impresora);
  }

  async eliminar(tenantId: string, id: string): Promise<void> {
    await this.getOrThrow(tenantId, id);
    await this.impresoraRepo.softDelete({ id, tenantId });
  }

  private validarConexion(dto: CreateImpresoraDto): void {
    if (dto.tipoConexion === 'red' && (!dto.host || !dto.puerto)) {
      throw new BadRequestException(
        'Host y puerto son requeridos para una impresora de red',
      );
    }
    if (dto.tipoConexion === 'sistema' && !dto.nombreCola) {
      throw new BadRequestException(
        'El nombre de la cola es requerido para una impresora de sistema',
      );
    }
  }

  private async getOrThrow(tenantId: string, id: string): Promise<Impresora> {
    const impresora = await this.impresoraRepo.findOne({ where: { id, tenantId } });
    if (!impresora) {
      throw new NotFoundException(`Impresora ${id} no encontrada`);
    }
    return impresora;
  }
}
```

- [x] **Step 6: Ejecutar el test y confirmar que pasa**

Run: `cd backend && npx jest impresoras.service`
Expected: PASS (7 tests)

- [x] **Step 7: Crear el controller**

```typescript
// backend/src/modules/impresoras/impresoras.controller.ts
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
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { ImpresorasService } from './impresoras.service';
import { CreateImpresoraDto } from './dto/create-impresora.dto';
import { UpdateImpresoraDto } from './dto/update-impresora.dto';
import type { RolImpresora } from './entities/impresora.entity';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('impresoras')
export class ImpresorasController {
  constructor(private readonly impresorasService: ImpresorasService) {}

  @Get()
  @RequiresPermiso('Impresoras', 'Leer')
  listar(@Req() req: Request, @Query('rol') rol?: RolImpresora) {
    const user = req.user as { tenantId: string };
    return this.impresorasService.listar(user.tenantId, rol);
  }

  @Post()
  @RequiresPermiso('Impresoras', 'Crear')
  crear(@Req() req: Request, @Body() dto: CreateImpresoraDto) {
    const user = req.user as { tenantId: string };
    return this.impresorasService.crear(user.tenantId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Impresoras', 'Actualizar')
  actualizar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateImpresoraDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.impresorasService.actualizar(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequiresPermiso('Impresoras', 'Eliminar')
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.impresorasService.eliminar(user.tenantId, id);
  }
}
```

- [x] **Step 8: Crear el module**

```typescript
// backend/src/modules/impresoras/impresoras.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Impresora } from './entities/impresora.entity';
import { ImpresorasService } from './impresoras.service';
import { ImpresorasController } from './impresoras.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Impresora])],
  controllers: [ImpresorasController],
  providers: [ImpresorasService],
  exports: [ImpresorasService],
})
export class ImpresorasModule {}
```

- [x] **Step 9: Registrar en `app.module.ts`**

Agregar los imports junto a los de `GarzonesModule` (después de la línea `import { Garzon } from './modules/garzones/entities/garzon.entity';`):

```typescript
import { ImpresorasModule } from './modules/impresoras/impresoras.module';
import { Impresora } from './modules/impresoras/entities/impresora.entity';
```

Agregar `Impresora` al array `entities` (después de `Garzon,`):

```typescript
          Garzon,
          Impresora,
```

Agregar `ImpresorasModule` al array `imports` (después de `GarzonesModule,`):

```typescript
    SalonesModule,
    GarzonesModule,
    ImpresorasModule,
```

- [x] **Step 10: Compilar y correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: PASS (todos los tests, incluidos los nuevos de `impresoras`)

- [x] **Step 11: Commit**

```bash
git add backend/src/modules/impresoras backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(impresoras): agrega módulo CRUD de impresoras térmicas

Nuevo módulo con RBAC propio (Leer/Crear/Actualizar/Eliminar) para que
el tenant configure sus impresoras de comanda (cocina/barra) y de
boleta, por conexión de red (host+puerto) o cola del sistema.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extender `categorias` con `impresora_id` (ruteo de comanda)

**Files:**
- Modify: `backend/src/modules/categorias/entities/categoria.entity.ts`
- Modify: `backend/src/modules/categorias/dto/create-categoria.dto.ts`
- Modify: `backend/src/modules/categorias/dto/update-categoria.dto.ts`
- Modify: `backend/src/modules/categorias/categorias.service.ts`
- Modify: `backend/src/modules/categorias/categorias.service.spec.ts`

**Interfaces:**
- Consumes: nada de Task 1 en tiempo de compilación (la validación usa SQL raw contra la tabla `impresoras`, sin importar `ImpresorasModule`, igual que `getItemVendibleOrThrow` en `salones.service.ts`).
- Produces: `Categoria.impresoraId: string | null`; `CreateCategoriaDto.impresoraId?: string | null`, `UpdateCategoriaDto.impresoraId?: string | null` (acepta `null` para desasignar). Consumido por Task 3 (JOIN en `previewComanda`) y Task 8 (frontend).

- [x] **Step 1: Escribir el test que falla — crear/actualizar validan la impresora**

Agregar al final de `describe('create', ...)` y `describe('update', ...)` en `backend/src/modules/categorias/categorias.service.spec.ts`. Primero ajustar el `beforeEach` para inyectar `DataSource`:

```typescript
// Reemplazar el bloque de imports del inicio del archivo:
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoriasService } from './categorias.service';
import { Categoria } from './entities/categoria.entity';

const TENANT = 'tenant-uuid';
const CAT = 'categoria-uuid';
const IMPRESORA = 'impresora-uuid';

describe('CategoriasService', () => {
  let service: CategoriasService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    dataSource = { query: jest.fn().mockResolvedValue([{ impresora_id: IMPRESORA }]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriasService,
        { provide: getRepositoryToken(Categoria), useValue: repo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<CategoriasService>(CategoriasService);
  });
```

Agregar estos dos tests dentro de `describe('create', ...)`:

```typescript
    it('acepta un impresoraId válido (de rol comanda, activa, del tenant)', async () => {
      const result = await service.create(TENANT, {
        nombre: 'Bebidas',
        impresoraId: IMPRESORA,
      });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining("rol = 'comanda'"),
        [IMPRESORA, TENANT],
      );
      expect(result).toMatchObject({ impresoraId: IMPRESORA });
    });

    it('rechaza un impresoraId que no existe o no es de rol comanda', async () => {
      dataSource.query.mockResolvedValue([]);
      await expect(
        service.create(TENANT, { nombre: 'Bebidas', impresoraId: IMPRESORA }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });
```

- [x] **Step 2: Ejecutar el test y confirmar que falla**

Run: `cd backend && npx jest categorias.service`
Expected: FAIL — `CategoriasService` no acepta `impresoraId` todavía / falta el provider `DataSource`.

- [x] **Step 3: Extender la entity**

```typescript
// backend/src/modules/categorias/entities/categoria.entity.ts
// Agregar la columna después de `aplicaA`:
  @Column({ name: 'impresora_id', type: 'uuid', nullable: true })
  impresoraId: string | null;
```

- [x] **Step 4: Extender los DTOs**

```typescript
// backend/src/modules/categorias/dto/create-categoria.dto.ts
// Agregar el import IsUUID y el campo al final de la clase:
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class CreateCategoriaDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsOptional()
  @IsIn(['productos', 'servicios', 'ambos'])
  aplicaA?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  // `null` explícito desasigna la ruta de comanda; un UUID la (re)asigna.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  impresoraId?: string | null;
}
```

```typescript
// backend/src/modules/categorias/dto/update-categoria.dto.ts
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class UpdateCategoriaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @IsOptional()
  @IsIn(['productos', 'servicios', 'ambos'])
  aplicaA?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  // `null` explícito desasigna la ruta; `Object.assign` en el service la limpia.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  impresoraId?: string | null;
}
```

- [x] **Step 5: Implementar la validación en el service**

```typescript
// backend/src/modules/categorias/categorias.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Categoria } from './entities/categoria.entity';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';

@Injectable()
export class CategoriasService {
  constructor(
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  findAll(tenantId: string): Promise<Categoria[]> {
    return this.categoriaRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  async create(tenantId: string, dto: CreateCategoriaDto): Promise<Categoria> {
    if (dto.impresoraId) {
      await this.validarImpresoraComanda(tenantId, dto.impresoraId);
    }
    const categoria = this.categoriaRepo.create({
      tenantId,
      nombre: dto.nombre,
      aplicaA: dto.aplicaA ?? 'ambos',
      activo: dto.activo ?? true,
      impresoraId: dto.impresoraId ?? null,
    });
    return this.categoriaRepo.save(categoria);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCategoriaDto,
  ): Promise<Categoria> {
    const categoria = await this.categoriaRepo.findOne({
      where: { id, tenantId },
    });
    if (!categoria) {
      throw new NotFoundException(`Categoría ${id} no encontrada`);
    }
    if (dto.impresoraId) {
      await this.validarImpresoraComanda(tenantId, dto.impresoraId);
    }
    Object.assign(categoria, dto);
    return this.categoriaRepo.save(categoria);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const categoria = await this.categoriaRepo.findOne({
      where: { id, tenantId },
    });
    if (!categoria) {
      throw new NotFoundException(`Categoría ${id} no encontrada`);
    }
    await this.categoriaRepo.softDelete({ id, tenantId });
  }

  private async validarImpresoraComanda(
    tenantId: string,
    impresoraId: string,
  ): Promise<void> {
    const rows: { impresora_id: string }[] = await this.dataSource.query(
      `SELECT impresora_id FROM impresoras
        WHERE impresora_id = $1 AND tenant_id = $2 AND rol = 'comanda'
          AND activo = true AND eliminado_el IS NULL`,
      [impresoraId, tenantId],
    );
    if (rows.length === 0) {
      throw new BadRequestException(
        `Impresora ${impresoraId} no es válida para comandas`,
      );
    }
  }
}
```

- [x] **Step 6: Ejecutar el test y confirmar que pasa**

Run: `cd backend && npx jest categorias.service`
Expected: PASS (todos los tests de `categorias.service.spec.ts`, incluidos los 2 nuevos)

- [x] **Step 7: Commit**

```bash
git add backend/src/modules/categorias
git commit -m "$(cat <<'EOF'
feat(categorias): agrega impresora_id para rutear comandas por categoría

Cada categoría puede apuntar a una impresora de rol 'comanda'; se
valida que exista, sea del tenant, esté activa y tenga ese rol.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `cuenta_lineas.cantidad_enviada` + endpoint `POST /cuentas/:id/comanda`

**Files:**
- Modify: `backend/src/modules/salones/entities/cuenta-linea.entity.ts`
- Create: `backend/src/modules/salones/dto/confirmar-comanda.dto.ts`
- Modify: `backend/src/modules/salones/salones.service.ts`
- Modify: `backend/src/modules/salones/salones.service.spec.ts`
- Modify: `backend/src/modules/salones/salones.controller.ts`

**Interfaces:**
- Consumes: tabla `impresoras` (Task 1) y `categorias.impresora_id` (Task 2) vía SQL raw.
- Produces (dos fases, para no perder comandas si la impresión del navegador falla):
  - `SalonesService.previewComanda(tenantId, cuentaId): Promise<{ estaciones: ComandaEstacion[] }>` — calcula el diff pendiente agrupado por impresora, **sin persistir nada**. `ComandaEstacion = { impresoraId: string; nombre: string; items: { cuentaLineaId: string; nombre: string; cantidad: string; cantidadEnviada: string }[] }` donde `cantidad` es el diff a imprimir y `cantidadEnviada` es el total absoluto a persistir al confirmar. Ruta `GET /cuentas/:id/comanda/pendiente`.
  - `SalonesService.confirmarComanda(tenantId, cuentaId, dto): Promise<void>` — marca `cantidad_enviada` para las líneas ya impresas. `dto = { lineas: { cuentaLineaId: string; cantidadEnviada: string }[] }`. Ruta `POST /cuentas/:id/comanda`.
  - Ambas consumidas por el frontend en Task 6, que llama preview → imprime por estación → confirma solo lo efectivamente impreso.

- [x] **Step 1: Agregar la columna a la entity**

```typescript
// backend/src/modules/salones/entities/cuenta-linea.entity.ts
// Agregar después de la columna `cantidad`:
  // Cuánto de `cantidad` ya se envió a cocina/barra (POST /cuentas/:id/comanda).
  // El diff (cantidad - cantidad_enviada) es lo que se imprime en el próximo envío.
  @Column({ name: 'cantidad_enviada', type: 'numeric', precision: 18, scale: 4, default: 0 })
  cantidadEnviada: string;
```

- [x] **Step 2: Escribir los tests que fallan para `previewComanda` / `confirmarComanda`**

Agregar al final de `backend/src/modules/salones/salones.service.spec.ts`, dentro de `describe('SalonesService', ...)`, antes del cierre del archivo. `previewComanda` es solo-lectura (usa `cuentaRepo.findOne` + `dataSource.query`, sin transacción); `confirmarComanda` persiste dentro de una transacción (`manager.findOne` + `manager.update`):

```typescript
  describe('previewComanda', () => {
    it('agrupa por impresora solo los ítems con diferencia pendiente, SIN persistir', async () => {
      cuentaRepo.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      dataSource.query.mockResolvedValue([
        {
          cuenta_linea_id: 'linea-1',
          cantidad: '3',
          cantidad_enviada: '1',
          nombre: 'Lomo a lo pobre',
          impresora_id: 'impresora-cocina',
          impresora_nombre: 'Cocina',
        },
        {
          cuenta_linea_id: 'linea-2',
          cantidad: '2',
          cantidad_enviada: '2',
          nombre: 'Agua mineral',
          impresora_id: 'impresora-barra',
          impresora_nombre: 'Barra',
        },
        {
          cuenta_linea_id: 'linea-3',
          cantidad: '1',
          cantidad_enviada: '0',
          nombre: 'Postre sin ruta',
          impresora_id: null,
          impresora_nombre: null,
        },
      ]);

      const result = await service.previewComanda(TENANT, CUENTA);

      expect(result.estaciones).toEqual([
        {
          impresoraId: 'impresora-cocina',
          nombre: 'Cocina',
          items: [
            {
              cuentaLineaId: 'linea-1',
              nombre: 'Lomo a lo pobre',
              cantidad: '2', // diff a imprimir
              cantidadEnviada: '3', // total absoluto a persistir al confirmar
            },
          ],
        },
      ]);
      // preview NO persiste nada
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequest si la cuenta no está abierta', async () => {
      cuentaRepo.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });
      await expect(service.previewComanda(TENANT, CUENTA)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza NotFound si la cuenta no pertenece al tenant', async () => {
      cuentaRepo.findOne.mockResolvedValue(null);
      await expect(service.previewComanda(TENANT, CUENTA)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('confirmarComanda', () => {
    it('marca cantidad_enviada solo para las líneas impresas', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });

      await service.confirmarComanda(TENANT, CUENTA, {
        lineas: [{ cuentaLineaId: 'linea-1', cantidadEnviada: '3' }],
      });

      expect(manager.update).toHaveBeenCalledWith(
        CuentaLinea,
        { id: 'linea-1', tenantId: TENANT },
        { cantidadEnviada: '3' },
      );
    });

    it('lanza BadRequest si la cuenta no está abierta', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });
      await expect(
        service.confirmarComanda(TENANT, CUENTA, { lineas: [] }),
      ).rejects.toThrow(BadRequestException);
    });
  });
```

También agregar `update: jest.fn(() => Promise.resolve({ affected: 1 })),` al objeto `manager` declarado en el `beforeEach` de ese archivo (junto a `softDelete`).

- [x] **Step 3: Ejecutar los tests y confirmar que fallan**

Run: `cd backend && npx jest salones.service`
Expected: FAIL — `service.previewComanda is not a function`

- [x] **Step 4: Crear el DTO e implementar `previewComanda` / `confirmarComanda`**

Primero el DTO del confirm:

```typescript
// backend/src/modules/salones/dto/confirmar-comanda.dto.ts
import { IsArray, IsNumberString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class LineaEnviadaDto {
  @IsUUID()
  cuentaLineaId: string;

  // numeric viaja como string (ver Global Constraints)
  @IsNumberString()
  cantidadEnviada: string;
}

export class ConfirmarComandaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaEnviadaDto)
  lineas: LineaEnviadaDto[];
}
```

El import de `Decimal` ya existe en el archivo. Agregar esta interfaz a nivel de
módulo (no dentro de la clase), junto a las demás interfaces exportadas al inicio del
archivo, cerca de `CuentaDetalle`. `cantidad` es el diff a imprimir; `cantidadEnviada`
es el total absoluto que se persistirá al confirmar:

```typescript
export interface ComandaEstacion {
  impresoraId: string;
  nombre: string;
  items: {
    cuentaLineaId: string;
    nombre: string;
    cantidad: string;
    cantidadEnviada: string;
  }[];
}
```

Importar el DTO al inicio del archivo (junto a los demás DTOs de salones):

```typescript
import { ConfirmarComandaDto } from './dto/confirmar-comanda.dto';
```

Luego agregar los dos métodos dentro de la clase `SalonesService`, junto a los demás
métodos de "Operación: cuentas" (después de `cerrarCuenta`). **`previewComanda` NO
persiste nada** — solo calcula el diff; `confirmarComanda` marca `cantidad_enviada`
recién cuando el navegador confirma que imprimió (evita perder la comanda si QZ Tray
falla, ya que no hay reimpresión):

```typescript
  /**
   * Calcula el diff (cantidad - cantidad_enviada) de cada línea, agrupado por la
   * impresora de la categoría del ítem. NO persiste: es una vista previa idempotente.
   * Ítems sin categoría o cuya categoría no tiene impresora se excluyen. Devuelve
   * estaciones vacías si no hay nada nuevo. El frontend imprime y luego confirma.
   */
  async previewComanda(
    tenantId: string,
    cuentaId: string,
  ): Promise<{ estaciones: ComandaEstacion[] }> {
    const cuenta = await this.cuentaRepo.findOne({
      where: { id: cuentaId, tenantId },
    });
    if (!cuenta) {
      throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
    }
    if (cuenta.estado !== EstadoCuenta.ABIERTA) {
      throw new BadRequestException('La cuenta no está abierta');
    }

    const rows: {
      cuenta_linea_id: string;
      cantidad: string;
      cantidad_enviada: string;
      nombre: string;
      impresora_id: string | null;
      impresora_nombre: string | null;
    }[] = await this.dataSource.query(
      `SELECT cl.cuenta_linea_id, cl.cantidad, cl.cantidad_enviada,
              i.nombre, imp.impresora_id, imp.nombre AS impresora_nombre
         FROM cuenta_lineas cl
         JOIN items i ON i.item_id = cl.item_id AND i.eliminado_el IS NULL
         LEFT JOIN categorias c
           ON c.categoria_id = i.categoria_id AND c.eliminado_el IS NULL
         LEFT JOIN impresoras imp
           ON imp.impresora_id = c.impresora_id AND imp.eliminado_el IS NULL
              AND imp.activo = true
        WHERE cl.cuenta_id = $1 AND cl.tenant_id = $2 AND cl.eliminado_el IS NULL`,
      [cuentaId, tenantId],
    );

    const estacionesMap = new Map<string, ComandaEstacion>();
    for (const row of rows) {
      const diff = new Decimal(row.cantidad).minus(row.cantidad_enviada);
      if (diff.lte(0) || !row.impresora_id) continue;

      const estacion = estacionesMap.get(row.impresora_id) ?? {
        impresoraId: row.impresora_id,
        nombre: row.impresora_nombre ?? '',
        items: [],
      };
      estacion.items.push({
        cuentaLineaId: row.cuenta_linea_id,
        nombre: row.nombre,
        cantidad: diff.toString(),
        cantidadEnviada: row.cantidad, // total absoluto a persistir al confirmar
      });
      estacionesMap.set(row.impresora_id, estacion);
    }

    return { estaciones: [...estacionesMap.values()] };
  }

  /**
   * Marca cantidad_enviada = cantidadEnviada para las líneas que el navegador ya
   * imprimió. Se llama por estación tras un print exitoso; setear el total absoluto
   * (no sumar) lo hace idempotente ante reintentos y tolera cambios de cantidad
   * entre el preview y el confirm.
   */
  async confirmarComanda(
    tenantId: string,
    cuentaId: string,
    dto: ConfirmarComandaDto,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const cuenta = await manager.findOne(Cuenta, {
        where: { id: cuentaId, tenantId },
      });
      if (!cuenta) {
        throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
      }
      if (cuenta.estado !== EstadoCuenta.ABIERTA) {
        throw new BadRequestException('La cuenta no está abierta');
      }
      for (const linea of dto.lineas) {
        await manager.update(
          CuentaLinea,
          { id: linea.cuentaLineaId, tenantId },
          { cantidadEnviada: linea.cantidadEnviada },
        );
      }
    });
  }
```

- [x] **Step 5: Sumar `cantidadEnviada` al fusionar cuentas (evita reenvíos duplicados)**

En `fusionarCuentas`, dentro del bloque `if (existente) { ... }`, junto a la línea que suma `cantidad`:

```typescript
          if (existente) {
            existente.cantidad = new Decimal(existente.cantidad)
              .plus(linea.cantidad)
              .toString();
            existente.cantidadEnviada = new Decimal(existente.cantidadEnviada)
              .plus(linea.cantidadEnviada)
              .toString();
            await manager.save(CuentaLinea, existente);
```

- [x] **Step 6: Ejecutar los tests y confirmar que pasan**

Run: `cd backend && npx jest salones.service`
Expected: PASS (todos los tests, incluidos los 5 nuevos de `previewComanda` / `confirmarComanda`)

- [x] **Step 7: Agregar la ruta en el controller**

```typescript
// backend/src/modules/salones/salones.controller.ts
// Importar el DTO junto a los demás:
import { ConfirmarComandaDto } from './dto/confirmar-comanda.dto';

// Dentro de CuentasController, después de agregarLinea:
  @Get(':id/comanda/pendiente')
  @RequiresPermiso('Salones', 'Operar')
  previewComanda(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.salonesService.previewComanda(u.tenantId ?? '', id);
  }

  @Post(':id/comanda')
  @RequiresPermiso('Salones', 'Operar')
  confirmarComanda(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ConfirmarComandaDto,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.confirmarComanda(u.tenantId ?? '', id, dto);
  }
```

Verificar que `Get` y `Body` estén en el `import { ... } from '@nestjs/common'` del controller (agregarlos si falta alguno).

- [x] **Step 8: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: PASS

- [x] **Step 9: Commit**

```bash
git add backend/src/modules/salones
git commit -m "$(cat <<'EOF'
feat(salones): agrega comanda en dos fases (preview + confirmar)

cuenta_lineas.cantidad_enviada trackea cuánto ya se imprimió. GET
/comanda/pendiente calcula el diff por estación SIN persistir; POST
/comanda marca cantidad_enviada solo tras una impresión exitosa en el
navegador. Así un fallo de QZ Tray no pierde la comanda (no hay
reimpresión). fusionarCuentas suma cantidadEnviada para no reenviar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Seed de desarrollo (módulo, permisos, impresoras demo)

**Files:**
- Modify: `backend/src/modules/seeder/seeder.module.ts`
- Modify: `backend/src/modules/seeder/seeder.service.ts`

**Interfaces:**
- Consumes: `Impresora` entity (Task 1), `Categoria.impresoraId` (Task 2).
- Produces: `modulo_app` "Impresoras" contratado para el tenant Paris; 3 impresoras demo (Cocina, Barra — rol comanda; Caja — rol boleta); la categoría "Ropa y accesorios" de Paris rutea a "Cocina" (dato de demo para poder probar el flujo de comanda de punta a punta sin configurar nada manualmente).

- [x] **Step 1: Registrar `Impresora` en `seeder.module.ts`**

```typescript
// backend/src/modules/seeder/seeder.module.ts
// Agregar el import junto al de Garzon:
import { Impresora } from '../impresoras/entities/impresora.entity';

// Agregar Impresora al array de TypeOrmModule.forFeature([...]), después de Garzon:
      Garzon,
      Impresora,
```

- [x] **Step 2: Inyectar el repo en `seeder.service.ts`**

```typescript
// backend/src/modules/seeder/seeder.service.ts
// Agregar el import junto al de Garzon:
import { Impresora, RolImpresora, TipoConexionImpresora } from '../impresoras/entities/impresora.entity';

// Agregar el constructor param junto a garzonRepo:
    @InjectRepository(Impresora)
    private readonly impresoraRepo: Repository<Impresora>,
```

- [x] **Step 3: Agregar el módulo "Impresoras" a `seedModulosApp`**

```typescript
// Dentro del array `modulos` de seedModulosApp(), después de la entrada de Salones:
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440241',
        nombre: 'Impresoras',
        url: '/configuracion/impresoras',
        icono: 'mdi-printer',
        tieneConfiguracion: false,
      },
```

- [x] **Step 4: Agregar sus permisos a `seedModuloAppPermisos`**

```typescript
// Dentro de seedModuloAppPermisos(), declarar la constante junto a SALONES:
    const IMPRESORAS = '550e8400-e29b-41d4-a716-446655440241';

// Y agregar las entradas al array `entries`, después de las de Salones:
      // Impresoras (config de impresión térmica: comandas, precuenta, boleta)
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440242',
        moduloAppId: IMPRESORAS,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440243',
        moduloAppId: IMPRESORAS,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440244',
        moduloAppId: IMPRESORAS,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440245',
        moduloAppId: IMPRESORAS,
        permisoId: ELIMINAR,
      },
```

- [x] **Step 5: Contratar el módulo para Paris en `seedTenantModulo`**

```typescript
// Dentro del array `entries` de seedTenantModulo(), después de la entrada de Salones:
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440246',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440241', // Paris → Impresoras
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
```

- [x] **Step 6: Crear `seedImpresoras()`**

```typescript
// Nuevo método privado, ubicarlo junto a seedGarzones():
  private async seedImpresoras(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const impresoras: Partial<Impresora>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440247',
        tenantId: PARIS,
        nombre: 'Cocina',
        rol: 'comanda' as RolImpresora,
        tipoConexion: 'red' as TipoConexionImpresora,
        host: '192.168.1.50',
        puerto: 9100,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440248',
        tenantId: PARIS,
        nombre: 'Barra',
        rol: 'comanda' as RolImpresora,
        tipoConexion: 'red' as TipoConexionImpresora,
        host: '192.168.1.51',
        puerto: 9100,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440249',
        tenantId: PARIS,
        nombre: 'Caja',
        rol: 'boleta' as RolImpresora,
        tipoConexion: 'red' as TipoConexionImpresora,
        host: '192.168.1.52',
        puerto: 9100,
        activo: true,
      },
    ];
    for (const data of impresoras) {
      const exists = await this.impresoraRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.impresoraRepo.save(this.impresoraRepo.create(data));
      }
    }
  }
```

- [x] **Step 7: Vincular una categoría demo a "Cocina" en `seedCategorias`**

```typescript
// Dentro del array `categorias` de seedCategorias(), en la entrada 'Ropa y accesorios':
      {
        id: '550e8400-e29b-41d4-a716-446655440111',
        tenantId: PARIS,
        nombre: 'Ropa y accesorios',
        aplicaA: 'ambos',
        activo: true,
        // Demo: rutea a "Cocina" para poder probar el flujo de comanda
        // sin configurar nada manualmente (ver seedImpresoras).
        impresoraId: '550e8400-e29b-41d4-a716-446655440247',
      },
```

- [x] **Step 8: Llamar `seedImpresoras()` antes de `seedCategorias()` en `onApplicationBootstrap`**

```typescript
    await this.seedTenantMetodosPago();
    await this.seedImpresoras();
    await this.seedCategorias();
```

- [x] **Step 9: Correr el backend y verificar el seed**

Run: `cd backend && npm test`
Expected: PASS

Run: `docker-compose up --build` (o `cd backend && npm run start:dev` si ya está levantada la BD) y revisar el log — no debe haber errores de seed.

> **Idempotencia:** `seedCategorias`/`seedImpresoras` usan `if (!exists)`, así que en
> una BD de dev **ya existente** la categoría "Ropa y accesorios" NO recibirá el nuevo
> `impresoraId` (se salta el update) y el ruteo demo no aplicará. Para probar el flujo
> de comanda de punta a punta, recrear el volumen primero: `docker-compose down -v && docker-compose up --build`.

- [x] **Step 10: Commit**

```bash
git add backend/src/modules/seeder
git commit -m "$(cat <<'EOF'
feat(seeder): siembra módulo Impresoras y 3 impresoras demo en Paris

Cocina y Barra (rol comanda) + Caja (rol boleta); la categoría "Ropa y
accesorios" rutea a Cocina para poder probar el flujo de comanda sin
configuración manual previa.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `utils/ticket-builder.ts` — formateo puro de tickets (TDD, Vitest)

**Files:**
- Create: `frontend/app/utils/ticket-builder.ts`
- Create: `frontend/app/utils/ticket-builder.spec.ts`

**Interfaces:**
- Produces: `buildComandaTicket(input): string[]`, `buildPrecuentaTicket(input): string[]`, `buildBoletaTicket(input): string[]`, y los tipos `TicketItem`, `TicketTotales`, `TicketPago`. Consumidos por `useImpresoras.ts` en Task 6. Sin dependencias de Nuxt/Vue/QZ — 100% funciones puras.

- [x] **Step 1: Escribir los tests (fallan — el módulo no existe)**

```typescript
// frontend/app/utils/ticket-builder.spec.ts
import { describe, it, expect } from 'vitest'
import { buildComandaTicket, buildPrecuentaTicket, buildBoletaTicket } from './ticket-builder'

const formatMonto = (v: string) => `$${v}`
const FECHA = new Date('2026-07-13T20:30:00')

describe('buildComandaTicket', () => {
  it('incluye la estación, la mesa, el garzón y los ítems con cantidad', () => {
    const lines = buildComandaTicket({
      estacionNombre: 'Cocina',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 2,
      garzonNombre: 'Ana Torres',
      items: [{ nombre: 'Lomo a lo pobre', cantidad: '2' }],
      fecha: FECHA,
    })

    expect(lines).toContain('*** COCINA ***')
    expect(lines).toContain('Mesa: Mesa 1   Cuenta: 2')
    expect(lines).toContain('Garzón: Ana Torres')
    expect(lines).toContain('2 x Lomo a lo pobre')
  })

  it('omite la línea de garzón si no viene', () => {
    const lines = buildComandaTicket({
      estacionNombre: 'Barra',
      mesaNombre: 'Mesa 3',
      cuentaNumero: 1,
      garzonNombre: null,
      items: [{ nombre: 'Agua mineral', cantidad: '1' }],
      fecha: FECHA,
    })

    expect(lines.some(l => l.startsWith('Garzón:'))).toBe(false)
  })
})

describe('buildPrecuentaTicket', () => {
  it('lista los ítems con su total y el desglose de totales', () => {
    const lines = buildPrecuentaTicket({
      tenantNombre: 'Restaurante Paris',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 2,
      items: [{ nombre: 'Lomo a lo pobre', cantidad: '2', totalLinea: '18000' }],
      totales: {
        subtotalNeto: '18000',
        totalDescuentos: '0',
        totalRecargos: '0',
        totalImpuestos: '3420',
        totalFinal: '21420',
      },
      fecha: FECHA,
      formatMonto,
    })

    expect(lines).toContain('PRECUENTA (no válido como boleta)')
    expect(lines).toContain('2 x Lomo a lo pobre')
    expect(lines).toContain('TOTAL: $21420')
    expect(lines.some(l => l.startsWith('Descuentos:'))).toBe(false)
  })
})

describe('buildBoletaTicket', () => {
  it('incluye ítems, totales y los pagos', () => {
    const lines = buildBoletaTicket({
      tenantNombre: 'Restaurante Paris',
      items: [{ nombre: 'Lomo a lo pobre', cantidad: '2', totalLinea: '18000' }],
      totales: {
        subtotalNeto: '18000',
        totalDescuentos: '1000',
        totalRecargos: '0',
        totalImpuestos: '3420',
        totalFinal: '20420',
      },
      pagos: [{ nombre: 'Efectivo', monto: '20420' }],
      fecha: FECHA,
      formatMonto,
    })

    expect(lines).toContain('BOLETA')
    expect(lines).toContain('Descuentos: -$1000')
    expect(lines).toContain('Efectivo: $20420')
    expect(lines).toContain('TOTAL: $20420')
  })
})
```

- [x] **Step 2: Ejecutar los tests y confirmar que fallan**

Run: `cd frontend && npm test -- --run app/utils/ticket-builder.spec.ts`
Expected: FAIL — no se puede resolver `./ticket-builder`

- [x] **Step 3: Implementar `ticket-builder.ts`**

```typescript
// frontend/app/utils/ticket-builder.ts
import Decimal from 'decimal.js'

export interface TicketItem {
  nombre: string
  cantidad: string
}

export interface TicketTotales {
  subtotalNeto: string
  totalDescuentos: string
  totalRecargos: string
  totalImpuestos: string
  totalFinal: string
}

export interface TicketPago {
  nombre: string
  monto: string
}

// Todos los builders devuelven un array de líneas LÓGICAS (sin '\n'). El composable
// (useImpresoras) las une con '\n' antes de mandarlas a QZ Tray. No agregar '\n' aquí:
// rompería los tests de membresía de array (`expect(lines).toContain('...')`).
function separador(width = 32): string {
  return '-'.repeat(width)
}

function buildTotalesLines(
  totales: TicketTotales,
  formatMonto: (v: string) => string,
): string[] {
  const out: string[] = []
  out.push(`Subtotal: ${formatMonto(totales.subtotalNeto)}`)
  if (new Decimal(totales.totalDescuentos || '0').gt(0)) {
    out.push(`Descuentos: -${formatMonto(totales.totalDescuentos)}`)
  }
  if (new Decimal(totales.totalRecargos || '0').gt(0)) {
    out.push(`Recargos: +${formatMonto(totales.totalRecargos)}`)
  }
  if (new Decimal(totales.totalImpuestos || '0').gt(0)) {
    out.push(`Impuestos: ${formatMonto(totales.totalImpuestos)}`)
  }
  out.push(`TOTAL: ${formatMonto(totales.totalFinal)}`)
  return out
}

/** Ticket de comanda para una estación (cocina/barra) — solo los ítems nuevos. */
export function buildComandaTicket(input: {
  estacionNombre: string
  mesaNombre: string
  cuentaNumero: number
  garzonNombre: string | null
  items: TicketItem[]
  fecha: Date
}): string[] {
  const out: string[] = []
  out.push(`*** ${input.estacionNombre.toUpperCase()} ***`)
  out.push(`Mesa: ${input.mesaNombre}   Cuenta: ${input.cuentaNumero}`)
  if (input.garzonNombre) out.push(`Garzón: ${input.garzonNombre}`)
  out.push(input.fecha.toLocaleString('es-CL'))
  out.push(separador())
  for (const item of input.items) {
    out.push(`${item.cantidad} x ${item.nombre}`)
  }
  out.push('')
  out.push('')
  return out
}

/** Resumen no fiscal del consumo actual de una cuenta, antes de cobrar. */
export function buildPrecuentaTicket(input: {
  tenantNombre: string
  mesaNombre: string
  cuentaNumero: number
  items: (TicketItem & { totalLinea: string })[]
  totales: TicketTotales
  fecha: Date
  formatMonto: (v: string) => string
}): string[] {
  const out: string[] = []
  out.push(input.tenantNombre)
  out.push('PRECUENTA (no válido como boleta)')
  out.push(`Mesa: ${input.mesaNombre}   Cuenta: ${input.cuentaNumero}`)
  out.push(input.fecha.toLocaleString('es-CL'))
  out.push(separador())
  for (const item of input.items) {
    out.push(`${item.cantidad} x ${item.nombre}`)
    out.push(`  ${input.formatMonto(item.totalLinea)}`)
  }
  out.push(separador())
  out.push(...buildTotalesLines(input.totales, input.formatMonto))
  out.push('')
  out.push('')
  return out
}

/** Comprobante de venta (mesa o mostrador) con el desglose de pagos. */
export function buildBoletaTicket(input: {
  tenantNombre: string
  items: (TicketItem & { totalLinea: string })[]
  totales: TicketTotales
  pagos: TicketPago[]
  fecha: Date
  formatMonto: (v: string) => string
}): string[] {
  const out: string[] = []
  out.push(input.tenantNombre)
  out.push('BOLETA')
  out.push(input.fecha.toLocaleString('es-CL'))
  out.push(separador())
  for (const item of input.items) {
    out.push(`${item.cantidad} x ${item.nombre}`)
    out.push(`  ${input.formatMonto(item.totalLinea)}`)
  }
  out.push(separador())
  out.push(...buildTotalesLines(input.totales, input.formatMonto))
  out.push(separador())
  for (const pago of input.pagos) {
    out.push(`${pago.nombre}: ${input.formatMonto(pago.monto)}`)
  }
  out.push('')
  out.push('¡Gracias por su compra!')
  out.push('')
  out.push('')
  return out
}
```

- [x] **Step 4: Ejecutar los tests y confirmar que pasan**

Run: `cd frontend && npm test -- --run app/utils/ticket-builder.spec.ts`
Expected: PASS (5 tests)

- [x] **Step 5: Commit**

```bash
git add frontend/app/utils/ticket-builder.ts frontend/app/utils/ticket-builder.spec.ts
git commit -m "$(cat <<'EOF'
feat(impresoras): agrega ticket-builder — formateo puro de comanda/precuenta/boleta

Funciones sin Nuxt/Vue, 100% Vitest, siguiendo el patrón de helpers
puros de useVenta.ts. useImpresoras (próximo commit) las envuelve con
la impresión real vía QZ Tray.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `composables/useImpresoras.ts` — QZ Tray + CRUD

**Files:**
- Modify: `frontend/package.json` (agregar dependencia `qz-tray`)
- Create: `frontend/app/composables/useImpresoras.ts`

**Interfaces:**
- Consumes: `buildComandaTicket`, `buildPrecuentaTicket`, `buildBoletaTicket`, `TicketItem`, `TicketTotales`, `TicketPago` de `~/utils/ticket-builder` (Task 5). Endpoints `GET/POST /impresoras`, `PATCH/DELETE /impresoras/:id` (Task 1), `POST /cuentas/:id/comanda` (Task 3).
- Produces: `useImpresoras()` → `{ listar, crear, actualizar, eliminar, imprimirComanda, imprimirPrecuenta, imprimirBoleta }`. Consumido por Task 7 (admin), Task 9 (salones) y Task 10 (POS).

- [x] **Step 1: Instalar `qz-tray`**

Run: `cd frontend && npm install qz-tray`
Expected: agrega `qz-tray` a `dependencies` en `frontend/package.json`.

> Si `qz-tray` no trae tipos y `nuxi typecheck` (Step 3) se queja del `import('qz-tray')`,
> agregar un shim mínimo en `frontend/app/types/qz-tray.d.ts` (`declare module 'qz-tray'`
> con `websocket`, `configs`, `print`) en vez de silenciar con `@ts-expect-error`.

- [x] **Step 2: Implementar el composable**

```typescript
// frontend/app/composables/useImpresoras.ts
import { useApiFetch } from './useApiFetch'
import {
  buildComandaTicket,
  buildPrecuentaTicket,
  buildBoletaTicket,
  type TicketItem,
  type TicketTotales,
  type TicketPago,
} from '~/utils/ticket-builder'

// ── Tipos (espejo del contrato del backend impresoras) ──────────────────────

export type RolImpresora = 'comanda' | 'boleta'
export type TipoConexionImpresora = 'red' | 'sistema'

export interface Impresora {
  id: string
  nombre: string
  rol: RolImpresora
  tipoConexion: TipoConexionImpresora
  host: string | null
  puerto: number | null
  nombreCola: string | null
  activo: boolean
}

export interface ImpresoraFormBody {
  nombre: string
  rol: RolImpresora
  tipoConexion: TipoConexionImpresora
  host?: string
  puerto?: number
  nombreCola?: string
  activo?: boolean
}

export interface ComandaEstacionItem {
  cuentaLineaId: string
  nombre: string
  cantidad: string // diff a imprimir
  cantidadEnviada: string // total absoluto a persistir al confirmar
}

export interface ComandaEstacion {
  impresoraId: string
  nombre: string
  items: ComandaEstacionItem[]
}

interface ComandaPreviewResponse {
  estaciones: ComandaEstacion[]
}

// qz-tray es solo-navegador (usa WebSocket/window). Cargarlo de forma perezosa
// evita que se evalúe durante el SSR (habilitado por defecto) y rompa el render.
let qzPromise: Promise<(typeof import('qz-tray'))['default']> | null = null
function getQz() {
  if (!qzPromise) qzPromise = import('qz-tray').then(m => m.default)
  return qzPromise
}

async function imprimirEn(impresora: Impresora, lineas: string[]): Promise<void> {
  const qz = await getQz()
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect()
  }
  // "Red": QZ abre un socket raw a host:puerto (ESC/POS TCP 9100) y escribe los
  // bytes directamente, sin pasar por una cola del SO. Las líneas lógicas se unen
  // con '\n' (0x0A = avance de línea) para que el printer no las imprima pegadas.
  const config = impresora.tipoConexion === 'sistema'
    ? qz.configs.create(impresora.nombreCola as string)
    : qz.configs.create({ host: impresora.host as string, port: Number(impresora.puerto) })
  await qz.print(config, [lineas.join('\n') + '\n'])
}

export function useImpresoras() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const listar = (rol?: RolImpresora) =>
    useApiFetch<Impresora[]>(`${apiUrl}/impresoras${rol ? `?rol=${rol}` : ''}`)

  const crear = (body: ImpresoraFormBody) =>
    useApiFetch<Impresora>(`${apiUrl}/impresoras`, { method: 'POST', body })

  const actualizar = (id: string, body: Partial<ImpresoraFormBody>) =>
    useApiFetch<Impresora>(`${apiUrl}/impresoras/${id}`, { method: 'PATCH', body })

  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/impresoras/${id}`, { method: 'DELETE' })

  /**
   * Envía la comanda pendiente en dos fases: (1) consulta el diff sin mutar
   * (`GET .../comanda/pendiente`); (2) imprime un ticket por estación y, SOLO tras
   * imprimir OK, confirma esa estación (`POST .../comanda` marca cantidad_enviada).
   * Si QZ Tray falla, la estación no se confirma → queda pendiente y reintentable,
   * en vez de perderse (no hay reimpresión de comandas).
   */
  async function imprimirComanda(
    cuentaId: string,
    contexto: { mesaNombre: string, cuentaNumero: number, garzonNombre: string | null },
  ): Promise<ComandaEstacion[]> {
    const { estaciones } = await useApiFetch<ComandaPreviewResponse>(
      `${apiUrl}/cuentas/${cuentaId}/comanda/pendiente`,
    )
    if (estaciones.length === 0) return estaciones

    const impresoras = await listar('comanda')
    for (const estacion of estaciones) {
      const impresora = impresoras.find(i => i.id === estacion.impresoraId)
      if (!impresora) continue
      const lineas = buildComandaTicket({
        estacionNombre: estacion.nombre,
        mesaNombre: contexto.mesaNombre,
        cuentaNumero: contexto.cuentaNumero,
        garzonNombre: contexto.garzonNombre,
        items: estacion.items, // el builder usa {nombre, cantidad}; ignora los extras
        fecha: new Date(),
      })
      await imprimirEn(impresora, lineas) // si lanza, esta estación NO se confirma
      await useApiFetch(`${apiUrl}/cuentas/${cuentaId}/comanda`, {
        method: 'POST',
        body: {
          lineas: estacion.items.map(it => ({
            cuentaLineaId: it.cuentaLineaId,
            cantidadEnviada: it.cantidadEnviada,
          })),
        },
      })
    }
    return estaciones
  }

  async function obtenerImpresoraBoleta(): Promise<Impresora> {
    const impresoras = await listar('boleta')
    const impresora = impresoras[0]
    if (!impresora) {
      throw new Error('No hay una impresora de boletas configurada')
    }
    return impresora
  }

  async function imprimirPrecuenta(input: {
    tenantNombre: string
    mesaNombre: string
    cuentaNumero: number
    items: (TicketItem & { totalLinea: string })[]
    totales: TicketTotales
    formatMonto: (v: string) => string
  }): Promise<void> {
    const impresora = await obtenerImpresoraBoleta()
    const lineas = buildPrecuentaTicket({ ...input, fecha: new Date() })
    await imprimirEn(impresora, lineas)
  }

  async function imprimirBoleta(input: {
    tenantNombre: string
    items: (TicketItem & { totalLinea: string })[]
    totales: TicketTotales
    pagos: TicketPago[]
    formatMonto: (v: string) => string
  }): Promise<void> {
    const impresora = await obtenerImpresoraBoleta()
    const lineas = buildBoletaTicket({ ...input, fecha: new Date() })
    await imprimirEn(impresora, lineas)
  }

  return {
    listar,
    crear,
    actualizar,
    eliminar,
    imprimirComanda,
    imprimirPrecuenta,
    imprimirBoleta,
  }
}
```

- [x] **Step 3: Verificar que el frontend compila**

Run: `cd frontend && npx nuxi typecheck`
Expected: sin errores nuevos relacionados a `useImpresoras.ts` o `qz-tray`.

- [x] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/app/composables/useImpresoras.ts
git commit -m "$(cat <<'EOF'
feat(impresoras): agrega useImpresoras — CRUD + impresión vía QZ Tray

Conecta con la instancia local de QZ Tray, resuelve la config de red
(host:puerto raw) o de cola del sistema por impresora, y envía los
tickets armados por ticket-builder.ts.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Admin de impresoras — `pages/configuracion/impresoras.vue`

**Files:**
- Create: `frontend/app/pages/configuracion/impresoras.vue`
- Modify: `frontend/app/pages/configuracion.vue`

**Interfaces:**
- Consumes: `useImpresoras()` (Task 6): `listar/crear/actualizar/eliminar`; tipos `Impresora`, `RolImpresora`, `TipoConexionImpresora`.

- [x] **Step 1: Crear la página CRUD**

```vue
<!-- frontend/app/pages/configuracion/impresoras.vue -->
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Impresora, RolImpresora, TipoConexionImpresora } from '~/composables/useImpresoras'

const toast = useToast()
const impresorasApi = useImpresoras()

const impresoras = ref<Impresora[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)

const rolOptions: { label: string, value: RolImpresora }[] = [
  { label: 'Comanda (cocina/barra)', value: 'comanda' },
  { label: 'Boleta / precuenta', value: 'boleta' },
]
const tipoConexionOptions: { label: string, value: TipoConexionImpresora }[] = [
  { label: 'Red (host + puerto)', value: 'red' },
  { label: 'Sistema (cola instalada)', value: 'sistema' },
]

const emptyForm = () => ({
  nombre: '',
  rol: 'comanda' as RolImpresora,
  tipoConexion: 'red' as TipoConexionImpresora,
  host: '',
  puerto: '9100',
  nombreCola: '',
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() => editingId.value ? 'Editar impresora' : 'Nueva impresora')
const submitLabel = computed(() => editingId.value ? 'Guardar' : 'Crear')

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => { if (!open) resetDrawer() })

function rolLabel(rol: RolImpresora) {
  return rolOptions.find(o => o.value === rol)?.label ?? rol
}

async function cargar() {
  loading.value = true
  try {
    impresoras.value = await impresorasApi.listar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar impresoras'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(imp: Impresora) {
  resetDrawer()
  editingId.value = imp.id
  form.value = {
    nombre: imp.nombre,
    rol: imp.rol,
    tipoConexion: imp.tipoConexion,
    host: imp.host ?? '',
    puerto: imp.puerto ? String(imp.puerto) : '9100',
    nombreCola: imp.nombreCola ?? '',
    activo: imp.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      rol: form.value.rol,
      tipoConexion: form.value.tipoConexion,
      host: form.value.tipoConexion === 'red' ? form.value.host : undefined,
      puerto: form.value.tipoConexion === 'red' ? Number(form.value.puerto) : undefined,
      nombreCola: form.value.tipoConexion === 'sistema' ? form.value.nombreCola : undefined,
      activo: form.value.activo,
    }
    if (editingId.value) {
      await impresorasApi.actualizar(editingId.value, body)
      toast.add({ title: 'Impresora actualizada', color: 'success' })
    }
    else {
      await impresorasApi.crear(body)
      toast.add({ title: 'Impresora creada', color: 'success' })
    }
    drawerOpen.value = false
    await cargar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la impresora'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function eliminar(id: string) {
  try {
    await impresorasApi.eliminar(id)
    toast.add({ title: 'Impresora eliminada', color: 'success' })
    await cargar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

onMounted(cargar)

const columns: TableColumn<Impresora>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'conexion', header: 'Conexión' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Impresoras"
      description="Configura las impresoras térmicas para comandas de cocina/barra y para boletas/precuenta."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirCrear">
          Nueva impresora
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="impresoras" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <CrudListItem :title="row.original.nombre" :subtitle="rolLabel(row.original.rol)" />
      </template>

      <template #conexion-cell="{ row }">
        <span class="text-sm text-muted">
          <template v-if="row.original.tipoConexion === 'red'">
            {{ row.original.host }}:{{ row.original.puerto }}
          </template>
          <template v-else>
            Cola: {{ row.original.nombreCola }}
          </template>
        </span>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex justify-end gap-2">
          <UButton icon="i-lucide-square-pen" color="neutral" variant="ghost" @click="abrirEditar(row.original)" />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay impresoras configuradas.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="impresora-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Cocina" autofocus />
          </UFormField>
          <UFormField label="Rol">
            <USelectMenu v-model="form.rol" :items="rolOptions" value-key="value" />
          </UFormField>
          <UFormField label="Tipo de conexión">
            <USelectMenu v-model="form.tipoConexion" :items="tipoConexionOptions" value-key="value" />
          </UFormField>

          <template v-if="form.tipoConexion === 'red'">
            <UFormField label="Host / IP" required>
              <UInput v-model="form.host" placeholder="192.168.1.50" />
            </UFormField>
            <UFormField label="Puerto" required>
              <UInput v-model="form.puerto" inputmode="decimal" placeholder="9100" />
            </UFormField>
          </template>
          <template v-else>
            <UFormField label="Nombre de la cola" required>
              <UInput v-model="form.nombreCola" placeholder="EPSON_TM_T20" />
            </UFormField>
          </template>

          <UFormField label="Activa">
            <USwitch v-model="form.activo" />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="drawerOpen = false">
          Cancelar
        </UButton>
        <UButton type="submit" form="impresora-form" :loading="saving">
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar impresora"
      message="¿Estás seguro de que quieres eliminar esta impresora? Las categorías que la usan quedarán sin ruta de comanda."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
```

- [x] **Step 2: Agregar la entrada de navegación**

```typescript
// frontend/app/pages/configuracion.vue
// Después del bloque de Salones/Garzones (líneas 82-93):
  if (permissionsStore.esAdmin || permissionsStore.can('Impresoras', 'Crear')) {
    items.push({
      label: 'Impresoras',
      icon: 'i-lucide-printer',
      to: '/configuracion/impresoras',
    })
  }
```

- [x] **Step 3: Verificación manual**

Levantar `docker-compose up`, loguearse como admin de Paris, ir a Configuración → Impresoras: deben verse las 3 impresoras demo (Cocina, Barra, Caja). Crear una nueva, editarla, eliminarla.

- [x] **Step 4: Commit**

```bash
git add frontend/app/pages/configuracion/impresoras.vue frontend/app/pages/configuracion.vue
git commit -m "$(cat <<'EOF'
feat(impresoras): agrega admin CRUD de impresoras en Configuración

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Selector de impresora en el admin de categorías

**Files:**
- Modify: `frontend/app/pages/configuracion/categorias.vue`

**Interfaces:**
- Consumes: `useImpresoras().listar('comanda')` (Task 6).

- [x] **Step 1: Cargar las impresoras de comanda y extender el form**

```typescript
// frontend/app/pages/configuracion/categorias.vue
// Agregar el import y el tipo Categoria gana impresoraId:
import type { Impresora } from '~/composables/useImpresoras'

interface Categoria {
  id: string
  nombre: string
  aplicaA: string
  activo: boolean
  impresoraId: string | null
}

// Junto a `const categorias = ref<Categoria[]>([])`:
const impresorasComanda = ref<Impresora[]>([])
const impresorasApi = useImpresoras()

const impresoraOptions = computed(() => [
  { label: 'Sin ruta de comanda', value: null },
  ...impresorasComanda.value.map(i => ({ label: i.nombre, value: i.id })),
])

// Extender emptyForm:
const emptyForm = () => ({
  nombre: '',
  aplicaA: 'ambos',
  activo: true,
  impresoraId: null as string | null,
})

// Extender abrirEditar para copiar impresoraId:
function abrirEditar(cat: Categoria) {
  resetDrawer()
  editingId.value = cat.id
  form.value = {
    nombre: cat.nombre,
    aplicaA: cat.aplicaA,
    activo: cat.activo,
    impresoraId: cat.impresoraId,
  }
  drawerOpen.value = true
}

// Extender el body de guardar():
    const body = {
      nombre: form.value.nombre,
      aplicaA: form.value.aplicaA,
      activo: form.value.activo,
      // Enviar el valor crudo: `null` (opción "Sin ruta de comanda") desasigna la
      // impresora; un id la (re)asigna. No usar `?? undefined` — impediría limpiarla.
      impresoraId: form.value.impresoraId,
    }

// Cargar impresoras junto a categorías:
async function cargarImpresoras() {
  try {
    impresorasComanda.value = await impresorasApi.listar('comanda')
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar impresoras'), color: 'error' })
  }
}

onMounted(() => {
  cargar()
  cargarImpresoras()
})
```

Reemplazar el `onMounted(cargar)` existente por el bloque de arriba.

- [x] **Step 2: Agregar el campo al formulario y mostrarlo en la lista**

```vue
<!-- Dentro del <UForm>, después del campo "Activa": -->
          <UFormField label="Impresora de comanda" description="Rutea los ítems de esta categoría a una estación al enviar comanda.">
            <USelectMenu v-model="form.impresoraId" :items="impresoraOptions" value-key="value" />
          </UFormField>
```

```vue
<!-- En el slot #nombre-cell, agregar la impresora al subtítulo: -->
      <template #nombre-cell="{ row }">
        <CrudListItem
          :title="row.original.nombre"
          :subtitle="`Aplica a: ${aplicaALabel(row.original.aplicaA)}${row.original.impresoraId ? ' · ' + (impresorasComanda.find(i => i.id === row.original.impresoraId)?.nombre ?? '') : ''}`"
        />
      </template>
```

- [x] **Step 3: Verificación manual**

En Configuración → Categorías, editar "Ropa y accesorios" (Paris): debe mostrar "Cocina" preseleccionada (dato del seed). Crear una categoría nueva sin impresora y confirmar que queda "Sin ruta de comanda".

- [x] **Step 4: Commit**

```bash
git add frontend/app/pages/configuracion/categorias.vue
git commit -m "$(cat <<'EOF'
feat(categorias): agrega selector de impresora de comanda por categoría

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wiring en `pages/salones/index.vue` — comanda, precuenta, boleta

**Files:**
- Modify: `frontend/app/pages/salones/index.vue`

**Interfaces:**
- Consumes: `useImpresoras()` (Task 6), `useTenantStore()` (`~/stores/tenant`), `useFormatters().formatMonto`.

- [x] **Step 1: Agregar los imports y refs de estado**

```typescript
// frontend/app/pages/salones/index.vue
// Junto a los demás composables al inicio de <script setup>:
const impresorasApi = useImpresoras()
const tenantStore = useTenantStore()

const enviandoComanda = ref(false)
const imprimiendoPrecuenta = ref(false)
```

> `tenantStore.activeTenant` es un computed que depende de que `tenants` esté
> poblado (`fetchMyTenants()`). Si esta página puede montarse sin que el store se
> haya cargado, la boleta/precuenta imprimiría el nombre de tenant vacío. Verificar
> en el paso de verificación que `activeTenant?.nombre` no sale vacío; si sale,
> llamar `tenantStore.fetchMyTenants()` en `onMounted` (idem Task 10 para el POS).

- [x] **Step 2: Función `enviarComanda`**

Agregar después de `quitarLinea` (antes de la sección "Cancelar / cerrar cuenta"):

```typescript
// ── Comanda / precuenta ─────────────────────────────────────────────────────
async function enviarComanda() {
  if (!activeCuenta.value || !selectedMesa.value) return
  enviandoComanda.value = true
  try {
    const estaciones = await impresorasApi.imprimirComanda(activeCuenta.value.id, {
      mesaNombre: selectedMesa.value.nombre,
      cuentaNumero: activeCuenta.value.numero,
      garzonNombre: activeCuenta.value.garzonAperturaNombre,
    })
    toast.add({
      title: estaciones.length === 0
        ? 'No hay productos nuevos para enviar'
        : `Comanda enviada a ${estaciones.length} estación(es)`,
      color: estaciones.length === 0 ? 'neutral' : 'success',
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al enviar la comanda (¿QZ Tray está abierto?)'), color: 'error' })
  }
  finally {
    enviandoComanda.value = false
  }
}

// Recibe el resultado explícito (no lee `resultado.value` vivo): al cerrar la cuenta
// el ref puede recomputarse, así que el llamador pasa el snapshot que capturó.
function itemsParaTicket(cuenta: CuentaDetalle, res: ResultadoVenta) {
  return res.lineas.map(l => ({
    nombre: cuenta.lineas.find(cl => cl.itemId === l.itemId)?.nombre ?? '',
    cantidad: l.cantidad,
    totalLinea: l.totalLinea,
  }))
}

async function imprimirPrecuenta() {
  if (!activeCuenta.value || !selectedMesa.value || !resultado.value) return
  imprimiendoPrecuenta.value = true
  try {
    await impresorasApi.imprimirPrecuenta({
      tenantNombre: tenantStore.activeTenant?.nombre ?? '',
      mesaNombre: selectedMesa.value.nombre,
      cuentaNumero: activeCuenta.value.numero,
      items: itemsParaTicket(activeCuenta.value, resultado.value),
      totales: resultado.value.totales,
      formatMonto: (v: string) => formatMonto(v),
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al imprimir la precuenta (¿QZ Tray está abierto?)'), color: 'error' })
  }
  finally {
    imprimiendoPrecuenta.value = false
  }
}
```

- [x] **Step 3: Imprimir boleta al cerrar la cuenta**

Reemplazar `cerrarCuentaConPin` completo:

```typescript
async function cerrarCuentaConPin(pagos: PagoInput[], pin: string) {
  if (!activeCuenta.value) return
  submitting.value = true
  const cuentaCerrada = activeCuenta.value
  const resultadoCerrado = resultado.value
  try {
    await salonesApi.cerrarCuenta(cuentaCerrada.id, {
      pin,
      pagos,
      tipoDocumentoId: tiposDocumento.value[0]?.id,
    })
    toast.add({ title: 'Cuenta cerrada — venta generada', color: 'success' })

    if (resultadoCerrado) {
      try {
        await impresorasApi.imprimirBoleta({
          tenantNombre: tenantStore.activeTenant?.nombre ?? '',
          items: itemsParaTicket(cuentaCerrada, resultadoCerrado),
          totales: resultadoCerrado.totales,
          pagos: pagos.map(p => ({
            nombre: metodos.value.find(m => m.metodoPagoId === p.metodoPagoId)?.nombre ?? '',
            monto: p.monto,
          })),
          formatMonto: (v: string) => formatMonto(v),
        })
      }
      catch (e: unknown) {
        toast.add({ title: apiErrorMsg(e, 'Venta generada, pero falló la impresión de la boleta'), color: 'warning' })
      }
    }

    cuentas.value = cuentas.value.filter(c => c.id !== activeCuenta.value?.id)
    volverACuentas()
    await Promise.all([cargarSalones(), cajaStore.cargarActiva()])
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cerrar la cuenta'), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
```

- [x] **Step 4: Agregar los botones en el template**

En el `<template #body>` del detalle de cuenta, justo antes del `<div class="flex gap-2">` que contiene "Cancelar cuenta" / "Cerrar y cobrar" (línea ~547), agregar una fila nueva:

```vue
                <div class="mb-2 flex gap-2">
                  <UButton
                    color="neutral"
                    variant="soft"
                    class="flex-1 justify-center"
                    icon="i-lucide-chef-hat"
                    :loading="enviandoComanda"
                    :disabled="activeCuenta.lineas.length === 0"
                    @click="enviarComanda"
                  >
                    Enviar a cocina
                  </UButton>
                  <UButton
                    color="neutral"
                    variant="soft"
                    class="flex-1 justify-center"
                    icon="i-lucide-receipt"
                    :loading="imprimiendoPrecuenta"
                    :disabled="activeCuenta.lineas.length === 0"
                    @click="imprimirPrecuenta"
                  >
                    Imprimir precuenta
                  </UButton>
                </div>
```

- [x] **Step 5: Verificación manual**

Con QZ Tray instalado y corriendo, y una impresora real o virtual configurada: en `/salones`, abrir una cuenta, agregar un producto de la categoría "Ropa y accesorios" (rutea a "Cocina" por el seed), click "Enviar a cocina" → debe imprimir. Click de nuevo sin agregar nada nuevo → toast "No hay productos nuevos para enviar". "Imprimir precuenta" → imprime el resumen. Cerrar y cobrar → imprime la boleta tras el toast de éxito.

- [x] **Step 6: Commit**

```bash
git add frontend/app/pages/salones/index.vue
git commit -m "$(cat <<'EOF'
feat(salones): agrega botones Enviar a cocina, Imprimir precuenta y boleta al cerrar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Wiring en `pages/ventas/pos.vue` — boleta del POS de mostrador

**Files:**
- Modify: `frontend/app/pages/ventas/pos.vue`

**Interfaces:**
- Consumes: `useImpresoras()` (Task 6), `useTenantStore()`, `useFormatters().formatMonto`.

- [x] **Step 1: Agregar los imports y composables**

```typescript
// frontend/app/pages/ventas/pos.vue
// Junto a los demás composables al inicio de <script setup>:
const impresorasApi = useImpresoras()
const tenantStore = useTenantStore()
const { formatMonto } = useFormatters()
```

- [x] **Step 2: Imprimir boleta tras confirmar el cobro**

Reemplazar el cuerpo de `confirmarCobro` (desde `const venta = await useApiFetch...` hasta el `finally`):

```typescript
    const resultadoVenta = resultado.value
    const lineasVenta = [...lineas.value]

    const venta = await useApiFetch<{ estado: string }>(`${apiUrl}/ventas`, {
      method: 'POST',
      body,
    })
    toast.add({ title: estadoToastTitle[venta.estado] ?? 'Venta registrada', color: 'success' })
    cobroOpen.value = false

    if (resultadoVenta) {
      try {
        await impresorasApi.imprimirBoleta({
          tenantNombre: tenantStore.activeTenant?.nombre ?? '',
          items: resultadoVenta.lineas.map((l) => ({
            nombre: lineasVenta.find((ln) => ln.item.id === l.itemId)?.item.nombre ?? '',
            cantidad: l.cantidad,
            totalLinea: l.totalLinea,
          })),
          totales: resultadoVenta.totales,
          pagos: pagos.map((p) => ({
            nombre: metodos.value.find((m) => m.metodoPagoId === p.metodoPagoId)?.nombre ?? '',
            monto: p.monto,
          })),
          formatMonto: (v: string) => formatMonto(v),
        })
      } catch (e: unknown) {
        toast.add({ title: apiErrorMsg(e, 'Venta registrada, pero falló la impresión de la boleta'), color: 'warning' })
      }
    }

    items.value = descontarStockCatalogo(items.value, lineas.value)
    limpiar()
    customerExpandido.value = false
    customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }
    await cajaStore.cargarActiva()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al registrar la venta', color: 'error' })
  } finally {
    submitting.value = false
  }
}
```

- [x] **Step 3: Verificación manual**

Con QZ Tray corriendo y caja abierta: en `/ventas/pos`, agregar un producto de la categoría con impresora asignada al carrito, cobrar → debe imprimir la boleta tras el toast "Venta pagada". Sin impresora `rol='boleta'` configurada, debe mostrar el toast de advertencia sin bloquear la venta ya registrada.

- [x] **Step 4: Commit**

```bash
git add frontend/app/pages/ventas/pos.vue
git commit -m "$(cat <<'EOF'
feat(ventas): imprime boleta térmica tras confirmar el cobro en el POS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Documentación viva

**Files:**
- Modify: `startup-pos.sql`
- Create: `docs/features/impresion-termica.md`
- Modify: `docs/README.md`
- Modify: `docs/ESTADO.md`

**Interfaces:** ninguna — solo documentación.

- [x] **Step 1: Agregar las tablas a `startup-pos.sql`**

Agregar al final del archivo (o en la sección de restaurante, junto a `cuentas`/`cuenta_lineas` si existe esa sección):

```sql
-- =============================================================
-- IMPRESORAS TÉRMICAS (comandas, precuenta, boleta)
-- =============================================================

CREATE TABLE "impresoras" (
  "impresora_id"   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID    NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"         TEXT    NOT NULL,
  "rol"            TEXT    NOT NULL,   -- 'comanda' | 'boleta'
  "tipo_conexion"  TEXT    NOT NULL,   -- 'red' | 'sistema'
  "host"           TEXT,
  "puerto"         INTEGER,
  "nombre_cola"    TEXT,
  "activo"         BOOLEAN NOT NULL DEFAULT true,
  "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ
);

-- categorias gana impresora_id (ruteo de comanda por categoría del ítem)
ALTER TABLE "categorias" ADD COLUMN "impresora_id" UUID
  REFERENCES "impresoras" ("impresora_id");

-- cuenta_lineas gana cantidad_enviada (diff de lo ya impreso en comanda)
ALTER TABLE "cuenta_lineas" ADD COLUMN "cantidad_enviada" NUMERIC(18,4)
  NOT NULL DEFAULT 0;
```

- [x] **Step 2: Crear `docs/features/impresion-termica.md`**

```markdown
# Feature: Impresión Térmica (Comandas, Precuenta, Boleta)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-13

---

## Overview

### ¿Qué es?

Impresión de tickets térmicos desde el navegador, vía **QZ Tray** (app local que
hace de puente entre el navegador y las impresoras físicas de la red o USB del
dispositivo). Tres documentos: **comanda** (cocina/barra, ruteada por categoría del
ítem), **precuenta** (resumen no fiscal antes de cobrar) y **boleta** (al cerrar una
cuenta de mesa o en el POS de mostrador).

### ¿Por qué existe?

El backend corre en la nube (Railway); las impresoras térmicas del restaurante viven
en la red local y no son alcanzables desde internet. QZ Tray resuelve esto
imprimiendo directo desde el dispositivo del garzón/cajero, que sí está en esa red.

### Scope

- Incluido: CRUD de impresoras (rol `comanda`/`boleta`, conexión de red o cola del
  sistema), ruteo de comanda por `categorias.impresora_id`, envío manual de comanda
  con diff (`cuenta_lineas.cantidad_enviada`), precuenta y boleta desde Salones y
  desde el POS de mostrador.
- NO incluido (futuro): notas por ítem, reimpresión de comandas, impresoras de rol
  dual, certificado firmado de QZ Tray (evita el diálogo de confianza).

---

## API Endpoints

Todos bajo `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`. Módulo RBAC
**`Impresoras`** (`Leer/Crear/Actualizar/Eliminar`).

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/impresoras` | Leer | Lista impresoras del tenant (`?rol=comanda\|boleta`) |
| POST | `/impresoras` | Crear | Crea impresora |
| PATCH | `/impresoras/:id` | Actualizar | Edita datos/activo |
| DELETE | `/impresoras/:id` | Eliminar | Soft delete |

`PATCH /categorias/:id` (endpoint existente) acepta `impresoraId` opcional —
valida que exista, sea del tenant, esté activa y tenga `rol='comanda'`.

La comanda usa **dos fases** (permiso `Salones:Operar`, ver
[salones-mesas.md](./salones-mesas.md)) para no perder pedidos si la impresión del
navegador falla:

- `GET /cuentas/:id/comanda/pendiente` calcula el diff pendiente por línea agrupado
  por impresora y devuelve `{ estaciones: [{ impresoraId, nombre, items: [{ cuentaLineaId, nombre, cantidad, cantidadEnviada }] }] }` **sin persistir nada**.
- `POST /cuentas/:id/comanda` recibe `{ lineas: [{ cuentaLineaId, cantidadEnviada }] }`
  y marca `cantidad_enviada` — lo llama el frontend **por estación, solo tras** imprimir
  OK. Un fallo de QZ Tray deja las estaciones no confirmadas pendientes y reintentables.

Precuenta y boleta no tienen endpoint propio: el frontend arma el ticket con los
datos que ya tiene (resultado del motor de precios + pagos) y lo imprime en la
impresora `rol='boleta'` del tenant.

---

## Backend

- **Módulo**: `src/modules/impresoras/impresoras.module.ts`.
- **Entity**: `Impresora` → tabla `impresoras` (`rol`, `tipoConexion`, `host`/`puerto`
  o `nombreCola` según conexión).
- **`categorias.impresora_id`**: FK nullable a `impresoras` con `rol='comanda'`,
  validada en `CategoriasService`.
- **`cuenta_lineas.cantidad_enviada`**: columna materializada. `SalonesService.
  previewComanda` calcula `diff = cantidad - cantidad_enviada` por línea **sin
  persistir**; `confirmarComanda` marca `cantidad_enviada` (seteando el total
  absoluto, idempotente) dentro de una transacción, recién cuando el navegador
  confirma que imprimió. `fusionarCuentas` suma también `cantidadEnviada` al mergear
  líneas del mismo ítem, para no reenviar lo ya impreso.

---

## Frontend

- **Composable**: `app/composables/useImpresoras.ts` — CRUD + `imprimirComanda`,
  `imprimirPrecuenta`, `imprimirBoleta` (envuelven `qz-tray`).
- **Formateo puro**: `app/utils/ticket-builder.ts` — `buildComandaTicket`,
  `buildPrecuentaTicket`, `buildBoletaTicket` (sin Nuxt/Vue, 100% Vitest).
- **Admin**: `pages/configuracion/impresoras.vue` (CRUD) + selector "Impresora de
  comanda" en `pages/configuracion/categorias.vue`.
- **Operación**: botones "Enviar a cocina" / "Imprimir precuenta" en el drawer de
  cuenta de `pages/salones/index.vue`, boleta automática tras cerrar cuenta o tras
  cobrar en `pages/ventas/pos.vue`.

### QZ Tray

Requiere instalar QZ Tray una vez por dispositivo (tablet/PC del garzón o caja). En
v1 usa el modo **no firmado**: QZ Tray muestra un diálogo "¿Confía en este sitio?" en
cada impresión hasta que el usuario marca "recordar". Firmar la app con certificado
pagado (evita el diálogo) queda como mejora futura opcional.

La conexión "de red" (`tipoConexion='red'`) abre un socket raw a `host:puerto`
(típico ESC/POS TCP 9100), sin necesidad de instalar la impresora como cola del
sistema operativo.

---

## Testing

### Unit (backend)

```bash
cd backend && npx jest impresoras categorias salones
```

### Unit (frontend)

```bash
cd frontend && npm test -- --run app/utils/ticket-builder.spec.ts
```

### Manual

1. `docker-compose down -v && docker-compose up --build` (BD fresca — el seeder es
   idempotente, ver Task 4). El seeder crea el módulo Impresoras y 3 impresoras demo
   en Paris (Cocina, Barra — comanda; Caja — boleta) y rutea "Ropa y accesorios" a
   Cocina.
2. Instalar y abrir QZ Tray en el dispositivo de prueba.
3. En `/salones`, abrir una cuenta, agregar un producto de esa categoría, "Enviar a
   cocina" → imprime; repetir sin cambios → "No hay productos nuevos para enviar".
4. "Imprimir precuenta" → imprime el resumen. Cerrar y cobrar → imprime la boleta.
5. En `/ventas/pos`, cobrar una venta → imprime la boleta.

---

## Decisiones

Ver `docs/superpowers/specs/2026-07-13-impresion-termica-design.md` para el detalle
completo de decisiones (QZ Tray vs. alternativas, ruteo por categoría, `cantidad_
enviada` vs. tabla de historial, envío de comanda manual).

## Related Features

- [salones-mesas.md](./salones-mesas.md)
- [garzones.md](./garzones.md)
- [ventas.md](./ventas.md)
```

- [x] **Step 3: Enlazar en `docs/README.md`**

Agregar una línea en la tabla/lista de features (junto a las entradas de Salones/Garzones), apuntando a `features/impresion-termica.md`.

- [x] **Step 4: Agregar la fila en `docs/ESTADO.md`**

```markdown
| Impresión Térmica (comandas cocina/barra por categoría, precuenta, boleta vía QZ Tray) | ✅ Implementado (2026-07-13) |
```

- [x] **Step 5: Commit**

```bash
git add startup-pos.sql docs/features/impresion-termica.md docs/README.md docs/ESTADO.md
git commit -m "$(cat <<'EOF'
docs(impresion-termica): documenta el módulo — schema, API, frontend y testing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```
