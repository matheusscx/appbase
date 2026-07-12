# Inscripción Oneclick en "Mis medios de pago" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status**: Done
**Date**: 2026-07-11
**Owner**: Cesar Matheus
**Spec**: `docs/superpowers/specs/2026-07-11-medios-pago-oneclick-design.md`

**Goal:** Reemplazar el mock localStorage de `/tienda/medios-pago` por la inscripción Oneclick real (tarjetas tokenizadas en Transbank por usuario), con preferida persistida en BD.

**Architecture:** Fachada en el módulo `online` (`/online/medios-pago/*`, JWT + permisos `Tienda Online`) que delega en `InscripcionesService` del módulo `pasarela` con `pagadorRef = usuarioId` del token. El módulo pasarela gana la columna `preferida` y ownership opcional por pagador; su API m2m existente no cambia de comportamiento.

**Tech Stack:** NestJS 11 + TypeORM (backend), Nuxt 4 + @nuxt/ui v4 (frontend), Jest.

## Global Constraints

- Trabajar directo sobre `main`, sin ramas ni PRs (etapa de desarrollo).
- Soft delete en todo; toda lectura filtra `eliminado_el IS NULL`.
- Columnas UUID con `type: 'uuid'` explícito (ADR-004).
- `tenant_id` y `usuario_id` siempre del token, nunca del body.
- Mensajes de error de negocio en español (el frontend los muestra tal cual desde `e.data.message`).
- **Nunca un número de tarjeta (PAN) ni CVV en nuestra app** — solo marca + últimos 4 que devuelve Transbank.
- Frontend: `useApiFetch` (no `$fetch` directo), tokens semánticos del design system (nada de `text-gray-500`), iconos `i-lucide-*`.
- La API m2m (`/pasarela/api/inscripciones`) mantiene su comportamiento actual: los parámetros nuevos de `InscripcionesService` son opcionales.
- Commits en español estilo convencional, terminando con:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- En dev el esquema lo sincroniza TypeORM (`synchronize`) — no hay migraciones; `startup-pos.sql` es el DDL de referencia y se actualiza en el mismo commit.

---

### Task 1: Pasarela — columna `preferida`, ownership por pagador y prioridad de cobro

**Files:**
- Modify: `backend/src/modules/pasarela/entities/pasarela-inscripcion.entity.ts`
- Modify: `backend/src/modules/pasarela/services/inscripciones.service.ts`
- Modify: `backend/src/modules/pasarela/services/inscripciones.service.spec.ts`
- Modify: `startup-pos.sql` (DDL de `pasarela_inscripciones`, ~línea 847)

**Interfaces:**
- Consumes: entidad `PasarelaInscripcion`, `InscripcionesService` existentes.
- Produces (Task 2 depende de esto):
  - `InscripcionesService.eliminar(tenantId: string, inscripcionId: string, pagadorRef?: string): Promise<{ inscripcionId: string }>`
  - `InscripcionesService.marcarPreferida(tenantId: string, inscripcionId: string, pagadorRef?: string): Promise<objeto público de inscripción>`
  - `toPublico` (y por lo tanto `listarPorPagador`/`obtener`) incluye `preferida: boolean`.

- [x] **Step 1: Escribir los tests que fallan**

En `backend/src/modules/pasarela/services/inscripciones.service.spec.ts`:

1. Agregar `find` al mock `medioRepo` (lo usa el `toPublico` de `marcarPreferida`):

```typescript
  const medioRepo = {
    create: jest.fn((x: Partial<PasarelaMedioPago>) => x),
    save: jest.fn((x: Partial<PasarelaMedioPago>) => Promise.resolve(x)),
    update: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };
```

2. Agregar el mock de `DataSource` (debajo del mock `credenciales`) y su provider.
   Import nuevo en la cabecera: cambiar la línea
   `import { getRepositoryToken } from '@nestjs/typeorm';` por
   `import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';`

```typescript
  const managerMock = { update: jest.fn() };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof managerMock) => Promise<unknown>) =>
      cb(managerMock),
    ),
  };
```

En el array `providers` del `Test.createTestingModule`, agregar:

```typescript
        { provide: getDataSourceToken(), useValue: dataSource },
```

3. Tests nuevos al final del `describe` (antes del cierre):

```typescript
  it('marcarPreferida: desmarca las demás del pagador y marca la pedida', async () => {
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-uuid-1',
      tenantId: 't-1',
      pagadorRef: 'user-1',
      estado: 'activa',
      preferida: false,
    });
    const res = await service.marcarPreferida('t-1', 'insc-uuid-1', 'user-1');
    expect(managerMock.update).toHaveBeenNthCalledWith(
      1,
      PasarelaInscripcion,
      { tenantId: 't-1', pagadorRef: 'user-1', preferida: true },
      { preferida: false },
    );
    expect(managerMock.update).toHaveBeenNthCalledWith(
      2,
      PasarelaInscripcion,
      { inscripcionId: 'insc-uuid-1' },
      { preferida: true },
    );
    expect(res.preferida).toBe(true);
  });

  it('marcarPreferida: exige activa y ownership del pagador cuando viene', async () => {
    inscripcionRepo.findOne.mockResolvedValue(null);
    await expect(
      service.marcarPreferida('t-1', 'insc-uuid-1', 'user-ajeno'),
    ).rejects.toThrow('Inscripción activa no encontrada');
    expect(inscripcionRepo.findOne).toHaveBeenCalledWith({
      where: {
        inscripcionId: 'insc-uuid-1',
        tenantId: 't-1',
        estado: 'activa',
        pagadorRef: 'user-ajeno',
      },
    });
    expect(managerMock.update).not.toHaveBeenCalled();
  });

  it('eliminar: con pagadorRef ajeno no encuentra y NO llama al proveedor', async () => {
    inscripcionRepo.findOne.mockResolvedValue(null);
    await expect(
      service.eliminar('t-1', 'insc-uuid-1', 'user-ajeno'),
    ).rejects.toThrow('Inscripción activa no encontrada');
    expect(inscripcionRepo.findOne).toHaveBeenCalledWith({
      where: {
        inscripcionId: 'insc-uuid-1',
        tenantId: 't-1',
        estado: 'activa',
        pagadorRef: 'user-ajeno',
      },
    });
    expect(provider.eliminarInscripcion).not.toHaveBeenCalled();
  });

  it('resolverParaCobro sin id: prioriza la preferida sobre la más reciente', async () => {
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-pref',
      estado: 'activa',
    });
    await service.resolverParaCobro('t-1', undefined, 'user-1');
    expect(inscripcionRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 't-1', pagadorRef: 'user-1', estado: 'activa' },
      order: { preferida: 'DESC', creadoEl: 'DESC' },
    });
  });
```

- [x] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && npm test -- inscripciones.service.spec`
Expected: FAIL — `service.marcarPreferida is not a function`, y los asserts de `where`/`order` de eliminar/resolverParaCobro sin los campos nuevos.

- [x] **Step 3: Implementar**

1. `backend/src/modules/pasarela/entities/pasarela-inscripcion.entity.ts` — agregar debajo de la columna `estado`:

```typescript
  // Preferida del pagador para cobros sin inscripción explícita (solo una por tenant+pagador)
  @Column({ default: false })
  preferida: boolean;
```

2. `backend/src/modules/pasarela/services/inscripciones.service.ts`:

Cambiar los imports de TypeORM (líneas 8-9):

```typescript
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
```

Agregar al final del constructor (después de `private readonly config: ConfigService,`):

```typescript
    @InjectDataSource() private readonly dataSource: DataSource,
```

En `toPublico`, agregar `preferida` (después de `estado: i.estado,`):

```typescript
      preferida: i.preferida,
```

Reemplazar la firma y el `findOne` de `eliminar`:

```typescript
  async eliminar(tenantId: string, inscripcionId: string, pagadorRef?: string) {
    const inscripcion = await this.inscripcionRepo.findOne({
      where: {
        inscripcionId,
        tenantId,
        estado: 'activa',
        ...(pagadorRef ? { pagadorRef } : {}),
      },
    });
```

(el resto del método no cambia).

Agregar el método nuevo `marcarPreferida` inmediatamente después de `eliminar`:

```typescript
  /** Marca la inscripción como preferida del pagador (desmarca las demás). */
  async marcarPreferida(
    tenantId: string,
    inscripcionId: string,
    pagadorRef?: string,
  ) {
    const inscripcion = await this.inscripcionRepo.findOne({
      where: {
        inscripcionId,
        tenantId,
        estado: 'activa',
        ...(pagadorRef ? { pagadorRef } : {}),
      },
    });
    if (!inscripcion)
      throw new NotFoundException('Inscripción activa no encontrada');

    // Regla "solo una": limpiar el flag del pagador y marcar la nueva, atómico.
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        PasarelaInscripcion,
        { tenantId, pagadorRef: inscripcion.pagadorRef, preferida: true },
        { preferida: false },
      );
      await manager.update(
        PasarelaInscripcion,
        { inscripcionId: inscripcion.inscripcionId },
        { preferida: true },
      );
    });

    inscripcion.preferida = true;
    const medios = await this.medioRepo.find({
      where: { inscripcionId: inscripcion.inscripcionId },
    });
    return this.toPublico(inscripcion, medios);
  }
```

En `resolverParaCobro`, cambiar el `order`:

```typescript
      order: { preferida: 'DESC', creadoEl: 'DESC' },
```

3. `startup-pos.sql` — en `CREATE TABLE pasarela_inscripciones` (~línea 847), agregar después de la línea de `estado`:

```sql
    preferida BOOLEAN NOT NULL DEFAULT false, -- solo una por tenant+pagador
```

- [x] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && npm test -- inscripciones.service.spec`
Expected: PASS (los 8 previos + 4 nuevos). Luego suite completa + lint:

Run: `cd backend && npm test && npm run lint`
Expected: todo verde, lint sin errores nuevos.

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/pasarela/entities/pasarela-inscripcion.entity.ts \
        backend/src/modules/pasarela/services/inscripciones.service.ts \
        backend/src/modules/pasarela/services/inscripciones.service.spec.ts \
        startup-pos.sql
git commit -m "feat(pasarela): inscripción preferida por pagador y ownership opcional en eliminar/marcarPreferida

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Online — fachada `/online/medios-pago` (JWT, pagador = usuario)

**Files:**
- Create: `backend/src/modules/online/medios-pago-online.service.ts`
- Create: `backend/src/modules/online/medios-pago-online.service.spec.ts`
- Create: `backend/src/modules/online/medios-pago-online.controller.ts`
- Modify: `backend/src/modules/online/online.module.ts`

**Interfaces:**
- Consumes (de Task 1): `InscripcionesService.listarPorPagador(tenantId, pagadorRef)` (objetos públicos con `estado`, `preferida`, `mediosPago[]`), `iniciar(tenantId, { pagadorRef, email, urlRetorno })` → `{ inscripcionId, urlWebpay, token }`, `eliminar(tenantId, inscripcionId, pagadorRef?)`, `marcarPreferida(tenantId, inscripcionId, pagadorRef?)`. También `TenantPasarelaService.resolverConfiguracionActiva(tenantId, 'oneclick')` (lanza si no hay config activa).
- Produces (Task 3 consume estas rutas):
  - `GET /online/medios-pago` → `{ oneclickDisponible: boolean, medios: [{ inscripcionId, pagadorRef, estado, preferida, creadoEl, mediosPago: [{ medioPagoId, tipo, marca, ultimos4, estado }] }] }` (solo inscripciones `activa`)
  - `POST /online/medios-pago` (sin body) → `{ inscripcionId, urlWebpay }` (con `?TBK_TOKEN=` embebido)
  - `DELETE /online/medios-pago/:id` → `{ inscripcionId }`
  - `PATCH /online/medios-pago/:id/preferida` → objeto público de la inscripción

- [x] **Step 1: Escribir el spec que falla**

Create `backend/src/modules/online/medios-pago-online.service.spec.ts`:

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MediosPagoOnlineService } from './medios-pago-online.service';
import { InscripcionesService } from '../pasarela/services/inscripciones.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const USUARIO_ID = '550e8400-e29b-41d4-a716-446655440001';

describe('MediosPagoOnlineService', () => {
  let service: MediosPagoOnlineService;
  const inscripciones = {
    listarPorPagador: jest.fn(),
    iniciar: jest.fn(),
    eliminar: jest.fn(),
    marcarPreferida: jest.fn(),
  };
  const tenantPasarela = { resolverConfiguracionActiva: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('http://localhost:5173') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediosPagoOnlineService,
        { provide: InscripcionesService, useValue: inscripciones },
        { provide: TenantPasarelaService, useValue: tenantPasarela },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(MediosPagoOnlineService);
  });

  it('listar: filtra solo inscripciones activas y reporta disponibilidad', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    inscripciones.listarPorPagador.mockResolvedValue([
      { inscripcionId: 'i-1', estado: 'activa', preferida: false, mediosPago: [] },
      { inscripcionId: 'i-2', estado: 'pendiente', preferida: false, mediosPago: [] },
      { inscripcionId: 'i-3', estado: 'fallida', preferida: false, mediosPago: [] },
    ]);
    const res = await service.listar(TENANT_ID, USUARIO_ID);
    expect(inscripciones.listarPorPagador).toHaveBeenCalledWith(
      TENANT_ID,
      USUARIO_ID,
    );
    expect(tenantPasarela.resolverConfiguracionActiva).toHaveBeenCalledWith(
      TENANT_ID,
      'oneclick',
    );
    expect(res.oneclickDisponible).toBe(true);
    expect(res.medios.map((m) => m.inscripcionId)).toEqual(['i-1']);
  });

  it('listar: oneclickDisponible=false cuando el tenant no tiene la pasarela', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockRejectedValue(
      new Error('sin config'),
    );
    inscripciones.listarPorPagador.mockResolvedValue([]);
    const res = await service.listar(TENANT_ID, USUARIO_ID);
    expect(res.oneclickDisponible).toBe(false);
    expect(res.medios).toEqual([]);
  });

  it('iniciar: pagadorRef=usuarioId, urlRetorno del FRONTEND_URL y TBK_TOKEN embebido', async () => {
    inscripciones.iniciar.mockResolvedValue({
      inscripcionId: 'i-1',
      urlWebpay: 'https://webpay/init',
      token: 'tok-99',
    });
    const res = await service.iniciar(TENANT_ID, USUARIO_ID, 'user@x.cl');
    expect(inscripciones.iniciar).toHaveBeenCalledWith(TENANT_ID, {
      pagadorRef: USUARIO_ID,
      email: 'user@x.cl',
      urlRetorno: 'http://localhost:5173/tienda/medios-pago',
    });
    expect(res).toEqual({
      inscripcionId: 'i-1',
      urlWebpay: 'https://webpay/init?TBK_TOKEN=tok-99',
    });
  });

  it('eliminar y marcarPreferida delegan con ownership del usuario', async () => {
    inscripciones.eliminar.mockResolvedValue({ inscripcionId: 'i-1' });
    inscripciones.marcarPreferida.mockResolvedValue({
      inscripcionId: 'i-1',
      preferida: true,
    });
    await service.eliminar(TENANT_ID, USUARIO_ID, 'i-1');
    await service.marcarPreferida(TENANT_ID, USUARIO_ID, 'i-1');
    expect(inscripciones.eliminar).toHaveBeenCalledWith(
      TENANT_ID,
      'i-1',
      USUARIO_ID,
    );
    expect(inscripciones.marcarPreferida).toHaveBeenCalledWith(
      TENANT_ID,
      'i-1',
      USUARIO_ID,
    );
  });
});
```

- [x] **Step 2: Correr el spec y verificar que falla**

Run: `cd backend && npm test -- medios-pago-online.service.spec`
Expected: FAIL — `Cannot find module './medios-pago-online.service'`.

- [x] **Step 3: Implementar service, controller y registro en el módulo**

Create `backend/src/modules/online/medios-pago-online.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InscripcionesService } from '../pasarela/services/inscripciones.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';

const PASARELA_TOKENIZADA = 'oneclick';

/**
 * Fachada de "mis medios de pago" de la tienda: expone la inscripción Oneclick
 * al usuario logueado con pagadorRef = usuarioId. El mapeo pagador ↔ usuario es
 * una regla de la tienda — la pasarela solo conoce pagadorRef opaco.
 */
@Injectable()
export class MediosPagoOnlineService {
  constructor(
    private readonly inscripciones: InscripcionesService,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly config: ConfigService,
  ) {}

  async listar(tenantId: string, usuarioId: string) {
    const [oneclickDisponible, lista] = await Promise.all([
      this.oneclickActivo(tenantId),
      this.inscripciones.listarPorPagador(tenantId, usuarioId),
    ]);
    return {
      oneclickDisponible,
      medios: lista.filter((i) => i.estado === 'activa'),
    };
  }

  async iniciar(tenantId: string, usuarioId: string, email: string) {
    const urlRetorno = `${this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'}/tienda/medios-pago`;
    const res = await this.inscripciones.iniciar(tenantId, {
      pagadorRef: usuarioId,
      email,
      urlRetorno,
    });
    // El navegador debe llegar a Webpay con el token: mismo patrón GET que
    // Webpay Plus usa con token_ws (ver webpay-plus.provider.ts).
    const sep = res.urlWebpay.includes('?') ? '&' : '?';
    return {
      inscripcionId: res.inscripcionId,
      urlWebpay: `${res.urlWebpay}${sep}TBK_TOKEN=${res.token}`,
    };
  }

  eliminar(tenantId: string, usuarioId: string, inscripcionId: string) {
    return this.inscripciones.eliminar(tenantId, inscripcionId, usuarioId);
  }

  marcarPreferida(tenantId: string, usuarioId: string, inscripcionId: string) {
    return this.inscripciones.marcarPreferida(
      tenantId,
      inscripcionId,
      usuarioId,
    );
  }

  private async oneclickActivo(tenantId: string): Promise<boolean> {
    try {
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_TOKENIZADA,
      );
      return true;
    } catch {
      return false;
    }
  }
}
```

Create `backend/src/modules/online/medios-pago-online.controller.ts`:

```typescript
import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { MediosPagoOnlineService } from './medios-pago-online.service';

@ApiTags('online')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('online/medios-pago')
export class MediosPagoOnlineController {
  constructor(private readonly mediosPago: MediosPagoOnlineService) {}

  @Get()
  @RequiresPermiso('Tienda Online', 'Leer')
  listar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.mediosPago.listar(u.tenantId ?? '', u.id);
  }

  @Post()
  @RequiresPermiso('Tienda Online', 'Crear')
  iniciar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.mediosPago.iniciar(u.tenantId ?? '', u.id, u.email);
  }

  @Delete(':id')
  @RequiresPermiso('Tienda Online', 'Crear')
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.mediosPago.eliminar(u.tenantId ?? '', u.id, id);
  }

  @Patch(':id/preferida')
  @RequiresPermiso('Tienda Online', 'Crear')
  marcarPreferida(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.mediosPago.marcarPreferida(u.tenantId ?? '', u.id, id);
  }
}
```

Modify `backend/src/modules/online/online.module.ts` — quedar así:

```typescript
import { Module } from '@nestjs/common';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { MetodosPagoModule } from '../metodos-pago/metodos-pago.module';
import { PasarelaModule } from '../pasarela/pasarela.module';
import { VentasModule } from '../ventas/ventas.module';
import { OnlineController } from './online.controller';
import { OnlineService } from './online.service';
import { OnlineCallbackHandler } from './online-callback.handler';
import { MediosPagoOnlineController } from './medios-pago-online.controller';
import { MediosPagoOnlineService } from './medios-pago-online.service';

@Module({
  imports: [
    CalculoPreciosModule,
    MetodosPagoModule,
    PasarelaModule,
    VentasModule,
  ],
  controllers: [OnlineController, MediosPagoOnlineController],
  providers: [OnlineService, OnlineCallbackHandler, MediosPagoOnlineService],
})
export class OnlineModule {}
```

- [x] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && npm test -- medios-pago-online.service.spec`
Expected: PASS (4 tests). Luego suite completa + lint:

Run: `cd backend && npm test && npm run lint`
Expected: todo verde.

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/online/medios-pago-online.service.ts \
        backend/src/modules/online/medios-pago-online.service.spec.ts \
        backend/src/modules/online/medios-pago-online.controller.ts \
        backend/src/modules/online/online.module.ts
git commit -m "feat(online): fachada /online/medios-pago para inscripción Oneclick del usuario

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — `useTarjetas` real + página `/tienda/medios-pago`

**Files:**
- Rewrite: `frontend/app/composables/useTarjetas.ts`
- Rewrite: `frontend/app/pages/tienda/medios-pago.vue`

**Interfaces:**
- Consumes (de Task 2): las 4 rutas `/online/medios-pago` descritas en Task 2.
- Produces: `useTarjetas()` devuelve `{ tarjetas, preferida, oneclickDisponible, loading, cargar, agregar, eliminar, marcarPreferida }`.
  **Compatibilidad crítica:** `tienda/pasarela.vue:22` y `tienda/suscripciones.vue:80` ya consumen `useTarjetas().preferida` y leen `preferida.marca` y `preferida.last4` — la interfaz `Tarjeta` nueva DEBE conservar los campos `marca` y `last4` con esos nombres. No tocar esas dos páginas.

- [x] **Step 1: Reescribir el composable**

Reemplazar el contenido completo de `frontend/app/composables/useTarjetas.ts`:

```typescript
import { useApiFetch } from './useApiFetch'

export interface Tarjeta {
  inscripcionId: string
  marca: string | null
  last4: string | null
  tipo: string | null
  preferida: boolean
  creadoEl: string
}

interface MedioApi {
  inscripcionId: string
  estado: string
  preferida: boolean
  creadoEl: string
  mediosPago: { tipo: string, marca: string | null, ultimos4: string, estado: string }[]
}

interface ListarResponse {
  oneclickDisponible: boolean
  medios: MedioApi[]
}

/**
 * Medios de pago reales del usuario: tarjetas inscritas en Webpay Oneclick
 * (tokenizadas en Transbank). Acá nunca viaja un número de tarjeta — solo la
 * marca y los últimos 4 dígitos que devuelve el proveedor.
 */
export function useTarjetas() {
  const config = useRuntimeConfig()
  const toast = useToast()
  const apiUrl = config.public.apiUrl

  const tarjetas = ref<Tarjeta[]>([])
  const oneclickDisponible = ref(false)
  const loading = ref(false)

  async function cargar() {
    loading.value = true
    try {
      const res = await useApiFetch<ListarResponse>(`${apiUrl}/online/medios-pago`)
      oneclickDisponible.value = res.oneclickDisponible
      tarjetas.value = res.medios.map((m) => ({
        inscripcionId: m.inscripcionId,
        marca: m.mediosPago[0]?.marca ?? null,
        last4: m.mediosPago[0]?.ultimos4 ?? null,
        tipo: m.mediosPago[0]?.tipo ?? null,
        preferida: m.preferida,
        creadoEl: m.creadoEl,
      }))
    } catch (e: unknown) {
      const msg = (e as { data?: { message?: string } })?.data?.message
      toast.add({ title: msg ?? 'Error al cargar los medios de pago', color: 'error' })
    } finally {
      loading.value = false
    }
  }

  /** Inicia la inscripción: si funciona, el navegador sale de la SPA hacia Webpay. */
  async function agregar() {
    const res = await useApiFetch<{ inscripcionId: string, urlWebpay: string }>(
      `${apiUrl}/online/medios-pago`,
      { method: 'POST' },
    )
    window.location.href = res.urlWebpay
  }

  async function eliminar(inscripcionId: string) {
    await useApiFetch(`${apiUrl}/online/medios-pago/${inscripcionId}`, { method: 'DELETE' })
    await cargar()
  }

  async function marcarPreferida(inscripcionId: string) {
    await useApiFetch(`${apiUrl}/online/medios-pago/${inscripcionId}/preferida`, { method: 'PATCH' })
    await cargar()
  }

  // Preferida efectiva para checkout/suscripciones: la marcada o la más reciente.
  const preferida = computed(() =>
    tarjetas.value.find((t) => t.preferida) ?? tarjetas.value[0] ?? null,
  )

  onMounted(() => { void cargar() })

  return { tarjetas, preferida, oneclickDisponible, loading, cargar, agregar, eliminar, marcarPreferida }
}
```

Notas:
- Las mutaciones (`agregar`/`eliminar`/`marcarPreferida`) **relanzan** el error — el toast lo pone la página que conoce el contexto. `cargar` sí resuelve su propio toast porque corre en `onMounted` compartido por 3 páginas.
- `onMounted(cargar)` mantiene la semántica del composable viejo: los consumidores (`pasarela.vue`, `suscripciones.vue`) obtienen las tarjetas sin llamar nada.

- [x] **Step 2: Reescribir la página**

Reemplazar el contenido completo de `frontend/app/pages/tienda/medios-pago.vue`:

```vue
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Tarjeta } from '~/composables/useTarjetas'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { formatFecha } = useFormatters()

const {
  tarjetas, oneclickDisponible, loading,
  agregar, eliminar, marcarPreferida,
} = useTarjetas()

const agregando = ref(false)
const working = reactive(new Set<string>())
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)

function apiErrorMsg(e: unknown, fallback: string): string {
  return (e as { data?: { message?: string } })?.data?.message ?? fallback
}

onMounted(async () => {
  // Retorno de Webpay: /tienda/medios-pago?inscripcionId=...&estado=activa|fallida
  const estado = route.query.estado
  if (typeof estado === 'string' && route.query.inscripcionId) {
    if (estado === 'activa') {
      toast.add({ title: 'Tarjeta inscrita correctamente', color: 'success' })
    } else {
      toast.add({ title: 'La inscripción de la tarjeta fue rechazada', color: 'error' })
    }
    await router.replace({ query: {} })
  }
})

async function abrirInscripcion() {
  if (agregando.value) return
  agregando.value = true
  try {
    await agregar() // si funciona, el navegador sale hacia Webpay: no reseteamos el loading
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo iniciar la inscripción'), color: 'error' })
    agregando.value = false
  }
}

async function confirmarEliminar(id: string) {
  confirmModalOpen.value = false
  confirmDeleteId.value = null
  if (working.has(id)) return
  working.add(id)
  try {
    await eliminar(id)
    toast.add({ title: 'Tarjeta eliminada', color: 'success' })
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo eliminar la tarjeta'), color: 'error' })
  } finally {
    working.delete(id)
  }
}

async function preferir(t: Tarjeta) {
  if (t.preferida || working.has(t.inscripcionId)) return
  working.add(t.inscripcionId)
  try {
    await marcarPreferida(t.inscripcionId)
    toast.add({ title: 'Tarjeta preferida actualizada', color: 'success' })
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo marcar la preferida'), color: 'error' })
  } finally {
    working.delete(t.inscripcionId)
  }
}

const columns: TableColumn<Tarjeta>[] = [
  { accessorKey: 'marca', header: 'Tarjeta' },
  { id: 'preferida', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Medios de pago">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <CrudPageHeader
          title="Medios de pago"
          description="Tarjetas inscritas en Webpay Oneclick para pagar en la tienda online. Nunca guardamos el número: solo la marca y los últimos 4 dígitos."
        >
          <template #actions>
            <UButton
              icon="i-lucide-plus"
              :disabled="!oneclickDisponible"
              :loading="agregando"
              @click="abrirInscripcion"
            >
              Agregar tarjeta
            </UButton>
          </template>
        </CrudPageHeader>

        <UAlert
          v-if="!loading && !oneclickDisponible"
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="soft"
          title="Inscripción no disponible"
          description="El tenant no tiene una pasarela con tokenización (Oneclick) configurada y activa."
        />

        <div v-if="loading" class="py-8 text-center text-sm text-muted">
          Cargando…
        </div>

        <CrudTable v-else :data="tarjetas" :columns="columns">
          <template #marca-cell="{ row }">
            <CrudListItem
              :title="`${row.original.marca ?? 'Tarjeta'} •••• ${row.original.last4 ?? '????'}`"
              :subtitle="`Inscrita el ${formatFecha(row.original.creadoEl)}`"
            />
          </template>

          <template #preferida-cell="{ row }">
            <div class="flex justify-end">
              <button
                type="button"
                class="p-1 rounded transition-colors hover:bg-muted"
                @click="preferir(row.original)"
              >
                <UIcon
                  name="i-lucide-star"
                  class="w-5 h-5"
                  :class="row.original.preferida ? 'text-warning fill-current' : 'text-muted'"
                />
              </button>
            </div>
          </template>

          <template #acciones-cell="{ row }">
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              @click="() => { confirmDeleteId = row.original.inscripcionId; confirmModalOpen = true }"
            />
          </template>

          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              No tenés tarjetas inscritas.
            </div>
          </template>
        </CrudTable>

        <CrudModal
          v-model:open="confirmModalOpen"
          title="Eliminar tarjeta"
          message="¿Estás seguro? La tarjeta se eliminará también en Transbank y no podrá usarse para cobros."
          @cancel="confirmDeleteId = null"
          @confirm="confirmDeleteId && confirmarEliminar(confirmDeleteId)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
```

- [x] **Step 3: Verificar que el frontend compila y los consumidores siguen sanos**

Run: `cd frontend && npm run build`
Expected: build exitoso, sin errores de tipos.

Run: `grep -n "titular\|vencimiento\|detectarMarca\|localStorage" frontend/app/composables/useTarjetas.ts frontend/app/pages/tienda/medios-pago.vue`
Expected: sin resultados (el mock murió por completo).

Run: `grep -rn "\.last4\|\.marca" frontend/app/pages/tienda/pasarela.vue frontend/app/pages/tienda/suscripciones.vue`
Expected: los usos existentes siguen refiriéndose a campos que la nueva interfaz `Tarjeta` provee (`marca`, `last4`).

- [x] **Step 4: Commit**

```bash
git add frontend/app/composables/useTarjetas.ts frontend/app/pages/tienda/medios-pago.vue
git commit -m "feat(tienda): mis medios de pago con inscripción Oneclick real (adiós mock localStorage)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Documentación viva + verificación final

**Files:**
- Modify: `docs/features/tienda-online.md` (sección nueva "Mis medios de pago")
- Modify: `docs/features/pasarela-pagos.md` (preferida + ownership + fachada interna)
- Modify: `CLAUDE.md` (tabla "Estado actual")

**Interfaces:**
- Consumes: el comportamiento implementado en Tasks 1-3.
- Produces: documentación sincronizada con el código, requisito de cierre del proyecto.

- [x] **Step 1: Actualizar `docs/features/tienda-online.md`**

Agregar una sección (ubicarla junto a las secciones de funcionalidad existentes, leyendo el archivo para respetar su estructura):

```markdown
## Mis medios de pago (inscripción Oneclick)

`/tienda/medios-pago` gestiona las tarjetas reales del usuario, tokenizadas en
Transbank vía Oneclick (sin mock: el localStorage anterior murió).

- **Fachada JWT**: `GET/POST /online/medios-pago`, `DELETE /online/medios-pago/:id`,
  `PATCH /online/medios-pago/:id/preferida` (permisos `Tienda Online`). El
  `pagadorRef` de la inscripción es el `usuarioId` del token: cada usuario ve y
  gestiona solo sus tarjetas dentro del tenant.
- **Alta**: `POST` inicia la inscripción y el navegador sale a Webpay
  (`urlWebpay` con `TBK_TOKEN` embebido). El retorno cae en
  `/pasarela/retorno/inscripcion` y redirige a la página con
  `?inscripcionId=…&estado=activa|fallida` (toast + refetch).
- **Sin Oneclick activo**: la página muestra un aviso y deshabilita el alta
  (`oneclickDisponible` en el GET).
- **Preferida**: persistida en `pasarela_inscripciones.preferida`; al cobrar sin
  inscripción explícita gana la preferida y luego la más reciente.
- Nunca viaja un PAN/CVV por nuestra app: solo marca + últimos 4 que devuelve
  Transbank.
```

- [x] **Step 2: Actualizar `docs/features/pasarela-pagos.md`**

En la parte de inscripciones (leer el archivo para ubicar la sección), documentar:

```markdown
### Preferida y ownership por pagador (2026-07-11)

- `pasarela_inscripciones.preferida` (boolean, default false): solo una por
  tenant+pagador; `marcarPreferida` desmarca las demás en transacción.
- `resolverParaCobro` sin `inscripcionId` explícito ordena por
  `preferida DESC, creadoEl DESC`.
- `eliminar` y `marcarPreferida` aceptan un `pagadorRef` opcional que se suma al
  `WHERE` (ownership). La API m2m sigue llamando sin él; la fachada interna de la
  tienda (`/online/medios-pago`, ver `docs/features/tienda-online.md`) lo pasa
  siempre con el `usuarioId` del token.
```

- [x] **Step 3: Actualizar la tabla "Estado actual" de `CLAUDE.md`**

Agregar al final de la tabla (después de la fila del módulo de cron):

```markdown
| Tienda Online — Mis medios de pago (inscripción Oneclick real: tarjetas tokenizadas por usuario, preferida en BD, eliminación en Transbank) | ✅ Implementado (2026-07-11) |
```

- [x] **Step 4: Verificación final completa**

Run: `cd backend && npm test && npm run lint && npx tsc --noEmit`
Expected: suite completa verde; lint y tsc sin errores **nuevos** (hay 2 errores tsc preexistentes conocidos en `auth.service.spec.ts` / `ventas.service.spec.ts` y ~30 problemas de lint de línea base — no deben crecer).

Verificación manual (requiere stack docker y credenciales de integración Transbank; si no está disponible, dejar constancia):
1. `docker-compose up` → login → `/tienda/medios-pago`.
2. Sin Oneclick configurado: aviso visible, botón deshabilitado.
3. Con Oneclick (integración): "Agregar tarjeta" → Webpay → tarjeta de prueba `4051 8856 0044 6623` → volver con toast de éxito y la tarjeta listada (Visa •••• 6623).
4. Marcar preferida (estrella persiste tras recargar), eliminar (desaparece y Transbank confirma).

> Constancia (2026-07-12): verificación manual pendiente — requiere stack docker + credenciales de integración Transbank. Riesgo señalado en revisión final: el redirect GET con ?TBK_TOKEN= a la inscripción Oneclick no está verificado contra el ambiente real (Transbank documenta POST form); si Webpay lo rechaza, el fix es un form POST auto-submit desde el frontend.

- [x] **Step 5: Commit**

```bash
git add docs/features/tienda-online.md docs/features/pasarela-pagos.md CLAUDE.md
git commit -m "docs: mis medios de pago con inscripción Oneclick — feature docs y estado actual

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
