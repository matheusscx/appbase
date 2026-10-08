# Plan: ids en mayúsculas en el cierre de caja y en los métodos de descuentos/recargos

- **Status:** Done
- **Date:** 2026-10-08
- **Owner:** sesión "Ids en mayúsculas: cierre de caja y descuentos por método" (lanzada por la orquestadora)

## Context

Dos entradas de `docs/agent/pendientes.md` § 2, leídas y no medidas por el frente que cerró
`pagos[].metodoPagoId` en mayúsculas (bf7d4511):

1. `LineaCierreDto.metodoPagoId` y `LineaJustificacionDto.metodoPagoId`: `CajaService` cruza cada
   línea con el arqueo de la base por `claveDe(metodoPagoId)` con el casing del cliente.
2. `metodoPagoIds` de `CreateDescuentoDto`/`CreateRecargoDto` (y sus `Update`): `[x, X]` pasa
   `@ArrayUnique` y choca con la PK compuesta de la puente.

## Scope / Out of scope

- **Scope:** medir por HTTP; si se confirma, `@IdEnMinusculas()` en los cuatro campos. Agregado por
  la orquestadora tras medir: una línea por medio en las tres puertas del cierre (repetido = 400).
- **Out of scope:** cualquier cambio a cómo se cuadra o qué se acepta en el cierre más allá del
  casing (se consulta a la orquestadora); el barrido de `@IsObject({ each: true })` (otro frente).

## Backend

- [x] Barrer los lectores de los cuatro campos (DTO → controller → service) por si alguno compara
      con el casing del cliente detrás del primero.
- [x] e2e de medición, rojo sin arreglo, con la respuesta real anotada:
  - `caja.e2e-spec.ts` § arqueo multi-medio: fase 1 (`POST /caja/:id/conteo`), fase 2
    (`POST /caja/:id/cerrar`) y override (`PATCH /caja/:id/arqueo/motivos`) con la línea de
    tarjeta en mayúsculas.
  - `reglas-valor.e2e-spec.ts` § los métodos de pago sobreviven al PATCH: `[x, X]` en `POST` y
    `PATCH` de descuentos y de recargos.
- [x] `@IdEnMinusculas()` en los campos confirmados (antes de `@ArrayUnique` donde lo hay).
- [x] Un mutante por decorador que revierte al código anterior (quitarlo); qué pruebas pone en rojo
      cada uno y por qué, en la tabla de `resueltos.md`.

## Frontend

Nada: el casing lo manda el cliente de la API; la pantalla manda los ids que leyó de la base.

## Verification

- Gate completo de CLAUDE.md (turno con la orquestadora para `test:e2e` completo y `npm test` del
  frontend), `verify-feature` con su recibo.
- Docs: entradas a `resueltos.md` (o reescritas con lo medido), lista de campos de
  `docs/patterns/backend.md` § "Un UUID validado puede venir en mayúsculas".

## Decisions / Open questions

- Una línea repetida en el conteo (`[x, x]`) pisaba la anterior en el `Map`: medido, cerraba la caja
  cuadrada descartando lo contado primero. Con solo el casing, `[x, X]` pasaba de 400 a eso.
  **Decidido (orquestadora, 2026-10-08): opción B**, en el mismo commit: `@UnaLineaPorMedio()` en las
  tres puertas, repetido = 400 que nombra el medio, sin sumar ni elegir. Ninguna pantalla manda
  repetidos (verificado en el código del drawer y de `CajaArqueoTable`).
