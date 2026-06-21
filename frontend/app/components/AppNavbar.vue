<script setup lang="ts">
defineProps<{
  title: string
}>()

const authStore = useAuthStore()
const tenantStore = useTenantStore()
</script>

<template>
  <UDashboardNavbar :title="title">
    <template #leading>
      <UDashboardSidebarCollapse />
    </template>
    <template #right>
      <slot name="right">
        <span class="text-sm text-muted">
          {{ tenantStore.activeTenant?.nombre ?? authStore.user?.nombre }}
        </span>
      </slot>
    </template>
  </UDashboardNavbar>
</template>
