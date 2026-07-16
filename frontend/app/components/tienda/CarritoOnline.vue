<script setup lang="ts">
import type { CarritoLinea } from '~/composables/useVenta'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'
import { unidadBaseItem } from '~/utils/cantidad-presentacion'

const props = defineProps<{
  lineas: CarritoLinea[]
  resultado: ResultadoVenta | null
  loadingCalculo?: boolean
  pagando?: boolean
}>()
const emit = defineEmits<{
  'cambiar-cantidad': [
    index: number,
    payload: { presentacion: string, unidadCodigo: string, cantidadCanonica: string },
  ]
  quitar: [index: number]
  pagar: []
}>()

const { formatMonto } = useFormatters()
const { convertirAMonedaOficial } = useMonedaConversion()

const monedaIdsEnCarrito = computed(() => props.lineas.map((l) => l.item.monedaId))
const habilitarPago = computed(() => props.lineas.length > 0 && !props.loadingCalculo)

function unidadPresLinea(linea: CarritoLinea): string {
  return linea.unidadCodigoPresentacion ?? unidadBaseItem(linea.item)
}

function presentacionLinea(linea: CarritoLinea): string {
  return linea.cantidadPresentacion ?? linea.cantidad
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
        <li v-for="(linea, index) in lineas" :key="`${linea.item.id}-${index}`" class="py-2 flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-default truncate">{{ linea.item.nombre }}</p>
            <p class="text-xs text-muted font-mono">
              {{ formatMonto(convertirAMonedaOficial(linea.item.precioBase, linea.item.monedaId)) }} c/u · {{ unidadBaseItem(linea.item) }}
            </p>
          </div>
          <AppCantidadInput
            :model-value="presentacionLinea(linea)"
            :unidad-codigo="unidadPresLinea(linea)"
            :unidad-base-codigo="unidadBaseItem(linea.item)"
            @change="emit('cambiar-cantidad', index, $event)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            @click="emit('quitar', index)"
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
