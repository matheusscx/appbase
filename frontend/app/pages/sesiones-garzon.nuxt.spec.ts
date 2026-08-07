// @vitest-environment nuxt
//
// Forzar el cierre de una sesión NO se bloquea aunque el garzón tenga mesas
// abiertas (decisión del owner, 2026-08-06). El precio de no bloquear es que
// esas mesas quedan sin poder cobrarse —`cerrarCuenta` exige que el responsable
// esté en turno—, así que el cierre devuelve la lista y esta pantalla ofrece
// transferirla. Lo que se fija acá es esa oferta, que es toda de runtime: el
// build y el typecheck ven un modal bien tipado tanto si se abre como si no.
//
// El destino sale de las sesiones que siguen ABIERTAS y no del catálogo de
// garzones: `transferir-admin` rechaza a quien no tiene sesión, y ofrecer a
// todos sería ofrecer opciones que terminan en 400.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { CuentaPendienteGarzon } from '~/composables/useSesionesGarzon'
import Sesiones from './sesiones-garzon.vue'

const SESION_ANA = 'sesion-ana'
const GARZON_ANA = 'garzon-ana'
const GARZON_BRUNO = 'garzon-bruno'

interface SesionFake {
  id: string
  garzonId: string
  garzonNombre: string
  turnoId: string
  turnoNombre: string
  inicioEl: string
  finEl: string | null
  estado: 'abierta' | 'cerrada'
  origenCierre: 'pin' | 'admin' | null
  cerradaPorUsuarioId: string | null
}

function sesion(over: Partial<SesionFake> = {}): SesionFake {
  return {
    id: SESION_ANA,
    garzonId: GARZON_ANA,
    garzonNombre: 'Ana',
    turnoId: 'turno-1',
    turnoNombre: 'Almuerzo',
    inicioEl: '2026-08-06T12:00:00.000Z',
    finEl: null,
    estado: 'abierta',
    origenCierre: null,
    cerradaPorUsuarioId: null,
    ...over,
  }
}

// Anotado a propósito: sin el tipo de retorno, TypeScript no chequea propiedades
// de más y el fixture se queda con campos que el contrato ya no tiene.
function pendiente(cuentaId: string, numero: number): CuentaPendienteGarzon {
  return {
    cuentaId,
    numero,
    mesaNombre: `Mesa ${numero}`,
    salonNombre: 'Terraza',
  }
}

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    esAdmin: true,
    can: () => true,
  })
})

let abiertasBackend: SesionFake[] = []
let pendientesAlCerrar: ReturnType<typeof pendiente>[] = []
let transferencias: { cuentaId: string, garzonId: string }[] = []
/** `cuentaId` que el backend rechaza al transferir (null = todas pasan). */
let transferenciaFalla: string | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: { garzonId?: string } }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const method = opts?.method ?? 'GET'

    const transferir = /\/cuentas\/([^/]+)\/transferir-admin$/.exec(url)
    if (transferir && method === 'POST') {
      const cuentaId = transferir[1]!
      if (cuentaId === transferenciaFalla) {
        return Promise.reject(new Error('El garzón no tiene una sesión de trabajo abierta'))
      }
      transferencias.push({ cuentaId, garzonId: opts?.body?.garzonId ?? '' })
      return Promise.resolve({ id: cuentaId })
    }

    const cerrar = /\/sesiones-garzon\/([^/]+)\/cerrar$/.exec(url)
    if (cerrar && method === 'POST') {
      const id = cerrar[1]!
      const cerrada = abiertasBackend.find(s => s.id === id) ?? sesion({ id })
      abiertasBackend = abiertasBackend.filter(s => s.id !== id)
      return Promise.resolve({
        ...cerrada,
        estado: 'cerrada',
        origenCierre: 'admin',
        finEl: '2026-08-06T20:00:00.000Z',
        cuentasPendientes: pendientesAlCerrar,
      })
    }

    if (url.includes('/sesiones-garzon/abiertas')) {
      return Promise.resolve(abiertasBackend.map(s => ({ ...s })))
    }
    if (url.includes('/sesiones-garzon?')) {
      return Promise.resolve({
        data: [],
        meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 },
      })
    }
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Sesiones)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

function dialogo(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]')
}

/** Acotado al diálogo: "Forzar cierre" es también el texto del botón de la fila. */
async function clickEnModal(texto: string) {
  const d = dialogo()
  expect(d, `modal abierto para "${texto}"`).toBeTruthy()
  const boton = [...d!.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === texto)
  expect(boton, `botón "${texto}" dentro del modal`).toBeTruthy()
  boton!.click()
  await new Promise(r => setTimeout(r, 50))
}

async function forzarCierreDeLaFila(wrapper: Awaited<ReturnType<typeof montar>>) {
  const boton = wrapper.findAll('button').find(b => b.text().trim() === 'Forzar cierre')
  expect(boton, 'botón "Forzar cierre" en la fila').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 20))
  await clickEnModal('Forzar cierre')
}

describe('sesiones-garzon — cierre admin con mesas abiertas', () => {
  beforeEach(() => {
    // Los modales van teletransportados al `body` y los toasts viven fuera del
    // wrapper: sin esto, `dialogo()` puede devolver el modal del test anterior
    // y una aserción sobre `document.body.textContent` puede estar leyendo un
    // toast viejo. Ambas cosas pasan por ser verdes sin probar nada.
    document.body.innerHTML = ''
    abiertasBackend = [
      sesion(),
      sesion({
        id: 'sesion-bruno',
        garzonId: GARZON_BRUNO,
        garzonNombre: 'Bruno',
        turnoNombre: 'Cena',
      }),
    ]
    pendientesAlCerrar = []
    transferencias = []
    transferenciaFalla = null
  })

  it('sin cuentas pendientes el cierre no abre ningún modal extra', async () => {
    const wrapper = await montar()
    await forzarCierreDeLaFila(wrapper)

    // Ancla positiva: el cierre SÍ ocurrió (la fila de Ana desapareció).
    expect(wrapper.text()).not.toContain('Ana')
    expect(document.body.textContent).not.toContain('Quedaron mesas sin responsable')

    wrapper.unmount()
  })

  it('con cuentas pendientes avisa, las lista, y ofrece a los que siguen en turno', async () => {
    pendientesAlCerrar = [pendiente('cuenta-1', 4), pendiente('cuenta-2', 7)]

    const wrapper = await montar()
    await forzarCierreDeLaFila(wrapper)

    const texto = document.body.textContent ?? ''
    expect(texto).toContain('Quedaron mesas sin responsable')
    expect(texto).toContain('Terraza · Mesa 4 — Cuenta 4')
    expect(texto).toContain('Terraza · Mesa 7 — Cuenta 7')
    // Bruno sigue en turno y es el único destino posible; Ana, que acaba de
    // salir, no puede recibir sus propias mesas de vuelta.
    expect(texto).toContain('Bruno · Cena')

    wrapper.unmount()
  })

  it('transferir manda una llamada por cuenta al garzón elegido y cierra el modal', async () => {
    pendientesAlCerrar = [pendiente('cuenta-1', 4), pendiente('cuenta-2', 7)]

    const wrapper = await montar()
    await forzarCierreDeLaFila(wrapper)
    await clickEnModal('Transferir')

    expect(transferencias).toEqual([
      { cuentaId: 'cuenta-1', garzonId: GARZON_BRUNO },
      { cuentaId: 'cuenta-2', garzonId: GARZON_BRUNO },
    ])
    expect(document.body.textContent).not.toContain('Quedaron mesas sin responsable')

    wrapper.unmount()
  })

  it('si una transferencia falla, corta ahí y deja las que faltan para reintentar', async () => {
    pendientesAlCerrar = [
      pendiente('cuenta-1', 4),
      pendiente('cuenta-2', 7),
      pendiente('cuenta-3', 9),
    ]
    transferenciaFalla = 'cuenta-2'

    const wrapper = await montar()
    await forzarCierreDeLaFila(wrapper)
    await clickEnModal('Transferir')

    // La primera pasó; la tercera NI SE INTENTÓ (el error es del destinatario,
    // no de la cuenta: seguir solo repetiría el mismo 400).
    expect(transferencias).toEqual([{ cuentaId: 'cuenta-1', garzonId: GARZON_BRUNO }])

    // El modal sigue abierto y ya no ofrece la que sí se transfirió.
    const texto = document.body.textContent ?? ''
    expect(texto).toContain('Quedaron mesas sin responsable')
    expect(texto).not.toContain('Mesa 4 — Cuenta 4')
    expect(texto).toContain('Mesa 7 — Cuenta 7')
    expect(texto).toContain('Mesa 9 — Cuenta 9')

    // Reintentar no vuelve a transferir la primera.
    transferenciaFalla = null
    await clickEnModal('Transferir')
    expect(transferencias).toEqual([
      { cuentaId: 'cuenta-1', garzonId: GARZON_BRUNO },
      { cuentaId: 'cuenta-2', garzonId: GARZON_BRUNO },
      { cuentaId: 'cuenta-3', garzonId: GARZON_BRUNO },
    ])

    wrapper.unmount()
  })

  it('si no queda nadie en turno lo dice y no ofrece transferir', async () => {
    abiertasBackend = [sesion()]
    pendientesAlCerrar = [pendiente('cuenta-1', 4)]

    const wrapper = await montar()
    await forzarCierreDeLaFila(wrapper)

    const d = dialogo()
    expect(d?.textContent).toContain('No hay ningún garzón en turno para recibirlas')
    expect(
      [...d!.querySelectorAll('button')].map(b => b.textContent?.trim()),
    ).not.toContain('Transferir')

    wrapper.unmount()
  })
})
