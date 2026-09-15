<script setup lang="ts">
import Decimal from 'decimal.js'
import type { CriterioRedondeoCongelado, DetalleVentaDevolucion } from '~/composables/useDevolucionInventario'

const props = defineProps<{
  ventaId: string
  /** `disponibleNotaCredito.total` del backend: el tope que la emisión exige. */
  disponible: string
  /**
   * El remanente por porción fiscal, del backend. Se muestra porque es lo que
   * decide si una devolución entra: la serie de notas no puede acreditar más
   * IVA del que la venta cobró, y sin este número el operador descubre el tope
   * apretando Confirmar.
   */
  porPorcion: { clasificacion: string, monto: string }[]
  detalles: DetalleVentaDevolucion[]
  /**
   * El criterio de redondeo CONGELADO de la venta (`venta.configCalculo`),
   * `null` en ventas anteriores al congelado. Es lo que permite cuantizar el
   * umbral del motivo como el backend — ver `valorDevueltoCuantizado`.
   */
  configCalculo: CriterioRedondeoCongelado | null
}>()
export interface NotaCreditoSuccessPayload {
  id: string
  totalFinal: string
  movimientoCajaId: string | null
  fecha: string
  comentario: string | null
  devoluciones: Array<{ itemId: string, cantidad: string, reponerStock: boolean }>
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
const { filas, cargarDesdeDetalles, setCantidad, setReponer, filasValidas, devoluciones }
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

// ⚠️ El botón NO se deshabilita por nada de plata más allá del disponible, que
// lo dice el backend. "La mercadería vale más que la nota" dejó de ser un
// rechazo el 2026-09-04 —las líneas se escalan— y lo que el backend exige a
// cambio, el motivo, este modal lo PIDE (abajo) sin bloquear: el único guard
// sigue siendo el backend, aunque el umbral de abajo ya sea un gemelo exacto.
const puedeConfirmar = computed(() => montoValido.value && filasValidas.value)

// Solo si hay más de una: en una venta toda afecta, repetir el total al lado
// del total es ruido.
const mostrarPorPorcion = computed(() => props.porPorcion.length > 1)

/**
 * El backend exige el motivo cuando la nota acredita MENOS de lo que vale la
 * mercadería marcada (`seEscalo = monto < valorDevuelto` en
 * `ventas.service.ts:1554`): es lo único que va a explicar, en el documento,
 * por qué.
 *
 * `valorDevueltoCuantizado` es ahora un gemelo exacto de esa valuación —divide
 * y cuantiza cada línea en el mismo orden que `ventas.service.ts`, con el criterio CONGELADO de esta
 * venta—, así que la comparación es la MISMA del backend, `>` estricto y no
 * `≥`: el empate ya no necesita margen. Se PIDE, nunca se bloquea: el único
 * guard sigue siendo el backend.
 */
const valorDevuelto = computed(() =>
  valorDevueltoCuantizado(props.detalles, filas.value, props.configCalculo),
)
const motivoRequerido = computed(() =>
  new Decimal(valorDevuelto.value).gt(new Decimal(monto.value || '0')),
)

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
        <div class="flex flex-col gap-1">
          <div class="flex justify-between text-sm text-muted">
            <span>Disponible para nota de crédito</span>
            <span class="font-mono">{{ formatMonto(disponible) }}</span>
          </div>
          <div
            v-for="p in mostrarPorPorcion ? porPorcion : []"
            :key="p.clasificacion"
            class="flex justify-between pl-3 text-xs text-dimmed"
          >
            <span class="capitalize">{{ p.clasificacion }}</span>
            <span class="font-mono">{{ formatMonto(p.monto) }}</span>
          </div>
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
          <span class="text-sm text-muted">
            {{ motivoRequerido ? 'Motivo' : 'Comentario (opcional)' }}
          </span>
          <UInput v-model="comentario" placeholder="Motivo de la devolución" />
          <p v-if="motivoRequerido" class="text-xs text-muted">
            La nota acredita menos de lo que vale la mercadería marcada: el motivo
            queda escrito en el documento, al lado de cada línea.
          </p>
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
          modo="acredita"
          @set-cantidad="setCantidad"
          @set-reponer="setReponer"
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
