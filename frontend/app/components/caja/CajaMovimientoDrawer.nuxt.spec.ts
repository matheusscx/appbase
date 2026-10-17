// @vitest-environment nuxt
//
// Auditoría UX 03.25: el selector Entrada/Salida eran dos botones sueltos; el
// elegido solo se distinguía por el relleno y el lector de pantalla no lo anunciaba.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaMovimientoDrawer from './CajaMovimientoDrawer.vue'

const AppDrawer = {
  name: 'AppDrawer',
  props: ['open'],
  template: '<div v-if="open"><slot name="body" /></div>',
}

// Auditoría UX 03.28: los conceptos que arma el admin son atajos del campo Concepto.
let conceptos: { id: string, nombre: string, tipo: string, activo: boolean }[] = []
let falla = false
let urlPedida = ''

mockNuxtImport('useApiFetch', () => (url: string) => {
  urlPedida = url
  if (falla) return Promise.reject(new Error('sin red'))
  return Promise.resolve(conceptos.map(c => ({ ...c })))
})

beforeEach(() => {
  falla = false
  urlPedida = ''
  conceptos = [
    { id: '1', nombre: 'Compra de insumos', tipo: 'salida', activo: true },
    { id: '2', nombre: 'Aporte de fondo', tipo: 'entrada', activo: true },
    { id: '3', nombre: 'Cambio', tipo: 'ambos', activo: true },
  ]
})

const esperar = () => new Promise(r => setTimeout(r, 20))

async function montar() {
  return mountSuspended(CajaMovimientoDrawer, {
    props: { cajaId: 'c1', open: true },
    global: { stubs: { AppDrawer } },
  })
}

describe('CajaMovimientoDrawer — Entrada y Salida', () => {
  it('anuncia cuál está elegido', async () => {
    const w = await montar()
    const entrada = w.findAll('button').find(b => b.text() === 'Entrada')!
    const salida = w.findAll('button').find(b => b.text() === 'Salida')!
    expect(entrada.attributes('aria-pressed')).toBe('true')
    expect(salida.attributes('aria-pressed')).toBe('false')

    await salida.trigger('click')
    expect(entrada.attributes('aria-pressed')).toBe('false')
    expect(salida.attributes('aria-pressed')).toBe('true')
  })
})

describe('CajaMovimientoDrawer — conceptos rápidos', () => {
  const chips = (w: Awaited<ReturnType<typeof montar>>) =>
    w.findAll('[data-testid="concepto-atajo"]').map(b => b.text())

  it('pide solo los conceptos activos y ofrece los de entrada y los de ambos', async () => {
    const w = await montar()
    await esperar()
    expect(urlPedida).toContain('/conceptos-movimiento-caja?soloActivas=true')
    expect(chips(w)).toEqual(['Aporte de fondo', 'Cambio'])
  })

  it('al pasar a Salida cambia a los de salida y los de ambos', async () => {
    const w = await montar()
    await esperar()
    await w.findAll('button').find(b => b.text() === 'Salida')!.trigger('click')
    expect(chips(w)).toEqual(['Compra de insumos', 'Cambio'])
  })

  it('tocar un atajo rellena el concepto, y el campo sigue siendo texto libre', async () => {
    const w = await montar()
    await esperar()
    await w.findAll('[data-testid="concepto-atajo"]')[1]!.trigger('click')
    const input = w.find('input[placeholder="Descripción del movimiento"]')
    expect((input.element as HTMLInputElement).value).toBe('Cambio')
    await input.setValue('Propina al repartidor')
    expect((input.element as HTMLInputElement).value).toBe('Propina al repartidor')
  })

  it('sin conceptos, o si la lectura falla, no dibuja atajos y el campo funciona igual', async () => {
    conceptos = []
    let w = await montar()
    await esperar()
    expect(chips(w)).toEqual([])
    falla = true
    w = await montar()
    await esperar()
    expect(chips(w)).toEqual([])
    expect(w.find('input[placeholder="Descripción del movimiento"]').exists()).toBe(true)
  })
})
