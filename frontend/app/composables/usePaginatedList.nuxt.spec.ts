// @vitest-environment nuxt
//
// Lote 7 (05.20, 01.10): una carga que falla no puede quedar como "lista vacía" ni dejar las
// filas del filtro anterior como si fueran las del nuevo.
import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { usePaginatedList } from './usePaginatedList'

let llamadas = 0
let responder: () => Promise<unknown> = () => Promise.resolve(null)

mockNuxtImport('useApiFetch', () => () => {
  llamadas++
  return responder()
})

const pagina = (data: unknown[]) => ({ data, meta: { page: 1, pageSize: 15, total: data.length, totalPages: 1 } })

async function montar() {
  let api!: ReturnType<typeof usePaginatedList<{ id: string }>>
  await mountSuspended(defineComponent({
    setup() {
      api = usePaginatedList<{ id: string }>({ path: '/x' })
      return () => null
    },
  }))
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
  return api
}

describe('usePaginatedList — fallo de carga', () => {
  beforeEach(() => {
    llamadas = 0
    responder = () => Promise.resolve(pagina([{ id: 'a' }]))
  })

  it('una carga buena deja error y sinPermiso en false', async () => {
    const api = await montar()
    expect(api.error.value).toBe(false)
    expect(api.sinPermiso.value).toBe(false)
    expect(api.items.value).toHaveLength(1)
  })

  it('un 500 marca error, no marca sinPermiso y vacía las filas viejas', async () => {
    const api = await montar()
    responder = () => Promise.reject({ status: 500 })
    await api.fetch()
    expect(api.error.value).toBe(true)
    expect(api.sinPermiso.value).toBe(false)
    expect(api.items.value).toEqual([])
    expect(api.meta.value.total).toBe(0)
  })

  it('un 403 marca error y sinPermiso', async () => {
    responder = () => Promise.reject({ status: 403 })
    const api = await montar()
    expect(api.error.value).toBe(true)
    expect(api.sinPermiso.value).toBe(true)
  })

  it('reintentar a mano y que salga bien limpia el error', async () => {
    responder = () => Promise.reject({ status: 500 })
    const api = await montar()
    expect(api.error.value).toBe(true)
    responder = () => Promise.resolve(pagina([{ id: 'b' }]))
    await api.fetch()
    expect(api.error.value).toBe(false)
    expect(api.items.value).toEqual([{ id: 'b' }])
  })

  it('no reintenta solo: un fallo es una sola llamada', async () => {
    responder = () => Promise.reject({ status: 500 })
    await montar()
    await new Promise(r => setTimeout(r, 50))
    expect(llamadas).toBe(1)
  })
})
