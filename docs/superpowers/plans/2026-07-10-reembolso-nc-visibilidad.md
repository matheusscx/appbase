# Plan: Reembolsos — visibilidad en ventas + Nota de Crédito interna elegible

- **Status:** Approved
- **Date:** 2026-07-10
- **Owner:** Cesar Matheus

## Context

Hoy el reembolso de una orden de pasarela (POST `/pasarela/admin/ordenes/:id/reembolsos`) vive solo en el módulo pasarela: registra la transacción REFUND y el estado de la orden, pero la venta vinculada y sus pagos no se enteran. Diseño aprobado en `docs/superpowers/specs/2026-07-10-reembolso-nc-visibilidad-design.md` (leerlo antes de ejecutar: contiene las 11 decisiones de diseño).

Resumen: visibilidad de reembolsos en el detalle/listado de ventas (badge derivado, no estado nuevo); en el modal de reembolso, checkbox "Generar nota de crédito" y devolución de stock por ítem, opcionales e independientes; NC = venta interna tipo doc 61 con `venta_referencia_id`, totales copiados del monto (sin motor de precios), estado `pagada`; la venta original siempre queda `pagada`; integración pasarela→ventas por registry nuevo; si la NC falla no se revierte el reembolso (warning + log).

## Scope / Out of scope

**Scope:** seed tipo doc NC; `ReembolsoCallbackRegistry`; `VentasService.crearNotaCredito` + devoluciones; DTO de reembolso extendido + hook post-commit; visibilidad en `findOne`/`listar`/`resumen`; frontend (ReembolsoModal, VentaDetalleDrawer, listado).

**Out of scope:** SII/folios; devolución serie/lote; endpoint NC independiente; egreso en ledger `pagos`.

## Backend

### T1 — Seed tipo documento NC + constante
- [ ] `seeder.service.ts` (`seedTiposDocumentoTributario` :1852): agregar `{ id: '550e8400-e29b-41d4-a716-446655440218', paisId: CHILE, nombre: 'Nota de Crédito', codigo: '61', descripcion: 'Nota de crédito interna por reembolso (sin emisión SII)', activo: false, customerRequerido: false }` (upsert por id ya existe; …440218 es el siguiente ID libre verificado).
- [ ] `ventas/entities/tipo-documento-tributario.entity.ts`: exportar `TIPO_DOCUMENTO_NC_ID = '550e8400-e29b-41d4-a716-446655440218'`.
- [ ] Reflejar en `startup-pos.sql`.

### T2 — `ReembolsoCallbackRegistry` (pasarela)
- [ ] Nuevo `pasarela/services/reembolso-callback.registry.ts`, calcado de `pago-callback.registry.ts` (singleton un handler, `register`/`get`):
  - `ReembolsoAprobadoEvento { tenantId, ordenId, codigoOrden, ventaId, monto, generarNotaCredito, devoluciones: {itemId, cantidad}[], usuarioId }`
  - `ReembolsoCallbackHandler { onReembolsoAprobado(e): Promise<{ notaCreditoId?: string }> }`
- [ ] Provider + export en `pasarela.module.ts`.

### T3 — `VentasService.crearNotaCredito` (TDD primero)
Firma: `crearNotaCredito(params: { tenantId; usuarioId; ventaOriginalId; monto: string; devoluciones?: {itemId, cantidad}[]; comentario?: string }): Promise<{ id, totalFinal }>`. Transacción propia:
1. Venta original con `FOR UPDATE` (tenant + `eliminado_el IS NULL`) — serializa NCs concurrentes; no existe → `NotFoundException`.
2. `monto > 0` (Decimal.js); Σ NCs previas (`SUM(total_final) WHERE venta_referencia_id=$1 AND tipo_documento_id=NC AND eliminado_el IS NULL`) + monto ≤ `total_final`, si no `BadRequestException`.
3. Si hay devoluciones: cargar `venta_detalles` de la original + `LEFT JOIN item_producto` (modo_inventario). Validar por ítem: pertenece a la venta; modo `'cantidad'` (serie/lote/servicio → `BadRequestException` con mensaje claro ANTES de tocar inventario); `0 < cantidad ≤ vendida − ya_devuelta`.
4. Cabecera NC `manager.save(Venta, ...)`: `tipoDocumentoId: TIPO_DOCUMENTO_NC_ID`, `ventaReferenciaId`, `estado: EstadoVenta.PAGADA`, caja/moneda/canal copiados, `totalFinal = totalBruto = monto`, resto `'0'`, comentario.
5. Líneas solo de ítems elegidos, copiadas del detalle original (`precio_unitario`, `moneda_id_origen` — NOT NULLs cubiertos), cantidad = devuelta, `totalLinea = precio × cantidad` (informativo; no recalcula cabecera). Sin devoluciones → 0 filas (válido).
6. Por ítem: `inventarioService.registrarMovimiento(manager, { tipo:'entrada', motivo:'devolucion', ventaId: nc.id, usuarioId, ... })`.
7. Sin pagos ni caja; la original no se toca.

- [ ] Specs primero en `ventas.service.spec.ts`: NC feliz sin líneas (totales copiados, estado pagada, referencia, 0 detalles/movimientos); NC con devoluciones (líneas + movimiento entrada/devolucion con ventaId de la NC); Σ excede total → 400; cantidad > disponible → 400; ítem ajeno → 400; serie/lote → 400; servicio → 400; otro tenant → 404; la original no cambia de estado; devoluciones sin NC ligan a la original.
- [ ] Implementar `crearNotaCredito`.
- [ ] Método hermano `registrarDevolucionesPorReembolso(...)`: pasos 1/3/6 con `ventaId` = original, sin cabecera; validación del paso 3 como helper privado compartido.

### T4 — Handler de ventas registrado en el registry
- [ ] Nuevo `ventas/reembolso-callback.handler.ts` + spec: `implements ReembolsoCallbackHandler, OnModuleInit`; `onModuleInit → registry.register(this)`; con `generarNotaCredito` → `crearNotaCredito(..., comentario: "NC por reembolso orden <codigoOrden>")` → `{ notaCreditoId }`; sin NC con devoluciones → método hermano. Errores se propagan (los captura pasarela).
- [ ] `ventas.module.ts`: importar `PasarelaModule` (verificado sin ciclo: pasarela no importa módulos de negocio), declarar handler.

### T5 — DTO extendido + disparo post-commit (TDD)
- [ ] `create-reembolso.dto.ts`: `generarNotaCredito?: boolean` (`@IsOptional @IsBoolean`), `devoluciones?: DevolucionLineaDto[]` (`@ValidateNested({each}) @Type`; `itemId @IsUUID`, `cantidad @IsNumberString`).
- [ ] `pasarela-admin.controller.ts:108`: pasar `(req.user as JwtUser).id` → `reembolsar(tenantId, id, dto, usuarioId)` (usuarioId del token, nunca del body).
- [ ] `cobros.service.ts reembolsar`: capturar en vars de closure (patrón `ctxTimeout` :210) la orden commiteada y si fue aprobado; **DESPUÉS del await de la tx** (lock liberado): si aprobado ∧ `orden.ventaId` ∧ (flag NC ∨ devoluciones) → `try { handler.onReembolsoAprobado(evento) → respuesta + notaCreditoId } catch { Logger.error + respuesta + warning }`. Flags sin `ventaId` → warning informativo. Rechazado → no dispara. CRÍTICO: nunca dentro de la tx (auto-bloqueo FOR UPDATE vs FOR KEY SHARE) y nunca revertir el reembolso.
- [ ] Tests (extender `cobros.service.spec.ts`): handler invocado con evento correcto y respuesta con `notaCreditoId`; handler lanza → warning sin excepción y REFUND intacto; rechazado → no invoca; sin ventaId + flag → warning sin invocar; DTO sin flags → regresión intacta. Spec chico de DTO con `validate()` (anidados inválidos).

### T6 — Visibilidad en `findOne` / `listar` / `resumen`
- [ ] `findOne` (:496-634): agregar `venta_referencia_id` a la cabecera + LEFT JOIN tipo documento → `ventaReferenciaId`, `tipoDocumento {id,codigo,nombre}`. Detalles: mapear `item_id` (ya está en el SELECT :525) + LEFT JOIN `item_producto` → `modoInventario` (null = servicio) + `cantidadDevuelta` por ítem (SUM movimientos `devolucion` de original ∪ NCs hijas). Nuevas queries: `reembolsos[]` (REFUNDs de órdenes con `venta_id=$1`, con estado y codigo_orden) y `notasCredito[]` (ventas hijas por `venta_referencia_id`).
- [ ] `listar`: subquery agregada `total_reembolsado` (SUM REFUND aprobadas de órdenes vinculadas) + `tipo_documento_id` → `totalReembolsado`, `esNotaCredito`. Índices: `@Index` en `PasarelaOrden.ventaId` + verificar índice `pasarela_transacciones(orden_id)`; reflejar en `startup-pos.sql`.
- [ ] `resumen()`: excluir NCs (`tipo_documento_id IS DISTINCT FROM NC_ID`).
- [ ] Tests de findOne/listar/resumen.

## Frontend

(Patrones: `useApiFetch` siempre; decimales string end-to-end con `UInput inputmode="decimal"`; arrays inmutables §9; re-fetch tras mutación; `useFormatters`; referencia de modal con filas: `pagos/AbonoModal.vue`.)

### T7 — `ReembolsoModal.vue` + `OrdenDetalleDrawer.vue`
- [ ] Prop nueva `ventaId?: string | null`; el drawer pasa `:venta-id="orden.ventaId"`.
- [ ] Al abrir con ventaId: fetch `GET /ventas/:id` → detalles con `itemId`, `modoInventario`, `cantidad`, `cantidadDevuelta`. Sin ventaId: secciones ocultas (comportamiento actual).
- [ ] Checkbox "Generar nota de crédito" (off, hint "Documento interno, sin emisión SII").
- [ ] Tabla "Devolver a inventario": input cantidad string decimal por fila; fila deshabilitada + nota si `modoInventario !== 'cantidad'` (serie/lote) o null (servicio); máx = `cantidad − cantidadDevuelta` (Decimal.js en `puedeConfirmar`).
- [ ] Payload: `{ monto, generarNotaCredito?, devoluciones? }` — omitir campos vacíos; devoluciones solo filas > 0.
- [ ] Respuesta: `warning` → toast warning; `notaCreditoId` → toast success con mención NC; siempre `emit('success')`.

### T8 — `VentaDetalleDrawer.vue` + `pages/ventas/index.vue`
- [ ] Drawer: extender interfaz `VentaDetalle`; badge "NC" en header si `tipoDocumento?.codigo === '61'`; UCard "Reembolsos" tras "Pagos" (fecha/monto/estado + total aprobado + leyenda parcial/total); card "Documentos relacionados" con links a NCs hijas y a la venta original (navegan a `/ventas?venta=<id>`, la página ya observa esa query).
- [ ] Listado: `VentaResumen` + `totalReembolsado`/`esNotaCredito`; en `#estado-cell` badge derivado (Decimal.js): `0 < reemb < total` → "Reemb. parcial" (warning), `≥ total` → "Reembolsada" (info); badge "NC" si es nota de crédito.

## Docs vivas (mismo cambio)

- [ ] `docs/features/reembolsos-nota-credito.md` desde TEMPLATE + link en `docs/README.md`
- [ ] Tabla "Estado actual" de `CLAUDE.md`
- [ ] `startup-pos.sql`: seed tipo 61 + índices nuevos
- [ ] `docs/features/pasarela-pagos.md`: respuesta del endpoint de reembolso con `notaCreditoId`/`warning`

## Verification

- [ ] `cd backend && npx jest src/modules/ventas src/modules/pasarela` + eslint sobre archivos tocados.
- [ ] E2E manual (stack Docker con hot reload):
  - Checkout online → orden `conciliada` con venta.
  - Reembolso parcial CON NC + devolución de un ítem modo cantidad: verificar en BD la venta NC (tipo 61, `venta_referencia_id`, estado pagada, total = monto), movimiento `entrada/devolucion` ligado a la NC y stock incrementado.
  - Drawer de venta: sección Reembolsos + link NC; listado con badges "Reemb. parcial" y "NC".
  - Reembolso sin NC ni devoluciones: regresión intacta.
  - Reembolso del resto → badge "Reembolsada"; Σ NCs no puede exceder total (probar 400).
  - Ítem serie/lote: fila deshabilitada en modal; forzar por API → 400 con mensaje claro.
  - El POS no ofrece "Nota de Crédito" como tipo de documento al vender.

## Decisions / Open questions

- Reutiliza permiso `Pasarelas:Reembolsar` (sin endpoint independiente de NC en esta fase).
- No se valida cruce monto NC ↔ líneas devueltas (flexibilidad pedida).
- Anotar error de NC en `orden.metadata` para auditoría: opcional, incluir en T5 si no complica.

## Orden de ejecución

T1 → T2 → T3 (TDD) → T4 → T5 (TDD) → T6 → T7 → T8 → docs. (T3-T4 y T6 paralelizables tras T1-T2; T7-T8 requieren T5-T6.)
