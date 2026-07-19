# Catálogo de Impuestos del Sistema + Clasificación Tributaria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Status:** Draft
- **Date:** 2026-07-19
- **Owner:** Cesar Matheus
- **Spec:** `docs/superpowers/specs/2026-07-19-catalogo-impuestos-sistema-design.md`

**Goal:** Catálogo de impuestos oficiales por país (compartido, solo-seeder) conviviendo con impuestos personalizados por tenant, más clasificación tributaria `afecto|exento` en items, congelada por línea de venta; `exento` suprime solo los impuestos `tipo='iva'`.

**Architecture:** Enfoque "misma tabla": `impuestos.tenant_id` pasa a nullable y se agrega `pais_id` + `tipo` con CHECK de exclusividad. `ImpuestosService.findAll` devuelve la unión (tenant ∪ país del tenant) con `origen` derivado; el motor de precios filtra impuestos `tipo='iva'` en líneas exentas; el seeder siembra el IVA de Chile como impuesto del sistema y remapea idempotentemente los duplicados por tenant.

**Tech Stack:** NestJS + TypeORM (synchronize en dev), PostgreSQL 15, Decimal.js, Nuxt 4 + @nuxt/ui v4, Jest.

## Global Constraints

- Trabajar y commitear **directamente sobre `main`** (etapa de desarrollo, sin ramas/PRs).
- **Decimal.js** para todo dinero/porcentaje; porcentajes en decimal (`0.19` = 19%), nunca `number` nativo.
- **Soft delete en todo**: `eliminado_el`; toda lectura filtra `IS NULL`.
- **`type: 'uuid'` explícito** en toda columna PK/FK UUID (ADR-004).
- **`tenant_id` siempre del token** (`req.user.tenantId`), nunca del body.
- Backend: antes de escribir código invocar la skill `nestjs-best-practices`; frontend: invocar `nuxt-ui`.
- Frontend: `useApiFetch` (no `$fetch`/axios); tras mutación **no re-fetch** (merge local); tokens semánticos de Nuxt UI (`text-muted`, etc.), campos decimales como string con `inputmode="decimal"`.
- `startup-pos.sql` es referencia del esquema: actualizarlo en el mismo commit que cambia una tabla.
- Comandos de verificación backend: `cd backend && npm test`, `npx tsc --noEmit`, `npm run lint`.
- IDs de seed: patrón `550e8400-e29b-41d4-a716-446655440XXX`. **Nuevo ID reservado por este plan: `…440280` (IVA sistema Chile)** — verificado libre.
- ID país Chile en seed: `550e8400-e29b-41d4-a716-446655440000`.

---

### Task 1: Impuestos — entity, DTOs y service con catálogo del sistema

**Files:**
- Modify: `backend/src/modules/impuestos/entities/impuesto.entity.ts`
- Modify: `backend/src/modules/impuestos/dto/create-impuesto.dto.ts`
- Modify: `backend/src/modules/impuestos/dto/update-impuesto.dto.ts`
- Modify: `backend/src/modules/impuestos/impuestos.service.ts`
- Modify: `startup-pos.sql:374-383` (tabla `impuestos`)
- Test: `backend/src/modules/impuestos/impuestos.service.spec.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `Impuesto` con `tenantId: string | null`, `paisId: string | null`, `tipo: string` (`'iva' | 'otro'`). `ImpuestosService.findAll(tenantId): Promise<ImpuestoConOrigen[]>` donde `export type ImpuestoConOrigen = Impuesto & { origen: 'sistema' | 'personalizado' }`. `CreateImpuestoDto`/`UpdateImpuestoDto` aceptan `tipo?: string`. Tasks 2, 3 y 5 dependen de estos nombres exactos.

- [ ] **Step 1: Escribir los tests que fallan**

En `impuestos.service.spec.ts`: agregar mock de DataSource y reemplazar el `describe('findAll')`. Cambios al setup (el resto del archivo queda igual):

```typescript
// imports nuevos
import { getDataSourceToken } from '@nestjs/typeorm';

const PAIS = 'pais-uuid';

// dentro de beforeEach, junto a repo:
let dataSource: { query: jest.Mock };
// ...
dataSource = {
  query: jest.fn().mockResolvedValue([{ pais_id: PAIS }]),
};
// y en providers:
{ provide: getDataSourceToken(), useValue: dataSource },
```

Reemplazar el describe `findAll` y agregar test de `create` con tipo:

```typescript
describe('findAll', () => {
  it('lista la unión de impuestos del tenant y del país, con origen', async () => {
    const rows = [
      { id: 'sys-1', tenantId: null, paisId: PAIS, nombre: 'IVA', tipo: 'iva' },
      { id: IMP, tenantId: TENANT, paisId: null, nombre: 'Propina', tipo: 'otro' },
    ];
    repo.find.mockResolvedValue(rows);

    const result = await service.findAll(TENANT);

    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('pais_id'), [TENANT]);
    expect(repo.find).toHaveBeenCalledWith({
      where: [{ tenantId: TENANT }, { paisId: PAIS }],
      order: { nombre: 'ASC' },
    });
    expect(result[0].origen).toBe('sistema');
    expect(result[1].origen).toBe('personalizado');
  });

  it('sin país resuelto, lista solo los del tenant', async () => {
    dataSource.query.mockResolvedValue([]);
    repo.find.mockResolvedValue([]);

    await service.findAll(TENANT);

    expect(repo.find).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      order: { nombre: 'ASC' },
    });
  });
});
```

En `describe('create')`, el test existente `'crea un impuesto con porcentaje en decimal'` ahora espera `tipo: 'otro'` en el `repo.create`:

```typescript
expect(repo.create).toHaveBeenCalledWith({
  tenantId: TENANT,
  nombre: 'IVA',
  porcentaje: '0.19',
  activo: true,
  tipo: 'otro',
});
```

Y agregar:

```typescript
it('acepta tipo iva explícito', async () => {
  await service.create(TENANT, { nombre: 'IVA propio', porcentaje: '0.19', tipo: 'iva' });
  expect(repo.create).toHaveBeenCalledWith(
    expect.objectContaining({ tipo: 'iva' }),
  );
});
```

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `cd backend && npm test -- impuestos.service`
Expected: FAIL (falta provider DataSource / `origen` undefined / `tipo` no presente en create).

- [ ] **Step 3: Implementar entity, DTOs y service**

`impuesto.entity.ts` — reemplazar las columnas `tenantId` y agregar `paisId`/`tipo` + CHECK:

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Check,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('impuestos')
// Sistema: (tenant_id NULL, pais_id set) · Personalizado: (tenant_id set, pais_id NULL)
@Check('CHK_impuestos_scope', '("tenant_id" IS NULL) <> ("pais_id" IS NULL)')
export class Impuesto {
  @PrimaryGeneratedColumn('uuid', { name: 'impuesto_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ name: 'pais_id', type: 'uuid', nullable: true })
  paisId: string | null;

  @Column({ type: 'text', default: 'otro' })
  tipo: string; // 'iva' (suprimido en líneas exentas) | 'otro'

  // ... nombre, porcentaje, activo, timestamps: sin cambios
}
```

`create-impuesto.dto.ts` — agregar (importar `IsIn`):

```typescript
@IsOptional()
@IsIn(['iva', 'otro'])
tipo?: string;
```

`update-impuesto.dto.ts` — agregar el mismo campo `tipo` opcional.

`impuestos.service.ts` — inyectar DataSource, exponer `ImpuestoConOrigen`, reescribir `findAll` y extender `create`:

```typescript
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

export type ImpuestoConOrigen = Impuesto & {
  origen: 'sistema' | 'personalizado';
};

// constructor: agregar
@InjectDataSource()
private readonly dataSource: DataSource,

/** País del tenant: tenants.provincia_id → provincia.pais_id. */
private async paisIdDeTenant(tenantId: string): Promise<string | null> {
  const rows: { pais_id: string }[] = await this.dataSource.query(
    `SELECT p.pais_id
       FROM tenants t
       JOIN provincia p ON p.provincia_id = t.provincia_id AND p.eliminado_el IS NULL
      WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
    [tenantId],
  );
  return rows[0]?.pais_id ?? null;
}

async findAll(tenantId: string): Promise<ImpuestoConOrigen[]> {
  const paisId = await this.paisIdDeTenant(tenantId);
  const impuestos = await this.impuestoRepo.find({
    where: paisId ? [{ tenantId }, { paisId }] : { tenantId },
    order: { nombre: 'ASC' },
  });
  return impuestos.map((i) =>
    Object.assign(i, {
      origen: (i.tenantId ? 'personalizado' : 'sistema') as
        | 'sistema'
        | 'personalizado',
    }),
  );
}
```

En `create`, agregar `tipo: dto.tipo ?? 'otro'` al objeto de `this.impuestoRepo.create({...})`. `update`/`remove` no cambian (su `WHERE { id, tenantId }` ya excluye filas del sistema, que tienen `tenant_id NULL` → 404).

`startup-pos.sql` — reemplazar la definición de `impuestos`:

```sql
-- Impuestos: del sistema (tenant_id NULL + pais_id, sembrados por seeder, no editables
-- por tenants) o personalizados (tenant_id set). tipo 'iva' se suprime en líneas exentas.
CREATE TABLE "impuestos" (
  "impuesto_id"    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID         REFERENCES "tenants" ("tenant_id"),
  "pais_id"        UUID         REFERENCES "pais" ("pais_id"),
  "nombre"         TEXT         NOT NULL,
  "porcentaje"     NUMERIC(7,4) NOT NULL,   -- decimal: 0.19 = 19%
  "tipo"           TEXT         NOT NULL DEFAULT 'otro',  -- 'iva' | 'otro'
  "activo"         BOOLEAN      NOT NULL DEFAULT true,
  "creado_el"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el"   TIMESTAMPTZ,
  CONSTRAINT "CHK_impuestos_scope" CHECK (("tenant_id" IS NULL) <> ("pais_id" IS NULL))
);
```

- [ ] **Step 4: Correr tests y verificar que pasan**

Run: `cd backend && npm test -- impuestos.service`
Expected: PASS. Luego `npm test` completo — los specs de `calculo-precios` y `ventas` mockean `ImpuestosService`, deben seguir verdes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/impuestos startup-pos.sql
git commit -m "feat(impuestos): catálogo del sistema por país (tenant_id nullable + pais_id + tipo)"
```

---

### Task 2: Items — clasificación tributaria + aceptar impuestos del sistema

**Files:**
- Modify: `backend/src/modules/items/entities/item.entity.ts`
- Modify: `backend/src/modules/items/dto/create-item.dto.ts`
- Modify: `backend/src/modules/items/dto/update-item.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts` (ItemRow:32, BASE_QUERY:91, mapRow:112, create:310, update:638, validarReglas:2027)
- Modify: `startup-pos.sql:483` (tabla `items`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: catálogo sistema de Task 1 (query directa a `impuestos.pais_id`).
- Produces: `items.service` `findOne`/`findAll` devuelven `clasificacionTributaria: string` (`'afecto' | 'exento'`); `create`/`update` la aceptan y la incluyen en la respuesta/patch. Tasks 3, 4 y 7 consumen `clasificacionTributaria` con ese nombre exacto.

- [ ] **Step 1: Escribir los tests que fallan**

En `items.service.spec.ts`, dentro de `describe('create')` (usa los mocks existentes `managerMock`/`dataSource`):

```typescript
it('persiste la clasificación tributaria y la devuelve en la respuesta', async () => {
  managerMock.query
    .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
    .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
    .mockResolvedValueOnce([]); // INSERT item_producto
  inventarioServiceMock.registrarMovimiento.mockResolvedValue({
    movimientoId: 'mov-0',
    stockAnterior: '0',
    stockResultante: '5',
  });

  const result = await service.create(TENANT, 'user-uuid', {
    ...baseDtoProducto,
    clasificacionTributaria: 'exento',
  } as any);

  const insertCall = managerMock.query.mock.calls.find((c) =>
    (c[0] as string).includes('INSERT INTO items'),
  );
  expect(insertCall?.[1]).toContain('exento');
  expect(result).toMatchObject({ clasificacionTributaria: 'exento' });
});

it('default afecto cuando no se envía clasificación', async () => {
  managerMock.query
    .mockResolvedValueOnce([{ '?column?': 1 }])
    .mockResolvedValueOnce([{ item_id: ITEM_ID }])
    .mockResolvedValueOnce([]);
  inventarioServiceMock.registrarMovimiento.mockResolvedValue({
    movimientoId: 'mov-0',
    stockAnterior: '0',
    stockResultante: '5',
  });

  const result = await service.create(TENANT, 'user-uuid', baseDtoProducto);

  expect(result).toMatchObject({ clasificacionTributaria: 'afecto' });
});

it('valida impuestos aceptando los del catálogo del sistema (pais_id)', async () => {
  managerMock.query
    .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
    .mockResolvedValueOnce([{ cnt: '1' }]) // validarImpuestos
    .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
    .mockResolvedValue([]); // extensión + item_impuestos
  inventarioServiceMock.registrarMovimiento.mockResolvedValue({
    movimientoId: 'mov-0',
    stockAnterior: '0',
    stockResultante: '5',
  });

  await service.create(TENANT, 'user-uuid', {
    ...baseDtoProducto,
    impuestosIds: ['iva-sistema'],
  } as any);

  const valCall = managerMock.query.mock.calls[1];
  expect(valCall[0]).toContain('pais_id');
  expect(valCall[1]).toEqual([['iva-sistema'], TENANT]);
});
```

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `cd backend && npm test -- items.service`
Expected: FAIL (columna/respuesta `clasificacionTributaria` inexistente; la validación de impuestos actual exige `tenant_id = $2` sin cláusula `pais_id`).

- [ ] **Step 3: Implementar**

`item.entity.ts` — agregar después de `tipo`:

```typescript
@Column({ name: 'clasificacion_tributaria', type: 'text', default: 'afecto' })
clasificacionTributaria: string; // 'afecto' | 'exento' — tratamiento fiscal (IVA)
```

`create-item.dto.ts` y `update-item.dto.ts` — agregar (importar `IsIn` si falta):

```typescript
@IsOptional()
@IsIn(['afecto', 'exento'])
clasificacionTributaria?: string;
```

`items.service.ts`:
1. `ItemRow` (línea 32): agregar `clasificacion_tributaria: string;`.
2. `BASE_QUERY` (línea 93): en el SELECT, tras `i.precio_base, i.precio_incluye_impuesto,` agregar `i.clasificacion_tributaria,`.
3. `mapRow` (línea 112): agregar `clasificacionTributaria: r.clasificacion_tributaria,`.
4. `create` (línea 392): el `INSERT INTO items` pasa a incluir la columna y el parámetro `$10`:

```typescript
`INSERT INTO items
   (tenant_id, moneda_id, categoria_id, nombre, descripcion,
    precio_base, precio_incluye_impuesto, activo, tipo, clasificacion_tributaria)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
 RETURNING item_id, creado_el`,
[
  // ... los 9 existentes,
  dto.clasificacionTributaria ?? 'afecto',
],
```

   y en el objeto de respuesta del create, agregar `clasificacionTributaria: dto.clasificacionTributaria ?? 'afecto',`.
5. `update` — en la zona de `setClauses` (tras el bloque de `dto.activo`, línea 761):

```typescript
if (dto.clasificacionTributaria !== undefined) {
  setClauses.push(`clasificacion_tributaria = $${idx++}`);
  params.push(dto.clasificacionTributaria);
  patch.clasificacionTributaria = dto.clasificacionTributaria;
}
```
6. Validación de impuestos con catálogo del sistema: en `create` y `update`, reemplazar las llamadas `this.validarReglas(manager, tenantId, dto.impuestosIds, 'impuestos', 'impuesto_id')` por `this.validarImpuestos(manager, tenantId, dto.impuestosIds)`, y agregar el método junto a `validarReglas` (línea 2027):

```typescript
/** Impuestos válidos: personalizados del tenant o del catálogo del sistema del país del tenant. */
private async validarImpuestos(
  manager: EntityManager,
  tenantId: string,
  ids: string[],
): Promise<void> {
  const rows: { cnt: string }[] = await manager.query(
    `SELECT COUNT(*) AS cnt FROM impuestos i
      WHERE i.impuesto_id = ANY($1::uuid[]) AND i.eliminado_el IS NULL
        AND (i.tenant_id = $2
             OR i.pais_id = (SELECT p.pais_id
                               FROM tenants t
                               JOIN provincia p ON p.provincia_id = t.provincia_id
                              WHERE t.tenant_id = $2 AND t.eliminado_el IS NULL))`,
    [ids, tenantId],
  );
  if (parseInt(rows[0].cnt) !== ids.length) {
    throw new BadRequestException(
      'Uno o más impuestos no están disponibles para este tenant',
    );
  }
}
```

`startup-pos.sql` — en `CREATE TABLE "items"`, tras la columna `"tipo"`:

```sql
  "clasificacion_tributaria" TEXT        NOT NULL DEFAULT 'afecto',  -- 'afecto' | 'exento'
```

- [ ] **Step 4: Correr tests y verificar que pasan**

Run: `cd backend && npm test -- items.service` → PASS; luego `npm test` completo → verde.
Nota: los tests de `findAll`/`findOne` existentes que fixturean filas SQL no declaran `clasificacion_tributaria` → `mapRow` la mapea `undefined`, no rompe aserciones `toMatchObject`; si alguna aserción estricta falla, agregar `clasificacion_tributaria: 'afecto'` al fixture.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/items startup-pos.sql
git commit -m "feat(items): clasificación tributaria afecto/exento + impuestos del sistema en items"
```

---

### Task 3: Motor de precios — exento suprime impuestos tipo IVA

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts` (impuestoMap:55, resolverLinea:132)
- Test: `backend/src/modules/calculo-precios/calculo-precios.service.spec.ts`

**Interfaces:**
- Consumes: `ImpuestosService.findAll` → filas con `tipo` (Task 1); `itemsService.findOne` → `clasificacionTributaria` (Task 2).
- Produces: sin cambios de firma — `calcular()` devuelve el mismo `ResultadoVenta`. El engine (`calculo-precios.engine.ts`) NO se toca: el filtrado ocurre al resolver la línea, por lo que el desbruteo (`precioIncluyeImpuesto`) tampoco divide por IVA en líneas exentas (correcto: un precio exento no trae IVA embebido).

- [ ] **Step 1: Escribir los tests que fallan**

En `calculo-precios.service.spec.ts`:

1. Al helper `item` (línea 29) agregar `clasificacionTributaria: 'afecto',` al objeto base.
2. Al mock de `impuestosService.findAll` (línea 42), reemplazar por dos impuestos con `tipo`:

```typescript
impuestosService = {
  findAll: jest.fn().mockResolvedValue([
    { id: 'imp-1', nombre: 'IVA', porcentaje: '0.19', tipo: 'iva' },
    { id: 'imp-2', nombre: 'Adicional', porcentaje: '0.10', tipo: 'otro' },
  ]),
};
```

3. Tests nuevos:

```typescript
it('línea exenta: omite impuestos tipo iva y conserva los otros', async () => {
  itemsService.findOne.mockResolvedValueOnce(
    item({
      clasificacionTributaria: 'exento',
      impuestosIds: ['imp-1', 'imp-2'],
      descuentosIds: [],
    }),
  );
  const r = await service.calcular(TENANT, {
    lineas: [{ itemId: 'item-1', cantidad: '1' }],
  });
  expect(r.lineas[0].impuestoAplicado).toBe('10.000000'); // solo imp-2 (0.10 * 100)
  expect(r.lineas[0].totalLinea).toBe('110.000000');
});

it('línea afecta: aplica todos los impuestos asociados', async () => {
  itemsService.findOne.mockResolvedValueOnce(
    item({ impuestosIds: ['imp-1', 'imp-2'], descuentosIds: [] }),
  );
  const r = await service.calcular(TENANT, {
    lineas: [{ itemId: 'item-1', cantidad: '1' }],
  });
  expect(r.lineas[0].impuestoAplicado).toBe('29.000000'); // 19 + 10
});
```

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `cd backend && npm test -- calculo-precios.service`
Expected: el test exento FALLA con `impuestoAplicado = '29.000000'` (hoy aplica ambos).

- [ ] **Step 3: Implementar el filtrado en el service**

`calculo-precios.service.ts`:

1. `impuestoMap` (línea 55) pasa a llevar `tipo`:

```typescript
const impuestoMap = new Map<string, ImpuestoResuelto & { tipo: string }>(
  impuestos.map((i) => [
    i.id,
    { id: i.id, nombre: i.nombre, porcentaje: i.porcentaje, tipo: i.tipo },
  ]),
);
```

   (propagar el tipo del parámetro `impuestoMap` en las firmas de `calcular` → `resolverLinea`).
2. En `resolverLinea` (línea 160), filtrar tras resolver:

```typescript
// Exento = exento de IVA: se suprimen solo los impuestos tipo 'iva';
// los adicionales ('otro') aplican siempre (DL 825 / IndExe del DTE).
impuestos: impuestoIds
  .map((id) => this.requerir(impuestoMap, id, 'impuesto'))
  .filter(
    (imp) =>
      item.clasificacionTributaria !== 'exento' || imp.tipo !== 'iva',
  ),
```

- [ ] **Step 4: Correr tests y verificar que pasan**

Run: `cd backend && npm test -- calculo-precios` → PASS (service + engine spec sin cambios). `npm test` completo verde.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/calculo-precios
git commit -m "feat(calculo-precios): exento suprime impuestos tipo iva en la línea"
```

---

### Task 4: Ventas — congelar la clasificación tributaria por línea

**Files:**
- Modify: `backend/src/modules/ventas/entities/venta-detalle.entity.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts` (detalles venta:293-326; NC: `validarDevolucionesReembolso`:770 y detalle NC:595-609)
- Modify: `startup-pos.sql:753` (tabla `venta_detalles`)
- Test: `backend/src/modules/ventas/ventas.service.spec.ts`

**Interfaces:**
- Consumes: `itemsService.findOne(...).clasificacionTributaria` (Task 2).
- Produces: `VentaDetalle.clasificacionTributaria: string` congelada (`'afecto' | 'exento'`).

- [ ] **Step 1: Escribir el test que falla**

En `ventas.service.spec.ts`, dentro de `describe('crear()')` (patrón del test `'congela bases de venta al crear'`, línea 239):

```typescript
it('congela la clasificación tributaria del item en el detalle', async () => {
  itemsService.findOne.mockResolvedValueOnce({
    ...mockItem,
    clasificacionTributaria: 'exento',
  } as any);
  const manager = buildManagerMock();
  dataSourceMock.transaction.mockImplementationOnce(
    (cb: (m: typeof manager) => unknown) => cb(manager),
  );

  await service.crear(TENANT_ID, USUARIO_ID, baseDto);

  const detalleCreate = manager.create.mock.calls.find(
    (call) => call[0] === VentaDetalle,
  );
  expect(detalleCreate?.[1]).toEqual(
    expect.objectContaining({ clasificacionTributaria: 'exento' }),
  );
});
```

(Importar `VentaDetalle` en el spec si no está; agregar `clasificacionTributaria: 'afecto'` al `mockItem` base del spec.)

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npm test -- ventas.service`
Expected: FAIL — el `manager.create(VentaDetalle, ...)` no incluye `clasificacionTributaria`.

- [ ] **Step 3: Implementar**

`venta-detalle.entity.ts` — tras `descripcion`:

```typescript
// Snapshot fiscal congelado al vender (equivalente del IndExe por línea del DTE).
@Column({
  name: 'clasificacion_tributaria',
  type: 'text',
  default: 'afecto',
})
clasificacionTributaria: string; // 'afecto' | 'exento'
```

`ventas.service.ts`:
1. En el `manager.create(VentaDetalle, {...})` de `crear()` (línea 306), agregar:

```typescript
clasificacionTributaria: item.clasificacionTributaria ?? 'afecto',
```

   (`item` ya está desestructurado de `lineasConversion[i]`).
2. Nota de crédito — propagar el snapshot original: en `validarDevolucionesReembolso` (línea 797) agregar `d.clasificacion_tributaria` al SELECT, `clasificacion_tributaria: string;` al tipo de fila, y `clasificacionTributaria: string;` al tipo de retorno + mapping final. En el `manager.create(VentaDetalle, ...)` de la NC (línea 597), agregar `clasificacionTributaria: linea.clasificacionTributaria ?? 'afecto',`.

`startup-pos.sql` — en `CREATE TABLE "venta_detalles"`, tras `"descripcion"`:

```sql
  "clasificacion_tributaria" TEXT        NOT NULL DEFAULT 'afecto',  -- snapshot fiscal por línea
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && npm test -- ventas.service` → PASS; `npm test` completo, `npx tsc --noEmit`, `npm run lint` → verdes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ventas startup-pos.sql
git commit -m "feat(ventas): congelar clasificación tributaria por línea (venta y nota de crédito)"
```

---

### Task 5: Seeder — IVA del sistema + remapeo idempotente de duplicados

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts` (`seedImpuestos`:1920, `seedItemsMonedaUnidadMatrix` const `IVA_19`:2450)

**Interfaces:**
- Consumes: entity `Impuesto` con `paisId`/`tipo` (Task 1).
- Produces: impuesto del sistema `IVA` Chile con ID fijo `550e8400-e29b-41d4-a716-446655440280`; método privado `remapImpuestosOficialesDuplicados(): Promise<void>`.

- [ ] **Step 1: Reescribir `seedImpuestos`**

Reemplazar el método completo (elimina los IVA por tenant `…440112`/`…440113`):

```typescript
/** Catálogo de impuestos del sistema (por país) + remapeo de duplicados legados. */
private async seedImpuestos(): Promise<void> {
  const CHILE = '550e8400-e29b-41d4-a716-446655440000';
  const IVA_CL = '550e8400-e29b-41d4-a716-446655440280';

  const exists = await this.impuestoRepo.findOne({ where: { id: IVA_CL } });
  if (!exists) {
    await this.impuestoRepo.save(
      this.impuestoRepo.create({
        id: IVA_CL,
        tenantId: null,
        paisId: CHILE,
        nombre: 'IVA',
        porcentaje: '0.19',
        tipo: 'iva',
        activo: true,
      }),
    );
  }

  await this.remapImpuestosOficialesDuplicados();
}

/**
 * Migra impuestos personalizados que duplican un impuesto oficial del país del
 * tenant (mismo porcentaje y nombre con "IVA"): remapea item_impuestos al del
 * sistema y soft-deletea el duplicado. Idempotente: los duplicados quedan
 * soft-deleteados y no vuelven a matchear. Los snapshots de ventas_impuestos
 * NO se tocan (ya congelaron porcentaje y valor).
 */
private async remapImpuestosOficialesDuplicados(): Promise<void> {
  const sistemas: {
    impuesto_id: string;
    pais_id: string;
    porcentaje: string;
  }[] = await this.dataSource.query(
    `SELECT impuesto_id, pais_id, porcentaje FROM impuestos
      WHERE tenant_id IS NULL AND tipo = 'iva' AND eliminado_el IS NULL`,
  );

  for (const sys of sistemas) {
    const duplicados: { impuesto_id: string }[] = await this.dataSource.query(
      `SELECT i.impuesto_id
         FROM impuestos i
         JOIN tenants t ON t.tenant_id = i.tenant_id
         JOIN provincia p ON p.provincia_id = t.provincia_id
        WHERE p.pais_id = $1
          AND i.eliminado_el IS NULL
          AND i.porcentaje = $2::numeric
          AND i.nombre ILIKE '%iva%'`,
      [sys.pais_id, sys.porcentaje],
    );

    for (const dup of duplicados) {
      await this.dataSource.query(
        `INSERT INTO item_impuestos (item_id, impuesto_id)
         SELECT item_id, $1 FROM item_impuestos WHERE impuesto_id = $2
         ON CONFLICT DO NOTHING`,
        [sys.impuesto_id, dup.impuesto_id],
      );
      await this.dataSource.query(
        `DELETE FROM item_impuestos WHERE impuesto_id = $1`,
        [dup.impuesto_id],
      );
      await this.dataSource.query(
        `UPDATE impuestos SET eliminado_el = NOW() WHERE impuesto_id = $1`,
        [dup.impuesto_id],
      );
    }
  }
}
```

- [ ] **Step 2: Actualizar las referencias al ID viejo**

En `seedItemsMonedaUnidadMatrix` (línea 2450):

```typescript
const IVA_19 = '550e8400-e29b-41d4-a716-446655440280'; // IVA sistema Chile
```

Verificar que no queden referencias: `grep -rn "440112\|440113" backend/src` → sin resultados.

- [ ] **Step 3: Verificar tests y arranque**

Run: `cd backend && npm test && npx tsc --noEmit` → verdes.

Verificación manual con la BD existente (remapeo + idempotencia):

```bash
docker-compose up -d --build backend
# esperar el arranque (seeder corre en bootstrap), luego:
docker-compose exec -T db psql -U postgres -d startup_pos -c \
  "SELECT nombre, tenant_id, pais_id, tipo, eliminado_el IS NOT NULL AS borrado FROM impuestos ORDER BY nombre;"
```

Expected: fila `IVA` con `tenant_id NULL`, `pais_id` Chile, `tipo iva`; los `IVA 19%` legados con `borrado = t`; `item_impuestos` sin filas apuntando a impuestos borrados:

```bash
docker-compose exec -T db psql -U postgres -d startup_pos -c \
  "SELECT COUNT(*) FROM item_impuestos ii JOIN impuestos i ON i.impuesto_id = ii.impuesto_id WHERE i.eliminado_el IS NOT NULL;"
```

Expected: `0`. Reiniciar el backend (`docker-compose restart backend`) y repetir: mismos resultados (idempotente). Ajustar usuario/nombre de BD a los del `.env` si difieren.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/seeder
git commit -m "feat(seeder): IVA sistema Chile + remapeo idempotente de IVA duplicados por tenant"
```

---

### Task 6: Frontend — página de impuestos con origen y tipo

**Files:**
- Modify: `frontend/app/pages/configuracion/impuestos.vue`

**Interfaces:**
- Consumes: `GET /impuestos` → filas con `origen: 'sistema' | 'personalizado'` y `tipo: 'iva' | 'otro'` (Task 1); mutaciones aceptan `tipo`.
- Produces: UI solo-lectura para filas del sistema; form de personalizados con campo tipo.

> Invocar la skill `nuxt-ui` antes de escribir el código.

- [ ] **Step 1: Interface y form**

```typescript
interface Impuesto {
  id: string
  nombre: string
  porcentaje: string
  activo: boolean
  tipo: 'iva' | 'otro'
  origen: 'sistema' | 'personalizado'
}

const tipoOpts = [
  { label: 'IVA', value: 'iva' },
  { label: 'Otro', value: 'otro' },
]

const emptyForm = () => ({
  nombre: '',
  porcentaje: '',
  activo: true,
  tipo: 'otro' as 'iva' | 'otro',
})
```

`abrirEditar` copia también `tipo: imp.tipo`; `guardar()` incluye `tipo: form.value.tipo` en el body. Guard defensivo al inicio de `abrirEditar`, `toggleActivo` y el flujo de eliminar: `if (imp.origen === 'sistema') return`.

- [ ] **Step 2: Template**

- En la celda de nombre (`#nombre-cell`), junto al `CrudListItem`, badge de origen:

```vue
<UBadge
  :label="row.original.origen === 'sistema' ? 'Sistema' : 'Personalizado'"
  :color="row.original.origen === 'sistema' ? 'info' : 'neutral'"
  variant="soft"
  size="sm"
/>
```

- Acciones (editar/eliminar) y `USwitch` de activo: renderizarlas solo para personalizados (`v-if="row.original.origen === 'personalizado'"`); para filas sistema mostrar `<span class="text-xs text-muted">Catálogo oficial</span>`.
- En el drawer del form, antes del switch de activo:

```vue
<UFormField label="Tipo" help="Los impuestos tipo IVA no se aplican a items exentos.">
  <USelect v-model="form.tipo" :items="tipoOpts" class="w-full" />
</UFormField>
```

- Actualizar la descripción del `CrudPageHeader`: `"Impuestos oficiales del país (Sistema) e impuestos propios del tenant (en decimal: 0.19 = 19%)."`

- [ ] **Step 3: Verificación manual**

Login como admin → `/configuracion/impuestos`: el IVA aparece con badge "Sistema" sin acciones; crear un impuesto personalizado tipo "Otro" funciona y aparece sin re-fetch; editar/eliminar solo disponible en personalizados.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/configuracion/impuestos.vue
git commit -m "feat(impuestos): UI con catálogo del sistema (badge origen, tipo, solo-lectura oficial)"
```

---

### Task 7: Frontend — form de items con clasificación tributaria y origen en selector

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue` (interface Item:~40, form:289, cargarCatalogos:520-551, abrirEditar:581, payload:715, template reglas:1517-1532)

**Interfaces:**
- Consumes: `GET /impuestos` con `origen` (Task 1); items API con `clasificacionTributaria` (Task 2).
- Produces: form de item envía `clasificacionTributaria: 'afecto' | 'exento'`.

> Invocar la skill `nuxt-ui` antes de escribir el código.

- [ ] **Step 1: Script**

1. Interface `Item`: agregar `clasificacionTributaria?: 'afecto' | 'exento'`.
2. Form inicial (línea 289): agregar `clasificacionTributaria: 'afecto' as 'afecto' | 'exento',`.
3. `cargarCatalogos` (línea 548) — etiqueta de origen:

```typescript
impuestosOpts.value = impuestos
  .filter(i => i.activo)
  .map(i => ({
    label: i.origen === 'sistema' ? `${i.nombre} (Sistema)` : i.nombre,
    value: i.id,
  }))
```

4. `abrirEditar` (línea 586): agregar `clasificacionTributaria: detalle.clasificacionTributaria ?? 'afecto',`.
5. Payload de `guardar` (junto a `payload.impuestosIds`, línea 715): `payload.clasificacionTributaria = form.value.clasificacionTributaria`.

- [ ] **Step 2: Template**

En la sección "Reglas asociadas" (línea 1520), antes del `UFormField` de Impuestos:

```vue
<UFormField
  label="Clasificación tributaria"
  help="Exento: no se aplica IVA (los demás impuestos sí). Se congela en cada venta."
>
  <USelect
    v-model="form.clasificacionTributaria"
    :items="[
      { label: 'Afecto', value: 'afecto' },
      { label: 'Exento', value: 'exento' },
    ]"
    class="w-full"
  />
</UFormField>
```

- [ ] **Step 3: Verificación manual**

`/configuracion/items`: crear un producto exento con el IVA "(Sistema)" seleccionado → en el POS su línea no suma IVA; editar un item existente muestra "Afecto" por default; el selector de impuestos distingue "(Sistema)".

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/configuracion/items.vue
git commit -m "feat(items): clasificación tributaria en el form y origen en el selector de impuestos"
```

---

### Task 8: Documentación viva

**Files:**
- Create: `docs/adr/011-catalogo-impuestos-sistema.md`
- Create: `docs/features/impuestos.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/adr/README.md`, `docs/README.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md`

**Interfaces:**
- Consumes: decisiones del spec `docs/superpowers/specs/2026-07-19-catalogo-impuestos-sistema-design.md`.
- Produces: documentación consistente con el código de Tasks 1-7.

- [ ] **Step 1: ADR-011**

Crear `docs/adr/011-catalogo-impuestos-sistema.md` siguiendo el formato de los ADR existentes (Contexto / Decisión / Consecuencias), cubriendo: (a) catálogo del sistema en la misma tabla `impuestos` con `tenant_id`/`pais_id` excluyentes y CHECK (alternativas descartadas: tabla separada con doble FK, copia-por-referencia); (b) semántica `exento` = exento de IVA solamente (`tipo 'iva'` suprimido, `'otro'` aplica siempre; base legal DL 825 + `IndExe`/`CodImpAdic` del formato DTE SII, alineado con ADR-010); (c) administración solo por seeder + remapeo idempotente de duplicados. Agregar la fila al índice `docs/adr/README.md`.

- [ ] **Step 2: Feature doc + índices**

Crear `docs/features/impuestos.md` desde el TEMPLATE: modelo (sistema vs personalizado, campos `pais_id`/`tipo`), clasificación tributaria en items y su congelamiento en `venta_detalles`, comportamiento del motor con exento, flujo del selector en items y la página de configuración. Linkear en `docs/README.md`.

- [ ] **Step 3: ESTADO.md y PRODUCTO.md**

- `docs/ESTADO.md`: fila nueva "Catálogo de impuestos del sistema + clasificación tributaria — ✅ 2026-07-19" (seguir el formato de la tabla).
- `docs/PRODUCTO.md`: en la sección de impuestos/reglas de negocio, documentar: impuestos oficiales por país (no editables), personalizados por tenant, y la regla "exento suprime solo IVA; se congela por línea al vender".

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: ADR-011 catálogo impuestos sistema + feature doc, ESTADO y PRODUCTO"
```

---

## Verificación final (tras Task 8)

- [ ] `cd backend && npm test && npx tsc --noEmit && npm run lint` → todo verde.
- [ ] `docker-compose down -v && docker-compose up -d --build` (seed desde cero) → smoke: login, `/configuracion/impuestos` muestra IVA "Sistema", venta POS de un item afecto suma IVA y uno exento no.
- [ ] Segundo arranque del backend sin `down -v` → sin cambios nuevos en `impuestos` (idempotencia).
