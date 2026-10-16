// @vitest-environment nuxt
//
// Lote 7 (06.10): `/compras/nueva` sin permiso para crear, o una compra que no carga, dejaban la
// pantalla en blanco (solo el título) y un toast que se iba. Ahora dicen por qué y ofrecen salida.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Compra from './[id].vue'

let routeId = 'nueva'
let permisos: string[] = []
let falloCompra: { status: number } | null = null
let pedidosCompra = 0

mockNuxtImport('usePermissionsStore', () => () => ({
  get esAdmin() { return false },
  can: (m: string, a: string) => permisos.includes(`${m}:${a}`),
  permisos,
  loading: false,
  ensureCargado: () => Promise.resolve(),
}))
mockNuxtImport('useRoute', () => () => ({ params: { id: routeId }, query: {} }))
mockNuxtImport('onBeforeRouteLeave', () => () => {})

mockNuxtImport('useApiFetch', () => (url: string) => {
  if (typeof url !== 'string') return Promise.resolve([])
  if (/\/compras\/[0-9a-f-]{3,}$/.test(url) && !url.endsWith('/proveedores') && !url.includes('tipos-documento')) {
    pedidosCompra++
    if (falloCompra) return Promise.reject(falloCompra)
  }
  return Promise.resolve([])
})

async function montar() {
  const w = await mountSuspended(Compra)
  await new Promise(r => setTimeout(r, 30))
  return w
}

beforeEach(() => {
  routeId = 'nueva'
  permisos = []
  falloCompra = null
  pedidosCompra = 0
})

describe('compras/[id] — estados que antes eran una página en blanco', () => {
  it('sin Compras:Crear, /compras/nueva dice que no tiene permiso y vuelve a Compras', async () => {
    permisos = ['Compras:Leer']
    const w = await montar()

    expect(w.text()).toContain('No tienes permiso para registrar compras')
    const volver = w.find('[data-qa="compra-sin-permiso-volver"]')
    expect(volver.exists()).toBe(true)
    expect(volver.attributes('href')).toBe('/compras')
    expect(w.find('#compra-form').exists()).toBe(false)
    w.unmount()
  })

  it('con Compras:Crear, /compras/nueva muestra el formulario', async () => {
    permisos = ['Compras:Leer', 'Compras:Crear']
    const w = await montar()

    expect(w.text()).not.toContain('No tienes permiso para registrar compras')
    expect(w.find('#compra-form').exists()).toBe(true)
    w.unmount()
  })

  it('una compra que no existe (404) lo dice y ofrece volver; no queda en blanco', async () => {
    routeId = '0a1b2c3d-0000-0000-0000-000000000000'
    permisos = ['Compras:Leer']
    falloCompra = { status: 404 }
    const w = await montar()

    expect(w.text()).toContain('No encontramos esta compra')
    expect(w.find('[data-qa="compra-no-existe-volver"]').attributes('href')).toBe('/compras')
    w.unmount()
  })

  it('una compra que falla al cargar (500) ofrece Reintentar, que vuelve a pedirla solo al tocarlo', async () => {
    routeId = '0a1b2c3d-0000-0000-0000-000000000000'
    permisos = ['Compras:Leer']
    falloCompra = { status: 500 }
    const w = await montar()
    expect(w.text()).toContain('No pudimos cargar esta compra')
    expect(pedidosCompra).toBe(1)

    await w.find('[data-qa="estado-reintentar"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    expect(pedidosCompra).toBe(2)
    w.unmount()
  })

  it('un 403 dice "Sin acceso"', async () => {
    routeId = '0a1b2c3d-0000-0000-0000-000000000000'
    permisos = ['Compras:Leer']
    falloCompra = { status: 403 }
    const w = await montar()
    expect(w.text()).toContain('Sin acceso a esta compra. Pídele al administrador que te lo habilite.')
    w.unmount()
  })
})
