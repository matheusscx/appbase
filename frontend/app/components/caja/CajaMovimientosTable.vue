<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const props = defineProps<{ cajaId: string }>()

const cajaStore = useCajaStore()
const { formatMonto, formatFecha } = useFormatters()
const { pageSize } = useUserPreferences()

const filtroTipo = ref<string | undefined>()

const listPath = computed(() => `/caja/${props.cajaId}/movimientos`)
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

const hayFiltrosActivos = computed(() => !!filtroTipo.value)

const tipoOptions = [
  { label: 'Entrada', value: 'entrada' },
  { label: 'Salida', value: 'salida' },
]

function limpiarFiltros() {
  filtroTipo.value = undefined
}

async function recargar() {
  await recargarMovimientos()
}

defineExpose({ recargar })

watch(() => props.cajaId, () => {
  filtroTipo.value = undefined
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
      <UTable
        :data="movimientos"
        :columns="columns"
        :ui="{
          root: 'max-h-[min(480px,60vh)] overflow-y-auto',
          thead: 'sticky top-0 z-10 bg-default',
        }"
      >
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
</template>
