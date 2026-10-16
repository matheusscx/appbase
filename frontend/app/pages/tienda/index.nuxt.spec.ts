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
import { ref } from 'vue'
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

// Sin tienda de monedas cargada `formatOficial` devuelve "—": el monto se formatea en claro.
mockNuxtImport('useCurrency', () => {
  return () => ({
    format: (v: string) => `$${v}`,
    formatCosto: (v: string) => `$${v}`,
    formatOficial: (v: string) => `$${v}`,
  })
})

/** Cada `POST /calculo-precios/calcular`: un carrito recuperado del storage tiene que volver a calcularse. */
let calculos = 0
/** ¿El usuario tiene `Tienda Online:Crear`? */
const puedeCrearTienda = ref(true)
mockNuxtImport('usePermisosCrud', () => {
  return () => ({ puedeCrear: puedeCrearTienda })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const ruta = url.split('?')[0] ?? ''

    if (ruta.endsWith('/calculo-precios/calcular') && calculoFallaCon !== null) {
      return Promise.reject(calculoFallaCon)
    }
    if (ruta.endsWith('/calculo-precios/calcular')) {
      calculos++
      return Promise.resolve({
        lineas: [],
        advertencias: [],
        advertenciasVenta: [],
        totales: { subtotalNeto: '1000.0000', totalDescuentos: '0.0000', totalRecargos: '0.0000', totalImpuestos: '190.0000', totalFinal: '1190.0000' },
      })
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

interface ToastTienda {
  title?: string
  description?: string
  color?: string
  actions?: { label: string, onClick?: () => void }[]
}
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
  calculos = 0
  puedeCrearTienda.value = true
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
  // Hasta el 2026-10-08 cualquier fallo de `/calcular` decía "Intenta de nuevo":
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

    expect(toasts).toEqual([{ title: 'No se pudo calcular el total. Intenta de nuevo.', color: 'error' }])
    expect(pagosIniciados).toBe(0)
  })
})


describe('tienda/index — el carrito se recupera, se deshace y se paga a 768', () => {
  const cafe = {
    id: 'item-cafe', nombre: 'Café', descripcion: null, precioBase: '1000', monedaId: 'clp', monedaSimbolo: '$',
    stock: null, stockDisponible: null, unidadMedida: 'unidad', tipo: 'producto', activo: true,
  }

  // 09.2: tras volver de Webpay el carrito reaparece desde el storage, pero el total del
  // resultado se perdió con la memoria: sin recalcular, "Pagar" mostraría un panel sin totales.
  it('un carrito recuperado se vuelve a calcular al entrar', async () => {
    useTiendaCarrito().add(cafe as never)
    await montar()
    await new Promise(r => setTimeout(r, 50))
    expect(calculos).toBeGreaterThan(0)
  })

  it('quitar una línea avisa con "Deshacer", y Deshacer la devuelve a su lugar (09.10)', async () => {
    const carrito = useTiendaCarrito()
    carrito.add(cafe as never)
    const wrapper = await montar()
    wrapper.findComponent({ name: 'TiendaCarritoOnline' }).vm.$emit('quitar', 0)
    expect(carrito.lineas.value).toHaveLength(0)
    const aviso = toasts.at(-1)!
    expect(aviso.title).toContain('Café')
    expect(aviso.actions?.map(a => a.label)).toEqual(['Deshacer'])
    aviso.actions![0]!.onClick!()
    expect(carrito.lineas.value.map(l => l.item.nombre)).toEqual(['Café'])
  })

  it('sin Tienda Online:Crear, el carrito avisa en vez de dejar fallar al pagar (09.14)', async () => {
    puedeCrearTienda.value = false
    const wrapper = await montar()
    expect(wrapper.findComponent({ name: 'TiendaCarritoOnline' }).props('sinPermiso')).toBe(true)
  })

  it('a menos de 1024 px el total y "Pagar" van en una barra inferior (09.16)', async () => {
    const wrapper = await montar()
    expect(wrapper.find('[data-qa="barra-pagar"]').exists()).toBe(false)
    wrapper.findComponent({ name: 'VentasCatalogoGrid' }).vm.$emit('add', cafe)
    await new Promise(r => setTimeout(r, 400))
    const barra = wrapper.find('[data-qa="barra-pagar"]')
    expect(barra.exists()).toBe(true)
    expect(barra.classes()).toContain('lg:hidden')
    expect(barra.text()).toContain('$1190.0000')
    await barra.findAll('button').find(b => b.text() === 'Pagar')!.trigger('click')
    await new Promise(r => setTimeout(r, 50))
    expect(pagosIniciados).toBe(1)
  })

  it('la barra inferior no deja pagar sin permiso', async () => {
    puedeCrearTienda.value = false
    const wrapper = await montar()
    wrapper.findComponent({ name: 'VentasCatalogoGrid' }).vm.$emit('add', cafe)
    await new Promise(r => setTimeout(r, 400))
    const pagar = wrapper.find('[data-qa="barra-pagar"]').findAll('button').find(b => b.text() === 'Pagar')!
    expect(pagar.attributes('disabled')).toBeDefined()
  })
})
