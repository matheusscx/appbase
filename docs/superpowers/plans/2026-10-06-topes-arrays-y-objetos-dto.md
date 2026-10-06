# Plan: topes en los arrays de los DTOs y `@IsObject()` en los objetos únicos

**Status**: Done · **Date**: 2026-10-06 · **Owner**: sesión "DTOs: tope a los arrays de ids y objetos que aceptan array"

## Context

Dos entradas de `docs/agent/pendientes.md` § 2, las dos de borde (DTO) y sobre los mismos archivos:
"los arrays de ids de los DTOs que no son de unidades no tienen `@ArrayMaxSize`" y "once campos de
objeto único con `@ValidateNested()` y sin `@IsObject()` aceptan un array".

Lo medido antes de escribir código (detalle en `resueltos.md` al cerrar):

- **El body ya tiene techo**: el backend no configura body parser, rige el default de Express
  (100 kB). Medido por HTTP: 2.400 UUIDs (93,7 kB) pasan, 2.700 (105 kB) dan 413. "Decenas de miles
  de ids" no entran; lo que pesa son los loops con una query por elemento, no los `= ANY`.
- **Los once objetos, por HTTP**: tres escriben mal un dato (`LiquidarDto.ajustes` confirma la
  liquidación sin el ajuste pedido; `LineaCompraDto.lote` guarda `[]` en el borrador y la confirmación
  da 500; `LineaVentaDto.personalizacion` descarta las omisiones y descuenta el ingrediente), uno es
  un 201 sin efecto (`PreviewLiquidacionDto.ajustes`) y el resto 500 con rollback.

## Scope / Out of scope

- Dentro: `@ArrayMaxSize` en todo campo array de entrada que no lo tenga, con el tope elegido por
  campo y el porqué escrito al lado; `@IsObject()` en los ocho objetos únicos fuera del motor.
- Dentro, por decisión de la Sesión de esfuerzo máximo (2026-10-06, técnica): los arrays que entran
  al motor (`lineas`, ids de reglas por línea y de venta, subárbol de `personalizacion-receta.dto.ts`),
  con cuatro condiciones: solo decoradores, tope por encima de lo legítimo y peor caso cronometrado,
  un e2e por DTO del motor (tope justo → mismo total; tope + 1 → 400).
- Dentro: `@IsArray()` en los cinco `*Ids` de `LineaVentaDto`/`CreateVentaDto` que no lo tenían (un
  string suelto daba 500); va junto al tope del mismo campo.
- Fuera, anotado en `pendientes.md`:
  - `@IsObject()` de las tres `personalizacion` (exclusión de la orquestadora), con su medición.
  - `CreateNotaCreditoDto.devoluciones` (regla fiscal de CLAUDE.md, owner 2026-08-23); sus gemelos
    de pasarela ya usan 200.
  - `impuestoIds` repetido (cobra dos veces el impuesto adicional: fiscal) y el reemplazo por línea
    de las reglas del ítem.
- Dentro, medido en el camino: un id de descuento o recargo repetido aplicaba la regla una vez por
  repetición (`POST /ventas` con [D,D] se guardaba con total 0). `@ArrayUnique()` en los 8 campos:
  la forma la decidió la Sesión de esfuerzo máximo, la entrada al frente la orquestadora.
- Fuera: lógica de services. Si un tope exige tocar uno, se avisa y se anota.

## Backend

- [x] Clasificación de los 95 campos array (cuadra con el total) en el reporte de cierre
- [x] e2e en rojo: `test/topes-dto.e2e-spec.ts`, una fila por decorador nuevo (tope + 1 → 400 que
      nombra el campo; tope justo → sin ese mensaje, con un campo no declarado para que el pedido
      muera en el pipe y no escriba nada); `@IsObject()` → 400 por campo
- [x] e2e de los DTOs del motor: `lineas` en el tope dan el mismo total que la suma por línea
- [x] Decoradores
- [x] Mutantes: sacar cada decorador nuevo pone rojo solo su fila
- [x] Peor caso cronometrado: `POST /ventas` y `/calcular` con `lineas` en el tope

## Verification

- [x] Gate completo de CLAUDE.md (backend y frontend, `test:e2e` entero con base nueva, por turno)
- [x] `verify-feature` con su recibo + `api-security-reviewer`
- [x] Entradas movidas a `resueltos.md`; criterio del tope en `patterns/backend.md` § 3

## Decisions / Open questions

- Tope por campo, no uno solo: el número sale de lo legítimo (catálogo del tenant, composición de la
  receta) y del costo por elemento en el service.
- Los arrays del motor entran (Sesión de esfuerzo máximo, 2026-10-06, técnica): un tope no cambia lo
  que cobra un pedido aceptado.
