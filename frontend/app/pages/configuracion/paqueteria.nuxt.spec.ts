// @vitest-environment nuxt
//
// Valores por defecto de Paquetería: el aviso mientras no se guardaron nunca, y que el PUT lleve
// los dos montos como string (el backend rechaza un `number` con 400).
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Paqueteria from './paqueteria.vue'

interface Llamada { url: string, method: string, body?: unknown }

let llamadas: Llamada[] = []
let configurada = true

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (method === 'PUT') {
      return Promise.resolve({ configurada: true, ...(opts!.body as object) })
    }
    return Promise.resolve({
      configurada,
      precioEnvioDefecto: '1500',
      pagoRepartidorDefecto: '900',
    })
  }
})

async function montar() {
  const wrapper = await mountSuspended(Paqueteria)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

describe('configuracion/paqueteria', () => {
  beforeEach(() => {
    llamadas = []
    configurada = true
  })

  it('sin configurar avisa que no se puede escanear, y no lo dice una vez guardada', async () => {
    configurada = false
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Hasta que guardes estos valores no se pueden escanear paquetes nuevos.')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas.some(l => l.method === 'PUT')).toBe(true)
    expect(wrapper.text()).not.toContain('Hasta que guardes')

    wrapper.unmount()
  })

  it('ya configurada no muestra el aviso', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Hasta que guardes')

    wrapper.unmount()
  })

  it('guarda con PUT los dos montos, siempre y como string', async () => {
    const wrapper = await montar()

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    const put = llamadas.find(l => l.method === 'PUT')
    expect(put?.url).toMatch(/\/paquetes\/configuracion$/)
    expect(put?.body).toEqual({ precioEnvioDefecto: '1500', pagoRepartidorDefecto: '900' })

    wrapper.unmount()
  })
})
