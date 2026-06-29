<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(false)

onMounted(async () => {
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
  <div class="max-w-3xl mx-auto space-y-6 py-6">
    <div>
      <h1 class="text-2xl font-bold">
        Caja
      </h1>
      <p class="text-sm text-gray-500 mt-1">
        Gestión de caja física del turno actual.
      </p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando…
    </div>

    <!-- Sin caja activa -->
    <CajaAperturaForm v-else-if="!cajaStore.activa" />

    <!-- Caja activa -->
    <CajaActivaDashboard
      v-else
      :caja="cajaStore.activa"
    />

    <UDivider class="my-2" />

    <!-- Historial de cajas cerradas -->
    <CajaHistorial />
  </div>
</template>
