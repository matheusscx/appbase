import { useApiFetch } from './useApiFetch'
import type { Suscripcion } from './useSuscripciones'

export interface SuscripcionAdmin extends Suscripcion {
  usuarioId: string
  usuarioNombre: string
  usuarioEmail: string
}

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
  const error = ref(false)
  const sinPermiso = ref(false)
  const mutando = reactive(new Set<string>())

  async function cargar() {
    loading.value = true
    try {
      suscripciones.value = await useApiFetch<SuscripcionAdmin[]>(`${apiUrl}/suscripciones/admin`)
      error.value = false
      sinPermiso.value = false
    } catch (e: unknown) {
      error.value = true
      sinPermiso.value = esSinPermiso(e)
      suscripciones.value = []
      if (!sinPermiso.value) toast.add({ title: apiErrorMsg(e, 'Error al cargar suscripciones'), color: 'error' })
    } finally {
      loading.value = false
    }
  }

  async function cancelar(id: string) {
    if (mutando.has(id)) return
    const susc = suscripciones.value.find((s) => s.id === id)
    if (!susc) return
    mutando.add(id)
    const prev = susc.estado
    susc.estado = 'cancelada' // optimista
    try {
      const res = await useApiFetch<{ id: string, estado: Suscripcion['estado'], activaHasta: string | null, proximoCobro: string }>(
        `${apiUrl}/suscripciones/admin/${id}`,
        { method: 'PATCH', body: { accion: 'cancelar' } },
      )
      susc.activaHasta = res.activaHasta
      susc.proximoCobro = res.proximoCobro
      toast.add({ title: 'Suscripción cancelada', color: 'success' })
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

  onMounted(cargar)

  return { suscripciones, loading, error, sinPermiso, cargar, cancelar, eliminar }
}
