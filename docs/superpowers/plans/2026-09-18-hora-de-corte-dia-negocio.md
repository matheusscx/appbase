# Plan: el día del negocio termina en una hora de corte

**Status:** Draft · **Date:** 2026-09-18 · **Owner:** Cesar Matheus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cada tenant configura la hora (00:00–06:00) a la que termina su día, y todo reporte que resuelve "a qué día pertenece algo" lo respeta al consultar.

**Architecture:** una columna `tenants.hora_corte` y un solo lugar que la aplica: `backend/src/common/utils/rango-fecha.util.ts`, que ya es por donde pasa "el día" de todos los reportes. Los helpers de rango reciben zona **y** corte; "hoy" y "el día de un instante" salen de fragmentos SQL del mismo util. Un test de invariante impide que un service vuelva a armar un día a mano.

**Tech Stack:** NestJS + SQL crudo vía `Db` (Postgres 15, `timestamptz`), class-validator, Jest (unit + e2e con supertest), Nuxt 4 + Nuxt UI.

**Spec:** [`docs/superpowers/specs/2026-09-18-hora-de-corte-dia-negocio-design.md`](../specs/2026-09-18-hora-de-corte-dia-negocio-design.md). Leerla antes de empezar: el plan argumenta desde ahí.

## Global Constraints

- **Recalcula:** el día se calcula al consultar con el corte vigente. No se graba el día de negocio en ninguna tabla.
- **Rango del corte:** entero de 0 a 6, horas enteras, 0 por defecto. `CHECK (hora_corte BETWEEN 0 AND 6)` en la base, `@IsInt() @Min(0) @Max(6)` en el DTO.
- **Queda fuera:** `calculo-precios.service.ts`, `promociones.*`, `useVigenciaRegla.ts` y la fecha de la boleta. No se tocan.
- **Fecha pura vs timestamp:** una fecha pura (`YYYY-MM-DD`) se expande con zona y corte; un timestamp completo se respeta tal cual, sin zona ni corte (contrato vigente de `rango-fecha.util.ts`).
- **Zona y corte viajan juntos o no viajan:** Postgres rechaza un parámetro que la consulta no referencia (500). Se empujan solo si algún borde es fecha pura (`requiereDiaNegocio`).
- **Primero a hora local, después restar el corte**, nunca al revés (spec § 5; medido el 2026-09-18: con corte 5, el instante `2026-09-06 08:30Z` es el día `2026-09-06`).
- **Dónde se trabaja:** código solo en el worktree `.claude/worktrees/hora-de-corte` (rama `wt/hora-de-corte`), nunca en el checkout principal. Stagear por ruta explícita, nunca `git add -A`.
- **Turnos compartidos:** pedir turno a la sesión orquestadora ("Listado de sesiones activas") antes de `./scripts/reset-db.sh` / `test:e2e` y antes de mergear a `main`. El merge lo aprueba el owner; sin push sin el owner.
- **Cada commit** que toque services de backend o `.vue` de `pages`/`components` necesita el recibo de `verify-feature` (domain-reviewer LIMPIO sobre el diff staged): `git diff --cached | git hash-object --stdin > "$(git rev-parse --git-dir)/verify-feature.receipt"`. Nunca `--no-verify`.
- **El e2e corre en serie** (`maxWorkers: 1` en `test/jest-e2e.json`), así que una suite puede cambiarle el corte al tenant Paris si lo devuelve a 0 en `afterAll`.
- Mensajes de commit terminan con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Mapa de archivos

| Archivo | Qué cambia | Tarea |
|---|---|---|
| `backend/src/modules/tenants/entities/tenant.entity.ts` | columna `horaCorte` + `@Check` | 1 |
| `backend/src/modules/tenants/dto/update-my-tenant.dto.ts` (+ `.spec.ts`) | `horaCorte` validado | 1 |
| `backend/src/modules/tenants/tenants.service.ts` | `findMine` devuelve `diaNegocioHoy` | 3 |
| `backend/src/common/utils/rango-fecha.util.ts` (+ `.spec.ts`) | tipos, `diaNegocioTenant`, helpers con corte, fragmentos, `diaNegocioEnZona`, `fechaMenosDias` | 2, 3 |
| `backend/src/modules/{pagos,caja,inventario,mermas,pasarela/services/cobros,salones/anulaciones-reporte,turnos/sesiones-garzon,resumen-negocio}` | lectores con filtro de fecha | 2 |
| `backend/src/modules/pagos/pagos.service.ts` (`resumen`), `caja/caja.service.ts` (`resumenDescuadresDia`), `propinas/propina-reportes.service.ts` | "hoy" y serie diaria | 3 |
| `backend/src/common/invariants/dia-negocio.invariant.spec.ts` | nuevo: nadie arma un día a mano | 3 |
| `backend/src/modules/propinas/utils/rango-liquidacion.ts` (+ spec), `liquidacion-propinas.{service,controller}.ts` | período con fechas puras | 4 |
| `backend/test/dia-negocio.e2e-spec.ts` | nuevo: e2e del corte | 1–4 |
| `frontend/app/pages/configuracion/empresa.vue` | selector de corte | 5 |
| `frontend/app/composables/useDiaNegocio.ts`, `frontend/app/components/DiaNegocioNota.vue` | nuevos | 5 |
| 6 pantallas con filtro de fecha + `pages/propinas/index.vue` | nota, hoy del negocio, fechas puras | 4, 5 |
| `docs/…` | § 7 de la spec | 6 |

---

### Task 0: Worktree y entorno

- [ ] **Step 1: Crear el worktree desde `main`**

```bash
git -C /Users/m2pro/cmatheus/startup-app worktree add .claude/worktrees/hora-de-corte -b wt/hora-de-corte main
```

- [ ] **Step 2: Entorno.** Un worktree nuevo viene sin `.env` ni `node_modules`: sin `.env` el `reset-db.sh` choca por nombre de contenedor con el stack que ya corre. Copiar el `.env` del checkout principal (no el `.env.example`, cuyo `API_PROXY_TARGET` cuelga el proxy del frontend) e instalar dependencias:

```bash
cp /Users/m2pro/cmatheus/startup-app/.env /Users/m2pro/cmatheus/startup-app/.claude/worktrees/hora-de-corte/.env
cd /Users/m2pro/cmatheus/startup-app/.claude/worktrees/hora-de-corte/backend && npm ci
cd /Users/m2pro/cmatheus/startup-app/.claude/worktrees/hora-de-corte/frontend && npm ci
```

- [ ] **Step 3: Verificar el hook** (`git -C <worktree> config core.hooksPath` debe dar `.githooks`).

Todas las rutas de las tareas siguientes son relativas a la raíz del worktree. Usar rutas absolutas y `git -C`: el cwd puede volver a `main` a mitad de la tarea.

---

### Task 1: El dato y su configuración

**Files:**
- Modify: `backend/src/modules/tenants/entities/tenant.entity.ts`
- Modify: `backend/src/modules/tenants/dto/update-my-tenant.dto.ts`
- Test: `backend/src/modules/tenants/dto/update-my-tenant.dto.spec.ts`
- Create: `backend/test/dia-negocio.e2e-spec.ts`
- Modify: `startup-pos.sql` (documentación del esquema)

**Interfaces:**
- Produces: `Tenant.horaCorte: number` (columna `hora_corte`); `PATCH /tenants/me` acepta `horaCorte`; `GET /tenants/me` lo devuelve (el service devuelve la entity).

- [ ] **Step 1: Test del DTO que falla.** En `update-my-tenant.dto.spec.ts`, siguiendo el estilo del archivo (`plainToInstance` + `validate`):

```ts
describe('horaCorte', () => {
  it.each([0, 5, 6])('acepta %p', async (horaCorte) => {
    const errores = await validate(plainToInstance(UpdateMyTenantDto, { horaCorte }));
    expect(errores).toHaveLength(0);
  });

  it.each([7, -1, 2.5, '5', null])('rechaza %p', async (horaCorte) => {
    const errores = await validate(plainToInstance(UpdateMyTenantDto, { horaCorte }));
    expect(errores.map((e) => e.property)).toEqual(['horaCorte']);
  });

  it('ausente no se valida', async () => {
    const errores = await validate(plainToInstance(UpdateMyTenantDto, {}));
    expect(errores).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `cd backend && npx jest src/modules/tenants/dto/update-my-tenant.dto.spec.ts`
Expected: FAIL (los casos que rechazan pasan como válidos: `whitelist` no corre en `validate` y la propiedad no tiene decoradores).

- [ ] **Step 3: DTO.** Agregar al final de `UpdateMyTenantDto` (importar `IsInt`, `Min`, `Max`):

```ts
  // Hora local (0–6) a la que termina el día del negocio. `@ValidateIf` y no
  // `@IsOptional()`, por lo mismo que `nombre`: la columna es NOT NULL y un
  // `null` saltearía los validadores hasta el 500 de Postgres. Horas enteras y
  // solo de madrugada, por decisión del owner (spec de la hora de corte, § 2):
  // un corte de tarde pasaría ventas de la tarde al día anterior.
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(6)
  horaCorte?: number;
```

- [ ] **Step 4: Entity.** En `tenant.entity.ts`, un segundo `@Check` sobre la clase (el decorador se puede repetir) y la columna, con un docblock corto que apunte a la spec:

```ts
@Check('chk_tenants_hora_corte', '"hora_corte" BETWEEN 0 AND 6')
```

```ts
  /**
   * Hora local a la que termina el día del negocio (0 = medianoche). Un bar con
   * corte 5 cuenta la venta del domingo a la 01:30 en el sábado. El día se
   * calcula al consultar con el corte vigente: cambiarlo recalcula los reportes
   * pasados. Lo aplica `common/utils/rango-fecha.util.ts`, y solo ahí.
   * Spec: docs/superpowers/specs/2026-09-18-hora-de-corte-dia-negocio-design.md
   */
  @Column({ name: 'hora_corte', type: 'smallint', default: 0 })
  horaCorte: number;
```

`type` explícito: el esquema sale de las entities (synchronize) y el tipo inferido de `number` sería `integer`, no `smallint`. Actualizar `startup-pos.sql` con la columna y el CHECK (es documentación).

- [ ] **Step 5: Unit verde.** Run: `cd backend && npx jest src/modules/tenants`. Expected: PASS.

- [ ] **Step 6: e2e de la configuración (esqueleto de la suite).** Crear `backend/test/dia-negocio.e2e-spec.ts` con el `beforeAll` de `test/pagos-dia-local.e2e-spec.ts:163-200` (AppModule in-process, login `admin.paris@paris.cl`/`admin`, switch a Paris `550e8400-e29b-41d4-a716-446655440007`). Helper `fijarCorte(h)` que hace `PATCH /api/tenants/me { horaCorte: h }` y espera 200. `afterAll` llama `fijarCorte(0)` **antes** de cerrar la app. Casos:

```ts
describe('configuración', () => {
  it('PATCH guarda el corte y GET lo devuelve', async () => {
    await fijarCorte(5);
    const res = await request(app.getHttpServer())
      .get('/api/tenants/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body as { horaCorte: number }).horaCorte).toBe(5);
    await fijarCorte(0);
  });

  it.each([7, -1, 2.5])('rechaza %p con 400', async (horaCorte) => {
    const res = await request(app.getHttpServer())
      .patch('/api/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ horaCorte });
    expect(res.status).toBe(400);
  });
});
```

(Los casos de 400 prueban el pipe, que los tests del DTO no ejercen.)

- [ ] **Step 7: Pedir turno a la orquestadora**, correr `./scripts/reset-db.sh` desde el worktree (remonta `tecnica_backend` a este worktree y el synchronize crea la columna) y después:

Run: `cd backend && npx jest --config ./test/jest-e2e.json test/dia-negocio.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit** (con el recibo de `verify-feature`, porque toca el DTO y la entity de tenants):

```bash
git -C <worktree> add backend/src/modules/tenants/entities/tenant.entity.ts backend/src/modules/tenants/dto/update-my-tenant.dto.ts backend/src/modules/tenants/dto/update-my-tenant.dto.spec.ts backend/test/dia-negocio.e2e-spec.ts startup-pos.sql
git -C <worktree> commit -m "feat(tenants): la hora de corte del día del negocio, configurable de 0 a 6"
```

---

### Task 2: Fecha a rango: los filtros cortan en la hora del tenant

**Files:**
- Modify: `backend/src/common/utils/rango-fecha.util.ts`, `rango-fecha.util.spec.ts`
- Modify (lectores con `bordeFechaSql`/`bordeHastaSql`): `pagos/pagos.service.ts` (`listar` y `buildListarFilters`), `caja/caja.service.ts` (`tendenciaDescuadres`), `inventario/inventario.service.ts` (movimientos, ~1517 y ~1610), `mermas/mermas.service.ts` (`buildFilters` ~290/381 y `resumen` ~437), `pasarela/services/cobros.service.ts` (~579/642), `salones/anulaciones-reporte.service.ts` (`buildFilters` ~215/299, `resumen` ~419), `turnos/sesiones-garzon.service.ts` (`buildHistorialFilters` ~570–630 y `zonaHoraria` ~555), `resumen-negocio/resumen-negocio.service.ts` (`hoy`)
- Modify: los `*.service.spec.ts` de esos módulos que afirman el SQL viejo
- Modify: `backend/test/dia-negocio.e2e-spec.ts`

**Interfaces:**
- Produces (en `rango-fecha.util.ts`, exportados):

```ts
export interface DiaNegocio { zona: string; horaCorte: number }
/** Posiciones ($n, 1-based) de zona y corte en la lista de params del llamador. */
export interface IdxDiaNegocio { zona: number; corte: number }
export function requiereDiaNegocio(...valores: (string | undefined | null)[]): boolean;
export async function diaNegocioTenant(db: DataSource | EntityManager | Db, tenantId: string): Promise<DiaNegocio>;
export function empujarDiaNegocio(params: unknown[], dia: DiaNegocio): IdxDiaNegocio;
export function inicioDiaNegocioSql(fechaSql: string, idx: IdxDiaNegocio): string;
export function bordeFechaSql(columna: string, operador: '>=' | '<=' | '<' | '>', valor: string, idxValor: number, idx: IdxDiaNegocio | null): string;
export function bordeHastaSql(columna: string, valor: string, idxValor: number, idx: IdxDiaNegocio | null): string;
export function fechaMenosDias(fecha: string, dias: number): string;
export function diaNegocioEnZona(dia: DiaNegocio, instante: Date): string;
```

- Se mantienen sin cambio de conducta: `esFechaPura`, `zonaHorariaTenant` (que pasa a delegar en `diaNegocioTenant`), `fechaLocalTenant`, `instanteLocalTenant`, `instanteLocalEnZona`, que sigue usando el motor de precios.
- `requiereZonaTenant` se **renombra** a `requiereDiaNegocio`: la guarda ahora decide dos parámetros. El cambio de firma de los helpers (`idxZona: number` → `idx: IdxDiaNegocio | null`) hace que `typecheck` marque a todo llamador que falte; ese es el inventario de esta tarea.

- [ ] **Step 1: Tests del util que fallan.** En `rango-fecha.util.spec.ts`:
  - reescribir los strings esperados de `bordeFechaSql`/`bordeHastaSql` a la forma nueva;
  - agregar los casos de abajo;
  - importar los nombres nuevos.

  Los casos de timestamp (`T15:30:00Z` pasa tal cual) se conservan.

```ts
const IDX = { zona: 2, corte: 4 };

describe('bordeFechaSql', () => {
  it('expande la fecha pura al inicio del día del negocio: la fecha + el corte, en la zona', () => {
    expect(bordeFechaSql('mv.creado_el', '>=', '2026-08-01', 3, IDX)).toBe(
      ' AND mv.creado_el >= ((($3::date)::timestamp + make_interval(hours => $4::int)) AT TIME ZONE $2)',
    );
  });

  it('fecha pura sin zona ni corte resueltos es un error de programación, no $0', () => {
    expect(() => bordeFechaSql('mv.creado_el', '>=', '2026-08-01', 3, null)).toThrow();
  });
});

describe('bordeHastaSql', () => {
  it('la fecha pura incluye su día del negocio completo: < inicio del día siguiente', () => {
    expect(bordeHastaSql('mv.creado_el', '2026-08-16', 3, IDX)).toBe(
      ' AND mv.creado_el < ((($3::date + 1)::timestamp + make_interval(hours => $4::int)) AT TIME ZONE $2)',
    );
  });
});

describe('empujarDiaNegocio', () => {
  it('empuja zona y corte y devuelve sus posiciones 1-based', () => {
    const params: unknown[] = ['tenant'];
    expect(empujarDiaNegocio(params, { zona: 'America/Santiago', horaCorte: 5 })).toEqual({ zona: 2, corte: 3 });
    expect(params).toEqual(['tenant', 'America/Santiago', 5]);
  });
});

describe('diaNegocioEnZona', () => {
  const SANTIAGO = 'America/Santiago';
  it('antes del corte es el día anterior; en el corte, el día nuevo', () => {
    // 2026-09-13 04:59 y 05:00 en Santiago (UTC-3 en septiembre, ya en verano)
    expect(diaNegocioEnZona({ zona: SANTIAGO, horaCorte: 5 }, new Date('2026-09-13T07:59:00Z'))).toBe('2026-09-12');
    expect(diaNegocioEnZona({ zona: SANTIAGO, horaCorte: 5 }, new Date('2026-09-13T08:00:00Z'))).toBe('2026-09-13');
  });

  it('corte 0 es el calendario local, igual que antes', () => {
    expect(diaNegocioEnZona({ zona: SANTIAGO, horaCorte: 0 }, new Date('2026-09-13T04:30:00Z'))).toBe('2026-09-13');
  });

  // La noche del salto (00:00 → 01:00 del domingo 2026-09-06). Restar el corte
  // al INSTANTE y después colapsar daría el sábado; primero a hora local y
  // después restar da el domingo, que es lo correcto (spec § 5).
  it('la noche del cambio de horario: domingo 05:30 con corte 5 es domingo', () => {
    expect(diaNegocioEnZona({ zona: SANTIAGO, horaCorte: 5 }, new Date('2026-09-06T08:30:00Z'))).toBe('2026-09-06');
  });

  it('cruza mes y año con aritmética de calendario', () => {
    expect(diaNegocioEnZona({ zona: SANTIAGO, horaCorte: 5 }, new Date('2027-01-01T05:00:00Z'))).toBe('2026-12-31');
  });
});
```

  Y en el `describe('zonaHorariaTenant')`, que el mock devuelva también `hora_corte`, más un `describe('diaNegocioTenant')` que:
  - devuelva `{ zona, horaCorte }` a partir de la fila;
  - afirme sobre la cláusula `SELECT` que lee `t.hora_corte` (sobre la cláusula, no con `toContain`: un comentario la satisface);
  - sin fila, dé 404 como hoy.

- [ ] **Step 2:** Run: `cd backend && npx jest src/common/utils/rango-fecha.util.spec.ts` → Expected: FAIL (nombres que no existen, SQL viejo).

- [ ] **Step 3: Implementar en el util.** Mantener el tono de docblocks del archivo (el porqué, no el qué). Código:

```ts
export interface DiaNegocio {
  zona: string;
  horaCorte: number;
}

export interface IdxDiaNegocio {
  zona: number;
  corte: number;
}

export function requiereDiaNegocio(
  ...valores: (string | undefined | null)[]
): boolean {
  return valores.some((v) => v != null && v !== '' && esFechaPura(v));
}

export function empujarDiaNegocio(
  params: unknown[],
  dia: DiaNegocio,
): IdxDiaNegocio {
  params.push(dia.zona);
  const zona = params.length;
  params.push(dia.horaCorte);
  return { zona, corte: params.length };
}

/** Instante en que empieza el día del negocio `fechaSql` (una expresión `date`). */
export function inicioDiaNegocioSql(
  fechaSql: string,
  idx: IdxDiaNegocio,
): string {
  return `((${fechaSql})::timestamp + make_interval(hours => $${idx.corte}::int)) AT TIME ZONE $${idx.zona}`;
}

function exigirIdx(idx: IdxDiaNegocio | null): IdxDiaNegocio {
  if (idx == null) {
    throw new Error(
      'rango-fecha: hay una fecha pura sin zona ni corte resueltos (requiereDiaNegocio)',
    );
  }
  return idx;
}

export function bordeFechaSql(
  columna: string,
  operador: '>=' | '<=' | '<' | '>',
  valor: string,
  idxValor: number,
  idx: IdxDiaNegocio | null,
): string {
  return esFechaPura(valor)
    ? ` AND ${columna} ${operador} (${inicioDiaNegocioSql(`$${idxValor}::date`, exigirIdx(idx))})`
    : ` AND ${columna} ${operador} $${idxValor}`;
}

export function bordeHastaSql(
  columna: string,
  valor: string,
  idxValor: number,
  idx: IdxDiaNegocio | null,
): string {
  return esFechaPura(valor)
    ? ` AND ${columna} < (${inicioDiaNegocioSql(`$${idxValor}::date + 1`, exigirIdx(idx))})`
    : ` AND ${columna} <= $${idxValor}`;
}

export async function diaNegocioTenant(
  db: DataSource | EntityManager | Db,
  tenantId: string,
): Promise<DiaNegocio> {
  // Misma consulta que antes era la de `zonaHorariaTenant` (el porqué de cada
  // JOIN y filtro sigue en su docblock), más la columna del corte.
  const rows: { zona_horaria: string; hora_corte: number }[] = await db.query(
    `SELECT pr.zona_horaria AS zona_horaria,
            t.hora_corte AS hora_corte
       FROM tenants t
       JOIN provincia pr
         ON pr.provincia_id = t.provincia_id
        AND pr.eliminado_el IS NULL
       JOIN pais p
         ON p.pais_id = pr.pais_id
        AND p.eliminado_el IS NULL
      WHERE t.tenant_id = $1
        AND t.eliminado_el IS NULL`,
    [tenantId],
  );
  if (!rows[0]?.zona_horaria) {
    throw new NotFoundException('No se encontró la zona horaria del tenant');
  }
  return { zona: rows[0].zona_horaria, horaCorte: Number(rows[0].hora_corte) };
}

export async function zonaHorariaTenant(
  db: DataSource | EntityManager | Db,
  tenantId: string,
): Promise<string> {
  return (await diaNegocioTenant(db, tenantId)).zona;
}

export function diaNegocioEnZona(dia: DiaNegocio, instante: Date): string {
  const { fecha, hora } = instanteLocalEnZona(dia.zona, instante);
  return Number(hora.slice(0, 2)) < dia.horaCorte
    ? fechaMenosDias(fecha, 1)
    : fecha;
}
```

  `fechaMenosDias` se **mueve** desde `resumen-negocio.service.ts:103` (con su docblock) al util y se exporta. No se duplica. El docblock de `zonaHorariaTenant` se conserva: la historia de las tres copias sigue siendo el porqué de que haya una sola consulta.

- [ ] **Step 4:** Run: `cd backend && npx jest src/common/utils/rango-fecha.util.spec.ts` → Expected: PASS.

- [ ] **Step 5: Migrar los lectores.** Run: `cd backend && npm run typecheck`. La lista de errores es el inventario. Cada lector cambia con la misma forma, sin cambiar nada más de la consulta:

```ts
// antes
const zona = requiereZonaTenant(query.desde, query.hasta)
  ? await zonaHorariaTenant(this.db, tenantId)
  : null;
…
let idxZona = 0;
if (zona != null) {
  params.push(zona);
  idxZona = params.length;
}
…bordeFechaSql(col, '>=', query.desde, params.length, idxZona)

// después
const dia = requiereDiaNegocio(query.desde, query.hasta)
  ? await diaNegocioTenant(this.db, tenantId)
  : null;
…
const idxDia = dia ? empujarDiaNegocio(params, dia) : null;
…bordeFechaSql(col, '>=', query.desde, params.length, idxDia)
```

  Casos que no siguen la forma al pie de la letra:
  - **`pagos.service.ts` → `buildListarFilters`** lleva un contador `paramIdx` que tiene que valer `params.length + 1`. Después de `empujarDiaNegocio`, hacer `paramIdx = params.length + 1`. El parámetro `zona: string | null` de la firma pasa a ser `dia: DiaNegocio | null`.
  - **`sesiones-garzon.service.ts` → `buildHistorialFilters`** tiene SQL propio (`s.inicio_el >= ($n::date::timestamp AT TIME ZONE $z)` y `< (($n::date + 1)::timestamp …)`). Se reemplaza por `bordeFechaSql('s.inicio_el', '>=', …)` y `bordeHastaSql('s.inicio_el', …)`. Mantener el fail-fast de "filtro de fecha sin zona resuelta": ahora lo cubre `exigirIdx`, así que el `throw` propio sale solo si queda muerto. El privado `zonaHoraria()` pasa a `diaNegocio()` y devuelve `diaNegocioTenant(...)`; actualizar sus docblocks (el de ~573 cita el SQL viejo).
  - **`resumen-negocio.service.ts` → `hoy`:**
    - `fecha` pasa a `diaNegocioEnZona(dia, new Date())`, con `dia = await diaNegocioTenant(...)` (una consulta, como ahora).
    - Los params fijos pasan a `[tenantId, fecha, dia.zona, fechaSemanaPasada, dia.horaCorte]`, con `const IDX_DIA = { zona: 3, corte: 5 }` en lugar de `IDX_ZONA`.
    - `fechaMenosDias` se importa del util.
    - La llamada a `anulacionesReporteService.resumen` y `mermasService.resumen` sigue pasando `fecha` (pura), así que esos dos heredan el corte por su propio camino.
    - Actualizar el comentario de ~125–133, que habla de `instanteLocalEnZona`.

  Import en cada archivo: sacar `requiereZonaTenant`/`zonaHorariaTenant`, que dejan de usarse; lint lo marca.

- [ ] **Step 6: Specs unitarios de los lectores.** Run: `cd backend && npm test`. Los specs que mockean la consulta de zona tienen que devolver `[{ zona_horaria: 'America/Santiago', hora_corte: 0 }]`. Los que afirman el SQL viejo (`AT TIME ZONE $2` al lado de `::date::timestamp`) se actualizan a la forma nueva. Arreglar solo lo que cambió por esta tarea; si un spec falla por otra cosa, parar y reportar.

- [ ] **Step 7: e2e del filtro (rojo antes del paso 5, verde después).** En `dia-negocio.e2e-spec.ts`, un `describe('filtro por fecha')`. Preparación, siguiendo el molde de `pagos-dia-local.e2e-spec.ts`:
  - item de servicio propio, caja propia (`abrirCaja`), dos ventas pagadas con ids empujados uno por vez;
  - `afterAll` devuelve `fecha = NOW()`, cierra la caja y borra el item.

  Mover por SQL los dos pagos a instantes **fijos** del fin de semana del 2026-09-12:

```ts
/** Mueve el pago a esa hora LOCAL del tenant (zona de su provincia). */
async function moverAHoraLocal(pagoId: string, local: string): Promise<void> {
  await ds.query(
    `UPDATE pagos p
        SET fecha = ($2::timestamp AT TIME ZONE pr.zona_horaria)
       FROM tenants t
       JOIN provincia pr ON pr.provincia_id = t.provincia_id
      WHERE p.pago_id = $1 AND t.tenant_id = p.tenant_id`,
    [pagoId, local],
  );
}
// A = domingo 01:30 (del sábado con corte 5); B = domingo 05:30 (del domingo)
```

  Casos, con `GET /api/pagos?fechaDesde=X&fechaHasta=X&cajaId=<caja>`:
  - corte 5: `X = 2026-09-12` trae A y no B; `X = 2026-09-13` trae B y no A;
  - control con corte 0: `X = 2026-09-13` trae A y B, y `X = 2026-09-12` no trae ninguno;
  - timestamp explícito: con corte 5, `fechaDesde=2026-09-13T04:00:00Z` (domingo 01:00 local) sin `fechaHasta` trae A y B. Si el corte se le aplicara, A quedaría afuera.

  Cada caso fija su corte con `fijarCorte` antes de listar.

- [ ] **Step 8: Mutantes (revertir la conducta, no solo romper).** Cada uno se corre, se revierte y se vuelve a correr en verde. Anotar el resultado de cada uno en el commit.
  1. **El corte ignorado:** en `inicioDiaNegocioSql`, `make_interval(hours => $${idx.corte}::int * 0)`. El parámetro sigue referenciado; sacarlo haría fallar por el error de bind (500) y no por la conducta. Los casos de corte 5 del e2e tienen que fallar y los de corte 0 seguir verdes.
  2. **El orden prohibido:** en `diaNegocioEnZona`, restar las horas al instante antes de colapsar (`instanteLocalEnZona(dia.zona, new Date(instante.getTime() - dia.horaCorte * 3_600_000)).fecha`). Tiene que fallar el unit de la noche del cambio de horario, y solo ese.

  Tras revertir, verificar en los logs del backend la hora del reinicio del watcher antes de dar por limpio el proceso.

- [ ] **Step 9: Turno e2e + gate del backend.** Pedir turno. `./scripts/reset-db.sh` desde el worktree, y después:
  `cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e`, y `./scripts/reset-db.sh --verificar`.
  Mirar el exit code de cada comando: nada de `| tail` que lo tape.

- [ ] **Step 10: Commit** con recibo de `verify-feature`, stageando por ruta cada archivo tocado:

```bash
git -C <worktree> commit -m "feat(dia-negocio): los filtros por fecha cortan en la hora del tenant"
```

---

### Task 3: "Hoy" y la serie diaria, y la guarda contra el día armado a mano

**Files:**
- Modify: `backend/src/common/utils/rango-fecha.util.ts` (+ spec): `diaNegocioDeSql`
- Modify: `backend/src/modules/pagos/pagos.service.ts` (`resumen`, ~487–530), `caja/caja.service.ts` (`resumenDescuadresDia`, ~1867–1915), `propinas/propina-reportes.service.ts` (`filtrosVenta` ~256, ~384, ~497, ~547, `todosLosTurnosExcluidas` ~586, `tendencia` ~411, `zonaHoraria` ~277)
- Modify: `backend/src/modules/tenants/tenants.service.ts` (`findMine`) + su spec
- Create: `backend/src/common/invariants/dia-negocio.invariant.spec.ts`
- Modify: specs unitarios de esos services, `backend/test/dia-negocio.e2e-spec.ts`

**Interfaces:**
- Consumes: todo lo de la Task 2.
- Produces: `export function diaNegocioDeSql(instanteSql: string, idx: IdxDiaNegocio): string` y `GET /tenants/me` con `diaNegocioHoy: string` (`YYYY-MM-DD`).

- [ ] **Step 1: Test del fragmento** (en `rango-fecha.util.spec.ts`):

```ts
describe('diaNegocioDeSql', () => {
  it('primero a hora local, después resta el corte, después el día', () => {
    expect(diaNegocioDeSql('NOW()', { zona: 2, corte: 3 })).toBe(
      '(((NOW()) AT TIME ZONE $2) - make_interval(hours => $3::int))::date',
    );
  });
});
```

- [ ] **Step 2: Implementarlo** (con docblock que cite el caso del 2026-09-06 de la spec § 5):

```ts
export function diaNegocioDeSql(instanteSql: string, idx: IdxDiaNegocio): string {
  return `(((${instanteSql}) AT TIME ZONE $${idx.zona}) - make_interval(hours => $${idx.corte}::int))::date`;
}
```

- [ ] **Step 3: El test de invariante (rojo hoy).** `backend/src/common/invariants/dia-negocio.invariant.spec.ts`, con el estilo de `uuid-columns.invariant.spec.ts`:
  - recorre los `.ts` de `src/modules` que no son `.spec.ts`;
  - les quita comentarios de bloque y de línea, porque hay docblocks que citan el SQL viejo;
  - falla si queda alguna ocurrencia de estos patrones:
    - `/AT TIME ZONE \$/`: un día armado a mano en SQL;
    - `/CURRENT_DATE/`: el día en la zona de la sesión;
    - `/\b(instanteLocalEnZona|instanteLocalTenant|fechaLocalTenant)\(/` fuera de la allowlist.

```ts
// Hora de reloj, no día de negocio (spec § 3.2): el motor de precios y las
// promociones colapsan un instante a su fecha y hora LOCAL sin corte.
const RELOJ_ALLOWLIST = [
  'calculo-precios/calculo-precios.service.ts',
  'promociones/',
];
```

  El mensaje del `expect` lista `archivo:línea` de cada ofensor. Correrlo: Expected FAIL, con `pagos.service.ts` (resumen), `caja.service.ts` (resumenDescuadresDia) y `propina-reportes.service.ts`. Si aparece otro archivo, es un lector que la spec no listó: **parar y reportar** antes de seguir.

- [ ] **Step 4: Migrar los tres.**
  - **`pagos.resumen`:** `const dia = await diaNegocioTenant(...)` y `params = [tenantId]`, más `const idx = empujarDiaNegocio(params, dia)`. El filtro de cajas propias (`filtroDeMisCajas(params.length)`) se empuja **después**. El CTE queda así:

```sql
WITH d AS (SELECT ${diaNegocioDeSql('NOW()', idx)} AS dia),
     hoy AS (
       SELECT (${inicioDiaNegocioSql('d.dia', idx)}) AS desde,
              (${inicioDiaNegocioSql('d.dia + 1', idx)}) AS hasta
         FROM d
     )
```

    El resto de la consulta queda igual. Actualizar el docblock de ~481: "Hoy" pasa a ser el día del negocio.
  - **`caja.resumenDescuadresDia`:** mismo molde. `WITH hoy AS (SELECT ${diaNegocioDeSql('NOW()', idx)} AS d)` y los dos bordes con `inicioDiaNegocioSql('(SELECT d FROM hoy)', idx)` / `('(SELECT d FROM hoy) + 1', idx)`. Params `[tenantId, zona, corte]` vía `empujarDiaNegocio`.
  - **`propina-reportes.service.ts`:**
    - `zonaHoraria()` pasa a `diaNegocio(): Promise<DiaNegocio>`, y los métodos reciben `dia: DiaNegocio` en vez de `zona: string`.
    - En cada lista fija `[tenantId, rango.desde, rango.hasta, zona, …]`, el corte entra como **5.º** elemento: `[tenantId, rango.desde, rango.hasta, dia.zona, dia.horaCorte, …]`, con `const idx = { zona: 4, corte: 5 }`.
    - En `todosLosTurnosExcluidas`, el booleano pasa de `$5` a `$6`: revisar cada `$n` literal de esa consulta.
    - `($2::date::timestamp AT TIME ZONE $4)` pasa a `(${inicioDiaNegocioSql('$2::date', idx)})`, y lo mismo con `$3`. El `hasta` de este reporte ya es exclusivo: el llamador compensa, así que no se le suma 1.
    - En `tendencia`, el `SELECT` y el `GROUP BY (vp.creado_el AT TIME ZONE $4)::date` pasan a `${diaNegocioDeSql('vp.creado_el', idx)}`. El `generate_series($2::date, $3::date - 1, …)` no cambia, porque son fechas.

- [ ] **Step 5: `GET /tenants/me` con el hoy del negocio.** Test en `tenants.service.spec.ts`: `findMine` devuelve la entity más `diaNegocioHoy`. Mockear la consulta de `diaNegocioTenant` y fijar el reloj con `jest.useFakeTimers().setSystemTime(new Date('2026-09-13T07:30:00Z'))`, que en Santiago es domingo 04:30. Con corte 5 debe dar `'2026-09-12'`. Implementación:

```ts
async findMine(tenantId: string): Promise<Tenant & { diaNegocioHoy: string }> {
  const tenant = await this.findOne(tenantId);
  const dia = await diaNegocioTenant(this.db, tenantId);
  return { ...tenant, diaNegocioHoy: diaNegocioEnZona(dia, new Date()) };
}
```

- [ ] **Step 6: Unit verde** (`npx jest src/common src/modules/pagos src/modules/caja src/modules/propinas src/modules/tenants`), con la invariante en verde.

- [ ] **Step 7: e2e.** En `dia-negocio.e2e-spec.ts`:
  - **Dashboard / resumen de pagos.** Con corte 5, calcular por SQL el inicio del día de negocio de hoy: `(((NOW() AT TIME ZONE z) - interval '5 hours')::date::timestamp + interval '5 hours') AT TIME ZONE z`. Mover un pago a borde + 30 min y otro a borde − 30 min. Tomar deltas contra una lectura previa, como el molde de `pagos-dia-local`: `GET /api/pagos/resumen` cuenta el de después y no el de antes, y `GET /api/resumen-negocio/hoy` cuenta en `cobrado.hoy` el monto del de después. `cobrado` lee `p.creado_el`, así que se mueve esa columna además de `fecha`: ver `resumen-negocio.service.ts`, `condHoyPago`.
  - **`GET /api/tenants/me`** devuelve `diaNegocioHoy` igual al `(NOW() AT TIME ZONE z - 5h)::date` calculado en SQL.
  - **Serie de propinas.**
    - Crear una venta con `propinaDirecta`, como `crearVentaConPropina` en `test/liquidacion-propinas.e2e-spec.ts:123`. Ese spec usa Paris y el efectivo `…105`. Usar el ítem de **servicio** propio de esta suite, no el producto demo `…116`: el producto consume stock que otras suites también usan.
    - Mover su `venta_propina.creado_el` al domingo 2026-09-13 a la 01:30 local.
    - Con corte 5, `GET /api/propinas/reportes/resumen?desde=2026-09-12&hasta=2026-09-14` pone la propina en la fila `2026-09-12` de `tendencia`; con corte 0, en la `2026-09-13`.
    - Borrarla en `afterAll`, con soft delete, igual que el resto de la suite.
    - Si armar la propina exige más que ese helper, parar y reportar antes de inventar el fixture.

- [ ] **Step 8: Mutante.** En `diaNegocioDeSql`, `make_interval(hours => $${idx.corte}::int * 0)`, o sea el "hoy" y la serie de antes, a medianoche. Tienen que fallar los e2e del resumen de pagos y de la serie de propinas con corte 5. El dashboard y `diaNegocioHoy` **no** pasan por este fragmento: su "hoy" sale de `diaNegocioEnZona`, en TypeScript, que ya cubre el mutante 2 de la Task 2. Que sigan verdes acá es lo esperado, no un hueco. Revertir, verificar el reinicio del watcher y volver a verde.

- [ ] **Step 9: Turno + gate del backend** (igual que la Task 2, paso 9).

- [ ] **Step 10: Commit** con recibo de `verify-feature`: `feat(dia-negocio): hoy y la serie de propinas cortan en la hora del tenant, y nadie arma un día a mano`.

---

### Task 4: La liquidación de propinas usa el período del negocio

**Files:**
- Modify: `backend/src/modules/propinas/utils/rango-liquidacion.ts` (+ `rango-liquidacion.spec.ts`, que ya existe)
- Modify: `backend/src/modules/propinas/liquidacion-propinas.service.ts` (`crear` ~158, `liquidar` ~602, docblock de `computarReparto` ~203), `liquidacion-propinas.controller.ts` (`preview` ~49)
- Modify: `frontend/app/pages/propinas/index.vue` (~114, ~144)
- Modify: `backend/test/dia-negocio.e2e-spec.ts`

**Interfaces:**
- Produces: `export async function rangoLiquidacion(db: DataSource | EntityManager | Db, tenantId: string, fechaDesde: string, fechaHasta: string): Promise<{ fechaDesde: Date; fechaHasta: Date }>`, que reemplaza a `rangoLiquidacionDesde`. Y `LiquidacionPropinasService.resolverPeriodo(tenantId, fechaDesde, fechaHasta)`, que la usa el controller: el controller no toca la base.

Contrato:
- Una fecha pura en `fechaDesde` es el inicio de ese día del negocio.
- Una fecha pura en `fechaHasta` es **inclusiva**: el período termina al inicio del día del negocio siguiente, igual que `bordeHastaSql`.
- Un timestamp completo se respeta tal cual, como hoy (lo usan los e2e existentes).
- Se conservan las guardas actuales: ISO que `new Date` no sabe leer → 400, y `hasta <= desde` → 400. La de orden corre **después** de expandir, así que `desde = hasta = 2026-09-12` es un período válido de un día.

- [ ] **Step 1: Tests unitarios** de `rangoLiquidacion` con `db.query` mockeado:
  - dos fechas puras: una sola consulta, que expande `desde` con `inicioDiaNegocioSql('$1::date', …)` y `hasta` con `'$2::date + 1'`, y params `[desde, hasta, zona, corte]`;
  - dos timestamps: cero consultas y los `Date` tal cual;
  - la tabla de inválidos del docblock actual (`2026-02-31`, `2026-W32-1`, `20260807`) sigue dando 400;
  - orden invertido → 400.

  Afirmar sobre el SQL de la cláusula, no con `toContain` suelto.

- [ ] **Step 2:** verlos fallar. **Step 3: Implementar.** La expansión se hace en **una** consulta: `SELECT <desde> AS desde, <hasta> AS hasta`, con cada lado según sea fecha pura o `$n::timestamptz`, y los params de zona y corte vía `empujarDiaNegocio` solo si `requiereDiaNegocio(desde, hasta)`. Reescribir el docblock del archivo: la tabla de inválidos se queda, y se suma el contrato de fecha pura.

- [ ] **Step 4:** `crear` y `liquidar` llaman `await rangoLiquidacion(this.db, tenantId, …)`. El controller `preview` llama `await this.liquidaciones.resolverPeriodo(user.tenantId!, dto.fechaDesde, dto.fechaHasta)`. Actualizar los docblocks que nombran `rangoLiquidacionDesde`: `computarReparto` ~203, y los comentarios de los DTOs `create-liquidacion`, `preview-liquidacion` y `liquidar`.

- [ ] **Step 5: Frontend.** En `pages/propinas/index.vue`, `preview` y `liquidar` mandan `fechaDesde: fechaDesde.value` y `fechaHasta: fechaHasta.value` (fechas puras). Si `inicioDiaIso`/`finDiaExclusivoIso` quedan sin uso en `propinas/index.vue`, sacar el import. Siguen vivos en `useVigenciaRegla.ts`, que queda fuera. Verificar el `.nuxt.spec.ts` de propinas si afirma el body.

- [ ] **Step 6: e2e.** Con la propina de la Task 3 en el domingo 01:30 y corte 5, `POST /api/propinas/liquidaciones/preview` con `{ fechaDesde: '2026-09-12', fechaHasta: '2026-09-12' }` la incluye en el pool, y con `'2026-09-13'` no. Leer la forma de la respuesta del preview en `liquidacion-propinas.e2e-spec.ts:198` antes de afirmar. Un control con corte 0 muestra lo contrario. `2026-09-13` → `2026-09-12` da 400.

- [ ] **Step 7:** gate del backend completo + `cd frontend && npm run build && npm test && npm run typecheck:ratchet`. **Step 8: Commit** con recibo: `feat(propinas): la liquidación toma el período del día del negocio`.

---

### Task 5: El corte en pantalla

**Files:**
- Modify: `frontend/app/pages/configuracion/empresa.vue`
- Create: `frontend/app/composables/useDiaNegocio.ts`, `frontend/app/components/DiaNegocioNota.vue`
- Modify: `pages/sesiones-garzon.vue`, `pages/mermas.vue`, `pages/ordenes.vue`, `pages/propinas/index.vue`, `pages/salones/anulaciones.vue`, `components/caja/CajaTendencia.vue`
- Test: el `.nuxt.spec.ts` que ya exista de cada pantalla tocada, y uno nuevo para `DiaNegocioNota`

**Interfaces:**
- Consumes: `GET /tenants/me` → `{ horaCorte: number, diaNegocioHoy: string }`; `PATCH /tenants/me { horaCorte }`.
- Produces: `useDiaNegocio(): { horaCorte: Ref<number | null>, diaNegocioHoy: Ref<string | null>, cargar: () => Promise<void> }` y `<DiaNegocioNota />` (sin props; muestra *"Tu día va de HH:00 a HH:00"* si `horaCorte > 0`; si es 0 o no cargó, no renderiza nada).

Antes de escribir: cargar la skill `nuxt-ui`, y leer `frontend/docs/DESIGN-SYSTEM.md`. La nota es texto chico `text-muted` (token semántico, nada de Tailwind hardcodeado: el pre-commit lo bloquea).

- [ ] **Step 1: Empresa.** `TenantMe` suma `horaCorte: number`. El form carga `form.horaCorte = tenant.horaCorte` y `guardar()` lo manda. Campo con `USelect` de 7 opciones (`00:00` … `06:00`, `value` 0–6), `label="Fin del día"` y el texto de ayuda de la spec § 3.1 en la prop `help` de `UFormField`. Test en el spec de la página si existe; si no, crear `empresa.nuxt.spec.ts` que monte la página con `useApiFetch` mockeado y afirme que el PATCH lleva `horaCorte`. Ojo: el mock contesta 200 a cualquier body, así que el valor afirmado tiene que ser uno que el DTO acepte.
- [ ] **Step 2: `useDiaNegocio` + `DiaNegocioNota`.** El composable pide `/tenants/me` en `cargar()`, sin caché global. Cada pantalla lo pide al montar, y así no hay caché que sirva el corte de otro tenant tras cambiar de tenant (el riesgo que documenta `useMonedaConversion.ts:60-95`). Un error de red deja `horaCorte` en `null`, sin nota ni toast: es informativa. Tests de la nota: corte 5 → texto "Tu día va de 05:00 a 05:00"; corte 0 → no renderiza.
- [ ] **Step 3: La nota en las 6 pantallas**, directamente debajo de la fila de filtros de fecha de cada una.
- [ ] **Step 4: Anulaciones arranca en el hoy del negocio.** `filtroDesde`/`filtroHasta` siguen arrancando en `hoyLocal()`, porque la lista pide al montar. Al resolver `cargar()`, si `diaNegocioHoy` difiere y el usuario no tocó los filtros, se reemplazan los dos. Solo difieren entre las 00:00 y el corte. Test: con `diaNegocioHoy` = ayer, los filtros terminan en ayer.
- [ ] **Step 5:** `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`.
- [ ] **Step 6: Smoke en navegador** (Playwright con `frontend/e2e/auth.setup.ts`, no Claude Browser):
  - fijar el corte 5 en Empresa;
  - ver la nota en Anulaciones;
  - volver a 0 y ver que la nota desaparece.

  Resetear la base **antes** del smoke, con turno.
- [ ] **Step 7: Commit** con recibo: `feat(dia-negocio): el corte se configura en Empresa y los reportes lo avisan`.

---

### Task 6: Documentación y cierre

- [ ] **Step 1: Docs** (spec § 7), reescribiendo y no anexando:
  - `docs/PRODUCTO.md`: regla del día de negocio; recalcula; rango 0–6; la boleta lleva la fecha real.
  - `docs/ESTADO.md`: fila ✅ con fecha.
  - `docs/features/pagos.md`: "Hoy" es el día del negocio.
  - `docs/patterns/backend.md`: "un día se arma solo con `rango-fecha.util.ts`" (helpers con `IdxDiaNegocio`, `empujarDiaNegocio`, `diaNegocioDeSql`), y la invariante que lo hace cumplir.
  - `docs/agent/anti-patterns.md`: el párrafo de `CURRENT_DATE`/`::date` suma que el día también tiene corte, y apunta a `dia-negocio.invariant.spec.ts`.
  - `docs/agent/pendientes.md`: la entrada se muda a `docs/agent/resueltos.md`, con el detalle del fix.

  Borrar del backlog cualquier frase que nombre este frente como abierto: grepear "hora de corte" en `docs/`.
- [ ] **Step 2: Gate completo** desde el worktree (CLAUDE.md, checklist), con turno para el e2e, `--verificar` al final y exit code de cada comando.
- [ ] **Step 3: Revisión de rama.** Un domain-reviewer sobre el diff completo `main...wt/hora-de-corte`. Caza contradicciones **entre** tareas: por ejemplo, un lector de la Task 2 que la invariante de la Task 3 marcaría.
- [ ] **Step 4: Commit de docs** con recibo si hace falta. Reportar al owner y pedir aprobación para mergear. Tras el merge y con el push aprobado:
  - CI;
  - deploy de Railway en SUCCESS: la columna nueva la crea synchronize con su default;
  - `./scripts/smoke-produccion.sh`.

---

## Decisions / Open questions

- **Decidido (owner, 2026-09-18):** recalcula; una hora; 00:00–06:00; horas enteras; 0 por defecto; nota junto al filtro.
- **Decidido en el plan:**
  - Los helpers reciben un `IdxDiaNegocio` (objeto) en vez de un índice suelto, así el typecheck encuentra a todo llamador.
  - `make_interval(hours => $n::int)` con cast explícito del parámetro.
  - La caché del corte en el frontend es por montaje de pantalla, no global.
- **Abierto:** ninguno. Si un paso encuentra un lector que la spec no lista (paso 3 de la Task 3), se para y se consulta.
