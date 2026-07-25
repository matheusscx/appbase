# Motivos categorizados de diferencia + catálogo CRUD — Design Spec

**Fecha:** 2026-07-24
**Estado:** ✅ Aprobado por el owner — listo para plan de implementación
**Sub-proyecto:** C de 3 del refactor de arqueo (A multi-medio → B ciego → **C motivos**)
**Depende de:** [`2026-07-24-arqueo-multimedio-design.md`](2026-07-24-arqueo-multimedio-design.md) (A) y [`2026-07-24-cierre-ciego-design.md`](2026-07-24-cierre-ciego-design.md) (B), ambos en `main`
**Investigación:** [`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](../../agent/investigaciones/2026-07-23-gestion-caja.md) (motivos categorizados de Fudo: justificar-siempre, no umbral)
**Feature relacionada:** [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md)

---

## Contexto

Al cerrar una caja, cada línea del arqueo (por método de pago, desde A) puede tener una
**diferencia ≠ 0** (contado ≠ esperado). Hoy esa diferencia **solo se registra**; no se
justifica. C agrega un **motivo categorizado** obligatorio por cada línea que descuadra —
el estándar de los POS de la región (Fudo obliga a un motivo tipificado en cualquier
descuadre, sin umbral: la norma local es *justificar siempre*).

C tiene dos mitades: **(1)** un **catálogo CRUD** de motivos por tenant (casi un
sub-proyecto en sí, la mayor parte de la maquinaria) y **(2)** la **captura del motivo**
en el flujo de cierre que A/B establecieron. C **no** toca el cálculo del esperado ni el
congelado; agrega dos columnas a `caja_arqueo_medio` y valida en el cierre.

**Por qué C al final:** sus consumidores reales (reporte over/short agregado por cajero,
aprobación por umbral §6) están diferidos; el catálogo rinde una vez que exista quien
consuma las categorías.

## Recordatorio del dominio (para no romper invariantes)

- **`tenant_id`/`usuario_id` del token**, nunca del body.
- **Soft delete en todo**; toda lectura filtra `eliminado_el IS NULL`.
- **Dinero con Decimal.js**; la `diferencia` (de A) es Decimal — C solo la lee para decidir
  si una línea exige motivo.
- El motor de precios, `movimientos_inventario` y el sistema JWT **no se tocan**.
- **"Congelar el hecho transaccional":** el cierre congela esperado/contado/diferencia como en A.
  El motivo/comentario se escriben **después**, en el paso de justificación, sin alterar esas
  cifras congeladas.

## Alcance

**Incluido:**
- Tabla `motivo_diferencia_caja` (tenant-owned) + módulo CRUD (entidad, controller, service,
  DTOs, defaults, seed, página de Configuración).
- Dos columnas en `caja_arqueo_medio`: `motivo_diferencia_id` (FK) + `comentario_diferencia`.
- **Justificación post-cierre como paso separado, admin-only** (`PATCH /caja/:id/arqueo/motivos`),
  uniforme para modo normal y ciego. El cierre **no** captura motivo.

**Fuera de alcance (siguen diferidos):**
- **Obligar al cajero a justificar** (bloquearle abrir cajas nuevas mientras tenga descuadres
  pendientes, o similar). Se diseña el "pendiente de justificación" pero **no** se fuerza todavía.
- **Reporte over/short** agregado por cajero (§6).
- **Aprobación por umbral** del encargado (§6) — la norma es justificar-siempre, sin umbral.
- **Ocultar el resultado post-cierre** al cajero (§6).

## Decisiones de diseño (tomadas con el owner, 2026-07-24)

1. **Cerrar y justificar son dos procesos separados.** El **cierre** (`POST /cerrar`, cajero,
   owner-only) **nunca** captura ni exige motivo — congela esperado/contado/diferencia y punto.
   Toda línea con diferencia ≠ 0 queda **"pendiente de justificación"**. La **justificación** es
   un paso aparte. Esto vale **igual para modo normal y ciego** (sin asimetría; el drawer de
   cierre no muestra ni pide motivo en ningún modo). Motivo: el cierre no debe bloquearse por la
   justificación, y en ciego el cajero ni siquiera ve la diferencia al cerrar.
2. **La justificación es admin-only (`TenantAdminGuard`) — deber del administrador.** Aclarar
   cualquier descuadre es responsabilidad del admin: el `PATCH /caja/:id/arqueo/motivos` es el
   **único** camino de justificación, admin-only, uniforme para ambos modos. El cajero cierra
   pero no categoriza (separación de funciones, anti-fraude). *(Obligar al cajero a justificar
   —p. ej. bloquearle abrir cajas con pendientes— queda diferido; ver Alcance.)*
3. **CRUD admin-only espejando `causas-merma`.** El catálogo es configuración del tenant →
   `TenantAdminGuard` para escribir, **lectura abierta** al tenant (JwtAuthGuard+TenantGuard)
   para que el cajero vea el dropdown al cerrar. Coincide con el patrón del repo (catálogos =
   admin-only; features operativas = permiso de módulo). No se agrega un módulo de permiso nuevo.
4. **`requiere_comentario` es una columna configurable** por motivo (no hardcode a "Otro"). El
   admin puede marcar cualquier motivo como "exige detalle". Sembrada en `true` solo para "otro".
5. **`es_fijo` bloquea rename y delete, pero `activo` es siempre togglable** — divergencia
   deliberada de `causas-merma` (que bloquea toda edición en fijas). Se necesita para la red de
   seguridad: el admin debe poder **desactivar** un default que no usa.
6. **Red de seguridad (degradación) en la justificación:** si el tenant no tiene **ningún**
   motivo activo, el admin justifica con **comentario obligatorio** (sin motivo). El catálogo
   vacío nunca impide justificar (ni, por diseño, cerrar — el cierre no depende del catálogo).

## Modelo de datos

**Tabla nueva `motivo_diferencia_caja`** (espeja `causas_merma`):

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `motivo_diferencia_id` | UUID | PK | `type: 'uuid'` explícito (ADR-004) |
| `tenant_id` | UUID | NOT NULL | del token al sembrar/crear |
| `nombre` | TEXT | NOT NULL | único por tenant (case-insensitive) |
| `activo` | BOOLEAN | NOT NULL default `true` | togglable siempre |
| `requiere_comentario` | BOOLEAN | NOT NULL default `false` | exige comentario libre al elegirlo |
| `es_fijo` | BOOLEAN | NOT NULL default `false` | default sembrado: bloquea rename/delete |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | | soft-delete |

Índice único parcial: `uq_motivo_diferencia_tenant_nombre ON motivo_diferencia_caja (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL`.

**`caja_arqueo_medio` (de A) — 2 columnas nuevas:**

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `motivo_diferencia_id` | UUID | NULL, FK → `motivo_diferencia_caja` | lo puebla el PATCH de justificación |
| `comentario_diferencia` | TEXT | NULL | obligatorio si el motivo `requiere_comentario` o red de seguridad |

El cierre las deja `NULL`; las puebla el **paso de justificación** (`PATCH`). En líneas que
cuadran quedan `NULL` siempre.

## Backend — catálogo CRUD

Módulo `motivos-diferencia` espejando `mermas/causas-merma.*`:

- **Entidad** `MotivoDiferenciaCaja` (registrada en `app.module.ts` `entities` — no hay
  autoLoadEntities) + en el `forFeature` de su módulo.
- **`motivos-diferencia.defaults.ts`** con los 7 nombres.
- **Controller `MotivosDiferenciaController`** (`@Controller('motivos-diferencia')`,
  `@UseGuards(JwtAuthGuard, TenantGuard)`):
  - `GET /motivos-diferencia?soloActivas=true` — lectura abierta al tenant (dropdown de cierre).
  - `POST` / `PATCH /:id` / `DELETE /:id` — `@UseGuards(TenantAdminGuard)`.
- **Service** (raw parametrizado, estilo `causas-merma.service`): `findAll(tenantId, soloActivas)`,
  `create`, `update`, `remove` (soft-delete). `assertNombreUnico` (case-insensitive, filtra
  `eliminado_el IS NULL`). **`update`/`remove` sobre un motivo `es_fijo`:** bloquean `nombre` y
  el borrado (409), **pero permiten** cambiar `activo` y `requiere_comentario`.
- **DTOs** con `class-validator`: `CreateMotivoDiferenciaDto` (`nombre`, `activo?`,
  `requiere_comentario?`), `UpdateMotivoDiferenciaDto` (todos opcionales).

## Backend — el cierre NO captura motivo

El cierre (`POST /caja/:id/cerrar`, `cerrar` en `caja.service.ts`) queda **exactamente como en
A/B**: recomputa y congela esperado/contado/diferencia server-side. **No** exige ni acepta
motivo por línea; `LineaCierreDto` **no** lleva campos de motivo. Las columnas
`motivo_diferencia_id`/`comentario_diferencia` de una caja recién cerrada quedan `NULL` (líneas
descuadradas = "pendiente de justificación"). El `comentario` global de cierre (de A) se conserva.

## Backend — justificación (paso separado, admin-only)

Endpoint **`PATCH /caja/:id/arqueo/motivos`** (`@RequiresPermiso` **no**; guard
**`TenantAdminGuard`** — admin-only). Body: `{ lineas: [{ metodoPagoId: string | null,
motivoDiferenciaId?: string, comentarioDiferencia?: string }] }`. Es el **único** camino de
justificación, **uniforme para modo normal y ciego**.

- Solo sobre una caja **cerrada** del tenant (valida estado + `tenant_id` del token).
- Opera sobre las filas **congeladas** de `caja_arqueo_medio` cuya `diferencia ≠ 0`. Por cada una:
  1. Si hay motivos **activos** → `motivoDiferenciaId` obligatorio (del tenant, activo); si el
     motivo `requiere_comentario` → `comentarioDiferencia` obligatorio.
  2. Si **no** hay motivos activos (red de seguridad) → `comentarioDiferencia` obligatorio, sin motivo.
- Actualiza `motivo_diferencia_id` + `comentario_diferencia` de esas filas (soft-update, sin
  recomputar esperado/contado/diferencia — el hecho transaccional no se altera).
- Es **editable**: el admin puede corregir un motivo ya asignado (no hay lock ni deadline).
- Una línea descuadrada sin justificar queda **"pendiente de justificación"** en el detalle hasta
  que el admin la categorice. *(Forzar que se justifique —bloquear al cajero, etc.— está diferido.)*

## Frontend

- **`configuracion/motivos-diferencia.vue`** espejando `configuracion/causas-merma.vue`: tabla
  (nombre, `activo` toggle, badge de fijo) + drawer crear/editar con campo `nombre`, switch
  `activo` y switch **`requiere_comentario`**; los fijos permiten togglear `activo`/
  `requiere_comentario` pero no renombrar/eliminar. Link en el nav de Configuración.
- **`CajaCierreDrawer.vue` — sin cambios de C.** El drawer de cierre **no** pide motivo (ni en
  normal ni en ciego); queda como lo dejó B. El cierre es solo cierre.
- **Detalle de caja (conciliación) — el paso de justificar:** `CajaArqueoTable` gana una columna
  **"Motivo"** (nombre + comentario, o **"Sin justificar"** si `diferencia ≠ 0` y sin motivo).
  Para un **admin**, las líneas descuadradas (sin justificar o para corregir) ofrecen un selector
  de motivo/comentario que hace el `PATCH /caja/:id/arqueo/motivos`. Para no-admin es solo
  lectura. Es la UI de justificación, **la misma para modo normal y ciego**. Store: `cargarArqueo`
  ya trae las líneas (con motivo); se agrega `justificarDiferencias` + `motivos`/`cargarMotivos`.

## Reglas de negocio

1. **Cerrar y justificar son dos pasos.** El cierre nunca exige ni captura motivo (igual normal
   y ciego); congela esperado/contado/diferencia. Toda línea con `diferencia ≠ 0` queda
   "pendiente de justificación".
2. La **justificación** (`PATCH /caja/:id/arqueo/motivos`) la hace **solo el admin**
   (`TenantAdminGuard`): motivo si hay motivos activos, o comentario (red de seguridad) si no;
   comentario además si el motivo `requiere_comentario`. Editable.
3. El **catálogo** lo gestiona **solo el admin** (`TenantAdminGuard`); la **lectura** está
   abierta al tenant.
4. Un motivo `es_fijo` no se renombra ni se elimina, pero **sí** se puede activar/desactivar y
   cambiar su `requiere_comentario`.
5. `tenant_id`/`usuario_id` del token; soft delete; la justificación no altera
   esperado/contado/diferencia (el hecho transaccional de A/B queda intacto).
6. Cambiar/desactivar motivos afecta justificaciones **desde ese momento**; no reescribe lo ya
   congelado.
7. **Obligar** la justificación (bloquear al cajero, deadlines) está **diferido** — hoy una línea
   puede quedar "pendiente" indefinidamente; es deber del admin resolverla.

## Testing

- **Unit (`motivos-diferencia.service.spec`):** `create` (nombre único case-insensitive,
  soft-delete), `update`/`remove` bloqueados en `es_fijo` para nombre/delete pero permitidos
  para `activo`/`requiere_comentario`, `findAll` con `soloActivas`.
- **Unit (`caja.service.spec`):** `cerrar` con línea que descuadra **cierra sin exigir motivo**
  (la fila queda con motivo NULL). `justificarDiferencias` (PATCH): 400 si la caja no está
  cerrada; 400 sin motivo habiendo motivos activos; 400 sin comentario si el motivo
  `requiere_comentario`; **red de seguridad** sin motivos activos (400 sin comentario / 200 con);
  actualiza filas congeladas y **no** toca esperado/contado/diferencia.
- **Unit (`caja.controller.spec`):** el `PATCH /:id/arqueo/motivos` exige `TenantAdminGuard`
  (admin-only); el CRUD exige `TenantAdminGuard` para escribir y lectura abierta.
- **E2E (`caja.e2e-spec` + `motivos-diferencia.e2e-spec`):** CRUD admin-only (403 no-admin en
  escritura, 200 en lectura); **cerrar con diferencia (normal y ciego) → 201 sin motivo**, la
  línea queda "pendiente"; el `PATCH` de un **no-admin** → 403, de un **admin** → 200 y el `GET`
  posterior muestra `motivoNombre`. Caso `arqueo_ciego=true` restaurado en `finally`.
- **Smoke navegador:** config de motivos (crear/editar/desactivar, fijo no renombrable);
  cerrar con descuadre (sin pedir motivo) → el detalle muestra "Sin justificar"; el admin
  justifica con el selector y pasa a mostrar el motivo; un no-admin no ve el selector. Consola
  sin errores.

## Seed

Los 7 motivos por defecto se siembran **en `seeder.service.ts`** (bootstrap, con índice único
idempotente, patrón `causas-merma`) **y en `tenants.service.create`** (al crear un tenant vía
API, loop sobre los defaults) — igual que `CAUSAS_MERMA_FIJAS`:

`falta de efectivo`, `sobra de efectivo`, `divergencia de tarjeta`, `error de lanzamiento
manual`, `pago no registrado`, `error operacional`, **`otro`**.

Todos con `es_fijo = true`; **`otro`** además con `requiere_comentario = true`. Los motivos
custom del admin nacen `es_fijo = false`.

## Backward-compat (etapa de desarrollo)

- Tablas/columnas nuevas creadas por `synchronize` al bootstrap (dev/CI). Sin migraciones.
- **Cajas ya cerradas** antes de C: sus filas de `caja_arqueo_medio` tienen
  `motivo_diferencia_id = NULL`; el detalle las muestra como "Sin justificar" si descuadran, y el
  admin puede justificarlas con el `PATCH`. Sin efecto retroactivo (regla 6).
- **`cerrar` no cambia su contrato** (no gana campos) → los clientes de A/B siguen funcionando
  igual; el cierre nunca se bloquea por motivo.

## Docs a actualizar (mismo commit que el código)

- `docs/features/gestion-cajas.md` — motivos categorizados (catálogo, cierre-sin-motivo vs
  justificación admin-only como paso separado, red de seguridad, "pendiente de justificación"),
  columnas nuevas de `caja_arqueo_medio`.
- `docs/ESTADO.md` — fila de la feature (motivos de diferencia).
- `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9 / `docs/agent/pendientes.md` —
  marcar C hecho; reporte over/short y umbral (§6) siguen diferidos.
- `startup-pos.sql` — tabla `motivo_diferencia_caja` + columnas en `caja_arqueo_medio`.

## Criterios de aceptación

- [ ] Tabla `motivo_diferencia_caja` (tenant-owned, único `(tenant_id, lower(nombre))`, soft-delete).
- [ ] `caja_arqueo_medio` con `motivo_diferencia_id` (FK) + `comentario_diferencia`.
- [ ] CRUD `motivos-diferencia`: escritura `TenantAdminGuard`, lectura abierta; `es_fijo` bloquea
  rename/delete pero permite `activo`/`requiere_comentario`.
- [ ] El **cierre no exige ni captura motivo** (igual normal y ciego); `LineaCierreDto` sin
  campos de motivo; descuadre sin justificar = "pendiente".
- [ ] `PATCH /caja/:id/arqueo/motivos` admin-only justifica una caja cerrada (normal o ciego),
  editable, con red de seguridad, sin alterar esperado/contado/diferencia.
- [ ] Página `configuracion/motivos-diferencia.vue` + detalle con columna Motivo y justificación
  admin (el drawer de cierre **no** cambia).
- [ ] Seed de los 7 en `seeder.service` y `tenants.service.create`; todos `es_fijo`, "otro"
  `requiere_comentario`.
- [ ] `tenant_id`/`usuario_id` del token; soft delete; Decimal (diferencia de A intacta).
- [ ] Unit + e2e verdes; smoke de config + cierre-sin-motivo + justificación admin.
- [ ] Docs actualizadas (gestion-cajas.md, ESTADO.md, §9/pendientes.md, startup-pos.sql).

---

## Relación con el roadmap del refactor de arqueo

- **A — Arqueo multi-medio** (hecho): esperado/contado/diferencia por método, congelados en
  `caja_arqueo_medio`. C agrega el motivo a cada línea que descuadra.
- **B — Cierre ciego** (hecho): retiene el esperado durante el conteo. C mantiene el cierre como
  un paso limpio y mueve **toda** la justificación a un paso separado admin-only (compatible con
  el modo ciego sin asimetría).
- **C — Motivos + catálogo** (este spec): categoriza cada descuadre en un paso de justificación.
  Habilita a futuro **obligar la justificación** (bloquear al cajero con pendientes), el **reporte
  over/short por cajero** y la **aprobación por umbral** (§6), todos diferidos.
