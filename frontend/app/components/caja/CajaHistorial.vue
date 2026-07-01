<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TableColumn } from '@nuxt/ui'
import type { Caja } from '~/stores/caja'

const props = defineProps<{ usuarioId?: string }>()

const cajaStore = useCajaStore()
const permissionsStore = usePermissionsStore()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()

const todasActivo = ref(false)

const puedeVerTodas = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Caja', 'Ver todas'),
)

const historial = computed(() => {
  if (props.usuarioId) {
    return cajaStore.historial.filter(c => c.usuarioId === props.usuarioId)
  }
  return cajaStore.historial
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

async function cargar(todas = false): Promise<void> {
  try {
    await cajaStore.cargarHistorial(todas)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar historial', color: 'error' })
  }
}

async function toggleTodas(): Promise<void> {
  todasActivo.value = !todasActivo.value
  await cargar(todasActivo.value)
}

onMounted(() => cargar(!!props.usuarioId))

watch(() => props.usuarioId, (id) => cargar(!!id))
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-default">
          Historial de cajas
        </h2>
        <UButton
          v-if="puedeVerTodas && !usuarioId"
          size="sm"
          :color="todasActivo ? 'primary' : 'neutral'"
          :variant="todasActivo ? 'solid' : 'outline'"
          icon="i-heroicons-users"
          :label="todasActivo ? 'Ver mis cajas' : 'Ver todas'"
          @click="toggleTodas"
        />
      </div>
    </template>

    <!-- Tabla -->
    <UTable :data="historial" :columns="columns">
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
          <UIcon name="i-heroicons-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
          No hay cajas en el historial.
        </div>
      </template>
    </UTable>
  </UCard>
</template>
