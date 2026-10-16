// @vitest-environment nuxt
//
// Mensajes de error de "Nuevo rol" (auditoría UX 07.10 y 07.2): crear con el
// nombre vacío ya no es un botón que no hace nada, sino un error junto al
// campo; y el rechazo del servidor sale en español, no con el texto crudo del
// validador.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Roles from './index.vue'

let llamadas: { method: string, url: string, body?: Record<string, unknown> }[] = []
let rechazo: unknown = null
let avisos: { title: string }[] = []

mockNuxtImport('useToast', () => () => ({ add: (t: { title: string }) => avisos.push(t) }))

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ method, url, body: opts?.body })
    if (method === 'POST' && url.endsWith('/roles')) {
      return rechazo ? Promise.reject(rechazo) : Promise.resolve({ id: 'r1', nombre: 'Cajero', descripcion: null, esFijo: false, esSistema: false })
    }
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Roles, {
    attachTo: document.body,
    global: {
      stubs: {
        AppDrawer: {
          name: 'AppDrawer',
          props: ['open'],
          template: '<div v-if="open" role="dialog"><slot name="header" /><slot name="body" /><slot name="actions" /></div>',
        },
      },
    },
  })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

async function abrirNuevo(wrapper: Awaited<ReturnType<typeof montar>>) {
  await wrapper.findAll('button').find(b => b.text().includes('Nuevo rol'))!.trigger('click')
  await new Promise(r => setTimeout(r, 30))
}

async function crear(wrapper: Awaited<ReturnType<typeof montar>>) {
  await wrapper.findAll('button').find(b => b.text().trim() === 'Crear')!.trigger('click')
  await new Promise(r => setTimeout(r, 30))
}

describe('roles — Nuevo rol', () => {
  beforeEach(() => {
    llamadas = []
    avisos = []
    rechazo = null
  })

  it('Crear con el nombre vacío marca el campo y no manda nada', async () => {
    const wrapper = await montar()
    await abrirNuevo(wrapper)
    await crear(wrapper)

    expect(llamadas.some(l => l.method === 'POST')).toBe(false)
    expect(wrapper.findAll('[data-slot="error"]').map(e => e.text())).toEqual(['Escribe un nombre para el rol'])
    wrapper.unmount()
  })

  it('al escribir el nombre, el error se va', async () => {
    const wrapper = await montar()
    await abrirNuevo(wrapper)
    await crear(wrapper)
    await wrapper.find('input[placeholder="Ej: Cajero"]').setValue('Cajero')

    expect(wrapper.find('[data-slot="error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('un rechazo del validador sale en español y marca el nombre', async () => {
    rechazo = { data: { message: ['nombre must be longer than or equal to 3 characters'] } }
    const wrapper = await montar()
    await abrirNuevo(wrapper)
    await wrapper.find('input[placeholder="Ej: Cajero"]').setValue('Ca')
    await crear(wrapper)

    expect(avisos.map(a => a.title)).toEqual(['Nombre: mínimo 3 caracteres'])
    expect(wrapper.find('[data-slot="error"]').text()).toBe('Mínimo 3 caracteres')
    wrapper.unmount()
  })
})

// Lote 4 (07.1): una descripción larga empujaba lápiz y basurero fuera de la tarjeta.
describe('roles — forma de la tabla', () => {
  it('la descripción se acota y las acciones quedan fijas a la derecha', async () => {
    const wrapper = await montar()
    const th = wrapper.findAll('th').find(t => t.text() === 'Descripción')
    expect(th?.classes()).toContain('max-w-xs')
    expect(th?.classes()).toContain('truncate')
    expect(wrapper.findAll('th[data-pinned="right"]')).toHaveLength(1)
  })
})
