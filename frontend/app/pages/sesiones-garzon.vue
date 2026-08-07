<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { etiquetaCuentaPendiente, useTransferenciaPendientes, type SesionGarzon } from '~/composables/useSesionesGarzon'
import type { Garzon } from '~/composables/useGarzones'
import type { Turno } from '~/composables/useTurnos'
import { shellUi } from '~/utils/ui-shell'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const toast = useToast()
const { formatFecha } = useFormatters()
const { pageSize } = useUserPreferences()
const sesionesApi = useSesionesGarzon()
const salonesApi = useSalones()
const garzonesApi = useGarzones()
const turnosApi = useTurnos()

const { puedeActualizar: puedeForzarCierre } = usePermisosCrud('Salones')

const abiertas = ref<SesionGarzon[]>([])
const loadingAbiertas = ref(false)

const tab = ref('abiertas')
const tabs = computed(() => [
  {
    label: 'Abiertas',
    value: 'abiertas',
    icon: 'i-lucide-radio',
    badge: abiertas.value.length || undefined,
  },
  { label: 'Historial', value: 'historial', icon: 'i-lucide-history' },
])

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
    const sesion = await sesionesApi.cerrarAdmin(id)
    abiertas.value = abiertas.value.filter(s => s.id !== id)
    toast.add({ title: 'Sesión cerrada', color: 'success' })
    // Forzar el cierre no bloquea, pero deja las mesas del garzón sin poder
    // cobrarse hasta que alguien en turno las reciba. Ver
    // `docs/features/turnos-garzones.md`.
    pendientesDestinoId.value = destinoOptions.value[0]?.value
    ofrecerTransferencia(sesion)
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

// ── Mesas que quedaron sin responsable en turno ──────────────────────────────
const {
  pendientes,
  garzonNombre: pendientesGarzon,
  abierto: pendientesOpen,
  transfiriendo: transfiriendoPendientes,
  ofrecer: ofrecerTransferencia,
  transferirTodas,
} = useTransferenciaPendientes()

const pendientesDestinoId = ref<string | undefined>()

// Los destinos salen de las sesiones que siguen abiertas —"alguien en turno"—,
// no del catálogo de garzones: el backend rechaza transferir a quien no tiene
// sesión, así que ofrecer a todos sería ofrecer opciones que fallan. Se
// deduplica porque un garzón podría figurar más de una vez si algo dejó dos
// sesiones abiertas.
const destinoOptions = computed(() => {
  const vistos = new Set<string>()
  return abiertas.value.flatMap((s) => {
    if (vistos.has(s.garzonId)) return []
    vistos.add(s.garzonId)
    return [{ label: `${s.garzonNombre} · ${s.turnoNombre}`, value: s.garzonId }]
  })
})

function transferirPendientes() {
  const garzonId = pendientesDestinoId.value
  if (!garzonId) return
  void transferirTodas(async (cuentaId) => {
    await salonesApi.transferirCuentaAdmin(cuentaId, garzonId)
  })
}

const columnsAbiertas: TableColumn<SesionGarzon>[] = [
  { accessorKey: 'garzonNombre', header: 'Garzón' },
  { accessorKey: 'turnoNombre', header: 'Turno' },
  { accessorKey: 'inicioEl', header: 'Inicio' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

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
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Sesiones de garzón" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          title="Sesiones de garzón"
          description="Quién está en turno ahora y el historial de sesiones."
        />

        <UTabs v-model="tab" :items="tabs" :content="false" />

        <template v-if="tab === 'abiertas'">
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
        </template>

        <template v-else-if="tab === 'historial'">
          <div class="space-y-3">
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
          </div>
        </template>

        <UModal
          v-model:open="pendientesOpen"
          title="Quedaron mesas sin responsable"
          :description="`${pendientesGarzon} salió de turno con cuentas abiertas a su nombre. Nadie puede cobrarlas hasta transferirlas a alguien en turno.`"
          :ui="shellUi.modal"
        >
          <template #body>
            <ul class="divide-y divide-default">
              <li
                v-for="pendiente in pendientes"
                :key="pendiente.cuentaId"
                class="flex items-center gap-2 py-2 text-sm text-default"
              >
                <UIcon name="i-lucide-utensils" class="size-4 shrink-0 text-muted" />
                {{ etiquetaCuentaPendiente(pendiente) }}
              </li>
            </ul>

            <p v-if="destinoOptions.length === 0" class="mt-4 text-sm text-muted">
              No hay ningún garzón en turno para recibirlas. Quedan a nombre de
              {{ pendientesGarzon }} hasta que alguien entre a turno y las tome.
            </p>
            <UFormField v-else label="Transferir a" required class="mt-4">
              <USelectMenu
                v-model="pendientesDestinoId"
                :items="destinoOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
          </template>
          <template #footer>
            <AppModalFooter>
              <UButton color="neutral" variant="ghost" @click="() => { pendientesOpen = false }">
                {{ destinoOptions.length === 0 ? 'Entendido' : 'Ahora no' }}
              </UButton>
              <UButton
                v-if="destinoOptions.length > 0"
                icon="i-lucide-arrow-right-left"
                :disabled="!pendientesDestinoId"
                :loading="transfiriendoPendientes"
                @click="transferirPendientes"
              >
                Transferir
              </UButton>
            </AppModalFooter>
          </template>
        </UModal>

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
  </UDashboardPanel>
</template>
