<script setup lang="ts">
const props = defineProps<{
  ventaId: string
  /**
   * La venta vino de una cuenta de salón con al menos una línea ya enviada a
   * cocina (lo calcula el backend en `GET /ventas/:id`). Es lo que decide el
   * DEFAULT del checkbox de reposición, no un bloqueo: el cajero lo tilda igual
   * si la mercadería sigue vendible.
   */
  tieneLineasDespachadas: boolean
}>()

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
/**
 * Nace DESTILDADO si alguna línea ya se despachó (decisión del owner
 * 2026-08-15, caso mixto resuelto el 2026-08-23): reponer comida que la cocina
 * ya hizo mete al stock ingredientes que físicamente no existen, y eso es peor
 * que no reponer. Uno solo para toda la venta: basta con que ALGUNA línea haya
 * salido.
 */
const reponerStock = ref(!props.tieneLineasDespachadas)
const submitting = ref(false)

const MOTIVO_MIN = 10

watch(open, (v) => {
  if (!v) return
  motivo.value = ''
  reponerStock.value = !props.tieneLineasDespachadas
})

const motivoValido = computed(() => motivo.value.trim().length >= MOTIVO_MIN)

const ayudaReposicion = computed(() =>
  props.tieneLineasDespachadas
    ? 'Hay platos ya enviados a cocina: eso no vuelve al inventario. Tildalo solo si la mercadería sigue vendible.'
    : 'Desmarcalo solo si la mercadería ya no está vendible: el descuento queda como pérdida.',
)

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
          :description="ayudaReposicion"
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
