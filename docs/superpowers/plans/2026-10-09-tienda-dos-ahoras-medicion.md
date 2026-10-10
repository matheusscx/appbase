# Plan: medir el cargo sin venta de la tienda por los dos "ahora"

- **Status:** Done
- **Date:** 2026-10-09
- **Owner:** frente lanzado por la orquestadora
- **Spec:** [`2026-10-09-tienda-dos-ahoras-medicion-design.md`](../specs/2026-10-09-tienda-dos-ahoras-medicion-design.md)

## Context

Entrada de `docs/agent/pendientes.md` § 2, leída en el código y no corrida. Se mide
con un e2e de API, sin Transbank real.

## Scope / Out of scope

- **Scope:** un e2e nuevo en `backend/test/` y la reescritura de la entrada.
- **Out of scope:** motor de cálculo, flujo de pago, fiscal, `POST /suscripciones`.

## Backend

- [x] Verificar las citas de línea de la entrada contra `HEAD` (eran de `54bc8f6e`).
- [x] `backend/test/tienda-dos-ahoras.e2e-spec.ts`: control sin cambio; reloj (promo
      por franja y descuento que vence a medianoche); precio arriba (con el reembolso
      manual); precio abajo, con y sin `permite_vuelto`; tasa USD. Por caso: orden,
      venta, redirect, `verificar`. Mutante: sin mover el reloj en el retorno, rojo.
- [x] Correr la suite sola y leer cada afirmación contra lo que dice la entrada.

## Frontend

Nada.

## Verification

- [x] `verify-feature`: lint, typecheck, `npm test`, `test:e2e` entero (con turno de
      la orquestadora). Sin Playwright: el diff es `backend/test/` y docs.
- [x] Revisión independiente y recibo si el pre-commit lo pide.

## Decisions / Open questions

- [x] Opciones de arreglo con su costo, enviadas a la orquestadora. El owner decidió
      el 2026-10-09: A (congelar lo cobrado, frente propio fiscal), D (avisar sin
      mentir) y E (venta online sin vuelto). Quedan en `pendientes.md` § 3.
