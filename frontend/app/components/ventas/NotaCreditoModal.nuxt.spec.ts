// @vitest-environment nuxt
//
// "¿Por dónde vuelve la plata?" (spec `2026-10-01-emision-por-venta`, § 3.6). Lo
// que se prueba es lo que el cajero ve y lo que sale en el body:
//   1. Una opción por pago que dio el backend, y "No vuelve plata" solo si el
//      backend la mandó (la venta tiene saldo). La pantalla no la inventa.
//   2. Con varias opciones no viene ninguna elegida: un default movería plata de
//      la caja sin que nadie lo decida. Con una sola, viene elegida.
//   3. Dice en una línea qué registro va a quedar, el que anuncia el backend.
//   4. El body lleva `devolucion` (el pago, o `sinPlata`), nunca el documento ni
//      la casilla `devolverDinero` de antes.
//   5. Una opción en efectivo no se puede elegir sin una caja física abierta.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import NotaCreditoModal from './NotaCreditoModal.vue'
import type { OpcionDevolucion } from '~/composables/useDocumentosVenta'

const CLP = {
  monedaId: 'clp-1',
  nombre: 'Peso chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esOficial: true,
  valorDelDia: null,
}

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => apiFetch)

const DETALLES = [
  {
    itemId: 'item-1',
    descripcion: 'Pizza',
    cantidad: '1',
    totalLinea: '11900.0000',
    modoInventario: null,
    cantidadDevuelta: '0',
  },
]

const EFECTIVO: OpcionDevolucion = {
  pagoId: 'pago-efectivo',
  sinPlata: false,
  metodo: 'Efectivo',
  monto: '5000.0000',
  mueveCaja: true,
  registro: 'nota_credito_sistema',
}
const TARJETA: OpcionDevolucion = {
  pagoId: 'pago-tarjeta',
  sinPlata: false,
  metodo: 'Tarjeta de débito',
  monto: '6900.0000',
  mueveCaja: false,
  registro: 'nota_maquina',
}
const SIN_PLATA: OpcionDevolucion = {
  pagoId: null,
  sinPlata: true,
  metodo: null,
  monto: '60000.0000',
  mueveCaja: false,
  registro: 'nota_externa',
}

function dialogo(): HTMLElement {
  const d = document.body.querySelector('[role="dialog"]')
  expect(d, 'el modal abierto').toBeTruthy()
  return d as HTMLElement
}

async function esperar(ms = 50) {
  await new Promise(r => setTimeout(r, ms))
}

/** Monta cerrado y abre: la elección por defecto nace en el `watch(open)`. */
async function montar(opciones: OpcionDevolucion[], caja: boolean = true) {
  apiFetch.mockImplementation((url: string) =>
    url.endsWith('/caja/activa')
      ? Promise.resolve(caja ? { id: 'caja-1', estado: 'abierta' } : null)
      : Promise.resolve({
          id: 'nc-1',
          totalFinal: '1500.0000',
          movimientoCajaId: null,
          fecha: '2026-10-02',
          comentario: null,
          devoluciones: [],
        }),
  )
  useMonedasStore().hydrate([CLP], 'tenant-1')
  const wrapper = await mountSuspended(NotaCreditoModal, {
    props: {
      ventaId: 'v-1',
      disponible: '11900.0000',
      porPorcion: [],
      detalles: DETALLES,
      configCalculo: null,
      opciones,
      open: false,
    },
  })
  await wrapper.setProps({ open: true })
  await esperar()
  return wrapper
}

const radios = () => [...dialogo().querySelectorAll<HTMLElement>('[role="radio"]')]
// El texto de una opción vive en su `label`, hermano del botón: el `aria-label`
// del radio lleva el rótulo y `itemDe` devuelve la fila entera (rótulo + ayuda).
const radio = (texto: string) => radios().find(r => r.getAttribute('aria-label')?.includes(texto))
const itemDe = (el: HTMLElement | undefined) => el?.closest('[data-slot="item"]')?.textContent ?? ''
const marcado = (el: HTMLElement | undefined) => el?.getAttribute('aria-checked') === 'true'
const generar = () =>
  [...dialogo().querySelectorAll('button')]
    .find(b => b.textContent?.includes('Generar nota de crédito')) as HTMLButtonElement
const registro = () => dialogo().querySelector('[data-qa="registro-que-queda"]')?.textContent ?? null

async function elegir(texto: string) {
  const r = radio(texto)
  expect(r, `la opción "${texto}"`).toBeTruthy()
  r!.click()
  await esperar()
}

beforeEach(() => {
  document.body.innerHTML = ''
  apiFetch.mockReset()
})

describe('NotaCreditoModal — ¿Por dónde vuelve la plata?', () => {
  it('ofrece una opción por pago, con el medio y lo que cubrió', async () => {
    await montar([EFECTIVO, TARJETA])

    expect(radios()).toHaveLength(2)
    expect(itemDe(radio('Efectivo'))).toContain('$5.000')
    expect(itemDe(radio('Tarjeta de débito'))).toContain('$6.900')
    expect(dialogo().textContent).toContain('¿Por dónde vuelve la plata?')
  })

  it('"No vuelve plata" aparece solo si el backend la mandó, con lo que se debe', async () => {
    await montar([TARJETA])
    expect(radio('No vuelve plata')).toBeUndefined()

    document.body.innerHTML = ''
    await montar([TARJETA, SIN_PLATA])
    expect(itemDe(radio('No vuelve plata'))).toContain('$60.000')
  })

  it('con varias opciones no viene ninguna elegida y no se puede confirmar', async () => {
    await montar([EFECTIVO, TARJETA])

    expect(radios().every(r => !marcado(r))).toBe(true)
    expect(registro()).toBeNull()
    expect(generar().disabled).toBe(true)
  })

  it('con una sola opción viene elegida: no hay nada que decidir', async () => {
    await montar([TARJETA])

    expect(marcado(radio('Tarjeta de débito'))).toBe(true)
    expect(generar().disabled).toBe(false)
  })

  it('al elegir dice, en una línea, qué registro va a quedar', async () => {
    await montar([EFECTIVO, TARJETA, SIN_PLATA])

    await elegir('Efectivo')
    expect(registro()).toContain('armada por el sistema')
    await elegir('Tarjeta de débito')
    expect(registro()).toContain('nota de crédito de la máquina')
    await elegir('No vuelve plata')
    expect(registro()).toContain('hecha por fuera')
    expect(generar().disabled).toBe(false)
  })

  it('una devolución interna lo dice con esas palabras', async () => {
    await montar([{ ...TARJETA, registro: 'devolucion_interna' }])

    expect(registro()).toContain('devolución interna')
    expect(registro()).toContain('sin documento tributario')
  })
})

describe('NotaCreditoModal — el body', () => {
  async function confirmar(): Promise<Record<string, unknown>> {
    generar().click()
    await esperar()
    const llamada = apiFetch.mock.calls.find(([url]) => String(url).endsWith('/notas-credito'))
    expect(llamada, 'el POST de la nota').toBeTruthy()
    return llamada![1].body as Record<string, unknown>
  }

  it('manda el pago elegido y nada que diga qué documento corrige', async () => {
    await montar([EFECTIVO, TARJETA])
    await elegir('Tarjeta de débito')

    const body = await confirmar()

    expect(body.devolucion).toEqual({ pagoId: 'pago-tarjeta' })
    expect(body).not.toHaveProperty('devolverDinero')
    expect(JSON.stringify(body)).not.toMatch(/documento|emisor/i)
  })

  it('"No vuelve plata" manda sinPlata', async () => {
    await montar([TARJETA, SIN_PLATA])
    await elegir('No vuelve plata')

    const body = await confirmar()

    expect(body.devolucion).toEqual({ sinPlata: true })
  })
})

describe('NotaCreditoModal — el monto propuesto y su tope siguen a la opción elegida', () => {
  // La venta tiene disponible $11.900; el efectivo admite $5.000 y la tarjeta $6.900
  // (lo que cada pago todavía puede devolver). "Devolver todo por la tarjeta" no
  // puede proponer los $11.900: el servidor lo rechaza con un 400.
  const campoMonto = () => dialogo().querySelector<HTMLInputElement>('input')!
  const errorDeMonto = () => dialogo().textContent?.includes('no superar el disponible') ?? false
  async function escribirMonto(valor: string) {
    const input = campoMonto()
    input.value = valor
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await esperar()
  }
  async function montoQueSale(): Promise<unknown> {
    generar().click()
    await esperar()
    const llamada = apiFetch.mock.calls.find(([url]) => String(url).endsWith('/notas-credito'))
    expect(llamada, 'el POST de la nota').toBeTruthy()
    return (llamada![1].body as Record<string, unknown>).monto
  }

  it('sin opción elegida propone lo disponible; al elegir pasa a lo que la opción admite', async () => {
    await montar([EFECTIVO, TARJETA])
    expect(campoMonto().value).toContain('11.900')

    await elegir('Tarjeta de débito')
    expect(campoMonto().value).toContain('6.900')
    await elegir('Efectivo')
    expect(campoMonto().value).toContain('5.000')
  })

  it('con una sola opción viene propuesto lo que ella admite, no lo disponible', async () => {
    await montar([TARJETA])

    expect(campoMonto().value).toContain('6.900')
    expect(await montoQueSale()).toBe('6900')
  })

  it('al reabrir con una sola opción vuelve a proponer lo que ella admite (la elección no cambió, no hay nada que lo dispare)', async () => {
    const wrapper = await montar([TARJETA])
    await escribirMonto('1000')

    await wrapper.setProps({ open: false })
    await esperar()
    await wrapper.setProps({ open: true })
    await esperar()

    expect(campoMonto().value).toContain('6.900')
  })

  it('una opción que admite más que lo disponible propone lo disponible (el menor de los dos topes)', async () => {
    await montar([SIN_PLATA]) // $60.000 por cobrar, pero la venta solo admite $11.900

    expect(campoMonto().value).toContain('11.900')
  })

  it('no deja confirmar un monto por encima de lo que la opción admite, aunque entre en lo disponible', async () => {
    await montar([EFECTIVO, TARJETA])
    await elegir('Tarjeta de débito')

    await escribirMonto('7000')

    expect(errorDeMonto()).toBe(true)
    expect(generar().disabled).toBe(true)

    await escribirMonto('6900')
    expect(errorDeMonto()).toBe(false)
    expect(generar().disabled).toBe(false)
  })
})

describe('NotaCreditoModal — el efectivo sale de la caja', () => {
  it('sin caja física abierta la opción en efectivo no se puede elegir y dice por qué', async () => {
    await montar([EFECTIVO, TARJETA], false)

    expect(radio('Efectivo')?.hasAttribute('disabled')).toBe(true)
    expect(itemDe(radio('Efectivo'))).toContain('caja física abierta')
    expect(radio('Tarjeta de débito')?.hasAttribute('disabled')).toBe(false)
  })

  it('con caja abierta se puede elegir, y avisa que la plata sale de ahí', async () => {
    await montar([EFECTIVO, TARJETA], true)

    expect(radio('Efectivo')?.hasAttribute('disabled')).toBe(false)
    expect(itemDe(radio('Efectivo'))).toContain('sale de tu caja')
    expect(itemDe(radio('Tarjeta de débito'))).not.toContain('sale de tu caja')
  })

  it('con una sola opción en efectivo y sin caja viene elegida pero no se puede confirmar: no se espera un 422', async () => {
    await montar([EFECTIVO], false)

    expect(radio('Efectivo')?.hasAttribute('disabled')).toBe(true)
    expect(generar().disabled).toBe(true)
  })
})
