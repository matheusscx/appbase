<script setup lang="ts">
import Decimal from 'decimal.js'
import type { PagoProveedorInfo } from '~/composables/useCompras'

/**
 * Anular un pago a proveedor (auditoría UX 06.6; spec compras-deuda-proveedor
 * § 5.2, § 10 y decisión 6): cualquier pago vigente, con motivo, diciendo qué
 * va a pasar. Efectos: las compras que cubría vuelven a deber; en efectivo con
 * la caja todavía abierta la plata vuelve a esa caja (y solo su dueño puede
 * anular); con la caja cerrada no se toca ninguna caja.
 */
const props = defineProps<{
  pago: PagoProveedorInfo
  proveedorNombre: string
  /** Quien anula: la caja abierta de otro no se puede anular (decisión 6). */
  usuarioId: string | null
}>()

const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const { efectoAnularPago } = useCompras()

const efecto = computed(() => efectoAnularPago(props.pago, props.usuarioId))
/** La caja sigue abierta y es de otra persona: el backend contesta 403, así que ni se ofrece. */
const bloqueado = computed(() => efecto.value.caja === 'ajena')

const motivo = ref('')
const enviando = ref(false)

watch(open, (v) => {
  if (v) motivo.value = ''
})

const motivoValido = computed(() => motivo.value.trim().length > 0 && !bloqueado.value)

async function enviar() {
  if (!motivoValido.value || enviando.value || !props.pago.id) return
  enviando.value = true
  try {
    await useApiFetch(`${apiUrl}/compras/pagos/${props.pago.id}/anular`, {
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
          {{ formatMonto(pago.monto) }} a <strong>{{ proveedorNombre }}</strong><template v-if="pago.fecha"> del {{ formatFecha(pago.fecha) }}</template><template v-if="pago.metodoPagoNombre"> ({{ pago.metodoPagoNombre }})</template>.
        </p>
        <ul class="list-disc space-y-1 pl-5 text-sm text-default" data-qa="anular-pago-efectos">
          <li v-if="efecto.compras > 0" data-qa="anular-pago-efecto-deuda">
            {{ efecto.compras === 1 ? '1 compra vuelve' : `${efecto.compras} compras vuelven` }} a deber {{ formatMonto(efecto.deudaVuelve) }}.
          </li>
          <li v-if="new Decimal(efecto.aFavorPerdido).gt(0)" data-qa="anular-pago-efecto-favor">
            Se pierde el saldo a favor de {{ formatMonto(efecto.aFavorPerdido) }} que dejó este pago.
          </li>
          <li v-if="efecto.compras === 0 && new Decimal(efecto.aFavorPerdido).lte(0)">
            No cubría ninguna compra.
          </li>
          <li v-if="efecto.caja === 'vuelve'" data-qa="anular-pago-efecto-caja">
            {{ formatMonto(pago.monto) }} vuelven a tu caja abierta.
          </li>
          <li v-else-if="efecto.caja === 'sin_caja'" data-qa="anular-pago-efecto-caja">
            No se mueve ninguna caja: el pago no fue en efectivo.
          </li>
        </ul>
        <UAlert
          v-if="efecto.caja === 'cerrada'"
          color="warning"
          variant="subtle"
          icon="i-lucide-info"
          title="La caja de este pago ya está cerrada"
          description="No vuelve plata a ninguna caja: el cierre queda como quedó. Si el proveedor devuelve la plata, se anota como entrada manual en la caja de quien la recibe."
          data-qa="anular-pago-aviso-caja"
        />
        <UAlert
          v-else-if="efecto.caja === 'ajena'"
          color="error"
          variant="subtle"
          icon="i-lucide-lock"
          title="Este pago salió de la caja abierta de otra persona"
          description="Solo su dueño puede anularlo, mientras esa caja siga abierta."
          data-qa="anular-pago-aviso-ajena"
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
