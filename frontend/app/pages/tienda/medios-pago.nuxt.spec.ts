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
let puedeCrear = true
mockNuxtImport('usePermissionsStore', () => () => ({ esAdmin: false, can: () => puedeCrear }))

async function montar() {
  const w = await mountSuspended(MediosPago)
  await new Promise(r => setTimeout(r, 30))
  return w
}

beforeEach(() => {
  pedidos = 0
  puedeCrear = true
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

describe('tienda/medios-pago — qué hacer cuando no hay tarjetas, y quién puede agregarlas', () => {
  const conTarjeta = {
    oneclickDisponible: true,
    medios: [{
      inscripcionId: 'i1', mediosPago: [{ marca: 'Visa', ultimos4: '1234', tipo: 'credito' }],
      preferida: true, creadoEl: '2026-10-01T00:00:00Z', suscripcionesActivas: 0,
    }],
  }

  // 09.21
  it('el vacío dice qué hacer, avisa que sale a Webpay y trae el botón adentro', async () => {
    const w = await montar()
    const vacio = w.find('[data-qa="tarjetas-vacio"]')
    expect(vacio.text()).toContain('Aún no tienes tarjetas')
    expect(vacio.text()).toContain('Webpay')
    expect(vacio.text()).toContain('Agregar tarjeta')
    w.unmount()
  })

  it('con tarjetas no hay vacío', async () => {
    respuesta = () => Promise.resolve(conTarjeta)
    const w = await montar()
    expect(w.find('[data-qa="tarjetas-vacio"]').exists()).toBe(false)
    w.unmount()
  })

  // 09.14: el backend exige Tienda Online:Crear para agregar, quitar y marcar preferida.
  it('sin permiso de crear, no ofrece agregar ni quitar y lo explica', async () => {
    puedeCrear = false
    respuesta = () => Promise.resolve(conTarjeta)
    const w = await montar()
    expect(w.text()).toContain('Tu rol puede ver las tarjetas')
    for (const b of w.findAll('button').filter(b => /Agregar tarjeta|Eliminar la tarjeta|Tarjeta preferida/.test(b.text() + (b.attributes('aria-label') ?? '')))) {
      expect(b.attributes('disabled'), b.text() || b.attributes('aria-label')).toBeDefined()
    }
    w.unmount()
  })

  it('con permiso nada queda inactivo ni se avisa', async () => {
    respuesta = () => Promise.resolve(conTarjeta)
    const w = await montar()
    expect(w.text()).not.toContain('Tu rol puede ver')
    expect(w.find('button[aria-label="Eliminar la tarjeta Visa 1234"]').attributes('disabled')).toBeUndefined()
    w.unmount()
  })
})
