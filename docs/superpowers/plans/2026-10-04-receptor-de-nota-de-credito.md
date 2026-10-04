# Plan: la nota de crédito lleva el receptor de la venta que corrige

**Status:** Done · **Date:** 2026-10-04 · **Owner:** sesión del frente (fiscal, frente propio)

## Context

Spec: [`2026-10-04-receptor-de-nota-de-credito-design.md`](../specs/2026-10-04-receptor-de-nota-de-credito-design.md).
Decisiones: `pendientes.md` § 6, "Cómo arrancarlo" (owner, 2026-10-04).

## Scope / Out of scope

Dentro: copia del receptor en toda corrección, receptor capturado en una venta sin cliente, marca
`receptor_es_emisor`, detalle y modal. Fuera: el ticket de la NC, `venta_documentos`, la emisión.

## Backend

- [x] `Venta.receptorEsEmisor` + `@Check`; `startup-pos.sql`.
- [x] `ReceptorNotaCreditoDto` en `create-nota-credito.dto.ts`; el controller lo pasa.
- [x] `CrearNotaCreditoParams.receptor`; huella con `receptor`.
- [x] `crearNotaCreditoEnTransaccion`: leer customer de la venta, 400 si choca, validar el capturado,
  marca, copia en un `save`.
- [x] `findOne`: `receptorEsEmisor`, `tipoDocumento.rutChileno` y `receptorSugerido`.
- [x] Unitarios en `ventas.service.spec.ts` (mutantes: sin la copia, sin la marca, sin el 400).
- [x] e2e: la serie de una Factura (dos NC, las dos con el receptor), boleta sin cliente
  (capturado, emisor, RUT malo 400), devolución interna con cliente.

## Frontend

- [x] `NotaCreditoModal`: bloque de receptor opcional, validación gemela, `receptor` en el body.
- [x] `VentaDetalleDrawer`: pasa `tieneCliente`/`rutChileno`; "A nombre del local".
- [x] Specs de los dos componentes.

## Verification

Gate entero (`verify-feature`), Playwright entero (turno de la orquestadora), arranque sobre una
base con ventas sembradas con el código de `main`.

## Decisions / Open questions

- En una venta sin cliente, la nota precarga el receptor de la última que lo capturó (spec § 2.5;
  owner, por AskUserQuestion de la Sesión de esfuerzo máximo).
