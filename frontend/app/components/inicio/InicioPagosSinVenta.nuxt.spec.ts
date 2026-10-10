// @vitest-environment nuxt
//
// Bloque "Pagos sin venta" de la zona "Ahora": el aviso al admin de que la
// tienda online cobró y no registró la venta (pendientes.md § 3, D). Se monta
// sobre `pages/index.vue` porque el gateo por permiso vive ahí. Fija:
//   1. Sin `Pasarelas: Leer` no se pide la ruta; con el permiso, sí, sin ser
//      admin. El guard real es el del listado (`backend/test/tienda-dos-ahoras`).
//   2. Con `meta.total` 0 dice que no hay nada; con > 0, el número.
//   3. La tarjeta lleva al listado filtrado.
//   4. Un 403 (tenant sin el módulo) lo oculta sin aviso de error.
//
// El body simulado tiene la forma real del listado paginado (`data` + `meta`):
// el mock de `useApiFetch` contesta 200 a lo que sea.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Index from '~/pages/index.vue'

let permisos: string[] = []
let esAdmin = false
let llamadas: string[] = []
let falla403 = false
let total = 0

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve(null)
    llamadas.push(url)
    if (url.includes('/pasarela/admin/ordenes')) {
      return falla403
        ? Promise.reject({ response: { status: 403 } })
        : Promise.resolve({ data: [], meta: { page: 1, pageSize: 1, total, totalPages: total } })
    }
    return Promise.resolve(null)
  }
})

const RUTA = '/pasarela/admin/ordenes?sinVenta=true&pageSize=1'

async function montar() {
  const wrapper = await mountSuspended(Index)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

beforeEach(() => {
  permisos = []
  esAdmin = false
  llamadas = []
  falla403 = false
  total = 0
})

describe('bloque "Pagos sin venta" del inicio', () => {
  it('sin "Pasarelas: Leer" no pide la ruta', async () => {
    permisos = ['Inventario:Leer']
    const wrapper = await montar()

    expect(llamadas.some(u => u.includes('/pasarela/admin/ordenes'))).toBe(false)
    expect(wrapper.find('[data-qa="pagos-sin-venta-resumen"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('con "Pasarelas: Leer", sin ser admin, la pide filtrada a las sin venta', async () => {
    permisos = ['Pasarelas:Leer']
    const wrapper = await montar()

    expect(llamadas.filter(u => u.endsWith(RUTA))).toHaveLength(1)

    wrapper.unmount()
  })

  it('con total 0 dice que no hay ninguna', async () => {
    permisos = ['Pasarelas:Leer']
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Ningún pago online sin venta.')
    expect(wrapper.find('[data-qa="pagos-sin-venta-total"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('con total > 0 muestra el número y lleva al listado filtrado', async () => {
    permisos = ['Pasarelas:Leer']
    total = 3
    const wrapper = await montar()

    expect(wrapper.find('[data-qa="pagos-sin-venta-total"]').text()).toContain('3')
    expect(wrapper.text()).not.toContain('Ningún pago online sin venta.')
    const hrefs = wrapper.findAll('a').map(a => a.attributes('href'))
    expect(hrefs).toContain('/ordenes?sinVenta=true')

    wrapper.unmount()
  })

  it('un 403 lo oculta sin aviso de error', async () => {
    esAdmin = true
    falla403 = true
    const wrapper = await montar()

    expect(llamadas.some(u => u.includes('/pasarela/admin/ordenes'))).toBe(true)
    expect(wrapper.text()).not.toContain('Pagos sin venta')
    expect(wrapper.text()).not.toContain('Sin conexión')

    wrapper.unmount()
  })
})
