<script setup lang="ts">
const props = defineProps<{ monedaIds: string[] }>()

const { monedaOficial, monedasExtranjerasDeIds, formatTasa } = useMonedaConversion()

const monedasExtranjeras = computed(() => monedasExtranjerasDeIds(props.monedaIds))
</script>

<template>
  <UPopover
    v-if="monedasExtranjeras.length"
    :content="{ side: 'top', align: 'end', sideOffset: 6 }"
    :ui="{ content: 'p-3 max-w-xs' }"
  >
    <UButton
      icon="i-lucide-info"
      color="neutral"
      variant="ghost"
      size="xs"
      aria-label="Ver tasas de conversión"
      class="shrink-0"
    />

    <template #content>
      <div class="flex flex-col gap-2 text-sm">
        <p v-if="monedaOficial" class="text-muted text-xs">
          Totales en {{ monedaOficial.codigoIso }} (moneda oficial)
        </p>
        <p class="font-medium text-default text-xs">
          Tasas del día
        </p>
        <ul class="space-y-1">
          <li
            v-for="moneda in monedasExtranjeras"
            :key="moneda.monedaId"
            class="text-default font-mono text-xs"
          >
            {{ formatTasa(moneda) }}
          </li>
        </ul>
      </div>
    </template>
  </UPopover>
</template>
