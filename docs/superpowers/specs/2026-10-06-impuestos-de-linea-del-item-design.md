# Spec: los impuestos adicionales de una línea salen del ítem

**Date**: 2026-10-06 · **Owner**: Cesar Matheus · **Entrada**: `docs/agent/pendientes.md` § 3,
"Los impuestos adicionales de una línea salen del ítem: `impuestoIds` es un 400" (fiscal, sesión
propia: regla del 2026-08-23 y ADR-010).

## Problema

`resolverLinea` usaba `linea.impuestoIds ?? reglas.impuestosIds`: lo que mandaba el cliente
**reemplazaba** los impuestos adicionales (`tipo='otro'`) del ítem. El IVA no, desde ADR-018. Por
la API, un servicio de $1.000 con un impuesto adicional del 10% se cobraba $1.238 en vez de $1.342
con `impuestoIds: []`, y un id repetido cobraba el adicional una vez por repetición. Entraba por
`POST /ventas`, `/calculo-precios/calcular`, `/online/checkout` y `/online/pagar`.

En la tienda era peor: `prepararLineasCheckout` esparce `...linea` en el total que `/online/pagar`
autoriza contra la tarjeta, y el callback recalcula con los impuestos del ítem. Autorizar de menos
o de más terminaba en **un cargo en Webpay sin venta**.

## Decisión

**Owner, 2026-10-06** (pregunta aparte, con la escena del servicio de $1.000 cobrado $1.238 y un
impuesto en la boleta en vez de dos): *"Cerrarlo: salen del ítem"*. Los impuestos adicionales
salen siempre del ítem, como el IVA desde ADR-018. `impuestoIds` de las dos clases → 400.

## Consumidores (medido con grep antes de sacar nada)

- `backend/src`: `LineaVentaDto.impuestoIds`, `LineaDto.impuestoIds`, la rama de `resolverLinea`,
  el 400 *"El IVA no se asigna por ítem ni por línea"* de `calcular()` y el pasamanos de
  `ventas.service` al motor. Ningún flujo interno lo arma: ni `cerrarCuenta` del salón ni el
  callback online (su snapshot lleva solo `itemId`, `cantidad` y presentación). El seed no lo usa.
- `frontend/app`: solo el tipo `CalcularLineaInput` de `useCalculoPrecios.ts`; ninguna pantalla.
- Tests: dos unit del motor (`impuestoIds: []` sobre afecto, IVA explícito → 400) y tres filas de
  `topes-dto.e2e-spec.ts` (tope de 50 y lista suelta).
- **Nada diseñado depende de mandarlo.** La exención es `items.clasificacion_tributaria = 'exento'`
  (invariante 5), no una lista vacía por línea; no hay venta exenta ni impuesto por línea
  documentado en `PRODUCTO.md`, `features/` ni `desarrollo-nuevo.md`. No se escala.

## Diseño

1. **Borde.** Se borra `impuestoIds` de `LineaVentaDto` y de `LineaDto`. El pipe global da el 400
   *"lineas.N.property impuestoIds should not exist"*, en las cuatro puertas (la tienda usa
   `CheckoutOnlineDto`, que hereda `LineaDto`).
2. **Motor.** `resolverLinea` lee solo `reglas.impuestosIds` del ítem. El filtro de `tipo='iva'`
   se queda: es defensa contra `item_impuestos` viejo (ADR-018), no contra el request.
3. **El 400 del IVA explícito de `calcular()` se borra.** Ya no tiene camino: ningún request trae
   `impuestoIds`, y el tipo deja de declararlo. El contrato de ADR-018 por línea pasa a ser el 400
   del pipe para el campo entero, que es más fuerte. El de `POST`/`PATCH /items`
   (`validarImpuestos`) no cambia.
4. **`ventas.service`** deja de pasar el campo.
5. **Frontend.** `CalcularLineaInput` pierde `impuestoIds`.

Invariante 5: ninguna salida hace de "sin impuesto" un estado fiscal. Al revés: se cierra la única
puerta por la que una línea podía quedar sin el adicional que su ítem declara.

## Pruebas

- **e2e** (`calculo-precios.e2e-spec.ts`, describe nuevo, molde del de reglas de línea): las cuatro
  puertas × tres valores (`[]` saca el del ítem, un adicional ajeno, el del ítem repetido) → 400 con
  el mensaje del pipe, sin venta nueva ni orden de pasarela. Control sin el campo en `/ventas`,
  `/calcular` y `/online/checkout`: cobra el IVA más el adicional del ítem.
- **e2e del agravante** (spec nuevo con `ProviderFactory` falso, molde de
  `pasarela-reembolso.e2e-spec.ts`): `/online/pagar` con el campo → 400 y el proveedor nunca se
  llama; sin el campo, la orden se autoriza por X y la venta que crea `OnlineCallbackHandler` cierra
  por X con los dos impuestos.
- **Unit:** sale el test de `impuestoIds: []` y el del IVA explícito; entra uno que fija que una
  línea con `impuestoIds` llegado por un camino interno igual usa los del ítem.
- **Mutantes:** el campo devuelto a `LineaDto` y a `LineaVentaDto` (e2e rojo); la rama restaurada
  en `resolverLinea` (la mata el unit: por HTTP no se ve).
