# Spec: las reglas de una línea salen del ítem

**Date**: 2026-10-06 · **Owner**: Cesar Matheus · **Entrada**: `docs/agent/pendientes.md` § 3,
"Los ids de reglas que manda el cliente salen del ítem: mandar otros es un 400" (parte de producto).

## Problema

`resolverLinea` usaba `linea.descuentoIds ?? reglas.descuentosIds` (y lo mismo con recargos): lo
que mandaba el cliente **reemplazaba** las reglas asociadas al ítem. Ninguna pantalla lo manda,
pero por la API se podía aplicar un descuento que el ítem no tiene (celular de $11.900 a $5.950)
o sacarle su recargo (servicio de $1.342 a $1.290). Llegaban por cuatro puertas: `POST /ventas`,
`/calculo-precios/calcular`, `/online/checkout` y `/online/pagar`.

## Decisiones

- **Owner, 2026-10-06:** *"Cerrarlo: salen del ítem"*. `descuentoIds` y `recargoIds` de
  `LineaVentaDto` y de `LineaDto` → 400 en las cuatro puertas, sin la rama del reemplazo.
- **Nivel venta, revisado por la Sesión de esfuerzo máximo (2026-10-06, con la medición de este
  frente):** `descuentosVentaIds`/`recargosVentaIds` **siguen** en `/ventas` y `/calcular`, porque
  son la única puerta de las reglas `nivel='venta'` (feature de catálogo diseñada que espera su
  pantalla). **Se cierran en `/online/checkout|pagar`**: el comprador no elige reglas, y el
  `...dto` de `prepararLineasCheckout` las metía en el total que se autoriza contra la tarjeta,
  mientras el callback crea la venta sin ellas.
- **`metodoPagoId` en la tienda** (Sesión de esfuerzo máximo, 2026-10-06; lo encontró la revisión
  de seguridad de este frente): mismo cierre y misma razón. Prende las reglas por método en el total
  autorizado, y el callback crea la venta sin él.
- **Fuera:** `impuestoIds` (fiscal, ADR-010, sesión propia). Queda como está.

## Diseño

1. **Borde.** Se borran los dos campos de `LineaVentaDto` y de `LineaDto`, con su `@ArrayUnique`.
   El pipe global (`whitelist` + `forbidNonWhitelisted`) da el 400 *"lineas.N.property X should not
   exist"*. No hace falta un validador que siempre rechace: el owner no pidió un mensaje que diga
   adónde ir (`patterns/backend.md` § 3).
2. **Tienda.** `CheckoutOnlineDto = OmitType(CalcularVentaDto, ['descuentosVentaIds',
   'recargosVentaIds', 'metodoPagoId'])` en el controller y el service de `online`. El 400 lo da el mismo pipe y el
   `...dto` ya no puede arrastrarlos.
3. **Motor.** `resolverLinea` lee solo `reglas.descuentosIds` / `reglas.recargosIds` (o las
   congeladas de `cerrarCuenta`). `ventas.service` deja de pasar los dos campos.
4. **`resolverReglas` de nivel línea** sigue validando el nivel de lo que viene del ítem: ahora es
   defensa contra una fila de `item_descuentos` con una regla de venta (carrera o camino nuevo que
   no pase por `validarReglas`), no contra el request. Se corrigen sus comentarios.
5. **Frontend.** `CalcularLineaInput` (`useCalculoPrecios.ts`) pierde los dos campos. Los de venta
   se quedan, porque `/calcular` los sigue aceptando.

## Pruebas

- **e2e** (`calculo-precios.e2e-spec.ts`, nuevo describe): por puerta y por campo, 400 con el
  mensaje del pipe; en `/ventas`, el 400 no crea venta; control positivo sin el campo donde la
  puerta no tiene efectos externos (`/calcular`, `/online/checkout`; `/online/pagar` abre orden en
  la pasarela). En las dos puertas online, `descuentosVentaIds`/`recargosVentaIds` → 400.
- Las reglas de venta en `/ventas` y `/calcular` las siguen probando los e2e existentes
  (`calculo-precios.e2e-spec.ts` "descuento de venta topeado…", `uso-reglas.e2e-spec.ts` "ancla
  positiva", `ventas.e2e-spec.ts` § IVA persistido con descuento de venta).
- Los e2e que usaban `descuentoIds`/`recargoIds` como atajo para aplicar una regla pasan a
  asociarla al ítem (`descuentosIds`/`recargosIds` de `POST /items`).
- **Unit:** `calculo-precios.service.spec.ts` pierde el test del reemplazo y gana uno que fija que
  una línea con ids sueltos (llegados por un camino interno) igual usa los del ítem.
- **Mutantes:** volver a declarar cada campo en su DTO; volver a usar `CalcularVentaDto` en la
  tienda; restaurar la rama `linea.descuentoIds ??` en `resolverLinea`.
