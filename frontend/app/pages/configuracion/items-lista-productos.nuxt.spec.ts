// @vitest-environment nuxt
//
// Auditoría UX 07.12, 07.22, 07.30, 07.32, 07.33, 07.35 sobre la lista de Productos. Archivo propio,
// con un mock mínimo, por el mismo criterio que `items-desglose-ubicacion.nuxt.spec.ts`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Items from './items.vue'

const PRODUCTO = {
  id: 'item-1',
  nombre: 'Coca-Cola 500ml',
  tipo: 'producto',
  activo: true,
  precioBase: '1500.0000',
  monedaId: 'clp',
  stock: '79.0000',
  modoInventario: 'cantidad',
  unidadMedida: 'unidad',
  categoriaId: null,
  costoActual: '400',
}
const INGREDIENTE = {
  ...PRODUCTO,
  id: 'item-2',
  nombre: 'Harina',
  tipo: 'ingrediente',
  precioBase: '0',
  stock: '4.3500',
  unidadMedida: 'kg',
  costoActual: '8000',
}

let permisos: string[] = []
mockNuxtImport('usePermissionsStore', () => () => ({
  get esAdmin() { return true },
  can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
}))

const toastAdd = vi.fn()
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))

let filas: Record<string, unknown>[] = []
let urlsLista: string[] = []
let patches: { url: string, body: unknown }[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (opts?.method === 'PATCH') {
      patches.push({ url, body: opts.body })
      return Promise.resolve({})
    }
    if (url.includes('/categorias')) {
      return Promise.resolve([
        { id: 'cat-bebidas', nombre: 'Bebidas', activo: true },
        { id: 'cat-secos', nombre: 'Secos', activo: true },
      ])
    }
    if (/\/(impuestos|descuentos|recargos|ubicaciones|monedas)/.test(url)) return Promise.resolve([])
    if (/\/items\/[^/?]+\/uso$/.test(url)) return Promise.resolve({ bloqueos: [], advertencias: [] })
    if (url.includes('/items')) {
      urlsLista.push(url)
      return Promise.resolve({ data: filas, meta: { total: filas.length, page: 1, limit: 20, totalPages: 1 } })
    }
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Items)
  await new Promise(r => setTimeout(r, 30))
  return wrapper
}

beforeEach(() => {
  permisos = ['Items:Leer', 'Items:Crear', 'Items:Actualizar', 'Items:Eliminar']
  filas = [PRODUCTO, INGREDIENTE]
  urlsLista = []
  patches = []
  toastAdd.mockReset()
  document.body.querySelectorAll('[role="dialog"], [data-reka-portal]').forEach(n => n.remove())
})

describe('Productos — palabras del local (07.30)', () => {
  it('el alta dice "Nuevo producto"', async () => {
    const w = await montar()
    expect(w.findAll('button').some(b => b.text().includes('Nuevo producto'))).toBe(true)
    expect(w.text()).not.toContain('Nuevo item')
    w.unmount()
  })

  it('la columna se llama "Producto"', async () => {
    const w = await montar()
    expect(w.find('thead').text()).toContain('Producto')
    expect(w.find('thead').text()).not.toContain('Item')
    w.unmount()
  })
})

describe('Productos — la línea de cada fila (07.32)', () => {
  it('el stock sale con los decimales de su unidad, no con cuatro', async () => {
    const w = await montar()
    expect(w.text()).toContain('Stock total: 79 unidades')
    expect(w.text()).toContain('Stock total: 4,35 kg')
    expect(w.text()).not.toContain('4.3500')
    w.unmount()
  })

  it('un ingrediente no muestra precio: no se vende', async () => {
    filas = [INGREDIENTE]
    const w = await montar()
    expect(w.text()).toContain('Harina')
    // Sin precio, la línea arranca en el stock, sin un separador suelto delante.
    expect(w.find('[data-qa="item-linea"]').text()).toMatch(/^Stock total: 4,35 kg/)
    w.unmount()
  })

  it('la línea usa cifras tabulares de la letra de marca, no monoespaciada', async () => {
    const w = await montar()
    expect(w.find('[data-qa="item-linea"]').classes()).toContain('tabular-nums')
    expect(w.find('[data-qa="item-linea"]').classes()).not.toContain('font-mono')
    w.unmount()
  })
})

describe('Productos — filtrar por categoría y ordenar (07.33)', () => {
  it('elegir una categoría la manda al servidor y "Limpiar filtros" la quita', async () => {
    const w = await montar()
    const selector = w.findAllComponents({ name: 'USelectMenu' }).find(c => JSON.stringify(c.props('items')).includes('Todas las categorías'))!
    expect(selector, 'selector de categoría').toBeTruthy()
    await new Promise(r => setTimeout(r, 30))
    selector.vm.$emit('update:modelValue', 'cat-bebidas')
    await new Promise(r => setTimeout(r, 30))
    expect(urlsLista.at(-1)).toContain('categoriaId=cat-bebidas')
    const limpiar = w.findAll('button').find(b => b.text().includes('Limpiar filtros'))
    expect(limpiar, 'Limpiar filtros').toBeTruthy()
    await limpiar!.trigger('click')
    await new Promise(r => setTimeout(r, 30))
    expect(urlsLista.at(-1)).not.toContain('categoriaId')
    w.unmount()
  })

  it('ordenar por precio de mayor a menor manda orden y sentido al servidor', async () => {
    const w = await montar()
    const orden = w.findAllComponents({ name: 'USelectMenu' }).find(c => JSON.stringify(c.props('items')).includes('Ordenar por precio'))!
    expect(orden, 'selector de orden').toBeTruthy()
    orden.vm.$emit('update:modelValue', 'precio')
    await new Promise(r => setTimeout(r, 30))
    expect(urlsLista.at(-1)).toContain('orden=precio')
    await w.find('[data-qa="orden-sentido"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    expect(urlsLista.at(-1)).toContain('sentido=desc')
    w.unmount()
  })

  it('por defecto la lista sale por nombre ascendente', async () => {
    const w = await montar()
    expect(urlsLista.at(-1)).toContain('orden=nombre')
    expect(urlsLista.at(-1)).toContain('sentido=asc')
    w.unmount()
  })
})

describe('Productos — sin permiso el botón queda apagado y dice por qué (07.22)', () => {
  it('sin Items:Crear, "Nuevo producto" está deshabilitado con su motivo', async () => {
    permisos = ['Items:Leer']
    const w = await montar()
    const boton = w.findAll('button').find(b => b.text().includes('Nuevo producto'))!
    expect(boton.attributes('disabled')).toBeDefined()
    expect(boton.attributes('title')).toBe('Necesitas el permiso Crear en Productos')
    w.unmount()
  })

  it('sin Items:Actualizar, el lápiz de la fila está deshabilitado con su motivo', async () => {
    permisos = ['Items:Leer']
    const w = await montar()
    const lapiz = w.find('[aria-label="Editar producto Coca-Cola 500ml"]')
    expect(lapiz.attributes('disabled')).toBeDefined()
    expect(lapiz.attributes('title')).toBe('Necesitas el permiso Actualizar en Productos')
    w.unmount()
  })

  it('con permiso el lápiz se llama "Editar"', async () => {
    const w = await montar()
    const lapiz = w.find('[aria-label="Editar producto Coca-Cola 500ml"]')
    expect(lapiz.attributes('disabled')).toBeUndefined()
    expect(lapiz.attributes('title')).toBe('Editar')
    w.unmount()
  })
})

describe('Productos — vacío con salida (07.35)', () => {
  it('sin productos dice por dónde empezar y ofrece crear el primero', async () => {
    filas = []
    const w = await montar()
    expect(w.find('[data-qa="estado-vacio-accion"]').text()).toContain('Nuevo producto')
    w.unmount()
  })

  it('sin permiso de crear no ofrece el botón del vacío', async () => {
    filas = []
    permisos = ['Items:Leer']
    const w = await montar()
    expect(w.find('[data-qa="estado-vacio-accion"]').exists()).toBe(false)
    w.unmount()
  })
})

describe('Productos — activar o pausar guarda con "Deshacer" (07.12) y con área de 44 px (07.26)', () => {
  it('al pausar, el aviso trae "Deshacer" y tocarlo vuelve a activar', async () => {
    filas = [PRODUCTO]
    const w = await montar()
    await w.find('[aria-label="Activo: Coca-Cola 500ml"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    expect(patches[0]?.body).toEqual({ activo: false })
    const aviso = toastAdd.mock.calls.map(c => c[0]).find(a => a.actions?.length)
    expect(aviso.title).toBe('Producto pausado')
    aviso.actions[0].onClick()
    await new Promise(r => setTimeout(r, 30))
    expect(patches[1]?.body).toEqual({ activo: true })
    w.unmount()
  })

  it('el interruptor tiene un área tocable mayor que su dibujo', async () => {
    filas = [PRODUCTO]
    const w = await montar()
    expect(w.find('[aria-label="Activo: Coca-Cola 500ml"]').classes().join(' ')).toContain('after:-inset-')
    w.unmount()
  })
})
