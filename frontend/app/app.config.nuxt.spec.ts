// @vitest-environment nuxt
//
// Lo que `app.config.ts` le cambia a Nuxt UI se mira en el componente montado, no en el
// objeto: un override con la clave mal escrita no falla, simplemente no se aplica.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { UBadge, UCheckbox, UFormField, UInput, USwitch, UTextarea } from '#components'

describe('app.config — insignias', () => {
  // Auditoría UX 01.17 y 05.17 (owner, 2026-10-16): ninguna insignia por debajo de 12 px.
  it.each(['xs', 'sm', 'md'] as const)('tamaño %s: letra de 12 px', async (size) => {
    const wrapper = await mountSuspended(UBadge, { props: { label: 'Pagada', size } })
    const clases = wrapper.element.className

    expect(clases).toMatch(/\btext-xs\b/)
    expect(clases).not.toMatch(/text-\[(8|10)px\]/)
  })
})

describe('app.config — placeholders', () => {
  // Auditoría UX 08.19: `text-dimmed` mide 2,63:1 sobre blanco; el mínimo es 4,5:1.
  it.each([['campo', UInput], ['área de texto', UTextarea]])('%s: placeholder en text-muted, no en text-dimmed', async (_n, Comp) => {
    const wrapper = await mountSuspended(Comp, { props: { placeholder: 'tu@email.com' } })
    const el = wrapper.find('input, textarea').element
    expect(el.className).toContain('placeholder:text-muted')
    expect(el.className).not.toContain('placeholder:text-dimmed')
  })
})

describe('app.config — campos de formulario', () => {
  // Auditoría UX 07.7: los campos medían 167 px aunque el panel tuviera 640. Un campo dentro de un
  // UFormField llena el ancho; uno suelto (un filtro de la barra) conserva el suyo.
  it('el control dentro de un UFormField llena el ancho', async () => {
    const wrapper = await mountSuspended(UFormField, {
      props: { label: 'Dirección' },
      slots: { default: () => h(UInput) },
    })
    const contenedor = wrapper.find('input').element.closest('div')!.parentElement as HTMLElement
    expect(contenedor.className).toContain('[&>*]:w-full')
  })

  it('un UInput suelto no cambia de ancho', async () => {
    const wrapper = await mountSuspended(UInput)
    expect(wrapper.element.className).not.toMatch(/\bw-full\b/)
  })
})

describe('app.config — área táctil', () => {
  // Auditoría UX 07.26: interruptores de 32×18 y casillas de 16×16; el objetivo es 44 px.
  it('interruptor: un área de 44 px alrededor del dibujo, sobre el botón', async () => {
    const wrapper = await mountSuspended(USwitch)
    const clases = wrapper.find('button').element.className
    expect(clases).toContain('after:size-11')
    expect(clases).toContain('relative')
  })

  it('casilla: sin área agregada, el contenedor no le tapa el toque al botón', async () => {
    const wrapper = await mountSuspended(UCheckbox)
    expect(wrapper.find('button').element.parentElement!.className).not.toContain('after:')
  })
})
