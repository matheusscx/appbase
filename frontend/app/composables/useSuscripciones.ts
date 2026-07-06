import { useApiFetch } from './useApiFetch'

export interface Suscripcion {
  id: string
  itemId: string
  itemNombre: string
  precio: string
  monedaId: string | null
  frecuencia: 'semanal' | 'quincenal' | 'mensual'
  diaMes: number | null
  diaSemana: number | null
  estado: 'activa' | 'pausada' | 'cancelada'
  proximoCobro: string
  activaHasta: string | null
  tarjetaMarca: string | null
  tarjetaLast4: string | null
  ventaInicialId: string | null
}

export const frecuenciaLabel: Record<Suscripcion['frecuencia'], string> = {
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  mensual: 'Mensual',
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export function detalleDia(s: Pick<Suscripcion, 'frecuencia' | 'diaMes' | 'diaSemana'>): string {
  if (s.frecuencia === 'semanal' && s.diaSemana !== null)
    return `los ${DIAS_SEMANA[s.diaSemana]}`
  if (s.frecuencia === 'quincenal' && s.diaMes !== null)
    return `los días ${s.diaMes} y ${s.diaMes + 15}`
  if (s.diaMes !== null) return `el día ${s.diaMes}`
  return ''
}

/** Día anterior a una fecha ISO (YYYY-MM-DD), en hora local — último día usable de una suscripción cancelada. */
export function diaAnterior(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const prev = new Date(y!, m! - 1, d! - 1)
  const mm = String(prev.getMonth() + 1).padStart(2, '0')
  const dd = String(prev.getDate()).padStart(2, '0')
  return `${prev.getFullYear()}-${mm}-${dd}`
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
 * Suscripciones del usuario autenticado — GET/PATCH /suscripciones.
 * Reemplaza el mock anterior (localStorage): ahora es 100% API-backed.
 */
export function useSuscripciones() {
  const config = useRuntimeConfig()
  const toast = useToast()
  const apiUrl = config.public.apiUrl

  const suscripciones = ref<Suscripcion[]>([])
  const loading = ref(false)
  const mutando = reactive(new Set<string>())

  async function cargar() {
    loading.value = true
    try {
      suscripciones.value = await useApiFetch<Suscripcion[]>(`${apiUrl}/suscripciones`)
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
        `${apiUrl}/suscripciones/${id}`,
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

  const pausar = (id: string) => accion(id, 'pausar')
  const reanudar = (id: string) => accion(id, 'reanudar')
  const cancelar = (id: string) => accion(id, 'cancelar')

  onMounted(cargar)

  return { suscripciones, loading, cargar, pausar, reanudar, cancelar }
}
