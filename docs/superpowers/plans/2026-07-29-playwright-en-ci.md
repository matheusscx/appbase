# Playwright en CI + verificación de layout real (Entrega B) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-07-29-playwright-en-ci-design.md`](../specs/2026-07-29-playwright-en-ci-design.md) (commit `d7b8b48`)

**Goal:** que la suite E2E de navegador corra sola en cada push, en un job de CI con base
limpia, y que los cuatro candidatos de truncado queden resueltos con medición real.

**Architecture:** tres tareas en orden de riesgo. Primero un **sondeo** que mide en un
navegador real qué hacen los cuatro candidatos a 1280 y 768 — sin commitear ningún test,
porque su producto es un número, no código. Después la **infraestructura**: un job de CI
separado con su propio Postgres, con Playwright arrancando backend y frontend vía
`webServer` (solo bajo `CI`; en local no cambia nada). Recién al final, con el pipeline ya
verde, entra el **spec de layout** y la corrección de los candidatos confirmados.

**Tech Stack:** Playwright 1.61 (ya instalado), Nuxt 4 / Nitro, NestJS 11, GitHub Actions,
Postgres 15 como `service` del runner.

## Global Constraints

Vinculan a **todas** las tareas.

- **Sin dependencias nuevas.** Todo lo necesario ya está instalado. Si una tarea parece
  necesitar una, **detenerse y preguntar** (CLAUDE.md).
- **Anchos soportados: 1280 (escritorio) y 768 (tablet).** Móvil (375) está **fuera de
  alcance declarado** — no se agrega a ningún test.
- **Cero esperas fijas.** Ningún `page.waitForTimeout()`, ningún `sleep` en el camino
  feliz, ni en los specs ni en CI. La espera es siempre por condición observada.
- **Se trabaja y commitea directamente sobre `main`.** Sin ramas, sin PRs.
- **Nunca `git add .` ni `git add -A`** — siempre rutas explícitas.
- **Nunca `git commit --no-verify`.**
- **Nunca commitear `.claude/settings.local.json`.**
- Toda aserción de negocio se deriva de `docs/features/`, **nunca del output del código**.
- Tokens semánticos de Nuxt UI, nunca Tailwind neutral hardcodeado
  (`npm run design:check` lo verifica).
- Documentación viva **en el mismo commit** que el código que la motiva (CLAUDE.md).
- El gate completo del proyecto corre antes de dar cualquier tarea por terminada:
  ```bash
  cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
  cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
  ```
  `./scripts/reset-db.sh` va **inmediatamente antes** de `test:e2e`, sin nada en el medio.

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `frontend/e2e/layout/_sondeo.spec.ts` | medición descartable, **se borra al cerrar la tarea** | 1 |
| `frontend/playwright.config.ts` | `webServer` bajo `CI`; local sigue apuntando al compose | 2 |
| `.github/workflows/ci.yml` | job `e2e-navegador` en paralelo, con su propio Postgres | 2 |
| `frontend/e2e/layout/truncado.spec.ts` | spec de layout: mide ancho real de los casos confirmados | 3 |
| `frontend/app/components/caja/CajaAperturaGrid.vue` | `min-w-0` si el sondeo lo confirma | 3 |
| `frontend/app/components/caja/CajaCajonesGrid.vue` | `min-w-0` si el sondeo lo confirma | 3 |
| `frontend/app/layouts/dashboard.vue` | `min-w-0` si el sondeo lo confirma | 3 |
| `docs/PRODUCTO.md` | contrato de anchos soportados | 3 |
| `docs/agent/pendientes.md` / `resueltos.md` | cierre de los 4 candidatos + decisión de móvil | 3 |
| `docs/patterns/frontend.md` | §16: patrón de aserción de layout | 3 |

---

## Task 1: Sondeo — medir los cuatro candidatos en navegador real

**Por qué existe:** las aserciones del spec de layout solo detectan algo si el texto
realmente no entra. Con los nombres del seed puede que a 768 entren de sobra. **Nadie lo
midió.** Esta tarea produce ese número; la Tarea 3 escribe los tests contra él.

**Files:**
- Create (descartable, NO se commitea): `frontend/e2e/layout/_sondeo.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: un **informe de medición** en el archivo de reporte de la tarea, con una fila
  por elemento `.truncate` encontrado en `/mi-caja` y `/cajas`, a 1280 y a 768, que
  responde tres preguntas por elemento:
  1. **¿es estructuralmente vulnerable?** — su padre es `display:flex` y su `min-width`
     computado es `auto`;
  2. **¿se manifiesta hoy?** — `scrollWidth > clientWidth` (recortó) o el padre desborda;
  3. **¿la página gana scroll horizontal?**

  Más un veredicto por cada uno de los cuatro candidatos del spec: **confirmado**,
  **vulnerable pero no manifiesto con los datos del seed**, o **descartado**.

**Contexto que el implementador necesita:**

- Los cuatro candidatos y dónde se renderizan:

  | Candidato | Ruta que lo renderiza |
  |---|---|
  | `app/components/caja/CajaAperturaGrid.vue:95` | `/mi-caja` |
  | `app/components/caja/CajaCajonesGrid.vue:56` y `:71` | `/cajas` |
  | `app/layouts/dashboard.vue:184` | cualquier ruta autenticada (es el sidebar) |

- **El diagnóstico estructural es más fuerte que la medición.** Un ítem flex sin
  `min-w-0` tiene `min-width` computado `auto` (Chrome lo reporta literalmente así); con
  `min-w-0` reporta `0px`. Eso distingue "el bug está" de "el bug se ve con estos datos",
  que es justo la distinción que la Tarea 3 necesita.

- [ ] **Step 1: Dejar la base en estado limpio y el stack arriba**

```bash
cd /Users/m2pro/cmatheus/startup-app
./scripts/reset-db.sh     # down -v + up + espera del 'Seed complete' (~30s)
```

Verificar que responden los dos puertos antes de seguir:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/docs   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/login      # 200
```

- [ ] **Step 2: Asegurar el navegador y la sesión guardada**

```bash
cd frontend
npx playwright install chromium
npx playwright test --project=setup   # genera e2e/.auth/paris.json
```

El `setup` se corre explícito y no como dependencia: al filtrar por archivo (Step 4), el
filtro también alcanza al proyecto `setup` y la sesión no se generaría. Si
`e2e/.auth/paris.json` no existe, todo lo demás falla redirigiendo a `/login`.

- [ ] **Step 3: Escribir el spec de sondeo**

Archivo `frontend/e2e/layout/_sondeo.spec.ts`. No mide solo los cuatro: barre **todos**
los `.truncate` de esas rutas, para que el informe también muestre los que están sanos
(que es la línea de base contra la cual se lee el resto).

```ts
import { test } from '@playwright/test'

// DESCARTABLE — sondeo de la Entrega B, no se commitea. Se borra al cerrar la Tarea 1.
const RUTAS = ['/mi-caja', '/cajas']
const ANCHOS = [
  { nombre: 'escritorio', width: 1280, height: 720 },
  { nombre: 'tablet', width: 768, height: 1024 },
]

for (const ancho of ANCHOS) {
  test.describe(`${ancho.nombre} ${ancho.width}px`, () => {
    test.use({ viewport: { width: ancho.width, height: ancho.height } })

    for (const ruta of RUTAS) {
      test(`sondeo ${ruta}`, async ({ page }) => {
        await page.goto(ruta, { waitUntil: 'networkidle' })

        const datos = await page.evaluate(() => {
          const doc = document.documentElement
          const elementos = [...document.querySelectorAll('.truncate')].map((el) => {
            const padre = el.parentElement
            const estiloPadre = padre ? getComputedStyle(padre) : null
            return {
              tag: el.tagName.toLowerCase(),
              texto: (el.textContent ?? '').trim().slice(0, 40),
              // ¿el bug ESTÁ? (estructural, no depende del largo del contenido)
              padreEsFlex: !!estiloPadre && estiloPadre.display.includes('flex'),
              minWidthComputado: getComputedStyle(el).minWidth, // 'auto' = vulnerable
              // ¿el bug SE VE con estos datos?
              recorto: el.scrollWidth > el.clientWidth,
              elScrollW: el.scrollWidth,
              elClientW: el.clientWidth,
              padreDesborda: !!padre && padre.scrollWidth > padre.clientWidth,
            }
          })
          return {
            paginaScrollHorizontal: doc.scrollWidth > doc.clientWidth,
            paginaScrollW: doc.scrollWidth,
            paginaClientW: doc.clientWidth,
            elementos,
          }
        })

        console.log(`\n=== ${ruta} @ ${ancho.width}px ===`)
        console.log(JSON.stringify(datos, null, 2))
      })
    }
  })
}
```

- [ ] **Step 4: Correr el sondeo y capturar la salida**

```bash
cd frontend && npx playwright test e2e/layout/_sondeo.spec.ts --reporter=list 2>&1 | tee /tmp/sondeo.txt
```

Los cuatro tests deben pasar (el sondeo no asevera nada, solo mide). Si alguno falla por
navegación o sesión, **eso es el hallazgo** y hay que reportarlo, no forzarlo.

- [ ] **Step 5: Confirmar el diagnóstico contra el código**

Para cada uno de los cuatro candidatos, cruzar la medición con el template
(`CajaAperturaGrid.vue:95`, `CajaCajonesGrid.vue:56` y `:71`, `dashboard.vue:184`) y
verificar que el elemento medido es el del candidato — no otro `.truncate` con texto
parecido. Identificarlos por el texto que muestran.

`dashboard.vue:184` se mide en cualquiera de las dos rutas: es el sidebar.

- [ ] **Step 6: Escribir el informe**

En el archivo de reporte de la tarea, con esta forma exacta:

```
| candidato | ancho | padreEsFlex | minWidth | recortó | padre desborda | veredicto |
```

Y en prosa, la respuesta a la pregunta que decide la Tarea 3:

> **¿Alguno de los cuatro se manifiesta con los datos del seed, a 1280 o a 768?**
> Si la respuesta es no, decir explícitamente **qué contenido haría falta** para que se
> manifieste (largo aproximado del texto, y en qué campo).

- [ ] **Step 7: Borrar el sondeo**

```bash
rm frontend/e2e/layout/_sondeo.spec.ts
git status --short frontend/e2e   # debe salir vacío
```

**Esta tarea no commitea nada.** Su producto es el informe. Si `git status` muestra
cambios en `frontend/e2e`, algo quedó sin borrar.

---

## Task 2: La suite de navegador corre en CI

**Files:**
- Modify: `frontend/playwright.config.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nada de la Tarea 1 (es independiente; el sondeo va primero solo por riesgo).
- Produces: un job `e2e-navegador` verde en `main`, sobre el cual la Tarea 3 apoya su spec.

**Contexto que el implementador necesita:**

- **El puerto abierto del backend es la señal de que el seed terminó.** `SeederService`
  implementa `OnApplicationBootstrap`; en `@nestjs/core` 11.1.26, `listen()` llama a
  `init()` (`node_modules/@nestjs/core/nest-application.js:174-178`) e `init()` corre
  `callBootstrapHook()` en la línea `:107`, **antes** de `httpAdapter.listen()` en la
  `:190`. Por eso alcanza con esperar una respuesta HTTP: no hay que parsear logs ni
  esperar por tiempo.
- **No hay endpoint de health.** Se usa `/api/docs` (Swagger, 200) como URL de readiness.
- **El server de Nitro escucha 3000 por default** y chocaría con el backend: hay que
  pasarle `PORT=5173`.
- El CORS de `backend/src/main.ts` ya trae `http://localhost:5173` por default, que es
  exactamente lo que usa el runner.
- `frontend/.gitignore` ya ignora `/test-results`, `/playwright-report` y `/e2e/.auth`.

- [ ] **Step 1: Agregar `webServer` a `playwright.config.ts`, solo bajo `CI`**

Se agrega al objeto de `defineConfig`, y se actualiza el comentario de cabecera, que hoy
afirma que la config no levanta servidores — pasa a ser cierto solo en local.

```ts
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
```

- [ ] **Step 2: Verificar que el comportamiento local NO cambió**

```bash
cd frontend && npx playwright test --list
```

Debe listar los tests sin intentar arrancar ningún servidor (sin `CI` en el entorno,
`webServer` es `undefined`). Con el compose arriba, el smoke sigue verde:

```bash
npm run e2e:smoke
```

- [ ] **Step 3: Agregar el job `e2e-navegador` a `.github/workflows/ci.yml`**

Al mismo nivel que `gate` (hermano dentro de `jobs:`), **sin `needs:`** — corre en
paralelo. Copia el bloque `services.postgres` y el bloque `env` del job `gate` tal cual:
son los mismos valores, y el servicio propio es justamente lo que da la base virgen.

```yaml
  # Suite E2E de navegador (Playwright). Job separado a propósito: GitHub crea los
  # `services` por job, así que este Postgres nace virgen y el bootstrap del backend lo
  # siembra — la misma garantía que `scripts/reset-db.sh` da en local. Correrlo dentro de
  # `gate` lo dejaría sobre la base que `backend · e2e` acaba de mutar (cajas abiertas,
  # stock consumido) y las aserciones de UI dejarían de ser deterministas.
  e2e-navegador:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: appuser
          POSTGRES_PASSWORD: apppass
          POSTGRES_DB: appdb
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U appuser -d appdb"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20

    env:
      DATABASE_URL: postgres://appuser:apppass@localhost:5432/appdb
      NODE_ENV: test
      API_PREFIX: api
      PORT: '3000'
      JWT_SECRET: ci-only-not-a-real-secret
      JWT_REFRESH_SECRET: ci-only-not-a-real-refresh-secret
      JWT_EXPIRATION: 15m
      JWT_REFRESH_EXPIRATION: 7d
      VITE_API_URL: http://localhost:3000/api
      PASARELA_ENCRYPTION_KEY: MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: |
            backend/package-lock.json
            frontend/package-lock.json

      - name: backend · install
        working-directory: backend
        run: npm ci

      - name: backend · build
        working-directory: backend
        run: npm run build

      - name: frontend · install
        working-directory: frontend
        run: npm ci

      - name: frontend · build
        working-directory: frontend
        run: npm run build

      - name: playwright · chromium
        working-directory: frontend
        run: npx playwright install --with-deps chromium

      # `webServer` de la config arranca backend y frontend y espera a que respondan.
      - name: frontend · e2e navegador
        working-directory: frontend
        run: npm run e2e

      # Sin esto, `trace: 'on-first-retry'` y `screenshot: 'only-on-failure'` no sirven
      # de nada: un CI rojo quedaría sin forma de diagnosticarse.
      - name: reporte de Playwright
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 7
```

- [ ] **Step 4: Correr el gate completo del proyecto**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd backend && npm run test:e2e
cd ../frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

- [ ] **Step 5: Commitear**

```bash
git add frontend/playwright.config.ts .github/workflows/ci.yml
git commit -m "ci(e2e): la suite de navegador corre en cada push, con base limpia

El scaffold de Playwright existía hace meses y no corría en ningún paso de CI:
dependía de que alguien se acordara de levantar el compose. Job separado y en
paralelo porque GitHub crea los `services` por job: el Postgres nace virgen y
el bootstrap del backend lo siembra, que es la garantía de reset-db.sh gratis.
Meterlo en `gate` lo dejaría sobre la base que el e2e de backend acaba de mutar.

La espera de arranque no es por tiempo: Nest corre el hook del seeder antes de
abrir el puerto, así que una respuesta HTTP ya implica seed terminado."
```

- [ ] **Step 6: Pushear y verificar el run REAL**

El workflow solo dispara con `push` a `main` o `workflow_dispatch`: **no hay forma de
verificarlo sin pushear.** Ese es el test de esta tarea.

```bash
git push
gh run watch "$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

(Si el `run list` todavía devuelve el run anterior, GitHub no registró el push aún:
volver a listar hasta ver el commit nuevo antes de mirar el resultado.)

Expected: los dos jobs verdes. Si `e2e-navegador` falla, leer el log del paso que rompió
y el artefacto `playwright-report`, corregir y volver a pushear. **La tarea no está
terminada hasta ver el run verde en GitHub** — que compile local no prueba nada acá.

---

## Task 3: Spec de layout + corrección de los candidatos confirmados

**Files:**
- Create: `frontend/e2e/layout/truncado.spec.ts`
- Modify (solo los que la Tarea 1 haya confirmado): `frontend/app/components/caja/CajaAperturaGrid.vue`, `frontend/app/components/caja/CajaCajonesGrid.vue`, `frontend/app/layouts/dashboard.vue`
- Modify: `docs/PRODUCTO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md`, `docs/patterns/frontend.md`

**Interfaces:**
- Consumes: el **informe de la Tarea 1** — qué candidatos se manifiestan, a qué ancho, y
  con qué contenido. Y el pipeline de la Tarea 2, ya verde.
- Produces: `frontend/e2e/layout/truncado.spec.ts`, que corre dentro del job
  `e2e-navegador` sin ningún cambio adicional al workflow.

### Lo que esta tarea NO trae escrito, a propósito

**El cuerpo de los tests se escribe contra el informe de la Tarea 1, no contra este
plan.** Qué elementos se aseveran, a qué ancho, y si hace falta contenido largo, lo
decide esa medición. Fijar el código acá repetiría el error que ya se pagó en la Entrega
A: tests escritos antes del sondeo que hubo que reescribir al despacharlos.

Lo que sí es contrato, y no se negocia:

1. **Dos aserciones por caso confirmado:**
   - el elemento con `truncate` **recortó**: `scrollWidth > clientWidth`;
   - su contenedor **no creció**: el padre flex cumple `scrollWidth <= clientWidth`, y la
     página no tiene scroll horizontal
     (`documentElement.scrollWidth <= documentElement.clientWidth`).
2. **Los anchos son 1280 y 768**, declarados con `test.use({ viewport })` dentro del
   spec. **No se agrega un proyecto nuevo** a `playwright.config.ts`: los proyectos
   siguen siendo `setup` → `chromium`.
3. **Cero esperas fijas.**
4. **El test debe fallar si se le saca el `min-w-0` al código corregido.** Se verifica
   mutando de verdad (Step 4), no razonando.

### Si el sondeo no encontró ninguna manifestación

Orden de preferencia para conseguir contenido largo, de mejor a peor:

1. **dato real creado por la API del propio sistema** dentro del test (y limpiado
   después, con soft delete);
2. **un registro de nombre largo en el seed** (`backend/src/modules/seeder/seeder.service.ts`,
   patrón de UUID fijo `550e8400-e29b-41d4-a716-446655440XXX`, siguiente número libre);
3. **pisar el DOM con `page.evaluate`** — solo con **aprobación explícita del owner**,
   porque un test que reescribe el DOM deja de probar el componente y pasa a probar solo
   CSS.

**Si la opción 1 no alcanza y hay que ir a la 2 o la 3: DETENERSE y preguntar.** No elegir
por cuenta propia.

- [ ] **Step 1: Escribir el spec de layout que falla con el código actual**

`frontend/e2e/layout/truncado.spec.ts`. Un helper de medición compartido por los casos,
con esta firma (el resto del cuerpo sale del informe de la Tarea 1):

```ts
import { test, expect, type Locator, type Page } from '@playwright/test'

async function medir(el: Locator) {
  return el.evaluate((n) => {
    const padre = n.parentElement!
    return {
      recorto: n.scrollWidth > n.clientWidth,
      padreDesborda: padre.scrollWidth > padre.clientWidth,
    }
  })
}

async function paginaScrolleaHorizontal(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}
```

Cada caso confirmado localiza su elemento **por el texto que muestra**, no por clases de
Tailwind: una clase es implementación y cambia; el texto es lo que ve el usuario.

- [ ] **Step 2: Correr el spec y verificar que FALLA**

```bash
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd frontend && npx playwright test e2e/layout/truncado.spec.ts --reporter=list
```

Expected: FAIL en cada caso confirmado — el elemento no recortó y/o el contenedor
desbordó. **Si pasa en verde antes de tocar el CSS, el test no está probando nada**:
volver al informe de la Tarea 1 y revisar qué se está midiendo.

- [ ] **Step 3: Agregar `min-w-0` solo a los candidatos confirmados**

En el elemento que lleva el `truncate`, en la misma línea de `class`. No tocar los
candidatos que el sondeo haya descartado, ni ningún otro `truncate` del repo.

- [ ] **Step 4: Verificar que pasa, y después mutarlo**

```bash
cd frontend && npx playwright test e2e/layout/truncado.spec.ts --reporter=list
```

Expected: PASS.

Después, **quitar el `min-w-0` de un caso, correr de nuevo y confirmar que se pone rojo**,
y restaurarlo. Es el único paso que prueba que el test cazaría el bug de vuelta.

- [ ] **Step 5: Documentación viva, en este mismo commit**

- `docs/PRODUCTO.md`: el contrato de anchos — escritorio (1280) y tablet (768)
  soportados; móvil **fuera de alcance declarado**, con el porqué: a 375 esto es otra
  interfaz, no un ajuste de CSS.
- `docs/agent/pendientes.md`: cerrar la entrada de los cuatro candidatos
  (`pendientes.md:103-114`) y registrar la decisión de móvil como decisión, no como deuda.
- `docs/agent/resueltos.md`: el detalle de los cuatro, con la medición como evidencia —
  incluidos los **descartados**, que también son un resultado.
- `docs/patterns/frontend.md`: §16, el patrón de aserción de layout — qué asevera
  (recorte + contenedor + página), por qué no se aseveran clases, y **por qué esto no
  puede vivir en un test de render** (happy-dom no calcula layout). Enlazarlo desde el
  §15 de tests de render.

- [ ] **Step 6: Gate completo**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd backend && npm run test:e2e
cd ../frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

- [ ] **Step 7: Revisión independiente (obligatoria para poder commitear)**

El diff toca `frontend/app/components/**/*.vue`, así que el pre-commit **bloquea** hasta
que exista el recibo de la revisión independiente de `verify-feature` (paso 7) para ese
diff exacto. No se saltea con `--no-verify`.

- [ ] **Step 8: Commitear**

```bash
git add frontend/e2e/layout/truncado.spec.ts \
        frontend/app/components/caja/ frontend/app/layouts/dashboard.vue \
        docs/PRODUCTO.md docs/agent/pendientes.md docs/agent/resueltos.md \
        docs/patterns/frontend.md
git commit -m "test(layout): mide truncado real en navegador y cierra los cuatro candidatos"
```

(Ajustar las rutas del `git add` a los archivos que realmente cambiaron — nunca `git add .`.)

- [ ] **Step 9: Pushear y verificar el run**

```bash
git push
gh run watch "$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: `gate` y `e2e-navegador` verdes, con el spec de layout ya adentro.
