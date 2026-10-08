# Plan: `pagos[].metodoPagoId` en mayúsculas y arrays como elemento de la personalización

**Status**: Done · **Date**: 2026-10-08 · **Owner**: sesión "Validaciones: método de pago en
mayúsculas y personalización"

## Context

Dos entradas de `docs/agent/pendientes.md` § 1, asignadas por la orquestadora. No tocan el motor de
cálculo ni una regla de plata: las dos se cierran en el borde (DTO).

**Barrido de `metodoPagoId` (leído antes de tocar código):**

- `PagosService.registrar` es el único que arma el mapa de métodos (`metodoPagoMap`, ids de la base)
  y lo compara con el casing del cliente: el gate de "no habilitado", el vuelto (`permiteVuelto`),
  el orden del reparto, el split de propina, el concepto del movimiento de caja y el emisor de la
  emisión (`porPago`). Todos detrás del gate: con el id en minúsculas en el borde quedan cubiertos.
  Lo llaman **tres puertas**: `POST /ventas` y `POST /cuentas/:id/cerrar` (`PagoVentaDto`) y el
  abono `POST /pagos` (`PagoItemDto`). El abono es el mismo bug en el mismo gate: va en este frente.
- `venta-documentos` no compara el id (usa el `emisor` que ya resolvió `registrar`).
- Fuera del gate, sin comparación en TypeScript (SQL con `uuid`, que no distingue casing): compras
  (`CrearPagoProveedorDto`, `PagoAlConfirmarDto`), el filtro de `GET /pagos`, suscripciones y el
  callback online (ids de la base).
- **No cubiertos y fuera de este frente** (no escriben plata; anotados en `pendientes.md` § 2,
  sin medir): `LineaCierreDto`/`LineaJustificacionDto` de caja (`claveDe` compara con el arqueo de
  la base: 400 "no pertenece al arqueo" / "falta el motivo") y `metodoPagoIds` de descuentos y
  recargos (`[x, X]` pasa `@ArrayUnique` y choca con la PK de la puente). Y en § 1, como barrido
  mecánico (orquestadora), los 41 de 46 `@ValidateNested({ each: true })` del backend sin
  `@IsObject({ each: true })`.

## Tareas

- [x] 1. e2e rojo en `test/motor-entrada.e2e-spec.ts`: `pagos[].metodoPagoId` en mayúsculas por las
  tres puertas guarda el pago (con el vuelto del efectivo) en vez de 400.
- [x] 2. `@IdEnMinusculas()` en `PagoVentaDto.metodoPagoId` y `PagoItemDto.metodoPagoId`. Verde.
- [x] 3. e2e rojo: `[[]]` en `extras`, `grupos`, `grupos[].opciones`, `componentes` y
  `componentes[].grupos` es 400 *"each value in X must be an object"*, con control en 201.
- [x] 4. `@IsObject({ each: true })` en los cinco `@ValidateNested({ each: true })`. Verde.
- [x] 5. Mutantes que revierten al código anterior, uno por arreglo (y por campo en la
  personalización), medidos fila por fila.
- [x] 6. Docs: entradas a `resueltos.md`, las tres nuevas a `pendientes.md`, `motor-calculo-precios.md`, `patterns/backend.md`
  (§ 3 y § "UUID en mayúsculas").
- [x] 7. Gate completo + `verify-feature` con recibo. Commit en la rama, sin push.
