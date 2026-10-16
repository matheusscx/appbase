<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

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
  /** La causa fija de la nota de crédito: se filtra por ella, no se elige a mano. */
  esDevolucion: boolean
}

/**
 * Qué lista la pantalla (owner, 2026-10-04, "Mesa y Mermas"): la merma de bodega
 * o la comida del personal, que descuenta igual pero no es pérdida y por eso se
 * ve aparte. Es el `?tipo=` de `GET /mermas` y decide qué motivos se ofrecen.
 */
type VistaMermas = 'merma' | 'consumo_personal'

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

// Los productos ya no se cargan enteros (tope de 100): `AppItemSelect` busca en el servidor y el
// caché guarda lo visto; el producto de la merma se lee de acá.
const catalogoItems = useItemsPorId<ProductoOpt>()
const FILTROS_PRODUCTO = { tipo: ['producto', 'ingrediente'] }
const motivos = ref<MotivoOpt[]>([])
const vista = ref<VistaMermas>('merma')
const vistas = [
  { label: 'Mermas', value: 'merma' },
  { label: 'Comida del personal', value: 'consumo_personal' },
]
const esPersonal = computed(() => vista.value === 'consumo_personal')
// Vacío = todos los productos (con `clear`); no hay opción "Todos" con valor inventado.
const filtroItem = ref<string | null>(null)
const filtroMotivo = ref('todos')
const filtroDesde = ref('')
const filtroHasta = ref('')

// Un motivo de la otra vista dejaría la lista vacía sin explicar por qué, y los
// motivos que se ofrecen son los del tipo de la vista. Se vacían ANTES de pedir:
// mientras llega la respuesta —o si falla— no queda ofrecido un motivo de la
// otra vista, que el servidor aceptaría y se registraría en la lista equivocada.
watch(vista, () => {
  filtroMotivo.value = 'todos'
  motivos.value = []
  cargarMotivos()
})

const listFilters = computed(() => ({
  tipo: vista.value,
  itemId: filtroItem.value || undefined,
  motivoBajaId: filtroMotivo.value !== 'todos' ? filtroMotivo.value : undefined,
  desde: filtroDesde.value || undefined,
  hasta: filtroHasta.value || undefined,
}))

const hayFiltros = computed(() =>
  !!filtroItem.value || filtroMotivo.value !== 'todos' || !!filtroDesde.value || !!filtroHasta.value,
)
function quitarFiltros() {
  filtroItem.value = null
  filtroMotivo.value = 'todos'
  filtroDesde.value = ''
  filtroHasta.value = ''
}

const { items: mermas, meta, page, loading, error, sinPermiso, fetch: fetchMermas } =
  usePaginatedList<MermaListItem>({
    path: '/mermas',
    pageSize,
    filters: listFilters,
  })

const motivosFiltroOpts = computed<Opt[]>(() => [
  { label: 'Todos los motivos', value: 'todos' },
  ...motivos.value.map(c => ({ label: c.nombre, value: c.id })),
])

// "Devolución" la deja la nota de crédito cuando lo devuelto se pierde: se
// puede filtrar por ella (arriba), pero no registrar a mano —el backend la
// rechaza con 400—.
const motivosFormOpts = computed<Opt[]>(() =>
  motivos.value
    .filter(c => !c.esDevolucion)
    .map(c => ({ label: c.nombre, value: c.id })),
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
  catalogoItems.porId.get(form.value.itemId) ?? null,
)

// El backend rechaza la merma de un producto con serie (nombra la unidad que sale y
// esta pantalla no tiene dónde elegirla). El producto sigue apareciendo en el buscador:
// quien busca el celular roto no entendería por qué no está. Mismo texto que el 400.
const productoConSerie = computed(() =>
  productoSeleccionado.value?.modoInventario === 'serie' ? productoSeleccionado.value : null,
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
  const prod = catalogoItems.porId.get(itemId)
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

// El servidor filtra por el tipo de la vista: la cortesía y el "no se llegó a
// hacer" son de la mesa y nunca se ofrecen acá.
async function cargarMotivos() {
  const pedida = vista.value
  try {
    const res = await useApiFetch<MotivoOpt[]>(`${apiUrl}/motivos-baja?soloActivas=true&tipo=${pedida}`)
    // Cambiar de vista dos veces rápido: la respuesta vieja no pisa la nueva.
    if (vista.value === pedida) motivos.value = res
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar los motivos'), color: 'error' })
  }
}

async function cargarCatalogos() {
  try {
    await unidadesMedidaStore.ensureLoaded()
    await Promise.all([cargarMotivos(), cargarUbicaciones()])
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar catálogos'), color: 'error' })
  }
}

function abrirRegistrar() {
  form.value = emptyForm()
  limpiar()
  // Con una sola ubicación el selector no se dibuja (`docs/features/bodegas-y-traslados.md`,
  // «Frontend»): el cliente completa el local directamente, sin que el usuario
  // tenga que elegirlo.
  if (!hayBodegas.value && local.value) {
    form.value.ubicacionId = local.value.id
  }
  drawerOpen.value = true
}

const { errores, marcar, limpiar } = useErroresCampo()

async function registrar() {
  // El botón ya está deshabilitado, pero Enter dentro del formulario también lo envía: el
  // backend rechazaría con 400 y esta pantalla no tiene dónde elegir la unidad.
  if (productoConSerie.value) return
  const faltan: Record<string, string> = {}
  if (!form.value.ubicacionId) faltan.ubicacionId = 'Elige la ubicación'
  if (!form.value.itemId) faltan.itemId = 'Elige el producto'
  if (!form.value.cantidad) faltan.cantidad = 'Escribe la cantidad'
  if (!form.value.motivoBajaId) faltan.motivoBajaId = 'Elige el motivo'
  if (marcar(faltan)) return

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
    const registrada = esPersonal.value ? 'Comida del personal registrada' : 'Merma registrada'
    const costo = esPersonal.value ? 'costo' : 'costo perdido'
    toast.add({
      title: res.costoPerdido != null
        ? `${registrada} · ${costo} ${formatMonto(res.costoPerdido, res.merma.monedaId)}`
        : `${registrada} · sin valorizar`,
      color: 'success',
    })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, esPersonal.value ? 'Error al registrar la comida del personal' : 'Error al registrar merma'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

onMounted(cargarCatalogos)

// En la comida del personal el costo no es una pérdida: la columna no lo dice así.
const columns = computed<TableColumn<MermaListItem>[]>(() => [
  { accessorKey: 'creadoEl', header: 'Fecha' },
  { accessorKey: 'itemNombre', header: 'Producto' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'motivoBajaNombre', header: 'Motivo' },
  { accessorKey: 'costoUnitario', header: 'Costo unit.', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costoPerdido', header: esPersonal.value ? 'Costo' : 'Costo perdido', meta: { class: { th: 'text-right', td: 'text-right' } } },
  // El comentario se acota para que a 768 la tabla entre en la tarjeta (05.13).
  { accessorKey: 'comentario', header: 'Comentario', meta: { class: { th: 'max-w-40 truncate', td: 'max-w-40 truncate' } } },
])
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
      description="Registra descartes tipificados y la comida del personal, con el costo congelado en el movimiento."
    >
      <template #actions>
        <UButton
          v-if="puedeRegistrar"
          icon="i-lucide-plus"
          @click="abrirRegistrar"
        >
          {{ esPersonal ? 'Registrar comida del personal' : 'Registrar merma' }}
        </UButton>
      </template>
    </CrudPageHeader>

    <UTabs v-model="vista" :items="vistas" :content="false" />

    <div class="flex flex-wrap items-end gap-2">
      <AppItemSelect
        aria-label="Todos los productos"
        v-model="filtroItem"
        :catalogo="catalogoItems"
        :filtros="FILTROS_PRODUCTO"
        clear
        class="w-64"
        placeholder="Todos los productos"
      />
      <USelectMenu
        aria-label="Motivo"
        v-model="filtroMotivo"
        :items="motivosFiltroOpts"
        value-key="value"
        class="w-52"
        placeholder="Motivo"
      />
      <AppDateInput v-model="filtroDesde" label="Desde" class="w-40" qa="mermas-desde" />
      <AppDateInput v-model="filtroHasta" label="Hasta" class="w-40" qa="mermas-hasta" />
    </div>

    <DiaNegocioNota />

    <CrudTable
      :data="mermas"
      :columns="columns"
      :loading="loading"
      :error="error"
      :sin-permiso="sinPermiso"
      :recurso="esPersonal ? 'la comida del personal' : 'las mermas'"
      :vacio="esPersonal ? 'No hay comida del personal registrada.' : 'No hay mermas registradas.'"
      :filtrado-texto="esPersonal ? 'Ningún registro con esos filtros.' : 'Ninguna merma con esos filtros.'"
      :filtrado="hayFiltros"
      @reintentar="fetchMermas"
      @quitar-filtros="quitarFiltros"
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
          class="font-medium"
          :class="esPersonal ? 'text-default' : 'text-error'"
        >
          {{ formatMonto(row.original.costoPerdido, row.original.monedaId) }}
        </span>
        <span v-else class="text-muted">—</span>
      </template>
      <template #comentario-cell="{ row }">
        <span class="text-sm text-muted" :title="row.original.comentario || undefined">{{ row.original.comentario || '—' }}</span>
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
        <span class="font-semibold text-default">{{ esPersonal ? 'Registrar comida del personal' : 'Registrar merma' }}</span>
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
            :error="errores.ubicacionId"
            :help="esPersonal
              ? 'De dónde sale — acota qué productos tienen stock ahí.'
              : 'Dónde se pudrió — acota qué productos tienen stock ahí.'"
          >
            <USelectMenu
              aria-label="Ubicación"
              v-model="form.ubicacionId"
              :items="ubicaciones.map(u => ({ label: u.nombre, value: u.id }))"
              @update:model-value="limpiar('ubicacionId')"
              value-key="value"
              placeholder="Selecciona la ubicación"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Producto"
            required
            :error="errores.itemId"
          >
            <AppItemSelect
              aria-label="Producto"
              v-model="form.itemId"
              :catalogo="catalogoItems"
              @update:model-value="limpiar('itemId')"
              :filtros="FILTROS_PRODUCTO"
              placeholder="Selecciona un producto"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Cantidad"
            required
            :error="errores.cantidad"
          >
            <UInput
              v-model="form.cantidad"
              inputmode="decimal"
              @update:model-value="limpiar('cantidad')"
              placeholder="0"
            />
          </UFormField>

          <UFormField
            v-if="mostrarSelectorUnidad"
            label="Unidad"
          >
            <USelectMenu
              aria-label="Unidad"
              v-model="form.unidadCodigo"
              :items="unidadesOpts"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Motivo"
            required
            :error="errores.motivoBajaId"
          >
            <USelectMenu
              aria-label="Motivo"
              v-model="form.motivoBajaId"
              :items="motivosFormOpts"
              @update:model-value="limpiar('motivoBajaId')"
              value-key="value"
              placeholder="Selecciona el motivo"
              class="w-full"
            />
          </UFormField>

          <UAlert
            v-if="esPersonal"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            :title="AYUDA_CONSUMO_PERSONAL"
          />

          <UAlert
            v-if="productoConSerie"
            color="warning"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="`«${productoConSerie.nombre}» tiene número de serie: da de baja el producto desde Ajuste de stock, eligiendo la unidad`"
          />

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
          :disabled="!!productoConSerie"
        >
          Registrar
        </UButton>
      </template>
    </AppDrawer>
      </div>
    </template>
  </UDashboardPanel>
</template>
