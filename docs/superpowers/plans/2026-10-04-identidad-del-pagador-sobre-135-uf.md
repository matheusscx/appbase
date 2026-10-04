# Plan: una boleta de más de 135 UF lleva el nombre y el RUT de quien paga

- **Status:** Done
- **Date:** 2026-10-04
- **Owner:** sesión del frente fiscal (decisiones en `pendientes.md` § 6)
- **Spec:** [`2026-10-04-identidad-del-pagador-sobre-135-uf-design.md`](../specs/2026-10-04-identidad-del-pagador-sobre-135-uf-design.md)

## Context

Frente fiscal propio. La Res. Ex. SII 44/2025 exige nombre y RUT de quien paga en una boleta de
más de 135 UF. Hoy el sistema documenta esa venta sin identidad (medido con e2e).

## Scope / Out of scope

Dentro: tabla del umbral + seed, regla en la creación de la venta, chequeo antes del cobro en
online y suscripción, `umbralIdentidad` en `GET /tipos-documento`, POS, salones y aviso del voucher.
Fuera: RUT en la tienda online, export del registro interno, código `MedioPago` del SII.

## Backend

- [x] 1. Entity `UmbralIdentidadPagador` (`ventas/entities`), registrada en `app.module.ts`
  (`entities`) y `seeder.module.ts`; seed Chile 2025 y 2026 (IDs 456 y 457) con la fuente.
- [x] 2. e2e `boleta-sobre-umbral` en rojo: 400 sin cliente (voucher y efectivo), sin RUT, RUT
  inválido, pendiente, dos pagos que pasan solo sumados; 201 con nombre + RUT (y el voucher sigue
  `maquina`); 201 un peso por debajo; 201 sobre el umbral con Factura; `GET /tipos-documento`
  devuelve el umbral 2026 en la boleta y `null` en la Factura.
- [x] 3. `resolverTipoDocumento` trae el umbral (subconsulta en la misma lectura);
  `crearEnTransaccion` exige la identidad tras calcular el total. Unit tests.
- [x] 4. `exigirCompraOnlineBajoUmbral(tenantId, total)` público + chequeo en `OnlineService.pagar` (las dos
  ramas) y en `SuscripcionesService` antes de cobrar. Unit tests de que no se cobra.
- [x] 5. `findTiposDocumento` devuelve `umbralIdentidad`.

## Frontend

- [x] 6. `useReceptor.ts`: `sobreUmbralIdentidad(total, umbral)` y la regla de identidad en
  `problemaDelReceptor`; specs.
- [x] 7. POS: `CarritoPanel` y `pos.vue` tratan el cliente como requerido sobre el umbral; el
  formulario marca el RUT obligatorio.
- [x] 8. `CobroModal`: aviso del voucher (prop) y formulario mínimo de quien paga (prop + modelo)
  para salones; `salones/index.vue` lo usa y manda `customer` al cerrar.
- [x] 9. Specs de componentes y páginas.

## Verification

- [x] Gate entero de `CLAUDE.md` (backend + frontend), Playwright entero (`entorno.sh stack`).
- [x] Arranque medido sobre una base sembrada por main.
- [x] Mutantes: sin el chequeo en `crearEnTransaccion`; sin el de online; `anio =` en vez de
  `anio <=`; `gte` en vez de `gt`; los tres del frontend (detalle en `resueltos.md`).
- [x] Docs: PRODUCTO § 10, ADR-028, ventas.md, impuestos.md, ESTADO.md, resueltos.md.

## Decisions / Open questions

Todas decididas (ver la entrada). Nueva entrada en pendientes: RUT en la tienda online y en la
suscripción; export del registro interno.
