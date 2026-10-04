# Plan: la nota de crédito pregunta si lo devuelto se recupera o se pierde

**Status**: Done
**Date**: 2026-10-04
**Owner**: Cesar Matheus
**Spec**: [`2026-10-04-nc-recupera-o-pierde-design.md`](../specs/2026-10-04-nc-recupera-o-pierde-design.md)

## Context

Entrada de `pendientes.md` § 3. Decidido por el owner: la NC pregunta siempre que haya stock;
recupera → repone; pierde → merma con la causa fija "Devolución". Frente fiscal: va solo.

## Scope / Out of scope

Dentro: kardex ligado a la línea, la NC manual y la de la pasarela, la causa fija, el detalle, los
dos modales. Fuera: serie/lote automáticos, "Generar nota", `cancelar`.

## Backend

- [x] **T1. Causa fija "Devolución".** `motivo_baja.es_devolucion` (default false, único vivo por
  tenant vía `@Index` parcial). `MOTIVOS_BAJA_FIJOS` gana la fila (con la marca); alta de tenant y
  seeder (470/471) la siembran. `MotivosBajaService.asegurarDevolucion(tenantId)`
  (find-or-create; un "Devolución" propio nunca se adopta). `POST /mermas` la rechaza; el listado
  de motivos expone `esDevolucion`. Unit + e2e.
- [x] **T2. Kardex ligado a la línea.** `movimientos_inventario.venta_detalle_id` (nullable);
  `RegistrarMovimientoParams.ventaDetalleId`; `ContextoConsumo` rama venta con `ventaDetalleId`;
  `crearEnTransaccion` lo pasa en el paso 7f. Unit (el INSERT lo lleva; la expansión lo hereda).
- [x] **T3. Lector único.** `VentasService.salidasPorItemVendido(ventaId)` + reparto puro
  (`cantidadADevolver`, en `nota-credito-composicion.ts`) con unit de la serie exacta.
- [x] **T4. La NC.** DTOs (`stock: 'recupera' | 'pierde'`, sin `reponerStock`), huella,
  `validarDevolucionesReembolso` (obligatorio/prohibido, recuperable), paso 9 de
  `crearNotaCreditoEnTransaccion` (recupera / pierde por ítem movido, ordenado);
  `unidadesComprometidasPorItem` excluye filas cuyo ítem no es el vendido. Unit + e2e.
- [x] **T5. Pasarela.** `DevolucionLineaDto.stock`; huella; `ReembolsoCallbackHandler.validarDevoluciones`
  llamado en `preparar` (tx0) antes del proveedor; evento y hook con `stock`. Unit + e2e.
- [x] **T6. Detalle.** `GET /ventas/:id` → `detalles[].devolucionStock`. e2e.

## Frontend

- [x] **T7.** `useDevolucionInventario` (fila con `devolucionStock` y `stock`, payload con `stock`,
  válida solo con todas las preguntas contestadas), `DevolucionInventarioLista` (la pregunta por
  fila: *Vuelve al stock* / *Se perdió*, sin default; recupera deshabilitada en `solo_perdida`),
  `NotaCreditoModal` y `ReembolsoModal`. Mermas no ofrece *Devolución*. Specs Vitest.
- [x] **T8.** Playwright: NC de una receta que vuelve al stock y de un producto que se perdió;
  reembolso con la pregunta.

## Verification

- [x] Arranque sobre base sembrada por `main` (synchronize con las dos columnas).
- [x] Gate completo de `CLAUDE.md` (test:e2e completo, frontend npm test entero y Playwright entero, con turno de la orquestadora).
- [x] Mutantes que reviertan al código anterior (tabla en `resueltos.md`).
- [ ] `verify-feature` con su recibo.
- [x] Docs: `reembolsos-nota-credito.md`, `ventas.md`, `mermas-valorizadas.md`,
  `inventario-kardex.md`, `inventario-serializado.md`, `PRODUCTO.md`, `ESTADO.md`,
  `startup-pos.sql`, entrada a `resueltos.md`.

## Decisions / Open questions

Ver spec § 4: siete propuestas consultadas a la Sesión de esfuerzo máximo.
