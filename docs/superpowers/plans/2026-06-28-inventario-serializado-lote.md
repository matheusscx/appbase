# Plan: Inventario serializado y por lote

**Status**: Done  
**Date**: 2026-06-28  
**Owner**: Cesar Matheus

## Context

Hoy `item_producto.stock` es un único número (inventario fungible) y `movimientos_inventario`
es el kardex que lo mueve. Esto no permite rastrear productos donde **cada unidad es única**
(celulares por IMEI/serie) ni productos por **lote** con vencimiento (farmacia/alimentos).

Se agrega un eje `modo_inventario` por producto con tres modos: `cantidad` (actual, sin cambios),
`lote` y `serie`. El stock materializado se mantiene como saldo de lectura rápida en los tres
modos, pero su fuente de verdad cambia según el modo. Diseño acordado en brainstorming
(serie+lote combinables, kardex agregado + detalle, estados disponible/reservado/vendido/baja).

## Scope / Out of scope

**In scope:**
- Columna `modo_inventario` en `item_producto` + 3 tablas nuevas (`item_lote`, `item_unidad`, `movimiento_inventario_detalle`).
- Lógica de movimientos por modo (entrada/salida) reusando el patrón transaccional `registrarMovimiento`.
- Carga de series (lista manual, una por unidad) y de lotes en entradas.
- Endpoints de lectura de unidades/lotes por producto.
- Frontend: selector de modo en el form de producto, captura de series/lote, modales para ver unidades/lotes y ajustar stock por modo.
- Seeder con un producto serie y uno por lote. Tests de servicio. Docs vivas.

**Out of scope (fase futura):**
- Estado `reservado` lo *produce* el módulo de ventas (aún no existe); el modelo lo soporta pero no hay productor hoy.
- Costeo/valoración de stock → sin `costo_unitario`.
- Pegado masivo/CSV de series (solo lista manual en esta fase).
- FEFO automático en salida de lotes (el usuario elige lote).
- Bodegas/traspasos.

## Regla central — `modo_inventario`

| Modo | Fuente de verdad del stock | `item_producto.stock` materializado |
|---|---|---|
| `cantidad` | el número mismo | igual que hoy (+/− cantidad) |
| `lote` | suma de `item_lote.cantidad_disponible` | recalculado = esa suma |
| `serie` | conteo de `item_unidad` en estado `disponible` | recalculado = ese conteo |

## Backend

### 1. Esquema y entidades
- [x] `startup-pos.sql`: columna `modo_inventario` + tablas `item_lote`, `item_unidad`, `movimiento_inventario_detalle`.
- [x] `item-producto.entity.ts`: campo `modoInventario`.
- [x] Nuevas entities: `item-lote.entity.ts`, `item-unidad.entity.ts`, `movimiento-inventario-detalle.entity.ts`.
- [x] Registrar en `app.module.ts`, `items.module.ts`, `inventario.module.ts`.

### 2. `inventario.service.ts`
- [x] Extender `RegistrarMovimientoParams` con `series`, `unidadIds`, `lote`, `loteId`.
- [x] Dispatcher por `modo_inventario` → helpers `moverCantidad`, `moverSerie`, `moverLote`.
- [x] `recalcularStockSerie` / `recalcularStockLote`.
- [x] `insertarDetalleMovimiento` (ligar a `movimiento_inventario_detalle`).

### 3. DTOs + `items.service.ts` + controller
- [x] `CreateItemDto` / `UpdateItemDto`: campo `modoInventario` + `series` + `lote`.
- [x] `AjusteStockDto`: campos `series`, `unidadIds`, `lote`, `loteId`.
- [x] `create()`: carga inicial por modo.
- [x] `update()`: bloqueo de cambio de modo si hay movimientos.
- [x] `ajustarStock()`: paso de nuevos campos.
- [x] `GET /items/:id/unidades` y `GET /items/:id/lotes`.

### 4. Seeder
- [x] iPhone 15 (modo serie, 3 IMEIs fijos).
- [x] Paracetamol (modo lote, 1 lote con vencimiento).

### 5. Tests
- [x] `inventario.service.spec.ts`: 13 tests por modo.
- [x] `items.service.spec.ts`: tests create por modo, bloqueo de cambio.
- [x] 135/135 tests en verde, 0 errores lint nuevos.

## Frontend

### `app/pages/configuracion/items.vue`
- [x] Selector `modoInventario` en form de creación.
- [x] Lista inline de series en modo `serie` (agregar/eliminar filas).
- [x] Campos de lote inicial en modo `lote`.
- [x] Modal ajuste de stock adaptado: UI diferente por modo + ajusteForm ampliado.
- [x] Modal "Ver unidades / lotes" nuevo (botón en lista para productos serie/lote).
- [x] Badge de modo en la lista de items.

## Docs vivas
- [x] `startup-pos.sql` (DDL).
- [x] `docs/features/inventario-serializado.md`.
- [x] `docs/adr/007-inventario-serie-lote.md` + índice `docs/adr/README.md`.
- [x] `docs/README.md`: link nuevo feature + ADR-007.
- [x] `CLAUDE.md`: tabla estado + sección inventario actualizada.
- [x] `docs/superpowers/plans/2026-06-28-inventario-serializado-lote.md` (este archivo).

## Verification
- Tests: 135/135 ✓ — `npm test -- --no-coverage`
- Lint: 0 errores nuevos — `npm run lint` (2 errores pre-existentes en descuentos/recargos spec)
- Frontend: `vue-tsc --noEmit` sin errores

## Decisions

- Modo `serie` admite `lote_id` como metadato en `item_unidad` (vencimiento/garantía/recall) pero el conteo de stock viene del estado de la unidad, no de la cantidad del lote (anti-doble-conteo). Ver [ADR-007](../../adr/007-inventario-serie-lote.md).
- Estados unidad: `disponible / reservado / vendido / baja`; `reservado` queda para ventas (futuro).
- Atributos de unidad: `condicion` + `garantia_hasta` (sin costo en esta fase).
- `modo_inventario` es inmutable una vez que el producto tiene movimientos.
