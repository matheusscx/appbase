<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
  layout: 'dashboard',
})

const store = useAuthStore()
const tenantStore = useTenantStore()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Inicio" />
    </template>

    <template #body>
      <div class="max-w-2xl mx-auto px-6 py-16 text-center">
        <div class="w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-950 flex items-center justify-center mx-auto mb-6">
          <UIcon name="i-heroicons-check-circle" class="w-8 h-8 text-primary-600" />
        </div>
        <h2 class="text-2xl font-semibold text-default mb-2">
          Bienvenido, {{ store.user?.nombre }}
        </h2>
        <p class="text-muted text-sm">
          Trabajando en <strong>{{ tenantStore.activeTenant?.nombre ?? '—' }}</strong>
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
