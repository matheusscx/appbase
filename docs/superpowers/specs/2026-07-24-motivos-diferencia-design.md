# Motivos categorizados de diferencia + catálogo CRUD — Design Spec

**Fecha:** 2026-07-24
**Estado:** ✅ Aprobado por el owner — listo para plan de implementación
**Sub-proyecto:** C de 3 del refactor de arqueo (A multi-medio → B ciego → **C motivos**)
**Depende de:** [`2026-07-24-arqueo-multimedio-design.md`](2026-07-24-arqueo-multimedio-design.md) (A) y [`2026-07-24-cierre-ciego-design.md`](2026-07-24-cierre-ciego-design.md) (B), ambos en `main`
**Investigación:** [`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](../../agent/investigaciones/2026-07-23-gestion-caja.md) (motivos categorizados de Fudo: justificar-siempre)
**Feature relacionada:** [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md)

---

## Contexto

Al cerrar una caja, cada línea del arqueo (por método de pago, desde A) puede tener una
**diferencia ≠ 0** (contado ≠ esperado). Hoy esa diferencia **solo se registra**; C la hace
**justificar** con un **motivo categorizado** obligatorio — el estándar de la región (Fudo obliga
a un motivo tipificado en cualquier descuadre).

**El cierre pasa a ser de dos fases.** En modo ciego (B) el cajero cuenta **sin ver el esperado**,
así que no puede justificar un descuadre que todavía no vio. La única forma correcta es:
**(1)** el cajero envía el conteo → el sistema lo **congela** y recién ahí **revela** la diferencia;
**(2)** el cajero elige el motivo de cada descuadre y **finaliza**. Entre ambas la caja queda en un
**estado intermedio `en_conciliacion`** (conteo inmutable, diferencia revelada, justificación
pendiente). Se aplica **igual a modo normal y ciego** (un solo flujo). Congelar el conteo **antes**
de revelar es lo que preserva el anti-fraude: el cajero no puede "maquillar" el conteo tras ver que
le falta.

C tiene tres piezas: **(1)** un **catálogo CRUD** de motivos por tenant (la mayor parte de la
maquinaria), **(2)** el **estado intermedio + las dos fases** en el flujo de cierre, y **(3)** un
**override del admin** sobre cajas ya cerradas.

## Recordatorio del dominio (para no romper invariantes)

- **`tenant_id`/`usuario_id` del token**, nunca del body.
- **Soft delete en todo**; toda lectura filtra `eliminado_el IS NULL`.
- **Dinero con Decimal.js**; una línea descuadra si `!new Decimal(diferencia).isZero()`. Nunca `number`.
- El motor de precios, `movimientos_inventario` y el sistema JWT **no se tocan**.
- **Congelar el hecho transaccional:** la **fase 1** congela esperado/contado/diferencia (como
  hoy hace `cerrar`), y ese conteo es **inmutable**. La **fase 2** solo agrega motivo/comentario y
  fecha de cierre; nunca recomputa las cifras congeladas.

## Alcance

**Incluido:**
- Tabla `motivo_diferencia_caja` (tenant-owned) + módulo CRUD (entidad, controller, service,
  DTOs, defaults, seed, página de Configuración).
- Dos columnas en `caja_arqueo_medio`: `motivo_diferencia_id` (FK) + `comentario_diferencia`.
- **Estado de caja `en_conciliacion`** + **cierre en dos fases** (enviar conteo → finalizar con
  motivos), uniforme para normal y ciego, con auto-cierre cuando todo cuadra.
- **Override del admin** (`PATCH`, admin-only) para corregir motivos de una caja **ya cerrada**.

**Fuera de alcance (siguen diferidos):**
- **Reporte over/short** agregado por cajero (§6).
- **Aprobación por umbral** del encargado (§6) — la norma es justificar-siempre, sin umbral.
- **Ocultar el resultado post-cierre** al cajero (§6).
- **Deadlines / expiración** de una conciliación abandonada (queda `en_conciliacion` hasta que el
  cajero o un admin la finalice; sin caducidad automática).

## Decisiones de diseño (tomadas con el owner, 2026-07-24)

1. **Cierre en dos fases con estado intermedio.** Fase 1 (`POST /caja/:id/conteo`): el cajero envía
   los montos contados → el server **congela** esperado/contado/diferencia y **revela** la
   diferencia. Fase 2 (`POST /caja/:id/cerrar`): el cajero elige motivo por descuadre y **finaliza**.
   Entre ambas la caja está en **`en_conciliacion`** (conteo inmutable). **Auto-cierre:** si en la
   fase 1 **todo cuadra** (ninguna línea descuadra), la caja pasa directo a `cerrada` (no hay fase 2).
2. **El cajero justifica en la misma sentada; el conteo se congela antes de revelar.** Es lo que
   hace el ciego correcto (sin lock-antes-de-revelar, el cajero podría maquillar el conteo). El
   cajero es el actor de ambas fases (`MiCaja:Actualizar`).
3. **Si el cajero abandona la conciliación**, la caja queda en `en_conciliacion`: **él puede
   retomarla** al volver, y **un admin también puede finalizarla** (`TenantAdminGuard`), para que no
   quede trabada. El conteo ya está congelado, así que retomar/finalizar no es riesgo.
4. **Override del admin sobre caja ya cerrada.** El `PATCH /caja/:id/arqueo/motivos` (admin-only)
   corrige el motivo de una caja **`cerrada`** (aclarar/rectificar un descuadre después). Es deber
   del admin aclarar cualquier descuadre.
5. **CRUD admin-only espejando `causas-merma`.** Catálogo = configuración → `TenantAdminGuard` para
   escribir, **lectura abierta** al tenant (dropdown de la fase 2). Sin módulo de permiso nuevo.
6. **`requiere_comentario` configurable** por motivo (no hardcode a "otro"); sembrado `true` solo
   para "otro". **`es_fijo`** bloquea rename/delete pero **permite** togglear `activo`/
   `requiere_comentario`. **Red de seguridad:** sin motivos activos, la fase 2 justifica solo con
   comentario obligatorio.

> **Consecuencia buena:** el estado `en_conciliacion` **fuerza** la justificación del cajero — no
> puede finalizar ni abrir otra caja sin resolver los descuadres (el invariante de una-caja-abierta
> trata `en_conciliacion` como ocupada). Lo que originalmente estaba diferido ("obligar al cajero a
> justificar") queda cubierto por el estado. El admin es la válvula de escape (finalizar/override).

## Modelo de datos

**Caja — nuevo estado.** El `estado` de una caja física suma `'en_conciliacion'`, intermedio entre
`'abierta'` y `'cerrada'`: `abierta → en_conciliacion → cerrada` (o `abierta → cerrada` si cuadra).
La caja **virtual** no se afecta (siempre `abierta`, sin arqueo).

**Tabla nueva `motivo_diferencia_caja`** (espeja `causas_merma`):

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `motivo_diferencia_id` | UUID | PK | `type: 'uuid'` explícito (ADR-004) |
| `tenant_id` | UUID | NOT NULL | del token al sembrar/crear |
| `nombre` | TEXT | NOT NULL | único por tenant (case-insensitive) |
| `activo` | BOOLEAN | NOT NULL default `true` | togglable siempre |
| `requiere_comentario` | BOOLEAN | NOT NULL default `false` | exige comentario al elegirlo |
| `es_fijo` | BOOLEAN | NOT NULL default `false` | default sembrado: bloquea rename/delete |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | | soft-delete |

Índice único parcial: `uq_motivo_diferencia_tenant_nombre ON motivo_diferencia_caja (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL`.

**`caja_arqueo_medio` (de A) — 2 columnas nuevas:**

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `motivo_diferencia_id` | UUID | NULL, FK → `motivo_diferencia_caja` | lo puebla la fase 2 / el override |
| `comentario_diferencia` | TEXT | NULL | obligatorio si el motivo `requiere_comentario` o red de seguridad |

La **fase 1** congela las líneas (esperado/contado/diferencia, motivo `NULL`). La **fase 2** (o el
override admin) puebla motivo/comentario. Líneas que cuadran quedan con motivo `NULL`.

## Backend — catálogo CRUD

Módulo `motivos-diferencia` espejando `mermas/causas-merma.*` (entidad en `app.module.ts`
`entities`; controller `@UseGuards(JwtAuthGuard, TenantGuard)` con lectura abierta y
`@UseGuards(TenantAdminGuard)` en `POST`/`PATCH /:id`/`DELETE /:id`; service raw parametrizado con
`findAll(tenantId, soloActivas)`/`create`/`update`/`remove`, `assertNombreUnico` case-insensitive).
**Divergencia:** `update`/`remove` sobre un `es_fijo` bloquean `nombre`/borrado pero permiten
`activo`/`requiere_comentario`. **Helpers reutilizados por caja:** `assertMotivoValido(runner,
tenantId, motivoId)` y `hayMotivosActivos(runner, tenantId)`.

> Nota TypeORM+pg: `INSERT/UPDATE ... RETURNING` vía `dataSource.query` llega como `[rows, rowCount]`,
> no como `rows` — desenvolver defensivamente (patrón `liquidacion-propinas.service.ts`). El mismo
> gotcha pre-existe en `causas-merma.service` (anotar en `pendientes.md`, fuera de alcance).

## Backend — cierre en dos fases + estado `en_conciliacion`

**Fase 1 — enviar conteo. `POST /caja/:id/conteo`** (`@RequiresPermiso('MiCaja','Actualizar')`,
owner). Body `{ lineas: [{ metodoPagoId, montoContado }], comentario? }` (igual que el `cerrar` de
B). Dentro de una transacción con lock:
1. La caja debe estar **`abierta`** y ser del `usuarioId` del token.
2. Recomputa el esperado (`calcularArqueo`) y **congela** esperado/contado/diferencia por línea en
   `caja_arqueo_medio` (motivo `NULL`). Valida obligatorias con contado (como hoy `cerrar`).
3. Fija agregados de la caja (`saldoFinal`, `montoContado`, `diferencia` = línea de efectivo).
4. **Si ninguna línea descuadra** → `estado = 'cerrada'` + `fechaCierre` (auto-cierre). **Si alguna
   descuadra** → `estado = 'en_conciliacion'` (sin `fechaCierre`).
5. Devuelve `{ estado, arqueo }` con las líneas **reveladas** (esperado/contado/diferencia).

**Fase 2 — finalizar con motivos. `POST /caja/:id/cerrar`** (owner **o** admin; ver más abajo).
Body `{ lineas: [{ metodoPagoId, motivoDiferenciaId?, comentarioDiferencia? }] }`. En transacción:
1. La caja debe estar **`en_conciliacion`** y del tenant. Si es el owner alcanza `MiCaja:Actualizar`;
   si no es el owner, requiere ser admin del tenant (`TenantAdminGuard` / chequeo de admin).
2. Por cada fila congelada con `diferencia ≠ 0`: si hay motivos activos → `motivoDiferenciaId`
   obligatorio (validado con `assertMotivoValido`), + comentario si `requiere_comentario`; si no hay
   motivos activos (red de seguridad) → `comentarioDiferencia` obligatorio.
3. Actualiza `motivo_diferencia_id`/`comentario_diferencia` de esas filas (sin recomputar cifras),
   `estado = 'cerrada'`, `fechaCierre`.
4. Devuelve `{ caja, arqueo }` (líneas ya justificadas).

**Autorización de la fase 2:** el controller resuelve "owner **o** admin" (patrón análogo a
`resolverLecturaCompartida`, pero para escritura): si `usuarioId` del token es el owner de la caja
→ ok; si no, requiere `es_superadmin`/admin del tenant. Así el cajero finaliza lo suyo y el admin
puede destrabar una conciliación abandonada.

## Backend — override del admin (caja cerrada)

**`PATCH /caja/:id/arqueo/motivos`** (`@UseGuards(TenantAdminGuard)` — admin-only). Body
`{ lineas: [{ metodoPagoId, motivoDiferenciaId?, comentarioDiferencia? }] }`. Sobre una caja
**`cerrada`** del tenant: aplica las **mismas reglas** de validación que la fase 2 sobre las filas
congeladas con `diferencia ≠ 0`, actualiza `motivo_diferencia_id`/`comentario_diferencia` **sin**
recomputar esperado/contado/diferencia. Editable (corrige un motivo ya asignado). Es el "aclarar
después" del admin.

## Backend — impacto en la máquina de estados (`en_conciliacion`)

Una caja `en_conciliacion` está **ocupada** pero **congelada**: ni admite ventas/movimientos ni se
puede abrir otra en su lugar. Puntos a ajustar en `caja.service.ts` (y consumidores):
- **`findActiva(tenant, user)`** → devuelve la caja con `estado IN ('abierta','en_conciliacion')`
  (para que el cajero retome la conciliación pendiente y para que el chequeo de apertura la vea).
- **`abrir`** (chequeo `existente` + índice único de cajón) → una caja `en_conciliacion` **bloquea**
  abrir otra (mismo trato que `abierta`).
- **`cajonesDisponibles` / `cajonesEstado`** → un cajón con caja `en_conciliacion` **no** está
  disponible y se muestra ocupado (hoy filtran `estado = 'abierta'`; sumar `en_conciliacion`).
- **`registrarMovimiento` / ventas físicas** → siguen exigiendo `abierta`; `en_conciliacion` las
  rechaza (el conteo está congelado). Sin cambio salvo verificar el mensaje.
- **`obtenerArqueo`** → para `en_conciliacion` (no `abierta`) cae en la rama de líneas **congeladas
  reveladas** (ya existe); en `en_conciliacion` el `esperado` se revela aunque el tenant sea ciego
  (el conteo ya se envió). Sumar el JOIN a `motivo_diferencia_caja` para traer el motivo por línea.
- **Lock** (`bloquearCajaAbierta`) → la fase 2 necesita lockear una caja `en_conciliacion`; usar una
  variante que acepte ese estado.

## Frontend

- **`configuracion/motivos-diferencia.vue`** espejando `configuracion/causas-merma.vue` + el switch
  `requiere_comentario`; los fijos permiten togglear `activo`/`requiere_comentario` pero no
  renombrar/eliminar. Link en el nav de Configuración.
- **`CajaCierreDrawer.vue` — dos fases.** (1) El cajero ingresa los contados y pulsa **"Enviar
  conteo"** (`POST /conteo`). Si la respuesta viene `cerrada` (cuadró) → toast + cierre, fin. Si
  viene `en_conciliacion` → el drawer pasa a la **vista de conciliación**: muestra las diferencias
  reveladas y, por cada línea que descuadra, un `USelect` de motivos activos + comentario
  (obligatorio si `requiere_comentario` o red de seguridad). (2) **"Confirmar cierre"**
  (`POST /cerrar`) finaliza. En **modo ciego** la fase 1 no muestra esperado (como B); la vista de
  conciliación sí lo revela (el conteo ya se envió).
- **Retomar una conciliación pendiente.** Una caja `en_conciliacion` se trata como "activa" del
  cajero: el detalle/dashboard ofrece **"Continuar conciliación"** que abre el drawer directo en la
  vista de conciliación (carga el arqueo revelado y pide los motivos). Un **admin** viendo una caja
  `en_conciliacion` ajena también puede finalizarla.
- **Detalle de caja cerrada.** `CajaArqueoTable` gana columna **"Motivo"** (nombre + comentario, o
  "Sin justificar" si `diferencia ≠ 0` sin motivo — solo para cajas viejas anteriores a C). Para un
  **admin**, un selector inline hace el `PATCH` de override. Para no-admin, solo lectura.
- **Store:** `enviarConteo(cajaId, payload)` (fase 1), `cerrar(cajaId, { lineas })` (fase 2, ahora
  con motivos), `justificarDiferencias(cajaId, lineas)` (override admin), `motivos`/`cargarMotivos`.
  `ArqueoLinea` con `motivoDiferenciaId?`/`motivoNombre?`/`comentarioDiferencia?`.

## Reglas de negocio

1. El cierre es de **dos fases**: (1) enviar conteo congela e (si descuadra) revela → `en_conciliacion`;
   (2) justificar y finalizar → `cerrada`. Si todo cuadra, la fase 1 cierra directo.
2. El **conteo es inmutable** desde la fase 1 (anti-fraude: se congela antes de revelar).
3. La **fase 2** exige, por línea con `diferencia ≠ 0`: motivo (si hay motivos activos) o comentario
   (red de seguridad); comentario además si el motivo `requiere_comentario`.
4. **Actor:** el cajero (owner, `MiCaja`) hace ambas fases. Un **admin** puede finalizar la fase 2 de
   una caja `en_conciliacion` abandonada, y **corregir** (override `PATCH`, admin-only) una caja ya
   `cerrada`.
5. `en_conciliacion` **ocupa** el cajón/usuario: no se abren otras cajas ni se registran movimientos
   hasta finalizar.
6. El **catálogo** lo gestiona solo el admin (`TenantAdminGuard`); la **lectura** es abierta al tenant.
   `es_fijo` no se renombra/elimina pero se activa/desactiva y togglea `requiere_comentario`.
7. `tenant_id`/`usuario_id` del token; soft delete; la fase 2/override no altera
   esperado/contado/diferencia congelados.
8. Cambiar/desactivar motivos afecta justificaciones **desde ese momento**; no reescribe lo congelado.

## Testing

- **Unit (`motivos-diferencia.service.spec`):** `create`/`update`/`remove` con la divergencia
  `es_fijo`, `findAll` con `soloActivas`, y el desenvuelto de `RETURNING` (`[rows, rowCount]`).
- **Unit (`caja.service.spec`):** **fase 1** (`enviarConteo`): congela y auto-cierra si cuadra;
  deja `en_conciliacion` si descuadra; 400 si la caja no está `abierta`. **fase 2** (`cerrar` desde
  `en_conciliacion`): 400 si no está `en_conciliacion`; exige motivo/comentario por descuadre;
  finaliza a `cerrada`; owner-o-admin. **override** (`justificarDiferencias` sobre `cerrada`):
  admin, valida, no recomputa cifras. `findActiva`/`abrir` tratan `en_conciliacion` como ocupada.
- **Unit (`caja.controller.spec`):** guards — fase 1 owner; fase 2 owner-o-admin; override
  `TenantAdminGuard`; CRUD `TenantAdminGuard` en escritura, lectura abierta.
- **E2E (`caja.e2e-spec` + `motivos-diferencia.e2e-spec`):** CRUD admin-only (403 no-admin);
  flujo dos fases normal (conteo con descuadre → `en_conciliacion` → cerrar con motivo → `cerrada`,
  el `GET` muestra `motivoNombre`); **auto-cierre** cuando cuadra; **ciego** (conteo sin ver
  esperado → conciliación revela → finaliza); un admin finaliza una `en_conciliacion` ajena; el
  **override** admin sobre `cerrada` (403 no-admin, 200 admin). `arqueo_ciego` restaurado en `finally`.
- **Smoke navegador:** config de motivos; cierre normal en dos pasos (enviar conteo → conciliación
  con motivo → finalizar); cuadre → cierre directo; ciego (sin esperado en fase 1, revelado en
  conciliación); retomar una conciliación pendiente; override admin en caja cerrada. Consola sin errores.

## Seed

Los 7 motivos por defecto se siembran en `seeder.service.ts` (bootstrap, UUID fijos, índice único
idempotente) **y** en `tenants.service.create` (tenant nuevo, UUID generado): `falta de efectivo`,
`sobra de efectivo`, `divergencia de tarjeta`, `error de lanzamiento manual`, `pago no registrado`,
`error operacional`, **`otro`**. Todos `es_fijo = true`; **`otro`** además `requiere_comentario = true`.

## Backward-compat (etapa de desarrollo)

- Tablas/columnas/estado nuevos vía `synchronize` (dev/CI), sin migraciones.
- **Cambio de contrato del cierre:** el `POST /caja/:id/cerrar` deja de aceptar el conteo; ahora el
  conteo va por `POST /caja/:id/conteo` y `cerrar` finaliza con motivos. Los consumidores (B: drawer,
  e2e) se actualizan en el mismo cambio; no hay clientes externos.
- **Cajas ya cerradas** antes de C: `motivo_diferencia_id = NULL`; el detalle las muestra "Sin
  justificar" si descuadran; el admin puede corregirlas con el override. Sin efecto retroactivo.

## Docs a actualizar (mismo commit que el código)

- `docs/features/gestion-cajas.md` — cierre en dos fases + estado `en_conciliacion`, motivos
  categorizados (catálogo, fase 2 del cajero, override admin, red de seguridad), columnas nuevas.
- `docs/ESTADO.md` — fila de la feature (motivos de diferencia / conciliación en dos fases).
- `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9 / `docs/agent/pendientes.md` — marcar C
  hecho (con conciliación en dos fases); reporte over/short y umbral (§6) siguen diferidos; anotar el
  gotcha de `RETURNING` en `causas-merma.service`.
- `startup-pos.sql` — tabla `motivo_diferencia_caja` + columnas en `caja_arqueo_medio` + comentar el
  estado `en_conciliacion`.

## Criterios de aceptación

- [ ] Estado `en_conciliacion` (`abierta → en_conciliacion → cerrada`, o `abierta → cerrada` si cuadra),
  tratado como ocupado en `findActiva`/`abrir`/`cajonesDisponibles`/`cajonesEstado`.
- [ ] Fase 1 `POST /caja/:id/conteo` (owner): congela, auto-cierra si cuadra, si no → `en_conciliacion`
  y revela.
- [ ] Fase 2 `POST /caja/:id/cerrar` (owner-o-admin) desde `en_conciliacion`: exige motivo/comentario
  por descuadre, finaliza a `cerrada`, sin recomputar cifras.
- [ ] Override `PATCH /caja/:id/arqueo/motivos` (admin-only) sobre `cerrada`, editable.
- [ ] Tabla `motivo_diferencia_caja` (única `(tenant_id, lower(nombre))`, soft-delete) + CRUD
  admin-only, lectura abierta, `es_fijo` togglable en `activo`/`requiere_comentario`; `RETURNING`
  desenvuelto.
- [ ] `caja_arqueo_medio` con `motivo_diferencia_id` + `comentario_diferencia`.
- [ ] Frontend: página de motivos; drawer en dos fases; retomar conciliación; override admin en detalle.
- [ ] Seed de los 7 (todos `es_fijo`, "otro" `requiere_comentario`) en seeder + `tenants.create`.
- [ ] `tenant_id`/`usuario_id` del token; soft delete; Decimal; virtual sin afectar.
- [ ] Unit + e2e verdes; smoke de las dos fases + ciego + retomar + override.
- [ ] Docs actualizadas.

---

## Relación con el roadmap del refactor de arqueo

- **A — Arqueo multi-medio** (hecho): esperado/contado/diferencia por método, congelados en
  `caja_arqueo_medio`.
- **B — Cierre ciego** (hecho): retiene el esperado durante el conteo. C lo integra: la fase 1
  respeta el ciego (no revela); la revelación ocurre recién al pasar a `en_conciliacion`.
- **C — Motivos + catálogo + conciliación en dos fases** (este spec): categoriza cada descuadre en
  una fase de justificación con estado intermedio. El estado `en_conciliacion` **fuerza** la
  justificación del cajero. Habilita a futuro el **reporte over/short** y la **aprobación por
  umbral** (§6), diferidos.
