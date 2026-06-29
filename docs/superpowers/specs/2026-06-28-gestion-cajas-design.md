# Diseño: Gestión de cajas (ciclo de vida standalone)

- **Status:** Draft
- **Date:** 2026-06-28
- **Owner:** Cesar Matheus

## Context

El SaaS POS necesita la gestión de cajas como prerequisito de Ventas/Pagos (ambos
🔲 por construir). Esta iteración cubre el **ciclo de vida standalone** de la caja
física: abrir, consultar caja activa, registrar movimientos manuales (entrada/salida),
y cerrar con cuadre. La integración venta→movimiento de caja queda fuera de alcance
hasta que exista el módulo de ventas; se dejan los hooks (`venta_id`, `pago_id`) listos.

### Estado base existente
- Tablas `cajas` y `movimientos_caja` **ya existen** en `startup-pos.sql` (esquema completo, no se toca).
- Entity `Caja` vive hoy en `backend/src/modules/tenants/entities/caja.entity.ts`.
- La **caja virtual** se crea automáticamente al crear un tenant
  (`tenants.service.ts`: `tipo='virtual'`, `estado='abierta'`, `saldoInicial='0'`).
- Enum `tipo_movimiento` = `entrada | salida`.
- Módulo de navegación "Caja" (`/caja`) ya sembrado en `seeder.service.ts` con permisos CRUD.
- **No existe** todavía un módulo `caja` en backend ni entity de `movimientos_caja`.

### Reglas de negocio (PRODUCTO.md §12)
- `fisica` — apertura manual con saldo inicial en efectivo.
- `virtual` — automática, siempre abierta, recibe ventas online (system-managed).
- Una sola caja física abierta por tenant+usuario en simultáneo.
- Movimientos manuales: ingresos/egresos fuera de ventas (retiro, fondo de cambio, gastos menores).
- Cierre: `saldo_esperado = saldo_inicial + entradas − salidas`; `diferencia = monto_contado − saldo_esperado`. Se persisten ambos para auditoría.

## Scope / Out of scope

### En alcance
- Módulo backend `caja` (controller, service, entities, DTOs).
- Apertura, consulta de caja activa, movimientos manuales, cierre con cuadre.
- Historial de cajas (propias por defecto; todas para supervisión).
- Permiso RBAC dedicado `ver_todas` en el módulo Caja.
- Frontend: página única `/caja` con máquina de estados + historial.
- Tests unit + e2e. Docs vivas.

### Fuera de alcance
- Integración venta→movimiento de caja (se dejan hooks `venta_id`/`pago_id` nullables, sin uso).
- Distinción efectivo vs otros métodos en el cuadre (en esta fase todos los movimientos manuales son efectivo).
- Reapertura de cajas cerradas.
- Materialización de saldo en caja abierta (se calcula al vuelo).

## Backend

### Ubicación y entities
- Nuevo módulo `backend/src/modules/caja/`, registrado en `app.module.ts`.
- **Mover** `Caja` entity a `caja/entities/caja.entity.ts`. El módulo `tenants` la sigue
  importando vía `TypeOrmModule.forFeature([Caja])` (la creación de la caja virtual no cambia).
- **Nueva entity** `caja/entities/movimiento-caja.entity.ts` → tabla `movimientos_caja`:
  - `tipo` (`entrada|salida`), `concepto`, `monto` (decimal 18,4), `referencia?`, `fecha`.
  - `ventaId?` / `pagoId?` (uuid nullables) — hooks futuros, sin uso ahora.
  - Columnas UUID con `type: 'uuid'` explícito (ADR-004).

### Modelo de cálculo (Decimal.js — nunca number nativo)
- `saldo_esperado = saldo_inicial + Σ entradas − Σ salidas`, calculado al vuelo desde
  `movimientos_caja` (volumen bajo por caja; no se materializa saldo en caja abierta).
- Al cerrar se persisten `saldo_final` (= saldo_esperado), `monto_contado` y
  `diferencia = monto_contado − saldo_esperado`, `fecha_cierre`, `estado='cerrada'`.

### API REST (guards RBAC por ruta, módulo `Caja`)
| Método | Ruta | Acción | Permiso |
|---|---|---|---|
| GET | `/caja/activa` | Caja física abierta del usuario actual (o `null`) | `caja.ver` |
| POST | `/caja/abrir` | Abrir caja física `{ saldoInicial, comentario? }` | `caja.crear` |
| POST | `/caja/:id/movimientos` | Movimiento manual `{ tipo, concepto, monto, referencia? }` | `caja.crear` |
| GET | `/caja/:id/movimientos` | Listar movimientos de la caja | `caja.ver` |
| POST | `/caja/:id/cerrar` | Cerrar `{ montoContado, comentario? }` → cuadre | `caja.crear` |
| GET | `/caja` | Historial (propias; `?todas=true` → requiere `caja.ver_todas`) | `caja.ver` |
| GET | `/caja/:id` | Detalle de una caja | `caja.ver` |

- `tenant_id` y `usuario_id` siempre del token, nunca del body.
- Cada operación de escritura en su propia transacción.

### Validaciones / edge cases
- Abrir con caja física ya abierta (mismo tenant+usuario) → **409**.
- Movimiento/cierre sobre caja ajena o ya cerrada → **403 / 409**.
- `salida` que dejaría `saldo_esperado` negativo → **422** (bloqueo, consistente con kardex).
- `saldoInicial`, `montoContado`, `monto` ≥ 0 (class-validator).
- Caja `virtual` excluida de abrir/cerrar/movimientos manuales (system-managed).

### RBAC — permiso dedicado `ver_todas`
- Se agrega un permiso `ver_todas` al módulo Caja en el seeder (además de los CRUD existentes).
- `GET /caja?todas=true` lista todas las cajas del tenant solo si el usuario tiene `caja.ver_todas`.
- El rol `admin` (es_fijo) lo incluye automáticamente (incluye todos los permisos del tenant).
- Permite roles a medida tipo "Supervisor de caja" sin sobre-privilegiar (encargado de turno, auditor).

## Frontend

### Página única con estados (`pages/caja/index.vue`)
- Máquina de estados según `GET /caja/activa`:
  - Sin caja abierta → formulario de apertura.
  - Con caja abierta → dashboard (saldo inicial, entradas, salidas, saldo esperado, botones).
- Historial en sección/tab aparte dentro de la misma ruta.

### Store y llamadas
- Store Pinia `cajaStore` (o composable `useCaja`): `activa`, `abrir`, `registrarMovimiento`,
  `cerrar`, `historial`. Usar `$fetch` (no axios). Update optimista según patrón del proyecto.

### Componentes
- `CajaAperturaForm` — saldo inicial + comentario.
- `CajaActivaDashboard` — saldo y lista de movimientos en vivo.
- `CajaMovimientoModal` — alta de entrada/salida manual.
- `CajaCierreModal` — muestra el cuadre (saldo esperado, monto contado, diferencia) antes de confirmar.
- `CajaHistorial` — cajas cerradas con su diferencia; toggle "todas" si tiene `ver_todas`.

## Verification

- **Unit (service):** matemática de cuadre con Decimal.js; bloqueo de saldo negativo en `salida`;
  una-sola-caja-abierta por tenant+usuario; exclusión de la caja virtual.
- **E2E:** flujo abrir → movimiento entrada → movimiento salida → cerrar con diferencia = 0;
  cerrar con diferencia ≠ 0; intento de abrir segunda caja → 409; `?todas=true` sin permiso → solo propias.
- **Docs vivas (mismo cambio):** `docs/features/gestion-cajas.md` (nuevo) + link en `docs/README.md`;
  `docs/MIGRACION-FUNCIONALIDADES.md`; tabla "Estado actual" de `CLAUDE.md`; `docs/patterns/*` si surge patrón nuevo.

## Decisions / Open questions

- **Ubicación de la entity Caja:** se mueve a `caja/` y tenants la importa. (Aprobado)
- **Saldo negativo en salida:** bloqueado (422). (Aprobado)
- **Visibilidad admin:** permiso dedicado `caja.ver_todas` en vez de reusar rol admin. (Aprobado — C2)
- Sin decisiones abiertas pendientes.
