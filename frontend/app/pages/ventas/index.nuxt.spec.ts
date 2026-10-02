// @vitest-environment nuxt
//
// Único spec de esta pantalla. Fija una sola cosa: al montar, `/ventas` pide
// `GET /caja/activa` — la revisión independiente del frente de impresión
// encontró que esta pantalla nunca la cargaba (solo lo hacían `pos.vue`,
// `salones/index.vue` y `mi-caja`), así que `VentaDetalleDrawer.puedeReimprimir`
// —el camino sin `Ventas:Anular`, que mira `cajaStore.activa`— nunca veía la
// caja propia para una cajera que entra directo a `/ventas` sin pasar antes
// por el POS o salones: el botón "Reimprimir boleta" no aparecía aunque el
// backend ya se lo permitiera. Mismo molde que `salones/index.vue` (~1128):
// `cajaStore.cargarActiva()` con `.catch()` propio, porque `GET /caja/activa`
// pide `MiCaja:Leer` y este listado solo exige `Ventas:Leer` — sin el catch,
// un rol sin ese permiso (o sin caja abierta) rompería la carga.
//
// Segundo frente (el vendido neto de notas de crédito): `/ventas/resumen` trae
// `totalFacturado` NETO más `totalBruto` y `totalNotasCredito`. Bajo "Total
// facturado" va `bruto $X · notas de crédito −$Y`, solo si hay notas; y cuando
// el drawer avisa un cambio (`updated`), la pantalla vuelve a pedir el resumen
// en vez de parchar el saldo con el de la fila (una NC o una anulación mueven
// el resumen distinto de lo que mueve el `saldo` de la fila).
import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import VentasIndex from './index.vue'

const llamadas: string[] = []

// Sin moneda oficial hidratada `formatMonto` rinde "—": se hidrata a mano tras
// montar, como `InicioHoy.nuxt.spec.ts`.
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

const RESUMEN_CON_NOTAS = {
  totalVentas: 12,
  totalFacturado: '280000.0000',
  totalBruto: '300000.0000',
  totalNotasCredito: '20000.0000',
  saldoPendiente: '45000.0000',
}
// Para ejercer lo que pasa MIENTRAS el resumen está en vuelo: con `retener` las
// respuestas de `/ventas/resumen` no salen hasta que el test las libera.
let retener = false
let enVuelo: { liberar: () => void }[] = []
let resumenRespuesta: Record<string, unknown> = {
  totalVentas: 0,
  totalFacturado: '0.0000',
  totalBruto: '0.0000',
  totalNotasCredito: '0.0000',
  saldoPendiente: '0.0000',
}

const llamadasResumen = () => llamadas.filter(u => u.includes('/ventas/resumen')).length

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    llamadas.push(url)
    if (url.includes('/ventas/resumen')) {
      if (retener) {
        const respuesta = resumenRespuesta
        return new Promise((resolve) => {
          enVuelo.push({ liberar: () => resolve(respuesta) })
        })
      }
      return Promise.resolve(resumenRespuesta)
    }
    if (url.includes('/caja/activa')) {
      // 403 real de `MiCaja:Leer`: es el caso que el `.catch` de la pantalla
      // tiene que absorber sin romper el resto del montaje.
      return Promise.reject({ data: { message: 'No tienes permiso para esta acción' } })
    }
    if (url.includes('/ventas')) {
      return Promise.resolve({ data: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
    }
    return Promise.resolve([])
  }
})

/**
 * El drawer también se stubea: lo único que esta pantalla le pide es que emita
 * `updated`, y el stub lo emite con un botón. El `id` no está en la lista (que
 * va vacía): el resumen se vuelve a pedir igual, porque la NC o la anulación
 * pudo haber tocado una venta de otra página.
 */
const DrawerStub = defineComponent({
  name: 'VentasVentaDetalleDrawer',
  props: ['open', 'ventaId'],
  emits: ['updated', 'update:open'],
  template: `<button data-test="emitir-updated" @click="$emit('updated', { id: 'venta-x', estado: 'pagada', montoPagado: '1', saldo: '0' })">emitir</button>`,
})

/**
 * `AppDrawer` stubeado por el mismo motivo que `inventario/index.nuxt.spec.ts`
 * y `configuracion/garzones.nuxt.spec.ts`: su root es `UDrawer` (reka-ui) y
 * bajo happy-dom la transición de `usePresence` puede tirar un unhandled
 * rejection que saca a `vitest run` con exit 1. Este spec nunca abre el
 * drawer, pero el stub va igual — barato y evita depender de ese detalle.
 */
const AppDrawerStub = {
  name: 'AppDrawer',
  props: ['open'],
  template: `
    <div v-if="open" role="dialog">
      <slot name="header" />
      <slot name="body" />
      <slot name="actions" />
    </div>
  `,
}

async function montar() {
  const wrapper = await mountSuspended(VentasIndex, {
    attachTo: document.body,
    global: {
      stubs: {
        VentasVentaDetalleDrawer: DrawerStub,
        AppDrawer: AppDrawerStub,
      },
    },
  })
  useMonedasStore().hydrate([CLP], 'tenant-1')
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

beforeEach(() => {
  llamadas.length = 0
  document.body.innerHTML = ''
  retener = false
  enVuelo = []
  resumenRespuesta = {
    totalVentas: 0,
    totalFacturado: '0.0000',
    totalBruto: '0.0000',
    totalNotasCredito: '0.0000',
    saldoPendiente: '0.0000',
  }
})

describe('ventas/index — carga la caja activa al montar', () => {
  it('pide GET /caja/activa', async () => {
    await montar()
    expect(llamadas.some(u => u.includes('/caja/activa'))).toBe(true)
  })

  it('un 403 de /caja/activa (rol sin MiCaja:Leer) no rompe el resto del montaje', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Ventas registradas')
  })
})

describe('ventas/index — el Total facturado es neto y muestra su desglose', () => {
  it('con notas de crédito, bajo "Total facturado" se ve bruto y notas de crédito', async () => {
    resumenRespuesta = RESUMEN_CON_NOTAS
    const wrapper = await montar()

    expect(wrapper.text()).toContain('bruto')
    expect(wrapper.text()).toContain('notas de crédito −')
    // Los tres montos distintos entre sí: el neto grande, el bruto y las notas en la línea.
    expect(wrapper.text()).toContain('$280.000')
    expect(wrapper.text()).toContain('$300.000')
    expect(wrapper.text()).toContain('$20.000')
  })

  it('sin notas de crédito, la línea no está', async () => {
    resumenRespuesta = { ...RESUMEN_CON_NOTAS, totalNotasCredito: '0.0000', totalBruto: '280000.0000' }
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Total facturado')
    expect(wrapper.text()).not.toContain('bruto')
    expect(wrapper.text()).not.toContain('notas de crédito')
  })
})

describe('ventas/index — el drawer avisa un cambio', () => {
  it('vuelve a pedir /ventas/resumen en vez de parchar el saldo', async () => {
    resumenRespuesta = RESUMEN_CON_NOTAS
    const wrapper = await montar()
    expect(llamadasResumen()).toBe(1)

    await wrapper.find('[data-test="emitir-updated"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(llamadasResumen()).toBe(2)
  })
})

describe('ventas/index — recargar el resumen no parpadea ni pisa lo nuevo con lo viejo', () => {
  const NUEVO = {
    ...RESUMEN_CON_NOTAS,
    totalFacturado: '263000.0000',
    totalBruto: '300000.0000',
    totalNotasCredito: '37000.0000',
  }
  const esperar = () => new Promise(r => setTimeout(r, 20))

  it('mientras llega la respuesta nueva se ve el valor anterior (sin "—"), y después el nuevo', async () => {
    resumenRespuesta = RESUMEN_CON_NOTAS
    const wrapper = await montar()
    expect(wrapper.text()).toContain('$280.000')

    retener = true
    resumenRespuesta = NUEVO
    await wrapper.find('[data-test="emitir-updated"]').trigger('click')
    await esperar()

    expect(enVuelo).toHaveLength(1)
    expect(wrapper.text()).toContain('$280.000')
    expect(wrapper.text()).not.toContain('—')

    enVuelo[0]!.liberar()
    await esperar()

    expect(wrapper.text()).toContain('$263.000')
    expect(wrapper.text()).not.toContain('$280.000')
  })

  it('la carga inicial sí muestra "—" mientras no hay resumen', async () => {
    retener = true
    const wrapper = await montar()

    expect(wrapper.text()).toMatch(/Total facturado\s+—/)

    enVuelo[0]!.liberar()
  })

  it('si la respuesta más vieja llega última, no pisa a la más nueva', async () => {
    resumenRespuesta = RESUMEN_CON_NOTAS
    const wrapper = await montar()

    retener = true
    // Primera recarga: devolvería lo viejo. Segunda: lo nuevo.
    await wrapper.find('[data-test="emitir-updated"]').trigger('click')
    resumenRespuesta = NUEVO
    await wrapper.find('[data-test="emitir-updated"]').trigger('click')
    await esperar()
    expect(enVuelo).toHaveLength(2)

    enVuelo[1]!.liberar()
    await esperar()
    enVuelo[0]!.liberar()
    await esperar()

    expect(wrapper.text()).toContain('$263.000')
    expect(wrapper.text()).not.toContain('$280.000')
  })
})
