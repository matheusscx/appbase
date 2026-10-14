// @vitest-environment nuxt
//
// La pantalla de Boleta electrónica contra un `useApiFetch` simulado. Ojo con lo que NO prueba:
// ese mock contesta 200 a todo, así que el 400 real del certificado o del CAF (RUT ajeno, folios
// repetidos, archivo que no es un .pfx) lo cubre Playwright, no este archivo.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import BoletaElectronica from './boleta-electronica.vue'
import type { CafPerfil, PerfilFiscal } from '~/composables/usePerfilFiscal'

function caf(over: Partial<CafPerfil> = {}): CafPerfil {
  return {
    id: 'caf-1',
    tipo: 39,
    ambiente: 'certificacion',
    desde: 1,
    hasta: 50,
    usados: 0,
    restantes: 50,
    fechaAutorizacion: '2026-10-01',
    idk: 100,
    borrable: true,
    ...over,
  }
}

function perfilCompleto(over: Partial<PerfilFiscal> = {}): PerfilFiscal {
  return {
    emisor: {
      razonSocialId: 'rs-1',
      nombre: 'Almacén Paris SpA',
      rut: '12.345.678-5',
      direccion: 'Av. Ejemplo 123',
      giro: 'Venta de alimentos',
      comuna: 'Providencia',
      ambiente: 'certificacion',
      fechaResolucion: '2026-08-01',
      numeroResolucion: 0,
    },
    certificado: {
      id: 'cert-1',
      rutFirmante: '11.111.111-1',
      nombreFirmante: 'Firmante de Prueba',
      venceEl: '2027-03-15T12:00:00.000Z',
    },
    cafs: [caf()],
    faltantes: [],
    avisos: [],
    ...over,
  }
}

let perfil: PerfilFiscal = perfilCompleto()
let llamadas: { url: string, method: string, body?: Record<string, unknown> }[] = []
/** Cuántos `GET /dte/perfil` contestan bien antes de que el siguiente falle; `null` = ninguno falla. */
let getsBuenos: number | null = null
let toasts: { title: string, color?: string }[] = []

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title: string, color?: string }) => { toasts.push(t) } })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (url.endsWith('/dte/perfil') && method === 'GET') {
      if (getsBuenos !== null && getsBuenos-- <= 0) return Promise.reject(new Error('sin conexión'))
      return Promise.resolve(structuredClone(perfil))
    }
    return Promise.resolve({})
  }
})

async function montar() {
  const wrapper = await mountSuspended(BoletaElectronica)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

beforeEach(() => {
  perfil = perfilCompleto()
  llamadas = []
  getsBuenos = null
  toasts = []
})

describe('boleta electrónica', () => {
  it('con faltantes muestra cada mensaje y no dice que está lista', async () => {
    perfil = perfilCompleto({
      faltantes: [
        { codigo: 'SIN_GIRO', mensaje: 'Falta el giro de la empresa' },
        { codigo: 'SIN_CERTIFICADO', mensaje: 'Falta cargar el certificado digital' },
      ],
    })

    const wrapper = await montar()
    const texto = wrapper.text()

    expect(texto).toContain('Falta el giro de la empresa')
    expect(texto).toContain('Falta cargar el certificado digital')
    expect(texto).not.toContain('Lista para emitir')
    wrapper.unmount()
  })

  it('sin faltantes dice que está lista para emitir', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Lista para emitir')
    expect(wrapper.text()).not.toContain('Para emitir boletas falta')
    wrapper.unmount()
  })

  it('sin emisor manda a Razones sociales y no deja subir certificado ni folios', async () => {
    perfil = perfilCompleto({
      emisor: null,
      certificado: null,
      cafs: [],
      faltantes: [{ codigo: 'SIN_EMISOR', mensaje: 'Falta cargar los datos de la empresa que emite' }],
    })

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Marca una razón social como preferida')
    expect(wrapper.find('a[href="/configuracion/razones-sociales"]').exists()).toBe(true)
    const botones = wrapper.findAll('button')
    const subir = (nombre: string) => botones.find(b => b.text().includes(nombre))!
    expect(subir('Subir certificado').attributes('disabled')).toBeDefined()
    expect(subir('Subir CAF').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('"Borrar" aparece solo en el CAF borrable', async () => {
    perfil = perfilCompleto({
      cafs: [
        caf({ id: 'caf-libre', desde: 1, hasta: 50, borrable: true }),
        caf({ id: 'caf-usado', desde: 51, hasta: 100, usados: 3, restantes: 47, borrable: false }),
      ],
    })

    const wrapper = await montar()

    const filas = wrapper.findAll('tbody tr')
    expect(filas).toHaveLength(2)
    expect(filas[0]!.text()).toContain('Borrar')
    expect(filas[1]!.text()).not.toContain('Borrar')
    wrapper.unmount()
  })

  it('marca "otro ambiente" solo en el CAF que no es del ambiente del emisor', async () => {
    perfil = perfilCompleto({
      cafs: [
        caf({ id: 'a', ambiente: 'certificacion' }),
        caf({ id: 'b', ambiente: 'produccion', desde: 51, hasta: 100 }),
      ],
    })

    const wrapper = await montar()

    const filas = wrapper.findAll('tbody tr')
    expect(filas[0]!.text()).not.toContain('otro ambiente')
    expect(filas[1]!.text()).toContain('otro ambiente')
    wrapper.unmount()
  })

  it('muestra los avisos de folios y de certificado en su tarjeta', async () => {
    perfil = perfilCompleto({
      avisos: [
        { codigo: 'POCOS_FOLIOS', mensaje: 'Quedan 50 folios de boleta (39)' },
        { codigo: 'CERTIFICADO_POR_VENCER', mensaje: 'El certificado digital vence el 15-03-2027' },
      ],
    })

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Quedan 50 folios de boleta (39)')
    expect(wrapper.text()).toContain('El certificado digital vence el 15-03-2027')
    wrapper.unmount()
  })

  it('muestra el certificado con su vencimiento en el día de Chile', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Firmante de Prueba')
    expect(wrapper.text()).toContain('15-03-2027')
    wrapper.unmount()
  })

  it('guardar manda el PATCH y vuelve a pedir el perfil en vez de mezclar la respuesta', async () => {
    const wrapper = await montar()
    await wrapper.find('input[placeholder="Venta de alimentos"]').setValue('Restaurante')
    await wrapper.find('input[placeholder="Providencia"]').setValue('Ñuñoa')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    const patch = llamadas.find(l => l.method === 'PATCH')!
    expect(patch.url).toMatch(/\/dte\/perfil$/)
    expect(patch.body).toMatchObject({
      giro: 'Restaurante',
      comuna: 'Ñuñoa',
      ambienteSii: 'certificacion',
      fechaResolucion: '2026-08-01',
      // El 0 es un número válido (es el de la resolución de certificación): no se pierde.
      numeroResolucion: 0,
    })
    const gets = llamadas.filter(l => l.method === 'GET' && l.url.endsWith('/dte/perfil'))
    expect(gets).toHaveLength(2)
    wrapper.unmount()
  })

  // `UInput type="number"` entrega un number por el v-model, no el texto: un `.trim()` sobre eso
  // reventaba al guardar (visto en Playwright, no en el spec que no tocaba este campo).
  it('guardar con el número de resolución recién tipeado lo manda como número', async () => {
    const wrapper = await montar()
    await wrapper.find('input[type="number"]').setValue('7')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    const patch = llamadas.find(l => l.method === 'PATCH')!
    expect(patch.body).toMatchObject({ numeroResolucion: 7 })
    wrapper.unmount()
  })

  it('con el número de resolución vaciado no lo manda: ninguno de los campos acepta null', async () => {
    const wrapper = await montar()
    await wrapper.find('input[type="number"]').setValue('')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    const patch = llamadas.find(l => l.method === 'PATCH')!
    expect(patch.body).not.toHaveProperty('numeroResolucion')
    wrapper.unmount()
  })

  it('si el perfil no se puede volver a pedir tras guardar, avisa el error y no el éxito', async () => {
    const wrapper = await montar()
    getsBuenos = 0
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    expect(llamadas.some(l => l.method === 'PATCH')).toBe(true)
    expect(toasts.some(t => t.color === 'error')).toBe(true)
    expect(toasts.some(t => t.color === 'success')).toBe(false)
    wrapper.unmount()
  })

  it('guardar con el perfil de vuelta avisa el éxito', async () => {
    const wrapper = await montar()
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    expect(toasts).toEqual([{ title: 'Datos de la empresa guardados', color: 'success' }])
    wrapper.unmount()
  })
})
