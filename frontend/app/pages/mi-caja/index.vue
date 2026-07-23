<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const cajaStore = useCajaStore()
const perms = usePermissionsStore()
const toast = useToast()
const loading = ref(false)

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
  }
  if (!perms.esAdmin && !perms.can('MiCaja', 'Leer')) {
    toast.add({ title: 'No tenés acceso al módulo Mi caja', color: 'warning' })
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

  if (cajaStore.activa?.id) {
    await navigateTo(`/mi-caja/${cajaStore.activa.id}`, { replace: true })
  }
})

// Red de seguridad: tras abrir, activa se setea antes de que onOpened navegue;
// si la navegación falla, evita quedar en "Redirigiendo…" sin salida.
watch(
  () => cajaStore.activa?.id,
  (cajaId) => {
    if (cajaId) {
      navigateTo(`/mi-caja/${cajaId}`, { replace: true })
    }
  },
)

async function onOpened(cajaId: string): Promise<void> {
  await navigateTo(`/mi-caja/${cajaId}`, { replace: true })
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Mi caja" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <p class="text-sm text-muted">
          Gestión de caja física del turno actual.
        </p>

        <div v-if="loading" class="py-12 text-center text-sm text-muted">
          <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
          Cargando…
        </div>

        <!-- Sin caja abierta: apertura + link al historial -->
        <template v-else-if="!cajaStore.activa">
          <div class="space-y-6">
            <div class="flex justify-end">
              <UButton
                to="/mi-caja/historial"
                variant="outline"
                color="neutral"
                icon="i-lucide-history"
                label="Ver historial"
              />
            </div>
            <CajaAperturaForm @opened="onOpened" />
          </div>
        </template>

        <!-- Con caja abierta: redirigiendo (no debería verse) -->
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
