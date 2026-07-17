# Liquidación de Propinas E2 — Plan de Implementación (config distribución)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar la configuración versionada de distribución de propinas por tenant: raíz + grupos por `tipo_garzon` (% + criterio + base + pesos MANUAL), API GET/PUT con validación Σ%=100, seed default, y UI de configuración.

**Status:** Done (2026-07-17)

**Architecture:** Tres tablas nuevas bajo `PropinasModule`. La raíz `propina_configuracion` es 1:1 por tenant (`tenant_id` UNIQUE); cada `PUT` reemplaza grupos/pesos en TX e incrementa `version`. Los grupos referencian `TipoGarzon` de E1. El motor de liquidación (E3) solo **lee** esta config para snapshotearla — no se implementa E3 aquí.

**Tech Stack:** NestJS, TypeORM, PostgreSQL 15, Decimal.js, Jest, Nuxt 4, Vue 3, Nuxt UI v4.

**Spec:** `docs/superpowers/specs/2026-07-17-liquidacion-propinas-design.md` § E2.

**Prerequisito:** E1 Done (`garzones.tipo`, sesión/tip snapshot, bases venta).

**Planes siguientes:** E3 (motor + UI liquidación) en archivo aparte tras cerrar E2.

## Global Constraints

- Trabajar directamente sobre `main`; no crear ramas ni PRs.
- Desarrollo Docker-first; no agregar dependencias npm.
- `tenant_id` siempre del JWT, nunca del body.
- Toda PK/FK UUID declara `type: 'uuid'` explícito (ADR-004).
- Soft delete: `eliminado_el`, `creado_el`, `actualizado_el`.
- Dinero y porcentajes con Decimal.js / `numeric` string; **porcentajes en decimal** (`0.80` = 80%, nunca `80`).
- Errores operativos → `400 Bad Request`.
- Esquema documental: `startup-pos.sql`; CHECKs/UNIQUE en SQL + entities TypeORM.
- Actualizar `docs/ESTADO.md` y feature doc en el commit final de E2.
- No implementar E3 (liquidaciones, motor, UI liquidar) en este plan.
- IDs fijos seeder: siguiente libre desde `550e8400-e29b-41d4-a716-446655440257`.

---

## Mapa de archivos

### Crear

- `backend/src/modules/propinas/enums/criterio-distribucion.enum.ts`
- `backend/src/modules/propinas/enums/base-ventas-grupo.enum.ts`
- `backend/src/modules/propinas/enums/manual-modo.enum.ts`
- `backend/src/modules/propinas/entities/propina-configuracion.entity.ts`
- `backend/src/modules/propinas/entities/propina-grupo-distribucion.entity.ts`
- `backend/src/modules/propinas/entities/propina-grupo-peso-manual.entity.ts`
- `backend/src/modules/propinas/dto/update-distribucion.dto.ts`
- `backend/src/modules/propinas/propina-distribucion.service.ts`
- `backend/src/modules/propinas/propina-distribucion.service.spec.ts`
- `backend/src/modules/propinas/propina-distribucion.controller.ts`
- `docs/features/liquidacion-propinas-config.md` (desde TEMPLATE)
- `frontend/app/composables/usePropinaDistribucion.ts`
- `frontend/app/pages/configuracion/propinas-distribucion.vue`

### Modificar

- `backend/src/modules/propinas/propinas.module.ts` — entities, controller, service
- `backend/src/app.module.ts` — entities en TypeORM root si aplica
- `backend/src/modules/seeder/seeder.service.ts` + `seeder.module.ts` — módulo Propinas, permisos, seed config Paris
- `backend/src/modules/tenants/tenants.service.ts` — al crear tenant: seed config default
- `startup-pos.sql` — CREATE TABLE + CHECKs + índices
- `frontend/app/pages/configuracion.vue` — nav item
- `docs/ESTADO.md`, `docs/README.md`, spec E status E2 Done

---

### Task 1: Enums + entities + SQL documental

**Files:**
- Create: enums + 3 entities listados arriba
- Modify: `startup-pos.sql`
- Modify: `propinas.module.ts` + `app.module.ts` (si entities van en forRoot)

**Interfaces:**
- Produces:

```typescript
export enum CriterioDistribucion {
  VENTAS_NETAS = 'VENTAS_NETAS',
  HORAS_TRABAJADAS = 'HORAS_TRABAJADAS',
  PARTES_IGUALES = 'PARTES_IGUALES',
  CANTIDAD_CUENTAS = 'CANTIDAD_CUENTAS',
  MANUAL = 'MANUAL',
}

export enum BaseVentasGrupo {
  TOTAL_FINAL = 'TOTAL_FINAL',
  BASE_SIN_IMPUESTOS = 'BASE_SIN_IMPUESTOS',
}

export enum ManualModo {
  PESOS = 'PESOS',
  MONTOS = 'MONTOS',
}
```

- Entities: `PropinaConfiguracion`, `PropinaGrupoDistribucion`, `PropinaGrupoPesoManual` con soft delete y `type: 'uuid'` en PKs/FKs.

- [ ] **Step 1: Crear enums**

```typescript
// criterio-distribucion.enum.ts, base-ventas-grupo.enum.ts, manual-modo.enum.ts
// valores exactos arriba
```

- [ ] **Step 2: Crear entities**

`PropinaConfiguracion`:

```typescript
@Entity('propina_configuracion')
@Index('uq_propina_config_tenant', ['tenantId'], { unique: true, where: '"eliminado_el" IS NULL' })
export class PropinaConfiguracion {
  @PrimaryGeneratedColumn('uuid', { name: 'propina_configuracion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'actualizado_por', type: 'uuid', nullable: true })
  actualizadoPor: string | null;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
```

`PropinaGrupoDistribucion`:

```typescript
@Entity('propina_grupo_distribucion')
@Index('uq_propina_grupo_tipo_activo', ['tenantId', 'tipoGarzon'], {
  unique: true,
  where: `"activo" = true AND "eliminado_el" IS NULL`,
})
export class PropinaGrupoDistribucion {
  @PrimaryGeneratedColumn('uuid', { name: 'propina_grupo_distribucion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'configuracion_id', type: 'uuid' })
  configuracionId: string;

  @Column({ name: 'tipo_garzon', type: 'text' })
  tipoGarzon: TipoGarzon;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'numeric', precision: 10, scale: 6 })
  porcentaje: string;

  @Column({ type: 'text' })
  criterio: CriterioDistribucion;

  @Column({
    name: 'base_ventas',
    type: 'text',
    default: BaseVentasGrupo.TOTAL_FINAL,
  })
  baseVentas: BaseVentasGrupo;

  @Column({ name: 'manual_modo', type: 'text', nullable: true })
  manualModo: ManualModo | null;

  @Column({ default: true })
  activo: boolean;

  @Column({ type: 'int', default: 0 })
  orden: number;

  // timestamps + soft delete
}
```

`PropinaGrupoPesoManual`:

```typescript
@Entity('propina_grupo_peso_manual')
@Index('uq_propina_peso_grupo_garzon', ['grupoId', 'garzonId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class PropinaGrupoPesoManual {
  @PrimaryGeneratedColumn('uuid', { name: 'propina_grupo_peso_manual_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'grupo_id', type: 'uuid' })
  grupoId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  peso: string;

  // timestamps + soft delete
}
```

- [ ] **Step 3: SQL en `startup-pos.sql`**

```sql
CREATE TABLE propina_configuracion (
  propina_configuracion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  version INT NOT NULL DEFAULT 1,
  actualizado_por UUID REFERENCES usuarios(usuario_id),
  creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eliminado_el TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_propina_config_tenant
  ON propina_configuracion (tenant_id) WHERE eliminado_el IS NULL;

CREATE TABLE propina_grupo_distribucion (
  propina_grupo_distribucion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  configuracion_id UUID NOT NULL REFERENCES propina_configuracion(propina_configuracion_id),
  tipo_garzon TEXT NOT NULL,
  nombre TEXT NOT NULL,
  porcentaje NUMERIC(10,6) NOT NULL,
  criterio TEXT NOT NULL,
  base_ventas TEXT NOT NULL DEFAULT 'TOTAL_FINAL',
  manual_modo TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  orden INT NOT NULL DEFAULT 0,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eliminado_el TIMESTAMPTZ,
  CONSTRAINT chk_propina_grupo_tipo CHECK (tipo_garzon IN ('garzon','cocina','barra')),
  CONSTRAINT chk_propina_grupo_criterio CHECK (criterio IN (
    'VENTAS_NETAS','HORAS_TRABAJADAS','PARTES_IGUALES','CANTIDAD_CUENTAS','MANUAL'
  )),
  CONSTRAINT chk_propina_grupo_base CHECK (base_ventas IN ('TOTAL_FINAL','BASE_SIN_IMPUESTOS')),
  CONSTRAINT chk_propina_grupo_manual_modo CHECK (
    manual_modo IS NULL OR manual_modo IN ('PESOS','MONTOS')
  ),
  CONSTRAINT chk_propina_grupo_manual_parity CHECK (
    (criterio = 'MANUAL' AND manual_modo IS NOT NULL)
    OR (criterio <> 'MANUAL' AND manual_modo IS NULL)
  ),
  CONSTRAINT chk_propina_grupo_porcentaje CHECK (porcentaje >= 0 AND porcentaje <= 1)
);
CREATE UNIQUE INDEX uq_propina_grupo_tipo_activo
  ON propina_grupo_distribucion (tenant_id, tipo_garzon)
  WHERE activo = true AND eliminado_el IS NULL;

CREATE TABLE propina_grupo_peso_manual (
  propina_grupo_peso_manual_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  grupo_id UUID NOT NULL REFERENCES propina_grupo_distribucion(propina_grupo_distribucion_id),
  garzon_id UUID NOT NULL REFERENCES garzones(garzon_id),
  peso NUMERIC(18,4) NOT NULL,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eliminado_el TIMESTAMPTZ,
  CONSTRAINT chk_propina_peso_positivo CHECK (peso > 0)
);
CREATE UNIQUE INDEX uq_propina_peso_grupo_garzon
  ON propina_grupo_peso_manual (grupo_id, garzon_id) WHERE eliminado_el IS NULL;
```

- [ ] **Step 4: Registrar en module + commit**

```bash
git add backend/src/modules/propinas startup-pos.sql backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(propinas): add distribution config entities and SQL

EOF
)"
```

---

### Task 2: Service GET/PUT + validaciones (TDD)

**Files:**
- Create: `propina-distribucion.service.ts` + `.spec.ts` + `dto/update-distribucion.dto.ts`

**Interfaces:**

```typescript
export interface DistribucionPublica {
  id: string;
  version: number;
  actualizadoPor: string | null;
  actualizadoEl: Date;
  grupos: GrupoDistribucionPublico[];
}

export interface GrupoDistribucionPublico {
  id: string;
  tipoGarzon: TipoGarzon;
  nombre: string;
  porcentaje: string;
  criterio: CriterioDistribucion;
  baseVentas: BaseVentasGrupo;
  manualModo: ManualModo | null;
  activo: boolean;
  orden: number;
  pesos: { garzonId: string; peso: string }[];
}

export interface UpdateDistribucionDto {
  grupos: {
    tipoGarzon: TipoGarzon;
    nombre: string;
    porcentaje: string; // @IsNumberString
    criterio: CriterioDistribucion;
    baseVentas?: BaseVentasGrupo;
    manualModo?: ManualModo | null;
    activo?: boolean;
    orden?: number;
    pesos?: { garzonId: string; peso: string }[];
  }[];
}
```

- Consumes: entities Task 1, `TipoGarzon`.
- Produces: `obtener(tenantId)`, `reemplazar(tenantId, usuarioId, dto)`, `asegurarDefault(tenantId)` (para seed/tenant create).

- [ ] **Step 1: Tests fallidos**

En `propina-distribucion.service.spec.ts`:

```typescript
it('obtener crea default si no existe (garzon 100% PARTES_IGUALES)', async () => { /* ... */ });

it('reemplazar valida Σ porcentaje activos = 1.0000', async () => {
  await expect(
    service.reemplazar(TENANT, USER, {
      grupos: [
        { tipoGarzon: 'garzon', nombre: 'G', porcentaje: '0.80', criterio: 'PARTES_IGUALES' },
        { tipoGarzon: 'cocina', nombre: 'C', porcentaje: '0.10', criterio: 'PARTES_IGUALES' },
      ],
    }),
  ).rejects.toThrow(BadRequestException);
});

it('reemplazar incrementa version y reemplaza grupos', async () => {
  // seed v1 → PUT 80/20 → version 2, dos grupos
});

it('rechaza dos grupos activos con mismo tipo_garzon', async () => { /* ... */ });

it('MANUAL exige manualModo; no-MANUAL exige manualModo null', async () => { /* ... */ });

it('MANUAL + PESOS acepta pesos; MANUAL + MONTOS rechaza pesos en config', async () => {
  // MONTOS: pesos solo en liquidación (E3); en config E2 pesos solo si PESOS
});

it('baseVentas solo relevante con VENTAS_NETAS (default TOTAL_FINAL ok)', async () => { /* ... */ });
```

Validación Σ%: `new Decimal(sum).toFixed(4) === '1.0000'` (tolerancia: exactamente 4 decimales de la suma de los enviados, o comparar con `equals(1)` tras sumar con Decimal).

- [ ] **Step 2: Correr — FAIL**

```bash
cd backend && npx jest src/modules/propinas/propina-distribucion.service.spec.ts --no-cache
```

- [ ] **Step 3: Implementar service**

Lógica `reemplazar` (TX):

1. Validar DTO (tipos, MANUAL parity, pesos solo si `criterio=MANUAL && manualModo=PESOS`).
2. Filtrar `activo !== false`; Σ `porcentaje` de activos = `1`.
3. Tipos únicos entre activos.
4. `FOR UPDATE` / lock raíz por `tenant_id` (crear si no existe vía `asegurarDefault`).
5. Soft-delete grupos previos + pesos previos del tenant para esa config.
6. Insertar nuevos grupos + pesos.
7. `version += 1`, `actualizadoPor = usuarioId`.
8. Return `obtener`.

`asegurarDefault(tenantId)`:

```typescript
// si no hay raíz: create version=1 + grupo {
//   tipoGarzon: GARZON, nombre: 'Garzones', porcentaje: '1.000000',
//   criterio: PARTES_IGUALES, baseVentas: TOTAL_FINAL, manualModo: null, activo: true, orden: 0
// }
```

`obtener`: si no existe → `asegurarDefault` luego load con joins/pesos.

DTO con `class-validator`: `@ValidateNested`, `@Type`, `@IsIn(Object.values(...))`, `@IsNumberString()` para porcentaje/peso.

- [ ] **Step 4: Tests PASS + commit**

```bash
cd backend && npx jest src/modules/propinas/propina-distribucion.service.spec.ts --no-cache
git add backend/src/modules/propinas
git commit -m "$(cat <<'EOF'
feat(propinas): distribution config GET/PUT with 100% validation

EOF
)"
```

---

### Task 3: Controller + RBAC módulo Propinas

**Files:**
- Create: `propina-distribucion.controller.ts`
- Modify: `propinas.module.ts`
- Modify: `seeder.service.ts` (modulos_app, permisos, modulo_app_permisos, tenant_modulos Paris)

**Interfaces:**
- Routes:
  - `GET /propinas/distribucion` → `@RequiresPermiso('Propinas', 'Leer')`
  - `PUT /propinas/distribucion` → `@RequiresPermiso('Propinas', 'Configurar')`
- Seed IDs fijos:

| Recurso | UUID |
|---|---|
| ModuloApp Propinas | `...440257` |
| Permiso Configurar | `...440258` |
| Permiso Liquidar | `...440259` |
| map Leer | `...440260` |
| map Configurar | `...440261` |
| map Liquidar | `...440262` |
| tenant_modulo Paris→Propinas | `...440263` |

(Leer ya existe: `...440012`.)

- [ ] **Step 1: Controller**

```typescript
@Controller('propinas')
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
export class PropinaDistribucionController {
  @Get('distribucion')
  @RequiresPermiso('Propinas', 'Leer')
  obtener(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.service.obtener(user.tenantId);
  }

  @Put('distribucion')
  @RequiresPermiso('Propinas', 'Configurar')
  reemplazar(@Req() req: Request, @Body() dto: UpdateDistribucionDto) {
    const user = req.user as { tenantId: string; sub: string };
    return this.service.reemplazar(user.tenantId, user.sub, dto);
  }
}
```

Confirmar forma de `req.user` (puede ser `userId` en vez de `sub` — copiar patrón de otro controller del repo).

- [ ] **Step 2: Seed módulo + permisos**

En `seedModulosApp`:

```typescript
{
  moduloAppId: '550e8400-e29b-41d4-a716-446655440257',
  nombre: 'Propinas',
  url: '/propinas',
  icono: 'mdi-cash-plus',
  tieneConfiguracion: true,
},
```

En `seedPermisos`: agregar `Configurar` y `Liquidar` (Liquidar se usará en E3; sembrarlo ya evita migración RBAC parcial).

En `seedModuloAppPermisos`: mapear Propinas→Leer, Configurar, Liquidar.

En `seedTenantModulos` (Paris): contratar Propinas (`...440263`).

Admin fijo ya recibe todos los permisos de módulos contratados — no hace falta `roles_permisos_modulos` extra para admin.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/propinas backend/src/modules/seeder
git commit -m "$(cat <<'EOF'
feat(propinas): expose distribution API with Propinas RBAC module

EOF
)"
```

---

### Task 4: Seed default al crear tenant + seed Paris config

**Files:**
- Modify: `tenants.service.ts` (create)
- Modify: `seeder.service.ts` (método `seedPropinaConfiguracion`)
- Modify: `seeder.module.ts` (entities TypeOrm)

**Interfaces:**
- Al crear tenant (junto a fórmula + caja virtual): llamar `PropinaDistribucionService.asegurarDefault` **o** insert raw equivalente en la misma TX del create.
Preferir inyección del service / lógica compartida estática para no duplicar.

- [ ] **Step 1: Test tenants (si existe spec de create) o unit del seed**

Si `tenants.service.spec.ts` cubre `create`, assert que se inserta `propina_configuracion`. Si no, test de `asegurarDefault` ya cubre; verificar manualmente en seeder Paris:

```typescript
// IDs: config ...440264, grupo ...440265
// tenant Paris id existente
```

- [ ] **Step 2: Implementar**

En `TenantsService.create`, tras caja virtual:

```typescript
const config = manager.create(PropinaConfiguracion, {
  tenantId: savedTenant.id,
  version: 1,
  actualizadoPor: null,
});
const savedConfig = await manager.save(PropinaConfiguracion, config);
await manager.save(
  PropinaGrupoDistribucion,
  manager.create(PropinaGrupoDistribucion, {
    tenantId: savedTenant.id,
    configuracionId: savedConfig.id,
    tipoGarzon: TipoGarzon.GARZON,
    nombre: 'Garzones',
    porcentaje: '1.000000',
    criterio: CriterioDistribucion.PARTES_IGUALES,
    baseVentas: BaseVentasGrupo.TOTAL_FINAL,
    manualModo: null,
    activo: true,
    orden: 0,
  }),
);
```

Registrar entities en `TenantsModule` / TypeOrm forFeature.

Seeder Paris: idempotente `seedPropinaConfiguracion` con IDs fijos.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/tenants backend/src/modules/seeder backend/src/modules/propinas
git commit -m "$(cat <<'EOF'
feat(propinas): seed default distribution config on tenant create

EOF
)"
```

---

### Task 5: Frontend — composable + página config

**Files:**
- Create: `usePropinaDistribucion.ts`, `propinas-distribucion.vue`
- Modify: `configuracion.vue` (nav)

**Interfaces:**
- Espejo de `DistribucionPublica`.
- Tras PUT: reemplazar `ref` local con respuesta (anti-patrón: no re-fetch).

- [ ] **Step 1: Composable**

```typescript
export function usePropinaDistribucion() {
  const apiUrl = useRuntimeConfig().public.apiUrl
  const obtener = () => useApiFetch<DistribucionPublica>(`${apiUrl}/propinas/distribucion`)
  const reemplazar = (body: UpdateDistribucionBody) =>
    useApiFetch<DistribucionPublica>(`${apiUrl}/propinas/distribucion`, {
      method: 'PUT',
      body,
    })
  return { obtener, reemplazar }
}
```

- [ ] **Step 2: Página UI**

`pages/configuracion/propinas-distribucion.vue`:

- Header: título "Distribución de propinas" + badge `v${version}`.
- Lista editable de grupos: tipo (USelect), nombre, % (UInput `inputmode="decimal"` string), criterio, base (si VENTAS_NETAS), manualModo (si MANUAL), activo, orden.
- Si MANUAL + PESOS: sublista de pesos (selector garzón + peso string).
- Footer: suma % en vivo (Decimal); CTA Guardar deshabilitado si ≠ 100% o loading.
- Toast error con `e.data.message`.
- Tokens semánticos Nuxt UI (`text-muted`, `bg-default`, etc.).
- Permiso UI: mostrar nav solo si admin o tiene `Propinas:Configurar` / `Propinas:Leer` (seguir patrón de `configuracion.vue`).

Nav en `configuracion.vue`:

```typescript
{ label: 'Propinas', icon: 'i-lucide-hand-coins', to: '/configuracion/propinas-distribucion' }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/composables/usePropinaDistribucion.ts \
  frontend/app/pages/configuracion/propinas-distribucion.vue \
  frontend/app/pages/configuracion.vue
git commit -m "$(cat <<'EOF'
feat(frontend): propinas distribution config page

EOF
)"
```

---

### Task 6: Docs + verificación E2

**Files:**
- Create: `docs/features/liquidacion-propinas-config.md`
- Modify: `docs/ESTADO.md`, `docs/README.md`
- Modify: spec → Status E2 Done

- [ ] **Step 1: Docs**

Fila ESTADO:

```markdown
| Liquidación propinas E2 — config distribución versionada (grupos %, criterios, MANUAL pesos) | ✅ Implementado (2026-07-17) |
```

Feature: tablas, reglas Σ=100, API, seed, UI, permiso `Propinas:Configurar`. Nota: liquidación E3 pendiente.

- [ ] **Step 2: Suite verde**

```bash
cd backend && npx jest src/modules/propinas --no-cache
```

Expected: PASS (incluye venta-propina + distribucion).

- [ ] **Step 3: Commit final**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: mark liquidacion propinas E2 config complete

EOF
)"
```

---

## Verificación manual E2

1. Login admin Paris → Configuración → Propinas: ver v1, grupo Garzones 100% PARTES_IGUALES.
2. Guardar 80/20 (garzon VENTAS_NETAS + cocina PARTES_IGUALES) → version 2; recargar confirma.
3. Intentar 70/20 → 400 (suma ≠ 100).
4. MANUAL + PESOS con 2 pesos; MANUAL sin modo → 400.
5. Crear tenant nuevo → nace con config default.

---

## Fuera de E2 (E3)

- Tablas `liquidacion_propinas*` + motor + UI liquidar.
- Uso de permiso `Propinas:Liquidar`.
- Snapshot / actualizar-config / confirmar / anular.

---

## Self-review (plan vs spec E2)

| Requisito spec E2 | Task |
|---|---|
| `propina_configuracion` versionada | T1–T2 |
| `propina_grupo_distribucion` | T1–T2 |
| `propina_grupo_peso_manual` | T1–T2 |
| Σ% = 100; tipo único activo | T2 |
| MANUAL PESOS vs MONTOS (pesos solo PESOS en config) | T2 |
| GET/PUT `/propinas/distribucion` | T3 |
| Permiso `Propinas:Configurar` (+ Leer/Liquidar seed) | T3 |
| Seed default 100% garzon PARTES_IGUALES | T4 |
| Seed al crear tenant | T4 |
| UI config | T5 |
| Docs | T6 |
| Motor liquidación | E3 (excluido) |
