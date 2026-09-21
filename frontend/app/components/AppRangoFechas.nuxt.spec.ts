// @vitest-environment nuxt
//
// Tarea 7 del plan del reporte de varianza. El selector de rango que cualquier
// pantalla con filtro de fecha puede usar. Lo que este spec fija:
//   1. Emite `YYYY-MM-DD` en los dos `update:`, nunca un `Date` ni un timestamp.
//   2. Monta `DiaNegocioNota` debajo: el rango se lee en días del NEGOCIO, y un
//      local con corte a las 05:00 necesita saberlo para leer sus propios números.
//   3. Con `desde` posterior a `hasta` avisa y NO emite: un rango invertido le
//      llega al backend como un 400 críptico, o peor, como una tabla vacía que el
//      encargado lee como "no pasó nada".
import { describe, it, expect } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AppRangoFechas from './AppRangoFechas.vue'

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url === 'string' && url.includes('/tenants/me')) {
      return Promise.resolve({ horaCorte: 5, diaNegocioHoy: '2026-09-21' })
    }
    return Promise.resolve({})
  }
})

describe('AppRangoFechas', () => {
  it('emite YYYY-MM-DD, no un Date ni un timestamp', async () => {
    const wrapper = await mountSuspended(AppRangoFechas, {
      props: { desde: '2026-09-01', hasta: '2026-09-30' },
    })

    const inputs = wrapper.findAllComponents({ name: 'AppDateInput' })
    expect(inputs).toHaveLength(2)

    inputs[0]!.vm.$emit('update:modelValue', '2026-09-05')
    inputs[1]!.vm.$emit('update:modelValue', '2026-09-25')
    await wrapper.vm.$nextTick()

    const desde = wrapper.emitted('update:desde')
    const hasta = wrapper.emitted('update:hasta')
    expect(desde?.[0]).toEqual(['2026-09-05'])
    expect(hasta?.[0]).toEqual(['2026-09-25'])
    // La forma importa tanto como el valor: el backend acepta fecha pura y la
    // expande al día del negocio del tenant. Un timestamp se la saltea.
    expect(String(desde?.[0]?.[0])).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('monta la nota del día de negocio', async () => {
    const wrapper = await mountSuspended(AppRangoFechas, {
      props: { desde: null, hasta: null },
    })
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
  })

  /**
   * ⛔ El aviso va en el componente y no en cada pantalla: si cada una lo
   * resuelve por su cuenta, la que se olvide manda el rango invertido igual.
   */
  it('con desde posterior a hasta avisa y no emite', async () => {
    const wrapper = await mountSuspended(AppRangoFechas, {
      props: { desde: '2026-09-01', hasta: '2026-09-30' },
    })

    const inputs = wrapper.findAllComponents({ name: 'AppDateInput' })
    inputs[0]!.vm.$emit('update:modelValue', '2026-10-15')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('El desde no puede ser posterior al hasta')
    expect(wrapper.emitted('update:desde')).toBeUndefined()
  })

  /**
   * El rango vacío es válido —el listado acepta `desde`/`hasta` ausentes— así que
   * limpiar una punta no puede quedar bloqueado por la validación del cruce.
   */
  it('limpiar una punta emite null y no dispara el aviso', async () => {
    const wrapper = await mountSuspended(AppRangoFechas, {
      props: { desde: '2026-09-01', hasta: '2026-09-30' },
    })

    const inputs = wrapper.findAllComponents({ name: 'AppDateInput' })
    inputs[0]!.vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:desde')?.[0]).toEqual([null])
    expect(wrapper.text()).not.toContain('El desde no puede ser posterior')
  })
})
