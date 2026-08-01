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
  'promocional',
  'pronto_pago',
]

const CODIGOS_RECARGO_SEED = [
  'general',
  'interes_compuesto',
  'interes_simple',
  'mora',
  'recargo_metodo_pago',
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

  it('`directo` deja elegir porcentaje o monto fijo, y pide valor', () => {
    // Es un descuento de propósito general: no tiene tramos, ni métodos, ni
    // días, ni fechas. Solo modo + valor.
    expect(DESCUENTO_CONFIG.directo).toMatchObject({
      modo: 'libre',
      campoValor: true,
      campoMetodos: false,
      campoTramos: false,
      campoDias: false,
      campoFechaInicio: false,
      campoFechaFin: false,
    })
  })
})
