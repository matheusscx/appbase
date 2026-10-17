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

// `Propinas:Leer` lo pide el backend en las lecturas de la pantalla. Antes se revisaba en `onMounted` y,
// si faltaba, devolvía a Inicio sin decir nada —con el permiso, el contenido aparecía un instante antes—;
// el middleware decide antes de montar y avisa por qué (auditoría UX 02.20).
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Propinas:Leer',
  permisoLabel: 'Propinas',
  layout: 'dashboard',
})

const router = useRouter()
const toast = useToast()
const permissions = usePermissionsStore()
const api = usePropinaLiquidaciones()
const resumenApi = usePropinaResumen()
const turnosApi = useTurnos()
const garzonesApi = useGarzones()
const { formatMonto, formatFecha, formatPorcentaje } = useFormatters()

// El período arranca en el mes en curso, del día 1 a hoy: abrir la pantalla y tocar "Ver reparto"
// calcula algo, en vez de no hacer nada (auditoría UX 02.23).
const fechaDesde = ref(rangoMesActual().desde)
const fechaHasta = ref(hoyLocal())
const turnoIds = ref<string[]>([])

const tab = ref('propinas')

const reparto = ref<PreviewReparto | null>(null)
/** La consulta que produjo `reparto`: es lo único que se liquida (auditoría UX 02.1). */
const consultaMostrada = ref<PreviewBody | null>(null)
/**
 * El backend rechazó liquidar porque el fondo o el reparto ya no son los que se vieron
 * (entraron propinas, o alguien entró o salió de turno).
 */
const repartoDesactualizado = ref(false)
const confirmarAbierto = ref(false)
const exclusiones = ref<string[]>([])
const montosManuales = reactive<Record<string, string>>({})

const loadingPreview = ref(false)
/** El garzón cuyo botón disparó el recálculo: solo ése gira, no todos a la vez. */
const garzonRecalculando = ref<string | null>(null)
const faltaPeriodo = computed(() => !fechaDesde.value || !fechaHasta.value)
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
 * Qué cambió desde el reparto que está en pantalla: el período, los turnos o quién
 * participa (hay que volver a calcular), un monto manual escrito y todavía no guardado,
 * o el fondo o el reparto, que el backend encontró distintos al liquidar (owner,
 * 2026-10-16: se liquida lo que se vio). Mientras haya algo, no se liquida. Durante un
 * recálculo no se avisa nada: el botón ya está apagado y el reparto nuevo llega enseguida.
 */
const cambioPendiente = computed<'recalcular' | 'monto' | 'servidor' | null>(() => {
  const vista = consultaMostrada.value
  if (!reparto.value || !vista || loadingPreview.value) return null
  if (repartoDesactualizado.value) return 'servidor'
  const actual = consultaActual.value
  const sinMontos = (c: PreviewBody) =>
    claveConsultaReparto({ ...c, ajustes: { exclusiones: c.ajustes?.exclusiones } })
  if (sinMontos(vista) !== sinMontos(actual)) return 'recalcular'
  if (claveConsultaReparto(vista) !== claveConsultaReparto(actual)) return 'monto'
  return null
})

const AVISO_CAMBIO = {
  recalcular: 'Cambiaste el período, los turnos o quién participa: vuelve a calcular el reparto para liquidar.',
  monto: 'Guarda el monto manual para ver cómo queda el reparto antes de liquidar.',
  servidor: 'El reparto cambió desde que lo viste (entraron propinas o alguien entró a turno): vuelve a calcularlo para liquidar.',
} as const

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
  { id: 'ver', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

function garzonNombre(id: string): string {
  // Un garzón dado de baja ya no está en la lista: sin nombre que mostrar, no se muestra su código.
  return garzones.value.find(g => g.id === id)?.nombre ?? 'Garzón dado de baja'
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
    repartoDesactualizado.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al calcular el reparto'), color: 'error' })
  }
  finally {
    loadingPreview.value = false
  }
}

async function recalcularPor(garzonId: string) {
  garzonRecalculando.value = garzonId
  try {
    await cargarPreview()
  }
  finally {
    garzonRecalculando.value = null
  }
}

function toggleExcluir(garzonId: string) {
  const idx = exclusiones.value.indexOf(garzonId)
  if (idx >= 0) exclusiones.value.splice(idx, 1)
  else exclusiones.value.push(garzonId)
  void recalcularPor(garzonId)
}

function guardarMonto(garzonId: string) {
  void recalcularPor(garzonId)
}

async function liquidar() {
  if (!consultaMostrada.value || !reparto.value || !puedeConfirmarLiquidar.value) return
  liquidando.value = true
  try {
    const detalle = await api.liquidar({
      ...consultaMostrada.value,
      poolEsperado: reparto.value.poolTotal,
      repartoEsperado: participantesIncluidos.value.map(p => ({ garzonId: p.garzonId, monto: p.monto })),
    })
    confirmarAbierto.value = false
    toast.add({ title: 'Período liquidado', color: 'success' })
    await router.push(`/propinas/liquidaciones/${detalle.id}/imprimir?tipo=resumen`)
  }
  catch (e: unknown) {
    if ((e as { status?: number })?.status === 409) {
      confirmarAbierto.value = false
      repartoDesactualizado.value = true
    }
    toast.add({ title: apiErrorMsg(e, 'Error al liquidar el período'), color: 'error' })
  }
  finally {
    liquidando.value = false
  }
}

onMounted(async () => {
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
                  :loading="loadingPreview && garzonRecalculando === null"
                  :disabled="faltaPeriodo"
                  @click="cargarPreview"
                />
              </div>
            </div>
            <p v-if="faltaPeriodo" class="mt-3 text-sm text-muted">
              Elige desde y hasta para ver el reparto.
            </p>
          </UCard>

          <DiaNegocioNota />

          <!-- Reparto en vivo -->
          <template v-if="reparto">
            <UAlert
              v-if="cambioPendiente"
              color="warning"
              variant="subtle"
              icon="i-lucide-refresh-cw"
              :title="AVISO_CAMBIO[cambioPendiente]"
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
                            @keyup.enter="guardarMonto(p.garzonId)"
                          />
                          <UButton
                            :aria-label="`Guardar el monto de ${garzonNombre(p.garzonId)}`"
                            size="sm"
                            variant="outline"
                            icon="i-lucide-save"
                            :loading="garzonRecalculando === p.garzonId"
                            :disabled="loadingPreview"
                            @click="guardarMonto(p.garzonId)"
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
                            :disabled="!puedeLiquidar || loadingPreview"
                            :loading="garzonRecalculando === p.garzonId"
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
              <template #ver-cell="{ row }">
                <UButton
                  :to="`/propinas/liquidaciones/${row.original.id}/imprimir?tipo=resumen`"
                  label="Ver"
                  icon="i-lucide-chevron-right"
                  trailing
                  color="neutral"
                  variant="ghost"
                  size="lg"
                  class="min-h-11"
                />
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
