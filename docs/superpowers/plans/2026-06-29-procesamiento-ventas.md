# Plan: Procesamiento de ventas (transaccional) — punto 10

Status: Draft
Date: 2026-06-29
Owner: Cesar Matheus

> Nota de convención: al ejecutar, copiar este plan a
> `docs/superpowers/plans/2026-06-29-procesamiento-ventas.md` (fuente de verdad en el repo).

## Context

El punto 10 de `docs/PRODUCTO.md` pide registrar una **venta completa en una sola
transacción atómica**: cabecera + líneas + reglas aplicadas + customer + pagos, con
descuento automático de stock. Las piezas de las que depende ya existen y se reutilizan
tal cual:

- **Motor de precios** — `CalculoPreciosService.calcular(tenantId, dto)` devuelve montos
  por línea y totales (puro, sin persistencia). Es la fuente autoritativa de los importes.
- **Inventario** — `InventarioService.registrarMovimiento(manager, params)` ya es
  *manager-aware* (recibe el `EntityManager`), así que la salida de stock entra en la
  misma transacción de la venta.
- **Caja** — `CajaService.findActiva(tenantId, usuarioId)` resuelve la caja física abierta.

**Alcance decidido con el usuario:** solo canal `fisico`; pagos *inline* en `POST /ventas`
con auto-estado (`pagada`/`pendiente`) y cálculo de vuelto; notas de crédito **diferidas**;
**solo backend** (sin pantalla POS en esta fase).

## Scope / Out of scope

**In scope**
- Módulo backend `ventas`: entities, DTOs, service transaccional, controller, tests.
- `POST /ventas` — crea venta + detalles + reglas + customer + pagos + movimientos de
  inventario (`salida`/`venta`) + movimientos de caja (efectivo) en una transacción.
- `GET /ventas` y `GET /ventas/:id` — consulta básica (parte del punto 11, mínima para verificar).
- Conversión de moneda por línea a moneda oficial al persistir.
- Refactor menor de `CajaService` para exponer registro de movimiento *manager-aware*.
- Seed mínimo para E2E (tipos de documento + asegurar `permite_vuelto` en efectivo).

**Out of scope** (fases futuras)
- Canal `online` + caja virtual.
- Notas de crédito / devoluciones (`venta_referencia_id`, entrada/`devolucion`).
- Estado `borrador` editable (la venta se crea ya confirmada).
- Pantalla POS en Nuxt; punto 11 completo; punto 13 como endpoint separado.
- Evaluación de condiciones de reglas (sigue como en el motor: solo `condicion_tipo='ninguna'`).

## Backend

Nuevo módulo en `backend/src/modules/ventas/`, registrado en `app.module.ts`
(entities al array de `TypeOrmModule.forRoot` + `VentasModule` a `imports`).
Importa `CalculoPreciosModule`, `InventarioModule`, `CajaModule`, `ItemsModule`.
Referencia canónica de transacción multi-tabla: `modules/tenants/tenants.service.ts → create()`.

### Entities (`entities/`) — todas con `type:'uuid'` en PK/FK (ADR-004) y triada de auditoría
- `venta.entity.ts` (`ventas`) — incluye `canal`, `estado` (enum `estado_venta`), totales,
  `venta_referencia_id` (nullable, sin uso ahora), `caja_id`, `moneda_id`, `tipo_documento_id`.
- `venta-detalle.entity.ts` (`venta_detalles`).
- `venta-descuento.entity.ts`, `venta-recargo.entity.ts`, `venta-impuesto.entity.ts`
  (`aplicado_en`: `'detalle' | 'venta'`).
- `venta-customer.entity.ts` (`venta_customer`).
- `pago.entity.ts` (`pagos`).
- Columnas dinero/cantidad: `decimal` precision 18 scale 4 (mapean a `string`).

### DTOs (`dto/create-venta.dto.ts`)
Reutiliza la forma de `CalcularVentaDto`/`LineaDto` (mismos `itemId`, `cantidad`,
`precioUnitario?`, `descuentoIds?`, `recargoIds?`, `impuestoIds?`). Agrega:
- En la línea: `unidadIds?: string[]` (modo `serie`) y `loteId?: string` (modo `lote`)
  para pasar a inventario.
- `tipoDocumentoId?: string` (UUID, opcional).
- `customer?: { terceroId?, nombre, rut?, direccion?, telefono?, email? }` (opcional; `nombre` requerido si viene).
- `pagos: { metodoPagoId, monto, referencia? }[]` (montos como `@IsNumberString`).
- `metodoPagoId?`, `descuentosVentaIds?`, `recargosVentaIds?` (se pasan al motor).
- `comentario?`.

### `ventas.service.ts` — `crear(tenantId, usuarioId, dto)`
1. **Caja**: `cajaService.findActiva(tenantId, usuarioId)`; si no hay → `BadRequestException('No tienes una caja abierta')`.
2. **Moneda oficial**: resolver `tenant_moneda` con `es_default = true` (su `moneda_id` es la oficial; `valor_del_dia` base = 1).
3. **Resolver líneas y convertir moneda** (antes del motor): por cada línea, `itemsService.findOne(tenantId, itemId)` → `precioBase`, `monedaId`, `tipo`. Tasa = `valor_del_dia` de `item.monedaId` en `tenant_moneda` (1 si = oficial). `precioOrigen = override ?? precioBase`; `precioConvertido = precioOrigen × tasa`.
4. **Calcular importes**: construir `CalcularVentaDto` con `precioUnitario = precioConvertido` por línea y llamar `calculoPreciosService.calcular(tenantId, dto)` → `ResultadoVenta` (ya en moneda oficial). Es la fuente de los totales persistidos.
5. **Pagos / vuelto / estado** (Decimal.js):
   - `sumaPagos = Σ monto`. `excedente = max(0, sumaPagos − totalFinal)`.
   - Si `excedente > 0`: requiere al menos un pago cuyo método tenga `tenant_metodo_pago.permite_vuelto = true`; asignarle el `vuelto`. Si ninguno lo permite → `BadRequestException`.
   - `montoAplicado = sumaPagos − excedente`. Estado = `montoAplicado ≥ totalFinal ? 'pagada' : 'pendiente'`.
6. **Transacción** (`dataSource.transaction(async manager => …)`):
   - `ventas` (cabecera con totales del motor, `canal='fisico'`, `caja_id`, `moneda_id`=oficial, estado).
   - `venta_detalles` por línea (mapeando `ResultadoVenta.lineas`: `precio_unitario_origen=precioOrigen`, `tasa_cambio`, `precio_unitario=precioConvertido`, `subtotal=subtotalNeto`, `descuento/recargo/impuesto_aplicado`, `total_linea`). `descripcion`=nombre del item.
   - `ventas_descuentos` / `ventas_recargos` / `ventas_impuestos`: agregar las trazas por `regla id` (sumando `valor_aplicado`); `aplicado_en='detalle'` para trazas de línea y `'venta'` para `trazasVenta`. `porcentaje_aplicado`: `tasa` para impuestos, `null` para desc/recargos en esta fase (columna nullable).
   - `venta_customer` si `dto.customer`.
   - **Inventario** por línea con `item.tipo='producto'`: `inventarioService.registrarMovimiento(manager, { tenantId, itemId, tipo:'salida', motivo:'venta', cantidad, usuarioId, ventaId, unidadIds, loteId })`. Valida stock (lanza y revierte).
   - `pagos` por cada pago (`tenant_id`, `venta_id`, `metodo_pago_id`, `moneda_oficial_id`, `caja_id`, `monto`, `vuelto`).
   - **Movimiento de caja** por cada pago en **efectivo** (`permite_vuelto=true`): `cajaService` (método nuevo, abajo) crea `movimientos_caja` `tipo='entrada'`, `monto = pago.monto − pago.vuelto` (efectivo neto que queda en caja), `venta_id`, `pago_id`, concepto `'Venta'`.
   - Retornar la venta con sus relaciones.
7. **Lecturas**: `listar(tenantId, filtros)` y `findOne(tenantId, ventaId)` con líneas/reglas/customer/pagos expandidos (SQL raw con joins, filtrando `eliminado_el IS NULL`, mapeo snake→camel — patrón `monedas.service.ts → findMonedas`).

### Refactor `CajaService` (resuelve la fricción transaccional)
`registrarMovimiento` abre su propia transacción y no acepta `manager`. Extraer la
inserción a un método *manager-aware* y reutilizarlo:
```ts
async registrarMovimientoEnTransaccion(
  manager: EntityManager,
  params: { cajaId; tipo; concepto; monto; referencia?; ventaId?; pagoId? },
): Promise<MovimientoCaja>
```
El `registrarMovimiento` público pasa a envolver este método dentro de su transacción
(conservando la validación de caja abierta y saldo). `CajaModule` ya exporta `CajaService`.
`MovimientoCaja` ya tiene columnas `ventaId`/`pagoId` (no requiere migración).

### Controller (`ventas.controller.ts`)
`@UseGuards(JwtAuthGuard, TenantGuard)` a nivel clase. `POST /ventas`, `GET /ventas`,
`GET /ventas/:id`. `tenantId`/`usuarioId` desde `req.user` (nunca del body). Vender no
requiere admin (cajero); dejar comentario `// TODO @RequiresPermiso('ventas.crear')` para
la fase de RBAC granular (decisión G).

### Seed (`seeder.service.ts`) — mínimo para E2E
- Asegurar al menos un `tipos_documento_tributario` para el país de prueba (ej. Boleta/Factura CL) con IDs fijos `550e8400-…-446655440XXX`.
- Verificar que exista un `tenant_metodo_pago` con `permite_vuelto=true` (efectivo) para el tenant de prueba; si no, agregarlo.

## Frontend
Sin cambios en esta fase (solo backend).

## Verification
- **Unit (TDD)** `ventas.service.spec.ts`: vuelto y estado (`pagada`/`pendiente`/excedente sin método con vuelto → error); conversión de moneda por línea; mapeo de `ResultadoVenta` a detalles/reglas; sin caja abierta → error. Mockear servicios dependientes.
- **E2E** `test/ventas.e2e-spec.ts`: abrir caja → `POST /ventas` (1 producto + efectivo que cubre total) → 201, estado `pagada`; verificar que bajó `item_producto.stock`, que hay `movimientos_inventario` `salida/venta` y `movimientos_caja` `entrada`; `GET /ventas/:id` expande todo. Caso stock insuficiente → 400/422 y **rollback** (sin venta ni movimientos). Caso sin caja → 400.
- **Manual**: `docker-compose up --build`; abrir caja vía API; crear venta; revisar Swagger `3000/api/docs`. Cerrar caja y confirmar que `saldo_esperado` refleja el efectivo de la venta.
- `cd backend && npm test && npm run test:e2e && npm run lint`.

## Documentación viva (mismo cambio)
- `docs/features/ventas.md` (desde TEMPLATE) + link en `docs/README.md`.
- Tabla "Estado actual" de `CLAUDE.md` + `docs/MIGRACION-FUNCIONALIDADES.md`: Procesamiento de ventas → ✅.
- `docs/patterns/backend.md`: nota del patrón de transacción venta + refactor *manager-aware* de caja, si aporta.

## Decisions / Open questions
- **Efectivo = `permite_vuelto`**: heurística usada para decidir qué pagos generan
  `movimientos_caja` (no hay flag `es_efectivo`). El efectivo neto en caja = `monto − vuelto`.
  Refinable cuando exista una marca explícita de método en efectivo.
- **`porcentaje_aplicado`** en `ventas_descuentos`/`ventas_recargos` queda `null` (las trazas
  del motor solo exponen monto). Impuestos sí guardan `tasa`. Aceptable (columna nullable).
- **Moneda oficial** se resuelve por `tenant_moneda.es_default=true` (sembrado al crear tenant).
