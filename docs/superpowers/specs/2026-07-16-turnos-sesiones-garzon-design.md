# Diseño: Turnos y Sesiones de Garzón

**Status**: Done / Approved
**Owner**: Cesar Matheus
**Date**: 2026-07-16

---

## Contexto

El proyecto ya cuenta con el vertical de restaurante: salones, mesas, cuentas y
garzones con PIN operativo. Hoy el garzón puede identificarse para abrir y cerrar
cuentas, pero no existe una jornada de trabajo asociada a turnos. Esto deja sin
base confiable el cálculo futuro de horas trabajadas, propinas por horas y reportes
por turno.

Este diseño cubre el subproyecto B del requerimiento de gestión de garzones,
turnos y propinas: catálogo de turnos y sesiones reales de trabajo por garzón.

## Alcance

Incluido en esta fase:

- Administrar turnos por tenant: crear, editar, activar/desactivar y eliminar con
  soft delete.
- Permitir que un garzón inicie y cierre su sesión de trabajo con PIN.
- Permitir que un usuario autenticado con permiso administrativo vea sesiones
  abiertas y fuerce su cierre.
- Exigir una sesión abierta para que un garzón pueda abrir o cerrar cuentas de
  mesa.
- Guardar historial de sesiones con inicio, fin, estado, garzón y turno.

Fuera de alcance de esta fase:

- Transferencia de cuentas entre garzones.
- Registro y distribución de propinas.
- Liquidaciones de propinas.
- Reportes agregados de propinas, ventas u horas.
- Control duro de asistencia, tolerancias, atrasos o bloqueo por horario.

## Decisiones

- El garzón sigue sin ser usuario del sistema. Se identifica con su PIN dentro de
  la sesión JWT activa del tenant.
- Los turnos son un catálogo operativo, no una regla de bloqueo. `hora_inicio` y
  `hora_fin` son referenciales.
- La hora real trabajada sale de `inicio_el` y `fin_el` en la sesión, no del horario
  referencial del turno.
- El sistema permite máximo una sesión abierta por garzón y tenant.
- La operación diaria usa PIN; el backoffice puede cerrar sesiones olvidadas sin
  PIN, registrando el usuario autenticado que hizo el cierre.
- Los errores de PIN o sesión son `400 Bad Request`, no `401`, para no gatillar
  refresh/logout de la sesión del dispositivo.
- RBAC reutiliza el módulo contratado `Salones`, igual que el módulo de garzones
  actual.

## Modelo de Datos

### Tabla `turnos`

- `turno_id`: UUID PK.
- `tenant_id`: UUID FK a `tenants`.
- `nombre`: nombre visible del turno, por ejemplo "Mañana".
- `hora_inicio`: string/columna time con formato `HH:mm`.
- `hora_fin`: string/columna time con formato `HH:mm`.
- `activo`: boolean, default `true`.
- `creado_el`, `actualizado_el`, `eliminado_el`.

Reglas:

- `tenant_id` siempre viene del token, nunca del body.
- Nombre único por tenant entre turnos no eliminados.
- Las lecturas filtran `eliminado_el IS NULL`.
- No se permite eliminar/desactivar un turno si tiene sesiones abiertas.
- Se permite eliminar/desactivar un turno con sesiones históricas cerradas; el
  historial conserva su `turno_id`.

### Tabla `sesiones_garzon`

- `sesion_garzon_id`: UUID PK.
- `tenant_id`: UUID FK a `tenants`.
- `garzon_id`: UUID FK a `garzones`.
- `turno_id`: UUID FK a `turnos`.
- `inicio_el`: timestamptz.
- `fin_el`: timestamptz nullable.
- `estado`: `abierta` o `cerrada`.
- `origen_cierre`: `pin` o `admin`, nullable mientras está abierta.
- `cerrada_por_usuario_id`: UUID nullable, usado en cierre administrativo.
- `creado_el`, `actualizado_el`, `eliminado_el`.

Reglas:

- Solo garzones activos pueden iniciar sesión.
- Solo turnos activos pueden iniciar sesión.
- Cerrar una sesión fija `fin_el`, cambia estado a `cerrada` y no se recalcula
  automáticamente ante cambios posteriores.
- Debe existir una restricción efectiva para impedir dos sesiones abiertas del
  mismo garzón en el mismo tenant.

## API

### Turnos

Todos los endpoints usan `JwtAuthGuard`, `TenantGuard`, `PermisosGuard` y
`@RequiresPermiso('Salones', ...)`.

- `GET /turnos` (`Salones:Leer`): lista turnos del tenant.
- `POST /turnos` (`Salones:Crear`): crea `{ nombre, horaInicio, horaFin, activo? }`.
- `PATCH /turnos/:id` (`Salones:Actualizar`): actualiza nombre, horario o estado.
- `DELETE /turnos/:id` (`Salones:Eliminar`): soft delete.

Validaciones:

- `nombre` requerido, texto no vacío.
- `horaInicio` y `horaFin` requeridos, formato `HH:mm` 24h.
- `activo` opcional boolean.

### Sesiones de garzón

- `POST /sesiones-garzon/iniciar` (`Salones:Operar`):
  body `{ pin, turnoId }`; resuelve el garzón por PIN y abre una sesión.
- `POST /sesiones-garzon/cerrar` (`Salones:Operar`):
  body `{ pin }`; resuelve el garzón por PIN y cierra su sesión abierta.
- `POST /sesiones-garzon/activa` (`Salones:Operar`):
  body `{ pin }`; consulta la sesión abierta de un garzón identificado por PIN.
- `GET /sesiones-garzon/abiertas` (`Salones:Leer`):
  lista sesiones abiertas del tenant.
- `GET /sesiones-garzon` (`Salones:Leer`):
  historial paginado con filtros por `garzonId`, `turnoId`, `estado`,
  `desde` y `hasta`.
- `POST /sesiones-garzon/:id/cerrar` (`Salones:Actualizar`):
  cierre administrativo sin PIN; registra `cerrada_por_usuario_id`.

Errores esperados:

- PIN inválido: `400 "PIN inválido"`.
- Garzón inactivo: `400 "El garzón está inactivo"`.
- Turno inexistente o inactivo: `400 "Turno inválido o inactivo"`.
- Segunda sesión abierta: `400 "El garzón ya tiene una sesión abierta"`.
- Cierre sin sesión abierta: `400 "El garzón no tiene una sesión abierta"`.
- Abrir o cerrar cuenta sin sesión abierta:
  `400 "El garzón no tiene una sesión de trabajo abierta"`.

## Integración con Salones

`SalonesService` mantiene el contrato actual: al abrir y cerrar cuenta recibe `pin`
en `CreateCuentaDto` y `CerrarCuentaDto`.

El flujo queda:

1. Resolver garzón por PIN usando `GarzonesService`.
2. Verificar sesión abierta del garzón en el tenant usando `SesionesGarzonService`.
3. Si no existe sesión abierta, rechazar con `400`.
4. Persistir `garzon_apertura_id` o `garzon_cierre_id` como hoy.

Esto hace obligatoria la marca de entrada para operar una cuenta, sin cambiar el
payload que ya consume el frontend de salones.

## Frontend

### Configuración de turnos

Nueva página `frontend/app/pages/configuracion/turnos.vue`, siguiendo el patrón CRUD
del frontend:

- Estado local con `ref`, sin store.
- `useApiFetch`, sin axios.
- POST/PATCH/DELETE actualizan la lista local con la respuesta del backend, sin
  re-fetch completo.
- Campos: nombre, hora inicio, hora fin, activo.
- Link en la navegación de Configuración, visible según permisos de `Salones`.

### Sesiones en operación de salones

En `frontend/app/pages/salones/index.vue`:

- Acción "Entrar a turno".
  - Selecciona turno activo.
  - Solicita PIN con el modal existente `GarzonPinModal`.
  - Llama a `POST /sesiones-garzon/iniciar`.
- Acción "Salir de turno".
  - Solicita PIN.
  - Llama a `POST /sesiones-garzon/cerrar`.
- Si al abrir o cerrar cuenta el backend responde que no hay sesión abierta, mostrar
  un toast claro y ofrecer el flujo de "Entrar a turno".

### Administración de sesiones

Nueva página `frontend/app/pages/configuracion/sesiones-garzon.vue`:

- Lista de sesiones abiertas con garzón, turno e inicio.
- Acción "Forzar cierre" para usuarios con `Salones:Actualizar`.
- Historial paginado con filtros por fecha, garzón, turno y estado.

## Seed de Desarrollo

El seeder crea turnos demo para el tenant principal:

- Mañana: `08:00` a `15:00`.
- Tarde: `15:00` a `22:00`.
- Noche: `22:00` a `08:00`.

No se crean sesiones demo abiertas. La operación manual debe iniciar sesión con PIN.

## Testing

Backend unit tests:

- Crear turno correctamente.
- Rechazar nombre duplicado por tenant.
- Rechazar horario con formato inválido.
- Bloquear desactivar/eliminar turno con sesiones abiertas.
- Iniciar sesión por PIN con garzón y turno activos.
- Rechazar segunda sesión abierta del mismo garzón.
- Cerrar sesión por PIN.
- Rechazar cierre sin sesión abierta.
- Cierre administrativo registra `cerrada_por_usuario_id`.
- `SalonesService` rechaza abrir y cerrar cuenta si el garzón no tiene sesión
  abierta.

Frontend/manual:

- Crear, editar, activar/desactivar y eliminar turnos desde Configuración.
- Iniciar turno con PIN correcto y turno activo.
- Intentar iniciar dos veces el mismo garzón y ver error.
- Abrir cuenta con sesión abierta.
- Cerrar sesión y confirmar que abrir/cerrar cuenta vuelve a fallar.
- Forzar cierre administrativo de una sesión abierta.

## Documentación Viva

Al implementar esta spec se deben actualizar en el mismo commit:

- `docs/features/garzones.md` o una nueva `docs/features/turnos-garzones.md`.
- `docs/README.md` si se crea feature doc nueva.
- `docs/ESTADO.md`.
- `docs/ARCHITECTURE.md` si se agrega el módulo al mapa de backend/frontend.
- `startup-pos.sql` con las tablas nuevas.
