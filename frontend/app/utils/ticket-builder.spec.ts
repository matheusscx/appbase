import { describe, it, expect } from 'vitest'
import { buildComandaTicket, buildPrecuentaTicket, buildBoletaTicket } from './ticket-builder'

const formatMonto = (v: string) => `$${v}`
const FECHA = new Date('2026-07-13T20:30:00')

describe('buildComandaTicket', () => {
  it('incluye la estación, la mesa, el garzón y los ítems con cantidad', () => {
    const lines = buildComandaTicket({
      estacionNombre: 'Cocina',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 2,
      garzonNombre: 'Ana Torres',
      items: [{ nombre: 'Lomo a lo pobre', cantidad: '2' }],
      fecha: FECHA,
    })

    expect(lines).toContain('*** COCINA ***')
    expect(lines).toContain('Mesa: Mesa 1   Cuenta: 2')
    expect(lines).toContain('Garzón: Ana Torres')
    expect(lines).toContain('2 x Lomo a lo pobre')
  })

  it('omite la línea de garzón si no viene', () => {
    const lines = buildComandaTicket({
      estacionNombre: 'Barra',
      mesaNombre: 'Mesa 3',
      cuentaNumero: 1,
      garzonNombre: null,
      items: [{ nombre: 'Agua mineral', cantidad: '1' }],
      fecha: FECHA,
    })

    expect(lines.some(l => l.startsWith('Garzón:'))).toBe(false)
  })
})

describe('buildPrecuentaTicket', () => {
  it('lista los ítems con su total y el desglose de totales', () => {
    const lines = buildPrecuentaTicket({
      tenantNombre: 'Restaurante Paris',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 2,
      items: [{ nombre: 'Lomo a lo pobre', cantidad: '2', totalLinea: '18000' }],
      totales: {
        subtotalNeto: '18000',
        totalDescuentos: '0',
        totalRecargos: '0',
        totalImpuestos: '3420',
        totalFinal: '21420',
      },
      fecha: FECHA,
      formatMonto,
    })

    expect(lines).toContain('PRECUENTA (no válido como boleta)')
    expect(lines).toContain('2 x Lomo a lo pobre')
    expect(lines).toContain('TOTAL: $21420')
    expect(lines.some(l => l.startsWith('Descuentos:'))).toBe(false)
  })
})

describe('buildBoletaTicket', () => {
  it('incluye ítems, totales y los pagos', () => {
    const lines = buildBoletaTicket({
      tenantNombre: 'Restaurante Paris',
      items: [{ nombre: 'Lomo a lo pobre', cantidad: '2', totalLinea: '18000' }],
      totales: {
        subtotalNeto: '18000',
        totalDescuentos: '1000',
        totalRecargos: '0',
        totalImpuestos: '3420',
        totalFinal: '20420',
      },
      pagos: [{ nombre: 'Efectivo', monto: '20420' }],
      fecha: FECHA,
      formatMonto,
    })

    expect(lines).toContain('BOLETA')
    expect(lines).toContain('Descuentos: -$1000')
    expect(lines).toContain('Efectivo: $20420')
    expect(lines).toContain('TOTAL: $20420')
  })
})
