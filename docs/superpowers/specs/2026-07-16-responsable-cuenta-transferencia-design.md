# Diseño: Responsable de Cuenta, Transferencia e Historial

**Status**: Draft / Approved (pending user review of written spec)
**Owner**: Cesar Matheus
**Date**: 2026-07-16

---

## Contexto

Con el subproyecto B (turnos y sesiones) operativo, un garzón necesita sesión
abierta para abrir o cerrar cuentas. Hoy `cuentas` solo guarda
`garzon_apertura_id` (quien abrió) y `garzon_cierre_id` (quien cerró). No hay
responsable vigente, forma de transferir la atención entre garzones ni historial
auditable de asignaciones.

Eso bloquea el flujo real del salón (un compañero toma una mesa) y la atribución
futura de propinas/ventas al responsable correcto (subproyectos D/E).

Este diseño cubre el subproyecto C del requerimiento de gestión de garzones,
turnos y propinas.

## Alcance

Incluido en esta fase:

- Columna `garzon_responsable_id` en `cuentas` (responsable vigente).
- Tabla append-only `cuenta_asignaciones` con timeline completo (apertura + cada
  transferencia).
- Transferencia operativa por PIN (claim: cualquier garzón con sesión abierta
  toma la cuenta con su PIN).
- Transferencia administrativa forzada (JWT + permiso `Salones`, sin PIN destino).
- Consulta del historial de asignaciones de una cuenta.
- UI en salones: mostrar responsable vigente, Tomar cuenta, Transferir admin,
  Ver historial.
- Backfill de cuentas existentes desde `garzon_apertura_id`.

Fuera de alcance de esta fase:

- Registro y distribución de propinas (D).
- Liquidaciones de propinas (E).
- Reportes agregados (F).
- Transferencia especial al fusionar cuentas (la destino conserva su responsable;
  las absorbidas se cancelan y cierran su tramo).
- Notificaciones al garzón anterior.
- Motivo libre / comentario en transferencia (v1: solo el tipo de motivo).
- Mostrar responsable en el plano de mesas (solo drawer / lista de cuentas).
- Página admin dedicada solo a transferencias.

## Decisiones

| Tema | Decisión |
|---|---|
| Quién transfiere | Claim por PIN + admin fuerza desde backoffice |
| Atribución futura (D/E) | Responsable vigente ≠ garzón de cierre; propinas/ventas usan **responsable vigente** |
| Historial | Apertura + cada transferencia (timeline completo) |
| Arquitectura | `garzon_responsable_id` + tabla `cuenta_asignaciones` |
| Errores operativos | `400 Bad Request` (PIN inválido, sin sesión, cuenta cerrada) |
| RBAC | Módulo `Salones`, mismos permisos que operación de cuentas |
| Sesión obligatoria | El destino (PIN o admin) debe tener sesión abierta (hereda regla de B) |

### Tres roles en la cuenta

```
garzon_apertura_id    → inmutable, quien abrió (auditoría)
garzon_responsable_id → vigente, cambia con transferencias (propinas/ventas futuras)
garzon_cierre_id      → quien cerró con PIN (auditoría, solo al cerrar)
```

## Modelo de Datos

### Cambio en `cuentas`

Nueva columna:

- `garzon_responsable_id`: UUID FK → `garzones`, nullable. Responsable vigente.
  Al abrir = quien abrió. Cambia en cada transferencia.

Sin cambio:

- `garzon_apertura_id` — inmutable.
- `garzon_cierre_id` — solo al cerrar.

Índice: `idx_cuentas_responsable` sobre `(tenant_id, garzon_responsable_id)` para
reportes futuros (D/F).

### Tabla `cuenta_asignaciones` (append-only)

- `cuenta_asignacion_id`: UUID PK.
- `tenant_id`: UUID FK a `tenants` (del token, nunca del body).
- `cuenta_id`: UUID FK a `cuentas`.
- `garzon_id`: UUID FK a `garzones` — quien queda responsable en este tramo.
- `desde_el`: timestamptz — inicio del tramo.
- `hasta_el`: timestamptz nullable — `NULL` = tramo vigente; se cierra al
  transferir o al cerrar/cancelar la cuenta.
- `motivo`: text — `'apertura'` | `'transferencia_pin'` | `'transferencia_admin'`.
- `origen_garzon_id`: UUID FK nullable — responsable anterior (`NULL` en apertura).
- `actor_usuario_id`: UUID FK nullable — usuario JWT que forzó (solo
  `transferencia_admin`).
- `creado_el`, `actualizado_el`, `eliminado_el` — soft delete estándar; en
  práctica no se edita ni borra (append-only).

Índices:

- `(tenant_id, cuenta_id, desde_el)` — timeline de una cuenta.
- Índice parcial único: una sola fila con `hasta_el IS NULL` por `cuenta_id`
  (un responsable vigente a la vez).

### Flujo de escritura (transacción)

1. **Abrir cuenta:** setea `garzon_responsable_id = garzon_apertura_id` e inserta
   fila `motivo='apertura'`, `hasta_el=NULL`.
2. **Transferir (PIN o admin):** lock pesimista sobre la cuenta; cierra el tramo
   vigente (`hasta_el=now()`); inserta nuevo tramo con el destino; actualiza
   `garzon_responsable_id`.
3. **Cerrar / cancelar cuenta:** cierra el tramo vigente (`hasta_el=now()`). No
   cambia `garzon_responsable_id` (queda congelado para D).

### Backfill (cuentas existentes)

Al migrar / arrancar el esquema:

1. `UPDATE cuentas SET garzon_responsable_id = garzon_apertura_id WHERE
   garzon_responsable_id IS NULL AND garzon_apertura_id IS NOT NULL`.
2. Insertar una fila `apertura` por cada cuenta con `garzon_apertura_id` que aún
   no tenga asignaciones: `desde_el = abierta_el`, `hasta_el = cerrada_el` (o
   `NULL` si sigue abierta).

### Seed

No requiere garzones/cuentas nuevas de seed. Las cuentas demo, al abrirse vía
código nuevo, ya generan la asignación. El backfill cubre lo que ya exista en
Docker.

## API

Todos los endpoints viven bajo el módulo Salones / Cuentas, con `JwtAuthGuard`,
`TenantGuard`, `PermisosGuard` y `@RequiresPermiso('Salones', ...)`.

### Respuestas de cuenta

`CuentaDetalle` agrega:

- `garzonResponsableId`
- `garzonResponsableNombre`

Se mantienen `garzonApertura*` y `garzonCierre*` para auditoría.

### Transferencia operativa por PIN

`POST /cuentas/:cuentaId/transferir` (`Salones:Operar`)

Body: `{ "pin": "1234" }`

Reglas:

- Cuenta del tenant y estado `abierta`.
- PIN resuelve a garzón activo.
- Ese garzón debe tener sesión abierta.
- Cualquier garzón con sesión puede tomar la cuenta (claim).
- Si ya es responsable: `400 "El garzón ya es responsable de la cuenta"`.
- Actualiza `garzon_responsable_id` y registra `motivo='transferencia_pin'`.

### Transferencia administrativa

`POST /cuentas/:cuentaId/transferir-admin` (`Salones:Actualizar`)

Body: `{ "garzonId": "uuid" }`

Reglas:

- JWT + permiso `Salones:Actualizar`.
- Cuenta abierta.
- Garzón destino activo y con sesión abierta.
- Registra `actor_usuario_id` y `motivo='transferencia_admin'`.

### Historial

`GET /cuentas/:cuentaId/asignaciones` (`Salones:Leer`)

Timeline ordenado por `desde_el ASC`. Cada ítem incluye:

- `id`, `garzonId`, `garzonNombre`
- `desdeEl`, `hastaEl`
- `motivo`
- `origenGarzonId`, `origenGarzonNombre`
- `actorUsuarioId`, `actorUsuarioNombre`

### Integración con flujos existentes

- `abrirCuenta`: setea responsable + asignación `apertura` (además de
  `garzon_apertura_id` y assert de sesión).
- `cerrarCuenta`: setea `garzon_cierre_id`, cierra tramo vigente, **no**
  sobrescribe responsable.
- `cancelarCuenta`: cierra el tramo vigente si existe.
- `fusionarCuentas`: la destino mantiene su responsable; orígenes cancelados
  cierran su tramo.
- Líneas (agregar/actualizar/quitar): no cambian responsable.

### Concurrencia

Transferencia y cierre usan lock pesimista sobre `cuentas` para evitar:

- dos claims concurrentes
- transferencia mientras se cierra
- cierre doble

### Errores

Siempre `400` (nunca `401`) por PIN/sesión/estado operativo:

| Situación | Mensaje |
|---|---|
| PIN inválido / garzón inactivo | PIN inválido o garzón inactivo |
| Sin sesión abierta | El garzón no tiene una sesión de trabajo abierta |
| Cuenta no abierta | La cuenta no está abierta |
| Ya es responsable | El garzón ya es responsable de la cuenta |
| Destino inexistente/inactivo (admin) | Garzón no encontrado o inactivo |
| Destino sin sesión (admin) | El garzón destino no tiene una sesión de trabajo abierta |

`404` solo si la cuenta no existe o no pertenece al tenant.

## Frontend

Todo en `frontend/app/pages/salones/index.vue` + `useSalones`, reutilizando
`solicitarPin` / `GarzonPinModal`. Sin página nueva.

### Visualización

- Lista de cuentas de la mesa y detalle: mostrar `garzonResponsableNombre` con
  etiqueta “Responsable”.
- Apertura/cierre quedan en el historial; no son el dato principal en operación.

### Tomar cuenta (operación)

1. Botón **Tomar cuenta** en detalle de cuenta abierta.
2. `GarzonPinModal` (“PIN para tomar esta cuenta”).
3. `POST .../transferir`.
4. Toast: `Cuenta tomada por {nombre}`.
5. Actualizar el `ref` local de la cuenta (sin re-fetch completo de la lista).

Si falla por sesión de trabajo: reusar CTA “Entrar a turno” del helper existente.

### Transferir (admin)

Para quien tenga `Salones:Actualizar` (o el permiso equivalente de edición):

1. Botón **Transferir**.
2. Modal con selector de garzones activos.
3. `POST .../transferir-admin` con `garzonId`.
4. Actualizar detalle local.

### Historial

- Botón/link **Ver historial** en el detalle.
- Timeline: quién, desde/hasta, motivo.
- Motivos en español: Apertura / Transferencia / Transferencia admin.

### Composable `useSalones`

- `transferirCuenta(cuentaId, pin)`
- `transferirCuentaAdmin(cuentaId, garzonId)`
- `listarAsignaciones(cuentaId)`
- Tipado de `CuentaDetalle` con `garzonResponsableId` / `garzonResponsableNombre`

## Testing

Backend (`salones.service.spec.ts` + helpers de sesión):

- Abrir cuenta setea `garzon_responsable_id` e inserta asignación `apertura`.
- Transferir por PIN cambia responsable, cierra tramo anterior y abre uno nuevo.
- Transferir admin registra `actor_usuario_id` y motivo `transferencia_admin`.
- Rechaza transferir si cuenta cerrada / PIN inválido / sin sesión / ya responsable.
- Cerrar cuenta setea `garzon_cierre_id` y cierra tramo vigente **sin** cambiar
  responsable.
- Cancelar cierra el tramo vigente.
- Historial: apertura + N transferencias en orden.
- No quedan dos tramos vigentes (índice parcial / lock).

Frontend/manual:

- Tras transferir, el detalle muestra el nuevo responsable.
- Toast de “sesión de trabajo” ofrece CTA a entrar a turno.

## Criterios de Done

1. Columna + tabla + backfill aplicados.
2. Abrir / transferir(PIN) / transferir(admin) / historial funcionan.
3. Cerrar/cancelar cierran el tramo vigente sin pisar responsable.
4. UI salones: responsable vigente, Tomar cuenta, Transferir admin, Ver historial.
5. Spec + `docs/ESTADO.md` + feature doc + `startup-pos.sql` actualizados en el
   mismo commit de implementación.
6. Listo para D: atribución de propinas lee `garzon_responsable_id`.

## Documentación Viva

Al implementar esta spec se deben actualizar en el mismo commit:

- `docs/features/salones-mesas.md` (responsable, transferencia, historial).
- `docs/ESTADO.md`.
- `startup-pos.sql` con `garzon_responsable_id` y `cuenta_asignaciones`.
- `docs/ARCHITECTURE.md` solo si el mapa de módulos/API lo requiere.
