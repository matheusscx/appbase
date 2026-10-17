// @vitest-environment nuxt
//
// 09.24: quien no es superadmin y escribe `/admin` volvía a Inicio sin decir nada, y se ve como "la
// pantalla se rompió". Mismo criterio que los middlewares `admin` y `permiso`. La lógica de quién
// pasa está en `auth.spec.ts`; acá el aviso, que necesita `useToast` real.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useToast } from '#imports'
import authMiddleware from './auth'

const { navigateTo, estado } = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  estado: { esSuperadmin: false },
}))

mockNuxtImport('navigateTo', () => navigateTo)
// Mismo motivo que `auth-pantallas.nuxt.spec.ts`: el plugin de color-mode rechaza sin manejar en este entorno.
mockNuxtImport('useUserPreferences', () => () => ({ applyColorModeFromServer: () => {} }))
mockNuxtImport('useAuthStore', () => () => ({
  token: ref('t'),
  user: ref({ id: 'u1' }),
  activeTenantId: ref('tenant-1'),
  isSuperadmin: ref(estado.esSuperadmin),
}))

const avisos = () => useToast().toasts.value.map(t => t.title)
const aRuta = (path: string) => ({ path }) as never

describe('middleware/auth — /admin sin ser superadmin', () => {
  beforeEach(async () => {
    estado.esSuperadmin = false
    navigateTo.mockClear()
    useToast().clear()
    await new Promise(r => setTimeout(r, 0))
  })

  it('lo manda a Inicio y le dice por qué', async () => {
    await authMiddleware(aRuta('/admin'), aRuta('/'))
    expect(navigateTo).toHaveBeenCalledWith('/')
    expect(avisos()).toContain('Esa pantalla es solo para el equipo de Venka')
  })

  it('el superadmin pasa sin aviso', async () => {
    estado.esSuperadmin = true
    await authMiddleware(aRuta('/admin'), aRuta('/'))
    expect(navigateTo).not.toHaveBeenCalled()
    expect(avisos()).toEqual([])
  })
})
