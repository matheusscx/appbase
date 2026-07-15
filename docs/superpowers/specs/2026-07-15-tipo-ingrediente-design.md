# Diseño — Tipo de item `ingrediente`

**Status**: Done
**Date**: 2026-07-15
**Owner**: Cesar Matheus
**Context**: food-service — separar insumos no vendibles de productos de catálogo
para filtrar y para endurecer reglas de recetas / POS.

## Context

Hoy los insumos de receta (Carne molida, Pan, Queso, etc.) son `items.tipo =
'producto'`. Comparten filtro, listados de inventario y selector de catálogo con
productos vendibles. Eso **impide filtrar insumos** en Configuración → Items y
contamina mentalmente el catálogo (aunque el POS ya pide `?tipo=producto` /
`?tipo=receta`).

El cluster de recetas/costos ya asume que un insumo de receta es un item con
extensión `item_producto`, `modo_inventario = 'cantidad'` y `costo_actual`. Falta
una tipología explícita que:

1. Permita filtrar por tipo en el CRUD de items.
2. Excluya el ítem de venta (POS / tienda / líneas de venta).
3. Sea el **único** tipo admisible en `receta_ingredientes`.

## Scope

**Incluido:**
- Nuevo valor `items.tipo = 'ingrediente'`.
- Misma extensión `item_producto` (stock, unidad, costo, modo).
- Reglas: `precio_base = 0` forzado; `modo_inventario = 'cantidad'` fijo; no
  serie/lote; no impuestos/recargos/descuentos.
- Recetas: solo aceptan insumos `tipo = 'ingrediente'`.
- Ventas: rechazo si una línea referencia un `ingrediente`.
- Stock, Kardex, mermas, simulador de desfases: tratan `ingrediente` como
  inventariable (junto a `producto` donde aplique).
- Frontend: filtro + formulario + selectores (receta / inventario / mermas).
- Seed: Carne molida, Pan de hamburguesa, Queso laminado → `ingrediente`,
  `precio_base = 0`.
- Docs: `startup-pos.sql` comentarios + feature/`ESTADO` si corresponde.

**NO incluido:**
- Convertir `tipo` en `PATCH` (producto ↔ ingrediente).
- Producto vendible que también sea insumo de receta.
- `precio_base` distinto de 0 en ingredientes.
- Cambios al motor de precios o al cálculo de margen de recetas (siguen usando
  el `precio_base` de la **receta**).

## Decisions

| Decisión | Elección | Razón |
|---|---|---|
| Modelado | Nuevo `items.tipo = 'ingrediente'` + fila en `item_producto` | Filtro nativo; reusa stock/costo/unidad ya existentes |
| Vendible | No | Insumo de cocina, no línea de POS |
| Precio | UI oculta; backend fuerza `0` | Columna NOT NULL en `items`; el dato relevante es el costo |
| Modo inventario | Solo `cantidad` | Compatible con descuento de stock en recetas |
| Insumos de receta | Solo `ingrediente` | Evita mezcla producto vendible / insumo |
| Cambio de tipo en update | Prohibido | YAGNI; evita edge cases de historial/POS |
| Impuestos N:M en create | Rechazar si vienen | No dejar relaciones muertas en un no-vendible |
| Inventario / mermas | Incluyen `producto` e `ingrediente` | Ambos tienen stock valorizable |

## Backend

### Modelo

Sin tabla nueva. `items.tipo` pasa a documentarse como:

`'producto' | 'servicio' | 'suscripcion' | 'receta' | 'ingrediente'`

`item_producto` se usa para `producto` **e** `ingrediente` (misma extensión 1:1).

Comentarios a actualizar en `startup-pos.sql` (items.tipo, `receta_ingredientes`,
kardex). No hace falta CHECK en SQL si el resto del schema tampoco lo impone
(consistente con el patrón actual TEXT libre + validación en DTO).

### DTOs

- `CreateItemDto` / `QueryItemsDto`: `@IsIn` incluye `'ingrediente'`.
- `precioBase`: sigue siendo `@IsNumberString` opcional en la práctica vía
  pipeline de create — si `tipo === 'ingrediente'`, el service **ignora** el
  valor enviado y persiste `'0'`.
- Create/update: si `tipo === 'ingrediente'` y llegan `impuestosIds` /
  `recargosIds` / `descuentosIds` / `series` / `lote` / `modoInventario !==
  'cantidad'` → `BadRequestException`.

### `ItemsService`

- `create`: rama inventariable compartida `producto | ingrediente` (insert
  `item_producto`, stock inicial vía kardex como hoy). Diferencias solo en
  defaults/forzados listados arriba.
- `update`: misma rama para campos de `item_producto`; **no** permite cambiar
  `tipo` (el DTO de update ya no trae `tipo` hoy — mantenerlo así).
- `ajustarStock` / `findUnidades` / `findLotes`: aceptar `producto |
  ingrediente` (lotes/series no deberían existir para ingredientes; unidades /
  lotes responden vacío o 400 si se intenta modo distinto — con modo fijo
  cantidad, los endpoints de unidades/lotes pueden seguir exigiendo producto
  modo serie/lote o devolver 400).
- `validarYCostearIngredientes` / `recetasAfectadasPorIngrediente`: exigir
  `tipo = 'ingrediente'` (y `modo_inventario = 'cantidad'`).
- Helpers que hoy filtran `tipo = 'producto'` para stock/desfases: ampliar a
  `tipo IN ('producto', 'ingrediente')` o solo `'ingrediente'` según el caso
  (desfase por insumo: el item gatillante es el ingrediente).

### Ventas / mermas

- Al resolver líneas de venta: si `item.tipo === 'ingrediente'` →
  `BadRequestException` (“Los ingredientes no se pueden vender directamente”).
- `MermasService`: aceptar `tipo IN ('producto', 'ingrediente')` (hoy solo
  producto).

### Seed

Carne molida, Pan de hamburguesa, Queso laminado:

- `tipo = 'ingrediente'`
- `precio_base = 0`
- resto igual (categoría, costo, unidad, stock, receta de hamburguesa).

## Frontend

### `/configuracion/items`

- Filtro y selector de tipo: opción **Ingrediente**.
- Formulario `tipo === 'ingrediente'`:
  - Mostrar: nombre, descripción, moneda, categoría, unidad, costo, stock
    inicial (create), activo.
  - Ocultar: precio base, modo inventario (implícito cantidad), serie/lote,
    impuestos/recargos/descuentos.
- Listado: badge/label “Ingrediente”; columnas de stock/costo como producto.
- Selector de insumos al editar receta: `GET /items?tipo=ingrediente&pageSize=…`.

### Inventario / Mermas

- Dejar de pedir solo `?tipo=producto`. Opciones aceptables:
  - dos requests (`producto` + `ingrediente`), o
  - ampliar API con multi-tipo (p.ej. sin `tipo` + filtro client-side, o query
    `tipo` repetido) — **preferir** dos fetch o un único listado sin filtro de
    tipo y filtrar client-side a inventariables, sin inventar API nueva si no
    hace falta.
- Recomendación concreta: `Promise.all` de `tipo=producto` y
  `tipo=ingrediente`, merge por nombre.

### POS / tienda / salones

- Sin cambio de queries (`producto` / `receta` / `suscripcion`). Los
  ingredientes no aparecen.

## Testing

| Caso | Expectativa |
|---|---|
| Create `ingrediente` con `precioBase: "999"` | Persiste `precio_base = 0` |
| Create con `modoInventario: 'serie'` | 400 |
| Create con `impuestosIds` | 400 |
| Receta con insumo `producto` | 400 |
| Receta con insumo `ingrediente` | OK + costeo |
| Venta línea `ingrediente` | 400 |
| Merma sobre `ingrediente` | OK |
| `GET /items?tipo=ingrediente` | Solo insumos |
| Seed hamburguesa | Sigue costando/descontando stock |

## Verification manual

1. Filtrar Items → Ingrediente: aparecen Carne molida / Pan / Queso; no demos de
   producto.
2. Crear ingrediente nuevo: sin campo precio; costo/stock editables.
3. Editar receta: selector solo muestra ingredientes.
4. POS: no lista insumos; intento API de venta → 400.
5. Inventario y Mermas: permiten elegir insumos.
6. Cambiar costo de Carne molida → simulador de desfases sigue funcionando.

## Self-review

- [x] Sin placeholders ni TODOs abiertos en este doc.
- [x] Consistente con decisiones de brainstorming (A/A/A/A).
- [x] Alcance acotado; conversión de tipo fuera.
- [x] Inventario/mermas explícitamente actualizados (riesgo de regressión si se
      olvidan).
- [x] Comentarios SQL / mensajes de error a alinear con el nuevo tipo.
