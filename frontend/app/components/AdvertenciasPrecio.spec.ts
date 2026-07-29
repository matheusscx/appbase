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
    expect(wrapper.find('[aria-label="Detalle: no se aplicó completo"]').exists()).toBe(true)
  })
})
