// @vitest-environment nuxt
//
// Primer spec de `pages/ventas/pos.vue`. Cubre UNA cosa: el catálogo del POS
// pide solo lo vendible. Hasta 2026-08-09 la pantalla traía todo y descartaba
// los pausados con un `.filter(i => i.activo)` en el cliente — no era
// equivalente, porque el pausado igual ocupaba uno de los 100 lugares
// pedidos. Ahora el filtro va en la query (`activo=true`), y esto es lo único
// que lo sostiene del lado del cliente: borrar el param de la URL no rompe
// ninguna otra cosa, así que sin este test se puede borrar con la suite
// entera en verde.
//
// El molde es `salones/index.nuxt.spec.ts` § "el catálogo pide solo ítems
// vendibles" — mismo mock de `useApiFetch` capturando la URL COMPLETA (con
// query string), mismo motivo: si el mock cortara en el `?`, `activo=true`
// sería invisible para el test. El arnés acá es más grande porque el POS
// arranca caja, unidades de medida, emisor y propina en paralelo
// (`onMounted`): el resto de esas rutas cae en el catch-all porque ninguna
// interviene en lo que este spec afirma.
//
// Segundo bloque agregado en la Tarea 4
// (`docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md`): el
// POS también imprime lo que el servidor cobró (`POST /ventas` → `boleta`),
// en vez de recalcularlo con `asegurarVigente()`. Molde: la Tarea 3 en
// `salones/index.nuxt.spec.ts` § "un producto pesable en la boleta imprime la
// cantidad real, no redondeada a entero" — mismo mock de `qz-tray` (capturando
// `impresionesQz`, el texto que TERMINA impreso) y mismo motivo: una
// aserción sobre `itemsParaBoletaVenta` como objeto intermedio no habría
// cazado el bug real de este repo (un pesable cruzado imprimiendo "0").
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Pos from './pos.vue'
import { AVISO_COBRO_REPETIDO, useIntentoCobro } from '~/composables/useIntentoCobro'

/**
 * Lo que efectivamente se mandó a imprimir, ticket por ticket. `imprimirEn()`
 * importa el cliente de QZ de verdad —que en un test le pediría un
 * `websocket.connect()` a un QZ Tray que no existe—, así que se stubea acá.
 * Va con `vi.hoisted` porque `vi.mock` se iza por encima de los `const`.
 */
const { impresionesQz } = vi.hoisted(() => ({
  impresionesQz: [] as string[][],
}))
vi.mock('qz-tray', () => ({
  default: {
    websocket: { isActive: () => true, connect: () => Promise.resolve() },
    configs: { create: () => ({}) },
    security: {
      setCertificatePromise: () => {},
      setSignatureAlgorithm: () => {},
      setSignaturePromise: () => {},
    },
    print: (_config: unknown, datos: string[]) => {
      impresionesQz.push(datos)
      return Promise.resolve()
    },
  },
}))

/** La moneda oficial, para que `formatMonto` rinda plata de verdad en el ticket. */
const MONEDA_CLP = {
  monedaId: 'clp',
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

/** Una impresora de boleta activa: sin ella `obtenerImpresoraBoleta()` da `null` y no imprime nada. */
function impresoraDeBoleta() {
  return {
    id: 'imp-b1',
    nombre: 'Caja',
    rol: 'boleta',
    activo: true,
    tipoConexion: 'red',
    host: '10.0.0.8',
    puerto: 9100,
    nombreCola: null,
  }
}

async function esperar(ms: number) {
  await new Promise(r => setTimeout(r, ms))
}

/**
 * Las URLs COMPLETAS pedidas al catálogo, con query string. Igual que en
 * `salones/index.nuxt.spec.ts`: cortar en el `?` haría invisible el filtro
 * que este spec existe para sostener.
 */
let urlsCatalogo: string[] = []
/** Impresoras de rol `boleta` que devuelve `GET /impresoras?rol=boleta`. Vacío = no imprime nada. */
let impresorasBoleta: unknown[] = []
/**
 * Override de `GET /caja/activa`. `null` (default) es el caso que necesita el
 * resto de este archivo — sin caja abierta, `VentasCobroModal` igual vive
 * fuera del `v-else` que la exige. `VentasCarritoPanel` SÍ está adentro de ese
 * `v-else` (`tieneCaja`, `pos.vue`): el test que necesita emitir sobre ese
 * componente tiene que pisar esto con una caja abierta o `findComponent`
 * encuentra un wrapper vacío.
 */
let cajaActivaMock: unknown = null
/** Override de la `boleta` que devuelve `POST /ventas`; `null` = no se llegó a pedir. */
let ventaBoletaMock: Record<string, unknown> | null = null
/** Cada body de `POST /ventas` recibido. */
let bodiesDeVenta: Record<string, unknown>[] = []
/** La `Idempotency-Key` de cada `POST /ventas`, en orden. */
let clavesDeVenta: (string | undefined)[] = []
/**
 * Lo que contesta cada `POST /ventas`, en orden: un `Error` lo rechaza (el
 * corte de red, el 422), un objeto se mezcla sobre la respuesta de éxito.
 * Vacía = éxito normal.
 */
let respuestasVenta: (Error | { status: number, data: unknown } | Record<string, unknown>)[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown, headers?: Record<string, string> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const ruta = url.split('?')[0] ?? ''

    if (ruta.endsWith('/caja/activa')) {
      return Promise.resolve(cajaActivaMock)
    }
    if (ruta.includes('/items')) {
      urlsCatalogo.push(url)
      return Promise.resolve({ data: [], meta: { total: 0, page: 1, pageSize: 100 } })
    }
    if (ruta.endsWith('/impresoras')) {
      return Promise.resolve(impresorasBoleta)
    }
    if (ruta.endsWith('/ventas') && opts?.method === 'POST') {
      bodiesDeVenta.push((opts.body ?? {}) as Record<string, unknown>)
      clavesDeVenta.push(opts.headers?.['Idempotency-Key'])
      const respuesta = respuestasVenta.shift()
      if (respuesta instanceof Error || (respuesta && 'status' in respuesta))
        return Promise.reject(respuesta)
      return Promise.resolve({
        estado: 'pagada',
        advertencias: [],
        boleta: ventaBoletaMock,
        ...respuesta,
      })
    }
    // El resto del arranque (métodos de pago, tipos de documento, unidades de
    // medida, razones sociales del emisor, propina sugerida, certificado QZ)
    // no interviene en este flujo.
    return Promise.resolve([])
  }
})

interface ToastPos { title?: string, color?: string, actions?: { label: string }[] }
let toasts: ToastPos[] = []
mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: ToastPos) => {
      toasts.push(t)
    },
  })
})

let montado: { unmount: () => void } | null = null

afterEach(() => {
  montado?.unmount()
  montado = null
  // El Pinia se comparte entre los tests del archivo (mismo criterio que
  // `salones/index.nuxt.spec.ts`).
  useMonedasStore().reset()
})

beforeEach(() => {
  urlsCatalogo = []
  impresorasBoleta = []
  cajaActivaMock = null
  ventaBoletaMock = null
  bodiesDeVenta = []
  clavesDeVenta = []
  respuestasVenta = []
  toasts = []
  // La clave vive a nivel de módulo (sobrevive a cerrar y reabrir un modal):
  // cada test arranca sin intento abierto.
  useIntentoCobro().terminar('pos')
  impresionesQz.length = 0
})

async function montar() {
  const wrapper = await mountSuspended(Pos, {
    // `UTooltip` necesita un `TooltipProviderContext` que solo existe con
    // `UApp` en la raíz (`docs/patterns/frontend.md` §15, molde de
    // `CarritoPanel.nuxt.spec.ts`) — sin esto, el test con caja abierta que
    // llega a renderizar `VentasCarritoPanel` (el botón "Vaciar todo" lleva
    // tooltip) revienta antes de montar nada. El resto de este archivo nunca
    // lo pisó porque `tieneCaja` era `false` en todos esos tests.
    global: { stubs: { UTooltip: { template: '<div><slot /></div>' } } },
  })
  montado = wrapper
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

describe('ventas/pos — el catálogo pide solo ítems vendibles', () => {
  it('las tres consultas de catálogo llevan `activo=true`', async () => {
    await montar()

    // Producto, receta y combo: las tres, no "alguna".
    expect(urlsCatalogo).toHaveLength(3)
    for (const url of urlsCatalogo) {
      expect(url).toContain('activo=true')
    }
    expect(urlsCatalogo.map(u => u.match(/tipo=(\w+)/)?.[1]).sort()).toEqual([
      'combo',
      'producto',
      'receta',
    ])
  })
})

describe('ventas/pos — la boleta se imprime desde la respuesta de POST /ventas', () => {
  /**
   * Tarea 4: el ticket ya no se arma recalculando el carrito con
   * `asegurarVigente()` — sale de `venta.boleta`, la respuesta del propio
   * `POST /ventas`. La línea pesable (kg, pedida en g) es el molde exacto de
   * `salones/index.nuxt.spec.ts`: sin unidad hidratada o con el campo
   * equivocado, `formatStockCantidad` redondea a entero — el bug real de este
   * repo, "0,3 kg" impreso como "0". La aserción es sobre el TEXTO que llega a
   * `imprimirBoleta` (`impresionesQz`), no sobre `itemsParaBoletaVenta` como
   * objeto intermedio.
   */
  it('imprime la línea de un pesable tal como la devolvió el servidor, sin redondear a entero', async () => {
    useUnidadesMedidaStore().hydrate([
      { unidadMedidaId: 'kg-uuid', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'masa', factorBase: '1000' },
      { unidadMedidaId: 'g-uuid', codigo: 'g', nombre: 'Gramo', magnitud: 'masa', factorBase: '1' },
    ])
    useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
    impresorasBoleta = [impresoraDeBoleta()]
    ventaBoletaMock = {
      ventaId: 'venta-1',
      cajero: 'Ana Torres',
      items: [{
        descripcion: 'Palta',
        cantidad: '0.3000',
        cantidadPresentacion: null,
        unidadCodigoPresentacion: null,
        unidadCodigoBase: 'kg',
        precioUnitario: '4000',
        totalLinea: '1200',
      }],
      totales: {
        subtotalNeto: '1200',
        totalDescuentos: '0',
        totalRecargos: '0',
        totalImpuestos: '0',
        totalFinal: '1200',
      },
      impuestos: [],
      promociones: [],
      propina: null,
      pagos: [{ nombre: 'Efectivo', monto: '1200' }],
      vuelto: null,
    }

    const wrapper = await montar()
    const cobroModal = wrapper.findComponent({ name: 'VentasCobroModal' })
    cobroModal.vm.$emit('confirmar', [{ metodoPagoId: 'mp-efectivo', monto: '1200' }], '0')
    await esperar(50)

    expect(bodiesDeVenta, 'el POST de venta salió').toHaveLength(1)
    expect(toasts.some(t => t.title === 'Venta pagada'), 'el toast de éxito salió').toBe(true)
    // Ya no hay camino sin boleta: el aviso de "no se pudo generar la boleta"
    // desaparece, igual que en salones.
    expect(toasts.some(t => t.title === 'Venta registrada, pero no se pudo generar la boleta')).toBe(false)

    expect(impresionesQz, 'la boleta salió').toHaveLength(1)
    const filaItem = impresionesQz[0]!.join('').split('\n').find(l => l.includes('Palta')) ?? ''
    expect(filaItem, 'la línea del pesable está en el ticket').not.toBe('')
    expect(filaItem, 'muestra la fracción, no el entero redondeado').toContain('0,3')
    expect(filaItem.slice(0, 5).trim(), 'la columna CANT no quedó en "0"').not.toBe('0')
  })

  /**
   * El agujero que encontró la revisión de toda la rama: el cliente impreso
   * salía de `customer.value` (el formulario, estado local), no de la
   * respuesta del servidor — así que reimprimir la misma venta como COPIA
   * (`VentaDetalleDrawer`) perdía esos datos, porque ahí no hay formulario.
   * La prueba que lo distingue: el formulario lleva un cliente, `venta.boleta`
   * trae OTRO — el ticket tiene que imprimir el del servidor. El mutante que
   * describe el brief ("vaciar `customer.value` antes de imprimir") es el
   * mismo caso: si el ticket dependiera del formulario, esta aserción fallaría
   * apenas se lea `customer.value` en vez de `venta.boleta.customer`.
   */
  it('el cliente impreso sale del payload del servidor, no del formulario', async () => {
    useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
    // A diferencia del resto de este describe: acá el test necesita EMITIR
    // sobre `VentasCarritoPanel` (para simular el formulario cargado), y ese
    // componente vive adentro del `v-else` que exige `tieneCaja` — sin esto
    // `findComponent` da un wrapper vacío.
    cajaActivaMock = { id: 'caja-1', estado: 'abierta' }
    impresorasBoleta = [impresoraDeBoleta()]
    ventaBoletaMock = {
      ventaId: 'venta-2',
      cajero: 'Ana Torres',
      items: [{
        descripcion: 'Palta',
        cantidad: '1',
        cantidadPresentacion: null,
        unidadCodigoPresentacion: null,
        unidadCodigoBase: 'unidad',
        precioUnitario: '4000',
        totalLinea: '4000',
      }],
      totales: {
        subtotalNeto: '4000',
        totalDescuentos: '0',
        totalRecargos: '0',
        totalImpuestos: '0',
        totalFinal: '4000',
      },
      impuestos: [],
      promociones: [],
      propina: null,
      pagos: [{ nombre: 'Efectivo', monto: '4000' }],
      vuelto: null,
      // Deliberadamente distinto del formulario de abajo: si el ticket
      // imprimiera el del formulario, esta aserción lo cazaría.
      customer: { nombre: 'Cliente Servidor', rut: '99.999.999-9', direccion: 'Dirección Servidor' },
    }

    const wrapper = await montar()
    const carritoPanel = wrapper.findComponent({ name: 'VentasCarritoPanel' })
    // Formulario en memoria: el que `customer.value` tendría al momento del
    // cobro, y el que `limpiar()` vacía DESPUÉS de imprimir.
    carritoPanel.vm.$emit('update:customer', {
      nombre: 'Cliente Formulario',
      rut: '11.111.111-1',
      direccion: 'Dirección Formulario',
      telefono: '',
      email: '',
      terceroId: null,
    })
    carritoPanel.vm.$emit('update:customerExpandido', true)
    await esperar(0)

    const cobroModal = wrapper.findComponent({ name: 'VentasCobroModal' })
    cobroModal.vm.$emit('confirmar', [{ metodoPagoId: 'mp-efectivo', monto: '4000' }], '0')
    await esperar(50)

    expect(bodiesDeVenta, 'el POST de venta salió').toHaveLength(1)
    expect(impresionesQz, 'la boleta salió').toHaveLength(1)
    const texto = impresionesQz[0]!.join('')
    expect(texto, 'imprime el nombre que devolvió el servidor').toContain('Cliente Servidor')
    expect(texto, 'imprime el RUT que devolvió el servidor').toContain('99.999.999-9')
    expect(texto, 'NO imprime el nombre del formulario').not.toContain('Cliente Formulario')
    expect(texto, 'NO imprime el RUT del formulario').not.toContain('11.111.111-1')
  })
})

describe('ventas/pos — un cobro que se repite no se registra dos veces', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const errorOtrosDatos = {
    status: 422,
    data: {
      statusCode: 422,
      message: 'Este cobro ya se había registrado con otros datos. Revisá la venta antes de cobrar de nuevo.',
      ventaId: 'venta-1',
    },
  }

  async function confirmar(
    wrapper: Awaited<ReturnType<typeof montar>>,
    pagos: { metodoPagoId: string, monto: string }[],
  ) {
    wrapper.findComponent({ name: 'VentasCobroModal' }).vm.$emit('confirmar', pagos, '0')
    await esperar(50)
  }

  it('un corte y un reintento mandan la MISMA clave, aunque el cajero haya cambiado el medio de pago', async () => {
    respuestasVenta = [new Error('fetch failed')]
    const wrapper = await montar()

    await confirmar(wrapper, [{ metodoPagoId: 'mp-tarjeta', monto: '1200' }])
    await confirmar(wrapper, [{ metodoPagoId: 'mp-efectivo', monto: '1200' }])

    expect(clavesDeVenta).toHaveLength(2)
    expect(clavesDeVenta[0]).toMatch(UUID)
    expect(clavesDeVenta[1], 'el reintento es el mismo intento').toBe(clavesDeVenta[0])
    // El body cambió: si la primera entró, el backend contesta 422 en vez de
    // crear otra venta. Con una clave nueva, saldría la segunda venta.
    expect(bodiesDeVenta[1]!.pagos).not.toEqual(bodiesDeVenta[0]!.pagos)
  })

  it('después de un cobro que salió bien, el siguiente lleva otra clave', async () => {
    const wrapper = await montar()

    await confirmar(wrapper, [{ metodoPagoId: 'mp-efectivo', monto: '1200' }])
    await confirmar(wrapper, [{ metodoPagoId: 'mp-efectivo', monto: '1200' }])

    expect(clavesDeVenta).toHaveLength(2)
    expect(clavesDeVenta[1]).not.toBe(clavesDeVenta[0])
  })

  it('una venta reproducida sigue el flujo de éxito y avisa que ya había entrado', async () => {
    respuestasVenta = [{ repetida: true }]
    const wrapper = await montar()

    await confirmar(wrapper, [{ metodoPagoId: 'mp-efectivo', monto: '1200' }])

    expect(toasts.some(t => t.title === 'Venta pagada'), 'el éxito de siempre').toBe(true)
    expect(toasts.some(t => t.title === AVISO_COBRO_REPETIDO), 'más el aviso').toBe(true)
  })

  it('una venta nueva no avisa nada de repetición', async () => {
    const wrapper = await montar()

    await confirmar(wrapper, [{ metodoPagoId: 'mp-efectivo', monto: '1200' }])

    expect(toasts.some(t => t.title === AVISO_COBRO_REPETIDO)).toBe(false)
  })

  it('el 422 de otros datos: toast con "Ver venta" en vez del rechazo genérico, y el Confirmar siguiente es una venta nueva', async () => {
    respuestasVenta = [errorOtrosDatos]
    const wrapper = await montar()

    await confirmar(wrapper, [{ metodoPagoId: 'mp-efectivo', monto: '1200' }])
    const aviso = toasts.find(t => t.title?.includes('otros datos'))
    expect(aviso?.actions?.map(a => a.label)).toEqual(['Ver venta'])
    expect(toasts.some(t => t.title === 'Error al registrar la venta')).toBe(false)

    await confirmar(wrapper, [{ metodoPagoId: 'mp-efectivo', monto: '1200' }])
    expect(clavesDeVenta[1], 'el aviso cerró el intento (owner, 2026-09-19)').not.toBe(clavesDeVenta[0])
  })

  it('vaciar el carrito entre dos intentos cierra el primero: el siguiente lleva otra clave', async () => {
    cajaActivaMock = { id: 'caja-1', estado: 'abierta' }
    respuestasVenta = [new Error('fetch failed')]
    const wrapper = await montar()

    await confirmar(wrapper, [{ metodoPagoId: 'mp-efectivo', monto: '1200' }])

    // Una línea y "Vaciar todo": el carrito pasa por vacío.
    wrapper.findComponent({ name: 'VentasCatalogoGrid' }).vm.$emit('add', {
      id: 'item-1',
      nombre: 'Palta',
      descripcion: null,
      precioBase: '1000',
      monedaId: 'clp',
      monedaSimbolo: '$',
      stock: '10',
      unidadMedida: 'unidad',
      tipo: 'producto',
      activo: true,
    })
    await esperar(0)
    wrapper.findComponent({ name: 'VentasCarritoPanel' }).vm.$emit('limpiar-todo')
    await esperar(0)

    await confirmar(wrapper, [{ metodoPagoId: 'mp-efectivo', monto: '1200' }])

    expect(clavesDeVenta).toHaveLength(2)
    expect(clavesDeVenta[1]).not.toBe(clavesDeVenta[0])
  })
})
