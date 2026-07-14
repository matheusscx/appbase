import { useApiFetch } from './useApiFetch'
import {
  buildComandaTicket,
  buildPrecuentaTicket,
  buildBoletaTicket,
  type TicketItem,
  type TicketTotales,
  type TicketPago,
} from '~/utils/ticket-builder'

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

async function imprimirEn(impresora: Impresora, lineas: string[]): Promise<void> {
  const qz = await getQz()
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect()
  }
  // "Red": QZ abre un socket raw a host:puerto (ESC/POS TCP 9100) y escribe los
  // bytes directamente, sin pasar por una cola del SO. Las líneas lógicas se unen
  // con '\n' (0x0A = avance de línea) para que el printer no las imprima pegadas.
  const config = impresora.tipoConexion === 'sistema'
    ? qz.configs.create(impresora.nombreCola as string)
    : qz.configs.create({ host: impresora.host as string, port: Number(impresora.puerto) })
  try {
    // ESC/POS al final del ticket: avanza 4 líneas (ESC d 4) y corta total
    // (GS V 0). Las impresoras sin cutter ignoran el comando sin efecto.
    const CORTE = '\x1B\x64\x04\x1D\x56\x00'
    await qz.print(config, [lineas.join('\n') + '\n', CORTE])
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
   * Envía la comanda pendiente en dos fases: (1) consulta el diff sin mutar
   * (`GET .../comanda/pendiente`); (2) imprime un ticket por estación y, SOLO tras
   * imprimir OK, confirma esa estación (`POST .../comanda` marca cantidad_enviada).
   * Si QZ Tray falla, la estación no se confirma → queda pendiente y reintentable,
   * en vez de perderse (no hay reimpresión de comandas).
   */
  async function imprimirComanda(
    cuentaId: string,
    contexto: { mesaNombre: string, cuentaNumero: number, garzonNombre: string | null },
  ): Promise<ComandaEstacion[]> {
    const { estaciones } = await useApiFetch<ComandaPreviewResponse>(
      `${apiUrl}/cuentas/${cuentaId}/comanda/pendiente`,
    )
    if (estaciones.length === 0) return estaciones

    const impresoras = await listar('comanda')
    for (const estacion of estaciones) {
      const impresora = impresoras.find(i => i.id === estacion.impresoraId)
      if (!impresora) continue
      const lineas = buildComandaTicket({
        estacionNombre: estacion.nombre,
        mesaNombre: contexto.mesaNombre,
        cuentaNumero: contexto.cuentaNumero,
        garzonNombre: contexto.garzonNombre,
        items: estacion.items, // el builder usa {nombre, cantidad}; ignora los extras
        fecha: new Date(),
      })
      await imprimirEn(impresora, lineas) // si lanza, esta estación NO se confirma
      await useApiFetch(`${apiUrl}/cuentas/${cuentaId}/comanda`, {
        method: 'POST',
        body: {
          lineas: estacion.items.map(it => ({
            cuentaLineaId: it.cuentaLineaId,
            cantidadEnviada: it.cantidadEnviada,
          })),
        },
      })
    }
    return estaciones
  }

  async function obtenerImpresoraBoleta(): Promise<Impresora> {
    const impresoras = await listar('boleta')
    const impresora = impresoras[0]
    if (!impresora) {
      throw new Error('No hay una impresora de boletas configurada')
    }
    return impresora
  }

  async function imprimirPrecuenta(input: {
    tenantNombre: string
    mesaNombre: string
    cuentaNumero: number
    items: (TicketItem & { totalLinea: string })[]
    totales: TicketTotales
    formatMonto: (v: string) => string
  }): Promise<void> {
    const impresora = await obtenerImpresoraBoleta()
    const lineas = buildPrecuentaTicket({ ...input, fecha: new Date() })
    await imprimirEn(impresora, lineas)
  }

  async function imprimirBoleta(input: {
    tenantNombre: string
    items: (TicketItem & { totalLinea: string })[]
    totales: TicketTotales
    pagos: TicketPago[]
    formatMonto: (v: string) => string
  }): Promise<void> {
    const impresora = await obtenerImpresoraBoleta()
    const lineas = buildBoletaTicket({ ...input, fecha: new Date() })
    await imprimirEn(impresora, lineas)
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
