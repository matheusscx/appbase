import { useApiFetch } from './useApiFetch'

// ── Tipos (espejo del contrato del backend garzones) ────────────────────────

export type TipoGarzon = 'garzon' | 'cocina' | 'barra'

export interface Garzon {
  id: string
  nombre: string
  activo: boolean
  tipo: TipoGarzon
  /** Cuenta vinculada (modo personal), o `null` si se identifica por PIN. */
  usuarioId: string | null
  /**
   * Si existe un PIN usable hoy. Con `usuarioId`, es el garzón quien lo fija
   * desde su perfil — este campo es lo único que le dice al encargado si ya
   * lo hizo, sin depender de leer su historial (que puede fallar o tardar).
   */
  pinFijado: boolean
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
  pin: string | null
}

/**
 * Respuesta específica de `regenerarPin`: suma si HABÍA un PIN usable antes
 * de este PATCH. El resultado de "invalidar" no puede depender de lo que la
 * pantalla creía saber al abrir el modal —ese dato pudo quedar viejo
 * mientras estuvo abierta sin recargar—, así que lo manda el backend, que lo
 * sabe con certeza en el momento exacto en que pisa el hash.
 */
export interface GarzonPinRegenerado extends GarzonConPin {
  habiaPin: boolean
}

/**
 * Qué le pasó al PIN. Los dos de invalidación se distinguen porque dicen
 * cosas distintas: `invalidado_por_vinculo` es "te di una cuenta, tu PIN
 * viejo ya no hace falta"; `invalidado_por_encargado` es "te corté el PIN".
 */
export type TipoEventoPin =
  | 'emitido_en_alta'
  | 'regenerado_por_encargado'
  | 'invalidado_por_encargado'
  | 'invalidado_por_vinculo'
  | 'fijado_por_garzon'

/** Una línea de historia de PIN, lista para mostrar. Nunca incluye el PIN. */
export interface EventoPin {
  id: string
  tipo: TipoEventoPin
  /** Quién lo hizo. `null` si la cuenta ya no existe — el hecho igual vale. */
  usuarioNombre: string | null
  creadoEl: string
}

/**
 * Una página del historial de PIN: los últimos N eventos **y el total**.
 *
 * El `total` no es decorativo. El backend topea la lista porque
 * `garzon_pin_evento` solo crece, y sin este número la pantalla recortaría la
 * historia en silencio — que es justo lo que la decisión del owner
 * (2026-08-15) descartó. Con él puede decir "los últimos N de M".
 */
export interface EventosPinPagina {
  eventos: EventoPin[]
  total: number
}

/** Mi propio estado de PIN, tal como lo ve el garzón dueño de la cuenta. */
export interface MiPinEstado extends EventosPinPagina {
  fijado: boolean
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

  /**
   * Crea el garzón. **Sin** `usuarioId` el backend genera el PIN y lo devuelve
   * una sola vez; **con** `usuarioId` no emite ninguno (`pin: null`) y lo fija
   * la persona desde su perfil, así el encargado nunca llega a verlo.
   *
   * `usuarioId` no acepta `null` como el de `actualizar`: en el alta la fila
   * todavía no existe, así que no hay vínculo que "sacar" — ausente es el
   * único modo de decir "sin cuenta".
   */
  const crear = (body: { nombre: string, activo?: boolean, tipo?: TipoGarzon, usuarioId?: string }) =>
    useApiFetch<GarzonConPin>(`${apiUrl}/garzones`, { method: 'POST', body })

  const actualizar = (
    id: string,
    // `usuarioId` acepta `null` explícito: en el DTO, ausente es "no toques el
    // vínculo" y `null` es "desvinculá".
    body: { nombre?: string, activo?: boolean, tipo?: TipoGarzon, usuarioId?: string | null },
  ) =>
    useApiFetch<GarzonConAdvertencias>(`${apiUrl}/garzones/${id}`, { method: 'PATCH', body })

  /** Regenera el PIN del garzón; devuelve el nuevo PIN una sola vez. */
  const regenerarPin = (id: string) =>
    useApiFetch<GarzonPinRegenerado>(`${apiUrl}/garzones/${id}/pin`, {
      method: 'PATCH',
    })

  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/garzones/${id}`, { method: 'DELETE' })

  /**
   * En qué modo está este dispositivo: el garzón vinculado a la cuenta
   * logueada, o `null` si hay que pedir PIN.
   *
   * ⚠️ Es una conveniencia de UI, **no un control**: quien decide de verdad es
   * el backend en cada acción. Mentir acá no habilita nada.
   */
  const miVinculo = () =>
    useApiFetch<GarzonParaSelector | null>(`${apiUrl}/garzones/mi-vinculo`)

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

  /** Mi propio estado e historia de PIN. 404 si esta cuenta no es garzón acá. */
  const miPin = () => useApiFetch<MiPinEstado>(`${apiUrl}/garzones/mi-pin`)

  /** Fijo mi PIN. No pide el anterior: la cuenta es el ancla. */
  const fijarMiPin = (pin: string, confirmarPin: string) =>
    useApiFetch<void>(`${apiUrl}/garzones/mi-pin`, {
      method: 'PATCH',
      body: { pin, confirmarPin },
    })

  /** La historia de PIN de un garzón, para la ficha. Topeada, con el total. */
  const listarEventosPin = (id: string) =>
    useApiFetch<EventosPinPagina>(`${apiUrl}/garzones/${id}/pin-eventos`)

  return {
    listar,
    crear,
    actualizar,
    regenerarPin,
    eliminar,
    paraSelector,
    miVinculo,
    verificarPin,
    miPin,
    fijarMiPin,
    listarEventosPin,
  }
}
