# La boleta sale de la venta, no del carrito vivo

**Fecha:** 2026-09-17
**Estado:** diseño, sin construir
**Entrada de backlog que cierra:** *"La venta que se cierra sin cálculo queda sin boleta"*
(`docs/agent/pendientes.md` § 2)

---

## 1. El problema, medido

Al cobrar una mesa, la boleta **no se arma con lo que el servidor cobró**: la pantalla la
rehace por su cuenta con el carrito que tiene en la mano.

- `cerrarCuentaConPin` (`frontend/app/pages/salones/index.vue:2690`) llama al cierre y
  **descarta lo que el cierre devuelve**; para imprimir recalcula con `asegurarVigente()` y
  cruza el resultado con `activeCuenta` (`:2738-2746`, `itemsParaTicket` en `:2392`).
- Ese recálculo va guardado por una comprobación de identidad, y con razón: si el garzón se
  movió de cuenta durante el `await`, `useResultadoCalculado`
  (`frontend/app/composables/useCalculoPrecios.ts:184-294`) devolvería los totales de **otra**
  cuenta y el papel mentiría.
- Cuando esa comprobación no pasa, el `else` (`index.vue:2833-2838`) avisa
  *"Venta generada, pero no se pudo generar la boleta"* y no hay segunda oportunidad: **ningún
  camino reimprime una venta pasada**, ni en salones ni en el POS
  (`frontend/app/pages/ventas/pos.vue:257`).

Mientras tanto el servidor **ya calculó la boleta entera**: `cerrarCuenta`
(`backend/src/modules/salones/salones.service.ts:1846-2007`) recibe de
`ventasService.crearEnTransaccion` la venta con sus detalles, impuestos, promociones y
totales, y devuelve solo `{ cuenta, ventaId }` (`:2006-2007`). El resto se tira.

**El costo en el local:** se cobraron $47.000, la venta quedó registrada, y el cliente se va
sin papel. No es un caso raro: basta con tocar otra mesa mientras el sistema guarda.

## 2. Lo que decidió el owner (2026-09-17)

1. **La boleta la manda el servidor ya hecha.** La pantalla imprime lo que se cobró, no una
   segunda cuenta hecha aparte.
2. **Se construye ahora el botón de reimprimir** una venta ya cobrada.
3. **Reimprimir pide el mismo permiso que anular una venta** (`Ventas:Anular`), el del
   encargado. No se inventa un permiso nuevo.
4. **La reimpresión sale marcada `COPIA`**, con la fecha y hora de la reimpresión. El original
   no lleva marca.

## 3. La forma: un solo armado, dos orígenes

Hoy el ticket se arma en la pantalla cruzando por índice el resultado del motor con las líneas
de la cuenta. Eso se termina para la boleta: **el ticket se arma desde la venta persistida**,
que es la única fuente que sabe lo que se cobró.

### 3.1 Un payload de boleta, en el backend

Un solo tipo, `BoletaVenta`, con todo lo que el papel necesita y nada más:

- cabecera: número y fecha de la venta, tenant, caja, garzón/vendedor, mesa y número de cuenta
  cuando la venta viene de salones;
- líneas: descripción congelada, cantidad y su presentación/unidad, precio unitario cobrado,
  total de línea y la personalización congelada;
- totales: neto, descuentos, recargos, impuestos y total final;
- impuestos y promociones, agrupados por línea;
- pagos con el **nombre** del método y el vuelto.

Todos los importes salen de `venta_detalles` y sus tablas hijas, ya convertidos a la moneda
oficial. **No se llama al motor de cálculo** (`backend/src/modules/calculo-precios/` no se
toca): la venta ya está cuantizada y persistida.

### 3.2 Dos caminos que devuelven ese mismo payload

- **Al cobrar:** `POST /api/cuentas/:id/cerrar` agrega `boleta` a su respuesta, junto a
  `cuenta` y `ventaId`. El objeto ya está calculado dentro de la transacción; hoy se tira. Sin
  viaje extra.
- **Al reimprimir:** `GET /api/ventas/:id/boleta`, con
  `@RequiresPermiso('Ventas', 'Anular')`.
  El permiso se enforcea en el backend, no en la pantalla (invariante 6): el botón escondido no
  es un control.

⚠️ `GET /api/ventas/:id` **no alcanza** para reimprimir: su `SELECT`
(`backend/src/modules/ventas/ventas.service.ts:2964-2979`) no trae `venta_detalles.personalizacion`,
así que un plato con ingredientes sacados o extras saldría distinto al original. El endpoint
nuevo la trae; el viejo no cambia.

### 3.3 La pantalla imprime, no calcula

- **Salones:** `cerrarCuentaConPin` imprime `boleta` de la respuesta del cierre. Desaparece la
  dependencia de `activeCuenta` y de `asegurarVigente()` para la boleta, y con ella el aviso
  *"no se pudo generar la boleta"*: el único aviso que queda es el de la impresora que no
  responde, que ya existe.
- **POS:** `pos.vue` hace lo mismo con la respuesta de `POST /api/ventas`.
- **Reimprimir:** botón en el detalle de la venta
  (`frontend/app/components/ventas/VentaDetalleDrawer.vue`), visible con `Ventas:Anular`, que
  pide `GET /api/ventas/:id/boleta` e imprime con la marca de copia.
- `buildBoletaTicket` recibe un parámetro nuevo `copia?: { impresaEl: string }`. Con él,
  imprime `COPIA` y la fecha/hora arriba; sin él, sale igual que hoy.

**Lo que NO cambia:** la precuenta y su `itemsParaTicket` siguen igual —la precuenta es del
carrito vivo por definición, todavía no hay venta—, `buildPrecuentaTicket` no se toca, y la
comanda tampoco.

### 3.4 Sin reintento automático

Si la impresora no responde, se avisa y el garzón reimprime desde el detalle de la venta. El
sistema no reintenta solo (preferencia del owner, ya registrada).

## 4. Riesgos y bordes

- **Venta sin caja o sin garzón** (venta online, venta del POS sin salón): el payload trae esos
  campos vacíos y el ticket omite esas líneas, como hoy.
- **Nota de crédito y venta anulada:** fuera de alcance. Reimprimir la boleta de una venta
  anulada sigue mostrando la venta tal como se cobró; lo que una anulación imprime es materia
  del frente fiscal.
- **Fiscal:** hoy la boleta es un ticket térmico, no un documento tributario. Cuando llegue la
  emisión electrónica (**ADR-010**), la reimpresión hay que revisarla —folio, leyenda de copia,
  quién puede emitirla—, y eso va en su propio frente, no acá.
- **Multi-moneda:** el payload viaja en la moneda oficial del tenant, que es la que ya tienen
  persistidos los totales de la venta.

## 5. Cómo se prueba

- **Backend:** e2e de `cerrar` que afirma que la respuesta trae la boleta con líneas, totales,
  impuestos, pagos y personalización; e2e del endpoint nuevo: 403 sin `Ventas:Anular`, 404 de
  otro tenant, 200 con el mismo contenido que el cierre devolvió para esa venta.
- **La prueba que importa:** cerrar y reimprimir tienen que dar **el mismo papel**, salvo la
  marca de copia. Se compara el payload de los dos caminos para la misma venta.
- **Frontend:** unit de que el ticket se arma desde la venta y no desde el carrito; unit de la
  marca `COPIA`; unit de que el botón no aparece sin el permiso.
- **Navegador (Playwright):** cobrar una mesa **habiendo navegado a otra cuenta** y verificar
  que la boleta igual se imprime — el caso que hoy se pierde.
