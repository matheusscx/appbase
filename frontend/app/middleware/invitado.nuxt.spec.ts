// @vitest-environment nuxt
//
// Auditoría UX 08.21: con la sesión abierta, /login, /register y /forgot-password
// no muestran el formulario: llevan al inicio. Y /no-tenant no se abre sin sesión.
//
// ⚠️ Solo cuenta una sesión COMPLETA (token con empresa). Un token sin empresa es
// justo lo que deja `handlePostLogin` cuando falla el switch: el middleware `auth`
// manda a /login para que se vea el aviso, y si el invitado lo devolviera al inicio
// se armaría un lazo (login → inicio → login).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useAuthStore } from '~/stores/auth'
import invitado from './invitado'

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateTo)

function jwt(payload: object): string {
  return `x.${btoa(JSON.stringify(payload))}.y`
}

const ruta = (path: string) => ({ path }) as Parameters<typeof invitado>[0]

describe('middleware/invitado', () => {
  beforeEach(() => {
    navigateTo.mockClear()
    useAuthStore().clearAuth()
  })

  it('sin sesión deja ver el formulario', () => {
    expect(invitado(ruta('/login'), ruta('/'))).toBeUndefined()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('con sesión y empresa lleva al inicio', () => {
    useAuthStore().setToken(jwt({ tenant_id: 't1', es_superadmin: false }))
    invitado(ruta('/login'), ruta('/'))
    expect(navigateTo).toHaveBeenCalledWith('/')
  })

  it('con un token sin empresa NO rebota: ahí vive el aviso de "no pudimos entrar"', () => {
    useAuthStore().setToken(jwt({ tenant_id: null, es_superadmin: false }))
    invitado(ruta('/login'), ruta('/'))
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('las rutas lo declaran: login, registro y recuperar piden invitado; sin-empresa pide sesión', () => {
    const rutas = useRouter().getRoutes()
    const middlewareDe = (path: string) => [rutas.find(r => r.path === path)?.meta.middleware].flat()
    for (const p of ['/login', '/register', '/forgot-password']) {
      expect(middlewareDe(p), p).toContain('invitado')
    }
    expect(middlewareDe('/no-tenant')).toContain('auth')
  })
})
