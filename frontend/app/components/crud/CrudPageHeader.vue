<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-lg font-semibold text-default">
        {{ title }}
      </h2>
      <p v-if="description" class="text-sm text-muted">
        {{ description }}
      </p>
    </div>
    <slot name="actions" />
  </div>
</template>
