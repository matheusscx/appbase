# Una boleta de más de 135 UF lleva el nombre y el RUT de quien paga

**Fecha:** 2026-10-04 · **Tipo:** spec de diseño · **Fiscal: frente propio** (`CLAUDE.md`, ADR-010)
**Frente:** *"Una venta de más de 135 UF a quien no es contribuyente de IVA exige boleta con la
identidad de quien paga, y el voucher no alcanza"* (`pendientes.md` § 6).
**Decisiones:** las siete de esa entrada, con quién y cómo se decidió cada una.

---

## 1. El problema

La Res. Ex. SII 44/2025 (art. 92 ter del Código Tributario, Ley 21.713) obliga, desde el
1-sep-2025, a que una venta a quien no es contribuyente de IVA por más de 135 UF —pagada con
cualquier medio— vaya con boleta electrónica que registre nombres y apellidos, RUT y forma de
pago de quien paga. El umbral se fija en pesos cada año con la UF al 31 de diciembre anterior.

Medido con un e2e (2026-10-04, Paris, $6.000.000): hoy pasan con 201 una boleta pagada con la
máquina sin cliente (queda solo el voucher), una en efectivo sin cliente, una con nombre y sin
RUT y una pendiente sin cliente. Lo que no se captura al vender no se recupera (ADR-010).

## 2. Reglas

1. **Umbral por país y año.** Tabla global `umbral_identidad_pagador` (`pais_id`, `anio`,
   `monto numeric(18,2)` en moneda oficial, `fuente`), sembrada por el sistema. Ningún endpoint
   la escribe. Rige la fila del año de la venta en la zona horaria de la provincia del tenant
   (criterio de `diaNegocioTenant`, sin hora de corte: es año calendario); si no hay, la del
   último año anterior (*"se mantendrá este monto"*). Un país sin filas no tiene la regla.
   Sembrado Chile: 2025 = $5.186.253,15 (resolutivo 3°) y 2026 = 135 × $39.727,96 (UF al
   31-12-2025, tabla UF 2025 del SII) = $5.363.274,60.
2. **Cuándo aplica.** El tipo resuelto de la venta es la boleta y `total_final > umbral`, estricto,
   con Decimal. `total_final` ya está en moneda oficial y no incluye propina ni vuelto. Es la
   operación entera: dos pagos que solo sumados pasan el umbral la disparan; la venta pendiente
   también. La Factura no la necesita: lleva receptor completo y el 92 ter la acepta.
3. **Qué exige.** Un `customer` con nombre y RUT, sin blancos; el RUT pasa por la validación que
   ya existe (DV módulo 11, normalizado). Sin eso, 400 que nombra el umbral en pesos y lo que
   falta. No exige giro, dirección ni comuna. La forma de pago ya queda en `pagos`.
4. **Dónde.** En `crearEnTransaccion`, después de calcular el total y antes de escribir nada:
   cubre POS, cierre de salones, la demo de la tienda (que crea la venta por `POST /ventas`) y es
   la última barrera de online y suscripción.
5. **Online y suscripción: antes del cobro.** Los dos cobran antes de crear la venta, así que un
   400 en `crearEnTransaccion` dejaría plata cobrada sin venta. `OnlineService.pagar` (las dos
   ramas) y `SuscripcionesService` (antes de `cobrosService.cobrar`) rechazan con 400 una compra
   sobre el umbral: la tienda no pide RUT (pantalla nueva: entrada aparte en pendientes). Así el
   callback de Webpay solo ve compras bajo el umbral; la barrera solo podría rechazar ahí si el
   umbral **baja** entre el chequeo y el callback (cambio de año con una fila nueva menor, y la UF
   casi nunca baja), y entonces cae en "orden pagada sin venta", que es reconciliable.
6. **El voucher se registra igual.** `documentarVenta` no cambia: el documento `maquina` queda
   como siempre y la identidad queda en `venta_customer`. La pantalla de cobro avisa, cuando la
   venta pasa el umbral y algún pago es de la máquina, que el comercio debe emitir la boleta
   electrónica con esos datos.
7. **La pantalla no conoce el umbral por sí sola.** `GET /tipos-documento` suma
   `umbralIdentidad` (string o `null`) a la boleta; los demás tipos llevan `null`.
   - **POS:** sobre el umbral el cliente pasa a requerido (como la Factura): el panel abre el
     formulario, nombre y RUT son obligatorios y "Cobrar" no se habilita sin ellos.
   - **Salones:** el modal de cobro pide nombre y RUT solo cuando el total de la cuenta pasa el
     umbral, y el cierre los manda como `customer`.
8. **Registro interno (Anexo I): diferido.** Los datos quedan congelados (`venta_customer`,
   `venta_detalles`, `venta_documentos`); el export es formato (ADR-010). Entrada en pendientes.

## 3. Qué cambia

- **BD:** tabla `umbral_identidad_pagador` con índice único `(pais_id, anio)` vigente. Registrada
  en `app.module.ts` (array `entities`) y en el seeder. IDs del seed 456–457.
- **Backend:** `resolverTipoDocumento` trae el umbral en la misma consulta (sin lectura nueva);
  `crearEnTransaccion` exige la identidad con el total ya calculado; `findTiposDocumento` devuelve
  `umbralIdentidad`; `OnlineService.pagar` y `SuscripcionesService` chequean antes del cobro con un
  método público de `VentasService`.
- **Frontend:** `useReceptor.ts` gana la regla (`sobreUmbralIdentidad` e `identidadPagador`); POS
  (`CarritoPanel`, `pos.vue`) y salones (`index.vue`, `CobroModal`) la usan; `CobroModal` muestra
  el aviso del voucher.

## 4. Fuera de alcance

- Pedir RUT en la tienda online y en la suscripción (entrada en pendientes).
- El export del registro interno.
- Mapear la forma de pago al código `MedioPago` del SII (formato de emisión, ADR-010).
