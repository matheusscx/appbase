<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

const toast = useToast()
const { formatFecha, formatMonto } = useFormatters()
const { pageSize } = useUserPreferences()

interface Movimiento {
  id: string
  itemId: string
  itemNombre: string
  tipo: string
  motivo: string
  cantidad: string
  stockAnterior: string
  stockResultante: string
  usuarioNombre: string | null
  comentario: string | null
  creadoEl: string
  causaNombre?: string | null
  costoUnitario?: string | null
  costoPerdido?: string | null
}
interface Opt { label: string; value: string }

const { public: { apiUrl } } = useRuntimeConfig()
const productosOpts = ref<Opt[]>([])
const filtroItem = ref('todos')
const filtroMotivo = ref('todos')

const listFilters = computed(() => ({
  itemId: filtroItem.value !== 'todos' ? filtroItem.value : undefined,
  motivo: filtroMotivo.value !== 'todos' ? filtroMotivo.value : undefined,
}))

const { items: movimientos, meta, page, loading } = usePaginatedList<Movimiento>({
  path: '/inventario/movimientos',
  pageSize,
  filters: listFilters,
})

const motivoOpts: Opt[] = [
  { label: 'Todos los motivos', value: 'todos' },
  { label: 'Compra', value: 'compra' },
  { label: 'Venta', value: 'venta' },
  { label: 'Devolución', value: 'devolucion' },
  { label: 'Merma', value: 'merma' },
  { label: 'Ajuste manual', value: 'ajuste_manual' },
  { label: 'Inventario inicial', value: 'inventario_inicial' },
]

async function cargarProductos() {
  try {
    const res = await useApiFetch<PaginatedResponse<{ id: string; nombre: string }>>(
      `${apiUrl}/items?tipo=producto&pageSize=100`,
    )
    productosOpts.value = [
      { label: 'Todos los productos', value: 'todos' },
      ...res.data.map(i => ({ label: i.nombre, value: i.id })),
    ]
  }
  catch {
    toast.add({ title: 'Error al cargar productos', color: 'error' })
  }
}

onMounted(cargarProductos)

function motivoLabel(mov: Movimiento): string {
  const base = motivoOpts.find(o => o.value === mov.motivo)?.label ?? mov.motivo
  if (mov.motivo === 'merma' && mov.causaNombre) {
    return `Merma · ${mov.causaNombre}`
  }
  return base
}

const columns: TableColumn<Movimiento>[] = [
  { accessorKey: 'creadoEl', header: 'Fecha' },
  { accessorKey: 'itemNombre', header: 'Producto' },
  { accessorKey: 'tipo', header: 'Tipo' },
  { accessorKey: 'motivo', header: 'Motivo' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'stockResultante', header: 'Resultante', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costoPerdido', header: 'Costo perdido', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'usuarioNombre', header: 'Usuario' },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      large
      title="Inventario"
      description="Kardex de movimientos de stock"
    />

    <div class="flex flex-wrap gap-2">
      <USelectMenu
        v-model="filtroItem"
        :items="productosOpts"
        value-key="value"
        class="w-64"
        placeholder="Producto"
      />
      <USelectMenu
        v-model="filtroMotivo"
        :items="motivoOpts"
        value-key="value"
        class="w-52"
        placeholder="Motivo"
      />
    </div>

    <CrudTable
      :data="movimientos"
      :columns="columns"
      :loading="loading"
    >
      <template #creadoEl-cell="{ row }">
        <span class="whitespace-nowrap">{{ formatFecha(row.original.creadoEl) }}</span>
      </template>
      <template #itemNombre-cell="{ row }">
        <span class="font-medium">{{ row.original.itemNombre }}</span>
      </template>
      <template #tipo-cell="{ row }">
        <UBadge
          :label="row.original.tipo === 'entrada' ? 'Entrada' : 'Salida'"
          :color="row.original.tipo === 'entrada' ? 'success' : 'warning'"
          variant="subtle"
          size="sm"
        />
      </template>
      <template #motivo-cell="{ row }">
        <UBadge
          :label="motivoLabel(row.original)"
          color="neutral"
          variant="subtle"
          size="sm"
        />
      </template>
      <template #cantidad-cell="{ row }">
        <span :class="row.original.tipo === 'entrada' ? 'text-success' : 'text-warning'">
          {{ row.original.cantidad }}
        </span>
      </template>
      <template #stockResultante-cell="{ row }">
        <span class="font-medium">{{ row.original.stockResultante }}</span>
      </template>
      <template #costoPerdido-cell="{ row }">
        <span
          v-if="row.original.costoPerdido != null"
          class="font-medium text-error"
        >
          {{ formatMonto(row.original.costoPerdido) }}
        </span>
        <span v-else class="text-muted">—</span>
      </template>
      <template #usuarioNombre-cell="{ row }">
        {{ row.original.usuarioNombre ?? '—' }}
      </template>
      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          <UIcon
            name="i-lucide-inbox"
            class="w-8 h-8 mx-auto mb-2 opacity-40"
          />
          No hay movimientos registrados.
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
