// @vitest-environment nuxt
//
// Lo que fija: quién puede editar la distribución de propinas. La pantalla se lee con
// `Propinas:Leer` y se edita con `Propinas:Configurar`; el admin del tenant no tiene
// atajo (owner, 2026-10-15): `mis-permisos` le trae el catálogo de los módulos que su
// tenant contrató, y el backend le contesta 403 en los demás.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { DistribucionPublica } from '~/composables/usePropinaDistribucion'
import PropinasDistribucion from './propinas-distribucion.vue'

let esAdmin = false
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => () => ({
  get esAdmin() { return esAdmin },
  can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
}))

/** `DistribucionPublica` — forma real de `GET /propinas/distribucion`. */
const DISTRIBUCION: DistribucionPublica = {
  id: 'dist-1',
  version: 1,
  porcentajeSugerido: '0.10',
  habilitadoPos: true,
  habilitadoSalones: true,
  actualizadoPor: null,
  actualizadoEl: '2026-10-15T12:00:00.000Z',
  grupos: [],
}

mockNuxtImport('usePropinaDistribucion', () => () => ({
  obtener: () => Promise.resolve(DISTRIBUCION),
  reemplazar: () => Promise.resolve(DISTRIBUCION),
}))

mockNuxtImport('useGarzones', () => () => ({
  listar: () => Promise.resolve([]),
}))

async function montar() {
  const wrapper = await mountSuspended(PropinasDistribucion)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

function sugeridaEditable(wrapper: Awaited<ReturnType<typeof montar>>) {
  const input = wrapper.find('[data-qa="propina-sugerida-pct"]')
  expect(input.exists(), 'el campo de propina sugerida se dibuja').toBe(true)
  return !(input.element as HTMLInputElement).disabled
}

beforeEach(() => {
  esAdmin = false
  permisos = []
})

describe('configuracion/propinas-distribucion — quién edita', () => {
  it('con Propinas:Configurar se edita', async () => {
    permisos = ['Propinas:Leer', 'Propinas:Configurar']
    expect(sugeridaEditable(await montar())).toBe(true)
  })

  it('con solo Propinas:Leer se lee pero no se edita', async () => {
    permisos = ['Propinas:Leer']
    expect(sugeridaEditable(await montar())).toBe(false)
  })

  it('el admin de un tenant que contrató Propinas edita', async () => {
    esAdmin = true
    permisos = [
      'Propinas:Leer', 'Propinas:Crear', 'Propinas:Actualizar', 'Propinas:Eliminar',
      'Propinas:Configurar', 'Propinas:Liquidar',
    ]
    expect(sugeridaEditable(await montar())).toBe(true)
  })

  it('el admin de un tenant que no contrató Propinas no edita', async () => {
    esAdmin = true
    permisos = ['Paquetería:Leer']
    expect(sugeridaEditable(await montar())).toBe(false)
  })
})
