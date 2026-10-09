# Plan: guard de reentrada en el alta de suscripción de la tienda

**Status:** In Progress · **Date:** 2026-10-09 · **Owner:** frente lanzado por la orquestadora

## Context
Spec: [`2026-10-09-suscripcion-doble-envio-design.md`](../specs/2026-10-09-suscripcion-doble-envio-design.md).

## Scope / Out of scope
- Dentro: `confirmar()` de `frontend/app/pages/tienda/suscripciones.vue` y su spec.
- Fuera: el backend de `POST /suscripciones` (entrada nueva en `pendientes.md`); `reanudarAltaPendiente`
  (corre una vez en `onMounted`, no desde un submit).

## Backend
Nada.

## Frontend
- [ ] Spec en `suscripciones.nuxt.spec.ts`: dos `submit` seguidos con el POST retenido → una sola alta. Verlo en rojo.
- [ ] Guard `if (confirmando.value) return` en `confirmar()`. Verlo en verde.
- [ ] Mutante: revertir el guard → el spec vuelve a rojo; restaurar.

## Verification
- [ ] Gate del front y del back del checklist de `CLAUDE.md`.
- [ ] Playwright entero, con turno de la orquestadora.
- [ ] Revisión independiente (`verify-feature` paso 7) y recibo del pre-commit.

## Decisions / Open questions
- Backend sin idempotencia: decisión aparte (orquestadora, 2026-10-09).
