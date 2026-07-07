# POS "Vaciar todo" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual "Vaciar todo" option to the POS cart panel that resets cart lines, customer data, and the selected document type back to their initial state, without reloading the page.

**Architecture:** A new icon button in `CarritoPanel.vue`'s header opens a `CrudModal` confirmation dialog. On confirm, `CarritoPanel.vue` resets the state it already owns via `defineModel` (customer, customerExpandido, clienteDrawerOpen, tipoDocumentoId) and emits a `limpiar-todo` event that `pos.vue` wires directly to the existing `limpiar()` function from `useVenta()` (which clears cart lines/resultado).

**Tech Stack:** Nuxt 4 / Vue 3 `<script setup>`, Nuxt UI v4 (`UButton`, `UTooltip`, `USelect`), existing `CrudModal.vue` confirm-dialog component.

## Global Constraints

- Design tokens: semantic Nuxt UI tokens only, no hardcoded Tailwind colors.
- Reset shape for `CustomerForm` must match exactly: `{ nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }` (same literal already used in `quitarCustomer()` at `CarritoPanel.vue:72` and in `pos.vue:86` / `pos.vue:157`).
- Modal copy (exact, from the approved spec):
  - `title="Vaciar venta actual"`
  - `message="¿Estás seguro de que quieres vaciar el carrito, los datos del cliente y el tipo de documento? Esta acción no se puede deshacer."`
  - `confirm-label="Vaciar todo"`
  - `confirm-color="error"`
- Button: icon-only, `icon="i-lucide-eraser"`, `variant="ghost"`, `color="neutral"`, `size="sm"`, wrapped in `<UTooltip text="Vaciar todo">`.
- Button `:disabled` when there is nothing to clear: `!lineas.length && !hasCustomerData && tipoDocumentoId === props.tiposDocumento[0]?.id`.
- No new automated component tests — this repo has no precedent for testing `.vue` components directly (confirmed during the prior POS drawer migration); verification here is type-check + the existing full vitest suite (no regressions expected, since no composable logic changes) + manual browser walkthrough.

---

### Task 1: "Vaciar todo" button, confirm modal, and reset wiring

**Files:**
- Modify: `frontend/app/components/ventas/CarritoPanel.vue`
- Modify: `frontend/app/pages/ventas/pos.vue`

**Interfaces:**
- Consumes: `props.tiposDocumento` (existing prop, `TipoDoc[]`), `tieneCustomerData` (existing import from `~/composables/useVenta`), `limpiar()` (existing function returned by `useVenta()` in `pos.vue`, clears `lineas`/`resultado` — see `useVenta.ts:231-234`).
- Produces: new `CarritoPanel` emit `'limpiar-todo': []`, consumed by `pos.vue`.

This is a single task because the button, its confirm dialog, and the emit wiring in `pos.vue` are one indivisible, independently-testable deliverable — there is no meaningful midpoint where a reviewer could approve half of it.

- [ ] **Step 1: Add the `limpiar-todo` emit, state, and reset function to `CarritoPanel.vue`**

Current script section (`frontend/app/components/ventas/CarritoPanel.vue:16-20`):

```ts
const emit = defineEmits<{
  'cambiar-cantidad': [itemId: string, cantidad: string]
  quitar: [itemId: string]
  cobrar: []
}>()
```

Replace with:

```ts
const emit = defineEmits<{
  'cambiar-cantidad': [itemId: string, cantidad: string]
  quitar: [itemId: string]
  cobrar: []
  'limpiar-todo': []
}>()
```

Current script section (`frontend/app/components/ventas/CarritoPanel.vue:69-84`, the `quitarCustomer` function through the two `watch` calls):

```ts
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

watch(clienteDrawerOpen, (open) => {
  if (!open && !hasCustomerData.value) customerExpandido.value = false
})
```

Insert a new `vaciarModalOpen` ref, a `hayAlgoQueLimpiar` computed, and a `confirmarVaciarTodo` function right after `quitarCustomer`, before the `watch(customerRequerido, ...)` block:

```ts
function quitarCustomer() {
  customerExpandido.value = false
  clienteDrawerOpen.value = false
  customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }
}

const vaciarModalOpen = ref(false)

const hayAlgoQueLimpiar = computed(() =>
  props.lineas.length > 0
  || hasCustomerData.value
  || tipoDocumentoId.value !== props.tiposDocumento[0]?.id,
)

function confirmarVaciarTodo() {
  customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }
  customerExpandido.value = false
  clienteDrawerOpen.value = false
  tipoDocumentoId.value = props.tiposDocumento[0]?.id
  vaciarModalOpen.value = false
  emit('limpiar-todo')
}

watch(customerRequerido, (requerido) => {
  if (requerido && !hasCustomerData.value) {
    customerExpandido.value = true
    clienteDrawerOpen.value = true
  }
})

watch(clienteDrawerOpen, (open) => {
  if (!open && !hasCustomerData.value) customerExpandido.value = false
})
```

- [ ] **Step 2: Add the button to the header and the `CrudModal` to the template**

Current template header (`frontend/app/components/ventas/CarritoPanel.vue:97-108`):

```vue
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <span class="font-semibold">Venta</span>
        <USelect
          v-model="tipoDocumentoId"
          :items="docItems"
          placeholder="Documento"
          size="sm"
          class="min-w-0 flex-1 max-w-52"
        />
      </div>
    </template>
```

Replace with:

```vue
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <span class="font-semibold">Venta</span>
        <USelect
          v-model="tipoDocumentoId"
          :items="docItems"
          placeholder="Documento"
          size="sm"
          class="min-w-0 flex-1 max-w-52"
        />
        <UTooltip text="Vaciar todo">
          <UButton
            icon="i-lucide-eraser"
            variant="ghost"
            color="neutral"
            size="sm"
            :disabled="!hayAlgoQueLimpiar"
            @click="vaciarModalOpen = true"
          />
        </UTooltip>
      </div>
    </template>
```

Current template end (`frontend/app/components/ventas/CarritoPanel.vue:218`):

```vue
  <VentasClienteDrawer v-model:open="clienteDrawerOpen" v-model:customer="customer" />
```

Replace with:

```vue
  <VentasClienteDrawer v-model:open="clienteDrawerOpen" v-model:customer="customer" />
  <CrudModal
    v-model:open="vaciarModalOpen"
    title="Vaciar venta actual"
    message="¿Estás seguro de que quieres vaciar el carrito, los datos del cliente y el tipo de documento? Esta acción no se puede deshacer."
    confirm-label="Vaciar todo"
    confirm-color="error"
    @confirm="confirmarVaciarTodo"
  />
```

- [ ] **Step 3: Wire `pos.vue` to clear cart lines on `limpiar-todo`**

Current (`frontend/app/pages/ventas/pos.vue:199-211`):

```vue
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

Replace with:

```vue
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
            @limpiar-todo="limpiar"
          />
```

`limpiar` is already destructured from `useVenta()` at `pos.vue:23` (`const { lineas, resultado, loadingCalculo, add, quitar, cambiarCantidad, limpiar } = useVenta()`) — no other change needed in `pos.vue`.

- [ ] **Step 4: Type-check both modified files**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "CarritoPanel|pos\.vue" || echo "sin errores"`
Expected: `sin errores`

- [ ] **Step 5: Run the full frontend test suite (regression check)**

Run: `cd frontend && npx vitest run`
Expected: `Test Files  9 passed (9)` / `Tests  106 passed (106)` — same counts as before this task, since no composable logic changed.

- [ ] **Step 6: Manual browser verification**

Against the running `docker-compose` stack (`http://localhost:5173`, login `admin@sistema.com` / `admin`, tenant "Paris"):

1. Navigate to `/ventas/pos`. Confirm the eraser button next to the document-type select is **disabled** (cart empty, no customer, default doc type).
2. Add an item to the cart, open "Agregar datos del cliente", select a tercero (e.g. "Juan Pérez") to populate customer data, close the drawer, then change the document type to "Factura Electrónica". Confirm the eraser button is now **enabled**.
3. Click the eraser button. Confirm the `CrudModal` opens with title "Vaciar venta actual" and the exact message from the Global Constraints section.
4. Click "Cancelar". Confirm nothing changed (cart line, customer summary, and document type all still present).
5. Click the eraser button again, then click "Vaciar todo" to confirm. Verify: cart is empty ("Agregá ítems desde el catálogo." shown), customer summary is gone (back to "Agregar datos del cliente" button), document type reset to the first item in the list ("Boleta de Venta"), and the eraser button is disabled again.
6. Check the browser console for new errors (expect only the pre-existing Reka UI/Nuxt UI accessibility warnings already seen in prior POS work, no new ones).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/ventas/CarritoPanel.vue frontend/app/pages/ventas/pos.vue
git commit -m "feat(pos): add vaciar todo option to reset the current sale"
```
