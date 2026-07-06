<script setup lang="ts">
import Decimal from 'decimal.js'
import { resumenCobro, setMontoPago, sumaPagos, type PagoInput } from '~/composables/useVenta'

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

// El cajero no saca cuentas ("500 en efectivo y el resto en tarjeta"): al
// escribir un monto, los demás pagos absorben el excedente vía setMontoPago,
// y el pago nuevo se prellena con el restante. La regla de sobrepago sin
// vuelto se valida al confirmar.
function setMonto(i: number, monto: string) {
  pagos.value = setMontoPago(props.total, pagos.value, i, monto)
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
    props.total,
    pagos.value,
    props.metodos.map((m) => ({ metodoPagoId: m.metodoPagoId, permiteVuelto: m.permiteVuelto })),
  ),
)
const suma = computed(() => sumaPagos(pagos.value))

const { formatMonto } = useFormatters()

// Los pagos absorbidos a $0 por setMontoPago no se registran en el ledger.
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
        <div class="flex justify-between text-base font-semibold">
          <span>Total a pagar</span><span>{{ formatMonto(total) }}</span>
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
