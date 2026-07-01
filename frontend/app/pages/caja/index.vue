<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const cajaStore = useCajaStore()
const perms = usePermissionsStore()
const toast = useToast()
const loading = ref(false)

const puedeVerTodas = computed(
  () => perms.esAdmin || perms.can('Caja', 'Ver todas'),
)

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('Caja', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Caja', color: 'warning' })
    await navigateTo('/ventas')
    return
  }

  loading.value = true
  try {
    await cajaStore.cargarActiva()
  }
  catch {
    toast.add({ title: 'Error al cargar caja', color: 'error' })
  }
  finally {
    loading.value = false
  }

  // Sin permiso de ver todas: despachar a la caja propia si está abierta
  if (!puedeVerTodas.value && cajaStore.activa) {
    await navigateTo(`/caja/${cajaStore.activa.id}`, { replace: true })
  }
})

async function onOpened(): Promise<void> {
  if (cajaStore.activa) {
    await navigateTo(`/caja/${cajaStore.activa.id}`)
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Caja" />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <p class="text-sm text-muted">
          Gestión de caja física del turno actual.
        </p>

        <div v-if="loading" class="py-12 text-center text-sm text-muted">
          <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
          Cargando…
        </div>

        <!-- Con permiso Ver todas: listado de cajas (con card de apertura si no hay propia) -->
        <template v-else-if="puedeVerTodas">
          <CajaAbiertasGrid />
        </template>

        <!-- Sin permiso Ver todas y sin caja abierta: mostrar formulario de apertura + historial -->
        <template v-else-if="!cajaStore.activa">
          <div class="space-y-6">
            <CajaAperturaForm @opened="onOpened" />
            <USeparator class="my-2" />
            <CajaHistorial />
          </div>
        </template>

        <!-- Sin permiso Ver todas con caja abierta: redirigiendo (no debería verse) -->
        <template v-else>
          <div class="py-12 text-center text-sm text-muted">
            <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
            Redirigiendo…
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
