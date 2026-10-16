// @vitest-environment nuxt
//
// Lote 7 (09.4, 09.23): una lectura fallida de tarjetas o suscripciones no se ve como "no hay nada"
// ni como "la pasarela no está configurada". Los composables levantan `error`/`sinPermiso`.
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useTarjetas } from './useTarjetas'
import { useSuscripciones } from './useSuscripciones'
import { useSuscripcionesAdmin } from './useSuscripcionesAdmin'

let responder: () => Promise<unknown> = () => Promise.resolve([])
mockNuxtImport('useApiFetch', () => () => responder())

beforeEach(() => { responder = () => Promise.resolve([]) })

describe('useTarjetas — lectura fallida', () => {
  it('antes de cargar, la pasarela es "no se sabe" (null), no "no disponible"', () => {
    expect(useTarjetas().oneclickDisponible.value).toBeNull()
  })

  it('si la carga falla, no concluye que no hay pasarela: queda en null y levanta error', async () => {
    responder = () => Promise.reject({ status: 500 })
    const t = useTarjetas()
    await t.cargar()
    expect(t.oneclickDisponible.value).toBeNull()
    expect(t.error.value).toBe(true)
    expect(t.sinPermiso.value).toBe(false)
  })

  it('un 403 marca sinPermiso', async () => {
    responder = () => Promise.reject({ status: 403 })
    const t = useTarjetas()
    await t.cargar()
    expect(t.sinPermiso.value).toBe(true)
  })

  it('una carga buena fija la disponibilidad real y baja el error', async () => {
    responder = () => Promise.reject({ status: 500 })
    const t = useTarjetas()
    await t.cargar()
    responder = () => Promise.resolve({ oneclickDisponible: false, medios: [] })
    await t.cargar()
    expect(t.oneclickDisponible.value).toBe(false)
    expect(t.error.value).toBe(false)
  })
})

describe('useSuscripciones y useSuscripcionesAdmin — lectura fallida', () => {
  it('Mis suscripciones: un 500 levanta error; una carga buena lo baja', async () => {
    responder = () => Promise.reject({ status: 500 })
    const s = useSuscripciones()
    await s.cargar()
    expect(s.error.value).toBe(true)
    responder = () => Promise.resolve([])
    await s.cargar()
    expect(s.error.value).toBe(false)
  })

  it('Suscripciones del local: un 403 levanta error y sinPermiso', async () => {
    responder = () => Promise.reject({ status: 403 })
    const s = useSuscripcionesAdmin()
    await s.cargar()
    expect(s.error.value).toBe(true)
    expect(s.sinPermiso.value).toBe(true)
  })
})
