<script setup lang="ts">
import Decimal from 'decimal.js'
import { resumenCobro, setMontoPago, sumaPagos, type PagoInput } from '~/composables/useVenta'
import { comprobanteDelPago, type EmisorMedio } from '~/composables/useDocumentosVenta'

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
  /** Quién emite lo cobrado con el medio; lo decide el comercio, no el cajero. */
  emisor: EmisorMedio
}

const props = defineProps<{
  ventaId: string
  saldo: string
  metodos: MetodoPago[]
  /**
   * Del backend (`GET /ventas/:id`): un abono pagado con la máquina duplicaría un
   * documento, porque la deuda ya tiene el suyo. La pantalla no replica la regla:
   * solo avisa. El cobro sigue.
   */
  abonoConMaquinaDuplica: boolean
}>()
export interface AbonoSuccessPayload {
  pagos: Array<{
    id: string
    metodoPagoId: string
    monto: string
    vuelto: string
    fecha: string
    referencia: string | null
  }>
  venta: { id: string, estado: string, saldo: string }
  /** El abono ya había entrado y el backend lo reprodujo (`useIntentoCobro`). */
  repetida?: boolean
}

const emit = defineEmits<{ success: [AbonoSuccessPayload] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const pagos = ref<PagoInput[]>([])
const submitting = ref(false)
// Una clave por venta abonada (`abono:<ventaId>`), a nivel de pestaña: cerrar
// y reabrir el modal después de un corte sigue siendo el mismo intento, así
// que el reintento no registra un segundo pago (ADR-026).
const intentoCobro = useIntentoCobro()

const metodosHabilitados = computed(() => props.metodos.filter((m) => m.habilitada))
const metodoItems = computed(() =>
  metodosHabilitados.value.map((m) => ({ label: m.nombre, value: m.metodoPagoId })),
)

watch(open, (v) => {
  if (v) {
    const def = metodosHabilitados.value[0]
    pagos.value = def
      ? [{ metodoPagoId: def.metodoPagoId, monto: props.saldo }]
      : []
  }
})

// El cajero no saca cuentas ("500 en efectivo y el resto en tarjeta"): al
// escribir un monto, los demás pagos absorben el excedente vía setMontoPago,
// y el pago nuevo se prellena con el restante. La regla de sobrepago sin
// vuelto se valida al confirmar.
function setMonto(i: number, monto: string) {
  pagos.value = setMontoPago(props.saldo, pagos.value, i, monto)
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
    props.saldo,
    pagos.value,
    props.metodos.map((m) => ({ metodoPagoId: m.metodoPagoId, permiteVuelto: m.permiteVuelto })),
  ),
)
const suma = computed(() => sumaPagos(pagos.value))

// Los pagos absorbidos a $0 por setMontoPago no se registran en el ledger.
const pagosValidos = computed(() =>
  pagos.value.filter((p) => new Decimal(p.monto || '0').gt(0)),
)

// El aviso no entra en esta cuenta: no bloquea. Es un dato para el cajero y para
// el contador, no una condición del cobro.
const puedeConfirmar = computed(
  () => pagosValidos.value.length > 0 && !resumen.value.excedenteSinVuelto,
)

function emisorDe(metodoPagoId: string): EmisorMedio | undefined {
  return props.metodos.find((m) => m.metodoPagoId === metodoPagoId)?.emisor
}

/**
 * El número del comprobante solo sirve cuando el abono es el voucher duplicado:
 * en cualquier otro abono el servidor lo ignora, así que no se pide.
 */
function pideComprobante(metodoPagoId: string): boolean {
  return props.abonoConMaquinaDuplica && emisorDe(metodoPagoId) === 'maquina'
}

const avisaDuplicado = computed(() =>
  pagosValidos.value.some((p) => pideComprobante(p.metodoPagoId)),
)

async function confirmar() {
  const ambitoCobro = `abono:${props.ventaId}`
  submitting.value = true
  try {
    const res = await useApiFetch<AbonoSuccessPayload>(`${apiUrl}/pagos`, {
      method: 'POST',
      body: {
        ventaId: props.ventaId,
        pagos: pagosValidos.value.map(({ numeroDocumento, claseDocumento, ...pago }) => ({
          ...pago,
          ...comprobanteDelPago(
            props.abonoConMaquinaDuplica ? emisorDe(pago.metodoPagoId) : undefined,
            numeroDocumento,
            claseDocumento,
          ),
        })),
      },
      headers: intentoCobro.cabecera(ambitoCobro),
    })
    intentoCobro.terminar(ambitoCobro)
    toast.add({ title: 'Pago registrado', color: 'success' })
    intentoCobro.avisarSiRepetido(res)
    open.value = false
    emit('success', res)
  } catch (e: unknown) {
    if (!intentoCobro.mostrarSiCobroConOtrosDatos(e, ambitoCobro))
      toast.add({ title: apiErrorMsg(e, 'Error al registrar pago'), color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Registrar pago" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex justify-between text-base font-semibold">
          <span>Saldo pendiente</span><span class="font-mono">{{ formatMonto(saldo) }}</span>
        </div>

        <div class="flex flex-col gap-2">
          <div v-for="(pago, i) in pagos" :key="i" class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
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
            <VentasDocumentoNumeroCampos
              v-if="pideComprobante(pago.metodoPagoId)"
              v-model:numero="pago.numeroDocumento"
              v-model:clase="pago.claseDocumento"
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

        <UAlert
          v-if="avisaDuplicado"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          data-qa="aviso-voucher-duplicado"
          description="Esta venta ya tiene su boleta. El voucher de este pago también vale como boleta y la duplica. El cobro sigue, y queda marcado para que el contador lo corrija."
        />

        <div class="text-sm space-y-1 border-t border-default pt-2">
          <div class="flex justify-between text-muted">
            <span>Pagado</span><span class="font-mono">{{ formatMonto(suma) }}</span>
          </div>
          <div class="flex justify-between text-muted">
            <span>Restante</span><span class="font-mono">{{ formatMonto(resumen.restante) }}</span>
          </div>
          <div
            class="flex justify-between font-medium"
            :class="new Decimal(resumen.vuelto).gt(0) ? 'text-success' : 'text-default'"
          >
            <span>Vuelto</span><span class="font-mono">{{ formatMonto(resumen.vuelto) }}</span>
          </div>
          <p v-if="resumen.excedenteSinVuelto" class="text-error text-xs">
            Los pagos con métodos sin vuelto superan el saldo: ese excedente no se puede devolver.
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          label="Confirmar pago"
          color="primary"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
