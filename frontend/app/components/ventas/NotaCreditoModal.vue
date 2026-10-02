<script setup lang="ts">
import Decimal from 'decimal.js'
import type { CriterioRedondeoCongelado, DetalleVentaDevolucion } from '~/composables/useDevolucionInventario'
import {
  claveOpcion,
  cuerpoDevolucion,
  registroQueQueda,
  type OpcionDevolucion,
} from '~/composables/useDocumentosVenta'

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
  /**
   * "¿Por dónde vuelve la plata?", del backend (`opcionesDevolucion`): una por
   * pago que puede recibir la devolución y "No vuelve plata" solo si la venta
   * tiene saldo. Salen de la misma resolución que usa el servidor al crear la
   * nota, así que el registro que anuncian es el que va a quedar.
   */
  opciones: OpcionDevolucion[]
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
/** La clave de la opción elegida (`claveOpcion`); `undefined` hasta que se elige. */
const seleccion = ref<string | undefined>(undefined)
const submitting = ref(false)
const { filas, cargarDesdeDetalles, setCantidad, setReponer, filasValidas, devoluciones }
  = useDevolucionInventario()

watch(open, (v) => {
  if (!v) return
  monto.value = props.disponible
  comentario.value = ''
  // Con una sola forma de devolver no hay nada que elegir; con varias, el
  // cajero elige: un default movería plata de la caja sin que lo decida.
  seleccion.value = props.opciones.length === 1 ? claveOpcion(props.opciones[0]!) : undefined
  cargarDesdeDetalles(props.detalles)
  // Habilita/deshabilita las opciones que sacan plata de la caja
  cajaStore.cargarActiva()
})

const tieneCaja = computed(() => !!cajaStore.activa)

const opcionElegida = computed(() =>
  props.opciones.find(o => claveOpcion(o) === seleccion.value) ?? null,
)

/** Una opción en efectivo sin caja física abierta no se puede elegir. */
const itemsOpciones = computed(() =>
  props.opciones.map((o) => {
    const sinCaja = o.mueveCaja && !tieneCaja.value
    return {
      value: claveOpcion(o),
      label: o.sinPlata
        ? `No vuelve plata · ${formatMonto(o.monto)} por cobrar`
        : `${o.metodo ?? 'Pago'} · ${formatMonto(o.monto)}`,
      description: sinCaja
        ? 'Necesitás una caja física abierta para devolver efectivo.'
        : o.mueveCaja
          ? 'La plata sale de tu caja física abierta.'
          : undefined,
      disabled: sinCaja,
    }
  }),
)

const montoValido = computed(() => {
  const m = new Decimal(monto.value || '0')
  return m.gt(0) && m.lte(new Decimal(props.disponible))
})

// ⚠️ El botón NO se deshabilita por nada de plata más allá del disponible, que
// lo dice el backend. "La mercadería vale más que la nota" dejó de ser un
// rechazo el 2026-09-04 —las líneas se escalan— y lo que el backend exige a
// cambio, el motivo, este modal lo PIDE (abajo) sin bloquear: el único guard
// sigue siendo el backend, aunque el umbral de abajo ya sea un gemelo exacto.
// La opción elegida puede haber quedado bloqueada (venía elegida por ser la única
// y el efectivo necesita una caja que no hay): no se confirma sobre ella.
const opcionDisponible = computed(() => {
  const o = opcionElegida.value
  return o !== null && !(o.mueveCaja && !tieneCaja.value)
})

const puedeConfirmar = computed(() =>
  montoValido.value && filasValidas.value && opcionDisponible.value,
)

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
    // Por dónde vuelve la plata: el servidor resuelve qué documento corrige.
    body.devolucion = cuerpoDevolucion(opcionElegida.value!)
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

        <div class="flex flex-col gap-2" data-qa="por-donde-vuelve">
          <URadioGroup
            v-model="seleccion"
            legend="¿Por dónde vuelve la plata?"
            :items="itemsOpciones"
          />
          <p
            v-if="opcionElegida"
            class="text-xs text-muted"
            data-qa="registro-que-queda"
          >
            Va a quedar: {{ registroQueQueda(opcionElegida.registro) }}
          </p>
        </div>

        <DevolucionInventarioLista
          :filas="filas"
          :valida="filasValidas"
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
