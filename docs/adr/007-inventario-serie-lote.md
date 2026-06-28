# ADR-007: Modelo de inventario serializado y por lote — eje `modo_inventario`

**Status**: Accepted

**Date**: 2026-06-28

## Context

`item_producto.stock` era un único número fungible (modo `cantidad`). No permite:
- Rastrear unidades individuales con identidad propia (celulares por IMEI/serie).
- Gestionar lotes con fecha de vencimiento (farmacia, alimentos) donde la cantidad tiene trazabilidad.

Se necesita un mecanismo que soporte los tres casos sin romper el modelo existente.

## Decision

Se agrega el eje `modo_inventario TEXT NOT NULL DEFAULT 'cantidad'` en `item_producto`
con tres valores mutuamente excluyentes:

| Modo | Tabla de detalle | Fuente de verdad de `stock` |
|---|---|---|
| `cantidad` | — | el número mismo (comportamiento anterior) |
| `serie` | `item_unidad` | `COUNT(*) WHERE estado = 'disponible'` |
| `lote` | `item_lote` | `SUM(cantidad_disponible)` |

### Regla anti-doble-conteo
En modo `serie` un `item_unidad` puede referenciar un `lote_id` como **metadato** (vencimiento/garantía/recall),
pero `item_lote.cantidad_disponible` no se usa para el saldo — solo `item_unidad.estado = 'disponible'` cuenta.
Los lotes con cantidad solo existen en modo `lote`.

### Tabla `movimiento_inventario_detalle`
El kardex (`movimientos_inventario`) mantiene la cantidad agregada como hoy.
Se agrega `movimiento_inventario_detalle` para ligar cada movimiento a las unidades o lote afectados,
habilitando trazabilidad completa sin romper las queries de resumen existentes.

### Bloqueo de cambio de modo
`modo_inventario` queda inmutable una vez que el producto tiene movimientos. El backend
rechaza cambios en `PATCH /items/:id` si hay filas en `movimientos_inventario` para ese item.

### Estados de unidad
`item_unidad.estado`: `disponible | reservado | vendido | baja`.
`reservado` es producido por el módulo de ventas (futuro). `vendido`/`baja` se asignan en salidas según motivo.

## Consequences

### Positive
- Inventario serializado y por lote coexisten con el modo cantidad sin cambios de breaking.
- `item_producto.stock` sigue siendo el saldo de lectura rápida en los tres modos; las queries de lista no cambian.
- Trazabilidad completa: se puede saber exactamente qué unidad/lote salió en cada movimiento.
- El modelo soporta el estado `reservado` para ventas pendientes sin implementarlo hoy.

### Negative
- Tres rutas de código en `registrarMovimiento`; la lógica crece en complejidad.
- Un cambio de modo requiere reset completo (vaciado de stock y movimientos) — no hay migración automática.
- Modo `lote` con salidas: el usuario debe elegir el lote manualmente (FEFO automático es trabajo futuro).

### Neutral
- `item_lote.cantidad_disponible` en modo `lote` y `item_unidad` en modo `serie` deben mantenerse consistentes
  con `item_producto.stock` dentro de la misma transacción. El helper `recalcularStock*` lo asegura.
