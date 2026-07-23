<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const perms = usePermissionsStore()
const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(false)

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('Cajas', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Cajas', color: 'warning' })
    await navigateTo('/ventas')
    return
  }

  loading.value = true
  try {
    await cajaStore.cargarAbiertas()
  }
  catch {
    toast.add({ title: 'Error al cargar cajas', color: 'error' })
  }
  finally {
    loading.value = false
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
        <p class="text-sm text-muted">
          Supervisión de cajas físicas abiertas en el tenant.
        </p>

        <div v-if="loading" class="py-12 text-center text-sm text-muted">
          <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
          Cargando…
        </div>

        <template v-else>
          <div class="flex justify-end">
            <UButton
              to="/cajas/historial"
              variant="outline"
              color="neutral"
              icon="i-lucide-history"
              label="Ver historial"
            />
          </div>
          <CajaAbiertasGrid />
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
