# Liquidación de Propinas E1 — Plan de Implementación (modelo base)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar congelados en BD los datos que E2/E3 necesitan para liquidar: `garzones.tipo`, snapshot de tipo en sesión y tip, `sesion_garzon_id`/`turno_id` en `venta_propina`, y las dos bases de venta.

**Architecture:** Extensiones mínimas sobre entidades existentes. `TipoGarzon` es enum TS + CHECK en SQL (no ENUM PG). Al iniciar sesión se congela `tipo_garzon`. Al cerrar mesa, `VentaPropinaService` recibe sesión/turno/tipo resueltos por `SalonesService`/`VentasService`. Bases `base_ventas_*` se setean al crear la venta. `liquidacion_id` se agrega nullable **sin FK** (la tabla de liquidaciones nace en E3).

**Tech Stack:** NestJS, TypeORM, PostgreSQL 15, Decimal.js, Jest, Nuxt 4, Vue 3, Nuxt UI v4.

**Spec:** `docs/superpowers/specs/2026-07-17-liquidacion-propinas-design.md` § E1.

**Planes siguientes:** E2 (config versionada) y E3 (motor + UI) en archivos aparte tras cerrar E1.

## Global Constraints

- Trabajar directamente sobre `main`; no crear ramas ni PRs.
- Desarrollo Docker-first; no agregar dependencias npm.
- `tenant_id` siempre del JWT, nunca del body.
- Toda PK/FK UUID declara `type: 'uuid'` explícito (ADR-004).
- Soft delete: `eliminado_el`, `creado_el`, `actualizado_el`.
- Dinero y porcentajes con Decimal.js / `numeric` string; porcentajes en decimal.
- Errores operativos → `400 Bad Request`.
- Esquema documental: `startup-pos.sql`; dev usa TypeORM `synchronize` (CHECKs/UNIQUE/FK compuestos deben ir también en SQL documental y, si hace falta, script de bootstrap o query raw post-sync).
- Actualizar `docs/ESTADO.md` y features en el commit final de E1.
- No implementar E2/E3 en este plan.

---

## Mapa de archivos

### Crear

- `backend/src/modules/garzones/enums/tipo-garzon.enum.ts`
- `backend/src/modules/garzones/dto/update-garzon.dto.ts` — si no existe campo `tipo` aún; o extender el update existente.

### Modificar

- `backend/src/modules/garzones/entities/garzon.entity.ts` — `tipo`
- `backend/src/modules/garzones/dto/create-garzon.dto.ts` — `tipo?`
- `backend/src/modules/garzones/garzones.service.ts` + `.spec.ts`
- `frontend/app/pages/configuracion/garzones.vue` — selector de tipo
- `frontend/app/composables/useGarzones.ts` (si existe) — tipo en interface
- `backend/src/modules/turnos/entities/sesion-garzon.entity.ts` — `tipoGarzon`
- `backend/src/modules/turnos/sesiones-garzon.service.ts` + `.spec.ts` — congelar tipo al iniciar
- `backend/src/modules/ventas/entities/venta.entity.ts` — `baseVentasTotalFinal`, `baseVentasSinImpuestos`
- `backend/src/modules/ventas/ventas.service.ts` + `.spec.ts` — set bases; pasar sesión a propina
- `backend/src/modules/propinas/entities/venta-propina.entity.ts` — columnas nuevas
- `backend/src/modules/propinas/venta-propina.service.ts` + `.spec.ts` — input extendido
- `backend/src/modules/ventas/dto/propina-cierre-mesa.dto.ts` — campos sesión/turno/tipo opcionales o resueltos en service
- `backend/src/modules/salones/salones.service.ts` + `.spec.ts` — resolver sesión activa y pasar al DTO
- `startup-pos.sql` — ALTER/CHECK/UNIQUE/índices + comentarios de backfill
- `docs/ESTADO.md`, `docs/features/garzones.md`, `docs/features/turnos-garzones.md`, `docs/features/salones-mesas.md` (o feature propinas si existe)
- Spec E: marcar E1 Done al cerrar (opcional en commit final)

---

### Task 1: `TipoGarzon` + `garzones.tipo`

**Files:**
- Create: `backend/src/modules/garzones/enums/tipo-garzon.enum.ts`
- Modify: `backend/src/modules/garzones/entities/garzon.entity.ts`
- Modify: `backend/src/modules/garzones/dto/create-garzon.dto.ts`
- Modify: `backend/src/modules/garzones/dto/update-garzon.dto.ts` (crear si no existe campo)
- Modify: `backend/src/modules/garzones/garzones.service.ts`
- Modify: `backend/src/modules/garzones/garzones.service.spec.ts`
- Modify: `startup-pos.sql` (sección `garzones`)
- Modify: `frontend/app/pages/configuracion/garzones.vue`

**Interfaces:**
- Produces: `enum TipoGarzon { GARZON='garzon', COCINA='cocina', BARRA='barra' }`; `Garzon.tipo: TipoGarzon`.
- Consumes: CRUD garzones existente.

- [ ] **Step 1: Escribir test fallido — crear garzón con tipo cocina**

En `garzones.service.spec.ts`, agregar:

```typescript
it('crear persiste tipo cocina', async () => {
  repo.create.mockImplementation((x) => x);
  repo.save.mockImplementation(async (x) => ({ ...x, id: 'g1' }));
  // mock bcrypt / pin generation igual que tests existentes
  const res = await service.crear(TENANT, { nombre: 'Ana', tipo: 'cocina' });
  expect(repo.create).toHaveBeenCalledWith(
    expect.objectContaining({ tipo: 'cocina' }),
  );
  expect(res.tipo).toBe('cocina');
});

it('crear sin tipo usa garzon por defecto', async () => {
  repo.create.mockImplementation((x) => x);
  repo.save.mockImplementation(async (x) => ({ ...x, id: 'g1' }));
  await service.crear(TENANT, { nombre: 'Pedro' });
  expect(repo.create).toHaveBeenCalledWith(
    expect.objectContaining({ tipo: 'garzon' }),
  );
});
```

- [ ] **Step 2: Correr test — debe fallar**

```bash
cd backend && npx jest src/modules/garzones/garzones.service.spec.ts --no-cache
```

Expected: FAIL (propiedad `tipo` inexistente / DTO rechaza).

- [ ] **Step 3: Implementar enum + entity + DTO + service**

```typescript
// backend/src/modules/garzones/enums/tipo-garzon.enum.ts
export enum TipoGarzon {
  GARZON = 'garzon',
  COCINA = 'cocina',
  BARRA = 'barra',
}
```

En `garzon.entity.ts`:

```typescript
@Column({ type: 'text', default: TipoGarzon.GARZON })
tipo: TipoGarzon;
```

En `CreateGarzonDto` / `UpdateGarzonDto`:

```typescript
@IsOptional()
@IsIn(Object.values(TipoGarzon))
tipo?: TipoGarzon;
```

En `crear`: `tipo: dto.tipo ?? TipoGarzon.GARZON`. En `actualizar`: si viene `tipo`, asignar. En `toPublico` / respuestas: incluir `tipo`.

`startup-pos.sql` en `garzones`:

```sql
tipo TEXT NOT NULL DEFAULT 'garzon',
CONSTRAINT chk_garzones_tipo CHECK (tipo IN ('garzon', 'cocina', 'barra'))
```

- [ ] **Step 4: UI — selector de tipo en configuración garzones**

En el form de crear/editar: `USelect` con opciones Garzón / Cocina / Barra; enviar `tipo` en body; mostrar badge/columna en tabla. Tokens semánticos Nuxt UI.

- [ ] **Step 5: Tests pasan + commit**

```bash
cd backend && npx jest src/modules/garzones/garzones.service.spec.ts --no-cache
```

```bash
git add backend/src/modules/garzones frontend/app/pages/configuracion/garzones.vue startup-pos.sql
git commit -m "$(cat <<'EOF'
feat(garzones): add tipo (garzon/cocina/barra) with CHECK

EOF
)"
```

---

### Task 2: Congelar `tipo_garzon` al iniciar sesión + UNIQUE para FK

**Files:**
- Modify: `backend/src/modules/turnos/entities/sesion-garzon.entity.ts`
- Modify: `backend/src/modules/turnos/sesiones-garzon.service.ts`
- Modify: `backend/src/modules/turnos/sesiones-garzon.service.spec.ts`
- Modify: `startup-pos.sql` (`sesiones_garzon`)

**Interfaces:**
- Produces: `SesionGarzon.tipoGarzon: TipoGarzon`; `SesionPublica.tipoGarzon`.
- Consumes: `GarzonesService.resolverGarzonPorPin` (el garzón ya trae `tipo` tras Task 1).

- [ ] **Step 1: Test fallido — iniciar copia tipo del garzón**

```typescript
it('iniciar congela tipo_garzon del garzón', async () => {
  garzones.resolverGarzonPorPin.mockResolvedValue({
    id: 'g1',
    nombre: 'Ana',
    tipo: 'cocina',
  });
  turnos.getActivoOrThrow.mockResolvedValue({ id: 't1', nombre: 'Noche' });
  sesionRepo.findOne.mockResolvedValue(null);
  sesionRepo.create.mockImplementation((x) => x);
  sesionRepo.save.mockImplementation(async (x) => ({
    ...x,
    id: 's1',
    inicioEl: new Date(),
    finEl: null,
    estado: 'abierta',
    origenCierre: null,
    cerradaPorUsuarioId: null,
  }));

  const res = await service.iniciar(TENANT, { pin: '123456', turnoId: 't1' });
  expect(sesionRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({ tipoGarzon: 'cocina' }),
  );
  expect(res.tipoGarzon).toBe('cocina');
});
```

- [ ] **Step 2: Correr — FAIL**

```bash
cd backend && npx jest src/modules/turnos/sesiones-garzon.service.spec.ts --no-cache
```

- [ ] **Step 3: Implementar**

Entity:

```typescript
@Column({ name: 'tipo_garzon', type: 'text' })
tipoGarzon: TipoGarzon;
```

En `iniciar`, tras resolver garzón:

```typescript
tipoGarzon: garzon.tipo ?? TipoGarzon.GARZON,
```

Incluir en `toPublico`, `mapListaRow`, SQL de `listarAbiertas`/`historial` (`s.tipo_garzon`).

`startup-pos.sql`:

```sql
tipo_garzon TEXT NOT NULL DEFAULT 'garzon',
CONSTRAINT chk_sesiones_tipo_garzon CHECK (tipo_garzon IN ('garzon','cocina','barra'))
```

UNIQUE de soporte FK (documental; TypeORM sync puede no crearlo — añadir también vía query en seeder/bootstrap si hace falta en dev):

```sql
CREATE UNIQUE INDEX uq_sesion_garzon_tenant_id_turno
  ON sesiones_garzon (tenant_id, sesion_garzon_id, turno_id);
```

Backfill documental:

```sql
UPDATE sesiones_garzon s
SET tipo_garzon = COALESCE(g.tipo, 'garzon')
FROM garzones g
WHERE g.garzon_id = s.garzon_id AND s.tipo_garzon IS DISTINCT FROM g.tipo;
-- (en migración real: ADD COLUMN ... DEFAULT 'garzon' luego backfill)
```

- [ ] **Step 4: Tests + commit**

```bash
cd backend && npx jest src/modules/turnos/sesiones-garzon.service.spec.ts --no-cache
git add backend/src/modules/turnos startup-pos.sql
git commit -m "$(cat <<'EOF'
feat(sesiones): freeze tipo_garzon on session start

EOF
)"
```

---

### Task 3: Bases de venta congeladas

**Files:**
- Modify: `backend/src/modules/ventas/entities/venta.entity.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts`
- Modify: `backend/src/modules/ventas/ventas.service.spec.ts` (mock create venta)
- Modify: `startup-pos.sql` (`ventas`)

**Interfaces:**
- Produces: `Venta.baseVentasTotalFinal: string`, `Venta.baseVentasSinImpuestos: string`.
- Consumes: `resultado.totales` del motor (`totalFinal`, `totalImpuestos`, `subtotalNeto`, descuentos, recargos).

- [ ] **Step 1: Test — create setea ambas bases**

Localizar el spec que mockea `manager.save(Venta, …)` / `crearEnTransaccion` y assert:

```typescript
expect(manager.create).toHaveBeenCalledWith(
  Venta,
  expect.objectContaining({
    totalFinal: expect.any(String),
    baseVentasTotalFinal: /* igual a totalFinal del mock */,
    baseVentasSinImpuestos: /* totalFinal - totalImpuestos */,
  }),
);
```

Si el spec actual no cubre el `create` de cabecera, agregar un unit test focalizado que espíe `manager.create` con totales fijos:

```typescript
// totales mock: totalFinal '11900', totalImpuestos '1900'
// → baseVentasTotalFinal '11900.0000', baseVentasSinImpuestos '10000.0000'
```

- [ ] **Step 2: FAIL luego implementar**

En entity:

```typescript
@Column({
  name: 'base_ventas_total_final',
  type: 'numeric',
  precision: 18,
  scale: 4,
})
baseVentasTotalFinal: string;

@Column({
  name: 'base_ventas_sin_impuestos',
  type: 'numeric',
  precision: 18,
  scale: 4,
})
baseVentasSinImpuestos: string;
```

En `crearEnTransaccion` al `manager.create(Venta, {…})`:

```typescript
const totalFinal = resultado.totales.totalFinal;
const totalImpuestos = resultado.totales.totalImpuestos;
const baseSinImpuestos = new Decimal(totalFinal)
  .minus(totalImpuestos)
  .toFixed(4);

// ...
totalFinal,
baseVentasTotalFinal: totalFinal,
baseVentasSinImpuestos: baseSinImpuestos,
```

(Alternativa equivalente documentada: `subtotalNeto − descuentos + recargos`; usar la misma fórmula en código y comentarios.)

`startup-pos.sql` en `ventas`:

```sql
"base_ventas_total_final"   NUMERIC(18,4) NOT NULL DEFAULT 0,
"base_ventas_sin_impuestos" NUMERIC(18,4) NOT NULL DEFAULT 0
```

Backfill documental:

```sql
UPDATE ventas SET
  base_ventas_total_final = total_final,
  base_ventas_sin_impuestos = total_final - total_impuestos
WHERE base_ventas_total_final = 0 AND total_final <> 0;
```

Exponer en `findOne` / listados si ya se mapean totales (agregar al response camelCase).

- [ ] **Step 3: Tests + commit**

```bash
cd backend && npx jest src/modules/ventas/ventas.service.spec.ts --no-cache
git add backend/src/modules/ventas startup-pos.sql
git commit -m "$(cat <<'EOF'
feat(ventas): freeze tip-distribution sales bases on create

EOF
)"
```

---

### Task 4: Extender `venta_propina` (sesión, turno, tipo, liquidacion_id)

**Files:**
- Modify: `backend/src/modules/propinas/entities/venta-propina.entity.ts`
- Modify: `backend/src/modules/propinas/venta-propina.service.ts`
- Modify: `backend/src/modules/propinas/venta-propina.service.spec.ts`
- Modify: `startup-pos.sql` (`venta_propina`)

**Interfaces:**
- Produces: `CrearVentaPropinaInput` extendido:

```typescript
export interface CrearVentaPropinaInput {
  tenantId: string;
  ventaId: string;
  garzonId: string;
  porcentajeSugerido: string;
  montoSugerido: string;
  montoPagado: string;
  sesionGarzonId: string | null;
  turnoId: string | null;
  tipoGarzon: TipoGarzon | null;
}
```

- `liquidacionId` queda `null` siempre en create (E3 lo setea).
- Consumes: `TipoGarzon`.

- [ ] **Step 1: Tests**

```typescript
it('persiste sesion, turno y tipo_garzon', async () => {
  const result = await service.crearEnTransaccion(manager, {
    tenantId: 't',
    ventaId: 'v',
    garzonId: 'g',
    porcentajeSugerido: '0.10',
    montoSugerido: '500',
    montoPagado: '500',
    sesionGarzonId: 's1',
    turnoId: 'tu1',
    tipoGarzon: TipoGarzon.GARZON,
  });
  expect(manager.create).toHaveBeenCalledWith(
    VentaPropina,
    expect.objectContaining({
      sesionGarzonId: 's1',
      turnoId: 'tu1',
      tipoGarzon: 'garzon',
      liquidacionId: null,
    }),
  );
  expect(result.sesionGarzonId).toBe('s1');
});

it('permite nulls en backfill/legado', async () => {
  await service.crearEnTransaccion(manager, {
    /* ... montos ... */
    sesionGarzonId: null,
    turnoId: null,
    tipoGarzon: null,
  });
  expect(manager.create).toHaveBeenCalledWith(
    VentaPropina,
    expect.objectContaining({
      sesionGarzonId: null,
      turnoId: null,
      tipoGarzon: null,
    }),
  );
});
```

- [ ] **Step 2: FAIL → entity + service**

Columnas:

```typescript
@Column({ name: 'sesion_garzon_id', type: 'uuid', nullable: true })
sesionGarzonId: string | null;

@Column({ name: 'turno_id', type: 'uuid', nullable: true })
turnoId: string | null;

@Column({ name: 'tipo_garzon', type: 'text', nullable: true })
tipoGarzon: TipoGarzon | null;

@Column({ name: 'liquidacion_id', type: 'uuid', nullable: true })
liquidacionId: string | null; // sin FK hasta E3
```

Invariante de escritura en service (defensa en app; BD refuerza con FK en SQL):

```typescript
if (
  (input.sesionGarzonId == null) !== (input.turnoId == null) ||
  (input.sesionGarzonId == null) !== (input.tipoGarzon == null)
) {
  throw new BadRequestException(
    'Sesión, turno y tipo de propina deben ir juntos o ser todos null',
  );
}
```

`startup-pos.sql`:

```sql
"sesion_garzon_id" UUID REFERENCES sesiones_garzon(sesion_garzon_id),
"turno_id"         UUID REFERENCES turnos(turno_id),
"tipo_garzon"      TEXT,
"liquidacion_id"   UUID,  -- FK se añade en E3
CONSTRAINT chk_venta_propina_tipo_garzon
  CHECK (tipo_garzon IS NULL OR tipo_garzon IN ('garzon','cocina','barra')),
CONSTRAINT chk_venta_propina_sesion_turno_parity
  CHECK (
    (sesion_garzon_id IS NULL AND turno_id IS NULL AND tipo_garzon IS NULL)
    OR (sesion_garzon_id IS NOT NULL AND turno_id IS NOT NULL AND tipo_garzon IS NOT NULL)
  )
```

FK compuesta (tras UNIQUE Task 2):

```sql
ALTER TABLE venta_propina
  ADD CONSTRAINT fk_venta_propina_sesion_turno
  FOREIGN KEY (tenant_id, sesion_garzon_id, turno_id)
  REFERENCES sesiones_garzon (tenant_id, sesion_garzon_id, turno_id);
```

Nota: en PostgreSQL la FK compuesta exige que las tres columnas del hijo sean NOT NULL **o** que se permita MATCH SIMPLE (nulls saltan la FK). Con MATCH SIMPLE (default), si `sesion_garzon_id` IS NULL la FK no se valida — OK para legado. Si sesión no-null, las tres deben coincidir con la fila de sesión.

Índices:

```sql
CREATE INDEX idx_venta_propina_liquidacion
  ON venta_propina (tenant_id, liquidacion_id);
CREATE INDEX idx_venta_propina_turno
  ON venta_propina (tenant_id, turno_id, creado_el);
```

- [ ] **Step 3: Actualizar callers internos de tests que construyen `CrearVentaPropinaInput`** (ventas/salones specs) con los tres nuevos campos (pueden ir `null` temporalmente hasta Task 5).

- [ ] **Step 4: Tests + commit**

```bash
cd backend && npx jest src/modules/propinas/venta-propina.service.spec.ts --no-cache
git add backend/src/modules/propinas startup-pos.sql
git commit -m "$(cat <<'EOF'
feat(propinas): persist session, shift and tipo on tip rows

EOF
)"
```

---

### Task 5: Wiring cierre de mesa → tip con sesión activa

**Files:**
- Modify: `backend/src/modules/ventas/dto/propina-cierre-mesa.dto.ts`
- Modify: `backend/src/modules/salones/salones.service.ts`
- Modify: `backend/src/modules/salones/salones.service.spec.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts`
- Modify: `backend/src/modules/ventas/ventas.service.spec.ts`

**Interfaces:**
- Extender `PropinaCierreMesaDto`:

```typescript
@IsOptional() @IsUUID() sesionGarzonId?: string;
@IsOptional() @IsUUID() turnoId?: string;
@IsOptional() @IsIn(Object.values(TipoGarzon)) tipoGarzon?: TipoGarzon;
```

- `SalonesService.cerrarCuenta` resuelve sesión abierta del responsable y las rellena.
- `VentasService.crearEnTransaccion` pasa esos campos a `VentaPropinaService`.

- [ ] **Step 1: Test salones — propinaCierreMesa incluye sesión**

```typescript
it('pasa sesion/turno/tipo del responsable al crear venta', async () => {
  // mock cuenta.garzonResponsableId = 'g1'
  // mock query/repo sesión abierta: { id:'s1', turnoId:'tu1', tipoGarzon:'garzon' }
  await service.cerrarCuenta(TENANT, USER, CUENTA, {
    pin: PIN,
    propinaMonto: '500',
    pagos: [{ metodoPagoId: 'mp', monto: '4000' }],
  });
  expect(ventas.crearEnTransaccion).toHaveBeenCalledWith(
    manager,
    TENANT,
    USER,
    expect.objectContaining({
      propinaCierreMesa: expect.objectContaining({
        garzonId: 'g1',
        sesionGarzonId: 's1',
        turnoId: 'tu1',
        tipoGarzon: 'garzon',
      }),
    }),
  );
});
```

Si no hay sesión abierta: `400` (ya existe `assertSesionAbierta` en el flujo de PIN — reutilizar; el tip siempre debe poder congelar sesión en operación normal).

- [ ] **Step 2: Implementar resolución en `cerrarCuenta`**

Tras validar PIN/sesión:

```typescript
const sesion = await this.sesiones.assertSesionAbierta(...) 
// o findOne abierta por garzonResponsableId
propinaCierreMesa: {
  ...,
  sesionGarzonId: sesion.id,
  turnoId: sesion.turnoId,
  tipoGarzon: sesion.tipoGarzon,
}
```

En `ventas.service.ts`:

```typescript
const ventaPropina = await this.ventaPropinaService.crearEnTransaccion(manager, {
  ...,
  sesionGarzonId: tip.sesionGarzonId ?? null,
  turnoId: tip.turnoId ?? null,
  tipoGarzon: tip.tipoGarzon ?? null,
});
```

- [ ] **Step 3: `findOne` de venta incluye campos nuevos de propina**

En el SELECT de `venta_propina` agregar `sesion_garzon_id`, `turno_id`, `tipo_garzon`, `liquidacion_id` y mapearlos en el objeto `propina` del response. Actualizar `VentaDetalleDrawer` types (solo lectura; UI mínima: mostrar tipo/turno si útil, YAGNI si no hay espacio — al menos tipar).

- [ ] **Step 4: Tests + commit**

```bash
cd backend && npx jest src/modules/salones/salones.service.spec.ts src/modules/ventas/ventas.service.spec.ts src/modules/propinas/venta-propina.service.spec.ts --no-cache
git add backend/src/modules/salones backend/src/modules/ventas backend/src/modules/propinas frontend/app/components/ventas/VentaDetalleDrawer.vue
git commit -m "$(cat <<'EOF'
feat(salones): attach open session snapshot to tip on table close

EOF
)"
```

---

### Task 6: Docs + ESTADO + verificación E1

**Files:**
- Modify: `docs/ESTADO.md`
- Modify: `docs/features/garzones.md`
- Modify: `docs/features/turnos-garzones.md`
- Modify: `docs/features/salones-mesas.md` (propina + sesión/turno congelados)
- Modify: `docs/superpowers/specs/2026-07-17-liquidacion-propinas-design.md` — status E1 Done / nota

- [ ] **Step 1: Actualizar docs**

Fila en ESTADO:

```markdown
| Liquidación propinas E1 — modelo base (tipo garzón, tip+sesión, bases venta) | ✅ Implementado (2026-07-17) |
```

Documentar CHECK de tipos, congelación en sesión/tip, bases, y que `liquidacion_id` espera E3.

- [ ] **Step 2: Suite relevante verde**

```bash
cd backend && npx jest src/modules/garzones src/modules/turnos/sesiones-garzon.service.spec.ts src/modules/propinas src/modules/ventas/ventas.service.spec.ts src/modules/salones/salones.service.spec.ts --no-cache
```

Expected: PASS.

- [ ] **Step 3: Commit final E1**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: mark liquidacion propinas E1 model complete

EOF
)"
```

---

## Verificación manual E1

1. Crear garzón tipo Cocina; iniciar sesión → `sesiones_garzon.tipo_garzon = cocina`.
2. Cambiar tipo del garzón a Barra; sesión abierta sigue `cocina`.
3. Cerrar mesa con tip → `venta_propina` tiene `sesion_garzon_id`, `turno_id`, `tipo_garzon`, `liquidacion_id` NULL.
4. Venta nueva tiene `base_ventas_total_final = total_final` y `base_ventas_sin_impuestos = total_final − impuestos`.

---

## Fuera de E1 (próximos planes)

- **E2:** `propina_configuracion` versionada, grupos %, criterios, MANUAL pesos, CRUD + UI config, seed 100% garzones.
- **E3:** liquidaciones, fuentes, snapshot, mayores restos, confirmar/anular, UI.

---

## Self-review (plan vs spec E1)

| Requisito spec E1 | Task |
|---|---|
| `garzones.tipo` + CHECK | T1 |
| `sesiones_garzon.tipo_garzon` al iniciar | T2 |
| UNIQUE soporte FK | T2 |
| `venta_propina` sesión/turno/tipo/liquidacion_id | T4 |
| Paridad null + FK compuesta | T4 |
| Bases en `ventas` | T3 |
| Wiring cierre mesa | T5 |
| Docs | T6 |
| Config grupos / liquidaciones | E2/E3 (excluido) |
