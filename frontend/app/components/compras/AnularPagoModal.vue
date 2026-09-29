<script setup lang="ts">
/**
 * Anular un pago a proveedor (spec § 5.2 y § 10): con motivo. En efectivo
 * con la caja ya cerrada, anular no le devuelve plata a ninguna caja
 * (decisión 6) — la pantalla no sabe si la caja del día sigue abierta (mismo
 * límite que el aviso de "¿la pagaste ya?" en `[id].vue`: consultarlo pediría
 * un permiso de caja que quien paga puede no tener), así que el aviso es
 * genérico y siempre visible, no condicionado a un estado que no se puede
 * leer desde acá.
 */
const props = defineProps<{
  pagoId: string
  proveedorNombre: string
  monto: string
  fecha: string | null
}>()

const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()

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
    await useApiFetch(`${apiUrl}/compras/pagos/${props.pagoId}/anular`, {
      method: 'POST',
      body: { motivo: motivo.value.trim() },
    })
    toast.add({ title: 'Pago anulado: la deuda vuelve a la compra', color: 'success' })
    open.value = false
    emit('success')
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al anular el pago'), color: 'error' })
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="¿Anular este pago?" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4" data-qa="anular-pago">
        <p class="text-sm text-default" data-qa="anular-pago-resumen">
          {{ formatMonto(monto) }} a <strong>{{ proveedorNombre }}</strong><template v-if="fecha"> del {{ formatFecha(fecha) }}</template>.
          La deuda de las compras que cubría vuelve.
        </p>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-info"
          title="Si fue en efectivo y tu caja de ese día ya está cerrada"
          description="No vuelve plata a ninguna caja: el cierre queda como quedó. Si el proveedor devuelve la plata, se anota como entrada manual en la caja de quien la recibe."
          data-qa="anular-pago-aviso-caja"
        />
        <UFormField label="Motivo" required>
          <UTextarea
            v-model="motivo"
            :rows="3"
            :maxlength="500"
            placeholder="Por qué se anula este pago"
            class="w-full"
            data-qa="anular-pago-motivo"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          label="Anular pago"
          color="error"
          :loading="enviando"
          :disabled="!motivoValido"
          data-qa="anular-pago-si"
          @click="enviar"
        />
      </div>
    </template>
  </UModal>
</template>
