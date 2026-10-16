// @vitest-environment nuxt
//
// El panel de soporte de `/admin` contra un `useApiFetch` simulado. Ojo con lo que NO prueba: ese
// mock contesta 200 a todo, así que el candado de superadmin (`admin.spec.ts`) y el 403 real del
// endpoint no se ejercen acá; la forma de la respuesta la fija el e2e de la API.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Admin from './admin.vue'
import type { BoletaConProblemaSoporte } from '~/composables/usePerfilFiscal'

let filas: BoletaConProblemaSoporte[] = []
/** Si es `true`, `GET /admin/dte/boletas-con-problemas` falla. */
let falla = false
let llamadas: string[] = []
let toasts: { title: string, color?: string }[] = []

function fila(over: Partial<BoletaConProblemaSoporte> = {}): BoletaConProblemaSoporte {
  return {
    documentoId: 'doc-1',
    tenantId: 'tenant-1',
    tenant: 'Almacén Paris',
    razonSocial: 'Almacén Paris SpA',
    ambiente: 'produccion',
    tipo: 39,
    folio: 1234,
    emitidaEl: '2026-10-13T15:00:00.000Z',
    grupo: 'atrasada',
    intentos: 3,
    ultimoError: null,
    detalleSii: null,
    envioEstadoSii: null,
    envioUltimoError: null,
    tenantDadoDeBaja: false,
    ...over,
  }
}

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title: string, color?: string }) => { toasts.push(t) } })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    llamadas.push(url)
    if (url.endsWith('/admin/dte/boletas-con-problemas')) {
      return falla
        ? Promise.reject(Object.assign(new Error('500'), { data: { message: 'No se pudo leer' } }))
        : Promise.resolve(structuredClone(filas))
    }
    return Promise.resolve({})
  }
})

async function montar() {
  const wrapper = await mountSuspended(Admin)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

beforeEach(() => {
  filas = []
  falla = false
  llamadas = []
  toasts = []
})

describe('pages/admin — panel de soporte', () => {
  it('una boleta de cada grupo muestra el local, el folio y el estado', async () => {
    filas = [
      fila({ documentoId: 'doc-a', tenant: 'Almacén Paris', folio: 9001, grupo: 'atrasada', tipo: 39, intentos: 4 }),
      fila({
        documentoId: 'doc-r', tenant: 'Restaurante Lyon', razonSocial: null, folio: 9002, grupo: 'rechazada', tipo: 41,
        ambiente: 'certificacion', intentos: 1,
      }),
    ]

    const wrapper = await montar()
    const tarjeta = wrapper.find('[data-qa="soporte-boletas"]')

    expect(tarjeta.text()).toContain('Boletas con problemas en el SII')
    expect(llamadas).toContain(`${useRuntimeConfig().public.apiUrl}/admin/dte/boletas-con-problemas`)
    const texto = tarjeta.text()
    expect(texto).toContain('Almacén Paris')
    expect(texto).toContain('9001')
    expect(texto).toContain('Atrasada')
    expect(texto).toContain('Restaurante Lyon')
    expect(texto).toContain('9002')
    expect(texto).toContain('Rechazada')
    expect(texto).toContain('Exenta')
    expect(texto).toContain('Afecta')
    expect(texto).toContain('13-10-2026')
    expect(tarjeta.find('[data-qa="soporte-sin-problemas"]').exists()).toBe(false)
    expect(tarjeta.find('[data-qa="soporte-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('un local dado de baja lleva la marca "Dado de baja"; uno vivo, no', async () => {
    filas = [
      fila({ documentoId: 'doc-baja', tenant: 'Almacén Cerrado', tenantDadoDeBaja: true }),
      fila({ documentoId: 'doc-viva', tenant: 'Almacén Abierto', tenantDadoDeBaja: false }),
    ]

    const wrapper = await montar()
    const filasTabla = wrapper.findAll('tbody tr')
    const filaBaja = filasTabla.at(0)!
    const filaViva = filasTabla.at(1)!

    expect(filaBaja.text()).toContain('Almacén Cerrado')
    expect(filaBaja.find('[data-qa="soporte-local-de-baja"]').text()).toBe('Dado de baja')
    expect(filaViva.text()).toContain('Almacén Abierto')
    expect(filaViva.find('[data-qa="soporte-local-de-baja"]').exists()).toBe(false)
    expect(filaViva.text()).not.toContain('Dado de baja')
    wrapper.unmount()
  })

  it('una razón social null se muestra como guion', async () => {
    filas = [fila({ razonSocial: null })]

    const wrapper = await montar()
    const celdas = wrapper.findAll('tbody tr').at(0)!.findAll('td').map(td => td.text())

    expect(celdas).toContain('—')
    expect(celdas).not.toContain('null')
    wrapper.unmount()
  })

  it('desplegar una fila muestra el último error y el detalle del SII', async () => {
    filas = [fila({
      grupo: 'rechazada',
      ultimoError: 'El SII rechazó el sobre',
      detalleSii: { estado: 'RCH', glosa: 'Folio repetido' },
    })]

    const wrapper = await montar()
    expect(wrapper.text()).not.toContain('Folio repetido')

    await wrapper.find('[data-qa="soporte-desplegar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    const detalle = wrapper.find('[data-qa="soporte-detalle"]')
    expect(detalle.exists()).toBe(true)
    expect(detalle.text()).toContain('El SII rechazó el sobre')
    expect(detalle.find('pre').text()).toBe(JSON.stringify({ estado: 'RCH', glosa: 'Folio repetido' }, null, 2))
    wrapper.unmount()
  })

  it('una atrasada trabada muestra el estado y el último error de su envío', async () => {
    filas = [fila({
      grupo: 'atrasada',
      envioEstadoSii: 'XYZ',
      envioUltimoError: 'El SII contestó un código que no conocemos <b>x</b>',
    })]

    const wrapper = await montar()
    await wrapper.find('[data-qa="soporte-desplegar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    const detalle = wrapper.find('[data-qa="soporte-detalle"]')
    expect(detalle.find('[data-qa="soporte-envio-estado"]').text()).toBe('Estado del envío en el SII: XYZ')
    // Interpolación: el texto del SII se muestra tal cual, no se interpreta como HTML.
    expect(detalle.find('[data-qa="soporte-envio-error"]').text()).toBe(
      'Último error del envío: El SII contestó un código que no conocemos <b>x</b>',
    )
    expect(detalle.find('[data-qa="soporte-envio-error"] b').exists()).toBe(false)
    wrapper.unmount()
  })

  it('sin envío el desplegable no pinta las líneas del envío', async () => {
    filas = [fila({ envioEstadoSii: null, envioUltimoError: null })]

    const wrapper = await montar()
    await wrapper.find('[data-qa="soporte-desplegar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    const detalle = wrapper.find('[data-qa="soporte-detalle"]')
    expect(detalle.find('[data-qa="soporte-envio-estado"]').exists()).toBe(false)
    expect(detalle.find('[data-qa="soporte-envio-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('sin ultimoError ni detalleSii el desplegable lo dice y no pinta un null', async () => {
    filas = [fila({ ultimoError: null, detalleSii: null })]

    const wrapper = await montar()
    await wrapper.find('[data-qa="soporte-desplegar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    const detalle = wrapper.find('[data-qa="soporte-detalle"]')
    expect(detalle.exists()).toBe(true)
    expect(detalle.find('pre').exists()).toBe(false)
    expect(detalle.text()).toContain('Sin detalle del SII')
    expect(detalle.text()).not.toContain('null')
    wrapper.unmount()
  })

  it('sin boletas con problemas lo dice', async () => {
    filas = []

    const wrapper = await montar()

    expect(wrapper.find('[data-qa="soporte-sin-problemas"]').text()).toBe('Ningún local tiene boletas con problemas.')
    expect(wrapper.find('[data-qa="soporte-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('una lectura que falla avisa con un toast y no dice que ningún local tiene problemas', async () => {
    falla = true

    const wrapper = await montar()

    expect(toasts).toEqual([{ title: 'No se pudo leer', color: 'error' }])
    expect(wrapper.find('[data-qa="soporte-error"]').text()).toBe('No se pudo leer el estado de las boletas en el SII.')
    expect(wrapper.find('[data-qa="soporte-sin-problemas"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Ningún local tiene boletas con problemas.')
    wrapper.unmount()
  })
})
