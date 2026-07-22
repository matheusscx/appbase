#!/usr/bin/env node
// check-docs-links.mjs
// Falla si un enlace relativo entre documentos apunta a un archivo que no existe.
// La doc de este repo está muy cruzada (CLAUDE.md ↔ docs/features ↔ ADRs ↔ patterns):
// cuando se mueve o renombra un .md, los enlaces que lo apuntaban quedan rotos en
// silencio. Este gate convierte esa regla mecánica ("los enlaces de docs deben resolver")
// en algo que se hace cumplir, en vez de confiar en que alguien lo note.
//
// Alcance: markdown propio del proyecto (docs/, specs/, *.md de raíz, frontend/docs,
// backend). Se excluyen skills/agentes vendorizados (.agents/, .claude/) — no son doc
// nuestra y usan convenciones de enlace propias.
//
// Qué valida: enlaces inline `[texto](destino)` cuyo destino es una ruta LOCAL (no
// http(s):, mailto:, tel:, ni ancla pura `#x`). Ignora el bloque de código cercado.
// El `#ancla` se recorta antes de comprobar el archivo (no valida anclas, solo archivos).
//
//   node scripts/check-docs-links.mjs            → escanea toda la doc del proyecto
//   node scripts/check-docs-links.mjs --staged   → solo los .md staged (para el hook)

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const staged = process.argv.includes('--staged')

// Prefijos excluidos (rutas relativas al root, con `/` final).
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

// Quita bloques de código cercados (``` o ~~~) para no reportar rutas de ejemplo.
// Reemplaza cada línea de código por vacío para preservar la numeración de líneas.
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

// Extrae los destinos de enlaces inline `[texto](destino)` de una línea.
// Soporta títulos: `[t](destino "título")` → toma solo `destino`.
function linkTargetsInLine(line) {
  const targets = []
  const re = /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
  let m
  while ((m = re.exec(line)) !== null) targets.push(m[1])
  return targets
}

function isLocalPath(target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false // http:, mailto:, tel:, etc.
  if (target.startsWith('#')) return false // ancla en el mismo documento
  return true
}

const files = staged ? stagedMarkdown() : allMarkdown()
const broken = []

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
    for (const rawTarget of linkTargetsInLine(line)) {
      if (!isLocalPath(rawTarget)) continue
      const noAnchor = rawTarget.split('#')[0]
      if (!noAnchor) continue // era `#ancla` sola
      // Absoluta-desde-repo (`/docs/...`) o relativa al archivo actual.
      const targetAbs = noAnchor.startsWith('/')
        ? join(root, noAnchor)
        : resolve(dirname(abs), noAnchor)
      // Un enlace a un archivo o directorio es válido si el destino existe.
      if (!existsSync(targetAbs)) {
        broken.push({ file: rel, line: i + 1, target: rawTarget })
      }
    }
  })
}

if (broken.length) {
  console.error(`\n✖ Enlaces de docs rotos: ${broken.length}\n`)
  for (const b of broken) {
    console.error(`  ${b.file}:${b.line} → ${b.target}`)
  }
  console.error(
    '\nCorregí la ruta o restaurá el archivo destino. Si el enlace es a un ancla\n' +
      'de otra sección, igual el archivo debe existir.\n',
  )
  process.exit(1)
}

const scope = staged ? 'staged' : 'proyecto'
console.log(`✓ check-docs-links OK (${files.length} .md, ${scope})`)
