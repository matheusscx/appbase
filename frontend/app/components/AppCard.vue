<script setup lang="ts">
import { shellUi } from '~/utils/ui-shell'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  title?: string
  description?: string
  ui?: Record<string, string>
  class?: string
}>()

const cardUi = computed(() => ({
  ...shellUi.card,
  ...props.ui,
}))
</script>

<template>
  <UCard
    v-bind="$attrs"
    :title="title"
    :description="description"
    :class="props.class"
    :ui="cardUi"
  >
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>
    <template v-if="$slots.default" #default>
      <slot />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UCard>
</template>
