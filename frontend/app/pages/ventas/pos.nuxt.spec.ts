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
/** Override de la `boleta` que devuelve `POST /ventas`; `null` = no se llegó a pedir. */
let ventaBoletaMock: Record<string, unknown> | null = null
/** Cada body de `POST /ventas` recibido. */
let bodiesDeVenta: Record<string, unknown>[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const ruta = url.split('?')[0] ?? ''

    if (ruta.endsWith('/caja/activa')) {
      // Sin caja abierta: la pantalla igual dispara `cargar()` en paralelo
      // (`Promise.all` de `onMounted`), así que el catálogo se pide de todos
      // modos — es justo lo que este spec necesita. `VentasCobroModal` tampoco
      // depende de la caja: vive fuera del `v-else` que la exige.
      return Promise.resolve(null)
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
      return Promise.resolve({
        estado: 'pagada',
        advertencias: [],
        boleta: ventaBoletaMock,
      })
    }
    // El resto del arranque (métodos de pago, tipos de documento, unidades de
    // medida, razones sociales del emisor, propina sugerida, certificado QZ)
    // no interviene en este flujo.
    return Promise.resolve([])
  }
})

let toasts: { title?: string, color?: string }[] = []
mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: { title?: string, color?: string }) => {
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
  ventaBoletaMock = null
  bodiesDeVenta = []
  toasts = []
  impresionesQz.length = 0
})

async function montar() {
  const wrapper = await mountSuspended(Pos)
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
})
