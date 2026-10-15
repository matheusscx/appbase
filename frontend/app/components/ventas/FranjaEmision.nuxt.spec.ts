// @vitest-environment nuxt
//
// La franja de avisos de la boleta electrónica contra un `useApiFetch` simulado. Ese mock contesta
// 200 siempre: la forma real de `GET /dte/estado-emision` la fija el e2e de la API.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import FranjaEmision from './FranjaEmision.vue'

let estadoMock: Record<string, unknown> = {}

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (url.endsWith('/dte/estado-emision')) return Promise.resolve(structuredClone(estadoMock))
    return Promise.resolve({})
  }
})

async function montar() {
  const wrapper = await mountSuspended(FranjaEmision)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

beforeEach(() => {
  estadoMock = { activa: true, avisos: [], sinEmitir: 0, conProblemas: 0 }
})

describe('FranjaEmision', () => {
  it('con una boleta con problemas dice "Hay 1 boleta con problemas en el SII: avisa al encargado"', async () => {
    estadoMock = { activa: true, avisos: [], sinEmitir: 0, conProblemas: 1 }

    const wrapper = await montar()

    expect(wrapper.find('[data-qa="aviso-emision-CON_PROBLEMAS"]').text())
      .toBe('Hay 1 boleta con problemas en el SII: avisa al encargado')
    wrapper.unmount()
  })

  it('con varias lo dice en plural', async () => {
    estadoMock = { activa: true, avisos: [], sinEmitir: 0, conProblemas: 3 }

    const wrapper = await montar()

    expect(wrapper.find('[data-qa="aviso-emision-CON_PROBLEMAS"]').text())
      .toBe('Hay 3 boletas con problemas en el SII: avisa al encargado')
    wrapper.unmount()
  })

  it('con 0 no pinta el aviso', async () => {
    const wrapper = await montar()

    expect(wrapper.find('[data-qa="aviso-emision-CON_PROBLEMAS"]').exists()).toBe(false)
    expect(wrapper.find('[data-qa="franja-emision"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('con la emisión apagada no pinta nada, aunque el campo venga', async () => {
    estadoMock = { activa: false, avisos: [], sinEmitir: 0, conProblemas: 4 }

    const wrapper = await montar()

    expect(wrapper.find('[data-qa="franja-emision"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('un backend viejo que no manda el campo no pinta el aviso y no rompe', async () => {
    estadoMock = { activa: true, avisos: [], sinEmitir: 2 }

    const wrapper = await montar()

    expect(wrapper.find('[data-qa="aviso-emision-CON_PROBLEMAS"]').exists()).toBe(false)
    expect(wrapper.find('[data-qa="aviso-emision-SIN_EMITIR"]').text())
      .toBe('Hay 2 boletas sin emitir: avisa al encargado')
    wrapper.unmount()
  })

  it('el aviso de problemas va después del de sin emitir', async () => {
    estadoMock = { activa: true, avisos: [], sinEmitir: 1, conProblemas: 1 }

    const wrapper = await montar()

    const claves = wrapper.findAll('[data-qa^="aviso-emision-"]').map(a => a.attributes('data-qa'))
    expect(claves).toEqual(['aviso-emision-SIN_EMITIR', 'aviso-emision-CON_PROBLEMAS'])
    wrapper.unmount()
  })
})
