// @vitest-environment nuxt
//
// Tarea 8 del plan del reporte de varianza. `AppGrafica` envuelve Unovis; lo que
// este spec fija es el contrato que el próximo reporte copia:
//   1. `cargando` → esqueleto, sin gráfica.
//   2. `vacio` → estado vacío, sin gráfica; `fallo` → el error, distinto del vacío.
//   3. Con series → una barra por categoría, en el orden de `categorias`.
//   4. Los colores salen de VARIABLES CSS de los tokens (`var(--ui-…)`), nunca de
//      un literal en el JS: así el modo oscuro sale solo.
//   5. El texto de los valores lo pone el llamador (`formato`), no la gráfica.
//   6. El tooltip escapa lo que el local tipeó: Unovis lo inyecta como HTML.
//
// Unovis va con stubs: happy-dom no calcula layout y Unovis mide el contenedor
// para dibujar. Se asevera sobre lo que la gráfica le PASA a Unovis —los datos y
// el accessor de color—, que es lo que este componente decide.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppGrafica from './AppGrafica.vue'

// Por módulo y no por `global.stubs`: los componentes de `@unovis/vue` se
// registran todos con `__name: "index"` y un stub por nombre no los encuentra.
vi.mock('@unovis/vue', async () => {
  const { defineComponent, h } = await import('vue')
  const conSlot = (name: string) => defineComponent({
    name,
    inheritAttrs: false,
    props: ['data', 'x', 'y', 'color', 'orientation', 'type', 'tickFormat', 'tickValues', 'triggers', 'numTicks', 'height', 'roundedCorners', 'gridLine'],
    setup(_, { slots }) {
      return () => h('div', { 'data-stub': name }, slots.default?.())
    },
  })
  return {
    VisXYContainer: conSlot('VisXYContainer'),
    VisStackedBar: conSlot('VisStackedBar'),
    VisAxis: conSlot('VisAxis'),
    VisTooltip: conSlot('VisTooltip'),
  }
})

const SERIES = [
  { nombre: 'Sin explicación', color: 'error' as const, valores: ['750', '100'] },
  { nombre: 'Merma', color: 'warning' as const, valores: ['250', '0'] },
]

function montar(props: Record<string, unknown>) {
  return mountSuspended(AppGrafica, {
    props: {
      series: SERIES,
      categorias: ['Harina', 'Queso'],
      formato: (valor: string) => `$${valor}`,
      ...props,
    },
  })
}

describe('AppGrafica', () => {
  it('cargando: muestra el esqueleto y no la gráfica', async () => {
    const wrapper = await montar({ cargando: true })
    expect(wrapper.find('[data-qa="grafica-cargando"]').exists()).toBe(true)
    expect(wrapper.find('[data-stub="VisXYContainer"]').exists()).toBe(false)
  })

  it('vacío y fallo son dos estados distintos, y ninguno dibuja', async () => {
    const vacia = await montar({ vacio: true })
    expect(vacia.find('[data-qa="grafica-vacia"]').exists()).toBe(true)
    expect(vacia.find('[data-stub="VisXYContainer"]').exists()).toBe(false)

    const caida = await montar({ fallo: true })
    expect(caida.find('[data-qa="grafica-fallo"]').exists()).toBe(true)
    expect(caida.find('[data-qa="grafica-vacia"]').exists()).toBe(false)
    expect(caida.find('[data-stub="VisXYContainer"]').exists()).toBe(false)
  })

  it('una barra por categoría, en el orden de `categorias`', async () => {
    const wrapper = await montar({})
    const barras = wrapper.findComponent({ name: 'VisStackedBar' })
    const datos = wrapper.findComponent({ name: 'VisXYContainer' }).props('data') as unknown[]
    expect(datos).toHaveLength(2)
    // Un accessor `y` por serie: eso es lo que las apila.
    expect(barras.props('y')).toHaveLength(2)
    expect(barras.props('orientation')).toBe('horizontal')
    // Cada barra se rotula con SU nombre, y la primera categoría va ARRIBA.
    // Unovis pone la posición 0 abajo: sin invertirla, el que más perdió
    // quedaba al pie de la gráfica (visto en el navegador, 2026-09-21).
    const ejes = wrapper.findAllComponents({ name: 'VisAxis' })
    const rotular = ejes.find(e => e.props('type') === 'y')!.props('tickFormat') as (p: number) => string
    const posicion = barras.props('x') as (d: unknown) => number
    const filas = datos as { categoria: string }[]
    expect(filas.map(d => rotular(posicion(d)))).toEqual(['Harina', 'Queso'])
    expect(posicion(filas[0])).toBeGreaterThan(posicion(filas[1]))
  })

  /** Un nombre largo partía en tres renglones y se montaba sobre la barra de al lado. */
  it('el rótulo largo se recorta; el nombre entero queda en el tooltip', async () => {
    const largo = 'Varianza buckets E2E 1790031643204-0.8038836633633224'
    const wrapper = await montar({ categorias: [largo, 'Queso'] })
    const barras = wrapper.findComponent({ name: 'VisStackedBar' })
    const datos = wrapper.findComponent({ name: 'VisXYContainer' }).props('data') as unknown[]
    const rotular = wrapper.findAllComponents({ name: 'VisAxis' }).find(e => e.props('type') === 'y')!
      .props('tickFormat') as (p: number) => string
    const rotulo = rotular((barras.props('x') as (d: unknown) => number)(datos[0]))
    expect(rotulo.length).toBeLessThanOrEqual(24)
    expect(rotulo.endsWith('…')).toBe(true)
    const triggers = wrapper.findComponent({ name: 'VisTooltip' }).props('triggers') as
      Record<string, (d: unknown) => string>
    expect(Object.values(triggers)[0]!(datos[0])).toContain(largo)
  })

  it('el eje de valores usa `formatoEje` si el llamador lo pasa', async () => {
    const wrapper = await montar({ formatoEje: (v: number) => `$${v}` })
    const eje = wrapper.findAllComponents({ name: 'VisAxis' }).find(e => e.props('type') === 'x')!
    expect((eje.props('tickFormat') as (v: number) => string)(1000)).toBe('$1000')
  })

  it('los colores son variables CSS de los tokens, no literales', async () => {
    const wrapper = await montar({})
    const color = wrapper.findComponent({ name: 'VisStackedBar' }).props('color') as
      (d: unknown, i: number) => string
    expect(color({}, 0)).toBe('var(--ui-error)')
    expect(color({}, 1)).toBe('var(--ui-warning)')
    // La leyenda usa la misma variable que la barra.
    const leyenda = wrapper.find('[data-qa="grafica-leyenda"]').html()
    expect(leyenda).toContain('var(--ui-error)')
    expect(leyenda).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i)
  })

  it('el texto de los valores lo pone el llamador', async () => {
    const wrapper = await montar({ formato: (v: string, i: number) => `v${v}-c${i}` })
    const tooltip = wrapper.findComponent({ name: 'VisTooltip' })
    const triggers = tooltip.props('triggers') as Record<string, (d: unknown) => string>
    const html = Object.values(triggers)[0]!(
      (wrapper.findComponent({ name: 'VisXYContainer' }).props('data') as unknown[])[1],
    )
    expect(html).toContain('v100-c1')
    expect(html).toContain('Queso')
  })

  /** El tooltip de Unovis se inyecta como HTML y el nombre del producto lo tipea el local. */
  it('el nombre de la categoría llega escapado al tooltip', async () => {
    const wrapper = await montar({ categorias: ['<img src=x onerror=alert(1)>', 'Queso'] })
    const triggers = wrapper.findComponent({ name: 'VisTooltip' }).props('triggers') as
      Record<string, (d: unknown) => string>
    const html = Object.values(triggers)[0]!(
      (wrapper.findComponent({ name: 'VisXYContainer' }).props('data') as unknown[])[0],
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
