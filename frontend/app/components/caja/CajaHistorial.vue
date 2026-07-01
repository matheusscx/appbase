<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import type { Caja } from '~/stores/caja'

const props = defineProps<{ usuarioId?: string }>()

const permissionsStore = usePermissionsStore()
const { formatMonto, formatFecha } = useFormatters()
const { pageSize } = useUserPreferences()

const todasActivo = ref(false)

const puedeVerTodas = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Caja', 'Ver todas'),
)

const listFilters = computed(() => ({
  usuarioId: props.usuarioId,
  todas: !props.usuarioId && todasActivo.value ? 'true' : undefined,
}))

const { items: historial, meta, page, loading } = usePaginatedList<Caja>({
  path: '/caja',
  pageSize,
  filters: listFilters,
})

const columns: TableColumn<Caja>[] = [
  { accessorKey: 'fechaApertura', header: 'Apertura' },
  { accessorKey: 'fechaCierre', header: 'Cierre' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'saldoInicial', header: 'Saldo inicial', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'saldoFinal', header: 'Saldo final', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'diferencia', header: 'Diferencia', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

function diferenciaPositiva(val: string | null): boolean {
  if (val === null || val === undefined) return true
  return new Decimal(val).gte(0)
}

function toggleTodas() {
  todasActivo.value = !todasActivo.value
}

function onSelectCaja(_e: Event, row: Row<Caja>) {
  navigateTo(`/caja/${row.original.id}`)
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-default">
          Historial de cajas
          <span v-if="meta.total" class="text-muted font-normal text-sm">
            ({{ meta.total }})
          </span>
        </h2>
        <UButton
          v-if="puedeVerTodas && !usuarioId"
          size="sm"
          :color="todasActivo ? 'primary' : 'neutral'"
          :variant="todasActivo ? 'solid' : 'outline'"
          icon="i-lucide-users"
          :label="todasActivo ? 'Ver mis cajas' : 'Ver todas'"
          @click="toggleTodas"
        />
      </div>
    </template>

    <div v-if="loading" class="py-8 text-center text-sm text-muted">
      <UIcon name="i-lucide-loader" class="w-5 h-5 animate-spin mx-auto mb-1" />
      Cargando historial…
    </div>

    <template v-else>
      <UTable
        :data="historial"
        :columns="columns"
        :ui="{ tr: 'cursor-pointer' }"
        @select="onSelectCaja"
      >
        <template #fechaApertura-cell="{ row }">
          <span class="text-default whitespace-nowrap">
            {{ formatFecha(row.original.fechaApertura) }}
          </span>
        </template>
        <template #fechaCierre-cell="{ row }">
          <span class="text-default whitespace-nowrap">
            {{ formatFecha(row.original.fechaCierre) }}
          </span>
        </template>
        <template #estado-cell="{ row }">
          <UBadge
            :color="row.original.estado === 'abierta' ? 'success' : 'neutral'"
            variant="subtle"
            size="sm"
          >
            {{ row.original.estado }}
          </UBadge>
        </template>
        <template #saldoInicial-cell="{ row }">
          <span class="font-mono">{{ formatMonto(row.original.saldoInicial) }}</span>
        </template>
        <template #saldoFinal-cell="{ row }">
          <span class="font-mono">{{ formatMonto(row.original.saldoFinal) }}</span>
        </template>
        <template #diferencia-cell="{ row }">
          <span
            v-if="row.original.diferencia !== null"
            class="font-mono"
            :class="diferenciaPositiva(row.original.diferencia)
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'"
          >
            {{ diferenciaPositiva(row.original.diferencia) ? '+' : '' }}{{ formatMonto(row.original.diferencia) }}
          </span>
          <span v-else class="font-mono text-muted">—</span>
        </template>
        <template #empty>
          <div class="py-10 text-center text-sm text-muted">
            <UIcon name="i-lucide-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
            No hay cajas en el historial.
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
