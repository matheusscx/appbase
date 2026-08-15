<script setup lang="ts">
import Decimal from 'decimal.js'
import { descontarStockCatalogo, type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
import { sugerirPropina, fetchPorcentajeSugerido, PROPINA_PORCENTAJE_DEFAULT } from '~/composables/usePropina'
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
import type { EventoPin, Garzon, MiPinEstado } from '~/composables/useGarzones'
import { etiquetaCuentaPendiente, useTransferenciaPendientes } from '~/composables/useSesionesGarzon'
import { personalizacionVacia, type PersonalizacionPayload } from '~/composables/useRecetaPersonalizacion'
import type { Turno } from '~/composables/useTurnos'
import type { SolicitudTestigo } from '~/composables/useSalones'
import { formatCantidadLinea, unidadBaseItem } from '~/utils/cantidad-presentacion'
import { agregarImpuestosVenta } from '~/utils/ticket-builder'
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
const unidadesStore = useUnidadesMedidaStore()
const { formatMonto, formatFecha } = useFormatters()
const impresorasApi = useImpresoras()
const authStore = useAuthStore()
const { emisor, cargar: cargarEmisor } = useRazonSocialEmisor()

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
// Sin `debounceMs`: acá el carrito no cambia tecla a tecla sino por request, y
// la página ya sabe en qué punto la línea quedó firme (`recalcular()` explícito).
const {
  resultado,
  vigente,
  recalcular,
  asegurarVigente,
  limpiar: limpiarResultado,
} = useResultadoCalculado(() =>
  activeCuenta.value ? cuentaToCalcularInput(activeCuenta.value) : null,
)

// Las advertencias se atribuyen a una línea POR ÍNDICE: mientras el cálculo no
// corresponda a la cuenta que se está viendo no se dibujan, porque el índice
// apuntaría a otra línea. Los totales sí conservan el último valor conocido.
const calculoVigente = computed(() => vigente.value ? resultado.value : null)

const fusionMode = ref(false)
const seleccionadasFusion = ref<string[]>([])
const fusionando = ref(false)
// Guard de reentrancia, igual que `fusionando`, `transfiriendo` y `submitting`
// en sus tres hermanos. El teclado de PIN cierra apenas emite `confirm`, o sea
// ANTES de que resuelva el POST: sin esto, un doble tap o un lag de red abren
// dos cuentas en la mesa. El backend no puede defenderlo — varias cuentas
// abiertas por mesa es intencional.
const abriendoCuenta = ref(false)

const cobroOpen = ref(false)
const abriendoCobro = ref(false)
const submitting = ref(false)
const cancelOpen = ref(false)
const propinaMonto = ref('0')
const propinaSugerida = ref('0')
const propinaPorcentaje = ref(PROPINA_PORCENTAJE_DEFAULT)
const propinaHabilitada = ref(true)
const recetaDrawerOpen = ref(false)
const recetaItemId = ref<string | null>(null)

const { puedeActualizar: puedeTransferirAdmin } = usePermisosCrud('Salones')

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
// Cuál de las dos listas complementarias ofrece el selector. `false` solo para
// entrar a turno: quien ya tiene sesión abierta no puede abrir otra.
const pinModalEnTurno = ref(true)
let pinAction: ((garzonId: string, pin: string, nombre: string) => void) | null = null
let pinCancelado: (() => void) | null = null

// Acción de garzón que falló por no tener sesión de trabajo abierta: se guarda como
// closure (con su PIN ya capturado) para reintentarla apenas se inicia el turno.
let accionPendiente: (() => void) | null = null

/**
 * El garzón de esta tablet, si la cuenta logueada está vinculada a uno (**modo
 * personal**). `null` = dispositivo compartido, se pide PIN como siempre.
 *
 * Se consulta **una vez** al cargar: es propiedad de la cuenta y del tenant, no
 * de la acción, así que preguntarlo en cada apertura de cuenta sería un round
 * trip por operación en el camino caliente.
 */
const garzonPersonal = ref<{ garzonId: string, nombre: string } | null>(null)

/**
 * Mi propio estado de PIN, solo relevante en modo personal. `null` hasta que
 * carga o si esta cuenta no es garzón en el tenant activo (404 de `miPin()`,
 * el caso normal para casi todos los que abren esta pantalla).
 */
const miPinEstado = ref<MiPinEstado | null>(null)

/**
 * Los dos tipos de invalidación dicen cosas distintas a propósito — mismo
 * criterio y misma redacción base que `PinEventosLista.vue`, que ya las
 * distingue: `invalidado_por_encargado` es "te corté el PIN",
 * `invalidado_por_vinculo` es "te di una cuenta y el PIN viejo quedó sin
 * efecto". Separarlos acá importa porque el segundo es el disparador
 * DOMINANTE de este aviso en producción —este bloque solo se muestra en
 * modo personal, y vincular la cuenta es justamente lo que emite
 * `invalidado_por_vinculo` (`garzones.service.ts` → `actualizar`)—, así que
 * fusionar los dos bajo "el encargado te cortó el PIN" le mentiría a la
 * mayoría de quienes lo ven.
 */
const TEXTO_INVALIDACION: Record<
  'invalidado_por_encargado' | 'invalidado_por_vinculo',
  (quien: string, cuando: string) => string
> = {
  invalidado_por_encargado: (quien, cuando) => `${quien} invalidó tu PIN (${cuando})`,
  invalidado_por_vinculo: (quien, cuando) => `Tu PIN quedó sin efecto al vincular esta cuenta (${quien}, ${cuando})`,
}

/**
 * Sin PIN usable no puede operar desde un TÓTEM COMPARTIDO — pero sí desde
 * ESTE dispositivo: en modo personal `solicitarPin` no pide PIN (bypass por
 * JWT, ver más abajo), así que este aviso no describe un bloqueo, solo el
 * límite del tótem. Los dos textos lo dicen explícito.
 *
 * ⚠️ Prometer "desde este dispositivo trabajás normal" es seguro ACÁ y no en
 * `MiPinForm.vue` (revisión final, 2026-08-15). Este bloque solo se muestra
 * con `garzonPersonal`, que sale de `GET /garzones/mi-vinculo` —ruta con
 * `@RequiresPermiso('Salones', 'Operar')`—: quien lee esto ya probó que
 * puede entrar en modo personal. `MiPinForm` vive en el perfil, que hereda
 * de `pages/configuracion.vue` un `definePageMeta` sin gate de permiso
 * (`{ middleware: 'auth', layout: 'dashboard' }`), y su
 * `GET /garzones/mi-pin` tampoco exige permiso de módulo, así que ahí el
 * mismo texto se lo comería el garzón SIN
 * `Salones:Operar`, que es exactamente a quien no le sirve — por eso ese
 * componente se queda con lo que es cierto siempre (el tótem), sin
 * prometer el dispositivo propio.
 *
 * La **condición** es el estado (`fijado`), no una comparación de fechas
 * entre eventos. El texto sale del PRIMER evento de invalidación de la
 * lista — que es el más reciente porque el backend la trae
 * `ORDER BY e.creado_el DESC` (`garzones.service.ts` → `listarEventosPin`);
 * si ese orden cambiara, este `.find()` dejaría de traer el último evento
 * real y el aviso nombraría a la persona y la fecha equivocadas.
 */
const avisoPin = computed(() => {
  if (!garzonPersonal.value || !miPinEstado.value || miPinEstado.value.fijado) return null
  const ultima = miPinEstado.value.eventos.find(
    (e): e is EventoPin & { tipo: 'invalidado_por_encargado' | 'invalidado_por_vinculo' } =>
      e.tipo === 'invalidado_por_encargado' || e.tipo === 'invalidado_por_vinculo',
  )
  const sufijo = 'Desde este dispositivo trabajás normal; para el tótem compartido, hace falta ponerlo desde tu perfil.'
  if (!ultima) return `Todavía no tenés PIN. ${sufijo}`
  // `null` = la cuenta que hizo el cambio ya se dio de baja: mismo fallback
  // que usa `PinEventosLista.vue` para el mismo dato, no un rol inventado
  // ("el encargado") que ya no está respaldado.
  const quien = ultima.usuarioNombre ?? 'Una cuenta dada de baja'
  const cuando = formatFecha(ultima.creadoEl)
  return `${TEXTO_INVALIDACION[ultima.tipo](quien, cuando)}. ${sufijo}`
})

/**
 * Embudo único de los 6 puntos que piden PIN. En modo personal **no abre el
 * modal**: ejecuta la acción con el garzón vinculado y PIN vacío, que el helper
 * `credencialGarzon` traduce a "no mandes credencial".
 *
 * Ese `pin` vacío es la razón de que el modo personal no sea un bypass: el
 * backend no recibe una credencial en blanco que tenga que creer, recibe **nada**
 * y resuelve la identidad del JWT por su cuenta.
 */
function solicitarPin(
  title: string,
  action: (garzonId: string, pin: string, nombre: string) => void,
  opciones?: { onCancelar?: () => void, enTurno?: boolean },
) {
  if (garzonPersonal.value?.garzonId) {
    const { garzonId, nombre } = garzonPersonal.value
    action(garzonId, '', nombre)
    return
  }
  pinModalTitle.value = title
  pinModalEnTurno.value = opciones?.enTurno ?? true
  pinAction = action
  pinCancelado = opciones?.onCancelar ?? null
  pinModalOpen.value = true
}

function onPinConfirmado(garzonId: string, pin: string, nombre: string) {
  const action = pinAction
  pinAction = null
  pinCancelado = null
  action?.(garzonId, pin, nombre)
}

// El teclado de PIN solo avisa cuando el PIN es válido: si el garzón lo cierra,
// el llamador no se entera. Sin esto, quien abría el teclado para transferir sus
// mesas y lo cancelaba perdía la oferta sin forma de reabrirla.
//
// En el camino feliz este hook ya no existe: `GarzonPinModal` emite `confirm` y
// se cierra en el MISMO bloque síncrono, y `onPinConfirmado` anula `pinCancelado`
// ahí mismo, mientras el watcher (`flush: 'pre'`) recién corre en el microtask
// siguiente. Por eso no depende del orden de esas dos líneas del componente.
//
// `pinAction` NO se toca acá a propósito: anularlo cambiaría la cancelación de
// los otros cinco flujos que usan este teclado —tocar afuera con `identificar()`
// en vuelo descartaría la acción en silencio—, y eso está fuera de esta tarea.
// El precio, en esa misma ventana: la oferta reaparece y un instante después la
// transferencia se ejecuta igual. Converge bien (el cierre lo hace el propio
// bucle) y es la semántica que ya tenían los otros cinco.
watch(pinModalOpen, (abierto) => {
  if (abierto) return
  const cancelado = pinCancelado
  pinCancelado = null
  cancelado?.()
})

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

/**
 * Toast de error. Si falta sesión de trabajo abre directo el modal para entrar a turno
 * y, si el llamador pasó `retry`, lo guarda para reintentar la acción al iniciar el turno.
 */
function toastErrorOperativo(e: unknown, fallback: string, retry?: () => void) {
  const msg = apiErrorMsg(e, fallback)
  if (msg.includes('sesión de trabajo')) {
    accionPendiente = retry ?? null
    toast.add({
      title: 'Primero inicia tu turno',
      description: 'No tienes una sesión de trabajo abierta.',
      color: 'warning',
    })
    void abrirEntrarTurno()
    return
  }
  toast.add({ title: msg, color: 'error' })
}

/** Cierra el modal de turno sin iniciar y descarta la acción que quedó pendiente. */
function cancelarEntrarTurno() {
  turnoModalOpen.value = false
  accionPendiente = null
}

function confirmarEntrarTurno() {
  const turnoId = turnoSeleccionadoId.value
  if (!turnoId) return
  turnoModalOpen.value = false
  // El único que lista a los que NO están en turno: es justamente el que
  // todavía no tiene sesión.
  solicitarPin(
    'PIN del garzón para entrar a turno',
    (garzonId, pin) => {
      void iniciarSesionConPin(garzonId, pin, turnoId)
    },
    { enTurno: false },
  )
}

async function iniciarSesionConPin(
  garzonId: string,
  pin: string,
  turnoId: string,
) {
  try {
    const sesion = await sesionesApi.iniciar({ garzonId, pin, turnoId })
    toast.add({
      title: `Sesión iniciada: ${sesion.garzonNombre} · ${sesion.turnoNombre}`,
      color: 'success',
    })
    // Reintenta la acción que disparó el inicio de turno (ej. abrir la cuenta).
    const retry = accionPendiente
    accionPendiente = null
    retry?.()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al iniciar sesión'), color: 'error' })
  }
}

function salirDeTurno() {
  solicitarPin('PIN del garzón para salir de turno', (garzonId, pin) => {
    void cerrarSesionConPin(garzonId, pin)
  })
}

async function cerrarSesionConPin(garzonId: string, pin: string) {
  try {
    const sesion = await sesionesApi.cerrar({ garzonId, pin })
    toast.add({
      title: `Sesión cerrada: ${sesion.garzonNombre} · ${sesion.turnoNombre}`,
      color: 'success',
    })
    // El cierre no se bloquea, pero lo que quedó a su nombre no lo puede cobrar
    // nadie hasta transferirlo: se ofrece acá, con el garzón todavía frente al
    // equipo. Ver `docs/features/turnos-garzones.md`.
    ofrecerTransferencia(sesion)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cerrar sesión'), color: 'error' })
  }
}

// ── Mesas que quedaron abiertas al salir de turno ────────────────────────────
const {
  pendientes,
  garzonNombre: pendientesGarzon,
  abierto: pendientesOpen,
  transfiriendo: transfiriendoPendientes,
  ofrecer: ofrecerTransferencia,
  reabrirSiQuedan: reabrirPendientes,
  transferirTodas,
} = useTransferenciaPendientes()

// El teclado de PIN es otro modal: este se cierra para dejarle lugar y vuelve si
// el garzón lo cancela sin transferir.
function pedirPinParaPendientes() {
  pendientesOpen.value = false
  solicitarPin(
    'PIN del garzón que se hace cargo',
    (garzonId, pin) => {
      void transferirTodas(async (cuentaId) => {
        aplicarCuentaActualizada(
          await salonesApi.transferirCuenta(cuentaId, garzonId, pin),
        )
      })
    },
    { onCancelar: reabrirPendientes },
  )
}

// ── Testigo del cierre forzado (el garzón da fe del conteo) ─────────────────
const testigoModalOpen = ref(false)
const testigoSolicitudes = ref<SolicitudTestigo[]>([])
/** El PIN ya probado en el teclado enmascarado, retenido solo mientras el modal está abierto. */
const testigoPin = ref('')
const cargandoTestigos = ref(false)

/**
 * Trae las pendientes del garzón identificado por `garzonId`/`pin` y, si hay
 * alguna, abre el modal. `silencioso` es para el aviso pasivo al montar (modo
 * personal): sin él, cada carga de la pantalla sin nada pendiente mostraría un
 * toast — ruido en el camino más común.
 */
async function cargarPendientesTestigo(
  garzonId: string,
  pin: string,
  opciones?: { silencioso?: boolean },
) {
  cargandoTestigos.value = true
  // El PIN que el garzón ya probó en el teclado enmascarado se retiene mientras
  // dura el modal: `resolver` lo necesita y volver a pedirlo sería teclearlo dos
  // veces (y, en el tótem, dejarlo a la vista). Vacío en modo personal.
  testigoPin.value = pin
  try {
    const solicitudes = await salonesApi.pendientesTestigo(garzonId, pin)
    testigoSolicitudes.value = solicitudes
    if (solicitudes.length > 0) {
      testigoModalOpen.value = true
    }
    else if (!opciones?.silencioso) {
      toast.add({ title: 'No tenés ninguna firma pendiente', color: 'neutral' })
    }
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo consultar la firma pendiente'), color: 'error' })
  }
  finally {
    cargandoTestigos.value = false
  }
}

/**
 * El punto de entrada del tótem compartido: al montar la pantalla nadie sabe
 * quién está parado adelante (a diferencia del modo personal, donde el JWT ya
 * lo dice), así que acá no hay aviso automático — pedirle PIN a cada carga de
 * la pantalla sería absurdo. Este botón es el único disparador en ese modo.
 */
function pedirFirmaTestigo() {
  solicitarPin('PIN del garzón para ver tu firma pendiente', (garzonId, pin) => {
    void cargarPendientesTestigo(garzonId, pin)
  })
}

/** El modal resolvió una solicitud: sale de la lista local, sin re-fetch. */
function onTestigoResuelto(testigoId: string) {
  testigoSolicitudes.value = testigoSolicitudes.value.filter(s => s.id !== testigoId)
  if (testigoSolicitudes.value.length === 0) {
    testigoModalOpen.value = false
  }
}

// El PIN no sobrevive al modal: en cuanto se cierra, se olvida.
watch(testigoModalOpen, (abierto) => {
  if (!abierto) testigoPin.value = ''
})

const selectedSalon = computed(() =>
  salones.value.find(s => s.id === selectedSalonId.value) ?? null,
)
const salonItems = computed(() =>
  salones.value.map(s => ({ label: s.nombre, value: s.id })),
)
const tieneCaja = computed(() => cajaStore.activa !== null)
const totalFinal = computed(() => resultado.value?.totales.totalFinal ?? '0')
// Una línea cuyo ítem se borró del catálogo hace fallar el cálculo entero: el
// motor resuelve los ítems contra el catálogo vivo y devuelve 404. Sin esto la
// cabecera mostraba **Total $0** para una cuenta con productos, que es peor que
// no mostrar nada. La cuenta no se puede cobrar hasta quitar esa línea.
const cuentaConItemEliminado = computed(
  () => activeCuenta.value?.lineas.some(l => l.itemEliminado) ?? false,
)

watch(cobroOpen, (v) => {
  if (v) {
    propinaSugerida.value = sugerirPropina(totalFinal.value, propinaPorcentaje.value)
  }
})

/** El modal de cobro pide el `totalFinal` que sale de `resultado`: se abre recién
 *  cuando ese total es el de esta cuenta, no el de la mutación anterior. */
async function abrirCobro() {
  abriendoCobro.value = true
  try {
    if (await asegurarVigente()) {
      cobroOpen.value = true
      return
    }
    toast.add({ title: 'No se pudo calcular el total de la cuenta. Intentá de nuevo.', color: 'error' })
  }
  finally {
    abriendoCobro.value = false
  }
}

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
    // Solo tipos vendibles (producto + receta + combo). Los ingredientes (y resto) no van al catálogo.
    const [productosRes, recetasRes, combosRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=producto&activo=true&pageSize=100`),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=receta&activo=true&pageSize=100`),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=combo&activo=true&pageSize=100`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    // Los pausados no vienen: `activo=true` va en la query. Filtrarlos acá no
    // era equivalente —el pausado igual ocupaba uno de los 100 lugares pedidos,
    // así que en un catálogo grande empujaba fuera del salón a uno vendible—.
    items.value = [...productosRes.data, ...recetasRes.data, ...combosRes.data]
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
  // El vínculo va en el mismo `Promise.all` y no en una llamada aparte: es una
  // más de las cargas iniciales, y encadenarla sumaría un round trip antes de
  // que la pantalla sirva.
  const [, , , , sugerido, , vinculo, miPin] = await Promise.all([
    // ⚠️ Con `catch` propio, por el mismo motivo que `miVinculo` más abajo, y
    // medido en el smoke de navegador del testigo (2026-08-13): `GET
    // /caja/activa` pide `MiCaja:Leer`, y **un garzón no lo tiene**. Ese 403
    // rechazaba el `Promise.all` entero, así que TODO lo que viene después
    // —incluido `garzonPersonal`— no se asignaba nunca. Consecuencia: en la
    // cuenta de un garzón real, el modo personal no se activaba y el aviso
    // pasivo de la firma pendiente no aparecía jamás; con la cuenta de un admin
    // (que sí tiene el permiso) funcionaba, que es por lo que no se veía.
    // Una caja que no se puede leer no es un error de esta pantalla: el garzón
    // no cobra desde acá.
    cajaStore.cargarActiva().catch(() => null),
    cargarSalones(),
    cargarCatalogo(),
    unidadesStore.ensureLoaded(),
    fetchPorcentajeSugerido(),
    cargarEmisor(),
    // ⚠️ Con `catch` propio y no suelta en el `Promise.all`: la ruta pide
    // `Salones:Operar`, y esta pantalla solo exige estar autenticado. A alguien
    // con `Salones:Leer` el 403 le rechazaba el `Promise.all` entero y dejaba
    // sin asignar el porcentaje de propina — o sea que una consulta accesoria
    // rompía una pantalla que antes cargaba bien. Sin vínculo = se pide PIN,
    // que es el camino correcto para quien no puede operar.
    garzonesApi.miVinculo().catch(() => null),
    // `.catch` obligatorio: un 404 (esta cuenta no es garzón acá) es la
    // respuesta normal para la mayoría de quienes abren esta pantalla —mismo
    // motivo que `miVinculo` arriba—. Sin él ese 404 voltea el `Promise.all`
    // entero y el salón no vuelve a aparecer.
    garzonesApi.miPin().catch(() => null),
  ])
  // Se mira `garzonId`, no la verdad del objeto: "sin vínculo" puede llegar como
  // `null`, `''` o `{}` según cómo se serialice un body vacío, y `{}` es
  // **truthy**. Confiar en la truthiness apagaría el PIN para TODOS.
  garzonPersonal.value = vinculo?.garzonId ? vinculo : null
  miPinEstado.value = miPin
  propinaPorcentaje.value = sugerido.porcentajeSugerido
  propinaHabilitada.value = sugerido.habilitado

  // Aviso pasivo al entrar (spec): solo posible en modo personal, porque el
  // JWT ya dice quién es. En un tótem compartido nadie sabe todavía quién está
  // parado adelante, así que acá no se puede disparar sin pedir PIN primero —
  // ver `pedirFirmaTestigo` y el botón "¿Te pidieron firmar un cierre?" más
  // abajo, el único punto de entrada de ese modo. No es un olvido: es el
  // límite honesto del dispositivo compartido.
  if (garzonPersonal.value) {
    void cargarPendientesTestigo(garzonPersonal.value.garzonId, '', { silencioso: true })
  }
})

// ── Selección de mesa ──────────────────────────────────────────────────────
async function onSelectMesa(mesa: MesaResumen) {
  selectedMesa.value = mesa
  activeCuenta.value = null
  limpiarResultado()
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

function nuevaCuenta() {
  if (!selectedMesa.value || abriendoCuenta.value) return
  solicitarPin(
    'PIN del garzón para abrir la cuenta',
    (garzonId, pin, nombre) => {
      void abrirCuentaConPin(garzonId, pin, nombre)
    },
  )
}

async function abrirCuentaConPin(
  garzonId: string,
  pin: string,
  nombre: string,
) {
  if (!selectedMesa.value || abriendoCuenta.value) return
  abriendoCuenta.value = true
  try {
    const mesaId = selectedMesa.value.id
    const cuenta = await salonesApi.abrirCuenta(mesaId, garzonId, pin)
    cuentas.value.push(cuenta)
    patchMesaOcupacion(mesaId, 1)
    abrirCuenta(cuenta)
    toast.add({ title: `Cuenta abierta por ${nombre}`, color: 'success' })
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'Error al abrir la cuenta', () => { void abrirCuentaConPin(garzonId, pin, nombre) })
  }
  finally {
    abriendoCuenta.value = false
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
  limpiarResultado()
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
  solicitarPin('PIN para tomar esta cuenta', (garzonId, pin) => {
    void transferirCuentaConPin(garzonId, pin)
  })
}

async function transferirCuentaConPin(garzonId: string, pin: string) {
  const cuenta = activeCuenta.value
  if (!cuenta || transfiriendo.value) return
  transfiriendo.value = true
  try {
    const actualizada = await salonesApi.transferirCuenta(cuenta.id, garzonId, pin)
    aplicarCuentaActualizada(actualizada)
    toast.add({
      title: `Cuenta tomada por ${actualizada.garzonResponsableNombre ?? 'garzón'}`,
      color: 'success',
    })
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'No se pudo tomar la cuenta', () => { void transferirCuentaConPin(garzonId, pin) })
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
  asignaciones.value = []
  try {
    asignaciones.value = await salonesApi.listarAsignaciones(cuenta.id)
  }
  catch (e: unknown) {
    asignaciones.value = []
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
  // `lineasPendientes` y no `pendientes`: ese nombre ya es el ref de las cuentas
  // que quedaron sin responsable, y sombrearlo acá deja dos cosas sin relación
  // llamadas igual en el mismo archivo.
  const lineasPendientes = [...pendingByLinea.entries()]
  for (const [lineaId, timer] of lineasPendientes) {
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
  if (item.tipo === 'receta' || (item.tipo === 'combo' && item.disponibleCondicional)) {
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
      garzonNombre: activeCuenta.value.garzonResponsableNombre,
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
  // La línea de cuenta no lleva `tipo`/`unidadMedida`, así que la unidad base
  // sale del catálogo ya cargado. Map una vez, no un `find` por línea.
  const porItemId = new Map(items.value.map(it => [it.id, it]))
  return res.lineas.map((l, i) => {
    const cl = cuenta.lineas[i]
    const itemCl = cl ? porItemId.get(cl.itemId) : undefined
    const unidadBase = itemCl ? unidadBaseItem(itemCl) : null
    const cantidadTicket = formatCantidadLinea(
      l.cantidad,
      cl?.cantidadPresentacion,
      cl?.unidadCodigoPresentacion,
      unidadesStore.esFraccionaria(cl?.unidadCodigoPresentacion ?? unidadBase),
      unidadBase,
    )
    return {
      nombre: cl?.nombre ?? '',
      cantidad: cantidadTicket,
      precioUnitario: l.precioUnitario,
      totalLinea: l.totalLinea,
      ...(cl?.personalizacionDetalle?.length
        ? { personalizacionDetalle: cl.personalizacionDetalle, comentario: cl.personalizacion?.comentario }
        : cl?.personalizacionTexto ? { nota: cl.personalizacionTexto } : {}),
    }
  })
}

async function imprimirPrecuenta() {
  if (!activeCuenta.value || !selectedMesa.value) return
  imprimiendoPrecuenta.value = true
  try {
    // El ticket sale de `resultado`: si no corresponde a la cuenta actual imprime
    // montos de un pedido anterior, así que primero se espera el cálculo al día.
    const res = await asegurarVigente()
    if (!res) {
      toast.add({ title: 'No se pudo calcular el total de la cuenta. Intentá de nuevo.', color: 'error' })
      return
    }
    if (!activeCuenta.value || !selectedMesa.value) return
    await impresorasApi.imprimirPrecuenta({
      emisor: emisor.value,
      mesaNombre: selectedMesa.value.nombre,
      cuentaNumero: activeCuenta.value.numero,
      items: itemsParaTicket(activeCuenta.value, res),
      totales: res.totales,
      impuestos: agregarImpuestosVenta(res.lineas),
      ...(propinaHabilitada.value && new Decimal(propinaPorcentaje.value || '0').gt(0)
        ? { propinaSugerida: {
            porcentaje: propinaPorcentaje.value,
            monto: new Decimal(res.totales.totalFinal).times(propinaPorcentaje.value).toDecimalPlaces(0).toString(),
          } }
        : {}),
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

function confirmarCobro(pagos: PagoInput[], vuelto: string) {
  if (!activeCuenta.value) return
  // El cobro recolecta los pagos; el PIN identifica al garzón que cierra.
  cobroOpen.value = false
  solicitarPin('PIN del garzón para cerrar la cuenta', (garzonId, pin) => {
    void (async () => {
      await flushPendientes()
      await cerrarCuentaConPin(pagos, garzonId, pin, vuelto)
    })()
  })
}

async function cerrarCuentaConPin(
  pagos: PagoInput[],
  garzonId: string,
  pin: string,
  vuelto: string,
) {
  if (!activeCuenta.value) return
  submitting.value = true
  const cuentaCerrada = activeCuenta.value
  const tipMonto = propinaMonto.value || '0'
  const tipSugerida = propinaSugerida.value || tipMonto
  try {
    // La boleta y la proyección local de la caja salen de acá: se espera el
    // cálculo de ESTA cuenta, no el que quedó de la mutación anterior. Dentro
    // del `try` para que un fallo no deje el drawer trabado en `submitting`.
    const resultadoCerrado = await asegurarVigente()
    await salonesApi.cerrarCuenta(cuentaCerrada.id, {
      ...credencialGarzon(garzonId, pin),
      pagos,
      tipoDocumentoId: tiposDocumento.value[0]?.id,
      propinaMonto: tipMonto,
      propinaSugerida: tipSugerida,
      propinaPorcentajeSugerido: propinaPorcentaje.value,
    })
    toast.add({
      title: new Decimal(tipMonto).gt(0)
        ? 'Cuenta cerrada — propina registrada'
        : 'Cuenta cerrada — venta generada',
      color: 'success',
    })

    if (resultadoCerrado) {
      try {
        await impresorasApi.imprimirBoleta({
          emisor: emisor.value,
          facturacionElectronica: false,
          meta: {
            cajero: authStore.user?.nombre ?? undefined,
            mesa: selectedMesa.value?.nombre,
          },
          items: itemsParaTicket(cuentaCerrada, resultadoCerrado),
          totales: resultadoCerrado.totales,
          impuestos: agregarImpuestosVenta(resultadoCerrado.lineas),
          ...(propinaHabilitada.value && new Decimal(tipMonto).gt(0) ? { propina: { monto: tipMonto } } : {}),
          pagos: pagos.map(p => ({
            nombre: metodos.value.find(m => m.metodoPagoId === p.metodoPagoId)?.nombre ?? '',
            monto: p.monto,
          })),
          vuelto,
          formatMonto: (v: string) => formatMonto(v),
        })
      }
      catch (e: unknown) {
        toast.add({ title: apiErrorMsg(e, 'Venta generada, pero falló la impresión de la boleta'), color: 'warning' })
      }
    }
    else {
      // Mismo criterio que el fallo de impresora: la cuenta ya se cerró, pero
      // quedarse sin el cálculo del que sale el ticket no puede ser silencioso.
      toast.add({ title: 'Venta generada, pero no se pudo generar la boleta', color: 'warning' })
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
    const targetCobro = resultadoCerrado
      ? new Decimal(resultadoCerrado.totales.totalFinal).plus(tipMonto)
      : bruto
    const neto = Decimal.min(bruto, targetCobro).toFixed(4)
    cajaStore.aplicarCobroLocal(neto, pagosConMonto.length)
    volverACuentas()
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'Error al cerrar la cuenta', () => { void cerrarCuentaConPin(pagos, garzonId, pin, vuelto) })
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
        <!-- Solo modo personal: un tótem compartido no tiene "mi PIN". Fuera
             del `v-else` de abajo a propósito: no depende de que haya salones
             configurados, así que un tenant sin salones igual se lo muestra a
             quien lo necesita. -->
        <UAlert
          v-if="avisoPin"
          color="warning"
          variant="soft"
          icon="i-lucide-key-round"
          title="Tu PIN no está listo"
          :description="avisoPin"
        >
          <template #actions>
            <UButton to="/configuracion/perfil" color="warning" variant="solid" size="sm">
              Ir a mi perfil
            </UButton>
          </template>
        </UAlert>

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
              <UButton
                icon="i-lucide-shield-check"
                color="neutral"
                variant="ghost"
                :loading="cargandoTestigos"
                @click="pedirFirmaTestigo"
              >
                ¿Te pidieron firmar un cierre?
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
              <UButton
                icon="i-lucide-plus"
                :loading="abriendoCuenta"
                @click="nuevaCuenta"
              >
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
                    v-for="(linea, index) in activeCuenta.lineas"
                    :key="linea.id"
                    class="flex items-center gap-2 py-2"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-1.5">
                        <p class="truncate text-sm font-medium text-default">{{ linea.nombre }}</p>
                        <UBadge
                          v-if="linea.itemEliminado"
                          label="Eliminado del catálogo"
                          color="error"
                          variant="subtle"
                          size="sm"
                        />
                      </div>
                      <p v-if="linea.itemEliminado" class="text-xs text-error">
                        Quitá esta línea para poder cobrar la cuenta.
                      </p>
                      <p v-if="linea.personalizacionTexto" class="text-xs text-muted">
                        {{ linea.personalizacionTexto }}
                      </p>
                      <p class="text-xs text-muted">{{ formatMonto(lineaSubtotal(linea), linea.monedaId) }}</p>
                      <AdvertenciasPrecio :advertencias="calculoVigente?.lineas[index]?.advertencias ?? []" />
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
                <AdvertenciasPrecio :advertencias="calculoVigente?.advertenciasVenta ?? []" class="mb-2" />
                <UAlert
                  v-if="cuentaConItemEliminado"
                  color="error"
                  variant="soft"
                  icon="i-lucide-triangle-alert"
                  title="Hay un ítem eliminado del catálogo"
                  description="No se puede calcular ni cobrar esta cuenta hasta quitar esa línea."
                  class="mb-3"
                />
                <div class="mb-3 flex justify-between text-base font-semibold text-default">
                  <span>Total</span>
                  <span>{{ cuentaConItemEliminado ? '—' : formatMonto(totalFinal) }}</span>
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
                    :disabled="activeCuenta.lineas.length === 0 || cuentaConItemEliminado"
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
                    @click="() => { cancelOpen = true }"
                  >
                    Cancelar cuenta
                  </UButton>
                  <UButton
                    color="primary"
                    class="flex-1 justify-center"
                    :loading="abriendoCobro"
                    :disabled="activeCuenta.lineas.length === 0 || !tieneCaja || cuentaConItemEliminado"
                    @click="abrirCobro"
                  >
                    Cerrar y cobrar
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </template>
      </AppDrawer>

      <VentasItemPersonalizacionDrawer
        v-model:open="recetaDrawerOpen"
        :item-id="recetaItemId"
        @confirm="onRecetaConfirm"
      />

      <VentasCobroModal
        v-model:open="cobroOpen"
        :modo-propina="propinaHabilitada"
        :total="totalFinal"
        :venta-total="totalFinal"
        v-model:propina-monto="propinaMonto"
        :porcentaje-sugerido="propinaPorcentaje"
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
        :en-turno="pinModalEnTurno"
        @confirm="onPinConfirmado"
      />

      <SalonesTestigoModal
        v-model:open="testigoModalOpen"
        :solicitudes="testigoSolicitudes"
        :pin="testigoPin"
        :modo-personal="!!garzonPersonal?.garzonId"
        @resuelto="onTestigoResuelto"
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
            <UButton color="neutral" variant="ghost" @click="cancelarEntrarTurno">
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
        v-model:open="pendientesOpen"
        title="Dejaste mesas abiertas"
        :description="`Tu sesión se cerró, pero estas cuentas siguen a nombre de ${pendientesGarzon} y nadie puede cobrarlas hasta transferirlas.`"
        :ui="shellUi.modal"
      >
        <template #body>
          <ul class="divide-y divide-default">
            <li
              v-for="pendiente in pendientes"
              :key="pendiente.cuentaId"
              class="flex items-center gap-2 py-2 text-sm text-default"
            >
              <UIcon name="i-lucide-utensils" class="size-4 shrink-0 text-muted" />
              {{ etiquetaCuentaPendiente(pendiente) }}
            </li>
          </ul>
        </template>
        <template #footer>
          <AppModalFooter>
            <UButton color="neutral" variant="ghost" @click="() => { pendientesOpen = false }">
              Ahora no
            </UButton>
            <UButton
              icon="i-lucide-arrow-right-left"
              :loading="transfiriendoPendientes"
              @click="pedirPinParaPendientes"
            >
              Transferir con PIN
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
          <p
            v-if="garzonTransferItems.length === 0"
            class="text-sm text-muted"
          >
            No hay otros garzones activos disponibles para transferir.
          </p>
          <UFormField v-else label="Nuevo responsable" required>
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
            <UButton color="neutral" variant="ghost" @click="() => { transferAdminOpen = false }">
              Cancelar
            </UButton>
            <UButton
              :disabled="!transferAdminGarzonId || garzonTransferItems.length === 0"
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
