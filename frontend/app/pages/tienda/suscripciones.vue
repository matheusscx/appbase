<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Suscripcion } from '~/composables/useSuscripciones'
import type { CheckoutResponse } from '~/composables/useTiendaCarrito'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const permissionsStore = usePermissionsStore()

const { suscripciones, loading, pausar, reanudar, cancelar } = useSuscripciones()
const { formatMonto, formatFecha } = useFormatters()

const puedeCrear = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Tienda Online', 'Crear'),
)

function subtitulo(s: Suscripcion): string {
  const dia = detalleDia(s)
  const frecuencia = dia ? `${frecuenciaLabel[s.frecuencia]} ${dia}` : frecuenciaLabel[s.frecuencia]
  const base = `${formatMonto(s.precio, s.monedaId ?? undefined)} · ${frecuencia}`
  if (s.estado === 'cancelada' && s.activaHasta)
    return `${base} · activa hasta el ${formatFecha(diaAnterior(s.activaHasta))}`
  if (s.estado === 'cancelada') return base
  return `${base} · próximo cobro ${formatFecha(s.proximoCobro)}`
}

// ── Modal de confirmación de cancelación ────────────────────────────────────

const cancelando = ref<Suscripcion | null>(null)
const cancelModalOpen = ref(false)

const cancelMensaje = computed(() => {
  const s = cancelando.value
  if (!s) return ''
  return `Tu suscripción seguirá activa hasta el ${formatFecha(diaAnterior(s.proximoCobro))} y se cancelará el ${formatFecha(s.proximoCobro)} a primera hora. ¿Confirmás la cancelación?`
})

function abrirCancelar(s: Suscripcion) {
  cancelando.value = s
  cancelModalOpen.value = true
}

function confirmarCancelar() {
  if (cancelando.value) cancelar(cancelando.value.id)
  cancelando.value = null
  cancelModalOpen.value = false
}

const estadoColor: Record<Suscripcion['estado'], 'success' | 'warning' | 'neutral'> = {
  activa: 'success',
  pausada: 'warning',
  cancelada: 'neutral',
}

const estadoLabel: Record<Suscripcion['estado'], string> = {
  activa: 'Activa',
  pausada: 'Pausada',
  cancelada: 'Cancelada',
}

const columns: TableColumn<Suscripcion>[] = [
  { accessorKey: 'itemNombre', header: 'Suscripción' },
  { id: 'estado', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

// ── Drawer "Nueva suscripción" ──────────────────────────────────────────────

interface ItemSuscribible {
  id: string
  nombre: string
  precioBase: string
  monedaId: string
  frecuencia: 'semanal' | 'quincenal' | 'mensual'
}

const { preferida: tarjetaPreferida } = useTarjetas()
const suscripcionCheckout = useSuscripcionCheckout()

const drawerOpen = ref(false)
const itemsSuscribibles = ref<ItemSuscribible[]>([])
const cargandoItems = ref(false)
const confirmando = ref(false)

const form = ref({
  itemId: '',
  diaMes: 1,
  diaSemana: 1,
})

const itemSeleccionado = computed(
  () => itemsSuscribibles.value.find((i) => i.id === form.value.itemId) ?? null,
)

const itemsSuscribiblesOpts = computed(() =>
  itemsSuscribibles.value.map((i) => ({
    label: `${i.nombre} — ${formatMonto(i.precioBase, i.monedaId)} / ${frecuenciaLabel[i.frecuencia]}`,
    value: i.id,
  })),
)

// Opciones de día según la frecuencia del item elegido
const diasMesOpts = computed(() => {
  const max = itemSeleccionado.value?.frecuencia === 'quincenal' ? 13 : 28
  return Array.from({ length: max }, (_, i) => ({ label: String(i + 1), value: i + 1 }))
})

const diasSemanaOpts = [
  { label: 'Lunes', value: 1 },
  { label: 'Martes', value: 2 },
  { label: 'Miércoles', value: 3 },
  { label: 'Jueves', value: 4 },
  { label: 'Viernes', value: 5 },
  { label: 'Sábado', value: 6 },
  { label: 'Domingo', value: 0 },
]

// Al cambiar de item, si el día del mes elegido quedó fuera de rango para la
// nueva frecuencia (p. ej. quincenal solo admite 1-13), lo resetea a 1.
watch(itemSeleccionado, (item) => {
  if (!item) return
  const max = item.frecuencia === 'quincenal' ? 13 : 28
  if (form.value.diaMes > max) form.value.diaMes = 1
})

async function abrirCrear() {
  form.value = { itemId: '', diaMes: 1, diaSemana: 1 }
  drawerOpen.value = true
  if (!itemsSuscribibles.value.length) {
    cargandoItems.value = true
    try {
      const res = await useApiFetch<{ data: ItemSuscribible[] }>(
        `${apiUrl}/items?tipo=suscripcion&pageSize=100`,
      )
      itemsSuscribibles.value = res.data.filter((i) => i.frecuencia)
    } catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar items suscribibles'), color: 'error' })
    } finally {
      cargandoItems.value = false
    }
  }
}

async function confirmar() {
  const item = itemSeleccionado.value
  if (!item) return
  confirmando.value = true
  try {
    const checkout = await useApiFetch<CheckoutResponse>(
      `${apiUrl}/online/checkout`,
      { method: 'POST', body: { lineas: [{ itemId: item.id, cantidad: '1' }] } },
    )
    suscripcionCheckout.value = {
      checkout,
      itemId: item.id,
      itemNombre: item.nombre,
      frecuencia: item.frecuencia,
      diaMes: item.frecuencia === 'semanal' ? null : form.value.diaMes,
      diaSemana: item.frecuencia === 'semanal' ? form.value.diaSemana : null,
      tarjeta: tarjetaPreferida.value
        ? { marca: tarjetaPreferida.value.marca, last4: tarjetaPreferida.value.last4 }
        : null,
    }
    drawerOpen.value = false
    await navigateTo(`/tienda/pasarela?ref=${checkout.checkoutRef}&modo=suscripcion`)
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al iniciar la suscripción'), color: 'error' })
  } finally {
    confirmando.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Mis suscripciones">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          title="Mis suscripciones"
          description="Compras recurrentes de items del catálogo — pausá, reanudá o cancelá cuando quieras."
        >
          <template #actions>
            <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrear">
              Nueva suscripción
            </UButton>
          </template>
        </CrudPageHeader>

        <CrudTable :data="suscripciones" :columns="columns" :loading="loading">
          <template #itemNombre-cell="{ row }">
            <CrudListItem
              :title="row.original.itemNombre"
              :subtitle="subtitulo(row.original)"
            />
          </template>

          <template #estado-cell="{ row }">
            <UBadge :color="estadoColor[row.original.estado]" variant="subtle">
              {{ estadoLabel[row.original.estado] }}
            </UBadge>
          </template>

          <template #acciones-cell="{ row }">
            <div class="flex justify-end gap-2">
              <UButton
                v-if="row.original.estado === 'activa'"
                label="Pausar"
                icon="i-lucide-pause"
                color="neutral"
                variant="soft"
                size="sm"
                @click="pausar(row.original.id)"
              />
              <UButton
                v-else-if="row.original.estado === 'pausada'"
                label="Reanudar"
                icon="i-lucide-play"
                color="primary"
                variant="soft"
                size="sm"
                @click="reanudar(row.original.id)"
              />
              <UButton
                v-if="row.original.estado !== 'cancelada'"
                label="Cancelar"
                icon="i-lucide-x"
                color="error"
                variant="soft"
                size="sm"
                @click="abrirCancelar(row.original)"
              />
            </div>
          </template>

          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              No tenés suscripciones activas.
            </div>
          </template>
        </CrudTable>

        <CrudModal
          v-model:open="cancelModalOpen"
          title="Cancelar suscripción"
          :message="cancelMensaje"
          confirm-label="Cancelar suscripción"
          @cancel="cancelando = null"
          @confirm="confirmarCancelar"
        />

        <AppDrawer v-model:open="drawerOpen" width="50%">
          <template #header>
            <span class="font-semibold text-default">Nueva suscripción</span>
          </template>

          <template #body>
            <UForm id="suscripcion-form" :state="form" class="space-y-4" @submit="confirmar">
              <UFormField label="Producto o servicio" required>
                <USelectMenu
                  v-model="form.itemId"
                  :items="itemsSuscribiblesOpts"
                  value-key="value"
                  :loading="cargandoItems"
                  placeholder="Elegí una suscripción del catálogo"
                  class="w-full"
                />
              </UFormField>

              <template v-if="itemSeleccionado">
                <UFormField
                  v-if="itemSeleccionado.frecuencia !== 'semanal'"
                  label="Día del mes"
                  required
                >
                  <USelectMenu
                    v-model="form.diaMes"
                    :items="diasMesOpts"
                    value-key="value"
                    class="w-full"
                  />
                  <p v-if="itemSeleccionado.frecuencia === 'quincenal'" class="text-xs text-muted mt-1">
                    Se cobra el día {{ form.diaMes }} y el {{ form.diaMes + 15 }} de cada mes.
                  </p>
                </UFormField>

                <UFormField v-else label="Día de la semana" required>
                  <USelectMenu
                    v-model="form.diaSemana"
                    :items="diasSemanaOpts"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

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

                <div class="text-sm space-y-1">
                  <div class="flex justify-between text-muted">
                    <span>Precio del período</span>
                    <span>{{ formatMonto(itemSeleccionado.precioBase, itemSeleccionado.monedaId) }}</span>
                  </div>
                  <div class="flex justify-between font-semibold text-default text-base pt-1 border-t border-default">
                    <span>Frecuencia</span>
                    <span>{{ frecuenciaLabel[itemSeleccionado.frecuencia] }}</span>
                  </div>
                </div>
              </template>
            </UForm>
          </template>

          <template #actions>
            <UButton color="neutral" variant="ghost" @click="drawerOpen = false">
              Cancelar
            </UButton>
            <UButton
              label="Continuar al pago"
              type="submit"
              form="suscripcion-form"
              :loading="confirmando"
              :disabled="!itemSeleccionado"
            />
          </template>
        </AppDrawer>
      </div>
    </template>
  </UDashboardPanel>
</template>
