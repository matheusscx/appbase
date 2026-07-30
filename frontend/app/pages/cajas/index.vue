<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Cajas:Leer',
  layout: 'dashboard',
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Cajas" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm text-muted">
            Cajones del tenant y su estado. La apertura de caja se hace en Mi caja.
          </p>
          <UButton
            to="/cajas/historial"
            variant="outline"
            color="neutral"
            icon="i-lucide-history"
            label="Ver historial"
          />
        </div>

        <CajaCajonesGrid />
      </div>
    </template>
  </UDashboardPanel>
</template>
