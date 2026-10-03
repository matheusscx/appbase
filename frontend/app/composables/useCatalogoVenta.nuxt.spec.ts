// @vitest-environment nuxt
//
// La grilla de venta paginada y buscada en el servidor: spec
// docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md § 4.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { ItemCatalogo } from '~/composables/useVenta'
import { useCatalogoVenta, PAGE_SIZE_CATALOGO } from './useCatalogoVenta'

type Respuesta = { data: unknown[], meta: { page: number, pageSize: number, total: number, totalPages: number } }

/** Cada URL pedida, en orden. */
let urls: string[] = []
/** Qué contesta el próximo pedido; por defecto, una página vacía de 1 sola página. */
let responder: (url: string) => Promise<Respuesta> = () => Promise.resolve(pagina([], 0))

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    urls.push(url)
    return responder(url)
  }
})

function pagina(data: unknown[], total: number, page = 1): Respuesta {
  return { data, meta: { page, pageSize: PAGE_SIZE_CATALOGO, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE_CATALOGO)) } }
}

function item(id: string, extra: Record<string, unknown> = {}) {
  return { id, nombre: `Item ${id}`, tipo: 'producto', activo: true, ...extra } as unknown as ItemCatalogo
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res, reject = rej })
  return { promise, resolve, reject }
}

/** Monta el composable dentro de un componente (necesita `watch` y `onBeforeUnmount` con instancia). */
async function montar(opts: Parameters<typeof useCatalogoVenta>[0]) {
  let api!: ReturnType<typeof useCatalogoVenta>
  await mountSuspended(defineComponent({
    setup() {
      api = useCatalogoVenta(opts)
      return () => null
    },
  }))
  return api
}

const TIPOS: Array<'producto' | 'receta' | 'combo'> = ['producto', 'receta', 'combo']

/** Deja correr las promesas pendientes y los watchers, sin avanzar el reloj. */
async function asentar() {
  await vi.advanceTimersByTimeAsync(0)
  await nextTick()
}

describe('useCatalogoVenta', () => {
  beforeEach(() => {
    urls = []
    responder = () => Promise.resolve(pagina([], 0))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cargar() pide los tipos, activo, el orden y la primera página', async () => {
    const c = await montar({ tipos: TIPOS })
    await c.cargar()

    expect(urls).toHaveLength(1)
    const q = new URL(urls[0]!, 'http://x').searchParams
    expect(urls[0]!.split('?')[0]).toMatch(/\/items$/)
    expect(q.get('tipo')).toBe('producto,receta,combo')
    expect(q.get('activo')).toBe('true')
    expect(q.get('orden')).toBe('disponibilidad')
    expect(q.get('page')).toBe('1')
    expect(q.get('pageSize')).toBe('48')
    expect(q.has('search')).toBe(false)
  })

  it('tipear espera 300 ms y pide una sola vez, con search y page=1', async () => {
    const c = await montar({ tipos: TIPOS })
    await c.cargar()
    urls = []

    c.busqueda.value = 'pi'
    await nextTick()
    await vi.advanceTimersByTimeAsync(299)
    expect(urls).toHaveLength(0)

    c.busqueda.value = 'pizza' // otra tecla: reinicia la espera
    await nextTick()
    await vi.advanceTimersByTimeAsync(299)
    expect(urls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    await asentar()
    expect(urls).toHaveLength(1)
    const q = new URL(urls[0]!, 'http://x').searchParams
    expect(q.get('search')).toBe('pizza')
    expect(q.get('page')).toBe('1')
  })

  it('con page = 3, cambiar la búsqueda vuelve a la página 1 con un solo pedido', async () => {
    responder = () => Promise.resolve(pagina([], 500)) // 11 páginas: la 3 existe
    const c = await montar({ tipos: TIPOS })
    c.page.value = 3
    await asentar()
    expect(new URL(urls.at(-1)!, 'http://x').searchParams.get('page')).toBe('3')
    urls = []

    c.busqueda.value = 'sopa'
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    await asentar()

    expect(c.page.value).toBe(1)
    expect(urls).toHaveLength(1)
    const q = new URL(urls[0]!, 'http://x').searchParams
    expect(q.get('page')).toBe('1')
    expect(q.get('search')).toBe('sopa')
  })

  it('turnos: dos refrescar() donde el primero responde último dejan los items del segundo', async () => {
    const primero = deferred<Respuesta>()
    const segundo = deferred<Respuesta>()
    const cola = [primero, segundo]
    responder = () => cola.shift()!.promise
    const c = await montar({ tipos: TIPOS })

    const p1 = c.refrescar()
    const p2 = c.refrescar()
    segundo.resolve(pagina([item('B')], 1))
    await p2
    primero.resolve(pagina([item('A')], 1))
    await p1

    expect(c.items.value.map(i => i.id)).toEqual(['B'])
  })

  it('un fallo no borra lo que había y avisa una vez', async () => {
    const onError = vi.fn()
    responder = () => Promise.resolve(pagina([item('A')], 1))
    const c = await montar({ tipos: TIPOS, onError })
    await c.cargar()
    expect(c.items.value.map(i => i.id)).toEqual(['A'])

    const falla = new Error('sin red')
    responder = () => Promise.reject(falla)
    await c.refrescar()

    expect(c.items.value.map(i => i.id)).toEqual(['A'])
    expect(c.total.value).toBe(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(falla)
  })

  it('página fuera de rango: va a la última y vuelve a pedir', async () => {
    responder = () => Promise.resolve(pagina([], 500))
    const c = await montar({ tipos: TIPOS })
    c.page.value = 3
    await asentar()
    urls = []

    responder = () => Promise.resolve(pagina([item('A')], 50)) // 50 ítems = 2 páginas
    await c.refrescar()
    await asentar()

    expect(c.page.value).toBe(2)
    expect(urls).toHaveLength(2) // el que vio el rango + el re-pedido de la página 2
    expect(new URL(urls.at(-1)!, 'http://x').searchParams.get('page')).toBe('2')
    expect(c.items.value.map(i => i.id)).toEqual(['A'])
  })

  it('filtros por pantalla: viajan además de los fijos', async () => {
    const c = await montar({ tipos: ['producto'], filtros: { vendibleOnline: 'true' } })
    await c.cargar()

    const q = new URL(urls[0]!, 'http://x').searchParams
    expect(q.get('vendibleOnline')).toBe('true')
    expect(q.get('tipo')).toBe('producto')
    expect(q.get('orden')).toBe('disponibilidad')
  })

  it('no toca los ítems: uno en modo serie llega tal cual', async () => {
    const serie = item('S', { modoInventario: 'serie' })
    responder = () => Promise.resolve(pagina([serie], 1))
    const c = await montar({ tipos: TIPOS })
    await c.cargar()

    expect(c.items.value[0]).toStrictEqual(serie)
    expect((c.items.value[0] as unknown as { modoInventario: string }).modoInventario).toBe('serie')
  })
})
