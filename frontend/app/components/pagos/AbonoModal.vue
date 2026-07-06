<script setup lang="ts">
import Decimal from 'decimal.js'
import { resumenCobro, setMontoPago, sumaPagos, type PagoInput } from '~/composables/useVenta'

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const props = defineProps<{
  ventaId: string
  saldo: string
  metodos: MetodoPago[]
}>()
const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const pagos = ref<PagoInput[]>([])
const submitting = ref(false)

const metodosHabilitados = computed(() => props.metodos.filter((m) => m.habilitada))
const metodoItems = computed(() =>
  metodosHabilitados.value.map((m) => ({ label: m.nombre, value: m.metodoPagoId })),
)

watch(open, (v) => {
  if (v) {
    const def = metodosHabilitados.value[0]
    pagos.value = def
      ? [{ metodoPagoId: def.metodoPagoId, monto: props.saldo }]
      : []
  }
})

// El cajero no saca cuentas ("500 en efectivo y el resto en tarjeta"): al
// escribir un monto, los demás pagos absorben el excedente vía setMontoPago,
// y el pago nuevo se prellena con el restante. La regla de sobrepago sin
// vuelto se valida al confirmar.
function setMonto(i: number, monto: string) {
  pagos.value = setMontoPago(props.saldo, pagos.value, i, monto)
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
    props.saldo,
    pagos.value,
    props.metodos.map((m) => ({ metodoPagoId: m.metodoPagoId, permiteVuelto: m.permiteVuelto })),
  ),
)
const suma = computed(() => sumaPagos(pagos.value))

// Los pagos absorbidos a $0 por setMontoPago no se registran en el ledger.
const pagosValidos = computed(() =>
  pagos.value.filter((p) => new Decimal(p.monto || '0').gt(0)),
)

const puedeConfirmar = computed(
  () => pagosValidos.value.length > 0 && !resumen.value.excedenteSinVuelto,
)

async function confirmar() {
  submitting.value = true
  try {
    await useApiFetch(`${apiUrl}/pagos`, {
      method: 'POST',
      body: { ventaId: props.ventaId, pagos: pagosValidos.value },
    })
    toast.add({ title: 'Pago registrado', color: 'success' })
    open.value = false
    emit('success')
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al registrar pago', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Registrar pago" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex justify-between text-base font-semibold">
          <span>Saldo pendiente</span><span class="font-mono">{{ formatMonto(saldo) }}</span>
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
          <div class="flex justify-between text-muted">
            <span>Pagado</span><span class="font-mono">{{ formatMonto(suma) }}</span>
          </div>
          <div class="flex justify-between text-muted">
            <span>Restante</span><span class="font-mono">{{ formatMonto(resumen.restante) }}</span>
          </div>
          <div
            class="flex justify-between font-medium"
            :class="new Decimal(resumen.vuelto).gt(0) ? 'text-success' : 'text-default'"
          >
            <span>Vuelto</span><span class="font-mono">{{ formatMonto(resumen.vuelto) }}</span>
          </div>
          <p v-if="resumen.excedenteSinVuelto" class="text-error text-xs">
            Los pagos con métodos sin vuelto superan el saldo: ese excedente no se puede devolver.
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          label="Confirmar pago"
          color="primary"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
