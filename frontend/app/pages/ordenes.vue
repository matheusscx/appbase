<script setup lang="ts">
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface OrdenRow {
  ordenId: string
  codigoOrden: string
  pagadorRef: string | null
  referenciaExterna: string | null
  descripcion: string
  monto: string
  moneda: string
  estado: string
  origen: string
  creadoEl: string
}

const { formatFecha, formatMonto } = useFormatters()
const { pageSize } = useUserPreferences()

const drawerOpen = ref(false)
const ordenSeleccionadaId = ref<string | null>(null)

const busqueda = ref('')
const busquedaActiva = ref('')
const filtroEstado = ref<string | undefined>()
const filtroOrigen = ref<string | undefined>()
const filtroFechaDesde = ref<string | undefined>()
const filtroFechaHasta = ref<string | undefined>()

let busquedaTimer: ReturnType<typeof setTimeout> | null = null
watch(busqueda, (value) => {
  if (busquedaTimer) clearTimeout(busquedaTimer)
  busquedaTimer = setTimeout(() => {
    busquedaActiva.value = value.trim()
  }, 300)
})

const listFilters = computed(() => ({
  estado: filtroEstado.value,
  origen: filtroOrigen.value,
  fechaDesde: filtroFechaDesde.value,
  fechaHasta: filtroFechaHasta.value,
  search: busquedaActiva.value || undefined,
}))

const { items: ordenes, meta, page, loading } =
  usePaginatedList<OrdenRow>({
    path: '/pasarela/admin/ordenes',
    pageSize,
    filters: listFilters,
  })

const estadoColor: Record<string, 'success' | 'error' | 'warning' | 'neutral' | 'info'> = {
  creada: 'neutral',
  en_proceso: 'warning',
  procesando: 'warning',
  pagada: 'success',
  pendiente: 'warning',
  conciliada: 'success',
  fallida: 'error',
  expirada: 'neutral',
  reembolsada: 'info',
}

const estadoLabels: Record<string, string> = {
  creada: 'Creada',
  en_proceso: 'En proceso',
  procesando: 'Procesando',
  pagada: 'Pagada',
  pendiente: 'Pendiente',
  conciliada: 'Conciliada',
  fallida: 'Fallida',
  expirada: 'Expirada',
  reembolsada: 'Reembolsada',
}

function estadoLabel(estado: string): string {
  return estadoLabels[estado] ?? estado
}

const estadoOptions = Object.entries(estadoLabels).map(([value, label]) => ({ label, value }))

const origenOptions = [
  { label: 'Interno', value: 'interno' },
  { label: 'API externa', value: 'api' },
]

const hayFiltrosActivos = computed(() =>
  !!filtroEstado.value || !!filtroOrigen.value || !!filtroFechaDesde.value
  || !!filtroFechaHasta.value || !!busquedaActiva.value,
)

function limpiarFiltros() {
  busqueda.value = ''
  busquedaActiva.value = ''
  filtroEstado.value = undefined
  filtroOrigen.value = undefined
  filtroFechaDesde.value = undefined
  filtroFechaHasta.value = undefined
}

function abrirDetalle(ordenId: string) {
  ordenSeleccionadaId.value = ordenId
  drawerOpen.value = true
}

function onSelectOrden(_e: Event, row: Row<OrdenRow>) {
  abrirDetalle(row.original.ordenId)
}

watch(drawerOpen, (isOpen) => {
  if (!isOpen) ordenSeleccionadaId.value = null
})

const columns: TableColumn<OrdenRow>[] = [
  { accessorKey: 'creadoEl', header: 'Fecha' },
  { accessorKey: 'descripcion', header: 'Descripción' },
  { accessorKey: 'codigoOrden', header: 'Código' },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'origen', header: 'Origen' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Órdenes de cobro" />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-4 py-6">
        <CrudPageHeader
          title="Órdenes de cobro"
          description="Historial de órdenes de cobro generadas a través de tus pasarelas de pago."
        />

        <!-- Filtros -->
        <div class="flex flex-wrap items-center gap-3">
          <UInput
            v-model="busqueda"
            icon="i-lucide-search"
            placeholder="Buscar por código, descripción o referencia..."
            class="min-w-48 flex-1 max-w-md"
          />
          <USelect
            v-model="filtroEstado"
            :items="estadoOptions"
            placeholder="Estado"
            class="w-44"
          />
          <USelect
            v-model="filtroOrigen"
            :items="origenOptions"
            placeholder="Origen"
            class="w-36"
          />
          <UInput
            :model-value="filtroFechaDesde"
            type="date"
            placeholder="Desde"
            class="w-40"
            @update:model-value="filtroFechaDesde = ($event as string) || undefined"
          />
          <UInput
            :model-value="filtroFechaHasta"
            type="date"
            placeholder="Hasta"
            class="w-40"
            @update:model-value="filtroFechaHasta = ($event as string) || undefined"
          />
          <UButton
            v-if="hayFiltrosActivos"
            label="Limpiar filtros"
            icon="i-lucide-x"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="limpiarFiltros"
          />
        </div>

        <!-- Loading -->
        <div v-if="loading" class="text-center text-muted py-12">
          <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
          Cargando órdenes…
        </div>

        <UCard v-else>
          <UTable
            :data="ordenes"
            :columns="columns"
            :ui="{ tr: 'cursor-pointer' }"
            @select="onSelectOrden"
          >
            <template #creadoEl-cell="{ row }">
              <span class="whitespace-nowrap">{{ formatFecha(row.original.creadoEl) }}</span>
            </template>
            <template #descripcion-cell="{ row }">
              <div>
                <p class="font-medium text-default">
                  {{ row.original.descripcion }}
                </p>
                <p v-if="row.original.referenciaExterna || row.original.pagadorRef" class="text-xs text-muted">
                  <span v-if="row.original.referenciaExterna">ref {{ row.original.referenciaExterna }}</span>
                  <span v-if="row.original.referenciaExterna && row.original.pagadorRef"> · </span>
                  <span v-if="row.original.pagadorRef">{{ row.original.pagadorRef }}</span>
                </p>
              </div>
            </template>
            <template #codigoOrden-cell="{ row }">
              <span class="font-mono text-xs text-muted">{{ row.original.codigoOrden }}</span>
            </template>
            <template #monto-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.monto) }}</span>
            </template>
            <template #estado-cell="{ row }">
              <UBadge :color="estadoColor[row.original.estado] ?? 'neutral'" :label="estadoLabel(row.original.estado)" variant="subtle" size="sm" />
            </template>
            <template #origen-cell="{ row }">
              <span class="text-muted capitalize">{{ row.original.origen === 'api' ? 'API' : 'Interno' }}</span>
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                <UIcon name="i-lucide-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
                {{ hayFiltrosActivos ? 'Ninguna orden coincide con los filtros.' : 'Sin órdenes de cobro todavía.' }}
              </div>
            </template>
          </UTable>

          <div v-if="meta.total > pageSize" class="flex justify-end pt-4">
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="meta.total"
            />
          </div>
        </UCard>

        <OrdenesOrdenDetalleDrawer
          v-model:open="drawerOpen"
          :orden-id="ordenSeleccionadaId"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
