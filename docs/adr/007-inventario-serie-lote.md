# ADR-007: Modelo de inventario serializado y por lote — eje `modo_inventario`

**Status**: Accepted. Dos afirmaciones sobre `item_producto.stock` (Consequences,
la de Positive «sigue siendo el saldo de lectura rápida» y la de Neutral sobre mantenerlo
consistente) quedaron superadas — ver nota bajo Date.

**Date**: 2026-06-28

> ⚠️ **`item_producto.stock` ya no existe, desde el frente "bodegas y traslados"
> (2026-09-06).** Este ADR se escribió cuando el saldo vivía en esa columna; hoy
> vive en `stock_ubicacion` (una fila por ubicación), único dueño del saldo. Las
> menciones a `item_producto.stock` más abajo describen el estado en la fecha de
> este ADR, no el actual. Detalle: `docs/features/bodegas-y-traslados.md`.

> ⚠️ **La salida de modo serie siempre nombra sus unidades (2026-10-03).** La unidad que sale ya
> no la elige el sistema: **la elige quien vende**, y `moverSerie` no auto-selecciona (sin
> `unidadIds` responde 400). Cada salida de un producto con serie trae las unidades que se llevó,
> y el kardex las liga por `movimiento_inventario_detalle` sin ambigüedad.
> **`reservado` sigue sin productor, a propósito.** Lo que una cuenta de salón abierta ya pidió
> queda *apartado*, pero se **deriva** de la línea de la cuenta (`cuenta_lineas.unidad_ids`) y la
> unidad sigue `disponible`: pasarla a `reservado` movería el saldo (`COUNT(disponible)`) sin un
> movimiento en el kardex, y el kardex es la fuente de verdad auditable. Cuando la cuenta deja de
> estar abierta la unidad se libera sola, sin código de liberación. Detalle y decisiones:
> [`inventario-serializado.md`](../features/inventario-serializado.md#quién-elige-qué-unidad-con-serie-sale).

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

*Actualización 2026-10-03:* el `lote_id` de una unidad tiene que ser un lote **vivo del mismo ítem y
del mismo tenant**; la entrada en modo serie (`moverSerie`) lo valida y responde 400 si no lo es
(`item_unidad.lote_id` no tiene FK). Hoy **nadie crea lotes de metadato en modo serie** —`item_lote`
solo nace en `moverLote`, que es de modo `lote`, y el modo es inmutable con movimientos—, así que
**toda entrada serie con `loteId` da 400 hasta que exista ese productor**. No es un bug: el campo
quedó adelantado al productor. Detalle: [`resueltos.md`](../agent/resueltos.md).

### Tabla `movimiento_inventario_detalle`
El kardex (`movimientos_inventario`) mantiene la cantidad agregada como hoy.
Se agrega `movimiento_inventario_detalle` para ligar cada movimiento a las unidades o lote afectados,
habilitando trazabilidad completa sin romper las queries de resumen existentes.

### Bloqueo de cambio de modo
`modo_inventario` queda inmutable una vez que el producto tiene movimientos. El backend
rechaza cambios en `PATCH /items/:id` si hay filas en `movimientos_inventario` para ese item.

### Estados de unidad
`item_unidad.estado`: `disponible | reservado | vendido | baja`.
`reservado` estaba pensado para el módulo de ventas, pero **no tiene productor** (ver la nota bajo Date). `vendido`/`baja` se asignan en salidas según motivo.

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
  *Actualización 2026-10-03:* ya no — sin lote elegido sale el que vence antes y la venta salta los
  vencidos ([`inventario-serializado.md`](../features/inventario-serializado.md#qué-lote-sale)).

### Neutral
- `item_lote.cantidad_disponible` en modo `lote` y `item_unidad` en modo `serie` deben mantenerse consistentes
  con `item_producto.stock` dentro de la misma transacción. El helper `recalcularStock*` lo asegura.
