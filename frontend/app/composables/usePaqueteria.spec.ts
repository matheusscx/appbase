import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import type { MonedaTenantApi } from '~/types/moneda'
import type { LineaHoja } from '~/types/paqueteria'

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
      pagoRepartidor: '1000',
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
