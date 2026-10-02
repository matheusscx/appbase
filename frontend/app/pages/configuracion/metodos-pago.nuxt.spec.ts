// @vitest-environment nuxt
//
// Los dos selectores de la regla de emisión (spec `2026-10-01-emision-por-venta`,
// § 3.1). Los bugs que fija son de RUNTIME —ni el build ni el typecheck ven que
// el selector mande el campo equivocado o que el rollback no corra—:
//   1. El selector del COMERCIO lee `GET /tenants/me` y escribe `PATCH
//      /tenants/me` con `{ facturador }` y nada más (el PATCH es parcial, pero
//      mandar el resto del tenant sería pisar lo que no se tocó).
//   2. El selector de CADA FILA escribe `PATCH /metodos-pago/:id` con
//      `{ emisor }` y nada más: ni `habilitada` ni `permiteVuelto`.
//   3. Con "Nadie" la fila avisa en una línea que la venta queda sin documento;
//      con "otro facturador" la pantalla avisa que se registra como hecha por
//      fuera. Ninguno de los dos avisos va con el valor por defecto.
//   4. Un error del backend revierte el valor y sale en un toast rojo: el
//      patrón optimista de los switches de la página.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import MetodosPago from './metodos-pago.vue'

const TARJETA = 'metodo-tarjeta'
const EFECTIVO = 'metodo-efectivo'

interface MetodoFake {
  metodoPagoId: string
  nombre: string
  abreviatura: string | null
  habilitada: boolean
  permiteVuelto: boolean
  emisor: 'sistema' | 'maquina' | 'nadie'
  esEfectivo: boolean
}

function metodo(over: Partial<MetodoFake> = {}): MetodoFake {
  return {
    metodoPagoId: TARJETA,
    nombre: 'Tarjeta de crédito',
    abreviatura: null,
    habilitada: true,
    permiteVuelto: false,
    emisor: 'sistema',
    esEfectivo: false,
    ...over,
  }
}

interface ToastCapturado { title?: string, color?: string }
let toasts: ToastCapturado[] = []

mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: ToastCapturado) => {
      toasts.push(t)
    },
  })
})

interface Llamada { url: string, method: string, body: unknown }
let llamadas: Llamada[] = []
let metodosBackend: MetodoFake[] = []
let facturadorBackend: 'sistema' | 'externo' = 'sistema'
let fallaElPatch = false
let fallaTenantsMe = false

function errorApi(message: string) {
  const e = new Error(message) as Error & { data?: unknown }
  e.data = { message }
  return e
}

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (method === 'PATCH') {
      return fallaElPatch
        ? Promise.reject(errorApi('El backend rechazó el cambio'))
        : Promise.resolve({})
    }
    if (url.endsWith('/tenants/me')) {
      if (fallaTenantsMe) return Promise.reject(errorApi('tenant no disponible'))
      return Promise.resolve({ facturador: facturadorBackend })
    }
    if (url.endsWith('/metodos-pago')) {
      return Promise.resolve(metodosBackend.map(m => ({ ...m })))
    }
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(MetodosPago)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

type Montado = Awaited<ReturnType<typeof montar>>

/** El primer `USelect` es el del comercio (arriba de la tabla); el resto, uno por fila. */
function selects(wrapper: Montado) {
  return wrapper.findAllComponents({ name: 'USelect' })
}

async function elegir(select: ReturnType<typeof selects>[number], valor: string) {
  select.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 0))
}

const patches = () => llamadas.filter(l => l.method === 'PATCH')

describe('metodos-pago — quién hace las facturas (comercio)', () => {
  beforeEach(() => {
    toasts = []
    llamadas = []
    metodosBackend = [metodo()]
    facturadorBackend = 'sistema'
    fallaElPatch = false
    fallaTenantsMe = false
  })

  it('arriba de la tabla, con el valor que dice GET /tenants/me', async () => {
    facturadorBackend = 'externo'
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Facturas y lo que queda debiendo: las hace')
    expect(selects(wrapper)[0]!.props('modelValue')).toBe('externo')
  })

  it('cambiarlo manda PATCH /tenants/me con { facturador } y nada más', async () => {
    const wrapper = await montar()

    await elegir(selects(wrapper)[0]!, 'externo')

    expect(patches()).toHaveLength(1)
    expect(patches()[0]!.url).toMatch(/\/tenants\/me$/)
    expect(patches()[0]!.body).toEqual({ facturador: 'externo' })
    expect(toasts.at(-1)?.color).toBe('success')
  })

  it('con "otro facturador" avisa que queda como hecho por fuera; con "sistema" no', async () => {
    const wrapper = await montar()
    const aviso = 'El sistema las registra como hechas por fuera, y su número se anota después.'
    expect(wrapper.text()).not.toContain(aviso)

    await elegir(selects(wrapper)[0]!, 'externo')

    expect(wrapper.text()).toContain(aviso)
  })

  it('si el backend rechaza, vuelve al valor anterior y avisa en rojo', async () => {
    const wrapper = await montar()
    fallaElPatch = true

    await elegir(selects(wrapper)[0]!, 'externo')

    expect(selects(wrapper)[0]!.props('modelValue')).toBe('sistema')
    expect(toasts.at(-1)).toEqual({ title: 'El backend rechazó el cambio', color: 'error' })
  })
})

describe('metodos-pago — falla la lectura del comercio', () => {
  beforeEach(() => {
    toasts = []
    llamadas = []
    metodosBackend = [metodo()]
    facturadorBackend = 'sistema'
    fallaElPatch = false
    fallaTenantsMe = false
  })

  it('si GET /tenants/me falla, la tabla se ve, el selector del comercio queda deshabilitado y avisa', async () => {
    fallaTenantsMe = true
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Tarjeta de crédito')
    expect(selects(wrapper)).toHaveLength(2)
    expect(selects(wrapper)[0]!.props('disabled')).toBe(true)
    expect(toasts).toEqual([
      { title: 'No se pudo cargar quién hace las facturas', color: 'error' },
    ])
    // El de la fila sigue vivo: la falla es solo de la declaración del comercio.
    expect(selects(wrapper)[1]!.props('disabled')).toBeFalsy()
  })
})

describe('metodos-pago — quién emite cada medio (fila)', () => {
  beforeEach(() => {
    toasts = []
    llamadas = []
    metodosBackend = [
      metodo(),
      metodo({ metodoPagoId: EFECTIVO, nombre: 'Efectivo', esEfectivo: true, permiteVuelto: true }),
    ]
    facturadorBackend = 'sistema'
    fallaElPatch = false
    fallaTenantsMe = false
  })

  it('cada fila muestra el emisor que trae el GET', async () => {
    metodosBackend = [
      metodo({ emisor: 'maquina' }),
      metodo({ metodoPagoId: EFECTIVO, nombre: 'Efectivo', emisor: 'nadie' }),
    ]
    const wrapper = await montar()

    const filas = selects(wrapper).slice(1)
    expect(filas.map(s => s.props('modelValue'))).toEqual(['maquina', 'nadie'])
  })

  it('cambiarlo manda PATCH /metodos-pago/:id con { emisor } y nada más', async () => {
    const wrapper = await montar()

    await elegir(selects(wrapper)[1]!, 'maquina')

    expect(patches()).toHaveLength(1)
    expect(patches()[0]!.url).toMatch(new RegExp(`/metodos-pago/${TARJETA}$`))
    expect(patches()[0]!.body).toEqual({ emisor: 'maquina' })
    expect(toasts.at(-1)?.color).toBe('success')
  })

  it('con "Nadie" la fila avisa que la venta queda sin documento; las otras no', async () => {
    const wrapper = await montar()
    const aviso = 'Las ventas con este medio quedan sin documento. Emitirlo es responsabilidad del comercio.'
    expect(wrapper.text()).not.toContain(aviso)

    await elegir(selects(wrapper)[1]!, 'nadie')

    const apariciones = wrapper.text().split(aviso).length - 1
    expect(apariciones).toBe(1)
  })

  it('si el backend rechaza, la fila vuelve al emisor anterior y avisa en rojo', async () => {
    const wrapper = await montar()
    fallaElPatch = true

    await elegir(selects(wrapper)[1]!, 'nadie')

    expect(selects(wrapper)[1]!.props('modelValue')).toBe('sistema')
    expect(wrapper.text()).not.toContain('quedan sin documento')
    expect(toasts.at(-1)).toEqual({ title: 'El backend rechazó el cambio', color: 'error' })
  })
})
