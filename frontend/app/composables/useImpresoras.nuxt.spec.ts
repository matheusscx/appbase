// @vitest-environment nuxt
//
// Trampa de la papelera de `configuracion/impresoras.vue`
// (`docs/features/papelera.md`): `useImpresoras().listar()` gana un segundo
// parámetro `incluirEliminados` para alimentar esa pantalla. Este spec fija
// que el default sigue siendo `false`. Los caminos de impresión
// (`imprimirComanda`, `obtenerImpresoraBoleta`) YA NO pasan por `listar()`
// —ver el describe de abajo, "impresoras operativas"—, así que la trampa que
// antes cazaba acá (que empezaran a traer borradas) ya no puede ocurrir por
// esta vía: el endpoint que usan ahora (`GET /impresoras/operacion`) no tiene
// parámetro `incluirEliminados`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useImpresoras } from './useImpresoras'

let calls: string[] = []
let impresorasComanda: unknown[] = []
let impresorasBoleta: unknown[] = []

/**
 * `qz-tray` es solo-navegador; `imprimirEn()` (interno de `useImpresoras`) lo
 * importa de verdad, así que hay que stubearlo — mismo motivo y molde que
 * `pos.nuxt.spec.ts`/`salones/index.nuxt.spec.ts`. Acá además se simula el
 * estado del singleton (`isActive()`) para probar el techo de `connect()`:
 * `connect()` deja `activo = true` (CONNECTING/OPEN, igual que el `qz` real,
 * `frontend/node_modules/qz-tray/qz-tray.js` → `isActive()`) y NUNCA resuelve
 * ni rechaza por su cuenta —simula el handshake colgado (QZ Tray corriendo,
 * esperando el diálogo de autorización) que `docs/agent/pendientes.md` § 3
 * midió—; solo `disconnect()` lo vuelve a poner en `false`. Si el código bajo
 * prueba no llama a `disconnect()` tras el timeout, el segundo intento ve
 * `isActive() === true` y NUNCA vuelve a llamar `connect()` — eso es lo que
 * cazan los tests (b) de abajo.
 */
const { qzState, qzMock } = vi.hoisted(() => {
  const qzState = { activo: false }
  const qzMock = {
    websocket: {
      isActive: () => qzState.activo,
      connect: vi.fn(() => {
        qzState.activo = true
        return new Promise<void>(() => {})
      }),
      disconnect: vi.fn(() => {
        qzState.activo = false
        return Promise.resolve()
      }),
    },
    configs: { create: () => ({}) },
    security: {
      setCertificatePromise: () => {},
      setSignatureAlgorithm: () => {},
      setSignaturePromise: () => {},
    },
    print: vi.fn(() => Promise.resolve()),
  }
  return { qzState, qzMock }
})
vi.mock('qz-tray', () => ({ default: qzMock }))

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (url.includes('/impresoras/qz/certificado')) return Promise.resolve({ certificado: null })
    if (url.includes('/comanda/reclamar')) return Promise.resolve({ estaciones: [] })
    calls.push(url)
    if (url.includes('/impresoras/operacion')) {
      return Promise.resolve(url.includes('rol=comanda') ? impresorasComanda : impresorasBoleta)
    }
    // `listar()` de configuración (no la tocan los tests de acá abajo).
    return Promise.resolve([])
  }
})

describe('useImpresoras — listar() no trae borradas por default (pantalla de configuración)', () => {
  beforeEach(() => {
    calls = []
  })

  it('listar() sin argumentos no pide eliminadas', async () => {
    await useImpresoras().listar()

    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('incluirEliminados')
  })

  it('listar(\'comanda\') no pide eliminadas', async () => {
    await useImpresoras().listar('comanda')

    expect(calls[0]).toContain('rol=comanda')
    expect(calls[0]).not.toContain('incluirEliminados')
  })

  it('listar(\'boleta\') no pide eliminadas', async () => {
    await useImpresoras().listar('boleta')

    expect(calls[0]).toContain('rol=boleta')
    expect(calls[0]).not.toContain('incluirEliminados')
  })

  it('listar(rol, true) sí las pide —lo que usa la papelera de configuracion/impresoras.vue—', async () => {
    await useImpresoras().listar(undefined, true)

    expect(calls[0]).toContain('incluirEliminados=true')
  })
})

/** `BoletaEmisor`/`TicketTotales`/`BoletaItem`/`ImpuestoBoleta` mínimos: a
 * estos tests no les importa el contenido del ticket, solo si `imprimirEn()`
 * llega a tocar QZ Tray. */
function precuentaMinima() {
  return {
    emisor: { nombre: 'Test' },
    mesaNombre: 'Mesa 1',
    cuentaNumero: 1,
    items: [],
    totales: {
      subtotalNeto: '0',
      totalDescuentos: '0',
      totalRecargos: '0',
      totalImpuestos: '0',
      totalFinal: '0',
    },
    impuestos: [],
    formatMonto: (v: string) => v,
  }
}

describe('useImpresoras — impresoras operativas (imprimir sin Impresoras:Leer) y techo al conectar', () => {
  beforeEach(() => {
    calls = []
    impresorasComanda = []
    impresorasBoleta = []
    qzState.activo = false
    qzMock.websocket.connect.mockClear()
    qzMock.websocket.disconnect.mockClear()
  })

  it('imprimirComanda() pide GET /impresoras/operacion?rol=comanda, no GET /impresoras', async () => {
    // Sin impresoras de comanda activas: corta ANTES de reclamar o tocar QZ,
    // la única llamada de red es la de operativas.
    const resultado = await useImpresoras().imprimirComanda('cuenta-1', {
      mesaNombre: 'Mesa 1',
      cuentaNumero: 1,
      garzonNombre: null,
    })

    expect(resultado).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/impresoras/operacion?rol=comanda')
  })

  it('imprimirPrecuenta() —vía obtenerImpresoraBoleta()— pide GET /impresoras/operacion?rol=boleta', async () => {
    // impresorasBoleta queda [] (default del beforeEach): sin impresora
    // activa, corta antes de tocar QZ Tray.
    await useImpresoras().imprimirPrecuenta(precuentaMinima())

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/impresoras/operacion?rol=boleta')
    expect(qzMock.websocket.connect).not.toHaveBeenCalled()
  })

  it('connect() vence a los 5 s con el mensaje en castellano', async () => {
    impresorasBoleta = [
      { id: 'imp-b1', tipoConexion: 'red', host: '10.0.0.8', puerto: 9100, nombreCola: null, activo: true },
    ]
    vi.useFakeTimers()
    const promesa = useImpresoras().imprimirPrecuenta(precuentaMinima())
    const assertion = expect(promesa).rejects.toThrow('No se pudo conectar con QZ Tray (timeout 5 s)')
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    vi.useRealTimers()
  })

  it('un segundo intento después del vencimiento vuelve a llamar a connect() (no falla al instante)', async () => {
    impresorasBoleta = [
      { id: 'imp-b1', tipoConexion: 'red', host: '10.0.0.8', puerto: 9100, nombreCola: null, activo: true },
    ]
    vi.useFakeTimers()

    const primero = useImpresoras().imprimirPrecuenta(precuentaMinima()).catch(() => {})
    await vi.advanceTimersByTimeAsync(5_000)
    await primero
    expect(qzMock.websocket.connect).toHaveBeenCalledTimes(1)
    expect(qzMock.websocket.disconnect).toHaveBeenCalledTimes(1)

    const segundo = useImpresoras().imprimirPrecuenta(precuentaMinima())
    const assertion = expect(segundo).rejects.toThrow('No se pudo conectar con QZ Tray (timeout 5 s)')
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    expect(qzMock.websocket.connect).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  /**
   * QZ Tray real (sin certificado, medido 2026-09-30): con el diálogo de
   * autorización abierto, `disconnect()` NUNCA termina —el socket no emite
   * `close`— y el segundo `connect()` rechaza al instante con el Error de
   * `qz-tray.js` ("Waiting for previous disconnect request to complete",
   * ver `node_modules/qz-tray/qz-tray.js`), no con otro timeout. El mock de
   * arriba (`disconnect()` que resuelve en el acto) modela un QZ que no es
   * el real; acá se simula el de verdad.
   */
  it('con un disconnect() que no termina, el segundo connect() rechaza con el mensaje real de qz-tray → aviso de autorización pendiente, sin reintento', async () => {
    impresorasBoleta = [
      { id: 'imp-b1', tipoConexion: 'red', host: '10.0.0.8', puerto: 9100, nombreCola: null, activo: true },
    ]
    qzMock.websocket.connect
      .mockImplementationOnce(() => {
        qzState.activo = true
        return new Promise<void>(() => {}) // cuelga — el diálogo sigue sin respuesta
      })
      .mockImplementationOnce(() =>
        Promise.reject(new Error('Waiting for previous disconnect request to complete')))
    qzMock.websocket.disconnect.mockImplementationOnce(() => {
      // Real: `shutdown = true` se settea síncrono (por eso `isActive()` ya
      // da `false` para el próximo intento), pero el socket nunca emite
      // `close` con el diálogo abierto — este mock nunca resuelve.
      qzState.activo = false
      return new Promise(() => {})
    })
    vi.useFakeTimers()

    const primero = useImpresoras().imprimirPrecuenta(precuentaMinima()).catch(() => {})
    await vi.advanceTimersByTimeAsync(5_000)
    await primero
    expect(qzMock.websocket.connect).toHaveBeenCalledTimes(1)
    expect(qzMock.websocket.disconnect).toHaveBeenCalledTimes(1)

    // El segundo `connect()` ya viene mockeado para rechazar al instante:
    // no hace falta avanzar el reloj, y si hubiera un reintento automático
    // `connect` se habría llamado una tercera vez.
    await expect(useImpresoras().imprimirPrecuenta(precuentaMinima()))
      .rejects.toThrow('QZ Tray está esperando que autorices la conexión en su ventana')
    expect(qzMock.websocket.connect).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('un rechazo de connect() que no es ninguno de los dos mensajes conocidos sigue dando el error genérico de impresión', async () => {
    impresorasBoleta = [
      { id: 'imp-b1', tipoConexion: 'red', host: '10.0.0.8', puerto: 9100, nombreCola: null, activo: true },
    ]
    qzMock.websocket.connect.mockImplementationOnce(() =>
      Promise.reject(new Error('Unable to establish connection with QZ')))

    await expect(useImpresoras().imprimirPrecuenta(precuentaMinima()))
      .rejects.toThrow('No se pudo imprimir. Revisá la impresora o QZ Tray.')
    expect(qzMock.websocket.connect).toHaveBeenCalledTimes(1)
    expect(qzMock.websocket.disconnect).not.toHaveBeenCalled()
  })
})
