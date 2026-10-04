# Plan: el kardex deja de llamar "costo perdido" a la cortesía y a la comida del personal

**Status:** Done · **Date:** 2026-10-04 · **Owner:** sesión "Kardex: la cortesía y la comida no son costo perdido"
**Spec:** [`2026-10-04-kardex-costo-de-baja-design.md`](../specs/2026-10-04-kardex-costo-de-baja-design.md)

## Context

Entrada de `pendientes.md` § 3. Solo lectura: no se escribe en `movimientos_inventario`. Se ejecuta
sin esperar revisión (encargo del owner); las dudas van a la Sesión de esfuerzo máximo.

## Scope / Out of scope

Dentro: spec § 3. Fuera: spec § 4.

## Backend

- [x] **1. Lectura del kardex.** Unit primero (rojo): `mapMovimientoRow` con `motivo_baja_tipo` de
  merma, cortesía y personal → `motivoBajaTipo` y `costoBaja`; sin baja → los dos `null`; el SQL
  trae `mb.tipo AS motivo_baja_tipo` y su `JOIN` no lleva `mb.eliminado_el`. Después
  `findMovimientos`, `MovimientoRow`, `MovimientoListItem`.
- [x] **2. E2E** en `mermas.e2e-spec.ts`, describe de las anulaciones: merma y cortesía del mismo
  plato, el kardex del plato devuelve tipo y `costoBaja` de cada una. La comida del personal por
  `POST /mermas` en el describe principal.

## Frontend

- [x] **3. `inventario/index.vue`:** `Movimiento` con `motivoBajaTipo` y `costoBaja`; columna
  "Costo de la baja", neutro solo para cortesía y personal (el resto, sin tipo incluido, en rojo);
  badge con `tipoMotivoBajaLabel` (`useSalones.ts`). Spec `.nuxt.spec.ts` primero.
- [x] **4. Barrido del string** `costoPerdido` en todo el repo: solo quedan los de Mermas.

## Cierre

- [x] **5. Mutantes** de la spec § 5, cada uno revertido y medido.
- [x] **6. Docs:** `inventario-kardex.md`, `mermas-valorizadas.md` (la línea del kardex), `ESTADO.md`,
  entrada nueva del filtro "Merma" en `pendientes.md`, la entrada movida a `resueltos.md`.
- [x] **7. Gate completo** (con turno de la orquestadora para las suites pesadas), Playwright del
  kardex, `verify-feature` con su recibo, commit en la rama del worktree, SHA a la orquestadora.
