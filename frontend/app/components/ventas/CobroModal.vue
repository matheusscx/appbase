<script setup lang="ts">
import Decimal from 'decimal.js'
import { resumenCobro, setMontoPago, sumaPagos, type PagoInput } from '~/composables/useVenta'
import { sugerirPropina } from '~/composables/usePropina'

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const props = withDefaults(
  defineProps<{
    /** Total a cobrar (POS). En modo propina se ignora: usa ventaTotal + propina. */
    total?: string
    metodos: MetodoPago[]
    submitting?: boolean
    /** Solo cierre de mesa: muestra desglose venta/propina. */
    modoPropina?: boolean
    /** Total de la venta (sin propina) cuando modoPropina. */
    ventaTotal?: string
  }>(),
  { modoPropina: false, total: '0', ventaTotal: '0' },
)

const emit = defineEmits<{ confirmar: [pagos: PagoInput[], vuelto: string] }>()
const open = defineModel<boolean>('open', { required: true })
const propinaMonto = defineModel<string>('propinaMonto', { default: '0' })

const pagos = ref<PagoInput[]>([])

const metodosHabilitados = computed(() => props.metodos.filter((m) => m.habilitada))
const metodoItems = computed(() =>
  metodosHabilitados.value.map((m) => ({ label: m.nombre, value: m.metodoPagoId })),
)

const totalAPagar = computed(() => {
  if (props.modoPropina) {
    return new Decimal(props.ventaTotal || '0')
      .plus(propinaMonto.value || '0')
      .toFixed(4)
  }
  return props.total || '0'
})

function resetPagos() {
  const def = metodosHabilitados.value[0]
  pagos.value = def
    ? [{ metodoPagoId: def.metodoPagoId, monto: totalAPagar.value }]
    : []
}

watch(open, (v) => {
  if (v) {
    if (props.modoPropina) {
      propinaMonto.value = sugerirPropina(props.ventaTotal || '0')
    }
    resetPagos()
  }
})

watch(propinaMonto, () => {
  if (open.value && props.modoPropina) resetPagos()
})

function setMonto(i: number, monto: string) {
  pagos.value = setMontoPago(totalAPagar.value, pagos.value, i, monto)
}
function agregarPago() {
  const def = metodosHabilitados.value[0]
  if (!def) return
  pagos.value = [...pagos.value, { metodoPagoId: def.metodoPagoId, monto: resumen.value.restante }]
}
function quitarPago(i: number) {
  pagos.value = pagos.value.filter((_, idx) => idx !== i)
}

const resumen = computed(() =>
  resumenCobro(
    totalAPagar.value,
    pagos.value,
    props.metodos.map((m) => ({ metodoPagoId: m.metodoPagoId, permiteVuelto: m.permiteVuelto })),
  ),
)
const suma = computed(() => sumaPagos(pagos.value))

const { formatMonto } = useFormatters()

const pagosValidos = computed(() =>
  pagos.value.filter((p) => new Decimal(p.monto || '0').gt(0)),
)

const puedeConfirmar = computed(
  () => pagosValidos.value.length > 0 && !resumen.value.excedenteSinVuelto,
)

function confirmar() {
  emit('confirmar', pagosValidos.value, resumen.value.vuelto)
}
</script>

<template>
  <UModal v-model:open="open" title="Cobrar venta" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div v-if="modoPropina" class="text-sm space-y-1">
          <div class="flex justify-between text-muted">
            <span>Total venta</span>
            <span>{{ formatMonto(ventaTotal || '0') }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-muted">Propina</span>
            <MoneyInput
              :model-value="propinaMonto"
              oficial
              class="w-32"
              size="sm"
              @update:model-value="propinaMonto = $event"
            />
          </div>
          <div class="flex justify-between text-base font-semibold border-t border-default pt-2">
            <span>Total a pagar</span>
            <span>{{ formatMonto(totalAPagar) }}</span>
          </div>
        </div>
        <div v-else class="flex justify-between text-base font-semibold">
          <span>Total a pagar</span>
          <span>{{ formatMonto(totalAPagar) }}</span>
        </div>

        <div class="flex flex-col gap-2">
          <div v-for="(pago, i) in pagos" :key="i" class="flex items-center gap-2">
            <USelectMenu
              v-model="pago.metodoPagoId"
              :items="metodoItems"
              value-key="value"
              label-key="label"
              class="flex-1"
            />
            <MoneyInput
              :model-value="pago.monto"
              oficial
              class="w-32"
              size="sm"
              @update:model-value="setMonto(i, $event)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              :disabled="pagos.length <= 1"
              @click="quitarPago(i)"
            />
          </div>
          <UButton
            label="Agregar pago"
            icon="i-lucide-plus"
            variant="ghost"
            size="sm"
            @click="agregarPago"
          />
        </div>

        <div class="text-sm space-y-1 border-t border-default pt-2">
          <div class="flex justify-between text-muted"><span>Pagado</span><span>{{ formatMonto(suma) }}</span></div>
          <div class="flex justify-between text-muted"><span>Restante</span><span>{{ formatMonto(resumen.restante) }}</span></div>
          <div class="flex justify-between font-medium text-default"><span>Vuelto</span><span>{{ formatMonto(resumen.vuelto) }}</span></div>
          <p v-if="resumen.excedenteSinVuelto" class="text-error text-xs">
            Los pagos con métodos sin vuelto superan el total: ese excedente no se puede devolver.
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          label="Confirmar venta"
          color="primary"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
