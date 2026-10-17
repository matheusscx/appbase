<script setup lang="ts">
import Decimal from 'decimal.js'
import { resumenCobro, setMontoPago, sumaPagos, type PagoInput } from '~/composables/useVenta'
import { porcentajeDecimalAHumano, sugerirPropina } from '~/composables/usePropina'
import { comprobanteDelPago, type EmisorMedio } from '~/composables/useDocumentosVenta'
import { LARGO_RECEPTOR, problemaDelReceptor, rutValido } from '~/composables/useReceptor'

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
  /** Quién emite lo cobrado con el medio; lo decide el comercio, no el cajero. */
  emisor: EmisorMedio
}

const props = withDefaults(
  defineProps<{
    /** Total a cobrar (POS). En modo propina se ignora: usa ventaTotal + propina. */
    total?: string
    metodos: MetodoPago[]
    submitting?: boolean
    /** Solo cierre de mesa: muestra desglose venta/propina. */
    modoPropina?: boolean
    /** Total de la venta (sin propina) cuando modoPropina. */
    ventaTotal?: string
    /** Decimal API, ej. '0.10'. Solo modoPropina. */
    porcentajeSugerido?: string
    /**
     * No se pudo leer la configuración de propina (01.19): el cobro va sin propina y
     * lo dice. Distinto de "apagada a propósito", que no avisa nada.
     */
    propinaNoDisponible?: boolean
    /**
     * La venta pasa el umbral de la Res. Ex. SII 44/2025: si algún pago es de la
     * máquina, avisa que el voucher no lleva a quien paga (owner, 2026-10-04:
     * se registra y se avisa).
     */
    sobreUmbralIdentidad?: boolean
    /**
     * Pide acá nombre y RUT de quien paga (salones, que no tiene formulario de
     * cliente). El POS no lo usa: su panel ya los pide.
     */
    pedirPagador?: boolean
    /** El RUT se valida con DV módulo 11 (`GET /tipos-documento`). */
    rutChileno?: boolean
    /**
     * El ámbito del intento de cobro (`useIntentoCobro`). Con él, un reintento tras
     * un corte reabre con la propina que se eligió en el primer intento: es lo que
     * mantiene igual lo que viaja (owner, 2026-10-17).
     */
    ambitoIntento?: string
  }>(),
  {
    modoPropina: false,
    total: '0',
    ventaTotal: '0',
    porcentajeSugerido: '0.10',
    propinaNoDisponible: false,
    sobreUmbralIdentidad: false,
    pedirPagador: false,
    rutChileno: false,
  },
)

const emit = defineEmits<{ confirmar: [pagos: PagoInput[], vuelto: string] }>()

// La sugerencia se redondea a la escala de la moneda oficial —la del país
// (ADR-005)—, que es la única noción de "oficial" del sistema desde el
// 2026-08-21. Antes acá había un `Math.min` de dos escalas que podían diferir:
// el backend validaba este monto contra `tenant_moneda.es_default` y el
// `MoneyInput` lo mostraba con la del país. Ese campo se eliminó, así que la
// defensa quedó sin caso que defender.
const monedas = useMonedasStore()
const decimalesPropina = computed(() => monedas.monedaOficial?.decimals ?? 0)
const open = defineModel<boolean>('open', { required: true })
const propinaMonto = defineModel<string>('propinaMonto', { default: '0' })
/** Quién paga, cuando `pedirPagador`. Lo lee la pantalla al confirmar. */
const pagador = defineModel<{ nombre: string, rut: string }>('pagador', {
  default: () => ({ nombre: '', rut: '' }),
})

const intento = useIntentoCobro()
const pagos = ref<PagoInput[]>([])

const metodosHabilitados = computed(() => props.metodos.filter((m) => m.habilitada))
const metodoItems = computed(() =>
  metodosHabilitados.value.map((m) => ({ label: m.nombre, value: m.metodoPagoId })),
)

const totalAPagar = computed(() => {
  if (props.modoPropina) {
    return new Decimal(props.ventaTotal || '0')
      .plus(propinaMonto.value || '0')
      .toFixed(4)
  }
  return props.total || '0'
})

/**
 * Los montos de los pagos siguen al total mientras la persona no los toque. En
 * cuanto teclea uno, agrega un pago o elige un billete, son suyos: cambiar la
 * propina después ya no los pisa (01.4) y el modal dice lo que falta o el vuelto.
 */
const montosEditados = ref(false)

function resetPagos() {
  const def = metodosHabilitados.value[0]
  pagos.value = def
    ? [{ metodoPagoId: def.metodoPagoId, monto: totalAPagar.value }]
    : []
  montosEditados.value = false
}

/** La propina se ofrece, no viene puesta (owner, 2026-10-16): 'sin' | 'sugerida' | 'otro'. */
const seleccionPropina = ref<'sin' | 'sugerida' | 'otro'>('sin')
const propinaSugeridaMonto = computed(() =>
  sugerirPropina(props.ventaTotal || '0', decimalesPropina.value, props.porcentajeSugerido || '0.10'),
)
const hayPropinaSugerida = computed(() => new Decimal(propinaSugeridaMonto.value).gt(0))
const porcentajeHumano = computed(() => porcentajeDecimalAHumano(props.porcentajeSugerido || '0.10'))

function elegirPropina(sel: 'sin' | 'sugerida' | 'otro') {
  seleccionPropina.value = sel
  if (sel === 'sin') propinaMonto.value = '0'
  else if (sel === 'sugerida') propinaMonto.value = propinaSugeridaMonto.value
}

watch(open, (v) => {
  if (v) {
    if (props.modoPropina) {
      if (props.ambitoIntento) intento.olvidarPropinaPendiente(props.ambitoIntento)
      const recordada = props.ambitoIntento ? intento.propinaDelIntento(props.ambitoIntento) : null
      seleccionPropina.value = recordada?.seleccion ?? 'sin'
      propinaMonto.value = recordada?.monto ?? '0'
    }
    resetPagos()
  }
})

watch(propinaMonto, () => {
  if (open.value && props.modoPropina && !montosEditados.value) resetPagos()
})

function setMonto(i: number, monto: string) {
  montosEditados.value = true
  pagos.value = setMontoPago(totalAPagar.value, pagos.value, i, monto)
}
function agregarPago() {
  const def = metodosHabilitados.value[0]
  if (!def) return
  montosEditados.value = true
  pagos.value = [...pagos.value, { metodoPagoId: def.metodoPagoId, monto: resumen.value.restante }]
}
function quitarPago(i: number) {
  pagos.value = pagos.value.filter((_, idx) => idx !== i)
}

/** Billetes que el cliente entrega en efectivo; el vuelto lo calcula el modal. */
const BILLETES = ['5000', '10000', '20000']

function permiteVuelto(metodoPagoId: string): boolean {
  return props.metodos.find((m) => m.metodoPagoId === metodoPagoId)?.permiteVuelto === true
}

/** Lo que entrega el cliente en este pago es ese billete: lo que sobra es vuelto, no se reparte. */
function entregar(i: number, monto: string) {
  montosEditados.value = true
  pagos.value = pagos.value.map((p, idx) => (idx === i ? { ...p, monto } : p))
}

/** "Exacto": lo que falta para cubrir el total sin contar este pago. */
function pagarExacto(i: number) {
  const otros = pagos.value.reduce(
    (acc, p, idx) => (idx === i ? acc : acc.plus(p.monto || '0')),
    new Decimal(0),
  )
  const exacto = Decimal.max(new Decimal(totalAPagar.value || '0').minus(otros), 0).toString()
  pagos.value = pagos.value.map((p, idx) => (idx === i ? { ...p, monto: exacto } : p))
  // Con un solo pago "exacto" sigue al total: es el estado de cuando abrió.
  montosEditados.value = pagos.value.length > 1
}

const resumen = computed(() =>
  resumenCobro(
    totalAPagar.value,
    pagos.value,
    props.metodos.map((m) => ({ metodoPagoId: m.metodoPagoId, permiteVuelto: m.permiteVuelto })),
  ),
)
const suma = computed(() => sumaPagos(pagos.value))
const hayEfectivo = computed(() => pagos.value.some((p) => permiteVuelto(p.metodoPagoId)))
const hayFalta = computed(() => new Decimal(resumen.value.restante || '0').gt(0))

const { formatMonto } = useFormatters()

const pagosValidos = computed(() =>
  pagos.value.filter((p) => new Decimal(p.monto || '0').gt(0)),
)

/**
 * Una venta de total $0 —una promoción que descuenta el 100%— es una venta
 * PAGADA y **no lleva línea de pago**: no hay nada que cobrar. Sin esto el
 * botón quedaba deshabilitado para siempre y esa venta no tenía ningún camino a
 * confirmarse, ni acá ni en la tienda.
 *
 * En modo propina el total incluye la propina, así que un total 0 significa que
 * tampoco se dejó propina: sigue sin haber nada que cobrar.
 */
const nadaQueCobrar = computed(() =>
  new Decimal(totalAPagar.value || '0').lte(0),
)

/** La misma regla que el panel del POS: nombre y RUT, y el RUT tiene que ser un RUT. */
const problemaPagador = computed(() =>
  props.pedirPagador
    ? problemaDelReceptor(
        { ...pagador.value, giro: '', direccion: '', comuna: '' },
        { receptorCompleto: false, rutChileno: props.rutChileno, identidadPagador: true },
      )
    : null,
)
const errorRutPagador = computed(() =>
  props.rutChileno && pagador.value.rut.trim() && !rutValido(pagador.value.rut)
    ? 'RUT inválido: revisa el dígito verificador'
    : undefined,
)

const puedeConfirmar = computed(
  () =>
    (nadaQueCobrar.value || pagosValidos.value.length > 0) &&
    !resumen.value.excedenteSinVuelto &&
    !problemaPagador.value,
)

function emisorDe(metodoPagoId: string): EmisorMedio | undefined {
  return props.metodos.find((m) => m.metodoPagoId === metodoPagoId)?.emisor
}

/** El número y la clase solo existen en un pago cuyo medio emite con la máquina. */
function emiteLaMaquina(metodoPagoId: string): boolean {
  return emisorDe(metodoPagoId) === 'maquina'
}

const avisoVoucher = computed(
  () => props.sobreUmbralIdentidad && pagosValidos.value.some((p) => emiteLaMaquina(p.metodoPagoId)),
)

/** «Cobrar $X» con la propina adentro; sin nada que cobrar (total 0) es solo confirmar. */
const etiquetaCobrar = computed(() => {
  if (nadaQueCobrar.value) return 'Confirmar venta'
  return hayFalta.value ? 'Confirmar con saldo pendiente' : `Cobrar ${formatMonto(totalAPagar.value)}`
})

function confirmar() {
  // Lo tipeado antes de cambiar de medio no viaja: `comprobanteDelPago` lo suelta
  // si el medio de este pago ya no es de la máquina.
  const aEmitir = pagosValidos.value.map(({ numeroDocumento, claseDocumento, ...pago }) => ({
    ...pago,
    ...comprobanteDelPago(emisorDe(pago.metodoPagoId), numeroDocumento, claseDocumento),
  }))
  if (props.modoPropina && props.ambitoIntento) {
    intento.recordarPropina(props.ambitoIntento, { seleccion: seleccionPropina.value, monto: propinaMonto.value || '0' })
  }
  emit('confirmar', aEmitir, resumen.value.vuelto)
}
</script>

<template>
  <UModal v-model:open="open" title="Cobrar venta" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div v-if="modoPropina" class="flex flex-col gap-3">
          <div class="flex justify-between text-sm text-muted">
            <span>Total venta</span>
            <span>{{ formatMonto(ventaTotal || '0') }}</span>
          </div>
          <!-- Se ofrece, no viene sumada: el total no cambia hasta que la cajera toca un atajo
               (owner, 2026-10-16, 01.2 y 02.9). -->
          <div data-qa="propina" class="flex flex-col gap-2">
            <p class="text-sm text-muted">
              {{ hayPropinaSugerida ? `Propina sugerida ${porcentajeHumano} %` : 'Propina' }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton
                label="Sin propina"
                size="xl"
                class="min-h-11"
                :color="seleccionPropina === 'sin' ? 'primary' : 'neutral'"
                :variant="seleccionPropina === 'sin' ? 'solid' : 'outline'"
                :aria-pressed="seleccionPropina === 'sin'"
                data-qa="propina-sin"
                @click="elegirPropina('sin')"
              />
              <UButton
                v-if="hayPropinaSugerida"
                size="xl"
                class="min-h-11"
                :color="seleccionPropina === 'sugerida' ? 'primary' : 'neutral'"
                :variant="seleccionPropina === 'sugerida' ? 'solid' : 'outline'"
                :aria-pressed="seleccionPropina === 'sugerida'"
                data-qa="propina-sugerida"
                @click="elegirPropina('sugerida')"
              >
                {{ porcentajeHumano }} % · {{ formatMonto(propinaSugeridaMonto) }}
              </UButton>
              <UButton
                label="Otro monto"
                size="xl"
                class="min-h-11"
                :color="seleccionPropina === 'otro' ? 'primary' : 'neutral'"
                :variant="seleccionPropina === 'otro' ? 'solid' : 'outline'"
                :aria-pressed="seleccionPropina === 'otro'"
                data-qa="propina-otro"
                @click="elegirPropina('otro')"
              />
            </div>
            <div v-if="seleccionPropina === 'otro'" class="flex items-center justify-between gap-3">
              <span class="text-sm text-muted">Propina</span>
              <MoneyInput
                :model-value="propinaMonto"
                oficial
                class="w-40 [&_input]:min-h-11"
                size="xl"
                data-qa="propina-monto"
                @update:model-value="propinaMonto = $event"
              />
            </div>
            <div v-else-if="seleccionPropina === 'sugerida'" class="flex justify-between text-sm text-muted">
              <span>Propina</span>
              <span>{{ formatMonto(propinaMonto) }}</span>
            </div>
          </div>
          <div class="flex items-baseline justify-between gap-3 border-t border-default pt-2 text-2xl font-semibold tabular-nums">
            <span>Total a pagar</span>
            <span>{{ formatMonto(totalAPagar) }}</span>
          </div>
        </div>
        <div v-else class="flex flex-col gap-2">
          <div class="flex items-baseline justify-between gap-3 text-2xl font-semibold tabular-nums">
            <span>Total a pagar</span>
            <span>{{ formatMonto(totalAPagar) }}</span>
          </div>
          <p v-if="propinaNoDisponible" data-qa="aviso-propina-no-disponible" class="text-xs text-muted">
            No se pudo leer la configuración de propina: este cobro va sin propina.
          </p>
        </div>

        <div v-if="nadaQueCobrar" data-qa="nada-que-cobrar" class="text-sm text-muted">
          No hay nada que cobrar: la venta queda registrada como pagada, sin
          línea de pago.
        </div>

        <div v-else class="flex flex-col gap-2">
          <div
            v-for="(pago, i) in pagos"
            :key="i"
            :data-qa="`pago-${i}`"
            class="flex flex-col gap-2"
          >
            <div class="flex items-center gap-2">
              <USelectMenu
                v-model="pago.metodoPagoId"
                :aria-label="`Método del pago ${i + 1}`"
                :items="metodoItems"
                value-key="value"
                label-key="label"
                size="xl"
                :ui="{ base: 'min-h-11' }"
                class="flex-1"
              />
              <MoneyInput
                :model-value="pago.monto"
                oficial
                class="w-40 [&_input]:min-h-11"
                size="xl"
                @update:model-value="setMonto(i, $event)"
              />
              <UButton
                :aria-label="`Quitar pago ${i + 1}`"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xl"
                class="size-11 justify-center ms-2"
                :disabled="pagos.length <= 1"
                @click="quitarPago(i)"
              />
            </div>
            <!-- Efectivo: lo que entrega el cliente, sin tipearlo. -->
            <div
              v-if="permiteVuelto(pago.metodoPagoId)"
              :data-qa="`billetes-${i}`"
              class="flex flex-wrap gap-2"
            >
              <UButton
                label="Exacto"
                size="xl"
                color="neutral"
                variant="outline"
                class="min-h-11"
                @click="pagarExacto(i)"
              />
              <UButton
                v-for="b in BILLETES"
                :key="b"
                :label="formatMonto(b)"
                size="xl"
                color="neutral"
                variant="outline"
                class="min-h-11"
                @click="entregar(i, b)"
              />
            </div>
            <!-- Solo con un medio que emite la máquina, y opcional: el voucher se
                 puede completar después desde el detalle de la venta. -->
            <VentasDocumentoNumeroCampos
              v-if="emiteLaMaquina(pago.metodoPagoId)"
              v-model:numero="pago.numeroDocumento"
              v-model:clase="pago.claseDocumento"
            />
          </div>
          <UButton
            label="Agregar pago"
            icon="i-lucide-plus"
            variant="ghost"
            size="xl"
            class="min-h-11"
            @click="agregarPago"
          />
        </div>

        <div v-if="pedirPagador" data-qa="pagador" class="flex flex-col gap-2 border-t border-default pt-2">
          <p class="text-sm text-muted">
            Por el monto, la boleta lleva el nombre y el RUT de quien paga.
          </p>
          <UFormField label="Nombre y apellidos" required>
            <UInput
              v-model="pagador.nombre"
              :maxlength="LARGO_RECEPTOR.nombre"
              class="w-full"
              data-qa="pagador-nombre"
            />
          </UFormField>
          <UFormField label="RUT" required :error="errorRutPagador">
            <UInput v-model="pagador.rut" placeholder="12.345.678-5" class="w-full" data-qa="pagador-rut" />
          </UFormField>
        </div>

        <UAlert
          v-if="avisoVoucher"
          data-qa="aviso-voucher-umbral"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          description="El voucher de la máquina no lleva a quien paga: sobre 135 UF hay que emitir la boleta electrónica con su nombre y RUT."
        />

        <div v-if="!nadaQueCobrar" class="flex flex-col gap-1 border-t border-default pt-2 text-sm tabular-nums">
          <div class="flex justify-between text-muted"><span>Pagado</span><span>{{ formatMonto(suma) }}</span></div>
          <!-- Falta saldo: en ámbar, porque confirmar deja la venta con deuda. -->
          <div v-if="hayFalta" data-qa="falta" class="flex justify-between text-base font-semibold text-warning">
            <span>Falta</span><span>{{ formatMonto(resumen.restante) }}</span>
          </div>
          <div v-else class="flex justify-between text-muted"><span>Restante</span><span>{{ formatMonto(resumen.restante) }}</span></div>
          <div
            data-qa="vuelto"
            class="flex items-baseline justify-between"
            :class="hayEfectivo ? 'text-2xl font-semibold text-default' : 'font-medium text-default'"
          >
            <span>Vuelto</span><span>{{ formatMonto(resumen.vuelto) }}</span>
          </div>
          <p v-if="resumen.excedenteSinVuelto" class="text-error text-xs">
            Los pagos con métodos sin vuelto superan el total: ese excedente no se puede devolver.
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" size="xl" class="min-h-11" @click="() => { open = false }" />
        <UButton
          :label="etiquetaCobrar"
          color="primary"
          size="xl"
          class="min-h-11"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
