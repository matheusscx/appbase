# Spec: la orden pagada sin venta avisa, y la venta online no lleva vuelto

**Date**: 2026-10-10 · Entrada: [`pendientes.md`](../../agent/pendientes.md) § 3, "La tienda calcula el
total dos veces…", opciones **D** y **E** (owner, 2026-10-09). La **A** queda afuera: es frente fiscal.

## Problema

Cuando el callback de la tienda no puede crear la venta, la orden queda `pagada` sin `venta_id`. El
comprador recibe `estado=pagada` y lee "Tu compra fue registrada correctamente". El motivo queda
solo en un `logger.error`, y el admin no se entera. Aparte, si el precio baja entre el pago y el
retorno y la tarjeta tiene `permite_vuelto`, la venta se crea con un vuelto sobre la tarjeta que
nadie devuelve.

## Diseño

### E — pago online exacto

En `VentasService.crearEnTransaccion`, al lado del chequeo actual del pago completo: si
`canal === 'online'`, lo pagado tiene que **ser igual** al `totalFinal`.

- Si es de menos, el mensaje sigue igual (*"Las ventas online requieren el pago completo"*).
- Si es de más, el mensaje nuevo es *"Las ventas online no admiten vuelto: lo pagado supera el
  total"*.

`PagosService` no se toca: con pago == total no hay excedente, así que el reparto de vuelto no
corre. Esto vale para los dos llamadores del canal: el callback de la tienda y el alta de
suscripción. El alta paga el `totalFinal` de un cálculo hecho en la misma request, así que el
chequeo no cambia nada en su camino normal.

### D — el motivo queda en la orden

- **Columna nueva** `pasarela_ordenes.motivo_sin_venta TEXT NULL`, en la entity con tipo explícito
  y en `startup-pos.sql`. La escribe **solo** `CallbackDispatcherService.dispatchInterno`, cuando
  el handler lanza. La orden sigue `pagada`: no hay estado nuevo de orden. Así verificar,
  reembolsar y la expiración no cambian.
- **El texto es legible y sale del error de dominio.**
  - Si el error es una `HttpException`, se usa el mensaje de su respuesta. Son los 400 que ya ve
    cualquier usuario de la API.
  - Cualquier otro error (`QueryFailedError`, un `TypeError`) deja un texto genérico: *"Error
    interno al registrar la venta; el detalle quedó en el log del servidor"*. Nada de stack ni de
    SQL.
  - El `logger.error` con el detalle completo se queda como está.
- **"Pagada sin venta"** = `estado = 'pagada' AND motivo_sin_venta IS NOT NULL`. Un reembolso
  total pasa la orden a `reembolsada`, y con eso sale sola del conteo.

### D — lo que ve el comprador

- `PagosRedirectService.urlRetornoApp` arma, para esa orden, `estado=pagada_sin_venta` sobre la URL
  de éxito. Es la misma página de retorno.
- `GET /online/orden/:id` devuelve `estado: 'pagada_sin_venta'` y **no** expone el motivo.
- `retorno.vue` suma una vista `sin_venta`: ícono de advertencia y *"Recibimos tu pago pero no
  pudimos registrar la compra; el local se comunicará contigo."* Vacía el carrito igual que el
  éxito, porque el cargo existe y dejarlo lleno invita a pagar dos veces.

### D — el aviso al admin (orquestadora, 2026-10-10: opción 1, patrón bandeja + Inicio)

- `GET /pasarela/admin/ordenes` (`Pasarelas:Leer`, el guard real) suma:
  - el filtro `sinVenta=true`;
  - `motivoSinVenta` en cada fila.
- `GET /pasarela/admin/ordenes/:id` (vista admin) suma `motivoSinVenta`. La API de llave externa
  no lo expone: es un contrato y el campo no entra de arrastre.
- `/ordenes` hace tres cosas:
  - pinta "Pagada sin venta" en warning;
  - suma esa opción al filtro de estado, que manda `sinVenta=true`;
  - lee `?sinVenta=true` de la URL.
- El drawer muestra el motivo en un `UAlert` warning, con la acción: reembolsar desde ahí o
  registrar la venta a mano.
- **Tarjeta de Inicio "Pagos sin venta"** en la zona "Ahora". Lee
  `GET /pasarela/admin/ordenes?sinVenta=true&pageSize=1` y usa `meta.total`, así que no hace falta
  endpoint nuevo y el guard es el mismo. Se monta con `esAdmin || can('Pasarelas','Leer')`. Con
  403 se oculta, igual que las otras tarjetas.
- En el seed ningún rol que no sea admin tiene `Pasarelas:Leer`. El e2e arma un rol propio con
  solo ese permiso.

## Casos del e2e (`tienda-dos-ahoras.e2e-spec.ts`, invertido en el mismo commit)

- **Control:** sin cambios. Queda `conciliada`, con `estado=pagada` y sin motivo.
- **Los 5 casos sin venta** ahora afirman lo siguiente:
  - redirect `estado=pagada_sin_venta`;
  - `GET /online/orden` da `{estado:'pagada_sin_venta', ventaId:null}`, sin motivo;
  - el motivo en la orden coincide con el mensaje de dominio;
  - la orden aparece en el listado `sinVenta=true` del admin;
  - verificar sigue dando 400.
- **Precio que baja con `permite_vuelto`:** pasa a cargo sin venta, con el motivo "no admiten
  vuelto".
- **Rol no admin:** un rol con solo `Pasarelas:Leer` lee el conteo y el motivo. Uno con solo
  `Pasarelas:Crear` recibe 403.

## Fuera de alcance

- La A ("vale lo que pagó").
- El mail al admin: va junto con la pregunta abierta de los descuadres.
- Reembolso automático y reintento de la venta.
- Si una tarjeta debería poder tener `permite_vuelto`.
- Las apps externas (callback HTTP).
