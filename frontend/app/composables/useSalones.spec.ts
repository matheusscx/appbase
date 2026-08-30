import { describe, it, expect } from 'vitest'
import { cuentaToCalcularInput, type CuentaDetalle, type CuentaLineaDetalle } from './useSalones'

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

describe('cuentaToCalcularInput', () => {
  /**
   * El invariante que reemplaza a los tests de `precioUnitarioLinea` que vivían
   * arriba: esa función sumaba `precioBase + Σ precioExtra` del snapshot **en la
   * moneda del ítem** y el resultado viajaba como `precioUnitario`. Ahora la
   * línea manda qué se pidió y el precio lo calcula el servidor.
   *
   * La aserción fuerte no es la forma del payload sino la última: **ningún
   * número de plata cruza**. Un `precioExtra` que se colara de nuevo sería
   * exactamente el bug de vuelta, y el `toMatchObject` de arriba no lo vería
   * porque no mira las claves de más.
   */
  it('manda la personalización con ids y unidades, sin un solo precio', () => {
    const l = linea({
      omitidos: ['cebolla-1'],
      extras: [
        {
          ingredienteItemId: 'queso-1',
          cantidad: '1',
          unidadCodigo: 'unidad',
          precioExtra: '1500',
          unidades: '2',
        },
      ],
      comentario: 'Bien cocido',
      grupos: [
        {
          grupoId: 'grupo-salsa',
          grupoNombre: 'Salsa',
          opciones: [
            {
              itemId: 'salsa-bbq',
              nombre: 'BBQ',
              cantidad: '1',
              precioExtra: '300',
              unidades: '1',
            },
          ],
        },
      ],
      componentes: [
        {
          componenteItemId: 'burger-1',
          componenteNombre: 'Burger',
          unidad: 1,
          grupos: [
            {
              grupoId: 'grupo-proteina',
              grupoNombre: 'Proteína',
              opciones: [
                {
                  itemId: 'proteina-carne',
                  nombre: 'Carne',
                  cantidad: '1',
                  precioExtra: '0',
                  unidades: '1',
                },
              ],
            },
          ],
        },
      ],
    })

    const input = cuentaToCalcularInput(cuenta({ lineas: [l] }))
    const enviada = input.lineas[0]!

    expect(enviada).not.toHaveProperty('precioUnitario')
    expect(enviada.personalizacion).toEqual({
      omitidos: ['cebolla-1'],
      extras: [{ ingredienteItemId: 'queso-1', unidades: 2 }],
      comentario: 'Bien cocido',
      grupos: [
        {
          grupoId: 'grupo-salsa',
          opciones: [{ itemId: 'salsa-bbq', unidades: 1 }],
        },
      ],
      componentes: [
        {
          componenteItemId: 'burger-1',
          unidad: 1,
          grupos: [
            {
              grupoId: 'grupo-proteina',
              opciones: [{ itemId: 'proteina-carne', unidades: 1 }],
            },
          ],
        },
      ],
    })
    // Ni el `precioExtra` de los extras, ni el de las opciones, ni el
    // `precioBase` de la línea: el body no lleva plata.
    expect(JSON.stringify(input)).not.toContain('1500')
    expect(JSON.stringify(input)).not.toContain('300')
    expect(JSON.stringify(input)).not.toContain('4300')
  })

  it('una línea sin personalización manda solo qué y cuánto', () => {
    const input = cuentaToCalcularInput(cuenta())
    expect(input.lineas[0]).toEqual({ itemId: 'combo-1', cantidad: '1' })
  })

  it('manda el cuentaId de la cuenta, no solo las líneas', () => {
    // Sin esto la previsualización del salón evalúa vigencia de reglas por
    // fecha contra "ahora" mientras el cobro evalúa `abierta_el`: la mesa que
    // se sienta con la promo vigente y paga después de que venció vería el
    // total sin descuento en pantalla y se le cobraría CON descuento.
    const input = cuentaToCalcularInput(cuenta({ id: 'cuenta-xyz' }))
    expect(input.cuentaId).toBe('cuenta-xyz')
  })
})
