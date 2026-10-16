// @vitest-environment nuxt
//
// Repartidores: alta y edición (lo que viaja en el body y que la respuesta se mergea sin refetch),
// el interruptor de activo con revert, y que borrar a uno con hojas de ruta deje el modal abierto
// con la explicación del backend en vez de cerrarse sin decir nada.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Repartidores from './repartidores.vue'

const MENSAJE_HOJAS = 'El repartidor tiene hojas de ruta: desactivalo en vez de eliminarlo.'

let repartidoresBackend: { id: string, nombre: string, telefono: string | null, activo: boolean }[] = []
let fallaPatch = false
let fallaDelete = false
let llamadas: { url: string, method: string, body?: Record<string, unknown> }[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (method === 'POST') {
      return Promise.resolve({ id: 'r-3', activo: true, ...opts!.body })
    }
    if (method === 'PATCH') {
      if (fallaPatch) return Promise.reject({ data: { message: 'No se pudo actualizar' } })
      const base = repartidoresBackend.find(r => url.endsWith(`/${r.id}`))
      return Promise.resolve({ ...base, ...opts!.body })
    }
    if (method === 'DELETE') {
      if (fallaDelete) return Promise.reject({ data: { message: MENSAJE_HOJAS } })
      const id = url.split('/').pop()
      repartidoresBackend = repartidoresBackend.filter(r => r.id !== id)
      return Promise.resolve(undefined)
    }
    return Promise.resolve(repartidoresBackend.map(r => ({ ...r })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Repartidores)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

/** El modal de confirmación lo teletransporta `UModal` fuera del wrapper. */
async function confirmarEnModal(texto: string) {
  const boton = [...document.body.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === texto)
  expect(boton, `botón "${texto}" en el modal`).toBeTruthy()
  boton!.click()
  await new Promise(r => setTimeout(r, 50))
}

describe('configuracion/repartidores', () => {
  beforeEach(() => {
    repartidoresBackend = [
      // Ya ordenados por nombre, como los entrega el backend (`ORDER BY nombre`).
      { id: 'r-2', nombre: 'Ana Soto', telefono: null, activo: false },
      { id: 'r-1', nombre: 'Juan Pérez', telefono: '+56 9 1111 2222', activo: true },
    ]
    fallaPatch = false
    fallaDelete = false
    llamadas = []
  })

  describe('alta y edición', () => {
    // `AppDrawer` stubeado y `attachTo`, por lo mismo que en `impuestos.nuxt.spec.ts`: el drawer
    // real revienta al cerrarse bajo happy-dom, y el submit por `form="…"` lo resuelve el documento.
    async function montarConDrawerStub() {
      const wrapper = await mountSuspended(Repartidores, {
        attachTo: document.body,
        global: {
          stubs: {
            AppDrawer: {
              name: 'AppDrawer',
              props: ['open'],
              template: `
                <div v-if="open" role="dialog">
                  <slot name="header" />
                  <slot name="body" />
                  <slot name="actions" />
                </div>
              `,
            },
          },
        },
      })
      await new Promise(r => setTimeout(r, 0))
      return wrapper
    }

    const cuerpo = (metodo: string) => llamadas.find(l => l.method === metodo)?.body

    it('vaciar el teléfono al editar manda `telefono: null`, no una cadena vacía', async () => {
      const wrapper = await montarConDrawerStub()

      // Juan es la segunda fila (el backend ordena por nombre).
      await wrapper.findAll('[title="Editar"]')[1]!.trigger('click')
      await new Promise(r => setTimeout(r, 0))
      expect((wrapper.find('input[type="tel"]').element as HTMLInputElement).value).toBe('+56 9 1111 2222')
      await wrapper.find('input[type="tel"]').setValue('')
      await wrapper.find('form#repartidor-form').trigger('submit')
      await new Promise(r => setTimeout(r, 30))

      const patch = llamadas.find(l => l.method === 'PATCH')
      expect(patch?.url).toMatch(/\/repartidores\/r-1$/)
      expect(patch?.body).toEqual({ nombre: 'Juan Pérez', telefono: null })
      expect(wrapper.text()).toContain('Sin teléfono')

      wrapper.unmount()
    })

    it('crear manda { nombre, telefono } recortados y suma la fila ordenada sin volver a pedir la lista', async () => {
      const wrapper = await montarConDrawerStub()
      expect(llamadas.filter(l => l.method === 'GET')).toHaveLength(1)

      await wrapper.findAll('button').find(b => b.text() === 'Nuevo repartidor')!.trigger('click')
      await new Promise(r => setTimeout(r, 0))
      await wrapper.find('input[placeholder="Juan Pérez"]').setValue('  Beto Rojas ')
      await wrapper.find('input[type="tel"]').setValue(' +56 9 3333 4444 ')
      await wrapper.find('form#repartidor-form').trigger('submit')
      await new Promise(r => setTimeout(r, 30))

      const post = llamadas.find(l => l.method === 'POST')
      expect(post?.url).toMatch(/\/repartidores$/)
      expect(post?.body).toEqual({ nombre: 'Beto Rojas', telefono: '+56 9 3333 4444' })
      // Sin segundo GET: la respuesta del POST se mergea en la lista.
      expect(llamadas.filter(l => l.method === 'GET')).toHaveLength(1)
      const texto = wrapper.text()
      expect(texto).toContain('Beto Rojas')
      expect(texto.indexOf('Ana Soto')).toBeLessThan(texto.indexOf('Beto Rojas'))
      expect(texto.indexOf('Beto Rojas')).toBeLessThan(texto.indexOf('Juan Pérez'))

      wrapper.unmount()
    })

    it('crear sin teléfono manda `telefono: null`', async () => {
      const wrapper = await montarConDrawerStub()

      await wrapper.findAll('button').find(b => b.text() === 'Nuevo repartidor')!.trigger('click')
      await new Promise(r => setTimeout(r, 0))
      await wrapper.find('input[placeholder="Juan Pérez"]').setValue('Beto Rojas')
      await wrapper.find('form#repartidor-form').trigger('submit')
      await new Promise(r => setTimeout(r, 30))

      expect(cuerpo('POST')).toEqual({ nombre: 'Beto Rojas', telefono: null })

      wrapper.unmount()
    })
  })

  it('el interruptor manda { activo } con el valor nuevo, en los dos sentidos', async () => {
    const wrapper = await montar()

    await wrapper.find('button[aria-label="Activo: Juan Pérez"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    await wrapper.find('button[aria-label="Activo: Ana Soto"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    const patches = llamadas.filter(l => l.method === 'PATCH')
    expect(patches.map(p => [p.url.split('/').pop(), p.body])).toEqual([
      ['r-1', { activo: false }],
      ['r-2', { activo: true }],
    ])

    wrapper.unmount()
  })

  it('lista los repartidores con su teléfono o la falta de él', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Juan Pérez')
    expect(wrapper.text()).toContain('+56 9 1111 2222')
    expect(wrapper.text()).toContain('Ana Soto')
    expect(wrapper.text()).toContain('Sin teléfono')

    wrapper.unmount()
  })

  it('el interruptor cambia al instante y se revierte si el servidor rechaza', async () => {
    fallaPatch = true
    const wrapper = await montar()
    const interruptor = () => wrapper.find('button[aria-label="Activo: Juan Pérez"]')
    expect(interruptor().attributes('aria-checked')).toBe('true')

    await interruptor().trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(interruptor().attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })

  it('el interruptor se queda donde quedó si el servidor acepta', async () => {
    const wrapper = await montar()
    const interruptor = () => wrapper.find('button[aria-label="Activo: Juan Pérez"]')

    await interruptor().trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(interruptor().attributes('aria-checked')).toBe('false')

    wrapper.unmount()
  })

  it('eliminar uno con hojas de ruta deja el modal abierto con el motivo, y la fila sigue', async () => {
    fallaDelete = true
    const wrapper = await montar()

    await wrapper.findAll('[title="Eliminar"]')[0]!.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva: el modal sigue abierto y dice por qué; recién después, que la fila siga.
    expect(document.body.textContent).toContain(MENSAJE_HOJAS)
    expect(wrapper.text()).toContain('Ana Soto')
    expect(wrapper.text()).toContain('Juan Pérez')

    wrapper.unmount()
  })

  it('eliminar uno sin hojas lo saca de la lista', async () => {
    const wrapper = await montar()

    await wrapper.findAll('[title="Eliminar"]')[0]!.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // El primero de la lista es Ana Soto.
    expect(repartidoresBackend.map(r => r.nombre)).toEqual(['Juan Pérez'])
    expect(wrapper.text()).not.toContain('Ana Soto')
    expect(wrapper.text()).toContain('Juan Pérez')

    wrapper.unmount()
  })
})
