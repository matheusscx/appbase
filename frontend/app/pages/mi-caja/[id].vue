<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const cajaStore = useCajaStore()
const perms = usePermissionsStore()
const toast = useToast()
const loading = ref(true)

const cajaId = computed(() => route.params.id as string)

const readonly = computed(() =>
  cajaStore.detalle?.id !== cajaStore.activa?.id,
)

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
    await Promise.all([
      cajaStore.cargarActiva(),
      cajaStore.cargarDetalle(cajaId.value),
    ])
    if (!cajaStore.detalle) {
      throw new Error('not-found')
    }
    if (
      cajaStore.detalle.estado === 'cerrada'
      || cajaStore.detalle.estado === 'en_conciliacion'
    ) {
      await cajaStore.cargarArqueo(cajaId.value)
    }
  }
  catch {
    toast.add({ title: 'No tenés acceso a esta caja o no existe', color: 'warning' })
    await navigateTo('/mi-caja')
  }
  finally {
    loading.value = false
  }
})

// Tras cerrar la caja propia, activa pasa a null → volver al dispatcher.
// Se usa oldActiva para detectar el cierre sin depender de readonly (que ya
// recomputa a true cuando activa es null).
watch(() => cajaStore.activa, (newActiva, oldActiva) => {
  if (oldActiva !== null && newActiva === null && !cajaStore.arqueoCiego) {
    navigateTo('/mi-caja')
  }
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Detalle de caja" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <div
          v-if="!loading && cajaStore.detalle && readonly"
          class="flex flex-wrap items-center gap-4"
        >
          <ULink
            to="/mi-caja"
            class="text-sm text-highlighted inline-flex items-center gap-1"
          >
            <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
            Volver a caja
          </ULink>
        </div>

        <div v-if="loading" class="py-12 text-center text-sm text-muted">
          <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
          Cargando…
        </div>

        <div v-else-if="cajaStore.detalle" class="space-y-6">
          <CajaActivaDashboard
            v-if="cajaStore.detalle.estado === 'abierta'"
            :caja="cajaStore.detalle"
            :readonly="readonly"
            historial-url="/mi-caja/historial"
          />
          <CajaCierreDetalle
            v-else
            :caja="cajaStore.detalle"
            :arqueo="cajaStore.arqueo"
            :readonly="readonly"
            historial-url="/mi-caja/historial"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
