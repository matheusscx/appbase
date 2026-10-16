<script setup lang="ts">
import type { VistaRetorno } from '~/composables/useRetornoTienda'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const { limpiar } = useTiendaCarrito()
const { formatTipoPago, formatMonto } = useFormatters()
const { resolverRetorno } = useRetornoTienda()

const ordenId = computed(() => String(route.query.ordenId ?? ''))

/** `no_encontrada`: la orden no existe para este local (404 o URL sin orden); no se arregla reintentando. */
type Vista = 'cargando' | 'no_encontrada' | VistaRetorno
const vista = ref<Vista>('cargando')
const ventaId = ref<string | null>(null)
const tipoPago = ref<string | null>(null)
const numeroCuotas = ref<number | null>(null)
const tarjetaUltimos4 = ref<string | null>(null)
const motivoRechazo = ref<string | null>(null)
const monto = ref<string | null>(null)

interface OrdenResultado {
  estado: string
  ventaId: string | null
  monto: string | null
  tipoPago: string | null
  numeroCuotas: number | null
  tarjetaUltimos4: string | null
  motivoRechazo: string | null
}

async function consultar() {
  if (!ordenId.value) {
    vista.value = 'no_encontrada'
    return
  }
  vista.value = 'cargando'
  try {
    // La venta ya fue creada por el callback in-process antes del redirect;
    // esta lectura resuelve el resultado real de la orden (no confía en el query).
    const res = await useApiFetch<OrdenResultado>(
      `${apiUrl}/online/orden/${ordenId.value}`,
    )
    ventaId.value = res.ventaId
    monto.value = res.monto ?? null
    tipoPago.value = res.tipoPago
    numeroCuotas.value = res.numeroCuotas
    tarjetaUltimos4.value = res.tarjetaUltimos4
    motivoRechazo.value = res.motivoRechazo
    const resultado = resolverRetorno(res.estado)
    vista.value = resultado.vista
    if (resultado.limpiaCarrito) limpiar()
  } catch (e: unknown) {
    // Un 404 no se arregla volviendo a preguntar; un corte de red sí.
    const err = e as { status?: number, response?: { status?: number } } | null
    vista.value = (err?.status ?? err?.response?.status) === 404 ? 'no_encontrada' : 'error'
  }
}

onMounted(consultar)
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
            <p v-if="monto" class="text-sm text-muted" data-qa="retorno-monto">
              Total pagado <span class="text-xl font-semibold text-default">{{ formatMonto(monto) }}</span>
            </p>
            <div v-if="tipoPago" class="text-sm text-muted">
              <span>{{ formatTipoPago(tipoPago) }}</span>
              <span v-if="tarjetaUltimos4"> ····{{ tarjetaUltimos4 }}</span>
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

          <div v-else-if="vista === 'sin_venta'" class="text-center py-6 space-y-3" data-qa="retorno-sin-venta">
            <UIcon name="i-lucide-triangle-alert" class="text-warning size-12 mx-auto" />
            <p class="font-medium">Pago recibido</p>
            <p class="text-sm text-muted">
              Recibimos tu pago pero no pudimos registrar la compra; el local se comunicará contigo.
            </p>
            <UButton to="/tienda" label="Volver a la tienda" variant="ghost" block />
          </div>

          <div v-else-if="vista === 'devuelto'" class="text-center py-6 space-y-3" data-qa="retorno-devuelto">
            <UIcon name="i-lucide-undo-2" class="text-warning size-12 mx-auto" />
            <p class="font-medium">Pago devuelto</p>
            <p class="text-sm text-muted">
              Se te cobró esta compra y el local te devolvió el pago. Si tienes dudas, comunícate con el local.
            </p>
            <UButton to="/tienda" label="Volver a la tienda" variant="ghost" block />
          </div>

          <div v-else-if="vista === 'pendiente'" class="text-center py-6 space-y-3" data-qa="retorno-pendiente">
            <UIcon name="i-lucide-clock" class="text-warning size-12 mx-auto" />
            <p class="font-medium">Pago pendiente</p>
            <p class="text-sm text-muted">
              Tu pago está en proceso de confirmación. No te avisamos por correo: toca Actualizar en unos minutos.
            </p>
            <UButton label="Actualizar" icon="i-lucide-refresh-cw" variant="soft" block @click="consultar" />
            <UButton to="/tienda" label="Volver a la tienda" variant="ghost" block />
          </div>

          <div v-else-if="vista === 'no_encontrada'" class="text-center py-6 space-y-3" data-qa="retorno-no-encontrada">
            <UIcon name="i-lucide-search-x" class="text-warning size-12 mx-auto" />
            <p class="font-medium">No encontramos esta orden</p>
            <p class="text-sm text-muted">
              El enlace no corresponde a ninguna compra de tu local. Si pagaste, revisa tus compras.
            </p>
            <UButton to="/ventas" label="Ver mis compras" variant="soft" block />
            <UButton to="/tienda" label="Volver a la tienda" variant="ghost" block />
          </div>

          <div v-else class="text-center py-6 space-y-3">
            <UIcon name="i-lucide-circle-x" class="text-error size-12 mx-auto" />
            <p class="font-medium">
              {{ vista === 'error' ? 'No pudimos verificar el pago' : 'Pago rechazado' }}
            </p>
            <p class="text-sm text-muted">
              {{ vista === 'error'
                ? 'No pudimos consultar el resultado, por ejemplo por un corte de conexión. Tu pago no se repite al consultar de nuevo.'
                : (motivoRechazo ?? 'El pago no se completó. Tu carrito sigue disponible para reintentar.') }}
            </p>
            <template v-if="vista === 'error'">
              <UButton label="Consultar de nuevo" icon="i-lucide-refresh-cw" variant="soft" block @click="consultar" />
              <UButton to="/ventas" label="Ver mis compras" variant="ghost" block />
            </template>
            <UButton v-else to="/tienda" label="Volver al carrito" variant="soft" block />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
