<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Cajas:Leer',
  layout: 'dashboard',
})

const route = useRoute()

const usuarioIdFromQuery = computed(() => {
  const id = route.query.usuarioId
  return typeof id === 'string' && id ? id : undefined
})

const cajonIdFromQuery = computed(() => {
  const id = route.query.cajonId
  return typeof id === 'string' && id ? id : undefined
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Historial de cajas" />
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

        <CajaHistorial
          :usuario-id="usuarioIdFromQuery"
          :cajon-id="cajonIdFromQuery"
          :base-path="'/cajas'"
          todas
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
