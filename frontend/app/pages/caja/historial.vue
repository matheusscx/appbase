<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const perms = usePermissionsStore()
const toast = useToast()

const usuarioIdFromQuery = computed(() => {
  const id = route.query.usuarioId
  return typeof id === 'string' && id ? id : undefined
})

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('Caja', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Caja', color: 'warning' })
    await navigateTo('/ventas')
  }
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Historial de cajas" />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <ULink
          to="/caja"
          class="text-sm text-highlighted inline-flex items-center gap-1"
        >
          <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
          Volver a caja
        </ULink>

        <CajaHistorial :usuario-id="usuarioIdFromQuery" />
      </div>
    </template>
  </UDashboardPanel>
</template>
