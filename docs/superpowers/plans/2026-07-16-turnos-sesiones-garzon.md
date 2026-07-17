# Turnos y Sesiones de Garzón Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir administrar turnos referenciales y registrar sesiones de trabajo de garzones (iniciar/cerrar con PIN + cierre admin), exigiendo sesión abierta al abrir/cerrar cuentas de mesa.

**Architecture:** Nuevo módulo NestJS `turnos` con entidades `Turno` y `SesionGarzon`. `GarzonesService.resolverGarzonPorPin` se reutiliza para flujos PIN. `SalonesService` consulta `SesionesGarzonService.assertSesionAbierta` antes de abrir/cerrar cuenta. Frontend: CRUD de turnos, admin de sesiones, y acciones Entrar/Salir de turno en `/salones`. RBAC reutiliza módulo `Salones`.

**Tech Stack:** NestJS + TypeORM + PostgreSQL, Decimal.js no aplica (sin montos), Nuxt 4 + Nuxt UI, `useApiFetch`, Jest unit tests.

**Spec:** `docs/superpowers/specs/2026-07-16-turnos-sesiones-garzon-design.md`

## Global Constraints

- Soft delete en todo (`eliminado_el`); lecturas filtran `IS NULL`.
- Toda columna PK/FK UUID declara `type: 'uuid'` explícito.
- `tenant_id` siempre del JWT, nunca del body.
- PIN incorrecto / errores operativos → `400 Bad Request` (nunca `401`).
- Máximo una sesión `abierta` por `(tenant_id, garzon_id)`.
- Horarios de turno son referenciales (no bloquean entrada/salida).
- Tras POST/PATCH/DELETE el front actualiza refs locales; sin re-fetch de lista.
- Trabajar y commitear en `main` (etapa de desarrollo).
- Seed IDs fijos desde `550e8400-e29b-41d4-a716-446655440277` (siguiente libre tras `...440276`).

---

## File map

**Create**

| Path | Responsibility |
|---|---|
| `backend/src/modules/turnos/entities/turno.entity.ts` | Catálogo de turnos |
| `backend/src/modules/turnos/entities/sesion-garzon.entity.ts` | Sesiones de trabajo |
| `backend/src/modules/turnos/dto/create-turno.dto.ts` | Body crear turno |
| `backend/src/modules/turnos/dto/update-turno.dto.ts` | Body patch turno |
| `backend/src/modules/turnos/dto/iniciar-sesion.dto.ts` | `{ pin, turnoId }` |
| `backend/src/modules/turnos/dto/pin.dto.ts` | `{ pin }` para cerrar/activa |
| `backend/src/modules/turnos/dto/query-sesiones.dto.ts` | Historial paginado + filtros |
| `backend/src/modules/turnos/turnos.service.ts` | CRUD turnos |
| `backend/src/modules/turnos/turnos.service.spec.ts` | Tests turnos |
| `backend/src/modules/turnos/turnos.controller.ts` | `/turnos` |
| `backend/src/modules/turnos/sesiones-garzon.service.ts` | Ciclo de vida sesiones |
| `backend/src/modules/turnos/sesiones-garzon.service.spec.ts` | Tests sesiones |
| `backend/src/modules/turnos/sesiones-garzon.controller.ts` | `/sesiones-garzon` |
| `backend/src/modules/turnos/turnos.module.ts` | Module + exports |
| `frontend/app/composables/useTurnos.ts` | API turnos |
| `frontend/app/composables/useSesionesGarzon.ts` | API sesiones |
| `frontend/app/pages/configuracion/turnos.vue` | CRUD turnos |
| `frontend/app/pages/configuracion/sesiones-garzon.vue` | Abiertas + historial + forzar cierre |
| `docs/features/turnos-garzones.md` | Feature doc |

**Modify**

| Path | Change |
|---|---|
| `backend/src/app.module.ts` | Registrar entities + `TurnosModule` |
| `backend/src/modules/salones/salones.module.ts` | Import `TurnosModule` |
| `backend/src/modules/salones/salones.service.ts` | Exigir sesión abierta en abrir/cerrar cuenta |
| `backend/src/modules/salones/salones.service.spec.ts` | Mock `assertSesionAbierta` + casos sin sesión |
| `backend/src/modules/seeder/seeder.module.ts` | `forFeature([Turno])` |
| `backend/src/modules/seeder/seeder.service.ts` | `seedTurnos()` |
| `frontend/app/pages/configuracion.vue` | Nav Turnos + Sesiones |
| `frontend/app/pages/salones/index.vue` | Entrar/Salir de turno |
| `startup-pos.sql` | Tablas `turnos`, `sesiones_garzon` + índice único parcial |
| `docs/ESTADO.md` | Fila ✅ |
| `docs/README.md` | Link feature |
| `docs/features/garzones.md` | Scope: turnos ya no “futuro” |

---

### Task 1: Entidad + CRUD de turnos (backend)

**Files:**
- Create: `backend/src/modules/turnos/entities/turno.entity.ts`
- Create: `backend/src/modules/turnos/dto/create-turno.dto.ts`
- Create: `backend/src/modules/turnos/dto/update-turno.dto.ts`
- Create: `backend/src/modules/turnos/turnos.service.ts`
- Create: `backend/src/modules/turnos/turnos.service.spec.ts`
- Create: `backend/src/modules/turnos/turnos.controller.ts`
- Create: `backend/src/modules/turnos/turnos.module.ts` (parcial; se completa en Task 2)
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: patrón `GarzonesService` / `GarzonesController`
- Produces:
  - `TurnosService.listar(tenantId): Promise<TurnoPublico[]>`
  - `TurnosService.crear(tenantId, dto): Promise<TurnoPublico>`
  - `TurnosService.actualizar(tenantId, id, dto): Promise<TurnoPublico>`
  - `TurnosService.eliminar(tenantId, id): Promise<void>`
  - `TurnosService.getActivoOrThrow(tenantId, id): Promise<Turno>`
  - `TurnosService.assertSinSesionesAbiertas(tenantId, turnoId): Promise<void>` (stub o query; implementación completa en Task 2 si necesita `SesionGarzon` — en esta task, inyectar repo de sesión opcional o defer check a Task 2)

- [ ] **Step 1: Write failing tests for TurnosService**

Crear `turnos.service.spec.ts` con mocks de `Repository<Turno>` via `getRepositoryToken(Turno)`.

Casos mínimos:

```typescript
describe('TurnosService', () => {
  it('crea un turno con horaInicio/horaFin', async () => { /* ... */ });
  it('rechaza nombre duplicado en el tenant', async () => { /* ... */ });
  it('listar ordena por nombre ASC y no expone eliminados (repo soft-delete)', async () => { /* ... */ });
  it('actualizar cambia nombre/activo/horarios', async () => { /* ... */ });
  it('eliminar hace softDelete', async () => { /* ... */ });
  it('getActivoOrThrow lanza 400 si inactivo o inexistente', async () => { /* ... */ });
});
```

Para duplicados: `findOne({ where: { tenantId, nombre } })` → si existe y no es el mismo id → `ConflictException('Ya existe un turno con ese nombre')`.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npx jest turnos.service.spec.ts --no-coverage
```

Expected: FAIL (module/service not found).

- [ ] **Step 3: Implement entity, DTOs, service, controller, module**

`turno.entity.ts`:

```typescript
@Entity('turnos')
export class Turno {
  @PrimaryGeneratedColumn('uuid', { name: 'turno_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  /** Referencial HH:mm — no bloquea operación. */
  @Column({ name: 'hora_inicio', type: 'varchar', length: 5 })
  horaInicio: string;

  @Column({ name: 'hora_fin', type: 'varchar', length: 5 })
  horaFin: string;

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

DTOs — validar hora con:

```typescript
@Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'horaInicio debe ser HH:mm' })
horaInicio: string;
```

Mismo para `horaFin`. `UpdateTurnoDto` con `@IsOptional()` en todos.

`TurnosController` (`/turnos`):

| Method | Path | Permiso |
|---|---|---|
| GET | `/` | `Salones:Leer` |
| POST | `/` | `Salones:Crear` |
| PATCH | `/:id` | `Salones:Actualizar` |
| DELETE | `/:id` | `Salones:Eliminar` |

Guards: `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`.

Respuesta pública: `{ id, nombre, horaInicio, horaFin, activo, creadoEl, actualizadoEl }`.

En `app.module.ts`: import `Turno` en `entities: [...]` y `TurnosModule` en `imports`.

**Nota Task 1:** el bloqueo “no desactivar/eliminar si hay sesiones abiertas” se implementa en Task 2 cuando exista `SesionGarzon`. Por ahora `eliminar`/`actualizar({ activo: false })` pueden soft-delete/desactivar sin ese check; Task 2 lo agrega.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npx jest turnos.service.spec.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/turnos backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(turnos): CRUD de catálogo de turnos por tenant

EOF
)"
```

---

### Task 2: Sesiones de garzón (backend)

**Files:**
- Create: `backend/src/modules/turnos/entities/sesion-garzon.entity.ts`
- Create: `backend/src/modules/turnos/dto/iniciar-sesion.dto.ts`
- Create: `backend/src/modules/turnos/dto/pin.dto.ts`
- Create: `backend/src/modules/turnos/dto/query-sesiones.dto.ts`
- Create: `backend/src/modules/turnos/sesiones-garzon.service.ts`
- Create: `backend/src/modules/turnos/sesiones-garzon.service.spec.ts`
- Create: `backend/src/modules/turnos/sesiones-garzon.controller.ts`
- Modify: `backend/src/modules/turnos/turnos.module.ts`
- Modify: `backend/src/modules/turnos/turnos.service.ts` (check sesiones abiertas al desactivar/eliminar)
- Modify: `backend/src/app.module.ts` (entity `SesionGarzon`)

**Interfaces:**
- Consumes: `GarzonesService.resolverGarzonPorPin`, `TurnosService.getActivoOrThrow`
- Produces:
  - `SesionesGarzonService.iniciar(tenantId, { pin, turnoId }): Promise<SesionPublica>`
  - `SesionesGarzonService.cerrarPorPin(tenantId, pin): Promise<SesionPublica>`
  - `SesionesGarzonService.activaPorPin(tenantId, pin): Promise<SesionPublica | null>`
  - `SesionesGarzonService.listarAbiertas(tenantId): Promise<SesionListaItem[]>`
  - `SesionesGarzonService.historial(tenantId, query): Promise<PaginatedResponse<SesionListaItem>>`
  - `SesionesGarzonService.cerrarAdmin(tenantId, sesionId, usuarioId): Promise<SesionPublica>`
  - `SesionesGarzonService.assertSesionAbierta(tenantId, garzonId): Promise<void>`

- [x] **Step 1: Write failing tests**

```typescript
describe('SesionesGarzonService', () => {
  it('iniciar abre sesión con pin + turno activo', async () => {});
  it('iniciar rechaza si ya hay sesión abierta', async () => {});
  it('iniciar rechaza turno inactivo', async () => {});
  it('cerrarPorPin cierra y fija finEl', async () => {});
  it('cerrarPorPin sin sesión abierta → 400', async () => {});
  it('cerrarAdmin registra cerradaPorUsuarioId y origenCierre=admin', async () => {});
  it('assertSesionAbierta lanza 400 si no hay abierta', async () => {});
  it('assertSesionAbierta resuelve si hay abierta', async () => {});
});
```

Mensajes exactos (spec):

- `'El garzón ya tiene una sesión abierta'`
- `'El garzón no tiene una sesión abierta'`
- `'El garzón no tiene una sesión de trabajo abierta'` (solo en `assertSesionAbierta`, usado por Salones)
- `'Turno inválido o inactivo'` (vía `getActivoOrThrow`)

- [x] **Step 2: Run — expect FAIL**

```bash
cd backend && npx jest sesiones-garzon.service.spec.ts --no-coverage
```

- [x] **Step 3: Implement entity + service + controller**

`sesion-garzon.entity.ts`:

```typescript
export enum EstadoSesionGarzon {
  ABIERTA = 'abierta',
  CERRADA = 'cerrada',
}

export enum OrigenCierreSesion {
  PIN = 'pin',
  ADMIN = 'admin',
}

@Entity('sesiones_garzon')
@Index('uq_sesion_garzon_abierta', ['tenantId', 'garzonId'], {
  unique: true,
  where: `"estado" = 'abierta' AND "eliminado_el" IS NULL`,
})
export class SesionGarzon {
  @PrimaryGeneratedColumn('uuid', { name: 'sesion_garzon_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({ name: 'turno_id', type: 'uuid' })
  turnoId: string;

  @Column({ name: 'inicio_el', type: 'timestamptz' })
  inicioEl: Date;

  @Column({ name: 'fin_el', type: 'timestamptz', nullable: true })
  finEl: Date | null;

  @Column({ type: 'text', default: EstadoSesionGarzon.ABIERTA })
  estado: EstadoSesionGarzon;

  @Column({ name: 'origen_cierre', type: 'text', nullable: true })
  origenCierre: OrigenCierreSesion | null;

  @Column({ name: 'cerrada_por_usuario_id', type: 'uuid', nullable: true })
  cerradaPorUsuarioId: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

`iniciar`:

1. `garzon = await garzones.resolverGarzonPorPin(tenantId, pin)`
2. `turno = await turnos.getActivoOrThrow(tenantId, turnoId)`
3. Si existe sesión `estado=abierta` del garzón → `BadRequestException`
4. `save({ tenantId, garzonId, turnoId, inicioEl: new Date(), estado: abierta, finEl: null, origenCierre: null })`
5. Devolver DTO público con nombres de garzón/turno (join o lookup)

`cerrarPorPin` / `cerrarAdmin`: set `finEl = now()`, `estado = cerrada`, `origenCierre`, y en admin `cerradaPorUsuarioId`.

`assertSesionAbierta`:

```typescript
async assertSesionAbierta(tenantId: string, garzonId: string): Promise<void> {
  const abierta = await this.sesionRepo.findOne({
    where: { tenantId, garzonId, estado: EstadoSesionGarzon.ABIERTA },
  });
  if (!abierta) {
    throw new BadRequestException(
      'El garzón no tiene una sesión de trabajo abierta',
    );
  }
}
```

`historial`: extender `PaginationQueryDto`; filtros opcionales `garzonId`, `turnoId`, `estado`, `desde`, `hasta` (ISO date). SQL raw o QueryBuilder con `COUNT` + `LIMIT/OFFSET`. Respuesta `PaginatedResponse`. Incluir `garzonNombre`, `turnoNombre` en items.

Controller `/sesiones-garzon` — **rutas estáticas antes de `/:id`**:

| Method | Path | Permiso | Body |
|---|---|---|---|
| POST | `/iniciar` | `Salones:Operar` | `{ pin, turnoId }` |
| POST | `/cerrar` | `Salones:Operar` | `{ pin }` |
| POST | `/activa` | `Salones:Operar` | `{ pin }` |
| GET | `/abiertas` | `Salones:Leer` | — |
| GET | `/` | `Salones:Leer` | query filtros |
| POST | `/:id/cerrar` | `Salones:Actualizar` | — (usuarioId del JWT) |

`TurnosModule`:

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([Turno, SesionGarzon]),
    GarzonesModule,
  ],
  controllers: [TurnosController, SesionesGarzonController],
  providers: [TurnosService, SesionesGarzonService],
  exports: [TurnosService, SesionesGarzonService],
})
export class TurnosModule {}
```

En `TurnosService.actualizar` / `eliminar`: si `activo === false` o soft-delete, contar sesiones abiertas del `turnoId`; si > 0 → `BadRequestException('No se puede modificar un turno con sesiones abiertas')`. Añadir tests en `turnos.service.spec.ts`.

- [x] **Step 4: Run tests — expect PASS**

```bash
cd backend && npx jest turnos.service.spec.ts sesiones-garzon.service.spec.ts --no-coverage
```

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/turnos backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(turnos): sesiones de garzón con PIN y cierre admin

EOF
)"
```

---

### Task 3: Exigir sesión abierta al abrir/cerrar cuenta

**Files:**
- Modify: `backend/src/modules/salones/salones.module.ts`
- Modify: `backend/src/modules/salones/salones.service.ts` (`abrirCuenta` ~L309, `cerrarCuenta` ~L552)
- Modify: `backend/src/modules/salones/salones.service.spec.ts`

**Interfaces:**
- Consumes: `SesionesGarzonService.assertSesionAbierta(tenantId, garzonId)`
- Produces: mismos contratos de `abrirCuenta` / `cerrarCuenta`; fallo nuevo con mensaje de sesión

- [ ] **Step 1: Write failing tests**

En `salones.service.spec.ts`:

1. Mock `SesionesGarzonService` con `assertSesionAbierta: jest.fn().mockResolvedValue(undefined)`.
2. Proveer `{ provide: SesionesGarzonService, useValue: sesiones }`.
3. Nuevo test: si `assertSesionAbierta` rechaza, `abrirCuenta` propaga el 400.
4. Nuevo test: igual para `cerrarCuenta`.
5. Happy paths existentes deben seguir llamando `assertSesionAbierta` tras resolver PIN.

```typescript
it('abrirCuenta rechaza si el garzón no tiene sesión abierta', async () => {
  sesiones.assertSesionAbierta.mockRejectedValue(
    new BadRequestException('El garzón no tiene una sesión de trabajo abierta'),
  );
  await expect(service.abrirCuenta(TENANT, MESA, { pin: PIN })).rejects.toThrow(
    BadRequestException,
  );
});
```

- [ ] **Step 2: Run — expect FAIL** (mock no inyectado / método no llamado)

```bash
cd backend && npx jest salones.service.spec.ts --no-coverage
```

- [ ] **Step 3: Wire module + service**

`salones.module.ts`: `imports: [..., TurnosModule]`.

En `abrirCuenta` y `cerrarCuenta`, inmediatamente después de `resolverGarzonPorPin`:

```typescript
await this.sesionesGarzonService.assertSesionAbierta(tenantId, garzon.id);
```

Inyectar `SesionesGarzonService` en el constructor de `SalonesService`.

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npx jest salones.service.spec.ts turnos.service.spec.ts sesiones-garzon.service.spec.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/salones
git commit -m "$(cat <<'EOF'
feat(salones): exigir sesión de trabajo abierta al operar cuentas

EOF
)"
```

---

### Task 4: Seed de turnos + esquema SQL

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Modify: `backend/src/modules/seeder/seeder.module.ts`
- Modify: `startup-pos.sql` (después de tabla `garzones`)

- [ ] **Step 1: Add `seedTurnos()`**

IDs:

- Mañana `...440277` — `08:00`–`15:00`
- Tarde `...440278` — `15:00`–`22:00`
- Noche `...440279` — `22:00`–`08:00`

Tenant Paris `...440007`. Idempotente (`findOne` por id). Llamar desde `onApplicationBootstrap` / `run()` **después** de `seedGarzones`.

Registrar `Turno` en `seeder.module.ts` `TypeOrmModule.forFeature`.

- [ ] **Step 2: Update `startup-pos.sql`**

```sql
CREATE TABLE turnos (
    turno_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    nombre VARCHAR(100) NOT NULL,
    hora_inicio VARCHAR(5) NOT NULL, -- HH:mm referencial
    hora_fin VARCHAR(5) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_turnos_tenant ON turnos (tenant_id);

CREATE TABLE sesiones_garzon (
    sesion_garzon_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    garzon_id UUID NOT NULL REFERENCES garzones(garzon_id),
    turno_id UUID NOT NULL REFERENCES turnos(turno_id),
    inicio_el TIMESTAMPTZ NOT NULL,
    fin_el TIMESTAMPTZ,
    estado TEXT NOT NULL DEFAULT 'abierta', -- abierta|cerrada
    origen_cierre TEXT, -- pin|admin
    cerrada_por_usuario_id UUID REFERENCES usuarios(usuario_id),
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_sesiones_garzon_tenant ON sesiones_garzon (tenant_id);
CREATE INDEX idx_sesiones_garzon_garzon ON sesiones_garzon (garzon_id);
CREATE UNIQUE INDEX uq_sesion_garzon_abierta
  ON sesiones_garzon (tenant_id, garzon_id)
  WHERE estado = 'abierta' AND eliminado_el IS NULL;
```

- [ ] **Step 3: Verify seeder boots** (stack ya corriendo o `docker-compose up` / restart backend) — logs sin error; query replica:

```sql
SELECT nombre, hora_inicio, hora_fin FROM turnos WHERE eliminado_el IS NULL ORDER BY nombre;
```

Expected: Mañana, Noche, Tarde.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/seeder startup-pos.sql
git commit -m "$(cat <<'EOF'
chore: seed turnos demo y esquema SQL de sesiones

EOF
)"
```

---

### Task 5: Frontend — composables + CRUD turnos

**Files:**
- Create: `frontend/app/composables/useTurnos.ts`
- Create: `frontend/app/pages/configuracion/turnos.vue`
- Modify: `frontend/app/pages/configuracion.vue` (nav)

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /turnos`
- Produces: `useTurnos().listar|crear|actualizar|eliminar`

- [ ] **Step 1: Composable**

```typescript
export interface Turno {
  id: string
  nombre: string
  horaInicio: string
  horaFin: string
  activo: boolean
  creadoEl: string
  actualizadoEl: string
}

export function useTurnos() {
  const apiUrl = useRuntimeConfig().public.apiUrl
  const listar = () => useApiFetch<Turno[]>(`${apiUrl}/turnos`)
  const crear = (body: { nombre: string, horaInicio: string, horaFin: string, activo?: boolean }) =>
    useApiFetch<Turno>(`${apiUrl}/turnos`, { method: 'POST', body })
  const actualizar = (id: string, body: Partial<{ nombre: string, horaInicio: string, horaFin: string, activo: boolean }>) =>
    useApiFetch<Turno>(`${apiUrl}/turnos/${id}`, { method: 'PATCH', body })
  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/turnos/${id}`, { method: 'DELETE' })
  return { listar, crear, actualizar, eliminar }
}
```

- [ ] **Step 2: Página `turnos.vue`**

Copiar estructura de `configuracion/garzones.vue`:

- `CrudPageHeader` + `CrudTable` + `AppDrawer` crear/editar + `CrudModal` eliminar.
- Campos: nombre, hora inicio, hora fin (`UInput` texto `placeholder="08:00"`), activo (`USwitch`).
- `upsertLocal` / `removeLocal` sin re-fetch tras mutación.

- [ ] **Step 3: Nav**

En `configuracion.vue`, junto a Garzones (bloque `Salones:Crear`):

```typescript
items.push({
  label: 'Turnos',
  icon: 'i-lucide-clock-3',
  to: '/configuracion/turnos',
})
```

- [ ] **Step 4: Manual smoke** — Configuración → Turnos: crear “Brunch” 10:00–14:00, editar, desactivar, eliminar.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useTurnos.ts frontend/app/pages/configuracion/turnos.vue frontend/app/pages/configuracion.vue
git commit -m "$(cat <<'EOF'
feat(frontend): administración de turnos en configuración

EOF
)"
```

---

### Task 6: Frontend — Entrar / Salir de turno en Salones

**Files:**
- Create: `frontend/app/composables/useSesionesGarzon.ts` (mínimo: `iniciar`, `cerrar`; el resto en Task 7)
- Modify: `frontend/app/pages/salones/index.vue`

**Interfaces:**
- Consumes: `POST /sesiones-garzon/iniciar`, `POST /sesiones-garzon/cerrar`, `GET /turnos`
- Produces: botones Entrar/Salir + toasts; abrir/cerrar cuenta ya falla con mensaje backend si no hay sesión

- [ ] **Step 1: Composable parcial**

```typescript
export interface SesionGarzon {
  id: string
  garzonId: string
  garzonNombre: string
  turnoId: string
  turnoNombre: string
  inicioEl: string
  finEl: string | null
  estado: 'abierta' | 'cerrada'
}

export function useSesionesGarzon() {
  const apiUrl = useRuntimeConfig().public.apiUrl
  const iniciar = (body: { pin: string, turnoId: string }) =>
    useApiFetch<SesionGarzon>(`${apiUrl}/sesiones-garzon/iniciar`, { method: 'POST', body })
  const cerrar = (body: { pin: string }) =>
    useApiFetch<SesionGarzon>(`${apiUrl}/sesiones-garzon/cerrar`, { method: 'POST', body })
  // Task 7 añadirá listarAbiertas, historial, cerrarAdmin, activa
  return { iniciar, cerrar }
}
```

- [ ] **Step 2: UI en `salones/index.vue`**

En el header del panel de operación (junto a acciones existentes):

1. Botón **Entrar a turno**:
   - Abre modal/drawer con `USelectMenu` de turnos activos (`useTurnos().listar()` filtrado `activo`).
   - Confirmar → `solicitarPin(...)` → `sesionesApi.iniciar({ pin, turnoId })` → toast `Sesión iniciada: {garzonNombre} · {turnoNombre}`.
2. Botón **Salir de turno**:
   - `solicitarPin` → `sesionesApi.cerrar({ pin })` → toast éxito.

Si `abrirCuentaConPin` / `cerrarCuentaConPin` reciben el mensaje de sesión, el toast ya muestra `e.data.message` vía `apiErrorMsg` — verificar que el copy sea legible.

- [ ] **Step 3: Manual**

1. Sin sesión: abrir cuenta con PIN Ana → error sesión.
2. Entrar a turno Mañana con Ana (`111111`) → abrir cuenta OK.
3. Salir de turno → abrir cuenta falla otra vez.
4. Doble Entrar → toast “ya tiene una sesión abierta”.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useSesionesGarzon.ts frontend/app/pages/salones/index.vue
git commit -m "$(cat <<'EOF'
feat(salones): entrar y salir de turno con PIN en operación

EOF
)"
```

---

### Task 7: Frontend — admin sesiones abiertas + historial

**Files:**
- Modify: `frontend/app/composables/useSesionesGarzon.ts`
- Create: `frontend/app/pages/configuracion/sesiones-garzon.vue`
- Modify: `frontend/app/pages/configuracion.vue`

- [ ] **Step 1: Completar composable**

```typescript
const listarAbiertas = () =>
  useApiFetch<SesionGarzon[]>(`${apiUrl}/sesiones-garzon/abiertas`)

const historial = (query: Record<string, string | number | undefined>) => {
  const qs = new URLSearchParams()
  // page, pageSize, garzonId, turnoId, estado, desde, hasta
  return useApiFetch<PaginatedResponse<SesionGarzon>>(
    `${apiUrl}/sesiones-garzon?${qs}`,
  )
}

const cerrarAdmin = (id: string) =>
  useApiFetch<SesionGarzon>(`${apiUrl}/sesiones-garzon/${id}/cerrar`, {
    method: 'POST',
  })
```

Preferir `usePaginatedList` si el patrón de la página lo permite (`docs/patterns/frontend.md` §12); si no, `ref` + `UPagination` manual.

- [ ] **Step 2: Página admin**

Secciones:

1. **Abiertas ahora** — tabla: garzón, turno, inicio, acción Forzar cierre (`CrudModal` confirmación) → `cerrarAdmin` → quitar de lista local.
2. **Historial** — filtros + paginación.

Nav (mismo bloque Salones):

```typescript
items.push({
  label: 'Sesiones',
  icon: 'i-lucide-timer',
  to: '/configuracion/sesiones-garzon',
})
```

- [ ] **Step 3: Manual** — forzar cierre de sesión abierta; ver historial con estado `cerrada` y origen admin.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useSesionesGarzon.ts frontend/app/pages/configuracion/sesiones-garzon.vue frontend/app/pages/configuracion.vue
git commit -m "$(cat <<'EOF'
feat(frontend): admin de sesiones abiertas e historial de turnos

EOF
)"
```

---

### Task 8: Docs vivas + verificación final

**Files:**
- Create: `docs/features/turnos-garzones.md` (desde `TEMPLATE.md`)
- Modify: `docs/README.md`, `docs/ESTADO.md`, `docs/features/garzones.md` (quitar “turnos” de futuro / link cruzado)
- Modify: `docs/superpowers/specs/2026-07-16-turnos-sesiones-garzon-design.md` → Status: Approved/Done

- [ ] **Step 1: Feature doc**

Cubrir: overview, alcance, endpoints, tablas, reglas (sesión obligatoria, horarios referenciales, 400 vs 401), seed PINs/turnos, related features (`garzones.md`, `salones-mesas.md`).

- [ ] **Step 2: ESTADO + README**

Fila nueva:

`| Turnos y sesiones de garzón: catálogo de turnos, marcar entrada/salida con PIN, cierre admin, sesión obligatoria para abrir/cerrar cuentas | ✅ Implementado (2026-07-16) |`

- [ ] **Step 3: Verification suite**

```bash
cd backend && npm test -- --testPathPattern='turnos|sesiones-garzon|salones.service' --coverage=false
cd backend && npm run lint
cd frontend && npm run lint
```

Manual checklist (seed Paris):

1. Config → Turnos: ver Mañana/Tarde/Noche.
2. Salones → Entrar turno (Ana 111111) → abrir mesa → cuenta OK.
3. Salir turno → abrir cuenta falla con mensaje de sesión.
4. Config → Sesiones: forzar cierre si quedó abierta.
5. Intentar desactivar turno con sesión abierta → error.

- [ ] **Step 4: Commit**

```bash
git add docs/ startup-pos.sql
git commit -m "$(cat <<'EOF'
docs: turnos y sesiones de garzón

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| CRUD turnos | Task 1 + 5 |
| Sesión PIN iniciar/cerrar | Task 2 + 6 |
| Cierre admin + listado abiertas/historial | Task 2 + 7 |
| Sesión obligatoria abrir/cerrar cuenta | Task 3 + 6 |
| Horarios referenciales | Task 1 (sin validación de ventana) |
| 400 no 401 | Task 2 (mensajes) |
| Seed turnos | Task 4 |
| Docs + SQL | Task 4 + 8 |
| Sin propinas/transferencia/liquidación | Fuera de alcance (no hay tasks) |

**Type consistency:** `assertSesionAbierta(tenantId, garzonId)`, mensajes de error alineados a la spec, rutas `/turnos` y `/sesiones-garzon`, permisos `Salones:*`.

**Placeholders:** ninguno intencional; Task 1 deja el check de sesiones abiertas en turnos para Task 2 de forma explícita.
