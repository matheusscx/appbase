<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import { getPaginationRowModel } from '@tanstack/vue-table'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface VentaResumen {
  id: string
  canal: string
  estado: string
  totalFinal: string
  montoPagado: string
  saldo: string
  fecha: string
  creadoEl: string
}

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const apiUrl = config.public.apiUrl

const ventas = ref<VentaResumen[]>([])
const loading = ref(false)
const filtroEstado = ref('')
const filtroCanal = ref('')
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

function canalColor(canal: string): 'primary' | 'neutral' {
  return canal === 'online' ? 'primary' : 'neutral'
}

function canalLabel(canal: string): string {
  const map: Record<string, string> = {
    fisico: 'Físico',
    online: 'Online',
  }
  return map[canal] ?? canal
}

const estadoOptions = [
  { label: estadoLabel('pendiente'), value: 'pendiente' },
  { label: estadoLabel('pagada_parcial'), value: 'pagada_parcial' },
  { label: estadoLabel('pagada'), value: 'pagada' },
  { label: estadoLabel('cancelada'), value: 'cancelada' },
  { label: estadoLabel('borrador'), value: 'borrador' },
]

const canalOptions = [
  { label: 'Físico', value: 'fisico' },
  { label: 'Online', value: 'online' },
]

const hayFiltrosActivos = computed(() => !!filtroEstado.value || !!filtroCanal.value)

function limpiarFiltros() {
  filtroEstado.value = ''
  filtroCanal.value = ''
}

const ventasFiltradas = computed(() => {
  let result = ventas.value
  if (filtroEstado.value) result = result.filter(v => v.estado === filtroEstado.value)
  if (filtroCanal.value) result = result.filter(v => v.canal === filtroCanal.value)
  return result
})

watch([filtroEstado, filtroCanal], () => { pagination.value.pageIndex = 0 })

const totalFacturado = computed(() =>
  ventas.value.reduce((acc, v) => acc.plus(new Decimal(v.totalFinal)), new Decimal(0)),
)

const saldoPendiente = computed(() =>
  ventas.value.reduce((acc, v) => acc.plus(new Decimal(v.saldo)), new Decimal(0)),
)

async function cargar() {
  loading.value = true
  try {
    ventas.value = await useApiFetch<VentaResumen[]>(`${apiUrl}/ventas`)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar ventas', color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function onSelectVenta(_e: Event, row: Row<VentaResumen>) {
  navigateTo(`/ventas/${row.original.id}`)
}

const columns: TableColumn<VentaResumen>[] = [
  { accessorKey: 'fecha', header: 'Fecha' },
  { accessorKey: 'canal', header: 'Canal' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'totalFinal', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'montoPagado', header: 'Pagado', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'saldo', header: 'Saldo', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

onMounted(cargar)
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Historial de ventas" />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-4 py-6">
        <!-- Resumen -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div class="rounded-lg bg-muted p-3">
            <p class="text-xs text-muted uppercase tracking-wide">
              Ventas registradas
            </p>
            <p class="text-lg font-semibold mt-1">
              {{ ventas.length }}
            </p>
          </div>
          <div class="rounded-lg bg-success/10 p-3">
            <p class="text-xs text-success uppercase tracking-wide">
              Total facturado
            </p>
            <p class="text-lg font-semibold text-success mt-1">
              {{ formatMonto(totalFacturado) }}
            </p>
          </div>
          <div class="rounded-lg bg-warning/10 p-3">
            <p class="text-xs text-warning uppercase tracking-wide">
              Saldo pendiente
            </p>
            <p class="text-lg font-semibold text-warning mt-1">
              {{ formatMonto(saldoPendiente) }}
            </p>
          </div>
        </div>

        <!-- Filtros -->
        <div class="flex flex-wrap items-center gap-3">
          <USelect
            v-model="filtroEstado"
            :items="estadoOptions"
            placeholder="Estado"
            class="w-48"
          />
          <USelect
            v-model="filtroCanal"
            :items="canalOptions"
            placeholder="Canal"
            class="w-44"
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
          Cargando ventas…
        </div>

        <UCard v-else>
          <UTable
            ref="table"
            v-model:pagination="pagination"
            :data="ventasFiltradas"
            :columns="columns"
            :pagination-options="{ getPaginationRowModel: getPaginationRowModel() }"
            :ui="{ tr: 'cursor-pointer' }"
            @select="onSelectVenta"
          >
            <template #fecha-cell="{ row }">
              <span class="whitespace-nowrap">{{ formatFecha(row.original.fecha) }}</span>
            </template>
            <template #canal-cell="{ row }">
              <UBadge :color="canalColor(row.original.canal)" :label="canalLabel(row.original.canal)" variant="subtle" size="sm" />
            </template>
            <template #estado-cell="{ row }">
              <UBadge :color="estadoColor(row.original.estado)" :label="estadoLabel(row.original.estado)" variant="subtle" size="sm" />
            </template>
            <template #totalFinal-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.totalFinal) }}</span>
            </template>
            <template #montoPagado-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.montoPagado) }}</span>
            </template>
            <template #saldo-cell="{ row }">
              <span class="font-mono" :class="new Decimal(row.original.saldo).gt(0) ? 'text-warning' : ''">
                {{ formatMonto(row.original.saldo) }}
              </span>
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                <UIcon name="i-heroicons-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
                {{ hayFiltrosActivos ? 'Ninguna venta coincide con los filtros.' : 'No hay ventas registradas.' }}
              </div>
            </template>
          </UTable>

          <div v-if="ventasFiltradas.length > pageSize" class="flex justify-end pt-4">
            <UPagination
              :page="(table?.tableApi?.getState().pagination.pageIndex || 0) + 1"
              :items-per-page="table?.tableApi?.getState().pagination.pageSize"
              :total="ventasFiltradas.length"
              @update:page="(p: number) => table?.tableApi?.setPageIndex(p - 1)"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
