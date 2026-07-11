# Módulo de Cron — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status**: Done
**Date**: 2026-07-11
**Owner**: Cesar Matheus
**Spec**: `docs/superpowers/specs/2026-07-11-modulo-cron-design.md`

**Goal:** Infraestructura de jobs internos programados (`@nestjs/schedule` + tabla `cron_ejecuciones`) validada con un primer job real que expira órdenes de pasarela vencidas.

**Architecture:** Módulo nuevo `backend/src/modules/cron/`. Un `CronRunnerService` envuelve cada job: registra la ejecución en `cron_ejecuciones`, captura errores sin propagarlos y evita solapamiento con un set en memoria. Los jobs se declaran en código con `@Cron(...)`. El primer job (`ExpirarOrdenesJob`) replica en SQL la regla de la expiración perezosa de `cobros.service.ts`.

**Tech Stack:** NestJS 11, `@nestjs/schedule`, TypeORM (Postgres), Jest.

## Global Constraints

- Sin UI, sin endpoints HTTP, sin `tenant_id` en la tabla (jobs del sistema) — spec §Decisiones.
- El job usa la `fecha_expiracion` de cada orden; **no** se modifica `EXPIRACION_ORDEN_MS` ni la expiración perezosa existente.
- Soft delete en la tabla nueva (`eliminado_el`); columnas uuid con `type: 'uuid'` explícito (ADR-004).
- Trabajar directo sobre `main` (etapa de desarrollo, sin ramas ni PRs).
- Antes de cerrar: `npm test`, `npx tsc --noEmit` y `npm run lint` limpios en `backend/`.
- Adición menor sobre el spec (aprobada en plan): el job también corre un tick en `onApplicationBootstrap`, para limpiar el backlog tras un reinicio y facilitar la verificación manual. Task 4 actualiza el spec con esta línea.

---

### Task 1: Dependencia + entidad `CronEjecucion`

**Files:**
- Create: `backend/src/modules/cron/entities/cron-ejecucion.entity.ts`
- Modify: `backend/src/app.module.ts` (import + array `entities`)
- Modify: `backend/package.json` (vía `npm install`)
- Modify: `startup-pos.sql` (DDL de la tabla nueva)

**Interfaces:**
- Consumes: nada.
- Produces: entidad `CronEjecucion` (propiedades: `ejecucionId: string`, `job: string`, `iniciadoEl: Date`, `finalizadoEl: Date | null`, `estado: string`, `detalle: string | null`, `error: string | null`, timestamps de convención). Tasks 2 y 3 dependen de ella.

- [ ] **Step 1: Instalar `@nestjs/schedule`**

```bash
cd backend && npm install @nestjs/schedule
```

Expected: agrega `"@nestjs/schedule"` a `dependencies` en `backend/package.json`.

- [ ] **Step 2: Crear la entidad**

`backend/src/modules/cron/entities/cron-ejecucion.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('cron_ejecuciones')
export class CronEjecucion {
  @PrimaryGeneratedColumn('uuid', { name: 'ejecucion_id' })
  ejecucionId: string;

  // Nombre estable del job, ej. 'expirar-ordenes'. Índice: consulta de historial.
  @Index()
  @Column()
  job: string;

  @Column({ name: 'iniciado_el', type: 'timestamptz' })
  iniciadoEl: Date;

  @Column({ name: 'finalizado_el', type: 'timestamptz', nullable: true })
  finalizadoEl: Date | null;

  @Column({ default: 'en_curso' })
  estado: string; // 'en_curso' | 'ok' | 'error'

  @Column({ type: 'text', nullable: true })
  detalle: string | null; // resumen del resultado, ej. "3 órdenes expiradas"

  @Column({ type: 'text', nullable: true })
  error: string | null; // mensaje si estado = 'error'

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

Nota: no lleva `tenant_id` — los jobs son del sistema (spec §Entidad).

- [ ] **Step 3: Registrar la entidad en `app.module.ts`**

Agregar el import junto a los demás (después de la línea `import { PasarelaTransaccion } ...`):

```typescript
import { CronEjecucion } from './modules/cron/entities/cron-ejecucion.entity';
```

y `CronEjecucion` al final del array `entities` del `TypeOrmModule.forRootAsync` (después de `PasarelaTransaccion`).

- [ ] **Step 4: Agregar el DDL a `startup-pos.sql`**

Al final del archivo, siguiendo el estilo de las tablas existentes:

```sql
-- Módulo de cron: registro de ejecuciones de jobs internos del sistema.
-- Sin tenant_id: los jobs recorren todos los tenants.
CREATE TABLE cron_ejecuciones (
    ejecucion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job VARCHAR NOT NULL,                       -- nombre estable, ej. 'expirar-ordenes'
    iniciado_el TIMESTAMPTZ NOT NULL,
    finalizado_el TIMESTAMPTZ,                  -- null mientras corre
    estado VARCHAR NOT NULL DEFAULT 'en_curso', -- 'en_curso' | 'ok' | 'error'
    detalle TEXT,                               -- resumen del resultado
    error TEXT,                                 -- mensaje si falló
    creado_el TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT now(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_cron_ejecuciones_job ON cron_ejecuciones (job);
```

(Antes de escribir, mirar el final de `startup-pos.sql` y adaptar comillas/estilo si difiere.)

- [ ] **Step 5: Verificar compilación**

```bash
cd backend && npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/modules/cron backend/src/app.module.ts startup-pos.sql
git commit -m "feat(cron): entidad CronEjecucion y dependencia @nestjs/schedule"
```

---

### Task 2: `CronRunnerService` (TDD)

**Files:**
- Create: `backend/src/modules/cron/cron-runner.service.ts`
- Test: `backend/src/modules/cron/cron-runner.service.spec.ts`

**Interfaces:**
- Consumes: entidad `CronEjecucion` (Task 1).
- Produces: `CronRunnerService.ejecutar(job: string, fn: () => Promise<string>): Promise<void>` — Task 3 lo invoca. El string que devuelve `fn` se persiste como `detalle`. Nunca lanza.

- [ ] **Step 1: Escribir los tests (fallan)**

`backend/src/modules/cron/cron-runner.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CronEjecucion } from './entities/cron-ejecucion.entity';
import { CronRunnerService } from './cron-runner.service';

describe('CronRunnerService', () => {
  let service: CronRunnerService;
  const saveMock = jest.fn();
  const repoMock = {
    create: jest.fn((x: Partial<CronEjecucion>) => x as CronEjecucion),
    save: saveMock,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    saveMock.mockImplementation(async (e: CronEjecucion) => e);
    const module = await Test.createTestingModule({
      providers: [
        CronRunnerService,
        { provide: getRepositoryToken(CronEjecucion), useValue: repoMock },
      ],
    }).compile();
    service = module.get(CronRunnerService);
  });

  it('registra la ejecución exitosa con detalle', async () => {
    await service.ejecutar('demo', async () => '3 órdenes expiradas');

    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'demo', estado: 'en_curso' }),
    );
    const final = saveMock.mock.calls.at(-1)![0] as CronEjecucion;
    expect(final.estado).toBe('ok');
    expect(final.detalle).toBe('3 órdenes expiradas');
    expect(final.finalizadoEl).toBeInstanceOf(Date);
  });

  it('registra el error sin propagar la excepción', async () => {
    await expect(
      service.ejecutar('demo', async () => {
        throw new Error('boom');
      }),
    ).resolves.toBeUndefined();

    const final = saveMock.mock.calls.at(-1)![0] as CronEjecucion;
    expect(final.estado).toBe('error');
    expect(final.error).toBe('boom');
    expect(final.finalizadoEl).toBeInstanceOf(Date);
  });

  it('omite el tick si el mismo job sigue en curso', async () => {
    let release!: () => void;
    const bloqueado = new Promise<string>((res) => {
      release = () => res('primera terminó');
    });

    const primera = service.ejecutar('demo', () => bloqueado);
    await service.ejecutar('demo', async () => 'segunda'); // debe omitirse

    expect(saveMock).toHaveBeenCalledTimes(1); // solo el insert de la primera

    release();
    await primera;
    expect(saveMock).toHaveBeenCalledTimes(2); // insert + cierre de la primera
  });

  it('libera el lock al terminar y permite una nueva ejecución', async () => {
    await service.ejecutar('demo', async () => 'a');
    await service.ejecutar('demo', async () => 'b');
    expect(saveMock).toHaveBeenCalledTimes(4); // 2 ejecuciones × (insert + cierre)
  });

  it('no propaga si falla la persistencia del registro', async () => {
    saveMock.mockRejectedValueOnce(new Error('db caída'));
    await expect(service.ejecutar('demo', async () => 'a')).resolves.toBeUndefined();
    // el lock quedó liberado: una nueva ejecución vuelve a intentar
    await service.ejecutar('demo', async () => 'b');
    expect(repoMock.create).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Correr los tests — deben fallar**

```bash
cd backend && npm test -- cron-runner.service.spec
```

Expected: FAIL (`Cannot find module './cron-runner.service'`).

- [ ] **Step 3: Implementar el service**

`backend/src/modules/cron/cron-runner.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronEjecucion } from './entities/cron-ejecucion.entity';

/**
 * Envoltorio común de ejecución de jobs internos: registra cada corrida en
 * cron_ejecuciones, captura errores sin propagarlos (un job roto no debe
 * tumbar el scheduler) y evita solapamiento por job con un set en memoria
 * (instancia única; locking distribuido queda fuera de alcance).
 */
@Injectable()
export class CronRunnerService {
  private readonly logger = new Logger(CronRunnerService.name);
  private readonly enCurso = new Set<string>();

  constructor(
    @InjectRepository(CronEjecucion)
    private readonly ejecucionRepo: Repository<CronEjecucion>,
  ) {}

  async ejecutar(job: string, fn: () => Promise<string>): Promise<void> {
    if (this.enCurso.has(job)) {
      this.logger.debug(`Job "${job}" aún en curso; tick omitido`);
      return;
    }
    this.enCurso.add(job);
    try {
      const ejecucion = await this.ejecucionRepo.save(
        this.ejecucionRepo.create({
          job,
          iniciadoEl: new Date(),
          estado: 'en_curso',
        }),
      );
      try {
        ejecucion.detalle = await fn();
        ejecucion.estado = 'ok';
      } catch (e) {
        ejecucion.estado = 'error';
        ejecucion.error = e instanceof Error ? e.message : String(e);
        this.logger.error(`Job "${job}" falló: ${ejecucion.error}`);
      }
      ejecucion.finalizadoEl = new Date();
      await this.ejecucionRepo.save(ejecucion);
    } catch (e) {
      // Fallo de persistencia del registro: log y seguir; el próximo tick reintenta.
      this.logger.error(
        `No se pudo registrar la ejecución del job "${job}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      this.enCurso.delete(job);
    }
  }
}
```

- [ ] **Step 4: Correr los tests — deben pasar**

```bash
cd backend && npm test -- cron-runner.service.spec
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/cron/cron-runner.service.ts backend/src/modules/cron/cron-runner.service.spec.ts
git commit -m "feat(cron): CronRunnerService con registro de ejecuciones y anti-solapamiento"
```

---

### Task 3: `ExpirarOrdenesJob` + `CronModule` + registro en `app.module.ts` (TDD)

**Files:**
- Create: `backend/src/modules/cron/jobs/expirar-ordenes.job.ts`
- Create: `backend/src/modules/cron/cron.module.ts`
- Modify: `backend/src/app.module.ts` (imports: `ScheduleModule.forRoot()` + `CronModule`)
- Test: `backend/src/modules/cron/jobs/expirar-ordenes.job.spec.ts`

**Interfaces:**
- Consumes: `CronRunnerService.ejecutar(job, fn)` (Task 2).
- Produces: `ExpirarOrdenesJob` con `tick(): Promise<void>` (decorado `@Cron`, y llamado en `onApplicationBootstrap`) y `expirarOrdenesVencidas(): Promise<string>` (público para test). Constante exportada `JOB_EXPIRAR_ORDENES = 'expirar-ordenes'`.

- [ ] **Step 1: Escribir los tests (fallan)**

`backend/src/modules/cron/jobs/expirar-ordenes.job.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CronRunnerService } from '../cron-runner.service';
import { ExpirarOrdenesJob, JOB_EXPIRAR_ORDENES } from './expirar-ordenes.job';

describe('ExpirarOrdenesJob', () => {
  let job: ExpirarOrdenesJob;
  const queryMock = jest.fn();
  const runnerMock = {
    ejecutar: jest.fn((_job: string, fn: () => Promise<string>) => fn()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    queryMock.mockResolvedValue([[], 0]); // pg: UPDATE devuelve [rows, rowCount]
    const module = await Test.createTestingModule({
      providers: [
        ExpirarOrdenesJob,
        { provide: CronRunnerService, useValue: runnerMock },
        { provide: getDataSourceToken(), useValue: { query: queryMock } },
      ],
    }).compile();
    job = module.get(ExpirarOrdenesJob);
  });

  it('el tick delega al runner con el nombre estable del job', async () => {
    await job.tick();
    expect(runnerMock.ejecutar).toHaveBeenCalledWith(
      JOB_EXPIRAR_ORDENES,
      expect.any(Function),
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('reporta la cantidad de órdenes expiradas', async () => {
    queryMock.mockResolvedValue([[], 3]);
    await expect(job.expirarOrdenesVencidas()).resolves.toBe(
      '3 órdenes expiradas',
    );
  });

  it('la consulta aplica las reglas de elegibilidad', async () => {
    await job.expirarOrdenesVencidas();
    const sql = (queryMock.mock.calls[0][0] as string).replace(/\s+/g, ' ');
    expect(sql).toContain("estado IN ('creada', 'en_proceso')");
    expect(sql).toContain('fecha_expiracion < now()');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("tipo = 'AUTHORIZATION'");
    expect(sql).toContain("SET estado = 'expirada'");
    expect(sql).toContain('eliminado_el IS NULL');
  });

  it('onApplicationBootstrap dispara un tick inicial', async () => {
    await job.onApplicationBootstrap();
    expect(runnerMock.ejecutar).toHaveBeenCalledWith(
      JOB_EXPIRAR_ORDENES,
      expect.any(Function),
    );
  });
});
```

- [ ] **Step 2: Correr los tests — deben fallar**

```bash
cd backend && npm test -- expirar-ordenes.job.spec
```

Expected: FAIL (`Cannot find module './expirar-ordenes.job'`).

- [ ] **Step 3: Implementar el job**

`backend/src/modules/cron/jobs/expirar-ordenes.job.ts`:

```typescript
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CronRunnerService } from '../cron-runner.service';

export const JOB_EXPIRAR_ORDENES = 'expirar-ordenes';

/**
 * Expira órdenes de pasarela vencidas según su fecha_expiracion (fijada al
 * crear la orden; hoy creación + 2 h). Replica la regla de la expiración
 * perezosa de cobros.service.ts: nunca expira una orden con un intento de
 * autorización en error — pudo haberse pagado en el proveedor y se cierra
 * solo vía /verificar. La vía perezosa se mantiene; ambas son idempotentes.
 */
@Injectable()
export class ExpirarOrdenesJob implements OnApplicationBootstrap {
  constructor(
    private readonly runner: CronRunnerService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // Tick inicial al arrancar: limpia el backlog acumulado si el backend
  // estuvo caído (y permite verificar el job sin esperar el próximo tick).
  onApplicationBootstrap(): Promise<void> {
    return this.tick();
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  tick(): Promise<void> {
    return this.runner.ejecutar(JOB_EXPIRAR_ORDENES, () =>
      this.expirarOrdenesVencidas(),
    );
  }

  async expirarOrdenesVencidas(): Promise<string> {
    // pg: UPDATE vía dataSource.query devuelve [rows, rowCount]
    const resultado = (await this.dataSource.query(
      `UPDATE pasarela_ordenes o
       SET estado = 'expirada', actualizado_el = now()
       WHERE o.estado IN ('creada', 'en_proceso')
         AND o.eliminado_el IS NULL
         AND o.fecha_expiracion IS NOT NULL
         AND o.fecha_expiracion < now()
         AND NOT EXISTS (
           SELECT 1 FROM pasarela_transacciones t
           WHERE t.orden_id = o.orden_id
             AND t.tipo = 'AUTHORIZATION'
             AND t.estado = 'error'
             AND t.eliminado_el IS NULL
         )`,
    )) as [unknown[], number];
    const cantidad = resultado[1];
    return `${cantidad} órdenes expiradas`;
  }
}
```

- [ ] **Step 4: Crear el módulo**

`backend/src/modules/cron/cron.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CronEjecucion } from './entities/cron-ejecucion.entity';
import { CronRunnerService } from './cron-runner.service';
import { ExpirarOrdenesJob } from './jobs/expirar-ordenes.job';

@Module({
  imports: [TypeOrmModule.forFeature([CronEjecucion])],
  providers: [CronRunnerService, ExpirarOrdenesJob],
  exports: [CronRunnerService],
})
export class CronModule {}
```

- [ ] **Step 5: Registrar en `app.module.ts`**

Agregar los imports (junto a los demás imports de módulos):

```typescript
import { ScheduleModule } from '@nestjs/schedule';
import { CronModule } from './modules/cron/cron.module';
```

y en el array `imports` del `@Module`, después de `PasarelaModule`:

```typescript
    ScheduleModule.forRoot(),
    CronModule,
```

- [ ] **Step 6: Correr los tests — deben pasar**

```bash
cd backend && npm test -- expirar-ordenes.job.spec
```

Expected: PASS (4 tests).

- [ ] **Step 7: Suite completa + tsc**

```bash
cd backend && npm test && npx tsc --noEmit
```

Expected: toda la suite PASS, tsc sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/cron backend/src/app.module.ts
git commit -m "feat(cron): ExpirarOrdenesJob cada 10 min con tick inicial al arrancar"
```

---

### Task 4: Verificación manual + docs vivas

**Files:**
- Create: `docs/features/cron.md`
- Modify: `docs/README.md` (link a la feature nueva)
- Modify: `CLAUDE.md` (fila nueva en la tabla "Estado actual")
- Modify: `docs/superpowers/specs/2026-07-11-modulo-cron-design.md` (nota del tick inicial)

**Interfaces:**
- Consumes: todo lo anterior funcionando.
- Produces: documentación sincronizada (convención "Documentación viva").

- [ ] **Step 1: Verificación manual end-to-end**

Con el stack corriendo (`docker-compose up`):

```bash
# 1. Forzar una orden vencida (elegir una orden en_proceso existente, o crear
#    una vía el checkout de la tienda online y abandonarla antes de pagar):
docker-compose exec -T db psql -U postgres -d startup -c \
  "UPDATE pasarela_ordenes SET fecha_expiracion = now() - interval '1 minute'
   WHERE estado = 'en_proceso' AND eliminado_el IS NULL;"

# 2. Reiniciar el backend (dispara el tick de onApplicationBootstrap):
docker-compose restart backend

# 3. Verificar el resultado:
docker-compose exec -T db psql -U postgres -d startup -c \
  "SELECT estado, count(*) FROM pasarela_ordenes GROUP BY estado;"
docker-compose exec -T db psql -U postgres -d startup -c \
  "SELECT job, estado, detalle, error, iniciado_el, finalizado_el
   FROM cron_ejecuciones ORDER BY iniciado_el DESC LIMIT 5;"
```

Expected: la orden quedó `expirada`; hay una fila en `cron_ejecuciones` con `job = 'expirar-ordenes'`, `estado = 'ok'` y `detalle = 'N órdenes expiradas'` (N ≥ 1).

(Si el usuario/BD difieren, tomar los valores reales de `.env` / `docker-compose.yml`.)

- [ ] **Step 2: Escribir `docs/features/cron.md`**

Desde `docs/features/TEMPLATE.md`, adaptado (sin endpoints ni frontend):

```markdown
# Feature: Módulo de cron (jobs internos)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-11

---

## Overview

### What is it?

Infraestructura de tareas programadas internas del backend. Los jobs se
declaran en código con `@Cron(...)` (`@nestjs/schedule`) y corren in-process.
Cada ejecución queda registrada en la tabla `cron_ejecuciones` (inicio/fin,
estado, detalle del resultado, error). No hay UI ni endpoints en esta fase.

Primer job real: **expirar-ordenes** — cada 10 minutos (y al arrancar el
backend) marca como `expirada` toda orden de pasarela `creada`/`en_proceso`
cuya `fecha_expiracion` ya pasó, excluyendo órdenes con un intento de
autorización en error (pudieron pagarse en el proveedor; se cierran solo vía
`/verificar`). Replica la regla de la expiración perezosa de
`cobros.service.ts`, que se mantiene; ambas vías son idempotentes.

### Why does it exist?

Había lógica dependiente del tiempo que solo se evaluaba al consultar
(expiración perezosa): una orden que nadie consulta quedaba `en_proceso` para
siempre. La infraestructura además deja la base para jobs futuros (cobro
recurrente de suscripciones, vencimiento por `activa_hasta`, tasas).

### Scope

- Incluido: `CronRunnerService`, tabla `cron_ejecuciones`, job `expirar-ordenes`.
- NO incluido (futuro): cobro de suscripciones, UI de administración,
  locking distribuido, intervalos configurables en BD, reintentos.

---

## Backend

### Module & Services

- **Module**: `src/modules/cron/cron.module.ts`
- **Runner**: `src/modules/cron/cron-runner.service.ts` —
  `ejecutar(job, fn)`: registra la ejecución, captura errores sin propagar,
  evita solapamiento por job (set en memoria; instancia única).
- **Job**: `src/modules/cron/jobs/expirar-ordenes.job.ts` —
  `@Cron(EVERY_10_MINUTES)` + tick inicial en `onApplicationBootstrap`.

### Entity & Database

**Table**: `cron_ejecuciones` (sin `tenant_id` — jobs del sistema)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `ejecucion_id` | UUID | PK | |
| `job` | VARCHAR | NOT NULL, índice | nombre estable, ej. `expirar-ordenes` |
| `iniciado_el` | TIMESTAMPTZ | NOT NULL | |
| `finalizado_el` | TIMESTAMPTZ | | null mientras corre |
| `estado` | VARCHAR | NOT NULL | `en_curso` \| `ok` \| `error` |
| `detalle` | TEXT | | ej. `"3 órdenes expiradas"` |
| `error` | TEXT | | mensaje si falló |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | | convención |

---

## Testing

```bash
cd backend
npm test -- cron-runner.service.spec
npm test -- expirar-ordenes.job.spec
```

Manual: forzar `fecha_expiracion` pasada en una orden `en_proceso`, reiniciar
el backend (tick inicial) y verificar `estado = 'expirada'` + fila `ok` en
`cron_ejecuciones`.

---

## Related Features

- `docs/features/` — pasarela de pagos (órdenes y transacciones)

## Notes

- Spec: `docs/superpowers/specs/2026-07-11-modulo-cron-design.md`
- El umbral de expiración vive en la orden (`fecha_expiracion`, hoy creación
  + 2 h vía `EXPIRACION_ORDEN_MS`); el job no define umbral propio.
```

- [ ] **Step 3: Actualizar `docs/README.md`, `CLAUDE.md` y el spec**

- `docs/README.md`: agregar en la tabla de features (después de la fila de `reembolsos-nota-credito.md`):

```markdown
| [cron.md](./features/cron.md) | Jobs internos programados: registro de ejecuciones + expiración de órdenes de pasarela |
```
- `CLAUDE.md`, tabla "Estado actual", fila nueva al final:

```markdown
| Módulo de cron (jobs internos: registro de ejecuciones + expiración de órdenes de pasarela) | ✅ Implementado (2026-07-11) |
```

- Spec `docs/superpowers/specs/2026-07-11-modulo-cron-design.md`, sección `### ExpirarOrdenesJob`, agregar al final del bullet list:

```markdown
- Además del intervalo, corre un tick inicial en `onApplicationBootstrap`
  (limpia el backlog tras un reinicio; decisión tomada al escribir el plan).
```

- [ ] **Step 4: Lint + suite final**

```bash
cd backend && npm run lint && npm test
```

Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add docs/features/cron.md docs/README.md CLAUDE.md docs/superpowers/specs/2026-07-11-modulo-cron-design.md
git commit -m "docs: feature del módulo de cron y estado actual"
```
