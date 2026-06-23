<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Administración" />
    </template>
    <div class="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
      <UIcon name="i-heroicons-shield-check" class="w-12 h-12 text-gray-300 dark:text-gray-600" />
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Panel de administración — próximamente disponible.
      </p>
    </div>
  </UDashboardPanel>
</template>
