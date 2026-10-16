import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Invariante del Lote 6 de la auditoría UX (hallazgo 00.3): el tono de Venka es
// **tuteo chileno** (`/publicidad/marca/IDENTIDAD.md`) y el voseo ("Elegí",
// "Podés", "tenés", "reimprimila") no entra a `frontend/app`. La auditoría contó
// 81 líneas con una lista acotada de verbos, y el grep tal cual NO veía las
// palabras que terminan en vocal acentuada (`\b` no cuenta la `í` como letra en
// el locale por defecto): por eso acá se tokeniza con `\p{L}`.
//
// Dos redes, para que un verbo nuevo no se cuele:
//   1. La lista de verbos conocidos (imperativo y presente de vos), más sus
//      formas con pronombre pegado y SIN tilde ("cargalo", "pedile"): en tuteo
//      esas llevan tilde ("cárgalo", "pídele"), así que la forma sin tilde delata.
//   2. Toda palabra que termine en `á`/`í`, o en `ás`/`és`/`ís`, que no esté en
//      `PERMITIDAS`. Los futuros ("podrá", "volverá") terminan en `rá` y pasan;
//      el imperativo en `-rá` ("Mirá", "Cerrá") lo caza la lista.
//
// Se lee el código sin comentarios: los docblocks citan los textos viejos
// ("el título decía «Elegí…»") y eso es historia, no pantalla.

const APP = join(__dirname, '..')

/** Imperativo y presente de "vos" que ya se vio en el repo. Se amplía acá. */
const VERBOS_VOS = [
  'Abrí', 'Abreviá', 'Activá', 'Agregá', 'Andá', 'Anulá', 'Apretá', 'Aplicá', 'Arrastrá', 'Asigná',
  'Buscá', 'Cambiá', 'Cancelá', 'Cargá', 'Cerrá', 'Cobrá', 'Completá', 'Confirmá', 'Contá', 'Contactá',
  'Corregí', 'Creá', 'Decidí', 'Dejá', 'Definí', 'Describí', 'Desactivá', 'Desvinculá', 'Devolvé',
  'Editá', 'Elegí', 'Eliminá', 'Entrá', 'Escaneá', 'Escribí', 'Esperá', 'Explicá', 'Firmá', 'Guardá',
  'Hacé', 'Imprimí', 'Indicá', 'Ingresá', 'Intentá', 'Justificá', 'Marcá', 'Medí', 'Mirá', 'Mostrá',
  'Navegá', 'Pasá', 'Pausá', 'Pedí', 'Poné', 'Presioná', 'Probá', 'Reanudá', 'Rechazá', 'Recargá',
  'Registrá', 'Reintentá', 'Repetí', 'Restaurá', 'Revisá', 'Sacá', 'Seleccioná', 'Sumá', 'Tipeá',
  'Tocá', 'Usá', 'Verificá', 'Vinculá', 'Volvé',
  'Aprobá', 'Avisá', 'Entregá', 'Ofrecé', 'Desmarcá', 'Enviá', 'Liquidá', 'Llevá', 'Quitá', 'Reimprimí', 'Tildá',
  'aceptás', 'acabás', 'cambiás', 'cobrás', 'confirmás', 'creás', 'eliminás', 'metés', 'necesitás',
  'pertenecés', 'podés', 'querés', 'quedás', 'rechazás', 'sabés', 'seleccionás', 'sumás', 'tecleás',
  'tenés', 'tocás', 'trabajás', 'usás', 'ponés',
]

/** Pronombres que se pegan al imperativo (sin "te": "crea"+"te" es "create"): "carga" + "lo" = "cargalo" (vos) / "cárgalo" (tú). */
const CLITICOS = ['lo', 'la', 'los', 'las', 'le', 'les', 'me', 'nos']

/** Palabras que terminan en `á`/`í`/`ás`/`és`/`ís` y NO son voseo. */
const PERMITIDAS = new Set([
  'acá', 'ahí', 'allá', 'allí', 'aquí', 'así', 'está', 'estás', 'sí', 'país', 'además', 'demás', 'después',
  'más', 'interés', 'través', 'revés', 'qué', 'cuál', 'cuáles', 'quizás', 'jamás', 'detrás', 'atrás',
  'inglés', 'arnés', 'cortés', 'ají', 'maní', 'bebé', 'café', 'caché', 'cachés', 'colibrí', 'esquí',
  'rubí', 'tabú', 'menú', 'sofá', 'papá', 'mamá', 'bajá', 'pachá', 'jabalí', 'carmesí', 'israelí',
  'marroquí', 'iraní', 'quilpué', 'josé', 'ñandú', 'mercé', 'sé', 'dé', 'té',
])

const sinTilde = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// Sólo las formas con tilde; las pegadas ("cargalo") salen de quitarla.
const CONOCIDAS = new Set(VERBOS_VOS.map(v => v.toLowerCase()))
const PEGADAS = new Set(
  VERBOS_VOS
    .filter(v => /[áéí]$/.test(v))
    .flatMap(v => CLITICOS.map(c => sinTilde(v).toLowerCase() + c)),
)
const PRONOMBRES_VOS = new Set(['vos', 'sos'])

/** Devuelve las palabras de `texto` que son voseo. `texto` ya viene sin comentarios. */
export function voseoEn(texto: string): string[] {
  const halladas: string[] = []
  for (const m of texto.matchAll(/(?<![\p{L}\p{N}_$-])\p{L}+(?![\p{L}\p{N}_-])/gu)) {
    const palabra = m[0]
    const minuscula = palabra.toLowerCase()
    if (CONOCIDAS.has(minuscula) || PEGADAS.has(minuscula) || PRONOMBRES_VOS.has(palabra) || PRONOMBRES_VOS.has(minuscula) && palabra !== palabra.toUpperCase()) {
      halladas.push(palabra)
    }
    else if (/(?:[áí]|[áéí]s)$/.test(minuscula) && !/rás?$/.test(minuscula) && !PERMITIDAS.has(minuscula)) {
      halladas.push(palabra)
    }
  }
  return halladas
}

function archivosFuente(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.nuxt') continue
      out.push(...archivosFuente(full))
    }
    else if (/\.(ts|vue)$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Quita comentarios de bloque, de línea y de template, conservando los saltos de línea. */
function sinComentarios(fuente: string): string {
  const enBlanco = (bloque: string) => bloque.replace(/[^\n]/g, '')
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, enBlanco)
    .replace(/<!--[\s\S]*?-->/g, enBlanco)
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

describe('invariante: la app habla en tuteo, no en voseo', () => {
  it('el detector distingue voseo de tuteo', () => {
    expect(voseoEn('Elegí una tarjeta')).toEqual(['Elegí'])
    expect(voseoEn('si tenés una, abrila antes')).toEqual(['tenés', 'abrila'])
    expect(voseoEn('Podés recuperarlo; vos no lo ves; ya sos parte')).toEqual(['Podés', 'vos', 'sos'])
    expect(voseoEn('reimprimila, pedile, registralo, cobrala')).toHaveLength(4)
    expect(voseoEn('Probá con otra tarjeta')).toEqual(['Probá'])
    expect(voseoEn('Elige una tarjeta; puedes recuperarlo; ábrela; cárgalo; tú no lo ves')).toEqual([])
    expect(voseoEn('Sí, está aquí: volverá después, podrá más y qué país')).toEqual([])
  })

  it('ningún texto de frontend/app está en voseo', () => {
    const hallazgos: string[] = []
    for (const archivo of archivosFuente(APP)) {
      const lineas = sinComentarios(readFileSync(archivo, 'utf8')).split('\n')
      lineas.forEach((linea, i) => {
        const palabras = voseoEn(linea)
        if (palabras.length) hallazgos.push(`${archivo.slice(APP.length + 1)}:${i + 1} → ${palabras.join(', ')}`)
      })
    }
    expect(hallazgos, `voseo en pantalla (la marca habla de tú):\n${hallazgos.join('\n')}`).toEqual([])
  })
})
