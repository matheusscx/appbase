# Simulador de impacto de costos — Implementation Plan

**Status**: Done  
**Date**: 2026-07-15  
**Owner**: Cesar Matheus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar recetas con costo cacheado desfasado respecto a sus insumos, mostrar simulación (costo/margen/precio sugerido) en modal post-cambio y bandeja, y permitir aplicar o descartar de forma explícita.

**Architecture:** Columna `costo_propuesto_omitido` en `item_receta`. Lógica en `ItemsService` (misma fórmula que `validarYCostearIngredientes`). Endpoints: `GET/POST` bajo `@Controller('recetas')` + `GET /items/:id/recetas-afectadas`. Detección al vuelo; FE encadena el GET tras compra/`PATCH` de costo. Sin módulo Nest nuevo ni tabla de pendientes.

**Tech Stack:** NestJS + TypeORM (`synchronize: true` en dev), PostgreSQL 15, Decimal.js, Jest + supertest, Nuxt 4 + Nuxt UI, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-15-simulador-impacto-costos-design.md`](../specs/2026-07-15-simulador-impacto-costos-design.md) — **pieza 5 de 5** del cluster food-service.

## Global Constraints

- **Trabajar y commitear directamente sobre `main`.** No crear ramas ni PRs.
- **Toda aritmética de dinero/cantidades/% usa Decimal.js.** Nunca `number` nativo para montos. Porcentajes en decimal (`0.19` = 19%).
- **Toda columna PK/FK de UUID declara `type: 'uuid'` explícito** (ADR-004).
- **Soft delete:** lecturas filtran `eliminado_el IS NULL`.
- **`tenant_id` siempre del token**, nunca del body.
- **Design System:** tokens semánticos Nuxt UI (`text-muted`, `bg-default`, `divide-default`).
- **Selects de lectura** con SQL raw (`dataSource.query` / `manager.query`). Mutaciones batch en `dataSource.transaction`.
- **Permisos:** reutilizar módulo RBAC **Items** — `Leer` en GETs, `Actualizar` en aplicar/descartar (mismo que `PATCH /items`).
- **Seed IDs:** rango libre **0280–0289** (mermas usó 0266–0275; recetas demo 0256–0265). Esta feature no exige filas seed nuevas (usa Hamburguesa demo); reserva el rango si hace falta fixture E2E con IDs fijos.
- **Costo al aplicar se recomputa en servidor** — no confiar `costoPropuesto` del body.
- **Comparación de desfase:** ambos lados a 4 decimales (`toDecimalPlaces(4, ROUND_HALF_UP)`).

## File Structure

**Backend — crear:**
- `backend/src/modules/items/dto/aplicar-desfases.dto.ts`
- `backend/src/modules/items/dto/descartar-desfases.dto.ts`
- `backend/src/modules/items/dto/query-desfases.dto.ts`
- `backend/src/modules/items/recetas-desfases.controller.ts`
- `backend/test/simulador-costos.e2e-spec.ts`

**Backend — modificar:**
- `backend/src/modules/items/entities/item-receta.entity.ts` — `costoPropuestoOmitido`
- `backend/src/modules/items/items.service.ts` — helpers + 4 métodos públicos
- `backend/src/modules/items/items.service.spec.ts` — unit tests
- `backend/src/modules/items/items.controller.ts` — `GET :id/recetas-afectadas`
- `backend/src/modules/items/items.module.ts` — registrar `RecetasDesfasesController`
- `startup-pos.sql` — columna nueva

**Frontend — crear:**
- `frontend/app/components/RecetasDesfasesPanel.vue` — tabla + acciones compartidas (modal y bandeja)
- `frontend/app/pages/configuracion/recetas-desfases.vue`

**Frontend — modificar:**
- `frontend/app/composables/useFormatters.ts` — `formatPorcentaje`
- `frontend/app/pages/configuracion/items.vue` — hook post-cambio de costo + modal
- `frontend/app/pages/configuracion.vue` — nav link

**Docs:**
- `docs/features/simulador-impacto-costos.md` (desde TEMPLATE)
- `docs/README.md`, `docs/ESTADO.md`
- Spec → `Status: Done`
- Análisis de alineamiento: opcional nota de cierre del cluster

---

### Task 1: Columna `costo_propuesto_omitido` en `item_receta`

Fundación de esquema. Deliverable: entity + SQL; con stack arriba TypeORM agrega la columna.

**Files:**
- Modify: `backend/src/modules/items/entities/item-receta.entity.ts`
- Modify: `startup-pos.sql`

**Interfaces:**
- Produces: `ItemReceta.costoPropuestoOmitido: string | null`

- [ ] **Step 1: Ampliar entity**

```typescript
// backend/src/modules/items/entities/item-receta.entity.ts
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('item_receta')
export class ItemReceta {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({
    name: 'costo_actual',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoActual: string | null;

  @Column({
    name: 'costo_propuesto_omitido',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoPropuestoOmitido: string | null;
}
```

- [ ] **Step 2: Documentar en `startup-pos.sql`**

Reemplazar el bloque `item_receta` por:

```sql
CREATE TABLE "item_receta" (
  "item_id"                  UUID          PRIMARY KEY REFERENCES "items" ("item_id"),
  "costo_actual"             NUMERIC(18,4),
  -- Cacheado al crear/editar; NO se recalcula automáticamente si cambia el
  -- costo de un ingrediente (ver pieza 5 — simulador de impacto de costos).
  "costo_propuesto_omitido"  NUMERIC(18,4)
  -- Snapshot del costo propuesto descartado por el usuario; NULL = sin omisión.
  -- La bandeja oculta la receta mientras el propuesto actual == este valor.
);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/items/entities/item-receta.entity.ts startup-pos.sql
git commit -m "$(cat <<'EOF'
feat(items): columna costo_propuesto_omitido en item_receta

EOF
)"
```

---

### Task 2: Helpers de simulación + `listarDesfases` / `recetasAfectadasPorIngrediente`

Deliverable: GET de bandeja y de afectadas calculan filas de simulación al vuelo con Decimal.js.

**Files:**
- Modify: `backend/src/modules/items/items.service.ts`
- Modify: `backend/src/modules/items/items.service.spec.ts`
- Create: `backend/src/modules/items/dto/query-desfases.dto.ts`

**Interfaces:**
- Produces:
```typescript
export interface DesfaseIngredienteDto {
  itemId: string;
  nombre: string;
  costoActual: string | null;
}

export interface DesfaseRecetaDto {
  recetaItemId: string;
  nombre: string;
  costoActual: string;
  costoPropuesto: string;
  deltaCosto: string;
  precioBase: string;
  margenPctActual: string | null;
  margenPctPropuesto: string | null;
  precioSugerido: string | null;
  ingredientesAfectados: DesfaseIngredienteDto[];
}

// En ItemsService:
async listarDesfases(tenantId: string, ingredienteItemId?: string): Promise<DesfaseRecetaDto[]>
async recetasAfectadasPorIngrediente(tenantId: string, ingredienteItemId: string): Promise<DesfaseRecetaDto[]>
```

- [ ] **Step 1: Escribir tests unitarios fallando**

Agregar al final de `items.service.spec.ts` (mismo setup de mocks de `dataSource` / `catalogService` que ya usa el archivo). Incluir helpers locales:

```typescript
describe('desfases de costo de recetas', () => {
  const RECETA_ID = 'receta-1';
  const CARNE_ID = 'carne-1';

  function mockRecetaConIngredientes(opts: {
    costoCacheado: string;
    omitido: string | null;
    precioBase: string;
    ingredientes: {
      itemId: string;
      nombre: string;
      cantidad: string;
      unidadCodigo: string;
      unidadBase: string;
      costoActual: string | null;
    }[];
  }) {
    // 1) query cabeceras de recetas
    dataSource.query.mockResolvedValueOnce([
      {
        receta_item_id: RECETA_ID,
        nombre: 'Hamburguesa',
        costo_actual: opts.costoCacheado,
        costo_propuesto_omitido: opts.omitido,
        precio_base: opts.precioBase,
      },
    ]);
    // 2) query ingredientes de esas recetas
    dataSource.query.mockResolvedValueOnce(
      opts.ingredientes.map((i) => ({
        receta_item_id: RECETA_ID,
        ingrediente_item_id: i.itemId,
        ingrediente_nombre: i.nombre,
        cantidad: i.cantidad,
        unidad_codigo: i.unidadCodigo,
        unidad_base: i.unidadBase,
        costo_actual: i.costoActual,
      })),
    );
    for (const i of opts.ingredientes) {
      // convertirUnidad: si misma unidad, devolver cantidad tal cual
      catalogService.convertirUnidad.mockResolvedValueOnce(
        i.unidadCodigo === i.unidadBase
          ? new Decimal(i.cantidad).toDecimalPlaces(4).toString()
          : new Decimal(i.cantidad).div(1000).toDecimalPlaces(4).toString(), // g→kg típico
      );
    }
  }

  it('listarDesfases incluye receta cuando propuesto ≠ cacheado', async () => {
    mockRecetaConIngredientes({
      costoCacheado: '1820.0000',
      omitido: null,
      precioBase: '3500.0000',
      ingredientes: [
        {
          itemId: CARNE_ID,
          nombre: 'Carne',
          cantidad: '150',
          unidadCodigo: 'g',
          unidadBase: 'kg',
          costoActual: '9000', // 9000*0.15 = 1350; total solo carne para simplificar mock
        },
      ],
    });
    // Con un solo ingrediente: propuesto = 1350 ≠ 1820
    const rows = await service.listarDesfases(TENANT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].costoPropuesto).toBe('1350.0000');
    expect(rows[0].deltaCosto).toBe('-470.0000');
    expect(rows[0].margenPctActual).toBeTruthy();
    expect(rows[0].precioSugerido).toBeTruthy();
  });

  it('listarDesfases omite cuando propuesto == costo_propuesto_omitido', async () => {
    mockRecetaConIngredientes({
      costoCacheado: '1820.0000',
      omitido: '1350.0000',
      precioBase: '3500.0000',
      ingredientes: [
        {
          itemId: CARNE_ID,
          nombre: 'Carne',
          cantidad: '150',
          unidadCodigo: 'g',
          unidadBase: 'kg',
          costoActual: '9000',
        },
      ],
    });
    const rows = await service.listarDesfases(TENANT_ID);
    expect(rows).toHaveLength(0);
  });

  it('listarDesfases no incluye cuando propuesto == cacheado', async () => {
    mockRecetaConIngredientes({
      costoCacheado: '1350.0000',
      omitido: null,
      precioBase: '3500.0000',
      ingredientes: [
        {
          itemId: CARNE_ID,
          nombre: 'Carne',
          cantidad: '150',
          unidadCodigo: 'g',
          unidadBase: 'kg',
          costoActual: '9000',
        },
      ],
    });
    const rows = await service.listarDesfases(TENANT_ID);
    expect(rows).toHaveLength(0);
  });

  it('precioSugerido es null si precioBase = 0', async () => {
    mockRecetaConIngredientes({
      costoCacheado: '100.0000',
      omitido: null,
      precioBase: '0',
      ingredientes: [
        {
          itemId: CARNE_ID,
          nombre: 'Carne',
          cantidad: '1',
          unidadCodigo: 'kg',
          unidadBase: 'kg',
          costoActual: '200',
        },
      ],
    });
    const rows = await service.listarDesfases(TENANT_ID);
    expect(rows[0].margenPctActual).toBeNull();
    expect(rows[0].precioSugerido).toBeNull();
  });

  it('recetasAfectadasPorIngrediente filtra por ingrediente', async () => {
    // Misma secuencia de queries — el WHERE se valida por el SQL llamado
    mockRecetaConIngredientes({
      costoCacheado: '100.0000',
      omitido: null,
      precioBase: '500.0000',
      ingredientes: [
        {
          itemId: CARNE_ID,
          nombre: 'Carne',
          cantidad: '1',
          unidadCodigo: 'kg',
          unidadBase: 'kg',
          costoActual: '200',
        },
      ],
    });
    const rows = await service.recetasAfectadasPorIngrediente(
      TENANT_ID,
      CARNE_ID,
    );
    expect(rows).toHaveLength(1);
    expect(dataSource.query.mock.calls[0][0]).toContain('ingrediente_item_id');
    expect(dataSource.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining([TENANT_ID, CARNE_ID]),
    );
  });
});
```

> Ajustar `TENANT_ID` / nombres de mocks al patrón real del spec file (`dataSource`, `catalogService` inyectados en `beforeEach`). Si `convertirUnidad` del mock global ya existe, encadenar `mockResolvedValueOnce` como arriba.

- [ ] **Step 2: Correr tests — deben fallar**

```bash
cd backend && npm test -- --testPathPattern=items.service.spec --testNamePattern='desfases de costo'
```

Expected: FAIL (métodos no existen).

- [ ] **Step 3: Implementar helpers + métodos en `ItemsService`**

Agregar tipos exportables (arriba del `@Injectable` o en el mismo archivo):

```typescript
export interface DesfaseIngredienteDto {
  itemId: string;
  nombre: string;
  costoActual: string | null;
}

export interface DesfaseRecetaDto {
  recetaItemId: string;
  nombre: string;
  costoActual: string;
  costoPropuesto: string;
  deltaCosto: string;
  precioBase: string;
  margenPctActual: string | null;
  margenPctPropuesto: string | null;
  precioSugerido: string | null;
  ingredientesAfectados: DesfaseIngredienteDto[];
}
```

Helpers privados:

```typescript
private eq4(a: string | Decimal, b: string | Decimal): boolean {
  return new Decimal(a)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .eq(new Decimal(b).toDecimalPlaces(4, Decimal.ROUND_HALF_UP));
}

private margenPct(precio: Decimal, costo: Decimal): Decimal | null {
  if (precio.lessThanOrEqualTo(0)) return null;
  return precio.minus(costo).div(precio).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

private precioSugerido(
  precioViejo: Decimal,
  costoViejo: Decimal,
  costoNuevo: Decimal,
): Decimal | null {
  const margen = this.margenPct(precioViejo, costoViejo);
  if (margen === null) return null;
  if (margen.greaterThanOrEqualTo(1)) return null;
  // Preserva margen %: costoNuevo × precioViejo / costoViejo
  if (costoViejo.lessThanOrEqualTo(0)) return null;
  return costoNuevo
    .mul(precioViejo)
    .div(costoViejo)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/**
 * Calcula costo propuesto de una receta ya persistida (ingredientes vivos).
 * Misma aritmética que validarYCostearIngredientes: convierte a unidad base × costo_actual.
 */
private async calcularCostoPropuestoDesdeFilas(
  ings: {
    cantidad: string;
    unidad_codigo: string;
    unidad_base: string;
    costo_actual: string | null;
  }[],
): Promise<string> {
  let total = new Decimal(0);
  for (const ing of ings) {
    const cantidadBase = await this.catalogService.convertirUnidad(
      ing.cantidad,
      ing.unidad_codigo,
      ing.unidad_base,
    );
    total = total.plus(
      new Decimal(ing.costo_actual ?? '0').mul(cantidadBase),
    );
  }
  return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
}

private async construirFilasDesfase(
  tenantId: string,
  ingredienteItemId?: string,
): Promise<DesfaseRecetaDto[]> {
  const cabeceras: {
    receta_item_id: string;
    nombre: string;
    costo_actual: string;
    costo_propuesto_omitido: string | null;
    precio_base: string;
  }[] = await this.dataSource.query(
    ingredienteItemId
      ? `SELECT DISTINCT i.item_id AS receta_item_id, i.nombre,
                ir.costo_actual, ir.costo_propuesto_omitido, i.precio_base
         FROM items i
         JOIN item_receta ir ON ir.item_id = i.item_id
         JOIN receta_ingredientes ri
           ON ri.receta_item_id = i.item_id AND ri.eliminado_el IS NULL
         WHERE i.tenant_id = $1 AND i.tipo = 'receta' AND i.eliminado_el IS NULL
           AND ri.ingrediente_item_id = $2
         ORDER BY i.nombre`
      : `SELECT i.item_id AS receta_item_id, i.nombre,
                ir.costo_actual, ir.costo_propuesto_omitido, i.precio_base
         FROM items i
         JOIN item_receta ir ON ir.item_id = i.item_id
         WHERE i.tenant_id = $1 AND i.tipo = 'receta' AND i.eliminado_el IS NULL
         ORDER BY i.nombre`,
    ingredienteItemId ? [tenantId, ingredienteItemId] : [tenantId],
  );
  if (!cabeceras.length) return [];

  const ids = cabeceras.map((c) => c.receta_item_id);
  const ings: {
    receta_item_id: string;
    ingrediente_item_id: string;
    ingrediente_nombre: string;
    cantidad: string;
    unidad_codigo: string;
    unidad_base: string;
    costo_actual: string | null;
  }[] = await this.dataSource.query(
    `SELECT ri.receta_item_id, ri.ingrediente_item_id, ing.nombre AS ingrediente_nombre,
            ri.cantidad, ri.unidad_codigo, ip.unidad_medida AS unidad_base, ip.costo_actual
     FROM receta_ingredientes ri
     JOIN items ing ON ing.item_id = ri.ingrediente_item_id AND ing.eliminado_el IS NULL
     JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
     WHERE ri.tenant_id = $1 AND ri.eliminado_el IS NULL
       AND ri.receta_item_id = ANY($2::uuid[])`,
    [tenantId, ids],
  );

  const byReceta = new Map<string, typeof ings>();
  for (const row of ings) {
    const list = byReceta.get(row.receta_item_id) ?? [];
    list.push(row);
    byReceta.set(row.receta_item_id, list);
  }

  const out: DesfaseRecetaDto[] = [];
  for (const cab of cabeceras) {
    const lista = byReceta.get(cab.receta_item_id) ?? [];
    if (!lista.length) continue;
    const propuesto = await this.calcularCostoPropuestoDesdeFilas(lista);
    const cacheado = new Decimal(cab.costo_actual ?? '0')
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toString();
    if (this.eq4(propuesto, cacheado)) continue;
    if (
      cab.costo_propuesto_omitido != null &&
      this.eq4(propuesto, cab.costo_propuesto_omitido)
    ) {
      continue;
    }

    const precio = new Decimal(cab.precio_base);
    const costoActualD = new Decimal(cacheado);
    const costoPropD = new Decimal(propuesto);
    const mAct = this.margenPct(precio, costoActualD);
    const mProp = this.margenPct(precio, costoPropD);
    const sug = this.precioSugerido(precio, costoActualD, costoPropD);

    out.push({
      recetaItemId: cab.receta_item_id,
      nombre: cab.nombre,
      costoActual: cacheado,
      costoPropuesto: propuesto,
      deltaCosto: costoPropD
        .minus(costoActualD)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        .toString(),
      precioBase: precio.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
      margenPctActual: mAct?.toString() ?? null,
      margenPctPropuesto: mProp?.toString() ?? null,
      precioSugerido: sug?.toString() ?? null,
      ingredientesAfectados: lista.map((i) => ({
        itemId: i.ingrediente_item_id,
        nombre: i.ingrediente_nombre,
        costoActual: i.costo_actual,
      })),
    });
  }
  return out;
}

async listarDesfases(
  tenantId: string,
  ingredienteItemId?: string,
): Promise<DesfaseRecetaDto[]> {
  return this.construirFilasDesfase(tenantId, ingredienteItemId);
}

async recetasAfectadasPorIngrediente(
  tenantId: string,
  ingredienteItemId: string,
): Promise<DesfaseRecetaDto[]> {
  // Validar que el producto existe en el tenant (404 si no)
  const exists: unknown[] = await this.dataSource.query(
    `SELECT 1 FROM items
     WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       AND tipo = 'producto'`,
    [ingredienteItemId, tenantId],
  );
  if (!exists.length) throw new NotFoundException('Item no encontrado');
  return this.construirFilasDesfase(tenantId, ingredienteItemId);
}
```

- [ ] **Step 4: DTO query (opcional para bandeja)**

```typescript
// backend/src/modules/items/dto/query-desfases.dto.ts
import { IsOptional, IsUUID } from 'class-validator';

export class QueryDesfasesDto {
  @IsUUID()
  @IsOptional()
  ingredienteItemId?: string;
}
```

- [ ] **Step 5: Correr tests — deben pasar**

```bash
cd backend && npm test -- --testPathPattern=items.service.spec --testNamePattern='desfases de costo'
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/items/items.service.ts \
  backend/src/modules/items/items.service.spec.ts \
  backend/src/modules/items/dto/query-desfases.dto.ts
git commit -m "$(cat <<'EOF'
feat(items): detecta recetas desfasadas al vuelo

EOF
)"
```

---

### Task 3: `aplicarDesfases` + `descartarDesfases`

Deliverable: batch aplica costo (y precio opcional) o setea omitido; recomputa en servidor.

**Files:**
- Create: `aplicar-desfases.dto.ts`, `descartar-desfases.dto.ts`
- Modify: `items.service.ts`, `items.service.spec.ts`

**Interfaces:**
```typescript
async aplicarDesfases(
  tenantId: string,
  items: { recetaItemId: string; actualizarPrecio?: boolean; precioBase?: string }[],
): Promise<{ aplicados: number }>

async descartarDesfases(
  tenantId: string,
  recetaItemIds: string[],
): Promise<{ descartados: number }>
```

- [ ] **Step 1: Tests fallando**

```typescript
describe('aplicarDesfases / descartarDesfases', () => {
  it('aplicar recomputa costo, limpia omitido y actualiza precio si checkbox', async () => {
    const manager = {
      query: jest
        .fn()
        // load receta + ingredientes (una receta)
        .mockResolvedValueOnce([
          {
            receta_item_id: 'r1',
            nombre: 'H',
            costo_actual: '100',
            costo_propuesto_omitido: '999',
            precio_base: '500',
            tipo: 'receta',
          },
        ])
        .mockResolvedValueOnce([
          {
            receta_item_id: 'r1',
            ingrediente_item_id: 'c1',
            ingrediente_nombre: 'Carne',
            cantidad: '1',
            unidad_codigo: 'kg',
            unidad_base: 'kg',
            costo_actual: '200',
          },
        ])
        // UPDATE item_receta
        .mockResolvedValueOnce([])
        // UPDATE items.precio_base
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation(async (cb) => cb(manager));
    catalogService.convertirUnidad.mockResolvedValue('1');

    const result = await service.aplicarDesfases(TENANT_ID, [
      {
        recetaItemId: 'r1',
        actualizarPrecio: true,
        precioBase: '600.0000',
      },
    ]);
    expect(result.aplicados).toBe(1);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE item_receta'),
      expect.arrayContaining(['200.0000', 'r1']),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE items SET precio_base'),
      expect.arrayContaining(['600.0000', 'r1', TENANT_ID]),
    );
  });

  it('aplicar sin checkbox no toca precio_base', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            receta_item_id: 'r1',
            nombre: 'H',
            costo_actual: '100',
            costo_propuesto_omitido: null,
            precio_base: '500',
            tipo: 'receta',
          },
        ])
        .mockResolvedValueOnce([
          {
            receta_item_id: 'r1',
            ingrediente_item_id: 'c1',
            ingrediente_nombre: 'Carne',
            cantidad: '1',
            unidad_codigo: 'kg',
            unidad_base: 'kg',
            costo_actual: '200',
          },
        ])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation(async (cb) => cb(manager));
    catalogService.convertirUnidad.mockResolvedValue('1');

    await service.aplicarDesfases(TENANT_ID, [
      { recetaItemId: 'r1', actualizarPrecio: false },
    ]);
    const sqls = manager.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some((s) => s.includes('UPDATE items SET precio_base'))).toBe(
      false,
    );
  });

  it('aplicar con actualizarPrecio exige precioBase > 0', async () => {
    await expect(
      service.aplicarDesfases(TENANT_ID, [
        { recetaItemId: 'r1', actualizarPrecio: true, precioBase: '0' },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('descartar setea costo_propuesto_omitido al propuesto actual', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            receta_item_id: 'r1',
            nombre: 'H',
            costo_actual: '100',
            costo_propuesto_omitido: null,
            precio_base: '500',
            tipo: 'receta',
          },
        ])
        .mockResolvedValueOnce([
          {
            receta_item_id: 'r1',
            ingrediente_item_id: 'c1',
            ingrediente_nombre: 'Carne',
            cantidad: '1',
            unidad_codigo: 'kg',
            unidad_base: 'kg',
            costo_actual: '200',
          },
        ])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation(async (cb) => cb(manager));
    catalogService.convertirUnidad.mockResolvedValue('1');

    const result = await service.descartarDesfases(TENANT_ID, ['r1']);
    expect(result.descartados).toBe(1);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('costo_propuesto_omitido'),
      expect.arrayContaining(['200.0000', 'r1']),
    );
  });
});
```

> Si el service carga recetas con `manager.query` en vez de `dataSource.query` dentro de la tx, adaptar los mocks. La implementación abajo usa `manager` dentro de `transaction`.

- [ ] **Step 2: Correr — FAIL**

```bash
cd backend && npm test -- --testPathPattern=items.service.spec --testNamePattern='aplicarDesfases|descartarDesfases'
```

- [ ] **Step 3: DTOs**

```typescript
// aplicar-desfases.dto.ts
import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AplicarDesfaseItemDto {
  @IsUUID()
  recetaItemId: string;

  @IsBoolean()
  @IsOptional()
  actualizarPrecio?: boolean;

  @IsNumberString()
  @IsOptional()
  precioBase?: string;
}

export class AplicarDesfasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AplicarDesfaseItemDto)
  items: AplicarDesfaseItemDto[];
}
```

```typescript
// descartar-desfases.dto.ts
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class DescartarDesfasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  recetaItemIds: string[];
}
```

- [ ] **Step 4: Implementar métodos**

```typescript
async aplicarDesfases(
  tenantId: string,
  items: {
    recetaItemId: string;
    actualizarPrecio?: boolean;
    precioBase?: string;
  }[],
): Promise<{ aplicados: number }> {
  for (const it of items) {
    if (it.actualizarPrecio) {
      let p: Decimal;
      try {
        p = new Decimal(it.precioBase ?? '');
      } catch {
        throw new BadRequestException('precioBase inválido');
      }
      if (p.isNaN() || p.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          'precioBase debe ser mayor a 0 cuando actualizarPrecio es true',
        );
      }
    }
  }

  return this.dataSource.transaction(async (manager) => {
    let aplicados = 0;
    for (const it of items) {
      const cab: {
        receta_item_id: string;
        tipo: string;
      }[] = await manager.query(
        `SELECT i.item_id AS receta_item_id, i.tipo
         FROM items i
         JOIN item_receta ir ON ir.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [it.recetaItemId, tenantId],
      );
      if (!cab.length || cab[0].tipo !== 'receta') {
        throw new NotFoundException(
          `Receta ${it.recetaItemId} no encontrada`,
        );
      }

      const ings: {
        cantidad: string;
        unidad_codigo: string;
        unidad_base: string;
        costo_actual: string | null;
      }[] = await manager.query(
        `SELECT ri.cantidad, ri.unidad_codigo, ip.unidad_medida AS unidad_base, ip.costo_actual
         FROM receta_ingredientes ri
         JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
         WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL`,
        [it.recetaItemId, tenantId],
      );
      if (!ings.length) {
        throw new BadRequestException(
          `La receta ${it.recetaItemId} no tiene ingredientes`,
        );
      }

      const propuesto = await this.calcularCostoPropuestoDesdeFilas(ings);
      await manager.query(
        `UPDATE item_receta
         SET costo_actual = $1, costo_propuesto_omitido = NULL
         WHERE item_id = $2`,
        [propuesto, it.recetaItemId],
      );

      if (it.actualizarPrecio && it.precioBase) {
        const precio = new Decimal(it.precioBase)
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
          .toString();
        await manager.query(
          `UPDATE items SET precio_base = $1
           WHERE item_id = $2 AND tenant_id = $3 AND eliminado_el IS NULL`,
          [precio, it.recetaItemId, tenantId],
        );
      }
      aplicados += 1;
    }
    return { aplicados };
  });
}

async descartarDesfases(
  tenantId: string,
  recetaItemIds: string[],
): Promise<{ descartados: number }> {
  return this.dataSource.transaction(async (manager) => {
    let descartados = 0;
    for (const recetaItemId of recetaItemIds) {
      const cab: { tipo: string }[] = await manager.query(
        `SELECT i.tipo FROM items i
         JOIN item_receta ir ON ir.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [recetaItemId, tenantId],
      );
      if (!cab.length || cab[0].tipo !== 'receta') {
        throw new NotFoundException(`Receta ${recetaItemId} no encontrada`);
      }
      const ings: {
        cantidad: string;
        unidad_codigo: string;
        unidad_base: string;
        costo_actual: string | null;
      }[] = await manager.query(
        `SELECT ri.cantidad, ri.unidad_codigo, ip.unidad_medida AS unidad_base, ip.costo_actual
         FROM receta_ingredientes ri
         JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
         WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL`,
        [recetaItemId, tenantId],
      );
      const propuesto = await this.calcularCostoPropuestoDesdeFilas(ings);
      await manager.query(
        `UPDATE item_receta SET costo_propuesto_omitido = $1 WHERE item_id = $2`,
        [propuesto, recetaItemId],
      );
      descartados += 1;
    }
    return { descartados };
  });
}
```

- [ ] **Step 5: Tests PASS + commit**

```bash
cd backend && npm test -- --testPathPattern=items.service.spec --testNamePattern='desfases|aplicarDesfases|descartarDesfases'
git add backend/src/modules/items/items.service.ts \
  backend/src/modules/items/items.service.spec.ts \
  backend/src/modules/items/dto/aplicar-desfases.dto.ts \
  backend/src/modules/items/dto/descartar-desfases.dto.ts
git commit -m "$(cat <<'EOF'
feat(items): aplicar y descartar desfases de costo de recetas

EOF
)"
```

---

### Task 4: Controllers HTTP

Deliverable: rutas Swagger-ready con permisos Items.

**Files:**
- Create: `recetas-desfases.controller.ts`
- Modify: `items.controller.ts`, `items.module.ts`

**Interfaces:**
- `GET /api/recetas/desfases?ingredienteItemId=`
- `POST /api/recetas/desfases/aplicar`
- `POST /api/recetas/desfases/descartar`
- `GET /api/items/:id/recetas-afectadas`

- [ ] **Step 1: `RecetasDesfasesController`**

```typescript
// backend/src/modules/items/recetas-desfases.controller.ts
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { ItemsService } from './items.service';
import { QueryDesfasesDto } from './dto/query-desfases.dto';
import { AplicarDesfasesDto } from './dto/aplicar-desfases.dto';
import { DescartarDesfasesDto } from './dto/descartar-desfases.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('recetas')
export class RecetasDesfasesController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get('desfases')
  @RequiresPermiso('Items', 'Leer')
  listar(@Req() req: Request, @Query() query: QueryDesfasesDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.listarDesfases(tenantId, query.ingredienteItemId);
  }

  @Post('desfases/aplicar')
  @RequiresPermiso('Items', 'Actualizar')
  aplicar(@Req() req: Request, @Body() dto: AplicarDesfasesDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.aplicarDesfases(tenantId, dto.items);
  }

  @Post('desfases/descartar')
  @RequiresPermiso('Items', 'Actualizar')
  descartar(@Req() req: Request, @Body() dto: DescartarDesfasesDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.descartarDesfases(tenantId, dto.recetaItemIds);
  }
}
```

- [ ] **Step 2: Endpoint en `ItemsController`**

Insertar **antes** de `@Get(':id')` (o junto a `:id/unidades`; Nest distingue por path):

```typescript
  @Get(':id/recetas-afectadas')
  @RequiresPermiso('Items', 'Leer')
  recetasAfectadas(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.recetasAfectadasPorIngrediente(tenantId, id);
  }
```

- [ ] **Step 3: Registrar controller en `items.module.ts`**

```typescript
controllers: [ItemsController, RecetasDesfasesController],
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/items/recetas-desfases.controller.ts \
  backend/src/modules/items/items.controller.ts \
  backend/src/modules/items/items.module.ts
git commit -m "$(cat <<'EOF'
feat(items): endpoints HTTP de desfases de costo

EOF
)"
```

---

### Task 5: E2E `simulador-costos.e2e-spec.ts`

Deliverable: flujo compra → afectadas → aplicar/descartar verificado contra API real.

**Files:**
- Create: `backend/test/simulador-costos.e2e-spec.ts`

- [ ] **Step 1: Escribir e2e** (mismo login/caja helpers que `recetas.e2e-spec.ts`)

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// ... login() igual que recetas.e2e-spec.ts ...

describe('Simulador impacto costos (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('compra → afectadas → aplicar con precio → sale de bandeja', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Carne E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'kg',
        stock: '10',
        costo: '8000',
      });
    expect(resIng.status).toBe(201);
    const carneId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Burger E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: carneId,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    const recetaId = resRec.body.id as string;
    // costo cacheado ≈ 8000 * 0.15 = 1200

    await request(app.getHttpServer())
      .patch(`/api/items/${carneId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '1',
        costoUnitario: '10000',
      })
      .expect(200);

    const afectadas = await request(app.getHttpServer())
      .get(`/api/items/${carneId}/recetas-afectadas`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(afectadas.body.some((r: { recetaItemId: string }) => r.recetaItemId === recetaId)).toBe(true);

    const fila = afectadas.body.find(
      (r: { recetaItemId: string }) => r.recetaItemId === recetaId,
    );
    await request(app.getHttpServer())
      .post('/api/recetas/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          {
            recetaItemId: recetaId,
            actualizarPrecio: true,
            precioBase: fila.precioSugerido ?? '4000',
          },
        ],
      })
      .expect(201); // o 200 según @HttpCode — usar el status real del controller (default 201 en @Post)

    const bandeja = await request(app.getHttpServer())
      .get('/api/recetas/desfases')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      bandeja.body.some(
        (r: { recetaItemId: string }) => r.recetaItemId === recetaId,
      ),
    ).toBe(false);

    const detalle = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detalle.body.costoActual).not.toBe('1200.0000');
    expect(detalle.body.precioBase).not.toBe('3500.0000');
  });

  it('descartar oculta hasta nuevo cambio de costo', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Pan E2E ${Date.now()}`,
        precioBase: '500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '20',
        costo: '500',
      });
    const panId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Simple E2E ${Date.now()}`,
        precioBase: '2000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
      });
    const recetaId = resRec.body.id as string;

    await request(app.getHttpServer())
      .patch(`/api/items/${panId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: '700' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/recetas/desfases/descartar')
      .set('Authorization', `Bearer ${token}`)
      .send({ recetaItemIds: [recetaId] })
      .expect(201);

    let bandeja = await request(app.getHttpServer())
      .get('/api/recetas/desfases')
      .set('Authorization', `Bearer ${token}`);
    expect(
      bandeja.body.some(
        (r: { recetaItemId: string }) => r.recetaItemId === recetaId,
      ),
    ).toBe(false);

    await request(app.getHttpServer())
      .patch(`/api/items/${panId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: '800' })
      .expect(200);

    bandeja = await request(app.getHttpServer())
      .get('/api/recetas/desfases')
      .set('Authorization', `Bearer ${token}`);
    expect(
      bandeja.body.some(
        (r: { recetaItemId: string }) => r.recetaItemId === recetaId,
      ),
    ).toBe(true);
  });

  it('aplicar sin checkbox no cambia precio_base', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Queso E2E ${Date.now()}`,
        precioBase: '100',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'kg',
        stock: '5',
        costo: '6000',
      });
    const quesoId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Con queso E2E ${Date.now()}`,
        precioBase: '2500.0000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: quesoId,
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      });
    const recetaId = resRec.body.id as string;

    await request(app.getHttpServer())
      .patch(`/api/items/${quesoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: '9000' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/recetas/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ recetaItemId: recetaId, actualizarPrecio: false }] })
      .expect(201);

    const detalle = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detalle.body.precioBase).toBe('2500.0000');
  });
});
```

> Ajustar `@HttpCode(HttpStatus.OK)` en los POST del controller si se prefiere 200 (y alinear `expect` del e2e). Preferencia del proyecto: mirar otros controllers — si `POST` devolvió 201 en mermas/items, dejar 201.

- [ ] **Step 2: Correr e2e**

```bash
cd backend && npm run test:e2e -- --testPathPattern=simulador-costos
```

Expected: PASS (stack docker/API disponible).

- [ ] **Step 3: Commit**

```bash
git add backend/test/simulador-costos.e2e-spec.ts \
  backend/src/modules/items/recetas-desfases.controller.ts
git commit -m "$(cat <<'EOF'
test(items): e2e simulador de impacto de costos

EOF
)"
```

---

### Task 6: Frontend — `formatPorcentaje` + panel compartido + modal en Items

Deliverable: tras cambiar costo (PATCH o compra), si hay afectadas se abre el panel; acciones aplicar/descartar/después.

**Files:**
- Modify: `useFormatters.ts`, `items.vue`
- Create: `RecetasDesfasesPanel.vue`

- [ ] **Step 1: `formatPorcentaje` en `useFormatters`**

```typescript
function formatPorcentaje(
  value: string | Decimal | null | undefined,
  decimals = 2,
): string {
  if (value === null || value === undefined || value === '') return '—'
  try {
    const pct = new Decimal(value).mul(100).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
    return `${pct.toFixed(decimals).replace('.', ',')}%`
  } catch {
    return '—'
  }
}

return { formatMonto, formatFecha, formatStock, formatTipoPago, formatPorcentaje }
```

- [ ] **Step 2: Componente `RecetasDesfasesPanel.vue`**

Props:
- `filas: DesfaseRecetaDto[]`
- `highlightIngredienteId?: string | null`
- `loading?: boolean`

Emits:
- `aplicar` con payload del body API
- `descartar` con `recetaItemIds`
- `cerrar`

Estado interno: selección (Set), por fila `actualizarPrecio` (bool, default false) y `precioEditado` (string, init = `precioSugerido ?? precioBase`).

UI (tokens semánticos):
- Tabla: checkbox | nombre | costo actual→propuesto (delta) | margen actual→propuesto | input precio + checkbox “Actualizar precio”
- Footer acciones: Aplicar seleccionadas / Descartar seleccionadas / Después

Usar `MoneyInput` para precio; `formatMonto` / `formatPorcentaje`.

- [ ] **Step 3: Hook en `items.vue`**

Tras éxito de `guardar()` cuando `editingId` y `form.tipo === 'producto'` y el costo cambió respecto a `formCostoActual`:

```typescript
async function maybeAbrirDesfases(productoId: string) {
  try {
    const filas = await useApiFetch<DesfaseRecetaDto[]>(
      `${apiUrl}/items/${productoId}/recetas-afectadas`,
    )
    if (filas.length) {
      desfasesFilas.value = filas
      desfasesHighlightId.value = productoId
      desfasesOpen.value = true
    }
  } catch { /* no bloquear el flujo de guardado */ }
}
```

Llamar desde `guardar` (tras PATCH OK, si costo distinto) y desde `ejecutarAjusteStock` (si `motivo === 'compra'` y se envió `costoUnitario`).

Modal/drawer: `AppDrawer` o `UModal` con `<RecetasDesfasesPanel>` dentro; handlers llaman `POST /recetas/desfases/aplicar|descartar` y cierran + toast + `fetchItems()`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useFormatters.ts \
  frontend/app/components/RecetasDesfasesPanel.vue \
  frontend/app/pages/configuracion/items.vue
git commit -m "$(cat <<'EOF'
feat(frontend): modal de impacto de costos tras cambiar insumo

EOF
)"
```

---

### Task 7: Bandeja `configuracion/recetas-desfases` + nav

Deliverable: página listado con el mismo panel; link en configuración (Items/Leer).

**Files:**
- Create: `frontend/app/pages/configuracion/recetas-desfases.vue`
- Modify: `frontend/app/pages/configuracion.vue`

- [ ] **Step 1: Página bandeja**

Estructura `configuracion/*` (sin `UDashboardPanel` propio — hereda del padre):

```vue
<script setup lang="ts">
// fetch GET /recetas/desfases onMounted
// CrudPageHeader title="Recetas desfasadas"
// RecetasDesfasesPanel sin highlight
// aplicar/descartar → refresh list
</script>
```

Badge opcional en nav: si se quiere count, un GET en `configuracion.vue` es overkill — omitir badge en v1 (YAGNI); el link basta.

- [ ] **Step 2: Nav en `configuracion.vue`**

Junto al item Items (mismo permiso `Items`/`Leer`):

```typescript
items.push({
  label: 'Recetas desfasadas',
  icon: 'i-lucide-scale',
  to: '/configuracion/recetas-desfases',
})
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/pages/configuracion/recetas-desfases.vue \
  frontend/app/pages/configuracion.vue
git commit -m "$(cat <<'EOF'
feat(frontend): bandeja de recetas desfasadas

EOF
)"
```

---

### Task 8: Docs vivas + cerrar spec

Deliverable: feature doc, ESTADO, README, spec `Done`.

**Files:**
- Create: `docs/features/simulador-impacto-costos.md` (desde `TEMPLATE.md`)
- Modify: `docs/README.md`, `docs/ESTADO.md`
- Modify: `docs/superpowers/specs/2026-07-15-simulador-impacto-costos-design.md` → `Status: Done`
- Modify (opcional 1 línea): análisis foodservice — “pieza 5 implementada”

- [ ] **Step 1: Feature doc** — Overview, endpoints de la Task 4, reglas de desfase/omitido/aplicar, aceptación del spec.

- [ ] **Step 2: `ESTADO.md`** — fila nueva:

```markdown
| Simulador de impacto de costos (desfase recetas, aplicar/descartar) | ✅ Implementado (2026-07-15) |
```

(después de Mermas)

- [ ] **Step 3: Link en `docs/README.md`**

- [ ] **Step 4: Spec → Done**

- [ ] **Step 5: Commit**

```bash
git add docs/features/simulador-impacto-costos.md docs/README.md docs/ESTADO.md \
  docs/superpowers/specs/2026-07-15-simulador-impacto-costos-design.md
git commit -m "$(cat <<'EOF'
docs(simulador): feature, estado y cierra spec pieza 5

EOF
)"
```

---

## Verification (manual)

1. Stack: `docker-compose up` (o ya corriendo).
2. Login Paris → Items → editar costo de “Carne molida” (seed) → debe abrir modal con Hamburguesa.
3. Descartar → cierra; bandeja `/configuracion/recetas-desfases` sin esa fila.
4. Subir de nuevo el costo de carne → reaparece.
5. Aplicar con checkbox precio → `costoActual` y `precioBase` de la hamburguesa cambian.
6. Merma de carne **no** abre modal.

## Self-review (plan vs spec)

| Spec | Task |
|---|---|
| Columna `costo_propuesto_omitido` | Task 1 |
| Detección al vuelo + omitido | Task 2 |
| Margen % + precio sugerido | Task 2 |
| Aplicar (costo siempre, precio c/checkbox) | Task 3 |
| Descartar hasta próximo cambio | Task 3 |
| Endpoints API | Task 4 |
| Modal post-cambio FE | Task 6 |
| Bandeja | Task 7 |
| E2E | Task 5 |
| Docs / ESTADO | Task 8 |
| Sin tabla pendientes / sin historial / sin badge obligatorio | explícito YAGNI en Task 7 |
| Merma no dispara | Verification + decisión de no hookear mermas en FE |

Sin placeholders TBD/TODO en pasos de código. Tipos `DesfaseRecetaDto` / firmas de métodos consistentes entre Tasks 2–7.
