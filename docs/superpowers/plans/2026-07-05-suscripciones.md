# Plan: Suscripciones reales (tipo de item `suscripcion` + alta con primer cobro)

- **Status:** Draft
- **Date:** 2026-07-05
- **Owner:** Cesar Matheus

> **Spec (fuente de las decisiones):** `docs/superpowers/specs/2026-07-05-suscripciones-design.md`
> Antes de escribir código: invocar skills `nestjs-best-practices` (backend) y
> `nuxt-ui` (frontend). El esquema de BD en dev lo crea TypeORM `synchronize`
> (registrar entities en `app.module.ts` basta para crear las tablas).

## Context

La sección Suscripciones de la Tienda Online es hoy un mock en `localStorage`.
Esta fase la vuelve real: el admin crea items de un nuevo tipo `suscripcion`
(con frecuencia `semanal | quincenal | mensual`) en Configuración → Items, y el
usuario se suscribe desde la Tienda eligiendo su día de cobro y tarjeta. El alta
pasa por la pasarela dummy y, al aprobar, se crea en **una transacción** la venta
online `pagada` del primer período + la suscripción `activa`.

Reglas de día por frecuencia (elegidas por el cliente al suscribirse):
- **mensual**: `diaMes` 1–28.
- **quincenal**: `diaMes` 1–13; se cobra ese día y 15 días después (día X y X+15).
- **semanal**: `diaSemana` 0–6 (0 = domingo, como `Date.getDay()`), un solo día.

## Scope / Out of scope

**In scope:** tipo de item `suscripcion` (entity + DTOs + service + form de
configuración), tabla y módulo `suscripciones` (POST/GET/PATCH), refactor
`VentasService.crearEnTransaccion` para atomicidad, cálculo de `proximo_cobro`,
seeder, página de suscripciones contra API con drawer de alta, pasarela en modo
suscripción, docs vivas.

**Out of scope:** scheduler/cobro recurrente, backend de tarjetas (siguen mock),
prorrateo, historial de cobros, RBAC nuevo (se reutiliza "Tienda Online").

---

## Backend

### Task 1: Tipo de item `suscripcion` (módulo `items`)

**Files:**
- Create: `backend/src/modules/items/entities/item-suscripcion.entity.ts`
- Modify: `backend/src/modules/items/dto/create-item.dto.ts`
- Modify: `backend/src/modules/items/dto/update-item.dto.ts`
- Modify: `backend/src/modules/items/dto/query-items.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts`
- Modify: `backend/src/modules/items/items.module.ts` (forFeature)
- Modify: `backend/src/app.module.ts` (array `entities`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces (lo que consumen tareas posteriores):**
- `mapRow()` del `ItemsService` expone `frecuencia: string | null` — lo usan
  `SuscripcionesService` (tarea 4) y el frontend (`GET /items` / `GET /items/:id`).
- `GET /items?tipo=suscripcion` lista los items suscribibles.

- [ ] **1.1 Entity `ItemSuscripcion`** (patrón `ItemServicio`, ADR-004):

```typescript
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('item_suscripcion')
export class ItemSuscripcion {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'text' })
  frecuencia: string; // 'semanal' | 'quincenal' | 'mensual'
}
```

Registrar en `items.module.ts` (`TypeOrmModule.forFeature([..., ItemSuscripcion])`)
y en el array `entities` de `app.module.ts` (junto a `ItemProducto`/`ItemServicio`,
líneas ~127-128).

- [ ] **1.2 DTOs**:
  - `create-item.dto.ts`: `@IsIn(['producto', 'servicio', 'suscripcion'])` en `tipo`
    (línea 68) y nuevo campo:

```typescript
  // Extensión suscripción
  @IsIn(['semanal', 'quincenal', 'mensual'])
  @IsOptional()
  frecuencia?: string;
```

  - `update-item.dto.ts`: mismo campo `frecuencia` opcional.
  - `query-items.dto.ts`: `@IsIn(['producto', 'servicio', 'suscripcion'])` y tipo
    `'producto' | 'servicio' | 'suscripcion'`.

- [ ] **1.3 Tests primero** (agregar al describe de `create` en
  `items.service.spec.ts`, con los mocks existentes de `manager.query`):
  - crea item suscripción → hace `INSERT INTO item_suscripcion` con la frecuencia.
  - tipo `suscripcion` sin `frecuencia` → `BadRequestException`.
  - `frecuencia` con tipo `producto` → `BadRequestException`.
  Correr `cd backend && npm test -- items.service` → los 3 nuevos FALLAN.

- [ ] **1.4 `items.service.ts`**:
  - `BASE_QUERY`: agregar `LEFT JOIN item_suscripcion isu ON isu.item_id = i.item_id`
    y `isu.frecuencia` al SELECT.
  - `ItemRow`: `frecuencia: string | null;` — `mapRow()`: `frecuencia: r.frecuencia,`.
  - `create()`: validación al inicio del método (antes de la transacción):

```typescript
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
```

  y el branch de extensión (hoy `if producto ... else servicio`, líneas 242-303)
  pasa a tres ramas explícitas:

```typescript
      } else if (dto.tipo === 'servicio') {
        await manager.query(
          `INSERT INTO item_servicio (item_id, duracion_estimada, requiere_cita)
           VALUES ($1,$2,$3)`,
          [itemId, dto.duracionEstimada ?? null, dto.requiereCita ?? false],
        );
      } else {
        await manager.query(
          `INSERT INTO item_suscripcion (item_id, frecuencia) VALUES ($1,$2)`,
          [itemId, dto.frecuencia],
        );
      }
```

  - `update()`: el `else` de servicio (líneas 450-469) pasa a
    `else if (tipo === 'servicio')` + rama nueva:

```typescript
      } else if (tipo === 'suscripcion') {
        if (dto.frecuencia !== undefined) {
          await manager.query(
            `UPDATE item_suscripcion SET frecuencia = $1 WHERE item_id = $2`,
            [dto.frecuencia, itemId],
          );
        }
      }
```

- [ ] **1.5** `npm test -- items.service` en verde. Nota: no hay que tocar
  `ventas.service.ts` (7f ya usa `if (item.tipo !== 'producto') continue;`) ni
  `ajustarStock` (ya rechaza no-productos). Commit:
  `feat(items): add suscripcion item type with frecuencia extension`.

### Task 2: Util puro `calcularProximoCobro` (TDD)

**Files:**
- Create: `backend/src/modules/suscripciones/utils/proximo-cobro.util.ts`
- Test: `backend/src/modules/suscripciones/utils/proximo-cobro.util.spec.ts`

**Interfaces (produce):**
`calcularProximoCobro(frecuencia: string, desde: Date, diaMes?: number | null, diaSemana?: number | null): string`
— retorna fecha `'YYYY-MM-DD'`. La consume `SuscripcionesService.crear` (tarea 4).

- [ ] **2.1 Tests primero** (funciones puras, sin mocks):

```typescript
import { calcularProximoCobro } from './proximo-cobro.util';

describe('calcularProximoCobro', () => {
  // mensual: el diaMes del mes siguiente al alta
  it('mensual: 2026-07-05 con diaMes 10 → 2026-08-10', () => {
    expect(calcularProximoCobro('mensual', new Date(2026, 6, 5), 10)).toBe(
      '2026-08-10',
    );
  });
  it('mensual: cruza fin de año (2026-12-20, diaMes 5 → 2027-01-05)', () => {
    expect(calcularProximoCobro('mensual', new Date(2026, 11, 20), 5)).toBe(
      '2027-01-05',
    );
  });

  // quincenal: primera ocurrencia de diaMes o diaMes+15 posterior al alta
  it('quincenal: alta 2026-07-05 con diaMes 5 → 2026-07-20 (X+15)', () => {
    expect(calcularProximoCobro('quincenal', new Date(2026, 6, 5), 5)).toBe(
      '2026-07-20',
    );
  });
  it('quincenal: alta 2026-07-25 con diaMes 5 → 2026-08-05 (mes siguiente)', () => {
    expect(calcularProximoCobro('quincenal', new Date(2026, 6, 25), 5)).toBe(
      '2026-08-05',
    );
  });
  it('quincenal: alta 2026-07-01 con diaMes 3 → 2026-07-03 (X este mes)', () => {
    expect(calcularProximoCobro('quincenal', new Date(2026, 6, 1), 3)).toBe(
      '2026-07-03',
    );
  });

  // semanal: el diaSemana de la semana siguiente al alta
  it('semanal: domingo 2026-07-05 eligiendo domingo (0) → 2026-07-12', () => {
    expect(calcularProximoCobro('semanal', new Date(2026, 6, 5), null, 0)).toBe(
      '2026-07-12',
    );
  });
  it('semanal: domingo 2026-07-05 eligiendo miércoles (3) → 2026-07-15', () => {
    expect(calcularProximoCobro('semanal', new Date(2026, 6, 5), null, 3)).toBe(
      '2026-07-15',
    );
  });
});
```

- [ ] **2.2 Implementación** (fecha-solo, sin TZ; `diaMes ≤ 28` evita meses cortos):

```typescript
function toISODate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function calcularProximoCobro(
  frecuencia: string,
  desde: Date,
  diaMes?: number | null,
  diaSemana?: number | null,
): string {
  const base = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());

  if (frecuencia === 'mensual') {
    return toISODate(
      new Date(base.getFullYear(), base.getMonth() + 1, diaMes as number),
    );
  }

  if (frecuencia === 'quincenal') {
    const d = diaMes as number;
    const candidatas = [
      new Date(base.getFullYear(), base.getMonth(), d),
      new Date(base.getFullYear(), base.getMonth(), d + 15),
      new Date(base.getFullYear(), base.getMonth() + 1, d),
    ];
    const proxima = candidatas.find((c) => c.getTime() > base.getTime());
    return toISODate(proxima as Date);
  }

  // semanal: siempre en la semana siguiente (7 a 13 días desde el alta)
  const delta = ((diaSemana as number) - base.getDay() + 7) % 7;
  return toISODate(
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta + 7),
  );
}
```

- [ ] **2.3** `npm test -- proximo-cobro` en verde. Commit:
  `feat(suscripciones): add proximo-cobro date util`.

### Task 3: Refactor `VentasService` — `crearEnTransaccion` reutilizable

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts:63,157-158`
- Test: `backend/src/modules/ventas/ventas.service.spec.ts` (deben seguir en verde sin cambios)

**Interfaces (produce):**
`crearEnTransaccion(manager: EntityManager, tenantId: string, usuarioId: string, dto: CreateVentaDto)`
— público, mismo retorno que `crear()`. `crear()` queda como wrapper. La consume
`SuscripcionesService` (tarea 4) para meter venta + suscripción en la misma transacción.

- [ ] **3.1** Renombrar el cuerpo de `crear()` a `crearEnTransaccion(manager, tenantId, usuarioId, dto)`:
  los pasos 1–6 (lecturas y cálculo) quedan igual (usan `this.dataSource.query`,
  son reads); el paso 7 deja de abrir `this.dataSource.transaction(...)` y usa
  directamente el `manager` recibido. `crear()` queda:

```typescript
  async crear(tenantId: string, usuarioId: string, dto: CreateVentaDto) {
    return this.dataSource.transaction((manager) =>
      this.crearEnTransaccion(manager, tenantId, usuarioId, dto),
    );
  }
```

  (Import `EntityManager` de `typeorm`.)

- [ ] **3.2** `npm test -- ventas.service` — todos los tests existentes siguen en
  verde sin modificarlos (el mock de `dataSource.transaction` como
  `(cb) => cb(managerMock)` sigue funcionando). Commit:
  `refactor(ventas): extract crearEnTransaccion for cross-module transactions`.

### Task 4: Módulo `suscripciones` (nuevo)

**Files:**
- Create: `backend/src/modules/suscripciones/entities/suscripcion.entity.ts`
- Create: `backend/src/modules/suscripciones/dto/create-suscripcion.dto.ts`
- Create: `backend/src/modules/suscripciones/dto/update-suscripcion.dto.ts`
- Create: `backend/src/modules/suscripciones/suscripciones.service.ts`
- Create: `backend/src/modules/suscripciones/suscripciones.controller.ts`
- Create: `backend/src/modules/suscripciones/suscripciones.module.ts`
- Modify: `backend/src/app.module.ts` (entity + módulo)
- Test: `backend/src/modules/suscripciones/suscripciones.service.spec.ts`

**Interfaces (produce, las consume el frontend):**
- `POST /suscripciones` body `{ itemId, diaMes?, diaSemana?, metodoPagoId, tarjeta? }`
  → `{ id, ventaInicialId, proximoCobro, estado: 'activa' }`.
- `GET /suscripciones` → array de la shape `Suscripcion` del frontend (tarea 7).
- `PATCH /suscripciones/:id` body `{ accion: 'pausar' | 'reanudar' | 'cancelar' }`.

- [ ] **4.1 Entity** (tabla `suscripciones`, spec § Modelo de datos):

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('suscripciones')
export class Suscripcion {
  @PrimaryGeneratedColumn('uuid', { name: 'suscripcion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'text' })
  frecuencia: string; // snapshot del item al suscribirse

  @Column({ name: 'dia_mes', type: 'smallint', nullable: true })
  diaMes: number | null;

  @Column({ name: 'dia_semana', type: 'smallint', nullable: true })
  diaSemana: number | null;

  @Column({ type: 'text', default: 'activa' })
  estado: string; // 'activa' | 'pausada' | 'cancelada'

  @Column({ name: 'proximo_cobro', type: 'date' })
  proximoCobro: string;

  @Column({ name: 'tarjeta_marca', type: 'text', nullable: true })
  tarjetaMarca: string | null;

  @Column({ name: 'tarjeta_last4', type: 'text', nullable: true })
  tarjetaLast4: string | null;

  @Column({ name: 'venta_inicial_id', type: 'uuid', nullable: true })
  ventaInicialId: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

- [ ] **4.2 DTOs**:

```typescript
// create-suscripcion.dto.ts
import {
  IsUUID,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TarjetaSnapshotDto {
  @IsString()
  @IsNotEmpty()
  marca: string;

  @IsString()
  @IsNotEmpty()
  last4: string;
}

export class CreateSuscripcionDto {
  @IsUUID()
  itemId: string;

  @IsInt()
  @Min(1)
  @Max(28)
  @IsOptional()
  diaMes?: number;

  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  diaSemana?: number;

  @IsUUID()
  metodoPagoId: string;

  @ValidateNested()
  @Type(() => TarjetaSnapshotDto)
  @IsOptional()
  tarjeta?: TarjetaSnapshotDto;
}
```

```typescript
// update-suscripcion.dto.ts
import { IsIn } from 'class-validator';

export class UpdateSuscripcionDto {
  @IsIn(['pausar', 'reanudar', 'cancelar'])
  accion: 'pausar' | 'reanudar' | 'cancelar';
}
```

- [ ] **4.3 Tests primero** (`suscripciones.service.spec.ts`; mocks:
  `getRepositoryToken(Suscripcion)`, `getDataSourceToken()` con
  `transaction: (cb) => cb(managerMock)` y `query`, `ItemsService.findOne`,
  `CalculoPreciosService.calcular`, `VentasService.crearEnTransaccion`):
  - **crear happy path (mensual)**: item mock `{ id, tipo: 'suscripcion', frecuencia: 'mensual', nombre, precioBase }`,
    `calcular` → `{ totales: { totalFinal: '30000.0000' } }`, `crearEnTransaccion`
    → `{ id: 'venta-1' }`. Verifica: se llamó `crearEnTransaccion` con
    `canal: 'online'`, `lineas: [{ itemId, cantidad: '1' }]` y
    `pagos: [{ metodoPagoId, monto: '30000.0000' }]`; el save de la suscripción
    lleva `estado: 'activa'`, `ventaInicialId: 'venta-1'`, `frecuencia: 'mensual'`
    y `proximoCobro` con formato `YYYY-MM-DD`.
  - **item tipo producto** → `BadRequestException('El item no es una suscripción')`.
  - **item inactivo** → `BadRequestException`.
  - **mensual sin `diaMes`** → `BadRequestException`.
  - **quincenal con `diaMes: 14`** → `BadRequestException` (máximo 13).
  - **semanal sin `diaSemana`** → `BadRequestException`.
  - **cambiarEstado**: `pausar` sobre `activa` → ok; `pausar` sobre `pausada` →
    `BadRequestException`; `reanudar` sobre `cancelada` → `BadRequestException`;
    `cancelar` sobre `pausada` → ok; id ajeno (repo devuelve null) → `NotFoundException`.
  Correr `npm test -- suscripciones.service` → FALLAN.

- [ ] **4.4 Service**:

```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Suscripcion } from './entities/suscripcion.entity';
import { CreateSuscripcionDto } from './dto/create-suscripcion.dto';
import { UpdateSuscripcionDto } from './dto/update-suscripcion.dto';
import { ItemsService } from '../items/items.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { VentasService } from '../ventas/ventas.service';
import { calcularProximoCobro } from './utils/proximo-cobro.util';

const TRANSICIONES: Record<string, { desde: string[]; hacia: string }> = {
  pausar: { desde: ['activa'], hacia: 'pausada' },
  reanudar: { desde: ['pausada'], hacia: 'activa' },
  cancelar: { desde: ['activa', 'pausada'], hacia: 'cancelada' },
};

@Injectable()
export class SuscripcionesService {
  constructor(
    @InjectRepository(Suscripcion)
    private readonly suscripcionRepo: Repository<Suscripcion>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly itemsService: ItemsService,
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly ventasService: VentasService,
  ) {}

  async crear(tenantId: string, usuarioId: string, dto: CreateSuscripcionDto) {
    // 1. Item suscribible del tenant
    const item = await this.itemsService.findOne(tenantId, dto.itemId);
    if (item.tipo !== 'suscripcion') {
      throw new BadRequestException('El item no es una suscripción');
    }
    if (!item.activo) {
      throw new BadRequestException('El item no está activo');
    }
    const frecuencia = item.frecuencia as string;

    // 2. Día según frecuencia (el rango grueso lo valida el DTO; aquí las reglas cruzadas)
    if (frecuencia === 'mensual' && dto.diaMes == null) {
      throw new BadRequestException(
        'Las suscripciones mensuales requieren el día del mes (1-28)',
      );
    }
    if (frecuencia === 'quincenal') {
      if (dto.diaMes == null || dto.diaMes > 13) {
        throw new BadRequestException(
          'Las suscripciones quincenales requieren un día del mes entre 1 y 13',
        );
      }
    }
    if (frecuencia === 'semanal' && dto.diaSemana == null) {
      throw new BadRequestException(
        'Las suscripciones semanales requieren el día de la semana',
      );
    }

    // 3. Total del primer período (mismo motor que usará la venta)
    const resultado = await this.calculoPreciosService.calcular(tenantId, {
      lineas: [{ itemId: dto.itemId, cantidad: '1' }],
    });

    // 4. Nombre del usuario para el customer de la venta
    const usuarioRows: { nombre: string }[] = await this.dataSource.query(
      `SELECT nombre FROM usuarios WHERE usuario_id = $1 AND eliminado_el IS NULL`,
      [usuarioId],
    );
    const customerNombre = usuarioRows[0]?.nombre ?? 'Suscriptor online';

    // 5. Venta del primer cobro + suscripción, en UNA transacción
    return this.dataSource.transaction(async (manager) => {
      const venta = await this.ventasService.crearEnTransaccion(
        manager,
        tenantId,
        usuarioId,
        {
          canal: 'online',
          lineas: [{ itemId: dto.itemId, cantidad: '1' }],
          pagos: [
            {
              metodoPagoId: dto.metodoPagoId,
              monto: resultado.totales.totalFinal,
            },
          ],
          customer: { nombre: customerNombre },
        },
      );

      const suscripcion = await manager.save(
        Suscripcion,
        manager.create(Suscripcion, {
          tenantId,
          usuarioId,
          itemId: dto.itemId,
          frecuencia,
          diaMes: dto.diaMes ?? null,
          diaSemana: dto.diaSemana ?? null,
          estado: 'activa',
          proximoCobro: calcularProximoCobro(
            frecuencia,
            new Date(),
            dto.diaMes,
            dto.diaSemana,
          ),
          tarjetaMarca: dto.tarjeta?.marca ?? null,
          tarjetaLast4: dto.tarjeta?.last4 ?? null,
          ventaInicialId: venta.id,
        }),
      );

      return {
        id: suscripcion.id,
        ventaInicialId: venta.id,
        proximoCobro: suscripcion.proximoCobro,
        estado: suscripcion.estado,
      };
    });
  }

  async findMias(tenantId: string, usuarioId: string) {
    const rows: {
      suscripcion_id: string;
      item_id: string;
      item_nombre: string;
      precio_base: string;
      moneda_id: string;
      frecuencia: string;
      dia_mes: number | null;
      dia_semana: number | null;
      estado: string;
      proximo_cobro: string;
      tarjeta_marca: string | null;
      tarjeta_last4: string | null;
      venta_inicial_id: string | null;
      creado_el: Date;
    }[] = await this.dataSource.query(
      `SELECT s.suscripcion_id, s.item_id, i.nombre AS item_nombre,
              i.precio_base, i.moneda_id,
              s.frecuencia, s.dia_mes, s.dia_semana, s.estado, s.proximo_cobro,
              s.tarjeta_marca, s.tarjeta_last4, s.venta_inicial_id, s.creado_el
       FROM suscripciones s
       JOIN items i ON i.item_id = s.item_id AND i.eliminado_el IS NULL
       WHERE s.tenant_id = $1 AND s.usuario_id = $2 AND s.eliminado_el IS NULL
       ORDER BY s.creado_el DESC`,
      [tenantId, usuarioId],
    );

    return rows.map((r) => ({
      id: r.suscripcion_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      precio: r.precio_base,
      monedaId: r.moneda_id,
      frecuencia: r.frecuencia,
      diaMes: r.dia_mes,
      diaSemana: r.dia_semana,
      estado: r.estado,
      proximoCobro: r.proximo_cobro,
      tarjetaMarca: r.tarjeta_marca,
      tarjetaLast4: r.tarjeta_last4,
      ventaInicialId: r.venta_inicial_id,
      creadoEl: r.creado_el,
    }));
  }

  async cambiarEstado(
    tenantId: string,
    usuarioId: string,
    suscripcionId: string,
    dto: UpdateSuscripcionDto,
  ) {
    const suscripcion = await this.suscripcionRepo.findOne({
      where: { id: suscripcionId, tenantId, usuarioId },
    });
    if (!suscripcion) {
      throw new NotFoundException('Suscripción no encontrada');
    }

    const transicion = TRANSICIONES[dto.accion];
    if (!transicion.desde.includes(suscripcion.estado)) {
      throw new BadRequestException(
        `No se puede ${dto.accion} una suscripción ${suscripcion.estado}`,
      );
    }

    suscripcion.estado = transicion.hacia;
    await this.suscripcionRepo.save(suscripcion);
    return { id: suscripcion.id, estado: suscripcion.estado };
  }
}
```

- [ ] **4.5 Controller** (guards estándar; el RBAC "Tienda Online" ya filtra el
  acceso en frontend, mismo estándar que `/online/checkout`):

```typescript
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { SuscripcionesService } from './suscripciones.service';
import { CreateSuscripcionDto } from './dto/create-suscripcion.dto';
import { UpdateSuscripcionDto } from './dto/update-suscripcion.dto';

@ApiTags('suscripciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('suscripciones')
export class SuscripcionesController {
  constructor(private readonly suscripcionesService: SuscripcionesService) {}

  @Post()
  crear(@Req() req: Request, @Body() dto: CreateSuscripcionDto) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.crear(u.tenantId ?? '', u.id, dto);
  }

  @Get()
  findMias(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.findMias(u.tenantId ?? '', u.id);
  }

  @Patch(':id')
  cambiarEstado(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateSuscripcionDto,
  ) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.cambiarEstado(
      u.tenantId ?? '',
      u.id,
      id,
      dto,
    );
  }
}
```

- [ ] **4.6 Module + registro**:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Suscripcion } from './entities/suscripcion.entity';
import { SuscripcionesService } from './suscripciones.service';
import { SuscripcionesController } from './suscripciones.controller';
import { ItemsModule } from '../items/items.module';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { VentasModule } from '../ventas/ventas.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Suscripcion]),
    ItemsModule,
    CalculoPreciosModule,
    VentasModule, // exporta VentasService
  ],
  controllers: [SuscripcionesController],
  providers: [SuscripcionesService],
})
export class SuscripcionesModule {}
```

  En `app.module.ts`: `Suscripcion` al array `entities` + `SuscripcionesModule` a `imports`.

- [ ] **4.7** `npm test -- suscripciones.service` en verde; luego `npm test`
  completo + `npm run lint` (solo archivos tocados). Commit:
  `feat(suscripciones): add suscripciones module with first-charge signup`.

### Task 5: Seeder — items suscripción de ejemplo

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts` (método nuevo llamado desde `seedItems()`, línea ~1392)

- [ ] **5.1** Nuevo `seedItemsSuscripcion()` (patrón `seedItemSoporte`, idempotente
  por `SELECT 1 FROM items WHERE item_id = $1`), tenant Paris
  (`...440007`), moneda CLP (`...440003`). UUIDs siguientes libres (último usado: `...440156`):

| UUID | Nombre | Frecuencia | Precio CLP |
|---|---|---|---|
| `550e8400-e29b-41d4-a716-446655440157` | Mensualidad Gimnasio | mensual | 30000 |
| `550e8400-e29b-41d4-a716-446655440158` | Clase semanal de yoga | semanal | 8000 |
| `550e8400-e29b-41d4-a716-446655440159` | Plan quincenal de limpieza | quincenal | 15000 |

  Cada uno: `INSERT INTO items (..., tipo) VALUES (..., 'suscripcion')` +
  `INSERT INTO item_suscripcion (item_id, frecuencia) VALUES ($1,$2)`.
  Llamarlo al final de `seedItems()`.

- [ ] **5.2** Levantar backend (`docker-compose up` o `npm run start:dev`) y
  verificar con `mcp__postgres__query` que existen las tablas `item_suscripcion`
  y `suscripciones` y los 3 items sembrados. Commit:
  `feat(seeder): seed suscripcion example items`.

---

## Frontend

### Task 6: Configuración → Items: tipo "Suscripción"

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue`

- [ ] **6.1** Interfaces `Item` (líneas ~18 y ~68): agregar `frecuencia?: string | null`.
- [ ] **6.2** Catálogos: `tiposOpts` + `{ label: 'Suscripción', value: 'suscripcion' }`;
  `filtrosTipoOpts` + `{ label: 'Suscripciones', value: 'suscripcion' }`.
- [ ] **6.3** `emptyForm()`: agregar `frecuencia: 'mensual',` (bloque nuevo
  `// suscripción`). `abrirEditar()`: `frecuencia: detalle.frecuencia ?? 'mensual',`.
- [ ] **6.4** `guardar()`: el `else` final (líneas ~477-480, campos de servicio)
  pasa a ramas explícitas:

```typescript
    } else if (form.value.tipo === 'servicio') {
      payload.duracionEstimada = form.value.duracionEstimada || undefined
      payload.requiereCita = form.value.requiereCita
    } else {
      payload.frecuencia = form.value.frecuencia
    }
```

- [ ] **6.5** Template — sección nueva tras la extensión servicio (línea ~976):

```vue
          <!-- Extensión suscripción -->
          <template v-if="form.tipo === 'suscripcion'">
            <USeparator />
            <div>
              <p class="text-sm font-medium text-muted mb-3">Datos de suscripción</p>
              <UFormField label="Frecuencia de cobro" required>
                <USelectMenu
                  v-model="form.frecuencia"
                  :items="[
                    { label: 'Semanal', value: 'semanal' },
                    { label: 'Quincenal', value: 'quincenal' },
                    { label: 'Mensual', value: 'mensual' },
                  ]"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>
              <p class="text-xs text-muted mt-2">
                El precio del item es el precio por período. El cliente elige su día de cobro al suscribirse.
              </p>
            </div>
          </template>
```

- [ ] **6.6** Badge de tipo en la tabla (línea ~697-701): reemplazar los ternarios
  por mapas:

```typescript
const tipoLabels: Record<string, string> = {
  producto: 'Producto',
  servicio: 'Servicio',
  suscripcion: 'Suscripción',
}
const tipoColors: Record<string, 'primary' | 'secondary' | 'info'> = {
  producto: 'primary',
  servicio: 'secondary',
  suscripcion: 'info',
}
```

- [ ] **6.7** Verificar en navegador: crear "item suscripción" de prueba, editarlo
  (frecuencia editable, tipo bloqueado), filtrar por tipo. Commit:
  `feat(configuracion): add suscripcion item type to items form`.

### Task 7: `useSuscripciones` pasa de mock a API + lista

**Files:**
- Rewrite: `frontend/app/composables/useSuscripciones.ts`
- Modify: `frontend/app/pages/tienda/suscripciones.vue`

**Interfaces (produce):** shape `Suscripcion` = respuesta de `GET /suscripciones`
(tarea 4). Acciones optimistas con revert (patrón `docs/patterns/frontend.md` §3).

- [ ] **7.1** Reescribir el composable (se elimina el mock de `localStorage`;
  la clave `tienda:suscripciones:<tenantId>` queda huérfana, sin migración —
  eran datos de ejemplo):

```typescript
import { useApiFetch } from './useApiFetch'

export interface Suscripcion {
  id: string
  itemId: string
  itemNombre: string
  precio: string
  monedaId: string | null
  frecuencia: 'semanal' | 'quincenal' | 'mensual'
  diaMes: number | null
  diaSemana: number | null
  estado: 'activa' | 'pausada' | 'cancelada'
  proximoCobro: string
  tarjetaMarca: string | null
  tarjetaLast4: string | null
  ventaInicialId: string | null
}

const ESTADO_TRAS_ACCION = {
  pausar: 'pausada',
  reanudar: 'activa',
  cancelar: 'cancelada',
} as const

/** Suscripciones del usuario autenticado — GET/PATCH /suscripciones. */
export function useSuscripciones() {
  const config = useRuntimeConfig()
  const toast = useToast()
  const apiUrl = config.public.apiUrl

  const suscripciones = ref<Suscripcion[]>([])
  const loading = ref(false)
  const mutando = reactive(new Set<string>())

  async function cargar() {
    loading.value = true
    try {
      suscripciones.value = await useApiFetch<Suscripcion[]>(`${apiUrl}/suscripciones`)
    } catch (e: unknown) {
      const msg = (e as { data?: { message?: string } })?.data?.message
      toast.add({ title: msg ?? 'Error al cargar suscripciones', color: 'error' })
    } finally {
      loading.value = false
    }
  }

  async function accion(id: string, accion: keyof typeof ESTADO_TRAS_ACCION) {
    if (mutando.has(id)) return
    const susc = suscripciones.value.find((s) => s.id === id)
    if (!susc) return
    mutando.add(id)
    const prev = susc.estado
    susc.estado = ESTADO_TRAS_ACCION[accion]      // optimista
    try {
      await useApiFetch(`${apiUrl}/suscripciones/${id}`, {
        method: 'PATCH',
        body: { accion },
      })
    } catch (e: unknown) {
      susc.estado = prev                          // revert
      const msg = (e as { data?: { message?: string } })?.data?.message
      toast.add({ title: msg ?? 'Error al actualizar', color: 'error' })
    } finally {
      mutando.delete(id)
    }
  }

  const pausar = (id: string) => accion(id, 'pausar')
  const reanudar = (id: string) => accion(id, 'reanudar')
  const cancelar = (id: string) => accion(id, 'cancelar')

  onMounted(cargar)

  return { suscripciones, loading, cargar, pausar, reanudar, cancelar }
}
```

- [ ] **7.2** `suscripciones.vue`: el template actual sirve casi entero. Cambios:
  - `frecuenciaLabel`: reemplazar `anual: 'Anual'` por `quincenal: 'Quincenal'`.
  - Subtítulo de fila: agregar el día elegido (helper local):

```typescript
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function detalleDia(s: Suscripcion): string {
  if (s.frecuencia === 'semanal' && s.diaSemana !== null)
    return `los ${DIAS_SEMANA[s.diaSemana]}`
  if (s.frecuencia === 'quincenal' && s.diaMes !== null)
    return `los días ${s.diaMes} y ${s.diaMes + 15}`
  if (s.diaMes !== null) return `el día ${s.diaMes}`
  return ''
}
```

  - `formatMonto(row.original.precio, row.original.monedaId ?? undefined)` para
    respetar la moneda del item.
  - Estado de carga antes de la tabla (`v-if="loading"`, patrón estándar).

### Task 8: Drawer "Nueva suscripción" (formulario interactivo)

**Files:**
- Modify: `frontend/app/pages/tienda/suscripciones.vue`
- Create: `frontend/app/composables/useSuscripcionCheckout.ts`

**Interfaces (produce, la consume la pasarela — tarea 9):**

- [ ] **8.1** Estado compartido del alta (mismo patrón `useState` que
  `useTiendaCarrito`, sobrevive la navegación a la pasarela):

```typescript
import type { CheckoutResponse } from './useTiendaCarrito'

export interface SuscripcionCheckout {
  checkout: CheckoutResponse
  itemId: string
  itemNombre: string
  frecuencia: 'semanal' | 'quincenal' | 'mensual'
  diaMes: number | null
  diaSemana: number | null
  tarjeta: { marca: string, last4: string } | null
}

export function useSuscripcionCheckout() {
  return useState<SuscripcionCheckout | null>('tienda-suscripcion-checkout', () => null)
}
```

- [ ] **8.2** En `suscripciones.vue`, botón en el header (visible con
  `permissionsStore.esAdmin || permissionsStore.can('Tienda Online', 'Crear')`):

```vue
        <CrudPageHeader
          title="Suscripciones"
          description="Compras recurrentes de items del catálogo — pausá, reanudá o cancelá cuando quieras."
        >
          <template #actions>
            <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrear">
              Nueva suscripción
            </UButton>
          </template>
        </CrudPageHeader>
```

- [ ] **8.3** Script del drawer — items suscribibles + formulario dinámico
  (la página necesita `const config = useRuntimeConfig()`, `const apiUrl =
  config.public.apiUrl`, `const toast = useToast()` y
  `const permissionsStore = usePermissionsStore()` si aún no los tiene):

```typescript
const puedeCrear = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Tienda Online', 'Crear'),
)

interface ItemSuscribible {
  id: string
  nombre: string
  precioBase: string
  monedaId: string
  frecuencia: 'semanal' | 'quincenal' | 'mensual'
}

const drawerOpen = ref(false)
const itemsSuscribibles = ref<ItemSuscribible[]>([])
const confirmando = ref(false)

const form = ref({
  itemId: '',
  diaMes: 1,
  diaSemana: 1,
})

const itemSeleccionado = computed(
  () => itemsSuscribibles.value.find((i) => i.id === form.value.itemId) ?? null,
)

// Opciones de día según la frecuencia del item elegido
const diasMesOpts = computed(() => {
  const max = itemSeleccionado.value?.frecuencia === 'quincenal' ? 13 : 28
  return Array.from({ length: max }, (_, i) => ({ label: String(i + 1), value: i + 1 }))
})
const diasSemanaOpts = [
  { label: 'Lunes', value: 1 },
  { label: 'Martes', value: 2 },
  { label: 'Miércoles', value: 3 },
  { label: 'Jueves', value: 4 },
  { label: 'Viernes', value: 5 },
  { label: 'Sábado', value: 6 },
  { label: 'Domingo', value: 0 },
]

async function abrirCrear() {
  form.value = { itemId: '', diaMes: 1, diaSemana: 1 }
  drawerOpen.value = true
  if (!itemsSuscribibles.value.length) {
    try {
      const res = await useApiFetch<{ data: ItemSuscribible[] }>(
        `${apiUrl}/items?tipo=suscripcion&pageSize=100`,
      )
      itemsSuscribibles.value = res.data.filter((i) => i.frecuencia)
    } catch {
      toast.add({ title: 'Error al cargar items suscribibles', color: 'error' })
    }
  }
}
```

  Al cambiar de item, resetear el día si quedó fuera de rango
  (`watch(itemSeleccionado, ...)`: si quincenal y `diaMes > 13` → `diaMes = 1`).

- [ ] **8.4** Confirmar → checkout + pasarela (reutiliza `POST /online/checkout`
  para obtener el resumen con impuestos y el `ref`):

```typescript
const suscripcionCheckout = useSuscripcionCheckout()
const { preferida: tarjetaPreferida } = useTarjetas()

async function confirmar() {
  const item = itemSeleccionado.value
  if (!item) return
  confirmando.value = true
  try {
    const checkout = await useApiFetch<CheckoutResponse>(
      `${apiUrl}/online/checkout`,
      { method: 'POST', body: { lineas: [{ itemId: item.id, cantidad: '1' }] } },
    )
    suscripcionCheckout.value = {
      checkout,
      itemId: item.id,
      itemNombre: item.nombre,
      frecuencia: item.frecuencia,
      diaMes: item.frecuencia === 'semanal' ? null : form.value.diaMes,
      diaSemana: item.frecuencia === 'semanal' ? form.value.diaSemana : null,
      tarjeta: tarjetaPreferida.value
        ? { marca: tarjetaPreferida.value.marca, last4: tarjetaPreferida.value.last4 }
        : null,
    }
    drawerOpen.value = false
    await navigateTo(`/tienda/pasarela?ref=${checkout.checkoutRef}&modo=suscripcion`)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al iniciar la suscripción', color: 'error' })
  } finally {
    confirmando.value = false
  }
}
```

- [ ] **8.5** Template del drawer (`AppDrawer` + `UForm`, patrón `medios-pago.vue`):
  1. `USelectMenu` de item (label `nombre — formatMonto(precioBase, monedaId) / frecuencia`).
  2. Si `itemSeleccionado.frecuencia !== 'semanal'` → `USelectMenu` "Día del mes"
     con `diasMesOpts` (para quincenal, texto de apoyo:
     `"Se cobra el día {{ form.diaMes }} y el {{ form.diaMes + 15 }} de cada mes"`).
     Si es `semanal` → `USelectMenu` "Día de la semana" con `diasSemanaOpts`.
  3. Tarjeta: mostrar la preferida (`marca •••• last4`) o aviso con link a
     `/tienda/medios-pago` (mismo bloque que la pasarela).
  4. Resumen: precio del período (`formatMonto`) + frecuencia.
  5. Acciones: Cancelar / `Continuar al pago` (`:loading="confirmando"`,
     `:disabled="!itemSeleccionado"`, `@click="confirmar"`).

### Task 9: Pasarela dummy — modo suscripción

**Files:**
- Modify: `frontend/app/pages/tienda/pasarela.vue`

- [ ] **9.1** `onMounted`: aceptar cualquiera de los dos orígenes; snapshot local
  igual que hoy (el estado compartido se limpia al aprobar):

```typescript
const suscripcionCheckout = useSuscripcionCheckout()
const modoSuscripcion = computed(() => route.query.modo === 'suscripcion')
const suscripcionSnapshot = ref<SuscripcionCheckout | null>(null)

onMounted(async () => {
  if (modoSuscripcion.value) {
    if (!suscripcionCheckout.value
      || suscripcionCheckout.value.checkout.checkoutRef !== route.query.ref) {
      await navigateTo('/tienda/suscripciones')
      return
    }
    suscripcionSnapshot.value = suscripcionCheckout.value
    resumen.value = suscripcionCheckout.value.checkout
  } else {
    if (!checkout.value || checkout.value.checkoutRef !== route.query.ref) {
      await navigateTo('/tienda')
      return
    }
    resumen.value = checkout.value
    lineasSnapshot.value = lineas.value.map((l) => ({ itemId: l.item.id, cantidad: l.cantidad }))
  }
  try {
    metodos.value = await useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`)
  } catch {
    metodos.value = []
  }
})
```

- [ ] **9.2** `aprobar()`: rama suscripción → `POST /suscripciones` (el backend
  crea venta + suscripción); rama compra queda igual:

```typescript
async function aprobar() {
  if (!resumen.value) return
  const metodo = metodoTarjeta()
  if (!metodo) {
    toast.add({ title: 'No hay métodos de pago configurados', color: 'error' })
    return
  }

  estado.value = 'procesando'
  try {
    if (modoSuscripcion.value && suscripcionSnapshot.value) {
      const s = suscripcionSnapshot.value
      const creada = await useApiFetch<{ id: string, ventaInicialId: string }>(
        `${apiUrl}/suscripciones`,
        {
          method: 'POST',
          body: {
            itemId: s.itemId,
            diaMes: s.diaMes ?? undefined,
            diaSemana: s.diaSemana ?? undefined,
            metodoPagoId: metodo.metodoPagoId,
            tarjeta: s.tarjeta ?? undefined,
          },
        },
      )
      ventaId.value = creada.ventaInicialId
      suscripcionCheckout.value = null
    } else {
      const venta = await useApiFetch<{ id: string, estado: string }>(`${apiUrl}/ventas`, {
        method: 'POST',
        body: {
          canal: 'online',
          lineas: lineasSnapshot.value,
          pagos: [{ metodoPagoId: metodo.metodoPagoId, monto: resumen.value.resultado.totales.totalFinal }],
          customer: { nombre: authStore.user?.nombre ?? 'Cliente online' },
        },
      })
      ventaId.value = venta.id
      limpiar()
    }
    estado.value = 'aprobada'
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'El pago fue rechazado', color: 'error' })
    estado.value = 'rechazada'
  }
}
```

- [ ] **9.3** `rechazar()`: en modo suscripción → `suscripcionCheckout.value = null`
  y `navigateTo('/tienda/suscripciones')` (nada creado); compra igual que hoy.
- [ ] **9.4** Template:
  - Vista de éxito en modo suscripción: "Suscripción activada" + botón
    `Ver mis suscripciones` (`to="/tienda/suscripciones"`) además del link a la venta.
  - En modo suscripción, bajo el total, línea con el detalle del plan:
    `{{ suscripcionSnapshot.itemNombre }} · {{ frecuenciaLabel }} · <detalle del día>`
    y la tarjeta del snapshot (`s.tarjeta`) en lugar de `tarjetaPreferida`.
- [ ] **9.5** `cd frontend && npm test` (los 100 existentes en verde) + `npm run build`
  sin errores. Commit:
  `feat(tienda): subscription signup flow with first charge via dummy gateway`.

---

## Docs vivas (mismo cambio final)

- [ ] `CLAUDE.md`:
  - Tabla "Estado actual": fila nueva
    `| Suscripciones (tipo de item suscripcion, alta con primer cobro, gestión) | ✅ Implementado (2026-07-05) |`
    y actualizar la fila de Tienda Online (suscripciones ya no son mock).
  - Sección "Decisiones de arquitectura" → Items: mencionar la tercera extensión
    `item_suscripcion` (frecuencia) y que `suscripcion` no maneja stock.
- [ ] `docs/features/tienda-online.md`: sección Suscripciones (de mock a real:
  endpoints, flujo de alta, `useSuscripciones` API-backed) y Composables.
- [ ] `docs/PRODUCTO.md`: reglas de negocio del alta (primer cobro al suscribirse,
  día por frecuencia, transiciones de estado).
- [ ] `startup-pos.sql`: `CREATE TABLE item_suscripcion` y `CREATE TABLE suscripciones`
  (columnas de la entity, con FKs y soft delete).
- [ ] Commit: `docs(suscripciones): update living docs for real subscriptions`.

---

## Verification

1. **Unit backend**: `cd backend && npm test` — specs nuevos (`proximo-cobro.util`,
   `suscripciones.service`) + los existentes (`items.service`, `ventas.service`) en verde.
   `npm run lint` limpio en archivos tocados.
2. **Frontend**: `cd frontend && npm test` y `npm run build`.
3. **E2E manual** (docker-compose up, login admin Paris, chrome-devtools MCP):
   - Configuración → Items: crear item tipo Suscripción con frecuencia; badge y
     filtro correctos; editar frecuencia.
   - Tienda → Suscripciones: lista vacía (el mock ya no aparece) → "Nueva
     suscripción" → elegir "Mensualidad Gimnasio" → selector muestra día del mes
     1–28 → cambiar a item quincenal → selector 1–13 con texto "día X y X+15" →
     item semanal → días de la semana.
   - Confirmar → pasarela con resumen del plan → **Rechazar** → no se crea nada
     (verificar con `mcp__postgres__query`: `SELECT count(*) FROM suscripciones`).
   - Repetir → **Aprobar** → suscripción `activa` en la lista con próximo cobro
     correcto; venta online `pagada` en `/ventas`; en BD: fila en `suscripciones`
     con `venta_inicial_id` apuntando a esa venta.
   - Pausar / Reanudar / Cancelar persisten tras recargar (F5).
   - Usuario de otro tenant / sin permiso Tienda Online: no ve la entrada del sidebar.

## Decisions / Open questions

- **Atomicidad**: `VentasService.crearEnTransaccion(manager, ...)` permite que
  `SuscripcionesService` cree venta + suscripción en una sola transacción sin
  duplicar la lógica de ventas. `crear()` queda como wrapper — cero cambios de
  comportamiento para el resto de llamadores.
- **Monto del primer cobro**: lo calcula el backend (`CalculoPreciosService`)
  dentro de `SuscripcionesService.crear` — el frontend no manda montos. El motor
  corre dos veces (una para el pago, otra dentro de la venta), igual que en el
  checkout del carrito: mismo motor, mismos datos, aceptado.
- **`dia_semana` 0–6 con 0 = domingo** (convención `Date.getDay()`), aunque la UI
  lista lunes primero.
- **Frecuencia editable en el item**: cambiarla no afecta suscripciones existentes
  (llevan snapshot propio).
- **Mock anterior**: la clave `tienda:suscripciones:<tenantId>` de `localStorage`
  queda huérfana sin migración (eran datos de ejemplo).
- **RBAC**: guards estándar `JwtAuthGuard` + `TenantGuard` (mismo nivel que
  `/online/checkout`); el permiso granular `@RequiresPermiso` sigue fuera de
  alcance en todo el proyecto.
