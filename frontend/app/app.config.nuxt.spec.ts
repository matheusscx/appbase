// @vitest-environment nuxt
//
// Lo que `app.config.ts` le cambia a Nuxt UI se mira en el componente montado, no en el
// objeto: un override con la clave mal escrita no falla, simplemente no se aplica.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { UBadge, UInput, UTextarea } from '#components'

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
