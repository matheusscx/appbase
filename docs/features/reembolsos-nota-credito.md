# Feature: Reembolsos — visibilidad en ventas + Nota de Crédito interna

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-11

---

## Overview

### What is it?

Al reembolsar una orden de pasarela (total o parcial) desde el drawer de Órdenes,
el admin puede opcionalmente:

- **Generar una nota de crédito interna** (documento sin emisión SII) por el monto
  reembolsado, que referencia la venta original.
- **Devolver ítems a stock** (independiente de la NC): selecciona cantidades por
  línea; solo ítems con `modo_inventario = 'cantidad'`.

Además, el módulo de Ventas ahora **muestra los reembolsos siempre** (haya o no NC):
sección "Reembolsos" y "Documentos relacionados" en el detalle de la venta, y badges
derivados "Reemb. parcial" / "Reembolsada" / "NC" en el listado.

### Why does it exist?

Antes, el reembolso vivía solo en el módulo pasarela: la venta y sus pagos no se
enteraban, y los reportes seguían mostrando el total cobrado completo. La NC es el
tratamiento contable estándar (en Chile anula/corrige boletas y facturas) y queda
lista para el día en que se integre facturación electrónica.

### Scope

- Incluido: NC interna elegible en el reembolso; devolución de stock elegible
  (modo `cantidad`); visibilidad de reembolsos en detalle/listado de ventas;
  badges derivados (no son estados nuevos en BD); **NC manual desde el detalle
  de venta con egreso de caja elegible (2026-07-11)**.
- NO incluido (futuro): emisión tributaria real (SII/folios); devolución para
  modos `serie`/`lote` (requiere elegir unidades/lote — se hace manual desde
  Inventario); egreso en el ledger de `pagos`; devolución de dinero por el
  método de pago original (el egreso es efectivo de caja).

---

## API Endpoints

### Reembolso extendido (existente, campos nuevos opcionales)

```
POST /api/pasarela/admin/ordenes/:id/reembolsos
Authorization: Bearer <JWT>   (permiso Pasarelas:Reembolsar)

Request:
{
  "monto": "1100",
  "generarNotaCredito": true,                          // opcional, default false
  "devoluciones": [                                    // opcional, independiente de la NC
    { "itemId": "uuid", "cantidad": "2" }
  ]
}

Response (200): orden pública + extras
{
  ..., "reembolsoAprobado": true,
  "notaCreditoId": "uuid",        // si se generó NC
  "warning": "..."                // si el reembolso se procesó pero la NC/devolución falló
}
```

- Si la NC/devolución falla después de un reembolso aprobado, **el reembolso NO se
  revierte** (la plata ya volvió por el proveedor): la respuesta trae `warning` y
  el error queda en logs.
- Los flags sin venta vinculada (`orden.venta_id` null) responden `warning`
  informativo y no hacen nada.

### GET /ventas/:id (campos nuevos)

- `ventaReferenciaId`, `tipoDocumento {id, codigo, nombre}`.
- `detalles[]`: + `itemId`, `modoInventario` (`null` = servicio), `cantidadDevuelta`.
- `reembolsos[]`: REFUNDs de las órdenes de pasarela vinculadas
  (`{id, monto, estado, fecha, ordenId, codigoOrden}`).
- `notasCredito[]`: NCs hijas (`{id, totalFinal, fecha, comentario}`).

### GET /ventas (listado)

- `totalReembolsado` (Σ REFUND aprobados de órdenes vinculadas) y `esNotaCredito`.
- `GET /ventas/resumen` **excluye** las NCs de los KPIs.

---

## Backend

- **Nota de crédito** = venta con `tipo_documento_id` = "Nota de Crédito"
  (código 61 Chile, seed `550e8400-e29b-41d4-a716-446655440218`, `activo: false`
  para que no aparezca en el selector del POS), `venta_referencia_id` → venta
  original, estado `pagada`, caja/canal/moneda copiados de la original, y
  **totales copiados del monto reembolsado** (sin motor de precios). Líneas solo
  si se eligieron ítems; movimientos `entrada / motivo='devolucion'` ligados a la
  NC (o a la venta original si no hubo NC). **La venta original nunca cambia de
  estado.**
- `VentasService.crearNotaCredito` / `registrarDevolucionesPorReembolso`
  (`ventas.service.ts`): transacción propia con `FOR UPDATE` sobre la venta
  original (serializa NCs concurrentes). Validaciones: Σ(NCs) ≤ `total_final`;
  cantidad devuelta ≤ vendida − ya devuelta; solo modo `cantidad` (serie/lote y
  servicios rechazados con mensaje de negocio antes de tocar inventario).
- **Borde de módulos**: `ReembolsoCallbackRegistry` en pasarela (mismo patrón §13
  que `PagoCallbackRegistry`); `VentasReembolsoHandler` (módulo ventas) se
  registra en `onModuleInit`. La pasarela nunca importa ventas.
- **Hook post-commit**: `CobrosService.reembolsar` dispara el handler DESPUÉS del
  commit de la transacción del reembolso (dentro se auto-bloquearía con el
  `FOR UPDATE` de la orden y un fallo de la NC revertiría un reembolso ya
  ejecutado por el proveedor).
- Índices nuevos: `pasarela_ordenes(venta_id)`, `pasarela_transacciones(orden_id)`
  (para el agregado de REFUNDs del listado de ventas).

## Frontend

- `ordenes/ReembolsoModal.vue`: prop `ventaId`; con venta vinculada muestra
  checkbox "Generar nota de crédito" y lista "Devolver a inventario" (inputs
  decimales string; filas serie/lote/servicio deshabilitadas con nota; máximo =
  vendida − ya devuelta). Respuesta con `warning` → toast warning.
- `ventas/VentaDetalleDrawer.vue`: badges "Nota de Crédito" y
  "Reembolsada parcial/totalmente" (derivados); cards "Reembolsos" y
  "Documentos relacionados" (links venta original ↔ NCs vía `/ventas?venta=<id>`).
- `pages/ventas/index.vue`: badges "NC" / "Reemb. parcial" / "Reembolsada" junto
  al estado.

## NC manual desde el detalle de venta (2026-07-11)

```
POST /api/ventas/:id/notas-credito
Authorization: Bearer <JWT>   (permiso dedicado Ventas:Nota de crédito)

Request:  { "monto": "5000", "comentario": "...", "devolverDinero": true,
            "devoluciones": [{ "itemId": "uuid", "cantidad": "1" }] }
Response 201: { "id": "<uuid NC>", "totalFinal": "5000.0000",
                "movimientoCajaId": "<uuid>" | null }
```

- Elegibilidad: venta `pagada`/`pagada_parcial` de cualquier canal, nunca sobre
  otra NC. La venta original no cambia de estado.
- `devolverDinero`: movimiento `salida` ("Devolución · Nota de crédito") en la
  caja física abierta del usuario, en la **misma transacción** que la NC
  (todo-o-nada; valida saldo suficiente). Sin caja o sin saldo → 422.
- Backend: `VentasService.crearNotaCreditoDesdeVenta` → `crearNotaCredito` con
  flags `validarVentaElegible`/`devolverDinero`; el flujo de reembolsos de
  pasarela llama sin flags y no cambia.
- Frontend: botón "Nota de crédito" en `VentaDetalleDrawer` +
  `ventas/NotaCreditoModal.vue` (checkbox de dinero deshabilitado sin caja
  abierta — `GET /caja/activa`; devolución de stock igual al `ReembolsoModal`).
- La lógica de devolución a inventario compartida entre `NotaCreditoModal` y
  `ReembolsoModal` vive en `composables/useDevolucionInventario.ts` (helpers
  puros con spec Vitest: agrupación por ítem, validación, payload) + el
  componente presentacional `components/DevolucionInventarioLista.vue`.
- Spec: `docs/superpowers/specs/2026-07-11-nota-credito-pos-design.md`.

## Testing

- `ventas.service.spec.ts`: crearNotaCredito (feliz sin/con líneas, validaciones
  de monto/cantidades/modo/tenant, la original no se toca), devoluciones sin NC,
  findOne/listar/resumen con los campos nuevos.
- `reembolso-callback.handler.spec.ts`: registro en el registry y delegación.
- `cobros.service.spec.ts`: hook post-commit (evento completo, warning sin
  revertir, rechazado no dispara, sin venta vinculada, regresión sin flags).
- `create-reembolso.dto.spec.ts`: validación anidada del DTO.

## Referencias

- Spec: `docs/superpowers/specs/2026-07-10-reembolso-nc-visibilidad-design.md`
- Plan: `docs/superpowers/plans/2026-07-10-reembolso-nc-visibilidad.md`
