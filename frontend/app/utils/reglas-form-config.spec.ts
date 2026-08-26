import { describe, it, expect } from 'vitest'
import { DESCUENTO_CONFIG, RECARGO_CONFIG } from './reglas-form-config'

// El bug que este spec existe para que no se repita: `DESCUENTO_CONFIG` no
// tenía entrada para `directo` —el tipo de descuento más básico— y el drawer
// no renderizaba ni modo ni valor. Nada lo veía: `Record<string, TipoConfig>`
// acepta cualquier clave, el consumidor hace `?? null`, y `config === null`
// simplemente no dibuja los campos. Se encontró a mano, haciendo un smoke de
// otra feature.
//
// ⚠️ **Alcance real de este guard, para no sobrevenderlo:** las listas de abajo
// son un ESPEJO de los códigos que siembra `backend/src/modules/seeder/
// seeder.service.ts` (`clase: 'descuento'` / `'recargo'`), copiado a mano
// porque backend y frontend son proyectos separados por decisión del owner y
// un test de acá no lee archivos de allá. O sea:
//   - SÍ caza que alguien borre una clave de los mapas, o la escriba mal.
//   - NO caza que el seeder gane un código nuevo sin entrada en el mapa: eso
//     requiere actualizar también la lista de este spec, y hay un comentario
//     en el seeder que lo recuerda.
// Es más débil que un guard derivado del esquema, y se deja explícito en vez
// de pretender lo contrario.
const CODIGOS_DESCUENTO_SEED = [
  'directo',
  'metodo_pago',
  'por_mayor',
  'por_monto_venta',
  'pronto_pago',
]

const CODIGOS_RECARGO_SEED = [
  'general',
  'interes_compuesto',
  'interes_simple',
  'mora',
  'recargo_metodo_pago',
  'recargo_por_monto_venta',
]

describe('reglas-form-config', () => {
  it('DESCUENTO_CONFIG cubre exactamente los códigos de descuento del seed', () => {
    expect(Object.keys(DESCUENTO_CONFIG).sort()).toEqual(CODIGOS_DESCUENTO_SEED)
  })

  it('RECARGO_CONFIG cubre exactamente los códigos de recargo del seed', () => {
    expect(Object.keys(RECARGO_CONFIG).sort()).toEqual(CODIGOS_RECARGO_SEED)
  })

  // La consecuencia concreta del hueco: un tipo sin `campoValor` ni
  // `campoTramos` ni `campoMetodos` deja un formulario donde no se puede
  // expresar CUÁNTO descuenta. Ninguno de los tipos actuales es así.
  it('ningún tipo queda sin forma de expresar su monto', () => {
    const sinMonto = Object.entries({ ...DESCUENTO_CONFIG, ...RECARGO_CONFIG })
      .filter(([, c]) => !c.campoValor && !c.campoTramos && !c.campoMetodos)
      .map(([codigo]) => codigo)

    expect(sinMonto).toEqual([])
  })

  /**
   * Los dos tipos de método de pago son los únicos que admiten las DOS formas
   * de expresar el importe (decisión del owner, 2026-08-25). Con las dos
   * banderas prendidas el drawer NO dibuja los dos campos: hace elegir una
   * (`eligeForma`), y el backend enforcea lo mismo con `validarFormaDeImporte`.
   *
   * Van juntos a propósito: habilitar escalones en uno y no en su gemelo deja
   * la mitad del bug, con el agravante de que la mitad arreglada hace que nadie
   * vuelva a mirar.
   */
  it('los dos tipos de método de pago admiten valor único Y escalones', () => {
    for (const cfg of [DESCUENTO_CONFIG.metodo_pago, RECARGO_CONFIG.recargo_metodo_pago]) {
      expect(cfg).toMatchObject({
        campoValor: true,
        campoTramos: true,
        campoMetodos: true,
        labelTramos: 'Monto mínimo',
      })
    }
  })

  it('ningún otro tipo admite las dos formas a la vez', () => {
    const conLasDos = Object.entries({ ...DESCUENTO_CONFIG, ...RECARGO_CONFIG })
      .filter(([, c]) => c.campoValor && c.campoTramos)
      .map(([codigo]) => codigo)
      .sort()

    expect(conLasDos).toEqual(['metodo_pago', 'recargo_metodo_pago'])
  })

  /**
   * El tipo EMPUJA el default del radio "Se aplica", sin bloquearlo (decisión
   * del owner, 2026-08-25). Los dos tipos por escalones de monto se llaman *por
   * monto de la venta*: nacer en `'linea'` daba una regla que la pantalla
   * nombra por el total y el motor mide contra la línea.
   */
  it('solo los dos tipos por monto de venta sugieren nivel venta', () => {
    const sugierenVenta = Object.entries({ ...DESCUENTO_CONFIG, ...RECARGO_CONFIG })
      .filter(([, c]) => c.nivelSugerido === 'venta')
      .map(([codigo]) => codigo)
      .sort()

    expect(sugierenVenta).toEqual(['por_monto_venta', 'recargo_por_monto_venta'])
  })

  // No alcanza con el test de arriba: un tipo SIN la clave pasaría ese filtro
  // (`undefined !== 'venta'`) y dejaría el radio en el default de la pantalla
  // sin que nada lo note. `Record<string, TipoConfig>` no lo caza — es el mismo
  // hueco que este archivo ya cubre para las claves del mapa.
  it('todos los tipos declaran su nivel sugerido', () => {
    const sinNivel = Object.entries({ ...DESCUENTO_CONFIG, ...RECARGO_CONFIG })
      .filter(([, c]) => c.nivelSugerido !== 'linea' && c.nivelSugerido !== 'venta')
      .map(([codigo]) => codigo)

    expect(sinNivel).toEqual([])
  })

  it('`directo` deja elegir porcentaje o monto fijo, pide valor y admite fechas opcionales', () => {
    // Es un descuento de propósito general: no tiene tramos, ni métodos, ni
    // días. Desde que `promocional` se eliminó (2026-08-23), `directo` es el
    // que cubre "10% del 15 al 20 de septiembre" — con fechas OPCIONALES, no
    // obligatorias como las exigía `promocional`.
    expect(DESCUENTO_CONFIG.directo).toMatchObject({
      modo: 'libre',
      campoValor: true,
      campoMetodos: false,
      campoTramos: false,
      campoDias: false,
      campoFechaInicio: true,
      campoFechaFin: true,
      fechasRequeridas: false,
    })
  })
})
