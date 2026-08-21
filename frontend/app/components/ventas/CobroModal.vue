<script setup lang="ts">
import Decimal from 'decimal.js'
import { resumenCobro, setMontoPago, sumaPagos, type PagoInput } from '~/composables/useVenta'
import { sugerirPropina } from '~/composables/usePropina'

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
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
  }>(),
  { modoPropina: false, total: '0', ventaTotal: '0', porcentajeSugerido: '0.10' },
)

const emit = defineEmits<{ confirmar: [pagos: PagoInput[], vuelto: string] }>()

// La sugerencia se redondea a la MENOR de las dos escalas que hoy se llaman
// "oficial", y no a una de las dos, porque cada una gobierna una punta distinta y
// pueden diferir:
//   - `monedaDefault` (tenant_moneda.es_default) es contra la que el backend
//     valida este monto (`@EsMontoCobrado` → `decimalesOficiales`): pasarse de
//     ahí es un 400 al cerrar la cuenta.
//   - `monedaOficial` (pais.moneda_oficial_id) es la que usa el `MoneyInput
//     oficial` que muestra y edita este mismo monto: pasarse de ahí hace que la
//     pantalla trunque, y que tocar el campo se coma los centavos en silencio.
// La menor de las dos cabe en las dos. Cuando coinciden —el caso normal, y el
// único que el seed produce— es exactamente la escala de la moneda, que es lo que
// este arreglo vino a darle a la sugerencia en vez de los 0 fijos de antes.
// Unificar las dos nociones es decisión del owner y vive en el backlog.
const monedas = useMonedasStore()
const decimalesPropina = computed(() =>
  Math.min(monedas.monedaDefault?.decimals ?? 0, monedas.monedaOficial?.decimals ?? 0),
)
const open = defineModel<boolean>('open', { required: true })
const propinaMonto = defineModel<string>('propinaMonto', { default: '0' })

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

function resetPagos() {
  const def = metodosHabilitados.value[0]
  pagos.value = def
    ? [{ metodoPagoId: def.metodoPagoId, monto: totalAPagar.value }]
    : []
}

watch(open, (v) => {
  if (v) {
    if (props.modoPropina) {
      propinaMonto.value = sugerirPropina(
        props.ventaTotal || '0',
        decimalesPropina.value,
        props.porcentajeSugerido || '0.10',
      )
    }
    resetPagos()
  }
})

watch(propinaMonto, () => {
  if (open.value && props.modoPropina) resetPagos()
})

function setMonto(i: number, monto: string) {
  pagos.value = setMontoPago(totalAPagar.value, pagos.value, i, monto)
}
function agregarPago() {
  const def = metodosHabilitados.value[0]
  if (!def) return
  pagos.value = [...pagos.value, { metodoPagoId: def.metodoPagoId, monto: resumen.value.restante }]
}
function quitarPago(i: number) {
  pagos.value = pagos.value.filter((_, idx) => idx !== i)
}

const resumen = computed(() =>
  resumenCobro(
    totalAPagar.value,
    pagos.value,
    props.metodos.map((m) => ({ metodoPagoId: m.metodoPagoId, permiteVuelto: m.permiteVuelto })),
  ),
)
const suma = computed(() => sumaPagos(pagos.value))

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

const puedeConfirmar = computed(
  () =>
    (nadaQueCobrar.value || pagosValidos.value.length > 0) &&
    !resumen.value.excedenteSinVuelto,
)

function confirmar() {
  emit('confirmar', pagosValidos.value, resumen.value.vuelto)
}
</script>

<template>
  <UModal v-model:open="open" title="Cobrar venta" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div v-if="modoPropina" class="text-sm space-y-1">
          <div class="flex justify-between text-muted">
            <span>Total venta</span>
            <span>{{ formatMonto(ventaTotal || '0') }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-muted">Propina</span>
            <MoneyInput
              :model-value="propinaMonto"
              oficial
              class="w-32"
              size="sm"
              @update:model-value="propinaMonto = $event"
            />
          </div>
          <div class="flex justify-between text-base font-semibold border-t border-default pt-2">
            <span>Total a pagar</span>
            <span>{{ formatMonto(totalAPagar) }}</span>
          </div>
        </div>
        <div v-else class="flex justify-between text-base font-semibold">
          <span>Total a pagar</span>
          <span>{{ formatMonto(totalAPagar) }}</span>
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
            class="flex items-center gap-2"
          >
            <USelectMenu
              v-model="pago.metodoPagoId"
              :items="metodoItems"
              value-key="value"
              label-key="label"
              class="flex-1"
            />
            <MoneyInput
              :model-value="pago.monto"
              oficial
              class="w-32"
              size="sm"
              @update:model-value="setMonto(i, $event)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              :disabled="pagos.length <= 1"
              @click="quitarPago(i)"
            />
          </div>
          <UButton
            label="Agregar pago"
            icon="i-lucide-plus"
            variant="ghost"
            size="sm"
            @click="agregarPago"
          />
        </div>

        <div v-if="!nadaQueCobrar" class="text-sm space-y-1 border-t border-default pt-2">
          <div class="flex justify-between text-muted"><span>Pagado</span><span>{{ formatMonto(suma) }}</span></div>
          <div class="flex justify-between text-muted"><span>Restante</span><span>{{ formatMonto(resumen.restante) }}</span></div>
          <div class="flex justify-between font-medium text-default"><span>Vuelto</span><span>{{ formatMonto(resumen.vuelto) }}</span></div>
          <p v-if="resumen.excedenteSinVuelto" class="text-error text-xs">
            Los pagos con métodos sin vuelto superan el total: ese excedente no se puede devolver.
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          label="Confirmar venta"
          color="primary"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
