# Recetas + criticidad de ingredientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un producto compuesto ("Hamburguesa Clásica") se vende como cualquier item, pero al venderse descuenta stock de sus ingredientes en vez de tener stock propio; un ingrediente bloqueante sin stock aborta la venta completa, uno no bloqueante se omite con una advertencia.

**Architecture:** Nuevo `items.tipo = 'receta'` con extensión 1:1 `item_receta` (costo cacheado) y tabla `receta_ingredientes` (N ingredientes por receta, cada uno con cantidad, unidad y flag `bloqueante`). Toda la lógica de recetas vive en `ItemsService` (que ya inyecta `CatalogService` e `InventarioService`); `VentasService` delega en un único método nuevo (`itemsService.venderIngredientesReceta`) para no ganar dependencias nuevas. La conversión de unidades reutiliza `CatalogService.convertirUnidad` (pieza 2) sin cambios. El ingrediente bloqueante sin stock aborta la venta gratis dejando que `InventarioService.registrarMovimiento` lance su validación existente de "salida no negativa" dentro de la misma transacción. El no-bloqueante intenta el mismo movimiento y convierte solo el error `'Stock insuficiente para la salida'` en advertencia (sin pre-chequeo racey).

**Tech Stack:** NestJS + TypeORM (`synchronize: true` en dev — no hay migraciones), PostgreSQL 15, Decimal.js, Jest + supertest, Nuxt 4 + Pinia + Nuxt UI, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-15-recetas-criticidad-ingredientes-design.md`](../specs/2026-07-15-recetas-criticidad-ingredientes-design.md) — pieza 3 de 5 del cluster food-service.

## Global Constraints

- **Trabajar y commitear directamente sobre `main`.** No crear ramas ni PRs.
- **Toda aritmética de dinero, cantidades y factores usa Decimal.js.** Nunca `number` nativo (excepto `disponible`, que es un conteo entero de unidades vendibles, no dinero — se expone como `number | null`).
- **Toda columna PK/FK de UUID declara `type: 'uuid'` explícito** (ADR-004). Sin él TypeORM infiere `varchar` y rompe los JOINs en SQL raw.
- **Soft delete en todo:** columna `eliminado_el TIMESTAMPTZ`; toda lectura filtra `IS NULL`. Al **reemplazar** la lista de ingredientes de una receta, soft-deletear las filas vivas (`UPDATE … SET eliminado_el = NOW()`) e insertar las nuevas — **nunca** `DELETE FROM receta_ingredientes`.
- **`tenant_id` siempre del token del usuario autenticado, nunca del body.**
- **Design System:** solo tokens semánticos de Nuxt UI (`text-muted`, `bg-default`, `divide-default`). Nunca Tailwind hardcodeado.
- **Seed:** un método privado por entidad/escenario en `seeder.service.ts`, idempotente (chequeo `exists` antes de insertar). IDs fijos `550e8400-e29b-41d4-a716-446655440XXX`. Rango libre para esta feature: **0256–0265** (el máximo en uso hoy es 0255).
- **Escala de stock/cantidades:** `NUMERIC(18,4)`. Toda cantidad convertida se redondea a 4 decimales (ya lo hace `CatalogService.convertirUnidad`). `cantidad` de cada ingrediente debe ser **> 0** (validar en `validarYCostearIngredientes` con Decimal.js).
- **Ingredientes solo `modo_inventario = 'cantidad'`.** Serie/lote quedan fuera de esta pieza.
- **Sin recetas anidadas.** Un ingrediente siempre es `tipo='producto'`.
- **No-bloqueante sin stock (carrera):** no pre-chequear stock y luego llamar a `registrarMovimiento` (race entre el SELECT y el `FOR UPDATE` interno). Intentar el movimiento y, solo si el mensaje es exactamente `'Stock insuficiente para la salida'`, omitirlo y agregar advertencia; cualquier otro error se re-lanza.
- **`items.service.spec.ts` mockea `manager.query` en secuencia** y afirma con `mockResolvedValueOnce` en orden. Las queries nuevas de este plan son **condicionales** (solo cuando `dto.tipo === 'receta'`), así que los tests de `producto`/`servicio`/`suscripcion` existentes no cambian de orden ni de cantidad de llamadas.
- **`ventas.service.spec.ts`** usa `buildManagerMock()` con `query: jest.fn().mockResolvedValue([])` por defecto — los tests nuevos de venta de receta sobreescriben ese mock con `mockResolvedValueOnce`/`mockImplementation` según necesiten.

## File Structure

**Backend — crear:**
- `backend/src/modules/items/entities/item-receta.entity.ts`
- `backend/src/modules/items/entities/receta-ingrediente.entity.ts`
- `backend/test/recetas.e2e-spec.ts`

**Backend — modificar:**
- `backend/src/app.module.ts:150-158` — registrar `ItemReceta`, `RecetaIngrediente` en el array `entities`.
- `backend/src/modules/items/items.module.ts` — `forFeature` con las dos entidades nuevas.
- `backend/src/modules/items/dto/create-item.dto.ts` — `tipo` admite `'receta'`; nuevo `RecetaIngredienteInputDto` + `ingredientes?`.
- `backend/src/modules/items/dto/update-item.dto.ts` — `ingredientes?: RecetaIngredienteInputDto[]`.
- `backend/src/modules/items/dto/query-items.dto.ts` — `tipo` admite `'receta'`.
- `backend/src/modules/items/items.service.ts` — rama `tipo==='receta'` en `create`/`update`/`remove`, `findAll` con `disponible`, `findOne` con `ingredientes`, métodos nuevos `validarYCostearIngredientes`, `obtenerIngredientesReceta`, `obtenerStockProducto`, `calcularDisponibleReceta`, `venderIngredientesReceta`.
- `backend/src/modules/items/items.service.spec.ts` — tests de las ramas nuevas.
- `backend/src/modules/ventas/ventas.service.ts:308-323,353` — rama `item.tipo === 'receta'` delegando en `itemsService.venderIngredientesReceta`; `advertenciasReceta` en la respuesta.
- `backend/src/modules/ventas/ventas.service.spec.ts` — tests de venta de receta.
- `backend/src/modules/seeder/seeder.service.ts` — `seedRecetaDemo()`, llamada desde `seedItems()`.
- `startup-pos.sql` — documentar `item_receta` y `receta_ingredientes`.

**Frontend — modificar:**
- `frontend/app/pages/configuracion/items.vue` — `tiposOpts` gana `'receta'`; nuevo bloque de template (editor de ingredientes) espejo del de servicio/suscripción; `emptyForm()`/`abrirEditar()`/`guardar()` manejan `ingredientes`.
- `frontend/app/composables/useVenta.ts` — `ItemCatalogo` gana `disponible: number | null`.
- `frontend/app/pages/ventas/pos.vue` — el fetch de catálogo incluye `tipo=receta`; toast de venta muestra `advertenciasReceta`.
- `frontend/app/components/ventas/CatalogoGrid.vue` — `tieneStock`/`onAgregar` distinguen receta (nunca bloquea el click; se atenúa visualmente si `disponible === 0`) de producto.

**Docs:**
- `docs/features/recetas.md` (nuevo, desde `docs/features/TEMPLATE.md`), `docs/README.md`, `docs/ESTADO.md`, el spec a `Status: Done`.

---

### Task 1: Modelo de datos + crear una receta (`POST /items` con `tipo=receta`)

Fundación: sin `item_receta`/`receta_ingredientes` no hay nada que vender ni listar. Deliverable: `POST /items` con `tipo=receta` e ingredientes válidos crea la receta y calcula su costo; rechaza ingredientes inválidos.

**Files:**
- Create: `backend/src/modules/items/entities/item-receta.entity.ts`
- Create: `backend/src/modules/items/entities/receta-ingrediente.entity.ts`
- Modify: `backend/src/app.module.ts:150-158`
- Modify: `backend/src/modules/items/items.module.ts`
- Modify: `backend/src/modules/items/dto/create-item.dto.ts`
- Modify: `backend/src/modules/items/dto/query-items.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts`
- Modify: `startup-pos.sql`
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `CatalogService.convertirUnidad(cantidad: string, codigoDesde: string, codigoHacia: string): Promise<string>` (pieza 2, ya inyectado en `ItemsService`).
- Produces:
  - `RecetaIngredienteInputDto { ingredienteItemId: string; cantidad: string; unidadCodigo: string; bloqueante?: boolean }` (exportado desde `create-item.dto.ts`, reusado por `update-item.dto.ts`).
  - `ItemsService.validarYCostearIngredientes(manager: EntityManager, tenantId: string, ingredientes: RecetaIngredienteInputDto[]): Promise<string>` — valida cada ingrediente y devuelve el costo total (string, 4 decimales).
  - `POST /items` acepta `{ tipo: 'receta', ingredientes: RecetaIngredienteInputDto[], ... }`.

- [x] **Step 1: Entidades**

Crear `backend/src/modules/items/entities/item-receta.entity.ts`:

```typescript
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
}
```

Crear `backend/src/modules/items/entities/receta-ingrediente.entity.ts`:

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('receta_ingredientes')
export class RecetaIngrediente {
  @PrimaryGeneratedColumn('uuid', { name: 'receta_ingrediente_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'receta_item_id', type: 'uuid' })
  recetaItemId: string;

  @Column({ name: 'ingrediente_item_id', type: 'uuid' })
  ingredienteItemId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ name: 'unidad_codigo', type: 'text' })
  unidadCodigo: string;

  @Column({ type: 'boolean', default: true })
  bloqueante: boolean;

  // Obligatorios: con synchronize:true TypeORM alinea el schema a la entidad;
  // sin estas columnas se perderían las del SQL y se rompería el soft delete.
  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

- [x] **Step 2: Registrar las entidades**

En `backend/src/app.module.ts`, agregar los imports junto a los de `items` (cerca de la línea 59):

```typescript
import { ItemReceta } from './modules/items/entities/item-receta.entity';
import { RecetaIngrediente } from './modules/items/entities/receta-ingrediente.entity';
```

Y en el array `entities` (`:150-158`), después de `ItemSuscripcion`:

```typescript
          ItemSuscripcion,
          ItemReceta,
          RecetaIngrediente,
```

En `backend/src/modules/items/items.module.ts`, agregar los imports y sumarlas al `TypeOrmModule.forFeature`:

```typescript
import { ItemReceta } from './entities/item-receta.entity';
import { RecetaIngrediente } from './entities/receta-ingrediente.entity';
```

```typescript
    TypeOrmModule.forFeature([
      Item,
      ItemProducto,
      ItemServicio,
      ItemSuscripcion,
      ItemLote,
      ItemUnidad,
      ItemReceta,
      RecetaIngrediente,
    ]),
```

- [x] **Step 3: DTOs**

En `backend/src/modules/items/dto/create-item.dto.ts`, agregar la clase nueva después de `LoteInputDto`:

```typescript
export class RecetaIngredienteInputDto {
  @IsUUID()
  ingredienteItemId: string;

  @IsNumberString()
  cantidad: string;

  @IsString()
  @IsNotEmpty()
  unidadCodigo: string;

  @IsBoolean()
  @IsOptional()
  bloqueante?: boolean;
}
```

Cambiar `tipo` para admitir `'receta'`:

```typescript
  @IsIn(['producto', 'servicio', 'suscripcion', 'receta'])
  tipo: string;
```

Y agregar el array de ingredientes junto a `series`/`lote` (después de `lote?: LoteInputDto;`):

```typescript
  // Extensión receta
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaIngredienteInputDto)
  @IsOptional()
  ingredientes?: RecetaIngredienteInputDto[];
```

En `backend/src/modules/items/dto/query-items.dto.ts`, ampliar el filtro:

```typescript
  @IsOptional()
  @IsIn(['producto', 'servicio', 'suscripcion', 'receta'])
  tipo?: 'producto' | 'servicio' | 'suscripcion' | 'receta';
```

- [x] **Step 4: Write the failing tests**

En `backend/src/modules/items/items.service.spec.ts`, dentro de `describe('create', ...)`, agregar (después del test `'happy path: crea suscripción con extensión'`):

```typescript
    describe('receta', () => {
      const ingredientePan = {
        ingredienteItemId: 'ingrediente-pan',
        cantidad: '1',
        unidadCodigo: 'unidad',
        bloqueante: true,
      };
      const ingredienteCarne = {
        ingredienteItemId: 'ingrediente-carne',
        cantidad: '150',
        unidadCodigo: 'g',
        bloqueante: true,
      };
      const dtoReceta = {
        nombre: 'Hamburguesa test',
        precioBase: '3500',
        monedaId: MONEDA_ID,
        tipo: 'receta',
        ingredientes: [ingredientePan, ingredienteCarne],
      };

      it('rechaza una receta sin ingredientes', async () => {
        await expect(
          service.create(TENANT, 'user-uuid', {
            ...dtoReceta,
            ingredientes: [],
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('rechaza un ingrediente que no es producto', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
          .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items
          .mockResolvedValueOnce([{ tipo: 'servicio', modo_inventario: null, unidad_medida: null, costo_actual: null }]); // lookup pan → no es producto

        await expect(
          service.create(TENANT, 'user-uuid', dtoReceta as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('rechaza un ingrediente en modo serie/lote', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }])
          .mockResolvedValueOnce([{ item_id: ITEM_ID }])
          .mockResolvedValueOnce([{ tipo: 'producto', modo_inventario: 'serie', unidad_medida: 'unidad', costo_actual: '500' }]);

        await expect(
          service.create(TENANT, 'user-uuid', dtoReceta as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('happy path: calcula costoActual convirtiendo cada ingrediente a su unidad base', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
          .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items
          .mockResolvedValueOnce([{ tipo: 'producto', modo_inventario: 'cantidad', unidad_medida: 'unidad', costo_actual: '500' }]) // pan
          .mockResolvedValueOnce([{ tipo: 'producto', modo_inventario: 'cantidad', unidad_medida: 'kg', costo_actual: '8000' }]) // carne
          .mockResolvedValueOnce([]) // INSERT item_receta
          .mockResolvedValueOnce([]) // INSERT receta_ingredientes pan
          .mockResolvedValueOnce([]); // INSERT receta_ingredientes carne

        catalogServiceMock.convertirUnidad
          .mockResolvedValueOnce('1') // pan: unidad → unidad (sin cambio)
          .mockResolvedValueOnce('0.15'); // carne: 150 g → 0.15 kg

        const result = await service.create(TENANT, 'user-uuid', dtoReceta as any);

        expect(result).toEqual({ id: ITEM_ID });
        // Orden de llamadas a managerMock.query: 1=moneda, 2=INSERT items,
        // 3=lookup pan, 4=lookup carne, 5=INSERT item_receta, 6/7=INSERT receta_ingredientes.
        // costo = 500*1 + 8000*0.15 = 500 + 1200 = 1700
        expect(managerMock.query).toHaveBeenNthCalledWith(
          5,
          expect.stringContaining('INSERT INTO item_receta'),
          [ITEM_ID, '1700'],
        );
      });
    });
```

- [x] **Step 2 (verificación): Run tests to confirm they fail**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: FAIL — `dto.tipo` no acepta `'receta'` (o el `create` no tiene rama para ese tipo), `validarYCostearIngredientes` no existe.

- [x] **Step 5: Implementación mínima**

En `backend/src/modules/items/items.service.ts`, agregar el import de `RecetaIngredienteInputDto`:

```typescript
import { RecetaIngredienteInputDto } from './dto/create-item.dto';
```

Agregar la validación de "no vacío" junto a los chequeos de `suscripcion` al inicio de `create`:

```typescript
  async create(tenantId: string, usuarioId: string, dto: CreateItemDto) {
    if (dto.tipo === 'suscripcion' && !dto.frecuencia) {
      throw new BadRequestException(
        'Los items de suscripción requieren frecuencia',
      );
    }
    if (dto.tipo !== 'suscripcion' && dto.frecuencia) {
      throw new BadRequestException(
        'La frecuencia solo aplica a items de suscripción',
      );
    }
    if (dto.tipo === 'receta' && !dto.ingredientes?.length) {
      throw new BadRequestException(
        'Las recetas requieren al menos un ingrediente',
      );
    }
```

Cambiar la cadena `if/else if/else` de extensión por tipo (dentro de la transacción) para agregar la rama `receta` antes del `else` final (que hoy es el catch-all de `suscripcion`):

```typescript
      } else if (dto.tipo === 'servicio') {
        await manager.query(
          `INSERT INTO item_servicio (item_id, duracion_estimada, requiere_cita)
           VALUES ($1,$2,$3)`,
          [itemId, dto.duracionEstimada ?? null, dto.requiereCita ?? false],
        );
      } else if (dto.tipo === 'receta') {
        const costoActual = await this.validarYCostearIngredientes(
          manager,
          tenantId,
          dto.ingredientes!,
        );
        await manager.query(
          `INSERT INTO item_receta (item_id, costo_actual) VALUES ($1,$2)`,
          [itemId, costoActual],
        );
        for (const ing of dto.ingredientes!) {
          await manager.query(
            `INSERT INTO receta_ingredientes
               (tenant_id, receta_item_id, ingrediente_item_id, cantidad, unidad_codigo, bloqueante)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              tenantId,
              itemId,
              ing.ingredienteItemId,
              ing.cantidad,
              ing.unidadCodigo,
              ing.bloqueante ?? true,
            ],
          );
        }
      } else {
        await manager.query(
          `INSERT INTO item_suscripcion (item_id, frecuencia) VALUES ($1,$2)`,
          [itemId, dto.frecuencia],
        );
      }
```

Agregar el método privado `validarYCostearIngredientes` junto a los demás helpers privados (después de `validarUnidadMedida`):

```typescript
  /**
   * Valida cada ingrediente (existe, es producto, modo 'cantidad', unidad
   * compatible) y devuelve el costo total de la receta convirtiendo cada
   * cantidad a la unidad base del ingrediente antes de multiplicar por su
   * costo_actual (costo por unidad base).
   */
  private async validarYCostearIngredientes(
    manager: EntityManager,
    tenantId: string,
    ingredientes: RecetaIngredienteInputDto[],
  ): Promise<string> {
    let costoTotal = new Decimal(0);
    for (const ing of ingredientes) {
      let cantidad;
      try {
        cantidad = new Decimal(ing.cantidad);
      } catch {
        throw new BadRequestException(
          'La cantidad del ingrediente debe ser un número mayor a 0',
        );
      }
      if (cantidad.isNaN() || cantidad.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          'La cantidad del ingrediente debe ser mayor a 0',
        );
      }
      const rows: {
        tipo: string;
        modo_inventario: string | null;
        unidad_medida: string | null;
        costo_actual: string | null;
      }[] = await manager.query(
        `SELECT i.tipo, ip.modo_inventario, ip.unidad_medida, ip.costo_actual
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [ing.ingredienteItemId, tenantId],
      );
      if (!rows.length || rows[0].tipo !== 'producto') {
        throw new BadRequestException(
          `El ingrediente ${ing.ingredienteItemId} no es un producto válido`,
        );
      }
      if (rows[0].modo_inventario !== 'cantidad') {
        throw new BadRequestException(
          'Los ingredientes de una receta solo admiten productos con modo de inventario "cantidad"',
        );
      }
      const cantidadBase = await this.catalogService.convertirUnidad(
        ing.cantidad,
        ing.unidadCodigo,
        rows[0].unidad_medida!,
      );
      const costoUnitario = new Decimal(rows[0].costo_actual ?? '0');
      costoTotal = costoTotal.plus(costoUnitario.mul(cantidadBase));
    }
    return costoTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
  }
```

- [x] **Step 6: Run tests to confirm they pass**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: PASS

- [x] **Step 7: `startup-pos.sql`**

Agregar después de `item_suscripcion` (antes de `item_impuestos`):

```sql
-- Extensión 1:1 para tipo 'receta' (producto compuesto, sin stock propio)
CREATE TABLE "item_receta" (
  "item_id"      UUID          PRIMARY KEY REFERENCES "items" ("item_id"),
  "costo_actual" NUMERIC(18,4)
  -- Cacheado al crear/editar; NO se recalcula automáticamente si cambia el
  -- costo de un ingrediente (ver pieza 5 — simulador de impacto de costos).
);

-- Ingredientes de una receta (N por receta)
CREATE TABLE "receta_ingredientes" (
  "receta_ingrediente_id" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "receta_item_id"         UUID          NOT NULL REFERENCES "items" ("item_id"),
  "ingrediente_item_id"    UUID          NOT NULL REFERENCES "items" ("item_id"),
  -- ingrediente_item_id SIEMPRE apunta a un item tipo='producto', modo_inventario='cantidad'
  "cantidad"               NUMERIC(18,4) NOT NULL,  -- por 1 unidad de la receta
  "unidad_codigo"          TEXT          NOT NULL REFERENCES "unidades_medida" ("codigo"),
  "bloqueante"             BOOLEAN       NOT NULL DEFAULT true,
  "creado_el"              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"         TIMESTAMPTZ,
  "eliminado_el"           TIMESTAMPTZ
);

-- Un mismo producto no puede aparecer dos veces en la misma receta activa
CREATE UNIQUE INDEX "uq_receta_ingrediente_vivo"
  ON "receta_ingredientes" ("receta_item_id", "ingrediente_item_id")
  WHERE "eliminado_el" IS NULL;
```

- [x] **Step 8: Commit**

```bash
git add backend/src/modules/items/entities/item-receta.entity.ts \
        backend/src/modules/items/entities/receta-ingrediente.entity.ts \
        backend/src/app.module.ts \
        backend/src/modules/items/items.module.ts \
        backend/src/modules/items/dto/create-item.dto.ts \
        backend/src/modules/items/dto/query-items.dto.ts \
        backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts \
        startup-pos.sql
git commit -m "feat(items): items.tipo='receta' con ingredientes y costo calculado"
```

---

### Task 2: Editar los ingredientes de una receta (`PATCH /items/:id`)

Deliverable: `PATCH /items/:id` con `ingredientes` recalcula `costoActual` reemplazando la lista completa, sin tocar otras recetas ni el ingrediente.

**Files:**
- Modify: `backend/src/modules/items/dto/update-item.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts`
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `ItemsService.validarYCostearIngredientes` (Task 1).
- Produces: `PATCH /items/:id` acepta `{ ingredientes: RecetaIngredienteInputDto[] }` cuando el item existente es `tipo='receta'`.

- [x] **Step 1: Write the failing test**

En `backend/src/modules/items/dto/update-item.dto.ts`, agregar el import y el campo:

```typescript
import { RecetaIngredienteInputDto } from './create-item.dto';
```

```typescript
  // Extensión receta (reemplazo total de la lista)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaIngredienteInputDto)
  @IsOptional()
  ingredientes?: RecetaIngredienteInputDto[];
```

(agregar también `ValidateNested` y `Type` a los imports de `class-validator`/`class-transformer` en ese archivo).

En `backend/src/modules/items/items.service.spec.ts`, dentro de `describe('update', ...)`:

```typescript
    it('receta: reemplaza los ingredientes y recalcula costoActual', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }]) // SELECT existente
        .mockResolvedValueOnce([{ tipo: 'producto', modo_inventario: 'cantidad', unidad_medida: 'kg', costo_actual: '6000' }]) // queso
        .mockResolvedValueOnce([]) // soft-delete receta_ingredientes
        .mockResolvedValueOnce([]) // INSERT receta_ingredientes queso
        .mockResolvedValueOnce([]); // UPDATE item_receta costo_actual

      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.02'); // 20 g → 0.02 kg

      await service.update(TENANT, ITEM_ID, {
        ingredientes: [
          {
            ingredienteItemId: 'ingrediente-queso',
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      } as any);

      // soft-delete de la lista anterior (nunca hard DELETE)
      expect(managerMock.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('SET eliminado_el = NOW()'),
        [ITEM_ID],
      );
      // costo = 6000 * 0.02 = 120
      expect(managerMock.query).toHaveBeenNthCalledWith(
        5,
        expect.stringContaining('UPDATE item_receta'),
        ['120', ITEM_ID],
      );
    });
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: FAIL — `update` no tiene rama para `tipo === 'receta'`.

- [x] **Step 3: Implementación mínima**

En `backend/src/modules/items/items.service.ts`, dentro de `update`, agregar la rama después de `} else if (tipo === 'suscripcion') { ... }`:

```typescript
      } else if (tipo === 'receta') {
        if (dto.ingredientes !== undefined) {
          if (!dto.ingredientes.length) {
            throw new BadRequestException(
              'Las recetas requieren al menos un ingrediente',
            );
          }
          const costoActual = await this.validarYCostearIngredientes(
            manager,
            tenantId,
            dto.ingredientes,
          );
          // Soft delete de la lista anterior — nunca hard DELETE
          await manager.query(
            `UPDATE receta_ingredientes
             SET eliminado_el = NOW(), actualizado_el = NOW()
             WHERE receta_item_id = $1 AND eliminado_el IS NULL`,
            [itemId],
          );
          for (const ing of dto.ingredientes) {
            await manager.query(
              `INSERT INTO receta_ingredientes
                 (tenant_id, receta_item_id, ingrediente_item_id, cantidad, unidad_codigo, bloqueante)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                tenantId,
                itemId,
                ing.ingredienteItemId,
                ing.cantidad,
                ing.unidadCodigo,
                ing.bloqueante ?? true,
              ],
            );
          }
          await manager.query(
            `UPDATE item_receta SET costo_actual = $1 WHERE item_id = $2`,
            [costoActual, itemId],
          );
        }
      }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/items/dto/update-item.dto.ts \
        backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts
git commit -m "feat(items): editar ingredientes de una receta recalcula el costo cacheado"
```

---

### Task 3: Bloquear el borrado de un producto usado como ingrediente

Deliverable: `DELETE /items/:id` sobre un producto referenciado por una receta activa devuelve `BadRequest` con el nombre de la receta.

**Files:**
- Modify: `backend/src/modules/items/items.service.ts`
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `ItemsService.remove` lanza `BadRequestException` cuando el item está en uso.

- [ ] **Step 1: Write the failing test**

En `backend/src/modules/items/items.service.spec.ts`, dentro de `describe('remove', ...)` (buscar el describe existente de `remove`, o crearlo si no existe junto a `update`):

```typescript
  describe('remove', () => {
    it('bloquea el borrado si el item es ingrediente de una receta activa', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      dataSource.query.mockResolvedValueOnce([{ nombre: 'Hamburguesa Clásica' }]);

      await expect(service.remove(TENANT, ITEM_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('permite el borrado si el item no es ingrediente de ninguna receta', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      dataSource.query
        .mockResolvedValueOnce([]) // sin recetas que lo usen
        .mockResolvedValueOnce([]); // UPDATE items (soft delete)

      await expect(service.remove(TENANT, ITEM_ID)).resolves.toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: FAIL — hoy `remove` no consulta `receta_ingredientes`, así que el primer test no lanza.

- [ ] **Step 3: Implementación mínima**

En `backend/src/modules/items/items.service.ts`, reemplazar `remove`:

```typescript
  async remove(tenantId: string, itemId: string): Promise<void> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException('Item no encontrado');

    const usoRows: { nombre: string }[] = await this.dataSource.query(
      `SELECT DISTINCT ri_item.nombre
       FROM receta_ingredientes ri
       JOIN items ri_item ON ri_item.item_id = ri.receta_item_id
         AND ri_item.eliminado_el IS NULL
       WHERE ri.ingrediente_item_id = $1 AND ri.eliminado_el IS NULL`,
      [itemId],
    );
    if (usoRows.length) {
      throw new BadRequestException(
        `No se puede eliminar: es ingrediente de ${usoRows.map((r) => r.nombre).join(', ')}`,
      );
    }

    await this.dataSource.query(
      `UPDATE items SET activo = false, eliminado_el = NOW(), actualizado_el = NOW()
       WHERE item_id = $1 AND tenant_id = $2`,
      [itemId, tenantId],
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit -m "feat(items): bloquea borrar un producto usado como ingrediente de una receta"
```

---

### Task 4: Venta de una receta — expansión a movimientos por ingrediente

Deliverable: vender una receta genera un movimiento de salida por ingrediente (cantidad convertida); un ingrediente bloqueante sin stock aborta toda la venta; uno no bloqueante sin stock se omite y se reporta en `advertenciasReceta`.

**Files:**
- Modify: `backend/src/modules/items/items.service.ts`
- Modify: `backend/src/modules/items/items.service.spec.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts:308-323,353`
- Modify: `backend/src/modules/ventas/ventas.service.spec.ts`

**Interfaces:**
- Consumes: `ItemsService.obtenerIngredientesReceta` (nuevo en este task), `CatalogService.convertirUnidad`, `InventarioService.registrarMovimiento`.
- Produces:
  - `ItemsService.venderIngredientesReceta(manager: EntityManager, params: { tenantId: string; usuarioId: string | null; ventaId: string; recetaItemId: string; recetaNombre: string; cantidadVendida: string }): Promise<string[]>` — devuelve las advertencias (vacío si no hubo ninguna).
  - `VentasService.crear(...)` la respuesta incluye `advertenciasReceta: string[]`.

- [ ] **Step 1: Write the failing tests — `ItemsService`**

En `backend/src/modules/items/items.service.spec.ts`, nuevo `describe` al final del archivo:

```typescript
  describe('venderIngredientesReceta', () => {
    const PARAMS = {
      tenantId: TENANT,
      usuarioId: 'user-uuid',
      ventaId: 'venta-uuid',
      recetaItemId: 'receta-uuid',
      recetaNombre: 'Hamburguesa',
      cantidadVendida: '2',
    };

    it('genera un movimiento de salida por cada ingrediente con la cantidad convertida', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          ingrediente_item_id: 'pan',
          ingrediente_nombre: 'Pan',
          ingrediente_unidad_medida: 'unidad',
          cantidad: '1',
          unidad_codigo: 'unidad',
          bloqueante: true,
        },
        {
          ingrediente_item_id: 'carne',
          ingrediente_nombre: 'Carne',
          ingrediente_unidad_medida: 'kg',
          cantidad: '150',
          unidad_codigo: 'g',
          bloqueante: true,
        },
      ]);
      catalogServiceMock.convertirUnidad
        .mockResolvedValueOnce('2') // pan: 1*2 unidad → unidad
        .mockResolvedValueOnce('0.3'); // carne: 150*2=300 g → 0.3 kg

      const advertencias = await service.venderIngredientesReceta(
        managerMock as any,
        PARAMS,
      );

      expect(advertencias).toEqual([]);
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledTimes(2);
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenNthCalledWith(
        1,
        managerMock,
        expect.objectContaining({ itemId: 'pan', cantidad: '2', motivo: 'venta' }),
      );
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenNthCalledWith(
        2,
        managerMock,
        expect.objectContaining({ itemId: 'carne', cantidad: '0.3', motivo: 'venta' }),
      );
    });

    it('propaga el error si un ingrediente bloqueante no tiene stock (aborta la venta)', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          ingrediente_item_id: 'carne',
          ingrediente_nombre: 'Carne',
          ingrediente_unidad_medida: 'kg',
          cantidad: '150',
          unidad_codigo: 'g',
          bloqueante: true,
        },
      ]);
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.3');
      inventarioServiceMock.registrarMovimiento.mockRejectedValueOnce(
        new BadRequestException('Stock insuficiente para la salida'),
      );

      await expect(
        service.venderIngredientesReceta(managerMock as any, PARAMS),
      ).rejects.toThrow(BadRequestException);
    });

    it('omite el movimiento y agrega advertencia si un ingrediente no bloqueante no tiene stock', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          ingrediente_item_id: 'queso',
          ingrediente_nombre: 'Queso',
          ingrediente_unidad_medida: 'kg',
          cantidad: '20',
          unidad_codigo: 'g',
          bloqueante: false,
        },
      ]);
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.04'); // 20*2=40 g → 0.04 kg
      // Sin pre-chequeo de stock: registrarMovimiento lanza y se convierte en advertencia
      inventarioServiceMock.registrarMovimiento.mockRejectedValueOnce(
        new BadRequestException('Stock insuficiente para la salida'),
      );

      const advertencias = await service.venderIngredientesReceta(
        managerMock as any,
        PARAMS,
      );

      expect(advertencias).toEqual([
        'Hamburguesa: no había stock suficiente de Queso, se vendió sin ese insumo',
      ]);
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledTimes(1);
    });

    it('no engulle errores distintos de stock insuficiente en no-bloqueantes', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          ingrediente_item_id: 'queso',
          ingrediente_nombre: 'Queso',
          ingrediente_unidad_medida: 'kg',
          cantidad: '20',
          unidad_codigo: 'g',
          bloqueante: false,
        },
      ]);
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.04');
      inventarioServiceMock.registrarMovimiento.mockRejectedValueOnce(
        new BadRequestException('El item no tiene control de stock'),
      );

      await expect(
        service.venderIngredientesReceta(managerMock as any, PARAMS),
      ).rejects.toThrow('El item no tiene control de stock');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: FAIL — `venderIngredientesReceta` no existe.

- [ ] **Step 3: Implementación mínima — `ItemsService`**

Agregar en `backend/src/modules/items/items.service.ts`, como métodos públicos (junto a `findLotes`, antes de los helpers privados):

```typescript
  async obtenerIngredientesReceta(
    manager: EntityManager,
    tenantId: string,
    recetaItemId: string,
  ): Promise<
    {
      ingredienteItemId: string;
      ingredienteNombre: string;
      ingredienteUnidadMedida: string;
      cantidad: string;
      unidadCodigo: string;
      bloqueante: boolean;
    }[]
  > {
    const rows: {
      ingrediente_item_id: string;
      ingrediente_nombre: string;
      ingrediente_unidad_medida: string;
      cantidad: string;
      unidad_codigo: string;
      bloqueante: boolean;
    }[] = await manager.query(
      `SELECT ri.ingrediente_item_id, i.nombre AS ingrediente_nombre,
              ip.unidad_medida AS ingrediente_unidad_medida,
              ri.cantidad, ri.unidad_codigo, ri.bloqueante
       FROM receta_ingredientes ri
       JOIN items i ON i.item_id = ri.ingrediente_item_id AND i.eliminado_el IS NULL
       JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
       WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL`,
      [recetaItemId, tenantId],
    );
    return rows.map((r) => ({
      ingredienteItemId: r.ingrediente_item_id,
      ingredienteNombre: r.ingrediente_nombre,
      ingredienteUnidadMedida: r.ingrediente_unidad_medida,
      cantidad: r.cantidad,
      unidadCodigo: r.unidad_codigo,
      bloqueante: r.bloqueante,
    }));
  }

  async obtenerStockProducto(
    manager: EntityManager,
    itemId: string,
  ): Promise<string> {
    const rows: { stock: string }[] = await manager.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [itemId],
    );
    return rows[0]?.stock ?? '0';
  }

  /**
   * Vende N unidades de una receta: expande a un movimiento de salida por
   * ingrediente. Un ingrediente bloqueante sin stock deja que
   * registrarMovimiento lance su validación de "salida no negativa" —
   * eso aborta toda la transacción de la venta, gratis. Uno no bloqueante
   * intenta el mismo movimiento; si falla solo por
   * 'Stock insuficiente para la salida', se omite y se reporta como
   * advertencia (evita la carrera del pre-chequeo SELECT sin lock).
   */
  async venderIngredientesReceta(
    manager: EntityManager,
    params: {
      tenantId: string;
      usuarioId: string | null;
      ventaId: string;
      recetaItemId: string;
      recetaNombre: string;
      cantidadVendida: string;
    },
  ): Promise<string[]> {
    const ingredientes = await this.obtenerIngredientesReceta(
      manager,
      params.tenantId,
      params.recetaItemId,
    );
    const advertencias: string[] = [];

    for (const ing of ingredientes) {
      const cantidadPorReceta = new Decimal(ing.cantidad)
        .mul(params.cantidadVendida)
        .toString();
      const cantidadConvertida = await this.catalogService.convertirUnidad(
        cantidadPorReceta,
        ing.unidadCodigo,
        ing.ingredienteUnidadMedida,
      );

      const movimientoParams = {
        tenantId: params.tenantId,
        itemId: ing.ingredienteItemId,
        tipo: 'salida' as const,
        motivo: 'venta',
        cantidad: cantidadConvertida,
        usuarioId: params.usuarioId,
        ventaId: params.ventaId,
      };

      if (ing.bloqueante) {
        await this.inventarioService.registrarMovimiento(
          manager,
          movimientoParams,
        );
        continue;
      }

      try {
        await this.inventarioService.registrarMovimiento(
          manager,
          movimientoParams,
        );
      } catch (error) {
        if (
          error instanceof BadRequestException &&
          error.message === 'Stock insuficiente para la salida'
        ) {
          advertencias.push(
            `${params.recetaNombre}: no había stock suficiente de ${ing.ingredienteNombre}, se vendió sin ese insumo`,
          );
        } else {
          throw error;
        }
      }
    }

    return advertencias;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests — `VentasService`**

En `backend/src/modules/ventas/ventas.service.spec.ts`, agregar el mock de `venderIngredientesReceta` al provider de `ItemsService` (junto a `findOne`):

```typescript
        {
          provide: ItemsService,
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockItem),
            venderIngredientesReceta: jest.fn().mockResolvedValue([]),
          },
        },
```

Y un nuevo `describe` (después de `describe('crear()', ...)` existente, o dentro de él):

```typescript
  describe('crear() — recetas', () => {
    const mockReceta = {
      id: 'receta-uuid',
      nombre: 'Hamburguesa',
      tipo: 'receta',
      precioBase: '3500.0000',
      precioIncluyeImpuesto: false,
      monedaId: MONEDA_OFICIAL_ID,
      impuestosIds: [],
      descuentosIds: [],
      recargosIds: [],
    };
    const dtoReceta = {
      lineas: [{ itemId: 'receta-uuid', cantidad: '2' }],
      pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '7000.0000' }],
    };

    it('delega en itemsService.venderIngredientesReceta y no llama registrarMovimiento directo', async () => {
      itemsService.findOne.mockResolvedValueOnce(mockReceta);
      await service.crear(TENANT_ID, USUARIO_ID, dtoReceta as any);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(itemsService.venderIngredientesReceta).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: TENANT_ID,
          recetaItemId: 'receta-uuid',
          recetaNombre: 'Hamburguesa',
          cantidadVendida: '2',
        }),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('agrega advertenciasReceta a la respuesta cuando hay advertencias', async () => {
      itemsService.findOne.mockResolvedValueOnce(mockReceta);
      (itemsService.venderIngredientesReceta as jest.Mock).mockResolvedValueOnce([
        'Hamburguesa: no había stock suficiente de Queso, se vendió sin ese insumo',
      ]);

      const result = await service.crear(TENANT_ID, USUARIO_ID, dtoReceta as any);

      expect(result.advertenciasReceta).toEqual([
        'Hamburguesa: no había stock suficiente de Queso, se vendió sin ese insumo',
      ]);
    });
  });
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd backend && npm test -- ventas.service.spec.ts`
Expected: FAIL — el loop actual solo maneja `tipo === 'producto'` y la respuesta no incluye `advertenciasReceta`.

- [ ] **Step 7: Implementación mínima — `VentasService`**

En `backend/src/modules/ventas/ventas.service.ts`, reemplazar el bloque `7f` (líneas 308-323):

```typescript
    // 7f. Movimientos de inventario (productos y recetas)
    const advertenciasReceta: string[] = [];
    for (let i = 0; i < lineasConversion.length; i++) {
      const { item, linea } = lineasConversion[i];
      if (item.tipo === 'producto') {
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId,
          itemId: item.id,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: linea.cantidad,
          usuarioId,
          ventaId: venta.id,
          unidadIds: linea.unidadIds,
          loteId: linea.loteId,
        });
      } else if (item.tipo === 'receta') {
        const advertencias = await this.itemsService.venderIngredientesReceta(
          manager,
          {
            tenantId,
            usuarioId,
            ventaId: venta.id,
            recetaItemId: item.id,
            recetaNombre: item.nombre,
            cantidadVendida: linea.cantidad,
          },
        );
        advertenciasReceta.push(...advertencias);
      }
    }
```

Y cambiar el `return` final (línea 353):

```typescript
    return { ...venta, detalles, advertenciasReceta };
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && npm test -- ventas.service.spec.ts items.service.spec.ts`
Expected: PASS (incluidos los tests preexistentes de items tipo `producto`/`servicio` — no cambian).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts \
        backend/src/modules/ventas/ventas.service.ts \
        backend/src/modules/ventas/ventas.service.spec.ts
git commit -m "feat(ventas): vender una receta descuenta stock de sus ingredientes"
```

---

### Task 5: Disponibilidad calculada en el listado (`GET /items?tipo=receta`)

Deliverable: cada receta en el listado trae `disponible: number | null` (mínimo entre ingredientes bloqueantes de `stock / cantidad`); `GET /items/:id` de una receta trae `ingredientes` resueltos.

**Files:**
- Modify: `backend/src/modules/items/items.service.ts`
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `CatalogService.convertirUnidad`.
- Produces: `findAll` devuelve items con `disponible: number | null` (siempre presente, `null` si no aplica o el item no es receta). `findOne` de una receta agrega `ingredientes: { ingredienteItemId, ingredienteNombre, cantidad, unidadCodigo, bloqueante }[]`.

- [ ] **Step 1: Write the failing tests**

En `backend/src/modules/items/items.service.spec.ts`, dentro de `describe('findAll', ...)`:

```typescript
    it('receta: agrega disponible = mínimo entre ingredientes bloqueantes', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            item_id: 'receta-uuid',
            nombre: 'Hamburguesa',
            descripcion: null,
            tipo: 'receta',
            activo: true,
            precio_base: '3500',
            precio_incluye_impuesto: false,
            moneda_id: MONEDA_ID,
            moneda_codigo: 'CLP',
            moneda_simbolo: '$',
            categoria_id: null,
            categoria_nombre: null,
            creado_el: new Date(),
            stock: null,
            unidad_medida: null,
            fecha_elaboracion: null,
            fecha_vencimiento: null,
            modo_inventario: null,
            costo_actual: '1700',
            duracion_estimada: null,
            requiere_cita: null,
            frecuencia: null,
          },
        ])
        .mockResolvedValueOnce([
          { cantidad: '1', unidad_codigo: 'unidad', ingrediente_unidad_medida: 'unidad', stock: '8' }, // pan
          { cantidad: '150', unidad_codigo: 'g', ingrediente_unidad_medida: 'kg', stock: '1' }, // carne: 1kg = 1000g
        ]);
      catalogServiceMock.convertirUnidad
        .mockResolvedValueOnce('1') // pan
        .mockResolvedValueOnce('0.15'); // carne 150g → 0.15kg

      const result = await service.findAll(TENANT, { tipo: 'receta' } as any);

      // pan: floor(8/1)=8; carne: floor(1/0.15)=6 → mínimo 6
      expect(result.data[0].disponible).toBe(6);
    });

    it('producto: disponible siempre es null', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            item_id: ITEM_ID,
            nombre: 'Smartphone',
            descripcion: null,
            tipo: 'producto',
            activo: true,
            precio_base: '100000',
            precio_incluye_impuesto: false,
            moneda_id: MONEDA_ID,
            moneda_codigo: 'CLP',
            moneda_simbolo: '$',
            categoria_id: null,
            categoria_nombre: null,
            creado_el: new Date(),
            stock: '10',
            unidad_medida: 'unidad',
            fecha_elaboracion: null,
            fecha_vencimiento: null,
            modo_inventario: 'cantidad',
            costo_actual: null,
            duracion_estimada: null,
            requiere_cita: null,
            frecuencia: null,
          },
        ]);

      const result = await service.findAll(TENANT, {});
      expect(result.data[0].disponible).toBeNull();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: FAIL — `disponible` no existe en la respuesta hoy.

- [ ] **Step 3: Implementación mínima**

En `backend/src/modules/items/items.service.ts`, agregar el método privado (junto a `validarYCostearIngredientes`):

```typescript
  /**
   * Mínimo, entre los ingredientes BLOQUEANTES de una receta, de
   * floor(stock del ingrediente convertido a la unidad de la receta /
   * cantidad por receta). null si la receta no tiene ingredientes
   * bloqueantes (sin límite aplicable). Se calcula al vuelo: sin columna
   * cacheada (ver Decisions del diseño).
   */
  private async calcularDisponibleReceta(
    tenantId: string,
    recetaItemId: string,
  ): Promise<number | null> {
    const rows: {
      cantidad: string;
      unidad_codigo: string;
      ingrediente_unidad_medida: string;
      stock: string;
    }[] = await this.dataSource.query(
      `SELECT ri.cantidad, ri.unidad_codigo, ip.unidad_medida AS ingrediente_unidad_medida, ip.stock
       FROM receta_ingredientes ri
       JOIN item_producto ip ON ip.item_id = ri.ingrediente_item_id
       WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2
         AND ri.bloqueante = true AND ri.eliminado_el IS NULL`,
      [recetaItemId, tenantId],
    );
    if (!rows.length) return null;

    let minimo: Decimal | null = null;
    for (const r of rows) {
      const cantidadBase = await this.catalogService.convertirUnidad(
        r.cantidad,
        r.unidad_codigo,
        r.ingrediente_unidad_medida,
      );
      const posibles = new Decimal(r.stock).div(cantidadBase).floor();
      if (minimo === null || posibles.lessThan(minimo)) minimo = posibles;
    }
    return minimo ? minimo.toNumber() : null;
  }
```

Modificar `findAll` para agregar `disponible` a cada fila mapeada:

```typescript
    const rows: ItemRow[] = await this.dataSource.query(
      this.BASE_QUERY +
        where +
        ` ORDER BY i.nombre ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    const data = await Promise.all(
      rows.map(async (r) => {
        const base = this.mapRow(r);
        const disponible =
          base.tipo === 'receta'
            ? await this.calcularDisponibleReceta(tenantId, base.id)
            : null;
        return { ...base, disponible };
      }),
    );

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
    };
```

En `findOne`, agregar la resolución de ingredientes cuando el tipo es `receta` (después del bloque de `impuestosRows`/`recargosRows`/`descuentosRows`):

```typescript
    let ingredientes: {
      ingredienteItemId: string;
      ingredienteNombre: string;
      cantidad: string;
      unidadCodigo: string;
      bloqueante: boolean;
    }[] = [];
    if (rows[0].tipo === 'receta') {
      const ingRows: {
        ingrediente_item_id: string;
        ingrediente_nombre: string;
        cantidad: string;
        unidad_codigo: string;
        bloqueante: boolean;
      }[] = await this.dataSource.query(
        `SELECT ri.ingrediente_item_id, i.nombre AS ingrediente_nombre,
                ri.cantidad, ri.unidad_codigo, ri.bloqueante
         FROM receta_ingredientes ri
         JOIN items i ON i.item_id = ri.ingrediente_item_id AND i.eliminado_el IS NULL
         WHERE ri.receta_item_id = $1 AND ri.tenant_id = $2 AND ri.eliminado_el IS NULL`,
        [itemId, tenantId],
      );
      ingredientes = ingRows.map((r) => ({
        ingredienteItemId: r.ingrediente_item_id,
        ingredienteNombre: r.ingrediente_nombre,
        cantidad: r.cantidad,
        unidadCodigo: r.unidad_codigo,
        bloqueante: r.bloqueante,
      }));
    }

    return {
      ...this.mapRow(rows[0]),
      impuestosIds: impuestosRows.map((r) => r.impuesto_id),
      recargosIds: recargosRows.map((r) => r.recargo_id),
      descuentosIds: descuentosRows.map((r) => r.descuento_id),
      ingredientes,
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit -m "feat(items): disponibilidad calculada al vuelo en el listado de recetas"
```

---

### Task 6: Seed de desarrollo — receta demo "Hamburguesa Clásica"

Deliverable: al arrancar el backend en dev, existe una receta lista para probar manualmente (pan/carne bloqueantes, queso no bloqueante).

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`

**Interfaces:**
- Consumes: nada (usa `this.dataSource.query` directo, mismo patrón que `seedItemsMonedaUnidadMatrix`).
- Produces: nada consumido por otro task; es un fixture de datos.

- [ ] **Step 1: Implementación**

En `backend/src/modules/seeder/seeder.service.ts`, agregar la llamada dentro de `seedItems()`:

```typescript
  private async seedItems(): Promise<void> {
    await this.seedItemSoporte();
    await this.seedItemsMonedaUnidadMatrix();
    await this.seedItemsSuscripcion();
    await this.seedRecetaDemo();
  }
```

Y el método nuevo (después de `seedItemsMonedaUnidadMatrix`):

```typescript
  /**
   * Receta demo "Hamburguesa Clásica" — pieza 3 del cluster food-service.
   * Pan y carne bloqueantes, queso no bloqueante; carne/queso se compran en
   * kg y la receta los consume en gramos, para ejercitar la conversión.
   */
  private async seedRecetaDemo(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const uuid = (suffix: number): string =>
      `550e8400-e29b-41d4-a716-44665544${String(suffix).padStart(4, '0')}`;

    const PAN_ID = uuid(256);
    const CARNE_ID = uuid(257);
    const QUESO_ID = uuid(258);
    const HAMBURGUESA_ID = uuid(259);
    const RI_PAN_ID = uuid(260);
    const RI_CARNE_ID = uuid(261);
    const RI_QUESO_ID = uuid(262);
    const MOV_PAN_ID = uuid(263);
    const MOV_CARNE_ID = uuid(264);
    const MOV_QUESO_ID = uuid(265);

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items WHERE item_id = $1`,
      [HAMBURGUESA_ID],
    );
    if (exists.length) return;

    const ingredientes = [
      { id: PAN_ID, movId: MOV_PAN_ID, nombre: 'Pan de hamburguesa', unidad: 'unidad', stock: '50', costo: '500' },
      { id: CARNE_ID, movId: MOV_CARNE_ID, nombre: 'Carne molida', unidad: 'kg', stock: '10', costo: '8000' },
      { id: QUESO_ID, movId: MOV_QUESO_ID, nombre: 'Queso laminado', unidad: 'kg', stock: '5', costo: '6000' },
    ];

    for (const ing of ingredientes) {
      await this.dataSource.query(
        `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, precio_base, precio_incluye_impuesto, activo, tipo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'producto')`,
        [ing.id, PARIS, CLP, ing.nombre, ing.costo, false, true],
      );
      await this.dataSource.query(
        `INSERT INTO item_producto (item_id, stock, unidad_medida, modo_inventario, costo_actual)
         VALUES ($1,'0',$2,'cantidad',$3)`,
        [ing.id, ing.unidad, ing.costo],
      );
      await this.dataSource.query(
        `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
        [ing.stock, ing.id],
      );
      await this.dataSource.query(
        `INSERT INTO movimientos_inventario
           (movimiento_id, tenant_id, item_id, tipo, motivo, cantidad, stock_anterior, stock_resultante, costo_unitario, comentario)
         VALUES ($1,$2,$3,'entrada','inventario_inicial',$4,'0',$4,$5,'Stock inicial (seed receta demo)')`,
        [ing.movId, PARIS, ing.id, ing.stock, ing.costo],
      );
    }

    // Hamburguesa: pan (1 unidad, bloqueante) + carne (150 g, bloqueante) + queso (20 g, no bloqueante)
    // costo = 500*1 + 8000*0.15 + 6000*0.02 = 500 + 1200 + 120 = 1820
    await this.dataSource.query(
      `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, precio_base, precio_incluye_impuesto, activo, tipo)
       VALUES ($1,$2,$3,'Hamburguesa Clásica','3500',false,true,'receta')`,
      [HAMBURGUESA_ID, PARIS, CLP],
    );
    await this.dataSource.query(
      `INSERT INTO item_receta (item_id, costo_actual) VALUES ($1,'1820.0000')`,
      [HAMBURGUESA_ID],
    );
    await this.dataSource.query(
      `INSERT INTO receta_ingredientes
         (receta_ingrediente_id, tenant_id, receta_item_id, ingrediente_item_id, cantidad, unidad_codigo, bloqueante)
       VALUES
         ($1,$5,$6,$2,'1','unidad',true),
         ($3,$5,$6,$7,'150','g',true),
         ($4,$5,$6,$8,'20','g',false)`,
      [RI_PAN_ID, PAN_ID, RI_CARNE_ID, RI_QUESO_ID, PARIS, HAMBURGUESA_ID, CARNE_ID, QUESO_ID],
    );
  }
```

- [ ] **Step 2: Verificar manualmente**

Run: `cd backend && npm run start:dev` (o `docker-compose up`), esperar a que el seeder corra, luego:

```bash
curl -s http://localhost:3000/api/items/550e8400-e29b-41d4-a716-446655440259 \
  -H "Authorization: Bearer <token>" | jq
```

Expected: `tipo: "receta"`, `costoActual: "1820.0000"`, `ingredientes` con 3 filas (pan/carne/queso).

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/seeder/seeder.service.ts
git commit -m "feat(seed): receta demo Hamburguesa Clásica para probar el motor de recetas"
```

---

### Task 7: E2E del flujo completo de recetas

Deliverable: `recetas.e2e-spec.ts` cubre creación, venta con y sin stock (bloqueante/no bloqueante), disponibilidad y bloqueo de borrado.

**Files:**
- Create: `backend/test/recetas.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST/GET/DELETE /api/items`, `POST /api/ventas`, `POST /api/items/:id/stock` (ajuste, ya existente de la pieza 2).
- Produces: nada (test hoja).

- [ ] **Step 1: Write the E2E test**

Crear `backend/test/recetas.e2e-spec.ts`:

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
  costoActual: string | null;
  disponible: number | null;
}
interface VentaResponse {
  id: string;
  estado: string;
  advertenciasReceta?: string[];
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

async function crearIngrediente(
  app: INestApplication<App>,
  token: string,
  nombre: string,
  unidad: string,
  stock: string,
  costo: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `${nombre} ${Date.now()}`,
      precioBase: costo,
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: unidad,
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

describe('Recetas — flujo completo (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let panId: string;
  let carneId: string;
  let quesoId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    token = await login(app);
    panId = await crearIngrediente(app, token, 'Pan E2E', 'unidad', '10', '500');
    carneId = await crearIngrediente(app, token, 'Carne E2E', 'kg', '1', '8000');
    quesoId = await crearIngrediente(app, token, 'Queso E2E', 'kg', '0.01', '6000');
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. crea la receta y calcula el costo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          { ingredienteItemId: panId, cantidad: '1', unidadCodigo: 'unidad', bloqueante: true },
          { ingredienteItemId: carneId, cantidad: '150', unidadCodigo: 'g', bloqueante: true },
          { ingredienteItemId: quesoId, cantidad: '20', unidadCodigo: 'g', bloqueante: false },
        ],
      });

    expect(res.status).toBe(201);
    const recetaId = (res.body as ItemResponse).id;

    const resGet = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`);
    // 500*1 + 8000*0.15 + 6000*0.02 = 1820
    expect((resGet.body as ItemResponse).costoActual).toBe('1820.0000');
  });

  it('2-3-4-5. vende con stock suficiente, sin queso (no bloqueante), sin carne (bloqueante) y refleja disponible', async () => {
    const localPan = await crearIngrediente(app, token, 'Pan local', 'unidad', '10', '500');
    // 1 kg = 1000 g; a 150 g/venta alcanzan para 6 ventas exactas (floor(1000/150)=6).
    const localCarne = await crearIngrediente(app, token, 'Carne local', 'kg', '1', '8000');
    // 30 g: alcanza para la primera venta (20 g) pero no para la segunda.
    const localQueso = await crearIngrediente(app, token, 'Queso local', 'kg', '0.03', '6000');

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa local ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          { ingredienteItemId: localPan, cantidad: '1', unidadCodigo: 'unidad', bloqueante: true },
          { ingredienteItemId: localCarne, cantidad: '150', unidadCodigo: 'g', bloqueante: true },
          { ingredienteItemId: localQueso, cantidad: '20', unidadCodigo: 'g', bloqueante: false },
        ],
      });
    const recetaId = (resReceta.body as ItemResponse).id;

    // 5. Disponible: pan floor(10/1)=10, carne floor(1000g/150g)=6 → mínimo 6.
    // Queso no cuenta (no bloqueante), aunque ya sepamos que solo alcanza para 1 venta.
    const resListado = await request(app.getHttpServer())
      .get('/api/items?tipo=receta&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    const recetaListada = (
      resListado.body as { data: ItemResponse[] }
    ).data.find((i) => i.id === recetaId);
    expect(recetaListada?.disponible).toBe(6);

    async function venderUna() {
      return request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: recetaId, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3500' }],
        });
    }

    // 2. Venta con stock suficiente de TODO (queso recién sembrado con 30 g) →
    // sin advertencias. Esta es venta #1 de las 6 que la carne permite.
    const resVenta1 = await venderUna();
    expect(resVenta1.status).toBe(201);
    expect((resVenta1.body as VentaResponse).advertenciasReceta ?? []).toEqual([]);

    // 4. Venta #2: queso quedó en 10 g (30-20), no alcanza para los 20 g
    // requeridos → no bloqueante, se omite con advertencia; pan y carne sí se descuentan.
    const resVenta2 = await venderUna();
    expect(resVenta2.status).toBe(201);
    expect((resVenta2.body as VentaResponse).advertenciasReceta?.length).toBe(1);

    // Ventas #3-#6: la carne todavía alcanza (2 de las 6 ya se usaron).
    for (let i = 0; i < 4; i++) {
      const res = await venderUna();
      expect(res.status).toBe(201);
    }

    // 3. Venta #7: la carne ya se agotó (6*150g = 1000g = el stock total) →
    // ingrediente bloqueante sin stock rechaza la venta completa.
    const resVentaFinal = await venderUna();
    expect(resVentaFinal.status).toBe(400);
  });

  it('6. bloquea borrar un ingrediente en uso', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/items/${panId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `cd backend && npm run test:e2e -- recetas.e2e-spec.ts`
Expected: PASS (requiere el backend apuntando a una base con el seed corrido — igual que el resto de la suite E2E).

- [ ] **Step 3: Commit**

```bash
git add backend/test/recetas.e2e-spec.ts
git commit -m "test(recetas): e2e de creación, venta bloqueante/no bloqueante y disponibilidad"
```

---

### Task 8: Frontend — editor de ingredientes en el form de items

Deliverable: crear/editar un item con `tipo=receta` muestra un editor de filas de ingredientes (buscador de producto, cantidad, unidad filtrada por magnitud, bloqueante) y el costo calculado.

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue`

**Interfaces:**
- Consumes: `GET /items?tipo=producto&pageSize=100` (catálogo de ingredientes elegibles), `unidadesMedidaStore` (pieza 2, ya cargado en `cargarCatalogos`).
- Produces: nada consumido por otro task.

- [ ] **Step 1: Tipos y estado**

En `frontend/app/pages/configuracion/items.vue`, agregar la interfaz de fila de ingrediente junto a `SerieRow` (`:43`):

```typescript
interface IngredienteRow {
  ingredienteItemId: string
  cantidad: string
  unidadCodigo: string
  bloqueante: boolean
}
```

Agregar `ingredientes` a la interfaz `Item` (`:15-41`, junto a `frecuencia`):

```typescript
  ingredientes?: { ingredienteItemId: string; ingredienteNombre: string; cantidad: string; unidadCodigo: string; bloqueante: boolean }[]
  disponible?: number | null
```

Agregar `tiposOpts` la opción receta (`:144-148`):

```typescript
const tiposOpts: Opt[] = [
  { label: 'Producto', value: 'producto' },
  { label: 'Servicio', value: 'servicio' },
  { label: 'Suscripción', value: 'suscripcion' },
  { label: 'Receta', value: 'receta' },
]
```

Agregar el catálogo de productos elegibles como ingrediente, junto a los demás `Opts` (`:138-142`):

```typescript
const productosIngrediente = ref<{ id: string; nombre: string; unidadMedida: string }[]>([])
const productosIngredienteOpts = computed(() =>
  productosIngrediente.value.map(p => ({ label: p.nombre, value: p.id })),
)
```

Agregar `ingredientes` a `emptyForm()` (`:162-193`, junto a `series`):

```typescript
    // ingredientes (modo receta)
    ingredientes: [] as IngredienteRow[],
```

Agregar un ref aparte para mostrar el costo cacheado de una receta en edición (no vive en `form` porque no se envía al backend — lo calcula el servidor):

```typescript
const formCostoActual = ref<string | null>(null)
```

En `resetDrawer()` (`:205-209`), limpiarlo junto al resto del form:

```typescript
function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
  form.value.monedaId = monedasOpts.value[0]?.value ?? ''
  formCostoActual.value = null
}
```

- [ ] **Step 2: Cargar el catálogo de ingredientes**

En `cargarCatalogos()` (`:361-402`), agregar el fetch junto a categorías/impuestos:

```typescript
    const [categorias, impuestos, descuentos, recargos, productos] =
      await Promise.all([
        useApiFetch<any[]>(`${apiUrl}/categorias`),
        useApiFetch<any[]>(`${apiUrl}/impuestos`),
        useApiFetch<any[]>(`${apiUrl}/descuentos`),
        useApiFetch<any[]>(`${apiUrl}/recargos`),
        useApiFetch<PaginatedResponse<Item>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
      ])
```

(agregar `import type { PaginatedResponse } from '~/composables/usePaginatedList'` si no está ya importado en el archivo).

```typescript
    productosIngrediente.value = productos.data
      .filter(p => p.modoInventario === 'cantidad')
      .map(p => ({ id: p.id, nombre: p.nombre, unidadMedida: p.unidadMedida ?? 'unidad' }))
```

- [ ] **Step 3: Cargar ingredientes al editar**

En `abrirEditar()` (`:413-450`), agregar al objeto `form.value`:

```typescript
      ingredientes: (detalle.ingredientes ?? []).map(i => ({
        ingredienteItemId: i.ingredienteItemId,
        cantidad: i.cantidad,
        unidadCodigo: i.unidadCodigo,
        bloqueante: i.bloqueante,
      })),
```

Y justo después, fuera del objeto `form.value`, guardar el costo cacheado para mostrarlo de solo lectura:

```typescript
    formCostoActual.value = detalle.costoActual ?? null
```

- [ ] **Step 4: Payload en `guardar()`**

En `guardar()` (`:452-521`), agregar la rama `receta` junto a `producto`/`servicio` (después del bloque `else if (form.value.tipo === 'servicio')`):

```typescript
    } else if (form.value.tipo === 'servicio') {
      payload.duracionEstimada = form.value.duracionEstimada || undefined
      payload.requiereCita = form.value.requiereCita
    } else if (form.value.tipo === 'receta') {
      payload.ingredientes = form.value.ingredientes
    } else {
      payload.frecuencia = form.value.frecuencia
    }
```

- [ ] **Step 5: Template — editor de ingredientes**

En el template, agregar el bloque después de `<!-- Extensión servicio -->` (`:1044-1058`), como hermano de los `template v-if="form.tipo === ..."`:

```vue
          <!-- Extensión receta -->
          <template v-if="form.tipo === 'receta'">
            <USeparator />
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-muted">Ingredientes ({{ form.ingredientes.length }})</p>
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-plus"
                  @click="form.ingredientes = [...form.ingredientes, { ingredienteItemId: '', cantidad: '', unidadCodigo: '', bloqueante: true }]"
                >Agregar ingrediente</UButton>
              </div>

              <div
                v-for="(ing, idx) in form.ingredientes"
                :key="idx"
                class="grid grid-cols-5 gap-2 items-end"
              >
                <UFormField label="Producto" class="col-span-2">
                  <USelectMenu
                    v-model="form.ingredientes[idx].ingredienteItemId"
                    :items="productosIngredienteOpts"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Cantidad">
                  <UInput v-model="form.ingredientes[idx].cantidad" inputmode="decimal" placeholder="0" class="w-full" />
                </UFormField>
                <UFormField label="Unidad">
                  <USelectMenu
                    v-model="form.ingredientes[idx].unidadCodigo"
                    :items="unidadesMedidaStore.unidades
                      .filter(u => u.magnitud === unidadesMedidaStore.magnitudDe(
                        productosIngrediente.find(p => p.id === form.ingredientes[idx].ingredienteItemId)?.unidadMedida,
                      ))
                      .map(u => ({ label: u.codigo, value: u.codigo }))"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <div class="flex items-end gap-2">
                  <UFormField label="Bloqueante">
                    <USwitch v-model="form.ingredientes[idx].bloqueante" />
                  </UFormField>
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    size="sm"
                    @click="form.ingredientes = form.ingredientes.filter((_, i) => i !== idx)"
                  />
                </div>
              </div>

              <p v-if="editingId && formCostoActual" class="text-xs text-muted">
                Costo actual: {{ formatMonto(formCostoActual, form.monedaId) }}
              </p>
              <p v-else-if="!editingId" class="text-xs text-muted">
                El costo se calcula al guardar, sumando el costo de cada ingrediente.
              </p>
            </div>
          </template>
```

> Nota: el costo (`costoActual`) lo calcula y persiste el backend al guardar — no se recalcula en vivo en el cliente (evita duplicar la lógica de conversión de unidades). Tras guardar, `abrirEditar` vuelve a traer `costoActual` actualizado desde `GET /items/:id`.

- [ ] **Step 6: Verificación manual**

Run: `docker-compose up` (o `cd frontend && npm run dev` con el backend corriendo), login como admin → Configuración → Items → Nuevo item → tipo Receta → agregar 2-3 ingredientes con distinta unidad → Guardar → reabrir en edición y confirmar que los ingredientes y el costo persisten.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/pages/configuracion/items.vue
git commit -m "feat(items): editor de ingredientes en el form para items tipo receta"
```

---

### Task 9: Frontend — POS lista recetas con disponibilidad y advertencias

Deliverable: el POS muestra recetas junto a productos, con badge de disponibilidad; vender con advertencias las muestra en el toast; el click en una receta nunca queda bloqueado por "sin stock" (solo atenuado visualmente).

**Files:**
- Modify: `frontend/app/composables/useVenta.ts`
- Modify: `frontend/app/components/ventas/CatalogoGrid.vue`
- Modify: `frontend/app/pages/ventas/pos.vue`

**Interfaces:**
- Consumes: `GET /items?tipo=receta&pageSize=100` (nuevo fetch), `POST /ventas` → `advertenciasReceta` (Task 4).
- Produces: `ItemCatalogo.disponible: number | null`.

- [ ] **Step 1: `ItemCatalogo` gana `disponible`**

En `frontend/app/composables/useVenta.ts:8-18`:

```typescript
export interface ItemCatalogo {
  id: string
  nombre: string
  descripcion: string | null
  precioBase: string
  monedaId: string
  monedaSimbolo: string | null
  stock: string | null
  unidadMedida: string | null
  tipo: string
  disponible?: number | null
}
```

- [ ] **Step 2: `CatalogoGrid.vue` distingue receta de producto**

En `frontend/app/components/ventas/CatalogoGrid.vue`, reemplazar `tieneStock`/`compararCatalogo`/`onAgregar` (`:12-40`):

```typescript
function tieneStock(item: ItemCatalogo): boolean {
  if (item.stock === null || item.stock === '') return false
  try {
    return new Decimal(item.stock).greaterThan(0)
  }
  catch {
    return false
  }
}

/** Recetas nunca bloquean el click: la validación real vive en el backend. */
function puedeAgregar(item: ItemCatalogo): boolean {
  if (item.tipo === 'receta') return true
  return tieneStock(item)
}

/** Solo atenúa visualmente — no bloquea el click en recetas. */
function sinStockVisual(item: ItemCatalogo): boolean {
  if (item.tipo === 'receta') return item.disponible === 0
  return !tieneStock(item)
}

function compararCatalogo(a: ItemCatalogo, b: ItemCatalogo): number {
  const aConStock = sinStockVisual(a) ? 1 : 0
  const bConStock = sinStockVisual(b) ? 1 : 0
  if (aConStock !== bConStock) return aConStock - bConStock
  return a.nombre.localeCompare(b.nombre, 'es')
}

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  const list = q
    ? props.items.filter((i) => i.nombre.toLowerCase().includes(q))
    : props.items
  return [...list].sort(compararCatalogo)
})

function onAgregar(item: ItemCatalogo) {
  if (!puedeAgregar(item)) return
  emit('add', item)
}
```

Actualizar el template (`:62-99`): la clase del `UCard` y el badge de stock/disponible:

```vue
        <UCard
          v-for="item in filtrados"
          :key="item.id"
          class="h-full transition"
          :class="[
            puedeAgregar(item) ? 'cursor-pointer hover:ring-2 hover:ring-primary' : 'cursor-not-allowed',
            sinStockVisual(item) ? 'opacity-50' : '',
          ]"
          :ui="{ body: 'h-full p-3 sm:p-4' }"
          :aria-disabled="!puedeAgregar(item)"
          @click="onAgregar(item)"
        >
          <div class="flex flex-col h-full gap-1">
            <span class="font-medium text-sm text-default truncate shrink-0">{{ item.nombre }}</span>
            <VentasPrecioItem
              :monto="item.precioBase"
              :moneda-id="item.monedaId"
              highlight
            />
            <div
              v-if="esMonedaExtranjera(item.monedaId) && monedaOficial"
              class="min-h-5 flex items-center shrink-0"
            >
              <VentasPrecioItem
                :monto="convertirAMonedaOficial(item.precioBase, item.monedaId)"
                :moneda-id="monedaOficial.monedaId"
                muted
              />
            </div>
            <span v-if="item.tipo === 'producto'" class="text-xs text-muted shrink-0">
              Stock: {{ formatStock(item.stock, item.unidadMedida) }}
            </span>
            <span v-else-if="item.tipo === 'receta' && item.disponible !== null && item.disponible !== undefined" class="text-xs text-muted shrink-0">
              Disponibles: {{ item.disponible }}
            </span>
            <div
              v-if="!esMonedaExtranjera(item.monedaId)"
              class="min-h-5 shrink-0"
              aria-hidden="true"
            />
          </div>
        </UCard>
```

- [ ] **Step 3: `pos.vue` incluye recetas en el catálogo**

En `frontend/app/pages/ventas/pos.vue`, modificar `cargar()` (`:93-113`) — reemplazar el fetch único de items por dos fetches en paralelo:

```typescript
    const [productosRes, recetasRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ItemCatalogo>>(
        `${apiUrl}/items?tipo=producto&pageSize=100`,
      ),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(
        `${apiUrl}/items?tipo=receta&pageSize=100`,
      ),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    items.value = [...productosRes.data, ...recetasRes.data]
```

(el resto de `cargar()` — asignación de `metodos`/`tiposDocumento`/`tipoDocumentoId` — no cambia).

- [ ] **Step 4: Toast muestra `advertenciasReceta`**

En `confirmarCobro()` (`:155-159`), ampliar el tipo de la respuesta y agregar los toasts de advertencia justo después del toast de éxito:

```typescript
    const venta = await useApiFetch<{ estado: string; advertenciasReceta?: string[] }>(`${apiUrl}/ventas`, {
      method: 'POST',
      body,
    })
    toast.add({ title: estadoToastTitle[venta.estado] ?? 'Venta registrada', color: 'success' })
    for (const advertencia of venta.advertenciasReceta ?? []) {
      toast.add({ title: advertencia, color: 'warning' })
    }
    cobroOpen.value = false
```

- [ ] **Step 5: Verificación manual**

Login → POS → confirmar que "Hamburguesa Clásica" (seed de Task 6) aparece en el catálogo con "Disponibles: 6" (o el valor calculado) → venderla dos veces hasta que el queso se agote → confirmar el toast de advertencia → seguir vendiendo hasta agotar carne → confirmar que la venta se rechaza con 400 y el POS muestra el error.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/composables/useVenta.ts \
        frontend/app/components/ventas/CatalogoGrid.vue \
        frontend/app/pages/ventas/pos.vue
git commit -m "feat(pos): lista recetas con disponibilidad y advertencias de venta"
```

---

### Task 10: Documentación viva

Deliverable: `docs/features/recetas.md` documenta el comportamiento real; `ESTADO.md`, `README.md` y el spec quedan al día.

**Files:**
- Create: `docs/features/recetas.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/README.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/superpowers/specs/2026-07-15-recetas-criticidad-ingredientes-design.md` (Status → Done)

**Interfaces:**
- Consumes: nada (documentación).
- Produces: nada.

- [ ] **Step 1: `docs/features/recetas.md`**

Copiar `docs/features/TEMPLATE.md` a `docs/features/recetas.md` y documentar, contra el código ya mergeado (no contra este plan): el modelo `item_receta`/`receta_ingredientes`, el cálculo de costo cacheado (sin auto-recálculo), el comportamiento de venta (bloqueante aborta, no bloqueante omite + advertencia), la disponibilidad calculada al vuelo, y el link al spec y al análisis de alineamiento (pieza 3 de 5).

- [ ] **Step 2: `docs/README.md`**

Agregar el link a `docs/features/recetas.md` en la tabla/lista de features existente, junto a `conversion-unidades.md`.

- [ ] **Step 3: `docs/ESTADO.md`**

Agregar la fila (junto a las de costo por producto / conversión de unidades):

```markdown
| Recetas + criticidad de ingredientes (bloqueante/no bloqueante) | ✅ Implementado (2026-07-15) |
```

- [ ] **Step 4: Spec → Done**

En `docs/superpowers/specs/2026-07-15-recetas-criticidad-ingredientes-design.md`, cambiar:

```markdown
**Status**: Done (implementado 2026-07-15)
```

- [ ] **Step 5: Commit**

```bash
git add docs/features/recetas.md docs/README.md docs/ESTADO.md \
        docs/superpowers/specs/2026-07-15-recetas-criticidad-ingredientes-design.md
git commit -m "docs(recetas): documenta el motor de recetas (pieza 3 cluster food-service)"
```

---

## Verification (whole feature)

- [ ] `cd backend && npm test` — toda la suite unitaria pasa, incluidos los tests preexistentes de `items.service.spec.ts`/`ventas.service.spec.ts` sin cambios de comportamiento para `producto`/`servicio`/`suscripcion`.
- [ ] `cd backend && npm run test:e2e -- recetas.e2e-spec.ts` — pasa contra una BD con el seed corrido.
- [ ] `cd backend && npx tsc --noEmit` — sin errores de tipos.
- [ ] `cd backend && npm run lint` — limpio.
- [ ] `cd frontend && npm run build` — sin errores.
- [ ] Manual: `docker-compose up` desde cero (`down -v` si se necesita un volumen limpio — **destructivo, pedir confirmación antes de correrlo**), login, crear una receta nueva en el form, venderla en el POS con y sin stock de un ingrediente no bloqueante, confirmar la advertencia y el `disponible` bajando en el listado.

## Decisions

Todas las decisiones de diseño (modelado `items.tipo='receta'`, costo cacheado sin auto-recálculo, bloqueante aborta vs. no bloqueante omite, sin recetas anidadas, ingredientes solo modo `cantidad`, disponibilidad al vuelo, borrado bloqueado) están documentadas y justificadas en la sección **Decisions** del [spec](../specs/2026-07-15-recetas-criticidad-ingredientes-design.md#decisions).

**Ajustes post-review del plan (2026-07-15):**
- Soft-delete al reemplazar ingredientes (nunca `DELETE FROM`); entidad `RecetaIngrediente` declara `creado_el`/`actualizado_el`/`eliminado_el` para que `synchronize:true` no los dropee.
- No-bloqueante: try/catch sobre `registrarMovimiento` (mensaje exacto `'Stock insuficiente para la salida'`) en vez de pre-chequeo de stock — evita carrera entre SELECT y FOR UPDATE.
- `cantidad > 0` validada en `validarYCostearIngredientes`; índice único parcial `(receta_item_id, ingrediente_item_id) WHERE eliminado_el IS NULL`.
