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
import { describe, it, expect, vi } from 'vitest'
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

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

/** La boleta que devuelve `GET /ventas/:id/boleta`. Se cambia ANTES de montar. */
let boletaActual: Record<string, unknown> | null = BOLETA_REIMPRESION
/** Impresoras de rol `boleta`; vacío = `imprimirBoleta` no llama a QZ. */
let impresorasBoleta: unknown[] = [IMPRESORA_BOLETA]

/**
 * ⚠️ El fallback devuelve `[]`, **no `null`**. El drawer dispara
 * `unidadesStore.ensureLoaded()`, que asigna al store lo que venga: con `null`
 * el store queda en `null` y explota más tarde dentro de una `computed`, como
 * unhandled rejection. Medido: `vitest run` sale con **exit 1** y los 4 tests
 * en rojo por una URL que a este spec ni le importa.
 */
mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve([])
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
    if (url.split('?')[0]!.endsWith('/impresoras')) return Promise.resolve(impresorasBoleta)
    if (url.includes('/tenants/razones-sociales')) return Promise.resolve([RAZON_SOCIAL])
    if (url.includes('/ventas/')) return Promise.resolve(structuredClone(documentoActual))
    return Promise.resolve([])
  }
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
    expect(texto).toContain('Pizza grande')
    expect(texto).toContain('Ana Torres')
  })
})
