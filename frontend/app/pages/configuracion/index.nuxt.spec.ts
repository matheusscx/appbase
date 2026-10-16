// @vitest-environment nuxt
//
// Auditoría UX 07.34 (owner, 2026-10-16): Configuración abre en un índice por grupo, con una frase
// por pantalla, y solo muestra las pantallas a las que la persona llega.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Indice from './index.vue'
import Perfil from './perfil.vue'

let esAdmin = false
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => () => ({
  get esAdmin() { return esAdmin },
  get permisos() { return permisos },
  get loading() { return false },
  fetchPermisos: () => Promise.resolve(),
  can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
}))

beforeEach(() => {
  esAdmin = false
  permisos = []
})

describe('/configuracion — índice', () => {
  it('lista cada pantalla con su frase, agrupada', async () => {
    esAdmin = true
    permisos = ['Items:Leer']
    const w = await mountSuspended(Indice)
    const texto = w.text()
    expect(texto).toContain('Organización')
    expect(texto).toContain('Usuarios')
    expect(texto).toContain('Las personas de tu local y los roles que tiene cada una.')
    expect(w.find('a[href="/configuracion/items"]').exists()).toBe(true)
  })

  it('quien no es admin solo ve lo que su permiso abre', async () => {
    permisos = ['Items:Leer']
    const w = await mountSuspended(Indice)
    expect(w.find('a[href="/configuracion/perfil"]').exists()).toBe(true)
    expect(w.find('a[href="/configuracion/items"]').exists()).toBe(true)
    expect(w.find('a[href="/configuracion/usuarios"]').exists()).toBe(false)
  })

  it('no redirige a Perfil', async () => {
    const w = await mountSuspended(Indice)
    expect(w.find('[data-qa="configuracion-indice"]').exists()).toBe(true)
  })
})

describe('Perfil', () => {
  it('lleva el mismo título de página que el resto', async () => {
    const w = await mountSuspended(Perfil)
    expect(w.get('[data-qa="cabecera"] h2').text()).toBe('Perfil')
  })
})
