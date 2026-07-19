# Feature: Mermas tipificadas y valorizadas

**Status**: Complete  
**Last Updated**: 2026-07-15

---

## Overview

### What is it?

Registro dedicado de mermas de stock en productos (`tipo='producto'`) con **causa tipificada por tenant**, conversión de unidad opcional y **costo congelado en el kardex**. El impacto financiero (`costoPerdido = cantidad × costo_unitario`) se calcula al leer el movimiento. La merma **nunca** actualiza `item_producto.costo_actual`.

Causas fijas del sistema (`es_fijo=true`): **Vencimiento**, **Deterioro**, **Robo**, **Error operativo**, **Otro** — no se editan ni eliminan. El administrador puede crear causas custom adicionales.

El ajuste genérico de stock (`PATCH /items/:id/stock`) **ya no acepta** `motivo='merma'`; toda merma pasa por el flujo dedicado con causa obligatoria.

### Why does it exist?

Food-service necesita saber *por qué* se perdió stock y cuánto costó, no solo un movimiento anónimo. Cierra la pieza 4 del cluster recetas/costos, reutilizando costo por producto (pieza 1) y conversión de unidades (pieza 2).

### Scope

**Included:**
- Tabla `causas_merma` por tenant + columna `causa_merma_id` en `movimientos_inventario`.
- Semilla de 5 causas fijas al crear tenant y en el seeder de desarrollo.
- CRUD `/api/causas-merma` y registro/listado `/api/mermas`.
- UI: configuración de causas, operación de mermas (drawer + modal sin `costo_actual`), kardex con causa y costo perdido.
- Quitar opción Merma del modal de ajuste de stock en items.

**NOT included (future):**
- Reporte fiscal/DTE de mermas.
- Multi-bodega / ubicaciones.
- Merma automática por rendimientos de recetas.

---

## Modelo de datos

### `causas_merma`

| Column | Type | Notes |
|--------|------|-------|
| `causa_merma_id` | UUID PK | |
| `tenant_id` | UUID FK | Del token |
| `nombre` | TEXT | Único vivo por tenant |
| `activo` | BOOLEAN | Default `true` |
| `es_fijo` | BOOLEAN | Defaults del sistema |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete |

### `movimientos_inventario` (extensión)

| Column | Type | Notes |
|--------|------|-------|
| `causa_merma_id` | UUID NULL FK | Obligatoria iff `motivo='merma'` |

---

## API

### CRUD `/api/causas-merma`

- `GET` — cualquier usuario del tenant; query `?soloActivas=true` filtra activas.
- `POST` / `PATCH /:id` / `DELETE /:id` — `TenantAdminGuard`; rechaza editar/borrar `es_fijo=true`; soft-delete bloqueado si hay movimientos con esa causa.

### `POST /api/mermas`

Permiso: **Inventario:Crear**.

```
POST /api/mermas
Authorization: Bearer <token>

Request (CreateMermaDto):
{
  "itemId": "<uuid>",
  "cantidad": "250",
  "causaMermaId": "<uuid>",
  "unidadCodigo": "g",
  "comentario": "Lote vencido",
  "costoUnitario": "8000"
}
```

**Reglas de costo:**
- Con `costo_actual` y sin `costoUnitario` → congela el vigente en el movimiento.
- Sin `costo_actual` y sin `costoUnitario` → `400` exigiendo `costoUnitario`.
- La merma **nunca** actualiza `item_producto.costo_actual`.

**Response (201):**
```json
{
  "movimientoId": "<uuid>",
  "stockResultante": "1.7500",
  "costoUnitario": "8000",
  "costoPerdido": "2000000",
  "causaNombre": "Vencimiento"
}
```

### `GET /api/mermas`

Permiso: **Inventario:Leer**. Paginado; filtros `itemId`, `causaMermaId`, `desde`, `hasta`. Cada fila incluye `causaNombre` y `costoPerdido`.

---

## Backend

- **Módulo**: `src/modules/mermas/` (causas + registro en un feature module).
- Reusa `InventarioService.registrarMovimiento` (`tipo='salida'`, `motivo='merma'`, `causaMermaId`) y `CatalogService.convertirUnidad`.
- `AjusteStockDto`: enum de motivos sin `'merma'`.
- `registrarMovimiento`: exige `causaMermaId` si `motivo='merma'`; rechaza `causaMermaId` en otros motivos.

---

## Frontend

- `/configuracion/causas-merma` — CRUD con badge **Fija** en causas `es_fijo`.
- `/mermas` — listado filtrable + drawer registrar; modal informativo (`AppModalFooter`) cuando el producto no tiene `costo_actual`; campo costo unitario requerido en ese caso; prellenado editable si hay `costo_actual`. Columna Cantidad formateada por magnitud vía `formatStock` (`useFormatters`) — `MermaListItem.unidadMedida` (nuevo, viene de `item_producto.unidad_medida`).
- Kardex / historial de movimientos: `Merma · {causaNombre}` y costo perdido formateado (`formatMonto`).
- Modal de ajuste de stock en items: opción Merma eliminada.

---

## Testing

```bash
cd backend && npm test -- causas-merma.service.spec.ts mermas.service.spec.ts
cd backend && npm test -- inventario.service.spec.ts  # casos causa merma
cd backend && npm run test:e2e -- mermas.e2e-spec.ts
```

---

## Acceptance Criteria

- [x] CRUD causas custom; fijas inmutables
- [x] `POST /mermas` tipifica, descuenta stock y congela costo
- [x] Sin `costo_actual` exige `costoUnitario`; no pisa costo del producto
- [x] Listado y kardex muestran valorizado y causa
- [x] Ajuste genérico sin `merma`
- [x] Unit + E2E
- [x] Docs (este archivo) + ESTADO

---

## Related Features

- [inventario-kardex.md](./inventario-kardex.md) — movimientos de salida y `costo_unitario` congelado
- [conversion-unidades.md](./conversion-unidades.md) — conversión antes del movimiento
- [recetas.md](./recetas.md) — pieza 3 del cluster food-service
- Spec: [`docs/superpowers/specs/2026-07-15-mermas-valorizadas-design.md`](../superpowers/specs/2026-07-15-mermas-valorizadas-design.md)
