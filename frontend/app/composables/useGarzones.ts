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

export function useGarzones() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const listar = () =>
    useApiFetch<Garzon[]>(`${apiUrl}/garzones`)

  const crear = (body: { nombre: string, pin: string, activo?: boolean }) =>
    useApiFetch<Garzon>(`${apiUrl}/garzones`, { method: 'POST', body })

  const actualizar = (id: string, body: { nombre?: string, activo?: boolean }) =>
    useApiFetch<Garzon>(`${apiUrl}/garzones/${id}`, { method: 'PATCH', body })

  const resetPin = (id: string, pin: string) =>
    useApiFetch<Garzon>(`${apiUrl}/garzones/${id}/pin`, {
      method: 'PATCH',
      body: { pin },
    })

  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/garzones/${id}`, { method: 'DELETE' })

  /** Verifica un PIN y devuelve el garzón identificado (o lanza 401). */
  const identificar = (pin: string) =>
    useApiFetch<GarzonIdentificado>(`${apiUrl}/garzones/identificar`, {
      method: 'POST',
      body: { pin },
    })

  return { listar, crear, actualizar, resetPin, eliminar, identificar }
}
