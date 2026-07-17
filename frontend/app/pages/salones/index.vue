<script setup lang="ts">
import Decimal from 'decimal.js'
import { descontarStockCatalogo, type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'
import {
  cuentaToCalcularInput,
  precioUnitarioLinea,
  type SalonConMesas,
  type MesaResumen,
  type CuentaDetalle,
  type CuentaLineaDetalle,
  type CuentaAsignacionDetalle,
  type MotivoCuentaAsignacion,
} from '~/composables/useSalones'
import type { Garzon } from '~/composables/useGarzones'
import type { PersonalizacionPayload } from '~/composables/useRecetaPersonalizacion'
import type { Turno } from '~/composables/useTurnos'
import { formatCantidadTicket, unidadBaseItem } from '~/utils/cantidad-presentacion'
import { shellUi } from '~/utils/ui-shell'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface TipoDoc { id: string, nombre: string, customerRequerido: boolean }
interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const toast = useToast()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const cajaStore = useCajaStore()
const salonesApi = useSalones()
const garzonesApi = useGarzones()
const turnosApi = useTurnos()
const sesionesApi = useSesionesGarzon()
const permissionsStore = usePermissionsStore()
const unidadesStore = useUnidadesMedidaStore()
const { calcular } = useCalculoPrecios()
const { formatMonto, formatFecha } = useFormatters()
const impresorasApi = useImpresoras()
const tenantStore = useTenantStore()

const enviandoComanda = ref(false)
const imprimiendoPrecuenta = ref(false)

const salones = ref<SalonConMesas[]>([])
const loading = ref(false)
const selectedSalonId = ref<string | undefined>(undefined)

const items = ref<ItemCatalogo[]>([])
const metodos = ref<MetodoPago[]>([])
const tiposDocumento = ref<TipoDoc[]>([])
const loadingCatalogo = ref(false)

const selectedMesa = ref<MesaResumen | null>(null)
const mesaDrawerOpen = ref(false)
const cuentas = ref<CuentaDetalle[]>([])
const loadingCuentas = ref(false)
const activeCuenta = ref<CuentaDetalle | null>(null)

/** Catálogo restando lo ya pedido en las cuentas abiertas de la mesa (stock / disponible). */
const itemsVisibles = computed(() => {
  const reservas = cuentas.value.flatMap(c =>
    c.lineas.map(l => ({ item: { id: l.itemId }, cantidad: l.cantidad })),
  )
  return descontarStockCatalogo(items.value, reservas)
})
const resultado = ref<ResultadoVenta | null>(null)

const fusionMode = ref(false)
const seleccionadasFusion = ref<string[]>([])
const fusionando = ref(false)

const cobroOpen = ref(false)
const submitting = ref(false)
const cancelOpen = ref(false)
const recetaDrawerOpen = ref(false)
const recetaItemId = ref<string | null>(null)

const puedeTransferirAdmin = computed(
  () => permissionsStore.esAdmin
    || permissionsStore.can('Salones', 'Actualizar'),
)

const transferAdminOpen = ref(false)
const transferAdminGarzonId = ref<string | undefined>()
const garzonesActivos = ref<Garzon[]>([])
const garzonesCargados = ref(false)
const transfiriendo = ref(false)

const historialOpen = ref(false)
const historialLoading = ref(false)
const asignaciones = ref<CuentaAsignacionDetalle[]>([])

const garzonesTransferibles = computed(() => {
  const responsableId = activeCuenta.value?.garzonResponsableId
  return garzonesActivos.value.filter(g => g.id !== responsableId)
})

const garzonTransferItems = computed(() =>
  garzonesTransferibles.value.map(g => ({ label: g.nombre, value: g.id })),
)

const motivoAsignacionLabel: Record<MotivoCuentaAsignacion, string> = {
  apertura: 'Apertura',
  transferencia_pin: 'Transferencia',
  transferencia_admin: 'Transferencia admin',
}

// ── Identificación de garzón por PIN ───────────────────────────────────────
const pinModalOpen = ref(false)
const pinModalTitle = ref('Identifícate con tu PIN')
let pinAction: ((pin: string, nombre: string) => void) | null = null

function solicitarPin(
  title: string,
  action: (pin: string, nombre: string) => void,
) {
  pinModalTitle.value = title
  pinAction = action
  pinModalOpen.value = true
}

function onPinConfirmado(pin: string, nombre: string) {
  const action = pinAction
  pinAction = null
  action?.(pin, nombre)
}

// ── Entrar / salir de turno ──────────────────────────────────────────────────
const turnoModalOpen = ref(false)
const turnosActivos = ref<Turno[]>([])
const turnoSeleccionadoId = ref<string | undefined>(undefined)
const cargandoTurnos = ref(false)
const turnoItems = computed(() =>
  turnosActivos.value.map(t => ({
    label: `${t.nombre} (${t.horaInicio}–${t.horaFin})`,
    value: t.id,
  })),
)

async function abrirEntrarTurno() {
  cargandoTurnos.value = true
  turnoSeleccionadoId.value = undefined
  try {
    const todos = await turnosApi.listar()
    turnosActivos.value = todos.filter(t => t.activo)
    if (turnosActivos.value.length === 0) {
      toast.add({ title: 'No hay turnos activos configurados', color: 'warning' })
      return
    }
    turnoSeleccionadoId.value = turnosActivos.value[0]?.id
    turnoModalOpen.value = true
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar turnos'), color: 'error' })
  }
  finally {
    cargandoTurnos.value = false
  }
}

/** Toast de error; si falta sesión de trabajo, ofrece CTA para entrar a turno. */
function toastErrorOperativo(e: unknown, fallback: string) {
  const msg = apiErrorMsg(e, fallback)
  if (msg.includes('sesión de trabajo')) {
    toast.add({
      title: msg,
      color: 'error',
      actions: [{
        label: 'Entrar a turno',
        color: 'neutral',
        variant: 'outline',
        onClick: () => { void abrirEntrarTurno() },
      }],
    })
    return
  }
  toast.add({ title: msg, color: 'error' })
}

function confirmarEntrarTurno() {
  const turnoId = turnoSeleccionadoId.value
  if (!turnoId) return
  turnoModalOpen.value = false
  solicitarPin('PIN del garzón para entrar a turno', (pin) => {
    void iniciarSesionConPin(pin, turnoId)
  })
}

async function iniciarSesionConPin(pin: string, turnoId: string) {
  try {
    const sesion = await sesionesApi.iniciar({ pin, turnoId })
    toast.add({
      title: `Sesión iniciada: ${sesion.garzonNombre} · ${sesion.turnoNombre}`,
      color: 'success',
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al iniciar sesión'), color: 'error' })
  }
}

function salirDeTurno() {
  solicitarPin('PIN del garzón para salir de turno', (pin) => {
    void cerrarSesionConPin(pin)
  })
}

async function cerrarSesionConPin(pin: string) {
  try {
    const sesion = await sesionesApi.cerrar({ pin })
    toast.add({
      title: `Sesión cerrada: ${sesion.garzonNombre} · ${sesion.turnoNombre}`,
      color: 'success',
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cerrar sesión'), color: 'error' })
  }
}

const selectedSalon = computed(() =>
  salones.value.find(s => s.id === selectedSalonId.value) ?? null,
)
const salonItems = computed(() =>
  salones.value.map(s => ({ label: s.nombre, value: s.id })),
)
const tieneCaja = computed(() => cajaStore.activa !== null)
const totalFinal = computed(() => resultado.value?.totales.totalFinal ?? '0')

// En el detalle de cuenta cada columna scrollea internamente (catálogo / líneas),
// así que el body del drawer no debe scrollear como unidad (evita el doble scroll).
const drawerBodyUi = computed(() => ({
  body: activeCuenta.value
    ? 'flex-1 min-h-0 overflow-hidden px-6 py-4'
    : 'flex-1 min-h-0 overflow-y-auto px-6 py-4',
}))

async function cargarSalones() {
  loading.value = true
  try {
    salones.value = await salonesApi.listarOperacion()
    if (!selectedSalonId.value || !selectedSalon.value) {
      selectedSalonId.value = salones.value[0]?.id ?? undefined
    }
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar salones'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

/** Ajusta el contador de cuentas abiertas/ocupación sin re-fetch de salones. */
function patchMesaOcupacion(mesaId: string, deltaAbiertas: number) {
  for (const salon of salones.value) {
    const mesa = salon.mesas.find(m => m.id === mesaId)
    if (!mesa) continue
    mesa.cuentasAbiertas = Math.max(0, mesa.cuentasAbiertas + deltaAbiertas)
    mesa.ocupada = mesa.cuentasAbiertas > 0
    if (selectedMesa.value?.id === mesaId) {
      selectedMesa.value = { ...mesa }
    }
    break
  }
}

async function cargarCatalogo() {
  loadingCatalogo.value = true
  try {
    // Solo tipos vendibles (producto + receta). Los ingredientes (y resto) no van al catálogo.
    const [productosRes, recetasRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=receta&pageSize=100`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    items.value = [...productosRes.data, ...recetasRes.data]
    metodos.value = metodosRes
    tiposDocumento.value = tiposRes
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar el catálogo'), color: 'error' })
  }
  finally {
    loadingCatalogo.value = false
  }
}

onMounted(async () => {
  await Promise.all([cajaStore.cargarActiva(), cargarSalones(), cargarCatalogo(), unidadesStore.ensureLoaded()])
})

// ── Selección de mesa ──────────────────────────────────────────────────────
async function onSelectMesa(mesa: MesaResumen) {
  selectedMesa.value = mesa
  activeCuenta.value = null
  resultado.value = null
  fusionMode.value = false
  seleccionadasFusion.value = []
  mesaDrawerOpen.value = true
  await cargarCuentas(mesa.id)
}

async function cargarCuentas(mesaId: string) {
  loadingCuentas.value = true
  try {
    cuentas.value = await salonesApi.listarCuentas(mesaId)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar cuentas'), color: 'error' })
  }
  finally {
    loadingCuentas.value = false
  }
}

async function recalcular() {
  const cuenta = activeCuenta.value
  if (!cuenta || cuenta.lineas.length === 0) {
    resultado.value = null
    return
  }
  try {
    resultado.value = await calcular(cuentaToCalcularInput(cuenta))
  }
  catch {
    resultado.value = null
  }
}

function nuevaCuenta() {
  if (!selectedMesa.value) return
  solicitarPin('PIN del garzón para abrir la cuenta', (pin, nombre) => {
    void abrirCuentaConPin(pin, nombre)
  })
}

async function abrirCuentaConPin(pin: string, nombre: string) {
  if (!selectedMesa.value) return
  try {
    const mesaId = selectedMesa.value.id
    const cuenta = await salonesApi.abrirCuenta(mesaId, pin)
    cuentas.value.push(cuenta)
    patchMesaOcupacion(mesaId, 1)
    abrirCuenta(cuenta)
    toast.add({ title: `Cuenta abierta por ${nombre}`, color: 'success' })
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'Error al abrir la cuenta')
  }
}

function abrirCuenta(cuenta: CuentaDetalle) {
  if (fusionMode.value) {
    toggleSeleccionFusion(cuenta)
    return
  }
  activeCuenta.value = cuenta
  void recalcular()
}

function volverACuentas() {
  activeCuenta.value = null
  resultado.value = null
}

// ── Fusionar cuentas (ej. "1 y 3", "3 y 4" o todas) ────────────────────────
function toggleFusionMode() {
  fusionMode.value = !fusionMode.value
  seleccionadasFusion.value = []
}

function toggleSeleccionFusion(cuenta: CuentaDetalle) {
  const idx = seleccionadasFusion.value.indexOf(cuenta.id)
  if (idx === -1) seleccionadasFusion.value.push(cuenta.id)
  else seleccionadasFusion.value.splice(idx, 1)
}

function seleccionarTodasFusion() {
  seleccionadasFusion.value = cuentas.value.map(c => c.id)
}

async function fusionarSeleccionadas() {
  if (!selectedMesa.value || seleccionadasFusion.value.length < 2) return
  fusionando.value = true
  try {
    const fusedIds = new Set(seleccionadasFusion.value)
    const cuenta = await salonesApi.fusionarCuentas(selectedMesa.value.id, seleccionadasFusion.value)
    const eliminadas = cuentas.value.filter(c => fusedIds.has(c.id) && c.id !== cuenta.id).length
    cuentas.value = [
      cuenta,
      ...cuentas.value.filter(c => !fusedIds.has(c.id)),
    ]
    if (eliminadas > 0) {
      patchMesaOcupacion(selectedMesa.value.id, -eliminadas)
    }
    toast.add({ title: `Cuentas fusionadas en Cuenta ${cuenta.numero}`, color: 'success' })
    fusionMode.value = false
    seleccionadasFusion.value = []
    activeCuenta.value = cuenta
    void recalcular()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al fusionar las cuentas'), color: 'error' })
  }
  finally {
    fusionando.value = false
  }
}

function syncCuenta(cuenta: CuentaDetalle) {
  activeCuenta.value = cuenta
  const idx = cuentas.value.findIndex(c => c.id === cuenta.id)
  if (idx !== -1) cuentas.value[idx] = cuenta
  void recalcular()
}

function aplicarCuentaActualizada(actualizada: CuentaDetalle) {
  cuentas.value = cuentas.value.map(c =>
    c.id === actualizada.id ? actualizada : c,
  )
  if (activeCuenta.value?.id === actualizada.id) {
    activeCuenta.value = actualizada
  }
}

function tomarCuenta() {
  if (!activeCuenta.value) return
  solicitarPin('PIN para tomar esta cuenta', (pin) => {
    void transferirCuentaConPin(pin)
  })
}

async function transferirCuentaConPin(pin: string) {
  const cuenta = activeCuenta.value
  if (!cuenta || transfiriendo.value) return
  transfiriendo.value = true
  try {
    const actualizada = await salonesApi.transferirCuenta(cuenta.id, pin)
    aplicarCuentaActualizada(actualizada)
    toast.add({
      title: `Cuenta tomada por ${actualizada.garzonResponsableNombre ?? 'garzón'}`,
      color: 'success',
    })
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'No se pudo tomar la cuenta')
  }
  finally {
    transfiriendo.value = false
  }
}

async function abrirTransferenciaAdmin() {
  if (!activeCuenta.value) return
  if (!garzonesCargados.value) {
    try {
      const todos = await garzonesApi.listar()
      garzonesActivos.value = todos.filter(g => g.activo)
      garzonesCargados.value = true
    }
    catch (e: unknown) {
      toast.add({
        title: apiErrorMsg(e, 'No se pudieron cargar los garzones'),
        color: 'error',
      })
      return
    }
  }
  transferAdminGarzonId.value = garzonesTransferibles.value[0]?.id
  transferAdminOpen.value = true
}

async function confirmarTransferenciaAdmin() {
  const cuenta = activeCuenta.value
  const garzonId = transferAdminGarzonId.value
  if (!cuenta || !garzonId || transfiriendo.value) return
  transfiriendo.value = true
  try {
    const actualizada = await salonesApi.transferirCuentaAdmin(cuenta.id, garzonId)
    aplicarCuentaActualizada(actualizada)
    transferAdminOpen.value = false
    toast.add({ title: 'Responsable actualizado', color: 'success' })
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'No se pudo transferir la cuenta')
  }
  finally {
    transfiriendo.value = false
  }
}

async function abrirHistorial() {
  const cuenta = activeCuenta.value
  if (!cuenta) return
  historialOpen.value = true
  historialLoading.value = true
  try {
    asignaciones.value = await salonesApi.listarAsignaciones(cuenta.id)
  }
  catch (e: unknown) {
    toast.add({
      title: apiErrorMsg(e, 'No se pudo cargar el historial'),
      color: 'error',
    })
  }
  finally {
    historialLoading.value = false
  }
}

// ── Líneas de la cuenta ────────────────────────────────────────────────────
function personalizacionVacia(p: PersonalizacionPayload): boolean {
  return p.omitidos.length === 0 && p.extras.length === 0 && !p.comentario?.trim()
}

const pendingByLinea = new Map<string, ReturnType<typeof setTimeout>>()
const inflight = ref(new Set<string>())

function unidadBaseLinea(linea: CuentaLineaDetalle): string {
  const catalogItem = items.value.find(i => i.id === linea.itemId)
  return catalogItem ? unidadBaseItem(catalogItem) : 'unidad'
}

function presentacionLinea(linea: CuentaLineaDetalle): string {
  return linea.cantidadPresentacion ?? linea.cantidad
}

function unidadPresLinea(linea: CuentaLineaDetalle): string {
  return linea.unidadCodigoPresentacion ?? unidadBaseLinea(linea)
}

function patchLineaOptimista(
  lineaId: string,
  payload: { presentacion: string, unidadCodigo: string, cantidadCanonica: string },
) {
  if (!activeCuenta.value) return
  const cuentaId = activeCuenta.value.id
  const patched: CuentaDetalle = {
    ...activeCuenta.value,
    lineas: activeCuenta.value.lineas.map(l =>
      l.id === lineaId
        ? {
            ...l,
            cantidad: payload.cantidadCanonica,
            cantidadPresentacion: payload.presentacion,
            unidadCodigoPresentacion: payload.unidadCodigo,
          }
        : l,
    ),
  }
  activeCuenta.value = patched
  const idx = cuentas.value.findIndex(c => c.id === cuentaId)
  if (idx !== -1) cuentas.value[idx] = patched
  void recalcular()
}

async function patchLineaCantidad(
  lineaId: string,
  payload: { presentacion: string, unidadCodigo: string, cantidadCanonica: string },
) {
  if (!activeCuenta.value) return
  const cuentaId = activeCuenta.value.id
  const snapshot = structuredClone(activeCuenta.value)

  inflight.value.add(lineaId)
  try {
    const cuenta = await salonesApi.actualizarLinea(cuentaId, lineaId, {
      cantidad: payload.cantidadCanonica,
      cantidadPresentacion: payload.presentacion,
      unidadCodigoPresentacion: payload.unidadCodigo,
    })
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    syncCuenta(snapshot)
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar la cantidad'), color: 'error' })
  }
  finally {
    inflight.value.delete(lineaId)
  }
}

function onCantidadChange(
  linea: CuentaLineaDetalle,
  payload: { presentacion: string, unidadCodigo: string, cantidadCanonica: string },
) {
  if (!activeCuenta.value || new Decimal(payload.cantidadCanonica || '0').lte(0)) return

  patchLineaOptimista(linea.id, payload)

  const prev = pendingByLinea.get(linea.id)
  if (prev) clearTimeout(prev)

  pendingByLinea.set(
    linea.id,
    setTimeout(() => {
      pendingByLinea.delete(linea.id)
      void patchLineaCantidad(linea.id, payload)
    }, 300),
  )
}

async function flushPendientes() {
  const pendientes = [...pendingByLinea.entries()]
  for (const [lineaId, timer] of pendientes) {
    clearTimeout(timer)
    pendingByLinea.delete(lineaId)
    const linea = activeCuenta.value?.lineas.find(l => l.id === lineaId)
    if (!linea) continue
    await patchLineaCantidad(lineaId, {
      presentacion: linea.cantidadPresentacion ?? linea.cantidad,
      unidadCodigo: linea.unidadCodigoPresentacion ?? unidadBaseLinea(linea),
      cantidadCanonica: linea.cantidad,
    })
  }
  while (inflight.value.size > 0) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

async function addProducto(item: ItemCatalogo) {
  if (!activeCuenta.value) return
  if (item.tipo === 'receta') {
    recetaItemId.value = item.id
    recetaDrawerOpen.value = true
    return
  }
  try {
    const cuenta = await salonesApi.agregarLinea(activeCuenta.value.id, item.id, '1')
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al agregar el producto'), color: 'error' })
  }
}

async function onRecetaConfirm(payload: PersonalizacionPayload, _resumen: string, _precioPreview?: string) {
  if (!activeCuenta.value || !recetaItemId.value) return
  try {
    const personalizacion = personalizacionVacia(payload) ? undefined : payload
    const cuenta = await salonesApi.agregarLinea(
      activeCuenta.value.id,
      recetaItemId.value,
      '1',
      personalizacion,
    )
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al agregar la receta'), color: 'error' })
  }
  finally {
    recetaDrawerOpen.value = false
    recetaItemId.value = null
  }
}


async function quitarLinea(linea: CuentaLineaDetalle) {
  if (!activeCuenta.value) return
  try {
    const cuenta = await salonesApi.quitarLinea(activeCuenta.value.id, linea.id)
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al quitar el producto'), color: 'error' })
  }
}

function lineaSubtotal(linea: CuentaLineaDetalle): string {
  return new Decimal(precioUnitarioLinea(linea)).times(linea.cantidad || '0').toString()
}

// ── Comanda / precuenta ─────────────────────────────────────────────────────
async function enviarComanda() {
  if (!activeCuenta.value || !selectedMesa.value) return
  enviandoComanda.value = true
  try {
    await flushPendientes()
    const estaciones = await impresorasApi.imprimirComanda(activeCuenta.value.id, {
      mesaNombre: selectedMesa.value.nombre,
      cuentaNumero: activeCuenta.value.numero,
      garzonNombre: activeCuenta.value.garzonAperturaNombre,
    })
    // null = no hay impresoras de comanda activas → se saltó el flujo sin toast.
    if (estaciones === null) return
    toast.add({
      title: estaciones.length === 0
        ? 'No hay productos nuevos para enviar'
        : `Comanda enviada a ${estaciones.length} estación(es)`,
      color: estaciones.length === 0 ? 'neutral' : 'success',
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al enviar la comanda (¿QZ Tray está abierto?)'), color: 'error' })
  }
  finally {
    enviandoComanda.value = false
  }
}

// Recibe el resultado explícito (no lee `resultado.value` vivo): al cerrar la cuenta
// el ref puede recomputarse, así que el llamador pasa el snapshot que capturó.
function itemsParaTicket(cuenta: CuentaDetalle, res: ResultadoVenta) {
  // Mismo orden que cuentaToCalcularInput (índice 1:1); find por itemId falla
  // si hay dos líneas del mismo ítem con distinta personalización.
  return res.lineas.map((l, i) => {
    const cl = cuenta.lineas[i]
    const cantidadTicket = cl?.cantidadPresentacion && cl?.unidadCodigoPresentacion
      ? formatCantidadTicket(cl.cantidadPresentacion, cl.unidadCodigoPresentacion)
      : l.cantidad
    return {
      nombre: cl?.nombre ?? '',
      cantidad: cantidadTicket,
      totalLinea: l.totalLinea,
      ...(cl?.personalizacionTexto ? { nota: cl.personalizacionTexto } : {}),
    }
  })
}

async function imprimirPrecuenta() {
  if (!activeCuenta.value || !selectedMesa.value || !resultado.value) return
  imprimiendoPrecuenta.value = true
  try {
    await impresorasApi.imprimirPrecuenta({
      tenantNombre: tenantStore.activeTenant?.nombre ?? '',
      mesaNombre: selectedMesa.value.nombre,
      cuentaNumero: activeCuenta.value.numero,
      items: itemsParaTicket(activeCuenta.value, resultado.value),
      totales: resultado.value.totales,
      formatMonto: (v: string) => formatMonto(v),
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al imprimir la precuenta (¿QZ Tray está abierto?)'), color: 'error' })
  }
  finally {
    imprimiendoPrecuenta.value = false
  }
}

// ── Cancelar / cerrar cuenta ───────────────────────────────────────────────
async function confirmarCancelar() {
  if (!activeCuenta.value || !selectedMesa.value) return
  try {
    const mesaId = selectedMesa.value.id
    await salonesApi.cancelarCuenta(activeCuenta.value.id)
    toast.add({ title: 'Cuenta cancelada', color: 'success' })
    cuentas.value = cuentas.value.filter(c => c.id !== activeCuenta.value?.id)
    patchMesaOcupacion(mesaId, -1)
    volverACuentas()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cancelar la cuenta'), color: 'error' })
  }
  finally {
    cancelOpen.value = false
  }
}

function confirmarCobro(pagos: PagoInput[]) {
  if (!activeCuenta.value) return
  // El cobro recolecta los pagos; el PIN identifica al garzón que cierra.
  cobroOpen.value = false
  solicitarPin('PIN del garzón para cerrar la cuenta', (pin) => {
    void (async () => {
      await flushPendientes()
      await cerrarCuentaConPin(pagos, pin)
    })()
  })
}

async function cerrarCuentaConPin(pagos: PagoInput[], pin: string) {
  if (!activeCuenta.value) return
  submitting.value = true
  const cuentaCerrada = activeCuenta.value
  const resultadoCerrado = resultado.value
  try {
    await salonesApi.cerrarCuenta(cuentaCerrada.id, {
      pin,
      pagos,
      tipoDocumentoId: tiposDocumento.value[0]?.id,
    })
    toast.add({ title: 'Cuenta cerrada — venta generada', color: 'success' })

    if (resultadoCerrado) {
      try {
        await impresorasApi.imprimirBoleta({
          tenantNombre: tenantStore.activeTenant?.nombre ?? '',
          items: itemsParaTicket(cuentaCerrada, resultadoCerrado),
          totales: resultadoCerrado.totales,
          pagos: pagos.map(p => ({
            nombre: metodos.value.find(m => m.metodoPagoId === p.metodoPagoId)?.nombre ?? '',
            monto: p.monto,
          })),
          formatMonto: (v: string) => formatMonto(v),
        })
      }
      catch (e: unknown) {
        toast.add({ title: apiErrorMsg(e, 'Venta generada, pero falló la impresión de la boleta'), color: 'warning' })
      }
    }

    cuentas.value = cuentas.value.filter(c => c.id !== cuentaCerrada.id)
    if (selectedMesa.value) {
      patchMesaOcupacion(selectedMesa.value.id, -1)
    }
    const pagosConMonto = pagos.filter(p => new Decimal(p.monto || '0').gt(0))
    const bruto = pagosConMonto.reduce(
      (acc, p) => acc.plus(p.monto || '0'),
      new Decimal(0),
    )
    // Vuelto no viene en el cierre de cuenta aquí; el neto se aproxima con el total cobrado.
    const neto = resultadoCerrado
      ? Decimal.min(bruto, new Decimal(resultadoCerrado.totales.totalFinal)).toFixed(4)
      : bruto.toFixed(4)
    cajaStore.aplicarCobroLocal(neto, pagosConMonto.length)
    volverACuentas()
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'Error al cerrar la cuenta')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Salones">
        <template #right>
          <UBadge
            v-if="tieneCaja"
            label="Caja abierta"
            color="success"
            variant="soft"
            icon="i-lucide-banknote"
            class="mr-2"
          />
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <div v-if="loading" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader" class="h-8 w-8 animate-spin text-muted" />
        </div>

        <div v-else-if="salones.length === 0" class="py-12 text-center text-sm text-muted">
          No hay salones configurados. Pídele a un administrador que los cree.
        </div>

        <template v-else>
          <div class="flex flex-wrap items-center gap-3">
            <USelectMenu
              v-model="selectedSalonId"
              :items="salonItems"
              value-key="value"
              class="w-56"
            />
            <p class="text-sm text-muted flex-1 min-w-40">
              Selecciona una mesa para gestionar sus cuentas.
            </p>
            <div class="flex flex-wrap items-center gap-2 ml-auto">
              <UButton
                icon="i-lucide-log-in"
                color="neutral"
                variant="soft"
                :loading="cargandoTurnos"
                @click="abrirEntrarTurno"
              >
                Entrar a turno
              </UButton>
              <UButton
                icon="i-lucide-log-out"
                color="neutral"
                variant="outline"
                @click="salirDeTurno"
              >
                Salir de turno
              </UButton>
            </div>
          </div>

          <SalonesSalonPlano
            v-if="selectedSalon"
            :mesas="selectedSalon.mesas"
            @select="onSelectMesa"
          />
        </template>
      </div>

      <!-- Drawer de la mesa: lista de cuentas o detalle de una cuenta -->
      <AppDrawer v-model:open="mesaDrawerOpen" width="90%" :ui="drawerBodyUi">
        <template #header>
          <div class="flex items-center gap-2 sm:gap-3">
            <UButton
              v-if="activeCuenta"
              icon="i-lucide-arrow-left"
              label="Cuentas"
              color="neutral"
              variant="subtle"
              size="sm"
              @click="volverACuentas"
            />
            <span class="font-semibold text-default">
              {{ selectedMesa?.nombre }}
              <template v-if="activeCuenta"> — Cuenta {{ activeCuenta.numero }}</template>
            </span>
            <span
              v-if="activeCuenta?.garzonResponsableNombre"
              class="flex items-center gap-1 text-xs text-muted"
            >
              <UIcon name="i-lucide-user" class="size-3" />
              Responsable: {{ activeCuenta.garzonResponsableNombre }}
            </span>
          </div>
        </template>

        <template #body>
          <!-- Lista de cuentas de la mesa -->
          <div v-if="!activeCuenta" class="space-y-4">
            <div class="flex flex-wrap items-center justify-end gap-2">
              <UButton
                v-if="cuentas.length >= 2"
                icon="i-lucide-merge"
                color="neutral"
                :variant="fusionMode ? 'solid' : 'soft'"
                @click="toggleFusionMode"
              >
                {{ fusionMode ? 'Cancelar fusión' : 'Fusionar cuentas' }}
              </UButton>
              <UButton icon="i-lucide-plus" @click="nuevaCuenta">
                Nueva cuenta
              </UButton>
            </div>

            <div v-if="fusionMode" class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-muted p-3">
              <p class="text-sm text-muted">
                Selecciona las cuentas a combinar (ej. 1 y 3, 3 y 4, o todas). Se fusionan en la de menor número.
              </p>
              <div class="ml-auto flex items-center gap-2">
                <UButton size="sm" color="neutral" variant="ghost" @click="seleccionarTodasFusion">
                  Todas
                </UButton>
                <UButton
                  size="sm"
                  :disabled="seleccionadasFusion.length < 2"
                  :loading="fusionando"
                  @click="fusionarSeleccionadas"
                >
                  Fusionar ({{ seleccionadasFusion.length }})
                </UButton>
              </div>
            </div>

            <div v-if="loadingCuentas" class="flex justify-center py-8">
              <UIcon name="i-lucide-loader" class="h-6 w-6 animate-spin text-muted" />
            </div>
            <div v-else-if="cuentas.length === 0" class="py-8 text-center text-sm text-muted">
              La mesa no tiene cuentas abiertas. Crea una nueva para empezar.
            </div>
            <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <UCard
                v-for="cuenta in cuentas"
                :key="cuenta.id"
                class="cursor-pointer transition-colors hover:bg-muted"
                :class="fusionMode && seleccionadasFusion.includes(cuenta.id) ? 'ring-2 ring-primary' : ''"
                @click="abrirCuenta(cuenta)"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <UCheckbox
                      v-if="fusionMode"
                      :model-value="seleccionadasFusion.includes(cuenta.id)"
                      @click.stop="toggleSeleccionFusion(cuenta)"
                    />
                    <div>
                      <p class="font-semibold text-default">Cuenta {{ cuenta.numero }}</p>
                      <p class="text-sm text-muted">
                        {{ cuenta.lineas.length }} producto(s)
                      </p>
                      <p
                        v-if="cuenta.garzonResponsableNombre"
                        class="mt-0.5 flex items-center gap-1 text-xs text-muted"
                      >
                        <UIcon name="i-lucide-user" class="size-3" />
                        Responsable: {{ cuenta.garzonResponsableNombre }}
                      </p>
                    </div>
                  </div>
                  <UIcon v-if="!fusionMode" name="i-lucide-chevron-right" class="h-5 w-5 text-muted" />
                </div>
              </UCard>
            </div>
          </div>

          <!-- Detalle de una cuenta: catálogo + productos -->
          <div v-else class="grid h-full min-h-0 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-5">
            <div class="flex min-h-0 flex-col overflow-hidden lg:col-span-3">
              <VentasCatalogoGrid
                :items="itemsVisibles"
                :loading="loadingCatalogo"
                @add="addProducto"
              />
            </div>

            <div class="flex min-h-0 flex-col gap-3 overflow-hidden lg:col-span-2">
              <div class="flex flex-wrap items-center gap-2">
                <UButton
                  label="Tomar cuenta"
                  icon="i-lucide-user-check"
                  color="neutral"
                  variant="soft"
                  :loading="transfiriendo"
                  @click="tomarCuenta"
                />
                <UButton
                  v-if="puedeTransferirAdmin"
                  label="Transferir"
                  icon="i-lucide-arrow-right-left"
                  color="neutral"
                  variant="ghost"
                  @click="abrirTransferenciaAdmin"
                />
                <UButton
                  label="Ver historial"
                  icon="i-lucide-history"
                  color="neutral"
                  variant="ghost"
                  @click="abrirHistorial"
                />
              </div>

              <p class="shrink-0 text-sm font-medium text-default">Productos de la cuenta</p>

              <div class="min-h-0 flex-1 overflow-y-auto">
                <div v-if="activeCuenta.lineas.length === 0" class="py-6 text-center text-sm text-muted">
                  Agrega productos desde el catálogo.
                </div>
                <div v-else class="divide-y divide-default">
                  <div
                    v-for="linea in activeCuenta.lineas"
                    :key="linea.id"
                    class="flex items-center gap-2 py-2"
                  >
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-medium text-default">{{ linea.nombre }}</p>
                      <p v-if="linea.personalizacionTexto" class="text-xs text-muted">
                        {{ linea.personalizacionTexto }}
                      </p>
                      <p class="text-xs text-muted">{{ formatMonto(lineaSubtotal(linea), linea.monedaId) }}</p>
                    </div>
                    <AppCantidadInput
                      :model-value="presentacionLinea(linea)"
                      :unidad-codigo="unidadPresLinea(linea)"
                      :unidad-base-codigo="unidadBaseLinea(linea)"
                      @change="onCantidadChange(linea, $event)"
                    />
                    <UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="ghost"
                      size="xs"
                      @click="quitarLinea(linea)"
                    />
                  </div>
                </div>
              </div>

              <div class="shrink-0 border-t border-default pt-3">
                <div class="mb-3 flex justify-between text-base font-semibold text-default">
                  <span>Total</span>
                  <span>{{ formatMonto(totalFinal) }}</span>
                </div>
                <UAlert
                  v-if="!tieneCaja"
                  color="warning"
                  variant="soft"
                  icon="i-lucide-triangle-alert"
                  title="Sin caja abierta"
                  description="Necesitas una caja física abierta para cobrar."
                  class="mb-3"
                />
                <div class="mb-2 flex gap-2">
                  <UButton
                    color="neutral"
                    variant="soft"
                    class="flex-1 justify-center"
                    icon="i-lucide-chef-hat"
                    :loading="enviandoComanda"
                    :disabled="activeCuenta.lineas.length === 0"
                    @click="enviarComanda"
                  >
                    Enviar a cocina
                  </UButton>
                  <UButton
                    color="neutral"
                    variant="soft"
                    class="flex-1 justify-center"
                    icon="i-lucide-receipt"
                    :loading="imprimiendoPrecuenta"
                    :disabled="activeCuenta.lineas.length === 0"
                    @click="imprimirPrecuenta"
                  >
                    Imprimir precuenta
                  </UButton>
                </div>
                <div class="flex gap-2">
                  <UButton
                    color="error"
                    variant="soft"
                    class="flex-1 justify-center"
                    @click="cancelOpen = true"
                  >
                    Cancelar cuenta
                  </UButton>
                  <UButton
                    color="primary"
                    class="flex-1 justify-center"
                    :disabled="activeCuenta.lineas.length === 0 || !tieneCaja"
                    @click="cobroOpen = true"
                  >
                    Cerrar y cobrar
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </template>
      </AppDrawer>

      <VentasRecetaPersonalizacionDrawer
        v-model:open="recetaDrawerOpen"
        :item-id="recetaItemId"
        @confirm="onRecetaConfirm"
      />

      <VentasCobroModal
        v-model:open="cobroOpen"
        :total="totalFinal"
        :metodos="metodos"
        :submitting="submitting"
        @confirmar="confirmarCobro"
      />

      <CrudModal
        v-model:open="cancelOpen"
        title="Cancelar cuenta"
        message="Se anulará la cuenta sin generar venta. Esta acción no se puede deshacer."
        confirm-label="Cancelar cuenta"
        @confirm="confirmarCancelar"
      />

      <SalonesGarzonPinModal
        v-model:open="pinModalOpen"
        :title="pinModalTitle"
        @confirm="onPinConfirmado"
      />

      <UModal
        v-model:open="turnoModalOpen"
        title="Entrar a turno"
        description="Selecciona el turno en el que vas a trabajar."
        :ui="shellUi.modal"
      >
        <template #body>
          <UFormField label="Turno" required>
            <USelectMenu
              v-model="turnoSeleccionadoId"
              :items="turnoItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </template>
        <template #footer>
          <AppModalFooter>
            <UButton color="neutral" variant="ghost" @click="turnoModalOpen = false">
              Cancelar
            </UButton>
            <UButton
              :disabled="!turnoSeleccionadoId"
              @click="confirmarEntrarTurno"
            >
              Continuar
            </UButton>
          </AppModalFooter>
        </template>
      </UModal>

      <UModal
        v-model:open="transferAdminOpen"
        title="Transferir responsable"
        description="Asigna la cuenta a otro garzón activo."
        :ui="shellUi.modal"
      >
        <template #body>
          <UFormField label="Nuevo responsable" required>
            <USelectMenu
              v-model="transferAdminGarzonId"
              :items="garzonTransferItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </template>
        <template #footer>
          <AppModalFooter>
            <UButton color="neutral" variant="ghost" @click="transferAdminOpen = false">
              Cancelar
            </UButton>
            <UButton
              :disabled="!transferAdminGarzonId"
              :loading="transfiriendo"
              @click="confirmarTransferenciaAdmin"
            >
              Confirmar
            </UButton>
          </AppModalFooter>
        </template>
      </UModal>

      <AppDrawer v-model:open="historialOpen" width="md">
        <template #header>
          <span class="font-semibold text-default">Historial de responsables</span>
        </template>
        <template #body>
          <div v-if="historialLoading" class="flex justify-center py-8">
            <UIcon name="i-lucide-loader" class="h-6 w-6 animate-spin text-muted" />
          </div>
          <div v-else-if="asignaciones.length === 0" class="py-8 text-center text-sm text-muted">
            Sin asignaciones registradas.
          </div>
          <div v-else class="divide-y divide-default">
            <div
              v-for="asignacion in asignaciones"
              :key="asignacion.id"
              class="py-3"
            >
              <p class="font-medium text-default">
                {{ asignacion.garzonNombre ?? '—' }}
              </p>
              <p class="text-sm text-muted">
                {{ motivoAsignacionLabel[asignacion.motivo] }}
              </p>
              <p class="text-xs text-muted">
                {{ formatFecha(asignacion.desdeEl) }}
                —
                {{ asignacion.hastaEl ? formatFecha(asignacion.hastaEl) : 'Vigente' }}
              </p>
              <p
                v-if="asignacion.motivo === 'transferencia_admin' && asignacion.actorUsuarioNombre"
                class="text-xs text-muted"
              >
                Por: {{ asignacion.actorUsuarioNombre }}
              </p>
            </div>
          </div>
        </template>
      </AppDrawer>
    </template>
  </UDashboardPanel>
</template>
