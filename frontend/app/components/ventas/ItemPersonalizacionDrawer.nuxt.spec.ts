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

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url === 'string' && url.endsWith('/items/receta-1')) {
      return Promise.resolve(structuredClone(RECETA))
    }
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
async function montar() {
  const w = await mountSuspended(ItemPersonalizacionDrawer, {
    props: { itemId: 'receta-1', open: false },
    global: {
      stubs: {
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

/** Confirma y devuelve lo que el drawer emitió: es lo que la pantalla manda al servidor. */
async function confirmar(w: NonNullable<typeof wrapper>): Promise<PersonalizacionPayload> {
  const agregar = w.findAll('button').find(b => b.text().startsWith('Agregar'))
  expect(agregar, 'el botón Agregar').toBeDefined()
  await agregar!.trigger('click')
  const emitido = w.emitted('confirm')
  expect(emitido, 'el drawer emitió confirm').toHaveLength(1)
  return (emitido![0] as [PersonalizacionPayload, string])[0]
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
