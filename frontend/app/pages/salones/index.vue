<script setup lang="ts">
import Decimal from 'decimal.js'
import { type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
import { sugerirPropina, fetchPorcentajeSugerido, PROPINA_PORCENTAJE_DEFAULT } from '~/composables/usePropina'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'
import {
  cuentaToCalcularInput,
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
import { agregarImpuestosVenta, agregarPromocionesVenta } from '~/utils/ticket-builder'
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

/**
 * ── El catálogo se vuelve a preguntar; ya no se recalcula acá ───────────────
 *
 * Hasta el 2026-09-01 esta pantalla mantenía sus números con aritmética de
 * cliente: `descontarStockCatalogo(items, líneas de la mesa)`. Desde que el
 * servidor aparta lo pedido, eso quedó mal de dos formas:
 *
 * 1. **Doble descuento.** `disponible` y `stockDisponible` ya vienen restados
 *    de lo que pidieron TODAS las cuentas abiertas del tenant — las de esta
 *    mesa incluidas—, así que restarlas otra vez acá las contaba dos veces.
 * 2. **Ciego a las otras mesas.** El cliente solo conoce las cuentas de la mesa
 *    que tiene abierta, que es exactamente el agujero que este frente vino a
 *    cerrar.
 *
 * Por eso la grilla recibe `items` tal como los mandó el servidor. Quién
 * dispara el refresco, y las tres condiciones que lo gobiernan, están en el
 * `watch` que vive junto a `pendingByLinea`/`inflight` —tiene que estar abajo
 * de esas dos declaraciones, porque las lee para saber si hay una edición de
 * cantidad a medio camino—.
 */
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
/**
 * Con qué se abrió el modal de cobro: la cuenta, su mesa y el total que se
 * verificó para ella. Ver `abrirCobro` — los tres se escriben ahí y en ningún
 * otro lado, en el mismo instante.
 */
const cobroCuenta = ref<CuentaDetalle | null>(null)
const cobroMesa = ref<MesaResumen | null>(null)
const cobroTotal = ref('0')
const abriendoCobro = ref(false)
const submitting = ref(false)
const cancelOpen = ref(false)
/**
 * El botón del modal de cancelar, en espera. Desde que cancelar manda primero lo
 * pendiente (owner, 2026-09-05) hay un tramo de red antes de que pase nada: sin
 * esto el botón queda inerte y se lee como que la app se colgó.
 */
const cancelando = ref(false)
const propinaMonto = ref('0')
const propinaSugerida = ref('0')

// La escala de la moneda oficial — el porqué está en `CobroModal.vue`, que es el
// otro sitio que sugiere propina.
const monedasStore = useMonedasStore()
const decimalesPropina = computed(
  () => monedasStore.monedaOficial?.decimals ?? 0,
)
const propinaPorcentaje = ref(PROPINA_PORCENTAJE_DEFAULT)
const propinaHabilitada = ref(true)
const recetaDrawerOpen = ref(false)
const recetaItemId = ref<string | null>(null)

const { puedeActualizar: puedeTransferirAdmin } = usePermisosCrud('Salones')

const transferAdminOpen = ref(false)
/** La cuenta para la que se abrió el modal de transferencia. Ver `abrirTransferenciaAdmin`. */
const transferAdminCuenta = ref<CuentaDetalle | null>(null)
const transferAdminGarzonId = ref<string | undefined>()
const garzonesActivos = ref<Garzon[]>([])
const garzonesCargados = ref(false)
const transfiriendo = ref(false)

const historialOpen = ref(false)
const historialLoading = ref(false)
const asignaciones = ref<CuentaAsignacionDetalle[]>([])

/**
 * Los garzones que se le pueden asignar a la cuenta **del modal**, no a la que
 * esté activa: si el modal se lleva su cuenta adentro, se la lleva entera. De
 * acá cuelgan la lista del select y el `:disabled` del *Confirmar*, así que
 * leerlo de `activeCuenta` ofrecía garzones filtrados contra una cuenta y
 * transfería otra —y podía deshabilitar el botón de una transferencia válida—.
 * Lo levantó la revisión: congelar a medias es la misma ventana que no congelar.
 */
const garzonesTransferibles = computed(() => {
  const responsableId = transferAdminCuenta.value?.garzonResponsableId
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

/**
 * El modal de cobro se abre recién cuando el total está calculado, y **se lleva
 * adentro con qué se abrió**: la cuenta, su mesa y ese total. Lo que muestra y
 * lo que cobra sale de ahí, no de lo que esté activo cuando el garzón confirma.
 *
 * ⚠️ **La espera de `asegurarVigente()` es una ventana, y son dos agujeros, no
 * uno** — los midió la revisión con sonda:
 *
 * - **Abrir sin volver a preguntar.** La pantalla sigue clickeable (el
 *   `:loading` solo apaga este botón): metiéndose en otra cuenta durante la
 *   espera, `asegurarVigente()` devolvía el cálculo de ESA —calcula el carrito
 *   vivo— y el modal se abría encima, con el total de la otra y sin decir de qué
 *   cuenta habla. Medido: `POST .../cerrar` con `cuenta-10` y los pagos que el
 *   garzón juntó para la 9. De ahí el guard de identidad de abajo.
 * - **Congelar en el *Confirmar* no alcanza**, aunque parezca que con el modal
 *   abierto ya nada puede cambiar la cuenta activa: `fusionarSeleccionadas`
 *   aterriza y hace `activeCuenta.value = cuenta` si el garzón quedó parado en
 *   una de las fusionadas —el overlay no frena la continuación de un request—,
 *   así que el *Confirmar* congelaba la fusionada. Es el mismo gesto que ya se
 *   hizo en `abrirTransferenciaAdmin`.
 *
 * ⚠️ **Y el total va en la foto igual que la cuenta.** `totalFinal` sale de
 * `resultado`, que `recalcular()` reescribe desde varios lados; el modal lo usa
 * para lo que muestra, para el pago que precarga y para la propina que sugiere.
 * Congelar la cuenta y dejar vivo el número con el que se cobra es la misma
 * ventana que no congelar nada. Se toma **lo que devuelve `asegurarVigente()`**,
 * no releyendo el ref, que es la regla del composable.
 *
 * ℹ️ **Lo que este congelado separa, dicho:** la boleta **no** imprime este
 * número — sale de un `asegurarVigente()` fresco adentro de `cerrarCuentaConPin`,
 * a propósito, porque el ticket tiene que salir de la cuenta de **después** del
 * flush. Antes los dos eran el mismo; ahora pueden diferir si la cuenta se movió
 * entre que el modal abrió y el cierre salió. No es plata cobrada de más ni de
 * menos: el total de la venta lo calcula el backend a partir de las líneas —acá
 * no viaja ningún total—, y lo que sí queda del lado de la pantalla ya está
 * anotado (`docs/agent/pendientes.md` § 2: la venta sin boleta y la caja
 * proyectada por el bruto).
 */
async function abrirCobro() {
  const cuenta = activeCuenta.value
  const mesa = selectedMesa.value
  if (!cuenta) return
  abriendoCobro.value = true
  try {
    const res = await asegurarVigente()
    // El guard va antes que el aviso: no se abre el cobro de una cuenta que ya
    // no es la de la pantalla, y tampoco se tira un error por ella.
    //
    // ⚠️ **La cuenta puede haber cambiado sin que el garzón se moviera**, y ahí
    // este `return` deja el tap **sin ninguna respuesta**: una fusión que
    // aterriza durante el cálculo lo lleva a la fusionada si estaba parado en
    // una de las fusionadas, y entonces no hay ni modal ni aviso —el único toast
    // es el de la fusión—. Medido. Distinguir *"me fui"* de *"me movieron"* pide
    // saber qué cuentas entraron a esa fusión, que es justo lo que decide la
    // pregunta abierta al owner sobre esta misma escena
    // (`docs/agent/pendientes.md` § 4).
    if (activeCuenta.value?.id !== cuenta.id) return
    if (!res) {
      toast.add({ title: 'No se pudo calcular el total de la cuenta. Intentá de nuevo.', color: 'error' })
      return
    }
    cobroCuenta.value = cuenta
    cobroMesa.value = mesa
    cobroTotal.value = res.totales.totalFinal
    propinaSugerida.value = sugerirPropina(
      cobroTotal.value,
      decimalesPropina.value,
      propinaPorcentaje.value,
    )
    cobroOpen.value = true
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

/**
 * Cuántos ms espera un refresco del catálogo antes de salir. Abrir una mesa
 * mueve dos veces lo que el `watch` mira (primero la mesa, después sus cuentas)
 * y agregar tres ítems seguidos, tres: con el debounce cada ráfaga es UNA
 * llamada. Corto a propósito — es tiempo que la tarjeta pasa mostrando el
 * número anterior.
 */
const REFRESCO_ITEMS_MS = 250

/**
 * Descarta la respuesta que llega tarde: dos refrescos encimados no vuelven
 * necesariamente en orden, y el más viejo dejaría en pantalla el número de
 * antes hasta el refresco siguiente.
 */
let secuenciaItems = 0
let refrescoItemsPendiente: ReturnType<typeof setTimeout> | null = null

/**
 * Los tres `/items` del catálogo, y nada más. **No toca `loadingCatalogo`**: un
 * refresco de fondo que vaciara la grilla para volver a dibujarla haría
 * parpadear el catálogo en cada ítem que el garzón agrega.
 *
 * ⚠️ **Una llamada que falla NO borra lo que ya está en pantalla.** Cada tipo
 * conserva sus ítems anteriores si SU consulta no respondió; con las tres
 * caídas, el catálogo queda exactamente como estaba. Esto no es defensa
 * decorativa: mientras el catálogo se pedía una sola vez en `onMounted`, un
 * blip de red no lo podía borrar; ahora se pide muchas veces por turno, y
 * asignar `?.data ?? []` a ciegas dejaba al garzón con "No hay ítems para
 * mostrar" a mitad de servicio por un corte de wifi de dos segundos, sin
 * ningún aviso y sin nada que reintentara hasta el próximo cambio.
 *
 * El `.catch(() => null)` por llamada se mantiene —lo puso el 403 del garzón
 * sin permiso de catálogo, medido en el smoke del 2026-08-15—, pero acá
 * significa otra cosa: **"esta tanda no trajo nada, quedate con lo de antes"**.
 * Sigue sin toast a propósito: un aviso rojo por cada blip, en una pantalla que
 * el garzón usa con las dos manos, es ruido que no puede accionar — y lo que de
 * verdad protege el stock es el 400 del backend al pedir, no este número.
 */
async function refrescarItems() {
  const turno = ++secuenciaItems
  const [productosRes, recetasRes, combosRes] = await Promise.all([
    useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=producto&activo=true&pageSize=100`).catch(() => null),
    useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=receta&activo=true&pageSize=100`).catch(() => null),
    useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=combo&activo=true&pageSize=100`).catch(() => null),
  ])
  if (turno !== secuenciaItems) return
  // En la carga inicial `previos` está vacío, así que el 403 del garzón sigue
  // dejando el catálogo vacío igual que antes: esto conserva, no inventa.
  const previos = items.value
  const conservando = (
    res: PaginatedResponse<ItemCatalogo> | null,
    tipo: string,
  ) => res?.data ?? previos.filter(i => i.tipo === tipo)
  // Los pausados no vienen: `activo=true` va en la query. Filtrarlos acá no
  // era equivalente —el pausado igual ocupaba uno de los 100 lugares pedidos,
  // así que en un catálogo grande empujaba fuera del salón a uno vendible—.
  items.value = [
    ...conservando(productosRes, 'producto'),
    ...conservando(recetasRes, 'receta'),
    ...conservando(combosRes, 'combo'),
  ]
}

function programarRefrescoItems() {
  if (refrescoItemsPendiente) clearTimeout(refrescoItemsPendiente)
  refrescoItemsPendiente = setTimeout(() => {
    refrescoItemsPendiente = null
    void refrescarItems()
  }, REFRESCO_ITEMS_MS)
}

onBeforeUnmount(() => {
  if (refrescoItemsPendiente) clearTimeout(refrescoItemsPendiente)
})

/**
 * Irse de la pantalla es la tercera puerta por la que una edición a medio
 * guardar quedaba en el aire, y espera igual que cancelar y fusionar (owner,
 * 2026-09-05).
 *
 * `onBeforeUnmount` no sirve para esto: no puede esperar, así que el `PATCH`
 * salía con el componente ya desmontado y su toast aparecía en otra pantalla
 * —el `Toaster` vive en `UApp`, no acá, así que se ve igual—.
 *
 * ⚠️ **Cubre la navegación dentro de la app, no cerrar la pestaña ni recargar**:
 * un guard de ruta no corre ahí. Es el mismo límite que ya tenía salir de la
 * cuenta.
 */
onBeforeRouteLeave(async () => {
  await flushPendientes()
})

async function cargarCatalogo() {
  loadingCatalogo.value = true
  try {
    // Solo tipos vendibles (producto + receta + combo). Los ingredientes (y resto) no van al catálogo.
    // `/items` (×3, dentro de `refrescarItems`) y `/tipos-documento` llevan
    // `.catch(() => null)` propio,
    // mismo motivo que `cargarActiva` en `onMounted`: son datos del POS que un
    // garzón no tiene permiso de leer, y esta carga es de fondo — no una acción
    // que el garzón haya pedido. Sin el catch, ese 403 volteaba el `Promise.all`
    // entero (incluido `/metodos-pago`, que SÍ pasa para ese rol) y el catch de
    // abajo lo mostraba como "No tienes permiso para esta acción" en rojo apenas
    // se abría la pantalla (medido en el smoke del 2026-08-15). `/metodos-pago`
    // se queda SIN catch propio a propósito: si esa sí falla, es un error real
    // y tiene que avisar.
    const [, metodosRes, tiposRes] = await Promise.all([
      refrescarItems(),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`).catch(() => null),
    ])
    metodos.value = metodosRes
    tiposDocumento.value = tiposRes ?? []
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
  // Cambiar de mesa es la otra forma de abandonar una cuenta, y vale lo mismo
  // que tocar *Cuentas*: lo pendiente se manda (ver `salirDeCuenta`).
  void flushPendientes()
  selectedMesa.value = mesa
  activeCuenta.value = null
  limpiarResultado()
  fusionMode.value = false
  seleccionadasFusion.value = []
  mesaDrawerOpen.value = true
  await cargarCuentas(mesa.id)
}

/**
 * Token de request, mismo mecanismo que `useResultadoCalculado`: dos taps
 * seguidos en el plano son dos `GET` en vuelo, y sin esto ganaba **el que
 * llegara último**, no la mesa que el garzón está mirando. Un
 * `if (mesaId === selectedMesa.value?.id)` no alcanza: pasar por la mesa B y
 * volver a la A deja entrar la respuesta vieja de A.
 */
let tokenCuentas = 0

async function cargarCuentas(mesaId: string) {
  const mio = ++tokenCuentas
  loadingCuentas.value = true
  try {
    const lista = await salonesApi.listarCuentas(mesaId)
    if (mio !== tokenCuentas) return
    cuentas.value = lista
  }
  catch (e: unknown) {
    // El aviso sale igual aunque la respuesta sea de una mesa que el garzón ya
    // dejó: un `GET` que falla es una falla, y callarla dejaría el listado vacío
    // sin explicación si vuelve.
    toast.add({ title: apiErrorMsg(e, 'Error al cargar cuentas'), color: 'error' })
  }
  finally {
    // Mismo token: la respuesta vieja no apaga el spinner de la que sigue viva.
    if (mio === tokenCuentas) loadingCuentas.value = false
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
    // La ocupación y el aviso van con la mesa **congelada** y sin condicionar:
    // la cuenta se abrió de verdad, esté donde esté parado el garzón.
    patchMesaOcupacion(mesaId, 1)
    toast.add({ title: `Cuenta abierta por ${nombre}`, color: 'success' })
    // Lo que PINTA, no: el modal de PIN ya cerró —emite `confirm` y después se
    // cierra—, así que durante el `await` el garzón puede tocar otra mesa. Sin
    // este guard, la cuenta de la mesa A entraba al listado de la mesa B y
    // encima lo teletransportaba adentro. Mismo gesto que `fusionarSeleccionadas`.
    if (selectedMesa.value?.id !== mesaId) return
    cuentas.value.push(cuenta)
    // ⚠️ **Y solo se entra a la cuenta nueva si el garzón sigue en el listado.**
    // El guard de arriba es por MESA, así que no cubría el caso de quedarse en la
    // misma mesa y meterse en otra cuenta mientras el POST viajaba: ahí esto le
    // cambiaba `activeCuenta` por abajo. No es "te movió la pantalla": con un
    // modal abierto encima —transferir, cobrar— el modal seguía ahí y su
    // *Confirmar* actuaba sobre la cuenta recién creada. Medido por la revisión:
    // el `POST .../transferir-admin` salía con la cuenta nueva, y el cobro cerraba
    // esa cuenta vacía con los pagos que el garzón había juntado para la otra.
    // Mismo criterio que fusionar: parado en una cuenta viva no se lo toca.
    if (!activeCuenta.value) abrirCuenta(cuenta)
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
  // **Lo que se fusiona se congela acá.** El `await` de abajo es de red, y
  // durante esa espera las tarjetas siguen clickeables —el `:loading` solo apaga
  // el botón *Fusionar*—, así que releerlas después dejaba salir el request con
  // UNA cuenta: el backend contesta `400 Selecciona al menos dos cuentas para
  // fusionar` (`salones.service.ts`) y el garzón lee un toast rojo por algo que
  // no pidió. El criterio: se fusiona lo que estaba seleccionado **al tocar el
  // botón**, que es lo que el garzón vio escrito en él. Lo levantó la revisión
  // del diff: la ventana la abrió el `await` nuevo.
  const aFusionar = [...seleccionadasFusion.value]
  const mesaId = selectedMesa.value.id
  try {
    // Igual que cancelar y que cerrar: primero termina lo que quedó a medio
    // guardar (owner, 2026-09-05). Fusionar deja las cuentas de origen
    // `cancelada`, así que un `PATCH` en vuelo aterrizaba sobre una cuenta que
    // ya no estaba abierta y volvía con *"La cuenta no está abierta"*,
    // nombrando una cuenta que el garzón acababa de fusionar. La espera se ve:
    // el botón ya tenía `:loading="fusionando"`, prendido al entrar.
    await flushPendientes()
    const fusedIds = new Set(aFusionar)
    const cuenta = await salonesApi.fusionarCuentas(mesaId, aFusionar)
    // La fusión ya ocurrió del lado del servidor, así que el aviso va siempre,
    // esté el garzón donde esté.
    toast.add({ title: `Cuentas fusionadas en Cuenta ${cuenta.numero}`, color: 'success' })
    // **Cuántas se fueron sale de lo PEDIDO, no de `cuentas.value`.** El backend
    // fusiona sobre la de menor número de las seleccionadas y cancela el resto
    // (`salones.service.ts`, `[destino, ...origenes]`), así que son todas menos
    // una. Contarlas sobre el listado vivo daba **cero** si durante la espera el
    // garzón cambió de mesa, y la ocupación de la mesa fusionada quedaba inflada
    // para siempre.
    patchMesaOcupacion(mesaId, -(aFusionar.length - 1))
    // **Lo que el garzón haya tocado durante el vuelo, en CUALQUIERA de las
    // cuentas que entraron a la fusión, ya no se puede mandar.** Y son dos
    // motivos distintos, uno por lado —los dos los midió con sonda la revisión
    // del diff, en dos pasadas—:
    //
    // - **Las de ORIGEN quedaron `cancelada`**: ese `PATCH` sale con el
    //   `cuentaId` de origen y vuelve *"La cuenta no está abierta"*, el toast que
    //   este frente vino a sacar.
    // - **La DESTINO sigue abierta**, así que ahí el `PATCH` no rebota por la
    //   cuenta: el backend pliega la línea de origen sobre la de destino sumando
    //   `cantidad` y `cantidadEnviada` (`salones.service.ts`), y
    //   `actualizarLinea` escribe **absoluto**, o sea sobre la suma. Y el garzón
    //   tipea mirando **lo de antes de la fusión**: ese número ya no significa lo
    //   que él quiso decir, salga como salga —puede rebotar por el guard de
    //   cocina, rebotar por el tope de stock, o entrar y pisar lo que la fusión
    //   sumó—. Medido: destino 2 (2 despachadas) + origen 3 (0) = 5 con 2
    //   despachadas; tipear 3 pasa con 200 y se come 2 unidades del origen.
    //
    // ⛔ **No intentes resumir esto en una regla de cuándo entra y cuándo no.**
    // Ya se intentó varias veces y todas salieron falsas contra el backend —la
    // lista, en `docs/agent/resueltos.md`—. Son dos guards independientes, y lo
    // que sostiene la decisión no es dónde está la frontera: es que **el número
    // se tipeó contra otra realidad**.
    //
    // ⚠️ **El costo, dicho: esa edición se pierde.** Y se descarta **por cuenta,
    // no por línea**, así que también cae la edición de una línea del destino que
    // la fusión no tocó y que se habría guardado bien. Es a propósito: separar
    // línea por línea pide saber cuál se plegó y cuál no, que es justo lo que la
    // respuesta no dice. La pérdida **se ve** —la pantalla se repinta con la
    // cuenta del servidor—, no es silenciosa.
    // Y como en cancelar, esto **no es una garantía sino una ventana más chica**:
    // si el timer de los 300 ms alcanzó a disparar antes de que volviera la
    // fusión, el `PATCH` ya salió y acá no queda nada que tirar.
    for (const id of aFusionar) descartarPendientes(id)
    // ⛔ **De acá para abajo se pinta pantalla, y eso solo se hace si el garzón
    // sigue donde pidió la fusión.** Lo levantó la cuarta pasada de la revisión:
    // congelar la selección no alcanzaba porque estas cuatro sentencias
    // **escriben** estado vivo. Con la mesa cambiada, la cuenta fusionada se
    // inyectaba en el listado de la OTRA mesa.
    if (selectedMesa.value?.id !== mesaId) return
    cuentas.value = [
      cuenta,
      ...cuentas.value.filter(c => !fusedIds.has(c.id)),
    ]
    // Se apagan aunque el garzón haya empezado a seleccionar otra fusión durante
    // el vuelo: la selección nueva puede incluir cuentas que ésta acaba de
    // anular, y dejarla armada es ofrecerle fusionar lo que ya no existe. Pierde
    // dos taps; la alternativa pierde una fusión con un 400. (Con la mesa
    // cambiada no llegamos acá, pero tampoco hace falta: `onSelectMesa` ya los
    // reseteó.)
    fusionMode.value = false
    seleccionadasFusion.value = []
    // **Se lo lleva a la fusionada en DOS casos, y la quinta pasada de la
    // revisión encontró el segundo:** si seguía en el listado esperándola, y si
    // quedó parado en una de las cuentas que **esta misma fusión canceló** —ahí
    // dejarlo no es respetar dónde estaba, es abandonarlo en una cuenta que el
    // servidor anuló y que el listado ya no tiene; todo lo que haga desde ahí
    // vuelve *"La cuenta no está abierta"*—. En cualquier otra cuenta no se lo
    // toca: eso sí sería una expulsión.
    //
    // ⚠️ **No es el gemelo exacto del `volverACuentas()` de `confirmarCancelar`**,
    // aunque lo parezca y así estuvo escrito acá un rato: aquél pregunta *"¿sigo
    // en la cuenta que murió? entonces sacame"*, y éste *"¿estoy en el listado o
    // en una que murió? entonces llevame"*. La pregunta por las muertas es la
    // misma; el destino, no.
    if (!activeCuenta.value || fusedIds.has(activeCuenta.value.id)) {
      activeCuenta.value = cuenta
      void recalcular()
    }
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al fusionar las cuentas'), color: 'error' })
  }
  finally {
    fusionando.value = false
  }
}

/**
 * La respuesta de los tres caminos que mutan la cuenta por request
 * (`addProducto`, `onRecetaConfirm`, `quitarLinea`).
 *
 * ⚠️ Delega en `aplicarCuentaActualizada` en vez de escribir `activeCuenta` a
 * mano, que es lo que hacía: la cuenta **sí** cambió, así que lo que el servidor
 * contesta entra a la lista pase lo que pase —condicionar eso perdería la línea
 * recién agregada—, pero **abrir el detalle es pintar**. Sin el guard, tocar
 * *Cuentas* con el request en vuelo devolvía al garzón a la cuenta que acababa
 * de soltar, solo. Es la misma forma que las cinco puertas del cobro y la
 * comanda, dada vuelta: acá el problema no era leer estado reactivo después del
 * `await`, era **escribirlo**.
 *
 * El `recalcular()` va con el mismo guard: calcula el carrito vivo, así que
 * dispararlo desde acá con el garzón en otra pantalla es un request al pedo con
 * el resultado de otra cosa.
 */
function syncCuenta(cuenta: CuentaDetalle) {
  aplicarCuentaActualizada(cuenta)
  if (activeCuenta.value?.id === cuenta.id) void recalcular()
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

/**
 * ⚠️ **Sub-forma propia de la familia del `await`: acá lo que queda del otro lado
 * de la espera es un MODAL.** La primera carga de garzones es un request, y el
 * modal se abre después. Sin el guard de abajo, el admin tocaba *Transferir*
 * parado en la cuenta 9, se iba a la 10 mientras cargaban los garzones, y el
 * modal aparecía —titulado igual, sin decir de qué cuenta habla— sobre la 10:
 * `confirmarTransferenciaAdmin` relee `activeCuenta` **vivo**, así que
 * confirmarlo le cambiaba el responsable a una cuenta que nadie tocó. Medido:
 * el `POST` salía con `cuenta-10`.
 *
 * ⚠️ **Y el modal se lleva su cuenta adentro** (`transferAdminCuenta`), en vez de
 * que el *Confirmar* relea `activeCuenta`. La primera versión de este arreglo NO
 * lo hacía, con el argumento de que con el guard nada puede cambiar la cuenta
 * activa mientras el modal está abierto. **Falso, y la revisión lo midió**:
 * `abrirCuentaConPin` guardaba por MESA, así que abrir una cuenta nueva y
 * meterse en otra mientras el POST viajaba cambiaba `activeCuenta` por abajo —el
 * overlay no frena la continuación de un request— y el *Confirmar* transfería la
 * recién creada. Ese camino se cerró del otro lado también, pero el modal ya no
 * depende de que no exista ninguno.
 */
async function abrirTransferenciaAdmin() {
  const cuenta = activeCuenta.value
  if (!cuenta) return
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
  // El guard va acá y no arriba: arriba la cuenta era la correcta.
  if (activeCuenta.value?.id !== cuenta.id) return
  transferAdminCuenta.value = cuenta
  transferAdminGarzonId.value = garzonesTransferibles.value[0]?.id
  transferAdminOpen.value = true
}

async function confirmarTransferenciaAdmin() {
  // La cuenta del modal, no la que esté activa: ver `abrirTransferenciaAdmin`.
  const cuenta = transferAdminCuenta.value
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
/**
 * Edición de cantidad **pendiente** por línea: el timer del debounce, lo que el
 * garzón puso (`payload`) y la cantidad que la línea tenía **antes de la primera
 * edición de la ráfaga** (`previo`).
 *
 * - **`payload` viaja acá y no se re-deriva de la pantalla al mandarlo.**
 *   `flushPendientes` manda de a una y espera, y el camino feliz de cada `PATCH`
 *   hace `syncCuenta` con la cuenta **entera** del servidor — que trae las otras
 *   líneas con su valor persistido y pisa el optimista de las que todavía están
 *   pendientes. Releyendo `activeCuenta` en la iteración siguiente se mandaba la
 *   cantidad vieja de la segunda línea: la comanda salía mal y no había toast.
 *   El camino solo-debounce se curaba solo porque ahí el payload va en el
 *   closure; el agujero era exclusivo del flush.
 * - **`previo` es lo que permite deshacer.** El optimista pinta apenas se toca el
 *   stepper, así que para cuando el `PATCH` sale el estado en pantalla YA es el
 *   nuevo — un snapshot tomado ahí restauraría justo lo que hay que revertir.
 *   Medido el 2026-09-02: el `catch` parecía hacer rollback y no lo hacía.
 */
/**
 * Una edición de cantidad a medio camino, con **todo lo que hace falta para
 * mandarla o deshacerla sin la pantalla delante**.
 *
 * `cuentaId` y `contexto` se congelan al empezar la edición porque desde el
 * 2026-09-02 **salir de la cuenta la manda** (decisión del owner): el `PATCH`
 * puede salir y contestar con el garzón ya en el listado o en otra mesa, y ahí
 * `activeCuenta` y `selectedMesa` ya no dicen de quién era ese cambio.
 */
type EdicionCantidad = {
  cuentaId: string
  /** `Mesa 3 · Cuenta 1` — solo para el toast que llega después de salir. */
  contexto: string
  payload: CantidadPayload
  previo: CantidadPayload
}

const pendingByLinea = new Map<
  string,
  EdicionCantidad & { timer: ReturnType<typeof setTimeout> }
>()
/**
 * Líneas con al menos un `PATCH` **en vuelo**, cada una con **el** `previo` de
 * esa línea — uno solo, compartido por todos sus requests en vuelo.
 *
 * Es un `Map` y no un `Set` para que el `previo` sobreviva la ventana que se
 * abre cuando el timer borra la entrada de `pendingByLinea` y todavía no
 * contestó el servidor: una segunda edición que caiga ahí adentro no encontraba
 * pendiente y recalculaba el `previo` **desde la línea**, que ya trae el
 * optimista sin confirmar. Con las dos respuestas rechazadas quedaba pintada una
 * cantidad que el servidor nunca aceptó — el mismo síntoma que el rollback vino
 * a cerrar, en una ventana más chica (la latencia, no los 300 ms del debounce).
 *
 * ⚠️ **El `previo` vive acá y no en la closure de cada request, y ésa es la
 * mitad que faltaba.** Con la latencia por encima de los 300 ms hay **dos
 * `PATCH` en vuelo sobre la misma línea** y `pendingByLinea` está vacío, así
 * que re-tasar solo la entrada pendiente no alcanzaba: el segundo request
 * seguía cerrado sobre el `previo` de antes de la ráfaga y deshacía hasta ahí,
 * con el servidor ya en otro número. Medido por la revisión independiente:
 * pantalla 1, servidor 2, la misma escena que este arreglo vino a cerrar.
 * Compartiendo el valor, el éxito del primero lo corrige para el segundo.
 *
 * `pendientes` cuenta los requests vivos de esa línea: la entrada se borra
 * cuando vuelve el último, no cuando vuelve el primero.
 *
 * Las claves son las mismas de siempre, así que el guard del refresco de acá
 * abajo (`size` / `has`) no cambia de conducta.
 */
const inflight = ref(
  new Map<string, { previo: CantidadPayload, pendientes: number }>(),
)

/**
 * ── El catálogo se vuelve a preguntar; ya no se recalcula acá ───────────────
 *
 * Hasta el 2026-09-01 esta pantalla mantenía sus números con aritmética de
 * cliente: `descontarStockCatalogo(items, líneas de la mesa)`. Desde que el
 * servidor aparta lo pedido, eso quedó mal de dos formas:
 *
 * 1. **Doble descuento.** `disponible` y `stockDisponible` ya vienen restados
 *    de lo que pidieron TODAS las cuentas abiertas del tenant — las de esta
 *    mesa incluidas—. Restarlas otra vez acá dejaba en 0 (tarjeta gris, click
 *    bloqueado) un producto del que todavía quedaban unidades reales, y sin
 *    ningún mensaje: el garzón no podía vender lo que estaba en el
 *    refrigerador.
 * 2. **Ciego a las otras mesas.** El cliente solo conoce las cuentas de la mesa
 *    que tiene abierta, que es exactamente el agujero que este frente vino a
 *    cerrar.
 *
 * Entonces el número no se recalcula: se vuelve a pedir cuando cambia lo que
 * las cuentas tienen pedido y al entrar a una cuenta. `GET /items` es la
 * lectura más caliente del producto, así que va con debounce —una ráfaga de
 * taps es un solo refresco—, descartando la respuesta que llegue tarde, y con
 * dos condiciones más:
 *
 * - **Solo si la grilla está en pantalla.** `VentasCatalogoGrid` se rinde en la
 *   rama de detalle de cuenta, así que pasear por las mesas sin entrar a
 *   ninguna no tiene por qué pedir el catálogo: seis mesas miradas eran 18 GET
 *   `/items` para no mostrar nada. Por eso la fuente mira `activeCuenta` y no
 *   la mesa.
 * - **Nunca con una edición de cantidad a medio camino.** `onCantidadChange`
 *   pinta la cantidad nueva en el acto (`patchLineaOptimista`) y recién manda
 *   el PATCH 300 ms después; sin este guard el refresco salía a los 250 ms, o
 *   sea **antes** del PATCH, y volvía con el número viejo. No era una carrera:
 *   era determinista. Que casi siempre se curara era accidente de formato —el
 *   optimista deja `'3'` y el servidor devuelve `'3.0000'`, así que la firma
 *   cambiaba de casualidad y disparaba un segundo refresco—; con una cantidad
 *   que ya trae 4 decimales (`'0.3333'` de un ítem que se pesa) los dos strings
 *   coinciden, no había segundo refresco y el número quedaba alto.
 *
 * Las líneas con edición pendiente o en vuelo salen de la firma justamente para
 * que ese segundo disparo no dependa del formato: la línea **desaparece** de la
 * firma al empezar la edición y **vuelve** con el valor del servidor al
 * terminarla, así que la firma cambia siempre, coincida o no la cantidad.
 */
watch(
  () => [
    activeCuenta.value?.id ?? '',
    ...cuentas.value.flatMap(c => c.lineas
      .filter(l => !pendingByLinea.has(l.id) && !inflight.value.has(l.id))
      .map(l => `${l.itemId}:${l.cantidad}`)),
  ].join('#'),
  () => {
    if (!mesaDrawerOpen.value || !activeCuenta.value) return
    if (pendingByLinea.size > 0 || inflight.value.size > 0) return
    programarRefrescoItems()
  },
)

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

type CantidadPayload = {
  presentacion: string
  unidadCodigo: string
  cantidadCanonica: string
}

/**
 * Pinta la cantidad nueva —o la deshace— sobre la cuenta **por id**, no sobre
 * la que está en pantalla.
 *
 * Leía `activeCuenta` hasta el 2026-09-02, y eso alcanzaba mientras salir de la
 * cuenta descartara la edición. Ahora salir la manda, así que el rollback puede
 * tener que correr con `activeCuenta` ya en `null`: ahí la versión vieja se iba
 * en su primera línea y la cantidad que el servidor rechazó quedaba pintada.
 *
 * `activeCuenta` se toca solo si sigue siendo la misma cuenta — mismo criterio
 * que `aplicarCuentaActualizada`, que es quien aplica—. Si el garzón se fue a
 * otra mesa, `cargarCuentas` ya reemplazó `cuentas.value` y acá no hay nada que
 * pintar: volver a esa mesa la vuelve a pedir al servidor.
 */
function patchLineaOptimista(
  cuentaId: string,
  lineaId: string,
  payload: CantidadPayload,
) {
  const cuenta = cuentas.value.find(c => c.id === cuentaId)
  if (!cuenta) return
  aplicarCuentaActualizada({
    ...cuenta,
    lineas: cuenta.lineas.map(l =>
      l.id === lineaId
        ? {
            ...l,
            cantidad: payload.cantidadCanonica,
            cantidadPresentacion: payload.presentacion,
            unidadCodigoPresentacion: payload.unidadCodigo,
          }
        : l,
    ),
  })
  if (activeCuenta.value?.id === cuentaId) void recalcular()
}

async function patchLineaCantidad(lineaId: string, edicion: EdicionCantidad) {
  const { cuentaId, contexto, payload, previo } = edicion

  const enVuelo = inflight.value.get(lineaId)
  if (enVuelo) enVuelo.pendientes++
  else inflight.value.set(lineaId, { previo, pendientes: 1 })
  try {
    const cuenta = await salonesApi.actualizarLinea(cuentaId, lineaId, {
      cantidad: payload.cantidadCanonica,
      cantidadPresentacion: payload.presentacion,
      unidadCodigoPresentacion: payload.unidadCodigo,
    })
    // `aplicarCuentaActualizada`: la respuesta puede llegar con el garzón en OTRA
    // cuenta —desde que salir manda la edición, esa ventana existe— y pintarle
    // encima la que dejó atrás. Hasta el 2026-09-05 esto era la diferencia con
    // `syncCuenta`, que escribía `activeCuenta` sin mirar; desde que `syncCuenta`
    // delega en esta misma función, las dos hacen lo mismo y la elección de acá
    // dejó de ser una decisión.
    aplicarCuentaActualizada(cuenta)
    if (activeCuenta.value?.id === cuentaId) void recalcular()
    // **Re-tasa el `previo` de la edición que quedó pendiente.** El que guardó
    // `onCantidadChange` es el de antes de la ráfaga, y con este `PATCH`
    // aceptado dejó de ser *lo último que el servidor confirmó* — que es la
    // regla que gobierna el rollback—. Sin esto, un rechazo posterior deshace
    // de más: la línea está en 1, el garzón la sube a 2 y el servidor lo
    // acepta, la sube a 3 y eso rebota → la pantalla vuelve a **1** y el
    // servidor tiene **2**. Y no se autocorrige: la única lectura de
    // `GET /cuentas` es `onSelectMesa`, así que el número equivocado sobrevive
    // a salir de la cuenta y volver a entrar desde el listado.
    //
    // Se re-tasa desde la línea que devolvió **el servidor**, no desde el
    // `payload` que se mandó: el que vale para deshacer es el que quedó
    // guardado, con el formato que le dio el backend.
    //
    // Se re-tasan los DOS lugares donde vive un `previo` de esta línea, que son
    // dos ventanas distintas del mismo bug: la edición que todavía espera su
    // timer (`pendingByLinea`) y la que ya salió y está esperando al servidor
    // (`inflight`). Cerrar solo la primera deja viva la segunda apenas la
    // latencia pasa los 300 ms — medido.
    const confirmada = cuenta.lineas.find(l => l.id === lineaId)
    if (confirmada) {
      const confirmado: CantidadPayload = {
        presentacion: presentacionLinea(confirmada),
        unidadCodigo: unidadPresLinea(confirmada),
        cantidadCanonica: confirmada.cantidad,
      }
      const pendiente = pendingByLinea.get(lineaId)
      if (pendiente) pendiente.previo = confirmado
      const otrosEnVuelo = inflight.value.get(lineaId)
      if (otrosEnVuelo) otrosEnVuelo.previo = confirmado
    }
  }
  catch (e: unknown) {
    // Se deshace **solo esta línea**, con la misma función que la pintó. Antes
    // acá había un `syncCuenta(structuredClone(activeCuenta.value))` y fallaba
    // dos veces: `.value` es el Proxy reactivo de un `ref` y `structuredClone`
    // no clona Proxies —tiraba `DataCloneError` FUERA del `try`, así que el
    // `PATCH` no salía nunca y el toast tampoco—; y aun arreglando eso, el
    // snapshot se tomaba después del optimista, o sea que restauraba el valor
    // que había que revertir. Restaurar la cuenta entera además pisaba la
    // edición optimista de otra línea de la misma ráfaga.
    // El `previo` **compartido**, no el que este request capturó al salir: si
    // otro `PATCH` de la misma línea volvió bien mientras éste viajaba, lo que
    // hay que restaurar es lo que ese otro dejó guardado. El `??` cubre el caso
    // en que la entrada ya no esté (no debería: la baja es en el `finally`, que
    // corre después).
    patchLineaOptimista(
      cuentaId,
      lineaId,
      inflight.value.get(lineaId)?.previo ?? previo,
    )
    toast.add({
      title: apiErrorMsg(e, 'Error al actualizar la cantidad'),
      // El rechazo puede llegar con el garzón ya en el listado o en otra mesa
      // —salir manda lo pendiente—, y ahí *"no alcanza el stock"* solo no le
      // dice a quién culpar: el `description` nombra la mesa y la cuenta. Con
      // la cuenta todavía en pantalla se omite, porque ahí sobra.
      description: activeCuenta.value?.id === cuentaId ? undefined : contexto,
      color: 'error',
    })
  }
  finally {
    // Baja del contador, no borrado: con dos `PATCH` en vuelo, borrar al volver
    // el primero dejaría al segundo sin el `previo` compartido —y a
    // `flushPendientes` creyendo que ya no queda nada esperando—.
    const vivos = inflight.value.get(lineaId)
    if (vivos && --vivos.pendientes <= 0) inflight.value.delete(lineaId)
  }
}

function onCantidadChange(linea: CuentaLineaDetalle, payload: CantidadPayload) {
  if (!activeCuenta.value || new Decimal(payload.cantidadCanonica || '0').lte(0)) return

  const cuentaId = activeCuenta.value.id
  const contexto = `${selectedMesa.value?.nombre ?? 'Mesa'} · Cuenta ${activeCuenta.value.numero}`
  const pendiente = pendingByLinea.get(linea.id)
  // El `previo` se toma de la línea SOLO en la primera edición de la ráfaga: en
  // la segunda la línea ya trae lo que pintó el optimista, y guardarlo haría que
  // deshacer devuelva a un valor que tampoco se guardó nunca. Por eso, si no hay
  // pendiente, se busca antes en `inflight`: entre que el timer dispara y el
  // servidor contesta la ráfaga sigue siendo la misma, pero la entrada del
  // debounce ya no está.
  const previo: CantidadPayload = pendiente?.previo ?? inflight.value.get(linea.id)?.previo ?? {
    presentacion: presentacionLinea(linea),
    unidadCodigo: unidadPresLinea(linea),
    cantidadCanonica: linea.cantidad,
  }
  if (pendiente) clearTimeout(pendiente.timer)

  patchLineaOptimista(cuentaId, linea.id, payload)

  pendingByLinea.set(linea.id, {
    cuentaId,
    contexto,
    payload,
    previo,
    // ⚠️ **La edición se relee del `Map`, no se cierra sobre las variables de
    // acá.** El camino feliz de `patchLineaCantidad` re-tasa el `previo` de la
    // entrada pendiente cuando el servidor confirma, y una closure sobre el
    // `previo` de arriba se quedaría con el de antes de la ráfaga: la mutación
    // no llegaría nunca. `flushPendientes` ya lee del `Map`, así que sin esto
    // los dos caminos deshacían distinto.
    //
    // Lo que hace seguro leer el `Map` acá es que **una entrada solo la puede
    // disparar su propio timer**, y eso vale para los dos que borran entradas:
    // `onCantidadChange` cancela el anterior antes de guardar el nuevo, y
    // `flushPendientes` cancela el de la entrada que borra —lo vivo, no lo que
    // fotografió—. Sin esa segunda mitad este `if (edicion)` se comía en
    // silencio el tap que llegara a mitad del flush.
    timer: setTimeout(() => {
      const edicion = pendingByLinea.get(linea.id)
      pendingByLinea.delete(linea.id)
      if (edicion) void patchLineaCantidad(linea.id, edicion)
    }, 300),
  })
}

async function flushPendientes() {
  // `lineasPendientes` y no `pendientes`: ese nombre ya es el ref de las cuentas
  // que quedaron sin responsable, y sombrearlo acá deja dos cosas sin relación
  // llamadas igual en el mismo archivo.
  const lineasPendientes = [...pendingByLinea.entries()]
  // **Los timers se cancelan todos acá, antes del primer `await`.** Cancelarlos
  // dentro del loop —como estaba— solo alcanzaba al de la primera línea: los de
  // 2..N seguían armados durante la espera de red del primero y disparaban
  // solos, así que la segunda línea salía con DOS `PATCH` (y dos toasts
  // idénticos si el servidor rechazaba). Medido el 2026-09-02 por la revisión
  // del diff, con el `PATCH` retenido más de 300 ms.
  for (const [, { timer }] of lineasPendientes) clearTimeout(timer)
  // Foto de las cuentas al empezar, como RESPALDO del guard de abajo:
  // `onSelectMesa` manda lo pendiente y acto seguido `cargarCuentas` reemplaza
  // `cuentas.value` por la lista de otra mesa, y ahí leer solo lo vivo daría
  // "la línea ya no está" para todas menos la primera y se comería ediciones.
  const cuentasAlEmpezar = cuentas.value
  for (const [lineaId] of lineasPendientes) {
    // ⚠️ **Se manda lo VIVO, y si ya no hay nada vivo NO se manda.** La foto
    // sirve para saber QUÉ líneas atender; lo que se manda sale del `Map`, que
    // es lo único que sabe qué puso el garzón recién. Durante el `await` de red
    // de la línea anterior la entrada de ésta puede haber cambiado o
    // desaparecido, y cada caso tiene su respuesta:
    //
    // - **Reemplazada** (el garzón volvió a tocar la línea): `onCantidadChange`
    //   armó un timer nuevo que el `clearTimeout` de arriba —hecho sobre la
    //   foto— no alcanzó. Se manda lo nuevo y se cancela ESE timer, así no
    //   queda armado para disparar sobre una entrada que no es la suya.
    // - **Desaparecida**: solo hay tres puertas —su propio timer ya disparó (y
    //   entonces el `PATCH` ya salió), `descartarPendientes` la tiró porque la
    //   cuenta se canceló, u otro flush concurrente ya la atendió— y **las tres
    //   quieren decir "no mandar"**. Mandar la foto ahí pisaba lo nuevo con lo
    //   viejo: medido, el garzón ponía 7, el timer mandaba 7 y el flush mandaba
    //   5 después, sin toast y con la comanda saliendo en 5.
    //
    // Las dos mitades las cazó la revisión independiente, en dos pasadas.
    const viva = pendingByLinea.get(lineaId)
    if (!viva) continue
    clearTimeout(viva.timer)
    const { timer: _vivo, ...edicion } = viva
    // ⚠️ **La entrada se saca acá, no arriba junto con los timers.** Vaciar el
    // Map entero antes del loop —como estaba— abría una ventana entre el
    // `clear()` y el dispatch de las líneas 2..N en la que `onCantidadChange`
    // no encontraba ni pendiente ni `inflight`, y recalculaba el `previo`
    // **desde la línea**, que ya trae el optimista sin confirmar: re-editar la
    // segunda línea mientras viajaba el `PATCH` de la primera dejaba pintada
    // una cantidad que el servidor había rechazado. Es exactamente lo que el
    // `Map` de `inflight` cerró en su ventana hermana. Medido el 2026-09-02 por
    // la revisión del diff, contra control.
    pendingByLinea.delete(lineaId)
    // Quitar una línea no cancela su timer, así que puede haber salido de la
    // cuenta dentro de la ventana del debounce: mandarle el `PATCH` sería un 404
    // y un toast por algo que el garzón ya deshizo. Se mira **lo vivo primero**
    // —`aplicarCuentaActualizada` reemplaza el array, así que la foto envejece
    // en la primera vuelta— y la foto solo cuando la lista ya no es de esta
    // mesa.
    const cuenta = cuentas.value.find(c => c.id === edicion.cuentaId)
      ?? cuentasAlEmpezar.find(c => c.id === edicion.cuentaId)
    if (!cuenta?.lineas.some(l => l.id === lineaId)) continue
    // `payload` sale del Map y NO se relee de la cuenta: la respuesta de la
    // iteración anterior ya pisó el optimista de esta línea. Ver el docblock
    // de `pendingByLinea`.
    await patchLineaCantidad(lineaId, edicion)
  }
  while (inflight.value.size > 0) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * Tira las ediciones pendientes **de una cuenta** sin mandarlas. Lo llaman
 * **dos** acciones, y en las dos el caso es el mismo: la edición que **nace
 * durante** el vuelo, cuando lo que había antes ya salió por el
 * `flushPendientes` que ambas hacen primero.
 *
 * - `confirmarCancelar`, para su propia cuenta: queda `cancelada`.
 * - `fusionarSeleccionadas`, para **todas** las que entraron a la fusión: las de
 *   origen quedan `cancelada`, y la de destino sigue abierta pero con la cantidad
 *   ya sumada, así que un `PATCH` absoluto tardío la pisa. El porqué completo
 *   está en el comentario de ese loop.
 *
 * En cancelar son **dos** ventanas seguidas —la del flush y la del request—, no
 * una.
 *
 * ⛔ **El `cuentaId` no es decoración: sin él esto se llevaba puesta la edición
 * de OTRA cuenta.** Vaciaba `pendingByLinea` entero, y el Map es de la pantalla,
 * no de la cuenta activa —por eso `EdicionCantidad` lleva su propio `cuentaId`—.
 * Con el cancelar en vuelo el garzón puede volver al listado, entrar a otra
 * cuenta y editar ahí; al volver el request, esa edición se perdía **en
 * silencio**, con la cantidad optimista pintada y sin rollback. La revisión del
 * diff lo levantó en su tercera pasada, después de que las dos anteriores
 * cerraran la misma forma en las otras dos sentencias de esta función.
 *
 * Mientras salir descartaba, esto no hacía falta: el timer disparaba,
 * `patchLineaCantidad` veía `activeCuenta` en `null` y cortaba callado. Al
 * hacer que salir mande, ese silencio dejó de existir y el caso hay que
 * nombrarlo.
 *
 * ⚠️ **Sigue corriendo después del `await` de `cancelarCuenta`, y tiene que ser
 * así:** descartando antes, un cancelar que falla perdía la edición en silencio.
 * Lo que ya NO pasa es que el `PATCH` de una edición vieja llegue tarde: ésa
 * salió antes del request, con la cuenta todavía abierta.
 */
function descartarPendientes(cuentaId: string) {
  for (const [lineaId, edicion] of pendingByLinea) {
    if (edicion.cuentaId !== cuentaId) continue
    clearTimeout(edicion.timer)
    pendingByLinea.delete(lineaId)
  }
}

/**
 * Volver al listado de cuentas **manda lo que quedó a medio camino** (decisión
 * del owner, 2026-09-02).
 *
 * La escena que cierra: el garzón cambia una línea de 1 a 3 y toca *Cuentas*
 * antes de que pasen los 300 ms del debounce. Hasta ese día no salía ningún
 * `PATCH` ni ningún toast, y al volver a entrar el input mostraba **3** — la
 * cantidad quedaba pintada como guardada y el servidor seguía en 1.
 *
 * **Sin `await`**: volver al listado es instantáneo, no espera la red.
 * `flushPendientes` cancela **todos** los timers de forma sincrónica antes de su
 * primer `await`, así que para cuando `volverACuentas` corre ya no queda ninguno
 * que pueda disparar después. Si el servidor rechaza, el rollback y el toast
 * llegan igual —por eso el toast nombra la mesa y la cuenta—.
 */
function salirDeCuenta() {
  void flushPendientes()
  volverACuentas()
}

/**
 * Cerrar el drawer de la mesa —ESC, el backdrop, arrastrarlo— es la **quinta
 * salida** de una cuenta, y era la única sin dueño: no tocaba `activeCuenta` ni
 * lo pendiente, así que la edición se guardaba solo de rebote, porque el timer
 * de 300 ms terminaba disparando.
 *
 * Peor que eso: con `activeCuenta` viva y **nada** en pantalla, el toast de
 * rechazo se creía "en la cuenta" y se comía el `Mesa 3 · Cuenta 1`, que es
 * justo el caso para el que ese texto existe. Lo encontró la revisión del diff.
 *
 * Cerrar hace lo mismo que tocar *Cuentas*: manda lo pendiente y suelta la
 * cuenta.
 */
function onDrawerMesaToggle(abierto: boolean) {
  if (!abierto && activeCuenta.value) salirDeCuenta()
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

async function onRecetaConfirm(payload: PersonalizacionPayload, _resumen: string) {
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


/**
 * Si esta línea ya salió a cocina. Desde el 2026-08-16 el backend **rechaza**
 * quitarla o bajarla por debajo de lo despachado (decisión del owner,
 * 2026-08-08: el plato ya se hizo, sacarlo del sistema lo regala sin
 * registro). La pantalla no ofrece el tacho en vez de dejar que el garzón lo
 * apriete y coma un 400 — mismo criterio que el resto del proyecto con las
 * acciones que terminan en error.
 *
 * `> 0` sobre el string tal cual: `cantidadEnviada` viaja como decimal en
 * texto, así que se compara con Decimal y no con `Number`.
 */
function yaEnviadaACocina(linea: CuentaLineaDetalle): boolean {
  return new Decimal(linea.cantidadEnviada || '0').greaterThan(0)
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

/**
 * El subtotal de la línea, sobre el precio unitario **que calculó el backend**:
 * ya convertido a moneda oficial y ya con los extras de la personalización
 * adentro.
 *
 * Hasta el 2026-08-30 el precio unitario se calculaba acá, sobre el
 * `precioExtra` congelado del snapshot y sin convertir. Dos números distintos
 * del mismo pedido convivían en la pantalla: este, en la moneda del ítem, y el
 * total, que el motor calculaba aparte.
 *
 * ⚠️ **`precioUnitario`, no `subtotalNeto`.** Los dos coinciden para un ítem
 * normal, pero `subtotalNeto` viene **desbruteado** cuando el ítem tiene
 * `precio_incluye_impuesto = true` (precio de góndola): un plato de carta de
 * $10.000 se dibujaría $8.403 debajo del nombre mientras el Total de abajo sigue
 * en bruto, o sea las líneas dejarían de sumar el total en la misma pantalla —
 * justo lo que este cambio vino a matar. Tampoco `totalLinea`, que ya trae
 * descuentos e impuestos y cambiaría el significado de la fila.
 * El POS elige el mismo campo (`CarritoPanel.vue`): una sola base para las dos
 * pantallas.
 *
 * Va por `calculoVigente` por lo mismo que las advertencias y las promos de esta
 * misma fila: se atribuye a una línea POR ÍNDICE, y con un cálculo que no
 * corresponde a la cuenta que se está viendo el índice puede apuntar a otra.
 */
function lineaSubtotal(index: number, linea: CuentaLineaDetalle): string {
  const unitario = calculoVigente.value?.lineas[index]?.precioUnitario
  if (!unitario) return '—'
  return formatMonto(new Decimal(unitario).times(linea.cantidad || '0').toString())
}

// ── Comanda / precuenta ─────────────────────────────────────────────────────
async function enviarComanda() {
  if (!activeCuenta.value || !selectedMesa.value) return
  enviandoComanda.value = true
  // **Congelado ANTES de la espera**, igual que `confirmarCancelar`,
  // `fusionarSeleccionadas` y `cerrarCuentaConPin`: es la cuarta puerta de la
  // misma forma —precondición antes del `await`, estado reactivo releído
  // después—. Durante `flushPendientes()` el botón *Cuentas* sigue vivo (el
  // `:loading` va solo al de comanda), y desde ahí `activeCuenta` queda en
  // `null` o, peor, en OTRA cuenta si el garzón se mete en una.
  //
  // Lo medido con las cuatro lecturas sin congelar: con `null`, `TypeError:
  // Cannot read properties of null (reading 'id')` adentro del `try`, que el
  // `catch` de abajo muestra como *"Error al enviar la comanda (¿QZ Tray está
  // abierto?)"* —**le echa la culpa a la impresora y la comanda no llega a
  // cocina**—; con otra cuenta abierta, el claim salía con el id de esa otra,
  // que avanza su `cantidad_enviada` sin que nadie haya pedido su comida.
  //
  // Se congela la cuenta entera, no solo el id: el `numero` y el garzón van
  // impresos en el ticket, así que releerlos daría un papel de una cuenta y una
  // comida de otra. Lo que **pinta** queda vivo a propósito, y son dos cosas: el
  // toast, que es global y además dice la verdad —la comanda salió—, igual que
  // en cancelar y en fusionar; y `enviandoComanda`, que es un `ref` de pantalla,
  // no de cuenta: si el garzón se mete en OTRA cuenta durante la espera, el
  // spinner y el `disabled` caen sobre el botón de esa otra. Volviendo al
  // listado no cae en ningún lado, porque el botón vive dentro del bloque de
  // `activeCuenta` y ahí no se rinde. Acotarlo pediría un flag por cuenta, y el
  // `finally` lo baja igual.
  const cuenta = activeCuenta.value
  const mesaNombre = selectedMesa.value.nombre
  try {
    await flushPendientes()
    const estaciones = await impresorasApi.imprimirComanda(cuenta.id, {
      mesaNombre,
      cuentaNumero: cuenta.numero,
      garzonNombre: cuenta.garzonResponsableNombre,
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
      promociones: agregarPromocionesVenta(res.lineas),
      ...(propinaHabilitada.value && new Decimal(propinaPorcentaje.value || '0').gt(0)
        ? { propinaSugerida: {
            porcentaje: propinaPorcentaje.value,
            // Misma cuenta que la sugerencia del cobro, por la misma función: acá
            // estaba repetida a mano y con los 0 decimales hardcodeados.
            monto: sugerirPropina(
              res.totales.totalFinal,
              decimalesPropina.value,
              propinaPorcentaje.value,
            ),
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
  cancelando.value = true
  // **Congelado ANTES de la espera, igual que en fusionar.** El `await` de abajo
  // es de red, y durante ese tramo el garzón puede volver al listado —el botón
  // *Cancelar* del modal no está deshabilitado, y el modal cierra con ESC o
  // backdrop—, lo que deja `activeCuenta` en `null`. Releyendo el id después, el
  // `try` moría con un `TypeError` y **el cancelar no salía**: el garzón
  // confirmaba anular la cuenta, veía un toast rojo con un mensaje de JavaScript
  // y la cuenta seguía abierta. Lo midió la revisión del diff, segunda pasada.
  const cuentaId = activeCuenta.value.id
  const mesaId = selectedMesa.value.id
  try {
    // **Primero se termina lo que quedó a medio guardar** (decisión del owner,
    // 2026-09-05). Hasta ese día se descartaba, y quedaba una ventana: si los
    // 300 ms del debounce se cumplían mientras viajaba el request de cancelar,
    // el `PATCH` ya había salido y llegaba tarde, con un toast que nombraba una
    // cuenta que el garzón acababa de anular. Mandándolo antes, esa edición viaja
    // con la cuenta todavía abierta.
    // El costo: se guarda una cantidad en una cuenta que se va a anular igual.
    // Un request de más, no plata.
    // ⚠️ **Cierra la ventana de lo que estaba pendiente al confirmar, no todas.**
    // Una edición que NACE durante estos dos `await` y cuyo timer alcanza a
    // disparar sale igual y puede aterrizar tarde; para eso está el
    // `descartarPendientes` de abajo, que tampoco es una garantía sino una
    // ventana más chica.
    await flushPendientes()
    await salonesApi.cancelarCuenta(cuentaId)
    // Sigue haciendo falta después del flush: el garzón puede tocar el stepper
    // mientras viaja el request de cancelar, y esa edición nueva sí caería sobre
    // una cuenta que ya no está. Va acá y **no antes del request**: cancelar
    // falla de verdad —`400` si otro dispositivo ya la cerró, `404`, red—, y
    // descartando primero el garzón se quedaba dentro de la cuenta con la
    // cantidad pintada, sin `PATCH`, sin rollback y sin timer que lo mandara
    // después. Lo midió la revisión del diff.
    descartarPendientes(cuentaId)
    toast.add({ title: 'Cuenta cancelada', color: 'success' })
    // El mismo id congelado: con `activeCuenta` ya en `null`, este filtro no
    // sacaba nada y la cuenta cancelada se quedaba pintada en el listado.
    cuentas.value = cuentas.value.filter(c => c.id !== cuentaId)
    patchMesaOcupacion(mesaId, -1)
    // Solo si el garzón sigue parado en la cuenta que canceló: durante la espera
    // pudo entrar a otra, y sacarlo de ahí es expulsarlo de una cuenta que no
    // tiene nada que ver. Misma razón que el `cuentaId` de `descartarPendientes`.
    if (activeCuenta.value?.id === cuentaId) volverACuentas()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cancelar la cuenta'), color: 'error' })
  }
  finally {
    cancelando.value = false
    // Cerrar el modal salvo que el garzón esté parado en OTRA cuenta: durante la
    // espera puede haber entrado a una y abierto el suyo —comparten el mismo
    // `cancelOpen`—, y cerrárselo de prepo es sacarle una pregunta que todavía no
    // contestó. Lo levantó la revisión como menor.
    //
    // ⚠️ **El `!activeCuenta.value` no es opcional**, y el primer intento de este
    // guard lo omitió: en el camino feliz `volverACuentas()` ya dejó
    // `activeCuenta` en `null` dos líneas más arriba, así que preguntar solo por
    // el id dejaba el modal **abierto para siempre** después de cancelar. No lo
    // cazaba ningún test; ahora sí.
    if (!activeCuenta.value || activeCuenta.value.id === cuentaId) {
      cancelOpen.value = false
    }
  }
}

function confirmarCobro(pagos: PagoInput[], vuelto: string) {
  // La cuenta y la mesa del modal, no las que estén activas: ver `abrirCobro`.
  const cuenta = cobroCuenta.value
  if (!cuenta) return
  // **Nada de esto se relee después**, y por eso viaja como argumento en vez de
  // leerse adentro. `cerrarCuentaConPin` corre después de
  // `await flushPendientes()`, o sea con la pantalla clickeable: el modal de
  // cobro ya cerró (dos líneas más abajo) y el de PIN cierra al emitir
  // `confirm`, así que no queda ningún modal tapando el drawer — y en modo
  // tablet no hay modal de PIN siquiera. Leyéndolas adentro, el garzón que
  // volvía al listado en ese tramo se comía el cobro entero: el guard cortaba
  // en seco y no había ni venta ni aviso, con el PIN ya tecleado.
  //
  // La cuenta y la mesa vienen de más atrás todavía —de cuando el modal se
  // abrió, ver `abrirCobro`—; las propinas se congelan acá, que es cuando el
  // garzón las fijó.
  //
  // ⚠️ **Las propinas van en la foto, y el primer intento las dejó vivas** con el
  // argumento de que el modal ya las había fijado. Lo refutó la revisión
  // MIDIÉNDOLO: en esa misma ventana el botón *Cerrar y cobrar* sigue habilitado
  // —`submitting` recién se prende adentro—, y un solo tap reabre el modal, cuyo
  // `watch(open)` **reescribe** `propinaMonto`. Medido: cobro confirmado con
  // propina 0 y `POST .../cerrar` saliendo con 500, contra unos `pagos` que sí
  // estaban congelados. `propinaPorcentaje` y `propinaHabilitada` NO van: solo
  // se escriben en el `onMounted`.
  const cobro = {
    cuenta,
    mesa: cobroMesa.value,
    pagos,
    vuelto,
    propinaMonto: propinaMonto.value || '0',
    propinaSugerida: propinaSugerida.value || propinaMonto.value || '0',
  }
  // El cobro recolecta los pagos; el PIN identifica al garzón que cierra.
  cobroOpen.value = false
  solicitarPin('PIN del garzón para cerrar la cuenta', (garzonId, pin) => {
    void (async () => {
      await flushPendientes()
      await cerrarCuentaConPin(cobro, garzonId, pin)
    })()
  })
}

/**
 * ⚠️ Todo lo que hay en `cobro` llega **por argumento**: es la foto de cuando el
 * garzón confirmó, no lo que haya en pantalla cuando esto corre. Ver
 * `confirmarCobro`, que la saca. El reintento del `catch` reusa esa misma foto,
 * así que tampoco puede cerrar otra cuenta ni cobrar otra propina.
 *
 * Lo que se lee de un `ref` acá adentro es una decisión aparte, tomada de a una
 * y escrita donde se toma. Las que quedan vivas —`propinaPorcentaje`,
 * `propinaHabilitada`, `emisor`, `metodos`, `tiposDocumento`— se cargan las
 * cinco en el `Promise.all` del arranque y nada de esta ventana las mueve.
 */
async function cerrarCuentaConPin(
  cobro: {
    cuenta: CuentaDetalle
    mesa: MesaResumen | null
    pagos: PagoInput[]
    vuelto: string
    propinaMonto: string
    propinaSugerida: string
  },
  garzonId: string,
  pin: string,
) {
  submitting.value = true
  // Todo lo que viene adentro de `cobro` es la foto; lo que se lee de un `ref`
  // acá abajo es una decisión aparte, tomada de a una.
  const { cuenta: cuentaCerrada, mesa: mesaCerrada, pagos, vuelto } = cobro
  const tipMonto = cobro.propinaMonto
  const tipSugerida = cobro.propinaSugerida
  try {
    // La boleta y la proyección local de la caja salen de acá: se espera el
    // cálculo de ESTA cuenta, no el que quedó de la mutación anterior. Dentro
    // del `try` para que un fallo no deje el drawer trabado en `submitting`.
    //
    // ⚠️ **Condicionado a seguir parado en la cuenta que se cobra**, porque
    // `asegurarVigente()` calcula el carrito **vivo**: si el garzón se metió en
    // otra durante el flush, devolvía el resultado de ESA, y la boleta salía con
    // las líneas de una cuenta y los totales de la otra —y con esos totales se
    // proyectaba la caja—.
    //
    // ⚠️ **Y la cuenta del ticket se toma acá, no de la foto**, porque el flush
    // que acaba de correr REEMPLAZA el objeto de la cuenta: `itemsParaTicket`
    // cruza líneas y cálculo **por índice** y prefiere la `cantidadPresentacion`
    // de la línea, así que una foto vieja contra un cálculo fresco imprime una
    // cantidad y cobra otra. Lo levantó la revisión: la primera versión de este
    // arreglo pasaba `cuentaCerrada`, que es de antes del flush. Se relee
    // después del `await` de `asegurarVigente()` porque ése también espera.
    //
    // Sin cálculo se cae al camino que ya existía más abajo: la venta se genera
    // igual y el aviso lo dice. ⚠️ **Y esa venta se queda sin boleta, punto:**
    // no hay reimpresión en el sistema (el ticket siempre se arma contra estado
    // vivo). Se acepta porque el otro platillo es peor —hoy, ese mismo gesto
    // deja la venta **sin generar**— y porque es el camino que el cálculo
    // fallado ya tenía. La salida buena, recalcular la cuenta cobrada por
    // fuera de la vigencia, es un frente propio (`pendientes.md` § 2), y ahí
    // también entra que `targetCobro` cae en `bruto` y la proyección de caja
    // se infla por el vuelto.
    let resultadoCerrado: ResultadoVenta | null = null
    let cuentaDelTicket: CuentaDetalle | null = null
    if (activeCuenta.value?.id === cuentaCerrada.id) {
      const res = await asegurarVigente()
      if (res && activeCuenta.value?.id === cuentaCerrada.id) {
        resultadoCerrado = res
        cuentaDelTicket = activeCuenta.value
      }
    }
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

    if (resultadoCerrado && cuentaDelTicket) {
      try {
        await impresorasApi.imprimirBoleta({
          emisor: emisor.value,
          facturacionElectronica: false,
          meta: {
            cajero: authStore.user?.nombre ?? undefined,
            mesa: mesaCerrada?.nombre,
          },
          items: itemsParaTicket(cuentaDelTicket, resultadoCerrado),
          totales: resultadoCerrado.totales,
          impuestos: agregarImpuestosVenta(resultadoCerrado.lineas),
          promociones: agregarPromocionesVenta(resultadoCerrado.lineas),
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

    // El filtro va sin condicionar: si el garzón se cambió de mesa, `cuentas`
    // ya es la lista de la otra y sacar un id que no está es un no-op —y al
    // volver, `cargarCuentas` la vuelve a pedir—.
    cuentas.value = cuentas.value.filter(c => c.id !== cuentaCerrada.id)
    // La ocupación es de la mesa que se liberó, no de la que el garzón esté
    // mirando: va con la mesa **congelada**. Leyéndola viva le restaba la cuenta
    // a la mesa equivocada y dejaba las dos mal pintadas —una ocupada de más, la
    // otra de menos— hasta que alguien recargara, porque `cargarSalones()` solo
    // corre en el `onMounted`. (Adentro, `patchMesaOcupacion` sí decide vivo si
    // le toca refrescar `selectedMesa`: eso es lo que se pinta.)
    if (mesaCerrada) {
      patchMesaOcupacion(mesaCerrada.id, -1)
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
    // Lo que se PINTA se condiciona, igual que en cancelar: sacarlo de donde
    // esté sería una expulsión si mientras tanto abrió otra cuenta.
    if (activeCuenta.value?.id === cuentaCerrada.id) volverACuentas()
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'Error al cerrar la cuenta', () => { void cerrarCuentaConPin(cobro, garzonId, pin) })
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
      <AppDrawer
        v-model:open="mesaDrawerOpen"
        width="90%"
        :ui="drawerBodyUi"
        @update:open="onDrawerMesaToggle"
      >
        <template #header>
          <div class="flex items-center gap-2 sm:gap-3">
            <UButton
              v-if="activeCuenta"
              icon="i-lucide-arrow-left"
              label="Cuentas"
              color="neutral"
              variant="subtle"
              size="sm"
              @click="salirDeCuenta"
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
                :items="items"
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
                      <p class="text-xs text-muted">{{ lineaSubtotal(index, linea) }}</p>
                      <AdvertenciasPrecio :advertencias="calculoVigente?.lineas[index]?.advertencias ?? []" />
                      <PromocionesAplicadas :promociones="calculoVigente?.lineas[index]?.trazas.promociones ?? []" />
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
                      :disabled="yaEnviadaACocina(linea)"
                      :title="yaEnviadaACocina(linea)
                        ? 'Ya se despachó a cocina: registralo como merma o cortesía para que quede el rastro'
                        : 'Quitar'"
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
        :total="cobroTotal"
        :venta-total="cobroTotal"
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
        :loading="cancelando"
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
