<script setup lang="ts">
import type { CompraDetalle } from '~/composables/useCompras'

/**
 * El descuento al total de una compra confirmada (spec § 4.4): se reparte de
 * nuevo según el valor de cada línea y rehace el costo de cada producto que
 * cambió. Solo se abre con todas las líneas con precio; el backend lo exige
 * igual.
 */
const props = defineProps<{
  compraId: string
  descuentoActual: string | null
}>()

const emit = defineEmits<{ success: [CompraDetalle] }>()
const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const { cuerpoDescuento } = useCompras()

const descuento = ref('')
const enviando = ref(false)

watch(open, (v) => {
  if (!v) return
  descuento.value = props.descuentoActual ?? ''
})

const body = computed(() => cuerpoDescuento(props.descuentoActual, descuento.value))

async function enviar() {
  if (!body.value || enviando.value) return
  enviando.value = true
  try {
    const res = await useApiFetch<CompraDetalle>(
      `${apiUrl}/compras/${props.compraId}/descuento`,
      { method: 'PATCH', body: body.value },
    )
    toast.add({ title: 'Descuento corregido: el costo se recalculó', color: 'success' })
    open.value = false
    emit('success', res)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al corregir el descuento'), color: 'error' })
  }
  finally {
    enviando.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Descuento al total" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-3" data-qa="descuento-modal">
        <UFormField
          label="Descuento"
          :help="`Actual: ${descuentoActual != null ? formatMonto(descuentoActual) : 'sin descuento'}. Vacío lo quita.`"
        >
          <MoneyInput v-model="descuento" oficial class="w-full" data-qa="descuento-nuevo" />
        </UFormField>
        <p class="text-xs text-muted">
          Se reparte entre las líneas según su valor, y el costo de cada producto se recalcula desde esta compra.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          label="Guardar descuento"
          :loading="enviando"
          :disabled="!body"
          data-qa="descuento-enviar"
          @click="enviar"
        />
      </div>
    </template>
  </UModal>
</template>
