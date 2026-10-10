# Plan: la orden pagada sin venta avisa, y la venta online no lleva vuelto

**Status**: Done · **Date**: 2026-10-10 · **Owner**: frente lanzado por la orquestadora
Spec: [`2026-10-10-tienda-pagada-sin-venta-design.md`](../specs/2026-10-10-tienda-pagada-sin-venta-design.md)

## Context

Opciones D y E de la entrada "La tienda calcula el total dos veces…" (owner, 2026-10-09). La
orquestadora eligió el aviso al admin el 2026-10-10: la opción 1, bandeja + tarjeta de Inicio.

## Scope / Out of scope

**Entra:**
- backend: ventas (el chequeo online), pasarela (dispatcher, redirect, listado admin) y online
  (resultado);
- frontend: `retorno.vue`, `/ordenes`, el drawer y la tarjeta de Inicio.

**Afuera:** la A, el mail, el motor, lo fiscal y `PagosService`.

## Backend

- [x] E2E primero, en rojo: invertir `tienda-dos-ahoras.e2e-spec.ts`. Los cambios:
      - `afirmarCargoSinVenta` afirma el estado propio, el motivo y el listado admin;
      - el caso de `permite_vuelto` pasa a ser un cargo sin venta;
      - el rol con solo `Pasarelas:Leer` lee, y uno con solo `Crear` recibe 403.
- [x] Columna `motivo_sin_venta`: en la entity (`type: 'text'`) y en `startup-pos.sql`.
- [x] `CallbackDispatcherService.dispatchInterno`: en el catch guarda el motivo legible. Unit test
      con `HttpException` y con un error genérico.
- [x] `PagosRedirectService`:
      - `urlRetornoApp` con `pagada_sin_venta`;
      - `obtenerResultado` con el estado derivado.
      Va con su unit test.
- [x] `QueryOrdenesDto.sinVenta` y el filtro en `listarOrdenes`. `motivoSinVenta` va en la fila y
      en `obtenerOrden` (solo con `vistaAdmin`).
- [x] E: `ventas.service.ts`. En el canal online lo pagado tiene que ser igual al total, con un
      mensaje por cada lado. Va con su unit test.

## Frontend

- [x] `retorno.vue`: vista `sin_venta`, con su spec.
- [x] `/ordenes`: badge, opción de filtro y `?sinVenta=true`.
- [x] `OrdenDetalleDrawer`: `UAlert` con el motivo.
- [x] `InicioPagosSinVenta.vue` montada en `index.vue`, con su spec.

## Docs

- [x] `tienda-online.md`, `pasarela-pagos.md` si nombra los estados del retorno, y `ESTADO.md`.
- [x] `pendientes.md`: D y E hechas, con su commit, y la A abierta. `resueltos.md`: lo cerrado.

## Verification

- [x] Gate de backend y de frontend completos. `test:e2e` entero, con turno.
- [x] Playwright entero, con turno. Mirar RestartCount y OOMKilled antes y después.
- [x] `verify-feature`: revisión independiente con dudas concretas, `api-security-reviewer`
      (cambian el DTO y el controller admin) y el recibo.

## Decisions / Open questions

- E rompió cuatro e2e ajenos (`papelera`, `liquidacion-propinas`, `boleta-reimpresion` y
  `concurrencia-pool`). Vendían `canal: 'online'` como atajo para no abrir caja, y pagaban de
  más en efectivo. Ahora pagan el total exacto con `test/helpers/venta-online.ts`.
- La revisión encontró dos cosas que quedan para el owner en `pendientes.md` § 4: `verificar`
  resuelve una orden sin aviso, y la marca no se apaga si la venta se registra a mano.
- No hay estado nuevo de orden: "pagada sin venta" se deriva de `pagada` + el motivo.
- La tarjeta reusa el listado: no hay endpoint nuevo.
