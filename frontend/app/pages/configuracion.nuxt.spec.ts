// @vitest-environment nuxt
//
// Fija el árbol del menú de Configuración y el gate de cada entrada. Lo que se
// lee es el DOM montado —encabezados y links en orden—, no el computed: el
// encabezado de un grupo vacío y su separador los dibuja `UNavigationMenu`, y
// solo se ven montados.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Configuracion from './configuracion.vue'

let esAdmin = false
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    get permisos() { return permisos },
    get loading() { return false },
    fetchPermisos: () => Promise.resolve(),
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

type Arbol = Record<string, string[]>

// Una entrada por pantalla, por su ruta: las dos "Motivos de diferencia" se
// distinguen por el grupo, y acá por el `href`.
const ARBOL_ADMIN: Arbol = {
  'Mi cuenta': ['/configuracion/perfil'],
  'Organización': [
    '/configuracion/empresa',
    '/configuracion/razones-sociales',
    '/configuracion/usuarios',
    '/configuracion/roles',
  ],
  'Catálogo': [
    '/configuracion/items',
    '/configuracion/categorias',
    '/configuracion/grupos-modificadores',
  ],
  'Precios': [
    '/configuracion/preferencias-financieras',
    '/configuracion/impuestos',
    '/configuracion/descuentos',
    '/configuracion/recargos',
    '/configuracion/promociones',
    '/configuracion/monedas',
  ],
  'Cobros': ['/configuracion/metodos-pago', '/configuracion/pasarelas'],
  'Caja': ['/configuracion/cajas', '/configuracion/motivos-diferencia'],
  'Inventario': [
    '/configuracion/ubicaciones',
    '/configuracion/motivos-baja',
    '/configuracion/motivos-diferencia-inventario',
    '/configuracion/motivos-traslado',
  ],
  'Restaurante': [
    '/configuracion/salones',
    '/configuracion/garzones',
    '/configuracion/turnos',
    '/configuracion/propinas-distribucion',
    '/configuracion/impresoras',
  ],
}

const PERFIL: Arbol = { 'Mi cuenta': ['/configuracion/perfil'] }

async function arbolMontado() {
  const wrapper = await mountSuspended(Configuracion)
  await new Promise(r => setTimeout(r, 0))
  // Acotado al `<nav>`: el `<NuxtPage>` de al lado dibuja una ruta hija.
  const nav = wrapper.element.querySelector('nav')!
  const arbol: Arbol = {}
  let grupo = ''
  for (const el of nav.querySelectorAll('[data-slot="label"], a')) {
    if (el.matches('[data-slot="label"]')) {
      grupo = el.textContent!.trim()
      arbol[grupo] = []
    }
    else {
      arbol[grupo]!.push(el.getAttribute('href')!)
    }
  }
  const separadores = nav.querySelectorAll('[data-slot="separator"]').length
  wrapper.unmount()
  return { arbol, separadores }
}

beforeEach(() => {
  esAdmin = false
  permisos = []
})

describe('menú de configuración agrupado', () => {
  it('el admin ve los ocho grupos, en orden, con cada pantalla una sola vez', async () => {
    esAdmin = true

    const { arbol, separadores } = await arbolMontado()

    expect(arbol).toEqual(ARBOL_ADMIN)
    // `toEqual` no mira el orden de las claves; el de los grupos es decisión.
    expect(Object.keys(arbol)).toEqual(Object.keys(ARBOL_ADMIN))
    const rutas = Object.values(arbol).flat()
    expect(rutas).toHaveLength(27)
    expect(new Set(rutas).size).toBe(27)
    expect(separadores).toBe(7)
  })

  it('sin permisos queda solo Perfil, sin encabezados de grupos vacíos', async () => {
    const { arbol, separadores } = await arbolMontado()

    expect(arbol).toEqual(PERFIL)
    expect(separadores).toBe(0)
  })

  // Un permiso por fila: la entrada aparece en su grupo y ningún otro grupo
  // asoma. Cada gate pide `Leer` (Propinas también `Configurar`), así que un
  // permiso de escritura solo no la muestra.
  it.each<[string, Arbol]>([
    ['Salones:Leer', { Restaurante: ['/configuracion/salones', '/configuracion/garzones', '/configuracion/turnos'] }],
    ['Impresoras:Leer', { Restaurante: ['/configuracion/impresoras'] }],
    ['Propinas:Leer', { Restaurante: ['/configuracion/propinas-distribucion'] }],
    ['Propinas:Configurar', { Restaurante: ['/configuracion/propinas-distribucion'] }],
    ['Cajas:Leer', { Caja: ['/configuracion/cajas'] }],
    ['Items:Leer', { 'Catálogo': ['/configuracion/items'] }],
    ['Pasarelas:Leer', { Cobros: ['/configuracion/pasarelas'] }],
    ['Salones:Crear', {}],
    ['Cajas:Actualizar', {}],
  ])('con solo %s', async (permiso, esperado) => {
    permisos = [permiso]

    const { arbol, separadores } = await arbolMontado()

    expect(arbol).toEqual({ ...PERFIL, ...esperado })
    expect(separadores).toBe(Object.keys(esperado).length)
  })
})
