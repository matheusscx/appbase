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

    expect(sm.find('[data-qa="marco-columna"]').classes()).toContain('max-w-sm')
    expect(lg.find('[data-qa="marco-columna"]').classes()).toContain('max-w-lg')
  })
})
