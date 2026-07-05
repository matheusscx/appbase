<script setup lang="ts">
import type { CheckoutResponse } from '~/composables/useTiendaCarrito'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const authStore = useAuthStore()

const { lineas, checkout, limpiar } = useTiendaCarrito()
const { preferida: tarjetaPreferida } = useTarjetas()
const { formatMonto } = useFormatters()

// Snapshot local: no depende de `checkout` (useState compartido), que se
// limpia al aprobar — si dependiera de él, el mensaje de éxito desaparecería
// junto con el resto de la pantalla en el mismo render.
const resumen = ref<CheckoutResponse | null>(null)
const lineasSnapshot = ref<{ itemId: string, cantidad: string }[]>([])

const estado = ref<'revisando' | 'procesando' | 'aprobada' | 'rechazada'>('revisando')
const ventaId = ref<string | null>(null)
const metodos = ref<MetodoPago[]>([])

onMounted(async () => {
  if (!checkout.value || checkout.value.checkoutRef !== route.query.ref) {
    await navigateTo('/tienda')
    return
  }
  resumen.value = checkout.value
  lineasSnapshot.value = lineas.value.map((l) => ({ itemId: l.item.id, cantidad: l.cantidad }))
  try {
    metodos.value = await useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`)
  } catch {
    metodos.value = []
  }
})

function metodoTarjeta(): MetodoPago | undefined {
  return metodos.value.find((m) => m.nombre.toLowerCase().includes('crédito'))
    ?? metodos.value.find((m) => m.nombre.toLowerCase().includes('credito'))
    ?? metodos.value[0]
}

async function aprobar() {
  if (!resumen.value) return
  const metodo = metodoTarjeta()
  if (!metodo) {
    toast.add({ title: 'No hay métodos de pago configurados', color: 'error' })
    return
  }

  estado.value = 'procesando'
  try {
    const venta = await useApiFetch<{ id: string, estado: string }>(`${apiUrl}/ventas`, {
      method: 'POST',
      body: {
        canal: 'online',
        lineas: lineasSnapshot.value,
        pagos: [{ metodoPagoId: metodo.metodoPagoId, monto: resumen.value.resultado.totales.totalFinal }],
        customer: { nombre: authStore.user?.nombre ?? 'Cliente online' },
      },
    })
    ventaId.value = venta.id
    estado.value = 'aprobada'
    limpiar()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'El pago fue rechazado', color: 'error' })
    estado.value = 'rechazada'
  }
}

async function rechazar() {
  estado.value = 'rechazada'
  await navigateTo('/tienda')
}
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
      <div v-if="resumen" class="max-w-md mx-auto py-6">
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-shield-check" class="text-primary" />
              <span class="font-semibold">Pasarela de pago (simulada)</span>
            </div>
          </template>

          <div v-if="estado === 'aprobada'" class="text-center py-6 space-y-3">
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

          <div v-else class="space-y-4">
            <div class="text-sm space-y-1">
              <div class="flex justify-between text-muted">
                <span>Subtotal</span><span>{{ formatMonto(resumen.resultado.totales.subtotalNeto) }}</span>
              </div>
              <div class="flex justify-between font-semibold text-default text-base pt-1 border-t border-default">
                <span>Total a pagar</span><span>{{ formatMonto(resumen.resultado.totales.totalFinal) }}</span>
              </div>
            </div>

            <div class="border border-default rounded-lg p-3">
              <p class="text-xs text-muted mb-1">Medio de pago</p>
              <div v-if="tarjetaPreferida" class="flex items-center gap-2">
                <UIcon name="i-lucide-credit-card" class="text-muted" />
                <span class="text-sm">{{ tarjetaPreferida.marca }} •••• {{ tarjetaPreferida.last4 }}</span>
              </div>
              <div v-else class="flex items-center justify-between gap-2">
                <span class="text-sm text-muted">No tenés tarjetas registradas.</span>
                <UButton
                  to="/tienda/medios-pago"
                  label="Agregar"
                  size="xs"
                  variant="soft"
                />
              </div>
            </div>

            <div class="flex gap-2">
              <UButton
                label="Rechazar"
                color="neutral"
                variant="soft"
                block
                :disabled="estado === 'procesando'"
                @click="rechazar"
              />
              <UButton
                label="Aprobar pago"
                color="primary"
                block
                :loading="estado === 'procesando'"
                @click="aprobar"
              />
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
