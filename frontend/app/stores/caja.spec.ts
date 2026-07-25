import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Caja } from './caja'

// ─── Mock Nuxt virtual modules (same pattern as tenant.spec.ts) ──────────────
vi.mock('#app/nuxt', () => ({
  useNuxtApp: vi.fn(),
  useRuntimeConfig: vi.fn(() => ({
    apiUrl: undefined,
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
  defineNuxtPlugin: vi.fn(),
  definePayloadPlugin: vi.fn(),
  defineAppConfig: vi.fn(),
  tryUseNuxtApp: vi.fn(),
}))

// ─── Mock useApiFetch composable ──────────────────────────────────────────────
const mockApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

// Import AFTER mocks are set up
const { useCajaStore } = await import('./caja')

const CAJA = {
  id: 'caja-1',
  tenantId: 'tenant-1',
  usuarioId: 'user-1',
  tipo: 'fisica',
  estado: 'abierta',
  saldoInicial: '1000.0000',
  saldoFinal: null,
  montoContado: null,
  diferencia: null,
  fechaApertura: '2026-06-29T00:00:00Z',
  fechaCierre: null,
  comentario: null,
}

describe('useCajaStore — cargarActiva', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiFetch.mockReset()
  })

  it('activa inicia como null', () => {
    const store = useCajaStore()
    expect(store.activa).toBeNull()
  })

  it('popula activa con la caja devuelta por el API', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue(CAJA)

    await store.cargarActiva()

    expect(store.activa).toEqual(CAJA)
  })

  it('activa queda en null cuando no hay caja abierta (API responde null)', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue(null)

    await store.cargarActiva()

    expect(store.activa).toBeNull()
  })

  // El backend retorna `null` cuando no hay caja → NestJS envía un body HTTP
  // vacío → ofetch lo deserializa como '' (string vacío), no null. El store debe
  // normalizar esto a null para que `activa !== null` no dé un falso positivo.
  it('activa queda en null cuando el API responde body vacío ("")', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue('')

    await store.cargarActiva()

    expect(store.activa).toBeNull()
  })

  it('abrir setea activa con la respuesta del POST sin depender de GET /activa', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValueOnce(CAJA)

    const result = await store.abrir({ saldoInicial: '1000.0000', cajonId: 'cajon-1' })

    expect(result).toEqual(CAJA)
    expect(store.activa).toEqual(CAJA)
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    expect(mockApiFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/caja/abrir',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('loadingActiva es true durante la llamada y false al terminar', async () => {
    const store = useCajaStore()
    let loadingDuringCall = false
    mockApiFetch.mockImplementation(async () => {
      loadingDuringCall = store.loadingActiva
      return CAJA
    })

    await store.cargarActiva()

    expect(loadingDuringCall).toBe(true)
    expect(store.loadingActiva).toBe(false)
  })
})

describe('useCajaStore — cargarCajonesEstado / cargarDetalle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiFetch.mockReset()
  })

  it('cargarCajonesEstado popula cajonesEstado con la lista del API', async () => {
    const store = useCajaStore()
    const lista = [{ cajonId: 'c1', nombre: 'Mostrador', sesion: null }]
    mockApiFetch.mockResolvedValue(lista)

    await store.cargarCajonesEstado()

    expect(store.cajonesEstado).toEqual(lista)
  })

  it('cargarDetalle popula detalle con la caja del API', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue(CAJA)

    await store.cargarDetalle('caja-1')

    expect(store.detalle).toEqual(CAJA)
  })

  it('cargarDetalle normaliza body vacío ("") a null', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue('')

    await store.cargarDetalle('caja-1')

    expect(store.detalle).toBeNull()
  })
})

describe('useCajaStore — arqueo / cerrar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiFetch.mockReset()
  })

  it('cargarArqueo llena el estado arqueo y arqueoCiego', async () => {
    const lineas = [
      { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, esperado: '1000.0000', requiereConteo: true },
    ]
    mockApiFetch.mockResolvedValueOnce({ ciego: true, lineas })
    const store = useCajaStore()
    await store.cargarArqueo('caja-1')
    expect(store.arqueo).toEqual(lineas)
    expect(store.arqueoCiego).toBe(true)
  })

  it('cargarArqueoCiego devuelve el flag del tenant', async () => {
    mockApiFetch.mockResolvedValueOnce({ arqueoCiego: true })
    const store = useCajaStore()
    const result = await store.cargarArqueoCiego()
    expect(result).toBe(true)
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/caja/arqueo-ciego'),
    )
  })

  it('guardarArqueoCiego envía PUT con { arqueoCiego }', async () => {
    mockApiFetch.mockResolvedValueOnce(undefined)
    const store = useCajaStore()
    await store.guardarArqueoCiego(false)
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/caja/arqueo-ciego'),
      expect.objectContaining({ method: 'PUT', body: { arqueoCiego: false } }),
    )
  })

  it('enviarConteo envía { lineas, comentario } a /conteo y setea arqueo', async () => {
    const arqueo = [{ metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, esperado: '1000.0000', requiereConteo: true }]
    mockApiFetch.mockResolvedValueOnce({ estado: 'en_conciliacion', arqueo })
    const store = useCajaStore()
    const payload = { lineas: [{ metodoPagoId: null, montoContado: '900' }] }
    const res = await store.enviarConteo('caja-1', payload)
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/caja/caja-1/conteo'),
      expect.objectContaining({ method: 'POST', body: payload }),
    )
    expect(res.estado).toBe('en_conciliacion')
    expect(store.arqueo).toEqual(arqueo)
  })

  it('enviarConteo avanza activa/detalle a "en_conciliacion" localmente (retomar sin recargar)', async () => {
    mockApiFetch.mockResolvedValueOnce({ estado: 'en_conciliacion', arqueo: [] })
    const store = useCajaStore()
    store.activa = { id: 'caja-1', estado: 'abierta' } as unknown as Caja
    store.detalle = { id: 'caja-1', estado: 'abierta' } as unknown as Caja
    await store.enviarConteo('caja-1', { lineas: [{ metodoPagoId: null, montoContado: '900' }] })
    expect(store.activa?.estado).toBe('en_conciliacion')
    expect(store.detalle?.estado).toBe('en_conciliacion')
  })

  it('enviarConteo limpia activa/resumenTurno cuando el estado devuelto es "cerrada"', async () => {
    mockApiFetch.mockResolvedValueOnce({ estado: 'cerrada', arqueo: [] })
    const store = useCajaStore()
    store.activa = { id: 'caja-1' } as never
    await store.enviarConteo('caja-1', { lineas: [{ metodoPagoId: null, montoContado: '1000' }] })
    expect(store.activa).toBeNull()
  })

  it('cerrar (fase 2) envía { lineas } con motivos a /cerrar y limpia el estado', async () => {
    mockApiFetch.mockResolvedValueOnce({ caja: { id: 'caja-1' }, arqueo: [] })
    const store = useCajaStore()
    const payload = { lineas: [{ metodoPagoId: null, motivoDiferenciaId: 'motivo-1' }] }
    await store.cerrar('caja-1', payload)
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/caja/caja-1/cerrar'),
      expect.objectContaining({ method: 'POST', body: payload }),
    )
    expect(store.activa).toBeNull()
  })

  it('justificarDiferencias envía PATCH { lineas } a /arqueo/motivos', async () => {
    mockApiFetch.mockResolvedValueOnce({ ciego: false, lineas: [] })
    const store = useCajaStore()
    const lineas = [{ metodoPagoId: null, motivoDiferenciaId: 'motivo-2' }]
    await store.justificarDiferencias('caja-1', lineas)
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/caja/caja-1/arqueo/motivos'),
      expect.objectContaining({ method: 'PATCH', body: { lineas } }),
    )
  })

  it('cargarMotivos(true) llama a /motivos-diferencia?soloActivas=true', async () => {
    const motivos = [{ id: 'm1', nombre: 'Falta de efectivo', activo: true, requiereComentario: false, esFijo: true }]
    mockApiFetch.mockResolvedValueOnce(motivos)
    const store = useCajaStore()
    await store.cargarMotivos(true)
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/motivos-diferencia?soloActivas=true'),
    )
    expect(store.motivos).toEqual(motivos)
  })
})

describe('useCajaStore — resumen ciego', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiFetch.mockReset()
  })

  it('aplicarMovimientoLocal es no-op cuando el resumen es ciego', () => {
    const store = useCajaStore()
    store.resumenTurno = {
      ciego: true,
      saldoInicial: '1000.0000',
      totalEntradas: null,
      totalSalidas: null,
      saldoEsperado: null,
      totalMovimientos: null,
    }
    store.aplicarMovimientoLocal('entrada', '500')
    expect(store.resumenTurno.totalEntradas).toBeNull()
    expect(store.resumenTurno.saldoEsperado).toBeNull()
    expect(store.resumenTurno.totalMovimientos).toBeNull()
  })

  it('aplicarMovimientoLocal actualiza totales cuando NO es ciego', () => {
    const store = useCajaStore()
    store.resumenTurno = {
      ciego: false,
      saldoInicial: '1000.0000',
      totalEntradas: '0.0000',
      totalSalidas: '0.0000',
      saldoEsperado: '1000.0000',
      totalMovimientos: 0,
    }
    store.aplicarMovimientoLocal('entrada', '500')
    expect(store.resumenTurno.totalEntradas).toBe('500.0000')
    expect(store.resumenTurno.saldoEsperado).toBe('1500.0000')
  })

  it('abrir siembra resumenTurno con ciego:false', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue({ ...CAJA, saldoInicial: '1000.0000' })
    await store.abrir({ saldoInicial: '1000.0000', cajonId: 'cajon-1' })
    expect(store.resumenTurno?.ciego).toBe(false)
  })
})
