<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Row } from '@tanstack/vue-table'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type {
  AplicarDesfaseItem,
  DesfaseRecetaDto,
} from '~/components/RecetasDesfasesPanel.vue'
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
  clasificacionTributaria?: 'afecto' | 'exento'
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
  extrasPermitidos?: { ingredienteItemId: string; ingredienteNombre?: string; cantidad: string; unidadCodigo: string; precioExtra: string }[]
  componentes?: { componenteItemId: string; componenteNombre?: string; tipo?: string; cantidad: string; bloqueante: boolean; stock?: string | null }[]
  grupos?: {
    grupoModificadorId: string
    nombre: string
    min: number
    max: number
    orden: number
    opciones: { grupoOpcionId: string; itemId: string; itemNombre: string; tipo: string; cantidad: string | null; cantidadDefault: string | null; unidadCodigo: string | null; precioExtra: string; orden: number; stock: string | null; esPendiente: boolean }[]
  }[]
  disponible?: number | null
}

interface IngredienteRow {
  ingredienteItemId: string
  cantidad: string
  unidadCodigo: string
  bloqueante: boolean
}

interface ComponenteRow {
  componenteItemId: string
  cantidad: string
  bloqueante: boolean
}

interface GrupoOpcionOverrideRow {
  grupoOpcionId: string
  itemNombre: string
  cantidad: string // efectiva (pre-llenada con default; '' = pendiente)
  cantidadDefault: string | null
  unidadCodigo?: string
  precioExtra: string
  esPendiente: boolean
}

interface GrupoAsocRow {
  grupoModificadorId: string
  min: string
  max: string
  orden: string
  opciones: GrupoOpcionOverrideRow[]
}

interface ExtraPermitidoRow {
  ingredienteItemId: string
  cantidad: string
  unidadCodigo: string
  precioExtra: string
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

// Simulador de impacto de costos en recetas
const desfasesOpen = ref(false)
const desfasesLoading = ref(false)
const desfasesFilas = ref<DesfaseRecetaDto[]>([])
const desfasesHighlightId = ref<string | null>(null)
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

	const productosIngrediente = ref<{
	  id: string
	  nombre: string
	  unidadMedida: string
	  costoActual: string | null
	}[]>([])
	const productosIngredienteOpts = computed(() =>
	  productosIngrediente.value.map(p => ({ label: p.nombre, value: p.id })),
	)

	const itemsVendibles = ref<{ id: string; nombre: string; tipo: string; costoActual: string | null }[]>([])
	const itemsVendiblesOpts = computed(() =>
	  itemsVendibles.value.map(i => ({ label: `${i.nombre} (${i.tipo})`, value: i.id })),
	)
	async function cargarItemsVendibles() {
	  try {
	    const [p, r, s] = await Promise.all([
	      useApiFetch<PaginatedResponse<Item>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
	      useApiFetch<PaginatedResponse<Item>>(`${apiUrl}/items?tipo=receta&pageSize=100`),
	      useApiFetch<PaginatedResponse<Item>>(`${apiUrl}/items?tipo=servicio&pageSize=100`),
	    ])
	    itemsVendibles.value = [...p.data, ...r.data, ...s.data]
	      .map(i => ({ id: i.id, nombre: i.nombre, tipo: i.tipo, costoActual: i.costoActual ?? null }))
	  } catch {
	    toast.add({ title: 'Error al cargar items para combos', color: 'error' })
	  }
	}

	const gruposCatalogo = ref<{ grupoModificadorId: string; nombre: string; familia: string; opciones: { grupoOpcionId: string; itemNombre: string; cantidad: string | null; unidadCodigo: string | null; precioExtra: string }[] }[]>([])
	const gruposCatalogoOpts = computed(() =>
	  gruposCatalogo.value.map(g => ({ label: `${g.nombre} (${g.familia})`, value: g.grupoModificadorId })),
	)
	async function cargarGruposCatalogo() {
	  try {
	    gruposCatalogo.value = await useApiFetch<typeof gruposCatalogo.value>(`${apiUrl}/grupos-modificadores`)
	  } catch {
	    toast.add({ title: 'Error al cargar grupos de modificadores', color: 'error' })
	  }
	}

	/** Al elegir un grupo en el form de item: pre-llena la tabla de overrides con el default de cada opción. */
	function onSelectGrupo(idx: number, grupoId: string) {
	  const catalogo = gruposCatalogo.value.find(g => g.grupoModificadorId === grupoId)
	  form.value.gruposModificadores[idx]!.opciones = (catalogo?.opciones ?? []).map(o => ({
	    grupoOpcionId: o.grupoOpcionId,
	    itemNombre: o.itemNombre,
	    cantidad: o.cantidad ?? '',
	    cantidadDefault: o.cantidad,
	    unidadCodigo: o.unidadCodigo ?? undefined,
	    precioExtra: o.precioExtra,
	    esPendiente: o.cantidad === null,
	  }))
	}

	/** Sin re-fetch: el POST/PATCH devuelve el item y se mergea en estado local. */
	function itemCoincideFiltros(item: Item): boolean {
	  const tipo = listFilters.value.tipo
	  if (tipo && item.tipo !== tipo) return false
	  const search = listFilters.value.search?.toLowerCase()
	  if (search && !item.nombre.toLowerCase().includes(search)) return false
	  return true
	}

	function upsertItemEnLista(item: Item, isNew: boolean) {
	  const idx = items.value.findIndex(i => i.id === item.id)
	  if (!itemCoincideFiltros(item)) {
	    if (idx >= 0) {
	      items.value = items.value.filter(i => i.id !== item.id)
	      meta.value = { ...meta.value, total: Math.max(0, meta.value.total - 1) }
	    }
	    return
	  }
	  if (idx >= 0) {
	    items.value[idx] = { ...items.value[idx], ...item }
	    return
	  }
	  if (isNew) {
	    items.value = [item, ...items.value]
	    meta.value = { ...meta.value, total: meta.value.total + 1 }
	  }
	}

	function syncProductoIngrediente(item: Item) {
	  if (item.tipo !== 'ingrediente') return
	  const entry = {
	    id: item.id,
	    nombre: item.nombre,
	    unidadMedida: item.unidadMedida ?? 'unidad',
	    costoActual: item.costoActual ?? null,
	  }
	  const idx = productosIngrediente.value.findIndex(p => p.id === item.id)
	  if (idx >= 0) {
	    productosIngrediente.value[idx] = entry
	  }
	  else {
	    productosIngrediente.value = [...productosIngrediente.value, entry]
	      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
	  }
	}

	function syncItemVendible(item: Item) {
	  if (!['producto', 'receta', 'servicio'].includes(item.tipo)) return
	  const entry = { id: item.id, nombre: item.nombre, tipo: item.tipo, costoActual: item.costoActual ?? null }
	  const idx = itemsVendibles.value.findIndex(i => i.id === item.id)
	  if (idx >= 0) {
	    itemsVendibles.value[idx] = entry
	  }
	  else {
	    itemsVendibles.value = [...itemsVendibles.value, entry]
	      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
	  }
	}

	function removeItemLocal(id: string) {
	  const idx = items.value.findIndex(i => i.id === id)
	  if (idx >= 0) {
	    items.value = items.value.filter(i => i.id !== id)
	    meta.value = { ...meta.value, total: Math.max(0, meta.value.total - 1) }
	  }
	  productosIngrediente.value = productosIngrediente.value.filter(p => p.id !== id)
	  itemsVendibles.value = itemsVendibles.value.filter(i => i.id !== id)
	}

const tiposOpts: Opt[] = [
  { label: 'Producto', value: 'producto' },
  { label: 'Ingrediente', value: 'ingrediente' },
  { label: 'Servicio', value: 'servicio' },
  { label: 'Suscripción', value: 'suscripcion' },
  { label: 'Receta', value: 'receta' },
  { label: 'Combo', value: 'combo' },
]

const unidadesMedidaStore = useUnidadesMedidaStore()
const unidadesMedidaOpts = computed(() => unidadesMedidaStore.opts)

const filtrosTipoOpts = [
  { label: 'Todos', value: 'todos' },
  { label: 'Productos', value: 'producto' },
  { label: 'Ingredientes', value: 'ingrediente' },
  { label: 'Servicios', value: 'servicio' },
  { label: 'Suscripciones', value: 'suscripcion' },
  { label: 'Recetas', value: 'receta' },
  { label: 'Combos', value: 'combo' },
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
    extrasPermitidos: [] as ExtraPermitidoRow[],
    // componentes (modo combo)
    componentes: [] as ComponenteRow[],
    // grupos de modificadores (modo combo | receta)
    gruposModificadores: [] as GrupoAsocRow[],
    // reglas
    clasificacionTributaria: 'afecto' as 'afecto' | 'exento',
    impuestosIds: [] as string[],
    recargosIds: [] as string[],
    descuentosIds: [] as string[],
  }
}

const form = ref(emptyForm())
const formCostoActual = ref<string | null>(null)

/** Misma aritmética que el backend: cantidad → unidad base del insumo × costo_actual. */
function convertirCantidadABase(
  cantidad: string,
  desdeCodigo: string,
  haciaCodigo: string,
): Decimal | null {
  if (desdeCodigo === haciaCodigo) {
    try {
      return new Decimal(cantidad)
    } catch {
      return null
    }
  }
  const uDesde = unidadesMedidaStore.getByCodigo(desdeCodigo)
  const uHacia = unidadesMedidaStore.getByCodigo(haciaCodigo)
  if (!uDesde || !uHacia || uDesde.magnitud !== uHacia.magnitud) return null
  try {
    return new Decimal(cantidad)
      .mul(uDesde.factorBase)
      .div(uHacia.factorBase)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
  } catch {
    return null
  }
}

/** Preview en vivo del costo de receta al agregar/quitar/cambiar ingredientes. */
const costoRecetaCalculado = computed((): string | null => {
  if (form.value.tipo !== 'receta') return null
  const ings = form.value.ingredientes
  if (!ings.length) return '0'

  let total = new Decimal(0)
  let algunaCompleta = false
  for (const ing of ings) {
    if (!ing.ingredienteItemId || !ing.cantidad || !ing.unidadCodigo) continue
    const prod = productosIngrediente.value.find(p => p.id === ing.ingredienteItemId)
    if (!prod) continue
    let cantidad: Decimal
    try {
      cantidad = new Decimal(ing.cantidad)
    } catch {
      continue
    }
    if (cantidad.isNaN() || cantidad.lessThanOrEqualTo(0)) continue
    const cantidadBase = convertirCantidadABase(
      ing.cantidad,
      ing.unidadCodigo,
      prod.unidadMedida,
    )
    if (!cantidadBase) continue
    total = total.plus(new Decimal(prod.costoActual ?? '0').mul(cantidadBase))
    algunaCompleta = true
  }
  if (!algunaCompleta) return null
  return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString()
})

/** Preview en vivo del costo del combo al agregar/quitar/cambiar componentes. */
const costoComboPreview = computed((): string | null => {
  if (form.value.tipo !== 'combo') return null
  let total = new Decimal(0)
  for (const c of form.value.componentes) {
    if (!c.componenteItemId || !c.cantidad) continue
    const it = itemsVendibles.value.find(i => i.id === c.componenteItemId)
    total = total.plus(new Decimal(it?.costoActual ?? '0').mul(c.cantidad))
  }
  return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString()
})

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

  if (item.tipo === 'producto' || item.tipo === 'ingrediente') {
    const inventario: any[] = [
      {
        label: 'Ajustar stock',
        icon: 'i-lucide-arrow-up-down',
        onSelect: () => abrirAjusteStock(item),
      },
    ]
    if (item.tipo === 'producto' && (item.modoInventario === 'serie' || item.modoInventario === 'lote')) {
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
        useApiFetch<PaginatedResponse<Item>>(`${apiUrl}/items?tipo=ingrediente&pageSize=100`),
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
      .map((i) => ({
        label: i.origen === 'sistema' ? `${i.nombre} (Sistema)` : i.nombre,
        value: i.id,
      }))

    descuentosOpts.value = descuentos
      .filter((d) => d.activo)
      .map((d) => ({ label: d.nombre, value: d.id }))

    recargosOpts.value = recargos
      .filter((r) => r.activo)
      .map((r) => ({ label: r.nombre, value: r.id }))

    productosIngrediente.value = productos.data
      .map(p => ({
        id: p.id,
        nombre: p.nombre,
        unidadMedida: p.unidadMedida ?? 'unidad',
        costoActual: p.costoActual ?? null,
      }))
  } catch {
    toast.add({ title: 'Error al cargar catálogos', color: 'error' })
  }
}

onMounted(() => {
  cargarCatalogos()
  cargarItemsVendibles()
  cargarGruposCatalogo()
})

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
      extrasPermitidos: (detalle.extrasPermitidos ?? []).map(e => ({
        ingredienteItemId: e.ingredienteItemId,
        cantidad: e.cantidad,
        unidadCodigo: e.unidadCodigo,
        precioExtra: e.precioExtra,
      })),
      componentes: (detalle.componentes ?? []).map(c => ({
        componenteItemId: c.componenteItemId,
        cantidad: c.cantidad,
        bloqueante: c.bloqueante,
      })),
      gruposModificadores: (detalle.grupos ?? []).map(g => ({
        grupoModificadorId: g.grupoModificadorId,
        min: String(g.min),
        max: String(g.max),
        orden: String(g.orden),
        opciones: (g.opciones ?? []).map(o => ({
          grupoOpcionId: o.grupoOpcionId,
          itemNombre: o.itemNombre,
          cantidad: o.cantidad ?? '',
          cantidadDefault: o.cantidadDefault,
          unidadCodigo: o.unidadCodigo ?? undefined,
          precioExtra: o.precioExtra,
          esPendiente: o.esPendiente,
        })),
      })),
      clasificacionTributaria: detalle.clasificacionTributaria ?? 'afecto',
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

function costoProductoCambio(): boolean {
  if (!form.value.costo) return false
  if (formCostoActual.value == null || formCostoActual.value === '') return true
  try {
    return !new Decimal(form.value.costo).eq(new Decimal(formCostoActual.value))
  } catch {
    return form.value.costo !== formCostoActual.value
  }
}

async function maybeAbrirDesfases(productoId: string) {
  try {
    const filas = await useApiFetch<DesfaseRecetaDto[]>(
      `${apiUrl}/items/${productoId}/recetas-afectadas`,
    )
    if (filas.length) {
      desfasesFilas.value = filas
      desfasesHighlightId.value = productoId
      desfasesOpen.value = true
    }
  } catch { /* no bloquear el flujo de guardado */ }
}

async function onAplicarDesfases(aplicados: AplicarDesfaseItem[]) {
  desfasesLoading.value = true
  try {
    await useApiFetch(`${apiUrl}/recetas/desfases/aplicar`, {
      method: 'POST',
      body: { items: aplicados },
    })
    const byId = new Map(aplicados.map(a => [a.recetaItemId, a]))
    for (const fila of desfasesFilas.value) {
      const apply = byId.get(fila.recetaItemId)
      if (!apply) continue
      const row = items.value.find(i => i.id === fila.recetaItemId)
      if (!row) continue
      row.costoActual = fila.costoPropuesto
      if (apply.actualizarPrecio && apply.precioBase) {
        row.precioBase = apply.precioBase
      }
    }
    toast.add({ title: 'Costos de recetas actualizados', color: 'success' })
    desfasesOpen.value = false
  } catch (e) {
    const msg = apiErrorMsg(e, 'Error al aplicar desfases')
    toast.add({ title: msg, color: 'error' })
  } finally {
    desfasesLoading.value = false
  }
}

async function onDescartarDesfases(recetaItemIds: string[]) {
  desfasesLoading.value = true
  try {
    await useApiFetch(`${apiUrl}/recetas/desfases/descartar`, {
      method: 'POST',
      body: { recetaItemIds },
    })
    toast.add({ title: 'Avisos descartados', color: 'success' })
    desfasesOpen.value = false
  } catch (e) {
    const msg = apiErrorMsg(e, 'Error al descartar desfases')
    toast.add({ title: msg, color: 'error' })
  } finally {
    desfasesLoading.value = false
  }
}

async function guardar() {
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      nombre: form.value.nombre,
      descripcion: form.value.descripcion || undefined,
      monedaId: form.value.monedaId,
      categoriaId: form.value.categoriaId || undefined,
      activo: form.value.activo,
    }

    if (form.value.tipo !== 'ingrediente') {
      payload.precioBase = form.value.precioBase
      payload.precioIncluyeImpuesto = form.value.precioIncluyeImpuesto
      payload.clasificacionTributaria = form.value.clasificacionTributaria
      payload.impuestosIds = form.value.impuestosIds
      payload.recargosIds = form.value.recargosIds
      payload.descuentosIds = form.value.descuentosIds
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
    } else if (form.value.tipo === 'ingrediente') {
      payload.precioBase = '0'
      payload.unidadMedida = form.value.unidadMedida
      if (form.value.costo) payload.costo = form.value.costo
      if (!editingId.value) {
        payload.stock = form.value.stock || '0'
      }
    } else if (form.value.tipo === 'servicio') {
      payload.duracionEstimada = form.value.duracionEstimada || undefined
      payload.requiereCita = form.value.requiereCita
    } else if (form.value.tipo === 'receta') {
      payload.ingredientes = form.value.ingredientes
      payload.extrasPermitidos = form.value.extrasPermitidos
    } else if (form.value.tipo === 'combo') {
      payload.componentes = form.value.componentes
    } else {
      payload.frecuencia = form.value.frecuencia
    }

    if (form.value.tipo === 'combo' || form.value.tipo === 'receta') {
      payload.gruposModificadores = form.value.gruposModificadores.map(g => ({
        grupoModificadorId: g.grupoModificadorId,
        min: Number(g.min),
        max: Number(g.max),
        orden: Number(g.orden || '0'),
        opciones: g.opciones
          .filter(o => o.cantidad !== '' || o.unidadCodigo || o.precioExtra !== '')
          .map(o => ({
            grupoOpcionId: o.grupoOpcionId,
            cantidad: o.cantidad || undefined,
            unidadCodigo: o.unidadCodigo || undefined,
            precioExtra: o.precioExtra || undefined,
          })),
      }))
    }

    const productoId = editingId.value
    const isNew = !editingId.value
    const chequearDesfases =
      !!productoId
      && (form.value.tipo === 'producto' || form.value.tipo === 'ingrediente')
      && costoProductoCambio()

    const saved = isNew
      ? await useApiFetch<Item>(`${apiUrl}/items`, {
          method: 'POST',
          body: payload,
        })
      : await useApiFetch<Item>(`${apiUrl}/items/${editingId.value}`, {
          method: 'PATCH',
          body: payload,
        })

    upsertItemEnLista(saved, isNew)
    syncProductoIngrediente(saved)
    syncItemVendible(saved)
    toast.add({
      title: isNew ? 'Item creado' : 'Item actualizado',
      color: 'success',
    })

    drawerOpen.value = false
    if (chequearDesfases && productoId) {
      await maybeAbrirDesfases(productoId)
    }
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
  const id = confirmDeleteId.value
  try {
    await useApiFetch(`${apiUrl}/items/${id}`, {
      method: 'DELETE',
    })
    removeItemLocal(id)
    toast.add({ title: 'Item eliminado', color: 'success' })
    confirmModalOpen.value = false
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
    const productoId = stockItem.value.id
    const modo = stockItem.value.modoInventario ?? 'cantidad'
    const body: Record<string, unknown> = {
      tipo: f.tipo,
      motivo: f.motivo,
      comentario: f.comentario || undefined,
    }
    const envioCostoCompra =
      f.tipo === 'entrada' && f.motivo === 'compra' && !!f.costoUnitario
    if (envioCostoCompra) {
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
      `${apiUrl}/items/${productoId}/stock`,
      { method: 'PATCH', body },
    )
    const item = items.value.find((i) => i.id === productoId)
    if (item) {
      item.stock = result.stock
      if (envioCostoCompra) item.costoActual = f.costoUnitario
    }
    toast.add({ title: `Stock actualizado: ${result.stock}`, color: 'success' })
    stockModalOpen.value = false
    if (envioCostoCompra) {
      await maybeAbrirDesfases(productoId)
    }
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
  ingrediente: 'Ingrediente',
  servicio: 'Servicio',
  suscripcion: 'Suscripción',
  receta: 'Receta',
  combo: 'Combo',
}
const tipoColors: Record<string, 'primary' | 'secondary' | 'info' | 'warning' | 'neutral'> = {
  producto: 'primary',
  ingrediente: 'warning',
  servicio: 'secondary',
  suscripcion: 'info',
  receta: 'neutral',
  combo: 'neutral',
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
      description="Productos, ingredientes, servicios y suscripciones del catálogo"
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
              <span class="font-mono">{{
                row.original.tipo === 'ingrediente'
                  ? formatMonto('0', row.original.monedaId)
                  : formatMonto(row.original.precioBase, row.original.monedaId)
              }}</span>
              <span v-if="row.original.categoriaNombre">· {{ row.original.categoriaNombre }}</span>
              <span v-if="(row.original.tipo === 'producto' || row.original.tipo === 'ingrediente') && row.original.stock !== null">
                · Stock: {{ row.original.stock }}
                <span v-if="row.original.tipo === 'producto' && row.original.modoInventario === 'serie'">(unidades)</span>
                <span v-else-if="row.original.tipo === 'producto' && row.original.modoInventario === 'lote'">(lotes)</span>
                <span v-else>{{ row.original.unidadMedida }}</span>
              </span>
              <span v-if="row.original.tipo === 'producto' || row.original.tipo === 'ingrediente'" class="font-mono">
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

            <UFormField v-if="form.tipo !== 'ingrediente'" label="Precio base" required>
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

            <UFormField v-if="form.tipo !== 'ingrediente'" label="Precio incluye impuesto">
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
                    <AppDateInput v-model="form.fechaElaboracion" />
                  </UFormField>
                  <UFormField label="Fecha vencimiento">
                    <AppDateInput v-model="form.fechaVencimiento" />
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
                        <AppDateInput v-model="form.series[idx].garantiaHasta" />
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
                      <AppDateInput v-model="form.loteInicial.fechaElaboracion" />
                    </UFormField>
                    <UFormField label="Fecha vencimiento">
                      <AppDateInput v-model="form.loteInicial.fechaVencimiento" />
                    </UFormField>
                  </div>
                </div>
              </template>
            </div>
          </template>

          <!-- Extensión ingrediente -->
          <template v-if="form.tipo === 'ingrediente'">
            <USeparator />
            <div class="space-y-4">
              <p class="text-sm font-medium text-muted">Datos de ingrediente</p>
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="Unidad de medida">
                  <USelectMenu
                    v-model="form.unidadMedida"
                    :items="unidadesMedidaOpts"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Costo">
                  <MoneyInput v-model="form.costo" :moneda-id="form.monedaId" class="w-full" />
                </UFormField>
                <UFormField v-if="!editingId" label="Stock inicial">
                  <UInput v-model="form.stock" inputmode="decimal" placeholder="0" class="w-full" />
                </UFormField>
              </div>
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
                <UFormField label="Ingrediente" class="col-span-2">
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

              <p v-if="costoRecetaCalculado != null" class="text-xs text-muted">
                Costo actual: {{ formatMonto(costoRecetaCalculado, form.monedaId) }}
              </p>
              <p v-else class="text-xs text-muted">
                Completá ingredientes (insumo, cantidad y unidad) para calcular el costo.
              </p>

              <div class="flex items-center justify-between pt-2">
                <p class="text-sm font-medium text-muted">Extras permitidos ({{ form.extrasPermitidos.length }})</p>
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-plus"
                  @click="form.extrasPermitidos = [...form.extrasPermitidos, { ingredienteItemId: '', cantidad: '', unidadCodigo: '', precioExtra: '' }]"
                >Agregar extra</UButton>
              </div>

              <div
                v-for="(extra, idx) in form.extrasPermitidos"
                :key="idx"
                class="grid grid-cols-5 gap-2 items-end"
              >
                <UFormField label="Ingrediente" class="col-span-2">
                  <USelectMenu
                    v-model="form.extrasPermitidos[idx].ingredienteItemId"
                    :items="productosIngredienteOpts"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Cantidad">
                  <UInput v-model="form.extrasPermitidos[idx].cantidad" inputmode="decimal" placeholder="0" class="w-full" />
                </UFormField>
                <UFormField label="Unidad">
                  <USelectMenu
                    v-model="form.extrasPermitidos[idx].unidadCodigo"
                    :items="unidadesMedidaStore.unidades
                      .filter(u => u.magnitud === unidadesMedidaStore.magnitudDe(
                        productosIngrediente.find(p => p.id === form.extrasPermitidos[idx].ingredienteItemId)?.unidadMedida,
                      ))
                      .map(u => ({ label: u.codigo, value: u.codigo }))"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <div class="flex items-end gap-2">
                  <UFormField label="Precio extra" class="flex-1">
                    <MoneyInput v-model="form.extrasPermitidos[idx].precioExtra" :moneda-id="form.monedaId" class="w-full" />
                  </UFormField>
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    size="sm"
                    class="self-end"
                    @click="form.extrasPermitidos = form.extrasPermitidos.filter((_, i) => i !== idx)"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- Extensión combo -->
          <template v-if="form.tipo === 'combo'">
            <USeparator />
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-muted">Componentes ({{ form.componentes.length }})</p>
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-plus"
                  @click="form.componentes = [...form.componentes, { componenteItemId: '', cantidad: '1', bloqueante: true }]"
                >Agregar componente</UButton>
              </div>

              <div
                v-for="(comp, idx) in form.componentes"
                :key="idx"
                class="grid grid-cols-4 gap-2 items-end"
              >
                <UFormField label="Item" class="col-span-2">
                  <USelectMenu
                    v-model="form.componentes[idx].componenteItemId"
                    :items="itemsVendiblesOpts"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Cantidad">
                  <UInput v-model="form.componentes[idx].cantidad" inputmode="decimal" placeholder="1" class="w-full" />
                </UFormField>
                <div class="flex items-end gap-2">
                  <UFormField label="Bloqueante">
                    <USwitch v-model="form.componentes[idx].bloqueante" />
                  </UFormField>
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    size="sm"
                    @click="form.componentes = form.componentes.filter((_, i) => i !== idx)"
                  />
                </div>
              </div>

              <p v-if="form.componentes.length && costoComboPreview != null" class="text-xs text-muted">
                Costo actual: {{ formatMonto(costoComboPreview, form.monedaId) }}
              </p>
              <p v-else class="text-xs text-muted">
                Agregá componentes (item y cantidad) para calcular el costo.
              </p>
            </div>
          </template>

          <!-- Grupos de modificadores (compartido combo + receta) -->
          <template v-if="form.tipo === 'combo' || form.tipo === 'receta'">
            <USeparator />
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-muted">Grupos de modificadores ({{ form.gruposModificadores.length }})</p>
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-plus"
                  @click="form.gruposModificadores = [...form.gruposModificadores, { grupoModificadorId: '', min: '1', max: '1', orden: String(form.gruposModificadores.length), opciones: [] }]"
                >Agregar grupo</UButton>
              </div>

              <div
                v-for="(grupo, idx) in form.gruposModificadores"
                :key="idx"
                class="rounded-lg border border-default p-3 space-y-2"
              >
                <div class="grid grid-cols-4 gap-2 items-end">
                  <UFormField label="Grupo" class="col-span-2">
                    <USelectMenu
                      v-model="form.gruposModificadores[idx].grupoModificadorId"
                      :items="gruposCatalogoOpts.filter(o =>
                        o.value === grupo.grupoModificadorId
                        || !form.gruposModificadores.some(g => g.grupoModificadorId === o.value),
                      )"
                      value-key="value"
                      class="w-full"
                      @update:model-value="onSelectGrupo(idx, $event as string)"
                    />
                  </UFormField>
                  <UFormField label="Mín.">
                    <UInput v-model="form.gruposModificadores[idx].min" type="number" min="0" placeholder="0" class="w-full" />
                  </UFormField>
                  <div class="flex items-end gap-2">
                    <UFormField label="Máx." class="flex-1">
                      <UInput v-model="form.gruposModificadores[idx].max" type="number" min="1" placeholder="1" class="w-full" />
                    </UFormField>
                    <UButton
                      color="error"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      size="sm"
                      @click="form.gruposModificadores = form.gruposModificadores.filter((_, i) => i !== idx)"
                    />
                  </div>
                </div>

                <div v-if="grupo.grupoModificadorId && grupo.opciones.length" class="pl-1 space-y-2">
                  <p class="text-xs text-muted">
                    Vacío = hereda el default del grupo. Sin default = opción pendiente (no vendible en este item).
                  </p>
                  <div class="grid grid-cols-12 gap-2 text-xs text-muted">
                    <span class="col-span-4">Opción</span>
                    <span class="col-span-2">Cantidad</span>
                    <span class="col-span-2">Unidad</span>
                    <span class="col-span-3">Precio extra</span>
                    <span class="col-span-1" />
                  </div>
                  <div
                    v-for="(op, opIdx) in grupo.opciones"
                    :key="op.grupoOpcionId"
                    class="grid grid-cols-12 gap-2 items-center"
                  >
                    <span class="col-span-4 truncate text-sm text-default">{{ op.itemNombre }}</span>
                    <UInput
                      v-model="grupo.opciones[opIdx]!.cantidad"
                      inputmode="decimal"
                      :placeholder="op.cantidadDefault ?? 'Pendiente'"
                      class="col-span-2 w-full"
                    />
                    <USelectMenu
                      v-if="gruposCatalogo.find(g => g.grupoModificadorId === grupo.grupoModificadorId)?.familia === 'ingrediente'"
                      v-model="grupo.opciones[opIdx]!.unidadCodigo"
                      :items="unidadesMedidaOpts"
                      value-key="value"
                      class="col-span-2 w-full"
                    />
                    <span v-else class="col-span-2" />
                    <MoneyInput
                      v-model="grupo.opciones[opIdx]!.precioExtra"
                      :moneda-id="form.monedaId"
                      class="col-span-3 w-full"
                    />
                    <UBadge
                      v-if="op.cantidad === '' && !op.cantidadDefault"
                      color="warning"
                      variant="subtle"
                      size="sm"
                      class="col-span-1 justify-self-end"
                    >Pendiente</UBadge>
                    <span v-else class="col-span-1" />
                  </div>
                </div>
              </div>

              <UButton
                v-if="form.gruposModificadores.length"
                to="/configuracion/grupos-modificadores"
                target="_blank"
                variant="link"
                size="xs"
                icon="i-lucide-external-link"
                class="px-0"
              >Administrar grupos de modificadores</UButton>
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
          <template v-if="form.tipo !== 'ingrediente'">
          <USeparator />
          <div class="space-y-3">
            <p class="text-sm font-medium text-muted">Reglas asociadas</p>

            <UFormField
              label="Clasificación tributaria"
              help="Exento: no se aplica IVA (los demás impuestos sí). Se congela en cada venta."
            >
              <USelect
                v-model="form.clasificacionTributaria"
                :items="[
                  { label: 'Afecto', value: 'afecto' },
                  { label: 'Exento', value: 'exento' },
                ]"
                class="w-full"
              />
            </UFormField>

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
          </template>
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
                      <AppDateInput v-model="ajusteForm.series[idx].garantiaHasta" />
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
                  <AppDateInput v-model="ajusteForm.loteFechaElab" />
                </UFormField>
                <UFormField label="Fecha vencimiento">
                  <AppDateInput v-model="ajusteForm.loteFechaVenc" />
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

    <!-- Impacto de costos en recetas tras cambiar insumo -->
    <AppDrawer
      v-model:open="desfasesOpen"
      width="75%"
      title="Impacto en recetas"
      description="El costo del producto cambió; estas recetas quedaron desfasadas."
    >
      <template #body>
        <RecetasDesfasesPanel
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
