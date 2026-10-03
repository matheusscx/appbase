import type { PaginatedResponse } from '~/composables/usePaginatedList'

export interface FiltrosItems {
  tipo?: string[]
  activo?: boolean
  modoInventario?: 'cantidad' | 'lote' | 'serie'
}

const TAMANO_BUSQUEDA = 20
/** Tope de `pageSize` del backend: una tanda de `ids=` cabe entera en una página. */
const TANDA_IDS = 100

/**
 * Caché de ítems por id para las pantallas que ya no tienen el catálogo entero en memoria
 * (spec docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md § 5): `buscar` llena
 * la caché con lo que devuelve el servidor; `resolver` trae por `ids=` solo lo que falta.
 *
 * `ruta`: una lista propia de otro módulo con el mismo contrato (`search`, `ids`, página),
 * como `/compras/productos`, que no exige permiso sobre el catálogo de ítems
 * (docs/patterns/backend.md § 19). ⚠️ Los `filtros` (`tipo`, `activo`, `modoInventario`) son
 * parámetros de `/items`: con otra ruta no se pasan, y si se pasan el backend responde 400.
 */
export function useItemsPorId<T extends { id: string, nombre: string }>(ruta = '/items') {
  const apiUrl = useRuntimeConfig().public.apiUrl
  // El cast: `reactive` desenvuelve refs sobre `T` genérico y `set(id, item)` dejaría de compilar.
  const porId = reactive(new Map<string, T>()) as Map<string, T>

  function registrar(item: T) {
    porId.set(item.id, item)
  }

  async function buscar(termino: string, filtros: FiltrosItems): Promise<T[]> {
    const params = new URLSearchParams({ pageSize: String(TAMANO_BUSQUEDA) })
    if (termino) params.set('search', termino)
    if (filtros.tipo?.length) params.set('tipo', filtros.tipo.join(','))
    if (filtros.activo !== undefined) params.set('activo', String(filtros.activo))
    if (filtros.modoInventario) params.set('modoInventario', filtros.modoInventario)
    const res = await useApiFetch<PaginatedResponse<T>>(`${apiUrl}${ruta}?${params}`)
    res.data.forEach(registrar)
    return res.data
  }

  async function resolver(ids: string[]): Promise<void> {
    const faltan = [...new Set(ids)].filter(id => !porId.has(id))
    for (let i = 0; i < faltan.length; i += TANDA_IDS) {
      const params = new URLSearchParams({
        ids: faltan.slice(i, i + TANDA_IDS).join(','),
        pageSize: String(TANDA_IDS),
      })
      const res = await useApiFetch<PaginatedResponse<T>>(`${apiUrl}${ruta}?${params}`)
      res.data.forEach(registrar)
    }
  }

  return { porId, buscar, resolver, registrar }
}

/** Lo que recibe `AppItemSelect` en su prop `catalogo`. */
export type ItemsPorId<T extends { id: string, nombre: string }> = ReturnType<typeof useItemsPorId<T>>
