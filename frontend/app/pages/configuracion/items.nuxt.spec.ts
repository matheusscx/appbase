// @vitest-environment nuxt
//
// `configuracion/items` es la excepción de su carpeta: NO es admin-only, va con
// `@RequiresPermiso('Items', …)`. Lo que se afirma acá es justamente eso — que
// un usuario con el permiso ve sus controles aunque no sea admin — y que las
// entradas del menú de acciones se arman por permiso: "Ajustar stock" escribe,
// "Historial" solo lee, y quedaron en el mismo dropdown.
import { describe, it, expect } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Items from './items.vue'

let esAdmin = false
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

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
  impuestosIds: [],
  descuentosIds: [],
  recargosIds: [],
}

// La página dispara varias cargas al montar (catálogos, vendibles, grupos) y
// cada una espera una forma distinta. Se responde por URL: lo que importa es
// que la tabla tenga UNA fila para que se rendericen los controles de fila.
mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url === 'string' && url.includes('/items'))
      return Promise.resolve({ data: [ITEM_PRODUCTO], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } })
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Items)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

function tieneTexto(wrapper: Awaited<ReturnType<typeof montar>>, texto: string) {
  return wrapper.findAll('button').some(b => b.text().includes(texto))
}

function cuentaPorTitulo(
  wrapper: Awaited<ReturnType<typeof montar>>,
  title: string,
) {
  return wrapper.findAll(`[title="${title}"]`).length
}

describe('configuracion/items — permisos de módulo, no esAdmin', () => {
  it('con Items:Leer no aparece ni crear ni editar', async () => {
    esAdmin = false
    permisos = ['Items:Leer']

    const wrapper = await montar()

    expect(tieneTexto(wrapper, 'Nuevo item')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBe(0)
  })

  it('un NO admin con Items:Crear ve el alta', async () => {
    // El corazón del hallazgo: gatear esta pantalla con `esAdmin` —como sus 15
    // vecinas de `configuracion/`— le escondería el botón a quien sí puede.
    esAdmin = false
    permisos = ['Items:Leer', 'Items:Crear']

    const wrapper = await montar()

    expect(tieneTexto(wrapper, 'Nuevo item')).toBe(true)
  })

  it('un NO admin con Items:Actualizar ve editar, sin ver crear', async () => {
    esAdmin = false
    permisos = ['Items:Leer', 'Items:Actualizar']

    const wrapper = await montar()

    expect(tieneTexto(wrapper, 'Nuevo item')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBeGreaterThan(0)
  })

  it('el menú de acciones aparece solo con lectura: "Historial" no escribe', async () => {
    // Un producto ofrece historial y unidades aunque no se pueda escribir; el
    // dropdown solo desaparece si se queda sin NINGUNA entrada.
    esAdmin = false
    permisos = ['Items:Leer']

    const wrapper = await montar()

    expect(cuentaPorTitulo(wrapper, 'Más acciones')).toBeGreaterThan(0)
  })

  it('el admin del tenant ve crear y editar sin permisos listados', async () => {
    esAdmin = true
    permisos = []

    const wrapper = await montar()

    expect(tieneTexto(wrapper, 'Nuevo item')).toBe(true)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBeGreaterThan(0)
  })
})
