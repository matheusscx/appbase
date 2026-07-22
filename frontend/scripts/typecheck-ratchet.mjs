#!/usr/bin/env node
// typecheck-ratchet.mjs
// Corre `nuxi typecheck` y falla SOLO si algún archivo tiene más errores de tipo
// que la baseline commiteada. Permite bajar (burndown por tandas), nunca subir.
//
// El frontend arrastra una deuda de errores de tipo (vue-tsc estricto) que
// `nuxt build` NO detecta. Este ratchet impide que la deuda crezca mientras se
// quema, sin bloquear el cierre por los errores preexistentes.
//
//   node scripts/typecheck-ratchet.mjs            → verifica contra baseline (gate)
//   node scripts/typecheck-ratchet.mjs --update   → regenera la baseline (tras quemar)
//
// Ratchet por CONTEO por archivo: es inmune a los corrimientos de línea (un cambio
// arriba no dispara falsos positivos). Limitación conocida: si en un mismo archivo
// se corrige un error y se introduce otro (neto 0), no lo detecta.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(root, 'typecheck-baseline.json')
const update = process.argv.includes('--update')

console.log('▶ nuxi typecheck (puede tardar ~1-2 min)…')
const res = spawnSync('npx', ['nuxi', 'typecheck'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
const output = `${res.stdout || ''}${res.stderr || ''}`

// Cuenta líneas de error por archivo:  app/pages/x.vue(123,4): error TS2322: ...
const re = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/gm
const counts = {}
let m
while ((m = re.exec(output)) !== null) {
  const file = m[1].trim()
  counts[file] = (counts[file] || 0) + 1
}
const total = Object.values(counts).reduce((a, b) => a + b, 0)

if (total === 0 && /error|Error/.test(output) && !/error TS/.test(output)) {
  // typecheck no produjo el formato esperado (fallo de herramienta, no de tipos)
  console.error('✗ nuxi typecheck no devolvió errores en el formato esperado. Salida:')
  console.error(output.split('\n').slice(-25).join('\n'))
  process.exit(2)
}

if (update) {
  const files = Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  )
  writeFileSync(baselinePath, `${JSON.stringify({ total, files }, null, 2)}\n`)
  console.log(`✓ Baseline actualizada: ${total} errores en ${Object.keys(files).length} archivos.`)
  process.exit(0)
}

if (!existsSync(baselinePath)) {
  console.error('✗ Falta typecheck-baseline.json. Generala: npm run typecheck:ratchet -- --update')
  process.exit(1)
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const base = baseline.files || {}

const regressions = []
for (const [file, n] of Object.entries(counts)) {
  const allowed = base[file] || 0
  if (n > allowed) regressions.push({ file, n, allowed })
}

if (regressions.length) {
  console.error(`\n✗ Typecheck EMPEORÓ (${total} vs baseline ${baseline.total}). Archivos con errores nuevos:`)
  for (const r of regressions.sort((a, b) => b.n - b.allowed - (a.n - a.allowed))) {
    console.error(`  ${r.file}: ${r.n}  (baseline ${r.allowed})`)
  }
  console.error('\nCorregí los errores nuevos. Si son legítimos tras quemar otros, actualizá la baseline con --update.')
  process.exit(1)
}

if (total < baseline.total) {
  console.log(`✓ Sin regresiones. Bajaste de ${baseline.total} a ${total} errores.`)
  console.log('  Apretá el ratchet: npm run typecheck:ratchet -- --update (y commiteá la baseline).')
} else {
  console.log(`✓ Sin regresiones de typecheck (${total} errores, todos dentro de baseline).`)
}
process.exit(0)
