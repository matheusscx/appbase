# Header de caja — ocultamiento real en modo ciego + config admin-only + fix badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el modo ciego (`tenants.arqueo_ciego`) oculte de verdad las cifras del turno y la lista de movimientos (enforcement en backend, no solo visual), que su configuración sea admin-only, y arreglar el color del badge de estado `en_conciliacion`.

**Architecture:** Se endurecen dos endpoints existentes de caja (`resumenMovimientos`, `listarMovimientos`) con el mismo gating que `obtenerArqueo` (`arqueo_ciego && estado === 'abierta'`); el `PUT /caja/arqueo-ciego` pasa de permiso de módulo a `TenantAdminGuard`; el front consume un booleano `ciego` del resumen para decidir el layout sin adivinar por nulls. Sin rutas, columnas, dependencias ni conceptos nuevos.

**Tech Stack:** NestJS + TypeORM (PostgreSQL 15, raw queries), Decimal.js, Jest (unit + e2e/supertest); Nuxt 4 + Vue 3 + Pinia + Nuxt UI, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-header-caja-ciego-design.md`

## Global Constraints

- `tenant_id`/`usuario_id` SIEMPRE del token JWT — nunca del body/query/ruta (invariante 1). Ninguna firma de service cambia de fuente de tenant.
- Dinero con **Decimal.js**, nunca `number` nativo; montos serializados con `.toFixed(4)`.
- **Soft delete**: toda `SELECT`/`JOIN` filtra `eliminado_el IS NULL` (ya presente; no removerlo).
- **Enforcement en backend** (invariante 6): el ocultamiento del ciego y el admin-only viven en el backend; el front nunca sustituye al guard.
- **Gating del ciego = espejo de `obtenerArqueo`**: en ciego cuando `getArqueoCiego(tenant) === true` **y** `caja.estado === 'abierta'`. En `en_conciliacion`/`cerrada` se revela. NO condicionar la rama ciega a `tieneVerTodas` (ni cajero ni supervisor ven en vivo).
- **Sin N+1**: `getArqueoCiego` se consulta una sola vez por request, nunca por fila.
- **Colores del badge (exactos):** `abierta` → `success`, `en_conciliacion` → `warning`, `cerrada` → `neutral`.
- **Config del ciego admin-only** vía `TenantAdminGuard` (patrón catálogos/config). El **CRUD de cajones** de la misma pantalla sigue en `Cajas:Actualizar` — no tocar su gate.
- Colores financieros hardcodeados permitidos SOLO en el módulo Caja (excepción del design system).
- No tocar el motor de precios, `movimientos_inventario` ni `modo_inventario`.
- Estado de desarrollo: commitear directo a `main`, sin ramas/PRs. Cada task corre sus checks antes de commitear.

---

## File Structure

**Backend**
- `backend/src/modules/caja/caja.service.ts` — interfaz `CajaTurnoResumen` (+`ciego`, totales nullable); `resumenMovimientos` y `listarMovimientos` blind-aware.
- `backend/src/modules/caja/caja.controller.ts` — `PUT /caja/arqueo-ciego` a `TenantAdminGuard`.
- `backend/src/modules/caja/caja.controller.spec.ts` — test de guard admin-only.
- `backend/test/caja.e2e-spec.ts` — e2e del ocultamiento ciego en resumen/movimientos.

**Frontend**
- `frontend/app/stores/caja.ts` — interfaz `CajaTurnoResumen` (+`ciego`, totales nullable); no-op de patches optimistas en ciego; seed de apertura.
- `frontend/app/stores/caja.spec.ts` — tests del no-op ciego + seed.
- `frontend/app/components/caja/CajaTurnoResumen.vue` — prop `ciego`, oculta 3 tarjetas.
- `frontend/app/components/caja/CajaActivaDashboard.vue` — pasa `ciego`, oculta la tabla.
- `frontend/app/components/caja/CajaTurnoHeader.vue` — mapa de color del badge.
- `frontend/app/pages/configuracion/cajas.vue` — toggle del ciego gateado admin-only.

**Docs**
- `docs/features/gestion-cajas.md` — alcance del modo ciego + config admin-only.

---

### Task 1: Backend — ocultamiento ciego en resumen y lista de movimientos

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts:60-66` (interfaz `CajaTurnoResumen`), `:1084-1132` (`resumenMovimientos`), `:1134-1201` (`listarMovimientos`)
- Test: `backend/test/caja.e2e-spec.ts` (nuevo `describe` con helpers existentes)

**Interfaces:**
- Consumes: `getArqueoCiego(tenantId): Promise<boolean>` (ya existe, `caja.service.ts:403`); `verificarAccesoCaja(...)` devuelve `Caja` con `.estado`; `resolvePagination`, `buildPaginationMeta` (ya importados).
- Produces: `CajaTurnoResumen` con forma `{ ciego: boolean; saldoInicial: string; totalEntradas: string | null; totalSalidas: string | null; saldoEsperado: string | null; totalMovimientos: number | null }`. `resumenMovimientos` devuelve `ciego:true` + totales `null` cuando ciego+abierta. `listarMovimientos` devuelve página vacía (`data:[]`, `meta.total:0`) cuando ciego+abierta.

- [ ] **Step 1: Escribir el test e2e que falla**

En `backend/test/caja.e2e-spec.ts`, agregar este `describe` al final del archivo (antes del cierre del `describe` raíz si aplica; es un `describe` de nivel superior con su propio setup). Usa los helpers ya definidos en el archivo (`login`, `abrirOReusarCaja`, `cerrarEnDosFases`) y el patrón de toggle del flag vía `DataSource`:

```ts
describe('Caja (e2e) — modo ciego oculta resumen y movimientos del turno', () => {
  let app: INestApplication<App>;
  let token: string;
  let adminToken: string;
  let cajonId: string;
  let ds: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);

    token = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    adminToken = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    const r = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: `E2E Ciego Resumen ${Date.now()}` });
    cajonId = (r.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    await ds.query('UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1', [
      PARIS_TENANT_ID,
    ]);
    if (cajonId) {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${adminToken}`);
    }
    await app.close();
  });

  it('ciego + caja abierta: resumen oculta cifras (ciego:true, totales null, saldoInicial presente) y movimientos devuelve página vacía', async () => {
    const cajaId = await abrirOReusarCaja(app, token, cajonId);
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'salida', concepto: 'retiro', monto: '500.0000' });
    await ds.query('UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1', [
      PARIS_TENANT_ID,
    ]);

    const resumen = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${token}`);
    expect(resumen.status).toBe(200);
    const rb = resumen.body as Record<string, unknown>;
    expect(rb.ciego).toBe(true);
    expect(rb.saldoInicial).toBe('10000.0000');
    expect(rb.totalEntradas).toBeNull();
    expect(rb.totalSalidas).toBeNull();
    expect(rb.saldoEsperado).toBeNull();
    expect(rb.totalMovimientos).toBeNull();

    const movs = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`);
    expect(movs.status).toBe(200);
    const mb = movs.body as { data: unknown[]; meta: { total: number } };
    expect(mb.data).toEqual([]);
    expect(mb.meta.total).toBe(0);

    // Reveal al conciliar: descuadre → en_conciliacion → estado !== 'abierta' → revela.
    const conteo = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ metodoPagoId: null, montoContado: '12345.0000' }] });
    expect((conteo.body as { estado: string }).estado).toBe('en_conciliacion');

    const resumenReveal = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${token}`);
    const rr = resumenReveal.body as Record<string, unknown>;
    expect(rr.ciego).toBe(false);
    expect(rr.totalSalidas).toBe('500.0000');
    const movsReveal = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`);
    expect((movsReveal.body as { meta: { total: number } }).meta.total).toBe(1);

    // Higiene (evita caja colgada en_conciliacion en reruns locales): fase 2 con un
    // motivo real. En descuadre, POST /cerrar exige motivo por línea (sub-proyecto C).
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${adminToken}`);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ metodoPagoId: null, motivoDiferenciaId: motivoId }] });
  });

  it('arqueo_ciego off: resumen revela cifras y movimientos lista las filas', async () => {
    await ds.query('UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1', [
      PARIS_TENANT_ID,
    ]);
    const cajaId = await abrirOReusarCaja(app, token, cajonId);
    const resumen = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${token}`);
    const rb = resumen.body as Record<string, unknown>;
    expect(rb.ciego).toBe(false);
    expect(rb.saldoEsperado).toBe('10000.0000');
    await cerrarEnDosFases(app, cajaId, token, [
      { metodoPagoId: null, montoContado: '10000.0000' },
    ]);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npm run test:e2e -- caja`
Expected: FAIL — el resumen actual no tiene `ciego` (`rb.ciego` es `undefined`, no `true`), los totales no son `null`, y `movimientos` devuelve las filas en vez de página vacía.

- [ ] **Step 3: Actualizar la interfaz `CajaTurnoResumen`**

En `backend/src/modules/caja/caja.service.ts:60-66`, reemplazar la interfaz:

```ts
export interface CajaTurnoResumen {
  ciego: boolean;
  saldoInicial: string;
  totalEntradas: string | null;
  totalSalidas: string | null;
  saldoEsperado: string | null;
  totalMovimientos: number | null;
}
```

- [ ] **Step 4: Hacer `resumenMovimientos` blind-aware**

En `caja.service.ts`, reemplazar el cuerpo de `resumenMovimientos` (`:1084-1132`). Sumar `c.estado` al `SELECT` y al `GROUP BY`, chequear el ciego una sola vez, y devolver la forma ciega cuando corresponde:

```ts
  async resumenMovimientos(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas = false,
  ): Promise<CajaTurnoResumen> {
    await this.verificarAccesoCaja(tenantId, usuarioId, cajaId, tieneVerTodas);

    const rows: {
      saldo_inicial: string;
      estado: string;
      total_entradas: string;
      total_salidas: string;
      total_movimientos: number;
    }[] = await this.dataSource.query(
      `SELECT c.saldo_inicial,
              c.estado,
              COALESCE(SUM(m.monto) FILTER (
                WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL
              ), 0)::text AS total_entradas,
              COALESCE(SUM(m.monto) FILTER (
                WHERE m.tipo = 'salida' AND m.eliminado_el IS NULL
              ), 0)::text AS total_salidas,
              COUNT(m.movimiento_id) FILTER (
                WHERE m.eliminado_el IS NULL
              )::int AS total_movimientos
       FROM cajas c
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       WHERE c.caja_id = $1
         AND c.tenant_id = $2
         AND c.eliminado_el IS NULL
       GROUP BY c.saldo_inicial, c.estado`,
      [cajaId, tenantId],
    );

    const row = rows[0];
    const saldoInicial = new Decimal(row?.saldo_inicial ?? '0');
    const estado = row?.estado ?? 'abierta';

    // Gating espejo de obtenerArqueo: ciego solo mientras la caja está abierta.
    // getArqueoCiego se consulta una sola vez por request (sin N+1).
    const ciego = (await this.getArqueoCiego(tenantId)) && estado === 'abierta';
    if (ciego) {
      return {
        ciego: true,
        saldoInicial: saldoInicial.toFixed(4),
        totalEntradas: null,
        totalSalidas: null,
        saldoEsperado: null,
        totalMovimientos: null,
      };
    }

    const totalEntradas = new Decimal(row?.total_entradas ?? '0');
    const totalSalidas = new Decimal(row?.total_salidas ?? '0');
    return {
      ciego: false,
      saldoInicial: saldoInicial.toFixed(4),
      totalEntradas: totalEntradas.toFixed(4),
      totalSalidas: totalSalidas.toFixed(4),
      saldoEsperado: saldoInicial.plus(totalEntradas).minus(totalSalidas).toFixed(4),
      totalMovimientos: row?.total_movimientos ?? 0,
    };
  }
```

- [ ] **Step 5: Hacer `listarMovimientos` blind-aware**

En `caja.service.ts:1141`, capturar la caja de `verificarAccesoCaja` y cortar temprano con página vacía cuando ciego+abierta. Reemplazar la línea:

```ts
    await this.verificarAccesoCaja(tenantId, usuarioId, cajaId, tieneVerTodas);
```

por:

```ts
    const caja = await this.verificarAccesoCaja(
      tenantId,
      usuarioId,
      cajaId,
      tieneVerTodas,
    );

    // Ciego + abierta: el operador no recibe montos por ningún camino (ni devtools).
    // Se corta antes de la query de filas. getArqueoCiego una sola vez (sin N+1).
    if (caja.estado === 'abierta' && (await this.getArqueoCiego(tenantId))) {
      const { page, pageSize } = resolvePagination(query);
      return { data: [], meta: buildPaginationMeta(page, pageSize, 0) };
    }
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `cd backend && npm run test:e2e -- caja`
Expected: PASS — ambos `it` verdes. Correr también el unit de service por si la interfaz rompió algo: `npm test -- caja.service`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts backend/test/caja.e2e-spec.ts
git commit -m "feat(caja): ocultar resumen y movimientos del turno en modo ciego (backend)"
```

---

### Task 2: Backend + config — `PUT /caja/arqueo-ciego` admin-only

**Files:**
- Modify: `backend/src/modules/caja/caja.controller.ts:104-110` (guard del `PUT`)
- Modify: `backend/src/modules/caja/caja.controller.spec.ts:368-384` (título del describe + test de guard)
- Modify: `frontend/app/pages/configuracion/cajas.vue:49-51` (computed nuevo) y `:315` (bind del toggle)

**Interfaces:**
- Consumes: `TenantAdminGuard` (ya importado en el controller, `:19`); `perms.esAdmin` (ya usado en la página, `:49-51`).
- Produces: `setArqueoCiego` protegido por `TenantAdminGuard`. Front: `puedeConfigCiego` gatea solo el toggle del ciego.

- [ ] **Step 1: Escribir el test de guard que falla**

En `backend/src/modules/caja/caja.controller.spec.ts`, arriba del todo agregar el import (idempotente; el polyfill ya lo carga NestJS):

```ts
import 'reflect-metadata';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
```

Renombrar el `describe('config arqueo-ciego (permiso Cajas)')` (`:368`) a `describe('config arqueo-ciego (admin-only)')` y agregarle este `it`:

```ts
    it('PUT arqueo-ciego está protegido por TenantAdminGuard (config admin-only)', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        CajaController.prototype.setArqueoCiego,
      ) as unknown[];
      expect(guards).toContain(TenantAdminGuard);
    });
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npm test -- caja.controller`
Expected: FAIL — hoy el handler no tiene `TenantAdminGuard` a nivel de método (`guards` es `undefined` o no lo contiene).

- [ ] **Step 3: Cambiar el guard del endpoint**

En `backend/src/modules/caja/caja.controller.ts`, reemplazar el decorador del `PUT` (`:104-105`):

```ts
  @Put('arqueo-ciego')
  @RequiresPermiso('Cajas', 'Actualizar')
  async setArqueoCiego(@Req() req: Request, @Body() dto: SetArqueoCiegoDto) {
```

por (mismo patrón que `justificarDiferencias`, `:119-120`):

```ts
  @Put('arqueo-ciego')
  @UseGuards(TenantAdminGuard)
  async setArqueoCiego(@Req() req: Request, @Body() dto: SetArqueoCiegoDto) {
```

El `GET /caja/arqueo-ciego` (`:96-102`) NO cambia: queda en `@RequiresPermiso('Cajas', 'Leer')`.

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd backend && npm test -- caja.controller`
Expected: PASS.

- [ ] **Step 5: Gatear el toggle del ciego en el front (admin-only)**

En `frontend/app/pages/configuracion/cajas.vue`, tras `puedeActualizar` (`:50`) agregar:

```ts
const puedeConfigCiego = computed(() => perms.esAdmin)
```

y en el `USwitch` del arqueo ciego (`:313-315`) cambiar el `:disabled`:

```vue
        <USwitch
          :model-value="arqueoCiego"
          :disabled="savingArqueoCiego || !puedeConfigCiego"
```

No tocar el `USwitch` ni los botones del CRUD de cajones (`:257-275`): siguen usando `puedeActualizar` (`Cajas:Actualizar`).

- [ ] **Step 6: Verificar typecheck del front**

Run: `cd frontend && npm run typecheck:ratchet`
Expected: sin nuevos errores de tipo.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/caja/caja.controller.ts backend/src/modules/caja/caja.controller.spec.ts frontend/app/pages/configuracion/cajas.vue
git commit -m "feat(caja): config de arqueo ciego admin-only (TenantAdminGuard + toggle gateado)"
```

---

### Task 3: Frontend store — resumen del turno consciente del ciego

**Files:**
- Modify: `frontend/app/stores/caja.ts:33-39` (interfaz), `:83-88` (`recalcularSaldoEsperado`), `:133-139` (seed en `abrir`), `:156-167` (`aplicarMovimientoLocal`)
- Test: `frontend/app/stores/caja.spec.ts`

**Interfaces:**
- Consumes: la forma `{ ciego, saldoInicial, totalEntradas, totalSalidas, saldoEsperado, totalMovimientos }` que devuelve `GET /caja/:id/movimientos/resumen` (Task 1).
- Produces: interfaz `CajaTurnoResumen` con `ciego: boolean` y totales `string | null` / `number | null`; patches optimistas (`aplicarMovimientoLocal`, `recalcularSaldoEsperado`) hacen no-op en ciego; `abrir` siembra `ciego: false`.

- [ ] **Step 1: Escribir los tests que fallan**

En `frontend/app/stores/caja.spec.ts`, agregar este `describe`:

```ts
describe('useCajaStore — resumen ciego', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiFetch.mockReset()
  })

  it('aplicarMovimientoLocal es no-op cuando el resumen es ciego', () => {
    const store = useCajaStore()
    store.resumenTurno = {
      ciego: true,
      saldoInicial: '1000.0000',
      totalEntradas: null,
      totalSalidas: null,
      saldoEsperado: null,
      totalMovimientos: null,
    }
    store.aplicarMovimientoLocal('entrada', '500')
    expect(store.resumenTurno.totalEntradas).toBeNull()
    expect(store.resumenTurno.saldoEsperado).toBeNull()
    expect(store.resumenTurno.totalMovimientos).toBeNull()
  })

  it('aplicarMovimientoLocal actualiza totales cuando NO es ciego', () => {
    const store = useCajaStore()
    store.resumenTurno = {
      ciego: false,
      saldoInicial: '1000.0000',
      totalEntradas: '0.0000',
      totalSalidas: '0.0000',
      saldoEsperado: '1000.0000',
      totalMovimientos: 0,
    }
    store.aplicarMovimientoLocal('entrada', '500')
    expect(store.resumenTurno.totalEntradas).toBe('500.0000')
    expect(store.resumenTurno.saldoEsperado).toBe('1500.0000')
  })

  it('abrir siembra resumenTurno con ciego:false', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue({ ...CAJA, saldoInicial: '1000.0000' })
    await store.abrir({ saldoInicial: '1000.0000', cajonId: 'cajon-1' })
    expect(store.resumenTurno?.ciego).toBe(false)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd frontend && npm test -- caja`
Expected: FAIL — el no-op ciego lanza al hacer `new Decimal(null)`; `abrir` no siembra `ciego` (queda `undefined`).

- [ ] **Step 3: Actualizar la interfaz del store**

En `frontend/app/stores/caja.ts:33-39`, reemplazar la interfaz:

```ts
export interface CajaTurnoResumen {
  ciego: boolean
  saldoInicial: string
  totalEntradas: string | null
  totalSalidas: string | null
  saldoEsperado: string | null
  totalMovimientos: number | null
}
```

- [ ] **Step 4: No-op de los patches optimistas en ciego**

En `caja.ts:83-88`, reemplazar `recalcularSaldoEsperado`:

```ts
function recalcularSaldoEsperado(r: CajaTurnoResumen) {
  if (r.ciego || r.saldoEsperado === null) return
  r.saldoEsperado = new Decimal(r.saldoInicial)
    .plus(r.totalEntradas ?? '0')
    .minus(r.totalSalidas ?? '0')
    .toFixed(4)
}
```

En `caja.ts:156-167`, reemplazar `aplicarMovimientoLocal`:

```ts
  /** Patch local del resumen tras un movimiento (sin GET). No-op en modo ciego. */
  function aplicarMovimientoLocal(tipo: 'entrada' | 'salida', monto: string, count = 1) {
    const r = resumenTurno.value
    if (!r || r.ciego) return
    if (tipo === 'entrada') {
      r.totalEntradas = new Decimal(r.totalEntradas ?? '0').plus(monto).toFixed(4)
    }
    else {
      r.totalSalidas = new Decimal(r.totalSalidas ?? '0').plus(monto).toFixed(4)
    }
    r.totalMovimientos = (r.totalMovimientos ?? 0) + count
    recalcularSaldoEsperado(r)
  }
```

- [ ] **Step 5: Sembrar `ciego` en la apertura**

En `caja.ts:133-139`, agregar `ciego: false` al seed de `resumenTurno` dentro de `abrir`:

```ts
    resumenTurno.value = {
      ciego: false,
      saldoInicial: caja.saldoInicial,
      totalEntradas: '0.0000',
      totalSalidas: '0.0000',
      saldoEsperado: caja.saldoInicial,
      totalMovimientos: 0,
    }
```

El valor real del ciego lo trae `cargarResumenTurno` al montar el dashboard; el seed `false` es inocuo en apertura (entradas/salidas son 0 y el esperado == saldo inicial, ya visible).

- [ ] **Step 6: Correr los tests para verificar que pasan**

Run: `cd frontend && npm test -- caja`
Expected: PASS (incluidos los tests preexistentes del store).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/stores/caja.ts frontend/app/stores/caja.spec.ts
git commit -m "feat(caja): store del resumen consciente del modo ciego (no-op optimista + seed)"
```

---

### Task 4: Frontend — ocultar tarjetas y tabla en ciego + fix badge + docs

Sin test de componente (el proyecto no tiene infra de test de `.vue`); se verifica con `typecheck` + `build` + `design:check` y **smoke de navegador**.

**Files:**
- Modify: `frontend/app/components/caja/CajaTurnoResumen.vue` (prop `ciego`, oculta 3 tarjetas)
- Modify: `frontend/app/components/caja/CajaActivaDashboard.vue` (pasa `ciego`, oculta la tabla)
- Modify: `frontend/app/components/caja/CajaTurnoHeader.vue` (mapa de color del badge)
- Modify: `docs/features/gestion-cajas.md` (alcance del ciego + config admin-only)

**Interfaces:**
- Consumes: `cajaStore.resumenTurno.ciego` (Task 3).
- Produces: dashboard oculta `CajaMovimientosTable` cuando ciego; resumen muestra solo `Saldo inicial`; badge con color por estado.

- [ ] **Step 1: Prop `ciego` en `CajaTurnoResumen.vue`**

En `frontend/app/components/caja/CajaTurnoResumen.vue`, agregar `ciego?: boolean` al `defineProps`:

```ts
defineProps<{
  saldoInicial: string
  totalEntradas: Decimal
  totalSalidas: Decimal
  saldoEsperado: Decimal
  ciego?: boolean
  loading?: boolean
}>()
```

Adaptar el grid a 1 columna en ciego y envolver las 3 tarjetas financieras con `v-if="!ciego"`. Cambiar la línea del grid:

```vue
  <div class="grid gap-4" :class="ciego ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-4'">
```

y agregar `v-if="!ciego"` al `<div>` de cada tarjeta de Entradas, Salidas y Saldo esperado (las tres tarjetas con fondo `bg-green-50` / `bg-red-50` / `bg-blue-50`). La tarjeta `Saldo inicial` queda sin condición.

- [ ] **Step 2: Pasar `ciego` y ocultar la tabla en `CajaActivaDashboard.vue`**

En `frontend/app/components/caja/CajaActivaDashboard.vue`, agregar el computed tras `saldoEsperado` (`:31-33`):

```ts
const ciego = computed(() => cajaStore.resumenTurno?.ciego ?? false)
```

Pasar el prop al resumen (`:78-84`):

```vue
      <CajaTurnoResumen
        :saldo-inicial="caja.saldoInicial"
        :total-entradas="totalEntradas"
        :total-salidas="totalSalidas"
        :saldo-esperado="saldoEsperado"
        :ciego="ciego"
        :loading="loadingResumen"
      />
```

y ocultar la tabla (`:87`) — sin placeholder:

```vue
    <CajaMovimientosTable v-if="!ciego" ref="movimientosTable" :caja-id="caja.id" />
```

- [ ] **Step 3: Mapa de color del badge en `CajaTurnoHeader.vue`**

En `frontend/app/components/caja/CajaTurnoHeader.vue`, agregar el computed tras `enConciliacion` (`:19`):

```ts
const badgeColor = computed(() => {
  if (props.caja.estado === 'abierta') return 'success'
  if (props.caja.estado === 'en_conciliacion') return 'warning'
  return 'neutral'
})
```

y usarlo en el `UBadge` (`:29`):

```vue
        <UBadge :color="badgeColor" variant="soft">
```

- [ ] **Step 4: Verificar typecheck, build y design**

Run: `cd frontend && npm run typecheck:ratchet && npm run design:check && npm run build`
Expected: PASS — sin nuevos errores de tipo, sin tokens hardcodeados fuera de la excepción de Caja, build OK.

- [ ] **Step 5: Actualizar la doc de la feature**

En `docs/features/gestion-cajas.md`, agregar una subsección sobre el alcance del modo ciego (ubicarla junto a la sección de cierre/arqueo ciego; si no hay una clara, antes de `## Related` / al final):

```markdown
### Alcance del modo ciego (arqueo_ciego)

Cuando el tenant opera en modo ciego, mientras la caja está `abierta` el operador
—cajero o supervisor— **no ve ninguna cifra derivable del esperado**: el backend
(`resumenMovimientos`, `listarMovimientos`) devuelve `ciego:true` con
entradas/salidas/esperado en `null` y la lista de movimientos vacía. El header
muestra solo `Saldo inicial` y no se renderiza la tabla de movimientos (sin
placeholder). Al **conciliar** (fase 1 → `en_conciliacion`) o cerrar, se revela todo
como detalle del arqueo. El gating espeja `obtenerArqueo`
(`arqueo_ciego && estado === 'abierta'`) y no depende de quién mira.

**Configurar el modo ciego es admin-only** (`TenantAdminGuard` en `PUT /caja/arqueo-ciego`):
es una política anti-fraude, no una acción operativa. El CRUD de cajones de la misma
pantalla sigue delegable a `Cajas:Actualizar`. Criterio: `docs/features/roles-permisos.md`,
sección "Admin-only vs permiso de módulo".
```

- [ ] **Step 6: Smoke de navegador**

Con el stack corriendo (`docker-compose up`), login `admin.paris@paris.cl` / `admin`:
1. Configuración → Cajas: activar "Arqueo ciego". Verificar que el toggle está habilitado para el admin.
2. Abrir una caja física; registrar un movimiento de salida.
3. En el detalle de la caja: el header muestra **solo** `Saldo inicial` (sin Entradas/Salidas/Saldo esperado) y **no** aparece la tabla de movimientos ni su encabezado.
4. En devtools → Network: `GET .../movimientos/resumen` devuelve `ciego:true` y totales `null`; `GET .../movimientos` devuelve `data:[]`.
5. Enviar el conteo con un descuadre → `en_conciliacion`: ahora se revelan tarjetas + tabla como detalle del arqueo.
6. Badge: `abierta` verde, `en_conciliacion` naranja, una caja cerrada del historial gris.
7. Desactivar el arqueo ciego y verificar que el header y la tabla vuelven a mostrarse siempre.
8. Consola del navegador sin errores.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/caja/CajaTurnoResumen.vue frontend/app/components/caja/CajaActivaDashboard.vue frontend/app/components/caja/CajaTurnoHeader.vue docs/features/gestion-cajas.md
git commit -m "feat(caja): header ciego oculta tarjetas y tabla + fix color badge en_conciliacion"
```

---

## Verificación de cierre (antes de dar el trabajo por terminado)

Correr el gate completo del proyecto (mismo que corre CI):

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Todo verde. Además: revisión de juicio (invariantes, N+1, alcance) vía skill `verify-feature` / `domain-reviewer`, y el smoke de navegador de Task 4 (el render de `.vue` no lo cubre ningún unit test).
