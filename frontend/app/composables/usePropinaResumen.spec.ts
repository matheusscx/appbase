import { describe, expect, it, afterEach } from 'vitest'
import { rangoMesActual } from './usePropinaResumen'

// Ítem 1 de `2026-09-19-residuos-hora-de-corte/brief.md`: el rango por
// defecto del resumen mensual de Propinas se corría un día en husos
// POSITIVOS porque armaba la fecha con `toISOString()` (pasa por UTC) en vez
// de por componentes locales. `process.env.TZ` cambia el huso que Node usa
// para los getters locales de `Date` (`getFullYear`/`getMonth`/`getDate`) sin
// reiniciar el proceso — confirmado en este entorno antes de escribir el
// test. `ahora` viaja fijo para no correr contra el reloj real en el borde
// de un mes.
describe('usePropinaResumen — rangoMesActual', () => {
  const tzOriginal = process.env.TZ

  afterEach(() => {
    process.env.TZ = tzOriginal
  })

  it('en un huso POSITIVO (Europe/Madrid), "desde" es el día 1 del mes LOCAL — no el 31 del mes anterior', () => {
    process.env.TZ = 'Europe/Madrid'
    const ahora = new Date(2026, 8, 15, 10, 0, 0) // 15 de septiembre de 2026, componentes locales
    expect(rangoMesActual(ahora)).toEqual({ desde: '2026-09-01', hasta: '2026-10-01' })
  })

  it('control en huso NEGATIVO (America/Santiago): mismo resultado — acá el bug viejo no se notaba', () => {
    process.env.TZ = 'America/Santiago'
    const ahora = new Date(2026, 8, 15, 10, 0, 0)
    expect(rangoMesActual(ahora)).toEqual({ desde: '2026-09-01', hasta: '2026-10-01' })
  })

  it('diciembre cruza de año: "hasta" es el 1 de enero del año siguiente', () => {
    process.env.TZ = 'Europe/Madrid'
    const ahora = new Date(2026, 11, 20, 10, 0, 0)
    expect(rangoMesActual(ahora)).toEqual({ desde: '2026-12-01', hasta: '2027-01-01' })
  })
})
