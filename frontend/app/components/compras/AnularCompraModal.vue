<script setup lang="ts">
import type { CompraDetalle, LineaCompra } from '~/composables/useCompras'

/**
 * Anular una compra confirmada (spec § 4.5). Frena y dice cuánto sale y de
 * dónde, en vez de avisar al pasar: saca del stock todo lo que entró y cambia
 * el costo (memoria "confirmación explícita sobre aviso pasivo"). Pide motivo,
 * que queda en la compra.
 */
const props = defineProps<{
  compraId: string
  ubicacionNombre: string | null
  lineas: LineaCompra[]
}>()

const emit = defineEmits<{ success: [CompraDetalle] }>()
const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { cantidadConUnidad } = useCompras()

const motivo = ref('')
const enviando = ref(false)

watch(open, (v) => {
  if (v) motivo.value = ''
})

const motivoValido = computed(() => motivo.value.trim().length > 0)

async function enviar() {
  if (!motivoValido.value || enviando.value) return
  enviando.value = true
  try {
    const res = await useApiFetch<CompraDetalle>(
      `${apiUrl}/compras/${props.compraId}/anular`,
      { method: 'POST', body: { motivo: motivo.value.trim() } },
    )
    toast.add({ title: 'Compra anulada: la mercadería salió del stock', color: 'success' })
    open.value = false
    emit('success', res)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al anular la compra'), color: 'error' })
  }
  finally {
    enviando.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="¿Anular esta compra?" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4" data-qa="anular-compra">
        <div class="text-sm text-default" data-qa="anular-compra-resumen">
          <p>
            Sale de <strong>{{ ubicacionNombre || 'la ubicación de la compra' }}</strong> todo lo que entró:
          </p>
          <ul class="mt-1 list-disc pl-5">
            <li v-for="l in lineas" :key="l.id">
              {{ cantidadConUnidad(l.cantidad, l.unidadCodigo) }} de {{ l.itemNombre || '—' }}
            </li>
          </ul>
        </div>
        <p class="text-sm text-muted">
          El costo de cada producto se recalcula como si esta compra no hubiera existido. Si algo ya se vendió y no alcanza,
          no se anula nada. La compra queda a la vista, tachada, y su folio se libera.
        </p>
        <UFormField label="Motivo" required>
          <UTextarea
            v-model="motivo"
            :rows="3"
            :maxlength="500"
            placeholder="Por qué se anula esta compra"
            class="w-full"
            data-qa="anular-compra-motivo"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          label="Anular compra"
          color="error"
          :loading="enviando"
          :disabled="!motivoValido"
          data-qa="anular-compra-si"
          @click="enviar"
        />
      </div>
    </template>
  </UModal>
</template>
