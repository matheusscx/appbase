#!/usr/bin/env node
// check-dependencias.mjs
// Falla si backend o frontend arrastran una vulnerabilidad conocida `high` o `critical`
// en dependencias de producción que no esté en EXCEPCIONES con su porqué.
//
// Qué bloquea y qué no (medido el 2026-10-11, antes de elegir el umbral):
//   - bloquea: `high`/`critical` de `npm audit --omit=dev`. Es lo que se despliega.
//   - reporta sin fallar: `moderate`/`low` de producción y TODO lo de desarrollo. El
//     día del alta el backend tenía una moderate de desarrollo (sprintf-js, colgada de
//     toda la cadena de jest) que `npm audit fix` solo sabe resolver cambiando el major
//     de jest/ts-jest: bloquearla dejaba `main` en rojo por algo que nunca llega a
//     Railway.
//   - el frontend es un caso aparte: `nuxt` es dependencia de producción y arrastra
//     toda la cadena de build y del servidor de desarrollo (devtools, listhen, globby),
//     así que `--omit=dev` cuenta cosas que no viajan en `.output/`. No se lo pudo
//     afinar con un flag: esas entradas van en EXCEPCIONES, cada una con lo medido.
//
// Registry caído ≠ hallazgo. `npm audit` sale con 1 en los dos casos, pero cuando no
// pudo consultar el registry el JSON trae `error` y no trae `vulnerabilities` (medido
// con `--registry http://127.0.0.1:9`). Se reintenta; si sigue sin respuesta, se
// avisa con una anotación de Actions y NO se falla: el chequeo audita el lockfile
// entero, no el diff, así que el push siguiente lo vuelve a cubrir, y un rojo por la
// red de npm enseña a ignorar este job.
// Eso vale SOLO para la red. Cualquier otro error de `npm audit` falla: un lockfile
// ausente (`ENOLOCK`), un 404 del endpoint o una salida que no es JSON no se arreglan
// con el próximo push, y como aviso dejarían el job verde para siempre.
//
// Una excepción que ya no aparece en el audit se avisa: es un arreglo que llegó y una
// línea que hay que borrar, no algo que justifique un rojo.
//
//   node scripts/check-dependencias.mjs     → backend y frontend

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const DIRS = ['backend', 'frontend']
const BLOQUEAN = new Set(['high', 'critical'])
const INTENTOS = 3
// Cada consulta se corta a los 20 s matando el proceso. No alcanza con los flags de
// npm: con un registry colgado (no caído) `--fetch-timeout=20000 --fetch-retries=0`
// igual tardó 2 min 30 s por llamada (medido con `--registry http://10.255.255.1`), y
// con varias llamadas el job llegaba a su `timeout-minutes`: un rojo que sí se
// confundía con un hallazgo. Una consulta sana tarda < 1 s.
const TOPE_MS = 20_000

// Cada excepción tiene su entrada en docs/agent/pendientes.md § "Endurecimiento para
// producción" ("Vulnerabilidades aceptadas en el escaneo de dependencias"). Se borra
// junto con el arreglo, en el mismo commit.
const EXCEPCIONES = [
  {
    dir: 'frontend',
    paquete: 'simple-git',
    ids: ['GHSA-x6jw-m9v5-85vh', 'GHSA-g4wm-2vf7-vfgr', 'GHSA-858h-whjf-mvg5'],
    motivo:
      'Solo lo usa @nuxt/devtools (servidor de desarrollo); no entra en `.output/`. ' +
      'Ninguna versión estable de devtools sale de simple-git 3.',
  },
  {
    dir: 'frontend',
    paquete: '@simple-git/argv-parser',
    ids: ['GHSA-v5rq-49vh-5v5c'],
    motivo: 'Dependencia de simple-git: mismo motivo que la entrada de arriba.',
  },
  {
    dir: 'frontend',
    paquete: 'node-forge',
    ids: ['GHSA-86w9-cpqp-85rv'],
    motivo:
      'Solo lo usa listhen (@nuxt/cli, servidor de desarrollo); no entra en `.output/`. ' +
      'No hay versión arreglada publicada.',
  },
  {
    dir: 'backend',
    paquete: 'node-forge',
    ids: ['GHSA-86w9-cpqp-85rv'],
    motivo:
      'El motor de la boleta (modules/dte/firma.ts) solo abre el .pfx y exporta llave y ' +
      'certificado; nunca llama a publicKey.verify, que es lo vulnerable: las firmas las ' +
      'verifica crypto de Node vía xml-crypto. No hay versión arreglada publicada.',
  },
  {
    dir: 'frontend',
    paquete: 'braces',
    ids: ['GHSA-vfj7-8cjw-p6xm'],
    motivo:
      'Lo usa el globbing de nitropack en el build; no entra en `.output/`. ' +
      'No hay versión arreglada publicada.',
  },
]

const ghsa = (url) => url.split('/').pop()
// La excepción acepta un advisory EN un paquete: si el mismo GHSA aparece en otro, bloquea.
const clave = (paquete, id) => `${paquete} ${id}`

// npm escribe los errores de red como `request to … failed, reason: ECONNREFUSED` (o
// `socket hang up`, `ENOTFOUND`…) y los HTTP como `<status> <texto> - POST …`. Un 5xx o un
// 429 es el registry con problemas; cualquier otro status es un error nuestro.
function esDeRed(json) {
  const mensaje = String(json?.message ?? '')
  if (/^request to .* failed, reason:/.test(mensaje)) return true
  const status = Number(mensaje.match(/^(\d{3}) /)?.[1])
  return status >= 500 || status === 429
}

// Devuelve `{ json }`, `{ red: motivo }` (reintentable) o `{ falla: motivo }`.
function auditar(dir, soloProduccion) {
  const args = ['audit', '--json', ...(soloProduccion ? ['--omit=dev'] : [])]
  let red
  for (let intento = 1; intento <= INTENTOS; intento++) {
    let salida
    let cortada = false
    try {
      salida = execFileSync('npm', args, {
        cwd: join(root, dir),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: TOPE_MS,
      })
    } catch (e) {
      salida = e.stdout ?? ''
      cortada = e.code === 'ETIMEDOUT'
    }
    if (cortada) {
      red = `sin respuesta en ${TOPE_MS / 1000} s`
    } else {
      let json
      try {
        json = JSON.parse(salida)
      } catch {
        return { falla: `la salida de npm audit no es JSON: ${salida.slice(0, 200)}` }
      }
      if (json.vulnerabilities && !json.error) return { json }
      if (!esDeRed(json)) {
        return { falla: json.error?.code ? `${json.error.code}: ${json.error.summary}` : String(json.message) }
      }
      red = String(json.message)
    }
    if (intento < INTENTOS) execFileSync('sleep', [String(intento * 5)])
  }
  return { red }
}

// `npm audit` agrupa por paquete y repite el aviso en toda la cadena; lo que importa es
// cada advisory una vez, con el paquete que la tiene de verdad.
function advisories(json) {
  const porClave = new Map()
  for (const v of Object.values(json.vulnerabilities)) {
    for (const via of v.via) {
      if (typeof via === 'string') continue
      const id = ghsa(via.url)
      porClave.set(clave(via.name, id), { id, paquete: via.name, severidad: via.severity, titulo: via.title })
    }
  }
  return [...porClave.values()]
}

const contar = (lista) =>
  ['critical', 'high', 'moderate', 'low']
    .map((s) => `${lista.filter((a) => a.severidad === s).length} ${s}`)
    .join(', ')

let falla = false
let hallazgo = false

for (const dir of DIRS) {
  const prod = auditar(dir, true)
  if (prod.falla) {
    falla = true
    console.log(`::error title=npm audit falló (${dir})::No es la red: ${prod.falla}`)
    continue
  }
  if (prod.red) {
    console.log(
      `::warning title=npm audit sin respuesta (${dir})::${prod.red} (${INTENTOS} intentos). ` +
        'No es un hallazgo: este push queda sin escaneo de dependencias y el próximo lo vuelve a cubrir.',
    )
    continue
  }

  // Lo de desarrollo solo se reporta: si esta segunda consulta falla, se pierde ese
  // renglón y nada más. Producción ya está auditada arriba.
  const deProd = advisories(prod.json)
  const enProd = new Set(deProd.map((a) => clave(a.paquete, a.id)))
  const todo = auditar(dir, false)
  const desarrollo = todo.json
    ? contar(advisories(todo.json).filter((a) => !enProd.has(clave(a.paquete, a.id))))
    : `sin datos (${todo.falla ?? todo.red})`
  console.log(`${dir} · producción: ${contar(deProd)} · desarrollo: ${desarrollo}`)

  const excepciones = EXCEPCIONES.filter((e) => e.dir === dir)
  const exceptuados = new Set(excepciones.flatMap((e) => e.ids.map((id) => clave(e.paquete, id))))
  for (const a of deProd) {
    if (!BLOQUEAN.has(a.severidad) || exceptuados.has(clave(a.paquete, a.id))) continue
    falla = hallazgo = true
    console.log(`::error title=${a.severidad} en producción (${dir})::${a.paquete} — ${a.titulo} (${a.id})`)
  }
  for (const e of excepciones) {
    const vencidos = e.ids.filter((id) => !enProd.has(clave(e.paquete, id)))
    if (vencidos.length) {
      console.log(
        `::warning title=Excepción vencida (${dir})::${e.paquete}: ${vencidos.join(', ')} ya no aparece en el audit. ` +
          'Borrarla de EXCEPCIONES y de pendientes.md.',
      )
    }
  }
}

if (hallazgo) {
  console.log(
    '\nArreglo: `npm update <paquete>` si cabe en el rango declarado. Si no, una excepción en ' +
      'scripts/check-dependencias.mjs con lo medido y su entrada en docs/agent/pendientes.md.',
  )
}
if (falla) process.exit(1)
