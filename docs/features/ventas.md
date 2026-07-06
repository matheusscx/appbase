# Feature: Procesamiento de ventas (transaccional)

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-01

---

## Overview

### What is it?

Endpoint transaccional que registra una venta completa en una sola operación atómica: cabecera + líneas + reglas aplicadas (descuentos/recargos/impuestos) + datos del cliente + pagos, con descuento automático de stock. Canal **físico** únicamente en esta versión.

### Why does it exist?

Es el corazón del POS: sin él no hay ventas registradas. Concentra en una sola transacción de base de datos todas las tablas involucradas para garantizar consistencia.

### Scope

- **In scope**: canal `fisico`, pagos inline con auto-estado (`pagada`/`pendiente`), cálculo de vuelto, movimientos de inventario y caja dentro de la transacción, historial en `/ventas`, POS en `/ventas/pos`.
- **Out of scope**: canal `online`/caja virtual, notas de crédito, estado `borrador`.

---

## API Endpoints

### GET /api/tipos-documento

Lista tipos de documento tributarios del país del tenant.

```
GET /api/tipos-documento
Authorization: Bearer <token-con-tenant_id>

Response (200):
[
  {
    "id": "uuid",
    "nombre": "Boleta",
    "codigo": "39",
    "requiereCustomer": false
  },
  {
    "id": "uuid",
    "nombre": "Factura",
    "codigo": "33",
    "requiereCustomer": true
  }
]
```

Usada en el frontend para renderizar el selector de documento y aplicar fricción (cliente obligatorio en Factura, opcional en Boleta).

### POST /api/ventas

Crea una venta completa.

```
POST /api/ventas
Authorization: Bearer <token-con-tenant_id>

Request:
{
  "tipoDocumentoId": "uuid",                    // opcional
  "lineas": [
    {
      "itemId": "uuid",
      "cantidad": "1",
      "precioUnitario": "optional-override",    // opcional; usa precio_base del item si omite
      "descuentoIds": ["uuid"],                 // opcional
      "recargoIds":   ["uuid"],                 // opcional
      "impuestoIds":  ["uuid"],                 // opcional
      "unidadIds":    ["uuid"],                 // modo serie
      "loteId":       "uuid"                    // modo lote
    }
  ],
  "pagos": [
    { "metodoPagoId": "uuid", "monto": "1069810.0000", "referencia": "opt" }
  ],
  "customer": { "nombre": "Juan Pérez", "rut": "12.345.678-9" },  // opcional
  "comentario": "string",                       // opcional
  "metodoPagoId": "uuid",                       // para el motor de precios (desc/recargos por método)
  "descuentosVentaIds": ["uuid"],               // descuentos a nivel de venta
  "recargosVentaIds":  ["uuid"]
}

Response (201):
{
  "id": "uuid",
  "canal": "fisico",
  "estado": "pagada | pendiente",
  "totalFinal": "1069810.000000",
  ...
}
```

**Errores:**
- `400` — sin caja abierta para el usuario
- `400` — excedente de pago sin método con `permite_vuelto = true`
- `400` — stock insuficiente (rollback completo)

### GET /api/ventas/resumen

KPIs globales del tenant (no dependen de la página actual del listado).

```
GET /api/ventas/resumen
Authorization: Bearer <token-con-tenant_id>

Response (200):
{
  "totalVentas": 42,
  "totalFacturado": "1250000.0000",
  "saldoPendiente": "85000.0000"
}
```

### GET /api/ventas

Lista paginada de ventas del tenant autenticado. Query params: `page` (default 1), `pageSize` (default 15, max 100), `estado`, `canal`. La respuesta incluye campos enriquecidos por fila: `montoPagado` (suma de pagos menos vuelto) y `saldo` (total_final − montoPagado).

```
GET /api/ventas?page=1&pageSize=15&estado=pendiente&canal=fisico

Response (200):
{
  "data": [
    {
      "id": "uuid",
      "canal": "fisico",
      "estado": "pagada",
      "totalFinal": "1069810.0000",
      "montoPagado": "1069810.0000",
      "saldo": "0.0000",
      "fecha": "2026-06-29T...",
      "creadoEl": "2026-06-29T..."
    }
  ],
  "meta": { "page": 1, "pageSize": 15, "total": 42, "totalPages": 3 }
}
```

### GET /api/ventas/:id

Retorna la venta con sus relaciones expandidas: `detalles`, `descuentos`, `recargos`, `impuestos`, `customer`, `pagos`. Incluye `montoPagado` y `saldo`.

---

## Backend

### Module & Services

- **Module**: `src/modules/ventas/ventas.module.ts`
- **Controller**: `src/modules/ventas/ventas.controller.ts`
- **Service**: `src/modules/ventas/ventas.service.ts`

### Entities & Database

| Entity | Tabla |
|--------|-------|
| `Venta` | `ventas` |
| `VentaDetalle` | `venta_detalles` |
| `VentaDescuento` | `ventas_descuentos` |
| `VentaRecargo` | `ventas_recargos` |
| `VentaImpuesto` | `ventas_impuestos` |
| `VentaCustomer` | `venta_customer` |
| `Pago` | `pagos` |
| `TipoDocumentoTributario` | `tipos_documento_tributario` |

Todas con soft delete (`eliminado_el`) y triada de auditoría. PKs UUID con `type: 'uuid'` (ADR-004).

### Flujo transaccional (`crear`)

1. Verificar caja abierta (`cajaService.findActiva`)
2. Cargar items + resolver moneda oficial (`tenant_moneda.es_default = true`)
3. Convertir precios a moneda oficial (`precioOrigen × tasa_cambio`)
4. Llamar `calculoPreciosService.calcular` → importes autoritativos
5. Calcular excedente; validar `permite_vuelto` si hay excedente; determinar estado
6. `dataSource.transaction`: guardar cabecera → detalles → trazas de reglas → customer → inventario (`salida/venta` por producto) → pagos → movimientos de caja (efectivo)

### Dependencias reutilizadas

| Servicio | Uso |
|----------|-----|
| `CalculoPreciosService.calcular` | Fuente autoritativa de todos los importes |
| `InventarioService.registrarMovimiento(manager, ...)` | Ya manager-aware, entra en la misma TX |
| `CajaService.findActiva` | Busca caja física abierta |
| `CajaService.registrarMovimientoEnTransaccion(manager, ...)` | Nuevo método extraído para entrar en la TX |

---

## Nuevos estados de venta

| Estado | Cuándo se asigna |
|--------|-----------------|
| `pendiente` | La venta se crea sin pagos, o el total pagado es 0 |
| `pagada_parcial` | Al registrar un abono parcial: saldo > 0 pero < total_final |
| `pagada` | El saldo llega a 0 (suma de pagos − vuelto ≥ total_final) |
| `cancelada` | Anulación explícita |
| `borrador` | Estado transitorio previo a confirmar |

El saldo se recalcula en cada abono: `saldo = total_final − Σ(pago.monto − pago.vuelto)`.

---

## Frontend (POS)

Interfaz de punto de venta para crear una venta desde el catálogo hasta el cobro final.

### Ruta y Componente Principal

- **Ruta**: `/ventas/pos` (`app/pages/ventas/pos.vue`)
- **Layout**: Dos paneles — catálogo + buscador a la izquierda, carrito + desglose + cobro a la derecha
- **Gate**: Panel bloqueante si no hay caja abierta (verifica estado en el store de cajas)

### Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `CatalogoGrid` | `app/components/ventas/CatalogoGrid.vue` | Buscador de items + grilla de productos; emite `add` al carrito |
| `ClienteForm` | `app/components/ventas/ClienteForm.vue` | Datos del cliente (nombre, RUT, dirección, teléfono, email); exporta tipo `CustomerForm` |
| `CarritoPanel` | `app/components/ventas/CarritoPanel.vue` | Líneas del carrito (solo cantidad editable), selector de tipo de documento, desglose (neto, descuentos, recargos, impuestos, total), botón Cobrar |
| `CobroModal` | `app/components/ventas/CobroModal.vue` | Modal de pagos múltiples con distintos métodos, cálculo de vuelto, confirmación y emisión de POST /api/ventas |

### Composable & Lógica Pura

- **`useVenta.ts`** (`app/composables/useVenta.ts`): Helpers puros sin Nuxt ni Vue (100% testeables con Vitest)
  - `puedeCobrar(tipoDoc, customer)` — valida si se puede proceder a cobro (Boleta sin cliente OK; Factura requiere nombre)
  - `resumenCobro(carrito, detalles)` — resume montos por tipo de descuento/recargo/impuesto
  - `sumaPagos(pagos)` — suma total de pagos para calcular vuelto
  - `setMontoPago(total, pagos, indice, monto)` — fija el monto de un pago y los demás absorben el excedente (reducen desde el primero, con piso 0; nunca aumentan solos). El pago nuevo se prellena con el restante y los pagos en $0 se omiten al confirmar
  - `resumenCobro` marca `excedenteSinVuelto` cuando los pagos con métodos sin vuelto superan el total (ese excedente no se puede devolver); el vuelto solo se acredita si proviene de métodos con vuelto
  - `toCalculoInput(carrito, metodoPago, descuentosVenta, recargosVenta)` — estructura payload para `/calculo-precios/calcular`

- **Estado reactivo**: `ref` del carrito con recalculación debounced (100ms) cada vez que cambia cantidad o se agregan reglas.

### Fricción por Documento

- **Boleta**: cliente opcional — se puede cobrar sin datos del comprador.
- **Factura**: cliente obligatorio — campo de nombre debe estar completado para habilitar botón "Cobrar".
- **Validación en cliente** vía `puedeCobrar()` y cambio de estado del botón Cobrar.

### Testing

```bash
cd frontend && npm test -- app/composables/useVenta.spec.ts    # 15/15 Vitest
```

---

## Testing

```bash
# Unit tests (6 casos: estado pagada/pendiente, vuelto, inventario, servicio-sin-stock)
cd backend && npm test -- --testPathPatterns=ventas

# E2E tests (9 casos contra Docker PostgreSQL)
cd backend && npm run test:e2e -- --testPathPatterns=ventas --forceExit
```

---

## Frontend — historial y detalle de ventas

Implementado en 2026-06-30; rutas unificadas en 2026-07-01.

### Páginas (rutas canónicas)

| Página | Ruta | Descripción |
|--------|------|-------------|
| Historial de ventas | `/ventas` | Tabla con filtros, KPIs; fila clickeable abre detalle |
| Detalle de venta | `/ventas?venta={uuid}` | Drawer lateral (`VentaDetalleDrawer`): líneas, totales, pagos, saldo; botón "Registrar pago" para `pendiente`/`pagada_parcial` |
| Punto de venta | `/ventas/pos` | Crear venta (ver sección POS arriba) |

### Redirects de compatibilidad

| Ruta legacy | Destino |
|-------------|---------|
| `/ventas/historial` | `/ventas` (conserva query string) |
| `/ventas/:id` | `/ventas?venta=:id` |

### Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| `VentaDetalleDrawer` | `app/components/ventas/VentaDetalleDrawer.vue` | Detalle expandible, pagos, abono |
| `AbonoModal` | `app/components/pagos/AbonoModal.vue` | Abono a venta pendiente/parcial |

### AbonoModal

`app/components/pagos/AbonoModal.vue` — modal para registrar abonos a ventas pendientes:
- Props: `ventaId`, `saldo` (monto pendiente), `metodos` (métodos de pago del tenant)
- Reutiliza helpers de `useVenta.ts`: `resumenCobro`, `setMontoPago`, `sumaPagos`, `PagoInput`
- Al confirmar: `POST /pagos` con `{ ventaId, pagos: [...] }`; emite `success` para que la página recargue

---

## Pendiente (fase futura)

- **Filtrado avanzado en historial** — Rango de fechas, búsqueda por cliente, exportación
- **Comprobante imprimible** — Generación y descarga de PDF del comprobante de venta
- **Descuentos/recargos manuales** — Aplicación inline de descuentos o recargos por línea o a nivel de venta
- **Canal online** — Soporte de ventas en canal `online` con caja virtual automática
- **Notas de crédito** — Creación de notas de crédito referenciando ventas originales

---

## Notes

- `tenant_id` y `usuario_id` siempre del JWT, nunca del body.
- El estado se determina como `pagada` si `sumaPagos - excedente ≥ totalFinal`.
- Efectivo heuristic: `permite_vuelto = true` en `tenant_metodo_pago` indica método en efectivo.
- Plan de implementación: `docs/superpowers/plans/2026-06-29-procesamiento-ventas.md`.
