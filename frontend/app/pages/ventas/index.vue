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
  totalReembolsado: string
  esNotaCredito: boolean
}

interface VentasResumenKpi {
  totalVentas: number
  /** NETO: `totalBruto − totalNotasCredito`, sin las canceladas. */
  totalFacturado: string
  totalBruto: string
  totalNotasCredito: string
  saldoPendiente: string
}

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const apiUrl = config.public.apiUrl
const cajaStore = useCajaStore()

const route = useRoute()
const router = useRouter()

const { pageSize } = useUserPreferences()

const filtroEstado = ref<string | undefined>()
const filtroCanal = ref<string | undefined>()

const listFilters = computed(() => ({
  estado: filtroEstado.value,
  canal: filtroCanal.value,
}))

const { items: ventas, meta, page, loading } =
  usePaginatedList<VentaResumen>({
    path: '/ventas',
    pageSize,
    filters: listFilters,
  })

const resumen = ref<VentasResumenKpi | null>(null)
const loadingResumen = ref(false)

// Mostrar o no la línea es presentación, no una cuenta: el monto ya viene
// calculado del backend.
const hayNotas = computed(() =>
  !!resumen.value && !new Decimal(resumen.value.totalNotasCredito).isZero(),
)

const drawerOpen = ref(false)
const ventaSeleccionadaId = ref<string | null>(null)

const { estadoColor, estadoLabel, estadoOptions } = useEstadoVenta()

function canalColor(canal: string): 'primary' | 'neutral' {
  return canal === 'online' ? 'primary' : 'neutral'
}

// Derivado de los REFUND aprobados en pasarela: NO es un estado de la venta en BD
function badgeReembolso(v: VentaResumen): { label: string, color: 'warning' | 'info' } | null {
  const reemb = new Decimal(v.totalReembolsado || '0')
  if (reemb.lte(0)) return null
  return reemb.gte(v.totalFinal)
    ? { label: 'Reembolsada', color: 'info' }
    : { label: 'Reemb. parcial', color: 'warning' }
}

function canalLabel(canal: string): string {
  const map: Record<string, string> = {
    fisico: 'Físico',
    online: 'Online',
  }
  return map[canal] ?? canal
}

const canalOptions = [
  { label: 'Físico', value: 'fisico' },
  { label: 'Online', value: 'online' },
]

const hayFiltrosActivos = computed(() => !!filtroEstado.value || !!filtroCanal.value)

function limpiarFiltros() {
  filtroEstado.value = undefined
  filtroCanal.value = undefined
}

// El "—" es solo de la carga inicial: una recarga (tras un cobro, una anulación
// o una NC desde el drawer) deja a la vista los valores de antes hasta que llega
// la respuesta nueva, igual que `InicioHoy.vue`.
const cargandoInicial = computed(() => loadingResumen.value && !resumen.value)

// Dos recargas pueden solaparse (dos cambios seguidos en el drawer) y la
// respuesta más vieja puede llegar última: solo cuenta la de la última llamada.
let pedidoResumen = 0

async function cargarResumen() {
  const pedido = ++pedidoResumen
  loadingResumen.value = true
  try {
    const nuevo = await useApiFetch<VentasResumenKpi>(`${apiUrl}/ventas/resumen`)
    if (pedido === pedidoResumen) resumen.value = nuevo
  }
  catch (e: unknown) {
    if (pedido === pedidoResumen) {
      const msg = apiErrorMsg(e, 'Error al cargar resumen')
      toast.add({ title: msg, color: 'error' })
    }
  }
  finally {
    if (pedido === pedidoResumen) loadingResumen.value = false
  }
}

function abrirDetalle(ventaId: string) {
  ventaSeleccionadaId.value = ventaId
  drawerOpen.value = true
}

function onSelectVenta(_e: Event, row: Row<VentaResumen>) {
  abrirDetalle(row.original.id)
}

function onDetalleUpdated(patch: {
  id: string
  estado: string
  montoPagado: string
  saldo: string
}) {
  // El resumen se vuelve a pedir: ya no se puede parchar con el saldo de la
  // fila. Una NC, una anulación o un cobro sobre una venta ya acreditada mueven
  // el resumen (que descuenta las NC con piso 0 y saca las canceladas) distinto
  // de lo que mueven el `saldo` de la fila, que sigue siendo total − pagado.
  void cargarResumen()
  const row = ventas.value.find(v => v.id === patch.id)
  if (!row) return
  row.estado = patch.estado
  row.montoPagado = patch.montoPagado
  row.saldo = patch.saldo
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
  // `GET /caja/activa` pide `MiCaja:Leer` (`CajaController`), que esta
  // pantalla no exige (solo `Ventas:Leer`) — sin el `.catch`, un rol que ve
  // ventas pero no tiene caja propia (ninguna, o un `403`) rompería esta carga
  // en silencio. Sin `cajaStore.activa`, el drawer nunca ve el camino angosto
  // de `puedeReimprimir` (`VentaDetalleDrawer.vue`): una cajera que entra
  // directo a `/ventas` (sin pasar por el POS o salones, que sí la cargan) no
  // veía "Reimprimir boleta" aunque el backend ya se lo permitiera. Mismo
  // molde que `salones/index.vue`.
  cajaStore.cargarActiva().catch(() => null)
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
      <div class="w-full space-y-6">
        <!-- Resumen -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div class="rounded-lg bg-muted p-3">
            <p class="text-xs text-muted uppercase tracking-wide">
              Ventas registradas
            </p>
            <p class="text-lg font-semibold mt-1">
              <template v-if="cargandoInicial">
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
              <template v-if="cargandoInicial">
                —
              </template>
              <template v-else>
                {{ formatMonto(resumen?.totalFacturado ?? '0') }}
              </template>
            </p>
            <p v-if="hayNotas" class="text-xs text-success mt-1">
              bruto {{ formatMonto(resumen!.totalBruto) }}
              · notas de crédito −{{ formatMonto(resumen!.totalNotasCredito) }}
            </p>
          </div>
          <div class="rounded-lg bg-warning/10 p-3">
            <p class="text-xs text-warning uppercase tracking-wide">
              Saldo pendiente
            </p>
            <p class="text-lg font-semibold text-warning mt-1">
              <template v-if="cargandoInicial">
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

        <CrudTable
          :data="ventas"
          :columns="columns"
          :loading="loading"
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
            <div class="flex flex-wrap items-center gap-1">
              <UBadge :color="estadoColor(row.original.estado)" :label="estadoLabel(row.original.estado)" variant="subtle" size="sm" />
              <UBadge
                v-if="row.original.esNotaCredito"
                color="info"
                label="NC"
                variant="subtle"
                size="sm"
              />
              <UBadge
                v-else-if="badgeReembolso(row.original)"
                :color="badgeReembolso(row.original)!.color"
                :label="badgeReembolso(row.original)!.label"
                variant="subtle"
                size="sm"
              />
            </div>
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
              <UIcon name="i-lucide-inbox" class="mx-auto mb-2 h-8 w-8 opacity-40" />
              {{ hayFiltrosActivos ? 'Ninguna venta coincide con los filtros.' : 'No hay ventas registradas.' }}
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

        <VentasVentaDetalleDrawer
          v-model:open="drawerOpen"
          :venta-id="ventaSeleccionadaId"
          @updated="onDetalleUpdated"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
