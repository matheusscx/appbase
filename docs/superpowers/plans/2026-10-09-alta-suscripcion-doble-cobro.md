# Plan: medir el doble cobro del alta de suscripción

**Status**: Done · **Date**: 2026-10-09 · **Owner**: frente lanzado por la orquestadora

Spec: [`2026-10-09-alta-suscripcion-doble-cobro-design.md`](../specs/2026-10-09-alta-suscripcion-doble-cobro-design.md).

## Context

Entrada de `pendientes.md` § 2, *"Dos `POST /suscripciones` iguales cobran dos veces"*: leída, no
medida. La tarea es medirla y, si se confirma, llevar opciones al owner sin construir nada.

## Scope / Out of scope

- **Adentro:** el e2e de medición; leer ADR-026, ADR-029 y los usos de `@ClaveIdempotencia()`;
  2 o 3 opciones con su costo; reescribir la entrada.
- **Afuera:** el arreglo, la pasarela real, Transbank y todo lo fiscal.

## Tareas

- [x] Escribir `backend/test/suscripcion-alta-doble.e2e-spec.ts` con los tres providers
  sobrescritos; correrlo solo contra la base del worktree.
- [x] Control: que el mock de `cobrar` cuente de verdad (un solo POST → 1 llamada, 1 venta,
  1 suscripción).
- [x] Armar las opciones (ADR-026, ADR-029, ventas/pagos/compras/salones/pasarela) y mandarlas a
  la orquestadora.
- [x] Reescribir la entrada de `pendientes.md` con lo medido; moverla a § 4 mientras esperaba
  al owner.
- [x] El owner decidió (2026-10-09, vía la orquestadora): opción (a), como ADR-029, y dos
  suscripciones iguales son legítimas. La entrada pasa a § 3 con la decisión.
- [x] `verify-feature` (sin Playwright: el diff es `backend/test/` y docs). Pedir turno antes del
  `test:e2e` entero.
