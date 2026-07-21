# Feature: Combos (paquetes con precio propio)

**Status**: Complete
**Owner**: SDD Team
**Last Updated**: 2026-07-20

---

## Overview

### What is it?

Un item `tipo='combo'` representa un paquete de venta (ej. "Combo Clásico" = 1
Hamburguesa Clásica + 1 Papas fritas) con **precio propio fijo** — no es la suma
de sus componentes. Se vende como cualquier item del catálogo, en **una sola
línea** de venta; al cobrarse, el motor de ventas descuenta el stock de cada
**componente fijo** por su cuenta (producto → salida directa; receta → expande a
sus ingredientes; servicio → no descuenta nada). Cada componente declara
cantidad y si es **bloqueante**: sin stock de un bloqueante la venta aborta; un
no bloqueante sin stock se omite y la venta sigue con una advertencia.

### Why does it exist?

Food-service vende paquetes (hamburguesa + papas + bebida a un precio fijo,
distinto de comprar cada pieza suelta). Sin combos, o se crea un item ficticio
sin trazabilidad de stock, o se cobran las piezas por separado perdiendo el
precio de paquete. Esta pieza cierra el hueco del cluster food-service (pieza 4
de 5), reutilizando el costeo y la venta de productos/recetas ya existentes.

### Scope

**Included:**
- `items.tipo = 'combo'` + extensión `item_combo` (`costo_actual` cacheado) +
  `combo_componentes` (N componentes fijos, soft delete).
- Alta/edición con validación: cada componente debe ser `tipo='producto' |
  'receta' | 'servicio'` (nunca otro combo — sin combos anidados), cantidad > 0.
- Venta: descuento de stock por componente vía `ItemsService.venderComponentesCombo`,
  reutilizando `venderIngredientesReceta` para componentes tipo receta; respuesta
  con `advertenciasReceta`.
- `disponible` calculado al vuelo en el listado (mínimo entre componentes fijos
  **bloqueantes**; conservador — ver Notes).
- Bloqueo de soft-delete de un item usado como componente vivo de un combo.
- UI: editor de componentes en Configuración → Items; POS y Salones listan
  combos junto a productos/recetas con badge de disponibilidad, un click.
- Seed demo "Combo Clásico" (Hamburguesa Clásica + Papas fritas, IDs 0281–0285).

**NOT included (este ticket — cubierto por Ticket B, ya implementado):**
- ~~Grupos de modificadores (combos con elección, ej. "elige tu bebida")~~ —
  implementado en Ticket B, ver [grupos-modificadores.md](./grupos-modificadores.md).
  Un combo puede asociar N grupos además de (o en vez de) sus componentes
  fijos; `disponibleCondicional: true` en el listado quiere decir que la
  disponibilidad depende de la opción elegida.
- Combos anidados (un combo como componente de otro combo).
- Recálculo silencioso de `costo_actual` cuando cambia el costo de un componente
  (mismo trato que recetas — ver [simulador-impacto-costos.md](./simulador-impacto-costos.md)).

---

## Modelo de datos

### `item_combo` (1:1 con `items` tipo combo)

| Column | Type | Notes |
|--------|------|-------|
| `item_id` | UUID PK/FK → items | |
| `costo_actual` | NUMERIC(18,4) | Σ(costo componente × cantidad); cacheado al crear/editar, no se recalcula solo |

### `combo_componentes`

| Column | Type | Notes |
|--------|------|-------|
| `combo_componente_id` | UUID PK | |
| `tenant_id` | UUID | Del token |
| `combo_item_id` | UUID | Item tipo `combo` |
| `componente_item_id` | UUID | Siempre `tipo='producto' \| 'receta' \| 'servicio'` |
| `cantidad` | NUMERIC(18,4) | Por 1 unidad de combo; debe ser > 0 |
| `bloqueante` | BOOLEAN | Default `true` |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete al reemplazar lista |

Índice único parcial: `(combo_item_id, componente_item_id) WHERE eliminado_el IS NULL`.

**Precio propio, no derivado:** `items.precio_base` del combo es el precio de
venta del paquete (ej. $4.200), fijado por el tenant al crear/editar el combo —
el motor de precios no lo calcula a partir de la suma de componentes. Solo
`item_combo.costo_actual` sí es esa suma, y solo alimenta métricas de margen (no
el precio de venta).

---

## API (extensiones sobre `/items` y `/ventas`)

### POST /items — `tipo: 'combo'`

```
POST /api/items
Authorization: Bearer <token>

Request:
{
  "nombre": "Combo Clásico",
  "precioBase": "4200",
  "monedaId": "<uuid>",
  "tipo": "combo",
  "componentes": [
    { "componenteItemId": "<hamburguesa (receta)>", "cantidad": "1", "bloqueante": true },
    { "componenteItemId": "<papas (producto)>", "cantidad": "1", "bloqueante": true }
  ]
}

Response (201): { "id": "<uuid>" }
```

Costo = Σ (costo_actual del componente × cantidad), Decimal.js, 4 decimales. El
costo de un componente `producto`/`receta` viene de `item_producto.costo_actual`
/ `item_receta.costo_actual`; un componente `servicio` no tiene costo (no
contribuye a la suma).

### PATCH /items/:id

Con `componentes` (reemplazo total): soft-delete de filas vivas + insert de la
nueva lista + update de `item_combo.costo_actual`. Lista vacía → `400`.

### GET /items?tipo=combo

Cada item incluye `disponible: number | null` — mínimo entre componentes
**bloqueantes** de: `floor(stock / cantidad)` si es producto, disponible de la
receta (mismo cálculo que en `recetas.md`) dividido por cantidad si es receta;
un componente `servicio` se ignora en el cálculo. `null` si no hay componentes
bloqueantes.

### GET /items/:id

Si es combo, agrega `componentes: { componenteItemId, componenteNombre, tipo,
cantidad, bloqueante, stock }[]`. `costoActual` viene de `item_combo` (COALESCE
en el query base, igual patrón que receta/producto).

### DELETE /items/:id

Si el item es componente de algún combo vivo → `400` con los nombres de esos
combos (mismo patrón que el bloqueo de borrado de un ingrediente de receta).

### POST /ventas (línea con item tipo combo)

Una sola línea de venta por el combo, al precio propio del combo (no explota en
N líneas por componente). Por cada componente, `ItemsService.venderComponentesCombo`
aplica el efecto según su tipo:
- **producto** → un movimiento de salida directo (`InventarioService.registrarMovimiento`).
- **receta** → delega en `venderIngredientesReceta` (expande a sus ingredientes).
- **servicio** → no genera movimiento de inventario.

Bloqueante sin stock → aborta la transacción completa de la venta. No
bloqueante sin stock: se captura el error, se agrega un mensaje a
`advertenciasReceta` en la respuesta y la venta continúa sin ese componente
(mismo criterio "warn, don't block" que recetas).

---

## Backend

- **Módulo**: `ItemsModule` (lógica de alta/edición/costeo/disponibilidad en
  `ItemsService`, tablas `item_combo` / `combo_componentes` sin entidad TypeORM
  dedicada — acceso vía SQL raw, mismo patrón que `receta_ingredientes`).
- **Venta**: `VentasService.crearEnTransaccion` delega en
  `itemsService.venderComponentesCombo` (sin dependencias nuevas en Ventas).
- **Inventario**: `InventarioService.registrarMovimiento` sin cambios.

### Key methods

- `validarYCostearComponentes` (privado) — create/update; valida tipo permitido
  (producto/receta/servicio) y cantidad > 0.
- `venderComponentesCombo` — venta; branchea por tipo de componente.
- `calcularDisponibleCombo` (privado) — listado.

---

## Frontend

- `pages/configuracion/items.vue` — tipo Combo + editor de componentes fijos
  (item, cantidad, bloqueante); selector vía `GET /items?tipo=producto|receta|servicio`.
- `pages/ventas/pos.vue` y `pages/salones/index.vue` — fetch paralelo incluye
  `tipo=combo`; un combo se agrega con un click, como un producto (nunca abre
  drawer en este ticket — no hay grupos de modificadores todavía).
- `components/ventas/CatalogoGrid.vue` — combo nunca bloquea el click; se
  atenúa si `disponible === 0`; badge "Disponibles: N".
- `composables/useVenta.ts` — `ItemCatalogo.disponible?: number | null` (mismo
  campo que productos/recetas).

---

## Testing

```bash
cd backend && npm test -- items.service.spec.ts ventas.service.spec.ts
cd backend && npm run test:e2e -- combos.e2e-spec.ts
```

Seed demo: `550e8400-e29b-41d4-a716-446655440283` ("Combo Clásico") tras
arrancar el backend, con componentes Hamburguesa Clásica (receta,
`550e8400-e29b-41d4-a716-446655440259`) y Papas fritas (producto,
`550e8400-e29b-41d4-a716-446655440281`).

---

## Acceptance Criteria

- [x] POST/PATCH/GET/DELETE items con tipo combo
- [x] Venta descuenta componentes según su tipo; bloqueante aborta; no
      bloqueante advierte
- [x] `disponible` en listado (conservador); componentes en detalle
- [x] Editor en configuración + POS/Salones
- [x] Unit + E2E
- [x] Docs (este archivo) + ESTADO + PRODUCTO + ADR

---

## Related Features

- [recetas.md](./recetas.md) — item compuesto que descuenta ingredientes (un
  componente de combo puede ser una receta)
- [grupos-modificadores.md](./grupos-modificadores.md) — combos con elección
  del customer (Ticket B): grupos reutilizables asociables a un combo,
  `disponibleCondicional` cuando el combo tiene ≥1 grupo
- [inventario-kardex.md](./inventario-kardex.md) — movimientos de salida
- [ventas.md](./ventas.md) — flujo de cobro POS
- [motor-calculo-precios.md](./motor-calculo-precios.md) — dónde entra el
  precio propio del combo (como cualquier `precio_base` de item)
- ADR: [012](../adr/012-combos-precio-propio-y-descuento-por-tipo.md) — precio
  propio fijo, una línea de venta, combos no conocen inventario
- ADR: [013](../adr/013-grupos-modificadores-reutilizables.md) — grupos de
  modificadores (elección del customer)
- Spec: [`docs/superpowers/specs/2026-07-20-combos-design.md`](../superpowers/specs/2026-07-20-combos-design.md)

## Notes

**Grupos de modificadores (Ticket B, implementado):** un combo con elección
("elige tu bebida") ahora puede asociar N grupos de modificadores
reutilizables (ver [grupos-modificadores.md](./grupos-modificadores.md)) además
de, o en vez de, sus componentes fijos. El seed demo asocia el grupo "Bebida"
al "Combo Clásico" — su `disponibleCondicional` es `true` desde entonces, y el
cálculo de disponibilidad real depende de la opción que elija el customer
(`Disponible*` en el frontend, no un número fijo). Este archivo (`combos.md`)
sigue describiendo el caso de **componentes fijos**; el caso de elección vive
en `grupos-modificadores.md`.
