import { useApiFetch } from './useApiFetch'
import type { Suscripcion } from './useSuscripciones'

export interface SuscripcionAdmin extends Suscripcion {
  usuarioId: string
  usuarioNombre: string
  usuarioEmail: string
}

const ESTADO_TRAS_ACCION = {
  pausar: 'pausada',
  reanudar: 'activa',
  cancelar: 'cancelada',
} as const

const TOAST_ACCION = {
  pausar: 'Suscripción pausada',
  reanudar: 'Suscripción reanudada',
  cancelar: 'Suscripción cancelada',
} as const

/**
 * Administración de suscripciones del tenant (módulo RBAC "Suscripciones") —
 * GET/PATCH/DELETE /suscripciones/admin.
 */
export function useSuscripcionesAdmin() {
  const config = useRuntimeConfig()
  const toast = useToast()
  const apiUrl = config.public.apiUrl

  const suscripciones = ref<SuscripcionAdmin[]>([])
  const loading = ref(false)
  const mutando = reactive(new Set<string>())

  async function cargar() {
    loading.value = true
    try {
      suscripciones.value = await useApiFetch<SuscripcionAdmin[]>(`${apiUrl}/suscripciones/admin`)
    } catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar suscripciones'), color: 'error' })
    } finally {
      loading.value = false
    }
  }

  async function accion(id: string, tipo: keyof typeof ESTADO_TRAS_ACCION) {
    if (mutando.has(id)) return
    const susc = suscripciones.value.find((s) => s.id === id)
    if (!susc) return
    mutando.add(id)
    const prev = susc.estado
    susc.estado = ESTADO_TRAS_ACCION[tipo] // optimista
    try {
      const res = await useApiFetch<{ id: string, estado: Suscripcion['estado'], activaHasta: string | null }>(
        `${apiUrl}/suscripciones/admin/${id}`,
        { method: 'PATCH', body: { accion: tipo } },
      )
      susc.activaHasta = res.activaHasta
      toast.add({ title: TOAST_ACCION[tipo], color: 'success' })
    } catch (e: unknown) {
      susc.estado = prev // revert
      toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
    } finally {
      mutando.delete(id)
    }
  }

  async function eliminar(id: string) {
    if (mutando.has(id)) return
    const idx = suscripciones.value.findIndex((s) => s.id === id)
    if (idx === -1) return
    mutando.add(id)
    const [removida] = suscripciones.value.splice(idx, 1) // optimista
    try {
      await useApiFetch(`${apiUrl}/suscripciones/admin/${id}`, { method: 'DELETE' })
      toast.add({ title: 'Suscripción eliminada', color: 'success' })
    } catch (e: unknown) {
      if (removida) suscripciones.value.splice(idx, 0, removida) // revert
      toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
    } finally {
      mutando.delete(id)
    }
  }

  const pausar = (id: string) => accion(id, 'pausar')
  const reanudar = (id: string) => accion(id, 'reanudar')
  const cancelar = (id: string) => accion(id, 'cancelar')

  onMounted(cargar)

  return { suscripciones, loading, cargar, pausar, reanudar, cancelar, eliminar }
}
