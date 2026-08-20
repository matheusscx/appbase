# Feature: Simulador de impacto de costos

**Status**: Complete  
**Last Updated**: 2026-08-18

---

## Overview

### What is it?

Cuando cambia el `costo_actual` de un producto o ingrediente (compra o edición manual), el sistema detecta **items compuestos** —recetas y combos— cuyo costo cacheado (`item_receta.costo_actual` / `item_combo.costo_actual`) ya no coincide con el costo que arrojan sus componentes hoy. Muestra una simulación con costos, márgenes % y precio sugerido, y permite **aplicar** (actualizar costo; precio solo con checkbox) o **descartar** (silenciar hasta el próximo cambio de costo propuesto).

Dos puntos de entrada:
- **Modal inmediato** tras guardar un cambio de costo en Items.
- **Bandeja** `/desfases` para resolver desfases pendientes.

### Why does it exist?

La pieza 3 de recetas dejó el costo cacheado a propósito (sin cascade silencioso). Food-service necesita decidir explícitamente si actualizar costo y/o precio de venta cuando sube el insumo. Cierra la **pieza 5 de 5** del cluster recetas/costos.

Los combos entraron el 2026-08-18: hasta entonces `item_combo.costo_actual` solo se recalculaba si el `PATCH /items/:id` reenviaba explícitamente `componentes` — el margen que mostraba cada listado quedaba mal por tiempo indefinido y no había forma de enterarse. Ver el cierre en [`docs/agent/resueltos.md`](../agent/resueltos.md).

### Scope

**Included:**
- Columnas `item_receta.costo_propuesto_omitido` e `item_combo.costo_propuesto_omitido` para silenciar desfases descartados.
- Detección al vuelo (sin tabla de pendientes), para recetas **y** combos.
- Endpoints de lectura y acción bajo `/desfases` e `/items`.
- Modal post-cambio de costo en `configuracion/items.vue`.
- Bandeja `/desfases` con el mismo panel de simulación, columna Tipo (receta/combo).
- Unit tests en `items.service.spec.ts` + E2E `simulador-costos.e2e-spec.ts`.

**NOT included (future):**
- Cola persistente / snooze por fecha.
- Historial auditable de quién aplicó/descartó.
- Recálculo en cascada de recetas anidadas, ni de combos anidados (no existen combos anidados).
- Badge obligatorio en navegación.
- Disparo por merma (la merma nunca actualiza `costo_actual`).

---

## Reglas de desfase de una receta

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
- **Receta con un ingrediente de unidad incompatible: se omite de la bandeja, no rompe la
  respuesta.** Si la receta pide gramos de algo que hoy se mide en litros, no hay costo que
  proponer para ella. La bandeja recorre **todas** las recetas del tenant, así que dejar
  propagar esa excepción hacía responder `400` a `GET /desfases` entero por una sola
  fila rota. Desde el 2026-08-16 un `PATCH` no puede crear ese estado (ver
  [`tipo-ingrediente.md`](./tipo-ingrediente.md) §"La unidad de un ingrediente referenciado
  no se cambia"), pero la tolerancia protege contra las filas que ya existan.
- ⚠️ **La tolerancia es solo de LECTURA.** `POST /desfases/aplicar` y
  `.../descartar` sobre una receta sin costo proponible fallan con `400` nombrando la receta.
  `item_receta.costo_actual` es dinero y la columna es nullable: persistir ahí un costo "no
  calculable" no daría error y se leería después como **costo 0** al costear un combo que use
  la receta. Los dos endpoints reciben el id por body, sin pasar por la bandeja, así que la
  fila rota les es alcanzable aunque el listado la omita.

## Reglas de desfase de un combo

```
costoPropuestoCombo = Σ (costo_actual CACHEADO del componente × cantidad)
                       // misma fórmula que validarYCostearComponentes (alta/edición)
```

**No se expande la receta hasta sus ingredientes.** El costo de un combo se arma con los
costos ya cacheados de sus componentes — un componente `receta` aporta su
`item_receta.costo_actual` tal como está, no la suma de sus ingredientes. Es una decisión
deliberada, no un atajo: si sube un ingrediente de una receta que el combo contiene, **la
receta aparece desfasada y el combo no**, hasta que se aplique el desfase de esa receta. Un
componente `servicio` no tiene costo y aporta 0, igual que al armar el combo.

A diferencia de la receta, **en un combo no existe el caso "sin costo proponible"**: no hay
conversión de unidades en la fórmula, así que `costoPropuestoCombo` nunca devuelve `null`.
Un combo sin componentes vivos simplemente se omite de la bandeja (nada que proponer), pero
nunca por una unidad incompatible.

### Decisión 1 — dos pasadas para el efecto cascada

Como el combo se desfasa contra el costo **cacheado** de la receta y no contra sus
ingredientes, aplicar el desfase de un ingrediente **no** mueve al combo en el mismo
momento: primero hay que aplicar el desfase de la receta que lo contiene, y **eso** es lo
que deja al combo desfasado. Es un efecto en dos pasadas, no un bug.

**Ejemplo (medido en `items.service.spec.ts`, caso "el lote que mezcla una receta con el
combo que la contiene"):** Combo Clásico = 1 Hamburguesa (receta, cacheada `$1.200`) + 1
Papas (`$500`), combo cacheado en `$1.700`. Sube un
ingrediente de la Hamburguesa y su costo propuesto pasa a `$1.350`; el combo **no** se mueve
todavía — sigue proponiendo `$1.700` (o nada, si no cambió). Recién al aplicar el desfase de
la Hamburguesa a `$1.350`, el combo pasa a proponer `$1.850` (`1.350 + 500`).

### Decisión 2 — `POST /desfases/aplicar` resuelve la segunda pasada

`POST /desfases/aplicar` devuelve `{ aplicados, omitidos, afectados }`. `afectados` son los
combos que quedaron desfasados por las recetas **de ese mismo lote**, leídos con el
`EntityManager` de la transacción (ven la escritura recién hecha, antes del commit). El
panel **no se cierra** cuando hay `afectados`: los muestra como filas nuevas para resolver
ahí mismo, en vez de dejarlos esperando en una recarga posterior.

`omitidos` es el otro lado de la misma decisión: si el lote trae una receta **y** el combo
que la contiene, el combo **no se aplica** — escribirlo ahí calcularía su costo sobre el
número viejo de la receta, distinto del que el usuario acaba de aprobar. Sale en `omitidos`
con un motivo, y **vuelve en `afectados`** con el costo recalculado para que el usuario lo
confirme viendo el número correcto. No es un `409`: el lote sigue, solo ese combo espera una
vuelta más.

⚠️ Esto introdujo dos ciclos de orden de lock nuevos (`items` ↔ `item_combo` y
`item_receta` ↔ `item_combo`), que por decisión del owner quedaron documentados y **no
arreglados** en su momento. **Se cerraron el 2026-08-20**, en una tanda propia: ver
[`docs/agent/resueltos.md`](../agent/resueltos.md) § "El orden de bloqueo de filas de la
bandeja de desfases". La regla que salió de ahí —el orden `item_receta` → `item_combo` →
`items`, y dentro de cada tabla por `item_id`— vive en
[`docs/patterns/backend.md`](../patterns/backend.md) § "Orden de bloqueo de filas en ítems
compuestos", y **hay que leerla antes de tocar cualquier camino que escriba estas tablas**.
Lo único que sigue abierto de ese frente es una carrera sin lock de `descartarDesfases`, en
[`docs/agent/pendientes.md`](../agent/pendientes.md) § 2.

### Margen y precio sugerido

Porcentajes en decimal (`0.19` = 19%). Misma fórmula para receta y combo.

```
margenPct(precio, costo) = precio > 0 ? (precio − costo) / precio : null

precioSugerido =
  si margenPctActual es null o ≥ 1 o costoViejo ≤ 0 → null
  si no → costoNuevo × precioViejo / costoViejo
```

Si `precioBase = 0` → márgenes y precio sugerido son `null`.

### Aplicar vs descartar

| Acción | `costo_actual` (item_receta / item_combo) | `costo_propuesto_omitido` | `items.precio_base` |
|--------|---------------------------|---------------------------|---------------------|
| **Aplicar** | Recomputa y persiste `costoPropuesto` en servidor | `NULL` | Solo si checkbox `actualizarPrecio` + `precioBase > 0` |
| **Descartar** | Sin cambio | `costoPropuesto` actual | Sin cambio |

Tras descartar, el item reaparece cuando su costo propuesto cambia de nuevo. Las dos batches son atómicas (una transacción cada una), pero solo **aplicar** toma lock: `FOR UPDATE` ordenado (`item_receta` antes que `item_combo`, e `id` ascendente dentro de cada tabla). **Descartar no toma ningún lock** y escribe las dos tablas en el orden que manda el cliente, así que `descartar([combo, receta])` contra `aplicar([receta, combo])` sí puede deadlockear — es el ciclo #2 anotado en la entrada 🔴 *"Dos ciclos de orden de lock en la bandeja de desfases de combos…"* de `docs/agent/pendientes.md`, abierto por decisión del owner.

---

## Modelo de datos

### `item_receta` / `item_combo` (extensión)

| Column | Type | Notes |
|--------|------|-------|
| `costo_propuesto_omitido` | NUMERIC(18,4) NULL | Snapshot del costo propuesto descartado; `NULL` = sin omisión activa. Existe en las dos tablas. |

---

## API

Prefijo `/api`. Lecturas en replica; escrituras en db (transacción).

### `GET /api/desfases`

Permiso: **Items:Leer**. Query opcional `?insumoItemId=<uuid>` — filtra a los items
compuestos (receta o combo) que usan ese producto/ingrediente **directamente**: la receta
que lo lista como ingrediente, el combo que lo lista como componente fijo. El combo que lo
usa a través de una receta **no** entra en ese filtro — es la Decisión 1: el combo se
desfasa contra el costo cacheado de la receta, no contra sus ingredientes.

Respuesta: array de `DesfaseItemDto`:

```json
{
  "itemId": "<uuid>",
  "tipo": "receta",
  "nombre": "Hamburguesa Clásica",
  "costoActual": "1200.0000",
  "costoPropuesto": "1350.0000",
  "deltaCosto": "150.0000",
  "precioBase": "3500.0000",
  "margenPctActual": "0.6571",
  "margenPctPropuesto": "0.6143",
  "precioSugerido": "3937.5000",
  "afectados": [
    { "itemId": "<uuid>", "nombre": "Carne molida", "costoActual": "8000.0000" }
  ]
}
```

`tipo` es `'receta' | 'combo'`. `afectados` lista los componentes del item —ingredientes
para una receta, componentes fijos para un combo— con su costo actual.

### `GET /api/items/:id/afectados`

Permiso: **Items:Leer**. Desfasados del tenant (recetas y combos) que usan ese item como
componente, directo (modal post-cambio de costo/compra). Misma forma de fila que arriba.
Acepta `tipo IN ('ingrediente', 'producto')`: comprar un producto o editar el costo de un
ingrediente abren el mismo modal.

### `POST /api/desfases/aplicar`

Permiso: **Items:Actualizar**.

```json
{
  "items": [
    {
      "itemId": "<uuid>",
      "actualizarPrecio": true,
      "precioBase": "3900.0000"
    }
  ]
}
```

Reglas: `tenant_id` del token; cada `itemId` debe ser `tipo='receta' | 'combo'` del tenant;
recomputa `costoPropuesto` en servidor (no confía en el body); idempotente si ya no está
desfasada.

Respuesta:

```json
{
  "aplicados": 1,
  "omitidos": [
    { "itemId": "<uuid>", "nombre": "Combo Clásico", "motivo": "Depende de una receta de este mismo lote: se recalcula y vuelve a proponerse." }
  ],
  "afectados": [ /* DesfaseItemDto[] de los combos que quedaron desfasados por este lote */ ]
}
```

### `POST /api/desfases/descartar`

Permiso: **Items:Actualizar**.

```json
{ "itemIds": ["<uuid>", "<uuid>"] }
```

Setea `costo_propuesto_omitido` al `costoPropuesto` recomputado (en la tabla que corresponda según `tipo`); no toca costo ni precio.

---

## Backend

- **Módulo**: `src/modules/items/` (sin módulo Nest nuevo).
- **Controller**: `desfases.controller.ts` (`@Controller('desfases')`) + `GET :id/afectados` en `items.controller.ts`.
- **Service**: `ItemsService` — `listarDesfases`, `itemsAfectadosPorInsumo`, `aplicarDesfases`, `descartarDesfases`; privados `costoPropuesto` (recetas, con conversión de unidades) y `costoPropuestoCombo` (combos, sin conversión), más `filasDesfaseRecetas`/`filasDesfaseCombos` que arman las filas de `DesfaseItemDto`.
- **DTOs**: `query-desfases.dto.ts` (`insumoItemId`), `aplicar-desfases.dto.ts` (`items[]` con `itemId`), `descartar-desfases.dto.ts` (`itemIds[]`).
- Endpoints de compra/`PATCH` de costo **sin cambios**; el FE encadena el GET de afectados.

---

## Frontend

- `configuracion/items.vue` — tras PATCH de costo o compra con `costoUnitario` → `GET /items/:id/afectados` → drawer con `DesfasesPanel` si hay filas.
- `desfases.vue` — bandeja con `GET /desfases`; mismas acciones aplicar/descartar; no se cierra sola cuando `aplicar` devuelve `afectados` (los reemplaza en la lista).
- `components/DesfasesPanel.vue` — tabla de simulación con columna Tipo (receta/combo): costos, márgenes, input precio (prellenado con `precioSugerido`), checkbox "Actualizar precio" off por defecto.
- `composables/useSimuladorDesfases.ts` — mismo flujo aplicar/descartar para el modal (compartido entre `configuracion/items.vue` e `inventario.vue`); reproduce el manejo de `omitidos`/`afectados` con toasts propios.
- Nav en `dashboard.vue` → "Costos desfasados" (`/desfases`).
- `configuracion/recetas-desfases.vue` es un stub de compatibilidad: redirige a `/desfases`.
- Merma y ajustes que no cambian `costo_actual` **no** disparan el modal.

---

## Data flow

```
[Usuario actualiza costo de Carne (compra o PATCH)]
  ↓ OK
[FE GET /items/{carneId}/afectados]
  ↓ filas desfasadas?
[Modal simulación]
  ├─ Aplicar (checkbox precio opcional) → POST /desfases/aplicar
  │    └─ afectados no vacío → el modal se recarga con esas filas (combos de 2ª pasada)
  ├─ Descartar → POST /desfases/descartar
  └─ Después → cierra; siguen en GET /desfases

[Más tarde, bandeja /desfases]
  GET /desfases → mismas acciones, recetas y combos mezclados
```

---

## Testing

```bash
cd backend && npm test -- items.service.spec.ts  # desfases de costo de recetas y combos
cd backend && npm run test:e2e -- simulador-costos.e2e-spec.ts
```

### Manual

1. Login Paris → Items → editar costo de "Carne molida" → modal con Hamburguesa.
2. Descartar → bandeja sin esa fila; subir costo de nuevo → reaparece.
3. Aplicar con checkbox precio → `costoActual` y `precioBase` de la hamburguesa cambian.
4. Merma de carne **no** abre modal.
5. Comprar un producto que es componente de un combo → el modal se abre para el combo (antes del 2026-08-18 no lo hacía).
6. Aplicar el desfase de una receta que un combo contiene → el panel no se cierra; el combo aparece como fila nueva (`afectados`).

---

## Acceptance Criteria

- [x] Cambiar costo de insumo abre modal solo si hay recetas o combos desfasados
- [x] Simulación muestra costos, márgenes y precio sugerido coherentes
- [x] Aplicar actualiza costo siempre; precio solo con checkbox
- [x] Descartar oculta hasta el próximo cambio de costo propuesto
- [x] Bandeja lista pendientes al vuelo con mismas acciones, recetas y combos
- [x] Un combo se desfasa contra el costo cacheado de sus componentes (dos pasadas para el efecto cascada de un ingrediente)
- [x] Lote mixto (receta + combo que la contiene) omite el combo y lo devuelve en `afectados`
- [x] Merma / ajustes sin cambio de `costo_actual` no disparan modal
- [x] Unit + E2E
- [x] Docs (este archivo) + ESTADO

---

## Related Features

- [recetas.md](./recetas.md) — pieza 3; costo cacheado sin auto-recálculo
- [combos.md](./combos.md) — costo cacheado del combo, ahora cubierto por esta bandeja
- [mermas-valorizadas.md](./mermas-valorizadas.md) — pieza 4; no dispara simulador
- [conversion-unidades.md](./conversion-unidades.md) — conversión en suma de ingredientes (solo recetas)
- Spec: [`docs/superpowers/specs/2026-07-15-simulador-impacto-costos-design.md`](../superpowers/specs/2026-07-15-simulador-impacto-costos-design.md)
