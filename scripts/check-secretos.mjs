#!/usr/bin/env node
// check-secretos.mjs
// Falla si entra al repo algo con forma de secreto real.
//
// Por qué existe. `matheusscx/appbase` es público (decisión del owner, hasta producción),
// así que todo lo que alguna vez se commitee queda legible para siempre: borrarlo en el
// commit siguiente no lo saca del historial. La auditoría del 2026-10-12 recorrió el
// historial entero y no encontró ningún secreto real (`docs/agent/resueltos.md`); este
// chequeo es para que siga así, porque el único arreglo de un secreto que ya entró es
// rotarlo, y reescribir `main` público no lo des-publica.
//
// Qué mira, con reglas de alta precisión y no de entropía (que en este repo grita sobre
// hashes de commits, UUIDs del seed y tokens del sandbox de Transbank):
//   1. un `.env` (que no sea `.env.example`) agregado al índice — el .gitignore se
//      saltea con `git add -f`;
//   2. formatos de proveedor que no se confunden con nada: tokens de GitHub, Google,
//      AWS, Slack, Stripe y Anthropic, un JWT firmado y la cabecera de una clave privada PEM;
//   3. una variable sensible del proyecto (`JWT_SECRET`, `PASARELA_ENCRYPTION_KEY`,
//      `SMTP_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `RAILWAY_TOKEN`…) asignada a un literal,
//      como default de una interpolación o como fallback en código;
//   4. una URL de Postgres con el password escrito en ella;
//   5. una API key de Transbank (64 hex) asignada a un literal.
//
// Las reglas 3–5 dejan pasar referencias (`${VAR}`, `${{ secrets.X }}`, `process.env`)
// y los valores de PERMITIDOS: los de prueba que el repo trae a propósito. Van como
// sha256 para que la lista no sea un catálogo copiable, y cada uno dice qué es. Para
// sumar uno: `printf %s '<valor>' | shasum -a 256`, y solo si es de prueba por diseño.
//
// Lo que NO ve: un secreto sin nombre ni formato reconocible (un token de Railway es un
// UUID pelado). Por eso la regla de fondo sigue siendo la de siempre: los secretos viven
// en las variables de Railway y de GitHub, nunca en un archivo.
//
// Nunca imprime un valor: solo archivo, línea, regla y los primeros 4 caracteres.
//
//   node scripts/check-secretos.mjs            → todos los archivos versionados (CI)
//   node scripts/check-secretos.mjs --staged   → solo las líneas agregadas al índice (hook)

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const staged = process.argv.includes('--staged')

const PERMITIDOS = new Set([
  // .env.example: placeholders de JWT_SECRET y JWT_REFRESH_SECRET
  'cb443b2aa236a3f7ca0e438e96aa3a760d06a4c6799d488d6c3b4266488afb7a',
  '84edcd6478a38209d834ab725c79120a1df0605e2cb4557c743bcb7320f04938',
  // docker-compose.yml: default de JWT_SECRET para el stack local
  '4acc5a41fffd5b02bdac6d2f0d7248959ee9ffea2d1e791638bf9eed82e62075',
  // .env.example y ci.yml: PASARELA_ENCRYPTION_KEY de prueba (base64 de un patrón fijo)
  '2cf5e6ec387461b4bf954f587ad4d957753fcbc48bf892b5e49996b90cf3b476',
  // ci.yml: JWT_SECRET y JWT_REFRESH_SECRET del CI ("ci-only-not-a-real-secret")
  '684e3c6b566b714c1714349a36df3c00c79837585c0ec200dd11a11ac854e53a',
  'ea00e90e0b273717ec4bc625495c7ed7194306ffdefa0da498de893fdca554d8',
  // docker-compose, .env.example, .mcp.json: password del Postgres local de desarrollo
  '842fc4b5cb14fadfda4c66bc0d3b69a4f51b661f2ef86101a2e7a38b082234c8',
  // ci.yml: password del Postgres efímero del job
  '46400f642c99584e51b14031f875ca9b7b33ccf94ff8d7657197a5bac06f4ffb',
  // seeder y e2e: API key de integración de Transbank, pública en su documentación
  'e54095b5a5795f4a5df96cd14240eee815cbe7ac7b9cf0d17703e18402b1126a',
])

const sha = (v) => createHash('sha256').update(v).digest('hex')
const permitido = (v) => PERMITIDOS.has(sha(v))

// Una referencia no es un secreto: interpolación de shell/compose/Actions (`$VAR`,
// `${…}`, `$(…)`, `{{ … }}`), una variable de entorno leída en código, un placeholder
// `<…>` (cortado en el primer espacio si no va entre comillas), o una llamada, también con
// genérico (`Joi.string()`, `config.get<string>(`). Acotado a propósito: un `(` suelto o
// un `$` seguido de algo que no es un nombre no alcanzan para dar por referencia un password.
const esReferencia = (v) =>
  /^(\$[{(A-Za-z_]|process\.env\b|\{\{)/.test(v) || /^<[^>]+>$|^<[A-Za-z_-]*$/.test(v) || /[\w>\]]\(/.test(v)

const FORMATOS = [
  ['token de GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['client secret de Google', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['API key de Google', /\bAIza[0-9A-Za-z_-]{35}/],
  ['access key de AWS', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['token de Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['clave de Stripe', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/],
  ['API key de Anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['clave privada PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT firmado', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
]

const NOMBRES =
  'JWT_(?:REFRESH_)?SECRET|PASARELA_ENCRYPTION_KEY|QZ_PRIVATE_KEY|SMTP_PASSWORD|' +
  'GOOGLE_CLIENT_SECRET|RAILWAY_(?:API_)?TOKEN|GITHUB_TOKEN|DB_PASSWORD|POSTGRES_PASSWORD'
// El valor entre comillas va hasta la comilla de cierre (puede tener espacios); sin
// comillas, hasta el primer separador. El `:` seguido de `-` es el de un default.
const ASIGNADA = new RegExp(
  `\\b(${NOMBRES})["']?\\s*(?::(?!-)|\\?=|=)\\s*(?:"([^"]+)"|'([^']+)'|([^\\s"'\`,;]+))`,
  'g',
)
// El default de una interpolación de compose o shell sí es un literal. Va aparte porque
// el match de ASIGNADA sobre `NOMBRE: ${NOMBRE:-…}` se come la interpolación entera.
const DEFAULT = new RegExp(`\\$\\{(${NOMBRES}):?-([^}\\s]+)\\}`, 'g')
// Un default en código: `process.env.JWT_SECRET || '…'`, `config.get('JWT_SECRET', '…')`.
// Si el "valor" es otro nombre en mayúsculas, es una lista de variables, no un default.
const FALLBACK = new RegExp(`\\b(${NOMBRES})["']?\\)?\\s*(?:\\|\\||\\?\\?|,)\\s*["']([^"']+)["']`, 'g')
const URL_PG = /postgres(?:ql)?:\/\/[^:/\s@'"]+:([^@\s'"]+)@/g
const TBK = /(?:api[_-]?key(?:[_-]?secret)?|Tbk-Api-Key-Secret)["']?\s*[:=,]\s*["']?([A-Fa-f0-9]{64})\b/gi

function revisarLinea(linea) {
  const out = []
  for (const [regla, rx] of FORMATOS) {
    const m = linea.match(rx)
    if (m) out.push([regla, m[0]])
  }
  const asignadas = [...linea.matchAll(ASIGNADA)].map((m) => [m[1], m[2] ?? m[3] ?? m[4]])
  const fallbacks = [...linea.matchAll(FALLBACK)].filter((m) => !/^[A-Z]+(_[A-Z]+)+$/.test(m[2]))
  const otras = [...linea.matchAll(DEFAULT), ...fallbacks].map((m) => [m[1], m[2]])
  for (const [nombre, v] of [...asignadas, ...otras]) {
    if (v.length >= 8 && !esReferencia(v) && !permitido(v)) out.push([`${nombre} con valor literal`, v])
  }
  for (const m of linea.matchAll(URL_PG)) {
    const v = m[1]
    // Una URL armada con `${…}` no es un literal; su default lo ve la regla de arriba.
    if (!m[0].includes('${') && !permitido(v)) out.push(['URL de Postgres con password literal', v])
  }
  for (const m of linea.matchAll(TBK)) {
    if (!permitido(m[1])) out.push(['API key de Transbank', m[1]])
  }
  return out
}

const esEnv = (rel) => /^\.env(\..+)?$/.test(basename(rel)) && basename(rel) !== '.env.example'

// Sin comillas ni escapes en las rutas no-ASCII: un `café/.env` tiene que llegar a
// `basename` como `.env`, no como `.env"`.
const GIT = 'git -c core.quotePath=false'

// [archivo, número de línea, texto]
function lineasStaged() {
  const diff = execSync(`${GIT} diff --cached -U0 --no-color --no-ext-diff --diff-filter=ACMR`, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  const out = []
  let archivo = null
  let n = 0
  // `+++ ` es cabecera solo antes del primer hunk del archivo: adentro de un hunk es una
  // línea agregada que empieza con `++ `, y leerla como cabecera la dejaba sin revisar.
  let enHunk = false
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) enHunk = false
    else if (!enHunk && l.startsWith('+++ ')) archivo = l.slice(4).replace(/^b\//, '')
    else if (l.startsWith('@@')) {
      enHunk = true
      n = Number(/\+(\d+)/.exec(l)[1])
    } else if (enHunk && l.startsWith('+') && archivo) out.push([archivo, n++, l.slice(1)])
  }
  return out
}

function lineasVersionadas() {
  const archivos = execSync(`${GIT} ls-files -z`, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const out = []
  for (const rel of archivos) {
    let texto
    try {
      texto = readFileSync(resolve(root, rel), 'utf8')
    } catch {
      continue
    }
    if (texto.includes('\0')) continue
    texto.split('\n').forEach((l, i) => out.push([rel, i + 1, l]))
  }
  return out
}

const hallazgos = []

const archivos = staged
  ? execSync(`${GIT} diff --cached --name-only --diff-filter=ACMR`, { cwd: root, encoding: 'utf8' })
  : execSync(`${GIT} ls-files`, { cwd: root, encoding: 'utf8' })
for (const rel of archivos.split('\n').filter(Boolean)) {
  if (esEnv(rel)) hallazgos.push(`${rel}: archivo .env versionado — los secretos van en Railway, no en el repo`)
}

for (const [rel, n, linea] of staged ? lineasStaged() : lineasVersionadas()) {
  for (const [regla, valor] of revisarLinea(linea)) {
    hallazgos.push(`${rel}:${n}: ${regla} (${valor.slice(0, 4)}…, ${valor.length} caracteres)`)
  }
}

if (hallazgos.length > 0) {
  console.error('✗ Posible secreto en el repo (público: lo que entra al historial queda publicado):')
  for (const h of hallazgos) console.error(`  ${h}`)
  console.error('  Si es de prueba por diseño, sumá su sha256 a PERMITIDOS en scripts/check-secretos.mjs.')
  console.error('  Si es real: no lo commitees, y si ya se pusheó, hay que rotarlo (decisión del owner).')
  process.exit(1)
}
if (!staged) console.log('✓ check-secretos: sin secretos en los archivos versionados')
process.exit(0)
