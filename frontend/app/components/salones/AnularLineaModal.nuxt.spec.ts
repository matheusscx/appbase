// @vitest-environment nuxt
//
// Solo la rama nueva del modal: la línea de un producto con serie pide CUÁLES
// unidades se anulan, con casillas, en vez de una cantidad tipeada. La rama
// numérica (cantidad canónica, kg/g) ya la cubre `pages/salones/index.nuxt.spec.ts`
// § "anular un plato despachado".
//
// `useApiFetch` contesta lo que se le pida sin validar nada: lo que se afirma es el
// payload exacto del `confirm`, que es lo que después viaja al `POST .../anular`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AnularLineaModal from './AnularLineaModal.vue'
import type { CuentaLineaDetalle } from '~/composables/useSalones'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => apiFetch)

const MOTIVOS = [{ id: 'motivo-cortesia', nombre: 'Invitación', tipo: 'cortesia' }]

function lineaSerie(overrides: Partial<CuentaLineaDetalle> = {}): CuentaLineaDetalle {
  return {
    id: 'linea-1',
    itemId: 'it-1',
    nombre: 'iPhone 15',
    precioBase: '800000',
    monedaId: 'clp',
    cantidad: '3.0000',
    cantidadEnviada: '2.0000',
    unidades: [
      { id: 'u-1', serie: '350000000000001', condicion: 'nuevo' },
      { id: 'u-2', serie: '350000000000002', condicion: 'usado' },
      { id: 'u-3', serie: '350000000000003', condicion: 'nuevo' },
    ],
    ...overrides,
  }
}

function dialogo(): HTMLElement {
  const d = document.body.querySelector<HTMLElement>('[role="dialog"]')
  expect(d, 'el modal abierto').toBeTruthy()
  return d!
}

function casillas(): HTMLElement[] {
  return [...dialogo().querySelectorAll<HTMLElement>('[role="checkbox"]')]
}

function botonAnular(): HTMLButtonElement {
  return [...dialogo().querySelectorAll('button')].find(b => b.textContent?.trim() === 'Anular')!
}

let montado: { unmount: () => void } | null = null
afterEach(() => {
  montado?.unmount()
  montado = null
})

async function abrir(linea: CuentaLineaDetalle) {
  const wrapper = await mountSuspended(AnularLineaModal, {
    props: { open: true, linea, unidadBase: 'unidad' },
  })
  montado = wrapper
  await new Promise(r => setTimeout(r, 50))
  return wrapper
}

async function tildar(indice: number) {
  casillas()[indice]!.click()
  await new Promise(r => setTimeout(r, 20))
}

async function elegirMotivo(wrapper: Awaited<ReturnType<typeof abrir>>) {
  wrapper.findComponent({ name: 'USelectMenu' }).vm.$emit('update:modelValue', 'motivo-cortesia')
  await new Promise(r => setTimeout(r, 10))
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockResolvedValue(MOTIVOS)
})

describe('AnularLineaModal — línea con serie', () => {
  it('muestra una casilla por unidad, con su serie y condición, y no el input numérico', async () => {
    const wrapper = await abrir(lineaSerie())

    expect(casillas()).toHaveLength(3)
    const texto = dialogo().textContent!
    expect(texto).toContain('350000000000001')
    expect(texto).toContain('350000000000002')
    expect(texto).toContain('Usado')
    expect(wrapper.findComponent({ name: 'UInputNumber' }).exists()).toBe(false)
  })

  it('sin unidades en la línea sigue el input numérico de siempre', async () => {
    const wrapper = await abrir(lineaSerie({ unidades: [] }))

    expect(casillas()).toHaveLength(0)
    expect(wrapper.findComponent({ name: 'UInputNumber' }).exists()).toBe(true)
  })

  it('no se puede anular sin marcar ninguna unidad', async () => {
    const wrapper = await abrir(lineaSerie())
    await elegirMotivo(wrapper)

    expect(botonAnular().disabled).toBe(true)
    await tildar(0)
    expect(botonAnular().disabled).toBe(false)
  })

  it('el tope es lo despachado: con 2 enviadas, la tercera casilla queda bloqueada', async () => {
    await abrir(lineaSerie({ cantidadEnviada: '2.0000' }))

    await tildar(0)
    await tildar(1)

    expect(casillas()[2]!.hasAttribute('disabled')).toBe(true)
    // Una marcada sigue pudiéndose desmarcar: el tope bloquea sumar, no sacar.
    expect(casillas()[0]!.hasAttribute('disabled')).toBe(false)
  })

  it('emite { cantidad, unidadIds, motivoBajaId } con las marcadas', async () => {
    const wrapper = await abrir(lineaSerie({ cantidadEnviada: '2.0000' }))
    await elegirMotivo(wrapper)

    await tildar(0)
    await tildar(1)
    botonAnular().click()
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.emitted('confirm')).toEqual([[
      { cantidad: '2', unidadIds: ['u-1', 'u-2'], motivoBajaId: 'motivo-cortesia' },
    ]])
  })

  it('al reabrirlo arranca sin nada marcado', async () => {
    const wrapper = await abrir(lineaSerie())
    await tildar(0)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await new Promise(r => setTimeout(r, 50))

    expect(casillas().every(c => c.getAttribute('aria-checked') !== 'true')).toBe(true)
  })
})
