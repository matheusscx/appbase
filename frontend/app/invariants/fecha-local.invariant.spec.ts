import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Invariante del frente de `hora-de-corte`: una fecha que el usuario lee como
// SUYA ('YYYY-MM-DD' de un filtro, un borde de rango, el "hoy" de una pantalla)
// se arma por COMPONENTES locales (`getFullYear`/`getMonth`/`getDate`), nunca
// formateando el `Date` con `toISOString()`. Un `Date` no lleva zona: la elige
// el formateador, y `toISOString()` elige UTC siempre.
//
// Por qué hace falta un chequeo y no alcanza el comentario: el repo ya llevaba
// la advertencia en cuatro docblocks y el patrón reapareció igual en
// `pages/propinas/index.vue` (`rangoMesActual`), donde sobrevivió dos meses de
// gate y CI — compila, no hay error de tipo y ninguna regla de lint lo mira.
//
// Y la razón por la que probarlo a mano no basta: los dos idiomas fallan en
// hemisferios OPUESTOS. `new Date()` (el "ahora") se corre un día ADELANTE al
// oeste de Greenwich y sólo al final del día; `new Date(y, m, 1)` (medianoche
// construida) se corre un día ATRÁS al ESTE y el día entero. Medido el
// 2026-09-19: en Madrid (UTC+2) `new Date(2026, 8, 1).toISOString()` da
// `2026-08-31`; en Santiago (UTC−4) da `2026-09-01`. Probar desde Chile caza
// el primero y NUNCA el segundo.

const APP = join(__dirname, '..')

function archivosFuente(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...archivosFuente(full))
    }
    else if (/\.(ts|vue)$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Quita comentarios de bloque, de línea y de template HTML, preservando la
 * CANTIDAD de saltos de línea para que el `archivo:línea` reportado siga
 * siendo correcto.
 *
 * No es cosmético, es la diferencia entre discriminar y no: los docblocks que
 * advierten contra el patrón CITAN el literal `toISOString().slice(0, 10)`.
 * Medido el 2026-09-19 sobre el árbol ya corregido — sin quitar comentarios el
 * chequeo da 3 falsos positivos (`useVigenciaRegla`, `usePromociones`,
 * `usePropinaResumen`) y 0 quitándolos.
 */
function sinComentarios(fuente: string): string {
  const enBlanco = (bloque: string) => bloque.replace(/[^\n]/g, '')
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, enBlanco)
    .replace(/<!--[\s\S]*?-->/g, enBlanco)
    .replace(/\/\/.*$/gm, '')
}

// El instante serializado en UTC y recortado a 'YYYY-MM-DD'. `toJSON()` entra
// junto a `toISOString()` porque en un `Date` son la misma función (hoy hay cero
// usos en `app/`, así que no agrega falsos positivos; medido el 2026-09-20).
//
// Deliberadamente NO cubre todo uso de `toISOString()`: mandar un instante
// completo al backend es correcto y frecuente — lo que la regla prohíbe es
// quedarse con su parte de FECHA, que es donde UTC deja de ser un detalle de
// transporte y pasa a ser un día distinto del que se leyó.
//
// ⚠️ LÍMITE MEDIDO, y por eso la entrada de `anti-patterns.md` lo declara en vez
// de dar el patrón por cerrado: el chequeo exige que el recorte esté PEGADO a la
// serialización. Partido en dos sentencias —`const iso = d.toISOString()` y más
// abajo `iso.slice(0, 10)`— pasa limpio. Cerrar eso necesita seguir el valor por
// la función, que es un analizador, no un grep: ahí la red es la revisión.
const SERIALIZA = String.raw`(?:toISOString|toJSON)\(\)`

const PATRONES: { nombre: string, regex: RegExp }[] = [
  {
    nombre: 'toISOString()/toJSON() .slice|.substring(0, 10) — el día en UTC, no el local',
    regex: new RegExp(`${SERIALIZA}\\s*\\.\\s*(?:slice|substring|substr)\\s*\\(\\s*0\\s*,\\s*10\\s*\\)`),
  },
  {
    nombre: 'toISOString()/toJSON() .split(\'T\')[0] — el día en UTC, no el local',
    regex: new RegExp(`${SERIALIZA}\\s*\\.\\s*split\\s*\\(\\s*['"\`]T['"\`]\\s*\\)\\s*\\[\\s*0\\s*\\]`),
  },
]

describe('Invariante: nadie arma una fecha local con toISOString()', () => {
  it('toda fecha que el usuario lee como suya se arma por componentes locales', () => {
    const ofensores: string[] = []

    for (const file of archivosFuente(APP)) {
      const relativo = file.slice(APP.length + 1)
      const lineas = sinComentarios(readFileSync(file, 'utf-8')).split('\n')

      for (const patron of PATRONES) {
        lineas.forEach((linea, i) => {
          if (patron.regex.test(linea)) {
            ofensores.push(`${relativo}:${i + 1} — ${patron.nombre}`)
          }
        })
      }
    }

    expect(ofensores).toEqual([])
  })
})
