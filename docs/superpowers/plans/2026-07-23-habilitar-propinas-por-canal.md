# Habilitar Propinas por Canal (POS / Salones) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el admin del tenant pueda habilitar/deshabilitar la propina por canal (POS y Salones) de forma independiente, con enforcement real en el backend.

**Architecture:** Dos flags booleanos (`habilitado_pos`, `habilitado_salones`, default `true`) en la config versionada `propina_configuracion`. Se leen por los dos endpoints por-canal ya existentes (el front oculta el input de propina) y se aplican en el choke point único `ventas.service.ts`, donde convergen los dos caminos de propina: si el canal está apagado, la venta se crea **sin** propina (se ignora, no se rechaza). Se escriben por el mismo `PUT /propinas/distribucion` que ya gestiona `porcentaje_sugerido`.

**Tech Stack:** NestJS + TypeORM (backend), Nuxt 4 / Vue 3 + Nuxt UI (frontend), PostgreSQL, Jest + supertest (E2E).

## Global Constraints

- `tenant_id` sale siempre del token (`user.tenantId`), nunca del body/query/param.
- Dinero y porcentajes con Decimal.js; los flags son booleanos, ajenos a eso.
- Soft delete en todo; toda lectura filtra `eliminado_el IS NULL`.
- Enforcement real en backend (invariante 6): el toggle no puede quedarse solo en el front.
- Sin dependencias nuevas: todo con el stack actual.
- Porcentajes en decimal (`0.10` = 10%).
- Frontend: `$fetch`/`useApiFetch` (nunca axios); tokens semánticos Nuxt UI (nunca Tailwind hardcoded); lógica de presentación en composables, no en `.vue`.
- Comportamiento por defecto: ambos flags `true` → los tenants existentes y nuevos conservan la propina en ambos canales sin migración de datos.

---

### Task 1: Persistir y exponer los flags en la config (backend)

Agrega las dos columnas, las expone en `GET /propinas/distribucion` y en los dos endpoints por-canal (`porcentaje-sugerido` / `porcentaje-sugerido-venta`), y las persiste en el `PUT`.

**Files:**
- Modify: `startup-pos.sql` (tabla `propina_configuracion`, ~L1271-1283)
- Modify: `backend/src/modules/propinas/entities/propina-configuracion.entity.ts`
- Modify: `backend/src/modules/propinas/dto/update-distribucion.dto.ts` (clase `UpdateDistribucionDto`, al final)
- Modify: `backend/src/modules/propinas/propina-distribucion.controller.ts`
- Modify: `backend/src/modules/propinas/propina-distribucion.service.ts`
- Test: `backend/src/modules/propinas/propina-distribucion.service.spec.ts`

**Interfaces:**
- Produces:
  - `PropinaConfiguracion.habilitadoPos: boolean`, `PropinaConfiguracion.habilitadoSalones: boolean`
  - `DistribucionPublica` gana `habilitadoPos: boolean; habilitadoSalones: boolean`
  - `type CanalPropina = 'pos' | 'salones'` (exportado desde `propina-distribucion.service.ts`)
  - `PropinaDistribucionService.obtenerPorcentajeSugerido(tenantId: string, canal: CanalPropina): Promise<{ porcentajeSugerido: string; habilitado: boolean }>`
  - `UpdateDistribucionDto` gana `habilitadoPos?: boolean; habilitadoSalones?: boolean`

- [ ] **Step 1: Escribir el test que falla (service persiste y expone los flags por canal)**

En `propina-distribucion.service.spec.ts`, localizar el `describe` existente del service y agregar (usa el mismo setup de repos/manager que los tests vecinos; si el spec usa una BD/manager real de test, reusar ese `tenantId`):

```ts
describe('flags de canal (habilitadoPos / habilitadoSalones)', () => {
  it('default: obtener() y obtenerPorcentajeSugerido() devuelven ambos canales habilitados', async () => {
    const pub = await service.obtener(TENANT_ID);
    expect(pub.habilitadoPos).toBe(true);
    expect(pub.habilitadoSalones).toBe(true);

    const pos = await service.obtenerPorcentajeSugerido(TENANT_ID, 'pos');
    expect(pos.habilitado).toBe(true);
    const salones = await service.obtenerPorcentajeSugerido(TENANT_ID, 'salones');
    expect(salones.habilitado).toBe(true);
  });

  it('reemplazar con habilitadoPos:false apaga solo el POS', async () => {
    await service.reemplazar(TENANT_ID, USUARIO_ID, {
      porcentajeSugerido: '0.10',
      habilitadoPos: false,
      habilitadoSalones: true,
      grupos: [
        {
          tipoGarzon: 'garzon',
          nombre: 'Garzones',
          porcentaje: '1',
          criterio: 'PARTES_IGUALES',
          activo: true,
          orden: 0,
        },
      ],
    } as any);

    const pub = await service.obtener(TENANT_ID);
    expect(pub.habilitadoPos).toBe(false);
    expect(pub.habilitadoSalones).toBe(true);

    expect((await service.obtenerPorcentajeSugerido(TENANT_ID, 'pos')).habilitado).toBe(false);
    expect((await service.obtenerPorcentajeSugerido(TENANT_ID, 'salones')).habilitado).toBe(true);
  });
});
```

> Si `propina-distribucion.service.spec.ts` no existe o usa mocks que no llegan a una BD real, agregar estos casos al E2E de Task 2 en su lugar y saltar Steps 1-2/4 de esta task (marcarlos hechos con nota). El resto de la task (columnas, DTO, controller, service) es igual.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx jest src/modules/propinas/propina-distribucion.service.spec.ts`
Expected: FAIL — `habilitadoPos`/`habilitadoSalones` no existen en el tipo devuelto / `obtenerPorcentajeSugerido` no acepta 2º argumento.

- [ ] **Step 3a: Agregar las columnas al esquema SQL**

En `startup-pos.sql`, dentro de `CREATE TABLE propina_configuracion (...)`, después de la línea `porcentaje_sugerido NUMERIC(10,6) NOT NULL DEFAULT 0.10,`:

```sql
  habilitado_pos BOOLEAN NOT NULL DEFAULT true,
  habilitado_salones BOOLEAN NOT NULL DEFAULT true,
```

- [ ] **Step 3b: Agregar las columnas a la entity**

En `propina-configuracion.entity.ts`, después del bloque `porcentajeSugerido` (antes de `actualizadoPor`):

```ts
  @Column({ name: 'habilitado_pos', type: 'boolean', default: true })
  habilitadoPos: boolean;

  @Column({ name: 'habilitado_salones', type: 'boolean', default: true })
  habilitadoSalones: boolean;
```

- [ ] **Step 3c: Agregar los campos al DTO**

En `update-distribucion.dto.ts`, dentro de `class UpdateDistribucionDto`, después de `grupos`:

```ts
  @IsOptional()
  @IsBoolean()
  habilitadoPos?: boolean;

  @IsOptional()
  @IsBoolean()
  habilitadoSalones?: boolean;
```

(`IsOptional` e `IsBoolean` ya están importados en el archivo.)

- [ ] **Step 3d: Exponer y persistir los flags en el service**

En `propina-distribucion.service.ts`:

1. Después de los imports, exportar el tipo de canal:

```ts
export type CanalPropina = 'pos' | 'salones';
```

2. En la interfaz `DistribucionPublica`, agregar tras `porcentajeSugerido: string;`:

```ts
  habilitadoPos: boolean;
  habilitadoSalones: boolean;
```

3. En `cargarPublica`, en el objeto retornado, agregar tras `porcentajeSugerido: config.porcentajeSugerido,`:

```ts
      habilitadoPos: config.habilitadoPos,
      habilitadoSalones: config.habilitadoSalones,
```

4. Reemplazar la firma y cuerpo de `obtenerPorcentajeSugerido`:

```ts
  async obtenerPorcentajeSugerido(
    tenantId: string,
    canal: CanalPropina,
  ): Promise<{ porcentajeSugerido: string; habilitado: boolean }> {
    const config = await this.asegurarDefault(tenantId);
    const habilitado =
      canal === 'pos' ? config.habilitadoPos : config.habilitadoSalones;
    return { porcentajeSugerido: config.porcentajeSugerido, habilitado };
  }
```

5. En `reemplazar`, dentro de la transacción, después de `config.porcentajeSugerido = new Decimal(dto.porcentajeSugerido).toFixed(6);`:

```ts
      if (dto.habilitadoPos !== undefined) config.habilitadoPos = dto.habilitadoPos;
      if (dto.habilitadoSalones !== undefined)
        config.habilitadoSalones = dto.habilitadoSalones;
```

(Se persisten con el `manager.save(PropinaConfiguracion, config)` que ya existe más abajo.)

- [ ] **Step 3e: Pasar el canal desde el controller**

En `propina-distribucion.controller.ts`, actualizar las dos rutas por-canal:

```ts
  @Get('porcentaje-sugerido')
  @RequiresPermiso('Salones', 'Operar')
  porcentajeSugerido(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.distribucion.obtenerPorcentajeSugerido(user.tenantId!, 'salones');
  }

  // Mismo dato que /porcentaje-sugerido, pero para el POS: el rol Vendedor no
  // tiene Salones:Operar. Ver docs/features/pagos.md.
  @Get('porcentaje-sugerido-venta')
  @RequiresPermiso('Ventas', 'Crear')
  porcentajeSugeridoVenta(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.distribucion.obtenerPorcentajeSugerido(user.tenantId!, 'pos');
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npx jest src/modules/propinas/propina-distribucion.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck y commit**

```bash
cd backend && npm run lint:check && npm run typecheck
git add startup-pos.sql backend/src/modules/propinas/entities/propina-configuracion.entity.ts \
        backend/src/modules/propinas/dto/update-distribucion.dto.ts \
        backend/src/modules/propinas/propina-distribucion.controller.ts \
        backend/src/modules/propinas/propina-distribucion.service.ts \
        backend/src/modules/propinas/propina-distribucion.service.spec.ts
git commit -m "feat(propinas): flags habilitado_pos/habilitado_salones en la config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Enforcement en el choke point de ventas + E2E (backend)

En `ventas.service.ts`, donde convergen los dos caminos de propina, se cargan los flags y se ignora la propina del canal apagado. La venta se crea igual, sin `venta_propina`.

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (imports + bloque `7g`, ~L474-525)
- Test: `backend/test/liquidacion-propinas.e2e-spec.ts`

**Interfaces:**
- Consumes: `PropinaConfiguracion` (entity, Task 1), `dto.propinaDirecta` (POS), `dto.propinaCierreMesa` (Salones).
- Produces: ninguna nueva firma pública; cambia el comportamiento de `POST /ventas`.

- [ ] **Step 1: Escribir el test E2E que falla**

En `backend/test/liquidacion-propinas.e2e-spec.ts`:

1. Extender el helper `putDistribucion` para aceptar flags opcionales (mantiene compat con las llamadas actuales):

```ts
  async function putDistribucion(
    grupos: GrupoDistribucion[],
    porcentajeSugerido = '0.10',
    flags: { habilitadoPos?: boolean; habilitadoSalones?: boolean } = {},
  ): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/propinas/distribucion')
      .set('Authorization', `Bearer ${token}`)
      .send({ porcentajeSugerido, grupos, ...flags })
      .expect(200);
  }
```

2. Agregar helper para contar propinas de una venta (junto a los demás helpers, usa `ds` como el resto del archivo):

```ts
  async function contarPropinasDeVenta(ventaId: string): Promise<number> {
    const rows = (await ds.query(
      `SELECT COUNT(*)::int AS n FROM venta_propina
       WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    )) as { n: number }[];
    return rows[0]?.n ?? 0;
  }
```

3. Localizar el `GARZON_ID` de un garzón real del seed usado en el resto del archivo (buscar la constante ya existente, p. ej. `ANA_ID`/`GARZON_*`; reusar esa). Agregar un `describe` nuevo, hermano del bloque de config alternativa, que restaura la config en `afterAll`:

```ts
  describe('enforcement de propina por canal', () => {
    afterAll(async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT, '0.10', {
        habilitadoPos: true,
        habilitadoSalones: true,
      });
    });

    it('POS deshabilitado: la venta con propinaDirecta se crea SIN venta_propina', async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT, '0.10', { habilitadoPos: false });

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
      expect(await contarPropinasDeVenta(ventaId)).toBe(0);
    });

    it('Salones deshabilitado: la venta con propinaCierreMesa se crea SIN venta_propina', async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT, '0.10', { habilitadoSalones: false });

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          propinaCierreMesa: {
            garzonId: GARZON_ID,
            montoPagado: '5000',
            porcentajeSugerido: '0.10',
          },
        })
        .expect(201);

      const ventaId = (res.body as { id: string }).id;
      expect(await contarPropinasDeVenta(ventaId)).toBe(0);
    });

    it('POS habilitado (default): la propinaDirecta SÍ crea venta_propina', async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT, '0.10', { habilitadoPos: true });

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
      expect(await contarPropinasDeVenta(ventaId)).toBe(1);
    });
  });
```

> Nota de stock: cada venta consume 1 unidad de `ITEM_ID`. Son 3 ventas; verificar que el presupuesto de stock del seed lo aguanta en CI (BD fresca). Si `GARZON_ID` no está como constante, tomar uno del seed con una query previa en `beforeAll` (`SELECT garzon_id FROM garzones WHERE tenant_id=$1 AND es_placeholder=false AND eliminado_el IS NULL LIMIT 1`).

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npm run test:e2e -- --testPathPatterns=liquidacion-propinas`
Expected: FAIL — los dos primeros casos dan 1 propina en vez de 0 (el guard aún no existe).

- [ ] **Step 3: Implementar el guard en ventas.service**

En `ventas.service.ts`:

1. Agregar `IsNull` al import de typeorm (L8):

```ts
import { DataSource, EntityManager, IsNull } from 'typeorm';
```

2. Importar la entity (junto a los demás imports de entities de propinas, cerca de L15-16):

```ts
import { PropinaConfiguracion } from '../propinas/entities/propina-configuracion.entity';
```

3. En el bloque `7g`, después de la validación de combinación y antes de `let ventaPropinaId`, cargar los flags; luego agregar la condición de canal a cada rama:

```ts
    // 7g. Propina (cierre de mesa o directa del POS) — antes de pagos, para referencia_id
    if (dto.propinaCierreMesa && dto.propinaDirecta) {
      throw new BadRequestException(
        'No se puede combinar propina de cierre de mesa con propina directa',
      );
    }
    // Flags de canal: propina de un canal deshabilitado se ignora (la venta
    // se crea sin propina). Ver docs/features/liquidacion-propinas-config.md.
    const propinaConfig = await manager.findOne(PropinaConfiguracion, {
      where: { tenantId, eliminadoEl: IsNull() },
    });
    const habilitadoPos = propinaConfig?.habilitadoPos ?? true;
    const habilitadoSalones = propinaConfig?.habilitadoSalones ?? true;
    let ventaPropinaId: string | null = null;
    let propinaMonto = '0';
    let estrategiaPropina = EstrategiaAsignacionPropina.NO_VUELTO;
    if (dto.propinaCierreMesa && habilitadoSalones) {
```

y cambiar la rama del POS:

```ts
    } else if (dto.propinaDirecta && habilitadoPos) {
```

(El resto del cuerpo de cada rama queda igual. Cuando el canal está apagado, ninguna rama entra y `ventaPropinaId`/`propinaMonto` quedan en sus defaults.)

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npm run test:e2e -- --testPathPatterns=liquidacion-propinas`
Expected: PASS (los 3 casos nuevos + los preexistentes).

- [ ] **Step 5: Lint + typecheck y commit**

```bash
cd backend && npm run lint:check && npm run typecheck
git add backend/src/modules/ventas/ventas.service.ts backend/test/liquidacion-propinas.e2e-spec.ts
git commit -m "feat(propinas): ignorar propina de canal deshabilitado en ventas.service

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Gating del prompt de propina en POS y Salones (frontend)

Los dos endpoints ahora devuelven `habilitado`. `usePropina` lo propaga y cada página oculta el input de propina cuando su canal está apagado.

**Files:**
- Modify: `frontend/app/composables/usePropina.ts`
- Modify: `frontend/app/pages/ventas/pos.vue`
- Modify: `frontend/app/pages/salones/index.vue`

**Interfaces:**
- Consumes: `GET /propinas/porcentaje-sugerido{,-venta}` → `{ porcentajeSugerido, habilitado }` (Task 1).
- Produces:
  - `fetchPorcentajeSugerido(): Promise<{ porcentajeSugerido: string; habilitado: boolean }>`
  - `fetchPorcentajeSugeridoVenta(): Promise<{ porcentajeSugerido: string; habilitado: boolean }>`

- [ ] **Step 1: Cambiar el contrato de los fetch en usePropina.ts**

Reemplazar ambas funciones para devolver también `habilitado` (default `true` en el catch, para no romper el cobro si el endpoint falla):

```ts
export async function fetchPorcentajeSugerido(): Promise<{
  porcentajeSugerido: string
  habilitado: boolean
}> {
  const apiUrl = useRuntimeConfig().public.apiUrl
  try {
    const res = await useApiFetch<{ porcentajeSugerido: string, habilitado: boolean }>(
      `${apiUrl}/propinas/porcentaje-sugerido`,
    )
    return {
      porcentajeSugerido: res.porcentajeSugerido || PROPINA_PORCENTAJE_DEFAULT,
      habilitado: res.habilitado ?? true,
    }
  }
  catch {
    return { porcentajeSugerido: PROPINA_PORCENTAJE_DEFAULT, habilitado: true }
  }
}

export async function fetchPorcentajeSugeridoVenta(): Promise<{
  porcentajeSugerido: string
  habilitado: boolean
}> {
  const apiUrl = useRuntimeConfig().public.apiUrl
  try {
    const res = await useApiFetch<{ porcentajeSugerido: string, habilitado: boolean }>(
      `${apiUrl}/propinas/porcentaje-sugerido-venta`,
    )
    return {
      porcentajeSugerido: res.porcentajeSugerido || PROPINA_PORCENTAJE_DEFAULT,
      habilitado: res.habilitado ?? true,
    }
  }
  catch {
    return { porcentajeSugerido: PROPINA_PORCENTAJE_DEFAULT, habilitado: true }
  }
}
```

- [ ] **Step 2: Gating en pos.vue**

1. Agregar el ref junto a `propinaPorcentaje` (~L49):

```ts
const propinaHabilitada = ref(true)
```

2. En `onMounted` (~L158), reemplazar la asignación:

```ts
  const { porcentajeSugerido, habilitado } = await fetchPorcentajeSugeridoVenta()
  propinaPorcentaje.value = porcentajeSugerido
  propinaHabilitada.value = habilitado
```

3. En el armado del body (~L196), gatear también por el flag:

```ts
    if (propinaHabilitada.value && new Decimal(propinaMonto.value || '0').gt(0)) {
      body.propinaDirecta = {
        montoPagado: propinaMonto.value,
        porcentajeSugerido: propinaPorcentaje.value,
      }
    }
```

4. En el `<VentasCobroModal>` (~L344), hacer condicional `modo-propina`:

```vue
        :modo-propina="propinaHabilitada"
```

(reemplaza la línea `modo-propina`). Con `modoPropina=false` el modal cobra solo el total, sin fila de propina — es el comportamiento ya soportado por `CobroModal`.

- [ ] **Step 3: Gating en salones/index.vue**

1. Agregar el ref junto a `propinaPorcentaje` (~L86):

```ts
const propinaHabilitada = ref(true)
```

2. En `onMounted` (~L324-332), el `Promise.all` desestructura `pct` de `fetchPorcentajeSugerido()`. Ahora devuelve un objeto:

```ts
  const [, , , , sugerido] = await Promise.all([
    cajaStore.cargarActiva(),
    cargarSalones(),
    cargarCatalogo(),
    unidadesStore.ensureLoaded(),
    fetchPorcentajeSugerido(),
    cargarEmisor(),
  ])
  propinaPorcentaje.value = sugerido.porcentajeSugerido
  propinaHabilitada.value = sugerido.habilitado
```

3. En el armado del body del cierre de mesa (~L776 y ~L859), gatear la propina por el flag. En el bloque `propinaSugerida` (~L776):

```ts
      ...(propinaHabilitada.value && new Decimal(propinaPorcentaje.value || '0').gt(0)
```

(agrega `propinaHabilitada.value &&` al comienzo de la condición existente). Y en el bloque `propina` (~L859):

```ts
          ...(propinaHabilitada.value && new Decimal(tipMonto).gt(0) ? { propina: { monto: tipMonto } } : {}),
```

4. En el `<VentasCobroModal>` (~L1212-1221), hacer condicional `modo-propina` **y** pasar `:total`. Salones hoy solo pasa `:venta-total`; cuando `modoPropina=false`, `CobroModal.totalAPagar` cae a `props.total` (default `'0'`), así que hay que pasar el total de la venta para que el cobro no vaya a $0. Reemplazar la línea `modo-propina` por:

```vue
        :modo-propina="propinaHabilitada"
        :total="totalFinal"
```

Con `modoPropina=true` (canal habilitado) `:total` se ignora y cobra `ventaTotal + propina`; con `modoPropina=false` (canal apagado) cobra `:total` = el total de la venta, sin propina.

- [ ] **Step 4: Build + typecheck**

Run:
```bash
cd frontend && npm run typecheck:ratchet && npm run build && npm run design:check
```
Expected: PASS, sin nuevos errores de vue-tsc.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/usePropina.ts frontend/app/pages/ventas/pos.vue frontend/app/pages/salones/index.vue
git commit -m "feat(propinas): ocultar prompt de propina cuando el canal esta deshabilitado

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Toggles en la pantalla de configuración (frontend)

Dos `USwitch` en `/configuracion/propinas-distribucion` para que el admin encienda/apague cada canal; se mandan en el mismo `PUT`.

**Files:**
- Modify: `frontend/app/composables/usePropinaDistribucion.ts`
- Modify: `frontend/app/pages/configuracion/propinas-distribucion.vue`

**Interfaces:**
- Consumes: `GET/PUT /propinas/distribucion` con `habilitadoPos`/`habilitadoSalones` (Task 1).
- Produces: n/a.

- [ ] **Step 1: Extender los tipos del composable**

En `usePropinaDistribucion.ts`:

1. En `interface DistribucionPublica`, tras `porcentajeSugerido: string`:

```ts
  habilitadoPos: boolean
  habilitadoSalones: boolean
```

2. En `interface UpdateDistribucionBody`, tras `porcentajeSugerido: string`:

```ts
  habilitadoPos?: boolean
  habilitadoSalones?: boolean
```

- [ ] **Step 2: Estado + carga + guardado en la página**

En `propinas-distribucion.vue`:

1. Junto a `porcentajeSugeridoHumano` (~L29):

```ts
const habilitadoPos = ref(true)
const habilitadoSalones = ref(true)
```

2. En `aplicarRespuesta` (~L72), tras setear `porcentajeSugeridoHumano`:

```ts
  habilitadoPos.value = data.habilitadoPos ?? true
  habilitadoSalones.value = data.habilitadoSalones ?? true
```

3. En `guardar` (~L175), agregar los flags al `body`, tras `porcentajeSugerido`:

```ts
      porcentajeSugerido: porcentajeHumanoADecimal(porcentajeSugeridoHumano.value),
      habilitadoPos: habilitadoPos.value,
      habilitadoSalones: habilitadoSalones.value,
```

- [ ] **Step 3: UI de los toggles**

En el template, dentro del primer `<UCard>` (el de "Propina sugerida"), después del `</UFormField>` del porcentaje (~L242) y antes de cerrar `</UCard>`:

```vue
        <UFormField
          label="Habilitar propina en POS"
          hint="Si se apaga, el POS no ofrece propina al cobrar."
          class="mt-4"
        >
          <USwitch
            v-model="habilitadoPos"
            :disabled="!puedeConfigurar"
            data-qa="propina-habilitado-pos"
          />
        </UFormField>
        <UFormField
          label="Habilitar propina en Salones"
          hint="Si se apaga, el cierre de mesa no ofrece propina."
          class="mt-4"
        >
          <USwitch
            v-model="habilitadoSalones"
            :disabled="!puedeConfigurar"
            data-qa="propina-habilitado-salones"
          />
        </UFormField>
```

- [ ] **Step 4: Build + typecheck + design check**

Run:
```bash
cd frontend && npm run typecheck:ratchet && npm run build && npm run design:check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/usePropinaDistribucion.ts frontend/app/pages/configuracion/propinas-distribucion.vue
git commit -m "feat(propinas): toggles habilitar propina POS/Salones en configuracion

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Documentación + gate completo

**Files:**
- Modify: `docs/features/liquidacion-propinas-config.md`
- Modify: `docs/features/pagos.md`
- Modify: `docs/ESTADO.md`

- [ ] **Step 1: Documentar los flags en la config**

En `docs/features/liquidacion-propinas-config.md`, en la sección de la config / el body del `PUT`, agregar que `propina_configuracion` ahora tiene `habilitado_pos` / `habilitado_salones` (default `true`), que `PUT /propinas/distribucion` los acepta (opcionales, conservan el valor si faltan) y que `GET /propinas/distribucion` los devuelve. Anotar que los dos endpoints por-canal (`porcentaje-sugerido` = salones, `porcentaje-sugerido-venta` = POS) devuelven `habilitado` de su canal.

- [ ] **Step 2: Documentar el enforcement en pagos.md**

En `docs/features/pagos.md`, sección "Propina en el POS", agregar una nota: la propina POS solo se registra si `habilitado_pos` está activo; si el admin lo apaga, `POST /ventas` con `propinaDirecta` crea la venta **sin** `venta_propina` (se ignora, no se rechaza). Análogo para salones/`propinaCierreMesa` con `habilitado_salones`.

- [ ] **Step 3: Actualizar ESTADO.md**

En `docs/ESTADO.md`, en la fila de propinas (o agregando una sub-línea), reflejar "habilitar propina por canal (POS/Salones)" como ✅ con fecha 2026-07-23.

- [ ] **Step 4: Gate completo del proyecto**

Run:
```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd ../frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```
Expected: todo verde. Si algo falla, la tarea no está terminada.

- [ ] **Step 5: Commit**

```bash
git add docs/features/liquidacion-propinas-config.md docs/features/pagos.md docs/ESTADO.md
git commit -m "docs(propinas): habilitar propina por canal (POS/Salones)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notas de verificación (para el revisor independiente)

- **Choke point correcto:** confirmar que `dto.propinaDirecta` proviene solo del POS y `dto.propinaCierreMesa` solo de salones (mapeo flag↔canal). El único productor de `propinaCierreMesa` es `salones.service.ts`; el único de `propinaDirecta` es `pos.vue`.
- **Sin N+1:** el guard hace **una** lectura de `propina_configuracion` por venta con intención de propina, indexada por `tenant_id` (índice único parcial ya existente). No hay query por iteración.
- **Soft delete:** la lectura del guard filtra `eliminadoEl: IsNull()`.
- **Default seguro:** si no hay fila de config (tenant sin config aún), el guard trata ambos canales como habilitados (`?? true`), preservando el comportamiento actual.
- **Compat del PUT:** flags opcionales; una llamada que no los mande conserva el valor persistido (Task 1 Step 3d solo asigna si `!== undefined`).
