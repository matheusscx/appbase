<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import {
  FILTRO_DOCUMENTO_ITEMS,
  resumenEmisores,
  type EmisorDocumento,
  type FiltroDocumento,
} from '~/composables/useDocumentosVenta'
import { hoyLocal } from '~/composables/useVigenciaRegla'

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
  /** Corrección: una NC o una devolución interna. Del backend (`venta_referencia_id`). */
  esCorreccion: boolean
  /** Corrección con el tipo NC: falso en la devolución interna. */
  esNotaCredito: boolean
  /** Quién emitió lo vigente de la venta (sin el voucher duplicado). Del backend. */
  emisores: EmisorDocumento[]
  tieneDuplicado: boolean
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
const filtroDocumento = ref<FiltroDocumento | undefined>()

// La pantalla parte en "Hoy" (owner, 2026-10-16): la cajera que mira el historial quiere lo del día, no
// contar filas entre todo lo vendido. Arranca optimista con el reloj del navegador y se corrige cuando
// llega el día de negocio del servidor (si la jornada corta a las 05:00, a la 01:00 "hoy" sigue siendo
// ayer): mismo patrón que `reportes/varianza.vue`. Si ya tocó el rango, no se pisa.
const hoyLocalInicial = hoyLocal()
const filtroDesde = ref<string | null>(hoyLocalInicial)
const filtroHasta = ref<string | null>(hoyLocalInicial)
const { diaNegocioHoy, cargar: cargarDiaNegocio } = useDiaNegocio()

async function ajustarAlDiaDeNegocio() {
  await cargarDiaNegocio()
  if (!diaNegocioHoy.value || diaNegocioHoy.value === hoyLocalInicial) return
  if (filtroDesde.value !== hoyLocalInicial || filtroHasta.value !== hoyLocalInicial) return
  filtroDesde.value = diaNegocioHoy.value
  filtroHasta.value = diaNegocioHoy.value
}
const hoy = computed(() => diaNegocioHoy.value ?? hoyLocalInicial)
const rangoEsHoy = computed(() => filtroDesde.value === hoy.value && filtroHasta.value === hoy.value)

// El folio se busca con un retardo corto (como el catálogo): cada tecla no pide una lista nueva.
// Es exacto, y un folio puede ser de cualquier día: mientras hay uno, el rango no se aplica a la lista.
const folioTexto = ref('')
const filtroFolio = ref<string | undefined>()
// "Por cobrar" del Inicio (04.10): las ventas con saldo, de cualquier fecha. Llega por la URL y,
// mientras está, manda sobre el estado y el rango (como el folio): una deuda vieja sigue siendo deuda.
const filtroPorCobrar = ref(route.query.porCobrar === 'true')
let esperaFolio: ReturnType<typeof setTimeout> | null = null
watch(folioTexto, (texto) => {
  if (esperaFolio) clearTimeout(esperaFolio)
  esperaFolio = setTimeout(() => {
    esperaFolio = null
    filtroFolio.value = texto.trim() || undefined
  }, 400)
})
onBeforeUnmount(() => { if (esperaFolio) clearTimeout(esperaFolio) })

const rangoParams = computed(() => ({
  desde: filtroDesde.value ?? undefined,
  hasta: filtroHasta.value ?? undefined,
}))

const listFilters = computed(() => ({
  estado: filtroPorCobrar.value ? undefined : filtroEstado.value,
  porCobrar: filtroPorCobrar.value ? 'true' : undefined,
  canal: filtroCanal.value,
  documento: filtroDocumento.value,
  folio: filtroFolio.value,
  ...(filtroFolio.value || filtroPorCobrar.value ? {} : rangoParams.value),
}))

const { items: ventas, meta, page, loading, error, sinPermiso, fetch: fetchVentas } =
  usePaginatedList<VentaResumen>({
    path: '/ventas',
    pageSize,
    filters: listFilters,
  })

const resumen = ref<VentasResumenKpi | null>(null)
const loadingResumen = ref(false)

// Mostrar o no la línea es presentación, no una cuenta: el monto ya viene
// calculado del backend.
const saldoPendienteHay = computed(() => new Decimal(resumen.value?.saldoPendiente ?? '0').gt(0))

const hayNotas = computed(() =>
  !!resumen.value && !new Decimal(resumen.value.totalNotasCredito).isZero(),
)

const drawerOpen = ref(false)
const ventaSeleccionadaId = ref<string | null>(null)

const { estadoColor, estadoLabel, estadoOptions, canalLabel } = useEstadoVenta()

// La devolución interna no lleva el badge de emisores: su fila `nadie` no es un
// faltante. La nota de crédito sí lleva el de su documento: "Sin número" la trae
// como fila propia (la NC que falta anotar) y el contador tiene que ver de quién es.
function badgeEmisores(v: VentaResumen) {
  return v.esCorreccion && !v.esNotaCredito ? null : resumenEmisores(v.emisores)
}

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

const canalOptions = [
  { label: 'Físico', value: 'fisico' },
  { label: 'Online', value: 'online' },
]

const hayFiltrosActivos = computed(() =>
  filtroPorCobrar.value || !!filtroEstado.value || !!filtroCanal.value || !!filtroDocumento.value || !!filtroFolio.value || !rangoEsHoy.value,
)

// "Limpiar" vuelve a como abre la pantalla: hoy, sin nada más.
function limpiarFiltros() {
  filtroPorCobrar.value = false
  filtroEstado.value = undefined
  filtroCanal.value = undefined
  filtroDocumento.value = undefined
  folioTexto.value = ''
  filtroFolio.value = undefined
  filtroDesde.value = hoy.value
  filtroHasta.value = hoy.value
}

const etiquetaPeriodo = computed(() => {
  if (rangoEsHoy.value) return 'de hoy'
  return filtroDesde.value || filtroHasta.value ? 'del período' : 'registradas'
})
const textoVacio = computed(() =>
  rangoEsHoy.value ? 'Todavía no hay ventas hoy.' : 'No hay ventas registradas.',
)

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
    const query = new URLSearchParams()
    if (filtroDesde.value) query.set('desde', filtroDesde.value)
    if (filtroHasta.value) query.set('hasta', filtroHasta.value)
    const sufijo = query.size ? `?${query}` : ''
    const nuevo = await useApiFetch<VentasResumenKpi>(`${apiUrl}/ventas/resumen${sufijo}`)
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
  // fila. Una anulación o un cobro mueven el resumen (que saca las canceladas)
  // distinto de lo que mueven el `saldo` de la fila.
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

// Las tarjetas miden el mismo rango que la lista.
watch([filtroDesde, filtroHasta], () => { void cargarResumen() })

onMounted(() => {
  cargarResumen()
  void ajustarAlDiaDeNegocio()
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
  { id: 'documento', header: 'Documento' },
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
            <p class="text-xs text-muted">
              Ventas {{ etiquetaPeriodo }}
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
          <div class="rounded-lg bg-muted p-3">
            <p class="text-xs text-muted">
              Total facturado
            </p>
            <p class="text-lg font-semibold text-highlighted mt-1">
              <template v-if="cargandoInicial">
                —
              </template>
              <template v-else>
                {{ formatMonto(resumen?.totalFacturado ?? '0') }}
              </template>
            </p>
            <p v-if="hayNotas" class="text-xs text-muted mt-1">
              bruto {{ formatMonto(resumen!.totalBruto) }}
              · notas de crédito −{{ formatMonto(resumen!.totalNotasCredito) }}
            </p>
          </div>
          <div class="rounded-lg bg-muted p-3">
            <p class="text-xs text-muted">
              Saldo pendiente
            </p>
            <p class="text-lg font-semibold mt-1" :class="saldoPendienteHay ? 'text-warning' : 'text-highlighted'">
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
        <AppRangoFechas
          v-model:desde="filtroDesde"
          v-model:hasta="filtroHasta"
          :disabled="!!filtroFolio || filtroPorCobrar"
          qa="ventas-rango"
        />
        <div class="flex flex-wrap items-center gap-3">
          <UButton
            v-if="filtroPorCobrar"
            label="Por cobrar, de cualquier fecha"
            trailing-icon="i-lucide-x"
            color="warning"
            variant="subtle"
            class="min-h-11"
            aria-label="Por cobrar, de cualquier fecha. Quitar este filtro"
            @click="() => { filtroPorCobrar = false }"
          />
          <UInput
            v-model="folioTexto"
            icon="i-lucide-search"
            placeholder="Buscar por folio…"
            class="w-56"
          >
            <template v-if="folioTexto" #trailing>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="link"
                size="sm"
                aria-label="Borrar folio"
                @click="() => { folioTexto = '' }"
              />
            </template>
          </UInput>
          <USelect
            v-model="filtroEstado"
            :items="estadoOptions"
            :disabled="filtroPorCobrar"
            placeholder="Estado"
            class="w-48"
          />
          <USelect
            v-model="filtroCanal"
            :items="canalOptions"
            placeholder="Canal"
            class="w-44"
          />
          <USelect
            v-model="filtroDocumento"
            :items="FILTRO_DOCUMENTO_ITEMS"
            placeholder="Documento"
            class="w-48"
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
          :error="error"
          :sin-permiso="sinPermiso"
          recurso="las ventas"
          :vacio="textoVacio"
          filtrado-texto="Ninguna venta coincide con los filtros."
          :filtrado="hayFiltrosActivos"
          @reintentar="fetchVentas"
          @quitar-filtros="limpiarFiltros"
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
                v-if="row.original.esCorreccion"
                color="info"
                :label="row.original.esNotaCredito ? 'NC' : 'Dev. interna'"
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
          <template #documento-cell="{ row }">
            <div class="flex flex-wrap items-center gap-1">
              <UBadge
                v-if="badgeEmisores(row.original)"
                :color="badgeEmisores(row.original)!.color"
                :label="badgeEmisores(row.original)!.label"
                variant="subtle"
                size="sm"
              />
              <UBadge
                v-if="!row.original.esCorreccion && row.original.tieneDuplicado"
                color="info"
                label="Duplicado"
                variant="subtle"
                size="sm"
              />
            </div>
          </template>
          <template #totalFinal-cell="{ row }">
            <span>{{ formatMonto(row.original.totalFinal) }}</span>
          </template>
          <template #montoPagado-cell="{ row }">
            <span>{{ formatMonto(row.original.montoPagado) }}</span>
          </template>
          <template #saldo-cell="{ row }">
            <span :class="new Decimal(row.original.saldo).gt(0) ? 'text-warning' : ''">
              {{ formatMonto(row.original.saldo) }}
            </span>
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
