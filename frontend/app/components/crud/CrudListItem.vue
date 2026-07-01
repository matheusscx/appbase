<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <div class="min-w-0">
    <p class="font-medium truncate">
      {{ title }}
    </p>
    <p v-if="subtitle" class="text-sm text-muted">
      {{ subtitle }}
    </p>
  </div>
</template>
