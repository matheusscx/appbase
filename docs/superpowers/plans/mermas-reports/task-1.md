# Task 1 — Modelo de datos (`causas_merma` + `causa_merma_id` en kardex)

**Status:** DONE  
**Date:** 2026-07-15  
**Commit:** `25f0ee9` — feat(mermas): agrega esquema causas_merma y FK en kardex

## Objetivo

Introducir el catálogo tenant-scoped de causas de merma y enlazarlo opcionalmente desde el kardex (`movimientos_inventario`) cuando el motivo del movimiento sea merma.

## Cambios realizados

### 1. Entidad `CausaMerma`

**Archivo:** `backend/src/modules/mermas/entities/causa-merma.entity.ts`

- Tabla `causas_merma` con PK `causa_merma_id` (UUID explícito, ADR-004).
- Campos: `tenant_id`, `nombre`, `activo`, `es_fijo`.
- Soft delete vía `@DeleteDateColumn` en `eliminado_el`.
- Timestamps `creado_el` / `actualizado_el` con `type: 'timestamptz'`.

### 2. FK en kardex

**Archivo:** `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts`

- Columna nullable `causa_merma_id` (`type: 'uuid'`) añadida después de `costoUnitario`.
- Propiedad TypeORM: `causaMermaId: string | null`.

### 3. Registro en TypeORM

**Archivo:** `backend/src/app.module.ts`

- Import de `CausaMerma`.
- Entidad registrada en el array `entities` (antes de `MovimientoInventario`).
- **No** se creó `MermasModule` (reservado para Task 2).

### 4. Esquema SQL canónico

**Archivo:** `startup-pos.sql`

- `CREATE TABLE causas_merma` insertada inmediatamente antes de `movimientos_inventario` (orden correcto de dependencias FK).
- Índice único parcial: `uq_causas_merma_tenant_nombre` sobre `(tenant_id, lower(nombre)) WHERE eliminado_el IS NULL`.
- Columna `"causa_merma_id" UUID REFERENCES "causas_merma" ("causa_merma_id")` en `movimientos_inventario`.

## Archivos modificados

| Archivo | Acción |
|---------|--------|
| `backend/src/modules/mermas/entities/causa-merma.entity.ts` | Creado |
| `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts` | Modificado |
| `backend/src/app.module.ts` | Modificado |
| `startup-pos.sql` | Modificado |

## Verificación

- [x] PK/FK UUID con `type: 'uuid'` explícito en entidades TypeORM.
- [x] Soft delete con `@DeleteDateColumn`.
- [x] `CausaMerma` en `app.module.ts` entities (sin módulo).
- [x] SQL: tabla + índice único + FK en kardex.
- [x] Commit en `main`.
- [x] Sin errores de linter en archivos TypeScript tocados.

## Fuera de alcance (Task 2+)

- `MermasModule`, controller, service, DTOs.
- Seed de causas fijas por tenant.
- Validación de negocio (obligatoriedad de `causa_merma_id` cuando `motivo = 'merma'`).
- Migración TypeORM separada (dev usa `synchronize`; prod usará migrations).

## Concerns

Ninguno. El esquema queda listo para Task 2 (módulo + API + seed).
