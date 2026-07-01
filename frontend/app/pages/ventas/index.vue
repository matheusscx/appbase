<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'

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

interface VentasResumenKpi {
  totalVentas: number
  totalFacturado: string
  saldoPendiente: string
}

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const apiUrl = config.public.apiUrl

const route = useRoute()
const router = useRouter()

const { pageSize } = useUserPreferences()

const filtroEstado = ref<string | undefined>()
const filtroCanal = ref<string | undefined>()

const listFilters = computed(() => ({
  estado: filtroEstado.value,
  canal: filtroCanal.value,
}))

const { items: ventas, meta, page, loading, fetch: recargarLista } =
  usePaginatedList<VentaResumen>({
    path: '/ventas',
    pageSize,
    filters: listFilters,
  })

const resumen = ref<VentasResumenKpi | null>(null)
const loadingResumen = ref(false)

const drawerOpen = ref(false)
const ventaSeleccionadaId = ref<string | null>(null)

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
  filtroEstado.value = undefined
  filtroCanal.value = undefined
}

async function cargarResumen() {
  loadingResumen.value = true
  try {
    resumen.value = await useApiFetch<VentasResumenKpi>(`${apiUrl}/ventas/resumen`)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar resumen', color: 'error' })
  }
  finally {
    loadingResumen.value = false
  }
}

async function cargar() {
  await Promise.all([recargarLista(), cargarResumen()])
}

function abrirDetalle(ventaId: string) {
  ventaSeleccionadaId.value = ventaId
  drawerOpen.value = true
}

function onSelectVenta(_e: Event, row: Row<VentaResumen>) {
  abrirDetalle(row.original.id)
}

function onDetalleUpdated() {
  cargar()
}

watch(drawerOpen, (isOpen) => {
  if (!isOpen) {
    ventaSeleccionadaId.value = null
    if (route.query.venta) {
      router.replace({ query: { ...route.query, venta: undefined } })
    }
  }
})

function abrirDesdeQuery() {
  const id = route.query.venta
  if (typeof id === 'string' && id) abrirDetalle(id)
}

onMounted(() => {
  cargarResumen()
  abrirDesdeQuery()
})

watch(() => route.query.venta, (id) => {
  if (typeof id === 'string' && id) abrirDetalle(id)
})

const columns: TableColumn<VentaResumen>[] = [
  { accessorKey: 'fecha', header: 'Fecha' },
  { accessorKey: 'canal', header: 'Canal' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'totalFinal', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'montoPagado', header: 'Pagado', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'saldo', header: 'Saldo', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Ventas" />
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
              <template v-if="loadingResumen">
                —
              </template>
              <template v-else>
                {{ resumen?.totalVentas ?? 0 }}
              </template>
            </p>
          </div>
          <div class="rounded-lg bg-success/10 p-3">
            <p class="text-xs text-success uppercase tracking-wide">
              Total facturado
            </p>
            <p class="text-lg font-semibold text-success mt-1">
              <template v-if="loadingResumen">
                —
              </template>
              <template v-else>
                {{ formatMonto(resumen?.totalFacturado ?? '0') }}
              </template>
            </p>
          </div>
          <div class="rounded-lg bg-warning/10 p-3">
            <p class="text-xs text-warning uppercase tracking-wide">
              Saldo pendiente
            </p>
            <p class="text-lg font-semibold text-warning mt-1">
              <template v-if="loadingResumen">
                —
              </template>
              <template v-else>
                {{ formatMonto(resumen?.saldoPendiente ?? '0') }}
              </template>
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
          Cargando ventas…
        </div>

        <UCard v-else>
          <UTable
            :data="ventas"
            :columns="columns"
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
                <UIcon name="i-lucide-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
                {{ hayFiltrosActivos ? 'Ninguna venta coincide con los filtros.' : 'No hay ventas registradas.' }}
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

        <VentasVentaDetalleDrawer
          v-model:open="drawerOpen"
          :venta-id="ventaSeleccionadaId"
          @updated="onDetalleUpdated"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
