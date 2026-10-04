# Plan: la entrega gratuita sin rebaja se ve, y la promo no regala

**Status:** Done · **Date:** 2026-10-04 · **Owner:** Cesar Matheus
**Spec:** [`2026-10-04-entrega-gratuita-y-promo-100-design.md`](../specs/2026-10-04-entrega-gratuita-y-promo-100-design.md)

## Context

Frente fiscal, solo. Decisiones D1–D5 en la spec y en `pendientes.md` § 6. No toca el motor.

## Scope / Out of scope

Dentro: `documentarVenta` (fila `nadie` por $0 y el recargo sobre $0), `PromocionesService`
(tope < 1 en `porcentaje`), el hint del formulario de promociones y las docs. Fuera: lo de la spec
§ "Fuera de alcance".

## Backend

- [x] T1 — Unitarios rojos en `venta-documentos.service.spec.ts`: lista $0 → una fila `nadie`
  $0 (boleta, factura de los dos facturadores, online; sin `save` vacío, sin enlaces); total > 0
  con `totalBruto = 0` (recargo) → documentos de lo cobrado; país sin boleta sigue en `[]`.
- [x] T2 — `documentarVenta`: reordenar los cortes (spec § D1/D2). Verde.
- [x] T3 — E2E rojos en `venta-documentos.e2e-spec.ts`: lista $0 (POS y online) → fila `nadie`
  $0 y aparece en `?documento=sin_documento`; producto de $0 con recargo de venta fijo → boleta del
  sistema por el total. Verde tras T2.
- [x] T4 — Barrido de lectores de `venta_documentos` (subagente) y conducta medida de los que
  dependen de que exista una fila (NC/devolución sobre la venta de $0).
- [x] T5 — Unitarios rojos en `promociones.service.spec.ts`: crear `porcentaje` 1.0000 y 1.5 →
  400; 0.9999 pasa; `nxm` 1.0000 pasa; `PATCH { valorPorcentaje: '1' }` → 400; `PATCH { tipo:
  'porcentaje' }` sobre un `nxm` 1.0000 → 400; `PATCH { activo: false }` / `{ nombre }` sobre una
  `porcentaje` 1.0000 ya guardada → pasa.
- [x] T6 — Implementar en `validarFormaSegunTipo` + condición del `PATCH`. Verde.
- [x] T7 — E2E de promociones: el 400 por el pipe real, y la promo vieja al 100 % (armada por SQL:
  es un estado que solo existe de antes del cambio) se puede pausar y se sigue aplicando si está
  activa (el motor no cambia).

## Frontend

- [x] T8 — `PromocionTipoConfig.ayudaPorcentaje` por tipo; el drawer la muestra. Spec del config.

## Verification

- [x] Gate entero (`verify-feature`), con turno de la orquestadora para `test:e2e`. Playwright:
  solo cambia un hint de texto; se decide en el cierre si corresponde.
- [x] Mutantes: volver al corte `totalBruto ≤ 0` sin mirar el total (muere el recargo); sacar la
  fila `nadie` (mueren los de lista $0); sacar el tope (mueren los de promo); validar el tope
  siempre en el `PATCH` (muere el de pausar).

## Decisions / Open questions

Ninguna abierta. Las decisiones viven en la spec.
