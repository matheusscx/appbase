# Plan: la Factura exige los datos tributarios del receptor

**Status:** Done · **Date:** 2026-10-03 · **Owner:** Cesar Matheus

**Spec:** [`2026-10-03-receptor-de-factura-design.md`](../specs/2026-10-03-receptor-de-factura-design.md).

## Context

Frente fiscal que estaba en `pendientes.md` § 6 (cerrado en `resueltos.md`). Decisiones en el
bloque "Cómo arrancarlo" de la entrada.

## Scope / Out of scope

Dentro: receptor de la venta (BD, DTO, servicio, detalle), terceros (giro y comuna), POS
(formulario, cobro). Fuera: § 4 de la spec.

## Backend

- [x] `common/utils/rut.util.ts` + spec: `normalizarRut` (movido) y `rutValido` (rango + DV).
      `lectura-dte.service.ts` lo importa.
- [x] `VentaCustomer` y `Tercero`: `giro varchar(40)`, `comuna varchar(20)`; `startup-pos.sql`.
- [x] `CustomerVentaDto`: `giro`, `comuna`, `@MaxLength` (100/40/70/20). DTOs de terceros:
      `giro`, `comuna` con largo.
- [x] `resolverTipoDocumento`: lee `codigo_iso` (LEFT JOIN al tipo, así hay país aunque no haya
      tipo), valida el receptor según el país y devuelve el customer normalizado; el INSERT de
      `venta_customer` usa ese customer y guarda `giro`/`comuna`.
- [x] `findTiposDocumento`: `receptorCompleto`, `rutChileno`.
- [x] `findOne`: `giro`, `comuna` en `customer`.
- [x] e2e: Factura incompleta → 400 por cada campo; RUT con DV malo → 400 (Factura y boleta);
      completa → 201 con RUT normalizado, giro y comuna congelados; giro de 41 → 400; tipos
      exponen los flags; terceros guardan giro/comuna. Actualizar las e2e que crean Facturas.

## Frontend

- [x] `composables/useReceptor.ts` + spec (mismos casos de RUT que el backend).
- [x] `ClienteForm`: giro y comuna con `maxlength` y contador; obligatorios si `receptorCompleto`;
      RUT inválido avisado si `rutChileno`; precarga giro/comuna del tercero.
- [x] `puedeCobrar` y `confirmarCobro` (POS): misma regla; body manda `giro`/`comuna`.
- [x] `CarritoPanel`/`ClienteDrawer`: pasan los flags del tipo elegido.
- [x] `terceros.vue`: giro y comuna.

## Verification

Gate entero de `CLAUDE.md` + Playwright de una Factura en el POS + revisión independiente
(`verify-feature`).

## Decisions / Open questions

Todas tomadas (pendientes § 6, "Cómo arrancarlo").
