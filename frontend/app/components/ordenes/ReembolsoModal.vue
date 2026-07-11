<script setup lang="ts">
import Decimal from 'decimal.js'

interface DetalleVenta {
  itemId: string
  descripcion: string | null
  cantidad: string
  modoInventario: string | null
  cantidadDevuelta: string
}

interface FilaDevolucion {
  itemId: string
  descripcion: string
  disponible: string
  modoInventario: string | null
  cantidad: string
}

const props = defineProps<{
  ordenId: string
  disponible: string
  ventaId?: string | null
}>()
const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const monto = ref('')
const generarNotaCredito = ref(false)
const filas = ref<FilaDevolucion[]>([])
const cargandoVenta = ref(false)
const submitting = ref(false)

function esDecimalValido(v: string) {
  return /^\d+(\.\d+)?$/.test(v)
}

async function cargarLineasVenta(ventaId: string) {
  cargandoVenta.value = true
  try {
    const venta = await useApiFetch<{ detalles: DetalleVenta[] }>(`${apiUrl}/ventas/${ventaId}`)
    // Una fila por ítem (el disponible a devolver es por ítem, no por línea)
    const porItem = new Map<string, FilaDevolucion>()
    for (const d of venta.detalles) {
      const previa = porItem.get(d.itemId)
      if (previa) {
        previa.disponible = new Decimal(previa.disponible).plus(d.cantidad).toString()
      }
      else {
        porItem.set(d.itemId, {
          itemId: d.itemId,
          descripcion: d.descripcion ?? d.itemId,
          disponible: new Decimal(d.cantidad).minus(d.cantidadDevuelta).toString(),
          modoInventario: d.modoInventario,
          cantidad: '',
        })
      }
    }
    filas.value = [...porItem.values()]
  }
  catch {
    // Sin líneas no se bloquea el reembolso: solo se ocultan las secciones extra
    filas.value = []
  }
  finally {
    cargandoVenta.value = false
  }
}

watch(open, (v) => {
  if (!v) return
  monto.value = props.disponible
  generarNotaCredito.value = false
  filas.value = []
  if (props.ventaId) cargarLineasVenta(props.ventaId)
})

function notaDevolucion(fila: FilaDevolucion) {
  if (fila.modoInventario === null) return 'Servicio: sin stock'
  if (fila.modoInventario !== 'cantidad')
    return `Modo ${fila.modoInventario}: devolución manual desde Inventario`
  return null
}

function filaDevolvible(fila: FilaDevolucion) {
  return fila.modoInventario === 'cantidad' && new Decimal(fila.disponible).gt(0)
}

const montoValido = computed(() => {
  const m = new Decimal(monto.value || '0')
  return m.gt(0) && m.lte(new Decimal(props.disponible))
})

const filasValidas = computed(() =>
  filas.value.every((f) => {
    if (!f.cantidad) return true
    if (!esDecimalValido(f.cantidad)) return false
    return new Decimal(f.cantidad).lte(f.disponible)
  }),
)

const puedeConfirmar = computed(() => montoValido.value && filasValidas.value)

function setCantidad(itemId: string, valor: string) {
  filas.value = filas.value.map(f =>
    f.itemId === itemId ? { ...f, cantidad: valor } : f,
  )
}

async function confirmar() {
  submitting.value = true
  try {
    const devoluciones = filas.value
      .filter(f => f.cantidad && esDecimalValido(f.cantidad) && new Decimal(f.cantidad).gt(0))
      .map(f => ({ itemId: f.itemId, cantidad: f.cantidad }))

    const body: Record<string, unknown> = { monto: monto.value }
    if (props.ventaId && generarNotaCredito.value) body.generarNotaCredito = true
    if (props.ventaId && devoluciones.length) body.devoluciones = devoluciones

    const res = await useApiFetch<{ warning?: string, notaCreditoId?: string }>(
      `${apiUrl}/pasarela/admin/ordenes/${props.ordenId}/reembolsos`,
      { method: 'POST', body },
    )

    if (res?.warning) {
      toast.add({ title: 'Reembolso procesado con advertencia', description: res.warning, color: 'warning' })
    }
    else if (res?.notaCreditoId) {
      toast.add({ title: 'Reembolso procesado y nota de crédito generada', color: 'success' })
    }
    else {
      toast.add({ title: 'Reembolso procesado', color: 'success' })
    }
    open.value = false
    emit('success')
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

          <div class="flex flex-col gap-2">
            <span class="text-sm text-muted">Devolver a inventario (opcional)</span>
            <div v-if="cargandoVenta" class="text-sm text-muted">
              Cargando líneas de la venta…
            </div>
            <div v-else-if="!filas.length" class="text-sm text-muted">
              La venta no tiene líneas para devolver.
            </div>
            <div v-else class="flex flex-col divide-y divide-default">
              <div
                v-for="fila in filas"
                :key="fila.itemId"
                class="flex items-center justify-between gap-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm">{{ fila.descripcion }}</p>
                  <p class="text-xs text-muted">
                    <template v-if="notaDevolucion(fila)">{{ notaDevolucion(fila) }}</template>
                    <template v-else>Disponible: {{ fila.disponible }}</template>
                  </p>
                </div>
                <UInput
                  :model-value="fila.cantidad"
                  inputmode="decimal"
                  placeholder="0"
                  class="w-24"
                  :disabled="!filaDevolvible(fila)"
                  @update:model-value="setCantidad(fila.itemId, String($event ?? ''))"
                />
              </div>
            </div>
            <p v-if="!filasValidas" class="text-xs text-error">
              Las cantidades deben ser numéricas y no superar lo disponible por ítem.
            </p>
          </div>
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
