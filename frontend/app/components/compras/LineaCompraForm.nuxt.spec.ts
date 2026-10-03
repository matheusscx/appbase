// @vitest-environment nuxt
//
// La fila de línea de `pages/compras/[id].vue`, extraída a componente
// (backlog §1 de `docs/agent/pendientes.md`, 2026-09-30). Contrato como
// `ventas/CarritoPanel.vue`: lo que fija este spec es que CADA interacción
// sale por un emit con su valor, y que ninguna muta `linea` —la prop entra
// de solo lectura, la escritura la hace la página.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import { useUnidadesMedidaStore } from '~/stores/unidades-medida'
import type { ItemsPorId } from '~/composables/useItemsPorId'
import type { LineaForm, ProductoOpt } from './LineaCompraForm.vue'
import LineaCompraForm from './LineaCompraForm.vue'

const HARINA: ProductoOpt = { id: 'item-harina', nombre: 'Harina', modoInventario: 'cantidad', unidadMedida: 'kg' }
const BOTELLA_SERIE: ProductoOpt = { id: 'item-botella', nombre: 'Botella', modoInventario: 'serie', unidadMedida: 'unidad' }
const CAJA = { id: 'pres-caja', itemId: HARINA.id, nombre: 'Caja', contenido: '12', unidadCodigo: 'kg' }

function dteInfo(o: { texto: string, calzo?: boolean }): LineaForm['dte'] {
  return {
    clave: 'CLAVE:1', descripcion: o.texto, texto: o.texto, calzo: o.calzo ?? false,
    nota: null, conAjusteDeLinea: false, origen: {} as never,
  }
}

function lineaBase(o: Partial<LineaForm> = {}): LineaForm {
  return {
    key: 'linea-1',
    itemId: '',
    modoInventario: null,
    unidadMedida: null,
    cantidad: '',
    unidadCodigo: '',
    presentacionId: '',
    precioUnitario: '',
    seriesTexto: '',
    codigoLote: '',
    fechaVencimiento: '',
    dte: null,
    ...o,
  }
}

/** El caché de la página, ya con lo que devolvió una búsqueda: lo que se elige sale de ahí. */
function catalogoCon(items: ProductoOpt[]): ItemsPorId<ProductoOpt> {
  const porId = reactive(new Map(items.map(i => [i.id, i]))) as Map<string, ProductoOpt>
  return {
    porId,
    buscar: () => Promise.resolve(items),
    resolver: () => Promise.resolve(),
    registrar: (i: ProductoOpt) => { porId.set(i.id, i) },
  }
}

async function montar(props: {
  linea: LineaForm
  catalogo?: ItemsPorId<ProductoOpt>
  presentaciones?: typeof CAJA[]
  proveedorId?: string
}) {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  useUnidadesMedidaStore().hydrate([
    { unidadMedidaId: 'u1', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'peso', factorBase: '1000' },
    { unidadMedidaId: 'u2', codigo: 'g', nombre: 'Gramo', magnitud: 'peso', factorBase: '1' },
  ])
  const wrapper = await mountSuspended(LineaCompraForm, {
    props: {
      catalogo: catalogoCon([HARINA, BOTELLA_SERIE]),
      presentaciones: [CAJA],
      proveedorId: 'prov-1',
      ...props,
    },
  })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

function productoSelect(wrapper: Wrapper) {
  return wrapper.findComponent({ name: 'AppItemSelect' }).findComponent({ name: 'USelectMenu' })
}

function unidadSelect(wrapper: Wrapper) {
  return wrapper.findComponent({ name: 'USelect' })
}

beforeEach(() => {
  useUnidadesMedidaStore().reset()
})

describe('LineaCompraForm', () => {
  it('elegir un producto emite "seleccionar-item" con los campos que dependen de él, sin mutar la prop', async () => {
    const linea = Object.freeze(lineaBase())
    const wrapper = await montar({ linea })

    productoSelect(wrapper).vm.$emit('update:modelValue', HARINA.id)
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.emitted('seleccionar-item')?.[0]?.[0]).toEqual({
      itemId: HARINA.id,
      modoInventario: 'cantidad',
      unidadMedida: 'kg',
      unidadCodigo: 'kg',
      presentacionId: '',
      seriesTexto: '',
      codigoLote: '',
      fechaVencimiento: '',
    })
    // La prop sigue exactamente como llegó: el `freeze` de arriba hace que
    // cualquier mutación directa tire, así que si este `it` no tiró, no mutó.
    expect(linea.itemId).toBe('')
    wrapper.unmount()
  })

  it('una línea del XML (con dte) no hereda la unidad base al elegir producto', async () => {
    const linea = Object.freeze(lineaBase({ dte: dteInfo({ texto: 't' }) }))
    const wrapper = await montar({ linea })

    productoSelect(wrapper).vm.$emit('update:modelValue', HARINA.id)
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.emitted('seleccionar-item')?.[0]?.[0]).toMatchObject({ unidadCodigo: '' })
    wrapper.unmount()
  })

  it('tipear la cantidad emite "cambiar-cantidad" con el valor tipeado, sin mutar la prop', async () => {
    const linea = Object.freeze(lineaBase({ itemId: HARINA.id, modoInventario: 'cantidad' }))
    const wrapper = await montar({ linea })

    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('20.35')

    expect(wrapper.emitted('cambiar-cantidad')?.[0]).toEqual(['20.35'])
    expect(linea.cantidad).toBe('')
    wrapper.unmount()
  })

  it('elegir una unidad del catálogo emite "cambiar-unidad" con presentacionId vacío', async () => {
    const linea = Object.freeze(lineaBase({ itemId: HARINA.id, modoInventario: 'cantidad', unidadMedida: 'kg' }))
    const wrapper = await montar({ linea })

    unidadSelect(wrapper).vm.$emit('update:modelValue', 'u:kg')
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.emitted('cambiar-unidad')?.[0]?.[0]).toEqual({ presentacionId: '', unidadCodigo: 'kg' })
    wrapper.unmount()
  })

  it('elegir una presentación emite "cambiar-unidad" con unidadCodigo vacío', async () => {
    const linea = Object.freeze(lineaBase({ itemId: HARINA.id, modoInventario: 'cantidad', unidadMedida: 'kg' }))
    const wrapper = await montar({ linea })

    unidadSelect(wrapper).vm.$emit('update:modelValue', 'p:pres-caja')
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.emitted('cambiar-unidad')?.[0]?.[0]).toEqual({ presentacionId: 'pres-caja', unidadCodigo: '' })
    wrapper.unmount()
  })

  it('"+ Nueva presentación…" emite "nueva-presentacion", no "cambiar-unidad"', async () => {
    const linea = Object.freeze(lineaBase({ itemId: HARINA.id, modoInventario: 'cantidad', unidadMedida: 'kg' }))
    const wrapper = await montar({ linea })

    unidadSelect(wrapper).vm.$emit('update:modelValue', 'nueva')
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.emitted('nueva-presentacion')).toHaveLength(1)
    expect(wrapper.emitted('cambiar-unidad')).toBeUndefined()
    wrapper.unmount()
  })

  it('el lápiz de editar presentación (solo visible con presentacionId) emite "editar-presentacion"', async () => {
    const linea = Object.freeze(lineaBase({ itemId: HARINA.id, presentacionId: 'pres-caja' }))
    const wrapper = await montar({ linea })

    await wrapper.find(`[data-qa="compra-presentacion-editar-${linea.key}"]`).trigger('click')

    expect(wrapper.emitted('editar-presentacion')).toHaveLength(1)
    wrapper.unmount()
  })

  it('el precio unitario emite "cambiar-precio" con el valor tipeado, sin mutar la prop', async () => {
    const linea = Object.freeze(lineaBase({ itemId: HARINA.id }))
    const wrapper = await montar({ linea })

    wrapper.findComponent({ name: 'MoneyInput' }).vm.$emit('update:modelValue', '1490')
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.emitted('cambiar-precio')?.[0]).toEqual(['1490'])
    expect(linea.precioUnitario).toBe('')
    wrapper.unmount()
  })

  it('el botón de quitar emite "quitar" sin payload', async () => {
    const linea = Object.freeze(lineaBase())
    const wrapper = await montar({ linea })

    // El botón de quitar no tiene `data-qa` propio: se identifica por ícono y color.
    const botones = wrapper.findAllComponents({ name: 'UButton' })
    const trash = botones.find(b => b.props('icon') === 'i-lucide-trash-2' && b.props('color') === 'error')
    expect(trash, 'botón quitar').toBeTruthy()
    await trash!.trigger('click')

    expect(wrapper.emitted('quitar')).toHaveLength(1)
    wrapper.unmount()
  })

  it('"No es mercadería" (solo con dte) emite "apartar" sin payload', async () => {
    const linea = Object.freeze(lineaBase({
      dte: dteInfo({ texto: 'FLETE' }),
    }))
    const wrapper = await montar({ linea })

    await wrapper.find('[data-qa="compra-dte-no-mercaderia"]').trigger('click')

    expect(wrapper.emitted('apartar')).toHaveLength(1)
    wrapper.unmount()
  })

  it('en modo serie, tipear las series emite "cambiar-series" con el texto y la cuenta recalculada', async () => {
    const linea = Object.freeze(lineaBase({ itemId: BOTELLA_SERIE.id, modoInventario: 'serie', unidadMedida: 'unidad' }))
    const wrapper = await montar({ linea })

    wrapper.findComponent({ name: 'UTextarea' }).vm.$emit('update:modelValue', 'SN-1\nSN-2\n')
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.emitted('cambiar-series')?.[0]?.[0]).toEqual({ seriesTexto: 'SN-1\nSN-2\n', cantidad: '2' })
    expect(linea.seriesTexto).toBe('')
    wrapper.unmount()
  })

  it('en modo lote, el código y la fecha emiten cada uno su propio valor, sin mutar la prop', async () => {
    const linea = Object.freeze(lineaBase({ itemId: HARINA.id, modoInventario: 'lote' }))
    const wrapper = await montar({ linea })

    await wrapper.find('input[placeholder="Código del lote"]').setValue('LOTE-1')
    await wrapper.find('input[type="date"]').setValue('2026-10-01')

    expect(wrapper.emitted('cambiar-codigo-lote')?.[0]).toEqual(['LOTE-1'])
    expect(wrapper.emitted('cambiar-fecha-vencimiento')?.[0]).toEqual(['2026-10-01'])
    expect(linea.codigoLote).toBe('')
    expect(linea.fechaVencimiento).toBe('')
    wrapper.unmount()
  })
})
