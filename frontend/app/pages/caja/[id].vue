<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const cajaStore = useCajaStore()
const perms = usePermissionsStore()
const toast = useToast()
const loading = ref(true)

const cajaId = computed(() => route.params.id as string)

const puedeVerTodas = computed(
  () => perms.esAdmin || perms.can('Caja', 'Ver todas'),
)

const readonly = computed(() =>
  cajaStore.detalle?.id !== cajaStore.activa?.id,
)

onMounted(async () => {
  if (!perms.loading && perms.permisos.length === 0) {
    await perms.fetchPermisos()
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
  }
  catch {
    toast.add({ title: 'No tenés acceso a esta caja o no existe', color: 'warning' })
    await navigateTo('/caja')
  }
  finally {
    loading.value = false
  }
})

// Tras cerrar la caja propia, activa pasa a null → volver al dispatcher.
// Se usa oldActiva para detectar el cierre sin depender de readonly (que ya
// recomputa a true cuando activa es null).
watch(() => cajaStore.activa, (newActiva, oldActiva) => {
  if (oldActiva !== null && newActiva === null) {
    navigateTo('/caja')
  }
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Detalle de caja" />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <div
          v-if="!loading && cajaStore.detalle"
          class="flex flex-wrap items-center gap-4"
        >
          <ULink
            v-if="puedeVerTodas || readonly"
            to="/caja"
            class="text-sm text-highlighted inline-flex items-center gap-1"
          >
            <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
            {{ puedeVerTodas ? 'Volver al listado' : 'Volver a caja' }}
          </ULink>
          <ULink
            v-if="puedeVerTodas && cajaStore.detalle.usuarioId"
            :to="{
              path: '/caja/historial',
              query: { usuarioId: cajaStore.detalle.usuarioId },
            }"
            class="text-sm text-highlighted inline-flex items-center gap-1"
          >
            <UIcon name="i-lucide-history" class="w-4 h-4" />
            Ver historial del cajero
          </ULink>
          <ULink
            v-else
            to="/caja/historial"
            class="text-sm text-highlighted inline-flex items-center gap-1"
          >
            <UIcon name="i-lucide-history" class="w-4 h-4" />
            Ver historial
          </ULink>
        </div>

        <div v-if="loading" class="py-12 text-center text-sm text-muted">
          <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
          Cargando…
        </div>

        <div v-else-if="cajaStore.detalle">
          <CajaActivaDashboard :caja="cajaStore.detalle" :readonly="readonly" />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
