import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// ── Los puertos de ESTE worktree ─────────────────────────────────────────────
// Desde el 2026-09-20 cada worktree tiene su propio stack en su propio offset
// (`scripts/entorno.sh`), así que el 5173 fijo dejó de ser "el frontend": es el del
// checkout principal. Las variables `E2E_BASE_URL`/`E2E_API_URL` ya existían, pero
// **una puerta que hay que acordarse de abrir no alcanza**: olvidarlas hacía que la
// suite corriera contra el stack de OTRA sesión y **pasara**. Un verde ajeno es peor
// que un rojo. Así que acá se derivan, y se aborta cuando no se puede confiar.
//
// En CI no hay `.env` ni worktrees: manda `process.env.CI` y todo queda como estaba.
function raizDelRepo(): string | null {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    try {
      // La raíz es la que tiene los dos paquetes al lado: es el marcador más estable
      // del monorepo, y no depende de que `.git` sea archivo o directorio.
      if (statSync(resolve(dir, 'backend')).isDirectory() && statSync(resolve(dir, 'frontend')).isDirectory()) {
        return dir
      }
    } catch {
      /* seguir subiendo */
    }
    const padre = resolve(dir, '..')
    if (padre === dir) break
    dir = padre
  }
  return null
}

function puertosDelWorktree(): { front: number; back: number } | null {
  if (process.env.CI) return null
  // Sin `__dirname`: este paquete es ESM y ahí no existe (se rompía sólo cuando NO
  // había CI, o sea justo en el camino local que esto viene a arreglar). Se busca la
  // raíz del repo hacia arriba desde el cwd, que sirve tanto si se corre desde
  // `frontend/` como desde la raíz con `--config`.
  const raiz = raizDelRepo()
  if (!raiz) return null
  let txt: string
  try {
    txt = readFileSync(resolve(raiz, '.env'), 'utf8')
  } catch {
    txt = ''
  }
  const leer = (k: string) => txt.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim()
  const front = Number(leer('PUERTO_FRONTEND'))
  const back = Number(leer('PUERTO_BACKEND'))

  if (!front || !back) {
    // En un worktree ENLAZADO `.git` es un ARCHIVO, no un directorio. Es la forma más
    // barata de saber que esto no es el checkout principal, sin invocar a git.
    let enlazado = false
    try {
      enlazado = statSync(resolve(raiz, '.git')).isFile()
    } catch {
      enlazado = false
    }
    // `.git` archivo = worktree enlazado. En el checkout principal es un directorio y
    // los defaults de siempre son los correctos.
    if (enlazado) {
      throw new Error(
        'Este worktree no tiene entorno propio: falta PUERTO_FRONTEND/PUERTO_BACKEND en el .env.\n' +
          'Sin eso la suite correría contra el http://localhost:5173 del checkout principal — ' +
          'con el estado de otra sesión, y probablemente pasando.\n' +
          'Levantá el stack de este worktree:  ./scripts/entorno.sh stack',
      )
    }
    return null // checkout principal: los defaults de siempre
  }
  return { front, back }
}

const propios = puertosDelWorktree()
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${propios?.front ?? 5173}`
const apiURL = process.env.E2E_API_URL ?? `http://localhost:${propios?.back ?? 3000}/api`

// Desde el checkout principal (o desde un worktree sin entorno propio) no se puede
// exigir un puerto: apuntar `E2E_BASE_URL` a otra parte es un uso legítimo y
// documentado —el smoke corre contra el demo desplegado—. Lo que NO puede pasar es que
// apunte a un puerto del RANGO DE LOS WORKTREES: eso no es "otro entorno", es el stack
// de otra sesión, y la suite pasaría contra su estado. Lo cazó la revisión
// independiente: el guard de abajo solo cubría la dirección contraria.
if (!propios) {
  for (const [nombre, valor] of [
    ['E2E_BASE_URL', process.env.E2E_BASE_URL],
    ['E2E_API_URL', process.env.E2E_API_URL],
  ] as const) {
    const puerto = Number(valor?.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/)?.[1])
    const esDeUnWorktree = puerto && ((puerto >= 5174 && puerto <= 5222) || (puerto >= 3001 && puerto <= 3049))
    if (esDeUnWorktree) {
      throw new Error(
        `${nombre}=${valor} apunta al puerto ${puerto}, que pertenece al stack de OTRO worktree.\n` +
          'Esa suite correría contra el estado de otra sesión y probablemente pasaría.\n' +
          'Limpiá la variable, o levantá el entorno de este worktree:  ./scripts/entorno.sh stack',
      )
    }
  }
}

// Si las variables vienen puestas a mano, tienen que ser las de este worktree. Una
// var vieja exportada en la terminal es el mismo fallo silencioso por otra puerta.
if (propios) {
  for (const [nombre, valor, esperado] of [
    ['E2E_BASE_URL', baseURL, propios.front],
    ['E2E_API_URL', apiURL, propios.back],
  ] as const) {
    if (!valor.includes(`localhost:${esperado}`)) {
      throw new Error(
        `${nombre}=${valor} no apunta al stack de este worktree (puerto ${esperado}).\n` +
          'Corré la suite sin esa variable, o apuntala a este worktree.',
      )
    }
  }
}

// Se exportan para que los consumidores que las leen por su cuenta —e2e/support/api.ts
// y los specs que pegan a la API directo— vean lo mismo que el `baseURL`. El config se
// evalúa en cada worker, así que la asignación llega a todos.
process.env.E2E_BASE_URL = baseURL
process.env.E2E_API_URL = apiURL

// E2E de navegador contra el STACK REAL. En local requiere el stack de ESTE worktree
// corriendo (`./scripts/entorno.sh stack`), con el seed de dev cargado (estado
// determinista, UUIDs fijos). Los puertos salen del `.env` del worktree — ver
// `puertosDelWorktree()` abajo—; el checkout principal sigue en :5173 y :3000.
// En CI no hay compose: `webServer` levanta los dos servidores.
//
// Aserciones de montos/impuestos/stock se derivan de docs/features/, NUNCA del output
// del código (ver docs/agent/README.md → riesgo de tests que describen el bug).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Un solo worker, también en local (CI ya lo era). No es prudencia: los flujos
  // de venta comparten un recurso físico que el dominio hace exclusivo — el
  // tenant tiene UN cajón, y `abrir` rechaza con "Ya tienes una caja abierta" si
  // el usuario ya tiene una. Dos specs de caja en paralelo se pisan siempre, y
  // todas corren con el mismo `admin@sistema.com`. Con `workers: 1` la corrida
  // local reproduce exactamente la de CI.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/paris.json' },
      dependencies: ['setup'],
    },
  ],
  // En CI no hay compose: Playwright arranca los dos servidores y espera a que respondan.
  // El backend siembra la base en `OnApplicationBootstrap`, y Nest corre ese hook ANTES
  // de abrir el puerto, así que "responde" ya implica "seed terminado" — sin esperas fijas.
  // En local no se define nada: sigue apuntando al `docker-compose up` que ya corre el dev.
  webServer: process.env.CI
    ? [
        {
          command: 'node dist/main',
          cwd: '../backend',
          url: 'http://localhost:3000/api/docs',
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'node .output/server/index.mjs',
          url: 'http://localhost:5173',
          env: { PORT: '5173' },
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
})
