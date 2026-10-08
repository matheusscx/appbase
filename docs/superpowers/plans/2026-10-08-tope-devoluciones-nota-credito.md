# Plan: tope a las devoluciones de la nota de crédito y del reembolso

- **Status:** Done
- **Date:** 2026-10-08
- **Owner:** Sesión de esfuerzo máximo (decidió el número); ejecuta la sesión fiscal

## Context

`CreateNotaCreditoDto.devoluciones` era el único array de entrada sin `@ArrayMaxSize`
(`pendientes.md` § 2). La entrada proponía el 200 de sus gemelos de pasarela, pero ese 200
salió de las líneas de una **compra**, no de una venta. `validarDevolucionesReembolso` acepta
una devolución por ítem **distinto** de la venta, y una venta tiene a lo sumo 500 líneas
(`CreateVentaDto.lineas`, `CalcularVentaDto.lineas`). Medido por HTTP el 2026-10-08: una
venta con 201 ítems distintos y su NC entera con 201 devoluciones dan 201. Con 200, esa nota
sería 400. Excepción: la venta que sale de cerrar una cuenta de salón no pasa por
`CreateVentaDto`, y la cuenta no tiene tope de líneas (`pendientes.md` § 2, otro frente).

## Scope / Out of scope

- Tope 500 en `CreateNotaCreditoDto.devoluciones`, `CreateReembolsoDto.devoluciones` y
  `GenerarNotaReembolsoDto.devoluciones`: literal con su porqué, sin constante compartida
  (obligaría a tocar los DTOs de venta y cálculo desde un frente fiscal).
- Fuera: el tope de líneas de la cuenta de salón (frente propio).

## Backend

- [x] Medir el peor caso con stock: 500 productos, NC entera con `stock: 'pierde'`
  (1000 movimientos): 1487 / 1450 / 1516 ms en tres corridas.
- [x] `@ArrayMaxSize(500)` en los tres DTOs, con el comentario del porqué.
- [x] `topes-dto.e2e-spec.ts`: una fila por decorador (501 → 400 nombrando el campo; 500 sin
  ese 400) y la NC real con 500 devoluciones → 201, con 501 → 400 sin escribir nada.
- [x] `create-reembolso.dto.spec.ts`: 500 pasan, 501 no.

## Verification

- [x] Mutante: sin el decorador de la NC, su fila del spec se pone roja.
- [x] Gate completo de CLAUDE.md y `verify-feature` con su recibo.

## Decisions / Open questions

- 500 por construcción, igual al tope de líneas de una venta: decidido por la Sesión de
  esfuerzo máximo (2026-10-08). Corrige el 200 que la misma sesión había dejado anotado sin
  verificar de dónde salía.
