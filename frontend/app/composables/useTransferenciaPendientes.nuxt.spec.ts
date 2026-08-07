// @vitest-environment nuxt
//
// El bookkeeping del modal "quedaron mesas abiertas", compartido por las dos
// pantallas que cierran sesiones. Vive testeado acá y no en las páginas porque
// `pages/salones/index.vue` —el gemelo que usa el garzón real, con PIN— es una
// pantalla de 1.400 líneas con cinco stores: mientras el bucle estuvo duplicado
// dentro de ella, la mitad que más importa no tenía cómo probarse.
//
// Los tres casos que fija son los que la revisión independiente encontró rotos
// cuando el bucle estaba suelto: cancelar el teclado de PIN perdía la oferta sin
// forma de reabrirla, y una segunda sesión cerrada con transferencias en vuelo
// dejaba el modal con el nombre de un garzón y la lista de otro.
import { describe, it, expect, vi } from 'vitest'
import {
  useTransferenciaPendientes,
  type CuentaPendienteGarzon,
  type SesionCerrada,
} from './useSesionesGarzon'

function pendiente(cuentaId: string, numero: number): CuentaPendienteGarzon {
  return {
    cuentaId,
    numero,
    mesaNombre: `Mesa ${numero}`,
    salonNombre: 'Terraza',
  }
}

function sesionCerrada(
  garzonNombre: string,
  cuentasPendientes: CuentaPendienteGarzon[],
): SesionCerrada {
  return {
    id: `sesion-${garzonNombre}`,
    garzonId: `garzon-${garzonNombre}`,
    garzonNombre,
    turnoId: 'turno-1',
    turnoNombre: 'Almuerzo',
    inicioEl: '2026-08-06T12:00:00.000Z',
    finEl: '2026-08-06T20:00:00.000Z',
    estado: 'cerrada',
    origenCierre: 'pin',
    cerradaPorUsuarioId: null,
    cuentasPendientes,
  }
}

const diferido = () => {
  let resolver: () => void = () => {}
  let rechazar: (e: Error) => void = () => {}
  const promesa = new Promise<void>((res, rej) => {
    resolver = res
    rechazar = rej
  })
  return { promesa, resolver, rechazar }
}

describe('useTransferenciaPendientes', () => {
  it('sin cuentas pendientes no abre nada', () => {
    const t = useTransferenciaPendientes()

    t.ofrecer(sesionCerrada('Ana', []))

    expect(t.abierto.value).toBe(false)
    expect(t.pendientes.value).toEqual([])
  })

  it('con cuentas abre la oferta con el nombre del garzón que salió', () => {
    const t = useTransferenciaPendientes()

    t.ofrecer(sesionCerrada('Ana', [pendiente('c1', 4)]))

    expect(t.abierto.value).toBe(true)
    expect(t.garzonNombre.value).toBe('Ana')
    expect(t.pendientes.value).toHaveLength(1)
  })

  it('transferir todo cierra la oferta y vacía la lista', async () => {
    const t = useTransferenciaPendientes()
    t.ofrecer(sesionCerrada('Ana', [pendiente('c1', 4), pendiente('c2', 7)]))
    const transferir = vi.fn().mockResolvedValue(undefined)

    const res = await t.transferirTodas(transferir)

    expect(transferir.mock.calls.map(c => c[0])).toEqual(['c1', 'c2'])
    expect(res).toEqual({ transferidas: 2, error: null })
    expect(t.abierto.value).toBe(false)
    expect(t.pendientes.value).toEqual([])
  })

  it('corta en el primer error y deja lo que falta para reintentar', async () => {
    const t = useTransferenciaPendientes()
    t.ofrecer(sesionCerrada('Ana', [
      pendiente('c1', 4),
      pendiente('c2', 7),
      pendiente('c3', 9),
    ]))
    const transferir = vi.fn(async (cuentaId: string) => {
      if (cuentaId === 'c2') throw new Error('El garzón no tiene una sesión de trabajo abierta')
    })

    const res = await t.transferirTodas(transferir)

    // c3 NI SE INTENTÓ: el error es del destinatario, no de la cuenta.
    expect(transferir.mock.calls.map(c => c[0])).toEqual(['c1', 'c2'])
    expect(res.transferidas).toBe(1)
    expect(res.error).toContain('sesión de trabajo')
    // La oferta vuelve, ya sin la que sí se transfirió.
    expect(t.abierto.value).toBe(true)
    expect(t.pendientes.value.map(p => p.cuentaId)).toEqual(['c2', 'c3'])
  })

  it('reabrirSiQuedan devuelve la oferta tras cancelar el teclado de PIN, y no la inventa si ya no queda nada', async () => {
    const t = useTransferenciaPendientes()
    t.ofrecer(sesionCerrada('Ana', [pendiente('c1', 4)]))

    // El flujo del PIN cierra este modal para abrir el teclado…
    t.abierto.value = false
    // …y el garzón lo cancela.
    t.reabrirSiQuedan()
    expect(t.abierto.value).toBe(true)

    await t.transferirTodas(vi.fn().mockResolvedValue(undefined))
    t.abierto.value = false
    t.reabrirSiQuedan()
    expect(t.abierto.value).toBe(false)
  })

  it('un segundo submit con transferencias en vuelo no dispara un segundo bucle', async () => {
    const t = useTransferenciaPendientes()
    t.ofrecer(sesionCerrada('Ana', [pendiente('c1', 4)]))
    const { promesa, resolver } = diferido()
    const transferir = vi.fn(() => promesa)

    const primera = t.transferirTodas(transferir)
    await Promise.resolve()
    const segunda = await t.transferirTodas(transferir)

    expect(segunda).toEqual({ transferidas: 0, error: null })
    resolver()
    await primera
    expect(transferir).toHaveBeenCalledTimes(1)
  })

  // La carrera que existe porque la pantalla sigue operable con el modal
  // cerrado: en Salones el teclado de PIN reemplaza al modal, así que el garzón
  // puede tocar "Salir de turno" otra vez mientras los POST vuelan.
  it('una oferta NUEVA llegada durante el vuelo no la pisa el bucle viejo', async () => {
    const t = useTransferenciaPendientes()
    t.ofrecer(sesionCerrada('Ana', [pendiente('c1', 4), pendiente('c2', 7)]))
    const { promesa, resolver } = diferido()
    const transferir = vi.fn(() => promesa)

    const enVuelo = t.transferirTodas(transferir)
    await Promise.resolve()

    // Se cierra la sesión de Bruno mientras la primera transferencia está en vuelo.
    t.ofrecer(sesionCerrada('Bruno', [pendiente('c9', 12)]))
    resolver()
    await enVuelo

    // Sin el chequeo de identidad del lote, acá quedaba la lista de Ana bajo el
    // nombre de Bruno — o peor, la oferta de Bruno cerrada sin que él la viera.
    expect(t.garzonNombre.value).toBe('Bruno')
    expect(t.pendientes.value.map(p => p.cuentaId)).toEqual(['c9'])
    expect(t.abierto.value).toBe(true)
  })
})
