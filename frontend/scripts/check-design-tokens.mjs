#!/usr/bin/env node
// check-design-tokens.mjs
// Falla si un .vue usa clases Tailwind de color NEUTRAL hardcodeadas en vez de los
// tokens semánticos de Nuxt UI (text-muted, bg-default, divide-default, border-default…).
// Rompe el modo oscuro y el theming por tenant. Ver frontend/docs/DESIGN-SYSTEM.md y
// docs/agent/anti-patterns.md.
//
// Excepción: colores financieros en app/components/caja/ (verde/rojo/azul).
// Fuera de alcance a propósito: colores de MARCA (bg-primary-*, text-white sobre marca)
// y `dark:` sobre colores de marca — no son neutrales y no rompen el sistema de tokens.
//
//   node scripts/check-design-tokens.mjs            → escanea todos los app/**/*.vue
//   node scripts/check-design-tokens.mjs --staged   → solo los .vue staged (para el hook)

import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const staged = process.argv.includes('--staged')

// Neutrales hardcodeados → deben ser tokens semánticos.
const RULES = [
  { re: /\b(text|bg|border|divide|ring|from|via|to)-(gray|slate|zinc|neutral|stone)-\d+/, hint: 'usá un token semántico: text-muted / bg-muted / border-default / divide-default' },
  { re: /\bbg-(white|black)\b/, hint: 'usá bg-default / bg-elevated / bg-inverted' },
  { re: /\bdark:(bg|text|border|divide|ring)-(gray|slate|zinc|neutral|stone|white|black)\b/, hint: 'no uses dark: sobre neutrales — los tokens semánticos ya adaptan el modo oscuro' },
]
const EXCLUDE = 'app/components/caja/'

// Hijo flex que trunca en el MISMO elemento: los ítems flex tienen min-width:auto por
// default, así que sin min-w-0 el `truncate` no entra en efecto y el texto desborda.
// El patrón correcto cuando min-w-0 va en un wrapper ancestro NO dispara acá.
// Límite conocido: mira el `class` estático de una línea. No ve `:class` dinámico ni
// clases que ponga un componente padre. Es un cedazo barato, no una garantía.
const FLEX_CHILD = /\b(flex-1|flex-auto|basis-[\w./[\]-]+)\b/
const LAYOUT_HINT = 'agregá min-w-0: un ítem flex tiene min-width:auto y sin eso truncate no corta'

function allVueFiles(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...allVueFiles(full))
    else if (e.name.endsWith('.vue')) out.push(full)
  }
  return out
}

function stagedVueFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACM', { cwd: root, encoding: 'utf8' })
  return out.split('\n').filter((f) => f.endsWith('.vue'))
    .map((f) => join(root, f.startsWith('frontend/') ? f.slice('frontend/'.length) : f))
}

const allFiles = staged ? stagedVueFiles() : allVueFiles(join(root, 'app'))
// La excepción de app/components/caja/ es SOLO para los colores financieros. El chequeo
// de layout corre sobre TODOS los .vue: heredar ese filtro dejaría 13 componentes sin
// revisar en silencio.
const tokenFiles = allFiles.filter((f) => !relative(root, f).replace(/\\/g, '/').includes(EXCLUDE))
const tokenSet = new Set(tokenFiles)

const violations = []
const layoutViolations = []
for (const file of allFiles) {
  let content
  try { content = readFileSync(file, 'utf8') } catch { continue }
  const revisarTokens = tokenSet.has(file)
  content.split('\n').forEach((line, i) => {
    if (revisarTokens) {
      for (const rule of RULES) {
        const m = rule.re.exec(line)
        if (m) violations.push({ file: relative(root, file), line: i + 1, cls: m[0], hint: rule.hint })
      }
    }
    const flex = FLEX_CHILD.exec(line)
    if (flex && line.includes('truncate') && !line.includes('min-w-0')) {
      layoutViolations.push({
        file: relative(root, file),
        line: i + 1,
        cls: `${flex[0]} + truncate`,
        hint: LAYOUT_HINT,
      })
    }
  })
}

if (violations.length) {
  console.error('✗ Clases Tailwind neutrales hardcodeadas (usá tokens semánticos de Nuxt UI):')
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  «${v.cls}»  → ${v.hint}`)
  }
  console.error('\nExcepción única: colores financieros en app/components/caja/.')
}

if (layoutViolations.length) {
  console.error('✗ Hijo flex que trunca sin min-w-0 (el texto desborda en vez de cortarse):')
  for (const v of layoutViolations) {
    console.error(`  ${v.file}:${v.line}  «${v.cls}»  → ${v.hint}`)
  }
}

if (violations.length || layoutViolations.length) process.exit(1)

console.log(`✓ Design tokens (${tokenFiles.length} .vue) y layout flex (${allFiles.length} .vue) OK.`)
process.exit(0)
