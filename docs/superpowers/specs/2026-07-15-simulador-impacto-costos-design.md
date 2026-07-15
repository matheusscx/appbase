# Diseño — Simulador de impacto de costos

**Status**: Done
**Date**: 2026-07-15
**Owner**: Cesar Matheus
**Cluster**: Recetas/costos food-service — **pieza 5 de 5** (ver
[análisis de alineamiento](./2026-07-14-alineamiento-cliente-foodservice-analisis.md))

## Context

El costo de una receta vive cacheado en `item_receta.costo_actual` y **no** se
recalcula automáticamente cuando cambia el `costo_actual` de un ingrediente
(compra o edición manual). Esa decisión fue explícita en la pieza 3: el cliente
quiere una decisión humana, no un cascade silencioso.

Esta pieza cierra el cluster: detecta el desfase, muestra el impacto
(pre-confirmación) con márgenes y precio sugerido, y permite aplicar o descartar
de forma explícita — tanto en el momento del cambio de costo como más tarde
desde una bandeja.

Depende de piezas ya implementadas:
- **Costo por producto** (`item_producto.costo_actual`, congelado en kardex).
- **Conversión de unidades** (`CatalogService.convertirUnidad`).
- **Recetas** (`item_receta` + `receta_ingredientes` + costeo en
  `ItemsService.validarYCostearIngredientes`).

## Scope

**Incluido:**
- Detección al vuelo de recetas desfasadas
  (`costo_actual` cacheado ≠ Σ costo de ingredientes actuales).
- Modal inmediato tras cambiar el costo de un producto usado como ingrediente
  (compra que actualiza `costo_actual`, o `PATCH` de costo).
- Bandeja “Recetas desfasadas” con la misma simulación.
- Vista previa por receta: costo viejo/nuevo (+delta), margen % viejo/nuevo,
  precio sugerido (editable) para mantener el margen % anterior.
- Aplicar (batch): siempre actualiza `item_receta.costo_actual`; actualiza
  `items.precio_base` solo si hay checkbox “actualizar precio” por fila.
- Descartar (batch): silencia ese desfase hasta que el costo propuesto cambie
  otra vez (snapshot `costo_propuesto_omitido` en `item_receta`).
- Endpoints de lectura/acción en el módulo `items` (sin módulo Nest nuevo).

**NO incluido:**
- Tabla de pendientes / cola persistente de impactos.
- Snooze por fecha (“recordar en 7 días”).
- Historial auditable de quién aplicó/descartó (YAGNI; soft timestamps bastan
  sobre `item_receta`/`items`).
- Recálculo en cascada de recetas anidadas (no existen en el modelo).
- Costeo promedio ponderado o FIFO/por lote.
- Dashboard global de márgenes / reportes avanzados.
- Personalización de ingredientes por pedido (idea aparte del análisis).
- Cambiar respuestas de compra/`PATCH` para embeber el modal (el FE consulta
  `recetas-afectadas` después).

## Decisions

| Decisión | Elección | Razón |
|---|---|---|
| Disparador UX | **Modal inmediato + bandeja** | El usuario decide al instante o pospone sin perder el desfase |
| Persistencia de bandeja | **Al vuelo**, sin tabla de pendientes | Menos estado que sincronizar; la verdad es costo cacheado vs Σ actual |
| Silenciar tras descartar | Columna `costo_propuesto_omitido` en `item_receta` | Cumple “no molestar hasta el próximo cambio” sin cola de pendientes |
| Dónde vive la lógica | **`ItemsService`** (+ endpoints delgados) | Reusa la misma fórmula de costeo; evita módulo paralelo |
| Costo al aplicar | **Recomputar en el servidor** al POST | No confiar montos del body; evita TOCTOU de simulación stale |
| Precio al aplicar | **Solo con checkbox por fila** | Evita subir precios por accidente; costo sí siempre |
| Margen % | `(precioBase − costo) / precioBase` (decimal) | Margen sobre venta; alineado a regla de % en decimal del sistema |
| Precio sugerido | `costoNuevo × precioViejo / costoViejo` | Mantiene el margen % anterior; null si no aplica |
| Hook post-cambio de costo | FE llama `GET …/recetas-afectadas` | Mantiene estables los endpoints de compra/`PATCH` |
| Merma como disparador | **No** | La merma nunca actualiza `costo_actual` |

## Backend

### Modelo de datos

**`item_receta`** — columna nueva:

| Columna | Tipo | Notas |
|---|---|---|
| `costo_propuesto_omitido` | `NUMERIC(18,4) NULL` | Costo propuesto que el usuario descartó. `NULL` = sin omisión activa. `type` numérico; PK/FK del resto de la tabla ya existen con `uuid` explícito (ADR-004) |

### Reglas de desfase

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

- Comparación con Decimal.js tras redondear ambos lados a **4 decimales**
  (misma escala `NUMERIC(18,4)` / `convertirUnidad`); sin epsilon adicional.
- Ingrediente sin `costo_actual`: aporta `0` a la suma (mismo criterio que el
  costeo actual al armar/editar receta).
- Soft-delete: solo ingredientes y recetas con `eliminado_el IS NULL`.

### Margen y precio sugerido

Porcentajes siempre en decimal (`0.19` = 19%).

```
margenPct(precio, costo) =
  precio > 0 ? (precio − costo) / precio : null

precioSugerido =
  si margenPctActual es null o ≥ 1 o costoViejo ≤ 0 → null
  si no → costoNuevo × precioViejo / costoViejo
```

Si `precioBase = 0` → márgenes y precio sugerido son `null` (no inventar precio).

### API

Prefijo bajo el API existente (`API_PREFIX`). Lecturas en replica / escrituras en
db según convención del proyecto (SQL raw de lectura; mutaciones en
transacción).

| Método | Ruta | Rol |
|---|---|---|
| `GET` | `/recetas/desfases` | Bandeja del tenant; query opcional `ingredienteItemId` |
| `GET` | `/items/:id/recetas-afectadas` | Desfasadas que usan ese producto (modal post-cambio) |
| `POST` | `/recetas/desfases/aplicar` | Batch aplicar |
| `POST` | `/recetas/desfases/descartar` | Batch descartar |

**Fila de simulación (respuesta de lectura):**

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
    { "itemId": "<uuid>", "nombre": "Carne", "costoActual": "8000.0000" }
  ]
}
```

`ingredientesAfectados`: siempre la lista completa de ingredientes vivos de la
receta (id, nombre, `costoActual`). En el modal disparado por un insumo, el FE
puede resaltar esa fila; el backend no filtra el array.

**Body aplicar:**

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

Reglas:
1. `tenant_id` del token; cada `recetaItemId` debe ser `tipo='receta'` del tenant.
2. Recomputar `costoPropuesto` en el servidor; persistir en `item_receta.costo_actual`.
3. Limpiar `costo_propuesto_omitido` (`NULL`).
4. Si `actualizarPrecio === true`: exigir `precioBase` número string `> 0` y
   actualizar `items.precio_base`. Si `actualizarPrecio` es false/ausente, ignorar
   `precioBase`.
5. Toda la batch en una transacción.
6. Si la receta ya no está desfasada al momento del POST (otro usuario aplicó),
   idempotente: reescribir el mismo costo propuesto y limpiar omitido; no error.

**Body descartar:**

```json
{ "recetaItemIds": ["<uuid>", "<uuid>"] }
```

Setea `costo_propuesto_omitido = costoPropuesto` recomputado ahora. No toca
`costo_actual` ni `precio_base`.

### Key modules / hooks

- `ItemsService`: métodos `listarDesfases`, `recetasAfectadasPorIngrediente`,
  `aplicarDesfases`, `descartarDesfases`; helper privado de fila de simulación
  reutilizando la fórmula de `validarYCostearIngredientes`.
- Controller: endpoints anteriores con los mismos guards/permisos que permiten
  editar items (`PATCH /items`).
- Tras compra/`PATCH` de costo: **sin cambios de contrato** en esos endpoints;
  el frontend encadena el GET de afectadas.

## Frontend

### Modal post-cambio de costo
- En flujos de `items.vue` que cambian costo (drawer editar producto con campo
  costo; modal de ajuste por compra con `costoUnitario`).
- Tras respuesta OK → `GET /items/:id/recetas-afectadas`.
- Si hay filas → abrir drawer/modal de simulación; si vacío, no molestar.

### Bandeja
- Página `configuracion/recetas-desfases` (o sección clara bajo Items).
- `GET /recetas/desfases`; misma tabla/acciones que el modal.
- Badge/contador opcional en nav de Items si `count > 0` (un GET liviano o
  `meta.total` del listado).

### Fila UX
- Nombre de receta.
- Costo actual → propuesto (+ delta, color financiero solo si ya hay patrón; si
  no, tokens semánticos).
- Margen % actual → propuesto.
- Input de precio (prellenado con `precioSugerido` si no es null) + checkbox
  “Actualizar precio” **off por defecto**.
- Acciones: Aplicar seleccionadas / Descartar seleccionadas / Cerrar (“Después”).

Design System: tokens semánticos Nuxt UI; montos vía `formatMonto`; no hardcode
Tailwind de grises.

## Data flow

```
[Usuario actualiza costo de Carne (compra o PATCH)]
  ↓ OK
[FE GET /items/{carneId}/recetas-afectadas]
  ↓ filas desfasadas?
[Modal simulación]
  ├─ Aplicar (checkbox precio opcional) → POST /recetas/desfases/aplicar
  │    → costo_actual = propuesto; omitido = NULL; precio_base?
  ├─ Descartar → POST /recetas/desfases/descartar
  │    → costo_propuesto_omitido = propuesto
  └─ Después → cierra; siguen en GET /recetas/desfases

[Más tarde, bandeja]
  GET /recetas/desfases → mismas acciones
```

Tras un nuevo cambio de costo del insumo, `costoPropuesto` cambia → la receta
vuelve a aparecer aunque estuviera omitida (porque
`costoPropuesto ≠ costo_propuesto_omitido`).

## Testing

### Unit (`items.service.spec.ts`)
- Desfase: `propuesto ≠ cacheado` entra; igualdad no.
- Omitido: mismo propuesto que `costo_propuesto_omitido` no entra; propuesto
  distinto sí.
- Margen y `precioSugerido` con Decimal.js (casos borde: precio 0, costo ≥ precio,
  margen ≥ 1).
- Aplicar: recomputa en servidor; limpia omitido; precio solo con checkbox;
  batch atómico.
- Descartar: setea omitido; no toca costo ni precio.

### E2E (`simulador-costos.e2e-spec.ts` nuevo)
1. Seed/crear receta con carne; comprar carne a costo nuevo →
   `GET …/recetas-afectadas` incluye la receta.
2. Aplicar con `actualizarPrecio` → `costo_actual` y `precio_base` nuevos;
   deja de listarse en `/recetas/desfases`.
3. Descartar otra receta afectada → no aparece en bandeja; tras otro cambio de
   costo de carne, reaparece.
4. Aplicar sin checkbox → costo cambia, precio no.

### Manual
- UI: editar costo / compra → modal → aplicar/descartar/después.
- Bandeja: resolver desfases pendientes.

## Verification (aceptación)

- [x] Cambiar costo de un insumo abre modal solo si hay recetas desfasadas.
- [x] La simulación muestra costos, márgenes y precio sugerido coherentes.
- [x] Aplicar actualiza costo siempre; precio solo con checkbox.
- [x] Descartar oculta hasta el próximo cambio de costo propuesto.
- [x] La bandeja lista lo pendiente (al vuelo) y permite las mismas acciones.
- [x] Merma / ajustes que no cambian `costo_actual` no disparan el modal.

## Related

- [costo-producto-kardex-design.md](./2026-07-14-costo-producto-kardex-design.md) — pieza 1
- [motor-conversion-unidades-design.md](./2026-07-14-motor-conversion-unidades-design.md) — pieza 2
- [recetas-criticidad-ingredientes-design.md](./2026-07-15-recetas-criticidad-ingredientes-design.md) — pieza 3
- [mermas-valorizadas-design.md](./2026-07-15-mermas-valorizadas-design.md) — pieza 4
- [alineamiento-cliente-foodservice-analisis.md](./2026-07-14-alineamiento-cliente-foodservice-analisis.md) — cluster
