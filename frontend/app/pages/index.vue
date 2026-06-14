<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
  layout: 'dashboard',
})

const store = useAuthStore()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Inicio">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <span class="text-sm text-muted">{{ store.user?.email }}</span>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl mx-auto px-6 py-16 text-center">
        <div class="w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-950 flex items-center justify-center mx-auto mb-6">
          <UIcon name="i-heroicons-check-circle" class="w-8 h-8 text-primary-600" />
        </div>
        <h2 class="text-2xl font-semibold text-default mb-2">
          Bienvenido, {{ store.user?.name }}
        </h2>
        <p class="text-muted text-sm">
          Has iniciado sesión correctamente.
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
