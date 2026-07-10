<script setup lang="ts">
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

const {
  items: ordenes,
  meta: ordenesMeta,
  page: ordenesPage,
  loading: loadingOrdenes,
} = usePaginatedList<OrdenRow>({ path: '/pasarela/admin/ordenes' })

const estadoColor: Record<string, 'success' | 'error' | 'warning' | 'neutral' | 'info'> = {
  pagada: 'success',
  fallida: 'error',
  en_proceso: 'warning',
  expirada: 'neutral',
  reembolsada: 'info',
  creada: 'neutral',
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Órdenes de cobro" />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <CrudPageHeader
          title="Órdenes de cobro"
          description="Historial de órdenes de cobro generadas a través de tus pasarelas de pago."
        />

        <div v-if="loadingOrdenes" class="text-center text-muted py-8">
          Cargando…
        </div>
        <div v-else-if="!ordenes.length" class="text-center text-muted py-8">
          Sin órdenes de cobro todavía.
        </div>
        <template v-else>
          <ul class="divide-y divide-default">
            <li v-for="o in ordenes" :key="o.ordenId" class="flex items-center justify-between gap-4 py-3">
              <div>
                <p class="font-medium text-default">
                  {{ o.descripcion }}
                </p>
                <p class="text-sm text-muted font-mono">
                  {{ o.codigoOrden }}
                  <span v-if="o.referenciaExterna"> · ref {{ o.referenciaExterna }}</span>
                  <span v-if="o.pagadorRef"> · {{ o.pagadorRef }}</span>
                </p>
              </div>
              <div class="flex items-center gap-3">
                <span class="font-medium text-default">{{ formatMonto(o.monto) }}</span>
                <UBadge :color="estadoColor[o.estado] ?? 'neutral'" variant="subtle">
                  {{ o.estado }}
                </UBadge>
                <span class="text-sm text-muted">{{ formatFecha(o.creadoEl) }}</span>
              </div>
            </li>
          </ul>
          <div v-if="ordenesMeta.total > ordenesMeta.pageSize" class="flex justify-end pt-4">
            <UPagination
              v-model:page="ordenesPage"
              :items-per-page="ordenesMeta.pageSize"
              :total="ordenesMeta.total"
            />
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
