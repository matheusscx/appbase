import { useApiFetch } from './useApiFetch'
import {
  buildComandaTicket,
  buildPrecuentaTicket,
  buildBoletaTicket,
  type TicketItem,
  type TicketTotales,
  type TicketPago,
  type BoletaEmisor,
  type BoletaMetaOperativa,
  type BoletaCliente,
  type BoletaItem,
  type ImpuestoBoleta,
} from '~/utils/ticket-builder'
import { conTimeout } from '~/utils/con-timeout'

/** Techo de espera de QZ Tray al imprimir (impresora apagada / host inalcanzable). */
const PRINT_TIMEOUT_MS = 5_000
const PRINT_TIMEOUT_MSG = 'La impresora no respondió (timeout 5 s)'
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
  cantidadEnviada: string // total absoluto a persistir al confirmar
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
  impresora: Impresora,
  lineas: string[],
  apiUrl: string,
): Promise<void> {
  const qz = await getQz()
  await asegurarSeguridadQz(qz, apiUrl)
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect()
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
    // Log del motivo real del rechazo de QZ Tray (apiErrorMsg lo resume a un
    // fallback genérico en el toast); útil para diagnosticar la impresora.
    const destino = impresora.tipoConexion === 'red'
      ? `${impresora.host}:${impresora.puerto}`
      : impresora.nombreCola
    console.error(`[qz] print falló → ${destino}`, err)
    throw err
  }
}

export function useImpresoras() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const listar = (rol?: RolImpresora) =>
    useApiFetch<Impresora[]>(`${apiUrl}/impresoras${rol ? `?rol=${rol}` : ''}`)

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
   */
  async function imprimirComanda(
    cuentaId: string,
    contexto: { mesaNombre: string, cuentaNumero: number, garzonNombre: string | null },
  ): Promise<ComandaEstacion[] | null> {
    const impresoras = (await listar('comanda')).filter(i => i.activo)
    if (impresoras.length === 0) return null

    const { estaciones } = await useApiFetch<ComandaPreviewResponse>(
      `${apiUrl}/cuentas/${cuentaId}/comanda/reclamar`,
      { method: 'POST' },
    )
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
  async function obtenerImpresoraBoleta(): Promise<Impresora | null> {
    const impresoras = await listar('boleta')
    return impresoras.find(i => i.activo) ?? null
  }

  async function imprimirPrecuenta(input: {
    tenantNombre: string
    mesaNombre: string
    cuentaNumero: number
    items: (TicketItem & { totalLinea: string })[]
    totales: TicketTotales
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
    propina?: { monto: string }
    pagos: TicketPago[]
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
