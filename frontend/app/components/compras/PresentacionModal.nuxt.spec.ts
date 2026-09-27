// @vitest-environment nuxt
//
// Crear, editar o retirar una presentación de compra (spec pieza 2 § 3.1 y §
// 6). Lo que fija: el body de crear y editar es el que los DTOs del backend
// aceptan (strings, sin `tenantId`, y editar solo con lo que cambió, nunca
// `null`), y retirar manda el DELETE recién tras la confirmación inline.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useUnidadesMedidaStore } from '~/stores/unidades-medida'
import type { PresentacionCompra } from '~/composables/useCompras'
import PresentacionModal from './PresentacionModal.vue'

const llamadas: { url: string, method?: string, body?: unknown }[] = []

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown }) => {
  llamadas.push({ url: url.split('/api').pop()!, method: opts?.method, body: opts?.body })
  return Promise.resolve({ id: 'pres-1', itemId: 'item-latas', nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' })
})

const ITEM_CONTEO = { id: 'item-latas', nombre: 'Coca-Cola lata', unidadMedida: 'unidad' }
const ITEM_PESO = { id: 'item-harina', nombre: 'Harina', unidadMedida: 'kg' }

const PRESENTACION: PresentacionCompra = {
  id: 'pres-1', itemId: 'item-latas', nombre: 'Caja', contenido: '12.0000', unidadCodigo: 'unidad',
}

function hidratarUnidades() {
  useUnidadesMedidaStore().hydrate([
    { unidadMedidaId: 'u1', codigo: 'unidad', nombre: 'Unidad', magnitud: 'conteo', factorBase: '1' },
    { unidadMedidaId: 'u2', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'peso', factorBase: '1000' },
    { unidadMedidaId: 'u3', codigo: 'g', nombre: 'Gramo', magnitud: 'peso', factorBase: '1' },
  ])
}

async function abrir(item: typeof ITEM_CONTEO | typeof ITEM_PESO, presentacion: PresentacionCompra | null) {
  hidratarUnidades()
  const wrapper = await mountSuspended(PresentacionModal, {
    props: { proveedorId: 'prov-1', item, presentacion, open: true },
  })
  // Montado ya abierto: el `watch(open)` no corre solo (mismo gesto que
  // `DescuentoModal.nuxt.spec.ts`).
  await wrapper.setProps({ open: false })
  await wrapper.setProps({ open: true })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof abrir>>

async function tipear(qa: string, valor: string) {
  const el = document.body.querySelector(`[data-qa="${qa}"]`) as HTMLInputElement
  expect(el, qa).toBeTruthy()
  el.value = valor
  el.dispatchEvent(new Event('input'))
  await new Promise(r => setTimeout(r, 0))
}

function boton(qa: string): HTMLButtonElement {
  return document.body.querySelector(`[data-qa="${qa}"]`) as HTMLButtonElement
}

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas.length = 0
})

describe('PresentacionModal — crear', () => {
  it('manda POST con strings, sin tenantId', async () => {
    await abrir(ITEM_CONTEO, null)
    await tipear('presentacion-nombre', 'Caja')
    await tipear('presentacion-contenido', '12')

    boton('presentacion-guardar').click()
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas).toEqual([{
      url: '/compras/presentaciones',
      method: 'POST',
      body: { proveedorId: 'prov-1', itemId: 'item-latas', nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' },
    }])
  })

  it('contenido vacío o 0 deja Guardar deshabilitado', async () => {
    await abrir(ITEM_CONTEO, null)
    await tipear('presentacion-nombre', 'Caja')
    expect(boton('presentacion-guardar').disabled).toBe(true)

    await tipear('presentacion-contenido', '0')
    expect(boton('presentacion-guardar').disabled).toBe(true)

    await tipear('presentacion-contenido', '12')
    expect(boton('presentacion-guardar').disabled).toBe(false)
  })

  it('en un producto por peso, la unidad ofrece las compatibles (kg, g)', async () => {
    await abrir(ITEM_PESO, null)
    const select = document.body.querySelector('[data-qa="presentacion-unidad"]')
    expect(select?.textContent).toContain('kg')
  })
})

describe('PresentacionModal — editar', () => {
  it('manda PATCH solo con lo que cambió, nunca null', async () => {
    await abrir(ITEM_CONTEO, PRESENTACION)
    await tipear('presentacion-contenido', '12')
    expect(boton('presentacion-guardar').disabled).toBe(true)

    await tipear('presentacion-contenido', '24')
    boton('presentacion-guardar').click()
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas).toEqual([{
      url: '/compras/presentaciones/pres-1',
      method: 'PATCH',
      body: { contenido: '24' },
    }])
  })
})

describe('PresentacionModal — retirar', () => {
  it('no aparece al crear', async () => {
    const wrapper = await abrir(ITEM_CONTEO, null)
    expect(document.body.querySelector('[data-qa="presentacion-retirar"]')).toBeNull()
    wrapper.unmount()
  })

  it('al editar pide confirmar antes del DELETE, y emite retirada', async () => {
    const wrapper: Wrapper = await abrir(ITEM_CONTEO, PRESENTACION)
    boton('presentacion-retirar').click()
    await new Promise(r => setTimeout(r, 0))
    expect(llamadas).toHaveLength(0)

    boton('presentacion-retirar-si').click()
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas).toEqual([{ url: '/compras/presentaciones/pres-1', method: 'DELETE', body: undefined }])
    expect(wrapper.emitted('retirada')).toEqual([['pres-1']])
  })
})
