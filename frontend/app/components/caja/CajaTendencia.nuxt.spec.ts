// @vitest-environment nuxt
//
// La tendencia es una LECTURA de supervisión: el gate real es el guard del
// backend (`Cajas:Leer` en `caja.controller.ts`), y el `definePageMeta` de la
// página solo evita que se pinte para quien no puede leerla. Lo que este spec
// cubre es lo que el backend no puede: que la ventana por defecto sea la que se
// decidió, que las dos cifras de plata se muestren SEPARADAS con su signo, y que
// el cero no se disfrace de sobrante.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaTendencia from './CajaTendencia.vue'
import type { TendenciaDescuadres } from '~/stores/caja'

const FILAS: TendenciaDescuadres[] = [
  {
    usuarioId: 'u-1',
    usuarioNombre: 'Ana Pérez',
    cierres: 20,
    efectivoSuma: '-60000',
    otrosMediosSuma: '1500',
    conFaltante: 18,
    conSobrante: 1,
    cuadrados: 1,
  },
]

const cargarTendencia = vi.fn<(desde?: string, hasta?: string) => Promise<TendenciaDescuadres[]>>()
mockNuxtImport('useCajaStore', () => () => ({ cargarTendencia }))

// `formatMonto` cae en `formatOficial`, que devuelve '—' si la store de monedas
// está vacía. En la app la hidrata el layout `dashboard` (que esta página usa);
// acá la página se monta sola, así que hay que hidratarla a mano o los montos
// no se renderizan y el spec no probaría nada.
const MONEDA_CLP = {
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

beforeEach(() => {
  // `mockReset` y no `mockClear`: un test que instala `mockImplementation` y
  // falla antes de limpiarla se la filtra al siguiente, que entonces falla por
  // contaminación y con un mensaje que no tiene nada que ver con su causa.
  cargarTendencia.mockReset()
  cargarTendencia.mockResolvedValue(FILAS)
  useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
})

describe('CajaTendencia', () => {
  it('arranca con una ventana de 30 días', async () => {
    await mountSuspended(CajaTendencia)

    expect(cargarTendencia).toHaveBeenCalledTimes(1)
    const [desde, hasta] = cargarTendencia.mock.calls[0] as unknown as [string, string]
    const dias = (new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000
    expect(Math.round(dias)).toBe(30)
  })

  it('muestra efectivo y otros medios como dos cifras distintas, cada una con su signo', async () => {
    const wrapper = await mountSuspended(CajaTendencia)
    const texto = wrapper.text()

    // Si alguna vez se sumaran en una sola cifra (-58.500), ninguna de las dos
    // aparecería. Es el bug que `CajaHistorial.vue` ya documentó al revés:
    // mostrar solo el efectivo escondía el descuadre de tarjeta.
    expect(texto).toContain('60.000')
    expect(texto).toContain('1.500')
    expect(texto).not.toContain('58.500')
  })

  it('serializa: no dispara una carga nueva con la anterior en vuelo', async () => {
    // La propiedad que la cola garantiza NO es "la vieja no pisa a la nueva"
    // —con cola nunca hay dos respuestas compitiendo, así que eso sería vacuo—
    // sino que **nunca hay dos GET en vuelo**. Sin cola, mover los dos filtros
    // dispara las tres llamadas de una y gana la que responda última.
    const resolvers: ((v: TendenciaDescuadres[]) => void)[] = []
    cargarTendencia.mockImplementation(
      () => new Promise<TendenciaDescuadres[]>(res => resolvers.push(res)),
    )

    const wrapper = await mountSuspended(CajaTendencia)
    const vm = wrapper.vm as unknown as { filtroDesde: string, filtroHasta: string }
    vm.filtroDesde = '2026-01-01'
    await nextTick()
    vm.filtroHasta = '2026-03-31'
    await nextTick()

    // Las dos del watch quedaron ENCOLADAS: sigue en vuelo solo la de onMounted.
    expect(cargarTendencia).toHaveBeenCalledTimes(1)

    resolvers[0]?.([])
    await new Promise(r => setTimeout(r, 20))

    // Recién ahora arranca la siguiente, y con la ventana ya actualizada.
    expect(cargarTendencia).toHaveBeenCalledTimes(2)
    expect(cargarTendencia.mock.calls[1]).toEqual(['2026-01-01', '2026-03-31'])
  })

  it('si la carga falla NO se lee como "no hay descuadres"', async () => {
    // El bug que fija este test: sin `catch`, un 500 dejaba la tabla en su
    // estado vacío normal. En una pantalla antifraude eso invierte el sentido
    // del mensaje — "no pude cargar" pasaba a leerse "está todo limpio".
    cargarTendencia.mockRejectedValueOnce(new Error('500'))

    const wrapper = await mountSuspended(CajaTendencia)
    const texto = wrapper.text()

    expect(texto).toContain('No se pudo cargar')
    expect(texto).not.toContain('Ninguna caja con el conteo cerrado')
  })

  it('el cero no lleva signo ni verde: no es un sobrante', async () => {
    cargarTendencia.mockResolvedValueOnce([
      { ...FILAS[0]!, efectivoSuma: '0', otrosMediosSuma: '0' },
    ])

    const wrapper = await mountSuspended(CajaTendencia)

    expect(wrapper.text()).not.toContain('+$0')
    expect(wrapper.html()).not.toContain('text-green-600')
  })

  it('pinta el faltante en rojo y el sobrante en verde', async () => {
    const wrapper = await mountSuspended(CajaTendencia)
    const html = wrapper.html()

    expect(html).toContain('text-red-600')
    expect(html).toContain('text-green-600')
  })
})
