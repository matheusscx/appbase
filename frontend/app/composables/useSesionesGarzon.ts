import { useApiFetch } from './useApiFetch'

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

  // Task 7 añadirá listarAbiertas, historial, cerrarAdmin, activa
  return { iniciar, cerrar }
}
