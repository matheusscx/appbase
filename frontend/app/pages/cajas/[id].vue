<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const cajaStore = useCajaStore()
const perms = usePermissionsStore()
const toast = useToast()
const loading = ref(true)

const cajaId = computed(() => route.params.id as string)

const historialCajonUrl = computed(() => {
  const cajonId = cajaStore.detalle?.cajonId
  return cajonId ? `/cajas/historial?cajonId=${cajonId}` : '/cajas/historial'
})

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
    await cajaStore.cargarDetalle(cajaId.value)
    if (!cajaStore.detalle) {
      throw new Error('not-found')
    }
    if (cajaStore.detalle.estado === 'cerrada') {
      await cajaStore.cargarArqueo(cajaId.value)
    }
  }
  catch {
    toast.add({ title: 'No tenés acceso a esta caja o no existe', color: 'warning' })
    await navigateTo('/cajas')
  }
  finally {
    loading.value = false
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
          v-if="!loading && cajaStore.detalle"
          class="flex flex-wrap items-center gap-4"
        >
          <ULink
            to="/cajas"
            class="text-sm text-highlighted inline-flex items-center gap-1"
          >
            <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
            Volver a cajas
          </ULink>
        </div>

        <div v-if="loading" class="py-12 text-center text-sm text-muted">
          <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
          Cargando…
        </div>

        <div v-else-if="cajaStore.detalle" class="space-y-6">
          <CajaActivaDashboard
            :caja="cajaStore.detalle"
            :readonly="true"
            :historial-url="historialCajonUrl"
            historial-label="Ver historial"
          />

          <UCard v-if="cajaStore.detalle.estado === 'cerrada' && cajaStore.arqueo.length > 0" class="w-full">
            <template #header>
              <h3 class="text-sm font-semibold text-default">
                Arqueo del cierre
              </h3>
            </template>

            <CajaArqueoTable :lineas="cajaStore.arqueo" />
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
