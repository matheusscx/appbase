# Gestión de cajas — Implementation Plan

> **Para workers agénticos:** SUB-SKILL requerida: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan checkboxes `- [ ]`.
> **Destino final del plan:** al ejecutar, copiar este archivo a `docs/superpowers/plans/2026-06-28-gestion-cajas.md` (convención del repo).
> **Spec fuente:** `docs/superpowers/specs/2026-06-28-gestion-cajas-design.md`.

**Goal:** Construir el ciclo de vida standalone de la caja física (abrir, consultar activa, movimientos manuales, cerrar con cuadre) más historial, como prerequisito de Ventas.

**Architecture:** Nuevo módulo NestJS `caja` (controller + service + entities + DTOs). La entity `Caja` se mueve desde `tenants/` al nuevo módulo; se agrega entity `MovimientoCaja`. Enforcement por permisos RBAC ya existentes (`@RequiresPermiso` + `PermisosGuard`), más un permiso nuevo `Ver todas` para la vista de supervisión. Frontend: página única `/caja` con máquina de estados + store Pinia `cajaStore`.

**Tech Stack:** NestJS, TypeORM, Decimal.js, Nuxt 4 + Vue 3 + @nuxt/ui v4, Pinia, PostgreSQL.

## Global Constraints (copiar de CLAUDE.md / patterns — aplican a TODAS las tareas)
- **Soft delete en todo:** `@DeleteDateColumn({ name: 'eliminado_el' })`; toda lectura filtra `eliminado_el IS NULL`.
- **`type: 'uuid'` explícito** en toda columna PK/FK de UUID (ADR-004).
- **`tenant_id` y `usuario_id` SIEMPRE del token** (`req.user`), nunca del body.
- **Decimal.js para todo monto** (`numeric` ↦ `string` en JS); nunca `number` nativo ni `+`/`*` sobre montos.
- **Frontend:** `useApiFetch` (no `$fetch` directo ni axios); campos monetarios = **string de punta a punta** con `UInput inputmode="decimal"` (nunca `type="number"`); errores del backend vía `e.data.message` en `useToast`.
- Tests junto al service (`*.service.spec.ts`), TDD. Antes de cerrar cada tarea backend: `cd backend && npm test`, `tsc` limpio, `npm run lint`.
- Las tablas `cajas` y `movimientos_caja` **ya existen** en `startup-pos.sql` y en la BD — NO se crean ni alteran tablas.

---

## Context

La gestión de cajas es prerequisito de Ventas/Pagos (ambos por construir). El esquema (`cajas`, `movimientos_caja`) y la caja virtual (auto-creada al crear el tenant en `tenants.service.ts`) ya existen, pero no hay módulo backend ni UI. Esta iteración entrega el ciclo de vida de la **caja física**: un cajero abre con saldo inicial, registra movimientos manuales (entrada/salida de efectivo fuera de ventas), y cierra ingresando el monto contado; el sistema calcula el cuadre (`saldo_esperado` y `diferencia`). La caja virtual queda excluida de estos flujos (es system-managed). Un supervisor con permiso `Ver todas` ve el historial de todas las cajas del tenant; los demás solo las suyas.

---

## Backend

### Task 1: Scaffolding del módulo `caja` + entities

**Files:**
- Create: `backend/src/modules/caja/entities/caja.entity.ts` (mover desde `tenants/entities/caja.entity.ts`)
- Create: `backend/src/modules/caja/entities/movimiento-caja.entity.ts`
- Create: `backend/src/modules/caja/caja.module.ts`
- Modify: `backend/src/app.module.ts` (registrar entity nueva + `CajaModule`)
- Modify: `backend/src/modules/tenants/tenants.module.ts`, `tenants.service.ts`, `tenants.service.spec.ts` (actualizar import de `Caja` a la nueva ruta)
- Delete: `backend/src/modules/tenants/entities/caja.entity.ts`

**Interfaces producidas:**
- `Caja` entity (campos ya existentes: `id, tenantId, usuarioId, monedaId, tipo, fechaApertura, fechaCierre, saldoInicial, saldoFinal, montoContado, diferencia, estado, comentario, ...`)
- `MovimientoCaja` entity: `id, cajaId, tipo ('entrada'|'salida'), concepto, monto, referencia, fecha, ventaId, pagoId, creadoEl, actualizadoEl, eliminadoEl`

- [ ] **Step 1:** Mover `caja.entity.ts` a `caja/entities/` (contenido idéntico; el archivo actual ya cumple ADR-004). Actualizar los 3 imports en `tenants/` para apuntar a `../caja/entities/caja.entity`.
- [ ] **Step 2:** Crear `movimiento-caja.entity.ts`:

```typescript
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn,
} from 'typeorm';

@Entity('movimientos_caja')
export class MovimientoCaja {
  @PrimaryGeneratedColumn('uuid', { name: 'movimiento_id' })
  id: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({ type: 'varchar' })
  tipo: string; // 'entrada' | 'salida'

  @Column({ type: 'varchar' })
  concepto: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  monto: string;

  @Column({ type: 'varchar', nullable: true })
  referencia: string | null;

  @Column({ name: 'fecha', type: 'timestamptz', default: () => 'NOW()' })
  fecha: Date;

  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null; // hook futuro (ventas) — sin uso ahora

  @Column({ name: 'pago_id', type: 'uuid', nullable: true })
  pagoId: string | null; // hook futuro (pagos) — sin uso ahora

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

- [ ] **Step 3:** Crear `caja.module.ts` (controller/service se agregan en tareas siguientes; arrancar con entities). Importar `RbacModule` para inyectar `RbacService` (verificar que `RbacModule` exporta `RbacService`; si no, agregar a `exports`).

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([Caja, MovimientoCaja]), RbacModule],
  controllers: [CajaController],
  providers: [CajaService],
  exports: [CajaService],
})
export class CajaModule {}
```

- [ ] **Step 4:** En `app.module.ts`: agregar `MovimientoCaja` al array `entities` del `TypeOrmModule.forRoot` (la `Caja` ya estaba) y `CajaModule` a `imports`.
- [ ] **Step 5:** Verificar compilación y que no se rompió tenants: `cd backend && npx tsc --noEmit && npm test -- tenants`. Esperado: PASS.
- [ ] **Step 6:** Commit: `feat(caja): scaffolding del módulo caja + entity MovimientoCaja`.

---

### Task 2: Seeder — permiso `Ver todas` para el módulo Caja

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts` (`seedPermisos`, `seedModuloAppPermisos`)

**Interfaces producidas:** permiso global `Ver todas` (`550e8400-e29b-41d4-a716-446655440016`) vinculado al módulo Caja (`modulo_app_permiso` id `...440038`).

- [ ] **Step 1:** En `seedPermisos`, agregar al array: `{ permisoId: '550e8400-e29b-41d4-a716-446655440016', nombre: 'Ver todas' }`.
- [ ] **Step 2:** En `seedModuloAppPermisos`, agregar constante `const VER_TODAS = '550e8400-e29b-41d4-a716-446655440016';` y la entrada:

```typescript
{
  moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440038',
  moduloAppId: CAJA,
  permisoId: VER_TODAS,
},
```

- [ ] **Step 3:** Reiniciar backend (`docker-compose up` o `npm run start:dev`) y verificar en logs que el seeder corre idempotente sin error. El rol `admin` (es_fijo) hereda este permiso automáticamente vía short-circuit en `RbacService.userHasPermiso`.
- [ ] **Step 4:** Commit: `feat(caja): permiso RBAC "Ver todas" para supervisión de cajas`.

---

### Task 3: Abrir caja + consultar caja activa

**Files:**
- Create: `backend/src/modules/caja/dto/abrir-caja.dto.ts`
- Create: `backend/src/modules/caja/caja.service.ts` (+ `caja.service.spec.ts`)
- Create: `backend/src/modules/caja/caja.controller.ts`

**Interfaces producidas:**
- `CajaService.findActiva(tenantId, usuarioId): Promise<Caja | null>`
- `CajaService.abrir(tenantId, usuarioId, dto: AbrirCajaDto): Promise<Caja>`
- Rutas: `GET /caja/activa`, `POST /caja/abrir`.

- [ ] **Step 1:** DTO:

```typescript
import { IsNumberString, IsOptional, IsString } from 'class-validator';
export class AbrirCajaDto {
  @IsNumberString() saldoInicial: string;
  @IsOptional() @IsString() comentario?: string;
}
```

- [ ] **Step 2:** Test (failing) en `caja.service.spec.ts`: `abrir` crea caja `tipo='fisica'`, `estado='abierta'`, con `usuarioId`/`tenantId` del token; y `abrir` lanza `ConflictException` si ya existe una caja física abierta para ese tenant+usuario (`tipo='fisica'`, `estado='abierta'`, `eliminadoEl IS NULL`). Mock del repo `Caja`.
- [ ] **Step 3:** Run test → FAIL. `cd backend && npm test -- caja`.
- [ ] **Step 4:** Implementar `findActiva` (busca `tipo='fisica'`, `estado='abierta'`) y `abrir` (valida no-duplicado → `ConflictException('Ya tienes una caja abierta')`; crea y guarda). La caja virtual nunca cumple `tipo='fisica'`, así que queda excluida.
- [ ] **Step 5:** Run test → PASS.
- [ ] **Step 6:** Controller con guards y permisos (patrón de `test.controller.ts`):

```typescript
@ApiTags('caja')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('caja')
export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  @Get('activa')
  @RequiresPermiso('Caja', 'Leer')
  activa(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.cajaService.findActiva(u.tenantId!, u.id);
  }

  @Post('abrir')
  @RequiresPermiso('Caja', 'Crear')
  abrir(@Req() req: Request, @Body() dto: AbrirCajaDto) {
    const u = req.user as JwtUser;
    return this.cajaService.abrir(u.tenantId!, u.id, dto);
  }
}
```

- [ ] **Step 7:** `tsc` + lint limpios. Commit: `feat(caja): abrir caja física y consultar caja activa`.

---

### Task 4: Movimientos manuales (entrada/salida) con bloqueo de saldo negativo

**Files:**
- Create: `backend/src/modules/caja/dto/crear-movimiento.dto.ts`
- Modify: `caja.service.ts` (+ spec), `caja.controller.ts`

**Interfaces consumidas:** `Caja`, `MovimientoCaja`, `findActiva`.
**Interfaces producidas:**
- `CajaService.calcularSaldoEsperado(cajaId): Promise<string>` (Decimal: `saldoInicial + Σ entradas − Σ salidas`)
- `CajaService.registrarMovimiento(tenantId, usuarioId, cajaId, dto): Promise<MovimientoCaja>`
- `CajaService.listarMovimientos(tenantId, usuarioId, cajaId): Promise<MovimientoCaja[]>`
- Rutas: `POST /caja/:id/movimientos`, `GET /caja/:id/movimientos`.

- [ ] **Step 1:** DTO:

```typescript
import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
export class CrearMovimientoDto {
  @IsIn(['entrada', 'salida']) tipo: string;
  @IsString() concepto: string;
  @IsNumberString() monto: string;
  @IsOptional() @IsString() referencia?: string;
}
```

- [ ] **Step 2:** Tests (failing): (a) entrada suma al saldo; (b) `salida` con monto > saldo esperado → `UnprocessableEntityException`; (c) movimiento sobre caja cerrada → `ConflictException`; (d) caja de otro usuario/tenant → `ForbiddenException`. Usar Decimal.js en los asserts del saldo. Mock `dataSource.transaction` como `(cb) => cb(managerMock)`.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implementar dentro de `dataSource.transaction`: cargar caja (validar pertenencia tenant+usuario y `estado='abierta'`), calcular `saldoEsperado` con Decimal.js, si `tipo='salida'` y `Decimal(saldoEsperado).minus(monto).lt(0)` → `UnprocessableEntityException('Saldo insuficiente en caja')`, crear `MovimientoCaja`. `calcularSaldoEsperado` agrega con SQL (`SUM` filtrando `eliminado_el IS NULL`) o reduce en JS con Decimal.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Controller: `POST /caja/:id/movimientos` → `@RequiresPermiso('Caja','Crear')`; `GET /caja/:id/movimientos` → `@RequiresPermiso('Caja','Leer')`. Pasar `u.tenantId`, `u.id`, `param id`.
- [ ] **Step 7:** `tsc` + lint. Commit: `feat(caja): movimientos manuales con validación de saldo`.

---

### Task 5: Cerrar caja con cuadre

**Files:**
- Create: `backend/src/modules/caja/dto/cerrar-caja.dto.ts`
- Modify: `caja.service.ts` (+ spec), `caja.controller.ts`

**Interfaces producidas:** `CajaService.cerrar(tenantId, usuarioId, cajaId, dto): Promise<Caja>`; ruta `POST /caja/:id/cerrar`.

- [ ] **Step 1:** DTO: `{ @IsNumberString montoContado: string; @IsOptional @IsString comentario?: string }`.
- [ ] **Step 2:** Tests (failing): (a) cuadre exacto → `diferencia = '0'`; (b) faltante → `diferencia` negativa; (c) sobrante → positiva; persiste `saldoFinal = saldoEsperado`, `estado='cerrada'`, `fechaCierre`; (d) cerrar caja ya cerrada → `ConflictException`; (e) caja ajena → `ForbiddenException`. Cálculos con Decimal.js.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implementar en transacción: validar pertenencia + `estado='abierta'`; `saldoEsperado = calcularSaldoEsperado()`; `diferencia = Decimal(montoContado).minus(saldoEsperado)`; set `saldoFinal`, `montoContado`, `diferencia`, `fechaCierre = new Date()`, `estado='cerrada'`, `comentario`; guardar.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Controller: `POST /caja/:id/cerrar` → `@RequiresPermiso('Caja','Actualizar')`.
- [ ] **Step 7:** `tsc` + lint. Commit: `feat(caja): cierre de caja con cálculo de cuadre`.

---

### Task 6: Historial de cajas (propias / todas con permiso)

**Files:** Modify `caja.service.ts` (+ spec), `caja.controller.ts`. Inyectar `RbacService` en el service.

**Interfaces producidas:**
- `CajaService.historial(tenantId, usuarioId, todas: boolean): Promise<Caja[]>`
- `CajaService.findOne(tenantId, usuarioId, cajaId): Promise<Caja>`
- Rutas: `GET /caja` (query `?todas=true`), `GET /caja/:id`.

- [ ] **Step 1:** Tests (failing): (a) `historial(..., todas=false)` devuelve solo cajas del usuario (excluye virtual o la incluye? → incluir solo `tipo='fisica'`); (b) `todas=true` con permiso `Ver todas` → todas las del tenant; (c) `todas=true` sin permiso → solo las propias (degradación silenciosa). Mock `RbacService.userHasPermiso`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementar: en controller, si `todas==='true'`, llamar `rbacService.userHasPermiso(u.id, u.tenantId, 'Caja', 'Ver todas')`; pasar el booleano efectivo al service. Service filtra por `tenantId` + (si no todas) `usuarioId`, `tipo='fisica'`, ordena por `fechaApertura DESC`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Controller: `GET /caja` y `GET /caja/:id` → `@RequiresPermiso('Caja','Leer')`. `findOne` valida que la caja sea del usuario o que tenga `Ver todas`.
- [ ] **Step 6:** `tsc` + lint. Commit: `feat(caja): historial de cajas con vista de supervisión`.

---

## Frontend

### Task 7: Store `cajaStore`

**Files:** Create `frontend/app/stores/caja.ts`.

**Interfaces producidas:** `useCajaStore()` con `activa: Ref<Caja|null>`, `historial: Ref<Caja[]>`, y acciones `cargarActiva()`, `abrir(payload)`, `registrarMovimiento(cajaId, payload)`, `cargarMovimientos(cajaId)`, `cerrar(cajaId, payload)`, `cargarHistorial(todas)`.

- [ ] **Step 1:** Definir interfaces TS (`Caja`, `MovimientoCaja`) y el store con `defineStore('caja', () => {...})`, usando `useApiFetch` contra `useRuntimeConfig().public.apiUrl`. Montos como **string**. Re-`cargarActiva()`/`cargarMovimientos()` tras cada mutación (no optimista — el saldo lo calcula el backend). Manejo de error vía `e.data.message` → retornar/propagar para que la página haga el toast.
- [ ] **Step 2:** Verificación: `cd frontend && npx nuxi typecheck` (o `npm run build`) sin errores de tipo en el store.
- [ ] **Step 3:** Commit: `feat(caja): store Pinia para gestión de caja`.

---

### Task 8: Página `/caja` — máquina de estados

**Files:** Create `frontend/app/pages/caja/index.vue`; componentes en `frontend/app/components/caja/`: `CajaAperturaForm.vue`, `CajaActivaDashboard.vue`, `CajaMovimientoModal.vue`, `CajaCierreModal.vue`.

- [ ] **Step 1:** `pages/caja/index.vue` con `definePageMeta({ middleware: 'auth', layout: 'dashboard' })`. En `onMounted` → `cajaStore.cargarActiva()`. Render condicional: `loading` → skeleton; `!activa` → `<CajaAperturaForm>`; `activa` → `<CajaActivaDashboard>`.
- [ ] **Step 2:** `CajaAperturaForm`: `UCard` + `UFormField`/`UInput inputmode="decimal"` para `saldoInicial` (string) + comentario; botón "Abrir caja" → `cajaStore.abrir(...)` → toast éxito/error.
- [ ] **Step 3:** `CajaActivaDashboard`: muestra saldo inicial, entradas, salidas, saldo esperado (formateados desde strings con Decimal.js/Intl), lista de movimientos; botones `[+ Movimiento]` (abre `CajaMovimientoModal`) y `[Cerrar caja]` (abre `CajaCierreModal`).
- [ ] **Step 4:** `CajaMovimientoModal`: `UModal` con `tipo` (entrada/salida via `USelect`/`URadioGroup`), `concepto`, `monto` (inputmode decimal), `referencia`; submit → `registrarMovimiento` → re-cargar.
- [ ] **Step 5:** `CajaCierreModal`: input `montoContado` (decimal); muestra en vivo el **cuadre previsto** (`montoContado − saldoEsperado`) antes de confirmar; submit → `cerrar` → toast.
- [ ] **Step 6:** Verificación manual: login como cajero/admin → `/caja` → abrir → +entrada → +salida (probar bloqueo de salida > saldo) → cerrar con y sin diferencia.
- [ ] **Step 7:** Commit: `feat(caja): página /caja con apertura, movimientos y cierre`.

---

### Task 9: Navegación + historial UI

**Files:** Modify `frontend/app/layouts/dashboard.vue`; Create `frontend/app/components/caja/CajaHistorial.vue` (sección/tab en `pages/caja/index.vue`).

- [ ] **Step 1:** Agregar item "Caja" al computed `items` de `dashboard.vue`: `{ label: 'Caja', icon: 'i-lucide-banknote', to: '/caja' }` (gatear con `permissionsStore.can('Caja','Leer') || permissionsStore.esAdmin` si se quiere ocultar a roles sin acceso).
- [ ] **Step 2:** `CajaHistorial`: tabla de cajas cerradas (fecha, saldo inicial, saldo final, diferencia con color según signo). Toggle "Ver todas" visible solo si `permissionsStore.esAdmin || permissionsStore.can('Caja','Ver todas')`; al activarlo → `cajaStore.cargarHistorial(true)`.
- [ ] **Step 3:** Integrar `CajaHistorial` como tab/sección en `pages/caja/index.vue`.
- [ ] **Step 4:** Verificación manual: como admin ver "Ver todas"; como cajero sin permiso, el toggle no aparece y solo ve sus cajas.
- [ ] **Step 5:** Commit: `feat(caja): navegación e historial de cajas`.

---

## Docs (Task 10 — mismo flujo)

**Files:** Create `docs/features/gestion-cajas.md` (desde `docs/features/TEMPLATE.md`); Modify `docs/README.md`, `docs/MIGRACION-FUNCIONALIDADES.md`, `CLAUDE.md` (tabla "Estado actual": marcar "Gestión de cajas" ✅ con fecha 2026-06-28); actualizar `docs/patterns/backend.md` §4 si el guard de permisos pasa a ser el estándar para features nuevas (no solo config).

- [ ] **Step 1:** Escribir `docs/features/gestion-cajas.md` (endpoints, reglas de cuadre, permiso `Ver todas`, exclusión de caja virtual) + link en `docs/README.md`.
- [ ] **Step 2:** Marcar ✅ en `MIGRACION-FUNCIONALIDADES.md` y en la tabla de `CLAUDE.md`.
- [ ] **Step 3:** Commit: `docs: feature gestión de cajas`.

---

## Verification (end-to-end)

1. **Backend unit:** `cd backend && npm test -- caja` → todos los specs de cuadre, bloqueo de saldo, una-sola-caja, exclusión virtual y ver_todas en verde.
2. **Tipos/lint:** `cd backend && npx tsc --noEmit && npm run lint`.
3. **Arranque:** `docker-compose up` — seeder corre idempotente; el permiso `Ver todas` aparece para Caja.
4. **Flujo manual (frontend):** login → `/caja` → abrir (saldo inicial) → registrar entrada y salida → intentar salida > saldo (debe dar toast "Saldo insuficiente") → cerrar con monto contado → ver diferencia; recargar y confirmar la caja en el historial. Como admin, activar "Ver todas" y ver cajas de otros usuarios; como cajero sin permiso, confirmar que solo ve las propias y no aparece el toggle.
5. **(Opcional) E2E:** test e2e del flujo abrir→movimiento→cerrar en `backend/test/`.

## Decisiones (del spec, ya aprobadas)
- Entity `Caja` se mueve a módulo `caja`.
- `salida` que deja saldo negativo se bloquea (422).
- Visibilidad de supervisión vía permiso dedicado `Ver todas` (no reuso de rol admin); admin lo hereda por short-circuit es_fijo.
- Permisos por ruta: Leer (lecturas), Crear (abrir/movimiento), Actualizar (cerrar), Ver todas (historial global).
