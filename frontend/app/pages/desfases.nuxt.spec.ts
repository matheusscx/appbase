// @vitest-environment nuxt
//
// Lote 7 (04.18): si `/desfases` falla, la bandeja no puede decir "Sin costos desfasados" —el dueño
// concluiría que todo está al día cuando en verdad no se pudo consultar.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Desfases from './desfases.vue'

let pedidos = 0
let status: number | null = 500

mockNuxtImport('useApiFetch', () => () => {
  pedidos++
  return status ? Promise.reject({ status }) : Promise.resolve([])
})

mockNuxtImport('usePermissionsStore', () => () => ({
  esAdmin: false,
  can: () => true,
}))

const irA = vi.fn()
mockNuxtImport('navigateTo', () => (destino: string) => { irA(destino) })

async function montar() {
  const w = await mountSuspended(Desfases)
  await new Promise(r => setTimeout(r, 20))
  return w
}

beforeEach(() => { pedidos = 0, status = 500, irA.mockClear() })

describe('pages/desfases — lectura fallida', () => {
  it('con un 500 no dice "Sin costos desfasados" y ofrece Reintentar', async () => {
    const w = await montar()
    expect(w.text()).not.toContain('Sin costos desfasados.')
    expect(w.text()).toContain('No pudimos cargar los costos desfasados')
    w.unmount()
  })

  it('Reintentar la vuelve a pedir una vez; si sale bien, dice "Sin costos desfasados."', async () => {
    const w = await montar()
    expect(pedidos).toBe(1)
    status = null
    await w.find('[data-qa="estado-reintentar"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(pedidos).toBe(2)
    expect(w.text()).toContain('Sin costos desfasados.')
    w.unmount()
  })

  it('con un 403 dice "Sin acceso"', async () => {
    status = 403
    const w = await montar()
    expect(w.text()).toContain('Sin acceso a los costos desfasados.')
    w.unmount()
  })
})

describe('pages/desfases — "Después" (04.17)', () => {
  it('lleva a Inicio: en la página no hay nada que cerrar', async () => {
    status = null
    const w = await montar()
    const despues = w.findAll('button').find(b => b.text().includes('Después'))
    expect(despues, 'botón "Después"').toBeTruthy()
    await despues!.trigger('click')
    expect(irA).toHaveBeenCalledWith('/')
    w.unmount()
  })
})
