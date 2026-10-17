# Plan: tarifas de envío

**Status**: Approved · **Date**: 2026-10-17 · **Owner**: Cesar Matheus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el precio que se cobra por cada envío salga de una tabla de tarifas (Estándar,
Prioritario, Premium…) con una por defecto y un selector por paquete, y quede fijo en la entrega,
igual que ya funcionan las tarifas de pago al repartidor.

**Architecture:** una tabla `tarifas_envio` gemela de `tarifas_pago`; `paquetes.tarifa_envio_id`
como override; la línea de la hoja guarda `tarifa_envio_id` y `precio_envio` al entregar (el
mismo `UPDATE … FROM` que ya fija el pago). La plata sigue saliendo de `HojasRutaService.totales`,
que pasa a leer el precio de la línea.

**Tech Stack:** NestJS + TypeORM (migraciones, ADR-030) + `Db`; Nuxt 4 + @nuxt/ui v4.

## Spec (diseño aprobado por el owner en el chat, 2026-10-17)

1. **Tabla de tarifas de envío** que arma el cliente (ej. Estándar $3.000, Prioritario $5.000,
   Premium $8.000), con una por defecto. La por defecto no se desactiva ni se borra; una en uso no
   se borra, se desactiva (mismas reglas que las tarifas de pago).
2. **Selector de tarifa de envío** en cada paquete (Escanear, ficha del paquete y fila de la hoja);
   primera opción *"Por defecto (Estándar $3.000)"*. **Sale** el campo de precio tipeado a mano y
   el "precio de envío por defecto" de Configuración.
3. **Orden** (owner): la tarifa del paquete; si no tiene, la por defecto. **Sin** tarifas por
   remitente por ahora (owner).
4. **El precio queda fijo al entregar**, como el pago al repartidor. Mientras no está entregado se
   ve el precio estimado con la tarifa de hoy.
5. **Las cuentas no cambian:** el cobro en destino es ese precio fijo (efectivo o transferencia);
   la rendición, la planilla y los KPIs suman los precios fijos de las entregas.
6. **(mi decisión)** Las dos tablas, envío y pago, en la misma pantalla de Configuración →
   Paquetería, una debajo de la otra.

## Contexto que el implementador no tiene

- Leer antes: `docs/features/paqueteria.md` entero (regla 10 de tarifas de pago, *Los totales
  salen de UNA consulta*, *Orden de bloqueo*, API), `docs/patterns/backend.md` § 3.1 y § 22,
  `docs/patterns/frontend.md`, `docs/agent/anti-patterns.md`.
- **El molde es la tarifa de pago**, ya en `main`: `tarifas-pago.service.ts`, `tarifas-pago.controller.ts`,
  sus DTOs, `entities/tarifa-pago.entity.ts`, la migración `*-TarifasPago.ts`, `tarifa-resuelta.ts`
  (`tarifaResueltaSql`, `PAGO_RESUELTO_SQL`) y la migración `*-PagoEnLaLinea.ts` (backfill). Copiar
  la forma y las reglas, no reinventarlas.
- Trabajar en `.claude/worktrees/paqueteria-tarifas-envio`. `./scripts/entorno.sh db` para el e2e de API
  (`cd backend && npx jest --config ./test/jest-e2e.json test/paqueteria.e2e-spec.ts test/esquema.e2e-spec.ts`,
  con rutas explícitas: el patrón `paqueteria` matchea el nombre del worktree). `borrar` + `stack` para Playwright.
- El demo de Railway ya está sembrado con el código actual y **tiene líneas entregadas**: la
  migración que agrega `precio_envio` NOT-NULL-al-entregar en la línea **rellena** desde
  `paquetes.precio_envio` antes del CHECK (igual que hizo `PagoEnLaLinea`).

## Global Constraints

- `tenant_id` sale del token; todo id que entra se valida como UUID (con `@IdEnMinusculas` donde lo usan los DTOs gemelos).
- Plata con Decimal.js, `numeric(18,4)`, validada con los decoradores de plata + `EscalaMonedaPipe`.
- Soft delete; toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL` (o escribe el porqué).
- Sin N+1. Todo el módulo con `JwtAuthGuard + TenantGuard + TenantAdminGuard`.
- La plata de una hoja sale **solo** de `HojasRutaService.totales`; la regla de qué tarifa aplica
  vive **solo** en `tarifa-resuelta.ts` (nada la repite en TS ni en el frontend).
- Orden de bloqueo documentado en `paqueteria.md`; la tarifa (de envío o de pago) va siempre después
  de lo que ya está tomado y quien la escribe no pide nada después.
- Cada cambio de entity con su migración generada y leída; los `CHECK` a mano; `startup-pos.sql` al día.
- Frontend: invocar las skills `nuxt-ui` y `frontend-design` antes de escribir; tokens semánticos;
  botones ≥ 44 px; montos sin monoespaciada; textos en **tuteo** (es la regla de `main`).
- El implementador no commitea: stagea por ruta. Nunca `--no-verify`. No pushear.

## Review Focus

1. Cambiar el monto de una tarifa de envío con entregas ya marcadas: el precio y el cobro en
   destino de esas entregas, y los totales de la hoja, no se mueven.
2. Una hoja rendida antes de esta migración: sus totales congelados no cambian y su planilla sigue
   igual (backfill de la línea desde el precio del paquete).
3. Editar otro campo de un paquete reenviando la misma `tarifaEnvioId` (o null → null) no vuelve a
   resolver el precio de una línea entregada.
4. Escanear o crear un paquete sin ninguna tarifa de envío cargada → 400 claro, no un paquete a $0.
5. Una línea no entregada de una hoja rendida no informa precio estimado (misma regla que el pago).

---

### Task 1: Tabla de tarifas de envío y CRUD

**Files:** Create `entities/tarifa-envio.entity.ts`, `tarifas-envio.service.ts` + spec,
`tarifas-envio.controller.ts`, `dto/create-tarifa-envio.dto.ts`, `dto/update-tarifa-envio.dto.ts`,
migración `<ts>-TarifasEnvio.ts`. Modify `entities/paquete.entity.ts` (`tarifa_envio_id uuid NULL`, FK),
`paqueteria.module.ts`, ENTIDADES, `paqueteria.types.ts`, `monto-persistible-cobertura.spec.ts`,
`startup-pos.sql`. Test: bloque *tarifas de envío* en `backend/test/paqueteria.e2e-spec.ts`.

**Interfaces — Produces:** `GET|POST /tarifas-envio`, `PATCH|DELETE /tarifas-envio/:id`;
`TarifaEnvioFila { id, nombre, monto, esDefecto, activa }`;
`TarifasEnvioService.exigirActivaDelTenant(tenantId, id, { bloquear })`. Mismas reglas que
`TarifasPagoService` (primera = defecto, traspaso con una sola por defecto, la por defecto no se
desactiva/borra, en uso → 400 al borrar, nombre único sin mayúsculas, decimales de la moneda).

- [ ] e2e que fallan, gemelos de los de tarifas de pago (los nombres de los casos iguales con "envío").
- [ ] Implementar; unitarios del service.
- [ ] Gate de backend + los dos e2e; stagear.

### Task 2: El precio sale de la tarifa y queda fijo en la entrega

**Files:** Modify `tarifa-resuelta.ts` (export nuevo `tarifaEnvioResueltaSql(aliasPaquete)` y
`PRECIO_RESUELTO_SQL`, o extender `PAGO_RESUELTO_SQL` para que el mismo `UPDATE` fije las dos —
elegir lo que deje **un** `UPDATE` al entregar), `hojas-ruta.service.ts` (`marcar`, `entregarTodos`,
`totales`, `detalle`, `resumen`, `escanear`), `paquetes.service.ts`, `paquete-configuracion.*`,
DTOs (`escanear`, `create-paquete`, `update-paquete`, `put-paquete-configuracion`),
`entities/hoja-ruta-paquete.entity.ts`, `entities/paquete.entity.ts`,
`entities/paquete-configuracion.entity.ts`, `rendiciones.service.ts` si lee el precio del paquete,
`seeder.service.ts`, `paqueteria.types.ts`, `startup-pos.sql`. Migración `<ts>-PrecioEnLaLinea.ts`.

**Interfaces — Produces:**
- Línea: `tarifa_envio_id uuid NULL`, `precio_envio numeric(18,4) NULL`,
  `CHECK ((estado = 'entregado') = (precio_envio IS NOT NULL))`.
- Sale `paquetes.precio_envio` y `paquete_configuracion.precio_envio_defecto`. Si
  `paquete_configuracion` queda sin columnas de negocio, se elimina la tabla y `GET|PUT
  /paquetes/configuracion`, y `configurada` (que hoy lee el frontend) se reemplaza por lo que
  devuelva `GET /tarifas-envio` y `GET /tarifas-pago` (hay por defecto en las dos). Decidir con el
  código delante y escribirlo en el reporte.
- `paquetes.tarifa_envio_id` se fija con `tarifaEnvioId` (nullable) en create, update y escanear
  (reemplaza `precioEnvio`), validado con `exigirActivaDelTenant(…, { bloquear: true })` **solo si
  cambia**, y el precio de una línea entregada en hoja abierta se re-resuelve **solo si cambia**.
- `PaqueteFila`: sale `precioEnvio`, entra `tarifaEnvioId` + `tarifaEnvioNombre` (+ el precio
  estimado si la ficha lo muestra). `LineaHoja`: `precioEnvio` pasa a ser el fijado (entregado) o el
  estimado, con `tarifaEnvioId`, `tarifaEnvioNombre`, `tarifaEnvioPaqueteId` y el mismo criterio de
  `pagoEstimado` (sin estimado en una hoja rendida).
- `totales`: `monto_cobrado_destino`, el desglose por medio y `monto_total_general` suman
  `l.precio_envio`.
- Escanear o crear sin tarifa de envío por defecto → 400 (*"Carga una tarifa de envío por defecto en
  Configuración → Paquetería."* o equivalente en tuteo).
- Migración: rellena `precio_envio` de toda línea entregada (borradas incluidas) desde
  `paquetes.precio_envio` **antes** del CHECK y del DROP. El seed crea Estándar (por defecto),
  Prioritario y Premium con montos del demo y deja algún paquete con Prioritario.

- [ ] e2e que fallan: los cinco del Review Focus (RF1–RF5) más: orden paquete → defecto; precio
  estimado en línea en ruta; `totales` iguales con efectivo y transferencia; KPIs y rendición con el
  precio fijo; migración probada sobre una base sembrada con el código anterior (revert + run).
- [ ] Implementar. Ninguna tarifa se lee en TS.
- [ ] Gate de backend + los dos e2e (con base recreada); stagear.

### Task 3: Pantallas

**Files:** `frontend/app/pages/configuracion/paqueteria.vue` (sección *Tarifas de envío* sobre la
de pago; sale el precio por defecto), `pages/paquetes/escanear.vue` (modal: selector de envío en vez
del `MoneyInput`), `pages/paquetes/index.vue` (ficha y columna), `pages/paquetes/rutas/[id].vue`
(fila: tarifa y precio, estimado o fijo), `types/paqueteria.ts`, `composables/usePaqueteria.ts`
(reusar `opcionesTarifa` para las dos), y sus specs.

- [ ] Invocar `nuxt-ui` y `frontend-design`.
- [ ] Specs que fallan: CRUD de tarifas de envío; el modal de Escanear manda
  `{ tarifaEnvioId, tarifaPagoId }`; *"Por defecto (Estándar $3.000)"* manda `null`; una línea en
  ruta muestra el precio como estimado; ningún `MoneyInput` de precio de envío queda en la app.
- [ ] Implementar; gate de frontend (`build`, `test`, `typecheck:ratchet`, `design:check`); stagear.

### Task 4: Playwright, docs y cierre

- [ ] Playwright de paquetería: escanear con tarifas de envío y de pago, cambiar la de envío de un
  paquete, entregar con cobro en destino y ver ese precio en la rendición.
- [ ] Docs: `docs/features/paqueteria.md` (regla nueva, API, decisiones), `docs/ESTADO.md`,
  `docs/reference/modulos-y-configuraciones.md`; borrar este plan (regla de `docs/superpowers/README.md`).
- [ ] Gate entero de `CLAUDE.md`, Playwright de lo relacionado; SHA a la orquestadora.
