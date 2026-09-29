// @vitest-environment nuxt
//
// Cada pantalla pública muestra SU error. El login y el registro pintaban el
// mismo `authStore.error` y nada lo limpiaba al cambiar de pantalla: una clave
// mala en el login abría el registro diciendo "Credenciales inválidas", y un
// registro rechazado dejaba su aviso esperando en el login (2026-09-27).
//
// El login no se puede limpiar al montar: es la pantalla adonde el callback de
// Google, el middleware `auth` y `handlePostLogin` mandan el aviso de "no
// pudimos entrar a tu empresa". El último test fija que ese aviso sigue llegando.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useAuthStore } from '~/stores/auth'
import Login from './login.vue'
import Register from './register.vue'

/**
 * Lo que contesta `$fetch`, por ruta. Por ruta y no con `mockResolvedValueOnce`:
 * montar la página ya pide `/auth/refresh`, y ese pedido se comía la respuesta
 * preparada para el login.
 */
let respuestas: Record<string, () => Promise<unknown>> = {}
let myTenantsFalla = false

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (url.includes('/auth/my-tenants') && myTenantsFalla) {
      return Promise.reject({ data: { message: 'boom' } })
    }
    return Promise.resolve([])
  }
})

// El login bueno del último test pone un usuario, y `color-mode-sync.client.ts`
// le aplica su modo de color: el plugin de color-mode no tiene su helper en
// este entorno y rechaza sin manejar, lo que tumba `npm test` con todo verde.
// El color no es lo que se prueba acá.
mockNuxtImport('useUserPreferences', () => {
  return () => ({ applyColorModeFromServer: () => {} })
})

type LoginVm ={ state: { email: string, password: string }, onLogin: () => Promise<void> }
type RegisterVm = { state: { nombre: string, correo: string, password: string }, onRegister: () => Promise<void> }

async function loginCon(email: string, password: string) {
  const login = await mountSuspended(Login)
  const vm = login.vm as unknown as LoginVm
  vm.state.email = email
  vm.state.password = password
  await vm.onLogin()
  await login.vm.$nextTick()
  return login
}

async function registrarCon(nombre: string, correo: string, password: string) {
  const registro = await mountSuspended(Register)
  const vm = registro.vm as unknown as RegisterVm
  vm.state.nombre = nombre
  vm.state.correo = correo
  vm.state.password = password
  await vm.onRegister()
  await registro.vm.$nextTick()
  return registro
}

describe('login y registro — cada uno con su aviso de error', () => {
  beforeEach(() => {
    respuestas = {}
    vi.stubGlobal('$fetch', (url: string) => {
      const ruta = Object.keys(respuestas).find(r => url.endsWith(r))
      return ruta ? respuestas[ruta]!() : Promise.reject(new Error(`sin respuesta para ${url}`))
    })
    myTenantsFalla = false
    // El store vive entre tests del archivo: sin esto, el login bueno del
    // último dejaría token y usuario puestos para el que se agregue después.
    useAuthStore().clearAuth()
    useAuthStore().error = null
  })

  it('una clave mala en el login no aparece al abrir el registro', async () => {
    respuestas['/auth/login'] = () => Promise.reject({ data: { message: 'Credenciales inválidas' } })
    const login = await loginCon('a@b.com', 'mala')
    // Control: el login sí lo muestra. Sin esto el test pasaría por un login
    // que no llegó a fallar.
    expect(login.text()).toContain('Credenciales inválidas')
    login.unmount()

    const registro = await mountSuspended(Register)
    expect(registro.text()).not.toContain('Credenciales inválidas')
  })

  it('un registro rechazado no aparece al volver al login', async () => {
    respuestas['/auth/register'] = () => Promise.reject({ data: { message: 'El correo no es válido' } })
    const registro = await registrarCon('Ana', 'a@b.com', 'secreta')
    expect(registro.text()).toContain('El correo no es válido')
    registro.unmount()

    const login = await mountSuspended(Login)
    expect(login.text()).not.toContain('El correo no es válido')
  })

  it('el registro limpia su aviso al volver a enviar', async () => {
    respuestas['/auth/register'] = () => Promise.reject({ data: { message: 'El correo no es válido' } })
    const registro = await registrarCon('Ana', 'a@b.com', 'secreta')
    expect(registro.text()).toContain('El correo no es válido')

    respuestas['/auth/register'] = () => Promise.resolve({ message: 'Si ese correo no tenía cuenta, te llega un link.' })
    await (registro.vm as unknown as RegisterVm).onRegister()
    await registro.vm.$nextTick()
    expect(registro.text()).not.toContain('El correo no es válido')
    expect(registro.text()).toContain('te llega un link')
  })

  it('el aviso de "no pudimos entrar a tu empresa" sigue llegando al login', async () => {
    respuestas['/auth/login'] = () => Promise.resolve({ access_token: 'x.e30.x', user: { id: 'u1' } })
    myTenantsFalla = true
    await loginCon('a@b.com', 'buena')

    // El callback y el middleware navegan al login para que se vea: el login
    // que monta después tiene que mostrarlo, no limpiarlo.
    const login = await mountSuspended(Login)
    expect(login.text()).toContain('No pudimos entrar a tu empresa')
  })
})
