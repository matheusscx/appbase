# Feature: Gestión de Garzones (PIN operativo)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-13

---

## Overview

### ¿Qué es?

Registro de **garzones** por tenant, cada uno con un **PIN secreto de 6 dígitos**.
En un restaurante, uno o más dispositivos (tablet/tótem) son compartidos por todos
los garzones. En vez de iniciar/cerrar sesión con usuario+contraseña en cada cambio
de turno, el dispositivo permanece con la **sesión del restaurante** ya autenticada y
el sistema pide el **PIN del garzón** al abrir o cerrar una cuenta.

### ¿Por qué existe?

- Evitar el login/logout continuo en dispositivos compartidos.
- Identificar rápido al garzón responsable de cada cuenta.
- Incorporar personal temporal **sin crear usuarios del sistema**.
- Trazabilidad de **quién abrió y quién cerró** cada cuenta.

Un garzón **no es un usuario del sistema**: no tiene login ni JWT. El PIN es un
**identificador operativo** dentro de la sesión del tenant ya autenticada — no toca
el sistema de tokens.

### Scope

- **Incluido**: CRUD de garzones, reset de PIN, identificación por PIN, y captura del
  garzón responsable al **abrir** y **cerrar** una cuenta.
- **NO incluido (futuro)**: transferir cuentas entre mesas con PIN, log por cada
  acción individual (agregar línea, fusionar), turnos/horarios de garzón.

---

## Decisiones de diseño

- **Identificación solo por PIN**: el garzón teclea su PIN y el sistema lo identifica
  (flujo POS clásico). Requiere **PIN único por tenant**.
- **PIN hasheado** con bcrypt (cost 10, igual que las contraseñas). El admin nunca lo
  ve; si se olvida, se **resetea**. La API jamás devuelve `pin_hash`.
- **RBAC**: reutiliza el módulo contratado `Salones` (sin nuevo `tenant_modulos`). El
  CRUD usa `Leer/Crear/Actualizar/Eliminar`; la identificación por PIN usa `Operar`.

---

## API Endpoints

Todos bajo `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`; `tenant_id` del JWT.

| Método | Ruta | Permiso (`Salones`) | Descripción |
|---|---|---|---|
| GET | `/garzones` | `Leer` | Lista garzones del tenant (sin `pin_hash`) |
| POST | `/garzones` | `Crear` | Crea `{ nombre, pin, activo? }` |
| PATCH | `/garzones/:id` | `Actualizar` | Actualiza `{ nombre?, activo? }` |
| PATCH | `/garzones/:id/pin` | `Actualizar` | Resetea el PIN `{ pin }` |
| DELETE | `/garzones/:id` | `Eliminar` | Soft delete |
| POST | `/garzones/identificar` | `Operar` | `{ pin }` → `{ garzonId, nombre }` (o 400) |

Al **abrir** cuenta (`POST /mesas/:id/cuentas`) y **cerrar** cuenta
(`POST /cuentas/:id/cerrar`) el body incluye ahora `pin` (6 dígitos). El backend
resuelve el garzón y persiste `garzon_apertura_id` / `garzon_cierre_id`.

---

## Backend

- **Módulo**: `src/modules/garzones/garzones.module.ts` (exporta `GarzonesService`,
  consumido por `SalonesModule`).
- **Controller**: `src/modules/garzones/garzones.controller.ts`
- **Service**: `src/modules/garzones/garzones.service.ts`
- **Entidad**: `Garzon` → tabla `garzones`

### Tabla `garzones`

| Columna | Tipo | Notas |
|---|---|---|
| `garzon_id` | UUID PK | |
| `tenant_id` | UUID | FK tenants |
| `nombre` | VARCHAR(100) | |
| `pin_hash` | TEXT | bcrypt; nunca expuesto |
| `activo` | BOOLEAN | default `true` |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

`cuentas` gana `garzon_apertura_id` y `garzon_cierre_id` (UUID nullable, FK a `garzones`).

### Métodos clave del service

- `crear` / `resetPin` — validan **PIN único** por tenant (bcrypt.compare contra los
  existentes) y hashean.
- `resolverGarzonPorPin(tenantId, pin)` — itera garzones **activos** del tenant y
  compara con bcrypt; devuelve el garzón o lanza `400 PIN inválido`. Es un `400`
  (no `401`) a propósito: un PIN incorrecto es un error operativo, no un fallo de
  autenticación de la sesión del dispositivo — un `401` haría que el frontend
  (`useApiFetch`) intente refrescar el token y cierre la sesión del restaurante.
  Usado por el endpoint `identificar` y por `SalonesService` al abrir/cerrar.

---

## Frontend

- **Composable**: `app/composables/useGarzones.ts` (`listar/crear/actualizar/resetPin/
  eliminar/identificar`).
- **Página admin**: `pages/configuracion/garzones.vue` — tabla con crear/editar,
  reset de PIN y eliminar. Entrada de nav bajo Configuración (gated `Salones/Crear`).
- **Componente**: `components/salones/GarzonPinModal.vue` — teclado numérico de 6
  dígitos que auto-verifica vía `identificar` y emite el PIN. Reutilizado al abrir y
  cerrar cuentas en `pages/salones/index.vue`, que muestra el garzón responsable.

---

## Testing

### Unit (backend)

```bash
cd backend && npx jest garzones salones
```

Cubre: hash y unicidad del PIN, `resolverGarzonPorPin` (match / 400), reset de PIN, y
que abrir/cerrar cuenta persisten `garzon_apertura_id`/`garzon_cierre_id`.

### Manual (frontend)

1. `docker-compose up` (el seeder crea garzones demo: Ana=111111, Bruno=222222,
   Carla=333333 en el tenant Paris).
2. Configuración → Garzones: crear/editar, resetear PIN.
3. Salones → abrir cuenta: PIN correcto abre la cuenta con el responsable visible;
   PIN incorrecto muestra "PIN inválido".
4. Cerrar y cobrar: pide el PIN antes de generar la venta.

---

## Related Features

- [Salones y Mesas](./salones-mesas.md)
- [Ventas](./ventas.md)
