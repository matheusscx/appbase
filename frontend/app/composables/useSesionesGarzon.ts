import { useApiFetch } from './useApiFetch'
import type { PaginatedResponse } from './usePaginatedList'

// ── Tipos (espejo del contrato del backend sesiones-garzon) ──────────────────

export interface SesionGarzon {
  id: string
  garzonId: string
  garzonNombre: string
  turnoId: string
  turnoNombre: string
  inicioEl: string
  finEl: string | null
  estado: 'abierta' | 'cerrada'
  origenCierre: 'pin' | 'admin' | null
  cerradaPorUsuarioId: string | null
}

export function useSesionesGarzon() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const iniciar = (body: { pin: string, turnoId: string }) =>
    useApiFetch<SesionGarzon>(`${apiUrl}/sesiones-garzon/iniciar`, {
      method: 'POST',
      body,
    })

  const cerrar = (body: { pin: string }) =>
    useApiFetch<SesionGarzon>(`${apiUrl}/sesiones-garzon/cerrar`, {
      method: 'POST',
      body,
    })

  const activa = (body: { pin: string }) =>
    useApiFetch<SesionGarzon | null>(`${apiUrl}/sesiones-garzon/activa`, {
      method: 'POST',
      body,
    })

  const listarAbiertas = () =>
    useApiFetch<SesionGarzon[]>(`${apiUrl}/sesiones-garzon/abiertas`)

  const historial = (query: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') {
        qs.set(key, String(value))
      }
    }
    return useApiFetch<PaginatedResponse<SesionGarzon>>(
      `${apiUrl}/sesiones-garzon?${qs}`,
    )
  }

  const cerrarAdmin = (id: string) =>
    useApiFetch<SesionGarzon>(`${apiUrl}/sesiones-garzon/${id}/cerrar`, {
      method: 'POST',
    })

  return { iniciar, cerrar, activa, listarAbiertas, historial, cerrarAdmin }
}
