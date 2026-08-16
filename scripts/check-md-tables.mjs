#!/usr/bin/env node
// check-md-tables.mjs
// Falla si una fila de tabla GFM quedó pegada a un párrafo, que es lo que de
// verdad rompe una tabla en este repo.
//
// Pasó de verdad (2026-08-15): al insertar un párrafo entre dos filas de una
// tabla de `pendientes.md`, **todo lo que seguía dejó de renderizarse como
// tabla** — visualmente desapareció. Ni el hook ni el CI lo vieron, porque
// ninguno de los dos parsea markdown como markdown: greppean texto y validan
// enlaces.
//
// Se descartó traer un linter de markdown entero (dependencia nueva para una
// sola regla). La regla que se rompió es una sola y se comprueba sin parser:
//
//   toda línea que empieza con `|` tiene que estar precedida por otra fila de
//   tabla, por una línea en blanco, o por el principio del archivo.
//
// Eso alcanza: una fila cuyo renglón anterior es un párrafo es exactamente el
// caso que rompe el render. Dos tablas separadas por un párrafo con sus líneas
// en blanco alrededor pasan, porque no rompen nada.
//
// No valida que la tabla esté bien formada (columnas, separador de header): eso
// sí necesitaría un parser, y no es lo que se rompió.
//
//   node scripts/check-md-tables.mjs            → toda la doc del proyecto
//   node scripts/check-md-tables.mjs --staged   → solo los .md staged (hook)

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const staged = process.argv.includes('--staged')

// Mismos prefijos excluidos que check-docs-links.mjs: skills y agentes
// vendorizados no son doc nuestra.
const EXCLUDE = ['.agents/', '.claude/', 'node_modules/']

function isExcluded(rel) {
  const p = rel.replace(/\\/g, '/')
  return EXCLUDE.some((e) => p.startsWith(e))
}

function allMarkdown() {
  const out = execSync("git ls-files '*.md'", { cwd: root, encoding: 'utf8' })
  return out.split('\n').filter(Boolean).filter((f) => !isExcluded(f))
}

function stagedMarkdown() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
    cwd: root,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !isExcluded(f))
}

// Vacía las líneas dentro de bloques cercados preservando la numeración: una
// tabla de ejemplo dentro de ``` no es una tabla del documento.
function stripFencedCode(lines) {
  let inFence = false
  let fence = ''
  return lines.map((line) => {
    const m = line.match(/^\s*(```+|~~~+)/)
    if (m) {
      if (!inFence) {
        inFence = true
        fence = m[1][0]
        return ''
      }
      if (line.trimStart().startsWith(fence)) {
        inFence = false
        return ''
      }
    }
    return inFence ? '' : line
  })
}

// Una fila de tabla empieza con `|` y tiene al menos otro `|` (la celda se
// cierra o hay una segunda). El segundo `|` no es cosmético: sin él, este
// chequeo marcaba renglones de continuación de un párrafo que arrancan con `|`
// porque un inline code quedó partido al envolver —`docs/features/garzones.md`
// tiene uno: "`garzon` | `cocina`\n| `barra`"—, que renderizan perfecto.
const esFila = (line) => {
  const t = line.trimStart()
  return t.startsWith('|') && t.indexOf('|', 1) !== -1
}

const files = staged ? stagedMarkdown() : allMarkdown()
const rotas = []

for (const rel of files) {
  const abs = join(root, rel)
  let content
  try {
    content = readFileSync(abs, 'utf8')
  } catch {
    continue // borrado en el mismo commit staged
  }
  const lines = stripFencedCode(content.split('\n'))

  lines.forEach((line, i) => {
    if (!esFila(line)) return
    if (i === 0) return // principio del archivo
    const previa = lines[i - 1]
    if (previa.trim() === '') return // línea en blanco: arranca una tabla nueva
    if (esFila(previa)) return // fila anterior de la misma tabla
    rotas.push({ file: rel, line: i + 1, previa: previa.trim() })
  })
}

if (rotas.length) {
  console.error(`\n✖ Filas de tabla pegadas a un párrafo: ${rotas.length}\n`)
  for (const r of rotas) {
    const recorte = r.previa.length > 60 ? `${r.previa.slice(0, 60)}…` : r.previa
    console.error(`  ${r.file}:${r.line}  ← la línea anterior es: "${recorte}"`)
  }
  console.error(
    '\nUna fila `|` pegada a un párrafo corta el render: la tabla y todo lo que\n' +
      'sigue dejan de verse como tabla. Dejá una línea en blanco entre el párrafo\n' +
      'y la tabla, o movelo fuera del medio de la tabla.\n',
  )
  process.exit(1)
}

console.log(`✓ check-md-tables OK (${files.length} .md, ${staged ? 'staged' : 'proyecto'})`)
