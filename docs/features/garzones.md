# Feature: Gestión de Garzones (PIN operativo)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-17 (tipo garzón/cocina/barra para liquidación)

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
- Identificar al garzón por PIN en dispositivos compartidos (apertura, cierre,
  claim de cuenta).
- Incorporar personal temporal **sin crear usuarios del sistema**.
- Trazabilidad de **quién abrió y quién cerró** cada cuenta (auditoría).

Un garzón **no es un usuario del sistema**: no tiene login ni JWT. El PIN es un
**identificador operativo** dentro de la sesión del tenant ya autenticada — no toca
el sistema de tokens.

### Scope

- **Incluido**: CRUD de garzones, regeneración de PIN, identificación por PIN, y
  captura de auditoría al **abrir** (`garzon_apertura_id`) y **cerrar**
  (`garzon_cierre_id`) una cuenta. Al abrir también se setea el responsable
  vigente inicial (`garzon_responsable_id`); ese campo cambia con transferencias
  (ver [salones-mesas.md](./salones-mesas.md)). Campo `tipo` (`garzon` | `cocina`
  | `barra`) para agrupar en liquidación de propinas (E1).
- **NO incluido (futuro)**: mover cuentas entre mesas con PIN, log por cada
  acción individual (agregar línea, fusionar).

Turnos y sesiones de trabajo (entrada/salida con PIN, sesión obligatoria para
operar cuentas): ver [turnos-garzones.md](./turnos-garzones.md).
Responsable vigente, transferencia por PIN/admin e historial:
[salones-mesas.md](./salones-mesas.md).

---

## Decisiones de diseño

- **Identificación solo por PIN**: el garzón teclea su PIN y el sistema lo identifica
  (flujo POS clásico). Requiere **PIN único por tenant**.
- **PIN autogenerado, mostrado una sola vez**: nadie elige el PIN. El backend genera
  uno aleatorio de 6 dígitos (con `crypto.randomInt`), garantizado único en el tenant
  (reintenta ante colisión), y lo devuelve **una sola vez** al crear o regenerar.
  Así se evita que dos garzones "piensen" el mismo PIN y que el admin conozca los PINs.
- **PIN hasheado** con bcrypt (cost 10, igual que las contraseñas). El admin nunca lo
  ve; si se pierde, se **regenera** (se muestra el nuevo una vez; el anterior deja de
  funcionar de inmediato). La API jamás devuelve `pin_hash`.
- **RBAC**: reutiliza el módulo contratado `Salones` (sin nuevo `tenant_modulos`). El
  CRUD usa `Leer/Crear/Actualizar/Eliminar`; la identificación por PIN usa `Operar`.

---

## API Endpoints

Todos bajo `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`; `tenant_id` del JWT.

| Método | Ruta | Permiso (`Salones`) | Descripción |
|---|---|---|---|
| GET | `/garzones` | `Leer` | Lista garzones del tenant (sin `pin_hash`) |
| POST | `/garzones` | `Crear` | Crea `{ nombre, activo?, tipo? }` → devuelve el garzón + `pin` generado (una vez) |
| PATCH | `/garzones/:id` | `Actualizar` | Actualiza `{ nombre?, activo?, tipo? }` |
| PATCH | `/garzones/:id/pin` | `Actualizar` | Regenera el PIN (sin body) → devuelve el garzón + nuevo `pin` (una vez) |
| DELETE | `/garzones/:id` | `Eliminar` | Soft delete |
| POST | `/garzones/identificar` | `Operar` | `{ pin }` → `{ garzonId, nombre }` (o 400) |

Al **abrir** cuenta (`POST /mesas/:id/cuentas`) y **cerrar** cuenta
(`POST /cuentas/:id/cerrar`) el body incluye `pin` (6 dígitos). El backend
resuelve el garzón y persiste `garzon_apertura_id` / `garzon_cierre_id`
(auditoría). Al abrir también setea `garzon_responsable_id` al mismo garzón
(responsable vigente inicial). La transferencia de responsable vigente (claim por
PIN o admin) vive en Salones — no en este módulo.

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
| `tipo` | TEXT | default `'garzon'`; CHECK `garzon` \| `cocina` \| `barra` |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

`cuentas` tiene tres FKs a `garzones`: `garzon_apertura_id` y `garzon_cierre_id`
(auditoría de quién abrió/cerró) y `garzon_responsable_id` (vigente; cambia con
transferencias — ver Salones).

### Métodos clave del service

- `crear` / `regenerarPin` — generan un PIN **único** por tenant vía `generarPinUnico`
  (aleatorio con `crypto.randomInt`, comparado con bcrypt contra los existentes y
  reintentado ante colisión), lo hashean y devuelven el PIN en claro **una sola vez**.
- `resolverGarzonPorPin(tenantId, pin)` — itera garzones **activos** del tenant y
  compara con bcrypt; devuelve el garzón o lanza `400 PIN inválido`. Es un `400`
  (no `401`) a propósito: un PIN incorrecto es un error operativo, no un fallo de
  autenticación de la sesión del dispositivo — un `401` haría que el frontend
  (`useApiFetch`) intente refrescar el token y cierre la sesión del restaurante.
  Usado por el endpoint `identificar` y por `SalonesService` al abrir/cerrar.

---

## Frontend

- **Composable**: `app/composables/useGarzones.ts` (`listar/crear/actualizar/
  regenerarPin/eliminar/identificar`).
- **Página admin**: `pages/configuracion/garzones.vue` — tabla con crear/editar,
  regenerar PIN y eliminar. Al crear o regenerar, el PIN generado se muestra en un
  **modal una sola vez** (con aviso de que no se volverá a mostrar).
  Entrada de nav bajo Configuración (gated `Salones/Crear`).
- **Componente**: `components/salones/GarzonPinModal.vue` — teclado numérico de 6
  dígitos que auto-verifica vía `identificar` y emite el PIN. Reutilizado al abrir,
  cerrar y tomar (claim) cuentas en `pages/salones/index.vue`, que muestra el
  responsable vigente (independiente de quién abrió/cerró).

---

## Testing

### Unit (backend)

```bash
cd backend && npx jest garzones salones
```

Cubre: generación y unicidad del PIN (con reintento ante colisión),
`resolverGarzonPorPin` (match / 400), regeneración de PIN, y que abrir/cerrar cuenta
persisten `garzon_apertura_id`/`garzon_cierre_id` (auditoría) y al abrir también
`garzon_responsable_id`.

### Manual (frontend)

1. `docker-compose up` (el seeder crea garzones demo con PINs conocidos: Ana=111111,
   Bruno=222222, Carla=333333 en el tenant Paris; los nuevos garzones creados por la
   UI reciben un PIN autogenerado).
2. Configuración → Garzones: crear (el PIN se muestra una vez), regenerar PIN.
3. Salones → abrir cuenta: PIN correcto abre la cuenta (apertura + responsable vigente
   inicial visibles); PIN incorrecto muestra "PIN inválido" (sin cerrar sesión).
4. Cerrar y cobrar: pide el PIN del garzón que cierra (auditoría; puede diferir del
   responsable vigente).

---

## Related Features

- [Turnos y Sesiones de Garzón](./turnos-garzones.md)
- [Salones y Mesas](./salones-mesas.md)
- [Ventas](./ventas.md)
