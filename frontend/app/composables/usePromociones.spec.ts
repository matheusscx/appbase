import { describe, expect, it } from 'vitest'
import { estadoPromocion, estadoPromocionBadge } from './usePromociones'

/** 'YYYY-MM-DD' de HOY con el mismo criterio que el composable (fecha LOCAL,
 *  no `toISOString()` que da UTC) — mismo patrón que
 *  `configuracion/descuentos.nuxt.spec.ts` para el badge de vigencia: se
 *  calcula en vez de fijarse a mano para que corra igual sea cuando sea hoy. */
function hoyLocal(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

describe('usePromociones — estadoPromocion', () => {
  it('vigente: activa y hoy dentro del rango', () => {
    const hoy = hoyLocal()
    expect(estadoPromocion({ activo: true, fechaInicio: hoy, fechaFin: hoy })).toBe('vigente')
  })

  it('programada: activa y el rango empieza en el futuro', () => {
    expect(
      estadoPromocion({ activo: true, fechaInicio: '2099-01-01', fechaFin: '2099-01-31' }),
    ).toBe('programada')
  })

  it('vencida: activa y el rango ya terminó', () => {
    expect(
      estadoPromocion({ activo: true, fechaInicio: '2020-01-01', fechaFin: '2020-01-31' }),
    ).toBe('vencida')
  })

  // El eje que este composable existe para fijar: `activo` es independiente
  // de las fechas y gana siempre — "pausar es el gesto normal de apagarla"
  // (spec §Modelo de datos), a diferencia de la regla común que si está fuera
  // de vigencia simplemente no aplica sin que nadie la haya tocado.
  it('pausada gana sobre vigente', () => {
    const hoy = hoyLocal()
    expect(estadoPromocion({ activo: false, fechaInicio: hoy, fechaFin: hoy })).toBe('pausada')
  })

  it('pausada gana también sobre programada y vencida', () => {
    expect(
      estadoPromocion({ activo: false, fechaInicio: '2099-01-01', fechaFin: '2099-01-31' }),
    ).toBe('pausada')
    expect(
      estadoPromocion({ activo: false, fechaInicio: '2020-01-01', fechaFin: '2020-01-31' }),
    ).toBe('pausada')
  })
})

describe('usePromociones — estadoPromocionBadge', () => {
  it('vigente no lleva badge: es el caso esperado, no la excepción', () => {
    const hoy = hoyLocal()
    expect(estadoPromocionBadge({ activo: true, fechaInicio: hoy, fechaFin: hoy })).toBeNull()
  })

  it('pausada se pinta neutral', () => {
    expect(
      estadoPromocionBadge({ activo: false, fechaInicio: '2020-01-01', fechaFin: '2020-01-31' }),
    ).toEqual({ label: 'Pausada', color: 'neutral' })
  })

  it('programada se pinta info', () => {
    expect(
      estadoPromocionBadge({ activo: true, fechaInicio: '2099-01-01', fechaFin: '2099-01-31' }),
    ).toEqual({ label: 'Programada', color: 'info' })
  })

  it('vencida se pinta error', () => {
    expect(
      estadoPromocionBadge({ activo: true, fechaInicio: '2020-01-01', fechaFin: '2020-01-31' }),
    ).toEqual({ label: 'Vencida', color: 'error' })
  })
})
