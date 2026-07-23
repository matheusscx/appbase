# Feature: Gestión de Cajas

**Status**: Complete
**Owner**: —
**Last Updated**: 2026-07-23

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

Operar el propio turno y supervisar todas las cajas del tenant son dos responsabilidades
distintas, y hasta 2026-07-23 convivían en un solo módulo `Caja` bifurcado por el permiso
`Ver todas` — una acción CRUD genérica haciendo de "rol supervisor" disfrazado. Se separaron
en **dos módulos de permiso y dos superficies de navegación**:

| Módulo | Permiso | Superficie (frontend) | Qué puede hacer |
|---|---|---|---|
| `MiCaja` | `Leer` / `Crear` / `Actualizar` | `/mi-caja*` | El cajero opera **su propio** turno: abrir, registrar movimientos, cerrar con cuadre, ver su propio historial. |
| `Cajas` | `Leer` (única acción) | `/cajas*` | El encargado **supervisa** todas las cajas físicas del tenant: grid de abiertas, historial de todos (filtro por cajero), detalle de cualquier caja — **siempre read-only**, sin botones de operar. |

Un usuario con ambos módulos ve las dos entradas de sidebar de forma independiente:
"Mi caja" es su propio turno, "Cajas" es supervisión — sin lógica especial para el caso
"admin que también opera". El rol admin (`es_fijo`) obtiene `Cajas:Leer` automáticamente
en cuanto el tenant contrata el módulo `Cajas` (short-circuit de rol fijo).

**El backend no se reorganizó**: las rutas siguen siendo `/caja/*` en un único
`caja.controller.ts` / `caja.service.ts` — el usuario nunca ve esas URLs, las llama el
frontend. Lo único que cambió es el `@RequiresPermiso` de cada endpoint. Ver
[endpoints](#api-endpoints) y [Backend](#backend).

**Escrituras siempre owner-only**: tener `Cajas:Leer` nunca habilita `POST
/caja/:id/movimientos` ni `POST /caja/:id/cerrar` sobre una caja ajena — esa validación
vive en el service y no depende del módulo de permiso. El cierre forzado de una caja
ajena por el encargado queda diferido (ver `docs/agent/pendientes.md`).

---

## Definición de cajones (Configuración → Cajas)

**Sub-proyecto 1 de 3** del refactor general de caja (ver roadmap §9 de la
[investigación de mercado](../agent/investigaciones/2026-07-23-gestion-caja.md)).
Introduce el **cajón físico** (Mostrador, Delivery, Barra…) como entidad propia que el
admin del tenant define en Configuración. El vínculo `cajon_id` en la sesión de caja
(`cajas`) y la autorización de qué usuario puede abrir qué cajón llegan en el
sub-proyecto 3 — por ahora la definición de cajones no afecta el flujo de
apertura/cierre documentado arriba.

**Nota de terminología:** `cajones` (este módulo, el mueble físico) ≠ `cajas` (la
sesión/turno documentada en el resto de este archivo). A partir de este sub-proyecto,
"cajón" es siempre el mueble físico y "caja" es siempre la sesión — no usar ambos
términos indistintamente.

### Entidad `cajones`

**Table**: `cajones` (tenant-owned)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `cajon_id` | UUID | PK | |
| `tenant_id` | UUID | FK tenants, NOT NULL | Del token — nunca del body |
| `nombre` | TEXT | NOT NULL | Único por tenant (ver regla abajo) |
| `activo` | BOOLEAN | NOT NULL, default `true` | Desactivar sin borrar |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

Índice único parcial `ux_cajones_tenant_nombre` sobre `(tenant_id, nombre)` filtrando
`eliminado_el IS NULL` — la garantía dura contra duplicados bajo concurrencia; el
service valida antes (`validarNombreUnico`) para devolver un `409` con mensaje amable.

### Endpoints

- **Module**: `src/modules/cajones/cajones.module.ts`
- **Controller**: `src/modules/cajones/cajones.controller.ts`
- **Service**: `src/modules/cajones/cajones.service.ts`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/cajones` | `Cajas` / `Leer` | Lista cajones del tenant, ordenados por nombre |
| POST | `/cajones` | `Cajas` / `Crear` | Crea cajón; `409` si el `nombre` ya existe (no borrado) en el tenant |
| PATCH | `/cajones/:id` | `Cajas` / `Actualizar` | Edita `nombre` y/o `activo`; `409` si el nuevo nombre choca con otro cajón |
| DELETE | `/cajones/:id` | `Cajas` / `Eliminar` | Soft delete (`softDelete`, nunca `DELETE` físico) |

Todos bajo `JwtAuthGuard + TenantGuard + PermisosGuard` en la clase, igual que el resto
de módulos de feature — ver `docs/patterns/backend.md §4`.

### Módulo de permiso `Cajas` extendido (antes solo `Leer`)

Hasta este sub-proyecto, el módulo de permiso `Cajas` solo tenía la acción `Leer`
(supervisión read-only de sesiones — ver [Modelo de acceso por
permiso](#modelo-de-acceso-por-permiso)). Se **extendió** con `Crear` / `Actualizar` /
`Eliminar` para gobernar también el CRUD de cajones: no se creó un módulo de permiso
nuevo porque supervisar sesiones y definir cajones son responsabilidades del mismo rol
"encargado de caja" del tenant. Solo se agregaron filas `modulo_app_permiso` — el
módulo `Caja` (sesión) y su controller/service **no se tocaron**.

### Frontend

- **Page**: `pages/configuracion/cajas.vue` — CRUD de cajones dentro de Configuración
  (tabla + drawer crear/editar + confirm de eliminar). Gate por `Cajas:Crear` /
  `Actualizar` / `Eliminar` (UX-only; el backend enforcea con `@RequiresPermiso`). La
  etiqueta de UI que ve el admin ("Cajas") mapea a la entidad `cajones` — ver nota de
  terminología arriba.

### Autorización: qué usuarios abren qué cajones (allow-list)

**Sub-proyecto 2 de 3** del refactor general de caja (roadmap
[§9](../agent/investigaciones/2026-07-23-gestion-caja.md#9-roadmap-del-refactor-general-de-caja-decisión-2026-07-23)).
El admin define, por cajón, la lista de usuarios autorizados a abrirlo — un mapeo
N-a-N, no un amarre 1-a-1.

**Table**: `cajon_usuario` (tenant-owned)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `cajon_usuario_id` | UUID | PK | |
| `cajon_id` | UUID | FK cajones, NOT NULL | |
| `usuario_id` | UUID | FK usuarios, NOT NULL | |
| `tenant_id` | UUID | FK tenants, NOT NULL | Del token — nunca del body |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

Índice único parcial `ux_cajon_usuario_cajon_usuario` sobre `(cajon_id, usuario_id)`
filtrando `eliminado_el IS NULL` — una habilitación viva por par no se repite; al
quitar y re-habilitar un usuario, la fila anterior queda soft-deleted y se crea una
fila nueva.

**Endpoints** (mismo controller `cajones.controller.ts`):

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/cajones/:id/usuarios` | `Cajas` / `Leer` | Lista `usuarioId` autorizados del cajón |
| PUT | `/cajones/:id/usuarios` | `Cajas` / `Actualizar` | Reemplaza el set completo (replace-set, no incremental) |

`PUT` recibe la lista completa de `usuarioIds` deseada; el service calcula el diff
contra los vivos (`quitar` = softDelete de los que sobran, `agregar` = insertar los
nuevos) dentro de una transacción. La pertenencia de cada `usuarioId` se valida en un
solo `count` contra `usuarios_tenants` (miembro del tenant) — `400` si alguno es
ajeno; sin N+1.

**Regla de lista vacía = permisiva.** Un cajón sin ningún `cajon_usuario` vivo **no
está bloqueado para nadie** — queda abierto a cualquier usuario con `MiCaja:Crear`.
La allow-list es una restricción opt-in que el admin agrega cajón por cajón, no un
default cerrado.

**Sin enforcement todavía.** Hoy el mapeo solo se persiste — nada en el flujo de
apertura de caja (`POST /caja/abrir`, sin `cajon_id` aún) lo consulta ni lo bloquea.
El enforcement real al abrir (elegir un cajón, validar que el usuario esté
autorizado o que la lista esté vacía) llega en el **sub-proyecto 3**, junto con el
campo `cajon_id` en la sesión (`cajas`).

**Ortogonalidad con `MiCaja:Crear`:** son dos preguntas distintas que se cruzan recién
al abrir (sub-3), no una redundancia.

| Pregunta | Responde |
|---|---|
| ¿Puede este usuario operar caja en general? | `MiCaja:Crear` (RBAC) |
| ¿En cuáles cajones puede hacerlo? | Allow-list (`cajon_usuario`) |

Un usuario sin `MiCaja:Crear` no abre ningún cajón aunque esté en la allow-list de
todos; un usuario con `MiCaja:Crear` pero fuera de la allow-list de un cajón
específico no podrá abrir *ese* cajón en particular (una vez exista el enforcement).

---

## API Endpoints

### GET /caja/abiertas — Cajas físicas abiertas del tenant

```
GET /caja/abiertas
Authorization: Bearer <token>

Permiso requerido: Cajas / Leer
Nota: endpoint exclusivo de supervisión — siempre devuelve todas las cajas físicas
      abiertas del tenant (quien llega tiene `Cajas:Leer`).

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

Permiso requerido: MiCaja / Leer

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

Permiso requerido: MiCaja / Crear

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

Permiso requerido: MiCaja / Crear

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
Error (403) si la caja no pertenece al usuario (owner-only, aun con `Cajas:Leer`).
```

### GET /caja/:id/movimientos/resumen — KPIs del turno

```
GET /caja/:id/movimientos/resumen
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer (propia) o Cajas:Leer (ajena) — lectura compartida,
                   ver nota en GET /caja/:id/movimientos.

Response (200):
{
  "saldoInicial": "1000.0000",
  "totalEntradas": "500.0000",
  "totalSalidas": "200.0000",
  "saldoEsperado": "1300.0000",
  "totalMovimientos": 5
}
```

Totales globales del turno (independientes de la página del listado).

### GET /caja/:id/movimientos — Listar movimientos de la caja (paginado)

```
GET /caja/:id/movimientos?page=1&pageSize=15&tipo=entrada
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer (propia) o Cajas:Leer (ajena) — resuelto por el helper
                   `resolverLecturaCompartida` del controller (403 si no tiene ninguno).
Nota: usuarios con Cajas:Leer pueden listar movimientos de cajas ajenas (read-only).
      Solo el dueño puede registrar movimientos (POST) o cerrar (POST /cerrar),
      sin importar Cajas:Leer.

Response (200):
{
  "data": [
    {
      "id": "uuid",
      "cajaId": "uuid",
      "tipo": "entrada",
      "concepto": "Fondo adicional",
      "monto": "200.0000",
      "referencia": "Ref-001",
      "fecha": "2026-06-29T10:00:00Z",
      "ventaId": null
    }
  ],
  "meta": { "page": 1, "pageSize": 15, "total": 5, "totalPages": 1 }
}
```

### POST /caja/:id/cerrar — Cerrar caja con cuadre

```
POST /caja/:id/cerrar
Authorization: Bearer <token>

Permiso requerido: MiCaja / Actualizar (owner-only; `Cajas:Leer` no habilita cerrar)

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

### GET /caja — Historial de cajas (paginado)

```
GET /caja?page=1&pageSize=15
GET /caja?todas=true&page=1&pageSize=15   // requiere Cajas:Leer
GET /caja?usuarioId=uuid&page=1&pageSize=15   // historial de un cajero (detalle /caja/:id); ajeno requiere Cajas:Leer
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer o Cajas:Leer (lectura compartida). `todas=true` o
                   `usuarioId` de otro usuario solo escalan el alcance si tiene
                   `Cajas:Leer`; si no, se ignora y devuelve solo lo propio.

Response (200):
{
  "data": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "usuarioId": "uuid",
      "tipo": "fisica",
      "estado": "cerrada",
      "saldoInicial": "500.0000",
      "saldoFinal": "750.0000",
      "montoContado": "748.5000",
      "diferencia": "-1.5000",
      "fechaApertura": "2026-06-29T08:00:00Z",
      "fechaCierre": "2026-06-29T18:00:00Z",
      "comentario": null
    }
  ],
  "meta": { "page": 1, "pageSize": 15, "total": 42, "totalPages": 3 }
}
```

### GET /caja/:id — Detalle de una caja

```
GET /caja/:id
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer (propia) o Cajas:Leer (ajena)

Response (200): objeto caja completo con movimientos embebidos.
Error (403) si la caja pertenece a otro usuario y no tiene `Cajas:Leer`.
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
- `cajaService.registrarMovimiento(cajaId, tenantId, usuarioId, dto)` — `FOR UPDATE` de la caja, valida propiedad (owner-only), valida saldo para `salida`, inserta movimiento
- `cajaService.bloquearCajaAbierta(manager, cajaId, tenantId)` — lock pesimista reutilizable (p.ej. egreso de NC en la misma tx)
- `cajaService.listarMovimientos(cajaId, tenantId, usuarioId, verTodas)` — lista `movimientos_caja`; acepta caja ajena si `verTodas=true`
- `cajaService.cerrarCaja(cajaId, tenantId, usuarioId, dto)` — owner-only; calcula `diferencia`, marca `estado='cerrada'`
- `cajaService.findAll(tenantId, usuarioId, todas)` — historial; `todas=true` retorna todas las cajas del tenant
- `cajaService.findOne(cajaId, tenantId, usuarioId)` — detalle con movimientos

### Guards

El módulo `Caja` (backend) fue el primer módulo de **feature** (no configuración) en
usar `@RequiresPermiso` + `PermisosGuard` en lugar de `TenantAdminGuard`; sigue siéndolo
tras el refactor de 2026-07-23, solo que ahora referencia dos módulos de permiso
distintos (`MiCaja` / `Cajas`) sobre el mismo controller. Todos los endpoints están bajo
`JwtAuthGuard + TenantGuard + PermisosGuard` en la clase; los endpoints **operativos**
(propios del cajero) usan `@RequiresPermiso` directo, y el endpoint exclusivo de
supervisión (`/caja/abiertas`) usa `@RequiresPermiso('Cajas', 'Leer')`:

```typescript
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('caja')
export class CajaController {
  @RequiresPermiso('MiCaja', 'Leer')
  @Get('activa')
  activa(@Req() req) { ... }

  @RequiresPermiso('MiCaja', 'Crear')
  @Post('abrir')
  abrir(@Req() req, @Body() dto: AbrirCajaDto) { ... }

  @RequiresPermiso('Cajas', 'Leer')
  @Get('abiertas')
  abiertas(@Req() req) { ... }
}
```

Los endpoints de **lectura compartida** (`GET /caja`, `/:id`, `/:id/movimientos`,
`/:id/movimientos/resumen`) no usan `@RequiresPermiso` — llaman al helper privado
`resolverLecturaCompartida(u)`, que exige `MiCaja:Leer` **o** `Cajas:Leer` (403 si no
tiene ninguno) y devuelve `verTodas = tieneCajas` para que el service resuelva el
alcance (propia vs. todas). Este patrón — permiso compuesto resuelto a mano en vez de
un solo `@RequiresPermiso` — es específico de este controller por tener dos módulos
sirviendo las mismas rutas de lectura; no es el patrón por defecto del proyecto.

Ver nota en `docs/patterns/backend.md §4` sobre cuándo usar `@RequiresPermiso` vs. `TenantAdminGuard`.

---

## Frontend

### Pages

Dos superficies, cada una gateada por su módulo (sidebar en `layouts/dashboard.vue`):

- `pages/mi-caja/index.vue` — Cajero opera su propio turno: sin caja abierta →
  formulario de apertura + botón "Ver historial" → `/mi-caja/historial`; con caja
  abierta → redirect a `/mi-caja/[id]`. Gate: `MiCaja:Leer`.
- `pages/mi-caja/historial.vue` — Historial paginado del propio cajero
  (`CajaHistorial`, sin `usuarioId` ni toggle "todas").
- `pages/mi-caja/[id].vue` — Detalle operable de su turno activo: KPIs + tabla de
  movimientos (`CajaActivaDashboard`), botones de operar (+Movimiento / Cerrar).
- `pages/cajas/index.vue` — Grid de cajas físicas abiertas del tenant
  (`CajaAbiertasGrid`), read-only. Gate: `Cajas:Leer`.
- `pages/cajas/historial.vue` — Historial de todos los cajeros con toggle "Ver todas"
  y soporte `?usuarioId=` para filtrar por cajero.
- `pages/cajas/[id].vue` — Detalle **read-only** de cualquier caja (sin botones de
  operar, aunque sea la propia): KPIs + movimientos (`CajaActivaDashboard` en modo
  read-only). Links "Volver a cajas" y "Ver historial del cajero". 403/404 →
  redirect a `/cajas`.
- `pages/caja/index.vue` — Compatibilidad: redirige a `/mi-caja` (bookmarks/enlaces
  internos previos al refactor).

### Components

`components/caja/` se mantiene **compartida** entre las dos superficies (`/mi-caja` y
`/cajas`) — son piezas de presentación reusadas por ambas, no específicas de un módulo
de permiso; separarlas en `components/mi-caja/` + `components/cajas/` habría duplicado
sin necesidad.

- `components/caja/CajaActivaDashboard.vue` — Orquestador del turno: compone header, resumen KPIs y tabla de movimientos; modales de movimiento y cierre. Prop `readonly` para la superficie `/cajas` (oculta botones de operar)
- `components/caja/CajaTurnoHeader.vue` — Título, badge de estado, fecha de apertura, botones +Movimiento / Cerrar caja
- `components/caja/CajaTurnoResumen.vue` — Grid de 4 KPIs (saldo inicial, entradas, salidas, saldo esperado)
- `components/caja/CajaMovimientosTable.vue` — Tabla paginada de movimientos con filtro por tipo, scroll interno y thead sticky
- `components/caja/CajaHistorial.vue` — Listado paginado de sesiones (`GET /caja`); prop `usuarioId` o query `?usuarioId=`; usado sin `usuarioId`/toggle en `/mi-caja/historial` y con ambos en `/cajas/historial`
- `components/caja/CajaAperturaForm.vue` — Formulario de apertura (saldo inicial + comentario)
- `components/caja/CajaMovimientoDrawer.vue` — Drawer entrada/salida manual
- `components/caja/CajaCierreDrawer.vue` — Drawer de cierre con cuadre (esperado vs. contado → diferencia)
- `components/caja/CajaAbiertasGrid.vue` — Grid de cards para la superficie `/cajas` (permiso `Cajas:Leer`): cajas físicas abiertas del tenant. Click → `/cajas/[id]`

### Pinia Store

**File**: `stores/caja.ts`

Un único store sirve a ambas superficies — no se partió por módulo de permiso.

**State**:
- `cajaActiva: Caja | null` — caja abierta del usuario actual
- `historial: Caja[]` — lista de sesiones pasadas
- `movimientos: MovimientoCaja[]` — movimientos de la caja activa
- `abiertas: CajaAbierta[]` — cajas físicas abiertas del tenant (superficie `/cajas`, permiso `Cajas:Leer`)
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
[Usuario llega al turno → /mi-caja muestra "Sin caja activa"]
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
[/mi-caja muestra panel "Caja abierta"]
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
[/mi-caja vuelve a estado "Sin caja activa"]
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

### Módulo `Cajas` (supervisión, solo lectura)

El módulo `Cajas` con permiso `Leer` permite a supervisores o administradores:

- Consultar todas las cajas del tenant (historial completo vía `GET /caja?todas=true`).
- Ver el grid de cajas físicas actualmente abiertas (`GET /caja/abiertas`).
- Acceder en read-only al detalle de cualquier caja (`GET /caja/:id` y `GET /caja/:id/movimientos`).

Hasta 2026-07-23 este diferenciador era la acción global `Ver todas` dentro del módulo
`Caja`; se reemplazó por un módulo dedicado (`Cajas`) para que el supervisor sea una
responsabilidad de acceso propia, no una acción CRUD reutilizada. `Ver todas` sigue
existiendo como acción global para otros módulos — solo se dejó de asociar a caja.

**Owner-only (independientemente de `Cajas:Leer`):** `POST /caja/:id/movimientos` y
`POST /caja/:id/cerrar` solo los puede ejecutar el dueño de la caja (permiso `MiCaja`).
Habilitar que el encargado fuerce el cierre de una caja ajena es un cambio de modelo
(requiere `cajas.cerrada_por`) diferido a propósito — ver `docs/agent/pendientes.md`.

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
npm run test:e2e -- caja.e2e-spec.ts
```

### Manual Testing (Swagger)

1. Abrir http://localhost:3000/api/docs
2. Autenticar con Bearer token (con permiso `MiCaja/Leer` y `MiCaja/Crear`)
3. `GET /caja/activa` → debe retornar `null` si no hay caja
4. `POST /caja/abrir` con `{ "saldoInicial": "500" }` → 201
5. `POST /caja/:id/movimientos` con `{ "tipo": "entrada", "concepto": "Prueba", "monto": "100" }` → 201
6. `POST /caja/:id/movimientos` con `{ "tipo": "salida", "monto": "700" }` → 422 (saldo insuficiente)
7. `POST /caja/:id/cerrar` con `{ "montoContado": "598" }` → 200 con cuadre
8. `GET /caja` → historial con la caja cerrada
9. Con un token que solo tenga `Cajas/Leer` (sin `MiCaja`): `GET /caja/abiertas` → 200 (todas); `POST /caja/abrir` → 403

### Manual Testing (Frontend)

1. `docker-compose up`
2. Login + selección de tenant
3. Navegar a `/mi-caja`
4. Abrir caja → verificar panel de caja activa en `/mi-caja/[id]`
5. Agregar movimientos entrada/salida → verificar saldo esperado actualizado
6. Intentar salida mayor al saldo → verificar error
7. Cerrar caja → verificar cuadre (diferencia)
8. `/mi-caja` (cajero sin caja): formulario de apertura + botón "Ver historial" → `/mi-caja/historial`
9. Admin: sidebar muestra "Mi caja" y "Cajas" como entradas independientes
10. `/cajas`: grid de abiertas; `/cajas/historial`: toggle "Ver todas"; click en fila → `/cajas/[id]`
11. `/cajas/[id]`: una sola tabla de movimientos, modo read-only (sin botones de operar); link "Ver historial del cajero" con `?usuarioId=`
12. KPIs visibles al hacer scroll en movimientos (thead sticky)
13. `/caja` redirige a `/mi-caja` (compatibilidad)

---

## Acceptance Criteria

- [x] Endpoint `GET /caja/activa` retorna la caja abierta o `null`
- [x] `POST /caja/abrir` valida unicidad (solo una caja por usuario+tenant)
- [x] Movimientos `salida` validan saldo suficiente (422 si excede)
- [x] Cierre calcula `diferencia = montoContado − saldoEsperado` con Decimal.js
- [x] Caja virtual excluida de todos los flujos manuales
- [x] Módulo `MiCaja` (operar el propio turno) y módulo `Cajas` (supervisar, solo lectura) separados
- [x] `GET /caja/abiertas` requiere `Cajas:Leer` y retorna todas las cajas abiertas del tenant
- [x] `GET /caja/:id/movimientos` permite lectura de caja ajena con `Cajas:Leer`; registrar y cerrar siguen owner-only bajo `MiCaja`
- [x] Frontend `/cajas` muestra grid de abiertas para usuarios con `Cajas:Leer`
- [x] `CajaAbiertasGrid` muestra cards de cajas abiertas con badge "Mía" y navegación a detalle
- [x] Página `/cajas/historial` con historial paginado y filtro `?usuarioId=`
- [x] Página `/cajas/[id]` con KPIs + movimientos (sin historial embebido, siempre read-only); 403/404 redirige a `/cajas`
- [x] `/caja` redirige a `/mi-caja` (compatibilidad de enlaces previos)
- [x] Store `useCajaStore` con `abiertas`, `detalle`, `cargarAbiertas()` y `cargarDetalle(id)` (compartido por ambas superficies)
- [x] Todos los guards usan `@RequiresPermiso` + `PermisosGuard` (no `TenantAdminGuard`)
- [x] Frontend páginas `/mi-caja` y `/cajas` con máquina de estados propia y store `useCajaStore` compartido
- [x] Soft delete en cajas y movimientos
- [x] `tenant_id` y `usuario_id` siempre del token (nunca del body)

---

## Related Features

- [Gestión de ventas](./ventas.md) — Las ventas físicas asocian la caja activa del usuario
- [Registro de pagos](./pagos.md) — Los pagos se asocian a la caja donde se cobran
- [Roles y Permisos (RBAC)](./roles-permisos.md) — Los permisos `MiCaja/*` y `Cajas:Leer` controlan el acceso

---

## Notes

- La caja virtual se siembra automáticamente en `tenants.service.ts → create()` dentro
  de la transacción de creación del tenant, junto con el rol admin y la fórmula de precios.
- Este módulo es la referencia canónica para el patrón `@RequiresPermiso` en módulos de feature
  (a diferencia de los módulos de configuración que siguen usando `TenantAdminGuard`).
  Ver `docs/patterns/backend.md §4`.
