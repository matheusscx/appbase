// @vitest-environment nuxt
//
// Drawer de AJUSTE DE COSTO. El campo se tipea "por la unidad elegida", así que
// el selector de unidad y el número forman un par: si uno cambia sin el otro,
// lo que se persiste es un costo ×1000.
//
// Los bugs que fija son de RUNTIME — ni el build ni el typecheck ni una
// revisión de diff los ven, porque son la interacción entre un `watch`, un
// `computed` y lo que el componente hijo tiene adentro:
//   1. Cambiar de unidad con el costo ya tipeado dejaba el número intacto y
//      solo movía la etiqueta: `5050` tipeado "por g" se mandaba "por kg".
//   2. El "Costo vigente" se mostraba SIEMPRE en unidad base, al lado de un
//      "Costo nuevo (por g)" — la comparación que inducía el error.
//   3. Ese vigente convertido cae en fracciones que la moneda no representa
//      ($1,5 por gramo en CLP) y `formatMonto` las redondearía a `$2`.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Inventario from './index.vue'

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

const UNIDADES = [
  { unidadMedidaId: 'u-kg', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'masa', factorBase: '1000' },
  { unidadMedidaId: 'u-g', codigo: 'g', nombre: 'Gramo', magnitud: 'masa', factorBase: '1' },
  { unidadMedidaId: 'u-un', codigo: 'unidad', nombre: 'Unidad', magnitud: 'conteo', factorBase: '1' },
]

/** Harina: stock en kilos, costo $1.500 el kilo. La base del ejemplo del owner. */
const HARINA = {
  id: 'item-harina',
  nombre: 'Harina',
  costoActual: '1500.0000',
  monedaId: 'clp-1',
  unidadMedida: 'kg',
  modoInventario: 'cantidad',
}

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

/** Cada POST a /inventario/ajustes-costo, para leer qué se mandó de verdad. */
let ajustesEnviados: Record<string, string>[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, string> }) => {
    if (typeof url !== 'string') return Promise.resolve({ data: [], meta: {} })
    if (opts?.method === 'POST' && url.includes('/inventario/ajustes-costo')) {
      ajustesEnviados.push({ ...(opts.body ?? {}) })
      return Promise.resolve(undefined)
    }
    if (url.includes('/catalog/unidades-medida')) return Promise.resolve(UNIDADES)
    if (url.includes('/items?tipo=producto')) {
      return Promise.resolve({ data: [HARINA], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })
    }
    if (url.includes('/items?tipo=ingrediente')) {
      return Promise.resolve({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } })
    }
    return Promise.resolve({ data: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
  }
})

/**
 * Dos cosas que el montaje necesita y no son obvias, las dos con el mismo molde
 * que `configuracion/garzones.nuxt.spec.ts`:
 *
 * 1. **`AppDrawer` stubeado.** Su root es `UDrawer` (reka-ui) y **cerrarlo**
 *    revienta bajo happy-dom: la transición de salida de `usePresence` lee
 *    `style.display` de un nodo ya desprendido y tira un unhandled rejection.
 *    Los tests igual pasan, pero `vitest run` sale con **exit 1** — medido acá
 *    también: el test que envía el formulario (y por ende cierra el drawer)
 *    daba 2 rejections; los otros dos, ninguna.
 * 2. **`attachTo: document.body`.** El botón de envío es
 *    `type="submit" form="ajuste-costo-form"`, y esa asociación por id la
 *    resuelve el DOCUMENTO. Con el wrapper desprendido el submit no dispara y
 *    el test pasaría sin haber mandado nada.
 */
async function montar() {
  const wrapper = await mountSuspended(Inventario, {
    attachTo: document.body,
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
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

/**
 * Los `USelectMenu` se manejan emitiendo `update:modelValue`, no abriendo su
 * popup: renderizar el listbox mata al worker en happy-dom (mismo motivo que
 * `descuentos.nuxt.spec.ts`). El contrato ejercitado es el `v-model` del
 * template, o sea la misma conducta que la pantalla.
 *
 * Se identifican por sus OPCIONES y no por su posición: la pantalla tiene
 * además los dos selects de filtro, y un índice se rompe al agregar un filtro.
 */
function selectConOpcion(wrapper: Wrapper, valor: string, sinValor?: string) {
  const select = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
    const items = (s.props('items') ?? []) as { value: string }[]
    if (!Array.isArray(items)) return false
    if (sinValor && items.some(i => i?.value === sinValor)) return false
    return items.some(i => i?.value === valor)
  })
  expect(select, `USelectMenu con la opción "${valor}"`).toBeTruthy()
  return select!
}

/** El select de producto del formulario: el de filtro trae además "todos". */
const selectProducto = (w: Wrapper) => selectConOpcion(w, HARINA.id, 'todos')
const selectUnidad = (w: Wrapper) => selectConOpcion(w, 'kg')
const campoCosto = (w: Wrapper) => w.findComponent({ name: 'MoneyInput' })

const campoComentario = (w: Wrapper) => w.findComponent({ name: 'UTextarea' })

async function enviar(wrapper: Wrapper) {
  const boton = wrapper.findAllComponents({ name: 'UButton' })
    .find(b => b.text().trim() === 'Ajustar costo' && b.props('type') === 'submit')
  expect(boton, 'botón submit del drawer').toBeTruthy()
  await boton!.trigger('click')
  // Enviar cierra el drawer, y desmontar el wrapper a mitad de la transición de
  // salida deja dos rechazos sin manejar (`usePresence` de reka-ui leyendo
  // `display` sobre un `CSSStyleDeclaration` que happy-dom ya soltó). Esperar a
  // que la transición termine los evita: son ruido del entorno, no del código,
  // pero un "Unhandled Error" en la suite le cuesta una investigación al próximo.
  await new Promise(r => setTimeout(r, 250))
}

async function abrirDrawer(wrapper: Wrapper) {
  const boton = wrapper.findAll('button').find(b => b.text().includes('Ajustar costo'))
  expect(boton, 'botón "Ajustar costo"').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

async function emitir(comp: ReturnType<typeof selectUnidad>, valor: string) {
  comp.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 20))
}

/** Texto del `UFormField` que envuelve al campo de costo vigente. */
function vigente(wrapper: Wrapper) {
  const campo = wrapper.findAllComponents({ name: 'UFormField' })
    .find(f => String(f.props('label') ?? '').startsWith('Costo vigente'))
  expect(campo, 'UFormField del costo vigente').toBeTruthy()
  return {
    label: String(campo!.props('label')),
    valor: campo!.findComponent({ name: 'UInput' }).props('modelValue') as string,
  }
}

describe('inventario — el drawer de ajuste de costo y la unidad', () => {
  beforeEach(() => {
    ajustesEnviados = []
    // `AppDrawer` teletransporta al `body` y desmontar el wrapper no lo saca:
    // sin esto, los drawers de tests anteriores quedan en el DOM.
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('cambiar de unidad limpia el costo ya tipeado, en vez de reinterpretarlo', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await emitir(selectProducto(wrapper), HARINA.id)

    await emitir(campoCosto(wrapper), '1500')
    expect(campoCosto(wrapper).props('modelValue')).toBe('1500')

    await emitir(selectUnidad(wrapper), 'g')

    // Si el campo sobreviviera, ese `1500` se mandaría "por gramo": $1.500.000
    // el kilo, mil veces el costo real.
    expect(campoCosto(wrapper).props('modelValue')).toBe('')
    wrapper.unmount()
  })

  it('el costo vigente se muestra en la unidad elegida, no siempre en la base', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await emitir(selectProducto(wrapper), HARINA.id)

    expect(vigente(wrapper)).toEqual({ label: 'Costo vigente (por kg)', valor: '$1.500' })

    await emitir(selectUnidad(wrapper), 'g')

    // $1.500/kg son $1,5/g. Con `formatMonto` (0 decimales en CLP) se vería
    // "$2", que es un 33% más y no es el costo de nada.
    expect(vigente(wrapper)).toEqual({ label: 'Costo vigente (por g)', valor: '$1,5' })
    wrapper.unmount()
  })

  // El cierre completo, no solo el borrado: lo que se manda tiene que ser el
  // número retipeado CON la unidad que estaba a la vista. Un `costoNuevo` con
  // la unidad de antes es el bug ×1000 con otra cara.
  it('tras limpiar, lo retipeado viaja con la unidad elegida', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await emitir(selectProducto(wrapper), HARINA.id)
    await emitir(campoCosto(wrapper), '1500')
    await emitir(selectUnidad(wrapper), 'g')

    await emitir(campoCosto(wrapper), '2')
    await emitir(campoComentario(wrapper), 'Corrección del proveedor')
    await enviar(wrapper)

    expect(ajustesEnviados).toEqual([{
      itemId: HARINA.id,
      costoNuevo: '2',
      unidadCodigo: 'g',
      comentario: 'Corrección del proveedor',
    }])
    wrapper.unmount()
  })
})
