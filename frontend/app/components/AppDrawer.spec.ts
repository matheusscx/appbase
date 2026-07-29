import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppDrawer from './AppDrawer.vue'

// UDrawer (Nuxt UI, sobre reka-ui) llama useAppConfig() en su propio setup(): sin una
// app Nuxt real revienta con "[nuxt] instance unavailable" antes de montar nada (ver
// docs/patterns/frontend.md §15). Es el root directo del template de AppDrawer, así
// que se stubea con template propio en vez de con `true`: necesita reaccionar a `open`
// (para que el contenido no quede en el DOM cuando está cerrado) y reenviar el cierre
// por `update:open` (para poder probar el v-model real de AppDrawer).
const stubs = {
  UDrawer: {
    name: 'UDrawer',
    props: ['open', 'title', 'description', 'direction', 'handle', 'inset', 'content', 'ui'],
    emits: ['update:open'],
    template: `
      <div v-if="open">
        <slot name="header" />
        <slot name="body" />
        <slot name="footer" />
        <slot />
        <button @click="$emit('update:open', false)">cerrar</button>
      </div>
    `,
  },
}

describe('AppDrawer', () => {
  it('monta abierto y proyecta el slot body', () => {
    const wrapper = mount(AppDrawer, {
      props: { open: true, title: 'Editar ítem' },
      slots: { body: '<p>contenido del cuerpo</p>' },
      global: { stubs },
    })

    expect(wrapper.text()).toContain('contenido del cuerpo')
  })

  it('propaga el prop open al UDrawer', () => {
    const wrapper = mount(AppDrawer, {
      props: { open: false, title: 'Editar ítem' },
      slots: { body: '<p>contenido del cuerpo</p>' },
      global: { stubs },
    })

    expect(wrapper.findComponent({ name: 'UDrawer' }).props('open')).toBe(false)
  })

  it('emite update:open al cerrarse', async () => {
    const wrapper = mount(AppDrawer, {
      props: { open: true, title: 'Editar ítem' },
      slots: { body: '<p>contenido del cuerpo</p>' },
      global: { stubs },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
