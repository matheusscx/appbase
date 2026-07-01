<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TableColumn } from '@nuxt/ui'

const props = defineProps<{
  caja: {
    id: string
    estado: string
    saldoInicial: string
    fechaApertura: string
  }
  readonly?: boolean
}>()

const cajaStore = useCajaStore()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const { pageSize } = useUserPreferences()

const movimientoModalOpen = ref(false)
const cierreModalOpen = ref(false)
const filtroTipo = ref<string | undefined>()

const listPath = computed(() => `/caja/${props.caja.id}/movimientos`)
const listFilters = computed(() => ({ tipo: filtroTipo.value }))

const { items: movimientos, meta, page, loading, fetch: recargarMovimientos } =
  usePaginatedList<{
    id: string
    tipo: string
    concepto: string
    monto: string
    referencia: string | null
    fecha: string
    ventaId: string | null
  }>({
    path: listPath,
    pageSize,
    filters: listFilters,
  })

const loadingResumen = computed(() => cajaStore.loadingResumenTurno)

const totalEntradas = computed(() =>
  new Decimal(cajaStore.resumenTurno?.totalEntradas ?? '0'),
)
const totalSalidas = computed(() =>
  new Decimal(cajaStore.resumenTurno?.totalSalidas ?? '0'),
)
const saldoEsperado = computed(() =>
  new Decimal(cajaStore.resumenTurno?.saldoEsperado ?? props.caja.saldoInicial),
)

const hayFiltrosActivos = computed(() => !!filtroTipo.value)

const tipoOptions = [
  { label: 'Entrada', value: 'entrada' },
  { label: 'Salida', value: 'salida' },
]

function limpiarFiltros() {
  filtroTipo.value = undefined
}

async function cargarResumen() {
  try {
    await cajaStore.cargarResumenTurno(props.caja.id)
  }
  catch {
    toast.add({ title: 'Error al cargar resumen del turno', color: 'error' })
  }
}

async function recargar() {
  await Promise.all([recargarMovimientos(), cargarResumen()])
}

onMounted(cargarResumen)

watch(() => props.caja.id, () => {
  cargarResumen()
})

const columns: TableColumn<typeof movimientos.value[number]>[] = [
  { accessorKey: 'fecha', header: 'Fecha' },
  { accessorKey: 'tipo', header: 'Tipo' },
  { accessorKey: 'concepto', header: 'Concepto' },
  { accessorKey: 'referencia', header: 'Referencia' },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <!-- Header card -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-semibold text-default">
                Caja
              </h2>
              <UBadge :color="caja.estado === 'abierta' ? 'success' : 'neutral'" variant="soft">
                {{ caja.estado.toUpperCase() }}
              </UBadge>
            </div>
            <p class="text-sm text-muted mt-0.5">
              Apertura: {{ formatFecha(caja.fechaApertura) }}
            </p>
          </div>
          <div v-if="!readonly" class="flex gap-2">
            <UButton
              icon="i-lucide-circle-plus"
              color="neutral"
              variant="outline"
              @click="movimientoModalOpen = true"
            >
              + Movimiento
            </UButton>
            <UButton
              icon="i-lucide-lock"
              color="error"
              variant="soft"
              @click="cierreModalOpen = true"
            >
              Cerrar caja
            </UButton>
          </div>
        </div>
      </template>

      <!-- Resumen financiero -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="rounded-lg bg-muted p-3">
          <p class="text-xs text-muted uppercase tracking-wide">
            Saldo inicial
          </p>
          <p class="text-lg font-semibold text-default mt-1">
            {{ formatMonto(caja.saldoInicial) }}
          </p>
        </div>
        <div class="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
          <p class="text-xs text-green-600 dark:text-green-400 uppercase tracking-wide">
            Entradas
          </p>
          <p class="text-lg font-semibold text-green-700 dark:text-green-300 mt-1">
            <template v-if="loadingResumen">
              —
            </template>
            <template v-else>
              + {{ formatMonto(totalEntradas) }}
            </template>
          </p>
        </div>
        <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
          <p class="text-xs text-red-600 dark:text-red-400 uppercase tracking-wide">
            Salidas
          </p>
          <p class="text-lg font-semibold text-red-700 dark:text-red-300 mt-1">
            <template v-if="loadingResumen">
              —
            </template>
            <template v-else>
              - {{ formatMonto(totalSalidas) }}
            </template>
          </p>
        </div>
        <div class="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3">
          <p class="text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wide">
            Saldo esperado
          </p>
          <p class="text-lg font-semibold text-blue-700 dark:text-blue-300 mt-1">
            <template v-if="loadingResumen">
              —
            </template>
            <template v-else>
              {{ formatMonto(saldoEsperado) }}
            </template>
          </p>
        </div>
      </div>
    </UCard>

    <!-- Movimientos -->
    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="text-sm font-semibold text-default">
            Movimientos del turno
            <span v-if="cajaStore.resumenTurno" class="text-muted font-normal">
              ({{ cajaStore.resumenTurno.totalMovimientos }})
            </span>
          </h3>
          <div class="flex items-center gap-2">
            <USelect
              v-model="filtroTipo"
              :items="tipoOptions"
              placeholder="Tipo"
              class="w-36"
            />
            <UButton
              v-if="hayFiltrosActivos"
              label="Limpiar"
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="sm"
              @click="limpiarFiltros"
            />
          </div>
        </div>
      </template>

      <div v-if="loading" class="py-8 text-center text-sm text-muted">
        <UIcon name="i-lucide-loader" class="w-5 h-5 animate-spin mx-auto mb-1" />
        Cargando movimientos…
      </div>

      <template v-else>
        <UTable :data="movimientos" :columns="columns">
          <template #fecha-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatFecha(row.original.fecha) }}</span>
          </template>
          <template #tipo-cell="{ row }">
            <UBadge
              :color="row.original.tipo === 'entrada' ? 'success' : 'error'"
              variant="subtle"
              size="sm"
              :label="row.original.tipo === 'entrada' ? 'Entrada' : 'Salida'"
            />
          </template>
          <template #concepto-cell="{ row }">
            <div class="min-w-0">
              <p class="truncate">{{ row.original.concepto }}</p>
              <NuxtLink
                v-if="row.original.ventaId"
                :to="{ path: '/ventas', query: { venta: row.original.ventaId } }"
                class="text-xs text-highlighted hover:underline"
              >
                Ver venta
              </NuxtLink>
            </div>
          </template>
          <template #referencia-cell="{ row }">
            <span class="text-muted">{{ row.original.referencia ?? '—' }}</span>
          </template>
          <template #monto-cell="{ row }">
            <span
              class="font-mono font-semibold"
              :class="row.original.tipo === 'entrada'
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'"
            >
              {{ row.original.tipo === 'entrada' ? '+' : '-' }}
              {{ formatMonto(row.original.monto) }}
            </span>
          </template>
          <template #empty>
            <div class="py-10 text-center text-sm text-muted">
              <UIcon name="i-lucide-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
              {{ hayFiltrosActivos
                ? 'Ningún movimiento coincide con los filtros.'
                : 'Sin movimientos registrados en este turno.' }}
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
      </template>
    </UCard>

    <!-- Modals -->
    <template v-if="!readonly">
      <CajaMovimientoModal
        v-model:open="movimientoModalOpen"
        :caja-id="caja.id"
        @saved="recargar"
      />
      <CajaCierreModal
        v-model:open="cierreModalOpen"
        :caja-id="caja.id"
        :saldo-esperado="saldoEsperado"
      />
    </template>
  </div>
</template>
