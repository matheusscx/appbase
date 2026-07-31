import { describe, it, expect } from 'vitest'
import { useEstadoVenta } from './useEstadoVenta'

const { estadoColor, estadoLabel, estadoOptions } = useEstadoVenta()

describe('useEstadoVenta', () => {
  it('mapea los cuatro estados a su color', () => {
    expect(estadoColor('pendiente')).toBe('warning')
    expect(estadoColor('pagada_parcial')).toBe('info')
    expect(estadoColor('pagada')).toBe('success')
    expect(estadoColor('cancelada')).toBe('error')
  })

  it('un estado desconocido cae a neutral en vez de romper', () => {
    expect(estadoColor('estado_nuevo_del_backend')).toBe('neutral')
  })

  it('mapea los cuatro estados a su etiqueta', () => {
    expect(estadoLabel('pendiente')).toBe('Pendiente')
    // La única que no es el estado capitalizado: la columna es angosta.
    expect(estadoLabel('pagada_parcial')).toBe('Parcial')
    expect(estadoLabel('pagada')).toBe('Pagada')
    expect(estadoLabel('cancelada')).toBe('Cancelada')
  })

  it('un estado desconocido se muestra crudo', () => {
    expect(estadoLabel('estado_nuevo_del_backend')).toBe('estado_nuevo_del_backend')
  })

  // Estas dos son la regresión que motivó el composable: las opciones del filtro
  // viajan al backend, donde `@IsEnum(EstadoVenta)` las valida. Una opción de más
  // no falla al escribirla —falla con un 400 al elegirla en producción— y una de
  // menos deja un estado imposible de filtrar sin que nadie lo note.
  it('ofrece exactamente los cuatro estados que acepta el backend', () => {
    expect(estadoOptions.map(o => o.value)).toEqual([
      'pendiente', 'pagada_parcial', 'pagada', 'cancelada',
    ])
  })

  it('cada opción se rotula con la misma etiqueta que el badge', () => {
    for (const opcion of estadoOptions) {
      expect(opcion.label).toBe(estadoLabel(opcion.value))
    }
  })
})
