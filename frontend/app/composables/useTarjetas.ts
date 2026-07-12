import { useApiFetch } from './useApiFetch'

export interface Tarjeta {
  inscripcionId: string
  marca: string | null
  last4: string | null
  tipo: string | null
  preferida: boolean
  creadoEl: string
  // Suscripciones vigentes amarradas: se cancelarían al eliminar la tarjeta.
  suscripcionesActivas: number
}

interface MedioApi {
  inscripcionId: string
  estado: string
  preferida: boolean
  creadoEl: string
  suscripcionesActivas: number
  mediosPago: { tipo: string, marca: string | null, ultimos4: string, estado: string }[]
}

interface ListarResponse {
  oneclickDisponible: boolean
  medios: MedioApi[]
}

/**
 * Medios de pago reales del usuario: tarjetas inscritas en Webpay Oneclick
 * (tokenizadas en Transbank). Acá nunca viaja un número de tarjeta — solo la
 * marca y los últimos 4 dígitos que devuelve el proveedor.
 */
export function useTarjetas() {
  const config = useRuntimeConfig()
  const toast = useToast()
  const apiUrl = config.public.apiUrl

  const tarjetas = ref<Tarjeta[]>([])
  const oneclickDisponible = ref(false)
  const loading = ref(false)

  async function cargar() {
    loading.value = true
    try {
      const res = await useApiFetch<ListarResponse>(`${apiUrl}/online/medios-pago`)
      oneclickDisponible.value = res.oneclickDisponible
      tarjetas.value = res.medios.map((m) => ({
        inscripcionId: m.inscripcionId,
        marca: m.mediosPago[0]?.marca ?? null,
        last4: m.mediosPago[0]?.ultimos4 ?? null,
        tipo: m.mediosPago[0]?.tipo ?? null,
        preferida: m.preferida,
        creadoEl: m.creadoEl,
        suscripcionesActivas: m.suscripcionesActivas ?? 0,
      }))
    } catch (e: unknown) {
      const msg = (e as { data?: { message?: string } })?.data?.message
      toast.add({ title: msg ?? 'Error al cargar los medios de pago', color: 'error' })
    } finally {
      loading.value = false
    }
  }

  /**
   * Inicia la inscripción: si funciona, el navegador sale de la SPA hacia Webpay.
   * `retornoPath` decide a qué página de la tienda vuelve Transbank (whitelisteada
   * server-side): 'medios-pago' (default) o 'suscripciones' (para reanudar un alta).
   */
  async function agregar(retornoPath?: 'medios-pago' | 'suscripciones') {
    const res = await useApiFetch<{ inscripcionId: string, urlWebpay: string }>(
      `${apiUrl}/online/medios-pago`,
      { method: 'POST', body: retornoPath ? { retornoPath } : {} },
    )
    window.location.href = res.urlWebpay
  }

  async function eliminar(inscripcionId: string) {
    await useApiFetch(`${apiUrl}/online/medios-pago/${inscripcionId}`, { method: 'DELETE' })
    await cargar()
  }

  async function marcarPreferida(inscripcionId: string) {
    await useApiFetch(`${apiUrl}/online/medios-pago/${inscripcionId}/preferida`, { method: 'PATCH' })
    await cargar()
  }

  // Preferida efectiva para checkout/suscripciones: la marcada o la más reciente.
  const preferida = computed(() =>
    tarjetas.value.find((t) => t.preferida) ?? tarjetas.value[0] ?? null,
  )

  onMounted(() => { void cargar() })

  return { tarjetas, preferida, oneclickDisponible, loading, cargar, agregar, eliminar, marcarPreferida }
}
