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

function mostrarCustomer() {
  customerExpandido.value = true
}

function quitarCustomer() {
  customerExpandido.value = false
  customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '' }
}
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

      <VentasClienteForm v-if="customerRequerido" v-model="customer" class="mt-3" />
      <template v-else>
        <div class="mt-3">
          <UButton
            v-if="!customerExpandido"
            label="Agregar datos del cliente"
            icon="i-heroicons-user-plus"
            variant="soft"
            color="neutral"
            size="sm"
            block
            @click="mostrarCustomer"
          />
          <template v-else>
            <VentasClienteForm v-model="customer" />
            <UButton
              label="Quitar datos del cliente"
              icon="i-heroicons-x-mark"
              variant="ghost"
              color="error"
              size="xs"
              class="mt-2"
              @click="quitarCustomer"
            />
          </template>
        </div>
      </template>
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
