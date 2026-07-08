# Webpay Plus Mall — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: usar superpowers:subagent-driven-development o executing-plans para ejecutar tarea por tarea. Los pasos usan checkboxes `- [ ]`.

**Goal:** integrar Transbank Webpay Plus Mall (pago único con redirect) como segundo proveedor de la pasarela.

**Architecture:** proveedor de flujo *crear → redirigir → confirmar* detrás de la interfaz `ProviderPagoRedirect`; un `PagosRedirectService` orquesta la orden y el retorno público confirma el pago. Reutiliza el patrón del retorno de inscripción de Oneclick.

**Tech Stack:** NestJS + TypeORM, `fetch` nativo, Decimal.js. REST Webpay Plus Mall `/rswebpaytransaction/api/webpay/v1.2`.

## Global Constraints

- Invariante de timeout: un error de red NUNCA es rechazo → transacción `error`, orden queda `en_proceso`, responder 502 "verifique el estado". Solo un `response_code != 0` explícito marca `fallida`.
- Credenciales cifradas (AES-256-GCM), `identificador_externo`/tokens nunca en claro en respuestas HTTP; `request`/`response` redactados antes de persistir.
- `tenant_id` siempre del token/API key, nunca del body. Dinero/porcentajes con Decimal.js. CLP en enteros.
- Soft delete, columnas UUID `type:'uuid'`, tokens semánticos en frontend. Trabajar en `main`.
- Reembolso concurrente: mismo patrón que Oneclick (lock pesimista; auditar timeout **fuera** de la tx).

---

## Fase 0 — Seams (IMPLEMENTADO 2026-07-08, no re-ejecutar)

- [x] Split de `payment-provider.interface.ts` en `ProviderReembolsable` / `ProviderTokenizado` / `ProviderPagoRedirect`.
- [x] `OneclickProvider implements ProviderTokenizado`; callers pasan a `factory.getTokenizado()`.
- [x] `WebpayPlusProvider` esqueleto (`ProviderPagoRedirect`, cuerpo `NotImplementedException`) registrado en el módulo.
- [x] `ProviderFactory.getPagoRedirect('webpay_plus')`.
- [x] Seed `pasarelas` fila `webpay_plus` (id …440216, `activo:false`, creds mall de prueba cifradas).

---

## Task 1: `WebpayPlusProvider.iniciarPago` (create transaction)

**Files:**
- Modify: `backend/src/modules/pasarela/providers/webpay-plus/webpay-plus.provider.ts`
- Test: `backend/src/modules/pasarela/providers/webpay-plus/webpay-plus.provider.spec.ts`

**Interfaces:**
- Consumes: `CredencialesResueltas` (`{ baseUrl, mallCommerceCode, apiKeySecret, commerceCodeHijo }`).
- Produces: `iniciarPago(cred, { codigoOrden, monto, moneda, returnUrl }) → { tokenExterno, urlRedireccion } & ResultadoProvider`.

- [ ] **Step 1: test de create OK** — mockear `fetch` devolviendo `{ token: 'tok-1', url: 'https://webpay/redirect' }`; esperar `tokenExterno==='tok-1'`, `urlRedireccion` set, `aprobada:true`.
- [ ] **Step 2: correr, ver fallar.**
- [ ] **Step 3: implementar** el `request()` helper (copiar de `OneclickProvider`, cambiar `BASE_PATH` a `/rswebpaytransaction/api/webpay/v1.2`) y:

```typescript
async iniciarPago(cred, p) {
  const body = {
    buy_order: p.codigoOrden,
    session_id: p.codigoOrden,
    return_url: p.returnUrl,
    details: [{
      amount: this.montoEntero(p.monto, p.moneda),
      commerce_code: cred.commerceCodeHijo,
      buy_order: `${p.codigoOrden}-1`,
    }],
  };
  const { json, requestInfo } = await this.request(cred, 'POST', '/transactions', body);
  if (!json.token || !json.url)
    throw new ProviderComunicacionError('Respuesta de create inválida', requestInfo, json);
  return { tokenExterno: toStr(json.token), urlRedireccion: toStr(json.url),
           aprobada: true, codigoRespuesta: null, request: requestInfo, response: json };
}
```
- [ ] **Step 4: correr, ver pasar. Step 5: commit.**

## Task 2: `WebpayPlusProvider.confirmarPago` (commit)

**Interfaces:** `confirmarPago(cred, token) → ResultadoCobro`.

- [ ] **Step 1: tests** — commit aprobado (`details[0].status==='AUTHORIZED'`, `response_code===0` → `aprobada:true`, `codigoAutorizacion`, `tipoPago`); commit rechazado (`response_code!==0` → `aprobada:false`); timeout (`fetch` throws → `ProviderComunicacionError` propaga).
- [ ] **Step 2: correr, ver fallar.**
- [ ] **Step 3: implementar** `PUT /transactions/{token}` (idéntico shape a `autorizarCobro` de Oneclick para leer `details[0]`), identificando la transacción por `token` (Webpay identifica por token, no por buy_order).
- [ ] **Step 4/5: pasar + commit.**

## Task 3: `reembolsar` + `consultarEstado`

- [ ] **Step 1: tests** — refund OK (`json.type` presente → `aprobada`), estado por `details[0].status` (AUTHORIZED/CAPTURED→pagada; FAILED/REVERSED/NULLIFIED→fallida; resto→desconocido). El `codigoOrden` aquí es el **token** de Webpay.
- [ ] **Step 2-3: implementar** `POST /transactions/{token}/refunds` (`{ buy_order: '<token>-1', commerce_code: cred.commerceCodeHijo, amount }`) y `GET /transactions/{token}`, calcados de Oneclick cambiando la ruta base.
- [ ] **Step 4/5: pasar + commit.**

## Task 4: `PagosRedirectService.iniciar`

**Files:**
- Create: `backend/src/modules/pasarela/services/pagos-redirect.service.ts`
- Test: `backend/src/modules/pasarela/services/pagos-redirect.service.spec.ts`

**Interfaces:** `iniciar(tenantId, dto: { monto; moneda?; referenciaExterna?; descripcion?; urlRetorno }) → { ordenId, urlWebpay, token }`.

- [ ] **Step 1: test** — crea orden `en_proceso`, llama `provider.iniciarPago`, persiste `tokenExterno` en la orden (columna `metadata.tokenWebpay` o campo dedicado), devuelve `urlWebpay`.
- [ ] **Step 2-3: implementar** siguiendo el patrón de `InscripcionesService.iniciar` + `CobrosService.cobrar` (resolver config activa con `getPagoRedirect`, `returnUrl` = base pública `/api/pasarela/retorno/pago`). Guardar el `token` para poder confirmar en el retorno.
- [ ] **Step 4/5: pasar + commit.**

## Task 5: `PagosRedirectService.confirmarRetorno` (invariante de timeout)

- [ ] **Step 1: tests** — commit aprobado → orden `pagada` + transacción `AUTHORIZATION aprobada`; rechazado → `fallida`; timeout → orden queda `en_proceso`, transacción `error`, lanza (para que el controller redirija con estado de error / 502). Reintento de retorno (doble token) idempotente vía estado de la orden.
- [ ] **Step 2-3: implementar** replicando el manejo de `ProviderComunicacionError` de `CobrosService.cobrar` (registrar `error`, no marcar `fallida`).
- [ ] **Step 4/5: pasar + commit.**

## Task 6: endpoints (`POST /pagos` + retorno público)

**Files:**
- Modify: `backend/src/modules/pasarela/controllers/pasarela-api.controller.ts` (POST `pagos`, ApiKeyGuard)
- Modify: `backend/src/modules/pasarela/controllers/pasarela-retorno.controller.ts` (GET|POST `pago`)
- Create: DTO `create-pago.dto.ts` (`monto` string, `urlRetorno` url, opcionales `moneda`/`referenciaExterna`/`descripcion`) con `class-validator`.
- Modify: `pasarela.module.ts` (registrar `PagosRedirectService`).

- [ ] **Step 1:** DTO + test e2e-light del controller (mock service) para `POST /pagos` y el retorno (302 a `urlRetorno` con `?ordenId&estado`).
- [ ] **Step 2-3:** implementar, reutilizando el patrón de `PasarelaRetornoController` de inscripción (token de un solo uso como credencial; sin ApiKeyGuard en el retorno).
- [ ] **Step 4/5: pasar + commit.**

## Task 7: activar el proveedor + docs

- [ ] Cambiar el seed `webpay_plus` a `activo: true`.
- [ ] `docs/features/pasarela-pagos.md`: sumar Webpay Plus (endpoints, flujo, tabla de riesgos si aplica), estado en `CLAUDE.md`.
- [ ] Commit.

## Verification

- `cd backend && npm test -- pasarela` — todo verde.
- `npx tsc --noEmit` sin errores; `npx eslint` limpio en los archivos tocados.
- **E2E manual:** contratar `webpay_plus` para Paris (UI o seed tenant_pasarela), `POST /api/pasarela/api/pagos`, abrir `urlWebpay`, pagar con tarjeta de prueba, confirmar retorno → orden `pagada`, reembolsar, verificar cifrado/redacción en BD.

## Decisions / Open questions

- **Persistencia del token de Webpay:** en `orden.metadata.tokenWebpay` (evita migración) vs. columna dedicada. Recomendado: `metadata` para v1.
- **Confirmar los códigos de comercio mall de integración** contra la doc vigente de Transbank antes del e2e (ver el seed).
