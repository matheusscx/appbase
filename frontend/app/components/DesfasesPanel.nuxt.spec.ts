// @vitest-environment nuxt
//
// Entorno nuxt SOLO en este archivo (docblock por archivo, no config global):
// los otros 300 tests siguen en `happy-dom` sin enterarse. Es el único modo de
// cazar un gate de permisos mal puesto, porque el bug vive en el TEMPLATE — los
// computeds pueden ser correctos por separado y el control quedar igual oculto
// (o visible) por dónde está colgado.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import DesfasesPanel from './DesfasesPanel.vue'

let esAdmin = false
let permisos: string[] = []

// ⚠️ Nuxt instala su PROPIA instancia de Pinia, así que espiar un store creado
// con `setActivePinia` no sirve: hay que mockear el auto-import.
// Sin moneda resuelta, `MoneyInput` se monta deshabilitado y el prefill no se
// cuantiza: los tests de abajo pasarían por el lado trivial.
const MONEDA_OFICIAL = {
  monedaId: 'clp-1', codigoIso: 'CLP', nombre: 'Peso', locale: 'es-CL', prefix: '$',
  thousands: '.', decimal: ',', decimals: 0, habilitada: true, esOficial: true,
  valorDelDia: null,
}

// `ref` y no un valor fijo: el test de la carrera necesita que la moneda llegue
// DESPUÉS de las filas, y el `watch` del panel solo la ve si es reactiva.
const monedaOficialRef = ref<typeof MONEDA_OFICIAL | null>(MONEDA_OFICIAL)

mockNuxtImport('useMonedasStore', () => {
  return () => ({
    get monedaOficial() { return monedaOficialRef.value },
    getById: () => monedaOficialRef.value ?? undefined,
  })
})

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

const FILAS = [
  {
    itemId: 'receta-1',
    tipo: 'receta',
    nombre: 'Hamburguesa',
    costoActual: '1000.0000',
    costoPropuesto: '1200.0000',
    deltaCosto: '200.0000',
    precioBase: '3000.0000',
    margenPctActual: '0.6667',
    margenPctPropuesto: '0.6000',
    precioSugerido: null,
    afectados: [],
  },
]

function textos(wrapper: { findAll: (s: string) => { text: () => string }[] }) {
  return wrapper.findAll('button').map(b => b.text())
}

describe('DesfasesPanel — gate de Items:Actualizar', () => {
  it('sin el permiso NO muestra aplicar ni descartar', async () => {
    esAdmin = false
    permisos = ['Items:Leer']

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: FILAS as never },
    })

    const labels = textos(wrapper)
    expect(labels.some(t => t.includes('Aplicar'))).toBe(false)
    expect(labels.some(t => t.includes('Descartar'))).toBe(false)
    // La lectura queda intacta: el panel sigue mostrando el desfase.
    expect(wrapper.text()).toContain('Hamburguesa')
  })

  it('con Items:Actualizar muestra los dos', async () => {
    esAdmin = false
    permisos = ['Items:Leer', 'Items:Actualizar']

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: FILAS as never },
    })

    const labels = textos(wrapper)
    expect(labels.some(t => t.includes('Aplicar'))).toBe(true)
    expect(labels.some(t => t.includes('Descartar'))).toBe(true)
  })

  it('el admin del tenant los ve sin tener el permiso listado', async () => {
    esAdmin = true
    permisos = []

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: FILAS as never },
    })

    expect(textos(wrapper).some(t => t.includes('Aplicar'))).toBe(true)
  })

  it('"Después" no se gatea: no escribe nada', async () => {
    esAdmin = false
    permisos = ['Items:Leer']

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: FILAS as never },
    })

    expect(textos(wrapper).some(t => t.includes('Después'))).toBe(true)
  })
})

describe('DesfasesPanel — columna Tipo', () => {
  it('una fila de combo se distingue de una de receta', async () => {
    // `nombre: 'Combo Clásico'` ya contiene la palabra "Combo": un
    // `wrapper.text()).toContain('Combo')` pasaría igual sin columna Tipo ni
    // badge. La aserción va acotada a la celda de Tipo (índice 1: checkbox,
    // Tipo, nombre, costo, margen, precio), y con una fila de receta al lado
    // para probar que de verdad distingue una de la otra.
    const wrapper = await mountSuspended(DesfasesPanel, {
      props: {
        filas: [
          {
            itemId: 'combo-1',
            tipo: 'combo',
            nombre: 'Combo Clásico',
            costoActual: '1700.0000',
            costoPropuesto: '1800.0000',
            deltaCosto: '100.0000',
            precioBase: '4200.0000',
            margenPctActual: '0.5952',
            margenPctPropuesto: '0.5714',
            precioSugerido: '4447.0588',
            afectados: [
              { itemId: 'papas-1', nombre: 'Papas fritas', costoActual: '600.0000' },
            ],
          },
          {
            itemId: 'receta-1',
            tipo: 'receta',
            nombre: 'Hamburguesa Clásica',
            costoActual: '1000.0000',
            costoPropuesto: '1200.0000',
            deltaCosto: '200.0000',
            precioBase: '3000.0000',
            margenPctActual: '0.6667',
            margenPctPropuesto: '0.6000',
            precioSugerido: null,
            afectados: [],
          },
        ],
      },
    })

    const filas = wrapper.findAll('tbody tr')
    expect(filas).toHaveLength(2)
    const [comboRow, recetaRow] = filas
    expect(comboRow!.findAll('td')[1]?.text()).toBe('Combo')
    expect(recetaRow!.findAll('td')[1]?.text()).toBe('Receta')
  })
})

// Silencia el warning de vi sin uso si el runtime no lo requiere.
void vi

// Lo que el panel manda al descartar es la mitad del arreglo del 2026-08-25: el
// backend archiva el número que viene de acá en vez de recalcularlo, así que si
// el panel mandara solo ids —o un número que no es el que se está mostrando— el
// bug vuelve entero y ningún test del backend lo vería.
describe('DesfasesPanel — descartar manda el costo que se está mostrando', () => {
  it('emite el `costoPropuesto` de cada fila seleccionada, no solo su id', async () => {
    esAdmin = true
    permisos = []

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: FILAS as never },
    })

    const boton = wrapper.findAll('button').find(b => b.text().includes('Descartar'))
    expect(boton).toBeDefined()
    await boton!.trigger('click')

    const emitido = wrapper.emitted('descartar')
    expect(emitido).toBeTruthy()
    expect(emitido![0]![0]).toEqual([
      { itemId: 'receta-1', costoPropuestoVisto: '1200.0000' },
    ])
  })
})

/**
 * Lo que la fila aplica tiene que ser **lo que la fila muestra**. `precioSugerido`
 * es una tasa de 4 decimales que calcula el motor, y el campo de la tabla no puede
 * mostrar más decimales que la moneda oficial: sin cuantizar el prefill, la pantalla
 * diría `4.447` y el POST llevaría `4447.0588`.
 *
 * 📌 Hasta el 2026-09-08 el redondeo lo hacía sin querer `MoneyInput`, que re-emitía
 * cuantizado todo valor que le entraba por `props` —le reescribía el modelo al padre
 * sin que nadie tocara el campo—. Al cerrar ese re-emit, esta pantalla se quedaba sin
 * el redondeo que estaba usando de rebote; por eso ahora es explícito y tiene test.
 */
describe('DesfasesPanel — la sugerencia se aplica en la escala de la moneda', () => {
  // `monedaOficialRef` es estado de módulo y dos de estos tests lo ponen en `null`
  // para montar la carrera. Restaurarlo inline dejaba el archivo dependiendo de que
  // ninguna aserción tirara antes: sin moneda, todo lo de acá pasa por el lado
  // trivial (el campo se monta deshabilitado).
  afterEach(() => {
    monedaOficialRef.value = MONEDA_OFICIAL
  })

  const FILA_CON_SUGERENCIA = {
    itemId: 'combo-1',
    tipo: 'combo',
    nombre: 'Combo Clásico',
    costoActual: '1700.0000',
    costoPropuesto: '1800.0000',
    deltaCosto: '100.0000',
    precioBase: '4200.0000',
    margenPctActual: '0.5952',
    margenPctPropuesto: '0.5714',
    precioSugerido: '4447.0588',
    afectados: [],
  }

  /**
   * Marca "Actualizar precio" (la última caja de la fila) y aplica. El wrapper va
   * tipado por su forma y no con `Awaited<ReturnType<typeof mountSuspended>>`: ese
   * tipo es genérico y deja los callbacks en `any` implícito, que `vue-tsc` estricto
   * rechaza. Mismo criterio que el helper `textos` de más arriba.
   */
  async function marcarYAplicar(wrapper: {
    findAll: (s: string) => { text: () => string, trigger: (e: string) => Promise<unknown> }[]
  }) {
    const cajas = wrapper.findAll('[role=checkbox], input[type=checkbox], button[role=checkbox]')
    await cajas[cajas.length - 1]!.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    const boton = wrapper.findAll('button').find(b => b.text().includes('Aplicar'))
    expect(boton, 'botón "Aplicar"').toBeTruthy()
    await boton!.trigger('click')
  }

  it('con una sugerencia de 4 decimales, aplica el entero que se ve en pantalla', async () => {
    esAdmin = true
    permisos = []

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: [FILA_CON_SUGERENCIA] as never },
    })

    await marcarYAplicar(wrapper)

    // Lo que se ve…
    expect(wrapper.findAll('input').map(i => (i.element as HTMLInputElement).value))
      .toContain('4.447')
    // …es lo que se manda.
    expect(wrapper.emitted('aplicar')?.[0]?.[0]).toEqual([
      { itemId: 'combo-1', actualizarPrecio: true, precioBase: '4447' },
    ])

    wrapper.unmount()
  })

  /**
   * La carrera real: `desfases.vue` pide sus filas en su propio `onMounted` y la moneda
   * la carga el layout, así que en una carga dura de `/desfases` las filas pueden llegar
   * primero. Sin escala no hay con qué cuantizar, y si el prefill se calculara una sola
   * vez quedaría el crudo para siempre — el campo mostrando `4.447` y el POST llevando
   * `4447.0588`. Hasta el 2026-09-08 esto lo tapaba el re-emit de `MoneyInput`.
   */
  it('si la moneda llega DESPUÉS que las filas, el prefill se rehace', async () => {
    esAdmin = true
    permisos = []
    monedaOficialRef.value = null

    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: [FILA_CON_SUGERENCIA] as never },
    })

    // Se marca "Actualizar precio" ANTES de que llegue la moneda, que es lo que hace
    // discriminante al ancla de abajo: el campo se deshabilita por dos motivos —la
    // casilla apagada y la moneda sin resolver— y este click descarta el primero.
    const cajas = wrapper.findAll('[role=checkbox], input[type=checkbox], button[role=checkbox]')
    await cajas[cajas.length - 1]!.trigger('click')
    await new Promise(r => setTimeout(r, 0))

    // Ancla del pre-estado que este test viene a rescatar: con la casilla marcada, lo
    // único que puede tener el campo deshabilitado es que `MoneyInput` no resuelva
    // moneda — o sea que el prefill quedó sin cuantizar.
    expect(wrapper.findAll('input').every(i => (i.element as HTMLInputElement).disabled))
      .toBe(true)

    monedaOficialRef.value = MONEDA_OFICIAL
    await new Promise(r => setTimeout(r, 0))

    const boton = wrapper.findAll('button').find(b => b.text().includes('Aplicar'))
    expect(boton, 'botón "Aplicar"').toBeTruthy()
    await boton!.trigger('click')

    expect(wrapper.emitted('aplicar')?.[0]?.[0]).toEqual([
      { itemId: 'combo-1', actualizarPrecio: true, precioBase: '4447' },
    ])

    wrapper.unmount()
  })

  /**
   * La otra mitad de esa misma ventana, y la que cuesta más caro: las casillas NO
   * dependen de la moneda —se dibujan apenas llegan las filas y no se deshabilitan—,
   * así que alguien puede destildar filas mientras el precio todavía no se puede
   * tipear. Si la llegada de la moneda reiniciara el estado de las filas, esa elección
   * se revertiría en silencio: con "Descartar", archivar la bandeja entera en vez de
   * las dos filas que quedaron marcadas.
   */
  it('rehacer el prefill NO revierte las filas que la persona destildó', async () => {
    esAdmin = true
    permisos = []
    monedaOficialRef.value = null

    const otra = { ...FILA_CON_SUGERENCIA, itemId: 'combo-2', nombre: 'Combo Dos' }
    const wrapper = await mountSuspended(DesfasesPanel, {
      props: { filas: [FILA_CON_SUGERENCIA, otra] as never },
    })

    // Destildar la primera fila mientras la moneda todavía no llegó.
    const cajas = wrapper.findAll('[role=checkbox], input[type=checkbox], button[role=checkbox]')
    await cajas[1]!.trigger('click')
    await new Promise(r => setTimeout(r, 0))

    monedaOficialRef.value = MONEDA_OFICIAL
    await new Promise(r => setTimeout(r, 0))

    const boton = wrapper.findAll('button').find(b => b.text().includes('Descartar'))
    expect(boton, 'botón "Descartar"').toBeTruthy()
    await boton!.trigger('click')

    // Solo la fila que quedó marcada, no la bandeja entera.
    expect(wrapper.emitted('descartar')?.[0]?.[0]).toEqual([
      { itemId: 'combo-2', costoPropuestoVisto: '1800.0000' },
    ])

    wrapper.unmount()
  })
})
