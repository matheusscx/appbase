# Plan: la cuenta del repartidor

**Status**: Draft · **Date**: 2026-10-16 · **Owner**: Cesar Matheus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que Paquetería pague a cada repartidor por tarifas, registre cómo se cobró cada envío y
las entregas de plata, y rinda por el período que la oficina elija, con la planilla del cliente.

**Architecture:** tres tablas nuevas (`tarifas_pago`, `entregas_repartidor`, `rendiciones`) y
columnas nuevas en la línea de la hoja, que guarda el pago y el medio al entregar. La plata sigue
saliendo de una sola consulta (`HojasRutaService.totales`), que pasa a leer el pago de la línea.
La rendición por repartidor reemplaza al `POST /hojas-ruta/:id/rendir` y congela cada hoja con el
`congelar` de hoy.

**Tech Stack:** NestJS + TypeORM (migraciones, ADR-030) + `Db` facade; Nuxt 4 + @nuxt/ui v4.

**Spec:** [`docs/superpowers/specs/2026-10-16-cuenta-del-repartidor-design.md`](../specs/2026-10-16-cuenta-del-repartidor-design.md)
— leerlo entero antes de cada tarea; el plan argumenta desde ahí.

## Contexto que el implementador no tiene

- Leer antes: `docs/features/paqueteria.md` (reglas 1–11, *Los totales salen de UNA consulta*,
  *Orden de bloqueo*, *API*), `docs/patterns/backend.md` (§ 3.1 plata, § 22 migraciones) y
  `docs/patterns/frontend.md`, `docs/agent/anti-patterns.md`.
- Trabajar en el worktree `.claude/worktrees/paqueteria-repartidor-app`. Entorno: `./scripts/entorno.sh db`
  para `test:e2e`; `entorno.sh borrar` + `entorno.sh stack` para Playwright.
- `backend/test/paqueteria.e2e-spec.ts` es la red del módulo (2138 líneas): cada tarea de backend
  la actualiza y la corre entera.
- Sin datos productivos: las migraciones no hacen backfill. Una columna que pasa a `NOT NULL` sin
  default se agrega directamente así.

## Global Constraints

- `tenant_id` sale del token; todo id que entra se valida como UUID.
- Plata y porcentajes con Decimal.js; `numeric(18,4)`; montos que entran validados con los
  decoradores de plata existentes (`@IsMontoPersistible`, `@IsDecimalNoNegativo` y
  `EscalaMonedaPipe`, como `put-paquete-configuracion.dto.ts`).
- Soft delete en todo; toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`.
- Sin N+1: lo derivado por fila en una consulta (`JOIN`/agregación o `= ANY($1)`).
- Todo el módulo sigue `JwtAuthGuard + TenantGuard + TenantAdminGuard`.
- Orden de bloqueo: repartidor `FOR SHARE` → hoja(s) `FOR UPDATE` (varias: por `hoja_ruta_id`
  ascendente) → paquetes `FOR UPDATE` (por `paquete_id` ascendente).
- La plata de una hoja sale **solo** de `HojasRutaService.totales`; nada la recalcula en TS.
- Cada cambio de entity con su migración generada y leída (`npm run migration:generate`), en el
  mismo commit; `migration:generate` no ve los `CHECK`: se escriben a mano.
- Respuestas = proyecciones de `paqueteria.types.ts` (espejo en `frontend/app/types/paqueteria.ts`).
- Frontend: antes de escribir, invocar las skills `nuxt-ui` y `frontend-design`; tokens semánticos;
  utilidades de presentación en `composables/usePaqueteria.ts`; dinero con `MoneyInput oficial` y
  `useCurrency().formatOficial`.
- Textos de pantalla en español de Chile, como el resto de Paquetería.
- Commits: por ruta (`git commit -- <paths>`), con el recibo de `verify-feature` cuando el diff
  toca services o `.vue` (lo hace el controlador). Nunca `--no-verify`. No pushear.

## Review Focus

1. Cambiar el monto de una tarifa con entregas ya marcadas: esas entregas conservan su pago.
2. Un paquete `no_entregado` el lunes con Ana (Moto) y entregado el martes por Pedro (Auto): el
   martes se paga Auto, el lunes no suma nada.
3. Una entrega de plata editada o anulada mientras otra pestaña rinde: queda dentro de la
   rendición con su monto final, o afuera para la siguiente; nunca contada dos veces ni perdida.
4. Rendir con una hoja de otro repartidor, una ya rendida o una con paquetes en ruta en
   `hojaIds`: 400 y nada se rinde (todo o nada).
5. `medio_cobro` enviado para un paquete sin cobro en destino, o al marcar `no_entregado`: 400.

Cada línea tiene su test en la tarea dueña (marcado **RF1**…**RF5**).

---

### Task 1: Tarifas de pago (tabla, CRUD y referencias)

**Files:**
- Create: `backend/src/modules/paqueteria/entities/tarifa-pago.entity.ts`,
  `tarifas-pago.service.ts`, `tarifas-pago.controller.ts`, `tarifas-pago.service.spec.ts`,
  `dto/create-tarifa-pago.dto.ts`, `dto/update-tarifa-pago.dto.ts`
- Create: `backend/src/database/migrations/<ts>-TarifasPago.ts`
- Modify: `entities/repartidor.entity.ts`, `entities/paquete.entity.ts`, `paqueteria.module.ts`,
  `typeorm.config` / lista de `ENTIDADES` (ver memoria del repo: entidad nueva → registrar),
  `repartidores.service.ts` + DTOs de repartidor, `paqueteria.types.ts`, `startup-pos.sql`
- Test: `backend/test/paqueteria.e2e-spec.ts` (bloque nuevo *tarifas*)

**Interfaces:**
- Produces: tabla `tarifas_pago (tarifa_pago_id, tenant_id, nombre varchar(100), monto numeric(18,4),
  es_defecto boolean, activa boolean, timestamps, eliminado_el)`; índice único parcial
  `(tenant_id) WHERE es_defecto AND eliminado_el IS NULL`; único `(tenant_id, lower(nombre))` vivo.
- Produces: `repartidores.tarifa_pago_id uuid NULL` y `paquetes.tarifa_pago_id uuid NULL` (FK).
- Produces: `TarifasPagoService.listar(tenantId): Promise<TarifaPagoFila[]>`, `crear`, `actualizar`,
  `eliminar`, y `exigirActivaDelTenant(tenantId, id): Promise<void>` (400 si no existe, es de otro
  tenant o está inactiva) — la usan repartidores, paquetes y escanear.
- Produces: tipo `TarifaPagoFila { id, nombre, monto: string, esDefecto, activa }`;
  `RepartidorFila.tarifaPagoId: string | null`.
- API: `GET|POST /tarifas-pago`, `PATCH|DELETE /tarifas-pago/:id`. `PATCH { esDefecto: true }`
  pasa el defecto a esa tarifa en una transacción.

- [ ] **Step 1: e2e que falla** — en `paqueteria.e2e-spec.ts`, `describe('tarifas de pago')`:
  - la primera tarifa creada queda `esDefecto: true` aunque no se pida;
  - `PATCH { esDefecto: true }` sobre otra deja exactamente una por defecto;
  - desactivar o borrar la por defecto → 400 *"Elegí otra tarifa por defecto antes de …"*;
  - borrar una usada por un repartidor o un paquete → 400 (se desactiva);
  - un monto con más decimales que la moneda oficial (CLP: `1900.5`) → 400;
  - nombre repetido (sin distinguir mayúsculas) → 409;
  - `PATCH /repartidores/:id { tarifaPagoId }` con una tarifa de otro tenant o inactiva → 400;
    con `null` la saca;
  - un no admin → 403.
- [ ] **Step 2:** correr `npx jest --config ./test/jest-e2e.json paqueteria` → falla (404 en las rutas).
- [ ] **Step 3:** entity + migración generada (leerla; agregar a mano lo que no genera) + service +
  controller + DTOs; `repartidores` acepta y devuelve `tarifaPagoId`. Unitarios del service para
  la regla del defecto (primera = defecto; traspaso).
- [ ] **Step 4:** e2e de paquetería entero en verde; `npm run lint:check && npm run typecheck && npm test`.
- [ ] **Step 5:** `docs/features/paqueteria.md` (regla nueva de tarifas, API) y commit.

### Task 2: El pago se resuelve y se fija en la línea; el medio de cobro

**Files:**
- Create: `backend/src/modules/paqueteria/tarifa-resuelta.ts` (el fragmento SQL único)
- Create: `backend/src/database/migrations/<ts>-PagoEnLaLinea.ts`
- Modify: `entities/hoja-ruta-paquete.entity.ts`, `entities/paquete.entity.ts`,
  `entities/paquete-configuracion.entity.ts`, `entities/hoja-ruta.entity.ts`,
  `hojas-ruta.service.ts` (`marcar`, `entregarTodos`, `totales`, `detalle`, `resumen`, escanear),
  `paquetes.service.ts`, `paquete-configuracion.service.ts`, DTOs (`marcar-linea`, `escanear`,
  `create-paquete`, `update-paquete`, `put-paquete-configuracion`), `paqueteria.types.ts`,
  `seeder.service.ts` (`seedPaqueteria`: tarifas, repartidores con tarifa), `startup-pos.sql`
- Test: `paqueteria.e2e-spec.ts`, `hojas-ruta.service.spec.ts`, `paquetes.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`tarifas_pago`, `TarifasPagoService.exigirActivaDelTenant`).
- Produces: en `hoja_ruta_paquetes`: `tarifa_pago_id uuid NULL`, `pago_repartidor numeric(18,4) NULL`,
  `medio_cobro varchar(20) NULL` con `CHECK (medio_cobro IN ('efectivo','transferencia'))` y
  `CHECK ((estado = 'entregado') = (pago_repartidor IS NOT NULL))`.
- Produces: en `hojas_ruta` (congelado): `monto_cobrado_efectivo`, `monto_cobrado_transferencia`
  `numeric(18,4) NULL`.
- Removes: `paquetes.pago_repartidor`, `paquete_configuracion.pago_repartidor_defecto`.
- Produces: `paquetes.tarifa_pago_id` se fija por `tarifaPagoId` (nullable) en create/update/escanear
  (reemplaza `pagoRepartidor`).
- Produces: `tarifaResueltaSql(alias: { paquete: string; repartidor: string }): string` — expresión
  SQL que devuelve el `tarifa_pago_id` que corresponde: la del paquete, si no la del repartidor,
  si no la por defecto viva del tenant. **Única** fuente de esa regla: la usan el `UPDATE` al
  entregar y la lectura de la línea en ruta (pago estimado).
- Produces: `MarcarLineaDto { estado; medioCobro?: 'efectivo' | 'transferencia' }`.
- Produces: `TotalesHoja` suma `montoCobradoEfectivo`, `montoCobradoTransferencia` (sus sumas =
  `montoCobradoDestino`); `LineaHoja` suma `tarifaPagoId`, `tarifaPagoNombre`, `medioCobro`,
  `pagoEstimado: boolean` (true mientras no está entregada); `PaqueteFila` cambia `pagoRepartidor`
  por `tarifaPagoId` + `tarifaPagoNombre`; `ResumenPaqueteria` suma `montoCobradoTransferencia`;
  `PaqueteConfiguracionRespuesta` pierde `pagoRepartidorDefecto` y `configurada` pasa a exigir
  también una tarifa por defecto.

- [ ] **Step 1: e2e que fallan**:
  - entregar fija `tarifaPagoNombre` y `pagoRepartidor` según el orden paquete → repartidor →
    defecto (tres casos);
  - **RF1**: después de entregar, `PATCH /tarifas-pago/:id { monto }` no cambia el
    `pagoRepartidor` de la línea ni los totales de la hoja; una línea todavía en ruta sí muestra
    el monto nuevo (`pagoEstimado: true`);
  - cambiar la tarifa del paquete con la línea entregada y la hoja abierta la vuelve a resolver;
  - **RF2**: no entregado con Ana (Moto) y entregado al otro día por Pedro (Auto) → la hoja de
    Pedro suma Auto, la de Ana suma 0;
  - `medioCobro: 'transferencia'` en un cobro en destino: `montoCobradoTransferencia` lo suma y
    `netoARendir` es el mismo que con efectivo (ejemplo del spec: 7 × efectivo + 3 ×
    transferencia de 10.000, pago 5.000 → neto 50.000);
  - sin `medioCobro` en un cobro en destino → queda `efectivo`;
  - **RF5**: `medioCobro` en un paquete sin cobro en destino, o con `no_entregado`/`en_ruta` → 400;
  - volver a `en_ruta` limpia tarifa, pago y medio;
  - `entregar-todos` resuelve todas las líneas en una consulta y deja los cobros en `efectivo`;
  - escanear o crear sin ninguna tarifa → 400 (además del 400 de hoy sin configuración).
- [ ] **Step 2:** correrlos → fallan.
- [ ] **Step 3:** migración + cambios. `marcar` y `entregarTodos` resuelven con un `UPDATE … FROM`
  que usa `tarifaResueltaSql` (sin leer tarifas en TS). `totales` suma `l.pago_repartidor` y separa
  por `l.medio_cobro`; `congelar` escribe las dos columnas nuevas. El seed arma Bicicleta 1.800,
  Moto 1.900, **Auto 1.900 por defecto**, Colina 4.000 y les pone tarifa a sus repartidores
  (montos de la planilla del cliente).
- [ ] **Step 4:** e2e de paquetería entero + unitarios + lint + typecheck en verde. Arranque limpio
  con `reset-db.sh` (el seed corre).
- [ ] **Step 5:** docs (reglas 1, 4, 7, 10 y la API en `paqueteria.md`) y commit.

### Task 3: Entregas de plata y rendición por repartidor

**Files:**
- Create: `entities/entrega-repartidor.entity.ts`, `entities/rendicion.entity.ts`,
  `entregas-repartidor.service.ts` + `.controller.ts` + spec, `rendiciones.service.ts` +
  `.controller.ts` + spec, `dto/create-entrega-repartidor.dto.ts`,
  `dto/update-entrega-repartidor.dto.ts`, `dto/rendir.dto.ts`, `dto/query-rendiciones.dto.ts`
- Create: `backend/src/database/migrations/<ts>-Rendiciones.ts`
- Modify: `hojas-ruta.service.ts` (`congelar` recibe `rendicionId`; se borra `rendir` y
  `congelarTotales`), `hojas-ruta.controller.ts` (sale `POST :id/rendir`), `entities/hoja-ruta.entity.ts`
  (`rendicion_id`), `paqueteria.module.ts`, ENTIDADES, `seeder.service.ts`, `paqueteria.types.ts`,
  `startup-pos.sql`
- Test: `paqueteria.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 (`TotalesHoja` con medios; `congelar`).
- Produces: `entregas_repartidor (entrega_repartidor_id, tenant_id, repartidor_id, fecha date, monto
  numeric(18,4) CHECK > 0, medio varchar(20) CHECK efectivo|transferencia, nota varchar(500) NULL,
  registrada_por uuid, rendicion_id uuid NULL, timestamps, eliminado_el)`.
- Produces: `rendiciones (rendicion_id, tenant_id, repartidor_id, rendida_por uuid NULL, rendida_el,
  total_entregados int, monto_cobrado_destino, monto_cobrado_efectivo, monto_cobrado_transferencia,
  monto_pago_repartidor, monto_entregado_a_cuenta, saldo — numeric(18,4))`; `hojas_ruta.rendicion_id`.
- Produces: `RendicionesService.rendir(tenantId, dto: { repartidorId; hojaIds: string[] }, usuarioId:
  string | null): Promise<RendicionDetalle>` (el seed lo llama con `null`) y
  `previa(tenantId, repartidorId, hojaIds): Promise<RendicionDetalle>` (misma forma, sin escribir).
- Produces: `RendicionDetalle { id: string | null; repartidorId; repartidorNombre; rendidaEl: string | null;
  dias: DiaRendicion[]; tarifas: { id; nombre; monto }[]; entregas: EntregaRepartidorFila[];
  totales: TotalesRendicion }`, con `DiaRendicion { hojaId; fecha; porTarifa: Record<tarifaId, number>;
  entregados; montoPagoRepartidor; montoCobradoEfectivo; montoCobradoTransferencia; neto }` y
  `TotalesRendicion { entregados; montoCobradoDestino; montoCobradoEfectivo; montoCobradoTransferencia;
  montoPagoRepartidor; montoEntregadoACuenta; saldo }` (saldo = cobrado − pago − entregado a cuenta).
  Los montos por día salen de `totales`; `porTarifa` es un conteo aparte (`GROUP BY hoja, tarifa`), sin plata.
- API: `GET|POST /entregas-repartidor` (`?repartidorId&pendientes=true`), `PATCH|DELETE
  /entregas-repartidor/:id`; `GET /rendiciones?desde&hasta&repartidorId`, `GET /rendiciones/previa
  ?repartidorId&hojaIds=…`, `POST /rendiciones`, `GET /rendiciones/:id`; `GET /hojas-ruta?pendientes=true
  &repartidorId` para las hojas sin rendir.
- Concurrencia: `rendir` toma repartidor `FOR SHARE` → hojas `FOR UPDATE` por id ascendente; las
  entregas se toman con `UPDATE entregas_repartidor SET rendicion_id = $r WHERE … AND rendicion_id
  IS NULL AND eliminado_el IS NULL RETURNING monto` y se suman de lo devuelto. Editar o anular una
  entrega es un `UPDATE … WHERE rendicion_id IS NULL` (0 filas → 400 *"ya está rendida"*).

- [ ] **Step 1: e2e que fallan**:
  - el ejemplo del spec: cobrado 100.000 (70.000 efectivo, 30.000 transferencia), pago 50.000,
    entrega de 40.000 el martes → `saldo` 10.000; con pago mayor, saldo negativo;
  - la planilla: semana de 6 hojas, `dias` ordenados por fecha, `porTarifa` cuenta por tarifa y
    `Σ dias.montoPagoRepartidor = totales.montoPagoRepartidor`;
  - `previa` y `rendir` con las mismas hojas dan los mismos `totales`;
  - después de rendir: las hojas quedan `rendida` con `rendicionId`, las entregas también, y
    `GET /rendiciones/:id` devuelve lo mismo después de cambiar el monto de una tarifa;
  - **RF4**: `hojaIds` con una hoja de otro repartidor, una rendida o una con `enRuta > 0`, o vacío
    → 400 y ninguna hoja ni entrega cambia;
  - **RF3**: una entrega anulada después de rendir → 400; una entrega creada después de rendir
    queda pendiente para la próxima; dos `POST /rendiciones` simultáneos con las mismas hojas →
    uno rinde y el otro 400, y las entregas suman una sola vez (correrlos con `Promise.all`);
  - `POST /hojas-ruta/:id/rendir` ya no existe (404).
- [ ] **Step 2:** correrlos → fallan.
- [ ] **Step 3:** entities, migración, services y controllers. El seed reemplaza los
  `congelarTotales` por una rendición semanal de un repartidor (6 hojas, con cobros en efectivo y
  transferencia y una entrega de plata) y una diaria de otro.
- [ ] **Step 4:** e2e entero + unitarios + lint + typecheck; `reset-db.sh` arranca.
- [ ] **Step 5:** docs (`paqueteria.md`: regla 6 reescrita, *Orden de bloqueo* con la rendición,
  API) y commit.

### Task 4: Pantallas de tarifas y selectores de tarifa

**Files:**
- Modify: `frontend/app/pages/configuracion/paqueteria.vue` (sección *Tarifas de pago*; sale el
  pago por defecto), `configuracion/repartidores.vue` (selector de tarifa por repartidor),
  `pages/paquetes/index.vue` (ficha: selector en vez del monto de pago), `pages/paquetes/escanear.vue`
  (modal *Montos de X*: el pago pasa a selector; la fila muestra la tarifa),
  `pages/paquetes/rutas/[id].vue` (columna tarifa/pago), `types/paqueteria.ts`,
  `composables/usePaqueteria.ts`
- Test: los `.nuxt.spec.ts` de cada página tocada, `usePaqueteria.spec.ts`

**Interfaces:**
- Consumes: API de Task 1 y tipos de Task 2.
- Produces: `usePaqueteria().opcionesTarifa(tarifas: TarifaPagoFila[], heredada: TarifaPagoFila | null)`
  → items de `USelect` con una primera opción *"Según repartidor (Auto $1.900)"* (`value: null`) y
  después las tarifas activas con su monto.

- [ ] **Step 1:** invocar `nuxt-ui` y `frontend-design`.
- [ ] **Step 2: specs que fallan:** crear, editar, marcar por defecto, desactivar y el 400 de la
  por defecto visible en la pantalla de tarifas; el selector de Escanear manda
  `{ precioEnvio, tarifaPagoId }` en el `PATCH`; elegir *"Según repartidor"* manda `null`;
  la fila de una línea en ruta muestra el pago como estimado.
- [ ] **Step 3:** implementar. Ningún `MoneyInput` de pago al repartidor queda en la app.
- [ ] **Step 4:** `npm run build && npm test && npm run typecheck:ratchet && npm run design:check`.
- [ ] **Step 5:** commit.

### Task 5: Medio de cobro en la hoja, entregas de plata y rendir

**Files:**
- Create: `frontend/app/pages/paquetes/rendiciones/index.vue` (lista), `rendiciones/nueva.vue`
  (repartidor → hojas sin rendir con checkbox, entregas de plata pendientes con alta/edición/anular,
  totales de `previa`, botón *Rendir*), `rendiciones/[id].vue` (la planilla, imprimible) y sus
  `.nuxt.spec.ts`
- Modify: `pages/paquetes/rutas/[id].vue` (al marcar entregado un cobro en destino: efectivo o
  transferencia; el botón *Rendir* pasa a *Rendir a <repartidor>* → `rendiciones/nueva?repartidorId=`),
  `composables/useMenuLateral.ts` (ítem *Rendiciones*), `composables/usePaqueteria.ts`,
  `types/paqueteria.ts`, `composables/useReportes.ts` si lista KPIs de Paquetería
- Test: specs de cada página, `useMenuLateral` spec si existe

**Interfaces:**
- Consumes: API de Task 3.
- Produces: `usePaqueteria().textoSaldo(saldo: string): string` — *"Debe rendir $10.000"* /
  *"La empresa le paga $424.322"* / *"Sin saldo"* (extiende `textoNeto` de hoy, no lo duplica).

- [ ] **Step 1:** invocar `nuxt-ui` y `frontend-design`. La planilla toma la forma de la del cliente
  (spec § *Lo que muestra la rendición*): filas por día, una columna por tarifa con cantidades,
  pago, cobrado (efectivo / transferencia), neto; abajo totales, entregas y saldo. `@media print`
  sin el chrome de la app.
- [ ] **Step 2: specs que fallan:** marcar con transferencia manda `medioCobro: 'transferencia'`;
  `nueva.vue` preselecciona las hojas sin paquetes en ruta, deshabilita las que tienen, y vuelve
  a pedir `previa` al cambiar la selección (la respuesta vieja no pisa a la nueva); un 400 de
  `POST /rendiciones` queda en la pantalla; la planilla del seed muestra las columnas de sus
  tarifas y el saldo con `textoSaldo`.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** gate de frontend como en Task 4.
- [ ] **Step 5:** commit.

### Task 6: Playwright, documentación y cierre

**Files:**
- Modify: `frontend/e2e/paqueteria/paqueteria.spec.ts` (el flujo de rendir y el de montos de
  Escanear cambian), `docs/features/paqueteria.md` (decisiones nuevas en la tabla, *Status*),
  `docs/ESTADO.md`, `docs/agent/desarrollo-nuevo.md` (fase 2: tarifas/rendición cerrados; queda
  el frente del teléfono con su spec), `docs/reference/modulos-y-configuraciones.md`
- Delete: `docs/superpowers/specs/2026-10-16-cuenta-del-repartidor-design.md` y este plan
  (regla de `docs/superpowers/README.md`), una vez volcado lo durable a `features/paqueteria.md`

- [ ] **Step 1:** Playwright: escanear con una tarifa por defecto; cambiar la tarifa de un paquete
  desde Escanear; marcar entregados (uno por transferencia); anotar una entrega de plata; rendir
  la semana y leer el saldo en la planilla; verificar en la API que lo congelado es ese saldo.
- [ ] **Step 2:** `entorno.sh borrar && entorno.sh stack && reset-db.sh`, `npx playwright test
  e2e/paqueteria/`; leer RestartCount/OOMKilled; `entorno.sh borrar --purgar`.
- [ ] **Step 3:** gate entero de `CLAUDE.md` (back y front) y `verify-feature`.
- [ ] **Step 4:** commit; pasar a la orquestadora el SHA, la base y lo corrido.
