# Plan: Endurecimiento pre-producción de la pasarela de pagos

- **Status:** In Progress (ítems 1 y 2 hechos; ítem 3 = verificación manual pendiente)
- **Date:** 2026-07-08
- **Owner:** Cesar Matheus

## Context

La pasarela de pagos v1 (Oneclick real, API keys, cifrado, admin UI) quedó
implementada y revisada — ver `docs/features/pasarela-pagos.md` y
`docs/superpowers/specs/2026-07-07-pasarela-pagos-design.md`. La revisión final
de rama la aprobó para merge en `main` en etapa de desarrollo, pero dejó una
lista acotada de **endurecimientos recomendados antes de producción**. Este
plan los agrupa. Ninguno bloquea el uso en desarrollo/integración; todos
importan cuando la pasarela mueva dinero real a volumen.

## Scope / Out of scope

- **In scope:** los 3 endurecimientos técnicos abajo + cerrar la verificación
  manual de punta a punta.
- **Out of scope:** Webpay Plus / Stripe / MercadoPago, webhooks entrantes,
  reconectar suscripciones/tienda a la pasarela real, job de cobro recurrente
  (todos fuera del alcance de v1, ya listados en el spec).

## Items

### 1. Lock a nivel BD en reembolsos concurrentes (Important, diferido)

**Problema:** `CobrosService.reembolsar()` hace read (calcula saldo disponible)
→ llamada al proveedor → write, sin serialización. Dos reembolsos concurrentes
sobre la misma orden podrían leer el mismo `disponible` y ambos aprobar.

**Mitigante existente (por qué no es bloqueante):** Transbank valida el techo
de reembolso server-side; un segundo reembolso que exceda lo capturado vuelve
como rechazo de negocio (`aprobada:false`) y se registra `'rechazada'`. La
carrera arriesga una llamada redundante al proveedor, **no una sobre-devolución
real de dinero**.

**Decisión:** lock **pesimista** `SELECT … FOR UPDATE` (más simple de razonar
para dinero). **Implementado.**

- [x] Envolver `reembolsar()` en transacción con lock de la orden
  (`dataSource.transaction` + `lock: pessimistic_write`; `TransaccionesService`
  ahora acepta un `EntityManager` opcional para escribir dentro de la misma tx)
- [x] Test de dos reembolsos concurrentes que en conjunto exceden el total
  (el segundo ve el REFUND del primero tras el lock → rechazado)
- [x] Actualizar `docs/features/pasarela-pagos.md` (tabla de riesgos)

**Corrección post-revisión (review de concurrencia, Opus):** la primera versión
registraba la auditoría del timeout con una conexión propia **dentro** de la
transacción que sostiene `FOR UPDATE`. Como `pasarela_transacciones.orden_id`
tiene FK a `pasarela_ordenes`, ese INSERT toma `FOR KEY SHARE` sobre la misma
fila → conflicto con el `FOR UPDATE` propio → auto-bloqueo que el detector de
deadlock de PG no ve (la tx espera en Node, no en la BD). No explotaba en dev
solo porque TypeORM `synchronize` no crea la FK (la entidad usa `@Column`
plano), pero el esquema canónico `startup-pos.sql` sí la tiene. **Fix:** el
`ProviderComunicacionError` se propaga fuera de `dataSource.transaction` (la tx
hace rollback y libera el lock) y recién ahí se registra el rastro por conexión
normal. El path de éxito sigue escribiendo dentro de la tx con el `manager`.

- [x] Mover la auditoría del timeout fuera de la transacción (tras liberar el lock)
- **Minor aceptado:** el lock se sostiene durante la llamada HTTP al proveedor
  (riesgo de pileup del pool bajo alta concurrencia de reembolsos). Aceptable
  para la frecuencia esperada; acotar `lock_timeout` queda como mejora futura.
  La serialización real (y el conflicto FK) solo se prueba con BD real → cubierto
  por el e2e manual del ítem 3.

### 2. Expiración perezosa con verificación de proveedor (Important, parcialmente mitigado)

**Estado:** en el commit `a0d325e` ya se mitigó el peor efecto — `verificar()`
ahora acepta órdenes `'expirada'`, así que la expiración por reloj ya **no
cierra la puerta** a reconciliar una orden con timeout.

**Residual:** `obtenerOrden()` sigue marcando `en_proceso → expirada` solo por
reloj (2h), sin consultar al proveedor. Como las únicas órdenes que quedan en
`en_proceso` son las de timeout, marcarlas `expirada` asume "no pagó" en la UI
hasta que alguien llame `/verificar`.

**Decisión:** política (a) — no expirar perezosamente órdenes con intento de
auth (`AUTHORIZATION 'error'`). **Implementado.** La opción (b) job/cron queda
como mejora futura si se quiere cierre proactivo sin GET.

- [x] Política (a): `obtenerOrden()` no expira si hay `AUTHORIZATION 'error'`
- [x] Test: orden con intento de auth se mantiene `en_proceso` (reconciliable)

### 3. Verificación manual de punta a punta completa (pendiente de T12)

La verificación autónoma cubrió: flujo API e2e contra Transbank real, cifrado
en reposo, y el render del formulario de inscripción con nuestros datos. Falta
completar **manualmente** (el formulario hosted de Transbank no es
automatizable de forma fiable):

- [ ] Inscribir tarjeta de prueba VISA `4051 8856 0044 6623` (exp. futura,
  CVV `123`) en el formulario de Webpay abierto desde `urlWebpay`
- [ ] Confirmar retorno → `estado=activa`, medio de pago creado
- [ ] Cobro (`POST /pasarela/api/cobros`) → `pagada`
- [ ] Reembolso total → `reembolsada`
- [ ] Verificar en la BD que `identificador_externo` (tbkUser) quedó cifrado
  (`v1:…`) y el historial de transacciones sin secretos en claro

## Minors aceptados (no requieren acción salvo que molesten)

- Nombres de índices en `startup-pos.sql` difieren de los autogenerados por
  TypeORM `synchronize` (doc de referencia, no se usa como init script).
- Default de `PASARELA_ENCRYPTION_KEY` en `docker-compose.yml` = clave de test
  (mismo patrón que `JWT_SECRET`; sobreescribir en cualquier ambiente real).
- `toStr()` ≡ `String()` (riesgo `[object Object]` preexistente del diseño);
  `toNumber()` sin redondeo para monedas no-CLP (Oneclick es CLP-only).
- Redacción aplana valores no-planos (`Date`) a `{}` — payloads JSON de
  proveedor, bajo riesgo.
- `verificar()` no captura errores de `consultarEstado` (aceptable: no muta
  estado antes de la consulta, la orden queda reintentable).

## Decisions / Open questions

- **Item 2**: ¿política (a) excluir-por-transacción o (b) job de
  reconciliación? Requiere criterio de pagos del owner.
- **Item 1**: ¿lock pesimista (`FOR UPDATE`) o versión optimista? Ambos
  sirven; el pesimista es más simple de razonar para dinero.
