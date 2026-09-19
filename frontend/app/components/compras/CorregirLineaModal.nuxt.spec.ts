// @vitest-environment nuxt
//
// El modal de completar o corregir una línea confirmada (spec compras § 4.4).
// Lo que fija: el body que viaja es el que `CorregirLineaDto` acepta —solo lo
// que cambió, en string, y en serie las series que entran o las unidades que
// salen—, y sin cambios no se manda nada.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import type { LineaCompra } from '~/composables/useCompras'
import CorregirLineaModal from './CorregirLineaModal.vue'

const llamadas: { url: string, method?: string, body?: unknown }[] = []
let unidades: { id: string, serie: string }[] = []
let urlUnidades = ''

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown }) => {
  if (url.includes('/unidades')) {
    urlUnidades = url.split('/api').pop()!
    return Promise.resolve(unidades)
  }
  llamadas.push({ url: url.split('/api').pop()!, method: opts?.method, body: opts?.body })
  return Promise.resolve({ id: 'compra-1' })
})

function linea(o: Partial<LineaCompra> = {}): LineaCompra {
  return {
    id: 'linea-1',
    orden: 0,
    itemId: 'item-1',
    itemNombre: 'Tomate',
    modoInventario: 'cantidad',
    unidadMedidaBase: 'kg',
    // Como la devuelve la base: numeric(18,4).
    cantidad: '10.0000',
    unidadCodigo: 'kg',
    precioUnitario: '1000.0000',
    series: null,
    lote: null,
    ...o,
  }
}

async function abrir(l: LineaCompra) {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(CorregirLineaModal, {
    props: { compraId: 'compra-1', linea: l, open: true },
  })
  await new Promise(r => setTimeout(r, 50))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof abrir>>

async function precio(wrapper: Wrapper, valor: string) {
  wrapper.findComponent({ name: 'MoneyInput' }).vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 0))
}

async function tipear(qa: string, valor: string) {
  const el = document.body.querySelector(`[data-qa="${qa}"]`) as HTMLInputElement
  expect(el, qa).toBeTruthy()
  el.value = valor
  el.dispatchEvent(new Event('input'))
  await new Promise(r => setTimeout(r, 0))
}

function boton(): HTMLButtonElement {
  return document.body.querySelector('[data-qa="corregir-enviar"]') as HTMLButtonElement
}

async function enviar() {
  boton().click()
  await new Promise(r => setTimeout(r, 20))
}

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas.length = 0
  unidades = []
  urlUnidades = ''
})

describe('CorregirLineaModal', () => {
  it('completar: manda solo el precio, a la línea de la compra', async () => {
    const wrapper = await abrir(linea({ precioUnitario: null }))
    expect(document.body.textContent).toContain('Completar el precio')

    await precio(wrapper, '1500')
    await enviar()

    expect(llamadas).toEqual([
      { url: '/compras/compra-1/lineas/linea-1', method: 'PATCH', body: { precioUnitario: '1500' } },
    ])
  })

  it('corregir la cantidad: manda solo la cantidad, en string', async () => {
    await abrir(linea())
    await tipear('corregir-cantidad', '12')
    await enviar()

    expect(llamadas[0]!.body).toEqual({ cantidad: '12' })
  })

  it('abre con los valores actuales, y sin cambios no se manda nada', async () => {
    await abrir(linea())
    // Montado ya abierto: el modal tiene que llenarse igual (el padre lo monta
    // así la primera vez).
    const cantidad = document.body.querySelector('input[data-qa="corregir-cantidad"]') as HTMLInputElement
    expect(cantidad.value).toBe('10')
    expect(boton().disabled).toBe(true)
    await enviar()
    expect(llamadas).toHaveLength(0)
  })

  it('en serie, subir pide tantas series como la diferencia', async () => {
    await abrir(linea({
      modoInventario: 'serie',
      unidadCodigo: 'unidad',
      cantidad: '2',
      series: [{ serie: 'SN-1' }, { serie: 'SN-2' }],
    }))
    await tipear('corregir-cantidad', '3')
    expect(boton().disabled).toBe(true)

    await tipear('corregir-series', 'SN-3')
    await enviar()

    expect(llamadas[0]!.body).toEqual({ cantidad: '3', series: [{ serie: 'SN-3' }] })
  })

  it('en serie, bajar ofrece las unidades de esta línea que da Compras, y manda las elegidas', async () => {
    // Cuáles son (las de la línea, disponibles en su ubicación) lo decide el
    // backend: lo fija el e2e de la API. Acá, que se piden a la ruta de la
    // línea y no a `/items`, que exige un permiso que el encargado no tiene.
    unidades = [{ id: 'u1', serie: 'SN-1' }]
    await abrir(linea({
      modoInventario: 'serie',
      unidadCodigo: 'unidad',
      cantidad: '2',
      series: [{ serie: 'SN-1' }, { serie: 'SN-2' }],
    }))
    await tipear('corregir-cantidad', '1')

    expect(urlUnidades).toBe('/compras/compra-1/lineas/linea-1/unidades')
    const casillas = [...document.body.querySelectorAll('[role="checkbox"]')]
    expect(casillas).toHaveLength(1)
    expect(document.body.textContent).toContain('SN-1')

    ;(casillas[0] as HTMLElement).click()
    await new Promise(r => setTimeout(r, 20))
    await enviar()

    expect(llamadas[0]!.body).toEqual({ cantidad: '1', unidadIds: ['u1'] })
  })
})
