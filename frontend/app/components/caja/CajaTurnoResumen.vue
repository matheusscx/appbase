<script setup lang="ts">
import type Decimal from 'decimal.js'

defineProps<{
  saldoInicial: string
  totalEntradas: Decimal
  totalSalidas: Decimal
  saldoEsperado: Decimal
  ciego?: boolean
  loading?: boolean
}>()

const { formatMonto } = useFormatters()
</script>

<template>
  <!-- Ciego: solo saldo inicial, el resto lo oculta el backend. -->
  <div v-if="ciego" class="rounded-lg bg-muted p-3 max-w-xs">
    <p class="text-xs text-muted">
      Saldo inicial
    </p>
    <p class="text-lg font-semibold text-default mt-1">
      {{ formatMonto(saldoInicial) }}
    </p>
  </div>

  <div v-else class="grid gap-4 sm:grid-cols-3">
    <!-- Protagonista: saldo esperado. -->
    <div class="sm:col-span-1 rounded-lg bg-muted p-4">
      <p class="text-xs text-muted">
        Saldo esperado
      </p>
      <p class="text-2xl font-bold text-highlighted mt-1">
        <template v-if="loading">
          —
        </template>
        <template v-else>
          {{ formatMonto(saldoEsperado) }}
        </template>
      </p>
    </div>

    <!-- Secundarias: inicial / entradas / salidas. -->
    <div class="sm:col-span-2 grid grid-cols-3 gap-3">
      <div class="rounded-lg bg-muted p-3">
        <p class="text-xs text-muted">
          Saldo inicial
        </p>
        <p class="text-base font-semibold text-default mt-1">
          {{ formatMonto(saldoInicial) }}
        </p>
      </div>
      <div class="rounded-lg bg-muted p-3">
        <p class="text-xs text-muted">
          Entradas
        </p>
        <p class="text-base font-semibold text-success mt-1">
          <template v-if="loading">
            —
          </template>
          <template v-else>
            + {{ formatMonto(totalEntradas) }}
          </template>
        </p>
      </div>
      <div class="rounded-lg bg-muted p-3">
        <p class="text-xs text-muted">
          Salidas
        </p>
        <p class="text-base font-semibold text-error mt-1">
          <template v-if="loading">
            —
          </template>
          <template v-else>
            - {{ formatMonto(totalSalidas) }}
          </template>
        </p>
      </div>
    </div>
  </div>
</template>
