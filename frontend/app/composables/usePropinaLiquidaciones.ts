import { useApiFetch } from './useApiFetch'
import type {
  BaseVentasGrupo,
  CriterioDistribucion,
  ManualModo,
} from './usePropinaDistribucion'
import type { TipoGarzon } from './useGarzones'

export type EstadoLiquidacion = 'borrador' | 'confirmada' | 'anulada'
export type OrigenParticipante = 'sugerido' | 'agregado_manual'

export interface LiquidacionResumen {
  id: string
  estado: EstadoLiquidacion
  fechaDesde: string
  fechaHasta: string
  poolTotal: string
  configuracionVersion: number
  creadoEl: string
}

export interface LiquidacionGrupo {
  id: string
  tenantId: string
  liquidacionId: string
  tipoGarzon: TipoGarzon
  nombre: string
  porcentaje: string
  criterio: CriterioDistribucion
  baseVentas: BaseVentasGrupo
  manualModo: ManualModo | null
  montoGrupo: string
  orden: number
}

export interface LiquidacionParticipante {
  id: string
  grupoId: string
  garzonId: string
  tipoGarzon: TipoGarzon
  incluido: boolean
  origen: OrigenParticipante
  motivoAjuste: string | null
  horas: string
  ventasBase: string
  cuentas: string
  pesoManual: string | null
  monto: string
  ajusteMotivoMonto: string | null
}

export interface LiquidacionFuente {
  id: string
  ventaPropinaId: string
  montoPagado: string
}

export interface LiquidacionEvento {
  id: string
  tipo: string
  payload: Record<string, unknown>
  usuarioId: string
  creadoEl: string
}

export interface LiquidacionDetalle extends LiquidacionResumen {
  turnoIds: string[]
  monedaId: string
  decimalesMoneda: number
  creadoPor: string
  confirmadoPor: string | null
  confirmadoEl: string | null
  anuladoPor: string | null
  anuladoEl: string | null
  motivoAnulacion: string | null
  grupos: LiquidacionGrupo[]
  participantes: LiquidacionParticipante[]
  fuentes: LiquidacionFuente[]
  eventos: LiquidacionEvento[]
  advertencias: string[]
  diff?: { antes: unknown[], despues: unknown[] }
}

export interface CrearLiquidacionBody {
  fechaDesde: string
  fechaHasta: string
  turnoIds?: string[]
}

export interface UpdateLiquidacionBody {
  participantes?: Array<{
    id?: string
    garzonId?: string
    grupoId?: string
    incluido?: boolean
    motivoAjuste?: string
    pesoManual?: string
    monto?: string
    ajusteMotivoMonto?: string
  }>
  recalcular?: boolean
}

export interface PreviewGrupo {
  id: string
  tipoGarzon: TipoGarzon
  nombre: string
  porcentaje: string
  criterio: CriterioDistribucion
  baseVentas: BaseVentasGrupo
  manualModo: ManualModo | null
  montoGrupo: string
  orden: number
}

export interface PreviewParticipante {
  garzonId: string
  grupoId: string
  tipoGarzon: TipoGarzon
  incluido: boolean
  horas: string
  ventasBase: string
  cuentas: string
  pesoManual: string | null
  monto: string
}

export interface PreviewReparto {
  poolTotal: string
  monedaId: string
  decimalesMoneda: number
  grupos: PreviewGrupo[]
  participantes: PreviewParticipante[]
  advertencias: string[]
}

export interface AjustesReparto {
  exclusiones?: string[]
  montosManuales?: Array<{ garzonId: string, monto: string }>
}

export interface PreviewBody {
  fechaDesde: string
  fechaHasta: string
  turnoIds?: string[]
  ajustes?: AjustesReparto
}

export interface LiquidarBody extends PreviewBody {}

export function usePropinaLiquidaciones() {
  const apiUrl = useRuntimeConfig().public.apiUrl
  const base = `${apiUrl}/propinas/liquidaciones`

  const listar = () => useApiFetch<LiquidacionResumen[]>(base)
  const crear = (body: CrearLiquidacionBody) =>
    useApiFetch<LiquidacionDetalle>(base, { method: 'POST', body })
  const detalle = (id: string) =>
    useApiFetch<LiquidacionDetalle>(`${base}/${id}`)
  const actualizar = (id: string, body: UpdateLiquidacionBody) =>
    useApiFetch<LiquidacionDetalle>(`${base}/${id}`, { method: 'PATCH', body })
  const actualizarConfig = (id: string) =>
    useApiFetch<LiquidacionDetalle>(`${base}/${id}/actualizar-config`, {
      method: 'POST',
    })
  const confirmar = (id: string) =>
    useApiFetch<LiquidacionDetalle>(`${base}/${id}/confirmar`, { method: 'POST' })
  const anular = (id: string, body: { motivo: string }) =>
    useApiFetch<LiquidacionDetalle>(`${base}/${id}/anular`, {
      method: 'POST',
      body,
    })
  const preview = (body: PreviewBody) =>
    useApiFetch<PreviewReparto>(`${base}/preview`, { method: 'POST', body })
  const liquidar = (body: LiquidarBody) =>
    useApiFetch<LiquidacionDetalle>(`${base}/liquidar`, { method: 'POST', body })

  return { listar, crear, detalle, actualizar, actualizarConfig, confirmar, anular, preview, liquidar }
}
