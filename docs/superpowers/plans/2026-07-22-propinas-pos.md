# Propinas en el POS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar el cobro de propina en el Punto de Venta (canal `fisico`) reutilizando el pool de propinas del tenant, sin tocar el motor de liquidación.

**Architecture:** La propina de POS se persiste como una fila `venta_propina` atribuida a un **garzón placeholder "Mostrador"** por tenant, con `tipoGarzon/sesionGarzonId/turnoId = null`. Por cómo funciona el motor (`garzonesGrupo`), esa atribución neutra hace que el monto **sume al pool** pero el placeholder **nunca reciba**: la plata se reparte entre los participantes reales según la config vigente. Cero cambios de schema del pool ni del motor; solo se agrega una columna a `garzones` para identificar al placeholder.

**Tech Stack:** NestJS + TypeORM (backend, Jest + supertest para e2e), Nuxt 4 + Vue 3 (frontend), PostgreSQL 15. Dinero con decimal.js.

## Global Constraints

- `tenant_id` **siempre del token** (`user.tenantId`), nunca del body/query/param.
- Dinero y porcentajes con **Decimal.js**; porcentajes en decimal (`0.10` = 10%).
- **Soft delete**: nunca `DELETE`; toda lectura filtra `eliminado_el IS NULL`.
- **Permisos con guard real** por ruta (`@RequiresPermiso`).
- **No tocar el motor de cálculo de precios ni el de liquidación de propinas.**
- Seguir el patrón de seed: IDs fijos `550e8400-e29b-41d4-a716-446655440XXX`, próximo libre.
- Sin N+1: dato derivado por fila en una sola query/batch.
- Documentación viva en el mismo commit (tabla de CLAUDE.md).
- Trabajar directo sobre `main` (etapa de desarrollo); checklist de cierre obligatorio antes de cada commit.

**Constante de dominio (usada en varias tareas):**
- ID del garzón placeholder del tenant demo Paris: `550e8400-e29b-41d4-a716-446655440281`.
- `pin_hash` inutilizable del placeholder: la cadena literal `'!'` (no es un hash bcrypt válido → `bcrypt.compare` devuelve `false`). Redundante con `activo=false`, que ya lo excluye de `resolverGarzonPorPin`.

---

### Task 1: Columna `es_placeholder` en `garzones`, seed del "Mostrador" y exclusión del listado

**Files:**
- Modify: `backend/src/modules/garzones/entities/garzon.entity.ts`
- Modify: `startup-pos.sql:1209-1221` (tabla `garzones`)
- Modify: `backend/src/modules/garzones/garzones.service.ts:63-69` (`listar`)
- Modify: `backend/src/modules/seeder/seeder.service.ts:1298-1330` (`seedGarzones`)
- Test: `backend/test/ventas.e2e-spec.ts` (assert de exclusión; se agrega en Task 3, pero la lógica se implementa aquí)

**Interfaces:**
- Produces: columna `Garzon.esPlaceholder: boolean` (default `false`, snake_case `es_placeholder`). `GarzonesService.listar` deja de devolver placeholders.

- [ ] **Step 1: Agregar la columna a la entidad**

En `backend/src/modules/garzones/entities/garzon.entity.ts`, tras el campo `tipo` (línea 36), agregar:

```typescript
  @Column({ type: 'text', default: TipoGarzon.GARZON })
  tipo: TipoGarzon;

  // Garzón placeholder "Mostrador": recibe la propina del POS con atribución
  // neutra. No opera (activo=false), no se identifica por PIN y se oculta del
  // listado de garzones. Ver docs/features/pagos.md.
  @Column({ name: 'es_placeholder', type: 'boolean', default: false })
  esPlaceholder: boolean;
```

- [ ] **Step 2: Reflejar la columna en el esquema de referencia**

En `startup-pos.sql`, dentro de `CREATE TABLE garzones (...)`, agregar la columna tras `tipo` (línea 1215):

```sql
    tipo TEXT NOT NULL DEFAULT 'garzon',
    es_placeholder BOOLEAN NOT NULL DEFAULT false, -- garzón "Mostrador": recibe la propina del POS con atribución neutra
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
```

- [ ] **Step 3: Excluir el placeholder del listado de garzones**

En `backend/src/modules/garzones/garzones.service.ts`, método `listar` (línea 63), agregar el filtro:

```typescript
  async listar(tenantId: string): Promise<GarzonPublico[]> {
    const garzones = await this.garzonRepo.find({
      where: { tenantId, esPlaceholder: false },
      order: { nombre: 'ASC' },
    });
    return garzones.map((g) => this.toPublico(g));
  }
```

- [ ] **Step 4: Sembrar el placeholder del tenant demo Paris**

En `backend/src/modules/seeder/seeder.service.ts`, dentro de `seedGarzones` (línea 1301), agregar un cuarto elemento al array `garzones` tras "Carla Rojas":

```typescript
      {
        id: '550e8400-e29b-41d4-a716-446655440240',
        tenantId: PARIS,
        nombre: 'Carla Rojas',
        pinHash: '$2b$10$j8RWk.ZD2t1QNqeareWYwOZLGXo.vX2WnkTpcl8qS1TTIeqTd/QMK',
        activo: true,
      },
      {
        // Placeholder "Mostrador": receptor neutro de la propina del POS.
        id: '550e8400-e29b-41d4-a716-446655440281',
        tenantId: PARIS,
        nombre: 'Mostrador',
        pinHash: '!', // inutilizable: no es bcrypt válido → nunca matchea un PIN
        activo: false,
        esPlaceholder: true,
      },
```

- [ ] **Step 5: Verificar que compila y el seed corre**

Run: `cd backend && npm run typecheck`
Expected: PASS (sin errores de tipos por el nuevo campo).

Run: `docker-compose up -d --build backend db` y luego `docker-compose logs backend | grep "Seed complete"`
Expected: aparece "Seed complete." sin errores. (Alternativa sin Docker: `cd backend && npm run start:dev` y esperar el log "Seed complete.")

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/garzones/entities/garzon.entity.ts startup-pos.sql \
        backend/src/modules/garzones/garzones.service.ts \
        backend/src/modules/seeder/seeder.service.ts
git commit -m "feat(propinas): garzón placeholder Mostrador (columna es_placeholder + seed + oculto del listado)"
```

---

### Task 2: `asegurarMostrador` en `GarzonesService` y alta automática en la creación de tenant

**Files:**
- Modify: `backend/src/modules/garzones/garzones.service.ts` (nuevo método + imports)
- Create: `backend/src/modules/garzones/garzones.service.spec.ts`
- Modify: `backend/src/modules/tenants/tenants.service.ts:39-55` (inyectar `GarzonesService`) y `:113-120` (llamar tras la caja virtual)
- Modify: `backend/src/modules/tenants/tenants.module.ts` (importar `GarzonesModule`)

**Interfaces:**
- Consumes: `Garzon` entity con `esPlaceholder` (Task 1).
- Produces: `GarzonesService.asegurarMostrador(manager: EntityManager, tenantId: string): Promise<Garzon>` — resuelve el placeholder del tenant; si no existe, lo crea (idempotente). Lo consume Task 3.

- [ ] **Step 1: Escribir el test unitario (mocked manager)**

Crear `backend/src/modules/garzones/garzones.service.spec.ts`:

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { GarzonesService } from './garzones.service';
import { Garzon } from './entities/garzon.entity';
import { SesionGarzon } from '../turnos/entities/sesion-garzon.entity';
import { TipoGarzon } from './enums/tipo-garzon.enum';

describe('GarzonesService.asegurarMostrador', () => {
  let service: GarzonesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GarzonesService,
        { provide: getRepositoryToken(Garzon), useValue: {} },
        { provide: getRepositoryToken(SesionGarzon), useValue: {} },
      ],
    }).compile();
    service = module.get(GarzonesService);
  });

  function mockManager(existente: Partial<Garzon> | null) {
    return {
      findOne: jest.fn().mockResolvedValue(existente),
      create: jest
        .fn()
        .mockImplementation((_e: unknown, data: Record<string, unknown>) => ({
          ...data,
        })),
      save: jest
        .fn()
        .mockImplementation((_e: unknown, data: Record<string, unknown>) =>
          Promise.resolve({ id: 'mostrador-nuevo', ...data }),
        ),
    };
  }

  it('devuelve el placeholder existente sin crear otro', async () => {
    const manager = mockManager({ id: 'mostrador-1', esPlaceholder: true });
    const res = await service.asegurarMostrador(
      manager as unknown as EntityManager,
      't1',
    );
    expect(res.id).toBe('mostrador-1');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('crea el placeholder con atribución neutra si no existe', async () => {
    const manager = mockManager(null);
    const res = await service.asegurarMostrador(
      manager as unknown as EntityManager,
      't1',
    );
    expect(res.id).toBe('mostrador-nuevo');
    expect(manager.create).toHaveBeenCalledWith(
      Garzon,
      expect.objectContaining({
        tenantId: 't1',
        nombre: 'Mostrador',
        activo: false,
        esPlaceholder: true,
        pinHash: '!',
        tipo: TipoGarzon.GARZON,
      }),
    );
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npx jest src/modules/garzones/garzones.service.spec.ts`
Expected: FAIL — `service.asegurarMostrador is not a function`.

- [ ] **Step 3: Implementar `asegurarMostrador`**

En `backend/src/modules/garzones/garzones.service.ts`, ajustar los imports de typeorm y agregar el método. Cambiar la línea de import de typeorm:

```typescript
import { IsNull, Repository, type EntityManager } from 'typeorm';
```

Agregar el método dentro de la clase (por ejemplo tras `obtenerActivoPorId`, línea 155):

```typescript
  /**
   * Resuelve el garzón placeholder "Mostrador" del tenant — receptor neutro de
   * la propina del POS. Idempotente: si no existe lo crea con `activo=false`,
   * `esPlaceholder=true` y un `pin_hash` inutilizable, para que nunca opere ni
   * se identifique por PIN. Se ejecuta dentro del `manager` de la transacción
   * de la venta. Ver docs/features/pagos.md.
   */
  async asegurarMostrador(
    manager: EntityManager,
    tenantId: string,
  ): Promise<Garzon> {
    const existente = await manager.findOne(Garzon, {
      where: { tenantId, esPlaceholder: true, eliminadoEl: IsNull() },
    });
    if (existente) return existente;
    return manager.save(
      Garzon,
      manager.create(Garzon, {
        tenantId,
        nombre: 'Mostrador',
        pinHash: '!',
        activo: false,
        tipo: TipoGarzon.GARZON,
        esPlaceholder: true,
      }),
    );
  }
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd backend && npx jest src/modules/garzones/garzones.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Inyectar `GarzonesService` en `TenantsService`**

En `backend/src/modules/tenants/tenants.service.ts`:

Agregar el import (junto a los demás imports de arriba del archivo):

```typescript
import { GarzonesService } from '../garzones/garzones.service';
```

Agregar el parámetro al constructor (tras `@InjectDataSource() ... dataSource`):

```typescript
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly garzonesService: GarzonesService,
  ) {}
```

- [ ] **Step 6: Crear el placeholder al dar de alta un tenant**

En `tenants.service.ts`, dentro de `create`, justo después de guardar la caja virtual (línea 120, `await manager.save(Caja, caja);`), agregar:

```typescript
      await manager.save(Caja, caja);

      // 6a. Garzón placeholder "Mostrador" (receptor neutro de propina del POS)
      await this.garzonesService.asegurarMostrador(manager, savedTenant.id);
```

- [ ] **Step 7: Importar `GarzonesModule` en `TenantsModule`**

En `backend/src/modules/tenants/tenants.module.ts`, agregar el import del módulo y sumarlo al array `imports`:

```typescript
import { GarzonesModule } from '../garzones/garzones.module';
```

```typescript
  imports: [
    // ...los imports existentes...
    GarzonesModule,
  ],
```

- [ ] **Step 8: Verificar compilación, tests y arranque (sin dependencias circulares)**

Run: `cd backend && npm run typecheck && npx jest src/modules/garzones src/modules/tenants`
Expected: PASS.

Run: `cd backend && npm run start:dev` (o `docker-compose up backend`), esperar "Seed complete." y confirmar que Nest arranca sin error de dependencia circular.
Expected: arranca OK.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/garzones/garzones.service.ts \
        backend/src/modules/garzones/garzones.service.spec.ts \
        backend/src/modules/tenants/tenants.service.ts \
        backend/src/modules/tenants/tenants.module.ts
git commit -m "feat(propinas): asegurarMostrador idempotente + alta del placeholder al crear tenant"
```

---

### Task 3: DTO `propinaDirecta`, wiring en `ventas.service` y e2e del POS

**Files:**
- Create: `backend/src/modules/ventas/dto/propina-directa.dto.ts`
- Modify: `backend/src/modules/ventas/dto/create-venta.dto.ts:16` (import) y `:159-161` (nuevo campo)
- Modify: `backend/src/modules/ventas/ventas.service.ts:79-81` (inyectar `GarzonesService`), `:472-512` (paso 7g/7h)
- Modify: `backend/src/modules/ventas/ventas.module.ts` (importar `GarzonesModule`)
- Test: `backend/test/ventas.e2e-spec.ts` (nuevo describe)

**Interfaces:**
- Consumes: `GarzonesService.asegurarMostrador` (Task 2); `VentaPropinaService.crearEnTransaccion` (existente).
- Produces: `CreateVentaDto.propinaDirecta?: PropinaDirectaDto` con `{ montoPagado: string; montoSugerido?: string; porcentajeSugerido?: string }`. Excluyente con `propinaCierreMesa`.

- [ ] **Step 1: Escribir el test e2e (falla primero)**

En `backend/test/ventas.e2e-spec.ts`, agregar un nuevo `describe` dentro del `describe('Ventas (e2e)', ...)`. Usa los helpers ya presentes en el archivo (`app`, `token`, `ds`, `ITEM_ID`, `EFECTIVO_ID`). `ITEM_ID` es el Smartphone (precio bruto alto); el pago cubre venta + propina.

```typescript
  describe('POST /ventas con propina directa (POS)', () => {
    const MOSTRADOR_ID = '550e8400-e29b-41d4-a716-446655440281';

    it('crea venta_propina en el Mostrador con atribución neutra', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          propinaDirecta: { montoPagado: '5000', porcentajeSugerido: '0.10' },
        })
        .expect(201);

      const ventaId = (res.body as { id: string }).id;
      const rows: Array<{
        garzon_id: string;
        monto_pagado: string;
        tipo_garzon: string | null;
        sesion_garzon_id: string | null;
        turno_id: string | null;
        estado: string;
      }> = await ds.query(
        `SELECT garzon_id, monto_pagado, tipo_garzon, sesion_garzon_id, turno_id, estado
           FROM venta_propina WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].garzon_id).toBe(MOSTRADOR_ID);
      expect(rows[0].tipo_garzon).toBeNull();
      expect(rows[0].sesion_garzon_id).toBeNull();
      expect(rows[0].turno_id).toBeNull();
      expect(Number(rows[0].monto_pagado)).toBe(5000);
      expect(rows[0].estado).toBe('pagada');
    });

    it('el Mostrador no aparece en GET /garzones', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/garzones')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const ids = (res.body as Array<{ id: string }>).map((g) => g.id);
      expect(ids).not.toContain(MOSTRADOR_ID);
    });

    it('rechaza combinar propinaDirecta con propinaCierreMesa', async () => {
      await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          propinaDirecta: { montoPagado: '5000' },
          propinaCierreMesa: {
            montoPagado: '5000',
            garzonId: '550e8400-e29b-41d4-a716-446655440238',
          },
        })
        .expect(400);
    });
  });
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npm run test:e2e -- ventas`
Expected: FAIL — el primer test falla porque `propinaDirecta` se ignora (no se crea `venta_propina`).

- [ ] **Step 3: Crear el DTO `PropinaDirectaDto`**

Crear `backend/src/modules/ventas/dto/propina-directa.dto.ts`:

```typescript
import { IsNumberString, IsOptional } from 'class-validator';

/**
 * Propina cargada desde el POS (venta directa). No lleva garzón: el service la
 * atribuye al placeholder "Mostrador" del tenant con atribución neutra. Ver
 * docs/features/pagos.md.
 */
export class PropinaDirectaDto {
  @IsNumberString()
  montoPagado: string;

  @IsOptional()
  @IsNumberString()
  montoSugerido?: string;

  @IsOptional()
  @IsNumberString()
  porcentajeSugerido?: string;
}
```

- [ ] **Step 4: Agregar el campo a `CreateVentaDto`**

En `backend/src/modules/ventas/dto/create-venta.dto.ts`, agregar el import (junto al de `PropinaCierreMesaDto`, línea 16):

```typescript
import { PropinaDirectaDto } from './propina-directa.dto';
```

Y el campo, justo después de `propinaCierreMesa` (línea 161):

```typescript
  @IsOptional()
  @ValidateNested()
  @Type(() => PropinaCierreMesaDto)
  propinaCierreMesa?: PropinaCierreMesaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PropinaDirectaDto)
  propinaDirecta?: PropinaDirectaDto;
```

- [ ] **Step 5: Inyectar `GarzonesService` en `VentasService` e importar el módulo**

En `backend/src/modules/ventas/ventas.service.ts`, agregar el import:

```typescript
import { GarzonesService } from '../garzones/garzones.service';
```

Agregar el parámetro al constructor (tras `private readonly catalogService: CatalogService,`, línea 80):

```typescript
    private readonly catalogService: CatalogService,
    private readonly garzonesService: GarzonesService,
  ) {}
```

En `backend/src/modules/ventas/ventas.module.ts`, agregar:

```typescript
import { GarzonesModule } from '../garzones/garzones.module';
```

```typescript
  imports: [
    // ...los imports existentes...
    GarzonesModule,
  ],
```

- [ ] **Step 6: Generalizar el paso 7g/7h para aceptar propina directa**

En `ventas.service.ts`, reemplazar el bloque del paso 7g completo (líneas 472-493, desde el comentario `// 7g. Propina de cierre de mesa ...` hasta el cierre del `if (dto.propinaCierreMesa) { ... }`) por:

```typescript
    // 7g. Propina (cierre de mesa o directa del POS) — antes de pagos, para referencia_id
    if (dto.propinaCierreMesa && dto.propinaDirecta) {
      throw new BadRequestException(
        'No se puede combinar propina de cierre de mesa con propina directa',
      );
    }
    let ventaPropinaId: string | null = null;
    let propinaMonto = '0';
    let estrategiaPropina = EstrategiaAsignacionPropina.NO_VUELTO;
    if (dto.propinaCierreMesa) {
      const tip = dto.propinaCierreMesa;
      propinaMonto = tip.montoPagado;
      estrategiaPropina =
        tip.estrategia ?? EstrategiaAsignacionPropina.NO_VUELTO;
      const ventaPropina = await this.ventaPropinaService.crearEnTransaccion(
        manager,
        {
          tenantId,
          ventaId: venta.id,
          garzonId: tip.garzonId,
          porcentajeSugerido: tip.porcentajeSugerido ?? '0.10',
          montoSugerido: tip.montoSugerido ?? tip.montoPagado,
          montoPagado: tip.montoPagado,
          sesionGarzonId: tip.sesionGarzonId ?? null,
          turnoId: tip.turnoId ?? null,
          tipoGarzon: tip.tipoGarzon ?? null,
        },
      );
      ventaPropinaId = ventaPropina.id;
    } else if (dto.propinaDirecta) {
      const tip = dto.propinaDirecta;
      propinaMonto = tip.montoPagado;
      const mostrador = await this.garzonesService.asegurarMostrador(
        manager,
        tenantId,
      );
      const ventaPropina = await this.ventaPropinaService.crearEnTransaccion(
        manager,
        {
          tenantId,
          ventaId: venta.id,
          garzonId: mostrador.id,
          porcentajeSugerido: tip.porcentajeSugerido ?? '0.10',
          montoSugerido: tip.montoSugerido ?? tip.montoPagado,
          montoPagado: tip.montoPagado,
          sesionGarzonId: null,
          turnoId: null,
          tipoGarzon: null,
        },
      );
      ventaPropinaId = ventaPropina.id;
    }
```

Luego, en el paso 7h (la llamada a `this.pagosService.registrar`, línea ~509-511), cambiar la `estrategia` para usar la variable local en vez de leer solo `propinaCierreMesa`:

```typescript
      propinaMonto,
      ventaPropinaId,
      estrategia: estrategiaPropina,
    });
```

- [ ] **Step 7: Correr el test e2e para verificar que pasa**

Run: `cd backend && npm run test:e2e -- ventas`
Expected: PASS — los 3 tests nuevos pasan y no se rompe ninguno existente.

- [ ] **Step 8: Verificar typecheck y lint**

Run: `cd backend && npm run lint:check && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/ventas/dto/propina-directa.dto.ts \
        backend/src/modules/ventas/dto/create-venta.dto.ts \
        backend/src/modules/ventas/ventas.service.ts \
        backend/src/modules/ventas/ventas.module.ts \
        backend/test/ventas.e2e-spec.ts
git commit -m "feat(propinas): propinaDirecta en POS — venta_propina al Mostrador (atribución neutra)"
```

---

### Task 4: Ruta del porcentaje sugerido para el POS (permiso `Ventas:Crear`)

**Files:**
- Modify: `backend/src/modules/propinas/propina-distribucion.controller.ts:26-31`
- Test: `backend/test/ventas.e2e-spec.ts` (nuevo describe)

**Interfaces:**
- Produces: `GET /propinas/porcentaje-sugerido-venta` protegida con `@RequiresPermiso('Ventas', 'Crear')`, respuesta `{ porcentajeSugerido: string }`. La ruta de salones (`Salones:Operar`) queda intacta.

- [ ] **Step 1: Escribir el test e2e (falla primero)**

En `backend/test/ventas.e2e-spec.ts`, agregar dentro de `describe('Ventas (e2e)', ...)`:

```typescript
  describe('GET /propinas/porcentaje-sugerido-venta', () => {
    it('devuelve el porcentaje sugerido del tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/propinas/porcentaje-sugerido-venta')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(typeof (res.body as { porcentajeSugerido: string }).porcentajeSugerido).toBe('string');
    });

    it('retorna 401 sin token', async () => {
      await request(app.getHttpServer())
        .get('/api/propinas/porcentaje-sugerido-venta')
        .expect(401);
    });
  });
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npm run test:e2e -- ventas`
Expected: FAIL — el primer test devuelve 404 (ruta inexistente).

- [ ] **Step 3: Agregar la ruta al controller**

En `backend/src/modules/propinas/propina-distribucion.controller.ts`, agregar tras el método `porcentajeSugerido` (línea 31):

```typescript
  @Get('porcentaje-sugerido')
  @RequiresPermiso('Salones', 'Operar')
  porcentajeSugerido(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.distribucion.obtenerPorcentajeSugerido(user.tenantId!);
  }

  // Mismo dato que /porcentaje-sugerido, pero para el POS: el rol Vendedor no
  // tiene Salones:Operar. Ver docs/features/pagos.md.
  @Get('porcentaje-sugerido-venta')
  @RequiresPermiso('Ventas', 'Crear')
  porcentajeSugeridoVenta(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.distribucion.obtenerPorcentajeSugerido(user.tenantId!);
  }
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd backend && npm run test:e2e -- ventas`
Expected: PASS.

- [ ] **Step 5: Verificar typecheck**

Run: `cd backend && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/propinas/propina-distribucion.controller.ts \
        backend/test/ventas.e2e-spec.ts
git commit -m "feat(propinas): ruta porcentaje-sugerido-venta para el POS (Ventas:Crear)"
```

---

### Task 5: Frontend — propina en el POS (`pos.vue` + composable)

**Files:**
- Modify: `frontend/app/composables/usePropina.ts:28-48`
- Modify: `frontend/app/pages/ventas/pos.vue` (script + template del `CobroModal`)
- (Sin cambios en `CobroModal.vue`: ya soporta `modoPropina`, `ventaTotal`, `porcentajeSugerido`, `v-model:propinaMonto`.)

**Interfaces:**
- Consumes: `GET /propinas/porcentaje-sugerido-venta` (Task 4); `POST /ventas` con `propinaDirecta` (Task 3).
- Produces: `fetchPorcentajeSugeridoVenta(): Promise<string>` en `usePropina`.

- [ ] **Step 1: Agregar el fetch de la ruta del POS al composable**

En `frontend/app/composables/usePropina.ts`, agregar tras `fetchPorcentajeSugerido` (línea 39):

```typescript
export async function fetchPorcentajeSugeridoVenta(): Promise<string> {
  const apiUrl = useRuntimeConfig().public.apiUrl
  try {
    const res = await useApiFetch<{ porcentajeSugerido: string }>(
      `${apiUrl}/propinas/porcentaje-sugerido-venta`,
    )
    return res.porcentajeSugerido || PROPINA_PORCENTAJE_DEFAULT
  }
  catch {
    return PROPINA_PORCENTAJE_DEFAULT
  }
}
```

Y sumarla al objeto que devuelve `usePropina` (línea 42):

```typescript
export function usePropina() {
  return {
    sugerirPropina,
    fetchPorcentajeSugerido,
    fetchPorcentajeSugeridoVenta,
    porcentajeHumanoADecimal,
    porcentajeDecimalAHumano,
  }
}
```

- [ ] **Step 2: Importar el helper y declarar estado de propina en `pos.vue`**

En `frontend/app/pages/ventas/pos.vue`, agregar el import tras los imports existentes (línea 8):

```typescript
import { fetchPorcentajeSugeridoVenta, PROPINA_PORCENTAJE_DEFAULT } from '~/composables/usePropina'
```

Agregar los refs junto a los otros del script (por ejemplo tras `const submitting = ref(false)`, línea 46):

```typescript
const propinaMonto = ref('0')
const propinaPorcentaje = ref(PROPINA_PORCENTAJE_DEFAULT)
```

- [ ] **Step 3: Cargar el porcentaje sugerido al montar**

En `pos.vue`, en el `onMounted` (línea 153-155), agregar la carga del porcentaje al `Promise.all`:

```typescript
onMounted(async () => {
  await Promise.all([cajaStore.cargarActiva(), cargar(), unidadesStore.ensureLoaded(), cargarEmisor()])
  propinaPorcentaje.value = await fetchPorcentajeSugeridoVenta()
})
```

- [ ] **Step 4: Enviar `propinaDirecta` en el cobro**

En `pos.vue`, dentro de `confirmarCobro`, tras armar `body` con `tipoDocumentoId` y antes del bloque `if (incluirCustomer)` (línea 191), agregar:

```typescript
    const body: Record<string, unknown> = {
      lineas: toVentaLineasBody(lineas.value),
      pagos,
      tipoDocumentoId: tipoDocumentoId.value,
    }
    if (new Decimal(propinaMonto.value || '0').gt(0)) {
      body.propinaDirecta = {
        montoPagado: propinaMonto.value,
        porcentajeSugerido: propinaPorcentaje.value,
      }
    }
```

(`Decimal` ya está importado en `pos.vue`, línea 2.)

Tras una venta exitosa, resetear la propina. En el bloque de éxito, después de `cobroOpen.value = false` (línea 213), agregar:

```typescript
    cobroOpen.value = false
    propinaMonto.value = '0'
```

- [ ] **Step 5: Activar `modoPropina` en el `CobroModal`**

En `pos.vue`, en el template del `VentasCobroModal` (líneas 330-336), reemplazar por:

```vue
      <VentasCobroModal
        v-model:open="cobroOpen"
        v-model:propina-monto="propinaMonto"
        modo-propina
        :total="totalFinal"
        :venta-total="totalFinal"
        :porcentaje-sugerido="propinaPorcentaje"
        :metodos="metodos"
        :submitting="submitting"
        @confirmar="confirmarCobro"
      />
```

- [ ] **Step 6: Verificar build, typecheck y design**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: PASS.

- [ ] **Step 7: Smoke test en navegador (obligatorio para features del POS)**

Con `docker-compose up` corriendo, en el POS (`/ventas/pos`): agregar un ítem, abrir "Cobrar", verificar que aparece el desglose "Total venta / Propina / Total a pagar" con la propina prellenada al % sugerido, confirmar la venta y verificar el toast de éxito. Confirmar en el detalle de la venta (drawer) que la propina quedó registrada.
Expected: la venta se cierra con total + propina; sin errores de consola (auto-import Nuxt).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/composables/usePropina.ts frontend/app/pages/ventas/pos.vue
git commit -m "feat(propinas): cobro de propina en el POS (CobroModal modoPropina + propinaDirecta)"
```

---

### Task 6: Documentación viva

**Files:**
- Modify: `docs/features/pagos.md` (comportamiento de propina en POS + edge del turno)
- Modify: `docs/ESTADO.md` (nueva fila)

**Interfaces:** ninguna (solo docs).

- [ ] **Step 1: Documentar la propina de POS en el doc de pagos/propinas**

En `docs/features/pagos.md`, agregar una sección "Propina en el POS" que explique (corto, el porqué, no el código):
- La propina de POS se persiste como `venta_propina` atribuida al garzón placeholder **"Mostrador"** del tenant, con `tipoGarzon/sesionGarzonId/turnoId = null`.
- **Por qué reparte bien**: el pool (`buscarTipsElegibles`) no filtra por `tipo_garzon`, así que el monto suma al pool; con `tipo_garzon = null` el placeholder no matchea ningún grupo en `garzonesGrupo`, por lo que **nunca recibe**. La plata se reparte por la config vigente entre los participantes reales.
- **Edge del turno**: la propina de POS no tiene turno (`turno_id = null`); se liquida en la liquidación de **período completo** (sin filtro de turno). Operativamente: para liquidar las de POS, correr una liquidación del período sin filtrar turno.
- El placeholder tiene `activo=false`, `pin_hash` inutilizable y `es_placeholder=true`; se oculta del listado de garzones y no se identifica por PIN.
- Ruta del porcentaje sugerido para el POS: `GET /propinas/porcentaje-sugerido-venta` (`Ventas:Crear`).

- [ ] **Step 2: Agregar la fila en `docs/ESTADO.md`**

En `docs/ESTADO.md`, en la zona de propinas (tras la línea 65), agregar:

```markdown
| Propina en el POS (venta directa `fisico`) — `propinaDirecta` → `venta_propina` en garzón placeholder "Mostrador" (atribución neutra, reparte por config del tenant) | ✅ Implementado (2026-07-22) |
```

- [ ] **Step 3: Verificar enlaces de docs**

Run: `cd frontend && npm run build` no aplica; para docs, verificar que el pre-commit no reporte enlaces internos rotos (`.githooks/pre-commit` corre sobre lo staged).

- [ ] **Step 4: Commit**

```bash
git add docs/features/pagos.md docs/ESTADO.md
git commit -m "docs(propinas): comportamiento de propina en POS + edge del turno + estado"
```

---

## Checklist de cierre (antes del último commit)

Ejecutar, no afirmar:

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

- [ ] Sin N+1 nuevo (la resolución del placeholder es una sola query por venta).
- [ ] Toda lectura nueva filtra `eliminado_el IS NULL` (`asegurarMostrador` lo hace).
- [ ] `tenant_id` siempre del token en las rutas nuevas.
- [ ] Motor de precios y de liquidación intactos.
- [ ] Docs actualizadas (Task 6).
- [ ] Smoke test del POS en navegador OK (Task 5, Step 7).
