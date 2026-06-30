<script setup lang="ts">
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
  <UCard>
    <template #header>
      <h2 class="text-lg font-semibold">
        Historial de ventas
      </h2>
    </template>

    <div v-if="loading" class="text-center text-muted py-8">
      Cargando...
    </div>
    <div v-else-if="!ventas.length" class="text-center text-muted py-8">
      No hay ventas registradas
    </div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-default text-left text-muted">
            <th class="py-2 pr-4">Fecha</th>
            <th class="py-2 pr-4">Canal</th>
            <th class="py-2 pr-4">Estado</th>
            <th class="py-2 pr-4 text-right">Total</th>
            <th class="py-2 pr-4 text-right">Pagado</th>
            <th class="py-2 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="v in ventas"
            :key="v.id"
            class="border-b border-default hover:bg-elevated cursor-pointer"
            @click="navigateTo(`/ventas/${v.id}`)"
          >
            <td class="py-2 pr-4">{{ formatFecha(v.fecha) }}</td>
            <td class="py-2 pr-4 capitalize">{{ v.canal }}</td>
            <td class="py-2 pr-4">
              <UBadge :color="estadoColor(v.estado)" :label="estadoLabel(v.estado)" variant="subtle" />
            </td>
            <td class="py-2 pr-4 text-right font-mono">{{ formatMonto(v.totalFinal) }}</td>
            <td class="py-2 pr-4 text-right font-mono">{{ formatMonto(v.montoPagado) }}</td>
            <td class="py-2 text-right font-mono">{{ formatMonto(v.saldo) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>
</template>
