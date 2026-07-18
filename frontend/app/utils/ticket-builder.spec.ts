import { describe, it, expect } from 'vitest'
import {
  buildComandaTicket,
  buildPrecuentaTicket,
  buildBoletaTicket,
  agregarImpuestosVenta,
  formatTasaPorcentaje,
} from './ticket-builder'

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

  it('imprime Sin primero (−) y Extra al final (+)', () => {
    const lines = buildComandaTicket({
      estacionNombre: 'Cocina',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 1,
      garzonNombre: null,
      items: [{
        nombre: 'Hamburguesa Clásica',
        cantidad: '1',
        // Orden deliberadamente mezclado (extra antes que sin + comentario)
        nota: 'Extra Queso · Sin Cebolla · sin sal · Extra Tocino · Sin Tomate',
      }],
      fecha: FECHA,
    })

    expect(lines).toContain('1 x Hamburguesa Clásica')
    const idx = lines.indexOf('1 x Hamburguesa Clásica')
    expect(lines.slice(idx + 1, idx + 6)).toEqual([
      '  - Sin Cebolla',
      '  - Sin Tomate',
      '  + Extra Queso',
      '  + Extra Tocino',
      'comentario: sin sal',
    ])
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

  it('incluye personalización como lista entre nombre y monto', () => {
    const lines = buildPrecuentaTicket({
      tenantNombre: 'Restaurante Paris',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 1,
      items: [{
        nombre: 'Hamburguesa Clásica',
        cantidad: '1',
        totalLinea: '9800',
        nota: 'Extra Queso · Sin Cebolla',
      }],
      totales: {
        subtotalNeto: '9800',
        totalDescuentos: '0',
        totalRecargos: '0',
        totalImpuestos: '0',
        totalFinal: '9800',
      },
      fecha: FECHA,
      formatMonto,
    })

    const idxNombre = lines.indexOf('1 x Hamburguesa Clásica')
    expect(lines[idxNombre + 1]).toBe('  - Sin Cebolla')
    expect(lines[idxNombre + 2]).toBe('  + Extra Queso')
    expect(lines[idxNombre + 3]).toBe('  $9800')
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

  it('imprime cantidad con unidad de presentación preformateada', () => {
    const lines = buildBoletaTicket({
      tenantNombre: 'Restaurante Paris',
      items: [{ nombre: 'Harina', cantidad: '500 g', totalLinea: '2500' }],
      totales: {
        subtotalNeto: '2500',
        totalDescuentos: '0',
        totalRecargos: '0',
        totalImpuestos: '0',
        totalFinal: '2500',
      },
      pagos: [{ nombre: 'Efectivo', monto: '2500' }],
      fecha: FECHA,
      formatMonto,
    })

    expect(lines).toContain('500 g x Harina')
  })

  it('incluye personalización como lista bajo el ítem', () => {
    const lines = buildBoletaTicket({
      tenantNombre: 'Restaurante Paris',
      items: [{
        nombre: 'Hamburguesa Clásica',
        cantidad: '1',
        totalLinea: '9800',
        nota: 'Sin Cebolla · Extra Queso',
      }],
      totales: {
        subtotalNeto: '9800',
        totalDescuentos: '0',
        totalRecargos: '0',
        totalImpuestos: '0',
        totalFinal: '9800',
      },
      pagos: [{ nombre: 'Efectivo', monto: '9800' }],
      fecha: FECHA,
      formatMonto,
    })

    expect(lines).toContain('1 x Hamburguesa Clásica')
    expect(lines).toContain('  - Sin Cebolla')
    expect(lines).toContain('  + Extra Queso')
  })
})

describe('agregarImpuestosVenta', () => {
  it('devuelve [] si ninguna línea tiene impuestos', () => {
    expect(agregarImpuestosVenta([{ trazas: { impuestos: [] } }])).toEqual([])
  })

  it('suma el mismo impuesto en varias líneas agrupando por id', () => {
    const r = agregarImpuestosVenta([
      { trazas: { impuestos: [{ id: 'iva', nombre: 'IVA', tasa: '0.19', monto: '1900' }] } },
      { trazas: { impuestos: [{ id: 'iva', nombre: 'IVA', tasa: '0.19', monto: '4008' }] } },
    ])
    expect(r).toEqual([{ nombre: 'IVA', tasa: '0.19', monto: '5908' }])
  })

  it('conserva múltiples impuestos en orden de primera aparición', () => {
    const r = agregarImpuestosVenta([
      { trazas: { impuestos: [
        { id: 'iva', nombre: 'IVA', tasa: '0.19', monto: '1900' },
        { id: 'ila', nombre: 'ILA', tasa: '0.10', monto: '1000' },
      ] } },
      { trazas: { impuestos: [{ id: 'ila', nombre: 'ILA', tasa: '0.10', monto: '500' }] } },
    ])
    expect(r).toEqual([
      { nombre: 'IVA', tasa: '0.19', monto: '1900' },
      { nombre: 'ILA', tasa: '0.10', monto: '1500' },
    ])
  })
})

describe('formatTasaPorcentaje', () => {
  it('convierte decimal a porcentaje sin decimales innecesarios', () => {
    expect(formatTasaPorcentaje('0.19')).toBe('19%')
  })
  it('mantiene decimales significativos con coma', () => {
    expect(formatTasaPorcentaje('0.195')).toBe('19,5%')
  })
  it('formatea cero', () => {
    expect(formatTasaPorcentaje('0')).toBe('0%')
  })
})
