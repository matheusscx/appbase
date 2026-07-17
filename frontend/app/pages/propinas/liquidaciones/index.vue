<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Turno } from '~/composables/useTurnos'
import type { LiquidacionResumen } from '~/composables/usePropinaLiquidaciones'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const toast = useToast()
const router = useRouter()
const permissionsStore = usePermissionsStore()
const api = usePropinaLiquidaciones()
const turnosApi = useTurnos()
const { formatMonto, formatFecha } = useFormatters()

const liquidaciones = ref<LiquidacionResumen[]>([])
const turnos = ref<Turno[]>([])
const loading = ref(false)
const creating = ref(false)

const fechaDesde = ref('')
const fechaHasta = ref('')
const turnoIds = ref<string[]>([])

const puedeLiquidar = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Propinas', 'Liquidar'),
)

const turnoOptions = computed(() =>
  turnos.value
    .filter(t => t.activo)
    .map(t => ({ label: t.nombre, value: t.id })),
)

function estadoColor(estado: string): 'neutral' | 'success' | 'error' | 'warning' {
  const map: Record<string, 'neutral' | 'success' | 'error' | 'warning'> = {
    borrador: 'warning',
    confirmada: 'success',
    anulada: 'error',
  }
  return map[estado] ?? 'neutral'
}

function estadoLabel(estado: string): string {
  const map: Record<string, string> = {
    borrador: 'Borrador',
    confirmada: 'Confirmada',
    anulada: 'Anulada',
  }
  return map[estado] ?? estado
}

const columns: TableColumn<LiquidacionResumen>[] = [
  { accessorKey: 'fechaDesde', header: 'Desde' },
  { accessorKey: 'fechaHasta', header: 'Hasta' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'poolTotal', header: 'Pool', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'configuracionVersion', header: 'Config' },
  { accessorKey: 'creadoEl', header: 'Creada' },
]

async function cargar() {
  loading.value = true
  try {
    const [lista, turnosResp] = await Promise.all([
      api.listar(),
      turnosApi.listar(),
    ])
    liquidaciones.value = lista
    turnos.value = turnosResp
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar liquidaciones'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function toIso(value: string): string {
  return new Date(value).toISOString()
}

async function crearBorrador() {
  if (!fechaDesde.value || !fechaHasta.value) {
    toast.add({ title: 'Selecciona un rango de fechas', color: 'warning' })
    return
  }
  creating.value = true
  try {
    const creado = await api.crear({
      fechaDesde: toIso(fechaDesde.value),
      fechaHasta: toIso(fechaHasta.value),
      turnoIds: turnoIds.value,
    })
    liquidaciones.value = [creado, ...liquidaciones.value]
    toast.add({ title: 'Borrador de liquidación creado', color: 'success' })
    await router.push(`/propinas/liquidaciones/${creado.id}`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al crear liquidación'), color: 'error' })
  }
  finally {
    creating.value = false
  }
}

function abrir(row: LiquidacionResumen) {
  router.push(`/propinas/liquidaciones/${row.id}`)
}

onMounted(cargar)
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Liquidación de propinas" />
    </template>

    <template #body>
      <div class="space-y-6">
        <CrudPageHeader
          title="Liquidaciones"
          description="Crea borradores por período, revisa el pool de propinas y confirma el reparto al personal."
        />

        <UCard v-if="puedeLiquidar">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-plus" class="size-5 text-muted" />
              <span class="font-medium text-default">Nuevo borrador</span>
            </div>
          </template>

          <div class="grid gap-4 md:grid-cols-4">
            <UFormField label="Desde">
              <UInput v-model="fechaDesde" type="datetime-local" />
            </UFormField>
            <UFormField label="Hasta">
              <UInput v-model="fechaHasta" type="datetime-local" />
            </UFormField>
            <UFormField label="Turnos (opcional)">
              <USelectMenu
                v-model="turnoIds"
                multiple
                :items="turnoOptions"
                value-key="value"
                placeholder="Todos los turnos"
              />
            </UFormField>
            <div class="flex items-end">
              <UButton
                class="w-full justify-center"
                icon="i-lucide-file-plus-2"
                label="Crear borrador"
                :loading="creating"
                @click="crearBorrador"
              />
            </div>
          </div>
        </UCard>

        <UCard>
          <UTable
            :data="liquidaciones"
            :columns="columns"
            :loading="loading"
            @select="(_, row) => abrir(row.original)"
          >
            <template #fechaDesde-cell="{ row }">
              {{ formatFecha(row.original.fechaDesde) }}
            </template>
            <template #fechaHasta-cell="{ row }">
              {{ formatFecha(row.original.fechaHasta) }}
            </template>
            <template #estado-cell="{ row }">
              <UBadge :color="estadoColor(row.original.estado)" variant="subtle">
                {{ estadoLabel(row.original.estado) }}
              </UBadge>
            </template>
            <template #poolTotal-cell="{ row }">
              {{ formatMonto(row.original.poolTotal) }}
            </template>
            <template #configuracionVersion-cell="{ row }">
              v{{ row.original.configuracionVersion }}
            </template>
            <template #creadoEl-cell="{ row }">
              {{ formatFecha(row.original.creadoEl) }}
            </template>
          </UTable>

          <p v-if="!loading && liquidaciones.length === 0" class="py-8 text-center text-sm text-muted">
            Todavía no hay liquidaciones de propinas.
          </p>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
