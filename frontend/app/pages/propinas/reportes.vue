<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'
import type { Turno } from '~/composables/useTurnos'
import type {
  PropinaReporteFiltrosUi,
  PropinaReporteResumen,
  PropinaReporteTrabajador,
  PropinaReporteTrabajadores,
  ReporteTab,
  TipoTrabajador,
} from '~/composables/usePropinaReportes'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const router = useRouter()
const permissions = usePermissionsStore()
const reportesApi = usePropinaReportes()
const turnosApi = useTurnos()
const { formatMonto, formatFecha, formatPorcentaje } = useFormatters()

function fechaLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function queryStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function filtrosIniciales(): PropinaReporteFiltrosUi {
  const hoy = new Date()
  const hace29Dias = new Date(hoy)
  hace29Dias.setDate(hoy.getDate() - 29)
  const tipo = queryStringValue(route.query.tipoGarzon)
  return {
    desde: queryStringValue(route.query.desde) ?? fechaLocal(hace29Dias),
    hasta: queryStringValue(route.query.hasta) ?? fechaLocal(hoy),
    turnoIds: (queryStringValue(route.query.turnoIds) ?? '')
      .split(',')
      .filter(Boolean),
    tipoGarzon: ['garzon', 'cocina', 'barra'].includes(tipo ?? '')
      ? (tipo as TipoTrabajador)
      : undefined,
  }
}

const tab = ref<ReporteTab>(
  route.query.tab === 'trabajadores' ? 'trabajadores' : 'resumen',
)
const filtros = ref<PropinaReporteFiltrosUi>(filtrosIniciales())
const resumen = ref<PropinaReporteResumen | null>(null)
const trabajadores = ref<PropinaReporteTrabajadores | null>(null)
const turnos = ref<Turno[]>([])
const loading = ref(false)
const error = ref('')

const tabItems = [
  { label: 'Resumen', value: 'resumen', icon: 'i-lucide-chart-no-axes-combined' },
  { label: 'Por trabajador', value: 'trabajadores', icon: 'i-lucide-users' },
]
const tipoOptions = [
  { label: 'Todos', value: '' },
  { label: 'Garzón', value: 'garzon' },
  { label: 'Cocina', value: 'cocina' },
  { label: 'Barra', value: 'barra' },
]
const turnoOptions = computed(() =>
  turnos.value
    .filter(turno => turno.activo)
    .map(turno => ({ label: turno.nombre, value: turno.id })),
)
const tipoSeleccionado = computed({
  get: () => filtros.value.tipoGarzon ?? '',
  set: (value: string) => {
    filtros.value.tipoGarzon = value
      ? (value as TipoTrabajador)
      : undefined
  },
})

const pendienteTotal = computed(() =>
  resumen.value
    ? new Decimal(resumen.value.estadoActual.pendienteLibreMonto)
        .plus(resumen.value.estadoActual.enBorradorMonto)
        .toString()
    : '0',
)
const maxTendencia = computed(() =>
  Math.max(
    0,
    ...(resumen.value?.tendencia.map(item => Number(item.montoCobrado)) ?? []),
  ),
)

const workerColumns: TableColumn<PropinaReporteTrabajador>[] = [
  { accessorKey: 'nombre', header: 'Trabajador' },
  { id: 'originado', header: 'Originado', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'asignado', header: 'Asignado', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'horas', header: 'Horas', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'ventasBase', header: 'Ventas base', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'cuentas', header: 'Cuentas', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'liquidaciones', header: 'Liquidaciones', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'ultima', header: 'Última confirmación' },
]

function tipoLabel(tipo: TipoTrabajador | null): string {
  if (tipo === 'cocina') return 'Cocina'
  if (tipo === 'barra') return 'Barra'
  if (tipo === 'garzon') return 'Garzón'
  return 'Sin tipo'
}

function barraWidth(monto: string): string {
  if (!maxTendencia.value) return '0%'
  return `${Math.max(2, (Number(monto) / maxTendencia.value) * 100)}%`
}

function asignarCache(tabActual: ReporteTab, cached: unknown) {
  if (tabActual === 'resumen') {
    resumen.value = cached as PropinaReporteResumen
  }
  else {
    trabajadores.value = cached as PropinaReporteTrabajadores
  }
}

async function cargarTab(options: { force?: boolean } = {}) {
  let key: string
  try {
    key = reportesApi.claveFiltros(filtros.value)
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : 'Filtros inválidos'
    return
  }

  if (!options.force) {
    const cached = reportesApi.cache.get(tab.value, key)
    if (cached) {
      asignarCache(tab.value, cached)
      return
    }
  }

  loading.value = true
  error.value = ''
  try {
    if (tab.value === 'resumen') {
      const data = await reportesApi.resumen(filtros.value)
      resumen.value = data
      reportesApi.cache.set('resumen', key, data)
    }
    else {
      const data = await reportesApi.trabajadores(filtros.value)
      trabajadores.value = data
      reportesApi.cache.set('trabajadores', key, data)
    }
  }
  catch (e: unknown) {
    error.value = apiErrorMsg(e, 'No se pudieron cargar los reportes')
  }
  finally {
    loading.value = false
  }
}

async function aplicar() {
  reportesApi.cache.clear()
  await router.replace({
    query: {
      tab: tab.value,
      desde: filtros.value.desde,
      hasta: filtros.value.hasta,
      ...(filtros.value.turnoIds.length
        ? { turnoIds: [...filtros.value.turnoIds].sort().join(',') }
        : {}),
      ...(filtros.value.tipoGarzon
        ? { tipoGarzon: filtros.value.tipoGarzon }
        : {}),
    },
  })
  await cargarTab({ force: true })
}

watch(tab, async (value) => {
  await router.replace({ query: { ...route.query, tab: value } })
  await cargarTab()
})

onMounted(async () => {
  if (!permissions.permisos.length && !permissions.loading) {
    await permissions.fetchPermisos()
  }
  if (!permissions.esAdmin && !permissions.can('Propinas', 'Leer')) {
    await navigateTo('/')
    return
  }
  try {
    turnos.value = await turnosApi.listar()
  }
  catch {
    turnos.value = []
  }
  await cargarTab()
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Reportes de propinas" />
    </template>

    <template #body>
      <div class="space-y-6">
        <CrudPageHeader
          title="Reportes de propinas"
          description="Revisa la cobranza, el estado de liquidación y la distribución por trabajador."
        />

        <UCard>
          <div class="grid gap-4 md:grid-cols-5">
            <UFormField label="Desde">
              <AppDateInput v-model="filtros.desde" qa="reporte-propina-desde" />
            </UFormField>
            <UFormField label="Hasta">
              <AppDateInput v-model="filtros.hasta" qa="reporte-propina-hasta" />
            </UFormField>
            <UFormField label="Turnos">
              <USelectMenu
                v-model="filtros.turnoIds"
                multiple
                :items="turnoOptions"
                value-key="value"
                placeholder="Todos"
              />
            </UFormField>
            <UFormField label="Tipo">
              <USelect
                v-model="tipoSeleccionado"
                :items="tipoOptions"
                value-key="value"
              />
            </UFormField>
            <div class="flex items-end">
              <UButton
                class="w-full justify-center"
                icon="i-lucide-filter"
                label="Aplicar"
                :loading="loading"
                @click="aplicar"
              />
            </div>
          </div>
        </UCard>

        <UTabs v-model="tab" :items="tabItems" :content="false" />

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          title="No se pudo cargar el reporte"
          :description="error"
        >
          <template #actions>
            <UButton
              color="error"
              variant="outline"
              size="sm"
              label="Reintentar"
              @click="cargarTab({ force: true })"
            />
          </template>
        </UAlert>

        <div v-if="loading && !(resumen || trabajadores)" class="grid gap-4 md:grid-cols-4">
          <USkeleton v-for="item in 4" :key="item" class="h-28" />
        </div>

        <template v-else-if="tab === 'resumen' && resumen">
          <div v-if="resumen.cobranza.cierres === 0" class="py-10 text-center text-sm text-muted">
            No hay cierres con propina en este período.
          </div>
            <UAlert
              v-if="resumen.advertencias.liquidacionesParcialmenteSolapadas > 0"
              color="warning"
              variant="soft"
              icon="i-lucide-triangle-alert"
              title="Hay liquidaciones parcialmente fuera del período"
              :description="`${resumen.advertencias.liquidacionesParcialmenteSolapadas} liquidación(es) no se incluyeron en asignaciones para evitar prorrateos estimados.`"
            />

            <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <UCard>
                <p class="text-sm text-muted">Monto cobrado</p>
                <p class="mt-2 text-2xl font-semibold text-default">{{ formatMonto(resumen.cobranza.montoCobrado) }}</p>
                <p class="mt-1 text-xs text-muted">{{ resumen.cobranza.conPropina }} ventas con propina</p>
              </UCard>
              <UCard>
                <p class="text-sm text-muted">Pendiente</p>
                <p class="mt-2 text-2xl font-semibold text-default">{{ formatMonto(pendienteTotal) }}</p>
                <p class="mt-1 text-xs text-muted">Libre + en borradores</p>
              </UCard>
              <UCard>
                <p class="text-sm text-muted">Liquidado</p>
                <p class="mt-2 text-2xl font-semibold text-default">{{ formatMonto(resumen.estadoActual.liquidadaMonto) }}</p>
                <p class="mt-1 text-xs text-muted">{{ resumen.estadoActual.liquidadaCantidad }} propinas</p>
              </UCard>
              <UCard>
                <p class="text-sm text-muted">Ventas con propina</p>
                <p class="mt-2 text-2xl font-semibold text-default">{{ formatPorcentaje(resumen.cobranza.tasaConPropina) }}</p>
                <p class="mt-1 text-xs text-muted">{{ resumen.cobranza.conPropina }} de {{ resumen.cobranza.cierres }} cierres</p>
              </UCard>
            </div>

            <div class="grid gap-4 md:grid-cols-3">
              <UCard>
                <p class="text-sm text-muted">Aceptación de sugerencia</p>
                <p class="mt-2 text-xl font-semibold text-default">{{ formatPorcentaje(resumen.cobranza.tasaSugerenciaAceptada) }}</p>
              </UCard>
              <UCard>
                <p class="text-sm text-muted">Promedio con propina</p>
                <p class="mt-2 text-xl font-semibold text-default">{{ formatMonto(resumen.cobranza.promedioConPropina) }}</p>
              </UCard>
              <UCard>
                <p class="text-sm text-muted">Liberado por anulación</p>
                <p class="mt-2 text-xl font-semibold text-default">{{ formatMonto(resumen.anulaciones.montoLiberadoHistorico) }}</p>
                <p class="mt-1 text-xs text-muted">Histórico; no se suma al estado actual</p>
              </UCard>
            </div>

            <UCard>
              <template #header>
                <div>
                  <p class="font-medium text-default">Tendencia diaria</p>
                  <p class="text-sm text-muted">Monto cobrado por día del período.</p>
                </div>
              </template>
              <div class="space-y-3">
                <div v-for="item in resumen.tendencia" :key="item.fecha" class="grid grid-cols-[6rem_1fr_auto] items-center gap-3">
                  <span class="text-xs text-muted">{{ item.fecha }}</span>
                  <div class="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-primary"
                      :style="{ width: barraWidth(item.montoCobrado) }"
                      :aria-label="`${item.fecha}: ${formatMonto(item.montoCobrado)}`"
                    />
                  </div>
                  <span class="text-sm tabular-nums text-default">{{ formatMonto(item.montoCobrado) }}</span>
                </div>
              </div>
            </UCard>

            <div class="grid gap-6 xl:grid-cols-2">
              <UCard>
                <template #header><span class="font-medium text-default">Por turno</span></template>
                <ul class="divide-y divide-default">
                  <li v-for="item in resumen.porTurno" :key="item.turnoId ?? 'sin-turno'" class="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p class="text-sm font-medium text-default">{{ item.turnoNombre }}</p>
                      <p class="text-xs text-muted">{{ item.conPropina }} de {{ item.cierres }} cierres</p>
                    </div>
                    <span class="text-sm font-medium text-default">{{ formatMonto(item.montoCobrado) }}</span>
                  </li>
                </ul>
              </UCard>
              <UCard>
                <template #header><span class="font-medium text-default">Por tipo de trabajador</span></template>
                <ul class="divide-y divide-default">
                  <li v-for="item in resumen.porTipo" :key="item.tipoGarzon ?? 'sin-tipo'" class="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p class="text-sm font-medium text-default">{{ tipoLabel(item.tipoGarzon) }}</p>
                      <p class="text-xs text-muted">{{ item.conPropina }} de {{ item.cierres }} cierres</p>
                    </div>
                    <span class="text-sm font-medium text-default">{{ formatMonto(item.montoCobrado) }}</span>
                  </li>
                </ul>
              </UCard>
            </div>
        </template>

        <template v-else-if="tab === 'trabajadores' && trabajadores">
          <UAlert
            v-if="trabajadores.advertencias.liquidacionesParcialmenteSolapadas > 0 || trabajadores.advertencias.liquidacionesTodosLosTurnosExcluidas > 0"
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            title="Algunas liquidaciones fueron excluidas"
            :description="`${trabajadores.advertencias.liquidacionesParcialmenteSolapadas} cruzan el límite del período y ${trabajadores.advertencias.liquidacionesTodosLosTurnosExcluidas} corresponden a todos los turnos.`"
          />

          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <UCard>
              <p class="text-sm text-muted">Trabajadores</p>
              <p class="mt-2 text-2xl font-semibold text-default">{{ trabajadores.totales.trabajadores }}</p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">Monto originado</p>
              <p class="mt-2 text-2xl font-semibold text-default">{{ formatMonto(trabajadores.totales.montoOriginado) }}</p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">Monto asignado</p>
              <p class="mt-2 text-2xl font-semibold text-default">{{ formatMonto(trabajadores.totales.montoAsignado) }}</p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">Horas consideradas</p>
              <p class="mt-2 text-2xl font-semibold text-default">{{ trabajadores.totales.horas }}</p>
            </UCard>
          </div>

          <CrudTable :data="trabajadores.data" :columns="workerColumns" :loading="loading">
            <template #nombre-cell="{ row }">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-medium text-default">{{ row.original.nombre }}</span>
                  <UBadge color="neutral" variant="subtle">{{ tipoLabel(row.original.tipoGarzon) }}</UBadge>
                </div>
                <p class="mt-1 text-xs text-muted md:hidden">
                  {{ row.original.asignacionConfirmada.horas }} h · {{ row.original.asignacionConfirmada.liquidaciones }} liquidaciones
                </p>
              </div>
            </template>
            <template #originado-cell="{ row }">{{ formatMonto(row.original.origen.monto) }}</template>
            <template #asignado-cell="{ row }">{{ formatMonto(row.original.asignacionConfirmada.monto) }}</template>
            <template #horas-cell="{ row }">{{ row.original.asignacionConfirmada.horas }}</template>
            <template #ventasBase-cell="{ row }">{{ formatMonto(row.original.asignacionConfirmada.ventasBase) }}</template>
            <template #cuentas-cell="{ row }">{{ row.original.asignacionConfirmada.cuentas }}</template>
            <template #liquidaciones-cell="{ row }">{{ row.original.asignacionConfirmada.liquidaciones }}</template>
            <template #ultima-cell="{ row }">
              {{ row.original.asignacionConfirmada.ultimaLiquidacionEl ? formatFecha(row.original.asignacionConfirmada.ultimaLiquidacionEl) : '—' }}
            </template>
            <template #empty>
              No hay actividad de trabajadores para estos filtros.
            </template>
          </CrudTable>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
