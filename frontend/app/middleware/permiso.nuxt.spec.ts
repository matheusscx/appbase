// @vitest-environment nuxt
//
// Entorno `nuxt`, a diferencia de `admin.spec.ts`: acá el aviso al usuario es
// parte del contrato —la pantalla lo daba antes de rebotar y no se puede perder
// en la mudanza—, y `useToast` fuera de un componente solo funciona de verdad
// con el `useState` compartido de Nuxt. Mockearlo probaría el mock.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useToast } from '#imports'
import permisoMiddleware from './permiso'

let esAdmin = false
let permisos: string[] = []
let error: string | null = null

// `vi.hoisted`: las factories de `mockNuxtImport` se izan sobre el archivo, así
// que un `const` normal cae en su zona muerta temporal al registrarse el mock.
const { ensureCargado, navigateTo } = vi.hoisted(() => ({
  ensureCargado: vi.fn(),
  navigateTo: vi.fn(),
}))

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    get error() { return error },
    ensureCargado,
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

mockNuxtImport('navigateTo', () => navigateTo)

/** Sirve una ruta con el `meta` que la página declara. */
function ruta(meta: Record<string, unknown>) {
  return { meta, path: '/cajas' } as never
}

async function correr(meta: Record<string, unknown>) {
  return permisoMiddleware(ruta(meta), ruta({}))
}

function avisos() {
  return useToast().toasts.value.map(t => t.title)
}

describe('middleware/permiso', () => {
  beforeEach(async () => {
    esAdmin = false
    permisos = []
    error = null
    navigateTo.mockClear()
    ensureCargado.mockClear()
    ensureCargado.mockResolvedValue(undefined)
    useToast().clear()
    await new Promise(r => setTimeout(r, 0))
  })

  it('deja pasar a quien tiene el permiso', async () => {
    permisos = ['Cajas:Leer']

    await correr({ permiso: 'Cajas:Leer' })

    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('rebota a /ventas a quien no lo tiene, avisando por qué', async () => {
    permisos = ['MiCaja:Leer']

    await correr({ permiso: 'Cajas:Leer' })
    await new Promise(r => setTimeout(r, 10))

    expect(navigateTo).toHaveBeenCalledWith('/ventas')
    expect(avisos()).toContain('No tenés acceso al módulo Cajas')
  })

  it('usa `permisoLabel` cuando el módulo se llama distinto en pantalla', async () => {
    // `MiCaja` es el nombre en la BD; en pantalla siempre se leyó "Mi caja".
    await correr({ permiso: 'MiCaja:Leer', permisoLabel: 'Mi caja' })
    await new Promise(r => setTimeout(r, 10))

    expect(avisos()).toContain('No tenés acceso al módulo Mi caja')
  })

  it('el admin del tenant pasa sin el permiso listado', async () => {
    esAdmin = true

    await correr({ permiso: 'Cajas:Leer' })

    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('distingue el permiso: `Cajas:Leer` no habilita `MiCaja:Leer`', async () => {
    permisos = ['Cajas:Leer']

    await correr({ permiso: 'MiCaja:Leer' })

    expect(navigateTo).toHaveBeenCalledWith('/ventas')
  })

  it('espera la carga de permisos ANTES de decidir', async () => {
    // El guard viejo hacía `fetchPermisos()` solo si `!loading`: con un fetch en
    // vuelo evaluaba el store vacío y echaba a un usuario legítimo.
    ensureCargado.mockImplementation(async () => {
      permisos = ['Cajas:Leer']
    })

    await correr({ permiso: 'Cajas:Leer' })

    expect(ensureCargado).toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('si los permisos NO se pudieron cargar, deja pasar en vez de expulsar', async () => {
    // Mismo criterio que el middleware `admin`: el candado real es el backend, y
    // expulsar ante la duda se ve como "a veces me tira al índice".
    error = 'Error al cargar permisos'

    await correr({ permiso: 'Cajas:Leer' })

    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('sin `permiso` en el meta no toca la navegación', async () => {
    // El middleware se registra por página, pero si alguien lo suma sin declarar
    // el permiso no puede rebotar a todo el mundo.
    await correr({})

    expect(ensureCargado).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })
})
