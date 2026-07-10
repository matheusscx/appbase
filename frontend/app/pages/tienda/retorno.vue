<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const { limpiar } = useTiendaCarrito()

const ordenId = computed(() => String(route.query.ordenId ?? ''))

type Vista = 'cargando' | 'aprobada' | 'rechazada' | 'pendiente' | 'error'
const vista = ref<Vista>('cargando')
const ventaId = ref<string | null>(null)

onMounted(async () => {
  if (!ordenId.value) {
    vista.value = 'error'
    return
  }
  try {
    // La venta ya fue creada por el callback in-process antes del redirect;
    // esta lectura resuelve el resultado real de la orden (no confía en el query).
    const res = await useApiFetch<{ estado: string, ventaId: string | null }>(
      `${apiUrl}/online/orden/${ordenId.value}`,
    )
    ventaId.value = res.ventaId
    if (res.estado === 'pagada' || res.estado === 'conciliada') {
      vista.value = 'aprobada'
      limpiar()
    } else if (res.estado === 'fallida') {
      vista.value = 'rechazada'
    } else if (res.estado === 'pendiente') {
      vista.value = 'pendiente'
    } else {
      // en_proceso / procesando: el pago no se resolvió (abort/timeout).
      vista.value = 'rechazada'
    }
  } catch {
    vista.value = 'error'
  }
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Tienda Online">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="max-w-md mx-auto py-6">
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-shield-check" class="text-primary" />
              <span class="font-semibold">Resultado del pago</span>
            </div>
          </template>

          <div v-if="vista === 'cargando'" class="text-center py-8 space-y-3">
            <UIcon name="i-lucide-loader-circle" class="animate-spin text-muted size-10 mx-auto" />
            <p class="text-sm text-muted">Confirmando tu pago…</p>
          </div>

          <div v-else-if="vista === 'aprobada'" class="text-center py-6 space-y-3">
            <UIcon name="i-lucide-circle-check-big" class="text-success size-12 mx-auto" />
            <p class="font-medium">Pago aprobado</p>
            <p class="text-sm text-muted">Tu compra fue registrada correctamente.</p>
            <UButton
              v-if="ventaId"
              :to="`/ventas/${ventaId}`"
              label="Ver detalle de la venta"
              variant="soft"
              block
            />
            <UButton to="/tienda" label="Volver a la tienda" variant="ghost" block />
          </div>

          <div v-else-if="vista === 'pendiente'" class="text-center py-6 space-y-3">
            <UIcon name="i-lucide-clock" class="text-warning size-12 mx-auto" />
            <p class="font-medium">Pago pendiente</p>
            <p class="text-sm text-muted">
              Tu pago está en proceso de confirmación. Te avisaremos cuando se acredite.
            </p>
            <UButton to="/tienda" label="Volver a la tienda" variant="ghost" block />
          </div>

          <div v-else class="text-center py-6 space-y-3">
            <UIcon name="i-lucide-circle-x" class="text-error size-12 mx-auto" />
            <p class="font-medium">
              {{ vista === 'error' ? 'No pudimos verificar el pago' : 'Pago rechazado' }}
            </p>
            <p class="text-sm text-muted">
              {{ vista === 'error'
                ? 'Ocurrió un problema al consultar el resultado. Revisa tus compras o reintenta.'
                : 'El pago no se completó. Tu carrito sigue disponible para reintentar.' }}
            </p>
            <UButton to="/tienda" label="Volver a la tienda" variant="soft" block />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
