<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Cajas:Leer',
  layout: 'dashboard',
})

const cajaStore = useCajaStore()

// Cuántos cierres esperan revisión (03.17). Si no se pudo contar queda en `null` y el botón no dice
// nada: afirmar "0" cuando falló sería lo mismo que decir que no hay descuadres.
const pendientes = ref<number | null>(null)
onMounted(async () => {
  try {
    pendientes.value = (await cajaStore.cargarPendientesRevision()).length
  }
  catch {
    pendientes.value = null
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
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm text-muted">
            Cajas del local y su estado. La apertura de caja se hace en Mi caja.
          </p>
          <div class="flex items-center gap-2">
            <UButton
              to="/cajas/pendientes-revision"
              variant="outline"
              color="neutral"
              icon="i-lucide-inbox"
              label="Pendientes de revisar"
            >
              <template v-if="pendientes" #trailing>
                <UBadge
                  data-qa="pendientes-cantidad"
                  color="error"
                  variant="solid"
                  size="sm"
                  :label="String(pendientes)"
                />
              </template>
            </UButton>
            <UButton
              to="/cajas/tendencia"
              variant="outline"
              color="neutral"
              icon="i-lucide-trending-down"
              label="Tendencia de descuadres"
            />
            <UButton
              to="/cajas/historial"
              variant="outline"
              color="neutral"
              icon="i-lucide-history"
              label="Ver historial"
            />
          </div>
        </div>

        <CajaCajonesGrid />
      </div>
    </template>
  </UDashboardPanel>
</template>
