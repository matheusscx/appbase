<script setup lang="ts">
import Decimal from 'decimal.js'

const cajaStore = useCajaStore()
const permissionsStore = usePermissionsStore()
const toast = useToast()

const todasActivo = ref(false)

const puedeVerTodas = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Caja', 'Ver todas'),
)

function formatFecha(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMonto(val: string | null): string {
  if (val === null || val === undefined) return '—'
  return new Decimal(val).toFixed(2)
}

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

onMounted(() => cargar(false))
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold">
          Historial de cajas
        </h2>
        <UButton
          v-if="puedeVerTodas"
          size="sm"
          :color="todasActivo ? 'primary' : 'neutral'"
          :variant="todasActivo ? 'solid' : 'outline'"
          icon="i-heroicons-users"
          :label="todasActivo ? 'Ver mis cajas' : 'Ver todas'"
          @click="toggleTodas"
        />
      </div>
    </template>

    <!-- Estado vacío -->
    <div
      v-if="cajaStore.historial.length === 0"
      class="py-10 text-center text-sm text-gray-500"
    >
      <UIcon name="i-heroicons-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
      No hay cajas en el historial.
    </div>

    <!-- Tabla -->
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 dark:border-gray-700 text-left text-xs text-gray-500 uppercase tracking-wider">
            <th class="pb-2 pr-4 font-medium">Apertura</th>
            <th class="pb-2 pr-4 font-medium">Cierre</th>
            <th class="pb-2 pr-4 font-medium">Estado</th>
            <th class="pb-2 pr-4 font-medium text-right">Saldo inicial</th>
            <th class="pb-2 pr-4 font-medium text-right">Saldo final</th>
            <th class="pb-2 font-medium text-right">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="caja in cajaStore.historial"
            :key="caja.id"
            class="border-b border-gray-100 dark:border-gray-800 last:border-0"
          >
            <td class="py-2 pr-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
              {{ formatFecha(caja.fechaApertura) }}
            </td>
            <td class="py-2 pr-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
              {{ formatFecha(caja.fechaCierre) }}
            </td>
            <td class="py-2 pr-4">
              <UBadge
                :color="caja.estado === 'abierta' ? 'success' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ caja.estado }}
              </UBadge>
            </td>
            <td class="py-2 pr-4 text-right font-mono">
              {{ formatMonto(caja.saldoInicial) }}
            </td>
            <td class="py-2 pr-4 text-right font-mono">
              {{ formatMonto(caja.saldoFinal) }}
            </td>
            <td class="py-2 text-right font-mono">
              <span
                v-if="caja.diferencia !== null"
                :class="diferenciaPositiva(caja.diferencia)
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'"
              >
                {{ diferenciaPositiva(caja.diferencia) ? '+' : '' }}{{ formatMonto(caja.diferencia) }}
              </span>
              <span v-else class="text-gray-400">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>
</template>
