// @vitest-environment nuxt
//
// Primer spec de `pages/tienda/index.vue`. Cubre UNA cosa: el catálogo del
// carrito online pide solo lo vendible. Hasta 2026-08-09 la pantalla traía
// todo y descartaba los pausados con un `.filter(i => i.activo)` en el
// cliente — no era equivalente, porque el pausado igual ocupaba uno de los
// 100 lugares pedidos. Ahora el filtro va en la query (`activo=true`), y esto
// es lo único que lo sostiene del lado del cliente: borrar el param de la URL
// no rompe ninguna otra cosa, así que sin este test se puede borrar con la
// suite entera en verde.
//
// El molde es `salones/index.nuxt.spec.ts` § "el catálogo pide solo ítems
// vendibles" — mismo mock de `useApiFetch` capturando la URL COMPLETA (con
// query string), mismo motivo: si el mock cortara en el `?`, `activo=true`
// sería invisible para el test.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import TiendaIndex from './index.vue'

/**
 * Las URLs COMPLETAS pedidas al catálogo, con query string. Igual que en
 * `salones/index.nuxt.spec.ts`: cortar en el `?` haría invisible el filtro
 * que este spec existe para sostener.
 */
let urlsCatalogo: string[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const ruta = url.split('?')[0] ?? ''

    if (ruta.includes('/items')) {
      urlsCatalogo.push(url)
      return Promise.resolve({ data: [], meta: { total: 0, page: 1, pageSize: 100 } })
    }
    // El resto del arranque (unidades de medida) no interviene en este flujo.
    return Promise.resolve([])
  }
})

let montado: { unmount: () => void } | null = null

afterEach(() => {
  montado?.unmount()
  montado = null
})

beforeEach(() => {
  urlsCatalogo = []
})

async function montar() {
  const wrapper = await mountSuspended(TiendaIndex)
  montado = wrapper
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

describe('tienda/index — el catálogo pide solo ítems vendibles', () => {
  it('la consulta de catálogo lleva `activo=true`', async () => {
    await montar()

    expect(urlsCatalogo).toHaveLength(1)
    expect(urlsCatalogo[0]).toContain('activo=true')
    expect(urlsCatalogo[0]).toContain('tipo=producto')
  })
})
