// @vitest-environment nuxt
//
// Entorno nuxt SOLO en este archivo (docblock por archivo, no config global):
// los otros 300 tests siguen en `happy-dom` sin enterarse. Es el único modo de
// cazar un gate de permisos mal puesto, porque el bug vive en el TEMPLATE — los
// computeds pueden ser correctos por separado y el control quedar igual oculto
// (o visible) por dónde está colgado.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import DesfasesPanel from './DesfasesPanel.vue'

let esAdmin = false
let permisos: string[] = []

// ⚠️ Nuxt instala su PROPIA instancia de Pinia, así que espiar un store creado
// con `setActivePinia` no sirve: hay que mockear el auto-import.
mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

const FILAS = [
  {
    itemId: 'receta-1',
    tipo: 'receta',
    nombre: 'Hamburguesa',
    costoActual: '1000.0000',
    costoPropuesto: '1200.0000',
    deltaCosto: '200.0000',
    precioBase: '3000.0000',
    margenPctActual: '0.6667',
    margenPctPropuesto: '0.6000',
    precioSugerido: null,
    afectados: [],
  },
]

function textos(wrapper: { findAll: (s: string) => { text: () => string }[] }) {
  return wrapper.findAll('button').map(b => b.text())
}

describe('DesfasesPanel — gate de Items:Actualizar', () => {
  it('sin el permiso NO muestra aplicar ni descartar', async () => {
    esAdmin = false
    permisos = ['Items:Leer']

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: FILAS as never },
    })

    const labels = textos(wrapper)
    expect(labels.some(t => t.includes('Aplicar'))).toBe(false)
    expect(labels.some(t => t.includes('Descartar'))).toBe(false)
    // La lectura queda intacta: el panel sigue mostrando el desfase.
    expect(wrapper.text()).toContain('Hamburguesa')
  })

  it('con Items:Actualizar muestra los dos', async () => {
    esAdmin = false
    permisos = ['Items:Leer', 'Items:Actualizar']

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: FILAS as never },
    })

    const labels = textos(wrapper)
    expect(labels.some(t => t.includes('Aplicar'))).toBe(true)
    expect(labels.some(t => t.includes('Descartar'))).toBe(true)
  })

  it('el admin del tenant los ve sin tener el permiso listado', async () => {
    esAdmin = true
    permisos = []

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: FILAS as never },
    })

    expect(textos(wrapper).some(t => t.includes('Aplicar'))).toBe(true)
  })

  it('"Después" no se gatea: no escribe nada', async () => {
    esAdmin = false
    permisos = ['Items:Leer']

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: FILAS as never },
    })

    expect(textos(wrapper).some(t => t.includes('Después'))).toBe(true)
  })
})

describe('DesfasesPanel — columna Tipo', () => {
  it('una fila de combo se distingue de una de receta', async () => {
    // `nombre: 'Combo Clásico'` ya contiene la palabra "Combo": un
    // `wrapper.text()).toContain('Combo')` pasaría igual sin columna Tipo ni
    // badge. La aserción va acotada a la celda de Tipo (índice 1: checkbox,
    // Tipo, nombre, costo, margen, precio), y con una fila de receta al lado
    // para probar que de verdad distingue una de la otra.
    const wrapper = await mountSuspended(DesfasesPanel, {
      props: {
        filas: [
          {
            itemId: 'combo-1',
            tipo: 'combo',
            nombre: 'Combo Clásico',
            costoActual: '1700.0000',
            costoPropuesto: '1800.0000',
            deltaCosto: '100.0000',
            precioBase: '4200.0000',
            margenPctActual: '0.5952',
            margenPctPropuesto: '0.5714',
            precioSugerido: '4447.0588',
            afectados: [
              { itemId: 'papas-1', nombre: 'Papas fritas', costoActual: '600.0000' },
            ],
          },
          {
            itemId: 'receta-1',
            tipo: 'receta',
            nombre: 'Hamburguesa Clásica',
            costoActual: '1000.0000',
            costoPropuesto: '1200.0000',
            deltaCosto: '200.0000',
            precioBase: '3000.0000',
            margenPctActual: '0.6667',
            margenPctPropuesto: '0.6000',
            precioSugerido: null,
            afectados: [],
          },
        ],
      },
    })

    const filas = wrapper.findAll('tbody tr')
    expect(filas).toHaveLength(2)
    const [comboRow, recetaRow] = filas
    expect(comboRow!.findAll('td')[1]?.text()).toBe('Combo')
    expect(recetaRow!.findAll('td')[1]?.text()).toBe('Receta')
  })
})

// Silencia el warning de vi sin uso si el runtime no lo requiere.
void vi
