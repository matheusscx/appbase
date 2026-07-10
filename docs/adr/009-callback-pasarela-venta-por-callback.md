# ADR-009: Callback de pasarela — venta creada por callback, no por el navegador

**Status**: Accepted
**Date**: 2026-07-08

## Contexto

La Tienda Online debía cobrar por **Webpay Plus real** (redirect) en vez de la
pasarela simulada. Un redirect real abandona la SPA: el carrito en memoria
(`useState`) se pierde al volver, y no hay usuario logueado en el retorno público
de Transbank. Además, la pasarela está desacoplada a propósito: **no importa**
módulos de negocio (`ventas`/`online`).

Modelo de dominio acordado: **la orden de pasarela y la venta son entidades
distintas**. La orden (`pasarela_ordenes`) es el registro pendiente que lleva en
`metadata` el snapshot de lo que se paga; la **venta se crea recién cuando la
orden vuelve aprobada**.

## Decisión

La venta la dispara un **callback al resolver la orden**, no el retorno del
navegador. `CallbackDispatcherService.dispatch(orden)` corre dentro de
`confirmarRetorno` tras fijar el estado:

- **Monolito (`interno`)**: llamada **in-process** a un `PagoCallbackHandler`
  registrado en un `PagoCallbackRegistry` (singleton). El módulo consumidor
  (`online`) se registra en su `onModuleInit`. El dispatcher **espera** (`await`)
  el handler; al volver OK la venta ya existe y la orden pasa a `conciliada`
  **antes** de redirigir al usuario a `/tienda/retorno` (sin polling en el front).
- **Apps externas (`http`)**: `POST urlCallback {ordenId}` **fire-and-forget**;
  la app consulta `GET /ordenes/:id`, materializa su lado y al responder 2xx la
  orden queda `conciliada`.

La pasarela solicita **4 URLs** al iniciar: `urlExito`/`urlFracaso`/`urlPendiente`
(retornos GET del navegador) + `urlCallback` (POST server-to-server). Estados de
orden nuevos: `pendiente` (conciliación demorada, modelado) y `conciliada`.

## Alternativas consideradas

- **Confirmación desde el frontend** (`POST /online/confirmar` al volver):
  frágil — si el usuario cierra la pestaña, la venta nunca se crea. Descartado.
- **Tabla "checkout pendiente" / venta en `borrador`** en el lado de `online`:
  duplica el rol que ya cumple la orden de pasarela. Descartado: el snapshot vive
  en `orden.metadata`.
- **`@nestjs/event-emitter`**: no está instalado y agregarlo por un único handler
  in-process es innecesario. El registry es más liviano y explícito.
- **Que la pasarela importe `ventas`/`online`**: rompe la frontera del módulo.

## Consecuencias

- La venta se crea aunque el usuario abandone el navegador tras pagar.
- El handler es **idempotente** (`referencia_externa = venta.id`; si ya existe,
  no-op), tolerando el doble-retorno de Webpay.
- Un fallo del callback no rompe el redirect: la orden queda `pagada` sin
  conciliar, reconciliable después.
- El `callbackModo` (`interno`/`http`) y las 4 URLs viven en `orden.metadata`.
- El disparo `http` a externos queda como base (stub) para el consumo completo
  por apps externas en una fase posterior.
