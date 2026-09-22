// @vitest-environment nuxt
//
// Pantalla de stock mínimo (`docs/features/aviso-stock-bajo.md`). Lo que fija,
// una distinción de permiso por caso y siempre con permisos parciales, nunca
// con admin —con admin todo control aparece y el que falta no se ve—:
//   1. Con `Inventario:Leer` solo: el mínimo se ve, no se edita, y la fila bajo
//      el mínimo dice dónde hay mercadería SIN botón de traslado.
//   2. Con `Actualizar`: el mínimo se edita y se guarda con `PUT`, y la fila se
//      reemplaza por la que devuelve el backend (la marca no se deriva acá).
//   3. Con `Crear`: aparece el botón y navega al traslado con el destino de la
//      fila —una bodega, no el local— y la cantidad que falta, topeada por lo
//      que hay en el origen.
// El gate de `Inventario:Leer` de la pantalla entera es el middleware
// `permiso` (`definePageMeta`), que tiene su propio spec.
//
// Las filas simuladas tienen la forma real de `InventarioService.StockMinimoFila`.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import StockMinimo from './stock-minimo.vue'

let permisos: string[] = []
let llamadas: { url: string, method?: string, body?: unknown }[] = []
let navegaciones: unknown[] = []
/** Cómo contesta el próximo PUT: 'ok' (default), 'falla' (400), o una promesa que el test resuelve. */
let respuestaPut: 'ok' | 'falla' | Promise<unknown> = 'ok'

const BODEGA = { id: 'bodega-1', nombre: 'Bodega barra', tipo: 'bodega', activo: true }
const LOCAL = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }

/** Cerveza: 1 en la bodega barra contra un mínimo de 6; hay 3 en el local. */
const FILA_BAJA = {
  itemId: 'item-1',
  itemNombre: 'Cerveza',
  ubicacionId: BODEGA.id,
  ubicacionNombre: BODEGA.nombre,
  unidadMedida: 'unidad',
  minimo: '6.0000',
  origen: 'manual',
  stock: '1.0000',
  bajoMinimo: true,
  enCamino: false,
  origenSugerido: { ubicacionId: LOCAL.id, ubicacionNombre: LOCAL.nombre, stock: '3.0000' },
}

/** Agua: sin mínimo cargado. */
const FILA_SIN_MINIMO = {
  itemId: 'item-2',
  itemNombre: 'Agua',
  ubicacionId: LOCAL.id,
  ubicacionNombre: LOCAL.nombre,
  unidadMedida: 'unidad',
  minimo: null,
  origen: null,
  stock: '4.0000',
  bajoMinimo: false,
  enCamino: false,
  origenSugerido: null,
}

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return false },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ query: {} })
})

mockNuxtImport('navigateTo', () => {
  return (destino: unknown) => {
    navegaciones.push(destino)
    return Promise.resolve()
  }
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown }) => {
    if (typeof url !== 'string') return Promise.resolve(null)
    llamadas.push({ url, method: opts?.method, body: opts?.body })
    if (url.includes('/ubicaciones')) return Promise.resolve([LOCAL, BODEGA])
    if (opts?.method === 'PUT' && respuestaPut === 'falla') {
      return Promise.reject({ data: { message: 'minimo admite hasta 14 enteros y 4 decimales, sin signo' } })
    }
    if (opts?.method === 'PUT' && respuestaPut instanceof Promise) return respuestaPut
    if (opts?.method === 'PUT' && url.includes('/inventario/stock-minimo/item-2/')) {
      // La fila recalculada por el backend: 4 contra un mínimo nuevo de 5.
      return Promise.resolve({
        ...FILA_SIN_MINIMO,
        minimo: '5.0000',
        origen: 'manual',
        bajoMinimo: true,
      })
    }
    if (url.includes('/inventario/stock-minimo')) {
      return Promise.resolve({
        data: [FILA_BAJA, FILA_SIN_MINIMO],
        meta: { page: 1, pageSize: 15, total: 2, totalPages: 1 },
      })
    }
    if (url.includes('/catalog/unidades-medida')) return Promise.resolve([])
    return Promise.resolve(null)
  }
})

async function montar() {
  const wrapper = await mountSuspended(StockMinimo)
  await new Promise(r => setTimeout(r, 30))
  return wrapper
}

beforeEach(() => {
  permisos = []
  llamadas = []
  navegaciones = []
  respuestaPut = 'ok'
})

describe('stock mínimo — con Inventario:Leer solo', () => {
  it('ve el mínimo sin poder editarlo', async () => {
    permisos = ['Inventario:Leer']
    const wrapper = await montar()

    expect(wrapper.find('[data-qa^="minimo-item-"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-qa="minimo-solo-lectura"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Bajo el mínimo')

    wrapper.unmount()
  })

  it('bajo el mínimo le dice dónde hay mercadería, sin botón de traslado', async () => {
    permisos = ['Inventario:Leer']
    const wrapper = await montar()

    expect(wrapper.find('[data-qa="trasladar"]').exists()).toBe(false)
    const info = wrapper.find('[data-qa="hay-en-otra-ubicacion"]')
    expect(info.exists()).toBe(true)
    expect(info.text()).toContain('Local')

    wrapper.unmount()
  })
})

describe('stock mínimo — con Inventario:Actualizar', () => {
  it('guarda el mínimo con PUT y reemplaza la fila por la del backend', async () => {
    permisos = ['Inventario:Leer', 'Inventario:Actualizar']
    const wrapper = await montar()

    const input = wrapper.find('input[data-qa="minimo-item-2-local-1"]')
    expect(input.exists()).toBe(true)
    await input.setValue('5')
    await input.trigger('blur')
    await new Promise(r => setTimeout(r, 20))

    const put = llamadas.find(l => l.method === 'PUT')
    expect(put?.url).toContain('/inventario/stock-minimo/item-2/local-1')
    expect(put?.body).toEqual({ minimo: '5' })
    // La marca sale de la fila que devolvió el backend: ahora las dos filas
    // están bajo el mínimo.
    expect(wrapper.findAll('[data-qa="marca-bajo-minimo"]')).toHaveLength(2)

    wrapper.unmount()
  })

  it('vaciar el campo manda null (limpiar), y volver a tipear el mismo número no manda nada', async () => {
    permisos = ['Inventario:Leer', 'Inventario:Actualizar']
    const wrapper = await montar()

    const input = wrapper.find('input[data-qa="minimo-item-1-bodega-1"]')
    await input.setValue('6')
    await input.trigger('blur')
    await new Promise(r => setTimeout(r, 20))
    expect(llamadas.some(l => l.method === 'PUT')).toBe(false)

    await input.setValue('')
    await input.trigger('blur')
    await new Promise(r => setTimeout(r, 20))
    expect(llamadas.find(l => l.method === 'PUT')?.body).toEqual({ minimo: null })

    wrapper.unmount()
  })

  it('un guardado que falla no se reintenta solo al salir del campo, y el campo vuelve al valor guardado', async () => {
    permisos = ['Inventario:Leer', 'Inventario:Actualizar']
    respuestaPut = 'falla'
    const wrapper = await montar()

    const input = wrapper.find('input[data-qa="minimo-item-1-bodega-1"]')
    await input.setValue('1.12345')
    await input.trigger('keydown', { key: 'Enter' })
    await new Promise(r => setTimeout(r, 20))
    await input.trigger('blur')
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas.filter(l => l.method === 'PUT')).toHaveLength(1)
    expect((input.element as HTMLInputElement).value).toBe('6.0000')

    wrapper.unmount()
  })

  it('una respuesta que llega después de cambiar el filtro no pisa la lista nueva', async () => {
    permisos = ['Inventario:Leer', 'Inventario:Actualizar']
    let resolver: (v: unknown) => void = () => {}
    respuestaPut = new Promise(r => { resolver = r })
    const wrapper = await montar()

    const input = wrapper.find('input[data-qa="minimo-item-2-local-1"]')
    await input.setValue('5')
    await input.trigger('blur')
    // Mientras el PUT vuela, el usuario cambia el filtro: la lista se vuelve a pedir.
    wrapper.findComponent({ name: 'USwitch' }).vm.$emit('update:modelValue', true)
    await new Promise(r => setTimeout(r, 30))

    resolver({ ...FILA_SIN_MINIMO, minimo: '5.0000', origen: 'manual', bajoMinimo: true })
    await new Promise(r => setTimeout(r, 20))
    // La lista vigente es la que trajo el GET nuevo: la fila de Agua sigue sin marca.
    expect(wrapper.findAll('[data-qa="marca-bajo-minimo"]')).toHaveLength(1)

    wrapper.unmount()
  })

  it('sin Crear, igual no hay botón de traslado', async () => {
    permisos = ['Inventario:Leer', 'Inventario:Actualizar']
    const wrapper = await montar()

    expect(wrapper.find('[data-qa="trasladar"]').exists()).toBe(false)

    wrapper.unmount()
  })
})

describe('stock mínimo — con Inventario:Crear', () => {
  it('el botón lleva al traslado desde el origen sugerido HACIA la ubicación de la fila', async () => {
    permisos = ['Inventario:Leer', 'Inventario:Crear']
    const wrapper = await montar()

    const boton = wrapper.find('[data-qa="trasladar"]')
    expect(boton.exists()).toBe(true)
    await boton.trigger('click')

    // Faltan 5 para el mínimo, pero en el local hay 3: se precargan 3.
    expect(navegaciones).toEqual([
      {
        path: '/inventario/traslados',
        query: { itemId: 'item-1', origenId: LOCAL.id, destinoId: BODEGA.id, cantidad: '3' },
      },
    ])

    wrapper.unmount()
  })
})
