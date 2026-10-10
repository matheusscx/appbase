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
//   - un ítem sin `frecuencia` no se puede confirmar;
//   - al confirmar se espera el cálculo vigente (igual que la tienda y el POS): si falla,
//     un solo toast con el motivo y no se crea la suscripción; si el fallo fue transitorio,
//     confirmar reintenta el cálculo y sigue (antes un 400 dejaba "Total a cobrar: —" mudo
//     y se podía pagar sin total);
//   - un segundo `submit` con el alta en vuelo no manda otro POST;
//   - el alta lleva una `Idempotency-Key` por intento (ADR-029): la misma después de un
//     error, otra después del éxito o del 422 de "otros datos"; el alta reproducida avisa
//     "ya estaba activa", y el 422 cierra el drawer y recarga la lista.
//
// Abrirlo exige `puedeCrear`, gateado por `usePermissionsStore`. El molde de ESE
// mock es `terceros.nuxt.spec.ts`: Nuxt instala su propia instancia de Pinia, así
// que hay que mockear el auto-import.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Suscripciones from './suscripciones.vue'
import { AVISO_ALTA_REPETIDA } from '~/composables/useSuscripciones'

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
/** Si no es `null`, `POST /calculo-precios/calcular` rechaza con este error... */
let falloCalculo: unknown = null
/** ...las próximas N veces; después contesta bien (un fallo transitorio). */
let fallosRestantes = 0
/** Cada `POST /suscripciones` (el alta que cobra). */
let altas: unknown[] = []
/** Si está puesto, el próximo `/calcular` queda colgado hasta que se llame. */
let soltarCalculo: (() => void) | null = null
let retenerCalculo = false
/** Si está puesto, el próximo `POST /suscripciones` contesta esto en vez del 200. */
let proximaAlta: (() => Promise<unknown>) | null = null
/** Cada `GET /suscripciones` (la lista). */
let cargasLista = 0
/** Si está puesto, el próximo `POST /suscripciones` queda colgado hasta que se llame. */
let soltarAlta: (() => void) | null = null
let retenerAlta = false
/** Tarjetas que devuelve `GET /online/medios-pago`. */
let medios: unknown[] = []

interface ToastSpec { title?: string, description?: string, color?: string }
let toasts: ToastSpec[] = []
mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: ToastSpec) => {
      toasts.push(t)
    },
  })
})

/** El 400 del motor tal como lo arma `$fetch`: `status` + cuerpo con `message`.
 *  El mock de `useApiFetch` contesta 200 salvo que se lo haga rechazar a mano. */
function error400(message: string) {
  return Object.assign(new Error('[POST] calcular: 400'), { status: 400, data: { message } })
}
const TARJETA = {
  inscripcionId: 'insc-1', estado: 'activa', preferida: true, creadoEl: '2026-01-01',
  suscripcionesActivas: 0,
  mediosPago: [{ tipo: 'credito', marca: 'Visa', ultimos4: '4242', estado: 'activa' }],
}

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { body?: { lineas: { itemId: string }[] } }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const ruta = url.split('?')[0] ?? ''

    if (ruta.endsWith('/suscripciones')) {
      if ((opts as { method?: string } | undefined)?.method === 'POST') {
        altas.push(opts)
        if (proximaAlta) {
          const r = proximaAlta
          proximaAlta = null
          return r()
        }
        const respuesta = { id: 'susc-nueva', advertencias: [] }
        if (retenerAlta) {
          retenerAlta = false
          return new Promise((resolve) => {
            soltarAlta = () => resolve(respuesta)
          })
        }
        return Promise.resolve(respuesta)
      }
      cargasLista++
      return Promise.resolve([])
    }
    if (ruta.endsWith('/online/medios-pago')) {
      return Promise.resolve({ oneclickDisponible: true, medios })
    }
    if (ruta.endsWith('/calculo-precios/calcular')) {
      calculos.push(opts!.body!)
      if (falloCalculo && fallosRestantes > 0) {
        fallosRestantes--
        return Promise.reject(falloCalculo)
      }
      const respuesta = {
        lineas: [],
        totales: {
          subtotalNeto: '10000', totalDescuentos: '0', totalRecargos: '0',
          totalImpuestos: '1900', totalFinal: '11900',
        },
        trazasVenta: { descuentos: [], recargos: [] },
        advertencias: [],
        advertenciasVenta: [],
      }
      if (retenerCalculo) {
        retenerCalculo = false
        return new Promise((resolve) => {
          soltarCalculo = () => resolve(respuesta)
        })
      }
      return Promise.resolve(respuesta)
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
  falloCalculo = null
  fallosRestantes = 0
  altas = []
  medios = []
  toasts = []
  soltarCalculo = null
  retenerCalculo = false
  soltarAlta = null
  retenerAlta = false
  proximaAlta = null
  cargasLista = 0
})

/**
 * `AppDrawer` stubeado, como en `ventas/VentaDetalleDrawer.nuxt.spec.ts`: su root es
 * `UDrawer` (reka-ui) y bajo happy-dom la transición de `usePresence` tira unhandled
 * rejections al CERRARSE (lo que hace el alta exitosa) que sacan a `vitest run` con exit 1.
 */
async function montar() {
  const wrapper = await mountSuspended(Suscripciones, {
    attachTo: document.body,
    global: {
      stubs: {
        AppDrawer: {
          name: 'AppDrawer',
          props: ['open'],
          template: `
            <div v-if="open" role="dialog">
              <slot name="header" />
              <slot name="body" />
              <slot name="actions" />
            </div>
          `,
        },
      },
    },
  })
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

describe('tienda/suscripciones — confirmar espera el cálculo vigente', () => {
  const botonConfirmar = () => [...document.body.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === 'Suscribirme y pagar') as HTMLButtonElement | undefined

  async function confirmar() {
    expect(botonConfirmar(), 'botón confirmar').toBeTruthy()
    botonConfirmar()!.click()
    await new Promise(r => setTimeout(r, 400))
  }

  it('con el cálculo en 400: un solo toast con el motivo y no se crea la suscripción', async () => {
    medios = [TARJETA]
    falloCalculo = error400('La cantidad supera el máximo permitido')
    fallosRestantes = Infinity
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegir(wrapper, SEMANAL.id)
    expect(toasts, 'el preview solo muestra "—", el aviso sale al confirmar').toEqual([])

    await confirmar()

    expect(toasts).toEqual([{
      title: 'No se pudo calcular el total',
      description: 'La cantidad supera el máximo permitido',
      color: 'error',
    }])
    expect(altas).toHaveLength(0)
  })

  it('tras un fallo transitorio, confirmar reintenta el cálculo y suscribe', async () => {
    medios = [TARJETA]
    falloCalculo = Object.assign(new Error('network'), { status: 503 })
    fallosRestantes = 1
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegir(wrapper, SEMANAL.id)
    const intentosAntes = calculos.length
    expect(intentosAntes, 'el primer cálculo falló').toBe(1)
    expect(textoDrawer()).not.toContain('Neto')

    await confirmar()

    expect(calculos.length, 'confirmar volvió a calcular').toBe(intentosAntes + 1)
    expect(altas).toHaveLength(1)
    expect(toasts.some(t => t.color === 'error')).toBe(false)
    expect(toasts.some(t => t.title === 'Suscripción activada y primer cobro realizado')).toBe(true)
  })

  it('mientras confirmar espera el cálculo, el selector de ítem no se puede cambiar', async () => {
    medios = [TARJETA]
    falloCalculo = Object.assign(new Error('network'), { status: 503 })
    fallosRestantes = 1
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegir(wrapper, SEMANAL.id)
    const selector = () => wrapper.findComponent({ name: 'AppItemSelect' })
    expect(selector().props('disabled'), 'antes de confirmar se puede elegir').toBe(false)

    retenerCalculo = true
    botonConfirmar()!.click()
    await new Promise(r => setTimeout(r, 50))
    expect(soltarCalculo, 'confirmar quedó esperando el recálculo').toBeTruthy()
    expect(selector().props('disabled')).toBe(true)

    soltarCalculo!()
    await new Promise(r => setTimeout(r, 400))
    expect(altas).toHaveLength(1)
  })

  it('con total calculado: el flujo normal suscribe sin recalcular', async () => {
    medios = [TARJETA]
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegir(wrapper, SEMANAL.id)
    const intentosAntes = calculos.length

    await confirmar()

    expect(calculos.length).toBe(intentosAntes)
    expect(altas).toHaveLength(1)
    expect(toasts.some(t => t.color === 'error')).toBe(false)
  })

  it('un segundo submit con el alta en vuelo no da de alta otra vez', async () => {
    medios = [TARJETA]
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegir(wrapper, SEMANAL.id)
    // El form no tiene inputs propios, así que el segundo envío se dispara sobre el form:
    // es lo que llega a `confirmar()` venga de donde venga (Enter, `requestSubmit`, otro botón).
    const form = document.getElementById('suscripcion-form') as HTMLFormElement | null
    expect(form, 'form del drawer').toBeTruthy()
    const enviar = () => form!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))

    retenerAlta = true
    enviar()
    await new Promise(r => setTimeout(r, 50))
    expect(soltarAlta, 'el primer alta quedó esperando la respuesta').toBeTruthy()
    expect(altas).toHaveLength(1)

    enviar()
    await new Promise(r => setTimeout(r, 50))
    expect(altas, 'el segundo submit no llegó a un segundo POST').toHaveLength(1)

    soltarAlta!()
    await new Promise(r => setTimeout(r, 50))
    expect(toasts.filter(t => t.title === 'Suscripción activada y primer cobro realizado')).toHaveLength(1)
  })
})

describe('tienda/suscripciones — una Idempotency-Key por intento de alta (ADR-029)', () => {
  const botonConfirmar = () => [...document.body.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === 'Suscribirme y pagar') as HTMLButtonElement | undefined
  const claveDe = (alta: unknown) =>
    (alta as { headers?: Record<string, string> }).headers?.['Idempotency-Key']

  async function confirmar() {
    expect(botonConfirmar(), 'botón confirmar').toBeTruthy()
    botonConfirmar()!.click()
    await new Promise(r => setTimeout(r, 400))
  }

  async function drawerListo() {
    medios = [TARJETA]
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegir(wrapper, SEMANAL.id)
    return wrapper
  }

  it('después de un error la clave sigue: el Confirmar siguiente es el mismo intento', async () => {
    const wrapper = await drawerListo()
    proximaAlta = () => Promise.reject(Object.assign(new Error('502'), {
      status: 502, data: { message: 'Transbank no confirmó el cobro' },
    }))

    await confirmar()
    await confirmar()

    expect(altas).toHaveLength(2)
    expect(claveDe(altas[0])).toMatch(/^[0-9a-f-]{36}$/)
    expect(claveDe(altas[1])).toBe(claveDe(altas[0]))

    // El éxito cierra el intento: el alta siguiente es otra.
    await abrirDrawer(wrapper)
    await elegir(wrapper, SEMANAL.id)
    await confirmar()
    expect(altas).toHaveLength(3)
    expect(claveDe(altas[2])).not.toBe(claveDe(altas[1]))
  })

  it('el alta reproducida avisa que ya estaba activa, no que se cobró de nuevo', async () => {
    await drawerListo()
    proximaAlta = () => Promise.resolve({ id: 'susc-nueva', advertencias: [], repetida: true })

    await confirmar()

    expect(toasts).toEqual([{ title: AVISO_ALTA_REPETIDA, color: 'warning' }])
  })

  it('el 422 de "otros datos" cierra el drawer, recarga la lista y cierra el intento', async () => {
    const wrapper = await drawerListo()
    const cargasAntes = cargasLista
    proximaAlta = () => Promise.reject(Object.assign(new Error('422'), {
      status: 422, data: { message: 'Esta suscripción ya se había pedido con otros datos.' },
    }))

    await confirmar()

    expect(toasts).toEqual([{
      title: 'Esta suscripción ya se había pedido con otros datos.', color: 'error',
    }])
    expect(textoDrawer()).not.toContain('Suscribirme y pagar')
    expect(cargasLista).toBe(cargasAntes + 1)

    await abrirDrawer(wrapper)
    await elegir(wrapper, SEMANAL.id)
    await confirmar()
    expect(claveDe(altas[1])).not.toBe(claveDe(altas[0]))
  })
})
