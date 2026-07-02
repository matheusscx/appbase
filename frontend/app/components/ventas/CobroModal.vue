<script setup lang="ts">
import { clampNoVuelto, resumenCobro, sumaPagos, type PagoInput } from '~/composables/useVenta'

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

// Un método sin vuelto (tarjeta, transferencia) no puede sobrepagar: recortamos
// su monto al total/restante en cuanto el cajero escribe o cambia de método.
const metodosVuelto = computed(() =>
  props.metodos.map((m) => ({ metodoPagoId: m.metodoPagoId, permiteVuelto: m.permiteVuelto })),
)
watch(
  pagos,
  (val) => {
    const clamped = clampNoVuelto(props.total, val, metodosVuelto.value)
    if (clamped !== val) pagos.value = clamped
  },
  { deep: true },
)

function agregarPago() {
  const def = metodosHabilitados.value[0]
  if (!def) return
  pagos.value = [...pagos.value, { metodoPagoId: def.metodoPagoId, monto: '0' }]
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

const puedeConfirmar = computed(
  () => pagos.value.length > 0 && !resumen.value.excedenteSinVuelto,
)

function confirmar() {
  emit('confirmar', pagos.value, resumen.value.vuelto)
}
</script>

<template>
  <UModal v-model:open="open" title="Cobrar venta" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex justify-between text-base font-semibold">
          <span>Total a pagar</span><span>{{ total }}</span>
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
            <UInput v-model="pago.monto" inputmode="decimal" placeholder="0" class="w-32" />
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
          <div class="flex justify-between text-muted"><span>Pagado</span><span>{{ suma }}</span></div>
          <div class="flex justify-between text-muted"><span>Restante</span><span>{{ resumen.restante }}</span></div>
          <div class="flex justify-between font-medium text-default"><span>Vuelto</span><span>{{ resumen.vuelto }}</span></div>
          <p v-if="resumen.excedenteSinVuelto" class="text-error text-xs">
            El pago excede el total pero ningún método permite vuelto.
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
