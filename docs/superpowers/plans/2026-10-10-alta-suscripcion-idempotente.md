# Plan: el alta de suscripción cobra una vez por intento

**Status**: Done · **Date**: 2026-10-10 · **Owner**: frente lanzado por la orquestadora
Spec: [`2026-10-10-alta-suscripcion-idempotente-design.md`](../specs/2026-10-10-alta-suscripcion-idempotente-design.md)

## Context

Decisión del owner, 2026-10-09: la forma de ADR-029, con el reclamo y la orden commiteados antes
de cobrar. El e2e de la medición (`12097cfa`) se invierte en el mismo commit.

## Scope / Out of scope

Entra: backend (suscripciones, cobros, idempotencia, cron) y la cabecera en la pantalla de la
tienda. Queda afuera: el gemelo de la API de pasarela, lo fiscal y el marcado manual (ver spec).

## Backend

- [x] E2E primero (rojo): `suscripcion-alta-doble.e2e-spec.ts` reescrito. El proveedor es un doble
      (`ProviderFactory`), y también lo son `InscripcionesService` y `TenantPasarelaService`. La
      orden, la AUTHORIZATION, la venta y la suscripción son reales. Casos:
      - control;
      - misma clave dos veces (1/1/1, `repetida`);
      - dos a la vez;
      - 400 sin cabecera;
      - 422 con otros datos;
      - rechazo, que suelta la clave;
      - 502 + consulta `pagada` / `fallida` / desconocida;
      - el proceso cae después de cobrar (error no de comunicación), y el cron no expira esa orden.
- [x] `pasarela_orden.solicitud_idempotente_id` (entity + `startup-pos.sql`).
- [x] `ProviderTokenizado.autorizarCobro` con `timeoutMs?`. Oneclick lo pasa a `request`.
- [x] `CobrosService`: `prepararCobro`, `efectuarCobro`, `anotarCobroSinConfirmar`,
      `aclararCobro`. `cobrar` no cambia.
- [x] Cron `expirar-ordenes` y expiración perezosa: no expiran una orden con
      `solicitud_idempotente_id`.
- [x] `huella.ts`: `'suscripcion.alta'`.
- [x] `SuscripcionesService.crear(…, clave)` con `ejecutarConEfectoExterno`. Controller con
      `@ClaveIdempotencia()` + `@ApiHeader`. Módulo con `IdempotenciaModule`.
- [x] Unit: `suscripciones.service.spec.ts` y `cobros.service.spec.ts` al día.

## Frontend

- [x] `useSuscripciones.crear` con la cabecera. La página termina el intento con éxito o con
      422 y avisa si viene `repetida`. El 422 cierra el drawer y recarga la lista.
- [x] Spec de la página al día (cabecera, `repetida`, 422).

## Docs

- [x] ADR-029: alcance ampliado al alta (sección nueva) + ADR-026 Consequences. Índice si
      cambia el título.
- [x] `docs/features/` de suscripciones; `docs/patterns/backend.md` §18 (el alta ya no es
      "llamador interno sin clave").
- [x] `pendientes.md`: mudar la entrada a `resueltos.md`, la ventana de deploy suma el alta, y
      va una entrada nueva para el marcado manual.
- [x] `ESTADO.md` si cambia una fila.

## Verification

Gate completo de `CLAUDE.md`, `verify-feature` con la revisión independiente y
`api-security-reviewer`, y Playwright entero (con turno de la orquestadora).

## Decisions / Open questions

- **El precio del plan cambió entre el cobro y el reintento que termina el alta**: la venta
  recalcula y no cuadraría con lo cobrado. Se frena con un 409 y un log, y la orden sigue
  sin aclarar. Es un caso borde de un caso borde y se reporta a la orquestadora.
