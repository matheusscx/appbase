# Feature: Tipo de item `ingrediente` (insumos no vendibles)

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-15

---

## Overview

### What is it?

Un item `tipo='ingrediente'` representa un **insumo de cocina no vendible** (Carne molida, Pan, Queso, etc.) que comparte la extensión `item_producto` con los productos de catálogo, pero con reglas distintas: precio de venta forzado a `0`, inventario solo en modo `cantidad`, sin impuestos/recargos/descuentos ni serie/lote. Se filtra en Configuración → Items, se usa como único tipo admisible en `receta_ingredientes`, aparece en inventario y mermas, y **no** puede venderse en POS ni tienda.

### Why does it exist?

Food-service mezclaba insumos y productos vendibles bajo `tipo='producto'`, contaminando listados y selectores. La tipología explícita permite filtrar insumos, endurecer recetas y excluir líneas de venta sin duplicar el modelo de stock/costo/unidad.

### Scope

**Included:**
- Nuevo valor `items.tipo = 'ingrediente'` + extensión `item_producto` (misma 1:1 que `producto`).
- Reglas en create/update: `precio_base = 0` forzado; `modo_inventario = 'cantidad'` fijo; rechazo de N:M impuestos/recargos/descuentos y serie/lote.
- Recetas: `validarYCostearIngredientes` exige `tipo = 'ingrediente'`.
- Ventas: rechazo de líneas que referencian un ingrediente.
- Mermas y ajuste de stock: aceptan `producto | ingrediente`.
- Simulador de desfases: aplica al cambiar costo de un ingrediente usado en recetas.
- Frontend: filtro/form/badge en Configuración → Items; selector de insumos de receta; merge `producto` + `ingrediente` en inventario y mermas.
- Seed demo: Pan de hamburguesa, Carne molida, Queso laminado → `ingrediente`, `precio_base = 0` (IDs 0256–0258).

**NOT included (future):**
- Cambiar `tipo` en `PATCH` (producto ↔ ingrediente).
- Producto vendible que también sea insumo de receta.
- `precio_base` distinto de 0 en ingredientes.
- API multi-tipo en query (`tipo=producto,ingrediente`); el frontend hace `Promise.all` de dos fetches.

---

## Modelo de datos

Sin tabla nueva. `items.tipo` admite:

`'producto' | 'servicio' | 'suscripcion' | 'receta' | 'ingrediente'`

`item_producto` se usa para `producto` **e** `ingrediente` (misma extensión 1:1).

| Regla | Valor / comportamiento |
|--------|------------------------|
| `precio_base` | Siempre `0` (backend ignora valor enviado) |
| `modo_inventario` | Siempre `cantidad` |
| Impuestos / recargos / descuentos | Rechazados en create/update |
| Serie / lote | Rechazados en create |
| Vendible | No (POS, tienda, líneas de venta) |
| Insumo de receta | Sí (único tipo admisible) |
| Merma / kardex | Sí (como producto cantidad) |

`receta_ingredientes.ingrediente_item_id` referencia un item `tipo='ingrediente'` con extensión `item_producto`.

---

## API

### POST /items — `tipo: 'ingrediente'`

```
POST /api/items
Authorization: Bearer <token>

Request:
{
  "nombre": "Carne molida",
  "precioBase": "999",
  "monedaId": "<uuid>",
  "tipo": "ingrediente",
  "unidadMedida": "kg",
  "costo": "8000",
  "stock": "10"
}

Response (201): { "id": "<uuid>" }
```

El backend persiste `precio_base = '0'` aunque llegue `precioBase` distinto. Rechaza `modoInventario !== 'cantidad'`, `series`, `lote`, `impuestosIds`, `recargosIds`, `descuentosIds`.

### PATCH /items/:id

Actualiza campos de `item_producto` (costo, unidad, stock directo) como producto cantidad. Si llega `precioBase`, se fuerza `0`. No permite cambiar `tipo` (`UpdateItemDto` no incluye `tipo`).

### GET /items?tipo=ingrediente

Lista solo insumos del tenant. Incluye `stock`, `unidadMedida`, `costoActual` como productos cantidad. `disponible` es `null` (solo aplica a recetas).

### PATCH /items/:id/stock (ajustarStock)

Acepta items `producto | ingrediente` en modo cantidad.

### POST /ventas

Si alguna línea referencia un item `tipo='ingrediente'`:

```
400 Bad Request — "Los ingredientes no se pueden vender directamente"
```

### POST /mermas

Acepta `itemId` de tipo `producto` o `ingrediente` (modo cantidad). Mensaje si otro tipo:

```
400 — "Solo se puede mermar un producto o un ingrediente"
```

### Recetas (POST/PATCH /items con `tipo: 'receta'`)

`validarYCostearIngredientes` exige cada insumo con `tipo = 'ingrediente'` y `modo_inventario = 'cantidad'`. Un `producto` vendible como insumo → `400`.

---

## Backend

- **Módulo**: `ItemsModule` — lógica en `ItemsService.create`, `update`, `ajustarStock`, `validarYCostearIngredientes`, `recetasAfectadasPorIngrediente`.
- **Ventas**: `VentasService.crearEnTransaccion` — chequeo tras cargar items.
- **Mermas**: `MermasService.registrar` — amplía validación de tipo.
- **DTOs**: `CreateItemDto`, `QueryItemsDto` — `@IsIn` incluye `'ingrediente'`.

### Key methods

- `create` — rama inventariable compartida `producto | ingrediente`; defaults forzados para ingrediente.
- `update` — misma rama; `precio_base = '0'` si tipo ingrediente.
- `validarYCostearIngredientes` — solo `tipo === 'ingrediente'`.
- `ajustarStock` — `producto | ingrediente`.

---

## Frontend

- `pages/configuracion/items.vue` — filtro y selector "Ingrediente"; formulario sin precio/modo/impuestos; badge warning; selector de insumos de receta vía `GET /items?tipo=ingrediente`; simulador de desfases al editar costo de ingrediente.
- `pages/configuracion/inventario.vue` — `Promise.all` de `tipo=producto` + `tipo=ingrediente`, merge por nombre.
- `pages/configuracion/mermas.vue` — mismo merge para selector de item.
- POS / tienda / salones — sin cambios (`?tipo=producto` / `receta` / `suscripcion`).

---

## Seed

En `seeder.service.ts` → `seedRecetaDemo()`:

| Item | ID | tipo | precio_base |
|------|-----|------|-------------|
| Pan de hamburguesa | `550e8400-e29b-41d4-a716-446655440256` | `ingrediente` | `0` |
| Carne molida | `550e8400-e29b-41d4-a716-446655440257` | `ingrediente` | `0` |
| Queso laminado | `550e8400-e29b-41d4-a716-446655440258` | `ingrediente` | `0` |
| Hamburguesa Clásica | `550e8400-e29b-41d4-a716-446655440259` | `receta` | `3500` |

Migración idempotente: si la DB ya tenía los tres insumos como `producto`, un `UPDATE` los convierte a `ingrediente` + `precio_base = 0` en cada arranque del seeder.

---

## Testing

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts src/modules/ventas/ventas.service.spec.ts src/modules/mermas/mermas.service.spec.ts --no-coverage
```

| Caso | Expectativa |
|---|---|
| Create `ingrediente` con `precioBase: "999"` | `precio_base = 0` |
| Create con `modoInventario: 'serie'` | 400 |
| Create con `impuestosIds` | 400 |
| Receta con insumo `producto` | 400 |
| Receta con insumo `ingrediente` | OK + costeo |
| Venta línea `ingrediente` | 400 |
| Merma sobre `ingrediente` | OK |
| `GET /items?tipo=ingrediente` | Solo insumos |
| Seed hamburguesa | Sigue costando/descontando stock |

### Verificación manual

1. Filtrar Items → Ingrediente: aparecen Carne molida / Pan / Queso.
2. Crear ingrediente: sin campo precio; costo/stock editables.
3. Editar receta: selector solo muestra ingredientes.
4. POS: no lista insumos; venta API con ingrediente → 400.
5. Inventario y Mermas: permiten elegir insumos.
6. Cambiar costo de Carne molida → simulador de desfases funciona.

---

## Acceptance Criteria

- [x] DTOs y create/update con tipo `ingrediente`
- [x] Recetas solo aceptan insumos `ingrediente`
- [x] Ventas rechazan líneas de ingrediente
- [x] Mermas e inventario incluyen ingredientes
- [x] Seed migrado (Pan/Carne/Queso)
- [x] Frontend filtro/form/selectores
- [x] Unit tests
- [x] Docs (este archivo) + ESTADO

---

## Related Features

- [recetas.md](./recetas.md) — consumo de ingredientes al vender recetas
- [inventario-kardex.md](./inventario-kardex.md) — movimientos de stock
- [mermas-valorizadas.md](./mermas-valorizadas.md) — mermas sobre productos e ingredientes
- [simulador-impacto-costos.md](./simulador-impacto-costos.md) — desfases al cambiar costo de insumo
- Spec: [`docs/superpowers/specs/2026-07-15-tipo-ingrediente-design.md`](../superpowers/specs/2026-07-15-tipo-ingrediente-design.md)
