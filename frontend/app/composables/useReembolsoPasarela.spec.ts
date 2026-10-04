import { describe, it, expect } from 'vitest'
import {
  colorEstadoTransaccion,
  esSinConfirmar,
  etiquetaEstadoTransaccion,
  ordenDeOtrosDatos,
} from './useReembolsoPasarela'

describe('useReembolsoPasarela', () => {
  it('iniciada y error son "Sin confirmar" (advertencia), no un rechazo', () => {
    for (const estado of ['iniciada', 'error']) {
      expect(esSinConfirmar(estado)).toBe(true)
      expect(etiquetaEstadoTransaccion(estado)).toBe('Sin confirmar')
      expect(colorEstadoTransaccion(estado)).toBe('warning')
    }
    expect(etiquetaEstadoTransaccion('aprobada')).toBe('Aprobada')
    expect(colorEstadoTransaccion('rechazada')).toBe('error')
  })

  it('el 422 de otros datos es el que trae la orden; otro 422 no', () => {
    expect(ordenDeOtrosDatos({ status: 422, data: { ordenId: 'o1' } })).toBe('o1')
    expect(ordenDeOtrosDatos({ status: 422, data: { message: 'tope' } })).toBeNull()
    expect(ordenDeOtrosDatos({ status: 409, data: { ordenId: 'o1' } })).toBeNull()
  })
})
