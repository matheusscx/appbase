<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <UDashboardNavbar :title="title" :ui="{ title: 'font-display' }">
    <template #leading>
      <UDashboardSidebarCollapse />
    </template>
    <template #right>
      <slot name="right">
        <UserMenu />
      </slot>
    </template>
  </UDashboardNavbar>
</template>
