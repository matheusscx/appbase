// @vitest-environment nuxt
//
// `recargos.vue` recibió el MISMO `onModoChange` que `descuentos.vue` y quedó sin
// test análogo: el código es simétrico y su spec seguía verde, que es justo el
// problema — la simetría es una intención, no una garantía, y nada avisa si una
// de las dos pantallas la pierde.
//
// Acá va solo esa conducta. El resto de la pantalla (papelera, carrera de
// `cargar()`, colisión de nombre) lo cubre `descuentos.nuxt.spec.ts`; duplicarlo
// entero sería copiar 800 líneas para cubrir 5.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Recargos from './recargos.vue'

interface ReglaFake {
  id: string
  nombre: string
  tipoReglaId: string
  modo: string | null
  valor: string | null
  metodoPagoIds: string[]
  tramos: { minimo: string, valor: string }[]
  diasVencimiento: number | null
  fechaInicio: string | null
  fechaFin: string | null
  activo: boolean
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

let recargosBackend: ReglaFake[] = []

/** `general` es el `modo: 'libre'` con `campoValor` de `RECARGO_CONFIG`: el tipo
 *  que hace rendir el radio Porcentaje/Monto fijo y el campo `valor` compartido
 *  por los dos modos. Es el gemelo de `directo` en descuentos. */
const TIPOS_REGLA = [
  { id: 'tipo-1', nombre: 'General', codigo: 'general', descripcion: null },
]

/** Sin la moneda oficial, `MoneyInput` no resuelve config y se rinde
 *  deshabilitado y vacío: el test pasaría por el motivo equivocado (vacío por
 *  apagado, no vacío por reseteado). */
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
  esDefault: true,
  esOficial: true,
  valorDelDia: null,
}

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url === 'string' && url.includes('/tipos-regla')) {
      return Promise.resolve(TIPOS_REGLA)
    }
    if (typeof url !== 'string' || !url.includes('/recargos')) {
      return Promise.resolve([])
    }
    return Promise.resolve(recargosBackend.map(r => ({ ...r })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Recargos)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

function dialogo(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]')
}

describe('configuracion/recargos — cambiar de modo no deja un valor de la otra escala', () => {
  beforeEach(() => {
    recargosBackend = [{
      id: 'rec-1',
      nombre: 'Recargo nocturno',
      tipoReglaId: 'tipo-1',
      modo: 'porcentaje',
      valor: '0.10',
      metodoPagoIds: [],
      tramos: [],
      diasVencimiento: null,
      fechaInicio: null,
      fechaFin: null,
      activo: true,
      eliminadoEl: null,
      eliminadoPorNombre: null,
    }]
  })

  /** El input del campo "Valor" dentro del drawer, sea la rama MoneyInput o la
   *  de porcentaje: las dos rinden un `<input>` y solo una está montada. */
  function inputValor(): HTMLInputElement {
    const campos = [...(dialogo()?.querySelectorAll<HTMLInputElement>('input') ?? [])]
    const input = campos.find(i => i.getAttribute('inputmode') === 'decimal')
    expect(input, 'campo "Valor" dentro del drawer').toBeTruthy()
    return input!
  }

  async function abrirEdicion(wrapper: Awaited<ReturnType<typeof montar>>) {
    useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
    const boton = wrapper.findAll('button').find(b => b.attributes('title') === 'Editar')
    expect(boton, 'botón "Editar" en la fila').toBeTruthy()
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
  }

  /** Reka UI rinde los radios como `button[role="radio"]`, no `<input type=radio>`. */
  async function clickModo(valor: string) {
    const radio = dialogo()?.querySelector<HTMLElement>(`[role="radio"][value="${valor}"]`)
    expect(radio, `radio de modo "${valor}"`).toBeTruthy()
    radio!.click()
    await new Promise(r => setTimeout(r, 20))
  }

  it('de porcentaje a monto fijo, el campo queda vacío en vez de mostrar 0 con 0.10 adentro', async () => {
    const wrapper = await montar()
    await abrirEdicion(wrapper)

    expect(inputValor().value).toBe('0.10')

    await clickModo('monto_fijo')

    const campo = inputValor()
    // Vacío por RESETEADO, no por apagado.
    expect(campo.disabled).toBe(false)
    expect(campo.value).toBe('')
  })

  it('volver a porcentaje tampoco arrastra el monto fijo que se haya tipeado', async () => {
    const wrapper = await montar()
    await abrirEdicion(wrapper)
    await clickModo('monto_fijo')

    const campo = inputValor()
    campo.value = '5000'
    campo.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 20))
    expect(inputValor().value).toBe('5.000')

    await clickModo('porcentaje')

    expect(inputValor().value).toBe('')
  })
})
