# Plan: Integrar Webpay Plus a la Tienda Online

Status: Done
Date: 2026-07-08
Owner: Cesar Matheus

> Implementado el 2026-07-09. Backend (generalización pasarela + módulo online),
> frontend (pagar/retorno) y docs completos; unit tests verdes (349). Pendiente
> solo la verificación E2E manual contra Transbank integración (tenant Paris).

> Al ejecutar: primero copiar este plan a `docs/superpowers/plans/2026-07-08-webpay-tienda-online.md`
> (convención del repo). Trabajar directo sobre `main`. Antes de codear, leer
> `docs/patterns/backend.md` y `docs/patterns/frontend.md`, e invocar los skills
> `nestjs-best-practices` (backend) y `nuxt-ui` (frontend). TDD: escribir specs primero.

## Context

Hoy la Tienda Online cobra con una **pasarela simulada**: `/tienda/pasarela` (front) donde
"Aprobar pago" llama directo a `POST /ventas` con tarjetas mock. El carrito sobrevive porque
nunca sale de la SPA (`useState`). Ya existe un módulo real de pasarela
(`backend/src/modules/pasarela`) con **Webpay Plus Mall** (crear→confirmar redirect, reembolso,
verificación), desacoplado a propósito de `ventas`/`online`. Falta conectarlos.

Objetivo: que la compra del carrito cobre por Webpay Plus real. Modelo acordado con el usuario
(idéntico al de su pasarela previa): **la transacción de pago y la venta son entidades distintas**.
La **orden de pasarela** (`pasarela_ordenes`) es el registro pendiente que lleva la info de lo que
se paga; **la venta se crea recién cuando la orden vuelve aprobada**, disparada por un **callback**
(no por el navegador). Para apps externas el callback es un `POST HTTP`; para el **monolito** es una
**llamada a función in-process** (flujo simplificado, sin HTTP).

## Flujo objetivo

**Iniciar** (`POST /online/pagar`, JWT): calcula total → llama in-process a
`PagosRedirectService.iniciar(...)` con `origen:'interno'`, snapshot del carrito en `metadata`, y
URLs de retorno a `/tienda/retorno`. Devuelve `{ modo:'webpay', urlWebpay, ordenId }`. El front hace
**redirect real** (`window.location.href = urlWebpay`).

**Retorno** (Transbank → `/pasarela/retorno/pago`): la pasarela confirma con Transbank → orden
`pagada`/`fallida`/`pendiente` → **dispara el callback** → redirige al usuario a
`urlExito`/`urlFracaso`/`urlPendiente`.

**Callback (monolito, in-process)**: el handler del módulo `online` lee el carrito de la orden y
**crea la venta** `canal:'online'` estado `pagada`, guarda `referencia_externa = venta.id`, y la
pasarela marca la orden **`conciliada`**. Idempotente. (Para `origen:'api'` la pasarela hace `POST`
async a `urlCallback` — se implementa el disparo async como stub/base; el ack del externo marca
`conciliada`.)

## Scope / Out of scope

**In scope**
- Compra única del carrito de la tienda por Webpay Plus.
- Generalización del flujo redirect de pasarela: 4 URLs (`exito`/`fracaso`/`pendiente` GET +
  `callback` POST), estados de orden `pendiente` y `conciliada`, y mecanismo de callback
  (in-process para monolito; POST HTTP async como base para externos).
- Fallback: si el tenant no tiene `webpay_plus` activo → mantener la página simulada actual.

**Out of scope**
- Suscripciones (siguen en su flujo Oneclick tokenizado existente).
- Storefront público / auth de customer final.
- Implementación completa del consumo de callback por apps externas (solo el disparo async base).

## Backend

### 1. Generalizar el flujo redirect en `pasarela`

- **`dto/create-pago.dto.ts`**: reemplazar `urlRetorno` por `urlExito` (req), `urlFracaso` (req),
  `urlPendiente` (opt, default = exito), `urlCallback` (opt, `@IsUrl`, para externos). Mantener
  `monto`, `descripcion`, `pagadorRef?`, `referenciaExterna?`.
- **`entities/pasarela-orden.entity.ts`**: documentar en el comentario de `estado` los valores
  nuevos `pendiente` y `conciliada`. Las 4 URLs y el modo de callback viven en `metadata`
  (consistente con `urlRetornoApp` actual): `metadata.urls = {exito,fracaso,pendiente,callback}`,
  `metadata.callbackModo: 'interno'|'http'`.
- **`services/pagos-redirect.service.ts`**:
  - `iniciar(tenantId, dto, opts?)` con `opts = { origen?: 'api'|'interno', apiKeyId?, metadataExtra? }`
    (default `origen:'api'` para no romper el controller m2m). Guardar `urls`, `callbackModo`
    (`interno` si `origen==='interno'`, si no `http`), `apiKeyId`, y hacer merge de `metadataExtra`
    (el snapshot del carrito) en `metadata`.
  - `confirmarRetorno(token)`: tras fijar `orden.estado` (`pagada`/`fallida`; dejar `pendiente`
    modelado aunque Webpay Plus no lo emita en v1), **invocar `CallbackDispatcherService.dispatch(orden)`**
    y devolver la URL de redirect según estado (`urls.exito|fracaso|pendiente` + `?ordenId=&estado=`).
    Mantener el invariante actual de timeout (`ProviderComunicacionError` → `en_proceso` +
    `BadGateway` apuntando a `/verificar`).
- **Nuevo `services/callback-dispatcher.service.ts`**:
  - `dispatch(orden)`: si `callbackModo==='interno'` → **await** `registry.get()?.onOrdenResuelta(orden)`
    y si resuelve OK marcar orden `conciliada` (para el monolito, awaited = robusto y simple; la
    venta existe antes de que el usuario aterrice en `/tienda/retorno`). Si `callbackModo==='http'`
    → `POST urlCallback {ordenId}` **fire-and-forget** (no bloquea el redirect); al recibir 2xx
    marcar `conciliada`. Errores del callback: log + no romper el redirect; la orden queda
    `pagada` sin conciliar (reconciliable luego).
- **Nuevo `services/pago-callback.registry.ts`** + interfaz:
  - `interface PagoCallbackHandler { onOrdenResuelta(orden: PasarelaOrden): Promise<void> }`.
  - `@Injectable() PagoCallbackRegistry { register(h); get(): PagoCallbackHandler | null }`
    (singleton). Evita acoplar `pasarela → online` y no requiere dependencia nueva (`@nestjs/event-emitter`
    no está instalado). El módulo `online` se registra en su `onModuleInit`.
- **`pasarela.module.ts`**: declarar `CallbackDispatcherService` y `PagoCallbackRegistry`;
  **exportar** `PagoCallbackRegistry`, `TenantPasarelaService`, `PagosRedirectService` (para que
  `online` los inyecte). Mantener el borde: pasarela NO importa `online`/`ventas`.
- Nuevo método de lectura para la página de retorno: `PagosRedirectService.obtenerResultado(tenantId, ordenId)`
  → `{ estado, ventaId: orden.referenciaExterna }` (scoped a tenant).

Archivos guía existentes a reutilizar: `pagos-redirect.service.ts`, `cobros.service.ts`
(`obtenerOrden`, patrón de estados), `transacciones.service.ts`, `provider.factory.ts`.

### 2. Módulo `online`

- **`online.service.ts`**:
  - `pagar(tenantId, usuarioId, dto)`:
    1. Detectar `webpay_plus` activo: `try tenantPasarelaService.resolverConfiguracionActiva(tenantId,'webpay_plus')`.
       Si lanza (no configurado) → **fallback**: devolver `{ modo:'simulado', ...checkout() }` (lógica actual).
    2. Si activo: `calcularPrecios` → armar **snapshot** `{ lineas:[{itemId,cantidad,precioUnitario}], customer, usuarioId, metodoPagoId, totalFinal }`
       (precio fijado desde el resultado para que la venta cuadre exacto con lo cobrado). Resolver
       `metodoPagoId` server-side (primer método tarjeta/crédito de `metodos-pago`, como hace hoy
       `pasarela.vue:metodoTarjeta()`).
    3. `pagosRedirect.iniciar(tenantId, { monto: totalFinal, descripcion, urlExito, urlFracaso, urlPendiente },
       { origen:'interno', metadataExtra:{ origenApp:'tienda-online', checkout: snapshot } })`.
    4. Devolver `{ modo:'webpay', urlWebpay, ordenId }`. URLs → `${APP_PUBLIC_URL}/tienda/retorno`.
  - `resultadoOrden(tenantId, ordenId)` → delega en `pagosRedirect.obtenerResultado`.
- **Nuevo `online-callback.handler.ts`** (`implements PagoCallbackHandler`, `OnModuleInit`):
  - `onModuleInit()` → `registry.register(this)`.
  - `onOrdenResuelta(orden)`: ignorar si `metadata.origenApp !== 'tienda-online'`. Si
    `estado==='pagada'` y `referenciaExterna == null`: construir `CreateVentaDto` desde
    `metadata.checkout` (`canal:'online'`, `lineas` con `precioUnitario`, `pagos:[{metodoPagoId,
    monto: totalFinal}]`, `customer`) → `ventasService.crear(orden.tenantId, checkout.usuarioId, dto)`
    → set `orden.referenciaExterna = venta.id`. **Idempotente** (si ya hay `referenciaExterna`, no-op).
- **`online.controller.ts`**: agregar `POST /online/pagar` (`@RequiresPermiso('Tienda Online','Crear')`)
  y `GET /online/orden/:ordenId` (JWT+Tenant) → `{ estado, ventaId }`. Conservar `POST /online/checkout`
  para el fallback simulado.
- **`online.module.ts`**: importar `PasarelaModule` (para `PagosRedirectService`,
  `TenantPasarelaService`, `PagoCallbackRegistry`) y `VentasModule` (para `VentasService`);
  declarar `OnlineCallbackHandler` como provider. `VentasModule` debe exportar `VentasService`
  (verificar/añadir).

`VentasService.crear(tenantId, usuarioId, dto)` ya soporta `canal:'online'` (caja virtual, exige
pago completo). `usuarioId` solo se usa para `movimientos_inventario.usuario_id`; por eso se guarda
en el snapshot al iniciar.

## Frontend

- **`composables/useTiendaCarrito.ts`** (`pagar`): llamar `POST /online/pagar`. Devolver `modo` +
  datos. Ajustar tipo `CheckoutResponse`.
- **`pages/tienda/index.vue`** (`irAPagar`): si `modo==='webpay'` → `window.location.href = urlWebpay`;
  si `modo==='simulado'` → `navigateTo(checkoutUrl)` (comportamiento actual intacto).
- **Nueva `pages/tienda/retorno.vue`** (`middleware:'auth'`, layout dashboard): lee `?ordenId=&estado=`.
  Llama `GET /online/orden/:ordenId` para obtener `{estado, ventaId}`. Muestra éxito/rechazo/pendiente
  (reutilizar la UI de tarjeta de `pasarela.vue`), botón "Ver venta" → `/ventas/{ventaId}`, y
  `limpiar()` del carrito al éxito. La venta ya existe (callback awaited); no requiere polling.
- **`pages/tienda/pasarela.vue`**: se mantiene como está para el fallback simulado.

## Verification

1. **Unit (TDD, `npm test` en backend)**:
   - `pagos-redirect.service.spec.ts`: `iniciar` guarda 4 URLs + `callbackModo:'interno'` con
     `origen:'interno'`; `confirmarRetorno` elige redirect por estado y llama al dispatcher;
     conserva el invariante de timeout.
   - `callback-dispatcher.service.spec.ts`: interno → await handler + orden `conciliada`; http →
     `POST` async, no bloquea; error de callback no rompe redirect.
   - `online.service.spec.ts` / `online-callback.handler.spec.ts`: `pagar` devuelve webpay cuando
     hay config activa y cae a simulado cuando no; handler crea venta idempotente + set
     `referenciaExterna`; ignora órdenes de otras apps.
2. **E2E manual (docker-compose up)** con tenant **Paris** (ya sembrado con Webpay Plus mall
   `commerceCodeHijo 597055555536`, ambiente integración Transbank):
   - `/tienda` → agregar productos → "Pagar" → redirige al formulario de Transbank integración.
   - Pagar con tarjeta de prueba Transbank → vuelve a `/tienda/retorno?estado=pagada` → ver venta
     creada `canal online`, estado `pagada`, orden `conciliada` (verificar en `pasarela_ordenes`).
   - Verificar en Swagger `GET /pasarela/api/ordenes/:id` que la orden quedó `conciliada` y con
     `referencia_externa = venta.id`.
   - Caso rechazo (anular en el form) → `/tienda/retorno?estado=fallida`, sin venta.
   - Tenant sin `webpay_plus` activo → "Pagar" cae a la página simulada (fallback).
   - Idempotencia: reintentar el retorno con el mismo `ordenId` no duplica la venta.
3. **Regresión**: `npm test` + `npm run lint` en backend; `npm run build` en frontend.

## Docs (mismo cambio)

- `docs/features/tienda-online.md`: reemplazar sección de checkout dummy por el flujo Webpay + fallback.
- `docs/features/pasarela.md`: documentar 4 URLs, estados `pendiente`/`conciliada`, callback in-process vs HTTP.
- `docs/adr/`: nuevo ADR "Callback de pasarela: registry in-process vs HTTP; venta creada por callback, no por navegador".
- `CLAUDE.md`: fila "Estado actual" → Tienda Online integrada con Webpay Plus.
- `docs/patterns/backend.md`: patrón de callback desacoplado (registry + `onModuleInit`).

## Decisions / Open questions

- **Callback in-process del monolito: awaited (no async)** dentro de `confirmarRetorno`. Es la
  simplificación acordada: en un solo proceso/DB es rápido y garantiza la venta antes del redirect,
  evitando polling en el front. El disparo async (`no detiene el flujo`) se reserva para el `POST`
  HTTP a apps externas.
- `pendiente` se **modela** (estado + URL) pero Webpay Plus resuelve inmediato; no se ejercita en v1.
- `metodoPagoId` de la venta: se resuelve server-side (primer método tarjeta del tenant). Si se
  prefiere un método "Webpay" dedicado, sembrarlo en `seeder.service.ts` (decisión menor, abierta).
