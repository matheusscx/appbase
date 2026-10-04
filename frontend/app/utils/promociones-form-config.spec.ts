import { describe, it, expect } from 'vitest'
import { PROMOCION_CONFIG } from './promociones-form-config'

// Molde: `reglas-form-config.spec.ts`. La diferencia con ese archivo es que
// `tipo` acá NO es un catálogo (`tipos_regla`) sino una columna con CHECK —un
// tipo nuevo exige rama propia en el evaluador (§ Modelo de datos de
// `docs/superpowers/specs/2026-08-27-motor-promociones-design.md`)—, así que
// `Record<TipoPromocion, ...>` ya obliga a TypeScript a cubrir los tres en
// tiempo de compilación. Este spec fija el CONTENIDO de cada entrada, que el
// compilador no puede ver.
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

  // El servidor rechaza un `porcentaje` de 1.00 o más (una promo no regala:
  // eso es una cortesía, owner 2026-10-04); el 2x1 sí es 1.00.
  it('la ayuda del porcentaje no ofrece el 100 % en porcentaje, y sí en nxm', () => {
    expect(PROMOCION_CONFIG.porcentaje.ayudaPorcentaje).toMatch(/menor a 1\.00.*cortesía/)
    expect(PROMOCION_CONFIG.porcentaje.ayudaPorcentaje).not.toMatch(/gratis/)
    expect(PROMOCION_CONFIG.nxm.ayudaPorcentaje).toMatch(/1\.00 = 100% \(gratis\)/)
  })

  it('precio_fijo pide el monto y arma slots (1..N)', () => {
    expect(PROMOCION_CONFIG.precio_fijo).toMatchObject({
      campoPorcentaje: false,
      campoCadaN: false,
      campoMonto: true,
      scopesMultiples: true,
    })
  })

  // Los tres tipos comparten el guardarraíl heredado de eliminar `promocional`:
  // una campaña sin fecha de fin no se acepta (CLAUDE.md y el § Modelo de datos
  // de `docs/superpowers/specs/2026-08-27-motor-promociones-design.md`). No es
  // un eje que varíe por tipo — se deja como campo en vez de una constante
  // aparte para que un tipo nuevo que algún día quisiera la excepción no pueda
  // colarse sin declararla.
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
