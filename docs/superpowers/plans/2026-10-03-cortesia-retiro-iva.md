# Plan: La cortesía como retiro gravado con IVA

**Status:** Done · **Date:** 2026-10-03 · **Owner:** owner (decisiones D1–D4 de la spec)

## Context
Spec: [`2026-10-03-cortesia-retiro-iva-design.md`](../specs/2026-10-03-cortesia-retiro-iva-design.md).
Frente fiscal, va solo. No toca el motor de precios (`calcular()`), ni lo vendido del resumen.

## Scope / Out of scope
Dentro: congelar neto + IVA de cada cortesía y mostrarlos en el reporte. Fuera: el documento, el
`motivo` del kardex, la comida del personal, otros países (spec § 4).

## Backend
- [x] `salones/cortesia-retiro.ts`: `baldesDeCortesia` pura + su spec unitario (TDD).
- [x] `cuenta_linea_anulaciones`: `monto_afecto`, `monto_exento`, `monto_impuestos` + `CHECK` todas-o-ninguna.
- [x] `SalonesService`: `baldesDeCortesias` (una consulta por operación) en `anularLinea` y
      `cancelarConMotivo`; `escribirAnulacionEnLinea` recibe los baldes.
- [x] `AnulacionesReporteService`: `fiscal` en la fila y en `porTipo`.
- [x] E2E: anular-linea (cortesía, merma, no elaborado, cancelar con motivo, ítem borrado) y reporte.

## Frontend
- [x] `salones/anulaciones.vue`: columna IVA + línea de la tarjeta Cortesías; spec de la página.

## Verification
Gate entero (`verify-feature`), suites pesadas por turno con la orquestadora.

## Docs
- [x] `salones-mesas.md`, `impuestos.md`, `PRODUCTO.md`, `ESTADO.md`, ADR-010 (actualización),
      `DIFERENCIADORES.md`, `pendientes.md` → `resueltos.md`, investigación copiada.
