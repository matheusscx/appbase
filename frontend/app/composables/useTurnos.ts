import { useApiFetch } from './useApiFetch'

// ── Tipos (espejo del contrato del backend turnos) ───────────────────────────

export interface Turno {
  id: string
  nombre: string
  horaInicio: string
  horaFin: string
  activo: boolean
  creadoEl: string
  actualizadoEl: string
}

export function useTurnos() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const listar = () =>
    useApiFetch<Turno[]>(`${apiUrl}/turnos`)

  const crear = (body: {
    nombre: string
    horaInicio: string
    horaFin: string
    activo?: boolean
  }) =>
    useApiFetch<Turno>(`${apiUrl}/turnos`, { method: 'POST', body })

  const actualizar = (
    id: string,
    body: Partial<{
      nombre: string
      horaInicio: string
      horaFin: string
      activo: boolean
    }>,
  ) =>
    useApiFetch<Turno>(`${apiUrl}/turnos/${id}`, { method: 'PATCH', body })

  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/turnos/${id}`, { method: 'DELETE' })

  return { listar, crear, actualizar, eliminar }
}
