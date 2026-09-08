// @vitest-environment nuxt
//
// Frente de bodegas y traslados: la lista de items muestra el TOTAL de todas
// las ubicaciones (ya lo hacía — `stock` de `GET /items` significa el total del
// tenant) y el detalle desglosa por ubicación, el local primero. Lo nuevo es la
// ETIQUETA ("Stock total", para no confundirse con "Disponible" del salón) y la
// sección de desglose del detalle, gobernada por `hayBodegas`.
//
// Archivo separado de `items.nuxt.spec.ts` (830 líneas, mock compartido
// complejo), mismo criterio que `items-stock-ubicacion.nuxt.spec.ts`: mock
// propio, mínimo, solo para esto.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Items from './items.vue'

const LOCAL = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega centro', tipo: 'bodega', activo: true }

// Fixture que DISCRIMINA a propósito: el total (30) es distinto del local (10)
// y de la bodega (20). Con los tres iguales, un mutante que muestre el total
// donde va el local (o viceversa) sobrevive sin que ningún test lo note.
const ITEM_PRODUCTO = {
  id: 'item-1',
  nombre: 'Coca-Cola 500ml',
  tipo: 'producto',
  activo: true,
  precioBase: '1500.0000',
  monedaId: 'clp',
  stock: '30.0000',
  modoInventario: 'cantidad',
  unidadMedida: 'unidad',
  categoriaId: null,
  clasificacionTributaria: 'afecto',
  impuestosIds: [] as string[],
  descuentosIds: [] as string[],
  recargosIds: [] as string[],
}

const DESGLOSE_CON_BODEGA = [
  { ubicacionId: LOCAL.id, nombre: LOCAL.nombre, stock: '10.0000' },
  { ubicacionId: BODEGA.id, nombre: BODEGA.nombre, stock: '20.0000' },
]
// Sin bodegas, el backend solo tiene una fila para desglosar: el local. Es el
// caso que decide si la sección se dibuja o no.
const DESGLOSE_SOLO_LOCAL = [
  { ubicacionId: LOCAL.id, nombre: LOCAL.nombre, stock: '30.0000' },
]

let ubicacionesBackend: (typeof LOCAL)[] = [LOCAL, BODEGA]
let desgloseBackend: typeof DESGLOSE_CON_BODEGA = DESGLOSE_CON_BODEGA

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (url.includes('/ubicaciones')) return Promise.resolve(ubicacionesBackend)
    if (url.includes('/impuestos')) return Promise.resolve([])
    if (url.includes('/descuentos')) return Promise.resolve([])
    if (url.includes('/recargos')) return Promise.resolve([])
    if (/\/items\/[^/?]+\/uso$/.test(url)) return Promise.resolve({ bloqueos: [], advertencias: [] })
    if (/\/items\/[^/?]+$/.test(url))
      return Promise.resolve({ ...ITEM_PRODUCTO, desglosePorUbicacion: desgloseBackend })
    if (url.includes('/items'))
      return Promise.resolve({ data: [ITEM_PRODUCTO], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } })
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Items)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

async function abrirEditar(wrapper: Wrapper) {
  await wrapper.find('[title="Editar"]').trigger('click')
  await new Promise(r => setTimeout(r, 50))
}

describe('configuracion/items — el catálogo muestra el total y desglosa por ubicación', () => {
  beforeEach(() => {
    ubicacionesBackend = [LOCAL, BODEGA]
    desgloseBackend = DESGLOSE_CON_BODEGA
    document.body.querySelectorAll('[role="dialog"], [data-reka-portal]').forEach(n => n.remove())
  })

  it('la lista muestra el total de todas las ubicaciones (30), no el del local (10)', async () => {
    const wrapper = await montar()

    const texto = wrapper.text()
    expect(texto).toContain('Stock total: 30')
    // Ancla negativa: si algún día un mutante hiciera leer `stockVendible` (10)
    // en vez de `stock` (30), este texto lo cazaría — no aparece "Stock total: 10".
    expect(texto).not.toContain('Stock total: 10')
    wrapper.unmount()
  })

  it('el detalle del producto desglosa por ubicación, el local primero', async () => {
    const wrapper = await montar()
    await abrirEditar(wrapper)

    // El drawer (`AppDrawer` → `UDrawer`) teletransporta su contenido fuera del
    // `wrapper` — mismo mecanismo que el menú "Más acciones" en
    // `items-stock-ubicacion.nuxt.spec.ts` — así que se mira `document.body`,
    // no `wrapper.find`.
    const seccion = document.body.querySelector('[data-qa="desglose-ubicacion"]')
    expect(seccion, 'sección "Stock por ubicación"').toBeTruthy()
    const texto = seccion!.textContent ?? ''

    expect(texto).toContain('Local')
    expect(texto).toContain('Bodega centro')
    expect(texto).toContain('10')
    expect(texto).toContain('20')
    // El local primero: el backend ya lo ordena así, y la pantalla no reordena.
    expect(texto.indexOf('Local')).toBeLessThan(texto.indexOf('Bodega centro'))
    wrapper.unmount()
  })

  it('sin bodegas, no dibuja ninguna sección de ubicación', async () => {
    ubicacionesBackend = [LOCAL]
    desgloseBackend = DESGLOSE_SOLO_LOCAL
    const wrapper = await montar()
    await abrirEditar(wrapper)

    expect(document.body.querySelector('[data-qa="desglose-ubicacion"]')).toBeNull()
    wrapper.unmount()
  })
})
