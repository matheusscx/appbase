# Feature: Personalización de recetas antes del carrito

**Status**: Complete  
**Owner**: SDD Team  
**Last Updated**: 2026-07-16

---

## Overview

### What is it?

Al seleccionar una **receta** en el catálogo (POS o Salones), se abre un drawer de personalización antes de agregar la línea al carrito o cuenta. El operador puede omitir ingredientes de la receta base (“sin cebolla”), elegir **extras permitidos** con cargo indicando **cuántas unidades** de cada uno (“extra queso ×2”, checkbox + stepper) y dejar un comentario libre (“término medio”). Los **productos** (`tipo='producto'`) siguen agregándose con un solo click.

### Why does it exist?

Food-service necesita adaptar el plato al pedido del comensal sin perder trazabilidad de stock ni del cobro. La configuración de qué extras están permitidos y a qué precio vive en la receta; el snapshot congelado en la línea asegura que cocina, inventario y auditoría coincidan con lo vendido.

### Scope

**Included:**
- Drawer de personalización al click en receta (POS y Salones); productos sin cambio.
- Configurar `extrasPermitidos` al crear/editar receta (ingrediente + cantidad + unidad + `precioExtra` por porción).
- Snapshot en la línea: `omitidos`, `extras` elegidos con `unidades`, `comentario` (máx. 200 caracteres).
- Precio cobrado = `precioBase` + Σ (`precioExtra` × `unidades`) de extras; **omitir no rebaja** el precio.
- Persistencia del snapshot en **Salones** (`cuenta_lineas.personalizacion` JSONB); POS en memoria (`useVenta`).
- Al vender / cerrar cuenta: inventario según snapshot (base − omitidos + extras × `unidades`).
- Comanda con texto derivado del snapshot (omitidos, extras, comentario).
- Stock en drawer: ingredientes opcionales y extras sin stock → warning + no seleccionables; bloqueantes mantienen reglas de venta existentes; extras al vender son no bloqueantes (omitir + advertencia si hay carrera).
- Merge de líneas en cuenta solo si mismo `itemId` **y** misma personalización.

**NOT included (future):**
- Persistir carrito del POS (draft / localStorage).
- Recálculo de precio al omitir ingredientes.
- Editar personalización de una línea ya agregada.
- Canal online / tienda.
- Extras bloqueantes configurables.

---

## Modelo de datos

### `receta_extras_permitidos`

| Column | Type | Notes |
|--------|------|-------|
| `receta_extra_id` | UUID PK | |
| `tenant_id` | UUID | Del token |
| `receta_item_id` | UUID | Item `tipo='receta'` |
| `ingrediente_item_id` | UUID | Item `tipo='ingrediente'`, `modo_inventario='cantidad'` |
| `cantidad` | NUMERIC(18,4) | Por 1 unidad de receta al elegir el extra |
| `unidad_codigo` | TEXT FK → unidades_medida | Misma magnitud que la unidad base del ingrediente |
| `precio_extra` | NUMERIC(18,4) | Cargo unitario por porción (≥ 0) |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete al reemplazar lista |

Índice único parcial: `(receta_item_id, ingrediente_item_id) WHERE eliminado_el IS NULL`.

Un mismo ingrediente puede ser base de la receta **y** extra permitido (“extra porción”).

### Snapshot `personalizacion` (JSONB / memoria)

```ts
{
  omitidos: string[]  // ingredienteItemId quitados de la receta base
  extras: {
    ingredienteItemId: string
    cantidad: string     // porción por unidad de extra (del catálogo)
    unidadCodigo: string
    precioExtra: string  // cargo por unidad, congelado al confirmar
    unidades?: string    // cuántas veces se agrega el extra (≥ 1); ausente = 1 (compat)
  }[]
  comentario?: string
}
```

Columnas:
- `cuenta_lineas.personalizacion` JSONB NULL (Salones)
- `venta_detalles.personalizacion` JSONB NULL (auditoría al vender/cerrar)

### Precio

`precioUnitario` efectivo = `item.precioBase + Σ (precioExtra × unidades)` de extras elegidos. El backend recalcula y valida; no confía en el precio enviado por el cliente. Omitir ingredientes **no** reduce el precio.

### Stock

| Contexto | Comportamiento |
|----------|----------------|
| Drawer — opcional / extra sin stock | Visible con warning; toggle/checkbox deshabilitado |
| Drawer — bloqueante sin stock | Receta atenuada en catálogo (`disponible === 0`); reglas existentes |
| Venta — bloqueante restante sin stock | Aborta transacción (igual que recetas base) |
| Venta — extra sin stock (carrera) | Tratado como no bloqueante: omitir descuento + `advertenciasReceta` |

---

## API Endpoints

### POST /items — `tipo: 'receta'` con `extrasPermitidos`

```
POST /api/items
Authorization: Bearer <token>

Request:
{
  "nombre": "Hamburguesa Clásica",
  "precioBase": "3500",
  "monedaId": "<uuid>",
  "tipo": "receta",
  "ingredientes": [ ... ],
  "extrasPermitidos": [
    {
      "ingredienteItemId": "<queso>",
      "cantidad": "20",
      "unidadCodigo": "g",
      "precioExtra": "800"
    }
  ]
}

Response (201): { "id": "<uuid>", "extrasPermitidos": [ ... ], ... }
```

### PATCH /items/:id

Con `extrasPermitidos` (reemplazo total): soft-delete de filas vivas + INSERT de la nueva lista (mismo patrón que `ingredientes`). Respuesta mergeable incluye `extrasPermitidos`.

### GET /items/:id (receta)

Incluye `ingredientes[]` y `extrasPermitidos[]` con `stock` por fila para el drawer. `ingredientes` y `extrasPermitidos` en POST/PATCH/GET sin `findOne` post-write.

### POST /ventas — `lineas[].personalizacion`

```
POST /api/ventas
Authorization: Bearer <token>

Request (fragmento):
{
  "lineas": [
    {
      "itemId": "<receta>",
      "cantidad": "1",
      "personalizacion": {
        "omitidos": ["<ingrediente-opcional>"],
        "extras": [{ "ingredienteItemId": "<queso>", "unidades": 2 }],
        "comentario": "término medio"
      }
    }
  ],
  ...
}
```

Backend: valida omitidos ⊆ ingredientes; extras ∈ `receta_extras_permitidos`; `unidades` entero ≥ 1 (default 1); congela snapshot; recalcula precio (× unidades); `venderIngredientesReceta` con base − omitidos + extras (porción × unidades).

### POST /cuentas/:id/lineas — `personalizacion`

```
POST /api/cuentas/:id/lineas
Authorization: Bearer <token>

Request:
{
  "itemId": "<receta>",
  "cantidad": "1",
  "personalizacion": {
    "omitidos": [],
    "extras": [{ "ingredienteItemId": "<queso>", "unidades": 1 }],
    "comentario": "sin cebolla cruda"
  }
}
```

Merge por `(itemId, hash(personalizacion))`. Al cerrar cuenta, el snapshot pasa a `CreateVentaDto.lineas`.

---

## Backend

- **Módulo items**: entidad `RecetaExtraPermitido`; CRUD de extras en `ItemsService` (create/update/findOne).
- **Ventas**: `LineaVentaDto.personalizacion`; precio y stock con snapshot en `VentasService`.
- **Salones**: `AddLineaDto.personalizacion`; persistencia JSONB; merge; comanda con `nota` (`textoComandaPersonalizacion`).
- **Impresión**: `TicketItem.nota` en comanda / precuenta / boleta (omitidos, extras, comentario).
- **Util**: `personalizacion-receta.util` — hash estable para merge de líneas.

### Key methods

- `ItemsService` — validar/persistir `extrasPermitidos`; detalle con stock.
- `VentasService.crearEnTransaccion` — recalcular precio + snapshot en `venta_detalles`.
- `ItemsService.venderIngredientesReceta` — consumo según snapshot.
- `SalonesService.agregarLinea` — merge por personalización.

---

## Frontend

### Configuración

- `pages/configuracion/items.vue` — sección “Extras permitidos” bajo ingredientes de receta (ingrediente, cantidad, unidad, `precioExtra` con `MoneyInput`).

### Drawer compartido

- `components/ventas/RecetaPersonalizacionDrawer.vue` (`VentasRecetaPersonalizacionDrawer`) — extras con checkbox + `UInputNumber` (stepper, min 1) para elegir unidades.
- `composables/useRecetaPersonalizacion.ts` — helpers (resumen con `xN`, cargos × unidades, payload con `unidades`, validación vacía).

### POS

- `pages/ventas/pos.vue` — intercepta click en `tipo === 'receta'` → drawer → `add` con personalización; `POST /ventas` envía snapshot por línea.
- `components/ventas/CatalogoGrid.vue` — recetas siempre clickeables; atenuación si `disponible === 0`.
- `composables/useVenta.ts` — línea en memoria con `personalizacion`.

### Salones

- `pages/salones/index.vue` — mismo drawer; `agregarLinea` con personalización → BD; líneas y tickets (comanda/precuenta/boleta) muestran resumen.

---

## Testing

```bash
cd backend && npm test -- items.service.spec.ts ventas.service.spec.ts salones.service.spec.ts
cd frontend && npm test -- useRecetaPersonalizacion.spec.ts useVenta.spec.ts
```

---

## Seed demo

Tras arrancar el backend, la receta **Hamburguesa Clásica** (`550e8400-e29b-41d4-a716-446655440259`) incluye un extra permitido:

| Campo | Valor |
|-------|-------|
| `receta_extra_id` | `550e8400-e29b-41d4-a716-446655440276` |
| Ingrediente | Queso laminado (`…440258`) |
| Cantidad / unidad | `20` / `g` |
| `precio_extra` | `800` |

Idempotente: `seedRecetaDemo()` en `seeder.service.ts`.

---

## Acceptance Criteria

- [x] CRUD `extrasPermitidos` en items
- [x] Drawer POS + Salones; productos click directo
- [x] Snapshot en cuenta_lineas y venta_detalles
- [x] Precio base + extras; omitir no rebaja
- [x] Stock drawer + reglas de venta bloqueante/extra
- [x] Merge por personalización en Salones
- [x] Comanda con texto derivado
- [x] Seed demo extra queso
- [x] Docs (este archivo) + ESTADO + README

---

## Related Features

- [recetas.md](./recetas.md) — recetas base, ingredientes, criticidad
- [ventas.md](./ventas.md) — flujo POS y cobro
- [tipo-ingrediente.md](./tipo-ingrediente.md) — insumos como ingredientes/extras
- [grupos-modificadores.md](./grupos-modificadores.md) — grupos reutilizables
  (Ticket B): el drawer descrito en este archivo (`ItemPersonalizacionDrawer.vue`,
  renombrado) ahora también renderiza grupos para combos y recetas, con
  `min`/`max` obligando la elección antes de habilitar "Agregar"
- Spec: [`docs/superpowers/specs/2026-07-16-edicion-recetas-antes-carrito-design.md`](../superpowers/specs/2026-07-16-edicion-recetas-antes-carrito-design.md)
