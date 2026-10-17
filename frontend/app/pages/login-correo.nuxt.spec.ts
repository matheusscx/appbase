// @vitest-environment nuxt
//
// 08.3: quien acaba de elegir su contraseña llega al login con el correo ya puesto. El correo
// viaja en el `state` de la navegación, no en la URL: un dato personal en el query string queda
// en el historial, en los logs y en el Referer. Entrar sigue exigiendo la contraseña.
import { describe, it, expect, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Login from './login.vue'

afterEach(() => { window.history.replaceState({}, '') })

describe('login — correo que llega con la navegación (08.3)', () => {
  it('lo deja escrito en el campo', async () => {
    window.history.replaceState({ email: 'ana@tulocal.cl' }, '')
    const login = await mountSuspended(Login, { route: '/login' })
    const campo = login.find('input[name="email"]').element as HTMLInputElement
    expect(campo.value).toBe('ana@tulocal.cl')
  })

  it('un ?email= en la URL no se usa', async () => {
    const login = await mountSuspended(Login, { route: '/login?email=ana@tulocal.cl' })
    const campo = login.find('input[name="email"]').element as HTMLInputElement
    expect(campo.value).toBe('')
  })

  it('sin correo, el campo parte vacío', async () => {
    const login = await mountSuspended(Login, { route: '/login' })
    const campo = login.find('input[name="email"]').element as HTMLInputElement
    expect(campo.value).toBe('')
  })
})
