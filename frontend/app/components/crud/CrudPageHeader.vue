<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description?: string
    large?: boolean
  }>(),
  { large: false },
)
</script>

<template>
  <div class="flex items-center justify-between">
    <div>
      <h1 v-if="large" class="text-2xl font-semibold text-default">
        {{ title }}
      </h1>
      <h2 v-else class="text-lg font-semibold text-default">
        {{ title }}
      </h2>
      <p v-if="description" class="text-sm text-muted">
        {{ description }}
      </p>
    </div>
    <slot name="actions" />
  </div>
</template>
