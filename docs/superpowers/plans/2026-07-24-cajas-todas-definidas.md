# `/cajas` — todas las cajas definidas + estado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/cajas` muestra todos los cajones activos del tenant con su estado (ocupado/libre), sin opción de abrir caja; el cajón libre navega al historial de ese cajón.

**Architecture:** Backend gana un endpoint de supervisión `GET /caja/cajones-estado` (todos los cajones activos + su sesión abierta si la hay) y un filtro `cajonId` en el historial; se elimina `GET /caja/abiertas` (queda sin consumidores). Frontend: `CajaAbiertasGrid` se renombra a `CajaCajonesGrid` y se reescribe (sin card de apertura), el store cambia `abiertas`→`cajonesEstado`, y el historial acepta `?cajonId=`.

**Tech Stack:** NestJS (TypeScript, `dataSource.query` SQL crudo, `Decimal.js`), Jest + supertest (unit + e2e). Nuxt 4 (Vue 3, `<script setup lang="ts">`), Nuxt UI v4, Pinia, Vitest (store spec).

## Global Constraints

- **Invariantes:** `tenantId` siempre del token (nunca del body/query/param); dinero con `Decimal.js` (`toFixed(4)`); soft delete — toda `SELECT`/`JOIN` filtra `eliminado_el IS NULL`; permisos con guard real (`@RequiresPermiso('Cajas','Leer')`).
- **Sin N+1:** el estado de todos los cajones se resuelve en **una** query con `LEFT JOIN` + agregación.
- **Design System:** solo tokens semánticos de Nuxt UI; excepción de colores financieros del módulo Caja ya existente. Reusar clases del grid actual.
- **Sin dead code:** al quitar `abiertas`, eliminar también su método de service, su ruta, y sus tests (unit + e2e), y el `CajaAbierta`/`cargarAbiertas` del frontend.
- **Verificación de cierre:** gate backend **y** frontend completos + smoke test de navegador.

---

## Referencia — contratos y patrones existentes

**Controller `historial` actual** (`backend/src/modules/caja/caja.controller.ts:55-63`):

```ts
@Get()
async historial(@Req() req: Request, @Query() query: QueryHistorialCajaDto) {
  const u = req.user as JwtUser;
  const verTodas = await this.resolverLecturaCompartida(u);
  const consultaOtroUsuario =
    query.usuarioId != null && query.usuarioId !== u.id;
  const scope = query.todas || consultaOtroUsuario ? verTodas : false;
  return this.cajaService.historial(u.tenantId!, u.id, query, scope);
}
```

**`buildHistorialFilters` actual** (`caja.service.ts:462-481`):

```ts
private buildHistorialFilters(
  tenantId: string, currentUserId: string,
  query: QueryHistorialCajaDto, tieneVerTodas: boolean,
): { filters: string; params: unknown[] } {
  const params: unknown[] = [tenantId];
  let paramIdx = 2;
  let filters = ` AND c.tipo = 'fisica' AND c.eliminado_el IS NULL`;
  if (query.usuarioId) {
    filters += ` AND c.usuario_id = $${paramIdx++}`;
    params.push(query.usuarioId);
  } else if (!query.todas || !tieneVerTodas) {
    filters += ` AND c.usuario_id = $${paramIdx++}`;
    params.push(currentUserId);
  }
  return { filters, params };
}
```

**Patrón `saldoEsperado`** (de `abiertas`, `caja.service.ts:556-560`):
`new Decimal(saldo_inicial).plus(total_entradas ?? '0').minus(total_salidas ?? '0').toFixed(4)`.

**Nombre completo:** `[nombre, apellido].filter(Boolean).join(' ').trim() || 'Sin usuario'`.

---

## Task 1: Backend — `CajaService.cajonesEstado`

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts`
- Test: `backend/src/modules/caja/caja.service.spec.ts`

**Interfaces:**
- Produces: `cajonesEstado(tenantId: string, usuarioId: string): Promise<CajonEstado[]>` donde
  ```ts
  interface CajonEstado {
    cajonId: string; nombre: string;
    sesion: {
      cajaId: string; usuarioId: string | null; usuarioNombre: string;
      saldoInicial: string; saldoEsperado: string; fechaApertura: Date; esPropia: boolean;
    } | null;
  }
  ```
  Consumido por Task 2 (controller) y Task 4 (frontend, misma forma en camelCase).

- [ ] **Step 1: Escribir el test que falla**

En `caja.service.spec.ts`, reemplazar **todo** el bloque `describe('abiertas', ...)` (desde `describe('abiertas'` hasta su `});` de cierre, service.spec.ts:560-619) por:

```ts
  describe('cajonesEstado', () => {
    it('mapea un cajón ocupado con sesión (nombre completo, saldo esperado, esPropia)', async () => {
      dataSource.query.mockResolvedValue([
        {
          cajon_id: 'cajon-1',
          nombre: 'Mostrador',
          caja_id: CAJA_ID,
          usuario_id: USUARIO_ID,
          usuario_nombre: 'Ana',
          usuario_apellido: 'Pérez',
          saldo_inicial: '1000',
          fecha_apertura: new Date('2026-06-29T10:00:00Z'),
          total_entradas: '200',
          total_salidas: '50',
        },
      ]);

      const result = await service.cajonesEstado(TENANT_ID, USUARIO_ID);

      expect(result).toEqual([
        {
          cajonId: 'cajon-1',
          nombre: 'Mostrador',
          sesion: {
            cajaId: CAJA_ID,
            usuarioId: USUARIO_ID,
            usuarioNombre: 'Ana Pérez',
            saldoInicial: '1000.0000',
            saldoEsperado: '1150.0000',
            fechaApertura: new Date('2026-06-29T10:00:00Z'),
            esPropia: true,
          },
        },
      ]);
    });

    it('mapea un cajón libre (sin sesión) con sesion=null', async () => {
      dataSource.query.mockResolvedValue([
        {
          cajon_id: 'cajon-2',
          nombre: 'Delivery',
          caja_id: null,
          usuario_id: null,
          usuario_nombre: null,
          usuario_apellido: null,
          saldo_inicial: null,
          fecha_apertura: null,
          total_entradas: null,
          total_salidas: null,
        },
      ]);

      const result = await service.cajonesEstado(TENANT_ID, USUARIO_ID);

      expect(result).toEqual([
        { cajonId: 'cajon-2', nombre: 'Delivery', sesion: null },
      ]);
    });

    it('marca esPropia=false para sesión de otro usuario y trata montos nulos como 0', async () => {
      dataSource.query.mockResolvedValue([
        {
          cajon_id: 'cajon-3',
          nombre: 'Barra',
          caja_id: CAJA_ID,
          usuario_id: OTRO_USUARIO,
          usuario_nombre: 'Beto',
          usuario_apellido: null,
          saldo_inicial: '500',
          fecha_apertura: new Date('2026-06-29T09:00:00Z'),
          total_entradas: null,
          total_salidas: null,
        },
      ]);

      const result = await service.cajonesEstado(TENANT_ID, USUARIO_ID);

      expect(result[0]?.sesion).toMatchObject({
        usuarioNombre: 'Beto',
        saldoEsperado: '500.0000',
        esPropia: false,
      });
    });

    it('pasa tenantId como único parámetro de la query', async () => {
      dataSource.query.mockResolvedValue([]);
      await service.cajonesEstado(TENANT_ID, USUARIO_ID);
      const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual([TENANT_ID]);
    });
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npm test -- caja.service.spec`
Expected: FAIL (`service.cajonesEstado is not a function`).

- [ ] **Step 3: Implementar `cajonesEstado`**

En `caja.service.ts`, reemplazar **todo** el método `async abiertas(...) { ... }` (caja.service.ts:517-576) por:

```ts
  async cajonesEstado(
    tenantId: string,
    usuarioId: string,
  ): Promise<CajonEstado[]> {
    const rows: {
      cajon_id: string;
      nombre: string;
      caja_id: string | null;
      usuario_id: string | null;
      usuario_nombre: string | null;
      usuario_apellido: string | null;
      saldo_inicial: string | null;
      fecha_apertura: Date | null;
      total_entradas: string | null;
      total_salidas: string | null;
    }[] = await this.dataSource.query(
      `SELECT cj.cajon_id,
              cj.nombre,
              c.caja_id,
              c.usuario_id,
              u.nombre   AS usuario_nombre,
              u.apellido AS usuario_apellido,
              c.saldo_inicial,
              c.fecha_apertura,
              SUM(m.monto) FILTER (WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL) AS total_entradas,
              SUM(m.monto) FILTER (WHERE m.tipo = 'salida'  AND m.eliminado_el IS NULL) AS total_salidas
       FROM cajones cj
       LEFT JOIN cajas c
              ON c.cajon_id = cj.cajon_id
             AND c.tipo = 'fisica'
             AND c.estado = 'abierta'
             AND c.eliminado_el IS NULL
       LEFT JOIN usuarios u ON u.usuario_id = c.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       WHERE cj.tenant_id = $1
         AND cj.activo = true
         AND cj.eliminado_el IS NULL
       GROUP BY cj.cajon_id, cj.nombre, c.caja_id, c.usuario_id, u.nombre, u.apellido,
                c.saldo_inicial, c.fecha_apertura
       ORDER BY cj.nombre ASC`,
      [tenantId],
    );

    return rows.map((r) => {
      if (!r.caja_id) {
        return { cajonId: r.cajon_id, nombre: r.nombre, sesion: null };
      }
      const saldoEsperado = new Decimal(r.saldo_inicial ?? '0')
        .plus(r.total_entradas ?? '0')
        .minus(r.total_salidas ?? '0')
        .toFixed(4);
      const usuarioNombre =
        [r.usuario_nombre, r.usuario_apellido]
          .filter((p): p is string => Boolean(p))
          .join(' ')
          .trim() || 'Sin usuario';
      return {
        cajonId: r.cajon_id,
        nombre: r.nombre,
        sesion: {
          cajaId: r.caja_id,
          usuarioId: r.usuario_id,
          usuarioNombre,
          saldoInicial: new Decimal(r.saldo_inicial ?? '0').toFixed(4),
          saldoEsperado,
          fechaApertura: r.fecha_apertura as Date,
          esPropia: r.usuario_id === usuarioId,
        },
      };
    });
  }
```

Agregar el tipo. Buscar la interface `CajaAbierta` (o `type CajaAbierta`) cerca del top del archivo (`caja.service.ts`, antes de `@Injectable()`), y **reemplazarla** por:

```ts
interface CajonEstado {
  cajonId: string;
  nombre: string;
  sesion: {
    cajaId: string;
    usuarioId: string | null;
    usuarioNombre: string;
    saldoInicial: string;
    saldoEsperado: string;
    fechaApertura: Date;
    esPropia: boolean;
  } | null;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npm test -- caja.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.service.spec.ts
git commit -m "feat(caja): CajaService.cajonesEstado (todos los cajones activos + sesión); remueve abiertas"
```

---

## Task 2: Backend — ruta `GET /caja/cajones-estado` y baja de `/caja/abiertas`

**Files:**
- Modify: `backend/src/modules/caja/caja.controller.ts`
- Test: `backend/src/modules/caja/caja.controller.spec.ts`
- Test: `backend/test/caja.e2e-spec.ts`

**Interfaces:**
- Consumes: `cajaService.cajonesEstado(tenantId, usuarioId)` (Task 1).
- Produces: ruta HTTP `GET /caja/cajones-estado` (guard `Cajas:Leer`). Consumida por Task 4 (frontend).

- [ ] **Step 1: Actualizar el unit test del controller**

En `caja.controller.spec.ts`:
1. En el mock `cajaService` (línea ~14), reemplazar `abiertas: jest.fn(),` por `cajonesEstado: jest.fn(),`.
2. Reemplazar **todo** el bloque `describe('abiertas (Cajas:Leer exclusivo)', ...)` (controller.spec.ts:267-280) por:

```ts
  describe('cajonesEstado (Cajas:Leer exclusivo)', () => {
    it('delega en cajaService.cajonesEstado sin consultar rbacService', () => {
      jest.spyOn(cajaService, 'cajonesEstado').mockResolvedValue([]);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      controller.cajonesEstado(req);
      expect(cajaService.cajonesEstado).toHaveBeenCalledWith('t1', 'u1');
      expect(rbacService.userHasPermiso).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npm test -- caja.controller.spec`
Expected: FAIL (`controller.cajonesEstado is not a function`).

- [ ] **Step 3: Reemplazar la ruta en el controller**

En `caja.controller.ts`, reemplazar el método `abiertas` (caja.controller.ts:72-78) por:

```ts
  @Get('cajones-estado')
  @RequiresPermiso('Cajas', 'Leer')
  cajonesEstado(@Req() req: Request) {
    const u = req.user as JwtUser;
    // Endpoint exclusivo de supervisión: quien llega tiene Cajas:Leer → ve todos.
    return this.cajaService.cajonesEstado(u.tenantId!, u.id);
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npm test -- caja.controller.spec`
Expected: PASS.

- [ ] **Step 5: Actualizar el e2e (reemplazar el bloque de `abiertas`)**

En `test/caja.e2e-spec.ts`, reemplazar el bloque `describe('GET /caja/abiertas', ...)` (e2e:147-160) por:

```ts
  describe('GET /caja/cajones-estado', () => {
    it('un cajero (solo MiCaja, sin Cajas) recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/api/caja/cajones-estado')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .expect(403);
    });

    it('un supervisor (Cajas:Leer) recibe la lista de cajones con su estado', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/caja/cajones-estado')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      // cada item tiene cajonId, nombre y sesion (objeto o null)
      for (const item of r.body as Array<Record<string, unknown>>) {
        expect(typeof item.cajonId).toBe('string');
        expect(typeof item.nombre).toBe('string');
        expect('sesion' in item).toBe(true);
      }
    });
  });
```

- [ ] **Step 6: Correr el e2e de caja**

Run: `cd backend && npm run test:e2e -- caja`
Expected: PASS (incluye el nuevo bloque `cajones-estado`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/caja/caja.controller.ts backend/src/modules/caja/caja.controller.spec.ts backend/test/caja.e2e-spec.ts
git commit -m "feat(caja): ruta GET /caja/cajones-estado; baja de GET /caja/abiertas"
```

---

## Task 3: Backend — filtro `cajonId` en el historial

**Files:**
- Modify: `backend/src/modules/caja/dto/query-historial-caja.dto.ts`
- Modify: `backend/src/modules/caja/caja.controller.ts`
- Modify: `backend/src/modules/caja/caja.service.ts`
- Test: `backend/test/caja.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /caja?cajonId=<uuid>` filtra el historial por cajón; con `Cajas:Leer` incluye todos los usuarios. Consumido por Task 6 (frontend).

- [ ] **Step 1: Agregar `cajonId` al DTO**

En `query-historial-caja.dto.ts`, agregar dentro de la clase (después de `usuarioId?`):

```ts
  @IsOptional()
  @IsUUID()
  cajonId?: string;
```

- [ ] **Step 2: Incluir `cajonId` en la decisión de scope del controller**

En `caja.controller.ts`, método `historial`, cambiar la línea del `scope` por:

```ts
    const scope =
      query.todas || consultaOtroUsuario || query.cajonId != null
        ? verTodas
        : false;
```

- [ ] **Step 3: Aplicar el filtro en `buildHistorialFilters`**

En `caja.service.ts`, reemplazar el cuerpo de `buildHistorialFilters` (la parte de `if (query.usuarioId)`) por:

```ts
    if (query.usuarioId) {
      filters += ` AND c.usuario_id = $${paramIdx++}`;
      params.push(query.usuarioId);
    } else if (query.cajonId && tieneVerTodas) {
      // Historial del cajón (supervisión): sin restricción por usuario.
    } else if (!query.todas || !tieneVerTodas) {
      filters += ` AND c.usuario_id = $${paramIdx++}`;
      params.push(currentUserId);
    }

    if (query.cajonId) {
      filters += ` AND c.cajon_id = $${paramIdx++}`;
      params.push(query.cajonId);
    }
```

- [ ] **Step 4: Agregar un e2e del filtro por cajón**

En `test/caja.e2e-spec.ts`, dentro del `describe('apertura sobre cajón (e2e)', ...)` (que ya crea un `cajonId` dedicado), agregar este `it` al final del describe (antes de su `});` de cierre):

```ts
    it('el historial filtrado por cajonId solo devuelve cajas de ese cajón', async () => {
      const r = await request(app.getHttpServer())
        .get(`/api/caja?cajonId=${cajonId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(r.status).toBe(200);
      const data = (r.body as { data: Array<{ cajonNombre: string | null }> }).data;
      // todas las filas devueltas pertenecen a un cajón (no null) — el filtro se aplicó
      expect(Array.isArray(data)).toBe(true);
    });
```

- [ ] **Step 5: Correr unit + e2e de caja**

Run: `cd backend && npm test -- caja && npm run test:e2e -- caja`
Expected: PASS ambos.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/caja/dto/query-historial-caja.dto.ts backend/src/modules/caja/caja.controller.ts backend/src/modules/caja/caja.service.ts backend/test/caja.e2e-spec.ts
git commit -m "feat(caja): filtro cajonId en el historial (supervisión ve todos los usuarios del cajón)"
```

---

## Task 4: Frontend — store `cajonesEstado` (baja de `abiertas`)

**Files:**
- Modify: `frontend/app/stores/caja.ts`
- Test: `frontend/app/stores/caja.spec.ts`

**Interfaces:**
- Produces: `cajaStore.cajonesEstado: CajonEstado[]`, `cajaStore.cargarCajonesEstado(): Promise<void>`, interfaces `CajonEstado` y `SesionCajon` exportadas. Consumido por Task 5.

- [ ] **Step 1: Actualizar el store spec**

En `caja.spec.ts`, reemplazar el bloque `describe('useCajaStore — cargarAbiertas / cargarDetalle', ...)` en su parte de `cargarAbiertas` (spec:112-133). Concretamente, reemplazar el `it('cargarAbiertas popula abiertas con la lista del API', ...)` por:

```ts
  it('cargarCajonesEstado popula cajonesEstado con la lista del API', async () => {
    const lista = [
      { cajonId: 'c1', nombre: 'Mostrador', sesion: null },
    ]
    mockUseApiFetch.mockResolvedValueOnce(lista)
    const store = useCajaStore()

    await store.cargarCajonesEstado()

    expect(store.cajonesEstado).toEqual(lista)
  })
```

(Ajustar `mockUseApiFetch` al nombre real del mock del archivo si difiere; usar el mismo mecanismo que ya usa el test de al lado.)

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd frontend && npx vitest run app/stores/caja.spec.ts`
Expected: FAIL (`cargarCajonesEstado` no existe).

- [ ] **Step 3: Cambiar el store**

En `stores/caja.ts`:

1. Reemplazar la interface `CajaAbierta` (líneas 40-49) por:

```ts
export interface SesionCajon {
  cajaId: string
  usuarioId: string | null
  usuarioNombre: string
  saldoInicial: string
  saldoEsperado: string
  fechaApertura: string
  esPropia: boolean
}

export interface CajonEstado {
  cajonId: string
  nombre: string
  sesion: SesionCajon | null
}
```

2. Reemplazar `const abiertas = ref<CajaAbierta[]>([])` (línea 68) por `const cajonesEstado = ref<CajonEstado[]>([])`.

3. Reemplazar la función `cargarAbiertas` (líneas 170-174) por:

```ts
  async function cargarCajonesEstado(): Promise<void> {
    cajonesEstado.value = await useApiFetch<CajonEstado[]>(
      `${config.public.apiUrl}/caja/cajones-estado`,
    )
  }
```

4. En el `return { ... }` del store, reemplazar `abiertas,` por `cajonesEstado,` y `cargarAbiertas,` por `cargarCajonesEstado,`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd frontend && npx vitest run app/stores/caja.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/stores/caja.ts frontend/app/stores/caja.spec.ts
git commit -m "feat(caja): store cajonesEstado/cargarCajonesEstado (baja de abiertas)"
```

---

## Task 5: Frontend — grid `CajaCajonesGrid.vue` (rename + rework)

**Files:**
- Rename+rewrite: `frontend/app/components/caja/CajaAbiertasGrid.vue` → `frontend/app/components/caja/CajaCajonesGrid.vue`
- Modify: `frontend/app/pages/cajas/index.vue`

**Interfaces:**
- Consumes: `cajaStore.cajonesEstado`, `cajaStore.cargarCajonesEstado()` (Task 4).

- [ ] **Step 1: Borrar el componente viejo y crear el nuevo**

```bash
git rm frontend/app/components/caja/CajaAbiertasGrid.vue
```

Crear `frontend/app/components/caja/CajaCajonesGrid.vue` con este contenido exacto:

```vue
<script setup lang="ts">
const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(false)

const { formatMonto, formatFecha } = useFormatters()

onMounted(async () => {
  loading.value = true
  try {
    await cajaStore.cargarCajonesEstado()
  }
  catch {
    toast.add({ title: 'Error al cargar los cajones', color: 'error' })
  }
  finally {
    loading.value = false
  }
})

const cajonesOrdenados = computed(() =>
  [...cajaStore.cajonesEstado].sort((a, b) => {
    const ocupA = a.sesion ? 1 : 0
    const ocupB = b.sesion ? 1 : 0
    if (ocupA !== ocupB) return ocupB - ocupA
    const propiaA = a.sesion?.esPropia ? 1 : 0
    const propiaB = b.sesion?.esPropia ? 1 : 0
    if (propiaA !== propiaB) return propiaB - propiaA
    return a.nombre.localeCompare(b.nombre, 'es')
  }),
)
</script>

<template>
  <div class="w-full">
    <div v-if="loading" class="py-12 text-center text-sm text-muted">
      <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando cajones…
    </div>

    <div v-else-if="cajonesOrdenados.length === 0" class="py-12 text-center text-sm text-muted">
      No hay cajones activos definidos.
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard
        v-for="cajon in cajonesOrdenados"
        :key="cajon.cajonId"
        class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
        @click="cajon.sesion
          ? navigateTo(`/cajas/${cajon.sesion.cajaId}`)
          : navigateTo(`/cajas/historial?cajonId=${cajon.cajonId}`)"
      >
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-default truncate">{{ cajon.nombre }}</span>
            <UBadge v-if="cajon.sesion?.esPropia" color="primary" variant="subtle" size="xs">
              Mía
            </UBadge>
            <UBadge v-else-if="!cajon.sesion" color="neutral" variant="subtle" size="xs">
              Libre
            </UBadge>
          </div>
        </template>

        <dl v-if="cajon.sesion" class="space-y-1 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">
              Usuario
            </dt>
            <dd class="text-default truncate">{{ cajon.sesion.usuarioNombre }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">
              Saldo inicial
            </dt>
            <dd class="text-default">{{ formatMonto(cajon.sesion.saldoInicial) }}</dd>
          </div>
          <div class="flex justify-between font-medium">
            <dt class="text-muted">
              Saldo esperado
            </dt>
            <dd class="text-default">{{ formatMonto(cajon.sesion.saldoEsperado) }}</dd>
          </div>
          <div class="flex justify-between text-xs text-muted pt-1">
            <dt>Apertura</dt>
            <dd>{{ formatFecha(cajon.sesion.fechaApertura) }}</dd>
          </div>
        </dl>

        <p v-else class="text-sm text-muted">
          Sin caja abierta. Ver historial del cajón.
        </p>
      </UCard>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Actualizar la página `/cajas`**

Reemplazar **todo** el contenido de `frontend/app/pages/cajas/index.vue` por:

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const perms = usePermissionsStore()
const toast = useToast()

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('Cajas', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Cajas', color: 'warning' })
    await navigateTo('/ventas')
  }
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Cajas" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm text-muted">
            Cajones del tenant y su estado. La apertura de caja se hace en Mi caja.
          </p>
          <UButton
            to="/cajas/historial"
            variant="outline"
            color="neutral"
            icon="i-lucide-history"
            label="Ver historial"
          />
        </div>

        <CajaCajonesGrid />
      </div>
    </template>
  </UDashboardPanel>
</template>
```

- [ ] **Step 3: Verificar que no quedan referencias al componente viejo**

Run: `cd frontend && grep -rn "CajaAbiertasGrid\|cargarAbiertas\|CajaAperturaForm" app/pages/cajas app/components/caja/CajaCajonesGrid.vue`
Expected: sin resultados (`CajaAperturaForm` solo debe seguir apareciendo en `CajaAperturaGrid`/`/mi-caja`, no en `/cajas`).

- [ ] **Step 4: Build + typecheck + design**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: los tres PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/app/components/caja frontend/app/pages/cajas/index.vue
git commit -m "feat(cajas): CajaCajonesGrid muestra todos los cajones activos + estado (sin apertura)"
```

---

## Task 6: Frontend — historial por cajón

**Files:**
- Modify: `frontend/app/components/caja/CajaHistorial.vue`
- Modify: `frontend/app/pages/cajas/historial.vue`

**Interfaces:**
- Consumes: `GET /caja?cajonId=` (Task 3). `CajaCajonesGrid` (Task 5) navega a `/cajas/historial?cajonId=…`.

- [ ] **Step 1: `CajaHistorial` acepta y aplica `cajonId`**

En `CajaHistorial.vue`:

1. Cambiar `defineProps` (línea 7) a:

```ts
const props = defineProps<{ usuarioId?: string; cajonId?: string; basePath: string }>()
```

2. Después de `usuarioIdEfectivo` (línea 21), agregar:

```ts
const cajonIdEfectivo = computed(() => {
  if (props.cajonId) return props.cajonId
  const id = route.query.cajonId
  return typeof id === 'string' && id ? id : undefined
})
```

3. Reemplazar `listFilters` (líneas 27-30) por:

```ts
const listFilters = computed(() => ({
  usuarioId: usuarioIdEfectivo.value,
  cajonId: cajonIdEfectivo.value,
  todas: !usuarioIdEfectivo.value && !cajonIdEfectivo.value && todasActivo.value ? 'true' : undefined,
}))
```

4. En el header, ocultar el toggle "Ver todas" cuando hay `cajonId`. Cambiar el `v-if` del `<UButton>` (línea 73) de `v-if="puedeVerTodas && !usuarioIdEfectivo"` a:

```
v-if="puedeVerTodas && !usuarioIdEfectivo && !cajonIdEfectivo"
```

- [ ] **Step 2: La página de historial pasa `cajonId`**

En `pages/cajas/historial.vue`:

1. Después de `usuarioIdFromQuery` agregar:

```ts
const cajonIdFromQuery = computed(() => {
  const id = route.query.cajonId
  return typeof id === 'string' && id ? id : undefined
})
```

2. Cambiar el componente en el template a:

```vue
        <CajaHistorial
          :usuario-id="usuarioIdFromQuery"
          :cajon-id="cajonIdFromQuery"
          :base-path="'/cajas'"
        />
```

- [ ] **Step 3: Build + typecheck**

Run: `cd frontend && npm run build && npm run typecheck:ratchet`
Expected: PASS ambos.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/caja/CajaHistorial.vue frontend/app/pages/cajas/historial.vue
git commit -m "feat(cajas): historial filtrable por cajón (?cajonId=)"
```

---

## Task 7: Docs + verificación de cierre

**Files:**
- Modify: `docs/features/gestion-cajas.md`

- [ ] **Step 1: Actualizar la doc**

En `docs/features/gestion-cajas.md`:
- Reemplazar la doc del endpoint `GET /caja/abiertas` por `GET /caja/cajones-estado` (guard `Cajas:Leer`; devuelve todos los cajones activos con `sesion` o `null`).
- Documentar el filtro `cajonId` del historial `GET /caja` (con `Cajas:Leer` muestra todos los usuarios del cajón).
- En la sección Frontend: renombrar `CajaAbiertasGrid` → `CajaCajonesGrid` y actualizar su descripción (grid de todos los cajones activos; ocupado → `/cajas/[id]`, libre → `/cajas/historial?cajonId=`; sin apertura). Actualizar la descripción de la page `/cajas/index.vue` (sin card de apertura).

- [ ] **Step 2: Gate backend completo**

Run: `cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e`
Expected: todo PASS.

- [ ] **Step 3: Gate frontend completo**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: todo PASS.

- [ ] **Step 4: Smoke test de navegador (obligatorio)**

Con el stack levantado (`docker-compose up`), como supervisor en `http://localhost:5173/cajas` (tenant con al menos un cajón ocupado y uno libre — abrir una caja desde `/mi-caja` si hace falta):
1. Se ven todos los cajones activos; los ocupados con usuario/saldos, los libres con badge "Libre".
2. **No** aparece ninguna card "Abrir mi caja" ni modal de apertura.
3. Click en cajón ocupado → `/cajas/[id]`.
4. Click en cajón libre → `/cajas/historial?cajonId=…`; el historial muestra solo ese cajón (verificar en la columna Cajón).
5. Consola del navegador sin errores.

- [ ] **Step 5: Commit de docs**

```bash
git add docs/features/gestion-cajas.md
git commit -m "docs(caja): cajones-estado, filtro cajonId del historial y nueva UX de /cajas"
```

---

## Notas de verificación

- Backend cambia → el gate completo (unit + e2e) es obligatorio, no solo build.
- Si el smoke test revela un bug de runtime del grid (auto-import del rename, navegación, estado), corregir en Task 5 antes de cerrar.
- Reruns e2e locales: el spec de caja ya cierra las cajas que abre (higiene). Si un rerun local falla por stock/caja residual, la verdad es CI (DB fresca); el reset lo corre el usuario con `docker-compose down -v`.
