# Cierre ciego (blind count) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En modo ciego (config por tenant) el cajero cuenta el cajón sin ver el monto esperado; el backend retiene el `esperado` mientras la caja está abierta y lo revela al cerrar.

**Architecture:** Sub-proyecto B del refactor de arqueo, sobre la fundación de A (ya en `main`). Una columna `tenants.arqueo_ciego` activa la política; el enforcement vive en `obtenerArqueo` (backend), no en la UI: en modo ciego + caja abierta la respuesta del `GET /caja/:id/arqueo` no incluye el `esperado` ni las líneas informativas. La respuesta del endpoint cambia de `LineaArqueo[]` a `{ ciego, lineas }`, absorbido por sus 3 consumidores frontend. El flujo de `cerrar` (recompute + congelado server-side) **no se toca**: su respuesta es la revelación.

**Tech Stack:** NestJS + TypeORM + PostgreSQL 15 (`synchronize` en dev/CI, sin migraciones); Nuxt 4 + Vue 3 + Pinia + Nuxt UI; Decimal.js.

**Spec:** `docs/superpowers/specs/2026-07-24-cierre-ciego-design.md`

## Global Constraints

Toda tarea hereda estas reglas (violarlas = detenerse y reportar, no corregir):

- **`tenant_id`/`usuario_id` SIEMPRE del token JWT**, nunca del body/query/ruta.
- **Dinero/porcentajes con Decimal.js `.toFixed(4)`**, nunca `number` nativo. `esperado`/`contado`/`diferencia` son Decimal serializados a string.
- **Soft delete en todo**: toda `SELECT`/`UPDATE` nueva filtra `eliminado_el IS NULL`.
- **No tocar el sistema JWT, el motor de precios, `movimientos_inventario` ni el flujo de `cerrar`** (recompute + congelado server-side idénticos a A).
- **`cerrar` sigue owner-only** (`@RequiresPermiso('MiCaja','Actualizar')`). El cierre forzado del encargado sigue diferido.
- **Config del modo ciego con permiso `Cajas`** (`Leer` para leer, `Actualizar` para escribir), no por rol.
- **Contrato de la respuesta del arqueo:** `GET /caja/:id/arqueo` → `{ ciego: boolean, lineas: LineaArqueo[] }`. En ciego+abierta: `esperado` de cada línea es `null` y solo van las obligatorias (`esEfectivo || requiereConteo`). Caja cerrada: **siempre** `ciego:false` con líneas congeladas completas.
- **No hay entidad nueva** (solo una columna en la entidad `Tenant`, ya registrada) → **no se toca `app.module.ts`**.
- **Trabajo directo sobre `main`** (sin ramas/PR). Commits frecuentes por tarea.

---

## Estructura de archivos

**Backend:**
- `backend/src/modules/tenants/entities/tenant.entity.ts` — MODIFICAR: columna `arqueoCiego`.
- `backend/src/modules/caja/caja.service.ts` — MODIFICAR: `LineaArqueo.esperado` nullable; `getArqueoCiego`/`setArqueoCiego`; reescribir `obtenerArqueo`.
- `backend/src/modules/caja/dto/set-arqueo-ciego.dto.ts` — CREAR.
- `backend/src/modules/caja/caja.controller.ts` — MODIFICAR: rutas `GET`/`PUT /caja/arqueo-ciego`.
- `backend/src/modules/caja/caja.service.spec.ts` — MODIFICAR: tests de `obtenerArqueo` (forma nueva + ciego) + `getArqueoCiego`/`setArqueoCiego`.
- `backend/src/modules/caja/caja.controller.spec.ts` — MODIFICAR: mock de `obtenerArqueo` a forma nueva + delegación de los endpoints de config.
- `backend/test/caja.e2e-spec.ts` — MODIFICAR: migrar aserciones a `.lineas` + casos ciego.

**Frontend:**
- `frontend/app/stores/caja.ts` — MODIFICAR: `cargarArqueo` lee `{ciego,lineas}`; estado `arqueoCiego`; `cargarArqueoCiego`/`guardarArqueoCiego`; `ArqueoLinea.esperado` nullable.
- `frontend/app/pages/configuracion/cajas.vue` — MODIFICAR: toggle "Arqueo ciego".
- `frontend/app/components/caja/CajaArqueoTable.vue` — MODIFICAR: `esperado` null-safe.
- `frontend/app/components/caja/CajaCierreDrawer.vue` — MODIFICAR: modo ciego + revelación al cerrar.
- `frontend/app/pages/mi-caja/[id].vue` — MODIFICAR: guardar el watcher de redirección en modo ciego.

**Docs:**
- `docs/features/gestion-cajas.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/investigaciones/2026-07-23-gestion-caja.md`, `startup-pos.sql`.

---

### Task 1: Config del modo ciego — columna, service y endpoints

Slice tenant-level completo: la columna `arqueo_ciego`, su lectura/escritura y los endpoints HTTP con permiso `Cajas`. Deliverable: un admin puede leer y setear la política vía API.

**Files:**
- Modify: `backend/src/modules/tenants/entities/tenant.entity.ts:49` (tras `montoTolerancia`)
- Modify: `backend/src/modules/caja/caja.service.ts` (métodos nuevos; interfaz `LineaArqueo`)
- Create: `backend/src/modules/caja/dto/set-arqueo-ciego.dto.ts`
- Modify: `backend/src/modules/caja/caja.controller.ts:88` (rutas nuevas, antes de `@Get(':id/arqueo')`)
- Test: `backend/src/modules/caja/caja.service.spec.ts` (bloque `getArqueoCiego`/`setArqueoCiego`)

**Interfaces:**
- Produces: `CajaService.getArqueoCiego(tenantId: string): Promise<boolean>`, `CajaService.setArqueoCiego(tenantId: string, valor: boolean): Promise<void>`. Endpoints `GET /caja/arqueo-ciego → { arqueoCiego: boolean }` y `PUT /caja/arqueo-ciego` (body `{ arqueoCiego: boolean }`) → `{ arqueoCiego: boolean }`.

- [ ] **Step 1: Columna en la entidad Tenant**

En `tenant.entity.ts`, agregar tras la columna `montoTolerancia` (línea 49):

```ts
  @Column({ name: 'arqueo_ciego', type: 'boolean', default: false })
  arqueoCiego: boolean;
```

(`synchronize` crea la columna al bootstrap. No se toca `app.module.ts`: la entidad `Tenant` ya está registrada.)

- [ ] **Step 2: Escribir el test de `getArqueoCiego`/`setArqueoCiego` (falla)**

En `caja.service.spec.ts`, agregar un `describe` nuevo (p. ej. tras el bloque `obtenerArqueo`, línea ~525). El mock `dataSource.query` y `TENANT_ID` ya existen en el archivo:

```ts
  describe('getArqueoCiego / setArqueoCiego', () => {
    it('getArqueoCiego lee tenants.arqueo_ciego filtrando soft-delete', async () => {
      dataSource.query.mockResolvedValueOnce([{ arqueo_ciego: true }]);
      const res = await service.getArqueoCiego(TENANT_ID);
      expect(res).toBe(true);
      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain('FROM tenants');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(params).toEqual([TENANT_ID]);
    });

    it('getArqueoCiego → false cuando no hay fila', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      expect(await service.getArqueoCiego(TENANT_ID)).toBe(false);
    });

    it('setArqueoCiego actualiza la columna con el tenant del token', async () => {
      dataSource.query.mockResolvedValueOnce(undefined);
      await service.setArqueoCiego(TENANT_ID, true);
      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain('UPDATE tenants');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(params).toEqual([true, TENANT_ID]);
    });
  });
```

- [ ] **Step 3: Ejecutar el test para verlo fallar**

Run: `cd backend && npm test -- caja.service`
Expected: FAIL (`service.getArqueoCiego is not a function`).

- [ ] **Step 4: Implementar `getArqueoCiego`/`setArqueoCiego`**

En `caja.service.ts`, agregar los dos métodos justo antes de `obtenerArqueo` (línea ~372):

```ts
  /**
   * Config del modo ciego por tenant (columna tenants.arqueo_ciego). Lectura y
   * escritura por query raw parametrizada; tenant del token; filtra soft-delete.
   */
  async getArqueoCiego(tenantId: string): Promise<boolean> {
    const rows: { arqueo_ciego: boolean }[] = await this.dataSource.query(
      `SELECT arqueo_ciego FROM tenants
        WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [tenantId],
    );
    return rows[0]?.arqueo_ciego ?? false;
  }

  async setArqueoCiego(tenantId: string, valor: boolean): Promise<void> {
    await this.dataSource.query(
      `UPDATE tenants SET arqueo_ciego = $1
        WHERE tenant_id = $2 AND eliminado_el IS NULL`,
      [valor, tenantId],
    );
  }
```

- [ ] **Step 5: Ejecutar el test para verlo pasar**

Run: `cd backend && npm test -- caja.service`
Expected: PASS (los 3 tests nuevos verdes; el resto sin regresión).

- [ ] **Step 6: Crear el DTO**

`backend/src/modules/caja/dto/set-arqueo-ciego.dto.ts`:

```ts
import { IsBoolean } from 'class-validator';

export class SetArqueoCiegoDto {
  @IsBoolean()
  arqueoCiego: boolean;
}
```

- [ ] **Step 7: Agregar las rutas al controller**

En `caja.controller.ts`: importar `Put` desde `@nestjs/common` y `SetArqueoCiegoDto`. Agregar los handlers **inmediatamente después de `cajonesDisponibles` (línea 88) y antes de `@Get(':id/arqueo')`** — el `GET arqueo-ciego` es de un solo segmento y sería capturado por `@Get(':id')` si se declarara después.

```ts
  @Get('arqueo-ciego')
  @RequiresPermiso('Cajas', 'Leer')
  async getArqueoCiego(@Req() req: Request) {
    const u = req.user as JwtUser;
    const arqueoCiego = await this.cajaService.getArqueoCiego(u.tenantId!);
    return { arqueoCiego };
  }

  @Put('arqueo-ciego')
  @RequiresPermiso('Cajas', 'Actualizar')
  async setArqueoCiego(@Req() req: Request, @Body() dto: SetArqueoCiegoDto) {
    const u = req.user as JwtUser;
    await this.cajaService.setArqueoCiego(u.tenantId!, dto.arqueoCiego);
    return { arqueoCiego: dto.arqueoCiego };
  }
```

Añadir el import: `import { SetArqueoCiegoDto } from './dto/set-arqueo-ciego.dto';` y `Put` a la lista de `@nestjs/common`.

- [ ] **Step 8: Test de delegación en el controller (falla → pasa)**

En `caja.controller.spec.ts`: agregar `getArqueoCiego: jest.fn()` y `setArqueoCiego: jest.fn()` al objeto `cajaService` mockeado (línea ~22). Agregar el describe:

```ts
  describe('config arqueo-ciego (permiso Cajas)', () => {
    it('GET delega en getArqueoCiego con el tenant del token', async () => {
      jest.spyOn(cajaService, 'getArqueoCiego').mockResolvedValue(true);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const res = await controller.getArqueoCiego(req);
      expect(cajaService.getArqueoCiego).toHaveBeenCalledWith('t1');
      expect(res).toEqual({ arqueoCiego: true });
    });

    it('PUT delega en setArqueoCiego con el tenant del token y el valor del DTO', async () => {
      jest.spyOn(cajaService, 'setArqueoCiego').mockResolvedValue(undefined);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const res = await controller.setArqueoCiego(req, { arqueoCiego: false });
      expect(cajaService.setArqueoCiego).toHaveBeenCalledWith('t1', false);
      expect(res).toEqual({ arqueoCiego: false });
    });
  });
```

Run: `cd backend && npm test -- caja.controller`
Expected: PASS.

- [ ] **Step 9: Gate y commit**

Run: `cd backend && npm run lint:check && npm run typecheck && npm test -- caja`
Expected: verde.

```bash
git add backend/src/modules/tenants/entities/tenant.entity.ts \
        backend/src/modules/caja/caja.service.ts \
        backend/src/modules/caja/dto/set-arqueo-ciego.dto.ts \
        backend/src/modules/caja/caja.controller.ts \
        backend/src/modules/caja/caja.service.spec.ts \
        backend/src/modules/caja/caja.controller.spec.ts
git commit -m "feat(caja): config arqueo_ciego por tenant + endpoints GET/PUT /caja/arqueo-ciego"
```

---

### Task 2: Enforcement en `obtenerArqueo` — respuesta `{ ciego, lineas }`

Reescribe `obtenerArqueo` para retener el `esperado` y filtrar a obligatorias en modo ciego + caja abierta; caja cerrada siempre revela. Migra los tests unitarios existentes a la forma nueva.

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts:65-73` (`LineaArqueo.esperado` nullable), `:367-429` (`obtenerArqueo`)
- Modify: `backend/src/modules/caja/caja.service.spec.ts:466-525` (tests `obtenerArqueo`)
- Modify: `backend/src/modules/caja/caja.controller.spec.ts:274` (mock a forma nueva)

**Interfaces:**
- Consumes: `getArqueoCiego(tenantId)` (Task 1), `calcularArqueo(cajaId, tenantId, manager): Promise<LineaArqueo[]>` (A).
- Produces: `obtenerArqueo(tenantId, usuarioId, cajaId, tieneVerTodas): Promise<{ ciego: boolean; lineas: LineaArqueo[] }>`. `LineaArqueo.esperado: string | null`.

- [ ] **Step 1: Hacer `LineaArqueo.esperado` nullable**

En `caja.service.ts`, interfaz `LineaArqueo` (línea 69):

```ts
export interface LineaArqueo {
  metodoPagoId: string | null;
  nombre: string;
  esEfectivo: boolean;
  esperado: string | null;
  requiereConteo: boolean;
  contado?: string | null;
  diferencia?: string | null;
}
```

(En modo normal y en caja cerrada `esperado` nunca es null; el null solo aparece en el preview ciego. `calcularArqueo` sigue produciendo `esperado` string, compatible con `string | null`.)

- [ ] **Step 2: Migrar los tests de `obtenerArqueo` a la forma nueva + casos ciego (fallan)**

Reemplazar el bloque `describe('obtenerArqueo', ...)` (líneas 466-525) por:

```ts
  describe('obtenerArqueo', () => {
    const previewEfectivo: LineaArqueo[] = [
      {
        metodoPagoId: null,
        nombre: 'Efectivo',
        esEfectivo: true,
        esperado: '1000.0000',
        requiereConteo: true,
      },
      {
        metodoPagoId: 'mp-tarjeta',
        nombre: 'Tarjeta',
        esEfectivo: false,
        esperado: '5000.0000',
        requiereConteo: false,
      },
    ];

    it('caja abierta + tenant NO ciego → ciego:false, líneas completas con esperado', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'abierta' });
      jest.spyOn(service, 'calcularArqueo').mockResolvedValueOnce(previewEfectivo);
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(false);

      const res = await service.obtenerArqueo(TENANT_ID, USUARIO_ID, CAJA_ID, false);

      expect(res.ciego).toBe(false);
      expect(res.lineas).toHaveLength(2);
      expect(res.lineas[0]).toMatchObject({ metodoPagoId: null, esperado: '1000.0000' });
      expect(res.lineas[0].contado).toBeUndefined();
    });

    it('caja abierta + tenant ciego → ciego:true, solo obligatorias, esperado null', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'abierta' });
      jest.spyOn(service, 'calcularArqueo').mockResolvedValueOnce(previewEfectivo);
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(true);

      const res = await service.obtenerArqueo(TENANT_ID, USUARIO_ID, CAJA_ID, false);

      expect(res.ciego).toBe(true);
      // La tarjeta (no efectivo, requiere_conteo=false) es informativa → se filtra.
      expect(res.lineas).toHaveLength(1);
      expect(res.lineas[0]).toMatchObject({ metodoPagoId: null, esEfectivo: true });
      expect(res.lineas[0].esperado).toBeNull();
    });

    it('caja cerrada → ciego:false SIEMPRE, líneas congeladas reveladas', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'cerrada' });
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(true); // aunque el tenant sea ciego
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

      const res = await service.obtenerArqueo(TENANT_ID, USUARIO_ID, CAJA_ID, false);

      expect(res.ciego).toBe(false);
      expect(res.lineas[0]).toMatchObject({
        metodoPagoId: null,
        esperado: '1000.0000',
        contado: '950.0000',
        diferencia: '-50.0000',
      });
    });
  });
```

- [ ] **Step 3: Ejecutar para verlos fallar**

Run: `cd backend && npm test -- caja.service`
Expected: FAIL (`obtenerArqueo` aún devuelve un array; `res.ciego` undefined).

- [ ] **Step 4: Reescribir `obtenerArqueo`**

Reemplazar el método (líneas 367-429) y su comentario:

```ts
  /**
   * Arqueo para el drawer de cierre y el detalle read-only.
   * Caja abierta → preview recomputado (sin contado). En modo ciego (config del
   * tenant) se RETIENE el `esperado` (null) y se filtra a las líneas obligatorias.
   * Caja cerrada → líneas congeladas, SIEMPRE reveladas (ciego:false).
   */
  async obtenerArqueo(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas: boolean,
  ): Promise<{ ciego: boolean; lineas: LineaArqueo[] }> {
    const caja = await this.verificarAccesoCaja(
      tenantId,
      usuarioId,
      cajaId,
      tieneVerTodas,
    );

    if (caja.estado === 'abierta') {
      const lineas = await this.dataSource.transaction((manager) =>
        this.calcularArqueo(cajaId, tenantId, manager),
      );
      const ciego = await this.getArqueoCiego(tenantId);
      if (ciego) {
        return {
          ciego: true,
          lineas: lineas
            .filter((l) => l.esEfectivo || l.requiereConteo)
            .map((l) => ({ ...l, esperado: null })),
        };
      }
      return { ciego: false, lineas };
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

    return {
      ciego: false,
      lineas: rows.map((r) => ({
        metodoPagoId: r.metodo_pago_id,
        nombre: r.nombre ?? 'Efectivo',
        esEfectivo: r.es_efectivo,
        esperado: new Decimal(r.esperado).toFixed(4),
        requiereConteo: r.requiere_conteo,
        contado: r.contado === null ? null : new Decimal(r.contado).toFixed(4),
        diferencia:
          r.diferencia === null ? null : new Decimal(r.diferencia).toFixed(4),
      })),
    };
  }
```

(La query congelada es idéntica a la de A; solo cambia el envoltorio del retorno.)

- [ ] **Step 5: Ejecutar para verlos pasar**

Run: `cd backend && npm test -- caja.service`
Expected: PASS.

- [ ] **Step 6: Ajustar el mock del controller.spec**

En `caja.controller.spec.ts` línea 274, el test `arqueo` mockea `obtenerArqueo` con `[]`. Cambiar a la forma nueva:

```ts
      jest.spyOn(cajaService, 'obtenerArqueo').mockResolvedValueOnce({ ciego: false, lineas: [] });
```

(El handler `arqueo` del controller no cambia: pasa el resultado tal cual. La aserción `toHaveBeenCalledWith('t1','u1','caja1',true)` sigue válida.)

Run: `cd backend && npm test -- caja.controller`
Expected: PASS.

- [ ] **Step 7: Gate y commit**

Run: `cd backend && npm run lint:check && npm run typecheck && npm test -- caja`
Expected: verde.

```bash
git add backend/src/modules/caja/caja.service.ts \
        backend/src/modules/caja/caja.service.spec.ts \
        backend/src/modules/caja/caja.controller.spec.ts
git commit -m "feat(caja): obtenerArqueo retiene esperado en modo ciego (respuesta { ciego, lineas })"
```

---

### Task 3: E2E — migrar aserciones + casos de cierre ciego

Migra las aserciones existentes del arqueo (`body as ArqueoLinea[]` → `.lineas`) y agrega la cobertura del modo ciego contra Postgres real, seteando `arqueo_ciego` vía `ds.query`.

**Files:**
- Modify: `backend/test/caja.e2e-spec.ts:389`, `:517` (migrar a `.lineas`) y bloque `arqueo multi-medio` (315-524, agregar describe ciego)

**Interfaces:**
- Consumes: `GET /api/caja/:id/arqueo → { ciego, lineas }`; `POST /api/caja/:id/cerrar → { caja, arqueo }`; helpers ya presentes (`ds`, `cajonArqueoId`, `itemId`, `tokenSupervisor`, `PARIS_TENANT_ID`, `TARJETA_DEBITO_ID`, `BOLETA_ID`).

- [ ] **Step 1: Migrar las 2 lecturas existentes del preview/congelado a `.lineas`**

En `caja.e2e-spec.ts`:

Línea 388-389 (test "vender con tarjeta NO infla…"):
```ts
      expect(preview.status).toBe(200);
      const lineas = (preview.body as { ciego: boolean; lineas: ArqueoLinea[] }).lineas;
```

Línea 516-517 (test "la caja cerrada devuelve las líneas congeladas…"):
```ts
      expect(arqueoCerrado.status).toBe(200);
      const lineas = (arqueoCerrado.body as { ciego: boolean; lineas: ArqueoLinea[] }).lineas;
```

- [ ] **Step 2: Ejecutar para confirmar que la migración compila y pasa (sin casos nuevos aún)**

Run: `cd backend && npm run test:e2e -- caja`
Expected: PASS (los specs existentes verdes con la forma nueva).

- [ ] **Step 3: Agregar el describe de cierre ciego**

Dentro de `describe('arqueo multi-medio', ...)`, después del último `it` (línea 523) y antes del cierre del describe, agregar. Setea/restaura `arqueo_ciego` con `afterAll`-style hygiene dentro del propio test:

```ts
    it('modo ciego + caja abierta: GET arqueo → ciego:true, sin esperado, solo obligatorias', async () => {
      await ds.query(
        `UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      try {
        const abrir = await request(app.getHttpServer())
          .post('/api/caja/abrir')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({ cajonId: cajonArqueoId, saldoInicial: '10000.0000' });
        expect(abrir.status).toBe(201);
        const cajaId = (abrir.body as CajaResponse).id;

        // Venta con tarjeta (informativa: es_efectivo=false, requiere_conteo=false).
        const venta = await request(app.getHttpServer())
          .post('/api/ventas')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            tipoDocumentoId: BOLETA_ID,
            lineas: [{ itemId, cantidad: '1' }],
            pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
          });
        expect(venta.status).toBe(201);

        const arqueo = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(arqueo.status).toBe(200);
        const body = arqueo.body as { ciego: boolean; lineas: ArqueoLinea[] };
        expect(body.ciego).toBe(true);
        // Solo la línea de efectivo (obligatoria); la tarjeta informativa no viaja.
        expect(body.lineas).toHaveLength(1);
        expect(body.lineas[0].esEfectivo).toBe(true);
        // Anti-fraude: el esperado no viaja en la respuesta.
        expect(body.lineas[0].esperado).toBeNull();

        // El cierre igual cuadra: el server recomputa el esperado (10000).
        const cerrar = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/cerrar`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({ lineas: [{ metodoPagoId: null, montoContado: '10000.0000' }] });
        expect(cerrar.status).toBe(201);
        const cerrarBody = cerrar.body as { arqueo: ArqueoLinea[] };
        const efectivoCerrado = cerrarBody.arqueo.find((l) => l.esEfectivo);
        expect(efectivoCerrado?.esperado).toBe('10000.0000');
        expect(efectivoCerrado?.diferencia).toBe('0.0000');

        // La caja cerrada revela TODO (ciego:false) aunque el tenant sea ciego.
        const revelado = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(revelado.status).toBe(200);
        const revBody = revelado.body as { ciego: boolean; lineas: ArqueoLinea[] };
        expect(revBody.ciego).toBe(false);
        const efectivoRevelado = revBody.lineas.find((l) => l.esEfectivo);
        expect(efectivoRevelado?.esperado).toBe('10000.0000');
        expect(efectivoRevelado?.diferencia).toBe('0.0000');
      } finally {
        // Higiene: restaurar la política para no contaminar otros specs/corridas.
        await ds.query(
          `UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1`,
          [PARIS_TENANT_ID],
        );
      }
    });
```

- [ ] **Step 4: Ejecutar la suite de caja e2e**

Run: `cd backend && npm run test:e2e -- caja`
Expected: PASS (todo el `caja.e2e-spec` verde).

> Nota: si otras suites e2e locales fallan por polución de stock acumulado entre corridas (combos/mermas/ventas/liquidacion-propinas), **no es regresión de esta tarea** — es un caveat conocido (`docs/agent/pendientes.md`); la verdad es CI con DB fresca. `caja.e2e-spec` debe estar verde.

- [ ] **Step 5: Commit**

```bash
git add backend/test/caja.e2e-spec.ts
git commit -m "test(caja): e2e de cierre ciego + migración de aserciones a { ciego, lineas }"
```

---

### Task 4: Frontend store + toggle de configuración

Adapta el store al contrato `{ ciego, lineas }`, agrega el estado `arqueoCiego` y los métodos de config, y suma el toggle "Arqueo ciego" en la página de Cajas. **No** cambia el tipo de `esperado` todavía (eso va en Task 5, junto a sus consumidores de vista).

**Files:**
- Modify: `frontend/app/stores/caja.ts:177-181` (`cargarArqueo`), estado + return (agregar `arqueoCiego`, `cargarArqueoCiego`, `guardarArqueoCiego`)
- Modify: `frontend/app/pages/configuracion/cajas.vue` (sección toggle)

**Interfaces:**
- Consumes: `GET /caja/arqueo-ciego`, `PUT /caja/arqueo-ciego`, `GET /caja/:id/arqueo → { ciego, lineas }`.
- Produces (store): `arqueoCiego: Ref<boolean>` (flag del preview actual), `cargarArqueo(cajaId)` (ahora setea `arqueo` y `arqueoCiego`), `cargarArqueoCiego(): Promise<boolean>` y `guardarArqueoCiego(valor): Promise<void>` (config del tenant).

- [ ] **Step 1: Adaptar el store**

En `stores/caja.ts`:

(a) Agregar el estado tras `const arqueo = ref<ArqueoLinea[]>([])` (línea 87):
```ts
  const arqueoCiego = ref(false)
```

(b) Reescribir `cargarArqueo` (líneas 177-181):
```ts
  async function cargarArqueo(cajaId: string): Promise<void> {
    const res = await useApiFetch<{ ciego: boolean, lineas: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/arqueo`,
    )
    arqueo.value = res.lineas
    arqueoCiego.value = res.ciego
  }
```

(c) Agregar los métodos de config (p. ej. tras `cargarArqueo`):
```ts
  async function cargarArqueoCiego(): Promise<boolean> {
    const res = await useApiFetch<{ arqueoCiego: boolean }>(
      `${config.public.apiUrl}/caja/arqueo-ciego`,
    )
    return res.arqueoCiego
  }

  async function guardarArqueoCiego(valor: boolean): Promise<void> {
    await useApiFetch(`${config.public.apiUrl}/caja/arqueo-ciego`, {
      method: 'PUT',
      body: { arqueoCiego: valor },
    })
  }
```

(d) Exponer los tres en el `return` (junto a `arqueo`, `cargarArqueo`): `arqueoCiego,`, `cargarArqueoCiego,`, `guardarArqueoCiego,`.

- [ ] **Step 2: Toggle en `configuracion/cajas.vue`**

Agregar estado en el `<script setup>` (junto a los otros `ref`, ~línea 28):
```ts
const arqueoCiego = ref(false)
const savingArqueoCiego = ref(false)
```

Cargar el valor en `onMounted` (la función `cargar()` ya corre en mounted; añadir la carga del flag después de `cargar()` en el `onMounted` de línea 200):
```ts
onMounted(async () => {
  cargar()
  try {
    arqueoCiego.value = await useCajaStore().cargarArqueoCiego()
  }
  catch { /* si no tiene Cajas:Leer, el toggle no se muestra igual */ }
})
```

Agregar el handler de guardado (junto a las otras funciones):
```ts
const cajaStore = useCajaStore()

async function onToggleArqueoCiego(valor: boolean) {
  const prev = arqueoCiego.value
  arqueoCiego.value = valor
  savingArqueoCiego.value = true
  try {
    await cajaStore.guardarArqueoCiego(valor)
    toast.add({ title: valor ? 'Arqueo ciego activado' : 'Arqueo ciego desactivado', color: 'success' })
  }
  catch (e: unknown) {
    arqueoCiego.value = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar arqueo ciego'), color: 'error' })
  }
  finally {
    savingArqueoCiego.value = false
  }
}
```

(Ajustar el `onMounted` existente en línea 200 para no duplicar: dejar una sola versión que llame `cargar()` y cargue el flag.)

En el `<template>`, agregar una sección de política tras el `CrudTable` (antes del primer `AppDrawer`, ~línea 273):
```vue
    <UCard>
      <template #header>
        <h3 class="text-sm font-semibold text-default">
          Política de cierre
        </h3>
      </template>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-default">
            Arqueo ciego
          </p>
          <p class="text-sm text-muted">
            El cajero cuenta el cajón sin ver el monto esperado; el sistema revela la diferencia al cerrar.
          </p>
        </div>
        <USwitch
          :model-value="arqueoCiego"
          :disabled="savingArqueoCiego || !puedeActualizar"
          @update:model-value="onToggleArqueoCiego"
        />
      </div>
    </UCard>
```

- [ ] **Step 3: Gate frontend**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: verde. (El `USwitch` usa tokens del design system; sin colores hardcoded.)

> Si `nuxt-ui` no auto-importa algún componente, verificar el patrón existente (el archivo ya usa `USwitch`/`UCard`). Consultar la skill `nuxt-ui` si hace falta.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/stores/caja.ts frontend/app/pages/configuracion/cajas.vue
git commit -m "feat(caja): store adapta { ciego, lineas } + toggle de arqueo ciego en config"
```

---

### Task 5: Drawer en modo ciego + revelación al cerrar

El drawer, en modo ciego, muestra solo las obligatorias sin esperado ni diferencia en vivo; al cerrar redirige al detalle mostrando el arqueo congelado. Aquí aterriza el tipo `esperado: string | null` junto a sus consumidores de vista.

**Files:**
- Modify: `frontend/app/stores/caja.ts:67` (`ArqueoLinea.esperado` nullable)
- Modify: `frontend/app/components/caja/CajaArqueoTable.vue:34` (null-safe)
- Modify: `frontend/app/components/caja/CajaCierreDrawer.vue` (modo ciego + revelación)
- Modify: `frontend/app/pages/mi-caja/[id].vue:51-55` (guardar el watcher)

**Interfaces:**
- Consumes: `cajaStore.arqueoCiego` (Task 4), `cajaStore.cerrar(cajaId, payload): Promise<{ caja, arqueo }>`, `cajaStore.detalle`, `cajaStore.arqueo`.

- [ ] **Step 1: `ArqueoLinea.esperado` nullable en el store**

En `stores/caja.ts`, interfaz `ArqueoLinea` (línea 67):
```ts
export interface ArqueoLinea {
  metodoPagoId: string | null
  nombre: string
  esEfectivo: boolean
  esperado: string | null
  requiereConteo: boolean
  contado?: string | null
  diferencia?: string | null
}
```

- [ ] **Step 2: `CajaArqueoTable.vue` null-safe en `esperado`**

Línea 33-35, envolver el `formatMonto(l.esperado)` (la tabla solo se usa con cajas cerradas, donde `esperado` nunca es null, pero el tipo ahora lo admite):
```vue
          <td class="py-2 text-right text-default">
            {{ l.esperado != null ? formatMonto(l.esperado) : '—' }}
          </td>
```

- [ ] **Step 3: Modo ciego en `CajaCierreDrawer.vue`**

(a) En el `<script setup>`, agregar el flag y hacer `diferenciaDe` null-safe:
```ts
const ciego = computed(() => cajaStore.arqueoCiego)
```
Modificar `diferenciaDe` (línea 26) para cortar cuando no hay esperado:
```ts
function diferenciaDe(l: ArqueoLinea): Decimal | null {
  if (l.esperado == null) return null
  const c = contado.value[claveDe(l)]
  if (!c) return null
  try {
    return new Decimal(c).minus(l.esperado)
  }
  catch {
    return null
  }
}
```

(b) Reescribir `cerrarCaja` para la revelación por redirección en modo ciego:
```ts
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
    const res = await cajaStore.cerrar(props.cajaId, { lineas, comentario: comentario.value || undefined })

    if (ciego.value) {
      // Revelación: reusa el detalle de la caja cerrada (CajaArqueoTable congelado).
      // Se mantiene arqueoCiego=true durante este flujo para que el watcher de
      // mi-caja/[id].vue NO redirija a /mi-caja (ver Step 4); el arqueo se muestra
      // en el detalle. Desde POS/dashboard, navigateTo remonta el detalle y su
      // onMounted recarga todo (reseteando arqueoCiego a false).
      cajaStore.arqueo = res.arqueo
      if (cajaStore.detalle?.id === props.cajaId) {
        cajaStore.detalle = { ...cajaStore.detalle, ...res.caja }
      }
      const efectivo = res.arqueo.find(l => l.esEfectivo)
      const dif = efectivo?.diferencia ?? '0'
      toast.add({
        title: 'Caja cerrada',
        description: `Diferencia de efectivo: ${formatMonto(dif)}`,
        color: new Decimal(dif).gte(0) ? 'success' : 'error',
      })
      open.value = false
      await navigateTo(`/mi-caja/${props.cajaId}`)
    }
    else {
      toast.add({ title: 'Caja cerrada correctamente', color: 'success' })
      open.value = false
    }
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al cerrar la caja'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
```

(c) En el `<template>`, ocultar el "Esperado …" y la "Diferencia" cuando la línea no trae esperado (modo ciego). En el grupo de obligatorias (líneas 110-129):

- Cambiar el span de esperado (línea 111-112) para condicionarlo:
```vue
            <div class="flex justify-between text-sm">
              <span class="font-medium text-default">{{ l.nombre }}</span>
              <span v-if="l.esperado != null" class="text-muted">Esperado {{ formatMonto(l.esperado) }}</span>
            </div>
```
- Envolver todo el bloque de "Diferencia" (líneas 120-129) con `v-if="l.esperado != null"`:
```vue
            <div v-if="l.esperado != null" class="flex justify-between text-sm font-semibold">
              <span class="text-default">Diferencia</span>
              <span
                v-if="diferenciaDe(l) !== null"
                :class="diferenciaDe(l)!.gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
              >
                {{ diferenciaDe(l)!.gte(0) ? '+' : '' }}{{ formatMonto(diferenciaDe(l)!) }}
              </span>
              <span v-else class="text-muted">—</span>
            </div>
```

(El grupo "Informativas" no requiere cambios: en modo ciego el backend no envía informativas, así que `informativas` queda vacío y la sección no se renderiza. En modo normal se comporta como en A.)

- [ ] **Step 4: Guardar el watcher de redirección en `mi-caja/[id].vue`**

El watcher (líneas 51-55) redirige a `/mi-caja` cuando `activa` pasa a null. En modo ciego eso competiría con la redirección del drawer al detalle. Guardarlo con `!arqueoCiego` (que permanece true durante el cierre ciego):
```ts
watch(() => cajaStore.activa, (newActiva, oldActiva) => {
  if (oldActiva !== null && newActiva === null && !cajaStore.arqueoCiego) {
    navigateTo('/mi-caja')
  }
})
```

- [ ] **Step 5: Gate frontend**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: verde. (Los colores verde/rojo de diferencia están permitidos en el módulo caja — exclude-list de `check-design-tokens.mjs`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/stores/caja.ts \
        frontend/app/components/caja/CajaArqueoTable.vue \
        frontend/app/components/caja/CajaCierreDrawer.vue \
        frontend/app/pages/mi-caja/[id].vue
git commit -m "feat(caja): drawer de cierre en modo ciego + revelación por redirección al detalle"
```

> **Smoke navegador (obligatorio antes del cierre del sub-proyecto, tras Task 6):** el drawer no tiene test unitario y build/typecheck no ven bugs de runtime (auto-import Nuxt, timing de watchers/redirección). Con el stack rebuildeado (`docker compose up -d --build backend frontend`), login `admin.paris@paris.cl`/`admin`: (1) Configuración → Cajas → activar "Arqueo ciego". (2) Mi caja → abrir cajón → el drawer "Cerrar caja" muestra **solo** las obligatorias, **sin** "Esperado" ni diferencia en vivo. (3) Confirmar cierre → redirige a `/mi-caja/:id` mostrando "Arqueo del cierre" congelado (esperado/contado/diferencia) + toast con la diferencia de efectivo. (4) Repetir desde el POS: cerrar en ciego redirige igual al detalle. (5) Desactivar el toggle → el drawer vuelve al comportamiento de A (esperado + diferencia en vivo, vuelve a `/mi-caja`). Consola sin errores en todo el flujo.

---

### Task 6: Docs + `startup-pos.sql`

Documentación viva en el mismo cierre. Sin cambios de código.

**Files:**
- Modify: `startup-pos.sql:191` (columna `arqueo_ciego` en `tenants`)
- Modify: `docs/features/gestion-cajas.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/investigaciones/2026-07-23-gestion-caja.md`

- [ ] **Step 1: Columna en `startup-pos.sql`**

En la tabla `tenants`, tras `"monto_tolerancia"` (línea 191), agregar:
```sql
  "arqueo_ciego"       BOOLEAN     NOT NULL DEFAULT false,     -- cierre ciego: retiene el esperado durante el conteo
```

- [ ] **Step 2: `docs/features/gestion-cajas.md`**

Agregar una sección "Cierre ciego (modo anti-fraude)" que documente **el porqué y las reglas** (no repetir código):
- Config por tenant `arqueo_ciego` (default false), editable en Configuración → Cajas con permiso `Cajas:Actualizar`.
- Enforcement en backend: en modo ciego + caja **abierta**, `GET /caja/:id/arqueo` devuelve `{ ciego:true, lineas }` con `esperado:null` y **solo** las obligatorias (efectivo + `requiere_conteo`); nadie (dueño ni supervisor) ve el esperado de una caja abierta.
- La respuesta del arqueo pasó de `LineaArqueo[]` a `{ ciego, lineas }`.
- Caja **cerrada**: siempre `ciego:false`, líneas congeladas completas — el modo ciego afecta solo el conteo en curso, no el histórico.
- Drawer ciego: solo obligatorias, sin diferencia en vivo; al cerrar redirige al detalle con el arqueo revelado.
- `cerrar` no cambia (recompute + congelado server-side); su respuesta es la revelación.
- Diferido (§6): cierre forzado del encargado, umbral de aprobación, ocultar el resultado post-cierre.

- [ ] **Step 3: `docs/ESTADO.md`**

Marcar "Cierre ciego" como implementado (fecha 2026-07-24) en la fila/sección de gestión de cajas.

- [ ] **Step 4: `docs/agent/pendientes.md` + investigación §9**

En `docs/agent/investigaciones/2026-07-23-gestion-caja.md` (§9 o donde se listen los sub-proyectos), marcar **B (cierre ciego) hecho**; dejar explícito que §6 (cierre forzado, umbral, ocultar resultado post-cierre) sigue diferido. Si `pendientes.md` tenía una entrada de B, actualizarla.

- [ ] **Step 5: Verificar enlaces de docs**

Run: `cd /Users/m2pro/cmatheus/startup-app && node scripts/check-docs-links.mjs 2>/dev/null || echo "usar el comando de check-docs-links del repo"`
Expected: sin enlaces rotos. (El pre-commit corre el mismo check sobre los `.md` staged.)

- [ ] **Step 6: Commit**

```bash
git add startup-pos.sql docs/features/gestion-cajas.md docs/ESTADO.md \
        docs/agent/pendientes.md docs/agent/investigaciones/2026-07-23-gestion-caja.md
git commit -m "docs(caja): cierre ciego (sub-proyecto B) + columna arqueo_ciego en SQL"
```

---

## Cierre del sub-proyecto (tras Task 6)

Ejecutar el gate completo (no un subset) — coincide con CI:

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Más el **smoke navegador** de Task 5 (obligatorio). Un fallo e2e local en suites ajenas a caja por polución de stock no es regresión (verdad = CI con DB fresca).

## Self-Review (cobertura del plan vs. spec)

- **Modelo de datos** (`tenants.arqueo_ciego`): Task 1 (entidad) + Task 6 (SQL). ✓
- **Config endpoints** `GET/PUT /caja/arqueo-ciego` (Cajas:Leer/Actualizar): Task 1. ✓
- **Enforcement `obtenerArqueo` `{ciego,lineas}`**, retención en ciego+abierta, cerrada siempre revela: Task 2. ✓
- **`LineaArqueo.esperado` / `ArqueoLinea.esperado` nullable**: Task 2 (backend) + Task 5 (frontend). ✓
- **3 consumidores adaptados** (store, drawer, detalle): store en Task 4; drawer/detalle en Task 5; el detalle read-only sigue leyendo `cajaStore.arqueo` (Task 4 lo deja poblado desde `.lineas`). ✓
- **Toggle en `configuracion/cajas.vue`**: Task 4. ✓
- **Drawer ciego** (solo obligatorias, sin esperado/diferencia en vivo, gate intacto, redirect + toast): Task 5. ✓
- **Modo normal sin cambios**: Task 5 (rama `else`) + watcher guardado por `!arqueoCiego`. ✓
- **Testing** unit + e2e + smoke: Tasks 2, 3, 5. ✓
- **Seed**: sin cambios (default de columna); confirmado en el spec. ✓
- **Docs + SQL**: Task 6. ✓

Consistencia de tipos: `obtenerArqueo → { ciego, lineas }` (Task 2) ≡ `useApiFetch<{ ciego, lineas }>` (Task 4). `getArqueoCiego`/`setArqueoCiego` firmas idénticas entre Task 1 (impl), Task 2 (consumo) y specs. `arqueoCiego` (estado del store) usado por drawer (Task 5) y config (Task 4) con el mismo nombre.
