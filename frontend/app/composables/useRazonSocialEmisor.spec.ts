import { describe, it, expect } from 'vitest'
import { elegirEmisor } from './useRazonSocialEmisor'

const A = { nombre: 'Razón Preferida', rut: '76.1-1', direccion: 'Calle 1', telefono: '111', habilitado: true, preferida: true }
const B = { nombre: 'Razón Habilitada', rut: '76.2-2', habilitado: true, preferida: false }

describe('elegirEmisor', () => {
  it('elige la razón preferida', () => {
    expect(elegirEmisor([B, A], 'Tenant X')).toEqual({
      nombre: 'Razón Preferida', rut: '76.1-1', direccion: 'Calle 1', telefono: '111',
    })
  })

  it('cae a la primera habilitada si no hay preferida', () => {
    expect(elegirEmisor([B], 'Tenant X')).toEqual({
      nombre: 'Razón Habilitada', rut: '76.2-2', direccion: undefined, telefono: undefined,
    })
  })

  it('cae al nombre del tenant si no hay razones', () => {
    expect(elegirEmisor([], 'Tenant X')).toEqual({ nombre: 'Tenant X' })
  })
})
