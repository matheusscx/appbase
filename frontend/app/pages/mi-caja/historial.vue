<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const perms = usePermissionsStore()
const toast = useToast()

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('MiCaja', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Mi caja', color: 'warning' })
    await navigateTo('/ventas')
  }
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

        <CajaHistorial />
      </div>
    </template>
  </UDashboardPanel>
</template>
