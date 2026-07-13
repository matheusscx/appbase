import { useApiFetch } from './useApiFetch'

// ── Tipos (espejo del contrato del backend garzones) ────────────────────────

export interface Garzon {
  id: string
  nombre: string
  activo: boolean
  creadoEl: string
  actualizadoEl: string
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

  const listar = () =>
    useApiFetch<Garzon[]>(`${apiUrl}/garzones`)

  /** Crea el garzón; el backend genera el PIN y lo devuelve una sola vez. */
  const crear = (body: { nombre: string, activo?: boolean }) =>
    useApiFetch<GarzonConPin>(`${apiUrl}/garzones`, { method: 'POST', body })

  const actualizar = (id: string, body: { nombre?: string, activo?: boolean }) =>
    useApiFetch<Garzon>(`${apiUrl}/garzones/${id}`, { method: 'PATCH', body })

  /** Regenera el PIN del garzón; devuelve el nuevo PIN una sola vez. */
  const regenerarPin = (id: string) =>
    useApiFetch<GarzonConPin>(`${apiUrl}/garzones/${id}/pin`, {
      method: 'PATCH',
    })

  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/garzones/${id}`, { method: 'DELETE' })

  /** Verifica un PIN y devuelve el garzón identificado (o lanza 401). */
  const identificar = (pin: string) =>
    useApiFetch<GarzonIdentificado>(`${apiUrl}/garzones/identificar`, {
      method: 'POST',
      body: { pin },
    })

  return { listar, crear, actualizar, regenerarPin, eliminar, identificar }
}
