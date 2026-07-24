<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const perms = usePermissionsStore()
const toast = useToast()

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('Cajas', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Cajas', color: 'warning' })
    await navigateTo('/ventas')
  }
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
            to="/cajas/historial?todas=true"
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
