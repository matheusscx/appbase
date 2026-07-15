# Motor de conversión de unidades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un producto stockeado en kg puede recibir una entrada o merma expresada en gramos, y el kardex la registra convertida a su unidad base.

**Architecture:** Una tabla global `unidades_medida` (sembrada, sin `tenant_id`, como `moneda`/`pais`) declara `codigo`, `magnitud` y `factor_base`. `CatalogService.convertirUnidad` resuelve cualquier par dentro de una magnitud con `cantidad × factor_desde / factor_hacia` en Decimal.js. La conversión ocurre en `ItemsService.ajustarStock` **antes** de llamar a `registrarMovimiento`, que sigue siendo agnóstico de unidades: el kardex siempre queda en la unidad base del producto. El catálogo pasa a ser la única fuente de verdad, reemplazando los tres hardcodes actuales.

**Tech Stack:** NestJS + TypeORM (`synchronize: true` en dev — no hay migraciones), PostgreSQL 15, Decimal.js, Jest + supertest, Nuxt 4 + Pinia + Nuxt UI, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-14-motor-conversion-unidades-design.md`](../specs/2026-07-14-motor-conversion-unidades-design.md) — pieza 2 de 5 del cluster food-service.

## Global Constraints

- **Trabajar y commitear directamente sobre `main`.** No crear ramas ni PRs.
- **Toda aritmética de dinero, cantidades y factores usa Decimal.js.** Nunca `number` nativo.
- **Toda columna PK/FK de UUID declara `type: 'uuid'` explícito** (ADR-004). Sin él TypeORM infiere `varchar` y rompe los JOINs en SQL raw.
- **Soft delete en todo:** columna `eliminado_el TIMESTAMPTZ`; toda lectura filtra `IS NULL`. `@DeleteDateColumn` hace que `repo.find()` lo filtre solo.
- **`tenant_id` siempre del token del usuario autenticado, nunca del body.** (`unidades_medida` es global: no tiene `tenant_id`.)
- **Design System:** solo tokens semánticos de Nuxt UI (`text-muted`, `bg-default`, `divide-default`). Nunca Tailwind hardcodeado (`text-gray-500`, `bg-white dark:bg-gray-900`).
- **Seed:** un método privado por entidad en `seeder.service.ts`; IDs fijos con patrón `550e8400-e29b-41d4-a716-446655440XXX`. Números libres para esta feature: **0250–0255** (el máximo en uso hoy es 0249).
- **Escala de stock:** `NUMERIC(18,4)`. Toda cantidad convertida se redondea a 4 decimales.
- **Códigos del catálogo (exactos):** `g` (masa, 1), `kg` (masa, 1000), `ml` (volumen, 1), `l` (volumen, 1000), `unidad` (conteo, 1), `m` (longitud, 1).
- **Compatibilidad sin migración de datos:** los códigos `unidad`, `kg`, `l`, `m` ya existen en datos sembrados (`seeder.service.ts:2056-2061`). El catálogo DEBE incluirlos o la validación nueva rompe el propio seed.
- **No romper los tests existentes.** `items.service.spec.ts` mockea `manager.query` en secuencia y afirma con `toHaveBeenNthCalledWith(n, ...)`: agregar queries incondicionales corre los índices y rompe tests ajenos. Las queries nuevas de este plan son **condicionales** (solo cuando llega `unidadCodigo` / `unidadMedida`), por lo que los tests actuales no cambian.

## File Structure

**Backend — crear:**
- `backend/src/modules/catalog/entities/unidad-medida.entity.ts` — la entidad del catálogo global.

**Backend — modificar:**
- `backend/src/app.module.ts:115+` — registrar la entidad en el array `entities` (es explícito, no `autoLoadEntities`; sin esto `synchronize` no crea la tabla).
- `backend/src/modules/catalog/catalog.module.ts` — `forFeature` + entidad.
- `backend/src/modules/catalog/catalog.service.ts` — `findAllUnidadesMedida` + `convertirUnidad`.
- `backend/src/modules/catalog/catalog.controller.ts` — `GET /catalog/unidades-medida`.
- `backend/src/modules/catalog/catalog.service.spec.ts` — tests del catálogo y la conversión.
- `backend/src/modules/seeder/seeder.service.ts` — `seedUnidadesMedida()` + llamada en el orden de arranque.
- `backend/src/modules/items/items.module.ts` — importar `CatalogModule`.
- `backend/src/modules/items/items.service.ts` — validación de unidad (create/update) + conversión en `ajustarStock`.
- `backend/src/modules/items/items.service.spec.ts` — provider mock de `CatalogService` + tests nuevos.
- `backend/src/modules/items/dto/ajuste-stock.dto.ts` — `unidadCodigo?`.
- `backend/test/inventario.e2e-spec.ts` — E2E del flujo de conversión.
- `startup-pos.sql` — documentar la tabla (referencia de esquema, no se ejecuta).

**Frontend — crear:**
- `frontend/app/stores/unidades-medida.ts` — store global del catálogo (mirror de `stores/monedas.ts`, sin scope de tenant).
- `frontend/app/stores/unidades-medida.spec.ts` — tests del store.

**Frontend — modificar:**
- `frontend/app/utils/stock-format.ts` — deja de conocer códigos; recibe `fraccionaria: boolean`.
- `frontend/app/utils/stock-format.spec.ts` — adaptar a la firma nueva.
- `frontend/app/composables/useFormatters.ts` — `formatStock` consulta el store (firma pública sin cambios para los llamadores).
- `frontend/app/pages/configuracion/items.vue` — selector alimentado por el catálogo + unidad en el ajuste de stock.

**Docs:**
- `docs/features/conversion-unidades.md` (nuevo, desde `docs/features/TEMPLATE.md`), `docs/README.md`, `docs/ESTADO.md`, y el spec a `Status: Done`.

---

### Task 1: Catálogo `unidades_medida` — entidad, seed y endpoint

Fundación: sin catálogo no hay nada que validar ni convertir. Deliverable: `GET /catalog/unidades-medida` devuelve las 6 unidades sembradas.

**Files:**
- Create: `backend/src/modules/catalog/entities/unidad-medida.entity.ts`
- Modify: `backend/src/app.module.ts` (imports + array `entities` en `:115`)
- Modify: `backend/src/modules/catalog/catalog.module.ts`
- Modify: `backend/src/modules/catalog/catalog.service.ts`
- Modify: `backend/src/modules/catalog/catalog.controller.ts`
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Modify: `startup-pos.sql`
- Test: `backend/src/modules/catalog/catalog.service.spec.ts`

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces:
  - Entidad `UnidadMedida` con props `unidadMedidaId: string`, `codigo: string`, `nombre: string`, `magnitud: string`, `factorBase: string` (numeric ↦ **string**), `creadoEl/actualizadoEl/eliminadoEl: Date`.
  - `CatalogService.findAllUnidadesMedida(): Promise<UnidadMedida[]>`
  - `GET /catalog/unidades-medida`

- [x] **Step 1: Write the failing test**

En `backend/src/modules/catalog/catalog.service.spec.ts`, agregar el import y el mock arriba (junto a `mockPais`):

```typescript
import { UnidadMedida } from './entities/unidad-medida.entity';

const mockUnidadMedida: UnidadMedida = {
  unidadMedidaId: 'unidad-uuid',
  codigo: 'kg',
  nombre: 'Kilogramo',
  magnitud: 'masa',
  factorBase: '1000.000000',
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null as unknown as Date,
};
```

Declarar el repo mock junto a `paisRepo` / `provinciaRepo`:

```typescript
  let unidadMedidaRepo: { find: jest.Mock };
```

Inicializarlo en `beforeEach` junto a los otros (antes de `Test.createTestingModule`):

```typescript
    unidadMedidaRepo = { find: jest.fn() };
```

Y registrar el provider en el array `providers`, después del de `Provincia`:

```typescript
        { provide: getRepositoryToken(UnidadMedida), useValue: unidadMedidaRepo },
```

Agregar el bloque de test al final del `describe('CatalogService')`, después de `describe('findAllProvincias')`:

```typescript
  describe('findAllUnidadesMedida', () => {
    it('retorna las unidades ordenadas por magnitud y factor', async () => {
      unidadMedidaRepo.find.mockResolvedValue([mockUnidadMedida]);
      const result = await service.findAllUnidadesMedida();
      expect(result).toEqual([mockUnidadMedida]);
      expect(unidadMedidaRepo.find).toHaveBeenCalledWith({
        order: { magnitud: 'ASC', factorBase: 'ASC' },
      });
    });
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/catalog/catalog.service.spec.ts -t "findAllUnidadesMedida"`
Expected: FAIL — el módulo `./entities/unidad-medida.entity` no existe (error de compilación TS).

- [x] **Step 3: Create the entity**

Crear `backend/src/modules/catalog/entities/unidad-medida.entity.ts`:

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Catálogo global de unidades de medida (sin tenant_id — un kg es un kg en
 * todos los tenants, igual que `moneda` y `pais`).
 *
 * La conversión dentro de una misma magnitud es:
 *   cantidad × (factor_base_desde / factor_base_hacia)
 */
@Entity('unidades_medida')
export class UnidadMedida {
  @PrimaryGeneratedColumn('uuid', { name: 'unidad_medida_id' })
  unidadMedidaId: string;

  /** Código guardado en `item_producto.unidad_medida` (kg, g, l, ml, unidad, m). */
  @Column({ type: 'text', unique: true })
  codigo: string;

  @Column({ type: 'text' })
  nombre: string;

  /** 'masa' | 'volumen' | 'conteo' | 'longitud'. Solo se convierte dentro de una magnitud. */
  @Column({ type: 'text' })
  magnitud: string;

  /** Cuántas unidades base de la magnitud equivale 1 de esta (kg → 1000 g). */
  @Column({ name: 'factor_base', type: 'numeric', precision: 18, scale: 6 })
  factorBase: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date;
}
```

- [x] **Step 4: Register the entity so `synchronize` creates the table**

En `backend/src/app.module.ts`, agregar el import junto a los otros de `catalog/entities` (cerca de `:18`):

```typescript
import { UnidadMedida } from './modules/catalog/entities/unidad-medida.entity';
```

Y agregar `UnidadMedida,` al array `entities` (`:115`), inmediatamente después de `Moneda,` (`:120`).

> Sin esto la tabla no se crea: el array `entities` es explícito, no hay `autoLoadEntities`.

En `backend/src/modules/catalog/catalog.module.ts`, importar la entidad y agregarla al `forFeature`:

```typescript
import { UnidadMedida } from './entities/unidad-medida.entity';
```

```typescript
  imports: [
    TypeOrmModule.forFeature([ModuloApp, Permiso, Pais, Provincia, UnidadMedida]),
  ],
```

- [x] **Step 5: Implement the service method**

En `backend/src/modules/catalog/catalog.service.ts`, agregar el import:

```typescript
import { UnidadMedida } from './entities/unidad-medida.entity';
```

Inyectar el repo en el constructor, después de `provinciaRepo`:

```typescript
    @InjectRepository(UnidadMedida)
    private readonly unidadMedidaRepo: Repository<UnidadMedida>,
```

Y agregar el método al final de la clase:

```typescript
  findAllUnidadesMedida(): Promise<UnidadMedida[]> {
    return this.unidadMedidaRepo.find({
      order: { magnitud: 'ASC', factorBase: 'ASC' },
    });
  }
```

- [x] **Step 6: Run test to verify it passes**

Run: `cd backend && npx jest src/modules/catalog/catalog.service.spec.ts`
Expected: PASS — todos los tests del archivo, incluido `findAllUnidadesMedida`.

- [x] **Step 7: Expose the endpoint**

En `backend/src/modules/catalog/catalog.controller.ts`, agregar al final de la clase:

```typescript
  @Get('unidades-medida')
  findAllUnidadesMedida() {
    return this.catalogService.findAllUnidadesMedida();
  }
```

- [x] **Step 8: Seed the catalog**

En `backend/src/modules/seeder/seeder.service.ts`, agregar la llamada inmediatamente después de `await this.seedMonedas();` (`:130`) — antes de `seedItems`, que crea productos que referencian estos códigos:

```typescript
    await this.seedUnidadesMedida();
```

Y agregar el método privado justo después del método `seedMonedas()` (que termina en `:225`):

```typescript
  /**
   * Catálogo global de unidades de medida. `factor_base` = cuántas unidades
   * base de la magnitud equivale 1 de esta (kg → 1000 g).
   * Incluye 'unidad', 'kg', 'l' y 'm' porque ya hay datos sembrados con esos
   * códigos (ver seedItemsMonedaUnidadMatrix): quitarlos rompería la validación.
   */
  private async seedUnidadesMedida(): Promise<void> {
    const unidades = [
      { id: '550e8400-e29b-41d4-a716-446655440250', codigo: 'g', nombre: 'Gramo', magnitud: 'masa', factorBase: '1' },
      { id: '550e8400-e29b-41d4-a716-446655440251', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'masa', factorBase: '1000' },
      { id: '550e8400-e29b-41d4-a716-446655440252', codigo: 'ml', nombre: 'Mililitro', magnitud: 'volumen', factorBase: '1' },
      { id: '550e8400-e29b-41d4-a716-446655440253', codigo: 'l', nombre: 'Litro', magnitud: 'volumen', factorBase: '1000' },
      { id: '550e8400-e29b-41d4-a716-446655440254', codigo: 'unidad', nombre: 'Unidad', magnitud: 'conteo', factorBase: '1' },
      { id: '550e8400-e29b-41d4-a716-446655440255', codigo: 'm', nombre: 'Metro', magnitud: 'longitud', factorBase: '1' },
    ];

    for (const u of unidades) {
      await this.dataSource.query(
        `INSERT INTO unidades_medida (unidad_medida_id, codigo, nombre, magnitud, factor_base)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [u.id, u.codigo, u.nombre, u.magnitud, u.factorBase],
      );
    }
  }
```

- [x] **Step 9: Document the table in the schema reference**

En `startup-pos.sql`, agregar el bloque inmediatamente después del `CREATE TABLE "moneda"` (que termina en `:78`):

```sql
-- Catálogo global de unidades de medida (sin tenant_id: son hechos físicos).
-- Conversión dentro de una magnitud: cantidad × (factor_base_desde / factor_base_hacia)
CREATE TABLE "unidades_medida" (
  "unidad_medida_id" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "codigo"           TEXT          UNIQUE NOT NULL,  -- guardado en item_producto.unidad_medida
  "nombre"           TEXT          NOT NULL,
  "magnitud"         TEXT          NOT NULL,  -- 'masa' | 'volumen' | 'conteo' | 'longitud'
  "factor_base"      NUMERIC(18,6) NOT NULL,  -- kg → 1000 (base: g)
  "creado_el"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"   TIMESTAMPTZ,
  "eliminado_el"     TIMESTAMPTZ
);
```

- [x] **Step 10: Verify the seed runs and the endpoint answers**

Run: `docker-compose up --build backend` (o `cd backend && npm run start:dev` si el stack ya corre)
Expected: el backend arranca sin errores de TypeORM y sin errores de seed.

Verificar la tabla y los datos:

```bash
docker-compose exec -T db psql -U postgres -d startup_pos -c "SELECT codigo, magnitud, factor_base FROM unidades_medida ORDER BY magnitud, factor_base;"
```

Expected: 6 filas — `g|masa|1.000000`, `kg|masa|1000.000000`, `unidad|conteo|1.000000`, `m|longitud|1.000000`, `ml|volumen|1.000000`, `l|volumen|1000.000000`.

- [x] **Step 11: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, sin regresiones. (Nota: `auth.service.spec` y `ventas.service.spec` tienen 2 errores de tsc **preexistentes** en `main`, ajenos a esta feature — no intentes arreglarlos, solo confirma que no aparecieron errores nuevos.)

- [x] **Step 12: Commit**

```bash
git add backend/src/modules/catalog backend/src/app.module.ts backend/src/modules/seeder/seeder.service.ts startup-pos.sql
git commit -m "feat(catalog): catálogo global de unidades de medida con magnitud y factor base"
```

---

### Task 2: Servicio de conversión

Deliverable: `convertirUnidad` convierte dentro de una magnitud y falla explícitamente en todo lo demás.

**Files:**
- Modify: `backend/src/modules/catalog/catalog.service.ts`
- Test: `backend/src/modules/catalog/catalog.service.spec.ts`

**Interfaces:**
- Consumes: `UnidadMedida` y el repo inyectado (Task 1).
- Produces: `CatalogService.convertirUnidad(cantidad: string, codigoDesde: string, codigoHacia: string): Promise<string>` — devuelve la cantidad convertida, redondeada a 4 decimales, como string. Lanza `BadRequestException` si alguna unidad no existe, si las magnitudes difieren, o si el resultado redondearía a 0 con cantidad de entrada > 0.

- [x] **Step 1: Write the failing tests**

En `backend/src/modules/catalog/catalog.service.spec.ts`, agregar los mocks de las unidades que usan los tests, junto a `mockUnidadMedida`:

```typescript
const unidadG: UnidadMedida = { ...mockUnidadMedida, unidadMedidaId: 'g-uuid', codigo: 'g', nombre: 'Gramo', magnitud: 'masa', factorBase: '1.000000' };
const unidadKg: UnidadMedida = { ...mockUnidadMedida, unidadMedidaId: 'kg-uuid', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'masa', factorBase: '1000.000000' };
const unidadL: UnidadMedida = { ...mockUnidadMedida, unidadMedidaId: 'l-uuid', codigo: 'l', nombre: 'Litro', magnitud: 'volumen', factorBase: '1000.000000' };
```

Y agregar el bloque de tests al final del `describe('CatalogService')`:

```typescript
  describe('convertirUnidad', () => {
    it('convierte de una unidad mayor a una menor (kg → g)', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadG, unidadKg]);
      expect(await service.convertirUnidad('2', 'kg', 'g')).toBe('2000');
    });

    it('convierte de una unidad menor a una mayor (g → kg)', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadG, unidadKg]);
      expect(await service.convertirUnidad('500', 'g', 'kg')).toBe('0.5');
    });

    it('devuelve la cantidad intacta si la unidad es la misma, sin consultar el catálogo', async () => {
      expect(await service.convertirUnidad('7.5', 'kg', 'kg')).toBe('7.5');
      expect(unidadMedidaRepo.find).not.toHaveBeenCalled();
    });

    it('redondea a 4 decimales (la escala de stock)', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadG, unidadKg]);
      expect(await service.convertirUnidad('1', 'g', 'kg')).toBe('0.001');
    });

    it('rechaza una unidad desconocida', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadKg]);
      await expect(service.convertirUnidad('1', 'inventada', 'kg')).rejects.toThrow(
        'Unidad de medida no reconocida: inventada',
      );
    });

    it('rechaza convertir entre magnitudes distintas', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadKg, unidadL]);
      await expect(service.convertirUnidad('1', 'l', 'kg')).rejects.toThrow(
        'No se puede convertir de volumen a masa',
      );
    });

    it('rechaza una cantidad que se perdería al redondear a la precisión de stock', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadG, unidadKg]);
      await expect(service.convertirUnidad('0.00004', 'g', 'kg')).rejects.toThrow(
        'menor a la precisión de stock',
      );
    });
  });
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/modules/catalog/catalog.service.spec.ts -t "convertirUnidad"`
Expected: FAIL — `service.convertirUnidad is not a function`.

- [x] **Step 3: Implement `convertirUnidad`**

En `backend/src/modules/catalog/catalog.service.ts`, ajustar los imports del tope:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import Decimal from 'decimal.js';
```

Y agregar el método al final de la clase:

```typescript
  /**
   * Convierte una cantidad entre dos unidades de la misma magnitud.
   * Solo dentro de una magnitud: pasar de litros a kilos exigiría la densidad
   * del insumo, que el sistema no modela — fallar es más honesto que adivinar.
   */
  async convertirUnidad(
    cantidad: string,
    codigoDesde: string,
    codigoHacia: string,
  ): Promise<string> {
    if (codigoDesde === codigoHacia) return cantidad;

    const unidades = await this.unidadMedidaRepo.find({
      where: { codigo: In([codigoDesde, codigoHacia]) },
    });
    const desde = unidades.find((u) => u.codigo === codigoDesde);
    const hacia = unidades.find((u) => u.codigo === codigoHacia);

    if (!desde) {
      throw new BadRequestException(
        `Unidad de medida no reconocida: ${codigoDesde}`,
      );
    }
    if (!hacia) {
      throw new BadRequestException(
        `Unidad de medida no reconocida: ${codigoHacia}`,
      );
    }
    if (desde.magnitud !== hacia.magnitud) {
      throw new BadRequestException(
        `No se puede convertir de ${desde.magnitud} a ${hacia.magnitud}`,
      );
    }

    const original = new Decimal(cantidad);
    const convertida = original
      .mul(desde.factorBase)
      .div(hacia.factorBase)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    if (convertida.isZero() && original.greaterThan(0)) {
      throw new BadRequestException(
        `La cantidad convertida (${original.toString()} ${codigoDesde} → ${codigoHacia}) es menor a la precisión de stock (4 decimales)`,
      );
    }

    return convertida.toString();
  }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/modules/catalog/catalog.service.spec.ts`
Expected: PASS — todos los tests del archivo.

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/catalog
git commit -m "feat(catalog): servicio de conversión de unidades por magnitud y factor base"
```

---

### Task 3: Validar la unidad del producto contra el catálogo

Hoy la API acepta cualquier string como unidad. Deliverable: crear/editar con un código inexistente falla, y cambiar la unidad de un producto con movimientos falla.

**Files:**
- Modify: `backend/src/modules/items/items.module.ts`
- Modify: `backend/src/modules/items/items.service.ts` (create `:258-273`, update `:433-474`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `CatalogService.findAllUnidadesMedida()` (Task 1).
- Produces: `ItemsService.validarUnidadMedida(codigo: string): Promise<void>` (privado) — usado también por Task 4.

**Contexto crítico — por qué se compara contra el valor actual:** el frontend manda `payload.unidadMedida` en **toda** edición de producto, incondicionalmente (`items.vue:472`). Un chequeo ingenuo (`if (dto.unidadMedida !== undefined && hayMovimientos) throw`) rompería toda edición de cualquier producto con movimientos. Por eso solo se rechaza cuando el valor **cambia** de verdad.

- [x] **Step 1: Write the failing tests**

En `backend/src/modules/items/items.service.spec.ts`, agregar el import:

```typescript
import { CatalogService } from '../catalog/catalog.service';
```

Declarar el mock junto a `inventarioServiceMock` (`:23`):

```typescript
  let catalogServiceMock: {
    findAllUnidadesMedida: jest.Mock;
    convertirUnidad: jest.Mock;
  };
```

Inicializarlo en `beforeEach` junto a `inventarioServiceMock` (`:35`):

```typescript
    catalogServiceMock = {
      findAllUnidadesMedida: jest.fn().mockResolvedValue([
        { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
        { codigo: 'g', magnitud: 'masa', factorBase: '1' },
        { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
      ]),
      convertirUnidad: jest.fn(),
    };
```

Registrar el provider en `providers`, después del de `InventarioService` (`:50`):

```typescript
        { provide: CatalogService, useValue: catalogServiceMock },
```

Agregar el bloque de tests al final del `describe` principal:

```typescript
  describe('validación de unidad de medida', () => {
    it('rechaza crear un producto con una unidad que no está en el catálogo', async () => {
      await expect(
        service.create('tenant-uuid', 'usuario-uuid', {
          nombre: 'Producto raro',
          precioBase: '1000',
          monedaId: 'moneda-uuid',
          tipo: 'producto',
          unidadMedida: 'inventada',
        } as never),
      ).rejects.toThrow('Unidad de medida no reconocida: inventada');
    });

    it('rechaza cambiar la unidad de un producto que ya tiene movimientos', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }]) // lectura del item
        .mockResolvedValueOnce([{ unidad_medida: 'kg' }]) // unidad actual
        .mockResolvedValueOnce([{ cnt: '3' }]); // movimientos existentes

      await expect(
        service.update('tenant-uuid', 'item-uuid', { unidadMedida: 'g' } as never),
      ).rejects.toThrow(
        'No se puede cambiar la unidad de medida de un producto con movimientos registrados',
      );
    });

    it('permite reenviar la misma unidad en una edición aunque haya movimientos', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([{ unidad_medida: 'kg' }])
        .mockResolvedValue([]);

      await expect(
        service.update('tenant-uuid', 'item-uuid', { unidadMedida: 'kg' } as never),
      ).resolves.toBeDefined();
    });
  });
```

> Los tres tests usan `as never` en el DTO porque los DTOs tienen campos requeridos que no aportan al caso; es el atajo que ya usa este spec. Si `service.update` en este spec necesita un shape distinto (por ejemplo un `findOne` previo), ajustá los `mockResolvedValueOnce` para que calcen con el orden real de queries: **léelo del código antes de escribir el test**, no adivines.

- [x] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/modules/items/items.service.spec.ts -t "validación de unidad de medida"`
Expected: FAIL — no se lanza ninguna excepción (la validación aún no existe).

- [x] **Step 3: Wire CatalogModule into ItemsModule**

En `backend/src/modules/items/items.module.ts`, agregar el import y el módulo:

```typescript
import { CatalogModule } from '../catalog/catalog.module';
```

```typescript
  imports: [
    TypeOrmModule.forFeature([
      Item,
      ItemProducto,
      ItemServicio,
      ItemSuscripcion,
      ItemLote,
      ItemUnidad,
    ]),
    InventarioModule,
    CatalogModule,
  ],
```

> `CatalogModule` ya exporta `CatalogService` (`catalog.module.ts:14`) — no hay que tocarlo.

- [x] **Step 4: Implement the validation**

En `backend/src/modules/items/items.service.ts`, agregar el import:

```typescript
import { CatalogService } from '../catalog/catalog.service';
```

Inyectar el servicio en el constructor, junto a `inventarioService`:

```typescript
    private readonly catalogService: CatalogService,
```

Agregar el método privado (ponelo cerca de `ajustarStock`, que lo reusa en Task 4):

```typescript
  /** Valida que el código exista en el catálogo global de unidades de medida. */
  private async validarUnidadMedida(codigo: string): Promise<void> {
    const unidades = await this.catalogService.findAllUnidadesMedida();
    if (!unidades.some((u) => u.codigo === codigo)) {
      const validas = unidades.map((u) => u.codigo).join(', ');
      throw new BadRequestException(
        `Unidad de medida no reconocida: ${codigo}. Válidas: ${validas}`,
      );
    }
  }
```

En `create`, dentro del bloque `if (dto.tipo === 'producto') {` (`:258`), **antes** del `INSERT INTO item_producto`:

```typescript
        if (dto.unidadMedida !== undefined) {
          await this.validarUnidadMedida(dto.unidadMedida);
        }
```

En `update`, dentro de `if (tipo === 'producto') {` (`:433`), **antes** del bloque que arma `prodClauses` (`:448`) y después del chequeo de `modoInventario`:

```typescript
        // Cambiar la unidad base con stock ya acumulado lo corrompería en silencio:
        // 100 kg pasarían a leerse como 100 g. Solo se rechaza si cambia de verdad
        // (el frontend reenvía la unidad en toda edición).
        if (dto.unidadMedida !== undefined) {
          await this.validarUnidadMedida(dto.unidadMedida);

          const prodRows: { unidad_medida: string }[] = await manager.query(
            `SELECT unidad_medida FROM item_producto WHERE item_id = $1`,
            [itemId],
          );
          if (prodRows.length && prodRows[0].unidad_medida !== dto.unidadMedida) {
            const movRows: { cnt: string }[] = await manager.query(
              `SELECT COUNT(*) AS cnt FROM movimientos_inventario
               WHERE item_id = $1 AND eliminado_el IS NULL`,
              [itemId],
            );
            if (parseInt(movRows[0].cnt) > 0) {
              throw new BadRequestException(
                'No se puede cambiar la unidad de medida de un producto con movimientos registrados',
              );
            }
          }
        }
```

- [x] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/modules/items/items.service.spec.ts`
Expected: PASS — los tests nuevos y **todos los preexistentes** del archivo. Si alguno preexistente falla por orden de `toHaveBeenNthCalledWith`, revisá que las queries nuevas sean condicionales (solo corren con `dto.unidadMedida !== undefined`) y no las hayas puesto en un camino incondicional.

- [x] **Step 6: Commit**

```bash
git add backend/src/modules/items
git commit -m "feat(items): valida la unidad de medida contra el catálogo y bloquea el cambio con movimientos"
```

---

### Task 4: Conversión en el ajuste de stock

El corazón de la pieza. Deliverable: `PATCH /items/:id/stock` con `unidadCodigo: 'g'` sobre un producto en kg descuenta el equivalente correcto.

**Files:**
- Modify: `backend/src/modules/items/dto/ajuste-stock.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts:560-595` (`ajustarStock`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `CatalogService.convertirUnidad` (Task 2), `validarUnidadMedida` (Task 3).
- Produces: `AjusteStockDto.unidadCodigo?: string`. `registrarMovimiento` **no cambia de firma**: sigue recibiendo `cantidad` ya en unidad base.

- [x] **Step 1: Write the failing tests**

En `backend/src/modules/items/items.service.spec.ts`, agregar al final:

```typescript
  describe('ajustarStock — conversión de unidades', () => {
    it('convierte la cantidad a la unidad base antes de registrar el movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          { unidad_medida: 'kg', modo_inventario: 'cantidad' },
        ]);
      catalogServiceMock.convertirUnidad.mockResolvedValue('0.5');
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        stockResultante: '0.5000',
      });

      await service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
        cantidad: 500,
        tipo: 'entrada',
        motivo: 'compra',
        unidadCodigo: 'g',
      } as never);

      expect(catalogServiceMock.convertirUnidad).toHaveBeenCalledWith('500', 'g', 'kg');
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ cantidad: '0.5' }),
      );
    });

    it('no consulta el catálogo si no se envía unidadCodigo', async () => {
      managerMock.query.mockResolvedValueOnce([{ tipo: 'producto' }]);
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        stockResultante: '10.0000',
      });

      await service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
        cantidad: 10,
        tipo: 'entrada',
        motivo: 'compra',
      } as never);

      expect(catalogServiceMock.convertirUnidad).not.toHaveBeenCalled();
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ cantidad: '10' }),
      );
    });

    it('rechaza una unidad distinta a la base en productos por serie', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          { unidad_medida: 'unidad', modo_inventario: 'serie' },
        ]);

      await expect(
        service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
          cantidad: 2,
          tipo: 'entrada',
          motivo: 'compra',
          unidadCodigo: 'kg',
        } as never),
      ).rejects.toThrow('solo admiten su unidad base');

      expect(inventarioServiceMock.registrarMovimiento).not.toHaveBeenCalled();
    });
  });
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/modules/items/items.service.spec.ts -t "conversión de unidades"`
Expected: FAIL — `convertirUnidad` no se llama y la cantidad llega sin convertir (`'500'` en vez de `'0.5'`).

- [x] **Step 3: Add the DTO field**

En `backend/src/modules/items/dto/ajuste-stock.dto.ts`, agregar dentro de `AjusteStockDto`, después de `comentario` (`:70`):

```typescript
  // Unidad en la que viene `cantidad`. Si difiere de la unidad base del producto,
  // se convierte antes de registrar el movimiento. Distinto de `unidadIds`, que
  // son IDs de unidades serializadas (item_unidad).
  @IsString()
  @IsOptional()
  unidadCodigo?: string;
```

- [x] **Step 4: Implement the conversion**

En `backend/src/modules/items/items.service.ts`, reemplazar el cuerpo de `ajustarStock` (`:560-595`) por:

```typescript
  async ajustarStock(
    tenantId: string,
    usuarioId: string,
    itemId: string,
    dto: AjusteStockDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const itemRows: { tipo: string }[] = await manager.query(
        `SELECT tipo FROM items
         WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [itemId, tenantId],
      );
      if (!itemRows.length) throw new NotFoundException('Item no encontrado');
      if (itemRows[0].tipo !== 'producto') {
        throw new BadRequestException('El item no es un producto');
      }

      // La conversión ocurre acá y no en registrarMovimiento: el kardex siempre
      // guarda la unidad base del producto, así que no necesita saber de unidades.
      let cantidad = new Decimal(dto.cantidad).toString();
      if (dto.unidadCodigo) {
        const prodRows: { unidad_medida: string; modo_inventario: string }[] =
          await manager.query(
            `SELECT unidad_medida, modo_inventario FROM item_producto WHERE item_id = $1`,
            [itemId],
          );
        const unidadBase = prodRows[0]?.unidad_medida;
        if (dto.unidadCodigo !== unidadBase) {
          if (prodRows[0]?.modo_inventario !== 'cantidad') {
            throw new BadRequestException(
              'Los productos por serie o lote solo admiten su unidad base',
            );
          }
          cantidad = await this.catalogService.convertirUnidad(
            cantidad,
            dto.unidadCodigo,
            unidadBase,
          );
        }
      }

      const { stockResultante } =
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId,
          itemId,
          usuarioId,
          tipo: dto.tipo,
          motivo: dto.motivo,
          cantidad,
          comentario: dto.comentario ?? null,
          series: dto.series,
          unidadIds: dto.unidadIds,
          lote: dto.lote,
          loteId: dto.loteId,
          costoUnitario: dto.costoUnitario ?? null,
        });

      return { stock: stockResultante };
    });
  }
```

- [x] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/modules/items/items.service.spec.ts`
Expected: PASS — nuevos y preexistentes.

- [x] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS salvo los 2 errores de tsc preexistentes en `auth.service.spec` / `ventas.service.spec`.

- [x] **Step 7: Commit**

```bash
git add backend/src/modules/items
git commit -m "feat(items): convierte la cantidad a la unidad base del producto en el ajuste de stock"
```

---

### Task 5: E2E del flujo de conversión

Deliverable: prueba contra la BD real de que comprar en gramos un producto stockeado en kg deja el stock correcto.

**Files:**
- Modify: `backend/test/inventario.e2e-spec.ts`

**Interfaces:**
- Consumes: todo lo anterior, vía HTTP.
- Produces: nada.

**Nota:** los montos y stocks vuelven como `NUMERIC(18,4)` serializado — `'0.5000'`, no `'0.5'`. Afirmá la forma real, no una redondeada a mano.

- [x] **Step 1: Write the failing test**

En `backend/test/inventario.e2e-spec.ts`, extender la interfaz de respuesta de item (`:17-20`):

```typescript
interface ItemResponse {
  id: string;
  costoActual: string | null;
  stock: string | null;
  unidadMedida: string | null;
}
```

Y agregar el test dentro del `describe`, después del test de costo existente:

```typescript
  it('convierte a la unidad base del producto en entradas y salidas', async () => {
    // 1. Producto stockeado en kg
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto unidades E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'kg',
      });
    expect(resCreate.status).toBe(201);
    const itemId = (resCreate.body as ItemResponse).id;

    // 2. Entrada de 500 g → 0,5 kg
    const resCompra = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'entrada', motivo: 'compra', cantidad: 500, unidadCodigo: 'g' });
    expect(resCompra.status).toBe(200);

    const resGet1 = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((resGet1.body as ItemResponse).stock).toBe('0.5000');

    // 3. Merma de 250 g → 0,25 kg
    const resMerma = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'salida', motivo: 'merma', cantidad: 250, unidadCodigo: 'g' });
    expect(resMerma.status).toBe(200);

    const resGet2 = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((resGet2.body as ItemResponse).stock).toBe('0.2500');

    // 4. Cross-magnitud: litros sobre un producto en kg → rechazado
    const resCross = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'entrada', motivo: 'compra', cantidad: 1, unidadCodigo: 'l' });
    expect(resCross.status).toBe(400);

    // 5. Cambiar la unidad base con movimientos ya registrados → rechazado
    const resCambio = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unidadMedida: 'g' });
    expect(resCambio.status).toBe(400);
  });

  it('rechaza crear un producto con una unidad fuera del catálogo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto unidad inválida E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'inventada',
      });
    expect(res.status).toBe(400);
  });
```

- [x] **Step 2: Run the E2E to verify it passes**

Asegurate de que el stack esté arriba (`docker-compose up -d`) para que la BD y el seed existan.

Run: `cd backend && npm run test:e2e -- inventario`
Expected: PASS — los dos tests nuevos y el de costo preexistente.

> Si `GET /api/items/:id` no expone `stock`, verificá el stock con
> `GET /api/inventario/movimientos?itemId=...` (el último `stockResultante`) en vez de
> inventar un campo. **Leé la respuesta real antes de afirmar sobre ella.**

> Hay un fallo **preexistente** en `ventas.e2e-spec.ts` (`pendiente` vs `pagada_parcial`) ajeno a esta feature. No lo arregles.

- [x] **Step 3: Commit**

```bash
git add backend/test/inventario.e2e-spec.ts
git commit -m "test(inventario): e2e de conversión de unidades en entradas, salidas y validación"
```

---

### Task 6: El catálogo como fuente de verdad en el frontend

Reemplaza los dos hardcodes del frontend. Deliverable: el selector de unidad del form se alimenta del backend, y un producto en gramos se muestra como `500 g`.

**Files:**
- Create: `frontend/app/stores/unidades-medida.ts`
- Create: `frontend/app/stores/unidades-medida.spec.ts`
- Modify: `frontend/app/utils/stock-format.ts`
- Modify: `frontend/app/utils/stock-format.spec.ts`
- Modify: `frontend/app/composables/useFormatters.ts`
- Modify: `frontend/app/pages/configuracion/items.vue` (`:149-154`, `:363-373`, `:893-900`)

**Interfaces:**
- Consumes: `GET /catalog/unidades-medida` (Task 1) → `{ unidadMedidaId, codigo, nombre, magnitud, factorBase }[]`.
- Produces:
  - `useUnidadesMedidaStore()` con `unidades: Ref<UnidadMedidaApi[]>`, `ensureLoaded(): Promise<void>`, `opts: ComputedRef<{ label: string; value: string }[]>`, `esFraccionaria(codigo): boolean`, `getByCodigo(codigo): UnidadMedidaApi | undefined`, `magnitudDe(codigo): string | null`, `reset(): void`.
  - `formatStock(value, unidadMedida, fraccionaria: boolean): string` y `formatStockCantidad(value, fraccionaria: boolean): string` (util puro).
  - `useFormatters().formatStock(value, unidadMedida?)` — **firma pública sin cambios** para sus llamadores (`CatalogoGrid.vue:9`).

**Antes de escribir Vue:** invocá la skill `nuxt-ui` (regla del proyecto: siempre antes de tocar frontend).

- [x] **Step 1: Write the failing store test**

Crear `frontend/app/stores/unidades-medida.spec.ts`. Mirá primero `frontend/app/stores/monedas.spec.ts` y **copiá su forma de mockear `useApiFetch` y de montar Pinia** — no inventes un patrón nuevo.

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUnidadesMedidaStore } from './unidades-medida'

const UNIDADES = [
  { unidadMedidaId: 'g-uuid', codigo: 'g', nombre: 'Gramo', magnitud: 'masa', factorBase: '1.000000' },
  { unidadMedidaId: 'kg-uuid', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'masa', factorBase: '1000.000000' },
  { unidadMedidaId: 'unidad-uuid', codigo: 'unidad', nombre: 'Unidad', magnitud: 'conteo', factorBase: '1.000000' },
]

describe('useUnidadesMedidaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('esFraccionaria: true para magnitudes continuas, false para conteo', async () => {
    const store = useUnidadesMedidaStore()
    store.hydrate(UNIDADES)

    expect(store.esFraccionaria('kg')).toBe(true)
    expect(store.esFraccionaria('g')).toBe(true)
    expect(store.esFraccionaria('unidad')).toBe(false)
  })

  it('esFraccionaria: sin catálogo cargado, solo "unidad" y null son enteros', () => {
    const store = useUnidadesMedidaStore()

    expect(store.esFraccionaria('kg')).toBe(true)
    expect(store.esFraccionaria('unidad')).toBe(false)
    expect(store.esFraccionaria(null)).toBe(false)
  })

  it('opts arma las opciones del selector con el código como value', () => {
    const store = useUnidadesMedidaStore()
    store.hydrate(UNIDADES)

    expect(store.opts).toEqual([
      { label: 'Gramo (g)', value: 'g' },
      { label: 'Kilogramo (kg)', value: 'kg' },
      { label: 'Unidad', value: 'unidad' },
    ])
  })

  it('magnitudDe devuelve la magnitud del código conocido', () => {
    const store = useUnidadesMedidaStore()
    store.hydrate(UNIDADES)

    expect(store.magnitudDe('kg')).toBe('masa')
    expect(store.magnitudDe('inventada')).toBeNull()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run app/stores/unidades-medida.spec.ts`
Expected: FAIL — el módulo `./unidades-medida` no existe.

- [x] **Step 3: Implement the store**

Crear `frontend/app/stores/unidades-medida.ts`:

```typescript
import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

export interface UnidadMedidaApi {
  unidadMedidaId: string
  codigo: string
  nombre: string
  magnitud: string
  factorBase: string
}

/**
 * Catálogo global de unidades de medida. A diferencia de `monedas`, no depende
 * del tenant: un kg es un kg en todos.
 */
export const useUnidadesMedidaStore = defineStore('unidadesMedida', () => {
  const config = useRuntimeConfig()
  const unidades = ref<UnidadMedidaApi[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isLoaded = computed(() => unidades.value.length > 0)

  const opts = computed(() =>
    unidades.value.map(u => ({
      label: u.magnitud === 'conteo' ? u.nombre : `${u.nombre} (${u.codigo})`,
      value: u.codigo,
    })),
  )

  function getByCodigo(codigo: string | null | undefined): UnidadMedidaApi | undefined {
    if (!codigo) return undefined
    return unidades.value.find(u => u.codigo === codigo)
  }

  function magnitudDe(codigo: string | null | undefined): string | null {
    return getByCodigo(codigo)?.magnitud ?? null
  }

  /**
   * ¿La unidad admite decimales? Regla: toda magnitud continua los admite; solo
   * 'conteo' es entero.
   * Fallback cuando el catálogo no está cargado (o el código es desconocido):
   * 'unidad' es el único código de conteo sembrado, así que todo lo demás se
   * trata como fraccionario. Evita que el stock se vea mal en el primer render.
   */
  function esFraccionaria(codigo: string | null | undefined): boolean {
    if (!codigo) return false
    const magnitud = magnitudDe(codigo)
    if (magnitud) return magnitud !== 'conteo'
    return codigo !== 'unidad'
  }

  function hydrate(list: UnidadMedidaApi[]): void {
    unidades.value = list
  }

  async function ensureLoaded(): Promise<void> {
    if (isLoaded.value || loading.value) return

    loading.value = true
    error.value = null
    try {
      hydrate(
        await useApiFetch<UnidadMedidaApi[]>(
          `${config.public.apiUrl}/catalog/unidades-medida`,
        ),
      )
    }
    catch (e: unknown) {
      error.value = (e as { data?: { message?: string } })?.data?.message
        ?? 'Error al cargar unidades de medida'
    }
    finally {
      loading.value = false
    }
  }

  function reset(): void {
    unidades.value = []
    error.value = null
  }

  return {
    unidades,
    loading,
    error,
    isLoaded,
    opts,
    getByCodigo,
    magnitudDe,
    esFraccionaria,
    hydrate,
    ensureLoaded,
    reset,
  }
})
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run app/stores/unidades-medida.spec.ts`
Expected: PASS — 4 tests.

- [x] **Step 5: Make `stock-format.ts` catalog-agnostic**

Reemplazar el contenido completo de `frontend/app/utils/stock-format.ts` por:

```typescript
import Decimal from 'decimal.js'

/**
 * Cantidad legible: enteros para unidades de conteo, decimales significativos
 * para magnitudes continuas. La decisión de qué es fraccionario la toma el
 * catálogo (`useUnidadesMedidaStore.esFraccionaria`), no este módulo.
 */
export function formatStockCantidad(
  value: string | Decimal | null | undefined,
  fraccionaria: boolean,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const d = value instanceof Decimal ? value : new Decimal(value)

  if (!fraccionaria) {
    return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)
  }

  const fixed = d.toFixed(4)
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
  return trimmed.replace('.', ',')
}

/** Etiqueta completa para UI: "98" o "2,5 kg". */
export function formatStock(
  value: string | Decimal | null | undefined,
  unidadMedida: string | null | undefined,
  fraccionaria: boolean,
): string {
  const cantidad = formatStockCantidad(value, fraccionaria)
  if (cantidad === '—') return cantidad
  if (fraccionaria && unidadMedida) return `${cantidad} ${unidadMedida}`
  return cantidad
}
```

- [x] **Step 6: Update the util's tests to the new signature**

Reemplazar el contenido completo de `frontend/app/utils/stock-format.spec.ts` por:

```typescript
import { describe, it, expect } from 'vitest'
import { formatStock, formatStockCantidad } from './stock-format'

describe('formatStockCantidad', () => {
  it('no fraccionaria: muestra entero sin decimales', () => {
    expect(formatStockCantidad('98.0000', false)).toBe('98')
    expect(formatStockCantidad('0.0000', false)).toBe('0')
  })

  it('no fraccionaria: redondea al entero más cercano', () => {
    expect(formatStockCantidad('98.6', false)).toBe('99')
  })

  it('fraccionaria: conserva decimales significativos con coma', () => {
    expect(formatStockCantidad('2.5000', true)).toBe('2,5')
    expect(formatStockCantidad('75.0000', true)).toBe('75')
    expect(formatStockCantidad('199.2500', true)).toBe('199,25')
  })

  it('valor vacío devuelve em dash', () => {
    expect(formatStockCantidad(null, true)).toBe('—')
  })
})

describe('formatStock', () => {
  it('no fraccionaria: solo número, sin sufijo', () => {
    expect(formatStock('98.0000', 'unidad', false)).toBe('98')
  })

  it('fraccionaria: incluye sufijo de unidad', () => {
    expect(formatStock('2.5000', 'kg', true)).toBe('2,5 kg')
    expect(formatStock('75.0000', 'l', true)).toBe('75 l')
    expect(formatStock('500.0000', 'g', true)).toBe('500 g')
  })
})
```

- [x] **Step 7: Wire the store into `useFormatters`**

En `frontend/app/composables/useFormatters.ts`, reemplazar la función `formatStock` (`:34-40`) por:

```typescript
  function formatStock(
    value: string | Decimal | null | undefined,
    unidadMedida?: string | null,
  ): string {
    const unidadesStore = useUnidadesMedidaStore()
    return formatStockDisplay(
      value,
      unidadMedida,
      unidadesStore.esFraccionaria(unidadMedida),
    )
  }
```

> La firma pública no cambia: `CatalogoGrid.vue:9` y el resto siguen llamando
> `formatStock(item.stock, item.unidadMedida)` sin tocarse.

- [x] **Step 8: Replace the hardcoded options in `items.vue`**

Borrar la constante `unidadesMedidaOpts` (`:149-154`) completa.

En el `<script setup>`, junto a los otros stores, agregar:

```typescript
const unidadesMedidaStore = useUnidadesMedidaStore()
const unidadesMedidaOpts = computed(() => unidadesMedidaStore.opts)
```

En `cargarCatalogos()` (`:363`), agregar la carga junto a la de monedas:

```typescript
    await Promise.all([
      monedasStore.ensureLoaded(),
      unidadesMedidaStore.ensureLoaded(),
    ])
```

reemplazando el `await monedasStore.ensureLoaded()` suelto de `:366`.

El template (`:893-900`) **no cambia**: `:items="unidadesMedidaOpts"` ahora recibe el computed.

- [x] **Step 9: No deshabilitar el selector — dejar que el backend rechace**

**No agregues lógica de bloqueo en la UI.** La página no sabe si el producto tiene
movimientos en el momento de editar: el ref `movimientos` (`:258`) pertenece al modal de
historial y solo se puebla en `abrirHistorial` (`:347-359`), así que en el drawer de
edición está vacío o con datos del último item consultado. Usarlo daría un bloqueo
incorrecto.

El precedente del propio archivo es dejar que el backend decida: `modoInventario` se
manda en toda edición y el comentario de `:488` lo dice explícito — *"el backend bloquea
cambio si hay movimientos"*. La validación de unidad (Task 3) sigue ese mismo camino, y
el error llega al usuario por el toast de `apiErrorMsg` que la página ya tiene.

Este paso es una decisión consciente de **no escribir código**. Marcalo y seguí.

- [x] **Step 10: Run the frontend suite and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS y build sin errores de tipos. Si algún test de `useFormatters` o de un componente falla por el store sin Pinia activo, montá Pinia en ese test como hace `monedas.spec.ts`.

- [x] **Step 11: Commit**

```bash
git add frontend/app/stores/unidades-medida.ts frontend/app/stores/unidades-medida.spec.ts frontend/app/utils/stock-format.ts frontend/app/utils/stock-format.spec.ts frontend/app/composables/useFormatters.ts frontend/app/pages/configuracion/items.vue
git commit -m "feat(items): el catálogo de unidades reemplaza los hardcodes del frontend"
```

---

### Task 7: Unidad en el ajuste de stock (UI)

Deliverable: el modal de ajuste deja ingresar "500 g" sobre un producto en kg y muestra la conversión antes de confirmar.

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue` (`emptyAjusteForm` `:218-234`, `abrirAjusteStock` `:564-576`, `ejecutarAjusteStock` `:578+`, y el template del modal)

**Nombres reales de esta página** (usalos tal cual): el item en ajuste es `stockItem`
(`:565`), el modal es `stockModalOpen`, y el payload que se envía se llama `body`
(`:584`) — no `payload`.

**Interfaces:**
- Consumes: `useUnidadesMedidaStore` (Task 6), `PATCH /items/:id/stock` con `unidadCodigo` (Task 4).
- Produces: nada.

- [x] **Step 1: Add the field to the ajuste form**

En `emptyAjusteForm()` (`:218`), agregar junto a `cantidad`:

```typescript
    unidadCodigo: '',
```

- [x] **Step 2: Build the compatible-units options and the conversion preview**

En el `<script setup>`, junto al resto de la lógica del ajuste:

```typescript
// Solo unidades de la misma magnitud que la del producto: convertir entre
// magnitudes exigiría densidad, y el backend lo rechaza.
const unidadesAjusteOpts = computed(() => {
  const magnitud = unidadesMedidaStore.magnitudDe(stockItem.value?.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: `${u.nombre} (${u.codigo})`, value: u.codigo }))
})

// El selector solo aporta si hay más de una unidad y el stock es fungible.
const mostrarSelectorUnidad = computed(() =>
  stockItem.value?.modoInventario === 'cantidad' && unidadesAjusteOpts.value.length > 1,
)

const conversionPreview = computed(() => {
  const base = stockItem.value?.unidadMedida
  const desde = ajusteForm.value.unidadCodigo
  const cantidad = ajusteForm.value.cantidad
  if (!base || !desde || !cantidad || desde === base) return null

  const uDesde = unidadesMedidaStore.getByCodigo(desde)
  const uBase = unidadesMedidaStore.getByCodigo(base)
  if (!uDesde || !uBase || uDesde.magnitud !== uBase.magnitud) return null

  try {
    const convertida = new Decimal(cantidad)
      .mul(uDesde.factorBase)
      .div(uBase.factorBase)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    return `${cantidad} ${desde} → ${formatStock(convertida.toString(), base)}`
  }
  catch {
    return null
  }
})
```

> `Decimal` ya está importado en esta página; `formatStock` viene de `useFormatters()`
> (`:9`). `Item.unidadMedida` (`:30`) y `Item.modoInventario` ya existen en la interfaz.

Preseleccionar la unidad base al abrir el modal: en `abrirAjusteStock` (`:564`),
inmediatamente después de `ajusteForm.value = emptyAjusteForm()` (`:566`):

```typescript
  ajusteForm.value.unidadCodigo = item.unidadMedida ?? ''
```

- [x] **Step 3: Add the selector and preview to the template**

Junto al campo de cantidad del modal de ajuste:

```vue
              <UFormField v-if="mostrarSelectorUnidad" label="Unidad">
                <USelectMenu
                  v-model="ajusteForm.unidadCodigo"
                  :items="unidadesAjusteOpts"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>
```

Y debajo de la cantidad, la previsualización:

```vue
              <p v-if="conversionPreview" class="text-sm text-muted">
                {{ conversionPreview }}
              </p>
```

- [x] **Step 4: Send `unidadCodigo` in the payload**

En `ejecutarAjusteStock` (`:578`), junto a la línea que agrega `costoUnitario`
condicionalmente (`:589`), agregar:

```typescript
    if (f.unidadCodigo && f.unidadCodigo !== stockItem.value.unidadMedida) {
      body.unidadCodigo = f.unidadCodigo
    }
```

> Solo se manda si difiere de la base: así el backend ni consulta el catálogo y el
> comportamiento actual queda idéntico para quien no usa la conversión.

- [x] **Step 5: Run the frontend suite and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS y build limpio.

- [x] **Step 6: Verify in the browser**

Con el stack arriba (`docker-compose up`), en `http://localhost:5173/configuracion/items`:
1. Crear un producto con unidad **Kilogramo (kg)**. El selector debe ofrecer las 6 unidades del catálogo (incluidas Gramo y Mililitro, que antes no existían).
2. Ajustar stock → entrada, motivo compra, cantidad `500`, unidad **Gramo (g)** → la previsualización debe decir `500 g → 0,5 kg`.
3. Confirmar → el stock del listado debe quedar `0,5 kg`.
4. Editar el producto y cambiar la unidad a **Gramo** → debe fallar con el toast *"No se puede cambiar la unidad de medida de un producto con movimientos registrados"* (el bloqueo es del backend, por diseño).
5. Editar el producto sin tocar la unidad (por ejemplo, cambiar el nombre) → debe **guardar sin error**. Esto verifica que reenviar la misma unidad no dispara el bloqueo.

Expected: los 5 pasos se comportan como se describe. Si algo no calza, reportalo — no lo maquilles.

- [x] **Step 7: Commit**

```bash
git add frontend/app/pages/configuracion/items.vue
git commit -m "feat(items): selector de unidad y previsualización de conversión en el ajuste de stock"
```

---

### Task 8: Documentación viva

Regla del proyecto: la doc se actualiza en el mismo commit que la feature.

**Files:**
- Create: `docs/features/conversion-unidades.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/README.md`, `docs/ESTADO.md`
- Modify: `docs/superpowers/specs/2026-07-14-motor-conversion-unidades-design.md`

- [x] **Step 1: Write the feature doc**

Leé `docs/features/TEMPLATE.md` y seguí su estructura. Mirá `docs/features/inventario-kardex.md` como referencia de tono y profundidad. Debe cubrir:
- La tabla `unidades_medida`: columnas, las 6 unidades sembradas y qué significa `factor_base`.
- La fórmula `cantidad × (factor_desde / factor_hacia)` y el redondeo a 4 decimales.
- **Dónde ocurre la conversión** (`ajustarStock`) y por qué el kardex nunca guarda una unidad.
- Las reglas de rechazo: cross-magnitud, serie/lote con unidad distinta, cambio de unidad base con movimientos, cantidad bajo la precisión de stock.
- `GET /catalog/unidades-medida` y `PATCH /items/:id/stock` con `unidadCodigo`.

- [x] **Step 2: Link it from the docs index**

En `docs/README.md`, agregar el link a `features/conversion-unidades.md` en la sección de features, siguiendo el formato de las filas vecinas.

- [x] **Step 3: Update the feature status**

En `docs/ESTADO.md`, agregar la fila junto a la de costo (`:25`):

```markdown
| Conversión de unidades de medida (catálogo global + conversión en movimientos) | ✅ Implementado (2026-07-14) |
```

- [x] **Step 4: Close the spec**

En `docs/superpowers/specs/2026-07-14-motor-conversion-unidades-design.md`, cambiar la línea de status a:

```markdown
**Status**: Done (implementado 2026-07-14)
```

- [x] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(inventario): documenta el motor de conversión de unidades (pieza 2 cluster recetas)"
```

---

## Verification (whole feature)

Después de la última tarea:

- [x] `cd backend && npm test` — sin regresiones (los 2 errores de tsc en `auth.service.spec` / `ventas.service.spec` son preexistentes).
- [x] `cd backend && npm run test:e2e -- inventario` — PASS.
- [x] `cd backend && npm run lint` — limpio.
- [x] `cd frontend && npx vitest run && npm run build` — PASS y build limpio.
- [ ] `docker-compose down -v && docker-compose up --build` — la BD se recrea desde cero, el seed corre sin errores y `GET /catalog/unidades-medida` devuelve las 6 unidades. **Esto valida el camino que más importa: que un tenant nuevo arranque con el catálogo puesto.** Pendiente: requiere borrar el volumen de BD local; Task 1 ya verificó el seed corriendo sobre la BD existente (sin volumen limpio) — falta la corrida desde cero. El coordinador no la ejecutó por ser destructiva sobre datos locales sin pedido explícito del usuario.

## Decisions (heredadas del spec)

| Decisión | Elección |
|---|---|
| Alcance del catálogo | Matriz estándar global, sin `tenant_id` |
| Modelo de conversión | `factor_base` por magnitud |
| Vínculo con `item_producto` | TEXT con el `codigo`, validado en el servicio, sin FK dura |
| Dónde convierte | `ajustarStock`, antes de `registrarMovimiento` |
| Cross-magnitud | `BadRequest` (requeriría densidad) |
| Serie/lote | Rechazan unidad distinta a la base |
| `m` (longitud) | Sembrada: el seeder ya crea productos en metros |
| Cambio de unidad base con movimientos | `BadRequest` |

## Known issue fuera de alcance (no arreglar en este plan)

`items.service.ts:435-445` rechaza el cambio de `modoInventario` con `dto.modoInventario !== undefined && movimientos > 0`, pero `items.vue:489` manda `modoInventario` en **toda** edición. Si eso es cierto en runtime, editar cualquier producto con movimientos ya falla hoy en `main` — un bug **preexistente**, ajeno a esta feature. Este plan no lo toca: la validación de unidad (Task 3) usa el patrón correcto (comparar contra el valor actual) en vez de copiar el defectuoso. Vale reportarlo aparte.
