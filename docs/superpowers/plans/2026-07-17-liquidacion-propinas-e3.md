# Liquidación de Propinas E3 — Plan de Implementación (motor + UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar el motor de liquidación de propinas por período: tablas snapshot/fuente/participantes/eventos, cálculo por los 5 criterios (incl. MANUAL PESOS/MONTOS) con mayores restos, API crear/editar/confirmar/anular con concurrencia segura, y UI lista + detalle.

**Status:** Done

**Architecture:** Cinco tablas nuevas bajo `PropinasModule`. Al crear borrador se congelan tips en `liquidacion_propinas_fuente`, se copia la config vigente a `liquidacion_propinas_grupo`, se sugieren participantes y se calculan montos. Confirmar reserva tips con `FOR UPDATE` (`venta_propina.liquidacion_id`); anular solo libera tips de esa liquidación. El motor puro (`mayores-restos` + métricas) se testea aparte del orquestador HTTP.

**Tech Stack:** NestJS, TypeORM, PostgreSQL 15, Decimal.js, Jest, Nuxt 4, Vue 3, Nuxt UI v4.

**Spec:** `docs/superpowers/specs/2026-07-17-liquidacion-propinas-design.md` § E3.

**Prerequisito:** E1 Done + E2 Done (config distribución, RBAC `Propinas:Leer|Configurar|Liquidar`).

## Global Constraints

- Trabajar directamente sobre `main`; no crear ramas ni PRs.
- Desarrollo Docker-first; no agregar dependencias npm.
- `tenant_id` siempre del JWT, nunca del body.
- Toda PK/FK UUID declara `type: 'uuid'` explícito (ADR-004).
- Soft delete: `eliminado_el`, `creado_el`, `actualizado_el` en tablas nuevas.
- Dinero y porcentajes con Decimal.js / `numeric` string; porcentajes en decimal.
- Errores operativos → `400 Bad Request`.
- Esquema documental: `startup-pos.sql`.
- Post-`confirmada`: detalle inmutable (servicio rechaza mutaciones con 400).
- No implementar reportes F ni egreso de caja/nómina.
- SELECT vía réplica cuando aplique en MCP; INSERT/UPDATE/DELETE en DB primaria (convención del proyecto).
- Actualizar `docs/ESTADO.md` y feature doc en el commit final de E3.

---

## Mapa de archivos

### Crear

- `backend/src/modules/propinas/enums/estado-liquidacion.enum.ts`
- `backend/src/modules/propinas/enums/origen-participante.enum.ts`
- `backend/src/modules/propinas/enums/tipo-evento-liquidacion.enum.ts`
- `backend/src/modules/propinas/entities/liquidacion-propinas.entity.ts`
- `backend/src/modules/propinas/entities/liquidacion-propinas-grupo.entity.ts`
- `backend/src/modules/propinas/entities/liquidacion-propinas-participante.entity.ts`
- `backend/src/modules/propinas/entities/liquidacion-propinas-fuente.entity.ts`
- `backend/src/modules/propinas/entities/liquidacion-propinas-evento.entity.ts`
- `backend/src/modules/propinas/utils/mayores-restos.ts`
- `backend/src/modules/propinas/utils/mayores-restos.spec.ts`
- `backend/src/modules/propinas/utils/horas-interseccion.ts`
- `backend/src/modules/propinas/utils/horas-interseccion.spec.ts`
- `backend/src/modules/propinas/dto/create-liquidacion.dto.ts`
- `backend/src/modules/propinas/dto/update-liquidacion.dto.ts`
- `backend/src/modules/propinas/dto/anular-liquidacion.dto.ts`
- `backend/src/modules/propinas/liquidacion-propinas.service.ts`
- `backend/src/modules/propinas/liquidacion-propinas.service.spec.ts`
- `backend/src/modules/propinas/liquidacion-propinas.controller.ts`
- `frontend/app/composables/usePropinaLiquidaciones.ts`
- `frontend/app/pages/propinas/liquidaciones/index.vue`
- `frontend/app/pages/propinas/liquidaciones/[id].vue`
- `docs/features/liquidacion-propinas-motor.md`

### Modificar

- `backend/src/modules/propinas/propinas.module.ts` — entities, service, controller
- `backend/src/app.module.ts` — entities en TypeORM root
- `startup-pos.sql` — CREATE 5 tablas + FK `venta_propina.liquidacion_id` → `liquidacion_propinas` (si aún no existe la FK)
- `frontend/app/layouts/dashboard.vue` — nav "Propinas" / liquidaciones
- `docs/ESTADO.md`, `docs/README.md`, spec status E3 Done

---

### Task 1: Enums + entities + SQL documental

**Files:**
- Create: 3 enums + 5 entities listados arriba
- Modify: `startup-pos.sql`, `propinas.module.ts`, `app.module.ts`

**Interfaces:**
- Produces: entities TypeORM listas para el service; CHECKs en SQL.

- [ ] **Step 1: Crear enums**

```typescript
// estado-liquidacion.enum.ts
export enum EstadoLiquidacion {
  BORRADOR = 'borrador',
  CONFIRMADA = 'confirmada',
  ANULADA = 'anulada',
}

// origen-participante.enum.ts
export enum OrigenParticipante {
  SUGERIDO = 'sugerido',
  AGREGADO_MANUAL = 'agregado_manual',
}

// tipo-evento-liquidacion.enum.ts
export enum TipoEventoLiquidacion {
  CREADA = 'creada',
  PARTICIPANTE_AGREGADO = 'participante_agregado',
  PARTICIPANTE_EXCLUIDO = 'participante_excluido',
  RECALCULADA = 'recalculada',
  CONFIG_ACTUALIZADA = 'config_actualizada',
  CONFIRMADA = 'confirmada',
  ANULADA = 'anulada',
}
```

- [ ] **Step 2: Crear entities** (todas con soft delete + `type: 'uuid'` en PK/FK)

`LiquidacionPropinas` (`liquidacion_propinas`):

| Prop JS | Columna | Tipo |
|---|---|---|
| id | liquidacion_propinas_id | uuid PK |
| tenantId | tenant_id | uuid |
| fechaDesde / fechaHasta | fecha_desde / fecha_hasta | timestamptz |
| turnoIds | turno_ids | uuid[] (default `{}`) |
| estado | estado | text |
| poolTotal | pool_total | numeric(18,4) |
| configuracionVersion | configuracion_version | int |
| monedaId | moneda_id | uuid |
| decimalesMoneda | decimales_moneda | smallint |
| creadoPor | creado_por | uuid |
| confirmadoPor / confirmadoEl | nullable | |
| anuladoPor / anuladoEl / motivoAnulacion | nullable | |

`LiquidacionPropinasGrupo`: snapshot de grupo + `montoGrupo`.

`LiquidacionPropinasParticipante`: `incluido`, `origen`, `motivoAjuste`, métricas (`horas`, `ventasBase`, `cuentas`), `pesoManual`, `monto`, `ajusteMotivoMonto`.

`LiquidacionPropinasFuente`: UNIQUE (`liquidacionId`, `ventaPropinaId`) + `montoPagado` snapshot.

`LiquidacionPropinasEvento`: `tipo`, `payload` jsonb, `usuarioId`.

- [ ] **Step 3: SQL en `startup-pos.sql`**

```sql
CREATE TABLE liquidacion_propinas (
  liquidacion_propinas_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  fecha_desde TIMESTAMPTZ NOT NULL,
  fecha_hasta TIMESTAMPTZ NOT NULL,
  turno_ids UUID[] NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL,
  pool_total NUMERIC(18,4) NOT NULL DEFAULT 0,
  configuracion_version INT NOT NULL,
  moneda_id UUID NOT NULL REFERENCES moneda(moneda_id),
  decimales_moneda SMALLINT NOT NULL,
  creado_por UUID NOT NULL REFERENCES usuarios(usuario_id),
  confirmado_por UUID REFERENCES usuarios(usuario_id),
  confirmado_el TIMESTAMPTZ,
  anulado_por UUID REFERENCES usuarios(usuario_id),
  anulado_el TIMESTAMPTZ,
  motivo_anulacion TEXT,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eliminado_el TIMESTAMPTZ,
  CONSTRAINT chk_liquidacion_estado CHECK (estado IN ('borrador','confirmada','anulada')),
  CONSTRAINT chk_liquidacion_rango CHECK (fecha_hasta > fecha_desde),
  CONSTRAINT chk_liquidacion_decimales CHECK (decimales_moneda >= 0 AND decimales_moneda <= 8)
);
-- + liquidacion_propinas_grupo, _participante, _fuente, _evento
-- + índices (tenant_id, estado, creado_el); UNIQUE fuente (liquidacion_id, venta_propina_id) WHERE eliminado_el IS NULL
-- FK venta_propina.liquidacion_id → liquidacion_propinas(liquidacion_propinas_id) si falta
```

- [ ] **Step 4: Registrar en module + app.module entities**

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/propinas/enums/estado-liquidacion.enum.ts \
  backend/src/modules/propinas/enums/origen-participante.enum.ts \
  backend/src/modules/propinas/enums/tipo-evento-liquidacion.enum.ts \
  backend/src/modules/propinas/entities/liquidacion-propinas*.ts \
  backend/src/modules/propinas/propinas.module.ts \
  backend/src/app.module.ts startup-pos.sql
git commit -m "$(cat <<'EOF'
feat(propinas): add liquidacion entities and SQL schema (E3)

EOF
)"
```

---

### Task 2: Mayores restos + horas intersección (puro, TDD)

**Files:**
- Create: `utils/mayores-restos.ts` + `.spec.ts`
- Create: `utils/horas-interseccion.ts` + `.spec.ts`

**Interfaces:**
- Produces:

```typescript
export function repartirMayoresRestos(
  montoGrupo: string,
  pesos: { id: string; peso: string }[],
  decimales: number,
): { id: string; monto: string }[];

export function horasInterseccionHoras(
  inicioSesion: Date,
  finSesionOAhora: Date,
  fechaDesde: Date,
  fechaHasta: Date,
): string; // horas decimal string, 4 decimales
```

- [ ] **Step 1: Tests mayores restos (fallan)**

Casos del spec:
- CLP `decimales=0`, grupo `100001`, 3 pesos iguales → montos `33334,33334,33333` (desempate `id` ASC).
- Moneda `decimales=2`, montos que dejan residuo → Σ exacta.
- Un solo participante → recibe todo.
- Peso 0 excluido / Σ pesos = 0 → `BadRequestException` o array vacío según contrato documentado (preferir throw).

- [ ] **Step 2: Implementar `repartirMayoresRestos`**

```
factor = 10^decimales
montoGrupoUnidades = round_half_up(monto × factor)
cuotaExacta_i = unidades × (w_i / Σw)
base_i = floor; resto_i = fracción
R = unidades − Σ base → +1 a los R mayores restos (tie: id ASC)
monto_i = (base + extra) / factor
```

- [ ] **Step 3: Tests horas intersección**

- Sesión dentro del período → duración completa.
- Cruza medianoche / límite → solo intersección.
- Sin overlap → `"0.0000"`.
- Sesión abierta (`fin = now`) → usa `finSesionOAhora`.

- [ ] **Step 4: Implementar + pasar tests**

```bash
cd backend && npx jest src/modules/propinas/utils --no-cache
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(propinas): add mayores restos and hours intersection utils

EOF
)"
```

---

### Task 3: Service — crear borrador, listar, detalle + cálculo

**Files:**
- Create: `dto/create-liquidacion.dto.ts`
- Create: `liquidacion-propinas.service.ts` + `.spec.ts` (parcial: crear/listar/detalle/cálculo)
- Modify: `propinas.module.ts`

**Interfaces:**
- Consumes: `PropinaDistribucionService.obtener`, entities E1 (`VentaPropina`, `SesionGarzon`, `Venta`), `mayores-restos`, `horas-interseccion`
- Produces:

```typescript
crear(tenantId, usuarioId, dto: CreateLiquidacionDto): Promise<LiquidacionDetalle>
listar(tenantId, query?): Promise<LiquidacionResumen[]>
detalle(tenantId, id): Promise<LiquidacionDetalle>
```

`CreateLiquidacionDto`: `fechaDesde`, `fechaHasta` (ISO), `turnoIds?: string[]`.

**Flujo `crear` (TX):**

1. Validar `fechaHasta > fechaDesde`.
2. Resolver moneda oficial + `decimales` del tenant (mismo join que `MonedasService` / ventas).
3. Tips elegibles (SELECT):
   - `tenant_id`, `eliminado_el IS NULL`, `liquidacion_id IS NULL`, `monto_pagado > 0`
   - `creado_el >= fechaDesde AND creado_el < fechaHasta` (medio abierto; documentar)
   - si `turnoIds.length > 0`: `turno_id = ANY(turnoIds)`
4. Insertar cabecera `borrador` + filas `fuente` (snapshot `monto_pagado`) → `pool_total`.
5. Snapshot grupos activos de config vigente (`PropinaDistribucionService` / repos) → `liquidacion_propinas_grupo`; guardar `configuracion_version`.
6. Sugerir participantes:
   - Por cada grupo activo: garzones con `tipo_garzon` del snapshot que aparecen en tips del pool **o** tienen sesión que intersecta el período (y turno si filtra).
   - `origen = sugerido`, `incluido = true`, métricas según criterio.
7. Calcular `monto_grupo` y montos participante (ver abajo).
8. Evento `creada`.
9. Devolver detalle público.

**Cálculo por grupo** (privado `recalcularMontos`):

1. `monto_grupo = pool_total × porcentaje` → mayores restos a escala moneda entre **grupos** también (Σ montos grupo = pool), o round_half_up por grupo + ajuste al último por `orden` — **preferir mayores restos entre grupos** para invariante Σ = pool.
2. Participantes `incluido`:
   - `PARTES_IGUALES`: peso 1
   - `VENTAS_NETAS`: Σ `ventas.base_ventas_total_final` o `base_ventas_sin_impuestos` (según `base_ventas` del grupo) de ventas ligadas a tips del pool donde `venta_propina.garzon_id = participante` (solo tips del pool de esta liquidación, no todo el período suelto — mantiene coherencia con fuentes)
   - `HORAS_TRABAJADAS`: Σ intersección sesiones del garzón ∩ período (filtro turno si aplica); advertir sesiones abiertas
   - `CANTIDAD_CUENTAS`: # tips del pool con ese `garzon_id`
   - `MANUAL`+`PESOS`: `peso_manual` (desde config pesos o override)
   - `MANUAL`+`MONTOS`: montos capturados; validar Σ = `monto_grupo` al confirmar/recalcular si todos fijados; en crear inicial monto 0 hasta captura
3. Reparto con `repartirMayoresRestos` salvo MONTOS.

**Advertencias en detalle:** lista de sesiones abiertas que intersectan el período.

- [ ] **Step 1: Tests service crear** (mock repos / DataSource)
  - Pool = Σ tips elegibles; tip $0 excluido.
  - Snapshot version + grupos.
  - PARTES_IGUALES Σ montos = monto_grupo.
  - Filtro por turno.

- [ ] **Step 2: Implementar crear/listar/detalle + cálculo**

- [ ] **Step 3: Pasar tests**

```bash
cd backend && npx jest src/modules/propinas/liquidacion-propinas.service.spec.ts --no-cache
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(propinas): create draft liquidacion with pool snapshot and calc

EOF
)"
```

---

### Task 4: PATCH editar + recalcular + actualizar-config

**Files:**
- Create: `dto/update-liquidacion.dto.ts`
- Modify: `liquidacion-propinas.service.ts` + `.spec.ts`

**Interfaces:**

```typescript
actualizar(tenantId, usuarioId, id, dto: UpdateLiquidacionDto): Promise<LiquidacionDetalle>
actualizarConfig(tenantId, usuarioId, id): Promise<LiquidacionDetalle & { diff: ConfigDiff }>
```

`UpdateLiquidacionDto` (solo borrador):
- `participantes?: { id; incluido?; motivoAjuste?; pesoManual?; monto?; ajusteMotivoMonto? }[]`
- `recalcular?: boolean` (default true tras cambios)

Reglas:
- Excluir sugerido o agregar manual → `motivoAjuste` obligatorio.
- Agregar: `garzonId` + `grupoId` + motivo → `origen = agregado_manual`.
- MANUAL MONTOS: override monto con `ajusteMotivoMonto` si cambia.
- Solo `estado = borrador`; si no → 400.
- Eventos: `participante_agregado` | `participante_excluido` | `recalculada`.

`actualizarConfig`:
1. Diff vs config vigente (%, criterio, base, manualModo, pesos).
2. Soft-replace snapshot grupos; actualizar `configuracion_version`.
3. Recalcular; evento `config_actualizada` con payload before/after.

- [ ] **Step 1: Tests** motivo obligatorio, rechazo post-confirmada, diff config.

- [ ] **Step 2: Implementar**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(propinas): edit draft liquidacion and refresh config snapshot

EOF
)"
```

---

### Task 5: Confirmar + anular (concurrencia)

**Files:**
- Create: `dto/anular-liquidacion.dto.ts` (`motivo: string` requerido)
- Modify: `liquidacion-propinas.service.ts` + `.spec.ts`

**Interfaces:**

```typescript
confirmar(tenantId, usuarioId, id): Promise<LiquidacionDetalle>
anular(tenantId, usuarioId, id, dto: AnularLiquidacionDto): Promise<LiquidacionDetalle>
```

**Confirmar (TX):**

1. `FOR UPDATE` liquidación; exigir `borrador`.
2. Validar MANUAL MONTOS: Σ montos incluidos = `monto_grupo` por grupo.
3. `FOR UPDATE` `venta_propina` de las fuentes.
4. `UPDATE venta_propina SET liquidacion_id = :id WHERE id = ANY(:ids) AND liquidacion_id IS NULL AND eliminado_el IS NULL`.
5. Si `rowCount ≠ |fuentes|` → rollback + 400 (“una o más propinas ya fueron liquidadas”).
6. `estado = confirmada`, `confirmado_*`, evento `confirmada`.

**Anular (TX):**

1. `FOR UPDATE`; exigir `confirmada`.
2. `UPDATE venta_propina SET liquidacion_id = NULL WHERE liquidacion_id = :id`.
3. `estado = anulada`, motivo, evento `anulada`.
4. No borrar filas de detalle.

Post-confirmada: `actualizar` / `actualizarConfig` / mutar detalle → 400.

- [ ] **Step 1: Tests**
  - Confirmar OK asigna `liquidacion_id`.
  - Segunda confirmación concurrente (simular tip ya tomado) → 400.
  - Anular libera solo tips de esa liquidación.
  - Mutación post-confirmada → 400.

- [ ] **Step 2: Implementar**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(propinas): confirm and annul liquidacion with tip locking

EOF
)"
```

---

### Task 6: Controller + wiring RBAC

**Files:**
- Create: `liquidacion-propinas.controller.ts`
- Modify: `propinas.module.ts`

**Rutas** (`@Controller('propinas/liquidaciones')`, guards Jwt + Tenant + Permisos):

| Método | Path | Permiso |
|---|---|---|
| POST | `/` | `Propinas:Liquidar` |
| GET | `/` | `Propinas:Leer` |
| GET | `/:id` | `Propinas:Leer` |
| PATCH | `/:id` | `Propinas:Liquidar` |
| POST | `/:id/actualizar-config` | `Propinas:Liquidar` |
| POST | `/:id/confirmar` | `Propinas:Liquidar` |
| POST | `/:id/anular` | `Propinas:Liquidar` |

`tenantId` / `usuarioId` del JWT. No seed RBAC nuevo (ya en E2).

- [ ] **Step 1: Controller + registrar en module**

- [ ] **Step 2: Smoke manual o e2e ligero opcional** — al menos compilar:

```bash
cd backend && npx tsc --noEmit -p tsconfig.build.json
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(propinas): expose liquidacion REST API with RBAC

EOF
)"
```

---

### Task 7: Frontend — composable + lista + detalle

**Files:**
- Create: `usePropinaLiquidaciones.ts`
- Create: `pages/propinas/liquidaciones/index.vue`
- Create: `pages/propinas/liquidaciones/[id].vue`
- Modify: `layouts/dashboard.vue` — item nav si `esAdmin || can('Propinas','Leer')`

**UI lista:**
- Tabla: período, estado, pool, versión config, fechas.
- CTA crear: rango datetime + multi-select turnos (opcional) → POST → navegar a detalle.
- `definePageMeta({ middleware: 'auth', layout: 'dashboard' })` + header (`CrudPageHeader` o patrón caja).

**UI detalle:**
- Borrador: pool, versión config, advertencias sesiones abiertas, grupos con participantes (incluido toggle + motivo, pesos/montos MANUAL), acciones Recalcular / Actualizar config (mostrar diff) / Confirmar.
- Confirmada: solo lectura + Anular (motivo).
- Anulada: solo lectura.
- Tras mutaciones: reemplazar estado local con respuesta (no re-fetch lista completa innecesaria).
- Strings monetarios con `formatMonto`; inputs `inputmode="decimal"`.

- [ ] **Step 1: Composable espejo API**

- [ ] **Step 2: Página lista + nav dashboard**

- [ ] **Step 3: Página detalle**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(propinas): add liquidacion list and detail UI

EOF
)"
```

---

### Task 8: Docs + verificación E3

**Files:**
- Create: `docs/features/liquidacion-propinas-motor.md` (desde TEMPLATE)
- Modify: `docs/ESTADO.md`, `docs/README.md`, spec (E3 Done), este plan Status Done

- [ ] **Step 1: Feature doc** — overview, API, reglas confirmar/anular, mayores restos, fuera de alcance F.

- [ ] **Step 2: ESTADO + README + spec status**

- [ ] **Step 3: Suite propinas**

```bash
cd backend && npx jest src/modules/propinas --no-cache
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: mark liquidacion propinas E3 motor complete

EOF
)"
```

---

## Decisions (locked in this plan)

| Tema | Decisión |
|---|---|
| Elegibilidad tip | `creado_el` en `[fechaDesde, fechaHasta)` + `liquidacion_id IS NULL` + `monto_pagado > 0` + turno opcional |
| Ventas/cuentas métrica | Solo tips incluidos en `fuente` de esta liquidación (coherente con pool) |
| Reparto entre grupos | Mayores restos sobre `pool_total` con pesos = % grupo → invariante Σ montos grupo = pool |
| Sesiones abiertas | No bloquean; warning en detalle |
| FK tip→liquidación | Se asigna solo al confirmar |
| UI path | `/propinas/liquidaciones` (+ `/:id`), nav dashboard |

## Verification (manual post-E3)

1. Config 80/20; liquidar un día con tips; confirmar; tips quedan con `liquidacion_id`.
2. Dos borradores solapados; confirmar uno → el otro falla al confirmar.
3. Anular → tips libres; liquidación anulada inmutable.
4. Sesión que cruza límite de período → horas prorrateadas.
5. MANUAL MONTOS: Σ ≠ monto_grupo → error al confirmar.
