# Feature: Recetas + criticidad de ingredientes

**Status**: Complete  
**Owner**: SDD Team  
**Last Updated**: 2026-07-15

---

## Overview

### What is it?

Un item `tipo='receta'` representa un producto compuesto (ej. "Hamburguesa Clásica") que se vende como cualquier item del catálogo, pero al cobrarse descuenta stock de sus **ingredientes** en vez de tener stock propio. Cada ingrediente declara cantidad, unidad y si es **bloqueante**: sin stock de un bloqueante la venta aborta; un no bloqueante sin stock se omite y la venta sigue con una advertencia.

### Why does it exist?

Food-service vende composiciones (hamburguesa = pan + carne + queso). Sin recetas, o se inventa un stock ficticio del plato o se descuenta a mano. Esta pieza cierra el hueco del cluster food-service (pieza 3 de 5) reutilizando costo por producto y conversión de unidades.

### Scope

**Included:**
- `items.tipo = 'receta'` + extensión `item_receta` (`costo_actual` cacheado) + `receta_ingredientes` (N ingredientes, soft delete).
- Alta/edición con validación (solo items `tipo='ingrediente'` con `modo_inventario='cantidad'`, cantidad > 0, unidad convertible).
- Venta: expansión a un `salida`/`venta` por ingrediente vía `ItemsService.venderIngredientesReceta`; respuesta con `advertenciasReceta`.
- `disponible` calculado al vuelo en el listado (mínimo entre bloqueantes).
- Bloqueo de soft-delete de un producto usado como ingrediente vivo.
- UI: editor de ingredientes en Configuración → Items; POS lista recetas con disponibilidad y toasts de advertencia.
- Seed demo "Hamburguesa Clásica" (IDs 0256–0265).

**NOT included (future):**
- Recetas anidadas; ingredientes serie/lote.
- Auto-recálculo silencioso de costo (ver [simulador-impacto-costos.md](./simulador-impacto-costos.md)).
- Condiciones / variantes de receta.

---

## Modelo de datos

### `item_receta` (1:1 con `items` tipo receta)

| Column | Type | Notes |
|--------|------|-------|
| `item_id` | UUID PK/FK → items | |
| `costo_actual` | NUMERIC(18,4) | Cacheado al crear/editar; no se recalcula solo |

### `receta_ingredientes`

| Column | Type | Notes |
|--------|------|-------|
| `receta_ingrediente_id` | UUID PK | |
| `tenant_id` | UUID | Del token |
| `receta_item_id` | UUID | Item tipo `receta` |
| `ingrediente_item_id` | UUID | Siempre `tipo='ingrediente'` + `modo_inventario='cantidad'` |
| `cantidad` | NUMERIC(18,4) | Por 1 unidad de receta; debe ser > 0 |
| `unidad_codigo` | TEXT FK → unidades_medida | Puede diferir de la unidad base del ingrediente |
| `bloqueante` | BOOLEAN | Default `true` |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete al reemplazar lista |

Índice único parcial: `(receta_item_id, ingrediente_item_id) WHERE eliminado_el IS NULL`.

---

## API (extensiones sobre `/items` y `/ventas`)

### POST /items — `tipo: 'receta'`

```
POST /api/items
Authorization: Bearer <token>

Request:
{
  "nombre": "Hamburguesa Clásica",
  "precioBase": "3500",
  "monedaId": "<uuid>",
  "tipo": "receta",
  "ingredientes": [
    { "ingredienteItemId": "<pan>", "cantidad": "1", "unidadCodigo": "unidad", "bloqueante": true },
    { "ingredienteItemId": "<carne>", "cantidad": "150", "unidadCodigo": "g", "bloqueante": true },
    { "ingredienteItemId": "<queso>", "cantidad": "20", "unidadCodigo": "g", "bloqueante": false }
  ]
}

Response (201): { "id": "<uuid>" }
```

Costo = Σ (costo_actual del ingrediente × cantidad convertida a su unidad base), Decimal.js, 4 decimales.

### PATCH /items/:id

Con `ingredientes` (reemplazo total): soft-delete de filas vivas + insert de la nueva lista + update de `item_receta.costo_actual`. Lista vacía → `400`.

### GET /items?tipo=receta

Cada item incluye `disponible: number | null` — mínimo de `floor(stock / cantidadBase)` entre ingredientes **bloqueantes**; `null` si no hay bloqueantes. Productos/servicios/suscripciones llevan `disponible: null`.

### GET /items/:id

Si es receta, agrega `ingredientes: { ingredienteItemId, ingredienteNombre, cantidad, unidadCodigo, bloqueante }[]`. `costoActual` viene de `item_receta` (COALESCE en el query base).

### DELETE /items/:id

Si el item es ingrediente de alguna receta viva → `400` con los nombres de esas recetas.

### POST /ventas (línea con item tipo receta)

Por cada unidad vendida, un movimiento de salida por ingrediente (cantidad convertida). Bloqueante sin stock → error `'Stock insuficiente para la salida'` aborta la transacción. No bloqueante: se captura solo ese mensaje y se agrega a `advertenciasReceta` en la respuesta (sin pre-chequeo racey).

---

## Backend

- **Módulo**: `ItemsModule` (entidades `ItemReceta`, `RecetaIngrediente`; lógica en `ItemsService`).
- **Venta**: `VentasService.crearEnTransaccion` delega en `itemsService.venderIngredientesReceta` (sin dependencias nuevas en Ventas).
- **Conversión**: `CatalogService.convertirUnidad` (pieza 2).
- **Inventario**: `InventarioService.registrarMovimiento` (validación de salida no negativa sin cambios).

### Key methods

- `validarYCostearIngredientes` (privado) — create/update.
- `obtenerIngredientesReceta` / `venderIngredientesReceta` — venta.
- `calcularDisponibleReceta` (privado) — listado.

---

## Frontend

- `pages/configuracion/items.vue` — tipo Receta + editor de filas (ingrediente, cantidad, unidad por magnitud, bloqueante); selector de insumos vía `GET /items?tipo=ingrediente`; costo de solo lectura al editar.
- `pages/ventas/pos.vue` — fetch paralelo `tipo=producto` y `tipo=receta`; toasts `warning` por cada `advertenciasReceta`.
- `components/ventas/CatalogoGrid.vue` — receta nunca bloquea el click; se atenúa si `disponible === 0`; badge "Disponibles: N".
- `composables/useVenta.ts` — `ItemCatalogo.disponible?: number | null`.

---

## Testing

```bash
cd backend && npm test -- items.service.spec.ts ventas.service.spec.ts
cd backend && npm run test:e2e -- recetas.e2e-spec.ts
```

Seed demo: `550e8400-e29b-41d4-a716-446655440259` (Hamburguesa Clásica) tras arrancar el backend.

---

## Acceptance Criteria

- [x] POST/PATCH/GET/DELETE items con tipo receta
- [x] Venta descuenta ingredientes; bloqueante aborta; no bloqueante advierte
- [x] `disponible` en listado; ingredientes en detalle
- [x] Editor en configuración + POS
- [x] Unit + E2E
- [x] Docs (este archivo) + ESTADO

---

## Related Features

- [tipo-ingrediente.md](./tipo-ingrediente.md) — tipología de insumos no vendibles
- [conversion-unidades.md](./conversion-unidades.md) — conversión en consumo de ingredientes
- [inventario-kardex.md](./inventario-kardex.md) — movimientos de salida
- [ventas.md](./ventas.md) — flujo de cobro POS
- Spec: [`docs/superpowers/specs/2026-07-15-recetas-criticidad-ingredientes-design.md`](../superpowers/specs/2026-07-15-recetas-criticidad-ingredientes-design.md)
- Análisis cluster: [`docs/superpowers/specs/2026-07-14-alineamiento-cliente-foodservice-analisis.md`](../superpowers/specs/2026-07-14-alineamiento-cliente-foodservice-analisis.md)
