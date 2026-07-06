# Feature: Módulo de Pagos (abonos y ledger)

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-01

---

## Overview

### What is it?

Módulo de pagos que permite registrar abonos a ventas pendientes y consultar el ledger (historial) de todos los pagos del tenant.

### Why does it exist?

Las ventas pueden quedar en estado `pendiente` (sin pagos) o `pagada_parcial` (abono parcial).
Este módulo permite cobrar esas ventas en uno o varios abonos posteriores a la creación, y provee una vista de todos los pagos recibidos.

### Scope

- **In scope**: `POST /pagos` (registrar abono), `GET /pagos` (ledger paginado), `GET /pagos/resumen` (KPIs), `AbonoModal`, página `/pagos`, detalle de venta con abono.
- **Out of scope**: integración con pasarela de cobro, conciliación automática, reversión de pagos.

---

## API Endpoints

### POST /api/pagos

Registra un abono a una venta pendiente o parcialmente pagada.

```
POST /api/pagos
Authorization: Bearer <token-con-tenant_id>

Request:
{
  "ventaId": "uuid",
  "pagos": [
    { "metodoPagoId": "uuid", "monto": "5000", "referencia": "opcional" }
  ]
}

Response (201):
{ "id": "uuid", "ventaId": "uuid", "monto": "5000", ... }
```

**Errores:**
- `400` — venta no encontrada o no pertenece al tenant
- `400` — venta en estado `pagada` o `cancelada` (no se puede abonar)
- `400` — excedente sin método con `permite_vuelto = true`
- `400` — sin caja abierta para el usuario

### GET /api/pagos

Lista paginada de pagos del tenant, ordenados por `creado_el` descendente.

```
GET /api/pagos?page=1&pageSize=15&metodoPagoId=uuid&ventaEstado=pagada
Authorization: Bearer <token-con-tenant_id>

Response (200):
{
  "data": [
    {
      "id": "uuid",
      "ventaId": "uuid",
      "monto": "5000",
      "vuelto": "0",
      "fecha": "2026-06-30T...",
      "cajaId": "uuid",
      "referencia": null,
      "metodoNombre": "Efectivo",
      "ventaEstado": "pagada",
      "totalFinal": "5000",
      "customerNombre": "Juan Pérez"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 15,
    "total": 42,
    "totalPages": 3
  }
}
```

Query params opcionales: `page`, `pageSize`, `fechaDesde`, `fechaHasta`, `metodoPagoId`, `cajaId`, `ventaId`, `ventaEstado`.

### GET /api/pagos/resumen

KPIs globales del tenant (independientes de filtros/página).

```
GET /api/pagos/resumen

Response (200):
{
  "totalPagos": 42,
  "montoCobrado": "150000.0000",
  "pagosHoy": 3,
  "montoHoy": "25000.0000"
}
```

---

## Backend

### Module & Services

- **Module**: `src/modules/pagos/pagos.module.ts`
- **Controller**: `src/modules/pagos/pagos.controller.ts`
- **Service**: `src/modules/pagos/pagos.service.ts`

### Flujo de `registrarAbono`

1. Verificar caja abierta para el tenant+usuario.
2. Cargar la venta y validar que pertenece al tenant y está en estado abonable (`pendiente` o `pagada_parcial`).
3. Calcular el excedente de pagos; validar `permite_vuelto` si hay excedente.
4. En transacción: crear registros en `pagos` → recalcular saldo → actualizar `venta.estado` → registrar movimientos de caja (efectivo).

### Reglas de negocio

- Solo se puede abonar a ventas en estado `pendiente` o `pagada_parcial`.
- El estado de la venta se actualiza automáticamente tras cada abono:
  - Saldo = 0 → `pagada`
  - 0 < saldo < total_final → `pagada_parcial`
- `vuelto` se genera solo si algún método tiene `permite_vuelto = true` y la suma supera el saldo.
- Los pagos son inmutables: no hay edición ni eliminación (soft delete solo para auditoría).

---

## Frontend

### Páginas

| Página | Ruta | Descripción |
|--------|------|-------------|
| Ledger de pagos | `/pagos` | Tabla paginada server-side; filtros por método (`USelectMenu`) y estado de venta; KPIs vía `/pagos/resumen` |

### Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `AbonoModal` | `app/components/pagos/AbonoModal.vue` | Modal para registrar abono a una venta pendiente |

### AbonoModal

Props:
- `ventaId: string` — ID de la venta a abonar
- `saldo: string` — Monto pendiente (se usa como límite de cobro)
- `metodos: MetodoPago[]` — Métodos habilitados del tenant

Comportamiento:
- Usa `v-model:open` para controlar visibilidad
- Emite `success` al registrar el pago con éxito (la página recarga la venta)
- Reutiliza helpers puros de `useVenta.ts`: `resumenCobro`, `sumaPagos`
- "Agregar pago" prellena el pago nuevo con el restante; al escribir un monto, los demás pagos absorben el excedente (`setMontoPago`: reducen empezando por el primero, nunca aumentan solos)
- Si los métodos sin vuelto superan el saldo, se deshabilita el confirmar con mensaje (validación al confirmar, no mientras se escribe)
- Los pagos que quedan en $0 se omiten al registrar (no ensucian el ledger)

### Composables

- `usePaginatedList` — listados paginados server-side (`app/composables/usePaginatedList.ts`)
- Helpers de cobro en `useVenta.ts`: `resumenCobro`, `setMontoPago`, `sumaPagos`

---

## Data Flow

### Registrar abono

```
[Usuario abre AbonoModal en /ventas?venta={uuid}]
  ↓
[Selecciona métodos de pago y montos]
  ↓ useApiFetch POST /pagos { ventaId, pagos }
[Controller valida DTO]
  ↓
[Service: verificar caja, cargar venta, calcular vuelto]
  ↓
[Transacción: crear pagos → actualizar estado venta → movimientos caja]
  ↓
[AbonoModal emite 'success']
  ↓
[VentaDetalleDrawer recarga venta (GET /ventas/:id)]
  ↓
[UI muestra nuevo estado y saldo actualizado]
```

---

## Testing

```bash
# Unit tests backend
cd backend && npm test -- --testPathPatterns=pagos

# Build frontend (smoke test)
cd frontend && npm run build
```

---

## Acceptance Criteria

- [x] POST /pagos registra abono y actualiza estado de venta
- [x] GET /pagos devuelve respuesta paginada con filtros
- [x] GET /pagos/resumen expone KPIs globales
- [x] Página /pagos usa paginación server-side y USelectMenu para método
- [x] Sidebar incluye entradas "Ventas" y "Pagos"
- [x] Estado `pagada_parcial` visible en UI (badge info)

---

## Related Features

- [ventas.md](./ventas.md) — Procesamiento de ventas y frontend POS
- [gestion-cajas.md](./gestion-cajas.md) — Cajas (requerida para el abono)
