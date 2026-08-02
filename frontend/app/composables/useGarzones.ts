import { useApiFetch } from './useApiFetch'

// ── Tipos (espejo del contrato del backend garzones) ────────────────────────

export type TipoGarzon = 'garzon' | 'cocina' | 'barra'

export interface Garzon {
  id: string
  nombre: string
  activo: boolean
  tipo: TipoGarzon
  creadoEl: string
  actualizadoEl: string
  // Solo llegan con `listar(true)`; el resto de las pantallas que llaman
  // `listar()` (POS, identificación por PIN) nunca los piden.
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

export interface GarzonIdentificado {
  garzonId: string
  nombre: string
}

/** Respuesta de crear/regenerar: incluye el PIN en claro una sola vez. */
export interface GarzonConPin extends Garzon {
  pin: string
}

export function useGarzones() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  /** `incluirEliminados` es opcional y por default `false`: el POS y la
   *  identificación por PIN también llaman `listar()` y no deben empezar a
   *  ver garzones borrados. */
  const listar = (incluirEliminados = false) =>
    useApiFetch<Garzon[]>(
      `${apiUrl}/garzones${incluirEliminados ? '?incluirEliminados=true' : ''}`,
    )

  /** Crea el garzón; el backend genera el PIN y lo devuelve una sola vez. */
  const crear = (body: { nombre: string, activo?: boolean, tipo?: TipoGarzon }) =>
    useApiFetch<GarzonConPin>(`${apiUrl}/garzones`, { method: 'POST', body })

  const actualizar = (id: string, body: { nombre?: string, activo?: boolean, tipo?: TipoGarzon }) =>
    useApiFetch<Garzon>(`${apiUrl}/garzones/${id}`, { method: 'PATCH', body })

  /** Regenera el PIN del garzón; devuelve el nuevo PIN una sola vez. */
  const regenerarPin = (id: string) =>
    useApiFetch<GarzonConPin>(`${apiUrl}/garzones/${id}/pin`, {
      method: 'PATCH',
    })

  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/garzones/${id}`, { method: 'DELETE' })

  /** Verifica un PIN y devuelve el garzón identificado (o lanza 400). */
  const identificar = (pin: string) =>
    useApiFetch<GarzonIdentificado>(`${apiUrl}/garzones/identificar`, {
      method: 'POST',
      body: { pin },
    })

  return { listar, crear, actualizar, regenerarPin, eliminar, identificar }
}
