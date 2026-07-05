<script setup lang="ts">
import type { CarritoLinea } from '~/composables/useVenta'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'

const props = defineProps<{
  lineas: CarritoLinea[]
  resultado: ResultadoVenta | null
  loadingCalculo?: boolean
  pagando?: boolean
}>()
const emit = defineEmits<{
  'cambiar-cantidad': [itemId: string, cantidad: string]
  quitar: [itemId: string]
  pagar: []
}>()

const { formatMonto } = useFormatters()
const { convertirAMonedaOficial } = useMonedaConversion()

const monedaIdsEnCarrito = computed(() => props.lineas.map((l) => l.item.monedaId))
const habilitarPago = computed(() => props.lineas.length > 0 && !props.loadingCalculo)

function quitarReadonly(e: Event) {
  ;(e.target as HTMLInputElement).removeAttribute('readonly')
}
function ponerReadonly(e: Event) {
  ;(e.target as HTMLInputElement).setAttribute('readonly', 'readonly')
}
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
      <span class="font-semibold">Tu carrito</span>
    </template>

    <div class="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6">
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
          label="Pagar"
          icon="i-lucide-credit-card"
          color="primary"
          block
          size="lg"
          :loading="pagando"
          :disabled="!habilitarPago"
          @click="emit('pagar')"
        />
      </div>
    </template>
  </UCard>
</template>
