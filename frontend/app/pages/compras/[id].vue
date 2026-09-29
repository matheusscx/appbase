<script setup lang="ts">
import type { CompraDetalle, LineaCompra as LineaDetalle, PresentacionCompra, TotalDocumentoTipo } from '~/composables/useCompras'
import { hoyLocal } from '~/composables/useVigenciaRegla'
import type { DestinoCodigo, DocumentoDte, DteLineaInfo, LecturaDteRespuesta, LineaDte } from '~/composables/useDte'
import { debeLlenarDescuentoDte, fraseOrigenDte, lineaFormDesdeDte, precargaDescuento, repartirLineas } from '~/composables/useDte'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

// ── Interfaces ─────────────────────────────────────────────────────────────

interface TipoDocumento {
  id: string
  nombre: string
  codigo: string | null
  requiereFolio: boolean
  /** Qué total lleva (spec compras-deuda-proveedor § 3, decisión 10). */
  totalDocumento: TotalDocumentoTipo
}
interface Proveedor {
  id: string
  nombre: string
  rut: string | null
  /** Para sugerir "Vence el" (spec § 4.2). Null = 30 días. */
  plazoPagoDias: number | null
}
interface ProductoOpt {
  id: string
  nombre: string
  modoInventario: string | null
  unidadMedida: string | null
}
/** Espejo de `MedioPagoOpcion` del backend (spec § 5.1, § 10). */
interface MedioPagoOpcion {
  id: string
  nombre: string
  esEfectivo: boolean
}

interface LineaForm {
  key: string
  itemId: string
  modoInventario: string | null
  unidadMedida: string | null
  cantidad: string
  unidadCodigo: string
  /** Una presentación del proveedor de la compra (pieza 2 § 4.1). Vacío =
   *  ninguna. Exactamente uno de `unidadCodigo`/`presentacionId` viaja. */
  presentacionId: string
  /** String vacío = falta costo: se completa cuando llega la factura. */
  precioUnitario: string
  /** Modo serie: una serie por renglón. */
  seriesTexto: string
  codigoLote: string
  fechaVencimiento: string
  /** Presente solo en una línea que vino del XML de la factura (tarea 4).
   *  `origen` es la línea cruda, para apartarla/traerla de vuelta sin perder
   *  sus datos (monto, unidad de la factura…) — nunca viaja al backend. */
  dte: (DteLineaInfo & { origen: LineaDte }) | null
}

/** Lo que trae el evento `cargar` de `CargarDteModal` (spec § 6). */
interface CargaDte {
  documento: DocumentoDte
  lectura: LecturaDteRespuesta
  proveedorId: string
  rutProveedor: string | null
}

interface Opt { label: string, value: string }

// ── Estado ─────────────────────────────────────────────────────────────────

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const { formatMonto } = useFormatters()
const { ubicaciones, cargar: cargarUbicaciones } = useUbicaciones()
const unidadesMedidaStore = useUnidadesMedidaStore()
const monedasStore = useMonedasStore()
const {
  totalLinea, subtotal, totalConDescuento, faltaAlgunPrecio, insigniaEstado, cantidadParaEditar,
  etiquetaPresentacion, cuentaPresentacion, cuerpoDocumento, fechaVencimientoSugerida,
} = useCompras()
const { puedeCrear } = usePermisosCrud('Compras')
const permissionsStore = usePermissionsStore()
// `Pagar` no es uno de los cuatro CRUD de `usePermisosCrud`: mismo molde que
// `puedeAnular` en `CompraConfirmada.vue`.
const puedePagar = computed(() => permissionsStore.esAdmin || permissionsStore.can('Compras', 'Pagar'))
const intentoCobro = useIntentoCobro()

const esNueva = computed(() => route.params.id === 'nueva')
const compra = ref<CompraDetalle | null>(null)
const cargando = ref(true)
const guardando = ref(false)

/** Solo un borrador (o una compra nueva) se edita acá. */
const editable = computed(() =>
  puedeCrear.value && (esNueva.value || compra.value?.estado === 'borrador'),
)

const tipos = ref<TipoDocumento[]>([])
const proveedores = ref<Proveedor[]>([])
const productos = ref<ProductoOpt[]>([])
const mediosPago = ref<MedioPagoOpcion[]>([])

const tipoOpts = computed<Opt[]>(() => tipos.value.map(t => ({ label: t.nombre, value: t.id })))
const proveedorOpts = computed<Opt[]>(() => proveedores.value.map(p => ({ label: p.nombre, value: p.id })))
const productoOpts = computed<Opt[]>(() => productos.value.map(p => ({ label: p.nombre, value: p.id })))
const medioPagoOpts = computed<Opt[]>(() => mediosPago.value.map(m => ({ label: m.nombre, value: m.id })))
// Solo las activas: el backend rechaza recibir en una desactivada.
const ubicacionOpts = computed<Opt[]>(() =>
  ubicaciones.value.filter(u => u.activo).map(u => ({ label: u.nombre, value: u.id })),
)

function emptyForm() {
  return {
    proveedorId: '',
    tipoDocumentoCompraId: '',
    folio: '',
    // `hoyLocal`, no `toISOString()`: en Chile la fecha UTC va un día adelante
    // desde las 21:00.
    fechaDocumento: hoyLocal(),
    ubicacionId: '',
    observacion: '',
    descuentoTotal: '',
    totalDocumento: '',
    fechaVencimiento: '',
  }
}
const form = ref(emptyForm())
const folioError = ref<string | null>(null)

let lineaSeq = 0
function nuevaLinea(): LineaForm {
  return {
    key: `linea-${lineaSeq++}`,
    itemId: '',
    modoInventario: null,
    unidadMedida: null,
    cantidad: '',
    unidadCodigo: '',
    presentacionId: '',
    precioUnitario: '',
    seriesTexto: '',
    codigoLote: '',
    fechaVencimiento: '',
    dte: null,
  }
}
const lineas = ref<LineaForm[]>([nuevaLinea()])

// ── Carga desde el XML de la factura (tarea 4) ──────────────────────────────

/** No-null solo mientras el borrador viene de un XML sin guardar: gatea la
 *  franja superior y el guard de salida (spec § 6). */
const origenDte = ref<{
  documento: DocumentoDte
  proveedorNombre: string
  rutProveedor: string | null
  /** Si ya se llenó `descuentoTotal` alguna vez en esta lectura (F1, ronda 1):
   *  el descuento se reevalúa cada vez que cambian las líneas que quedan en
   *  la compra (`descuentoDte`), y esa reevaluación no puede repetir el
   *  llenado ni pisar lo que el encargado haya tipeado o borrado después. */
  descuentoLlenado: boolean
} | null>(null)
/** Líneas de la factura marcadas "no es mercadería" (spec § 5.2, § 6): viajan
 *  aparte de `lineas` para que `lineasCargadas`/`puedeGuardar` no las vean. */
const apartadas = ref<LineaDte[]>([])
const cargarDteModalOpen = ref(false)
const reemplazarConfirmOpen = ref(false)

// ── Presentaciones (pieza 2 § 3.1 y § 6) ────────────────────────────────────

/** Las presentaciones vivas del proveedor elegido, de todos sus productos:
 *  una llamada por proveedor, nunca por línea. */
const presentaciones = ref<PresentacionCompra[]>([])

watch(() => form.value.proveedorId, async (proveedorId) => {
  presentaciones.value = proveedorId
    ? await useApiFetch<PresentacionCompra[]>(`${apiUrl}/compras/presentaciones?proveedorId=${proveedorId}`)
    : []
}, { immediate: true })

/**
 * Cambiar de proveedor: gesto explícito, no un `watch` de `proveedorId`
 * (mismo criterio que limpiar un costo al cambiar de unidad —
 * `docs/patterns/frontend.md` § 8—). Si fuera un `watch`, cargar un borrador
 * existente (que asigna `form.value.proveedorId` con el guardado) dispararía
 * el mismo revert sobre líneas que legítimamente ya venían en presentación de
 * ESE proveedor.
 */
function onSeleccionarProveedor(id: string) {
  const proveedorAnterior = form.value.proveedorId
  form.value.proveedorId = id
  if (!proveedorAnterior || proveedorAnterior === id) return
  const conPresentacion = lineas.value.filter(l => l.presentacionId)
  if (!conPresentacion.length) return
  for (const l of conPresentacion) {
    l.presentacionId = ''
    l.unidadCodigo = l.unidadMedida ?? ''
  }
  toast.add({
    title: `${conPresentacion.length} ${conPresentacion.length === 1 ? 'línea volvió' : 'líneas volvieron'} a la unidad base`,
    color: 'warning',
  })
}

/** `u:<codigo>` / `p:<id>` / `''`: la traducción es propia de esta pantalla
 *  (no del composable), que es la única que arma el selector combinado. */
function valorUnidad(linea: LineaForm): string {
  if (linea.presentacionId) return `p:${linea.presentacionId}`
  if (linea.unidadCodigo) return `u:${linea.unidadCodigo}`
  return ''
}

function onCambiarUnidad(linea: LineaForm, valor: string) {
  if (valor === 'nueva') {
    abrirNuevaPresentacion(linea)
    return
  }
  if (valor.startsWith('p:')) {
    linea.presentacionId = valor.slice(2)
    linea.unidadCodigo = ''
    return
  }
  if (valor.startsWith('u:')) {
    linea.presentacionId = ''
    linea.unidadCodigo = valor.slice(2)
  }
}

/** Las presentaciones de ESTE producto, ya elegidas por el proveedor vigente
 *  (`presentaciones` solo trae las del proveedor de la compra). */
function presentacionesDeLinea(linea: LineaForm): PresentacionCompra[] {
  return presentaciones.value.filter(p => p.itemId === linea.itemId)
}

function presentacionDe(linea: LineaForm): PresentacionCompra | undefined {
  return presentaciones.value.find(p => p.id === linea.presentacionId)
}

/** La cuenta a la vista bajo la línea (spec § 6), o null sin presentación o
 *  sin una cantidad tipeable. */
function cuentaDeLinea(linea: LineaForm): string | null {
  const p = presentacionDe(linea)
  if (!p) return null
  return cuentaPresentacion(
    linea.cantidad, p.contenido, p.unidadCodigo, linea.precioUnitario || null,
    monedasStore.monedaOficial,
  )
}

// ── El modal de presentación ─────────────────────────────────────────────

const presentacionModalOpen = ref(false)
const lineaEnPresentacion = ref<LineaForm | null>(null)
const presentacionEnEdicion = ref<PresentacionCompra | null>(null)

function itemDeLinea(linea: LineaForm) {
  const producto = productos.value.find(p => p.id === linea.itemId)
  return { id: linea.itemId, nombre: producto?.nombre ?? '', unidadMedida: linea.unidadMedida }
}

function abrirNuevaPresentacion(linea: LineaForm) {
  lineaEnPresentacion.value = linea
  presentacionEnEdicion.value = null
  presentacionModalOpen.value = true
}

function abrirEditarPresentacion(linea: LineaForm) {
  lineaEnPresentacion.value = linea
  presentacionEnEdicion.value = presentacionDe(linea) ?? null
  presentacionModalOpen.value = true
}

function onPresentacionGuardada(p: PresentacionCompra) {
  const i = presentaciones.value.findIndex(x => x.id === p.id)
  if (i >= 0) presentaciones.value[i] = p
  else presentaciones.value.push(p)
  if (lineaEnPresentacion.value) {
    lineaEnPresentacion.value.presentacionId = p.id
    lineaEnPresentacion.value.unidadCodigo = ''
  }
}

/** Retirada: toda línea que la tenía elegida (no solo la que abrió el modal)
 *  vuelve a la unidad base. */
function onPresentacionRetirada(id: string) {
  presentaciones.value = presentaciones.value.filter(p => p.id !== id)
  for (const l of lineas.value) {
    if (l.presentacionId !== id) continue
    l.presentacionId = ''
    l.unidadCodigo = l.unidadMedida ?? ''
  }
}

const tipoSeleccionado = computed(() =>
  tipos.value.find(t => t.id === form.value.tipoDocumentoCompraId) ?? null,
)
const pideFolio = computed(() => tipoSeleccionado.value?.requiereFolio ?? true)

/**
 * Qué hace "Total del documento" (spec § 3 y § 10, decisión 10): obligatorio
 * en una factura, opcional en una guía de despacho, oculto en un
 * `suma_lineas` (boleta, sin documento) — ahí el total lo calcula el
 * subtotal de las líneas, nunca se transcribe.
 */
const totalDocumentoTipo = computed<TotalDocumentoTipo>(() => tipoSeleccionado.value?.totalDocumento ?? 'suma_lineas')
const totalDocumentoVisible = computed(() => totalDocumentoTipo.value !== 'suma_lineas')
const totalDocumentoRequerido = computed(() => totalDocumentoTipo.value === 'obligatorio')

const proveedorSeleccionado = computed(() =>
  proveedores.value.find(p => p.id === form.value.proveedorId) ?? null,
)

// Un tipo `suma_lineas` no lleva total transcrito (400 si viaja): al
// cambiar a uno, se limpia lo que haya quedado de un tipo anterior.
watch(totalDocumentoVisible, (visible) => {
  if (!visible) form.value.totalDocumento = ''
})

// La sugerencia de "Vence el" (spec § 4.2): se recalcula cada vez que cambia
// el proveedor o la fecha del documento, pero SOLO mientras el campo siga
// vacío o igual a la última sugerencia — el mismo criterio que `MoneyInput`
// usa para no pisar el eco de su propio emit (`ultimoEmitido`). Así no se
// pierde si el proveedor se elige antes que la fecha (la fecha por defecto
// es "hoy", nunca vacía) y tampoco pisa lo que el encargado tipeó a mano ni
// lo que trajo el detalle guardado.
let ultimaVencimientoSugerida: string | null = null
watch(
  () => [form.value.proveedorId, form.value.fechaDocumento] as const,
  ([proveedorId, fechaDocumento]) => {
    if (!proveedorId || !fechaDocumento) return
    if (form.value.fechaVencimiento && form.value.fechaVencimiento !== ultimaVencimientoSugerida) return
    const sugerida = fechaVencimientoSugerida(fechaDocumento, proveedorSeleccionado.value?.plazoPagoDias ?? null)
    ultimaVencimientoSugerida = sugerida
    if (sugerida) form.value.fechaVencimiento = sugerida
  },
)

// ── Carga ──────────────────────────────────────────────────────────────────

async function cargarCatalogos() {
  await unidadesMedidaStore.ensureLoaded()
  // La lista es de Compras y no `/items`: quien recibe mercadería no necesita
  // permiso sobre el catálogo de ítems (owner, 2026-09-19). Trae producto e
  // ingrediente, los dos con stock, ya ordenados.
  const [tiposRes, provRes, prodRes, , mediosRes] = await Promise.all([
    useApiFetch<TipoDocumento[]>(`${apiUrl}/compras/tipos-documento`),
    useApiFetch<Proveedor[]>(`${apiUrl}/compras/proveedores`),
    useApiFetch<ProductoOpt[]>(`${apiUrl}/compras/productos`),
    cargarUbicaciones(),
    // Solo con `Pagar` (spec § 5.1, decisión 12): sin el permiso el endpoint
    // es 403, y el que carga sin pagar no necesita esta lista.
    puedePagar.value ? useApiFetch<MedioPagoOpcion[]>(`${apiUrl}/compras/medios-pago`) : Promise.resolve([]),
  ])
  tipos.value = tiposRes
  proveedores.value = provRes
  productos.value = prodRes
  mediosPago.value = mediosRes as MedioPagoOpcion[]
}

function lineaDesdeDetalle(l: LineaDetalle): LineaForm {
  return {
    ...nuevaLinea(),
    itemId: l.itemId,
    modoInventario: l.modoInventario,
    unidadMedida: l.unidadMedidaBase,
    cantidad: cantidadParaEditar(l.cantidad),
    unidadCodigo: l.unidadCodigo ?? '',
    presentacionId: l.presentacion?.id ?? '',
    precioUnitario: l.precioUnitario ?? '',
    seriesTexto: (l.series ?? []).map(s => s.serie).join('\n'),
    codigoLote: l.lote?.codigoLote ?? '',
    fechaVencimiento: l.lote?.fechaVencimiento ?? '',
  }
}

function llenarDesde(c: CompraDetalle) {
  compra.value = c
  form.value = {
    proveedorId: c.proveedorId,
    tipoDocumentoCompraId: c.tipoDocumentoCompraId,
    folio: c.folio ?? '',
    fechaDocumento: c.fechaDocumento,
    ubicacionId: c.ubicacionId,
    observacion: c.observacion ?? '',
    descuentoTotal: c.descuentoTotal ?? '',
    totalDocumento: c.totalDocumento ?? '',
    fechaVencimiento: c.fechaVencimiento ?? '',
  }
  lineas.value = c.lineas.length ? c.lineas.map(lineaDesdeDetalle) : [nuevaLinea()]
}

onMounted(async () => {
  try {
    await cargarCatalogos()
    if (!esNueva.value) {
      llenarDesde(await useApiFetch<CompraDetalle>(`${apiUrl}/compras/${route.params.id as string}`))
    }
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar la compra'), color: 'error' })
  } finally {
    cargando.value = false
  }
})

// ── Líneas ─────────────────────────────────────────────────────────────────

function unidadesCompatibles(linea: LineaForm): Opt[] {
  // Serie y lote solo admiten su unidad base (el backend lo rechaza si no).
  if (linea.modoInventario !== 'cantidad') {
    return linea.unidadMedida ? [{ label: linea.unidadMedida, value: linea.unidadMedida }] : []
  }
  const magnitud = unidadesMedidaStore.magnitudDe(linea.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: u.codigo, value: u.codigo }))
}

/**
 * El selector combinado (spec § 6): las unidades del catálogo, las
 * presentaciones de este proveedor para este producto, y "+ Nueva
 * presentación…" al final — deshabilitada sin proveedor o producto, ausente
 * en serie (ahí tampoco hay unidades del catálogo más que la base).
 */
function opcionesUnidad(linea: LineaForm): (Opt & { disabled?: boolean })[] {
  const items: (Opt & { disabled?: boolean })[] = [
    ...unidadesCompatibles(linea).map(u => ({ label: u.label, value: `u:${u.value}` })),
    ...presentacionesDeLinea(linea).map(p => ({ label: etiquetaPresentacion(p), value: `p:${p.id}` })),
  ]
  if (linea.modoInventario === 'serie') return items
  items.push({
    label: '+ Nueva presentación…',
    value: 'nueva',
    disabled: !form.value.proveedorId || !linea.itemId,
  })
  return items
}

function onSeleccionarItem(linea: LineaForm, itemId: string) {
  const producto = productos.value.find(p => p.id === itemId)
  linea.itemId = itemId
  linea.modoInventario = producto?.modoInventario ?? 'cantidad'
  linea.unidadMedida = producto?.unidadMedida ?? null
  // Una línea del XML no hereda la unidad base (tarea 4 § 6): "3 CJ" no es "3
  // unidad", y la real sale de que el encargado la asocie. Serie y lote solo
  // admiten la base de todos modos, así que ahí sí se fija.
  const dejarUnidadVacia = !!linea.dte && linea.modoInventario === 'cantidad'
  linea.unidadCodigo = dejarUnidadVacia ? '' : (producto?.unidadMedida ?? '')
  linea.presentacionId = ''
  linea.seriesTexto = ''
  linea.codigoLote = ''
  linea.fechaVencimiento = ''
}

function seriesDe(linea: LineaForm): string[] {
  return linea.seriesTexto.split('\n').map(s => s.trim()).filter(Boolean)
}

// En serie, la cantidad es la cuenta de las series, no un campo aparte que se
// pueda desincronizar (mismo criterio que traslados).
function onSeriesChange(linea: LineaForm, texto: string) {
  linea.seriesTexto = texto
  linea.cantidad = String(seriesDe(linea).length)
}

function agregarLinea() {
  lineas.value.push(nuevaLinea())
}

function quitarLinea(key: string) {
  lineas.value = lineas.value.filter(l => l.key !== key)
  if (!lineas.value.length) lineas.value.push(nuevaLinea())
}

/** Una línea a medio cargar (sin producto o sin cantidad) no viaja. */
const lineasCargadas = computed(() => lineas.value.filter(l => l.itemId && l.cantidad))

/** Una línea del XML todavía sin terminar de asociar: sin producto, sin
 *  unidad/presentación, o sin cantidad. `lineasCargadas` las descarta en
 *  silencio (le falta `itemId` o `cantidad`) — acá es donde `puedeGuardar`
 *  las tiene que ver, para no guardar una factura a medio asociar. */
const lineasPorAsociar = computed(() =>
  lineas.value.filter(l => l.dte && (!l.itemId || !(l.presentacionId || l.unidadCodigo) || !l.cantidad)),
)

function onClickCargarDesdeXml() {
  const tieneAlgoCargado = !!form.value.proveedorId || lineas.value.some(l => l.itemId)
  if (tieneAlgoCargado) {
    reemplazarConfirmOpen.value = true
    return
  }
  cargarDteModalOpen.value = true
}

function confirmarReemplazo() {
  reemplazarConfirmOpen.value = false
  cargarDteModalOpen.value = true
}

/** Agrega una línea del XML, salvo que lo único que haya sea el placeholder
 *  vacío que arranca el formulario — ahí la reemplaza. */
function agregarLineaDte(nueva: LineaForm) {
  const soloPlaceholder = lineas.value.length === 1 && !lineas.value[0]!.itemId && !lineas.value[0]!.dte
  lineas.value = soloPlaceholder ? [nueva] : [...lineas.value, nueva]
}

function lineaDesdeDte(
  linea: LineaDte,
  destino: Exclude<DestinoCodigo, 'no_mercaderia'> | null,
  nota: string | null,
): LineaForm {
  const producto = destino ? productos.value.find(p => p.id === destino.itemId) : undefined
  const campos = lineaFormDesdeDte(linea, destino, nota, producto, formatMonto)
  return { ...nuevaLinea(), ...campos, dte: { ...campos.dte, origen: linea } }
}

/**
 * Al recibir `cargar` del modal (spec § 6): encabezado, líneas repartidas por
 * `repartirLineas`, apartadas. El descuento NO se calcula acá — `descuentoDte`
 * (más abajo) lo reevalúa cada vez que cambian las líneas que quedan en la
 * compra, porque una línea sin precio (el FLETE, típicamente) puede seguir
 * bloqueándolo en este mismo instante y destrabarse recién cuando se aparta
 * (F1, ronda 1).
 */
function onCargarDte({ documento, lectura, proveedorId, rutProveedor }: CargaDte) {
  const proveedor = proveedores.value.find(p => p.id === proveedorId)

  form.value.proveedorId = proveedorId
  form.value.tipoDocumentoCompraId = lectura.tipoDocumento!.id
  form.value.folio = documento.folio
  form.value.fechaDocumento = documento.fechaEmision
  form.value.descuentoTotal = ''
  // `MntTotal` y `FchVenc` (spec § 7 y § 10, decisión 4): si el XML no trae
  // `FchVenc`, queda vacío y la sugerencia por plazo del proveedor la llena
  // (el watch de `fechaVencimiento` de más abajo, que no pisa un valor ya
  // puesto — acá llega antes que él en el mismo ciclo).
  //
  // `totalDocumentoVisible` NO sirve acá: es un `computed` sobre
  // `tipoSeleccionado`, y el watch que lo limpia en un tipo `suma_lineas`
  // solo corre en la TRANSICIÓN visible→oculto — si el tipo elegido por el
  // XML ya era `suma_lineas` (nada cambia de estado), el watch no dispara y
  // el total quedaría puesto igual. Por eso acá se resuelve el tipo elegido
  // directo del catálogo, no del `computed`.
  const tipoElegido = tipos.value.find(t => t.id === lectura.tipoDocumento!.id)
  const llevaTotalTranscrito = (tipoElegido?.totalDocumento ?? 'suma_lineas') !== 'suma_lineas'
  form.value.totalDocumento = llevaTotalTranscrito ? (documento.montoTotal ?? '') : ''
  form.value.fechaVencimiento = documento.fechaVencimiento ?? ''

  const { lineas: repartidas, apartadas: apartadasIniciales } = repartirLineas(documento, lectura.asociaciones)
  lineas.value = repartidas.length
    ? repartidas.map(({ linea, destino, nota }) => lineaDesdeDte(linea, destino, nota))
    : [nuevaLinea()]
  apartadas.value = apartadasIniciales

  origenDte.value = {
    documento,
    proveedorNombre: proveedor?.nombre ?? '',
    rutProveedor,
    descuentoLlenado: false,
  }
}

/** "No es mercadería": todas las líneas con la misma clave (spec § 6), no
 *  solo la que abrió el botón. */
function apartarLinea(key: string) {
  const objetivo = lineas.value.find(l => l.key === key)
  if (!objetivo?.dte) return
  const clave = objetivo.dte.clave
  const aMover = lineas.value.filter(l => l.dte?.clave === clave)
  apartadas.value = [...apartadas.value, ...aMover.map(l => l.dte!.origen)]
  lineas.value = lineas.value.filter(l => l.dte?.clave !== clave)
  if (!lineas.value.length) lineas.value.push(nuevaLinea())
}

/** "Traer de vuelta": vuelve siempre por asociar, nunca con el destino que
 *  tenía antes de apartarse (spec § 6). */
function traerDeVuelta(linea: LineaDte) {
  apartadas.value = apartadas.value.filter(l => l !== linea)
  agregarLineaDte(lineaDesdeDte(linea, null, null))
}

const subtotalMostrado = computed(() =>
  subtotal(lineasCargadas.value.map(l => ({ cantidad: l.cantidad, precioUnitario: l.precioUnitario || null }))),
)
const faltanPrecios = computed(() =>
  faltaAlgunPrecio(lineasCargadas.value.map(l => ({ precioUnitario: l.precioUnitario || null }))),
)
// El descuento se reparte según el valor de cada línea: sin todos los precios
// (o sin líneas) no hay cómo, y el backend lo rechaza (spec § 6).
const descuentoHabilitado = computed(() =>
  editable.value && lineasCargadas.value.length > 0 && !faltanPrecios.value,
)
// Si se borra un precio, el descuento cargado deja de poder existir: se vacía a
// la vista, con el campo deshabilitado diciendo por qué.
watch(faltanPrecios, (falta) => {
  if (falta) form.value.descuentoTotal = ''
})
const totalMostrado = computed(() =>
  totalConDescuento(subtotalMostrado.value, form.value.descuentoTotal || null),
)

/**
 * El total que se le va a deber al proveedor (spec § 4.1, decisión 10): lo
 * transcrito en un tipo que lo lleva, o el de las líneas en `suma_lineas`.
 * Es la propuesta de monto de "¿La pagaste ya?" — null si todavía no se sabe
 * (el encargado igual puede tipear el monto a mano).
 */
const totalParaConfirmar = computed(() =>
  totalDocumentoVisible.value ? (form.value.totalDocumento || null) : totalMostrado.value,
)

/**
 * El descuento de la factura del XML (spec § 3.3, F1 ronda 1): se reevalúa
 * cada vez que cambian las líneas que HOY quedan en la compra —no solo al
 * leer— porque una línea sin precio (el FLETE, típicamente) sigue en
 * `lineas` hasta que el encargado la aparta, y recién ahí deja de bloquear
 * el descuento del resto. `null` sin una lectura activa (`origenDte`): un
 * borrador cargado a mano nunca pasa por acá.
 */
const descuentoDte = computed(() => {
  if (!origenDte.value) return null
  const decimales = monedasStore.monedaOficial?.decimals ?? 0
  const algunaSinPrecio = faltaAlgunPrecio(
    lineas.value.filter(l => l.dte).map(l => ({ precioUnitario: l.precioUnitario || null })),
  )
  return precargaDescuento(origenDte.value.documento, decimales, algunaSinPrecio)
})

// Llena `descuentoTotal` apenas `descuentoDte` tiene un monto para dar, pero
// nunca más de una vez por lectura (`debeLlenarDescuentoDte`): ni cuando el
// encargado ya tipeó algo, ni de vuelta si lo borró después de que se llenara
// solo.
watch(descuentoDte, (estado) => {
  if (!origenDte.value || !estado) return
  if (!debeLlenarDescuentoDte(estado.monto, origenDte.value.descuentoLlenado, form.value.descuentoTotal)) return
  form.value.descuentoTotal = estado.monto!
  origenDte.value.descuentoLlenado = true
})

// ── Guardar / descartar ────────────────────────────────────────────────────

const puedeGuardar = computed(() =>
  !!form.value.proveedorId
  && !!form.value.tipoDocumentoCompraId
  && !!form.value.ubicacionId
  && !!form.value.fechaDocumento
  && (!pideFolio.value || !!form.value.folio.trim())
  // Cada línea cargada necesita unidad O presentación (spec pieza 2 § 6): un
  // borrador cuya presentación fue retirada no se puede guardar tal cual.
  && lineasCargadas.value.every(l => !!l.presentacionId || !!l.unidadCodigo)
  // Ninguna línea del XML puede quedar a medio asociar (tarea 4 § 6).
  && lineasPorAsociar.value.length === 0,
)

function armarBody() {
  const body: Record<string, unknown> = {
    proveedorId: form.value.proveedorId,
    tipoDocumentoCompraId: form.value.tipoDocumentoCompraId,
    folio: pideFolio.value ? form.value.folio.trim() : null,
    fechaDocumento: form.value.fechaDocumento,
    ubicacionId: form.value.ubicacionId,
    observacion: form.value.observacion.trim() || null,
    descuentoTotal: form.value.descuentoTotal || null,
    ...cuerpoDocumento(form.value),
    lineas: lineasCargadas.value.map((l) => {
      const linea: Record<string, unknown> = {
        itemId: l.itemId,
        cantidad: l.cantidad,
        // Exactamente una de las dos claves (spec pieza 2 § 4.1): nunca las
        // dos, nunca en `null`.
        ...(l.presentacionId ? { presentacionId: l.presentacionId } : { unidadCodigo: l.unidadCodigo }),
        // Vacío viaja como null explícito: "falta costo".
        precioUnitario: l.precioUnitario || null,
      }
      if (l.modoInventario === 'serie') {
        linea.series = seriesDe(l).map(serie => ({ serie }))
      }
      if (l.modoInventario === 'lote') {
        linea.lote = {
          codigoLote: l.codigoLote.trim(),
          ...(l.fechaVencimiento ? { fechaVencimiento: l.fechaVencimiento } : {}),
        }
      }
      // Solo clave + descripción (tarea 4 § 7): nunca esparcir `l.dte`
      // entero — el DTO del backend tiene `forbidNonWhitelisted` y `dte`
      // trae campos (texto, calzo, nota…) que no existen ahí.
      if (l.dte) {
        linea.claveProveedor = l.dte.clave
        linea.descripcionProveedor = l.dte.descripcion
      }
      return linea
    }),
  }
  if (apartadas.value.length) {
    body.apartadas = apartadas.value.map(a => ({ clave: a.clave, descripcion: a.descripcion }))
  }
  if (origenDte.value?.rutProveedor) {
    body.rutProveedor = origenDte.value.rutProveedor
  }
  return body
}

/**
 * Guarda lo que está en pantalla (POST si esta instancia todavía no tiene una
 * compra persistida, PATCH si no) y devuelve la compra guardada, o `null` si
 * falló, con el error ya mostrado. La usan "Guardar borrador" y "Confirmar
 * recepción": confirmar sin guardar primero recibiría lo último guardado, no
 * lo que el encargado ve.
 *
 * El método lo decide `compra.value?.id` —lo que deja `llenarDesde` apenas el
 * primer POST responde—, **nunca** `esNueva`/la URL: si `router.replace` no
 * llegó a correr todavía (`navegar: false`, y `/confirmar` falló después —
 * ver `confirmarRecepcion`), la URL puede seguir en `/compras/nueva` con la
 * compra YA CREADA. Decidir por la URL ahí mandaría un segundo `POST` y
 * dejaría un borrador duplicado (bug real, visto en revisión — antes de esto
 * el replace siempre corría adentro de esta función, así que la URL y
 * `compra.value` nunca se desincronizaban).
 *
 * `navegar` (default `true`): si esta instancia recién creó la compra, el
 * `router.replace` de acá abajo cambia `route.params.id` y `<NuxtPage>` (sin
 * `key` propio, `app.vue`) REMONTA la página — una instancia nueva que pide
 * de nuevo `GET /compras/<id>`. "Guardar borrador" no manda nada más
 * después, así que no importa. "Confirmar recepción" sí — un `POST
 * /confirmar` — y si ese GET remontado responde después de ese POST, pisa la
 * confirmación con el borrador que leyó antes (`docs/agent/anti-patterns.md`,
 * "leer una respuesta asíncrona…", cara b). Por eso `confirmarRecepcion` pasa
 * `navegar: false` acá y hace el replace ella misma, recién cuando el
 * `/confirmar` ya cerró (haya funcionado o no).
 */
async function persistirBorrador({ navegar = true } = {}): Promise<CompraDetalle | null> {
  folioError.value = null
  try {
    const body = armarBody()
    const creaAhora = !compra.value?.id
    const res = creaAhora
      ? await useApiFetch<CompraDetalle>(`${apiUrl}/compras`, { method: 'POST', body })
      : await useApiFetch<CompraDetalle>(`${apiUrl}/compras/${compra.value!.id}`, { method: 'PATCH', body })
    llenarDesde(res)
    // Antes del replace: el guard de salida (§ 6) solo frena con `origenDte`
    // puesto, y si no se limpia acá bloquearía esta misma navegación que el
    // guardado dispara — la compra ya se guardó y no hay nada que perder.
    // Se limpia SIEMPRE, no solo cuando `navegar` es `true`: el guard tiene
    // que estar destrabado para el replace que `confirmarRecepcion` haga por
    // su cuenta más tarde, aunque este guardado no navegue nada.
    origenDte.value = null
    apartadas.value = []
    if (creaAhora && navegar) await router.replace(`/compras/${res.id}`)
    return res
  } catch (e: unknown) {
    const status = (e as { status?: number, statusCode?: number }).status
      ?? (e as { statusCode?: number }).statusCode
    const mensaje = apiErrorMsg(e, 'Error al guardar la compra')
    // El folio repetido se muestra al lado del campo, que es donde se arregla.
    if (status === 409) folioError.value = mensaje
    else toast.add({ title: mensaje, color: 'error' })
    return null
  }
}

async function guardar() {
  if (!puedeGuardar.value || guardando.value) return
  guardando.value = true
  try {
    if (await persistirBorrador()) {
      toast.add({ title: 'Borrador guardado', color: 'success' })
    }
  } finally {
    guardando.value = false
  }
}

// ── Confirmar ───────────────────────────────────────────────────────────────

const confirmarOpen = ref(false)
const puedeConfirmar = computed(() => puedeGuardar.value && lineasCargadas.value.length > 0)

const ubicacionNombre = computed(() =>
  ubicaciones.value.find(u => u.id === form.value.ubicacionId)?.nombre ?? '',
)
const lineasSinPrecio = computed(() =>
  lineasCargadas.value.filter(l => !l.precioUnitario).length,
)

// ── "¿La pagaste ya?" (spec § 7 y § 10) ─────────────────────────────────────

const pagoOpciones = [
  { label: 'No', value: false },
  { label: 'Sí, la pagué', value: true },
]
const pagarAhora = ref(false)
const pagoMedioId = ref('')
const pagoMonto = ref('')
const pagoReferencia = ref('')

const medioSeleccionado = computed(() => mediosPago.value.find(m => m.id === pagoMedioId.value) ?? null)
const medioEsEfectivo = computed(() => medioSeleccionado.value?.esEfectivo ?? false)

/**
 * Al abrir el modal de confirmar: `FmaPago = 1` (contado) propone "Sí, la
 * pagué" (spec § 10); el medio arranca en el primero de la lista y el monto
 * propuesto es el total que se le va a deber (§ 4.1). Sin `Pagar`, esto no se
 * usa — el control ni se muestra (§ 1.1: un control con permiso propio no va
 * condicionado a otro).
 */
watch(confirmarOpen, (open) => {
  if (!open || !puedePagar.value) return
  pagarAhora.value = origenDte.value?.documento.fmaPago === '1'
  pagoMedioId.value = mediosPago.value[0]?.id ?? ''
  pagoMonto.value = totalParaConfirmar.value ?? ''
  pagoReferencia.value = ''
})

/** El body de `pago` para `POST /compras/:id/confirmar` (spec § 7): solo lo
 *  que el DTO declara — `monto`, `metodoPagoId` y `referencia` si se tipeó. */
const cuerpoPago = computed(() => {
  if (!puedePagar.value || !pagarAhora.value) return null
  if (!pagoMonto.value.trim() || !pagoMedioId.value) return null
  const pago: { monto: string, metodoPagoId: string, referencia?: string } = {
    monto: pagoMonto.value.trim(),
    metodoPagoId: pagoMedioId.value,
  }
  if (pagoReferencia.value.trim()) pago.referencia = pagoReferencia.value.trim()
  return pago
})
const puedeEnviarConfirmar = computed(() => !pagarAhora.value || cuerpoPago.value != null)

/**
 * Guarda y confirma. Confirmar mueve stock y costo: por eso pasa por un modal
 * que dice cuánto entra y adónde antes de mandar nada.
 */
async function confirmarRecepcion() {
  if (!puedeConfirmar.value || !puedeEnviarConfirmar.value || guardando.value) return
  guardando.value = true
  try {
    // Si esta instancia todavía no tiene una compra persistida, el guardado
    // de abajo es el que la CREA — y la URL tiene que terminar apuntando a
    // ella pase lo que pase con `/confirmar` después: si confirmar falla, la
    // compra igual quedó guardada, y dejar la URL en `/compras/nueva` deja a
    // un "Guardar"/"Confirmar" siguiente sin saber que ya existe (manda OTRO
    // POST y duplica el borrador — ver `persistirBorrador`).
    const creaAhora = !compra.value?.id
    // `navegar: false`: acá abajo se decide cuándo, no `persistirBorrador`.
    const guardada = await persistirBorrador({ navegar: false })
    if (!guardada) return
    // El body del pago se congela ACÁ: `cuerpoPago` puede seguir cambiando
    // (el modal ya cerró) y la clave de idempotencia tiene que corresponder
    // a lo que de verdad se mandó, no a lo que haya en pantalla después.
    const pago = cuerpoPago.value
    const ambitoCobro = `compra:${guardada.id}`
    try {
      const res = await useApiFetch<CompraDetalle & { repetida?: true }>(
        `${apiUrl}/compras/${guardada.id}/confirmar`,
        {
          method: 'POST',
          body: pago ? { pago } : {},
          // La `Idempotency-Key` (ADR-026, pattern § 18) solo cuando confirmar
          // también cobra: sin `pago` el backend no la exige.
          ...(pago ? { headers: intentoCobro.cabecera(ambitoCobro) } : {}),
        },
      )
      llenarDesde(res)
      if (pago) {
        intentoCobro.terminar(ambitoCobro)
        intentoCobro.avisarSiRepetido(res)
      }
      toast.add({
        title: pago
          ? 'Recepción confirmada y pagada: el stock y la caja ya se movieron'
          : 'Recepción confirmada: la mercadería ya entró al stock',
        color: 'success',
      })
    } catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al confirmar la recepción'), color: 'error' })
    } finally {
      // Recién ACÁ, con `/confirmar` ya resuelto (haya funcionado o no): así
      // ningún GET que el replace remonte puede quedar pisando una
      // confirmación todavía en vuelo (el bug original), y si confirmar
      // falló, la URL igual termina apuntando a la compra que SÍ se guardó
      // — `origenDte` ya está en `null` desde `persistirBorrador`, así que el
      // guard de salida no frena este replace.
      if (creaAhora) await router.replace(`/compras/${guardada.id}`)
    }
  } finally {
    guardando.value = false
    confirmarOpen.value = false
  }
}

const descartarOpen = ref(false)
async function descartar() {
  if (!compra.value) return
  try {
    await useApiFetch(`${apiUrl}/compras/${compra.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Borrador descartado', color: 'success' })
    await router.push('/compras')
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al descartar el borrador'), color: 'error' })
  } finally {
    descartarOpen.value = false
  }
}

const titulo = computed(() => {
  if (esNueva.value) return 'Nueva compra'
  const c = compra.value
  if (!c) return 'Compra'
  return `${c.tipoDocumentoNombre ?? 'Compra'}${c.folio ? ` ${c.folio}` : ''}`
})

// ── Salir sin guardar la factura cargada (tarea 4 § 6) ──────────────────────
// Solo mientras `origenDte` está puesto: guardar (§ arriba) lo limpia antes
// de su propio `router.replace`, así esta misma navegación no se frena a sí
// misma. Precedente: `pages/salones/index.vue:1079`.

onBeforeRouteLeave(() => {
  if (!origenDte.value) return true
  return confirm('Vas a salir sin guardar la factura que cargaste desde el XML. ¿Seguro?')
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!origenDte.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar :title="titulo" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <div class="flex items-center justify-between gap-3">
          <UButton variant="ghost" icon="i-lucide-arrow-left" to="/compras">
            Compras
          </UButton>
          <div v-if="compra" class="flex flex-wrap gap-1">
            <UBadge
              v-for="i in insigniaEstado(compra)"
              :key="i.label"
              :label="i.label"
              :color="i.color"
              variant="subtle"
            />
          </div>
          <UButton
            v-if="esNueva && editable"
            variant="soft"
            color="neutral"
            icon="i-lucide-file-up"
            data-qa="compra-cargar-dte"
            @click="onClickCargarDesdeXml"
          >
            Cargar desde la factura (XML)
          </UButton>
        </div>

        <div
          v-if="origenDte"
          class="rounded-md border border-default bg-elevated p-3 space-y-1"
          data-qa="compra-dte-franja"
        >
          <p class="text-sm text-default">
            {{ fraseOrigenDte(tipoSeleccionado?.nombre ?? '', form.folio, origenDte.proveedorNombre) }}
          </p>
          <p
            v-for="(aviso, i) in descuentoDte?.avisos ?? []"
            :key="i"
            class="text-xs text-warning"
            data-qa="compra-dte-aviso"
          >
            {{ aviso }}
          </p>
        </div>

        <div v-if="cargando" class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-loader" class="w-4 h-4 animate-spin" />
          Cargando…
        </div>

        <!-- ── Carga del borrador ─────────────────────────────────────────── -->
        <UForm
          v-else-if="editable"
          id="compra-form"
          :state="form"
          class="space-y-6"
          @submit="guardar"
        >
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <UFormField label="Proveedor" required>
              <USelectMenu
                :model-value="form.proveedorId"
                :items="proveedorOpts"
                value-key="value"
                searchable
                placeholder="A quién se le compró"
                class="w-full"
                @update:model-value="onSeleccionarProveedor"
              />
            </UFormField>
            <UFormField label="Documento" required>
              <USelectMenu
                v-model="form.tipoDocumentoCompraId"
                :items="tipoOpts"
                value-key="value"
                placeholder="Factura, boleta, sin documento…"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="pideFolio"
              label="Folio"
              required
              :error="folioError ?? undefined"
            >
              <UInput
                v-model="form.folio"
                placeholder="Número del documento"
                class="w-full"
                data-qa="compra-folio"
                @update:model-value="folioError = null"
              />
            </UFormField>
            <UFormField label="Fecha del documento" required>
              <UInput v-model="form.fechaDocumento" type="date" class="w-full" />
            </UFormField>
            <UFormField
              v-if="totalDocumentoVisible"
              label="Total del documento"
              :required="totalDocumentoRequerido"
              data-qa="compra-total-documento-campo"
            >
              <MoneyInput
                v-model="form.totalDocumento"
                oficial
                class="w-full"
                data-qa="compra-total-documento"
              />
            </UFormField>
            <UFormField label="Vence el">
              <UInput v-model="form.fechaVencimiento" type="date" class="w-full" data-qa="compra-vencimiento" />
            </UFormField>
            <UFormField label="Entra a" required>
              <USelectMenu
                v-model="form.ubicacionId"
                :items="ubicacionOpts"
                value-key="value"
                placeholder="Local o bodega"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Observación">
              <UInput v-model="form.observacion" placeholder="Opcional" class="w-full" />
            </UFormField>
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-default">Líneas</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="agregarLinea">
                Agregar línea
              </UButton>
            </div>

            <div
              v-for="linea in lineas"
              :key="linea.key"
              class="border border-default rounded-md p-4 space-y-3"
              data-qa="compra-linea"
            >
              <div class="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
                <UFormField label="Producto" class="md:col-span-4">
                  <USelectMenu
                    :model-value="linea.itemId"
                    :items="productoOpts"
                    value-key="value"
                    searchable
                    placeholder="Selecciona un producto"
                    class="w-full"
                    @update:model-value="(v: string) => onSeleccionarItem(linea, v)"
                  />
                </UFormField>
                <UFormField label="Cantidad" class="md:col-span-2">
                  <UInput
                    v-model="linea.cantidad"
                    inputmode="decimal"
                    placeholder="0"
                    :disabled="linea.modoInventario === 'serie'"
                    class="w-full"
                    data-qa="compra-cantidad"
                  />
                </UFormField>
                <UFormField label="Unidad" class="md:col-span-2">
                  <div class="flex items-center gap-1">
                    <USelect
                      :model-value="valorUnidad(linea)"
                      :items="opcionesUnidad(linea)"
                      :disabled="!linea.itemId"
                      class="w-full"
                      @update:model-value="(v: string) => onCambiarUnidad(linea, v)"
                    />
                    <UButton
                      v-if="linea.presentacionId"
                      icon="i-lucide-pencil"
                      variant="ghost"
                      size="sm"
                      :data-qa="`compra-presentacion-editar-${linea.key}`"
                      @click="abrirEditarPresentacion(linea)"
                    />
                  </div>
                </UFormField>
                <UFormField label="Precio unitario" class="md:col-span-2">
                  <MoneyInput
                    v-model="linea.precioUnitario"
                    oficial
                    placeholder="Sin precio"
                    class="w-full"
                    data-qa="compra-precio"
                  />
                </UFormField>
                <div class="md:col-span-2 flex items-center justify-between gap-2">
                  <span class="text-sm tabular-nums text-muted" data-qa="compra-total-linea">
                    {{ totalLinea(linea.cantidad, linea.precioUnitario || null) != null
                      ? formatMonto(totalLinea(linea.cantidad, linea.precioUnitario || null))
                      : '—' }}
                  </span>
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    size="sm"
                    @click="quitarLinea(linea.key)"
                  />
                </div>
              </div>

              <p
                v-if="cuentaDeLinea(linea)"
                class="text-xs text-muted"
                data-qa="compra-cuenta-presentacion"
              >
                {{ cuentaDeLinea(linea) }}
              </p>

              <div v-if="linea.dte" class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted" data-qa="compra-dte-texto">{{ linea.dte.texto }}</span>
                  <UBadge
                    v-if="linea.dte.calzo"
                    label="Calzó por código"
                    color="neutral"
                    variant="subtle"
                    data-qa="compra-dte-calzo"
                  />
                  <UBadge
                    v-else
                    label="Por asociar"
                    color="warning"
                    variant="subtle"
                    data-qa="compra-dte-por-asociar"
                  />
                </div>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  data-qa="compra-dte-no-mercaderia"
                  @click="apartarLinea(linea.key)"
                >
                  No es mercadería
                </UButton>
              </div>
              <p v-if="linea.dte?.nota" class="text-xs text-muted" data-qa="compra-dte-nota">
                {{ linea.dte.nota }}
              </p>
              <p v-if="linea.dte?.conAjusteDeLinea" class="text-xs text-muted" data-qa="compra-dte-ajuste">
                Incluye el descuento o recargo de la línea de la factura
              </p>

              <UFormField
                v-if="linea.modoInventario === 'serie'"
                label="Series (una por renglón)"
              >
                <UTextarea
                  :model-value="linea.seriesTexto"
                  :rows="3"
                  class="w-full"
                  @update:model-value="(v: string) => onSeriesChange(linea, v)"
                />
              </UFormField>
              <div v-if="linea.modoInventario === 'lote'" class="grid grid-cols-2 gap-3">
                <UFormField label="Lote" required>
                  <UInput v-model="linea.codigoLote" placeholder="Código del lote" class="w-full" />
                </UFormField>
                <UFormField label="Vence">
                  <UInput v-model="linea.fechaVencimiento" type="date" class="w-full" />
                </UFormField>
              </div>
            </div>

            <UCollapsible v-if="apartadas.length" :unmount-on-hide="false" data-qa="compra-dte-apartadas">
              <UButton
                label="No se cargan (no es mercadería)"
                color="neutral"
                variant="ghost"
                trailing-icon="i-lucide-chevron-down"
              />
              <template #content>
                <ul class="divide-y divide-default">
                  <li
                    v-for="ap in apartadas"
                    :key="ap.clave"
                    class="flex items-center justify-between py-2 text-sm"
                  >
                    <span data-qa="compra-dte-apartada-texto">
                      {{ ap.descripcion }} · {{ ap.montoItem != null ? formatMonto(ap.montoItem) : '—' }}
                    </span>
                    <UButton
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      data-qa="compra-dte-traer-de-vuelta"
                      @click="traerDeVuelta(ap)"
                    >
                      Traer de vuelta
                    </UButton>
                  </li>
                </ul>
              </template>
            </UCollapsible>

            <p v-if="lineasPorAsociar.length" class="text-xs text-warning" data-qa="compra-dte-por-asociar-pie">
              Faltan {{ lineasPorAsociar.length }} {{ lineasPorAsociar.length === 1 ? 'línea' : 'líneas' }} por asociar
            </p>
          </div>

          <div class="flex flex-col items-end gap-2 border-t border-default pt-4">
            <div class="flex items-center gap-3 text-sm">
              <span class="text-muted">Subtotal</span>
              <span class="tabular-nums" data-qa="compra-subtotal">
                {{ subtotalMostrado != null ? formatMonto(subtotalMostrado) : '—' }}
              </span>
            </div>
            <UFormField label="Descuento al total" class="w-56">
              <MoneyInput
                v-model="form.descuentoTotal"
                oficial
                :disabled="!descuentoHabilitado"
                class="w-full"
                data-qa="compra-descuento"
              />
            </UFormField>
            <p v-if="!descuentoHabilitado" class="text-xs text-muted" data-qa="compra-descuento-ayuda">
              Se carga cuando todas las líneas tienen precio.
            </p>
            <div class="flex items-center gap-3 text-sm font-medium">
              <span>Total</span>
              <span class="tabular-nums" data-qa="compra-total">
                {{ totalMostrado != null ? formatMonto(totalMostrado) : '—' }}
              </span>
            </div>
            <p v-if="faltanPrecios" class="text-xs text-muted">
              Hay líneas sin precio: entran igual y se completan cuando llegue la factura.
            </p>
          </div>

          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              v-if="!esNueva"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              @click="() => { descartarOpen = true }"
            >
              Descartar
            </UButton>
            <UButton
              icon="i-lucide-package-check"
              color="success"
              :disabled="!puedeConfirmar || guardando"
              data-qa="compra-confirmar"
              @click="() => { confirmarOpen = true }"
            >
              Confirmar recepción
            </UButton>
            <UButton
              type="submit"
              form="compra-form"
              icon="i-lucide-save"
              :loading="guardando"
              :disabled="!puedeGuardar"
              data-qa="compra-guardar"
            >
              Guardar borrador
            </UButton>
          </div>
        </UForm>

        <!-- ── Confirmada o anulada ────────────────────────────────────────── -->
        <ComprasCompraConfirmada
          v-else-if="compra"
          :compra="compra"
          :total-documento-tipo="totalDocumentoTipo"
          @actualizada="llenarDesde"
        />

        <UModal v-model:open="confirmarOpen" title="¿Confirmar la recepción?">
          <template #body>
            <div class="space-y-2 text-sm text-default" data-qa="compra-confirmar-resumen">
              <p>
                Entran {{ lineasCargadas.length }} {{ lineasCargadas.length === 1 ? 'línea' : 'líneas' }}
                a <strong>{{ ubicacionNombre }}</strong>: el stock sube ahora.
              </p>
              <p v-if="lineasSinPrecio > 0" class="text-muted">
                {{ lineasSinPrecio }} {{ lineasSinPrecio === 1 ? 'línea entra' : 'líneas entran' }} sin precio:
                el costo se completa cuando llegue la factura.
              </p>
              <p class="text-muted">
                Una compra confirmada ya no se edita como borrador.
              </p>
            </div>

            <!-- Solo con `Pagar` (spec § 7, decisión 12): sin el permiso el
                 backend rechaza `pago` con 403, así que acá no se pregunta. -->
            <div v-if="puedePagar" class="mt-4 border-t border-default pt-4" data-qa="compra-pago-seccion">
              <p class="text-sm font-medium mb-2">
                ¿La pagaste ya?
              </p>
              <URadioGroup
                v-model="pagarAhora"
                :items="pagoOpciones"
                value-key="value"
                orientation="horizontal"
                data-qa="compra-pago-si-no"
              />
              <div v-if="pagarAhora" class="mt-3 flex flex-col gap-3">
                <UFormField label="Medio de pago">
                  <USelectMenu
                    v-model="pagoMedioId"
                    :items="medioPagoOpts"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    data-qa="compra-pago-medio"
                  />
                </UFormField>
                <UFormField label="Monto">
                  <MoneyInput v-model="pagoMonto" oficial class="w-full" data-qa="compra-pago-monto" />
                </UFormField>
                <UFormField label="Referencia (opcional)">
                  <UInput v-model="pagoReferencia" class="w-full" data-qa="compra-pago-referencia" />
                </UFormField>
                <p v-if="medioEsEfectivo" class="text-xs text-muted" data-qa="compra-pago-aviso-efectivo">
                  Sale de tu caja física abierta: si no tenés una, abrila antes de confirmar.
                </p>
              </div>
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2 w-full">
              <UButton variant="ghost" @click="() => { confirmarOpen = false }">
                Cancelar
              </UButton>
              <UButton
                color="success"
                :loading="guardando"
                :disabled="!puedeEnviarConfirmar"
                data-qa="compra-confirmar-si"
                @click="confirmarRecepcion"
              >
                Confirmar recepción
              </UButton>
            </div>
          </template>
        </UModal>

        <UModal v-model:open="descartarOpen" title="¿Descartar este borrador?">
          <template #body>
            <p class="text-sm text-default">
              Se borra el borrador con sus líneas. No se movió stock ni costo, así que no hay nada más que deshacer.
            </p>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2 w-full">
              <UButton variant="ghost" @click="() => { descartarOpen = false }">
                Cancelar
              </UButton>
              <UButton color="error" @click="descartar">
                Descartar
              </UButton>
            </div>
          </template>
        </UModal>

        <ComprasPresentacionModal
          v-if="lineaEnPresentacion"
          v-model:open="presentacionModalOpen"
          :proveedor-id="form.proveedorId"
          :item="itemDeLinea(lineaEnPresentacion)"
          :presentacion="presentacionEnEdicion"
          @guardada="onPresentacionGuardada"
          @retirada="onPresentacionRetirada"
        />

        <ComprasCargarDteModal
          v-if="esNueva && editable"
          v-model:open="cargarDteModalOpen"
          :proveedores="proveedores"
          @cargar="onCargarDte"
        />

        <UModal v-model:open="reemplazarConfirmOpen" title="¿Reemplazar lo que ya tipeaste?">
          <template #body>
            <p class="text-sm text-default" data-qa="compra-reemplazar-resumen">
              Ya hay un proveedor o una línea con producto: cargar el XML reemplaza todo lo que
              tipeaste en el formulario.
            </p>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2 w-full">
              <UButton variant="ghost" color="neutral" @click="() => { reemplazarConfirmOpen = false }">
                Cancelar
              </UButton>
              <UButton data-qa="compra-reemplazar-si" @click="confirmarReemplazo">
                Reemplazar
              </UButton>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
