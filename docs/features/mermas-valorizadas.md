# Feature: Mermas tipificadas y valorizadas

**Status**: Complete  
**Last Updated**: 2026-08-28

---

## Overview

### What is it?

Registro dedicado de mermas de stock en productos (`tipo='producto'`) con **causa tipificada por tenant**, conversión de unidad opcional y **costo congelado en el kardex**. **El costo no se tipea: sale de `item_producto.costo_actual`.** El formulario de merma solo pide cantidad y causa; el sistema valoriza con el costo vigente del ítem al momento de mermar. Si el ítem no tiene costo cargado, la merma **se registra igual, sin valorizar, y queda así para siempre** — no existe un ajuste posterior que le ponga costo a una merma vieja, mismo criterio que el precio congelado de una venta y que [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) con el hecho fiscal. El impacto financiero (`costoPerdido = cantidad × costo_unitario`) se calcula al leer el movimiento, y es `null` cuando no hay costo. La merma **nunca** actualiza `item_producto.costo_actual`.

Decisión y porqué: [`docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md`](../superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md).

Causas fijas del sistema (`es_fijo=true`): **Vencimiento**, **Deterioro**, **Robo**, **Error operativo**, **Otro** — no se editan ni eliminan. El administrador puede crear causas custom adicionales.

El ajuste genérico de stock (`PATCH /items/:id/stock`) **ya no acepta** `motivo='merma'`; toda merma pasa por el flujo dedicado con causa obligatoria.

### Why does it exist?

Food-service necesita saber *por qué* se perdió stock y cuánto costó, no solo un movimiento anónimo. Cierra la pieza 4 del cluster recetas/costos, reutilizando costo por producto (pieza 1) y conversión de unidades (pieza 2).

### Scope

**Included:**
- Tabla `causas_merma` por tenant + columna `causa_merma_id` en `movimientos_inventario`.
- Semilla de 5 causas fijas al crear tenant y en el seeder de desarrollo.
- CRUD `/api/causas-merma` y registro/listado `/api/mermas`.
- UI: configuración de causas, operación de mermas (drawer sin campo de costo; cartel no bloqueante cuando el producto no tiene costo cargado), kardex con causa y costo perdido.
- Quitar opción Merma del modal de ajuste de stock en items.
- Mismo cartel no bloqueante en la entrada por compra (`configuracion/items.vue`), porque el dato de costo se carga ahí, no al mermar.
- Marca **Sin costo** y filtro `sinCosto` en el listado de ítems (ver [`inventario-kardex.md`](./inventario-kardex.md) § *"Ítems sin costo"*).

**NOT included (future):**
- Reporte fiscal/DTE de mermas.
- Multi-bodega / ubicaciones.
- Merma automática por rendimientos de recetas.
- **Reporte de mermas** (agregación, ej. "cuánto se perdió este mes"): no existe hoy. Cuando se construya, tiene que mostrar cuántas mermas quedaron sin valorizar — ver `docs/agent/pendientes.md`.
- **Valorización manual posterior**: descartada a propósito, no diferida — es la misma razón que congela el precio de una venta ya emitida.

---

## Modelo de datos

### `causas_merma`

| Column | Type | Notes |
|--------|------|-------|
| `causa_merma_id` | UUID PK | |
| `tenant_id` | UUID FK | Del token |
| `nombre` | TEXT | Único vivo por tenant |
| `activo` | BOOLEAN | Default `true` |
| `es_fijo` | BOOLEAN | Defaults del sistema |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete |

### `movimientos_inventario` (extensión)

| Column | Type | Notes |
|--------|------|-------|
| `causa_merma_id` | UUID NULL FK | Obligatoria iff `motivo='merma'` |

---

## API

### CRUD `/api/causas-merma`

- `GET` — cualquier usuario del tenant; query `?soloActivas=true` filtra activas.
- `POST` / `PATCH /:id` / `DELETE /:id` — `TenantAdminGuard`; rechaza editar/borrar `es_fijo=true`; soft-delete bloqueado si hay movimientos con esa causa.

### `POST /api/mermas`

Permiso: **Inventario:Crear**.

```
POST /api/mermas
Authorization: Bearer <token>

Request (CreateMermaDto):
{
  "itemId": "<uuid>",
  "cantidad": "250",
  "causaMermaId": "<uuid>",
  "unidadCodigo": "g",
  "comentario": "Lote vencido"
}
```

**Reglas de costo:**
- **El costo no se tipea ni se acepta en el request** — `CreateMermaDto` no tiene ningún campo de costo. El endpoint valoriza con `item_producto.costo_actual` vigente al momento de mermar.
- Con `costo_actual` → lo congela en `costo_unitario` del movimiento y calcula `costoPerdido`.
- Sin `costo_actual` → la merma se registra igual; `costoUnitario` y `costoPerdido` viajan en `null`. **No hay 400, no hay override por movimiento.** El ítem queda sin valorizar para siempre — cargarle costo después no revalúa las mermas ya registradas.
- La merma **nunca** actualiza `item_producto.costo_actual`.

**Response (201) — con costo:**
```json
{
  "movimientoId": "<uuid>",
  "stockResultante": "1.7500",
  "costoUnitario": "8000",
  "costoPerdido": "2000000",
  "causaNombre": "Vencimiento"
}
```

**Response (201) — sin costo:**
```json
{
  "movimientoId": "<uuid>",
  "stockResultante": "1.7500",
  "costoUnitario": null,
  "costoPerdido": null,
  "causaNombre": "Vencimiento"
}
```

### `GET /api/mermas`

Permiso: **Inventario:Leer**. Paginado; filtros `itemId`, `causaMermaId`, `desde`, `hasta`. Cada fila incluye `causaNombre` y `costoPerdido`.

**El listado sobrevive a la baja del producto.** Una merma registrada es plata
perdida que ya ocurrió, así que dar de baja el producto después no la saca del
informe: la consulta no filtra `items.eliminado_el` —ni en el listado ni en el
`COUNT(*)`, o el total bajaría sin avisar— y la fila viaja con
`itemEliminado: true` para mostrarse marcada. Mismo criterio y misma razón que el
kardex: ver [`inventario-kardex.md`](./inventario-kardex.md) §"Producto eliminado".

Registrar una merma **nueva** sobre un producto eliminado sí se rechaza (`404`,
desde el propio `POST`): no hay operación real detrás.

`desde`/`hasta` siguen el criterio compartido de rangos por fecha: la fecha pura se expande a
la medianoche de la zona del tenant, el timestamp se respeta al segundo. Ver
[`inventario-kardex.md`](./inventario-kardex.md) §`GET /inventario/movimientos`.

---

## Backend

- **Módulo**: `src/modules/mermas/` (causas + registro en un feature module).
- Reusa `InventarioService.registrarMovimiento` (`tipo='salida'`, `motivo='merma'`, `causaMermaId`) y `CatalogService.convertirUnidad`.
- `AjusteStockDto`: enum de motivos sin `'merma'`.
- `registrarMovimiento`: exige `causaMermaId` si `motivo='merma'`; rechaza `causaMermaId` en otros motivos.

---

## Frontend

- `/configuracion/causas-merma` — CRUD con badge **Fija** en causas `es_fijo`.
- `/mermas` — listado filtrable + drawer registrar (solo cantidad, unidad y causa; **sin campo de costo**). Cartel no bloqueante cuando el producto no tiene `costo_actual`: avisa que la merma se va a registrar igual pero sin valorizar, y que no se puede corregir después. Columna Cantidad formateada por magnitud vía `formatStock` (`useFormatters`) — `MermaListItem.unidadMedida` (viene de `item_producto.unidad_medida`).
- Kardex / historial de movimientos: `Merma · {causaNombre}` y costo perdido formateado (`formatMonto`), o `—` cuando es `null`.
- Modal de ajuste de stock en items: opción Merma eliminada.
- `configuracion/items.vue` — mismo cartel no bloqueante en el drawer de entrada por compra cuando el producto no tiene costo; badge **Sin costo** y checkbox **Solo sin costo** en el listado (filtro `sinCosto`, ver [`inventario-kardex.md`](./inventario-kardex.md)).

---

## Testing

```bash
cd backend && npm test -- causas-merma.service.spec.ts mermas.service.spec.ts
cd backend && npm test -- inventario.service.spec.ts  # casos causa merma
cd backend && npm run test:e2e -- mermas.e2e-spec.ts
```

---

## Acceptance Criteria

- [x] CRUD causas custom; fijas inmutables
- [x] `POST /mermas` tipifica, descuenta stock y congela costo
- [x] El costo sale de `item_producto.costo_actual`, nunca se tipea; sin costo, la merma se registra sin valorizar y queda así para siempre — sin override por movimiento
- [x] Listado y kardex muestran valorizado (o `—` sin costo) y causa
- [x] Cartel no bloqueante en la merma y en la entrada por compra cuando el ítem no tiene costo; marca y filtro `sinCosto` en el listado de ítems
- [x] Ajuste genérico sin `merma`
- [x] Unit + E2E
- [x] Docs (este archivo) + ESTADO

---

## Related Features

- [inventario-kardex.md](./inventario-kardex.md) — movimientos de salida y `costo_unitario` congelado
- [conversion-unidades.md](./conversion-unidades.md) — conversión antes del movimiento
- [recetas.md](./recetas.md) — pieza 3 del cluster food-service
- Spec original: [`docs/superpowers/specs/2026-07-15-mermas-valorizadas-design.md`](../superpowers/specs/2026-07-15-mermas-valorizadas-design.md)
- Spec del costo sin tipear: [`docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md`](../superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md)
