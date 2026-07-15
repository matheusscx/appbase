# Task 5 — `POST /mermas` + `GET /mermas`

**Status:** Done  
**Date:** 2026-07-15

## Cambios realizados

### DTOs

- `CreateMermaDto`: `itemId`, `cantidad`, `causaMermaId`, opcionales `unidadCodigo`, `comentario`, `costoUnitario`.
- `FindMermasDto` extiende `PaginationQueryDto` con filtros `itemId`, `causaMermaId`, `desde`, `hasta`.

### `MermasService`

- `registrar`: transacción con `FOR UPDATE`, valida producto, `assertCausaActiva`, conversión de unidad vía `CatalogService`, reglas de costo (vigente vs explícito), delega a `InventarioService.registrarMovimiento` con `motivo:'merma'` y `causaMermaId`. Calcula `costoPerdido` con Decimal.js.
- `findAll`: filtra `motivo = 'merma'`, JOIN item + causa + usuario, paginación y `costoPerdido` en mapeo.

### `MermasController`

- `GET /mermas` → `@RequiresPermiso('Inventario', 'Leer')`
- `POST /mermas` → `@RequiresPermiso('Inventario', 'Crear')`
- Guards: `JwtAuthGuard`, `TenantGuard`, `PermisosGuard`.

### `MermasModule`

- Registra `MermasController`, `MermasService`; exporta ambos servicios.

### E2E fix (`inventario.e2e-spec.ts`)

- Casos que enviaban `motivo: 'merma'` al ajuste genérico ahora esperan **400** (validación DTO).
- Test de conversión de unidades usa `ajuste_manual` en salida en lugar de merma.

## Tests (`mermas.service.spec.ts`)

1. Happy path con `costo_actual` → congela vigente, `costoPerdido = qty × costo`.
2. Sin `costo_actual` ni `costoUnitario` → BadRequest mensaje exacto del plan.
3. Con `costoUnitario` explícito → registra sin `UPDATE costo_actual` en transacción.
4. `unidadCodigo` distinta → `convertirUnidad`.
5. Causa inactiva → BadRequest vía `assertCausaActiva`.

## Verificación

```bash
cd backend && npm test -- mermas.service.spec.ts
# 5 passed
```

## Commit

```
feat(mermas): registra y lista mermas tipificadas valorizadas
```

## Concerns / follow-up

- E2E dedicado `mermas.e2e-spec.ts` pendiente (Task 6).
- Frontend de registro/listado de mermas pendiente (Tasks 7–8).
