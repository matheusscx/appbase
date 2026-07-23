# Refactor Caja → "Mi caja" / "Cajas" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar la operación del cajero (**Mi caja**) de la supervisión del encargado (**Cajas**) en dos módulos de permiso y dos superficies de navegación, reusando el mismo backend de dominio.

**Architecture:** El módulo de permiso `Caja` se **renombra a `MiCaja`** (conserva su id → las FKs y asignaciones existentes siguen válidas) y se crea un módulo nuevo `Cajas` con acción `Leer` (supervisión, solo lectura). El backend mantiene el prefijo `/caja/*` y un único `caja.service.ts`; solo cambian los guards por endpoint. El frontend parte `pages/caja/*` en `pages/mi-caja/*` (operar) y `pages/cajas/*` (supervisar read-only). El `useCajaStore` y sus URLs **no cambian**.

**Tech Stack:** NestJS + TypeORM + PostgreSQL (backend), Nuxt 4 + Vue 3 + Pinia + Nuxt UI (frontend). Jest (unit + e2e), Playwright (browser e2e).

## Global Constraints

- `tenant_id`/`usuario_id` **siempre del token** (`req.user as JwtUser`), nunca del body/query/param.
- **Soft delete** en todo; toda lectura filtra `eliminado_el IS NULL`. Nunca `DELETE` físico.
- **No modificar** el sistema de tokens JWT, ni el motor de precios, ni `movimientos_inventario`, ni el modelo de datos de `cajas`/`movimientos_caja` (el campo `cerrada_por` del cierre forzado está **diferido**, no entra acá).
- **Enforcement real en backend** (guards por ruta). La visibilidad en el sidebar nunca sustituye al guard.
- **Escrituras owner-only**: `Cajas:Leer` habilita ver, **nunca** escribir. Registrar movimientos y cerrar siguen validando propiedad en el service.
- Seed: fuente de verdad `backend/src/modules/seeder/seeder.service.ts`. IDs fijos patrón `550e8400-e29b-41d4-a716-446655440XXX`. IDs libres asignados en este plan: `...440282` (módulo Cajas), `...440283` (Cajas↔Leer), `...440284` (Paris→Cajas), `...440285` (Falabella→Cajas).
- Frontend: `$fetch`/`useApiFetch`, nunca axios. Tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado.
- Gate de cierre (correr, no afirmar): `cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e` · `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`.

## Modelo RBAC (contexto para todas las tareas)

`userHasPermiso(userId, tenantId, moduloNombre, permisoNombre)` (`rbac.service.ts:12`):
1. **Short-circuit**: si el usuario tiene algún rol `es_fijo=true` en el tenant → `true` (acceso total). El rol **Administrador** es `es_fijo=true` → **automáticamente** tiene `MiCaja:*` y `Cajas:Leer` sin grant explícito, siempre que el tenant **contrate** el módulo (`tenant_modulos`).
2. Si no, JOIN completo `roles_usuarios → modulos_roles → tenant_modulos → modulos_app → roles_permisos_modulos → modulo_app_permisos → permisos`, matcheando `modulos_app.nombre` y `permisos.nombre`.

`getMisPermisos` devuelve strings `"${modulo}:${permiso}"` (ej. `"Cajas:Leer"`). El frontend chequea con `usePermissionsStore().can(modulo, permiso)` + el flag `esAdmin`.

`tenants.service.create()` **no auto-contrata módulos** — se agregan vía `addModule(moduloAppId)` (flujo admin, sin cambios). Solo el seed de Paris/Falabella necesita filas nuevas.

---

## File Structure

**Backend (modificar):**
- `backend/src/modules/caja/caja.controller.ts` — remapear `@RequiresPermiso` por endpoint + helper `resolverLecturaCompartida`.
- `backend/src/modules/caja/caja.controller.spec.ts` — actualizar expectativas de permisos.
- `backend/test/caja.e2e-spec.ts` (o `backend/src/**/caja.e2e-spec.ts`) — setup de permisos + escenarios cajero/supervisor.
- `backend/src/modules/seeder/seeder.service.ts` — renombrar módulo, crear módulo Cajas, asociaciones, tenant_modulos.

**Frontend (crear):**
- `frontend/app/pages/mi-caja/index.vue`, `[id].vue`, `historial.vue`
- `frontend/app/pages/cajas/index.vue`, `[id].vue`, `historial.vue`

**Frontend (modificar):**
- `frontend/app/layouts/dashboard.vue` — dos items de nav.
- `frontend/app/components/caja/CajaAbiertasGrid.vue` (y cualquier componente en `components/caja/` con link `/caja` interno) — retarget a `/cajas/[id]`.

**Frontend (eliminar):**
- `frontend/app/pages/caja/index.vue`, `[id].vue`, `historial.vue` (reemplazados; opcionalmente `caja/index.vue` se conserva como redirect — ver Task 9).

**Frontend (SIN cambios, verificar):**
- `frontend/app/stores/caja.ts` — las URLs siguen siendo `/caja/*` (el backend no cambia rutas).

**Docs (modificar):**
- `docs/features/gestion-cajas.md`, `docs/features/roles-permisos.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`.

---

## Task 1: Backend — Seed: renombrar `Caja`→`MiCaja` + crear módulo `Cajas`

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts` (`seedModulosApp` ~L431-527, `seedModuloAppPermisos` ~L577-623, `seedTenantModulo` ~L1055-1105, `seedVendedorPermisosCaja` ~L2713-2785)

**Interfaces:**
- Produces: módulo `MiCaja` (id `...011`, url `/mi-caja`), módulo `Cajas` (id `...282`, url `/cajas`), `modulo_app_permiso` Cajas↔Leer (id `...283`), `tenant_modulos` Paris→Cajas (`...284`) y Falabella→Cajas (`...285`). Consumido por el controller (Task 2), los e2e (Task 3) y el frontend.

- [ ] **Step 1: Renombrar el módulo Caja → MiCaja en `seedModulosApp`**

En `seeder.service.ts`, la entrada del módulo Caja (~L433-439):

```typescript
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440011',
        nombre: 'Caja',
        url: '/caja',
        icono: 'mdi-cash-register',
        tieneConfiguracion: false,
      },
```

cambiar `nombre` y `url` (conservar el id):

```typescript
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440011',
        nombre: 'MiCaja',
        url: '/mi-caja',
        icono: 'mdi-cash-register',
        tieneConfiguracion: false,
      },
```

- [ ] **Step 2: Agregar el módulo Cajas en el mismo array `modulos`**

Justo después de la entrada de MiCaja, agregar:

```typescript
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282',
        nombre: 'Cajas',
        url: '/cajas',
        icono: 'mdi-cash-multiple',
        tieneConfiguracion: false,
      },
```

- [ ] **Step 3: En `seedModuloAppPermisos`, quitar la asociación `Caja↔Ver todas` y agregar `Cajas↔Leer`**

Eliminar por completo esta entrada (~L619-623):

```typescript
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440038',
        moduloAppId: CAJA,
        permisoId: VER_TODAS,
      },
```

(La constante `VER_TODAS` sigue usándose para Ventas/Inventario; `CAJA` sigue usándose para Leer/Crear/Actualizar/Eliminar, que ahora pertenecen a MiCaja. No borrar esas constantes.)

Agregar la nueva asociación Cajas↔Leer al array `entries` (después de las de Caja):

```typescript
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440283',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Cajas
        permisoId: LEER,
      },
```

- [ ] **Step 4: En `seedTenantModulo`, contratar Cajas para Paris y Falabella**

Agregar dos entradas al array `entries` (mismo shape que las existentes; usar la fecha `expiraEn` que usan las demás):

```typescript
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440284',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Paris → Cajas
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440285',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Falabella → Cajas
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
```

- [ ] **Step 5: Actualizar el comentario de `seedVendedorPermisosCaja`**

El rol Vendedor sigue recibiendo **solo MiCaja** (Leer/Crear/Actualizar) — el diferenciador supervisor ahora es tener el módulo `Cajas`, no la acción `Ver todas`. Los ids `CAJA_LEER/CAJA_CREAR/CAJA_ACTUALIZAR` (`...034/035/036`) no cambian (ahora pertenecen a MiCaja). Actualizar el comentario ~L2778:

```typescript
    // Asignar MiCaja: Leer, Crear, Actualizar (sin el módulo Cajas — ese es el
    // diferenciador supervisor/encargado, que da lectura de todas las cajas)
    for (const moduloAppPermisoId of [CAJA_LEER, CAJA_CREAR, CAJA_ACTUALIZAR]) {
```

Y el comentario ~L2715 `// moduloTenantId para Paris → Caja` → `// moduloTenantId para Paris → MiCaja`.

- [ ] **Step 6: Reconstruir la BD y verificar el seed**

Run:
```bash
cd /Users/m2pro/cmatheus/startup-app && docker-compose down -v && docker-compose up -d && sleep 25
docker-compose exec -T db psql -U postgres -d startup_pos -c "SELECT nombre, url FROM modulos_app WHERE nombre IN ('MiCaja','Cajas') ORDER BY nombre;"
```
Expected: dos filas — `Cajas | /cajas` y `MiCaja | /mi-caja`. (Si el nombre de la BD/usuario difiere, tomarlo de `.env`: `DATABASE_URL`.)

- [ ] **Step 7: Verificar que el admin de Paris obtiene `Cajas:Leer`**

Run:
```bash
docker-compose exec -T db psql -U postgres -d startup_pos -c "SELECT ma.nombre AS modulo, p.nombre AS permiso FROM tenant_modulos tm JOIN modulos_app ma ON ma.modulo_app_id = tm.modulo_app_id JOIN modulo_app_permisos map ON map.modulo_app_id = ma.modulo_app_id JOIN permisos p ON p.permiso_id = map.permiso_id WHERE tm.tenant_id = '550e8400-e29b-41d4-a716-446655440007' AND ma.nombre IN ('MiCaja','Cajas') ORDER BY modulo, permiso;"
```
Expected: incluye `Cajas | Leer`, `MiCaja | Leer`, `MiCaja | Crear`, `MiCaja | Actualizar`, `MiCaja | Eliminar`. **NO** debe aparecer `MiCaja | Ver todas`.

- [ ] **Step 8: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add backend/src/modules/seeder/seeder.service.ts
git commit -m "refactor(caja): seed renombra Caja→MiCaja y crea módulo Cajas (supervisión)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Backend — Controller: guards por endpoint + lectura compartida

**Files:**
- Modify: `backend/src/modules/caja/caja.controller.ts` (reescritura completa, ver Step 3)
- Test: `backend/src/modules/caja/caja.controller.spec.ts`

**Interfaces:**
- Consumes: `MiCaja`/`Cajas` del seed (Task 1); `RbacService.userHasPermiso(userId, tenantId, modulo, permiso): Promise<boolean>`; `CajaService` (sin cambios de firma).
- Produces: endpoints `/caja/*` con enforcement: operar → `MiCaja`, supervisar → `Cajas:Leer`, lectura compartida → `MiCaja:Leer` OR `Cajas:Leer`.

- [ ] **Step 1: Leer el spec actual y escribir/ajustar el test unitario primero**

Leer `caja.controller.spec.ts` completo. Los tests mockean `CajaService` y `RbacService`. Actualizar/agregar estos casos (el mock de `rbacService.userHasPermiso` debe distinguir por argumentos `modulo`/`permiso`):

```typescript
// resolverLecturaCompartida: 403 si no tiene ni MiCaja:Leer ni Cajas:Leer
it('detalle lanza ForbiddenException si el usuario no tiene MiCaja:Leer ni Cajas:Leer', async () => {
  jest.spyOn(rbacService, 'userHasPermiso').mockResolvedValue(false);
  const req = { user: { id: 'u1', tenantId: 't1' } } as any;
  await expect(controller.detalle(req, 'caja1')).rejects.toThrow(ForbiddenException);
});

it('detalle pasa verTodas=true cuando el usuario tiene Cajas:Leer', async () => {
  jest.spyOn(rbacService, 'userHasPermiso').mockImplementation(
    async (_u, _t, modulo, permiso) => modulo === 'Cajas' && permiso === 'Leer',
  );
  const findOne = jest.spyOn(cajaService, 'findOne').mockResolvedValue({} as any);
  const req = { user: { id: 'u1', tenantId: 't1' } } as any;
  await controller.detalle(req, 'caja1');
  expect(findOne).toHaveBeenCalledWith('t1', 'u1', 'caja1', true);
});

it('detalle pasa verTodas=false para un cajero con solo MiCaja:Leer', async () => {
  jest.spyOn(rbacService, 'userHasPermiso').mockImplementation(
    async (_u, _t, modulo, permiso) => modulo === 'MiCaja' && permiso === 'Leer',
  );
  const findOne = jest.spyOn(cajaService, 'findOne').mockResolvedValue({} as any);
  const req = { user: { id: 'u1', tenantId: 't1' } } as any;
  await controller.detalle(req, 'caja1');
  expect(findOne).toHaveBeenCalledWith('t1', 'u1', 'caja1', false);
});
```

Importar `ForbiddenException` de `@nestjs/common` en el spec si no está. Ajustar los tests existentes que asuman `userHasPermiso(..., 'Caja', 'Ver todas')` para que usen `'Cajas', 'Leer'`.

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `cd backend && npm test -- modules/caja/caja.controller.spec.ts`
Expected: FAIL (el controller aún llama `'Caja'`/`'Ver todas'` y no existe `detalle` con helper 403).

- [ ] **Step 3: Reescribir `caja.controller.ts`**

Reemplazar el contenido completo por:

```typescript
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { RbacService } from '../rbac/rbac.service';
import { CajaService } from './caja.service';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { QueryMovimientosCajaDto } from './dto/query-movimientos-caja.dto';
import { QueryHistorialCajaDto } from './dto/query-historial-caja.dto';

@ApiTags('caja')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('caja')
export class CajaController {
  constructor(
    private readonly cajaService: CajaService,
    private readonly rbacService: RbacService,
  ) {}

  /**
   * Endpoints de lectura que sirven tanto al dueño (módulo MiCaja) como al
   * supervisor (módulo Cajas). Devuelve `verTodas=true` si el usuario tiene
   * `Cajas:Leer`; lanza 403 si no tiene ni `MiCaja:Leer` ni `Cajas:Leer`.
   * El alcance (propia vs. todas) y la escritura owner-only los sigue
   * resolviendo el service.
   */
  private async resolverLecturaCompartida(u: JwtUser): Promise<boolean> {
    const [tieneMiCaja, tieneCajas] = await Promise.all([
      this.rbacService.userHasPermiso(u.id, u.tenantId!, 'MiCaja', 'Leer'),
      this.rbacService.userHasPermiso(u.id, u.tenantId!, 'Cajas', 'Leer'),
    ]);
    if (!tieneMiCaja && !tieneCajas) {
      throw new ForbiddenException('No tienes permiso para esta acción');
    }
    return tieneCajas;
  }

  @Get()
  async historial(@Req() req: Request, @Query() query: QueryHistorialCajaDto) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    const consultaOtroUsuario =
      query.usuarioId != null && query.usuarioId !== u.id;
    const scope = query.todas || consultaOtroUsuario ? verTodas : false;
    return this.cajaService.historial(u.tenantId!, u.id, query, scope);
  }

  @Get('activa')
  @RequiresPermiso('MiCaja', 'Leer')
  activa(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.cajaService.findActiva(u.tenantId!, u.id);
  }

  @Get('abiertas')
  @RequiresPermiso('Cajas', 'Leer')
  abiertas(@Req() req: Request) {
    const u = req.user as JwtUser;
    // Endpoint exclusivo de supervisión: quien llega tiene Cajas:Leer → ve todas.
    return this.cajaService.abiertas(u.tenantId!, u.id, true);
  }

  @Get(':id')
  async detalle(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    return this.cajaService.findOne(u.tenantId!, u.id, cajaId, verTodas);
  }

  @Post('abrir')
  @RequiresPermiso('MiCaja', 'Crear')
  abrir(@Req() req: Request, @Body() dto: AbrirCajaDto) {
    const u = req.user as JwtUser;
    return this.cajaService.abrir(u.tenantId!, u.id, dto);
  }

  @Post(':id/movimientos')
  @RequiresPermiso('MiCaja', 'Crear')
  registrarMovimiento(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: CrearMovimientoDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.registrarMovimiento(u.tenantId!, u.id, cajaId, dto);
  }

  @Post(':id/cerrar')
  @RequiresPermiso('MiCaja', 'Actualizar')
  cerrar(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: CerrarCajaDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.cerrar(u.tenantId!, u.id, cajaId, dto);
  }

  @Get(':id/movimientos/resumen')
  async resumenMovimientos(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    return this.cajaService.resumenMovimientos(
      u.tenantId!,
      u.id,
      cajaId,
      verTodas,
    );
  }

  @Get(':id/movimientos')
  async listarMovimientos(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Query() query: QueryMovimientosCajaDto,
  ) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    return this.cajaService.listarMovimientos(
      u.tenantId!,
      u.id,
      cajaId,
      query,
      verTodas,
    );
  }
}
```

**Nota de orden de rutas:** `activa` y `abiertas` van antes de `:id` (rutas específicas antes de la paramétrica) — preservado. Los `@Get()` sin `@RequiresPermiso` (historial, detalle, resumen, listar) dependen del guard `PermisosGuard`, que devuelve `true` cuando no hay metadata; el enforcement lo hace `resolverLecturaCompartida` en el handler. Siguen bajo `JwtAuthGuard + TenantGuard` (autenticados).

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `cd backend && npm test -- modules/caja/caja.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck y lint**

Run: `cd backend && npm run typecheck && npm run lint:check`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add backend/src/modules/caja/caja.controller.ts backend/src/modules/caja/caja.controller.spec.ts
git commit -m "refactor(caja): guards por endpoint MiCaja/Cajas + lectura compartida

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Backend — E2E: escenarios cajero vs supervisor

**Files:**
- Modify: el spec e2e de caja (localizar con `find backend -name 'caja.e2e-spec.ts'`)

**Interfaces:**
- Consumes: endpoints de Task 2; seed de Task 1.

- [ ] **Step 1: Leer el e2e actual y su setup de permisos**

Leer el `caja.e2e-spec.ts`. Identificar cómo crea usuarios/roles de prueba y cómo les asigna permisos (probablemente vía inserts o vía el seed de Paris: admin.paris = Administrador, vendedor@paris.cl = Vendedor con MiCaja). Localizar cualquier referencia a `'Caja'`/`'Ver todas'` en el setup y actualizarla a `'MiCaja'`/`'Cajas'`.

- [ ] **Step 2: Actualizar los tests existentes que rompan por el renombre**

Cualquier test que asigne o espere el permiso `Caja` debe usar `MiCaja`; los que dependían de `Caja:Ver todas` para ver todas ahora dependen de que el usuario tenga el módulo `Cajas` (`Cajas:Leer`).

- [ ] **Step 3: Agregar escenarios de aislamiento (TDD — escribir y ver fallar si aplica)**

Agregar, reusando los helpers de auth del archivo:

```typescript
it('un cajero (solo MiCaja) recibe 403 al pedir GET /caja/abiertas', async () => {
  // token de vendedor@paris.cl (rol Vendedor: MiCaja, sin Cajas)
  await request(app.getHttpServer())
    .get('/caja/abiertas')
    .set('Authorization', `Bearer ${tokenCajero}`)
    .expect(403);
});

it('un supervisor (Cajas:Leer) puede listar todas las cajas abiertas', async () => {
  // token de un usuario con rol que tenga Cajas:Leer (o admin.paris, es_fijo)
  await request(app.getHttpServer())
    .get('/caja/abiertas')
    .set('Authorization', `Bearer ${tokenSupervisor}`)
    .expect(200);
});

it('un supervisor NO puede cerrar la caja de otro cajero (owner-only)', async () => {
  // supervisor intenta cerrar la caja abierta por el cajero → 403/404 (owner-only en service)
  await request(app.getHttpServer())
    .post(`/caja/${cajaDelCajeroId}/cerrar`)
    .set('Authorization', `Bearer ${tokenSupervisor}`)
    .send({ montoContado: '100' })
    .expect((res) => {
      if (![403, 404].includes(res.status)) {
        throw new Error(`esperaba 403/404, fue ${res.status}`);
      }
    });
});
```

Adaptar nombres de variables/tokens/helpers a los que ya existan en el archivo. Si no hay un rol con `Cajas:Leer` sin `es_fijo`, usar `admin.paris` (Administrador) como supervisor para el caso 200; y para el caso owner-only usar el admin cerrando una caja ajena — verificar que el service valida propiedad **incluso** para admin (si el service permite a admin cerrar cualquiera, ajustar la aserción y anotarlo: el owner-only vive en el service, no en el permiso).

- [ ] **Step 4: Correr el e2e de caja**

Run: `cd backend && npm run test:e2e -- caja.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add backend
git commit -m "test(caja): e2e aislamiento cajero (MiCaja) vs supervisor (Cajas)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — Sidebar: dos items de navegación

**Files:**
- Modify: `frontend/app/layouts/dashboard.vue` (~L31-37)

**Interfaces:**
- Consumes: `usePermissionsStore().can(modulo, permiso)` + `.esAdmin`.
- Produces: item "Mi caja" → `/mi-caja` (gate `MiCaja:Leer`), item "Cajas" → `/cajas` (gate `Cajas:Leer`).

- [ ] **Step 1: Reemplazar el bloque del item "Caja"**

Reemplazar (~L31-37):

```typescript
  if (permissionsStore.esAdmin || permissionsStore.can('Caja', 'Leer')) {
    base.push({
      label: 'Caja',
      icon: 'i-lucide-banknote',
      to: '/caja',
    })
  }
```

por:

```typescript
  if (permissionsStore.esAdmin || permissionsStore.can('MiCaja', 'Leer')) {
    base.push({
      label: 'Mi caja',
      icon: 'i-lucide-banknote',
      to: '/mi-caja',
    })
  }

  if (permissionsStore.esAdmin || permissionsStore.can('Cajas', 'Leer')) {
    base.push({
      label: 'Cajas',
      icon: 'i-lucide-layout-dashboard',
      to: '/cajas',
    })
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck:ratchet`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/app/layouts/dashboard.vue
git commit -m "refactor(caja): sidebar con dos items Mi caja / Cajas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — Páginas "Mi caja" (operario)

**Files:**
- Create: `frontend/app/pages/mi-caja/index.vue`, `frontend/app/pages/mi-caja/[id].vue`, `frontend/app/pages/mi-caja/historial.vue`
- Reference (sin cambios): `frontend/app/pages/caja/*.vue` (fuente a adaptar), `components/caja/CajaAperturaForm.vue`, `CajaActivaDashboard.vue`, `CajaHistorial.vue`, `stores/caja.ts`

**Interfaces:**
- Consumes: `usePermissionsStore().can('MiCaja','Leer')`, `useCajaStore()` (URLs `/caja/*` sin cambio).

- [ ] **Step 1: Crear `pages/mi-caja/index.vue` — vista de cajero (sin la rama supervisor)**

Leer `pages/caja/index.vue` completo. Crear `pages/mi-caja/index.vue` copiando su estructura pero **eliminando la rama `puedeVerTodas`** (el grid de supervisor se va a `/cajas`). Cambios exactos:
- Gate de acceso: `perms.can('Caja', 'Leer')` → `perms.can('MiCaja', 'Leer')`.
- Eliminar el `computed puedeVerTodas` y su rama de template `<template v-else-if="puedeVerTodas">` (CajaAbiertasGrid).
- Redirección a la caja propia: `navigateTo(\`/caja/${cajaStore.activa.id}\`, ...)` → `navigateTo(\`/mi-caja/${cajaStore.activa.id}\`, ...)`.
- Botón/link "Ver historial": target `/caja/historial` → `/mi-caja/historial`.
- Mantener las ramas de cajero: apertura (`CajaAperturaForm`) y "Redirigiendo…".

Estructura resultante (script):

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const perms = usePermissionsStore()
const cajaStore = useCajaStore()
const toast = useToast()

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('MiCaja', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Mi caja', color: 'warning' })
    await navigateTo('/ventas')
    return
  }
  await cajaStore.cargarActiva()
  if (cajaStore.activa?.id) {
    await navigateTo(`/mi-caja/${cajaStore.activa.id}`, { replace: true })
  }
})
</script>
```

(Adaptar el template a las ramas de cajero existentes: si hay caja activa redirige; si no, muestra `CajaAperturaForm` + link a `/mi-caja/historial`. Copiar el markup de esas ramas desde `pages/caja/index.vue` verbatim, ajustando solo los `to`/`navigateTo` de `/caja*` a `/mi-caja*`.)

- [ ] **Step 2: Crear `pages/mi-caja/[id].vue` — detalle operable de la caja propia**

Leer `pages/caja/[id].vue`. Copiar a `pages/mi-caja/[id].vue`. Cambios:
- Gate: agregar en `onMounted` el chequeo `if (!perms.esAdmin && !perms.can('MiCaja', 'Leer')) { ...navigateTo('/ventas') }` (coherente con las otras páginas Mi caja).
- Mantener `readonly = computed(() => cajaStore.detalle?.id !== cajaStore.activa?.id)` (una caja que no es la activa propia se ve read-only).
- Links internos `/caja*` → `/mi-caja*` (ej. "Volver al listado" → `/mi-caja`, "Ver historial" → `/mi-caja/historial`).
- Eliminar el `computed puedeVerTodas` y los links de admin "Ver historial del cajero" (`?usuarioId=`) — eso pertenece a la superficie Cajas.

- [ ] **Step 3: Crear `pages/mi-caja/historial.vue` — historial propio**

Leer `pages/caja/historial.vue`. Copiar a `pages/mi-caja/historial.vue`. Cambios:
- Gate: `perms.can('Caja', 'Leer')` → `perms.can('MiCaja', 'Leer')`.
- El componente `CajaHistorial` se usa **sin** `usuarioId` y sin toggle "Ver todas" (historial propio del cajero). Si el markup traía el toggle "Ver todas", quitarlo (es de supervisor).
- Links `/caja*` → `/mi-caja*`.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck:ratchet`
Expected: sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/app/pages/mi-caja
git commit -m "feat(caja): páginas Mi caja (operación del cajero)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — Páginas "Cajas" (supervisión, read-only)

**Files:**
- Create: `frontend/app/pages/cajas/index.vue`, `frontend/app/pages/cajas/[id].vue`, `frontend/app/pages/cajas/historial.vue`
- Modify: `frontend/app/components/caja/CajaAbiertasGrid.vue` (retarget navegación a `/cajas/[id]`)

**Interfaces:**
- Consumes: `usePermissionsStore().can('Cajas','Leer')`, `useCajaStore()` (`cargarAbiertas`, `cargarDetalle`, `fetchHistorial`).

- [ ] **Step 1: Crear `pages/cajas/index.vue` — grid de cajas abiertas del tenant**

Crear con el gate `Cajas:Leer` y la rama supervisor (grid) extraída de `pages/caja/index.vue`:

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const perms = usePermissionsStore()
const cajaStore = useCajaStore()
const toast = useToast()

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('Cajas', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Cajas', color: 'warning' })
    await navigateTo('/ventas')
    return
  }
  await cajaStore.cargarAbiertas()
})
</script>

<template>
  <div>
    <!-- Copiar el markup de la rama <template v-else-if="puedeVerTodas"> de
         pages/caja/index.vue: header + CajaAbiertasGrid + link a /cajas/historial -->
    <CajaAbiertasGrid />
    <!-- Link "Ver historial" → /cajas/historial -->
  </div>
</template>
```

(Copiar el markup real del grid desde la rama supervisor de `pages/caja/index.vue`, ajustando el link de historial a `/cajas/historial`.)

- [ ] **Step 2: Retargetear la navegación de `CajaAbiertasGrid.vue`**

Leer `components/caja/CajaAbiertasGrid.vue`. El click de cada card navega a `/caja/${id}`. Cambiar a `/cajas/${id}` (este grid es exclusivo de la superficie Cajas).

Run para localizar el link:
```bash
grep -n "/caja" frontend/app/components/caja/CajaAbiertasGrid.vue
```
Cambiar `/caja/${...}` → `/cajas/${...}`.

- [ ] **Step 3: Crear `pages/cajas/[id].vue` — detalle read-only de cualquier caja**

Crear delegando en `CajaActivaDashboard` en modo read-only (siempre readonly: es supervisión):

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const perms = usePermissionsStore()
const cajaStore = useCajaStore()
const toast = useToast()

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('Cajas', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Cajas', color: 'warning' })
    await navigateTo('/ventas')
    return
  }
  try {
    await cajaStore.cargarDetalle(route.params.id as string)
  } catch {
    await navigateTo('/cajas')
  }
})
</script>

<template>
  <div>
    <!-- CajaActivaDashboard en modo read-only (supervisión). Copiar el uso desde
         pages/caja/[id].vue, forzando readonly=true y con links a /cajas*.
         Incluir el link "Ver historial del cajero" → /cajas/historial?usuarioId=<usuarioId de la caja>. -->
  </div>
</template>
```

Verificar la prop exacta con la que `CajaActivaDashboard` recibe el modo read-only (en `pages/caja/[id].vue` se deriva de `readonly`). Acá `readonly` es siempre `true`.

- [ ] **Step 4: Crear `pages/cajas/historial.vue` — historial de todas las cajas**

Crear con gate `Cajas:Leer`, usando `CajaHistorial` con el toggle "Ver todas" y soporte de `?usuarioId=` (filtro por cajero):

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const perms = usePermissionsStore()
const toast = useToast()

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('Cajas', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Cajas', color: 'warning' })
    await navigateTo('/ventas')
    return
  }
})
</script>

<template>
  <div>
    <!-- CajaHistorial con toggle "Ver todas" y ?usuarioId= (copiar el markup
         supervisor de pages/caja/historial.vue). Click en fila → /cajas/[id]. -->
  </div>
</template>
```

Si `CajaHistorial` navega internamente a `/caja/[id]`, verificar y (si aplica) parametrizar/ajustar a `/cajas/[id]` para esta superficie. Revisar con `grep -n "/caja" frontend/app/components/caja/CajaHistorial.vue`.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run typecheck:ratchet`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/app/pages/cajas frontend/app/components/caja/CajaAbiertasGrid.vue
git commit -m "feat(caja): páginas Cajas (supervisión read-only del encargado)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — Eliminar páginas viejas `/caja` + redirect de compatibilidad

**Files:**
- Delete: `frontend/app/pages/caja/[id].vue`, `frontend/app/pages/caja/historial.vue`
- Replace: `frontend/app/pages/caja/index.vue` → redirect a `/mi-caja`

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Verificar que no queden links internos a `/caja` fuera de las nuevas páginas**

Run:
```bash
grep -rn "'/caja'\|\"/caja\"\|/caja/\|to=\"/caja\|navigateTo('/caja" frontend/app --include=*.vue | grep -v "/pages/mi-caja/" | grep -v "/pages/cajas/"
```
Expected: solo referencias dentro de `components/caja/*` que ya deberían apuntar a `/mi-caja` o `/cajas` (retargeteadas en Tasks 5-6). Si aparece alguna `/caja` cruda de navegación, decidir su destino (operación → `/mi-caja`, supervisión → `/cajas`) y corregirla. **No** tocar las URLs de API en `stores/caja.ts` (esas son `/caja/*` del backend y NO cambian).

- [ ] **Step 2: Reemplazar `pages/caja/index.vue` por un redirect**

Sobrescribir `frontend/app/pages/caja/index.vue`:

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })
// Compatibilidad: la superficie /caja se dividió en /mi-caja (operar) y /cajas
// (supervisar). Enviar a Mi caja por defecto.
onMounted(async () => {
  await navigateTo('/mi-caja', { replace: true })
})
</script>

<template>
  <div />
</template>
```

- [ ] **Step 3: Eliminar las páginas viejas restantes**

Run:
```bash
cd /Users/m2pro/cmatheus/startup-app
git rm frontend/app/pages/caja/\[id\].vue frontend/app/pages/caja/historial.vue
```

- [ ] **Step 4: Build + typecheck + design check**

Run:
```bash
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/app/pages/caja
git commit -m "refactor(caja): retirar páginas /caja; /caja redirige a /mi-caja

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Smoke test en navegador (runtime — lo que build/typecheck no ven)

**Files:** ninguno (verificación manual). Requiere `docker-compose up` (stack real).

**Interfaces:** ninguna.

- [ ] **Step 1: Levantar el stack y loguear**

Run: `cd /Users/m2pro/cmatheus/startup-app && docker-compose up -d && sleep 20`
Abrir `http://localhost:5173`, login, seleccionar tenant Paris.

- [ ] **Step 2: Verificar como admin (ve ambas superficies)**

Con `admin.paris` (Administrador): el sidebar muestra **"Mi caja"** y **"Cajas"**.
- "Mi caja": sin caja activa → formulario de apertura; abrir caja → redirige a `/mi-caja/[id]` operable (botones +Movimiento / Cerrar).
- "Cajas": grid de cajas abiertas del tenant; click en una card → `/cajas/[id]` **read-only** (sin botones de operar); "Cajas → historial" lista todas con toggle/filtro.

- [ ] **Step 3: Verificar como cajero puro (solo Mi caja)**

Con `vendedor@paris.cl` (rol Vendedor, MiCaja sin Cajas): el sidebar muestra **solo "Mi caja"**, no "Cajas". Navegar manualmente a `/cajas` → redirige a `/ventas` con toast de sin acceso. `/caja` (vieja) → redirige a `/mi-caja`.

- [ ] **Step 4: Registrar el resultado**

Si algo falla en runtime (auto-imports Nuxt, readonly mal derivado, links rotos), corregirlo en la Task correspondiente y volver a commitear. Si todo pasa, continuar.

---

## Task 9: Documentación

**Files:**
- Modify: `docs/features/gestion-cajas.md`, `docs/features/roles-permisos.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`

- [ ] **Step 1: `docs/features/gestion-cajas.md`**

Reescribir la sección "Modelo de acceso por permiso" y las rutas de frontend: dos módulos (`MiCaja` = operar el propio turno; `Cajas` = supervisar todas, solo lectura) y dos superficies (`/mi-caja*`, `/cajas*`) en vez de `/caja` + `Ver todas`. Aclarar que el backend sigue en `/caja/*` (un solo controller/service) y que las escrituras siguen owner-only. Actualizar la tabla de endpoints con los permisos nuevos.

- [ ] **Step 2: `docs/features/roles-permisos.md`**

Reflejar: módulo `Caja` renombrado a `MiCaja`; módulo nuevo `Cajas` (acción `Leer`); la acción global `Ver todas` ya no se asocia a caja (el diferenciador supervisor es tener el módulo `Cajas`).

- [ ] **Step 3: `docs/ESTADO.md`**

Actualizar la fila de gestión de caja con el refactor Mi caja / Cajas y su fecha (2026-07-23).

- [ ] **Step 4: `docs/agent/pendientes.md`**

En la sección "Refactor Caja → Mi caja / Cajas", agregar una línea marcando que el refactor de IA/permisos (solo-lectura para Cajas) **quedó hecho**; los ítems de cierre forzado (`cerrada_por`) y aprobación por umbral **siguen pendientes**.

- [ ] **Step 5: Gate completo de cierre**

Run:
```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd ../frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```
Expected: todo verde. Si algo falla, la tarea no está terminada.

- [ ] **Step 6: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add docs
git commit -m "docs(caja): documentar refactor Mi caja / Cajas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification (resumen)

- **Backend unit**: `caja.controller.spec.ts` cubre 403 sin ninguno de los dos permisos, `verTodas=true` con `Cajas:Leer`, `verTodas=false` con solo `MiCaja:Leer`.
- **Backend e2e**: cajero (MiCaja) → 403 en `/caja/abiertas`; supervisor (Cajas:Leer) → 200; owner-only preservado en cierre.
- **Frontend**: build + typecheck:ratchet + design:check verdes; smoke en navegador (Task 8) confirma sidebar, read-only y gating.
- **Seed**: `MiCaja` + `Cajas` en `modulos_app`; admin obtiene `Cajas:Leer`; `MiCaja:Ver todas` NO existe.

## Decisions / Open questions (fuera de este plan)

- **Cierre forzado de caja ajena** (`cerrada_por`) y **aprobación por umbral** — diferidos en `docs/agent/pendientes.md`. Requieren cambio de modelo (`cajas.cerrada_por`) y romper owner-only bajo permiso; no entran en este refactor de IA/permisos.
- **Hallazgo §3** (`saldo_esperado` mezcla efectivo y tarjeta) — decisión de negocio independiente, sin resolver. Ver `docs/agent/investigaciones/2026-07-23-gestion-caja.md`.
