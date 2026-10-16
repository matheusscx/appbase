<script setup lang="ts">
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface RecuentoListItem {
  id: string
  estado: string
  comentario: string | null
  creadoEl: string
  aplicadoEl: string | null
  cantidadLineas: number
  lineasConDiferencia: number
  usuarioCreadorNombre: string | null
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
const { ubicaciones, local, hayBodegas, cargar: cargarUbicaciones } = useUbicaciones()

// Crear la sesión exige Inventario/Crear; el nav abre esta página con Leer.
const { puedeCrear: puedeContar } = usePermisosCrud('Inventario')

const filtroEstado = ref<string>('todos')

const listFilters = computed(() => ({
  estado: filtroEstado.value !== 'todos' ? filtroEstado.value : undefined,
}))

const { items: recuentos, meta, page, loading, error, sinPermiso, fetch: fetchRecuentos } =
  usePaginatedList<RecuentoListItem>({
    path: '/recuentos',
    pageSize,
    filters: listFilters,
  })

// Antes de abrir "Nuevo recuento": `abrirCrear` decide si el selector se
// dibuja (`hayBodegas`) y completa el local cuando no hace falta elegir, así
// que las ubicaciones tienen que estar cargadas antes de ese primer click.
onMounted(() => {
  void cargarUbicaciones()
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

// Los productos ya no se cargan enteros (tope de 100): `AppItemSelect` busca en el servidor.
// El recuento solo admite productos por cantidad, y ese filtro lo hace el servidor.
const catalogoItems = useItemsPorId<ProductoOpt>()
const FILTROS_RECUENTO = { tipo: ['producto', 'ingrediente'], modoInventario: 'cantidad' as const }
const drawerOpen = ref(false)
const creando = ref(false)

function emptyForm() {
  return { ubicacionId: '', itemIds: [] as string[], comentario: '', todos: false }
}
const form = ref(emptyForm())

const { errores, marcar, limpiar } = useErroresCampo()

// "Todos los productos con stock en esta ubicación" (05.5): el servidor dice cuáles son (lectura),
// y se mandan a crear la sesión como cualquier otra selección.
interface ProductosConStock { itemIds: string[], enOtroRecuento: number, truncado: boolean }
const conStock = ref<ProductosConStock | null>(null)
const cargandoConStock = ref(false)

watch([() => form.value.todos, () => form.value.ubicacionId], async ([todos, ubicacionId]) => {
  conStock.value = null
  if (!todos || !ubicacionId) return
  cargandoConStock.value = true
  try {
    const res = await useApiFetch<ProductosConStock>(`${apiUrl}/recuentos/productos-con-stock?ubicacionId=${ubicacionId}`)
    // Cambió la ubicación o desmarcó mientras viajaba: esta respuesta ya no corresponde.
    if (form.value.todos && form.value.ubicacionId === ubicacionId) conStock.value = res
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudieron buscar los productos con stock'), color: 'error' })
    form.value.todos = false
  }
  finally {
    cargandoConStock.value = false
  }
})

const avisoConStock = computed(() => {
  const r = conStock.value
  if (!r) return ''
  const n = r.itemIds.length
  const partes = [n === 1 ? 'Se va a contar 1 producto.' : `Se van a contar ${n} productos.`]
  if (r.enOtroRecuento > 0) {
    partes.push(r.enOtroRecuento === 1
      ? '1 ya está en otro recuento en borrador y no se incluye.'
      : `${r.enOtroRecuento} ya están en otro recuento en borrador y no se incluyen.`)
  }
  if (r.truncado) partes.push('Hay más de los que caben en un recuento: se cuentan los primeros 2000.')
  return partes.join(' ')
})

function abrirCrear() {
  form.value = emptyForm()
  limpiar()
  // Con una sola ubicación el selector no se dibuja (`docs/features/bodegas-y-traslados.md`,
  // «Frontend»): el cliente completa el local directamente.
  if (!hayBodegas.value && local.value) {
    form.value.ubicacionId = local.value.id
  }
  drawerOpen.value = true
}

async function crear() {
  const faltan: Record<string, string> = {}
  if (!form.value.ubicacionId) faltan.ubicacionId = 'Elige la ubicación'
  const itemIds = form.value.todos ? (conStock.value?.itemIds ?? []) : form.value.itemIds
  if (!itemIds.length) {
    faltan.itemIds = form.value.todos && conStock.value
      ? 'No hay productos con stock para contar en esta ubicación'
      : 'Elige al menos un producto'
  }
  if (marcar(faltan)) return
  creando.value = true
  try {
    const body: Record<string, unknown> = {
      ubicacionId: form.value.ubicacionId,
      itemIds,
    }
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
  { accessorKey: 'lineasConDiferencia', header: 'Con diferencia', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'usuarioCreadorNombre', header: 'Creado por' },
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
          description="Sesiones de conteo físico: cuenta contra el stock del sistema y aplica la diferencia al historial de movimientos."
        >
          <template #actions>
            <UButton
              v-if="puedeContar"
              icon="i-lucide-plus"
              @click="abrirCrear"
            >
              Nuevo recuento
            </UButton>
          </template>
        </CrudPageHeader>

        <div class="flex flex-wrap gap-2">
          <USelectMenu
            aria-label="Estado"
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
          :error="error"
          :sin-permiso="sinPermiso"
          recurso="los recuentos"
          vacio="No hay recuentos de inventario."
          :filtrado="filtroEstado !== 'todos'"
          @reintentar="fetchRecuentos"
          @quitar-filtros="() => { filtroEstado = 'todos' }"
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
          <template #usuarioCreadorNombre-cell="{ row }">
            <span class="text-sm text-muted">{{ row.original.usuarioCreadorNombre || '—' }}</span>
          </template>
          <template #comentario-cell="{ row }">
            <span class="text-sm text-muted">{{ row.original.comentario || '—' }}</span>
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
                v-if="hayBodegas"
                label="Ubicación"
                required
                :error="errores.ubicacionId"
                help="Dónde se cuenta. No se puede cambiar después de crear la sesión."
              >
                <USelectMenu
                  aria-label="Ubicación"
                  v-model="form.ubicacionId"
                  @update:model-value="limpiar('ubicacionId')"
                  :items="ubicaciones.map(u => ({ label: u.nombre, value: u.id }))"
                  value-key="value"
                  placeholder="Selecciona la ubicación"
                  class="w-full"
                />
              </UFormField>

              <div data-qa="recuento-todos">
                <UCheckbox
                  v-model="form.todos"
                  :disabled="!form.ubicacionId"
                  label="Todos los productos con stock en esta ubicación"
                  :description="form.ubicacionId ? undefined : 'Elige primero la ubicación.'"
                  :ui="{ root: 'min-h-11 items-center' }"
                  @update:model-value="limpiar('itemIds')"
                />
                <p v-if="cargandoConStock" class="mt-1 text-sm text-muted">Buscando los productos…</p>
                <p v-else-if="avisoConStock" data-qa="recuento-todos-cuenta" class="mt-1 text-sm text-muted">
                  {{ avisoConStock }}
                </p>
                <p v-if="form.todos && errores.itemIds" class="mt-1 text-sm text-error">{{ errores.itemIds }}</p>
              </div>

              <UFormField
                v-if="!form.todos"
                label="Productos"
                required
                :error="errores.itemIds"
                help="Solo productos por cantidad — series y lotes no admiten recuento en esta versión."
              >
                <AppItemSelect
                  aria-label="Productos"
                  v-model="form.itemIds"
                  @update:model-value="limpiar('itemIds')"
                  :catalogo="catalogoItems"
                  :filtros="FILTROS_RECUENTO"
                  multiple
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
