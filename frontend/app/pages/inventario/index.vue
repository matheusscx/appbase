<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const toast = useToast()
const { formatFecha, formatMonto, formatCosto, formatStock, esAjusteDeValor } = useFormatters()
const { convertirCosto } = useUnidadConversion()
const { pageSize } = useUserPreferences()
const { ubicaciones, hayBodegas, cargar: cargarUbicaciones } = useUbicaciones()

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
  motivoBajaNombre?: string | null
  costoUnitario?: string | null
  costoAnterior?: string | null
  costoPerdido?: string | null
  unidadMedida: string | null
  monedaId: string
  /** El producto se dio de baja después de este movimiento; el kardex lo conserva. */
  itemEliminado: boolean
  ubicacionId: string
  /** `null` si la ubicación se eliminó después del movimiento. */
  ubicacionNombre: string | null
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
// Los productos ya no se cargan enteros (tope de 100): `AppItemSelect` busca en el servidor y el
// caché guarda lo visto; el producto del ajuste de costo se lee de acá.
const catalogoItems = useItemsPorId<ProductoCosto>()
const FILTROS_PRODUCTO = { tipo: ['producto', 'ingrediente'] }
// Vacío = todos los productos (con `clear`); no hay opción "Todos" con valor inventado.
const filtroItem = ref<string | null>(null)
const filtroMotivo = ref('todos')
const filtroUbicacion = ref('todos')
const unidadesMedidaStore = useUnidadesMedidaStore()

const listFilters = computed(() => ({
  itemId: filtroItem.value || undefined,
  motivo: filtroMotivo.value !== 'todos' ? filtroMotivo.value : undefined,
  ubicacionId: filtroUbicacion.value !== 'todos' ? filtroUbicacion.value : undefined,
}))

const { items: movimientos, meta, page, loading, fetch: fetchMovimientos } =
  usePaginatedList<Movimiento>({
    path: '/inventario/movimientos',
    pageSize,
    filters: listFilters,
  })

const ubicacionFiltroOpts = computed<Opt[]>(() => [
  { label: 'Todas las ubicaciones', value: 'todos' },
  ...ubicaciones.value.map(u => ({ label: u.nombre, value: u.id })),
])

const motivoOpts: Opt[] = [
  { label: 'Todos los motivos', value: 'todos' },
  { label: 'Compra', value: 'compra' },
  { label: 'Venta', value: 'venta' },
  { label: 'Devolución', value: 'devolucion' },
  { label: 'Anulación de venta', value: 'anulacion' },
  { label: 'Merma', value: 'merma' },
  { label: 'Ajuste manual', value: 'ajuste_manual' },
  { label: 'Ajuste de costo', value: 'ajuste_costo' },
  { label: 'Corrección de compra', value: 'correccion_compra' },
  { label: 'Inventario inicial', value: 'inventario_inicial' },
  { label: 'Recuento', value: 'recuento' },
  { label: 'Traslado', value: 'traslado' },
]

onMounted(() => {
  void unidadesMedidaStore.ensureLoaded()
  void cargarUbicaciones()
})

function motivoLabel(mov: Movimiento): string {
  const base = motivoOpts.find(o => o.value === mov.motivo)?.label ?? mov.motivo
  if (mov.motivo === 'merma' && mov.motivoBajaNombre) {
    return `Merma · ${mov.motivoBajaNombre}`
  }
  return base
}

// La columna Ubicación se dibuja siempre que hayBodegas (`docs/features/bodegas-y-traslados.md`,
// «Frontend»): con una sola ubicación, todas las filas dirían lo mismo.
const columns = computed<TableColumn<Movimiento>[]>(() => [
  { accessorKey: 'creadoEl', header: 'Fecha' },
  { accessorKey: 'itemNombre', header: 'Producto' },
  ...(hayBodegas.value
    ? [{ accessorKey: 'ubicacionNombre', header: 'Ubicación' } as TableColumn<Movimiento>]
    : []),
  { accessorKey: 'tipo', header: 'Tipo' },
  { accessorKey: 'motivo', header: 'Motivo' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'costoAjuste', header: 'Costo', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'stockResultante', header: 'Resultante', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costoPerdido', header: 'Costo perdido', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'usuarioNombre', header: 'Usuario' },
])

// ── Ajuste de costo ──────────────────────────────────────────────────────────

const ajusteCostoOpen = ref(false)
const ajustandoCosto = ref(false)

function emptyAjusteCostoForm() {
  return { itemId: '', costoNuevo: '', unidadCodigo: '', comentario: '' }
}
const ajusteCostoForm = ref(emptyAjusteCostoForm())

const productoAjusteSeleccionado = computed(() =>
  catalogoItems.porId.get(ajusteCostoForm.value.itemId) ?? null,
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
const unidadAjusteVisible = computed(() =>
  ajusteCostoForm.value.unidadCodigo || productoAjusteSeleccionado.value?.unidadMedida || '',
)

const costoNuevoLabel = computed(() =>
  unidadAjusteVisible.value ? `Costo nuevo (por ${unidadAjusteVisible.value})` : 'Costo nuevo',
)

const costoVigenteLabel = computed(() =>
  unidadAjusteVisible.value ? `Costo vigente (por ${unidadAjusteVisible.value})` : 'Costo vigente',
)

/** El vigente se muestra en la MISMA unidad que el selector. Mostrarlo siempre
 * en unidad base al lado de un "Costo nuevo (por g)" es la comparación que
 * inducía a cargar el número ×1000 (owner, 2026-08-28). */
const costoVigenteEnUnidad = computed(() => {
  const prod = productoAjusteSeleccionado.value
  const base = prod?.unidadMedida
  if (!prod?.costoActual || !base) return prod?.costoActual ?? null
  return convertirCosto(prod.costoActual, base, unidadAjusteVisible.value || base)
})

/** Cambiar de unidad NO reinterpreta lo ya tipeado: limpia el campo y se
 * retipea. Convertirlo parece más amable y es la trampa: `1500` por kilo son
 * `1,5` por gramo, y en una moneda sin decimales `MoneyInput` no rechaza —
 * lo muestra redondeado a `2` (y hasta el 2026-09-08 además lo emitía; mecanismo medido en
 * `docs/patterns/frontend.md` §8), o sea un costo 33% más alto que nadie
 * tecleó. Decisión del owner, 2026-08-28. */
watch(() => ajusteCostoForm.value.unidadCodigo, (_nueva, anterior) => {
  // `!anterior` es la asignación inicial (el watch de `itemId`, abajo), no un
  // cambio de unidad. Vue no dispara con el mismo valor, así que comparar
  // `nueva === anterior` sería una rama muerta.
  if (!anterior) return
  ajusteCostoForm.value.costoNuevo = ''
})

/** Cambiar de PRODUCTO limpia el costo por su cuenta, no por rebote del watch
 * de arriba: lo tipeado pertenece al producto en el que se tipeó y a su moneda.
 * Delegarlo en la unidad no alcanza —medido en el navegador el 2026-08-28—:
 * entre dos productos de base `kg` la unidad no cambia, Vue no dispara con el
 * mismo valor y el `1500` sobrevive. Y si el producto nuevo está en otra moneda
 * es peor que un número viejo: `MoneyInput` re-enmascara ese mismo número bajo
 * la escala nueva, así que `1.500` (CLP, `.` de miles) se lee `1,500.00` (USD,
 * `.` decimal) al lado de un costo vigente de US$7,50 —medido en el navegador—.
 * ⚠️ Hasta el 2026-09-08 el crudo tampoco quedaba quieto: volvía del componente
 * como `1500.00`, porque `MoneyInput` re-emitía lo que le entraba por `props`.
 * Ese re-emit se cerró, así que hoy el modelo conserva `1500` — el mismo número,
 * y la pantalla muestra lo mismo que antes. Lo que no cambia es el motivo de
 * limpiar: sea `1500` o `1500.00`, es un número tipeado para OTRO producto y
 * otra moneda. Decisión del owner,
 * 2026-08-29: se limpia, con el mismo costo que ya se aceptó para la unidad —si
 * el click en la lista fue un error, el número se retipea. */
watch(() => ajusteCostoForm.value.itemId, (itemId) => {
  // Antes del `find`: si el producto no está en la lista, lo tipeado queda
  // igual de huérfano y el campo tiene que vaciarse lo mismo.
  ajusteCostoForm.value.costoNuevo = ''
  const prod = catalogoItems.porId.get(itemId)
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
    // El costo vigente del ajustado cambió: se descarta del caché y se vuelve a traer, o el
    // formulario mostraría el de antes la próxima vez.
    catalogoItems.porId.delete(f.itemId)
    // Un fallo acá no es un fallo del ajuste (ya se registró): se avisa aparte.
    const refrescado = catalogoItems.resolver([f.itemId])
      .catch(() => { toast.add({ title: 'Error al actualizar el producto', color: 'error' }) })
    await Promise.all([fetchMovimientos(), refrescado])
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
          <AppItemSelect
            v-model="filtroItem"
            :catalogo="catalogoItems"
            :filtros="FILTROS_PRODUCTO"
            clear
            class="w-64"
            placeholder="Todos los productos"
          />
          <USelectMenu
            v-model="filtroMotivo"
            :items="motivoOpts"
            value-key="value"
            class="w-52"
            placeholder="Motivo"
          />
          <USelectMenu
            v-if="hayBodegas"
            v-model="filtroUbicacion"
            :items="ubicacionFiltroOpts"
            value-key="value"
            class="w-52"
            placeholder="Ubicación"
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
          <template #ubicacionNombre-cell="{ row }">
            <span class="text-sm text-muted">{{ row.original.ubicacionNombre ?? '—' }}</span>
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
            <span v-if="esAjusteDeValor(row.original.motivo)" class="text-muted">—</span>
            <span v-else :class="row.original.tipo === 'entrada' ? 'text-success' : 'text-warning'">
              {{ formatStock(row.original.cantidad, row.original.unidadMedida) }}
            </span>
          </template>
          <template #costoAjuste-cell="{ row }">
            <span v-if="esAjusteDeValor(row.original.motivo)" class="font-mono">
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
                <AppItemSelect
                  v-model="ajusteCostoForm.itemId"
                  :catalogo="catalogoItems"
                  :filtros="FILTROS_PRODUCTO"
                  placeholder="Selecciona un producto"
                  class="w-full"
                />
              </UFormField>

              <UFormField v-if="productoAjusteSeleccionado" :label="costoVigenteLabel">
                <UInput
                  :model-value="formatCosto(costoVigenteEnUnidad, productoAjusteSeleccionado.monedaId)"
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
