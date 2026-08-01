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
  // Solo llegan con `listar(true)`; el resto de las pantallas que usan turnos
  // (sesiones-garzón, propinas, salones) nunca los piden.
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

export function useTurnos() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  /** `incluirEliminados` es opcional y por default `false`: las otras tres
   *  pantallas que llaman `listar()` siguen recibiendo solo turnos vivos. */
  const listar = (incluirEliminados = false) =>
    useApiFetch<Turno[]>(
      `${apiUrl}/turnos${incluirEliminados ? '?incluirEliminados=true' : ''}`,
    )

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
