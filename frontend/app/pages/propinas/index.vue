<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type {
  LiquidacionResumen,
  PreviewReparto,
  PreviewGrupo,
  PreviewParticipante,
  AjustesReparto,
} from '~/composables/usePropinaLiquidaciones'
import type { Turno } from '~/composables/useTurnos'
import type { Garzon } from '~/composables/useGarzones'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const router = useRouter()
const toast = useToast()
const permissions = usePermissionsStore()
const api = usePropinaLiquidaciones()
const resumenApi = usePropinaResumen()
const turnosApi = useTurnos()
const garzonesApi = useGarzones()
const { formatMonto, formatFecha, formatPorcentaje } = useFormatters()

const fechaDesde = ref('')
const fechaHasta = ref('')
const turnoIds = ref<string[]>([])

const reparto = ref<PreviewReparto | null>(null)
const exclusiones = ref<string[]>([])
const montosManuales = reactive<Record<string, string>>({})

const loadingPreview = ref(false)
const liquidando = ref(false)

const resumen = ref<{ pendienteLibreMonto: string, montoCobrado: string } | null>(null)
const historial = ref<LiquidacionResumen[]>([])
const turnos = ref<Turno[]>([])
const garzones = ref<Garzon[]>([])

const puedeLiquidar = computed(
  () => permissions.esAdmin || permissions.can('Propinas', 'Liquidar'),
)

const turnoOptions = computed(() =>
  turnos.value
    .filter(t => t.activo)
    .map(t => ({ label: t.nombre, value: t.id })),
)

const ajustes = computed<AjustesReparto>(() => ({
  exclusiones: exclusiones.value,
  montosManuales: Object.entries(montosManuales)
    .filter(([, v]) => v)
    .map(([garzonId, monto]) => ({ garzonId, monto })),
}))

const columns: TableColumn<LiquidacionResumen>[] = [
  { accessorKey: 'fechaDesde', header: 'Desde' },
  { accessorKey: 'fechaHasta', header: 'Hasta' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'poolTotal', header: 'Fondo', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

function garzonNombre(id: string): string {
  return garzones.value.find(g => g.id === id)?.nombre ?? id
}

function participantesGrupo(grupo: PreviewGrupo): PreviewParticipante[] {
  return reparto.value?.participantes.filter(p => p.grupoId === grupo.id) ?? []
}

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

function criterioLabel(criterio: string): string {
  const map: Record<string, string> = {
    PARTES_IGUALES: 'Partes iguales',
    VENTAS_NETAS: 'Ventas netas',
    HORAS_TRABAJADAS: 'Horas trabajadas',
    CANTIDAD_CUENTAS: 'Cantidad de cuentas',
    MANUAL: 'Manual',
  }
  return map[criterio] ?? criterio
}

function toIso(value: string): string {
  return new Date(value).toISOString()
}

async function cargarPreview() {
  if (!fechaDesde.value || !fechaHasta.value) return
  loadingPreview.value = true
  try {
    reparto.value = await api.preview({
      fechaDesde: toIso(fechaDesde.value),
      fechaHasta: toIso(fechaHasta.value),
      turnoIds: turnoIds.value,
      ajustes: ajustes.value,
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al calcular el reparto'), color: 'error' })
  }
  finally {
    loadingPreview.value = false
  }
}

function toggleExcluir(garzonId: string) {
  const idx = exclusiones.value.indexOf(garzonId)
  if (idx >= 0) exclusiones.value.splice(idx, 1)
  else exclusiones.value.push(garzonId)
  cargarPreview()
}

function guardarMonto() {
  cargarPreview()
}

async function liquidar() {
  if (!reparto.value) return
  liquidando.value = true
  try {
    const detalle = await api.liquidar({
      fechaDesde: toIso(fechaDesde.value),
      fechaHasta: toIso(fechaHasta.value),
      turnoIds: turnoIds.value,
      ajustes: ajustes.value,
    })
    toast.add({ title: 'Período liquidado', color: 'success' })
    await router.push(`/propinas/liquidaciones/${detalle.id}/imprimir?tipo=resumen`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al liquidar el período'), color: 'error' })
  }
  finally {
    liquidando.value = false
  }
}

function rangoMesActual(): { desde: string, hasta: string } {
  const now = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return {
    desde: fmt(new Date(now.getFullYear(), now.getMonth(), 1)),
    hasta: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
  }
}

onMounted(async () => {
  if (!permissions.permisos.length && !permissions.loading) {
    await permissions.fetchPermisos()
  }
  if (!permissions.esAdmin && !permissions.can('Propinas', 'Leer')) {
    await navigateTo('/')
    return
  }

  try {
    const [turnosResp, garzonesResp, historialResp] = await Promise.all([
      turnosApi.listar(),
      garzonesApi.listar(),
      api.listar(),
    ])
    turnos.value = turnosResp
    garzones.value = garzonesResp
    historial.value = historialResp
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar datos de propinas'), color: 'error' })
  }

  try {
    const { desde, hasta } = rangoMesActual()
    resumen.value = await resumenApi.resumen(desde, hasta)
  }
  catch (e: unknown) {
    resumen.value = null
    toast.add({ title: apiErrorMsg(e, 'Error al cargar el resumen del mes'), color: 'error' })
  }
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Propinas" />
    </template>

    <template #body>
      <div class="space-y-6">
        <CrudPageHeader
          title="Propinas"
          description="Revisa el fondo de propinas del período, ajusta el reparto entre los grupos y liquídalo."
        />

        <!-- Métricas -->
        <div class="grid gap-4 sm:grid-cols-2">
          <UCard>
            <p class="text-sm text-muted">
              Pendiente por liquidar
            </p>
            <p class="text-2xl font-semibold text-default">
              {{ resumen ? formatMonto(resumen.pendienteLibreMonto) : '—' }}
            </p>
          </UCard>
          <UCard>
            <p class="text-sm text-muted">
              Cobrado (mes)
            </p>
            <p class="text-2xl font-semibold text-default">
              {{ resumen ? formatMonto(resumen.montoCobrado) : '—' }}
            </p>
          </UCard>
        </div>

        <!-- Selector de período -->
        <UCard>
          <div class="grid gap-4 md:grid-cols-4">
            <UFormField label="Desde">
              <AppDateTimeInput v-model="fechaDesde" qa="prop-desde" />
            </UFormField>
            <UFormField label="Hasta">
              <AppDateTimeInput v-model="fechaHasta" qa="prop-hasta" />
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
                icon="i-lucide-calculator"
                label="Ver reparto"
                :loading="loadingPreview"
                @click="cargarPreview"
              />
            </div>
          </div>
        </UCard>

        <!-- Reparto en vivo -->
        <template v-if="reparto">
          <UCard>
            <p class="text-sm text-muted">
              Fondo total del período
            </p>
            <p class="text-3xl font-bold text-default">
              {{ formatMonto(reparto.poolTotal, reparto.monedaId) }}
            </p>
          </UCard>

          <UAlert
            v-for="w in reparto.advertencias"
            :key="w"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="w"
          />

          <div class="space-y-4">
            <UCard v-for="grupo in reparto.grupos" :key="grupo.id">
              <template #header>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p class="font-medium text-default">
                      {{ grupo.nombre }}
                    </p>
                    <p class="text-sm text-muted">
                      {{ formatPorcentaje(grupo.porcentaje) }} · {{ criterioLabel(grupo.criterio) }}
                    </p>
                  </div>
                  <p class="font-semibold text-default">
                    {{ formatMonto(grupo.montoGrupo, reparto.monedaId) }}
                  </p>
                </div>
              </template>
              <div class="space-y-3">
                <div
                  v-for="p in participantesGrupo(grupo)"
                  :key="p.garzonId"
                  class="rounded-lg border border-default p-3"
                >
                  <div class="grid gap-3 lg:grid-cols-[1fr_140px_140px_auto] lg:items-center">
                    <div>
                      <p class="font-medium text-default" :class="{ 'line-through opacity-60': !p.incluido }">
                        {{ garzonNombre(p.garzonId) }}
                      </p>
                      <p v-if="!p.incluido" class="text-xs text-muted">
                        Excluido
                      </p>
                    </div>
                    <div class="text-sm">
                      <p class="text-muted">
                        Monto
                      </p>
                      <p class="font-medium text-default">
                        {{ formatMonto(p.monto, reparto.monedaId) }}
                      </p>
                    </div>
                    <div v-if="grupo.criterio === 'MANUAL' && puedeLiquidar" class="flex items-end gap-2">
                      <UInput
                        v-model="montosManuales[p.garzonId]"
                        size="sm"
                        inputmode="decimal"
                        placeholder="Monto manual"
                        @keyup.enter="guardarMonto"
                      />
                      <UButton
                        size="sm"
                        variant="outline"
                        icon="i-lucide-save"
                        :loading="loadingPreview"
                        @click="guardarMonto"
                      />
                    </div>
                    <div v-else />
                    <div class="flex items-end">
                      <UButton
                        size="sm"
                        class="w-full justify-center"
                        :variant="p.incluido ? 'outline' : 'solid'"
                        :color="p.incluido ? 'neutral' : 'primary'"
                        :label="p.incluido ? 'Excluir' : 'Incluir'"
                        :disabled="!puedeLiquidar"
                        :loading="loadingPreview"
                        @click="toggleExcluir(p.garzonId)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </UCard>
          </div>

          <div class="flex justify-end">
            <UButton
              icon="i-lucide-hand-coins"
              label="Liquidar período"
              size="lg"
              :loading="liquidando"
              :disabled="!reparto || Number(reparto.poolTotal) === 0 || !puedeLiquidar"
              @click="liquidar"
            />
          </div>
        </template>

        <!-- Historial -->
        <UCard>
          <template #header>
            <span class="font-medium text-default">Liquidaciones cerradas</span>
          </template>
          <UTable
            :data="historial"
            :columns="columns"
            @select="(_, row) => router.push(`/propinas/liquidaciones/${row.original.id}/imprimir?tipo=resumen`)"
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
          </UTable>
          <p v-if="historial.length === 0" class="py-8 text-center text-sm text-muted">
            Todavía no hay liquidaciones cerradas.
          </p>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
