<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

interface MermaListItem {
  id: string
  itemId: string
  itemNombre: string
  cantidad: string
  costoUnitario: string | null
  costoPerdido: string | null
  causaMermaId: string | null
  causaNombre: string | null
  comentario: string | null
  creadoEl: string
  usuarioNombre: string | null
}

interface ProductoOpt {
  id: string
  nombre: string
  costoActual: string | null
  unidadMedida: string | null
  modoInventario: string | null
}

interface CausaOpt {
  id: string
  nombre: string
}

interface Opt { label: string; value: string }

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatFecha, formatMonto } = useFormatters()
const { pageSize } = useUserPreferences()
const unidadesMedidaStore = useUnidadesMedidaStore()

const productos = ref<ProductoOpt[]>([])
const causas = ref<CausaOpt[]>([])
const filtroItem = ref('todos')
const filtroCausa = ref('todos')
const filtroDesde = ref('')
const filtroHasta = ref('')

const listFilters = computed(() => ({
  itemId: filtroItem.value !== 'todos' ? filtroItem.value : undefined,
  causaMermaId: filtroCausa.value !== 'todos' ? filtroCausa.value : undefined,
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

const causasFiltroOpts = computed<Opt[]>(() => [
  { label: 'Todas las causas', value: 'todos' },
  ...causas.value.map(c => ({ label: c.nombre, value: c.id })),
])

const causasFormOpts = computed<Opt[]>(() =>
  causas.value.map(c => ({ label: c.nombre, value: c.id })),
)

const drawerOpen = ref(false)
const saving = ref(false)
const costoSinActualModalOpen = ref(false)
const costoSinActualAck = ref(false)

function emptyForm() {
  return {
    itemId: '',
    cantidad: '',
    unidadCodigo: '',
    causaMermaId: '',
    comentario: '',
    costoUnitario: '',
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
  form.value.costoUnitario = prod.costoActual ?? ''
  costoSinActualAck.value = false
  if (prod.costoActual == null) {
    costoSinActualModalOpen.value = true
  }
})

async function cargarCatalogos() {
  try {
    await unidadesMedidaStore.ensureLoaded()
    const [prodRes, causasRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ProductoOpt>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
      useApiFetch<CausaOpt[]>(`${apiUrl}/causas-merma?soloActivas=true`),
    ])
    productos.value = prodRes.data
    causas.value = causasRes
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar catálogos'), color: 'error' })
  }
}

function abrirRegistrar() {
  form.value = emptyForm()
  costoSinActualAck.value = false
  drawerOpen.value = true
}

function confirmarCostoSinActual() {
  costoSinActualAck.value = true
  costoSinActualModalOpen.value = false
}

async function registrar() {
  if (!form.value.itemId || !form.value.cantidad || !form.value.causaMermaId) {
    toast.add({ title: 'Completa producto, cantidad y causa', color: 'error' })
    return
  }
  if (sinCostoActual.value) {
    if (!costoSinActualAck.value) {
      costoSinActualModalOpen.value = true
      return
    }
    if (!form.value.costoUnitario.trim()) {
      toast.add({ title: 'Indica el costo unitario para valorizar la merma', color: 'error' })
      return
    }
  }

  saving.value = true
  try {
    const body: Record<string, string> = {
      itemId: form.value.itemId,
      cantidad: form.value.cantidad,
      causaMermaId: form.value.causaMermaId,
    }
    const base = productoSeleccionado.value?.unidadMedida
    if (form.value.unidadCodigo && form.value.unidadCodigo !== base) {
      body.unidadCodigo = form.value.unidadCodigo
    }
    if (form.value.comentario.trim()) {
      body.comentario = form.value.comentario.trim()
    }
    if (form.value.costoUnitario.trim()) {
      body.costoUnitario = form.value.costoUnitario.trim()
    }

    const res = await useApiFetch<{ costoPerdido: string; causaNombre: string }>(
      `${apiUrl}/mermas`,
      { method: 'POST', body },
    )
    toast.add({
      title: `Merma registrada · costo perdido ${formatMonto(res.costoPerdido)}`,
      color: 'success',
    })
    drawerOpen.value = false
    await fetchMermas()
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
  { accessorKey: 'causaNombre', header: 'Causa' },
  { accessorKey: 'costoUnitario', header: 'Costo unit.', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costoPerdido', header: 'Costo perdido', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'comentario', header: 'Comentario' },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      large
      title="Mermas"
      description="Registra descartes tipificados y ve el costo perdido congelado en el movimiento."
    >
      <template #actions>
        <UButton
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
        v-model="filtroCausa"
        :items="causasFiltroOpts"
        value-key="value"
        class="w-52"
        placeholder="Causa"
      />
      <UInput
        v-model="filtroDesde"
        type="date"
        class="w-40"
      />
      <UInput
        v-model="filtroHasta"
        type="date"
        class="w-40"
      />
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
        <span class="font-medium text-default">{{ row.original.itemNombre }}</span>
      </template>
      <template #cantidad-cell="{ row }">
        <span class="text-warning">{{ row.original.cantidad }}</span>
      </template>
      <template #causaNombre-cell="{ row }">
        <UBadge
          :label="row.original.causaNombre ?? '—'"
          color="neutral"
          variant="subtle"
          size="sm"
        />
      </template>
      <template #costoUnitario-cell="{ row }">
        {{ row.original.costoUnitario != null ? formatMonto(row.original.costoUnitario) : '—' }}
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
            label="Causa"
            required
          >
            <USelectMenu
              v-model="form.causaMermaId"
              :items="causasFormOpts"
              value-key="value"
              placeholder="Selecciona la causa"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Costo unitario"
            :required="sinCostoActual"
            :help="sinCostoActual
              ? 'Obligatorio: valoriza solo esta merma, no actualiza el costo del producto.'
              : 'Prefill con el costo actual; puedes ajustarlo solo para este movimiento.'"
          >
            <UInput
              v-model="form.costoUnitario"
              inputmode="decimal"
              placeholder="0"
            />
          </UFormField>

          <UAlert
            v-if="sinCostoActual"
            color="warning"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Sin costo actual"
            description="El monto que indiques valoriza solo esta merma y no actualiza el costo del producto."
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
          @click="drawerOpen = false"
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

    <UModal
      v-model:open="costoSinActualModalOpen"
      title="Producto sin costo actual"
      description="Este producto no tiene costo actual. El monto que indiques valoriza solo esta merma y no actualiza el costo del producto."
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="costoSinActualModalOpen = false"
          >
            Entendido
          </UButton>
          <UButton @click="confirmarCostoSinActual">
            Continuar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
