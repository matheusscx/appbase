// @vitest-environment nuxt
//
// Lote 7 (09.4, 09.23): la administración de suscripciones distingue "no hay", "tu filtro no encontró"
// y "no se pudo leer"; y busca por cliente.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Suscripciones from './suscripciones.vue'

const base = {
  frecuencia: 'semanal', precio: '10000', monedaId: null, proximoCobro: '2026-11-01', activaHasta: null,
  diaSemana: 1, diaMes: null, itemId: 'i1',
}
const ANA = { ...base, id: 's1', usuarioId: 'u1', usuarioNombre: 'Ana Pérez', usuarioEmail: 'ana@x.cl', itemNombre: 'Café', estado: 'activa' }
const BETO = { ...base, id: 's2', usuarioId: 'u2', usuarioNombre: 'Beto Soto', usuarioEmail: 'beto@x.cl', itemNombre: 'Pan', estado: 'activa' }

let respuesta: () => Promise<unknown> = () => Promise.resolve([ANA, BETO])
let pedidos = 0

mockNuxtImport('useApiFetch', () => () => {
  pedidos++
  return respuesta()
})
mockNuxtImport('usePermissionsStore', () => () => ({ esAdmin: false, can: () => true }))

async function montar() {
  const w = await mountSuspended(Suscripciones)
  await new Promise(r => setTimeout(r, 30))
  return w
}

beforeEach(() => {
  pedidos = 0
  respuesta = () => Promise.resolve([ANA, BETO])
})

describe('suscripciones (admin) — lectura fallida', () => {
  it('con un 500 dice que no pudo cargar y Reintentar vuelve a pedir', async () => {
    respuesta = () => Promise.reject({ status: 500 })
    const w = await montar()
    expect(w.text()).not.toContain('No hay suscripciones para mostrar')
    expect(w.text()).toContain('No pudimos cargar las suscripciones')

    respuesta = () => Promise.resolve([ANA])
    await w.find('[data-qa="estado-reintentar"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    expect(w.text()).toContain('Ana Pérez')
    w.unmount()
  })

  it('con un 403 dice "Sin acceso"', async () => {
    respuesta = () => Promise.reject({ status: 403 })
    const w = await montar()
    expect(w.text()).toContain('Sin acceso a las suscripciones.')
    w.unmount()
  })
})

describe('suscripciones (admin) — vacío, filtro y búsqueda', () => {
  it('sin ninguna suscripción dice "No hay suscripciones para mostrar."', async () => {
    respuesta = () => Promise.resolve([])
    const w = await montar()
    expect(w.text()).toContain('No hay suscripciones para mostrar.')
    w.unmount()
  })

  it('con el filtro "Canceladas" y ninguna cancelada nombra el filtro, no dice que no hay ninguna', async () => {
    const w = await montar()
    w.findComponent({ name: 'USelectMenu' }).vm.$emit('update:modelValue', 'cancelada')
    await new Promise(r => setTimeout(r, 20))

    expect(w.text()).not.toContain('No hay suscripciones para mostrar.')
    expect(w.text()).toContain('No hay suscripciones canceladas.')
    w.unmount()
  })

  it('buscar por cliente filtra por nombre o correo', async () => {
    const w = await montar()
    await w.find('input[data-qa="suscripciones-busqueda"]').setValue('beto@')
    await new Promise(r => setTimeout(r, 20))

    expect(w.text()).toContain('Beto Soto')
    expect(w.text()).not.toContain('Ana Pérez')
    w.unmount()
  })

  it('una búsqueda sin resultado nombra lo buscado y se puede quitar', async () => {
    const w = await montar()
    await w.find('input[data-qa="suscripciones-busqueda"]').setValue('zzzz')
    await new Promise(r => setTimeout(r, 20))
    expect(w.text()).toContain('No encontramos «zzzz».')

    await w.find('[data-qa="estado-quitar-filtros"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(w.text()).toContain('Ana Pérez')
    w.unmount()
  })
})
