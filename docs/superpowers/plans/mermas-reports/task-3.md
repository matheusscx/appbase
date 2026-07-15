# Task 3 — Seed de causas fijas (crear tenant + seeder Paris/Falabella)

**Status:** DONE  
**Date:** 2026-07-15

## Commit

**Commit:** `ee15e3c` — feat(mermas): siembra causas fijas al crear tenant y en seed

## Entregables

### Constante compartida
- `backend/src/modules/mermas/causas-merma.defaults.ts` — `CAUSAS_MERMA_FIJAS` (5 nombres)

### Creación de tenant (`TenantsService.create`)
- Tras caja virtual, en la misma transacción: INSERT de 5 causas con `activo=true`, `es_fijo=true` (UUID generado por BD)

### Seeder dev (`seedCausasMerma`)
- Llamado en `onApplicationBootstrap` justo después de `seedTenants()`
- Índice parcial `uq_causas_merma_tenant_nombre` vía `CREATE UNIQUE INDEX IF NOT EXISTS`
- IDs fijos: Paris `0266–0270`, Falabella `0271–0275`
- Idempotente por `causa_merma_id`

### seeder.module.ts
- Sin cambios — solo usa `dataSource.query`, no requiere `forFeature(CausaMerma)`

## IDs sembrados

| Tenant | IDs |
|--------|-----|
| Paris (`440007`) | `440266`–`440270` |
| Falabella (`440040`) | `440271`–`440275` |

## Verificación

Stack en rebuild al commitear; verificación MCP postgres pendiente hasta que backend compile y seed corra.

## Concerns

- Tenants Paris/Falabella creados por seeder **antes** de Task 3 no reciben causas automáticamente en `seedTenants()` (solo INSERT si no existe el tenant). `seedCausasMerma` los cubre con IDs fijos idempotentes.
- Nuevos tenants vía API sí reciben las 5 causas en `create()` sin IDs fijos (UUID aleatorio).
- Error TS preexistente en `causas-merma.service.ts:136` bloqueaba compilación del backend al momento del commit (Task 2).

## Archivos creados/modificados

```
backend/src/modules/mermas/causas-merma.defaults.ts
backend/src/modules/tenants/tenants.service.ts
backend/src/modules/seeder/seeder.service.ts
```
