<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ArqueoLinea } from '~/stores/caja'

defineProps<{ lineas: ArqueoLinea[] }>()
const { formatMonto } = useFormatters()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-muted">
          <th class="py-2 font-medium">
            Método
          </th>
          <th class="py-2 font-medium text-right">
            Esperado
          </th>
          <th class="py-2 font-medium text-right">
            Contado
          </th>
          <th class="py-2 font-medium text-right">
            Diferencia
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in lineas" :key="l.metodoPagoId ?? 'EFECTIVO'" class="border-t border-default">
          <td class="py-2 text-default">
            {{ l.nombre }}
          </td>
          <td class="py-2 text-right text-default">
            {{ formatMonto(l.esperado) }}
          </td>
          <td class="py-2 text-right text-default">
            {{ l.contado != null ? formatMonto(l.contado) : '—' }}
          </td>
          <td class="py-2 text-right">
            <span
              v-if="l.diferencia != null"
              :class="new Decimal(l.diferencia).gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
            >
              {{ formatMonto(l.diferencia) }}
            </span>
            <span v-else class="text-muted">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
