# Diseño — Ticket A: Items tipo combo

**Status**: Draft
**Date**: 2026-07-20
**Owner**: SDD Team
**Reemplaza (junto con [grupos-modificadores](2026-07-20-grupos-modificadores-design.md))**: [2026-07-19-combos-grupos-modificadores-design.md](2026-07-19-combos-grupos-modificadores-design.md)

---

## Context

El cluster food-service ya tiene items `tipo='receta'` (composición que descuenta stock de
ingredientes) y personalización de recetas antes del carrito (omitir, extras con cargo,
comentario). Falta un item vendible que **agrupe otros items vendibles**: un combo
(1 hamburguesa + 1 papas + 1 bebida). No tiene stock propio; al venderse descuenta el stock
de sus componentes, igual que una receta descuenta ingredientes.

Este ticket entrega el **combo con componentes fijos**, autocontenido y shippeable solo. La
elección de opciones dentro del combo ("elige tu bebida") es una capacidad transversal que
llega en el [Ticket B — Grupos de modificadores](2026-07-20-grupos-modificadores-design.md);
por eso aquí un combo se agrega al carrito con un click, sin drawer de elección.

## Scope

**Incluido**
- `items.tipo = 'combo'` + extensión `item_combo` + `combo_componentes`.
- Componentes fijos (`producto` | `receta` | `servicio`, mezclables) con flag `bloqueante`.
- Cálculo de `item_combo.costo_actual` (Σ costo componente × cantidad, cacheado).
- `disponible` del combo en el listado, calculado solo sobre componentes fijos bloqueantes.
- Consumo de inventario de los componentes al vender (una sola línea de venta por combo).
- Editor de combo en Configuración → Items.
- Combo en la grid del POS/Salones (badge de disponibilidad; se agrega con un click).
- Impresión térmica del combo con sus componentes fijos.
- Seed demo, tests unit + E2E, documentación viva.

**No incluido (Ticket B o futuro)**
- Grupos de modificadores / elección de opciones dentro del combo → Ticket B.
- Badge `Disponible*` condicional por grupos agotados → Ticket B (aquí `disponible` es firme).
- Combos anidados (un combo como componente de otro).
- Precio del combo calculado como suma de componentes con descuento (el precio es propio y fijo).
- Canal **online** (tienda): la venta se crea después de cobrar; stock agotado post-pago es una
  regla de negocio aparte.

---

## Decisiones tomadas

| # | Decisión | Alternativa descartada | Razón |
|---|---|---|---|
| A1 | Componentes: `producto`, `receta`, `servicio` (mezclables) | solo producto/receta; o anidar combos | cubre "combo con delivery"; anidar repite el problema ya descartado en recetas anidadas |
| A2 | El combo tiene **precio propio fijo** | suma de componentes − descuento | consistente con receta; cambiar el precio de un componente no mueve silenciosamente el del combo |
| A3 | Componentes fijos con flag `bloqueante` | siempre obligatorios | reusa la semántica probada de ingredientes de receta |
| A4 | Una sola línea de venta por combo | línea + sublíneas; explotar en N líneas | idéntico a receta; mantiene reportes, notas de crédito y motor de precios coherentes |
| A5 | `disponible` = mínimo entre componentes fijos **bloqueantes** | considerar el mejor caso | el badge no promete disponibilidad que un componente concreto no cumple |
| A6 | Combos no conocen inventario: el motor de venta decide el efecto de stock | combo con reglas de stock propias | separa responsabilidades; el combo solo define composición, la venta descuenta |
| A7 | Canales: POS + Salones | incluir tienda online | online crea la venta después de cobrar; stock agotado post-pago es regla aparte |

---

## Modelo de datos

### `item_combo` (1:1 con `items` tipo combo)

| Columna | Tipo | Notas |
|---|---|---|
| `item_id` | UUID PK/FK → items | |
| `costo_actual` | NUMERIC(18,4) | Σ (costo del componente × cantidad); cacheado, no se recalcula solo |

### `combo_componentes`

| Columna | Tipo | Notas |
|---|---|---|
| `combo_componente_id` | UUID PK | |
| `tenant_id` / `combo_item_id` | UUID | |
| `componente_item_id` | UUID | `producto` \| `receta` \| `servicio` |
| `cantidad` | NUMERIC(18,4) | > 0 |
| `bloqueante` | BOOLEAN | default `true` |
| timestamps + `eliminado_el` | TIMESTAMPTZ | soft delete |

Índice único parcial: `(combo_item_id, componente_item_id) WHERE eliminado_el IS NULL`.

Todas las columnas PK/FK UUID declaran `type: 'uuid'` explícito (ADR-004).

### Reglas de integridad

- Componente de combo: item `tipo` ∈ `{producto, receta, servicio}`; nunca `combo` ni `suscripcion`.
- Un combo requiere **al menos un componente fijo**. (En el Ticket B esta regla se relaja a
  "al menos un componente fijo **o** un grupo asociado".)
- Soft delete bloqueado con `400` + nombres afectados cuando el item es componente de un combo vivo.

---

## Backend

### Extensiones a `ItemsModule`

Entidades nuevas: `ItemCombo`, `ComboComponente`. Sin módulo nuevo.

- `POST /items` con `tipo: 'combo'` → `componentes: [{ componenteItemId, cantidad, bloqueante }]`.
  Calcula `item_combo.costo_actual` con Decimal.js, 4 decimales.
- `PATCH /items/:id` — reemplazo total de componentes (soft-delete + insert).
- `GET /items?tipo=combo` — incluye `disponible`: mínimo entre componentes fijos **bloqueantes**
  (`producto` → `floor(stock/cantidad)`; `receta` → `floor(disponibleReceta/cantidad)`;
  `servicio` ignorado). `null` si no hay componentes bloqueantes.
- `GET /items/:id` — combo devuelve `componentes[]` con stock actual de cada uno.
- `DELETE /items/:id` — bloqueo según las reglas de integridad.

`tenant_id` siempre del token, nunca del body.

### Venta

`VentasService.crearEnTransaccion` delega en `ItemsService`, sin dependencias nuevas en Ventas
(mismo patrón que `venderIngredientesReceta`):

- `venderComponentesCombo(comboItemId, cantidadVendida, manager)` — por componente fijo:
  `producto` → `registrarMovimiento` salida; `receta` → `venderIngredientesReceta`;
  `servicio` → nada. Todo × `cantidadVendida`.

Semántica de fallo:

- Componente **bloqueante** sin stock → aborta la transacción.
- Componente **no bloqueante** sin stock → se omite, se agrega a `advertenciasReceta`
  (se reusa el mismo campo de respuesta).

### Precio

El combo entra al motor de precios existente con su **precio propio fijo**:
`precioNeto → descuentos → recargos → impuestos`. Sin cálculo de precio paralelo. Todo con Decimal.js.

---

## Frontend

### Configuración → Items (`pages/configuracion/items.vue`)

- Tipo **Combo** en el selector, con editor de componentes (item vendible + cantidad +
  `bloqueante`), reusando el componente visual del editor de ingredientes de receta.
- Costo del combo en solo lectura al editar.

### POS y Salones

- `CatalogoGrid.vue` suma `tipo=combo` al fetch paralelo, con el badge de disponibilidad
  ("Disponibles: N", atenuado en 0, **nunca bloquea el click**).
- Un combo (que en este ticket nunca tiene grupos) se agrega con un click, como un producto.
  No abre drawer.
- El merge de líneas en Salones no cambia: un combo sin personalización se fusiona como cualquier item.
- Sin `cargar()` post-mutación: el backend devuelve la entidad o patch mergeable.
- Formatos vía `useFormatters`; tokens semánticos de Nuxt UI, sin Tailwind hardcodeado.

### Impresión térmica

El texto del combo lista sus componentes fijos: `Combo Clásico — Hamburguesa Clásica, Papas`.

---

## Verification

### Tests

- **Unit `items.service.spec.ts`** — alta/edición de combo, cálculo de `costo_actual`,
  `disponible` con componentes producto + receta + servicio, bloqueo de borrado de un item usado
  como componente.
- **Unit `ventas.service.spec.ts`** — combo con componente receta (expansión a ingredientes);
  componente no bloqueante sin stock → advertencia; bloqueante sin stock → aborta la transacción.
- **E2E `combos.e2e-spec.ts`** — crear combo con componentes fijos → vender → verificar los
  movimientos de inventario de cada componente y el total cobrado.

### Seed

`seeder.service.ts`, un método privado por entidad, IDs con el patrón
`550e8400-e29b-41d4-a716-446655440XXX` (usar el siguiente número libre):

- Combo demo "Combo Clásico": Hamburguesa Clásica ×1 (receta) + Papas ×1 (producto), ambos
  bloqueantes, con precio propio fijo.

### Documentación (mismo commit que el código)

- `docs/features/combos.md` desde `TEMPLATE.md`, con link en `docs/README.md`.
- Fila en `docs/ESTADO.md`; reglas de negocio en `docs/PRODUCTO.md`.
- **ADR nuevo**: combo con precio propio fijo y una sola línea de venta; combos no conocen
  inventario (el motor de venta descuenta).

---

## Riesgos asumidos

- **`disponible` conservador**: refleja solo componentes fijos bloqueantes. En el Ticket B, un
  combo con grupos mostrará `Disponible*` porque la disponibilidad final depende de la opción elegida.
- **`costo_actual` cacheado**: no se recalcula solo cuando cambia el costo de un componente; se
  recalcula al editar el combo. Aceptado (mismo trato que otros costos cacheados).

---

## Related

- [recetas.md](../../features/recetas.md) — item compuesto que descuenta ingredientes
- [inventario-kardex.md](../../features/inventario-kardex.md) — movimientos de salida
- [ventas.md](../../features/ventas.md) — flujo de cobro POS
- [motor-calculo-precios.md](../../features/motor-calculo-precios.md) — dónde entra el precio del combo
- [Ticket B — Grupos de modificadores](2026-07-20-grupos-modificadores-design.md) — elección de opciones dentro del combo
