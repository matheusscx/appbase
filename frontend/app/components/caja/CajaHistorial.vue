<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import type { Caja } from '~/stores/caja'

const props = defineProps<{ usuarioId?: string; cajonId?: string; basePath: string; todas?: boolean }>()

const route = useRoute()

const { formatMonto, formatFecha } = useFormatters()
const { pageSize } = useUserPreferences()

const usuarioIdEfectivo = computed(() => {
  if (props.usuarioId) return props.usuarioId
  const id = route.query.usuarioId
  return typeof id === 'string' && id ? id : undefined
})

const cajonIdEfectivo = computed(() => {
  if (props.cajonId) return props.cajonId
  const id = route.query.cajonId
  return typeof id === 'string' && id ? id : undefined
})

const listFilters = computed(() => ({
  usuarioId: usuarioIdEfectivo.value,
  cajonId: cajonIdEfectivo.value,
  todas: !usuarioIdEfectivo.value && !cajonIdEfectivo.value && props.todas ? 'true' : undefined,
}))

const { items: historial, meta, page, loading } = usePaginatedList<Caja>({
  path: '/caja',
  pageSize,
  filters: listFilters,
})

const columns: TableColumn<Caja>[] = [
  { accessorKey: 'fechaApertura', header: 'Apertura' },
  { accessorKey: 'fechaCierre', header: 'Cierre' },
  { accessorKey: 'cajonNombre', header: 'Caja' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'saldoInicial', header: 'Saldo inicial', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'saldoFinal', header: 'Saldo final', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'diferenciaTotal', header: 'Diferencia', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

function diferenciaPositiva(val: string | null | undefined): boolean {
  if (val === null || val === undefined) return true
  return new Decimal(val).gte(0)
}

function onSelectCaja(_e: Event, row: Row<Caja>) {
  navigateTo(`${props.basePath}/${row.original.id}`)
}
</script>

<template>
  <UCard class="w-full">
    <template #header>
      <h2 class="text-base font-semibold text-default">
        Historial de cajas
        <span v-if="meta.total" class="text-muted font-normal text-sm">
          ({{ meta.total }})
        </span>
      </h2>
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
        <template #cajonNombre-cell="{ row }">
          <span class="text-default">{{ row.original.cajonNombre ?? '—' }}</span>
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
        <!-- Suma de TODAS las líneas del arqueo, no solo el efectivo: con la
             columna sobre `diferencia` una caja cerrada con -500 en tarjeta se
             veía como "+0" acá y como "-500" al abrir el detalle. -->
        <template #diferenciaTotal-cell="{ row }">
          <span
            v-if="row.original.diferenciaTotal != null"
            class="font-mono"
            :class="diferenciaPositiva(row.original.diferenciaTotal)
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'"
          >
            {{ diferenciaPositiva(row.original.diferenciaTotal) ? '+' : '' }}{{ formatMonto(row.original.diferenciaTotal) }}
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
