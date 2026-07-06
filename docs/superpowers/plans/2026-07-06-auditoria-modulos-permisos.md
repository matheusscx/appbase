# Plan: Alineación de módulos y permisos RBAC con el desarrollo

**Status**: Done
**Date**: 2026-07-06
**Owner**: Cesar Matheus

## Context

Auditoría del catálogo RBAC (`modulos_app`, `permisos`, `modulo_app_permisos`)
contra las features realmente desarrolladas. El modelo es
`rol → modulos_roles → tenant_modulos → modulos_app` y
`roles_permisos_modulos → modulo_app_permisos → permisos`, con enforcement por
`@RequiresPermiso(modulo, permiso)` + `PermisosGuard` (un rol `es_fijo`/admin hace
short-circuit a acceso total). El frontend oculta menús con
`permissions.can(modulo, permiso)`.

### Hallazgos de la auditoría

1. **Módulo fantasma `Facturación`** — sembrado con 4 permisos y contratado por
   Falabella (`tenant_modulos`), pero sin controller, módulo ni página. La venta
   real es `Ventas`. → Eliminar.
2. **Módulos desarrollados ausentes de `modulos_app`**: `Pagos`, `Inventario`,
   `Items/Catálogo`, `Terceros`. No se pueden gatear por rol/contrato.
3. **Enforcement inconsistente (gap de seguridad)**: solo `Caja` y `Suscripciones`
   usan `PermisosGuard`. `Ventas` (núcleo transaccional) tiene permisos sembrados
   pero el controller **no los aplica** (`// TODO` en `ventas.controller.ts:23`);
   `Pagos`, `Inventario`, `Online` no tienen autorización granular. Ocultar el menú
   en el frontend no protege el endpoint.
4. **Sets de permisos incompletos**: `Ventas` solo Leer/Crear (falta
   Actualizar/Eliminar/Ver todas); `Suscripciones` sin `Crear` (el `POST` es
   self-service de tienda, intencional pero no documentado).
5. **Frontend desincronizado**: "Pagos" gatea sobre `Ventas:Leer`, "Terceros" sobre
   `esAdmin` hardcoded — ninguno respaldado por módulo/enforcement real.

### Decisiones tomadas
- **Items/Catálogo y Terceros → módulos RBAC** (no config admin-only), para poder
  concederlos a roles no-admin (ej. rol "Bodeguero").
- Los catálogos de configuración financiera (monedas, impuestos, descuentos,
  recargos, categorías, métodos-pago, tipos-regla, roles) **permanecen bajo
  `TenantAdminGuard`** (config solo admin) — se documenta, no se convierten en módulos.

## Scope / Out of scope

**In scope**
- Depurar módulo `Facturación` del seeder.
- Registrar en `modulos_app`: `Pagos`, `Inventario`, `Items` (Catálogo), `Terceros`.
- Completar `modulo_app_permisos` (CRUD estándar) para módulos nuevos y para `Ventas`.
- Aplicar `PermisosGuard` + `@RequiresPermiso` en controllers: `ventas`, `pagos`,
  `inventario`, `items`, `terceros`, `online`.
- Sincronizar el gating del frontend (`dashboard.vue`) con los módulos/permisos reales.
- Documentación viva.

**Out of scope**
- Convertir los catálogos de config en módulos RBAC (permanecen admin-only).
- Pantalla de superadmin para contratar módulos (`tenant_modulos`) — sigue pendiente.
- Semántica avanzada de `Ver todas` fuera de Caja/Ventas.

## Convención de IDs fijos

Máximo usado hoy: `...440177`. Reservar bloque desde `...440180`.

| Concepto | ID sugerido |
|---|---|
| modulo_app **Pagos** | `550e8400-e29b-41d4-a716-446655440180` |
| modulo_app **Inventario** | `...440181` |
| modulo_app **Items** (Catálogo) | `...440182` |
| modulo_app **Terceros** | `...440183` |
| modulo_app_permisos (bloque nuevos + Ventas) | `...440184` … en adelante |

(Los `permisos` base Leer/Crear/Actualizar/Eliminar/Ver todas ya existen: `...440012`–`...440016`.)

## Backend

### 1. Depurar `Facturación`
- [x] En `seeder.service.ts` → `seedModulosApp`: eliminar la entrada `Facturación`
      (`...440010`).
- [x] En `seedModuloAppPermisos`: eliminar las 4 entradas de `FACTURACION`
      (`...440030`–`...440033`) y la constante `FACTURACION`.
- [x] En `seedTenantModulo`: eliminar la contratación Falabella → Facturación
      (`moduloTenantId ...440042`).
- [x] Verificar que ningún otro método referencie esos IDs (grep limpio en `src/` y
      `test/`).

### 2. Registrar módulos nuevos en `modulos_app`
- [x] `seedModulosApp`: agregado `Pagos` (`url: /pagos`, `icono: mdi-cash-multiple`),
      `Terceros` (`url: /terceros`, `mdi-account-multiple-outline`) — coinciden con
      páginas top-level ya existentes. `Inventario` y `Items` se registraron con
      `url: /configuracion/inventario` y `/configuracion/items` respectivamente (no
      `/inventario` ni `/items` como sugería la tabla de IDs): esas son las rutas
      reales de las páginas hoy; el campo `url` es metadata descriptiva, no se usa en
      ningún routing.

### 3. Completar `modulo_app_permisos`
- [x] **Ventas**: agregadas Actualizar, Eliminar, Ver todas.
- [x] **Pagos**: Leer, Crear. Confirmado en `pagos.service.ts`: no existe anulación de
      pago → no se agrega `Eliminar`.
- [x] **Inventario**: Leer, Crear, Ver todas sembrados para completar el set; solo
      `Leer` tiene endpoint hoy (`GET /inventario/movimientos`) y es lo único con
      enforcement — no existe endpoint de movimiento manual (el kardex solo se
      alimenta desde ventas).
- [x] **Items**: Leer, Crear, Actualizar, Eliminar.
- [x] **Terceros**: Leer, Crear, Actualizar, Eliminar.
- [x] **Suscripciones**: confirmado — `Crear` es self-service de tienda (sin decorador
      en el controller), no se agrega al set admin.

### 4. Enforcement en controllers
Patrón: `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)` a nivel controller +
`@RequiresPermiso('<Modulo>', '<Permiso>')` por handler (ver `caja.controller.ts`
como referencia).
- [x] `ventas.controller.ts`: resuelto el `// TODO`. GET→`Ventas:Leer`,
      POST→`Ventas:Crear`. No existe endpoint de anulación/nota de crédito hoy —
      `Ventas:Actualizar/Eliminar/Ver todas` quedan sembrados para cuando se
      implemente esa feature. `@Controller('tipos-documento')` → `Ventas:Leer`.
- [x] `pagos.controller.ts`: `Pagos:Leer` / `Pagos:Crear`.
- [x] `inventario.controller.ts`: `Inventario:Leer` en `GET /movimientos` (único
      endpoint existente).
- [x] `items.controller.ts`: migrado de `TenantAdminGuard` por-handler a
      `PermisosGuard` + `@RequiresPermiso('Items', ...)`, incluyendo los GET (antes
      sin restricción alguna más allá de pertenecer al tenant) — admin sigue pasando
      por short-circuit `es_fijo`.
- [x] `terceros.controller.ts`: igual que items → `@RequiresPermiso('Terceros', ...)`.
- [x] `online.controller.ts`: `Tienda Online:Crear` en el checkout (POST).
- [x] `PermisosGuard`/`RbacService` ya eran inyectables globalmente vía `RbacModule`;
      sin cambios de wiring necesarios.

### 5. Seeding de asignaciones de prueba
- [x] Extendido `seedVendedorPermisosCaja` para conceder al rol `Vendedor` de Paris:
      `Pagos` (Leer/Crear) — y adicionalmente **`Items:Leer`**, no contemplado
      originalmente en el plan: el POS (`ventas/pos.vue`) hace `GET /items` para el
      catálogo, y sin este grant la migración de `items.controller.ts` a
      `PermisosGuard` habría roto el flujo de venta del Vendedor. `Terceros:Leer` no
      se otorga (el picker de terceros en el POS ya está diseñado para degradar en
      silencio si el fetch falla — ver `ClienteForm.vue`).
- [x] Contratados los módulos nuevos (`Pagos`, `Inventario`, `Items`, `Terceros`) para
      Paris y Falabella en `seedTenantModulo`.

## Frontend

- [x] `app/layouts/dashboard.vue`:
  - "Pagos" → gatea con `can('Pagos', 'Leer')`.
  - "Terceros" → gatea con `can('Terceros', 'Leer')`.
  - Inventario/Items no se agregaron al nav principal — quedaron en su ubicación
    actual (`/configuracion/*`), ver punto siguiente.
- [x] **Gap no contemplado en el plan original**: `Items` e `Inventario` viven en el
      sub-nav de `app/pages/configuracion.vue`, dentro de un bloque `if (esAdmin)`
      separado del de `dashboard.vue`. La decisión de "Items/Terceros → módulos RBAC
      para roles no-admin" no se cumplía en la práctica sin tocar ese archivo — un
      rol "Bodeguero" con `Items:Leer` habría pasado el backend pero no habría visto
      el link. Se sacaron "Items" e "Inventario" del bloque `esAdmin` y se gatearon
      individualmente con `esAdmin || can('Items'|'Inventario', 'Leer')`.
- [x] Verificado en navegador (Chrome DevTools MCP) con `vendedor@paris.cl`: sidebar
      principal muestra Caja/Ventas/Pagos/Punto de venta (no Terceros); en
      Configuración aparece "Items" (con `Items:Leer` otorgado) pero no "Inventario"
      — confirma que el gating data-driven funciona de punta a punta.
- [x] `RolPermisosPorModulo.vue` es 100% data-driven por props (sin nombres de módulo
      hardcodeados) — confirmado por lectura de código; la matriz de admin en
      `/configuracion/roles` refleja los módulos nuevos automáticamente.
- [x] Confirmado admin conserva acceso total (short-circuit `es_fijo`) en sidebar y
      API.

## Verification

- [x] `cd backend && npm run lint` — sin errores nuevos (8 errores/21 warnings
      preexistentes, todos en specs no tocados por este cambio).
- [x] `cd backend && npm test` — 23 suites / 266 tests, todos verdes.
- [x] Stack reconstruido con reseed limpio (`docker-compose down -v && docker-compose
      up --build`); `SeederService` corrió sin errores.
- [x] Con usuario **admin** (`admin.paris@paris.cl`): `GET /ventas`, `/pagos`,
      `/inventario/movimientos`, `/items`, `/terceros` → todos 200 (short-circuit
      `es_fijo`).
- [x] Con usuario **Vendedor** (no-admin, vía curl con JWT real):
      `mis-permisos` = `Caja:*` (sin VerTodas/Eliminar), `Items:Leer`, `Pagos:Crear`,
      `Pagos:Leer`, `Ventas:Crear`, `Ventas:Leer`. `GET /ventas`, `/pagos`, `/items` →
      200. `GET /inventario/movimientos`, `GET /terceros`, `POST /items` → 403.
      `POST /online/checkout` → 403 (sin grant de Tienda Online).
- [x] Sin token → 401 en `/ventas`.
- [x] Frontend: sidebar del Vendedor confirmado en navegador (ver sección Frontend).
- [x] `Facturación` ya no aparece en `mis-permisos` de admin ni en el sidebar.

No existe endpoint de anulación de venta ni de pago hoy, así que ese caso de la
verificación original (`DELETE /ventas` → 403) no aplica todavía — ver Decisions.

## Decisions / Open questions

- [x] **Pagos: ¿permiso de anulación?** No — `PagosService` no tiene ningún método de
      anulación/reversa. No se agregó `Pagos:Eliminar`.
- [x] **Ventas: anular venta**. No aplica todavía: `ventas.controller.ts` no expone
      anulación ni nota de crédito (solo `crear`/`resumen`/`listar`/`findOne`).
      `Ventas:Actualizar/Eliminar/Ver todas` quedaron sembrados en el catálogo para
      cuando esa feature se construya, pero sin handler que los use hoy. Semántica a
      definir en ese momento.
- [x] **Inventario escritura**: confirmado — el kardex solo se alimenta desde ventas
      (`movimientos_inventario` se escribe dentro de la transacción de venta); no hay
      endpoint de movimiento manual. Solo `Inventario:Leer` tiene enforcement real.
- [x] **Migración de datos**: confirmado, sin cambios de código necesarios. En este
      ciclo se usó `docker-compose down -v` para partir de una BD limpia; en un
      entorno dev existente con datos, la fila `Facturación` en `modulos_app`
      quedaría huérfana hasta un reseed limpio (el seeder es idempotente por INSERT,
      no hace DELETE).
- [x] **Gap adicional detectado y resuelto durante la implementación**: `Items` e
      `Inventario` vivían gateados por `esAdmin` en `configuracion.vue` (no cubierto
      por el plan original, que solo tocaba `dashboard.vue`) — ver sección Frontend.
- [x] **Gap adicional detectado y resuelto**: migrar `items.controller.ts` a
      `PermisosGuard` sin más habría roto el catálogo del POS para el rol Vendedor
      (que no tenía `Items:Leer`) — se agregó ese grant a `seedVendedorPermisosCaja`.
