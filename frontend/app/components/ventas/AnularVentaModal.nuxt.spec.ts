// @vitest-environment nuxt
//
// Entorno nuxt SOLO en este archivo: el default vive en el estado del
// componente, pero lo que el cajero ve es el `UCheckbox` REAL montado dentro
// del `UModal`, y esa es la única forma de cazar un binding que quedó al revés
// o un checkbox colgado del prop equivocado.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AnularVentaModal from './AnularVentaModal.vue'

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => vi.fn())

/** El modal lo teletransporta `UModal` fuera del wrapper. */
function dialogo(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]')
}

/**
 * El estado real del control, no el `ref` del setup: Nuxt UI monta el checkbox
 * como un `button[role=checkbox]` con `aria-checked`, que es lo que lee tanto
 * el cajero como un lector de pantalla.
 */
function reposicionTildada(): boolean {
  const d = dialogo()
  expect(d, 'el modal abierto').toBeTruthy()
  const check = d!.querySelector('[role="checkbox"]')
  expect(check, 'el checkbox de reposición dentro del modal').toBeTruthy()
  return check!.getAttribute('aria-checked') === 'true'
}

async function abrir(tieneLineasDespachadas: boolean) {
  const wrapper = await mountSuspended(AnularVentaModal, {
    props: {
      ventaId: 'venta-1',
      tieneLineasDespachadas,
      open: true,
    },
  })
  // El `watch(open)` corre al abrir de verdad; montar con `open: true` no lo
  // dispara, así que el default tiene que estar bien en los DOS lados.
  await new Promise(r => setTimeout(r, 50))
  return wrapper
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('AnularVentaModal — default de "Reponer el stock"', () => {
  it('sin nada despachado nace TILDADO: es la venta normal, el stock vuelve', async () => {
    await abrir(false)

    expect(reposicionTildada()).toBe(true)
    expect(dialogo()!.textContent).not.toContain('enviados a cocina')
  })

  it('con alguna línea ya enviada a cocina nace DESTILDADO y dice por qué', async () => {
    // Reponer comida ya cocinada mete al inventario ingredientes que no
    // existen. El checkbox sigue habilitado: es un default, no un bloqueo.
    await abrir(true)

    expect(reposicionTildada()).toBe(false)
    expect(dialogo()!.textContent).toContain('platos ya enviados a cocina')
  })

  it('el cajero puede tildarlo igual: la mercadería puede seguir vendible', async () => {
    await abrir(true)

    const check = dialogo()!.querySelector('[role="checkbox"]') as HTMLElement
    expect(check.hasAttribute('disabled')).toBe(false)
    check.click()
    await new Promise(r => setTimeout(r, 50))

    expect(reposicionTildada()).toBe(true)
  })
})
