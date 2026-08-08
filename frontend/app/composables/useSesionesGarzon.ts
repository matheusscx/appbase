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

/**
 * Cuenta que quedó abierta a nombre del garzón al cerrarse su sesión. Nadie
 * puede cobrarla mientras su responsable esté fuera de turno, así que los dos
 * cierres (PIN y admin) la devuelven para que la UI ofrezca transferirla.
 */
export interface CuentaPendienteGarzon {
  cuentaId: string
  numero: number
  mesaNombre: string
  salonNombre: string
}

export interface SesionCerrada extends SesionGarzon {
  cuentasPendientes: CuentaPendienteGarzon[]
}

/**
 * "Terraza · Mesa 4 — Cuenta 2". El salón y la mesa llegan vacíos si se
 * borraron: la cuenta igual se lista, porque es la que más urge transferir.
 */
export function etiquetaCuentaPendiente(cuenta: CuentaPendienteGarzon): string {
  const mesa = cuenta.mesaNombre || 'Mesa sin nombre'
  const ubicacion = cuenta.salonNombre ? `${cuenta.salonNombre} · ${mesa}` : mesa
  return `${ubicacion} — Cuenta ${cuenta.numero}`
}

/**
 * El estado del modal "quedaron mesas abiertas" y el bucle de transferencia,
 * compartidos por las dos pantallas que cierran sesiones: Salones (el garzón
 * sale de turno y el destinatario se identifica por PIN) y el backoffice
 * (cierre forzado, destinatario elegido de un select).
 *
 * Vive acá y no duplicado en las dos páginas porque **la parte delicada no es
 * el bucle sino su bookkeeping**, y es idéntica en las dos: cortar en el primer
 * error, no perder lo que faltaba, y no pisar una oferta más nueva. Con las dos
 * copias sueltas, `pages/salones/index.vue` no tenía cómo testearse.
 */
export function useTransferenciaPendientes() {
  const toast = useToast()

  const pendientes = ref<CuentaPendienteGarzon[]>([])
  const garzonNombre = ref('')
  const abierto = ref(false)
  const transfiriendo = ref(false)

  /** Ofrece transferir lo que dejó una sesión recién cerrada. Sin cuentas, no molesta. */
  function ofrecer(sesion: SesionCerrada) {
    if (sesion.cuentasPendientes.length === 0) return
    pendientes.value = sesion.cuentasPendientes
    garzonNombre.value = sesion.garzonNombre
    abierto.value = true
  }

  /**
   * Vuelve a mostrar la oferta si todavía queda algo. La usa el flujo del PIN,
   * que cierra este modal para abrir el teclado: sin esto, cancelar el teclado
   * dejaba las cuentas vivas en memoria **y la oferta imposible de reabrir** —
   * un toque accidental y el garzón se va con las mesas a su nombre.
   */
  function reabrirSiQuedan() {
    abierto.value = pendientes.value.length > 0
  }

  /**
   * Transfiere en orden y **corta en el primer error**: los errores de este
   * flujo son del destinatario (PIN inválido, fuera de turno), no de una cuenta
   * puntual, así que seguir solo repetiría el mismo mensaje N veces. Lo que no
   * alcanzó a transferirse queda para reintentar con otro destinatario.
   */
  async function transferirTodas(transferir: (cuentaId: string) => Promise<void>) {
    if (transfiriendo.value) return { transferidas: 0, error: null }
    transfiriendo.value = true

    // El lote se compara por identidad antes de escribirlo de vuelta: mientras
    // las transferencias vuelan la pantalla sigue operable, y si se cierra OTRA
    // sesión, `ofrecer` ya reemplazó `pendientes` — escribir igual dejaría el
    // modal mostrando el nombre de un garzón con la lista de otro.
    const lote = pendientes.value
    const restantes = [...lote]
    let transferidas = 0
    let error: string | null = null
    try {
      while (restantes.length > 0) {
        try {
          await transferir(restantes[0]!.cuentaId)
          restantes.shift()
          transferidas++
        }
        catch (e: unknown) {
          error = apiErrorMsg(e, 'No se pudo transferir la cuenta')
          break
        }
      }
    }
    finally {
      transfiriendo.value = false
    }

    // Si el lote ya no es el vigente, lo que le faltaba transferir se descarta:
    // pisar la oferta nueva con una lista de otro garzón es peor, y las cuentas
    // no se pierden —siguen abiertas y las devuelve el próximo cierre de sesión
    // o se transfieren desde el detalle de la mesa. Los toasts de abajo sí se
    // emiten igual: describen lo que efectivamente pasó.
    if (pendientes.value === lote) {
      pendientes.value = restantes
      abierto.value = error !== null
    }

    if (transferidas > 0) {
      toast.add({
        title: transferidas === 1
          ? 'Cuenta transferida'
          : `${transferidas} cuentas transferidas`,
        color: 'success',
      })
    }
    // Toast plano y NO `toastErrorOperativo`: el que está fuera de turno acá es
    // el destinatario, no quien opera el equipo. Ofrecerle "entrar a turno"
    // sería mandarlo a iniciar un turno que ya tiene.
    if (error) toast.add({ title: error, color: 'error' })

    return { transferidas, error }
  }

  return {
    pendientes,
    garzonNombre,
    abierto,
    transfiriendo,
    ofrecer,
    reabrirSiQuedan,
    transferirTodas,
  }
}

export function useSesionesGarzon() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const iniciar = (body: { garzonId: string, pin: string, turnoId: string }) =>
    useApiFetch<SesionGarzon>(`${apiUrl}/sesiones-garzon/iniciar`, {
      method: 'POST',
      body,
    })

  const cerrar = (body: { garzonId: string, pin: string }) =>
    useApiFetch<SesionCerrada>(`${apiUrl}/sesiones-garzon/cerrar`, {
      method: 'POST',
      body,
    })

  const activa = (body: { garzonId: string, pin: string }) =>
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
    useApiFetch<SesionCerrada>(`${apiUrl}/sesiones-garzon/${id}/cerrar`, {
      method: 'POST',
    })

  return { iniciar, cerrar, activa, listarAbiertas, historial, cerrarAdmin }
}
