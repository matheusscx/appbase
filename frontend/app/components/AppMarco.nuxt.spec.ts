// @vitest-environment nuxt
//
// El marco de las pantallas públicas de marca (spec de identidad, § 3.2): logo
// de Venka arriba, título con la letra de marca, y —solo si la pantalla lo pide—
// el ícono de la acción y un panel lateral para escritorio.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppMarco from './AppMarco.vue'

describe('AppMarco', () => {
  it('muestra el logo de Venka', async () => {
    const wrapper = await mountSuspended(AppMarco, { props: { titulo: 'Hola' } })
    const logo = wrapper.find('img[alt="Venka"]')

    expect(logo.exists()).toBe(true)
    expect(logo.attributes('src')).toBe('/marca/venka-positivo.svg')
  })

  it('el título va con la letra de marca', async () => {
    const wrapper = await mountSuspended(AppMarco, { props: { titulo: 'Crea tu cuenta' } })
    const h1 = wrapper.find('h1')

    expect(h1.text()).toBe('Crea tu cuenta')
    expect(h1.classes()).toContain('font-display')
  })

  it('el ícono de la acción aparece solo si se pasa', async () => {
    const con = await mountSuspended(AppMarco, {
      props: { titulo: 'Recuperar', icono: 'i-lucide-key-round' },
    })
    const sin = await mountSuspended(AppMarco, { props: { titulo: 'Recuperar' } })

    expect(con.find('[data-qa="marco-icono"]').exists()).toBe(true)
    expect(sin.find('[data-qa="marco-icono"]').exists()).toBe(false)
  })

  it('sin slot lateral no hay panel', async () => {
    const sin = await mountSuspended(AppMarco, { props: { titulo: 'Hola' } })
    const con = await mountSuspended(AppMarco, {
      props: { titulo: 'Hola' },
      slots: { lateral: '<p>marca</p>' },
    })

    expect(sin.find('[data-qa="marco-lateral"]').exists()).toBe(false)
    expect(con.find('[data-qa="marco-lateral"]').exists()).toBe(true)
    expect(con.find('[data-qa="marco-lateral"]').text()).toBe('marca')
  })

  it('con panel lateral el logo positivo solo se ve donde el panel no está', async () => {
    const wrapper = await mountSuspended(AppMarco, {
      props: { titulo: 'Hola' },
      slots: { lateral: '<p>marca</p>' },
    })

    expect(wrapper.find('img[alt="Venka"]').classes()).toContain('lg:hidden')
  })

  it('el ancho lg ensancha la columna', async () => {
    const sm = await mountSuspended(AppMarco, { props: { titulo: 'Hola' } })
    const lg = await mountSuspended(AppMarco, { props: { titulo: 'Hola', ancho: 'lg' } })

    expect(sm.find('[data-qa="marco-columna"]').classes()).toContain('max-w-105')
    expect(lg.find('[data-qa="marco-columna"]').classes()).toContain('max-w-lg')
  })

  // 08.18: la tarjeta de la maqueta mide ~420 px (la columna era de 384).
  it('la columna estándar mide 420 px, como la maqueta', async () => {
    const sm = await mountSuspended(AppMarco, { props: { titulo: 'Hola' } })
    expect(sm.find('[data-qa="marco-columna"]').classes()).not.toContain('max-w-sm')
  })

  // 08.22: un solo estado de carga para las pantallas de ingreso: el marco con
  // logo y un indicador con su texto, en lugar del contenido.
  it('con `cargando` muestra el indicador con su texto y esconde el contenido', async () => {
    const w = await mountSuspended(AppMarco, {
      props: { titulo: 'Hola', cargando: 'Verificando el link…' },
      slots: { default: '<p>formulario</p>' },
    })
    const estado = w.find('[role="status"]')
    expect(estado.text()).toContain('Verificando el link…')
    expect(w.find('img[alt="Venka"]').exists()).toBe(true)
    expect(w.text()).not.toContain('formulario')
  })

  it('sin `cargando` muestra el contenido', async () => {
    const w = await mountSuspended(AppMarco, {
      props: { titulo: 'Hola' },
      slots: { default: '<p>formulario</p>' },
    })
    expect(w.find('[role="status"]').exists()).toBe(false)
    expect(w.text()).toContain('formulario')
  })
})
