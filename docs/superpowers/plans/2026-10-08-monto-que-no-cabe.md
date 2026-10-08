# Plan: un monto calculado que no cabe en `NUMERIC(18,4)` es 400, no 500

**Status**: Done · **Date**: 2026-10-08 · **Owner**: sesión del guard del motor,
lanzada por la orquestadora (dudas técnicas a ella; lo del owner, por ella)

## Context

Entrada de `docs/agent/pendientes.md` § 3 *"Un monto calculado que no cabe en
`NUMERIC(18,4)` da 500 al guardar…"*. Diseño y medición:
[`specs/2026-10-08-monto-que-no-cabe-design.md`](../specs/2026-10-08-monto-que-no-cabe-design.md).
Toca el motor y va solo (owner, 2026-10-08).

## Scope / Out of scope

- **Dentro:** el guard en `calcular`, el canal interno `precioUnitarioOrigenResuelto`, tests,
  docs.
- **Fuera:** caja, línea de cuenta, `pasarela_orden.monto` y el aviso de la preview en el
  frontend. Van a `pendientes.md` como entradas propias (decisión de la orquestadora).

## Backend

- [x] T1. `common/utils/monto-persistible.util.ts`: `PRECISION_PERSISTIDA = 18`,
  `ESCALA_PERSISTIDA = 4` (se muda de `calculo-precios.service.ts`), el techo derivado
  `10^(18−4)`, `cabeEnColumnaDePlata(monto)` y el formateo del monto para el mensaje. Spec del
  util: el borde exacto (`…,9999` pasa; `…,99995` y `10^14` no; `…,99994` pasa) y lo mismo en
  negativo.
- [x] T2. Test de esquema: cada columna de la tabla del spec es `(18, 4)` en la metadata de
  TypeORM. Si alguien la cambia, el techo deja de ser el de la columna y el test lo dice.
- [x] T3. El guard en `CalculoPreciosService.calcular`, después de `advertirItemsPausados` y
  antes del `return`. Revisa las líneas (origen y luego los montos y las trazas de la línea,
  nombrando el ítem) y después la venta (totales y trazas de venta). Unitarios en
  `calculo-precios.service.spec.ts`: rechaza cada familia; no-regresión (mismo resultado con
  el canal y sin él, y con valores normales).
- [x] T4. `LineaCalculo.precioUnitarioOrigenResuelto` (fuera de `LineaDto`), alimentado por
  `ventas.service`. La preview usa su origen ya armado.
- [x] T5. e2e `test/motor-monto-no-cabe.e2e-spec.ts`: una prueba por puerta que persiste
  (POS, venta online, cierre de cuenta, origen en USD a 0,5) → 400 con el mensaje, sin venta,
  detalle, movimiento de stock, pago ni movimiento de caja; preview → 400; los dos canales
  internos en el body → 400 por el pipe, con su control.
- [x] T6. Unitarios de suscripción y Webpay: si `calcular` rechaza, no hay cobro ni orden.
- [x] T7. Mutantes: (a) sacar la llamada al guard (los e2e vuelven a 500); (b) `lte` en vez
  de `lt` en el techo (muere el borde); (c) sin el redondeo previo (muere `…,99995`); (d)
  `ventas.service` sin pasar el origen (muere el e2e de USD).

## Frontend

Nada. El aviso de la preview va a pendientes § 1.

## Verification

Gate completo de `CLAUDE.md` con la base nueva: `lint:check`, `typecheck`, `npm test` y
`test:e2e` enteros en el backend; `build`, `npm test`, `typecheck:ratchet` y `design:check`
en el frontend. Playwright entero también (orquestadora): el frontend no cambia, pero el
contrato de `/calcular` sí (201 → 400 en el borde), y un cambio de contrato de la API lo pide. No-regresión del motor: los e2e existentes del motor en verde y
sin tocar ningún valor. `verify-feature` con su recibo.

## Decisions / Open questions

- (orquestadora, 2026-10-08) Caja: se anota, no se arregla acá. El origen va por canal
  interno (opción i). La preview da 400. El frontend no se toca.
