import { describe, expect, it } from 'vitest'
import {
  calcularDiferenciaRecuento,
  claseDiferenciaRecuento,
  contarLineasAMover,
  contarLineasSinCausa,
  estadoRecuentoColor,
  estadoRecuentoLabel,
} from './useRecuentoInventario'

describe('calcularDiferenciaRecuento', () => {
  it('devuelve null si no hay conteo cargado', () => {
    expect(calcularDiferenciaRecuento(null, '10.0000')).toBeNull()
    expect(calcularDiferenciaRecuento(undefined, '10.0000')).toBeNull()
    expect(calcularDiferenciaRecuento('', '10.0000')).toBeNull()
    expect(calcularDiferenciaRecuento('  ', '10.0000')).toBeNull()
  })

  it('calcula el delta contado − sistema, igual que el backend', () => {
    expect(calcularDiferenciaRecuento('8', '10.0000')).toBe('-2.0000')
    expect(calcularDiferenciaRecuento('15', '10.0000')).toBe('5.0000')
    expect(calcularDiferenciaRecuento('10', '10.0000')).toBe('0.0000')
  })

  it('devuelve null ante un valor no numérico (input a medio escribir)', () => {
    expect(calcularDiferenciaRecuento('abc', '10.0000')).toBeNull()
  })
})

describe('claseDiferenciaRecuento', () => {
  it('faltante en rojo, sobrante en verde, cero y null neutros', () => {
    expect(claseDiferenciaRecuento('-2.0000')).toBe('text-error')
    expect(claseDiferenciaRecuento('5.0000')).toBe('text-success')
    expect(claseDiferenciaRecuento('0.0000')).toBe('text-muted')
    expect(claseDiferenciaRecuento(null)).toBe('text-muted')
    expect(claseDiferenciaRecuento(undefined)).toBe('text-muted')
  })
})

describe('contarLineasAMover', () => {
  it('ignora líneas sin contar y deltas en cero', () => {
    const lineas = [
      { cantidadContada: null, diferencia: null },
      { cantidadContada: '10', diferencia: '0.0000' },
      { cantidadContada: '8', diferencia: '-2.0000' },
      { cantidadContada: '15', diferencia: '5.0000' },
    ]
    expect(contarLineasAMover(lineas)).toBe(2)
  })

  it('devuelve 0 si no hay ninguna línea contada con delta', () => {
    expect(contarLineasAMover([{ cantidadContada: null, diferencia: null }])).toBe(0)
  })
})

describe('contarLineasSinCausa', () => {
  const base = { cantidadContada: '8', diferencia: '-2.0000' }

  it('cuenta líneas con diferencia sin override cuando no hay causa default', () => {
    const lineas = [
      { ...base, motivoDiferenciaId: null },
      { ...base, motivoDiferenciaId: 'causa-1' },
    ]
    expect(contarLineasSinCausa(lineas, null)).toBe(1)
  })

  it('con causa default, las líneas sin override quedan cubiertas', () => {
    const lineas = [{ ...base, motivoDiferenciaId: null }]
    expect(contarLineasSinCausa(lineas, 'default-1')).toBe(0)
  })

  it('no exige causa en líneas sin contar o con delta cero', () => {
    const lineas = [
      { cantidadContada: null, diferencia: null, motivoDiferenciaId: null },
      { cantidadContada: '10', diferencia: '0.0000', motivoDiferenciaId: null },
    ]
    expect(contarLineasSinCausa(lineas, null)).toBe(0)
  })
})

describe('estadoRecuentoLabel / estadoRecuentoColor', () => {
  it('mapea los tres estados del ciclo de vida', () => {
    expect(estadoRecuentoLabel('borrador')).toBe('Borrador')
    expect(estadoRecuentoLabel('aplicado')).toBe('Aplicado')
    expect(estadoRecuentoLabel('cancelado')).toBe('Cancelado')
    expect(estadoRecuentoColor('borrador')).toBe('neutral')
    expect(estadoRecuentoColor('aplicado')).toBe('success')
    expect(estadoRecuentoColor('cancelado')).toBe('error')
  })
})
