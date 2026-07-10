<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const { limpiar } = useTiendaCarrito()
const { formatTipoPago } = useFormatters()

const ordenId = computed(() => String(route.query.ordenId ?? ''))

type Vista = 'cargando' | 'aprobada' | 'rechazada' | 'pendiente' | 'error'
const vista = ref<Vista>('cargando')
const ventaId = ref<string | null>(null)
const tipoPago = ref<string | null>(null)
const numeroCuotas = ref<number | null>(null)
const tarjetaUltimos4 = ref<string | null>(null)
const motivoRechazo = ref<string | null>(null)

interface OrdenResultado {
  estado: string
  ventaId: string | null
  tipoPago: string | null
  numeroCuotas: number | null
  tarjetaUltimos4: string | null
  motivoRechazo: string | null
}

onMounted(async () => {
  if (!ordenId.value) {
    vista.value = 'error'
    return
  }
  try {
    // La venta ya fue creada por el callback in-process antes del redirect;
    // esta lectura resuelve el resultado real de la orden (no confía en el query).
    const res = await useApiFetch<OrdenResultado>(
      `${apiUrl}/online/orden/${ordenId.value}`,
    )
    ventaId.value = res.ventaId
    tipoPago.value = res.tipoPago
    numeroCuotas.value = res.numeroCuotas
    tarjetaUltimos4.value = res.tarjetaUltimos4
    motivoRechazo.value = res.motivoRechazo
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
            <div v-if="tipoPago" class="text-sm text-muted">
              <span>{{ formatTipoPago(tipoPago) }}</span>
              <span v-if="tarjetaUltimos4" class="font-mono"> ····{{ tarjetaUltimos4 }}</span>
              <span v-if="numeroCuotas && numeroCuotas > 1"> · {{ numeroCuotas }} cuotas</span>
            </div>
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
                : (motivoRechazo ?? 'El pago no se completó. Tu carrito sigue disponible para reintentar.') }}
            </p>
            <UButton to="/tienda" label="Volver a la tienda" variant="soft" block />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
