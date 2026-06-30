<script setup lang="ts">
import Decimal from 'decimal.js'

const props = defineProps<{
  open: boolean
  cajaId: string
  saldoEsperado: Decimal
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const cajaStore = useCajaStore()
const toast = useToast()
const saving = ref(false)

const montoContado = ref('')
const comentario = ref('')

function cerrar() {
  emit('update:open', false)
}

function onAfterLeave() {
  montoContado.value = ''
  comentario.value = ''
}

const montoContadoFormateado = computed(() => {
  if (!montoContado.value) return '—'
  try {
    return formatMonto(montoContado.value)
  }
  catch {
    return montoContado.value
  }
})

const diferencia = computed(() => {
  if (!montoContado.value) return null
  try {
    return new Decimal(montoContado.value).minus(props.saldoEsperado)
  }
  catch {
    return null
  }
})

const { formatMonto } = useFormatters()

async function cerrarCaja() {
  if (!montoContado.value) {
    toast.add({ title: 'Ingresa el monto contado', color: 'warning' })
    return
  }
  saving.value = true
  try {
    await cajaStore.cerrar(props.cajaId, {
      montoContado: montoContado.value,
      comentario: comentario.value || undefined,
    })
    toast.add({ title: 'Caja cerrada correctamente', color: 'success' })
    cerrar()
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al cerrar la caja'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Cerrar caja"
    @update:open="emit('update:open', $event)"
    @after-leave="onAfterLeave"
  >
    <template #body>
      <div class="space-y-5">
        <!-- Cuadre previsto -->
        <div class="rounded-lg bg-gray-50 dark:bg-gray-800 p-4 space-y-2">
          <div class="flex justify-between text-sm">
            <span class="text-gray-500">Saldo esperado</span>
            <span class="font-medium">{{ formatMonto(saldoEsperado) }}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-gray-500">Monto contado</span>
            <span class="font-medium">
              {{ montoContadoFormateado }}
            </span>
          </div>
          <div class="border-t border-gray-200 dark:border-gray-700 pt-2 flex justify-between text-sm font-semibold">
            <span>Diferencia</span>
            <span
              v-if="diferencia !== null"
              :class="diferencia.gte(0) ? 'text-green-600' : 'text-red-600'"
            >
              {{ diferencia.gte(0) ? '+' : '' }}{{ formatMonto(diferencia) }}
            </span>
            <span v-else class="text-gray-400">—</span>
          </div>
        </div>

        <!-- Inputs -->
        <UFormField label="Monto contado en caja" required>
          <UInput
            v-model="montoContado"
            inputmode="decimal"
            placeholder="0.00"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Comentario de cierre">
          <UInput
            v-model="comentario"
            placeholder="Observaciones del cierre (opcional)"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="cerrar">
          Cancelar
        </UButton>
        <UButton
          color="error"
          icon="i-heroicons-lock-closed"
          :loading="saving"
          @click="cerrarCaja"
        >
          Confirmar cierre
        </UButton>
      </div>
    </template>
  </UModal>
</template>
