# Plan: Gestión de inventario (Kardex de movimientos de stock)

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan checkboxes (`- [ ]`).
>
> **Ubicación final en repo:** al ejecutar, copiar este plan a `docs/superpowers/plans/2026-06-23-kardex-inventario.md` (convención del proyecto).

**Status:** Approved
**Date:** 2026-06-23
**Owner:** Cesar Matheus

---

## Context

La tabla `movimientos_inventario` ya existe en `startup-pos.sql:469` (kardex auditable), pero **no hay entity, módulo ni registro de movimientos**. Hoy `ItemsService.ajustarStock` (`backend/src/modules/items/items.service.ts:415`) muta `item_producto.stock` directamente **sin dejar rastro** en el kardex, y `create()` inserta el stock inicial igual. Esto rompe la decisión de arquitectura del proyecto: *"`movimientos_inventario` es la fuente de verdad auditable; `item_producto.stock` es el saldo materializado"* y *"Movimiento + actualización de saldo en una sola transacción"* (CLAUDE.md → Inventario).

Este plan construye la trazabilidad completa: un módulo `inventario` con un servicio reutilizable que registra cada movimiento y muta el saldo en la misma transacción, refactoriza el ajuste y la creación de productos para pasar por él, y expone el kardex en la UI (modal por producto + página global). Resultado: cada cambio de stock queda registrado con tipo, motivo, usuario, comentario y saldos antes/después.

## Scope / Out of scope

**En alcance:**
- Entity + módulo `inventario` con `InventarioService.registrarMovimiento(manager, …)` (manager-aware, reutilizable por ventas en el futuro) y `findMovimientos(…)`.
- Refactor de `ajustarStock` (delega el registro) y `create` (movimiento `inventario_inicial` si stock > 0).
- DTO de ajuste con `motivo` + `comentario`.
- Endpoint `GET /inventario/movimientos` (filtros: item, motivo, fechas).
- UI: modal "Historial" por producto en `items.vue` + página dedicada `/configuracion/inventario`.
- Seeder: registrar entity + sembrar `inventario_inicial` para el producto sembrado.
- Docs vivas.

**Fuera de alcance (fases futuras, por decisión del proyecto):** bodegas/almacenes, traspasos, costeo/valoración, integración con ventas (el módulo `ventas` aún no existe — `InventarioService` queda listo para que lo consuma), tipo de movimiento `'ajuste'` absoluto (solo `entrada`/`salida` por ahora).

## Global Constraints

- **Soft delete** en `movimientos_inventario`: `@DeleteDateColumn({ name: 'eliminado_el' })`; toda lectura filtra `eliminado_el IS NULL`.
- **`type: 'uuid'` explícito** en toda columna PK/FK UUID (ADR-004).
- **`tenant_id` y `usuario_id` siempre del token** (`req.user.tenantId`, `req.user.id`), nunca del body.
- **Decimal.js** para toda aritmética de stock; `numeric` → `string` en JS, nunca `number` nativo.
- Mensajes de error de negocio en español (`BadRequestException`) — el frontend los muestra desde `e.data.message`.
- Guards: `JwtAuthGuard + TenantGuard` en lectura; `+ TenantAdminGuard` en mutaciones (patrón `docs/patterns/backend.md §4`).

## Decisiones tomadas (confirmadas con el usuario)

1. **Módulo dedicado** `modules/inventario/` con servicio reutilizable manager-aware.
2. **Motivo + comentario** capturados por movimiento.
3. **Sí** generar movimiento `inventario_inicial` al crear producto con stock > 0.
4. **Ambas** vistas: modal en la página de items **y** página dedicada `/configuracion/inventario`.

**Vocabulario fijo:**
- `tipo` ∈ `'entrada' | 'salida'` (la columna SQL admite `'ajuste'`, reservado para fase futura).
- `motivo` ∈ `'compra' | 'venta' | 'devolucion' | 'merma' | 'ajuste_manual' | 'inventario_inicial'`.

---

## File Structure

**Backend (nuevo módulo):**
- `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts` — entity TypeORM.
- `backend/src/modules/inventario/dto/find-movimientos.dto.ts` — filtros de query.
- `backend/src/modules/inventario/inventario.service.ts` — `registrarMovimiento` + `findMovimientos`.
- `backend/src/modules/inventario/inventario.service.spec.ts` — tests unitarios.
- `backend/src/modules/inventario/inventario.controller.ts` — `GET /inventario/movimientos`.
- `backend/src/modules/inventario/inventario.module.ts` — módulo.

**Backend (modificados):**
- `backend/src/app.module.ts` — registrar entity + `InventarioModule`.
- `backend/src/modules/items/dto/ajuste-stock.dto.ts` — `motivo` + `comentario`.
- `backend/src/modules/items/items.service.ts` — `ajustarStock` y `create` delegan a `InventarioService`.
- `backend/src/modules/items/items.service.spec.ts` — actualizar mocks/firma.
- `backend/src/modules/items/items.controller.ts` — pasar `usuarioId` del token.
- `backend/src/modules/items/items.module.ts` — `imports: [InventarioModule]`.
- `backend/src/modules/seeder/seeder.module.ts` + `seeder.service.ts` — entity + seed.

**Frontend:**
- `frontend/app/pages/configuracion/items.vue` — ajuste con motivo/comentario + modal historial.
- `frontend/app/pages/configuracion/inventario.vue` — página global (nueva).
- `frontend/app/pages/configuracion.vue` — item de navegación.

**Docs:**
- `docs/features/inventario-kardex.md`, `docs/README.md`, `docs/MIGRACION-FUNCIONALIDADES.md`, `CLAUDE.md` (tabla estado), opcional ADR.

---

## Backend

### Task 1: Entity `MovimientoInventario` + registro en app.module

**Files:**
- Create: `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts`
- Modify: `backend/src/app.module.ts` (sección entities, ~línea 97-99 y array `imports`, ~línea 124)

**Interfaces — Produces:** entity `MovimientoInventario` con propiedades `movimientoId, tenantId, itemId, tipo, motivo, cantidad, stockAnterior, stockResultante, ventaId, usuarioId, comentario, creadoEl, actualizadoEl, eliminadoEl`.

- [ ] **Step 1: Crear la entity**

```typescript
// backend/src/modules/inventario/entities/movimiento-inventario.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('movimientos_inventario')
export class MovimientoInventario {
  @PrimaryGeneratedColumn('uuid', { name: 'movimiento_id' })
  movimientoId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'text' })
  tipo: string; // 'entrada' | 'salida' | 'ajuste'

  @Column({ type: 'text' })
  motivo: string; // 'compra' | 'venta' | 'devolucion' | 'merma' | 'ajuste_manual' | 'inventario_inicial'

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ name: 'stock_anterior', type: 'numeric', precision: 18, scale: 4 })
  stockAnterior: string;

  @Column({ name: 'stock_resultante', type: 'numeric', precision: 18, scale: 4 })
  stockResultante: string;

  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ type: 'text', nullable: true })
  comentario: string | null;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

- [ ] **Step 2: Registrar la entity en `app.module.ts`**

Agregar el import junto a los demás (cerca de la línea 53) y la entity al array `entities` del `TypeOrmModule.forRoot` (después de `ItemServicio`, ~línea 99):

```typescript
import { MovimientoInventario } from './modules/inventario/entities/movimiento-inventario.entity';
// ... dentro de entities: [ ... ItemServicio, MovimientoInventario, ... ]
```

- [ ] **Step 3: Verificar que compila**

Run: `cd backend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/inventario/entities/movimiento-inventario.entity.ts backend/src/app.module.ts
git commit -m "feat(inventario): entity MovimientoInventario + registro en app.module"
```

---

### Task 2: `InventarioService.registrarMovimiento` (manager-aware) — TDD

**Files:**
- Create: `backend/src/modules/inventario/inventario.service.ts`
- Test: `backend/src/modules/inventario/inventario.service.spec.ts`

**Interfaces — Produces:**
```typescript
interface RegistrarMovimientoParams {
  tenantId: string;
  itemId: string;
  tipo: 'entrada' | 'salida';
  motivo: string;
  cantidad: string;            // numeric como string
  usuarioId: string | null;
  ventaId?: string | null;
  comentario?: string | null;
}
// registrarMovimiento(manager: EntityManager, params): Promise<{ movimientoId: string; stockAnterior: string; stockResultante: string }>
```
**Consumes:** `EntityManager` provisto por el caller dentro de su `dataSource.transaction(...)`.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// backend/src/modules/inventario/inventario.service.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { InventarioService } from './inventario.service';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';

const TENANT = 'tenant-uuid';
const ITEM_ID = 'item-uuid';
const USER_ID = 'user-uuid';

describe('InventarioService', () => {
  let service: InventarioService;
  let managerMock: { query: jest.Mock };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    managerMock = { query: jest.fn() };
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventarioService,
        { provide: getRepositoryToken(MovimientoInventario), useValue: {} },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<InventarioService>(InventarioService);
  });

  describe('registrarMovimiento', () => {
    it('entrada: suma al stock y registra el movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE item_producto
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]); // INSERT

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        },
      );

      expect(res).toEqual({
        movimientoId: 'mov-1',
        stockAnterior: '10',
        stockResultante: '15',
      });
      // UPDATE recibe el nuevo stock
      expect(managerMock.query.mock.calls[1][1]).toEqual(['15', ITEM_ID]);
    });

    it('salida: resta del stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-2' }]);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '4',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('6');
    });

    it('salida con stock insuficiente lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([{ stock: '3' }]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '5',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('item sin fila item_producto lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npm test -- inventario.service`
Expected: FAIL ("Cannot find module './inventario.service'").

- [ ] **Step 3: Implementar `InventarioService` (mínimo para pasar)**

```typescript
// backend/src/modules/inventario/inventario.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';

export interface RegistrarMovimientoParams {
  tenantId: string;
  itemId: string;
  tipo: 'entrada' | 'salida';
  motivo: string;
  cantidad: string;
  usuarioId: string | null;
  ventaId?: string | null;
  comentario?: string | null;
}

@Injectable()
export class InventarioService {
  constructor(
    @InjectRepository(MovimientoInventario)
    private readonly movimientoRepo: Repository<MovimientoInventario>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Registra un movimiento y muta el saldo materializado en item_producto
   * dentro de la transacción del caller (manager-aware). Reutilizable por
   * ventas: cada línea generará salida/motivo='venta' con el mismo manager.
   */
  async registrarMovimiento(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
  ): Promise<{
    movimientoId: string;
    stockAnterior: string;
    stockResultante: string;
  }> {
    const productoRows: { stock: string }[] = await manager.query(
      `SELECT stock FROM item_producto WHERE item_id = $1 FOR UPDATE`,
      [params.itemId],
    );
    if (!productoRows.length) {
      throw new BadRequestException('El item no tiene control de stock');
    }

    const stockAnterior = new Decimal(productoRows[0].stock);
    const cantidad = new Decimal(params.cantidad);
    if (cantidad.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    const stockResultante =
      params.tipo === 'entrada'
        ? stockAnterior.plus(cantidad)
        : stockAnterior.minus(cantidad);

    if (stockResultante.lessThan(0)) {
      throw new BadRequestException('Stock insuficiente para la salida');
    }

    await manager.query(
      `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
      [stockResultante.toString(), params.itemId],
    );

    const insertRows: { movimiento_id: string }[] = await manager.query(
      `INSERT INTO movimientos_inventario
         (tenant_id, item_id, tipo, motivo, cantidad,
          stock_anterior, stock_resultante, venta_id, usuario_id, comentario)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING movimiento_id`,
      [
        params.tenantId,
        params.itemId,
        params.tipo,
        params.motivo,
        cantidad.toString(),
        stockAnterior.toString(),
        stockResultante.toString(),
        params.ventaId ?? null,
        params.usuarioId,
        params.comentario ?? null,
      ],
    );

    return {
      movimientoId: insertRows[0].movimiento_id,
      stockAnterior: stockAnterior.toString(),
      stockResultante: stockResultante.toString(),
    };
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npm test -- inventario.service`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inventario/inventario.service.ts backend/src/modules/inventario/inventario.service.spec.ts
git commit -m "feat(inventario): registrarMovimiento manager-aware con saldo en transacción"
```

---

### Task 3: `InventarioService.findMovimientos` (lectura del kardex) — TDD

**Files:**
- Modify: `backend/src/modules/inventario/inventario.service.ts`
- Modify: `backend/src/modules/inventario/inventario.service.spec.ts`

**Interfaces — Produces:**
```typescript
// findMovimientos(tenantId: string, filtros: { itemId?: string; motivo?: string; desde?: string; hasta?: string })
//   : Promise<Array<{ id, itemId, itemNombre, tipo, motivo, cantidad, stockAnterior,
//                     stockResultante, usuarioId, usuarioNombre, comentario, creadoEl }>>
```

- [ ] **Step 1: Escribir el test que falla**

Agregar dentro del `describe('InventarioService', ...)`:

```typescript
  describe('findMovimientos', () => {
    it('mapea filas snake_case a camelCase y filtra por item', async () => {
      dataSource.query.mockResolvedValue([
        {
          movimiento_id: 'mov-1',
          item_id: ITEM_ID,
          item_nombre: 'Smartphone',
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5.0000',
          stock_anterior: '10.0000',
          stock_resultante: '15.0000',
          usuario_id: USER_ID,
          usuario_nombre: 'Admin',
          comentario: null,
          creado_el: new Date('2026-06-23T10:00:00Z'),
        },
      ]);

      const res = await service.findMovimientos(TENANT, { itemId: ITEM_ID });

      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({
        id: 'mov-1',
        itemId: ITEM_ID,
        itemNombre: 'Smartphone',
        tipo: 'entrada',
        motivo: 'compra',
        stockResultante: '15.0000',
        usuarioNombre: 'Admin',
      });
      // tenantId siempre es el primer parámetro
      expect(dataSource.query.mock.calls[0][1][0]).toBe(TENANT);
    });
  });
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npm test -- inventario.service`
Expected: FAIL ("service.findMovimientos is not a function").

- [ ] **Step 3: Implementar `findMovimientos`**

Agregar el método a `InventarioService` (debajo de `registrarMovimiento`):

```typescript
  async findMovimientos(
    tenantId: string,
    filtros: {
      itemId?: string;
      motivo?: string;
      desde?: string;
      hasta?: string;
    },
  ) {
    let query = `
      SELECT
        mv.movimiento_id, mv.item_id, i.nombre AS item_nombre,
        mv.tipo, mv.motivo, mv.cantidad,
        mv.stock_anterior, mv.stock_resultante,
        mv.usuario_id, u.nombre AS usuario_nombre,
        mv.comentario, mv.creado_el
      FROM movimientos_inventario mv
      JOIN items i ON i.item_id = mv.item_id AND i.eliminado_el IS NULL
      LEFT JOIN usuarios u ON u.usuario_id = mv.usuario_id AND u.eliminado_el IS NULL
      WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
    `;
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (filtros.itemId) {
      query += ` AND mv.item_id = $${idx++}`;
      params.push(filtros.itemId);
    }
    if (filtros.motivo) {
      query += ` AND mv.motivo = $${idx++}`;
      params.push(filtros.motivo);
    }
    if (filtros.desde) {
      query += ` AND mv.creado_el >= $${idx++}`;
      params.push(filtros.desde);
    }
    if (filtros.hasta) {
      query += ` AND mv.creado_el <= $${idx++}`;
      params.push(filtros.hasta);
    }

    query += ` ORDER BY mv.creado_el DESC`;

    const rows: {
      movimiento_id: string;
      item_id: string;
      item_nombre: string;
      tipo: string;
      motivo: string;
      cantidad: string;
      stock_anterior: string;
      stock_resultante: string;
      usuario_id: string | null;
      usuario_nombre: string | null;
      comentario: string | null;
      creado_el: Date;
    }[] = await this.dataSource.query(query, params);

    return rows.map((r) => ({
      id: r.movimiento_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      tipo: r.tipo,
      motivo: r.motivo,
      cantidad: r.cantidad,
      stockAnterior: r.stock_anterior,
      stockResultante: r.stock_resultante,
      usuarioId: r.usuario_id,
      usuarioNombre: r.usuario_nombre,
      comentario: r.comentario,
      creadoEl: r.creado_el,
    }));
  }
```

> Nota: verificar el nombre de la columna de nombre de usuario en `startup-pos.sql` (tabla `usuarios`). Si la columna no es `nombre`, ajustar el alias `u.nombre AS usuario_nombre` al campo correcto.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && npm test -- inventario.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inventario/inventario.service.ts backend/src/modules/inventario/inventario.service.spec.ts
git commit -m "feat(inventario): findMovimientos con filtros por item/motivo/fechas"
```

---

### Task 4: DTO de filtros + Controller + Module

**Files:**
- Create: `backend/src/modules/inventario/dto/find-movimientos.dto.ts`
- Create: `backend/src/modules/inventario/inventario.controller.ts`
- Create: `backend/src/modules/inventario/inventario.module.ts`
- Modify: `backend/src/app.module.ts` (array `imports`)

**Interfaces — Produces:** ruta `GET /inventario/movimientos`; `InventarioModule` exporta `InventarioService`.

- [ ] **Step 1: DTO de query**

```typescript
// backend/src/modules/inventario/dto/find-movimientos.dto.ts
import { IsOptional, IsUUID, IsIn, IsDateString } from 'class-validator';

const MOTIVOS = [
  'compra',
  'venta',
  'devolucion',
  'merma',
  'ajuste_manual',
  'inventario_inicial',
];

export class FindMovimientosDto {
  @IsOptional() @IsUUID()
  itemId?: string;

  @IsOptional() @IsIn(MOTIVOS)
  motivo?: string;

  @IsOptional() @IsDateString()
  desde?: string;

  @IsOptional() @IsDateString()
  hasta?: string;
}
```

- [ ] **Step 2: Controller**

```typescript
// backend/src/modules/inventario/inventario.controller.ts
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { InventarioService } from './inventario.service';
import { FindMovimientosDto } from './dto/find-movimientos.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('inventario')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  @Get('movimientos')
  findMovimientos(@Req() req: Request, @Query() query: FindMovimientosDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.inventarioService.findMovimientos(tenantId, query);
  }
}
```

- [ ] **Step 3: Module**

```typescript
// backend/src/modules/inventario/inventario.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';
import { InventarioService } from './inventario.service';
import { InventarioController } from './inventario.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MovimientoInventario])],
  controllers: [InventarioController],
  providers: [InventarioService],
  exports: [InventarioService],
})
export class InventarioModule {}
```

- [ ] **Step 4: Registrar `InventarioModule` en `app.module.ts`**

Agregar el import y `InventarioModule` al array `imports` (junto a `ItemsModule`, ~línea 124).

- [ ] **Step 5: Verificar build + arranque del backend**

Run: `cd backend && npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inventario/dto backend/src/modules/inventario/inventario.controller.ts backend/src/modules/inventario/inventario.module.ts backend/src/app.module.ts
git commit -m "feat(inventario): endpoint GET /inventario/movimientos + módulo"
```

---

### Task 5: Refactor `ajustarStock` para delegar en `InventarioService`

**Files:**
- Modify: `backend/src/modules/items/dto/ajuste-stock.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts:415` (`ajustarStock`)
- Modify: `backend/src/modules/items/items.controller.ts:68` (pasar `usuarioId`)
- Modify: `backend/src/modules/items/items.module.ts` (`imports: [InventarioModule]`)
- Modify: `backend/src/modules/items/items.service.spec.ts` (mock de `InventarioService` + firma)

**Interfaces — Consumes:** `InventarioService.registrarMovimiento`.
**Produces:** `ajustarStock(tenantId, usuarioId, itemId, dto)` → `{ stock: string }`.

- [ ] **Step 1: Ampliar `AjusteStockDto`**

```typescript
// backend/src/modules/items/dto/ajuste-stock.dto.ts
import { IsIn, IsNumber, Min, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

const MOTIVOS = [
  'compra',
  'devolucion',
  'merma',
  'ajuste_manual',
  'inventario_inicial',
];

export class AjusteStockDto {
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cantidad: number;

  @IsIn(['entrada', 'salida'])
  tipo: 'entrada' | 'salida';

  @IsIn(MOTIVOS)
  motivo: string;

  @IsOptional()
  @IsString()
  comentario?: string;
}
```

- [ ] **Step 2: Actualizar el test de `ajustarStock` en `items.service.spec.ts`**

Añadir el provider mock al `TestingModule` (en `beforeEach`):

```typescript
// nuevo mock junto a los demás
const inventarioServiceMock = { registrarMovimiento: jest.fn() };
// ... en providers:
//   { provide: InventarioService, useValue: inventarioServiceMock },
// import { InventarioService } from '../inventario/inventario.service';
```

Reemplazar el bloque de tests `describe('ajustarStock', ...)` por:

```typescript
  describe('ajustarStock', () => {
    it('delega el registro del movimiento y devuelve el nuevo stock', async () => {
      managerMock.query.mockResolvedValueOnce([{ tipo: 'producto' }]); // SELECT tipo
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-1',
        stockAnterior: '10',
        stockResultante: '15',
      });

      const res = await service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
        cantidad: 5,
        tipo: 'entrada',
        motivo: 'compra',
      });

      expect(res).toEqual({ stock: '15' });
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          tenantId: TENANT,
          itemId: ITEM_ID,
          usuarioId: 'user-uuid',
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
        }),
      );
    });

    it('rechaza si el item no es producto', async () => {
      managerMock.query.mockResolvedValueOnce([{ tipo: 'servicio' }]);

      await expect(
        service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
          cantidad: 5,
          tipo: 'entrada',
          motivo: 'compra',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd backend && npm test -- items.service`
Expected: FAIL (firma de `ajustarStock` / `InventarioService` no inyectado).

- [ ] **Step 4: Inyectar `InventarioService` y refactorizar `ajustarStock`**

En `items.service.ts`: importar y agregar al constructor:

```typescript
import { InventarioService } from '../inventario/inventario.service';
// ...
    private readonly inventarioService: InventarioService,
```

Reemplazar el método `ajustarStock` (líneas 415-451) por:

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

      const { stockResultante } = await this.inventarioService.registrarMovimiento(
        manager,
        {
          tenantId,
          itemId,
          usuarioId,
          tipo: dto.tipo,
          motivo: dto.motivo,
          cantidad: new Decimal(dto.cantidad).toString(),
          comentario: dto.comentario ?? null,
        },
      );

      return { stock: stockResultante };
    });
  }
```

(El import de `Decimal` ya existe en el archivo.)

- [ ] **Step 5: Pasar `InventarioModule` a `ItemsModule`**

```typescript
// items.module.ts
import { InventarioModule } from '../inventario/inventario.module';
// imports: [TypeOrmModule.forFeature([Item, ItemProducto, ItemServicio]), InventarioModule],
```

- [ ] **Step 6: Actualizar el controller para pasar `usuarioId`**

En `items.controller.ts`, método `ajustarStock`:

```typescript
  @UseGuards(TenantAdminGuard)
  @Patch(':id/stock')
  ajustarStock(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AjusteStockDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.itemsService.ajustarStock(tenantId, usuarioId, id, dto);
  }
```

- [ ] **Step 7: Correr tests + build**

Run: `cd backend && npm test -- items.service && npx tsc --noEmit`
Expected: PASS + sin errores de tipos.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/items
git commit -m "refactor(items): ajustarStock registra movimiento de inventario vía InventarioService"
```

---

### Task 6: `create` registra movimiento `inventario_inicial`

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`create`, líneas 143-227)
- Modify: `backend/src/modules/items/items.controller.ts` (`create`, pasar `usuarioId`)
- Modify: `backend/src/modules/items/items.service.spec.ts` (test de `create`)

**Interfaces — Produces:** `create(tenantId, usuarioId, dto)` → `{ id }`.

- [ ] **Step 1: Escribir/ajustar el test que falla**

En `items.service.spec.ts`, en el `describe('create', ...)`, añadir:

```typescript
    it('producto con stock inicial > 0 registra movimiento inventario_inicial', async () => {
      // moneda válida, sin categoría/reglas
      managerMock.query
        .mockResolvedValueOnce([{ ok: 1 }])               // validarMoneda
        .mockResolvedValueOnce([{ item_id: 'nuevo-item' }]) // INSERT items RETURNING
        .mockResolvedValueOnce(undefined);                  // INSERT item_producto
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-1',
        stockAnterior: '0',
        stockResultante: '25',
      });

      const res = await service.create(TENANT, 'user-uuid', {
        nombre: 'Smartphone',
        precioBase: '899000',
        monedaId: MONEDA_ID,
        tipo: 'producto',
        stock: '25',
        unidadMedida: 'unidad',
      } as any);

      expect(res).toEqual({ id: 'nuevo-item' });
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          itemId: 'nuevo-item',
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          cantidad: '25',
          usuarioId: 'user-uuid',
        }),
      );
    });
```

> Ajustar el orden/cantidad de `mockResolvedValueOnce` para que calce con las llamadas reales del happy path de `create` (validaciones + INSERTs). Verificarlo corriendo el test.

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npm test -- items.service`
Expected: FAIL (firma de `create` / movimiento no registrado).

- [ ] **Step 3: Refactorizar `create`**

Cambiar la firma a `create(tenantId: string, usuarioId: string, dto: CreateItemDto)`. En la rama `if (dto.tipo === 'producto')`, **insertar siempre `item_producto` con stock '0'** y luego, si el stock inicial es > 0, registrar el movimiento:

```typescript
      if (dto.tipo === 'producto') {
        await manager.query(
          `INSERT INTO item_producto (item_id, stock, unidad_medida, fecha_elaboracion, fecha_vencimiento)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            itemId,
            '0', // el saldo se materializa vía el movimiento inventario_inicial
            dto.unidadMedida ?? 'unidad',
            dto.fechaElaboracion ?? null,
            dto.fechaVencimiento ?? null,
          ],
        );

        const stockInicial = new Decimal(dto.stock ?? '0');
        if (stockInicial.greaterThan(0)) {
          await this.inventarioService.registrarMovimiento(manager, {
            tenantId,
            itemId,
            usuarioId,
            tipo: 'entrada',
            motivo: 'inventario_inicial',
            cantidad: stockInicial.toString(),
            comentario: 'Stock inicial',
          });
        }
      } else {
        // ... item_servicio sin cambios
      }
```

- [ ] **Step 4: Actualizar el controller `create`**

```typescript
  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateItemDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.itemsService.create(tenantId, usuarioId, dto);
  }
```

- [ ] **Step 5: Correr tests + build**

Run: `cd backend && npm test -- items.service && npx tsc --noEmit`
Expected: PASS + sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/items
git commit -m "feat(items): crear producto con stock inicial registra movimiento inventario_inicial"
```

---

### Task 7: Seeder — registrar entity + sembrar movimiento inicial

**Files:**
- Modify: `backend/src/modules/seeder/seeder.module.ts` (`forFeature`)
- Modify: `backend/src/modules/seeder/seeder.service.ts` (`seedItems` + `onApplicationBootstrap`)

- [ ] **Step 1: Registrar la entity en `seeder.module.ts`**

Agregar `MovimientoInventario` al array `TypeOrmModule.forFeature([...])` (línea 28) e importarla.

- [ ] **Step 2: Sembrar el movimiento inicial del producto sembrado**

En `seeder.service.ts`, al final de `seedItems()`, dentro del bloque `if (!existsSmartphone.length)` (justo después del INSERT en `item_producto`), reemplazar el stock directo `'25'` por `'0'` y registrar el movimiento inicial de forma idempotente:

```typescript
      // item_producto arranca en 0; el saldo se materializa con el movimiento inicial
      await this.dataSource.query(
        `INSERT INTO item_producto (item_id, stock, unidad_medida) VALUES ($1,$2,$3)`,
        [ITEM_SMARTPHONE, '0', 'unidad'],
      );
      // ... INSERT item_impuestos (sin cambios) ...

      // Movimiento inventario_inicial (idempotente por el guard existsSmartphone)
      await this.dataSource.query(
        `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
        ['25', ITEM_SMARTPHONE],
      );
      await this.dataSource.query(
        `INSERT INTO movimientos_inventario
           (movimiento_id, tenant_id, item_id, tipo, motivo, cantidad,
            stock_anterior, stock_resultante, comentario)
         VALUES ($1,$2,$3,'entrada','inventario_inicial','25','0','25','Stock inicial (seed)')`,
        [
          '550e8400-e29b-41d4-a716-446655440120', // ID fijo libre (rango items 110-117)
          PARIS,
          ITEM_SMARTPHONE,
        ],
      );
```

> `usuario_id` se deja null (columna nullable). El movimiento solo se crea junto con el item, así que el guard `existsSmartphone` lo hace idempotente.

- [ ] **Step 3: Levantar el backend y verificar el seed**

Run: `docker-compose down -v && docker-compose up --build` (o `cd backend && npm run start:dev` con BD limpia)
Expected: el backend arranca sin errores; `movimientos_inventario` tiene 1 fila para el smartphone con `stock_resultante = 25`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/seeder
git commit -m "feat(seeder): registrar MovimientoInventario y sembrar inventario_inicial"
```

---

## Frontend

### Task 8: `items.vue` — ajuste con motivo/comentario + modal de historial (kardex)

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue`

**Interfaces — Consumes:** `PATCH /items/:id/stock` (ahora con `motivo`/`comentario`), `GET /inventario/movimientos?itemId=`.

- [ ] **Step 1: Ampliar el formulario de ajuste y agregar estado del historial**

En `<script setup>`:

```typescript
interface Movimiento {
  id: string
  itemNombre: string
  tipo: string
  motivo: string
  cantidad: string
  stockAnterior: string
  stockResultante: string
  usuarioNombre: string | null
  comentario: string | null
  creadoEl: string
}

const motivoOpts = [
  { label: 'Compra', value: 'compra' },
  { label: 'Devolución', value: 'devolucion' },
  { label: 'Merma', value: 'merma' },
  { label: 'Ajuste manual', value: 'ajuste_manual' },
]

function emptyAjusteForm() {
  return { cantidad: '', tipo: 'entrada', motivo: 'ajuste_manual', comentario: '' }
}

// Historial (kardex)
const historialOpen = ref(false)
const historialLoading = ref(false)
const movimientos = ref<Movimiento[]>([])
const historialItemNombre = ref('')

async function abrirHistorial(item: Item) {
  historialItemNombre.value = item.nombre
  historialOpen.value = true
  historialLoading.value = true
  movimientos.value = []
  try {
    movimientos.value = await useApiFetch<Movimiento[]>(
      `${apiUrl}/inventario/movimientos?itemId=${item.id}`,
    )
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al cargar historial'
    toast.add({ title: msg, color: 'error' })
  } finally {
    historialLoading.value = false
  }
}
```

- [ ] **Step 2: Enviar `motivo` y `comentario` en `ejecutarAjusteStock`**

El `body: ajusteForm.value` ya incluye los campos nuevos; añadir validación mínima del motivo si se desea. Sin cambios estructurales más allá del nuevo `emptyAjusteForm`.

- [ ] **Step 3: Botón "Historial" por producto**

En el bloque de controles del `<li>` (junto al botón de ajustar stock, ~línea 412), agregar:

```vue
            <UButton
              v-if="item.tipo === 'producto'"
              icon="i-lucide-clipboard-list"
              color="neutral"
              variant="ghost"
              size="sm"
              title="Historial de inventario"
              @click="abrirHistorial(item)"
            />
```

- [ ] **Step 4: Campos motivo/comentario en el modal de ajuste**

En el `<UModal>` de "Ajustar stock" (~línea 605), debajo del select de tipo:

```vue
          <UFormField label="Motivo" required>
            <USelectMenu
              v-model="ajusteForm.motivo"
              :items="motivoOpts"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Comentario">
            <UInput v-model="ajusteForm.comentario" placeholder="Opcional" class="w-full" />
          </UFormField>
```

- [ ] **Step 5: Modal de historial (kardex)**

Agregar un nuevo `<UModal>` al final del template:

```vue
    <!-- Modal historial de inventario -->
    <UModal
      v-model:open="historialOpen"
      :title="`Historial — ${historialItemNombre}`"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <div v-if="historialLoading" class="py-8 text-center text-muted">Cargando…</div>
        <div v-else-if="!movimientos.length" class="py-8 text-center text-muted">
          Sin movimientos registrados.
        </div>
        <table v-else class="w-full text-sm">
          <thead class="text-muted text-left">
            <tr class="border-b border-default">
              <th class="py-2">Fecha</th>
              <th>Tipo</th>
              <th>Motivo</th>
              <th class="text-right">Cantidad</th>
              <th class="text-right">Resultante</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in movimientos" :key="m.id" class="border-b border-default">
              <td class="py-2">{{ new Date(m.creadoEl).toLocaleString() }}</td>
              <td>
                <UBadge
                  :label="m.tipo === 'entrada' ? 'Entrada' : 'Salida'"
                  :color="m.tipo === 'entrada' ? 'success' : 'warning'"
                  variant="subtle"
                  size="sm"
                />
              </td>
              <td>{{ m.motivo }}</td>
              <td class="text-right">{{ m.cantidad }}</td>
              <td class="text-right font-medium">{{ m.stockResultante }}</td>
              <td>{{ m.usuarioNombre ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton color="neutral" variant="ghost" @click="historialOpen = false">Cerrar</UButton>
        </div>
      </template>
    </UModal>
```

- [ ] **Step 6: Verificación manual**

Run: `docker-compose up` → login admin → `/configuracion/items` → ajustar stock de un producto (con motivo/comentario) → abrir "Historial" y ver el movimiento reflejado con saldo resultante.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/pages/configuracion/items.vue
git commit -m "feat(frontend): ajuste de stock con motivo/comentario + modal de historial (kardex)"
```

---

### Task 9: Página dedicada `/configuracion/inventario` + navegación

**Files:**
- Create: `frontend/app/pages/configuracion/inventario.vue`
- Modify: `frontend/app/pages/configuracion.vue` (navItems, bloque `esAdmin`)

- [ ] **Step 1: Agregar el item de navegación**

En `configuracion.vue`, dentro del bloque `if (permissionsStore.esAdmin)`, junto a `items` (~línea 76):

```typescript
      {
        label: 'Inventario',
        icon: 'i-lucide-clipboard-list',
        to: '/configuracion/inventario',
      },
```

- [ ] **Step 2: Crear la página global de movimientos**

```vue
<!-- frontend/app/pages/configuracion/inventario.vue -->
<script setup lang="ts">
const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()

interface Movimiento {
  id: string
  itemId: string
  itemNombre: string
  tipo: string
  motivo: string
  cantidad: string
  stockAnterior: string
  stockResultante: string
  usuarioNombre: string | null
  comentario: string | null
  creadoEl: string
}
interface Opt { label: string; value: string }

const movimientos = ref<Movimiento[]>([])
const loading = ref(false)
const productosOpts = ref<Opt[]>([])
const filtroItem = ref('')
const filtroMotivo = ref('')

const motivoOpts: Opt[] = [
  { label: 'Todos los motivos', value: '' },
  { label: 'Compra', value: 'compra' },
  { label: 'Venta', value: 'venta' },
  { label: 'Devolución', value: 'devolucion' },
  { label: 'Merma', value: 'merma' },
  { label: 'Ajuste manual', value: 'ajuste_manual' },
  { label: 'Inventario inicial', value: 'inventario_inicial' },
]

async function cargarProductos() {
  try {
    const items = await useApiFetch<{ id: string; nombre: string }[]>(
      `${apiUrl}/items?tipo=producto`,
    )
    productosOpts.value = [
      { label: 'Todos los productos', value: '' },
      ...items.map((i) => ({ label: i.nombre, value: i.id })),
    ]
  } catch {
    toast.add({ title: 'Error al cargar productos', color: 'error' })
  }
}

async function cargar() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (filtroItem.value) params.set('itemId', filtroItem.value)
    if (filtroMotivo.value) params.set('motivo', filtroMotivo.value)
    const qs = params.toString()
    movimientos.value = await useApiFetch<Movimiento[]>(
      `${apiUrl}/inventario/movimientos${qs ? `?${qs}` : ''}`,
    )
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al cargar movimientos'
    toast.add({ title: msg, color: 'error' })
  } finally {
    loading.value = false
  }
}

watch([filtroItem, filtroMotivo], cargar)
onMounted(async () => {
  await Promise.all([cargarProductos(), cargar()])
})
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-semibold">Inventario</h1>
      <p class="text-sm text-muted">Kardex de movimientos de stock</p>
    </div>

    <div class="flex flex-wrap gap-2">
      <USelectMenu
        v-model="filtroItem"
        :items="productosOpts"
        value-key="value"
        class="w-64"
        placeholder="Producto"
      />
      <USelectMenu
        v-model="filtroMotivo"
        :items="motivoOpts"
        value-key="value"
        class="w-52"
        placeholder="Motivo"
      />
    </div>

    <UCard>
      <div v-if="loading" class="py-8 text-center text-muted">Cargando…</div>
      <div v-else-if="!movimientos.length" class="py-8 text-center text-muted">
        No hay movimientos registrados.
      </div>
      <table v-else class="w-full text-sm">
        <thead class="text-muted text-left">
          <tr class="border-b border-default">
            <th class="py-2">Fecha</th>
            <th>Producto</th>
            <th>Tipo</th>
            <th>Motivo</th>
            <th class="text-right">Cantidad</th>
            <th class="text-right">Resultante</th>
            <th>Usuario</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in movimientos" :key="m.id" class="border-b border-default">
            <td class="py-2">{{ new Date(m.creadoEl).toLocaleString() }}</td>
            <td class="font-medium">{{ m.itemNombre }}</td>
            <td>
              <UBadge
                :label="m.tipo === 'entrada' ? 'Entrada' : 'Salida'"
                :color="m.tipo === 'entrada' ? 'success' : 'warning'"
                variant="subtle"
                size="sm"
              />
            </td>
            <td>{{ m.motivo }}</td>
            <td class="text-right">{{ m.cantidad }}</td>
            <td class="text-right font-medium">{{ m.stockResultante }}</td>
            <td>{{ m.usuarioNombre ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </UCard>
  </div>
</template>
```

> La página hereda `middleware`/`layout` del padre `configuracion.vue` (no requiere `definePageMeta`).

- [ ] **Step 3: Verificación manual**

Run: `docker-compose up` → login admin → `/configuracion/inventario`: ver la lista global, filtrar por producto y por motivo. Hacer un ajuste en `/configuracion/items` y confirmar que aparece aquí.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/configuracion/inventario.vue frontend/app/pages/configuracion.vue
git commit -m "feat(frontend): página de inventario con kardex global filtrable + navegación"
```

---

## Docs

### Task 10: Documentación viva

**Files:**
- Create: `docs/features/inventario-kardex.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/README.md` (link a la nueva feature)
- Modify: `docs/MIGRACION-FUNCIONALIDADES.md` (estado → ✅)
- Modify: `CLAUDE.md` (tabla "Estado actual": "Gestión de inventario (kardex…)" → ✅ Implementado)
- Opcional: `docs/adr/` — ADR "Stock materializado vía InventarioService manager-aware" + índice `docs/adr/README.md`

- [ ] **Step 1: Escribir `docs/features/inventario-kardex.md`**

Desde la plantilla: descripción, endpoints (`GET /inventario/movimientos`, `PATCH /items/:id/stock`), vocabulario tipo/motivo, regla "movimiento + saldo en una transacción", reutilización por ventas (futuro), y las dos vistas de UI.

- [ ] **Step 2: Actualizar links y estados**

`docs/README.md`: link a la feature. `docs/MIGRACION-FUNCIONALIDADES.md` y la tabla "Estado actual" de `CLAUDE.md`: marcar la fila del kardex como ✅ Implementado.

- [ ] **Step 3: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: documentar gestión de inventario (kardex) y marcar como implementado"
```

---

## Verification

**Backend (automatizada):**
```bash
cd backend
npm test                 # inventario.service.spec + items.service.spec en verde
npx tsc --noEmit         # sin errores de tipos
npm run lint             # limpio
```

**End-to-end (manual, con stack levantado):**
1. `docker-compose down -v && docker-compose up --build` (BD limpia → seed corre).
2. Login como admin del tenant Paris.
3. `/configuracion/items`: el smartphone muestra Stock 25.
4. Ajustar stock (entrada, motivo "compra", comentario) → toast con nuevo saldo; abrir "Historial" → ver 2 movimientos (inicial + el nuevo) con saldos correctos.
5. Probar salida con cantidad mayor al stock → toast "Stock insuficiente para la salida" (no se registra movimiento — la transacción revierte).
6. Crear un producto nuevo con stock inicial > 0 → en su Historial aparece el movimiento `inventario_inicial`.
7. `/configuracion/inventario`: la vista global lista todos los movimientos; filtrar por producto y por motivo.
8. Verificar consistencia: `item_producto.stock` coincide con `stock_resultante` del último movimiento de cada producto.

## Decisions / Open questions

- **`ajuste` absoluto reservado:** el `tipo` SQL admite `'ajuste'` pero esta fase solo usa `entrada`/`salida`. Recuento absoluto de inventario queda para fase futura.
- **`FOR UPDATE`** en `registrarMovimiento` evita carreras al materializar el saldo (dos movimientos simultáneos sobre el mismo item).
- **Reutilización por ventas:** `InventarioService.registrarMovimiento(manager, …)` está diseñado para que la futura transacción de venta registre `salida`/`motivo='venta'` (y devoluciones `entrada`/`motivo='devolucion'`) sin duplicar lógica.
- **A confirmar durante la ejecución:** el nombre real de la columna de nombre en la tabla `usuarios` (alias `u.nombre AS usuario_nombre` en `findMovimientos`) — ajustar si difiere.
