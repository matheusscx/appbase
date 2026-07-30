<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'MiCaja:Leer',
  permisoLabel: 'Mi caja',
  layout: 'dashboard',
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Historial de caja" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <ULink
          to="/mi-caja"
          class="text-sm text-highlighted inline-flex items-center gap-1"
        >
          <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
          Volver a caja
        </ULink>

        <CajaHistorial :base-path="'/mi-caja'" />
      </div>
    </template>
  </UDashboardPanel>
</template>
