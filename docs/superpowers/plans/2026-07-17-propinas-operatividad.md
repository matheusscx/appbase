# Propinas — Operatividad práctica: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la operatividad de propinas por una sola pantalla (ver fondo → reparto en vivo por grupo/persona → liquidar → imprimir), con reportes reducidos a 2 métricas.

**Architecture:** Se reutiliza el motor de liquidación existente. En backend se extrae el cálculo del reparto a piezas puras reutilizables, se agrega un endpoint `preview` que calcula sin persistir y un endpoint `liquidar` que crea+confirma atómicamente aplicando ajustes. En frontend se reescribe `/propinas` a una pantalla operativa, se agrega una ruta imprimible (PDF/A4) y se elimina el panel de reportes pesado. La configuración de distribución y la lógica de cálculo NO se tocan.

**Tech Stack:** NestJS + TypeORM (backend, jest), Nuxt 4 + Vue 3 + Nuxt UI (frontend, vitest), Decimal.js para toda aritmética.

**Spec:** `docs/superpowers/specs/2026-07-17-propinas-operatividad-design.md`

## Global Constraints

- Toda aritmética de dinero/porcentaje usa **Decimal.js**, nunca `number` nativo. Montos con `.toFixed(4)`.
- Porcentajes en decimal (`0.10` = 10%).
- `tenantId`/`usuarioId` SIEMPRE del token (`req.user`), nunca del body.
- Soft delete: toda lectura filtra `eliminado_el IS NULL`.
- Columnas UUID PK/FK declaran `type: 'uuid'` explícito (ADR-004) — no aplica a código nuevo aquí porque no se crean entidades nuevas.
- Frontend: tokens semánticos de Nuxt UI (`text-muted`, `bg-default`, `divide-default`), nunca Tailwind hardcodeado. Formato con `useFormatters` (`formatMonto`, `formatFecha`, `formatPorcentaje`), nunca funciones locales.
- Anti-patrón prohibido: mutar y luego recargar la lista. El backend devuelve la entidad; el front actualiza el `ref` local.
- Permisos: `Propinas`/`Leer` para lectura y preview; `Propinas`/`Liquidar` para liquidar/anular.
- No crear ramas ni PRs: commits directos sobre `main`.

## File Structure

**Backend (`backend/src/modules/propinas/`):**
- `liquidacion-propinas.service.ts` — MODIFICAR: extraer piezas puras (`montosPorGrupo`, `buildParticipantesData`, `construirBorrador`, `confirmarEnTransaccion`), agregar `computarReparto`, `aplicarAjustesEnMemoria`, `aplicarAjustesPersistido`, `liquidar`, y el tipo `PreviewReparto`.
- `dto/preview-liquidacion.dto.ts` — CREAR: DTO de preview (período + turnos + ajustes).
- `dto/liquidar.dto.ts` — CREAR: DTO de liquidar (período + turnos + ajustes).
- `dto/ajustes-reparto.dto.ts` — CREAR: `AjustesRepartoDto` compartido (exclusiones + montosManuales).
- `liquidacion-propinas.controller.ts` — MODIFICAR: endpoints `POST /preview` y `POST /liquidar`.

**Frontend (`frontend/app/`):**
- `composables/usePropinaLiquidaciones.ts` — MODIFICAR: tipos `PreviewReparto`, `AjustesReparto` y métodos `preview`, `liquidar`.
- `composables/usePropinaResumen.ts` — CREAR: fetch mínimo de las 2 métricas.
- `composables/usePropinaImpresion.ts` — CREAR: helpers puros para agrupar el detalle imprimible.
- `pages/propinas/index.vue` — REESCRIBIR: pantalla operativa (métricas + selector + reparto en vivo + liquidar + historial).
- `pages/propinas/liquidaciones/[id]/imprimir.vue` — CREAR: vista imprimible (`?tipo=persona|resumen|grupo`).
- `components/PropinaReportesPanel.vue` — ELIMINAR.
- `composables/usePropinaReportes.ts` — ELIMINAR (ya no se consume desde el front).
- `pages/propinas/reportes.vue` — ELIMINAR (redirect obsoleto).
- `pages/propinas/liquidaciones/[id].vue` — ELIMINAR (reemplazado por historial + vista imprimible).
- `pages/propinas/liquidaciones/index.vue` — MODIFICAR: redirect a `/propinas`.

**Docs:**
- `docs/features/propinas.md` (o el que exista) + `docs/ESTADO.md` — actualizar.

---

## Task 1: Backend — extraer piezas puras del cálculo (sin cambiar comportamiento)

Refactor de bajo riesgo: extraer del `service` las piezas que hoy están acopladas a `manager.save`, dejando los tests existentes en verde. No agrega features; habilita las tareas 2 y 3.

**Files:**
- Modify: `backend/src/modules/propinas/liquidacion-propinas.service.ts`
- Test: `backend/src/modules/propinas/liquidacion-propinas.service.spec.ts` (existente, debe seguir pasando)

**Interfaces:**
- Produces:
  - `type ParticipanteData = Omit<LiquidacionPropinasParticipante, 'id' | 'creadoEl' | 'actualizadoEl' | 'eliminadoEl'>`
  - `private montosPorGrupo(poolTotal: string, gruposConfig: GrupoDistribucionPublico[], decimales: number): Map<string, string>` (clave = `gConfig.id`)
  - `private buildParticipantesData(tenantId: string, liquidacionId: string, grupos: LiquidacionPropinasGrupo[], gruposConfig: GrupoDistribucionPublico[], tips: TipElegibleRow[], sesiones: SesionRow[], fechaDesde: Date, fechaHasta: Date, decimales: number): ParticipanteData[]`

- [ ] **Step 1: Verificar baseline verde**

Run: `cd backend && npm test -- liquidacion-propinas.service`
Expected: PASS (baseline antes de tocar nada).

- [ ] **Step 2: Extraer `montosPorGrupo`**

En `liquidacion-propinas.service.ts`, agregar el método privado y usarlo desde `crearSnapshotGrupos` (reemplaza el cálculo inline actual, mismo resultado):

```typescript
private montosPorGrupo(
  poolTotal: string,
  gruposConfig: GrupoDistribucionPublico[],
  decimales: number,
): Map<string, string> {
  return new Map(
    repartirMayoresRestos(
      poolTotal,
      gruposConfig.map((g) => ({ id: g.id, peso: g.porcentaje })),
      decimales,
    ).map((r) => [r.id, new Decimal(r.monto).toFixed(4)] as const),
  );
}
```

Y en `crearSnapshotGrupos`, reemplazar el bloque `const montosGrupo = new Map(repartirMayoresRestos(...))` por:

```typescript
const montosGrupo = this.montosPorGrupo(poolTotal, gruposConfig, decimales);
```

(el resto de `crearSnapshotGrupos` queda igual; `montosGrupo.get(g.id)` sigue funcionando).

- [ ] **Step 3: Extraer `buildParticipantesData` y reusarlo en `crearParticipantes`**

Agregar el alias de tipo cerca de los otros tipos del archivo (después de `SesionRow`):

```typescript
export type ParticipanteData = Omit<
  LiquidacionPropinasParticipante,
  'id' | 'creadoEl' | 'actualizadoEl' | 'eliminadoEl'
>;
```

Agregar el método puro (es el cuerpo actual de `crearParticipantes` pero devolviendo data en vez de guardar):

```typescript
private buildParticipantesData(
  tenantId: string,
  liquidacionId: string,
  grupos: LiquidacionPropinasGrupo[],
  gruposConfig: GrupoDistribucionPublico[],
  tips: TipElegibleRow[],
  sesiones: SesionRow[],
  fechaDesde: Date,
  fechaHasta: Date,
  decimales: number,
): ParticipanteData[] {
  const participantes: ParticipanteData[] = [];
  const gruposByTipo = new Map(grupos.map((g) => [g.tipoGarzon, g]));
  const configByTipo = new Map(gruposConfig.map((g) => [g.tipoGarzon, g]));

  for (const [tipo, grupo] of gruposByTipo.entries()) {
    const config = configByTipo.get(tipo);
    if (!config) continue;
    const garzonIds = this.garzonesGrupo(tipo, tips, sesiones);
    const borradores = garzonIds.map((garzonId) =>
      this.crearParticipanteData({
        tenantId,
        liquidacionId,
        grupo,
        config,
        garzonId,
        tips,
        sesiones,
        fechaDesde,
        fechaHasta,
      }),
    );
    participantes.push(...this.repartirGrupo(grupo, config, borradores, decimales));
  }
  return participantes;
}
```

Reemplazar el cuerpo de `crearParticipantes` para que use el builder y solo persista:

```typescript
private async crearParticipantes(
  manager: EntityManager,
  tenantId: string,
  liquidacionId: string,
  grupos: LiquidacionPropinasGrupo[],
  gruposConfig: GrupoDistribucionPublico[],
  tips: TipElegibleRow[],
  sesiones: SesionRow[],
  fechaDesde: Date,
  fechaHasta: Date,
  decimales: number,
): Promise<LiquidacionPropinasParticipante[]> {
  const data = this.buildParticipantesData(
    tenantId, liquidacionId, grupos, gruposConfig, tips, sesiones,
    fechaDesde, fechaHasta, decimales,
  );
  const participantes: LiquidacionPropinasParticipante[] = [];
  for (const d of data) {
    participantes.push(
      await manager.save(
        LiquidacionPropinasParticipante,
        manager.create(LiquidacionPropinasParticipante, d),
      ),
    );
  }
  return participantes;
}
```

- [ ] **Step 4: Correr los tests existentes (deben seguir pasando)**

Run: `cd backend && npm test -- liquidacion-propinas.service`
Expected: PASS (el refactor no cambia comportamiento).

- [ ] **Step 5: Lint**

Run: `cd backend && npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/propinas/liquidacion-propinas.service.ts
git commit -m "refactor(propinas): extraer piezas puras del cálculo de reparto"
```

---

## Task 2: Backend — `computarReparto` + endpoint `POST /preview`

Calcula el reparto (fondo, grupos, personas) para un período **sin persistir nada**, aplicando ajustes (exclusiones + montos manuales) en memoria.

**Files:**
- Create: `backend/src/modules/propinas/dto/ajustes-reparto.dto.ts`
- Create: `backend/src/modules/propinas/dto/preview-liquidacion.dto.ts`
- Modify: `backend/src/modules/propinas/liquidacion-propinas.service.ts`
- Modify: `backend/src/modules/propinas/liquidacion-propinas.controller.ts`
- Test: `backend/src/modules/propinas/liquidacion-propinas.service.spec.ts`

**Interfaces:**
- Consumes (Task 1): `montosPorGrupo`, `buildParticipantesData`, `ParticipanteData`.
- Produces:
  - `interface PreviewGrupo { id: string; tipoGarzon: TipoGarzon; nombre: string; porcentaje: string; criterio: CriterioDistribucion; baseVentas: BaseVentasGrupo; manualModo: ManualModo | null; montoGrupo: string; orden: number }`
  - `interface PreviewParticipante { garzonId: string; grupoId: string; tipoGarzon: TipoGarzon; incluido: boolean; horas: string; ventasBase: string; cuentas: string; pesoManual: string | null; monto: string }`
  - `interface PreviewReparto { poolTotal: string; monedaId: string; decimalesMoneda: number; grupos: PreviewGrupo[]; participantes: PreviewParticipante[]; advertencias: string[] }`
  - `interface AjustesReparto { exclusiones?: string[]; montosManuales?: { garzonId: string; monto: string }[] }`
  - `async computarReparto(tenantId: string, fechaDesde: Date, fechaHasta: Date, turnoIds: string[], ajustes?: AjustesReparto): Promise<PreviewReparto>`
  - Endpoint `POST /propinas/liquidaciones/preview` → `PreviewReparto`

- [ ] **Step 1: Crear los DTOs**

`backend/src/modules/propinas/dto/ajustes-reparto.dto.ts`:

```typescript
import {
  IsArray,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MontoManualDto {
  @IsUUID()
  garzonId: string;

  @IsNumberString()
  monto: string;
}

export class AjustesRepartoDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  exclusiones?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MontoManualDto)
  montosManuales?: MontoManualDto[];
}
```

`backend/src/modules/propinas/dto/preview-liquidacion.dto.ts`:

```typescript
import {
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AjustesRepartoDto } from './ajustes-reparto.dto';

export class PreviewLiquidacionDto {
  @IsISO8601()
  fechaDesde: string;

  @IsISO8601()
  fechaHasta: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  turnoIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AjustesRepartoDto)
  ajustes?: AjustesRepartoDto;
}
```

- [ ] **Step 2: Escribir el test que falla (preview sin ajustes calcula el pool y reparte por grupo)**

En `liquidacion-propinas.service.spec.ts`, agregar un test que use los mismos mocks que ya usa el spec para `crear` (reutilizar el helper de setup existente). El test verifica que `computarReparto` devuelve el `poolTotal` como suma de `monto_pagado` y monta grupos/participantes sin escribir en DB:

```typescript
it('computarReparto calcula el pool y reparte sin persistir', async () => {
  // Reusar el setup de mocks del describe (config con 1 grupo GARZON al 100%,
  // criterio PARTES_IGUALES, y 2 tips de 1000 c/u para 2 garzones distintos).
  const result = await service.computarReparto(
    tenantId,
    new Date('2026-07-01T00:00:00Z'),
    new Date('2026-07-08T00:00:00Z'),
    [],
  );

  expect(result.poolTotal).toBe('2000.0000');
  expect(result.grupos).toHaveLength(1);
  expect(result.grupos[0].montoGrupo).toBe('2000.0000');
  expect(result.participantes).toHaveLength(2);
  expect(result.participantes.map((p) => p.monto).sort()).toEqual([
    '1000.0000',
    '1000.0000',
  ]);
  // no se guardó ninguna liquidación
  expect(liquidacionRepoSave).not.toHaveBeenCalled();
});
```

> Nota para el implementador: si el spec actual no expone helpers reutilizables para los mocks de `manager.query` (moneda, tips, sesiones) y `distribucion.obtener`, replicar el patrón que ya usa el test de `crear` en ese archivo. Los tips se devuelven desde el mock de `buscarTipsElegibles` (query raw), la config desde `distribucion.obtener`.

- [ ] **Step 3: Correr el test para verlo fallar**

Run: `cd backend && npm test -- liquidacion-propinas.service -t computarReparto`
Expected: FAIL con "service.computarReparto is not a function".

- [ ] **Step 4: Implementar `computarReparto` + `aplicarAjustesEnMemoria`**

Agregar las interfaces `PreviewGrupo`, `PreviewParticipante`, `PreviewReparto`, `AjustesReparto` cerca de `LiquidacionDetalle`, y los métodos:

```typescript
async computarReparto(
  tenantId: string,
  fechaDesde: Date,
  fechaHasta: Date,
  turnoIds: string[],
  ajustes?: AjustesReparto,
): Promise<PreviewReparto> {
  if (fechaHasta <= fechaDesde) {
    throw new BadRequestException('La fecha hasta debe ser posterior a desde');
  }
  const config = await this.distribucion.obtener(tenantId);
  const gruposConfig = config.grupos.filter((g) => g.activo);
  if (gruposConfig.length === 0) {
    throw new BadRequestException('No hay grupos activos para liquidar');
  }

  const manager = this.dataSource.manager;
  const moneda = await this.resolverMonedaOficial(manager, tenantId);
  const tips = await this.buscarTipsElegibles(
    manager, tenantId, fechaDesde, fechaHasta, turnoIds,
  );
  const sesiones = await this.buscarSesionesPeriodo(
    manager, tenantId, fechaDesde, fechaHasta, turnoIds,
  );
  const poolTotal = tips
    .reduce((acc, t) => acc.plus(t.monto_pagado), new Decimal(0))
    .toFixed(4);

  const montos = this.montosPorGrupo(poolTotal, gruposConfig, moneda.decimales);
  // Grupos en memoria: id = id del grupo de configuración (clave estable para el front).
  const grupos = gruposConfig.map(
    (g) =>
      ({
        id: g.id,
        tipoGarzon: g.tipoGarzon,
        nombre: g.nombre,
        porcentaje: new Decimal(g.porcentaje).toFixed(6),
        criterio: g.criterio,
        baseVentas: g.baseVentas,
        manualModo: g.manualModo,
        montoGrupo: montos.get(g.id) ?? '0.0000',
        orden: g.orden,
      }) as LiquidacionPropinasGrupo,
  );

  const dataBase = this.buildParticipantesData(
    tenantId, 'preview', grupos, gruposConfig, tips, sesiones,
    fechaDesde, fechaHasta, moneda.decimales,
  );
  const data = this.aplicarAjustesEnMemoria(
    grupos, dataBase, ajustes, moneda.decimales,
  );

  return {
    poolTotal,
    monedaId: moneda.monedaId,
    decimalesMoneda: moneda.decimales,
    grupos: grupos.map((g) => ({
      id: g.id,
      tipoGarzon: g.tipoGarzon,
      nombre: g.nombre,
      porcentaje: g.porcentaje,
      criterio: g.criterio,
      baseVentas: g.baseVentas,
      manualModo: g.manualModo,
      montoGrupo: g.montoGrupo,
      orden: g.orden,
    })),
    participantes: data.map((p) => ({
      garzonId: p.garzonId,
      grupoId: p.grupoId,
      tipoGarzon: p.tipoGarzon,
      incluido: p.incluido,
      horas: p.horas,
      ventasBase: p.ventasBase,
      cuentas: p.cuentas,
      pesoManual: p.pesoManual,
      monto: p.monto,
    })),
    advertencias: this.advertenciasSesionesAbiertas(sesiones),
  };
}

private aplicarAjustesEnMemoria(
  grupos: LiquidacionPropinasGrupo[],
  participantes: ParticipanteData[],
  ajustes: AjustesReparto | undefined,
  decimales: number,
): ParticipanteData[] {
  if (!ajustes) return participantes;
  const exclusiones = new Set(ajustes.exclusiones ?? []);
  const montosManuales = new Map(
    (ajustes.montosManuales ?? []).map((m) => [
      m.garzonId,
      new Decimal(m.monto).toFixed(4),
    ]),
  );

  const conInclusion = participantes.map((p) => ({
    ...p,
    incluido: !exclusiones.has(p.garzonId),
  }));

  const recomputados: ParticipanteData[] = [];
  for (const grupo of grupos) {
    const delGrupo = conInclusion.filter(
      (p) => p.grupoId === grupo.id && p.incluido,
    );
    const omitidos = conInclusion.filter(
      (p) => p.grupoId === grupo.id && !p.incluido,
    );
    const activos =
      grupo.criterio === CriterioDistribucion.MANUAL &&
      grupo.manualModo === ManualModo.MONTOS
        ? delGrupo
        : this.repartirGrupo(grupo, grupo, delGrupo, decimales);
    recomputados.push(...activos, ...omitidos);
  }

  return recomputados.map((p) =>
    montosManuales.has(p.garzonId)
      ? { ...p, monto: montosManuales.get(p.garzonId)! }
      : p,
  );
}
```

- [ ] **Step 5: Correr el test para verlo pasar**

Run: `cd backend && npm test -- liquidacion-propinas.service -t computarReparto`
Expected: PASS.

- [ ] **Step 6: Agregar test de ajustes (exclusión redistribuye)**

```typescript
it('computarReparto excluye un participante y redistribuye', async () => {
  // mismo setup: grupo GARZON 100%, PARTES_IGUALES, 2 garzones (garzonA, garzonB)
  const result = await service.computarReparto(
    tenantId,
    new Date('2026-07-01T00:00:00Z'),
    new Date('2026-07-08T00:00:00Z'),
    [],
    { exclusiones: [garzonBId] },
  );
  const incluidos = result.participantes.filter((p) => p.incluido);
  expect(incluidos).toHaveLength(1);
  expect(incluidos[0].garzonId).toBe(garzonAId);
  expect(incluidos[0].monto).toBe('2000.0000'); // recibe todo el grupo
});
```

Run: `cd backend && npm test -- liquidacion-propinas.service -t computarReparto`
Expected: PASS (ambos tests).

- [ ] **Step 7: Exponer el endpoint**

En `liquidacion-propinas.controller.ts`, importar `PreviewLiquidacionDto` y agregar:

```typescript
@Post('preview')
@RequiresPermiso('Propinas', 'Leer')
preview(@Req() req: Request, @Body() dto: PreviewLiquidacionDto) {
  const user = req.user as JwtUser;
  return this.liquidaciones.computarReparto(
    user.tenantId!,
    new Date(dto.fechaDesde),
    new Date(dto.fechaHasta),
    dto.turnoIds ?? [],
    dto.ajustes,
  );
}
```

> Nota: `@Post('preview')` debe declararse ANTES de `@Post()` no es necesario (rutas literales vs raíz no colisionan), pero mantenerlo junto a los otros `@Post`.

- [ ] **Step 8: Lint + tests del módulo**

Run: `cd backend && npm run lint && npm test -- propinas`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/propinas/dto/ajustes-reparto.dto.ts \
        backend/src/modules/propinas/dto/preview-liquidacion.dto.ts \
        backend/src/modules/propinas/liquidacion-propinas.service.ts \
        backend/src/modules/propinas/liquidacion-propinas.controller.ts \
        backend/src/modules/propinas/liquidacion-propinas.service.spec.ts
git commit -m "feat(propinas): endpoint preview de reparto sin persistir"
```

---

## Task 3: Backend — `liquidar` atómico (crear + ajustes + confirmar)

Un solo endpoint que crea la liquidación, aplica los ajustes y la confirma (bloqueando las propinas) en una transacción. Refactoriza `crear`/`confirmar` para compartir la lógica.

**Files:**
- Create: `backend/src/modules/propinas/dto/liquidar.dto.ts`
- Modify: `backend/src/modules/propinas/liquidacion-propinas.service.ts`
- Modify: `backend/src/modules/propinas/liquidacion-propinas.controller.ts`
- Test: `backend/src/modules/propinas/liquidacion-propinas.service.spec.ts`

**Interfaces:**
- Consumes (Task 1/2): `construirBorrador` pieces, `aplicarAjustesEnMemoria` (referencia), `AjustesReparto`.
- Produces:
  - `async liquidar(tenantId: string, usuarioId: string, dto: LiquidarDto): Promise<LiquidacionDetalle>`
  - `private async confirmarEnTransaccion(manager, tenantId, usuarioId, liquidacion, grupos, participantes, fuentes): Promise<LiquidacionPropinasEvento>`
  - Endpoint `POST /propinas/liquidaciones/liquidar` → `LiquidacionDetalle`

- [ ] **Step 1: Crear el DTO**

`backend/src/modules/propinas/dto/liquidar.dto.ts`:

```typescript
import {
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AjustesRepartoDto } from './ajustes-reparto.dto';

export class LiquidarDto {
  @IsISO8601()
  fechaDesde: string;

  @IsISO8601()
  fechaHasta: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  turnoIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AjustesRepartoDto)
  ajustes?: AjustesRepartoDto;
}
```

- [ ] **Step 2: Extraer `confirmarEnTransaccion` y usarlo en `confirmar`**

Extraer el núcleo del `confirmar` actual (validación de montos manuales, lock y UPDATE de `venta_propina`, cambio de estado, evento CONFIRMADA) a un método privado que reciba el `manager` y las entidades ya cargadas:

```typescript
private async confirmarEnTransaccion(
  manager: EntityManager,
  tenantId: string,
  usuarioId: string,
  liquidacion: LiquidacionPropinas,
  grupos: LiquidacionPropinasGrupo[],
  participantes: LiquidacionPropinasParticipante[],
  fuentes: LiquidacionPropinasFuente[],
): Promise<LiquidacionPropinasEvento> {
  this.validarManualMontos(grupos, participantes);

  const tipIds = [
    ...new Set(fuentes.map((f) => f.ventaPropinaId).filter(Boolean)),
  ];
  if (tipIds.length === 0) {
    throw new BadRequestException('La liquidación no tiene propinas fuente');
  }
  await manager.query(
    `SELECT venta_propina_id FROM venta_propina
     WHERE venta_propina_id = ANY($1::uuid[]) FOR UPDATE`,
    [tipIds],
  );
  const updateRaw = await manager.query(
    `UPDATE venta_propina
     SET liquidacion_id = $1, actualizado_el = NOW()
     WHERE venta_propina_id = ANY($2::uuid[])
       AND liquidacion_id IS NULL
       AND eliminado_el IS NULL
     RETURNING venta_propina_id`,
    [liquidacion.id, tipIds],
  );
  const actualizadas: { venta_propina_id: string }[] = Array.isArray(updateRaw?.[0])
    ? updateRaw[0]
    : updateRaw;
  if (actualizadas.length !== tipIds.length) {
    throw new BadRequestException(
      'Una o más propinas ya fueron liquidadas por otra corrida',
    );
  }

  liquidacion.estado = EstadoLiquidacion.CONFIRMADA;
  liquidacion.confirmadoPor = usuarioId;
  liquidacion.confirmadoEl = new Date();
  await manager.save(LiquidacionPropinas, liquidacion);

  return manager.save(
    LiquidacionPropinasEvento,
    manager.create(LiquidacionPropinasEvento, {
      tenantId,
      liquidacionId: liquidacion.id,
      tipo: TipoEventoLiquidacion.CONFIRMADA,
      payload: { tips: tipIds.length },
      usuarioId,
    }),
  );
}
```

Reemplazar el cuerpo del `confirmar` público para que delegue:

```typescript
async confirmar(tenantId: string, usuarioId: string, id: string): Promise<LiquidacionDetalle> {
  return this.dataSource.transaction(async (manager) => {
    const detalle = await this.cargarDetalleManager(manager, tenantId, id, true);
    this.assertBorrador(detalle.liquidacion);
    const evento = await this.confirmarEnTransaccion(
      manager, tenantId, usuarioId,
      detalle.liquidacion, detalle.grupos, detalle.participantes, detalle.fuentes,
    );
    return this.toDetalle(detalle.liquidacion, {
      grupos: detalle.grupos,
      participantes: detalle.participantes,
      fuentes: detalle.fuentes,
      eventos: [...detalle.eventos, evento],
      advertencias: [],
    });
  });
}
```

- [ ] **Step 3: Correr specs de confirmar (deben seguir pasando)**

Run: `cd backend && npm test -- liquidacion-propinas.service`
Expected: PASS (el refactor de `confirmar` no cambia comportamiento).

- [ ] **Step 4: Escribir el test que falla para `liquidar`**

```typescript
it('liquidar crea, aplica exclusión y confirma bloqueando las propinas', async () => {
  // setup: grupo GARZON 100% PARTES_IGUALES, 2 garzones con 1 tip de 1000 c/u.
  const result = await service.liquidar(tenantId, usuarioId, {
    fechaDesde: '2026-07-01T00:00:00Z',
    fechaHasta: '2026-07-08T00:00:00Z',
    ajustes: { exclusiones: [garzonBId] },
  });

  expect(result.estado).toBe('confirmada');
  const incluidos = result.participantes.filter((p) => p.incluido);
  expect(incluidos).toHaveLength(1);
  expect(incluidos[0].monto).toBe('2000.0000');
  // se ejecutó el UPDATE de bloqueo de venta_propina
  expect(managerQuery).toHaveBeenCalledWith(
    expect.stringContaining('UPDATE venta_propina'),
    expect.anything(),
  );
});
```

> Nota: el mock de `manager.query` debe devolver, para el `UPDATE ... RETURNING`, un array con tantas filas como tips (2), para que la validación de carrera pase.

- [ ] **Step 5: Correr el test para verlo fallar**

Run: `cd backend && npm test -- liquidacion-propinas.service -t "liquidar crea"`
Expected: FAIL con "service.liquidar is not a function".

- [ ] **Step 6: Implementar `liquidar` (con `aplicarAjustesPersistido`)**

```typescript
async liquidar(
  tenantId: string,
  usuarioId: string,
  dto: LiquidarDto,
): Promise<LiquidacionDetalle> {
  const fechaDesde = new Date(dto.fechaDesde);
  const fechaHasta = new Date(dto.fechaHasta);
  if (fechaHasta <= fechaDesde) {
    throw new BadRequestException('La fecha hasta debe ser posterior a desde');
  }
  const config = await this.distribucion.obtener(tenantId);
  const gruposConfig = config.grupos.filter((g) => g.activo);
  if (gruposConfig.length === 0) {
    throw new BadRequestException('No hay grupos activos para liquidar');
  }
  const turnoIds = dto.turnoIds ?? [];

  return this.dataSource.transaction(async (manager) => {
    const moneda = await this.resolverMonedaOficial(manager, tenantId);
    const tips = await this.buscarTipsElegibles(manager, tenantId, fechaDesde, fechaHasta, turnoIds);
    const sesiones = await this.buscarSesionesPeriodo(manager, tenantId, fechaDesde, fechaHasta, turnoIds);
    const poolTotal = tips.reduce((acc, t) => acc.plus(t.monto_pagado), new Decimal(0)).toFixed(4);

    const liquidacion = await manager.save(
      LiquidacionPropinas,
      manager.create(LiquidacionPropinas, {
        tenantId, fechaDesde, fechaHasta, turnoIds,
        estado: EstadoLiquidacion.BORRADOR,
        poolTotal,
        configuracionVersion: config.version,
        monedaId: moneda.monedaId,
        decimalesMoneda: moneda.decimales,
        creadoPor: usuarioId,
      }),
    );
    const grupos = await this.crearSnapshotGrupos(manager, tenantId, liquidacion.id, poolTotal, moneda.decimales, gruposConfig);
    const fuentes = await this.crearFuentes(manager, tenantId, liquidacion.id, tips);
    let participantes = await this.crearParticipantes(manager, tenantId, liquidacion.id, grupos, gruposConfig, tips, sesiones, fechaDesde, fechaHasta, moneda.decimales);

    participantes = await this.aplicarAjustesPersistido(manager, grupos, participantes, dto.ajustes, moneda.decimales);

    const eventoCreada = await manager.save(
      LiquidacionPropinasEvento,
      manager.create(LiquidacionPropinasEvento, {
        tenantId, liquidacionId: liquidacion.id,
        tipo: TipoEventoLiquidacion.CREADA,
        payload: { fuenteCount: fuentes.length, poolTotal, configuracionVersion: config.version },
        usuarioId,
      }),
    );
    const eventoConfirmada = await this.confirmarEnTransaccion(
      manager, tenantId, usuarioId, liquidacion, grupos, participantes, fuentes,
    );

    return this.toDetalle(liquidacion, {
      grupos, participantes, fuentes,
      eventos: [eventoCreada, eventoConfirmada],
      advertencias: this.advertenciasSesionesAbiertas(sesiones),
    });
  });
}

private async aplicarAjustesPersistido(
  manager: EntityManager,
  grupos: LiquidacionPropinasGrupo[],
  participantes: LiquidacionPropinasParticipante[],
  ajustes: AjustesReparto | undefined,
  decimales: number,
): Promise<LiquidacionPropinasParticipante[]> {
  if (!ajustes) return participantes;
  const exclusiones = new Set(ajustes.exclusiones ?? []);
  const montosManuales = new Map(
    (ajustes.montosManuales ?? []).map((m) => [m.garzonId, new Decimal(m.monto).toFixed(4)]),
  );

  for (const p of participantes) {
    p.incluido = !exclusiones.has(p.garzonId);
  }
  let recalculados = await this.recalcularParticipantesExistentes(
    manager, grupos, participantes, decimales,
  );
  for (const p of recalculados) {
    if (montosManuales.has(p.garzonId)) {
      p.monto = montosManuales.get(p.garzonId)!;
      await manager.save(LiquidacionPropinasParticipante, p);
    }
  }
  return recalculados;
}
```

- [ ] **Step 7: Correr el test para verlo pasar**

Run: `cd backend && npm test -- liquidacion-propinas.service -t "liquidar crea"`
Expected: PASS.

- [ ] **Step 8: Exponer el endpoint**

En `liquidacion-propinas.controller.ts`, importar `LiquidarDto` y agregar:

```typescript
@Post('liquidar')
@RequiresPermiso('Propinas', 'Liquidar')
liquidar(@Req() req: Request, @Body() dto: LiquidarDto) {
  const user = req.user as JwtUser;
  return this.liquidaciones.liquidar(user.tenantId!, user.id, dto);
}
```

- [ ] **Step 9: Lint + tests del módulo**

Run: `cd backend && npm run lint && npm test -- propinas`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/propinas/dto/liquidar.dto.ts \
        backend/src/modules/propinas/liquidacion-propinas.service.ts \
        backend/src/modules/propinas/liquidacion-propinas.controller.ts \
        backend/src/modules/propinas/liquidacion-propinas.service.spec.ts
git commit -m "feat(propinas): endpoint liquidar atómico (crea + ajustes + confirma)"
```

---

## Task 4: Frontend — composables (`preview`, `liquidar`, resumen, impresión)

**Files:**
- Modify: `frontend/app/composables/usePropinaLiquidaciones.ts`
- Create: `frontend/app/composables/usePropinaResumen.ts`
- Create: `frontend/app/composables/usePropinaImpresion.ts`
- Test: `frontend/app/composables/usePropinaImpresion.spec.ts`

**Interfaces:**
- Produces:
  - En `usePropinaLiquidaciones`: tipos `PreviewGrupo`, `PreviewParticipante`, `PreviewReparto`, `AjustesReparto`, `LiquidarBody`, `PreviewBody`; métodos `preview(body: PreviewBody)`, `liquidar(body: LiquidarBody)`.
  - `usePropinaResumen().resumen(desde, hasta)` → `{ pendienteLibreMonto: string; montoCobrado: string }`.
  - `agruparParaImpresion(detalle: LiquidacionDetalle, garzones: Garzon[]): GrupoImpresion[]` (pura, testeable).

- [ ] **Step 1: Extender `usePropinaLiquidaciones.ts`**

Agregar tipos y métodos (después de los tipos existentes y dentro del `return` de `usePropinaLiquidaciones`):

```typescript
export interface PreviewGrupo {
  id: string
  tipoGarzon: TipoGarzon
  nombre: string
  porcentaje: string
  criterio: CriterioDistribucion
  baseVentas: BaseVentasGrupo
  manualModo: ManualModo | null
  montoGrupo: string
  orden: number
}

export interface PreviewParticipante {
  garzonId: string
  grupoId: string
  tipoGarzon: TipoGarzon
  incluido: boolean
  horas: string
  ventasBase: string
  cuentas: string
  pesoManual: string | null
  monto: string
}

export interface PreviewReparto {
  poolTotal: string
  monedaId: string
  decimalesMoneda: number
  grupos: PreviewGrupo[]
  participantes: PreviewParticipante[]
  advertencias: string[]
}

export interface AjustesReparto {
  exclusiones?: string[]
  montosManuales?: Array<{ garzonId: string, monto: string }>
}

export interface PreviewBody {
  fechaDesde: string
  fechaHasta: string
  turnoIds?: string[]
  ajustes?: AjustesReparto
}

export interface LiquidarBody extends PreviewBody {}
```

Dentro de `usePropinaLiquidaciones()`, agregar:

```typescript
const preview = (body: PreviewBody) =>
  useApiFetch<PreviewReparto>(`${base}/preview`, { method: 'POST', body })
const liquidar = (body: LiquidarBody) =>
  useApiFetch<LiquidacionDetalle>(`${base}/liquidar`, { method: 'POST', body })
```

y añadirlos al objeto retornado: `return { listar, crear, detalle, actualizar, actualizarConfig, confirmar, anular, preview, liquidar }`.

- [ ] **Step 2: Crear `usePropinaResumen.ts`**

```typescript
import { useApiFetch } from './useApiFetch'

interface ReporteResumenRaw {
  cobranza: { montoCobrado: string }
  estadoActual: { pendienteLibreMonto: string }
}

export interface PropinaResumenMinimo {
  pendienteLibreMonto: string
  montoCobrado: string
}

export function usePropinaResumen() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const resumen = async (desde: string, hasta: string): Promise<PropinaResumenMinimo> => {
    const params = new URLSearchParams({ desde, hasta })
    const raw = await useApiFetch<ReporteResumenRaw>(
      `${apiUrl}/propinas/reportes/resumen?${params.toString()}`,
    )
    return {
      pendienteLibreMonto: raw.estadoActual.pendienteLibreMonto,
      montoCobrado: raw.cobranza.montoCobrado,
    }
  }

  return { resumen }
}
```

> Nota: `desde`/`hasta` en formato `YYYY-MM-DD`, `hasta` exclusivo (mismo contrato que `QueryPropinaReporteDto`). El implementador debe confirmar el shape exacto de `QueryPropinaReporteDto` en `backend/src/modules/propinas/dto/query-propina-reporte.dto.ts`.

- [ ] **Step 3: Escribir el test que falla para el helper de impresión**

`frontend/app/composables/usePropinaImpresion.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { agruparParaImpresion } from './usePropinaImpresion'

const garzones = [
  { id: 'g1', nombre: 'Ana', activo: true, tipo: 'garzon', creadoEl: '', actualizadoEl: '' },
  { id: 'g2', nombre: 'Pedro', activo: true, tipo: 'cocina', creadoEl: '', actualizadoEl: '' },
]

const detalle = {
  grupos: [
    { id: 'gr1', nombre: 'Garzones', montoGrupo: '1000.0000' },
    { id: 'gr2', nombre: 'Cocina', montoGrupo: '500.0000' },
  ],
  participantes: [
    { id: 'p1', grupoId: 'gr1', garzonId: 'g1', monto: '1000.0000', incluido: true },
    { id: 'p2', grupoId: 'gr2', garzonId: 'g2', monto: '500.0000', incluido: true },
    { id: 'p3', grupoId: 'gr2', garzonId: 'gX', monto: '0.0000', incluido: false },
  ],
} as never

describe('agruparParaImpresion', () => {
  it('agrupa personas incluidas con su nombre y monto', () => {
    const grupos = agruparParaImpresion(detalle, garzones as never)
    expect(grupos).toHaveLength(2)
    expect(grupos[0].nombre).toBe('Garzones')
    expect(grupos[0].personas).toEqual([{ garzonId: 'g1', nombre: 'Ana', monto: '1000.0000' }])
    // excluidos no aparecen
    expect(grupos[1].personas).toEqual([{ garzonId: 'g2', nombre: 'Pedro', monto: '500.0000' }])
  })
})
```

- [ ] **Step 4: Correr el test para verlo fallar**

Run: `cd frontend && npm test -- usePropinaImpresion`
Expected: FAIL con "Cannot find module './usePropinaImpresion'".

- [ ] **Step 5: Implementar `usePropinaImpresion.ts`**

```typescript
import type { LiquidacionDetalle } from './usePropinaLiquidaciones'
import type { Garzon } from './useGarzones'

export interface PersonaImpresion {
  garzonId: string
  nombre: string
  monto: string
}

export interface GrupoImpresion {
  id: string
  nombre: string
  montoGrupo: string
  personas: PersonaImpresion[]
}

export function agruparParaImpresion(
  detalle: Pick<LiquidacionDetalle, 'grupos' | 'participantes'>,
  garzones: Garzon[],
): GrupoImpresion[] {
  const nombre = (id: string) => garzones.find(g => g.id === id)?.nombre ?? id
  return detalle.grupos.map(grupo => ({
    id: grupo.id,
    nombre: grupo.nombre,
    montoGrupo: grupo.montoGrupo,
    personas: detalle.participantes
      .filter(p => p.grupoId === grupo.id && p.incluido)
      .map(p => ({ garzonId: p.garzonId, nombre: nombre(p.garzonId), monto: p.monto })),
  }))
}
```

- [ ] **Step 6: Correr el test para verlo pasar**

Run: `cd frontend && npm test -- usePropinaImpresion`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/composables/usePropinaLiquidaciones.ts \
        frontend/app/composables/usePropinaResumen.ts \
        frontend/app/composables/usePropinaImpresion.ts \
        frontend/app/composables/usePropinaImpresion.spec.ts
git commit -m "feat(propinas): composables de preview, liquidar, resumen e impresión"
```

---

## Task 5: Frontend — pantalla operativa `/propinas` (reparto en vivo + liquidar)

Reescribe `pages/propinas/index.vue` como pantalla única. Elimina los tabs y el panel de reportes.

**Files:**
- Rewrite: `frontend/app/pages/propinas/index.vue`
- Modify: `frontend/app/pages/propinas/liquidaciones/index.vue` (redirect a `/propinas`)

**Interfaces:**
- Consumes (Task 4): `usePropinaLiquidaciones().preview/liquidar/listar/anular`, `usePropinaResumen().resumen`, tipos `PreviewReparto`, `AjustesReparto`.

- [ ] **Step 1: Reescribir `pages/propinas/index.vue`**

Estructura del `<script setup>`:
- Guard de permisos (igual al actual: si no `esAdmin` ni `can('Propinas','Leer')` → `navigateTo('/')`).
- Estado: `fechaDesde`, `fechaHasta`, `turnoIds`, `reparto = ref<PreviewReparto | null>(null)`, `exclusiones = reactive<Set<string>>` (usar `ref<string[]>([])`), `montosManuales = reactive<Record<string,string>>({})`, `loadingPreview`, `liquidando`, `resumen = ref<PropinaResumenMinimo | null>(null)`, `historial = ref<LiquidacionResumen[]>([])`, `garzones`.
- `puedeLiquidar = computed(() => permissions.esAdmin || permissions.can('Propinas','Liquidar'))`.
- `ajustes = computed<AjustesReparto>(() => ({ exclusiones: exclusiones.value, montosManuales: Object.entries(montosManuales).filter(([,v]) => v).map(([garzonId, monto]) => ({ garzonId, monto })) }))`.
- `cargarPreview()`: si falta rango, no hace nada; llama `api.preview({ fechaDesde: toIso(...), fechaHasta: toIso(...), turnoIds, ajustes })` y setea `reparto`.
- `toggleExcluir(garzonId)`: agrega/quita de `exclusiones`, luego `cargarPreview()` (recalcula en backend).
- `guardarMonto(garzonId)`: setea en `montosManuales`, `cargarPreview()`.
- `liquidar()`: `api.liquidar({...misma body...})` → al volver, `router.push('/propinas/liquidaciones/' + detalle.id + '/imprimir?tipo=resumen')`.
- `cargarInicial()` en `onMounted`: turnos, garzones, historial (`api.listar()`), y resumen del mes actual.
- `garzonNombre(id)` desde `garzones`.
- `criterioLabel` (copiar el mapa del `[id].vue` actual).

Template (Nuxt UI, tokens semánticos):
- `UDashboardPanel` + `AppNavbar title="Propinas"`.
- `CrudPageHeader` con título/descr.
- Fila de 2 `UCard` métricas: "Pendiente por liquidar" (`formatMonto(resumen.pendienteLibreMonto)`) y "Cobrado (mes)" (`formatMonto(resumen.montoCobrado)`).
- `UCard` selector: `AppDateTimeInput` desde/hasta + `USelectMenu` multiple de turnos + botón "Ver reparto" (`@click="cargarPreview"`).
- Si `reparto`: bloque de "Fondo total" grande (`formatMonto(reparto.poolTotal, reparto.monedaId)`), luego una `UCard` por grupo (nombre, `formatPorcentaje(grupo.porcentaje)`, `criterioLabel`, `formatMonto(grupo.montoGrupo)`), y dentro las personas (`participantes` del grupo) con: nombre, monto, botón excluir/incluir (deshabilitado si `!puedeLiquidar`), e input de monto cuando `grupo.criterio === 'MANUAL'`.
- Botones: "Liquidar período" (`:loading="liquidando"`, deshabilitado si `!reparto || Number(reparto.poolTotal) === 0 || !puedeLiquidar`).
- Alertas: `reparto.advertencias` con `UAlert color="warning"`.
- Sección "Historial": `UTable` simple (Desde/Hasta/Estado/Fondo) con `@select` → `router.push('/propinas/liquidaciones/' + row.id + '/imprimir?tipo=resumen')`.

> Reusar helpers del componente actual `PropinaLiquidacionesPanel.vue` (`estadoColor`, `estadoLabel`, `toIso`, columnas) como referencia. Toda función de formato viene de `useFormatters`.

- [ ] **Step 2: Simplificar el redirect de liquidaciones/index**

`pages/propinas/liquidaciones/index.vue` ya redirige a `/propinas`; ajustar la query para que no fuerce `tab` (ya no hay tabs):

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })
await navigateTo({ path: '/propinas' }, { replace: true })
</script>

<template>
  <div />
</template>
```

- [ ] **Step 3: Verificación en navegador**

Run: `docker-compose up` (si no está levantado) y abrir `http://localhost:5173/propinas`.
Verificar manualmente (o con la skill `chrome-devtools`): las 2 métricas cargan; elegir un rango con propinas muestra el fondo y el reparto por grupo; excluir una persona recalcula los montos; "Liquidar período" navega a la vista imprimible.

- [ ] **Step 4: Lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/propinas/index.vue \
        frontend/app/pages/propinas/liquidaciones/index.vue
git commit -m "feat(propinas): pantalla operativa única con reparto en vivo"
```

---

## Task 6: Frontend — vista imprimible (PDF/A4)

Ruta imprimible sin dashboard, con `?tipo=persona|resumen|grupo`.

**Files:**
- Create: `frontend/app/pages/propinas/liquidaciones/[id]/imprimir.vue`
- Delete: `frontend/app/pages/propinas/liquidaciones/[id].vue`

**Interfaces:**
- Consumes (Task 4): `usePropinaLiquidaciones().detalle/anular`, `useGarzones().listar`, `agruparParaImpresion`.

- [ ] **Step 1: Crear `pages/propinas/liquidaciones/[id]/imprimir.vue`**

`<script setup>`:
- `definePageMeta({ middleware: 'auth', layout: false })` — sin layout dashboard.
- Leer `id` de la ruta y `tipo` de `route.query` (`'persona' | 'resumen' | 'grupo'`, default `'resumen'`).
- Cargar `detalle` (`api.detalle(id)`) y `garzones` en paralelo; construir `grupos = agruparParaImpresion(detalle, garzones)`.
- `formatMonto`, `formatFecha` de `useFormatters`.
- `imprimir()` = `window.print()`; opcional `onMounted` no auto-imprime (deja botón manual).
- Botón "Volver" → `router.push('/propinas')`.

Template:
- Barra superior (clase `no-print`) con botones "Imprimir" y "Volver", y selector de `tipo` (`USelectMenu` o 3 `UButton`).
- Contenido imprimible:
  - `tipo === 'resumen'`: encabezado (período, fondo total) + por cada grupo, tabla de personas con monto + total del grupo.
  - `tipo === 'grupo'`: igual pero cada grupo en su `<section class="page-break">`.
  - `tipo === 'persona'`: por cada persona incluida (de todos los grupos), un `<section class="page-break comprobante">` con: nombre, grupo, período, monto grande, y línea de firma (`<div class="firma">Firma: _______</div>`).
- Estilos `<style>` con:

```css
@media print {
  .no-print { display: none !important; }
  .page-break { page-break-after: always; }
  @page { size: A4; margin: 16mm; }
}
```

> Usar tokens semánticos para la vista en pantalla; para impresión, el negro sobre blanco es aceptable (documento). Evitar depender de colores de dashboard.

- [ ] **Step 2: Eliminar la vista de detalle editable anterior**

```bash
git rm frontend/app/pages/propinas/liquidaciones/\[id\].vue
```

(La anulación ahora vive en la vista imprimible o en el historial; el ajuste de participantes ya ocurre en el preview, así que el detalle editable es redundante.)

- [ ] **Step 3: Verificación en navegador**

Abrir `http://localhost:5173/propinas/liquidaciones/<id>/imprimir?tipo=persona` de una liquidación confirmada. Verificar (skill `chrome-devtools` o Ctrl+P): un comprobante por persona con salto de página; `?tipo=resumen` muestra todo en una hoja; `?tipo=grupo` una hoja por grupo. Confirmar que la barra `no-print` no aparece en la previsualización de impresión.

- [ ] **Step 4: Lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/propinas/liquidaciones/
git commit -m "feat(propinas): vista imprimible PDF/A4 (persona/resumen/grupo)"
```

---

## Task 7: Cleanup + documentación

Eliminar el reporting pesado del front y actualizar docs.

**Files:**
- Delete: `frontend/app/components/PropinaReportesPanel.vue`
- Delete: `frontend/app/composables/usePropinaReportes.ts`
- Delete: `frontend/app/pages/propinas/reportes.vue`
- Modify: `docs/ESTADO.md`, `docs/features/propinas.md` (o el doc de feature existente)

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Verificar que nada más importa los archivos a borrar**

Run:
```bash
cd frontend && grep -rn "PropinaReportesPanel\|usePropinaReportes\|propinas/reportes" app/ || echo "sin referencias"
```
Expected: solo referencias dentro de los archivos que se van a borrar (index.vue ya fue reescrito en Task 5 y no debe referenciarlos). Si aparece otra, quitarla.

- [ ] **Step 2: Borrar los archivos**

```bash
git rm frontend/app/components/PropinaReportesPanel.vue \
       frontend/app/composables/usePropinaReportes.ts \
       frontend/app/pages/propinas/reportes.vue
```

- [ ] **Step 3: Actualizar documentación**

- `docs/ESTADO.md`: actualizar la fila de propinas (operatividad simplificada: reparto en vivo + liquidar + imprimir; reportes reducidos a resumen) con fecha 2026-07-17.
- Doc de feature de propinas (`docs/features/propinas.md` o el que exista; si no existe, crear desde `docs/features/TEMPLATE.md` y enlazar en `docs/README.md`): documentar el flujo nuevo, los endpoints `preview` y `liquidar`, y las 3 vistas imprimibles.

- [ ] **Step 4: Build + tests globales del módulo**

Run:
```bash
cd backend && npm run lint && npm test -- propinas
cd frontend && npm run lint && npm run build && npm test -- usePropinaImpresion
```
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(propinas): eliminar reporting pesado del front y actualizar docs"
```

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** flujo de una pantalla (Task 5), preview sin guardar (Task 2), liquidar atómico (Task 3), ajustes excluir/monto (Tasks 2/3/5), impresión 3 formatos (Task 6), resumen mínimo 2 métricas (Tasks 4/5), config intacta (no se toca), eliminación de reportes/eventos UI (Tasks 5/6/7). ✔
- **Sin placeholders:** todos los pasos con código real o instrucciones concretas de reescritura para las 2 vistas Vue grandes (Tasks 5/6), que por tamaño se especifican por estructura + helpers a reusar, no como pseudocódigo vago.
- **Consistencia de tipos:** `PreviewReparto`/`PreviewGrupo`/`PreviewParticipante`/`AjustesReparto` idénticos entre backend (Task 2) y frontend (Task 4). `agruparParaImpresion` (Task 4) consumido en Task 6. `computarReparto`/`liquidar`/`confirmarEnTransaccion` firmas estables entre Tasks 2 y 3.
```
