# Plan: Ventas como documentos + módulo de Pagos (cuentas por cobrar)

**Status**: Draft
**Date**: 2026-06-30
**Owner**: Cesar Matheus

> Al ejecutar: copiar este plan a `docs/superpowers/plans/2026-06-30-ventas-pagos-cuentas-por-cobrar.md`
> (convención del repo, CLAUDE.md). Seguir TDD (skill `tdd-workflow`): test del service antes de implementar.

## Context

Hoy los pagos **solo** se crean inline al crear una venta (`ventas.service.crear`,
`ventas.service.ts:304-339`), y `CreateVentaDto.pagos` exige mínimo 1 pago
(`@ArrayMinSize(1)`). Eso impide el caso real del negocio: **facturar hoy y cobrar
después**, total o parcialmente (cuentas por cobrar). No existe pantalla de consulta
de ventas ni de pagos, ni forma de abonar a una venta ya emitida.

Objetivo: separar conceptualmente **venta = documento inmutable** y **pago = evento de
cobro**, con el estado de la venta **derivado del saldo**. Construir el módulo `pagos`
(GET listado + POST abono), la pantalla de historial/detalle de ventas con acción
"Registrar pago", y el ledger read-only de pagos.

Decisiones confirmadas con el usuario:
- Dos módulos backend (`ventas` + `pagos` nuevo), con **`PagosService.registrar()` como
  fuente única** de la lógica pago+vuelto+movimiento de caja (la reutiliza tanto la
  venta nueva como el abono posterior).
- Alcance fase 1: **ambas pantallas** (`/ventas/historial` + `/pagos`) + abono.
- El abono a venta física **requiere caja abierta** y genera su movimiento de caja
  (consistente con el modelo actual).

## Scope

**In scope (fase 1)**
- Estado `pagada_parcial` + saldo derivado de los pagos.
- Permitir crear venta **sin pagos** (queda `pendiente` = cuenta por cobrar).
- `PagosService.registrar(manager, …)` compartido; refactor de `ventas.crear` para usarlo.
- `POST /pagos` (abonar a venta existente) y `GET /pagos` (ledger filtrable).
- `GET /ventas` enriquecido con `montoPagado` y `saldo`.
- Frontend: `/ventas/historial` (lista), `/ventas/[id]` (detalle + "Registrar pago"),
  `/pagos` (ledger read-only), entradas de sidebar.

**Out of scope (fase 2)**
- Reverso/anulación de pagos, edición de pagos.
- Nota de crédito desde la UI.
- Reportes/conciliación de caja avanzados.
- Pagos sin movimiento de caja (abono puramente contable).

## Modelo

```
saldo = total_final − Σ(pago.monto − pago.vuelto)
saldo == total_final    → pendiente
0 < saldo < total_final → pagada_parcial   (NUEVO)
saldo <= 0              → pagada
```
Inmutabilidad: venta y pago no se editan una vez creados; lo único que cambia es
`venta.estado` (valor derivado). Correcciones → nota de crédito (fase 2).

---

## Backend

### 1. Estado nuevo `pagada_parcial`
- [ ] `entities/venta.entity.ts:10` — agregar `PAGADA_PARCIAL = 'pagada_parcial'` al enum `EstadoVenta`.
- [ ] `startup-pos.sql:27` — agregar `'pagada_parcial'` al `CREATE TYPE estado_venta`.
  (Dev usa `synchronize: true`, `app.module.ts:142`; con DB fresca se crea solo. El SQL es doc viva.)

### 2. Mover entidad `Pago` al módulo nuevo
- [ ] Mover `modules/ventas/entities/pago.entity.ts` → `modules/pagos/entities/pago.entity.ts` (sin cambios de columnas).
- [ ] Actualizar el import en `ventas.service.ts:20`.
- [ ] `app.module.ts` — la entity `Pago` ya está en el array `entities`; solo ajustar la ruta de import.

### 3. Módulo `pagos` (patrón `docs/patterns/backend.md`)
```
modules/pagos/
├── entities/pago.entity.ts        # movida desde ventas
├── dto/create-pago.dto.ts         # { ventaId: uuid, pagos: PagoVentaDto[] }
├── dto/query-pagos.dto.ts         # filtros opcionales (fecha, metodoPagoId, cajaId, ventaId)
├── pagos.service.ts
├── pagos.service.spec.ts          # TDD primero
├── pagos.controller.ts
└── pagos.module.ts
```
- [ ] **`PagosService.registrar(manager, { tenantId, usuarioId, venta, pagos, caja, monedaOficialId })`**
      — extraer la lógica de `ventas.service.ts:111-155` (resolver método+`permite_vuelto`,
      vuelto/excedente, validación "ningún método permite vuelto") y `:304-339`
      (guardar `Pago` + movimiento de caja vía `cajaService.registrarMovimientoEnTransaccion`).
      Recibe el **target** sobre el que se calcula el vuelto (totalFinal en venta nueva,
      `saldo` restante en abono). Devuelve los pagos guardados.
- [ ] **`PagosService.registrarAbono(tenantId, usuarioId, dto)`** — abre transacción:
      carga la venta (tenant, no `eliminado_el`); valida estado en `pendiente|pagada_parcial`
      (rechaza `pagada|cancelada|borrador` con `BadRequestException`); `cajaService.findActiva`
      (requiere caja abierta); calcula saldo desde pagos existentes; llama `registrar(...)`
      con target=saldo; **recalcula `venta.estado`** desde Σ pagos vs `total_final` y lo guarda.
- [ ] Helper puro `calcularEstadoVenta(totalFinal, montoAplicadoTotal): EstadoVenta`
      (testeable directo) usado por `crear` y `registrarAbono`.
- [ ] **`PagosService.listar(tenantId, query)`** — SQL raw (patrón `ventas.service.ts:457`):
      `pagos p JOIN ventas v JOIN metodos_pago mp LEFT JOIN venta_customer`, filtrar
      `eliminado_el IS NULL`, `WHERE p.tenant_id=$1`, filtros opcionales, `ORDER BY p.creado_el DESC`.
      Devuelve `{ id, ventaId, fecha, metodoNombre, monto, vuelto, cajaId, customerNombre, estadoVenta }`.

### 4. Controller `pagos` (guards `JwtAuthGuard, TenantGuard`)
- [ ] `GET /pagos` — `listar(tenantId, query)`.
- [ ] `POST /pagos` — `registrarAbono(tenantId, usuarioId, dto)`.
  (Operativo, no admin-only — igual que `POST /ventas`, `ventas.controller.ts:20`.)
- [ ] `PagosModule` exporta `PagosService`; `forFeature([Pago])`.

### 5. Refactor `ventas`
- [ ] `CreateVentaDto.pagos` (`dto/create-venta.dto.ts:91-95`) — quitar `@ArrayMinSize(1)`,
      hacerlo `@IsOptional()` con default `[]` (venta sin pago = cuenta por cobrar `pendiente`).
- [ ] `ventas.service.crear` — reemplazar bloques `:111-155` y `:304-339` por una llamada a
      `pagosService.registrar(manager, …)` con target=`totalFinal`; estado vía
      `calcularEstadoVenta`. Con `pagos=[]` → sin movimientos de caja, estado `pendiente`.
- [ ] `VentasModule` importa `PagosModule` para inyectar `PagosService`.
- [ ] `ventas.service.listar` (`:383`) — enriquecer cada fila con `montoPagado` y `saldo`
      (subquery `SUM(monto - vuelto)` sobre `pagos`). Mapear a `{ …, montoPagado, saldo }`.

### 6. Tests (TDD, `pagos.service.spec.ts`)
- [ ] `registrarAbono`: `pendiente`→`pagada_parcial` (abono parcial); `pagada_parcial`→`pagada`
      (completa saldo); rechazo sobre venta `pagada`/`cancelada`; excedente con método sin
      vuelto → `BadRequestException`; excedente con efectivo → vuelto correcto.
- [ ] `calcularEstadoVenta`: los tres tramos del saldo.
- [ ] Mantener verde `ventas.service.spec.ts` tras el refactor (ajustar mocks de `PagosService`).
- [ ] `cd backend && npm test`, `tsc` limpio, `npm run lint`.

---

## Frontend

Patrones: `docs/patterns/frontend.md`. Tabla read-only → `components/caja/CajaHistorial.vue`.
Formato → `useFormatters` (`formatMonto`, `formatFecha`). API → `useApiFetch`. Helpers de pago
puros ya existen en `composables/useVenta.ts` (`resumenCobro`, `clampNoVuelto`, `sumaPagos`).

### 7. Historial de ventas — `app/pages/ventas/historial.vue`
- [ ] `definePageMeta({ middleware: 'auth', layout: 'dashboard' })`.
- [ ] `GET /ventas` → tabla (patrón `CajaHistorial`): fecha, doc/customer, total, pagado,
      **saldo**, badge de estado (`pendiente`/`pagada_parcial`/`pagada`/`cancelada`),
      fila clickeable → `/ventas/[id]`.

### 8. Detalle de venta — `app/pages/ventas/[id].vue`
- [ ] `GET /ventas/:id` (ya devuelve detalles + pagos + totales, `ventas.service.ts:400-538`).
- [ ] Mostrar líneas, totales, lista de pagos, saldo y badge de estado.
- [ ] Si estado `pendiente`|`pagada_parcial`: botón **"Registrar pago"** → abre modal de abono.

### 9. Modal de abono — `app/components/pagos/AbonoModal.vue`
- [ ] Componente delgado que **reutiliza** `resumenCobro`/`clampNoVuelto`/`sumaPagos` con
      `total = saldo` (no clonar lógica de `CobroModal.vue`; reusar helpers de `useVenta.ts`).
- [ ] Carga métodos con `GET /metodos-pago`; al confirmar → `POST /pagos` con `{ ventaId, pagos }`.
- [ ] Éxito → re-`cargar()` el detalle (estado/saldo actualizados) + toast. Errores vía `apiErrorMsg`.

### 10. Ledger de pagos — `app/pages/pagos/index.vue`
- [ ] `definePageMeta({ middleware: 'auth', layout: 'dashboard' })`.
- [ ] `GET /pagos` → tabla read-only (patrón `CajaHistorial`): fecha, método, monto, vuelto,
      caja, customer, link a su venta. Filtro simple por método (toggle/`USelect`).

### 11. Navegación — `app/layouts/dashboard.vue:8-43`
- [ ] Agregar `{ label: 'Ventas', icon: 'i-heroicons-document-text', to: '/ventas/historial' }`
      gated `permissionsStore.esAdmin || can('Ventas','Leer')`.
- [ ] Agregar `{ label: 'Pagos', icon: 'i-heroicons-banknotes', to: '/pagos' }` con el mismo gating.
- [ ] El POS sigue en `/ventas` (label "Punto de venta", sin cambios).

---

## Verification

1. `docker-compose down -v && docker-compose up --build` (DB fresca con enum nuevo + seed).
2. **Backend**: `cd backend && npm test` (verde, incl. `pagos.service.spec.ts`), `npm run lint`, `tsc`.
3. **Cuenta por cobrar**: crear venta **sin pagos** (POS o API) → queda `pendiente`, saldo = total.
4. **Abono parcial**: `POST /pagos` con monto < saldo → venta pasa a `pagada_parcial`, saldo baja,
   aparece movimiento de caja por el neto. Repetir hasta saldar → `pagada`.
5. **Reglas**: abono sobre venta `pagada`/`cancelada` → 400; sobrepago con método sin vuelto → 400;
   sobrepago con efectivo → vuelto correcto y movimiento de caja por el neto.
6. **Frontend**: login admin → sidebar "Ventas" lista con estados/saldo; abrir detalle de una
   `pendiente`, "Registrar pago", confirmar, ver estado/saldo actualizados; "Pagos" muestra el ledger.

## Docs vivas (mismo commit)
- [ ] `startup-pos.sql` (enum), tabla "Estado actual" de `CLAUDE.md` (módulo Pagos / consulta de ventas → ✅).
- [ ] Decisión en `CLAUDE.md` §Ventas: estado `pagada_parcial`, saldo derivado, cuentas por cobrar.
- [ ] `docs/features/pagos.md` (desde TEMPLATE) + actualizar `docs/features/ventas.md` + link en `docs/README.md`.
- [ ] `docs/MIGRACION-FUNCIONALIDADES.md`.

## Decisions / Open questions
- **Caja al crear venta sin pago**: hoy `ventas.crear` exige caja abierta (`ventas.service.ts:41`).
  Se mantiene por consistencia con el canal físico (la venta lleva `caja_id`). Si más adelante se
  quiere facturar a crédito fuera del POS, se revisa en fase 2.
- **Permiso de lectura**: sidebar gated por `can('Ventas','Leer')` (no se crea recurso RBAC
  `Pagos` nuevo en fase 1). Backend usa `JwtAuthGuard + TenantGuard`.
