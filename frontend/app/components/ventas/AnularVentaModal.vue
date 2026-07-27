<script setup lang="ts">
const props = defineProps<{ ventaId: string }>()

export interface AnularVentaSuccessPayload {
  id: string
  estado: string
  stockRepuesto: boolean
  motivo: string
}

const emit = defineEmits<{ success: [AnularVentaSuccessPayload] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const motivo = ref('')
const reponerStock = ref(true)
const submitting = ref(false)

const MOTIVO_MIN = 10

watch(open, (v) => {
  if (!v) return
  motivo.value = ''
  reponerStock.value = true
})

const motivoValido = computed(() => motivo.value.trim().length >= MOTIVO_MIN)

async function confirmar() {
  submitting.value = true
  try {
    const res = await useApiFetch<AnularVentaSuccessPayload>(
      `${apiUrl}/ventas/${props.ventaId}/anular`,
      {
        method: 'POST',
        body: { motivo: motivo.value.trim(), reponerStock: reponerStock.value },
      },
    )
    toast.add({
      title: res.stockRepuesto
        ? 'Venta anulada y stock repuesto'
        : 'Venta anulada sin reponer stock',
      color: 'success',
    })
    open.value = false
    emit('success', res)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al anular la venta'), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Anular venta" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
          La anulación deshace la venta por completo. Solo aplica a ventas
          pendientes sin pagos ni documento tributario: una venta cobrada o ya
          documentada se revierte con una nota de crédito.
        </p>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-muted">Motivo</span>
          <UTextarea
            v-model="motivo"
            :rows="3"
            placeholder="Por qué se anula esta venta"
          />
          <p v-if="motivo && !motivoValido" class="text-xs text-error">
            Contá el motivo con al menos {{ MOTIVO_MIN }} caracteres: queda como
            registro de auditoría.
          </p>
        </div>

        <UCheckbox
          v-model="reponerStock"
          label="Reponer el stock que la venta descontó"
          help="Desmarcalo solo si la mercadería ya no está vendible: el descuento queda como pérdida."
        />
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="() => { open = false }"
        />
        <UButton
          label="Anular venta"
          color="error"
          :loading="submitting"
          :disabled="!motivoValido"
          @click="confirmar"
        />
      </div>
    </template>
  </UModal>
</template>
