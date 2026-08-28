<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const toast = useToast()
const { formatFecha, formatMonto, formatStock } = useFormatters()
const { pageSize } = useUserPreferences()

// El nav abre esta página con Inventario/Leer, pero POST /inventario/ajustes-costo
// exige Inventario/Actualizar: sin este gate el usuario llena el formulario
// entero para recibir un 403.
const { puedeActualizar: puedeAjustarCosto } = usePermisosCrud('Inventario')

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
  costoAnterior?: string | null
  costoPerdido?: string | null
  unidadMedida: string | null
  monedaId: string
  /** El producto se dio de baja después de este movimiento; el kardex lo conserva. */
  itemEliminado: boolean
}

interface ProductoCosto {
  id: string
  nombre: string
  costoActual: string | null
  unidadMedida: string | null
  modoInventario: string | null
  monedaId: string
}

interface Opt { label: string; value: string }

const { public: { apiUrl } } = useRuntimeConfig()
const productos = ref<ProductoCosto[]>([])
const filtroItem = ref('todos')
const filtroMotivo = ref('todos')
const unidadesMedidaStore = useUnidadesMedidaStore()

const listFilters = computed(() => ({
  itemId: filtroItem.value !== 'todos' ? filtroItem.value : undefined,
  motivo: filtroMotivo.value !== 'todos' ? filtroMotivo.value : undefined,
}))

const { items: movimientos, meta, page, loading, fetch: fetchMovimientos } =
  usePaginatedList<Movimiento>({
    path: '/inventario/movimientos',
    pageSize,
    filters: listFilters,
  })

const motivoOpts: Opt[] = [
  { label: 'Todos los motivos', value: 'todos' },
  { label: 'Compra', value: 'compra' },
  { label: 'Venta', value: 'venta' },
  { label: 'Devolución', value: 'devolucion' },
  { label: 'Anulación de venta', value: 'anulacion' },
  { label: 'Merma', value: 'merma' },
  { label: 'Ajuste manual', value: 'ajuste_manual' },
  { label: 'Ajuste de costo', value: 'ajuste_costo' },
  { label: 'Inventario inicial', value: 'inventario_inicial' },
  { label: 'Recuento', value: 'recuento' },
]

const productosOpts = computed<Opt[]>(() => [
  { label: 'Todos los productos', value: 'todos' },
  ...productos.value.map(p => ({ label: p.nombre, value: p.id })),
])

const productosFormOpts = computed<Opt[]>(() =>
  productos.value.map(p => ({ label: p.nombre, value: p.id })),
)

async function cargarProductos() {
  try {
    const [prodRes, ingRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ProductoCosto>>(
        `${apiUrl}/items?tipo=producto&pageSize=100`,
      ),
      useApiFetch<PaginatedResponse<ProductoCosto>>(
        `${apiUrl}/items?tipo=ingrediente&pageSize=100`,
      ),
    ])
    productos.value = [...prodRes.data, ...ingRes.data].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es'),
    )
  }
  catch {
    toast.add({ title: 'Error al cargar productos', color: 'error' })
  }
}

onMounted(() => {
  void cargarProductos()
  void unidadesMedidaStore.ensureLoaded()
})

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
  { id: 'costoAjuste', header: 'Costo', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'stockResultante', header: 'Resultante', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costoPerdido', header: 'Costo perdido', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'usuarioNombre', header: 'Usuario' },
]

// ── Ajuste de costo ──────────────────────────────────────────────────────────

const ajusteCostoOpen = ref(false)
const ajustandoCosto = ref(false)

function emptyAjusteCostoForm() {
  return { itemId: '', costoNuevo: '', unidadCodigo: '', comentario: '' }
}
const ajusteCostoForm = ref(emptyAjusteCostoForm())

const productoAjusteSeleccionado = computed(() =>
  productos.value.find(p => p.id === ajusteCostoForm.value.itemId) ?? null,
)

const unidadesAjusteOpts = computed(() => {
  const magnitud = unidadesMedidaStore.magnitudDe(productoAjusteSeleccionado.value?.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: `${u.nombre} (${u.codigo})`, value: u.codigo }))
})

const mostrarSelectorUnidadAjuste = computed(() =>
  productoAjusteSeleccionado.value?.modoInventario === 'cantidad'
  && unidadesAjusteOpts.value.length > 1,
)

/** El costo se ingresa "por la unidad seleccionada", no por la unidad base: la
 * precisión la da elegir la unidad, no teclear decimales que la moneda no tiene.
 * Ver docs/superpowers/specs/2026-08-28-costo-por-unidad-elegida-design.md */
const costoNuevoLabel = computed(() => {
  const unidad = ajusteCostoForm.value.unidadCodigo || productoAjusteSeleccionado.value?.unidadMedida
  return unidad ? `Costo nuevo (por ${unidad})` : 'Costo nuevo'
})

watch(() => ajusteCostoForm.value.itemId, (itemId) => {
  const prod = productos.value.find(p => p.id === itemId)
  if (!prod) return
  ajusteCostoForm.value.unidadCodigo = prod.unidadMedida ?? 'unidad'
})

// Simulador de impacto de costos en recetas y combos: se dispara tras un ajuste de
// costo exitoso, igual que tras una compra en configuracion/items.vue.
const { desfasesOpen, desfasesLoading, desfasesFilas, desfasesHighlightId, maybeAbrirDesfases, onAplicarDesfases, onDescartarDesfases } =
  useSimuladorDesfases()

function abrirAjusteCosto() {
  ajusteCostoForm.value = emptyAjusteCostoForm()
  ajusteCostoOpen.value = true
}

async function registrarAjusteCosto() {
  const f = ajusteCostoForm.value
  if (!f.itemId || !f.costoNuevo || !f.comentario.trim()) {
    toast.add({ title: 'Completa producto, costo nuevo y comentario', color: 'error' })
    return
  }
  ajustandoCosto.value = true
  try {
    const body: Record<string, string> = {
      itemId: f.itemId,
      costoNuevo: f.costoNuevo,
      comentario: f.comentario.trim(),
    }
    // Solo si difiere de la base: el DTO valida `@IsNotEmpty()`, así que una
    // cadena vacía sería un 400.
    const base = productoAjusteSeleccionado.value?.unidadMedida
    if (f.unidadCodigo && f.unidadCodigo !== base) {
      body.unidadCodigo = f.unidadCodigo
    }
    await useApiFetch(`${apiUrl}/inventario/ajustes-costo`, {
      method: 'POST',
      body,
    })
    toast.add({ title: 'Costo ajustado', color: 'success' })
    ajusteCostoOpen.value = false
    await Promise.all([fetchMovimientos(), cargarProductos()])
    await maybeAbrirDesfases(f.itemId)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al ajustar costo'), color: 'error' })
  }
  finally {
    ajustandoCosto.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Inventario" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          large
          title="Inventario"
          description="Kardex de movimientos de stock"
        >
          <template #actions>
            <UButton
              v-if="puedeAjustarCosto"
              icon="i-lucide-circle-dollar-sign"
              @click="abrirAjusteCosto"
            >
              Ajustar costo
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
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ row.original.itemNombre }}</span>
              <UBadge
                v-if="row.original.itemEliminado"
                label="Eliminado"
                color="neutral"
                variant="subtle"
                size="sm"
              />
            </div>
          </template>
          <template #tipo-cell="{ row }">
            <UBadge
              :label="row.original.tipo === 'entrada' ? 'Entrada' : row.original.tipo === 'salida' ? 'Salida' : 'Ajuste'"
              :color="row.original.tipo === 'entrada' ? 'success' : row.original.tipo === 'salida' ? 'warning' : 'neutral'"
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
            <span v-if="row.original.motivo === 'ajuste_costo'" class="text-muted">—</span>
            <span v-else :class="row.original.tipo === 'entrada' ? 'text-success' : 'text-warning'">
              {{ formatStock(row.original.cantidad, row.original.unidadMedida) }}
            </span>
          </template>
          <template #costoAjuste-cell="{ row }">
            <span v-if="row.original.motivo === 'ajuste_costo'" class="font-mono">
              {{ formatMonto(row.original.costoAnterior, row.original.monedaId) }}
              <span class="text-muted">→</span>
              {{ formatMonto(row.original.costoUnitario, row.original.monedaId) }}
            </span>
            <span v-else class="text-muted">—</span>
          </template>
          <template #stockResultante-cell="{ row }">
            <span class="font-medium">{{ formatStock(row.original.stockResultante, row.original.unidadMedida) }}</span>
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

        <AppDrawer
          v-model:open="ajusteCostoOpen"
          width="md"
        >
          <template #header>
            <span class="font-semibold text-default">Ajustar costo</span>
          </template>

          <template #body>
            <UForm
              id="ajuste-costo-form"
              :state="ajusteCostoForm"
              class="space-y-4"
              @submit="registrarAjusteCosto"
            >
              <UFormField label="Producto" required>
                <USelectMenu
                  v-model="ajusteCostoForm.itemId"
                  :items="productosFormOpts"
                  value-key="value"
                  placeholder="Selecciona un producto"
                  class="w-full"
                />
              </UFormField>

              <UFormField v-if="productoAjusteSeleccionado" label="Costo vigente">
                <UInput
                  :model-value="formatMonto(productoAjusteSeleccionado.costoActual, productoAjusteSeleccionado.monedaId)"
                  disabled
                  class="w-full"
                />
              </UFormField>

              <UFormField
                v-if="mostrarSelectorUnidadAjuste"
                label="Unidad"
              >
                <USelectMenu
                  v-model="ajusteCostoForm.unidadCodigo"
                  :items="unidadesAjusteOpts"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>

              <UFormField :label="costoNuevoLabel" required>
                <MoneyInput
                  v-model="ajusteCostoForm.costoNuevo"
                  :moneda-id="productoAjusteSeleccionado?.monedaId"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="Comentario" required help="Obligatorio: un ajuste de costo es una corrección y queda auditada.">
                <UTextarea
                  v-model="ajusteCostoForm.comentario"
                  :rows="2"
                  placeholder="Por qué se corrige el costo"
                  class="w-full"
                />
              </UFormField>
            </UForm>
          </template>

          <template #actions>
            <UButton
              color="neutral"
              variant="ghost"
              @click="() => { ajusteCostoOpen = false }"
            >
              Cancelar
            </UButton>
            <UButton
              type="submit"
              form="ajuste-costo-form"
              :loading="ajustandoCosto"
            >
              Ajustar costo
            </UButton>
          </template>
        </AppDrawer>

        <!-- Impacto de costos en recetas y combos tras el ajuste -->
        <AppDrawer
          v-model:open="desfasesOpen"
          width="75%"
          title="Impacto en recetas y combos"
          description="El costo del producto cambió; estas recetas y combos quedaron desfasados."
        >
          <template #body>
            <DesfasesPanel
              :filas="desfasesFilas"
              :highlight-ingrediente-id="desfasesHighlightId"
              :loading="desfasesLoading"
              @aplicar="onAplicarDesfases"
              @descartar="onDescartarDesfases"
              @cerrar="desfasesOpen = false"
            />
          </template>
        </AppDrawer>
      </div>
    </template>
  </UDashboardPanel>
</template>
