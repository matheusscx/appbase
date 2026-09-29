<script setup lang="ts">
import type { CompraDetalle, TotalDocumentoTipo } from '~/composables/useCompras'

/**
 * Corregir el total del documento o el vencimiento de una compra confirmada
 * (spec compras-deuda-proveedor § 6): corregir lo transcrito es lo mismo que
 * corregir un precio. `PATCH /compras/:id/documento`, permiso `Actualizar`.
 *
 * El campo "Total del documento" se muestra u oculta según el tipo, igual
 * que en la carga del borrador (`[id].vue`): en `suma_lineas` no hay nada
 * que transcribir, y el backend lo rechaza con 400 si viaja.
 */
const props = defineProps<{
  compraId: string
  totalDocumentoTipo: TotalDocumentoTipo
  totalDocumentoActual: string | null
  fechaVencimientoActual: string | null
}>()

const emit = defineEmits<{ success: [CompraDetalle] }>()
const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const { cuerpoActualizarDocumento } = useCompras()

const totalDocumento = ref('')
const fechaVencimiento = ref('')
const enviando = ref(false)

const totalDocumentoVisible = computed(() => props.totalDocumentoTipo !== 'suma_lineas')
const totalDocumentoOpcional = computed(() => props.totalDocumentoTipo === 'opcional')

watch(open, (v) => {
  if (!v) return
  totalDocumento.value = props.totalDocumentoActual ?? ''
  fechaVencimiento.value = props.fechaVencimientoActual ?? ''
})

const body = computed(() =>
  cuerpoActualizarDocumento(
    { totalDocumento: props.totalDocumentoActual, fechaVencimiento: props.fechaVencimientoActual },
    { totalDocumento: totalDocumento.value, fechaVencimiento: fechaVencimiento.value },
    totalDocumentoOpcional.value,
  ),
)

async function enviar() {
  if (!body.value || enviando.value) return
  enviando.value = true
  try {
    const res = await useApiFetch<CompraDetalle>(
      `${apiUrl}/compras/${props.compraId}/documento`,
      { method: 'PATCH', body: body.value },
    )
    toast.add({ title: 'Documento corregido', color: 'success' })
    open.value = false
    emit('success', res)
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al corregir el documento'), color: 'error' })
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Corregir total o vencimiento" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4" data-qa="corregir-documento">
        <UFormField
          v-if="totalDocumentoVisible"
          label="Total del documento"
          :help="`Actual: ${totalDocumentoActual != null ? formatMonto(totalDocumentoActual) : 'sin cargar'}`"
        >
          <MoneyInput v-model="totalDocumento" oficial class="w-full" data-qa="corregir-documento-total" />
        </UFormField>
        <UFormField
          label="Vence el"
          :help="`Actual: ${fechaVencimientoActual ? formatFecha(fechaVencimientoActual) : 'sin fijar'}`"
        >
          <UInput v-model="fechaVencimiento" type="date" class="w-full" data-qa="corregir-documento-vencimiento" />
        </UFormField>
        <p class="text-xs text-muted">
          Corregir el total transcrito ajusta la deuda con el proveedor y, si hay pagos de más, deja el
          sobrante a favor.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          label="Guardar"
          :loading="enviando"
          :disabled="!body"
          data-qa="corregir-documento-enviar"
          @click="enviar"
        />
      </div>
    </template>
  </UModal>
</template>
