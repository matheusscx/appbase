## Lente: Devoluciones, anulaciones y reposición de stock
## Veredicto: 3 hallazgos

### Qué revisé para poder afirmarlo

- `ventas.service.ts`: `cancelar` (anulación, líneas 799-895), `crearNotaCredito` (904-1100),
  `crearNotaCreditoDesdeVenta` (1108-1125), `registrarDevolucionesPorReembolso` (1132-1165) y
  `validarDevolucionesReembolso` (1244-1340) completas — es todo el camino inverso de la venta
  que toca stock/costo en este archivo.
- `inventario.service.ts`: `registrarMovimiento` completo (71-248), `calcularCostoPromedio`
  (336-352) y `moverCantidad` (358-379) — cómo se congela/recalcula costo en cada movimiento.
- `mermas.service.ts` y `mermas.controller.ts` completos, más `inventario.controller.ts`
  completo — busqué explícitamente un endpoint de reversión de merma o de movimiento manual
  y no existe ninguno (solo `GET /mermas`, `POST /mermas`, `GET /inventario/movimientos`,
  `POST /inventario/ajustes-costo`).
- `items.service.ts`: `venderIngredientesReceta` (2601-2762) y su vecino
  `venderComponentesCombo`, solo para contrastar qué le hace la VENTA al stock de un ítem
  compuesto y verificar que la devolución no lo deshace.
- Frontend: `DevolucionInventarioLista.vue`, `useDevolucionInventario.ts` completo,
  `AnularVentaModal.vue`, `NotaCreditoModal.vue`.
- Tests: grep dirigido de `receta`/`combo` y de `devolucion`/`anulacion` en
  `ventas.service.spec.ts`, `inventario.service.spec.ts` y en los `*.e2e-spec.ts` del alcance,
  para confirmar qué escenarios están cubiertos y cuáles no.
- Devolución parcial y doble devolución sobre la misma venta: revisé `devueltoPorItem` en
  `validarDevolucionesReembolso` — suma correctamente lo ya devuelto (por la venta original o
  sus NC hijas) antes de aceptar una nueva devolución; no encontré forma de sobre-devolver.

### H1. Anular o dar NC a una venta con receta/combo nunca repone los ingredientes consumidos — y la anulación lo reporta como éxito

- **Severidad:** alta
- **Ubicación:**
  - `backend/src/modules/ventas/ventas.service.ts:846-849` (anulación, `cancelar`)
  - `backend/src/modules/ventas/ventas.service.ts:855-872` (loop de reposición)
  - `backend/src/modules/ventas/ventas.service.ts:1279-1283` y `1312-1315` (NC,
    `validarDevolucionesReembolso`)
  - `backend/src/modules/items/items.service.ts:2702-2734` (`venderIngredientesReceta`, lo
    que la venta SÍ le hizo al stock)
  - `frontend/app/composables/useDevolucionInventario.ts:82`
  - `frontend/app/components/ventas/AnularVentaModal.vue:39-44`
  (abrí los cuatro archivos backend y los dos frontend)
- **Qué está mal:** un ítem `receta` o `combo` no tiene fila en `item_producto` — el stock que
  se movió al vender es el de sus INGREDIENTES (`venderIngredientesReceta`/
  `venderComponentesCombo`, vía `items.service.ts`), nunca el del ítem compuesto. Pero:
  - `cancelar` arma su lista de líneas a reponer con `JOIN item_producto ip ON ip.item_id =
    d.item_id` (INNER). Una línea de receta/combo simplemente **no aparece** en `detalles`:
    no se lanza excepción, no se repone nada de esa línea, y el método sigue de largo.
  - `validarDevolucionesReembolso` (usado por NC y por `registrarDevolucionesPorReembolso`)
    usa LEFT JOIN, así que la línea sí aparece pero con `modo_inventario = null` — el mismo
    valor que tiene un ítem `servicio` — y cae en `if (detalle.modo_inventario === null) throw
    ... "no maneja stock (servicio): no admite devolución a inventario"`. El mensaje es
    literalmente falso para una receta/combo (si tiene stock: el de sus ingredientes) y en la
    práctica bloquea cualquier intento de devolverlo.
  - No hay NINGÚN camino en la app — ni anulación, ni NC, ni un endpoint de movimiento manual
    (`inventario.controller.ts` solo expone `GET movimientos` y `POST ajustes-costo`, ningún
    POST de entrada manual) — para reponer el ingrediente consumido por una receta/combo.
- **Escenario:** Hamburguesa (`receta`) cuya receta consume 150 g de carne molida
  (`item_producto`, stock=1000 g). Se vende 1 unidad → `venderIngredientesReceta` descuenta
  150 g (stock carne = 850 g). El garzón se equivoca de mesa y anula la venta pendiente sin
  pagos (`POST /ventas/:id/anular`, `reponerStock: true`). El backend responde
  `{ estado: 'cancelada', stockRepuesto: true }`; el frontend muestra el toast verde **"Venta
  anulada y stock repuesto"**. El stock real de carne molida sigue en 850 g: se perdieron 150 g
  de inventario para siempre, y el sistema lo confirma como si se hubiera arreglado. Con NC en
  vez de anulación, el operador ni siquiera puede intentarlo: si agrega la Hamburguesa a
  `devoluciones`, la API responde 400 "no maneja stock (servicio)".
- **Por qué ningún test lo caza:** `ventas.service.spec.ts` mockea `manager.query` devolviendo
  arrays armados a mano (`detallesStock`, `detallesRows`) — nunca ejercita el SQL real, así que
  la diferencia INNER vs LEFT JOIN nunca se pone a prueba. Ninguno de los dos `describe`
  (`cancelar()`, `crearNotaCredito()`) incluye una línea con `tipo: 'receta'` o `'combo'`, pese
  a que el `describe('crear() — recetas')` del mismo archivo sí las cubre para la venta. Los
  e2e (`ventas.e2e-spec.ts`, `caja.e2e-spec.ts`) tampoco: `ventas.e2e-spec.ts` no tiene ningún
  test de `notas-credito`, y su único bloque de `anular` no usa ítems de receta/combo.
- **Confianza:** alta — verificado leyendo el SQL exacto (INNER vs LEFT JOIN) y el mensaje de
  error, y confirmando contra `venderIngredientesReceta` que la venta sí mueve stock de
  ingredientes. Lo que faltaría para subirla más: correr el e2e con este escenario exacto.

### H2. La reposición congela el costo VIGENTE al momento de reingresar, no el costo al que salió — infla o desinfla el valor de inventario si el CPP se movió entre medio

- **Severidad:** alta
- **Ubicación:**
  - `backend/src/modules/inventario/inventario.service.ts:152-173` (congelado del costo del
    movimiento + condición para recalcular el promedio)
  - `backend/src/modules/inventario/inventario.service.ts:234-239` (el único `UPDATE
    item_producto SET costo_actual`, condicionado a `costoActualNuevo != null`)
  - `backend/src/modules/ventas/ventas.service.ts:861-871` (anulación, sin `costoUnitario`)
  - `backend/src/modules/ventas/ventas.service.ts:1006-1015` (NC, sin `costoUnitario`)
  - `backend/src/modules/ventas/ventas.service.ts:1152-1162`
    (`registrarDevolucionesPorReembolso`, sin `costoUnitario`)
- **Qué está mal:** ninguno de los tres call-sites que reponen stock por anulación/devolución
  pasa `costoUnitario`. En `registrarMovimiento`, eso hace que `costoUnitarioCongelado =
  costoActualPrevio` (línea 172-173) — el promedio ponderado **vigente en este instante**, no
  el que tenía el ítem cuando salió por la venta original — y como `costoActualNuevo` solo se
  calcula cuando `motivo === 'compra'` o es `ajuste_costo` (líneas 156-169), el `UPDATE
  item_producto SET costo_actual` (234-239) nunca corre para una entrada `anulacion`/
  `devolucion`. Efecto neto: el stock sube pero `costo_actual` queda igual → el valor total de
  inventario (`stock × costo_actual`) sube exactamente `cantidad × costo_actual_VIGENTE`,
  como si la mercadería devuelta se hubiera comprado hoy al precio de hoy, no al costo real
  que tenía cuando salió.
- **Escenario:** Item con stock=9 y `costo_actual=1000` (tras una venta de 1 unidad sobre un
  lote comprado a 1000). Llega una compra de 10 unidades a 1400: `calcularCostoPromedio` deja
  `costo_actual = (9×1000 + 10×1400) / 19 = 1210.5263`, stock=19. Se anula la venta original
  (`reponerStock: true`) → `registrarMovimiento` entrada `motivo:'anulacion'`, cantidad=1, sin
  `costoUnitario` → congela `costo_unitario` del kardex en 1210.5263 (el vigente ahora, NO los
  1000 a los que realmente salió) y stock pasa a 20; `costo_actual` no se toca, sigue en
  1210.5263. Valor de inventario tras la anulación: 20 × 1210.5263 = 24.210,53. El valor
  correcto, si se recalculara el promedio incorporando el reingreso al costo real de salida
  (1000), sería (19×1210.5263 + 1×1000)/20 = 24.000,00 exacto. La anulación creó 210,53 de
  inventario de la nada, sin que entrara compra ni plata.
- **Por qué ningún test lo caza:** `inventario.service.spec.ts` no tiene ningún test con
  `motivo: 'devolucion'` ni `'anulacion'` (grep vacío) — el freeze-sin-recálculo del promedio
  para estos dos motivos está completamente sin ejercitar en ese archivo. En
  `ventas.service.spec.ts`, los tests de `cancelar()`/`crearNotaCredito()` solo verifican
  `expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(expect.objectContaining
  ({ tipo: 'entrada', motivo: 'anulacion', cantidad }))` — nunca afirman la AUSENCIA de
  `costoUnitario` ni encadenan con el efecto real sobre `costo_actual`, porque
  `inventarioService` está mockeado ahí. Ningún e2e arma la secuencia venta→compra que mueve
  el CPP→anulación/NC para comparar el valor de inventario antes/después.
- **Confianza:** alta — la lectura del código es directa (dos condicionales explícitas que
  excluyen `'anulacion'`/`'devolucion'` del recálculo). Esto es una variante distinta del
  punto #1 de "YA CONOCIDO" (que es sobre el REDONDEO `HALF_UP` del promedio ponderado): acá
  el problema no es cómo se redondea el promedio, es que el promedio directamente **no se
  recalcula** en la reposición, dejando la valorización de lo que vuelve atada al costo actual
  en vez de al costo de salida.

### H3. No existe forma de anular/revertir una merma — ni endpoint, ni movimiento inverso, ni vínculo de auditoría

- **Severidad:** media
- **Ubicación:**
  - `backend/src/modules/mermas/mermas.controller.ts:1-41` (todo el archivo: solo `GET
    /mermas` y `POST /mermas`)
  - `backend/src/modules/inventario/inventario.controller.ts:1-45` (todo el archivo: solo
    `GET movimientos` y `POST ajustes-costo` — ningún POST de movimiento manual de cantidad)
  - `frontend/app/pages/mermas.vue` (sin botón de anular/eliminar; solo alta y ajuste de costo
    de referencia sin costo actual)
- **Qué está mal:** una merma registrada por error (causa equivocada, cantidad mal tipeada,
  producto equivocado) no tiene camino de reversión en ningún nivel: no hay `DELETE`/`anular`
  en el controller, no hay botón en la pantalla, y no hay un endpoint de "entrada manual" en
  `inventario` al que un operador pudiera recurrir para compensarla a mano ligada a esa merma.
  El único camino genérico que SÍ existe es un recuento de inventario (`recuentos/`), pero ese
  módulo corrige contra el stock CONTADO físicamente y con una causa de diferencia propia —
  no referencia la merma que se quiere corregir, no valida que el delta coincida con lo que la
  merma sacó, y dos operadores que revisen el kardex más tarde no pueden inferir de ahí que un
  movimiento `recuento` reversa un `merma` anterior.
- **Escenario:** un garzón registra una merma de 5 kg de un producto por "vencimiento" cuando
  en realidad eran 0,5 kg (typo). El kardex queda con una salida de 5 kg atada a esa causa,
  permanente. La única forma de arreglarlo es un recuento de inventario que, al contar el
  stock físico real, genera una entrada `motivo: 'recuento'` con una causa de diferencia
  distinta ("ajuste de stock" o similar) — el rastro de que esa entrada compensa el error de
  la merma original se pierde: quien lea el kardex ve una salida de 5 kg por vencimiento y,
  aparte y sin relación visible, una entrada por recuento.
- **Por qué ningún test lo caza:** no hay ningún test (unit ni e2e) que intente anular o
  revertir una merma, porque la funcionalidad no existe — no hay nada que un test pudiera
  ejercitar. `mermas.service.spec.ts` solo cubre `registrar()` y `findAll()`.
- **Confianza:** media — confirmé que el endpoint/UI no existen y que el recuento es el único
  camino genérico de corrección, pero no encontré una decisión de negocio documentada
  (`docs/features/mermas-valorizadas.md` no menciona reversión) que indique si esto es una
  omisión o una decisión implícita de "usar recuento para todo". Si el owner considera el
  recuento una solución aceptada, esto baja a hallazgo cosmético (falta de vínculo de
  auditoría) en vez de una feature faltante.
