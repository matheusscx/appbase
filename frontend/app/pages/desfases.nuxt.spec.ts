// @vitest-environment nuxt
//
// Lote 7 (04.18): si `/desfases` falla, la bandeja no puede decir "Sin costos desfasados" —el dueño
// concluiría que todo está al día cuando en verdad no se pudo consultar.
import { describe, it, expect, beforeEach } from 'vitest'
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

async function montar() {
  const w = await mountSuspended(Desfases)
  await new Promise(r => setTimeout(r, 20))
  return w
}

beforeEach(() => { pedidos = 0, status = 500 })

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
