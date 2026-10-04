<script setup lang="ts">
import Decimal from 'decimal.js'
import type { CriterioRedondeoCongelado, DestinoStock, DetalleVentaDevolucion } from '~/composables/useDevolucionInventario'
import { idDeOtrosDatos } from '~/composables/useIntentoCobro'
import { problemaDelReceptorDeNota } from '~/composables/useReceptor'
import {
  avisoNotaRepetida,
  avisoSinConfirmar,
  claveOpcion,
  cuerpoDevolucion,
  registroQueQueda,
  topeDeOpcion,
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
  /**
   * El cliente de la venta: la nota va a su nombre (el servidor copia el suyo).
   * `null` si la venta no tiene: ahí se ofrece capturar nombre y RUT.
   */
  cliente: { nombre: string, rut?: string | null } | null
  /** El receptor de la última nota de esta venta que lo capturó: se precarga, editable. */
  receptorSugerido: { nombre: string, rut: string | null } | null
  /** El RUT capturado se valida con DV módulo 11 (lo dice el backend, por el país). */
  rutChileno: boolean
}>()
export interface NotaCreditoSuccessPayload {
  id: string
  totalFinal: string
  movimientoCajaId: string | null
  fecha: string
  comentario: string | null
  devoluciones: Array<{ itemId: string, cantidad: string, stock?: DestinoStock }>
  /** La nota ya había entrado y el backend la reprodujo (ADR-026). */
  repetida?: boolean
}

const emit = defineEmits<{
  success: [NotaCreditoSuccessPayload]
  /** La clave ya emitió otra nota con otros datos: el detalle tiene que recargarse. */
  otrosDatos: []
}>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const intento = useIntentoCobro()
const cajaStore = useCajaStore()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const monto = ref('')
const comentario = ref('')
/** La clave de la opción elegida (`claveOpcion`); `undefined` hasta que se elige. */
const seleccion = ref<string | undefined>(undefined)
const submitting = ref(false)
const receptorNombre = ref('')
const receptorRut = ref('')
const { filas, cargarDesdeDetalles, setCantidad, setStock, filasValidas, faltaDestino, devoluciones }
  = useDevolucionInventario()

const opcionElegida = computed(() =>
  props.opciones.find(o => claveOpcion(o) === seleccion.value) ?? null,
)

/**
 * Lo máximo que se puede acreditar: lo disponible de la venta, y —con una forma
 * de devolver elegida— lo que esa forma admite (lo que su pago todavía puede
 * devolver). Es el mismo tope que exige el servidor.
 */
const tope = computed(() => topeDeOpcion(props.disponible, opcionElegida.value))

watch(open, (v) => {
  if (!v) return
  comentario.value = ''
  receptorNombre.value = props.receptorSugerido?.nombre ?? ''
  receptorRut.value = props.receptorSugerido?.rut ?? ''
  // Con una sola forma de devolver no hay nada que elegir; con varias, el
  // cajero elige: un default movería plata de la caja sin que lo decida.
  seleccion.value = props.opciones.length === 1 ? claveOpcion(props.opciones[0]!) : undefined
  monto.value = tope.value
  cargarDesdeDetalles(props.detalles)
  // Habilita/deshabilita las opciones que sacan plata de la caja
  cajaStore.cargarActiva()
})

// Al elegir una forma de devolver, el monto propuesto pasa a ser lo que ella admite:
// "devolver todo por la tarjeta" no puede proponer más que lo que la tarjeta trajo.
watch(seleccion, () => {
  if (open.value) monto.value = tope.value
})

const tieneCaja = computed(() => !!cajaStore.activa)

/** Una opción en efectivo sin caja física abierta no se puede elegir. */
const itemsOpciones = computed(() =>
  props.opciones.map((o) => {
    const sinCaja = o.mueveCaja && !tieneCaja.value
    const caja = sinCaja
      ? 'Necesitás una caja física abierta para devolver efectivo.'
      : o.mueveCaja
        ? 'La plata sale de tu caja física abierta.'
        : null
    // Por qué ofrece menos de lo que el pago cubrió (decisión del owner, 2026-10-04).
    const sinConfirmar = avisoSinConfirmar(o, formatMonto)
    return {
      value: claveOpcion(o),
      label: o.sinPlata
        ? `No vuelve plata · ${formatMonto(o.monto)} por cobrar`
        : `${o.metodo ?? 'Pago'} · ${formatMonto(o.monto)}`,
      description: [caja, sinConfirmar].filter(Boolean).join(' ') || undefined,
      disabled: sinCaja,
    }
  }),
)

const montoValido = computed(() => {
  const m = new Decimal(monto.value || '0')
  return m.gt(0) && m.lte(new Decimal(tope.value))
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

/**
 * Se pide el receptor solo para un documento tributario: la devolución interna
 * no lo es, y el owner decidió la captura para la nota de crédito (2026-10-04).
 */
const pideReceptor = computed(() =>
  !props.cliente && opcionElegida.value?.registro !== 'devolucion_interna',
)
const problemaReceptor = computed(() =>
  !pideReceptor.value
    ? null
    : problemaDelReceptorDeNota({ nombre: receptorNombre.value, rut: receptorRut.value }, props.rutChileno),
)
const receptorVacio = computed(() => !receptorNombre.value.trim() && !receptorRut.value.trim())

const puedeConfirmar = computed(() =>
  montoValido.value && filasValidas.value && !faltaDestino.value
  && opcionDisponible.value && !problemaReceptor.value,
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

/**
 * Una nota por intento de emisión (ADR-026, owner 2026-10-03): el intento vive
 * por venta y por pestaña —cerrar y reabrir el modal después de un corte sigue
 * siendo el mismo— y muere con el éxito (también reproducido) o con el aviso de
 * otros datos.
 */
const ambito = computed(() => `nc:${props.ventaId}`)

async function confirmar() {
  submitting.value = true
  try {
    const body: Record<string, unknown> = { monto: monto.value }
    if (comentario.value.trim()) body.comentario = comentario.value.trim()
    // Por dónde vuelve la plata: el servidor resuelve qué documento corrige.
    body.devolucion = cuerpoDevolucion(opcionElegida.value!)
    if (devoluciones.value.length) body.devoluciones = devoluciones.value
    // Con cliente en la venta, la nota lleva el suyo: no se manda nada.
    if (pideReceptor.value && !receptorVacio.value)
      body.receptor = { nombre: receptorNombre.value.trim(), rut: receptorRut.value.trim() }

    const res = await useApiFetch<NotaCreditoSuccessPayload>(
      `${apiUrl}/ventas/${props.ventaId}/notas-credito`,
      { method: 'POST', body, headers: intento.cabecera(ambito.value) },
    )
    intento.terminar(ambito.value)

    if (res.movimientoCajaId) {
      // Reproducida, no se sabe si el resumen ya la trae (pudo recargarse
      // después del corte): se pide al servidor en vez de sumarla de nuevo.
      if (res.repetida && cajaStore.activa && cajaStore.resumenTurno)
        void cajaStore.cargarResumenTurno(cajaStore.activa.id).catch(() => {})
      else if (!res.repetida)
        cajaStore.aplicarMovimientoLocal('salida', res.totalFinal)
    }

    toast.add({
      title: res.movimientoCajaId
        ? 'Nota de crédito generada con devolución de dinero'
        : 'Nota de crédito generada',
      color: 'success',
    })
    if (res.repetida)
      toast.add({
        title: avisoNotaRepetida(opcionElegida.value, formatMonto(res.totalFinal)),
        color: 'warning',
      })
    open.value = false
    emit('success', res)
  }
  catch (e: unknown) {
    if (idDeOtrosDatos(e)) {
      // Otra nota ya entró con esta clave (el cajero cambió algo después de un
      // corte): se frena, y el detalle recargado muestra la que entró y el
      // disponible nuevo. Otra nota es un intento nuevo, reabriendo el modal.
      intento.terminar(ambito.value)
      toast.add({ title: apiErrorMsg(e, 'Esta nota de crédito ya se había emitido con otros datos'), color: 'error' })
      open.value = false
      emit('otrosDatos')
      return
    }
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
            El monto debe ser mayor a 0 y no superar el disponible ni lo que esa forma de devolver admite.
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

        <USeparator />

        <div class="flex flex-col gap-2" data-qa="receptor-nota">
          <p v-if="cliente" class="text-sm text-muted">
            La nota va a nombre del cliente de la venta:
            <span class="font-medium text-default">{{ cliente.nombre }}</span>
            <span v-if="cliente.rut"> ({{ cliente.rut }})</span>
          </p>
          <template v-else-if="pideReceptor">
            <span class="text-sm text-muted">Datos del cliente (opcional)</span>
            <UInput v-model="receptorNombre" placeholder="Nombre o razón social" data-qa="receptor-nombre" />
            <UInput v-model="receptorRut" placeholder="RUT" data-qa="receptor-rut" />
            <p v-if="problemaReceptor" class="text-xs text-error">
              {{ problemaReceptor }}
            </p>
            <p v-else-if="receptorVacio" class="text-xs text-muted">
              Sin datos del cliente, la nota va a nombre del local.
            </p>
          </template>
        </div>

        <DevolucionInventarioLista
          :filas="filas"
          :valida="filasValidas"
          :falta-destino="faltaDestino"
          @set-cantidad="setCantidad"
          @set-stock="setStock"
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
