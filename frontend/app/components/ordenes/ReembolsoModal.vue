<script setup lang="ts">
import Decimal from 'decimal.js'
import type { DetalleVentaDevolucion } from '~/composables/useDevolucionInventario'

const props = defineProps<{
  ordenId: string
  disponible: string
  ventaId?: string | null
}>()
export interface ReembolsoSuccessPayload {
  ordenId: string
  estado: string
  reembolsoAprobado?: boolean
  warning?: string
  notaCreditoId?: string
  reembolso?: {
    transaccionId: string
    tipo: string
    estado: string
    monto: string | null
    codigoAutorizacion: string | null
    codigoRespuesta: string | null
    fechaTransaccion: string
  }
}

const emit = defineEmits<{ success: [ReembolsoSuccessPayload] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const monto = ref('')
const generarNotaCredito = ref(false)
const cargandoVenta = ref(false)
const submitting = ref(false)
const { filas, cargarDesdeDetalles, limpiar, setCantidad, filasValidas, devoluciones }
  = useDevolucionInventario()

async function cargarLineasVenta(ventaId: string) {
  cargandoVenta.value = true
  try {
    const venta = await useApiFetch<{ detalles: DetalleVentaDevolucion[] }>(`${apiUrl}/ventas/${ventaId}`)
    cargarDesdeDetalles(venta.detalles)
  }
  catch {
    // Sin líneas no se bloquea el reembolso: solo se ocultan las secciones extra
    limpiar()
  }
  finally {
    cargandoVenta.value = false
  }
}

watch(open, (v) => {
  if (!v) return
  monto.value = props.disponible
  generarNotaCredito.value = false
  limpiar()
  if (props.ventaId) cargarLineasVenta(props.ventaId)
})

const montoValido = computed(() => {
  const m = new Decimal(monto.value || '0')
  return m.gt(0) && m.lte(new Decimal(props.disponible))
})

const puedeConfirmar = computed(() => montoValido.value && filasValidas.value)

async function confirmar() {
  submitting.value = true
  try {
    const body: Record<string, unknown> = { monto: monto.value }
    if (props.ventaId && generarNotaCredito.value) body.generarNotaCredito = true
    if (props.ventaId && devoluciones.value.length) body.devoluciones = devoluciones.value

    const res = await useApiFetch<ReembolsoSuccessPayload>(
      `${apiUrl}/pasarela/admin/ordenes/${props.ordenId}/reembolsos`,
      { method: 'POST', body },
    )

    if (res.warning) {
      toast.add({ title: 'Reembolso procesado con advertencia', description: res.warning, color: 'warning' })
    }
    else if (res.notaCreditoId) {
      toast.add({ title: 'Reembolso procesado y nota de crédito generada', color: 'success' })
    }
    else {
      toast.add({ title: 'Reembolso procesado', color: 'success' })
    }
    open.value = false
    emit('success', res)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al procesar el reembolso'), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Reembolsar orden" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex justify-between text-sm text-muted">
          <span>Disponible para reembolsar</span>
          <span class="font-mono">{{ formatMonto(disponible) }}</span>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-muted">Monto a reembolsar</span>
          <MoneyInput
            v-model="monto"
            oficial
          />
          <p v-if="!montoValido && monto" class="text-xs text-error">
            El monto debe ser mayor a 0 y no superar el disponible.
          </p>
        </div>

        <template v-if="ventaId">
          <USeparator />

          <UCheckbox
            v-model="generarNotaCredito"
            label="Generar nota de crédito"
            description="Documento interno por el monto reembolsado, sin emisión SII."
          />

          <DevolucionInventarioLista
            :filas="filas"
            :valida="filasValidas"
            :cargando="cargandoVenta"
            @set-cantidad="setCantidad"
          />
        </template>
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          label="Confirmar reembolso"
          color="error"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
