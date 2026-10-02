// @vitest-environment nuxt
//
// Entorno nuxt SOLO en este archivo: el default vive en el estado del
// componente, pero lo que el cajero ve es el `UCheckbox` REAL montado dentro
// del `UModal`, y esa es la única forma de cazar un binding que quedó al revés
// o un checkbox colgado del prop equivocado.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AnularVentaModal from './AnularVentaModal.vue'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => apiFetch)

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

async function abrir(
  tieneLineasDespachadas: boolean,
  extra: { preguntaExterno?: boolean, esBoleta?: boolean } = {},
) {
  const wrapper = await mountSuspended(AnularVentaModal, {
    props: {
      ventaId: 'venta-1',
      tieneLineasDespachadas,
      open: true,
      ...extra,
    },
  })
  // El `watch(open)` corre al abrir de verdad; montar con `open: true` no lo
  // dispara, así que el default tiene que estar bien en los DOS lados.
  await new Promise(r => setTimeout(r, 50))
  return wrapper
}

beforeEach(() => {
  document.body.innerHTML = ''
  apiFetch.mockReset()
  apiFetch.mockResolvedValue({ id: 'venta-1', estado: 'cancelada', stockRepuesto: true, motivo: 'x' })
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

describe('AnularVentaModal — el documento hecho por fuera se pregunta (E10)', () => {
  const botonAnular = () =>
    [...dialogo()!.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Anular venta') as HTMLButtonElement
  const boton = (qa: string) => dialogo()!.querySelector(`[data-qa="${qa}"]`) as HTMLButtonElement

  async function escribirMotivo(texto = 'Se ingresó dos veces por error') {
    const area = dialogo()!.querySelector('textarea')!
    area.value = texto
    area.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 20))
  }

  async function apretar(el: HTMLElement) {
    el.click()
    await new Promise(r => setTimeout(r, 30))
  }

  it('sin la bandera del backend no pregunta, anula y NO manda externoHecho', async () => {
    await abrir(false)
    await escribirMotivo()

    expect(dialogo()!.querySelector('[data-qa="pregunta-externo"]')).toBeNull()
    expect(botonAnular().disabled).toBe(false)
    await apretar(botonAnular())

    expect(apiFetch).toHaveBeenCalledTimes(1)
    const body = apiFetch.mock.calls[0]![1].body as Record<string, unknown>
    // "Ausente" es "no se preguntó": `null` o `false` serían otra conducta.
    expect(body).not.toHaveProperty('externoHecho')
  })

  it('pregunta con "factura" y el botón no se habilita hasta que conteste', async () => {
    await abrir(false, { preguntaExterno: true, esBoleta: false })
    await escribirMotivo()

    expect(dialogo()!.textContent).toContain('¿Ya hiciste esta factura en tu facturador?')
    expect(botonAnular().disabled).toBe(true)
  })

  it('si el tipo es boleta, pregunta por "este documento"', async () => {
    await abrir(false, { preguntaExterno: true, esBoleta: true })

    expect(dialogo()!.textContent).toContain('¿Ya hiciste este documento en tu facturador?')
  })

  it('con "No" anula y manda externoHecho: false', async () => {
    await abrir(false, { preguntaExterno: true, esBoleta: false })
    await escribirMotivo()
    await apretar(boton('externo-no'))

    expect(botonAnular().disabled).toBe(false)
    await apretar(botonAnular())

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch.mock.calls[0]![1].body).toEqual({
      motivo: 'Se ingresó dos veces por error',
      reponerStock: true,
      externoHecho: false,
    })
  })

  it('con "Sí" no anula: explica la nota de crédito y no llama al endpoint', async () => {
    const wrapper = await abrir(false, { preguntaExterno: true, esBoleta: false })
    await escribirMotivo()
    await apretar(boton('externo-si'))

    expect(botonAnular().disabled).toBe(true)
    expect(dialogo()!.textContent).toContain('nota de crédito, hecha por fuera en tu facturador y anotada acá con su número')
    // El botón está deshabilitado, pero el guard de `confirmar` no depende de él:
    // aunque algo lo invoque, el endpoint no se toca.
    await (wrapper.vm as unknown as { confirmar: () => Promise<void> }).confirmar()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('contestar "Sí" y arrepentirse a "No" vuelve a dejar anular', async () => {
    await abrir(false, { preguntaExterno: true, esBoleta: false })
    await escribirMotivo()
    await apretar(boton('externo-si'))
    await apretar(boton('externo-no'))

    expect(botonAnular().disabled).toBe(false)
    expect(dialogo()!.querySelector('[data-qa="externo-si-explica"]')).toBeNull()
  })
})
