import { describe, it, expect } from 'vitest'
import { cuentaToCalcularInput, precioUnitarioLinea, type CuentaDetalle, type CuentaLineaDetalle } from './useSalones'

function linea(personalizacion: CuentaLineaDetalle['personalizacion']): CuentaLineaDetalle {
  return {
    id: 'l1',
    itemId: 'combo-1',
    nombre: 'Combo Burger',
    precioBase: '4300',
    monedaId: 'clp',
    cantidad: '1',
    cantidadEnviada: '0',
    personalizacion,
  }
}

function cuenta(overrides: Partial<CuentaDetalle> = {}): CuentaDetalle {
  return {
    id: 'cuenta-1',
    numero: 1,
    nombre: null,
    estado: 'abierta',
    mesaId: 'mesa-1',
    ventaId: null,
    garzonAperturaId: null,
    garzonAperturaNombre: null,
    garzonResponsableId: null,
    garzonResponsableNombre: null,
    garzonCierreId: null,
    garzonCierreNombre: null,
    lineas: [linea(null)],
    ...overrides,
  }
}

describe('precioUnitarioLinea', () => {
  it('sin personalización devuelve el precioBase', () => {
    expect(precioUnitarioLinea(linea(null))).toBe('4300')
  })

  it('suma extras y opciones de grupo propio (combo/receta)', () => {
    const l = linea({
      omitidos: [],
      extras: [{ ingredienteItemId: 'e1', cantidad: '1', unidadCodigo: 'un', precioExtra: '200', unidades: '1' }],
      grupos: [{
        grupoId: 'g1',
        grupoNombre: 'Bebida',
        opciones: [{ itemId: 'coca', nombre: 'Coca-Cola', cantidad: '1', precioExtra: '500', unidades: '1' }],
      }],
    })
    expect(precioUnitarioLinea(l)).toBe('5000')
  })

  it('suma el recargo de grupos de COMPONENTE (grupos anidados en combos) aunque no haya extras ni grupos propios', () => {
    // Combo cuyo único recargo viene de un grupo del componente "Chuleta" (el chuleta 1500 del e2e de backend).
    const l = linea({
      omitidos: [],
      extras: [],
      componentes: [
        {
          componenteItemId: 'chuleta-1',
          componenteNombre: 'Chuleta',
          unidad: 1,
          grupos: [{
            grupoId: 'g-carne',
            grupoNombre: 'Tipo de carne',
            opciones: [{ itemId: 'carne-premium', nombre: 'Premium', cantidad: '1', precioExtra: '1500', unidades: '1' }],
          }],
        },
      ],
    })
    // 4300 (precioBase del combo) + 1500 (recargo del grupo del componente) = 5800, igual al total del e2e de backend.
    expect(precioUnitarioLinea(l)).toBe('5800')
  })

  it('suma múltiples opciones de múltiples componentes y unidades, respetando unidades × precioExtra', () => {
    const l = linea({
      omitidos: [],
      extras: [],
      componentes: [
        {
          componenteItemId: 'chuleta-1',
          componenteNombre: 'Chuleta',
          unidad: 1,
          grupos: [{
            grupoId: 'g-carne',
            grupoNombre: 'Tipo de carne',
            opciones: [{ itemId: 'carne-premium', nombre: 'Premium', cantidad: '1', precioExtra: '1500', unidades: '2' }],
          }],
        },
        {
          componenteItemId: 'papas-1',
          componenteNombre: 'Papas',
          unidad: 1,
          grupos: [{
            grupoId: 'g-salsa',
            grupoNombre: 'Salsa',
            opciones: [{ itemId: 'mayo', nombre: 'Mayo', cantidad: '1', precioExtra: '300', unidades: '1' }],
          }],
        },
      ],
    })
    // 4300 + (1500 × 2) + (300 × 1) = 7600
    expect(precioUnitarioLinea(l)).toBe('7600')
  })
})

describe('cuentaToCalcularInput', () => {
  it('manda el cuentaId de la cuenta, no solo las líneas', () => {
    // Sin esto la previsualización del salón evalúa vigencia de reglas por
    // fecha contra "ahora" mientras el cobro evalúa `abierta_el`: la mesa que
    // se sienta con la promo vigente y paga después de que venció vería el
    // total sin descuento en pantalla y se le cobraría CON descuento.
    const input = cuentaToCalcularInput(cuenta({ id: 'cuenta-xyz' }))
    expect(input.cuentaId).toBe('cuenta-xyz')
  })
})
