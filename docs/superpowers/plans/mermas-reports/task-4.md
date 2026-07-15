# Task 4 — Endurecer kardex + quitar `merma` del ajuste genérico

**Status:** Done  
**Date:** 2026-07-15

## Cambios realizados

### `InventarioService`

- `RegistrarMovimientoParams` ahora acepta `causaMermaId?: string | null`.
- Validación en `registrarMovimiento`:
  - `motivo === 'merma'` sin `causaMermaId` → `BadRequestException('La merma requiere una causa tipificada')`
  - `motivo !== 'merma'` con `causaMermaId` → `BadRequestException('causa_merma_id solo aplica a merma')`
- INSERT de `movimientos_inventario` incluye columna `causa_merma_id` (`$12`).
- `findMovimientos` extiende SELECT con `causa_merma_id`, `causa_nombre` y `LEFT JOIN causas_merma` (filtro soft delete).
- `mapMovimientoRow` expone `causaMermaId`, `causaNombre` y `costoPerdido` (Decimal.js: `cantidad × costo_unitario`, 4 decimales, solo merma).

### `AjusteStockDto`

- Eliminado `'merma'` de `MOTIVOS`. La merma ya no puede registrarse vía `PATCH /items/:id/stock`.
- `FindMovimientosDto` conserva `'merma'` como filtro de kardex.

### Tests (`inventario.service.spec.ts`)

- 3 casos nuevos de validación/INSERT para causa merma.
- 1 caso nuevo de `findMovimientos` (causa + `costoPerdido`).
- Tests existentes con `motivo: 'merma'` actualizados con `causaMermaId`.

## Verificación

```bash
cd backend && npm test -- inventario.service.spec.ts
# 25 passed
```

## Commit

```
feat(inventario): exige causa en merma y saca merma del ajuste genérico
```

## Concerns / follow-up

- `backend/test/inventario.e2e-spec.ts` aún envía `motivo: 'merma'` al endpoint genérico de ajuste; fallará hasta que exista el endpoint dedicado de mermas (Task posterior).
- El frontend que use ajuste genérico con merma debe migrar al flujo tipificado.
