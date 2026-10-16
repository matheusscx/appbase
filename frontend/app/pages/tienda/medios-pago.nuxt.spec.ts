// @vitest-environment nuxt
//
// Lote 7 (09.4): si `GET /online/medios-pago` falla, la pantalla no puede decir "Inscripción no disponible:
// el tenant no tiene una pasarela…" (falso) ni "No tienes tarjetas inscritas".
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import MediosPago from './medios-pago.vue'

let respuesta: () => Promise<unknown> = () => Promise.resolve({ oneclickDisponible: true, medios: [] })
let pedidos = 0

mockNuxtImport('useApiFetch', () => () => {
  pedidos++
  return respuesta()
})
mockNuxtImport('usePermissionsStore', () => () => ({ esAdmin: false, can: () => true }))

async function montar() {
  const w = await mountSuspended(MediosPago)
  await new Promise(r => setTimeout(r, 30))
  return w
}

beforeEach(() => {
  pedidos = 0
  respuesta = () => Promise.resolve({ oneclickDisponible: true, medios: [] })
})

describe('tienda/medios-pago — una lectura fallida no es "no hay pasarela"', () => {
  it('con un 500 no muestra la alerta de pasarela ni "No tienes tarjetas": dice que no pudo cargar', async () => {
    respuesta = () => Promise.reject({ status: 500 })
    const w = await montar()

    expect(w.text()).not.toContain('Inscripción no disponible')
    expect(w.text()).not.toContain('tarjetas inscritas')
    expect(w.text()).toContain('No pudimos cargar tus tarjetas')
    w.unmount()
  })

  it('Reintentar vuelve a pedir las tarjetas, y solo al tocarlo', async () => {
    respuesta = () => Promise.reject({ status: 500 })
    const w = await montar()
    expect(pedidos).toBe(1)

    respuesta = () => Promise.resolve({ oneclickDisponible: true, medios: [] })
    await w.find('[data-qa="estado-reintentar"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    expect(pedidos).toBe(2)
    expect(w.text()).not.toContain('No pudimos cargar')
    w.unmount()
  })

  it('con la pasarela realmente sin Oneclick sí avisa que la inscripción no está disponible', async () => {
    respuesta = () => Promise.resolve({ oneclickDisponible: false, medios: [] })
    const w = await montar()
    expect(w.text()).toContain('Inscripción no disponible')
    w.unmount()
  })
})
