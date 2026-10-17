// @vitest-environment nuxt
//
// 08.26: "Las contraseñas no coinciden" no sale mientras se teclea la repetición
// desde la primera letra, sino al salir del campo o cuando la repetición ya
// tiene el largo de la primera.
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Invitacion from './[token].vue'

const { estado } = vi.hoisted(() => ({
  estado: {
    path: '/invitacion/tk',
    consulta: (): Promise<unknown> => Promise.resolve({ correo: 'ana@tulocal.cl', tenant: 'Almacén Los Andes' }),
  },
}))

mockNuxtImport('useRoute', () => () => ({ path: estado.path, params: { token: 'tk' } }))
mockNuxtImport('$fetch', () => () => estado.consulta())
const { irA } = vi.hoisted(() => ({ irA: vi.fn() }))
mockNuxtImport('navigateTo', () => irA)

async function montar() {
  const wrapper = await mountSuspended(Invitacion)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

beforeEach(() => {
  irA.mockClear()
  estado.path = '/invitacion/tk'
  estado.consulta = () => Promise.resolve({ correo: 'ana@tulocal.cl', tenant: 'Almacén Los Andes' })
})

const NO_COINCIDEN = 'Las contraseñas no coinciden.'

describe('invitación — aviso de contraseñas distintas', () => {
  it('no sale mientras la repetición va más corta que la contraseña', async () => {
    const wrapper = await montar()
    const [clave, repetir] = wrapper.findAll('input')
    await clave!.setValue('clave-segura-1')
    await repetir!.setValue('clave-seg')

    expect(wrapper.text()).not.toContain(NO_COINCIDEN)
  })

  it('sale cuando la repetición ya tiene el largo de la contraseña y es distinta', async () => {
    const wrapper = await montar()
    const [clave, repetir] = wrapper.findAll('input')
    await clave!.setValue('clave-segura-1')
    await repetir!.setValue('clave-segura-2')

    expect(wrapper.text()).toContain(NO_COINCIDEN)
  })

  it('sale al salir del campo aunque la repetición quede corta', async () => {
    const wrapper = await montar()
    const [clave, repetir] = wrapper.findAll('input')
    await clave!.setValue('clave-segura-1')
    await repetir!.setValue('clave-seg')
    await repetir!.trigger('blur')

    expect(wrapper.text()).toContain(NO_COINCIDEN)
  })

  it('no sale si coinciden', async () => {
    const wrapper = await montar()
    const [clave, repetir] = wrapper.findAll('input')
    await clave!.setValue('clave-segura-1')
    await repetir!.setValue('clave-segura-1')
    await repetir!.trigger('blur')

    expect(wrapper.text()).not.toContain(NO_COINCIDEN)
  })
})

// Auditoría UX 08.3, 08.6, 08.9, 08.20.
describe('invitación — qué dice y qué ofrece', () => {
  it('dice a qué empresa suman a la persona (08.6)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Te sumaron a Almacén Los Andes con ana@tulocal.cl')
  })

  it('si no llega la empresa, no inventa una (08.6)', async () => {
    estado.consulta = () => Promise.resolve({ correo: 'ana@tulocal.cl', tenant: null })
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Te sumaron a un equipo con ana@tulocal.cl')
  })

  it('el botón dice lo que pasa: guarda la contraseña, no "entra" (08.3)', async () => {
    const wrapper = await montar()
    const boton = wrapper.find('button[type="submit"]')
    expect(boton.text()).toBe('Guardar contraseña')
  })

  it('las dos contraseñas llevan ojo con nombre y autocompletado de contraseña nueva (08.9, 08.20)', async () => {
    const wrapper = await montar()
    expect(wrapper.findAll('button[aria-label="Mostrar contraseña"]')).toHaveLength(2)
    for (const input of wrapper.findAll('input')) {
      expect(input.attributes('autocomplete')).toBe('new-password')
    }
  })

  it('los campos y el botón miden 44 px (08.8)', async () => {
    const wrapper = await montar()
    for (const input of wrapper.findAll('input')) expect(input.classes()).toContain('min-h-11')
    expect(wrapper.find('button[type="submit"]').classes()).toContain('min-h-11')
  })

  it('invitación vencida: el motivo no repite el título y manda a pedirle a quien invitó (08.4, 08.23)', async () => {
    estado.consulta = () => Promise.reject({ data: { message: 'Puede estar vencido o ya usado.' } })
    const wrapper = await montar()
    expect(wrapper.find('h1').text()).toBe('Este link ya no sirve')
    const texto = wrapper.text()
    expect(texto.match(/ya no sirve/gi)).toHaveLength(1)
    expect(texto).toContain('Puede estar vencido o ya usado.')
    expect(texto).toContain('Pídele a quien te invitó que te envíe uno nuevo')
  })

  it('recuperar vencido: ofrece pedir otro link (08.4)', async () => {
    estado.path = '/recuperar/tk'
    estado.consulta = () => Promise.reject({ data: { message: 'Puede estar vencido o ya usado.' } })
    const wrapper = await montar()
    const pedir = wrapper.findAll('a').find(a => a.text() === 'Pedir otro link')
    expect(pedir?.attributes('href')).toBe('/forgot-password')
    expect(wrapper.text()).not.toContain('quien te invitó')
  })
})

describe('invitación — al guardar, el login ya trae el correo (08.3)', () => {
  it('lleva al login con el correo de la invitación, para que solo falte la contraseña', async () => {
    const wrapper = await montar()
    const campos = wrapper.findAll('input[type="password"]')
    await campos[0]!.setValue('claveNueva123')
    await campos[1]!.setValue('claveNueva123')
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))
    expect(irA).toHaveBeenCalledWith({ path: '/login', state: { email: 'ana@tulocal.cl' } })
  })
})
