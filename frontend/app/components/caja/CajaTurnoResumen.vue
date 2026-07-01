<script setup lang="ts">
import type Decimal from 'decimal.js'

defineProps<{
  saldoInicial: string
  totalEntradas: Decimal
  totalSalidas: Decimal
  saldoEsperado: Decimal
  loading?: boolean
}>()

const { formatMonto } = useFormatters()
</script>

<template>
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
    <div class="rounded-lg bg-muted p-3">
      <p class="text-xs text-muted uppercase tracking-wide">
        Saldo inicial
      </p>
      <p class="text-lg font-semibold text-default mt-1">
        {{ formatMonto(saldoInicial) }}
      </p>
    </div>
    <div class="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
      <p class="text-xs text-green-600 dark:text-green-400 uppercase tracking-wide">
        Entradas
      </p>
      <p class="text-lg font-semibold text-green-700 dark:text-green-300 mt-1">
        <template v-if="loading">
          —
        </template>
        <template v-else>
          + {{ formatMonto(totalEntradas) }}
        </template>
      </p>
    </div>
    <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
      <p class="text-xs text-red-600 dark:text-red-400 uppercase tracking-wide">
        Salidas
      </p>
      <p class="text-lg font-semibold text-red-700 dark:text-red-300 mt-1">
        <template v-if="loading">
          —
        </template>
        <template v-else>
          - {{ formatMonto(totalSalidas) }}
        </template>
      </p>
    </div>
    <div class="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3">
      <p class="text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wide">
        Saldo esperado
      </p>
      <p class="text-lg font-semibold text-blue-700 dark:text-blue-300 mt-1">
        <template v-if="loading">
          —
        </template>
        <template v-else>
          {{ formatMonto(saldoEsperado) }}
        </template>
      </p>
    </div>
  </div>
</template>
