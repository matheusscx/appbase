<script setup lang="ts">
import type { DetalleVentaDevolucion, LineaDeclarada } from '~/composables/useDevolucionInventario'
import { idDeOtrosDatos } from '~/composables/useIntentoCobro'
import {
  AVISO_NOTA_REPETIDA,
  ambitoGenerarNota,
  notaYaLigada,
} from '~/composables/useReembolsoPasarela'

/**
 * "Generar nota" de un REFUND aprobado que quedó sin nota de crédito
 * (`docs/features/reembolsos-nota-credito.md`): el monto es el del REFUND —la
 * plata ya volvió por Transbank y no se vuelve a pedir— y las líneas vienen
 * precargadas con lo que declaró el reembolso, editables.
 */
const props = defineProps<{
  ordenId: string
  transaccionId: string
  monto: string
  ventaId: string
  /** Lo que pidió el reembolso (`metadata` del REFUND), o `null` si no lo guardó. */
  devoluciones: LineaDeclarada[] | null
}>()

const emit = defineEmits<{ success: [], recargar: [] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
// Una clave por REFUND y por pestaña: sobrevive a cerrar y reabrir el modal
// después de un corte, y el reintento no emite una segunda nota.
const intento = useIntentoCobro()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const cargandoVenta = ref(false)
const ventaNoCargo = ref(false)
const submitting = ref(false)
const {
  filas,
  cargarDesdeDetalles,
  limpiar,
  precargar,
  setCantidad,
  setStock,
  filasValidas,
  faltaDestino,
  devoluciones,
} = useDevolucionInventario()

async function cargarLineasVenta() {
  cargandoVenta.value = true
  ventaNoCargo.value = false
  try {
    const venta = await useApiFetch<{ detalles: DetalleVentaDevolucion[] }>(`${apiUrl}/ventas/${props.ventaId}`)
    cargarDesdeDetalles(venta.detalles)
    precargar(props.devoluciones)
  }
  catch (e: unknown) {
    // Sin las líneas no se confirma: la nota saldría sin lo que el reembolso
    // declaró que volvía.
    ventaNoCargo.value = true
    toast.add({ title: apiErrorMsg(e, 'No se pudieron cargar las líneas de la venta'), color: 'error' })
  }
  finally {
    cargandoVenta.value = false
  }
}

// `immediate`: el drawer lo monta ya abierto (`v-if` sobre el REFUND elegido),
// y sin esto no cargaba las líneas (lo cazó Playwright).
watch(open, (v) => {
  if (!v) return
  limpiar()
  cargarLineasVenta()
}, { immediate: true })

const puedeConfirmar = computed(() =>
  !cargandoVenta.value && !ventaNoCargo.value && filasValidas.value && !faltaDestino.value,
)

async function confirmar() {
  submitting.value = true
  const ambito = ambitoGenerarNota(props.transaccionId)
  try {
    const res = await useApiFetch<{ notaCreditoId: string, repetida?: boolean }>(
      `${apiUrl}/pasarela/admin/ordenes/${props.ordenId}/reembolsos/${props.transaccionId}/nota`,
      { method: 'POST', body: { devoluciones: devoluciones.value }, headers: intento.cabecera(ambito) },
    )
    // Salió o se reprodujo: el intento terminó.
    intento.terminar(ambito)
    toast.add(res.repetida
      ? { title: AVISO_NOTA_REPETIDA, color: 'warning' }
      : { title: 'Nota de crédito generada', color: 'success' })
    open.value = false
    emit('success')
  }
  catch (e: unknown) {
    if (idDeOtrosDatos(e) || notaYaLigada(e)) {
      // Ya hay una nota para este reembolso (este intento con otros datos, u
      // otra pestaña u otro admin): el aviso cierra el intento, el modal se
      // cierra y la orden se recarga con lo que entró.
      intento.terminar(ambito)
      toast.add({ title: apiErrorMsg(e, 'Este reembolso ya tiene su nota de crédito'), color: 'error' })
      open.value = false
      emit('recargar')
      return
    }
    // Cualquier otro error deja la clave viva: el clic siguiente es el mismo
    // intento y no emite dos notas.
    toast.add({ title: apiErrorMsg(e, 'No se pudo generar la nota de crédito'), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Generar nota de crédito" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
          La plata de este reembolso ya volvió por Transbank y no se devuelve de nuevo: esto solo emite la nota de crédito que corrige la venta.
        </p>
        <div class="flex justify-between text-sm">
          <span class="text-muted">Monto de la nota</span>
          <span class="font-mono font-medium">{{ formatMonto(monto) }}</span>
        </div>

        <USeparator />

        <DevolucionInventarioLista
          :filas="filas"
          :valida="filasValidas"
          :falta-destino="faltaDestino"
          :cargando="cargandoVenta"
          @set-cantidad="setCantidad"
          @set-stock="setStock"
        />
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          label="Generar nota"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
