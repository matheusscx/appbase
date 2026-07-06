<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { SuscripcionAdmin } from '~/composables/useSuscripcionesAdmin'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const permissionsStore = usePermissionsStore()

const puedeVer = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Suscripciones', 'Leer'),
)
const puedeActualizar = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Suscripciones', 'Actualizar'),
)
const puedeEliminar = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Suscripciones', 'Eliminar'),
)

if (import.meta.client && !puedeVer.value) {
  await navigateTo('/')
}

const { suscripciones, loading, pausar, reanudar, cancelar, eliminar } = useSuscripcionesAdmin()
const { formatMonto, formatFecha } = useFormatters()

const filtroEstado = ref<'todas' | SuscripcionAdmin['estado']>('todas')
const filtroOpts = [
  { label: 'Todas', value: 'todas' },
  { label: 'Activas', value: 'activa' },
  { label: 'Pausadas', value: 'pausada' },
  { label: 'Canceladas', value: 'cancelada' },
]

const filtradas = computed(() =>
  filtroEstado.value === 'todas'
    ? suscripciones.value
    : suscripciones.value.filter((s) => s.estado === filtroEstado.value),
)

function subtituloPlan(s: SuscripcionAdmin): string {
  const dia = detalleDia(s)
  const frecuencia = dia ? `${frecuenciaLabel[s.frecuencia]} ${dia}` : frecuenciaLabel[s.frecuencia]
  return `${formatMonto(s.precio, s.monedaId ?? undefined)} · ${frecuencia}`
}

function vigencia(s: SuscripcionAdmin): string {
  if (s.estado === 'cancelada' && s.activaHasta)
    return `Activa hasta el ${formatFecha(diaAnterior(s.activaHasta))} — se cancela el ${formatFecha(s.activaHasta)} a primera hora`
  if (s.estado === 'cancelada') return ''
  return `Próximo cobro ${formatFecha(s.proximoCobro)}`
}

const estadoColor: Record<SuscripcionAdmin['estado'], 'success' | 'warning' | 'neutral'> = {
  activa: 'success',
  pausada: 'warning',
  cancelada: 'neutral',
}

const estadoLabel: Record<SuscripcionAdmin['estado'], string> = {
  activa: 'Activa',
  pausada: 'Pausada',
  cancelada: 'Cancelada',
}

const columns: TableColumn<SuscripcionAdmin>[] = [
  { accessorKey: 'usuarioNombre', header: 'Cliente' },
  { accessorKey: 'itemNombre', header: 'Suscripción' },
  { id: 'estado', header: 'Estado' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

// ── Modales de confirmación ─────────────────────────────────────────────────

const cancelando = ref<SuscripcionAdmin | null>(null)
const cancelModalOpen = ref(false)
const eliminando = ref<SuscripcionAdmin | null>(null)
const eliminarModalOpen = ref(false)

const cancelMensaje = computed(() => {
  const s = cancelando.value
  if (!s) return ''
  return `La suscripción de ${s.usuarioNombre} seguirá activa hasta el ${formatFecha(diaAnterior(s.proximoCobro))} y se cancelará el ${formatFecha(s.proximoCobro)} a primera hora. ¿Confirmás la cancelación?`
})

function abrirCancelar(s: SuscripcionAdmin) {
  cancelando.value = s
  cancelModalOpen.value = true
}

function confirmarCancelar() {
  if (cancelando.value) cancelar(cancelando.value.id)
  cancelando.value = null
  cancelModalOpen.value = false
}

function abrirEliminar(s: SuscripcionAdmin) {
  eliminando.value = s
  eliminarModalOpen.value = true
}

function confirmarEliminar() {
  if (eliminando.value) eliminar(eliminando.value.id)
  eliminando.value = null
  eliminarModalOpen.value = false
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Suscripciones">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <CrudPageHeader
          title="Suscripciones"
          description="Administración de las suscripciones de los clientes del tenant."
        >
          <template #actions>
            <USelectMenu
              v-model="filtroEstado"
              :items="filtroOpts"
              value-key="value"
              class="w-40"
            />
          </template>
        </CrudPageHeader>

        <CrudTable :data="filtradas" :columns="columns" :loading="loading">
          <template #usuarioNombre-cell="{ row }">
            <CrudListItem
              :title="row.original.usuarioNombre"
              :subtitle="row.original.usuarioEmail"
            />
          </template>

          <template #itemNombre-cell="{ row }">
            <CrudListItem
              :title="row.original.itemNombre"
              :subtitle="subtituloPlan(row.original)"
            />
          </template>

          <template #estado-cell="{ row }">
            <div class="space-y-1">
              <UBadge :color="estadoColor[row.original.estado]" variant="subtle">
                {{ estadoLabel[row.original.estado] }}
              </UBadge>
              <p v-if="vigencia(row.original)" class="text-xs text-muted">
                {{ vigencia(row.original) }}
              </p>
            </div>
          </template>

          <template #acciones-cell="{ row }">
            <div class="flex justify-end gap-2">
              <template v-if="puedeActualizar">
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
              </template>
              <UButton
                v-if="puedeEliminar && row.original.estado === 'cancelada'"
                label="Eliminar"
                icon="i-lucide-trash-2"
                color="error"
                variant="soft"
                size="sm"
                @click="abrirEliminar(row.original)"
              />
            </div>
          </template>

          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              No hay suscripciones para mostrar.
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

        <CrudModal
          v-model:open="eliminarModalOpen"
          title="Eliminar suscripción"
          :message="`¿Eliminar definitivamente la suscripción cancelada de ${eliminando?.usuarioNombre ?? ''}? Dejará de verse en la administración y en la lista del cliente.`"
          @cancel="eliminando = null"
          @confirm="confirmarEliminar"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
