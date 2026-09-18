<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface MermaListItem {
  id: string
  itemId: string
  itemNombre: string
  cantidad: string
  costoUnitario: string | null
  costoPerdido: string | null
  motivoBajaId: string | null
  motivoBajaNombre: string | null
  comentario: string | null
  creadoEl: string
  usuarioNombre: string | null
  unidadMedida: string | null
  /** Moneda del ítem: el listado mezcla ítems de distintas monedas. */
  monedaId: string
  /** El producto se dio de baja después de esta merma; la fila se conserva. */
  itemEliminado: boolean
  /** Nace de anular un plato ya despachado en una mesa, no de una merma de
   *  bodega — también está en el reporte de Anulaciones (Salones). */
  deAnulacion: boolean
}

interface ProductoOpt {
  id: string
  nombre: string
  costoActual: string | null
  unidadMedida: string | null
  modoInventario: string | null
}

interface MotivoOpt {
  id: string
  nombre: string
}

interface Opt { label: string; value: string }

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatFecha, formatMonto, formatStock } = useFormatters()
const { pageSize } = useUserPreferences()
const unidadesMedidaStore = useUnidadesMedidaStore()
const { ubicaciones, local, hayBodegas, cargar: cargarUbicaciones } = useUbicaciones()

// El nav abre esta página con Inventario/Leer, pero POST /mermas exige
// Inventario/Crear (ver docs/patterns/frontend.md §1.1).
const { puedeCrear: puedeRegistrar } = usePermisosCrud('Inventario')

const productos = ref<ProductoOpt[]>([])
const motivos = ref<MotivoOpt[]>([])
const filtroItem = ref('todos')
const filtroMotivo = ref('todos')
const filtroDesde = ref('')
const filtroHasta = ref('')

const listFilters = computed(() => ({
  itemId: filtroItem.value !== 'todos' ? filtroItem.value : undefined,
  motivoBajaId: filtroMotivo.value !== 'todos' ? filtroMotivo.value : undefined,
  desde: filtroDesde.value || undefined,
  hasta: filtroHasta.value || undefined,
}))

const { items: mermas, meta, page, loading, fetch: fetchMermas } =
  usePaginatedList<MermaListItem>({
    path: '/mermas',
    pageSize,
    filters: listFilters,
  })

const productosOpts = computed<Opt[]>(() => [
  { label: 'Todos los productos', value: 'todos' },
  ...productos.value.map(p => ({ label: p.nombre, value: p.id })),
])

const motivosFiltroOpts = computed<Opt[]>(() => [
  { label: 'Todos los motivos', value: 'todos' },
  ...motivos.value.map(c => ({ label: c.nombre, value: c.id })),
])

const motivosFormOpts = computed<Opt[]>(() =>
  motivos.value.map(c => ({ label: c.nombre, value: c.id })),
)

const drawerOpen = ref(false)
const saving = ref(false)

function emptyForm() {
  return {
    ubicacionId: '',
    itemId: '',
    cantidad: '',
    unidadCodigo: '',
    motivoBajaId: '',
    comentario: '',
  }
}
const form = ref(emptyForm())

const productoSeleccionado = computed(() =>
  productos.value.find(p => p.id === form.value.itemId) ?? null,
)

const sinCostoActual = computed(() =>
  !!productoSeleccionado.value && productoSeleccionado.value.costoActual == null,
)

const unidadesOpts = computed(() => {
  const magnitud = unidadesMedidaStore.magnitudDe(productoSeleccionado.value?.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: `${u.nombre} (${u.codigo})`, value: u.codigo }))
})

const mostrarSelectorUnidad = computed(() =>
  productoSeleccionado.value?.modoInventario === 'cantidad'
  && unidadesOpts.value.length > 1,
)

watch(() => form.value.itemId, (itemId) => {
  const prod = productos.value.find(p => p.id === itemId)
  if (!prod) return
  form.value.unidadCodigo = prod.unidadMedida ?? 'unidad'
})

// Cambiar de ubicación con el formulario a medio llenar limpia la cantidad:
// el número pertenecía a lo que había EN la ubicación anterior, y dejarlo no
// lo deja viejo — lo deja reinterpretado. Mismo criterio que ya usa el ajuste
// de costo al cambiar de unidad o de producto (`inventario/index.vue`).
watch(() => form.value.ubicacionId, (_nueva, anterior) => {
  // `!anterior` es la asignación inicial al abrir el drawer, no un cambio.
  if (!anterior) return
  form.value.cantidad = ''
})

async function cargarCatalogos() {
  try {
    await unidadesMedidaStore.ensureLoaded()
    const [prodRes, ingRes, motivosRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ProductoOpt>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
      useApiFetch<PaginatedResponse<ProductoOpt>>(`${apiUrl}/items?tipo=ingrediente&pageSize=100`),
      useApiFetch<MotivoOpt[]>(`${apiUrl}/motivos-baja?soloActivas=true&tipo=merma`),
      cargarUbicaciones(),
    ])
    productos.value = [...prodRes.data, ...ingRes.data].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es'),
    )
    motivos.value = motivosRes
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar catálogos'), color: 'error' })
  }
}

function abrirRegistrar() {
  form.value = emptyForm()
  // Con una sola ubicación el selector no se dibuja (`docs/features/bodegas-y-traslados.md`,
  // «Frontend»): el cliente completa el local directamente, sin que el usuario
  // tenga que elegirlo.
  if (!hayBodegas.value && local.value) {
    form.value.ubicacionId = local.value.id
  }
  drawerOpen.value = true
}

async function registrar() {
  if (!form.value.itemId || !form.value.cantidad || !form.value.motivoBajaId) {
    toast.add({ title: 'Completa producto, cantidad y motivo', color: 'error' })
    return
  }
  if (!form.value.ubicacionId) {
    toast.add({ title: 'Selecciona la ubicación', color: 'error' })
    return
  }

  saving.value = true
  try {
    const body: Record<string, string> = {
      itemId: form.value.itemId,
      ubicacionId: form.value.ubicacionId,
      cantidad: form.value.cantidad,
      motivoBajaId: form.value.motivoBajaId,
    }
    const base = productoSeleccionado.value?.unidadMedida
    if (form.value.unidadCodigo && form.value.unidadCodigo !== base) {
      body.unidadCodigo = form.value.unidadCodigo
    }
    if (form.value.comentario.trim()) {
      body.comentario = form.value.comentario.trim()
    }

    const res = await useApiFetch<{
      costoPerdido: string | null
      motivoBajaNombre: string
      merma: MermaListItem
    }>(
      `${apiUrl}/mermas`,
      { method: 'POST', body },
    )
    // Inserta en la página actual si los filtros la incluirían; evita refetch.
    const filtroItem = listFilters.value.itemId
    const filtroMotivo = listFilters.value.motivoBajaId
    const coincide =
      (!filtroItem || filtroItem === res.merma.itemId)
      && (!filtroMotivo || filtroMotivo === res.merma.motivoBajaId)
    if (coincide && page.value === 1) {
      const size = pageSize.value
      mermas.value = [res.merma, ...mermas.value].slice(0, size)
      meta.value = {
        ...meta.value,
        total: meta.value.total + 1,
        totalPages: Math.max(1, Math.ceil((meta.value.total + 1) / size)),
      }
    }
    toast.add({
      title: res.costoPerdido != null
        ? `Merma registrada · costo perdido ${formatMonto(res.costoPerdido, res.merma.monedaId)}`
        : 'Merma registrada · sin valorizar',
      color: 'success',
    })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al registrar merma'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

onMounted(cargarCatalogos)

const columns: TableColumn<MermaListItem>[] = [
  { accessorKey: 'creadoEl', header: 'Fecha' },
  { accessorKey: 'itemNombre', header: 'Producto' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'motivoBajaNombre', header: 'Motivo' },
  { accessorKey: 'costoUnitario', header: 'Costo unit.', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costoPerdido', header: 'Costo perdido', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'comentario', header: 'Comentario' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Mermas" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
    <CrudPageHeader
      large
      title="Mermas"
      description="Registra descartes tipificados y ve el costo perdido congelado en el movimiento."
    >
      <template #actions>
        <UButton
          v-if="puedeRegistrar"
          icon="i-lucide-plus"
          @click="abrirRegistrar"
        >
          Registrar merma
        </UButton>
      </template>
    </CrudPageHeader>

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
        :items="motivosFiltroOpts"
        value-key="value"
        class="w-52"
        placeholder="Motivo"
      />
      <AppDateInput v-model="filtroDesde" class="w-40" qa="mermas-desde" />
      <AppDateInput v-model="filtroHasta" class="w-40" qa="mermas-hasta" />
    </div>

    <CrudTable
      :data="mermas"
      :columns="columns"
      :loading="loading"
    >
      <template #creadoEl-cell="{ row }">
        <span class="whitespace-nowrap">{{ formatFecha(row.original.creadoEl) }}</span>
      </template>
      <template #itemNombre-cell="{ row }">
        <div class="flex items-center gap-2">
          <span class="font-medium text-default">{{ row.original.itemNombre }}</span>
          <UBadge
            v-if="row.original.itemEliminado"
            label="Eliminado"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </div>
      </template>
      <template #cantidad-cell="{ row }">
        <span class="text-warning">{{ formatStock(row.original.cantidad, row.original.unidadMedida) }}</span>
      </template>
      <template #motivoBajaNombre-cell="{ row }">
        <div class="flex items-center gap-2">
          <UBadge
            :label="row.original.motivoBajaNombre ?? '—'"
            color="neutral"
            variant="subtle"
            size="sm"
          />
          <UBadge
            v-if="row.original.deAnulacion"
            label="Anulación en mesa"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </div>
      </template>
      <template #costoUnitario-cell="{ row }">
        {{ row.original.costoUnitario != null ? formatMonto(row.original.costoUnitario, row.original.monedaId) : '—' }}
      </template>
      <template #costoPerdido-cell="{ row }">
        <span
          v-if="row.original.costoPerdido != null"
          class="font-medium text-error"
        >
          {{ formatMonto(row.original.costoPerdido, row.original.monedaId) }}
        </span>
        <span v-else class="text-muted">—</span>
      </template>
      <template #comentario-cell="{ row }">
        <span class="text-sm text-muted">{{ row.original.comentario || '—' }}</span>
      </template>
      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          <UIcon
            name="i-lucide-trash-2"
            class="w-8 h-8 mx-auto mb-2 opacity-40"
          />
          No hay mermas registradas.
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
        <span class="font-semibold text-default">Registrar merma</span>
      </template>

      <template #body>
        <UForm
          id="merma-form"
          :state="form"
          class="space-y-4"
          @submit="registrar"
        >
          <UFormField
            v-if="hayBodegas"
            label="Ubicación"
            required
            help="Dónde se pudrió — acota qué productos tienen stock ahí."
          >
            <USelectMenu
              v-model="form.ubicacionId"
              :items="ubicaciones.map(u => ({ label: u.nombre, value: u.id }))"
              value-key="value"
              placeholder="Selecciona la ubicación"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Producto"
            required
          >
            <USelectMenu
              v-model="form.itemId"
              :items="productos.map(p => ({ label: p.nombre, value: p.id }))"
              value-key="value"
              placeholder="Selecciona un producto"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Cantidad"
            required
          >
            <UInput
              v-model="form.cantidad"
              inputmode="decimal"
              placeholder="0"
            />
          </UFormField>

          <UFormField
            v-if="mostrarSelectorUnidad"
            label="Unidad"
          >
            <USelectMenu
              v-model="form.unidadCodigo"
              :items="unidadesOpts"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Motivo"
            required
          >
            <USelectMenu
              v-model="form.motivoBajaId"
              :items="motivosFormOpts"
              value-key="value"
              placeholder="Selecciona el motivo"
              class="w-full"
            />
          </UFormField>

          <UAlert
            v-if="sinCostoActual"
            color="warning"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Este ítem no tiene costo cargado"
            description="La merma se va a registrar igual, pero no va a quedar valorizada — y después no se puede corregir. Para valorizarla, cárgale el costo al ítem antes de mermarlo."
          />

          <UFormField label="Comentario">
            <UTextarea
              v-model="form.comentario"
              :rows="2"
              placeholder="Opcional"
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
          form="merma-form"
          :loading="saving"
        >
          Registrar
        </UButton>
      </template>
    </AppDrawer>
      </div>
    </template>
  </UDashboardPanel>
</template>
