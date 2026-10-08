<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'MiCaja:Leer',
  permisoLabel: 'Mi caja',
  layout: 'dashboard',
})

const route = useRoute()
const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(true)

const cajaId = computed(() => route.params.id as string)
// El historial de cajas es de supervisión (owner, 2026-09-29).
const { puedeLeer: puedeVerHistorial } = usePermisosCrud('Cajas')
const historialUrl = computed(() => puedeVerHistorial.value ? '/mi-caja/historial' : undefined)

const readonly = computed(() =>
  cajaStore.detalle?.id !== cajaStore.activa?.id,
)

onMounted(async () => {
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
  catch (e: unknown) {
    // Con el mensaje del backend: a un cajero que recarga su caja recién
    // cerrada le dice que el historial es de supervisión, no que no existe.
    toast.add({ title: apiErrorMsg(e, 'No tenés acceso a esta caja o no existe', { detalleLocal: false }), color: 'warning' })
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
            :historial-url="historialUrl"
          />
          <CajaCierreDetalle
            v-else
            :caja="cajaStore.detalle"
            :arqueo="cajaStore.arqueo"
            :readonly="readonly"
            :historial-url="historialUrl"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
