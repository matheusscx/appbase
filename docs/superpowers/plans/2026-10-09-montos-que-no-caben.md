# Plan: los 500 de montos que no caben

**Status**: Done · **Date**: 2026-10-09 · **Owner**: frente lanzado por la orquestadora

Spec: [`2026-10-09-montos-que-no-caben-design.md`](../specs/2026-10-09-montos-que-no-caben-design.md).
Lo medido, con los números: [`resueltos.md`](../../agent/resueltos.md) (cerrada 2026-10-09).

## Context

La cortesía al techo y los cuatro residuos del tope del esperado de caja, todos de la misma
familia: un monto de 10^14 o más que llega a un `INSERT`.

## Scope / Out of scope

- **Adentro:**
  - Medir los cuatro con e2e de API.
  - El 400 de la cortesía.
  - `IsMontoPersistible` en los DTO medidos.
  - El rastro del tope en los cinco caminos.
  - El texto de la reversa.
  - Los rótulos de la pantalla del rastro.
- **Afuera:** el cálculo de la cortesía, el motor, `movimientos_inventario` y los demás
  `@EsMontoCobrado`.

## Tareas

- [x] Medir: la cortesía por las dos rutas, los montos sueltos de caja, pagos y compras, la
  salida enorme, y la bisección (pura, con cota, y barrido de un acierto).
- [x] Cortesía: el guard en `baldesDeCortesias`, con e2e y el mutante que revierte.
- [x] `IsMontoPersistible` en el movimiento, el pago de la venta, el abono, el pago a proveedor y
  el pago al confirmar. e2e de los nueve pedidos y mutante sin decorador.
- [x] `EsperadoNoCabeError` y los envoltorios de `VentasService.crear`,
  `SalonesService.cerrarCuenta`, `PagosService.registrarAbono` y `ComprasService.anularPago`.
  Un e2e de rastro por camino. Mutantes: sin el envoltorio del POS, y `conRastroDeRechazo` sin el
  error nuevo.
- [x] Remedio por camino en el mensaje, y la doc de `gestion-cajas.md`.
- [x] Rótulos en `CajaIntentosRechazados.vue`.
- [x] `verify-feature`. Mudar las dos entradas a `resueltos.md` y anotar la de los demás
  `@EsMontoCobrado`.
