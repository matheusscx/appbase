<script setup lang="ts">
import Decimal from 'decimal.js'
import { type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
import { sugerirPropina, fetchPorcentajeSugerido, PROPINA_PORCENTAJE_DEFAULT } from '~/composables/usePropina'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'
import {
  cuentaToCalcularInput,
  tipoMotivoBajaLabel,
  formatCantidadAnulacion,
  type SalonConMesas,
  type MesaResumen,
  type CuentaDetalle,
  type CuentaLineaDetalle,
  type CuentaAnulacionDetalle,
  type CuentaAsignacionDetalle,
  type MotivoCuentaAsignacion,
  type TipoMotivoBaja,
  type BoletaVenta,
} from '~/composables/useSalones'
import type { EventoPin, Garzon, MiPinEstado } from '~/composables/useGarzones'
import { etiquetaCuentaPendiente, useTransferenciaPendientes } from '~/composables/useSesionesGarzon'
import { personalizacionVacia, type PersonalizacionPayload } from '~/composables/useRecetaPersonalizacion'
import type { Turno } from '~/composables/useTurnos'
import type { SolicitudTestigo } from '~/composables/useSalones'
import { formatCantidadLinea, unidadBaseItem } from '~/utils/cantidad-presentacion'
import { conTimeout } from '~/utils/con-timeout'
import { agregarImpuestosVenta, agregarPromocionesVenta, type TicketAnulada } from '~/utils/ticket-builder'
import { shellUi } from '~/utils/ui-shell'

// `Salones:Operar`, no `Leer`: lo que esta pantalla pide para abrirse es
// `GET /salones/operacion` (`salones.controller.ts`), que exige `Operar`. Sin
// el middleware, quien tiene `Salones:Leer` pero no `Operar` —el rol
// "Salones · Encargado" del seed es exactamente ese— entraba por URL directa o
// bookmark y se quedaba en una pantalla VACÍA con un toast genérico: el
// listado rebotaba con 403 y no había nada más que ver. El menú ya no le
// muestra el link (`layouts/dashboard.vue`), así que el callejón solo se
// alcanzaba a mano. Su pantalla es Configuración → Salones, que sí pide `Leer`.
// Esconder no es seguridad (invariante 6): el candado real sigue siendo el
// `@RequiresPermiso` del backend.
//
// El `permisoLabel` NO es cosmético: el aviso del middleware es *"No tenés
// acceso al módulo ${label}"*, y con el default diría "…al módulo Salones",
// que para este usuario es falso —tiene el módulo, administra salones—. El
// label es lo único que ese mensaje deja ajustar (no puede nombrar la acción).
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Salones:Operar',
  permisoLabel: 'Salones (operación)',
  layout: 'dashboard',
})

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
 * verificó para ella. Los tres se escriben juntos, en un mismo instante, y en
 * dos lugares nada más: `abrirCobro` los pone y el `watch` de acá abajo los tira
 * cuando el modal se cierra.
 */
const cobroCuenta = ref<CuentaDetalle | null>(null)
const cobroMesa = ref<MesaResumen | null>(null)
const cobroTotal = ref('0')
/**
 * **La foto vive lo que vive el modal.** Sin esto `cobroCuenta` queda apuntando a
 * la última cuenta que se abrió a cobrar **para siempre** —`confirmarCobro` y el
 * *Cancelar* del propio modal solo apagan `cobroOpen`—, y cualquier cosa que
 * pregunte *"¿hay un cobro en curso?"* contesta que sí sobre un cobro que el
 * garzón cerró hace rato. Lo midió la revisión: la fusión le avisaba que la
 * cuenta *"entró en la fusión"* y que la cobrara desde la fusionada, sin que
 * hubiera ningún cobro. (Ése es el texto que sale, y no el de *"el cobro se
 * cerró"*: `estabaAbierto` ya vale `false` en esas escenas.)
 *
 * `confirmarCobro` no se ve afectado: copia lo que necesita **antes** de apagar
 * `cobroOpen`.
 */
watch(cobroOpen, (abierto) => {
  if (!abierto) {
    cobroCuenta.value = null
    cobroMesa.value = null
    cobroTotal.value = '0'
  }
})

/**
 * La cuenta de un cobro **pedido y todavía calculándose**: el garzón ya tocó
 * *Cerrar y cobrar* pero el modal no llegó a abrir. Existe para que
 * `fusionarSeleccionadas` pueda avisarle también en ese tramo — ver ahí—, sin
 * tener que **deducir** desde `abrirCobro` por qué desapareció la cuenta.
 * Deducirlo desde el listado sale mal: cancelar la cuenta uno mismo la saca
 * igual, y ahí el aviso mentía diciendo que se había fusionado (lo midió la
 * revisión con sonda).
 */
const cobroPedidoId = ref<string | null>(null)
const abriendoCobro = ref(false)
const submitting = ref(false)
/**
 * La cuenta de un cobro **ya confirmado con el PIN y todavía en vuelo**: el
 * tramo entre el *Confirmar* y el `POST /cuentas/:id/cerrar`, que espera el
 * flush. Se prende en `confirmarCobro` y se apaga con `submitting`, que cubre
 * el mismo tramo.
 *
 * ⚠️ **`cerrarCuentaConPin` no la re-arma, y tampoco a `submitting`: las dos las
 * prende `confirmarCobro`.** Con esta además importa el orden —el porqué está
 * escrito arriba de todo en esa función, y es lo único que hace que esto sirva—:
 * la fusión pudo anularla durante el flush, que corre antes de esa llamada.
 *
 * Existe por lo mismo que `cobroPedidoId`, un paso más adelante en el reloj:
 * ahí el modal todavía no abrió, acá ya cerró y el `watch` de arriba tiró la
 * foto, así que la cuenta que se está cobrando vive **solo en el argumento
 * `cobro`** de `cerrarCuentaConPin` y nadie de afuera puede leerla. Sin esto,
 * `fusionarSeleccionadas` no puede ver que hay un cobro en vuelo sobre una de
 * las cuentas que se está llevando.
 *
 * ⚠️ **Lo que la hace servir no es ser id-independiente, es que la fusión la
 * ANULA** —igual que `cobroPedidoId`, y por la misma razón medida: la cuenta
 * DESTINO de una fusión conserva su id, así que comparar ids contra lo que haya
 * vivo no distingue nada ahí. Ver el guard de `cerrarCuentaConPin`.
 */
const cobroEnVueloId = ref<string | null>(null)
/**
 * **La cuenta que se está cobrando no se modifica** (owner, 2026-09-13). Desde que se toca
 * *Cerrar y cobrar* no se cambian cantidades, no se agregan ni quitan productos y no se cancela ESA
 * cuenta; el resto de la pantalla sigue libre. Son dos tramos con su marca: mientras se calcula el
 * total (`cobroPedidoId`) y del *Confirmar* a que el cierre termine —o falle, o se cierre el teclado
 * de PIN sin tipear— (`cobroEnVueloId`). Entre los dos el modal de cobro cubre la pantalla.
 * El primero se sumó el mismo día, medido: con *Cancelar cuenta* confirmado durante el cálculo, el
 * cobro abría igual y salían el cancelar y el cierre sobre la misma cuenta.
 * Antes, un cambio hecho en ese tramo podía entrar a la venta contra los pagos del total viejo
 * —queda `pagada_parcial`, sin aviso— o imprimirse en la boleta sin entrar a la venta.
 *
 * En el segundo tramo, si una fusión se lleva la cuenta y anula
 * la marca, se desbloquea: en general ese cobro ya no se cierra, pero si la fusión vuelve con el
 * `POST` de cierre ya despachado, la cuenta destino queda editable con ese cierre en vuelo —un
 * borde que esto no cubre—. Los controles se deshabilitan y los cuatro caminos que mutan la cuenta
 * (`onCantidadChange`, `addProducto`, `onRecetaConfirm`, `quitarLinea`) y `confirmarCancelar`
 * además cortan, porque el
 * evento puede llegar igual: el catálogo no tiene `disabled`, y el panel de una receta puede
 * quedar abierto debajo del cobro.
 * ⚠️ Cubre esta pantalla: otro dispositivo sobre la misma cuenta no pasa por acá.
 */
const cuentaActivaEnCobro = computed(() =>
  !!activeCuenta.value
  && (cobroEnVueloId.value === activeCuenta.value.id || cobroPedidoId.value === activeCuenta.value.id),
)

/** El aviso de un gesto que corta por `cuentaActivaEnCobro` sin control deshabilitado a la vista. */
function avisarCuentaEnCobro() {
  toast.add({
    title: 'Esta cuenta se está cobrando',
    description: 'No se puede modificar hasta que termine el cobro.',
    color: 'warning',
  })
}

/**
 * Los requests que cambian las líneas de una cuenta y todavía no volvieron: agregar un producto o
 * una receta, y quitar una línea. Ninguno pinta antes de la respuesta, así que mientras viajan la
 * pantalla —y el total que calcula `asegurarVigente`— muestra la cuenta sin ese cambio.
 * `abrirCobro` los espera (owner, 2026-09-13: *"Cobrar espera"*): antes el cobro abría con el total
 * de antes y el cierre no los esperaba, así que la venta quedaba cobrada de menos sin aviso si el
 * cambio entraba primero, o el cambio rebotaba si entraba después.
 *
 * Las cantidades no entran: se pintan optimistas, así que el cálculo ya las ve, y el *Confirmar*
 * las manda con `flushPendientes`.
 */
type CambioDeLinea = 'agregar' | 'quitar'
/** Por cuenta, cada request en vuelo con qué hace: el aviso del techo lo nombra (`abrirCobro`). */
const lineasEnVuelo = new Map<string, Map<Promise<unknown>, CambioDeLinea>>()
/**
 * Cuánto espera *Cerrar y cobrar* a `lineasEnVuelo` y al cálculo del total antes de rendirse
 * (owner, 2026-09-13: 10 s). Sin techo, con el wifi caído a mitad de un guardado el navegador
 * tarda minutos en darlo por fallido —`useApiFetch` no tiene timeout— y la cuenta quedaba
 * bloqueada todo ese tiempo, sin poder ni cancelarse. Al rendirse avisa y desbloquea; no reintenta
 * solo.
 */
const LIMITE_ABRIR_COBRO_MS = 10_000
const MENSAJE_LIMITE_ABRIR_COBRO = 'El cobro tardó demasiado en abrir'
function registrarEnVuelo<T>(cuentaId: string, cambio: CambioDeLinea, request: Promise<T>): Promise<T> {
  const enCuenta = lineasEnVuelo.get(cuentaId) ?? new Map<Promise<unknown>, CambioDeLinea>()
  lineasEnVuelo.set(cuentaId, enCuenta)
  enCuenta.set(request, cambio)
  const sacar = () => {
    enCuenta.delete(request)
    if (enCuenta.size === 0 && lineasEnVuelo.get(cuentaId) === enCuenta) lineasEnVuelo.delete(cuentaId)
  }
  request.then(sacar, sacar)
  return request
}
const cancelOpen = ref(false)
/**
 * El botón del modal de cancelar, en espera. Desde que cancelar manda primero lo
 * pendiente (owner, 2026-09-05) hay un tramo de red antes de que pase nada: sin
 * esto el botón queda inerte y se lee como que la app se colgó.
 */
const cancelando = ref(false)
/**
 * Cancelar una cuenta con algo despachado exige motivo y `Salones:Anular`
 * (Task 6, spec § 6). Modal APARTE del `CrudModal` de siempre —no un
 * `#detalle` metido ahí— para no tocar la forma del que ya conviven con el
 * drawer real abierto: agregarle un slot con `USelectMenu`, aunque no
 * renderizara nada (`v-if` en falso), desordenaba los dos `[role="dialog"]`
 * teletransportados y hacía que `drawerMesa()` de los tests agarrara el modal
 * en vez del drawer. Medido revirtiendo solo el slot.
 */
const cancelMotivoId = ref<string | undefined>(undefined)
const motivosCancelar = ref<{ id: string, nombre: string, tipo: TipoMotivoBaja }[]>([])
const cargandoMotivosCancelar = ref(false)
const motivosCancelarItems = computed(() =>
  motivosCancelar.value.map(m => ({
    label: `${m.nombre} (${tipoMotivoBajaLabel(m.tipo)})`,
    value: m.id,
  })),
)
/** Si la cuenta del modal tiene algo despachado — decide qué modal de cancelar mostrar. */
const cancelTieneDespachado = computed(
  () => !!activeCuenta.value && tieneAlgoDespachado(activeCuenta.value),
)

async function cargarMotivosCancelar() {
  cargandoMotivosCancelar.value = true
  try {
    motivosCancelar.value = await salonesApi.listarMotivosBajaActivos()
  }
  catch (e: unknown) {
    motivosCancelar.value = []
    toast.add({ title: apiErrorMsg(e, 'No se pudieron cargar los motivos'), color: 'error' })
  }
  finally {
    cargandoMotivosCancelar.value = false
  }
}

/**
 * Botón "Cancelar cuenta": si hay algo despachado, hace falta `Anular` —quien
 * no lo tiene ve el aviso y no se abre ningún modal, la cuenta sigue intacta—.
 * Sin nada despachado, el flujo simple de siempre.
 */
function abrirCancelar() {
  if (!activeCuenta.value) return
  if (cuentaActivaEnCobro.value) {
    avisarCuentaEnCobro()
    return
  }
  const despachado = tieneAlgoDespachado(activeCuenta.value)
  if (despachado && !puedeAnularLinea.value) {
    toast.add({
      title: 'Esta cuenta tiene platos despachados a cocina: hace falta un encargado con permiso para anular.',
      color: 'warning',
    })
    return
  }
  cancelMotivoId.value = undefined
  if (despachado) void cargarMotivosCancelar()
  cancelOpen.value = true
}

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
// Frente de bodegas y traslados: el 400 de "no hay stock" ofrece el traslado
// precargado solo a quien de verdad puede crearlo. El garzón no tiene
// `Inventario/Crear` — mismo permiso que ya exige `POST /traslados` y que ya
// usa `inventario/traslados.vue`—, así que ve el mensaje y nada más.
const { puedeCrear: puedeTrasladar } = usePermisosCrud('Inventario')
const { mostrarRechazoPorStock } = useRechazoPorStock()

// `Anular` no es uno de los cuatro permisos CRUD de `usePermisosCrud` —es la
// acción de `POST .../lineas/:lineaId/anular`, `@RequiresPermiso('Salones',
// 'Anular')`—, así que se consulta directo al store, mismo mecanismo que
// `VentaDetalleDrawer.vue` (`Ventas:Anular`) y `OrdenDetalleDrawer.vue`
// (`Pasarelas:Reembolsar`) ya usan para este tipo de gesto. Esconder el botón
// es UX (invariante 6): el candado real es el guard del backend.
const permissionsStore = usePermissionsStore()
const puedeAnularLinea = computed(() => permissionsStore.can('Salones', 'Anular'))

const anularModalOpen = ref(false)
/** La cuenta y la línea del modal, no las activas — mismo motivo que
 *  `transferAdminCuenta`: el garzón puede irse a otra cuenta mientras el modal
 *  sigue abierto, y confirmar tiene que anular la que se abrió, no la que
 *  quedó activa. */
const anularModalCuenta = ref<CuentaDetalle | null>(null)
const anularModalLinea = ref<CuentaLineaDetalle | null>(null)
const anulando = ref(false)
/** `unidadBaseLinea` depende del catálogo (`items`), cargado en la página —el
 *  modal no lo tiene, así que recibe el resultado ya resuelto. */
const anularModalUnidadBase = computed(() =>
  anularModalLinea.value ? unidadBaseLinea(anularModalLinea.value) : 'unidad',
)

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
// los otros seis flujos que usan este teclado (`solicitarPin` tiene siete
// llamadores en este archivo): tocar afuera con la verificación del PIN en
// vuelo descartaría la acción en silencio.
// El precio, en esa misma ventana: la oferta reaparece y un instante después la
// transferencia se ejecuta igual. Converge bien (el cierre lo hace el propio
// bucle) y es la semántica que ya tenían los otros seis.
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
 * Toast de error. Si falta sesión de trabajo abre directo el modal para entrar a turno.
 *
 * ⛔ **La acción que falló NO se repite sola al iniciar el turno** (owner, 2026-09-11): el
 * garzón la vuelve a pedir, y por eso el aviso lo dice. Repetirla sola la hacía sobre lo
 * que hubiera en pantalla al repetir —otra mesa, otra cuenta— o, en el cobro, con los
 * pagos de antes sobre una cuenta que una fusión pudo haber cambiado entre medio.
 */
function toastErrorOperativo(e: unknown, fallback: string) {
  const msg = apiErrorMsg(e, fallback)
  if (msg.includes('sesión de trabajo')) {
    toast.add({
      title: 'Primero inicia tu turno',
      description: 'No tienes una sesión de trabajo abierta. Cuando entres a turno, vuelve a intentarlo.',
      color: 'warning',
    })
    void abrirEntrarTurno()
    return
  }
  toast.add({ title: msg, color: 'error' })
}

/** Cierra el modal de turno sin iniciar. */
function cancelarEntrarTurno() {
  turnoModalOpen.value = false
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
 * número. Hasta el 2026-09-17 salía de un `asegurarVigente()` fresco adentro de
 * `cerrarCuentaConPin` —y por eso podía quedarse sin papel si la cuenta se
 * movió entre que el modal abrió y el cierre salió (`docs/agent/pendientes.md`
 * § 2)—; ahora sale de la respuesta del propio `POST .../cerrar`
 * (`armarBoleta` sobre la venta ya persistida), así que no depende de qué
 * cuenta esté activa cuando el cierre vuelve. No es plata cobrada de más ni de
 * menos: el total de la venta lo calcula el backend a partir de las líneas —acá
 * no viaja ningún total—.
 */
async function abrirCobro() {
  const cuenta = activeCuenta.value
  const mesa = selectedMesa.value
  if (!cuenta) return
  abriendoCobro.value = true
  cobroPedidoId.value = cuenta.id
  try {
    // Lo que todavía está cambiando las líneas de esta cuenta (`lineasEnVuelo`) y después el total,
    // con techo (`LIMITE_ABRIR_COBRO_MS`). No nace nada nuevo durante la espera: `cobroPedidoId` ya
    // bloquea la cuenta. Al rendirse, el `return` pasa por el `finally`, que la desbloquea.
    let res: ResultadoVenta | null
    try {
      res = await conTimeout(
        Promise.allSettled([...(lineasEnVuelo.get(cuenta.id)?.keys() ?? [])]).then(() => asegurarVigente()),
        LIMITE_ABRIR_COBRO_MS,
        MENSAJE_LIMITE_ABRIR_COBRO,
      )
    }
    catch (e: unknown) {
      if (!(e instanceof Error) || e.message !== MENSAJE_LIMITE_ABRIR_COBRO) throw e
      if (cobroPedidoId.value === cuenta.id && activeCuenta.value?.id === cuenta.id) {
        // El aviso nombra lo que quedó colgado (owner, 2026-09-13), para que el garzón no repita lo
        // que ya viaja: un "revisá la cuenta" genérico lo mandaba a buscar el producto, no verlo y
        // agregarlo otra vez. Uno por caso, porque un quitado no "aparece": desaparece. Si el request
        // termina fallando, sale el error de siempre y ahí sí sabe que tiene que repetirlo.
        const cambios = new Set(lineasEnVuelo.get(cuenta.id)?.values() ?? [])
        let aviso = { title: 'No se pudo calcular el total', description: 'Revisá la conexión y tocá Cobrar de nuevo.' }
        if (cambios.size > 1) {
          aviso = {
            title: 'Todavía se están guardando cambios en la cuenta',
            description: 'Esperá a que terminen y después tocá Cobrar de nuevo.',
          }
        }
        else if (cambios.has('agregar')) {
          aviso = {
            title: 'Todavía se está guardando lo último que agregaste',
            description: 'No lo vuelvas a agregar: va a aparecer en la cuenta cuando termine. Después tocá Cobrar de nuevo.',
          }
        }
        else if (cambios.has('quitar')) {
          aviso = {
            title: 'Todavía se está quitando lo último que sacaste',
            description: 'No lo vuelvas a quitar: va a desaparecer de la cuenta cuando termine. Después tocá Cobrar de nuevo.',
          }
        }
        toast.add({ ...aviso, color: 'warning' })
      }
      return
    }
    // El guard va antes que el aviso: no se abre el cobro de una cuenta que ya no
    // es la de la pantalla, y al garzón que se fue a otra no se le tira un error
    // por la que dejó.
    //
    // ⚠️ **Corta mudo a propósito.** La cuenta también puede haber cambiado sin
    // que él se moviera —una fusión que aterriza durante el cálculo se lo lleva a
    // la fusionada—, y en ese caso el aviso existe, pero lo da
    // `fusionarSeleccionadas`, que **sabe** lo que pasó. Acá se intentó deducirlo
    // ("la cuenta ya no está en el listado") y la revisión lo midió falso:
    // cancelarla uno mismo la saca igual del listado, y el garzón que acababa de
    // cancelar leía que su cuenta *"se fusionó"*.
    // **La marca del pedido**: si algo la anuló mientras se calculaba, no se abre.
    // El guard de identidad de abajo **no alcanza** para eso y la revisión lo
    // midió: la cuenta **destino** de una fusión conserva su id, así que ahí
    // `activeCuenta` no cambia y el modal abría igual —con el total de antes de
    // absorber las otras líneas, o sea cobrando de menos—.
    //
    // ⚠️ **No es el token de `cargarCuentas`, y no conviene llamarlo así**: aquél
    // es un contador monótono, éste guarda el id y compara ids. Lo que lo hace
    // funcionar no es ser id-independiente, es que **alguien lo anula**. Dos
    // `abrirCobro` solapados sobre la MISMA cuenta lo engañarían; hoy no es
    // alcanzable —el botón queda deshabilitado mientras `abriendoCobro`, y se
    // midió— pero si algún día se abre otro llamador, esto pasa a ser contador.
    if (cobroPedidoId.value !== cuenta.id) return
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
    if (cobroPedidoId.value === cuenta.id) cobroPedidoId.value = null
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
 *
 * **Vacía también lo que nazca durante esta espera** (2026-09-13): la pantalla sigue tocable
 * mientras se manda lo pendiente, y un tap en ese tramo armaba un timer que el flush no
 * atendía. Si el flush terminaba antes de sus 300 ms, la página se desmontaba y ese `PATCH`
 * salía después, con un eventual rechazo avisado en otra pantalla — lo que este guard vino a
 * cerrar.
 *
 * ⚠️ **Salvo mientras hay una fusión o un cancelar en vuelo.** Con alguno de ellos, vaciar lo
 * que nace durante la espera mandaría lo que la fusión y el cancelar descartan a propósito
 * (`descartarPendientes`). Mientras alguno esté en vuelo no vacía lo que nace, que es la
 * conducta de antes; el predicado se evalúa en cada vuelta, así que vuelve a vaciar apenas
 * termina. Lo levantó la revisión del diff. **Un cobro confirmado ya no es excepción**: desde el
 * 2026-09-13 la cuenta que se cobra no acepta ediciones (`cuentaActivaEnCobro`), así que en ella
 * no nace nada que proteger, y lo que se toque en otra cuenta se vacía como siempre.
 *
 * **El residuo en ese tramo es la conducta de antes, y tiene tres caras:**
 * - lo que ya estaba pendiente al empezar a navegar **sale igual**: la primera pasada del flush
 *   no mira el predicado;
 * - una edición nacida durante la espera en la **cuenta afectada** no se manda y, si la espera
 *   termina antes de los 300 ms de su timer, la página se desmonta con ese timer armado
 *   —`onBeforeUnmount` no limpia los de `pendingByLinea`—, y se escapa si ese timer le gana al
 *   request;
 * - una edición nacida durante la espera en **otra cuenta** puede salir con la pantalla
 *   desmontada.
 *
 * Medido con *"el tap que cae mientras se espera para irse de la pantalla…"*, con los dos
 * *"irse durante …"* y con *"irse con un cobro en vuelo…"*.
 */
onBeforeRouteLeave(async () => {
  await flushPendientes(() => !fusionando.value && !cancelando.value)
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
    toastErrorOperativo(e, 'Error al abrir la cuenta')
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
    // **Y el cobro que el garzón todavía está armando sobre una de estas cuentas
    // se cae** (decisión del owner, 2026-09-05). Va acá arriba, con el descarte de
    // pendientes y no con lo que se pinta, por el mismo motivo: lo que ese cobro
    // tenía adentro dejó de valer, esté el garzón donde esté.
    //
    // ⚠️ **Son TRES tramos y el orden es el del reloj**, cada uno con su marca
    // porque en cada uno la cuenta vive en otro lado: el modal abierto
    // (`cobroCuenta`), el tap que espera su cálculo (`cobroPedidoId`) y el cobro
    // ya confirmado con el PIN que espera el flush (`cobroEnVueloId`). El tercero
    // se cerró el 2026-09-06; hasta entonces ese `POST` salía igual contra una
    // cuenta que el servidor acababa de anular y el garzón leía *"La cuenta no
    // está abierta"* con el PIN ya tecleado.
    //
    // ⚠️ **Y en el tercero no alcanza con avisar**, que es lo que la medición
    // destapó: en la cuenta DESTINO el cierre **no rebota** —conserva su id y
    // sigue abierta— y cobra de menos en silencio. Por eso ahí la marca no solo
    // dispara el toast: `cerrarCuentaConPin` no manda el `POST` sin ella.
    //
    // Ojo con "arreglar" cualquiera de los tres mirando `cobroCuenta`: antes del
    // `watch` de arriba ese ref quedaba rancio y **avisaba igual**, pero mandando
    // al garzón a *"cobrarla desde la fusionada"* con el cobro ya confirmado y en
    // vuelo. Un aviso que no describe lo que pasó es peor que no avisar.
    //
    // ⚠️ **Y aplica a las DOS mitades de la fusión, por motivos distintos** —la
    // primera versión decía "la cuenta que el modal tenía adentro ya no existe" y
    // era falso para la mitad de los casos, lo midió la revisión—:
    //
    // - **Origen**: el servidor la dejó `cancelada`, así que el *Confirmar* salía
    //   contra una cuenta muerta y el garzón tecleaba el PIN para leer *"La cuenta
    //   no está abierta"*.
    // - **Destino**: sigue **abierta** —es la fusionada—, pero acaba de absorber
    //   las líneas de las otras. El total congelado del modal es el de antes de
    //   absorberlas, o sea que cobraría de menos.
    //
    // ⚠️ **El costo, que el owner tomó con el precedente de acá al lado:** los
    // pagos cargados se pierden y hay que volver a tipearlos. Es lo mismo que ya
    // pasa dos líneas más arriba con la cantidad a medio guardar, y por la misma
    // razón — se cargaron contra una cuenta que ya no es la que era.
    //
    // El `?? cobroPedidoId.value` cubre el tramo de antes: el garzón tocó *Cerrar
    // y cobrar* y la fusión aterrizó **mientras se calculaba el total**, con el
    // modal todavía sin abrir. Sin eso, ese tap moría en silencio: ni modal, ni
    // aviso, con el único toast siendo el de la fusión. El aviso sale de acá y no
    // del guard de `abrirCobro` porque **acá se sabe** lo que pasó; allá había que
    // deducirlo, y deducirlo salió mal.
    //
    // ⛔ **Y el cierre en vuelo se mira APARTE, no en la misma cadena de `??`.**
    // La primera versión encadenaba los tres, y con el reintento automático del
    // `catch` de `cerrarCuentaConPin` —que armaba su marca **fuera** del gate del
    // botón— un cobro pedido y un cierre en vuelo podían estar vivos a la vez: el
    // pedido **enmascaraba** al cierre y el `POST` salía sobre la cuenta fusionada.
    // El reintento se sacó el 2026-09-11; son dos cobros distintos igual, y se
    // siguen preguntando por separado.
    const cobroTocado = cobroCuenta.value?.id ?? cobroPedidoId.value
    if (cobroTocado && fusedIds.has(cobroTocado)) {
      const estabaAbierto = cobroOpen.value
      // Apagar el modal ya limpia la foto (ver el `watch`); el pedido se anula
      // acá, y es lo que hace que `abrirCobro` no abra cuando vuelva su cálculo.
      cobroOpen.value = false
      cobroPedidoId.value = null
      // Las dos frases son la misma noticia contada desde el tramo en el que lo
      // agarró: en el primero perdió pagos ya tipeados, en el segundo un tap que
      // no llegó a abrir nada.
      toast.add({
        title: estabaAbierto
          ? 'El cobro se cerró: esa cuenta entró en la fusión. Volvé a cargarlo en la fusionada.'
          : 'La cuenta que ibas a cobrar entró en la fusión. Cobrala desde la fusionada.',
        color: 'warning',
      })
    }
    // **Y acá solo se anula la marca del cierre en vuelo; el aviso de ese tramo lo
    // da el guard de `cerrarCuentaConPin`.** Es el único que sabe si el `POST`
    // llegó a salir: la fusión y el cierre viajan en paralelo, así que esta
    // respuesta puede llegar con el cierre ya despachado, y ahí decirle *"el cobro
    // no salió"* a alguien cuyo cobro sí salió es exactamente el error que los
    // otros dos tramos evitan. En ellos no hay nada despachado que dudar.
    if (cobroEnVueloId.value && fusedIds.has(cobroEnVueloId.value)) {
      cobroEnVueloId.value = null
    }
    // ⛔ **De acá para abajo se pinta pantalla, y eso solo se hace si el garzón
    // sigue donde pidió la fusión.** Lo levantó la revisión: congelar la
    // selección no alcanzaba porque estas cuatro sentencias **escriben** estado
    // vivo. Con la mesa cambiada, la cuenta fusionada se inyectaba en el
    // listado de la OTRA mesa.
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
    // **Se lo lleva a la fusionada en DOS casos, y el segundo lo encontró la
    // revisión:** si seguía en el listado esperándola, y si quedó parado en una
    // de las cuentas que **esta misma fusión canceló** —ahí
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
    toastErrorOperativo(e, 'No se pudo tomar la cuenta')
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

/**
 * Map del catálogo por id, para resolver la unidad de una anulación sin un
 * `find` por fila — mismo criterio que el `porItemId` de `itemsParaTicket`.
 * `computed` para no reconstruirlo en cada fila del aviso (`v-for`).
 */
const itemsPorId = computed(() => new Map(items.value.map(it => [it.id, it])))

/**
 * La cantidad de una anulación, ya formateada con la unidad de su ítem — usa
 * `formatCantidadAnulacion` (`useSalones.ts`), la misma función para el aviso
 * bajo la cuenta y para la precuenta (`anuladasParaTicket`).
 */
function cantidadAnuladaTexto(anulacion: CuentaAnulacionDetalle): string {
  return formatCantidadAnulacion(anulacion, itemsPorId.value, unidadesStore.esFraccionaria)
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
    // La MISMA puerta que agregar un producto o una receta, no un toast
    // propio: subir la cantidad de una línea ya en la cuenta rebota por el
    // mismo chokepoint de stock y el backend manda el mismo 400 enriquecido
    // (`ItemsService.errorStockInsuficiente`). Acá el mensaje llegaba
    // completo pero sin el botón "Trasladar", así que el encargado veía
    // dónde estaba la mercadería y tenía que ir a buscar la pantalla a mano.
    // El `description` sigue siendo de esta puerta: el rechazo puede llegar
    // con el garzón ya en el listado o en otra mesa —salir manda lo
    // pendiente—, y ahí *"no alcanza el stock"* solo no le dice a quién
    // culpar. Con la cuenta todavía en pantalla se omite, porque ahí sobra.
    mostrarRechazoPorStock({
      error: e,
      fallback: 'Error al actualizar la cantidad',
      puedeTrasladar: puedeTrasladar.value,
      description: activeCuenta.value?.id === cuentaId ? undefined : contexto,
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
  if (cuentaActivaEnCobro.value) return

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

/**
 * Manda las ediciones de cantidad que quedaron a medio camino y espera las que están en vuelo.
 *
 * **`vaciarLoQueNazca` separa dos contratos, y la diferencia es a propósito** (2026-09-12; el
 * predicado, 2026-09-13):
 *
 * - **Sin él** —salir, cambiar de mesa, cancelar, fusionar, cobrar—: se manda lo que estaba
 *   pendiente **al empezar**. Una edición que nace durante la espera no entra, y en cancelar y
 *   fusionar eso es la regla, no un hueco: la descarta `descartarPendientes` después del
 *   request, porque se tipeó contra una cuenta que deja de ser la que era.
 * - **Con él**, además se vacía lo que nazca durante la espera y el predicado acepte, hasta que
 *   no quede nada de eso pendiente ni nada en vuelo. Lo pasan dos:
 *   - `enviarComanda`, **solo para su cuenta**. Si no, la comanda se reclamaba sin el tap que el
 *     garzón hizo mientras se mandaba lo anterior: el de una línea que no estaba pendiente, el de
 *     una que el loop ya había mandado, o el que cae mientras se espera lo que está en vuelo.
 *     Medido con los tests *"… sale antes que la comanda"*, en rojo sin esto.
 *   - el guard de salida de la pantalla, **para todas, salvo con una fusión o un cancelar en
 *     vuelo**: ver su docblock.
 *
 *   Esos taps se pueden hacer porque el stepper solo se deshabilita en la cuenta que se está
 *   cobrando —`yaEnviadaACocina` apaga el basurero, no el stepper—.
 *
 * El cobro **no** vacía: desde el 2026-09-13 la cuenta que se cobra no acepta ediciones entre el
 * *Confirmar* y el cierre (`cuentaActivaEnCobro`, decisión del owner), así que en ella no nace
 * nada durante su espera.
 */
async function flushPendientes(vaciarLoQueNazca?: (edicion: EdicionCantidad) => boolean) {
  // `lineasPendientes` y no `pendientes`: ese nombre ya es el ref de las cuentas
  // que quedaron sin responsable, y sombrearlo acá deja dos cosas sin relación
  // llamadas igual en el mismo archivo.
  const lineasPendientes = [...pendingByLinea.entries()]
  // **Los timers se cancelan todos acá, antes del primer `await`.** Nació el 2026-09-02
  // para que la segunda línea no saliera con DOS `PATCH` —su timer disparaba durante la
  // espera de red de la primera—, y ese doble ya no puede pasar: desde que el loop manda
  // lo vivo, una entrada que disparó sola ya no está y no se vuelve a mandar. Lo que hace
  // HOY es que las líneas salgan **de a una**, que es lo que supone el docblock de
  // `pendingByLinea`, y que `salirDeCuenta` pueda llamar sin `await` sin dejar timers
  // armados. Medido el 2026-09-12: sin esta línea, con la primera retenida, la segunda
  // sale en paralelo y cada una una sola vez — y ningún test lo distingue.
  for (const [, { timer }] of lineasPendientes) clearTimeout(timer)
  // Foto de las cuentas al empezar, como RESPALDO del guard de abajo:
  // `onSelectMesa` manda lo pendiente y acto seguido `cargarCuentas` reemplaza
  // `cuentas.value` por la lista de otra mesa, y ahí leer solo lo vivo daría
  // "la línea ya no está" para todas menos la primera y se comería ediciones.
  const cuentasAlEmpezar = cuentas.value

  async function mandarLoVivo(lineaId: string) {
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
    if (!viva) return
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
    // la revisión del diff, contra control. Sacarla antes del `return` de abajo
    // es además lo que hace que el vaciado de `vaciarLoQueNazca` avance.
    pendingByLinea.delete(lineaId)
    // Quitar una línea no cancela su timer, así que puede haber salido de la
    // cuenta dentro de la ventana del debounce: mandarle el `PATCH` sería un 404
    // y un toast por algo que el garzón ya deshizo. Se mira **lo vivo primero**
    // —`aplicarCuentaActualizada` reemplaza el array, así que la foto envejece
    // en la primera vuelta— y la foto solo cuando la lista ya no es de esta
    // mesa.
    const cuenta = cuentas.value.find(c => c.id === edicion.cuentaId)
      ?? cuentasAlEmpezar.find(c => c.id === edicion.cuentaId)
    if (!cuenta?.lineas.some(l => l.id === lineaId)) return
    // `payload` sale del Map y NO se relee de la cuenta: la respuesta de la
    // iteración anterior ya pisó el optimista de esta línea. Ver el docblock
    // de `pendingByLinea`.
    await patchLineaCantidad(lineaId, edicion)
  }

  for (const [lineaId] of lineasPendientes) await mandarLoVivo(lineaId)
  // Sin `vaciarLoQueNazca` esto es la espera de siempre. Con él, cada vuelta vuelve a mirar si
  // nació otra edición que el predicado acepte —también mientras se espera lo que está en
  // vuelo—, y la manda antes de dar el flush por terminado.
  for (;;) {
    const nacida = vaciarLoQueNazca
      ? [...pendingByLinea.entries()].find(([, e]) => vaciarLoQueNazca(e))
      : undefined
    if (nacida) {
      await mandarLoVivo(nacida[0])
      continue
    }
    if (inflight.value.size === 0) return
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
 * diff lo levantó después de cerrar la misma forma en las otras dos sentencias
 * de esta función.
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
  if (cuentaActivaEnCobro.value) {
    avisarCuentaEnCobro()
    return
  }
  if (item.tipo === 'receta' || (item.tipo === 'combo' && item.disponibleCondicional)) {
    recetaItemId.value = item.id
    recetaDrawerOpen.value = true
    return
  }
  try {
    const cuenta = await registrarEnVuelo(
      activeCuenta.value.id,
      'agregar',
      salonesApi.agregarLinea(activeCuenta.value.id, item.id, '1'),
    )
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    mostrarRechazoPorStock({ error: e, fallback: 'Error al agregar el producto', puedeTrasladar: puedeTrasladar.value })
  }
}

async function onRecetaConfirm(payload: PersonalizacionPayload, _resumen: string) {
  if (!activeCuenta.value || !recetaItemId.value) return
  try {
    // El panel pudo quedar abierto debajo del cobro: se abre durante la espera de `abrirCobro`,
    // con la pantalla tocable. El `finally` lo cierra igual.
    if (cuentaActivaEnCobro.value) {
      avisarCuentaEnCobro()
      return
    }
    const personalizacion = personalizacionVacia(payload) ? undefined : payload
    const cuenta = await registrarEnVuelo(
      activeCuenta.value.id,
      'agregar',
      salonesApi.agregarLinea(activeCuenta.value.id, recetaItemId.value, '1', personalizacion),
    )
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    mostrarRechazoPorStock({ error: e, fallback: 'Error al agregar la receta', puedeTrasladar: puedeTrasladar.value })
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

/**
 * "Algo despachado" (spec § 6): alguna línea viva de la cuenta con
 * `cantidad_enviada > 0`. Decide qué ruta de cancelar usar — la simple o la
 * que exige motivo y permiso `Anular`.
 */
function tieneAlgoDespachado(cuenta: CuentaDetalle): boolean {
  return cuenta.lineas.some(yaEnviadaACocina)
}

async function quitarLinea(linea: CuentaLineaDetalle) {
  if (!activeCuenta.value || cuentaActivaEnCobro.value) return
  try {
    const cuenta = await registrarEnVuelo(
      activeCuenta.value.id,
      'quitar',
      salonesApi.quitarLinea(activeCuenta.value.id, linea.id),
    )
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al quitar el producto'), color: 'error' })
  }
}

/**
 * Abre el modal de anulación para ESTA línea, de la cuenta activa. Se
 * congelan cuenta y línea (mismo motivo que `transferAdminCuenta`, spec del
 * modal de transferencia): el garzón puede irse a otra cuenta mientras el
 * modal sigue abierto, y `confirmarAnular` tiene que anular la línea para la
 * que se abrió, no la que haya quedado activa.
 */
function abrirAnularLinea(linea: CuentaLineaDetalle) {
  if (!activeCuenta.value || cuentaActivaEnCobro.value) return
  anularModalCuenta.value = activeCuenta.value
  anularModalLinea.value = linea
  anularModalOpen.value = true
}

async function confirmarAnular(payload: { cantidad: string, motivoBajaId: string }) {
  const cuenta = anularModalCuenta.value
  const linea = anularModalLinea.value
  if (!cuenta || !linea || anulando.value) return
  anulando.value = true
  try {
    const { advertencias, ...actualizada } = await salonesApi.anularLinea(cuenta.id, linea.id, payload)
    syncCuenta(actualizada)
    anularModalOpen.value = false
    toast.add({ title: 'Plato anulado', color: 'success' })
    // Avisos de stock informativos (spec Task 3): la anulación ya ocurrió, no
    // bloquean nada — se muestran igual que cualquier otro aviso de stock.
    for (const advertencia of advertencias) {
      toast.add({ title: advertencia, color: 'warning' })
    }
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al anular el plato'), color: 'error' })
  }
  finally {
    anulando.value = false
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
    await flushPendientes(e => e.cuentaId === cuenta.id)
    const estaciones = await impresorasApi.imprimirComanda(cuenta.id, {
      mesaNombre,
      cuentaNumero: cuenta.numero,
      garzonNombre: cuenta.garzonResponsableNombre,
    }, (reclamadas) => {
      // El claim ya avanzó `cantidad_enviada`: se refleja en la pantalla en el
      // acto, o la línea sigue sin *Anular* y con el basurero vivo hasta salir
      // de la mesa y volver (medido el 2026-09-17). Va antes de imprimir porque
      // un QZ caído no deshace el despacho.
      //
      // Se parte de la versión VIVA en `cuentas.value`, no de `cuenta`: durante
      // la espera de `flushPendientes` el catálogo sigue tocable, y el producto
      // que el garzón agrega ahí no está en la foto —partir de ella lo borraba
      // de la pantalla—. Y se toca solo `cantidadEnviada` de las líneas que
      // el claim nombra —las de una categoría sin impresora no avanzan—, que no
      // entra al cálculo, así que no hace falta `recalcular()`.
      const enviadas = new Map(reclamadas.flatMap(e =>
        e.items.map(i => [i.cuentaLineaId, i.cantidadEnviada] as const)))
      const viva = cuentas.value.find(c => c.id === cuenta.id)
      if (!viva || enviadas.size === 0) return
      aplicarCuentaActualizada({
        ...viva,
        lineas: viva.lineas.map((l) => {
          const cantidadEnviada = enviadas.get(l.id)
          return cantidadEnviada === undefined ? l : { ...l, cantidadEnviada }
        }),
      })
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

/**
 * El mapeo mínimo de `BoletaVenta` —la venta YA PERSISTIDA que devuelve el
 * cierre (`salonesApi.cerrarCuenta`)— al `BoletaItem` que consume
 * `buildBoletaTicket`. Vive acá y no en `ticket-builder.ts` para no tocarle la
 * firma, que comparte la precuenta.
 *
 * A diferencia de `itemsParaTicket`, acá NO hay cruce por índice contra
 * `items.value` (el catálogo cargado): la unidad de cada línea ya viene
 * resuelta en la propia `BoletaVenta.items[]` (`unidadCodigoBase` /
 * `unidadCodigoPresentacion`), porque es la que el servidor cobró — cruzar de
 * nuevo contra el catálogo de HOY es exactamente el error de origen que
 * `armarBoleta` vino a evitar.
 */
function itemsParaBoletaCierre(boleta: BoletaVenta) {
  return boleta.items.map((item) => {
    const cantidadTicket = formatCantidadLinea(
      item.cantidad,
      item.cantidadPresentacion,
      item.unidadCodigoPresentacion,
      unidadesStore.esFraccionaria(item.unidadCodigoPresentacion ?? item.unidadCodigoBase),
      item.unidadCodigoBase,
    )
    return {
      nombre: item.descripcion,
      cantidad: cantidadTicket,
      precioUnitario: item.precioUnitario,
      totalLinea: item.totalLinea,
      ...(item.personalizacionDetalle?.length
        ? { personalizacionDetalle: item.personalizacionDetalle, comentario: item.comentario }
        : item.comentario ? { nota: item.comentario } : {}),
    }
  })
}

/**
 * Los platos anulados que imprime la PRECUENTA (spec § 5): `merma` y
 * `cortesia`, en $0 con la etiqueta de su tipo. `no_elaborado` queda afuera
 * —nunca salió de cocina—, y esto no lo consume `imprimirBoleta`: la boleta no
 * imprime nada de lo anulado.
 */
function anuladasParaTicket(cuenta: CuentaDetalle): TicketAnulada[] {
  return (cuenta.anulaciones ?? [])
    .filter(a => a.motivoTipo === 'merma' || a.motivoTipo === 'cortesia')
    .map(a => ({
      nombre: a.itemNombre,
      cantidad: cantidadAnuladaTexto(a),
      etiqueta: tipoMotivoBajaLabel(a.motivoTipo),
    }))
}

/**
 * La precuenta es de la familia de *"lo que se lee después del `await`"*, y la
 * menos grave: lo que sale mal es papel.
 *
 * El re-chequeo que tenía —`if (!activeCuenta.value || !selectedMesa.value)`—
 * preguntaba por **existencia**, no por identidad, así que cubría volver al
 * listado y cambiar de mesa pero no meterse en OTRA cuenta: ahí
 * `asegurarVigente()` devuelve el cálculo del carrito **vivo**, o sea el de esa
 * otra, y salía su precuenta. Y en el camino en que el cálculo de la cuenta
 * nueva no llegó a aterrizar, `res` viene `null` y el garzón leía
 * *"No se pudo calcular el total de la cuenta"* — un rojo que le echa la culpa
 * al cálculo de algo que no falló: se movió él.
 *
 * Por eso el guard es **por identidad y va antes del aviso**, con el mismo orden
 * que `abrirCobro`. Salir de la cuenta durante el cálculo no imprime y no avisa.
 *
 * ⚠️ **No es la misma defensa que allá, y conviene no leerlo así:** `abrirCobro`
 * tiene además la marca del pedido, porque el modal se queda abierto mostrando un
 * total congelado y la cuenta **destino** de una fusión conserva su id. Acá no
 * hace falta: el ticket se arma con `res` y con las líneas releídas **en el mismo
 * instante**, así que si la fusión aterriza durante el cálculo o sale el papel de
 * la cuenta ya fusionada —consistente— o `asegurarVigente()` devuelve `null` y no
 * sale nada. Lo que no puede pasar es que salgan líneas de un lado y totales del
 * otro.
 */
async function imprimirPrecuenta() {
  const cuenta = activeCuenta.value
  const mesa = selectedMesa.value
  if (!cuenta || !mesa) return
  imprimiendoPrecuenta.value = true
  try {
    // El ticket sale de `resultado`: si no corresponde a la cuenta actual imprime
    // montos de un pedido anterior, así que primero se espera el cálculo al día.
    const res = await asegurarVigente()
    if (activeCuenta.value?.id !== cuenta.id) return
    if (!res) {
      toast.add({ title: 'No se pudo calcular el total de la cuenta. Intentá de nuevo.', color: 'error' })
      return
    }
    // ⚠️ **Las líneas del ticket se releen; la mesa va congelada.** `res` es el
    // cálculo del carrito de AHORA y `itemsParaTicket` lo cruza con las líneas
    // **por índice**, así que meterle una foto vieja imprime una cantidad y
    // totaliza otra — es el mismo error que la revisión midió en
    // `cerrarCuentaConPin`—.
    //
    // La mesa va congelada y es equivalente, no defensa: sus dos escritores son
    // `onSelectMesa`, que cambia de mesa y deja `activeCuenta` en `null` en el
    // mismo bloque sincrónico (o sea que el guard de arriba corta), y
    // `patchMesaOcupacion`, que reescribe **la misma** mesa con el contador al
    // día. Congelarla solo la deja en el mismo instante que el número de cuenta.
    const cuentaDelTicket = activeCuenta.value
    await impresorasApi.imprimirPrecuenta({
      emisor: emisor.value,
      mesaNombre: mesa.nombre,
      cuentaNumero: cuentaDelTicket.numero,
      items: itemsParaTicket(cuentaDelTicket, res),
      anuladas: anuladasParaTicket(cuentaDelTicket),
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
  if (cuentaActivaEnCobro.value) {
    cancelOpen.value = false
    avisarCuentaEnCobro()
    return
  }
  // Con algo despachado, hace falta un motivo — el botón que abrió este modal
  // ya filtró el permiso (`abrirCancelar`); acá solo falta el dato.
  const requiereMotivo = tieneAlgoDespachado(activeCuenta.value)
  if (requiereMotivo && !cancelMotivoId.value) return
  cancelando.value = true
  // **Congelado ANTES de la espera, igual que en fusionar.** El `await` de abajo
  // es de red, y durante ese tramo el garzón puede volver al listado —el botón
  // *Cancelar* del modal no está deshabilitado, y el modal cierra con ESC o
  // backdrop—, lo que deja `activeCuenta` en `null`. Releyendo el id después, el
  // `try` moría con un `TypeError` y **el cancelar no salía**: el garzón
  // confirmaba anular la cuenta, veía un toast rojo con un mensaje de JavaScript
  // y la cuenta seguía abierta. Lo midió la revisión del diff.
  const cuentaId = activeCuenta.value.id
  const mesaId = selectedMesa.value.id
  const motivoBajaId = cancelMotivoId.value
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
    // Dos rutas (spec § 6): con motivo, anula cada línea despachada y cancela;
    // sin él, la simple de siempre. `motivoBajaId` no puede faltar acá —el
    // guard de arriba ya cortó antes del `await`—.
    let advertencias: string[] = []
    if (requiereMotivo && motivoBajaId) {
      const res = await salonesApi.cancelarCuentaConMotivo(cuentaId, { motivoBajaId })
      advertencias = res.advertencias
    }
    else {
      await salonesApi.cancelarCuenta(cuentaId)
    }
    // Sigue haciendo falta después del flush: el garzón puede tocar el stepper
    // mientras viaja el request de cancelar, y esa edición nueva sí caería sobre
    // una cuenta que ya no está. Va acá y **no antes del request**: cancelar
    // falla de verdad —`400` si otro dispositivo ya la cerró, `404`, red—, y
    // descartando primero el garzón se quedaba dentro de la cuenta con la
    // cantidad pintada, sin `PATCH`, sin rollback y sin timer que lo mandara
    // después. Lo midió la revisión del diff.
    descartarPendientes(cuentaId)
    toast.add({ title: 'Cuenta cancelada', color: 'success' })
    // Avisos de stock informativos (mismo criterio que `confirmarAnular`): la
    // cancelación ya ocurrió, no bloquean nada.
    for (const advertencia of advertencias) {
      toast.add({ title: advertencia, color: 'warning' })
    }
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
  // MIDIÉNDOLO: en esa ventana el botón *Cerrar y cobrar* seguía habilitado
  // —`submitting` se prendía recién adentro de `cerrarCuentaConPin`—, y un solo
  // tap reabría el modal, cuyo `watch(open)` **reescribe** `propinaMonto`. Esa
  // puerta se cerró el 2026-09-06 (ver el `submitting.value = true` de más abajo),
  // así que hoy la foto es defensa sin camino vivo; se deja igual, y el porqué
  // está en `docs/agent/resueltos.md`. Medido: cobro confirmado con
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
  // **`submitting` se prende ACÁ**, y no adentro de `cerrarCuentaConPin`, que corre
  // después del PIN y del flush. Hasta el 2026-09-06 se prendía **solo** allá, así que en
  // todo ese tramo el botón *Cerrar y cobrar* seguía habilitado y el garzón podía
  // reabrir el modal y **confirmar el mismo cobro dos veces**: el segundo `POST`
  // rebotaba con el rechazo del backend sobre una cuenta que él ya había cobrado.
  // En tablet personal es peor, porque `solicitarPin` ejecuta la acción sin modal
  // y no hay ni un teclado que lo frene. Mismo criterio que `abriendoCuenta`.
  submitting.value = true
  // La misma foto, pero legible desde afuera: `cobro` es un argumento y
  // `fusionarSeleccionadas` necesita saber qué cuenta se está cobrando para
  // poder anularla. Va acá y no adentro de `cerrarCuentaConPin` por lo mismo
  // que `submitting`: el tramo empieza en el *Confirmar*, flush incluido.
  cobroEnVueloId.value = cuenta.id
  // El cobro recolecta los pagos; el PIN identifica al garzón que cierra.
  cobroOpen.value = false
  solicitarPin(
    'PIN del garzón para cerrar la cuenta',
    (garzonId, pin) => {
      void (async () => {
        await flushPendientes()
        await cerrarCuentaConPin(cobro, garzonId, pin)
      })()
    },
    // ⚠️ **Sin esto el drawer queda trabado para siempre.** Prender `submitting`
    // antes del teclado significa que hay un camino que no termina en
    // `cerrarCuentaConPin` —cerrar el teclado sin tipear— y ahí el `finally` que
    // lo apaga nunca corre.
    { onCancelar: () => { submitting.value = false; cobroEnVueloId.value = null } },
  )
}

/**
 * ⚠️ Todo lo que hay en `cobro` llega **por argumento**: es la foto de cuando el
 * garzón confirmó, no lo que haya en pantalla cuando esto corre. Ver
 * `confirmarCobro`, que la saca.
 *
 * Lo que se lee de un `ref` acá adentro es una decisión aparte, tomada de a una
 * y escrita donde se toma. Las que quedan vivas —`propinaPorcentaje`, `emisor`,
 * `metodos`, `tiposDocumento`— se cargan en el `Promise.all` del arranque y
 * nada de esta ventana las mueve.
 *
 * ⚠️ **La boleta que se imprime es la que devuelve el `POST` de cierre**
 * (`salonesApi.cerrarCuenta` → `armarBoleta` en el backend, sobre la venta ya
 * persistida dentro de la MISMA transacción): no se recalcula acá, y por eso
 * ya no depende de `activeCuenta` ni de `asegurarVigente()`. Hasta el
 * 2026-09-17 el ticket salía de un `asegurarVigente()` fresco, condicionado a
 * seguir parado en la cuenta que se cobra — si el garzón se metía en otra
 * durante el `await flushPendientes()`, la venta se generaba igual pero
 * **sin boleta, punto**: no había reimpresión (`docs/agent/pendientes.md` § 2).
 * Con la boleta en la respuesta del cierre, ese camino ya no existe.
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
  // ⚠️ **Ni `submitting` ni `cobroEnVueloId` se prenden acá: los prende
  // `confirmarCobro`**, que es donde empieza el tramo. Con la marca importa además el
  // orden: la fusión pudo haberla anulado durante el `await flushPendientes()` que
  // corre ANTES de esta llamada, y re-armarla acá pisaría justo eso —el guard de más
  // abajo no cortaría nunca—.
  // Todo lo que viene adentro de `cobro` es la foto; lo que se lee de un `ref`
  // acá abajo es una decisión aparte, tomada de a una.
  const { cuenta: cuentaCerrada, mesa: mesaCerrada, pagos } = cobro
  const tipMonto = cobro.propinaMonto
  const tipSugerida = cobro.propinaSugerida
  try {
    // ⛔ **Si la fusión se llevó puesta esta cuenta durante las esperas de
    // arriba (el teclado del PIN, `flushPendientes`), el `POST` no sale.**
    // Quien anula la marca en esa escena es `fusionarSeleccionadas`, y solo
    // para las cuentas que entraron a la fusión.
    //
    // **El aviso lo da este guard y no ella**, al revés que en los otros dos
    // tramos: allá no hay nada en vuelo que dudar, acá la fusión y el cierre
    // viajan en paralelo y solo desde este punto se sabe que el `POST` **no llegó
    // a salir**. Avisando desde allá, una fusión que vuelve con el cierre ya
    // despachado le diría *"el cobro no salió"* a alguien cuyo cobro salió.
    //
    // ⚠️ **La marca no la escribe solo la fusión**, y conviene tener a la vista
    // el resto antes de tocar esto: `confirmarCobro` la arma, y el `onCancelar` del
    // teclado y el `finally` de acá abajo la apagan. Hasta el 2026-09-11 también la
    // re-apuntaba el reintento automático del `catch`, y de ahí salía la única escena
    // en que este guard se equivocaba; ese reintento ya no existe (owner: después de
    // entrar a turno, el garzón vuelve a pedir el cobro).
    //
    // ⚠️ **Avisar no alcanzaba, y la mitad cara es la cuenta DESTINO**, medido:
    // la de ORIGEN queda `cancelada` y el backend rechaza con *"La cuenta no está
    // abierta"* —feo, pero el garzón lee algo—; la DESTINO conserva su id y sigue
    // abierta, así que el cierre **entra bien** y arma la venta con todas las
    // líneas que la fusión le plegó contra los pagos que el garzón tipeó mirando
    // el total de antes. Nadie valida que los pagos cubran el total —`pagada_parcial`
    // es un estado legítimo—, o sea que cobra de menos, en silencio y con toast
    // verde. Por eso se cancela antes de salir en vez de avisar después.
    //
    // ⚠️ **El costo es el mismo que el owner ya tomó el 2026-09-05 para el cobro
    // que todavía se estaba armando** (ver `fusionarSeleccionadas`): los pagos
    // cargados se pierden y hay que volver a tipearlos sobre la fusionada.
    //
    // ⚠️ **Esta marca se anula APARTE de la del cobro abierto o pedido.** En
    // `fusionarSeleccionadas` son dos `if` independientes porque hasta el 2026-09-11
    // los dos cobros podían estar vivos a la vez: mientras un cierre viaja el botón
    // está bloqueado (`:loading="abriendoCobro || submitting"`), pero el reintento
    // automático del `catch` armaba esta marca sin pasar por ese gate, y en una sola
    // cadena de `??` el cobro pedido **enmascaraba** al cierre —no se anulaba nada y
    // el `POST` salía sobre la cuenta fusionada—. El reintento se sacó; la separación
    // se deja porque no cuesta nada y sigue siendo correcta si aparece otro camino que
    // los junte.
    if (cobroEnVueloId.value !== cuentaCerrada.id) {
      toast.add({
        title: 'El cobro no salió: esa cuenta entró en la fusión. Cobrala de nuevo desde la fusionada.',
        color: 'warning',
      })
      return
    }
    const { boleta } = await salonesApi.cerrarCuenta(cuentaCerrada.id, {
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

    try {
      await impresorasApi.imprimirBoleta({
        emisor: emisor.value,
        facturacionElectronica: false,
        meta: {
          cajero: boleta.cajero ?? undefined,
          mesa: boleta.mesa ?? undefined,
        },
        items: itemsParaBoletaCierre(boleta),
        totales: boleta.totales,
        impuestos: boleta.impuestos,
        promociones: boleta.promociones,
        ...(boleta.propina ? { propina: boleta.propina } : {}),
        pagos: boleta.pagos,
        vuelto: boleta.vuelto ?? undefined,
        formatMonto: (v: string) => formatMonto(v),
      })
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Venta generada, pero falló la impresión de la boleta'), color: 'warning' })
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
    // El total cobrado sale de la boleta —lo que el servidor efectivamente
    // registró—, no de un recálculo local: `totalFinal + propina` es lo que
    // queda en el cajón, y el `min` contra el bruto recorta lo que el garzón
    // tipeó de más (y con él, el vuelto: `bruto` es la suma de lo TIPEADO, con
    // el vuelto adentro). Mismo idioma que los otros dos llamadores de
    // `aplicarCobroLocal` (`ventas/pos.vue` y `VentaDetalleDrawer.vue`).
    const targetCobro = new Decimal(boleta.totales.totalFinal).plus(tipMonto)
    const neto = Decimal.min(bruto, targetCobro).toFixed(4)
    cajaStore.aplicarCobroLocal(neto, pagosConMonto.length)
    // Lo que se PINTA se condiciona, igual que en cancelar: sacarlo de donde
    // esté sería una expulsión si mientras tanto abrió otra cuenta.
    if (activeCuenta.value?.id === cuentaCerrada.id) volverACuentas()
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'Error al cerrar la cuenta')
  }
  finally {
    submitting.value = false
    cobroEnVueloId.value = null
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
                      :disabled="cuentaActivaEnCobro"
                      @change="onCantidadChange(linea, $event)"
                    />
                    <UButton
                      v-if="yaEnviadaACocina(linea) && puedeAnularLinea"
                      icon="i-lucide-ban"
                      color="warning"
                      variant="ghost"
                      size="xs"
                      title="Anular (cortesía, merma o no se llegó a hacer)"
                      :disabled="cuentaActivaEnCobro"
                      @click="abrirAnularLinea(linea)"
                    />
                    <UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="ghost"
                      size="xs"
                      :disabled="yaEnviadaACocina(linea) || cuentaActivaEnCobro"
                      :title="yaEnviadaACocina(linea)
                        ? 'Ya se despachó a cocina: registralo como merma o cortesía para que quede el rastro'
                        : 'Quitar'"
                      @click="quitarLinea(linea)"
                    />
                  </div>
                </div>
                <!--
                  El aviso de lo anulado (spec § 5): una fila no tocable por
                  anulación, para que el garzón del turno siguiente sepa que
                  hubo un plato dado de baja. Debajo de la lista de líneas, no
                  mezclado con ellas — no es una línea de la cuenta.
                -->
                <div
                  v-if="activeCuenta.anulaciones?.length"
                  class="mt-2 space-y-1 border-t border-default pt-2"
                >
                  <p
                    v-for="anulacion in activeCuenta.anulaciones ?? []"
                    :key="anulacion.id"
                    class="text-xs text-muted"
                  >
                    {{ cantidadAnuladaTexto(anulacion) }} {{ anulacion.itemNombre }} anulado — {{ tipoMotivoBajaLabel(anulacion.motivoTipo) }}, autorizó {{ anulacion.autorizadoPorNombre }}
                  </p>
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
                    :disabled="cuentaActivaEnCobro"
                    @click="abrirCancelar"
                  >
                    Cancelar cuenta
                  </UButton>
                  <UButton
                    color="primary"
                    class="flex-1 justify-center"
                    :loading="abriendoCobro || submitting"
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
        v-if="!cancelTieneDespachado"
        v-model:open="cancelOpen"
        title="Cancelar cuenta"
        message="Se anulará la cuenta sin generar venta. Esta acción no se puede deshacer."
        confirm-label="Cancelar cuenta"
        :loading="cancelando"
        @confirm="confirmarCancelar"
      />
      <!--
        Modal APARTE del `CrudModal` de arriba (ver el comentario de
        `cancelTieneDespachado` en el script): cancelar con algo despachado
        pide motivo y `Salones:Anular` (spec § 6).
      -->
      <UModal
        v-else
        v-model:open="cancelOpen"
        title="Cancelar cuenta con platos despachados"
        description="Hay platos ya despachados a cocina. Elegí el motivo: se van a anular y la cuenta se cancela sin generar venta."
        :ui="shellUi.modal"
      >
        <template #body>
          <UFormField label="Motivo" required>
            <USelectMenu
              v-model="cancelMotivoId"
              :items="motivosCancelarItems"
              value-key="value"
              :loading="cargandoMotivosCancelar"
              :disabled="cancelando"
              placeholder="Elegir motivo…"
              class="w-full"
            />
          </UFormField>
        </template>
        <template #footer>
          <AppModalFooter>
            <UButton color="neutral" variant="ghost" :disabled="cancelando" @click="() => { cancelOpen = false }">
              Cancelar
            </UButton>
            <UButton
              color="error"
              :disabled="!cancelMotivoId"
              :loading="cancelando"
              @click="confirmarCancelar"
            >
              Cancelar cuenta
            </UButton>
          </AppModalFooter>
        </template>
      </UModal>

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

      <SalonesAnularLineaModal
        v-model:open="anularModalOpen"
        :linea="anularModalLinea"
        :unidad-base="anularModalUnidadBase"
        :submitting="anulando"
        @confirm="confirmarAnular"
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
