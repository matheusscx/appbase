# Arqueo de caja multi-medio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El cierre de caja pasa de "un número" a **una línea esperado-vs-contado por método de pago**, eliminando el faltante fantasma que hoy genera vender con tarjeta.

**Architecture:** El desglose ya está soportado a nivel de datos (`movimientos_caja.metodo_pago_id` se puebla por fila). El trabajo es: (1) marcar qué métodos son efectivo (`es_efectivo` global) y cuáles exigen conteo (`requiere_conteo` por tenant); (2) partir el cálculo mezclado `calcularSaldoEsperado` en `calcularEsperadoEfectivo` (línea de efectivo) + `calcularArqueo` (todas las líneas); (3) congelar el detalle del cierre en una tabla nueva `caja_arqueo_medio`; (4) exponer `GET /caja/:id/arqueo` (preview recomputado si abierta, líneas congeladas si cerrada); (5) reworkear el drawer de cierre y el detalle read-only. Los campos agregados de `cajas` pasan a representar la **línea de efectivo** (backward-compat del historial).

**Tech Stack:** NestJS + TypeORM (SQL raw parametrizado, `synchronize` en dev/CI), Decimal.js, PostgreSQL 15; frontend Nuxt 4 (Vue 3) + Pinia + Nuxt UI; tests Jest (unit + supertest e2e) y Vitest (store frontend).

**Spec:** `docs/superpowers/specs/2026-07-24-arqueo-multimedio-design.md`

## Global Constraints

Copiadas verbatim del spec y de CLAUDE.md. Aplican a **toda** tarea:

- **Dinero con Decimal.js**, nunca `number` nativo. Todo esperado/contado/diferencia es Decimal y se persiste/serializa con `.toFixed(4)` (convención `NUMERIC(18,4)` del módulo caja).
- **`tenant_id`/`usuario_id` salen SIEMPRE del token** (`req.user`), nunca del body/query/ruta.
- **Soft delete en todo.** Nunca `DELETE`. Toda `SELECT`/`JOIN` nueva sobre tablas del dominio filtra `eliminado_el IS NULL`. **Excepción documentada** (Task 2): el `LEFT JOIN metodos_pago` para leer `es_efectivo` NO filtra `mp.eliminado_el` — `es_efectivo` es un atributo **intrínseco** del método del movimiento histórico; filtrarlo excluiría movimientos cuyo método se borró después y corrompería el arqueo. Se usa `COALESCE(mp.es_efectivo, false)` y se documenta en un comentario.
- **El cierre es owner-only** (`@RequiresPermiso('MiCaja', 'Actualizar')`) — no cambia. El cierre forzado por el encargado sigue diferido.
- **Congelar el hecho transaccional:** el esperado por línea se **recomputa server-side y se congela** al cerrar en `caja_arqueo_medio`; nunca viene del cliente.
- **PK/FK UUID con `type: 'uuid'` explícito** (ADR-004, enforced por `src/common/invariants/uuid-columns.invariant.spec.ts`).
- **La caja virtual no se ve afectada** (canal online no arquea multi-medio manual).
- **Sin dependencias nuevas.** El stack actual resuelve todo.

**Regla de obligatoriedad (central):** `obligatorio = es_efectivo OR requiere_conteo`. La línea de efectivo siempre existe y siempre es obligatoria; su `metodo_pago_id` es `NULL` (agregada). Cada método no-efectivo con movimientos genera una línea; es obligatoria solo si `requiere_conteo`. Línea obligatoria sin contado → **400**. Línea opcional sin contado → **informativa** (`contado NULL`, `diferencia NULL`).

**Fórmulas:**
```
Efectivo (metodo_pago_id NULL) = saldo_inicial
                               + Σ entradas de métodos es_efectivo
                               + Σ entradas manuales (metodo_pago_id NULL)
                               − Σ salidas            (todas las salidas son efectivo)
Cada no-efectivo (por metodo_pago_id) = Σ sus movimientos entrada
```
Los vueltos ya están netos en el movimiento (`pagos.service.ts:244` inserta `monto = pago − vuelto`): la línea de efectivo **no** resta vueltos por separado.

---

### Task 1: Modelo de datos + seed

Agrega las dos columnas y la tabla nueva. `synchronize` crea el esquema al bootstrap (dev/CI). La invariante ADR-004 (test existente, auto-descubre entities) es el gate real: la entidad nueva debe declarar `type: 'uuid'` en sus PK/FK o el test falla.

**Files:**
- Modify: `backend/src/modules/metodos-pago/entities/metodo-pago.entity.ts`
- Modify: `backend/src/modules/metodos-pago/entities/tenant-metodo-pago.entity.ts`
- Create: `backend/src/modules/caja/entities/caja-arqueo-medio.entity.ts`
- Modify: `backend/src/modules/caja/caja.module.ts`
- Modify: `backend/src/modules/seeder/seeder.service.ts:1709-1745` (`seedMetodosPago`) y `:1877-1905` (`seedTenantMetodosPago`)
- Test: `backend/src/common/invariants/uuid-columns.invariant.spec.ts` (existente, no se edita — se corre)

**Interfaces:**
- Produces: entidad `CajaArqueoMedio` con propiedades `arqueoMedioId, cajaId, tenantId, metodoPagoId, esEfectivo, esperado, contado, diferencia, creadoEl, eliminadoEl`; columnas `metodos_pago.es_efectivo` (bool) y `tenant_metodo_pago.requiere_conteo` (bool). Consumidas por Tasks 2, 4, 5.

- [ ] **Step 1: Agregar `es_efectivo` a `MetodoPago`**

En `metodo-pago.entity.ts`, tras la columna `activo` (línea 22):

```ts
  @Column({ default: true })
  activo: boolean;

  // Intrínseco al método (catálogo global): define qué entra a la línea de
  // efectivo del arqueo (fondo + manuales + vueltos). No confundir con
  // requiere_conteo (política por tenant). Ver spec arqueo-multimedio.
  @Column({ name: 'es_efectivo', default: false })
  esEfectivo: boolean;
```

- [ ] **Step 2: Agregar `requiere_conteo` a `TenantMetodoPago`**

En `tenant-metodo-pago.entity.ts`, tras `habilitada` (línea 23):

```ts
  @Column({ default: false })
  habilitada: boolean;

  // Política operativa por tenant: fuerza el conteo obligatorio de un método
  // no-efectivo al cerrar. obligatorio = es_efectivo OR requiere_conteo.
  @Column({ name: 'requiere_conteo', default: false })
  requiereConteo: boolean;
```

- [ ] **Step 3: Crear la entidad `CajaArqueoMedio`**

Crear `backend/src/modules/caja/entities/caja-arqueo-medio.entity.ts`:

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

// Detalle del cierre por método de pago, CONGELADO al cerrar (nunca se recomputa).
// Una fila por línea del arqueo. metodo_pago_id NULL = la línea de efectivo agregada.
@Entity('caja_arqueo_medio')
@Index('ux_caja_arqueo_medio', ['cajaId', 'metodoPagoId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class CajaArqueoMedio {
  @PrimaryGeneratedColumn('uuid', { name: 'arqueo_medio_id' })
  arqueoMedioId: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // NULL = línea de efectivo agregada (fondo + es_efectivo + manuales − salidas).
  @Column({ name: 'metodo_pago_id', type: 'uuid', nullable: true })
  metodoPagoId: string | null;

  @Column({ name: 'es_efectivo' })
  esEfectivo: boolean;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  esperado: string;

  // NULL = línea informativa (no se contó).
  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true })
  contado: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true })
  diferencia: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 4: Registrar la entidad en el módulo**

En `caja.module.ts`:

```ts
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import { CajaArqueoMedio } from './entities/caja-arqueo-medio.entity';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';

@Module({
  imports: [TypeOrmModule.forFeature([Caja, MovimientoCaja, CajaArqueoMedio])],
  controllers: [CajaController],
  providers: [CajaService],
  exports: [CajaService],
})
export class CajaModule {}
```

- [ ] **Step 5: Seed — `Efectivo` con `es_efectivo = true`**

En `seeder.service.ts`, dentro de `seedMetodosPago` (el array `metodos`, línea ~1710), agregar `esEfectivo` solo al Efectivo:

```ts
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440105',
        nombre: 'Efectivo',
        abreviatura: 'EFE',
        activo: true,
        esEfectivo: true,
      },
```

Los otros tres métodos quedan sin `esEfectivo` (default `false`). ⚠️ **Ojo con el idempotente:** el seed hace `if (!exists) save(...)`. En una BD ya sembrada (dev con volumen viejo), `Efectivo` ya existe → **no** se re-guarda y `es_efectivo` queda en el default `false`. Como `synchronize` agrega la columna con default `false`, en un entorno con datos viejos hay que forzar el flag. Agregar tras el loop de `seedMetodosPago`:

```ts
    // Backfill idempotente del flag es_efectivo (los métodos ya existentes no se
    // re-guardan por el if(!exists) de arriba; synchronize los crea con default false).
    await this.metodoPagoRepo.update(
      { metodoPagoId: '550e8400-e29b-41d4-a716-446655440105' },
      { esEfectivo: true },
    );
```

`seedTenantMetodosPago` no se toca: `requiere_conteo` default `false` es el estado inicial correcto (el admin lo activa por método desde su config; el efectivo no lo necesita).

- [ ] **Step 6: Correr la invariante ADR-004 + typecheck**

Run: `cd backend && npm test -- uuid-columns.invariant && npm run typecheck`
Expected: PASS. La entidad `CajaArqueoMedio` aporta `arqueoMedioId`/`cajaId`/`tenantId`/`metodoPagoId` y todas declaran `type: 'uuid'` → sin offenders. Typecheck limpio.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/metodos-pago/entities backend/src/modules/caja/entities/caja-arqueo-medio.entity.ts backend/src/modules/caja/caja.module.ts backend/src/modules/seeder/seeder.service.ts
git commit -m "feat(caja): modelo de datos del arqueo multi-medio (es_efectivo, requiere_conteo, caja_arqueo_medio)"
```

---

### Task 2: Cálculo del esperado por método (`calcularEsperadoEfectivo` + `calcularArqueo`)

Parte el cálculo mezclado en dos funciones. `calcularSaldoEsperado` (la vieja) se **conserva** en esta tarea (todavía la usan cerrar/salida/NC); se elimina en Task 4 cuando ya no quede consumidor.

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (agregar interface `LineaArqueo` + dos métodos, tras `calcularSaldoEsperado` línea 275)
- Test: `backend/src/modules/caja/caja.service.spec.ts`

**Interfaces:**
- Consumes: columnas `metodos_pago.es_efectivo`, `tenant_metodo_pago.requiere_conteo` (Task 1).
- Produces:
  - `interface LineaArqueo { metodoPagoId: string | null; nombre: string; esEfectivo: boolean; esperado: string; requiereConteo: boolean; contado?: string | null; diferencia?: string | null }`
  - `calcularEsperadoEfectivo(cajaId: string, manager: EntityManager): Promise<string>`
  - `calcularArqueo(cajaId: string, tenantId: string, manager: EntityManager): Promise<LineaArqueo[]>`
  Consumidas por Tasks 3, 4, 5.

- [ ] **Step 1: Escribir los tests que fallan**

En `caja.service.spec.ts`, agregar un bloque `describe` nuevo (después del `describe('cerrar', ...)`). Usa el `managerMock.query` ya existente en el `beforeEach`:

```ts
  describe('calcularEsperadoEfectivo', () => {
    it('suma fondo + entradas efectivo + manuales − salidas (sin no-efectivo)', async () => {
      managerMock.query.mockResolvedValueOnce([
        { saldo_inicial: '1000', entradas_efectivo: '500', salidas: '200' },
      ]);
      const r = await service.calcularEsperadoEfectivo(CAJA_ID, managerMock as never);
      expect(r).toBe('1300.0000'); // 1000 + 500 − 200
    });

    it('devuelve el fondo cuando no hay movimientos', async () => {
      managerMock.query.mockResolvedValueOnce([
        { saldo_inicial: '1000', entradas_efectivo: null, salidas: null },
      ]);
      const r = await service.calcularEsperadoEfectivo(CAJA_ID, managerMock as never);
      expect(r).toBe('1000.0000');
    });
  });

  describe('calcularArqueo', () => {
    it('agrega la línea de efectivo + una línea por cada no-efectivo con movimientos', async () => {
      // 1ª query: esperado efectivo (reusa calcularEsperadoEfectivo)
      managerMock.query.mockResolvedValueOnce([
        { saldo_inicial: '1000', entradas_efectivo: '500', salidas: '0' },
      ]);
      // 2ª query: líneas no-efectivo
      managerMock.query.mockResolvedValueOnce([
        {
          metodo_pago_id: 'dddddddd-0000-0000-0000-000000000004',
          nombre: 'Tarjeta de débito',
          requiere_conteo: false,
          entradas: '800',
        },
      ]);
      const lineas = await service.calcularArqueo(
        CAJA_ID,
        TENANT_ID,
        managerMock as never,
      );
      expect(lineas).toEqual([
        {
          metodoPagoId: null,
          nombre: 'Efectivo',
          esEfectivo: true,
          esperado: '1500.0000',
          requiereConteo: true,
        },
        {
          metodoPagoId: 'dddddddd-0000-0000-0000-000000000004',
          nombre: 'Tarjeta de débito',
          esEfectivo: false,
          esperado: '800.0000',
          requiereConteo: false,
        },
      ]);
    });

    it('devuelve solo la línea de efectivo cuando no hubo ventas no-efectivo', async () => {
      managerMock.query.mockResolvedValueOnce([
        { saldo_inicial: '1000', entradas_efectivo: '0', salidas: '0' },
      ]);
      managerMock.query.mockResolvedValueOnce([]); // sin no-efectivo
      const lineas = await service.calcularArqueo(
        CAJA_ID,
        TENANT_ID,
        managerMock as never,
      );
      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({
        metodoPagoId: null,
        esEfectivo: true,
        requiereConteo: true,
        esperado: '1000.0000',
      });
    });
  });
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd backend && npm test -- caja.service.spec -t "calcularEsperadoEfectivo|calcularArqueo"`
Expected: FAIL (`service.calcularEsperadoEfectivo is not a function`).

- [ ] **Step 3: Implementar la interface + los dos métodos**

En `caja.service.ts`, agregar la interface junto a las otras (tras `CajaHistorialItem`, línea 77):

```ts
export interface LineaArqueo {
  metodoPagoId: string | null;
  nombre: string;
  esEfectivo: boolean;
  esperado: string;
  requiereConteo: boolean;
  contado?: string | null;
  diferencia?: string | null;
}
```

Y los dos métodos, justo después de `calcularSaldoEsperado` (línea 275):

```ts
  /**
   * Línea de efectivo del arqueo: fondo + entradas de métodos es_efectivo +
   * entradas manuales (metodo_pago_id NULL) − todas las salidas. Los vueltos ya
   * están netos en el movimiento (pagos.service inserta monto = pago − vuelto).
   * El LEFT JOIN a metodos_pago NO filtra eliminado_el a propósito: es_efectivo
   * es intrínseco al método del movimiento histórico (ver spec, invariante).
   */
  async calcularEsperadoEfectivo(
    cajaId: string,
    manager: EntityManager,
  ): Promise<string> {
    const rows: {
      saldo_inicial: string;
      entradas_efectivo: string | null;
      salidas: string | null;
    }[] = await manager.query(
      `SELECT c.saldo_inicial,
              SUM(m.monto) FILTER (
                WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL
                  AND (m.metodo_pago_id IS NULL OR COALESCE(mp.es_efectivo, false) = true)
              ) AS entradas_efectivo,
              SUM(m.monto) FILTER (
                WHERE m.tipo = 'salida' AND m.eliminado_el IS NULL
              ) AS salidas
       FROM cajas c
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = m.metodo_pago_id
       WHERE c.caja_id = $1
         AND c.eliminado_el IS NULL
       GROUP BY c.saldo_inicial`,
      [cajaId],
    );

    const row = rows[0];
    const saldoInicial = new Decimal(row?.saldo_inicial ?? '0');
    const entradas = new Decimal(row?.entradas_efectivo ?? '0');
    const salidas = new Decimal(row?.salidas ?? '0');
    return saldoInicial.plus(entradas).minus(salidas).toFixed(4);
  }

  /**
   * Arqueo completo: la línea de efectivo agregada (siempre presente, siempre
   * obligatoria) + una línea por cada método no-efectivo con movimientos. Dos
   * queries fijas, sin N+1. El `esperado` de cada línea es el valor a cuadrar.
   */
  async calcularArqueo(
    cajaId: string,
    tenantId: string,
    manager: EntityManager,
  ): Promise<LineaArqueo[]> {
    const esperadoEfectivo = await this.calcularEsperadoEfectivo(cajaId, manager);

    const noEfectivo: {
      metodo_pago_id: string;
      nombre: string;
      requiere_conteo: boolean;
      entradas: string;
    }[] = await manager.query(
      `SELECT m.metodo_pago_id,
              mp.nombre,
              COALESCE(tmp.requiere_conteo, false) AS requiere_conteo,
              COALESCE(SUM(m.monto), 0) AS entradas
       FROM movimientos_caja m
       JOIN metodos_pago mp ON mp.metodo_pago_id = m.metodo_pago_id
       LEFT JOIN tenant_metodo_pago tmp
              ON tmp.metodo_pago_id = m.metodo_pago_id
             AND tmp.tenant_id = $2
             AND tmp.eliminado_el IS NULL
       WHERE m.caja_id = $1
         AND m.eliminado_el IS NULL
         AND m.tipo = 'entrada'
         AND m.metodo_pago_id IS NOT NULL
         AND COALESCE(mp.es_efectivo, false) = false
       GROUP BY m.metodo_pago_id, mp.nombre, tmp.requiere_conteo
       ORDER BY mp.nombre ASC`,
      [cajaId, tenantId],
    );

    return [
      {
        metodoPagoId: null,
        nombre: 'Efectivo',
        esEfectivo: true,
        esperado: esperadoEfectivo,
        requiereConteo: true,
      },
      ...noEfectivo.map((r) => ({
        metodoPagoId: r.metodo_pago_id,
        nombre: r.nombre,
        esEfectivo: false,
        esperado: new Decimal(r.entradas).toFixed(4),
        requiereConteo: r.requiere_conteo,
      })),
    ];
  }
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd backend && npm test -- caja.service.spec -t "calcularEsperadoEfectivo|calcularArqueo"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.service.spec.ts
git commit -m "feat(caja): calcularEsperadoEfectivo + calcularArqueo (esperado por método)"
```

---

### Task 3: Remapear los consumidores-fix (salida 422 + NC "devolver dinero")

Los dos que hoy validan contra el total mezclado pasan a validar contra la **línea de efectivo**. Es un cambio de comportamiento **más estricto** (un fix): ya no se puede egresar efectivo contra plata pagada con tarjeta.

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts:369` (`registrarMovimiento`, la validación de salida 422)
- Modify: `backend/src/modules/ventas/ventas.service.ts:708-713` (NC "devolver dinero")
- Test: `backend/src/modules/caja/caja.service.spec.ts`

**Interfaces:**
- Consumes: `calcularEsperadoEfectivo` (Task 2).

- [ ] **Step 1: Escribir el test que falla (salida 422 mira solo efectivo)**

En `caja.service.spec.ts`, dentro del `describe('registrarMovimiento', ...)` existente, agregar:

```ts
    it('la salida valida contra la línea de efectivo, no contra el total mezclado', async () => {
      const dtoSalida: CrearMovimientoDto = {
        tipo: 'salida',
        concepto: 'Retiro',
        monto: '600',
      };
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock FOR UPDATE
      managerMock.findOne.mockResolvedValueOnce(mockCajaAbierta);
      // Efectivo real = 500 (aunque haya 800 en tarjeta): sacar 600 debe fallar.
      jest
        .spyOn(service, 'calcularEsperadoEfectivo')
        .mockResolvedValueOnce('500.0000');

      await expect(
        service.registrarMovimiento(TENANT_ID, USUARIO_ID, CAJA_ID, dtoSalida),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `cd backend && npm test -- caja.service.spec -t "valida contra la línea de efectivo"`
Expected: FAIL (hoy usa `calcularSaldoEsperado`; el spy sobre `calcularEsperadoEfectivo` no se invoca → la validación no salta como se espera, o el mock de la query mezclada no está preparado).

- [ ] **Step 3: Remapear la salida 422 en `registrarMovimiento`**

En `caja.service.ts`, dentro de `registrarMovimiento` (líneas 369-376), cambiar la fuente del saldo:

```ts
      const esperadoEfectivo = await this.calcularEsperadoEfectivo(
        cajaId,
        manager,
      );

      if (
        dto.tipo === 'salida' &&
        new Decimal(esperadoEfectivo).minus(dto.monto).lt(0)
      ) {
        throw new UnprocessableEntityException('Saldo insuficiente en caja');
      }
```

- [ ] **Step 4: Remapear la NC "devolver dinero"**

En `ventas.service.ts` (líneas 708-713), cambiar la llamada:

```ts
        const saldoEfectivo = await this.cajaService.calcularEsperadoEfectivo(
          caja.id,
          manager,
        );
        if (new Decimal(saldoEfectivo).minus(params.monto).lt(0))
          throw new UnprocessableEntityException('Saldo insuficiente en caja');
```

- [ ] **Step 5: Correr los tests de caja + typecheck**

Run: `cd backend && npm test -- caja.service.spec && npm run typecheck`
Expected: PASS (incluye el test nuevo y todos los previos de `registrarMovimiento`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.service.spec.ts backend/src/modules/ventas/ventas.service.ts
git commit -m "fix(caja): salida manual y NC 'devolver dinero' validan contra el efectivo real, no el total mezclado"
```

---

### Task 4: `CerrarCajaDto` multi-línea + flujo `cerrar` (congela el arqueo)

El cierre recomputa el arqueo server-side, valida completitud de las líneas obligatorias, congela todas las líneas en `caja_arqueo_medio` y actualiza los agregados de `cajas` con la **línea de efectivo**. Tras esta tarea, `calcularSaldoEsperado` (la vieja) queda sin consumidores → se elimina.

**Files:**
- Modify: `backend/src/modules/caja/dto/cerrar-caja.dto.ts`
- Create: `backend/src/modules/caja/dto/linea-cierre.dto.ts`
- Modify: `backend/src/modules/caja/caja.service.ts` (`cerrar` líneas 277-315; inyectar repo `CajaArqueoMedio`; borrar `calcularSaldoEsperado`)
- Test: `backend/src/modules/caja/caja.service.spec.ts`

**Interfaces:**
- Consumes: `calcularArqueo` (Task 2), entidad `CajaArqueoMedio` (Task 1).
- Produces: `CerrarCajaDto = { lineas: LineaCierreDto[]; comentario?: string }`; `LineaCierreDto = { metodoPagoId: string | null; montoContado: string }`. `cerrar` devuelve `{ caja: Caja; arqueo: LineaArqueo[] }`. Consumido por Task 6 (store) y Task 9 (e2e).

- [ ] **Step 1: Reescribir el DTO**

Crear `backend/src/modules/caja/dto/linea-cierre.dto.ts`:

```ts
import { IsNumberString, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class LineaCierreDto {
  // null = la línea de efectivo agregada.
  @ValidateIf((o) => o.metodoPagoId !== null)
  @IsUUID('4')
  metodoPagoId: string | null;

  // Admite decimales (dinero = Decimal.js). NO usar { no_symbols: true }: rechaza
  // el punto decimal y rompió 6 e2e el 2026-07-23.
  @IsNumberString()
  montoContado: string;
}
```

Reescribir `cerrar-caja.dto.ts`:

```ts
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LineaCierreDto } from './linea-cierre.dto';

export class CerrarCajaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaCierreDto)
  lineas: LineaCierreDto[];

  @IsOptional()
  @IsString()
  comentario?: string;
}
```

- [ ] **Step 2: Escribir los tests que fallan**

En `caja.service.spec.ts`, reemplazar el `describe('cerrar', ...)` existente por uno nuevo (la forma del DTO cambió). El `managerMock` necesita un repo para `CajaArqueoMedio`; agregarlo al módulo de test — en el `Test.createTestingModule` del `beforeEach`, junto a los otros `getRepositoryToken`, agregar:

```ts
        {
          provide: getRepositoryToken(CajaArqueoMedio),
          useValue: { create: jest.fn((x) => x), save: jest.fn() },
        },
```
(y `import { CajaArqueoMedio } from './entities/caja-arqueo-medio.entity';` arriba).

El bloque de cierre:

```ts
  describe('cerrar', () => {
    const arqueoRecomputado: LineaArqueo[] = [
      {
        metodoPagoId: null,
        nombre: 'Efectivo',
        esEfectivo: true,
        esperado: '1000.0000',
        requiereConteo: true,
      },
      {
        metodoPagoId: 'dddddddd-0000-0000-0000-000000000004',
        nombre: 'Tarjeta de débito',
        esEfectivo: false,
        esperado: '800.0000',
        requiereConteo: false,
      },
    ];

    beforeEach(() => {
      managerMock.query.mockResolvedValue([{ caja_id: CAJA_ID }]); // FOR UPDATE
      managerMock.findOne.mockResolvedValue({ ...mockCajaAbierta });
      managerMock.save.mockImplementation((_e: unknown, x: unknown) => x);
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValue(arqueoRecomputado);
    });

    it('congela el arqueo y fija los agregados de cajas = línea de efectivo', async () => {
      const dto: CerrarCajaDto = {
        lineas: [
          { metodoPagoId: null, montoContado: '1000' },
          { metodoPagoId: 'dddddddd-0000-0000-0000-000000000004', montoContado: '800' },
        ],
      };
      const { caja, arqueo } = await service.cerrar(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dto,
      );
      expect(caja.estado).toBe('cerrada');
      expect(caja.saldoFinal).toBe('1000.0000'); // esperado efectivo
      expect(caja.montoContado).toBe('1000'); // contado efectivo
      expect(caja.diferencia).toBe('0.0000');
      const efectivo = arqueo.find((l) => l.metodoPagoId === null);
      const tarjeta = arqueo.find((l) => l.metodoPagoId !== null);
      expect(efectivo?.diferencia).toBe('0.0000');
      expect(tarjeta?.contado).toBe('800.0000');
      expect(tarjeta?.diferencia).toBe('0.0000');
    });

    it('deja la línea opcional omitida como informativa (contado NULL)', async () => {
      const dto: CerrarCajaDto = {
        lineas: [{ metodoPagoId: null, montoContado: '900' }], // solo efectivo
      };
      const { caja, arqueo } = await service.cerrar(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dto,
      );
      expect(caja.diferencia).toBe('-100.0000');
      const tarjeta = arqueo.find((l) => l.metodoPagoId !== null);
      expect(tarjeta?.contado).toBeNull();
      expect(tarjeta?.diferencia).toBeNull();
    });

    it('400 si falta la línea de efectivo (obligatoria)', async () => {
      const dto: CerrarCajaDto = {
        lineas: [
          { metodoPagoId: 'dddddddd-0000-0000-0000-000000000004', montoContado: '800' },
        ],
      };
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si el DTO trae un metodoPagoId ajeno al arqueo', async () => {
      const dto: CerrarCajaDto = {
        lineas: [
          { metodoPagoId: null, montoContado: '1000' },
          { metodoPagoId: 'eeeeeeee-0000-0000-0000-000000000099', montoContado: '50' },
        ],
      };
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si una línea no-efectivo con requiere_conteo llega sin contado', async () => {
      jest.spyOn(service, 'calcularArqueo').mockResolvedValue([
        arqueoRecomputado[0],
        { ...arqueoRecomputado[1], requiereConteo: true },
      ]);
      const dto: CerrarCajaDto = {
        lineas: [{ metodoPagoId: null, montoContado: '1000' }],
      };
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('acepta montoContado con decimales', async () => {
      const dto: CerrarCajaDto = {
        lineas: [
          { metodoPagoId: null, montoContado: '1000.5000' },
          { metodoPagoId: 'dddddddd-0000-0000-0000-000000000004', montoContado: '800' },
        ],
      };
      const { caja } = await service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, dto);
      expect(caja.diferencia).toBe('0.5000');
    });

    it('lanza si la caja no está abierta (lock falla)', async () => {
      managerMock.query.mockResolvedValueOnce([]); // lock vacío
      const dto: CerrarCajaDto = {
        lineas: [{ metodoPagoId: null, montoContado: '1000' }],
      };
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
```

Agregar `BadRequestException` al import de `@nestjs/common` y `LineaArqueo` ya está exportada por el service (importarla en el spec).

- [ ] **Step 3: Correr para verificar que fallan**

Run: `cd backend && npm test -- caja.service.spec -t "cerrar"`
Expected: FAIL (la firma vieja de `cerrar` no valida líneas ni devuelve `{ caja, arqueo }`).

- [ ] **Step 4: Inyectar el repo y reescribir `cerrar`**

En `caja.service.ts`, agregar el repo al constructor (tras `movimientoCajaRepo`, línea 85):

```ts
    @InjectRepository(CajaArqueoMedio)
    private readonly arqueoMedioRepo: Repository<CajaArqueoMedio>,
```
(y `import { CajaArqueoMedio } from './entities/caja-arqueo-medio.entity';` + `import { BadRequestException } from '@nestjs/common';`).

Reemplazar el método `cerrar` (líneas 277-315) por:

```ts
  async cerrar(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    dto: CerrarCajaDto,
  ): Promise<{ caja: Caja; arqueo: LineaArqueo[] }> {
    return this.dataSource.transaction(async (manager) => {
      await this.bloquearCajaAbierta(manager, cajaId, tenantId);

      const caja = await manager.findOne(Caja, {
        where: { id: cajaId, tenantId, estado: 'abierta', eliminadoEl: IsNull() },
      });
      if (!caja) {
        throw new ForbiddenException('Caja no encontrada o no está abierta');
      }
      if (caja.usuarioId !== usuarioId) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }

      // Esperado recomputado y CONGELADO server-side (nunca viene del cliente).
      const arqueo = await this.calcularArqueo(cajaId, tenantId, manager);

      // Contado declarado por el cajero, indexado por clave de línea.
      const claveDe = (id: string | null) => id ?? 'EFECTIVO';
      const contadoPorClave = new Map<string, string>();
      for (const linea of dto.lineas) {
        contadoPorClave.set(claveDe(linea.metodoPagoId), linea.montoContado);
      }

      // Ninguna línea del DTO puede ser ajena al arqueo recomputado.
      const clavesArqueo = new Set(arqueo.map((l) => claveDe(l.metodoPagoId)));
      for (const clave of contadoPorClave.keys()) {
        if (!clavesArqueo.has(clave)) {
          throw new BadRequestException('Método de pago no pertenece al arqueo');
        }
      }

      // Resolver contado/diferencia por línea + validar obligatorias.
      const lineasResueltas = arqueo.map((l) => {
        const contadoRaw = contadoPorClave.get(claveDe(l.metodoPagoId));
        const obligatoria = l.esEfectivo || l.requiereConteo;
        if (obligatoria && contadoRaw === undefined) {
          throw new BadRequestException(
            `Falta el conteo de ${l.nombre}`,
          );
        }
        const contado =
          contadoRaw === undefined
            ? null
            : new Decimal(contadoRaw).toFixed(4);
        const diferencia =
          contado === null
            ? null
            : new Decimal(contado).minus(l.esperado).toFixed(4);
        return { ...l, contado, diferencia };
      });

      // Congelar todas las líneas.
      await manager.save(
        CajaArqueoMedio,
        lineasResueltas.map((l) =>
          manager.create(CajaArqueoMedio, {
            cajaId,
            tenantId,
            metodoPagoId: l.metodoPagoId,
            esEfectivo: l.esEfectivo,
            esperado: l.esperado,
            contado: l.contado,
            diferencia: l.diferencia,
          }),
        ),
      );

      // Agregados de cajas = línea de efectivo (cuadre del cajón físico).
      const efectivo = lineasResueltas.find((l) => l.metodoPagoId === null)!;
      caja.saldoFinal = efectivo.esperado;
      caja.montoContado = contadoPorClave.get('EFECTIVO')!; // obligatoria → presente
      caja.diferencia = efectivo.diferencia;
      caja.fechaCierre = new Date();
      caja.estado = 'cerrada';
      caja.comentario = dto.comentario ?? null;
      await manager.save(Caja, caja);

      return { caja, arqueo: lineasResueltas };
    });
  }
```

- [ ] **Step 5: Eliminar `calcularSaldoEsperado` (sin consumidores)**

Verificar que ya nadie la usa:

Run: `cd backend && grep -rn "calcularSaldoEsperado" src/`
Expected: solo la definición en `caja.service.ts:250`. Borrar el método completo (líneas 250-275).

- [ ] **Step 6: Correr tests + typecheck**

Run: `cd backend && npm test -- caja.service.spec && npm run typecheck`
Expected: PASS (todo el spec, incluidos los 7 casos de cierre).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/caja/dto backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.service.spec.ts
git commit -m "feat(caja): cierre multi-línea que congela el arqueo por método (caja_arqueo_medio)"
```

---

### Task 5: Endpoint `GET /caja/:id/arqueo` (preview / congelado)

Lectura compartida (`MiCaja:Leer` **o** `Cajas:Leer`) vía el helper `resolverLecturaCompartida`. Caja abierta → preview recomputado; cerrada → líneas congeladas.

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (método `obtenerArqueo`)
- Modify: `backend/src/modules/caja/caja.controller.ts` (ruta antes de `@Get(':id')`)
- Test: `backend/src/modules/caja/caja.service.spec.ts` y `backend/src/modules/caja/caja.controller.spec.ts`

**Interfaces:**
- Consumes: `calcularArqueo` (Task 2), `verificarAccesoCaja` (existente), `resolverLecturaCompartida` (existente), entidad `CajaArqueoMedio`.
- Produces: `obtenerArqueo(tenantId, usuarioId, cajaId, tieneVerTodas): Promise<LineaArqueo[]>`.

- [ ] **Step 1: Escribir los tests que fallan (service)**

En `caja.service.spec.ts`:

```ts
  describe('obtenerArqueo', () => {
    it('caja abierta → preview recomputado (sin contado)', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'abierta',
      });
      jest.spyOn(service, 'calcularArqueo').mockResolvedValueOnce([
        {
          metodoPagoId: null,
          nombre: 'Efectivo',
          esEfectivo: true,
          esperado: '1000.0000',
          requiereConteo: true,
        },
      ]);
      const lineas = await service.obtenerArqueo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        false,
      );
      expect(lineas[0]).toMatchObject({ metodoPagoId: null, esperado: '1000.0000' });
      expect(lineas[0].contado).toBeUndefined();
    });

    it('caja cerrada → líneas congeladas desde caja_arqueo_medio', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
      });
      dataSource.query.mockResolvedValueOnce([
        {
          metodo_pago_id: null,
          nombre: 'Efectivo',
          es_efectivo: true,
          esperado: '1000.0000',
          contado: '950.0000',
          diferencia: '-50.0000',
          requiere_conteo: true,
        },
      ]);
      const lineas = await service.obtenerArqueo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        false,
      );
      expect(lineas[0]).toMatchObject({
        metodoPagoId: null,
        nombre: 'Efectivo',
        esEfectivo: true,
        esperado: '1000.0000',
        contado: '950.0000',
        diferencia: '-50.0000',
      });
    });
  });
```

- [ ] **Step 2: Correr para verificar que fallan**

Run: `cd backend && npm test -- caja.service.spec -t "obtenerArqueo"`
Expected: FAIL (`service.obtenerArqueo is not a function`).

- [ ] **Step 3: Implementar `obtenerArqueo`**

En `caja.service.ts`, tras `calcularArqueo`:

```ts
  /**
   * Arqueo para el drawer de cierre y el detalle read-only. Caja abierta →
   * preview recomputado (sin contado). Caja cerrada → líneas congeladas.
   * (Punto de cambio del sub-proyecto B: en modo ciego retendrá `esperado`.)
   */
  async obtenerArqueo(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas: boolean,
  ): Promise<LineaArqueo[]> {
    const caja = await this.verificarAccesoCaja(
      tenantId,
      usuarioId,
      cajaId,
      tieneVerTodas,
    );

    if (caja.estado === 'abierta') {
      return this.dataSource.transaction((manager) =>
        this.calcularArqueo(cajaId, tenantId, manager),
      );
    }

    const rows: {
      metodo_pago_id: string | null;
      nombre: string | null;
      es_efectivo: boolean;
      esperado: string;
      contado: string | null;
      diferencia: string | null;
      requiere_conteo: boolean;
    }[] = await this.dataSource.query(
      `SELECT am.metodo_pago_id,
              COALESCE(mp.nombre, 'Efectivo') AS nombre,
              am.es_efectivo,
              am.esperado,
              am.contado,
              am.diferencia,
              COALESCE(tmp.requiere_conteo, am.es_efectivo) AS requiere_conteo
       FROM caja_arqueo_medio am
       LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = am.metodo_pago_id
       LEFT JOIN tenant_metodo_pago tmp
              ON tmp.metodo_pago_id = am.metodo_pago_id
             AND tmp.tenant_id = $2
             AND tmp.eliminado_el IS NULL
       WHERE am.caja_id = $1
         AND am.eliminado_el IS NULL
       ORDER BY am.es_efectivo DESC, mp.nombre ASC`,
      [cajaId, tenantId],
    );

    return rows.map((r) => ({
      metodoPagoId: r.metodo_pago_id,
      nombre: r.nombre ?? 'Efectivo',
      esEfectivo: r.es_efectivo,
      esperado: new Decimal(r.esperado).toFixed(4),
      requiereConteo: r.requiere_conteo,
      contado: r.contado === null ? null : new Decimal(r.contado).toFixed(4),
      diferencia:
        r.diferencia === null ? null : new Decimal(r.diferencia).toFixed(4),
    }));
  }
```

- [ ] **Step 4: Agregar la ruta en el controller**

En `caja.controller.ts`, **antes** de `@Get(':id')` (línea 90) para que no la capture la ruta paramétrica:

```ts
  @Get(':id/arqueo')
  async arqueo(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    return this.cajaService.obtenerArqueo(u.tenantId!, u.id, cajaId, verTodas);
  }
```

- [ ] **Step 5: Test del controller (lectura compartida)**

En `caja.controller.spec.ts`, replicar el patrón de los otros endpoints compartidos (`detalle`/`listarMovimientos`): un test que verifica que `arqueo` llama a `resolverLecturaCompartida` y delega en `cajaService.obtenerArqueo` con `verTodas`. Seguir la forma exacta de los tests vecinos del archivo (mismos mocks de `rbacService.userHasPermiso` y `cajaService`).

```ts
  describe('arqueo', () => {
    it('resuelve lectura compartida y delega en obtenerArqueo', async () => {
      rbacService.userHasPermiso
        .mockResolvedValueOnce(false) // MiCaja:Leer
        .mockResolvedValueOnce(true); // Cajas:Leer
      cajaService.obtenerArqueo.mockResolvedValueOnce([]);
      const req = { user: { id: USUARIO_ID, tenantId: TENANT_ID } } as never;
      await controller.arqueo(req, CAJA_ID);
      expect(cajaService.obtenerArqueo).toHaveBeenCalledWith(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        true,
      );
    });
  });
```
(Añadir `obtenerArqueo: jest.fn()` al mock de `cajaService` del `beforeEach` si no está.)

- [ ] **Step 6: Correr tests + typecheck**

Run: `cd backend && npm test -- caja.service.spec caja.controller.spec && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.controller.ts backend/src/modules/caja/caja.service.spec.ts backend/src/modules/caja/caja.controller.spec.ts
git commit -m "feat(caja): GET /caja/:id/arqueo (preview recomputado / líneas congeladas)"
```

---

### Task 6: Frontend store — tipos, `cargarArqueo`, payload de cierre

Adapta `stores/caja.ts` a la nueva forma de cierre y agrega la carga del arqueo. Esta tarea deja los **callers** del drawer compilando; el rework visual del drawer es la Task 7.

**Files:**
- Modify: `frontend/app/stores/caja.ts`
- Modify: `frontend/app/pages/ventas/pos.vue:360-365` y `frontend/app/components/caja/CajaActivaDashboard.vue:95-99` (props del drawer)
- Test: `frontend/app/stores/caja.spec.ts`

**Interfaces:**
- Consumes: `GET /caja/:id/arqueo`, `POST /caja/:id/cerrar` (Tasks 4-5).
- Produces:
  - `interface ArqueoLinea { metodoPagoId: string | null; nombre: string; esEfectivo: boolean; esperado: string; requiereConteo: boolean; contado?: string | null; diferencia?: string | null }`
  - `arqueo: Ref<ArqueoLinea[]>`, `cargarArqueo(cajaId): Promise<void>`
  - `cerrar(cajaId, { lineas: { metodoPagoId: string | null; montoContado: string }[]; comentario?: string })`. Consumido por Tasks 7-8.

- [ ] **Step 1: Escribir el test que falla**

En `caja.spec.ts` (store), seguir el patrón de mock de `useApiFetch` ya usado en el archivo. Agregar:

```ts
  it('cargarArqueo llena el estado arqueo', async () => {
    const lineas = [
      { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, esperado: '1000.0000', requiereConteo: true },
    ]
    mockApiFetch.mockResolvedValueOnce(lineas)
    const store = useCajaStore()
    await store.cargarArqueo('caja-1')
    expect(store.arqueo).toEqual(lineas)
  })

  it('cerrar envía { lineas, comentario } y limpia el estado', async () => {
    mockApiFetch.mockResolvedValueOnce({ caja: { id: 'caja-1' }, arqueo: [] })
    const store = useCajaStore()
    const payload = { lineas: [{ metodoPagoId: null, montoContado: '1000' }] }
    await store.cerrar('caja-1', payload)
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/caja/caja-1/cerrar'),
      expect.objectContaining({ method: 'POST', body: payload }),
    )
    expect(store.activa).toBeNull()
  })
```
(Ajustar el nombre del mock — `mockApiFetch` — al que ya use el archivo.)

- [ ] **Step 2: Correr para verificar que falla**

Run: `cd frontend && npm run test -- caja.spec`
Expected: FAIL (`cargarArqueo` no existe; `cerrar` firma vieja).

- [ ] **Step 3: Implementar en el store**

En `stores/caja.ts`, agregar el tipo (junto a los otros, tras `CajonDisponible`):

```ts
export interface ArqueoLinea {
  metodoPagoId: string | null
  nombre: string
  esEfectivo: boolean
  esperado: string
  requiereConteo: boolean
  contado?: string | null
  diferencia?: string | null
}
```

Estado nuevo (junto a `detalle`):

```ts
  const arqueo = ref<ArqueoLinea[]>([])
```

Acción nueva:

```ts
  async function cargarArqueo(cajaId: string): Promise<void> {
    arqueo.value = await useApiFetch<ArqueoLinea[]>(
      `${config.public.apiUrl}/caja/${cajaId}/arqueo`,
    )
  }
```

Reemplazar `cerrar` (líneas 166-174):

```ts
  async function cerrar(
    cajaId: string,
    payload: { lineas: { metodoPagoId: string | null, montoContado: string }[], comentario?: string },
  ): Promise<{ caja: Caja, arqueo: ArqueoLinea[] }> {
    const res = await useApiFetch<{ caja: Caja, arqueo: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/cerrar`,
      { method: 'POST', body: payload },
    )
    resumenTurno.value = null
    activa.value = null
    return res
  }
```

Exportar `arqueo` y `cargarArqueo` en el `return`.

- [ ] **Step 4: Actualizar los callers del drawer para que compilen**

El drawer cambia de prop `:saldo-esperado` a `:caja-id` únicamente (Task 7 lo consume). En `CajaActivaDashboard.vue` (líneas 95-99) y `pos.vue` (líneas 360-365), quitar `:saldo-esperado="saldoEsperado"` del `<CajaCierreDrawer>` (dejando `v-model:open` y `:caja-id`). No borrar el `computed saldoEsperado` de esos archivos si lo usan en otro lado (verificar con grep: en `pos.vue:84` y `CajaActivaDashboard.vue:31-32` se usa también para el header/resumen — se conserva).

- [ ] **Step 5: Correr test + typecheck**

Run: `cd frontend && npm run test -- caja.spec && npm run typecheck:ratchet`
Expected: PASS. (El drawer aún no consume `arqueo` — se completa en Task 7; typecheck pasa porque el drawer sigue existiendo con su prop `cajaId`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/stores/caja.ts frontend/app/stores/caja.spec.ts frontend/app/pages/ventas/pos.vue frontend/app/components/caja/CajaActivaDashboard.vue
git commit -m "feat(caja): store cargarArqueo + cierre multi-línea"
```

---

### Task 7: `CajaCierreDrawer` — rework a multi-línea

Al abrir, carga `GET /caja/:id/arqueo` y renderiza dos grupos: **A conciliar** (obligatorias: efectivo primero + `requiere_conteo`) e **Informativas** (no-efectivo sin `requiere_conteo`). Diferencia en vivo por línea con Decimal.js.

**Files:**
- Modify: `frontend/app/components/caja/CajaCierreDrawer.vue` (rework completo)
- Test: smoke de navegador (el drawer no tiene unit test; ver memoria `browser-smoke-test-drawer-features`)

**Interfaces:**
- Consumes: `cajaStore.arqueo`, `cargarArqueo`, `cerrar` (Task 6). Props: `{ cajaId: string }` + `v-model:open`.

- [ ] **Step 1: Reescribir el componente**

Reemplazar `CajaCierreDrawer.vue` por:

```vue
<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ArqueoLinea } from '~/stores/caja'

const props = defineProps<{ cajaId: string }>()
const open = defineModel<boolean>('open', { required: true })

const cajaStore = useCajaStore()
const toast = useToast()
const { formatMonto } = useFormatters()

const saving = ref(false)
const loading = ref(false)
// Contado por clave de línea (metodoPagoId ?? 'EFECTIVO').
const contado = ref<Record<string, string>>({})

const claveDe = (l: ArqueoLinea) => l.metodoPagoId ?? 'EFECTIVO'

const obligatorias = computed(() =>
  cajaStore.arqueo.filter(l => l.esEfectivo || l.requiereConteo),
)
const informativas = computed(() =>
  cajaStore.arqueo.filter(l => !l.esEfectivo && !l.requiereConteo),
)

function diferenciaDe(l: ArqueoLinea): Decimal | null {
  const c = contado.value[claveDe(l)]
  if (!c) return null
  try {
    return new Decimal(c).minus(l.esperado)
  }
  catch {
    return null
  }
}

const obligatoriasCompletas = computed(() =>
  obligatorias.value.every(l => !!contado.value[claveDe(l)]),
)

watch(open, async (isOpen) => {
  if (!isOpen) {
    contado.value = {}
    return
  }
  loading.value = true
  try {
    await cajaStore.cargarArqueo(props.cajaId)
  }
  finally {
    loading.value = false
  }
})

async function cerrarCaja() {
  if (!obligatoriasCompletas.value) {
    toast.add({ title: 'Completa el conteo de las líneas obligatorias', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const lineas = Object.entries(contado.value)
      .filter(([, v]) => v !== '')
      .map(([clave, montoContado]) => ({
        metodoPagoId: clave === 'EFECTIVO' ? null : clave,
        montoContado,
      }))
    await cajaStore.cerrar(props.cajaId, { lineas, comentario: comentario.value || undefined })
    toast.add({ title: 'Caja cerrada correctamente', color: 'success' })
    open.value = false
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al cerrar la caja'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

const comentario = ref('')
watch(open, (isOpen) => { if (!isOpen) comentario.value = '' })
</script>

<template>
  <AppDrawer v-model:open="open" width="md">
    <template #header>
      <span class="font-semibold text-default">Cerrar caja</span>
    </template>

    <template #body>
      <div v-if="loading" class="py-8 text-center text-muted text-sm">
        Cargando arqueo…
      </div>
      <UForm
        v-else
        id="caja-cierre-form"
        :state="contado"
        class="space-y-6"
        @submit="cerrarCaja"
      >
        <!-- A conciliar (obligatorias): efectivo primero -->
        <div class="space-y-3">
          <p class="text-xs font-semibold uppercase text-muted">A conciliar</p>
          <div
            v-for="l in obligatorias"
            :key="claveDe(l)"
            class="rounded-lg bg-muted p-3 space-y-2"
          >
            <div class="flex justify-between text-sm">
              <span class="font-medium text-default">{{ l.nombre }}</span>
              <span class="text-muted">Esperado {{ formatMonto(l.esperado) }}</span>
            </div>
            <MoneyInput v-model="contado[claveDe(l)]" oficial class="w-full" />
            <div class="flex justify-between text-sm font-semibold">
              <span class="text-default">Diferencia</span>
              <span
                v-if="diferenciaDe(l) !== null"
                :class="diferenciaDe(l)!.gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
              >
                {{ diferenciaDe(l)!.gte(0) ? '+' : '' }}{{ formatMonto(diferenciaDe(l)!) }}
              </span>
              <span v-else class="text-muted">—</span>
            </div>
          </div>
        </div>

        <!-- Informativas (opcionales) -->
        <div v-if="informativas.length" class="space-y-3">
          <p class="text-xs font-semibold uppercase text-muted">Informativas (opcional)</p>
          <div
            v-for="l in informativas"
            :key="claveDe(l)"
            class="rounded-lg border border-default p-3 space-y-2"
          >
            <div class="flex justify-between text-sm">
              <span class="font-medium text-default">{{ l.nombre }}</span>
              <span class="text-muted">Esperado {{ formatMonto(l.esperado) }}</span>
            </div>
            <MoneyInput v-model="contado[claveDe(l)]" oficial class="w-full" />
            <div v-if="diferenciaDe(l) !== null" class="flex justify-between text-sm">
              <span class="text-muted">Diferencia</span>
              <span :class="diferenciaDe(l)!.gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                {{ diferenciaDe(l)!.gte(0) ? '+' : '' }}{{ formatMonto(diferenciaDe(l)!) }}
              </span>
            </div>
          </div>
        </div>

        <UFormField label="Comentario de cierre">
          <UInput v-model="comentario" placeholder="Observaciones del cierre (opcional)" class="w-full" />
        </UFormField>
      </UForm>
    </template>

    <template #actions>
      <UButton color="neutral" variant="ghost" @click="() => { open = false }">
        Cancelar
      </UButton>
      <UButton
        type="submit"
        form="caja-cierre-form"
        color="error"
        icon="i-lucide-lock"
        :loading="saving"
        :disabled="loading || !obligatoriasCompletas"
      >
        Confirmar cierre
      </UButton>
    </template>
  </AppDrawer>
</template>
```

- [ ] **Step 2: Build + typecheck + design check**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: PASS. Los colores financieros (verde/rojo) son la excepción permitida en el módulo Caja.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/caja/CajaCierreDrawer.vue
git commit -m "feat(caja): drawer de cierre multi-línea (obligatorias/informativas, efectivo primero)"
```

- [ ] **Step 4: Smoke de navegador (obligatorio antes de cerrar la feature)**

Con `docker-compose up`, login admin.paris: abrir caja física, hacer una venta en efectivo + una con tarjeta de débito, abrir el drawer de cierre. Verificar: (a) grupo "A conciliar" con **Efectivo primero** (esperado = fondo + efectivo, **sin** la tarjeta); (b) tarjeta de débito en "Informativas"; (c) diferencia en vivo por línea; (d) cerrar con el efectivo contado → "Caja cerrada correctamente"; (e) consola sin errores. Registrar el resultado en el ledger. (Se difiere al final si el smoke conviene hacerlo una sola vez tras Task 8.)

---

### Task 8: Detalle read-only — desglose del arqueo en caja cerrada

`/mi-caja/[id]` y `/cajas/[id]` muestran el desglose congelado (método · esperado · contado · diferencia) usando el mismo `GET /caja/:id/arqueo`.

**Files:**
- Modify: `frontend/app/pages/mi-caja/[id].vue`
- Modify: `frontend/app/pages/cajas/[id].vue`
- (Si aparece la 3ª copia de la tabla de arqueo — drawer + estos dos detalles — extraer a `frontend/app/components/caja/CajaArqueoTable.vue` con prop `readonly`, según la regla de "extraer a la tercera". El drawer es editable, los dos detalles son read-only idénticos → **sí aplica**: crear `CajaArqueoTable` read-only y usarlo en ambos detalles.)
- Test: incluido en el smoke de Task 7 (paso 4).

**Interfaces:**
- Consumes: `cajaStore.arqueo`, `cargarArqueo` (Task 6).

- [ ] **Step 1: Crear `CajaArqueoTable.vue` (read-only)**

```vue
<script setup lang="ts">
import type { ArqueoLinea } from '~/stores/caja'

defineProps<{ lineas: ArqueoLinea[] }>()
const { formatMonto } = useFormatters()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-muted">
          <th class="py-2 font-medium">Método</th>
          <th class="py-2 font-medium text-right">Esperado</th>
          <th class="py-2 font-medium text-right">Contado</th>
          <th class="py-2 font-medium text-right">Diferencia</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in lineas" :key="l.metodoPagoId ?? 'EFECTIVO'" class="border-t border-default">
          <td class="py-2 text-default">{{ l.nombre }}</td>
          <td class="py-2 text-right text-default">{{ formatMonto(l.esperado) }}</td>
          <td class="py-2 text-right text-default">
            {{ l.contado != null ? formatMonto(l.contado) : '—' }}
          </td>
          <td class="py-2 text-right">
            <span
              v-if="l.diferencia != null"
              :class="Number(l.diferencia) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
            >
              {{ formatMonto(l.diferencia) }}
            </span>
            <span v-else class="text-muted">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 2: Consumir en ambos detalles**

En `mi-caja/[id].vue` y `cajas/[id].vue`: en el `onMounted`/setup donde ya se carga el detalle, agregar `await cajaStore.cargarArqueo(cajaId)` cuando la caja esté **cerrada**, y renderizar `<CajaArqueoTable :lineas="cajaStore.arqueo" />` en una sección "Arqueo del cierre" que solo se muestra si `cajaStore.arqueo.length > 0`. Seguir el layout de secciones ya presente en cada página (leer el archivo antes de editar para insertar en la sección correcta y usar los mismos `UCard`/contenedores).

- [ ] **Step 3: Build + typecheck + design check**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/caja/CajaArqueoTable.vue frontend/app/pages/mi-caja/[id].vue frontend/app/pages/cajas/[id].vue
git commit -m "feat(caja): desglose del arqueo en el detalle read-only de la caja cerrada"
```

---

### Task 9: E2E — arqueo multi-medio en `caja.e2e-spec`

Actualiza los `POST /cerrar` viejos a la forma multi-línea y agrega los casos nuevos que prueban la **regla documentada**.

**Files:**
- Modify: `backend/test/caja.e2e-spec.ts` (los `.send({ montoContado: ... })` de cierre → `{ lineas: [...] }`)
- Modify: helpers `cerrarCaja` en los otros e2e specs que cierran caja (los 6 que se tocaron el 2026-07-23: combos/ventas/liquidacion-propinas/recetas/grupos-modificadores + caja) para la nueva forma del DTO.

**Interfaces:**
- Consumes: `POST /caja/:id/cerrar` multi-línea, `GET /caja/:id/arqueo` (Tasks 4-5).

- [ ] **Step 1: Actualizar los cierres existentes**

En `caja.e2e-spec.ts`, cada `.send({ montoContado: '10000' })` de cierre pasa a:

```ts
.send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });
```
Buscar todos los helpers `cerrarCaja` del repo:

Run: `cd backend && grep -rln "cerrar" test/ | xargs grep -ln "montoContado" `
y actualizar cada uno a `{ lineas: [{ metodoPagoId: null, montoContado: '<entero>' }] }` (el efectivo es la única línea obligatoria cuando la caja solo tuvo ventas en efectivo o ninguna venta).

- [ ] **Step 2: Escribir los casos nuevos**

Agregar a `caja.e2e-spec.ts` un `describe('arqueo multi-medio', ...)`. Usar los helpers de apertura ya existentes (`GET /caja/cajones-disponibles` → `cajonId`) y de venta. Casos:

```ts
  describe('arqueo multi-medio', () => {
    it('vender con tarjeta NO infla el esperado de efectivo (fin del faltante fantasma)', async () => {
      // abrir caja (fondo 0), vender X con tarjeta de débito
      // GET /caja/:id/arqueo → línea efectivo esperado '0.0000', línea tarjeta esperado = X
      // cerrar con efectivo contado 0 → diferencia efectivo 0 (no faltante)
    });

    it('la tarjeta sin requiere_conteo es informativa: cerrar solo con efectivo → 201', async () => {
      // cerrar { lineas: [{ metodoPagoId: null, montoContado: '<efectivo>' }] } → 201
    });

    it('con requiere_conteo=true en tarjeta, cerrar sin su contado → 400', async () => {
      // setear tenant_metodo_pago.requiere_conteo=true para la tarjeta (vía repo/SQL en el setup del test)
      // cerrar solo con efectivo → 400
    });

    it('montoContado admite decimales', async () => {
      // cerrar { lineas: [{ metodoPagoId: null, montoContado: '10000.5000' }] } → 201
    });

    it('la caja cerrada devuelve las líneas congeladas en GET /:id/arqueo', async () => {
      // tras cerrar, GET /caja/:id/arqueo → líneas con contado y diferencia no nulos en las contadas
    });
  });
```
Rellenar cada caso con las llamadas supertest concretas siguiendo el estilo del archivo (tokens, `request(app.getHttpServer())`, asserts de `status` y `body`). Las aserciones se derivan de la **regla documentada** (spec §Reglas de negocio), nunca del output observado.

- [ ] **Step 3: Correr el e2e COMPLETO (no un subset)**

Run: `cd backend && npm run test:e2e`
Expected: PASS. ⚠️ Correr el suite **entero** — un cambio al DTO de cierre compartido rompe consumidores fuera de `caja.e2e-spec` (memoria `gate-e2e-completo-no-subset`). Si aparecen residuales por polución de stock local, reset con `docker-compose down -v` (lo corre el owner); CI con DB fresca es la verdad.

- [ ] **Step 4: Commit**

```bash
git add backend/test
git commit -m "test(caja): e2e del arqueo multi-medio (faltante fantasma, informativa, requiere_conteo, decimales, congelado)"
```

---

### Task 10: Docs + `startup-pos.sql`

Documentación viva en el mismo grupo de commits.

**Files:**
- Modify: `docs/features/gestion-cajas.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/agent/investigaciones/2026-07-23-gestion-caja.md` (§9)
- Modify: `docs/agent/pendientes.md` (ítem §3 de features de negocio diferidas)
- Modify: `startup-pos.sql`

- [ ] **Step 1: `gestion-cajas.md`**

Documentar (el porqué + reglas, no repetir código): modelo del esperado multi-medio; `es_efectivo` (global) vs `requiere_conteo` (por tenant) y la regla `obligatorio = es_efectivo OR requiere_conteo`; endpoint `GET /caja/:id/arqueo` (preview vs congelado); nueva forma de cierre multi-línea; tabla `caja_arqueo_medio` (congelada); el fix de salida/NC validando contra efectivo; agregados de `cajas` = línea de efectivo.

- [ ] **Step 2: `ESTADO.md`**

Fila/estado: arqueo de caja multi-medio ✅ con fecha 2026-07-24.

- [ ] **Step 3: `investigaciones/2026-07-23-gestion-caja.md` §9**

Marcar §3 (faltante fantasma / esperado mezclado) **resuelto por el sub-proyecto A**.

- [ ] **Step 4: `pendientes.md`**

Actualizar el ítem §3 de "Features de negocio diferidas": A hecho; B (ciego) y C (motivos) siguen diferidos con su roadmap.

- [ ] **Step 5: `startup-pos.sql`**

Agregar `es_efectivo BOOLEAN NOT NULL DEFAULT false` a `metodos_pago`; `requiere_conteo BOOLEAN NOT NULL DEFAULT false` a `tenant_metodo_pago`; la tabla `caja_arqueo_medio` con su índice único parcial `(caja_id, metodo_pago_id) WHERE eliminado_el IS NULL`. Seguir el estilo del resto del archivo.

- [ ] **Step 6: Verificar enlaces internos de docs**

Run: los enlaces `.md` los valida el pre-commit; asegurarse de no romperlos.

- [ ] **Step 7: Commit**

```bash
git add docs/features/gestion-cajas.md docs/ESTADO.md docs/agent/investigaciones/2026-07-23-gestion-caja.md docs/agent/pendientes.md startup-pos.sql
git commit -m "docs(caja): arqueo multi-medio (feature, estado, investigación §3, pendientes, esquema SQL)"
```

---

## Gate de cierre (obligatorio antes de dar A por terminado)

Correr el gate **entero** como está en CLAUDE.md (memoria `rigor-sobre-velocidad`, `gate-e2e-completo-no-subset`):

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Más: smoke de navegador del drawer (Task 7 paso 4), revisión de juicio independiente (`domain-reviewer` vía `verify-feature`: soft-delete query-por-query, N+1, Decimal, alcance, `es_efectivo` sin filtrar `eliminado_el` justificado). "Terminado" = todo en verde, no "implementado y probablemente bien".

---

## Self-review del plan (cobertura del spec)

- **Data model** (spec §Modelo de datos): Task 1 ✅ (es_efectivo, requiere_conteo, caja_arqueo_medio + índice único parcial).
- **Fórmulas + split del cálculo** (§Fórmulas, §Backend cálculo): Task 2 ✅.
- **Remapeo 3 consumidores** (§Backend, tabla): salida 422 + NC → Task 3; cerrar → Task 4 ✅.
- **Endpoint preview/congelado** (§Backend endpoint): Task 5 ✅ (lectura compartida, ambos estados).
- **DTO multi-línea + decimales + flujo cerrar** (§Backend DTO): Task 4 ✅ (congela, valida obligatorias 400, cajas.* = efectivo).
- **Frontend** (§Frontend): store Task 6, drawer Task 7, detalle read-only Task 8 ✅ (grupos, efectivo primero, colores financieros, CajaArqueoTable a la 3ª copia).
- **Seed** (§Seed): Task 1 paso 5 ✅ (incl. backfill idempotente del flag).
- **Testing** (§Testing): unit en Tasks 2-5, e2e en Task 9 ✅.
- **Backward-compat** (§Backward-compat): cajas.* = efectivo (Task 4), cajas viejas sin filas → detalle sin desglose (Task 8 muestra sección solo si `arqueo.length > 0`) ✅.
- **Docs** (§Docs): Task 10 ✅.
- **Criterios de aceptación** (§Criterios): cubiertos por Tasks 1-10 + gate.

Type-consistency: `LineaArqueo` (backend) ≡ `ArqueoLinea` (frontend) — mismos campos; nombres distintos a propósito (convención de cada lado). `cerrar` devuelve `{ caja, arqueo }` en backend (Task 4) y el store lo consume así (Task 6). `claveDe(metodoPagoId ?? 'EFECTIVO')` consistente entre service (Task 4), drawer (Task 7) y tabla (Task 8).
