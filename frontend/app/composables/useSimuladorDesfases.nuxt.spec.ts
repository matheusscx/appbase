// @vitest-environment nuxt
//
// El drawer del simulador **no tiene spec de pantalla**, y lo que se arregla acá
// solo se veía corriendo la app: al descartar, la lista se recargaba con
// `GET /items/:insumoId/afectados`, que filtra por componente DIRECTO, mientras
// el drawer puede contener combos que `onAplicarDesfases` le agregó y que un
// ingrediente nunca alcanza. El toast decía "el costo de «C» cambió, decidí otra
// vez" sobre una fila que la propia recarga sacaba de pantalla.
//
// Los dos primeros tests recorren el camino compuesto completo (abrir por un
// ingrediente → aplicar la receta → descartar el combo), que es el único en el
// que los dos alcances divergen; los demás montan el estado a mano porque lo que
// fijan —el reparto de la lista y el de los avisos— no depende de cómo se llegó.
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { DesfaseItemDto } from '~/components/DesfasesPanel.vue'
import { useSimuladorDesfases, avisosDeDesfasesCambiados } from './useSimuladorDesfases'

interface Llamada { url: string, method?: string, body?: Record<string, unknown> }

let llamadas: Llamada[] = []
let respuestas: Record<string, unknown> = {}

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    llamadas.push({ url, method: opts?.method, body: opts?.body })
    const clave = Object.keys(respuestas).find(k => url.endsWith(k))
    return Promise.resolve(clave ? respuestas[clave] : null)
  }
})

interface Toast { title: string, description?: string, color?: string }
let toasts: Toast[] = []

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: Toast) => { toasts.push(t) } })
})

function fila(id: string, over: Partial<DesfaseItemDto> = {}): DesfaseItemDto {
  return {
    itemId: id,
    tipo: 'combo',
    nombre: id.toUpperCase(),
    costoActual: '100.0000',
    costoPropuesto: '150.0000',
    deltaCosto: '50.0000',
    precioBase: '300.0000',
    margenPctActual: '0.6667',
    margenPctPropuesto: '0.5000',
    precioSugerido: '450.0000',
    afectados: [],
    ...over,
  }
}

/**
 * El drawer tal como queda tras el camino compuesto: se abrió por el ingrediente
 * `ing-1`, se aplicó la receta, y adentro quedó el combo `combo-1` — que
 * `afectados(ing-1)` NO devuelve, porque un ingrediente no puede ser componente
 * directo de un combo.
 */
async function drawerConElComboAgregado() {
  const sim = useSimuladorDesfases()
  respuestas = { '/items/ing-1/afectados': [fila('receta-1', { tipo: 'receta' })] }
  await sim.maybeAbrirDesfases('ing-1')
  respuestas = {
    '/desfases/aplicar': { aplicados: 1, omitidos: [], afectados: [fila('combo-1')] },
    // Lo que devolvería la recarga vieja: el combo no está.
    '/items/ing-1/afectados': [],
  }
  await sim.onAplicarDesfases([{ itemId: 'receta-1' }])
  expect(sim.desfasesFilas.value.map(f => f.itemId)).toEqual(['combo-1'])
  llamadas = []
  toasts = []
  return sim
}

beforeEach(() => {
  llamadas = []
  respuestas = {}
  toasts = []
})

describe('useSimuladorDesfases — descartar no recarga con un alcance más angosto', () => {
  it('la fila que cambió se queda, con los números nuevos', async () => {
    const sim = await drawerConElComboAgregado()
    const nueva = fila('combo-1', {
      costoPropuesto: '200.0000',
      deltaCosto: '100.0000',
      precioSugerido: '600.0000',
    })
    respuestas = {
      '/desfases/descartar': {
        descartados: 0,
        cambiados: [{
          itemId: 'combo-1',
          nombre: 'COMBO-1',
          costoPropuestoActual: '200.0000',
          fila: nueva,
        }],
      },
    }

    await sim.onDescartarDesfases([
      { itemId: 'combo-1', costoPropuestoVisto: '150.0000' },
    ])

    // Antes del arreglo esto era `[]`: la recarga preguntaba por el ingrediente
    // y el combo no salía de ahí.
    expect(sim.desfasesFilas.value).toEqual([nueva])
    // Y los derivados son los del propuesto NUEVO, no el `precioSugerido` viejo
    // que el `watch` del panel escribe en el input y `aplicar` persiste.
    expect(sim.desfasesFilas.value[0]!.precioSugerido).toBe('600.0000')
    // Nadie volvió a preguntar: no hay segundo alcance que pueda diverger.
    expect(llamadas.filter(l => l.url.includes('/afectados'))).toEqual([])
  })

  it('si el ítem ya no está desfasado, la fila vuelve en `null` y sale de la lista', async () => {
    const sim = await drawerConElComboAgregado()
    respuestas = {
      '/desfases/descartar': {
        descartados: 0,
        cambiados: [{
          itemId: 'combo-1',
          nombre: 'COMBO-1',
          costoPropuestoActual: '100.0000',
          fila: null,
        }],
      },
    }

    await sim.onDescartarDesfases([
      { itemId: 'combo-1', costoPropuestoVisto: '150.0000' },
    ])

    expect(sim.desfasesFilas.value).toEqual([])
    // Y NO se le avisa "mirá el número nuevo y decidí otra vez": no hay nada que
    // decidir, y decirlo sobre una fila que la propia respuesta sacó de pantalla
    // es el mismo bug que este frente cierra, movido al texto.
    expect(toasts.map(t => t.title)).toEqual(['«COMBO-1» ya no está desfasado'])
    // Un drawer abierto y vacío tampoco: si no quedó ninguna fila, se cierra.
    expect(sim.desfasesOpen.value).toBe(false)
  })

  it('lote con las dos clases: cada grupo recibe SU aviso', async () => {
    const sim = useSimuladorDesfases()
    sim.desfasesFilas.value = [fila('combo-1'), fila('combo-2')]
    sim.desfasesOpen.value = true
    const nueva = fila('combo-1', { costoPropuesto: '200.0000' })
    respuestas = {
      '/desfases/descartar': {
        descartados: 0,
        cambiados: [
          { itemId: 'combo-1', nombre: 'COMBO-1', costoPropuestoActual: '200.0000', fila: nueva },
          { itemId: 'combo-2', nombre: 'COMBO-2', costoPropuestoActual: '100.0000', fila: null },
        ],
      },
    }

    await sim.onDescartarDesfases([
      { itemId: 'combo-1', costoPropuestoVisto: '150.0000' },
      { itemId: 'combo-2', costoPropuestoVisto: '150.0000' },
    ])

    expect(sim.desfasesFilas.value).toEqual([nueva])
    // El aviso de "decidí otra vez" cuenta 1, no 2: el otro no está desfasado.
    expect(toasts[0]!.title).toBe('El costo de «COMBO-1» cambió mientras mirabas')
    expect(toasts[1]!.title).toBe('«COMBO-2» ya no está desfasado')
    // Y el drawer sigue abierto, porque quedó una fila que decidir.
    expect(sim.desfasesOpen.value).toBe(true)
  })

  it('en un lote mixto: la descartada sale, la que cambió se reemplaza, la ajena queda', async () => {
    const sim = useSimuladorDesfases()
    const ajena = fila('combo-9')
    sim.desfasesFilas.value = [fila('combo-1'), fila('combo-2'), ajena]
    const nueva = fila('combo-2', { costoPropuesto: '200.0000' })
    respuestas = {
      '/desfases/descartar': {
        descartados: 1,
        cambiados: [{
          itemId: 'combo-2',
          nombre: 'COMBO-2',
          costoPropuestoActual: '200.0000',
          fila: nueva,
        }],
      },
    }

    await sim.onDescartarDesfases([
      { itemId: 'combo-1', costoPropuestoVisto: '150.0000' },
      { itemId: 'combo-2', costoPropuestoVisto: '150.0000' },
    ])

    expect(sim.desfasesFilas.value).toEqual([nueva, ajena])
  })
})

// La partición vive en una función pura porque las DOS pantallas que descartan
// tienen que decir lo mismo: la bandeja `/desfases` mandaba un único aviso sobre
// todo `cambiados`, así que una fila `null` —que su propio `cargar()` sacaba de
// la lista— recibía igual el "decidí otra vez".
describe('avisosDeDesfasesCambiados', () => {
  const cambiado = (id: string, conFila: boolean) => ({
    itemId: id,
    nombre: id.toUpperCase(),
    costoPropuestoActual: '200.0000',
    fila: conFila ? fila(id) : null,
  })

  it('solo filas para decidir: un aviso, y es el de decidir', () => {
    const avisos = avisosDeDesfasesCambiados([cambiado('a', true), cambiado('b', true)])
    expect(avisos).toHaveLength(1)
    expect(avisos[0]!.title).toBe('2 costos cambiaron mientras mirabas')
    expect(avisos[0]!.color).toBe('warning')
  })

  it('solo filas que ya no están desfasadas: NO se pide decidir nada', () => {
    const avisos = avisosDeDesfasesCambiados([cambiado('a', false)])
    expect(avisos).toHaveLength(1)
    expect(avisos[0]!.title).toBe('«A» ya no está desfasado')
    expect(avisos[0]!.description).not.toContain('decidí otra vez')
  })

  it('las dos clases juntas: un aviso por grupo, cada uno con SU cuenta', () => {
    const avisos = avisosDeDesfasesCambiados([
      cambiado('a', true),
      cambiado('b', false),
      cambiado('c', false),
    ])
    expect(avisos.map(a => a.title)).toEqual([
      'El costo de «A» cambió mientras mirabas',
      '2 avisos ya no están desfasados',
    ])
  })

  it('sin cambiados no hay ningún aviso', () => {
    expect(avisosDeDesfasesCambiados([])).toEqual([])
  })
})
