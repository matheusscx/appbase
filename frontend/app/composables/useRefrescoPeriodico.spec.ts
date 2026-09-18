// `useRefrescoPeriodico` — el primer refresco periódico del sistema (spec
// `2026-09-18-dashboard-inicio-design.md` § 6). Lo que este spec fija:
//   1. Carga al invocarse y otra vez a los 60 s (default).
//   2. Con la pestaña oculta el tick no carga; al volver a visible carga una vez.
//   3. Un fallo conserva `datos`, pone `sinConexion`, y NO reintenta antes del
//      próximo ciclo (el owner no quiere reintentos automáticos).
//   4. Un 403 pone `oculto`, detiene el intervalo, y no hay más llamadas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { useRefrescoPeriodico } from './useRefrescoPeriodico'

let visibilityState: DocumentVisibilityState = 'visible'

beforeEach(() => {
  visibilityState = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function ocultarPestana() {
  visibilityState = 'hidden'
}

async function volverAVisible() {
  visibilityState = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
  await vi.advanceTimersByTimeAsync(0)
}

describe('useRefrescoPeriodico', () => {
  it('carga al inicio y otra vez a los 60 s', async () => {
    const cargar = vi.fn().mockResolvedValue({ valor: 1 })
    const { datos } = useRefrescoPeriodico(cargar)

    await vi.advanceTimersByTimeAsync(0)
    expect(cargar).toHaveBeenCalledTimes(1)
    expect(datos.value).toEqual({ valor: 1 })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(cargar).toHaveBeenCalledTimes(2)
  })

  it('con la pestaña oculta el tick no carga; al volver a visible carga una vez', async () => {
    const cargar = vi.fn().mockResolvedValue({ valor: 1 })
    useRefrescoPeriodico(cargar)
    await vi.advanceTimersByTimeAsync(0)
    expect(cargar).toHaveBeenCalledTimes(1)

    ocultarPestana()
    await vi.advanceTimersByTimeAsync(60_000)
    // La pestaña estuvo oculta durante el tick: no se pidió de nuevo.
    expect(cargar).toHaveBeenCalledTimes(1)

    await volverAVisible()
    expect(cargar).toHaveBeenCalledTimes(2)
  })

  it('un fallo conserva datos, pone sinConexion, y no reintenta antes del próximo tick', async () => {
    const cargar = vi.fn()
      .mockResolvedValueOnce({ valor: 1 })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ valor: 2 })
    const { datos, sinConexion } = useRefrescoPeriodico(cargar)

    await vi.advanceTimersByTimeAsync(0)
    expect(datos.value).toEqual({ valor: 1 })
    expect(sinConexion.value).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(cargar).toHaveBeenCalledTimes(2)
    expect(sinConexion.value).toBe(true)
    // El dato anterior se conserva: la carga fallida no lo borra.
    expect(datos.value).toEqual({ valor: 1 })

    // A mitad de camino del próximo ciclo: todavía no reintentó.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cargar).toHaveBeenCalledTimes(2)

    // Recién en el próximo tick completo.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cargar).toHaveBeenCalledTimes(3)
    expect(sinConexion.value).toBe(false)
    expect(datos.value).toEqual({ valor: 2 })
  })

  it('un 403 pone oculto y detiene el intervalo: no hay más llamadas en los ticks siguientes', async () => {
    const cargar = vi.fn().mockRejectedValue({ status: 403 })
    const { oculto, datos } = useRefrescoPeriodico(cargar)

    await vi.advanceTimersByTimeAsync(0)
    expect(oculto.value).toBe(true)
    expect(cargar).toHaveBeenCalledTimes(1)
    expect(datos.value).toBeNull()

    // El intervalo mismo se cancela (no solo un guard en `refrescar`): sin
    // esto, un timer se queda agendando ticks para siempre sobre un bloque
    // que nunca va a volver a mostrarse. `getTimerCount` lo mide directo —
    // distingue "canceló el setInterval" de "el guard de `oculto` amortigua
    // la llamada pero el timer sigue vivo", que hacia afuera se ven igual
    // (cero llamadas a `cargar`) pero no lo son.
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cargar).toHaveBeenCalledTimes(1)

    // Ni siquiera un `visibilitychange` insiste sobre un bloque oculto.
    await volverAVisible()
    expect(cargar).toHaveBeenCalledTimes(1)
  })

  it('lee el status anidado en response.status (forma de error de useApiFetch)', async () => {
    const cargar = vi.fn().mockRejectedValue({ response: { status: 403 } })
    const { oculto } = useRefrescoPeriodico(cargar)

    await vi.advanceTimersByTimeAsync(0)
    expect(oculto.value).toBe(true)
  })

  it('respeta intervaloMs custom', async () => {
    const cargar = vi.fn().mockResolvedValue({ valor: 1 })
    useRefrescoPeriodico(cargar, { intervaloMs: 5_000 })

    await vi.advanceTimersByTimeAsync(0)
    expect(cargar).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(cargar).toHaveBeenCalledTimes(2)
  })

  it('onScopeDispose limpia el intervalo y el listener de visibilitychange', async () => {
    const cargar = vi.fn().mockResolvedValue({ valor: 1 })
    const scope = effectScope()
    scope.run(() => {
      useRefrescoPeriodico(cargar)
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(cargar).toHaveBeenCalledTimes(1)

    scope.stop()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(cargar).toHaveBeenCalledTimes(1)

    await volverAVisible()
    expect(cargar).toHaveBeenCalledTimes(1)
  })

  it('refrescar() expuesto dispara una carga manual', async () => {
    const cargar = vi.fn().mockResolvedValue({ valor: 1 })
    const { refrescar } = useRefrescoPeriodico(cargar)
    await vi.advanceTimersByTimeAsync(0)
    expect(cargar).toHaveBeenCalledTimes(1)

    await refrescar()
    expect(cargar).toHaveBeenCalledTimes(2)
  })
})
