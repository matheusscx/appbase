# Feature: Gestión de Cajas

**Status**: Complete
**Owner**: —
**Last Updated**: 2026-06-29

---

## Overview

### What is it?

Gestiona el ciclo de vida de la caja física en el POS: apertura con saldo inicial,
registro de movimientos manuales (entradas y salidas de efectivo), cierre con
cuadre (monto contado vs. saldo esperado) e historial de sesiones de caja.

Cada sesión de caja corresponde a un turno de un usuario dentro de un tenant.
Las ventas físicas se asocian a la caja activa del usuario que las registra.

### Why does it exist?

En un POS físico el cajero inicia el turno con un fondo de caja, registra todas las
transacciones durante su turno y, al cierre, declara el efectivo físico. El sistema
calcula la diferencia entre lo que debería haber (`saldo_esperado`) y lo que el
cajero cuenta (`monto_contado`), generando el reporte de cuadre de caja.

### Scope

- Incluido:
  - Apertura de caja física con saldo inicial
  - Movimientos manuales (entrada / salida de efectivo)
  - Cierre de caja con cuadre automático
  - Historial de sesiones de caja (propia + todas con permiso especial)
  - Caja virtual (creada automáticamente por tenant para ventas online — excluida de flujos manuales)
  - Permisos granulares vía `@RequiresPermiso` + `PermisosGuard`

- NOT included (future):
  - Integración con pasarela de cobros
  - Cajas de múltiples bodegas / sucursales
  - Reimpresión de recibos de apertura/cierre
  - Conciliación automática con pagos electrónicos

---

## Modelo de acceso por permiso

El módulo Caja distingue dos niveles de acceso según los permisos del usuario:

| Permiso | Qué puede hacer |
|---------|----------------|
| `Caja:Leer` (sin `Ver todas`) | Accede a `/caja` y opera su propia caja (abrir, movimientos, cierre). Solo ve su historial. |
| `Caja:Ver todas` | Además de lo anterior, ve la pestaña "Todas las cajas" en `/caja` con el grid de todas las cajas físicas abiertas del tenant. Puede navegar a `/caja/[id]` de cualquier caja en modo read-only (sin botones de operar). |

La visibilidad del link "Caja" en el sidebar requiere solo `Caja:Leer`.

---

## API Endpoints

### GET /caja/abiertas — Cajas físicas abiertas del tenant

```
GET /caja/abiertas
Authorization: Bearer <token>

Permiso requerido: Caja / Leer
Nota: devuelve todas las cajas del tenant si el usuario tiene "Ver todas";
      solo la propia si no.

Response (200):
[
  {
    "id": "uuid",
    "usuarioId": "uuid",
    "usuarioNombre": "Juan Pérez",
    "saldoInicial": "500.00",
    "saldoEsperado": "750.00",
    "fechaApertura": "2026-06-29T08:00:00Z",
    "esPropia": true
  },
  ...
]
```

### GET /caja/activa — Caja física abierta del usuario

```
GET /caja/activa
Authorization: Bearer <token>
X-Tenant-ID: <tenantId>  (via guard, del token)

Permiso requerido: Caja / Leer

Response (200):
{
  "cajaId": "uuid",
  "tipo": "fisica",
  "estado": "abierta",
  "saldoInicial": "500.00",
  "saldoEsperado": "750.00",
  "abiertaEl": "2026-06-29T08:00:00Z",
  "comentario": "Turno mañana",
  "movimientos": []
}

Response (200) si no hay caja activa:
null
```

### POST /caja/abrir — Abrir caja física

```
POST /caja/abrir
Authorization: Bearer <token>

Permiso requerido: Caja / Crear

Request:
{
  "saldoInicial": "500.00",
  "comentario": "Turno mañana"   // opcional
}

Response (201):
{
  "cajaId": "uuid",
  "tipo": "fisica",
  "estado": "abierta",
  "saldoInicial": "500.00",
  "saldoEsperado": "500.00",
  "abiertaEl": "2026-06-29T08:00:00Z"
}

Error (409) si ya hay una caja abierta para este usuario+tenant.
```

### POST /caja/:id/movimientos — Registrar movimiento manual

```
POST /caja/:id/movimientos
Authorization: Bearer <token>

Permiso requerido: Caja / Crear

Request:
{
  "tipo": "entrada",          // "entrada" | "salida"
  "concepto": "Fondo adicional",
  "monto": "200.00",
  "referencia": "Ref-001"     // opcional
}

Response (201):
{
  "movimientoId": "uuid",
  "cajaId": "uuid",
  "tipo": "entrada",
  "concepto": "Fondo adicional",
  "monto": "200.00",
  "referencia": "Ref-001",
  "creadoEl": "2026-06-29T10:00:00Z"
}

Error (422) si tipo es "salida" y monto > saldo_esperado actual.
Error (403) si la caja no pertenece al usuario (salvo permiso "Ver todas").
```

### GET /caja/:id/movimientos — Listar movimientos de la caja

```
GET /caja/:id/movimientos
Authorization: Bearer <token>

Permiso requerido: Caja / Leer
Nota: usuarios con "Ver todas" pueden listar movimientos de cajas ajenas (read-only).
      Solo el dueño puede registrar movimientos (POST) o cerrar (POST /cerrar).

Response (200):
[
  {
    "movimientoId": "uuid",
    "tipo": "entrada",
    "concepto": "Fondo adicional",
    "monto": "200.00",
    "referencia": "Ref-001",
    "creadoEl": "2026-06-29T10:00:00Z"
  },
  ...
]
```

### POST /caja/:id/cerrar — Cerrar caja con cuadre

```
POST /caja/:id/cerrar
Authorization: Bearer <token>

Permiso requerido: Caja / Actualizar

Request:
{
  "montoContado": "748.50",
  "comentario": "Faltó billete de 5"   // opcional
}

Response (200):
{
  "cajaId": "uuid",
  "estado": "cerrada",
  "saldoInicial": "500.00",
  "saldoEsperado": "750.00",
  "montoContado": "748.50",
  "diferencia": "-1.50",
  "cerradaEl": "2026-06-29T18:00:00Z",
  "comentarioCierre": "Faltó billete de 5"
}

Error (409) si la caja ya está cerrada.
```

### GET /caja — Historial de cajas del usuario (y todas con permiso)

```
GET /caja
GET /caja?todas=true      // requiere permiso "Ver todas"
Authorization: Bearer <token>

Permiso requerido: Caja / Leer (+ "Ver todas" para el parámetro todas=true)

Response (200):
[
  {
    "cajaId": "uuid",
    "tipo": "fisica",
    "estado": "cerrada",
    "saldoInicial": "500.00",
    "saldoEsperado": "750.00",
    "montoContado": "748.50",
    "diferencia": "-1.50",
    "abiertaEl": "2026-06-29T08:00:00Z",
    "cerradaEl": "2026-06-29T18:00:00Z"
  },
  ...
]
```

### GET /caja/:id — Detalle de una caja

```
GET /caja/:id
Authorization: Bearer <token>

Permiso requerido: Caja / Leer

Response (200): objeto caja completo con movimientos embebidos.
Error (403) si la caja pertenece a otro usuario y no tiene permiso "Ver todas".
```

---

## Backend

### Module & Services

- **Module**: `src/modules/caja/caja.module.ts`
- **Controller**: `src/modules/caja/caja.controller.ts`
- **Service**: `src/modules/caja/caja.service.ts`

### Entity & Database

**Table**: `cajas`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `caja_id` | UUID | PK | `@PrimaryGeneratedColumn('uuid')` |
| `tenant_id` | UUID | FK tenants, NOT NULL | Del token — nunca del body |
| `usuario_id` | UUID | FK usuarios, NOT NULL | Del token |
| `tipo` | TEXT | NOT NULL | `'fisica'` \| `'virtual'` |
| `estado` | TEXT | NOT NULL | `'abierta'` \| `'cerrada'` |
| `saldo_inicial` | NUMERIC(18,6) | NOT NULL | Fondo al abrir; Decimal.js |
| `saldo_esperado` | NUMERIC(18,6) | NOT NULL | Recalculado en cada movimiento |
| `monto_contado` | NUMERIC(18,6) | nullable | Ingresado al cerrar |
| `diferencia` | NUMERIC(18,6) | nullable | `monto_contado − saldo_esperado` |
| `comentario` | TEXT | nullable | Al abrir |
| `comentario_cierre` | TEXT | nullable | Al cerrar |
| `abierta_el` | TIMESTAMPTZ | NOT NULL | `@CreateDateColumn` |
| `cerrada_el` | TIMESTAMPTZ | nullable | Se setea al cerrar |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

**Table**: `movimientos_caja`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `movimiento_id` | UUID | PK | |
| `caja_id` | UUID | FK cajas, NOT NULL | |
| `tenant_id` | UUID | FK tenants, NOT NULL | Desnormalizado para queries por tenant |
| `tipo` | TEXT | NOT NULL | `'entrada'` \| `'salida'` \| `'apertura'` \| `'cierre'` |
| `concepto` | TEXT | NOT NULL | Descripción del movimiento |
| `monto` | NUMERIC(18,6) | NOT NULL | Siempre positivo; tipo define el signo |
| `referencia` | TEXT | nullable | Referencia externa (nro. doc, etc.) |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

### DTOs

- `AbrirCajaDto` — `{ saldoInicial: string, comentario?: string }` (`@IsNumberString`, `@IsOptional`)
- `MovimientoCajaDto` — `{ tipo, concepto, monto: string, referencia? }`
- `CerrarCajaDto` — `{ montoContado: string, comentario?: string }`
- `CajaResponseDto` — Respuesta enriquecida con saldo esperado y cuadre

### Key Methods

- `cajaService.getCajaActiva(tenantId, usuarioId)` — caja física `estado='abierta'` del usuario
- `cajaService.getCajasAbiertas(tenantId, usuarioId, verTodas)` — cajas físicas abiertas del tenant; si `verTodas=false`, filtra por `usuarioId`; cada elemento incluye `esPropia`
- `cajaService.abrirCaja(tenantId, usuarioId, dto)` — crea caja; lanza 409 si ya hay una abierta
- `cajaService.registrarMovimiento(cajaId, tenantId, usuarioId, dto)` — valida propiedad (owner-only), valida saldo para `salida`, actualiza `saldo_esperado`
- `cajaService.listarMovimientos(cajaId, tenantId, usuarioId, verTodas)` — lista `movimientos_caja`; acepta caja ajena si `verTodas=true`
- `cajaService.cerrarCaja(cajaId, tenantId, usuarioId, dto)` — owner-only; calcula `diferencia`, marca `estado='cerrada'`
- `cajaService.findAll(tenantId, usuarioId, todas)` — historial; `todas=true` retorna todas las cajas del tenant
- `cajaService.findOne(cajaId, tenantId, usuarioId)` — detalle con movimientos

### Guards

El módulo `Caja` es el primer módulo de **feature** (no configuración) que usa
`@RequiresPermiso` + `PermisosGuard` en lugar de `TenantAdminGuard`. Todos los
endpoints están bajo `JwtAuthGuard + TenantGuard` en la clase y `@RequiresPermiso`
por método:

```typescript
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('caja')
export class CajaController {
  @UseGuards(PermisosGuard)
  @RequiresPermiso('Caja', 'Leer')
  @Get('activa')
  getCajaActiva(@Req() req) { ... }

  @UseGuards(PermisosGuard)
  @RequiresPermiso('Caja', 'Crear')
  @Post('abrir')
  abrirCaja(@Req() req, @Body() dto: AbrirCajaDto) { ... }
}
```

Ver nota en `docs/patterns/backend.md §4` sobre cuándo usar `@RequiresPermiso` vs. `TenantAdminGuard`.

---

## Frontend

### Pages

- `pages/caja/index.vue` — Pantalla principal con dos modos según permisos:
  - **Sin `Ver todas`**: máquina de estados directa (sin caja → caja abierta → cierre)
  - **Con `Ver todas`**: dos pestañas — "Mi caja" (operar caja propia) y "Todas las cajas" (grid de cajas abiertas del tenant)
- `pages/caja/[id].vue` — Detalle read-only de una caja ajena: estado, fechaApertura, saldoInicial, saldoEsperado y lista de movimientos (concepto, fecha, monto coloreado por tipo). Sin botones de operar. 403/404 → redirect a `/caja`.

### Components

- `components/caja/CajaAbierta.vue` — Panel de caja activa: saldo esperado, lista de movimientos del día, botón de cierre
- `components/caja/AbrirCajaForm.vue` — Formulario de apertura (saldo inicial + comentario)
- `components/caja/MovimientosTable.vue` — Tabla de movimientos manuales con tipo y monto
- `components/caja/CerrarCajaForm.vue` — Formulario de cierre con cuadre visual (esperado vs. contado → diferencia)
- `components/caja/HistorialCajas.vue` — Listado de sesiones pasadas con filtro de fecha
- `components/caja/CajasAbiertasGrid.vue` — Grid de cards para usuarios con `Ver todas`: muestra todas las cajas físicas abiertas del tenant. Cada card: nombre del cajero, saldo inicial, saldo esperado, hora de apertura, badge "Mía" para la propia. Click en caja propia → activa pestaña "Mi caja". Click en caja ajena → navega a `/caja/[id]`.

### Pinia Store

**File**: `stores/caja.ts`

**State**:
- `cajaActiva: Caja | null` — caja abierta del usuario actual
- `historial: Caja[]` — lista de sesiones pasadas
- `movimientos: MovimientoCaja[]` — movimientos de la caja activa
- `abiertas: CajaAbierta[]` — cajas físicas abiertas del tenant (para usuarios con `Ver todas`)
- `detalle: CajaDetalle | null` — detalle de una caja ajena (página read-only)
- `loading: boolean`
- `error: string | null`

**Actions**:
- `fetchCajaActiva()` — GET /caja/activa
- `abrirCaja(dto)` — POST /caja/abrir
- `registrarMovimiento(cajaId, dto)` — POST /caja/:id/movimientos
- `fetchMovimientos(cajaId)` — GET /caja/:id/movimientos
- `cerrarCaja(cajaId, dto)` — POST /caja/:id/cerrar
- `fetchHistorial(todas?)` — GET /caja?todas=true
- `cargarAbiertas()` — GET /caja/abiertas → puebla `abiertas`
- `cargarDetalle(id)` — GET /caja/:id + GET /caja/:id/movimientos → puebla `detalle`

---

## Data Flow

### Abrir caja

```
[Usuario llega al turno → /caja muestra "Sin caja activa"]
  ↓ clic "Abrir caja"
[AbrirCajaForm: saldo inicial + comentario]
  ↓ useCajaStore.abrirCaja(dto)
[POST /caja/abrir]
  ↓
[CajaService valida: no hay caja abierta para tenant+usuario]
  ↓ (lanza 409 si ya existe)
[Crea fila en `cajas` + movimiento inicial `tipo='apertura'`]
  ↓
[saldo_esperado = saldo_inicial]
  ↓
[Store: cajaActiva = nueva caja]
  ↓
[/caja muestra panel "Caja abierta"]
```

### Registrar movimiento manual

```
[Clic "Entrada" o "Salida" en panel caja abierta]
  ↓ usuario ingresa tipo, concepto, monto
  ↓ useCajaStore.registrarMovimiento(cajaId, dto)
[POST /caja/:id/movimientos]
  ↓
[Service valida: salida → monto ≤ saldo_esperado (lanza 422 si excede)]
  ↓
[Inserta en `movimientos_caja`]
[Actualiza `cajas.saldo_esperado += entrada | -= salida` (Decimal.js)]
  ↓
[Store: movimientos.push(nuevo); cajaActiva.saldoEsperado actualizado]
```

### Cerrar caja con cuadre

```
[Clic "Cerrar caja"]
  ↓ CerrarCajaForm: usuario ingresa monto_contado
  ↓ useCajaStore.cerrarCaja(cajaId, { montoContado, comentario })
[POST /caja/:id/cerrar]
  ↓
[Service: diferencia = montoContado − saldo_esperado (Decimal.js)]
[Actualiza: estado='cerrada', cerrada_el=now(), monto_contado, diferencia]
[Inserta movimiento `tipo='cierre'`]
  ↓
[Response: objeto caja con cuadre]
  ↓
[Store: cajaActiva = null; historial.unshift(caja cerrada)]
  ↓
[/caja vuelve a estado "Sin caja activa"]
```

---

## Business Rules

### Una sola caja física por tenant+usuario

Solo puede haber una caja `tipo='fisica'` con `estado='abierta'` por combinación
`(tenant_id, usuario_id)`. Intentar abrir una segunda retorna `409 Conflict`.

### Fórmula de saldo esperado

```
saldo_esperado = saldo_inicial
              + Σ movimientos tipo='entrada'
              − Σ movimientos tipo='salida'
```

Todo cálculo usa Decimal.js; nunca aritmética nativa de JavaScript.

### Bloqueo de salida por saldo insuficiente

Si `tipo='salida'` y `monto > saldo_esperado_actual`, el endpoint retorna `422 Unprocessable Entity`.
No se permite saldo negativo.

### Caja virtual

La caja `tipo='virtual'` se crea automáticamente al crear un tenant (en la misma
transacción que el rol admin y la fórmula de precios). Permanece siempre `abierta`
y se usa para ventas `canal='online'`. Está **excluida** de todos los flujos
manuales: no aparece en `GET /caja/activa`, no puede abrirse ni cerrarse
manualmente, y no acepta movimientos manuales.

### Permiso "Ver todas"

El permiso `Caja / Ver todas` permite a supervisores o administradores:

- Consultar todas las cajas del tenant (historial completo vía `GET /caja?todas=true`).
- Ver el grid de cajas físicas actualmente abiertas (`GET /caja/abiertas` retorna todas).
- Acceder en read-only al detalle de cualquier caja (`GET /caja/:id` y `GET /caja/:id/movimientos`).

**Owner-only (independientemente de `Ver todas`):** `POST /caja/:id/movimientos` y `POST /caja/:id/cerrar` solo los puede ejecutar el dueño de la caja.

---

## Testing

### Unit Tests (Backend)

```bash
cd backend
npm test -- modules/caja/caja.service.spec.ts
npm test -- modules/caja/caja.controller.spec.ts
```

### E2E Tests

```bash
cd backend
npm run test:e2e -- caja.e2e.spec.ts
```

### Manual Testing (Swagger)

1. Abrir http://localhost:3000/api/docs
2. Autenticar con Bearer token (con permiso `Caja/Leer` y `Caja/Crear`)
3. `GET /caja/activa` → debe retornar `null` si no hay caja
4. `POST /caja/abrir` con `{ "saldoInicial": "500" }` → 201
5. `POST /caja/:id/movimientos` con `{ "tipo": "entrada", "concepto": "Prueba", "monto": "100" }` → 201
6. `POST /caja/:id/movimientos` con `{ "tipo": "salida", "monto": "700" }` → 422 (saldo insuficiente)
7. `POST /caja/:id/cerrar` con `{ "montoContado": "598" }` → 200 con cuadre
8. `GET /caja` → historial con la caja cerrada

### Manual Testing (Frontend)

1. `docker-compose up`
2. Login + selección de tenant
3. Navegar a `/caja`
4. Abrir caja → verificar panel de caja activa
5. Agregar movimientos entrada/salida → verificar saldo esperado actualizado
6. Intentar salida mayor al saldo → verificar error
7. Cerrar caja → verificar cuadre (diferencia)
8. `/caja` muestra "Sin caja activa" y el historial actualizado

---

## Acceptance Criteria

- [x] Endpoint `GET /caja/activa` retorna la caja abierta o `null`
- [x] `POST /caja/abrir` valida unicidad (solo una caja por usuario+tenant)
- [x] Movimientos `salida` validan saldo suficiente (422 si excede)
- [x] Cierre calcula `diferencia = montoContado − saldoEsperado` con Decimal.js
- [x] Caja virtual excluida de todos los flujos manuales
- [x] Permiso "Ver todas" permite supervisores ver cajas de todo el tenant
- [x] `GET /caja/abiertas` retorna todas las cajas abiertas del tenant (o solo la propia sin `Ver todas`)
- [x] `GET /caja/:id/movimientos` permite lectura de caja ajena con `Ver todas`; registrar y cerrar siguen owner-only
- [x] Frontend `/caja` muestra pestañas "Mi caja" / "Todas las cajas" para usuarios con `Ver todas`
- [x] `CajasAbiertasGrid` muestra cards de cajas abiertas con badge "Mía" y navegación a detalle
- [x] Página `/caja/[id]` read-only con movimientos; 403/404 redirige a `/caja`
- [x] Store `useCajaStore` con `abiertas`, `detalle`, `cargarAbiertas()` y `cargarDetalle(id)`
- [x] Todos los guards usan `@RequiresPermiso` + `PermisosGuard` (no `TenantAdminGuard`)
- [x] Frontend página `/caja` con máquina de estados y store `useCajaStore`
- [x] Soft delete en cajas y movimientos
- [x] `tenant_id` y `usuario_id` siempre del token (nunca del body)

---

## Related Features

- [Gestión de ventas](./procesamiento-ventas.md) — Las ventas físicas asocian la caja activa del usuario
- [Registro de pagos](./registro-pagos.md) — Los pagos se asocian a la caja donde se cobran
- [Roles y Permisos (RBAC)](./roles-permisos.md) — Los permisos `Caja/*` controlan el acceso

---

## Notes

- La caja virtual se siembra automáticamente en `tenants.service.ts → create()` dentro
  de la transacción de creación del tenant, junto con el rol admin y la fórmula de precios.
- Este módulo es la referencia canónica para el patrón `@RequiresPermiso` en módulos de feature
  (a diferencia de los módulos de configuración que siguen usando `TenantAdminGuard`).
  Ver `docs/patterns/backend.md §4`.
