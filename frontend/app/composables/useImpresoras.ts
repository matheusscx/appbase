import { useApiFetch } from './useApiFetch'
import {
  buildComandaTicket,
  buildPrecuentaTicket,
  buildBoletaTicket,
  type TicketTotales,
  type TicketPago,
  type BoletaEmisor,
  type BoletaMetaOperativa,
  type BoletaCliente,
  type BoletaItem,
  type ImpuestoBoleta,
  type PromoBoleta,
  type TicketAnulada,
} from '~/utils/ticket-builder'
import { conTimeout } from '~/utils/con-timeout'

/** Techo de espera de QZ Tray al imprimir (impresora apagada / host inalcanzable). */
const PRINT_TIMEOUT_MS = 5_000
const PRINT_TIMEOUT_MSG = 'La impresora no respondió (timeout 5 s)'
/** Mismo techo para `qz.websocket.connect()` — docs/agent/pendientes.md § 3,
 * "Conectar con QZ Tray tiene el mismo techo que imprimir" (owner, 2026-09-29). */
const CONNECT_TIMEOUT_MSG = 'No se pudo conectar con QZ Tray (timeout 5 s)'
/** Mensaje propio para cualquier rechazo de QZ Tray que no sea uno de los dos
 * timeouts de arriba (p. ej. certificado inválido, versión incompatible): esos
 * vienen en inglés desde `qz-tray` y no deben llegarle así a la persona
 * (`apiErrorMsg` concatena el `message` del `Error` tal cual, ver `api-error.ts`). */
const PRINT_ERROR_MSG = 'No se pudo imprimir. Revisá la impresora o QZ Tray.'
/** Cadenas exactas que `qz.websocket.connect()` rechaza (`node_modules/qz-tray/qz-tray.js`)
 * cuando la conexión anterior todavía no terminó — CONNECTING, si ni llegamos a
 * disparar `disconnect()`, o CLOSING, si ya lo disparamos y sigue sin cerrar (el
 * caso medido acá: el diálogo de autorización abierto). Las dos significan lo
 * mismo para la persona: QZ Tray está esperando que conteste su propio diálogo,
 * no que la impresora falló. */
const QZ_CONEXION_PENDIENTE_MSGS = [
  'The current connection attempt has not returned yet',
  'Waiting for previous disconnect request to complete',
]
const ESPERANDO_AUTORIZACION_MSG = 'QZ Tray está esperando que autorices la conexión en su ventana'
const ESC_POS_CP850 = '\x1B\x74\x02'
const ESC_POS_CORTE = '\x1B\x64\x04\x1D\x56\x00'

export function buildQzConfigOptions() {
  return { encoding: 'Cp850' }
}

export function buildEscposPrintData(lineas: string[]): string[] {
  return [
    ESC_POS_CP850,
    `${lineas.join('\n')}\n`,
    ESC_POS_CORTE,
  ]
}

// ── Tipos (espejo del contrato del backend impresoras) ──────────────────────

export type RolImpresora = 'comanda' | 'boleta'
export type TipoConexionImpresora = 'red' | 'sistema'

export interface Impresora {
  id: string
  nombre: string
  rol: RolImpresora
  tipoConexion: TipoConexionImpresora
  host: string | null
  puerto: number | null
  nombreCola: string | null
  activo: boolean
  // Solo llegan con `listar(rol, true)`; los caminos de impresión
  // (`imprimirComanda`, `obtenerImpresoraBoleta`) nunca los piden.
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

/**
 * Lo que devuelve `GET /impresoras/operacion` (`ImpresorasService.listarOperativas`
 * en el backend) — solo los 6 campos que el navegador necesita para hablarle a QZ
 * Tray, ya filtrado a `activo` y sin auditoría ni `tenantId`. La usan los tres
 * caminos que IMPRIMEN (`imprimirComanda`, `obtenerImpresoraBoleta`); la pantalla
 * de configuración sigue con `Impresora` vía `listar()`.
 */
export interface ImpresoraOperativa {
  id: string
  tipoConexion: TipoConexionImpresora
  host: string | null
  puerto: number | null
  nombreCola: string | null
  activo: boolean
}

export interface ImpresoraFormBody {
  nombre: string
  rol: RolImpresora
  tipoConexion: TipoConexionImpresora
  host?: string
  puerto?: number
  nombreCola?: string
  activo?: boolean
}

export interface ComandaEstacionItem {
  cuentaLineaId: string
  nombre: string
  cantidad: string // diff a imprimir
  cantidadEnviada: string // total absoluto que el claim ya dejó persistido
  /** Personalización + comentario (desde reclamarComanda). */
  nota?: string
}

export interface ComandaEstacion {
  impresoraId: string
  nombre: string
  items: ComandaEstacionItem[]
}

interface ComandaPreviewResponse {
  estaciones: ComandaEstacion[]
}

// qz-tray es solo-navegador (usa WebSocket/window). Cargarlo de forma perezosa
// evita que se evalúe durante el SSR (habilitado por defecto) y rompa el render.
let qzPromise: Promise<(typeof import('qz-tray'))['default']> | null = null
function getQz() {
  if (!qzPromise) qzPromise = import('qz-tray').then(m => m.default)
  return qzPromise
}

// Configura el firmado de QZ Tray una sola vez: pide el certificado al backend y,
// si está configurado, setea los promises de seguridad (cert cacheado, firma por
// llamada vía POST /impresoras/qz/firmar). Si el cert es null (firmado no
// configurado), no setea nada → QZ opera en modo no-firmado (diálogo por impresión).
let seguridadLista = false
async function asegurarSeguridadQz(
  qz: (typeof import('qz-tray'))['default'],
  apiUrl: string,
): Promise<void> {
  if (seguridadLista) return
  const { certificado } = await useApiFetch<{ certificado: string | null }>(
    `${apiUrl}/impresoras/qz/certificado`,
  )
  if (!certificado) {
    seguridadLista = true
    return
  }
  qz.security.setCertificatePromise((resolve: (c: string) => void) => resolve(certificado))
  qz.security.setSignatureAlgorithm('SHA512')
  qz.security.setSignaturePromise((dataToSign: string) =>
    (resolve: (s: string) => void, reject: (e: unknown) => void) => {
      useApiFetch<{ firma: string }>(`${apiUrl}/impresoras/qz/firmar`, {
        method: 'POST',
        body: { data: dataToSign },
      })
        .then(({ firma }) => resolve(firma))
        .catch(reject)
    })
  seguridadLista = true
}

async function imprimirEn(
  impresora: ImpresoraOperativa,
  lineas: string[],
  apiUrl: string,
): Promise<void> {
  const qz = await getQz()
  await asegurarSeguridadQz(qz, apiUrl)
  const destino = impresora.tipoConexion === 'red'
    ? `${impresora.host}:${impresora.puerto}`
    : impresora.nombreCola
  if (!qz.websocket.isActive()) {
    try {
      await conTimeout(qz.websocket.connect(), PRINT_TIMEOUT_MS, CONNECT_TIMEOUT_MSG)
    }
    catch (err) {
      const vencioElTecho = err instanceof Error && err.message === CONNECT_TIMEOUT_MSG
      if (vencioElTecho) {
        // `conTimeout` solo rechaza, no cancela: el intento de `connect()`
        // sigue vivo dentro de `qz` (singleton de la pestaña, `getQz()`), en
        // CONNECTING o ya OPEN esperando el diálogo de autorización (con el
        // QZ real sin certificado se midió OPEN: "Established connection"
        // antes del diálogo). Disparar
        // `disconnect()` pone `isActive()` en `false` al toque (qz-tray
        // settea `shutdown = true` antes de cerrar el socket), así el
        // próximo intento entra a `connect()` en vez de saltarse directo a
        // `qz.print`. Pero con el diálogo abierto el `close()` del socket
        // nunca termina (medido contra el QZ Tray real, docs/agent/resueltos.md): el siguiente
        // `connect()` encuentra la conexión vieja en CLOSING y rechaza al
        // instante con "Waiting for previous disconnect request to
        // complete" — o, si ni llegamos a disparar este `disconnect()`, la
        // encuentra en CONNECTING y rechaza con "The current connection
        // attempt has not returned yet". No se espera a que `disconnect()`
        // termine de cerrar —nunca termina— ni se reintenta (sin reintento
        // automático, regla del owner): alcanza con reconocer el mensaje de
        // abajo y avisarle a la persona.
        void qz.websocket.disconnect().catch(() => {})
      }
      console.error(`[qz] connect falló → ${destino}`, err)
      const esperandoAutorizacion = err instanceof Error
        && QZ_CONEXION_PENDIENTE_MSGS.includes(err.message)
      if (vencioElTecho) throw err
      if (esperandoAutorizacion) throw new Error(ESPERANDO_AUTORIZACION_MSG)
      throw new Error(PRINT_ERROR_MSG)
    }
  }
  // "Red": QZ abre un socket raw a host:puerto (ESC/POS TCP 9100) y escribe los
  // bytes directamente, sin pasar por una cola del SO. Las líneas lógicas se unen
  // con '\n' (0x0A = avance de línea) para que el printer no las imprima pegadas.
  const configOptions = buildQzConfigOptions()
  const config = impresora.tipoConexion === 'sistema'
    ? qz.configs.create(impresora.nombreCola as string, configOptions)
    : qz.configs.create(
        { host: impresora.host as string, port: Number(impresora.puerto) },
        configOptions,
      )
  try {
    // ESC/POS al final del ticket: avanza 4 líneas (ESC d 4) y corta total
    // (GS V 0). Las impresoras sin cutter ignoran el comando sin efecto.
    await conTimeout(
      qz.print(config, buildEscposPrintData(lineas)),
      PRINT_TIMEOUT_MS,
      PRINT_TIMEOUT_MSG,
    )
  }
  catch (err) {
    // Log del motivo real del rechazo de QZ Tray (el toast, río abajo, muestra
    // PRINT_TIMEOUT_MSG o PRINT_ERROR_MSG); útil para diagnosticar la impresora.
    console.error(`[qz] print falló → ${destino}`, err)
    const esTimeout = err instanceof Error && err.message === PRINT_TIMEOUT_MSG
    throw esTimeout ? err : new Error(PRINT_ERROR_MSG)
  }
}

export function useImpresoras() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  /**
   * Listado de configuración — exige `Impresoras:Leer` en el backend. Los
   * caminos que IMPRIMEN (`imprimirComanda`, `obtenerImpresoraBoleta`) ya NO
   * pasan por acá: usan `listarOperativas()` → `GET /impresoras/operacion`,
   * que solo alcanza con el permiso de cada camino y nunca trae borradas
   * (el backend filtra `eliminado_el IS NULL` sin excepción). `incluirEliminados`
   * lo prende solo la papelera (`configuracion/impresoras.vue`).
   */
  const listar = (rol?: RolImpresora, incluirEliminados = false) => {
    const params = new URLSearchParams()
    if (rol) params.set('rol', rol)
    if (incluirEliminados) params.set('incluirEliminados', 'true')
    const qs = params.toString()
    return useApiFetch<Impresora[]>(`${apiUrl}/impresoras${qs ? `?${qs}` : ''}`)
  }

  /**
   * `GET /impresoras/operacion` — para quien IMPRIME (`imprimirComanda`,
   * `obtenerImpresoraBoleta`), no para quien administra la configuración.
   * A diferencia de `listar()`, la alcanza con `Ventas:Crear`/`Salones:Operar`/
   * `Ventas:Anular` (sin `Impresoras:Leer`, que hoy ningún rol operativo
   * sembrado tiene — docs/agent/pendientes.md § 3, "Enviar a cocina exige
   * Impresoras:Leer"). El backend ya filtra `activo: true` y `eliminado_el IS
   * NULL`: acá no hace falta repetir ninguno de los dos filtros.
   */
  const listarOperativas = (rol: RolImpresora) =>
    useApiFetch<ImpresoraOperativa[]>(`${apiUrl}/impresoras/operacion?rol=${rol}`)

  const crear = (body: ImpresoraFormBody) =>
    useApiFetch<Impresora>(`${apiUrl}/impresoras`, { method: 'POST', body })

  const actualizar = (id: string, body: Partial<ImpresoraFormBody>) =>
    useApiFetch<Impresora>(`${apiUrl}/impresoras/${id}`, { method: 'PATCH', body })

  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/impresoras/${id}`, { method: 'DELETE' })

  /**
   * Claim atómico + impresión: (1) `POST .../comanda/reclamar` bajo FOR UPDATE
   * avanza cantidad_enviada y devuelve lo pendiente; (2) imprime cada estación.
   * Dos clients concurrentes no duplican cocina (el segundo recibe vacío).
   * Si QZ Tray falla tras el claim, la estación ya quedó marcada como enviada
   * (prioriza no imprimir doble en cocina frente a reintento automático).
   *
   * Si no hay impresoras de comanda **activas**, salta el flujo (sin reclamar ni
   * QZ) y devuelve `null` para que la UI no muestre "sin productos pendientes".
   *
   * `alReclamar` recibe lo reclamado **antes** de imprimir: si QZ falla, la
   * función tira y el llamador nunca ve el retorno, pero `cantidad_enviada` ya
   * avanzó en el servidor y la pantalla tiene que enterarse igual.
   */
  async function imprimirComanda(
    cuentaId: string,
    contexto: { mesaNombre: string, cuentaNumero: number, garzonNombre: string | null },
    alReclamar?: (estaciones: ComandaEstacion[]) => void,
  ): Promise<ComandaEstacion[] | null> {
    const impresoras = await listarOperativas('comanda')
    if (impresoras.length === 0) return null

    const { estaciones } = await useApiFetch<ComandaPreviewResponse>(
      `${apiUrl}/cuentas/${cuentaId}/comanda/reclamar`,
      { method: 'POST' },
    )
    alReclamar?.(estaciones)
    if (estaciones.length === 0) return estaciones

    for (const estacion of estaciones) {
      const impresora = impresoras.find(i => i.id === estacion.impresoraId)
      if (!impresora) continue
      const lineas = buildComandaTicket({
        estacionNombre: estacion.nombre,
        mesaNombre: contexto.mesaNombre,
        cuentaNumero: contexto.cuentaNumero,
        garzonNombre: contexto.garzonNombre,
        items: estacion.items,
        fecha: new Date(),
      })
      await imprimirEn(impresora, lineas, apiUrl)
    }
    return estaciones
  }

  /** Primera impresora de boletas activa, o `null` si no hay ninguna (saltear print). */
  async function obtenerImpresoraBoleta(): Promise<ImpresoraOperativa | null> {
    const impresoras = await listarOperativas('boleta')
    return impresoras[0] ?? null
  }

  async function imprimirPrecuenta(input: {
    emisor: BoletaEmisor
    mesaNombre: string
    cuentaNumero: number
    items: BoletaItem[]
    anuladas?: TicketAnulada[]
    totales: TicketTotales
    impuestos: ImpuestoBoleta[]
    promociones?: PromoBoleta[]
    propinaSugerida?: { porcentaje: string, monto: string }
    formatMonto: (v: string) => string
  }): Promise<void> {
    const impresora = await obtenerImpresoraBoleta()
    if (!impresora) return
    const lineas = buildPrecuentaTicket({ ...input, fecha: new Date() })
    await imprimirEn(impresora, lineas, apiUrl)
  }

  async function imprimirBoleta(input: {
    emisor: BoletaEmisor
    facturacionElectronica: boolean
    folio?: string | null
    meta: BoletaMetaOperativa
    cliente?: BoletaCliente
    items: BoletaItem[]
    totales: TicketTotales
    impuestos: ImpuestoBoleta[]
    promociones?: PromoBoleta[]
    propina?: { monto: string }
    pagos: TicketPago[]
    vuelto?: string
    /** Reimpresión — ver `buildBoletaTicket`. Se pasa derecho, sin tocarlo. */
    copia?: { impresaEl: Date, anulada?: boolean }
    formatMonto: (v: string) => string
  }): Promise<void> {
    const impresora = await obtenerImpresoraBoleta()
    if (!impresora) return
    const lineas = buildBoletaTicket({ ...input, fecha: new Date() })
    await imprimirEn(impresora, lineas, apiUrl)
  }

  return {
    listar,
    crear,
    actualizar,
    eliminar,
    imprimirComanda,
    imprimirPrecuenta,
    imprimirBoleta,
  }
}
