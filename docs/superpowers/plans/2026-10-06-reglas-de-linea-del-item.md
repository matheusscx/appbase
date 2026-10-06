# Plan: las reglas de una línea salen del ítem

**Status**: Done · **Date**: 2026-10-06 · **Owner**: Cesar Matheus
**Spec**: [`../specs/2026-10-06-reglas-de-linea-del-item-design.md`](../specs/2026-10-06-reglas-de-linea-del-item-design.md)

## Context

Parte de producto de la entrada de `pendientes.md` § 3. Toca el motor: va sola, sin otro frente
de backend. `impuestoIds` queda afuera (fiscal).

## Scope / Out of scope

- **Dentro:** `descuentoIds`/`recargoIds` de línea en las cuatro puertas; nivel venta solo en la
  tienda; rama de `resolverLinea`; docs; tipo del frontend.
- **Fuera:** `impuestoIds`; el permiso de la puerta de nivel venta en `/ventas` (entra con la
  pantalla de "la caja elige descuentos").

## Backend

- [x] Test e2e rojo primero: describe nuevo en `calculo-precios.e2e-spec.ts` (cuatro puertas × dos campos de línea; dos puertas online × dos campos de venta; `/ventas` no crea venta).
- [x] Borrar `descuentoIds`/`recargoIds` de `LineaVentaDto` y `LineaDto`; reubicar el porqué del tope y del `@ArrayUnique` en los campos de venta, que lo citaban.
- [x] `CheckoutOnlineDto` con `OmitType` en `online` (controller + service), con `metodoPagoId` (decidido tras la revisión de seguridad).
- [x] `resolverLinea` sin la rama del reemplazo; `ventas.service` sin el pasamanos; comentarios de `resolverReglas`.
- [x] Unit: sacar el test del reemplazo, migrar los `descuentoIds: []` a `mockItems`, test nuevo del camino interno.
- [x] e2e existentes: migrar a regla asociada al ítem (`ventas`, `venta-documentos`, `uso-reglas`, `calculo-precios`, `topes-dto`).

## Frontend

- [x] `useCalculoPrecios.ts`: sacar los dos campos de `CalcularLineaInput`.

## Verification

- [x] Mutantes: cada campo devuelto a su DTO, la tienda con `CalcularVentaDto`, la rama restaurada.
- [x] Gate de CLAUDE.md entero (turno a la orquestadora para test:e2e completo, frontend `npm test` y Playwright).
- [x] `verify-feature` con recibo.

## Docs

- [x] `motor-calculo-precios.md` (request y § del reemplazo), `ventas.md`, `descuentos-recargos.md` (puertas del nivel y la tienda), `tienda-online.md` (el DTO del checkout). `patterns/backend.md` § 3 no cambia: el `@ArrayUnique` sigue en los ids de venta.
- [x] `pendientes.md`: queda solo la parte fiscal más la decisión revisada del nivel venta y su permiso. `resueltos.md`: la parte de producto. `ESTADO.md`: fila nueva. `desarrollo-nuevo.md` § 2: la pantalla y el permiso de "la caja elige descuentos".

## Decisions / Open questions

- Nivel venta: revisado por la Sesión de esfuerzo máximo el 2026-10-06. Ver spec.
