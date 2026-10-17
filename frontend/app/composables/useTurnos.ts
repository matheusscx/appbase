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

/** `HH:mm` o `HH:mm:ss` → minutos desde las 00:00. */
function minutosDelDia(hora: string): number {
  const [h, m] = hora.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * El turno cuya ventana contiene la hora (auditoría UX 02.16), para preseleccionarlo al entrar a
 * turno: la garzona que entra a las 20:00 no queda en la "Mañana" por ser la primera de la lista.
 *
 * - El inicio entra y el fin no (a las 15:00 ya es el turno que empieza a las 15:00).
 * - Un turno con `horaFin` menor que `horaInicio` cruza la medianoche (22:00–04:00).
 * - Inicio = fin no contiene ninguna hora: es un dato ambiguo y no se adivina.
 * - Con ventanas que se pisan, gana el primero de la lista.
 * - La hora es la del reloj del dispositivo, que es el del local: el front no conoce la zona del tenant.
 *
 * Sin coincidencia devuelve `undefined`: el modal abre sin nada elegido.
 */
export function turnoDeLaHora(turnos: Turno[], ahora: Date = new Date()): Turno | undefined {
  const minuto = ahora.getHours() * 60 + ahora.getMinutes()
  return turnos.find((t) => {
    const inicio = minutosDelDia(t.horaInicio)
    const fin = minutosDelDia(t.horaFin)
    if (inicio === fin) return false
    return inicio < fin
      ? minuto >= inicio && minuto < fin
      : minuto >= inicio || minuto < fin
  })
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
