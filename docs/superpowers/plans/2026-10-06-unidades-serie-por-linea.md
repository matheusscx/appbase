# Plan: las unidades con serie del detalle de venta, por línea

**Status**: Done
**Date**: 2026-10-06
**Owner**: Cesar Matheus

## Context

Entrada de `docs/agent/pendientes.md` § 2: con dos líneas del mismo producto con serie (salón,
el precio subió entre pedidos), `GET /ventas/:id` pone todas las unidades del ítem bajo cada
línea.

**Medido** (e2e nuevo en `test/salon-serie.e2e-spec.ts`): reproduce — la línea de $10.000
trae el usado y el nuevo. En la base, cada salida ya trae su `venta_detalle_id` y la unidad
correcta (lo escribe `crearEnTransaccion` desde el 2026-10-04, frente de la nota de crédito). La
lectura (`findOne`) agrupa por `item_id` y no lo usa.

## Scope

- Solo lectura: la consulta de unidades del detalle trae `m.venta_detalle_id` y el armado
  las asigna por línea. Sin rama para una salida sin línea: no se alcanza por la API (toda salida
  con serie la escribe `crearEnTransaccion`) y no hay ventas anteriores a la columna.
- Una sola consulta por venta, igual que hoy (sin N+1); sin JOIN nuevo.

## Out of scope

- Escribir en `movimientos_inventario` o en `venta_detalles`: no hace falta, el dato existe.
- Frontend: la forma de `unidades` por línea no cambia; el drawer ya pinta la de su fila.

Consumidores de `detalles[].unidades`: solo `VentaDetalleDrawer.vue`. La nota de crédito, la
boleta impresa y el ticket no lo leen (el `unidades` de `ticket-builder.ts` es otra cosa: la
cantidad de un extra).

## Tasks

- [x] e2e que reproduce (rojo medido).
- [x] `ventas.service.ts` `findOne`: unidades por `venta_detalle_id`.
- [x] Mutante: volver a agrupar por ítem → el e2e nuevo rojo.
- [x] Docs: `inventario-serializado.md` § Qué se ve; entrada a `resueltos.md`.
- [x] Gate completo + verify-feature.
