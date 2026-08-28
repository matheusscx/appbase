#!/usr/bin/env node
// check-e2e-status.mjs
// Falla si un helper de los e2e devuelve un campo del body sin que nadie haya
// mirado el status de esa misma respuesta.
//
// Pasó de verdad: un helper que hace `return (res.body as X).id` y no asevera
// el status reparte `undefined` a TODOS los tests que lo llaman cuando la
// llamada falla. El rojo aparece lejos de su causa — así una falla de
// inventario se leyó como `costoActual: undefined` y se diagnosticó en el
// módulo equivocado. El commit 9784e1b6 barrió este mismo modo de falla para
// los tokens; este chequeo existe para que no vuelva a crecer.
//
// La regla: entre la línea que declara la respuesta y la línea que lee su
// `.body`, alguien tiene que haber mirado el `.status`. Vale cualquiera de las
// formas que el repo ya usa —se busca por CONDUCTA, no por mecanismo—:
//
//   const res = await request(app).post('/x').send({}).expect(201)  ← supertest
//   expect(res.status).toBe(201)                                    ← jest
//   expect([200, 201]).toContain(res.status)                        ← rango
//   if (res.status === 201) { return (res.body as X).id }            ← rama
//
// Solo mira `backend/test/`: fuera de ahí no hay `supertest`. Y solo mira los
// helpers (`return (res.body as ...)`), que es la decisión de alcance del
// owner: un helper roto desorienta a todo un archivo, una lectura suelta
// dentro de un `it()` miente solo sobre su propio test.
//
//   node scripts/check-e2e-status.mjs            → todos los tests de backend
//   node scripts/check-e2e-status.mjs --staged   → solo los .ts staged (hook)

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const staged = process.argv.includes('--staged')

const esObjetivo = (f) => f.startsWith('backend/test/') && f.endsWith('.ts')

function allTests() {
  const out = execSync("git ls-files 'backend/test/*.ts'", {
    cwd: root,
    encoding: 'utf8',
  })
  return out.split('\n').filter(Boolean).filter(esObjetivo)
}

function stagedTests() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
    cwd: root,
    encoding: 'utf8',
  })
  return out.split('\n').filter(Boolean).filter(esObjetivo)
}

// `return (res.body as Tipo).campo` / `return (res.body as Tipo)[0]…`
const LECTURA = /\breturn\s*\(\s*([A-Za-z_$][\w$]*)\s*\.body\s+as\b/

const declaracionDe = (v) =>
  new RegExp(`\\b(?:const|let|var)\\s+${v}\\b|\\b${v}\\s*=\\s*await\\b`)

// Alguien miró el status de `v`: `expect(v.status).toBe(…)`,
// `expect([200, 201]).toContain(v.status)`, `if (v.status === …)`. Todas dejan
// el mismo rastro textual, y ninguna otra cosa menciona `.status` de paso.
const miraStatus = (linea, v) => new RegExp(`\\b${v}\\.status\\b`).test(linea)

// `.expect(201)` encadenado de supertest: lanza si el status no coincide, que
// es exactamente lo que se pide. Solo cuenta DENTRO de la sentencia que declara
// la respuesta — el `.expect()` de otra llamada de más arriba no cubre a esta.
const miraEncadenado = (linea) => /\.expect\(\s*\d{3}\s*\)/.test(linea)

const files = staged ? stagedTests() : allTests()
const ciegos = []

for (const rel of files) {
  let content
  try {
    content = readFileSync(join(root, rel), 'utf8')
  } catch {
    continue // borrado en el mismo commit staged
  }
  const lines = content.split('\n')

  lines.forEach((line, i) => {
    const m = line.match(LECTURA)
    if (!m) return
    const v = m[1]

    // Hacia atrás hasta la declaración de la respuesta: entre ese punto y esta
    // lectura tiene que estar la mirada al status. Acotar en la declaración —y
    // no en el `function` que la envuelve— evita contar como cobertura el
    // `expect` de OTRA respuesta homónima de más arriba.
    let decl = -1
    for (let j = i - 1; j >= 0 && i - j <= 60; j--) {
      if (declaracionDe(v).test(lines[j])) {
        decl = j
        break
      }
    }
    const desde = decl === -1 ? Math.max(0, i - 20) : decl

    // Fin de la sentencia de declaración: el primer renglón que cierra con `;`.
    // Es el tramo donde un `.expect(201)` encadenado sí cubre a ESTA respuesta.
    let finDecl = desde
    if (decl !== -1) {
      while (finDecl < i && !lines[finDecl].trimEnd().endsWith(';')) finDecl++
    }

    for (let j = desde; j < i; j++) {
      if (miraStatus(lines[j], v)) return
      if (j <= finDecl && miraEncadenado(lines[j])) return
    }
    ciegos.push({ file: rel, line: i + 1, v, code: line.trim() })
  })
}

if (ciegos.length) {
  console.error(`\n✖ Helpers de e2e que leen el body sin mirar el status: ${ciegos.length}\n`)
  for (const c of ciegos) {
    console.error(`  ${c.file}:${c.line}`)
    console.error(`    ${c.code}`)
    console.error(
      `    ↳ nadie miró \`${c.v}.status\`. Si la llamada falla, este helper` +
        ` devuelve\n      undefined a TODOS sus llamadores y el rojo aparece` +
        ` lejos de su causa.`,
    )
  }
  console.error(
    '\nAgregá una mirada al status de la respuesta de la que leés el body,\n' +
      'antes del return. Cualquiera de estas sirve:\n' +
      `    expect(res.status).toBe(201);\n` +
      `    expect([200, 201]).toContain(res.status);\n` +
      `    …await request(app).post('/x').send({}).expect(201);\n` +
      'El status correcto sale de leer la llamada, no de asumirlo.\n',
  )
  process.exit(1)
}

console.log(
  `✓ check-e2e-status OK (${files.length} .ts, ${staged ? 'staged' : 'backend/test'})`,
)
