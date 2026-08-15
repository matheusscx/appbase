// @vitest-environment nuxt
//
// Primer spec de `pages/ventas/pos.vue`. Cubre UNA cosa: el catálogo del POS
// pide solo lo vendible. Hasta 2026-08-09 la pantalla traía todo y descartaba
// los pausados con un `.filter(i => i.activo)` en el cliente — no era
// equivalente, porque el pausado igual ocupaba uno de los 100 lugares
// pedidos. Ahora el filtro va en la query (`activo=true`), y esto es lo único
// que lo sostiene del lado del cliente: borrar el param de la URL no rompe
// ninguna otra cosa, así que sin este test se puede borrar con la suite
// entera en verde.
//
// El molde es `salones/index.nuxt.spec.ts` § "el catálogo pide solo ítems
// vendibles" — mismo mock de `useApiFetch` capturando la URL COMPLETA (con
// query string), mismo motivo: si el mock cortara en el `?`, `activo=true`
// sería invisible para el test. El arnés acá es más grande porque el POS
// arranca caja, unidades de medida, emisor y propina en paralelo
// (`onMounted`): el resto de esas rutas cae en el catch-all porque ninguna
// interviene en lo que este spec afirma.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Pos from './pos.vue'

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

    if (ruta.endsWith('/caja/activa')) {
      // Sin caja abierta: la pantalla igual dispara `cargar()` en paralelo
      // (`Promise.all` de `onMounted`), así que el catálogo se pide de todos
      // modos — es justo lo que este spec necesita.
      return Promise.resolve(null)
    }
    if (ruta.includes('/items')) {
      urlsCatalogo.push(url)
      return Promise.resolve({ data: [], meta: { total: 0, page: 1, pageSize: 100 } })
    }
    // El resto del arranque (métodos de pago, tipos de documento, unidades de
    // medida, razones sociales del emisor, propina sugerida) no interviene en
    // este flujo.
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
  const wrapper = await mountSuspended(Pos)
  montado = wrapper
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

describe('ventas/pos — el catálogo pide solo ítems vendibles', () => {
  it('las tres consultas de catálogo llevan `activo=true`', async () => {
    await montar()

    // Producto, receta y combo: las tres, no "alguna".
    expect(urlsCatalogo).toHaveLength(3)
    for (const url of urlsCatalogo) {
      expect(url).toContain('activo=true')
    }
    expect(urlsCatalogo.map(u => u.match(/tipo=(\w+)/)?.[1]).sort()).toEqual([
      'combo',
      'producto',
      'receta',
    ])
  })
})
