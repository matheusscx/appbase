# Customer Datos Opcionales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar "datos del comprador requeridos" (factura) de "datos del comprador opcionales" (boleta con botón para expandir), renombrando `requiere_customer` → `customer_requerido` en toda la stack.

**Architecture:** Renombrar la columna en la entidad TypeORM (sync recrea la BD limpia en dev), actualizar la query SQL y el seeder. En el frontend, añadir `customerExpandido` como `defineModel` en `CarritoPanel.vue` para que el padre (`ventas/index.vue`) controle validación y payload.

**Tech Stack:** NestJS + TypeORM (synchronize:true en dev), Nuxt 4, Vue 3 Composition API, Nuxt UI.

## Global Constraints

- TypeORM `synchronize: true` gestiona el esquema en dev — no crear archivos de migración
- Todo cálculo de dinero usa Decimal.js — no aplica acá pero no introducir `number` nativo para montos
- Soft delete: nunca borrar filas; filtrar siempre `eliminado_el IS NULL`
- `startup-pos.sql` es solo referencia documental — actualizarlo igual que la entidad

---

### Task 1: Backend — renombrar `requiere_customer` → `customer_requerido`

**Files:**
- Modify: `backend/src/modules/ventas/entities/tipo-documento-tributario.entity.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts`
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Modify: `startup-pos.sql` (línea 98)

**Interfaces:**
- Produces: endpoint `GET /tipos-documento` retorna `{ id, nombre, codigo, customerRequerido: boolean }` (antes `requiereCustomer`)

- [ ] **Step 1: Actualizar la entidad**

En `backend/src/modules/ventas/entities/tipo-documento-tributario.entity.ts`, cambiar:

```typescript
// antes
@Column({ name: 'requiere_customer', default: false })
requiereCustomer: boolean;

// después
@Column({ name: 'customer_requerido', default: false })
customerRequerido: boolean;
```

- [ ] **Step 2: Actualizar el servicio**

En `backend/src/modules/ventas/ventas.service.ts`:

**Interface (línea 22-27):**
```typescript
export interface TipoDocumentoResponse {
  id: string;
  nombre: string;
  codigo: string | null;
  customerRequerido: boolean;
}
```

**Query SQL en `findTiposDocumento` (líneas 358-380):**
```typescript
async findTiposDocumento(tenantId: string): Promise<TipoDocumentoResponse[]> {
  const rows: {
    tipo_documento_id: string;
    nombre: string;
    codigo: string | null;
    customer_requerido: boolean;
  }[] = await this.dataSource.query(
    `SELECT td.tipo_documento_id,
            td.nombre,
            td.codigo,
            td.customer_requerido
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
    customerRequerido: r.customer_requerido === true,
  }));
}
```

- [ ] **Step 3: Actualizar el seeder**

En `backend/src/modules/seeder/seeder.service.ts`, en el array `tipos` del método `seedTiposDocumentoTributario` (líneas ~1463-1481):

```typescript
const tipos: Partial<TipoDocumentoTributario>[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440145',
    paisId: CHILE,
    nombre: 'Boleta de Venta',
    codigo: '39',
    descripcion: 'Boleta electrónica de venta al consumidor final',
    activo: true,
    customerRequerido: false,   // antes: requiereCustomer
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440146',
    paisId: CHILE,
    nombre: 'Factura Electrónica',
    codigo: '33',
    descripcion: 'Factura electrónica afecta a IVA',
    activo: true,
    customerRequerido: true,    // antes: requiereCustomer
  },
];
```

- [ ] **Step 4: Actualizar startup-pos.sql**

En `startup-pos.sql` línea 98, cambiar:

```sql
-- antes
  "requiere_customer" BOOLEAN     NOT NULL DEFAULT false,

-- después
  "customer_requerido" BOOLEAN     NOT NULL DEFAULT false,
```

- [ ] **Step 5: Verificar que el backend levanta limpio**

```bash
docker-compose down -v && docker-compose up --build
```

Esperado: el backend arranca sin errores, el seeder corre sin `column "requiere_customer" does not exist`.

Verificar endpoint:
```bash
# Obtener token primero (login normal), luego:
curl -H "Authorization: Bearer <token>" http://localhost:3000/tipos-documento
```

Esperado: respuesta con `customerRequerido` (no `requiereCustomer`):
```json
[
  { "id": "...", "nombre": "Boleta de Venta", "codigo": "39", "customerRequerido": false },
  { "id": "...", "nombre": "Factura Electrónica", "codigo": "33", "customerRequerido": true }
]
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ventas/entities/tipo-documento-tributario.entity.ts \
        backend/src/modules/ventas/ventas.service.ts \
        backend/src/modules/seeder/seeder.service.ts \
        startup-pos.sql
git commit -m "refactor(ventas): renombrar requiere_customer → customer_requerido"
```

---

### Task 2: Frontend composable — actualizar `puedeCobrar`

**Files:**
- Modify: `frontend/app/composables/useVenta.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores (función pura)
- Produces: `puedeCobrar(args: { tieneCaja, lineas, customerRequerido, customerExpandido, customerNombre, tipoDocumentoId }): boolean`

- [ ] **Step 1: Actualizar la firma y lógica de `puedeCobrar`**

En `frontend/app/composables/useVenta.ts`, reemplazar la función `puedeCobrar` (líneas 105-117):

```typescript
export function puedeCobrar(args: {
  tieneCaja: boolean
  lineas: CarritoLinea[]
  customerRequerido: boolean
  customerExpandido: boolean
  customerNombre: string
  tipoDocumentoId: string | undefined
}): boolean {
  if (!args.tieneCaja) return false
  if (args.lineas.length === 0) return false
  if (!args.tipoDocumentoId) return false
  if ((args.customerRequerido || args.customerExpandido) && args.customerNombre.trim() === '') return false
  return true
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd frontend && npx nuxi typecheck 2>&1 | grep -i "useVenta\|puedeCobrar" | head -20
```

Esperado: sin errores en `useVenta.ts`. Habrá errores en `CarritoPanel.vue` por la firma antigua — se corrigen en Task 3.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/composables/useVenta.ts
git commit -m "refactor(pos): actualizar puedeCobrar con customerRequerido + customerExpandido"
```

---

### Task 3: Frontend — `CarritoPanel.vue` con botón opcional

**Files:**
- Modify: `frontend/app/components/ventas/CarritoPanel.vue`

**Interfaces:**
- Consumes: `puedeCobrar` con firma de Task 2 (`customerRequerido`, `customerExpandido`)
- Produces: nuevo `defineModel<boolean>('customerExpandido')` disponible para el padre; botón "Agregar datos del cliente" cuando `customerRequerido = false`

- [ ] **Step 1: Actualizar el `<script setup>` de CarritoPanel**

Reemplazar el contenido del bloque `<script setup>` completo en `frontend/app/components/ventas/CarritoPanel.vue`:

```typescript
<script setup lang="ts">
import type { CarritoLinea } from '~/composables/useVenta'
import { puedeCobrar } from '~/composables/useVenta'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'
import type { CustomerForm } from './ClienteForm.vue'

interface TipoDoc { id: string; nombre: string; customerRequerido: boolean }

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
const customerExpandido = defineModel<boolean>('customerExpandido', { default: false })

const docSeleccionado = computed(() =>
  props.tiposDocumento.find((t) => t.id === tipoDocumentoId.value),
)
const customerRequerido = computed(() => docSeleccionado.value?.customerRequerido ?? false)

const habilitarCobro = computed(() =>
  puedeCobrar({
    tieneCaja: props.tieneCaja,
    lineas: props.lineas,
    customerRequerido: customerRequerido.value,
    customerExpandido: customerExpandido.value,
    customerNombre: customer.value.nombre,
    tipoDocumentoId: tipoDocumentoId.value,
  }),
)

const docItems = computed(() =>
  props.tiposDocumento.map((t) => ({ label: t.nombre, value: t.id })),
)

function quitarCustomer() {
  customerExpandido.value = false
  customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '' }
}
</script>
```

- [ ] **Step 2: Actualizar el `<template>` de CarritoPanel**

Reemplazar la línea del form de cliente en el `<template>` (la zona dentro de `<div class="flex-1 overflow-y-auto">`). Reemplazar:

```html
      <VentasClienteForm v-if="requiereCustomer" v-model="customer" class="mt-3" />
```

Por:

```html
      <template v-if="customerRequerido">
        <VentasClienteForm v-model="customer" class="mt-3" />
      </template>
      <template v-else>
        <div class="mt-3">
          <UButton
            v-if="!customerExpandido"
            label="Agregar datos del cliente"
            icon="i-lucide-user-plus"
            variant="soft"
            color="neutral"
            size="sm"
            block
            @click="customerExpandido = true"
          />
          <template v-else>
            <VentasClienteForm v-model="customer" />
            <UButton
              label="Quitar datos del cliente"
              icon="i-lucide-x"
              variant="ghost"
              color="error"
              size="xs"
              class="mt-2"
              @click="quitarCustomer"
            />
          </template>
        </div>
      </template>
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd frontend && npx nuxi typecheck 2>&1 | grep -i "CarritoPanel\|carrito-panel" | head -20
```

Esperado: sin errores en CarritoPanel. Puede haber errores en `ventas/index.vue` por el nuevo modelo — se corrigen en Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/ventas/CarritoPanel.vue
git commit -m "feat(pos): botón opcional para agregar datos del cliente en boleta"
```

---

### Task 4: Frontend — `ventas/index.vue` — orquestación y validación

**Files:**
- Modify: `frontend/app/pages/ventas/index.vue`

**Interfaces:**
- Consumes: `customerExpandido` defineModel de Task 3; `TipoDoc.customerRequerido` del backend (Task 1)

- [ ] **Step 1: Actualizar la interfaz `TipoDoc` y añadir `customerExpandido`**

En el `<script setup>` de `frontend/app/pages/ventas/index.vue`, cambiar la interfaz y añadir el ref:

```typescript
// Cambiar interfaz (línea 9)
interface TipoDoc { id: string; nombre: string; customerRequerido: boolean }

// Añadir junto a los otros refs de estado (después de línea 30)
const customerExpandido = ref(false)
```

- [ ] **Step 2: Añadir watcher para resetear al cambiar tipo de documento**

Añadir el watcher después del `watch` existente de `cajaStore.activa` (después de línea 83):

```typescript
watch(tipoDocumentoId, () => {
  customerExpandido.value = false
  customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '' }
})
```

- [ ] **Step 3: Actualizar `confirmarCobro` — payload y reset**

Reemplazar la función `confirmarCobro` completa (líneas 109-142):

```typescript
async function confirmarCobro(pagos: PagoInput[], _vuelto: string) {
  const docSel = tiposDocumento.value.find((t) => t.id === tipoDocumentoId.value)
  const incluirCustomer = docSel?.customerRequerido || customerExpandido.value

  if (incluirCustomer && !customer.value.nombre.trim()) {
    toast.add({ title: 'El nombre del cliente es requerido', color: 'error' })
    return
  }

  submitting.value = true
  try {
    const body: Record<string, unknown> = {
      lineas: lineas.value.map((l) => ({ itemId: l.item.id, cantidad: l.cantidad })),
      pagos,
      tipoDocumentoId: tipoDocumentoId.value,
    }
    if (incluirCustomer) {
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
    customerExpandido.value = false
    customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '' }
    await cajaStore.cargarActiva()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al registrar la venta', color: 'error' })
  } finally {
    submitting.value = false
  }
}
```

- [ ] **Step 4: Añadir `v-model:customer-expandido` en el template**

En el `<template>`, en `<VentasCarritoPanel>` (líneas 176-188), añadir el binding del nuevo modelo:

```html
<VentasCarritoPanel
  v-model:tipo-documento-id="tipoDocumentoId"
  v-model:customer="customer"
  v-model:customer-expandido="customerExpandido"
  :lineas="lineas"
  :resultado="resultado"
  :loading-calculo="loadingCalculo"
  :tipos-documento="tiposDocumento"
  :tiene-caja="tieneCaja"
  @cambiar-cantidad="cambiarCantidad"
  @quitar="quitar"
  @cobrar="cobroOpen = true"
/>
```

- [ ] **Step 5: Verificar TypeScript sin errores**

```bash
cd frontend && npx nuxi typecheck 2>&1 | head -30
```

Esperado: 0 errores.

- [ ] **Step 6: Verificar en el navegador**

Con el stack corriendo (`docker-compose up`), abrir http://localhost:5173 y verificar:

1. **Boleta seleccionada** → aparece botón "Agregar datos del cliente"
2. Hacer clic en el botón → se expande el form con botón "Quitar datos del cliente"
3. Intentar cobrar con form abierto y nombre vacío → toast de error "El nombre del cliente es requerido"
4. Llenar nombre → cobrar → venta se registra
5. Hacer clic en "Quitar datos del cliente" → form se cierra, datos limpios
6. Cobrar sin abrir form → venta se registra sin datos de customer
7. **Cambiar a Factura** → form siempre visible (sin botón), nombre requerido
8. Cambiar de Factura a Boleta → datos de customer reseteados, form cerrado

- [ ] **Step 7: Commit**

```bash
git add frontend/app/pages/ventas/index.vue
git commit -m "feat(pos): orquestar customerExpandido en ventas/index — payload y validación"
```
