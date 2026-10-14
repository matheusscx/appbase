import { describe, it, expect } from 'vitest'
import { archivoABase64, etiquetaAmbiente, etiquetaTipoBoleta, formatoFecha } from './usePerfilFiscal'

describe('archivoABase64', () => {
  it('codifica los bytes tal cual, sin pasar por un decodificador de texto', async () => {
    // 0xD1 es la Ñ de ISO-8859-1 y 0x9F no es UTF-8 válido: un TextDecoder los
    // cambiaría por U+FFFD y el CAF firmaría otros bytes que los del SII.
    const file = new File([new Uint8Array([0x3C, 0xD1, 0x9F])], 'caf.xml')
    expect(await archivoABase64(file)).toBe('PNGf')
  })

  it('un archivo más grande que un trozo se codifica entero', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256)
    const esperado = Buffer.from(bytes).toString('base64')
    expect(await archivoABase64(new File([bytes], 'grande.pfx'))).toBe(esperado)
  })

  it('un archivo vacío da el texto vacío', async () => {
    expect(await archivoABase64(new File([], 'vacio.xml'))).toBe('')
  })
})

describe('etiquetaTipoBoleta', () => {
  it('nombra los dos tipos de boleta', () => {
    expect(etiquetaTipoBoleta(39)).toBe('Boleta (39)')
    expect(etiquetaTipoBoleta(41)).toBe('Boleta exenta (41)')
  })
})

describe('etiquetaAmbiente', () => {
  it('dice pruebas y producción en palabras del local', () => {
    expect(etiquetaAmbiente('certificacion')).toBe('Certificación (pruebas)')
    expect(etiquetaAmbiente('produccion')).toBe('Producción')
  })
})

describe('formatoFecha', () => {
  it('un día sin hora se da vuelta sin pasar por zonas', () => {
    expect(formatoFecha('2027-03-15')).toBe('15-03-2027')
  })

  it('un instante se muestra en el día de Chile', () => {
    expect(formatoFecha('2027-03-15T12:00:00.000Z')).toBe('15-03-2027')
    // 02:00 UTC del 16 es todavía el 15 en Santiago (UTC-3 en marzo).
    expect(formatoFecha('2027-03-16T02:00:00.000Z')).toBe('15-03-2027')
  })
})
