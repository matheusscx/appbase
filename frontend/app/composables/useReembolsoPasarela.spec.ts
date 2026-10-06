import { describe, it, expect } from 'vitest'
import {
  colorEstadoTransaccion,
  esSinConfirmar,
  etiquetaEstadoTransaccion,
  ordenDeOtrosDatos,
  ambitoGenerarNota,
  esRefundSinNota,
  notaYaLigada,
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

  it('un REFUND aprobado de una orden con venta y sin corrección es el que lleva "Generar nota"', () => {
    const refund = { tipo: 'REFUND', estado: 'aprobada', correccionVentaId: null }
    expect(esRefundSinNota(refund, 'venta-1')).toBe(true)
    // Sin venta no hay documento que corregir: es legítimo, no falta nada.
    expect(esRefundSinNota(refund, null)).toBe(false)
    expect(esRefundSinNota({ ...refund, correccionVentaId: 'nc-1' }, 'venta-1')).toBe(false)
    // El sin confirmar se aclara en su tarjeta, nunca por este botón.
    for (const estado of ['iniciada', 'error', 'rechazada'])
      expect(esRefundSinNota({ ...refund, estado }, 'venta-1')).toBe(false)
    expect(esRefundSinNota({ ...refund, tipo: 'AUTHORIZATION' }, 'venta-1')).toBe(false)
  })

  it('el intento es por REFUND: dos reembolsos de la misma orden son dos intentos', () => {
    expect(ambitoGenerarNota('tx-1')).toBe('gn:tx-1')
    expect(ambitoGenerarNota('tx-2')).not.toBe(ambitoGenerarNota('tx-1'))
  })

  it('el 409 de "ya tiene su nota" trae la nota; otro 409 no', () => {
    expect(notaYaLigada({ status: 409, data: { notaCreditoId: 'nc-1' } })).toBe('nc-1')
    expect(notaYaLigada({ status: 409, data: { message: 'sin confirmar' } })).toBeNull()
    expect(notaYaLigada({ status: 422, data: { notaCreditoId: 'nc-1' } })).toBeNull()
  })
})
