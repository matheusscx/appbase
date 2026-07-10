# Plan: Reembolsos de Webpay desde el módulo Órdenes (UI admin)

Status: Done
Date: 2026-07-10
Owner: Cesar Matheus

> Al ejecutar, persistir este plan en `docs/superpowers/plans/2026-07-10-reembolsos-webpay-ordenes-ui.md` (convención del proyecto).

## Context

La lógica de reembolso de Webpay Plus / Oneclick **ya está implementada** en el backend
(`CobrosService.reembolsar`, soporta reembolso total y parcial, calcula el saldo disponible,
bloquea la fila y audita la transacción `REFUND`). Pero hoy **solo está expuesta por el endpoint
m2m con `ApiKeyGuard`** (`POST /pasarela/api/cobros/:ordenId/reembolsos`).

No hay forma de que un admin logueado dispare un reembolso desde el navegador. El módulo Órdenes
(`/ordenes`) ya muestra el detalle de la orden y su historial de transacciones en
`OrdenDetalleDrawer`, pero sin acción de reembolso.

**Objetivo:** permitir que un admin del tenant dispare un reembolso (total o parcial) de una orden
`pagada` desde el drawer de detalle de Órdenes, reutilizando la lógica de negocio existente. Se
introduce un permiso RBAC dedicado `Reembolsar` en el módulo `Pasarelas`.

## Scope / Out of scope

**En alcance:**
- Nueva ruta interna JWT-guarded que reutiliza `CobrosService.reembolsar`.
- Nuevo permiso RBAC `Reembolsar` (seeder) y guardado de la ruta con él.
- UI: botón "Reembolsar" + modal de confirmación con monto (total precargado, editable a parcial)
  en `OrdenDetalleDrawer`, con refetch del detalle tras éxito.

**Fuera de alcance:**
- Cambios en la lógica de negocio de `reembolsar` (ya soporta total/parcial y validaciones).
- El endpoint m2m existente (no se toca).
- Migración de datos: el seeder es idempotente y siembra el nuevo permiso al arrancar.

## Backend

### 1. Permiso RBAC `Reembolsar` en el seeder
Archivo: `backend/src/modules/seeder/seeder.service.ts`

- En `seedPermisos()` (~línea 397), agregar un `Permiso` nuevo con el siguiente ID libre:
  `permisoId: '550e8400-e29b-41d4-a716-446655440017', nombre: 'Reembolsar'`.
  (IDs 012–016 ya usados; 017 es el siguiente libre.)
- Donde se definen las constantes de permiso (`LEER`, `CREAR`, `ACTUALIZAR`, `ELIMINAR` usadas en
  `seedModuloAppPermisos`), agregar `const REEMBOLSAR = '550e8400-e29b-41d4-a716-446655440017'`.
- En el array de `moduloAppPermiso` (bloque `// Pasarelas`, ~línea 583-603), agregar una fila que
  ligue el módulo Pasarelas (`550e8400-e29b-41d4-a716-446655440208`) con `REEMBOLSAR`, usando el
  siguiente `moduloAppPermisoId` libre `'550e8400-e29b-41d4-a716-446655440213'`
  (última usada: `...212`).

**Por qué esto basta:** el rol admin fijo obtiene automáticamente todos los permisos de los módulos
contratados vía `RbacService.getMisPermisos` (`backend/src/modules/rbac/rbac.service.ts:84-100`),
por lo que `Pasarelas:Reembolsar` aparecerá para admin sin asignación manual. Roles no-fijos podrán
recibirlo desde la matriz de permisos existente.

### 2. Ruta interna de reembolso
Archivo: `backend/src/modules/pasarela/controllers/pasarela-admin.controller.ts`

El controller ya está guardado con `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`, ya inyecta
`CobrosService` y ya expone el helper `private tenantId(req)` (líneas 39-41). Solo agregar:

```ts
@Post('ordenes/:id/reembolsos')
@RequiresPermiso('Pasarelas', 'Reembolsar')
reembolsar(
  @Req() req: Request,
  @Param('id') id: string,
  @Body() dto: CreateReembolsoDto,
) {
  return this.cobrosService.reembolsar(this.tenantId(req), id, dto);
}
```

- Importar `CreateReembolsoDto` desde `../dto/create-reembolso.dto` y `Post`/`Body` si faltan.
- **Sin cambios en `CobrosService`** — `reembolsar(tenantId, ordenId, dto)` es tenant-scoped y no
  depende de `req.pasarelaAuth`. Ya valida `monto > 0`, exige estado `pagada`/`reembolsada`, calcula
  `disponible = orden.monto − Σ(REFUND aprobados)` y rechaza sobre-reembolso
  (`cobros.service.ts:196-246`). Devuelve `{ ...orden, reembolsoAprobado }`; en timeout del proveedor
  lanza `BadGatewayException` (502).

## Frontend

### 3. Acción de reembolso en el drawer
Archivo: `frontend/app/components/ordenes/OrdenDetalleDrawer.vue`

Patrón de referencia a espejar: `frontend/app/components/pagos/AbonoModal.vue` (POST monetario con
`useApiFetch`, loading, toast, emit). Componentes/composables a reutilizar:
- `MoneyInput.vue` — input de monto que emite string numérico (calza con `CreateReembolsoDto.monto`
  `@IsNumberString`). Precargar con el monto disponible.
- `useApiFetch` — POST autenticado a `${apiUrl}/pasarela/admin/ordenes/${id}/reembolsos`.
- `formatMonto` (`useFormatters`) — ya usado en el drawer para mostrar montos.
- `apiErrorMsg` (`utils/api-error.ts`) — ya importado, para toasts de error.
- `usePermissionsStore().can('Pasarelas', 'Reembolsar')` — gatear la visibilidad del botón.

Cambios:
- Calcular `disponible` = `orden.monto − Σ(transacciones REFUND aprobadas)` a partir de
  `orden.transacciones` (el mismo cálculo que el backend, solo para prellenar/validar en UI).
- Botón "Reembolsar" en el slot `#actions` del footer (junto a "Cerrar"), visible solo si
  `orden.estado ∈ {pagada, reembolsada}`, `disponible > 0` y `can('Pasarelas','Reembolsar')`.
- Modal de confirmación (`UModal` + `AppModalFooter`, como `AbonoModal`) con:
  - `MoneyInput` precargado con `disponible` (editable para reembolso parcial).
  - Validación imperativa: `0 < monto ≤ disponible`.
  - Confirmar: POST → toast éxito → cerrar modal → `cargar(props.ordenId)` para refrescar estado +
    historial de transacciones. En error: toast con `apiErrorMsg`.
- Nota: si se quiere refrescar también la lista de `/ordenes`, emitir `reembolsado` y que
  `pages/ordenes.vue` re-ejecute el `fetch` de `usePaginatedList`. Opcional; el drawer ya se
  auto-refresca.

## Verification

1. **Seed/permiso:** `docker-compose up --build`; verificar en logs que el seeder corre. Como admin,
   `GET /rbac/mis-permisos` debe incluir `Pasarelas:Reembolsar`.
2. **Backend endpoint:** con token de admin, `POST /pasarela/admin/ordenes/:id/reembolsos` con
   `{ "monto": "<total>" }` sobre una orden `pagada` → 200, `reembolsoAprobado: true`, estado pasa a
   `reembolsada`. Reembolso parcial (`monto < disponible`) → orden sigue `pagada`, aparece transacción
   `REFUND`. Monto > disponible → 400. Sin permiso (rol no-fijo sin `Reembolsar`) → 403.
3. **Tests backend:** `cd backend && npm test` — la spec de `CobrosService` ya cubre total/parcial/
   sobre-límite/timeout; agregar (o extender) test del nuevo route del admin controller si aplica.
4. **UI e2e (chrome-devtools MCP):** abrir `/ordenes`, abrir una orden `pagada`, click "Reembolsar",
   confirmar total → toast éxito, badge de estado pasa a "Reembolsada", historial muestra la fila
   `Reembolso`. Repetir con monto parcial. Verificar que el botón no aparece en órdenes no pagadas ni
   para un usuario sin el permiso.

## Decisions / Open questions

- **Permiso:** se usa un permiso dedicado `Reembolsar` (decisión del usuario), no se reutiliza
  `Pasarelas/Actualizar`. Requiere las 2 filas de seed descritas.
- **Alcance UI:** total + parcial (decisión del usuario), aprovechando el soporte de parciales del
  backend.
- **Documentación viva:** actualizar `docs/features/<pasarela|ordenes>.md` y la tabla "Estado actual"
  de `CLAUDE.md` en el mismo cambio.
```
