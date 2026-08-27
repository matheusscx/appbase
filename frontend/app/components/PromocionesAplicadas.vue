<script setup lang="ts">
import type { TrazaPromo } from '~/composables/useCalculoPrecios'

defineProps<{ promociones: TrazaPromo[] }>()

const { formatMonto } = useFormatters()
</script>

<template>
  <div v-if="promociones.length">
    <p
      v-for="(promo, i) in promociones"
      :key="i"
      class="flex items-center gap-1 text-xs text-success"
    >
      <UIcon name="i-lucide-tag" class="size-3.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ promo.nombre }}</span>
      <span class="shrink-0 font-mono">-{{ formatMonto(promo.monto) }}</span>
    </p>
  </div>
</template>
