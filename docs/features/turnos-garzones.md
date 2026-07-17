# Feature: Turnos y Sesiones de Garzón

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-16

---

## Overview

### ¿Qué es?

Catálogo de **turnos** por tenant (Mañana, Tarde, Noche, etc.) y **sesiones de
trabajo** de garzones. El garzón marca entrada/salida con su PIN operativo; solo
con sesión abierta puede abrir o cerrar cuentas de mesa. El backoffice puede ver
sesiones abiertas, forzar cierres y consultar historial.

### ¿Por qué existe?

- Asociar la operación diaria a una jornada real (`inicio_el` / `fin_el`).
- Evitar que un PIN solo “identifique” sin haber marcado entrada.
- Base para futuros reportes de horas y propinas por turno (fuera de esta fase).

### Scope

- **Incluido**: CRUD de turnos; iniciar/cerrar sesión con PIN; consulta de sesión
  activa; listado de abiertas e historial; cierre administrativo; sesión
  obligatoria al abrir/cerrar cuenta.
- **NO incluido (futuro)**: transferencia de cuentas entre garzones; propinas;
  liquidaciones; reportes agregados; control duro de asistencia (atrasos,
  bloqueo por ventana horaria).

---

## Decisiones de diseño

- El garzón **no es usuario del sistema**: se identifica con PIN dentro de la
  sesión JWT del tenant (igual que [garzones.md](./garzones.md)).
- `hora_inicio` / `hora_fin` del turno son **referenciales**; no bloquean
  iniciar sesión fuera de esa ventana. La hora real trabajada sale de la sesión.
- Máximo **una sesión abierta** por garzón y tenant.
- Errores de PIN o sesión son **`400 Bad Request`**, nunca `401`, para no
  gatillar refresh/logout del dispositivo compartido.
- RBAC: módulo contratado `Salones` (`Leer` / `Crear` / `Actualizar` /
  `Eliminar` / `Operar`).

---

## API Endpoints

Todos bajo `JwtAuthGuard` + `TenantGuard` + `PermisosGuard`. `tenant_id` del JWT.

### Turnos

| Método | Ruta | Permiso (`Salones`) | Descripción |
|---|---|---|---|
| GET | `/turnos` | `Leer` | Lista turnos del tenant |
| POST | `/turnos` | `Crear` | Crea `{ nombre, horaInicio, horaFin, activo? }` |
| PATCH | `/turnos/:id` | `Actualizar` | Actualiza nombre, horario o `activo` |
| DELETE | `/turnos/:id` | `Eliminar` | Soft delete |

Validaciones: `nombre` no vacío y único por tenant (no eliminados); `horaInicio` /
`horaFin` formato `HH:mm` 24h. No se puede desactivar ni eliminar un turno con
sesiones abiertas.

### Sesiones de garzón

| Método | Ruta | Permiso (`Salones`) | Descripción |
|---|---|---|---|
| POST | `/sesiones-garzon/iniciar` | `Operar` | `{ pin, turnoId }` → abre sesión |
| POST | `/sesiones-garzon/cerrar` | `Operar` | `{ pin }` → cierra sesión abierta |
| POST | `/sesiones-garzon/activa` | `Operar` | `{ pin }` → sesión abierta o `null` |
| GET | `/sesiones-garzon/abiertas` | `Leer` | Sesiones abiertas del tenant |
| GET | `/sesiones-garzon` | `Leer` | Historial paginado (`garzonId`, `turnoId`, `estado`, `desde`, `hasta`) |
| POST | `/sesiones-garzon/:id/cerrar` | `Actualizar` | Cierre admin (sin PIN); registra `cerrada_por_usuario_id` |

Errores esperados (todos `400`):

| Situación | Mensaje |
|---|---|
| PIN incorrecto | `PIN inválido` |
| Garzón inactivo | `El garzón está inactivo` |
| Turno inválido/inactivo | `Turno inválido o inactivo` |
| Segunda sesión abierta | `El garzón ya tiene una sesión abierta` |
| Cierre sin sesión | `El garzón no tiene una sesión abierta` |
| Abrir/cerrar cuenta sin sesión | `El garzón no tiene una sesión de trabajo abierta` |

---

## Backend

- **Módulo**: `src/modules/turnos/turnos.module.ts`
- **Controllers**: `turnos.controller.ts`, `sesiones-garzon.controller.ts`
- **Services**: `turnos.service.ts`, `sesiones-garzon.service.ts`
- **Integración**: `SalonesService` llama
  `SesionesGarzonService.assertSesionAbierta(tenantId, garzonId)` tras resolver
  el PIN al abrir/cerrar cuenta.

### Tabla `turnos`

| Columna | Tipo | Notas |
|---|---|---|
| `turno_id` | UUID PK | |
| `tenant_id` | UUID | FK tenants |
| `nombre` | VARCHAR | único por tenant (no eliminados) |
| `hora_inicio` / `hora_fin` | TIME / string `HH:mm` | referenciales |
| `activo` | BOOLEAN | default `true` |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

### Tabla `sesiones_garzon`

| Columna | Tipo | Notas |
|---|---|---|
| `sesion_garzon_id` | UUID PK | |
| `tenant_id` | UUID | FK tenants |
| `garzon_id` | UUID | FK garzones |
| `turno_id` | UUID | FK turnos |
| `inicio_el` | TIMESTAMPTZ | |
| `fin_el` | TIMESTAMPTZ | nullable mientras abierta |
| `estado` | `abierta` \| `cerrada` | |
| `origen_cierre` | `pin` \| `admin` | nullable si abierta |
| `cerrada_por_usuario_id` | UUID | nullable; cierre admin |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

Restricción efectiva: una sola sesión `abierta` por `(tenant_id, garzon_id)`.

### Métodos clave

- `TurnosService.create/update/remove` — CRUD; bloquea desactivar/eliminar con
  sesiones abiertas.
- `SesionesGarzonService.iniciar` / `cerrarPorPin` / `activaPorPin` — operación
  diaria con PIN.
- `SesionesGarzonService.cerrarAdmin` — cierre forzado; `origen_cierre = admin`.
- `SesionesGarzonService.assertSesionAbierta` — gate de Salones.

---

## Frontend

- **Composables**: `useTurnos.ts`, `useSesionesGarzon.ts`
- **Config → Turnos**: `pages/configuracion/turnos.vue` — CRUD local (`ref` +
  upsert/remove sin re-fetch).
- **Config → Sesiones**: `pages/configuracion/sesiones-garzon.vue` — abiertas +
  forzar cierre + historial filtrado.
- **Salones**: `pages/salones/index.vue` — “Entrar a turno” / “Salir de turno”
  con `GarzonPinModal`; toast si falta sesión al abrir/cerrar cuenta.

---

## Seed de desarrollo

Tenant Paris — turnos (IDs fijos):

| ID | Nombre | Horario |
|---|---|---|
| `…440277` | Mañana | 08:00–15:00 |
| `…440278` | Tarde | 15:00–22:00 |
| `…440279` | Noche | 22:00–08:00 |

(Prefijo completo: `550e8400-e29b-41d4-a716-446655440XXX`.)

No se crean sesiones abiertas. PINs de garzones demo (ver [garzones.md](./garzones.md)):
Ana=`111111`, Bruno=`222222`, Carla=`333333`.

---

## Data Flow

### Entrar a turno y abrir cuenta

```
[Salones → Entrar a turno]
  ↓ elige turno + PIN
[POST /sesiones-garzon/iniciar]
  ↓
[Sesión abierta]
  ↓
[Abrir mesa → PIN]
  ↓ SalonesService: resolver PIN + assertSesionAbierta
[Cuenta creada con garzon_apertura_id]
```

### Sin sesión

```
[Abrir/cerrar cuenta con PIN válido]
  ↓ assertSesionAbierta falla
[400 "El garzón no tiene una sesión de trabajo abierta"]
  ↓ toast en Salones → ofrecer Entrar a turno
```

---

## Testing

### Unit (backend)

```bash
cd backend && npm test -- --testPathPatterns='turnos|sesiones-garzon|salones.service' --coverage=false
```

Cubre: CRUD turnos, duplicados, formato horario, bloqueo con sesión abierta,
iniciar/cerrar por PIN, cierre admin, y rechazo de Salones sin sesión.

### Manual (seed Paris)

1. Config → Turnos: ver Mañana / Tarde / Noche.
2. Salones → Entrar turno (Ana `111111`) → abrir mesa → cuenta OK.
3. Salir turno → abrir cuenta falla con mensaje de sesión.
4. Config → Sesiones: forzar cierre si quedó abierta.
5. Intentar desactivar turno con sesión abierta → error.

---

## Acceptance Criteria

- [x] CRUD turnos con soft delete y validaciones
- [x] Sesión PIN iniciar / cerrar / activa
- [x] Cierre admin + listado abiertas / historial
- [x] Sesión obligatoria al abrir/cerrar cuenta
- [x] Horarios referenciales (sin validación de ventana)
- [x] Errores operativos como `400`, no `401`
- [x] Seed turnos (IDs 277/278/279)
- [x] Docs vivas + SQL
- [x] Unit tests

---

## Related Features

- [Garzones (PIN operativo)](./garzones.md)
- [Salones y Mesas](./salones-mesas.md)
- [Ventas](./ventas.md)

---

## Notes

Spec de diseño:
[`docs/superpowers/specs/2026-07-16-turnos-sesiones-garzon-design.md`](../superpowers/specs/2026-07-16-turnos-sesiones-garzon-design.md).
Propinas, liquidaciones y reportes quedan fuera a propósito (YAGNI).
