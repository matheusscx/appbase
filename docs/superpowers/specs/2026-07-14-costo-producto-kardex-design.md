# Diseño — Costo por producto + congelado en kardex

**Status**: Done (implementado 2026-07-14)
**Date**: 2026-07-14
**Owner**: Cesar Matheus
**Cluster**: Recetas/costos food-service — **pieza 1 de 5** (ver
[análisis de alineamiento](./2026-07-14-alineamiento-cliente-foodservice-analisis.md))

## Context

El sistema no tiene noción de **costo** de un producto: `item_producto` guarda `stock`,
`unidad_medida`, fechas y `modo_inventario`, pero ningún costo; y `movimientos_inventario`
no congela ningún dato financiero. Sin costo no hay margen, ni merma valorizada, ni
simulador de impacto de costos. Es el cimiento no-negociable del cluster food-service y
además resuelve el punto 2.2 del análisis (kardex que congela el costo del momento).

Esta pieza aplica la regla transversal de [ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md):
capturar y congelar el hecho financiero en el momento de la transacción.

## Scope

**Incluido:**
- Columna `costo_actual` en `item_producto` (costo vigente, último costo).
- Columna `costo_unitario` en `movimientos_inventario` (costo congelado por movimiento).
- Captura del costo: al crear producto, en la entrada por compra, y por edición manual.
- Congelado del costo en cada movimiento (entrada y salida).
- Frontend: campo de costo en el form del item y en el ajuste de stock por compra;
  visualización del costo en lista e historial.

**NO incluido (piezas siguientes del cluster):**
- Motor de conversión de unidades (pieza 2).
- Recetas y criticidad de ingredientes (pieza 3).
- Módulo de merma valorizada (pieza 4).
- Simulador de impacto de costos + UI de márgenes (pieza 5).
- Costeo promedio ponderado o FIFO/por-lote (decisión: solo **último costo**).
- Conversión de moneda del costo para reportes (el costo vive en la moneda del item).

## Decisions

| Decisión | Elección | Razón |
|---|---|---|
| Método de costeo | **Último costo** (un solo `costo_actual` por producto) | Coincide con el modelo mental del cliente ("el nuevo costo del insumo"); sin motor de recálculo |
| Actualización del costo | **En la compra + edición manual** | La entrada por compra trae el costo pagado; la edición manual cubre carga inicial y correcciones |
| Snapshot en kardex | **Solo `costo_unitario`** | El precio de venta ya vive en `venta_detalle` (ligado por `venta_id`); no se duplica |
| Persistencia de `costo_actual` | **Columna materializada en `item_producto`** | Espeja el patrón de `stock`: kardex = verdad histórica, `item_producto` = saldo de lectura rápida |
| Moneda del costo | La **moneda del item** (`monedaId`) | Igual que `precioBase`; la conversión para reportes es trabajo posterior |

## Backend

### Modelo de datos

**`item_producto`** — nueva columna:

| Columna | Tipo | Notas |
|---|---|---|
| `costo_actual` | `NUMERIC(18,4)` NULL | Costo vigente en la moneda del item. Nullable = aún sin costo cargado. |

**`movimientos_inventario`** — nueva columna:

| Columna | Tipo | Notas |
|---|---|---|
| `costo_unitario` | `NUMERIC(18,4)` NULL | Costo congelado del momento. Nullable para movimientos históricos previos. |

Regla de congelado por movimiento:
- **Entrada con motivo `compra` y costo** → `costo_unitario` = costo ingresado; **además** sobrescribe `item_producto.costo_actual`.
- **Otras entradas con costo** → congelan `costo_unitario` en el kardex **sin** pisar `costo_actual`.
- **Salida (venta / merma / ajuste)** → `costo_unitario` = `costo_actual` vigente en ese instante (habilita utilidad histórica 2.2 y merma valorizada 4.1).
- **Entrada/salida por ajuste sin costo** → `costo_unitario` = `costo_actual` vigente (o NULL si no hay costo cargado).
- Costos presentes deben ser `> 0` (`BadRequest` si `<= 0`).
### Cambios de API

- `CreateItemDto` + `costo?: string` (`@IsNumberString @IsOptional`) — costo inicial del producto.
- `UpdateItemDto` + `costo?: string` — edición/corrección manual; actualiza `costo_actual`
  **sin generar movimiento** (es corrección de un valor vigente, no un movimiento de stock).
- `AjusteStockDto` + `costoUnitario?: string` — costo pagado en la entrada por compra.
- `InventarioService.registrarMovimiento(manager, params)` + param `costoUnitario?`:
  - si viene y `tipo === 'entrada' && motivo === 'compra'` → congela ese costo en el movimiento y actualiza `item_producto.costo_actual`;
  - si viene en otra entrada → congela en el movimiento **sin** actualizar `costo_actual`;
  - si no viene → congela el `costo_actual` vigente en el movimiento;
  - rechaza `costoUnitario <= 0` cuando está presente.
  - Todo dentro de la transacción existente (misma unidad atómica que stock + movimiento).
- Response DTOs (`MovimientoInventarioDto`, respuesta de items) exponen `costo_actual` / `costo_unitario`.

### Consideraciones

- `costo_actual` solo aplica a items `tipo = 'producto'` (donde existe `item_producto`).
- La edición manual del costo no crea movimiento: `costo_actual` es un valor vigente
  corregible; la inmutabilidad aplica a los movimientos ya registrados, no al valor actual.
- Precisión `NUMERIC(18,4)`, consistente con `stock` y `item_lote`.

## Frontend

- **Form de item** (`pages/configuracion/items.vue`): campo "Costo" (en la moneda del item),
  visible solo para `tipo = 'producto'`.
- **Modal de ajuste de stock**, entrada por compra: campo "Costo unitario".
- **Lista de items e historial de kardex**: mostrar `costo_actual` y el `costo_unitario`
  congelado por movimiento.
- Fuera de alcance aquí: badge de margen % y cualquier UI de márgenes (pieza 5).

## Verification

### Unit (`inventario.service.spec.ts`, `items.service.spec.ts`)
- Entrada por compra con costo → actualiza `costo_actual` y congela `costo_unitario`.
- Salida (venta/merma) → congela el `costo_actual` vigente en el movimiento.
- Edición manual del costo → actualiza `costo_actual` sin crear movimiento.
- Crear producto con costo inicial → `costo_actual` seteado.
- Producto sin costo cargado → `costo_actual` NULL, salidas congelan NULL sin romper.

### E2E (`inventario.e2e.spec.ts`)
1. Crear producto con costo inicial → verificar `costo_actual`.
2. Entrada por compra a nuevo costo → `costo_actual` actualizado + snapshot en el movimiento.
3. Editar costo a mano → `costo_actual` cambia, sin nuevo movimiento.
4. Vender → salida congela el `costo_actual` vigente en el movimiento.

### Manual
- Swagger: `POST /items` con costo, `PATCH /items/:id/stock` con `costoUnitario`, `PATCH /items/:id` con costo.
- Frontend: crear producto con costo → comprar a otro costo → ver `costo_actual` e historial.
