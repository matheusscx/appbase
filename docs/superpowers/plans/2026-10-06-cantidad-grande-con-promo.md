# Plan: una cantidad grande con promo NxM o de precio fijo

**Status**: Done
**Date**: 2026-10-06
**Owner**: Cesar Matheus

## Context

Spec: [`../specs/2026-10-06-cantidad-grande-con-promo-design.md`](../specs/2026-10-06-cantidad-grande-con-promo-design.md),
con lo medido y las cinco decisiones. Frente de motor: va solo y con el sistema quieto.

## Scope

- Evaluador por lotes + test diferencial con oráculo + test de rendimiento.
- Tope de 99.999 unidades por venta o mesa: borde (DTOs) y service (suma).
- INSERT por tandas de las trazas de la venta; `aplicacion` → `integer`.
- Medir el loop por unidad de los combos de ítems (`items.service.ts`, B2 de pendientes) y decidir.

## Out of scope

Agregar aplicaciones iguales (spec, decisión 2). El resto de B2–B6.

## Backend

- [x] `promociones.evaluator.ts`: `lotesDelScope`, `CursorDeLotes`, `evaluarNxm` y
      `evaluarPrecioFijo` sin explotar unidades.
- [x] `promociones.evaluator.oraculo.spec.ts`: el evaluador de `6cecf160` como oráculo; bordes de
      cada N, fraccionarias, mismo ítem en varias líneas, combos que cruzan líneas, precio de 20
      cifras, 20.000 unidades, 4.000 carritos generados; y 10⁶ unidades en menos de 50 ms.
- [x] Mutantes: volver al evaluador viejo pone rojo solo el de rendimiento (265 ms); cinco mutantes
      del nuevo (desempate, reuso del combo, barata del grupo, cursor, suma por multiplicación)
      ponen rojo el diferencial.
- [x] Tope: constante + `@IsDecimalHasta` en `cantidad` (calcular, venta, agregar línea, cambiar
      línea) + suma en `CalculoPreciosService.calcular` + suma de la cuenta en `agregarLinea`,
      `actualizarLinea` y `fusionarCuentas`. El unit de salones espía el helper: su SQL lo cubre
      el e2e.
- [x] `ventas.service.ts`: `chunk` en los cuatro `manager.save` de trazas; `VentaPromocion.aplicacion`
      a `integer` (+ `startup-pos.sql`).
- [x] e2e: 400 del tope por cada puerta; una venta de 65.536 unidades con 2x1 → 201 con 32.768
      filas de promo (mata los mutantes "sin chunk" y "smallint", cada uno leído).
- [x] Medir `POST /ventas` con 99.999 unidades y 2x1, y `/calcular` 10⁴/10⁵/10⁶ después del
      arreglo. Avisar a la Sesión de esfuerzo máximo si la venta pasa de ~1 s.
- [x] B2: medir el loop por unidad de los combos de ítems y decidir. Medido: 10⁵ unidades del
      componente en 13–115 ms. No entra: lo maneja la configuración del combo, no la venta.
      Queda en su entrada de pendientes.

## Verification

Gate completo de CLAUDE.md, `test:e2e` entero con base nueva y con turno de la orquestadora,
`verify-feature` con su recibo.

## Decisions / Open questions

Todas en la spec, con su procedencia.
