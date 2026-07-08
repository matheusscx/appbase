# Diseño: Webpay Plus Mall (proveedor de pago redirect)

- **Status:** Approved
- **Date:** 2026-07-08
- **Owner:** Cesar Matheus

## Context

La pasarela v1 integró **Transbank Oneclick** (tokenización de tarjeta + cobro
recurrente) — ver `docs/features/pasarela-pagos.md`. El siguiente proveedor es
**Webpay Plus Mall**, el producto de **pago único con redirect** de Transbank:
el comprador es redirigido a un formulario hosted, paga, y vuelve; no se
tokeniza la tarjeta. Su flujo es estructuralmente distinto al de Oneclick, por
lo que el seam del provider (hoy modelado 100% para el flujo tokenizado) debe
generalizarse antes de sumar el nuevo proveedor.

Este documento diseña la integración **y** define qué se deja implementado ya
(seams no comprometedores) vs. qué queda como pasos ejecutables del plan.

## Scope / Out of scope

**In scope (diseño):** el flujo completo Webpay Plus Mall, la generalización del
seam del provider, la superficie API pública, credenciales mall, y la máquina de
estados.

**In scope (implementado ahora — "dejar lo necesario"):**
- Split del contrato del provider en interfaces por capacidad.
- `WebpayPlusProvider` **esqueleto** (firmas correctas, cuerpo `NotImplemented`).
- `ProviderFactory.getPagoRedirect()` + registro en el módulo.
- Fila de seed `webpay_plus` en `pasarelas` (creds mall de prueba, `activo:false`).
- Este spec + el plan ejecutable.

**Out of scope (pasos del plan, requieren ambiente/credenciales reales):**
- Lógica real del `WebpayPlusProvider` (create/commit/estado/refund HTTP).
- `PagosRedirectService` + endpoint `POST /pasarela/api/pagos` + retorno público.
- Tests unitarios del provider y del service; e2e manual con tarjeta.
- Reconectar tienda/suscripciones, webhooks, failover — igual que en v1.

## Flujo

Webpay Plus es **crear → redirigir → confirmar** (idéntico en forma al flujo de
inscripción de Oneclick, pero confirmando un **pago** en vez de una tarjeta):

```
POST /pasarela/api/pagos
  → crea PasarelaOrden (estado 'en_proceso')
  → provider.iniciarPago(cred, { codigoOrden, monto, moneda, returnUrl })
  → Webpay create transaction → { token, url }
  → responde { ordenId, urlWebpay, token }

[ app redirige al comprador a urlWebpay; paga en el formulario hosted ]

GET|POST /pasarela/retorno/pago   (público — la credencial es el token_ws de un solo uso)
  → provider.confirmarPago(cred, token)  → commit
  → orden 'pagada' | 'fallida'
  → 302 a la urlRetorno de la app con ?ordenId=…&estado=…
```

La máquina de estados de `pasarela_ordenes`
(`creada → en_proceso → pagada | fallida | expirada`, `+ reembolsada`) y el
**invariante de timeout** aplican sin cambios: un error de red en el commit deja
la orden `en_proceso` (nunca `fallida`), responde 502 e invita a `/verificar`.
`reembolsar` y `consultarEstado` son comunes a todos los proveedores.

## Generalización del seam del provider (enfoque aprobado: A — split por capacidad)

`payment-provider.interface.ts` se reorganiza en tres interfaces:

```typescript
// Común a todo proveedor
export interface ProviderReembolsable {
  reembolsar(cred, p: { codigoOrden; monto }): Promise<ResultadoCobro>;
  consultarEstado(cred, codigoOrden): Promise<ResultadoEstado>;
}

// Flujo tokenizado (Oneclick): inscripción + cobro con tarjeta guardada
export interface ProviderTokenizado extends ProviderReembolsable {
  iniciarInscripcion(...); confirmarInscripcion(...); eliminarInscripcion(...);
  autorizarCobro(...);
}

// Flujo pago redirect de una vez (Webpay Plus)
export interface ProviderPagoRedirect extends ProviderReembolsable {
  iniciarPago(cred, p: { codigoOrden; monto; moneda; returnUrl }):
    Promise<{ tokenExterno; urlRedireccion } & ResultadoProvider>;
  confirmarPago(cred, token): Promise<ResultadoCobro>;
}
```

- `OneclickProvider implements ProviderTokenizado` (sin cambios funcionales, solo
  el nombre de la interfaz).
- `WebpayPlusProvider implements ProviderPagoRedirect`.
- `ProviderFactory` expone `getTokenizado(codigo): ProviderTokenizado` y
  `getPagoRedirect(codigo): ProviderPagoRedirect`. Cada consumidor pide la forma
  que necesita; el compilador impide llamar `autorizarCobro` a un provider
  redirect. Los callers actuales (`InscripcionesService`, `CobrosService`) pasan
  a `getTokenizado` (v1 de cobros/inscripciones es Oneclick-only).

Descartados: métodos opcionales en una sola interfaz (contrato deshonesto) y
capabilities en runtime (sobre-ingeniería para 2 proveedores).

## Credenciales / mall

`CredencialesService.resolver()` en modo MALL ya hace
`{ baseUrl, ...configPlataforma, ...configTenant }`. Webpay Plus Mall reutiliza
la forma: la plataforma aporta `mallCommerceCode` + `apiKeySecret`; el tenant
aporta `commerceCodeHijo`. **Cero cambios** al resolver. El `request()` helper de
`OneclickProvider` (fetch + manejo de body no-JSON como `ProviderComunicacionError`)
se replica en `WebpayPlusProvider` con el `BASE_PATH` de Webpay
(`/rswebpaytransaction/api/webpay/v1.2`).

## API / superficie pública (pasos del plan)

```
POST     /api/pasarela/api/pagos          # ApiKeyGuard — inicia pago redirect
GET|POST /api/pasarela/retorno/pago       # público — commit + 302 a la app
```

Reutilizan `PasarelaApiController` / `PasarelaRetornoController` y el patrón del
retorno de inscripción (claim/idempotencia sobre el estado de la orden).

## Seed

Fila en `pasarelas` (id `550e8400-e29b-41d4-a716-446655440216`):

```
codigo: 'webpay_plus', nombre: 'Transbank Webpay Plus'
soportaTokenizacion: false, soportaCobroRecurrente: false, soportaMall: true
urlPruebas: 'https://webpay3gint.transbank.cl'
urlProduccion: 'https://webpay3g.transbank.cl'
configuracionPruebas: { mallCommerceCode, apiKeySecret }  # códigos públicos de integración
activo: false   # se activa cuando el flujo real aterriza (paso del plan)
```

`activo: false` hasta que el provider esté implementado, para que no aparezca
como contratable en la UI mientras es un esqueleto.

## Testing

- **Unit (plan):** contrato del `WebpayPlusProvider` (create OK, commit
  aprobado/rechazado, timeout → `ProviderComunicacionError`), `PagosRedirectService`
  (orden en_proceso → pagada/fallida, invariante de timeout).
- **E2E manual (plan):** contratar `webpay_plus` para Paris, crear pago, pagar en
  el formulario hosted con tarjeta de prueba, confirmar retorno, reembolsar,
  verificar cifrado/redacción.

## Decisions / Open questions

- **Seam:** enfoque A (split por capacidad) — aprobado.
- **`activo: false` en el seed** hasta implementar el flujo — evita ofrecer un
  esqueleto.
- **Abierto (para el paso de implementación):** confirmar los códigos de comercio
  mall de integración de Webpay Plus contra la doc vigente de Transbank antes del
  e2e (los sembrados son los documentados públicamente).
