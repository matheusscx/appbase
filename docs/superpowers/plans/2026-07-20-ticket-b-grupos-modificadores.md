# Ticket B — Grupos de modificadores reutilizables · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grupos de modificadores reutilizables a nivel tenant ("Proteína", "Bebida"), asociables a items `receta` y `combo` con `min`/`max`, con efecto de inventario **derivado del item de cada opción** (no de un tipo declarado en el grupo), elegidos en un drawer de personalización, congelados en un snapshot de la línea y descontados de inventario al vender.

**Architecture:** Un módulo nuevo `GruposModificadoresModule` posee el catálogo (`grupos_modificadores` + `grupo_modificador_opciones`) con CRUD admin-only y **homogeneidad verificada** (todas las opciones de la misma familia de efecto `ingrediente`|`vendible`, verificada al guardar, no persistida). `ItemsModule` gana la tabla puente `item_grupos_modificadores` (`min`/`max`/`orden`) y expone los grupos resueltos en el detalle del item. La venta reutiliza el snapshot `personalizacion` existente (extendido con `grupos`): un resolver valida las opciones elegidas contra los grupos asociados, congela el snapshot y suma `precioExtra`; el descuento de inventario reusa `venderComponentesCombo`/`venderIngredientesReceta` con el efecto derivado del item. El frontend suma una página de catálogo de grupos, una sección compartida en el editor de Items (combo + receta) y una sección de grupos en el drawer de personalización (renombrado a genérico) usado por POS y Salones.

**Tech Stack:** NestJS + TypeORM (SQL raw sobre `dataSource`/`EntityManager`), Decimal.js para dinero y cantidades, Nuxt 4 + Nuxt UI v4, Vitest/Jest para tests.

## Global Constraints

- Aritmética de dinero y cantidades: **Decimal.js**, nunca `number` nativo. Costos/precios con 4 decimales.
- **Soft delete** en todo: `eliminado_el TIMESTAMPTZ`; toda lectura filtra `eliminado_el IS NULL` (en cada JOIN).
- Toda columna PK/FK UUID declara `type: 'uuid'` explícito en la entidad (ADR-004).
- `tenant_id` siempre del token del usuario autenticado (`req.user.tenantId`), nunca del body.
- Esquema en dev lo crea TypeORM `synchronize:true` desde las entidades; **además** actualizar `startup-pos.sql` (doc de esquema) en el mismo commit, incluyendo los índices únicos parciales (que TypeORM `synchronize` no crea sin `@Index`).
- Entidades nuevas se registran **en dos lugares**: `backend/src/app.module.ts` (array `entities`) y el `TypeOrmModule.forFeature` del módulo dueño.
- **Familia de efecto derivada, no declarada:** `ingrediente` → item `tipo='ingrediente'`; `vendible` → item `tipo ∈ {producto, receta, servicio}`. Un grupo es homogéneo (todas sus opciones de la misma familia), **verificado al guardar**; nunca se persiste la familia.
- **Opción elegida de un grupo → siempre bloqueante al vender** (sin stock ⇒ aborta la transacción). El flag `bloqueante` de los componentes fijos del combo (Ticket A) no aplica a las opciones de grupo.
- **Recargo de opción ≥ 0** (`precio_extra`), congelado en el snapshot al confirmar; entra intacto al motor `precioNeto → descuentos → recargos → impuestos`.
- `min`/`max` de la asociación item↔grupo se miden en **unidades totales** elegidas del grupo. `min ≥ 1` ⇒ grupo obligatorio. Se permite repetir la misma opción (cada unidad cuenta hacia `max`).
- **Regla fija** de opciones agotadas (sin config): grupo con `min ≥ 1` y cero stock en todas sus opciones ⇒ item no vendible; `min = 0` ⇒ el grupo puede venir vacío/ausente.
- Frontend: `useApiFetch` (no axios); formato vía `useFormatters`; tokens semánticos Nuxt UI (`text-muted`, `bg-default`…), nunca Tailwind hardcodeado. Sin `cargar()` post-mutación: mergear la entidad/patch que devuelve el backend.
- Canales de este ticket: **POS + Salones**. La tienda online queda fuera.
- **Depende de Ticket A (combos), ya completo en `main`.** Relaja la regla "un combo requiere ≥1 componente fijo" a "≥1 componente fijo **o** ≥1 grupo asociado".

**Spec de referencia:** `docs/superpowers/specs/2026-07-20-grupos-modificadores-design.md`.

---

## File Structure

**Backend — módulo nuevo (crear):**
- `backend/src/modules/grupos-modificadores/entities/grupo-modificador.entity.ts` — grupo (nombre, tenant).
- `backend/src/modules/grupos-modificadores/entities/grupo-modificador-opcion.entity.ts` — opciones (item, cantidad, unidad, precio_extra, orden).
- `backend/src/modules/grupos-modificadores/dto/create-grupo-modificador.dto.ts` — `GrupoOpcionInputDto` + `CreateGrupoModificadorDto`.
- `backend/src/modules/grupos-modificadores/dto/update-grupo-modificador.dto.ts` — `UpdateGrupoModificadorDto` (reemplazo total de opciones).
- `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts` (+ `.spec.ts`).
- `backend/src/modules/grupos-modificadores/grupos-modificadores.controller.ts`.
- `backend/src/modules/grupos-modificadores/grupos-modificadores.module.ts`.

**Backend — items (crear):**
- `backend/src/modules/items/entities/item-grupo-modificador.entity.ts` — tabla puente item↔grupo.

**Backend (modificar):**
- `backend/src/app.module.ts` — registrar las 3 entidades nuevas.
- `backend/src/modules/items/items.module.ts` — registrar `ItemGrupoModificador`.
- `backend/src/modules/items/dto/create-item.dto.ts` y `update-item.dto.ts` — `ItemGrupoModificadorInputDto` + `gruposModificadores?`.
- `backend/src/modules/items/items.service.ts` — asociación en `create`/`update`, `grupos[]` + `disponibleCondicional` en `findOne`/`findAll`, relajar guarda de combo, bloqueo de borrado, resolver de snapshot y descuento de opciones.
- `backend/src/common/dto/personalizacion-receta.dto.ts` — `grupos` en el DTO y en `PersonalizacionRecetaSnapshot`, tipo `SnapshotGrupo`.
- `backend/src/modules/ventas/ventas.service.ts` — resolver personalización también para combos; pasar snapshot al descuento del combo.
- `startup-pos.sql` — DDL de las 3 tablas + índices únicos parciales.
- Tests: `grupos-modificadores.service.spec.ts`, `items.service.spec.ts`, `ventas.service.spec.ts`.

**Backend (crear test):**
- `backend/test/grupos-modificadores.e2e-spec.ts` — crear grupo → asociar a combo → vender eligiendo opción → verificar movimientos + total.

**Frontend (crear):**
- `frontend/app/pages/configuracion/grupos-modificadores.vue` — CRUD del catálogo.

**Frontend (modificar):**
- `frontend/app/pages/configuracion.vue` — nav item.
- `frontend/app/pages/configuracion/items.vue` — sección "Grupos de modificadores" (combo + receta).
- `frontend/app/components/ventas/RecetaPersonalizacionDrawer.vue` → renombrar a `ItemPersonalizacionDrawer.vue` + sección grupos (y actualizar sus importadores).
- `frontend/app/pages/ventas/pos.vue`, `frontend/app/pages/salones/index.vue` — abrir drawer para cualquier item con grupos; fetch de grupos en el catálogo.
- `frontend/app/components/ventas/CatalogoGrid.vue` — `Disponible*` en combos con grupos.
- `frontend/app/composables/useVenta.ts` — snapshot con `grupos` (tipos).

**Docs (crear/modificar):**
- `docs/features/grupos-modificadores.md` (desde `TEMPLATE.md`) + link en `docs/README.md`.
- `docs/ESTADO.md`, `docs/PRODUCTO.md`, `docs/adr/` (+ índice), y notas en `docs/features/combos.md`/`recetas.md`/`personalizacion-recetas.md`.
- `backend/src/modules/seeder/seeder.service.ts` — grupos demo.

---

## Task 1: Módulo de grupos — entidades + `POST /grupos-modificadores` (create con homogeneidad)

**Files:**
- Create: `backend/src/modules/grupos-modificadores/entities/grupo-modificador.entity.ts`
- Create: `backend/src/modules/grupos-modificadores/entities/grupo-modificador-opcion.entity.ts`
- Create: `backend/src/modules/grupos-modificadores/dto/create-grupo-modificador.dto.ts`
- Create: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts`
- Create: `backend/src/modules/grupos-modificadores/grupos-modificadores.controller.ts`
- Create: `backend/src/modules/grupos-modificadores/grupos-modificadores.module.ts`
- Create: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.spec.ts`
- Modify: `backend/src/app.module.ts` (array `entities` + `imports`)
- Modify: `startup-pos.sql`

**Interfaces:**
- Produces:
  - `class GrupoModificador { grupoModificadorId, tenantId, nombre, creadoEl, actualizadoEl, eliminadoEl }`
  - `class GrupoModificadorOpcion { grupoOpcionId, tenantId, grupoModificadorId, itemId, cantidad, unidadCodigo, precioExtra, orden, creadoEl, actualizadoEl, eliminadoEl }`
  - `class GrupoOpcionInputDto { itemId: string; cantidad: string; unidadCodigo?: string; precioExtra: string; orden?: number }`
  - `class CreateGrupoModificadorDto { nombre: string; opciones: GrupoOpcionInputDto[] }`
  - `GruposModificadoresService.create(tenantId, dto)` → `{ grupoModificadorId, nombre, familia: 'ingrediente'|'vendible', opciones: OpcionResuelta[] }` con `OpcionResuelta = { grupoOpcionId, itemId, itemNombre, tipo, cantidad, unidadCodigo, precioExtra, orden }`.
  - `GruposModificadoresService.familiaDeTipo(tipo: string): 'ingrediente' | 'vendible'` (privado; helper reusado en Task 2).
  - `GruposModificadoresService.validarYResolverOpciones(manager, tenantId, opciones)` → `{ familia, opciones: { itemId, itemNombre, tipo, cantidad, unidadCodigo, precioExtra, orden }[] }` (privado; reusado por `update` en Task 2).

- [ ] **Step 1: Escribir los tests que fallan**

`backend/src/modules/grupos-modificadores/grupos-modificadores.service.spec.ts` (seguir el arnés de `monedas.service.spec.ts`: `getRepositoryToken` para repos, `getDataSourceToken` para el DataSource, `transaction` mockeado como `(cb) => cb(managerMock)`):

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { GrupoModificador } from './entities/grupo-modificador.entity';
import { GrupoModificadorOpcion } from './entities/grupo-modificador-opcion.entity';
import { CatalogService } from '../catalog/catalog.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ITEM_ING_A = '550e8400-e29b-41d4-a716-4466554400a1';
const ITEM_ING_B = '550e8400-e29b-41d4-a716-4466554400a2';
const ITEM_PROD = '550e8400-e29b-41d4-a716-4466554400b1';

describe('GruposModificadoresService', () => {
  let service: GruposModificadoresService;
  let managerMock: { query: jest.Mock };
  let convertirUnidad: jest.Mock;

  beforeEach(async () => {
    managerMock = { query: jest.fn() };
    convertirUnidad = jest.fn().mockResolvedValue('1');
    const dataSourceMock = {
      transaction: (cb: any) => cb(managerMock),
      query: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        GruposModificadoresService,
        { provide: getRepositoryToken(GrupoModificador), useValue: {} },
        { provide: getRepositoryToken(GrupoModificadorOpcion), useValue: {} },
        { provide: getDataSourceToken(), useValue: dataSourceMock },
        { provide: CatalogService, useValue: { convertirUnidad } },
      ],
    }).compile();
    service = moduleRef.get(GruposModificadoresService);
  });

  it('crea un grupo homogéneo de familia ingrediente y resuelve opciones', async () => {
    // INSERT grupo → item lookups (2 ingredientes) → INSERT opciones
    managerMock.query
      .mockResolvedValueOnce([]) // check nombre único vivo
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }]) // INSERT grupo RETURNING
      .mockResolvedValueOnce([{ tipo: 'ingrediente', nombre: 'Carne', modo_inventario: 'cantidad', unidad_medida: 'g' }])
      .mockResolvedValueOnce([{ grupo_opcion_id: 'O1' }])
      .mockResolvedValueOnce([{ tipo: 'ingrediente', nombre: 'Pollo', modo_inventario: 'cantidad', unidad_medida: 'g' }])
      .mockResolvedValueOnce([{ grupo_opcion_id: 'O2' }]);
    const res = await service.create(TENANT_ID, {
      nombre: 'Proteína',
      opciones: [
        { itemId: ITEM_ING_A, cantidad: '100', unidadCodigo: 'g', precioExtra: '0' },
        { itemId: ITEM_ING_B, cantidad: '120', unidadCodigo: 'g', precioExtra: '1500' },
      ],
    } as any);
    expect(res.familia).toBe('ingrediente');
    expect(res.opciones).toHaveLength(2);
  });

  it('rechaza mezclar familia ingrediente y vendible', async () => {
    managerMock.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
      .mockResolvedValueOnce([{ tipo: 'ingrediente', nombre: 'Carne', modo_inventario: 'cantidad', unidad_medida: 'g' }])
      .mockResolvedValueOnce([{ grupo_opcion_id: 'O1' }])
      .mockResolvedValueOnce([{ tipo: 'producto', nombre: 'Coca', modo_inventario: 'cantidad', unidad_medida: 'unidad' }]);
    await expect(
      service.create(TENANT_ID, {
        nombre: 'Mixto',
        opciones: [
          { itemId: ITEM_ING_A, cantidad: '100', unidadCodigo: 'g', precioExtra: '0' },
          { itemId: ITEM_PROD, cantidad: '1', precioExtra: '0' },
        ],
      } as any),
    ).rejects.toThrow(/misma familia|homogén/i);
  });

  it('rechaza precioExtra negativo', async () => {
    managerMock.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
      .mockResolvedValueOnce([{ tipo: 'producto', nombre: 'Coca', modo_inventario: 'cantidad', unidad_medida: 'unidad' }]);
    await expect(
      service.create(TENANT_ID, {
        nombre: 'Bebida',
        opciones: [{ itemId: ITEM_PROD, cantidad: '1', precioExtra: '-1' }],
      } as any),
    ).rejects.toThrow(/precio.*mayor o igual a 0/i);
  });

  it('rechaza opción vendible de tipo combo o suscripcion', async () => {
    managerMock.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
      .mockResolvedValueOnce([{ tipo: 'combo', nombre: 'Otro combo', modo_inventario: null, unidad_medida: null }]);
    await expect(
      service.create(TENANT_ID, {
        nombre: 'X',
        opciones: [{ itemId: ITEM_PROD, cantidad: '1', precioExtra: '0' }],
      } as any),
    ).rejects.toThrow(/producto.*receta.*servicio|ingrediente/i);
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts`
Expected: FAIL (módulo/servicio inexistente).

- [ ] **Step 3: Entidades**

`backend/src/modules/grupos-modificadores/entities/grupo-modificador.entity.ts`:

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('grupos_modificadores')
export class GrupoModificador {
  @PrimaryGeneratedColumn('uuid', { name: 'grupo_modificador_id' })
  grupoModificadorId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

`backend/src/modules/grupos-modificadores/entities/grupo-modificador-opcion.entity.ts`:

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('grupo_modificador_opciones')
export class GrupoModificadorOpcion {
  @PrimaryGeneratedColumn('uuid', { name: 'grupo_opcion_id' })
  grupoOpcionId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'grupo_modificador_id', type: 'uuid' })
  grupoModificadorId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ name: 'unidad_codigo', type: 'text', nullable: true })
  unidadCodigo: string | null;

  @Column({ name: 'precio_extra', type: 'numeric', precision: 18, scale: 4, default: 0 })
  precioExtra: string;

  @Column({ type: 'int', default: 0 })
  orden: number;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 4: DTOs**

`backend/src/modules/grupos-modificadores/dto/create-grupo-modificador.dto.ts`:

```typescript
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GrupoOpcionInputDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  // Solo opciones de familia ingrediente; el backend lo verifica.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  @IsNumberString()
  precioExtra: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;
}

export class CreateGrupoModificadorDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrupoOpcionInputDto)
  opciones: GrupoOpcionInputDto[];
}
```

- [ ] **Step 5: Servicio — `create` + helpers de homogeneidad**

`backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { GrupoModificador } from './entities/grupo-modificador.entity';
import { GrupoModificadorOpcion } from './entities/grupo-modificador-opcion.entity';
import { CreateGrupoModificadorDto, GrupoOpcionInputDto } from './dto/create-grupo-modificador.dto';
import { CatalogService } from '../catalog/catalog.service';

export type FamiliaEfecto = 'ingrediente' | 'vendible';

export interface OpcionResuelta {
  itemId: string;
  itemNombre: string;
  tipo: string;
  cantidad: string;
  unidadCodigo: string | null;
  precioExtra: string;
  orden: number;
}

@Injectable()
export class GruposModificadoresService {
  constructor(
    @InjectRepository(GrupoModificador)
    private readonly grupoRepo: Repository<GrupoModificador>,
    @InjectRepository(GrupoModificadorOpcion)
    private readonly opcionRepo: Repository<GrupoModificadorOpcion>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly catalogService: CatalogService,
  ) {}

  private familiaDeTipo(tipo: string): FamiliaEfecto {
    return tipo === 'ingrediente' ? 'ingrediente' : 'vendible';
  }

  /**
   * Valida homogeneidad y cada opción; NO inserta. Devuelve la familia derivada
   * y las opciones resueltas (con nombre y tipo del item). Reusado por create/update.
   */
  private async validarYResolverOpciones(
    manager: EntityManager,
    tenantId: string,
    opciones: GrupoOpcionInputDto[],
  ): Promise<{ familia: FamiliaEfecto; opciones: OpcionResuelta[] }> {
    if (!opciones.length) {
      throw new BadRequestException('El grupo requiere al menos una opción');
    }
    const vistos = new Set<string>();
    let familia: FamiliaEfecto | null = null;
    const resueltas: OpcionResuelta[] = [];
    let orden = 0;
    for (const op of opciones) {
      if (vistos.has(op.itemId)) {
        throw new BadRequestException('Un item no puede aparecer más de una vez como opción del grupo');
      }
      vistos.add(op.itemId);

      let precioExtra: Decimal;
      try {
        precioExtra = new Decimal(op.precioExtra);
      } catch {
        throw new BadRequestException('El precio extra debe ser un número mayor o igual a 0');
      }
      if (precioExtra.isNaN() || precioExtra.lessThan(0)) {
        throw new BadRequestException('El precio extra debe ser mayor o igual a 0');
      }
      if (new Decimal(op.cantidad).lessThanOrEqualTo(0)) {
        throw new BadRequestException('La cantidad de la opción debe ser mayor a 0');
      }

      const rows: {
        tipo: string;
        nombre: string;
        modo_inventario: string | null;
        unidad_medida: string | null;
      }[] = await manager.query(
        `SELECT i.tipo, i.nombre, ip.modo_inventario, ip.unidad_medida
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [op.itemId, tenantId],
      );
      if (!rows.length) {
        throw new BadRequestException(`Opción no encontrada: ${op.itemId}`);
      }
      const { tipo, nombre, modo_inventario, unidad_medida } = rows[0];
      if (!['producto', 'receta', 'servicio', 'ingrediente'].includes(tipo)) {
        throw new BadRequestException(
          `Una opción de grupo debe ser ingrediente, producto, receta o servicio (recibido: ${tipo})`,
        );
      }
      const familiaOp = this.familiaDeTipo(tipo);
      if (familia === null) {
        familia = familiaOp;
      } else if (familia !== familiaOp) {
        throw new BadRequestException(
          'Todas las opciones del grupo deben ser de la misma familia (ingrediente o vendible)',
        );
      }

      let unidadCodigo: string | null = null;
      if (familiaOp === 'ingrediente') {
        if (modo_inventario !== 'cantidad') {
          throw new BadRequestException('Las opciones ingrediente solo admiten modo de inventario "cantidad"');
        }
        if (!op.unidadCodigo) {
          throw new BadRequestException('Las opciones ingrediente requieren unidad de medida');
        }
        // Verifica magnitud/convertibilidad contra la unidad base del ingrediente.
        await this.catalogService.convertirUnidad(op.cantidad, op.unidadCodigo, unidad_medida!);
        unidadCodigo = op.unidadCodigo;
      }

      resueltas.push({
        itemId: op.itemId,
        itemNombre: nombre,
        tipo,
        cantidad: op.cantidad,
        unidadCodigo,
        precioExtra: op.precioExtra,
        orden: op.orden ?? orden,
      });
      orden++;
    }
    return { familia: familia!, opciones: resueltas };
  }

  private async assertNombreLibre(
    manager: EntityManager,
    tenantId: string,
    nombre: string,
    exceptoId?: string,
  ): Promise<void> {
    const rows: { grupo_modificador_id: string }[] = await manager.query(
      `SELECT grupo_modificador_id FROM grupos_modificadores
       WHERE tenant_id = $1 AND LOWER(nombre) = LOWER($2) AND eliminado_el IS NULL
         AND ($3::uuid IS NULL OR grupo_modificador_id <> $3)`,
      [tenantId, nombre, exceptoId ?? null],
    );
    if (rows.length) {
      throw new BadRequestException(`Ya existe un grupo con el nombre "${nombre}"`);
    }
  }

  async create(tenantId: string, dto: CreateGrupoModificadorDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.assertNombreLibre(manager, tenantId, dto.nombre);
      const grupoRows: { grupo_modificador_id: string }[] = await manager.query(
        `INSERT INTO grupos_modificadores (tenant_id, nombre)
         VALUES ($1,$2) RETURNING grupo_modificador_id`,
        [tenantId, dto.nombre],
      );
      const grupoId = grupoRows[0].grupo_modificador_id;
      const { familia, opciones } = await this.validarYResolverOpciones(
        manager,
        tenantId,
        dto.opciones,
      );
      const resueltas: (OpcionResuelta & { grupoOpcionId: string })[] = [];
      for (const op of opciones) {
        const rows: { grupo_opcion_id: string }[] = await manager.query(
          `INSERT INTO grupo_modificador_opciones
             (tenant_id, grupo_modificador_id, item_id, cantidad, unidad_codigo, precio_extra, orden)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING grupo_opcion_id`,
          [tenantId, grupoId, op.itemId, op.cantidad, op.unidadCodigo, op.precioExtra, op.orden],
        );
        resueltas.push({ ...op, grupoOpcionId: rows[0].grupo_opcion_id });
      }
      return {
        grupoModificadorId: grupoId,
        nombre: dto.nombre,
        familia,
        opciones: resueltas,
      };
    });
  }
}
```

- [ ] **Step 6: Controller**

`backend/src/modules/grupos-modificadores/grupos-modificadores.controller.ts` (catálogo de configuración admin-only, patrón `monedas.controller.ts` — `JwtAuthGuard, TenantGuard` en la clase + `TenantAdminGuard` por-handler en mutaciones):

```typescript
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { CreateGrupoModificadorDto } from './dto/create-grupo-modificador.dto';

@Controller('grupos-modificadores')
@UseGuards(JwtAuthGuard, TenantGuard)
export class GruposModificadoresController {
  constructor(private readonly service: GruposModificadoresService) {}

  @Post()
  @UseGuards(TenantAdminGuard)
  create(@Req() req: any, @Body() dto: CreateGrupoModificadorDto) {
    const user = req.user as { tenantId: string };
    return this.service.create(user.tenantId, dto);
  }
}
```

> Verificar las rutas exactas de import de los guards contra `monedas.controller.ts` antes de escribir (los paths `../../common/guards/...` deben coincidir con los reales).

- [ ] **Step 7: Módulo + registro**

`backend/src/modules/grupos-modificadores/grupos-modificadores.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrupoModificador } from './entities/grupo-modificador.entity';
import { GrupoModificadorOpcion } from './entities/grupo-modificador-opcion.entity';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { GruposModificadoresController } from './grupos-modificadores.controller';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [TypeOrmModule.forFeature([GrupoModificador, GrupoModificadorOpcion]), CatalogModule],
  controllers: [GruposModificadoresController],
  providers: [GruposModificadoresService],
  exports: [GruposModificadoresService],
})
export class GruposModificadoresModule {}
```

> Verificar cómo `ItemsModule` importa `CatalogService` (si es vía `CatalogModule` o global) y replicar ese mecanismo para no romper la inyección.

En `backend/src/app.module.ts`: importar `GrupoModificador`, `GrupoModificadorOpcion` y añadirlas al array `entities: [...]`; importar y añadir `GruposModificadoresModule` al array `imports`.

- [ ] **Step 8: DDL en `startup-pos.sql`**

Tras el bloque de `combo_componentes` (Ticket A):

```sql
-- Grupos de modificadores reutilizables a nivel tenant (sin tipo declarado;
-- la familia de efecto se deriva de las opciones y se verifica al guardar)
CREATE TABLE "grupos_modificadores" (
  "grupo_modificador_id" UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            UUID        NOT NULL REFERENCES "tenants" ("tenant_id"),
  "nombre"              TEXT        NOT NULL,
  "creado_el"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"      TIMESTAMPTZ,
  "eliminado_el"        TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_grupo_modificador_nombre_vivo"
  ON "grupos_modificadores" ("tenant_id", LOWER("nombre"))
  WHERE "eliminado_el" IS NULL;

-- Opciones de un grupo (item + recargo). unidad_codigo solo para familia ingrediente.
CREATE TABLE "grupo_modificador_opciones" (
  "grupo_opcion_id"      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "grupo_modificador_id" UUID          NOT NULL REFERENCES "grupos_modificadores" ("grupo_modificador_id"),
  "item_id"              UUID          NOT NULL REFERENCES "items" ("item_id"),
  "cantidad"             NUMERIC(18,4) NOT NULL,   -- por unidad elegida
  "unidad_codigo"        TEXT          REFERENCES "unidades_medida" ("codigo"),
  "precio_extra"         NUMERIC(18,4) NOT NULL DEFAULT 0,  -- recargo ≥ 0
  "orden"                INT           NOT NULL DEFAULT 0,
  "creado_el"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"       TIMESTAMPTZ,
  "eliminado_el"         TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_grupo_opcion_item_vivo"
  ON "grupo_modificador_opciones" ("grupo_modificador_id", "item_id")
  WHERE "eliminado_el" IS NULL;
```

> Verificar el nombre real de la tabla de unidades (`unidades_medida` vs `unidad_medida`) en `startup-pos.sql` y usar el que exista.

- [ ] **Step 9: Correr los tests hasta verde**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts`
Expected: PASS (4 casos).

- [ ] **Step 10: Lint acotado + commit**

> **No usar `npm run lint`** (reformatea todo el repo). Usar el binario acotado y verificar `git status` antes de commitear.

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/grupos-modificadores/**/*.ts'
git add backend/src/modules/grupos-modificadores backend/src/app.module.ts startup-pos.sql
git commit -m "feat(grupos-modificadores): modulo + alta con homogeneidad verificada"
```

---

## Task 2: Módulo de grupos — `GET` (list + detalle) · `PATCH` (reemplazo total) · `DELETE` (bloqueo)

**Files:**
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts`
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.controller.ts`
- Create: `backend/src/modules/grupos-modificadores/dto/update-grupo-modificador.dto.ts`
- Test: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.spec.ts`

**Interfaces:**
- Consumes: `validarYResolverOpciones`, `familiaDeTipo`, `assertNombreLibre` (Task 1).
- Produces:
  - `findAll(tenantId)` → `{ grupoModificadorId, nombre, familia, opciones: OpcionResuelta[], itemsUsandoCount: number }[]`.
  - `findOne(tenantId, id)` → mismo shape que un elemento de `findAll` (404 si no existe).
  - `update(tenantId, id, dto)` → reemplazo total de opciones (soft-delete + insert), mantiene homogeneidad; devuelve el grupo resuelto.
  - `remove(tenantId, id)` → `400` si hay items vivos asociados (listando nombres); si no, soft-delete del grupo y sus opciones.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `grupos-modificadores.service.spec.ts`:

```typescript
describe('update/remove grupo', () => {
  it('reemplaza opciones manteniendo la familia', async () => {
    managerMock.query
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1', nombre: 'Bebida' }]) // SELECT grupo vivo
      .mockResolvedValueOnce([]) // assertNombreLibre
      .mockResolvedValueOnce([{ affected: 1 }]) // soft-delete opciones viejas
      .mockResolvedValueOnce([{ tipo: 'producto', nombre: 'Coca', modo_inventario: 'cantidad', unidad_medida: 'unidad' }])
      .mockResolvedValueOnce([{ grupo_opcion_id: 'O9' }]);
    const res = await service.update(TENANT_ID, 'G1', {
      nombre: 'Bebida',
      opciones: [{ itemId: ITEM_PROD, cantidad: '1', precioExtra: '800' }],
    } as any);
    expect(res.familia).toBe('vendible');
    expect(res.opciones).toHaveLength(1);
  });

  it('bloquea borrar un grupo asociado a items vivos', async () => {
    managerMock.query
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1', nombre: 'Bebida' }]) // SELECT grupo
      .mockResolvedValueOnce([{ nombre: 'Combo Clásico' }]); // items asociados vivos
    await expect(service.remove(TENANT_ID, 'G1')).rejects.toThrow(/No se puede eliminar.*Combo Clásico/i);
  });
});
```

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts -t "update/remove grupo"`
Expected: FAIL.

- [ ] **Step 3: DTO update**

`backend/src/modules/grupos-modificadores/dto/update-grupo-modificador.dto.ts`:

```typescript
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GrupoOpcionInputDto } from './create-grupo-modificador.dto';

export class UpdateGrupoModificadorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  // Reemplazo total: si viene, sustituye todas las opciones vivas.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrupoOpcionInputDto)
  opciones?: GrupoOpcionInputDto[];
}
```

- [ ] **Step 4: Servicio — `findAll` / `findOne`**

En `grupos-modificadores.service.ts`, añadir un helper de carga y los dos métodos:

```typescript
private async cargarGrupo(
  runner: { query: (q: string, p?: unknown[]) => Promise<any> },
  tenantId: string,
  grupoId: string,
) {
  const grupoRows: { grupo_modificador_id: string; nombre: string }[] = await runner.query(
    `SELECT grupo_modificador_id, nombre FROM grupos_modificadores
     WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
    [grupoId, tenantId],
  );
  if (!grupoRows.length) return null;

  const opRows: {
    grupo_opcion_id: string;
    item_id: string;
    item_nombre: string;
    tipo: string;
    cantidad: string;
    unidad_codigo: string | null;
    precio_extra: string;
    orden: number;
    stock: string | null;
  }[] = await runner.query(
    `SELECT o.grupo_opcion_id, o.item_id, i.nombre AS item_nombre, i.tipo,
            o.cantidad, o.unidad_codigo, o.precio_extra, o.orden, ip.stock
     FROM grupo_modificador_opciones o
     JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
     LEFT JOIN item_producto ip ON ip.item_id = o.item_id
     WHERE o.grupo_modificador_id = $1 AND o.tenant_id = $2 AND o.eliminado_el IS NULL
     ORDER BY o.orden ASC`,
    [grupoId, tenantId],
  );

  const usoRows: { total: number }[] = await runner.query(
    `SELECT COUNT(*)::int AS total FROM item_grupos_modificadores igm
     JOIN items i ON i.item_id = igm.item_id AND i.eliminado_el IS NULL
     WHERE igm.grupo_modificador_id = $1 AND igm.eliminado_el IS NULL`,
    [grupoId],
  );

  const familia = opRows.length ? this.familiaDeTipo(opRows[0].tipo) : null;
  return {
    grupoModificadorId: grupoRows[0].grupo_modificador_id,
    nombre: grupoRows[0].nombre,
    familia,
    opciones: opRows.map((r) => ({
      grupoOpcionId: r.grupo_opcion_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      tipo: r.tipo,
      cantidad: r.cantidad,
      unidadCodigo: r.unidad_codigo,
      precioExtra: r.precio_extra,
      orden: r.orden,
      stock: r.stock,
    })),
    itemsUsandoCount: usoRows[0]?.total ?? 0,
  };
}

async findAll(tenantId: string) {
  const rows: { grupo_modificador_id: string }[] = await this.dataSource.query(
    `SELECT grupo_modificador_id FROM grupos_modificadores
     WHERE tenant_id = $1 AND eliminado_el IS NULL ORDER BY nombre ASC`,
    [tenantId],
  );
  return Promise.all(
    rows.map((r) => this.cargarGrupo(this.dataSource, tenantId, r.grupo_modificador_id)),
  );
}

async findOne(tenantId: string, grupoId: string) {
  const grupo = await this.cargarGrupo(this.dataSource, tenantId, grupoId);
  if (!grupo) throw new NotFoundException('Grupo de modificadores no encontrado');
  return grupo;
}
```

Añadir `NotFoundException` al import de `@nestjs/common`.

- [ ] **Step 5: Servicio — `update` (reemplazo total)**

```typescript
async update(tenantId: string, grupoId: string, dto: UpdateGrupoModificadorDto) {
  return this.dataSource.transaction(async (manager) => {
    const grupoRows: { grupo_modificador_id: string; nombre: string }[] = await manager.query(
      `SELECT grupo_modificador_id, nombre FROM grupos_modificadores
       WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [grupoId, tenantId],
    );
    if (!grupoRows.length) throw new NotFoundException('Grupo de modificadores no encontrado');

    if (dto.nombre !== undefined && dto.nombre !== grupoRows[0].nombre) {
      await this.assertNombreLibre(manager, tenantId, dto.nombre, grupoId);
      await manager.query(
        `UPDATE grupos_modificadores SET nombre = $1, actualizado_el = NOW()
         WHERE grupo_modificador_id = $2`,
        [dto.nombre, grupoId],
      );
    }

    if (dto.opciones !== undefined) {
      await manager.query(
        `UPDATE grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE grupo_modificador_id = $1 AND eliminado_el IS NULL`,
        [grupoId],
      );
      const { opciones } = await this.validarYResolverOpciones(manager, tenantId, dto.opciones);
      for (const op of opciones) {
        await manager.query(
          `INSERT INTO grupo_modificador_opciones
             (tenant_id, grupo_modificador_id, item_id, cantidad, unidad_codigo, precio_extra, orden)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, grupoId, op.itemId, op.cantidad, op.unidadCodigo, op.precioExtra, op.orden],
        );
      }
    }

    return this.cargarGrupo(manager, tenantId, grupoId);
  });
}
```

- [ ] **Step 6: Servicio — `remove` (bloqueo por uso)**

```typescript
async remove(tenantId: string, grupoId: string): Promise<void> {
  const grupoRows: { grupo_modificador_id: string }[] = await this.dataSource.query(
    `SELECT grupo_modificador_id FROM grupos_modificadores
     WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
    [grupoId, tenantId],
  );
  if (!grupoRows.length) throw new NotFoundException('Grupo de modificadores no encontrado');

  const usoRows: { nombre: string }[] = await this.dataSource.query(
    `SELECT DISTINCT i.nombre FROM item_grupos_modificadores igm
     JOIN items i ON i.item_id = igm.item_id AND i.eliminado_el IS NULL
     WHERE igm.grupo_modificador_id = $1 AND igm.eliminado_el IS NULL`,
    [grupoId],
  );
  if (usoRows.length) {
    throw new BadRequestException(
      `No se puede eliminar: el grupo está asociado a ${usoRows.map((r) => r.nombre).join(', ')}`,
    );
  }

  await this.dataSource.transaction(async (manager) => {
    await manager.query(
      `UPDATE grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
       WHERE grupo_modificador_id = $1 AND eliminado_el IS NULL`,
      [grupoId],
    );
    await manager.query(
      `UPDATE grupos_modificadores SET eliminado_el = NOW(), actualizado_el = NOW()
       WHERE grupo_modificador_id = $1`,
      [grupoId],
    );
  });
}
```

- [ ] **Step 7: Controller — GET/PATCH/DELETE**

En `grupos-modificadores.controller.ts` añadir (importar `Get, Param, Patch, Delete, HttpCode` y `UpdateGrupoModificadorDto`):

```typescript
  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll((req.user as { tenantId: string }).tenantId);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne((req.user as { tenantId: string }).tenantId, id);
  }

  @Patch(':id')
  @UseGuards(TenantAdminGuard)
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateGrupoModificadorDto) {
    return this.service.update((req.user as { tenantId: string }).tenantId, id, dto);
  }

  @Delete(':id')
  @UseGuards(TenantAdminGuard)
  @HttpCode(204)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove((req.user as { tenantId: string }).tenantId, id);
  }
```

- [ ] **Step 8: Correr los tests hasta verde**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts`
Expected: PASS (todos).

- [ ] **Step 9: Lint acotado + commit**

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/grupos-modificadores/**/*.ts'
git add backend/src/modules/grupos-modificadores
git commit -m "feat(grupos-modificadores): listado, detalle, edicion (reemplazo total) y borrado con bloqueo"
```

---

## Task 3: Asociación item↔grupo (entidad puente + item DTO + detalle + bloqueos)

**Files:**
- Create: `backend/src/modules/items/entities/item-grupo-modificador.entity.ts`
- Modify: `backend/src/modules/items/items.module.ts`, `backend/src/app.module.ts`
- Modify: `backend/src/modules/items/dto/create-item.dto.ts`, `backend/src/modules/items/dto/update-item.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts` (`create`, `update`, `findOne`, `findAll`, `remove`)
- Modify: `startup-pos.sql`
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: tablas de Task 1.
- Produces:
  - `class ItemGrupoModificador { itemGrupoId, tenantId, itemId, grupoModificadorId, min, max, orden, creadoEl, actualizadoEl, eliminadoEl }`
  - `class ItemGrupoModificadorInputDto { grupoModificadorId: string; min: number; max: number; orden?: number }`
  - `CreateItemDto`/`UpdateItemDto` aceptan `gruposModificadores?: ItemGrupoModificadorInputDto[]` (solo `tipo ∈ {combo, receta}`; reemplazo total en update).
  - `ItemsService.asociarGruposModificadores(manager, tenantId, itemId, grupos)` privado — valida `0 ≤ min ≤ max`, `max ≥ 1`, y que cada grupo exista/pertenezca al tenant; hace reemplazo total.
  - `findOne(...)` de combo/receta devuelve `grupos: { grupoModificadorId, nombre, min, max, orden, opciones: {..., stock}[] }[]`.
  - `findOne`/`findAll` de combo con grupos añaden `disponibleCondicional: true`.

- [ ] **Step 1: Escribir los tests que fallan**

En `items.service.spec.ts`:

```typescript
describe('grupos modificadores en item', () => {
  it('asocia grupos a un combo con min/max válidos', async () => {
    // create combo con gruposModificadores → inserta en item_grupos_modificadores
    const dto = {
      nombre: 'Combo Bebida', precioBase: '5000', monedaId: MONEDA_ID, tipo: 'combo',
      componentes: [{ componenteItemId: PROD_ID, cantidad: '1', bloqueante: true }],
      gruposModificadores: [{ grupoModificadorId: GRUPO_ID, min: 1, max: 1, orden: 0 }],
    } as any;
    const res = await service.create(TENANT_ID, USUARIO_ID, dto);
    expect(res.tipo).toBe('combo');
    // el INSERT en item_grupos_modificadores se ejecutó
  });

  it('rechaza max < min', async () => {
    await expect(
      (service as any).asociarGruposModificadores(managerMock, TENANT_ID, ITEM_ID, [
        { grupoModificadorId: GRUPO_ID, min: 3, max: 1 },
      ]),
    ).rejects.toThrow(/max.*mayor o igual.*min|máx/i);
  });

  it('permite crear un combo sin componentes fijos si tiene un grupo', async () => {
    const dto = {
      nombre: 'Combo Solo Grupo', precioBase: '3000', monedaId: MONEDA_ID, tipo: 'combo',
      componentes: [],
      gruposModificadores: [{ grupoModificadorId: GRUPO_ID, min: 1, max: 1 }],
    } as any;
    await expect(service.create(TENANT_ID, USUARIO_ID, dto)).resolves.toBeDefined();
  });

  it('bloquea borrar un item usado como opción de un grupo vivo', async () => {
    await expect(service.remove(TENANT_ID, ITEM_OPCION_ID)).rejects.toThrow(/No se puede eliminar.*opción de/i);
  });
});
```

Mockear `manager.query`/`dataSource.query` para: validación del grupo (existe, pertenece al tenant), INSERTs, y en `remove` la query de uso como opción devolviendo `[{ nombre: 'Proteína' }]`.

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- items.service.spec.ts -t "grupos modificadores en item"`
Expected: FAIL.

- [ ] **Step 3: Entidad puente**

`backend/src/modules/items/entities/item-grupo-modificador.entity.ts`:

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('item_grupos_modificadores')
export class ItemGrupoModificador {
  @PrimaryGeneratedColumn('uuid', { name: 'item_grupo_id' })
  itemGrupoId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'grupo_modificador_id', type: 'uuid' })
  grupoModificadorId: string;

  @Column({ type: 'int', default: 1 })
  min: number;

  @Column({ type: 'int' })
  max: number;

  @Column({ type: 'int', default: 0 })
  orden: number;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

Registrar en `items.module.ts` (`forFeature`) y en `app.module.ts` (`entities`).

- [ ] **Step 4: DTOs de item**

En `create-item.dto.ts`, junto a `ComboComponenteInputDto`:

```typescript
export class ItemGrupoModificadorInputDto {
  @IsUUID()
  grupoModificadorId: string;

  @IsInt()
  @Min(0)
  min: number;

  @IsInt()
  @Min(1)
  max: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  orden?: number;
}
```

Y en `CreateItemDto` (junto a `componentes`):

```typescript
  // Asociación de grupos de modificadores (combo | receta)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemGrupoModificadorInputDto)
  @IsOptional()
  gruposModificadores?: ItemGrupoModificadorInputDto[];
```

Importar `IsInt`, `Min` si faltan. En `update-item.dto.ts`: importar `ItemGrupoModificadorInputDto` desde `./create-item.dto` y añadir el mismo campo `gruposModificadores?` (reemplazo total).

- [ ] **Step 5: Helper de asociación + wiring en create/update**

En `items.service.ts`, importar `ItemGrupoModificadorInputDto` y añadir el helper:

```typescript
private async asociarGruposModificadores(
  manager: EntityManager,
  tenantId: string,
  itemId: string,
  grupos: ItemGrupoModificadorInputDto[],
): Promise<void> {
  // Reemplazo total.
  await manager.query(
    `UPDATE item_grupos_modificadores SET eliminado_el = NOW(), actualizado_el = NOW()
     WHERE item_id = $1 AND eliminado_el IS NULL`,
    [itemId],
  );
  const vistos = new Set<string>();
  let orden = 0;
  for (const g of grupos) {
    if (vistos.has(g.grupoModificadorId)) {
      throw new BadRequestException('Un grupo no puede asociarse dos veces al mismo item');
    }
    vistos.add(g.grupoModificadorId);
    if (g.max < Math.max(g.min, 1)) {
      throw new BadRequestException('El máximo del grupo debe ser mayor o igual a max(min, 1)');
    }
    const rows: { grupo_modificador_id: string }[] = await manager.query(
      `SELECT grupo_modificador_id FROM grupos_modificadores
       WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [g.grupoModificadorId, tenantId],
    );
    if (!rows.length) {
      throw new BadRequestException(`Grupo de modificadores no encontrado: ${g.grupoModificadorId}`);
    }
    await manager.query(
      `INSERT INTO item_grupos_modificadores (tenant_id, item_id, grupo_modificador_id, min, max, orden)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, itemId, g.grupoModificadorId, g.min, g.max, g.orden ?? orden],
    );
    orden++;
  }
}
```

En `create()`: relajar la guarda del combo (buscar `if (dto.tipo === 'combo' && !dto.componentes?.length)`):

```typescript
    if (dto.tipo === 'combo' && !dto.componentes?.length && !dto.gruposModificadores?.length) {
      throw new BadRequestException('Los combos requieren al menos un componente o un grupo de modificadores');
    }
```

Dentro de la transacción de `create()`, tras `insertarRelaciones(...)` (y solo para combo/receta):

```typescript
      if ((dto.tipo === 'combo' || dto.tipo === 'receta') && dto.gruposModificadores?.length) {
        await this.asociarGruposModificadores(manager, tenantId, itemId, dto.gruposModificadores);
      }
```

En `update()`, junto al bloque combo de reemplazo de componentes:

```typescript
      if ((tipo === 'combo' || tipo === 'receta') && dto.gruposModificadores !== undefined) {
        await this.asociarGruposModificadores(manager, tenantId, itemId, dto.gruposModificadores);
      }
```

> El combo con componentes fijos vacíos + grupos: verificar que la rama combo de `create` no vuelva a exigir componentes. Si `validarYCostearComponentes` se llama con `[]`, saltar la inserción de `item_combo`/`combo_componentes` cuando `!dto.componentes?.length` pero sí crear la fila `item_combo` con `costo_actual = '0'` para no romper el `LEFT JOIN item_combo` del `BASE_QUERY`. Añadir en la rama combo: si `!dto.componentes?.length`, `INSERT INTO item_combo (item_id, costo_actual) VALUES ($1, '0')` y no insertar componentes.

- [ ] **Step 6: `findOne` — cargar grupos + `disponibleCondicional`**

En `findOne`, tras cargar `componentes` (combo) e `ingredientes` (receta), cargar los grupos asociados para combo **y** receta:

```typescript
    let grupos: {
      grupoModificadorId: string;
      nombre: string;
      min: number;
      max: number;
      orden: number;
      opciones: {
        grupoOpcionId: string;
        itemId: string;
        itemNombre: string;
        tipo: string;
        cantidad: string;
        unidadCodigo: string | null;
        precioExtra: string;
        orden: number;
        stock: string | null;
      }[];
    }[] = [];
    if (rows[0].tipo === 'combo' || rows[0].tipo === 'receta') {
      const grupoRows: {
        grupo_modificador_id: string;
        nombre: string;
        min: number;
        max: number;
        orden: number;
      }[] = await this.dataSource.query(
        `SELECT igm.grupo_modificador_id, g.nombre, igm.min, igm.max, igm.orden
         FROM item_grupos_modificadores igm
         JOIN grupos_modificadores g ON g.grupo_modificador_id = igm.grupo_modificador_id
           AND g.eliminado_el IS NULL
         WHERE igm.item_id = $1 AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL
         ORDER BY igm.orden ASC`,
        [itemId, tenantId],
      );
      for (const gr of grupoRows) {
        const opRows: {
          grupo_opcion_id: string;
          item_id: string;
          item_nombre: string;
          tipo: string;
          cantidad: string;
          unidad_codigo: string | null;
          precio_extra: string;
          orden: number;
          stock: string | null;
        }[] = await this.dataSource.query(
          `SELECT o.grupo_opcion_id, o.item_id, i.nombre AS item_nombre, i.tipo,
                  o.cantidad, o.unidad_codigo, o.precio_extra, o.orden, ip.stock
           FROM grupo_modificador_opciones o
           JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
           LEFT JOIN item_producto ip ON ip.item_id = o.item_id
           WHERE o.grupo_modificador_id = $1 AND o.tenant_id = $2 AND o.eliminado_el IS NULL
           ORDER BY o.orden ASC`,
          [gr.grupo_modificador_id, tenantId],
        );
        grupos.push({
          grupoModificadorId: gr.grupo_modificador_id,
          nombre: gr.nombre,
          min: gr.min,
          max: gr.max,
          orden: gr.orden,
          opciones: opRows.map((r) => ({
            grupoOpcionId: r.grupo_opcion_id,
            itemId: r.item_id,
            itemNombre: r.item_nombre,
            tipo: r.tipo,
            cantidad: r.cantidad,
            unidadCodigo: r.unidad_codigo,
            precioExtra: r.precio_extra,
            orden: r.orden,
            stock: r.stock,
          })),
        });
      }
    }
```

En el `return` de `findOne` añadir `grupos` y `disponibleCondicional`:

```typescript
      grupos,
      disponibleCondicional: rows[0].tipo === 'combo' && grupos.length > 0,
```

- [ ] **Step 7: `findAll` — `disponibleCondicional` en combos con grupos**

En `findAll`, tras calcular `disponible`, marcar los combos con grupos. Para no disparar N queries extra, cargar de una los combo ids con grupos en la página:

```typescript
    const comboIdsConGrupos = new Set<string>(
      (
        await this.dataSource.query(
          `SELECT DISTINCT item_id FROM item_grupos_modificadores
           WHERE tenant_id = $1 AND eliminado_el IS NULL`,
          [tenantId],
        )
      ).map((r: { item_id: string }) => r.item_id),
    );
```

Y en el `map` de `data`, añadir `disponibleCondicional: base.tipo === 'combo' && comboIdsConGrupos.has(base.id)`.

- [ ] **Step 8: `remove` — bloqueo por uso como opción**

En `remove()`, tras el bloqueo por componente de combo (Ticket A), añadir:

```typescript
    const opcionRows: { nombre: string }[] = await this.dataSource.query(
      `SELECT DISTINCT g.nombre FROM grupo_modificador_opciones o
       JOIN grupos_modificadores g ON g.grupo_modificador_id = o.grupo_modificador_id
         AND g.eliminado_el IS NULL
       WHERE o.item_id = $1 AND o.eliminado_el IS NULL`,
      [itemId],
    );
    if (opcionRows.length) {
      throw new BadRequestException(
        `No se puede eliminar: es opción de ${opcionRows.map((r) => r.nombre).join(', ')}`,
      );
    }
```

- [ ] **Step 9: DDL en `startup-pos.sql`**

```sql
-- Asociación item↔grupo (min/max en unidades totales del grupo)
CREATE TABLE "item_grupos_modificadores" (
  "item_grupo_id"        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            UUID        NOT NULL REFERENCES "tenants" ("tenant_id"),
  "item_id"             UUID        NOT NULL REFERENCES "items" ("item_id"),
  "grupo_modificador_id" UUID        NOT NULL REFERENCES "grupos_modificadores" ("grupo_modificador_id"),
  "min"                 INT         NOT NULL DEFAULT 1,
  "max"                 INT         NOT NULL,
  "orden"               INT         NOT NULL DEFAULT 0,
  "creado_el"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"      TIMESTAMPTZ,
  "eliminado_el"        TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_item_grupo_vivo"
  ON "item_grupos_modificadores" ("item_id", "grupo_modificador_id")
  WHERE "eliminado_el" IS NULL;
```

- [ ] **Step 10: Correr los tests hasta verde**

Run: `cd backend && npm test -- items.service.spec.ts -t "grupos modificadores en item"`
Expected: PASS. Además, correr todo el archivo para descartar regresiones de Ticket A: `npm test -- items.service.spec.ts`.

- [ ] **Step 11: Lint acotado + commit**

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/items/**/*.ts'
git add backend/src/modules/items backend/src/app.module.ts startup-pos.sql
git commit -m "feat(grupos-modificadores): asociacion item-grupo (min/max), detalle y bloqueos"
```

---

## Task 4: Snapshot de personalización con grupos (resolución + validación + precio)

**Files:**
- Modify: `backend/src/common/dto/personalizacion-receta.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts` (resolver de grupos + integración en `resolverPersonalizacionReceta` + resolver combo)
- Modify: `backend/src/modules/ventas/ventas.service.ts` (`crearEnTransaccion`: resolver también combos)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: tablas de Tasks 1 y 3.
- Produces:
  - En `personalizacion-receta.dto.ts`: `PersonalizacionGrupoOpcionInputDto`, `PersonalizacionGrupoInputDto`, campo `grupos?` en `PersonalizacionRecetaDto`, `SnapshotGrupo` y `grupos?: SnapshotGrupo[]` en `PersonalizacionRecetaSnapshot`.
  - `ItemsService.resolverGruposDeItem(manager, tenantId, itemId, gruposDto): Promise<{ grupos: SnapshotGrupo[]; precioExtraTotal: string }>` — valida `min ≤ Σunidades ≤ max`, opciones pertenecientes al grupo, y congela `SnapshotGrupo[]`.
  - `ItemsService.resolverPersonalizacionCombo(manager, tenantId, comboItemId, dto?)` — igual firma de retorno que `resolverPersonalizacionReceta` (`{ snapshot, precioExtraTotal }`), solo grupos.
  - `resolverPersonalizacionReceta` ahora suma los grupos al `snapshot.grupos` y a `precioExtraTotal`.

- [ ] **Step 1: Escribir los tests que fallan**

En `items.service.spec.ts`:

```typescript
describe('resolverGruposDeItem', () => {
  it('congela opciones y suma precioExtra × unidades; valida min/max', async () => {
    // grupo asociado min 1 max 1, opción elegida precioExtra 1500 unidades 1
    const res = await (service as any).resolverGruposDeItem(managerMock, TENANT_ID, ITEM_ID, [
      { grupoId: GRUPO_ID, opciones: [{ itemId: OPCION_ID, unidades: 1 }] },
    ]);
    expect(res.precioExtraTotal).toBe('1500.0000');
    expect(res.grupos[0].opciones[0].nombre).toBeDefined();
  });

  it('rechaza Σ unidades fuera de [min, max]', async () => {
    await expect(
      (service as any).resolverGruposDeItem(managerMock, TENANT_ID, ITEM_ID, [
        { grupoId: GRUPO_ID, opciones: [] }, // min 1 → 0 elegido
      ]),
    ).rejects.toThrow(/elegir|mínimo|entre/i);
  });

  it('rechaza una opción que no pertenece al grupo', async () => {
    await expect(
      (service as any).resolverGruposDeItem(managerMock, TENANT_ID, ITEM_ID, [
        { grupoId: GRUPO_ID, opciones: [{ itemId: OPCION_AJENA_ID, unidades: 1 }] },
      ]),
    ).rejects.toThrow(/no pertenece|opción/i);
  });
});
```

Mockear `manager.query` para: los grupos asociados al item (`item_grupos_modificadores` con min/max) y las opciones de cada grupo (`grupo_modificador_opciones` con `precio_extra`, `cantidad`, `unidad_codigo`, `nombre`, `tipo`).

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- items.service.spec.ts -t "resolverGruposDeItem"`
Expected: FAIL.

- [ ] **Step 3: Extender el DTO/snapshot de personalización**

En `backend/src/common/dto/personalizacion-receta.dto.ts`:

```typescript
export interface SnapshotGrupo {
  grupoId: string;
  grupoNombre: string;
  opciones: {
    itemId: string;
    nombre: string;
    cantidad: string;
    unidadCodigo?: string;
    precioExtra: string;
    unidades: string;
  }[];
}
```

Añadir `grupos?: SnapshotGrupo[];` a la interfaz `PersonalizacionRecetaSnapshot`. Y las clases de input:

```typescript
export class PersonalizacionGrupoOpcionInputDto {
  @IsUUID()
  itemId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  unidades?: number;
}

export class PersonalizacionGrupoInputDto {
  @IsUUID()
  grupoId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionGrupoOpcionInputDto)
  opciones: PersonalizacionGrupoOpcionInputDto[];
}
```

Añadir a `PersonalizacionRecetaDto`:

```typescript
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionGrupoInputDto)
  grupos?: PersonalizacionGrupoInputDto[];
```

- [ ] **Step 4: `resolverGruposDeItem`**

En `items.service.ts` (importar `SnapshotGrupo`, `PersonalizacionGrupoInputDto`):

```typescript
async resolverGruposDeItem(
  manager: EntityManager,
  tenantId: string,
  itemId: string,
  gruposDto: PersonalizacionGrupoInputDto[] | undefined,
): Promise<{ grupos: SnapshotGrupo[]; precioExtraTotal: string }> {
  const asociados: { grupo_modificador_id: string; nombre: string; min: number; max: number }[] =
    await manager.query(
      `SELECT igm.grupo_modificador_id, g.nombre, igm.min, igm.max
       FROM item_grupos_modificadores igm
       JOIN grupos_modificadores g ON g.grupo_modificador_id = igm.grupo_modificador_id
         AND g.eliminado_el IS NULL
       WHERE igm.item_id = $1 AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL`,
      [itemId, tenantId],
    );

  const elegidosPorGrupo = new Map(
    (gruposDto ?? []).map((g) => [g.grupoId, g.opciones]),
  );
  // No permitir grupos elegidos que no están asociados al item.
  for (const g of gruposDto ?? []) {
    if (!asociados.some((a) => a.grupo_modificador_id === g.grupoId)) {
      throw new BadRequestException('Grupo de modificadores no asociado a este item');
    }
  }

  const snapshotGrupos: SnapshotGrupo[] = [];
  let precioExtraTotal = new Decimal(0);

  for (const asoc of asociados) {
    const opcionesCat: {
      item_id: string;
      nombre: string;
      cantidad: string;
      unidad_codigo: string | null;
      precio_extra: string;
    }[] = await manager.query(
      `SELECT o.item_id, i.nombre, o.cantidad, o.unidad_codigo, o.precio_extra
       FROM grupo_modificador_opciones o
       JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
       WHERE o.grupo_modificador_id = $1 AND o.tenant_id = $2 AND o.eliminado_el IS NULL`,
      [asoc.grupo_modificador_id, tenantId],
    );

    const elegidas = elegidosPorGrupo.get(asoc.grupo_modificador_id) ?? [];
    let totalUnidades = new Decimal(0);
    const opcionesSnap: SnapshotGrupo['opciones'] = [];
    for (const el of elegidas) {
      const cat = opcionesCat.find((o) => o.item_id === el.itemId);
      if (!cat) {
        throw new BadRequestException(
          `La opción ${el.itemId} no pertenece al grupo ${asoc.nombre}`,
        );
      }
      const unidades = new Decimal(el.unidades ?? 1);
      if (unidades.lt(1) || !unidades.isInteger()) {
        throw new BadRequestException('Las unidades de la opción deben ser un entero ≥ 1');
      }
      totalUnidades = totalUnidades.plus(unidades);
      opcionesSnap.push({
        itemId: cat.item_id,
        nombre: cat.nombre,
        cantidad: cat.cantidad,
        unidadCodigo: cat.unidad_codigo ?? undefined,
        precioExtra: cat.precio_extra,
        unidades: unidades.toString(),
      });
      precioExtraTotal = precioExtraTotal.plus(new Decimal(cat.precio_extra).mul(unidades));
    }

    if (totalUnidades.lt(asoc.min) || totalUnidades.gt(asoc.max)) {
      throw new BadRequestException(
        `El grupo "${asoc.nombre}" requiere elegir entre ${asoc.min} y ${asoc.max} unidades`,
      );
    }

    // Solo se congela el grupo si hay opciones elegidas (min=0 puede venir vacío).
    if (opcionesSnap.length) {
      snapshotGrupos.push({
        grupoId: asoc.grupo_modificador_id,
        grupoNombre: asoc.nombre,
        opciones: opcionesSnap,
      });
    }
  }

  return { grupos: snapshotGrupos, precioExtraTotal: precioExtraTotal.toFixed(4) };
}
```

- [ ] **Step 5: Integrar grupos en `resolverPersonalizacionReceta` + resolver combo**

En `resolverPersonalizacionReceta`, antes del `return`, resolver los grupos y sumarlos:

```typescript
    const gruposResueltos = await this.resolverGruposDeItem(
      manager,
      tenantId,
      recetaItemId,
      dto?.grupos,
    );
```

Y en el objeto devuelto: `snapshot.grupos = gruposResueltos.grupos` (solo si tiene longitud, para no ensuciar snapshots sin grupos) y `precioExtraTotal` final = `precioExtraTotal (extras).plus(gruposResueltos.precioExtraTotal)`. Ajustar el `toFixed(4)` final para incluir ambos.

Añadir el resolver de combo:

```typescript
async resolverPersonalizacionCombo(
  manager: EntityManager,
  tenantId: string,
  comboItemId: string,
  dto?: PersonalizacionRecetaDto,
): Promise<{ snapshot: PersonalizacionRecetaSnapshot; precioExtraTotal: string }> {
  const { grupos, precioExtraTotal } = await this.resolverGruposDeItem(
    manager,
    tenantId,
    comboItemId,
    dto?.grupos,
  );
  return {
    snapshot: {
      omitidos: [],
      extras: [],
      comentario: dto?.comentario?.trim() || undefined,
      grupos: grupos.length ? grupos : undefined,
    },
    precioExtraTotal,
  };
}
```

- [ ] **Step 6: Wiring en `ventas.service.ts` — resolver también combos**

En `crearEnTransaccion`, cambiar el bloque `personalizaciones` (`:190`-`:203`) para incluir combos:

```typescript
    const personalizaciones = await Promise.all(
      dto.lineas.map(async (linea, i) => {
        const item = items[i];
        if (item.tipo === 'receta' && linea.personalizacion) {
          return this.itemsService.resolverPersonalizacionReceta(
            manager, tenantId, item.id, linea.personalizacion,
          );
        }
        if (item.tipo === 'combo' && linea.personalizacion) {
          return this.itemsService.resolverPersonalizacionCombo(
            manager, tenantId, item.id, linea.personalizacion,
          );
        }
        return null;
      }),
    );
```

El cálculo de precio (`:212`-`:216`) ya suma `pers.precioExtraTotal` cuando `pers != null`, así que aplica a combos sin cambios.

- [ ] **Step 7: Correr los tests hasta verde**

Run: `cd backend && npm test -- items.service.spec.ts -t "resolverGruposDeItem"`
Expected: PASS. Correr también `ventas.service.spec.ts` para descartar regresión: `npm test -- ventas.service.spec.ts`.

- [ ] **Step 8: Lint acotado + commit**

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/items/**/*.ts' 'src/modules/ventas/**/*.ts' 'src/common/**/*.ts'
git add backend/src/common/dto/personalizacion-receta.dto.ts \
        backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts \
        backend/src/modules/ventas/ventas.service.ts
git commit -m "feat(grupos-modificadores): snapshot de grupos (resolucion, validacion min/max y precio)"
```

---

## Task 5: Venta descuenta inventario de las opciones elegidas (+ E2E)

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`venderOpcionesGrupos` + integración en `venderComponentesCombo` y `venderIngredientesReceta`)
- Modify: `backend/src/modules/ventas/ventas.service.ts` (pasar snapshot al descuento del combo)
- Test: `backend/src/modules/items/items.service.spec.ts`
- Test: `backend/test/grupos-modificadores.e2e-spec.ts`

**Interfaces:**
- Consumes: `venderIngredientesReceta`, `inventarioService.registrarMovimiento`, `catalogService.convertirUnidad`, `SnapshotGrupo`.
- Produces:
  - `ItemsService.venderOpcionesGrupos(manager, params: { tenantId; usuarioId: string | null; ventaId; cantidadVendida: string }, grupos: SnapshotGrupo[] | undefined): Promise<void>` — efecto derivado del item de cada opción × `unidades` × `cantidadVendida`; **siempre bloqueante** (los errores de stock se propagan).
  - `venderComponentesCombo(...)` acepta `snapshot?: PersonalizacionRecetaSnapshot` y descuenta sus grupos.
  - `venderIngredientesReceta(...)` descuenta también `snapshot.grupos`.

- [ ] **Step 1: Escribir los tests que fallan**

En `items.service.spec.ts`:

```typescript
describe('venderOpcionesGrupos', () => {
  it('producto → salida; ingrediente → salida con conversión; receta → venderIngredientesReceta; servicio → nada', async () => {
    const spyMov = jest.spyOn(inventarioService, 'registrarMovimiento').mockResolvedValue({} as any);
    const spyReceta = jest.spyOn(service, 'venderIngredientesReceta').mockResolvedValue([]);
    jest.spyOn(service['catalogService'], 'convertirUnidad').mockResolvedValue('200');
    // manager.query devuelve el tipo/unidad de cada item de opción
    managerMock.query
      .mockResolvedValueOnce([{ tipo: 'producto', unidad_medida: 'unidad' }])
      .mockResolvedValueOnce([{ tipo: 'ingrediente', unidad_medida: 'g' }])
      .mockResolvedValueOnce([{ tipo: 'receta', unidad_medida: null }]);
    await (service as any).venderOpcionesGrupos(
      managerMock,
      { tenantId: TENANT_ID, usuarioId: USUARIO_ID, ventaId: VENTA_ID, cantidadVendida: '2' },
      [{ grupoId: 'G', grupoNombre: 'Proteína', opciones: [
        { itemId: PROD_ID, nombre: 'Coca', cantidad: '1', precioExtra: '0', unidades: '1' },
        { itemId: ING_ID, nombre: 'Carne', cantidad: '100', unidadCodigo: 'g', precioExtra: '0', unidades: '1' },
        { itemId: RECETA_ID, nombre: 'Salsa', cantidad: '1', precioExtra: '0', unidades: '1' },
      ] }],
    );
    expect(spyMov).toHaveBeenCalledTimes(2);   // producto + ingrediente
    expect(spyReceta).toHaveBeenCalled();       // receta
  });

  it('opción sin stock → aborta (siempre bloqueante)', async () => {
    jest.spyOn(inventarioService, 'registrarMovimiento').mockRejectedValue(
      new BadRequestException('Stock insuficiente para la salida'),
    );
    managerMock.query.mockResolvedValueOnce([{ tipo: 'producto', unidad_medida: 'unidad' }]);
    await expect(
      (service as any).venderOpcionesGrupos(
        managerMock,
        { tenantId: TENANT_ID, usuarioId: USUARIO_ID, ventaId: VENTA_ID, cantidadVendida: '1' },
        [{ grupoId: 'G', grupoNombre: 'Bebida', opciones: [
          { itemId: PROD_ID, nombre: 'Coca', cantidad: '1', precioExtra: '0', unidades: '1' },
        ] }],
      ),
    ).rejects.toThrow('Stock insuficiente para la salida');
  });
});
```

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- items.service.spec.ts -t "venderOpcionesGrupos"`
Expected: FAIL.

- [ ] **Step 3: Implementar `venderOpcionesGrupos`**

En `items.service.ts`:

```typescript
private async venderOpcionesGrupos(
  manager: EntityManager,
  params: {
    tenantId: string;
    usuarioId: string | null;
    ventaId: string;
    cantidadVendida: string;
  },
  grupos: SnapshotGrupo[] | undefined,
): Promise<void> {
  for (const grupo of grupos ?? []) {
    for (const op of grupo.opciones) {
      const rows: { tipo: string; unidad_medida: string | null }[] = await manager.query(
        `SELECT i.tipo, ip.unidad_medida
         FROM items i
         LEFT JOIN item_producto ip ON ip.item_id = i.item_id
         WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [op.itemId, params.tenantId],
      );
      if (!rows.length) continue;
      const { tipo, unidad_medida } = rows[0];
      if (tipo === 'servicio') continue;

      // cantidad total = cantidad de la opción × unidades elegidas × cantidad vendida del item
      const cantidadTotal = new Decimal(op.cantidad)
        .mul(op.unidades)
        .mul(params.cantidadVendida)
        .toString();

      if (tipo === 'receta') {
        // Para una opción receta, cantidadTotal son unidades enteras de la receta.
        await this.venderIngredientesReceta(manager, {
          tenantId: params.tenantId,
          usuarioId: params.usuarioId,
          ventaId: params.ventaId,
          recetaItemId: op.itemId,
          recetaNombre: op.nombre,
          cantidadVendida: cantidadTotal,
        });
        continue;
      }

      // producto o ingrediente → salida (siempre bloqueante: el error se propaga)
      const cantidadSalida =
        tipo === 'ingrediente' && op.unidadCodigo
          ? await this.catalogService.convertirUnidad(cantidadTotal, op.unidadCodigo, unidad_medida!)
          : cantidadTotal;
      await this.inventarioService.registrarMovimiento(manager, {
        tenantId: params.tenantId,
        itemId: op.itemId,
        tipo: 'salida',
        motivo: 'venta',
        cantidad: cantidadSalida,
        usuarioId: params.usuarioId,
        ventaId: params.ventaId,
      });
    }
  }
}
```

- [ ] **Step 4: Integrar en `venderComponentesCombo` y `venderIngredientesReceta`**

`venderComponentesCombo`: añadir `snapshot?: PersonalizacionRecetaSnapshot` a su `params` y, tras el loop de componentes fijos (antes de `return advertencias`):

```typescript
  await this.venderOpcionesGrupos(
    manager,
    {
      tenantId: params.tenantId,
      usuarioId: params.usuarioId,
      ventaId: params.ventaId,
      cantidadVendida: params.cantidadVendida,
    },
    params.snapshot?.grupos,
  );
```

`venderIngredientesReceta`: al final, antes de `return advertencias`, añadir el mismo bloque usando `params.snapshot?.grupos`.

- [ ] **Step 5: Wiring en `ventas.service.ts` — pasar snapshot al combo**

En el loop de inventario, la rama `else if (item.tipo === 'combo')` (Ticket A) debe pasar el snapshot resuelto:

```typescript
      } else if (item.tipo === 'combo') {
        const advertencias = await this.itemsService.venderComponentesCombo(manager, {
          tenantId,
          usuarioId,
          ventaId: venta.id,
          comboItemId: item.id,
          comboNombre: item.nombre,
          cantidadVendida: cantidadCanonica,
          snapshot: personalizaciones[i]?.snapshot,
        });
        advertenciasReceta.push(...advertencias);
      }
```

> Verificar el nombre real del índice/variable del loop para acceder a `personalizaciones[i]`. La rama receta ya pasa su snapshot; replicar esa forma de acceso.

- [ ] **Step 6: Correr los tests unit hasta verde**

Run: `cd backend && npm test -- items.service.spec.ts -t "venderOpcionesGrupos"`
Expected: PASS. Correr todo `items.service.spec.ts` para descartar regresión de Ticket A.

- [ ] **Step 7: Escribir el E2E**

`backend/test/grupos-modificadores.e2e-spec.ts` (reusar el arnés/setup de `combos.e2e-spec.ts` de Ticket A). Flujo:

```
// 1. Crear producto con stock (Bebida) e ingrediente con stock (Carne).
// 2. POST /grupos-modificadores: grupo "Bebida" (familia vendible, opción Bebida precioExtra 800).
// 3. POST /items tipo=combo con un componente fijo con stock + gruposModificadores:[{grupoModificadorId, min:1, max:1}].
// 4. GET /items?tipo=combo → disponibleCondicional: true.
// 5. POST /ventas: 1 combo con personalizacion.grupos=[{grupoId, opciones:[{itemId: bebidaId, unidades:1}]}].
// 6. GET movimientos: salida del componente fijo Y de la Bebida (opción).
// 7. Assert total = precioBase del combo + 800.
// 8. (Negativo) POST /ventas sin elegir opción del grupo obligatorio → 400.
```

- [ ] **Step 8: Correr el E2E**

Run: `cd backend && npm run test:e2e -- grupos-modificadores`
Expected: PASS.

- [ ] **Step 9: Lint acotado + commit**

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/items/**/*.ts' 'src/modules/ventas/**/*.ts'
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts \
        backend/src/modules/ventas/ventas.service.ts backend/test/grupos-modificadores.e2e-spec.ts
git commit -m "feat(grupos-modificadores): venta descuenta inventario de opciones elegidas (+ e2e)"
```

---

## Task 6: Frontend — página de catálogo de grupos de modificadores

**Files:**
- Create: `frontend/app/pages/configuracion/grupos-modificadores.vue`
- Modify: `frontend/app/pages/configuracion.vue` (nav item)

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /grupos-modificadores` (Tasks 1-2) y `GET /items?tipo=...` para el selector de opciones.
- Produces: CRUD del catálogo. El backend devuelve el grupo resuelto (con `familia` y `opciones`) que se mergea en el estado local.

> **Antes de escribir cualquier `.vue`, invocar el skill `nuxt-ui`** para respetar las props v4 de los componentes (regla del proyecto).

- [ ] **Step 1: Nav item**

En `frontend/app/pages/configuracion.vue`, añadir al computed `navItems` (dentro del bloque admin si aplica):

```typescript
{ label: 'Grupos de modificadores', icon: 'i-lucide-list-plus', to: '/configuracion/grupos-modificadores' }
```

- [ ] **Step 2: Página — script setup**

`frontend/app/pages/configuracion/grupos-modificadores.vue`, siguiendo el patrón de `configuracion/razones-sociales.vue` (estado local con `ref`, `useApiFetch`, sin store). Tipos:

```typescript
interface OpcionRow {
  itemId: string
  cantidad: string
  unidadCodigo?: string
  precioExtra: string
}
interface Grupo {
  grupoModificadorId: string
  nombre: string
  familia: 'ingrediente' | 'vendible' | null
  opciones: { grupoOpcionId: string; itemId: string; itemNombre: string; tipo: string; cantidad: string; unidadCodigo: string | null; precioExtra: string; stock: string | null }[]
  itemsUsandoCount: number
}
```

`cargar()` hace `GET /grupos-modificadores`. Cargar en paralelo el catálogo de items candidatos a opción: `GET /items?tipo=ingrediente|producto|receta|servicio&pageSize=100` (para el selector). Guardar cada uno con su `tipo` y `unidadMedida` (para las opciones ingrediente).

- [ ] **Step 3: Editor (drawer/modal) con filas de opciones + homogeneidad guiada**

El selector de item de cada fila filtra por la familia de las opciones ya agregadas: con el grupo vacío, cualquier ingrediente/vendible; tras la primera opción, solo esa familia (derivar familia de `tipo`: `ingrediente` → familia ingrediente; resto → vendible). Cada fila: `USelectMenu` de item + `UInput` `inputmode="decimal"` de `precioExtra` (string) + para familia ingrediente un `UInput` de `cantidad` + `USelectMenu` de unidad (filtrada por magnitud de la unidad base del ingrediente); para familia vendible, `cantidad` por defecto `'1'` (editable) sin unidad. Botón agregar/quitar fila (patrón §9 de `frontend.md`: array inmutable). Al elegir un item de otra familia estando el grupo no vacío, mostrar toast `warning` y no agregar.

- [ ] **Step 4: guardar / eliminar sin refetch**

`guardar()` hace POST o PATCH según `editingId`, captura el grupo devuelto y hace upsert en el `ref` local. `eliminar()` hace DELETE (con modal de confirmación) y saca el id del array; si el backend responde 400 (grupo en uso), mostrar `e.data.message` en toast. Payload de cada opción: `{ itemId, cantidad, unidadCodigo?, precioExtra, orden }`.

- [ ] **Step 5: Template + estados carga/vacío**

Tabla con columnas: nombre, familia (badge), N° de opciones, N° de items que lo usan, acciones. Usar `text-muted`, `divide-default`, `UBadge`, `UButton` ghost. Estados `v-if="loading"` / `v-else-if="!grupos.length"`.

- [ ] **Step 6: Verificación manual**

Run: `cd frontend && npm run dev`, abrir `/configuracion/grupos-modificadores`.
Verificar: crear un grupo "Bebida" (2 opciones vendibles), otro "Proteína" (ingredientes con cantidad+unidad); el selector bloquea mezclar familias; editar reemplaza opciones; borrar un grupo en uso muestra el mensaje del backend.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/pages/configuracion/grupos-modificadores.vue frontend/app/pages/configuracion.vue
git commit -m "feat(grupos-modificadores): pagina de catalogo de grupos en Configuracion"
```

---

## Task 7: Frontend — sección "Grupos de modificadores" en el editor de Items

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue`

**Interfaces:**
- Consumes: `GET /grupos-modificadores` (catálogo), `POST/PATCH /items` con `gruposModificadores` (Task 3), `GET /items/:id` que ahora devuelve `grupos[]`.
- Produces: sección compartida por Combo y Receta para asociar grupos con `min`/`max`/`orden`.

> **Invocar el skill `nuxt-ui`** antes de escribir el markup.

- [ ] **Step 1: Estado**

Añadir tipos y estado (junto a `ComponenteRow` de Ticket A):

```typescript
interface GrupoAsocRow { grupoModificadorId: string; min: string; max: string; orden: string }
```

Ampliar el tipo `Item` con `grupos?: { grupoModificadorId: string; nombre: string; min: number; max: number; orden: number; opciones: any[] }[]`. En el `form` inicial añadir `gruposModificadores: [] as GrupoAsocRow[]`.

- [ ] **Step 2: Cargar catálogo de grupos**

Añadir `gruposCatalogo = ref<{ grupoModificadorId: string; nombre: string; familia: string; opciones: any[] }[]>([])` y `cargarGruposCatalogo()` con `GET /grupos-modificadores`, invocado donde hoy se cargan categorías/impuestos/itemsVendibles.

- [ ] **Step 3: Mapear al editar**

Donde se arma el `form` al editar (junto al mapeo de `componentes`), añadir:

```typescript
      gruposModificadores: (detalle.grupos ?? []).map(g => ({
        grupoModificadorId: g.grupoModificadorId,
        min: String(g.min),
        max: String(g.max),
        orden: String(g.orden),
      })),
```

- [ ] **Step 4: Payload en guardar**

En `guardar()`, para `tipo === 'combo'` **y** `tipo === 'receta'`, incluir en el payload:

```typescript
    payload.gruposModificadores = form.value.gruposModificadores.map(g => ({
      grupoModificadorId: g.grupoModificadorId,
      min: Number(g.min),
      max: Number(g.max),
      orden: Number(g.orden || '0'),
    }))
```

(`min`/`max`/`orden` son `@IsInt` en el backend → enviar `number`, no string — ver excepción §7 de `frontend.md`.)

- [ ] **Step 5: Editor visual (compartido combo + receta)**

Un bloque `<template v-if="form.tipo === 'combo' || form.tipo === 'receta'">` con la sección "Grupos de modificadores": por fila un `USelectMenu` con los grupos del catálogo (excluyendo los ya elegidos), `UInput` `type="number"` para `min` y `max`, y botón quitar; botón "Agregar grupo" que hace push de `{ grupoModificadorId: '', min: '1', max: '1', orden: String(idx) }`. Debajo de cada grupo elegido, mostrar sus opciones (nombre + recargo) en solo lectura con link a `/configuracion/grupos-modificadores`. Tokens semánticos, sin Tailwind hardcodeado.

- [ ] **Step 6: Verificación manual**

Run: `cd frontend && npm run dev`, `/configuracion/items`.
Verificar: a un combo y a una receta se les puede asociar un grupo con min/max; guardar y reabrir conserva la asociación; las opciones del grupo se ven en solo lectura.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/pages/configuracion/items.vue
git commit -m "feat(grupos-modificadores): asociar grupos a combo y receta en el editor de Items"
```

---

## Task 8: Frontend — drawer de personalización con grupos (POS + Salones)

**Files:**
- Rename: `frontend/app/components/ventas/RecetaPersonalizacionDrawer.vue` → `ItemPersonalizacionDrawer.vue`
- Modify: importadores del drawer (POS/Salones/otros), `frontend/app/pages/ventas/pos.vue`, `frontend/app/pages/salones/index.vue`, `frontend/app/components/ventas/CatalogoGrid.vue`, `frontend/app/composables/useVenta.ts`

**Interfaces:**
- Consumes: `GET /items?tipo=combo` (con `disponibleCondicional`), `GET /items/:id` (con `grupos[]`), venta con `personalizacion.grupos`.
- Produces: drawer que arma `personalizacion` (omitidos/extras/comentario para receta + `grupos` para receta y combo); combos con grupos abren el drawer.

> **Invocar el skill `nuxt-ui`** antes de tocar el markup del drawer.

- [ ] **Step 1: Renombrar el drawer + actualizar importadores**

`git mv frontend/app/components/ventas/RecetaPersonalizacionDrawer.vue frontend/app/components/ventas/ItemPersonalizacionDrawer.vue`. Renombrar el componente internamente si define `name`. Buscar todos los importadores (`grep -rl RecetaPersonalizacionDrawer frontend/app`) y actualizarlos al nuevo nombre/ruta. Compilar (`npm run build`) para confirmar que no quedan referencias rotas.

- [ ] **Step 2: Sección de grupos en el drawer**

El drawer ya recibe el item (o lo carga vía `GET /items/:id`). Añadir arriba una sección por cada `grupo` del item: encabezado con el nombre y la regla (`elige 1` si `min===max===1`; `N a M` si rango), y sus opciones con recargo (`+$1.500` vía `formatMonto`), stock, y stepper de `unidades` cuando `max > 1`. Opciones con `stock === 0` (o `disponible`) deshabilitadas; un grupo con `min ≥ 1` sin ninguna opción con stock ⇒ bloquear confirmar con mensaje. El botón confirmar respeta `min`/`max` (no confirma fuera de rango) y muestra el precio final sumado (`precioBase + Σ precioExtra × unidades`, Decimal.js). Emitir `personalizacion` con la clave `grupos: [{ grupoId, opciones: [{ itemId, unidades }] }]` además de omitidos/extras/comentario.

- [ ] **Step 3: Abrir el drawer para combos con grupos**

En POS y Salones, la lógica que hoy abre el drawer para recetas debe abrirlo para **cualquier item con grupos** (receta o combo). Un combo sin grupos y un producto siguen agregándose con un click (Ticket A). Detectar "tiene grupos" con el detalle del item (`GET /items/:id` devuelve `grupos[]`) o con un flag ya presente en el catálogo. Añadir el fetch `tipo=combo&pageSize=100` al catálogo si Salones/POS aún no lo traen tras Ticket A (POS ya lo trae; verificar Salones).

- [ ] **Step 4: `Disponible*` en combos con grupos**

En `CatalogoGrid.vue`, cuando `item.disponibleCondicional` es true, mostrar `Disponible*` con nota "La disponibilidad final depende de la opción elegida"; nunca bloquear el click (el combo con grupos siempre es agregable, el drawer decide).

- [ ] **Step 5: Snapshot en `useVenta.ts` / líneas de cuenta**

Extender el tipo del snapshot de línea con `grupos?`. El merge de líneas en Salones ya compara la personalización completa, así que dos combos con distinta opción no se fusionan — verificar que la comparación incluya `grupos` (si compara por JSON del snapshot, ya cubre; si compara campo a campo, añadir `grupos`).

- [ ] **Step 6: Verificación manual (contra backend real)**

Run: `cd frontend && npm run dev`, abrir `/ventas/pos` y `/salones`.
Verificar: un combo con grupo obligatorio abre el drawer; no se puede confirmar sin elegir; el precio refleja el recargo; al vender, el stock del componente fijo y de la opción bajan; dos combos con distinta bebida no se fusionan en la cuenta.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/ventas/ItemPersonalizacionDrawer.vue \
        frontend/app/pages/ventas/pos.vue frontend/app/pages/salones/index.vue \
        frontend/app/components/ventas/CatalogoGrid.vue frontend/app/composables/useVenta.ts
git commit -m "feat(grupos-modificadores): drawer de personalizacion con grupos en POS y Salones"
```

---

## Task 9: Seed demo + documentación viva

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`, `backend/src/modules/seeder/seeder.module.ts`
- Create: `docs/features/grupos-modificadores.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/README.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md`, `docs/features/combos.md`, `docs/features/recetas.md`, `docs/features/personalizacion-recetas.md`
- Create: `docs/adr/0NN-grupos-modificadores.md` + índice `docs/adr/README.md`

**Interfaces:**
- Consumes: endpoints y tablas de Tasks 1-5.

- [ ] **Step 1: Seed demo**

En `seeder.service.ts`, añadir `seedGruposModificadores()` (un método privado, patrón existente), invocado en el orquestador tras `seedCombos()`. IDs `550e8400-e29b-41d4-a716-446655440XXX` con el **siguiente número libre** (verificar el máximo con `grep -o '4466554402[0-9][0-9]' seeder.service.ts | sort -u | tail`). Sembrar:

- Grupo `Proteína` (familia ingrediente): carne +$0, pollo +$0, chuleta +$1.500 (ingredientes demo; crear los que falten como en Ticket A con "Papas fritas"). Asociarlo a una receta "Hamburguesa Especial" sin proteína fija, `min: 1, max: 1`.
- Grupo `Bebida` (familia vendible): Coca-Cola +$0, bebida premium +$800.
- Asociar `Bebida` al "Combo Clásico" (Ticket A), `min: 1, max: 1`.

Registrar las entidades nuevas en `seeder.module.ts` (`forFeature`).

- [ ] **Step 2: Verificar el seed al arrancar**

Run: `docker-compose up backend` (o `cd backend && npm run start:dev`). Confirmar en logs que el seed corre sin error; `GET /grupos-modificadores` devuelve Proteína y Bebida; `GET /items?tipo=combo` muestra el Combo Clásico con `disponibleCondicional: true`.

- [ ] **Step 3: Doc de feature + índice**

Crear `docs/features/grupos-modificadores.md` desde `TEMPLATE.md`: qué es un grupo, familia derivada + homogeneidad verificada, `min`/`max` en unidades, opción siempre bloqueante, regla fija de agotados, snapshot congelado, precio. Link en `docs/README.md`. Notas cruzadas en `combos.md`, `recetas.md`, `personalizacion-recetas.md`.

- [ ] **Step 4: Estado + producto**

- `docs/ESTADO.md`: fila "Grupos de modificadores" ✅ fecha 2026-07-20.
- `docs/PRODUCTO.md`: reglas de negocio (grupos reutilizables, efecto por item, homogeneidad, min/max, precio en el grupo sin override, opción bloqueante).

- [ ] **Step 5: ADR**

Crear el ADR (siguiente número libre): grupos reutilizables a nivel tenant sin tipo declarado (efecto derivado, homogeneidad verificada), precio en el grupo sin override por item, `min`/`max` en unidades totales, opción siempre bloqueante, regla fija de agotados; trade-offs asumidos (precio compartido entre items → dos grupos; override aditivo a futuro). Fila en `docs/adr/README.md`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/seeder docs/
git commit -m "feat(grupos-modificadores): seed demo + documentacion viva (feature, ESTADO, PRODUCTO, ADR)"
```

---

## Self-Review — cobertura vs. spec

- **Módulo `GruposModificadoresModule` (grupos + opciones, `precio_extra`)** → Task 1 (create), Task 2 (list/detalle/update/delete). ✔
- **Homogeneidad verificada (familia derivada, no persistida)** → Task 1 (`validarYResolverOpciones` + `familiaDeTipo`). ✔
- **Validación de opción ingrediente (tipo, modo cantidad, unidad convertible) / vendible (producto/receta/servicio, nunca combo/suscripcion)** → Task 1. ✔
- **Asociación item↔grupo con `min`/`max`/`orden`; combo relaja "≥1 componente" a "≥1 componente o grupo"** → Task 3. ✔
- **`GET /items/:id` combo y receta devuelven `grupos[]`; combo con grupos → `disponibleCondicional`** → Task 3. ✔
- **Bloqueo de borrado (item opción de grupo vivo; grupo asociado a items vivos)** → Task 2 (grupo) + Task 3 (item). ✔
- **Snapshot `grupos` en `personalizacion`; validación `min ≤ Σunidades ≤ max`; precio `precioExtra × unidades` congelado; backend revalida** → Task 4. ✔
- **Descuento de inventario de opciones (efecto por item; ingrediente con conversión; siempre bloqueante)** → Task 5. ✔
- **CRUD de grupos en Configuración** → Task 6. ✔
- **Sección grupos compartida en Items (combo + receta)** → Task 7. ✔
- **Drawer de personalización con grupos (renombrado); combos con grupos abren drawer; `Disponible*`; merge de líneas** → Task 8. ✔
- **Impresión térmica con opciones elegidas** → **diferida explícitamente fuera de Ticket B** (decisión del usuario, 2026-07-20). El snapshot ya congela `grupos` con todo lo necesario para implementarla después sin migración; se documenta como pendiente en `docs/features/grupos-modificadores.md` (Task 9).
- **Seed + docs + ADR** → Task 9. ✔

**Decisiones confirmadas por el usuario (2026-07-20):**
1. **Impresión térmica de opciones elegidas**: diferida a un ticket aparte. No tiene task en este plan.
2. **Combo con `item_combo.costo_actual = '0'` cuando no tiene componentes fijos** (solo grupos): aceptado. El costo real se realiza al vender, vía el movimiento de inventario de la opción elegida.
3. **Ejecución**: subagent-driven-development (mismo flujo que Ticket A).

**Type consistency:** `grupoModificadorId`/`grupoOpcionId`/`familia`/`precioExtra`/`unidades`/`SnapshotGrupo` usados con el mismo shape en Tasks 1-8; `resolverGruposDeItem`, `resolverPersonalizacionCombo`, `venderOpcionesGrupos` con las firmas declaradas en sus bloques Interfaces; `min`/`max` son `int` (number) en backend y se envían como `number` desde el front (Task 7 Step 4).
