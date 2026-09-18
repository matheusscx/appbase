<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

type TipoMotivoBaja = 'merma' | 'cortesia' | 'no_elaborado'
type CostoEstado = 'valorizado' | 'no_aplica' | 'sin_valorizar'

interface CostoPorMoneda { monedaId: string, monto: string }

interface GrupoResumen {
  platos: string
  precioCarta: string
  costo: CostoPorMoneda[]
  sinValorizar: number
}

interface GrupoPorGarzon extends GrupoResumen {
  garzonId: string | null
  garzonNombre: string | null
}

interface GrupoPorAutorizo extends GrupoResumen {
  usuarioId: string
  usuarioNombre: string
}

interface ResumenAnulaciones {
  porTipo: (GrupoResumen & { tipo: TipoMotivoBaja })[]
  porGarzon: GrupoPorGarzon[]
  porAutorizo: GrupoPorAutorizo[]
}

interface AnulacionReporteItem {
  id: string
  creadoEl: string
  cuentaId: string
  cuentaNumero: number
  mesaNombre: string
  salonNombre: string
  itemNombre: string
  cantidad: string
  motivoBajaNombre: string
  tipo: TipoMotivoBaja
  garzonNombre: string | null
  autorizadoPorNombre: string
  precioCarta: string
  costoEstado: CostoEstado
  costo: CostoPorMoneda[]
}

interface MotivoOpt { id: string, nombre: string }
interface Opt { label: string, value: string }

const TIPO_LABELS: Record<TipoMotivoBaja, string> = {
  cortesia: 'Cortesía',
  merma: 'Merma',
  no_elaborado: 'No se hizo',
}

const GRUPO_VACIO: GrupoResumen = { platos: '0', precioCarta: '0', costo: [], sinValorizar: 0 }

const TARJETAS: { tipo: TipoMotivoBaja, titulo: string }[] = [
  { tipo: 'cortesia', titulo: 'Cortesías' },
  { tipo: 'merma', titulo: 'Mermas en mesa' },
  { tipo: 'no_elaborado', titulo: 'No se hizo' },
]

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatFecha, formatMonto, formatStock, formatCostoPorMoneda } = useFormatters()
const { pageSize } = useUserPreferences()

const motivos = ref<MotivoOpt[]>([])
const filtroDesde = ref(hoyLocal())
const filtroHasta = ref(hoyLocal())
const filtroTipo = ref('todos')
const filtroMotivo = ref('todos')
const filtroGarzon = ref('todos')

const listFilters = computed(() => ({
  desde: filtroDesde.value || undefined,
  hasta: filtroHasta.value || undefined,
  tipo: filtroTipo.value !== 'todos' ? filtroTipo.value : undefined,
  motivoBajaId: filtroMotivo.value !== 'todos' ? filtroMotivo.value : undefined,
  garzonId: filtroGarzon.value !== 'todos' ? filtroGarzon.value : undefined,
}))

const { items: anulaciones, meta, page, loading } =
  usePaginatedList<AnulacionReporteItem>({
    path: '/salones/anulaciones',
    pageSize,
    filters: listFilters,
  })

const resumen = ref<ResumenAnulaciones | null>(null)
const loadingResumen = ref(false)

// El resumen EXIGE desde/hasta (400 si falta uno): si el usuario borra una
// fecha, no se pide — se muestra un estado vacío en vez de dejar que el
// backend rechace con 400 (nota del controlador, spec § 5.1).
const rangoCompleto = computed(() => !!filtroDesde.value && !!filtroHasta.value)

async function cargarResumen() {
  if (!rangoCompleto.value) {
    resumen.value = null
    return
  }
  loadingResumen.value = true
  try {
    const params = new URLSearchParams()
    params.set('desde', filtroDesde.value)
    params.set('hasta', filtroHasta.value)
    const f = listFilters.value
    if (f.tipo) params.set('tipo', f.tipo)
    if (f.motivoBajaId) params.set('motivoBajaId', f.motivoBajaId)
    if (f.garzonId) params.set('garzonId', f.garzonId)
    resumen.value = await useApiFetch<ResumenAnulaciones>(
      `${apiUrl}/salones/anulaciones/resumen?${params.toString()}`,
    )
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar el resumen'), color: 'error' })
  }
  finally {
    loadingResumen.value = false
  }
}

// Mismos filtros que el listado (`usePaginatedList` ya los mira solo): cambiar
// cualquiera de los dos vuelve a pedir LAS DOS rutas (spec § 5.1).
watch(listFilters, cargarResumen, { deep: true })

async function cargarMotivos() {
  try {
    // Sin `soloActivas`: un motivo desactivado igual tiene historia en el rango.
    motivos.value = await useApiFetch<MotivoOpt[]>(`${apiUrl}/motivos-baja`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar motivos'), color: 'error' })
  }
}

onMounted(() => {
  cargarMotivos()
  cargarResumen()
})

const tipoOpts: Opt[] = [
  { label: 'Todos los tipos', value: 'todos' },
  { label: TIPO_LABELS.cortesia, value: 'cortesia' },
  { label: TIPO_LABELS.merma, value: 'merma' },
  { label: TIPO_LABELS.no_elaborado, value: 'no_elaborado' },
]

const motivosOpts = computed<Opt[]>(() => [
  { label: 'Todos los motivos', value: 'todos' },
  ...motivos.value.map(m => ({ label: m.nombre, value: m.id })),
])

// Las opciones de garzón salen de `resumen.porGarzon`, no de `GET /garzones`:
// no suma una llamada ni un permiso, y lista justo a quienes tienen algo en
// el rango filtrado. Sin garzón (`garzonId: null`) no es filtrable — el
// backend exige un UUID — así que se excluye de las opciones.
const garzonOpts = computed<Opt[]>(() => [
  { label: 'Todos los garzones', value: 'todos' },
  ...(resumen.value?.porGarzon ?? [])
    .filter((g): g is GrupoPorGarzon & { garzonId: string } => g.garzonId != null)
    .map(g => ({ label: g.garzonNombre ?? 'Sin garzón', value: g.garzonId })),
])

const tarjetas = computed(() =>
  TARJETAS.map(t => ({
    ...t,
    grupo: resumen.value?.porTipo.find(g => g.tipo === t.tipo) ?? GRUPO_VACIO,
  })),
)

function sinValorizarTexto(n: number): string {
  return `${n} ${n === 1 ? 'plato' : 'platos'} sin valorizar`
}

const columns: TableColumn<AnulacionReporteItem>[] = [
  { accessorKey: 'creadoEl', header: 'Fecha' },
  { accessorKey: 'mesaNombre', header: 'Mesa' },
  { accessorKey: 'itemNombre', header: 'Plato' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'motivoBajaNombre', header: 'Motivo' },
  { accessorKey: 'garzonNombre', header: 'Garzón' },
  { accessorKey: 'autorizadoPorNombre', header: 'Autorizó' },
  { accessorKey: 'precioCarta', header: 'Precio de carta', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costo', header: 'Costo', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const columnasGarzon: TableColumn<GrupoPorGarzon>[] = [
  { accessorKey: 'garzonNombre', header: 'Garzón' },
  { accessorKey: 'platos', header: 'Platos', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'precioCarta', header: 'Precio de carta', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costo', header: 'Costo', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'sinValorizar', header: 'Sin valorizar', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const columnasAutorizo: TableColumn<GrupoPorAutorizo>[] = [
  { accessorKey: 'usuarioNombre', header: 'Autorizó' },
  { accessorKey: 'platos', header: 'Platos', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'precioCarta', header: 'Precio de carta', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costo', header: 'Costo', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'sinValorizar', header: 'Sin valorizar', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Anulaciones" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          large
          title="Anulaciones"
          description="Cortesías, mermas en mesa y platos que no se hicieron — con precio de carta y costo congelados."
        />

        <div class="flex flex-wrap gap-2">
          <AppDateInput v-model="filtroDesde" class="w-40" qa="anulaciones-desde" />
          <AppDateInput v-model="filtroHasta" class="w-40" qa="anulaciones-hasta" />
          <USelectMenu
            v-model="filtroTipo"
            :items="tipoOpts"
            value-key="value"
            class="w-44"
            placeholder="Tipo"
          />
          <USelectMenu
            v-model="filtroMotivo"
            :items="motivosOpts"
            value-key="value"
            class="w-52"
            placeholder="Motivo"
          />
          <USelectMenu
            v-model="filtroGarzon"
            :items="garzonOpts"
            value-key="value"
            class="w-52"
            placeholder="Garzón"
          />
        </div>

        <div v-if="!rangoCompleto" class="rounded-lg bg-muted p-4 text-sm text-muted">
          Selecciona desde y hasta para ver el resumen.
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div
            v-for="t in tarjetas"
            :key="t.tipo"
            class="rounded-lg bg-muted p-4"
          >
            <p class="text-xs text-muted uppercase tracking-wide">
              {{ t.titulo }}
            </p>
            <p class="text-lg font-semibold mt-1">
              {{ loadingResumen ? '…' : `${formatStock(t.grupo.platos)} platos` }}
            </p>
            <p class="text-sm text-muted mt-1">
              Precio de carta: {{ loadingResumen ? '…' : formatMonto(t.grupo.precioCarta) }}
            </p>
            <p class="text-sm text-muted">
              Costo: {{ loadingResumen ? '…' : formatCostoPorMoneda(t.grupo.costo) }}
            </p>
            <p v-if="t.grupo.sinValorizar > 0" class="text-xs text-warning mt-1">
              {{ sinValorizarTexto(t.grupo.sinValorizar) }}
            </p>
          </div>
        </div>

        <div v-if="rangoCompleto" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <UCard>
            <template #header>
              <span class="font-medium text-default">Por garzón</span>
            </template>
            <UTable :data="resumen?.porGarzon ?? []" :columns="columnasGarzon" :loading="loadingResumen">
              <template #garzonNombre-cell="{ row }">
                {{ row.original.garzonNombre ?? 'Sin garzón' }}
              </template>
              <template #platos-cell="{ row }">
                {{ formatStock(row.original.platos) }}
              </template>
              <template #precioCarta-cell="{ row }">
                {{ formatMonto(row.original.precioCarta) }}
              </template>
              <template #costo-cell="{ row }">
                {{ formatCostoPorMoneda(row.original.costo) }}
              </template>
            </UTable>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-medium text-default">Por quién autorizó</span>
            </template>
            <UTable :data="resumen?.porAutorizo ?? []" :columns="columnasAutorizo" :loading="loadingResumen">
              <template #platos-cell="{ row }">
                {{ formatStock(row.original.platos) }}
              </template>
              <template #precioCarta-cell="{ row }">
                {{ formatMonto(row.original.precioCarta) }}
              </template>
              <template #costo-cell="{ row }">
                {{ formatCostoPorMoneda(row.original.costo) }}
              </template>
            </UTable>
          </UCard>
        </div>

        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="Las mermas de esta lista también están contadas en Mermas."
        />

        <CrudTable
          :data="anulaciones"
          :columns="columns"
          :loading="loading"
        >
          <template #creadoEl-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatFecha(row.original.creadoEl) }}</span>
          </template>
          <template #mesaNombre-cell="{ row }">
            {{ row.original.salonNombre }} · {{ row.original.mesaNombre }} · cuenta {{ row.original.cuentaNumero }}
          </template>
          <template #cantidad-cell="{ row }">
            {{ formatStock(row.original.cantidad) }}
          </template>
          <template #motivoBajaNombre-cell="{ row }">
            <div class="flex items-center gap-2">
              <span>{{ row.original.motivoBajaNombre }}</span>
              <UBadge
                :label="TIPO_LABELS[row.original.tipo]"
                color="neutral"
                variant="subtle"
                size="sm"
              />
            </div>
          </template>
          <template #garzonNombre-cell="{ row }">
            {{ row.original.garzonNombre ?? 'Sin garzón' }}
          </template>
          <template #precioCarta-cell="{ row }">
            {{ formatMonto(row.original.precioCarta) }}
          </template>
          <template #costo-cell="{ row }">
            <UBadge
              v-if="row.original.costoEstado === 'sin_valorizar'"
              label="Sin valorizar"
              color="warning"
              variant="subtle"
              size="sm"
            />
            <span v-else>{{ formatCostoPorMoneda(row.original.costo) }}</span>
          </template>
          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              <UIcon
                name="i-lucide-ban"
                class="w-8 h-8 mx-auto mb-2 opacity-40"
              />
              No hay anulaciones en el rango filtrado.
            </div>
          </template>
        </CrudTable>

        <div
          v-if="meta.total > pageSize"
          class="flex justify-end"
        >
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="meta.total"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
