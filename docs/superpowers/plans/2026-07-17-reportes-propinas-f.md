# Reportes Agregados de Propinas (F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar `/propinas/reportes` con resumen del ciclo completo y agregados por trabajador, aislados por tenant y auditables.

**Architecture:** Dos endpoints de solo lectura dentro de `PropinasModule` ejecutan agregados SQL parametrizados sobre los hechos existentes. Un composable tipado serializa los filtros y cachea cada tab; la página operativa renderiza Resumen y Por trabajador sin recalcular dinero en el cliente.

**Tech Stack:** NestJS 11, TypeORM/PostgreSQL 15, class-validator, Decimal.js, Jest, Nuxt 4, Vue 3, Nuxt UI 4, Vitest.

**Status:** In Progress  
**Date:** 2026-07-17  
**Owner:** Cesar Matheus

## Context

Los hechos de propina y las liquidaciones ya existen. F agrega lectura gerencial
sin modificar esos hechos ni inventar una asignación por fuente que el modelo no
persiste.

## Scope

Incluye API de resumen y trabajadores, pantalla con tabs, navegación, pruebas y
documentación viva. Excluye exportaciones, pagos reales, jobs y nuevas tablas.

## Backend

Queries SQL agregadas, DTO común, contratos tipados, controller RBAC y registro en
`PropinasModule`.

## Frontend

Composable tipado con caché por tab y página `/propinas/reportes` con filtros,
KPIs, tendencia y tabla por trabajador.

## Verification

RED/GREEN por tarea, builds backend/frontend, cobertura >= 80%, revisión de planes
SQL y recorrido manual del ciclo completo.

## Decisions

- Fechas calendario convertidas por el backend con la zona del tenant.
- Cobranza por fecha de tip; asignación por liquidación completamente contenida.
- Sin prorrateo, paginación ni librería de gráficos en F v1.

## Global Constraints

- Implementar exactamente la spec `docs/superpowers/specs/2026-07-17-reportes-propinas-f-design.md`.
- Trabajar y commitear directamente sobre `main`; no crear ramas ni PRs.
- Todo `tenant_id` viene del JWT; nunca aceptar `tenantId` en query/body.
- Toda lectura filtra `eliminado_el IS NULL` en cada tabla y se ejecuta como `SELECT` parametrizado.
- No crear tablas, entidades, jobs, exports ni dependencias de gráficos.
- Montos, porcentajes, horas, ventas base y cuentas viajan como strings; nunca usar `number` para aritmética financiera.
- `desde`/`hasta` son `YYYY-MM-DD`; el backend los convierte a medianoche en la
  zona del tenant. `desde` es inclusivo, `hasta` exclusivo y el máximo es 366 días.
- Cobranza usa `venta_propina.creado_el`; asignación usa liquidaciones completamente contenidas.
- Guard real: `Propinas:Leer`.
- UI solo con tokens semánticos Nuxt UI y utilidades de `useFormatters`.
- TDD obligatorio; verificar RED antes de editar producción y GREEN después.
- Cobertura mínima de los archivos nuevos: 80%.

---

## Mapa de archivos

### Backend

- Crear `backend/src/modules/propinas/dto/query-propina-reporte.dto.ts`: parseo y validación de filtros.
- Crear `backend/src/modules/propinas/dto/query-propina-reporte.dto.spec.ts`: límites, UUIDs y normalización.
- Crear `backend/src/modules/propinas/propina-reportes.types.ts`: contratos públicos compartidos.
- Crear `backend/src/modules/propinas/propina-reportes.service.ts`: queries y mapeo.
- Crear `backend/src/modules/propinas/propina-reportes.service.spec.ts`: contrato, filtros y aislamiento.
- Crear `backend/src/modules/propinas/propina-reportes.controller.ts`: endpoints protegidos.
- Modificar `backend/src/modules/propinas/propinas.module.ts`: registrar controller/service.

### Frontend

- Crear `frontend/app/composables/usePropinaReportes.ts`: tipos, serialización, caché y llamadas.
- Crear `frontend/app/composables/usePropinaReportes.spec.ts`: filtros y caché.
- Crear `frontend/app/pages/propinas/reportes.vue`: filtros, tabs y visualización.
- Modificar `frontend/app/layouts/dashboard.vue`: navegación anidada de Propinas.

### Documentación

- Crear `docs/features/reportes-propinas.md`.
- Modificar `docs/README.md`, `docs/ESTADO.md`, `docs/ARCHITECTURE.md`.
- Modificar la spec de F a `Status: Done`.

---

### Task 1: Contrato y validación de filtros

**Files:**
- Create: `backend/src/modules/propinas/dto/query-propina-reporte.dto.ts`
- Create: `backend/src/modules/propinas/dto/query-propina-reporte.dto.spec.ts`
- Create: `backend/src/modules/propinas/propina-reportes.types.ts`

**Interfaces:**
- Produces: `QueryPropinaReporteDto`, `normalizarRangoReporte(dto)`, `PropinaReporteResumen`, `PropinaReporteTrabajadores`.
- Consumes: `TipoGarzon` existente.

- [ ] **Step 1: Escribir tests RED del DTO**

Crear `query-propina-reporte.dto.spec.ts` con `plainToInstance` + `validate`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  normalizarRangoReporte,
  QueryPropinaReporteDto,
} from './query-propina-reporte.dto';

describe('QueryPropinaReporteDto', () => {
  it('normaliza UUIDs separados por coma y elimina duplicados', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440001';
    const dto = plainToInstance(QueryPropinaReporteDto, {
      desde: '2026-07-01',
      hasta: '2026-08-01',
      turnoIds: `${id},${id}`,
      tipoGarzon: 'garzon',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.turnoIds).toEqual([id]);
  });

  it.each([
    [{ hasta: '2026-08-01' }, 'desde requerido'],
    [{ desde: '2026-07-01' }, 'hasta requerido'],
    [{
      desde: '2026-07-01',
      hasta: '2026-08-01',
      turnoIds: 'no-es-uuid',
    }, 'turno inválido'],
    [{
      desde: '2026-07-01',
      hasta: '2026-08-01',
      tipoGarzon: 'administrador',
    }, 'tipo inválido'],
  ])('rechaza %s (%s)', async (input) => {
    const errors = await validate(plainToInstance(QueryPropinaReporteDto, input));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza rango invertido', () => {
    expect(() => normalizarRangoReporte({
      desde: '2026-08-01',
      hasta: '2026-07-01',
    })).toThrow(new BadRequestException('La fecha hasta debe ser posterior a desde'));
  });

  it('rechaza más de 366 días', () => {
    expect(() => normalizarRangoReporte({
      desde: '2025-01-01',
      hasta: '2026-07-01',
    })).toThrow(new BadRequestException('El rango máximo del reporte es 366 días'));
  });
});
```

- [ ] **Step 2: Ejecutar RED**

Run:

```bash
cd backend && npm test -- query-propina-reporte.dto.spec.ts --runInBand
```

Expected: FAIL porque el DTO todavía no existe.

- [ ] **Step 3: Commit del checkpoint RED**

```bash
git add backend/src/modules/propinas/dto/query-propina-reporte.dto.spec.ts
git commit -m "test(propinas): definir filtros de reportes F"
```

- [ ] **Step 4: Implementar el DTO**

Crear `query-propina-reporte.dto.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  Matches,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { TipoGarzon } from '../../garzones/enums/tipo-garzon.enum';

function parseTurnoIds({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const source = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(source.map(String).map((id) => id.trim()).filter(Boolean))];
}

export class QueryPropinaReporteDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'desde debe usar YYYY-MM-DD' })
  desde: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'hasta debe usar YYYY-MM-DD' })
  hasta: string;

  @IsOptional()
  @Transform(parseTurnoIds)
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  turnoIds?: string[];

  @IsOptional()
  @IsEnum(TipoGarzon)
  tipoGarzon?: TipoGarzon;
}

export interface RangoReporteNormalizado {
  desde: string;
  hasta: string;
  turnoIds: string[];
  tipoGarzon?: TipoGarzon;
}

export function normalizarRangoReporte(
  dto: Pick<QueryPropinaReporteDto, 'desde' | 'hasta' | 'turnoIds' | 'tipoGarzon'>,
): RangoReporteNormalizado {
  const desdeMs = Date.parse(`${dto.desde}T00:00:00.000Z`);
  const hastaMs = Date.parse(`${dto.hasta}T00:00:00.000Z`);
  const fechasInvalidas = !Number.isFinite(desdeMs)
    || !Number.isFinite(hastaMs)
    || new Date(desdeMs).toISOString().slice(0, 10) !== dto.desde
    || new Date(hastaMs).toISOString().slice(0, 10) !== dto.hasta;
  if (fechasInvalidas) {
    throw new BadRequestException('Las fechas deben usar YYYY-MM-DD');
  }
  if (hastaMs <= desdeMs) {
    throw new BadRequestException('La fecha hasta debe ser posterior a desde');
  }
  const maximoMs = 366 * 24 * 60 * 60 * 1000;
  if (hastaMs - desdeMs > maximoMs) {
    throw new BadRequestException('El rango máximo del reporte es 366 días');
  }
  return {
    desde: dto.desde,
    hasta: dto.hasta,
    turnoIds: dto.turnoIds ?? [],
    tipoGarzon: dto.tipoGarzon,
  };
}
```

- [ ] **Step 5: Definir contratos públicos**

Crear `propina-reportes.types.ts` con estas propiedades exactas:

```typescript
import type { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';

export interface ReportePeriodo {
  desde: string;
  hasta: string;
}

export interface PropinaReporteResumen {
  periodo: ReportePeriodo;
  cobranza: {
    cierres: number;
    conPropina: number;
    sinPropina: number;
    sugerenciaAceptada: number;
    montoCobrado: string;
    montoSugerido: string;
    promedioConPropina: string;
    tasaConPropina: string;
    tasaSugerenciaAceptada: string;
  };
  estadoActual: {
    pendienteLibreCantidad: number;
    pendienteLibreMonto: string;
    enBorradorCantidad: number;
    enBorradorMonto: string;
    liquidadaCantidad: number;
    liquidadaMonto: string;
  };
  anulaciones: {
    liquidaciones: number;
    montoLiberadoHistorico: string;
  };
  tendencia: Array<{
    fecha: string;
    cierres: number;
    conPropina: number;
    montoCobrado: string;
  }>;
  porTurno: Array<{
    turnoId: string | null;
    turnoNombre: string;
    cierres: number;
    conPropina: number;
    montoCobrado: string;
  }>;
  porTipo: Array<{
    tipoGarzon: TipoGarzon | null;
    cierres: number;
    conPropina: number;
    montoCobrado: string;
  }>;
  advertencias: {
    liquidacionesParcialmenteSolapadas: number;
  };
}

export interface PropinaReporteTrabajador {
  garzonId: string;
  nombre: string;
  tipoGarzon: TipoGarzon;
  origen: { cierres: number; conPropina: number; monto: string };
  asignacionConfirmada: {
    monto: string;
    horas: string;
    ventasBase: string;
    cuentas: string;
    liquidaciones: number;
    ultimaLiquidacionEl: string | null;
  };
}

export interface PropinaReporteTrabajadores {
  data: PropinaReporteTrabajador[];
  totales: {
    trabajadores: number;
    montoOriginado: string;
    montoAsignado: string;
    horas: string;
    ventasBase: string;
    cuentas: string;
  };
  advertencias: {
    liquidacionesParcialmenteSolapadas: number;
    liquidacionesTodosLosTurnosExcluidas: number;
  };
}
```

- [ ] **Step 6: Ejecutar GREEN y commit**

Run:

```bash
cd backend && npm test -- query-propina-reporte.dto.spec.ts --runInBand
```

Expected: PASS.

```bash
git add backend/src/modules/propinas/dto/query-propina-reporte.dto.ts \
  backend/src/modules/propinas/propina-reportes.types.ts
git commit -m "feat(propinas): validar filtros de reportes F"
```

---

### Task 2: Endpoint de Resumen

**Files:**
- Create: `backend/src/modules/propinas/propina-reportes.service.ts`
- Create: `backend/src/modules/propinas/propina-reportes.service.spec.ts`

**Interfaces:**
- Consumes: `QueryPropinaReporteDto`, `normalizarRangoReporte`.
- Produces: `PropinaReportesService.resumen(tenantId, query): Promise<PropinaReporteResumen>`.

- [ ] **Step 1: Escribir tests RED del resumen**

El test debe crear el service con `{ query: jest.fn() } as unknown as DataSource`,
devolver filas para cada consulta y verificar:

```typescript
describe('resumen', () => {
  it('mapea ceros como strings y pasa tenant/rango a todas las queries', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
      .mockResolvedValueOnce([{
        cierres: '0', con_propina: '0', sin_propina: '0',
        sugerencia_aceptada: '0', monto_cobrado: '0',
        monto_sugerido: '0', promedio_con_propina: '0',
        tasa_con_propina: '0', tasa_sugerencia_aceptada: '0',
        pendiente_libre_cantidad: '0', pendiente_libre_monto: '0',
        en_borrador_cantidad: '0', en_borrador_monto: '0',
        liquidada_cantidad: '0', liquidada_monto: '0',
      }])
      .mockResolvedValueOnce([{ liquidaciones: '0', monto_liberado: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cantidad: '0' }]);

    const result = await service.resumen(TENANT_ID, QUERY);
    expect(result.cobranza.montoCobrado).toBe('0');
    expect(result.estadoActual.pendienteLibreCantidad).toBe(0);
    expect(dataSource.query.mock.calls.every(([, params]) =>
      !params || params[0] === TENANT_ID)).toBe(true);
  });

  it('envía turnoIds y tipo como parámetros, nunca interpolados en SQL', async () => {
    await prepararRespuestaVacia();
    await service.resumen(TENANT_ID, {
      ...QUERY,
      turnoIds: [TURNO_ID],
      tipoGarzon: TipoGarzon.GARZON,
    });
    const calls = dataSource.query.mock.calls;
    expect(calls.some(([, params]) => params?.includes(TURNO_ID))).toBe(true);
    expect(calls.some(([, params]) => params?.includes('garzon'))).toBe(true);
    expect(calls.every(([sql]) => !sql.includes(TURNO_ID))).toBe(true);
  });
});
```

Agregar casos para tendencia con días cero, turno `null` como
`"Sin turno"`, tipo `null`, monto liberado histórico y solapamientos.

- [ ] **Step 2: Ejecutar RED y commit**

```bash
cd backend && npm test -- propina-reportes.service.spec.ts --runInBand
```

Expected: FAIL porque el service no existe.

```bash
git add backend/src/modules/propinas/propina-reportes.service.spec.ts
git commit -m "test(propinas): cubrir resumen agregado F"
```

- [ ] **Step 3: Implementar filtros SQL reutilizables**

En `propina-reportes.service.ts`, declarar:

```typescript
@Injectable()
export class PropinaReportesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private filtrosVenta(
    tenantId: string,
    rango: RangoReporteNormalizado,
    zonaHoraria: string,
    alias = 'vp',
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [
      tenantId,
      rango.desde,
      rango.hasta,
      zonaHoraria,
    ];
    let sql = ` AND ${alias}.tenant_id = $1
      AND ${alias}.eliminado_el IS NULL
      AND ${alias}.creado_el >= ($2::date::timestamp AT TIME ZONE $4)
      AND ${alias}.creado_el < ($3::date::timestamp AT TIME ZONE $4)`;
    if (rango.turnoIds.length) {
      params.push(rango.turnoIds);
      sql += ` AND ${alias}.turno_id = ANY($${params.length}::uuid[])`;
    }
    if (rango.tipoGarzon) {
      params.push(rango.tipoGarzon);
      sql += ` AND ${alias}.tipo_garzon = $${params.length}`;
    }
    return { sql, params };
  }
}
```

Todas las consultas deben conservar `$1 = tenantId`; `$2/$3` son fechas calendario
y `$4` es la zona horaria. Esto permite que el test inspeccione aislamiento y
conversión sin interpolación.

- [ ] **Step 4: Implementar consultas del resumen**

Implementar métodos privados:

```typescript
private async zonaHoraria(tenantId: string): Promise<string>
private async cobranzaYEstado(tenantId: string, rango: RangoReporteNormalizado, zona: string): Promise<CobranzaRow>
private async anulaciones(tenantId: string, rango: RangoReporteNormalizado, zona: string): Promise<AnulacionRow>
private async tendencia(tenantId: string, rango: RangoReporteNormalizado, zona: string): Promise<TendenciaRow[]>
private async porTurno(tenantId: string, rango: RangoReporteNormalizado, zona: string): Promise<TurnoRow[]>
private async porTipo(tenantId: string, rango: RangoReporteNormalizado, zona: string): Promise<TipoRow[]>
private async solapadas(tenantId: string, rango: RangoReporteNormalizado, zona: string): Promise<number>
```

La query de zona horaria usa la ruta real:

```sql
SELECT p.zona_horaria_principal AS zona_horaria
FROM tenants t
JOIN provincia pr ON pr.provincia_id = t.provincia_id
  AND pr.eliminado_el IS NULL
JOIN pais p ON p.pais_id = pr.pais_id
  AND p.eliminado_el IS NULL
WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
```

La query central usa CTEs y `EXISTS` para evitar duplicar una tip incluida en más
de un borrador:

```sql
WITH base AS (
  SELECT vp.*
  FROM venta_propina vp
  WHERE 1 = 1 /* anexar filtrosVenta */
),
clasificada AS (
  SELECT b.*,
    EXISTS (
      SELECT 1
      FROM liquidacion_propinas_fuente f
      JOIN liquidacion_propinas l
        ON l.liquidacion_propinas_id = f.liquidacion_id
       AND l.tenant_id = $1
       AND l.estado = 'borrador'
       AND l.eliminado_el IS NULL
      WHERE f.tenant_id = $1
        AND f.venta_propina_id = b.venta_propina_id
        AND f.eliminado_el IS NULL
    ) AS en_borrador,
    EXISTS (
      SELECT 1
      FROM liquidacion_propinas l
      WHERE l.liquidacion_propinas_id = b.liquidacion_id
        AND l.tenant_id = $1
        AND l.estado = 'confirmada'
        AND l.eliminado_el IS NULL
    ) AS liquidada_confirmada
  FROM base b
)
SELECT
  COUNT(*)::text AS cierres,
  COUNT(*) FILTER (WHERE monto_pagado > 0)::text AS con_propina,
  COUNT(*) FILTER (WHERE monto_pagado = 0)::text AS sin_propina,
  COUNT(*) FILTER (
    WHERE monto_pagado > 0 AND monto_pagado = monto_sugerido
  )::text AS sugerencia_aceptada,
  COALESCE(SUM(monto_pagado), 0)::text AS monto_cobrado,
  COALESCE(SUM(monto_sugerido), 0)::text AS monto_sugerido,
  COALESCE(
    SUM(monto_pagado) FILTER (WHERE monto_pagado > 0)
    / NULLIF(COUNT(*) FILTER (WHERE monto_pagado > 0), 0), 0
  )::text AS promedio_con_propina,
  COALESCE(
    COUNT(*) FILTER (WHERE monto_pagado > 0)::numeric / NULLIF(COUNT(*), 0), 0
  )::text AS tasa_con_propina,
  COALESCE(
    COUNT(*) FILTER (
      WHERE monto_pagado > 0 AND monto_pagado = monto_sugerido
    )::numeric / NULLIF(COUNT(*) FILTER (WHERE monto_pagado > 0), 0), 0
  )::text AS tasa_sugerencia_aceptada,
  COUNT(*) FILTER (
    WHERE monto_pagado > 0 AND liquidacion_id IS NULL AND NOT en_borrador
  )::text AS pendiente_libre_cantidad,
  COALESCE(SUM(monto_pagado) FILTER (
    WHERE monto_pagado > 0 AND liquidacion_id IS NULL AND NOT en_borrador
  ), 0)::text AS pendiente_libre_monto,
  COUNT(*) FILTER (
    WHERE monto_pagado > 0 AND liquidacion_id IS NULL AND en_borrador
  )::text AS en_borrador_cantidad,
  COALESCE(SUM(monto_pagado) FILTER (
    WHERE monto_pagado > 0 AND liquidacion_id IS NULL AND en_borrador
  ), 0)::text AS en_borrador_monto,
  COUNT(*) FILTER (WHERE monto_pagado > 0 AND liquidada_confirmada)::text
    AS liquidada_cantidad,
  COALESCE(SUM(monto_pagado) FILTER (
    WHERE monto_pagado > 0 AND liquidada_confirmada
  ), 0)::text AS liquidada_monto
FROM clasificada
```

Anulaciones suma `f.monto_pagado` una vez por fuente activa de liquidaciones
`anulada`, completamente contenidas y del mismo tenant. Solapadas cuenta
liquidaciones `confirmada` o `anulada` con intersección no vacía que no estén
completamente contenidas:

```sql
l.fecha_desde < ($3::date::timestamp AT TIME ZONE $4)
AND l.fecha_hasta > ($2::date::timestamp AT TIME ZONE $4)
AND NOT (
  l.fecha_desde >= ($2::date::timestamp AT TIME ZONE $4)
  AND l.fecha_hasta <= ($3::date::timestamp AT TIME ZONE $4)
)
```

Tendencia genera fechas con:

```sql
generate_series(
  $2::date,
  ($3::date - 1),
  interval '1 day'
)
```

y hace `LEFT JOIN` a una agregación de `venta_propina` por
`(vp.creado_el AT TIME ZONE $4)::date`. `porTurno` hace `LEFT JOIN turnos` con
tenant y soft-delete; `porTipo` agrupa el snapshot `vp.tipo_garzon`.

- [ ] **Step 5: Implementar `resumen` y mappers**

Usar `Promise.all` después de obtener zona horaria. Convertir conteos con helper
local:

```typescript
const count = (value: string | number | null): number => Number(value ?? 0);
const decimal = (value: string | null): string => value ?? '0';
```

`resumen` debe retornar exactamente `PropinaReporteResumen`, conservar el período
original `YYYY-MM-DD`, etiquetar turno faltante como
`Sin turno` y no realizar cálculos financieros en JS.

- [ ] **Step 6: Ejecutar GREEN y commit**

```bash
cd backend && npm test -- propina-reportes.service.spec.ts --runInBand
```

Expected: PASS.

```bash
git add backend/src/modules/propinas/propina-reportes.service.ts
git commit -m "feat(propinas): agregar resumen agregado F"
```

---

### Task 3: Reporte por trabajador y exposición HTTP

**Files:**
- Modify: `backend/src/modules/propinas/propina-reportes.service.spec.ts`
- Modify: `backend/src/modules/propinas/propina-reportes.service.ts`
- Create: `backend/src/modules/propinas/propina-reportes.controller.ts`
- Modify: `backend/src/modules/propinas/propinas.module.ts`

**Interfaces:**
- Produces: `PropinaReportesService.trabajadores(tenantId, query): Promise<PropinaReporteTrabajadores>`.
- Produces: `GET /propinas/reportes/resumen` y `GET /propinas/reportes/trabajadores`.

- [ ] **Step 1: Agregar tests RED de trabajadores**

Cubrir como mínimo:

```typescript
it('une originadores y participantes, suma solo incluidos confirmados', async () => {
  // mock de origen: Camila; mock de asignación: Camila y Pedro
  // participante excluido no viene de la query
  const result = await service.trabajadores(TENANT_ID, QUERY);
  expect(result.data.map((x) => x.nombre)).toEqual(['Camila', 'Pedro']);
  expect(result.totales.montoOriginado).toBe('220000');
  expect(result.totales.montoAsignado).toBe('300000');
});

it('con filtro de turno excluye liquidaciones de todos los turnos', async () => {
  const result = await service.trabajadores(TENANT_ID, {
    ...QUERY,
    turnoIds: [TURNO_ID],
  });
  expect(result.advertencias.liquidacionesTodosLosTurnosExcluidas).toBe(2);
});

it('ordena por monto asignado desc y nombre asc', async () => {
  const result = await service.trabajadores(TENANT_ID, QUERY);
  expect(result.data.map((x) => x.nombre)).toEqual(['Ana', 'Camila', 'Pedro']);
});
```

- [ ] **Step 2: Ejecutar RED y commit**

```bash
cd backend && npm test -- propina-reportes.service.spec.ts --runInBand
```

Expected: FAIL porque `trabajadores` no existe.

```bash
git add backend/src/modules/propinas/propina-reportes.service.spec.ts
git commit -m "test(propinas): cubrir reporte F por trabajador"
```

- [ ] **Step 3: Implementar agregados de origen y asignación**

`origenTrabajadores` agrupa la misma base filtrada por:

```sql
SELECT vp.garzon_id,
  MAX(vp.tipo_garzon) AS tipo_garzon,
  COUNT(*)::text AS cierres,
  COUNT(*) FILTER (WHERE vp.monto_pagado > 0)::text AS con_propina,
  COALESCE(SUM(vp.monto_pagado), 0)::text AS monto
FROM venta_propina vp
WHERE 1 = 1 /* filtrosVenta */
GROUP BY vp.garzon_id
```

`asignacionTrabajadores` usa:

```sql
SELECT p.garzon_id,
  MAX(p.tipo_garzon) AS tipo_garzon,
  COALESCE(SUM(p.monto), 0)::text AS monto,
  COALESCE(SUM(p.horas), 0)::text AS horas,
  COALESCE(SUM(p.ventas_base), 0)::text AS ventas_base,
  COALESCE(SUM(p.cuentas), 0)::text AS cuentas,
  COUNT(DISTINCT l.liquidacion_propinas_id)::text AS liquidaciones,
  MAX(l.confirmado_el) AS ultima_liquidacion_el
FROM liquidacion_propinas_participante p
JOIN liquidacion_propinas l
  ON l.liquidacion_propinas_id = p.liquidacion_id
 AND l.tenant_id = $1
 AND l.estado = 'confirmada'
 AND l.eliminado_el IS NULL
WHERE p.tenant_id = $1
  AND p.eliminado_el IS NULL
  AND p.incluido = true
  AND l.fecha_desde >= ($2::date::timestamp AT TIME ZONE $4)
  AND l.fecha_hasta <= ($3::date::timestamp AT TIME ZONE $4)
  /* tipo: p.tipo_garzon = $n */
  /* turnos: cardinality(l.turno_ids) > 0 AND l.turno_ids <@ $n::uuid[] */
GROUP BY p.garzon_id
```

La query de etiquetas lee `garzones` sin filtrar `eliminado_el` pero siempre por
tenant e IDs parametrizados. No exponer `pin_hash`.

Unir ambos mapas por `garzonId`. Elegir tipo de asignación, luego origen, luego
`garzones.tipo`. Usar ceros string para el lado ausente. Ordenar con Decimal:

```typescript
data.sort((a, b) => {
  const byAmount = new Decimal(b.asignacionConfirmada.monto)
    .cmp(a.asignacionConfirmada.monto);
  return byAmount || a.nombre.localeCompare(b.nombre, 'es');
});
```

Totales se calculan con `Decimal.sum` sobre los strings retornados y
`toFixed()`/`toString()`, nunca `Number`.

- [ ] **Step 4: Implementar advertencias de trabajadores**

- Reutilizar el conteo de liquidaciones parcialmente solapadas.
- Cuando hay `turnoIds`, contar liquidaciones confirmadas contenidas con
  `cardinality(turno_ids) = 0`; sin filtro retornar `0`.
- Toda query conserva `$1 = tenantId`.

- [ ] **Step 5: Crear controller y registrar módulo**

Crear `propina-reportes.controller.ts`:

```typescript
@ApiTags('propinas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('propinas/reportes')
export class PropinaReportesController {
  constructor(private readonly reportes: PropinaReportesService) {}

  @Get('resumen')
  @RequiresPermiso('Propinas', 'Leer')
  resumen(@Req() req: Request, @Query() query: QueryPropinaReporteDto) {
    const user = req.user as JwtUser;
    return this.reportes.resumen(user.tenantId!, query);
  }

  @Get('trabajadores')
  @RequiresPermiso('Propinas', 'Leer')
  trabajadores(@Req() req: Request, @Query() query: QueryPropinaReporteDto) {
    const user = req.user as JwtUser;
    return this.reportes.trabajadores(user.tenantId!, query);
  }
}
```

Agregar imports requeridos de Nest, Express, guards/decorator/`JwtUser`, DTO y
service. En `propinas.module.ts`:

```typescript
controllers: [
  PropinaDistribucionController,
  LiquidacionPropinasController,
  PropinaReportesController,
],
providers: [
  VentaPropinaService,
  PropinaDistribucionService,
  LiquidacionPropinasService,
  PropinaReportesService,
],
```

No exportar `PropinaReportesService`: ningún módulo externo lo consume.

- [ ] **Step 6: Ejecutar GREEN, build y commit**

```bash
cd backend
npm test -- query-propina-reporte.dto.spec.ts propina-reportes.service.spec.ts --runInBand
npm run build
```

Expected: tests PASS y build exit 0.

```bash
git add backend/src/modules/propinas/propina-reportes.service.ts \
  backend/src/modules/propinas/propina-reportes.controller.ts \
  backend/src/modules/propinas/propinas.module.ts
git commit -m "feat(propinas): exponer reportes F por trabajador"
```

---

### Task 4: Composable tipado y caché por tab

**Files:**
- Create: `frontend/app/composables/usePropinaReportes.ts`
- Create: `frontend/app/composables/usePropinaReportes.spec.ts`

**Interfaces:**
- Produces: tipos espejo de backend, `serializarFiltrosReporte`,
  `crearCachePropinaReportes`, `usePropinaReportes`.
- Consumes: `useApiFetch`.

- [ ] **Step 1: Escribir tests RED**

```typescript
describe('serializarFiltrosReporte', () => {
  it('serializa fechas calendario, ordena turnos y omite filtros vacíos', () => {
    expect(serializarFiltrosReporte({
      desde: '2026-07-01',
      hasta: '2026-07-31',
      turnoIds: ['b', 'a'],
      tipoGarzon: undefined,
    })).toEqual({
      desde: '2026-07-01',
      hasta: '2026-08-01',
      turnoIds: 'a,b',
    });
  });
});

describe('crearCachePropinaReportes', () => {
  it('cachea cada tab por clave y aplicar invalida ambos', () => {
    const cache = crearCachePropinaReportes();
    cache.set('resumen', 'clave', { cobranza: {} } as PropinaReporteResumen);
    expect(cache.get('resumen', 'clave')).toBeTruthy();
    expect(cache.get('trabajadores', 'clave')).toBeUndefined();
    cache.clear();
    expect(cache.get('resumen', 'clave')).toBeUndefined();
  });
});
```

Agregar prueba para `hasta` exclusivo, clave estable y fechas inválidas.

- [ ] **Step 2: Ejecutar RED y commit**

```bash
cd frontend && npm test -- --run app/composables/usePropinaReportes.spec.ts
```

Expected: FAIL porque el composable no existe.

```bash
git add frontend/app/composables/usePropinaReportes.spec.ts
git commit -m "test(frontend): definir filtros y caché de reportes F"
```

- [ ] **Step 3: Implementar tipos y serialización**

Copiar exactamente los contratos camelCase de `propina-reportes.types.ts`.
Definir:

```typescript
export type ReporteTab = 'resumen' | 'trabajadores';

export interface PropinaReporteFiltrosUi {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD inclusivo en UI
  turnoIds: string[];
  tipoGarzon?: 'garzon' | 'cocina' | 'barra';
}

export function serializarFiltrosReporte(filtros: PropinaReporteFiltrosUi) {
  if (!filtros.desde || !filtros.hasta) {
    throw new Error('Selecciona un rango de fechas');
  }
  const desdeMs = Date.parse(`${filtros.desde}T00:00:00.000Z`);
  const hastaInclusivoMs = Date.parse(`${filtros.hasta}T00:00:00.000Z`);
  if (hastaInclusivoMs < desdeMs) {
    throw new Error('La fecha hasta debe ser igual o posterior a desde');
  }
  const hasta = new Date(hastaInclusivoMs);
  hasta.setUTCDate(hasta.getUTCDate() + 1);
  return {
    desde: filtros.desde,
    hasta: hasta.toISOString().slice(0, 10),
    ...(filtros.turnoIds.length
      ? { turnoIds: [...filtros.turnoIds].sort().join(',') }
      : {}),
    ...(filtros.tipoGarzon ? { tipoGarzon: filtros.tipoGarzon } : {}),
  };
}
```

El cliente envía fechas calendario sin zona. El backend las convierte a
medianoche usando `pais.zona_horaria_principal`, por lo que el resultado no
depende de la zona del dispositivo del administrador.

- [ ] **Step 4: Implementar caché y API**

```typescript
export function crearCachePropinaReportes() {
  const resumen = new Map<string, PropinaReporteResumen>();
  const trabajadores = new Map<string, PropinaReporteTrabajadores>();
  return {
    get(tab: ReporteTab, key: string) {
      return tab === 'resumen' ? resumen.get(key) : trabajadores.get(key);
    },
    set(tab: ReporteTab, key: string, value: PropinaReporteResumen | PropinaReporteTrabajadores) {
      if (tab === 'resumen') resumen.set(key, value as PropinaReporteResumen);
      else trabajadores.set(key, value as PropinaReporteTrabajadores);
    },
    clear() {
      resumen.clear();
      trabajadores.clear();
    },
  };
}
```

En `usePropinaReportes`, construir query con `URLSearchParams`, no interpolar
valores manualmente:

```typescript
const resumen = (filtros: PropinaReporteFiltrosUi) =>
  useApiFetch<PropinaReporteResumen>(
    `${apiUrl}/propinas/reportes/resumen?${params(filtros)}`,
  );

const trabajadores = (filtros: PropinaReporteFiltrosUi) =>
  useApiFetch<PropinaReporteTrabajadores>(
    `${apiUrl}/propinas/reportes/trabajadores?${params(filtros)}`,
  );
```

Retornar `{ resumen, trabajadores, cache, claveFiltros }`, donde
`claveFiltros = JSON.stringify(serializarFiltrosReporte(filtros))`.

- [ ] **Step 5: Ejecutar GREEN y commit**

```bash
cd frontend && npm test -- --run app/composables/usePropinaReportes.spec.ts
```

Expected: PASS.

```bash
git add frontend/app/composables/usePropinaReportes.ts
git commit -m "feat(frontend): agregar cliente de reportes F"
```

---

### Task 5: Página operativa Resumen + Por trabajador

**Files:**
- Create: `frontend/app/pages/propinas/reportes.vue`
- Modify: `frontend/app/layouts/dashboard.vue`

**Interfaces:**
- Consumes: `usePropinaReportes`, `useTurnos`, `useFormatters`,
  `Propinas:Leer`.
- Produces: ruta `/propinas/reportes`.

- [ ] **Step 1: Crear estado y flujo de carga**

En `reportes.vue`:

```typescript
definePageMeta({ middleware: 'auth', layout: 'dashboard' });

const route = useRoute();
const router = useRouter();
const permissions = usePermissionsStore();
const reportesApi = usePropinaReportes();
const turnosApi = useTurnos();
const { formatMonto, formatFecha, formatPorcentaje } = useFormatters();

const tab = ref<'resumen' | 'trabajadores'>(
  route.query.tab === 'trabajadores' ? 'trabajadores' : 'resumen',
);
const filtros = ref<PropinaReporteFiltrosUi>(filtrosIniciales(route.query));
const resumen = ref<PropinaReporteResumen | null>(null);
const trabajadores = ref<PropinaReporteTrabajadores | null>(null);
const turnos = ref<Turno[]>([]);
const loading = ref(false);
const error = ref('');
```

`filtrosIniciales` usa query params válidos o últimos 30 días. Implementar
`cargarTab({ force = false })`:

1. construir clave;
2. usar caché si existe y `force` es falso;
3. limpiar error y activar loading;
4. consultar solo el tab activo;
5. guardar respuesta y caché;
6. mostrar `apiErrorMsg` en `error`;
7. desactivar loading.

`aplicar()` hace `cache.clear()`, actualiza query params con `router.replace` y
llama `cargarTab({ force: true })`. Un `watch(tab)` actualiza `tab` en URL y carga
el nuevo tab sin invalidar caché.

- [ ] **Step 2: Construir shell y filtros**

Template obligatorio:

```vue
<UDashboardPanel>
  <template #header>
    <AppNavbar title="Reportes de propinas" />
  </template>
  <template #body>
    <div class="space-y-6">
      <CrudPageHeader
        title="Reportes de propinas"
        description="Revisa la cobranza, el estado de liquidación y la distribución por trabajador."
      />
      <UCard>
        <div class="grid gap-4 md:grid-cols-5">
          <UFormField label="Desde">
            <AppDateInput v-model="filtros.desde" />
          </UFormField>
          <UFormField label="Hasta">
            <AppDateInput v-model="filtros.hasta" />
          </UFormField>
          <UFormField label="Turnos">
            <USelectMenu
              v-model="filtros.turnoIds"
              multiple
              :items="turnoOptions"
              value-key="value"
              placeholder="Todos"
            />
          </UFormField>
          <UFormField label="Tipo">
            <USelect
              v-model="filtros.tipoGarzon"
              :items="tipoOptions"
              value-key="value"
              placeholder="Todos"
            />
          </UFormField>
          <div class="flex items-end">
            <UButton
              class="w-full justify-center"
              icon="i-lucide-filter"
              label="Aplicar"
              :loading="loading"
              @click="aplicar"
            />
          </div>
        </div>
      </UCard>
      <UTabs v-model="tab" :items="tabItems" />
      <!-- contenido -->
    </div>
  </template>
</UDashboardPanel>
```

Antes de cargar, redirigir a `/` si no es admin ni tiene `Propinas:Leer`.

- [ ] **Step 3: Implementar tab Resumen**

Renderizar:

- cuatro cards principales: Cobrado, Pendiente, Liquidado, Ventas con propina;
- tres cards secundarias: Aceptación sugerida, Promedio, Liberado por anulación;
- tendencia diaria como lista de barras con ancho calculado sobre el máximo;
- tablas por turno y por tipo.

El ancho visual puede usar `Number(monto)` **solo para proporción gráfica no
financiera**; los textos siempre usan el string original con `formatMonto`.
Proteger máximo cero para devolver `0%`.

El pendiente mostrado se suma con Decimal.js:

```typescript
const pendienteTotal = computed(() =>
  resumen.value
    ? new Decimal(resumen.value.estadoActual.pendienteLibreMonto)
        .plus(resumen.value.estadoActual.enBorradorMonto)
        .toString()
    : '0',
);
```

Agregar `aria-label` a cada barra con fecha y monto. Usar `bg-elevated`,
`bg-muted`, `text-default`, `text-muted`, `border-default`; no hardcodear grises.

- [ ] **Step 4: Implementar tab Por trabajador**

Definir `TableColumn<PropinaReporteTrabajador>[]` para:

- trabajador + badge tipo;
- originado;
- asignado;
- horas;
- ventas base;
- cuentas;
- liquidaciones;
- última confirmación.

Usar `CrudTable`. En el slot `empty`, mostrar el copy de la spec. Encima de la
tabla, cards compactas con trabajadores, monto originado, monto asignado y horas.
En móvil ocultar ventas/cuentas/última mediante `meta.class` responsive y mostrar
un subtítulo compacto en la celda trabajador.

- [ ] **Step 5: Implementar estados y advertencias**

- `UAlert color="error"` persistente con botón Reintentar.
- Skeleton/loading de Nuxt UI mientras no hay respuesta.
- Empty state de Resumen cuando `cierres === 0`.
- `UAlert color="warning"` si cualquier contador de advertencia es mayor a cero.
- Copy de advertencia explica exclusión, no la presenta como error.

- [ ] **Step 6: Convertir Propinas en navegación anidada**

En `dashboard.vue`, reemplazar el link simple por:

```typescript
base.push({
  label: 'Propinas',
  icon: 'i-lucide-hand-coins',
  defaultOpen: route.path.startsWith('/propinas'),
  children: [
    {
      label: 'Liquidaciones',
      icon: 'i-lucide-hand-coins',
      to: '/propinas/liquidaciones',
    },
    {
      label: 'Reportes',
      icon: 'i-lucide-chart-no-axes-combined',
      to: '/propinas/reportes',
    },
  ],
});
```

Mantener la condición existente `esAdmin || can('Propinas', 'Leer')`.

- [ ] **Step 7: Build frontend y commit**

```bash
cd frontend
npm test -- --run app/composables/usePropinaReportes.spec.ts
npm run build
```

Expected: tests PASS y build exit 0.

```bash
git add frontend/app/pages/propinas/reportes.vue frontend/app/layouts/dashboard.vue
git commit -m "feat(frontend): mostrar reportes agregados de propinas"
```

---

### Task 6: Verificación SQL, documentación viva y cierre

**Files:**
- Create: `docs/features/reportes-propinas.md`
- Modify: `docs/README.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-07-17-reportes-propinas-f-design.md`

**Interfaces:**
- Consumes: feature backend/frontend terminada.
- Produces: documentación y evidencia final.

- [ ] **Step 1: Verificar planes SQL en PostgreSQL**

Con datos de desarrollo, ejecutar `EXPLAIN (ANALYZE, BUFFERS)` para:

1. query central de cobranza/estado;
2. asignación por trabajador;
3. tendencia diaria.

Expected: sin sequential scan desproporcionado sobre
`venta_propina`, `liquidacion_propinas_participante` o fuentes para el volumen
seed. Si el planner demuestra necesidad, agregar únicamente el índice candidato
correspondiente a la spec en `startup-pos.sql` y una migración/DDL idempotente
siguiendo el mecanismo actual del repositorio. Si no, no tocar esquema.

- [ ] **Step 2: Ejecutar pruebas y cobertura**

```bash
cd backend
npm test -- query-propina-reporte.dto.spec.ts propina-reportes.service.spec.ts --runInBand
npm run test:cov -- --runInBand
npm run build

cd ../frontend
npm test -- --run app/composables/usePropinaReportes.spec.ts
npm run build
```

Expected: todo PASS, builds exit 0 y archivos nuevos con cobertura >= 80%.

- [ ] **Step 3: Verificación manual**

1. Abrir `/propinas/reportes` como admin.
2. Confirmar preset de 30 días y query params.
3. Verificar que solo se llama `/resumen` en el primer tab.
4. Cambiar a trabajadores y verificar una sola llamada adicional.
5. Volver a Resumen y confirmar caché sin request.
6. Aplicar filtros y confirmar invalidación/carga del tab activo.
7. Revisar tip sugerida, manual, sin propina, borrador, confirmada, anulada y
   reliquidada.
8. Verificar warning con liquidación parcialmente solapada.
9. Probar usuario con `Propinas:Leer` y usuario sin permiso.
10. Confirmar responsive y dark mode.

- [ ] **Step 4: Crear documentación de feature**

Crear `docs/features/reportes-propinas.md` desde `TEMPLATE.md`, incluyendo:

- Why / alcance.
- Rutas y permiso.
- Semántica de período para cobranza vs asignación.
- Definiciones de cada KPI.
- Advertencias y limitación de no prorratear.
- Archivos principales.
- Pasos de prueba manual.

Añadir link en `docs/README.md`; marcar
“F — reportes agregados de propinas” implementado con fecha 2026-07-17 en
`docs/ESTADO.md`; añadir controller/service/composable/página a
`docs/ARCHITECTURE.md`; cambiar la spec a `**Status**: Done`.

- [ ] **Step 5: Lint final**

```bash
cd backend && npm run lint
cd ../frontend && npm run build
git diff --check
```

Expected: exit 0. Revisar que lint no haya modificado archivos ajenos al alcance.

- [ ] **Step 6: Commit de cierre**

```bash
git add docs/features/reportes-propinas.md docs/README.md docs/ESTADO.md \
  docs/ARCHITECTURE.md \
  docs/superpowers/specs/2026-07-17-reportes-propinas-f-design.md
git commit -m "docs(propinas): documentar reportes agregados F"
git status --short
```

Expected: working tree limpio.

