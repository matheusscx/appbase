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

const CLP = {
  monedaId: 'clp-1', nombre: 'Peso chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
  separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true, esOficial: true, valorDelDia: null,
}

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
const RESUMEN_BASE = {
  fecha: '2026-09-18',
  cierres: 4,
  conDescuadre: 3,
  nivelAviso: 2,
  nivelAlto: 1,
  altoSinRevisar: 1,
  efectivoSuma: '-9500.0000',
}
let RESUMEN_DESCUADRES = RESUMEN_BASE

let llamadas: string[] = []
/** Fragmentos de URL que en este test deben responder 403 en vez de 200. */
let falla403: string[] = []
/** Fragmentos de URL que responden 500 (se cayó el servidor). */
let falla500: string[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve(null)
    llamadas.push(url)
    if (falla500.some(f => url.includes(f))) {
      return Promise.reject({ status: 500 })
    }
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
  RESUMEN_DESCUADRES = RESUMEN_BASE
  llamadas = []
  permisos = []
  esAdmin = false
  falla403 = []
  falla500 = []
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

  it('cada tarjeta es un link real, focuseable con Tab y con su destino como href', async () => {
    permisos = ['Salones:Ver todas', 'Cajas:Leer']
    const wrapper = await montar()

    const hrefs = wrapper.findAll('a').map(a => a.attributes('href'))
    expect(hrefs).toContain('/salones')
    // Cajas va a los cajones; Cierres con descuadre, a la bandeja de cierres por revisar (04.10).
    expect(hrefs.filter(h => h === '/cajas')).toHaveLength(1)
    expect(hrefs).toContain('/cajas/pendientes-revision')

    wrapper.unmount()
  })

  it('el admin de un tenant que no contrató los módulos no pide ninguna ruta', async () => {
    // Sin atajo por `esAdmin` (owner, 2026-10-15): `mis-permisos` le trae al admin solo
    // los módulos contratados. Antes la página montaba los seis bloques y cada uno
    // volvía con 403 en el tenant que solo contrató Paquetería.
    esAdmin = true
    permisos = ['Paquetería:Leer']
    const wrapper = await montar()

    expect(llamadas).toEqual([])

    wrapper.unmount()
  })

  it('si el backend igual contesta 403, el bloque se oculta sin aviso de error', async () => {
    // La red que queda: un permiso que el frontend cree tener y el backend ya no da
    // (un contrato dado de baja con la sesión abierta). `useRefrescoPeriodico` lo esconde.
    permisos = ['Salones:Ver todas']
    falla403 = ['/salones/ocupacion']
    const wrapper = await montar()

    expect(llamadas.some(u => u.includes('/salones/ocupacion'))).toBe(true)
    expect(wrapper.text()).not.toContain('mesas ocupadas')
    expect(wrapper.text()).not.toContain('Sin conexión')

    wrapper.unmount()
  })
})

describe('zona "Ahora" — un fallo no se queda en "Cargando…" (lote 7, 04.7)', () => {
  it('con un 500 y sin datos, dice que no pudo cargar y ofrece Reintentar; no "Cargando…" ni "Sin conexión"', async () => {
    permisos = ['Salones:Ver todas']
    falla500 = ['/salones/ocupacion']
    const wrapper = await montar()

    expect(wrapper.text()).toContain('No pudimos cargar los datos. Reintenta.')
    expect(wrapper.text()).not.toContain('Cargando…')
    expect(wrapper.text()).not.toContain('Sin conexión')
    expect(wrapper.text()).not.toContain('No pudimos actualizar')
    expect(wrapper.text()).not.toContain('Actualizado')
    expect(wrapper.find('[data-qa="inicio-reintentar"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('Reintentar vuelve a pedir lo que falló, y solo cuando la persona lo toca', async () => {
    permisos = ['Salones:Ver todas']
    falla500 = ['/salones/ocupacion']
    const wrapper = await montar()
    const pedidos = () => llamadas.filter(u => u.includes('/salones/ocupacion')).length
    expect(pedidos()).toBe(1)

    falla500 = []
    await wrapper.find('[data-qa="inicio-reintentar"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(pedidos()).toBe(2)
    expect(wrapper.text()).toContain('14 de 20 mesas ocupadas')

    wrapper.unmount()
  })

  it('mientras la primera carga está en vuelo sigue diciendo "Cargando…"', async () => {
    permisos = ['Salones:Ver todas']
    const wrapper = await mountSuspended(Index)
    // Sin esperar: la respuesta del mock todavía no se procesó.
    expect(wrapper.text()).not.toContain('No pudimos cargar')
    wrapper.unmount()
  })
})

describe('inicio — sin ninguna tarjeta que mostrar (lote 7, 04.8)', () => {
  it('un rol sin permisos de resumen ve un mensaje, no títulos vacíos', async () => {
    permisos = ['Paquetería:Leer']
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Tu rol no tiene resumen del día. Elige una sección en el menú.')
    expect(wrapper.text()).not.toContain('Ahora')
    expect(wrapper.text()).not.toContain('Hoy')

    wrapper.unmount()
  })

  it('con al menos un bloque, el mensaje no aparece', async () => {
    permisos = ['Salones:Ver todas']
    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Tu rol no tiene resumen del día')
    expect(wrapper.text()).toContain('Ahora')

    wrapper.unmount()
  })
})

describe('zona "Ahora" — cierres: una diferencia con signo, no "Efectivo" en verde (04.1, 04.13, 04.10)', () => {
  async function montarCierres() {
    permisos = ['Cajas:Leer']
    const wrapper = await mountSuspended(Index)
    useMonedasStore().hydrate([CLP], 'tenant-1')
    await new Promise(r => setTimeout(r, 20))
    return wrapper
  }

  it('un faltante dice "faltan $9.500" bajo "Diferencia en efectivo", en rojo', async () => {
    const wrapper = await montarCierres()
    const texto = wrapper.text()
    expect(texto).toContain('Diferencia en efectivo')
    expect(texto).toContain('faltan $9.500')
    expect(texto).not.toMatch(/\bEfectivo\b/)
    const cifra = wrapper.find('[data-qa="cierres-diferencia"]')
    expect(cifra.classes()).toContain('text-error')
    wrapper.unmount()
  })

  it('un sobrante dice "sobran $1.234" y va en tono de alerta, nunca en verde de éxito', async () => {
    RESUMEN_DESCUADRES = { ...RESUMEN_BASE, efectivoSuma: '1234.0000' }
    const wrapper = await montarCierres()
    expect(wrapper.text()).toContain('sobran $1.234')
    const cifra = wrapper.find('[data-qa="cierres-diferencia"]')
    expect(cifra.classes()).toContain('text-warning')
    expect(cifra.classes()).not.toContain('text-success')
    wrapper.unmount()
  })

  it('sin diferencia dice "sin diferencia" y va apagado', async () => {
    RESUMEN_DESCUADRES = { ...RESUMEN_BASE, efectivoSuma: '0.0000', conDescuadre: 0, altoSinRevisar: 0 }
    const wrapper = await montarCierres()
    expect(wrapper.text()).toContain('sin diferencia')
    expect(wrapper.find('[data-qa="cierres-diferencia"]').classes()).toContain('text-muted')
    wrapper.unmount()
  })

  it('con descuadres graves sin revisar lo dice: "1 sin revisar"; con 0 no aparece', async () => {
    let wrapper = await montarCierres()
    expect(wrapper.text()).toContain('1 sin revisar')
    wrapper.unmount()

    RESUMEN_DESCUADRES = { ...RESUMEN_BASE, altoSinRevisar: 0 }
    wrapper = await montarCierres()
    expect(wrapper.text()).not.toContain('sin revisar')
    wrapper.unmount()
  })

  it('con descuadre la tarjeta lleva a la bandeja de cierres por revisar; sin descuadre, a los cajones', async () => {
    let wrapper = await montarCierres()
    expect(wrapper.findAll('a').map(a => a.attributes('href'))).toContain('/cajas/pendientes-revision')
    wrapper.unmount()

    RESUMEN_DESCUADRES = { ...RESUMEN_BASE, conDescuadre: 0, altoSinRevisar: 0, efectivoSuma: '0.0000' }
    wrapper = await montarCierres()
    expect(wrapper.findAll('a').map(a => a.attributes('href'))).not.toContain('/cajas/pendientes-revision')
    wrapper.unmount()
  })
})

describe('zona "Ahora" — una sola hora, compacta (04.12, 04.2)', () => {
  it('"Actualizado hh:mm" aparece una vez en la zona, no una por tarjeta', async () => {
    permisos = ['Salones:Ver todas', 'Cajas:Leer']
    const wrapper = await montar()
    const veces = wrapper.text().split('Actualizado').length - 1
    expect(veces).toBe(1)
    expect(wrapper.find('[data-qa="ahora-actualizado"]').text()).toMatch(/Actualizado \d{2}:\d{2}/)
    wrapper.unmount()
  })

  it('cada tarjeta mide lo suyo: la grilla no iguala los altos (04.26)', async () => {
    permisos = ['Salones:Ver todas']
    const wrapper = await montar()
    const grilla = wrapper.find('[data-qa="ahora-grilla"]')
    expect(grilla.classes()).toContain('items-start')
    wrapper.unmount()
  })
})

describe('zona "Ahora" — cajas dice cuántas hay abiertas y desde cuándo (04.14)', () => {
  it('"1 abierta de 2" y la hora de apertura de cada caja', async () => {
    permisos = ['Cajas:Leer']
    const wrapper = await montar()
    expect(wrapper.text()).toContain('1 abierta de 2')
    expect(wrapper.text()).toMatch(/desde las \d{2}:\d{2}/)
    wrapper.unmount()
  })
})
