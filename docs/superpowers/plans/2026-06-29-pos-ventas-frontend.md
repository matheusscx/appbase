# POS Ventas (crear venta) — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la pantalla de Punto de Venta (crear venta canal `fisico`) en Nuxt, con catálogo (buscador + grilla), carrito (solo cantidad, reglas automáticas del motor), múltiples pagos con vuelto, y fricción por tipo de documento (Boleta sin datos de cliente, Factura con cliente obligatorio).

**Architecture:** El backend de ventas ya existe (`POST /api/ventas`, motor `POST /calculo-precios/calcular`). Se agrega una columna `requiere_customer` a `tipos_documento_tributario` y un endpoint `GET /tipos-documento`. En el frontend, una página `ventas/index.vue` orquesta cuatro componentes (`CatalogoGrid`, `CarritoPanel`, `ClienteForm`, `CobroModal`) y un composable `useVenta` cuya lógica pura (carrito + pagos + gate) se testea con Vitest. El recálculo de precios va al backend con debounce.

**Tech Stack:** NestJS + TypeORM (backend), Nuxt 4 + Vue 3 + `@nuxt/ui` v4 + Pinia + decimal.js (frontend), Vitest (tests de frontend), Jest (e2e backend).

## Global Constraints

- **Dinero/cantidades = string de punta a punta.** `UInput` con `inputmode="decimal"`, nunca `type="number"` (rompe `@IsNumberString` → 400). Aritmética con `decimal.js`. (Ver `docs/patterns/frontend.md` §7.)
- **Llamadas API: `useApiFetch`** (`~/composables/useApiFetch`), nunca `$fetch` directo ni axios. URL base: `useRuntimeConfig().public.apiUrl`.
- **`tenant_id` y `usuario_id` siempre del token**, nunca del body.
- **Columnas UUID en entities TypeORM**: PK/FK declaran `type: 'uuid'` (ADR-004). (No aplica a la columna boolean de este plan, pero respétalo si tocas otras.)
- **Soft delete**: toda lectura filtra `eliminado_el IS NULL`.
- **Etapa de desarrollo**: trabajar directo sobre `main`, sin ramas ni PRs. Commits frecuentes.
- Errores de negocio del backend se muestran al usuario vía `e.data.message` en un `useToast`.

---

## File Structure

**Backend**
- Modify: `backend/src/modules/ventas/entities/tipo-documento-tributario.entity.ts` — agregar `requiereCustomer`.
- Modify: `startup-pos.sql` — agregar columna `requiere_customer`.
- Modify: `backend/src/modules/seeder/seeder.service.ts` — sembrar el flag.
- Modify: `backend/src/modules/ventas/ventas.service.ts` — método `findTiposDocumento`.
- Modify: `backend/src/modules/ventas/ventas.controller.ts` — ruta `GET /tipos-documento`.
- Modify: `backend/test/ventas.e2e-spec.ts` — test del nuevo endpoint.

**Frontend**
- Create: `frontend/app/composables/useVenta.ts` — tipos + helpers puros (carrito, pagos, gate) + estado del carrito.
- Create: `frontend/app/composables/useVenta.spec.ts` — tests Vitest de los helpers puros.
- Create: `frontend/app/components/ventas/CatalogoGrid.vue` — buscador + grilla, emite `add`.
- Create: `frontend/app/components/ventas/ClienteForm.vue` — datos de cliente (condicional).
- Create: `frontend/app/components/ventas/CarritoPanel.vue` — líneas, documento, desglose, botón Cobrar.
- Create: `frontend/app/components/ventas/CobroModal.vue` — pagos múltiples, vuelto, confirma POST.
- Create: `frontend/app/pages/ventas/index.vue` — orquestación + gate de caja.
- Modify: `frontend/app/layouts/dashboard.vue` — ítem de nav "Punto de venta".

**Docs**
- Modify: `docs/features/ventas.md`, `docs/README.md`, `CLAUDE.md`, `docs/MIGRACION-FUNCIONALIDADES.md`, `docs/patterns/frontend.md`.

---

## Task 1: Backend — flag `requiere_customer` en tipos de documento

**Files:**
- Modify: `backend/src/modules/ventas/entities/tipo-documento-tributario.entity.ts`
- Modify: `startup-pos.sql:91-101`
- Modify: `backend/src/modules/seeder/seeder.service.ts:1438-1455`

**Interfaces:**
- Produces: columna `requiere_customer BOOLEAN NOT NULL DEFAULT false` y propiedad `requiereCustomer: boolean` en `TipoDocumentoTributario`. Boleta=false, Factura=true en el seed.

- [ ] **Step 1: Agregar la propiedad a la entity**

En `tipo-documento-tributario.entity.ts`, después de la columna `activo` (línea 27-28), agregar:

```typescript
  @Column({ name: 'requiere_customer', default: false })
  requiereCustomer: boolean;
```

- [ ] **Step 2: Agregar la columna al esquema SQL**

En `startup-pos.sql`, dentro de `CREATE TABLE "tipos_documento_tributario"`, agregar la columna después de `"activo"` (línea 97):

```sql
  "activo"            BOOLEAN     NOT NULL DEFAULT true,
  "requiere_customer" BOOLEAN     NOT NULL DEFAULT false,
```

- [ ] **Step 3: Sembrar el flag**

En `seeder.service.ts`, método `seedTiposDocumentoTributario` (línea 1438), agregar `requiereCustomer` a cada tipo:

```typescript
    const tipos: Partial<TipoDocumentoTributario>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440145',
        paisId: CHILE,
        nombre: 'Boleta de Venta',
        codigo: '39',
        descripcion: 'Boleta electrónica de venta al consumidor final',
        activo: true,
        requiereCustomer: false,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440146',
        paisId: CHILE,
        nombre: 'Factura Electrónica',
        codigo: '33',
        descripcion: 'Factura electrónica afecta a IVA',
        activo: true,
        requiereCustomer: true,
      },
    ];
```

> Nota: el seeder hace `findOne` por `id` y solo inserta si no existe. Para que el flag se aplique en un entorno ya sembrado, recrear el volumen: `docker-compose down -v && docker-compose up --build`. En dev esto es aceptable (decisión del spec).

- [ ] **Step 4: Verificar que el backend compila y arranca**

Run: `cd backend && npm run build`
Expected: build sin errores TypeScript.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ventas/entities/tipo-documento-tributario.entity.ts startup-pos.sql backend/src/modules/seeder/seeder.service.ts
git commit -m "feat(ventas): flag requiere_customer en tipos_documento_tributario

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — endpoint `GET /tipos-documento`

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts`
- Modify: `backend/src/modules/ventas/ventas.controller.ts`
- Test: `backend/test/ventas.e2e-spec.ts`

**Interfaces:**
- Consumes: columna `requiere_customer` (Task 1), patrón de join país `tenants → provincia → pais` (de `metodos-pago.service.ts`).
- Produces: `VentasService.findTiposDocumento(tenantId): Promise<TipoDocumentoResponse[]>` donde `TipoDocumentoResponse = { id: string; nombre: string; codigo: string | null; requiereCustomer: boolean }`. Ruta `GET /api/tipos-documento`.

- [ ] **Step 1: Escribir el test e2e (RED)**

En `backend/test/ventas.e2e-spec.ts`, agregar al final del `describe('Ventas (e2e)')`, antes del cierre, un nuevo bloque:

```typescript
  describe('GET /tipos-documento', () => {
    interface TipoDocResponse {
      id: string;
      nombre: string;
      codigo: string | null;
      requiereCustomer: boolean;
    }

    it('lista los tipos de documento del país del tenant con el flag requiereCustomer', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tipos-documento')
        .set('Authorization', `Bearer ${token}`);

      const tipos = res.body as TipoDocResponse[];
      expect(res.status).toBe(200);
      expect(Array.isArray(tipos)).toBe(true);
      expect(tipos.length).toBeGreaterThan(0);

      const boleta = tipos.find((t) => t.codigo === '39');
      const factura = tipos.find((t) => t.codigo === '33');
      expect(boleta?.requiereCustomer).toBe(false);
      expect(factura?.requiereCustomer).toBe(true);
    });

    it('retorna 401 sin token', async () => {
      const res = await request(app.getHttpServer()).get('/api/tipos-documento');
      expect(res.status).toBe(401);
    });
  });
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npm run test:e2e -- --testPathPatterns=ventas --forceExit`
Expected: FAIL — el caso nuevo retorna 404 (ruta inexistente) en vez de 200.

- [ ] **Step 3: Agregar el método al service**

En `ventas.service.ts`, agregar la interfaz exportada cerca del tope (junto a otras interfaces del archivo) y el método dentro de la clase `VentasService`:

```typescript
export interface TipoDocumentoResponse {
  id: string;
  nombre: string;
  codigo: string | null;
  requiereCustomer: boolean;
}
```

```typescript
  async findTiposDocumento(
    tenantId: string,
  ): Promise<TipoDocumentoResponse[]> {
    const rows: {
      tipo_documento_id: string;
      nombre: string;
      codigo: string | null;
      requiere_customer: boolean;
    }[] = await this.dataSource.query(
      `SELECT td.tipo_documento_id,
              td.nombre,
              td.codigo,
              td.requiere_customer
       FROM tenants t
       JOIN provincia prov ON prov.provincia_id = t.provincia_id
            AND prov.eliminado_el IS NULL
       JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
       JOIN tipos_documento_tributario td ON td.pais_id = p.pais_id
            AND td.eliminado_el IS NULL AND td.activo = true
       WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
       ORDER BY td.nombre ASC`,
      [tenantId],
    );

    return rows.map((r) => ({
      id: r.tipo_documento_id,
      nombre: r.nombre,
      codigo: r.codigo,
      requiereCustomer: r.requiere_customer === true,
    }));
  }
```

> Verifica que `this.dataSource` ya esté inyectado en el constructor de `VentasService` (lo usa `findOne`/`listar`). Si no, reutiliza la misma inyección existente; no agregues una nueva.

- [ ] **Step 4: Agregar la ruta al controller**

En `ventas.controller.ts`, agregar un controller dedicado para la ruta raíz `tipos-documento` (no puede colgar de `@Controller('ventas')`). Al final del archivo, después de la clase `VentasController`, agregar:

```typescript
@ApiTags('ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('tipos-documento')
export class TiposDocumentoController {
  constructor(private readonly ventasService: VentasService) {}

  @Get()
  async listar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.ventasService.findTiposDocumento(u.tenantId ?? '');
  }
}
```

- [ ] **Step 5: Registrar el nuevo controller en el módulo**

En `ventas.module.ts`, importar y registrar `TiposDocumentoController`:

```typescript
import { VentasController, TiposDocumentoController } from './ventas.controller';
```

```typescript
  controllers: [VentasController, TiposDocumentoController],
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `cd backend && npm run test:e2e -- --testPathPatterns=ventas --forceExit`
Expected: PASS — todos los casos de ventas verdes, incluido el nuevo `GET /tipos-documento`.

- [ ] **Step 7: Lint**

Run: `cd backend && npm run lint`
Expected: sin errores nuevos en `ventas.service.ts` / `ventas.controller.ts`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.ts backend/src/modules/ventas/ventas.controller.ts backend/src/modules/ventas/ventas.module.ts backend/test/ventas.e2e-spec.ts
git commit -m "feat(ventas): endpoint GET /tipos-documento por país del tenant

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — helpers puros del carrito y pagos (TDD)

**Files:**
- Create: `frontend/app/composables/useVenta.ts`
- Test: `frontend/app/composables/useVenta.spec.ts`

**Interfaces:**
- Consumes: `ItemCatalogo` (forma del `GET /items`: `{ id, nombre, precioBase, monedaSimbolo, stock, tipo, ... }`), `MetodoPagoTenant` (`GET /metodos-pago`: `{ metodoPagoId, nombre, permiteVuelto, habilitada }`), `CalcularVentaInput` (de `useCalculoPrecios`).
- Produces (exportados para test y consumo):
  - `interface ItemCatalogo { id: string; nombre: string; descripcion: string | null; precioBase: string; monedaSimbolo: string | null; stock: string | null; tipo: string }`
  - `interface CarritoLinea { item: ItemCatalogo; cantidad: string }`
  - `interface PagoInput { metodoPagoId: string; monto: string; referencia?: string }`
  - `agregarLinea(lineas: CarritoLinea[], item: ItemCatalogo): CarritoLinea[]`
  - `quitarLinea(lineas: CarritoLinea[], itemId: string): CarritoLinea[]`
  - `setCantidad(lineas: CarritoLinea[], itemId: string, cantidad: string): CarritoLinea[]`
  - `toCalcularInput(lineas: CarritoLinea[]): CalcularVentaInput`
  - `sumaPagos(pagos: PagoInput[]): string`
  - `resumenCobro(total: string, pagos: PagoInput[], metodos: { metodoPagoId: string; permiteVuelto: boolean }[]): { restante: string; vuelto: string; excedenteSinVuelto: boolean }`
  - `puedeCobrar(args: { tieneCaja: boolean; lineas: CarritoLinea[]; requiereCustomer: boolean; customerNombre: string }): boolean`

- [ ] **Step 1: Escribir los tests de los helpers (RED)**

Crear `frontend/app/composables/useVenta.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  agregarLinea,
  quitarLinea,
  setCantidad,
  toCalcularInput,
  sumaPagos,
  resumenCobro,
  puedeCobrar,
  type CarritoLinea,
  type ItemCatalogo,
} from './useVenta'

const item = (id: string, precio = '100'): ItemCatalogo => ({
  id,
  nombre: `Item ${id}`,
  descripcion: null,
  precioBase: precio,
  monedaSimbolo: '$',
  stock: '10',
  tipo: 'producto',
})

describe('carrito helpers', () => {
  it('agregarLinea agrega una línea nueva con cantidad "1"', () => {
    const r = agregarLinea([], item('a'))
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('1')
  })

  it('agregarLinea incrementa la cantidad si el item ya está', () => {
    const r = agregarLinea([{ item: item('a'), cantidad: '1' }], item('a'))
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('2')
  })

  it('agregarLinea no muta el array original', () => {
    const original: CarritoLinea[] = []
    agregarLinea(original, item('a'))
    expect(original).toHaveLength(0)
  })

  it('quitarLinea elimina por itemId', () => {
    const r = quitarLinea([{ item: item('a'), cantidad: '1' }], 'a')
    expect(r).toHaveLength(0)
  })

  it('setCantidad reemplaza la cantidad de la línea', () => {
    const r = setCantidad([{ item: item('a'), cantidad: '1' }], 'a', '5')
    expect(r[0]!.cantidad).toBe('5')
  })

  it('toCalcularInput mapea a { lineas: [{ itemId, cantidad }] }', () => {
    const r = toCalcularInput([{ item: item('a'), cantidad: '3' }])
    expect(r).toEqual({ lineas: [{ itemId: 'a', cantidad: '3' }] })
  })
})

describe('pagos helpers', () => {
  it('sumaPagos suma montos string con precisión', () => {
    expect(sumaPagos([{ metodoPagoId: 'm1', monto: '0.1' }, { metodoPagoId: 'm2', monto: '0.2' }])).toBe('0.3')
  })

  it('resumenCobro: restante positivo cuando pagos < total', () => {
    const r = resumenCobro('100', [{ metodoPagoId: 'm1', monto: '40' }], [{ metodoPagoId: 'm1', permiteVuelto: true }])
    expect(r.restante).toBe('60')
    expect(r.vuelto).toBe('0')
    expect(r.excedenteSinVuelto).toBe(false)
  })

  it('resumenCobro: vuelto cuando hay excedente y el método permite vuelto', () => {
    const r = resumenCobro('100', [{ metodoPagoId: 'm1', monto: '150' }], [{ metodoPagoId: 'm1', permiteVuelto: true }])
    expect(r.restante).toBe('0')
    expect(r.vuelto).toBe('50')
    expect(r.excedenteSinVuelto).toBe(false)
  })

  it('resumenCobro: excedenteSinVuelto cuando excede y ningún método permite vuelto', () => {
    const r = resumenCobro('100', [{ metodoPagoId: 'm1', monto: '150' }], [{ metodoPagoId: 'm1', permiteVuelto: false }])
    expect(r.vuelto).toBe('0')
    expect(r.excedenteSinVuelto).toBe(true)
  })
})

describe('puedeCobrar (gate)', () => {
  const lineas: CarritoLinea[] = [{ item: item('a'), cantidad: '1' }]

  it('false sin caja', () => {
    expect(puedeCobrar({ tieneCaja: false, lineas, requiereCustomer: false, customerNombre: '' })).toBe(false)
  })

  it('false con carrito vacío', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas: [], requiereCustomer: false, customerNombre: '' })).toBe(false)
  })

  it('false si requiereCustomer y falta nombre', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, requiereCustomer: true, customerNombre: '  ' })).toBe(false)
  })

  it('true con caja, líneas y (sin factura) sin cliente', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, requiereCustomer: false, customerNombre: '' })).toBe(true)
  })

  it('true con factura y nombre de cliente', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, requiereCustomer: true, customerNombre: 'Juan' })).toBe(true)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd frontend && npx vitest run app/composables/useVenta.spec.ts`
Expected: FAIL — `Cannot find module './useVenta'` / exports indefinidos.

- [ ] **Step 3: Implementar los helpers y tipos**

Crear `frontend/app/composables/useVenta.ts` con los helpers puros (el estado reactivo del composable se agrega en Task 4; primero los helpers para el GREEN):

```typescript
import Decimal from 'decimal.js'
import type { CalcularVentaInput } from './useCalculoPrecios'

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface ItemCatalogo {
  id: string
  nombre: string
  descripcion: string | null
  precioBase: string
  monedaSimbolo: string | null
  stock: string | null
  tipo: string
}

export interface CarritoLinea {
  item: ItemCatalogo
  cantidad: string
}

export interface PagoInput {
  metodoPagoId: string
  monto: string
  referencia?: string
}

// ── Helpers de carrito (puros, inmutables) ──────────────────────────────────

export function agregarLinea(
  lineas: CarritoLinea[],
  item: ItemCatalogo,
): CarritoLinea[] {
  const existente = lineas.find((l) => l.item.id === item.id)
  if (existente) {
    return lineas.map((l) =>
      l.item.id === item.id
        ? { ...l, cantidad: new Decimal(l.cantidad || '0').plus(1).toString() }
        : l,
    )
  }
  return [...lineas, { item, cantidad: '1' }]
}

export function quitarLinea(
  lineas: CarritoLinea[],
  itemId: string,
): CarritoLinea[] {
  return lineas.filter((l) => l.item.id !== itemId)
}

export function setCantidad(
  lineas: CarritoLinea[],
  itemId: string,
  cantidad: string,
): CarritoLinea[] {
  return lineas.map((l) =>
    l.item.id === itemId ? { ...l, cantidad } : l,
  )
}

export function toCalcularInput(lineas: CarritoLinea[]): CalcularVentaInput {
  return {
    lineas: lineas.map((l) => ({ itemId: l.item.id, cantidad: l.cantidad })),
  }
}

// ── Helpers de pagos (puros) ────────────────────────────────────────────────

export function sumaPagos(pagos: PagoInput[]): string {
  return pagos
    .reduce((acc, p) => acc.plus(new Decimal(p.monto || '0')), new Decimal(0))
    .toString()
}

export function resumenCobro(
  total: string,
  pagos: PagoInput[],
  metodos: { metodoPagoId: string; permiteVuelto: boolean }[],
): { restante: string; vuelto: string; excedenteSinVuelto: boolean } {
  const totalD = new Decimal(total || '0')
  const suma = new Decimal(sumaPagos(pagos))
  const excedente = suma.minus(totalD)

  if (excedente.lte(0)) {
    return {
      restante: totalD.minus(suma).toString(),
      vuelto: '0',
      excedenteSinVuelto: false,
    }
  }

  const algunPermiteVuelto = pagos.some((p) =>
    metodos.find((m) => m.metodoPagoId === p.metodoPagoId)?.permiteVuelto,
  )
  return {
    restante: '0',
    vuelto: algunPermiteVuelto ? excedente.toString() : '0',
    excedenteSinVuelto: !algunPermiteVuelto,
  }
}

// ── Gate ────────────────────────────────────────────────────────────────────

export function puedeCobrar(args: {
  tieneCaja: boolean
  lineas: CarritoLinea[]
  requiereCustomer: boolean
  customerNombre: string
}): boolean {
  if (!args.tieneCaja) return false
  if (args.lineas.length === 0) return false
  if (args.requiereCustomer && args.customerNombre.trim() === '') return false
  return true
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd frontend && npx vitest run app/composables/useVenta.spec.ts`
Expected: PASS — todos los casos verdes.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useVenta.ts frontend/app/composables/useVenta.spec.ts
git commit -m "feat(ventas-front): helpers puros de carrito, pagos y gate (TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — composable `useVenta` (estado + recálculo)

**Files:**
- Modify: `frontend/app/composables/useVenta.ts`

**Interfaces:**
- Consumes: helpers de Task 3, `useCalculoPrecios` (`calcular`), `ResultadoVenta`.
- Produces: `useVenta()` que retorna `{ lineas, resultado, loadingCalculo, add, quitar, cambiarCantidad, limpiar }` donde `lineas: Ref<CarritoLinea[]>`, `resultado: Ref<ResultadoVenta | null>`, `loadingCalculo: Ref<boolean>`.

- [ ] **Step 1: Agregar el composable con estado y recálculo debounced**

Al final de `frontend/app/composables/useVenta.ts`, agregar:

```typescript
import { ref, watch } from 'vue'
import { useCalculoPrecios, type ResultadoVenta } from './useCalculoPrecios'

export function useVenta() {
  const { calcular } = useCalculoPrecios()
  const lineas = ref<CarritoLinea[]>([])
  const resultado = ref<ResultadoVenta | null>(null)
  const loadingCalculo = ref(false)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function recalcular() {
    if (lineas.value.length === 0) {
      resultado.value = null
      return
    }
    loadingCalculo.value = true
    try {
      resultado.value = await calcular(toCalcularInput(lineas.value))
    } finally {
      loadingCalculo.value = false
    }
  }

  watch(
    lineas,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        void recalcular()
      }, 300)
    },
    { deep: true },
  )

  function add(item: ItemCatalogo) {
    lineas.value = agregarLinea(lineas.value, item)
  }
  function quitar(itemId: string) {
    lineas.value = quitarLinea(lineas.value, itemId)
  }
  function cambiarCantidad(itemId: string, cantidad: string) {
    lineas.value = setCantidad(lineas.value, itemId, cantidad)
  }
  function limpiar() {
    lineas.value = []
    resultado.value = null
  }

  return { lineas, resultado, loadingCalculo, add, quitar, cambiarCantidad, limpiar }
}
```

> Los imports de `ref`/`watch` de Vue y de `useCalculoPrecios` van arriba del archivo junto a los demás imports; consolidar para no duplicar la línea de import de Vue.

- [ ] **Step 2: Verificar que los tests de helpers siguen verdes**

Run: `cd frontend && npx vitest run app/composables/useVenta.spec.ts`
Expected: PASS — agregar el composable no rompe los helpers.

- [ ] **Step 3: Verificar typecheck/build del frontend**

Run: `cd frontend && npx nuxt typecheck` (si está configurado) o `npm run build`
Expected: sin errores de tipos en `useVenta.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useVenta.ts
git commit -m "feat(ventas-front): composable useVenta con recálculo debounced

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — componente `CatalogoGrid`

**Files:**
- Create: `frontend/app/components/ventas/CatalogoGrid.vue`

**Interfaces:**
- Consumes: `ItemCatalogo[]` vía prop `items`.
- Produces: emite `add` con el `ItemCatalogo` clickeado. Filtrado client-side por nombre.

- [ ] **Step 1: Crear el componente**

```vue
<script setup lang="ts">
import type { ItemCatalogo } from '~/composables/useVenta'

const props = defineProps<{ items: ItemCatalogo[]; loading?: boolean }>()
const emit = defineEmits<{ add: [item: ItemCatalogo] }>()

const busqueda = ref('')

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return props.items
  return props.items.filter((i) => i.nombre.toLowerCase().includes(q))
})
</script>

<template>
  <div class="flex flex-col gap-4 h-full">
    <UInput
      v-model="busqueda"
      icon="i-heroicons-magnifying-glass"
      placeholder="Buscar ítem..."
      size="lg"
    />

    <div v-if="loading" class="text-center text-muted py-10 text-sm">
      Cargando catálogo...
    </div>
    <div v-else-if="!filtrados.length" class="text-center text-muted py-10 text-sm">
      No hay ítems para mostrar.
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 overflow-y-auto">
      <UCard
        v-for="item in filtrados"
        :key="item.id"
        class="cursor-pointer hover:ring-2 hover:ring-primary-500 transition"
        @click="emit('add', item)"
      >
        <div class="flex flex-col gap-1">
          <span class="font-medium text-sm text-default truncate">{{ item.nombre }}</span>
          <span class="text-primary-600 font-semibold text-sm">
            {{ item.monedaSimbolo ?? '' }}{{ item.precioBase }}
          </span>
          <span v-if="item.tipo === 'producto'" class="text-xs text-muted">
            Stock: {{ item.stock ?? '0' }}
          </span>
        </div>
      </UCard>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verificar build**

Run: `cd frontend && npm run build`
Expected: build sin errores que mencionen `CatalogoGrid`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/ventas/CatalogoGrid.vue
git commit -m "feat(ventas-front): componente CatalogoGrid (buscador + grilla)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — componente `ClienteForm`

**Files:**
- Create: `frontend/app/components/ventas/ClienteForm.vue`

**Interfaces:**
- Produces: `v-model` de un objeto `CustomerForm = { nombre: string; rut: string; direccion: string; telefono: string; email: string }`.

- [ ] **Step 1: Crear el componente**

```vue
<script setup lang="ts">
export interface CustomerForm {
  nombre: string
  rut: string
  direccion: string
  telefono: string
  email: string
}

const model = defineModel<CustomerForm>({ required: true })
</script>

<template>
  <div class="flex flex-col gap-3 border-t border-default pt-3">
    <p class="text-sm font-medium text-default">Datos del cliente</p>
    <UFormField label="Nombre" required>
      <UInput v-model="model.nombre" placeholder="Nombre o razón social" />
    </UFormField>
    <div class="grid grid-cols-2 gap-3">
      <UFormField label="RUT">
        <UInput v-model="model.rut" placeholder="12.345.678-9" />
      </UFormField>
      <UFormField label="Teléfono">
        <UInput v-model="model.telefono" placeholder="+56 9 ..." />
      </UFormField>
    </div>
    <UFormField label="Dirección">
      <UInput v-model="model.direccion" />
    </UFormField>
    <UFormField label="Email">
      <UInput v-model="model.email" type="email" />
    </UFormField>
  </div>
</template>
```

- [ ] **Step 2: Verificar build**

Run: `cd frontend && npm run build`
Expected: build sin errores que mencionen `ClienteForm`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/ventas/ClienteForm.vue
git commit -m "feat(ventas-front): componente ClienteForm (datos de cliente)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — componente `CarritoPanel`

**Files:**
- Create: `frontend/app/components/ventas/CarritoPanel.vue`

**Interfaces:**
- Consumes: `CarritoLinea[]`, `ResultadoVenta | null`, lista de tipos de documento (`{ id, nombre, requiereCustomer }[]`), `CustomerForm`, `puedeCobrar` (Task 3), `ClienteForm` (Task 6).
- Produces: emite `cambiar-cantidad [itemId, cantidad]`, `quitar [itemId]`, `cobrar []`. `v-model:tipoDocumentoId` y `v-model:customer`.

- [ ] **Step 1: Crear el componente**

```vue
<script setup lang="ts">
import type { CarritoLinea } from '~/composables/useVenta'
import { puedeCobrar } from '~/composables/useVenta'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'
import type { CustomerForm } from './ClienteForm.vue'

interface TipoDoc { id: string; nombre: string; requiereCustomer: boolean }

const props = defineProps<{
  lineas: CarritoLinea[]
  resultado: ResultadoVenta | null
  loadingCalculo?: boolean
  tiposDocumento: TipoDoc[]
  tieneCaja: boolean
}>()
const emit = defineEmits<{
  'cambiar-cantidad': [itemId: string, cantidad: string]
  quitar: [itemId: string]
  cobrar: []
}>()

const tipoDocumentoId = defineModel<string | undefined>('tipoDocumentoId')
const customer = defineModel<CustomerForm>('customer', { required: true })

const docSeleccionado = computed(() =>
  props.tiposDocumento.find((t) => t.id === tipoDocumentoId.value),
)
const requiereCustomer = computed(() => docSeleccionado.value?.requiereCustomer ?? false)

const habilitarCobro = computed(() =>
  puedeCobrar({
    tieneCaja: props.tieneCaja,
    lineas: props.lineas,
    requiereCustomer: requiereCustomer.value,
    customerNombre: customer.value.nombre,
  }),
)

const docItems = computed(() =>
  props.tiposDocumento.map((t) => ({ label: t.nombre, value: t.id })),
)
</script>

<template>
  <UCard class="h-full flex flex-col">
    <template #header>
      <div class="flex items-center justify-between">
        <span class="font-semibold">Venta</span>
        <USelect
          v-model="tipoDocumentoId"
          :items="docItems"
          placeholder="Documento"
          size="sm"
          class="w-44"
        />
      </div>
    </template>

    <div class="flex-1 overflow-y-auto">
      <div v-if="!lineas.length" class="text-center text-muted py-10 text-sm">
        Agregá ítems desde el catálogo.
      </div>
      <ul v-else class="divide-y divide-default">
        <li v-for="linea in lineas" :key="linea.item.id" class="py-2 flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-default truncate">{{ linea.item.nombre }}</p>
            <p class="text-xs text-muted">
              {{ linea.item.monedaSimbolo ?? '' }}{{ linea.item.precioBase }} c/u
            </p>
          </div>
          <UInput
            :model-value="linea.cantidad"
            inputmode="decimal"
            size="sm"
            class="w-20"
            @update:model-value="(v: string | number) => emit('cambiar-cantidad', linea.item.id, String(v))"
          />
          <UButton
            icon="i-heroicons-trash"
            color="error"
            variant="ghost"
            size="xs"
            @click="emit('quitar', linea.item.id)"
          />
        </li>
      </ul>

      <ClienteForm v-if="requiereCustomer" v-model="customer" class="mt-3" />
    </div>

    <template #footer>
      <div class="flex flex-col gap-2">
        <div v-if="resultado" class="text-sm space-y-1">
          <div class="flex justify-between text-muted">
            <span>Neto</span><span>{{ resultado.totales.subtotalNeto }}</span>
          </div>
          <div class="flex justify-between text-muted">
            <span>Descuentos</span><span>-{{ resultado.totales.totalDescuentos }}</span>
          </div>
          <div class="flex justify-between text-muted">
            <span>Recargos</span><span>+{{ resultado.totales.totalRecargos }}</span>
          </div>
          <div class="flex justify-between text-muted">
            <span>Impuestos</span><span>+{{ resultado.totales.totalImpuestos }}</span>
          </div>
          <div class="flex justify-between font-semibold text-default text-base pt-1 border-t border-default">
            <span>Total</span><span>{{ resultado.totales.totalFinal }}</span>
          </div>
        </div>
        <UButton
          label="Cobrar"
          icon="i-heroicons-banknotes"
          color="primary"
          block
          size="lg"
          :loading="loadingCalculo"
          :disabled="!habilitarCobro"
          @click="emit('cobrar')"
        />
      </div>
    </template>
  </UCard>
</template>
```

- [ ] **Step 2: Verificar build**

Run: `cd frontend && npm run build`
Expected: build sin errores que mencionen `CarritoPanel`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/ventas/CarritoPanel.vue
git commit -m "feat(ventas-front): componente CarritoPanel (líneas, documento, desglose)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Frontend — componente `CobroModal`

**Files:**
- Create: `frontend/app/components/ventas/CobroModal.vue`

**Interfaces:**
- Consumes: `total: string`, `metodos: MetodoPagoTenant[]`, helpers `resumenCobro`/`sumaPagos` (Task 3).
- Produces: `v-model:open`, emite `confirmar [pagos: PagoInput[], vuelto: string]`. La construcción del DTO y el POST los hace la página (Task 9).

- [ ] **Step 1: Crear el componente**

```vue
<script setup lang="ts">
import { resumenCobro, sumaPagos, type PagoInput } from '~/composables/useVenta'

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const props = defineProps<{ total: string; metodos: MetodoPago[]; submitting?: boolean }>()
const emit = defineEmits<{ confirmar: [pagos: PagoInput[], vuelto: string] }>()
const open = defineModel<boolean>('open', { required: true })

const pagos = ref<PagoInput[]>([])

const metodosHabilitados = computed(() => props.metodos.filter((m) => m.habilitada))
const metodoItems = computed(() =>
  metodosHabilitados.value.map((m) => ({ label: m.nombre, value: m.metodoPagoId })),
)

watch(open, (v) => {
  if (v) {
    const def = metodosHabilitados.value[0]
    pagos.value = def
      ? [{ metodoPagoId: def.metodoPagoId, monto: props.total }]
      : []
  }
})

function agregarPago() {
  const def = metodosHabilitados.value[0]
  if (!def) return
  pagos.value = [...pagos.value, { metodoPagoId: def.metodoPagoId, monto: '0' }]
}
function quitarPago(i: number) {
  pagos.value = pagos.value.filter((_, idx) => idx !== i)
}

const resumen = computed(() =>
  resumenCobro(
    props.total,
    pagos.value,
    props.metodos.map((m) => ({ metodoPagoId: m.metodoPagoId, permiteVuelto: m.permiteVuelto })),
  ),
)
const suma = computed(() => sumaPagos(pagos.value))

const puedeConfirmar = computed(
  () => pagos.value.length > 0 && !resumen.value.excedenteSinVuelto,
)

function confirmar() {
  emit('confirmar', pagos.value, resumen.value.vuelto)
}
</script>

<template>
  <UModal v-model:open="open" title="Cobrar venta">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex justify-between text-base font-semibold">
          <span>Total a pagar</span><span>{{ total }}</span>
        </div>

        <div class="flex flex-col gap-2">
          <div v-for="(pago, i) in pagos" :key="i" class="flex items-center gap-2">
            <USelect v-model="pago.metodoPagoId" :items="metodoItems" class="flex-1" />
            <UInput v-model="pago.monto" inputmode="decimal" placeholder="0" class="w-32" />
            <UButton
              icon="i-heroicons-trash"
              color="error"
              variant="ghost"
              size="xs"
              :disabled="pagos.length <= 1"
              @click="quitarPago(i)"
            />
          </div>
          <UButton
            label="Agregar pago"
            icon="i-heroicons-plus"
            variant="ghost"
            size="sm"
            @click="agregarPago"
          />
        </div>

        <div class="text-sm space-y-1 border-t border-default pt-2">
          <div class="flex justify-between text-muted"><span>Pagado</span><span>{{ suma }}</span></div>
          <div class="flex justify-between text-muted"><span>Restante</span><span>{{ resumen.restante }}</span></div>
          <div class="flex justify-between font-medium text-default"><span>Vuelto</span><span>{{ resumen.vuelto }}</span></div>
          <p v-if="resumen.excedenteSinVuelto" class="text-error text-xs">
            El pago excede el total pero ningún método permite vuelto.
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          label="Confirmar venta"
          color="primary"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 2: Verificar build**

Run: `cd frontend && npm run build`
Expected: build sin errores que mencionen `CobroModal`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/ventas/CobroModal.vue
git commit -m "feat(ventas-front): componente CobroModal (pagos múltiples + vuelto)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Frontend — página `ventas/index.vue` + nav + gate de caja

**Files:**
- Create: `frontend/app/pages/ventas/index.vue`
- Modify: `frontend/app/layouts/dashboard.vue:8-36`

**Interfaces:**
- Consumes: `useVenta` (Task 4), `CatalogoGrid`/`CarritoPanel`/`CobroModal` (Tasks 5,7,8), `useCajaStore` (`cargarActiva`, `activa`), `useApiFetch`, `CustomerForm`.

- [ ] **Step 1: Agregar el ítem de navegación**

En `dashboard.vue`, dentro del computed `items`, después del bloque de Caja (línea 27), agregar:

```typescript
  if (permissionsStore.esAdmin || permissionsStore.can('Ventas', 'Crear')) {
    base.push({
      label: 'Punto de venta',
      icon: 'i-heroicons-shopping-cart',
      to: '/ventas',
    })
  }
```

- [ ] **Step 2: Crear la página**

```vue
<script setup lang="ts">
import { useVenta, type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
import type { CustomerForm } from '~/components/ventas/ClienteForm.vue'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface TipoDoc { id: string; nombre: string; requiereCustomer: boolean }
interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const cajaStore = useCajaStore()

const { lineas, resultado, loadingCalculo, add, quitar, cambiarCantidad, limpiar } = useVenta()

const items = ref<ItemCatalogo[]>([])
const metodos = ref<MetodoPago[]>([])
const tiposDocumento = ref<TipoDoc[]>([])
const loadingCatalogo = ref(false)

const tipoDocumentoId = ref<string | undefined>(undefined)
const customer = ref<CustomerForm>({ nombre: '', rut: '', direccion: '', telefono: '', email: '' })

const cobroOpen = ref(false)
const submitting = ref(false)

const tieneCaja = computed(() => cajaStore.activa !== null)
const totalFinal = computed(() => resultado.value?.totales.totalFinal ?? '0')

async function cargar() {
  loadingCatalogo.value = true
  try {
    const [itemsRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<ItemCatalogo[]>(`${apiUrl}/items?tipo=producto`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    items.value = itemsRes
    metodos.value = metodosRes
    tiposDocumento.value = tiposRes
    tipoDocumentoId.value = tiposRes[0]?.id
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar el POS', color: 'error' })
  } finally {
    loadingCatalogo.value = false
  }
}

onMounted(async () => {
  await Promise.all([cajaStore.cargarActiva(), cargar()])
})

async function confirmarCobro(pagos: PagoInput[], _vuelto: string) {
  submitting.value = true
  try {
    const docSel = tiposDocumento.value.find((t) => t.id === tipoDocumentoId.value)
    const body: Record<string, unknown> = {
      lineas: lineas.value.map((l) => ({ itemId: l.item.id, cantidad: l.cantidad })),
      pagos,
      tipoDocumentoId: tipoDocumentoId.value,
    }
    if (docSel?.requiereCustomer) {
      body.customer = {
        nombre: customer.value.nombre,
        rut: customer.value.rut || undefined,
        direccion: customer.value.direccion || undefined,
        telefono: customer.value.telefono || undefined,
        email: customer.value.email || undefined,
      }
    }
    const venta = await useApiFetch<{ estado: string }>(`${apiUrl}/ventas`, {
      method: 'POST',
      body,
    })
    toast.add({ title: `Venta ${venta.estado}`, color: 'success' })
    cobroOpen.value = false
    limpiar()
    customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '' }
    await cajaStore.cargarActiva()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al registrar la venta', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Punto de venta" />
    </template>

    <template #body>
      <div v-if="!cajaStore.loadingActiva && !tieneCaja" class="max-w-md mx-auto text-center py-16">
        <UIcon name="i-heroicons-lock-closed" class="w-12 h-12 text-muted mx-auto mb-4" />
        <h2 class="text-lg font-semibold text-default mb-1">Necesitás una caja abierta</h2>
        <p class="text-sm text-muted mb-4">Abrí una caja para registrar ventas del canal físico.</p>
        <UButton label="Ir a caja" icon="i-heroicons-banknotes" to="/caja" />
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-5 gap-4 h-full p-4">
        <div class="lg:col-span-3 min-h-0">
          <CatalogoGrid :items="items" :loading="loadingCatalogo" @add="add" />
        </div>
        <div class="lg:col-span-2 min-h-0">
          <CarritoPanel
            v-model:tipo-documento-id="tipoDocumentoId"
            v-model:customer="customer"
            :lineas="lineas"
            :resultado="resultado"
            :loading-calculo="loadingCalculo"
            :tipos-documento="tiposDocumento"
            :tiene-caja="tieneCaja"
            @cambiar-cantidad="cambiarCantidad"
            @quitar="quitar"
            @cobrar="cobroOpen = true"
          />
        </div>
      </div>

      <CobroModal
        v-model:open="cobroOpen"
        :total="totalFinal"
        :metodos="metodos"
        :submitting="submitting"
        @confirmar="confirmarCobro"
      />
    </template>
  </UDashboardPanel>
</template>
```

- [ ] **Step 3: Verificar build**

Run: `cd frontend && npm run build`
Expected: build de producción sin errores.

- [ ] **Step 4: Verificación manual (stack completo)**

Run: `docker-compose down -v && docker-compose up --build` (desde la raíz). Luego en el navegador (`localhost:5173`):
- Login como admin de Paris → entrar a "Punto de venta".
- Sin caja abierta: ver el panel bloqueante + botón "Ir a caja".
- Abrir una caja en `/caja`, volver al POS.
- Agregar ítems desde la grilla (probar el buscador), cambiar cantidades, ver el desglose recalcularse.
- Cobrar con efectivo por un monto mayor al total → ver vuelto → confirmar → toast "Venta pagada".
- Cambiar documento a Factura → aparece el formulario de cliente; sin nombre el botón Cobrar queda deshabilitado; con nombre, vender ok.
- Confirmar en `/caja` que el saldo esperado refleja el efectivo de la venta.

Expected: todos los flujos funcionan; los errores de negocio del backend aparecen en toasts.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/ventas/index.vue frontend/app/layouts/dashboard.vue
git commit -m "feat(ventas-front): pantalla POS con catálogo, carrito, cobro y gate de caja

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Documentación viva

**Files:**
- Modify: `docs/features/ventas.md`
- Modify: `docs/README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/MIGRACION-FUNCIONALIDADES.md`
- Modify: `docs/patterns/frontend.md`

- [ ] **Step 1: Actualizar `docs/features/ventas.md`**

Agregar el endpoint `GET /tipos-documento` a la sección "API Endpoints" y una nueva sección "Frontend (POS)" que describa: ruta `/ventas`, layout dos paneles, componentes (`CatalogoGrid`, `CarritoPanel`, `ClienteForm`, `CobroModal`), composable `useVenta`, gate de caja y fricción por documento. Aclarar que el listado/historial de ventas queda pendiente.

- [ ] **Step 2: Actualizar `CLAUDE.md`**

En la tabla "Estado actual", agregar una fila:

```markdown
| Frontend POS (crear venta: catálogo, carrito, cobro multipago, fricción por documento) | ✅ Implementado (2026-06-29) |
| Frontend — historial/consulta de ventas | 🔲 Por construir |
```

- [ ] **Step 3: Actualizar `docs/MIGRACION-FUNCIONALIDADES.md`**

En la sección del punto 10, anotar que la UI del POS (crear venta) está implementada (2026-06-29) y que la consulta/historial (punto 11) sigue pendiente.

- [ ] **Step 4: Actualizar `docs/patterns/frontend.md`**

Agregar una sección breve "Pantalla POS (dos paneles + carrito con recálculo)" apuntando a `pages/ventas/index.vue` y al patrón de helpers puros testeables en `composables/useVenta.ts`.

- [ ] **Step 5: Verificar links del índice**

Confirmar que `docs/README.md` siga listando `features/ventas.md` (ya existe; actualizar la descripción si cambió).

- [ ] **Step 6: Commit**

```bash
git add docs/features/ventas.md docs/README.md CLAUDE.md docs/MIGRACION-FUNCIONALIDADES.md docs/patterns/frontend.md
git commit -m "docs(ventas): documentar frontend POS y endpoint tipos-documento

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (cobertura del spec)

- ✅ Backend flag `requiere_customer` + seed → Task 1.
- ✅ Endpoint `GET /tipos-documento` por país del tenant → Task 2.
- ✅ Ruta `/ventas`, layout dos paneles, nav item → Task 9.
- ✅ Catálogo buscador + grilla → Task 5.
- ✅ Carrito solo cantidad + desglose del motor (recálculo debounced) → Tasks 4, 7.
- ✅ Múltiples pagos + vuelto → Tasks 3, 8.
- ✅ Fricción por documento (Boleta sin cliente / Factura con cliente obligatorio) → Tasks 3 (`puedeCobrar`), 6, 7, 9.
- ✅ Gate de caja → Task 9.
- ✅ Dinero string end-to-end + `inputmode="decimal"` → Tasks 3,7,8.
- ✅ Tests unit de la lógica pura → Task 3; e2e del endpoint → Task 2.
- ✅ Documentación viva → Task 10.
- ✅ Out of scope (historial/detalle/impresión/online/notas de crédito) documentado como pendiente → Task 10.

Type consistency verificada: `ItemCatalogo`, `CarritoLinea`, `PagoInput`, `CustomerForm`, `TipoDoc`, `MetodoPago` se usan con los mismos nombres/campos entre tasks; `puedeCobrar`/`resumenCobro`/`sumaPagos`/`toCalcularInput` con las firmas definidas en Task 3.
