# Feature: Inventario serializado y por lote

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-06-28

---

## Overview

### What is it?

Extiende el kardex de inventario con dos modos adicionales por producto:

- **`serie`** — cada unidad tiene identidad propia (IMEI, número de serie). El stock = conteo de unidades en estado `disponible`.
- **`lote`** — las unidades se agrupan por lote con fecha de vencimiento. El stock = suma de `cantidad_disponible` en todos los lotes.
- **`cantidad`** — modo anterior (fungible), sin cambios.

### Why does it exist?

El modelo original con un único número en `item_producto.stock` no permitía:
- Rastrear celulares por IMEI (devoluciones, garantías, robo).
- Controlar vencimiento de productos farmacéuticos o alimenticios por lote.

### Scope

Incluido:
- Eje `modo_inventario` en `item_producto`.
- Tablas `item_unidad`, `item_lote`, `movimiento_inventario_detalle`.
- Lógica completa en `registrarMovimiento` (entrada/salida por modo).
- Endpoints `GET /items/:id/unidades` y `GET /items/:id/lotes`.
- Frontend: selector de modo, captura de series/lotes en el form y en el modal de ajuste, modal "Ver unidades / lotes".
- Seeder con producto serie (iPhone, 3 IMEIs) y producto lote (Paracetamol).

No incluido (futuro):
- Estado `reservado` producido por ventas (el modelo lo soporta, el productor aún no existe).
- FEFO automático en salida de lotes (el usuario elige el lote).
- Pegado masivo/CSV de series.
- Costeo/valoración de stock por unidad.

---

## API Endpoints

### GET /items/:id/unidades

Retorna las unidades del item (modo `serie`). Acepta `?estado=disponible|reservado|vendido|baja`.

```
GET /items/550e8400.../unidades?estado=disponible
Authorization: Bearer <token>

Response (200):
[
  {
    "id": "uuid",
    "serie": "359999112345678",
    "estado": "disponible",
    "condicion": "nuevo",
    "garantiaHasta": "2026-12-31T00:00:00.000Z",
    "loteId": null,
    "codigoLote": null,
    "creadoEl": "2026-06-28T..."
  }
]
```

### GET /items/:id/lotes

Retorna los lotes del item (modo `lote`).

```
GET /items/550e8400.../lotes
Authorization: Bearer <token>

Response (200):
[
  {
    "id": "uuid",
    "codigoLote": "LOT-20260101",
    "fechaElaboracion": "2026-01-01T00:00:00.000Z",
    "fechaVencimiento": "2027-01-01T00:00:00.000Z",
    "cantidadInicial": "500.0000",
    "cantidadDisponible": "450.0000",
    "creadoEl": "2026-06-28T..."
  }
]
```

### PATCH /items/:id/stock — modo serie entrada

```json
{
  "tipo": "entrada",
  "motivo": "compra",
  "cantidad": "3",
  "series": [
    { "serie": "359999112345678", "condicion": "nuevo", "garantiaHasta": "2026-12-31" },
    { "serie": "359999112345679", "condicion": "nuevo" }
  ]
}
```

### PATCH /items/:id/stock — modo serie salida

```json
{
  "tipo": "salida",
  "motivo": "ajuste_manual",
  "cantidad": "1",
  "unidadIds": ["uuid-de-la-unidad"]
}
```

### PATCH /items/:id/stock — modo lote entrada

```json
{
  "tipo": "entrada",
  "motivo": "compra",
  "cantidad": "100",
  "lote": {
    "codigoLote": "LOT-20260101",
    "fechaElaboracion": "2026-01-01",
    "fechaVencimiento": "2027-01-01"
  }
}
```

### PATCH /items/:id/stock — modo lote salida

```json
{
  "tipo": "salida",
  "motivo": "merma",
  "cantidad": "10",
  "loteId": "uuid-del-lote"
}
```

---

## Backend

### Module & Services

- **Items module**: `src/modules/items/items.module.ts`
- **Inventario service** (movimientos): `src/modules/inventario/inventario.service.ts`

### Entities

**`item_producto`** — nueva columna: `modo_inventario TEXT NOT NULL DEFAULT 'cantidad'`

**`item_unidad`** — una fila por unidad física

| Column | Type | Notes |
|--------|------|-------|
| `unidad_id` | UUID PK | |
| `tenant_id` | UUID | |
| `item_id` | UUID FK → items | |
| `lote_id` | UUID FK → item_lote, nullable | metadato opcional |
| `serie` | TEXT | IMEI u otro código único por tenant |
| `estado` | TEXT | `disponible / reservado / vendido / baja` |
| `condicion` | TEXT | `nuevo / usado / reacondicionado` |
| `garantia_hasta` | TIMESTAMPTZ nullable | |
| `venta_id` | UUID nullable | FK futuro a ventas |

Índice único: `(tenant_id, serie) WHERE eliminado_el IS NULL`

**`item_lote`** — un fila por lote

| Column | Type | Notes |
|--------|------|-------|
| `lote_id` | UUID PK | |
| `tenant_id` | UUID | |
| `item_id` | UUID FK → items | |
| `codigo_lote` | TEXT | |
| `fecha_elaboracion` | TIMESTAMPTZ nullable | |
| `fecha_vencimiento` | TIMESTAMPTZ nullable | |
| `cantidad_inicial` | NUMERIC(18,4) | |
| `cantidad_disponible` | NUMERIC(18,4) | saldo (decrementado en salidas) |

Índice único: `(item_id, codigo_lote) WHERE eliminado_el IS NULL`

**`movimiento_inventario_detalle`** — liga movimiento con unidades/lotes

| Column | Type | Notes |
|--------|------|-------|
| `detalle_id` | UUID PK | |
| `movimiento_id` | UUID FK | |
| `unidad_id` | UUID nullable | modo serie |
| `lote_id` | UUID nullable | modo lote |
| `cantidad` | NUMERIC(18,4) | 1 por unidad, N por lote |

### Key Methods (inventario.service.ts)

- `registrarMovimiento(manager, params)` — dispatcher por modo
- `moverCantidad()` — comportamiento original
- `moverSerie()` — crea/consume `item_unidad`
- `moverLote()` — crea/actualiza `item_lote`
- `recalcularStockSerie()` / `recalcularStockLote()` — actualiza `item_producto.stock` dentro de la transacción

---

## Frontend

### Pages

`pages/configuracion/items.vue` — todo en esta página, sin páginas nuevas.

### UI por modo

**Form crear producto:**
- `USelectMenu` para `modoInventario` (solo en creación, inmutable si hay movimientos).
- Modo `cantidad`: stock inicial + unidad de medida + fechas genéricas.
- Modo `serie`: lista inline de series (serie + condición + garantía). El count = stock inicial.
- Modo `lote`: campos de lote inicial opcionales (código, fechas, cantidad).

**Modal ajuste de stock:**
- Modo `cantidad`: igual que antes (cantidad numérica).
- Modo `serie` entrada: agregar N series.
- Modo `serie` salida: checkboxes sobre unidades disponibles (cargadas desde `GET /items/:id/unidades?estado=disponible`).
- Modo `lote` entrada: código de lote + fechas + cantidad.
- Modo `lote` salida: ID del lote + cantidad a retirar.

**Modal "Ver unidades / lotes"** (botón en la lista para productos `serie` o `lote`):
- Modo `serie`: tabla con serie, estado, condición, garantía, lote asociado.
- Modo `lote`: tabla con código, cantidad inicial, disponible, fechas, ID (select-all para copiar).

---

## Testing

```bash
cd backend && npm test -- --no-coverage
# inventario.service.spec.ts: 13 tests de entrada/salida por modo
# items.service.spec.ts: tests de create con modo, bloqueo de cambio de modo
```

---

## Related Features

- [Inventario kardex](./inventario-kardex.md) — modelo base que este feature extiende
- [ADR-007](../adr/007-inventario-serie-lote.md) — decisión de arquitectura del eje `modo_inventario`
