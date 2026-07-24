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
- **"Congelar el hecho transaccional":** el motivo se congela junto al arqueo en
  `caja_arqueo_medio`, exactamente como A congela esperado/contado/diferencia.

## Alcance

**Incluido:**
- Tabla `motivo_diferencia_caja` (tenant-owned) + módulo CRUD (entidad, controller, service,
  DTOs, defaults, seed, página de Configuración).
- Dos columnas en `caja_arqueo_medio`: `motivo_diferencia_id` (FK) + `comentario_diferencia`.
- Captura del motivo en el **cierre normal** (inline, mismo `POST /cerrar`) y **justificación
  post-cierre en modo ciego** (`PATCH`, **admin-only**).

**Fuera de alcance (siguen diferidos):**
- **Reporte over/short** agregado por cajero (§6).
- **Aprobación por umbral** del encargado (§6) — la norma es justificar-siempre, sin umbral.
- **Ocultar el resultado post-cierre** al cajero (§6).

## Decisiones de diseño (tomadas con el owner, 2026-07-24)

1. **Captura del motivo — inline en normal, post-cierre en ciego.** En modo normal la
   diferencia es visible en vivo antes de enviar → el motivo va **en el drawer, en el mismo
   `POST /cerrar`** (bloqueante). En modo ciego la diferencia recién se revela **después** de
   cerrar (B redirige al detalle) → el motivo se fija **después**, sobre la caja ya cerrada,
   con un `PATCH`.
2. **La justificación en ciego es admin-only (`TenantAdminGuard`).** El cajero cuenta a ciegas
   y **ve** su diferencia al revelar, pero **el motivo lo fija el admin** en la conciliación
   (separación de funciones, anti-fraude). El cierre normal sigue siendo el cajero
   (`MiCaja:Actualizar`). Asimetría intencional: **normal → el cajero se auto-justifica;
   ciego → el admin justifica.**
3. **CRUD admin-only espejando `causas-merma`.** El catálogo es configuración del tenant →
   `TenantAdminGuard` para escribir, **lectura abierta** al tenant (JwtAuthGuard+TenantGuard)
   para que el cajero vea el dropdown al cerrar. Coincide con el patrón del repo (catálogos =
   admin-only; features operativas = permiso de módulo). No se agrega un módulo de permiso nuevo.
4. **`requiere_comentario` es una columna configurable** por motivo (no hardcode a "Otro"). El
   admin puede marcar cualquier motivo como "exige detalle". Sembrada en `true` solo para "otro".
5. **`es_fijo` bloquea rename y delete, pero `activo` es siempre togglable** — divergencia
   deliberada de `causas-merma` (que bloquea toda edición en fijas). Se necesita para la red de
   seguridad: el admin debe poder **desactivar** un default que no usa.
6. **Red de seguridad (degradación, no bloqueo):** si el tenant no tiene **ningún** motivo
   activo, la diferencia se justifica solo con **comentario obligatorio**. Nunca se bloquea el
   cierre por falta de catálogo.

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
| `motivo_diferencia_id` | UUID | NULL, FK → `motivo_diferencia_caja` | solo en líneas con `diferencia ≠ 0` |
| `comentario_diferencia` | TEXT | NULL | obligatorio si el motivo `requiere_comentario` o red de seguridad |

Ambas se congelan al cerrar (normal) o al justificar (ciego). En líneas que cuadran quedan `NULL`.

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

## Backend — captura en el cierre normal

`CerrarCajaDto` → cada línea (`LineaCierreDto`) gana **`motivoDiferenciaId?`** (uuid) y
**`comentarioDiferencia?`** (string). `cerrar` (en `caja.service.ts`), **después** de recomputar
la diferencia por línea, valida server-side por cada línea con `diferencia ≠ 0`:

1. Cargar los motivos **activos** del tenant (una query, sin N+1).
2. Si hay motivos activos → `motivoDiferenciaId` **obligatorio** y debe pertenecer al tenant y
   estar activo. Si el motivo elegido `requiere_comentario` → `comentarioDiferencia` obligatorio.
3. Si **no** hay motivos activos (red de seguridad) → `comentarioDiferencia` obligatorio, sin motivo.
4. Líneas con `diferencia = 0` → no se pide nada; si vienen con motivo, se ignora (queda NULL).

El motivo/comentario se **congela** en `caja_arqueo_medio` junto al resto de la línea. El
`comentario` global de cierre (de A) **se conserva** y es independiente del comentario por línea.

## Backend — justificación en modo ciego (post-cierre)

Nuevo endpoint **`PATCH /caja/:id/arqueo/motivos`** (`@RequiresPermiso` **no**; guard
**`TenantAdminGuard`** — admin-only). Body: `{ lineas: [{ metodoPagoId: string | null,
motivoDiferenciaId?: string, comentarioDiferencia?: string }] }`.

- Solo sobre una caja **cerrada** del tenant (valida estado + `tenant_id` del token).
- Aplica las **mismas reglas** de validación que el cierre normal, pero sobre las filas
  **congeladas** de `caja_arqueo_medio` cuya `diferencia ≠ 0`.
- Actualiza `motivo_diferencia_id` + `comentario_diferencia` de esas filas (soft-update, sin
  recomputar esperado/contado/diferencia — el hecho transaccional no se altera).
- Es **editable**: el admin puede corregir un motivo ya asignado (no hay lock ni deadline).

**Consecuencia aceptada del modo ciego:** la caja ya está **cerrada** cuando se revela la
diferencia, así que el motivo **no puede bloquear** el cierre ya hecho. Una línea descuadrada
sin motivo queda como **"pendiente de justificación"** en el detalle hasta que el admin la
categorice. En **normal** sí es bloqueante (diferencia visible antes de enviar).

## Frontend

- **`configuracion/motivos-diferencia.vue`** espejando `configuracion/causas-merma.vue`: tabla
  (nombre, `activo` toggle, badge de fijo) + drawer crear/editar con campo `nombre`, switch
  `activo` y switch **`requiere_comentario`**; los fijos permiten togglear `activo`/
  `requiere_comentario` pero no renombrar/eliminar. Link en el nav de Configuración.
- **`CajaCierreDrawer.vue` (modo normal):** cuando **cualquier** línea (obligatoria o
  informativa contada) tiene `diferenciaDe(l) ≠ 0` en vivo, se muestra un `USelect` con los
  motivos activos + un `UInput`/textarea de comentario (obligatorio si el motivo elegido
  `requiere_comentario`, o si no hay motivos activos). El gate de submit se extiende: cada línea
  que descuadra necesita su motivo (o comentario, red de seguridad). En **modo ciego el drawer
  no cambia** — no muestra diferencia, no pide motivo (se justifica después).
- **Detalle de caja (revelación / conciliación):** `CajaArqueoTable` gana una columna
  **"Motivo"** (nombre + comentario, o "Sin justificar" si `diferencia ≠ 0` y sin motivo).
  Para un **admin**, las líneas descuadradas sin justificar (o para corregir) ofrecen un
  selector de motivo/comentario que hace el `PATCH /caja/:id/arqueo/motivos`. Para no-admin es
  solo lectura. Store: `cargarArqueo` ya trae las líneas; se agrega `justificarDiferencias`.

## Reglas de negocio

1. Toda línea con `diferencia ≠ 0` exige justificación: **motivo** (si hay motivos activos) o
   **comentario** (red de seguridad, si no los hay). Si el motivo `requiere_comentario`, además
   comentario.
2. En **normal** la justificación es **bloqueante** en el cierre y la fija el **cajero**
   (`MiCaja:Actualizar`, dentro de `cerrar`).
3. En **ciego** la justificación es **post-cierre** y la fija **solo el admin**
   (`TenantAdminGuard`, `PATCH`). Una diferencia sin justificar queda "pendiente".
4. El **catálogo** lo gestiona **solo el admin** (`TenantAdminGuard`); la **lectura** está
   abierta al tenant (dropdown de cierre).
5. Un motivo `es_fijo` no se renombra ni se elimina, pero **sí** se puede activar/desactivar y
   cambiar su `requiere_comentario`.
6. `tenant_id`/`usuario_id` del token; soft delete; el motivo se congela con el arqueo y no
   altera esperado/contado/diferencia.
7. Cambiar/desactivar motivos afecta cierres **desde ese momento**; no reescribe arqueos ya
   congelados.

## Testing

- **Unit (`motivos-diferencia.service.spec`):** `create` (nombre único case-insensitive,
  soft-delete), `update`/`remove` bloqueados en `es_fijo` para nombre/delete pero permitidos
  para `activo`/`requiere_comentario`, `findAll` con `soloActivas`.
- **Unit (`caja.service.spec`):** `cerrar` con línea que descuadra → 400 sin motivo (habiendo
  motivos activos); 400 sin comentario cuando el motivo `requiere_comentario`; 201 congelando
  motivo+comentario; **red de seguridad:** sin motivos activos, 400 sin comentario / 201 con
  comentario. `justificarDiferencias` (PATCH ciego): actualiza filas congeladas, valida las
  mismas reglas, no toca esperado/contado/diferencia.
- **Unit (`caja.controller.spec`):** el `PATCH /:id/arqueo/motivos` exige `TenantAdminGuard`
  (admin-only); el CRUD exige `TenantAdminGuard` para escribir y lectura abierta.
- **E2E (`caja.e2e-spec` + `motivos-diferencia.e2e-spec`):** CRUD admin-only (403 no-admin en
  escritura, 200 en lectura); cierre normal con diferencia → exige motivo, lo congela y lo
  revela en el detalle; ciego → cerrar con diferencia deja "pendiente", el `PATCH` admin la
  justifica, un no-admin recibe 403.
- **Smoke navegador:** config de motivos (crear/editar/desactivar, fijo no renombrable);
  cierre normal con descuadre pide motivo y lo muestra congelado; en ciego, el detalle muestra
  "Sin justificar" y el admin justifica con el selector. Consola sin errores.

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
  `motivo_diferencia_id = NULL`; el detalle las muestra como "Sin justificar" si descuadran.
  Sin efecto retroactivo (regla 7).
- **`CerrarCajaDto`** gana campos **opcionales** por línea → los clientes de A/B que no los
  mandan siguen funcionando salvo que la línea descuadre y existan motivos activos (ahí el
  server exige motivo, comportamiento nuevo esperado).

## Docs a actualizar (mismo commit que el código)

- `docs/features/gestion-cajas.md` — motivos categorizados (catálogo, captura normal vs
  justificación ciega admin-only, red de seguridad), columnas nuevas de `caja_arqueo_medio`.
- `docs/ESTADO.md` — fila de la feature (motivos de diferencia).
- `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9 / `docs/agent/pendientes.md` —
  marcar C hecho; reporte over/short y umbral (§6) siguen diferidos.
- `startup-pos.sql` — tabla `motivo_diferencia_caja` + columnas en `caja_arqueo_medio`.

## Criterios de aceptación

- [ ] Tabla `motivo_diferencia_caja` (tenant-owned, único `(tenant_id, lower(nombre))`, soft-delete).
- [ ] `caja_arqueo_medio` con `motivo_diferencia_id` (FK) + `comentario_diferencia`.
- [ ] CRUD `motivos-diferencia`: escritura `TenantAdminGuard`, lectura abierta; `es_fijo` bloquea
  rename/delete pero permite `activo`/`requiere_comentario`.
- [ ] Cierre normal: línea con `diferencia ≠ 0` exige motivo (o comentario si red de seguridad),
  comentario si `requiere_comentario`; lo congela.
- [ ] `PATCH /caja/:id/arqueo/motivos` admin-only justifica caja cerrada (ciego), editable, sin
  alterar esperado/contado/diferencia.
- [ ] Página `configuracion/motivos-diferencia.vue` + drawer normal con motivo + detalle con
  columna Motivo y justificación admin.
- [ ] Seed de los 7 en `seeder.service` y `tenants.service.create`; todos `es_fijo`, "otro"
  `requiere_comentario`.
- [ ] `tenant_id`/`usuario_id` del token; soft delete; Decimal (diferencia de A intacta).
- [ ] Unit + e2e verdes; smoke de config + cierre normal + justificación ciega.
- [ ] Docs actualizadas (gestion-cajas.md, ESTADO.md, §9/pendientes.md, startup-pos.sql).

---

## Relación con el roadmap del refactor de arqueo

- **A — Arqueo multi-medio** (hecho): esperado/contado/diferencia por método, congelados en
  `caja_arqueo_medio`. C agrega el motivo a cada línea que descuadra.
- **B — Cierre ciego** (hecho): retiene el esperado durante el conteo. C respeta el modo ciego
  moviendo la justificación a **post-cierre admin-only**.
- **C — Motivos + catálogo** (este spec): categoriza cada descuadre. Habilita a futuro el
  **reporte over/short por cajero** y la **aprobación por umbral** (§6), ambos diferidos.
