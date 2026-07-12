# Plan: Cobro Oneclick real en el alta y gestión de suscripciones

Status: Done
Date: 2026-07-12
Owner: César

> Implementado 2026-07-12. Backend + frontend + docs + tests (425 backend / 121
> frontend en verde). Pendiente: verificación manual E2E contra Transbank
> integración con la tarjeta VISA 4051 8856 0044 6623.

## Context

Hoy el alta de una suscripción en la Tienda Online pasa por una **pasarela
simulada** (`/tienda/pasarela?modo=suscripcion`): el botón "Aprobar" llama
`POST /suscripciones`, que crea una venta online pagada + la fila de suscripción
en una transacción, registrando el pago con un `metodoPagoId` contable. La
tarjeta es solo un **snapshot visual** (`tarjeta_marca`/`tarjeta_last4`) que el
frontend arma desde tarjetas mock — no hay cobro real ni amarre a un medio de
pago tokenizado.

En paralelo ya existe todo lo necesario para cobrar de verdad:
- Inscripción Oneclick real (`/online/medios-pago`, tabla `pasarela_inscripciones`
  con `tbk_user` cifrado, preferida en BD, `pasarela_medios_pago` con marca/últimos4).
- **Cobro Oneclick real** — `CobrosService.cobrar(tenantId, dto, 'interno')`
  (`backend/src/modules/pasarela/services/cobros.service.ts`) que autoriza contra
  Transbank (`OneclickProvider.autorizarCobro`), crea una `pasarela_ordenes` y
  registra la transacción `AUTHORIZATION`. Hoy solo lo consume la API m2m.

Este plan **conecta el alta de suscripciones a ese cobro real**, amarra cada
suscripción a una tarjeta inscrita, y permite cambiarla después.

### Decisiones tomadas con el usuario (no re-abrir)
1. **Alcance**: solo alta con cobro real + amarre tarjeta↔suscripción + edición de
   tarjeta. El **cron de cobro recurrente queda fuera** (plan futuro);
   `proximo_cobro` sigue siendo informativo.
2. **Sin Oneclick activo en el tenant → BLOQUEAR** el alta de suscripciones
   (backend rechaza + UI lo explica y deshabilita). Se elimina el flujo simulado
   para suscripciones.
3. **Alta sin tarjetas** → el flujo lleva a inscribir tarjeta (redirect Transbank);
   al volver con inscripción exitosa, el **primer cobro se ejecuta automáticamente**
   y la suscripción queda activa, sin clic extra.
4. **Alta con tarjetas** → selector de tarjeta (preferida preseleccionada) + opción
   "agregar nueva tarjeta".
5. **Suscripción amarrada a una tarjeta** (nueva columna `inscripcion_id`); editable
   a otra tarjeta del usuario.
6. **Eliminar una tarjeta con suscripciones amarradas (activa/pausada) → se PERMITE
   pero CANCELA esas suscripciones**, con modal de confirmación que avisa el N.

## Scope / Out of scope

**In scope**
- `POST /suscripciones` ejecuta cobro Oneclick real antes de crear venta + suscripción.
- Amarre `suscripciones.inscripcion_id` + snapshot de tarjeta derivado server-side.
- Endpoint para cambiar la tarjeta de una suscripción.
- Cascada de cancelación al eliminar una tarjeta con suscripciones amarradas + conteo N.
- Bloqueo del alta sin Oneclick activo; se elimina el flujo simulado de suscripciones.
- Rework del drawer "Nueva suscripción": selector de tarjeta + agregar nueva + reanudar tras inscripción.

**Out of scope**
- Cron de cobro recurrente / renovación (plan aparte; requiere lock distribuido).
- Reembolso automático si el cobro sale bien pero falla la creación de venta/suscripción
  (ver Decisión abierta 1 — se opta por dejar la orden `pagada` reconciliable).
- Cambiar el flujo del carrito (la página `pasarela.vue` simulada sigue existiendo para el carrito).

## Backend

### 1. Esquema: amarrar suscripción a inscripción
- [ ] `suscripciones` → nueva columna `inscripcion_id uuid NULL` (nullable por filas
  legacy). Actualizar `backend/src/modules/suscripciones/entities/suscripcion.entity.ts`
  (`@Column({ name: 'inscripcion_id', type: 'uuid', nullable: true })`) y `startup-pos.sql`.
- [ ] Incluir `inscripcion_id` en los `SELECT`/mapeos de `findMias` y `findTodas`.

### 2. Enforzar ownership en la resolución para cobro (seguridad)
- [ ] Tighten en `inscripciones.service.ts`: cuando se pasan **ambos**
  (`inscripcionId` + `pagadorRef`), el `where` de `resolverParaCobro` debe incluir `pagadorRef` (AND).
- [ ] Añadir método `resolverMedioDeUsuario(tenantId, inscripcionId, pagadorRef)`
  que valida `{ inscripcionId, tenantId, pagadorRef, estado: 'activa' }`, carga su
  `PasarelaMedioPago` activo y devuelve `{ inscripcion, marca, ultimos4 }`.

### 3. Vincular la orden de pasarela a la venta creada
- [ ] Añadir `CobrosService.vincularVenta(tenantId, ordenId, ventaId)` que setea
  `venta_id` + `estado = 'conciliada'` (espejo del dispatcher de Webpay).

### 4. Resolver el método de pago contable server-side (reuso)
- [ ] Extraer `resolverMetodoCredito(tenantId)` en `MetodosPagoService` (misma heurística
  que `OnlineService.resolverMetodosTarjeta`). `OnlineService` lo adopta.

### 5. DTO de alta — limpiar
- [ ] `create-suscripcion.dto.ts`: nuevo contrato `{ itemId, diaMes?, diaSemana?, inscripcionId (UUID) }`.
  Eliminar `metodoPagoId`, `tarjeta` y `TarjetaSnapshotDto`.

### 6. `SuscripcionesService.crear` — cobro real
- [ ] Validar item + reglas de día (sin cambios).
- [ ] Validar Oneclick activo del tenant → si no, `BadRequestException`.
- [ ] Validar ownership + snapshot con `resolverMedioDeUsuario`.
- [ ] Calcular total + resolver `metodoPagoId` con `resolverMetodoCredito`.
- [ ] Cobro (fuera de tx): `cobrosService.cobrar(...'interno')`; `fallida`→error, 502→propaga.
- [ ] Si `pagada` → tx: venta + suscripción con `inscripcionId` + snapshot.
- [ ] Tras commit → `cobrosService.vincularVenta`.

### 7. Cambiar la tarjeta de una suscripción
- [ ] `PATCH /suscripciones/:id/tarjeta` body `{ inscripcionId }` + `cambiarTarjeta` en el service.

### 8. Cascada al eliminar una tarjeta (fachada `online`)
- [ ] `SuscripcionesService`: `contarPorInscripcion` + `cancelarPorInscripcion`.
- [ ] `MediosPagoOnlineService.listar` enriquece con `suscripcionesActivas`.
- [ ] `MediosPagoOnlineService.eliminar`: cancela suscripciones amarradas, luego elimina en Transbank.

### 9. Return URL parametrizable de la inscripción
- [ ] `POST /online/medios-pago` body opcional `{ retornoPath?: 'medios-pago' | 'suscripciones' }`
  → URL whitelisteada.

### 10. Seed y docs
- [ ] Revisar `seeder.service.ts`. Docs vivas: `CLAUDE.md`, `tienda-online.md`, `pasarela-pagos.md`.

## Frontend

### 11. Rework del drawer "Nueva suscripción"
### 12. Limpiar el flujo simulado de suscripciones
### 13. Agregar tarjeta desde el alta + reanudar al volver (localStorage)
### 14. Editar tarjeta y ver tarjeta amarrada
### 15. Modal de cascada al eliminar tarjeta

## Verification
- Tests unitarios `suscripciones.service.spec.ts`; lint + test backend; build frontend.
- E2E manual con VISA `4051 8856 0044 6623`.

## Decisions / Open questions
1. Cobro OK pero falla creación de venta → orden queda `pagada` reconciliable (espejo Webpay).
2. Intención de alta en `localStorage`.
