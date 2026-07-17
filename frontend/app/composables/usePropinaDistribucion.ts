import { useApiFetch } from './useApiFetch'
import type { TipoGarzon } from './useGarzones'

export type CriterioDistribucion =
  | 'VENTAS_NETAS'
  | 'HORAS_TRABAJADAS'
  | 'PARTES_IGUALES'
  | 'CANTIDAD_CUENTAS'
  | 'MANUAL'

export type BaseVentasGrupo = 'TOTAL_FINAL' | 'BASE_SIN_IMPUESTOS'

export type ManualModo = 'PESOS' | 'MONTOS'

export interface PesoManual {
  garzonId: string
  peso: string
}

export interface GrupoDistribucion {
  id?: string
  tipoGarzon: TipoGarzon
  nombre: string
  porcentaje: string
  criterio: CriterioDistribucion
  baseVentas: BaseVentasGrupo
  manualModo: ManualModo | null
  activo: boolean
  orden: number
  pesos: PesoManual[]
}

export interface DistribucionPublica {
  id: string
  version: number
  porcentajeSugerido: string
  actualizadoPor: string | null
  actualizadoEl: string
  grupos: GrupoDistribucion[]
}

export interface UpdateDistribucionBody {
  porcentajeSugerido: string
  grupos: Array<{
    tipoGarzon: TipoGarzon
    nombre: string
    porcentaje: string
    criterio: CriterioDistribucion
    baseVentas?: BaseVentasGrupo
    manualModo?: ManualModo | null
    activo?: boolean
    orden?: number
    pesos?: PesoManual[]
  }>
}

export function usePropinaDistribucion() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const obtener = () =>
    useApiFetch<DistribucionPublica>(`${apiUrl}/propinas/distribucion`)

  const reemplazar = (body: UpdateDistribucionBody) =>
    useApiFetch<DistribucionPublica>(`${apiUrl}/propinas/distribucion`, {
      method: 'PUT',
      body,
    })

  return { obtener, reemplazar }
}
