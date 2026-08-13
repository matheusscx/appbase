// @vitest-environment nuxt
//
// El gate del cierre forzado es `Cajas:Actualizar` (decisión del owner
// 2026-08-13: forzar pasa a ser operativo, no exclusivo del admin del
// tenant) — `caja.controller.ts` resuelve `puedeForzar` a mano
// (`resolverEscrituraCompartida`) contra `Cajas:Actualizar` y
// `caja.service.ts` rechaza el cierre ajeno si `!puedeForzar`. El admin lo
// conserva vía `usePermisosCrud` (`esAdmin || can(...)`), así que sigue
// viendo el botón sin necesidad del permiso de módulo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaCierreForzadoPanel from './CajaCierreForzadoPanel.vue'
import type { Caja } from '~/stores/caja'

const USUARIO_ACTUAL_ID = 'admin-1'

let esAdmin = false
let permisos: string[] = []
let sesionesAbiertas: { garzonId: string, garzonNombre: string }[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

mockNuxtImport('useSesionesGarzon', () => {
  return () => ({ listarAbiertas: vi.fn(async () => sesionesAbiertas) })
})

const cajaStoreMock = {
  testigos: [] as unknown[],
  cargarTestigos: vi.fn(async () => {}),
  solicitarTestigos: vi.fn(async () => {}),
}
mockNuxtImport('useCajaStore', () => () => cajaStoreMock)

const stubs = {
  // El drawer no es lo que se prueba acá (tiene su propio spec); alcanza con
  // que exista sin arrastrar `UDrawer`/`useAppConfig`.
  CajaCierreDrawer: true,
}

function cajaAjenaAbierta(over: Partial<Caja> = {}): Caja {
  return {
    id: 'caja-1',
    tenantId: 't1',
    usuarioId: 'cajero-1',
    tipo: 'fisica',
    estado: 'abierta',
    saldoInicial: '1000.0000',
    saldoFinal: null,
    montoContado: null,
    diferencia: null,
    fechaApertura: '2026-08-13T10:00:00Z',
    fechaCierre: null,
    comentario: null,
    cajonId: 'cajon-1',
    cajonNombre: 'Caja Principal',
    usuarioNombre: 'Bruno Cajero',
    ...over,
  }
}

function montar(caja: Caja) {
  return mountSuspended(CajaCierreForzadoPanel, {
    global: { stubs },
    props: { caja, usuarioActualId: USUARIO_ACTUAL_ID },
  })
}

beforeEach(() => {
  esAdmin = false
  permisos = []
  sesionesAbiertas = []
  cajaStoreMock.testigos = []
  cajaStoreMock.cargarTestigos.mockClear()
  cajaStoreMock.solicitarTestigos.mockClear()
})

describe('CajaCierreForzadoPanel — el botón de cerrar la caja de otro', () => {
  it('la acción de cerrar la caja de otro aparece para el admin del tenant', async () => {
    esAdmin = true
    const wrapper = await montar(cajaAjenaAbierta())

    expect(wrapper.find('[data-qa="cerrar-caja-ajena"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Bruno Cajero')
  })

  it('también aparece para un encargado no-admin con Cajas:Actualizar', async () => {
    esAdmin = false
    permisos = ['Cajas:Actualizar']
    const wrapper = await montar(cajaAjenaAbierta())

    expect(wrapper.find('[data-qa="cerrar-caja-ajena"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Bruno Cajero')
  })

  it('con Cajas:Leer a secas (sin Actualizar) el botón NO aparece, aunque la caja esté abierta y sea ajena', async () => {
    esAdmin = false
    permisos = ['Cajas:Leer']
    const wrapper = await montar(cajaAjenaAbierta())

    expect(wrapper.find('[data-qa="cerrar-caja-ajena"]').exists()).toBe(false)
  })

  it('sin ningún permiso de Cajas ni ser admin, el botón no aparece aunque la caja esté abierta y sea ajena', async () => {
    esAdmin = false
    permisos = []
    const wrapper = await montar(cajaAjenaAbierta())

    expect(wrapper.find('[data-qa="cerrar-caja-ajena"]').exists()).toBe(false)
  })

  it('si la caja es la propia (no ajena), el botón tampoco aparece aunque tenga Cajas:Actualizar', async () => {
    esAdmin = false
    permisos = ['Cajas:Actualizar']
    const wrapper = await montar(cajaAjenaAbierta({ usuarioId: USUARIO_ACTUAL_ID }))

    expect(wrapper.find('[data-qa="cerrar-caja-ajena"]').exists()).toBe(false)
  })
})

describe('CajaCierreForzadoPanel — pedir firma', () => {
  function cajaForzadaEnConciliacion(over: Partial<Caja> = {}): Caja {
    return cajaAjenaAbierta({
      estado: 'en_conciliacion',
      cerradaPor: USUARIO_ACTUAL_ID,
      ...over,
    })
  }

  // El panel de firma comparte el mismo gate que el botón de cerrar (`Cajas:Actualizar`):
  // estos tests ejercitan lo que pasa DESPUÉS de que alguien ya forzó, así que el permiso
  // de escritura tiene que estar puesto para que `mostrarPanelFirma` no lo tape.
  beforeEach(() => {
    permisos = ['Cajas:Actualizar']
  })

  it('muestra cuántos garzones hay en turno, y avisa cuando no hay ninguno', async () => {
    sesionesAbiertas = []
    const wrapper = await montar(cajaForzadaEnConciliacion())
    await new Promise(resolve => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('No hay garzones en turno ahora mismo')
    expect(wrapper.text()).toMatch(/explicar por qué/)
  })

  it('con garzones en turno, muestra el conteo y permite seleccionarlos', async () => {
    sesionesAbiertas = [
      { garzonId: 'g1', garzonNombre: 'Ana' },
      { garzonId: 'g2', garzonNombre: 'Beto' },
    ]
    const wrapper = await montar(cajaForzadaEnConciliacion())
    await new Promise(resolve => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('2 garzones en turno')
    expect(wrapper.text()).toContain('Ana')
    expect(wrapper.text()).toContain('Beto')
  })

  it('el panel de pedir firma NO aparece si la caja no fue cerrada de forma forzada (cerradaPor === usuarioId)', async () => {
    const wrapper = await montar(cajaForzadaEnConciliacion({ cerradaPor: 'cajero-1', usuarioId: 'cajero-1' }))

    expect(wrapper.find('[data-qa="panel-pedir-firma"]').exists()).toBe(false)
  })
})
