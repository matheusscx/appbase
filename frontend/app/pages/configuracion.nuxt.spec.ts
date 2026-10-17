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

// Lo que `mis-permisos` le devuelve al admin de un tenant que contrató los módulos
// de este menú: el catálogo completo de cada uno (sin atajo `esAdmin` en el menú).
const PERMISOS_ADMIN = [
  ...['Actualizar', 'Crear', 'Eliminar', 'Leer'].flatMap(p => [`Items:${p}`, `Cajas:${p}`, `Impresoras:${p}`]),
  ...['Actualizar', 'Crear', 'Eliminar', 'Leer', 'Reembolsar'].map(p => `Pasarelas:${p}`),
  ...['Actualizar', 'Configurar', 'Crear', 'Eliminar', 'Leer', 'Liquidar'].map(p => `Propinas:${p}`),
  ...['Actualizar', 'Anular', 'Crear', 'Eliminar', 'Leer', 'Operar', 'Ver todas'].map(p => `Salones:${p}`),
]

// Una entrada por pantalla, por su ruta: las dos "Motivos de diferencia" se
// distinguen por el grupo, y acá por el `href`.
const ARBOL_ADMIN: Arbol = {
  'Mi cuenta': ['/configuracion/perfil'],
  'Organización': [
    '/configuracion/empresa',
    '/configuracion/razones-sociales',
    '/configuracion/boleta-electronica',
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
  'Caja': [
    '/configuracion/cajas',
    '/configuracion/motivos-diferencia',
    '/configuracion/conceptos-movimiento-caja',
  ],
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
  'Paquetería': ['/configuracion/repartidores', '/configuracion/paqueteria'],
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
  it('el admin de un tenant que contrató todos los módulos ve los nueve grupos, en orden, con cada pantalla una sola vez', async () => {
    esAdmin = true
    // Paquetería se ve solo si el tenant la contrató: `mis-permisos` le trae `Paquetería:Leer`.
    permisos = [...PERMISOS_ADMIN, 'Paquetería:Leer']

    const { arbol, separadores } = await arbolMontado()

    expect(arbol).toEqual(ARBOL_ADMIN)
    // `toEqual` no mira el orden de las claves; el de los grupos es decisión.
    expect(Object.keys(arbol)).toEqual(Object.keys(ARBOL_ADMIN))
    const rutas = Object.values(arbol).flat()
    expect(rutas).toHaveLength(31)
    expect(new Set(rutas).size).toBe(31)
    expect(separadores).toBe(8)
  })

  // La ve todo admin del tenant (spec `2026-10-14-boleta-desde-la-venta` § 8.3): el interruptor de la emisión y el botón de las
  // pendientes son del dueño del local. Sin ser admin, ni el link ni la ruta.
  it('Boleta electrónica la ve el admin del tenant, entre Razones sociales y Usuarios', async () => {
    esAdmin = true
    permisos = PERMISOS_ADMIN

    const { arbol } = await arbolMontado()

    expect(arbol['Organización']).toEqual([
      '/configuracion/empresa',
      '/configuracion/razones-sociales',
      '/configuracion/boleta-electronica',
      '/configuracion/usuarios',
      '/configuracion/roles',
    ])
  })

  // Un tenant que solo contrató Paquetería: `mis-permisos` no le trae ningún módulo de este
  // menú. Las entradas de admin (endpoints sin módulo) siguen; las de módulo no, aunque sea admin.
  it('el admin de un tenant que no contrató ninguno de los módulos ve las entradas de admin pero no las de módulo', async () => {
    esAdmin = true
    permisos = ['Paquetería:Leer']

    const { arbol } = await arbolMontado()
    const rutas = Object.values(arbol).flat()

    expect(rutas).toContain('/configuracion/empresa')
    expect(rutas).toContain('/configuracion/usuarios')
    expect(rutas).toContain('/configuracion/categorias')
    expect(rutas).toContain('/configuracion/boleta-electronica')
    for (const ruta of [
      '/configuracion/items',
      '/configuracion/pasarelas',
      '/configuracion/cajas',
      '/configuracion/salones',
      '/configuracion/garzones',
      '/configuracion/turnos',
      '/configuracion/propinas-distribucion',
      '/configuracion/impresoras',
    ]) {
      expect(rutas).not.toContain(ruta)
    }
  })

  it('quien no es admin no la ve, aunque tenga otros permisos', async () => {
    permisos = ['Items:Leer']

    const { arbol } = await arbolMontado()

    expect(Object.values(arbol).flat()).not.toContain('/configuracion/boleta-electronica')
  })

  // Admin-only en el backend (`TenantAdminGuard`) y, además, solo si el tenant contrató el módulo.
  it('el admin de un tenant que contrató Paquetería ve Repartidores y Valores por defecto', async () => {
    esAdmin = true
    permisos = ['Paquetería:Leer']

    const { arbol } = await arbolMontado()

    expect(arbol['Paquetería']).toEqual(['/configuracion/repartidores', '/configuracion/paqueteria'])
  })

  it('el admin de un tenant que no la contrató no ve el grupo', async () => {
    esAdmin = true
    permisos = ['Items:Leer']

    const { arbol } = await arbolMontado()

    expect(arbol).not.toHaveProperty('Paquetería')
  })

  it('quien no es admin no ve el grupo, aunque tenga Paquetería:Leer', async () => {
    permisos = ['Paquetería:Leer', 'Items:Leer']

    const { arbol } = await arbolMontado()

    expect(arbol).not.toHaveProperty('Paquetería')
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

// Auditoría UX 07.26 / 07.1: un salto sobre el menú y, en tablet, un selector en vez de la columna.
describe('menú de configuración — accesibilidad y tablet', () => {
  it('ofrece "Saltar al contenido" apuntando al contenido', async () => {
    esAdmin = true
    const wrapper = await mountSuspended(Configuracion)
    const salto = wrapper.get('[data-qa="saltar-al-contenido"]')
    expect(salto.attributes('href')).toBe('#configuracion-contenido')
    expect(wrapper.find('#configuracion-contenido').exists()).toBe(true)
  })

  it('en pantalla angosta el menú se reemplaza por un selector y el contenido no lo comparte', async () => {
    esAdmin = true
    const wrapper = await mountSuspended(Configuracion)
    expect(wrapper.get('[data-qa="configuracion-selector"]').classes()).toContain('lg:hidden')
    expect(wrapper.get('[data-qa="configuracion-menu"]').classes()).toContain('hidden')
    expect(wrapper.get('[data-qa="configuracion-menu"]').classes()).toContain('lg:block')
  })

  it('las entradas del menú miden 44 px', async () => {
    esAdmin = true
    const wrapper = await mountSuspended(Configuracion)
    expect(wrapper.get('nav a').classes()).toContain('min-h-11')
  })
})
