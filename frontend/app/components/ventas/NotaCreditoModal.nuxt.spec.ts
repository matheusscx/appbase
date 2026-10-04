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
//   6. Una nota por intento de emisión (ADR-026, owner 2026-10-03): la misma
//      clave en el reintento —aunque se cierre y reabra el modal—, el aviso de
//      qué falta hacer si ya había entrado, y el 422 de otros datos que cierra.
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

const { apiFetch, toastAdd } = vi.hoisted(() => ({ apiFetch: vi.fn(), toastAdd: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
mockNuxtImport('useApiFetch', () => apiFetch)

const DETALLES = [
  {
    itemId: 'item-1',
    descripcion: 'Pizza',
    cantidad: '1',
    totalLinea: '11900.0000',
    modoInventario: null,
    // Una línea que no sacó nada del inventario: los casos de "¿por dónde vuelve
    // la plata?" no pasan por la pregunta del stock (va en su propio describe).
    devolucionStock: 'sin_stock' as const,
    cantidadDevuelta: '0',
  },
]

const EFECTIVO: OpcionDevolucion = {
  pagoId: 'pago-efectivo',
  sinPlata: false,
  metodo: 'Efectivo',
  monto: '5000.0000',
  sinConfirmar: null,
  mueveCaja: true,
  registro: 'nota_credito_sistema',
}
const TARJETA: OpcionDevolucion = {
  pagoId: 'pago-tarjeta',
  sinPlata: false,
  metodo: 'Tarjeta de débito',
  monto: '6900.0000',
  sinConfirmar: null,
  mueveCaja: false,
  registro: 'nota_maquina',
}
const SIN_PLATA: OpcionDevolucion = {
  pagoId: null,
  sinPlata: true,
  metodo: null,
  monto: '60000.0000',
  sinConfirmar: null,
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
async function montar(
  opciones: OpcionDevolucion[],
  caja: boolean = true,
  ventaId = 'v-1',
  receptor: Record<string, unknown> = {},
) {
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
      ventaId,
      disponible: '11900.0000',
      porPorcion: [],
      detalles: DETALLES,
      configCalculo: null,
      opciones,
      cliente: null,
      receptorSugerido: null,
      rutChileno: true,
      ...receptor,
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
  toastAdd.mockReset()
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

describe('NotaCreditoModal — ¿vuelve al stock o se perdió? (owner, 2026-08-23)', () => {
  const HAMBURGUESA = {
    itemId: 'item-receta',
    descripcion: 'Hamburguesa',
    cantidad: '2',
    totalLinea: '11900.0000',
    modoInventario: null,
    devolucionStock: 'recuperable' as const,
    cantidadDevuelta: '0',
  }
  const CELULAR = { ...HAMBURGUESA, itemId: 'item-serie', descripcion: 'Celular', devolucionStock: 'solo_perdida' as const }
  const fila = (itemId: string) =>
    dialogo().querySelector<HTMLElement>(`[data-testid="devolucion-fila-${itemId}"]`)!
  const radioDe = (itemId: string, texto: string) =>
    [...fila(itemId).querySelectorAll<HTMLElement>('[role="radio"]')]
      .find(r => r.getAttribute('aria-label')?.includes(texto))
  async function cantidad(itemId: string, valor: string) {
    const input = fila(itemId).querySelector<HTMLInputElement>('input')!
    input.value = valor
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await esperar()
  }

  it('sin respuesta no se puede confirmar, y avisa; contestada, manda la respuesta', async () => {
    await montar([TARJETA], true, 'v-1', { detalles: [HAMBURGUESA] })
    await cantidad('item-receta', '1')

    // Ninguna nace elegida: los dos destinos son comunes.
    expect(radioDe('item-receta', 'Vuelve al stock')?.getAttribute('aria-checked')).toBe('false')
    expect(radioDe('item-receta', 'Se perdió')?.getAttribute('aria-checked')).toBe('false')
    expect(generar().disabled).toBe(true)
    expect(dialogo().textContent).toContain('si vuelve al stock o se perdió')

    radioDe('item-receta', 'Se perdió')!.click()
    await esperar()
    expect(dialogo().textContent).toContain('Sale como merma «Devolución»')
    expect(generar().disabled).toBe(false)

    generar().click()
    await esperar()
    const llamada = apiFetch.mock.calls.find(([url]) => String(url).endsWith('/notas-credito'))
    expect((llamada![1].body as Record<string, unknown>).devoluciones).toEqual([
      { itemId: 'item-receta', cantidad: '1', stock: 'pierde' },
    ])
  })

  it('serie o lote: "Vuelve al stock" no se puede elegir, "Se perdió" sí', async () => {
    await montar([TARJETA], true, 'v-1', { detalles: [CELULAR] })
    expect(radioDe('item-serie', 'Vuelve al stock')?.hasAttribute('data-disabled')
      || radioDe('item-serie', 'Vuelve al stock')?.hasAttribute('disabled')).toBe(true)
    expect(fila('item-serie').textContent).toContain('se registra desde Inventario')
  })

  it('una línea sin stock no pregunta nada', async () => {
    await montar([TARJETA])
    expect(fila('item-1').querySelectorAll('[role="radio"]')).toHaveLength(0)
    expect(fila('item-1').textContent).toContain('No sacó nada del inventario')
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

// Decisión del owner (2026-10-04): un reembolso por Transbank sin confirmar pudo
// haber devuelto la plata; el backend ya lo descontó del tope de la opción, y la
// pantalla dice por qué ofrece menos.
describe('NotaCreditoModal — un reembolso por Transbank sin confirmar', () => {
  it('la opción ofrece lo que queda y explica lo descontado', async () => {
    await montar([{ ...TARJETA, monto: '83000.0000', sinConfirmar: '17000.0000' }])

    const item = itemDe(radio('Tarjeta de débito'))
    expect(item).toContain('$83.000')
    expect(item).toContain('$17.000 en un reembolso por Transbank sin confirmar')
  })

  it('sin ninguno no dice nada', async () => {
    await montar([TARJETA])

    expect(itemDe(radio('Tarjeta de débito'))).not.toContain('sin confirmar')
  })
})

describe('NotaCreditoModal — una nota por intento de emisión (ADR-026)', () => {
  const NOTA = {
    id: 'nc-1',
    totalFinal: '3000.0000',
    movimientoCajaId: 'mov-1',
    fecha: '2026-10-03',
    comentario: null,
    devoluciones: [],
  }
  const RESUMEN = {
    ciego: false,
    saldoInicial: '100000.0000',
    totalEntradas: '0.0000',
    totalSalidas: '3000.0000',
    saldoEsperado: '97000.0000',
    totalMovimientos: 1,
  }
  const posts = () => apiFetch.mock.calls.filter(([url]) => String(url).endsWith('/notas-credito'))
  const claveDe = (i: number) =>
    (posts()[i]![1] as { headers: Record<string, string> }).headers['Idempotency-Key']
  const titulos = () => toastAdd.mock.calls.map(([t]) => String((t as { title: string }).title))

  /** La caja abierta, y el POST de la nota contesta lo que diga `nota`. */
  function backend(nota: (n: number) => Promise<unknown>) {
    let n = 0
    apiFetch.mockImplementation((url: string) => {
      if (url.endsWith('/caja/activa')) return Promise.resolve({ id: 'caja-1', estado: 'abierta' })
      if (url.endsWith('/notas-credito')) return nota(n++)
      // El resumen del turno según el servidor: la salida ya contada una vez.
      if (url.endsWith('/movimientos/resumen')) return Promise.resolve({ ...RESUMEN })
      return Promise.resolve({})
    })
  }

  it('el reintento después de un error manda la misma clave, aunque se cierre y reabra el modal', async () => {
    const wrapper = await montar([EFECTIVO], true, 'v-reintento')
    backend(n => (n === 0 ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve(NOTA)))

    generar().click()
    await esperar()
    expect(wrapper.emitted('success')).toBeUndefined()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await esperar()
    generar().click()
    await esperar()

    expect(posts()).toHaveLength(2)
    expect(claveDe(0)).toMatch(/^[0-9a-f-]{36}$/)
    expect(claveDe(1)).toBe(claveDe(0))
  })

  it('después de una nota que salió, la siguiente es otro intento', async () => {
    const wrapper = await montar([EFECTIVO], true, 'v-serie')
    backend(() => Promise.resolve(NOTA))

    generar().click()
    await esperar()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await esperar()
    generar().click()
    await esperar()

    expect(posts()).toHaveLength(2)
    expect(claveDe(1)).not.toBe(claveDe(0))
  })

  it('reproducida en efectivo: se ve el éxito y el aviso de entregar los billetes, y la caja no suma la salida dos veces', async () => {
    const wrapper = await montar([EFECTIVO], true, 'v-repetida')
    const caja = useCajaStore()
    // Se recargó después del corte: ya trae la salida de la nota que entró.
    caja.resumenTurno = { ...RESUMEN }
    backend(() => Promise.resolve({ ...NOTA, repetida: true }))

    generar().click()
    await esperar()

    expect(wrapper.emitted('success')).toHaveLength(1)
    expect(titulos().some(t => t.includes('ya estaba emitida') && t.includes('entregale los billetes'))).toBe(true)
    // No se suma localmente: el resumen se pide al servidor.
    expect(caja.resumenTurno?.totalSalidas).toBe('3000.0000')
    expect(apiFetch.mock.calls.some(([url]) => String(url).endsWith('/caja/caja-1/movimientos/resumen'))).toBe(true)
  })

  it('el 422 de otros datos: avisa, se cierra y pide recargar el detalle; reabrir es otro intento', async () => {
    const wrapper = await montar([EFECTIVO], true, 'v-otros')
    const otrosDatos = Object.assign(new Error('422'), {
      status: 422,
      data: {
        statusCode: 422,
        message: 'Esta nota de crédito ya se había emitido con otros datos. Revisá la venta antes de emitir otra.',
        ventaId: 'nc-1',
      },
    })
    backend(n => (n === 0 ? Promise.reject(otrosDatos) : Promise.resolve(NOTA)))

    generar().click()
    await esperar()

    expect(wrapper.emitted('otrosDatos')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    expect(titulos().some(t => t.includes('ya se había emitido con otros datos'))).toBe(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await esperar()
    generar().click()
    await esperar()
    expect(claveDe(1)).not.toBe(claveDe(0))
  })

  it('un 422 sin id (el tope de efectivo) no es otros datos: el modal queda abierto y la clave sigue', async () => {
    const wrapper = await montar([EFECTIVO], true, 'v-tope')
    const tope = Object.assign(new Error('422'), {
      status: 422,
      data: { statusCode: 422, message: 'No se puede devolver en efectivo más de lo que esta venta cobró en efectivo.' },
    })
    backend(n => (n === 0 ? Promise.reject(tope) : Promise.resolve(NOTA)))

    generar().click()
    await esperar()
    expect(wrapper.emitted('otrosDatos')).toBeUndefined()
    generar().click()
    await esperar()

    expect(claveDe(1)).toBe(claveDe(0))
  })
})

describe('NotaCreditoModal — el receptor', () => {
  const campo = (qa: string): HTMLInputElement => {
    const el = dialogo().querySelector(`[data-qa="${qa}"]`)
    expect(el, qa).toBeTruthy()
    return (el!.tagName === 'INPUT' ? el : el!.querySelector('input')) as HTMLInputElement
  }
  async function tipear(qa: string, valor: string) {
    const input = campo(qa)
    input.value = valor
    input.dispatchEvent(new Event('input'))
    await esperar()
  }
  const bloque = () => dialogo().querySelector('[data-qa="receptor-nota"]')?.textContent ?? ''
  async function bodyAlConfirmar(): Promise<Record<string, unknown>> {
    generar().click()
    await esperar()
    const llamada = apiFetch.mock.calls.find(([url]) => String(url).endsWith('/notas-credito'))
    expect(llamada, 'el POST de la nota').toBeTruthy()
    return llamada![1].body as Record<string, unknown>
  }

  it('con cliente en la venta, la nota va a su nombre: no se piden datos ni se mandan', async () => {
    await montar([TARJETA], true, 'v-1', {
      cliente: { nombre: 'Comercial Andes SpA', rut: '76123456-0' },
    })

    expect(bloque()).toContain('La nota va a nombre del cliente de la venta')
    expect(bloque()).toContain('Comercial Andes SpA')
    expect(bloque()).toContain('76123456-0')
    expect(dialogo().querySelector('[data-qa="receptor-rut"]')).toBeNull()
    expect(await bodyAlConfirmar()).not.toHaveProperty('receptor')
  })

  it('sin cliente y sin datos, avisa que va a nombre del local y no manda receptor', async () => {
    await montar([TARJETA])

    expect(bloque()).toContain('Datos del cliente (opcional)')
    expect(bloque()).toContain('la nota va a nombre del local')
    expect(generar().disabled).toBe(false)
    expect(await bodyAlConfirmar()).not.toHaveProperty('receptor')
  })

  it('en una devolución interna no pide datos ni los manda: no es documento tributario', async () => {
    await montar([{ ...TARJETA, registro: 'devolucion_interna' }], true, 'v-1', {
      receptorSugerido: { nombre: 'Juan Pérez', rut: '12345678-9' },
    })

    expect(dialogo().querySelector('[data-qa="receptor-rut"]')).toBeNull()
    expect(bloque()).not.toContain('a nombre del local')
    // Ni siquiera un sugerido con DV malo frena: no se mira.
    expect(generar().disabled).toBe(false)
    expect(await bodyAlConfirmar()).not.toHaveProperty('receptor')
  })

  it('precarga el receptor de la nota anterior, editable, y manda lo que quedó', async () => {
    await montar([TARJETA], true, 'v-1', {
      receptorSugerido: { nombre: 'Juan Pérez', rut: '12345678-5' },
    })

    expect(campo('receptor-nombre').value).toBe('Juan Pérez')
    expect(campo('receptor-rut').value).toBe('12345678-5')
    await tipear('receptor-nombre', '  Ana Soto ')
    await tipear('receptor-rut', '11.111.111-1')

    expect((await bodyAlConfirmar()).receptor).toEqual({ nombre: 'Ana Soto', rut: '11.111.111-1' })
  })

  it('borrar el precargado vuelve a "a nombre del local" (devuelve otra persona que no da datos)', async () => {
    await montar([TARJETA], true, 'v-1', {
      receptorSugerido: { nombre: 'Juan Pérez', rut: '12345678-5' },
    })
    await tipear('receptor-nombre', '')
    await tipear('receptor-rut', '')

    expect(bloque()).toContain('la nota va a nombre del local')
    expect(await bodyAlConfirmar()).not.toHaveProperty('receptor')
  })

  it.each([
    ['solo el nombre', 'Juan Pérez', '', 'Falta el RUT del cliente'],
    ['solo el RUT', '', '12.345.678-5', 'Falta el nombre del cliente'],
    ['un RUT con DV malo', 'Juan Pérez', '12.345.678-9', 'El RUT del cliente no es válido'],
  ])('%s: lo dice y no deja confirmar', async (_caso, nombre, rut, mensaje) => {
    await montar([TARJETA])
    await tipear('receptor-nombre', nombre)
    await tipear('receptor-rut', rut)

    expect(bloque()).toContain(mensaje)
    expect(generar().disabled).toBe(true)
  })

  it('sin RUT chileno (otro país, en pausa) el DV no se mira', async () => {
    await montar([TARJETA], true, 'v-1', { rutChileno: false })
    await tipear('receptor-nombre', 'Juan Pérez')
    await tipear('receptor-rut', '20-12345678-3')

    expect(generar().disabled).toBe(false)
  })
})
