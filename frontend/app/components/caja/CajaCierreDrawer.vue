<script setup lang="ts">
import Decimal from 'decimal.js'

const props = defineProps<{
  cajaId: string
  saldoEsperado: Decimal
}>()

const open = defineModel<boolean>('open', { required: true })

const cajaStore = useCajaStore()
const toast = useToast()
const saving = ref(false)

const montoContado = ref('')
const comentario = ref('')

watch(open, (isOpen) => {
  if (!isOpen) {
    montoContado.value = ''
    comentario.value = ''
  }
})

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
    open.value = false
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
  <AppDrawer v-model:open="open" width="md">
    <template #header>
      <span class="font-semibold text-default">Cerrar caja</span>
    </template>

    <template #body>
      <UForm id="caja-cierre-form" :state="{ montoContado, comentario }" class="space-y-5" @submit="cerrarCaja">
        <div class="rounded-lg bg-muted p-4 space-y-2">
          <div class="flex justify-between text-sm">
            <span class="text-muted">Saldo esperado</span>
            <span class="font-medium text-default">{{ formatMonto(saldoEsperado) }}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-muted">Monto contado</span>
            <span class="font-medium text-default">
              {{ montoContadoFormateado }}
            </span>
          </div>
          <div class="border-t border-default pt-2 flex justify-between text-sm font-semibold">
            <span class="text-default">Diferencia</span>
            <span
              v-if="diferencia !== null"
              :class="diferencia.gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
            >
              {{ diferencia.gte(0) ? '+' : '' }}{{ formatMonto(diferencia) }}
            </span>
            <span v-else class="text-muted">—</span>
          </div>
        </div>

        <UFormField label="Monto contado en caja" required>
          <UInput
            v-model="montoContado"
            inputmode="decimal"
            placeholder="0.00"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField label="Comentario de cierre">
          <UInput
            v-model="comentario"
            placeholder="Observaciones del cierre (opcional)"
            class="w-full"
          />
        </UFormField>
      </UForm>
    </template>

    <template #actions>
      <UButton color="neutral" variant="ghost" @click="open = false">
        Cancelar
      </UButton>
      <UButton
        type="submit"
        form="caja-cierre-form"
        color="error"
        icon="i-lucide-lock"
        :loading="saving"
      >
        Confirmar cierre
      </UButton>
    </template>
  </AppDrawer>
</template>
