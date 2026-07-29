import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AdvertenciasPrecio from './AdvertenciasPrecio.vue'

// UTooltip/UIcon/UButton (Nuxt UI) requieren un TooltipProvider/AppConfig que solo
// existe dentro de una app Nuxt real. Ni `mount` plano ni `mountSuspended` los
// resuelven sin ese contexto (ver evidencia en task-1-report.md), así que se
// stubean explícitamente. UTooltip necesita template propio para proyectar su
// slot y que el UButton exista en el DOM; los otros dos alcanzan con `true`,
// que preserva los atributos (incluido el aria-label).
const stubs = {
  UIcon: true,
  UTooltip: { template: '<div><slot /></div>' },
  UButton: true,
}

describe('AdvertenciasPrecio', () => {
  it('sin advertencias no renderiza nada', () => {
    const wrapper = mount(AdvertenciasPrecio, {
      props: { advertencias: [] },
      global: { stubs },
    })

    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('renderiza un título por advertencia', () => {
    const wrapper = mount(AdvertenciasPrecio, {
      props: {
        advertencias: [
          { titulo: 'Descuento "Promo fija $5.000"', detalle: 'no se aplicó completo porque superaba el monto disponible' },
          { titulo: 'Descuento "Segunda promo"', detalle: 'no se aplicó completo porque superaba el monto disponible' },
        ],
      },
      global: { stubs },
    })

    expect(wrapper.findAll('p')).toHaveLength(2)
    expect(wrapper.text()).toContain('Descuento "Promo fija $5.000"')
    expect(wrapper.text()).toContain('Descuento "Segunda promo"')
    // Ata la aserción al tag del stub (no a la clase CSS): si <UIcon> queda mal
    // escrito, Vue no lo resuelve al stub y este find deja de encontrarlo.
    expect(wrapper.findAll('u-icon-stub')).toHaveLength(2)
  })

  // Este es el test que la versión con root Fragment no pasa: Vue descartaba en
  // silencio el class que le pasan los tres carritos (fix 79f1e37).
  it('recibe el class que le pasa el padre en su elemento raíz', () => {
    const wrapper = mount(AdvertenciasPrecio, {
      props: { advertencias: [{ titulo: 'T', detalle: 'D' }] },
      attrs: { class: 'mb-2' },
      global: { stubs },
    })

    expect(wrapper.classes()).toContain('mb-2')
  })

  it('el detalle viaja en el aria-label, no en el texto visible', () => {
    const wrapper = mount(AdvertenciasPrecio, {
      props: { advertencias: [{ titulo: 'Descuento "Promo"', detalle: 'no se aplicó completo' }] },
      global: { stubs },
    })

    expect(wrapper.text()).not.toContain('no se aplicó completo')
    // Atadas al tag del stub, no a un selector de atributo genérico: si
    // <UTooltip> o <UButton> quedan mal escritos, Vue no los resuelve al stub
    // y estos find dejan de encontrarlos.
    expect(wrapper.find('p > div').exists()).toBe(true)
    expect(wrapper.find('u-button-stub[aria-label="Detalle: no se aplicó completo"]').exists()).toBe(true)
  })
})
