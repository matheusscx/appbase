// @vitest-environment nuxt
//
// Corregir total o vencimiento de una compra confirmada (spec
// compras-deuda-proveedor § 6). Lo que fija: solo lo que cambió viaja al
// `PATCH /compras/:id/documento` (ausente = no se toca, ni siquiera un valor
// que ya venía cuantizado distinto en el texto), `totalDocumento` no se
// muestra en un tipo `suma_lineas`, y `null` solo sale en un tipo `opcional`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import type { TotalDocumentoTipo } from '~/composables/useCompras'
import CorregirDocumentoModal from './CorregirDocumentoModal.vue'

const llamadas: { url: string, method?: string, body?: unknown }[] = []

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown }) => {
  llamadas.push({ url: url.split('/api').pop()!, method: opts?.method, body: opts?.body })
  return Promise.resolve({ id: 'compra-1' })
})

async function abrir(props: {
  totalDocumentoTipo: TotalDocumentoTipo
  totalDocumentoActual: string | null
  fechaVencimientoActual: string | null
}) {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(CorregirDocumentoModal, {
    props: { compraId: 'compra-1', open: true, ...props },
  })
  // Mismo patrón que `DescuentoModal.nuxt.spec.ts`: el `watch(open)` no corre
  // montado ya abierto, así que se cierra y se abre como en la pantalla real.
  await wrapper.setProps({ open: false })
  await wrapper.setProps({ open: true })
  await new Promise(r => setTimeout(r, 50))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof abrir>>

async function tipearTotal(wrapper: Wrapper, valor: string) {
  wrapper.findComponent({ name: 'MoneyInput' }).vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 0))
}

async function tipearVencimiento(valor: string) {
  const el = document.body.querySelector('[data-qa="corregir-documento-vencimiento"]') as HTMLInputElement
  expect(el).toBeTruthy()
  el.value = valor
  el.dispatchEvent(new Event('input'))
  await new Promise(r => setTimeout(r, 0))
}

function boton(): HTMLButtonElement {
  return document.body.querySelector('[data-qa="corregir-documento-enviar"]') as HTMLButtonElement
}

async function enviar() {
  boton().click()
  await new Promise(r => setTimeout(r, 20))
}

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas.length = 0
})

describe('CorregirDocumentoModal', () => {
  it('corrige el total: manda solo totalDocumento', async () => {
    const wrapper = await abrir({
      totalDocumentoTipo: 'obligatorio', totalDocumentoActual: '119000.0000', fechaVencimientoActual: '2026-10-16',
    })
    await tipearTotal(wrapper, '129000')
    await enviar()

    expect(llamadas).toEqual([
      { url: '/compras/compra-1/documento', method: 'PATCH', body: { totalDocumento: '129000' } },
    ])
  })

  it('corrige el vencimiento: manda solo fechaVencimiento', async () => {
    await abrir({
      totalDocumentoTipo: 'obligatorio', totalDocumentoActual: '119000.0000', fechaVencimientoActual: '2026-10-16',
    })
    await tipearVencimiento('2026-11-01')
    await enviar()

    expect(llamadas[0]!.body).toEqual({ fechaVencimiento: '2026-11-01' })
  })

  it('sin cambios, no manda nada y el botón queda deshabilitado', async () => {
    const wrapper = await abrir({
      totalDocumentoTipo: 'obligatorio', totalDocumentoActual: '119000.0000', fechaVencimientoActual: '2026-10-16',
    })
    expect(boton().disabled).toBe(true)
    await enviar()
    expect(llamadas).toHaveLength(0)
  })

  it('un valor igual al vigente (comparado como Decimal, no como texto) no manda nada', async () => {
    const wrapper = await abrir({
      totalDocumentoTipo: 'obligatorio', totalDocumentoActual: '119000.0000', fechaVencimientoActual: '2026-10-16',
    })
    // "119000.00" es el mismo monto que "119000.0000" (lo que trae el GET),
    // aunque el texto sea distinto.
    await tipearTotal(wrapper, '119000.00')
    expect(boton().disabled).toBe(true)
  })

  it('un tipo suma_lineas no muestra "Total del documento"', async () => {
    await abrir({
      totalDocumentoTipo: 'suma_lineas', totalDocumentoActual: null, fechaVencimientoActual: '2026-10-16',
    })
    expect(document.body.querySelector('[data-qa="corregir-documento-total"]')).toBeNull()
  })

  it('un tipo opcional: vaciar el total ya cargado lo manda en null', async () => {
    const wrapper = await abrir({
      totalDocumentoTipo: 'opcional', totalDocumentoActual: '50000.0000', fechaVencimientoActual: '2026-10-16',
    })
    await tipearTotal(wrapper, '')
    await enviar()

    expect(llamadas[0]!.body).toEqual({ totalDocumento: null })
  })

  it('un tipo obligatorio: vaciar el total ya cargado NO manda nada (el backend lo exige)', async () => {
    const wrapper = await abrir({
      totalDocumentoTipo: 'obligatorio', totalDocumentoActual: '50000.0000', fechaVencimientoActual: '2026-10-16',
    })
    await tipearTotal(wrapper, '')
    expect(boton().disabled).toBe(true)
  })
})
