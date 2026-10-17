// @vitest-environment nuxt
//
// 08.7: se quita "Mantener sesión iniciada" (no hacía nada; la sesión no cambia).
// 08.25: "Continuar con Google" solo aparece si el servidor lo tiene configurado.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Login from './login.vue'

const { estado } = vi.hoisted(() => ({
  estado: { proveedores: (): Promise<unknown> => Promise.resolve({ google: false }) },
}))

mockNuxtImport('$fetch', () => (url: string) =>
  url.includes('/auth/proveedores') ? estado.proveedores() : Promise.resolve({}))

async function montar() {
  const login = await mountSuspended(Login, { route: '/login' })
  await new Promise(r => setTimeout(r, 20))
  return login
}

beforeEach(() => {
  estado.proveedores = () => Promise.resolve({ google: false })
})

describe('login — sin casilla de sesión (08.7)', () => {
  it('no ofrece "Mantener sesión iniciada"', async () => {
    const login = await montar()
    expect(login.text()).not.toContain('Mantener sesión')
    expect(login.find('input[type="checkbox"]').exists()).toBe(false)
  })
})

describe('login — Google solo si el servidor lo tiene (08.25)', () => {
  it('sin Google configurado no hay botón ni separador', async () => {
    const login = await montar()
    expect(login.text()).not.toContain('Continuar con Google')
  })

  it('con Google configurado aparece', async () => {
    estado.proveedores = () => Promise.resolve({ google: true })
    const login = await montar()
    expect(login.text()).toContain('Continuar con Google')
  })

  it('si la consulta falla, el botón no aparece', async () => {
    estado.proveedores = () => Promise.reject(new Error('red'))
    const login = await montar()
    expect(login.text()).not.toContain('Continuar con Google')
  })
})
