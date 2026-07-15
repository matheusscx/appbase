# Task 2 — CRUD `/causas-merma`

**Status:** DONE  
**Date:** 2026-07-15

## Commit

**Commit:** `5bb1795` — feat(mermas): CRUD de causas de merma por tenant

## Entregables

### DTOs
- `create-causa-merma.dto.ts` — `nombre` (required, max 120), `activo` optional
- `update-causa-merma.dto.ts` — `nombre` y `activo` opcionales

### Service (`CausasMermaService`)
- `findAll(tenantId, soloActivas)` — SQL raw con soft delete
- `create` — `es_fijo=false`, trim nombre, `assertNombreUnico` case-insensitive
- `update` — rechaza `es_fijo`, UPDATE dinámico
- `remove` — rechaza `es_fijo` y uso en movimientos, soft delete
- `assertCausaActiva(runner, tenantId, causaMermaId)` — exportado para Task 5

### Controller
- `@UseGuards(JwtAuthGuard, TenantGuard)` global
- `TenantAdminGuard` en POST/PATCH/DELETE
- DELETE → `204 No Content`
- GET con query `soloActivas`

### Module
- `MermasModule` con `TypeOrmModule.forFeature([CausaMerma])`, `InventarioModule`, `CatalogModule`
- Registrado en `app.module.ts` imports
- Sin dependencias circulares detectadas

## Tests

`cd backend && npm test -- causas-merma.service.spec.ts`

| # | Caso | Resultado |
|---|------|-----------|
| 1 | create inserta `es_fijo=false` y nombre trim | PASS |
| 2 | create rechaza duplicado case-insensitive | PASS |
| 3 | update rechaza `es_fijo=true` | PASS |
| 4 | remove rechaza `es_fijo=true` | PASS |
| 5 | remove rechaza COUNT>0 (en uso) | PASS |
| 6 | remove soft-delete OK sin uso | PASS |

**Resumen:** 6/6 passing

## Concerns

- Mensaje de duplicado: `Ya existe una causa de merma con el nombre "…"` (patrón descuentos; no especificado en plan).
- `InventarioModule` / `CatalogModule` importados para Task 5; aún no usados por `CausasMermaService`.

## Archivos creados/modificados

```
backend/src/modules/mermas/dto/create-causa-merma.dto.ts
backend/src/modules/mermas/dto/update-causa-merma.dto.ts
backend/src/modules/mermas/causas-merma.service.ts
backend/src/modules/mermas/causas-merma.service.spec.ts
backend/src/modules/mermas/causas-merma.controller.ts
backend/src/modules/mermas/mermas.module.ts
backend/src/app.module.ts
```
