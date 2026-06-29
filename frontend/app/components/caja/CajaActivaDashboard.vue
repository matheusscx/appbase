<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Caja } from '~/stores/caja'

const props = defineProps<{
  caja: Caja
}>()

const cajaStore = useCajaStore()
const toast = useToast()

const movimientoModalOpen = ref(false)
const cierreModalOpen = ref(false)

onMounted(async () => {
  try {
    await cajaStore.cargarMovimientos(props.caja.id)
  }
  catch {
    toast.add({ title: 'Error al cargar movimientos', color: 'error' })
  }
})

const totalEntradas = computed(() => {
  return cajaStore.movimientos
    .filter(m => m.tipo === 'entrada')
    .reduce((acc, m) => acc.plus(new Decimal(m.monto)), new Decimal(0))
})

const totalSalidas = computed(() => {
  return cajaStore.movimientos
    .filter(m => m.tipo === 'salida')
    .reduce((acc, m) => acc.plus(new Decimal(m.monto)), new Decimal(0))
})

const saldoEsperado = computed(() => {
  return new Decimal(props.caja.saldoInicial)
    .plus(totalEntradas.value)
    .minus(totalSalidas.value)
})

function formatMonto(value: string | Decimal): string {
  const d = value instanceof Decimal ? value : new Decimal(value)
  return new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(d.toNumber())
}

function formatFecha(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header card -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-semibold">
                Caja
              </h2>
              <UBadge color="success" variant="soft">
                ABIERTA
              </UBadge>
            </div>
            <p class="text-sm text-gray-500 mt-0.5">
              Apertura: {{ formatFecha(caja.fechaApertura) }}
            </p>
          </div>
          <div class="flex gap-2">
            <UButton
              icon="i-heroicons-plus-circle"
              color="neutral"
              variant="outline"
              @click="movimientoModalOpen = true"
            >
              + Movimiento
            </UButton>
            <UButton
              icon="i-heroicons-lock-closed"
              color="error"
              variant="soft"
              @click="cierreModalOpen = true"
            >
              Cerrar caja
            </UButton>
          </div>
        </div>
      </template>

      <!-- Resumen financiero -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
          <p class="text-xs text-gray-500 uppercase tracking-wide">
            Saldo inicial
          </p>
          <p class="text-lg font-semibold mt-1">
            {{ formatMonto(caja.saldoInicial) }}
          </p>
        </div>
        <div class="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
          <p class="text-xs text-green-600 dark:text-green-400 uppercase tracking-wide">
            Entradas
          </p>
          <p class="text-lg font-semibold text-green-700 dark:text-green-300 mt-1">
            + {{ formatMonto(totalEntradas) }}
          </p>
        </div>
        <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
          <p class="text-xs text-red-600 dark:text-red-400 uppercase tracking-wide">
            Salidas
          </p>
          <p class="text-lg font-semibold text-red-700 dark:text-red-300 mt-1">
            - {{ formatMonto(totalSalidas) }}
          </p>
        </div>
        <div class="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3">
          <p class="text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wide">
            Saldo esperado
          </p>
          <p class="text-lg font-semibold text-blue-700 dark:text-blue-300 mt-1">
            {{ formatMonto(saldoEsperado) }}
          </p>
        </div>
      </div>
    </UCard>

    <!-- Movimientos -->
    <UCard>
      <template #header>
        <h3 class="text-sm font-semibold">
          Movimientos del turno
        </h3>
      </template>

      <div
        v-if="cajaStore.loadingMovimientos"
        class="py-8 text-center text-sm text-gray-500"
      >
        <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin mx-auto mb-1" />
        Cargando movimientos…
      </div>
      <div
        v-else-if="!cajaStore.movimientos.length"
        class="py-8 text-center text-sm text-gray-500"
      >
        Sin movimientos registrados en este turno.
      </div>
      <ul
        v-else
        class="divide-y divide-gray-100 dark:divide-gray-800"
      >
        <li
          v-for="mov in cajaStore.movimientos"
          :key="mov.id"
          class="flex items-center justify-between py-3 gap-3"
        >
          <div class="flex items-center gap-3 min-w-0">
            <UIcon
              :name="mov.tipo === 'entrada' ? 'i-heroicons-arrow-down-circle' : 'i-heroicons-arrow-up-circle'"
              class="w-5 h-5 shrink-0"
              :class="mov.tipo === 'entrada' ? 'text-green-500' : 'text-red-500'"
            />
            <div class="min-w-0">
              <p class="text-sm font-medium truncate">
                {{ mov.concepto }}
              </p>
              <p
                v-if="mov.referencia"
                class="text-xs text-gray-400 truncate"
              >
                Ref: {{ mov.referencia }}
              </p>
              <p class="text-xs text-gray-400">
                {{ formatFecha(mov.fecha) }}
              </p>
            </div>
          </div>
          <span
            class="text-sm font-semibold shrink-0"
            :class="mov.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'"
          >
            {{ mov.tipo === 'entrada' ? '+' : '-' }} {{ formatMonto(mov.monto) }}
          </span>
        </li>
      </ul>
    </UCard>

    <!-- Modals -->
    <CajaMovimientoModal
      v-model:open="movimientoModalOpen"
      :caja-id="caja.id"
    />
    <CajaCierreModal
      v-model:open="cierreModalOpen"
      :caja-id="caja.id"
      :saldo-esperado="saldoEsperado"
    />
  </div>
</template>
