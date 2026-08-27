import { describe, it, expect } from 'vitest'
import { PROMOCION_CONFIG } from './promociones-form-config'

// Molde: `reglas-form-config.spec.ts`. La diferencia con ese archivo es que
// `tipo` acá NO es un catálogo (`tipos_regla`) sino una columna con CHECK
// —un tipo nuevo exige rama propia en el evaluador (diseño §Modelo de
// datos)—, así que `Record<TipoPromocion, ...>` ya obliga a TypeScript a
// cubrir los tres en tiempo de compilación. Este spec fija el CONTENIDO de
// cada entrada, que el compilador no puede ver.
describe('promociones-form-config', () => {
  it('porcentaje pide el % y un único scope', () => {
    expect(PROMOCION_CONFIG.porcentaje).toMatchObject({
      campoPorcentaje: true,
      campoCadaN: false,
      campoMonto: false,
      scopesMultiples: false,
    })
  })

  it('nxm pide cadaN + el %, un único scope', () => {
    expect(PROMOCION_CONFIG.nxm).toMatchObject({
      campoPorcentaje: true,
      campoCadaN: true,
      campoMonto: false,
      scopesMultiples: false,
    })
  })

  it('precio_fijo pide el monto y arma slots (1..N)', () => {
    expect(PROMOCION_CONFIG.precio_fijo).toMatchObject({
      campoPorcentaje: false,
      campoCadaN: false,
      campoMonto: true,
      scopesMultiples: true,
    })
  })

  // Los tres tipos comparten el guardarraíl heredado de eliminar
  // `promocional`: una campaña sin fecha de fin no se acepta (CLAUDE.md,
  // diseño §Modelo de datos). No es un eje que varíe por tipo — se deja
  // como campo en vez de una constante aparte para que un tipo nuevo que
  // algún día quisiera la excepción no pueda colarse sin declararla.
  it('los tres tipos exigen fecha de inicio y fin', () => {
    for (const cfg of Object.values(PROMOCION_CONFIG)) {
      expect(cfg.fechasRequeridas).toBe(true)
    }
  })

  it('ningún tipo pide cadaN sin pedir también el porcentaje', () => {
    for (const cfg of Object.values(PROMOCION_CONFIG)) {
      if (cfg.campoCadaN) expect(cfg.campoPorcentaje).toBe(true)
    }
  })

  // Espejo de `chk_promociones_valor_segun_tipo`: cada tipo llena
  // exactamente su columna de valor, nunca dos a la vez.
  it('ningún tipo combina porcentaje y monto', () => {
    for (const cfg of Object.values(PROMOCION_CONFIG)) {
      expect(cfg.campoPorcentaje && cfg.campoMonto).toBe(false)
    }
  })

  it('exactamente un tipo admite armar más de un slot (precio_fijo)', () => {
    const multi = Object.entries(PROMOCION_CONFIG)
      .filter(([, c]) => c.scopesMultiples)
      .map(([tipo]) => tipo)
    expect(multi).toEqual(['precio_fijo'])
  })
})
