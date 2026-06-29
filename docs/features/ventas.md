# Feature: Procesamiento de ventas (transaccional)

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-06-29

---

## Overview

### What is it?

Endpoint transaccional que registra una venta completa en una sola operación atómica: cabecera + líneas + reglas aplicadas (descuentos/recargos/impuestos) + datos del cliente + pagos, con descuento automático de stock. Canal **físico** únicamente en esta versión.

### Why does it exist?

Es el corazón del POS: sin él no hay ventas registradas. Concentra en una sola transacción de base de datos todas las tablas involucradas para garantizar consistencia.

### Scope

- **In scope**: canal `fisico`, pagos inline con auto-estado (`pagada`/`pendiente`), cálculo de vuelto, movimientos de inventario y caja dentro de la transacción.
- **Out of scope**: canal `online`/caja virtual, notas de crédito, estado `borrador`, pantalla POS Nuxt.

---

## API Endpoints

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

### GET /api/ventas

Lista las ventas del tenant autenticado.

### GET /api/ventas/:id

Retorna la venta con sus relaciones expandidas: `detalles`, `descuentos`, `recargos`, `impuestos`, `customer`, `pagos`.

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

## Testing

```bash
# Unit tests (6 casos: estado pagada/pendiente, vuelto, inventario, servicio-sin-stock)
cd backend && npm test -- --testPathPatterns=ventas

# E2E tests (9 casos contra Docker PostgreSQL)
cd backend && npm run test:e2e -- --testPathPatterns=ventas --forceExit
```

---

## Notes

- `tenant_id` y `usuario_id` siempre del JWT, nunca del body.
- El estado se determina como `pagada` si `sumaPagos - excedente ≥ totalFinal`.
- Efectivo heuristic: `permite_vuelto = true` en `tenant_metodo_pago` indica método en efectivo.
- Plan de implementación: `docs/superpowers/plans/2026-06-29-procesamiento-ventas.md`.
