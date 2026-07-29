<script setup lang="ts">
defineProps<{ advertencias: string[] }>()
</script>

<template>
  <p
    v-for="(advertencia, i) in advertencias"
    :key="i"
    class="flex items-start gap-1 text-xs text-warning"
  >
    <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
    <span>{{ advertencia }}</span>
  </p>
</template>
