import { describe, expect, it } from 'vitest'
import { ayudaNxm, estadoPromocion, estadoPromocionBadge, resumenNxm } from './usePromociones'

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

  // El eje que este composable existe para fijar: `activo` es independiente de
  // las fechas y gana siempre — "pausar es el gesto normal de apagarla"
  // (§ Modelo de datos de
  // `docs/superpowers/specs/2026-08-27-motor-promociones-design.md`), a
  // diferencia de la regla común que si está fuera de vigencia simplemente no
  // aplica sin que nadie la haya tocado.
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

// "Lleva N, paga M" (owner, 2026-10-13): lo que el local lee en la tabla y
// bajo los campos del drawer.
describe('usePromociones — resumenNxm', () => {
  it('al 100 % no nombra el porcentaje', () => {
    expect(resumenNxm({ cadaN: 3, pagaM: 1, valorPorcentaje: '1.0000' })).toBe('Lleva 3, paga 1')
  })

  it('con una regalada a menos de 100 % lo dice en singular', () => {
    expect(resumenNxm({ cadaN: 2, pagaM: 1, valorPorcentaje: '0.5000' })).toBe(
      'Lleva 2, paga 1 · regalada al 50%',
    )
  })

  it('con varias regaladas lo dice en plural', () => {
    expect(resumenNxm({ cadaN: 4, pagaM: 2, valorPorcentaje: '0.25' })).toBe(
      'Lleva 4, paga 2 · regaladas al 25%',
    )
  })

  it('sin N, M o valor no inventa nada', () => {
    expect(resumenNxm({ cadaN: null, pagaM: 1, valorPorcentaje: '1' })).toBe('—')
    expect(resumenNxm({ cadaN: 3, pagaM: null, valorPorcentaje: '1' })).toBe('—')
    expect(resumenNxm({ cadaN: 3, pagaM: 1, valorPorcentaje: null })).toBe('—')
  })
})

describe('usePromociones — ayudaNxm', () => {
  it('3x1: las 2 más baratas', () => {
    expect(ayudaNxm(3, 1)).toBe('De cada 3 unidades, las 2 más baratas llevan el descuento.')
  })

  it('2x1: la más barata, en singular', () => {
    expect(ayudaNxm(2, 1)).toBe('De cada 2 unidades, la más barata lleva el descuento.')
  })

  it('a medio llenar o con paga ≥ lleva no explica nada', () => {
    expect(ayudaNxm(null, 1)).toBe('')
    expect(ayudaNxm(3, null)).toBe('')
    expect(ayudaNxm(2, 2)).toBe('')
    expect(ayudaNxm(3, 0)).toBe('')
  })
})
