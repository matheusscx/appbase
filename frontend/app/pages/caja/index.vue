<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const cajaStore = useCajaStore()
const perms = usePermissionsStore()
const toast = useToast()
const loading = ref(false)
const tab = ref<'mi-caja' | 'todas'>('mi-caja')

const puedeVerTodas = computed(
  () => perms.esAdmin || perms.can('Caja', 'Ver todas'),
)

const tabItems = [
  { label: 'Mi caja', slot: 'mi-caja' as const },
  { label: 'Todas las cajas', slot: 'todas' as const },
]

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
})
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6 py-6">
    <div>
      <h1 class="text-2xl font-bold">
        Caja
      </h1>
      <p class="text-sm text-gray-500 mt-1">
        Gestión de caja física del turno actual.
      </p>
    </div>

    <UTabs
      v-if="puedeVerTodas"
      v-model="tab"
      :items="tabItems"
      :unmount-on-hide="false"
    >
      <template #mi-caja>
        <div class="space-y-6 pt-4">
          <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
            <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
            Cargando…
          </div>
          <CajaAperturaForm v-else-if="!cajaStore.activa" />
          <CajaActivaDashboard v-else :caja="cajaStore.activa" />
          <UDivider class="my-2" />
          <CajaHistorial />
        </div>
      </template>

      <template #todas>
        <div class="pt-4">
          <CajasAbiertasGrid @operar-propia="tab = 'mi-caja'" />
        </div>
      </template>
    </UTabs>

    <div v-else class="space-y-6">
      <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
        <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
        Cargando…
      </div>
      <CajaAperturaForm v-else-if="!cajaStore.activa" />
      <CajaActivaDashboard v-else :caja="cajaStore.activa" />
      <UDivider class="my-2" />
      <CajaHistorial />
    </div>
  </div>
</template>
