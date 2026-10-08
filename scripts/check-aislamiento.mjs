#!/usr/bin/env node
// check-aislamiento.mjs
// Falla si el repo vuelve a compartir el entorno de desarrollo entre worktrees.
//
// Por qué existe. Hasta el 2026-09-20 `docker-compose` usaba UN proyecto para todos
// los worktrees: `.env.example` fijaba `COMPOSE_PROJECT_NAME`, cada `.env` copió esa
// línea, y `reset-db.sh` corrido en un worktree hacía `down -v` sobre los contenedores
// de TODAS las sesiones — informando éxito. El arreglo fue parametrizar los puertos y
// el prefijo de contenedor, y derivar el proyecto del worktree.
//
// Nada de eso se sostiene solo: alcanza con que alguien "simplifique" un
// `"5432:5432"` para volver al punto de partida, y el síntoma no aparece hasta que dos
// sesiones se pisan. De los tres niveles de verificación del frente —este chequeo,
// `entorno.sh verificar` y la prueba end-to-end— **éste es el único que no depende de
// que alguien se acuerde de invocarlo**: corre en CI y en el pre-commit.
//
// Lo que NO hace: mirar la máquina. Que dos worktrees tengan hoy el mismo offset es
// estado, no código, y lo dice `./scripts/entorno.sh verificar`.
//
//   node scripts/check-aislamiento.mjs            → siempre
//   node scripts/check-aislamiento.mjs --staged   → solo si el diff toca los archivos (hook)

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const staged = process.argv.includes('--staged')

const VIGILADOS = ['docker-compose.yml', '.env.example', 'scripts/reset-db.sh']

// `D` también: borrar un `.dockerignore` es justamente lo que el chequeo 5 tiene que ver.
function stagedFiles() {
  return execSync('git diff --cached --name-only --diff-filter=ACMD', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

// Vacía los comentarios preservando la numeración de líneas. Es lo que hace que el
// chequeo discrimine en vez de gritar: los comentarios de `reset-db.sh` **citan** el
// nombre viejo a propósito —explican por qué la razón de antes dejó de ser cierta— y
// sin esto el archivo corregido daría rojo por su propia documentación. Mismo criterio
// que `fecha-local.invariant.spec.ts`, que sin stripear daba 3 falsos positivos.
function sinComentarios(texto) {
  return texto
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n')
}

const hallazgos = []
const leer = (rel) => {
  try {
    return readFileSync(resolve(root, rel), 'utf8')
  } catch {
    return null
  }
}

// ── 1 y 2: el compose no puede volver a clavar puertos ni nombres ────────────
const compose = leer('docker-compose.yml')
if (compose !== null) {
  const limpio = sinComentarios(compose)
  limpio.split('\n').forEach((linea, i) => {
    // Un puerto publicado es `- "HOST:CONTENEDOR"`. El del contenedor puede (y debe)
    // ser fijo; el del HOST es el que se comparte entre worktrees.
    const puerto = linea.match(/^\s*-\s*"?(\d+):\d+"?\s*$/)
    if (puerto) {
      hallazgos.push({
        file: 'docker-compose.yml',
        line: i + 1,
        que: `puerto de host literal (${puerto[1]})`,
        comoSeArregla: 'usar "${PUERTO_*:-<default>}:<puerto interno>"',
      })
    }
    const nombre = linea.match(/^\s*container_name:\s*(.+?)\s*$/)
    if (nombre && !nombre[1].includes('${')) {
      hallazgos.push({
        file: 'docker-compose.yml',
        line: i + 1,
        que: `container_name fijo (${nombre[1]})`,
        comoSeArregla: 'usar ${PREFIJO_CONTENEDOR:-tecnica}_<servicio>',
      })
    }
  })
}

// ── 3: la línea que fue la causa raíz ────────────────────────────────────────
const ejemplo = leer('.env.example')
if (ejemplo !== null) {
  ejemplo.split('\n').forEach((linea, i) => {
    if (/^\s*COMPOSE_PROJECT_NAME\s*=/.test(linea)) {
      hallazgos.push({
        file: '.env.example',
        line: i + 1,
        que: 'COMPOSE_PROJECT_NAME sin comentar',
        comoSeArregla:
          'dejarlo comentado: es la línea que cada worktree copió y por la que todos ' +
          'compartían el mismo proyecto de compose',
      })
    }
  })
}

// ── 4: reset-db.sh no puede volver a nombrar el contenedor compartido ────────
const reset = leer('scripts/reset-db.sh')
if (reset !== null) {
  sinComentarios(reset)
    .split('\n')
    .forEach((linea, i) => {
      const m = linea.match(/tecnica_(backend|postgres|frontend)/)
      if (m) {
        hallazgos.push({
          file: 'scripts/reset-db.sh',
          line: i + 1,
          que: `nombre de contenedor compartido (${m[0]}) en código`,
          comoSeArregla:
            'resolverlo con `entorno.sh derivar` (ENTORNO_CONTENEDOR_BACKEND) o con ' +
            '`docker compose -p <proyecto> ps -q <servicio>`',
        })
      }
    })
}

// ── 5: el host no puede volver a colarse en la imagen ────────────────────────
// Cada `context:` del compose necesita su `.dockerignore` con `node_modules`. Sin él,
// el `COPY . .` del Dockerfile copia los `node_modules` del host encima de los que
// instaló la imagen, y el volumen anónimo `/app/node_modules` se puebla desde esa
// imagen: con un `npm ci` del host a medias, los dos contenedores en restart loop
// (medido el 2026-10-08). Los contextos salen del compose y no de una lista, para que
// un servicio nuevo quede vigilado sin acordarse de este archivo.
//
// Se leen las dos sintaxis de `build:` (la larga con `context:` y la corta
// `build: ./backend`). Si quedan `build:` sin contexto legible —`build: { context: … }`,
// comillas, una variable—, eso es un hallazgo: un servicio que el chequeo no supo leer
// tiene que dar rojo, no verde por omisión.
const composeLimpio = compose === null ? '' : sinComentarios(compose)
const builds = (composeLimpio.match(/^\s*build:/gm) ?? []).length
const contextos = [
  ...composeLimpio.matchAll(/^\s*context:\s*(?:\.\/)?([\w./-]+?)\/?\s*$/gm),
  ...composeLimpio.matchAll(/^\s*build:\s*(?:\.\/)?([\w./-]+?)\/?\s*$/gm),
].map((m) => m[1])
if (contextos.length < builds) {
  hallazgos.push({
    file: 'docker-compose.yml',
    line: 1,
    que: `${builds} build: y solo ${contextos.length} contexto(s) legibles`,
    comoSeArregla: 'escribir el contexto como `context: ./<carpeta>` o `build: ./<carpeta>`, sin comillas',
    grupo: 'imagen',
  })
}
const dockerignores = contextos.map((ctx) => `${ctx}/.dockerignore`)
for (const rel of dockerignores) {
  const ignore = leer(rel)
  // En un .dockerignore gana la última regla que matchea: un `!node_modules` posterior
  // vuelve a meter la carpeta. Por eso cuenta la última línea que la nombra. Y no pasa
  // por `sinComentarios`: para Docker solo es comentario la línea que EMPIEZA con `#`, y
  // `node_modules # x` es un patrón literal que no excluye nada.
  const ultima =
    ignore === null
      ? undefined
      : ignore
          .split('\n')
          .filter((l) => /^\s*!?(\*\*\/)?\/?node_modules\/?\s*$/.test(l))
          .at(-1)
  const excluye = ultima !== undefined && !ultima.trim().startsWith('!')
  if (!excluye) {
    hallazgos.push({
      file: rel,
      line: 1,
      que: ignore === null ? 'no existe' : 'no excluye node_modules',
      comoSeArregla: 'el contexto de build necesita un .dockerignore con la línea `node_modules`',
      grupo: 'imagen',
    })
  }
}

if (staged) {
  const tocados = stagedFiles().filter((f) => VIGILADOS.includes(f) || dockerignores.includes(f))
  if (tocados.length === 0) {
    console.log('✓ check-aislamiento: nada que revisar (el diff no toca el entorno)')
    process.exit(0)
  }
}

if (hallazgos.length) {
  console.error(`\n✖ El entorno de desarrollo volvió a ser compartido: ${hallazgos.length} hallazgo(s)\n`)
  for (const h of hallazgos) {
    console.error(`  ${h.file}:${h.line}  ${h.que}`)
    console.error(`      → ${h.comoSeArregla}`)
  }
  if (hallazgos.some((h) => h.grupo !== 'imagen')) {
    console.error(
      '\nCada uno de estos vuelve a poner a dos worktrees sobre el mismo stack. El\n' +
        'síntoma no aparece al commitear: aparece cuando otra sesión corre reset-db.sh y\n' +
        'se lleva tu base. Ver docs/superpowers/specs/2026-09-20-stack-por-worktree-design.md\n',
    )
  }
  if (hallazgos.some((h) => h.grupo === 'imagen')) {
    console.error(
      '\nUn contexto sin .dockerignore mete los node_modules del host en la imagen. El\n' +
        'síntoma no aparece al commitear: aparece cuando un worktree corre `npm ci` mientras\n' +
        'su primer `entorno.sh stack` construye, y backend y frontend quedan en restart loop.\n',
    )
  }
  process.exit(1)
}

console.log(`✓ check-aislamiento OK (${VIGILADOS.length + dockerignores.length} archivos vigilados)`)
