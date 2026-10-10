# Medición: la tienda calcula el total dos veces, con dos "ahora"

Status: Done · Date: 2026-10-09 · Owner: frente lanzado por la orquestadora

## Qué se mide

La entrada de `docs/agent/pendientes.md` § 2 se leyó en el código y no se corrió.
`POST /online/pagar` calcula el total con `calcular()` y autoriza ese monto en
Webpay. El callback (`OnlineCallbackHandler`) crea la venta con
`VentasService.crear`, que vuelve a calcular desde el snapshot (solo ítem y
cantidad) con el catálogo y el reloj del momento del retorno. La pregunta es qué
queda cuando los dos cálculos no coinciden: venta, estado de la `pasarela_orden`,
cargo autorizado.

## Cómo

Un e2e de API sobre Paris (Webpay Plus activo en el seed) con `ProviderFactory`
sobrescrito, el mismo camino que `tienda-impuestos-del-item.e2e-spec.ts`:
`pagar` → `GET /pasarela/retorno/pago?token_ws=…` → callback en proceso. Entre
el pago y el retorno se cambia una cosa por caso:

1. **El reloj** (los dos "ahora" de verdad): promo de franja horaria sobre el
   ítem; `Date` falso adentro de la franja al pagar y afuera al volver. Lo mismo
   con un descuento cuya `fechaFin` es hoy, cruzando la medianoche. Solo se finge
   `Date` (`doNotFake` todo lo demás). Las horas son de hoy y pueden quedar lejos
   de la real: el token se saca con el reloj ya movido, y la orden expira por
   reloj de JS, no de Postgres.
2. **El precio del ítem**, hacia arriba (callback mayor → "pago completo") y hacia
   abajo (callback menor → "vuelto").
3. **La tasa del día** de USD, con un ítem en USD (se restaura al terminar: es del
   seed).

Por cada caso se afirma lo que hay hoy: orden `pagada` sin `venta_id`, ninguna
venta nueva, el redirect que ve el comprador, y que `POST
/pasarela/api/ordenes/:id/verificar` no la rescata. Además un control: sin cambio
entre pago y retorno, la orden queda `conciliada` con venta.

## Forma del test

La del repo para un bug conocido (`caja-testigo.e2e-spec.ts`,
`pagos-dia-local.e2e-spec.ts`): verde, fija la conducta actual y cita la entrada
de `pendientes.md` en el docblock, para que el arreglo lo dé vuelta a propósito.

## Fuera de alcance

No se toca el motor de cálculo, el flujo de pago ni nada fiscal. Las opciones de
arreglo van a la orquestadora; no se implementa ninguna.
