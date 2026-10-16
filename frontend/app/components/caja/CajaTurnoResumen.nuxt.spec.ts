// @vitest-environment nuxt
//
// Auditoría UX 03.22: sin movimientos el resumen pintaba "+ $0" en verde y "- $0" en rojo.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Decimal from 'decimal.js'
import CajaTurnoResumen from './CajaTurnoResumen.vue'

const MONEDA_CLP = {
  monedaId: 'clp-1', nombre: 'Peso chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
  separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true, esOficial: true, valorDelDia: null,
}

async function montar(entradas: string, salidas: string) {
  useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
  return mountSuspended(CajaTurnoResumen, {
    props: {
      saldoInicial: '10000',
      totalEntradas: new Decimal(entradas),
      totalSalidas: new Decimal(salidas),
      saldoEsperado: new Decimal(10000).plus(entradas).minus(salidas),
    },
  })
}

describe('CajaTurnoResumen — el cero no grita', () => {
  it('sin movimientos, entradas y salidas van sin signo y sin color de estado', async () => {
    const w = await montar('0', '0')
    const cifras = w.findAll('[data-qa="total-entradas"], [data-qa="total-salidas"]')
    expect(cifras).toHaveLength(2)
    for (const c of cifras) {
      expect(c.text()).not.toMatch(/[+-]/)
      expect(c.classes()).toContain('text-muted')
      expect(c.classes()).not.toContain('text-success')
      expect(c.classes()).not.toContain('text-error')
    }
  })

  it('con movimientos conserva el signo y el color', async () => {
    const w = await montar('5000', '3500')
    expect(w.find('[data-qa="total-entradas"]').text()).toContain('+')
    expect(w.find('[data-qa="total-entradas"]').classes()).toContain('text-success')
    expect(w.find('[data-qa="total-salidas"]').text()).toContain('-')
    expect(w.find('[data-qa="total-salidas"]').classes()).toContain('text-error')
  })
})
