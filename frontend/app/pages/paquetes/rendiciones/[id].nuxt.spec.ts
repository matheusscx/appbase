// @vitest-environment nuxt
//
// La planilla de una rendición, con la forma de la del cliente: un día por fila, una columna por
// tarifa, lo cobrado por medio, el neto y abajo totales, entregas y saldo.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Planilla from './[id].vue'
import type { RendicionDetalle } from '~/types/paqueteria'

let rendicion: RendicionDetalle
let falla: string | null = null
let urls: string[] = []

mockNuxtImport('useRoute', () => () => ({ params: { id: 'rend-1' }, query: {} }))
mockNuxtImport('useApiFetch', () => {
  return async (url: string) => {
    urls.push(url)
    if (falla) return Promise.reject({ status: 404, data: { message: falla } })
    return rendicion
  }
})

const SEMANA: RendicionDetalle = {
  id: 'rend-1',
  repartidorId: 'r-1',
  repartidorNombre: 'Juan Pérez',
  rendidaEl: '2026-10-10T18:30:00.000Z',
  tarifas: [
    { id: 't-bici', nombre: 'Bicicleta', monto: '1900' },
    { id: 't-colina', nombre: 'Colina', monto: '4000' },
  ],
  dias: [
    {
      hojaId: 'h-1',
      fecha: '2026-10-05',
      porTarifa: { 't-bici': 40 },
      entregados: 40,
      montoPagoRepartidor: '76000',
      montoCobradoEfectivo: '10000',
      montoCobradoTransferencia: '0',
      neto: '-66000',
    },
    {
      hojaId: 'h-2',
      fecha: '2026-10-06',
      porTarifa: { 't-bici': 195, 't-colina': 1 },
      entregados: 196,
      montoPagoRepartidor: '374500',
      montoCobradoEfectivo: '2178',
      montoCobradoTransferencia: '10000',
      neto: '-362322',
    },
  ],
  entregas: [{
    id: 'e-1',
    repartidorId: 'r-1',
    repartidorNombre: 'Juan Pérez',
    fecha: '2026-10-08',
    monto: '5000',
    medio: 'transferencia',
    nota: 'Adelanto',
    rendicionId: 'rend-1',
    creadoEl: '2026-10-08T12:00:00.000Z',
  }],
  totales: {
    entregados: 236,
    montoCobradoDestino: '22178',
    montoCobradoEfectivo: '12178',
    montoCobradoTransferencia: '10000',
    montoPagoRepartidor: '450500',
    montoEntregadoACuenta: '5000',
    saldo: '-433322',
  },
}

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
  const wrapper = await mountSuspended(Planilla, { attachTo: document.body })
  await esperar(60)
  return wrapper
}

const qa = (id: string) => document.body.querySelector<HTMLElement>(`[data-qa="${id}"]`)
const texto = (id: string) => qa(id)?.textContent?.replace(/\s+/g, ' ').trim()
const celdas = (id: string) => Array.from(qa(id)!.querySelectorAll('th, td')).map(c => c.textContent?.replace(/\s+/g, ' ').trim())

beforeEach(() => {
  document.body.innerHTML = ''
  urls = []
  falla = null
  rendicion = SEMANA
})

describe('planilla de la rendición', () => {
  it('pide la rendición del id de la ruta', async () => {
    await montar()

    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/\/rendiciones\/rend-1$/)
    expect(texto('rendicion-repartidor')).toBe('Juan Pérez')
  })

  it('tiene una columna por tarifa usada, con su monto', async () => {
    await montar()

    expect(texto('rendicion-col-t-bici')).toBe('Bicicleta $1.900')
    expect(texto('rendicion-col-t-colina')).toBe('Colina $4.000')
    expect(qa('rendicion-col-sin_tarifa')).toBeNull()
  })

  it('una fila por día con cantidades por tarifa, pago, cobrado por medio y neto', async () => {
    await montar()

    expect(celdas('rendicion-dia-2026-10-06')).toEqual([
      '06-10', '195', '1', '196', '$374.500', '$2.178', '$10.000', 'Se le pagan $362.322',
    ])
    expect(celdas('rendicion-dia-2026-10-05').slice(0, 4)).toEqual(['05-10', '40', '', '40'])
  })

  it('el pie suma las cantidades y trae los totales del servidor', async () => {
    await montar()

    expect(celdas('rendicion-totales')).toEqual([
      'Totales', '235', '1', '236', '$450.500', '$12.178', '$10.000', '',
    ])
  })

  it('lista las entregas de plata y cierra con el saldo en palabras', async () => {
    await montar()

    expect(texto('rendicion-entregas')).toContain('Transferencia')
    expect(texto('rendicion-entregas')).toContain('$5.000')
    expect(texto('rendicion-entregado')).toBe('$5.000')
    expect(texto('rendicion-saldo')).toBe('La empresa le paga $433.322')
    expect(qa('rendicion-saldo')!.className).toContain('text-error')
  })

  it('un saldo a favor de la empresa dice cuánto debe rendir', async () => {
    rendicion = { ...SEMANA, totales: { ...SEMANA.totales, saldo: '10000' } }
    await montar()

    expect(texto('rendicion-saldo')).toBe('Debe rendir $10.000')
    expect(qa('rendicion-saldo')!.className).not.toContain('text-error')
  })

  it('las entregas anteriores a las tarifas suman una columna «Sin tarifa»', async () => {
    rendicion = {
      ...SEMANA,
      dias: [{ ...SEMANA.dias[0]!, porTarifa: { sin_tarifa: 40 } }],
    }
    await montar()

    expect(texto('rendicion-col-sin_tarifa')).toBe('Sin tarifa')
  })

  it('lo que no se imprime lleva no-print y la planilla no', async () => {
    await montar()

    expect(qa('rendicion-imprimir')!.closest('.no-print')).not.toBeNull()
    expect(qa('rendicion-planilla')!.closest('.no-print')).toBeNull()
  })

  it('si no carga muestra el motivo y no ofrece imprimir', async () => {
    falla = 'No existe esa rendición'
    await montar()

    expect(texto('rendicion-error')).toBe('No existe esa rendición')
    expect(qa('rendicion-imprimir')).toBeNull()
  })
})
