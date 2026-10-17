// @vitest-environment nuxt
//
// Lista de rendiciones: el rango por defecto, el filtro por repartidor y el saldo en palabras.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Lista from './index.vue'
import type { RendicionFila } from '~/types/paqueteria'

let urls: string[] = []
let filas: RendicionFila[] = []

mockNuxtImport('useApiFetch', () => {
  return async (url: string) => {
    urls.push(url)
    if (url.includes('/repartidores')) return [{ id: 'r-1', nombre: 'Juan Pérez', telefono: null, activo: true, tarifaPagoId: null }]
    return filas
  }
})

async function esperar(ms = 20) {
  await new Promise(r => setTimeout(r, ms))
}

async function montar() {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1',
    nombre: 'Peso chileno',
    codigoIso: 'CLP',
    simbolo: '$',
    decimales: 0,
    separadorDecimal: ',',
    separadorMiles: '.',
    locale: 'es-CL',
    habilitada: true,
    esOficial: true,
    valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(Lista, { attachTo: document.body })
  await esperar(80)
  return wrapper
}

const qa = (id: string) => document.body.querySelector<HTMLElement>(`[data-qa="${id}"]`)
const texto = (id: string) => qa(id)?.textContent?.replace(/\s+/g, ' ').trim()

beforeEach(() => {
  document.body.innerHTML = ''
  urls = []
  filas = [{
    id: 'rend-1',
    repartidorId: 'r-1',
    repartidorNombre: 'Juan Pérez',
    rendidaEl: '2026-10-10T18:30:00.000Z',
    desde: '2026-10-05',
    hasta: '2026-10-10',
    hojas: 6,
    totales: {
      entregados: 235,
      montoCobradoDestino: '22178',
      montoCobradoEfectivo: '22178',
      montoCobradoTransferencia: '0',
      montoPagoRepartidor: '446500',
      montoEntregadoACuenta: '0',
      saldo: '-424322',
    },
  }]
})

describe('lista de rendiciones', () => {
  it('pide el rango por defecto, sin filtro de repartidor', async () => {
    await montar()

    const pedido = urls.find(u => u.includes('/rendiciones?'))!
    expect(pedido).toMatch(/desde=\d{4}-\d{2}-\d{2}&hasta=\d{4}-\d{2}-\d{2}$/)
  })

  it('muestra el período, los entregados y el saldo en palabras, con enlace a la planilla', async () => {
    await montar()

    const fila = qa('rendiciones-fila-rend-1')!
    expect(fila.getAttribute('href')).toBe('/paquetes/rendiciones/rend-1')
    const celdas = document.body.querySelector('[data-qa="rendiciones-tabla"] tbody tr')!.textContent!.replace(/\s+/g, ' ')
    expect(celdas).toContain('05-10 al 10-10')
    expect(celdas).toContain('235')
    expect(celdas).toContain('$446.500')
    expect(celdas).toContain('La empresa le paga $424.322')
  })

  it('con la lista vacía invita a cambiar el rango', async () => {
    filas = []
    await montar()

    expect(texto('rendiciones-vacio')).toContain('No hay rendiciones en estas fechas')
  })

  it('tiene el acceso a una nueva rendición', async () => {
    await montar()

    expect(qa('rendiciones-nueva')!.getAttribute('href')).toBe('/paquetes/rendiciones/nueva')
  })
})
