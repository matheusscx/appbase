import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import {
  formatMontoDisplay,
  formatMontoManual,
  isIso4217Currency,
  parseMontoInput,
} from './currency-format'
import type { MonedaDisplayConfig } from '~/types/moneda'

const clp: MonedaDisplayConfig = {
  monedaId: '1',
  codigoIso: 'CLP',
  nombre: 'Peso Chileno',
  locale: 'es-CL',
  prefix: '$\u00a0',
  thousands: '.',
  decimal: ',',
  decimals: 0,
  habilitada: true,
  esOficial: true,
  esDefault: true,
  valorDelDia: '1',
}

const usd: MonedaDisplayConfig = {
  monedaId: '2',
  codigoIso: 'USD',
  nombre: 'Dólar',
  locale: 'en-US',
  prefix: '$',
  thousands: ',',
  decimal: '.',
  decimals: 2,
  habilitada: true,
  esOficial: false,
  esDefault: false,
  valorDelDia: '950',
}

const uf: MonedaDisplayConfig = {
  monedaId: '3',
  codigoIso: 'UF',
  nombre: 'UF',
  locale: 'es-CL',
  prefix: '$\u00a0',
  thousands: '.',
  decimal: ',',
  decimals: 4,
  habilitada: true,
  esOficial: false,
  esDefault: false,
  valorDelDia: null,
}

describe('isIso4217Currency', () => {
  it('CLP y USD son ISO', () => {
    expect(isIso4217Currency('CLP')).toBe(true)
    expect(isIso4217Currency('USD')).toBe(true)
  })

  it('UF no es ISO', () => {
    expect(isIso4217Currency('UF')).toBe(false)
  })
})

describe('formatMontoDisplay', () => {
  it('formatea CLP con Intl sin decimales', () => {
    const result = formatMontoDisplay('1500000', clp)
    expect(result).toContain('1')
    expect(result).toContain('500')
    expect(result).not.toMatch(/,\d{2}$/)
  })

  it('formatea USD con Intl', () => {
    const result = formatMontoDisplay('1500.5', usd)
    expect(result).toContain('1,500.50')
  })

  it('UF usa fallback manual con 4 decimales', () => {
    const result = formatMontoDisplay('1234.5678', uf)
    expect(result).toBe('$\u00a01.234,5678')
  })

  it('vacío devuelve em dash', () => {
    expect(formatMontoDisplay('', clp)).toBe('—')
    expect(formatMontoDisplay(null, clp)).toBe('—')
  })
})

describe('parseMontoInput', () => {
  it('parsea CLP con separadores chilenos', () => {
    expect(parseMontoInput('$ 1.500.000', clp).toString()).toBe('1500000')
  })

  it('parsea USD', () => {
    expect(parseMontoInput('$1,500.50', { ...usd, prefix: '$' }).toString()).toBe('1500.5')
  })

  it('round-trip manual UF', () => {
    const raw = formatMontoManual(new Decimal('99.1234'), uf)
    expect(parseMontoInput(raw, uf).toFixed(4)).toBe('99.1234')
  })
})
