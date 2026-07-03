<script setup lang="ts">
const props = defineProps<{
  monto: string
  monedaId: string
  suffix?: string
  muted?: boolean
  highlight?: boolean
}>()

const { formatMonto } = useFormatters()
const { getConfig } = useMonedaConversion()

const priceClass = computed(() => {
  if (props.highlight) return 'text-highlighted font-semibold text-sm font-mono'
  if (props.muted) return 'text-xs text-muted font-mono'
  return 'text-sm font-mono text-default'
})
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <UBadge
      v-if="getConfig(monedaId)?.codigoIso"
      :label="getConfig(monedaId)!.codigoIso"
      color="neutral"
      variant="subtle"
      size="xs"
      class="shrink-0"
    />
    <span :class="priceClass">
      {{ formatMonto(monto, monedaId) }}<template v-if="suffix">&nbsp;{{ suffix }}</template>
    </span>
  </span>
</template>
