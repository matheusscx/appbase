// @vitest-environment nuxt
//
// Auditoría UX 09.11: la estrella de "preferida" era un `<button>` pelado de
// 28 px; su estado se distinguía solo por el relleno amarillo y el lector de
// pantalla decía "botón" y nada más. Los basureros tampoco tenían nombre.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import MediosPago from './medios-pago.vue'

mockNuxtImport('useTarjetas', () => () => ({
  tarjetas: ref([
    { inscripcionId: 'i1', marca: 'Visa', last4: '1234', preferida: true, suscripcionesActivas: 0, creadoEl: '2026-10-01T00:00:00Z' },
    { inscripcionId: 'i2', marca: 'Mastercard', last4: '9876', preferida: false, suscripcionesActivas: 0, creadoEl: '2026-10-02T00:00:00Z' },
  ]),
  oneclickDisponible: ref(true),
  loading: ref(false),
  error: ref(false),
  sinPermiso: ref(false),
  cargar: vi.fn(),
  agregar: vi.fn(),
  eliminar: vi.fn(),
  marcarPreferida: vi.fn(),
}))

describe('tienda/medios-pago — botones de solo ícono con nombre', () => {
  it('la estrella dice de qué tarjeta es y si es la preferida', async () => {
    const w = await mountSuspended(MediosPago)
    const visa = w.find('button[aria-label="Tarjeta preferida: Visa 1234"]')
    const master = w.find('button[aria-label="Tarjeta preferida: Mastercard 9876"]')
    expect(visa.attributes('aria-pressed')).toBe('true')
    expect(master.attributes('aria-pressed')).toBe('false')
  })

  it('cada basurero nombra la tarjeta que elimina', async () => {
    const w = await mountSuspended(MediosPago)
    expect(w.find('button[aria-label="Eliminar la tarjeta Visa 1234"]').exists()).toBe(true)
    expect(w.find('button[aria-label="Eliminar la tarjeta Mastercard 9876"]').exists()).toBe(true)
  })
})
