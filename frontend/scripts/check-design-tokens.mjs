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

const files = (staged ? stagedVueFiles() : allVueFiles(join(root, 'app')))
  .filter((f) => !relative(root, f).replace(/\\/g, '/').includes(EXCLUDE))

const violations = []
for (const file of files) {
  let content
  try { content = readFileSync(file, 'utf8') } catch { continue }
  content.split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      const m = rule.re.exec(line)
      if (m) violations.push({ file: relative(root, file), line: i + 1, cls: m[0], hint: rule.hint })
    }
  })
}

if (violations.length) {
  console.error('✗ Clases Tailwind neutrales hardcodeadas (usá tokens semánticos de Nuxt UI):')
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  «${v.cls}»  → ${v.hint}`)
  }
  console.error('\nExcepción única: colores financieros en app/components/caja/.')
  process.exit(1)
}
console.log(`✓ Design tokens OK (${files.length} .vue revisados, 0 neutrales hardcodeados).`)
process.exit(0)
