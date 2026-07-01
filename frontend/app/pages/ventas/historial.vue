<script setup lang="ts">
import Decimal from 'decimal.js'

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
const page = ref(1)
const pageSize = 15

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

watch([filtroEstado, filtroCanal], () => { page.value = 1 })

const ventasPagina = computed(() => {
  const start = (page.value - 1) * pageSize
  return ventasFiltradas.value.slice(start, start + pageSize)
})

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
          <!-- Estado vacío -->
          <div v-if="ventasFiltradas.length === 0" class="py-10 text-center text-sm text-muted">
            <UIcon name="i-heroicons-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
            {{ hayFiltrosActivos ? 'Ninguna venta coincide con los filtros.' : 'No hay ventas registradas.' }}
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-default text-left text-xs text-muted uppercase tracking-wider">
                  <th class="py-2 pr-4 font-medium">Fecha</th>
                  <th class="py-2 pr-4 font-medium">Canal</th>
                  <th class="py-2 pr-4 font-medium">Estado</th>
                  <th class="py-2 pr-4 font-medium text-right">Total</th>
                  <th class="py-2 pr-4 font-medium text-right">Pagado</th>
                  <th class="py-2 font-medium text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="v in ventasPagina"
                  :key="v.id"
                  class="border-b border-default last:border-0 hover:bg-elevated cursor-pointer"
                  @click="navigateTo(`/ventas/${v.id}`)"
                >
                  <td class="py-2 pr-4">{{ formatFecha(v.fecha) }}</td>
                  <td class="py-2 pr-4 capitalize">{{ v.canal }}</td>
                  <td class="py-2 pr-4">
                    <UBadge :color="estadoColor(v.estado)" :label="estadoLabel(v.estado)" variant="subtle" size="sm" />
                  </td>
                  <td class="py-2 pr-4 text-right font-mono">{{ formatMonto(v.totalFinal) }}</td>
                  <td class="py-2 pr-4 text-right font-mono">{{ formatMonto(v.montoPagado) }}</td>
                  <td class="py-2 text-right font-mono" :class="new Decimal(v.saldo).gt(0) ? 'text-warning' : ''">
                    {{ formatMonto(v.saldo) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="ventasFiltradas.length > pageSize" class="flex justify-end pt-4">
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="ventasFiltradas.length"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
