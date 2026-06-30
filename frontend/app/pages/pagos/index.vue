<script setup lang="ts">
import Decimal from 'decimal.js'

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

const pagosFiltrados = computed(() =>
  filtroMetodo.value
    ? pagos.value.filter(p => p.metodoNombre.toLowerCase().includes(filtroMetodo.value.toLowerCase()))
    : pagos.value,
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

onMounted(cargar)

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
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <h1 class="text-lg font-semibold flex-1">
        Pagos
      </h1>
    </div>

    <div class="flex items-center gap-3">
      <UInput
        v-model="filtroMetodo"
        placeholder="Filtrar por método de pago..."
        icon="i-heroicons-magnifying-glass"
        class="w-64"
      />
    </div>

    <div v-if="loading" class="text-center text-muted py-12">
      Cargando...
    </div>

    <UCard v-else>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-default text-left text-muted">
              <th class="py-2 pr-4">Fecha</th>
              <th class="py-2 pr-4">Método</th>
              <th class="py-2 pr-4 text-right">Monto</th>
              <th class="py-2 pr-4 text-right">Vuelto</th>
              <th class="py-2 pr-4">Cliente</th>
              <th class="py-2 pr-4">Venta</th>
              <th class="py-2">Estado venta</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="pagosFiltrados.length === 0">
              <td colspan="7" class="py-8 text-center text-muted">
                Sin pagos registrados.
              </td>
            </tr>
            <tr
              v-for="p in pagosFiltrados"
              :key="p.id"
              class="border-b border-default last:border-0"
            >
              <td class="py-2 pr-4 whitespace-nowrap">{{ formatFecha(p.fecha) }}</td>
              <td class="py-2 pr-4">{{ p.metodoNombre }}</td>
              <td class="py-2 pr-4 text-right font-mono">{{ formatMonto(p.monto) }}</td>
              <td class="py-2 pr-4 text-right font-mono text-muted">
                {{ p.vuelto && new Decimal(p.vuelto).gt(0) ? formatMonto(p.vuelto) : '—' }}
              </td>
              <td class="py-2 pr-4 text-muted">{{ p.customerNombre ?? '—' }}</td>
              <td class="py-2 pr-4">
                <NuxtLink
                  :to="`/ventas/${p.ventaId}`"
                  class="text-primary underline-offset-2 hover:underline"
                >
                  Ver
                </NuxtLink>
              </td>
              <td class="py-2">
                <UBadge
                  :color="estadoColor(p.ventaEstado)"
                  :label="estadoLabel(p.ventaEstado)"
                  variant="subtle"
                  size="sm"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
