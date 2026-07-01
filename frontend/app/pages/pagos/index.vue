<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TableColumn } from '@nuxt/ui'
import { getPaginationRowModel } from '@tanstack/vue-table'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface PagoLedger {
  id: string
  ventaId: string
  monto: string
  vuelto: string
  fecha: string
  cajaId: string | null
  referencia: string | null
  metodoNombre: string
  ventaEstado: string
  totalFinal: string
  customerNombre: string | null
}

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const apiUrl = config.public.apiUrl

const pagos = ref<PagoLedger[]>([])
const loading = ref(false)
const filtroMetodo = ref('')
const filtroEstado = ref('')
const pageSize = 15
const table = useTemplateRef('table')
const pagination = ref({ pageIndex: 0, pageSize })

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

const estadoOptions = [
  { label: estadoLabel('pendiente'), value: 'pendiente' },
  { label: estadoLabel('pagada_parcial'), value: 'pagada_parcial' },
  { label: estadoLabel('pagada'), value: 'pagada' },
  { label: estadoLabel('cancelada'), value: 'cancelada' },
  { label: estadoLabel('borrador'), value: 'borrador' },
]

const hayFiltrosActivos = computed(() => !!filtroMetodo.value || !!filtroEstado.value)

function limpiarFiltros() {
  filtroMetodo.value = ''
  filtroEstado.value = ''
}

const pagosFiltrados = computed(() => {
  let result = pagos.value
  if (filtroMetodo.value) {
    result = result.filter(p => p.metodoNombre.toLowerCase().includes(filtroMetodo.value.toLowerCase()))
  }
  if (filtroEstado.value) {
    result = result.filter(p => p.ventaEstado === filtroEstado.value)
  }
  return result
})

watch([filtroMetodo, filtroEstado], () => { pagination.value.pageIndex = 0 })

const montoCobrado = computed(() =>
  pagos.value.reduce((acc, p) => {
    return acc.plus(new Decimal(p.monto)).minus(new Decimal(p.vuelto ?? '0'))
  }, new Decimal(0)),
)

const pagosHoy = computed(() => {
  const hoy = new Date().toDateString()
  return pagos.value.filter(p => new Date(p.fecha).toDateString() === hoy)
})

const montoHoy = computed(() =>
  pagosHoy.value.reduce((acc, p) => {
    return acc.plus(new Decimal(p.monto)).minus(new Decimal(p.vuelto ?? '0'))
  }, new Decimal(0)),
)

async function cargar() {
  loading.value = true
  try {
    pagos.value = await useApiFetch<PagoLedger[]>(`${apiUrl}/pagos`)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar pagos', color: 'error' })
  } finally {
    loading.value = false
  }
}

const columns: TableColumn<PagoLedger>[] = [
  { accessorKey: 'fecha', header: 'Fecha' },
  { accessorKey: 'metodoNombre', header: 'Método' },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'vuelto', header: 'Vuelto', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'customerNombre', header: 'Cliente' },
  { id: 'venta', header: 'Venta' },
  { accessorKey: 'ventaEstado', header: 'Estado venta' },
]

onMounted(cargar)
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Pagos" />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-4 py-6">
        <!-- Resumen -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div class="rounded-lg bg-muted p-3">
            <p class="text-xs text-muted uppercase tracking-wide">
              Pagos registrados
            </p>
            <p class="text-lg font-semibold mt-1">
              {{ pagos.length }}
            </p>
          </div>
          <div class="rounded-lg bg-success/10 p-3">
            <p class="text-xs text-success uppercase tracking-wide">
              Total cobrado
            </p>
            <p class="text-lg font-semibold text-success mt-1">
              {{ formatMonto(montoCobrado) }}
            </p>
          </div>
          <div class="rounded-lg bg-primary/10 p-3">
            <p class="text-xs text-primary uppercase tracking-wide">
              Cobrado hoy
            </p>
            <p class="text-lg font-semibold text-primary mt-1">
              {{ formatMonto(montoHoy) }} <span class="text-xs font-normal">({{ pagosHoy.length }})</span>
            </p>
          </div>
        </div>

        <!-- Filtros -->
        <div class="flex flex-wrap items-center gap-3">
          <UInput
            v-model="filtroMetodo"
            placeholder="Filtrar por método de pago..."
            icon="i-heroicons-magnifying-glass"
            class="w-64"
          />
          <USelect
            v-model="filtroEstado"
            :items="estadoOptions"
            placeholder="Estado de la venta"
            class="w-48"
          />
          <UButton
            v-if="hayFiltrosActivos"
            label="Limpiar filtros"
            icon="i-heroicons-x-mark"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="limpiarFiltros"
          />
        </div>

        <!-- Loading -->
        <div v-if="loading" class="text-center text-muted py-12">
          <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
          Cargando pagos…
        </div>

        <UCard v-else>
          <UTable
            ref="table"
            v-model:pagination="pagination"
            :data="pagosFiltrados"
            :columns="columns"
            :pagination-options="{ getPaginationRowModel: getPaginationRowModel() }"
          >
            <template #fecha-cell="{ row }">
              <span class="whitespace-nowrap">{{ formatFecha(row.original.fecha) }}</span>
            </template>
            <template #monto-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.monto) }}</span>
            </template>
            <template #vuelto-cell="{ row }">
              <span class="font-mono text-muted">
                {{ row.original.vuelto && new Decimal(row.original.vuelto).gt(0) ? formatMonto(row.original.vuelto) : '—' }}
              </span>
            </template>
            <template #customerNombre-cell="{ row }">
              <span class="text-muted">{{ row.original.customerNombre ?? '—' }}</span>
            </template>
            <template #venta-cell="{ row }">
              <NuxtLink
                :to="`/ventas/${row.original.ventaId}`"
                class="text-primary underline-offset-2 hover:underline"
              >
                Ver
              </NuxtLink>
            </template>
            <template #ventaEstado-cell="{ row }">
              <UBadge
                :color="estadoColor(row.original.ventaEstado)"
                :label="estadoLabel(row.original.ventaEstado)"
                variant="subtle"
                size="sm"
              />
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                <UIcon name="i-heroicons-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
                {{ hayFiltrosActivos ? 'Ningún pago coincide con los filtros.' : 'Sin pagos registrados.' }}
              </div>
            </template>
          </UTable>

          <div v-if="pagosFiltrados.length > pageSize" class="flex justify-end pt-4">
            <UPagination
              :page="(table?.tableApi?.getState().pagination.pageIndex || 0) + 1"
              :items-per-page="table?.tableApi?.getState().pagination.pageSize"
              :total="pagosFiltrados.length"
              @update:page="(p: number) => table?.tableApi?.setPageIndex(p - 1)"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
