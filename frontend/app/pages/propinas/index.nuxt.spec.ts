// @vitest-environment nuxt
//
// Ítem 2 de `2026-09-19-residuos-hora-de-corte/brief.md`: Propinas es la
// única de las 6 pantallas con `<DiaNegocioNota />` que no tenía test de la
// nota (las otras cinco: `mermas.nuxt.spec.ts`, `sesiones-garzon.nuxt.spec.ts`,
// `components/caja/CajaTendencia.nuxt.spec.ts`, `salones/anulaciones.nuxt.spec.ts`
// y el smoke Playwright de `ordenes.vue`). Molde: `mermas.nuxt.spec.ts` →
// describe "nota del día de negocio".
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import { rangoMesActual } from '~/composables/usePropinaResumen'
import Propinas from './index.vue'

/** Task 5: corte del día de negocio que devuelve `GET /tenants/me` — 0 por
 *  defecto (sin corte, la `DiaNegocioNota` no se dibuja). */
let horaCorteBackend = 0

/** El admin de un tenant que contrató Propinas: `mis-permisos` le trae el catálogo entero. */
const ADMIN_PROPINAS = [
  'Propinas:Leer', 'Propinas:Crear', 'Propinas:Actualizar', 'Propinas:Eliminar',
  'Propinas:Configurar', 'Propinas:Liquidar',
]
let permisos: string[] = ADMIN_PROPINAS
let llamadas: string[] = []
/** Bodies de `POST …/preview` y `POST …/liquidar`, en orden. */
let previews: Array<Record<string, unknown>> = []
let liquidaciones: Array<Record<string, unknown>> = []
/** Para simular un recálculo que el servidor rechaza. */
let previewFalla = false
/** Para simular el 409 del backend: el fondo cambió entre ver y confirmar. */
let liquidarConflicto = false
/** Auditoría UX 02.23: un participante del reparto que ya no está en la lista de garzones. */
let garzonDadoDeBaja = false
/** `GET /propinas/liquidaciones`: las cerradas. */
let historialMock: Array<Record<string, unknown>> = []
/** Retiene el preview: la ventana en la que un recálculo está en vuelo. */
let previewRetenido: Promise<void> | null = null

/** El reparto depende del período pedido: así se ve cuál se mostró y cuál se liquidó. */
function repartoPara(body: { fechaDesde: string, ajustes?: { exclusiones?: string[] } }) {
  const excluidos = body.ajustes?.exclusiones ?? []
  const pool = body.fechaDesde === '2026-09-01' ? '450000.0000' : '120000.0000'
  const mitad = body.fechaDesde === '2026-09-01' ? '225000.0000' : '60000.0000'
  return {
    poolTotal: pool,
    monedaId: 'clp',
    decimalesMoneda: 0,
    advertencias: [],
    grupos: [{
      id: 'g1', tipoGarzon: 'garzon', nombre: 'Garzones', porcentaje: '1',
      criterio: 'MANUAL', baseVentas: 'NETAS', manualModo: 'MONTO', montoGrupo: pool, orden: 1,
    }],
    participantes: [
      { garzonId: 'gz-ana', grupoId: 'g1', tipoGarzon: 'garzon', incluido: true, horas: '0', ventasBase: '0', cuentas: '0', pesoManual: null, monto: mitad },
      { garzonId: 'gz-beto', grupoId: 'g1', tipoGarzon: 'garzon', incluido: true, horas: '0', ventasBase: '0', cuentas: '0', pesoManual: null, monto: mitad },
    ].map(p => (excluidos.includes(p.garzonId)
      ? { ...p, incluido: false, monto: '0.0000' }
      : excluidos.length ? { ...p, monto: pool } : p)),
  }
}

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateTo)

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    get permisos() { return permisos },
    loading: false,
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    llamadas.push(url)
    if (url.endsWith('/propinas/liquidaciones/preview')) {
      previews.push(JSON.parse(JSON.stringify(opts!.body!)))
      if (previewFalla) return Promise.reject(new Error('preview caído'))
      const reparto = repartoPara(opts!.body as { fechaDesde: string })
      if (garzonDadoDeBaja) reparto.participantes[1]!.garzonId = 'a1b2c3d4-0000-4000-8000-000000000001'
      return previewRetenido ? previewRetenido.then(() => reparto) : Promise.resolve(reparto)
    }
    if (url.endsWith('/propinas/liquidaciones/liquidar')) {
      liquidaciones.push(JSON.parse(JSON.stringify(opts!.body!)))
      if (liquidarConflicto) {
        return Promise.reject(Object.assign(new Error('409'), {
          status: 409,
          data: { message: 'Entraron propinas nuevas desde que viste el reparto: vuelve a verlo antes de liquidar' },
        }))
      }
      return Promise.resolve({ id: 'liq-1' })
    }
    if (url.includes('/tenants/me')) {
      return Promise.resolve({ horaCorte: horaCorteBackend, diaNegocioHoy: '2026-09-18' })
    }
    if (url.includes('/propinas/reportes/resumen')) {
      return Promise.resolve({
        cobranza: { montoCobrado: '0.0000' },
        estadoActual: { pendienteLibreMonto: '0.0000' },
      })
    }
    if (url.includes('/propinas/liquidaciones')) return Promise.resolve(historialMock)
    if (url.includes('/turnos')) return Promise.resolve([])
    if (url.includes('/garzones')) {
      return Promise.resolve([{ id: 'gz-ana', nombre: 'Ana Torres' }, { id: 'gz-beto', nombre: 'Beto Díaz' }])
    }
    return Promise.resolve([])
  }
})

async function montar() {
  useMonedasStore().hydrate([{
    monedaId: 'clp', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(Propinas)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

beforeEach(() => {
  permisos = ADMIN_PROPINAS
  llamadas = []
  previews = []
  liquidaciones = []
  previewFalla = false
  liquidarConflicto = false
  garzonDadoDeBaja = false
  historialMock = []
  previewRetenido = null
  navigateTo.mockClear()
  document.body.innerHTML = ''
})

describe('propinas — nota del día de negocio', () => {
  beforeEach(() => {
    horaCorteBackend = 0
  })

  it('con corte configurado, muestra "Tu día va de HH:00 a HH:00"', async () => {
    horaCorteBackend = 5
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
    wrapper.unmount()
  })

  it('sin corte (0), no muestra la nota', async () => {
    horaCorteBackend = 0
    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Tu día va de')
    wrapper.unmount()
  })
})

describe('propinas — el admin del tenant entra solo si su tenant contrató Propinas', () => {
  // Sin atajo por `esAdmin` (owner, 2026-10-15): `mis-permisos` le trae al admin el
  // catálogo de los módulos contratados, y el backend le contesta 403 en los demás.
  it('con Propinas contratado, carga la pantalla sin rebotar', async () => {
    const wrapper = await montar()

    expect(navigateTo).not.toHaveBeenCalled()
    expect(llamadas.some(u => u.includes('/propinas/liquidaciones'))).toBe(true)
    wrapper.unmount()
  })
})

describe('propinas — se liquida el reparto que se vio (auditoría UX 02.1)', () => {
  const tick = () => new Promise(r => setTimeout(r, 20))

  async function fijarPeriodo(wrapper: Awaited<ReturnType<typeof montar>>, desde: string, hasta: string) {
    const [inDesde, inHasta] = wrapper.findAllComponents({ name: 'AppDateInput' })
    inDesde!.vm.$emit('update:modelValue', desde)
    inHasta!.vm.$emit('update:modelValue', hasta)
    await tick()
  }

  function botonPorTexto(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
    return [...raiz.querySelectorAll('button')].find(b => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
  }

  async function verReparto(wrapper: Awaited<ReturnType<typeof montar>>) {
    botonPorTexto(wrapper.element, 'Ver reparto')!.click()
    await tick()
  }

  /** Toca "Liquidar período" y, si aparece la confirmación, la acepta. */
  async function liquidarYConfirmar(wrapper: Awaited<ReturnType<typeof montar>>) {
    const boton = botonPorTexto(wrapper.element, 'Liquidar período')
    if (boton && !boton.disabled) boton.click()
    await tick()
    const confirmar = [...document.body.querySelectorAll('[role="dialog"] button')]
      .find(b => b.textContent?.trim().startsWith('Liquidar')) as HTMLButtonElement | undefined
    if (confirmar && !confirmar.disabled) confirmar.click()
    await tick()
  }

  it('cambiar "Desde" después de ver el reparto no liquida un período que nadie vio', async () => {
    const wrapper = await montar()
    await fijarPeriodo(wrapper, '2026-09-01', '2026-09-30')
    await verReparto(wrapper)
    expect(previews).toHaveLength(1)

    // La encargada cambia "Desde" y no vuelve a calcular.
    const [inDesde] = wrapper.findAllComponents({ name: 'AppDateInput' })
    inDesde!.vm.$emit('update:modelValue', '2026-09-15')
    await tick()

    expect(botonPorTexto(wrapper.element, 'Liquidar período')!.disabled).toBe(true)
    await liquidarYConfirmar(wrapper)

    expect(liquidaciones.some(b => b.fechaDesde === '2026-09-15')).toBe(false)
    expect(wrapper.text()).toContain('vuelve a calcular el reparto')
    wrapper.unmount()
  })

  it('"Liquidar período" pide confirmación con el monto antes de liquidar', async () => {
    const wrapper = await montar()
    await fijarPeriodo(wrapper, '2026-09-01', '2026-09-30')
    await verReparto(wrapper)

    botonPorTexto(wrapper.element, 'Liquidar período')!.click()
    await tick()

    expect(liquidaciones).toHaveLength(0)
    const dialogo = document.body.querySelector('[role="dialog"]')!
    expect(dialogo).toBeTruthy()
    const texto = dialogo.textContent!
    expect(texto).toContain('450.000')
    expect(texto).toContain('Ana Torres')
    expect(texto).toContain('225.000')
    wrapper.unmount()
  })

  it('al confirmar, liquida con el período, los turnos y los ajustes del reparto mostrado', async () => {
    const wrapper = await montar()
    await fijarPeriodo(wrapper, '2026-09-01', '2026-09-30')
    await verReparto(wrapper)

    await liquidarYConfirmar(wrapper)

    expect(liquidaciones).toHaveLength(1)
    // La consulta del reparto mostrado, más el fondo que se vio (450.000 es el de septiembre).
    expect(liquidaciones[0]).toEqual({
      ...previews[previews.length - 1],
      poolEsperado: '450000.0000',
      repartoEsperado: [
        { garzonId: 'gz-ana', monto: '225000.0000' },
        { garzonId: 'gz-beto', monto: '225000.0000' },
      ],
    })
    wrapper.unmount()
  })

  it('el reparto que se manda es el de las personas incluidas, no el de las excluidas', async () => {
    const wrapper = await montar()
    await fijarPeriodo(wrapper, '2026-09-01', '2026-09-30')
    await verReparto(wrapper)

    // Excluir a Beto: el reparto recalculado le deja todo a Ana.
    ;[...wrapper.element.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Excluir')[1]!.click()
    await tick()
    await liquidarYConfirmar(wrapper)

    expect(liquidaciones).toHaveLength(1)
    expect(liquidaciones[0]!.repartoEsperado).toEqual([{ garzonId: 'gz-ana', monto: '450000.0000' }])
    wrapper.unmount()
  })

  it('un monto manual escrito y no guardado no viaja en la liquidación', async () => {
    const wrapper = await montar()
    await fijarPeriodo(wrapper, '2026-09-01', '2026-09-30')
    await verReparto(wrapper)

    const monto = wrapper.findAllComponents({ name: 'MoneyInput' })[0]!
    monto.vm.$emit('update:modelValue', '300000')
    await tick()

    expect(botonPorTexto(wrapper.element, 'Liquidar período')!.disabled).toBe(true)
    expect(wrapper.text()).toContain('Guarda el monto manual')
    await liquidarYConfirmar(wrapper)

    expect(liquidaciones.some(b => JSON.stringify(b).includes('300000'))).toBe(false)
    wrapper.unmount()
  })

  it('si el recálculo de una exclusión falla, pide volver a calcular y no habla del monto', async () => {
    const wrapper = await montar()
    await fijarPeriodo(wrapper, '2026-09-01', '2026-09-30')
    await verReparto(wrapper)

    previewFalla = true
    botonPorTexto(wrapper.element, 'Excluir')!.click()
    await tick()

    expect(wrapper.text()).toContain('vuelve a calcular el reparto')
    expect(wrapper.text()).not.toContain('Guarda el monto manual')
    expect(botonPorTexto(wrapper.element, 'Liquidar período')!.disabled).toBe(true)
    wrapper.unmount()
  })

  it('si el backend dice que el reparto cambió, no liquida y pide volver a calcular', async () => {
    const wrapper = await montar()
    await fijarPeriodo(wrapper, '2026-09-01', '2026-09-30')
    await verReparto(wrapper)

    liquidarConflicto = true
    await liquidarYConfirmar(wrapper)

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.text()).toContain('El reparto cambió desde que lo viste')
    expect(botonPorTexto(wrapper.element, 'Liquidar período')!.disabled).toBe(true)

    // Volver a calcular trae el fondo nuevo y deja liquidar de nuevo.
    liquidarConflicto = false
    await verReparto(wrapper)
    expect(wrapper.text()).not.toContain('El reparto cambió desde que lo viste')
    expect(botonPorTexto(wrapper.element, 'Liquidar período')!.disabled).toBe(false)
    wrapper.unmount()
  })
})

describe('propinas — auditoría UX 02.23', () => {
  const tick = () => new Promise(r => setTimeout(r, 20))

  function botonPorTexto(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
    return [...raiz.querySelectorAll('button')].find(b => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
  }

  it('el período arranca en el mes en curso (del día 1 a hoy) y "Ver reparto" calcula sin tocar nada', async () => {
    const wrapper = await montar()
    const [inDesde, inHasta] = wrapper.findAllComponents({ name: 'AppDateInput' })
    const { desde } = rangoMesActual()
    expect(inDesde!.props('modelValue')).toBe(desde)
    expect(inHasta!.props('modelValue')).toBe(hoyLocal())

    botonPorTexto(wrapper.element, 'Ver reparto')!.click()
    await tick()
    expect(previews).toHaveLength(1)
    expect(previews[0]).toMatchObject({ fechaDesde: desde, fechaHasta: hoyLocal() })
    wrapper.unmount()
  })

  it('con una fecha vacía "Ver reparto" queda apagado y dice qué falta', async () => {
    const wrapper = await montar()
    wrapper.findAllComponents({ name: 'AppDateInput' })[0]!.vm.$emit('update:modelValue', '')
    await tick()
    expect(botonPorTexto(wrapper.element, 'Ver reparto')!.disabled).toBe(true)
    expect(wrapper.text()).toContain('Elige desde y hasta para ver el reparto')
    wrapper.unmount()
  })

  it('un garzón que ya no está en la lista sale como "Garzón dado de baja", no como un código', async () => {
    garzonDadoDeBaja = true
    const wrapper = await montar()
    botonPorTexto(wrapper.element, 'Ver reparto')!.click()
    await tick()
    expect(wrapper.text()).toContain('Garzón dado de baja')
    expect(wrapper.text()).not.toContain('a1b2c3d4')
    wrapper.unmount()
  })

  it('al excluir a alguien, solo su botón gira; los demás no', async () => {
    const wrapper = await montar()
    botonPorTexto(wrapper.element, 'Ver reparto')!.click()
    await tick()

    let soltar: () => void = () => {}
    previewRetenido = new Promise<void>((resolve) => { soltar = resolve })
    ;[...wrapper.element.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Excluir')[0]!.click()
    await tick()

    const girando = [...wrapper.element.querySelectorAll('button')]
      .filter(b => ['Excluir', 'Incluir'].includes(b.textContent?.trim() ?? '') && b.querySelector('.animate-spin'))
    expect(girando).toHaveLength(1)
    soltar()
    await tick()
    wrapper.unmount()
  })

  it('las liquidaciones cerradas se abren con un botón "Ver" en cada fila', async () => {
    historialMock = [
      { id: 'liq-1', fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', estado: 'confirmada', poolTotal: '450000.0000' },
    ]
    const wrapper = await montar()
    wrapper.findComponent({ name: 'UTabs' }).vm.$emit('update:modelValue', 'liquidaciones')
    await tick()
    const ver = wrapper.findAll('a').find(a => a.attributes('href') === '/propinas/liquidaciones/liq-1/imprimir?tipo=resumen')
    expect(ver, 'enlace por fila').toBeTruthy()
    expect(ver!.text()).toBe('Ver')
    wrapper.unmount()
  })
})
