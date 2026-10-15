import { describe, it, expect } from 'vitest'
import { textoSiiInvalido } from './useTextoSii'

describe('textoSiiInvalido', () => {
  it('acepta tildes, eñes y los signos de apertura del español', () => {
    expect(textoSiiInvalido('Pisco sour ñandú ¿5?', 80)).toBeNull()
  })

  it.each([
    ['Café €', 'un símbolo fuera de ISO-8859-1'],
    ['Tab\tx', 'un tab'],
    ['🍺', 'un emoji'],
  ])('rechaza %j: %s', (valor) => {
    expect(textoSiiInvalido(valor, 80)).not.toBeNull()
  })

  // Los bordes de la clase, con escapes: el literal no depende de ningún carácter invisible.
  it.each([
    ['\u007F', 'DEL, justo después de ~'],
    ['\u0085', 'control C1'],
    ['\u009F', 'último control C1, justo antes del NBSP'],
    ['\u0100', 'Ā, justo después de ÿ'],
  ])('rechaza %j: %s', (valor) => {
    expect(textoSiiInvalido(valor, 80)).not.toBeNull()
  })

  it.each([
    ['\u0020', 'espacio, el primero'],
    ['\u00A0', 'NBSP, el primero del tramo alto'],
    ['\u00FF', 'ÿ, el último'],
    ['\u007E', '~, el último del tramo bajo'],
  ])('acepta %j: %s', (valor) => {
    expect(textoSiiInvalido(valor, 80)).toBeNull()
  })

  it('el largo exacto cabe y uno más no', () => {
    expect(textoSiiInvalido('a'.repeat(80), 80)).toBeNull()
    expect(textoSiiInvalido('a'.repeat(81), 80)).toMatch(/80 caracteres/)
  })

  it('el vacío no es un error de este campo: lo pide el formulario', () => {
    expect(textoSiiInvalido('', 80)).toBeNull()
  })
})
