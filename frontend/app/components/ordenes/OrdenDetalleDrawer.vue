<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface TransaccionOrden {
  transaccionId: string
  tipo: string
  estado: string
  monto: string | null
  codigoAutorizacion: string | null
  codigoRespuesta: string | null
  fechaTransaccion: string
}

interface OrdenDetalle {
  ordenId: string
  codigoOrden: string
  pagadorRef: string | null
  referenciaExterna: string | null
  ventaId: string | null
  descripcion: string
  monto: string
  moneda: string
  estado: string
  origen: string
  creadoEl: string
  transacciones: TransaccionOrden[]
}

const props = defineProps<{
  ordenId: string | null
}>()

const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const apiUrl = config.public.apiUrl

const orden = ref<OrdenDetalle | null>(null)
const loading = ref(false)

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

const tipoLabels: Record<string, string> = {
  AUTHORIZATION: 'Autorización',
  REFUND: 'Reembolso',
}

function tipoLabel(tipo: string): string {
  return tipoLabels[tipo] ?? tipo
}

const transaccionColumns: TableColumn<TransaccionOrden>[] = [
  { accessorKey: 'fechaTransaccion', header: 'Fecha' },
  { accessorKey: 'tipo', header: 'Tipo' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'codigoAutorizacion', header: 'Cód. autorización' },
]

async function cargar(id: string) {
  loading.value = true
  orden.value = null
  try {
    orden.value = await useApiFetch<OrdenDetalle>(`${apiUrl}/pasarela/admin/ordenes/${id}`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar la orden'), color: 'error' })
    open.value = false
  }
  finally {
    loading.value = false
  }
}

watch(
  () => [open.value, props.ordenId] as const,
  ([isOpen, id]) => {
    if (isOpen && id) cargar(id)
    else if (!isOpen) orden.value = null
  },
)
</script>

<template>
  <AppDrawer v-model:open="open" width="50%">
    <template #header>
      <div class="flex items-center gap-2">
        <span class="font-semibold text-default">Detalle de orden</span>
        <UBadge
          v-if="orden"
          :color="estadoColor[orden.estado] ?? 'neutral'"
          :label="estadoLabel(orden.estado)"
          variant="subtle"
          size="xs"
        />
      </div>
    </template>

    <template #body>
      <div v-if="loading" class="py-12 text-center text-muted">
        <UIcon name="i-lucide-loader" class="mx-auto mb-2 h-6 w-6 animate-spin" />
        Cargando orden…
      </div>

      <div v-else-if="orden" class="space-y-4">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Información general
            </h2>
          </template>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt class="text-muted">
                Fecha
              </dt>
              <dd class="font-medium">
                {{ formatFecha(orden.creadoEl) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Origen
              </dt>
              <dd class="font-medium capitalize">
                {{ orden.origen === 'api' ? 'API externa' : 'Interno' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Código de orden
              </dt>
              <dd class="font-mono text-xs font-medium">
                {{ orden.codigoOrden }}
              </dd>
            </div>
            <div v-if="orden.referenciaExterna">
              <dt class="text-muted">
                Referencia externa
              </dt>
              <dd class="font-medium">
                {{ orden.referenciaExterna }}
              </dd>
            </div>
            <div v-if="orden.ventaId">
              <dt class="text-muted">
                Venta generada
              </dt>
              <dd class="flex flex-wrap items-center gap-x-4 gap-y-1">
                <NuxtLink
                  :to="{ path: '/ventas', query: { venta: orden.ventaId } }"
                  class="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                >
                  Ver venta
                  <UIcon name="i-lucide-arrow-right" class="h-3 w-3" />
                </NuxtLink>
                <NuxtLink
                  :to="{ path: '/pagos', query: { ventaId: orden.ventaId } }"
                  class="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                >
                  Ver en Pagos
                  <UIcon name="i-lucide-arrow-right" class="h-3 w-3" />
                </NuxtLink>
              </dd>
            </div>
            <div v-if="orden.pagadorRef">
              <dt class="text-muted">
                Pagador
              </dt>
              <dd class="font-medium">
                {{ orden.pagadorRef }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Descripción
              </dt>
              <dd class="font-medium">
                {{ orden.descripcion }}
              </dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">
                Monto
              </h2>
              <span class="font-mono text-lg font-semibold">{{ formatMonto(orden.monto) }}</span>
            </div>
          </template>
          <p class="text-sm text-muted">
            Moneda: {{ orden.moneda }}
          </p>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Historial de transacciones
            </h2>
          </template>
          <UTable :data="orden.transacciones" :columns="transaccionColumns">
            <template #fechaTransaccion-cell="{ row }">
              <span class="whitespace-nowrap">{{ formatFecha(row.original.fechaTransaccion) }}</span>
            </template>
            <template #tipo-cell="{ row }">
              {{ tipoLabel(row.original.tipo) }}
            </template>
            <template #estado-cell="{ row }">
              <UBadge :color="estadoColor[row.original.estado] ?? 'neutral'" :label="row.original.estado" variant="subtle" size="sm" />
            </template>
            <template #monto-cell="{ row }">
              <span class="font-mono">{{ row.original.monto ? formatMonto(row.original.monto) : '—' }}</span>
            </template>
            <template #codigoAutorizacion-cell="{ row }">
              <span class="font-mono text-xs text-muted">{{ row.original.codigoAutorizacion ?? '—' }}</span>
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                <UIcon name="i-lucide-inbox" class="mx-auto mb-2 h-8 w-8 opacity-40" />
                Sin transacciones registradas.
              </div>
            </template>
          </UTable>
        </UCard>
      </div>

      <div v-else class="py-12 text-center text-muted">
        <UIcon name="i-lucide-triangle-alert" class="mx-auto mb-2 h-8 w-8 opacity-40" />
        No se encontró la orden.
      </div>
    </template>

    <template #actions>
      <UButton
        color="neutral"
        variant="ghost"
        @click="open = false"
      >
        Cerrar
      </UButton>
    </template>
  </AppDrawer>
</template>
