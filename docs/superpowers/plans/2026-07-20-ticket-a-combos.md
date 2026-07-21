# Ticket A — Items tipo combo · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar `items.tipo='combo'` — un item vendible con componentes fijos (`producto`/`receta`/`servicio`) que al venderse descuenta el stock de sus componentes, con precio propio fijo y una sola línea de venta.

**Architecture:** El combo replica el patrón de `receta` (extensión 1:1 `item_combo` + tabla hija `combo_componentes`, análoga a `item_receta` + `receta_ingredientes`). El módulo `ItemsModule` gana las entidades, el CRUD y el descuento de inventario; `VentasModule` solo agrega una rama que delega en `ItemsService` (igual que hoy con `venderIngredientesReceta`). El frontend suma el tipo Combo al editor de Items y el combo a la grilla del POS/Salones.

**Tech Stack:** NestJS + TypeORM (SQL raw sobre `dataSource`/`EntityManager`), Decimal.js para dinero, Nuxt 4 + Nuxt UI v4, Vitest/Jest para tests.

## Global Constraints

- Aritmética de dinero y cantidades: **Decimal.js**, nunca `number` nativo. Costos con 4 decimales.
- **Soft delete** en todo: `eliminado_el TIMESTAMPTZ`; toda lectura filtra `eliminado_el IS NULL`.
- Toda columna PK/FK UUID declara `type: 'uuid'` explícito en la entidad (ADR-004).
- `tenant_id` siempre del token del usuario autenticado, nunca del body.
- Esquema en dev lo crea TypeORM `synchronize:true` desde las entidades; **además** actualizar `startup-pos.sql` (doc de esquema) en el mismo commit.
- Entidades nuevas se registran **en dos lugares**: `backend/src/app.module.ts` (array `entities`) y `backend/src/modules/items/items.module.ts` (`TypeOrmModule.forFeature`).
- Frontend: `$fetch`/`useApiFetch` (no axios); formato vía `useFormatters`; tokens semánticos Nuxt UI (`text-muted`, `bg-default`…), nunca Tailwind hardcodeado. Sin `cargar()` post-mutación: mergear la entidad/patch que devuelve el backend.
- Canales de este ticket: **POS + Salones**. La tienda online (`pages/tienda/index.vue`) queda fuera.
- Alcance Ticket A: **combos con componentes fijos, sin grupos de modificadores**. Un combo se agrega al carrito con un click (sin drawer). Los grupos llegan en el Ticket B.

**Spec de referencia:** `docs/superpowers/specs/2026-07-20-combos-design.md`.

---

## File Structure

**Backend (crear):**
- `backend/src/modules/items/entities/item-combo.entity.ts` — extensión 1:1 (`item_id`, `costo_actual`).
- `backend/src/modules/items/entities/combo-componente.entity.ts` — componentes del combo.

**Backend (modificar):**
- `backend/src/modules/items/dto/create-item.dto.ts` — `ComboComponenteInputDto` + `tipo` acepta `'combo'` + `componentes?`.
- `backend/src/modules/items/dto/update-item.dto.ts` — `componentes?` (reemplazo total).
- `backend/src/modules/items/items.service.ts` — `BASE_QUERY`, `create`, `update`, `remove`, `findAll` (disponible), `findOne` (componentes) + helpers nuevos.
- `backend/src/modules/items/items.module.ts` y `backend/src/app.module.ts` — registrar entidades.
- `backend/src/modules/ventas/ventas.service.ts` — rama combo en el loop de inventario y en la resolución de cantidad.
- `backend/src/modules/items/items.service.spec.ts` y `backend/src/modules/ventas/ventas.service.spec.ts` — tests unit.
- `startup-pos.sql` — DDL de `item_combo` + `combo_componentes`.

**Backend (crear test):**
- `backend/test/combos.e2e-spec.ts` — E2E crear combo → vender → verificar movimientos.

**Frontend (modificar):**
- `frontend/app/pages/configuracion/items.vue` — tipo Combo + editor de componentes.
- `frontend/app/pages/ventas/pos.vue` y `frontend/app/pages/salones/index.vue` — fetch `tipo=combo`.
- `frontend/app/components/ventas/CatalogoGrid.vue` — badge/atenuado del combo.

**Docs (crear/modificar):**
- `docs/features/combos.md` (desde `TEMPLATE.md`) + link en `docs/README.md`.
- `docs/ESTADO.md`, `docs/PRODUCTO.md`, `docs/adr/` (+ índice).
- `backend/src/modules/seeder/seeder.service.ts` — combo demo.

---

## Task 1: Alta de combo (entidades + `POST /items` tipo=combo)

**Files:**
- Create: `backend/src/modules/items/entities/item-combo.entity.ts`
- Create: `backend/src/modules/items/entities/combo-componente.entity.ts`
- Modify: `backend/src/modules/items/dto/create-item.dto.ts`
- Modify: `backend/src/modules/items/items.module.ts`
- Modify: `backend/src/app.module.ts` (array `entities`)
- Modify: `backend/src/modules/items/items.service.ts` (`create` en `:313`, helper nuevo)
- Modify: `startup-pos.sql`
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Produces:
  - `class ItemCombo { itemId: string; costoActual: string | null }`
  - `class ComboComponente { comboComponenteId, tenantId, comboItemId, componenteItemId, cantidad, bloqueante, creadoEl, actualizadoEl, eliminadoEl }`
  - `class ComboComponenteInputDto { componenteItemId: string; cantidad: string; bloqueante?: boolean }`
  - `ItemsService.validarYCostearComponentes(manager: EntityManager, tenantId: string, componentes: ComboComponenteInputDto[]): Promise<{ costoActual: string; componentes: { componenteItemId: string; componenteNombre: string; tipo: string; cantidad: string; bloqueante: boolean }[] }>`
  - `create()` con `dto.tipo==='combo'` inserta `item_combo` + `combo_componentes` y devuelve `{ ...item, costoActual, componentes }`.

- [ ] **Step 1: Escribir el test que falla**

En `backend/src/modules/items/items.service.spec.ts`, dentro del describe existente de `create` (seguir el patrón de mocks de `dataSource.transaction`/`manager.query` que ya usan los tests de receta):

```typescript
describe('create combo', () => {
  it('calcula costo_actual = Σ(costo componente × cantidad) e inserta componentes', async () => {
    // producto costo 500 ×1  +  receta costo 1200 ×1  = 1700
    const dto = {
      nombre: 'Combo Clásico', precioBase: '5000', monedaId: MONEDA_ID, tipo: 'combo',
      componentes: [
        { componenteItemId: PROD_ID, cantidad: '1', bloqueante: true },
        { componenteItemId: RECETA_ID, cantidad: '1', bloqueante: true },
      ],
    } as any;
    const res = await service.create(TENANT_ID, USUARIO_ID, dto);
    expect(res.tipo).toBe('combo');
    expect(res.costoActual).toBe('1700');
    expect(res.componentes).toHaveLength(2);
  });

  it('rechaza un combo sin componentes', async () => {
    const dto = { nombre: 'X', precioBase: '1', monedaId: MONEDA_ID, tipo: 'combo', componentes: [] } as any;
    await expect(service.create(TENANT_ID, USUARIO_ID, dto)).rejects.toThrow(
      'Los combos requieren al menos un componente',
    );
  });

  it('rechaza un componente de tipo combo o suscripcion', async () => {
    const dto = {
      nombre: 'X', precioBase: '1', monedaId: MONEDA_ID, tipo: 'combo',
      componentes: [{ componenteItemId: OTRO_COMBO_ID, cantidad: '1' }],
    } as any;
    await expect(service.create(TENANT_ID, USUARIO_ID, dto)).rejects.toThrow(
      /componente.*producto.*receta.*servicio/i,
    );
  });
});
```

Reusar los IDs/const y el arnés de mocks del bloque de recetas del mismo archivo (buscar `describe('create'` y `validarYCostearIngredientes`). Añadir mocks de `manager.query` para las filas de `items` de los componentes (devolver `tipo` y `costo_actual`).

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `cd backend && npm test -- items.service.spec.ts -t "create combo"`
Expected: FAIL (`create` no maneja `tipo='combo'`; `validarYCostearComponentes` no existe).

- [ ] **Step 3: Crear las entidades**

`backend/src/modules/items/entities/item-combo.entity.ts`:

```typescript
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('item_combo')
export class ItemCombo {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'costo_actual', type: 'numeric', precision: 18, scale: 4, nullable: true })
  costoActual: string | null;
}
```

`backend/src/modules/items/entities/combo-componente.entity.ts`:

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('combo_componentes')
export class ComboComponente {
  @PrimaryGeneratedColumn('uuid', { name: 'combo_componente_id' })
  comboComponenteId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'combo_item_id', type: 'uuid' })
  comboItemId: string;

  @Column({ name: 'componente_item_id', type: 'uuid' })
  componenteItemId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ type: 'boolean', default: true })
  bloqueante: boolean;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 4: Registrar entidades**

En `backend/src/modules/items/items.module.ts`, importar y añadir `ItemCombo, ComboComponente` al array de `TypeOrmModule.forFeature([...])`.

En `backend/src/app.module.ts`, importar ambas y añadirlas al array `entities: [...]` de la config TypeORM (junto a `Impresora`, `Turno`, etc.).

- [ ] **Step 5: DTO — aceptar combo + componentes**

En `backend/src/modules/items/dto/create-item.dto.ts`:

1. Añadir la clase (junto a `RecetaExtraInputDto`):

```typescript
export class ComboComponenteInputDto {
  @IsUUID()
  componenteItemId: string;

  @IsNumberString()
  cantidad: string;

  @IsBoolean()
  @IsOptional()
  bloqueante?: boolean;
}
```

2. En `CreateItemDto`, extender el `@IsIn` de `tipo`:

```typescript
  @IsIn(['producto', 'servicio', 'suscripcion', 'receta', 'ingrediente', 'combo'])
  tipo: string;
```

3. Añadir el campo (junto a `extrasPermitidos`):

```typescript
  // Extensión combo
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboComponenteInputDto)
  @IsOptional()
  componentes?: ComboComponenteInputDto[];
```

- [ ] **Step 6: Helper de costeo/validación de componentes**

En `items.service.ts`, junto a `validarYCostearIngredientes` (`:1512`), añadir. El costo por componente sale de `item_producto.costo_actual` (producto), `item_receta.costo_actual` (receta) o 0 (servicio):

```typescript
private async validarYCostearComponentes(
  manager: EntityManager,
  tenantId: string,
  componentes: ComboComponenteInputDto[],
): Promise<{
  costoActual: string;
  componentes: {
    componenteItemId: string;
    componenteNombre: string;
    tipo: string;
    cantidad: string;
    bloqueante: boolean;
  }[];
}> {
  if (!componentes.length) {
    throw new BadRequestException('Los combos requieren al menos un componente');
  }
  let costoTotal = new Decimal(0);
  const detalle: {
    componenteItemId: string;
    componenteNombre: string;
    tipo: string;
    cantidad: string;
    bloqueante: boolean;
  }[] = [];
  for (const c of componentes) {
    const rows: { nombre: string; tipo: string; costo_actual: string | null }[] =
      await manager.query(
        `SELECT i.nombre, i.tipo,
                COALESCE(ip.costo_actual, ir.costo_actual) AS costo_actual
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
         LEFT JOIN item_receta ir ON ir.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [c.componenteItemId, tenantId],
      );
    if (!rows.length) {
      throw new BadRequestException(`Componente no encontrado: ${c.componenteItemId}`);
    }
    const { nombre, tipo, costo_actual } = rows[0];
    if (!['producto', 'receta', 'servicio'].includes(tipo)) {
      throw new BadRequestException(
        `Un componente de combo debe ser producto, receta o servicio (recibido: ${tipo})`,
      );
    }
    if (new Decimal(c.cantidad).lessThanOrEqualTo(0)) {
      throw new BadRequestException(`La cantidad del componente ${nombre} debe ser mayor a 0`);
    }
    costoTotal = costoTotal.plus(new Decimal(costo_actual ?? '0').mul(c.cantidad));
    detalle.push({
      componenteItemId: c.componenteItemId,
      componenteNombre: nombre,
      tipo,
      cantidad: c.cantidad,
      bloqueante: c.bloqueante ?? true,
    });
  }
  return { costoActual: costoTotal.toDecimalPlaces(4).toString(), componentes: detalle };
}
```

Importar `ComboComponenteInputDto` desde `./dto/create-item.dto` en el `import` de tipos del service.

- [ ] **Step 7: Guardas de `create` + rama combo**

En `create()` (`:313`), junto a las guardas de tipo (después del bloque `if (dto.tipo === 'receta' && !dto.ingredientes?.length)` en `:324`):

```typescript
    if (dto.tipo === 'combo' && !dto.componentes?.length) {
      throw new BadRequestException('Los combos requieren al menos un componente');
    }
```

Declarar acumuladores junto a `ingredientes`/`extrasPermitidos` (`:418`):

```typescript
      let componentes: {
        componenteItemId: string;
        componenteNombre: string;
        tipo: string;
        cantidad: string;
        bloqueante: boolean;
      }[] = [];
```

Añadir la rama `combo` en la cadena `if/else if` de extensiones (después del bloque `else if (dto.tipo === 'receta')` que termina en `:587`, antes del `else` de suscripción en `:588`):

```typescript
      } else if (dto.tipo === 'combo') {
        const costeo = await this.validarYCostearComponentes(
          manager,
          tenantId,
          dto.componentes!,
        );
        costoActual = costeo.costoActual;
        componentes = costeo.componentes;
        await manager.query(
          `INSERT INTO item_combo (item_id, costo_actual) VALUES ($1,$2)`,
          [itemId, costoActual],
        );
        for (const comp of dto.componentes!) {
          await manager.query(
            `INSERT INTO combo_componentes
               (tenant_id, combo_item_id, componente_item_id, cantidad, bloqueante)
             VALUES ($1,$2,$3,$4,$5)`,
            [tenantId, itemId, comp.componenteItemId, comp.cantidad, comp.bloqueante ?? true],
          );
        }
```

Añadir `componentes` al objeto `return` de `create` (junto a `ingredientes`, `extrasPermitidos` en `:631`):

```typescript
        componentes,
```

- [ ] **Step 8: DDL en `startup-pos.sql`**

Tras el bloque de `receta_extras_permitidos`, añadir:

```sql
-- Extensión 1:1 para tipo 'combo' (item vendible sin stock propio; descuenta el de sus componentes)
CREATE TABLE "item_combo" (
  "item_id"      UUID PRIMARY KEY REFERENCES "items" ("item_id"),
  "costo_actual" NUMERIC(18,4)  -- Σ(costo componente × cantidad); cacheado, no se recalcula solo
);

-- Componentes fijos de un combo (N por combo)
CREATE TABLE "combo_componentes" (
  "combo_componente_id" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "combo_item_id"       UUID          NOT NULL REFERENCES "items" ("item_id"),
  "componente_item_id"  UUID          NOT NULL REFERENCES "items" ("item_id"),
  -- componente_item_id apunta a un item tipo producto | receta | servicio
  "cantidad"            NUMERIC(18,4) NOT NULL,  -- por 1 unidad del combo
  "bloqueante"          BOOLEAN       NOT NULL DEFAULT true,
  "creado_el"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"      TIMESTAMPTZ,
  "eliminado_el"        TIMESTAMPTZ
);

-- Un mismo item no puede aparecer dos veces como componente del mismo combo activo
CREATE UNIQUE INDEX "uq_combo_componente_vivo"
  ON "combo_componentes" ("combo_item_id", "componente_item_id")
  WHERE "eliminado_el" IS NULL;
```

- [ ] **Step 9: Correr el test hasta verde**

Run: `cd backend && npm test -- items.service.spec.ts -t "create combo"`
Expected: PASS (3 casos).

- [ ] **Step 10: Lint + commit**

```bash
cd backend && npm run lint
git add backend/src/modules/items/entities/item-combo.entity.ts \
        backend/src/modules/items/entities/combo-componente.entity.ts \
        backend/src/modules/items/dto/create-item.dto.ts \
        backend/src/modules/items/items.module.ts backend/src/app.module.ts \
        backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts startup-pos.sql
git commit -m "feat(combos): alta de item tipo combo con componentes y costo cacheado"
```

---

## Task 2: Lectura de combo (`disponible` en listado + `componentes` en detalle)

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`BASE_QUERY` `:92`, `findAll` `:195`, `findOne` `:212`, helper nuevo)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: entidades y tablas de Task 1.
- Produces:
  - `ItemsService.calcularDisponibleCombo(tenantId: string, comboItemId: string): Promise<number | null>` — mínimo entre componentes fijos **bloqueantes** (`producto` → `floor(stock/cantidad)`; `receta` → `floor(disponibleReceta/cantidad)`; `servicio` ignorado); `null` si no hay bloqueantes.
  - `findOne(...)` para un combo devuelve `componentes: { componenteItemId, componenteNombre, tipo, cantidad, bloqueante, stock }[]`.
  - `findAll(...tipo=combo)` incluye `disponible` calculado con `calcularDisponibleCombo`.

- [ ] **Step 1: Escribir el test que falla**

En `items.service.spec.ts`:

```typescript
describe('disponible de combo', () => {
  it('es el mínimo floor(stock/cantidad) entre componentes bloqueantes; servicio se ignora', async () => {
    // producto stock 10, cantidad 2 → 5 ; receta disponible 3, cantidad 1 → 3 ; servicio ignorado
    // se espera 3
    const disp = await (service as any).calcularDisponibleCombo(TENANT_ID, COMBO_ID);
    expect(disp).toBe(3);
  });

  it('devuelve null si el combo no tiene componentes bloqueantes', async () => {
    const disp = await (service as any).calcularDisponibleCombo(TENANT_ID, COMBO_SIN_BLOQUEANTES_ID);
    expect(disp).toBeNull();
  });
});
```

Mockear `dataSource.query` para devolver las filas de componentes bloqueantes (con `tipo`, `cantidad`, `stock`) y, para el componente receta, stubear `calcularDisponibleReceta` (`jest.spyOn(service as any, 'calcularDisponibleReceta').mockResolvedValue(3)`).

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `cd backend && npm test -- items.service.spec.ts -t "disponible de combo"`
Expected: FAIL (`calcularDisponibleCombo` no existe).

- [ ] **Step 3: Implementar `calcularDisponibleCombo`**

Junto a `calcularDisponibleReceta` (`:1474`):

```typescript
/**
 * Mínimo, entre los componentes BLOQUEANTES de un combo, de las unidades que
 * alcanzan: producto → floor(stock/cantidad); receta → floor(disponibleReceta/
 * cantidad); servicio ignorado. null si no hay componentes bloqueantes.
 */
private async calcularDisponibleCombo(
  tenantId: string,
  comboItemId: string,
): Promise<number | null> {
  const rows: {
    componente_item_id: string;
    tipo: string;
    cantidad: string;
    stock: string | null;
  }[] = await this.dataSource.query(
    `SELECT cc.componente_item_id, i.tipo, cc.cantidad, ip.stock
     FROM combo_componentes cc
     JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
     LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
     WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2
       AND cc.bloqueante = true AND cc.eliminado_el IS NULL`,
    [comboItemId, tenantId],
  );

  let minimo: Decimal | null = null;
  for (const r of rows) {
    let posibles: Decimal;
    if (r.tipo === 'servicio') {
      continue;
    } else if (r.tipo === 'receta') {
      const dispReceta = await this.calcularDisponibleReceta(tenantId, r.componente_item_id);
      if (dispReceta === null) continue;
      posibles = new Decimal(dispReceta).div(r.cantidad).floor();
    } else {
      posibles = new Decimal(r.stock ?? '0').div(r.cantidad).floor();
    }
    if (minimo === null || posibles.lessThan(minimo)) minimo = posibles;
  }
  return minimo === null ? null : minimo.toNumber();
}
```

- [ ] **Step 4: `findAll` calcula disponible para combo**

En `findAll` (`:198`), extender el ternario de `disponible`:

```typescript
        const disponible =
          base.tipo === 'receta'
            ? await this.calcularDisponibleReceta(tenantId, base.id)
            : base.tipo === 'combo'
              ? await this.calcularDisponibleCombo(tenantId, base.id)
              : null;
```

- [ ] **Step 5: `BASE_QUERY` incluye costo del combo**

En `BASE_QUERY` (`:102` y `:111`):

1. Cambiar el COALESCE del costo:

```sql
      COALESCE(ip.costo_actual, ir.costo_actual, icb.costo_actual) AS costo_actual,
```

2. Añadir el JOIN (tras `LEFT JOIN item_receta ir ...`):

```sql
    LEFT JOIN item_combo icb ON icb.item_id = i.item_id
```

- [ ] **Step 6: `findOne` devuelve componentes**

En `findOne` (`:212`), tras el bloque `if (rows[0].tipo === 'receta') { ... }` (termina en `:301`), añadir la carga de componentes y sumarla al objeto devuelto:

```typescript
    let componentes: {
      componenteItemId: string;
      componenteNombre: string;
      tipo: string;
      cantidad: string;
      bloqueante: boolean;
      stock: string | null;
    }[] = [];
    if (rows[0].tipo === 'combo') {
      const compRows: {
        componente_item_id: string;
        componente_nombre: string;
        tipo: string;
        cantidad: string;
        bloqueante: boolean;
        stock: string | null;
      }[] = await this.dataSource.query(
        `SELECT cc.componente_item_id, i.nombre AS componente_nombre, i.tipo,
                cc.cantidad, cc.bloqueante, ip.stock
         FROM combo_componentes cc
         JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
         LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
         WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2 AND cc.eliminado_el IS NULL`,
        [itemId, tenantId],
      );
      componentes = compRows.map((r) => ({
        componenteItemId: r.componente_item_id,
        componenteNombre: r.componente_nombre,
        tipo: r.tipo,
        cantidad: r.cantidad,
        bloqueante: r.bloqueante,
        stock: r.stock,
      }));
    }
```

Y en el `return` de `findOne` (`:303`) añadir `componentes` junto a `ingredientes`, `extrasPermitidos`.

- [ ] **Step 7: Correr los tests hasta verde**

Run: `cd backend && npm test -- items.service.spec.ts -t "disponible de combo"`
Expected: PASS.

- [ ] **Step 8: Lint + commit**

```bash
cd backend && npm run lint
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit -m "feat(combos): disponible en listado y componentes en detalle"
```

---

## Task 3: Edición y borrado de combo

**Files:**
- Modify: `backend/src/modules/items/dto/update-item.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts` (`update` `:637`, `remove` `:1003`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `validarYCostearComponentes` (Task 1).
- Produces:
  - `update()` con `dto.componentes` hace reemplazo total (soft-delete + insert) y recalcula `item_combo.costo_actual`; devuelve `patch.costoActual` y `patch.componentes`.
  - `remove()` lanza `400` si el item es componente de un combo vivo, listando los nombres.

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
describe('update/remove combo', () => {
  it('reemplaza componentes y recalcula costo en update', async () => {
    const patch = await service.update(TENANT_ID, COMBO_ID, {
      componentes: [{ componenteItemId: PROD_ID, cantidad: '2', bloqueante: true }],
    } as any);
    expect(patch.costoActual).toBe('1000'); // costo 500 × 2
    expect(patch.componentes).toHaveLength(1);
  });

  it('bloquea borrar un item usado como componente de un combo vivo', async () => {
    await expect(service.remove(TENANT_ID, PROD_ID)).rejects.toThrow(
      /No se puede eliminar.*componente de/i,
    );
  });
});
```

Mockear en `update` el `existingRows` con `tipo:'combo'`, y en `remove` la query de uso que devuelve `[{ nombre: 'Combo Clásico' }]`.

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- items.service.spec.ts -t "update/remove combo"`
Expected: FAIL.

- [ ] **Step 3: DTO update — componentes**

En `update-item.dto.ts`: importar `ComboComponenteInputDto` desde `./create-item.dto` (junto a `RecetaExtraInputDto`) y añadir a `UpdateItemDto`:

```typescript
  // Extensión combo (reemplazo total de la lista)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboComponenteInputDto)
  @IsOptional()
  componentes?: ComboComponenteInputDto[];
```

- [ ] **Step 4: Rama combo en `update`**

En `update()`, dentro del bloque que maneja extensiones por tipo (el `if (tipo === 'receta')` alrededor de `:880`-`:960`), añadir un bloque hermano para combo. Colocarlo tras el cierre del manejo de receta (antes del `if (dto.impuestosIds !== undefined)` en `:962`):

```typescript
      if (tipo === 'combo' && dto.componentes !== undefined) {
        const costeo = await this.validarYCostearComponentes(
          manager,
          tenantId,
          dto.componentes,
        );
        await manager.query(
          `UPDATE combo_componentes
           SET eliminado_el = NOW(), actualizado_el = NOW()
           WHERE combo_item_id = $1 AND eliminado_el IS NULL`,
          [itemId],
        );
        for (const comp of dto.componentes) {
          await manager.query(
            `INSERT INTO combo_componentes
               (tenant_id, combo_item_id, componente_item_id, cantidad, bloqueante)
             VALUES ($1,$2,$3,$4,$5)`,
            [tenantId, itemId, comp.componenteItemId, comp.cantidad, comp.bloqueante ?? true],
          );
        }
        await manager.query(
          `UPDATE item_combo SET costo_actual = $1 WHERE item_id = $2`,
          [costeo.costoActual, itemId],
        );
        patch.costoActual = costeo.costoActual;
        patch.componentes = costeo.componentes;
      }
```

- [ ] **Step 5: Bloqueo de borrado en `remove`**

En `remove()` (`:1003`), tras la comprobación de uso como ingrediente de receta (`:1017`-`:1021`), añadir la de uso como componente de combo:

```typescript
    const comboRows: { nombre: string }[] = await this.dataSource.query(
      `SELECT DISTINCT c_item.nombre
       FROM combo_componentes cc
       JOIN items c_item ON c_item.item_id = cc.combo_item_id
         AND c_item.eliminado_el IS NULL
       WHERE cc.componente_item_id = $1 AND cc.eliminado_el IS NULL`,
      [itemId],
    );
    if (comboRows.length) {
      throw new BadRequestException(
        `No se puede eliminar: es componente de ${comboRows.map((r) => r.nombre).join(', ')}`,
      );
    }
```

- [ ] **Step 6: Correr hasta verde**

Run: `cd backend && npm test -- items.service.spec.ts -t "update/remove combo"`
Expected: PASS.

- [ ] **Step 7: Lint + commit**

```bash
cd backend && npm run lint
git add backend/src/modules/items/dto/update-item.dto.ts \
        backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts
git commit -m "feat(combos): edicion (reemplazo de componentes) y bloqueo de borrado"
```

---

## Task 4: Venta descuenta el stock de los componentes

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (helper `venderComponentesCombo`)
- Modify: `backend/src/modules/ventas/ventas.service.ts` (resolución de cantidad `:146`-`:155`, loop de inventario `:414`-`:444`)
- Test: `backend/src/modules/ventas/ventas.service.spec.ts`
- Test: `backend/test/combos.e2e-spec.ts`

**Interfaces:**
- Consumes: `venderIngredientesReceta` (`:1336`), `inventarioService.registrarMovimiento`.
- Produces:
  - `ItemsService.venderComponentesCombo(manager: EntityManager, params: { tenantId: string; usuarioId: string | null; ventaId: string; comboItemId: string; comboNombre: string; cantidadVendida: string }): Promise<string[]>` — devuelve advertencias (reusa `advertenciasReceta`).

- [ ] **Step 1: Escribir los tests que fallan**

En `ventas.service.spec.ts` (o en un `describe` nuevo en `items.service.spec.ts` para el helper — preferir `items.service.spec.ts` para la lógica del helper y dejar el wiring de ventas al E2E):

```typescript
describe('venderComponentesCombo', () => {
  it('producto → salida; receta → venderIngredientesReceta; servicio → nada', async () => {
    const spyMov = jest.spyOn(inventarioService, 'registrarMovimiento').mockResolvedValue({} as any);
    const spyReceta = jest.spyOn(service, 'venderIngredientesReceta').mockResolvedValue([]);
    await service.venderComponentesCombo(manager, {
      tenantId: TENANT_ID, usuarioId: USUARIO_ID, ventaId: VENTA_ID,
      comboItemId: COMBO_ID, comboNombre: 'Combo', cantidadVendida: '2',
    });
    expect(spyMov).toHaveBeenCalled();       // componente producto ×2
    expect(spyReceta).toHaveBeenCalledWith(
      manager, expect.objectContaining({ cantidadVendida: '2' }),
    );
  });

  it('componente NO bloqueante sin stock → advertencia (no aborta)', async () => {
    jest.spyOn(inventarioService, 'registrarMovimiento').mockRejectedValue(
      new BadRequestException('Stock insuficiente para la salida'),
    );
    const adv = await service.venderComponentesCombo(manager, {
      tenantId: TENANT_ID, usuarioId: USUARIO_ID, ventaId: VENTA_ID,
      comboItemId: COMBO_NO_BLOQ_ID, comboNombre: 'Combo', cantidadVendida: '1',
    });
    expect(adv.length).toBe(1);
  });

  it('componente bloqueante sin stock → aborta', async () => {
    jest.spyOn(inventarioService, 'registrarMovimiento').mockRejectedValue(
      new BadRequestException('Stock insuficiente para la salida'),
    );
    await expect(
      service.venderComponentesCombo(manager, {
        tenantId: TENANT_ID, usuarioId: USUARIO_ID, ventaId: VENTA_ID,
        comboItemId: COMBO_BLOQ_ID, comboNombre: 'Combo', cantidadVendida: '1',
      }),
    ).rejects.toThrow('Stock insuficiente para la salida');
  });
});
```

Mockear `manager.query` para devolver los componentes (`componente_item_id`, `tipo`, `cantidad`, `bloqueante`).

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- items.service.spec.ts -t "venderComponentesCombo"`
Expected: FAIL (método inexistente).

- [ ] **Step 3: Implementar `venderComponentesCombo`**

En `items.service.ts`, junto a `venderIngredientesReceta` (`:1336`):

```typescript
async venderComponentesCombo(
  manager: EntityManager,
  params: {
    tenantId: string;
    usuarioId: string | null;
    ventaId: string;
    comboItemId: string;
    comboNombre: string;
    cantidadVendida: string;
  },
): Promise<string[]> {
  const componentes: {
    componente_item_id: string;
    componente_nombre: string;
    tipo: string;
    cantidad: string;
    bloqueante: boolean;
  }[] = await manager.query(
    `SELECT cc.componente_item_id, i.nombre AS componente_nombre, i.tipo,
            cc.cantidad, cc.bloqueante
     FROM combo_componentes cc
     JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
     WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2 AND cc.eliminado_el IS NULL`,
    [params.comboItemId, params.tenantId],
  );

  const advertencias: string[] = [];

  for (const comp of componentes) {
    const cantidadTotal = new Decimal(comp.cantidad)
      .mul(params.cantidadVendida)
      .toString();

    if (comp.tipo === 'servicio') continue;

    if (comp.tipo === 'receta') {
      // La receta gestiona el bloqueo a nivel de ingrediente. Si el componente
      // es no bloqueante, un fallo por stock se degrada a advertencia.
      try {
        const adv = await this.venderIngredientesReceta(manager, {
          tenantId: params.tenantId,
          usuarioId: params.usuarioId,
          ventaId: params.ventaId,
          recetaItemId: comp.componente_item_id,
          recetaNombre: comp.componente_nombre,
          cantidadVendida: cantidadTotal,
        });
        advertencias.push(...adv);
      } catch (error) {
        if (
          !comp.bloqueante &&
          error instanceof BadRequestException &&
          error.message === 'Stock insuficiente para la salida'
        ) {
          advertencias.push(
            `${params.comboNombre}: no había stock suficiente de ${comp.componente_nombre}, se vendió sin ese componente`,
          );
        } else {
          throw error;
        }
      }
      continue;
    }

    // producto
    const movimientoParams = {
      tenantId: params.tenantId,
      itemId: comp.componente_item_id,
      tipo: 'salida' as const,
      motivo: 'venta',
      cantidad: cantidadTotal,
      usuarioId: params.usuarioId,
      ventaId: params.ventaId,
    };
    if (comp.bloqueante) {
      await this.inventarioService.registrarMovimiento(manager, movimientoParams);
      continue;
    }
    try {
      await this.inventarioService.registrarMovimiento(manager, movimientoParams);
    } catch (error) {
      if (
        error instanceof BadRequestException &&
        error.message === 'Stock insuficiente para la salida'
      ) {
        advertencias.push(
          `${params.comboNombre}: no había stock suficiente de ${comp.componente_nombre}, se vendió sin ese componente`,
        );
      } else {
        throw error;
      }
    }
  }

  return advertencias;
}
```

- [ ] **Step 4: Wiring en `ventas.service.ts` — resolución de cantidad**

En `crearEnTransaccion`, tratar el combo como la receta (unidad `'unidad'`, `forzarConteo`). En `:147`:

```typescript
      const unidadBase =
        item.tipo === 'receta' || item.tipo === 'combo'
          ? 'unidad'
          : (item.unidadMedida ?? 'unidad');
```

Y en `:154`:

```typescript
        forzarConteo: item.tipo === 'receta' || item.tipo === 'combo',
```

- [ ] **Step 5: Wiring en `ventas.service.ts` — loop de inventario**

En el loop `:414`-`:444`, añadir la rama combo tras el `else if (item.tipo === 'receta')` (`:443`):

```typescript
      } else if (item.tipo === 'combo') {
        const advertencias = await this.itemsService.venderComponentesCombo(
          manager,
          {
            tenantId,
            usuarioId,
            ventaId: venta.id,
            comboItemId: item.id,
            comboNombre: item.nombre,
            cantidadVendida: cantidadCanonica,
          },
        );
        advertenciasReceta.push(...advertencias);
      }
```

- [ ] **Step 6: Correr los tests unit hasta verde**

Run: `cd backend && npm test -- items.service.spec.ts -t "venderComponentesCombo"`
Expected: PASS (3 casos).

- [ ] **Step 7: Escribir el E2E**

`backend/test/combos.e2e-spec.ts`, siguiendo el arnés de los E2E existentes (buscar `*.e2e-spec.ts` que ya monten `AppModule` y autentiquen). Flujo:

```typescript
// 1. Crear producto con stock (Papas) y receta con ingrediente con stock (Hamburguesa).
// 2. POST /items tipo=combo con ambos como componentes bloqueantes.
// 3. GET /items?tipo=combo → disponible = min esperado.
// 4. POST /ventas vendiendo 1 combo (canal físico con caja abierta, o el helper del arnés).
// 5. GET movimientos de inventario del producto y del ingrediente de la receta → salida registrada.
// 6. Assert del total cobrado = precio del combo.
```

Reusar los helpers de setup (tenant/usuario/caja) del E2E de ventas existente; no duplicar autenticación.

- [ ] **Step 8: Correr el E2E**

Run: `cd backend && npm run test:e2e -- combos`
Expected: PASS.

- [ ] **Step 9: Lint + commit**

```bash
cd backend && npm run lint
git add backend/src/modules/items/items.service.ts backend/src/modules/ventas/ventas.service.ts \
        backend/src/modules/items/items.service.spec.ts backend/test/combos.e2e-spec.ts
git commit -m "feat(combos): venta descuenta stock de componentes (producto/receta/servicio)"
```

---

## Task 5: Frontend — tipo Combo en el editor de Items

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue`

**Interfaces:**
- Consumes: `POST/PATCH /items` con `tipo:'combo'` + `componentes` (Tasks 1, 3); `GET /items?tipo=producto|receta|servicio` para poblar el selector.
- Produces: UI de creación/edición de combo. El backend devuelve el item (con `componentes`, `costoActual`) que se mergea en el estado local.

- [ ] **Step 1: Añadir el tipo a los selectores**

En `tiposOpts` (`:238`) y `filtroTiposOpts` (`:250`) añadir `{ label: 'Combo', value: 'combo' }`.

- [ ] **Step 2: Estado del formulario + tipos**

Añadir la interfaz de fila (junto a `IngredienteRow` `:52`):

```typescript
interface ComponenteRow {
  componenteItemId: string
  cantidad: string
  bloqueante: boolean
}
```

Ampliar el tipo `Item` (`:47`) con `componentes?: { componenteItemId: string; componenteNombre?: string; tipo?: string; cantidad: string; bloqueante: boolean; stock?: string | null }[]`.

En el objeto `form` inicial (`:287`) añadir `componentes: [] as ComponenteRow[]`.

- [ ] **Step 3: Cargar opciones de componentes vendibles**

Junto a `productosIngrediente` (`:173`), añadir un ref con los items vendibles (producto/receta/servicio) y su fetch. Reusar el patrón de fetch existente en `onMounted`/`cargar` (`:531`). Cargar en paralelo:

```typescript
const itemsVendibles = ref<{ id: string; nombre: string; tipo: string }[]>([])
const itemsVendiblesOpts = computed(() =>
  itemsVendibles.value.map(i => ({ label: `${i.nombre} (${i.tipo})`, value: i.id })),
)
async function cargarItemsVendibles() {
  const [p, r, s] = await Promise.all([
    useApiFetch<{ data: any[] }>(`${apiUrl}/items?tipo=producto&pageSize=100`),
    useApiFetch<{ data: any[] }>(`${apiUrl}/items?tipo=receta&pageSize=100`),
    useApiFetch<{ data: any[] }>(`${apiUrl}/items?tipo=servicio&pageSize=100`),
  ])
  itemsVendibles.value = [...p.data, ...r.data, ...s.data]
    .map(i => ({ id: i.id, nombre: i.nombre, tipo: i.tipo }))
}
```

Llamar `cargarItemsVendibles()` donde hoy se cargan categorías/impuestos (`:531`).

- [ ] **Step 4: Preview de costo del combo**

Junto al `computed` de costo de receta (`:326`), añadir:

```typescript
const costoComboPreview = computed(() => {
  if (form.value.tipo !== 'combo') return null
  let total = new Decimal(0)
  for (const c of form.value.componentes) {
    if (!c.componenteItemId || !c.cantidad) continue
    const it = itemsVendibles.value.find(i => i.id === c.componenteItemId) as any
    total = total.plus(new Decimal(it?.costoActual ?? '0').mul(c.cantidad))
  }
  return total.toDecimalPlaces(4).toString()
})
```

(Para que `costoActual` esté disponible, incluirlo en el `map` de `cargarItemsVendibles`.)

- [ ] **Step 5: Mapear componentes al abrir/editar**

En la función que arma el `form` al editar (donde hoy se mapean `ingredientes`/`extrasPermitidos`, `:615`), añadir:

```typescript
      componentes: (detalle.componentes ?? []).map(c => ({
        componenteItemId: c.componenteItemId,
        cantidad: c.cantidad,
        bloqueante: c.bloqueante,
      })),
```

- [ ] **Step 6: Payload en `guardar`**

En `guardar()` (`:707`), añadir la rama (junto a `else if (form.value.tipo === 'receta')` `:761`):

```typescript
    } else if (form.value.tipo === 'combo') {
      payload.componentes = form.value.componentes
```

- [ ] **Step 7: Editor visual del combo**

En el template, añadir un bloque `<template v-if="form.tipo === 'combo'">` (junto al de receta `:1384`-`:1501`), reusando el layout del editor de ingredientes: por fila un `USelectMenu` con `itemsVendiblesOpts`, un `UInput` de cantidad, un `USwitch`/`UCheckbox` de `bloqueante`, y un botón de quitar; un botón "Agregar componente" que hace `form.componentes.push({ componenteItemId: '', cantidad: '1', bloqueante: true })`. Mostrar `costoComboPreview` en solo lectura. Usar tokens semánticos (`text-muted`, `divide-default`), sin Tailwind hardcodeado. Cargar el skill `nuxt-ui` antes de escribir este markup para respetar las props v4 de los componentes.

- [ ] **Step 8: Verificación manual**

Run: `cd frontend && npm run build` (o `npm run dev` y abrir `/configuracion/items`).
Verificar: crear un combo con 2 componentes muestra el costo; guardar y reabrir conserva los componentes.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/pages/configuracion/items.vue
git commit -m "feat(combos): editor de combo con componentes en Items"
```

---

## Task 6: Frontend — combo en el catálogo de POS y Salones

**Files:**
- Modify: `frontend/app/pages/ventas/pos.vue` (`:132`)
- Modify: `frontend/app/pages/salones/index.vue` (fetch de catálogo)
- Modify: `frontend/app/components/ventas/CatalogoGrid.vue`

**Interfaces:**
- Consumes: `GET /items?tipo=combo&pageSize=100` (con `disponible`).
- Produces: combos en la grilla, con el mismo tratamiento visual que las recetas; se agregan con un click.

- [ ] **Step 1: Fetch de combos en POS**

En `pos.vue`, en el `Promise.all` de `cargar()` (`:132`), añadir el fetch de combos y concatenarlo a `items.value`:

```typescript
    const [productosRes, recetasRes, combosRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=receta&pageSize=100`),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=combo&pageSize=100`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
```

Y donde se asigna `items.value` (combinando productos + recetas), incluir `...combosRes.data`.

- [ ] **Step 2: Fetch de combos en Salones**

En `salones/index.vue`, replicar: buscar el `Promise.all`/fetch que trae `tipo=producto` y `tipo=receta`, añadir `tipo=combo` y concatenar. (Si Salones reusa un composable de catálogo compartido, añadirlo ahí una sola vez.)

- [ ] **Step 3: Tratamiento visual del combo en la grilla**

En `CatalogoGrid.vue`, generalizar las funciones que hoy tratan `'receta'` para incluir `'combo'`:

`puedeAgregar` (`:24`):

```typescript
function puedeAgregar(item: ItemCatalogo): boolean {
  if (item.tipo === 'receta' || item.tipo === 'combo') return true
  return tieneStock(item)
}
```

`sinStockVisual` (`:30`):

```typescript
function sinStockVisual(item: ItemCatalogo): boolean {
  if (item.tipo === 'receta' || item.tipo === 'combo') return item.disponible === 0
  return !tieneStock(item)
}
```

Y el badge "Disponibles: N" (`:106`) para que aplique también a combos:

```html
<span v-else-if="(item.tipo === 'receta' || item.tipo === 'combo') && item.disponible !== null && item.disponible !== undefined" class="text-xs text-muted shrink-0">
  Disponibles: {{ item.disponible }}
</span>
```

- [ ] **Step 4: Verificación manual**

Run: `cd frontend && npm run dev`, abrir `/ventas/pos` y `/salones`.
Verificar: el combo aparece en la grilla, muestra "Disponibles: N", se agrega con un click y aparece en el carrito; una venta con combo se completa y descuenta stock (contra el backend real).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/ventas/pos.vue frontend/app/pages/salones/index.vue \
        frontend/app/components/ventas/CatalogoGrid.vue
git commit -m "feat(combos): combos en el catalogo de POS y Salones"
```

---

## Task 7: Seed + documentación viva

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Create: `docs/features/combos.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/README.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md`
- Create: `docs/adr/0NN-combos.md` + índice `docs/adr/README.md`

**Interfaces:**
- Consumes: endpoints y tablas de Tasks 1-4.

- [ ] **Step 1: Método de seed del combo demo**

En `seeder.service.ts`, añadir `seedCombos()` (un método privado por entidad, patrón existente) e invocarlo en el orquestador tras el seed de recetas. Usar IDs `550e8400-e29b-41d4-a716-446655440XXX` con el **siguiente número libre** (verificar el máximo actual con `grep 44066550 seeder.service.ts` y continuar). El combo demo:

- "Combo Clásico" (`tipo='combo'`, precio propio fijo), con componentes: Hamburguesa Clásica ×1 (receta demo existente) + Papas ×1 (producto demo existente), ambos `bloqueante=true`.
- Insertar en `items`, `item_combo` (con `costo_actual` = Σ costos) y `combo_componentes`, siguiendo el estilo de inserción de `seedRecetas` (mismo tenant demo).

- [ ] **Step 2: Verificar el seed al arrancar**

Run: `docker-compose up backend` (o `cd backend && npm run start:dev`) y confirmar en logs que el seed corre sin error; `GET /items?tipo=combo` devuelve el Combo Clásico con `disponible` y `costoActual`.

- [ ] **Step 3: Doc de feature**

Crear `docs/features/combos.md` desde `docs/features/TEMPLATE.md`: qué es un combo, modelo (`item_combo`, `combo_componentes`), precio propio fijo, `disponible` conservador, venta que descuenta componentes, semántica de `bloqueante`, y nota "grupos de modificadores → Ticket B". Añadir el link en `docs/README.md`.

- [ ] **Step 4: Estado y producto**

- `docs/ESTADO.md`: fila de "Combos" con estado ✅ y fecha 2026-07-20.
- `docs/PRODUCTO.md`: reglas de negocio del combo (precio propio, una línea, descuenta stock de componentes, disponibilidad por bloqueantes).

- [ ] **Step 5: ADR**

Crear el ADR (siguiente número libre en `docs/adr/`): combo con precio propio fijo, una sola línea de venta, combos no conocen inventario (el motor de venta descuenta), `disponible` conservador por componentes bloqueantes. Añadir la fila al índice `docs/adr/README.md`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/seeder/seeder.service.ts docs/
git commit -m "feat(combos): seed demo + documentacion viva (feature, ESTADO, PRODUCTO, ADR)"
```

---

## Self-Review — cobertura vs. spec

- **`items.tipo='combo'` + `item_combo` + `combo_componentes`** → Task 1 (entidades, DDL, alta). ✔
- **Componentes producto/receta/servicio con `bloqueante`** → Task 1 (validación de tipo), Task 4 (efecto por tipo). ✔
- **Precio propio fijo, una línea, entra al motor** → sin cambios en el motor (el combo es un item con `precio_base`); ventas ya trata cada línea con su `precioBase`. ✔ (No requiere task nueva: el combo se persiste con `precio_base` como cualquier item — cubierto por Task 1 vía el INSERT en `items`.)
- **`costo_actual` cacheado** → Task 1 (alta), Task 3 (recalcular en update). ✔
- **`disponible` = min componentes fijos bloqueantes; servicio ignorado; null sin bloqueantes** → Task 2. ✔
- **`GET /items/:id` combo devuelve componentes** → Task 2. ✔
- **Reemplazo total en update; bloqueo de borrado** → Task 3. ✔
- **Venta descuenta stock (producto/receta/servicio); bloqueante aborta, no bloqueante advierte** → Task 4. ✔
- **Editor de combo en Items** → Task 5. ✔
- **Combo en grilla POS + Salones, un click, badge disponible** → Task 6. ✔
- **Impresión térmica del combo con componentes** → el ticket de cocina deriva de las líneas/detalles; el combo es una línea con su `descripcion` (nombre del combo). El detalle de componentes en la comanda es incremental sobre el snapshot de Ticket B (allí se agregan las opciones). En Ticket A, el combo imprime como una línea normal — **no requiere cambio de impresión** (los componentes fijos no se listan por línea, igual que una receta imprime su nombre, no sus ingredientes). Confirmar este criterio con el usuario antes de cerrar; si se quiere listar componentes fijos en Ticket A, es un task adicional en impresión.
- **Seed + docs + ADR** → Task 7. ✔

**Ambigüedad resuelta:** la impresión de componentes fijos se trata como una línea simple en Ticket A (consistente con recetas). Marcado para confirmación del usuario.

**Type consistency:** `componenteItemId`/`componenteNombre`/`cantidad`/`bloqueante`/`tipo` usados igual en Tasks 1-6; `venderComponentesCombo` y `calcularDisponibleCombo` con las firmas declaradas en los bloques Interfaces.
