# Task 6 — E2E `mermas.e2e-spec.ts`

**Status:** Done  
**Date:** 2026-07-15

## Entregable

- `backend/test/mermas.e2e-spec.ts` — 7 escenarios E2E

## Escenarios cubiertos

| # | Escenario | Resultado |
|---|-----------|-----------|
| 1 | `GET /causas-merma` → ≥ 5 fijas | PASS |
| 2 | `POST /causas-merma` Rotura envase → 201 | PASS |
| 3 | Producto seed Carne molida (`...0257`) con stock/costo | PASS |
| 4 | `POST /mermas` Vencimiento → 201 + `costoPerdido` | PASS |
| 5 | `GET /mermas` incluye `causaNombre` y `costoPerdido` | PASS |
| 6 | `PATCH /items/:id/stock` motivo merma → 400 | PASS |
| 7 | PATCH causa fija → 400; DELETE causa en uso → 400 | PASS |

## Ejecución

```bash
cd backend && npm run test:e2e -- mermas.e2e-spec.ts
```

**Resultado:** 7 passed, 0 failed (~1.9s)

## Notas

- Login Paris admin + switch tenant (mismo patrón que `inventario.e2e-spec.ts`).
- Mermas no requieren caja abierta.
- Endpoint de ajuste stock: `PATCH /items/:id/stock` (no POST ajuste-stock).

## Commit

```
test(mermas): E2E de causas, registro y rechazo en ajuste
```
