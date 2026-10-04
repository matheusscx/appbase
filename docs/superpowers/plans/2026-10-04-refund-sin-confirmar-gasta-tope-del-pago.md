# Plan: un REFUND sin confirmar gasta el tope por pago de la nota del POS

**Status**: In Progress · **Date**: 2026-10-04 · **Owner**: sesión "Pasarela: un reembolso sin confirmar gasta el tope de la nota del POS"

Spec: [`../specs/2026-10-04-refund-sin-confirmar-gasta-tope-del-pago.md`](../specs/2026-10-04-refund-sin-confirmar-gasta-tope-del-pago.md)

## Context

Lo medido y lo decidido están en la spec. Decisión A del owner (2026-10-04); t1/t2 de la Sesión de
esfuerzo máximo.

## Scope / Out of scope

- Dentro: el tope por pago (`corregibles`), la exclusión del propio REFUND en tx1 y el texto del
  modal de la nota.
- Fuera: `devuelto-venta.ts` (t2), ventas de más de un pago, `veredictoPorSaldo` (lo toca el frente del sandbox).

## Backend

- [ ] e2e en rojo: el repro pasa a test (opciones 83.000 + `sinConfirmar`, 83.001 → 400, "salió" → corrección entra; "no salió" → vuelve a 100.000)
- [ ] `corregibles`: columna `sin_confirmar` (REFUND `iniciada`/`error`, sin el excluido) y resta con un único pago
- [ ] `excluirReembolsoId` por `devolvibleDelPagoUnico` → `exigirTopeDelReembolsoPasarela` → handler → `verificarReembolsable(propio)`
- [ ] `OpcionDevolucion.sinConfirmar`
- [ ] Unitarios: fixture de `venta-documentos.service.spec.ts`, caso de la resta y de la exclusión
- [ ] Mutantes: sin la resta del sin confirmar (mueren los e2e del POS); sin la exclusión (muere el REFUND total)

## Frontend

- [ ] `OpcionDevolucion.sinConfirmar` en `useDocumentosVenta.ts`; descripción de la opción en `NotaCreditoModal.vue`
- [ ] Spec del modal; Playwright entero

## Verification

- [ ] Gate entero (`verify-feature`), con Playwright sobre `entorno.sh stack`
- [ ] Docs: `ventas.md`, `pasarela-pagos.md`, ADR-029 (consecuencia), `ESTADO.md`; la entrada pasa a `resueltos.md`; este plan y la spec se borran

## Decisions / Open questions

Ninguna abierta.
