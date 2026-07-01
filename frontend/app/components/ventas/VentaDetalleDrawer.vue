<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TableColumn } from '@nuxt/ui'

interface Pago {
  id: string
  metodoPagoId: string
  monto: string
  vuelto: string
  fecha: string
  referencia: string | null
}

interface Detalle {
  id: string
  descripcion: string
  cantidad: string
  precioUnitario: string
  totalLinea: string
}

interface VentaDetalle {
  id: string
  canal: string
  estado: string
  fecha: string
  creadoEl: string
  totalBruto: string
  totalDescuentos: string
  totalRecargos: string
  totalImpuestos: string
  totalFinal: string
  detalles: Detalle[]
  pagos: Pago[]
  customer: { nombre: string; rut?: string } | null
}

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const props = defineProps<{
  ventaId: string | null
}>()

const emit = defineEmits<{ updated: [] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const apiUrl = config.public.apiUrl

const venta = ref<VentaDetalle | null>(null)
const metodos = ref<MetodoPago[]>([])
const loading = ref(false)
const abonoOpen = ref(false)

const montoPagado = computed(() => {
  if (!venta.value) return '0'
  return venta.value.pagos.reduce((acc, p) => {
    return new Decimal(acc).plus(new Decimal(p.monto)).minus(new Decimal(p.vuelto ?? '0')).toString()
  }, '0')
})

const saldo = computed(() => {
  if (!venta.value) return '0'
  return Decimal.max(0, new Decimal(venta.value.totalFinal).minus(new Decimal(montoPagado.value))).toString()
})

const puedeAbonar = computed(() =>
  !!venta.value && ['pendiente', 'pagada_parcial'].includes(venta.value.estado),
)

function estadoColor(estado: string): 'warning' | 'success' | 'error' | 'neutral' | 'info' {
  const map: Record<string, 'warning' | 'success' | 'error' | 'neutral' | 'info'> = {
    pendiente: 'warning',
    pagada_parcial: 'info',
    pagada: 'success',
    cancelada: 'error',
    borrador: 'neutral',
  }
  return map[estado] ?? 'neutral'
}

function estadoLabel(estado: string): string {
  const map: Record<string, string> = {
    pendiente: 'Pendiente',
    pagada_parcial: 'Parcial',
    pagada: 'Pagada',
    cancelada: 'Cancelada',
    borrador: 'Borrador',
  }
  return map[estado] ?? estado
}

const detalleColumns: TableColumn<Detalle>[] = [
  { accessorKey: 'descripcion', header: 'Descripción' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'precioUnitario', header: 'Precio unit.', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'totalLinea', header: 'Total línea', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

async function cargar(id: string) {
  loading.value = true
  venta.value = null
  try {
    const [ventaData, metodosData] = await Promise.all([
      useApiFetch<VentaDetalle>(`${apiUrl}/ventas/${id}`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
    ])
    venta.value = ventaData
    metodos.value = metodosData
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar venta')
    toast.add({ title: msg, color: 'error' })
    open.value = false
  }
  finally {
    loading.value = false
  }
}

watch(
  () => [open.value, props.ventaId] as const,
  ([isOpen, id]) => {
    if (isOpen && id) cargar(id)
    else if (!isOpen) {
      venta.value = null
      abonoOpen.value = false
    }
  },
)

async function onAbonoSuccess() {
  abonoOpen.value = false
  if (props.ventaId) await cargar(props.ventaId)
  emit('updated')
}
</script>

<template>
  <AppDrawer v-model:open="open" width="50%">
    <template #header>
      <div class="flex items-center gap-2">
        <span class="font-semibold text-default">Detalle de venta</span>
        <UBadge
          v-if="venta"
          :color="estadoColor(venta.estado)"
          :label="estadoLabel(venta.estado)"
          variant="subtle"
          size="xs"
        />
      </div>
    </template>

    <template #body>
      <div v-if="loading" class="py-12 text-center text-muted">
        <UIcon name="i-heroicons-arrow-path" class="mx-auto mb-2 h-6 w-6 animate-spin" />
        Cargando venta…
      </div>

      <div v-else-if="venta" class="space-y-4">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Información general
            </h2>
          </template>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt class="text-muted">
                Fecha
              </dt>
              <dd class="font-medium">
                {{ formatFecha(venta.fecha) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Canal
              </dt>
              <dd class="font-medium capitalize">
                {{ venta.canal }}
              </dd>
            </div>
            <div v-if="venta.customer">
              <dt class="text-muted">
                Cliente
              </dt>
              <dd class="font-medium">
                {{ venta.customer.nombre }}
                <span v-if="venta.customer.rut" class="ml-1 text-muted">({{ venta.customer.rut }})</span>
              </dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Líneas de venta
            </h2>
          </template>
          <UTable :data="venta.detalles" :columns="detalleColumns">
            <template #cantidad-cell="{ row }">
              <span class="font-mono">{{ row.original.cantidad }}</span>
            </template>
            <template #precioUnitario-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.precioUnitario) }}</span>
            </template>
            <template #totalLinea-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.totalLinea) }}</span>
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                <UIcon name="i-heroicons-inbox" class="mx-auto mb-2 h-8 w-8 opacity-40" />
                Sin líneas de venta.
              </div>
            </template>
          </UTable>
        </UCard>

        <div class="grid gap-4 md:grid-cols-2">
          <UCard>
            <template #header>
              <h2 class="text-base font-semibold">
                Totales
              </h2>
            </template>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between">
                <dt class="text-muted">
                  Subtotal bruto
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalBruto) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Descuentos
                </dt>
                <dd class="font-mono text-success">
                  -{{ formatMonto(venta.totalDescuentos) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Recargos
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalRecargos) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Impuestos
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalImpuestos) }}
                </dd>
              </div>
              <div class="flex justify-between border-t border-default pt-2 font-semibold">
                <dt>Total final</dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalFinal) }}
                </dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="text-base font-semibold">
                Pagos
              </h2>
            </template>

            <div v-if="!venta.pagos.length" class="py-2 text-sm text-muted">
              Sin pagos registrados
            </div>
            <ul v-else class="mb-4 divide-y divide-default text-sm">
              <li
                v-for="(p, i) in venta.pagos"
                :key="p.id"
                class="flex justify-between gap-2 py-2"
              >
                <span class="text-muted">Pago {{ i + 1 }}</span>
                <span class="font-mono">{{ formatMonto(p.monto) }}</span>
                <span v-if="p.vuelto && new Decimal(p.vuelto).gt(0)" class="text-xs text-muted">
                  (vuelto: {{ formatMonto(p.vuelto) }})
                </span>
                <span class="text-xs text-muted">{{ formatFecha(p.fecha) }}</span>
              </li>
            </ul>

            <div class="space-y-1 border-t border-default pt-3 text-sm">
              <div class="flex justify-between">
                <span class="text-muted">Monto pagado</span>
                <span class="font-mono font-medium">{{ formatMonto(montoPagado) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">Saldo pendiente</span>
                <span class="font-mono font-medium" :class="new Decimal(saldo).gt(0) ? 'text-warning' : ''">
                  {{ formatMonto(saldo) }}
                </span>
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <div v-else class="py-12 text-center text-muted">
        <UIcon name="i-heroicons-exclamation-triangle" class="mx-auto mb-2 h-8 w-8 opacity-40" />
        No se encontró la venta.
      </div>
    </template>

    <template #actions>
      <UButton
        color="neutral"
        variant="ghost"
        @click="open = false"
      >
        Cerrar
      </UButton>
      <UButton
        v-if="puedeAbonar"
        label="Registrar pago"
        icon="i-heroicons-plus"
        @click="abonoOpen = true"
      />
    </template>
  </AppDrawer>

  <PagosAbonoModal
    v-if="venta"
    v-model:open="abonoOpen"
    :venta-id="venta.id"
    :saldo="saldo"
    :metodos="metodos"
    @success="onAbonoSuccess"
  />
</template>
