// @vitest-environment nuxt
//
// Ítem 2 de `2026-09-19-residuos-hora-de-corte/brief.md`: Propinas es la
// única de las 6 pantallas con `<DiaNegocioNota />` que no tenía test de la
// nota (las otras cinco: `mermas.nuxt.spec.ts`, `sesiones-garzon.nuxt.spec.ts`,
// `components/caja/CajaTendencia.nuxt.spec.ts`, `salones/anulaciones.nuxt.spec.ts`
// y el smoke Playwright de `ordenes.vue`). Molde: `mermas.nuxt.spec.ts` →
// describe "nota del día de negocio".
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Propinas from './index.vue'

/** Task 5: corte del día de negocio que devuelve `GET /tenants/me` — 0 por
 *  defecto (sin corte, la `DiaNegocioNota` no se dibuja). */
let horaCorteBackend = 0

/** El admin de un tenant que contrató Propinas: `mis-permisos` le trae el catálogo entero. */
const ADMIN_PROPINAS = [
  'Propinas:Leer', 'Propinas:Crear', 'Propinas:Actualizar', 'Propinas:Eliminar',
  'Propinas:Configurar', 'Propinas:Liquidar',
]
let permisos: string[] = ADMIN_PROPINAS
let llamadas: string[] = []

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateTo)

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    get permisos() { return permisos },
    loading: false,
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve([])
    llamadas.push(url)
    if (url.includes('/tenants/me')) {
      return Promise.resolve({ horaCorte: horaCorteBackend, diaNegocioHoy: '2026-09-18' })
    }
    if (url.includes('/propinas/reportes/resumen')) {
      return Promise.resolve({
        cobranza: { montoCobrado: '0.0000' },
        estadoActual: { pendienteLibreMonto: '0.0000' },
      })
    }
    if (url.includes('/propinas/liquidaciones')) return Promise.resolve([])
    if (url.includes('/turnos')) return Promise.resolve([])
    if (url.includes('/garzones')) return Promise.resolve([])
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Propinas)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

beforeEach(() => {
  permisos = ADMIN_PROPINAS
  llamadas = []
  navigateTo.mockClear()
})

describe('propinas — nota del día de negocio', () => {
  beforeEach(() => {
    horaCorteBackend = 0
  })

  it('con corte configurado, muestra "Tu día va de HH:00 a HH:00"', async () => {
    horaCorteBackend = 5
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
    wrapper.unmount()
  })

  it('sin corte (0), no muestra la nota', async () => {
    horaCorteBackend = 0
    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Tu día va de')
    wrapper.unmount()
  })
})

describe('propinas — el admin del tenant entra solo si su tenant contrató Propinas', () => {
  // Sin atajo por `esAdmin` (owner, 2026-10-15): `mis-permisos` le trae al admin el
  // catálogo de los módulos contratados, y el backend le contesta 403 en los demás.
  it('con Propinas contratado, carga la pantalla sin rebotar', async () => {
    const wrapper = await montar()

    expect(navigateTo).not.toHaveBeenCalled()
    expect(llamadas.some(u => u.includes('/propinas/liquidaciones'))).toBe(true)
    wrapper.unmount()
  })

  it('en un tenant que no contrató Propinas, rebota a Inicio sin pedir nada de propinas', async () => {
    permisos = ['Paquetería:Leer']
    const wrapper = await montar()

    expect(navigateTo).toHaveBeenCalledWith('/')
    expect(llamadas.some(u => u.includes('/propinas'))).toBe(false)
    wrapper.unmount()
  })
})
