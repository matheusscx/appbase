# Plan: los impuestos adicionales de una línea salen del ítem

**Status**: Done · **Date**: 2026-10-06 · **Owner**: Cesar Matheus
**Spec**: [`../specs/2026-10-06-impuestos-de-linea-del-item-design.md`](../specs/2026-10-06-impuestos-de-linea-del-item-design.md)

## Context

Parte fiscal de la entrada de `pendientes.md` § 3. Fiscal y toca el motor: va sola, sin otro
frente de backend.

## Scope / Out of scope

- **Dentro:** `impuestoIds` de línea en las cuatro puertas; rama de `resolverLinea`; el 400 del IVA
  explícito de `calcular()`; pasamanos de `ventas.service`; docs; tipo del frontend.
- **Fuera:** `validarImpuestos` de `/items` (sigue igual); cualquier cambio a la derivación del IVA.

## Backend

- [x] e2e rojo primero: describe nuevo en `calculo-precios.e2e-spec.ts` (4 puertas × 3 valores, sin venta ni orden) y spec del agravante con `ProviderFactory` falso.
- [x] Borrar `impuestoIds` de `LineaVentaDto` y `LineaDto`.
- [x] `resolverLinea` sin la rama; borrar el 400 del IVA explícito de `calcular()`; `ventas.service` sin el pasamanos.
- [x] Unit: sacar los dos tests que mandaban el campo, test nuevo del camino interno.
- [x] `topes-dto.e2e-spec.ts`: sacar las tres filas de `lineas.0.impuestoIds`.

## Frontend

- [x] `useCalculoPrecios.ts`: sacar `impuestoIds` de `CalcularLineaInput`.

## Verification

- [x] Mutantes: el campo devuelto a cada DTO; la rama restaurada.
- [x] Gate de CLAUDE.md entero (turno a la orquestadora para test:e2e completo, frontend `npm test` y Playwright).
- [x] `verify-feature` con recibo.

## Docs

- [x] `motor-calculo-precios.md` (request y Decisiones), `ventas.md`, `impuestos.md`, `tienda-online.md`, nota de actualización en ADR-018.
- [x] `pendientes.md` → `resueltos.md`; fila en `ESTADO.md`.

## Decisions / Open questions

- El 400 del IVA explícito por línea se borra: queda sin camino (ver spec § Diseño 3).
