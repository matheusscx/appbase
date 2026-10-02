// @vitest-environment nuxt
//
// El drawer no tenía spec. Promociones (T8/T12) le agregó `filaDePromocion` y
// la familia `'Promoción'`, y la regla que eso fija —dónde cae la plata de una
// promo en el desglose y en los totales— quedaba sostenida solo por la revisión
// manual: es lógica de TEMPLATE + `computed`, así que ni el build ni el
// typecheck la ven.
//
// Lo que fija:
//   1. Una promo congelada es su propia familia, no un descuento de catálogo.
//   2. Una aplicación cross-línea NO se agrupa por `aplicacion`: baja una fila
//      por línea, cada una con su propio monto. El campo `aplicacion` viaja en
//      el tipo y esta pantalla no lo lee.
//   3. La promo va DESPUÉS de las reglas de catálogo dentro del paso
//      `descuentos`, que es el orden en que el motor las restó.
//   4. El total rotulado "Descuentos" incluye la plata de la promo — al revés
//      que el ticket impreso, que la resta del agregado y la nombra aparte
//      (`ticket-builder.ts`, `lineasTotalesConImpuestos`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import VentaDetalleDrawer from './VentaDetalleDrawer.vue'

/**
 * Lo que efectivamente se mandó a imprimir. `imprimirEn()` importa el cliente
 * de QZ de verdad —que en un test le pediría un `websocket.connect()` a un QZ
 * Tray que no existe—, así que se stubea acá. Mismo molde que
 * `pages/ventas/pos.nuxt.spec.ts` y `pages/salones/index.nuxt.spec.ts`: la
 * aserción de "Reimprimir boleta" es sobre el TEXTO que termina impreso, no
 * sobre `itemsParaBoletaReimpresion` como objeto intermedio. Va con
 * `vi.hoisted` porque `vi.mock` se iza por encima de los `const`.
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

/**
 * `totalLinea` va aparte de `subtotal` a propósito: el motor nunca emite una
 * línea cuyo total ignore lo que le restaron. Acá el neto es 6.000/4.000 y el
 * total ya trae descontado el catálogo y la promo de esa línea.
 */
const detalle = (
  id: string,
  descripcion: string,
  subtotal: string,
  totalLinea: string,
) => ({
  id,
  itemId: `item-${id}`,
  descripcion,
  cantidad: '1',
  precioUnitario: subtotal,
  unidadCodigoBase: 'unidad',
  subtotal,
  totalLinea,
  clasificacionTributaria: 'afecto',
  modoInventario: null,
  cantidadDevuelta: '0',
})

/**
 * Dos líneas, un descuento de catálogo en la primera y UNA aplicación de promo
 * repartida entre las dos (mismo `aplicacion: 1`, dos filas congeladas). Es la
 * forma que el motor produce para un 2x1 que cruza líneas.
 */
const VENTA = {
  id: 'v-1',
  // La caja con la que se cobró — la usa `puedeReimprimir` en el camino sin
  // `Ventas:Anular` (§ "reimprimir boleta (camino angosto...)" más abajo).
  cajaId: 'caja-1',
  canal: 'fisico',
  estado: 'pagada',
  fecha: '2026-08-28T12:00:00.000Z',
  creadoEl: '2026-08-28T12:00:00.000Z',
  totalBruto: '10000.0000',
  // 500 de catálogo + 1.200 + 800 de la promo: el agregado los funde.
  totalDescuentos: '2500.0000',
  totalRecargos: '0.0000',
  totalImpuestos: '0.0000',
  totalFinal: '7500.0000',
  ventaReferenciaId: null,
  tieneLineasDespachadas: false,
  tipoDocumento: null,
  esNotaCredito: false,
  reembolsos: [],
  notasCredito: [],
  // Del backend. `total` NO es `totalFinal` a propósito: es el número que el
  // modal tiene que mostrar, y si el drawer volviera a restarlo por su cuenta
  // daría 7.500 y el caso lo caza.
  disponibleNotaCredito: {
    total: '6500.0000',
    porPorcion: [
      { clasificacion: 'afecto', monto: '5000.0000' },
      { clasificacion: 'exento', monto: '1500.0000' },
    ],
  },
  detalles: [
    // 6.000 − 500 de catálogo − 1.200 de promo = 4.300
    detalle('det-1', 'Pizza grande', '6000.0000', '4300.0000'),
    // 4.000 − 800 de promo = 3.200
    detalle('det-2', 'Pizza chica', '4000.0000', '3200.0000'),
  ],
  descuentos: [
    {
      id: 'd-1',
      detalleId: 'det-1',
      nombreRegla: 'Descuento socio',
      modo: 'porcentaje',
      valorAplicado: '500.0000',
      valorSolicitado: '500.0000',
      porcentajeAplicado: '0.10',
      aplicadoEn: 'linea',
    },
  ],
  recargos: [],
  impuestos: [],
  promociones: [
    {
      id: 'vp-1',
      detalleId: 'det-1',
      aplicacion: 1,
      promocionId: 'promo-1',
      nombre: '2x1 martes',
      tipo: 'nxm',
      valorEfectivo: '1.0000',
      monto: '1200.0000',
    },
    {
      id: 'vp-2',
      detalleId: 'det-2',
      aplicacion: 1,
      promocionId: 'promo-1',
      nombre: '2x1 martes',
      tipo: 'nxm',
      valorEfectivo: '1.0000',
      monto: '800.0000',
    },
  ],
  configCalculo: {
    formula: ['descuentos', 'recargos', 'impuestos'],
    calculoDescuentos: 'base',
    calculoRecargos: 'base',
    escalaCalculo: 6,
    modoRedondeo: 'HALF_UP',
    // Congelado en CLP (ver `CLP` arriba: `decimales: 0`) — lo que el tipo del
    // drawer exige desde que `NotaCreditoModal` lo usa para cuantizar.
    decimalesMoneda: 0,
  },
  pagos: [],
  customer: null,
  propina: null,
  // Lo que el BACKEND decide sobre los documentos (spec emisión por venta § 3.4
  // y § 3.5): la pantalla solo lo muestra. Una venta pagada no se anula.
  documentos: [] as unknown[],
  anulable: false,
  anularPreguntaExterno: false,
  abonoConMaquinaDuplica: false,
}

/**
 * Una NOTA DE CRÉDITO compuesta: sus dos líneas de ajuste llevan la MISMA glosa
 * —la que escribió el operador— y lo único que las separa es su porción fiscal.
 * 1.000 repartidos 735 afecto (con 117 de IVA) / 265 exento.
 */
const NOTA_CREDITO = {
  ...VENTA,
  id: 'nc-1',
  esNotaCredito: true,
  totalBruto: '883.0000',
  totalDescuentos: '0.0000',
  totalImpuestos: '117.0000',
  totalFinal: '1000.0000',
  ventaReferenciaId: 'v-1',
  descuentos: [],
  promociones: [],
  impuestos: [
    {
      id: 'vi-1',
      detalleId: 'nc-det-1',
      nombreRegla: 'IVA',
      modo: 'porcentaje',
      valorAplicado: '117.0000',
      valorSolicitado: '117.0000',
      porcentajeAplicado: '0.19',
      aplicadoEn: 'linea',
    },
  ],
  detalles: [
    {
      ...detalle('nc-det-1', 'Cliente insatisfecho', '618.0000', '735.0000'),
      clasificacionTributaria: 'afecto',
    },
    {
      ...detalle('nc-det-2', 'Cliente insatisfecho', '265.0000', '265.0000'),
      clasificacionTributaria: 'exento',
    },
  ],
}

/** La boleta que devuelve `GET /ventas/:id/boleta` para la venta `v-1` ya cobrada. */
const BOLETA_REIMPRESION = {
  ventaId: 'v-1',
  fecha: '2026-08-28T12:00:00.000Z',
  canal: 'fisico',
  estado: 'pagada',
  mesa: null,
  cuentaNumero: null,
  cajero: 'Ana Torres',
  items: [{
    descripcion: 'Pizza grande',
    cantidad: '1',
    cantidadPresentacion: null,
    unidadCodigoPresentacion: null,
    unidadCodigoBase: 'unidad',
    precioUnitario: '7500',
    totalLinea: '7500',
  }],
  totales: {
    subtotalNeto: '7500',
    totalDescuentos: '0',
    totalRecargos: '0',
    totalImpuestos: '0',
    totalFinal: '7500',
  },
  impuestos: [],
  promociones: [],
  customer: null,
  propina: null,
  pagos: [{ nombre: 'Efectivo', monto: '7500' }],
  vuelto: null,
}

/** Una impresora de boleta activa: sin ella `obtenerImpresoraBoleta()` da `null` y no imprime nada. */
const IMPRESORA_BOLETA = {
  id: 'imp-b1',
  nombre: 'Caja',
  rol: 'boleta',
  activo: true,
  tipoConexion: 'red',
  host: '10.0.0.8',
  puerto: 9100,
  nombreCola: null,
}

/** Razón social del emisor para `useRazonSocialEmisor`. */
const RAZON_SOCIAL = {
  nombre: 'Comercial Paris SpA',
  rut: '76.123.456-7',
  direccion: 'Av. Providencia 1234',
  habilitado: true,
  preferida: true,
}

/** Qué documento contesta el mock. Se cambia ANTES de montar. */
let documentoActual: typeof VENTA = VENTA

/**
 * Permisos del usuario simulado, mismo molde que
 * `pages/configuracion/cajas.nuxt.spec.ts`: mutable para poder afirmar el
 * botón de "Reimprimir boleta" con y sin `Ventas:Anular` en el mismo archivo.
 * Con las dos ramas que ya usaba el resto de la suite (`Ventas:Anular` para
 * `puedeAnular`... — acá siempre `false` porque `VENTA.estado === 'pagada'` —
 * y `Ventas:Nota de crédito` para `puedeCrearNC`).
 */
let permisos = ['Ventas:Anular', 'Ventas:Nota de crédito']
/** `false` para probar un rol con permisos sueltos: con `esAdmin` el bypass lo tapa todo. */
let esAdmin = true

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

/** La boleta que devuelve `GET /ventas/:id/boleta`. Se cambia ANTES de montar. */
let boletaActual: Record<string, unknown> | null = BOLETA_REIMPRESION
/** Impresoras de rol `boleta` que devuelve `GET /impresoras/operacion?rol=boleta`
 * —el endpoint que usa quien IMPRIME, sin `Impresoras:Leer`. Vacío = `imprimirBoleta`
 * no llama a QZ. */
let impresorasBoleta: unknown[] = [IMPRESORA_BOLETA]

/**
 * ⚠️ El fallback devuelve `[]`, **no `null`**. El drawer dispara
 * `unidadesStore.ensureLoaded()`, que asigna al store lo que venga: con `null`
 * el store queda en `null` y explota más tarde dentro de una `computed`, como
 * unhandled rejection. Medido: `vitest run` sale con **exit 1** y los 4 tests
 * en rojo por una URL que a este spec ni le importa.
 */
/** Los `PATCH` que salieron (completar el número de un documento) y qué contestar. */
let patches: { url: string, body: Record<string, unknown> }[] = []
let respuestaPatch: Record<string, unknown> = {}

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (opts?.method === 'PATCH') {
      patches.push({ url, body: opts.body ?? {} })
      return Promise.resolve(structuredClone(respuestaPatch))
    }
    if (url.includes('/metodos-pago')) return Promise.resolve([])
    // Antes del chequeo genérico de `/ventas/`: las dos rutas comparten el
    // substring y `/ventas/:id/boleta` necesita SU PROPIA respuesta, no la
    // del detalle de venta.
    if (url.endsWith('/boleta')) return Promise.resolve(structuredClone(boletaActual))
    // `endsWith`, no `includes`: `/impresoras/qz/certificado` también contiene
    // el substring y espera `{ certificado }`, no la lista — con `includes`
    // acá esa llamada recibiría este array igual, y aunque degrada sin romper
    // (destructurar `.certificado` de un array da `undefined`, que es el
    // camino "sin firmar" que `asegurarSeguridadQz` ya maneja), separarla deja
    // el mock diciendo la verdad sobre qué contesta cada ruta.
    if (url.split('?')[0]!.endsWith('/impresoras/operacion')) return Promise.resolve(impresorasBoleta)
    if (url.includes('/tenants/razones-sociales')) return Promise.resolve([RAZON_SOCIAL])
    if (url.includes('/ventas/')) return Promise.resolve(structuredClone(documentoActual))
    return Promise.resolve([])
  }
})

// El Pinia se comparte entre los tests del archivo (mismo criterio que
// `salones/index.nuxt.spec.ts`): sin este reset, la caja activa que deja
// puesta un test del camino angosto (más abajo) sobrevive al siguiente.
afterEach(() => {
  useCajaStore().activa = null
  esAdmin = true
  permisos = ['Ventas:Anular', 'Ventas:Nota de crédito']
  patches = []
})

/**
 * `AppDrawer` stubeado por el mismo motivo que en `inventario/index.nuxt.spec.ts`:
 * su root es `UDrawer` (reka-ui) y bajo happy-dom la transición de `usePresence`
 * tira unhandled rejections que sacan a `vitest run` con exit 1.
 */
async function montar() {
  const wrapper = await mountSuspended(VentaDetalleDrawer, {
    // Se monta CERRADO y se abre después: el `watch` que dispara la carga no
    // es `immediate`, así que un drawer que nace abierto nunca pide la venta —
    // igual que en la app, donde la pantalla lo monta cerrado.
    props: { ventaId: 'v-1', open: false },
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
  useMonedasStore().hydrate([CLP], 'tenant-1')
  await wrapper.setProps({ open: true })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

/** El texto de cada fila de la tabla de líneas, en orden. */
function filas(wrapper: Awaited<ReturnType<typeof montar>>): string[] {
  return wrapper.findAll('tbody tr').map(tr => tr.text())
}

/** El desglose de una línea está colapsado: hay que abrirlo como el usuario. */
async function expandir(
  wrapper: Awaited<ReturnType<typeof montar>>,
  concepto: string,
) {
  const boton = wrapper.find(`button[aria-label="Ver el desglose de ${concepto}"]`)
  expect(boton.exists(), `botón de desglose de "${concepto}"`).toBe(true)
  await boton.trigger('click')
  await new Promise(r => setTimeout(r, 0))
}

describe('VentaDetalleDrawer — promociones congeladas', () => {
  it('la promo lleva su propia familia, no la de un descuento de catálogo', async () => {
    const wrapper = await montar()
    await expandir(wrapper, 'Pizza grande')

    const promo = filas(wrapper).find(f => f.includes('2x1 martes'))
    expect(promo).toBeDefined()
    // El badge de familia y el signo: resta como un descuento, pero se nombra
    // aparte. Fundirla en 'Descuento' borraría la separación promo/catálogo
    // que el motor congela en la traza.
    expect(promo).toContain('Promoción')
    expect(promo).not.toContain('Descuento')
    expect(promo).toContain('-$1.200')
  })

  it('una aplicación cross-línea baja una fila por línea, sin agruparse', async () => {
    const wrapper = await montar()
    await expandir(wrapper, 'Pizza grande')
    await expandir(wrapper, 'Pizza chica')

    const promos = filas(wrapper).filter(f => f.includes('2x1 martes'))
    // Las dos filas congeladas comparten `aplicacion: 1`, y la pantalla NO las
    // agrupa por ese campo: cada línea muestra la plata que le tocó. Agruparlas
    // dejaría una de las dos líneas sin explicar su propio total.
    expect(promos).toHaveLength(2)
    expect(promos[0]).toContain('-$1.200')
    expect(promos[1]).toContain('-$800')
    // Y no aparece la suma de la aplicación como una fila propia.
    expect(wrapper.text()).not.toContain('-$2.000')
  })

  it('dentro del paso de descuentos, la promo va después del catálogo', async () => {
    const wrapper = await montar()
    await expandir(wrapper, 'Pizza grande')

    const orden = filas(wrapper)
    const catalogo = orden.findIndex(f => f.includes('Descuento socio'))
    const promo = orden.findIndex(f => f.includes('2x1 martes'))
    expect(catalogo).toBeGreaterThan(-1)
    // Es el orden en que el motor las restó: el catálogo primero, la promo
    // encima del acumulado. Invertirlo cuenta una historia que no pasó.
    expect(promo).toBeGreaterThan(catalogo)
  })

  it('el total rotulado "Descuentos" incluye la plata de la promo', async () => {
    const wrapper = await montar()

    // 500 de catálogo + 1.200 + 800 de promo. El motor cierra las promos en el
    // mismo paso que los descuentos, así que `totalDescuentos` ya las trae
    // sumadas y el panel lo muestra tal cual.
    //
    // ⚠️ Es la regla OPUESTA a la del ticket impreso, que resta las promos del
    // agregado y las nombra en su propia línea (`ticket-builder.ts`,
    // `lineasTotalesConImpuestos`). Las dos superficies son deliberadamente
    // distintas: acá el desglose por línea ya nombra cada promo, así que
    // restarlas del total dejaría un "Descuentos" que no cuadra con nada.
    const totales = wrapper.text().split('Totales')[1] ?? ''
    expect(totales).toContain('-$2.500')
    expect(totales).not.toContain('-$500')
  })
})

describe('VentaDetalleDrawer — nota de crédito compuesta', () => {
  it('distingue las dos líneas de ajuste por su porción fiscal, que es lo único que las separa', async () => {
    documentoActual = NOTA_CREDITO as unknown as typeof VENTA
    try {
      const wrapper = await montar()
      const texto = wrapper.text()

      // El rótulo deja de decir "venta" sobre un documento que no lo es.
      expect(texto).toContain('Líneas de la nota')
      expect(texto).not.toContain('Líneas de venta')

      // Las dos filas llevan la misma glosa: sin la porción son indistinguibles.
      const lineas = filas(wrapper)
      expect(lineas).toHaveLength(2)
      expect(lineas.every(f => f.includes('Cliente insatisfecho'))).toBe(true)
      expect(lineas.some(f => f.includes('afecto'))).toBe(true)
      expect(lineas.some(f => f.includes('exento'))).toBe(true)
    }
    finally {
      documentoActual = VENTA
    }
  })

  it('en una venta normal la porción no se muestra: el nombre del ítem ya distingue', async () => {
    const wrapper = await montar()
    const lineas = filas(wrapper)
    expect(lineas.some(f => f.includes('Pizza grande'))).toBe(true)
    expect(lineas.every(f => !f.includes('afecto'))).toBe(true)
  })
})

describe('VentaDetalleDrawer — el disponible sale del backend', () => {
  it('le pasa al modal el número del backend, no uno recalculado en el navegador', async () => {
    // El drawer restaba las notas previas por su cuenta. Con este fixture eso
    // daría 7.500 (`totalFinal`, sin notas), y el backend dice 6.500: el número
    // que la emisión EXIGE es el suyo, y además da 0 cuando el documento no
    // admite nota de crédito.
    const wrapper = await montar()
    const modal = wrapper.findComponent({ name: 'VentasNotaCreditoModal' })
    expect(modal.exists()).toBe(true)
    expect(modal.props('disponible')).toBe('6500.0000')
    expect(modal.props('porPorcion')).toEqual([
      { clasificacion: 'afecto', monto: '5000.0000' },
      { clasificacion: 'exento', monto: '1500.0000' },
    ])
  })
})

describe('VentaDetalleDrawer — resincroniza lo que calcula el backend', () => {
  /**
   * Cobrar una venta pendiente CAMBIA su elegibilidad para nota de crédito, y
   * eso solo lo sabe el backend: mientras está `pendiente` devuelve disponible
   * 0. Pintar el estado nuevo en el navegador no alcanza — sin resincronizar,
   * el botón "Nota de crédito" no aparecía hasta cerrar y reabrir el drawer.
   */
  it('después de cobrar, el botón de nota de crédito aparece sin cerrar el drawer', async () => {
    documentoActual = {
      ...VENTA,
      estado: 'pendiente',
      disponibleNotaCredito: { total: '0.0000', porPorcion: [] },
    } as unknown as typeof VENTA
    const wrapper = await montar()
    const boton = () =>
      wrapper.findAll('button').find(b => b.text().trim() === 'Nota de crédito')
    expect(boton()).toBeUndefined()

    // La venta ya cobrada es lo que el backend va a devolver en la recarga.
    documentoActual = VENTA
    wrapper
      .findComponent({ name: 'PagosAbonoModal' })
      .vm.$emit('success', {
        pagos: [],
        venta: { id: 'v-1', estado: 'pagada', saldo: '0.0000' },
      })
    await new Promise(r => setTimeout(r, 20))

    expect(boton()).toBeDefined()
    documentoActual = VENTA
  })
})

/** Un documento tal como lo devuelve `GET /ventas/:id` en `documentos[]`. */
function documento(parcial: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    ventaId: 'v-1',
    emisor: 'sistema',
    tipoDocumento: { id: 'td-39', codigo: '39', nombre: 'Boleta de Venta' },
    claseMaquina: null,
    numero: null,
    estadoEnvio: 'armado',
    monto: '60000.0000',
    pagoId: null,
    documentoCorregidoId: null,
    esDuplicado: false,
    descarte: null,
    descartadoEl: null,
    descartadoPorNombre: null,
    ...parcial,
  }
}

describe('VentaDetalleDrawer — anular', () => {
  const botonAnular = (wrapper: Awaited<ReturnType<typeof montar>>) =>
    wrapper.findAll('button').find(b => b.text().trim() === 'Anular')

  /** El detalle que contesta el backend: la bandera es SUYA, el resto del fixture es de relleno. */
  async function montarCon(parcial: Record<string, unknown>) {
    documentoActual = { ...VENTA, ...parcial } as unknown as typeof VENTA
    try {
      return await montar()
    }
    finally {
      documentoActual = VENTA
    }
  }

  it('se ofrece cuando el backend dice `anulable` y el usuario tiene Ventas:Anular', async () => {
    const wrapper = await montarCon({ estado: 'pendiente', pagos: [], anulable: true })
    expect(botonAnular(wrapper)).toBeDefined()
  })

  it('el backend manda: una venta pendiente sin pagos que NO es anulable no ofrece el botón', async () => {
    // Una máquina ya emitió el voucher: el estado y los pagos darían "sí" y el
    // servidor respondería 400. Decidirlo acá con la regla de antes ofrecía el
    // botón de todos modos.
    const wrapper = await montarCon({ estado: 'pendiente', pagos: [], anulable: false })
    expect(botonAnular(wrapper)).toBeUndefined()
  })

  it('el backend manda también hacia el otro lado: `anulable` aunque el fixture traiga pagos', async () => {
    // Prueba que no se lee `pagos` ni `estado` ni `tipoDocumento` para decidir.
    const wrapper = await montarCon({
      estado: 'pagada',
      pagos: [{ nombre: 'Efectivo', monto: '7500' }],
      tipoDocumento: { id: 'td-1', codigo: '39', nombre: 'Boleta de Venta' },
      anulable: true,
    })
    expect(botonAnular(wrapper)).toBeDefined()
  })

  it('sin el permiso Ventas:Anular no se ofrece, aunque el backend diga `anulable`', async () => {
    permisos = ['Ventas:Nota de crédito']
    const wrapper = await montarCon({ estado: 'pendiente', pagos: [], anulable: true })
    expect(botonAnular(wrapper)).toBeUndefined()
  })

  it('le pasa al modal lo que el backend dijo de la pregunta por el documento hecho por fuera', async () => {
    const wrapper = await montarCon({
      estado: 'pendiente',
      pagos: [],
      anulable: true,
      anularPreguntaExterno: true,
      tipoDocumento: { id: 'td-33', codigo: '33', nombre: 'Factura', esBoleta: false },
      documentos: [documento({
        id: 'doc-ext',
        emisor: 'externo',
        tipoDocumento: { id: 'td-33', codigo: '33', nombre: 'Factura' },
        estadoEnvio: null,
      })],
    })
    const modal = wrapper.findComponent({ name: 'VentasAnularVentaModal' })
    expect(modal.props('preguntaExterno')).toBe(true)
    expect(modal.props('esBoleta')).toBe(false)
  })

  it('el sustantivo de la pregunta sale de `esBoleta` del backend, no del nombre del tipo', async () => {
    // Un tipo llamado "Factura" que el catálogo marca boleta: manda el flag.
    const wrapper = await montarCon({
      estado: 'pendiente',
      pagos: [],
      anulable: true,
      anularPreguntaExterno: true,
      tipoDocumento: { id: 'td-x', codigo: '39', nombre: 'Factura', esBoleta: true },
    })
    expect(wrapper.findComponent({ name: 'VentasAnularVentaModal' }).props('esBoleta')).toBe(true)
  })
})

describe('VentaDetalleDrawer — documentos', () => {
  async function montarCon(documentos: unknown[], extra: Record<string, unknown> = {}) {
    documentoActual = { ...VENTA, documentos, ...extra } as unknown as typeof VENTA
    try {
      return await montar()
    }
    finally {
      documentoActual = VENTA
    }
  }

  const seccion = (wrapper: Awaited<ReturnType<typeof montar>>) => wrapper.find('[data-qa="documentos"]')
  const fila = (wrapper: Awaited<ReturnType<typeof montar>>, id: string) => wrapper.find(`[data-qa="documento-${id}"]`)
  const botonCompletar = (wrapper: Awaited<ReturnType<typeof montar>>, id: string) =>
    fila(wrapper, id).find('[data-qa="completar-numero"]')

  const VOUCHER = documento({
    id: 'doc-m',
    emisor: 'maquina',
    tipoDocumento: null,
    claseMaquina: 'voucher',
    numero: '445566',
    estadoEnvio: null,
    monto: '40000.0000',
  })
  const SIN_NUMERO = documento({
    id: 'doc-m2',
    emisor: 'maquina',
    tipoDocumento: null,
    claseMaquina: null,
    estadoEnvio: null,
    monto: '25000.0000',
  })
  const POR_FUERA = documento({
    id: 'doc-ext',
    emisor: 'externo',
    tipoDocumento: { id: 'td-33', codigo: '33', nombre: 'Factura' },
    estadoEnvio: null,
    monto: '119000.0000',
  })

  it('una venta sin documentos dice "Sin documento"', async () => {
    const wrapper = await montarCon([])

    expect(seccion(wrapper).text()).toContain('Sin documento')
  })

  it('cada documento dice quién lo emitió, el tipo o la clase, el número y el monto', async () => {
    const wrapper = await montarCon([VOUCHER, POR_FUERA, documento({ id: 'doc-s' })])

    const voucher = fila(wrapper, 'doc-m').text()
    expect(voucher).toContain('La máquina · Voucher')
    expect(voucher).toContain('N° 445566')
    expect(voucher).toContain('40.000')
    const fuera = fila(wrapper, 'doc-ext').text()
    expect(fuera).toContain('Hecho por fuera · Factura')
    expect(fuera).toContain('Sin número')
    expect(fuera).toContain('119.000')
    expect(fila(wrapper, 'doc-s').text()).toContain('El sistema · Boleta de Venta')
  })

  it('un documento del sistema dice que está armado y no salió al SII', async () => {
    const wrapper = await montarCon([documento({ id: 'doc-s' })])

    expect(fila(wrapper, 'doc-s').text()).toContain('Armado, sin enviar al SII')
  })

  it('el voucher duplicado lleva la marca para el contador', async () => {
    const wrapper = await montarCon([
      VOUCHER,
      documento({ ...SIN_NUMERO, id: 'doc-dup', esDuplicado: true }),
    ])

    expect(fila(wrapper, 'doc-dup').text()).toContain('Duplicado — para el contador')
    expect(fila(wrapper, 'doc-m').text()).not.toContain('Duplicado')
  })

  it('un descartado al anular lo dice, y quien afirmó que no estaba hecho queda anotado', async () => {
    const wrapper = await montarCon([
      documento({ id: 'doc-s', descarte: 'armado_sin_enviar', descartadoEl: '2026-10-02T15:00:00.000Z' }),
      documento({
        ...POR_FUERA,
        id: 'doc-ext',
        descarte: 'afirmado_no_hecho',
        descartadoEl: '2026-10-02T15:00:00.000Z',
        descartadoPorNombre: 'Ana Torres',
      }),
    ])

    expect(fila(wrapper, 'doc-s').text()).toContain('Descartado al anular')
    // El de armado nunca dice "dijo que no estaba hecho": nadie lo afirmó.
    expect(fila(wrapper, 'doc-s').text()).not.toContain('dijo que no estaba hecho')
    const fuera = fila(wrapper, 'doc-ext').text()
    expect(fuera).toContain('Descartado al anular')
    expect(fuera).toContain('Ana Torres dijo que no estaba hecho,')
  })

  it('una corrección dice qué documento corrige', async () => {
    const wrapper = await montarCon([
      VOUCHER,
      documento({
        id: 'doc-nc',
        ventaId: 'nc-1',
        emisor: 'maquina',
        tipoDocumento: null,
        claseMaquina: null,
        estadoEnvio: null,
        documentoCorregidoId: 'doc-m',
        monto: '10000.0000',
      }),
    ])

    expect(fila(wrapper, 'doc-nc').text()).toContain('Corrige: La máquina · Voucher · N° 445566')
  })

  describe('Completar número', () => {
    it('se ofrece en el de la máquina y en el hecho por fuera sin número, no en el resto', async () => {
      const wrapper = await montarCon([
        VOUCHER,
        SIN_NUMERO,
        POR_FUERA,
        documento({ id: 'doc-s' }),
        documento({ ...POR_FUERA, id: 'doc-desc', descarte: 'afirmado_no_hecho' }),
      ])

      expect(botonCompletar(wrapper, 'doc-m2').exists()).toBe(true)
      expect(botonCompletar(wrapper, 'doc-ext').exists()).toBe(true)
      // Ya tiene número, es del sistema, o fue descartado (el backend daría 404).
      expect(botonCompletar(wrapper, 'doc-m').exists()).toBe(false)
      expect(botonCompletar(wrapper, 'doc-s').exists()).toBe(false)
      expect(botonCompletar(wrapper, 'doc-desc').exists()).toBe(false)
    })

    it('sin Ventas:Crear no se ofrece: el PATCH daría 403', async () => {
      esAdmin = false
      permisos = ['Ventas:Anular']
      const wrapper = await montarCon([SIN_NUMERO])

      expect(botonCompletar(wrapper, 'doc-m2').exists()).toBe(false)
    })

    it('con Ventas:Crear (un rol que no es admin) se ofrece', async () => {
      esAdmin = false
      permisos = ['Ventas:Crear']
      const wrapper = await montarCon([SIN_NUMERO])

      expect(botonCompletar(wrapper, 'doc-m2').exists()).toBe(true)
    })

    async function completar(
      wrapper: Awaited<ReturnType<typeof montar>>,
      id: string,
      numero: string,
    ) {
      await botonCompletar(wrapper, id).trigger('click')
      await new Promise(r => setTimeout(r, 20))
      const input = fila(wrapper, id).find('[data-qa="comprobante-numero"]')
      expect(input.exists(), 'el campo del número').toBe(true)
      await input.setValue(numero)
      await fila(wrapper, id).find('[data-qa="guardar-numero"]').trigger('click')
      await new Promise(r => setTimeout(r, 30))
    }

    it('anota el número con el PATCH y el documento queda con él', async () => {
      respuestaPatch = { ...SIN_NUMERO, numero: '778899' }
      const wrapper = await montarCon([VOUCHER, SIN_NUMERO])
      // Lo que el backend devolverá en la recarga posterior.
      documentoActual = { ...VENTA, documentos: [VOUCHER, { ...SIN_NUMERO, numero: '778899' }] } as unknown as typeof VENTA
      try {
        await completar(wrapper, 'doc-m2', '  778899  ')
      }
      finally {
        documentoActual = VENTA
      }

      expect(patches).toHaveLength(1)
      expect(patches[0]!.url).toContain('/ventas/v-1/documentos/doc-m2')
      // Sin clase: el cajero no la eligió, no se manda `null`.
      expect(patches[0]!.body).toEqual({ numero: '778899' })
      expect(fila(wrapper, 'doc-m2').text()).toContain('N° 778899')
      expect(botonCompletar(wrapper, 'doc-m2').exists()).toBe(false)
    })

    it('la ruta lleva la venta DEL DOCUMENTO: el de una corrección es de la corrección', async () => {
      const deLaNota = documento({
        id: 'doc-nc',
        ventaId: 'nc-1',
        emisor: 'externo',
        tipoDocumento: { id: 'td-61', codigo: '61', nombre: 'Nota de crédito' },
        estadoEnvio: null,
        documentoCorregidoId: 'doc-ext',
      })
      respuestaPatch = { ...deLaNota, numero: '9' }
      const wrapper = await montarCon([POR_FUERA, deLaNota])

      await completar(wrapper, 'doc-nc', '9')

      expect(patches).toHaveLength(1)
      // Con el id de la venta que se mira (`v-1`) el servidor respondería 404.
      expect(patches[0]!.url).toContain('/ventas/nc-1/documentos/doc-nc')
      expect(patches[0]!.url).not.toContain('/ventas/v-1/')
    })

    it('un documento hecho por fuera no ofrece la clase: el servidor respondería 400', async () => {
      const wrapper = await montarCon([POR_FUERA, SIN_NUMERO])

      // Se edita un documento a la vez: abrir el segundo cierra el primero.
      await botonCompletar(wrapper, 'doc-ext').trigger('click')
      await new Promise(r => setTimeout(r, 20))
      expect(fila(wrapper, 'doc-ext').find('[data-qa="comprobante-numero"]').exists()).toBe(true)
      expect(fila(wrapper, 'doc-ext').find('[data-qa="comprobante-clase"]').exists()).toBe(false)

      // El de la máquina sí: la clase se puede indicar acá también.
      await botonCompletar(wrapper, 'doc-m2').trigger('click')
      await new Promise(r => setTimeout(r, 20))
      expect(fila(wrapper, 'doc-m2').find('[data-qa="comprobante-clase"]').exists()).toBe(true)
    })

    it('después de anotar el número se resincroniza: lo que decide `anulable` lo dice el backend', async () => {
      respuestaPatch = { ...POR_FUERA, numero: '77' }
      const wrapper = await montarCon([POR_FUERA], {
        estado: 'pendiente', pagos: [], anulable: true, anularPreguntaExterno: true,
      })
      expect(wrapper.findComponent({ name: 'VentasAnularVentaModal' }).props('preguntaExterno')).toBe(true)

      // Con número, anular ya no pregunta: va por nota de crédito.
      documentoActual = {
        ...VENTA,
        estado: 'pendiente',
        pagos: [],
        anulable: false,
        anularPreguntaExterno: false,
        documentos: [{ ...POR_FUERA, numero: '77' }],
      } as unknown as typeof VENTA
      try {
        await completar(wrapper, 'doc-ext', '77')
      }
      finally {
        documentoActual = VENTA
      }

      expect(wrapper.findComponent({ name: 'VentasAnularVentaModal' }).props('preguntaExterno')).toBe(false)
      expect(wrapper.findAll('button').find(b => b.text().trim() === 'Anular')).toBeUndefined()
    })
  })

  it('al anular, los documentos se vuelven a pedir: el descarte lo escribe el backend', async () => {
    const wrapper = await montarCon(
      [documento({ id: 'doc-s' })],
      { estado: 'pendiente', pagos: [], anulable: true },
    )
    expect(fila(wrapper, 'doc-s').text()).not.toContain('Descartado al anular')

    // Lo que el backend devuelve después de anular: el armado quedó descartado.
    documentoActual = {
      ...VENTA,
      estado: 'cancelada',
      documentos: [documento({ id: 'doc-s', descarte: 'armado_sin_enviar', descartadoEl: '2026-10-02T15:00:00.000Z' })],
    } as unknown as typeof VENTA
    try {
      wrapper.findComponent({ name: 'VentasAnularVentaModal' }).vm.$emit('success', { estado: 'cancelada' })
      await new Promise(r => setTimeout(r, 30))
    }
    finally {
      documentoActual = VENTA
    }

    expect(fila(wrapper, 'doc-s').text()).toContain('Descartado al anular')
  })

  it('le pasa al abono lo que el backend dijo sobre el voucher duplicado', async () => {
    const wrapper = await montarCon([], { abonoConMaquinaDuplica: true })

    expect(wrapper.findComponent({ name: 'PagosAbonoModal' }).props('abonoConMaquinaDuplica')).toBe(true)
  })
})

describe('VentaDetalleDrawer — reimprimir boleta', () => {
  /** El botón de "Reimprimir boleta", si está presente. */
  function botonReimprimir(wrapper: Awaited<ReturnType<typeof montar>>) {
    return wrapper.findAll('button').find(b => b.text().trim() === 'Reimprimir boleta')
  }

  it('no aparece sin el permiso Ventas:Anular', async () => {
    permisos = ['Ventas:Nota de crédito']
    try {
      const wrapper = await montar()
      expect(botonReimprimir(wrapper)).toBeUndefined()
    }
    finally {
      permisos = ['Ventas:Anular', 'Ventas:Nota de crédito']
    }
  })

  it('aparece con el permiso Ventas:Anular — el mismo que exige la ruta', async () => {
    const wrapper = await montar()
    expect(botonReimprimir(wrapper)).toBeDefined()
  })

  /**
   * Caja mínima para `cajaStore.activa` — solo los campos que
   * `puedeReimprimir` y el tipo `Caja` (`~/stores/caja.ts`) exigen. `id` por
   * default coincide con `VENTA.cajaId` ('caja-1'); un test de "otra caja" lo
   * pisa.
   */
  function cajaActiva(estado: string, id = 'caja-1') {
    return {
      id,
      tenantId: 'tenant-1',
      usuarioId: 'user-1',
      tipo: 'fisica',
      estado,
      saldoInicial: '10000.0000',
      saldoFinal: null,
      montoContado: null,
      diferencia: null,
      fechaApertura: '2026-09-30T12:00:00.000Z',
      fechaCierre: null,
      comentario: null,
      cajonId: 'cajon-1',
      cajonNombre: 'Caja 1',
    }
  }

  /**
   * Gemelo exacto del backend (`VentasService.exigirCajaPropiaAbierta`, owner
   * 2026-09-30): sin `Ventas:Anular`, la cajera reimprime SOLO la boleta de su
   * propia caja FÍSICA abierta. Los tres casos —propia y abierta, de otra
   * caja, propia pero en conciliación— son el gemelo de los tres que fija el
   * e2e del backend (`boleta-reimpresion.e2e-spec.ts`).
   */
  describe('camino angosto: sin Ventas:Anular, con la caja propia', () => {
    it('aparece si la venta es de su caja y esa caja está abierta', async () => {
      permisos = ['Ventas:Nota de crédito']
      useCajaStore().activa = cajaActiva('abierta')
      try {
        const wrapper = await montar()
        expect(botonReimprimir(wrapper)).toBeDefined()
      }
      finally {
        permisos = ['Ventas:Anular', 'Ventas:Nota de crédito']
      }
    })

    it('no aparece si la venta es de OTRA caja', async () => {
      permisos = ['Ventas:Nota de crédito']
      useCajaStore().activa = cajaActiva('abierta', 'caja-2')
      try {
        const wrapper = await montar()
        expect(botonReimprimir(wrapper)).toBeUndefined()
      }
      finally {
        permisos = ['Ventas:Anular', 'Ventas:Nota de crédito']
      }
    })

    /**
     * `en_conciliacion` sigue "ocupando" al cajero (`CajaService.findActiva`)
     * pero NO cuenta como abierta para operar — mismo corte que
     * `CajaService.bloquearCajaAbierta` y que la capa angosta del backend
     * (`exigirCajaPropiaAbierta`). Mutante: sacar `cajaStore.activa?.estado
     * === 'abierta'` de `puedeReimprimir` hace este test rojo (el botón
     * aparecería igual, porque el resto de la condición — misma caja — sigue
     * cumpliéndose).
     */
    it('no aparece si su propia caja está en conciliación', async () => {
      permisos = ['Ventas:Nota de crédito']
      useCajaStore().activa = cajaActiva('en_conciliacion')
      try {
        const wrapper = await montar()
        expect(botonReimprimir(wrapper)).toBeUndefined()
      }
      finally {
        permisos = ['Ventas:Anular', 'Ventas:Nota de crédito']
      }
    })
  })

  /**
   * Solo una venta pagada o anulada se reimprime (owner, 2026-09-18): la ruta
   * contesta 400 a la que todavía no se cobró del todo. La `pagada` es el
   * control de arriba; la `cancelada`, el de más abajo.
   */
  it.each(['pendiente', 'pagada_parcial'])('no aparece en una venta %s', async (estado) => {
    documentoActual = { ...VENTA, estado } as unknown as typeof VENTA
    try {
      const wrapper = await montar()
      expect(botonReimprimir(wrapper)).toBeUndefined()
    }
    finally {
      documentoActual = VENTA
    }
  })

  it('en una venta anulada aparece e imprime COPIA y ANULADA', async () => {
    impresionesQz.length = 0
    documentoActual = { ...VENTA, estado: 'cancelada' } as unknown as typeof VENTA
    boletaActual = { ...BOLETA_REIMPRESION, estado: 'cancelada' }
    try {
      const wrapper = await montar()
      const boton = botonReimprimir(wrapper)
      expect(boton, 'el botón está presente').toBeDefined()

      await boton!.trigger('click')
      await new Promise(r => setTimeout(r, 50))

      expect(impresionesQz, 'la boleta se imprimió').toHaveLength(1)
      const texto = impresionesQz[0]!.join('')
      expect(texto).toContain('COPIA')
      expect(texto).toContain('ANULADA')
    }
    finally {
      documentoActual = VENTA
      boletaActual = BOLETA_REIMPRESION
    }
  })

  /**
   * Al apretarlo pide `GET /ventas/:id/boleta` (no reusa el detalle que el
   * drawer ya tiene, que no trae la venta persistida con la que se cobró) e
   * imprime CON la marca de copia. La aserción es sobre el TEXTO que termina
   * impreso (`impresionesQz`, vía el mock de `qz-tray`), no sobre
   * `itemsParaBoletaReimpresion` como objeto intermedio — mismo criterio que
   * `pos.nuxt.spec.ts` para el mismo bug de origen (un objeto intermedio
   * correcto no prueba que el texto impreso lo sea).
   */
  it('al apretarlo pide la boleta de la venta e imprime con COPIA y su contenido', async () => {
    impresionesQz.length = 0
    const wrapper = await montar()
    const boton = botonReimprimir(wrapper)
    expect(boton, 'el botón está presente').toBeDefined()

    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 50))

    expect(impresionesQz, 'la boleta se imprimió').toHaveLength(1)
    const texto = impresionesQz[0]!.join('')
    expect(texto).toContain('COPIA')
    expect(texto, 'una venta pagada no sale ANULADA').not.toContain('ANULADA')
    expect(texto).toContain('Pizza grande')
    expect(texto).toContain('Ana Torres')
  })

  /**
   * El agujero que encontró la revisión de toda la rama: `reimprimirBoleta()`
   * no le pasaba `cliente` a `imprimirBoleta` en absoluto, aunque el drawer ya
   * tiene `venta.customer` en memoria (se pinta en pantalla, arriba). Una
   * venta con cliente registrado imprimía nombre/RUT al cobrar y los perdía
   * al reimprimirse como COPIA — el papel reimpreso mentía respecto al
   * original. La boleta trae ahora su PROPIO `customer` (`boleta.customer`,
   * no `venta.customer`): mismo criterio que el resto de esta función, que ya
   * imprime `boleta.items`/`boleta.pagos` y no los del detalle en memoria.
   */
  it('imprime el nombre y el RUT del cliente cuando la boleta trae uno', async () => {
    impresionesQz.length = 0
    boletaActual = {
      ...BOLETA_REIMPRESION,
      customer: { nombre: 'María González', rut: '12.345.678-9', direccion: 'Los Aromos 456' },
    }
    try {
      const wrapper = await montar()
      const boton = botonReimprimir(wrapper)
      expect(boton, 'el botón está presente').toBeDefined()

      await boton!.trigger('click')
      await new Promise(r => setTimeout(r, 50))

      expect(impresionesQz, 'la boleta se imprimió').toHaveLength(1)
      const texto = impresionesQz[0]!.join('')
      expect(texto, 'imprime el nombre del cliente').toContain('María González')
      expect(texto, 'imprime el RUT del cliente').toContain('12.345.678-9')
    }
    finally {
      boletaActual = BOLETA_REIMPRESION
    }
  })
})
