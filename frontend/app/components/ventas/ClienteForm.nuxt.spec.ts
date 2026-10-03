// @vitest-environment nuxt
//
// El receptor de la factura en el formulario: lo que el tercero precarga y lo
// que el campo avisa. La regla (qué falta, el RUT, los largos) la prueba
// `useReceptor.spec.ts`; acá se fija que el formulario la cablea.
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import ClienteForm, { type CustomerForm } from './ClienteForm.vue'
import { customerVacio } from '~/composables/useVenta'

const CONSTRUCTORA = {
  id: 'tercero-1',
  tipo: 'empresa',
  nombre: 'Constructora',
  rut: null,
  nombreLegal: 'Constructora Los Andes SpA',
  rutFiscal: '76.543.210-3',
  correo: null,
  telefono: null,
  direccion: 'Av. Matta 1234',
  giro: 'Construcción de obras menores',
  comuna: 'Santiago',
  activo: true,
}

mockNuxtImport('useApiFetch', () => {
  return (url: string) =>
    Promise.resolve(typeof url === 'string' && url.endsWith('/terceros') ? [CONSTRUCTORA] : [])
})

async function montar(regla?: { receptorCompleto: boolean, rutChileno: boolean }, inicial?: Partial<CustomerForm>) {
  const modelo = { ...customerVacio(), ...inicial }
  const wrapper = await mountSuspended(ClienteForm, {
    props: {
      'modelValue': modelo,
      'onUpdate:modelValue': (v: CustomerForm) => Object.assign(modelo, v),
      ...(regla ? { regla } : {}),
    },
  })
  return { wrapper, modelo }
}

describe('ClienteForm — el receptor de la factura', () => {
  it('elegir un tercero precarga también el giro y la comuna', async () => {
    const { wrapper, modelo } = await montar({ receptorCompleto: true, rutChileno: true })
    await new Promise(r => setTimeout(r, 0))

    const selector = wrapper.findComponent({ name: 'USelectMenu' })
    selector.vm.$emit('update:modelValue', 'tercero-1')
    await nextTick()

    expect(modelo).toMatchObject({
      terceroId: 'tercero-1',
      nombre: 'Constructora Los Andes SpA',
      rut: '76.543.210-3',
      giro: 'Construcción de obras menores',
      direccion: 'Av. Matta 1234',
      comuna: 'Santiago',
    })
  })

  it('con la regla chilena, un RUT con DV malo se avisa en el campo', async () => {
    const { wrapper } = await montar({ receptorCompleto: false, rutChileno: true }, { nombre: 'Juan', rut: '76.543.210-5' })
    expect(wrapper.text()).toContain('RUT inválido')
  })

  it('sin la regla chilena, el mismo RUT no se avisa (otro país)', async () => {
    const { wrapper } = await montar(undefined, { nombre: 'Juan', rut: '76.543.210-5' })
    expect(wrapper.text()).not.toContain('RUT inválido')
  })

  it('el giro muestra su contador contra el largo del SII', async () => {
    const { wrapper } = await montar({ receptorCompleto: true, rutChileno: true }, { giro: 'Ferretería' })
    expect(wrapper.text()).toContain('10/40')
  })
})
