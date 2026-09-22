// @vitest-environment nuxt
//
// Bloque "Stock bajo" de la zona "Ahora" (`docs/features/aviso-stock-bajo.md`).
// Se monta sobre `pages/index.vue` porque el gateo por permiso vive ahí. Fija:
//   1. Sin `Inventario: Leer` no se pide la ruta; con el permiso, una vez al
//      montar (la cadencia del refresco es de `useRefrescoPeriodico`, que tiene
//      su propio spec con timers falsos).
//   2. Con `total: 0` dice que no hay nada; con `total > 0`, el número y las
//      filas por ubicación que manda el backend — nunca más de las que manda.
//   3. Un 403 lo oculta sin aviso de error, igual que `InicioCajas`.
//
// El body simulado tiene la forma real de `InventarioService.resumenStockBajo`:
// el mock de `useApiFetch` contesta 200 a lo que sea.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Index from '~/pages/index.vue'

let permisos: string[] = []
let esAdmin = false
let llamadas: string[] = []
let falla403 = false
let resumen: unknown = null

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
    if (url.includes('/inventario/stock-bajo/resumen')) {
      return falla403
        ? Promise.reject({ response: { status: 403 } })
        : Promise.resolve(resumen)
    }
    return Promise.resolve(null)
  }
})

const RUTA = '/inventario/stock-bajo/resumen'

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
  resumen = { total: 0, porUbicacion: [] }
})

describe('bloque "Stock bajo" del inicio', () => {
  it('sin "Inventario: Leer" no pide la ruta', async () => {
    permisos = ['Cajas:Leer']
    const wrapper = await montar()

    expect(llamadas.some(u => u.includes(RUTA))).toBe(false)
    expect(wrapper.find('[data-qa="stock-bajo-resumen"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('con "Inventario: Leer" la pide una vez al montar', async () => {
    permisos = ['Inventario:Leer']
    const wrapper = await montar()

    expect(llamadas.filter(u => u.includes(RUTA))).toHaveLength(1)

    wrapper.unmount()
  })

  it('con total 0 dice que no hay nada bajo el mínimo', async () => {
    permisos = ['Inventario:Leer']
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Nada bajo el mínimo')
    expect(wrapper.find('[data-qa="stock-bajo-total"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('con total > 0 muestra el número y una fila por ubicación de la respuesta', async () => {
    permisos = ['Inventario:Leer']
    // Total mayor que la suma de las filas: el backend cuenta todas las
    // ubicaciones y solo detalla las 4 más afectadas.
    resumen = {
      total: 40,
      porUbicacion: [
        { ubicacionId: 'u1', ubicacionNombre: 'Barra', cantidad: 12 },
        { ubicacionId: 'u2', ubicacionNombre: 'Bodega centro', cantidad: 9 },
        { ubicacionId: 'u3', ubicacionNombre: 'Cocina', cantidad: 7 },
        { ubicacionId: 'u4', ubicacionNombre: 'Terraza', cantidad: 5 },
      ],
    }
    const wrapper = await montar()

    expect(wrapper.find('[data-qa="stock-bajo-total"]').text()).toContain('40')
    const filas = wrapper.findAll('[data-qa="stock-bajo-ubicacion"]')
    expect(filas).toHaveLength(4)
    expect(filas[0]!.text()).toContain('Barra')
    expect(filas[0]!.text()).toContain('12')
    expect(wrapper.text()).not.toContain('Nada bajo el mínimo')

    wrapper.unmount()
  })

  it('la tarjeta lleva a la lista completa, filtrada a lo que está abajo', async () => {
    permisos = ['Inventario:Leer']
    const wrapper = await montar()

    const hrefs = wrapper.findAll('a').map(a => a.attributes('href'))
    expect(hrefs).toContain('/inventario/stock-minimo?soloBajoMinimo=true')

    wrapper.unmount()
  })

  it('un 403 lo oculta sin aviso de error', async () => {
    esAdmin = true
    falla403 = true
    const wrapper = await montar()

    expect(llamadas.some(u => u.includes(RUTA))).toBe(true)
    expect(wrapper.text()).not.toContain('Stock bajo')
    expect(wrapper.text()).not.toContain('Sin conexión')

    wrapper.unmount()
  })
})
