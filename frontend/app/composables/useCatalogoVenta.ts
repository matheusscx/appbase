import type { ItemCatalogo } from '~/composables/useVenta'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

/** 48 entra parejo en la grilla de 2 y de 3 columnas (`CatalogoGrid.vue`). */
export const PAGE_SIZE_CATALOGO = 48
const ESPERA_BUSQUEDA_MS = 300

/**
 * La grilla de venta (POS, salón, tienda), paginada y buscada en el servidor:
 * spec docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md § 4. El
 * orden también lo pone el servidor (`orden=disponibilidad`); acá no se ordena
 * ni se filtra nada.
 */
export function useCatalogoVenta(opts: {
  tipos: Array<'producto' | 'receta' | 'combo'>
  /**
   * Query extra fijo por pantalla, que se suma al pedido de cada página. Hoy ninguna pantalla
   * lo usa: queda reservado para que la tienda pase el filtro que va a agregar el frente de
   * números de serie. Ese filtro tiene que vivir en `buildFindAllFilters` (backend) para que
   * lo vean los dos caminos de `findAll`.
   */
  filtros?: Record<string, string>
  /** Cada carga que falla, ya descartadas las respuestas viejas. Sin esto, en silencio (salón). */
  onError?: (e: unknown) => void
}) {
  const apiUrl = useRuntimeConfig().public.apiUrl
  const items = ref<ItemCatalogo[]>([])
  const total = ref(0)
  const page = ref(1)
  const busqueda = ref('')
  const loading = ref(false)
  let terminoActivo = ''
  // Descarta la respuesta que llega tarde (mismo criterio que tenía el salón con `secuenciaItems`).
  let turno = 0
  let espera: ReturnType<typeof setTimeout> | null = null

  async function refrescar() {
    const mio = ++turno
    const params = new URLSearchParams({
      ...opts.filtros,
      tipo: opts.tipos.join(','),
      activo: 'true',
      orden: 'disponibilidad',
      page: String(page.value),
      pageSize: String(PAGE_SIZE_CATALOGO),
    })
    if (terminoActivo) params.set('search', terminoActivo)
    try {
      const res = await useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?${params}`)
      if (mio !== turno) return
      const ultima = Math.max(1, Math.ceil(res.meta.total / PAGE_SIZE_CATALOGO))
      if (page.value > ultima) {
        page.value = ultima // el watch de `page` vuelve a pedir
        return
      }
      items.value = res.data
      total.value = res.meta.total
    }
    catch (e: unknown) {
      // Lo que ya estaba en pantalla se queda: un corte de wifi no vacía la grilla a mitad de servicio.
      if (mio === turno) opts.onError?.(e)
    }
  }

  async function cargar() {
    loading.value = true
    try { await refrescar() }
    finally { loading.value = false }
  }

  watch(busqueda, (q) => {
    if (espera) clearTimeout(espera)
    espera = setTimeout(() => {
      espera = null
      terminoActivo = q.trim()
      if (page.value !== 1) page.value = 1
      else void refrescar()
    }, ESPERA_BUSQUEDA_MS)
  })
  watch(page, () => { void refrescar() })
  onBeforeUnmount(() => { if (espera) clearTimeout(espera) })

  return { items, total, page, busqueda, loading, pageSize: PAGE_SIZE_CATALOGO, cargar, refrescar }
}
