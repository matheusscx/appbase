# Diseño: Nota de crédito desde el detalle de venta (POS)

**Status**: Approved
**Date**: 2026-07-11
**Owner**: Cesar Matheus

## Contexto

La nota de crédito interna (tipo documento 61, sin emisión SII) hoy solo nace del
flujo de reembolso de pasarela (`docs/features/reembolsos-nota-credito.md`). Para
ventas del POS físico no hay forma de registrar una devolución: ni documento, ni
salida de dinero de la caja, ni retorno de stock.

Esta feature agrega la creación de NC **desde el detalle de la venta** (drawer de
`/ventas`), reutilizando el backend existente (`VentasService.crearNotaCredito`) y
extendiéndolo con un egreso de caja elegible.

## Decisiones (brainstorming 2026-07-11)

1. **Punto de entrada**: botón "Nota de crédito" en `VentaDetalleDrawer` — no se
   activa el tipo 61 en el selector del POS (sigue `activo: false`).
2. **Dinero**: egreso de caja **elegible** (checkbox "Registrar devolución de
   dinero"). Crea un movimiento `salida` en la caja física abierta del usuario,
   ligado a la NC. Requiere caja abierta con saldo suficiente; si no, el backend
   rechaza con error claro y el frontend deshabilita el checkbox con nota.
3. **Permiso**: nuevo permiso dedicado **`Ventas : Nota de crédito`** (mismo patrón
   que `Pasarelas:Reembolsar`). El rol admin fijo lo tiene automáticamente
   (bypass `es_fijo` en `RbacService.userHasPermiso`); a otros roles se asigna
   por la matriz de permisos.
4. **Elegibilidad**: ventas en estado `pagada` o `pagada_parcial`, **cualquier
   canal** (físico u online), nunca sobre otra NC (`tipo_documento_id ≠ 61`).
   Para ventas online, el dinero de la pasarela se sigue devolviendo por el flujo
   de reembolso de Órdenes; esta NC cubre documento + stock + caja.
5. **Enfoque**: extender `crearNotaCredito` con el egreso **dentro de la misma
   transacción** (todo-o-nada). A diferencia del reembolso de pasarela no hay
   proveedor externo: si la caja falla, se revierte todo y no queda NC a medias.

## Backend

### Permiso nuevo (seeder + startup-pos.sql)

- `permisos`: `{ permisoId: '550e8400-e29b-41d4-a716-446655440219', nombre: 'Nota de crédito' }`.
- `modulo_app_permisos`: `{ moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440220', moduloAppId: VENTAS (…440058), permisoId: …440219 }`.
- (IDs = siguientes libres tras …440218; verificar al implementar.)

### Endpoint

```
POST /api/ventas/:id/notas-credito
@RequiresPermiso('Ventas', 'Nota de crédito')

Request:
{
  "monto": "5000",                                  // string decimal, > 0
  "comentario": "Devolución cliente",               // opcional
  "devoluciones": [{ "itemId": "uuid", "cantidad": "1" }],  // opcional
  "devolverDinero": true                            // opcional, default false
}

Response 201: { "id": "<uuid NC>", "totalFinal": "5000.0000",
                "movimientoCajaId": "<uuid>" | null }
```

Validaciones nuevas en el endpoint (antes de llamar a `crearNotaCredito` o dentro
de él, sobre la venta ya lockeada):

- Venta existe en el tenant, `estado ∈ {pagada, pagada_parcial}` y
  `tipo_documento_id ≠ TIPO_DOCUMENTO_NC_ID` → si no, `BadRequestException` /
  `NotFoundException`. (El flujo de reembolsos de pasarela NO pasa por estas
  reglas nuevas de estado: conserva su comportamiento actual.)

### Extensión de `crearNotaCredito`

Nuevo parámetro opcional `devolverDinero?: boolean` (y `usuarioId` ya existe).
Dentro de la transacción existente, tras crear la NC:

1. Buscar la caja **física abierta del usuario** (tenant + usuario + tipo
   `fisica` + estado `abierta` + `eliminado_el IS NULL`). No hay →
   `UnprocessableEntityException('No tienes una caja física abierta para registrar la devolución de dinero')`.
2. Validar saldo: `calcularSaldoEsperado(cajaId, manager) − monto ≥ 0`, mismo
   criterio que los movimientos manuales (`CajaService.registrarMovimiento`).
   Insuficiente → `UnprocessableEntityException('Saldo insuficiente en caja')`.
3. `CajaService.registrarMovimientoEnTransaccion(manager, { cajaId, tipo: 'salida',
   concepto: 'Devolución · Nota de crédito', monto, ventaId: <id de la NC> })`.
4. Devolver `movimientoCajaId` en el resultado.

El flujo de reembolsos de pasarela llama a `crearNotaCredito` sin
`devolverDinero` → cero cambios de comportamiento.

Las validaciones de elegibilidad de estado (`pagada`/`pagada_parcial`, no-NC) van
en un método público nuevo del service usado solo por el endpoint (p. ej.
`crearNotaCreditoDesdeVenta`), que hace las verificaciones y delega en
`crearNotaCredito`. Así el contrato del flujo de pasarela no cambia.

### Sin cambios

- La venta original **nunca** cambia de estado (decisión previa).
- No se toca el ledger de `pagos` (el egreso vive en `movimientos_caja`).
- Validaciones existentes intactas: Σ NCs ≤ total_final, devoluciones solo modo
  `cantidad`, cantidad ≤ vendida − devuelta.

## Frontend

### `ventas/NotaCreditoModal.vue` (nuevo, patrón `ordenes/ReembolsoModal.vue`)

- Props: `open`, `venta` (detalle ya cargado por el drawer: total, NCs previas,
  detalles con `itemId`/`modoInventario`/`cantidad`/`cantidadDevuelta`).
- Monto: `UInput inputmode="decimal"`, string end-to-end; máximo disponible =
  `total_final − Σ notasCredito[].totalFinal` (Decimal.js), mostrado como ayuda.
- Comentario opcional.
- Checkbox "Registrar devolución de dinero desde la caja": al abrir el modal se
  llama `cajaStore.cargarAbiertas()`; si no hay caja propia
  (`abiertas.some(c => c.esPropia)` — mismo criterio que `CajaAbiertasGrid`), el
  checkbox queda deshabilitado con nota "Necesitas una caja física abierta".
- Sección "Devolver a inventario": misma UX que el `ReembolsoModal` (filas por
  ítem, input decimal, deshabilitado con nota para serie/lote/servicio,
  máx = vendida − devuelta).
- Payload omite campos vacíos. Errores → `apiErrorMsg` + toast error (aquí no hay
  `warning` parcial: la operación es atómica). Éxito → toast + `emit('success')`.

### `ventas/VentaDetalleDrawer.vue`

- Botón "Nota de crédito" (icono documento, color neutral) junto a las acciones
  del drawer, visible si: `['pagada','pagada_parcial'].includes(estado)` &&
  `!esNotaCredito` && `usePermissionsStore().can('Ventas', 'Nota de crédito')`.
- Tras `success`: re-fetch del detalle (cards "Documentos relacionados" y
  "Reembolsos" ya existen) y `emit` para refrescar el listado.

## Testing

- **Backend (TDD)**: spec de `crearNotaCreditoDesdeVenta` — feliz sin/con egreso;
  venta `pendiente`/`borrador`/`cancelada` → 400; NC sobre NC → 400; sin caja
  abierta con `devolverDinero` → 422; saldo insuficiente → 422; movimiento
  `salida` con `ventaId` = NC id; regresión: `crearNotaCredito` sin
  `devolverDinero` no toca caja. Controller: permiso `Ventas:Nota de crédito`.
- **E2E manual**: venta física pagada → NC parcial con dinero + stock → verificar
  en BD (NC tipo 61, movimiento caja `salida`, movimiento inventario `entrada`,
  stock +N, saldo esperado de caja −monto); cierre de caja refleja el egreso;
  badges "NC"/"Reemb." en listado; segunda NC que excede el total → 400.

## Fuera de alcance

- NC como tipo de documento en el selector del POS (flujo venta-devolución).
- Emisión tributaria (SII/folios).
- Devolución de dinero por método de pago original (tarjeta, etc.) — el egreso es
  efectivo de caja.
- Egreso en el ledger de `pagos`.
