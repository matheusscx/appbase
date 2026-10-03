// @vitest-environment nuxt
//
// Spec de `pages/tienda/suscripciones.vue`: el selector de ítem suscribible del
// drawer "Nueva suscripción". Hasta la fase B del catálogo paginado la pantalla
// cargaba `tipo=suscripcion&activo=true&pageSize=100` al abrir el drawer y el
// ítem 101 no se podía elegir. Ahora el selector es un `AppItemSelect` que busca
// en el servidor, y lo que sostiene este spec es:
//   - abrir el drawer no pide ningún catálogo (ya no hay carga perezosa de 100);
//   - la búsqueda lleva `tipo=suscripcion`, `activo=true` (solo lo vendible) y el
//     término tipeado, con `pageSize=20`;
//   - un ítem que llegó por búsqueda alcanza para los días y para el preview de
//     precio (`itemSeleccionado` lee el caché `porId`);
//   - un ítem sin `frecuencia` no se puede confirmar.
//
// Abrirlo exige `puedeCrear`, gateado por `usePermissionsStore`. El molde de ESE
// mock es `terceros.nuxt.spec.ts`: Nuxt instala su propia instancia de Pinia, así
// que hay que mockear el auto-import.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Suscripciones from './suscripciones.vue'

let esAdmin = true

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: () => false,
  })
})

const SEMANAL = {
  id: 'item-semanal', nombre: 'Café semanal', precioBase: '10000.0000',
  monedaId: 'moneda-1', frecuencia: 'semanal', activo: true,
}
const QUINCENAL = {
  id: 'item-quincenal', nombre: 'Pan quincenal', precioBase: '20000.0000',
  monedaId: 'moneda-1', frecuencia: 'quincenal', activo: true,
}
const SIN_FRECUENCIA = {
  id: 'item-roto', nombre: 'Sin frecuencia', precioBase: '5000.0000',
  monedaId: 'moneda-1', frecuencia: null, activo: true,
}

/** Las URLs COMPLETAS de cada `GET /items`, con query string: cortar en el `?`
 *  haría invisibles los filtros que este spec existe para sostener. */
let urlsCatalogo: string[] = []
/** Cada body que se mandó a `POST /calculo-precios/calcular` (el preview). */
let calculos: { lineas: { itemId: string }[] }[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { body?: { lineas: { itemId: string }[] } }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const ruta = url.split('?')[0] ?? ''

    if (ruta.endsWith('/suscripciones')) return Promise.resolve([])
    if (ruta.endsWith('/online/medios-pago')) {
      return Promise.resolve({ oneclickDisponible: true, medios: [] })
    }
    if (ruta.endsWith('/calculo-precios/calcular')) {
      calculos.push(opts!.body!)
      return Promise.resolve({
        lineas: [],
        totales: {
          subtotalNeto: '10000', totalDescuentos: '0', totalRecargos: '0',
          totalImpuestos: '1900', totalFinal: '11900',
        },
        trazasVenta: { descuentos: [], recargos: [] },
        advertencias: [],
        advertenciasVenta: [],
      })
    }
    if (ruta.includes('/items')) {
      urlsCatalogo.push(url)
      return Promise.resolve({ data: [SEMANAL, QUINCENAL, SIN_FRECUENCIA], meta: {} })
    }
    // El resto (arranque de permisos, etc.) no interviene en este flujo.
    return Promise.resolve([])
  }
})

let montado: { unmount: () => void } | null = null

afterEach(() => {
  montado?.unmount()
  montado = null
  document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
})

beforeEach(() => {
  esAdmin = true
  urlsCatalogo = []
  calculos = []
})

async function montar() {
  const wrapper = await mountSuspended(Suscripciones)
  montado = wrapper
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

async function abrirDrawer(wrapper: Awaited<ReturnType<typeof montar>>) {
  const boton = wrapper.findAll('button')
    .find(b => b.text().trim() === 'Nueva suscripción')
  expect(boton, 'botón "Nueva suscripción"').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

/** El `USelectMenu` interno del `AppItemSelect` (no el de tarjeta ni el de días). */
function menuItems(wrapper: Awaited<ReturnType<typeof montar>>) {
  const sel = wrapper.findComponent({ name: 'AppItemSelect' })
  expect(sel.exists(), 'AppItemSelect').toBe(true)
  return sel.findComponent({ name: 'USelectMenu' })
}

async function elegir(wrapper: Awaited<ReturnType<typeof montar>>, id: string) {
  const menu = menuItems(wrapper)
  menu.vm.$emit('update:open', true)
  await new Promise(r => setTimeout(r, 20))
  menu.vm.$emit('update:modelValue', id)
  await new Promise(r => setTimeout(r, 400))
}

const textoDrawer = () => document.body.textContent ?? ''

describe('tienda/suscripciones — el selector de ítem suscribible busca en el servidor', () => {
  it('abrir "Nueva suscripción" no pide el catálogo; abrir el selector busca solo lo vendible, de a 20', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    // Ya no hay carga perezosa de 100 al abrir el drawer.
    expect(urlsCatalogo).toHaveLength(0)

    menuItems(wrapper).vm.$emit('update:open', true)
    await new Promise(r => setTimeout(r, 20))

    expect(urlsCatalogo).toHaveLength(1)
    const params = new URL(urlsCatalogo[0]!, 'http://x').searchParams
    expect(params.get('tipo')).toBe('suscripcion')
    expect(params.get('activo')).toBe('true')
    expect(params.get('pageSize')).toBe('20')
    expect(params.has('search')).toBe(false)
  })

  it('el rótulo de cada opción lleva el nombre y " / " + la frecuencia; sin frecuencia, solo nombre y monto', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    const menu = menuItems(wrapper)
    menu.vm.$emit('update:open', true)
    await new Promise(r => setTimeout(r, 20))

    // No se afirma el monto: `formatMonto` da '—' con monedas no sembradas en el test.
    const labels = (menu.props('items') as { label: string }[]).map(o => o.label)
    expect(labels.find(l => l.startsWith(SEMANAL.nombre))).toContain(' / Semanal')
    expect(labels.find(l => l.startsWith(QUINCENAL.nombre))).toContain(' / Quincenal')
    expect(labels.find(l => l.startsWith(SIN_FRECUENCIA.nombre))).not.toContain(' / ')
  })

  it('tipear manda `search` con el término, tras la espera', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    const menu = menuItems(wrapper)
    menu.vm.$emit('update:open', true)
    await new Promise(r => setTimeout(r, 20))
    urlsCatalogo = []

    menu.vm.$emit('update:searchTerm', 'caf')
    await new Promise(r => setTimeout(r, 400))

    expect(urlsCatalogo).toHaveLength(1)
    const params = new URL(urlsCatalogo[0]!, 'http://x').searchParams
    expect(params.get('search')).toBe('caf')
    expect(params.get('tipo')).toBe('suscripcion')
    expect(params.get('activo')).toBe('true')
  })

  it('un ítem que llegó por búsqueda alcanza para los días y el preview de precio', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegir(wrapper, SEMANAL.id)

    expect(textoDrawer()).toContain('Día de la semana')
    expect(textoDrawer()).not.toContain('Día del mes')
    expect(calculos.at(-1)?.lineas).toEqual([{ itemId: SEMANAL.id, cantidad: '1' }])
    // El desglose (Neto / Impuestos) solo se dibuja con un resultado del motor
    // VIGENTE para este ítem: prueba que el preview funciona con el ítem del caché.
    expect(textoDrawer()).toContain('Neto')
    expect(textoDrawer()).toContain('Impuestos')
  })

  it('un quincenal ofrece "Día del mes" de 1 a 13', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegir(wrapper, QUINCENAL.id)

    expect(textoDrawer()).toContain('Día del mes')
    const dias = wrapper.findAllComponents({ name: 'USelectMenu' })
      .map(c => (c.props('items') ?? []) as { value: unknown }[])
      .find(items => items.length > 0 && typeof items[0]?.value === 'number' && items.length <= 28
        && items.every(i => typeof i.value === 'number') && items[0]!.value === 1)
    expect(dias, 'selector de día del mes').toBeTruthy()
    expect(dias!.length).toBe(13)
  })

  it('un ítem sin `frecuencia` no se puede confirmar: sin días, sin preview, botón deshabilitado', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegir(wrapper, SIN_FRECUENCIA.id)

    expect(textoDrawer()).not.toContain('Día del mes')
    expect(textoDrawer()).not.toContain('Día de la semana')
    expect(calculos).toHaveLength(0)
    const confirmar = [...document.body.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Suscribirme y pagar') as HTMLButtonElement | undefined
    expect(confirmar, 'botón confirmar').toBeTruthy()
    expect(confirmar!.disabled).toBe(true)
  })
})
