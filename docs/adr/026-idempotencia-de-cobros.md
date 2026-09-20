# ADR-026: Idempotencia de cobros — una clave por intento, reclamada dentro de la transacción del cobro

**Status**: Accepted

**Date**: 2026-09-19

## Context

El cajero cobra $12.000 con tarjeta, aprieta *Confirmar* y se corta internet. La pantalla dice
"no se pudo registrar", pero la venta **sí entró**. Hasta este ADR, volver a confirmar creaba
**una segunda venta completa**: doble descuento de stock y doble cobro, con la caja esperando
$24.000 donde entraron $12.000. Deshabilitar el botón evita el doble clic, no el reintento
después de un timeout, y el `FOR UPDATE` de inventario evita el stock negativo, no la venta
duplicada. Pasaba igual con el abono a una venta fiada. El cobro de una mesa no duplicaba
—la cuenta cerrada rechaza el segundo cierre—, pero el garzón leía *"La cuenta no está
abierta"* sobre una mesa que sí se cobró, y la boleta no salía nunca.

La forma estaba decidida desde el 2026-07-27: el cliente genera una `Idempotency-Key` **por
intento de cobro**, una tabla guarda clave → respuesta, y el reintento reproduce la respuesta
original. ⛔ Deduplicar por hash del carrito quedó descartado: dos clientes que compran lo
mismo con segundos de diferencia son el caso de todos los días en un minimarket.

## Decision

**Tres endpoints exigen la cabecera `Idempotency-Key` (UUID)**: `POST /ventas`,
`POST /cuentas/:id/cerrar` y `POST /pagos` (el abono). Sin ella, o con un valor que no es UUID,
responden **400**. Es obligatoria y no opcional porque el backend no puede depender de que cada
pantalla se acuerde de mandarla. La validación la hace el parámetro `@ClaveIdempotencia()`, que
corre después de los guards: sin permiso sigue saliendo 401/403.

**`IdempotenciaService.ejecutar(solicitud, operar, ventaIdDe)`** corre la operación una sola
vez por `(tenant, usuario, clave)`:

1. **Lo primero** que hace la transacción es reclamar la clave en `solicitudes_idempotentes`
   (`INSERT … ON CONFLICT DO NOTHING`, índice único parcial con `eliminado_el IS NULL`).
2. Si inserta, corre la operación y guarda la respuesta —`instanceToPlain`, lo mismo que
   serializa el interceptor global— **en la misma transacción**.
3. Si no inserta, la clave ya existe y está commiteada. Con la **misma huella** reproduce la
   respuesta guardada más `repetida: true`. Con **otra huella**, responde 422 con el `ventaId`.

`db.transaccion` reusa la transacción activa (ADR-020), así que `ejecutar` puede envolver la
transacción de la operación o sumarse a ella, y en los dos casos es atómico con el cobro.

La **huella** es un SHA-256 de un JSON canónico (claves ordenadas a toda profundidad, arrays en
su orden) de la operación más lo que el request pidió. Cada llamador arma ese objeto a mano: el
cierre de mesa lista sus campos uno por uno y **deja afuera el PIN del garzón**, porque el hash
de un PIN de pocos dígitos se revierte por fuerza bruta.

**Frontend**: `useIntentoCobro()` guarda la clave en memoria por ámbito (`pos`, `tienda`,
`cuenta:<id>`, `abono:<ventaId>`), a nivel de módulo, y por lo tanto por pestaña. La clave nace
con el primer *Confirmar* y se mantiene ante cualquier error y ante cualquier edición del
carrito o de los pagos. Muere con el éxito (también por reproducción), con el carrito vacío o
con el aviso de "otros datos".

## Decisiones del owner (2026-09-19)

| Escena | Qué pasa |
|---|---|
| El reintento llega **igual** | Se ve el éxito, la boleta se imprime (la primera respuesta se perdió) y un aviso dice *"Este cobro ya había entrado, no se registró dos veces"*: el cajero sabe que no tiene que volver a pasar la tarjeta por el posnet |
| El reintento llega con **otros datos** (cambió tarjeta por efectivo) | Se frena con *"Este cobro ya se había registrado con otros datos"* y *Ver venta*. Nunca se crea una segunda venta |
| Después de ese aviso, el cajero vuelve a confirmar | Es una **venta nueva**: el aviso cierra el intento. El cajero ya vio la venta anterior, así que confirmar de nuevo —cobrar en efectivo, o después de anular la primera— es una decisión consciente, sin rearmar el carrito |
| ¿Hasta cuándo se recuerda? | Mientras siga ese carrito: hasta el éxito o el vaciado. **No vence por tiempo**: con un vencimiento, el POS que quedó abierto de un día para otro vuelve a cobrar dos veces |
| Mesa de salón y abono | Entran. La nota de crédito tiene el mismo hueco, pero es fiscal y va en su propio frente (`agent/pendientes.md` § 6) |

## Alternatives Considered

- **Columna `clave` en `ventas` y `pagos`.** No sirve para el abono, que crea N pagos, ni para
  el cierre de mesa, que devuelve otra forma. Además obligaba a reconstruir la respuesta en vez
  de reproducirla.
- **Interceptor global con su propia transacción** (el patrón de las pasarelas de pago). No es
  atómico con la venta: exige un estado "en proceso" y un 409 para el duplicado concurrente, y
  si el proceso se cae entre los dos commits deja una clave sin respuesta.
- **Cabecera opcional.** Una pantalla nueva que se olvide de mandarla quedaría desprotegida sin
  que nada lo avise.

## Consequences

- **Un rechazo no deja rastro.** El rollback (sin stock, sin caja, deadlock) se lleva el
  reclamo, así que el cajero corrige el carrito y reintenta con la misma clave. El loop de
  `40P01` de `VentasService.crear` vuelve a reclamar en cada intento.
- **El duplicado concurrente espera, no se duplica.** El segundo `INSERT` se bloquea en el
  índice único hasta el commit del primero. Se apoya en `READ COMMITTED`: el `SELECT` posterior
  tiene que ver la fila recién commiteada. Lo verifica el e2e (`SHOW transaction_isolation`).
- **El reclamo va antes de cualquier `FOR UPDATE` y de cualquier chequeo de estado.** Es lo que
  convierte *"La cuenta no está abierta"* en una reproducción. Cuenta también como estado el
  **turno abierto del garzón**: si marcó salida entre el cierre que entró y el reintento, el
  reintento reproduce igual, porque el turno es una condición para escribir y reproducir no
  escribe nada (lo levantó la revisión independiente). La **credencial** del garzón, en
  cambio, se valida **antes** del reclamo: un reintento vuelve a pedir el PIN.
- **La clave es por usuario.** Una clave que otro usuario ya usó se procesa como nueva: una
  boleta reproducida trae pagos, vuelto y cajero, el mismo dato que protege el alcance por caja.
- **Reproducir devuelve lo que se contestó entonces, no el estado de hoy.** Una venta anulada
  después se sigue reproduciendo como pagada, porque ese es el cobro por el que pregunta el
  reintento.
- **La tabla no se purga.** Crece una fila por cobro, al ritmo de `ventas` (invariante 3 y
  decisión del owner).
- **Costos asumidos:** vaciar el carrito después de un corte empieza un intento nuevo; la clave
  vive en la memoria de la pestaña, así que recargar la pierde (en el POS se pierde también el
  carrito; en el salón la cuenta ya cerrada rebota como antes; en el abono, un segundo abono
  sale si a la venta le queda saldo); y dos pestañas del mismo POS tienen claves distintas.
- **Webpay no pasa por acá.** `OnlineCallbackHandler` llama a `VentasService.crear` sin HTTP y
  sin clave: ya es idempotente por orden (ADR-009).
- **El primer deploy tiene una ventana.** Backend y frontend son servicios separados en
  Railway: entre los dos deploys —o con una pestaña abierta de antes— el bundle viejo manda el
  cobro sin la cabecera y recibe 400. Se resuelve desplegando los dos juntos y recargando las
  pantallas abiertas; queda anotado como paso operativo en `agent/pendientes.md` § 1.
