// @vitest-environment nuxt
//
// 08.26: "Las contraseñas no coinciden" no sale mientras se teclea la repetición
// desde la primera letra, sino al salir del campo o cuando la repetición ya
// tiene el largo de la primera.
import { describe, it, expect } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Invitacion from './[token].vue'

mockNuxtImport('useRoute', () => () => ({ path: '/invitacion/tk', params: { token: 'tk' } }))
mockNuxtImport('$fetch', () => () => Promise.resolve({ correo: 'ana@tulocal.cl' }))

async function montar() {
  const wrapper = await mountSuspended(Invitacion)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

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
