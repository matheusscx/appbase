// @vitest-environment nuxt
//
// El drawer no tenía spec. Lo abre el tope de unidades de un extra: el backend
// rechaza con 400 más de `MAX_UNIDADES_POR_PLATO` (`PersonalizacionExtraInputDto`)
// y el input del drawer no tenía `max`, así que el garzón tipeaba 100 y veía el
// error recién al pedir.
//
// El `UInputNumber` va REAL, no stubeado: lo que se prueba es que lo tipeado se
// clampe al salir del campo (reka-ui `NumberFieldRoot.applyInputValue`), y un
// stub solo podría afirmar que el prop llega, no lo que termina en el payload.
import { describe, it, expect, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import ItemPersonalizacionDrawer from './ItemPersonalizacionDrawer.vue'
import {
  MAX_UNIDADES_POR_PLATO,
  type PersonalizacionPayload,
  type RecetaDetallePersonalizacion,
} from '~/composables/useRecetaPersonalizacion'

const CLP = {
  monedaId: 'clp-1',
  nombre: 'Peso chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esOficial: true,
  valorDelDia: null,
}

const QUESO = '11111111-1111-4111-8111-111111111111'

const RECETA: RecetaDetallePersonalizacion = {
  id: 'receta-1',
  nombre: 'Hamburguesa',
  precioBase: '5000',
  monedaId: 'clp-1',
  ingredientes: [],
  extrasPermitidos: [
    {
      ingredienteItemId: QUESO,
      ingredienteNombre: 'Queso extra',
      cantidad: '1',
      unidadCodigo: 'unidad',
      precioExtra: '500',
      stock: '1000',
    },
  ],
  grupos: [],
}

const PAPAS = '22222222-2222-4222-8222-222222222222'
const SALSA = '33333333-3333-4333-8333-333333333333'
const GRUPO_SALSA = '44444444-4444-4444-8444-444444444444'

/** El combo familiar: las papas, con salsa obligatoria, en la cantidad dada. */
function comboConPapas(cantidad: string): RecetaDetallePersonalizacion {
  return {
    id: `combo-${cantidad}`,
    nombre: 'Combo familiar',
    precioBase: '6000',
    monedaId: 'clp-1',
    ingredientes: [],
    extrasPermitidos: [],
    grupos: [],
    componentes: [
      {
        componenteItemId: PAPAS,
        componenteNombre: 'Papas fritas',
        tipo: 'receta',
        cantidad,
        grupos: [
          {
            grupoModificadorId: GRUPO_SALSA,
            nombre: 'Salsa',
            min: 1,
            max: 1,
            orden: 0,
            opciones: [
              {
                grupoOpcionId: 'opcion-salsa',
                itemId: SALSA,
                itemNombre: 'Salsa',
                tipo: 'producto',
                cantidad: '1',
                unidadCodigo: null,
                precioExtra: '500',
                orden: 0,
                stock: null,
              },
            ],
          },
        ],
      },
    ],
  }
}

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url === 'string' && url.endsWith('/items/receta-1')) {
      return Promise.resolve(structuredClone(RECETA))
    }
    if (typeof url === 'string' && url.endsWith('/items/receta-con-ingredientes')) {
      return Promise.resolve({
        ...structuredClone(RECETA),
        id: 'receta-con-ingredientes',
        ingredientes: [{
          ingredienteItemId: PAPAS,
          ingredienteNombre: 'Pepino',
          cantidad: '1',
          unidadCodigo: 'unidad',
          bloqueante: false,
          stock: '10',
        }],
      })
    }
    const combo = typeof url === 'string' && url.match(/\/items\/combo-(.+)$/)
    if (combo) return Promise.resolve(comboConPapas(combo[1]!))
    return Promise.resolve([])
  }
})

let wrapper: Awaited<ReturnType<typeof montar>> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

/**
 * `AppDrawer` stubeado (mismo motivo que `VentaDetalleDrawer.nuxt.spec.ts`: la
 * transición de `UDrawer` bajo happy-dom saca a `vitest run` con exit 1). Se
 * monta CERRADO y se abre después: el `watch` que carga el ítem no es
 * `immediate`, igual que en la app.
 */
async function montar(itemId = 'receta-1') {
  const w = await mountSuspended(ItemPersonalizacionDrawer, {
    props: { itemId, open: false },
    global: {
      stubs: {
        // El grupo, stubeado: lo que se prueba es cuántas veces pregunta el
        // drawer y qué manda, no el `USelectMenu` de adentro. Un click elige la
        // única opción, como el garzón.
        VentasItemPersonalizacionGrupo: {
          name: 'VentasItemPersonalizacionGrupo',
          props: ['grupo', 'seleccion'],
          emits: ['update:seleccion'],
          template: `<button class="elegir-opcion" @click="$emit('update:seleccion', { [grupo.opciones[0].itemId]: 1 })">elegir</button>`,
        },
        AppDrawer: {
          name: 'AppDrawer',
          props: ['open'],
          template: `
            <div v-if="open" role="dialog">
              <slot name="header" />
              <slot name="body" />
              <slot name="actions" />
            </div>
          `,
        },
      },
    },
  })
  useMonedasStore().hydrate([CLP], 'tenant-1')
  await w.setProps({ open: true })
  await new Promise(r => setTimeout(r, 20))
  return w
}

/** Marca el extra y tipea `valor` en sus unidades, saliendo del campo como el garzón. */
async function tipearUnidadesDelExtra(w: NonNullable<typeof wrapper>, valor: string) {
  const casilla = w.find('button[role="checkbox"]')
  expect(casilla.exists(), 'la casilla del extra').toBe(true)
  await casilla.trigger('click')
  const input = w.find('input[role="spinbutton"]')
  expect(input.exists(), 'el input de unidades del extra').toBe(true)
  await input.setValue(valor)
  await input.trigger('blur')
}

function botonAgregar(w: NonNullable<typeof wrapper>) {
  const agregar = w.findAll('button').find(b => b.text().startsWith('Agregar'))
  expect(agregar, 'el botón Agregar').toBeDefined()
  return agregar!
}

/** Confirma y devuelve lo que el drawer emitió: es lo que la pantalla manda al servidor. */
async function confirmar(w: NonNullable<typeof wrapper>): Promise<PersonalizacionPayload> {
  const agregar = botonAgregar(w)
  await agregar!.trigger('click')
  const emitido = w.emitted('confirm')
  expect(emitido, 'el drawer emitió confirm').toHaveLength(1)
  return (emitido![0] as [PersonalizacionPayload, string])[0]
}

/** El resumen que acompaña al `confirm`: es lo que la cuenta y el carrito muestran de la línea. */
function resumenEmitido(w: NonNullable<typeof wrapper>): string {
  return (w.emitted('confirm')![0] as [PersonalizacionPayload, string])[1]
}

describe('ItemPersonalizacionDrawer — tope de unidades de un extra', () => {
  it('es el mismo número que el @Max del backend: 99', () => {
    // Gemela de `MAX_UNIDADES_POR_PLATO` en
    // `backend/src/common/utils/tope-unidades-venta.util.ts`. Si esto cambia
    // solo de un lado, el garzón vuelve a ver el 400 o pierde unidades válidas.
    expect(MAX_UNIDADES_POR_PLATO).toBe(99)
  })

  it('100 tipeado queda en 99 al salir del campo, y el pedido sale con 99', async () => {
    wrapper = await montar()
    await tipearUnidadesDelExtra(wrapper, '100')

    expect((wrapper.find('input[role="spinbutton"]').element as HTMLInputElement).value).toBe('99')
    const payload = await confirmar(wrapper)
    expect(payload.extras).toEqual([{ ingredienteItemId: QUESO, unidades: 99 }])
  })

  it('99 entra tal cual: el tope no recorta lo que el backend acepta', async () => {
    wrapper = await montar()
    await tipearUnidadesDelExtra(wrapper, '99')

    const payload = await confirmar(wrapper)
    expect(payload.extras).toEqual([{ ingredienteItemId: QUESO, unidades: 99 }])
  })
})

// Una fracción de componente cuenta como unidad entera, redondeando hacia
// arriba (owner, 2026-10-11). Gemelo del e2e `combos.e2e-spec.ts` 15 a 19: el
// drawer contaba con `Number(cantidad)`, y Vue 3.5 no recorre un `v-for` sobre
// 0,5 (en dev avisa y no pinta nada; en producción `new Array(0.5)` tira), así
// que la salsa ni se ofrecía y el pedido salía sin ella.
describe('ItemPersonalizacionDrawer — componente fraccionario de un combo', () => {
  const salsaEn = (unidad: number) => ({
    componenteItemId: PAPAS,
    unidad,
    grupos: [{ grupoId: GRUPO_SALSA, opciones: [{ itemId: SALSA, unidades: 1 }] }],
  })

  it('medio kilo pregunta una salsa: sin elegirla no se agrega, y elegida viaja como la unidad 1', async () => {
    wrapper = await montar('combo-0.5000')
    const elegir = wrapper.findAll('button.elegir-opcion')
    expect(elegir).toHaveLength(1)
    expect(botonAgregar(wrapper).attributes('disabled')).toBeDefined()

    await elegir[0]!.trigger('click')
    expect(botonAgregar(wrapper).attributes('disabled')).toBeUndefined()
    // La salsa entra entera al precio que se muestra: 6.000 + 500.
    expect(botonAgregar(wrapper).text()).toContain('6.500')
    const payload = await confirmar(wrapper)
    expect(payload.componentes).toEqual([salsaEn(1)])
    expect(resumenEmitido(wrapper)).toContain('Papas fritas · Salsa: Salsa')
  })

  it('kilo y medio pregunta dos: con una sola no se agrega', async () => {
    wrapper = await montar('combo-1.5000')
    const elegir = wrapper.findAll('button.elegir-opcion')
    expect(elegir).toHaveLength(2)
    expect(wrapper.text()).toContain('Papas fritas #2')

    await elegir[0]!.trigger('click')
    expect(botonAgregar(wrapper).attributes('disabled')).toBeDefined()
    await elegir[1]!.trigger('click')
    expect(botonAgregar(wrapper).text()).toContain('7.000')
    const payload = await confirmar(wrapper)
    expect(payload.componentes).toEqual([salsaEn(1), salsaEn(2)])
    expect(resumenEmitido(wrapper)).toContain('Papas fritas #2 · Salsa: Salsa')
  })
})

// Auditoría UX 02.3: el interruptor "Incluir" medía 36×20 px, y se toca con el dedo, de pie.
describe('ItemPersonalizacionDrawer — tamaño táctil de "Incluir" (02.3)', () => {
  it('el área táctil del interruptor de cada ingrediente mide al menos 44 px', async () => {
    wrapper = await montar('receta-con-ingredientes')
    const interruptor = wrapper.find('button[role="switch"]')
    expect(interruptor.exists(), 'el interruptor de Incluir').toBe(true)
    const area = interruptor.element.closest('label')
    expect(area, 'el rótulo que envuelve al interruptor').toBeTruthy()
    expect(area!.className).toMatch(/(^|\s)min-h-11(\s|$)/)
    expect(area!.className).toMatch(/(^|\s)min-w-11(\s|$)/)
  })
})
