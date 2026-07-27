<script setup lang="ts">
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface RecuentoListItem {
  id: string
  estado: string
  comentario: string | null
  creadoEl: string
  aplicadoEl: string | null
  cantidadLineas: number
  diferenciaNeta: string
}

interface ProductoOpt {
  id: string
  nombre: string
  modoInventario: string | null
}

interface Opt { label: string; value: string }

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatFecha } = useFormatters()
const { pageSize } = useUserPreferences()

const filtroEstado = ref<string>('todos')

const listFilters = computed(() => ({
  estado: filtroEstado.value !== 'todos' ? filtroEstado.value : undefined,
}))

const { items: recuentos, meta, page, loading } =
  usePaginatedList<RecuentoListItem>({
    path: '/recuentos',
    pageSize,
    filters: listFilters,
  })

const estadoFiltroOpts: Opt[] = [
  { label: 'Todos los estados', value: 'todos' },
  { label: estadoRecuentoLabel('borrador'), value: 'borrador' },
  { label: estadoRecuentoLabel('aplicado'), value: 'aplicado' },
  { label: estadoRecuentoLabel('cancelado'), value: 'cancelado' },
]

function onSelectRecuento(_e: Event, row: Row<RecuentoListItem>) {
  navigateTo(`/inventario/recuentos/${row.original.id}`)
}

// ── Nuevo recuento ───────────────────────────────────────────────────────────

const productos = ref<ProductoOpt[]>([])
const cargandoProductos = ref(false)
const drawerOpen = ref(false)
const creando = ref(false)

function emptyForm() {
  return { itemIds: [] as string[], comentario: '' }
}
const form = ref(emptyForm())

const productosContablesOpts = computed<Opt[]>(() =>
  productos.value
    .filter(p => p.modoInventario === 'cantidad')
    .map(p => ({ label: p.nombre, value: p.id })),
)

async function cargarProductos() {
  cargandoProductos.value = true
  try {
    const [prodRes, ingRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ProductoOpt>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
      useApiFetch<PaginatedResponse<ProductoOpt>>(`${apiUrl}/items?tipo=ingrediente&pageSize=100`),
    ])
    productos.value = [...prodRes.data, ...ingRes.data].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es'),
    )
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar productos'), color: 'error' })
  }
  finally {
    cargandoProductos.value = false
  }
}

function abrirCrear() {
  form.value = emptyForm()
  drawerOpen.value = true
  if (!productos.value.length) void cargarProductos()
}

async function crear() {
  if (!form.value.itemIds.length) {
    toast.add({ title: 'Selecciona al menos un producto', color: 'error' })
    return
  }
  creando.value = true
  try {
    const body: Record<string, unknown> = { itemIds: form.value.itemIds }
    if (form.value.comentario.trim()) body.comentario = form.value.comentario.trim()

    const res = await useApiFetch<{ id: string }>(`${apiUrl}/recuentos`, {
      method: 'POST',
      body,
    })
    drawerOpen.value = false
    await navigateTo(`/inventario/recuentos/${res.id}`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al crear el recuento'), color: 'error' })
  }
  finally {
    creando.value = false
  }
}

const columns: TableColumn<RecuentoListItem>[] = [
  { accessorKey: 'creadoEl', header: 'Fecha' },
  { id: 'estado', header: 'Estado' },
  { accessorKey: 'cantidadLineas', header: 'Líneas', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'diferenciaNeta', header: 'Diferencia neta', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'comentario', header: 'Comentario' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Recuentos de inventario" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          large
          title="Recuentos de inventario"
          description="Sesiones de conteo físico: contá contra el stock del sistema y aplicá la diferencia al kardex."
        >
          <template #actions>
            <UButton
              icon="i-lucide-plus"
              @click="abrirCrear"
            >
              Nuevo recuento
            </UButton>
          </template>
        </CrudPageHeader>

        <div class="flex flex-wrap gap-2">
          <USelectMenu
            v-model="filtroEstado"
            :items="estadoFiltroOpts"
            value-key="value"
            class="w-52"
            placeholder="Estado"
          />
        </div>

        <CrudTable
          :data="recuentos"
          :columns="columns"
          :loading="loading"
          :ui="{ tr: 'cursor-pointer' }"
          @select="onSelectRecuento"
        >
          <template #creadoEl-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatFecha(row.original.creadoEl) }}</span>
          </template>
          <template #estado-cell="{ row }">
            <UBadge
              :label="estadoRecuentoLabel(row.original.estado)"
              :color="estadoRecuentoColor(row.original.estado)"
              variant="subtle"
              size="sm"
            />
          </template>
          <template #diferenciaNeta-cell="{ row }">
            <span
              class="font-medium"
              :class="claseDiferenciaRecuento(row.original.diferenciaNeta)"
            >
              {{ row.original.diferenciaNeta }}
            </span>
          </template>
          <template #comentario-cell="{ row }">
            <span class="text-sm text-muted">{{ row.original.comentario || '—' }}</span>
          </template>
          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              <UIcon
                name="i-lucide-clipboard-list"
                class="w-8 h-8 mx-auto mb-2 opacity-40"
              />
              No hay recuentos de inventario.
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

        <AppDrawer
          v-model:open="drawerOpen"
          width="md"
        >
          <template #header>
            <span class="font-semibold text-default">Nuevo recuento</span>
          </template>

          <template #body>
            <UForm
              id="recuento-form"
              :state="form"
              class="space-y-4"
              @submit="crear"
            >
              <UFormField
                label="Productos"
                required
                help="Solo productos por cantidad — series y lotes no admiten recuento en esta versión."
              >
                <USelectMenu
                  v-model="form.itemIds"
                  :items="productosContablesOpts"
                  value-key="value"
                  multiple
                  searchable
                  :loading="cargandoProductos"
                  placeholder="Selecciona uno o más productos"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="Comentario">
                <UTextarea
                  v-model="form.comentario"
                  :rows="2"
                  placeholder="Opcional"
                  class="w-full"
                />
              </UFormField>
            </UForm>
          </template>

          <template #actions>
            <UButton
              color="neutral"
              variant="ghost"
              @click="() => { drawerOpen = false }"
            >
              Cancelar
            </UButton>
            <UButton
              type="submit"
              form="recuento-form"
              :loading="creando"
            >
              Crear
            </UButton>
          </template>
        </AppDrawer>
      </div>
    </template>
  </UDashboardPanel>
</template>
