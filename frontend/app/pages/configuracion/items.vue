<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Row } from '@tanstack/vue-table'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import Decimal from 'decimal.js'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatFecha, formatMonto, formatStock } = useFormatters()
const { pageSize } = useUserPreferences()

// ── Interfaces ─────────────────────────────────────────────────────────────

interface Item {
  id: string
  nombre: string
  descripcion: string | null
  tipo: string
  activo: boolean
  precioBase: string
  precioIncluyeImpuesto: boolean
  monedaId: string
  monedaCodigo: string
  monedaSimbolo: string | null
  categoriaId: string | null
  categoriaNombre: string | null
  creadoEl: string
  stock: string | null
  costoActual: string | null
  unidadMedida: string | null
  fechaElaboracion: string | null
  fechaVencimiento: string | null
  modoInventario: string | null  // 'cantidad' | 'lote' | 'serie'
  duracionEstimada: number | null
  requiereCita: boolean | null
  frecuencia?: string | null
  impuestosIds?: string[]
  recargosIds?: string[]
  descuentosIds?: string[]
  ingredientes?: { ingredienteItemId: string; ingredienteNombre: string; cantidad: string; unidadCodigo: string; bloqueante: boolean }[]
  disponible?: number | null
}

interface IngredienteRow {
  ingredienteItemId: string
  cantidad: string
  unidadCodigo: string
  bloqueante: boolean
}

interface SerieRow { serie: string; condicion: string; garantiaHasta: string }

interface Unidad {
  id: string
  serie: string
  estado: string
  condicion: string
  garantiaHasta: string | null
  loteId: string | null
  codigoLote: string | null
  creadoEl: string
}

interface Lote {
  id: string
  codigoLote: string
  fechaElaboracion: string | null
  fechaVencimiento: string | null
  cantidadInicial: string
  cantidadDisponible: string
  creadoEl: string
}

interface Opt { label: string; value: string }

interface Movimiento {
  id: string
  itemNombre: string
  tipo: string
  motivo: string
  cantidad: string
  stockAnterior: string
  stockResultante: string
  costoUnitario: string | null
  usuarioNombre: string | null
  comentario: string | null
  creadoEl: string
}

// ── Estado ─────────────────────────────────────────────────────────────────

const saving = ref(false)
const ajustando = ref(false)
const drawerOpen = ref(false)
const confirmModalOpen = ref(false)
const stockModalOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const stockItem = ref<Item | null>(null)
const toggling = reactive(new Set<string>())
const filtroTipo = ref('todos')
const busqueda = ref('')
const busquedaActiva = ref('')

let busquedaTimer: ReturnType<typeof setTimeout> | null = null
watch(busqueda, (value) => {
  if (busquedaTimer) clearTimeout(busquedaTimer)
  busquedaTimer = setTimeout(() => {
    busquedaActiva.value = value.trim()
  }, 300)
})

const listFilters = computed(() => ({
  tipo: filtroTipo.value === 'todos' ? undefined : filtroTipo.value,
  search: busquedaActiva.value || undefined,
}))

const hayFiltrosActivos = computed(
  () => filtroTipo.value !== 'todos' || !!busquedaActiva.value,
)

function limpiarFiltros() {
  filtroTipo.value = 'todos'
  busqueda.value = ''
  busquedaActiva.value = ''
}

const { items, meta, page, loading, fetch: fetchItems } =
  usePaginatedList<Item>({
    path: '/items',
    pageSize,
    filters: listFilters,
  })

// Ver unidades / lotes
const verUnidadesOpen = ref(false)
const verUnidadesLoading = ref(false)
const verUnidadesItem = ref<Item | null>(null)
const unidades = ref<Unidad[]>([])
const lotes = ref<Lote[]>([])

// Unidades disponibles para selección en salida serie
const unidadesDisponibles = ref<Unidad[]>([])

// Catálogos
const monedasOpts = ref<Opt[]>([])
const categoriasOpts = ref<Opt[]>([])
const impuestosOpts = ref<Opt[]>([])
const descuentosOpts = ref<Opt[]>([])
const recargosOpts = ref<Opt[]>([])

const productosIngrediente = ref<{ id: string; nombre: string; unidadMedida: string }[]>([])
const productosIngredienteOpts = computed(() =>
  productosIngrediente.value.map(p => ({ label: p.nombre, value: p.id })),
)

const tiposOpts: Opt[] = [
  { label: 'Producto', value: 'producto' },
  { label: 'Servicio', value: 'servicio' },
  { label: 'Suscripción', value: 'suscripcion' },
  { label: 'Receta', value: 'receta' },
]

const unidadesMedidaStore = useUnidadesMedidaStore()
const unidadesMedidaOpts = computed(() => unidadesMedidaStore.opts)

const filtrosTipoOpts = [
  { label: 'Todos', value: 'todos' },
  { label: 'Productos', value: 'producto' },
  { label: 'Servicios', value: 'servicio' },
  { label: 'Suscripciones', value: 'suscripcion' },
]

// ── Formulario ─────────────────────────────────────────────────────────────

function emptyForm() {
  return {
    nombre: '',
    descripcion: '',
    precioBase: '',
    monedaId: '',
    categoriaId: '',
    tipo: 'producto',
    precioIncluyeImpuesto: false,
    activo: true,
    // producto
    stock: '0',
    costo: '',
    unidadMedida: 'unidad',
    modoInventario: 'cantidad',
    fechaElaboracion: '',
    fechaVencimiento: '',
    // series iniciales (modo serie)
    series: [] as SerieRow[],
    // lote inicial (modo lote)
    loteInicial: { codigoLote: '', fechaElaboracion: '', fechaVencimiento: '' },
    // servicio
    duracionEstimada: 0,
    requiereCita: false,
    // suscripción
    frecuencia: 'mensual',
    // ingredientes (modo receta)
    ingredientes: [] as IngredienteRow[],
    // reglas
    impuestosIds: [] as string[],
    recargosIds: [] as string[],
    descuentosIds: [] as string[],
  }
}

const form = ref(emptyForm())
const formCostoActual = ref<string | null>(null)

const drawerTitle = computed(() =>
  editingId.value ? 'Editar item' : 'Nuevo item',
)

const submitLabel = computed(() =>
  editingId.value ? 'Guardar cambios' : 'Crear item',
)

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
  form.value.monedaId = monedasOpts.value[0]?.value ?? ''
  formCostoActual.value = null
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

function emptyAjusteForm() {
  return {
    cantidad: '',
    tipo: 'entrada',
    motivo: 'ajuste_manual',
    comentario: '',
    costoUnitario: '',
    unidadCodigo: '',
    // modo serie — entrada: nueva series; salida: IDs seleccionados
    series: [] as SerieRow[],
    unidadIds: [] as string[],
    // modo lote — entrada: datos del lote; salida: loteId + cantidad
    loteId: '',
    loteCodigo: '',
    loteFechaElab: '',
    loteFechaVenc: '',
  }
}

const condicionOpts = [
  { label: 'Nuevo', value: 'nuevo' },
  { label: 'Usado', value: 'usado' },
  { label: 'Reacondicionado', value: 'reacondicionado' },
]
const ajusteForm = ref(emptyAjusteForm())

const ajusteTipoOpts = [
  { label: 'Entrada (sumar)', value: 'entrada' },
  { label: 'Salida (restar)', value: 'salida' },
]

const motivoOpts = [
  { label: 'Compra', value: 'compra' },
  { label: 'Devolución', value: 'devolucion' },
  { label: 'Merma', value: 'merma' },
  { label: 'Ajuste manual', value: 'ajuste_manual' },
]

// Historial (kardex)
const historialOpen = ref(false)
const historialLoading = ref(false)
const movimientos = ref<Movimiento[]>([])
const historialItemNombre = ref('')
const historialItemId = ref<string | null>(null)
const historialItemMonedaId = ref<string | undefined>(undefined)
const historialPage = ref(1)
const historialMeta = ref({ total: 0 })

async function cargarHistorial() {
  if (!historialItemId.value) return
  historialLoading.value = true
  try {
    const params = new URLSearchParams({
      itemId: historialItemId.value,
      page: String(historialPage.value),
      pageSize: String(pageSize.value),
    })
    const res = await useApiFetch<{ data: Movimiento[]; meta: { total: number } }>(
      `${apiUrl}/inventario/movimientos?${params.toString()}`,
    )
    movimientos.value = res.data
    historialMeta.value = res.meta
  } catch (e) {
    const msg = apiErrorMsg(e, 'Error al cargar historial')
    toast.add({ title: msg, color: 'error' })
  } finally {
    historialLoading.value = false
  }
}

watch(historialPage, cargarHistorial)

function menuAcciones(item: Item) {
  const grupos: any[][] = []

  if (item.tipo === 'producto') {
    const inventario: any[] = [
      {
        label: 'Ajustar stock',
        icon: 'i-lucide-arrow-up-down',
        onSelect: () => abrirAjusteStock(item),
      },
    ]
    if (item.modoInventario === 'serie' || item.modoInventario === 'lote') {
      inventario.push({
        label: item.modoInventario === 'serie' ? 'Ver unidades' : 'Ver lotes',
        icon: 'i-lucide-layout-grid',
        onSelect: () => abrirVerUnidades(item),
      })
    }
    inventario.push({
      label: 'Historial de movimientos',
      icon: 'i-lucide-clipboard-list',
      onSelect: () => abrirHistorial(item),
    })
    grupos.push(inventario)
  }

  grupos.push([
    {
      label: 'Eliminar',
      icon: 'i-lucide-trash-2',
      color: 'error',
      onSelect: () => confirmarEliminar(item.id),
    },
  ])

  return grupos
}

async function abrirVerUnidades(item: Item) {
  verUnidadesItem.value = item
  unidades.value = []
  lotes.value = []
  verUnidadesOpen.value = true
  verUnidadesLoading.value = true
  try {
    if (item.modoInventario === 'serie') {
      unidades.value = await useApiFetch<Unidad[]>(`${apiUrl}/items/${item.id}/unidades`)
    } else {
      lotes.value = await useApiFetch<Lote[]>(`${apiUrl}/items/${item.id}/lotes`)
    }
  } catch (e) {
    const msg = apiErrorMsg(e, 'Error al cargar')
    toast.add({ title: msg, color: 'error' })
  } finally {
    verUnidadesLoading.value = false
  }
}

async function abrirHistorial(item: Item) {
  historialItemNombre.value = item.nombre
  historialItemId.value = item.id
  historialItemMonedaId.value = item.monedaId
  movimientos.value = []
  historialMeta.value = { total: 0 }
  historialOpen.value = true
  if (historialPage.value !== 1) {
    historialPage.value = 1
  } else {
    await cargarHistorial()
  }
}

// ── Carga inicial ──────────────────────────────────────────────────────────

async function cargarCatalogos() {
  const monedasStore = useMonedasStore()
  try {
    await Promise.all([
      monedasStore.ensureLoaded(),
      unidadesMedidaStore.ensureLoaded(),
    ])
    const [categorias, impuestos, descuentos, recargos, productos] =
      await Promise.all([
        useApiFetch<any[]>(`${apiUrl}/categorias`),
        useApiFetch<any[]>(`${apiUrl}/impuestos`),
        useApiFetch<any[]>(`${apiUrl}/descuentos`),
        useApiFetch<any[]>(`${apiUrl}/recargos`),
        useApiFetch<PaginatedResponse<Item>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
      ])

    monedasOpts.value = monedasStore.monedasHabilitadas
      .map(m => ({ label: `${m.nombre} (${m.codigoIso})`, value: m.monedaId }))

    const defaultMoneda = monedasStore.monedaDefault
    if (defaultMoneda && !form.value.monedaId) {
      form.value.monedaId = defaultMoneda.monedaId
    }

    categoriasOpts.value = categorias
      .filter((c) => c.activo)
      .map((c) => ({ label: c.nombre, value: c.id }))

    impuestosOpts.value = impuestos
      .filter((i) => i.activo)
      .map((i) => ({ label: i.nombre, value: i.id }))

    descuentosOpts.value = descuentos
      .filter((d) => d.activo)
      .map((d) => ({ label: d.nombre, value: d.id }))

    recargosOpts.value = recargos
      .filter((r) => r.activo)
      .map((r) => ({ label: r.nombre, value: r.id }))

    productosIngrediente.value = productos.data
      .filter(p => p.modoInventario === 'cantidad')
      .map(p => ({ id: p.id, nombre: p.nombre, unidadMedida: p.unidadMedida ?? 'unidad' }))
  } catch {
    toast.add({ title: 'Error al cargar catálogos', color: 'error' })
  }
}

onMounted(cargarCatalogos)

// ── CRUD modal ─────────────────────────────────────────────────────────────

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

async function abrirEditar(item: Item) {
  resetDrawer()
  try {
    const detalle = await useApiFetch<Item>(`${apiUrl}/items/${item.id}`)
    editingId.value = item.id
    form.value = {
      nombre: detalle.nombre,
      descripcion: detalle.descripcion ?? '',
      precioBase: detalle.precioBase,
      monedaId: detalle.monedaId,
      categoriaId: detalle.categoriaId ?? '',
      tipo: detalle.tipo,
      precioIncluyeImpuesto: detalle.precioIncluyeImpuesto,
      activo: detalle.activo,
      stock: detalle.stock ?? '0',
      costo: detalle.costoActual ?? '',
      unidadMedida: detalle.unidadMedida ?? 'unidad',
      modoInventario: detalle.modoInventario ?? 'cantidad',
      fechaElaboracion: detalle.fechaElaboracion
        ? detalle.fechaElaboracion.slice(0, 10)
        : '',
      fechaVencimiento: detalle.fechaVencimiento
        ? detalle.fechaVencimiento.slice(0, 10)
        : '',
      series: [] as SerieRow[],
      loteInicial: { codigoLote: '', fechaElaboracion: '', fechaVencimiento: '' },
      duracionEstimada: detalle.duracionEstimada ?? 0,
      requiereCita: detalle.requiereCita ?? false,
      frecuencia: detalle.frecuencia ?? 'mensual',
      ingredientes: (detalle.ingredientes ?? []).map(i => ({
        ingredienteItemId: i.ingredienteItemId,
        cantidad: i.cantidad,
        unidadCodigo: i.unidadCodigo,
        bloqueante: i.bloqueante,
      })),
      impuestosIds: detalle.impuestosIds ?? [],
      recargosIds: detalle.recargosIds ?? [],
      descuentosIds: detalle.descuentosIds ?? [],
    }
    formCostoActual.value = detalle.costoActual ?? null
    drawerOpen.value = true
  } catch {
    toast.add({ title: 'Error al cargar detalle del item', color: 'error' })
  }
}

async function guardar() {
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      nombre: form.value.nombre,
      descripcion: form.value.descripcion || undefined,
      precioBase: form.value.precioBase,
      monedaId: form.value.monedaId,
      categoriaId: form.value.categoriaId || undefined,
      precioIncluyeImpuesto: form.value.precioIncluyeImpuesto,
      activo: form.value.activo,
      impuestosIds: form.value.impuestosIds,
      recargosIds: form.value.recargosIds,
      descuentosIds: form.value.descuentosIds,
    }

    if (!editingId.value) {
      payload.tipo = form.value.tipo
    }

    if (form.value.tipo === 'producto') {
      payload.unidadMedida = form.value.unidadMedida
      if (form.value.costo) payload.costo = form.value.costo
      if (form.value.fechaElaboracion) payload.fechaElaboracion = form.value.fechaElaboracion
      if (form.value.fechaVencimiento) payload.fechaVencimiento = form.value.fechaVencimiento
      if (!editingId.value) {
        payload.modoInventario = form.value.modoInventario
        if (form.value.modoInventario === 'cantidad') {
          payload.stock = form.value.stock || '0'
        } else if (form.value.modoInventario === 'serie') {
          payload.stock = String(form.value.series.length)
          if (form.value.series.length) payload.series = form.value.series
        } else if (form.value.modoInventario === 'lote') {
          payload.stock = form.value.stock || '0'
          if (form.value.loteInicial.codigoLote) payload.lote = form.value.loteInicial
        }
      } else {
        // En edición sólo mandamos modoInventario (el backend bloquea cambio si hay movimientos)
        payload.modoInventario = form.value.modoInventario
      }
    } else if (form.value.tipo === 'servicio') {
      payload.duracionEstimada = form.value.duracionEstimada || undefined
      payload.requiereCita = form.value.requiereCita
    } else if (form.value.tipo === 'receta') {
      payload.ingredientes = form.value.ingredientes
    } else {
      payload.frecuencia = form.value.frecuencia
    }

    if (editingId.value) {
      await useApiFetch(`${apiUrl}/items/${editingId.value}`, {
        method: 'PATCH',
        body: payload,
      })
      toast.add({ title: 'Item actualizado', color: 'success' })
    } else {
      await useApiFetch(`${apiUrl}/items`, {
        method: 'POST',
        body: payload,
      })
      toast.add({ title: 'Item creado', color: 'success' })
    }

    drawerOpen.value = false
    await fetchItems()
  } catch (e) {
    const msg = apiErrorMsg(e, 'Error al guardar')
    toast.add({ title: msg, color: 'error' })
  } finally {
    saving.value = false
  }
}

function confirmarEliminar(id: string) {
  confirmDeleteId.value = id
  confirmModalOpen.value = true
}

async function eliminar() {
  if (!confirmDeleteId.value) return
  try {
    await useApiFetch(`${apiUrl}/items/${confirmDeleteId.value}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Item eliminado', color: 'success' })
    confirmModalOpen.value = false
    await fetchItems()
  } catch (e) {
    const msg = apiErrorMsg(e, 'Error al eliminar')
    toast.add({ title: msg, color: 'error' })
  }
}

// ── Toggle activo (optimista) ──────────────────────────────────────────────

async function toggleActivo(item: Item) {
  if (toggling.has(item.id)) return
  toggling.add(item.id)
  const prev = item.activo
  item.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/items/${item.id}`, {
      method: 'PATCH',
      body: { activo: item.activo },
    })
  } catch {
    item.activo = prev
    toast.add({ title: 'Error al actualizar estado', color: 'error' })
  } finally {
    toggling.delete(item.id)
  }
}

// ── Ajuste de stock ────────────────────────────────────────────────────────

// Solo unidades de la misma magnitud que la del producto: convertir entre
// magnitudes exigiría densidad, y el backend lo rechaza.
const unidadesAjusteOpts = computed(() => {
  const magnitud = unidadesMedidaStore.magnitudDe(stockItem.value?.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: `${u.nombre} (${u.codigo})`, value: u.codigo }))
})

// El selector solo aporta si hay más de una unidad y el stock es fungible.
const mostrarSelectorUnidad = computed(() =>
  stockItem.value?.modoInventario === 'cantidad' && unidadesAjusteOpts.value.length > 1,
)

const conversionPreview = computed(() => {
  const base = stockItem.value?.unidadMedida
  const desde = ajusteForm.value.unidadCodigo
  const cantidad = ajusteForm.value.cantidad
  if (!base || !desde || !cantidad || desde === base) return null

  const uDesde = unidadesMedidaStore.getByCodigo(desde)
  const uBase = unidadesMedidaStore.getByCodigo(base)
  if (!uDesde || !uBase || uDesde.magnitud !== uBase.magnitud) return null

  try {
    const convertida = new Decimal(cantidad)
      .mul(uDesde.factorBase)
      .div(uBase.factorBase)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    return `${cantidad} ${desde} → ${formatStock(convertida.toString(), base)}`
  }
  catch {
    return null
  }
})

async function abrirAjusteStock(item: Item) {
  stockItem.value = item
  ajusteForm.value = emptyAjusteForm()
  ajusteForm.value.unidadCodigo = item.unidadMedida ?? ''
  unidadesDisponibles.value = []
  stockModalOpen.value = true
  if (item.modoInventario === 'serie') {
    try {
      unidadesDisponibles.value = await useApiFetch<Unidad[]>(
        `${apiUrl}/items/${item.id}/unidades?estado=disponible`,
      )
    } catch { /* continúa sin lista */ }
  }
}

async function ejecutarAjusteStock() {
  if (!stockItem.value) return
  ajustando.value = true
  try {
    const f = ajusteForm.value
    const modo = stockItem.value.modoInventario ?? 'cantidad'
    const body: Record<string, unknown> = {
      tipo: f.tipo,
      motivo: f.motivo,
      comentario: f.comentario || undefined,
    }
    if (f.tipo === 'entrada' && f.motivo === 'compra' && f.costoUnitario) {
      body.costoUnitario = f.costoUnitario
    }
    if (modo === 'cantidad') {
      body.cantidad = f.cantidad
      if (f.unidadCodigo && f.unidadCodigo !== stockItem.value.unidadMedida) {
        body.unidadCodigo = f.unidadCodigo
      }
    } else if (modo === 'serie') {
      if (f.tipo === 'entrada') {
        body.cantidad = String(f.series.length)
        body.series = f.series
      } else {
        body.cantidad = String(f.unidadIds.length)
        body.unidadIds = f.unidadIds
      }
    } else if (modo === 'lote') {
      body.cantidad = f.cantidad
      if (f.tipo === 'entrada') {
        body.lote = { codigoLote: f.loteCodigo, fechaElaboracion: f.loteFechaElab || undefined, fechaVencimiento: f.loteFechaVenc || undefined }
      } else {
        body.loteId = f.loteId
      }
    }
    const result = await useApiFetch<{ stock: string }>(
      `${apiUrl}/items/${stockItem.value.id}/stock`,
      { method: 'PATCH', body },
    )
    const item = items.value.find((i) => i.id === stockItem.value?.id)
    if (item) item.stock = result.stock
    toast.add({ title: `Stock actualizado: ${result.stock}`, color: 'success' })
    stockModalOpen.value = false
  } catch (e) {
    const msg = apiErrorMsg(e, 'Error al ajustar stock')
    toast.add({ title: msg, color: 'error' })
  } finally {
    ajustando.value = false
  }
}

// ── Tablas (UTable) ────────────────────────────────────────────────────────

function onSelectItem(_e: Event, row: Row<Item>) {
  abrirEditar(row.original)
}

const columnsItems: TableColumn<Item>[] = [
  { accessorKey: 'tipo', header: 'Tipo' },
  { accessorKey: 'nombre', header: 'Item' },
  { id: 'controles', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const columnsUnidades: TableColumn<Unidad>[] = [
  { accessorKey: 'serie', header: 'Nro Serie' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'condicion', header: 'Condición' },
  { accessorKey: 'garantiaHasta', header: 'Garantía hasta' },
  { accessorKey: 'codigoLote', header: 'Lote' },
]

const columnsLotes: TableColumn<Lote>[] = [
  { accessorKey: 'codigoLote', header: 'Código' },
  { accessorKey: 'cantidadInicial', header: 'Inicial', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'cantidadDisponible', header: 'Disponible', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'fechaElaboracion', header: 'Elaboración' },
  { accessorKey: 'fechaVencimiento', header: 'Vencimiento' },
  { accessorKey: 'id', header: 'ID' },
]

function loteSinDisponibilidad(l: Lote): boolean {
  return l.cantidadDisponible === '0' || l.cantidadDisponible === '0.0000'
}

const tipoLabels: Record<string, string> = {
  producto: 'Producto',
  servicio: 'Servicio',
  suscripcion: 'Suscripción',
}
const tipoColors: Record<string, 'primary' | 'secondary' | 'info'> = {
  producto: 'primary',
  servicio: 'secondary',
  suscripcion: 'info',
}

const columnsHistorial: TableColumn<Movimiento>[] = [
  { accessorKey: 'creadoEl', header: 'Fecha' },
  { accessorKey: 'tipo', header: 'Tipo' },
  { accessorKey: 'motivo', header: 'Motivo' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'costoUnitario', header: 'Costo unitario', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'stockResultante', header: 'Resultante', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'usuarioNombre', header: 'Usuario' },
]
</script>

<template>
  <div class="space-y-6">
    <!-- Cabecera -->
    <CrudPageHeader
      large
      title="Items"
      description="Productos, servicios y suscripciones del catálogo"
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirCrear">Nuevo item</UButton>
      </template>
    </CrudPageHeader>

    <!-- Filtros -->
    <div class="flex flex-wrap items-center gap-3">
      <UInput
        v-model="busqueda"
        icon="i-lucide-search"
        placeholder="Buscar por nombre o descripción..."
        class="min-w-48 flex-1 max-w-md"
      />
      <USelectMenu
        v-model="filtroTipo"
        :items="filtrosTipoOpts"
        value-key="value"
        class="w-44"
        placeholder="Filtrar por tipo"
      />
      <UButton
        v-if="hayFiltrosActivos"
        label="Limpiar filtros"
        icon="i-lucide-x"
        variant="ghost"
        color="neutral"
        size="sm"
        @click="limpiarFiltros"
      />
    </div>

    <!-- Lista -->
    <CrudTable
      :data="items"
      :columns="columnsItems"
      :loading="loading"
      :ui="{ tr: 'cursor-pointer' }"
      @select="onSelectItem"
    >
        <template #tipo-cell="{ row }">
          <UBadge
            :label="tipoLabels[row.original.tipo] ?? row.original.tipo"
            :color="tipoColors[row.original.tipo] ?? 'neutral'"
            variant="subtle"
            size="sm"
          />
        </template>

        <template #nombre-cell="{ row }">
          <div class="min-w-0">
            <span class="font-medium truncate block">{{ row.original.nombre }}</span>
            <div class="text-sm text-muted mt-0.5 flex flex-wrap items-center gap-3">
              <span class="font-mono">{{ formatMonto(row.original.precioBase, row.original.monedaId) }}</span>
              <span v-if="row.original.categoriaNombre">· {{ row.original.categoriaNombre }}</span>
              <span v-if="row.original.tipo === 'producto' && row.original.stock !== null">
                · Stock: {{ row.original.stock }}
                <span v-if="row.original.modoInventario === 'serie'">(unidades)</span>
                <span v-else-if="row.original.modoInventario === 'lote'">(lotes)</span>
                <span v-else>{{ row.original.unidadMedida }}</span>
              </span>
              <span v-if="row.original.tipo === 'producto'" class="font-mono">
                · Costo: {{ row.original.costoActual ? formatMonto(row.original.costoActual, row.original.monedaId) : '—' }}
              </span>
              <UBadge
                v-if="row.original.tipo === 'producto' && row.original.modoInventario && row.original.modoInventario !== 'cantidad'"
                :label="row.original.modoInventario"
                color="secondary"
                variant="soft"
                size="xs"
              />
              <span v-if="row.original.tipo === 'servicio' && row.original.duracionEstimada">
                · {{ row.original.duracionEstimada }} min
              </span>
              <span v-if="row.original.tipo === 'suscripcion' && row.original.frecuencia">
                · Cobro {{ row.original.frecuencia }}
              </span>
            </div>
          </div>
        </template>

        <template #controles-cell="{ row }">
          <div class="flex items-center justify-end gap-1">
            <USwitch
              :model-value="row.original.activo"
              :disabled="toggling.has(row.original.id)"
              size="sm"
              @update:model-value="toggleActivo(row.original)"
            />
            <UButton
              icon="i-lucide-square-pen"
              color="neutral"
              variant="ghost"
              size="sm"
              title="Editar"
              @click="abrirEditar(row.original)"
            />
            <UDropdownMenu :items="menuAcciones(row.original)">
              <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="sm"
                title="Más acciones"
              />
            </UDropdownMenu>
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          <UIcon name="i-lucide-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
          {{
            hayFiltrosActivos
              ? 'Ningún item coincide con los filtros.'
              : 'No hay items. Crea el primero con el botón de arriba.'
          }}
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

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="item-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <!-- Campos base -->
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Nombre" class="col-span-2" required>
              <UInput
                v-model="form.nombre"
                placeholder="Nombre del item"
                class="w-full"
                autofocus
              />
            </UFormField>

            <UFormField label="Descripción" class="col-span-2">
              <UInput v-model="form.descripcion" placeholder="Descripción opcional" class="w-full" />
            </UFormField>

            <UFormField label="Precio base" required>
              <MoneyInput v-model="form.precioBase" :moneda-id="form.monedaId" class="w-full" />
            </UFormField>

            <UFormField label="Moneda" required>
              <USelectMenu
                v-model="form.monedaId"
                :items="monedasOpts"
                value-key="value"
                placeholder="Selecciona moneda"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Categoría">
              <USelectMenu
                v-model="form.categoriaId"
                :items="categoriasOpts"
                value-key="value"
                placeholder="Sin categoría"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Tipo" required>
              <USelectMenu
                v-model="form.tipo"
                :items="tiposOpts"
                value-key="value"
                :disabled="!!editingId"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Precio incluye impuesto">
              <USwitch v-model="form.precioIncluyeImpuesto" />
            </UFormField>

            <UFormField label="Activo">
              <USwitch v-model="form.activo" />
            </UFormField>
          </div>

          <!-- Extensión producto -->
          <template v-if="form.tipo === 'producto'">
            <USeparator />
            <div class="space-y-4">
              <p class="text-sm font-medium text-muted">Datos de producto</p>
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="Unidad de medida">
                  <USelectMenu
                    v-model="form.unidadMedida"
                    :items="unidadesMedidaOpts"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Modo inventario">
                  <USelectMenu
                    v-model="form.modoInventario"
                    :items="[
                      { label: 'Cantidad (fungible)', value: 'cantidad' },
                      { label: 'Nro Serie (un ID por unidad)', value: 'serie' },
                      { label: 'Lote (por fecha de vencimiento)', value: 'lote' },
                    ]"
                    value-key="value"
                    :disabled="!!editingId"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Costo">
                  <MoneyInput v-model="form.costo" :moneda-id="form.monedaId" class="w-full" />
                </UFormField>
              </div>

              <!-- Modo cantidad: stock inicial + fechas genéricas -->
              <template v-if="form.modoInventario === 'cantidad'">
                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="Stock inicial">
                    <UInput v-model="form.stock" inputmode="decimal" placeholder="0" class="w-full" />
                  </UFormField>
                  <UFormField label="Fecha elaboración">
                    <UInput v-model="form.fechaElaboracion" type="date" class="w-full" />
                  </UFormField>
                  <UFormField label="Fecha vencimiento">
                    <UInput v-model="form.fechaVencimiento" type="date" class="w-full" />
                  </UFormField>
                </div>
              </template>

              <!-- Modo serie: lista de unidades iniciales -->
              <template v-if="form.modoInventario === 'serie' && !editingId">
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <p class="text-sm text-muted">Unidades iniciales ({{ form.series.length }})</p>
                    <UButton
                      size="xs"
                      variant="ghost"
                      icon="i-lucide-plus"
                      @click="form.series = [...form.series, { serie: '', condicion: 'nuevo', garantiaHasta: '' }]"
                    >Agregar</UButton>
                  </div>
                  <div
                    v-for="(s, idx) in form.series"
                    :key="idx"
                    class="grid grid-cols-3 gap-2 items-end"
                  >
                    <UFormField label="Nro Serie">
                      <UInput v-model="form.series[idx].serie" placeholder="IMEI o código" class="w-full" />
                    </UFormField>
                    <UFormField label="Condición">
                      <USelectMenu
                        v-model="form.series[idx].condicion"
                        :items="condicionOpts"
                        value-key="value"
                        class="w-full"
                      />
                    </UFormField>
                    <div class="flex gap-2">
                      <UFormField label="Garantía hasta" class="flex-1">
                        <UInput v-model="form.series[idx].garantiaHasta" type="date" class="w-full" />
                      </UFormField>
                      <UButton
                        color="error"
                        variant="ghost"
                        icon="i-lucide-trash-2"
                        size="sm"
                        class="self-end"
                        @click="form.series = form.series.filter((_, i) => i !== idx)"
                      />
                    </div>
                  </div>
                </div>
              </template>

              <!-- Modo lote: primer lote inicial -->
              <template v-if="form.modoInventario === 'lote' && !editingId">
                <div class="space-y-2">
                  <p class="text-sm text-muted">Lote inicial (opcional — puedes agregar luego via ajuste)</p>
                  <div class="grid grid-cols-2 gap-4">
                    <UFormField label="Código de lote">
                      <UInput v-model="form.loteInicial.codigoLote" placeholder="LOT-001" class="w-full" />
                    </UFormField>
                    <UFormField label="Cantidad">
                      <UInput v-model="form.stock" inputmode="decimal" placeholder="0" class="w-full" />
                    </UFormField>
                    <UFormField label="Fecha elaboración">
                      <UInput v-model="form.loteInicial.fechaElaboracion" type="date" class="w-full" />
                    </UFormField>
                    <UFormField label="Fecha vencimiento">
                      <UInput v-model="form.loteInicial.fechaVencimiento" type="date" class="w-full" />
                    </UFormField>
                  </div>
                </div>
              </template>
            </div>
          </template>

          <!-- Extensión servicio -->
          <template v-if="form.tipo === 'servicio'">
            <USeparator />
            <div>
              <p class="text-sm font-medium text-muted mb-3">Datos de servicio</p>
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="Duración estimada (min)">
                  <UInput v-model="form.duracionEstimada" type="number" placeholder="60" class="w-full" />
                </UFormField>
                <UFormField label="Requiere cita">
                  <USwitch v-model="form.requiereCita" />
                </UFormField>
              </div>
            </div>
          </template>

          <!-- Extensión receta -->
          <template v-if="form.tipo === 'receta'">
            <USeparator />
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-muted">Ingredientes ({{ form.ingredientes.length }})</p>
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-plus"
                  @click="form.ingredientes = [...form.ingredientes, { ingredienteItemId: '', cantidad: '', unidadCodigo: '', bloqueante: true }]"
                >Agregar ingrediente</UButton>
              </div>

              <div
                v-for="(ing, idx) in form.ingredientes"
                :key="idx"
                class="grid grid-cols-5 gap-2 items-end"
              >
                <UFormField label="Producto" class="col-span-2">
                  <USelectMenu
                    v-model="form.ingredientes[idx].ingredienteItemId"
                    :items="productosIngredienteOpts"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Cantidad">
                  <UInput v-model="form.ingredientes[idx].cantidad" inputmode="decimal" placeholder="0" class="w-full" />
                </UFormField>
                <UFormField label="Unidad">
                  <USelectMenu
                    v-model="form.ingredientes[idx].unidadCodigo"
                    :items="unidadesMedidaStore.unidades
                      .filter(u => u.magnitud === unidadesMedidaStore.magnitudDe(
                        productosIngrediente.find(p => p.id === form.ingredientes[idx].ingredienteItemId)?.unidadMedida,
                      ))
                      .map(u => ({ label: u.codigo, value: u.codigo }))"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <div class="flex items-end gap-2">
                  <UFormField label="Bloqueante">
                    <USwitch v-model="form.ingredientes[idx].bloqueante" />
                  </UFormField>
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    size="sm"
                    @click="form.ingredientes = form.ingredientes.filter((_, i) => i !== idx)"
                  />
                </div>
              </div>

              <p v-if="editingId && formCostoActual" class="text-xs text-muted">
                Costo actual: {{ formatMonto(formCostoActual, form.monedaId) }}
              </p>
              <p v-else-if="!editingId" class="text-xs text-muted">
                El costo se calcula al guardar, sumando el costo de cada ingrediente.
              </p>
            </div>
          </template>

          <!-- Extensión suscripción -->
          <template v-if="form.tipo === 'suscripcion'">
            <USeparator />
            <div>
              <p class="text-sm font-medium text-muted mb-3">Datos de suscripción</p>
              <UFormField label="Frecuencia de cobro" required>
                <USelectMenu
                  v-model="form.frecuencia"
                  :items="[
                    { label: 'Semanal', value: 'semanal' },
                    { label: 'Quincenal', value: 'quincenal' },
                    { label: 'Mensual', value: 'mensual' },
                  ]"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>
              <p class="text-xs text-muted mt-2">
                El precio del item es el precio por período. El cliente elige su día de cobro al suscribirse.
              </p>
            </div>
          </template>

          <!-- Reglas asociadas -->
          <USeparator />
          <div class="space-y-3">
            <p class="text-sm font-medium text-muted">Reglas asociadas</p>

            <UFormField label="Impuestos">
              <USelectMenu
                v-model="form.impuestosIds"
                :items="impuestosOpts"
                value-key="value"
                multiple
                placeholder="Sin impuestos"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Descuentos">
              <USelectMenu
                v-model="form.descuentosIds"
                :items="descuentosOpts"
                value-key="value"
                multiple
                placeholder="Sin descuentos"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Recargos">
              <USelectMenu
                v-model="form.recargosIds"
                :items="recargosOpts"
                value-key="value"
                multiple
                placeholder="Sin recargos"
                class="w-full"
              />
            </UFormField>
          </div>
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
          form="item-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar item"
      message="¿Estás seguro de que deseas eliminar este item? Esta acción no se puede deshacer."
      @confirm="eliminar"
    />

    <!-- Modal ajuste de stock -->
    <UModal v-model:open="stockModalOpen" title="Ajustar stock" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <div class="space-y-4">
          <!-- Tipo + motivo + comentario (común a todos los modos) -->
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Tipo de movimiento" required>
              <USelectMenu
                v-model="ajusteForm.tipo"
                :items="ajusteTipoOpts"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Motivo" required>
              <USelectMenu
                v-model="ajusteForm.motivo"
                :items="motivoOpts"
                value-key="value"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField label="Comentario">
            <UInput v-model="ajusteForm.comentario" placeholder="Opcional" class="w-full" />
          </UFormField>

          <UFormField
            v-if="ajusteForm.tipo === 'entrada' && ajusteForm.motivo === 'compra'"
            label="Costo unitario"
          >
            <MoneyInput v-model="ajusteForm.costoUnitario" :moneda-id="stockItem?.monedaId" class="w-full" />
          </UFormField>

          <!-- Modo cantidad: cantidad + unidad opcional -->
          <template v-if="stockItem?.modoInventario === 'cantidad' || !stockItem?.modoInventario">
            <UFormField label="Cantidad" required>
              <UInput v-model="ajusteForm.cantidad" inputmode="decimal" placeholder="0" class="w-full" />
            </UFormField>
            <UFormField v-if="mostrarSelectorUnidad" label="Unidad">
              <USelectMenu
                v-model="ajusteForm.unidadCodigo"
                :items="unidadesAjusteOpts"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <p v-if="conversionPreview" class="text-sm text-muted">
              {{ conversionPreview }}
            </p>
          </template>

          <!-- Modo serie -->
          <template v-if="stockItem?.modoInventario === 'serie'">
            <!-- Entrada serie: capturar nuevas series -->
            <template v-if="ajusteForm.tipo === 'entrada'">
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <p class="text-sm text-muted">Series a ingresar ({{ ajusteForm.series.length }})</p>
                  <UButton
                    size="xs"
                    variant="ghost"
                    icon="i-lucide-plus"
                    @click="ajusteForm.series = [...ajusteForm.series, { serie: '', condicion: 'nuevo', garantiaHasta: '' }]"
                  >Agregar</UButton>
                </div>
                <div
                  v-for="(s, idx) in ajusteForm.series"
                  :key="idx"
                  class="grid grid-cols-3 gap-2 items-end"
                >
                  <UFormField label="Nro Serie">
                    <UInput v-model="ajusteForm.series[idx].serie" placeholder="IMEI o código" class="w-full" />
                  </UFormField>
                  <UFormField label="Condición">
                    <USelectMenu
                      v-model="ajusteForm.series[idx].condicion"
                      :items="condicionOpts"
                      value-key="value"
                      class="w-full"
                    />
                  </UFormField>
                  <div class="flex gap-2">
                    <UFormField label="Garantía hasta" class="flex-1">
                      <UInput v-model="ajusteForm.series[idx].garantiaHasta" type="date" class="w-full" />
                    </UFormField>
                    <UButton
                      color="error"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      size="sm"
                      class="self-end"
                      @click="ajusteForm.series = ajusteForm.series.filter((_, i) => i !== idx)"
                    />
                  </div>
                </div>
              </div>
            </template>

            <!-- Salida serie: seleccionar unidades disponibles -->
            <template v-if="ajusteForm.tipo === 'salida'">
              <div class="space-y-2">
                <p class="text-sm text-muted">
                  Selecciona unidades a dar de baja ({{ ajusteForm.unidadIds.length }} seleccionadas)
                </p>
                <div v-if="!unidadesDisponibles.length" class="text-sm text-muted py-2">
                  Sin unidades disponibles.
                </div>
                <div
                  v-for="u in unidadesDisponibles"
                  :key="u.id"
                  class="flex items-center gap-3 py-1.5 border-b border-default"
                >
                  <input
                    type="checkbox"
                    :value="u.id"
                    :checked="ajusteForm.unidadIds.includes(u.id)"
                    class="w-4 h-4"
                    @change="ajusteForm.unidadIds = ajusteForm.unidadIds.includes(u.id)
                      ? ajusteForm.unidadIds.filter(id => id !== u.id)
                      : [...ajusteForm.unidadIds, u.id]"
                  />
                  <span class="font-mono text-sm flex-1">{{ u.serie }}</span>
                  <UBadge :label="u.condicion" variant="subtle" size="sm" />
                  <span v-if="u.garantiaHasta" class="text-xs text-muted">
                    garantía {{ new Date(u.garantiaHasta).toLocaleDateString() }}
                  </span>
                </div>
              </div>
            </template>
          </template>

          <!-- Modo lote -->
          <template v-if="stockItem?.modoInventario === 'lote'">
            <!-- Entrada lote: nuevo o existente + cantidad -->
            <template v-if="ajusteForm.tipo === 'entrada'">
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="Código de lote" required>
                  <UInput v-model="ajusteForm.loteCodigo" placeholder="LOT-001" class="w-full" />
                </UFormField>
                <UFormField label="Cantidad" required>
                  <UInput v-model="ajusteForm.cantidad" inputmode="decimal" placeholder="0" class="w-full" />
                </UFormField>
                <UFormField label="Fecha elaboración">
                  <UInput v-model="ajusteForm.loteFechaElab" type="date" class="w-full" />
                </UFormField>
                <UFormField label="Fecha vencimiento">
                  <UInput v-model="ajusteForm.loteFechaVenc" type="date" class="w-full" />
                </UFormField>
              </div>
            </template>

            <!-- Salida lote: elegir lote + cantidad -->
            <template v-if="ajusteForm.tipo === 'salida'">
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="Lote ID" required>
                  <UInput v-model="ajusteForm.loteId" placeholder="UUID del lote" class="w-full" />
                </UFormField>
                <UFormField label="Cantidad a retirar" required>
                  <UInput v-model="ajusteForm.cantidad" inputmode="decimal" placeholder="0" class="w-full" />
                </UFormField>
              </div>
              <p class="text-xs text-muted">
                Usa el botón "Ver lotes" en la lista para copiar el ID del lote.
              </p>
            </template>
          </template>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="stockModalOpen = false">
            Cancelar
          </UButton>
          <UButton :loading="ajustando" @click="ejecutarAjusteStock">
            Aplicar ajuste
          </UButton>
        </div>
      </template>
    </UModal>
    <!-- Modal ver unidades / lotes -->
    <UModal
      v-model:open="verUnidadesOpen"
      :title="verUnidadesItem?.modoInventario === 'serie' ? `Unidades — ${verUnidadesItem?.nombre}` : `Lotes — ${verUnidadesItem?.nombre}`"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <!-- Tabla unidades (modo serie) -->
        <UTable
          v-if="verUnidadesItem?.modoInventario === 'serie'"
          :data="unidades"
          :columns="columnsUnidades"
          :loading="verUnidadesLoading"
        >
          <template #serie-cell="{ row }">
            <span class="font-mono">{{ row.original.serie }}</span>
          </template>
          <template #estado-cell="{ row }">
            <UBadge
              :label="row.original.estado"
              :color="row.original.estado === 'disponible' ? 'success' : row.original.estado === 'vendido' ? 'neutral' : 'warning'"
              variant="subtle"
              size="sm"
            />
          </template>
          <template #garantiaHasta-cell="{ row }">
            {{ row.original.garantiaHasta ? new Date(row.original.garantiaHasta).toLocaleDateString() : '—' }}
          </template>
          <template #codigoLote-cell="{ row }">
            <span class="text-xs text-muted">{{ row.original.codigoLote ?? '—' }}</span>
          </template>
          <template #empty>
            <div class="py-8 text-center text-sm text-muted">Sin unidades registradas.</div>
          </template>
        </UTable>

        <!-- Tabla lotes (modo lote) -->
        <UTable
          v-else
          :data="lotes"
          :columns="columnsLotes"
          :loading="verUnidadesLoading"
          :meta="{ class: { tr: (row: Row<Lote>) => loteSinDisponibilidad(row.original) ? 'opacity-50' : '' } }"
        >
          <template #codigoLote-cell="{ row }">
            <span class="font-medium">{{ row.original.codigoLote }}</span>
          </template>
          <template #cantidadDisponible-cell="{ row }">
            <span class="font-medium">{{ row.original.cantidadDisponible }}</span>
          </template>
          <template #fechaElaboracion-cell="{ row }">
            {{ row.original.fechaElaboracion ? new Date(row.original.fechaElaboracion).toLocaleDateString() : '—' }}
          </template>
          <template #fechaVencimiento-cell="{ row }">
            {{ row.original.fechaVencimiento ? new Date(row.original.fechaVencimiento).toLocaleDateString() : '—' }}
          </template>
          <template #id-cell="{ row }">
            <span class="font-mono text-xs text-muted select-all">{{ row.original.id }}</span>
          </template>
          <template #empty>
            <div class="py-8 text-center text-sm text-muted">Sin lotes registrados.</div>
          </template>
        </UTable>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton color="neutral" variant="ghost" @click="verUnidadesOpen = false">Cerrar</UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal historial de inventario -->
    <UModal
      v-model:open="historialOpen"
      :title="`Historial — ${historialItemNombre}`"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <UTable :data="movimientos" :columns="columnsHistorial" :loading="historialLoading">
          <template #creadoEl-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatFecha(row.original.creadoEl) }}</span>
          </template>
          <template #tipo-cell="{ row }">
            <UBadge
              :label="row.original.tipo === 'entrada' ? 'Entrada' : 'Salida'"
              :color="row.original.tipo === 'entrada' ? 'success' : 'warning'"
              variant="subtle"
              size="sm"
            />
          </template>
          <template #costoUnitario-cell="{ row }">
            <span class="font-mono">
              {{ row.original.costoUnitario ? formatMonto(row.original.costoUnitario, historialItemMonedaId) : '—' }}
            </span>
          </template>
          <template #stockResultante-cell="{ row }">
            <span class="font-medium">{{ row.original.stockResultante }}</span>
          </template>
          <template #usuarioNombre-cell="{ row }">
            {{ row.original.usuarioNombre ?? '—' }}
          </template>
          <template #empty>
            <div class="py-8 text-center text-sm text-muted">Sin movimientos registrados.</div>
          </template>
        </UTable>
        <div v-if="historialMeta.total > pageSize" class="flex justify-end pt-4">
          <UPagination
            v-model:page="historialPage"
            :items-per-page="pageSize"
            :total="historialMeta.total"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton color="neutral" variant="ghost" @click="historialOpen = false">Cerrar</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
