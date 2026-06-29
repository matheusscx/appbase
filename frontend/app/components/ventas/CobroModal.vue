<script setup lang="ts">
import { resumenCobro, sumaPagos, type PagoInput } from '~/composables/useVenta'

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
  <UModal v-model:open="open" title="Cobrar venta">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex justify-between text-base font-semibold">
          <span>Total a pagar</span><span>{{ total }}</span>
        </div>

        <div class="flex flex-col gap-2">
          <div v-for="(pago, i) in pagos" :key="i" class="flex items-center gap-2">
            <USelect v-model="pago.metodoPagoId" :items="metodoItems" class="flex-1" />
            <UInput v-model="pago.monto" inputmode="decimal" placeholder="0" class="w-32" />
            <UButton
              icon="i-heroicons-trash"
              color="error"
              variant="ghost"
              size="xs"
              :disabled="pagos.length <= 1"
              @click="quitarPago(i)"
            />
          </div>
          <UButton
            label="Agregar pago"
            icon="i-heroicons-plus"
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
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          label="Confirmar venta"
          color="primary"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </div>
    </template>
  </UModal>
</template>
