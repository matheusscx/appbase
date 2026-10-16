// @vitest-environment nuxt
//
// 08.2: en Mi cuenta, el nombre vacío se marca junto al campo (el campo lleva
// asterisco), y un rechazo del servidor sale en español.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import PerfilForm from './PerfilForm.vue'

let enviados: unknown[] = []
let rechazo: unknown = null
let avisos: { title: string }[] = []

mockNuxtImport('useToast', () => () => ({ add: (t: { title: string }) => avisos.push(t) }))
// El plugin de color-mode no tiene su helper en este entorno y rechaza sin manejar.
mockNuxtImport('useUserPreferences', () => () => ({ applyColorModeFromServer: () => {} }))

let nombreInicial = ''
mockNuxtImport('useAuthStore', () => () => ({
  user: { nombre: nombreInicial, apellido: '', telefono: '', correo: 'ana@x.cl' },
  updateUser: () => {},
}))
mockNuxtImport('useApiFetch', () => (_url: string, opts?: { body?: unknown }) => {
  enviados.push(opts?.body)
  return rechazo ? Promise.reject(rechazo) : Promise.resolve({ nombre: 'Ana', apellido: null, telefono: null })
})

async function montar(nombre = '') {
  nombreInicial = nombre
  return await mountSuspended(PerfilForm)
}

describe('PerfilForm', () => {
  beforeEach(() => {
    enviados = []
    avisos = []
    rechazo = null
  })

  it('nombre vacío: lo marca junto al campo y no manda nada', async () => {
    const wrapper = await montar('')
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(0)
    expect(wrapper.find('[data-slot="error"]').text()).toBe('Escribe tu nombre')
  })

  it('un rechazo del validador sale en español', async () => {
    rechazo = { data: { message: ['nombre should not be empty'] } }
    const wrapper = await montar('Ana')
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(avisos.map(a => a.title)).toEqual(['Nombre: es obligatorio'])
    expect(wrapper.find('[data-slot="error"]').text()).toBe('Es obligatorio')
  })
})
