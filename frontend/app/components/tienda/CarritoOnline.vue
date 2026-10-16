<script setup lang="ts">
import type { CarritoLinea } from '~/composables/useVenta'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'
import Decimal from 'decimal.js'
import { unidadBaseItem } from '~/utils/cantidad-presentacion'

const props = defineProps<{
  lineas: CarritoLinea[]
  resultado: ResultadoVenta | null
  /** ¿`resultado` corresponde a `lineas`? Ver `useResultadoCalculado`. */
  vigente: boolean
  loadingCalculo?: boolean
  pagando?: boolean
  /** Sin `Tienda Online:Crear` el backend contesta 403 al pagar: se dice antes de armar el carrito. */
  sinPermiso?: boolean
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

// Las advertencias se atribuyen a una línea POR ÍNDICE: mientras el cálculo no
// corresponda al carrito actual no se dibujan, porque el índice apuntaría a otra
// línea. Los totales sí conservan el último valor conocido.
const calculoVigente = computed(() => props.vigente ? props.resultado : null)

const monedaIdsEnCarrito = computed(() => props.lineas.map((l) => l.item.monedaId))
// NO se gatea por `vigente`, a propósito: el clic espera `asegurarVigente()`, que
// además reintenta si el cálculo había fallado. Gatear el botón dejaba la pantalla
// trabada tras un fallo de red —botón gris, sin mensaje, y la única salida era
// adivinar que había que mover una cantidad—. Misma decisión que el POS.
const habilitarPago = computed(() => props.lineas.length > 0 && !props.loadingCalculo && !props.sinPermiso)

// Una fila en $0 no informa y agranda el panel (09.17): solo se dibuja lo que mueve el total.
const hayDescuentos = computed(() => !!props.resultado && !new Decimal(props.resultado.totales.totalDescuentos).isZero())
const hayRecargos = computed(() => !!props.resultado && !new Decimal(props.resultado.totales.totalRecargos).isZero())

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
        Agrega ítems desde el catálogo.
      </div>
      <ul v-else class="divide-y divide-default">
        <li v-for="(linea, index) in lineas" :key="`${linea.item.id}-${index}`" class="py-2 flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-default break-words">{{ linea.item.nombre }}</p>
            <p class="text-xs text-muted">
              {{ formatMonto(convertirAMonedaOficial(linea.item.precioBase, linea.item.monedaId)) }} c/u · {{ unidadBaseItem(linea.item) }}
            </p>
            <AdvertenciasPrecio :advertencias="calculoVigente?.lineas[index]?.advertencias ?? []" />
            <PromocionesAplicadas :promociones="calculoVigente?.lineas[index]?.trazas.promociones ?? []" />
          </div>
          <AppCantidadInput
            :model-value="presentacionLinea(linea)"
            :unidad-codigo="unidadPresLinea(linea)"
            :unidad-base-codigo="unidadBaseItem(linea.item)"
            @change="emit('cambiar-cantidad', index, $event)"
          />
          <UButton
            :aria-label="`Quitar ${linea.item.nombre}`"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xl"
            class="ms-2 size-11 justify-center"
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
          <div v-if="hayDescuentos" class="flex justify-between text-muted">
            <span>Descuentos</span><span>-{{ formatMonto(resultado.totales.totalDescuentos) }}</span>
          </div>
          <div v-if="hayRecargos" class="flex justify-between text-muted">
            <span>Recargos</span><span>+{{ formatMonto(resultado.totales.totalRecargos) }}</span>
          </div>
          <div class="flex justify-between text-muted">
            <span>Impuestos</span><span>+{{ formatMonto(resultado.totales.totalImpuestos) }}</span>
          </div>
          <AdvertenciasPrecio :advertencias="calculoVigente?.advertenciasVenta ?? []" class="mb-1" />
          <div
            data-qa="carrito-total"
            class="flex justify-between items-center font-semibold text-default text-xl pt-2 border-t border-default transition-opacity"
            :class="{ 'opacity-50': loadingCalculo }"
          >
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
          size="xl"
          class="min-h-11"
          :loading="pagando"
          :disabled="!habilitarPago"
          @click="emit('pagar')"
        />
        <p v-if="sinPermiso" class="text-sm text-muted text-center">
          Tu rol no puede comprar en la tienda. Pídele el permiso a quien administra el local.
        </p>
      </div>
    </template>
  </UCard>
</template>
