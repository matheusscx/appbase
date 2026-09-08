// @vitest-environment nuxt
//
// Frente de bodegas y traslados: el ajuste de stock y la entrada por compra
// (mismo drawer "Ajustar stock", `motivo` los distingue) eligen ubicación. Este
// modal es el ÚNICO consumidor real de `PATCH /items/:id/stock` —
// `inventario/index.vue` solo tiene el drawer de ajuste de costo — así que el
// selector va ACÁ, no ahí.
//
// Archivo separado del `items.nuxt.spec.ts` gigante (830 líneas, mock
// compartido complejo) para no arriesgar sus fixtures: mock propio, mínimo,
// solo para este modal.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Items from './items.vue'

const LOCAL = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega centro', tipo: 'bodega', activo: true }

const ITEM_PRODUCTO = {
  id: 'item-1',
  nombre: 'Coca-Cola 500ml',
  tipo: 'producto',
  activo: true,
  precioBase: '1500.0000',
  monedaId: 'clp',
  stock: '10.0000',
  modoInventario: 'cantidad',
  unidadMedida: 'unidad',
  categoriaId: null,
  clasificacionTributaria: 'afecto',
  impuestosIds: [] as string[],
  descuentosIds: [] as string[],
  recargosIds: [] as string[],
}

let ubicacionesBackend: typeof LOCAL[] = [LOCAL]
let ajustesEnviados: Record<string, unknown>[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (url.includes('/ubicaciones')) return Promise.resolve(ubicacionesBackend)
    if (opts?.method === 'PATCH' && /\/items\/[^/]+\/stock$/.test(url)) {
      ajustesEnviados.push({ ...(opts.body ?? {}) })
      return Promise.resolve({ stock: '15.0000', costoActual: '1000.0000' })
    }
    if (url.includes('/impuestos')) return Promise.resolve([])
    if (url.includes('/descuentos')) return Promise.resolve([])
    if (url.includes('/recargos')) return Promise.resolve([])
    if (/\/items\/[^/?]+\/uso$/.test(url)) return Promise.resolve({ bloqueos: [], advertencias: [] })
    if (/\/items\/[^/?]+$/.test(url)) return Promise.resolve(ITEM_PRODUCTO)
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

/** El menú "Más acciones" lo teletransporta Reka UI fuera del wrapper —mismo
 * camino que la papelera de `items.nuxt.spec.ts`—: hay que abrirlo por el
 * evento real y mirar `document.body`. El modal ("Ajustar stock") en cambio
 * SÍ es alcanzable por `findAllComponents`: Teleport mueve el DOM, no saca al
 * componente del árbol que Vue Test Utils recorre. */
async function abrirAjusteStock(wrapper: Wrapper) {
  await wrapper.find('[title="Más acciones"]').trigger('click')
  await new Promise(r => setTimeout(r, 20))

  const itemMenu = [...document.body.querySelectorAll('[role="menuitem"]')]
    .find(el => el.textContent?.trim() === 'Ajustar stock')
  expect(itemMenu, 'entrada "Ajustar stock" del menú').toBeTruthy()
  ;(itemMenu as HTMLElement).click()
  await new Promise(r => setTimeout(r, 20))
}

function selectConOpcion(wrapper: Wrapper, valor: string) {
  const select = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
    const items = (s.props('items') ?? []) as { value: string }[]
    return Array.isArray(items) && items.some(i => i?.value === valor)
  })
  expect(select, `USelectMenu con la opción "${valor}"`).toBeTruthy()
  return select!
}

async function emitir(comp: ReturnType<typeof selectConOpcion>, valor: string) {
  comp.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 20))
}

function campoCantidad(wrapper: Wrapper) {
  // `inputmode` es un atributo HTML que cae por fallthrough, no un prop
  // declarado de `UInput` — `.props('inputmode')` siempre da `undefined`.
  // El placeholder "0" ya alcanza para identificarlo sin ambigüedad acá
  // dentro (modo cantidad: es el único campo con ese placeholder).
  const campo = wrapper.findAllComponents({ name: 'UInput' })
    .find(c => c.props('placeholder') === '0')
  expect(campo, 'campo Cantidad').toBeTruthy()
  return campo!
}

async function aplicarAjuste(wrapper: Wrapper) {
  const boton = wrapper.findAllComponents({ name: 'UButton' })
    .find(b => b.text().trim() === 'Aplicar ajuste')
  expect(boton, 'botón "Aplicar ajuste"').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 100))
}

describe('configuracion/items — el selector de ubicación del modal "Ajustar stock"', () => {
  beforeEach(() => {
    ajustesEnviados = []
    document.body.querySelectorAll('[role="dialog"], [data-reka-portal]').forEach(n => n.remove())
  })

  it('con una sola ubicación, el selector NO se dibuja y el body manda el local igual', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirAjusteStock(wrapper)

    const conUbicacion = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
      const items = (s.props('items') ?? []) as { value: string }[]
      return Array.isArray(items) && items.some(i => i?.value === LOCAL.id)
    })
    expect(conUbicacion).toBeUndefined()

    await campoCantidad(wrapper).setValue('5')
    await aplicarAjuste(wrapper)

    expect(ajustesEnviados).toHaveLength(1)
    expect(ajustesEnviados[0]).toMatchObject({ ubicacionId: LOCAL.id })
    wrapper.unmount()
  })

  it('con una bodega, el selector se dibuja y lo elegido viaja en el body', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirAjusteStock(wrapper)

    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await campoCantidad(wrapper).setValue('8')
    await aplicarAjuste(wrapper)

    expect(ajustesEnviados).toHaveLength(1)
    expect(ajustesEnviados[0]).toMatchObject({ ubicacionId: BODEGA.id })
    wrapper.unmount()
  })

  it('cambiar de ubicación con la cantidad ya tipeada la limpia', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirAjusteStock(wrapper)

    await emitir(selectConOpcion(wrapper, LOCAL.id), LOCAL.id)
    await campoCantidad(wrapper).setValue('9')
    expect(campoCantidad(wrapper).props('modelValue')).toBe('9')

    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)

    // Si sobreviviera, sería una cantidad tipeada mirando el stock del local
    // aplicada como si fuera de la bodega — un número que nadie tecleó ahí.
    expect(campoCantidad(wrapper).props('modelValue')).toBe('')
    wrapper.unmount()
  })
})
