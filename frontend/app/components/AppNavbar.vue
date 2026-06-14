<script setup lang="ts">
defineProps<{
  title: string
}>()

const store = useAuthStore()
</script>

<template>
  <UDashboardNavbar :title="title">
    <template #leading>
      <UDashboardSidebarCollapse />
    </template>
    <template #right>
      <slot name="right">
        <span class="text-sm text-muted">{{ store.user?.email }}</span>
      </slot>
    </template>
  </UDashboardNavbar>
</template>
