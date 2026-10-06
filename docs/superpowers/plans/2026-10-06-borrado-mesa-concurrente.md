# Plan: borrar una mesa (o su salón) mientras se abre una cuenta en ella

- **Status:** Done
- **Date:** 2026-10-06
- **Owner:** orquestadora (sesión "Pendientes"); dudas técnicas a la Sesión de esfuerzo máximo
- **Spec:** [`specs/2026-10-06-borrado-mesa-concurrente-design.md`](../specs/2026-10-06-borrado-mesa-concurrente-design.md)

## Context

`eliminarMesa` y `eliminarSalon` cuentan cuentas abiertas sin lock y después borran: una apertura
concurrente queda abierta sobre una mesa borrada y lo que pide deja de estar apartado (medido en la
spec: otra mesa y el POS se llevan la misma unidad).

## Scope / Out of scope

- **Scope:** el lock de las mesas antes de contar, en los dos borrados; el e2e de carrera; los
  unitarios del orden; los comentarios de las dos consultas de lo apartado; docs.
- **Scope (agregado por la orquestadora):** `guardarLayout` en orden de `mesa_id`, con su carrera.
- **Out of scope:** el `LEFT JOIN` (decidido en la spec); crear una mesa en un salón que se está
  borrando.

## Backend

- [x] e2e `test/borrado-mesa-concurrente.e2e-spec.ts` en rojo sobre el código actual (mesa y salón).
- [x] `eliminarMesa`: `db.transaccion` → `FOR UPDATE` de la mesa viva → conteo → `UPDATE`.
- [x] `eliminarSalon`: `db.transaccion` → `FOR UPDATE … ORDER BY mesa_id` de las mesas vivas del
      salón → conteo → `UPDATE mesas` acotado a las lockeadas → `UPDATE salones`.
- [x] Unitarios: transacción antes del primer query, lock antes del conteo, `ORDER BY mesa_id`,
      `UPDATE` acotado.
- [x] Comentarios de `bloquearUnidadesParaSalida` y `findUnidades`: nombrar el lock que sostiene
      que el `JOIN mesas` / su ausencia no pierde filas.

## Frontend

Nada.

## Verification

- [x] e2e de carrera en verde, 10 corridas seguidas.
- [x] Mutante: revertir cada lock, y el orden del layout, pone rojo su caso, en loop.
- [x] Medir `guardarLayout` vs `eliminarSalon` antes y después (2/3 → 3/3): entra al frente,
      `guardarLayout` en orden de `mesa_id`, caso 3 del e2e.
- [x] Gate completo de `CLAUDE.md` (con turno para las suites pesadas) y `verify-feature` con recibo.
- [x] Mover la entrada a `resueltos.md`; `docs/patterns/backend.md` §15 (tabla del par de locks).

## Decisions / Open questions

- `LEFT JOIN` no: ver spec § Decisión, punto 3.
