// @vitest-environment nuxt
//
// Task 5 (`task-5-brief.md` § Step 2): la nota que explica el corte del día
// de negocio en las pantallas con filtro de fecha. Lo que este spec fija:
//   1. Con `horaCorte` > 0 muestra "Tu día va de HH:00 a HH:00".
//   2. Con `horaCorte` 0 (el default, "sin corte") no renderiza nada.
//   3. Fix round 1: con el prop `horaCorte` (una pantalla que ya pidió su
//      propio `/tenants/me`, p. ej. `anulaciones.vue`), la nota NO hace su
//      propio fetch — evita duplicar el GET.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import DiaNegocioNota from './DiaNegocioNota.vue'

let horaCorteBackend: number | null = 0
let fetchsATenantsMe = 0

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url === 'string' && url.includes('/tenants/me')) {
      fetchsATenantsMe++
      if (horaCorteBackend === null) return Promise.reject(new Error('sin red'))
      return Promise.resolve({ horaCorte: horaCorteBackend, diaNegocioHoy: '2026-09-18' })
    }
    return Promise.resolve({})
  }
})

describe('DiaNegocioNota', () => {
  beforeEach(() => {
    horaCorteBackend = 0
    fetchsATenantsMe = 0
  })

  it('con corte 5 muestra "Tu día va de 05:00 a 05:00"', async () => {
    horaCorteBackend = 5
    const wrapper = await mountSuspended(DiaNegocioNota)
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
  })

  it('con corte 0 no renderiza nada', async () => {
    horaCorteBackend = 0
    const wrapper = await mountSuspended(DiaNegocioNota)
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text().trim()).toBe('')
  })

  it('sin poder cargar (error de red) tampoco renderiza nada — es informativa, no un error', async () => {
    horaCorteBackend = null
    const wrapper = await mountSuspended(DiaNegocioNota)
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text().trim()).toBe('')
  })

  it('con el prop horaCorte, muestra la nota SIN pedir su propio /tenants/me', async () => {
    // El backend está configurado con 0 (sin corte) a propósito: si la nota
    // ignorara el prop y usara su propio fetch, mostraría "sin nota" en vez
    // del "05:00" que le pasó el dueño del dato.
    horaCorteBackend = 0
    const wrapper = await mountSuspended(DiaNegocioNota, { props: { horaCorte: 5 } })
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
    expect(fetchsATenantsMe).toBe(0)
  })

  it('con el prop horaCorte en 0, no renderiza — y tampoco pide su propio /tenants/me', async () => {
    const wrapper = await mountSuspended(DiaNegocioNota, { props: { horaCorte: 0 } })
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text().trim()).toBe('')
    expect(fetchsATenantsMe).toBe(0)
  })

  it('sin el prop, sigue pidiendo su propio /tenants/me (comportamiento sin cambios)', async () => {
    horaCorteBackend = 5
    const wrapper = await mountSuspended(DiaNegocioNota)
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
    expect(fetchsATenantsMe).toBe(1)
  })

  // Ítem 4 de `2026-09-19-residuos-hora-de-corte/brief.md`: el caso que
  // distingue el diseño y que faltaba cubrir. `undefined` (prop no pasado) es
  // "sin controlar, pedí lo tuyo"; `null` es "el dueño del dato TODAVÍA no
  // resolvió su fetch" — a propósito no dibuja nada y tampoco dispara el
  // fetch propio, porque ese `null` es transitorio: en cuanto el dueño
  // resuelva, va a mandar un número real.
  it('con el prop horaCorte en null, no renderiza y tampoco pide su propio /tenants/me', async () => {
    horaCorteBackend = 5 // a propósito distinto de "sin nota": si ignorara el null y pidiera igual, se vería 05:00.
    const wrapper = await mountSuspended(DiaNegocioNota, { props: { horaCorte: null } })
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text().trim()).toBe('')
    expect(fetchsATenantsMe).toBe(0)
  })

  it('cuando el prop pasa de null a 5, la nota aparece', async () => {
    const wrapper = await mountSuspended(DiaNegocioNota, { props: { horaCorte: null } })
    await new Promise(r => setTimeout(r, 20))
    expect(wrapper.text().trim()).toBe('')

    await wrapper.setProps({ horaCorte: 5 })
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
    expect(fetchsATenantsMe).toBe(0) // sigue sin pedir el propio: el dato lo mandó el dueño
  })
})
