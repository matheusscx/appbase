<script setup lang="ts">
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import type { EstadoCompra } from '~/composables/useCompras'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface CompraListItem {
  id: string
  estado: EstadoCompra
  faltaCosto: boolean
  fechaDocumento: string
  proveedorId: string
  proveedorNombre: string | null
  tipoDocumentoNombre: string | null
  folio: string | null
  ubicacionNombre: string | null
  lineas: number
  total: string | null
}

interface Opt { label: string, value: string }

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const router = useRouter()
const { formatMonto } = useFormatters()
const { pageSize } = useUserPreferences()
const { insigniaEstado, estadoOptions } = useCompras()

// El nav abre esta página con Compras/Leer; crear exige Compras/Crear.
const { puedeCrear } = usePermisosCrud('Compras')

// ── Filtros ────────────────────────────────────────────────────────────────

const TODOS = 'todos'
const filtroEstado = ref<string>(TODOS)
const filtroProveedor = ref<string>(TODOS)
const soloFaltaCosto = ref(false)
const desde = ref('')
const hasta = ref('')

const estadoOpts = computed<Opt[]>(() => [
  { label: 'Todos los estados', value: TODOS },
  ...estadoOptions,
])

const proveedores = ref<Opt[]>([])
const proveedorOpts = computed<Opt[]>(() => [
  { label: 'Todos los proveedores', value: TODOS },
  ...proveedores.value,
])

const filtros = computed(() => ({
  estado: filtroEstado.value === TODOS ? undefined : filtroEstado.value,
  proveedorId: filtroProveedor.value === TODOS ? undefined : filtroProveedor.value,
  faltaCosto: soloFaltaCosto.value ? 'true' : undefined,
  desde: desde.value || undefined,
  hasta: hasta.value || undefined,
}))

const { items: compras, meta, page, loading } =
  usePaginatedList<CompraListItem>({ path: '/compras', pageSize, filters: filtros })

onMounted(async () => {
  try {
    const res = await useApiFetch<{ id: string, nombre: string }[]>(`${apiUrl}/compras/proveedores`)
    proveedores.value = res.map(p => ({ label: p.nombre, value: p.id }))
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar proveedores'), color: 'error' })
  }
})

function abrir(_e: Event, row: Row<CompraListItem>) {
  void router.push(`/compras/${row.original.id}`)
}

const columns: TableColumn<CompraListItem>[] = [
  { accessorKey: 'fechaDocumento', header: 'Fecha' },
  { accessorKey: 'proveedorNombre', header: 'Proveedor' },
  { accessorKey: 'folio', header: 'Documento' },
  { accessorKey: 'ubicacionNombre', header: 'Entra a' },
  { accessorKey: 'lineas', header: 'Líneas', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'estado', header: 'Estado' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Compras" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          large
          title="Compras"
          description="La mercadería que llega de los proveedores: entra al stock y fija su costo."
        >
          <template #actions>
            <UButton
              v-if="puedeCrear"
              icon="i-lucide-plus"
              to="/compras/nueva"
            >
              Nueva compra
            </UButton>
          </template>
        </CrudPageHeader>

        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Estado">
            <USelect v-model="filtroEstado" :items="estadoOpts" class="w-44" />
          </UFormField>
          <UFormField label="Proveedor">
            <USelectMenu
              v-model="filtroProveedor"
              :items="proveedorOpts"
              value-key="value"
              class="w-56"
            />
          </UFormField>
          <UFormField label="Desde">
            <UInput v-model="desde" type="date" />
          </UFormField>
          <UFormField label="Hasta">
            <UInput v-model="hasta" type="date" />
          </UFormField>
          <USwitch v-model="soloFaltaCosto" label="Solo las que les falta costo" />
        </div>

        <CrudTable
          :data="compras"
          :columns="columns"
          :loading="loading"
          :ui="{ tr: 'cursor-pointer' }"
          @select="abrir"
        >
          <template #fechaDocumento-cell="{ row }">
            <span
              class="whitespace-nowrap"
              :class="{ 'line-through text-muted': row.original.estado === 'anulada' }"
            >{{ row.original.fechaDocumento }}</span>
          </template>
          <template #proveedorNombre-cell="{ row }">
            <span :class="{ 'line-through text-muted': row.original.estado === 'anulada' }">
              {{ row.original.proveedorNombre || '—' }}
            </span>
          </template>
          <template #folio-cell="{ row }">
            <span class="text-sm">
              {{ row.original.tipoDocumentoNombre }}<template v-if="row.original.folio"> {{ row.original.folio }}</template>
            </span>
          </template>
          <template #ubicacionNombre-cell="{ row }">
            <span class="text-sm text-muted">{{ row.original.ubicacionNombre || '—' }}</span>
          </template>
          <template #total-cell="{ row }">
            <span class="tabular-nums">{{ row.original.total != null ? formatMonto(row.original.total) : '—' }}</span>
          </template>
          <template #estado-cell="{ row }">
            <div class="flex flex-wrap gap-1">
              <UBadge
                v-for="i in insigniaEstado(row.original)"
                :key="i.label"
                :label="i.label"
                :color="i.color"
                variant="subtle"
                size="sm"
              />
            </div>
          </template>
          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              <UIcon name="i-lucide-truck" class="w-8 h-8 mx-auto mb-2 opacity-40" />
              No hay compras registradas.
            </div>
          </template>
        </CrudTable>

        <div v-if="meta.total > pageSize" class="flex justify-end">
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
