// @vitest-environment nuxt
//
// Lote 7 de la auditoría UX (05.20, 07.3): una lista que falló o a la que el usuario no tiene
// permiso no puede decir lo mismo que una lista vacía.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppEstadoLista from './AppEstadoLista.vue'

const base = { recurso: 'traslados', vacio: 'No hay traslados registrados.' }

describe('AppEstadoLista', () => {
  it('sin nada especial dice el vacío del llamador', async () => {
    const w = await mountSuspended(AppEstadoLista, { props: base })
    expect(w.text()).toContain('No hay traslados registrados.')
    expect(w.find('[data-qa="estado-reintentar"]').exists()).toBe(false)
  })

  it('en error NO dice el vacío: nombra lo que falló y ofrece Reintentar', async () => {
    const w = await mountSuspended(AppEstadoLista, { props: { ...base, error: true } })
    expect(w.text()).not.toContain('No hay traslados registrados.')
    expect(w.text()).toContain('No pudimos cargar traslados')
    expect(w.find('[data-qa="estado-reintentar"]').exists()).toBe(true)
  })

  it('Reintentar lo emite la persona al tocar; el componente no reintenta solo', async () => {
    const w = await mountSuspended(AppEstadoLista, { props: { ...base, error: true } })
    expect(w.emitted('reintentar')).toBeUndefined()
    await w.find('[data-qa="estado-reintentar"]').trigger('click')
    expect(w.emitted('reintentar')).toHaveLength(1)
  })

  it('sin permiso dice "Sin acceso a X" y no ofrece reintentar', async () => {
    const w = await mountSuspended(AppEstadoLista, { props: { ...base, error: true, sinPermiso: true } })
    expect(w.text()).toContain('Sin acceso a traslados. Pídele al administrador que te lo habilite.')
    expect(w.text()).not.toContain('No hay traslados registrados.')
    expect(w.find('[data-qa="estado-reintentar"]').exists()).toBe(false)
  })

  it('"a" + "el" se contraen en "al"', async () => {
    const w = await mountSuspended(AppEstadoLista, { props: { ...base, recurso: 'el stock mínimo', error: true, sinPermiso: true } })
    expect(w.text()).toContain('Sin acceso al stock mínimo.')
  })

  it('con filtro activo dice que el filtro no encontró nada y ofrece quitarlo', async () => {
    const w = await mountSuspended(AppEstadoLista, { props: { ...base, filtrado: true } })
    expect(w.text()).not.toContain('No hay traslados registrados.')
    expect(w.text()).toContain('Ningún resultado con esos filtros.')
    await w.find('[data-qa="estado-quitar-filtros"]').trigger('click')
    expect(w.emitted('quitarFiltros')).toHaveLength(1)
  })

  it('el texto de filtro lo puede poner el llamador', async () => {
    const w = await mountSuspended(AppEstadoLista, {
      props: { ...base, filtrado: true, filtradoTexto: 'No encontramos «zzzz».' },
    })
    expect(w.text()).toContain('No encontramos «zzzz».')
  })

  it('el filtro sin handler no muestra botón', async () => {
    const w = await mountSuspended(AppEstadoLista, { props: { ...base, filtrado: true, sinQuitarFiltros: true } })
    expect(w.find('[data-qa="estado-quitar-filtros"]').exists()).toBe(false)
  })

  it('el error gana sobre el filtro', async () => {
    const w = await mountSuspended(AppEstadoLista, { props: { ...base, error: true, filtrado: true } })
    expect(w.text()).toContain('No pudimos cargar traslados')
  })
})
