<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { SuscripcionAdmin } from '~/composables/useSuscripcionesAdmin'

// El gate de página espera los permisos antes de decidir. El `if` que había en el `setup` corría antes de que
// llegaran, así que el F5 de un dueño con permiso lo mandaba a Inicio sin decir nada (auditoría UX 09.3).
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Suscripciones:Leer',
  permisoLabel: 'Suscripciones',
  layout: 'dashboard',
})

const {
  puedeActualizar,
  puedeEliminar,
} = usePermisosCrud('Suscripciones')

const { suscripciones, loading, error, sinPermiso, cargar, cancelar, eliminar } = useSuscripcionesAdmin()
const { formatMonto, formatFecha } = useFormatters()

const filtroEstado = ref<'todas' | SuscripcionAdmin['estado']>('todas')
const filtroOpts = [
  { label: 'Todas', value: 'todas' },
  { label: 'Activas', value: 'activa' },
  { label: 'Canceladas', value: 'cancelada' },
]

const busqueda = ref('')
const terminoBusqueda = computed(() => busqueda.value.trim())

const filtradas = computed(() => {
  const q = terminoBusqueda.value.toLowerCase()
  return suscripciones.value.filter(s =>
    (filtroEstado.value === 'todas' || s.estado === filtroEstado.value)
    && (!q || s.usuarioNombre.toLowerCase().includes(q) || s.usuarioEmail.toLowerCase().includes(q)),
  )
})

const hayFiltros = computed(() => filtroEstado.value !== 'todas' || !!terminoBusqueda.value)
function quitarFiltros() {
  filtroEstado.value = 'todas'
  busqueda.value = ''
}

const ESTADO_PLURAL = { activa: 'activas', cancelada: 'canceladas' } as const
/** El vacío nombra el filtro: "No hay suscripciones canceladas", no el "no hay ninguna" de siempre (09.23). */
const textoFiltrado = computed(() => {
  const estado = filtroEstado.value === 'todas' ? '' : ` ${ESTADO_PLURAL[filtroEstado.value]}`
  return terminoBusqueda.value
    ? `No encontramos «${terminoBusqueda.value}»${estado ? ` entre las suscripciones${estado}` : ''}.`
    : `No hay suscripciones${estado}.`
})

function subtituloPlan(s: SuscripcionAdmin): string {
  const dia = detalleDia(s)
  const frecuencia = dia ? `${frecuenciaLabel[s.frecuencia]} ${dia}` : frecuenciaLabel[s.frecuencia]
  return `${formatMonto(s.precio, s.monedaId ?? undefined)} · ${frecuencia}`
}

function vigencia(s: SuscripcionAdmin): string {
  if (s.estado === 'cancelada' && s.activaHasta)
    return `Activa hasta el ${formatFecha(diaAnterior(s.activaHasta))}`
  if (s.estado === 'cancelada') return ''
  return `Próximo cobro ${formatFecha(s.proximoCobro)}`
}

const estadoColor: Record<SuscripcionAdmin['estado'], 'success' | 'neutral'> = {
  activa: 'success',
  cancelada: 'neutral',
}

const estadoLabel: Record<SuscripcionAdmin['estado'], string> = {
  activa: 'Activa',
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
  return `La suscripción de ${s.usuarioNombre} seguirá activa hasta el ${formatFecha(diaAnterior(s.proximoCobro))} y se cancelará el ${formatFecha(s.proximoCobro)} a primera hora. ¿Confirmas la cancelación?`
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
      <AppNavbar title="Suscripciones de clientes">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          title="Suscripciones de clientes"
          description="Administración de las suscripciones de los clientes de tu local."
        >
          <template #actions>
            <UInput
              v-model="busqueda"
              icon="i-lucide-search"
              placeholder="Buscar por cliente o correo"
              class="w-64"
              data-qa="suscripciones-busqueda"
            />
            <USelectMenu
              v-model="filtroEstado"
              :items="filtroOpts"
              value-key="value"
              class="w-40"
            />
          </template>
        </CrudPageHeader>

        <CrudTable
          :data="filtradas"
          :columns="columns"
          :loading="loading"
          :error="error"
          :sin-permiso="sinPermiso"
          recurso="las suscripciones"
          vacio="No hay suscripciones para mostrar."
          :filtrado="hayFiltros"
          :filtrado-texto="textoFiltrado"
          @reintentar="cargar"
          @quitar-filtros="quitarFiltros"
        >
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
            <div class="flex justify-end items-center gap-2">
              <template v-if="puedeActualizar">
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

        </CrudTable>

        <CrudModal
          v-model:open="cancelModalOpen"
          title="Cancelar suscripción"
          :message="cancelMensaje"
          confirm-label="Sí, cancelar suscripción"
          cancel-label="Volver"
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
