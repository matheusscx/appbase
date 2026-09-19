<script setup lang="ts">
// Bloque "Lo más vendido" de la zona "Hoy" (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.2). Hasta 5 ítems, ya ordenados por el backend (`ORDER BY monto DESC,
// itemId`) — la pantalla no reordena. Sin link propio: no existe un reporte de
// ventas al que llevar (spec § 7, fuera de alcance).
import type { MasVendidoItem } from '~/types/resumen-negocio'

defineProps<{ masVendidos: MasVendidoItem[] }>()

const { formatMonto } = useFormatters()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-default">Lo más vendido</span>
        <UIcon name="i-lucide-trophy" class="text-muted" />
      </div>
    </template>

    <ol v-if="masVendidos.length > 0" class="space-y-1">
      <li
        v-for="(item, i) in masVendidos"
        :key="item.itemId"
        class="flex items-center justify-between gap-2 text-sm"
      >
        <span class="text-default truncate">{{ i + 1 }}. {{ item.itemNombre }}</span>
        <span class="text-muted shrink-0">{{ item.cantidad }} · {{ formatMonto(item.monto) }}</span>
      </li>
    </ol>
    <p v-else class="text-sm text-muted">
      Sin ventas hoy.
    </p>
  </UCard>
</template>
