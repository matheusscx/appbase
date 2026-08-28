// @vitest-environment nuxt
//
// El filtro vive en el TEMPLATE (qué filas se dibujan), así que solo se ve
// renderizando: ni el build ni el typecheck saben que una promo con monto `'0'`
// no debería aparecer. La regla existe porque el TICKET ya la tenía
// (`ticket-builder.ts`, `lineasTotalesConImpuestos`) y este componente —el
// desglose del carrito— no: la misma venta se contaba distinto en cada
// superficie.
//
// El monto `'0'` no es hipotético: lo produce el piso en cero cuando el
// descuento de catálogo ya se llevó la línea entera y la promo queda recortada
// a nada. Está fijado del lado del motor en `calculo-precios.engine.spec.ts`
// ("un descuento que se lleva la línea entera deja la promo en traza con monto
// 0"), porque un filtro sobre un estado imposible sería código muerto.
//
// Los tres consumidores (`CarritoPanel.vue`, `CarritoOnline.vue` y
// `salones/index.vue`) le pasan la misma expresión verbatim, así que testear el
// componente los cubre a los tres.
import { describe, it, expect } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import PromocionesAplicadas from './PromocionesAplicadas.vue'
import type { TrazaPromo } from '~/composables/useCalculoPrecios'

// El formato de plata tiene su propio spec (`currency-format.spec.ts`) y
// necesita el store de monedas; acá estorba. Se mockea para que el texto
// renderizado sea el monto crudo y las aserciones hablen del filtro.
mockNuxtImport('useFormatters', () => {
  return () => ({ formatMonto: (v: string) => `$${v}` })
})

const promo = (over: Partial<TrazaPromo> = {}): TrazaPromo => ({
  id: 'promo-1',
  nombre: '2x1 martes',
  tipo: 'nxm',
  monto: '500',
  valorEfectivo: '1.0000',
  aplicacion: 1,
  ...over,
})

const montar = (promociones: TrazaPromo[]) =>
  mountSuspended(PromocionesAplicadas, {
    props: { promociones },
    global: { stubs: { UIcon: true } },
  })

describe('PromocionesAplicadas', () => {
  it('dibuja una fila por promo con plata', async () => {
    const wrapper = await montar([
      promo(),
      promo({ id: 'promo-2', nombre: 'Combo almuerzo', monto: '1200' }),
    ])

    const filas = wrapper.findAll('p')
    expect(filas).toHaveLength(2)
    expect(filas[0]!.text()).toContain('2x1 martes')
    expect(filas[0]!.text()).toContain('-$500')
    expect(filas[1]!.text()).toContain('Combo almuerzo')
  })

  it('no dibuja la promo que el piso en cero recortó hasta 0', async () => {
    const wrapper = await montar([
      promo({ id: 'perdedora', nombre: 'Happy hour', monto: '0' }),
      promo({ id: 'ganadora', nombre: 'Combo almuerzo', monto: '1200' }),
    ])

    const filas = wrapper.findAll('p')
    expect(filas).toHaveLength(1)
    expect(filas[0]!.text()).toContain('Combo almuerzo')
    expect(wrapper.text()).not.toContain('Happy hour')
  })

  it('si NINGUNA promo tiene plata no queda ni el contenedor', async () => {
    // El `v-if` mira la lista ya filtrada, no la cruda: mirando la cruda queda
    // un div vacío que igual ocupa el `gap` del carrito.
    const wrapper = await montar([
      promo({ monto: '0' }),
      promo({ id: 'otra', monto: '0.0000' }),
    ])

    expect(wrapper.find('div').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })
})
