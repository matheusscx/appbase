import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RolPermisosPorModulo from './RolPermisosPorModulo.vue'
import type { ModuloDisponible } from './RolPermisosPorModulo.vue'

const MODULOS: ModuloDisponible[] = [
  {
    moduloTenantId: 'm-ventas',
    moduloAppId: 'app-ventas',
    nombre: 'Ventas',
    icono: null,
    permisos: [
      { moduloAppPermisoId: 'p-leer', permisoNombre: 'Leer' },
      { moduloAppPermisoId: 'p-crear', permisoNombre: 'Crear' },
    ],
  },
  {
    moduloTenantId: 'm-inventario',
    moduloAppId: 'app-inventario',
    nombre: 'Inventario',
    icono: null,
    permisos: [{ moduloAppPermisoId: 'p-inv-leer', permisoNombre: 'Leer' }],
  },
]

// UInput/UAccordion/UCheckbox (Nuxt UI) no montan sin contexto Nuxt real (ver
// AdvertenciasPrecio.spec.ts). UInput necesita un <input> real porque el test de
// búsqueda escribe en él con setValue. UAccordion necesita template propio que
// proyecte los slots #trailing y #body por cada item para poder verificar el
// conteo por módulo, que es lo que hace el componente real con
// `:unmount-on-hide="false"`. UCheckbox alcanza con `true`.
const stubs = {
  UInput: {
    props: ['modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
  },
  UAccordion: {
    props: ['items'],
    template: `
      <div>
        <div v-for="item in items" :key="item.value">
          <span>{{ item.label }}</span>
          <slot name="trailing" :item="item" />
          <slot name="body" :item="item" />
        </div>
      </div>
    `,
  },
  UCheckbox: true,
}

describe('RolPermisosPorModulo', () => {
  it('sin módulos muestra el mensaje por defecto', () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: [], seleccionados: new Set<string>() },
      global: { stubs },
    })

    expect(wrapper.text()).toContain('El tenant no tiene módulos contratados.')
  })

  it('deshabilitado muestra su mensaje y no ofrece el buscador', () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: {
        modulos: MODULOS,
        seleccionados: new Set<string>(),
        disabled: true,
        disabledMessage: 'El rol admin no se edita.',
      },
      global: { stubs },
    })

    expect(wrapper.text()).toContain('El rol admin no se edita.')
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('lista un módulo por cada uno recibido', () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: MODULOS, seleccionados: new Set<string>() },
      global: { stubs },
    })

    expect(wrapper.text()).toContain('Ventas')
    expect(wrapper.text()).toContain('Inventario')
  })

  it('la búsqueda filtra por nombre de módulo', async () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: MODULOS, seleccionados: new Set<string>() },
      global: { stubs },
    })

    await wrapper.find('input').setValue('inven')

    expect(wrapper.text()).toContain('Inventario')
    expect(wrapper.text()).not.toContain('Ventas')
  })

  it('sin coincidencias avisa con el término buscado', async () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: MODULOS, seleccionados: new Set<string>() },
      global: { stubs },
    })

    await wrapper.find('input').setValue('zzz')

    expect(wrapper.text()).toContain('Ningún módulo coincide con «zzz».')
  })

  it('el conteo muestra seleccionados sobre total del módulo', () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: MODULOS, seleccionados: new Set(['p-leer']) },
      global: { stubs },
    })

    expect(wrapper.text()).toContain('1/2')
    expect(wrapper.text()).toContain('0/1')
  })
})
