// @vitest-environment nuxt
//
// Tarea 7 del plan del reporte de varianza (spec § 8). Lo que este spec fija:
//   1. La fila `medible: false` muestra "falta contarlo" y NINGÚN número: un
//      cero ahí se leería como "cerró perfecto".
//   2. «Otros» en cero va apagado (`text-muted`) y sin botón; distinto de cero
//      va en color de alerta con un `AppInfoButton` en lenguaje del local.
//   3. La columna «Otros» NO se esconde aunque todas las filas den cero.
//   4. Lo que no se pudo medir sale como dos números: sin contar y a medio contar.
//   5. El resumen NO recibe `soloConVarianza`: su DTO no lo declara y el pipe
//      global lo borraría callado (`whitelist` sin `forbidNonWhitelisted`:
//      medido contra el backend real, 200). Mandarlo haría creer que los
//      totales siguen la llave.
//   6. Con bodegas, el primer resumen sale una sola vez y ya filtrado al local.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Varianza from './varianza.vue'

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

function fila(over: Record<string, unknown>) {
  return {
    itemId: 'item-x',
    itemNombre: 'X',
    unidadMedida: 'kg',
    ubicacionId: 'ub-local',
    ubicacionNombre: 'Local',
    medible: true,
    desdeEl: '2026-09-02T12:00:00.000Z',
    hastaEl: '2026-09-20T12:00:00.000Z',
    recuentoInicialId: 'r1',
    recuentoFinalId: 'r2',
    teorico: '10.0000',
    merma: '1.0000',
    cortesia: '0.0000',
    sinExplicacion: '3.0000',
    otros: '0.0000',
    costoSinExplicacion: [{ monedaId: 'clp-1', monto: '750.0000' }],
    faltaCosto: false,
    ...over,
  }
}

let listado: ReturnType<typeof fila>[] = []

const RESUMEN = {
  totales: {
    teorico: [{ monedaId: 'clp-1', monto: '5000.0000' }],
    merma: [{ monedaId: 'clp-1', monto: '400.0000' }],
    cortesia: [],
    sinExplicacion: [{ monedaId: 'clp-1', monto: '750.0000' }],
    otros: [],
  },
  top: [],
  fueraDelTop: 0,
  faltaCosto: false,
  sinConteo: {
    nuncaContado: { total: 2, items: [{ itemId: 'a', nombre: 'Aceite' }, { itemId: 'b', nombre: 'Azúcar' }] },
    contadoUnaSolaVez: { total: 1, items: [{ itemId: 'c', nombre: 'Café' }] },
  },
}

let llamadas: string[] = []
const LOCAL = { id: 'ub-local', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'ub-bodega', nombre: 'Bodega', tipo: 'bodega', activo: true }
let ubicacionesBackend: typeof LOCAL[] = [LOCAL]

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve({})
    llamadas.push(url)
    if (url.includes('/tenants/me')) {
      return Promise.resolve({ horaCorte: 0, diaNegocioHoy: '2026-09-21' })
    }
    if (url.includes('/ubicaciones')) {
      return Promise.resolve(ubicacionesBackend)
    }
    // '/reportes/varianza/resumen' también matchea '/reportes/varianza': primero el resumen.
    if (url.includes('/reportes/varianza/resumen')) return Promise.resolve(RESUMEN)
    if (url.includes('/reportes/varianza')) {
      return Promise.resolve({
        data: listado,
        meta: { page: 1, pageSize: 15, total: listado.length, totalPages: 1 },
      })
    }
    return Promise.resolve({})
  }
})

async function montar() {
  const wrapper = await mountSuspended(Varianza, { attachTo: document.body })
  useMonedasStore().hydrate([CLP], 'tenant-1')
  await new Promise(r => setTimeout(r, 30))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

function filaDe(wrapper: Wrapper, nombre: string) {
  const tr = wrapper.findAll('tbody tr').find(f => f.text().includes(nombre))
  expect(tr, `fila de "${nombre}"`).toBeTruthy()
  return tr!
}

beforeEach(() => {
  llamadas = []
  ubicacionesBackend = [LOCAL]
  listado = [
    fila({ itemId: 'harina', itemNombre: 'Harina' }),
    fila({ itemId: 'queso', itemNombre: 'Queso', otros: '2.0000' }),
    fila({
      itemId: 'tomate',
      itemNombre: 'Tomate',
      medible: false,
      hastaEl: null,
      recuentoFinalId: null,
      teorico: null,
      merma: null,
      cortesia: null,
      sinExplicacion: null,
      otros: null,
      costoSinExplicacion: [],
    }),
  ]
})

describe('varianza — tabla', () => {
  it('la fila que no se puede medir dice "falta contarlo" y no muestra números', async () => {
    const wrapper = await montar()
    const tr = filaDe(wrapper, 'Tomate')
    expect(tr.text()).toContain('falta contarlo')
    // Ni cantidades ni plata: la única cifra permitida es la fecha de la ventana.
    const celdas = tr.findAll('td').map(td => td.text())
    expect(celdas.some(c => /\$|kg/.test(c))).toBe(false)
    wrapper.unmount()
  })

  it('«Otros» en cero va apagado y sin botón; distinto de cero, en alerta con explicación', async () => {
    const wrapper = await montar()

    const cero = filaDe(wrapper, 'Harina').find('[data-qa="varianza-otros"]')
    expect(cero.classes()).toContain('text-muted')
    expect(cero.findComponent({ name: 'AppInfoButton' }).exists()).toBe(false)

    const conResiduo = filaDe(wrapper, 'Queso').find('[data-qa="varianza-otros"]')
    expect(conResiduo.classes()).toContain('text-warning')
    const info = conResiduo.findComponent({ name: 'AppInfoButton' })
    expect(info.exists()).toBe(true)
    expect(String(info.props('text'))).toContain('no supo clasificar')
    wrapper.unmount()
  })

  it('la columna «Otros» sigue aunque todas las filas den cero', async () => {
    listado = [fila({ itemId: 'harina', itemNombre: 'Harina' })]
    const wrapper = await montar()
    const encabezados = wrapper.findAll('thead th').map(th => th.text())
    expect(encabezados).toContain('Otros')
    wrapper.unmount()
  })
})

describe('varianza — resumen', () => {
  it('lo que no se pudo medir sale en dos números: sin contar y a medio contar', async () => {
    const wrapper = await montar()
    const linea = wrapper.find('[data-qa="varianza-sin-conteo"]')
    expect(linea.text()).toContain('2 productos sin contar')
    expect(linea.text()).toContain('1 a medio contar')
    wrapper.unmount()
  })

  /**
   * Con bodegas la pantalla arranca en el local. Si el resumen se pidiera antes
   * de saberlo, saldrían dos —"todas" y "el local"— y nada descarta la vieja:
   * si "todas" vuelve última, las tarjetas no son las de la tabla.
   */
  it('con bodegas pide el resumen una sola vez, y ya para el local', async () => {
    ubicacionesBackend = [BODEGA, LOCAL]
    const wrapper = await montar()
    const resumenes = llamadas.filter(u => u.includes('/reportes/varianza/resumen?'))
    expect(resumenes).toHaveLength(1)
    expect(resumenes[0]).toContain('ubicacionId=ub-local')
    wrapper.unmount()
  })

  it('el listado lleva soloConVarianza y el resumen no', async () => {
    const wrapper = await montar()
    const lista = llamadas.find(u => u.includes('/reportes/varianza?'))
    const resumen = llamadas.find(u => u.includes('/reportes/varianza/resumen?'))
    expect(lista).toContain('soloConVarianza=true')
    expect(resumen).toBeTruthy()
    expect(resumen).not.toContain('soloConVarianza')
    expect(resumen).toMatch(/desde=\d{4}-\d{2}-\d{2}/)
    expect(resumen).toMatch(/hasta=\d{4}-\d{2}-\d{2}/)
    wrapper.unmount()
  })
})
