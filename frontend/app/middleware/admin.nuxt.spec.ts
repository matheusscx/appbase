// @vitest-environment nuxt
//
// Lote 7 (07.22): el rebote de las pantallas de administración avisa por qué. Antes devolvía a
// Perfil sin decir nada, mientras el middleware `permiso` sí avisa. La lógica de quién pasa está en
// `admin.spec.ts`; acá solo el aviso, que necesita `useToast` real (mismo motivo que `permiso.nuxt.spec.ts`).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useToast } from '#imports'
import adminMiddleware from './admin'

let esAdmin = false
let error: string | null = null

const { ensureCargado, navigateTo } = vi.hoisted(() => ({
  ensureCargado: vi.fn(),
  navigateTo: vi.fn(),
}))

mockNuxtImport('usePermissionsStore', () => () => ({
  get esAdmin() { return esAdmin },
  get error() { return error },
  ensureCargado,
}))
mockNuxtImport('navigateTo', () => navigateTo)

function avisos() {
  return useToast().toasts.value.map(t => t.title)
}

describe('middleware/admin — el aviso del rebote', () => {
  beforeEach(async () => {
    esAdmin = false
    error = null
    navigateTo.mockClear()
    ensureCargado.mockResolvedValue(undefined)
    useToast().clear()
    await new Promise(r => setTimeout(r, 0))
  })

  it('al que no es admin lo manda a Configuración y le dice por qué', async () => {
    await adminMiddleware({} as never, {} as never)

    expect(navigateTo).toHaveBeenCalledWith('/configuracion')
    expect(avisos()).toContain('Esa pantalla es solo para administradores')
  })

  it('al admin lo deja pasar sin aviso', async () => {
    esAdmin = true
    await adminMiddleware({} as never, {} as never)

    expect(navigateTo).not.toHaveBeenCalled()
    expect(avisos()).toEqual([])
  })

  it('si los permisos no cargaron no rebota ni avisa', async () => {
    error = 'sin red'
    await adminMiddleware({} as never, {} as never)

    expect(navigateTo).not.toHaveBeenCalled()
    expect(avisos()).toEqual([])
  })
})
