<script setup lang="ts">
import type { CheckoutResponse } from '~/composables/useTiendaCarrito'
import type { SuscripcionCheckout } from '~/composables/useSuscripcionCheckout'

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
const suscripcionCheckout = useSuscripcionCheckout()
const { preferida: tarjetaPreferida } = useTarjetas()
const { formatMonto } = useFormatters()

const modoSuscripcion = computed(() => route.query.modo === 'suscripcion')

const frecuenciaLabel: Record<SuscripcionCheckout['frecuencia'], string> = {
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  mensual: 'Mensual',
}
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function detalleDia(s: SuscripcionCheckout): string {
  if (s.frecuencia === 'semanal' && s.diaSemana !== null)
    return `los ${DIAS_SEMANA[s.diaSemana]}`
  if (s.frecuencia === 'quincenal' && s.diaMes !== null)
    return `los días ${s.diaMes} y ${s.diaMes + 15}`
  if (s.diaMes !== null) return `el día ${s.diaMes}`
  return ''
}

// Snapshot local: no depende de `checkout`/`suscripcionCheckout` (useState
// compartido), que se limpia al aprobar — si dependiera de él, el mensaje de
// éxito desaparecería junto con el resto de la pantalla en el mismo render.
const resumen = ref<CheckoutResponse | null>(null)
const lineasSnapshot = ref<{ itemId: string, cantidad: string }[]>([])
const suscripcionSnapshot = ref<SuscripcionCheckout | null>(null)

const estado = ref<'revisando' | 'procesando' | 'aprobada' | 'rechazada'>('revisando')
const ventaId = ref<string | null>(null)
const metodos = ref<MetodoPago[]>([])

const tarjetaMostrar = computed(() => {
  if (modoSuscripcion.value) return suscripcionSnapshot.value?.tarjeta ?? null
  return tarjetaPreferida.value
})

const detallePlan = computed(() => {
  const s = suscripcionSnapshot.value
  if (!s) return ''
  const dia = detalleDia(s)
  return `${s.itemNombre} · ${frecuenciaLabel[s.frecuencia]}${dia ? ` · ${dia}` : ''}`
})

onMounted(async () => {
  if (modoSuscripcion.value) {
    if (!suscripcionCheckout.value
      || suscripcionCheckout.value.checkout.checkoutRef !== route.query.ref) {
      await navigateTo('/tienda/suscripciones')
      return
    }
    suscripcionSnapshot.value = suscripcionCheckout.value
    resumen.value = suscripcionCheckout.value.checkout
  } else {
    if (!checkout.value || checkout.value.checkoutRef !== route.query.ref) {
      await navigateTo('/tienda')
      return
    }
    resumen.value = checkout.value
    lineasSnapshot.value = lineas.value.map((l) => ({ itemId: l.item.id, cantidad: l.cantidad }))
  }
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
    if (modoSuscripcion.value && suscripcionSnapshot.value) {
      const s = suscripcionSnapshot.value
      const creada = await useApiFetch<{ id: string, ventaInicialId: string }>(
        `${apiUrl}/suscripciones`,
        {
          method: 'POST',
          body: {
            itemId: s.itemId,
            diaMes: s.diaMes ?? undefined,
            diaSemana: s.diaSemana ?? undefined,
            metodoPagoId: metodo.metodoPagoId,
            tarjeta: s.tarjeta ?? undefined,
          },
        },
      )
      ventaId.value = creada.ventaInicialId
      suscripcionCheckout.value = null
    } else {
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
      limpiar()
    }
    estado.value = 'aprobada'
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'El pago fue rechazado', color: 'error' })
    estado.value = 'rechazada'
  }
}

async function rechazar() {
  estado.value = 'rechazada'
  if (modoSuscripcion.value) {
    suscripcionCheckout.value = null
    await navigateTo('/tienda/suscripciones')
    return
  }
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
            <p class="font-medium">{{ modoSuscripcion ? 'Suscripción activada' : 'Pago aprobado' }}</p>
            <p class="text-sm text-muted">
              {{ modoSuscripcion
                ? 'Tu suscripción quedó activa y el primer cobro fue registrado.'
                : 'Tu compra fue registrada correctamente.' }}
            </p>
            <UButton
              v-if="ventaId"
              :to="`/ventas/${ventaId}`"
              label="Ver detalle de la venta"
              variant="soft"
              block
            />
            <UButton
              v-if="modoSuscripcion"
              to="/tienda/suscripciones"
              label="Ver mis suscripciones"
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
              <div v-if="modoSuscripcion && suscripcionSnapshot" class="flex justify-between text-muted pt-1">
                <span>Plan</span>
                <span>{{ detallePlan }}</span>
              </div>
            </div>

            <div class="border border-default rounded-lg p-3">
              <p class="text-xs text-muted mb-1">Medio de pago</p>
              <div v-if="tarjetaMostrar" class="flex items-center gap-2">
                <UIcon name="i-lucide-credit-card" class="text-muted" />
                <span class="text-sm">{{ tarjetaMostrar.marca }} •••• {{ tarjetaMostrar.last4 }}</span>
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
