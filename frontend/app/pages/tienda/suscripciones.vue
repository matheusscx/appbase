<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Suscripcion } from '~/composables/useSuscripciones'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const route = useRoute()
const router = useRouter()
const toast = useToast()
const permissionsStore = usePermissionsStore()

const { suscripciones, loading, pausar, reanudar, cancelar, cambiarTarjeta, cargar } =
  useSuscripciones()
const {
  tarjetas,
  preferida: tarjetaPreferida,
  oneclickDisponible,
  agregar: agregarTarjeta,
} = useTarjetas()
const { formatMonto, formatFecha } = useFormatters()

const puedeCrear = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Tienda Online', 'Crear'),
)

// Clave de localStorage: intención de alta que sobrevive el redirect a Transbank
// cuando el usuario inscribe una tarjeta nueva desde el drawer (useState no
// sobrevive un full-page redirect; localStorage sí).
const INTENT_KEY = 'suscripcion-pendiente'
interface AltaPendiente {
  itemId: string
  diaMes: number | null
  diaSemana: number | null
}

const tarjetaOpts = computed(() =>
  tarjetas.value.map((t) => ({
    label: `${t.marca ?? 'Tarjeta'} •••• ${t.last4 ?? '????'}`,
    value: t.inscripcionId,
  })),
)

function subtitulo(s: Suscripcion): string {
  const dia = detalleDia(s)
  const frecuencia = dia ? `${frecuenciaLabel[s.frecuencia]} ${dia}` : frecuenciaLabel[s.frecuencia]
  const base = `${formatMonto(s.precio, s.monedaId ?? undefined)} · ${frecuencia}`
  if (s.estado === 'cancelada' && s.activaHasta)
    return `${base} · activa hasta el ${formatFecha(diaAnterior(s.activaHasta))}`
  if (s.estado === 'cancelada') return base
  const tarjeta = s.tarjetaLast4 ? ` · ${s.tarjetaMarca ?? 'Tarjeta'} ••••${s.tarjetaLast4}` : ''
  return `${base} · próximo cobro ${formatFecha(s.proximoCobro)}${tarjeta}`
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

// ── Modal "Cambiar tarjeta" ─────────────────────────────────────────────────

const cambiandoTarjeta = ref<Suscripcion | null>(null)
const cambiarTarjetaModalOpen = ref(false)
const nuevaInscripcionId = ref('')
const guardandoTarjeta = ref(false)

function abrirCambiarTarjeta(s: Suscripcion) {
  cambiandoTarjeta.value = s
  nuevaInscripcionId.value = s.inscripcionId ?? tarjetaPreferida.value?.inscripcionId ?? ''
  cambiarTarjetaModalOpen.value = true
}

async function confirmarCambiarTarjeta() {
  const s = cambiandoTarjeta.value
  if (!s || !nuevaInscripcionId.value) return
  guardandoTarjeta.value = true
  try {
    await cambiarTarjeta(s.id, nuevaInscripcionId.value)
    cambiarTarjetaModalOpen.value = false
    cambiandoTarjeta.value = null
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo cambiar la tarjeta'), color: 'error' })
  } finally {
    guardandoTarjeta.value = false
  }
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

const drawerOpen = ref(false)
const itemsSuscribibles = ref<ItemSuscribible[]>([])
const cargandoItems = ref(false)
const confirmando = ref(false)
const selectedInscripcionId = ref('')

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

// Días concretos según la frecuencia del item elegido (para POST e intención).
function diasDePayload(item: ItemSuscribible): {
  diaMes: number | null
  diaSemana: number | null
} {
  return item.frecuencia === 'semanal'
    ? { diaMes: null, diaSemana: form.value.diaSemana }
    : { diaMes: form.value.diaMes, diaSemana: null }
}

async function abrirCrear() {
  form.value = { itemId: '', diaMes: 1, diaSemana: 1 }
  selectedInscripcionId.value = tarjetaPreferida.value?.inscripcionId ?? ''
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

// "Agregar nueva tarjeta" desde el drawer: guarda la intención de alta y sale a
// Transbank. Al volver a esta página con la inscripción activa se reanuda el cobro.
async function agregarTarjetaDesdeAlta() {
  const item = itemSeleccionado.value
  if (!item) return
  const { diaMes, diaSemana } = diasDePayload(item)
  const intent: AltaPendiente = { itemId: item.id, diaMes, diaSemana }
  localStorage.setItem(INTENT_KEY, JSON.stringify(intent))
  try {
    await agregarTarjeta('suscripciones') // full-page redirect a Webpay
  } catch (e: unknown) {
    localStorage.removeItem(INTENT_KEY)
    toast.add({ title: apiErrorMsg(e, 'No se pudo iniciar la inscripción'), color: 'error' })
  }
}

async function confirmar() {
  const item = itemSeleccionado.value
  if (!item || !selectedInscripcionId.value) return
  confirmando.value = true
  try {
    const { diaMes, diaSemana } = diasDePayload(item)
    await useApiFetch(`${apiUrl}/suscripciones`, {
      method: 'POST',
      body: {
        itemId: item.id,
        diaMes: diaMes ?? undefined,
        diaSemana: diaSemana ?? undefined,
        inscripcionId: selectedInscripcionId.value,
      },
    })
    drawerOpen.value = false
    toast.add({ title: 'Suscripción activada y primer cobro realizado', color: 'success' })
    await cargar()
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo activar la suscripción'), color: 'error' })
  } finally {
    confirmando.value = false
  }
}

// ── Reanudar alta tras inscribir una tarjeta (retorno de Transbank) ──────────

const procesandoAlta = ref(false)

async function reanudarAltaPendiente(inscripcionId: string) {
  const raw = localStorage.getItem(INTENT_KEY)
  localStorage.removeItem(INTENT_KEY)
  if (!raw) return
  let intent: AltaPendiente
  try {
    intent = JSON.parse(raw) as AltaPendiente
  } catch {
    return
  }
  procesandoAlta.value = true
  try {
    await useApiFetch(`${apiUrl}/suscripciones`, {
      method: 'POST',
      body: {
        itemId: intent.itemId,
        diaMes: intent.diaMes ?? undefined,
        diaSemana: intent.diaSemana ?? undefined,
        inscripcionId,
      },
    })
    toast.add({ title: 'Suscripción activada y primer cobro realizado', color: 'success' })
    await cargar()
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo activar la suscripción'), color: 'error' })
  } finally {
    procesandoAlta.value = false
  }
}

onMounted(async () => {
  // Retorno de Webpay tras inscribir una tarjeta desde el alta:
  // /tienda/suscripciones?inscripcionId=...&estado=activa|fallida
  const estado = route.query.estado
  const inscripcionId = route.query.inscripcionId
  if (typeof estado === 'string' && typeof inscripcionId === 'string') {
    if (estado === 'activa') {
      await reanudarAltaPendiente(inscripcionId)
    } else {
      localStorage.removeItem(INTENT_KEY)
      toast.add({ title: 'La inscripción de la tarjeta fue rechazada', color: 'error' })
    }
    await router.replace({ query: {} })
  }
})
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
            <UButton
              v-if="puedeCrear"
              icon="i-lucide-plus"
              :loading="procesandoAlta"
              @click="abrirCrear"
            >
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
                v-if="row.original.estado !== 'cancelada'"
                label="Cambiar tarjeta"
                icon="i-lucide-credit-card"
                color="neutral"
                variant="soft"
                size="sm"
                @click="abrirCambiarTarjeta(row.original)"
              />
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

        <UModal v-model:open="cambiarTarjetaModalOpen" title="Cambiar tarjeta">
          <template #body>
            <div class="space-y-3">
              <p class="text-sm text-muted">
                Elegí con qué tarjeta se cobrará esta suscripción a partir del próximo período.
              </p>
              <USelectMenu
                v-model="nuevaInscripcionId"
                :items="tarjetaOpts"
                value-key="value"
                placeholder="Elegí una tarjeta"
                class="w-full"
              />
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2 w-full">
              <UButton
                color="neutral"
                variant="ghost"
                @click="cambiarTarjetaModalOpen = false"
              >
                Cancelar
              </UButton>
              <UButton
                label="Guardar"
                :loading="guardandoTarjeta"
                :disabled="!nuevaInscripcionId"
                @click="confirmarCambiarTarjeta"
              />
            </div>
          </template>
        </UModal>

        <AppDrawer v-model:open="drawerOpen" width="50%">
          <template #header>
            <span class="font-semibold text-default">Nueva suscripción</span>
          </template>

          <template #body>
            <UAlert
              v-if="!oneclickDisponible"
              icon="i-lucide-triangle-alert"
              color="warning"
              variant="soft"
              title="Suscripciones no disponibles"
              description="El tenant no tiene una pasarela con tokenización (Oneclick) activa, necesaria para cobrar las suscripciones."
              class="mb-4"
            />

            <UForm id="suscripcion-form" :state="form" class="space-y-4" @submit="confirmar">
              <UFormField label="Producto o servicio" required>
                <USelectMenu
                  v-model="form.itemId"
                  :items="itemsSuscribiblesOpts"
                  value-key="value"
                  :loading="cargandoItems"
                  :disabled="!oneclickDisponible"
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

                <div class="border border-default rounded-lg p-3 space-y-2">
                  <p class="text-xs text-muted">Medio de pago</p>

                  <template v-if="tarjetas.length">
                    <USelectMenu
                      v-model="selectedInscripcionId"
                      :items="tarjetaOpts"
                      value-key="value"
                      placeholder="Elegí una tarjeta"
                      class="w-full"
                    />
                    <UButton
                      icon="i-lucide-plus"
                      label="Agregar nueva tarjeta"
                      size="xs"
                      variant="soft"
                      color="neutral"
                      @click="agregarTarjetaDesdeAlta"
                    />
                  </template>

                  <div v-else class="flex items-center justify-between gap-2">
                    <span class="text-sm text-muted">No tenés tarjetas registradas.</span>
                    <UButton
                      icon="i-lucide-plus"
                      label="Agregar tarjeta"
                      size="xs"
                      variant="soft"
                      @click="agregarTarjetaDesdeAlta"
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
              label="Suscribirme y pagar"
              type="submit"
              form="suscripcion-form"
              :loading="confirmando"
              :disabled="!itemSeleccionado || !oneclickDisponible || !selectedInscripcionId"
            />
          </template>
        </AppDrawer>
      </div>
    </template>
  </UDashboardPanel>
</template>
