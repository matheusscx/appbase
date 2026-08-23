// @vitest-environment nuxt
//
// La fase 2 (conciliación) del cierre forzado: la brecha era que un cierre
// forzado que CUADRA deja `descuadres` vacío, `conciliacionCompleta` daba
// `true` por construcción (`[].every(...)` es `true`) y el botón se
// habilitaba aunque nadie hubiera firmado como testigo — el backend
// (`caja.service.ts` → `cerrar`) igual respondía 400, pero recién ahí. Estos
// tests cubren el gate en la UI: sin firma y sin comentario previo de fase 1,
// el botón queda deshabilitado; si la fase 1 ya dejó un comentario
// (`caja.comentarioCierre`), alcanza como explicación y el botón se habilita
// sin pedir un segundo comentario — una UI más estricta que el backend
// contradice al backend.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import CajaCierreDrawer from './CajaCierreDrawer.vue'

const cajaStoreMock = reactive<{
  arqueoCiego: boolean
  motivos: unknown[]
  arqueo: unknown[]
  testigos: { id: string, estado: string }[]
  detalle: {
    id: string
    comentarioCierre: string | null
    nivelDescuadre?: 'ninguno' | 'aviso' | 'alto'
    explicacionDescuadre?: string | null
  } | null
  activa: unknown
  cargarArqueo: () => Promise<void>
  cargarMotivos: () => Promise<void>
  cargarTestigos: () => Promise<void>
  cargarDetalle: () => Promise<void>
  enviarConteo: () => Promise<{ estado: string, arqueo: unknown[], nivelDescuadre: string }>
  cerrar: () => Promise<{ caja: unknown, arqueo: unknown[] }>
}>({
  arqueoCiego: false,
  motivos: [],
  arqueo: [],
  testigos: [],
  detalle: null,
  activa: null,
  cargarArqueo: vi.fn(async () => {}),
  cargarMotivos: vi.fn(async () => {}),
  cargarTestigos: vi.fn(async () => {}),
  cargarDetalle: vi.fn(async () => {}),
  enviarConteo: vi.fn(async () => ({ estado: 'cerrada', arqueo: [], nivelDescuadre: 'ninguno' })),
  cerrar: vi.fn(async () => ({ caja: {}, arqueo: [] })),
})

mockNuxtImport('useCajaStore', () => () => cajaStoreMock)

// `UDrawer` (Nuxt UI, sobre reka-ui) llama `useAppConfig()` en su propio
// `setup()`: stubear `AppDrawer` con template propio (mismo patrón que
// `AppDrawer.spec.ts` y `docs/patterns/frontend.md` §15) — su contenido NO
// se teletransporta, así que el botón se busca en el wrapper.
const stubs = {
  AppDrawer: {
    name: 'AppDrawer',
    props: ['open', 'width'],
    emits: ['update:open'],
    template: '<div v-if="open"><slot name="header" /><slot name="body" /><slot name="actions" /></div>',
  },
}

// Línea de efectivo SIN descuadre: el conteo cuadró.
const ARQUEO_CUADRADO = [
  {
    metodoPagoId: null,
    nombre: 'Efectivo',
    esEfectivo: true,
    esperado: '1000.0000',
    requiereConteo: true,
    contado: '1000.0000',
    diferencia: '0.0000',
  },
]

async function montarEnConciliacionForzada(
  comentarioCierre: string | null,
  testigos: { id: string, estado: string }[] = [],
) {
  Object.assign(cajaStoreMock, {
    arqueoCiego: false,
    motivos: [],
    arqueo: ARQUEO_CUADRADO,
    testigos,
    detalle: { id: 'caja-1', comentarioCierre },
    activa: null,
  })

  const wrapper = await mountSuspended(CajaCierreDrawer, {
    attachTo: document.body,
    global: { stubs },
    props: { cajaId: 'caja-1', resumir: true, forzado: true, open: false },
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

function botonConfirmar(wrapper: Awaited<ReturnType<typeof montarEnConciliacionForzada>>) {
  const botones = wrapper.findAll('button').filter(b => b.text().includes('Confirmar cierre'))
  expect(botones).toHaveLength(1)
  return botones[0]!
}

describe('CajaCierreDrawer — fase 2, cierre forzado sin testigo', () => {
  it('sin firma y sin comentario previo, confirmar el cierre queda deshabilitado', async () => {
    const wrapper = await montarEnConciliacionForzada(null)

    expect(botonConfirmar(wrapper).attributes('disabled')).toBeDefined()
  })

  it('si la fase 1 ya dejó comentario, confirmar se habilita aunque nadie haya firmado', async () => {
    const wrapper = await montarEnConciliacionForzada('el cajero se fue de turno, cerré yo el conteo')

    expect(botonConfirmar(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('si alguien firmó como testigo, confirmar se habilita sin necesitar comentario', async () => {
    const wrapper = await montarEnConciliacionForzada(null, [{ id: 't1', estado: 'firmada' }])

    expect(botonConfirmar(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('un cierre NO forzado (owner cerrando su propia caja) no exige ni firma ni comentario', async () => {
    Object.assign(cajaStoreMock, {
      arqueoCiego: false,
      motivos: [],
      arqueo: ARQUEO_CUADRADO,
      testigos: [],
      detalle: { id: 'caja-1', comentarioCierre: null },
      activa: null,
    })

    const wrapper = await mountSuspended(CajaCierreDrawer, {
      attachTo: document.body,
      global: { stubs },
      props: { cajaId: 'caja-1', resumir: true, open: false }, // sin `forzado`
    })
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(botonConfirmar(wrapper).attributes('disabled')).toBeUndefined()
  })
})

/**
 * El aviso del umbral en la fase 2. La distinción que sostienen estos tests:
 * `aviso` y `alto` dicen cosas DISTINTAS (al alto le llega al encargado) y
 * NINGUNO de los dos deshabilita el botón de cerrar — que es toda la decisión
 * del owner del 2026-08-23. Un test que solo mirara que aparece un cartel no
 * probaría lo que importa.
 */
describe('CajaCierreDrawer — aviso de umbral de descuadre', () => {
  const ARQUEO_DESCUADRADO = [
    {
      metodoPagoId: null,
      nombre: 'Efectivo',
      esEfectivo: true,
      esperado: '10000.0000',
      requiereConteo: true,
      contado: '2000.0000',
      diferencia: '-8000.0000',
    },
  ]

  async function montarConNivel(nivel: 'ninguno' | 'aviso' | 'alto') {
    Object.assign(cajaStoreMock, {
      arqueoCiego: false,
      motivos: [{ id: 'm1', nombre: 'Falta de efectivo', activo: true, requiereComentario: false, esFijo: true }],
      arqueo: ARQUEO_DESCUADRADO,
      testigos: [],
      detalle: { id: 'caja-1', comentarioCierre: null, nivelDescuadre: nivel, explicacionDescuadre: null },
      activa: null,
    })

    const wrapper = await mountSuspended(CajaCierreDrawer, {
      attachTo: document.body,
      global: { stubs },
      props: { cajaId: 'caja-1', resumir: true, open: false },
    })
    await wrapper.setProps({ open: true })
    await flushPromises()
    return wrapper
  }

  it('nivel aviso: avisa, pide la nota como opcional y NO menciona al encargado', async () => {
    const wrapper = await montarConNivel('aviso')

    expect(wrapper.find('[data-qa="cierre-umbral-aviso"]').exists()).toBe(true)
    expect(wrapper.find('[data-qa="cierre-umbral-alto"]').exists()).toBe(false)
    expect(wrapper.find('[data-qa="cierre-explicacion-descuadre"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('encargado')
  })

  it('nivel alto: le dice al cajero que su cierre va a revisarse', async () => {
    const wrapper = await montarConNivel('alto')

    expect(wrapper.find('[data-qa="cierre-umbral-alto"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('encargado')
  })

  it('nivel ninguno: no aparece ningún aviso ni el campo de explicación', async () => {
    const wrapper = await montarConNivel('ninguno')

    expect(wrapper.find('[data-qa="cierre-umbral-aviso"]').exists()).toBe(false)
    expect(wrapper.find('[data-qa="cierre-umbral-alto"]').exists()).toBe(false)
    expect(wrapper.find('[data-qa="cierre-explicacion-descuadre"]').exists()).toBe(false)
  })

  it('ningún nivel bloquea: con el motivo puesto, confirmar sigue habilitado incluso en alto', async () => {
    const wrapper = await montarConNivel('alto')

    // El motivo por línea es lo único obligatorio de la fase 2 (y ya existía).
    // Se selecciona por el `USelect` de la línea descuadrada.
    const select = wrapper.findComponent({ name: 'USelect' })
    await select.setValue('m1')
    await flushPromises()

    expect(botonConfirmar(wrapper).attributes('disabled')).toBeUndefined()
  })
})
