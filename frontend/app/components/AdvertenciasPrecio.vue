<script setup lang="ts">
import type { AdvertenciaPrecio } from '~/composables/useCalculoPrecios'

defineProps<{ advertencias: AdvertenciaPrecio[] }>()
</script>

<template>
  <p
    v-for="(advertencia, i) in advertencias"
    :key="i"
    class="flex items-center gap-1 text-xs text-warning"
  >
    <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
    <span class="truncate">{{ advertencia.titulo }}</span>
    <UTooltip :text="advertencia.detalle">
      <UButton
        icon="i-lucide-info"
        variant="ghost"
        color="neutral"
        size="xs"
        square
        :aria-label="`Detalle: ${advertencia.detalle}`"
      />
    </UTooltip>
  </p>
</template>
