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
/** Si no es `null`, `POST /calculo-precios/calcular` se rechaza con esto. */
let calculoFallaCon: unknown = null
/** Cada `POST /online/pagar`: el Pagar no tiene que salir con un cálculo fallido. */
let pagosIniciados = 0

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const ruta = url.split('?')[0] ?? ''

    if (ruta.endsWith('/calculo-precios/calcular') && calculoFallaCon !== null) {
      return Promise.reject(calculoFallaCon)
    }
    if (ruta.endsWith('/online/pagar')) {
      pagosIniciados++
      return Promise.resolve({ modo: 'simulado', checkoutUrl: '/tienda/pasarela' })
    }

    if (ruta.includes('/items')) {
      urlsCatalogo.push(url)
      return Promise.resolve({ data: [], meta: { total: 0, page: 1, pageSize: 48 } })
    }
    // El resto del arranque (unidades de medida) no interviene en este flujo.
    return Promise.resolve([])
  }
})

interface ToastTienda { title?: string, description?: string, color?: string }
let toasts: ToastTienda[] = []
mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: ToastTienda) => {
      toasts.push(t)
    },
  })
})

let montado: { unmount: () => void } | null = null

afterEach(() => {
  montado?.unmount()
  montado = null
  // El carrito de la tienda vive en `useState` y sobrevive al desmontaje: cada
  // test arranca con uno vacío.
  useTiendaCarrito().limpiar()
})

beforeEach(() => {
  urlsCatalogo = []
  calculoFallaCon = null
  pagosIniciados = 0
  toasts = []
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
    expect(urlsCatalogo[0]).toContain('orden=disponibilidad')
  })

  // La tienda no vende productos con número de serie (no hay quien elija la unidad):
  // sin este param el catálogo los ofrecería y el checkout los rechazaría recién
  // al pagar. El backend los excluye; esto es lo único que hace que lo pida.
  it('la consulta de catálogo lleva `vendibleOnline=true`', async () => {
    await montar()

    expect(urlsCatalogo).toHaveLength(1)
    expect(urlsCatalogo[0]).toContain('vendibleOnline=true')
  })
})

describe('tienda/index — Pagar con un cálculo que falla dice por qué', () => {
  // Hasta el 2026-10-08 cualquier fallo de `/calcular` decía "Intentá de nuevo":
  // con un 400 del motor, reintentar da lo mismo.
  const cafe = {
    id: 'item-cafe',
    nombre: 'Café',
    descripcion: null,
    precioBase: '1000',
    monedaId: 'clp',
    monedaSimbolo: '$',
    stock: null,
    stockDisponible: null,
    unidadMedida: 'unidad',
    tipo: 'producto',
    activo: true,
  }

  async function pagarConCalculoQueFalla(error: unknown) {
    calculoFallaCon = error
    const wrapper = await montar()
    wrapper.findComponent({ name: 'VentasCatalogoGrid' }).vm.$emit('add', cafe)
    await new Promise(r => setTimeout(r, 400))
    wrapper.findComponent({ name: 'TiendaCarritoOnline' }).vm.$emit('pagar')
    await new Promise(r => setTimeout(r, 50))
  }

  it('un 400 del motor muestra el motivo del servidor y no inicia el pago', async () => {
    await pagarConCalculoQueFalla(Object.assign(new Error('400'), {
      status: 400,
      data: { statusCode: 400, message: 'La cantidad 99999999999 supera el máximo permitido para la línea 1.' },
    }))

    expect(toasts).toEqual([{
      title: 'No se pudo calcular el total',
      description: 'La cantidad 99999999999 supera el máximo permitido para la línea 1.',
      color: 'error',
    }])
    expect(pagosIniciados).toBe(0)
  })

  it('un corte de red pide reintentar', async () => {
    await pagarConCalculoQueFalla(new Error('[POST] "http://api/calcular": <no response> fetch failed'))

    expect(toasts).toEqual([{ title: 'No se pudo calcular el total. Intentá de nuevo.', color: 'error' }])
    expect(pagosIniciados).toBe(0)
  })
})
