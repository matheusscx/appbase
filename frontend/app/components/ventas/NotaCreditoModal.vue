<script setup lang="ts">
import Decimal from 'decimal.js'
import type { DetalleVentaDevolucion } from '~/composables/useDevolucionInventario'

const props = defineProps<{
  ventaId: string
  /** total_final − Σ NCs previas (lo calcula el drawer) */
  disponible: string
  detalles: DetalleVentaDevolucion[]
}>()
export interface NotaCreditoSuccessPayload {
  id: string
  totalFinal: string
  movimientoCajaId: string | null
  fecha: string
  comentario: string | null
  devoluciones: Array<{ itemId: string, cantidad: string }>
}

const emit = defineEmits<{ success: [NotaCreditoSuccessPayload] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const cajaStore = useCajaStore()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const monto = ref('')
const comentario = ref('')
const devolverDinero = ref(false)
const submitting = ref(false)
const { filas, cargarDesdeDetalles, setCantidad, filasValidas, devoluciones }
  = useDevolucionInventario()

watch(open, (v) => {
  if (!v) return
  monto.value = props.disponible
  comentario.value = ''
  devolverDinero.value = false
  cargarDesdeDetalles(props.detalles)
  // Habilita/deshabilita el checkbox de devolución de dinero
  cajaStore.cargarActiva()
})

const tieneCaja = computed(() => !!cajaStore.activa)

const montoValido = computed(() => {
  const m = new Decimal(monto.value || '0')
  return m.gt(0) && m.lte(new Decimal(props.disponible))
})

// ⚠️ NO hay pre-chequeo de "la mercadería vale más que la nota". El backend lo
// rechaza con 400 desde el 2026-09-04 y el mensaje trae los dos números y las
// dos salidas, así que el operador lo ve; anticiparlo acá exige valuar cada
// línea a `Σ total_linea / Σ cantidad` **y cuantizarla a la escala de la
// moneda con el `modo_redondeo` congelado de esa venta**, que es replicar el
// cuantizador del motor en el navegador. Se intentó sin cuantizar y quedaba
// peor que no tenerlo: con 3 unidades de 1.000, el modal deshabilitaba el botón
// para una nota que el backend acepta, mostrando "vale $333, más que los $333".
// Anotado en `pendientes.md` como frente propio.
const puedeConfirmar = computed(() => montoValido.value && filasValidas.value)

async function confirmar() {
  submitting.value = true
  try {
    const body: Record<string, unknown> = { monto: monto.value }
    if (comentario.value.trim()) body.comentario = comentario.value.trim()
    if (devolverDinero.value) body.devolverDinero = true
    if (devoluciones.value.length) body.devoluciones = devoluciones.value

    const res = await useApiFetch<NotaCreditoSuccessPayload>(
      `${apiUrl}/ventas/${props.ventaId}/notas-credito`,
      { method: 'POST', body },
    )

    if (res.movimientoCajaId) {
      cajaStore.aplicarMovimientoLocal('salida', res.totalFinal)
    }

    toast.add({
      title: res.movimientoCajaId
        ? 'Nota de crédito generada con devolución de dinero'
        : 'Nota de crédito generada',
      color: 'success',
    })
    open.value = false
    emit('success', res)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al generar la nota de crédito'), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Nota de crédito" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex justify-between text-sm text-muted">
          <span>Disponible para nota de crédito</span>
          <span class="font-mono">{{ formatMonto(disponible) }}</span>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-muted">Monto</span>
          <MoneyInput
            v-model="monto"
            oficial
          />
          <p v-if="!montoValido && monto" class="text-xs text-error">
            El monto debe ser mayor a 0 y no superar el disponible.
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-muted">Comentario (opcional)</span>
          <UInput v-model="comentario" placeholder="Motivo de la devolución" />
        </div>

        <USeparator />

        <UCheckbox
          v-model="devolverDinero"
          :disabled="!tieneCaja"
          label="Registrar devolución de dinero desde la caja"
          :description="tieneCaja
            ? 'Crea un movimiento de salida en tu caja física abierta por el monto de la NC.'
            : 'Necesitas una caja física abierta para devolver dinero.'"
        />

        <DevolucionInventarioLista
          :filas="filas"
          :valida="filasValidas"
          @set-cantidad="setCantidad"
        />
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          label="Generar nota de crédito"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
