# Plan: Detalle real del pago Webpay (débito/crédito, cuotas, últimos 4) + response codes nivel 2

Status: Done
Date: 2026-07-10
Owner: Cesar Matheus

> Al ejecutar: copiar este plan a `docs/superpowers/plans/2026-07-10-webpay-detalle-pago.md`
> (convención del repo). Trabajar directo sobre `main`. Antes de codear, leer
> `docs/patterns/backend.md` y `docs/patterns/frontend.md`, e invocar los skills
> `nestjs-best-practices` (backend) y `nuxt-ui` (frontend). TDD: specs primero.

## Context

Toda venta online por Webpay Plus se registra hoy como **"Tarjeta de crédito"**, aunque el
usuario pague con RedCompra (débito). La causa: `OnlineService.pagar` resuelve el `metodoPagoId`
server-side **fijando siempre crédito** en el snapshot del carrito, y el callback crea la venta con
ese método sin mirar el resultado real de Transbank.

Transbank sí devuelve el detalle en el commit (`confirmarPago`): `payment_type_code` (VD=débito,
VN/VC/SI/S2/NC=crédito, VP=prepago), `installments_number` (cuotas) y `response_code`. Pero hoy
ese resultado **muere en el log de auditoría** (`pasarela_transacciones`): no llega a la orden ni
a la venta. Además el **card_detail.card_number** (últimos 4 dígitos, top-level en la respuesta
Mall) no se extrae, y en rechazos no se traduce el `response_code` a un motivo entendible.

Objetivo: que la venta refleje el **tipo de pago real** (débito vs crédito), guarde **cuotas** y
**últimos 4 dígitos**, y que un pago rechazado muestre el **motivo nivel 2** (ej. "Tarjeta
bloqueada"). Sin nuevos endpoints ni cambio del flujo orden↔venta; solo propagar datos ya
disponibles y mapearlos.

Referencias Transbank (según docs enlazadas por el usuario):
- Tipos de pago: `VD`=débito RedCompra · `VN`=crédito 1 cuota · `VC`=cuotas · `SI`=3 sin interés ·
  `S2`=2 sin interés · `NC`=N sin interés · `VP`=prepago.
- `card_detail.card_number` = últimos 4 dígitos (top-level del commit Mall).
- Response codes nivel 2 (rechazo): -1 tarjeta inválida · -2 error de conexión · -3 excede monto
  máximo · -4 fecha de expiración inválida · -5 problema de autenticación · -6 rechazo general ·
  -7 tarjeta bloqueada · -8 tarjeta vencida · -9 transacción no soportada · -10 problema en la
  transacción · -11 excede límite de reintentos. (Texto exacto centralizado en un util, ajustable.)

## Scope / Out of scope

**In scope**
- Extraer últimos 4 dígitos en `WebpayPlusProvider.confirmarPago`.
- Propagar el resultado del commit (tipoPago, cuotas, últimos4, codigoRespuesta, codigoAutorizacion)
  a `orden.metadata.resultadoPago` para que el callback lo use.
- El callback elige **débito vs crédito** por `tipoPago` y persiste cuotas / tipo / últimos4 en el pago.
- Columnas nuevas en `pagos`: `numero_cuotas`, `tipo_pago`, `tarjeta_ultimos4` (nullable).
- Util de traducción de `response_code` → mensaje nivel 2; en rechazo se muestra en `/tienda/retorno`
  y se guarda en la orden.
- Frontend: mostrar tipo de pago / cuotas / últimos4 en **Listado de Pagos** y **Página de retorno**;
  mostrar **motivo de rechazo** en `/tienda/retorno`.

**Out of scope**
- Detalle de venta (`VentaDetalleDrawer`): las columnas quedan disponibles pero no se agregan a esa UI
  (decisión del usuario).
- Flujo Oneclick de suscripciones (solo se agrega el campo nuevo a la interfaz, valor `null`).
- Cambiar el modelo orden↔venta, endpoints, o el flujo de callback existente.

## Backend

### 1. Provider — extraer últimos 4 dígitos (`pasarela/providers`)
- **`payment-provider.interface.ts`**: agregar `tarjetaUltimos4: string | null` a `ResultadoCobro`.
- **`webpay-plus/webpay-plus.provider.ts` `confirmarPago`**: leer `json.card_detail.card_number`
  (top-level, compartido en Mall) → `tarjetaUltimos4`. En `reembolsar` → `null`.
- **`oneclick/*.provider.ts`**: agregar `tarjetaUltimos4: null` donde retorna `ResultadoCobro` (o
  extraer de su `card_detail` si está a mano) para que compile. No es foco.

### 2. Propagar el resultado a la orden (`pasarela/services/pagos-redirect.service.ts`)
- En `confirmarRetorno`, tras `confirmarPago` y **antes** de `ordenRepo.save(orden)`, escribir el
  detalle en metadata (tanto en aprobación como en rechazo):
  ```ts
  orden.metadata = { ...orden.metadata, resultadoPago: {
    tipoPago, numeroCuotas, tarjetaUltimos4, codigoRespuesta, codigoAutorizacion } };
  ```
- Extender `obtenerResultado(tenantId, ordenId)` para devolver, además de `estado`/`referenciaExterna`,
  el `codigoRespuesta` y su `motivoRechazo` (usando el util nuevo) cuando `estado==='fallida'`, y
  opcionalmente `tipoPago`/`numeroCuotas`/`tarjetaUltimos4` desde `metadata.resultadoPago` para el
  comprobante de la página de retorno.

### 3. Util de response codes nivel 2 (`pasarela/utils/codigos-respuesta.ts`)
- `descripcionCodigoRespuesta(codigo: string | number | null): string | null` con el mapa nivel 2
  de arriba (0 → aprobada; null/desconocido → mensaje genérico). Centralizado y comentado con la
  fuente Transbank para ajuste fácil del texto.

### 4. Callback — elegir método real y persistir detalle (`online`)
- **`online.service.ts` `pagar`**: reemplazar `resolverMetodoTarjeta` (único crédito) por resolver
  **ambos** métodos habilitados del tenant y guardarlos en el snapshot:
  `checkout.metodoCreditoId` (match "crédito"/"credito", fallback primer habilitado) y
  `checkout.metodoDebitoId` (match "débito"/"debito", puede ser `null`). Mantener `metodoPagoId`
  como alias de crédito para compatibilidad, o migrar el tipo del snapshot.
- **`online-callback.handler.ts` `onOrdenResuelta`**: leer `orden.metadata.resultadoPago`.
  - Método: `tipoPago === 'VD' && metodoDebitoId ? metodoDebitoId : metodoCreditoId`.
  - Construir el pago con los campos nuevos: `{ metodoPagoId, monto: totalFinal, numeroCuotas,
    tipoPago, tarjetaUltimos4 }`.
- **`CheckoutSnapshot`** (`online.service.ts`): actualizar el tipo (`metodoCreditoId`,
  `metodoDebitoId`) y ajustar specs.

### 5. Persistir en el pago (`pagos` + `ventas`)
- **`pagos/entities/pago.entity.ts`**: agregar columnas nullable
  `numero_cuotas int`, `tipo_pago varchar`, `tarjeta_ultimos4 varchar(4)`
  (`synchronize:true` en dev las crea; documentar en `startup-pos.sql`).
- **`ventas/dto/create-venta.dto.ts` `PagoVentaDto`** y **`pagos/dto/create-pago.dto.ts`
  `PagoItemDto`**: agregar opcionales `numeroCuotas?`, `tipoPago?`, `tarjetaUltimos4?`
  (`@IsOptional` + validadores). El POS físico no los envía → `null`.
- **`pagos/pagos.service.ts` `registrar`**: setear los tres campos nuevos en `manager.create(Pago, …)`.
- **`pagos.service.ts` `listar`** (query SQL): agregar `p.numero_cuotas`, `p.tipo_pago`,
  `p.tarjeta_ultimos4` al SELECT y a `PagoListItem`/`mapPagoListRow`. (El detalle de venta
  `obtenerDetalle` en `ventas.service.ts` puede incluirlos también en el SELECT sin cambiar su UI.)

## Frontend

- **`app/pages/pagos/index.vue`** (+ tipo `PagoListItem` del composable/fetch): mostrar tipo de pago
  legible, cuotas y `····1234`. Mapear código→etiqueta con un helper local mínimo o en
  `useFormatters` (`formatTipoPago(code)`): VD→"Débito", VN→"Crédito", VC/SI/S2/NC→"Crédito en
  cuotas", VP→"Prepago". Mostrar cuotas solo si `> 1`.
- **`app/pages/tienda/retorno.vue`**:
  - Éxito: mostrar comprobante con tarjeta usada (tipo + `····1234`) y cuotas si `>1`
    (desde `GET /online/orden/:ordenId`, que ahora expone `tipoPago`/`numeroCuotas`/`tarjetaUltimos4`).
  - Rechazo: mostrar `motivoRechazo` (nivel 2) en vez del texto genérico cuando venga del API.
- **`online.service.ts` `resultadoOrden`** y **`online.controller.ts` `GET /online/orden/:ordenId`**:
  propagar los campos nuevos (`motivoRechazo`, `tipoPago`, `numeroCuotas`, `tarjetaUltimos4`) al front.

## Verification

1. **Unit (TDD, `npm test` backend)**:
   - `webpay-plus.provider.spec.ts`: `confirmarPago` mapea `card_detail.card_number` → `tarjetaUltimos4`.
   - `pagos-redirect.service.spec.ts`: `confirmarRetorno` escribe `metadata.resultadoPago`;
     `obtenerResultado` devuelve `motivoRechazo` en fallida.
   - `codigos-respuesta` util: 0/-1/-7/null → textos esperados.
   - `online.service.spec.ts`: snapshot lleva `metodoCreditoId` y `metodoDebitoId`.
   - `online-callback.handler.spec.ts`: `tipoPago:'VD'` → pago con método débito; `'VN'` → crédito;
     pago incluye `numeroCuotas`/`tipoPago`/`tarjetaUltimos4`; idempotencia intacta.
   - `pagos.service.spec.ts` (si aplica): `registrar` persiste los campos nuevos.
2. **E2E manual (docker-compose up)** con tenant **Paris** (Webpay Plus mall integración):
   - `/tienda` → pagar con **tarjeta de débito RedCompra** de prueba → venta con método
     **"Tarjeta de débito"**, `tipo_pago='VD'`, `tarjeta_ultimos4` y `numero_cuotas` correctos
     (verificar en `pagos` con `mcp__postgres__query`). `/tienda/retorno` muestra el comprobante.
   - Pagar con **crédito en cuotas** → método crédito, `numero_cuotas>1` visible en `/pagos`.
   - **Rechazo** (tarjeta rechazada de prueba) → `/tienda/retorno` muestra el motivo nivel 2; sin venta.
   - `/pagos` lista los tres datos nuevos.
3. **Regresión**: `npm test` + `npm run lint` (backend); `npm run build` (frontend).

## Docs (mismo cambio)
- `docs/features/tienda-online.md` y `docs/features/pasarela-pagos.md`: detalle de pago real
  (débito/crédito, cuotas, últimos4) y manejo de response codes nivel 2.
- `startup-pos.sql`: columnas nuevas de `pagos`.
- `CLAUDE.md`: nota en la fila de Tienda Online / Pasarela si corresponde.

## Decisions / Open questions
- **Método por `tipoPago`**: `VD`→débito, resto→crédito. Requiere que el tenant tenga habilitado el
  método débito; si no, cae a crédito (fallback seguro).
- **Últimos 4 dígitos**: se guardan solo los 4 finales (no PAN completo) — dato no sensible.
- **Texto nivel 2**: centralizado en un único util; el usuario puede ajustar la redacción sin tocar lógica.
- Detalle de venta (drawer) queda fuera de la UI por decisión del usuario; las columnas igual se pueblan.
