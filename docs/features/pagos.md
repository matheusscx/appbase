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

- **In scope**: `POST /pagos` (registrar abono), `GET /pagos` (ledger del tenant), `AbonoModal` en el frontend, página `/pagos` (ledger), detalle de venta en `/ventas?venta={uuid}` (drawer) con botón de abono.
- **Out of scope**: integración con pasarela de cobro, conciliación automática, reversión de pagos, filtros avanzados por fecha/estado.

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

Lista todos los pagos del tenant autenticado, ordenados por fecha descendente.

```
GET /api/pagos
Authorization: Bearer <token-con-tenant_id>

Response (200):
[
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
]
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
| Ledger de pagos | `/pagos` | Tabla de todos los pagos del tenant: fecha, método, monto, vuelto, cliente, link a venta, estado de la venta |

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
- Reutiliza helpers puros de `useVenta.ts`: `resumenCobro`, `clampNoVuelto`, `sumaPagos`

### Composables reutilizados

Todos los helpers de pago viven en `app/composables/useVenta.ts`:
- `resumenCobro(total, pagos, metodos)` — calcula restante, vuelto, excedenteSinVuelto
- `clampNoVuelto(total, pagos, metodos)` — recorta montos de métodos sin vuelto
- `sumaPagos(pagos)` — suma total de pagos

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
- [x] GET /pagos lista pagos del tenant con datos enriquecidos
- [x] AbonoModal disponible desde el drawer de detalle en `/ventas` para ventas pendientes/parciales
- [x] Página /pagos muestra ledger con filtro por método
- [x] Sidebar incluye entradas "Ventas" y "Pagos"
- [x] Estado `pagada_parcial` visible en UI (badge info)

---

## Related Features

- [ventas.md](./ventas.md) — Procesamiento de ventas y frontend POS
- [gestion-cajas.md](./gestion-cajas.md) — Cajas (requerida para el abono)
