<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type {
  LiquidacionResumen,
  PreviewReparto,
  PreviewGrupo,
  PreviewParticipante,
  AjustesReparto,
  PreviewBody,
} from '~/composables/usePropinaLiquidaciones'
import { claveConsultaReparto } from '~/composables/usePropinaLiquidaciones'
import type { Turno } from '~/composables/useTurnos'
import type { Garzon } from '~/composables/useGarzones'
import { rangoMesActual } from '~/composables/usePropinaResumen'

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

const tab = ref('propinas')

const reparto = ref<PreviewReparto | null>(null)
/** La consulta que produjo `reparto`: es lo único que se liquida (auditoría UX 02.1). */
const consultaMostrada = ref<PreviewBody | null>(null)
const confirmarAbierto = ref(false)
const exclusiones = ref<string[]>([])
const montosManuales = reactive<Record<string, string>>({})

const loadingPreview = ref(false)
const liquidando = ref(false)

const resumen = ref<{ pendienteLibreMonto: string, montoCobrado: string } | null>(null)
const historial = ref<LiquidacionResumen[]>([])
const turnos = ref<Turno[]>([])
const garzones = ref<Garzon[]>([])

const puedeLiquidar = computed(
  () => permissions.can('Propinas', 'Liquidar'),
)

const tabs = computed(() => [
  { label: 'Propinas', value: 'propinas', icon: 'i-lucide-hand-coins' },
  { label: 'Liquidaciones cerradas', value: 'liquidaciones', icon: 'i-lucide-history' },
])

const turnoOptions = computed(() =>
  turnos.value
    .filter(t => t.activo)
    .map(t => ({ label: t.nombre, value: t.id })),
)

const ajustes = computed<AjustesReparto>(() => ({
  exclusiones: [...exclusiones.value],
  montosManuales: Object.entries(montosManuales)
    .filter(([, v]) => v)
    .map(([garzonId, monto]) => ({ garzonId, monto })),
}))

const consultaActual = computed<PreviewBody>(() => ({
  fechaDesde: fechaDesde.value,
  fechaHasta: fechaHasta.value,
  turnoIds: [...turnoIds.value],
  ajustes: ajustes.value,
}))

/**
 * Qué cambió en el formulario desde el reparto que está en pantalla: el período, los
 * turnos o quién participa (hay que volver a calcular), o un monto manual escrito y
 * todavía no guardado. Mientras haya algo, no se liquida. Durante un recálculo no se
 * avisa nada: el botón ya está apagado y el reparto nuevo llega enseguida.
 */
const cambioPendiente = computed<'recalcular' | 'monto' | null>(() => {
  const vista = consultaMostrada.value
  if (!reparto.value || !vista || loadingPreview.value) return null
  const actual = consultaActual.value
  const sinMontos = (c: PreviewBody) =>
    claveConsultaReparto({ ...c, ajustes: { exclusiones: c.ajustes?.exclusiones } })
  if (sinMontos(vista) !== sinMontos(actual)) return 'recalcular'
  if (claveConsultaReparto(vista) !== claveConsultaReparto(actual)) return 'monto'
  return null
})

const puedeConfirmarLiquidar = computed(() =>
  !!reparto.value
  && Number(reparto.value.poolTotal) !== 0
  && puedeLiquidar.value
  && !cambioPendiente.value
  && !loadingPreview.value,
)

const turnosMostrados = computed(() => {
  const ids = consultaMostrada.value?.turnoIds ?? []
  if (!ids.length) return 'Todos los turnos'
  return ids.map(id => turnoOptions.value.find(t => t.value === id)?.label ?? 'Turno dado de baja').join(', ')
})

const participantesIncluidos = computed(() =>
  reparto.value?.participantes.filter(p => p.incluido) ?? [],
)

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

async function cargarPreview() {
  if (!fechaDesde.value || !fechaHasta.value) return
  loadingPreview.value = true
  const consulta = consultaActual.value
  try {
    reparto.value = await api.preview(consulta)
    consultaMostrada.value = consulta
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
  if (!consultaMostrada.value || !puedeConfirmarLiquidar.value) return
  liquidando.value = true
  try {
    const detalle = await api.liquidar(consultaMostrada.value)
    confirmarAbierto.value = false
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

onMounted(async () => {
  if (!permissions.permisos.length && !permissions.loading) {
    await permissions.fetchPermisos()
  }
  if (!permissions.can('Propinas', 'Leer')) {
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

        <UTabs v-model="tab" :items="tabs" :content="false" />

        <template v-if="tab === 'propinas'">
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
                <AppDateInput v-model="fechaDesde" qa="prop-desde" />
              </UFormField>
              <UFormField label="Hasta">
                <AppDateInput v-model="fechaHasta" qa="prop-hasta" />
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

          <DiaNegocioNota />

          <!-- Reparto en vivo -->
          <template v-if="reparto">
            <UAlert
              v-if="cambioPendiente"
              color="warning"
              variant="subtle"
              icon="i-lucide-refresh-cw"
              :title="cambioPendiente === 'recalcular'
                ? 'Cambiaste el período, los turnos o quién participa: vuelve a calcular el reparto para liquidar.'
                : 'Guarda el monto manual para ver cómo queda el reparto antes de liquidar.'"
            />

            <div class="space-y-6 transition-opacity" :class="{ 'opacity-50': cambioPendiente }">
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
                          <MoneyInput
                            :model-value="montosManuales[p.garzonId] ?? ''"
                            :moneda-id="reparto.monedaId"
                            size="sm"
                            placeholder="Monto manual"
                            @update:model-value="(v: string) => { montosManuales[p.garzonId] = v }"
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
            </div>

            <div class="flex justify-end">
              <UButton
                icon="i-lucide-hand-coins"
                label="Liquidar período"
                size="lg"
                :loading="liquidando"
                :disabled="!puedeConfirmarLiquidar"
                @click="() => { confirmarAbierto = true }"
              />
            </div>

            <CrudModal
              v-if="consultaMostrada"
              v-model:open="confirmarAbierto"
              title="Liquidar el período"
              message="El reparto queda cerrado con estos montos. Para corregirlo después hay que anular la liquidación."
              :confirm-label="`Liquidar ${formatMonto(reparto.poolTotal, reparto.monedaId)}`"
              confirm-color="primary"
              :loading="liquidando"
              :confirm-disabled="!puedeConfirmarLiquidar"
              @confirm="liquidar"
            >
              <template #detalle>
                <div class="mt-4 space-y-4">
                  <div class="text-sm text-muted">
                    <p>Del {{ formatFecha(consultaMostrada.fechaDesde) }} al {{ formatFecha(consultaMostrada.fechaHasta) }}</p>
                    <p>{{ turnosMostrados }}</p>
                  </div>
                  <div>
                    <p class="text-sm text-muted">
                      Fondo a repartir
                    </p>
                    <p class="text-2xl font-semibold text-highlighted tabular-nums">
                      {{ formatMonto(reparto.poolTotal, reparto.monedaId) }}
                    </p>
                  </div>
                  <ul v-if="participantesIncluidos.length" class="divide-y divide-default rounded-lg border border-default">
                    <li
                      v-for="p in participantesIncluidos"
                      :key="`${p.grupoId}-${p.garzonId}`"
                      class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span class="text-default">{{ garzonNombre(p.garzonId) }}</span>
                      <span class="font-medium text-highlighted tabular-nums">{{ formatMonto(p.monto, reparto.monedaId) }}</span>
                    </li>
                  </ul>
                </div>
              </template>
            </CrudModal>
          </template>
        </template>

        <template v-if="tab === 'liquidaciones'">
          <UCard>
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
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
