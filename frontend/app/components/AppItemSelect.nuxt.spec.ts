// @vitest-environment nuxt
//
// Selector de ítems con búsqueda en el servidor: spec
// docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md § 5. Lo que fija:
//   1. Abrir pide la búsqueda vacía; tipear espera 300 ms y pide con el término.
//   2. Las opciones son la unión de resultados y elegidos (sin eso el elegido se ve sin nombre).
//   3. Un elegido que la pantalla no vio se resuelve al montar, y un fallo avisa por toast.
//   4. `excluir` saca ids de los resultados, nunca a un elegido.
//   5. Una búsqueda vieja no pisa a la nueva.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AppItemSelect from './AppItemSelect.vue'
import type { FiltrosItems } from '~/composables/useItemsPorId'

type Item = { id: string, nombre: string }
const item = (id: string, nombre = `Item ${id}`): Item => ({ id, nombre })

const toasts: Array<{ title?: string, color?: string }> = []
mockNuxtImport('useToast', () => () => ({ add: (t: { title?: string }) => { toasts.push(t) } }))

function catalogoFalso(over: {
  buscar?: (q: string, f: FiltrosItems) => Promise<Item[]>
  resolver?: (ids: string[]) => Promise<void>
} = {}) {
  return {
    porId: reactive(new Map<string, Item>()) as Map<string, Item>,
    buscar: vi.fn(over.buscar ?? (async () => [] as Item[])),
    resolver: vi.fn(over.resolver ?? (async () => {})),
    registrar: vi.fn(),
  }
}

type Catalogo = ReturnType<typeof catalogoFalso>

async function montar(catalogo: Catalogo, props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(AppItemSelect, {
    props: { catalogo, multiple: true, modelValue: [], ...props },
  })
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

const menu = (w: Awaited<ReturnType<typeof montar>>) => w.findComponent({ name: 'USelectMenu' })
const opciones = (w: Awaited<ReturnType<typeof montar>>) =>
  menu(w).props('items') as Array<{ value: string, label: string }>
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('AppItemSelect', () => {
  beforeEach(() => {
    toasts.length = 0
  })

  it('al abrir pide buscar(""); tipear espera 300 ms y pide con el término', async () => {
    const c = catalogoFalso()
    const w = await montar(c, { filtros: { tipo: ['producto'] } })
    expect(c.buscar).not.toHaveBeenCalled()

    menu(w).vm.$emit('update:open', true)
    await esperar(0)
    expect(c.buscar).toHaveBeenCalledTimes(1)
    expect(c.buscar).toHaveBeenLastCalledWith('', { tipo: ['producto'] })

    menu(w).vm.$emit('update:searchTerm', 'pan')
    await esperar(100)
    expect(c.buscar).toHaveBeenCalledTimes(1) // todavía dentro de la espera
    await esperar(300)
    expect(c.buscar).toHaveBeenCalledTimes(2)
    expect(c.buscar).toHaveBeenLastCalledWith('pan', { tipo: ['producto'] })

    w.unmount()
  })

  it('las opciones unen los resultados con los elegidos que no vinieron en la búsqueda', async () => {
    const c = catalogoFalso({ buscar: async () => [item('a'), item('b')] })
    c.porId.set('x', item('x', 'Elegido X'))
    const w = await montar(c, { modelValue: ['x'] })

    menu(w).vm.$emit('update:open', true)
    await esperar(10)

    expect(opciones(w)).toEqual([
      { value: 'x', label: 'Elegido X' },
      { value: 'a', label: 'Item a' },
      { value: 'b', label: 'Item b' },
    ])

    w.unmount()
  })

  it('un elegido que también viene en los resultados no se repite', async () => {
    const c = catalogoFalso({ buscar: async () => [item('a'), item('b')] })
    c.porId.set('a', item('a'))
    const w = await montar(c, { modelValue: ['a'] })

    menu(w).vm.$emit('update:open', true)
    await esperar(10)

    expect(opciones(w).map(o => o.value)).toEqual(['a', 'b'])

    w.unmount()
  })

  it('con un elegido que no está en porId llama a resolver([id]) al montar', async () => {
    const c = catalogoFalso()
    const w = await montar(c, { modelValue: ['y'] })

    expect(c.resolver).toHaveBeenCalledWith(['y'])

    w.unmount()
  })

  it('cuando resolver termina, el elegido aparece con su etiqueta', async () => {
    const c = catalogoFalso({
      resolver: async (ids) => { ids.forEach(id => c.porId.set(id, item(id, 'Pan de molde'))) },
    })
    const w = await montar(c, { modelValue: ['y'] })
    await esperar(10)

    expect(opciones(w)).toEqual([{ value: 'y', label: 'Pan de molde' }])

    w.unmount()
  })

  it('si resolver falla, avisa por toast', async () => {
    const c = catalogoFalso({ resolver: async () => { throw new Error('sin red') } })
    const w = await montar(c, { modelValue: ['y'] })
    await esperar(10)

    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.color).toBe('error')

    w.unmount()
  })

  it('si la búsqueda falla, avisa por toast y deja los resultados anteriores', async () => {
    let falla = false
    const c = catalogoFalso({
      buscar: async () => {
        if (falla) throw new Error('sin red')
        return [item('a')]
      },
    })
    const w = await montar(c)
    menu(w).vm.$emit('update:open', true)
    await esperar(10)
    falla = true
    menu(w).vm.$emit('update:open', true)
    await esperar(10)

    expect(toasts).toHaveLength(1)
    expect(opciones(w).map(o => o.value)).toEqual(['a'])

    w.unmount()
  })

  it('excluir saca ids de los resultados, pero nunca a un elegido', async () => {
    const c = catalogoFalso({ buscar: async () => [item('a'), item('b'), item('c')] })
    c.porId.set('b', item('b'))
    const w = await montar(c, { modelValue: ['b'], excluir: ['a', 'b'] })

    menu(w).vm.$emit('update:open', true)
    await esperar(10)

    expect(opciones(w).map(o => o.value)).toEqual(['b', 'c'])

    w.unmount()
  })

  it('una búsqueda vieja que llega tarde no pisa a la nueva', async () => {
    const pendientes: Array<(r: Item[]) => void> = []
    const c = catalogoFalso({ buscar: () => new Promise<Item[]>(r => pendientes.push(r)) })
    const w = await montar(c)

    menu(w).vm.$emit('update:open', true) // búsqueda 1
    menu(w).vm.$emit('update:searchTerm', 'pan')
    await esperar(350) // búsqueda 2
    expect(pendientes).toHaveLength(2)

    pendientes[1]!([item('nueva')])
    await esperar(10)
    pendientes[0]!([item('vieja')])
    await esperar(10)

    expect(opciones(w).map(o => o.value)).toEqual(['nueva'])

    w.unmount()
  })

  it('el modelo de selección simple acepta un id suelto', async () => {
    const c = catalogoFalso()
    c.porId.set('x', item('x', 'Elegido X'))
    const w = await montar(c, { multiple: false, modelValue: 'x' })

    expect(opciones(w)).toEqual([{ value: 'x', label: 'Elegido X' }])
    expect(c.resolver).toHaveBeenCalledWith(['x'])

    w.unmount()
  })

  it('usa la función de etiqueta cuando se la pasan', async () => {
    const c = catalogoFalso({ buscar: async () => [item('a', 'Pan')] })
    const w = await montar(c, { etiqueta: (i: Item) => `${i.nombre} (panadería)` })

    menu(w).vm.$emit('update:open', true)
    await esperar(10)

    expect(opciones(w)).toEqual([{ value: 'a', label: 'Pan (panadería)' }])

    w.unmount()
  })

  it('cambiar los filtros descarta la búsqueda vieja que llega tarde', async () => {
    const pendientes: Array<(r: Item[]) => void> = []
    const c = catalogoFalso({ buscar: () => new Promise<Item[]>(r => pendientes.push(r)) })
    const w = await montar(c, { filtros: { tipo: ['producto'] } })

    menu(w).vm.$emit('update:open', true) // búsqueda 1, filtros viejos, retenida
    await esperar(0)
    expect(pendientes).toHaveLength(1)

    await w.setProps({ filtros: { tipo: ['receta'] } }) // dispara la 2 (menú abierto)
    await esperar(0)
    pendientes[0]!([item('vieja')])
    await esperar(10)

    expect(opciones(w)).toEqual([])
    pendientes[1]!([item('nueva')])
    await esperar(10)
    expect(opciones(w).map(o => o.value)).toEqual(['nueva'])

    w.unmount()
  })

  it('con el menú cerrado, cambiar los filtros también descarta la búsqueda vieja en vuelo', async () => {
    const pendientes: Array<(r: Item[]) => void> = []
    const c = catalogoFalso({ buscar: () => new Promise<Item[]>(r => pendientes.push(r)) })
    const w = await montar(c, { filtros: { tipo: ['producto'] } })

    menu(w).vm.$emit('update:open', true) // búsqueda con los filtros viejos, retenida
    await esperar(0)
    menu(w).vm.$emit('update:open', false)
    await w.setProps({ filtros: { tipo: ['receta'] } }) // cerrado: no busca de nuevo
    await esperar(0)
    expect(pendientes).toHaveLength(1)

    pendientes[0]!([item('vieja')])
    await esperar(10)

    expect(opciones(w)).toEqual([])

    w.unmount()
  })

  it('con el menú abierto, cambiar los filtros busca de nuevo con los filtros y el término actuales', async () => {
    const c = catalogoFalso()
    const w = await montar(c, { filtros: { tipo: ['producto'] } })
    menu(w).vm.$emit('update:open', true)
    menu(w).vm.$emit('update:searchTerm', 'pan')
    await esperar(350)
    expect(c.buscar).toHaveBeenLastCalledWith('pan', { tipo: ['producto'] })
    c.buscar.mockClear()

    await w.setProps({ filtros: { tipo: ['receta'] } })
    await esperar(0)

    expect(c.buscar).toHaveBeenCalledTimes(1)
    expect(c.buscar).toHaveBeenLastCalledWith('pan', { tipo: ['receta'] })

    w.unmount()
  })

  it('con el menú cerrado, cambiar los filtros no busca (busca la próxima apertura)', async () => {
    const c = catalogoFalso()
    const w = await montar(c, { filtros: { tipo: ['producto'] } })

    await w.setProps({ filtros: { tipo: ['receta'] } })
    await esperar(10)
    expect(c.buscar).not.toHaveBeenCalled()

    menu(w).vm.$emit('update:open', true)
    await esperar(0)
    expect(c.buscar).toHaveBeenLastCalledWith('', { tipo: ['receta'] })

    w.unmount()
  })

  describe('clear', () => {
    async function limpiar(multiple: boolean, modelValue: string | string[]) {
      const c = catalogoFalso()
      c.porId.set('x', item('x'))
      const emitidos: unknown[] = []
      const w = await montar(c, {
        multiple,
        modelValue,
        clear: true,
        'onUpdate:modelValue': (v: unknown) => emitidos.push(v),
      })
      const boton = w.find('[data-slot="trailing"] span[tabindex="-1"]') // UButton pisa el data-slot
      expect(boton.exists(), 'botón de limpiar').toBe(true)
      await boton.trigger('click')
      await esperar(10)
      w.unmount()
      return emitidos
    }

    it('en simple el modelo pasa a null', async () => {
      expect(await limpiar(false, 'x')).toEqual([null])
    })

    it('en múltiple el modelo pasa a [] (nunca undefined)', async () => {
      expect(await limpiar(true, ['x'])).toEqual([[]])
    })
  })
})
