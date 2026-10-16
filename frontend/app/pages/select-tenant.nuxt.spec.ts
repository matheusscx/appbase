// @vitest-environment nuxt
//
// "Elegir local" (auditoría UX 08.13). Los avatares no usan colores de alerta
// (el local "Ln" salía rojo y se leía como un error), y una lista vacía no deja
// la pantalla en blanco: manda a "sin empresa".
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { useTenantStore } from '~/stores/tenant'
import SelectTenant from './select-tenant.vue'

const { navigateTo, tenants, cambio } = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  tenants: { lista: [] as { tenantId: string, nombre: string }[] },
  /** Las elecciones que llegaron a `switch-tenant`, y si falla. */
  cambio: { pedidos: [] as unknown[], falla: false },
}))

mockNuxtImport('navigateTo', () => navigateTo)
mockNuxtImport('useApiFetch', () => (url: string, opts?: { body?: unknown }) => {
  if (url.includes('switch-tenant')) {
    cambio.pedidos.push(opts?.body)
    return cambio.falla ? Promise.reject({ data: { message: 'boom' } }) : Promise.resolve({ access_token: 'a.e30.b' })
  }
  return Promise.resolve(tenants.lista)
})

describe('select-tenant', () => {
  beforeEach(() => {
    navigateTo.mockClear()
    cambio.pedidos = []
    cambio.falla = false
    useTenantStore().tenants = []
  })

  it('los avatares van en petróleo y menta, nunca en rojo, amarillo ni verde de estado', async () => {
    tenants.lista = ['Ln', 'Ana', 'Bar Sur', 'Café', 'Zeta', 'Éxito', 'Quilpué', 'Wok'].map((nombre, i) => ({ tenantId: `t${i}`, nombre }))
    const wrapper = await mountSuspended(SelectTenant)
    await vi.waitFor(() => expect(wrapper.findAll('button.group').length).toBe(8))
    const avatares = wrapper.findAll('button.group span.rounded-full')
    expect(avatares.length).toBeGreaterThanOrEqual(8)
    for (const a of avatares) {
      const html = a.html()
      expect(html).not.toMatch(/\b(?:bg|text)-(?:error|warning|success|info|secondary)/)
    }
  })

  it('con la lista vacía pasa a la pantalla "sin empresa"', async () => {
    tenants.lista = []
    await mountSuspended(SelectTenant)
    await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/no-tenant'))
  })

  it('con locales no redirige', async () => {
    tenants.lista = [{ tenantId: 't1', nombre: 'Local Uno' }]
    const wrapper = await mountSuspended(SelectTenant)
    await vi.waitFor(() => expect(wrapper.findAll('button.group').length).toBe(1))
    expect(navigateTo).not.toHaveBeenCalled()
  })

  // Auditoría UX 08.8: "Cerrar sesión" medía 96×28.
  it('"Cerrar sesión" mide 44 px para el dedo', async () => {
    tenants.lista = [{ tenantId: 't1', nombre: 'Local Uno' }]
    const wrapper = await mountSuspended(SelectTenant)
    const boton = wrapper.findAll('button').find(b => b.text() === 'Cerrar sesión')
    expect(boton).toBeTruthy()
    expect(boton!.classes().join(' ')).toMatch(/(^|\s)min-h-11(\s|$)/)
  })

  // 08.11: si falla elegir el local, la lista sigue a la vista y "Reintentar"
  // repite la elección, no la lectura de la lista.
  it('si falla entrar al local, la lista queda y "Reintentar" repite esa elección', async () => {
    tenants.lista = [{ tenantId: 't1', nombre: 'Local Uno' }, { tenantId: 't2', nombre: 'Local Dos' }]
    cambio.falla = true
    const wrapper = await mountSuspended(SelectTenant)
    await vi.waitFor(() => expect(wrapper.findAll('button.group').length).toBe(2))

    await wrapper.findAll('button.group')[1]!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))
    expect(wrapper.findAll('button.group')).toHaveLength(2)
    expect(cambio.pedidos).toEqual([{ tenantId: 't2' }])

    const botonReintentar = () => wrapper.findAll('button').find(b => b.text() === 'Reintentar')!
    await vi.waitFor(() => expect(botonReintentar().attributes('disabled')).toBeUndefined())
    const reintentar = botonReintentar()
    await reintentar.trigger('click')
    await vi.waitFor(() => expect(cambio.pedidos).toEqual([{ tenantId: 't2' }, { tenantId: 't2' }]))
  })

  // 08.12: una columna, y el nombre completo disponible aunque se parta en dos líneas.
  it('con dos locales parecidos, cada uno ocupa su fila y trae el nombre completo', async () => {
    tenants.lista = [
      { tenantId: 't1', nombre: 'Almacén Los Andes Centro' },
      { tenantId: 't2', nombre: 'Almacén Los Andes Norte' },
    ]
    const wrapper = await mountSuspended(SelectTenant)
    await vi.waitFor(() => expect(wrapper.findAll('button.group').length).toBe(2))
    expect(wrapper.find('button.group').element.parentElement!.className).not.toMatch(/grid-cols-2/)
    const nombre = wrapper.find('button.group span[title]')
    expect(nombre.attributes('title')).toBe('Almacén Los Andes Centro')
    expect(nombre.classes()).toContain('line-clamp-2')
    expect(nombre.classes()).not.toContain('truncate')
  })

  // 08.22: la carga usa el mismo estado que las demás pantallas del ingreso.
  it('mientras carga, usa el estado de carga del marco', async () => {
    tenants.lista = []
    const wrapper = await mountSuspended(SelectTenant)
    useTenantStore().loading = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="status"]').text()).toContain('Cargando tus empresas')
  })
})
