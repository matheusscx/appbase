// @vitest-environment nuxt
//
// Un cobro que se repite no se registra dos veces
// (`docs/adr/026-idempotencia-de-cobros.md`).
//
// La clave vive con el intento de cobro: nace con el primer Confirmar, se
// mantiene ante errores y ante cualquier edición del carrito, y muere con el
// éxito, con el vaciado o con el aviso de "otros datos". Si se regenerara al
// editar, el cliente que cambia tarjeta por efectivo después del corte sacaría
// una SEGUNDA venta en vez del 422 que eligió el owner.
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import {
  AVISO_COBRO_REPETIDO,
  HEADER_IDEMPOTENCIA,
  useIntentoCobro,
} from './useIntentoCobro'

interface ToastAction { label: string, onClick?: (e?: Event) => void }
interface Toast { title: string, color?: string, actions?: ToastAction[] }
let toasts: Toast[] = []

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: Toast) => { toasts.push(t) } })
})

interface Navegacion { path: string, query: Record<string, string> }
let navegaciones: Navegacion[] = []

mockNuxtImport('navigateTo', () => {
  return (to: Navegacion) => { navegaciones.push(to); return Promise.resolve() }
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** El 422 de "otros datos" tal como lo arma `IdempotenciaService` (backend). */
function errorOtrosDatos(ventaId: string | null = 'venta-1') {
  return {
    status: 422,
    data: {
      statusCode: 422,
      message: 'Este cobro ya se había registrado con otros datos. Revisá la venta antes de cobrar de nuevo.',
      ventaId,
    },
  }
}

describe('useIntentoCobro', () => {
  beforeEach(() => {
    toasts = []
    navegaciones = []
    // El estado vive a nivel de módulo (sobrevive a cerrar y reabrir un modal),
    // así que cada test arranca terminando los ámbitos que usa.
    for (const ambito of ['pos', 'otro', 'abono:v1']) useIntentoCobro().terminar(ambito)
  })

  it('la cabecera lleva un UUID, estable entre llamados del mismo intento', () => {
    const intento = useIntentoCobro()
    const primera = intento.cabecera('pos')[HEADER_IDEMPOTENCIA]
    expect(primera).toMatch(UUID)
    expect(intento.cabecera('pos')[HEADER_IDEMPOTENCIA]).toBe(primera)
  })

  it('terminar() cierra el intento: el siguiente cobro lleva otra clave', () => {
    const intento = useIntentoCobro()
    const primera = intento.cabecera('pos')[HEADER_IDEMPOTENCIA]
    intento.terminar('pos')
    expect(intento.cabecera('pos')[HEADER_IDEMPOTENCIA]).not.toBe(primera)
  })

  it('dos ámbitos no comparten clave', () => {
    expect(useIntentoCobro().cabecera('pos')[HEADER_IDEMPOTENCIA])
      .not.toBe(useIntentoCobro().cabecera('otro')[HEADER_IDEMPOTENCIA])
  })

  it('el mismo ámbito desde otra instancia ve la misma clave (cerrar y reabrir el modal)', () => {
    const antes = useIntentoCobro().cabecera('abono:v1')[HEADER_IDEMPOTENCIA]
    expect(useIntentoCobro().cabecera('abono:v1')[HEADER_IDEMPOTENCIA]).toBe(antes)
  })

  it('avisarSiRepetido: solo con repetida=true, y con el texto exacto', () => {
    const intento = useIntentoCobro()
    intento.avisarSiRepetido({})
    intento.avisarSiRepetido({ repetida: false })
    expect(toasts).toHaveLength(0)

    intento.avisarSiRepetido({ repetida: true })
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.title).toBe(AVISO_COBRO_REPETIDO)
  })

  it('el 422 de otros datos: toast con el mensaje del backend y "Ver venta" que lleva a esa venta', () => {
    const intento = useIntentoCobro()
    expect(intento.mostrarSiCobroConOtrosDatos(errorOtrosDatos('venta-7'), 'pos')).toBe(true)

    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.title).toContain('ya se había registrado con otros datos')
    const verVenta = toasts[0]!.actions?.find(a => a.label === 'Ver venta')
    expect(verVenta).toBeDefined()
    verVenta!.onClick?.()
    expect(navegaciones).toEqual([{ path: '/ventas', query: { venta: 'venta-7' } }])
  })

  it('cualquier otro error no es "otros datos": no muestra nada y deja el manejo a la pantalla', () => {
    const intento = useIntentoCobro()
    expect(intento.mostrarSiCobroConOtrosDatos({ status: 400, data: { message: 'Sin stock' } }, 'pos')).toBe(false)
    expect(intento.mostrarSiCobroConOtrosDatos(errorOtrosDatos(null), 'pos')).toBe(false)
    expect(intento.mostrarSiCobroConOtrosDatos(new Error('fetch failed'), 'pos')).toBe(false)
    expect(toasts).toHaveLength(0)
  })

  it('cualquier otro error no termina el intento: la clave sigue siendo la misma', () => {
    const intento = useIntentoCobro()
    const antes = intento.cabecera('pos')[HEADER_IDEMPOTENCIA]
    intento.mostrarSiCobroConOtrosDatos({ status: 400, data: { message: 'Sin stock' } }, 'pos')
    intento.mostrarSiCobroConOtrosDatos(new Error('fetch failed'), 'pos')
    expect(intento.cabecera('pos')[HEADER_IDEMPOTENCIA]).toBe(antes)
  })

  it('el aviso de otros datos SÍ cierra el intento: el Confirmar siguiente es una venta nueva (owner, 2026-09-19)', () => {
    const intento = useIntentoCobro()
    const antes = intento.cabecera('pos')[HEADER_IDEMPOTENCIA]
    intento.mostrarSiCobroConOtrosDatos(errorOtrosDatos(), 'pos')
    expect(intento.cabecera('pos')[HEADER_IDEMPOTENCIA]).not.toBe(antes)
  })
})
