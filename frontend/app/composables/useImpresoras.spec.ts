import { describe, expect, it } from 'vitest'
import { buildEscposPrintData, buildQzConfigOptions } from './useImpresoras'

describe('useImpresoras raw ESC/POS encoding', () => {
  it('configura QZ con Cp850 para conservar acentos en impresoras térmicas', () => {
    expect(buildQzConfigOptions()).toEqual({ encoding: 'Cp850' })
  })

  it('selecciona la code page CP850 antes del texto y conserva corte al final', () => {
    const data = buildEscposPrintData(['Garzón: José', 'comentario: sin sal'])

    expect(data[0]).toBe('\x1B\x74\x02')
    expect(data[1]).toBe('Garzón: José\ncomentario: sin sal\n')
    expect(data[2]).toBe('\x1B\x64\x04\x1D\x56\x00')
  })
})
