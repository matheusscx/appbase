// @vitest-environment nuxt
//
// Caché de ítems por id: spec docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md § 5.
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useItemsPorId } from './useItemsPorId'

type Item = { id: string, nombre: string }

let urls: string[] = []
let responder: (url: string) => Promise<{ data: unknown[], meta: unknown }> = () => Promise.resolve({ data: [], meta: {} })

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    urls.push(url)
    return responder(url)
  }
})

const q = (url: string) => new URL(url, 'http://x').searchParams
const item = (id: string): Item => ({ id, nombre: `Item ${id}` })
/** Contesta con un ítem por cada id pedido en `ids=`. */
const porIds = (url: string) => Promise.resolve({
  data: (q(url).get('ids') ?? '').split(',').filter(Boolean).map(item),
  meta: {},
})

describe('useItemsPorId', () => {
  beforeEach(() => {
    urls = []
    responder = () => Promise.resolve({ data: [], meta: {} })
  })

  it('buscar manda search, pageSize=20 y los filtros, y llena porId', async () => {
    responder = () => Promise.resolve({ data: [item('a'), item('b')], meta: {} })
    const c = useItemsPorId<Item>()

    const res = await c.buscar('pan', { tipo: ['producto'], activo: true })

    expect(urls).toHaveLength(1)
    const p = q(urls[0]!)
    expect(p.get('search')).toBe('pan')
    expect(p.get('pageSize')).toBe('20')
    expect(p.get('tipo')).toBe('producto')
    expect(p.get('activo')).toBe('true')
    expect(res.map(i => i.id)).toEqual(['a', 'b'])
    expect(c.porId.get('a')).toEqual(item('a'))
    expect(c.porId.get('b')).toEqual(item('b'))
  })

  it('resolver pide solo los ids que faltan en la caché, sin repetidos', async () => {
    responder = porIds
    const c = useItemsPorId<Item>()
    c.registrar(item('a'))

    await c.resolver(['a', 'b', 'a'])

    expect(urls).toHaveLength(1)
    const p = q(urls[0]!)
    expect(p.get('ids')).toBe('b')
    expect(p.get('pageSize')).toBe('100')
    expect(c.porId.get('b')).toEqual(item('b'))
  })

  it('resolver con 150 ids hace dos pedidos (100 + 50)', async () => {
    responder = porIds
    const c = useItemsPorId<Item>()
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`)

    await c.resolver(ids)

    expect(urls).toHaveLength(2)
    expect(q(urls[0]!).get('ids')!.split(',')).toHaveLength(100)
    expect(q(urls[1]!).get('ids')!.split(',')).toHaveLength(50)
    expect(c.porId.size).toBe(150)
  })

  it('resolver([]) y resolver de ids ya cacheados no piden nada', async () => {
    const c = useItemsPorId<Item>()
    c.registrar(item('a'))

    await c.resolver([])
    await c.resolver(['a'])

    expect(urls).toHaveLength(0)
  })

  it('un resolver que falla rechaza (el llamador decide si silenciar)', async () => {
    responder = () => Promise.reject(new Error('403'))
    const c = useItemsPorId<Item>()

    await expect(c.resolver(['x'])).rejects.toThrow('403')
  })
})
