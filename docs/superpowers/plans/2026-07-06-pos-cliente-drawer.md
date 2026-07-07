# Migración de datos del cliente en el POS a drawer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el bloque inline de datos del cliente en el carrito del POS (`CarritoPanel.vue`) por un `AppDrawer`, mostrando un resumen compacto (nombre + RUT) cuando ya hay datos cargados, con auto-apertura cuando el tipo de documento requiere cliente.

**Architecture:** Un helper puro `tieneCustomerData` en `useVenta.ts` decide si mostrar el resumen o el botón "Agregar". Un nuevo componente `ClienteDrawer.vue` envuelve `AppDrawer` + `ClienteForm` (patrón idéntico a `CajaMovimientoDrawer.vue`). `CarritoPanel.vue` pasa a controlar un `clienteDrawerOpen` local y un `watch` sobre `customerRequerido` para auto-abrir el drawer. `pos.vue` no cambia — sigue pasando `customer`/`customerExpandido` por v-model exactamente igual que hoy.

**Tech Stack:** Nuxt 4 (Vue 3, `<script setup>`), Nuxt UI v4 (`UDrawer` vía `AppDrawer`), Vitest + `@vue/test-utils`.

## Global Constraints

- No se cambia la interfaz externa de `CarritoPanel.vue` (sigue recibiendo `customer`/`customerExpandido`/`tipoDocumentoId` por v-model desde `pos.vue`, sin tocar `pos.vue`).
- El drawer usa `AppDrawer` con `width="md"` (default), `direction="right"` (default) — mismo patrón que `CajaMovimientoDrawer.vue`.
- El footer del drawer tiene un solo botón "Listo" que cierra — sin guardar/cancelar separado, porque `ClienteForm` sigue con `v-model` directo sobre el `customer` real.
- No se modifica `ClienteForm.vue` internamente (ni sus campos, ni el autocompletar de terceros).
- Usar clases semánticas de Nuxt UI (`text-muted`, `text-default`, `border-default`, etc.), nunca Tailwind hardcoded (`text-gray-500` y similares están prohibidos por el design system del proyecto).
- Componentes bajo `app/components/ventas/` se auto-importan con prefijo `Ventas` (ej. `ClienteDrawer.vue` → `<VentasClienteDrawer>`).

---

### Task 1: Helper `tieneCustomerData`

**Files:**
- Modify: `frontend/app/composables/useVenta.ts`
- Test: `frontend/app/composables/useVenta.spec.ts`

**Interfaces:**
- Consumes: `CustomerForm` (tipo exportado por `frontend/app/components/ventas/ClienteForm.vue:2-9` — `{ nombre: string; rut: string; direccion: string; telefono: string; email: string; terceroId: string | null }`).
- Produces: `tieneCustomerData(customer: CustomerForm): boolean` — usado por Task 3 (`CarritoPanel.vue`) para decidir si mostrar el resumen del cliente o el botón "Agregar datos del cliente".

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `frontend/app/composables/useVenta.spec.ts` (después del bloque `describe('puedeCobrar (gate)', ...)` que termina en la línea 257):

```ts
describe('tieneCustomerData', () => {
  const vacio: CustomerForm = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }

  it('false cuando no hay nombre ni terceroId', () => {
    expect(tieneCustomerData(vacio)).toBe(false)
  })

  it('false cuando el nombre es solo espacios', () => {
    expect(tieneCustomerData({ ...vacio, nombre: '   ' })).toBe(false)
  })

  it('true cuando hay nombre', () => {
    expect(tieneCustomerData({ ...vacio, nombre: 'Juan' })).toBe(true)
  })

  it('true cuando hay terceroId aunque el nombre esté vacío', () => {
    expect(tieneCustomerData({ ...vacio, terceroId: 'tercero-1' })).toBe(true)
  })
})
```

Y actualizar el import del inicio del archivo (líneas 1-14) agregando `tieneCustomerData` y el tipo `CustomerForm`:

```ts
import { describe, it, expect } from 'vitest'
import {
  agregarLinea,
  quitarLinea,
  setCantidad,
  toCalcularInput,
  descontarStockCatalogo,
  sumaPagos,
  resumenCobro,
  setMontoPago,
  puedeCobrar,
  tieneCustomerData,
  type CarritoLinea,
  type ItemCatalogo,
  type CustomerForm,
} from './useVenta'
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd frontend && npx vitest run useVenta.spec.ts`
Expected: FAIL — `tieneCustomerData` no está exportado por `./useVenta` (error de tipo/import o `is not a function`).

- [ ] **Step 3: Implementar `tieneCustomerData`**

En `frontend/app/composables/useVenta.ts`, agregar el import del tipo `CustomerForm` junto a los imports existentes (línea 3):

```ts
import { ref, watch } from 'vue'
import Decimal from 'decimal.js'
import { useCalculoPrecios, type ResultadoVenta, type CalcularVentaInput } from './useCalculoPrecios'
import type { CustomerForm } from '~/components/ventas/ClienteForm.vue'
```

Y agregar la función antes de `puedeCobrar` (la sección `// ── Gate ──` en la línea 164), re-exportando también el tipo para que el test pueda importarlo desde `./useVenta`:

```ts
// ── Gate ────────────────────────────────────────────────────────────────────

export type { CustomerForm }

export function tieneCustomerData(customer: CustomerForm): boolean {
  return Boolean(customer.nombre.trim() || customer.terceroId)
}

export function puedeCobrar(args: {
```

(el resto de `puedeCobrar` queda exactamente igual, solo se agrega el bloque `tieneCustomerData` justo antes)

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd frontend && npx vitest run useVenta.spec.ts`
Expected: PASS — todos los tests de `useVenta.spec.ts`, incluyendo los 4 nuevos de `tieneCustomerData`, en verde.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useVenta.ts frontend/app/composables/useVenta.spec.ts
git commit -m "$(cat <<'EOF'
feat(pos): add tieneCustomerData helper for cliente drawer migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Componente `ClienteDrawer.vue`

**Files:**
- Create: `frontend/app/components/ventas/ClienteDrawer.vue`

**Interfaces:**
- Consumes: `AppDrawer` (`frontend/app/components/AppDrawer.vue` — props `title`, `width`, model `open`, slots `header`/`body`/`actions`), `VentasClienteForm` (`frontend/app/components/ventas/ClienteForm.vue` — model `CustomerForm`).
- Produces: `<VentasClienteDrawer v-model:open="boolean" v-model:customer="CustomerForm" />` — usado por Task 3 (`CarritoPanel.vue`).

- [ ] **Step 1: Crear el componente**

Crear `frontend/app/components/ventas/ClienteDrawer.vue` con este contenido completo:

```vue
<script setup lang="ts">
import type { CustomerForm } from './ClienteForm.vue'

const open = defineModel<boolean>('open', { required: true })
const customer = defineModel<CustomerForm>('customer', { required: true })
</script>

<template>
  <AppDrawer v-model:open="open" width="md">
    <template #header>
      <span class="font-semibold text-default">Datos del cliente</span>
    </template>

    <template #body>
      <VentasClienteForm v-model="customer" />
    </template>

    <template #actions>
      <UButton label="Listo" color="primary" block @click="open = false" />
    </template>
  </AppDrawer>
</template>
```

- [ ] **Step 2: Verificar que no hay errores de tipos**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ClienteDrawer" || echo "sin errores en ClienteDrawer.vue"`
Expected: `sin errores en ClienteDrawer.vue` (el comando puede mostrar errores preexistentes de otros archivos del proyecto — solo nos importa que no aparezca `ClienteDrawer.vue` en la salida).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/ventas/ClienteDrawer.vue
git commit -m "$(cat <<'EOF'
feat(pos): add ClienteDrawer component wrapping ClienteForm in AppDrawer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migrar `CarritoPanel.vue` al drawer

**Files:**
- Modify: `frontend/app/components/ventas/CarritoPanel.vue`

**Interfaces:**
- Consumes: `tieneCustomerData` (Task 1, `~/composables/useVenta`), `VentasClienteDrawer` (Task 2, auto-importado).
- Produces: sin cambios en la interfaz externa del componente (mismos props/models/emits que hoy — `pos.vue` no se modifica).

- [ ] **Step 1: Reemplazar el script**

En `frontend/app/components/ventas/CarritoPanel.vue`, reemplazar el bloque `<script setup lang="ts">` completo (líneas 1-69) por:

```vue
<script setup lang="ts">
import type { CarritoLinea } from '~/composables/useVenta'
import { puedeCobrar, tieneCustomerData } from '~/composables/useVenta'
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

const clienteDrawerOpen = ref(false)

const docSeleccionado = computed(() =>
  props.tiposDocumento.find((t) => t.id === tipoDocumentoId.value),
)
const customerRequerido = computed(() => docSeleccionado.value?.customerRequerido ?? false)
const hasCustomerData = computed(() => tieneCustomerData(customer.value))

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

const { formatMonto } = useFormatters()
const { convertirAMonedaOficial } = useMonedaConversion()

const monedaIdsEnCarrito = computed(() => props.lineas.map((l) => l.item.monedaId))

// El input de cantidad arranca readonly para que el autocompletado de direcciones
// de Chrome (que ignora autocomplete="off") no lo rellene. Se vuelve editable al
// enfocarlo y se re-protege al salir.
function quitarReadonly(e: Event) {
  ;(e.target as HTMLInputElement).removeAttribute('readonly')
}
function ponerReadonly(e: Event) {
  ;(e.target as HTMLInputElement).setAttribute('readonly', 'readonly')
}

function abrirClienteDrawer() {
  customerExpandido.value = true
  clienteDrawerOpen.value = true
}

function quitarCustomer() {
  customerExpandido.value = false
  clienteDrawerOpen.value = false
  customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }
}

watch(customerRequerido, (requerido) => {
  if (requerido && !hasCustomerData.value) {
    customerExpandido.value = true
    clienteDrawerOpen.value = true
  }
})
</script>
```

- [ ] **Step 2: Reemplazar el bloque inline del template**

En el mismo archivo, dentro del `<template>`, reemplazar el bloque que va desde `<div v-if="customerRequerido || customerExpandido"` hasta el `<UButton v-else label="Agregar datos del cliente" ...>` (líneas 95-122 del archivo original: el div del formulario inline + el botón "Quitar" + el botón "Agregar" del `v-else`) por:

```vue
      <div
        v-if="hasCustomerData"
        class="pb-4 mb-4 border-b border-default flex items-center justify-between gap-2"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-default truncate">{{ customer.nombre }}</p>
          <p v-if="customer.rut" class="text-xs text-muted font-mono truncate">{{ customer.rut }}</p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <UButton
            icon="i-lucide-pencil"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="clienteDrawerOpen = true"
          />
          <UButton
            v-if="!customerRequerido"
            icon="i-lucide-x"
            variant="ghost"
            color="error"
            size="xs"
            @click="quitarCustomer"
          />
        </div>
      </div>
      <UButton
        v-else
        label="Agregar datos del cliente"
        icon="i-lucide-user-plus"
        variant="soft"
        color="neutral"
        size="sm"
        block
        class="mb-4"
        @click="abrirClienteDrawer"
      />
```

El resto del template (el `v-if="!lineas.length"` en adelante, el `<template #footer>`) no cambia.

- [ ] **Step 3: Agregar el drawer como hermano de `UCard`**

En el mismo archivo, el `<template>` raíz tiene un único nodo `<UCard>...</UCard>`. Agregar el drawer justo después del `</UCard>` de cierre (Vue 3 soporta múltiples raíces en el template):

```vue
  </UCard>
  <VentasClienteDrawer v-model:open="clienteDrawerOpen" v-model:customer="customer" />
</template>
```

- [ ] **Step 4: Verificar que no hay errores de tipos**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "CarritoPanel" || echo "sin errores en CarritoPanel.vue"`
Expected: `sin errores en CarritoPanel.vue`

- [ ] **Step 5: Correr la suite de tests para confirmar que no se rompió nada**

Run: `cd frontend && npx vitest run`
Expected: PASS — todos los tests (incluyendo `useVenta.spec.ts` de Task 1) siguen en verde; `CarritoPanel.vue` no tiene tests propios (no hay precedente de tests de componentes `.vue` en este repo, solo de composables/stores/utils).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/ventas/CarritoPanel.vue
git commit -m "$(cat <<'EOF'
feat(pos): migrate cliente form to drawer with compact summary

Reemplaza el bloque inline de datos del cliente en el carrito por el
ClienteDrawer, con resumen nombre+RUT y auto-apertura cuando el tipo de
documento requiere cliente.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Verificación manual en navegador

**Files:** ninguno (solo verificación, sin cambios de código).

**Interfaces:**
- Consumes: el POS completo (`pos.vue` + `CarritoPanel.vue` + `ClienteDrawer.vue`) corriendo contra el stack Docker.

- [ ] **Step 1: Levantar el stack**

Run: `docker-compose up -d` (o confirmar que ya está corriendo con `docker-compose ps`)
Expected: contenedores `frontend`, `backend`, `postgres` en estado `running`/`healthy`.

- [ ] **Step 2: Abrir el POS y verificar el flujo sin cliente requerido**

1. Ir a `http://localhost:5173/ventas/pos`, hacer login si hace falta, abrir caja si no hay una activa.
2. Con un tipo de documento que **no** requiere cliente seleccionado (el default), confirmar que el carrito muestra el botón "Agregar datos del cliente" (sin drawer abierto).
3. Agregar un ítem al carrito.
4. Click en "Agregar datos del cliente" → el drawer debe abrirse desde la derecha con título "Datos del cliente".
5. Completar el campo "Nombre" (ej. "Juan Pérez") y "RUT" (ej. "12.345.678-9").
6. Click en "Listo" → el drawer se cierra y el carrito muestra la línea de resumen "Juan Pérez" + "12.345.678-9" con íconos de editar (lápiz) y quitar (X).

Expected: comportamiento descrito en los 6 pasos, sin errores en la consola del navegador.

- [ ] **Step 3: Verificar editar y quitar**

1. Click en el ícono de editar (lápiz) del resumen → el drawer se reabre con los datos ya cargados.
2. Cambiar el nombre y click "Listo" → el resumen se actualiza con el nuevo nombre.
3. Click en el ícono de quitar (X) → el resumen desaparece y vuelve a aparecer el botón "Agregar datos del cliente".

Expected: los 3 pasos funcionan sin recargar la página ni errores en consola.

- [ ] **Step 4: Verificar auto-apertura con tipo de documento que requiere cliente**

1. Con el carrito vacío de datos de cliente (repetir "quitar" si hace falta), cambiar el selector de "Documento" a un tipo que requiera cliente (ej. Factura — el `seeder.service.ts` define cuáles tienen `customerRequerido = true`).
2. Verificar que el drawer se abre automáticamente sin click adicional.
3. Cerrar el drawer sin completar el nombre (click "Listo").
4. Verificar que el botón "Cobrar" queda deshabilitado (o al intentar cobrar, se bloquea) por falta de nombre del cliente.
5. Reabrir el drawer (ícono editar), completar el nombre, click "Listo".
6. Verificar que el botón "Cobrar" se habilita.

Expected: auto-apertura al cambiar el tipo de documento, bloqueo de cobro sin nombre, habilitación al completarlo — sin errores en consola.

- [ ] **Step 5: Confirmar reset al completar una venta**

1. Completar el cobro de la venta con los datos de cliente cargados (usar el modal de cobro existente).
2. Tras la confirmación exitosa, verificar que el carrito vuelve a mostrar el botón "Agregar datos del cliente" (los datos del cliente anterior no quedan pegados en la siguiente venta).

Expected: reset correcto, igual que el comportamiento ya existente hoy (`pos.vue:156-157`).

No commit en esta tarea — es solo verificación. Si algún paso falla, volver a la tarea correspondiente (2 o 3) y corregir antes de continuar.
