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
  UButton: { template: '<button type="button"><slot /></button>' },
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

  // Auditoría UX 07.13: Escape, un clic al lado o "Cancelar" tiraban lo tipeado sin preguntar.
  describe('cambios sin guardar', () => {
    const slots = {
      body: '<input data-qa="campo" />',
      actions: '<button data-qa="cancelar" type="button">Cancelar</button>',
    }
    const montar = () => mount(AppDrawer, {
      props: { open: true, title: 'Nuevo producto' },
      slots,
      attachTo: document.body,
      global: { stubs },
    })

    it('sin haber tocado nada, cerrar es directo', async () => {
      const w = montar()
      await w.findAll('button').find(b => b.text() === 'cerrar')!.trigger('click')
      expect(w.emitted('update:open')).toEqual([[false]])
      expect(w.find('[data-qa="drawer-descartar"]').exists()).toBe(false)
    })

    it('con algo tipeado, cerrar pregunta y no cierra', async () => {
      const w = montar()
      await w.find('[data-qa="campo"]').trigger('input')
      await w.findAll('button').find(b => b.text() === 'cerrar')!.trigger('click')
      expect(w.emitted('update:open')).toBeUndefined()
      expect(w.text()).toContain('Tienes cambios sin guardar')
    })

    it('"Seguir editando" vuelve al formulario sin cerrar', async () => {
      const w = montar()
      await w.find('[data-qa="campo"]').trigger('input')
      await w.findAll('button').find(b => b.text() === 'cerrar')!.trigger('click')
      await w.find('[data-qa="drawer-seguir"]').trigger('click')
      expect(w.emitted('update:open')).toBeUndefined()
      expect(w.find('[data-qa="drawer-descartar"]').exists()).toBe(false)
    })

    it('"Descartar" cierra', async () => {
      const w = montar()
      await w.find('[data-qa="campo"]').trigger('input')
      await w.findAll('button').find(b => b.text() === 'cerrar')!.trigger('click')
      await w.find('[data-qa="drawer-descartar"]').trigger('click')
      expect(w.emitted('update:open')).toEqual([[false]])
    })

    it('"Cancelar" con cambios también pregunta', async () => {
      const w = montar()
      await w.find('[data-qa="campo"]').trigger('change')
      await w.find('[data-qa="cancelar"]').trigger('click')
      expect(w.text()).toContain('Tienes cambios sin guardar')
    })

    it('un drawer reabierto parte limpio', async () => {
      const w = montar()
      await w.find('[data-qa="campo"]').trigger('input')
      await w.setProps({ open: false })
      await w.setProps({ open: true })
      await w.findAll('button').find(b => b.text() === 'cerrar')!.trigger('click')
      expect(w.emitted('update:open')).toEqual([[false]])
    })
  })

  // 07.6: a 768 el 50 % deja 384 px y las grillas de dos columnas truncan lo elegido.
  it('el ancho en porcentaje tiene piso de 28rem', () => {
    const w = mount(AppDrawer, { props: { open: true, width: '50%' }, global: { stubs } })
    const content = w.findComponent({ name: 'UDrawer' }).props('content') as { style: { width: string } }
    expect(content.style.width).toBe('max(28rem, 50%)')
  })
})
