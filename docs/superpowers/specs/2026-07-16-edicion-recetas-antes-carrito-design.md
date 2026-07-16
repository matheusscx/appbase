# Diseño — Edición de recetas antes de agregar al carrito

**Status**: Done
**Date**: 2026-07-16
**Owner**: Cesar Matheus
**Depends on**: [Recetas + criticidad de ingredientes](./2026-07-15-recetas-criticidad-ingredientes-design.md)

## Context

Hoy, al seleccionar una receta en el catálogo (POS o Salones), se agrega de inmediato
al carrito/cuenta con la configuración por defecto. El cliente food-service necesita
personalizar el plato **antes** de confirmarlo: quitar ingredientes (“sin cebolla”),
agregar extras permitidos (“extra queso”) y dejar un comentario libre (“término medio”).

La configuración de qué extras están permitidos (y a qué precio) vive en la receta.
El stock de ingredientes opcionales y de extras se valida en el drawer: sin stock
siguen visibles con warning y no seleccionables. Los bloqueantes mantienen la lógica
existente al vender.

## Scope

**Incluido:**
- Drawer de personalización al click en receta (POS y Salones); productos siguen
  agregándose directo.
- Configurar `extrasPermitidos` al crear/editar una receta (ingrediente + cantidad +
  unidad + `precioExtra` por porción).
- Snapshot de personalización en la línea: omitidos, extras elegidos, comentario.
- Precio cobrado = `precioBase` de la receta + Σ `precioExtra` de extras (omitir no
  rebaja).
- Persistencia del snapshot en **Salones** (`cuenta_lineas`); POS sigue en memoria
  como hoy.
- Al vender / cerrar cuenta: descontar inventario según el snapshot (base − omitidos
  + extras), no la receta “tal cual”.
- Comanda: incluir texto derivado del snapshot.
- Validación de stock en el drawer para opcionales y extras (warning + disabled).

**NO incluido:**
- Persistir carrito del POS (draft / localStorage) — mismo riesgo de pérdida que hoy.
- Recálculo de precio al omitir ingredientes.
- Cantidad libre de extras en el drawer (un extra = la porción configurada).
- Editar personalización de una línea ya agregada (quitar y volver a agregar).
- Tienda online / canal online.
- Extras bloqueantes configurables (MVP: extras se tratan como no bloqueantes al vender).

## Decisions

| Decisión | Elección | Razón |
|---|---|---|
| Alcance de pantallas | POS **y** Salones | Ambos usan `VentasCatalogoGrid`; misma UX de selección |
| Precio | Base fijo + cargo por extra; omitir no rebaja | Cobra extras sin tocar motor de precios complejo |
| Cargo del extra | `precioExtra` por asociación receta↔ingrediente | Mismo ingrediente puede costar distinto según plato |
| Representación | Snapshot estructurado + comentario libre | Stock/cocina coinciden con lo pedido; notas tipo “término” |
| Persistencia POS | Memoria (`useVenta`) | Sin cambiar el contrato actual del POS |
| Persistencia Salones | JSONB en `cuenta_lineas.personalizacion` | Cuenta grande sobrevive refresh/corte de luz |
| Merge de líneas en cuenta | Solo si mismo `itemId` **y** misma personalización | Dos “hamburguesa sin cebolla” se suman; distinta nota = línea aparte |
| Precio en venta | Backend recalcula base + extras validados | No confiar en `precioUnitario` del cliente |
| Extra sin stock al vender | Tratar como no bloqueante (omitir + advertencia) | Alineado con ingredientes no bloqueantes; el drawer ya bloquea selección |
| Un extra en el drawer | On/off de la porción configurada | YAGNI: sin spinner de cantidad en MVP |

## Modelo de datos

### `receta_extras_permitidos`

| Columna | Tipo | Notas |
|---|---|---|
| `receta_extra_id` | `UUID` PK | |
| `tenant_id` | `UUID` NOT NULL, FK `tenants` | Filtro obligatorio |
| `receta_item_id` | `UUID` NOT NULL, FK `items` | Item `tipo='receta'` |
| `ingrediente_item_id` | `UUID` NOT NULL, FK `items` | Item `tipo='ingrediente'`, modo `cantidad` |
| `cantidad` | `NUMERIC(18,4)` NOT NULL | Por 1 unidad de la receta al elegir el extra |
| `unidad_codigo` | `TEXT` NOT NULL, FK `unidades_medida` | Misma magnitud que la unidad base del ingrediente |
| `precio_extra` | `NUMERIC(18,4)` NOT NULL | Cargo unitario por porción de receta (≥ 0) |
| `creado_el` / `actualizado_el` / `eliminado_el` | `TIMESTAMPTZ` | Soft delete |

Índice único parcial `(receta_item_id, ingrediente_item_id) WHERE eliminado_el IS NULL`.

Un mismo ingrediente **puede** ser base de la receta y extra permitido (“extra porción”).

### Snapshot `personalizacion` (JSONB / objeto en memoria)

```ts
{
  omitidos: string[]  // ingredienteItemId quitados de la receta base
  extras: {
    ingredienteItemId: string
    cantidad: string
    unidadCodigo: string
    precioExtra: string  // congelado al confirmar (auditoría)
  }[]
  comentario?: string  // max 200 chars
}
```

Columnas nuevas:
- `cuenta_lineas.personalizacion` JSONB NULL
- `venta_detalles.personalizacion` JSONB NULL (auditoría al cerrar / vender)

## Backend

### Items — create/update/findOne

- DTO: `extrasPermitidos?: { ingredienteItemId, cantidad, unidadCodigo, precioExtra }[]`.
- Validar igual que ingredientes (existe, tipo ingrediente, modo cantidad, unidad
  convertible) + `precioExtra` number-string ≥ 0.
- Soft-delete + INSERT al reemplazar lista (mismo patrón que `receta_ingredientes`).
- Respuestas POST/PATCH/GET incluyen `extrasPermitidos` mergeable (sin findOne post-write).

### Ventas — `LineaVentaDto`

- `personalizacion?` opcional.
- Al crear venta de receta:
  1. Validar omitidos ⊆ ingredientes de la receta.
  2. Validar cada extra ∈ `receta_extras_permitidos` vivos; usar cantidad/unidad/precio
     del catálogo (congelar en snapshot persistido).
  3. `precioUnitario` efectivo = `item.precioBase + Σ precioExtra` (convertido a moneda
     oficial como hoy).
  4. `venderIngredientesReceta` recibe el snapshot: ingredientes base − omitidos + extras;
     bloqueantes/no bloqueantes sobre ese set; extras siempre rama no bloqueante.

### Salones — líneas

- `AddLineaDto` acepta `personalizacion?`.
- Merge: misma clave `(itemId, hash estable de personalizacion)`; si no coincide, línea nueva.
- `cerrarCuenta` pasa `personalizacion` a `CreateVentaDto.lineas`.
- Comanda (`preview`/`reclamar`): cada item incluye texto derivado, p. ej.
  `Sin cebolla · Extra queso · término medio`.

## Frontend

### Configuración (`items.vue`)

Sección bajo ingredientes de receta: lista editable de extras permitidos
(ingrediente, cantidad, unidad, `precioExtra` con `MoneyInput`), mismo patrón add/remove
de filas que ingredientes.

### Drawer compartido

Componente nuevo (p. ej. `VentasRecetaPersonalizacionDrawer`):
- Props: `itemId` / detalle de receta con ingredientes + extras + stock.
- Emite `confirm(personalizacion)` / cancela.
- UI: toggles omitir; lista extras (checkbox); comentario; warning + disabled si stock ≤ 0
  en opcionales y extras.
- Datos: `GET /items/:id` al abrir (incluye stock de cada ingrediente/extra vía join o
  campos en la respuesta de detalle).

### POS (`pos.vue`)

- `VentasCatalogoGrid`: en receta emitir `select`/`customize` en vez de `add` directo
  (o el padre intercepta por `tipo === 'receta'`).
- Abrir drawer → al confirmar, `add` con personalización; línea en memoria.
- `CarritoPanel`: mostrar resumen corto de personalización bajo el nombre.
- `POST /ventas` envía `personalizacion` por línea.

### Salones (`salones/index.vue`)

- Misma interceptación de click en receta → drawer.
- Al confirmar: `agregarLinea(..., personalizacion)` → BD.
- Lista de líneas: mostrar resumen + comentario.
- Comanda/precuenta: consumir texto que venga del backend o armarlo en FE desde el snapshot.

## Error handling

| Caso | Comportamiento |
|---|---|
| Extra no permitido | `400` |
| Omitido ajeno a la receta | `400` |
| Comentario > 200 | `400` / validación FE |
| Extra sin stock al vender (carrera) | Omitir descuento + `advertenciasReceta` |
| Bloqueante restante sin stock | Abortar venta/cierre (igual que hoy) |

## Testing

- Backend unit: CRUD extras; precio base+extras; stock con omitidos/extras; merge de
  líneas de cuenta por personalización; rechazo de extra inválido.
- Frontend unit: helpers del drawer (omitir, sumar cargos, disabled sin stock).
- Sin E2E Playwright obligatorio en este ticket.

## Verification (manual)

1. Crear receta con ingredientes + extras con `precioExtra`.
2. POS: click receta → drawer → omitir + extra + comentario → carrito muestra resumen y
   total con cargo; cobro descuenta stock del snapshot.
3. Salones: igual; refresh del browser → la línea y personalización siguen; comanda
   muestra omitidos/extras/comentario.
4. Extra sin stock: visible con warning, no seleccionable.
5. Producto en catálogo: sigue agregándose con un click.
