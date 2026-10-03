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
/** Impresoras de rol `boleta` que devuelve `GET /impresoras/operacion?rol=boleta`
 * —el endpoint que usa quien IMPRIME, sin `Impresoras:Leer` (Tarea 3 del frente
 * de impresión). Vacío = no imprime nada. */
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
/** Lo que devuelve `GET /tipos-documento`, en el orden del servidor (por nombre). */
let tiposDocumentoMock: unknown[] = []
/** La página de catálogo que devuelve `GET /items`. */
let itemsCatalogoMock: unknown[] = []
/** Lo que devuelve `GET /items/:id/unidades` (las vendibles de un producto con serie). */
let unidadesVendiblesMock: unknown[] = []
/** Cada URL pedida a `GET /items/:id/unidades`, con su query string. */
let urlsUnidades: string[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown, headers?: Record<string, string> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const ruta = url.split('?')[0] ?? ''

    if (ruta.endsWith('/caja/activa')) {
      return Promise.resolve(cajaActivaMock)
    }
    if (ruta.endsWith('/unidades')) {
      urlsUnidades.push(url)
      return Promise.resolve(unidadesVendiblesMock)
    }
    if (ruta.includes('/items')) {
      urlsCatalogo.push(url)
      return Promise.resolve({ data: itemsCatalogoMock, meta: { total: itemsCatalogoMock.length, page: 1, pageSize: 48 } })
    }
    if (ruta.endsWith('/tipos-documento')) {
      return Promise.resolve(tiposDocumentoMock)
    }
    if (ruta.endsWith('/impresoras/operacion')) {
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
    // El resto del arranque (métodos de pago, unidades de medida, razones
    // sociales del emisor, propina sugerida, certificado QZ) no interviene en
    // este flujo.
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
  tiposDocumentoMock = []
  itemsCatalogoMock = []
  unidadesVendiblesMock = []
  urlsUnidades = []
  toasts = []
  // La clave vive a nivel de módulo (sobrevive a cerrar y reabrir un modal):
  // cada test arranca sin intento abierto.
  useIntentoCobro().terminar('pos')
  impresionesQz.length = 0
})

/**
 * `AppDrawer` stubeado (mismo motivo que `ventas/index.nuxt.spec.ts`): su root es `UDrawer` y,
 * al cerrarse el drawer de la receta, la transición de `usePresence` tira bajo happy-dom un
 * `TypeError: Receiver must be an instance of class CSSStyleDeclaration` como rechazo no
 * capturado — vitest sale con código 1 con todos los tests en verde.
 */
const AppDrawerStub = {
  name: 'AppDrawer',
  props: ['open'],
  template: '<div v-if="open" role="dialog"><slot name="header" /><slot name="body" /><slot name="actions" /></div>',
}

async function montar() {
  const wrapper = await mountSuspended(Pos, {
    // `UTooltip` necesita un `TooltipProviderContext` que solo existe con
    // `UApp` en la raíz (`docs/patterns/frontend.md` §15, molde de
    // `CarritoPanel.nuxt.spec.ts`) — sin esto, el test con caja abierta que
    // llega a renderizar `VentasCarritoPanel` (el botón "Vaciar todo" lleva
    // tooltip) revienta antes de montar nada. El resto de este archivo nunca
    // lo pisó porque `tieneCaja` era `false` en todos esos tests.
    global: { stubs: { UTooltip: { template: '<div><slot /></div>' }, AppDrawer: AppDrawerStub } },
  })
  montado = wrapper
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

describe('ventas/pos — el catálogo pide solo ítems vendibles', () => {
  it('una sola consulta de catálogo, con los tres tipos, `activo=true` y el orden del servidor', async () => {
    await montar()

    // Producto, receta y combo en UNA página paginada y ordenada por el servidor.
    expect(urlsCatalogo).toHaveLength(1)
    const params = new URL(urlsCatalogo[0]!, 'http://x').searchParams
    expect(params.get('tipo')).toBe('producto,receta,combo')
    expect(params.get('activo')).toBe('true')
    expect(params.get('orden')).toBe('disponibilidad')
  })

  it('con un ítem en el carrito, su tarjeta muestra el disponible descontado', async () => {
    cajaActivaMock = { id: 'caja-1', estado: 'abierta' }
    const palta = {
      id: 'item-1',
      nombre: 'Palta',
      descripcion: null,
      precioBase: '1000',
      monedaId: 'clp',
      monedaSimbolo: '$',
      stock: '10',
      stockDisponible: '10.0000',
      unidadMedida: 'unidad',
      tipo: 'producto',
      activo: true,
    }
    itemsCatalogoMock = [palta]
    const wrapper = await montar()
    await esperar(20)

    const tarjeta = () => wrapper.find('[data-qa="item-catalogo-item-1"]')
    expect(tarjeta().text()).toContain('Disponible: 10')

    wrapper.findComponent({ name: 'VentasCatalogoGrid' }).vm.$emit('add', palta)
    await esperar(20)

    expect(tarjeta().text()).toContain('Disponible: 9')
  })
})

describe('ventas/pos — la receta del drawer se fija al abrirlo', () => {
  it('confirmar agrega la línea aunque la grilla ya haya cambiado de página y la receta no esté en ella', async () => {
    // `items` es la página visible del servidor: una búsqueda o un cambio de página en vuelo
    // puede sacar la receta mientras el drawer está abierto. Antes, "Confirmar" hacía `return`
    // en silencio porque el `find` sobre la página no la encontraba.
    cajaActivaMock = { id: 'caja-1', estado: 'abierta' }
    const hamburguesa = {
      id: 'item-receta',
      nombre: 'Hamburguesa',
      descripcion: null,
      precioBase: '3000',
      monedaId: 'clp',
      monedaSimbolo: '$',
      stock: null,
      stockDisponible: null,
      unidadMedida: 'unidad',
      tipo: 'receta',
      activo: true,
    }
    const palta = { ...hamburguesa, id: 'item-1', nombre: 'Palta', tipo: 'producto' }
    itemsCatalogoMock = [hamburguesa]
    const wrapper = await montar()
    await esperar(20)

    const grilla = wrapper.findComponent({ name: 'VentasCatalogoGrid' })
    grilla.vm.$emit('add', hamburguesa) // abre el drawer de la receta
    await esperar(20)

    // La grilla recibe otra página, sin la receta.
    itemsCatalogoMock = [palta]
    grilla.vm.$emit('update:busqueda', 'palta')
    await esperar(400)
    expect(wrapper.find('[data-qa="item-catalogo-item-receta"]').exists()).toBe(false)

    wrapper.findComponent({ name: 'VentasItemPersonalizacionDrawer' })
      .vm.$emit('confirm', { omitidos: [], extras: [], comentario: '' }, '')
    await esperar(20)

    const lineas = wrapper.findComponent({ name: 'VentasCarritoPanel' }).props('lineas') as { itemId?: string }[]
    expect(lineas).toHaveLength(1)
  })
})

describe('ventas/pos — el documento con que arranca es la boleta, no el primero por nombre', () => {
  /**
   * `GET /tipos-documento` ordena por nombre, y hasta el 2026-10-02 el POS
   * arrancaba con `tiposRes[0]`: salía la boleta solo porque "Boleta…" ordena
   * antes que "Factura…". Con un tipo que ordene antes —acá un "Acta…" que pide
   * cliente— el cajero arrancaba en ese documento.
   */
  it('elige el tipo marcado `esBoleta`, aunque no sea el primero de la lista', async () => {
    cajaActivaMock = { id: 'caja-1', estado: 'abierta' }
    tiposDocumentoMock = [
      { id: 'doc-acta', nombre: 'Acta de Entrega', customerRequerido: true, esBoleta: false, receptorCompleto: false, rutChileno: false },
      { id: 'doc-boleta', nombre: 'Boleta de Venta', customerRequerido: false, esBoleta: true, receptorCompleto: false, rutChileno: false },
    ]
    const wrapper = await montar()
    await esperar(20)

    const carrito = wrapper.findComponent({ name: 'VentasCarritoPanel' })
    expect(carrito.exists(), 'el carrito, con la caja abierta').toBe(true)
    expect(carrito.props('tipoDocumentoId')).toBe('doc-boleta')
  })

  it('sin boleta en el catálogo no elige ninguno, como el servidor', async () => {
    // `resolverTipoDocumento`, con la venta sin tipo, busca la boleta del país y
    // si no hay deja la venta sin tipo: nunca elige otro documento por su cuenta.
    cajaActivaMock = { id: 'caja-1', estado: 'abierta' }
    tiposDocumentoMock = [
      { id: 'doc-acta', nombre: 'Acta de Entrega', customerRequerido: true, esBoleta: false, receptorCompleto: false, rutChileno: false },
    ]
    const wrapper = await montar()
    await esperar(20)

    expect(wrapper.findComponent({ name: 'VentasCarritoPanel' }).props('tipoDocumentoId')).toBeUndefined()
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
      giro: '',
      direccion: 'Dirección Formulario',
      comuna: '',
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

describe('ventas/pos — producto con serie: el cajero elige qué unidad sale', () => {
  const celular = {
    id: 'item-celu',
    nombre: 'iPhone 15',
    descripcion: null,
    precioBase: '800000',
    monedaId: 'clp',
    monedaSimbolo: '$',
    stock: '3',
    stockDisponible: '3.0000',
    unidadMedida: 'unidad',
    tipo: 'producto',
    modoInventario: 'serie',
    activo: true,
  }
  const vendible = (id: string, serie: string, condicion: string) => ({
    id, serie, estado: 'disponible', condicion, garantiaHasta: null, loteId: null, codigoLote: null,
    ventaId: null, creadoEl: '2026-10-01T00:00:00.000Z', ubicacionId: 'loc-1',
  })
  const NUEVO = { id: 'u-1', serie: 'IMEI-1', condicion: 'nuevo' }
  const USADO = { id: 'u-2', serie: 'IMEI-2', condicion: 'usado' }

  async function montarConCelular() {
    cajaActivaMock = { id: 'caja-1', estado: 'abierta' }
    itemsCatalogoMock = [celular]
    unidadesVendiblesMock = [vendible('u-1', 'IMEI-1', 'nuevo'), vendible('u-2', 'IMEI-2', 'usado')]
    const wrapper = await montar()
    await esperar(20)
    return wrapper
  }

  const lineasDelCarrito = (w: Awaited<ReturnType<typeof montar>>) =>
    w.findComponent({ name: 'VentasCarritoPanel' }).props('lineas') as { cantidad: string, unidades?: unknown[] }[]

  it('tocar el producto abre el selector y no lo agrega al carrito', async () => {
    const wrapper = await montarConCelular()

    wrapper.findComponent({ name: 'VentasCatalogoGrid' }).vm.$emit('add', celular)
    await esperar(50)

    const modal = wrapper.findComponent({ name: 'VentasUnidadesSerieModal' })
    expect(modal.exists()).toBe(true)
    expect(modal.props('open')).toBe(true)
    expect(urlsUnidades).toHaveLength(1)
    expect(urlsUnidades[0]).toMatch(/\/items\/item-celu\/unidades\?vendibles=true$/)
    expect(lineasDelCarrito(wrapper)).toHaveLength(0)
  })

  it('confirmar crea la línea con las unidades y el cobro manda sus unidadIds', async () => {
    const wrapper = await montarConCelular()
    wrapper.findComponent({ name: 'VentasCatalogoGrid' }).vm.$emit('add', celular)
    await esperar(50)

    wrapper.findComponent({ name: 'VentasUnidadesSerieModal' }).vm.$emit('confirm', [NUEVO, USADO])
    await esperar(20)

    const lineas = lineasDelCarrito(wrapper)
    expect(lineas).toHaveLength(1)
    expect(lineas[0]!.cantidad).toBe('2')
    expect(lineas[0]!.unidades).toEqual([NUEVO, USADO])

    wrapper.findComponent({ name: 'VentasCobroModal' })
      .vm.$emit('confirmar', [{ metodoPagoId: 'mp-efectivo', monto: '1600000' }], '0')
    await esperar(50)

    expect(bodiesDeVenta).toHaveLength(1)
    const linea = (bodiesDeVenta[0]!.lineas as Record<string, unknown>[])[0]!
    expect(linea).toMatchObject({ itemId: 'item-celu', cantidad: '2', unidadIds: ['u-1', 'u-2'] })
  })

  it('tocar de nuevo el mismo producto reabre el selector con las de la línea marcadas, sin sumar un +1', async () => {
    const wrapper = await montarConCelular()
    const grilla = wrapper.findComponent({ name: 'VentasCatalogoGrid' })
    grilla.vm.$emit('add', celular)
    await esperar(50)
    wrapper.findComponent({ name: 'VentasUnidadesSerieModal' }).vm.$emit('confirm', [NUEVO])
    await esperar(20)

    grilla.vm.$emit('add', celular)
    await esperar(50)

    const modal = wrapper.findComponent({ name: 'VentasUnidadesSerieModal' })
    expect(modal.props('seleccionadas')).toEqual([NUEVO])
    expect(lineasDelCarrito(wrapper)).toHaveLength(1)
    expect(lineasDelCarrito(wrapper)[0]!.cantidad).toBe('1')

    modal.vm.$emit('confirm', [NUEVO, USADO])
    await esperar(20)

    expect(lineasDelCarrito(wrapper)).toHaveLength(1)
    expect(lineasDelCarrito(wrapper)[0]!.unidades).toEqual([NUEVO, USADO])
    expect(lineasDelCarrito(wrapper)[0]!.cantidad).toBe('2')
  })

  it('"Cambiar unidades" de la línea reabre el selector sobre esa línea', async () => {
    const wrapper = await montarConCelular()
    wrapper.findComponent({ name: 'VentasCatalogoGrid' }).vm.$emit('add', celular)
    await esperar(50)
    wrapper.findComponent({ name: 'VentasUnidadesSerieModal' }).vm.$emit('confirm', [NUEVO, USADO])
    await esperar(20)

    wrapper.findComponent({ name: 'VentasCarritoPanel' }).vm.$emit('cambiar-unidades', 0)
    await esperar(50)

    const modal = wrapper.findComponent({ name: 'VentasUnidadesSerieModal' })
    expect(modal.props('open')).toBe(true)
    expect(modal.props('seleccionadas')).toEqual([NUEVO, USADO])

    modal.vm.$emit('confirm', [USADO])
    await esperar(20)

    expect(lineasDelCarrito(wrapper)[0]!.unidades).toEqual([USADO])
    expect(lineasDelCarrito(wrapper)[0]!.cantidad).toBe('1')
  })
})
