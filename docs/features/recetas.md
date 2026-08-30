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
- Venta: expansión a un `salida`/`venta` por ingrediente vía `ItemsService.venderIngredientesReceta`; respuesta con `advertencias`.
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

### GET /items/:id/uso

Antes de confirmar un borrado, clasifica en una sola query (`UNION` sobre los seis
usos posibles) dónde se usa el item: `{ bloqueos: [{tipo, nombre}], advertencias:
[{tipo, nombre}] }`, con `tipo` = `'cuenta' | 'ingrediente' | 'combo' | 'opcion'` en
`bloqueos` y `'extra'` en `advertencias`. Guard `Items:Eliminar` (mismo permiso que el
borrado).

`'cuenta'` es el uso **operativo** —el ítem está pedido en una cuenta de salón abierta—
y va **primero** en el mensaje: los otros tres son de catálogo y el admin los resuelve
cuando quiera, pero una cuenta abierta tiene a alguien esperando en la mesa.

Ese uso operativo se busca por **dos** caminos, y los dos devuelven `'cuenta'` porque el
mensaje es el mismo:

1. **El ítem es la línea** (`cuenta_lineas.item_id`): la hamburguesa que la mesa pidió.
2. **El ítem está adentro de la línea** (`cuenta_lineas.personalizacion`): el queso que
   esa hamburguesa lleva como extra. Se resuelve con containment `jsonb` (`@>`), que
   con la clave ausente devuelve `false` —y no un error—, así que una línea sin
   extras no necesita guarda aparte.

Las dos ramas acotan por `estado = 'abierta'` y por los tres filtros de borrado (línea,
cuenta y mesa): sin el filtro de estado, una cuenta ya cerrada volvería inborrable al
ítem para siempre.

### DELETE /items/:id

**Borrar un ingrediente que se usa como extra.** Ser ingrediente fijo de una receta,
componente de un combo u opción de un grupo (ver
[grupos-modificadores.md](./grupos-modificadores.md)) **bloquea** el borrado con `400`
y los nombres de esos usos: sin ese item la receta, el combo o el grupo quedan
incompletos. Ser **extra permitido** (`receta_extras_permitidos`) no bloquea, porque un
extra es opcional por definición y su ausencia no rompe ninguna receta — pero sí
**advierte**, porque el efecto (dejar de ofrecerse como extra en esas recetas) no es
obvio desde la ficha del ingrediente.

⚠️ **Con una mesa que ya lo pidió, sí bloquea** (desde el 2026-08-30). Un extra es
opcional *antes* de pedirlo; una vez que está en la personalización de una línea de una
cuenta **abierta**, sacarlo del catálogo deja esa mesa **incobrable**: al re-tasar la
línea —en la precuenta y al cerrar— `resolverPersonalizacionReceta` la rechaza con
`400 "Extra no permitido para esta receta"`, y nadie se entera hasta que el garzón
intenta cobrar. El bloqueo sale como `'cuenta'`, con el mismo mensaje *"está pedido en
Mesa 4 · cuenta 1"* del ítem que es la línea. Cancelada o cerrada la cuenta, el
ingrediente vuelve a ser borrable: es un bloqueo por la **mesa viva**, no un
endurecimiento del catálogo. Al confirmar el borrado, se marcan `eliminado_el`
—en la misma transacción que el soft-delete del item— las filas de
`receta_extras_permitidos` en las **dos direcciones**: donde el item borrado es el
**ingrediente extra** (`ingrediente_item_id`) y donde es la **receta** que ofrece ese
extra (`receta_item_id`), para no dejar filas colgando si lo que se borra es la
receta en vez del ingrediente.

### POST /ventas (línea con item tipo receta)

Por cada unidad vendida, un movimiento de salida por ingrediente (cantidad convertida). Bloqueante sin stock → error `'Stock insuficiente para la salida'` aborta la transacción. No bloqueante: se captura solo ese mensaje y se agrega a `advertencias` en la respuesta (sin pre-chequeo racey).

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
- `obtenerUsoItem` (privado) — la query `UNION` de `GET /items/:id/uso`; `remove` la
  reusa dentro de su transacción para decidir si bloquea.

---

## Frontend

- `pages/configuracion/items.vue` — tipo Receta + editor de filas (ingrediente, cantidad, unidad por magnitud, bloqueante); selector de insumos vía `GET /items?tipo=ingrediente`; costo de solo lectura al editar. Al pedir borrar un item, consulta `GET /items/:id/uso` antes de abrir el modal de confirmación: con `bloqueos` muestra "No se puede eliminar" + motivos y solo el botón "Entendido"; con solo `advertencias` nombra las recetas donde deja de ofrecerse como extra y deja confirmar; sin usos, el texto genérico de siempre.
- `pages/ventas/pos.vue` — fetch paralelo `tipo=producto` y `tipo=receta`; toasts `warning` por cada `advertencias`.
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
- [x] `GET /items/:id/uso` clasifica bloqueos vs advertencias; borrar un extra advierte
      en vez de bloquear
- [x] Unit + E2E
- [x] Docs (este archivo) + ESTADO

---

## Related Features

- [tipo-ingrediente.md](./tipo-ingrediente.md) — tipología de insumos no vendibles
- [conversion-unidades.md](./conversion-unidades.md) — conversión en consumo de ingredientes
- [inventario-kardex.md](./inventario-kardex.md) — movimientos de salida
- [personalizacion-recetas.md](./personalizacion-recetas.md) — omitir/extras antes del carrito
- [grupos-modificadores.md](./grupos-modificadores.md) — una receta puede
  asociar grupos reutilizables además de sus ingredientes fijos (ej. "elige tu
  proteína"); a diferencia de un ingrediente fijo, una opción de grupo elegida
  siempre es bloqueante
- [ventas.md](./ventas.md) — flujo de cobro POS
- Spec: [`docs/superpowers/specs/2026-07-15-recetas-criticidad-ingredientes-design.md`](../superpowers/specs/2026-07-15-recetas-criticidad-ingredientes-design.md)
- Análisis cluster: [`docs/superpowers/specs/2026-07-14-alineamiento-cliente-foodservice-analisis.md`](../superpowers/specs/2026-07-14-alineamiento-cliente-foodservice-analisis.md)
