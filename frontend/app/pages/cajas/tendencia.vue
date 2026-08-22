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
      <AppNavbar title="Tendencia de descuadres" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <ULink
          to="/cajas"
          class="text-sm text-highlighted inline-flex items-center gap-1"
        >
          <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
          Volver a cajas
        </ULink>

        <CajaTendencia />
      </div>
    </template>
  </UDashboardPanel>
</template>
