<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import type { PagosResumen } from '~/composables/usePaginatedList'

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
  numeroCuotas: number | null
  tipoPago: string | null
  tarjetaUltimos4: string | null
}

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  habilitada: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const apiUrl = config.public.apiUrl

const route = useRoute()
const router = useRouter()

const pagoSeleccionado = ref<PagoLedger | null>(null)
const detalleOpen = ref(false)

function onSelectPago(_e: Event, row: Row<PagoLedger>) {
  pagoSeleccionado.value = row.original
  detalleOpen.value = true
}

const filtroMetodo = ref<string | undefined>()
const filtroEstado = ref<string | undefined>()
const filtroVentaId = ref<string | undefined>(
  typeof route.query.ventaId === 'string' ? route.query.ventaId : undefined,
)

const { pageSize } = useUserPreferences()

const listFilters = computed(() => ({
  metodoPagoId: filtroMetodo.value,
  ventaEstado: filtroEstado.value,
  ventaId: filtroVentaId.value,
}))

const { items: pagos, meta, page, loading } =
  usePaginatedList<PagoLedger>({
    path: '/pagos',
    pageSize,
    filters: listFilters,
  })

const resumen = ref<PagosResumen | null>(null)
const loadingResumen = ref(false)

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

const metodosPago = ref<MetodoPago[]>([])
const metodoOptions = computed(() =>
  metodosPago.value
    .filter(m => m.habilitada)
    .map(m => ({ label: m.nombre, value: m.metodoPagoId })),
)

const hayFiltrosActivos = computed(() =>
  !!filtroMetodo.value || !!filtroEstado.value || !!filtroVentaId.value,
)

function limpiarFiltros() {
  filtroMetodo.value = undefined
  filtroEstado.value = undefined
  quitarFiltroVenta()
}

function quitarFiltroVenta() {
  filtroVentaId.value = undefined
  if (route.query.ventaId) {
    router.replace({ query: { ...route.query, ventaId: undefined } })
  }
}

async function cargarResumen() {
  loadingResumen.value = true
  try {
    resumen.value = await useApiFetch<PagosResumen>(`${apiUrl}/pagos/resumen`)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar resumen', color: 'error' })
  }
  finally {
    loadingResumen.value = false
  }
}

async function cargarMetodos() {
  try {
    metodosPago.value = await useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`)
  }
  catch {
    // El listado sigue funcionando sin filtro de método
  }
}

async function cargar() {
  await Promise.all([cargarResumen(), cargarMetodos()])
}

watch(() => route.query.ventaId, (id) => {
  filtroVentaId.value = typeof id === 'string' && id ? id : undefined
})

const columns: TableColumn<PagoLedger>[] = [
  { accessorKey: 'fecha', header: 'Fecha' },
  { accessorKey: 'metodoNombre', header: 'Método' },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'vuelto', header: 'Vuelto', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'customerNombre', header: 'Cliente' },
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
      <div class="w-full space-y-6">
        <!-- Resumen -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div class="rounded-lg bg-muted p-3">
            <p class="text-xs text-muted uppercase tracking-wide">
              Pagos registrados
            </p>
            <p class="text-lg font-semibold mt-1">
              {{ loadingResumen ? '…' : (resumen?.totalPagos ?? 0) }}
            </p>
          </div>
          <div class="rounded-lg bg-success/10 p-3">
            <p class="text-xs text-success uppercase tracking-wide">
              Total cobrado
            </p>
            <p class="text-lg font-semibold text-success mt-1">
              {{ loadingResumen ? '…' : formatMonto(resumen?.montoCobrado ?? '0') }}
            </p>
          </div>
          <div class="rounded-lg bg-primary/10 p-3">
            <p class="text-xs text-primary uppercase tracking-wide">
              Cobrado hoy
            </p>
            <p class="text-lg font-semibold text-primary mt-1">
              {{ loadingResumen ? '…' : formatMonto(resumen?.montoHoy ?? '0') }}
              <span class="text-xs font-normal">({{ resumen?.pagosHoy ?? 0 }})</span>
            </p>
          </div>
        </div>

        <!-- Filtros -->
        <div class="flex flex-wrap items-center gap-3">
          <USelectMenu
            v-model="filtroMetodo"
            :items="metodoOptions"
            value-key="value"
            placeholder="Método de pago"
            searchable
            class="w-64"
          />
          <USelect
            v-model="filtroEstado"
            :items="estadoOptions"
            placeholder="Estado de la venta"
            class="w-48"
          />
          <UBadge
            v-if="filtroVentaId"
            color="primary"
            variant="subtle"
            class="gap-1"
          >
            Filtrado por venta
            <UButton
              icon="i-lucide-x"
              variant="link"
              color="primary"
              size="xs"
              class="p-0"
              @click="quitarFiltroVenta"
            />
          </UBadge>
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

        <CrudTable
          :data="pagos"
          :columns="columns"
          :loading="loading"
          :ui="{ tr: 'cursor-pointer' }"
          @select="onSelectPago"
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
              <UIcon name="i-lucide-inbox" class="mx-auto mb-2 h-8 w-8 opacity-40" />
              {{ hayFiltrosActivos ? 'Ningún pago coincide con los filtros.' : 'Sin pagos registrados.' }}
            </div>
          </template>
          <template v-if="meta.total > pageSize" #footer>
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="meta.total"
            />
          </template>
        </CrudTable>
      </div>
    </template>
  </UDashboardPanel>

  <PagosPagoDetalleDrawer
    v-model:open="detalleOpen"
    :pago="pagoSeleccionado"
  />
</template>
