// @vitest-environment nuxt
//
// La bandeja es una LECTURA de supervisión: el gate real es `Cajas:Leer` en el
// backend, y `Cajas:Actualizar` para marcar visto. Lo que este spec cubre es lo
// que el backend no puede: que la explicación del cajero se muestre AL LADO del
// número (todo el punto de la feature: revisar con contexto, no con un monto
// pelado), que "no pude cargar" no se lea como "no hay pendientes", y que a
// quien no puede marcar visto no se le ofrezca un botón que va a rebotar 403.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaPendientesRevision from './CajaPendientesRevision.vue'
import type { CierrePendienteRevision, ResumenDescuadresDia } from '~/stores/caja'

const FILAS: CierrePendienteRevision[] = [
  {
    cajaId: 'caja-1',
    usuarioId: 'u-1',
    usuarioNombre: 'Ana Pérez',
    cajonNombre: 'Cajón 1',
    estado: 'cerrada',
    fechaApertura: '2026-08-23T13:00:00.000Z',
    fechaCierre: '2026-08-24T01:00:00.000Z',
    diferencia: '-8000',
    peorDiferencia: '8000',
    explicacionDescuadre: 'Le di vuelto de más a un cliente',
    comentarioCierre: null,
    forzado: false,
  },
]

const RESUMEN: ResumenDescuadresDia = {
  fecha: '2026-08-23',
  cierres: 4,
  conDescuadre: 3,
  nivelAviso: 2,
  nivelAlto: 1,
  altoSinRevisar: 1,
  efectivoSuma: '-9500',
}

const cargarPendientesRevision = vi.fn<() => Promise<CierrePendienteRevision[]>>()
const cargarResumenDescuadresDia = vi.fn<() => Promise<ResumenDescuadresDia>>()
const marcarRevisado = vi.fn<(cajaId: string) => Promise<void>>()
mockNuxtImport('useCajaStore', () => () => ({
  cargarPendientesRevision,
  cargarResumenDescuadresDia,
  marcarRevisado,
}))

// Permisos: `can` decide si el botón de marcar visto se ofrece. Se reasigna en
// cada test que necesita el otro lado del eje.
let puedeActualizar = true
mockNuxtImport('usePermissionsStore', () => () => ({
  esAdmin: false,
  can: (modulo: string, accion: string) =>
    modulo === 'Cajas' && accion === 'Actualizar' ? puedeActualizar : false,
}))

// `formatMonto` cae en `formatOficial`, que devuelve '—' con la store de
// monedas vacía. En la app la hidrata el layout `dashboard`; acá la página se
// monta sola (mismo motivo que en `CajaTendencia.nuxt.spec.ts`).
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
  puedeActualizar = true
  cargarPendientesRevision.mockReset().mockResolvedValue(FILAS)
  cargarResumenDescuadresDia.mockReset().mockResolvedValue(RESUMEN)
  marcarRevisado.mockReset().mockResolvedValue(undefined)
  useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
})

describe('CajaPendientesRevision', () => {
  it('muestra la explicación del cajero al lado del monto', async () => {
    const wrapper = await mountSuspended(CajaPendientesRevision)
    const texto = wrapper.text()

    expect(texto).toContain('8.000')
    // El contexto ES la feature: sin esto la revisión vuelve a ser un número
    // pelado, que es el estado que esta entrada de backlog vino a cambiar.
    expect(texto).toContain('Le di vuelto de más a un cliente')
  })

  it('dice explícitamente cuándo el cajero no dejó explicación', async () => {
    cargarPendientesRevision.mockResolvedValueOnce([
      { ...FILAS[0]!, explicacionDescuadre: null, comentarioCierre: null },
    ])

    const wrapper = await mountSuspended(CajaPendientesRevision)

    expect(wrapper.text()).toContain('No dejó explicación')
  })

  it('cae al comentario de cierre cuando no hay explicación propia', async () => {
    cargarPendientesRevision.mockResolvedValueOnce([
      {
        ...FILAS[0]!,
        explicacionDescuadre: null,
        comentarioCierre: 'Cerré yo el conteo, el cajero se fue',
      },
    ])

    const wrapper = await mountSuspended(CajaPendientesRevision)

    expect(wrapper.text()).toContain('Cerré yo el conteo, el cajero se fue')
  })

  it('marca el cierre forzado como tal', async () => {
    cargarPendientesRevision.mockResolvedValueOnce([{ ...FILAS[0]!, forzado: true }])

    const wrapper = await mountSuspended(CajaPendientesRevision)

    expect(wrapper.text()).toContain('Cierre forzado')
  })

  it('muestra el resumen del día que reemplaza al correo diario', async () => {
    const wrapper = await mountSuspended(CajaPendientesRevision)

    expect(wrapper.find('[data-qa="resumen-descuadres-dia"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('9.500')
  })

  it('si la carga falla NO se lee como "no hay pendientes"', async () => {
    // Mismo bug que la tendencia tenía: en una pantalla de control, la tabla
    // vacía por un 500 se lee como "está todo limpio".
    cargarPendientesRevision.mockRejectedValueOnce(new Error('500'))

    const wrapper = await mountSuspended(CajaPendientesRevision)
    const texto = wrapper.text()

    expect(texto).toContain('No se pudo cargar la bandeja')
    expect(texto).not.toContain('No hay cierres pendientes de revisar')
  })

  it('marcar visto llama al backend y recarga la bandeja', async () => {
    const wrapper = await mountSuspended(CajaPendientesRevision)

    await wrapper.find('[data-qa="marcar-visto-caja-1"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(marcarRevisado).toHaveBeenCalledWith('caja-1')
    // Recarga: el cierre marcado tiene que desaparecer de la lista sin un F5.
    expect(cargarPendientesRevision).toHaveBeenCalledTimes(2)
  })

  it('sin Cajas:Actualizar no se ofrece el botón de marcar visto', async () => {
    // Esconderlo no es el control —el guard del backend lo es—, pero ofrecer
    // una acción que va a rebotar con 403 es peor que no ofrecerla.
    puedeActualizar = false

    const wrapper = await mountSuspended(CajaPendientesRevision)

    expect(wrapper.find('[data-qa="marcar-visto-caja-1"]').exists()).toBe(false)
    // La lectura sí: el supervisor con solo `Cajas:Leer` ve la bandeja entera.
    expect(wrapper.text()).toContain('Ana Pérez')
  })
})
