import { describe, it, expect } from 'vitest'
import {
  archivoABase64, etiquetaAmbiente, etiquetaTipoBoleta, etiquetaGrupoSoporte, etiquetaTipoCorta, formatoFecha, pistaDelGrupo, resumenEmision, textoParaEmitir,
} from './usePerfilFiscal'

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

describe('etiquetaTipoCorta', () => {
  it('dice Afecta o Exenta, sin el código del SII', () => {
    expect(etiquetaTipoCorta(39)).toBe('Afecta')
    expect(etiquetaTipoCorta(41)).toBe('Exenta')
  })
})

describe('etiquetaGrupoSoporte', () => {
  it('atrasada es aviso y rechazada es error', () => {
    expect(etiquetaGrupoSoporte('atrasada')).toEqual({ label: 'Atrasada', color: 'warning' })
    expect(etiquetaGrupoSoporte('rechazada')).toEqual({ label: 'Rechazada', color: 'error' })
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

describe('textoParaEmitir', () => {
  it('une los faltantes con el mismo texto que el 400 del servidor', () => {
    expect(textoParaEmitir([
      { codigo: 'SIN_GIRO', mensaje: 'Falta el giro de la empresa' },
      { codigo: 'SIN_CERTIFICADO', mensaje: 'Falta cargar el certificado digital' },
    ])).toBe('Para emitir falta: Falta el giro de la empresa; Falta cargar el certificado digital')
  })
})

describe('pistaDelGrupo', () => {
  it('lo del perfil se arregla en esta pantalla y lo de la boleta no se puede emitir', () => {
    expect(pistaDelGrupo('perfil')).toBe('Se arregla en el perfil (o con soporte, si el motivo lo dice); después, emítelas con el botón.')
    expect(pistaDelGrupo('boleta')).toBe('No se puede emitir.')
  })
})

describe('resumenEmision', () => {
  it('todas emitidas: en singular y plural, sin avisos', () => {
    expect(resumenEmision({ emitidas: 1, pendientes: 0, errores: [] }))
      .toEqual({ titulo: '1 emitida', detalle: null, color: 'success' })
    expect(resumenEmision({ emitidas: 3, pendientes: 0, errores: [] }))
      .toEqual({ titulo: '3 emitidas', detalle: null, color: 'success' })
  })

  it('con errores o con pendientes que no se alcanzaron avisa cuántas siguen sin emitir', () => {
    const error = { ventaId: 'v-1', codigo: 'SIN_FOLIOS', mensaje: 'No quedan folios' }
    expect(resumenEmision({ emitidas: 0, pendientes: 4, errores: [error] }))
      .toEqual({ titulo: '0 emitidas', detalle: 'Siguen sin emitir: 4', color: 'warning' })
    expect(resumenEmision({ emitidas: 2, pendientes: 0, errores: [error] }).color).toBe('warning')
  })
})
