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

/**
 * Lo mínimo para pintar el selector previo al teclado de PIN. El endpoint no
 * devuelve nada más —ni PIN, ni `activo`, ni tipo—: es la única lectura de
 * garzones que ve alguien con `Salones:Operar` y sin `Salones:Leer`.
 */
export interface GarzonParaSelector {
  garzonId: string
  nombre: string
}

/**
 * Respuesta de una mutación que puede tener un efecto que el admin no anticipa.
 * Viene siempre —vacío si no hay nada que decir— así que no hace falta
 * distinguir "sin advertencias" de "el endpoint no las manda".
 *
 * Hoy son dos: cambiar el `tipo` de alguien con sesión abierta (el reparto de
 * ese turno usa el tipo congelado al abrirla) y regenerar el PIN de alguien en
 * turno (el PIN viejo muere ya, y hasta recibir el nuevo no puede ni marcar
 * salida). Los dos advierten en vez de bloquear — decisión del owner del
 * 2026-08-07, ver `docs/features/turnos-garzones.md`.
 */
export interface GarzonConAdvertencias extends Garzon {
  advertencias: string[]
}

/** Respuesta de crear/regenerar: incluye el PIN en claro una sola vez. */
export interface GarzonConPin extends GarzonConAdvertencias {
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
    useApiFetch<GarzonConAdvertencias>(`${apiUrl}/garzones/${id}`, { method: 'PATCH', body })

  /** Regenera el PIN del garzón; devuelve el nuevo PIN una sola vez. */
  const regenerarPin = (id: string) =>
    useApiFetch<GarzonConPin>(`${apiUrl}/garzones/${id}/pin`, {
      method: 'PATCH',
    })

  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/garzones/${id}`, { method: 'DELETE' })

  /**
   * Verifica el PIN **sin ejecutar nada**. El modal la llama antes de emitir
   * para poder mostrar "PIN inválido" en línea: si el PIN se validara recién
   * dentro de la acción, el modal ya estaría cerrado y el error saldría como
   * toast, con la acción descartada.
   */
  const verificarPin = (garzonId: string, pin: string) =>
    useApiFetch<GarzonParaSelector>(`${apiUrl}/garzones/verificar-pin`, {
      method: 'POST',
      body: { garzonId, pin },
    })

  /**
   * Los garzones del selector. Las dos variantes son **complementarias**:
   * `enTurno: false` para *entrar a turno* (quien ya tiene sesión abierta no
   * puede abrir otra), `true` para todo lo demás, que exige sesión abierta.
   * Mandar la equivocada no da error: da la lista que no es, y **omitir el
   * param da 400** — el DTO no tiene default, a propósito.
   */
  const paraSelector = (enTurno: boolean) =>
    useApiFetch<GarzonParaSelector[]>(
      `${apiUrl}/garzones/para-selector?enTurno=${enTurno}`,
    )

  return {
    listar,
    crear,
    actualizar,
    regenerarPin,
    eliminar,
    paraSelector,
    verificarPin,
  }
}
