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
  ventaId: string
  /** total_final − Σ NCs previas (lo calcula el drawer) */
  disponible: string
  detalles: DetalleVenta[]
}>()
const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const cajaStore = useCajaStore()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const monto = ref('')
const comentario = ref('')
const devolverDinero = ref(false)
const filas = ref<FilaDevolucion[]>([])
const submitting = ref(false)

function esDecimalValido(v: string) {
  return /^\d+(\.\d+)?$/.test(v)
}

watch(open, (v) => {
  if (!v) return
  monto.value = props.disponible
  comentario.value = ''
  devolverDinero.value = false
  // Una fila por ítem (el disponible a devolver es por ítem, no por línea)
  const porItem = new Map<string, FilaDevolucion>()
  for (const d of props.detalles) {
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
  // Habilita/deshabilita el checkbox de devolución de dinero
  cajaStore.cargarActiva()
})

const tieneCaja = computed(() => !!cajaStore.activa)

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

function notaDevolucion(fila: FilaDevolucion) {
  if (fila.modoInventario === null) return 'Servicio: sin stock'
  if (fila.modoInventario !== 'cantidad')
    return `Modo ${fila.modoInventario}: devolución manual desde Inventario`
  return null
}

function filaDevolvible(fila: FilaDevolucion) {
  return fila.modoInventario === 'cantidad' && new Decimal(fila.disponible).gt(0)
}

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
    if (comentario.value.trim()) body.comentario = comentario.value.trim()
    if (devolverDinero.value) body.devolverDinero = true
    if (devoluciones.length) body.devoluciones = devoluciones

    const res = await useApiFetch<{ id: string, movimientoCajaId: string | null }>(
      `${apiUrl}/ventas/${props.ventaId}/notas-credito`,
      { method: 'POST', body },
    )

    toast.add({
      title: res?.movimientoCajaId
        ? 'Nota de crédito generada con devolución de dinero'
        : 'Nota de crédito generada',
      color: 'success',
    })
    open.value = false
    emit('success')
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

        <div class="flex flex-col gap-2">
          <span class="text-sm text-muted">Devolver a inventario (opcional)</span>
          <div v-if="!filas.length" class="text-sm text-muted">
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
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
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
