import { describe, it, expect } from 'vitest'
import { useBoletaElectronica } from './useBoletaElectronica'
import type { BoletaVenta } from '~/types/boleta'

type Electronica = NonNullable<BoletaVenta['boletaElectronica']>

function boletaElectronica(parcial: Partial<Electronica> = {}): Electronica {
  return {
    tipo: 39,
    folio: 1234,
    monto: '37000',
    cubreTodo: true,
    ambiente: 'produccion',
    resolucion: { numero: 80, fecha: '2014-08-22' },
    emisor: { rut: '76123456-7', razonSocial: 'Comercial Paris SpA', giro: 'Restaurante', direccion: 'Calle 1 123', comuna: 'Providencia' },
    ...parcial,
  }
}

function venta(parcial: Partial<Pick<BoletaVenta, 'boletaElectronica' | 'boletaSinEmitir'>> = {}) {
  return { boletaElectronica: null, boletaSinEmitir: null, ...parcial } as BoletaVenta
}

describe('useBoletaElectronica', () => {
  const { paraTicket, avisoSinEmitir } = useBoletaElectronica()

  describe('paraTicket', () => {
    it('sin boleta electrónica ni pendiente no agrega nada: el ticket de hoy', () => {
      expect(paraTicket(venta())).toEqual({})
    })

    it('con la boleta emitida: lo que imprime el papel y el emisor de la boleta', () => {
      const r = paraTicket(venta({ boletaElectronica: boletaElectronica() }))
      expect(r).toEqual({
        electronica: {
          tipo: 39,
          folio: 1234,
          monto: '37000',
          cubreTodo: true,
          certificacion: false,
          resolucion: { numero: 80, fecha: '2014-08-22' },
        },
        emisor: {
          nombre: 'Comercial Paris SpA',
          rut: '76123456-7',
          giro: 'Restaurante',
          direccion: 'Calle 1 123, Providencia',
        },
      })
    })

    it('el ambiente de certificación marca el papel como certificación', () => {
      const r = paraTicket(venta({ boletaElectronica: boletaElectronica({ ambiente: 'certificacion' }) }))
      expect(r.electronica?.certificacion).toBe(true)
    })

    it('el 41 y el pago mixto viajan tal cual', () => {
      const r = paraTicket(venta({ boletaElectronica: boletaElectronica({ tipo: 41, cubreTodo: false, monto: '60000' }) }))
      expect(r.electronica).toMatchObject({ tipo: 41, cubreTodo: false, monto: '60000' })
    })

    it('sin emitir: marca el papel como pendiente y no trae emisor (queda el de la pantalla)', () => {
      const r = paraTicket(venta({ boletaSinEmitir: { mensaje: 'No quedan folios' } }))
      expect(r).toEqual({ pendienteDeEmision: true })
      expect('emisor' in r).toBe(false)
    })

    it('una boleta emitida manda sobre un pendiente: no salen las dos cosas', () => {
      const r = paraTicket(venta({ boletaElectronica: boletaElectronica(), boletaSinEmitir: { mensaje: 'x' } }))
      expect(r.pendienteDeEmision).toBeUndefined()
      expect(r.electronica).toBeDefined()
    })

    it('un payload sin los campos nuevos es el ticket de hoy', () => {
      expect(paraTicket({} as BoletaVenta)).toEqual({})
    })
  })

  describe('avisoSinEmitir', () => {
    it('devuelve el motivo del servidor cuando la boleta no se emitió', () => {
      expect(avisoSinEmitir(venta({ boletaSinEmitir: { mensaje: 'No quedan folios' } }))).toBe('No quedan folios')
    })

    it('null cuando se emitió o cuando no había que emitir', () => {
      expect(avisoSinEmitir(venta())).toBeNull()
      expect(avisoSinEmitir(venta({ boletaElectronica: boletaElectronica() }))).toBeNull()
      expect(avisoSinEmitir({} as BoletaVenta)).toBeNull()
    })
  })
})
