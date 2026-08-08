# Feature: Turnos y Sesiones de Garzón

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-08-06 (fin de turno con mesas abiertas: avisar y ofrecer transferir)

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
- **El fin de turno no se bloquea aunque el garzón deje mesas abiertas**
  (decisión del owner, 2026-08-06). Cobrar una cuenta exige que su **responsable**
  esté en turno —la propina se atribuye a esa sesión—, así que un garzón que
  marca salida con una mesa abierta la deja sin poder cobrarse hasta que alguien
  la reciba. No hace falta ninguna carrera para llegar ahí: es el martes normal
  de un restaurante. Bloquear el cierre sería peor (el garzón se va igual, y
  ahora con la sesión abierta contando horas), así que los dos cierres —PIN y
  admin— **devuelven las cuentas que quedaron a su nombre** y la UI ofrece
  transferirlas a alguien en turno. Aceptar la oferta es opcional: el estado
  "cuenta sin responsable en turno" es válido y reversible con una transferencia.
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
| POST | `/sesiones-garzon/iniciar` | `Operar` | `{ garzonId, pin, turnoId }` → abre sesión |
| POST | `/sesiones-garzon/cerrar` | `Operar` | `{ garzonId, pin }` → cierra sesión abierta |
| POST | `/sesiones-garzon/activa` | `Operar` | `{ garzonId, pin }` → sesión abierta o `null` |
| GET | `/garzones/para-selector?enTurno=` | `Operar` | Las dos listas del selector. `enTurno` **obligatorio** |
| POST | `/garzones/verificar-pin` | `Operar` | `{ garzonId, pin }` → valida **sin ejecutar nada** |
| GET | `/sesiones-garzon/abiertas` | `Leer` | Sesiones abiertas del tenant |
| GET | `/sesiones-garzon` | `Leer` | Historial paginado (`garzonId`, `turnoId`, `estado`, `desde`, `hasta`) |
| POST | `/sesiones-garzon/:id/cerrar` | `Actualizar` | Cierre admin (sin PIN); registra `cerrada_por_usuario_id` |

`desde`/`hasta` son **fechas puras** (`YYYY-MM-DD`) y se interpretan en la **zona horaria
del tenant**, con `hasta` **inclusivo del día completo**: "Desde hoy / Hasta hoy" devuelve
las sesiones de hoy. Sin el cast a la zona, un tenant en Chile perdía las que arrancan
entre las 20:00 y la medianoche local — el grueso del servicio. Mismo patrón que
`propina-reportes` (allá `hasta` es exclusivo, porque el rango lo arma un reporte y no un
selector de fechas).

Los **dos cierres** (PIN y admin) devuelven la sesión más
`cuentasPendientes: { cuentaId, numero, mesaNombre, salonNombre }[]` — las
cuentas abiertas que quedaron a nombre del garzón. Lista vacía en el caso normal.
No es un error: el cierre ya ocurrió.

Errores esperados (todos `400`):

| Situación | Mensaje |
|---|---|
| PIN incorrecto | `PIN inválido` |
| Garzón inactivo | `El garzón está inactivo` |
| Turno inválido/inactivo | `Turno inválido o inactivo` |
| Segunda sesión abierta | `El garzón ya tiene una sesión abierta` |
| Cierre sin sesión | `El garzón no tiene una sesión abierta` |
| Abrir/cerrar cuenta sin sesión **propia** | `El garzón no tiene una sesión de trabajo abierta` |
| Cobrar una cuenta cuyo **responsable** salió de turno | `El garzón responsable de la cuenta ya no está en turno. Transferí la cuenta a alguien en turno para poder cobrarla.` |

Los dos últimos son distintos a propósito: Salones usa la frase *"sesión de
trabajo"* como señal para abrir el modal de entrar a turno, y el segundo caso no
es del que está operando —mandarlo a iniciar un turno que ya tiene es un callejón
sin salida.

### El PIN ya no se teclea a ciegas

Desde el 2026-08-08 todo flujo que pide PIN muestra **primero un selector de garzón**:
con el garzón elegido la verificación cuesta **un** bcrypt en vez de uno por garzón del
local. *Entrar a turno* lista a los que **no** están en turno; los demás flujos, a los que
**sí**. Detalle y medición: [`garzones.md`](./garzones.md).

`POST /garzones/verificar-pin` existe para que el modal muestre *"PIN inválido"* en línea:
valida sin ejecutar la acción, así el usuario corrige sin perder lo que estaba haciendo.

### Editar un garzón con la sesión abierta: qué bloquea y qué solo advierte

No todas las ediciones pesan igual, y la regla es **si rompe la operación del
garzón en este momento** (decisión del owner, 2026-08-07):

| Acción con sesión abierta | Qué hace | Por qué |
|---|---|---|
| Eliminar | **Bloquea** (`400`) | Deja la sesión abierta con `fin_el = null` y sin nadie que pueda cerrarla |
| Desactivar | **Bloquea** (`400`) | `verificarPin` filtra `activo: true`: el garzón no puede ni marcar salida |
| Cambiar el `tipo` | **Advierte** | El reparto usa `sesion_garzon.tipo_garzon`, congelado al abrir: el turno en curso no se altera. Bloquear obligaría a cerrar el turno para corregir un tipo mal cargado |
| Regenerar el PIN | **Advierte** | Rotar una credencial es la respuesta a una filtración; trabarla por un turno abierto sería la política al revés |

Las dos que advierten devuelven `advertencias: string[]` en la respuesta —siempre
presente, vacío cuando no hay nada que decir, misma forma que `ventas` e
`items`—. Dónde se muestran **no** es intercambiable: la del `tipo` sale como
toast `warning` después del de éxito (el cambio se guardó), y la del PIN va
**dentro del modal que revela el PIN**, porque habla de ese PIN y de la urgencia
de entregarlo; un toast detrás del modal se pierde.

⚠️ **"Advierte" no quiere decir "sin consecuencias".** El mensaje del `tipo` dice
además que, si la persona genera propinas con los dos tipos dentro de un mismo
período, la liquidación de ese período **no se va a poder cerrar** hasta partirlo
en dos: es la regla 2b de
[`liquidacion-propinas-motor.md`](./liquidacion-propinas-motor.md), que corta con
un `400` nombrando a la persona, sus dos grupos y una fecha de corte sugerida.
Sin esa segunda frase el aviso suena inocuo y el admin no se entera de que acaba
de programar ese bloqueo.

⚠️ La advertencia del `tipo` solo aparece si el valor **cambia**. Los formularios
mandan el objeto entero, así que `tipo` viaja aunque nadie lo haya tocado:
comparar contra el actual es lo que evita advertir de más en cada cambio de
nombre —y es también lo que deja el `PATCH` en **una sola** consulta de sesiones
cuando desactiva y cambia el tipo a la vez.

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
| `tipo_garzon` | TEXT | snapshot de `garzones.tipo` al **iniciar** la sesión; CHECK `garzon` \| `cocina` \| `barra` |
| `inicio_el` | TIMESTAMPTZ | |
| `fin_el` | TIMESTAMPTZ | nullable mientras abierta |
| `estado` | `abierta` \| `cerrada` | |
| `origen_cierre` | `pin` \| `admin` | nullable si abierta |
| `cerrada_por_usuario_id` | UUID | nullable; cierre admin |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

Restricción efectiva: una sola sesión `abierta` por `(tenant_id, garzon_id)`.
Índice único `(tenant_id, sesion_garzon_id, turno_id)` para FK compuesta desde
`venta_propina` (liquidación E1).

### Métodos clave

- `TurnosService.create/update/remove` — CRUD; bloquea desactivar/eliminar con
  sesiones abiertas.
- `SesionesGarzonService.iniciar` / `cerrarPorPin` / `activaPorPin` — operación
  diaria con PIN. Al iniciar congela `tipo_garzon` del garzón.
- `SesionesGarzonService.cerrarAdmin` — cierre forzado; `origen_cierre = admin`.
- `SesionesGarzonService.assertSesionAbierta` — gate de Salones: tira 400 si el
  garzón que opera no está en turno.
- `SesionesGarzonService.buscarSesionAbierta` — la misma consulta devolviendo
  `null` en vez de tirar, para el llamador que necesita explicar **de quién** es
  la sesión que falta (`cerrarCuenta`, por el responsable de la cuenta).
- `SesionesGarzonService.cuentasPendientes` (privado) — una sola query con los
  nombres ya resueltos. Va por SQL y no delegado a `SalonesService` porque la
  dependencia entre módulos corre al revés (`SalonesModule` importa
  `TurnosModule`). Los JOIN a `mesas`/`salones` son `LEFT`: una cuenta abierta
  sobre una mesa borrada es la que más urge no perder de vista.

---

## Frontend

- **Composables**: `useTurnos.ts`, `useSesionesGarzon.ts`
- **Config → Turnos**: `pages/configuracion/turnos.vue` — CRUD local (`ref` +
  upsert/remove sin re-fetch).
- **Módulo → Sesiones**: `pages/sesiones-garzon.vue` — abiertas + forzar cierre +
  historial filtrado (tabs). Ruta antigua `/configuracion/sesiones-garzon` redirige.
  Tras forzar un cierre con mesas abiertas ofrece transferirlas por admin.
- **Salones**: `pages/salones/index.vue` — “Entrar a turno” / “Salir de turno”
  con `GarzonPinModal`; toast si falta sesión al abrir/cerrar cuenta. Al salir de
  turno con mesas abiertas ofrece transferirlas por PIN.
- `useTransferenciaPendientes()` y `etiquetaCuentaPendiente()` en
  `useSesionesGarzon.ts` — el estado del modal, el bucle de transferencia y la
  línea "Terraza · Mesa 4 — Cuenta 2" que comparten las dos pantallas. El bucle
  vive en el composable y no duplicado en cada página porque lo delicado no es
  el bucle sino su bookkeeping (cortar en el primer error, no perder lo que
  faltaba, no pisar una oferta más nueva), y con las dos copias sueltas el
  gemelo de Salones no tenía cómo testearse.

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

### Salir de turno con mesas abiertas

```
[Salones → Salir de turno + PIN]        [Sesiones → Forzar cierre]
  ↓                                       ↓
[POST /sesiones-garzon/cerrar]          [POST /sesiones-garzon/:id/cerrar]
  ↓ sesión CERRADA + cuentasPendientes[] ↓ ídem
[Modal "Dejaste mesas abiertas"]        [Modal "Quedaron mesas sin responsable"]
  ↓ PIN del que se hace cargo             ↓ select de garzones EN TURNO
[POST /cuentas/:id/transferir]          [POST /cuentas/:id/transferir-admin]
```

En los dos, la transferencia va **cuenta por cuenta y corta en el primer error**:
los errores de este flujo son del destinatario (PIN inválido, fuera de turno), no
de una cuenta puntual, así que seguir solo repetiría el mismo mensaje. Lo que no
alcanzó a transferirse queda en el modal para reintentar. En el cierre admin los
destinos salen de las **sesiones abiertas**, no del catálogo de garzones: el
backend rechaza transferir a quien no tiene sesión.

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
6. Con Ana y Bruno (`222222`) en turno: Ana abre una mesa con productos y sale de
   turno → modal con la mesa → transferir con el PIN de Bruno → la cuenta ya
   figura a nombre de Bruno y se puede cobrar.
7. Lo mismo declinando la oferta ("Ahora no"): cobrar esa mesa devuelve *"El
   garzón responsable de la cuenta ya no está en turno…"*, y **no** abre el modal
   de entrar a turno.

---

## Acceptance Criteria

- [x] CRUD turnos con soft delete y validaciones
- [x] Sesión PIN iniciar / cerrar / activa
- [x] Cierre admin + listado abiertas / historial
- [x] Sesión obligatoria al abrir/cerrar cuenta
- [x] Horarios referenciales (sin validación de ventana)
- [x] Errores operativos como `400`, no `401`
- [x] Salir de turno con mesas abiertas: avisa y ofrece transferir (PIN y admin)
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
