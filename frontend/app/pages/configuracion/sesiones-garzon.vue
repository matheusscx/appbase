<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { SesionGarzon } from '~/composables/useSesionesGarzon'
import type { Garzon } from '~/composables/useGarzones'
import type { Turno } from '~/composables/useTurnos'

const toast = useToast()
const { formatFecha } = useFormatters()
const { pageSize } = useUserPreferences()
const permissionsStore = usePermissionsStore()
const sesionesApi = useSesionesGarzon()
const garzonesApi = useGarzones()
const turnosApi = useTurnos()

const puedeForzarCierre = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Salones', 'Actualizar'),
)

// ── Sesiones abiertas ────────────────────────────────────────────────────────

const abiertas = ref<SesionGarzon[]>([])
const loadingAbiertas = ref(false)

async function cargarAbiertas() {
  loadingAbiertas.value = true
  try {
    abiertas.value = await sesionesApi.listarAbiertas()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar sesiones abiertas'), color: 'error' })
  }
  finally {
    loadingAbiertas.value = false
  }
}

const cierreOpen = ref(false)
const cierreLoading = ref(false)
const toCerrar = ref<SesionGarzon | null>(null)

function confirmarCierre(sesion: SesionGarzon) {
  toCerrar.value = sesion
  cierreOpen.value = true
}

async function forzarCierre() {
  if (!toCerrar.value) return
  cierreLoading.value = true
  try {
    const id = toCerrar.value.id
    await sesionesApi.cerrarAdmin(id)
    abiertas.value = abiertas.value.filter(s => s.id !== id)
    toast.add({ title: 'Sesión cerrada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al forzar el cierre'), color: 'error' })
  }
  finally {
    cierreLoading.value = false
    cierreOpen.value = false
    toCerrar.value = null
  }
}

const columnsAbiertas: TableColumn<SesionGarzon>[] = [
  { accessorKey: 'garzonNombre', header: 'Garzón' },
  { accessorKey: 'turnoNombre', header: 'Turno' },
  { accessorKey: 'inicioEl', header: 'Inicio' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

// ── Historial ────────────────────────────────────────────────────────────────

const garzones = ref<Garzon[]>([])
const turnos = ref<Turno[]>([])

const filtroGarzon = ref<string | undefined>()
const filtroTurno = ref<string | undefined>()
const filtroEstado = ref<string | undefined>()
const filtroDesde = ref('')
const filtroHasta = ref('')

const listFilters = computed(() => ({
  garzonId: filtroGarzon.value,
  turnoId: filtroTurno.value,
  estado: filtroEstado.value,
  desde: filtroDesde.value || undefined,
  hasta: filtroHasta.value || undefined,
}))

const { items: historial, meta, page, loading: loadingHistorial } =
  usePaginatedList<SesionGarzon>({
    path: '/sesiones-garzon',
    pageSize,
    filters: listFilters,
  })

const garzonOptions = computed(() =>
  garzones.value.map(g => ({ label: g.nombre, value: g.id })),
)

const turnoOptions = computed(() =>
  turnos.value.map(t => ({ label: t.nombre, value: t.id })),
)

const estadoOptions = [
  { label: 'Abierta', value: 'abierta' },
  { label: 'Cerrada', value: 'cerrada' },
]

const hayFiltrosActivos = computed(() =>
  !!filtroGarzon.value
  || !!filtroTurno.value
  || !!filtroEstado.value
  || !!filtroDesde.value
  || !!filtroHasta.value,
)

function limpiarFiltros() {
  filtroGarzon.value = undefined
  filtroTurno.value = undefined
  filtroEstado.value = undefined
  filtroDesde.value = ''
  filtroHasta.value = ''
}

function origenLabel(origen: SesionGarzon['origenCierre']): string {
  if (origen === 'admin') return 'Admin'
  if (origen === 'pin') return 'PIN'
  return '—'
}

const columnsHistorial: TableColumn<SesionGarzon>[] = [
  { accessorKey: 'garzonNombre', header: 'Garzón' },
  { accessorKey: 'turnoNombre', header: 'Turno' },
  { accessorKey: 'inicioEl', header: 'Inicio' },
  { accessorKey: 'finEl', header: 'Fin' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'origenCierre', header: 'Origen cierre' },
]

async function cargarOpciones() {
  try {
    const [g, t] = await Promise.all([
      garzonesApi.listar(),
      turnosApi.listar(),
    ])
    garzones.value = g
    turnos.value = t
  }
  catch {
    // El historial sigue usable sin filtros de select
  }
}

onMounted(async () => {
  await Promise.all([cargarAbiertas(), cargarOpciones()])
})
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Sesiones de garzón"
      description="Sesiones de trabajo abiertas e historial por turno."
    />

    <!-- Abiertas ahora -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-default">
        Abiertas ahora
      </h2>

      <CrudTable
        :data="abiertas"
        :columns="columnsAbiertas"
        :loading="loadingAbiertas"
      >
        <template #garzonNombre-cell="{ row }">
          <span class="font-medium text-default">{{ row.original.garzonNombre }}</span>
        </template>

        <template #turnoNombre-cell="{ row }">
          <span class="text-default">{{ row.original.turnoNombre }}</span>
        </template>

        <template #inicioEl-cell="{ row }">
          <span class="whitespace-nowrap tabular-nums">{{ formatFecha(row.original.inicioEl) }}</span>
        </template>

        <template #acciones-cell="{ row }">
          <div
            v-if="puedeForzarCierre"
            class="flex items-center justify-end"
          >
            <UButton
              color="error"
              variant="ghost"
              size="sm"
              icon="i-lucide-log-out"
              @click="confirmarCierre(row.original)"
            >
              Forzar cierre
            </UButton>
          </div>
        </template>

        <template #empty>
          <div class="py-8 text-center text-sm text-muted">
            No hay sesiones abiertas.
          </div>
        </template>
      </CrudTable>
    </section>

    <!-- Historial -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-default">
        Historial
      </h2>

      <div class="flex flex-wrap items-center gap-2">
        <USelectMenu
          v-model="filtroGarzon"
          :items="garzonOptions"
          value-key="value"
          placeholder="Garzón"
          searchable
          class="w-48"
        />
        <USelectMenu
          v-model="filtroTurno"
          :items="turnoOptions"
          value-key="value"
          placeholder="Turno"
          searchable
          class="w-44"
        />
        <USelect
          v-model="filtroEstado"
          :items="estadoOptions"
          placeholder="Estado"
          class="w-36"
        />
        <AppDateInput v-model="filtroDesde" class="w-44" qa="sesiones-desde" />
        <AppDateInput v-model="filtroHasta" class="w-44" qa="sesiones-hasta" />
        <UButton
          v-if="hayFiltrosActivos"
          label="Limpiar filtros"
          icon="i-lucide-x"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="limpiarFiltros"
        />
      </div>

      <CrudTable
        :data="historial"
        :columns="columnsHistorial"
        :loading="loadingHistorial"
      >
        <template #garzonNombre-cell="{ row }">
          <span class="font-medium text-default">{{ row.original.garzonNombre || '—' }}</span>
        </template>

        <template #turnoNombre-cell="{ row }">
          <span class="text-default">{{ row.original.turnoNombre || '—' }}</span>
        </template>

        <template #inicioEl-cell="{ row }">
          <span class="whitespace-nowrap tabular-nums">{{ formatFecha(row.original.inicioEl) }}</span>
        </template>

        <template #finEl-cell="{ row }">
          <span class="whitespace-nowrap tabular-nums text-muted">
            {{ row.original.finEl ? formatFecha(row.original.finEl) : '—' }}
          </span>
        </template>

        <template #estado-cell="{ row }">
          <UBadge
            :color="row.original.estado === 'abierta' ? 'success' : 'neutral'"
            variant="subtle"
            size="xs"
          >
            {{ row.original.estado === 'abierta' ? 'Abierta' : 'Cerrada' }}
          </UBadge>
        </template>

        <template #origenCierre-cell="{ row }">
          <span class="text-muted">{{ origenLabel(row.original.origenCierre) }}</span>
        </template>

        <template #empty>
          <div class="py-8 text-center text-sm text-muted">
            {{ hayFiltrosActivos ? 'Ninguna sesión coincide con los filtros.' : 'Sin sesiones registradas.' }}
          </div>
        </template>

        <template
          v-if="meta.total > pageSize"
          #footer
        >
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="meta.total"
          />
        </template>
      </CrudTable>
    </section>

    <CrudModal
      v-model:open="cierreOpen"
      title="Forzar cierre de sesión"
      :message="toCerrar
        ? `Se cerrará la sesión de ${toCerrar.garzonNombre} (${toCerrar.turnoNombre}). Esta acción queda registrada como cierre administrativo.`
        : ''"
      confirm-label="Forzar cierre"
      confirm-color="error"
      :loading="cierreLoading"
      @cancel="toCerrar = null"
      @confirm="forzarCierre"
    />
  </div>
</template>
