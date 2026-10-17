import { describe, it, expect } from 'vitest'
import { turnoDeLaHora, type Turno } from './useTurnos'

function turno(id: string, horaInicio: string, horaFin: string): Turno {
  return { id, nombre: id, horaInicio, horaFin, activo: true, creadoEl: '', actualizadoEl: '' }
}

/** Una hora del día de hoy, en la zona del dispositivo (la que ve la garzona en el reloj). */
const a = (hh: number, mm = 0) => new Date(2026, 9, 16, hh, mm)

const manana = turno('manana', '08:00', '15:00')
const tarde = turno('tarde', '15:00', '23:00')
const noche = turno('noche', '22:00', '04:00')

describe('turnoDeLaHora — el turno que se preselecciona al entrar (auditoría UX 02.16)', () => {
  it('elige el turno cuya ventana contiene la hora, no el primero de la lista', () => {
    expect(turnoDeLaHora([manana, tarde], a(20, 0))?.id).toBe('tarde')
    expect(turnoDeLaHora([manana, tarde], a(9, 30))?.id).toBe('manana')
  })

  it('el inicio entra y el fin no: a las 15:00 ya es el turno de la tarde', () => {
    expect(turnoDeLaHora([manana, tarde], a(8, 0))?.id).toBe('manana')
    expect(turnoDeLaHora([manana, tarde], a(15, 0))?.id).toBe('tarde')
  })

  it('un turno que cruza la medianoche contiene las horas de los dos lados', () => {
    expect(turnoDeLaHora([manana, noche], a(23, 30))?.id).toBe('noche')
    expect(turnoDeLaHora([manana, noche], a(2, 0))?.id).toBe('noche')
    expect(turnoDeLaHora([manana, noche], a(4, 0))).toBeUndefined()
  })

  it('si ninguno coincide, no hay preselección', () => {
    expect(turnoDeLaHora([manana, tarde], a(6, 0))).toBeUndefined()
    expect(turnoDeLaHora([], a(12, 0))).toBeUndefined()
  })

  it('con ventanas que se pisan gana el primero de la lista', () => {
    expect(turnoDeLaHora([tarde, noche], a(22, 30))?.id).toBe('tarde')
  })

  it('acepta las horas con segundos, como las devuelve la base', () => {
    expect(turnoDeLaHora([turno('t', '08:00:00', '15:00:00')], a(10))?.id).toBe('t')
  })

  it('una ventana de largo cero (inicio = fin) no contiene ninguna hora', () => {
    expect(turnoDeLaHora([turno('x', '10:00', '10:00')], a(10))).toBeUndefined()
  })
})
