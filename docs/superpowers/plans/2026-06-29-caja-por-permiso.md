# Refactor módulo Caja por permiso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cualquier usuario con `Caja:Leer` opere su propia caja en `/caja`, y que quien tenga `Caja:Ver todas` vea un grid de todas las cajas abiertas del tenant y pueda entrar a cualquiera en modo read-only.

**Architecture:** Backend NestJS expone un endpoint nuevo `GET /caja/abiertas` (cajas abiertas + dueño + saldo esperado) y relaja `listarMovimientos` para permitir lectura con `Ver todas`; operar (movimientos/cerrar) sigue owner-only. Frontend Nuxt relaja el gate a `Caja:Leer`, agrega pestañas "Mi caja" / "Todas las cajas", un componente grid de cards y una página de detalle read-only `/caja/[id]`.

**Tech Stack:** NestJS + TypeORM + Decimal.js (backend), Nuxt 4 / Vue 3 + Pinia + @nuxt/ui (frontend), Jest (backend tests), Vitest (frontend store tests).

## Global Constraints

- Soft delete en todo: toda lectura filtra `eliminado_el IS NULL`.
- `tenant_id` y `usuario_id` siempre del token (`req.user`), nunca del body/query.
- Dinero y porcentajes con Decimal.js — nunca `number` nativo.
- Permiso "ver todas" se llama exactamente `'Ver todas'` (con espacio). El string `'VerTodas'` (sin espacio) es un bug y nunca matchea.
- Columnas UUID en entidades declaran `type: 'uuid'` (no aplica a tareas nuevas aquí, pero respetarlo si se tocan entidades).
- `@RequiresPermiso('Caja', 'Leer')` en todas las rutas de lectura; el diferenciador "ver todas" se resuelve en el handler vía `rbacService.userHasPermiso`.

---

### Task 1: Backend — `listarMovimientos` read-only para `Ver todas`

Permite que un usuario con `Caja:Ver todas` liste los movimientos de una caja ajena (lectura). El dueño sigue accediendo a la suya; quien no es dueño ni tiene `Ver todas` recibe 403.

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (método `listarMovimientos`, ~líneas 231-254)
- Modify: `backend/src/modules/caja/caja.controller.ts` (handler `listarMovimientos`, ~líneas 100-105)
- Test: `backend/src/modules/caja/caja.service.spec.ts` (describe `listarMovimientos`, ~líneas 438-493)

**Interfaces:**
- Produces: `CajaService.listarMovimientos(tenantId: string, usuarioId: string, cajaId: string, tieneVerTodas?: boolean): Promise<MovimientoCaja[]>`

- [ ] **Step 1: Actualizar los tests existentes de `listarMovimientos`**

Reemplazar el bloque `describe('listarMovimientos', ...)` completo (líneas 438-493) por:

```ts
  describe('listarMovimientos', () => {
    function buildSvc(movimientos: unknown[]) {
      const movimientoCajaRepo = {
        find: jest.fn().mockResolvedValue(movimientos),
      };
      return Test.createTestingModule({
        providers: [
          CajaService,
          { provide: getRepositoryToken(Caja), useValue: cajaRepo },
          {
            provide: getRepositoryToken(MovimientoCaja),
            useValue: movimientoCajaRepo,
          },
          { provide: getDataSourceToken(), useValue: dataSource },
        ],
      })
        .compile()
        .then((m) => ({
          svc: m.get<CajaService>(CajaService),
          movimientoCajaRepo,
        }));
    }

    it('el dueño lista los movimientos de su caja (orden fecha ASC)', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);
      const movimientos = [
        { id: 'mov-001', cajaId: CAJA_ID, tipo: 'entrada', monto: '200' },
        { id: 'mov-002', cajaId: CAJA_ID, tipo: 'salida', monto: '100' },
      ];
      const { svc, movimientoCajaRepo } = await buildSvc(movimientos);

      const result = await svc.listarMovimientos(TENANT_ID, USUARIO_ID, CAJA_ID);

      expect(cajaRepo.findOne).toHaveBeenCalledWith({
        where: { id: CAJA_ID, tenantId: TENANT_ID, eliminadoEl: IsNull() },
      });
      expect(movimientoCajaRepo.find).toHaveBeenCalledWith({
        where: { cajaId: CAJA_ID, eliminadoEl: IsNull() },
        order: { fecha: 'ASC' },
      });
      expect(result).toEqual(movimientos);
    });

    it('con tieneVerTodas=true permite leer movimientos de una caja ajena', async () => {
      cajaRepo.findOne.mockResolvedValue({
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      });
      const { svc } = await buildSvc([]);

      await expect(
        svc.listarMovimientos(TENANT_ID, USUARIO_ID, CAJA_ID, true),
      ).resolves.toEqual([]);
    });

    it('sobre caja ajena sin tieneVerTodas lanza ForbiddenException', async () => {
      cajaRepo.findOne.mockResolvedValue({
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      });
      const { svc } = await buildSvc([]);

      await expect(
        svc.listarMovimientos(TENANT_ID, USUARIO_ID, CAJA_ID, false),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si la caja no existe', async () => {
      cajaRepo.findOne.mockResolvedValue(null);
      const { svc } = await buildSvc([]);

      await expect(
        svc.listarMovimientos(TENANT_ID, USUARIO_ID, CAJA_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `cd backend && npx jest caja.service.spec -t "listarMovimientos"`
Expected: FAIL — el código actual filtra por `usuarioId`/`estado` y lanza `ForbiddenException` (no `NotFoundException`) cuando no encuentra la caja.

- [ ] **Step 3: Implementar el cambio en el service**

Reemplazar el método `listarMovimientos` (líneas ~231-254 de `caja.service.ts`) por:

```ts
  async listarMovimientos(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas = false,
  ): Promise<MovimientoCaja[]> {
    const caja = await this.cajaRepo.findOne({
      where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    if (caja.usuarioId !== usuarioId && !tieneVerTodas) {
      throw new ForbiddenException('No tienes acceso a esta caja');
    }

    return this.movimientoCajaRepo.find({
      where: { cajaId, eliminadoEl: IsNull() },
      order: { fecha: 'ASC' },
    });
  }
```

(`NotFoundException` y `ForbiddenException` ya están importados al inicio del archivo.)

- [ ] **Step 4: Actualizar el controller para resolver `tieneVerTodas`**

Reemplazar el handler `listarMovimientos` (líneas ~100-105 de `caja.controller.ts`) por:

```ts
  @Get(':id/movimientos')
  @RequiresPermiso('Caja', 'Leer')
  async listarMovimientos(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const tieneVerTodas = await this.rbacService.userHasPermiso(
      u.id,
      u.tenantId!,
      'Caja',
      'Ver todas',
    );
    return this.cajaService.listarMovimientos(
      u.tenantId!,
      u.id,
      cajaId,
      tieneVerTodas,
    );
  }
```

- [ ] **Step 5: Correr los tests para verlos pasar**

Run: `cd backend && npx jest caja.service.spec`
Expected: PASS (toda la suite de `CajaService`).

- [ ] **Step 6: Lint**

Run: `cd backend && npm run lint`
Expected: sin errores en `caja.service.ts` / `caja.controller.ts`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.controller.ts backend/src/modules/caja/caja.service.spec.ts
git commit -m "feat(caja): permitir lectura de movimientos de caja ajena con Ver todas (read-only)"
```

---

### Task 2: Backend — endpoint `GET /caja/abiertas`

Devuelve las cajas físicas abiertas del tenant (todas si `Ver todas`, solo la propia si no), enriquecidas con nombre del dueño y saldo esperado calculado.

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (nuevo método `abiertas` + interface `CajaAbierta`)
- Modify: `backend/src/modules/caja/caja.controller.ts` (nueva ruta `@Get('abiertas')`, **antes** de `@Get(':id')`)
- Test: `backend/src/modules/caja/caja.service.spec.ts` (nuevo `describe('abiertas')` + agregar `query` al mock de `dataSource`)

**Interfaces:**
- Consumes: `dataSource.query`, `Decimal` (ya importado en el service).
- Produces:
  ```ts
  interface CajaAbierta {
    id: string
    usuarioId: string | null
    usuarioNombre: string
    saldoInicial: string
    saldoEsperado: string
    fechaApertura: Date
    esPropia: boolean
  }
  CajaService.abiertas(tenantId: string, usuarioId: string, tieneVerTodas: boolean): Promise<CajaAbierta[]>
  ```

- [ ] **Step 1: Agregar `query` al mock de `dataSource` en el spec**

En `caja.service.spec.ts`, en la declaración del tipo de `dataSource` (~línea 47-49), cambiar:

```ts
  let dataSource: {
    transaction: jest.Mock;
  };
```

por:

```ts
  let dataSource: {
    transaction: jest.Mock;
    query: jest.Mock;
  };
```

Y en `beforeEach` (~línea 67), cambiar:

```ts
    dataSource = {
      transaction: jest.fn(),
    };
```

por:

```ts
    dataSource = {
      transaction: jest.fn(),
      query: jest.fn(),
    };
```

- [ ] **Step 2: Escribir el test de `abiertas`**

Agregar este `describe` al final del archivo, justo antes del `});` que cierra `describe('CajaService', ...)`:

```ts
  describe('abiertas', () => {
    it('mapea filas a CajaAbierta con nombre completo y saldo esperado', async () => {
      dataSource.query.mockResolvedValue([
        {
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

      const result = await service.abiertas(TENANT_ID, USUARIO_ID, true);

      expect(result).toEqual([
        {
          id: CAJA_ID,
          usuarioId: USUARIO_ID,
          usuarioNombre: 'Ana Pérez',
          saldoInicial: '1000.0000',
          saldoEsperado: '1150.0000',
          fechaApertura: new Date('2026-06-29T10:00:00Z'),
          esPropia: true,
        },
      ]);
    });

    it('trata entradas/salidas nulas como 0 y marca esPropia=false para otro usuario', async () => {
      dataSource.query.mockResolvedValue([
        {
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

      const result = await service.abiertas(TENANT_ID, USUARIO_ID, true);

      expect(result[0]).toMatchObject({
        usuarioNombre: 'Beto',
        saldoEsperado: '500.0000',
        esPropia: false,
      });
    });

    it('pasa tenantId, el flag tieneVerTodas y usuarioId como parámetros de la query', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.abiertas(TENANT_ID, USUARIO_ID, false);

      const params = dataSource.query.mock.calls[0][1];
      expect(params).toEqual([TENANT_ID, false, USUARIO_ID]);
    });
  });
```

- [ ] **Step 3: Correr el test para verlo fallar**

Run: `cd backend && npx jest caja.service.spec -t "abiertas"`
Expected: FAIL — `service.abiertas is not a function`.

- [ ] **Step 4: Implementar `abiertas` + interface en el service**

En `caja.service.ts`, agregar la interface justo después de los `import` (antes de `@Injectable()`):

```ts
export interface CajaAbierta {
  id: string;
  usuarioId: string | null;
  usuarioNombre: string;
  saldoInicial: string;
  saldoEsperado: string;
  fechaApertura: Date;
  esPropia: boolean;
}
```

Y agregar este método dentro de la clase `CajaService` (p. ej. después de `historial`):

```ts
  async abiertas(
    tenantId: string,
    usuarioId: string,
    tieneVerTodas: boolean,
  ): Promise<CajaAbierta[]> {
    const rows: {
      caja_id: string;
      usuario_id: string | null;
      usuario_nombre: string | null;
      usuario_apellido: string | null;
      saldo_inicial: string;
      fecha_apertura: Date;
      total_entradas: string | null;
      total_salidas: string | null;
    }[] = await this.dataSource.query(
      `SELECT c.caja_id,
              c.usuario_id,
              u.nombre   AS usuario_nombre,
              u.apellido AS usuario_apellido,
              c.saldo_inicial,
              c.fecha_apertura,
              SUM(m.monto) FILTER (WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL) AS total_entradas,
              SUM(m.monto) FILTER (WHERE m.tipo = 'salida'  AND m.eliminado_el IS NULL) AS total_salidas
       FROM cajas c
       LEFT JOIN usuarios u ON u.usuario_id = c.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       WHERE c.tenant_id = $1
         AND c.tipo = 'fisica'
         AND c.estado = 'abierta'
         AND c.eliminado_el IS NULL
         AND ($2::boolean OR c.usuario_id = $3)
       GROUP BY c.caja_id, u.nombre, u.apellido
       ORDER BY c.fecha_apertura DESC`,
      [tenantId, tieneVerTodas, usuarioId],
    );

    return rows.map((r) => {
      const saldoEsperado = new Decimal(r.saldo_inicial)
        .plus(r.total_entradas ?? '0')
        .minus(r.total_salidas ?? '0')
        .toFixed(4);
      const nombre = [r.usuario_nombre, r.usuario_apellido]
        .filter((p): p is string => Boolean(p))
        .join(' ')
        .trim();
      return {
        id: r.caja_id,
        usuarioId: r.usuario_id,
        usuarioNombre: nombre || 'Sin usuario',
        saldoInicial: new Decimal(r.saldo_inicial).toFixed(4),
        saldoEsperado,
        fechaApertura: r.fecha_apertura,
        esPropia: r.usuario_id === usuarioId,
      };
    });
  }
```

- [ ] **Step 5: Agregar la ruta en el controller (antes de `@Get(':id')`)**

En `caja.controller.ts`, insertar este handler **inmediatamente después** del handler `activa` (línea ~56) y **antes** de `@Get(':id')`, para que `abiertas` no sea capturado por el parámetro `:id`:

```ts
  @Get('abiertas')
  @RequiresPermiso('Caja', 'Leer')
  async abiertas(@Req() req: Request) {
    const u = req.user as JwtUser;
    const tieneVerTodas = await this.rbacService.userHasPermiso(
      u.id,
      u.tenantId!,
      'Caja',
      'Ver todas',
    );
    return this.cajaService.abiertas(u.tenantId!, u.id, tieneVerTodas);
  }
```

- [ ] **Step 6: Correr los tests para verlos pasar**

Run: `cd backend && npx jest caja.service.spec`
Expected: PASS (toda la suite).

- [ ] **Step 7: Lint**

Run: `cd backend && npm run lint`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.controller.ts backend/src/modules/caja/caja.service.spec.ts
git commit -m "feat(caja): endpoint GET /caja/abiertas con dueño y saldo esperado"
```

---

### Task 3: Frontend — fix del gate del sidebar

El link "Caja" del sidebar usa el string de permiso equivocado (`'VerTodas'`) y solo lo ve admin. Pasa a mostrarse para cualquiera con `Caja:Leer`.

**Files:**
- Modify: `frontend/app/layouts/dashboard.vue:21`

**Interfaces:**
- Consumes: `permissionsStore.can('Caja', 'Leer')`, `permissionsStore.esAdmin`.

- [ ] **Step 1: Cambiar la condición del link Caja**

En `frontend/app/layouts/dashboard.vue`, reemplazar la línea 21:

```ts
  if (permissionsStore.esAdmin || permissionsStore.can('Caja', 'VerTodas')) {
```

por:

```ts
  if (permissionsStore.esAdmin || permissionsStore.can('Caja', 'Leer')) {
```

- [ ] **Step 2: Typecheck del frontend**

Run: `cd frontend && npx vue-tsc --noEmit` (si el comando no existe en el proyecto, usar `npm run build` como verificación)
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/layouts/dashboard.vue
git commit -m "fix(caja-front): mostrar link Caja a cualquier usuario con Caja:Leer"
```

---

### Task 4: Frontend — store: `cargarAbiertas` y `cargarDetalle`

Agrega al store de caja el estado y las acciones para el grid de cajas abiertas y el detalle read-only.

**Files:**
- Modify: `frontend/app/stores/caja.ts`
- Test: `frontend/app/stores/caja.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  interface CajaAbierta {
    id: string
    usuarioId: string | null
    usuarioNombre: string
    saldoInicial: string
    saldoEsperado: string
    fechaApertura: string
    esPropia: boolean
  }
  // en el store:
  abiertas: Ref<CajaAbierta[]>
  detalle: Ref<Caja | null>
  cargarAbiertas(): Promise<void>
  cargarDetalle(cajaId: string): Promise<void>
  ```

- [ ] **Step 1: Escribir los tests del store**

En `frontend/app/stores/caja.spec.ts`, agregar este bloque al final del archivo:

```ts
describe('useCajaStore — cargarAbiertas / cargarDetalle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiFetch.mockReset()
  })

  it('cargarAbiertas popula abiertas con la lista del API', async () => {
    const store = useCajaStore()
    const lista = [{
      id: 'c1',
      usuarioId: 'u1',
      usuarioNombre: 'Ana Pérez',
      saldoInicial: '1000.0000',
      saldoEsperado: '1150.0000',
      fechaApertura: '2026-06-29T10:00:00Z',
      esPropia: true,
    }]
    mockApiFetch.mockResolvedValue(lista)

    await store.cargarAbiertas()

    expect(store.abiertas).toEqual(lista)
  })

  it('cargarDetalle popula detalle con la caja del API', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue(CAJA)

    await store.cargarDetalle('caja-1')

    expect(store.detalle).toEqual(CAJA)
  })

  it('cargarDetalle normaliza body vacío ("") a null', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue('')

    await store.cargarDetalle('caja-1')

    expect(store.detalle).toBeNull()
  })
})
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `cd frontend && npx vitest run app/stores/caja.spec.ts`
Expected: FAIL — `store.cargarAbiertas`/`store.cargarDetalle` no existen.

- [ ] **Step 3: Implementar el estado, las acciones y el tipo en el store**

En `frontend/app/stores/caja.ts`:

a) Agregar la interface exportada después de la interface `MovimientoCaja`:

```ts
export interface CajaAbierta {
  id: string
  usuarioId: string | null
  usuarioNombre: string
  saldoInicial: string
  saldoEsperado: string
  fechaApertura: string
  esPropia: boolean
}
```

b) Dentro del `defineStore`, junto a los otros `ref`, agregar:

```ts
  const abiertas = ref<CajaAbierta[]>([])
  const detalle = ref<Caja | null>(null)
```

c) Agregar las dos acciones (p. ej. después de `cargarHistorial`):

```ts
  async function cargarAbiertas(): Promise<void> {
    abiertas.value = await useApiFetch<CajaAbierta[]>(
      `${config.public.apiUrl}/caja/abiertas`,
    )
  }

  async function cargarDetalle(cajaId: string): Promise<void> {
    const data = await useApiFetch<Caja | null>(
      `${config.public.apiUrl}/caja/${cajaId}`,
    )
    detalle.value = data && typeof data === 'object' ? data : null
  }
```

d) Agregar `abiertas`, `detalle`, `cargarAbiertas`, `cargarDetalle` al objeto `return`.

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `cd frontend && npx vitest run app/stores/caja.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/stores/caja.ts frontend/app/stores/caja.spec.ts
git commit -m "feat(caja-front): store cargarAbiertas y cargarDetalle"
```

---

### Task 5: Frontend — componente `CajasAbiertasGrid`

Grid de cards de cajas abiertas. Card ajena navega a `/caja/[id]`; card propia emite `operar-propia` para que el padre cambie a la pestaña "Mi caja".

**Files:**
- Create: `frontend/app/components/caja/CajasAbiertasGrid.vue`

**Interfaces:**
- Consumes: `useCajaStore().cargarAbiertas()`, `useCajaStore().abiertas` (`CajaAbierta[]`).
- Produces: emite `(e: 'operar-propia')`.

- [ ] **Step 1: Crear el componente**

Crear `frontend/app/components/caja/CajasAbiertasGrid.vue`:

```vue
<script setup lang="ts">
import Decimal from 'decimal.js'

const emit = defineEmits<{ (e: 'operar-propia'): void }>()

const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    await cajaStore.cargarAbiertas()
  }
  catch {
    toast.add({ title: 'Error al cargar las cajas abiertas', color: 'error' })
  }
  finally {
    loading.value = false
  }
})

function formatMonto(value: string): string {
  return new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(new Decimal(value).toNumber())
}

function formatFecha(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
}

function abrir(caja: { id: string, esPropia: boolean }): void {
  if (caja.esPropia) {
    emit('operar-propia')
    return
  }
  navigateTo(`/caja/${caja.id}`)
}
</script>

<template>
  <div>
    <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando cajas…
    </div>

    <div
      v-else-if="!cajaStore.abiertas.length"
      class="py-12 text-center text-sm text-gray-500"
    >
      No hay cajas abiertas en este momento.
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard
        v-for="caja in cajaStore.abiertas"
        :key="caja.id"
        class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
        @click="abrir(caja)"
      >
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold truncate">{{ caja.usuarioNombre }}</span>
            <UBadge v-if="caja.esPropia" color="primary" variant="subtle" size="xs">
              Mía
            </UBadge>
          </div>
        </template>

        <dl class="space-y-1 text-sm">
          <div class="flex justify-between">
            <dt class="text-gray-500">
              Saldo inicial
            </dt>
            <dd>{{ formatMonto(caja.saldoInicial) }}</dd>
          </div>
          <div class="flex justify-between font-medium">
            <dt class="text-gray-500">
              Saldo esperado
            </dt>
            <dd>{{ formatMonto(caja.saldoEsperado) }}</dd>
          </div>
          <div class="flex justify-between text-xs text-gray-400 pt-1">
            <dt>Apertura</dt>
            <dd>{{ formatFecha(caja.fechaApertura) }}</dd>
          </div>
        </dl>
      </UCard>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Typecheck / build del frontend**

Run: `cd frontend && npm run build`
Expected: build sin errores (el componente compila; aún no se usa).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/caja/CajasAbiertasGrid.vue
git commit -m "feat(caja-front): componente CajasAbiertasGrid (cards de cajas abiertas)"
```

---

### Task 6: Frontend — pestañas + gate relajado en `pages/caja/index.vue`

Relaja el gate de acceso a `Caja:Leer` y agrega las pestañas "Mi caja" / "Todas las cajas" (la segunda solo para `Ver todas`).

**Files:**
- Modify: `frontend/app/pages/caja/index.vue`

**Interfaces:**
- Consumes: `usePermissionsStore()`, `useCajaStore()`, `<CajasAbiertasGrid @operar-propia>`.

- [ ] **Step 1: Reescribir la página**

Reemplazar **todo** el contenido de `frontend/app/pages/caja/index.vue` por:

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const cajaStore = useCajaStore()
const perms = usePermissionsStore()
const toast = useToast()
const loading = ref(false)
const tab = ref<'mi-caja' | 'todas'>('mi-caja')

const puedeVerTodas = computed(
  () => perms.esAdmin || perms.can('Caja', 'Ver todas'),
)

const tabItems = [
  { label: 'Mi caja', slot: 'mi-caja' as const },
  { label: 'Todas las cajas', slot: 'todas' as const },
]

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('Caja', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Caja', color: 'warning' })
    await navigateTo('/ventas')
    return
  }
  loading.value = true
  try {
    await cajaStore.cargarActiva()
  }
  catch {
    toast.add({ title: 'Error al cargar caja', color: 'error' })
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6 py-6">
    <div>
      <h1 class="text-2xl font-bold">
        Caja
      </h1>
      <p class="text-sm text-gray-500 mt-1">
        Gestión de caja física del turno actual.
      </p>
    </div>

    <UTabs
      v-if="puedeVerTodas"
      v-model="tab"
      :items="tabItems"
      :unmount-on-hide="false"
    >
      <template #mi-caja>
        <div class="space-y-6 pt-4">
          <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
            <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
            Cargando…
          </div>
          <CajaAperturaForm v-else-if="!cajaStore.activa" />
          <CajaActivaDashboard v-else :caja="cajaStore.activa" />
          <UDivider class="my-2" />
          <CajaHistorial />
        </div>
      </template>

      <template #todas>
        <div class="pt-4">
          <CajasAbiertasGrid @operar-propia="tab = 'mi-caja'" />
        </div>
      </template>
    </UTabs>

    <div v-else class="space-y-6">
      <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
        <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
        Cargando…
      </div>
      <CajaAperturaForm v-else-if="!cajaStore.activa" />
      <CajaActivaDashboard v-else :caja="cajaStore.activa" />
      <UDivider class="my-2" />
      <CajaHistorial />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Build del frontend**

Run: `cd frontend && npm run build`
Expected: build sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/pages/caja/index.vue
git commit -m "feat(caja-front): gate Caja:Leer + pestañas Mi caja / Todas las cajas"
```

---

### Task 7: Frontend — página de detalle read-only `pages/caja/[id].vue`

Vista read-only de una caja: header con dueño/estado/saldos y tabla de movimientos. Sin botones de operar. Maneja 403/404 redirigiendo a `/caja`.

**Files:**
- Create: `frontend/app/pages/caja/[id].vue`

**Interfaces:**
- Consumes: `useCajaStore().cargarDetalle(id)`, `useCajaStore().detalle` (`Caja | null`), `useCajaStore().cargarMovimientos(id)`, `useCajaStore().movimientos` (`MovimientoCaja[]`).

- [ ] **Step 1: Crear la página**

Crear `frontend/app/pages/caja/[id].vue`:

```vue
<script setup lang="ts">
import Decimal from 'decimal.js'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(false)

const cajaId = computed(() => route.params.id as string)

const totalEntradas = computed(() =>
  cajaStore.movimientos
    .filter(m => m.tipo === 'entrada')
    .reduce((acc, m) => acc.plus(m.monto), new Decimal(0)),
)
const totalSalidas = computed(() =>
  cajaStore.movimientos
    .filter(m => m.tipo === 'salida')
    .reduce((acc, m) => acc.plus(m.monto), new Decimal(0)),
)
const saldoEsperado = computed(() => {
  if (!cajaStore.detalle) return new Decimal(0)
  return new Decimal(cajaStore.detalle.saldoInicial)
    .plus(totalEntradas.value)
    .minus(totalSalidas.value)
})

function formatMonto(value: string | Decimal): string {
  const d = typeof value === 'string' ? new Decimal(value) : value
  return new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(d.toNumber())
}

function formatFecha(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
}

onMounted(async () => {
  loading.value = true
  try {
    await cajaStore.cargarDetalle(cajaId.value)
    if (!cajaStore.detalle) {
      throw new Error('not-found')
    }
    await cajaStore.cargarMovimientos(cajaId.value)
  }
  catch {
    toast.add({ title: 'No tenés acceso a esta caja o no existe', color: 'warning' })
    await navigateTo('/caja')
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 py-6">
    <ULink to="/caja" class="text-sm text-primary-600 inline-flex items-center gap-1">
      <UIcon name="i-heroicons-arrow-left" class="w-4 h-4" />
      Volver a Caja
    </ULink>

    <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando…
    </div>

    <template v-else-if="cajaStore.detalle">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div>
              <h1 class="text-lg font-bold">
                Caja (solo lectura)
              </h1>
              <p class="text-xs text-gray-500 mt-1">
                Apertura: {{ formatFecha(cajaStore.detalle.fechaApertura) }}
              </p>
            </div>
            <UBadge
              :color="cajaStore.detalle.estado === 'abierta' ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ cajaStore.detalle.estado }}
            </UBadge>
          </div>
        </template>

        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt class="text-gray-500">
              Saldo inicial
            </dt>
            <dd class="font-medium">
              {{ formatMonto(cajaStore.detalle.saldoInicial) }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">
              Saldo esperado
            </dt>
            <dd class="font-medium">
              {{ formatMonto(saldoEsperado) }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">
              Entradas
            </dt>
            <dd class="text-green-600">
              + {{ formatMonto(totalEntradas) }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">
              Salidas
            </dt>
            <dd class="text-red-600">
              - {{ formatMonto(totalSalidas) }}
            </dd>
          </div>
        </dl>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Movimientos
          </h2>
        </template>

        <p
          v-if="!cajaStore.movimientos.length"
          class="py-6 text-center text-sm text-gray-500"
        >
          Sin movimientos registrados en este turno.
        </p>

        <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
          <li
            v-for="mov in cajaStore.movimientos"
            :key="mov.id"
            class="flex items-center justify-between py-2 text-sm"
          >
            <div>
              <p class="font-medium">
                {{ mov.concepto }}
              </p>
              <p class="text-xs text-gray-400">
                {{ formatFecha(mov.fecha) }}
              </p>
            </div>
            <span :class="mov.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'">
              {{ mov.tipo === 'entrada' ? '+' : '-' }} {{ formatMonto(mov.monto) }}
            </span>
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Build del frontend**

Run: `cd frontend && npm run build`
Expected: build sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/pages/caja/\[id\].vue
git commit -m "feat(caja-front): página de detalle read-only /caja/[id]"
```

---

### Task 8: Documentación viva

Actualiza la doc de la feature y el seguimiento de funcionalidades para reflejar el acceso por permiso y la vista read-only.

**Files:**
- Modify: `docs/features/gestion-cajas.md`
- Modify: `docs/MIGRACION-FUNCIONALIDADES.md` (sección "Gestión de cajas", ~línea 372)

**Interfaces:** N/A (documentación).

- [ ] **Step 1: Actualizar `docs/features/gestion-cajas.md`**

Agregar una subsección que documente:
- Acceso al módulo: `Caja:Leer` opera la caja propia; `Caja:Ver todas` ve el grid de todas las cajas abiertas y entra a cualquiera en read-only.
- Endpoint nuevo `GET /caja/abiertas` (devuelve `{ id, usuarioId, usuarioNombre, saldoInicial, saldoEsperado, fechaApertura, esPropia }`; todas si `Ver todas`, solo la propia si no).
- `GET /caja/:id/movimientos` ahora permite lectura de caja ajena con `Ver todas`; `registrarMovimiento` y `cerrar` siguen owner-only.
- Frontend: pestañas "Mi caja" / "Todas las cajas" en `/caja` y página read-only `/caja/[id]`.

- [ ] **Step 2: Actualizar `docs/MIGRACION-FUNCIONALIDADES.md`**

En la sección "12. Gestión de cajas" (~línea 372), agregar una nota: visibilidad por permiso (`Leer` = caja propia, `Ver todas` = grid de cajas abiertas + detalle read-only), con fecha 2026-06-29.

- [ ] **Step 3: Commit**

```bash
git add docs/features/gestion-cajas.md docs/MIGRACION-FUNCIONALIDADES.md
git commit -m "docs(caja): visibilidad por permiso y vista read-only de cajas abiertas"
```

---

## Verification (suite completa al final)

- [ ] Backend tests: `cd backend && npx jest caja` → PASS.
- [ ] Backend lint: `cd backend && npm run lint` → sin errores.
- [ ] Frontend store tests: `cd frontend && npx vitest run app/stores/caja.spec.ts` → PASS.
- [ ] Frontend build: `cd frontend && npm run build` → sin errores.
- [ ] Smoke manual (con `docker-compose up`):
  - Vendedor (`Caja:Leer`, sin `Ver todas`): ve el link Caja, entra, no ve pestaña "Todas las cajas", abre/opera su caja.
  - Supervisor/admin (`Ver todas`): ve ambas pestañas; en "Todas las cajas" aparecen las cards (la propia con badge "Mía"); click en ajena → `/caja/[id]` read-only sin botones de operar; click en la propia → vuelve a "Mi caja".
```
