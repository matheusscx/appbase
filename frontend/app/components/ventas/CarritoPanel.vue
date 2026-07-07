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
  'limpiar-todo': []
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
</script>

<template>
  <UCard
    class="h-full"
    :ui="{
      root: 'h-full min-h-0 flex flex-col overflow-hidden',
      header: 'shrink-0 p-4 sm:px-6',
      body: 'flex-1 min-h-0 overflow-hidden flex flex-col p-0',
      footer: 'shrink-0 p-4 sm:px-6',
    }"
  >
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

    <div class="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6">
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
      <div v-if="!lineas.length" class="text-center text-muted py-10 text-sm">
        Agregá ítems desde el catálogo.
      </div>
      <ul v-else class="divide-y divide-default">
        <li v-for="linea in lineas" :key="linea.item.id" class="py-2 flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-default truncate">{{ linea.item.nombre }}</p>
            <p class="text-xs text-muted font-mono">
              {{ formatMonto(convertirAMonedaOficial(linea.item.precioBase, linea.item.monedaId)) }} c/u
            </p>
          </div>
          <UInput
            :model-value="linea.cantidad"
            name="cantidad"
            inputmode="decimal"
            autocomplete="off"
            readonly
            size="sm"
            class="w-20"
            @focusin="quitarReadonly"
            @focusout="ponerReadonly"
            @update:model-value="(v: string | number) => emit('cambiar-cantidad', linea.item.id, String(v))"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            @click="emit('quitar', linea.item.id)"
          />
        </li>
      </ul>
    </div>

    <template #footer>
      <div class="flex flex-col gap-2">
        <div v-if="resultado" class="text-sm space-y-1">
          <div class="flex justify-between text-muted">
            <span>Neto</span><span>{{ formatMonto(resultado.totales.subtotalNeto) }}</span>
          </div>
          <div class="flex justify-between text-muted">
            <span>Descuentos</span><span>-{{ formatMonto(resultado.totales.totalDescuentos) }}</span>
          </div>
          <div class="flex justify-between text-muted">
            <span>Recargos</span><span>+{{ formatMonto(resultado.totales.totalRecargos) }}</span>
          </div>
          <div class="flex justify-between text-muted">
            <span>Impuestos</span><span>+{{ formatMonto(resultado.totales.totalImpuestos) }}</span>
          </div>
          <div class="flex justify-between items-center font-semibold text-default text-base pt-1 border-t border-default">
            <span class="flex items-center gap-1">
              Total
              <VentasMonedaTasasInfo :moneda-ids="monedaIdsEnCarrito" />
            </span>
            <span>{{ formatMonto(resultado.totales.totalFinal) }}</span>
          </div>
        </div>
        <UButton
          label="Cobrar"
          icon="i-lucide-banknote"
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
  <VentasClienteDrawer v-model:open="clienteDrawerOpen" v-model:customer="customer" />
  <CrudModal
    v-model:open="vaciarModalOpen"
    title="Vaciar venta actual"
    message="¿Estás seguro de que quieres vaciar el carrito, los datos del cliente y el tipo de documento? Esta acción no se puede deshacer."
    confirm-label="Vaciar todo"
    confirm-color="error"
    @confirm="confirmarVaciarTodo"
  />
</template>
