import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import type { MonedaTenantApi } from '~/types/moneda'
import type { LineaHoja, TarifaPagoFila } from '~/types/paqueteria'

// Mismo andamiaje que `useMonedaConversion.spec.ts`: el store de monedas llama a
// `useRuntimeConfig()` al armarse y necesita una app Nuxt que acá no hay.
vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
}))

vi.mock('~/composables/useApiFetch', () => ({ useApiFetch: vi.fn() }))

const activeTenantIdRef = ref<string | null>('tenant-1')
vi.mock('~/stores/auth', () => ({
  useAuthStore: () => ({
    get activeTenantId() { return activeTenantIdRef.value },
  }),
}))

const { useMonedasStore } = await import('~/stores/monedas')
const { usePaqueteria } = await import('./usePaqueteria')

const CLP: MonedaTenantApi = {
  monedaId: 'clp-1',
  nombre: 'Peso Chileno',
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

describe('usePaqueteria', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useMonedasStore().hydrate([CLP], 'tenant-1')
  })

  describe('textoNeto: lo que el repartidor entrega o recibe al rendir', () => {
    it('con neto positivo, el repartidor entrega la plata', () => {
      expect(usePaqueteria().textoNeto('Juan', '50000')).toBe('Juan entrega $50.000')
    })

    it('con neto negativo, el local le paga la diferencia (en positivo)', () => {
      expect(usePaqueteria().textoNeto('Juan', '-5000')).toBe('Se le pagan $5.000 a Juan')
    })

    it('con neto cero, ni entrega ni recibe', () => {
      expect(usePaqueteria().textoNeto('Juan', '0')).toBe('Juan no entrega ni recibe plata')
    })

    it('un cero con decimales sigue siendo cero (se compara como Decimal, no como texto)', () => {
      expect(usePaqueteria().textoNeto('Juan', '0.00')).toBe('Juan no entrega ni recibe plata')
    })
  })

  describe('textoSaldo: el saldo de una rendición', () => {
    it('positivo: lo debe el repartidor', () => {
      expect(usePaqueteria().textoSaldo('10000')).toBe('Debe rendir $10.000')
    })

    it('negativo: la empresa le paga, en positivo', () => {
      expect(usePaqueteria().textoSaldo('-424322')).toBe('La empresa le paga $424.322')
    })

    it('cero, también con decimales: sin saldo', () => {
      expect(usePaqueteria().textoSaldo('0')).toBe('Sin saldo')
      expect(usePaqueteria().textoSaldo('0.00')).toBe('Sin saldo')
    })

    it('presentarSaldo marca el negativo para pintarlo', () => {
      expect(usePaqueteria().presentarSaldo('-5000').negativo).toBe(true)
      expect(usePaqueteria().presentarSaldo('5000').negativo).toBe(false)
    })
  })

  describe('diasAntes y periodo: fechas puras', () => {
    it('diasAntes resta días de calendario, cruzando mes y año', () => {
      expect(usePaqueteria().diasAntes('2026-10-16', 29)).toBe('2026-09-17')
      expect(usePaqueteria().diasAntes('2026-01-03', 5)).toBe('2025-12-29')
    })

    it('periodo: un día solo, o desde y hasta con el formato que se pase', () => {
      const { periodo } = usePaqueteria()
      expect(periodo('2026-10-05', '2026-10-05')).toBe('05-10')
      expect(periodo('2026-10-05', '2026-10-10')).toBe('05-10 al 10-10')
      expect(periodo('2026-10-05', '2026-10-10', f => `<${f}>`)).toBe('<2026-10-05> al <2026-10-10>')
    })
  })

  describe('presentarNeto: el neto de una hoja en una celda', () => {
    it('positivo: el monto, sin marca', () => {
      expect(usePaqueteria().presentarNeto('50000')).toEqual({ texto: '$50.000', negativo: false })
    })

    it('negativo: lo que el local le paga, marcado como negativo', () => {
      expect(usePaqueteria().presentarNeto('-5000')).toEqual({ texto: 'Se le pagan $5.000', negativo: true })
    })

    it('cero (también con decimales): monto cero, sin marca', () => {
      expect(usePaqueteria().presentarNeto('0')).toEqual({ texto: '$0', negativo: false })
      expect(usePaqueteria().presentarNeto('-0.00')).toEqual({ texto: '$0', negativo: false })
    })
  })

  describe('fechaCorta: día-mes de una fecha pura', () => {
    it('da día-mes sin año', () => {
      expect(usePaqueteria().fechaCorta('2026-10-14')).toBe('14-10')
    })

    it('respeta el cero a la izquierda y no corre el día por zona horaria', () => {
      expect(usePaqueteria().fechaCorta('2026-01-01')).toBe('01-01')
      expect(usePaqueteria().fechaCorta('2026-12-31')).toBe('31-12')
    })
  })

  describe('lineasConCobro: las líneas que cobran en destino', () => {
    const linea = (estado: LineaHoja['estado'], cobroEnDestino: boolean): LineaHoja => ({
      paqueteId: `p-${estado}-${cobroEnDestino}`,
      codigo: 'X',
      destinatarioNombre: null,
      direccion: null,
      comuna: null,
      cobroEnDestino,
      precioEnvio: '2500',
      tarifaPagoId: null,
      tarifaPagoNombre: null,
      tarifaPaqueteId: null,
      pagoRepartidor: '1000',
      pagoEstimado: true,
      medioCobro: null,
      estado,
    })

    it('cuenta las en ruta y las entregadas con cobro; no las sin cobro ni las no entregadas', () => {
      const lineas = [
        linea('en_ruta', true),
        linea('entregado', true),
        linea('en_ruta', false),
        linea('entregado', false),
        linea('no_entregado', true),
      ]
      expect(usePaqueteria().lineasConCobro(lineas)).toBe(2)
    })

    it('una hoja vacía da cero', () => {
      expect(usePaqueteria().lineasConCobro([])).toBe(0)
    })
  })

  describe('opcionesTarifa: el selector de tarifa de pago', () => {
    const tarifa = (id: string, nombre: string, monto: string, parcial: Partial<TarifaPagoFila> = {}): TarifaPagoFila =>
      ({ id, nombre, monto, esDefecto: false, activa: true, ...parcial })
    const auto = tarifa('t-auto', 'Auto', '1900', { esDefecto: true })
    const moto = tarifa('t-moto', 'Moto', '1000')

    it('la primera opción es «Según repartidor» con la tarifa que valdría hoy, y vale null', () => {
      const [primera] = usePaqueteria().opcionesTarifa([auto, moto], auto)
      expect(primera).toEqual({ label: 'Según repartidor (Auto $1.900)', value: null })
    })

    it('sin tarifa heredada la primera opción no inventa un monto', () => {
      expect(usePaqueteria().opcionesTarifa([], null)).toEqual([{ label: 'Según repartidor', value: null }])
    })

    it('después van las tarifas activas con su monto; las inactivas no se ofrecen', () => {
      const vieja = tarifa('t-vieja', 'Vieja', '500', { activa: false })
      const opciones = usePaqueteria().opcionesTarifa([auto, moto, vieja], auto)
      expect(opciones.slice(1)).toEqual([
        { label: 'Auto $1.900', value: 't-auto' },
        { label: 'Moto $1.000', value: 't-moto' },
      ])
    })

    it('una inactiva que el paquete ya tiene asignada se mantiene visible', () => {
      const vieja = tarifa('t-vieja', 'Vieja', '500', { activa: false })
      const opciones = usePaqueteria().opcionesTarifa([auto, vieja], auto, 't-vieja')
      expect(opciones.at(-1)).toEqual({ label: 'Vieja $500 (inactiva)', value: 't-vieja' })
    })
  })

  describe('rótulos y colores de estado', () => {
    it('el estado del paquete', () => {
      const { rotuloEstadoPaquete, colorEstadoPaquete } = usePaqueteria()

      expect(rotuloEstadoPaquete('disponible')).toBe('Disponible')
      expect(rotuloEstadoPaquete('en_ruta')).toBe('En ruta')
      expect(rotuloEstadoPaquete('entregado')).toBe('Entregado')
      expect(colorEstadoPaquete('disponible')).toBe('neutral')
      expect(colorEstadoPaquete('en_ruta')).toBe('info')
      expect(colorEstadoPaquete('entregado')).toBe('success')
    })

    it('el estado de la hoja', () => {
      const { rotuloEstadoHoja, colorEstadoHoja } = usePaqueteria()

      expect(rotuloEstadoHoja('abierta')).toBe('Abierta')
      expect(rotuloEstadoHoja('rendida')).toBe('Rendida')
      expect(colorEstadoHoja('abierta')).toBe('info')
      expect(colorEstadoHoja('rendida')).toBe('success')
    })

    it('el estado de la línea de una hoja', () => {
      const { rotuloEstadoLinea, colorEstadoLinea } = usePaqueteria()

      expect(rotuloEstadoLinea('en_ruta')).toBe('En ruta')
      expect(rotuloEstadoLinea('entregado')).toBe('Entregado')
      expect(rotuloEstadoLinea('no_entregado')).toBe('No entregado')
      expect(colorEstadoLinea('en_ruta')).toBe('info')
      expect(colorEstadoLinea('entregado')).toBe('success')
      expect(colorEstadoLinea('no_entregado')).toBe('warning')
    })
  })
})
