# Plan: Gestión de Garzones (PIN operativo)

Status: Done · Date: 2026-07-13 · Owner: Cesar Matheus

> **Implementado y verificado (2026-07-13).** Backend: 448 tests verdes (23 nuevos de
> garzones/salones), lint limpio. E2E verificado por API (identificar, abrir/cerrar con
> PIN, 401/400) y por UI (página admin de garzones, modal de PIN → cuenta abierta con
> responsable "Ana Torres", sin errores de consola). BD confirmada: tabla `garzones`
> seedeada y `cuentas.garzon_apertura_id`/`garzon_cierre_id` persistidos.

## Context

En un restaurante uno o más dispositivos (tablet/tótem) son **compartidos** por todos los
garzones. Iniciar/cerrar sesión con usuario+contraseña por cada cambio de turno es lento y
propenso a errores, y crear usuarios del sistema para personal temporal es innecesario.

Solución: **Gestión de Garzones** — cada garzón es un registro liviano del tenant (nombre +
PIN secreto de 6 dígitos), **no un usuario del sistema**. El dispositivo permanece con la
sesión del restaurante ya autenticada; el PIN es un **identificador operativo** (no un token
JWT — no se toca el sistema de auth). Al abrir o cerrar una cuenta, el sistema pide el PIN
para registrar al garzón responsable, dando trazabilidad de quién abrió y cerró cada cuenta e
incorporación de reemplazos sin crear usuarios.

Hoy la tabla `cuentas` no guarda ningún responsable y `abrirCuenta` no captura usuario alguno
— este es el hueco que se llena.

## Decisiones (confirmadas con el usuario)

- **Trazabilidad:** la cuenta guarda **quién la abrió** y **quién la cerró** (dos FKs a garzón).
- **Ingreso de PIN:** el garzón **solo teclea su PIN**; el sistema lo identifica. Requiere PIN
  único por tenant.
- **Gestión del PIN:** **hasheado con bcrypt** (cost 10, como las contraseñas). El admin no lo
  ve; si se olvida, se **resetea**. Nunca se devuelve el hash ni el PIN por la API.
- **Alcance:** solo se aplica a lo existente (abrir/cerrar cuenta). **No** se construye
  "transferir cuenta entre mesas" (feature futura aparte).
- **RBAC:** reutiliza el módulo contratado **`Salones`** (sin nuevo `tenant_modulos`). CRUD de
  garzones bajo `Salones/Crear|Actualizar|Eliminar|Leer`; identificar por PIN bajo `Salones/Operar`.

Nota técnica: `synchronize: true` en dev (`app.module.ts:179`) aplica los cambios de entidad
automáticamente; no se requiere migración para dev, pero **sí** actualizar `startup-pos.sql`
(referencia de esquema / prod).

## Modelo de datos

**Nueva entidad `Garzon`** — `backend/src/modules/garzones/entities/garzon.entity.ts` (tabla `garzones`),
siguiendo el patrón de `tercero.entity.ts`:
- `garzon_id` uuid PK · `tenant_id` uuid · `nombre` varchar(100)
- `pin_hash` text (bcrypt) · `activo` boolean default true
- `creado_el` / `actualizado_el` / `eliminado_el` (soft delete)

**Modificar `Cuenta`** — `backend/src/modules/salones/entities/cuenta.entity.ts`, añadir:
- `garzon_apertura_id` uuid nullable
- `garzon_cierre_id` uuid nullable

## Backend — nuevo módulo `src/modules/garzones/`

Archivos: `garzon.entity.ts`, `garzones.service.ts`, `garzones.controller.ts`, `garzones.module.ts`,
`garzones.service.spec.ts`, y DTOs `dto/create-garzon.dto.ts`, `dto/update-garzon.dto.ts`,
`dto/reset-pin.dto.ts`, `dto/identificar.dto.ts`.

- [ ] `GarzonesService`:
  - `listar(tenantId)` — sin `pin_hash`.
  - `crear(tenantId, { nombre, pin })` — valida PIN único (helper `pinYaUsado`), hashea, guarda.
  - `actualizar(tenantId, id, { nombre?, activo? })`.
  - `resetPin(tenantId, id, { pin })` — valida único, re-hashea.
  - `eliminar(tenantId, id)` — soft delete.
  - `resolverGarzonPorPin(tenantId, pin): Promise<Garzon>` — itera garzones **activos** del
    tenant y `bcrypt.compare`; devuelve el match o lanza `UnauthorizedException('PIN inválido')`.
    (N pequeño por tenant ⇒ costo aceptable.) Consumido por el controller y por `SalonesService`.
  - privado `pinYaUsado(tenantId, pin, exceptId?)` — mismo patrón de iteración/compare.
- [ ] DTOs con `class-validator`: `pin` como `@Matches(/^\d{6}$/)`; `nombre` `@IsString()@IsNotEmpty()`;
  `activo?` `@IsOptional()@IsBoolean()`. `tenantId` **nunca** en el body (viene del JWT).
- [ ] `GarzonesController` (`/garzones`) con `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`,
  patrón de `terceros.controller.ts` (`req.user.tenantId`):
  - `GET /` → `@RequiresPermiso('Salones','Leer')`
  - `POST /` → `Salones/Crear`
  - `PATCH /:id` → `Salones/Actualizar`
  - `PATCH /:id/pin` → `Salones/Actualizar` (reset)
  - `DELETE /:id` → `Salones/Eliminar`
  - `POST /identificar` → `Salones/Operar` → `{ pin }` → `{ garzonId, nombre }`
- [ ] `GarzonesModule`: `TypeOrmModule.forFeature([Garzon])`, provee y **exporta** `GarzonesService`.
- [ ] Registrar `GarzonesModule` en `app.module.ts` (import + array `imports`).

## Backend — cambios en Salones

- [ ] `SalonesModule` importa `GarzonesModule`.
- [ ] `CreateCuentaDto`: añadir `pin` requerido (`@Matches(/^\d{6}$/)`).
- [ ] `CerrarCuentaDto`: añadir `pin` requerido (`@Matches(/^\d{6}$/)`).
- [ ] `salones.service.ts` `abrirCuenta` (L273): resolver garzón por PIN y persistir
  `garzonAperturaId` dentro de la transacción.
- [ ] `salones.service.ts` `cerrarCuenta` (L446): resolver garzón por PIN y setear `garzonCierreId`
  al cerrar (misma transacción que genera la venta).
- [ ] `CuentaDetalle` (interfaz service L~26-60) + `armarDetalle`: incluir `garzonAperturaId`/
  `garzonAperturaNombre` (y cierre) haciendo join con `garzones`.
- [ ] Actualizar `salones.service.spec.ts` para el nuevo parámetro/flujo.

## Frontend

- [ ] `app/composables/useGarzones.ts`: `listar`, `crear`, `actualizar`, `resetPin`, `eliminar`,
  `identificar` (patrón de `useSalones.ts`, con `useApiFetch`).
- [ ] `useSalones.ts`: `abrirCuenta(mesaId, pin, nombre?)` y `cerrarCuenta(cuentaId, { ..., pin })`;
  añadir `garzonAperturaNombre` a `CuentaDetalle`.
- [ ] `app/components/salones/GarzonPinModal.vue`: teclado numérico de 6 dígitos, emite el PIN.
  Reutilizado para abrir y cerrar (usar componentes Nuxt UI vía skill `nuxt-ui`; tokens semánticos).
- [ ] `pages/salones/index.vue`: antes de abrir y de cerrar cuenta, abrir `GarzonPinModal` y enviar
  el PIN; mostrar el garzón responsable en la cabecera de la cuenta.
- [ ] `pages/configuracion/garzones.vue`: tabla de garzones (nombre, activo, acciones) + modales
  crear/editar y **resetear PIN**. Patrón de `pages/configuracion/salones.vue`.
- [ ] `pages/configuracion.vue`: entrada de nav "Garzones" gated por
  `permissionsStore.esAdmin || can('Salones','Crear')` (junto a la de Salones, L82-88).

## Seeder

- [ ] `seedGarzones()` en `seeder.service.ts` (patrón `seedTerceros` L1461): 2-3 garzones para el
  tenant demo (Paris `...440007`), UUIDs fijos desde `550e8400-e29b-41d4-a716-446655440238`,
  PINs de demo hasheados (p.ej. `111111`, `222222`). Registrar la llamada en `run()`.

## Docs y esquema (mismo commit)

- [ ] `startup-pos.sql`: tabla `garzones` + columnas `garzon_apertura_id`/`garzon_cierre_id` en `cuentas`.
- [ ] `docs/features/garzones.md` desde `TEMPLATE.md` + link en `docs/README.md`.
- [ ] `docs/features/salones-mesas.md`: identificación por PIN al abrir/cerrar.
- [ ] Fila en `docs/ESTADO.md`.

## Verificación

- [ ] `cd backend && npm test` (incluye `garzones.service.spec.ts`: hash, unicidad de PIN, resolver
  match/no-match) y `npm run lint`.
- [ ] `docker-compose up` → el seeder crea los garzones demo sin error.
- [ ] End-to-end en UI (Chrome DevTools MCP):
  1. Configuración → Garzones: crear un garzón, resetear su PIN.
  2. Salones → abrir cuenta: PIN correcto ⇒ cuenta abierta con responsable visible; PIN incorrecto
     ⇒ 401 "PIN inválido".
  3. Cerrar cuenta con PIN ⇒ venta generada y `garzon_cierre_id` registrado.
- [ ] Verificar en BD (MCP `postgres`) que `cuentas.garzon_apertura_id`/`garzon_cierre_id` quedan seteados.

## Decisiones abiertas / notas

- Reutilizar el módulo RBAC `Salones` evita añadir un `tenant_modulos` nuevo; si más adelante se
  quiere separar permisos de garzones, se promoverá a módulo propio.
- Unicidad y resolución de PIN iteran sobre garzones activos del tenant (N pequeño). Si un tenant
  llegara a tener muchos garzones, se podría añadir un índice/lookup determinista más adelante.
