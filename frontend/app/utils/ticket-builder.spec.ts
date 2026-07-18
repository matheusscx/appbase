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

    expect(lines.some(l => l.includes('PRECUENTA (no válido como boleta)'))).toBe(true)
    expect(lines).toContain('TOTAL: $21420')
    expect(lines.some(l => l.startsWith('Descuentos:'))).toBe(false)

    const fila = lines.find(l => l.includes('Lomo a lo pobre'))
    expect(fila).toBeDefined()
    expect(fila!.slice(0, 1)).toBe('2')
    expect(fila!.slice(6, 21)).toBe('Lomo a lo pobre')
    expect(fila!.slice(42, 48)).toBe('$18000')
  })

  it('imprime el header de columnas CANT/DESCRIPCIÓN/TOTAL a 48 caracteres', () => {
    const lines = buildPrecuentaTicket({
      tenantNombre: 'Restaurante Paris',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 2,
      items: [{ nombre: 'Lomo', cantidad: '1', totalLinea: '5000' }],
      totales: { subtotalNeto: '5000', totalDescuentos: '0', totalRecargos: '0', totalImpuestos: '0', totalFinal: '5000' },
      fecha: FECHA,
      formatMonto,
    })
    const header = lines.find(l => l.startsWith('CANT'))
    expect(header).toBeDefined()
    expect(header).toHaveLength(48)
    expect(header!.slice(6, 17)).toBe('DESCRIPCIÓN')
    expect(header!.slice(43, 48)).toBe('TOTAL')
  })

  it('incluye personalización como lista debajo de la fila del ítem', () => {
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

    const idxFila = lines.findIndex(l => l.includes('Hamburguesa Clásica'))
    expect(idxFila).toBeGreaterThanOrEqual(0)
    expect(lines[idxFila]!.slice(43, 48)).toBe('$9800')
    expect(lines[idxFila + 1]).toBe('  - Sin Cebolla')
    expect(lines[idxFila + 2]).toBe('  + Extra Queso')
  })

  it('con propinaSugerida imprime el bloque sugerido y la leyenda voluntaria', () => {
    const lines = buildPrecuentaTicket({
      tenantNombre: 'Restaurante Paris',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 2,
      items: [{ nombre: 'Lomo', cantidad: '1', totalLinea: '45000' }],
      totales: { subtotalNeto: '45000', totalDescuentos: '0', totalRecargos: '0', totalImpuestos: '0', totalFinal: '45000' },
      propinaSugerida: { porcentaje: '0.10', monto: '4500' },
      fecha: FECHA,
      formatMonto,
    })
    expect(lines.some(l => l.startsWith('Propina sugerida 10%') && l.includes('$4500'))).toBe(true)
    expect(lines.some(l => l.startsWith('Total sugerido') && l.includes('$49500'))).toBe(true)
    expect(lines.some(l => l.includes('aceptación voluntaria'))).toBe(true)
  })

  it('sin propinaSugerida no imprime bloque sugerido', () => {
    const lines = buildPrecuentaTicket({
      tenantNombre: 'Restaurante Paris',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 2,
      items: [{ nombre: 'Lomo', cantidad: '1', totalLinea: '45000' }],
      totales: { subtotalNeto: '45000', totalDescuentos: '0', totalRecargos: '0', totalImpuestos: '0', totalFinal: '45000' },
      fecha: FECHA,
      formatMonto,
    })
    expect(lines.some(l => l.startsWith('Propina sugerida'))).toBe(false)
  })
})

const EMISOR = { nombre: 'Comercial Paris SpA', rut: '76.123.456-7', direccion: 'Av. Providencia 1234', telefono: '+56 2 2345 6789' }
const TOTALES_BASE = { subtotalNeto: '37000', totalDescuentos: '0', totalRecargos: '0', totalImpuestos: '5908', totalFinal: '37000' }
const ITEM = { nombre: 'Pisco Sour', cantidad: '1', precioUnitario: '5000', totalLinea: '5000' }
const IVA = [{ nombre: 'IVA', tasa: '0.19', monto: '5908' }]

describe('buildBoletaTicket', () => {
  function boleta(over: Partial<Parameters<typeof buildBoletaTicket>[0]> = {}) {
    return buildBoletaTicket({
      emisor: EMISOR,
      facturacionElectronica: false,
      meta: { cajero: 'Juan Pérez' },
      items: [ITEM],
      totales: TOTALES_BASE,
      impuestos: IVA,
      pagos: [{ nombre: 'Efectivo', monto: '37000' }],
      fecha: FECHA,
      formatMonto,
      ...over,
    })
  }

  it('imprime la cabecera del emisor con RUT y dirección', () => {
    const lines = boleta()
    expect(lines.some(l => l.includes('Comercial Paris SpA'))).toBe(true)
    expect(lines.some(l => l.includes('RUT: 76.123.456-7'))).toBe(true)
    expect(lines.some(l => l.includes('Av. Providencia 1234'))).toBe(true)
  })

  it('omite RUT/dirección/teléfono cuando el emisor no los trae', () => {
    const lines = boleta({ emisor: { nombre: 'Kiosco Simple' } })
    expect(lines.some(l => l.includes('RUT:'))).toBe(false)
    expect(lines.some(l => l.startsWith('Tel:'))).toBe(false)
  })

  it('en modo interno imprime DOCUMENTO INTERNO y SIN VALIDEZ FISCAL, nunca SII', () => {
    const lines = boleta()
    expect(lines.some(l => l.includes('DOCUMENTO INTERNO'))).toBe(true)
    expect(lines.some(l => l.includes('SIN VALIDEZ FISCAL'))).toBe(true)
    expect(lines.some(l => l.includes('SII'))).toBe(false)
    expect(lines.some(l => l.includes('BOLETA ELECTRÓNICA'))).toBe(false)
  })

  it('en modo electrónico imprime BOLETA ELECTRÓNICA + folio + timbre SII, nunca SIN VALIDEZ', () => {
    const lines = boleta({ facturacionElectronica: true, folio: '00000123' })
    expect(lines.some(l => l.includes('BOLETA ELECTRÓNICA'))).toBe(true)
    expect(lines.some(l => l.includes('00000123'))).toBe(true)
    expect(lines.some(l => l.includes('Timbre Electrónico SII'))).toBe(true)
    expect(lines.some(l => l.includes('SIN VALIDEZ FISCAL'))).toBe(false)
  })

  it('imprime cantidad con unidad de presentación preformateada dentro de la columna CANT', () => {
    const lines = boleta({ items: [{ nombre: 'Harina', cantidad: '500 g', precioUnitario: '2500', totalLinea: '2500' }] })
    const fila = lines.find(l => l.includes('Harina'))
    expect(fila).toBeDefined()
    expect(fila!.slice(0, 5)).toBe('500 g')
    expect(fila!.slice(6, 12)).toBe('Harina')
  })

  it('trunca cantidad/nombre que exceden su columna sin agregar caracteres fuera de CP850', () => {
    const lines = boleta({ items: [{ nombre: 'Un Producto con Nombre Larguísimo', cantidad: '12,5 kg', precioUnitario: '2500', totalLinea: '2500' }] })
    const fila = lines.find(l => l.startsWith('12,5'))
    expect(fila).toBeDefined()
    // Columna CANT = 5 chars: '12,5 kg' (7) se corta a '12,5 ' sin marcador especial.
    expect(fila!.slice(0, 5)).toBe('12,5 ')
    expect(fila!).not.toContain('…')
    expect(fila!).not.toContain('?')
  })

  it('imprime el header de columnas CANT/DESCRIPCIÓN/P.UNIT/TOTAL a 48 caracteres', () => {
    const lines = boleta()
    const header = lines.find(l => l.startsWith('CANT'))
    expect(header).toBeDefined()
    expect(header).toHaveLength(48)
    expect(header!.slice(6, 17)).toBe('DESCRIPCIÓN')
    expect(header!.slice(32, 38)).toBe('P.UNIT')
    expect(header!.slice(43, 48)).toBe('TOTAL')
  })

  it('imprime Neto y una línea por impuesto con nombre y tasa reales', () => {
    const lines = boleta()
    // Neto = totalFinal - totalImpuestos = 37000 - 5908 = 31092
    expect(lines.some(l => l.startsWith('Neto') && l.includes('$31092'))).toBe(true)
    expect(lines.some(l => l.startsWith('IVA (19%)') && l.includes('$5908'))).toBe(true)
    expect(lines.some(l => l.startsWith('TOTAL BOLETA') && l.includes('$37000'))).toBe(true)
  })

  it('omite la metadata operativa vacía y comparte línea mesa/garzón', () => {
    const soloMesa = boleta({ meta: { mesa: 'MESA-12', garzon: 'Carlos' } })
    expect(soloMesa.some(l => l.includes('MESA-12') && l.includes('Carlos'))).toBe(true)
    const sinMesa = boleta({ meta: { cajero: 'Juan Pérez' } })
    expect(sinMesa.some(l => l.startsWith('Mesa'))).toBe(false)
  })

  it('con propina > 0 imprime Propina y TOTAL A PAGAR = total + propina', () => {
    const lines = boleta({ propina: { monto: '3700' } })
    expect(lines.some(l => l.startsWith('Propina') && l.includes('$3700'))).toBe(true)
    expect(lines.some(l => l.startsWith('TOTAL A PAGAR') && l.includes('$40700'))).toBe(true)
  })

  it('sin propina no imprime bloque de propina ni TOTAL A PAGAR', () => {
    const lines = boleta()
    expect(lines.some(l => l.startsWith('Propina'))).toBe(false)
    expect(lines.some(l => l.startsWith('TOTAL A PAGAR'))).toBe(false)
  })

  it('imprime el ítem en una fila de columnas con precio unitario y total', () => {
    const lines = boleta()
    const fila = lines.find(l => l.includes('Pisco Sour'))
    expect(fila).toBeDefined()
    expect(fila).toHaveLength(48)
    expect(fila!.slice(0, 1)).toBe('1')
    expect(fila!.slice(6, 16)).toBe('Pisco Sour')
    expect(fila!.slice(33, 38)).toBe('$5000')
    expect(fila!.slice(43, 48)).toBe('$5000')
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
