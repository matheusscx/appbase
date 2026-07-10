<script setup lang="ts">
import Decimal from 'decimal.js'

const props = defineProps<{
  ordenId: string
  disponible: string
}>()
const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const monto = ref('')
const submitting = ref(false)

watch(open, (v) => {
  if (v) monto.value = props.disponible
})

const puedeConfirmar = computed(() => {
  const m = new Decimal(monto.value || '0')
  return m.gt(0) && m.lte(new Decimal(props.disponible))
})

async function confirmar() {
  submitting.value = true
  try {
    await useApiFetch(`${apiUrl}/pasarela/admin/ordenes/${props.ordenId}/reembolsos`, {
      method: 'POST',
      body: { monto: monto.value },
    })
    toast.add({ title: 'Reembolso procesado', color: 'success' })
    open.value = false
    emit('success')
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al procesar el reembolso'), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Reembolsar orden" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex justify-between text-sm text-muted">
          <span>Disponible para reembolsar</span>
          <span class="font-mono">{{ formatMonto(disponible) }}</span>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-muted">Monto a reembolsar</span>
          <MoneyInput
            v-model="monto"
            oficial
          />
          <p v-if="!puedeConfirmar && monto" class="text-xs text-error">
            El monto debe ser mayor a 0 y no superar el disponible.
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          label="Confirmar reembolso"
          color="error"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
