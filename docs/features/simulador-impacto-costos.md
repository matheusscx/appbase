# Feature: Simulador de impacto de costos

**Status**: Complete  
**Last Updated**: 2026-07-15

---

## Overview

### What is it?

Cuando cambia el `costo_actual` de un producto usado como ingrediente (compra o edición manual), el sistema detecta recetas cuyo `item_receta.costo_actual` cacheado ya no coincide con la suma actual de ingredientes. Muestra una simulación con costos, márgenes % y precio sugerido, y permite **aplicar** (actualizar costo; precio solo con checkbox) o **descartar** (silenciar hasta el próximo cambio de costo propuesto).

Dos puntos de entrada:
- **Modal inmediato** tras guardar un cambio de costo en Items.
- **Bandeja** `/configuracion/recetas-desfases` para resolver desfases pendientes.

### Why does it exist?

La pieza 3 de recetas dejó el costo cacheado a propósito (sin cascade silencioso). Food-service necesita decidir explícitamente si actualizar costo y/o precio de venta cuando sube el insumo. Cierra la **pieza 5 de 5** del cluster recetas/costos.

### Scope

**Included:**
- Columna `item_receta.costo_propuesto_omitido` para silenciar desfases descartados.
- Detección al vuelo (sin tabla de pendientes).
- Endpoints de lectura y acción bajo `items` / `recetas`.
- Modal post-cambio de costo en `configuracion/items.vue`.
- Bandeja `configuracion/recetas-desfases` con el mismo panel de simulación.
- Unit tests en `items.service.spec.ts` + E2E `simulador-costos.e2e-spec.ts`.

**NOT included (future):**
- Cola persistente / snooze por fecha.
- Historial auditable de quién aplicó/descartó.
- Recálculo en cascada de recetas anidadas.
- Badge obligatorio en navegación.
- Disparo por merma (la merma nunca actualiza `costo_actual`).

---

## Reglas de desfase

```
costoPropuesto = Σ (costo_actual_ingrediente × cantidad convertida a unidad base)
                 // misma fórmula que validarYCostearIngredientes (Decimal.js)

desfasada =
  costoPropuesto ≠ item_receta.costo_actual
  AND (
    costo_propuesto_omitido IS NULL
    OR costoPropuesto ≠ costo_propuesto_omitido
  )
```

- Comparación con Decimal.js a **4 decimales** (`NUMERIC(18,4)`).
- Ingrediente sin `costo_actual` aporta `0` (mismo criterio que el costeo al armar receta).
- Solo ingredientes y recetas con `eliminado_el IS NULL`.

### Margen y precio sugerido

Porcentajes en decimal (`0.19` = 19%).

```
margenPct(precio, costo) = precio > 0 ? (precio − costo) / precio : null

precioSugerido =
  si margenPctActual es null o ≥ 1 o costoViejo ≤ 0 → null
  si no → costoNuevo × precioViejo / costoViejo
```

Si `precioBase = 0` → márgenes y precio sugerido son `null`.

### Aplicar vs descartar

| Acción | `item_receta.costo_actual` | `costo_propuesto_omitido` | `items.precio_base` |
|--------|---------------------------|---------------------------|---------------------|
| **Aplicar** | Recomputa y persiste `costoPropuesto` en servidor | `NULL` | Solo si checkbox `actualizarPrecio` + `precioBase > 0` |
| **Descartar** | Sin cambio | `costoPropuesto` actual | Sin cambio |

Tras descartar, la receta reaparece cuando el costo propuesto cambia de nuevo (nuevo costo del insumo). La batch de aplicar/descartar es atómica (una transacción).

---

## Modelo de datos

### `item_receta` (extensión)

| Column | Type | Notes |
|--------|------|-------|
| `costo_propuesto_omitido` | NUMERIC(18,4) NULL | Snapshot del costo propuesto descartado; `NULL` = sin omisión activa |

---

## API

Prefijo `/api`. Lecturas en replica; escrituras en db (transacción).

### `GET /api/recetas/desfases`

Permiso: **Items:Leer**. Query opcional `?ingredienteItemId=<uuid>`.

Respuesta: array de `DesfaseRecetaDto`:

```json
{
  "recetaItemId": "<uuid>",
  "nombre": "Hamburguesa Clásica",
  "costoActual": "1200.0000",
  "costoPropuesto": "1350.0000",
  "deltaCosto": "150.0000",
  "precioBase": "3500.0000",
  "margenPctActual": "0.6571",
  "margenPctPropuesto": "0.6143",
  "precioSugerido": "3937.5000",
  "ingredientesAfectados": [
    { "itemId": "<uuid>", "nombre": "Carne molida", "costoActual": "8000.0000" }
  ]
}
```

### `GET /api/items/:id/recetas-afectadas`

Permiso: **Items:Leer**. Desfasadas del tenant que usan ese producto como ingrediente (modal post-cambio). Misma forma de fila que arriba.

### `POST /api/recetas/desfases/aplicar`

Permiso: **Items:Actualizar**.

```json
{
  "items": [
    {
      "recetaItemId": "<uuid>",
      "actualizarPrecio": true,
      "precioBase": "3900.0000"
    }
  ]
}
```

Reglas: `tenant_id` del token; cada `recetaItemId` debe ser `tipo='receta'` del tenant; recomputa `costoPropuesto` en servidor (no confiar body); idempotente si ya no está desfasada.

### `POST /api/recetas/desfases/descartar`

Permiso: **Items:Actualizar**.

```json
{ "recetaItemIds": ["<uuid>", "<uuid>"] }
```

Setea `costo_propuesto_omitido` al `costoPropuesto` recomputado; no toca costo ni precio.

---

## Backend

- **Módulo**: `src/modules/items/` (sin módulo Nest nuevo).
- **Controller**: `recetas-desfases.controller.ts` (`@Controller('recetas')`) + `GET :id/recetas-afectadas` en `items.controller.ts`.
- **Service**: `ItemsService` — `listarDesfases`, `recetasAfectadasPorIngrediente`, `aplicarDesfases`, `descartarDesfases`; helper privado reutiliza `validarYCostearIngredientes`.
- **DTOs**: `query-desfases.dto.ts`, `aplicar-desfases.dto.ts`, `descartar-desfases.dto.ts`.
- Endpoints de compra/`PATCH` de costo **sin cambios**; el FE encadena el GET de afectadas.

---

## Frontend

- `configuracion/items.vue` — tras PATCH de costo o compra con `costoUnitario` → `GET /items/:id/recetas-afectadas` → drawer con `RecetasDesfasesPanel` si hay filas.
- `configuracion/recetas-desfases.vue` — bandeja con `GET /recetas/desfases`; mismas acciones aplicar/descartar.
- `components/RecetasDesfasesPanel.vue` — tabla de simulación: costos, márgenes, input precio (prellenado con `precioSugerido`), checkbox “Actualizar precio” off por defecto.
- Nav en `configuracion.vue` → “Recetas desfasadas”.
- Merma y ajustes que no cambian `costo_actual` **no** disparan el modal.

---

## Data flow

```
[Usuario actualiza costo de Carne (compra o PATCH)]
  ↓ OK
[FE GET /items/{carneId}/recetas-afectadas]
  ↓ filas desfasadas?
[Modal simulación]
  ├─ Aplicar (checkbox precio opcional) → POST /recetas/desfases/aplicar
  ├─ Descartar → POST /recetas/desfases/descartar
  └─ Después → cierra; siguen en GET /recetas/desfases

[Más tarde, bandeja /configuracion/recetas-desfases]
  GET /recetas/desfases → mismas acciones
```

---

## Testing

```bash
cd backend && npm test -- items.service.spec.ts  # desfases de costo de recetas
cd backend && npm run test:e2e -- simulador-costos.e2e-spec.ts
```

### Manual

1. Login Paris → Items → editar costo de “Carne molida” → modal con Hamburguesa.
2. Descartar → bandeja sin esa fila; subir costo de nuevo → reaparece.
3. Aplicar con checkbox precio → `costoActual` y `precioBase` de la hamburguesa cambian.
4. Merma de carne **no** abre modal.

---

## Acceptance Criteria

- [x] Cambiar costo de insumo abre modal solo si hay recetas desfasadas
- [x] Simulación muestra costos, márgenes y precio sugerido coherentes
- [x] Aplicar actualiza costo siempre; precio solo con checkbox
- [x] Descartar oculta hasta el próximo cambio de costo propuesto
- [x] Bandeja lista pendientes al vuelo con mismas acciones
- [x] Merma / ajustes sin cambio de `costo_actual` no disparan modal
- [x] Unit + E2E
- [x] Docs (este archivo) + ESTADO

---

## Related Features

- [recetas.md](./recetas.md) — pieza 3; costo cacheado sin auto-recálculo
- [mermas-valorizadas.md](./mermas-valorizadas.md) — pieza 4; no dispara simulador
- [conversion-unidades.md](./conversion-unidades.md) — conversión en suma de ingredientes
- Spec: [`docs/superpowers/specs/2026-07-15-simulador-impacto-costos-design.md`](../superpowers/specs/2026-07-15-simulador-impacto-costos-design.md)
