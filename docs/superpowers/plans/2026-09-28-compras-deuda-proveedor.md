# Plan: Compras — la deuda con el proveedor y sus pagos, con la salida de caja automática

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Done (2026-09-29 — las cinco tareas hechas y verificadas) · **Date:** 2026-09-28 · **Owner:** César

**Goal:** cada compra confirmada deja deuda con su proveedor, con vencimiento; un pago se
reparte entre sus compras o queda a favor; el pago en efectivo sale de la caja de quien paga
en el mismo acto; la compra al contado se registra en un gesto; y "Por pagar" muestra lo que
se debe.

**Architecture:** dos tablas nuevas (`pagos_proveedor`, `pago_proveedor_aplicaciones`) y
columnas en `compras`, `terceros`, `tipos_documento_compra` y `movimientos_caja`. La deuda se
**deriva al leer** (total − aplicaciones vivas), nunca se guarda. El pago en efectivo reusa la
validación y el rastro de la salida manual de `CajaService`, y la clave de idempotencia de los
cobros.

**Tech Stack:** NestJS + SQL crudo vía `Db` (`this.db.query` dentro de `this.db.transaccion`),
TypeORM solo para el esquema, class-validator; Nuxt 4 + Nuxt UI v4, Decimal.js, Vitest
(happy-dom), Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md`](../specs/2026-09-28-compras-deuda-proveedor-design.md).
Leerla entera antes de cada tarea: el plan argumenta desde ella y no repite sus reglas.

## Global Constraints

- `tenant_id` sale del token, nunca del body. **La caja del pago en efectivo tampoco viene del
  body**: la resuelve el servidor (spec § 5.1, decisión 3).
- Plata con **Decimal.js**, nunca `number`. `totalDocumento` y todo `monto` con
  `@EsMontoCobrado` + `EscalaMonedaPipe`. La única cuantización es la del total `suma_lineas`
  (spec § 4.1), importando `cuantizar` del motor **sin modificarlo**.
- Soft delete: toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`; las aplicaciones se
  ajustan marcando `eliminado_el` y reinsertando el resto, nunca `UPDATE` del monto ni `DELETE`.
- Sin N+1: las lecturas agregan en una consulta; escrituras en lote con `unnest`.
- Todo `FOR UPDATE` nuevo con `ORDER BY` y su unitario sobre el SQL; el orden es el de spec § 11.
- Entidades nuevas: registrarlas en `app.module.ts` (array `entities`, no solo `forFeature`).
- **El front manda exactamente lo que el DTO declara** (`forbidNonWhitelisted`).
- Los e2e usan `validacionGlobal()` y una `Idempotency-Key` nueva por POST que cobra.
- ⛔ **No tocar:** el motor de precios, nada fiscal (ni calcular impuestos ni validar el total
  contra el neto), las reglas de caja (apertura, cierre, cuadratura, ciego, qué guarda el
  rastro). Si una tarea parece pedirlo, **parar y preguntar**.
- Todo subagente con `model: 'sonnet'` explícito.
- No mergear ni pushear. Stagear por ruta explícita. Nunca `--no-verify`.

---

## Context

Viene de la pieza 1 (recepción), la 2 (unidad de compra) y la lectura del XML, todas en main.
Los puntos de entrada: `ComprasService` (`backend/src/modules/compras/compras.service.ts`,
con `conReintento` alrededor de confirmar y las correcciones) y `CajaService`
(`backend/src/modules/caja/caja.service.ts`).

**Hechos medidos al planificar (2026-09-28), para no redescubrirlos:**

- La salida manual valida en `registrarMovimientoEnCaja` (`caja.service.ts` ~1376):
  `bloquearCajaAbierta` → dueño de la caja → `calcularEsperadoEfectivo` → `IntentoRechazadoError`
  → `registrarMovimientoEnTransaccion`. La NC con devolución en efectivo
  (`ventas.service.ts` ~2150) es el precedente de un egreso que genera el sistema: mismo
  cálculo, su propio `tipo` en el rastro, envuelta en `conRastroDeRechazo`.
- `caja_intentos_rechazados.tipo` es `varchar` libre; sus rótulos viven en
  `frontend/app/components/caja/CajaIntentosRechazados.vue` y el comentario de
  `frontend/app/stores/caja.ts:138`.
- `CajaService.findActiva(tenantId, usuarioId)` devuelve la caja física abierta del usuario.
- `OperacionIdempotente` (`backend/src/modules/idempotencia/huella.ts`) hoy es
  `'venta.crear' | 'cuenta.cerrar' | 'pago.abono'`.
- Los tipos de documento se siembran en `seeder.service.ts` (~5113, ids 420–431): Factura,
  Factura exenta, Factura de compra, Guía de despacho, Boleta y Sin documento en Chile.
- En una factura, la línea guarda el **neto** (spec recepción § 9): por eso la deuda es el
  total transcrito (decisión 10), no la suma de las líneas.
- El lector del XML (`frontend/app/composables/useDte.ts`) lee `FchEmis` pero no `MntTotal`,
  `FchVenc` ni `FmaPago`.
- `cuantizar(d, cfg)` es un export de `calculo-precios.engine.ts` que `ventas.service.ts` ya
  importa.

## Scope / Out of scope

**Dentro:** spec § 3–§ 12. **Fuera:** spec § 13 (lo fiscal, la factura que agrupa guías,
pagar desde la caja ajena, vencimiento por cuota, devolución del proveedor, gastos sin
stock, moneda extranjera).

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/src/modules/compras/entities/pago-proveedor.entity.ts` (nuevo) | `pagos_proveedor` | 1 |
| `backend/src/modules/compras/entities/pago-proveedor-aplicacion.entity.ts` (nuevo) | `pago_proveedor_aplicaciones` | 1 |
| `compra.entity.ts`, `tipo-documento-compra.entity.ts`, `terceros/entities/tercero.entity.ts`, `caja/entities/movimiento-caja.entity.ts` | columnas nuevas (spec § 3) | 1 |
| `backend/src/modules/compras/deuda.ts` (nuevo) | lo puro de la cuenta: fondeo, recorte, estado derivado, vencimiento | 1–3 |
| `backend/src/modules/compras/pagos-proveedor.service.ts` (nuevo) | pagar, anular, lecturas de deuda | 2–3 |
| `compras.controller.ts`, `compras.service.ts`, sus DTOs | rutas nuevas, confirmar con pago, recorte | 1–3 |
| `caja.service.ts` | **solo** lo que el pago necesita exponer, sin cambiar reglas | 2 |
| `seeder.service.ts` | permiso `Pagar`, fixture, `total_documento` por tipo | 1 |
| `frontend/app/pages/compras/por-pagar.vue`, `components/compras/PagarProveedorModal.vue` (nuevos) | lo que ve y hace el dueño | 5 |
| `pages/compras/[id].vue`, `CompraConfirmada.vue`, `pages/compras/index.vue`, `pages/terceros.vue`, `composables/useCompras.ts`, `composables/useDte.ts` | total, vencimiento, confirmar con pago, insignias, plazo | 4–5 |

Si al implementar una tarea la división de archivos no calza, se ajusta con el criterio de
"no crear un archivo si cabe en uno existente" (CLAUDE.md) y se anota en esta tabla.

## Cierre de cada tarea (se repite en las cinco — no se saltea ninguna parte)

1. Gate completo, **entero, no un subset**, con el exit code de cada comando:
   `cd backend && npm run lint:check && npm run typecheck && npm test`, después
   `./scripts/reset-db.sh` → `npm run test:e2e` → `./scripts/reset-db.sh --verificar`;
   `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`.
   Entorno propio del worktree (`./scripts/entorno.sh db`; `stack` para Playwright).
2. Docs vivas de la tarea en el mismo commit (`docs/features/compras.md` siempre; las demás,
   donde la tarea lo diga).
3. `verify-feature` con revisión independiente: `domain-reviewer` siempre, y
   `api-security-reviewer` si la tarea toca controllers, DTOs o entidades. Con `model:
   'sonnet'` y **la duda concreta** que la tarea dejó, no "revisá todo". El revisor lee lo
   staged: re-stagear antes de pedir una re-revisión. No correr revisión y e2e a la vez.
4. Commit en la rama del worktree; rebase sobre main con el árbol limpio; aviso a la sesión
   orquestadora con rama, hash, gate con conteos y veredictos.

---

### Task 1: Backend — el esquema, el total, el vencimiento y el permiso

**Intención:** que la compra sepa cuánto se debe y cuándo vence, sin que exista todavía
ningún pago. Al terminar, una compra confirmada tiene `total_documento` (si su tipo lo lleva)
y `fecha_vencimiento`, y un proveedor tiene plazo.

- [x] Columnas de spec § 3 en `compras`, `terceros` y `tipos_documento_compra`, con el `CHECK`
  de `total_documento` en el catálogo. **Las tablas `pagos_proveedor` y
  `pago_proveedor_aplicaciones` y `movimientos_caja.pago_proveedor_id` pasaron a la tarea 2**
  (ruling del controlador, 2026-09-28: en esta tarea nada las lee ni las escribe).
- [x] **Movido desde la tarea 4** (ruling del controlador, 2026-09-28): "Total del documento" y
  "Vence el" en la carga del borrador (`[id].vue` + el body en `useCompras.ts`). Desde esta tarea
  confirmar una factura sin total es 400, y sin el campo la pantalla no podía confirmar ninguna.
- [x] Seed: `total_documento` por tipo (spec § 3), acción `Pagar` en `Compras`, el rol
  `Compras · Encargado` sin ella, y un fixture con `Pagar`. Ids: los siguientes libres.
- [x] `terceros`: `plazoPagoDias` en crear/actualizar (entero > 0 o `null`) y en la lectura.
  Guard de Terceros sin cambios.
- [x] Borrador (`POST`/`PATCH /compras`): `totalDocumento` y `fechaVencimiento` opcionales;
  `totalDocumento` en un tipo `suma_lineas` es 400.
- [x] Confirmar: 400 "Falta el total del documento" en un tipo `obligatorio` sin total; fija
  `fecha_vencimiento` (spec § 4.2). Nada de pago todavía.
- [x] `PATCH /compras/:id/documento` (`Actualizar`), con las reglas de spec § 6 salvo el
  recorte (llega en la tarea 3, cuando haya aplicaciones).
- [x] `deuda.ts`: `vencimiento(fechaDocumento, plazo, fechaTipeada)` y `totalCompra(...)` con
  la cuantización única, con unitarios (el 1 de octubre + 15 = 16; `null` → 30; la tipeada
  manda; un total `suma_lineas` con decimales de más cuantizado una vez con el modo del tenant).
- [x] E2E: confirmar una factura sin total (400) y con total; guía sin total (pasa); boleta
  (el total es la suma); vencimiento con y sin plazo; `PATCH /documento` con permiso y sin él
  (403); montos fuera de escala (400).
- [x] Docs: `compras.md` (el modelo y el vencimiento).

**Duda concreta para el revisor:** ¿alguna lectura nueva o un `JOIN` a `terceros` perdió el
filtro de `eliminado_el`? ¿El `CHECK` del catálogo acepta exactamente los tres valores?

### Task 2: Backend — pagar y anular un pago

> **Hecha (2026-09-29), `d6d45c66`**, con el arreglo del seed aparte en `8805e996`. Gate: backend
> unit 3039/3039, e2e completo 1243/0 (6 skipped); frontend 1563/1563. Revisión LIMPIO tras cinco
> rondas. Lo que cambió en el camino, para el que siga: (1) el fixture `compras.paga` no tenía su
> par usuario→tenant; (2) el spec de pagos abría una caja con `admin.paris` y nunca la cerraba
> —73 fallos de 409 en siete suites ajenas—: ahora paga `compras.paga` desde su propia caja (el
> rol `Compras · Paga` suma `MiCaja`) y el `afterAll` la cierra en `try`/`finally`; (3)
> `items-pausados.e2e-spec.ts` listaba la primera página de 100 productos de todo el tenant y
> se filtra por la marca de sus propios ítems. Dos fallos de concurrencia que aparecieron bajo
> carga no se reprodujeron en la corrida del gate; el DDL que `synchronize` corre en cada
> arranque es previo y ajeno (índices creados por el seeder), anotado por la orquestadora en
> `pendientes.md` § 2.

**Intención:** poder registrar un pago —repartido, parcial, anticipo o con saldo a favor—,
que el efectivo salga de la caja de quien paga con la misma validación y el mismo rastro que
la salida manual, y poder anularlo según las decisiones 6 y 6c.

- [x] **Movido desde la tarea 1** (ruling del controlador): las entidades `pagos_proveedor` y
  `pago_proveedor_aplicaciones` y la columna `movimientos_caja.pago_proveedor_id` (spec § 3),
  registradas en `app.module.ts` (array `entities`), con sus `CHECK`s de montos > 0, los
  índices de sus FKs y su entrada en `startup-pos.sql`.
- [x] **Movido desde la tarea 3** (ruling del controlador): `GET /compras/pagos?proveedorId=`
  (`Pagar`), con sus aplicaciones; y `POST /compras/pagos` devuelve el pago con sus
  aplicaciones. Sin una lectura, los e2e de esta tarea solo podrían afirmar por SQL. El pago se
  expone también como método que corre en una transacción dada, para que la tarea 3 lo reuse
  al confirmar.
- [x] **Primer paso, un spike acotado:** cómo se componen `IdempotenciaService.ejecutar`,
  `db.transaccion` y `CajaService.conRastroDeRechazo` para que el 422 deje su fila en el rastro
  y el reintento con la misma clave reproduzca. Se decide mirando cómo lo hace
  `ventas.service.ts` (~1500) y se anota el orden elegido acá antes de seguir.
  **Elegido:** `conRastroDeRechazo( idempotencia.ejecutar( db.transaccion( pagarEnTransaccion ) ) )`.
  El rastro va afuera de todo: cuando el 422 lo dispara, la transacción ya se deshizo (reclamo
  de la clave incluido), así que la fila se escribe sin transacción viva y el reintento con la
  misma clave corre de verdad. La tarea 3 llama a `pagarEnTransaccion(manager, tenantId,
  usuarioId, dto)` dentro de la transacción de confirmar y decide ella el envoltorio.
- [x] `OperacionIdempotente` suma `'compras.pago'`; la huella se arma a mano.
- [x] `GET /compras/medios-pago` (`Pagar`): los medios habilitados del tenant, con
  `esEfectivo`.
- [x] `POST /compras/pagos` (`Pagar`, `Idempotency-Key`): validaciones, fondeo (saldo a favor
  primero, pagos más viejos primero, después el nuevo) y efectivo según spec § 5.1. Lo que
  `CajaService` tenga que exponer para esto se expone sin cambiar su conducta.
- [x] `POST /compras/pagos/:id/anular` (`Pagar`): spec § 5.2, con la entrada reversa solo con
  la caja abierta y solo para su dueño.
- [x] Locks en el orden de spec § 11, con unitarios sobre el `ORDER BY`.
- [x] `deuda.ts`: `fondear(...)` puro, con unitarios (saldo primero, más viejo primero, una
  aplicación partida en dos, el sobrante a favor).
- [x] E2E (spec § 12): Don Pedro; anticipo; usar saldo con `monto` 0; efectivo sin caja
  (400), sin plata (422 + fila `pago_proveedor` en el rastro, sin el esperado en el mensaje),
  con caja (el esperado baja); anular con caja abierta, cerrada y ajena (403); reintento con
  la misma clave (un pago); **403 con el rol real del bodeguero**; otro tenant (404).
- [x] Docs: `compras.md` (pagar y anular) y `gestion-cajas.md` (el camino nuevo en la tabla
  del rastro, y la salida que genera un pago a proveedor).

**Duda concreta para el revisor:** ¿el pago en efectivo pasa por **exactamente** la misma
validación que `POST /caja/:id/movimientos`, o hay un camino donde la salida se escribe sin el
chequeo del esperado? ¿Algún mensaje del 422 filtra el esperado? ¿Puede un pago tomar la caja
de otro usuario?

### Task 3: Backend — el gesto de confirmar, el recorte y las lecturas

> **Hecha (2026-09-29), `d47b75fd`.** Gate: backend unit 3056, e2e completo 1260/0 (6 skipped);
> frontend 1567/0. Revisión LIMPIO (dominio bloqueó una vez: confirmar sin pago no devolvía la
> deuda a quien tiene `Pagar`). Lo que cambió en el camino: las cuatro escrituras que devuelven el
> detalle y confirmar también resuelven `Pagar` y devuelven los datos de pago; el filtro
> `estadoPago` del listado pagina en memoria porque el total `suma_lineas` se cuantiza con el modo
> del tenant (decisión técnica de esta sesión, no consultada al owner; escrita en `compras.md`);
> suma el e2e de anular un pago con la caja ya cerrada, que la tarea 2 prometía y no tenía.

**Intención:** la compra al contado en un solo gesto; que corregir o anular una compra deje
la deuda bien sin intervención; y todo lo que el dueño necesita leer.

- [x] Confirmar con `pago` (spec § 7): `Pagar` resuelto en el controller, `Idempotency-Key`,
  una sola transacción; si el pago falla no se confirma nada.
- [x] El recorte (spec § 6) en: corregir línea, descuento, `PATCH /documento` y anular la
  compra. `recortar(...)` puro en `deuda.ts`, con unitarios (de la más nueva; baja a 0; el
  total sube y no toca nada).
- [x] Lecturas de spec § 8, todas con `Pagar`: `por-pagar` y `por-pagar/:proveedorId` (`pagos`
  ya llegó en la tarea 2). Y los campos de pago de `GET /compras` y `GET /compras/:id` **solo** para quien
  tiene `Pagar` (el controller resuelve el permiso; sin él no vienen en la respuesta y el
  filtro `estadoPago` es 403; decisión 12). Estado derivado con "hoy" del tenant
  (`rango-fecha.util.ts`). Una consulta por lectura, con el N+1 medido.
- [x] E2E (spec § 12): Andina con el total transcrito corregido a menos (a favor, usado en la
  próxima) y una línea de factura corregida que no cambia la deuda; queso sin
  precio pagado de más; factura sin total pagable; anular la compra (a favor); confirmar con un
  pago que falla (nada confirmado); confirmar con `pago` sin `Pagar` (403); el orden y los
  totales de `por-pagar` con la escena del lunes (Don Pedro, Andina, gas); **con el rol real
  del bodeguero** (`Leer` sin `Pagar`): 403 en `por-pagar`, `por-pagar/:id`, `pagos` y el
  filtro `estadoPago`, y el listado y el detalle **sin** los campos de pago en el body.
- [x] Docs: `compras.md` (el gesto, el recorte, las lecturas y la tabla de endpoints).

**Duda concreta para el revisor:** ¿hay algún camino que cambie el total de una compra
confirmada y no recorte las aplicaciones? (Listar todos los que escriben `precio_unitario`,
`cantidad`, `descuento_total` o `total_documento`.) ¿La lectura de `por-pagar` puede contar
una aplicación de un pago anulado o de una compra anulada? ¿Hay alguna respuesta (listado,
detalle, un error) por la que un usuario sin `Pagar` todavía reciba un dato de pago?

### Task 4: Frontend — el total, el vencimiento y "¿la pagaste ya?"

> **Hecha (2026-09-29), `52eb8c47`.** Gate: frontend `npm test` 1607/0, build, ratchet y design
> OK; Playwright: los 10 specs de compras existentes pasan con la pregunta nueva, y la suite entera
> en frío 60/0. Revisión LIMPIO. En el camino: vaciar el plazo del proveedor manda `null` (omitir
> la clave conservaba el valor viejo con 200); el aviso de efectivo sin caja es texto fijo, porque
> `GET /caja/activa` exige `MiCaja` y quien paga puede no tenerla; renombrada `facturaDeCompra`
> en el e2e de deuda.

**Intención:** que cargar y confirmar una compra lleve el total y el vencimiento, que el XML
los traiga, y que quien tiene `Pagar` registre la compra al contado en un gesto.

- [x] `useDte.ts`: leer `MntTotal`, `FchVenc` y `FmaPago`, con fixtures reales; pre-llenar
  total y vencimiento. `FmaPago = 1` (contado) propone "Sí, la pagué" en el confirmar.
- [x] `pages/terceros.vue`: "Plazo de pago (días)".
- [x] `pages/compras/[id].vue`: "Total del documento" según el tipo y "Vence el" sugerido;
  mandar solo lo que el DTO declara. **Hecho en la tarea 1** (ruling del controlador).
- [x] Modal de confirmar: "¿La pagaste ya?" solo con `Pagar`, medio y monto, clave con
  `useIntentoCobro`; el aviso de efectivo sin caja abierta.
- [x] `CompraConfirmada.vue`: total, vencimiento y "Corregir total o vencimiento"
  (`Actualizar`); con `Pagar`, además pagado, deuda y sus pagos (spec § 10).
- [x] Vitest de cada pieza (el mock de `useApiFetch` guarda la clave; el body pasa el DTO).
- [x] Docs: `compras.md` (las pantallas).

**Duda concreta para el revisor:** ¿algún control de escritura queda anidado bajo el `v-if`
de otro permiso? ¿Algún body manda un campo que el DTO no declara?

### Task 5: Frontend — "Por pagar", pagar, anular, Playwright y el cierre del frente

> **Hecha (2026-09-29).** Gate: frontend `build`/`typecheck:ratchet`/`design:check` OK; los
> archivos nuevos y tocados (`useCompras.spec.ts`, `CompraConfirmada.nuxt.spec.ts`,
> `PagarProveedorModal.nuxt.spec.ts`, `AnularPagoModal.nuxt.spec.ts`,
> `compras/index.nuxt.spec.ts`, `compras/por-pagar.nuxt.spec.ts`) corridos individualmente:
> 67/67. Revisión de dominio: LIMPIO. **Fix round 1 (2026-09-29):** Playwright, corrido por el
> controlador, tenía 3/6 fallos — los tres de test, no de producto (dos formularios que nunca
> elegían tipo de documento y se colgaban con los botones deshabilitados; un `toHaveCount(0)`
> contra la fila del estado vacío de `CrudTable`). Corregidos en 3 corridas de Playwright
> (autorizadas para esa ronda): **7/7 verde**. Detalle completo en el reporte de la tarea, sección
> "Fix round 1".

**Intención:** la pantalla del dueño (decisión 9), el pago repartido con la propuesta desde
la más vieja (decisión 2), y el frente cerrado con sus docs.

- [x] `pages/compras/por-pagar.vue` detrás de `Pagar` con middleware de ruta (pattern
  frontend § 1.2), y su entrada en la navegación solo con `Pagar`.
- [x] `PagarProveedorModal.vue`: la propuesta (saldo a favor primero, después la compra más
  vieja), editable, lo que queda a favor dicho en pantalla; `useIntentoCobro`.
- [x] Anular un pago con motivo, con el aviso de caja cerrada.
- [x] Insignia de pago y filtro en `pages/compras/index.vue`, solo con `Pagar`.
- [x] Utilidades de presentación en `useCompras.ts` (la propuesta de reparto va ahí, con
  Vitest).
- [x] Playwright con el rol real que paga y con el bodeguero sin `Pagar` (spec § 12).
- [x] Docs de cierre: `compras.md` completo, `docs/ESTADO.md`, `docs/PRODUCTO.md` (las reglas
  de negocio de la deuda), `docs/agent/pendientes.md` (entradas de spec § 13: lo fiscal y la
  factura que agrupa guías, y la pieza 3 marcada en la lista de piezas), y el `Status` de esta
  spec y este plan.
- [x] **Revisión de la rama entera** (no solo del último diff), con la duda de abajo. Hecha el
  2026-09-29 sobre las tareas 1–5 juntas: LIMPIO, con un hallazgo. La decisión 8 ("al menos
  $X") nunca se había construido y no estaba anotada; se construyó en `56f23982`. Con ella entró
  la decisión 8b del owner: sin ninguna línea con precio no hay mínimo.

**Duda concreta para la revisión de la rama:** ¿alguna tarea asumió algo que otra cambió
después (por ejemplo, una lectura de la tarea 3 que no ve el recorte, o una pantalla de la 4
que no muestra el estado que agregó la 5)?

## Verification

- El gate completo en cada tarea, con conteos, y el e2e entre `reset-db.sh` y
  `reset-db.sh --verificar`.
- Playwright con los dos roles reales.
- Revisión independiente por tarea y de la rama entera.

## Decisions / Open questions

- Todas las decisiones de producto están en la spec § 2, con quién, cuándo y cómo.
- Al aprobar, el owner confirmó la guía de despacho con total `opcional` (decisión 11) y pasó
  lo que se debe a `Pagar` (decisión 12). No queda ninguna pregunta abierta.
- Decisiones técnicas para la revisión: spec § 14.
