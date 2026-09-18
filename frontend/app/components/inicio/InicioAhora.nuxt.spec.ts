// @vitest-environment nuxt
//
// Zona "Ahora" del dashboard de inicio (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.1 y § 6). Lo que este spec fija, sobre `pages/index.vue` — la página solo
// ordena los tres bloques, así que el gateo por permiso se prueba ahí:
//   1. Sin `Salones: Ver todas` no se pide `/salones/ocupacion`.
//   2. Con `Cajas: Leer` se piden las dos rutas de caja.
//   3. El texto de ocupación sale de la respuesta real de `/salones/ocupacion`.
//   4. Sin ningún permiso, ninguna de las tres rutas se pide.
//
// Molde: `pages/salones/anulaciones.nuxt.spec.ts`. Los bodies simulados tienen
// la forma real de cada ruta —copiada de `caja.service.ts` (`CajonEstado`,
// `ResumenDescuadresDia`) y `salones.service.ts` (`OcupacionSalones`)—, no una
// inventada: el mock de `useApiFetch` contesta 200 a lo que sea.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Index from '~/pages/index.vue'

let permisos: string[] = []
let esAdmin = false

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

/** `OcupacionSalones` — forma real de `salones.service.ts` `ocupacion()`. */
const OCUPACION = { mesasOcupadas: 14, mesasTotal: 20, cuentasAbiertas: 16 }

/** `CajonEstado[]` — forma real de `caja.service.ts` `cajonesEstado()`. */
const CAJONES_ESTADO = [
  {
    cajonId: 'cajon-1',
    nombre: 'Mostrador',
    sesion: {
      cajaId: 'caja-1',
      usuarioId: 'user-1',
      usuarioNombre: 'Ana Cajera',
      saldoInicial: '500.0000',
      saldoEsperado: '750.0000',
      fechaApertura: '2026-09-18T12:00:00.000Z',
      esPropia: false,
    },
  },
  { cajonId: 'cajon-2', nombre: 'Terraza', sesion: null },
]

/** `ResumenDescuadresDia` — forma real de `caja.service.ts` `resumenDescuadresDia()`. */
const RESUMEN_DESCUADRES = {
  fecha: '2026-09-18',
  cierres: 4,
  conDescuadre: 3,
  nivelAviso: 2,
  nivelAlto: 1,
  altoSinRevisar: 1,
  efectivoSuma: '-9500.0000',
}

let llamadas: string[] = []
/** Fragmentos de URL que en este test deben responder 403 en vez de 200. */
let falla403: string[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve(null)
    llamadas.push(url)
    if (falla403.some(f => url.includes(f))) {
      return Promise.reject({ response: { status: 403 } })
    }
    if (url.includes('/salones/ocupacion')) return Promise.resolve(OCUPACION)
    if (url.includes('/caja/cajones-estado')) return Promise.resolve(CAJONES_ESTADO)
    if (url.includes('/caja/resumen-descuadres-dia')) return Promise.resolve(RESUMEN_DESCUADRES)
    return Promise.resolve(null)
  }
})

async function montar() {
  const wrapper = await mountSuspended(Index)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

beforeEach(() => {
  llamadas = []
  permisos = []
  esAdmin = false
  falla403 = []
})

describe('zona "Ahora" — un bloque sin permiso no hace su llamada', () => {
  it('sin "Salones: Ver todas" no pide /salones/ocupacion', async () => {
    permisos = ['Cajas:Leer']
    const wrapper = await montar()

    expect(llamadas.some(u => u.includes('/salones/ocupacion'))).toBe(false)

    wrapper.unmount()
  })

  it('sin "Cajas: Leer" no pide ninguna de las dos rutas de caja', async () => {
    permisos = ['Salones:Ver todas']
    const wrapper = await montar()

    expect(llamadas.some(u => u.includes('/caja/cajones-estado'))).toBe(false)
    expect(llamadas.some(u => u.includes('/caja/resumen-descuadres-dia'))).toBe(false)

    wrapper.unmount()
  })

  it('sin ningún permiso, ninguna de las tres rutas se pide', async () => {
    const wrapper = await montar()

    expect(llamadas).toEqual([])

    wrapper.unmount()
  })
})

describe('zona "Ahora" — con permiso, pide y muestra', () => {
  it('con "Cajas: Leer" se piden las dos rutas de caja', async () => {
    permisos = ['Cajas:Leer']
    const wrapper = await montar()

    expect(llamadas.some(u => u.includes('/caja/cajones-estado'))).toBe(true)
    expect(llamadas.some(u => u.includes('/caja/resumen-descuadres-dia'))).toBe(true)

    wrapper.unmount()
  })

  it('el texto de ocupación sale de la respuesta de /salones/ocupacion', async () => {
    permisos = ['Salones:Ver todas']
    const wrapper = await montar()

    expect(wrapper.text()).toContain('14 de 20 mesas ocupadas')
    expect(wrapper.text()).toContain('16 cuentas abiertas')

    wrapper.unmount()
  })

  it('el bloque de Cajas muestra el cajón abierto y quién lo tiene, sin montos', async () => {
    permisos = ['Cajas:Leer']
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Mostrador')
    expect(wrapper.text()).toContain('Ana Cajera')
    // Sin montos: ni el saldo inicial ni el esperado del cajón abierto.
    expect(wrapper.text()).not.toContain('750')
    expect(wrapper.text()).not.toContain('500')

    wrapper.unmount()
  })

  it('un admin de un tenant que no contrató el módulo (403) lo oculta sin aviso de error', async () => {
    // `esAdmin` deja pasar el `v-if` de la página (spec § 6: el frontend no
    // sabe qué módulos contrató el tenant) — el bloque se esconde solo cuando
    // su propio `useRefrescoPeriodico` recibe el 403 de `/salones/ocupacion`.
    esAdmin = true
    falla403 = ['/salones/ocupacion']
    const wrapper = await montar()

    expect(llamadas.some(u => u.includes('/salones/ocupacion'))).toBe(true)
    expect(wrapper.text()).not.toContain('mesas ocupadas')
    expect(wrapper.text()).not.toContain('Sin conexión')

    wrapper.unmount()
  })
})
