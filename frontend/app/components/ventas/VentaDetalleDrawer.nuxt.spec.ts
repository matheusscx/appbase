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
import { describe, it, expect } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import VentaDetalleDrawer from './VentaDetalleDrawer.vue'

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

/** Qué documento contesta el mock. Se cambia ANTES de montar. */
let documentoActual: typeof VENTA = VENTA

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

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
