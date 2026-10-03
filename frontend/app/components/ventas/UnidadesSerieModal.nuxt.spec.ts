// @vitest-environment nuxt
//
// Entorno nuxt SOLO en este archivo: lo que el cajero ve es el `UCheckbox` y el
// `UModal` reales, y el contrato con quien lo abre (qué lista, qué marca ya, qué
// devuelve al confirmar) solo se prueba montado.
//
// `useApiFetch` contesta lo que se le diga sin validar nada: por eso se afirma la
// URL que se pidió (`vendibles=true` es lo que deja afuera lo apartado por una
// cuenta abierta) y el payload exacto del `confirm`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import UnidadesSerieModal from './UnidadesSerieModal.vue'

const { apiFetch, toastAdd } = vi.hoisted(() => ({ apiFetch: vi.fn(), toastAdd: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
mockNuxtImport('useApiFetch', () => apiFetch)

const unidad = (id: string, serie: string, condicion = 'nuevo', garantiaHasta: string | null = null) => ({
  id, serie, estado: 'disponible', condicion, garantiaHasta, loteId: null, codigoLote: null,
  ventaId: null, creadoEl: '2026-10-01T00:00:00.000Z', ubicacionId: 'loc-1',
})

const VENDIBLES = [
  unidad('u-1', '350000000000001', 'nuevo'),
  unidad('u-2', '350000000000002', 'usado', '2027-03-15'),
  unidad('u-3', '351111111111111', 'reacondicionado'),
]

function dialogo(): HTMLElement {
  const d = document.body.querySelector<HTMLElement>('[role="dialog"]')
  expect(d, 'el modal abierto').toBeTruthy()
  return d!
}

function filas(): HTMLElement[] {
  return [...dialogo().querySelectorAll<HTMLElement>('[data-qa="unidad-fila"]')]
}

function marcadas(): string[] {
  return filas()
    .filter(f => f.querySelector('[role="checkbox"]')!.getAttribute('aria-checked') === 'true')
    .map(f => f.getAttribute('data-serie')!)
}

function botonConfirmar(): HTMLButtonElement {
  return dialogo().querySelector<HTMLButtonElement>('[data-qa="unidades-confirmar"]')!
}

/** El modal se teletransporta al body: sin desmontar, el siguiente test ve el diálogo del anterior. */
let montado: { unmount: () => void } | null = null
afterEach(() => {
  montado?.unmount()
  montado = null
})

async function abrir(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(UnidadesSerieModal, {
    props: { open: true, item: { id: 'it-1', nombre: 'iPhone 15' }, seleccionadas: [], excluir: [], ...props },
  })
  montado = wrapper
  await new Promise(r => setTimeout(r, 50))
  return wrapper
}

async function tildar(serie: string) {
  const fila = filas().find(f => f.getAttribute('data-serie') === serie)
  expect(fila, `la fila de ${serie}`).toBeTruthy()
  fila!.querySelector<HTMLElement>('[role="checkbox"]')!.click()
  await new Promise(r => setTimeout(r, 20))
}

async function escribirBusqueda(texto: string, enter = false) {
  const input = dialogo().querySelector<HTMLInputElement>('[data-qa="unidades-buscador"]')!
  input.value = texto
  input.dispatchEvent(new Event('input', { bubbles: true }))
  if (enter) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await new Promise(r => setTimeout(r, 20))
}

beforeEach(() => {
  toastAdd.mockReset()
  apiFetch.mockReset()
  apiFetch.mockResolvedValue(VENDIBLES)
})

describe('UnidadesSerieModal', () => {
  it('pide solo las vendibles del ítem y las lista con condición y garantía', async () => {
    await abrir()

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(String(apiFetch.mock.calls[0]![0])).toMatch(/\/items\/it-1\/unidades\?vendibles=true$/)
    expect(filas()).toHaveLength(3)
    const texto = dialogo().textContent!
    expect(texto).toContain('Nuevo')
    expect(texto).toContain('Usado')
    expect(texto).toContain('Reacondicionado')
    expect(texto).toMatch(/Garantía/)
  })

  it('"Confirmar (N)" está deshabilitado con 0 elegidas', async () => {
    await abrir()

    expect(botonConfirmar().disabled).toBe(true)
    expect(botonConfirmar().textContent).toContain('Confirmar (0)')
    await tildar('350000000000001')
    expect(botonConfirmar().disabled).toBe(false)
    expect(botonConfirmar().textContent).toContain('Confirmar (1)')
  })

  it('el buscador filtra por serie', async () => {
    await abrir()

    await escribirBusqueda('3511')

    expect(filas().map(f => f.getAttribute('data-serie'))).toEqual(['351111111111111'])
  })

  it('Enter con una sola coincidencia la marca y limpia el filtro (escaneo)', async () => {
    await abrir()

    await escribirBusqueda('351111111111111', true)

    expect(marcadas()).toEqual(['351111111111111'])
    // El filtro quedó limpio: vuelven a verse las tres (el `value` del input no se mira,
    // happy-dom no lo repinta tras una escritura manual).
    expect(filas()).toHaveLength(3)
  })

  it('Enter con más de una coincidencia no marca nada', async () => {
    await abrir()

    await escribirBusqueda('35000000000000', true)

    expect(filas()).toHaveLength(2)
    expect(marcadas()).toEqual([])
  })

  it('confirmar emite las elegidas completas, no solo los ids', async () => {
    const wrapper = await abrir()

    await tildar('350000000000002')
    await tildar('350000000000001')
    botonConfirmar().click()
    await new Promise(r => setTimeout(r, 20))

    const emitido = wrapper.emitted('confirm')
    expect(emitido).toHaveLength(1)
    expect(emitido![0]![0]).toEqual([
      { id: 'u-1', serie: '350000000000001', condicion: 'nuevo' },
      { id: 'u-2', serie: '350000000000002', condicion: 'usado' },
    ])
  })

  it('las excluidas (de otras líneas de esta pantalla) no se ofrecen', async () => {
    await abrir({ excluir: ['u-2'] })

    expect(filas().map(f => f.getAttribute('data-serie'))).toEqual(['350000000000001', '351111111111111'])
  })

  it('las seleccionadas se muestran marcadas aunque ya no vengan como vendibles', async () => {
    // En el salón están apartadas por la propia cuenta: `vendibles=true` no las trae.
    await abrir({ seleccionadas: [{ id: 'u-9', serie: 'IMEI-APARTADO', condicion: 'usado' }] })

    expect(filas().map(f => f.getAttribute('data-serie'))).toContain('IMEI-APARTADO')
    expect(marcadas()).toEqual(['IMEI-APARTADO'])
    expect(botonConfirmar().textContent).toContain('Confirmar (1)')
  })

  it('una seleccionada que también viene como vendible no se duplica', async () => {
    await abrir({ seleccionadas: [{ id: 'u-1', serie: '350000000000001', condicion: 'nuevo' }] })

    expect(filas()).toHaveLength(3)
    expect(marcadas()).toEqual(['350000000000001'])
  })

  it('una seleccionada que también viene como vendible conserva su garantía', async () => {
    // `seleccionadas` solo trae id, serie y condición: la garantía sale de la respuesta de vendibles.
    await abrir({ seleccionadas: [{ id: 'u-2', serie: '350000000000002', condicion: 'usado' }] })

    const fila = filas().find(f => f.getAttribute('data-serie') === '350000000000002')!
    expect(fila.textContent).toMatch(/Garantía hasta/)
    expect(marcadas()).toEqual(['350000000000002'])
  })

  it('desmarcar una seleccionada la saca del conjunto que se confirma', async () => {
    const wrapper = await abrir({
      seleccionadas: [
        { id: 'u-1', serie: '350000000000001', condicion: 'nuevo' },
        { id: 'u-2', serie: '350000000000002', condicion: 'usado' },
      ],
    })

    await tildar('350000000000001')
    botonConfirmar().click()
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.emitted('confirm')![0]![0]).toEqual([
      { id: 'u-2', serie: '350000000000002', condicion: 'usado' },
    ])
  })

  it('las fijas abren marcadas, no se pueden desmarcar y se confirman junto con las nuevas', async () => {
    // Salón, línea ya despachada: las que están en la mesa no salen por acá, se anulan.
    const wrapper = await abrir({
      seleccionadas: [
        { id: 'u-1', serie: '350000000000001', condicion: 'nuevo' },
        { id: 'u-2', serie: '350000000000002', condicion: 'usado' },
      ],
      fijas: ['u-1', 'u-2'],
    })

    await tildar('350000000000001')
    expect(marcadas()).toEqual(['350000000000001', '350000000000002'])
    const fija = filas().find(f => f.getAttribute('data-serie') === '350000000000001')!
    expect(fija.querySelector('[role="checkbox"]')!.hasAttribute('disabled')).toBe(true)
    expect(dialogo().querySelector('[data-qa="unidades-fijas-aviso"]')?.textContent).toMatch(/anul/i)

    await tildar('351111111111111')
    botonConfirmar().click()
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.emitted('confirm')![0]![0]).toEqual([
      { id: 'u-1', serie: '350000000000001', condicion: 'nuevo' },
      { id: 'u-2', serie: '350000000000002', condicion: 'usado' },
      { id: 'u-3', serie: '351111111111111', condicion: 'reacondicionado' },
    ])
  })

  it('sin fijas no hay aviso y todas se pueden desmarcar', async () => {
    await abrir({ seleccionadas: [{ id: 'u-1', serie: '350000000000001', condicion: 'nuevo' }] })

    expect(dialogo().querySelector('[data-qa="unidades-fijas-aviso"]')).toBeNull()
    await tildar('350000000000001')
    expect(marcadas()).toEqual([])
  })

  it('si la carga falla no dice que el local no tiene unidades: avisa por toast y muestra el error', async () => {
    apiFetch.mockRejectedValue(new Error('boom'))
    await abrir()

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
    expect(dialogo().textContent).not.toContain('No hay unidades de')
    expect(dialogo().textContent).toContain('No se pudieron cargar las unidades')
  })

  it('sin unidades en el local: estado vacío con el nombre del producto', async () => {
    apiFetch.mockResolvedValue([])
    await abrir()

    expect(dialogo().textContent).toContain('No hay unidades de «iPhone 15» en el local')
    expect(botonConfirmar().disabled).toBe(true)
  })
})
