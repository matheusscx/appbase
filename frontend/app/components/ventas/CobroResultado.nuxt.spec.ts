// @vitest-environment nuxt
//
// 01.5 / 02.26: lo que queda en pantalla después de cobrar.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CobroResultado from './CobroResultado.vue'
import type { BoletaVenta } from '~/types/boleta'

const MONEDA_CLP = {
  monedaId: 'clp', nombre: 'Peso chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
  separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true, esOficial: true, valorDelDia: null,
}
beforeEach(() => { useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1') })

function boleta(extra: Partial<BoletaVenta> = {}): BoletaVenta {
  return {
    totales: { subtotalNeto: '1500', totalDescuentos: '0', totalRecargos: '0', totalImpuestos: '285', totalFinal: '1785' },
    propina: null,
    vuelto: null,
    boletaElectronica: null,
    ...extra,
  } as BoletaVenta
}

describe('CobroResultado', () => {
  it('muestra el total, el vuelto grande y el folio', async () => {
    const w = await mountSuspended(CobroResultado, {
      props: { titulo: 'Venta pagada', boleta: boleta({ vuelto: '3036', boletaElectronica: { folio: 4321 } as BoletaVenta['boletaElectronica'] }) },
    })
    expect(w.get('[data-qa="resultado-total"]').text().replace(/\s/g, '')).toBe('$1.785')
    const vuelto = w.get('[data-qa="resultado-vuelto"]')
    expect(vuelto.text().replace(/\s/g, '')).toBe('$3.036')
    expect(vuelto.classes()).toContain('text-3xl')
    expect(w.get('[data-qa="resultado-folio"]').text()).toBe('Boleta N° 4321')
  })

  it('el total incluye la propina que quedó registrada', async () => {
    const w = await mountSuspended(CobroResultado, {
      props: { titulo: 'Venta pagada', boleta: boleta({ propina: { monto: '179' } }) },
    })
    expect(w.get('[data-qa="resultado-total"]').text().replace(/\s/g, '')).toBe('$1.964')
  })

  it('sin vuelto ni folio no inventa filas', async () => {
    const w = await mountSuspended(CobroResultado, { props: { titulo: 'Venta pagada', boleta: boleta() } })
    expect(w.find('[data-qa="resultado-vuelto"]').exists()).toBe(false)
    expect(w.find('[data-qa="resultado-folio"]').exists()).toBe(false)
  })

  it('"Listo" lo cierra', async () => {
    const w = await mountSuspended(CobroResultado, { props: { titulo: 'Venta pagada', boleta: boleta() } })
    await w.get('[data-qa="cobro-resultado-cerrar"]').trigger('click')
    expect(w.emitted('cerrar')).toHaveLength(1)
  })
})
