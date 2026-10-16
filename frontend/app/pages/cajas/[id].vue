<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Cajas:Leer',
  layout: 'dashboard',
})

const route = useRoute()
const cajaStore = useCajaStore()
// Justificar la diferencia de arqueo es del admin del tenant, no un permiso del
// módulo: por eso queda el store y no `usePermisosCrud`.
const perms = usePermissionsStore()
const authStore = useAuthStore()
const toast = useToast()
const loading = ref(true)

const cajaId = computed(() => route.params.id as string)

// Solo un cierre con diferencia tiene algo que revisar; el nivel viene congelado del cierre.
const conRevision = computed(() => {
  const d = cajaStore.detalle
  return !!d
    && (d.estado === 'cerrada' || d.estado === 'en_conciliacion')
    && !!d.nivelDescuadre
    && d.nivelDescuadre !== 'ninguno'
})

// Marcar visto lo decide el backend (quién y cuándo): se recarga el detalle, no se parchea.
async function recargarDetalle() {
  await cajaStore.cargarDetalle(cajaId.value)
}

const historialCajonUrl = computed(() => {
  const cajonId = cajaStore.detalle?.cajonId
  return cajonId ? `/cajas/historial?cajonId=${cajonId}` : '/cajas/historial'
})

onMounted(async () => {
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
    toast.add({ title: 'No tienes acceso a esta caja o no existe', color: 'warning' })
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
            class="text-sm text-primary inline-flex items-center gap-1"
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
          <!-- Lo que el encargado viene a hacer (cerrar la caja de un cajero que se fue) va primero:
               debajo de las tarjetas y la tabla de movimientos quedaba bajo el pliegue (03.6). -->
          <CajaCierreForzadoPanel :caja="cajaStore.detalle" :usuario-actual-id="authStore.user?.id" />

          <CajaRevisionDescuadre
            v-if="conRevision"
            :caja="cajaStore.detalle"
            @marcado="recargarDetalle"
          />

          <CajaActivaDashboard
            :caja="cajaStore.detalle"
            :readonly="true"
            :historial-url="historialCajonUrl"
            historial-label="Ver historial"
          />

          <!-- Rastro de los intentos rechazados: vive acá y no en la pantalla
               del cajero porque es supervisión (`Cajas:Leer`, el mismo permiso
               que gatea esta página). Se muestra en cualquier estado de la
               caja: la ráfaga que delata pasa con la caja ABIERTA, que es
               justo cuando el supervisor todavía puede hacer algo. -->
          <CajaIntentosRechazados :caja-id="cajaId" />

          <UCard v-if="cajaStore.detalle.estado === 'cerrada' && cajaStore.arqueo.length > 0" class="w-full">
            <template #header>
              <h3 class="text-sm font-semibold text-default">
                Arqueo del cierre
              </h3>
            </template>

            <CajaArqueoTable
              :lineas="cajaStore.arqueo"
              :puede-justificar="perms.esAdmin"
              :caja-id="cajaId"
            />
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
