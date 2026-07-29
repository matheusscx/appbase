# Playwright en CI + verificación de layout real (Entrega B)

**Fecha:** 2026-07-29
**Estado:** diseño aprobado, pendiente de plan
**Alcance:** infraestructura de tests, no una feature. Dos piezas: (1) la suite E2E de
navegador que ya existe empieza a correr en cada push, en un job propio de CI con su
propia base; (2) un spec de layout que mide ancho real y resuelve los cuatro candidatos
de truncado que la Entrega A no pudo mirar. Solo frontend y CI. Sin dependencias nuevas.
**Origen:** Entrega A (`main` en `63293ff`). La capa de tests de render que se construyó
ahí corre sobre happy-dom, que **no calcula layout**, así que hay una clase entera de
bugs que ninguna cantidad de tests de render puede ver.

---

## 1. Contexto y problema

### 1.1 La suite E2E existe y no corre nunca

`frontend/e2e/` tiene una fundación funcionando desde hace meses: `auth.setup.ts`
resuelve el login por UI una vez y guarda la sesión en `e2e/.auth/paris.json`
(`storageState`), `playwright.config.ts` define los proyectos `setup` → `chromium`, y
hay un smoke verde (`e2e/smoke/dashboard.smoke.spec.ts`). Los scripts `npm run e2e` y
`npm run e2e:smoke` están en `package.json`.

**`npm run e2e` no aparece en ningún paso de `.github/workflows/ci.yml`.** El job `gate`
corre el backend completo (`lint:check`, `typecheck`, `test`, `test:e2e` contra un
Postgres real) y del frontend corre `build`, `test`, `typecheck:ratchet` y
`design:check`. La suite de navegador queda afuera.

O sea que es un **ritual manual**: alguien tiene que acordarse de levantar
`docker-compose up` y correrla. Es exactamente el modo de fallo que la Entrega A existió
para reemplazar — con la diferencia de que acá el test ya está escrito y aun así no
protege nada.

### 1.2 Lo que la Entrega A estructuralmente no puede ver

happy-dom no hace layout: no hay anchos, no hay overflow, `scrollWidth` y `clientWidth`
son 0. Un test de render puede afirmar que un elemento tiene la clase `truncate`; no
puede afirmar que el texto **efectivamente se cortó**.

Eso dejó cuatro casos anotados en
[`docs/agent/pendientes.md`](../../agent/pendientes.md) como **candidatos a verificar, no
bugs confirmados**. Los cuatro son la misma forma —un elemento con `truncate` que es hijo
directo de un contenedor `.flex`, sin `min-w-0` en ningún ancestro— y ninguno declara
`flex-1`/`flex-auto`/`basis-*`, que es lo único que el check estático de
`check-design-tokens.mjs` sabe detectar:

| Punto | Elemento que trunca | Hermano que compite por el ancho |
|---|---|---|
| `app/components/caja/CajaAperturaGrid.vue:95` | `<span>` con `cajon.nombre` | `UIcon` de candado |
| `app/components/caja/CajaCajonesGrid.vue:56` | `<span>` con `cajon.nombre` | `UBadge` "Mía"/"Libre" |
| `app/components/caja/CajaCajonesGrid.vue:71` | `<dd>` con `usuarioNombre` | el `<dt>` "Usuario" |
| `app/layouts/dashboard.vue:184` | `<span>` con el nombre del tenant | el ícono del logo, en un sidebar `resizable` |

**Por qué es un bug binario y no un umbral de pantalla.** `truncate` es
`overflow:hidden` + `text-overflow:ellipsis` + `white-space:nowrap`. Un ítem flex tiene
`min-width:auto`: su tamaño mínimo *es* el de su contenido, así que se niega a encogerse
por debajo del ancho del texto. La elipsis nunca aparece; en su lugar el contenedor crece
o el hermano se va afuera. Con `min-w-0` el ítem sí encoge y la elipsis aparece. Es una
propiedad del CSS, no un pixel de corte — lo que cambia con la pantalla es **si el caso
se llega a manifestar**, no si el bug está.

## 2. Alcance

### 2.1 Dentro

1. Job de CI nuevo que corre la suite de navegador en cada push a `main`, bloqueante.
2. Arranque del stack en el runner sin Docker, con readiness determinista.
3. Un spec de layout que mide ancho real y **resuelve** los cuatro candidatos: los
   confirma como bugs y los corrige, o los descarta con evidencia.
4. El contrato de anchos soportados, escrito en `docs/PRODUCTO.md`.
5. El patrón de aserción de layout documentado en `docs/patterns/frontend.md`.

### 2.2 Fuera, a propósito

- **Los seis flujos críticos de negocio** anotados en `pendientes.md` (venta completa,
  pago mixto, nota de crédito, apertura/cierre de caja, descuento de stock, cambio de
  tenant sin fuga). Son trabajo de dominio, cada uno con aserciones derivadas de
  `docs/features/`, y el más valioso —cambio de tenant sin fuga— merece su propio ciclo.
  Van después de esta entrega, de a uno. Decisión del owner.
- **Móvil.** Ver §3.
- **Cambiar el flujo local.** `docker-compose up` sigue siendo cómo se corre la suite en
  la máquina del dev. Esta entrega no toca eso.
- **Barrer todas las páginas** buscando desbordes. El spec visita las pantallas de los
  cuatro candidatos, no hace un sweep.

## 3. Decisión de producto: anchos soportados

**Escritorio (1280) y tablet (768). Móvil fuera de alcance declarado.**

Tablet no es hipotético: es el mesero en salón, y es donde el riesgo de estos cuatro
casos es mayor, porque las tarjetas de caja se angostan y el nombre empieza a competir
con el badge.

Móvil queda afuera **como decisión registrada, no como deuda silenciosa**. El razonamiento
importa porque determina que no vuelva a discutirse por accidente: este sistema tiene
tablas de muchas columnas, un drawer lateral, y una grilla de ítems que compite con el
carrito. A 375 eso no es un problema de layout, es **otra interfaz**; resolverlo es un
proyecto de producto, no un `min-w-0`.

Y esa es la razón para no meterlo al gate ahora: entraría rojo de inmediato por cosas que
no tienen nada que ver con estos cuatro candidatos, y las dos salidas posibles —encarar
el rediseño para poder commitear, o ir agregando excepciones— envenenan el test.
**Un test rojo que todos aprenden a ignorar es peor que no tener el test.**

Se distingue explícitamente *soportar móvil* (decisión de producto, trabajo grande) de
*no scrollear horizontalmente a 375* (higiene, alcanzable sin rediseño). La segunda
podría cumplirse hoy o no; nadie lo midió, y descubrirlo en el gate sería la peor forma
de descubrirlo. El owner descartó la pasada exploratoria por ahora.

## 4. Decisión de infraestructura: topología en CI

**Job separado, en paralelo con `gate`, con su propio servicio Postgres, bloqueante.**

Lo que decide esto no es el tiempo: es la base de datos.

GitHub Actions crea los `services` **por job**, así que un job propio nace con un Postgres
virgen y el bootstrap del backend lo siembra. Eso da gratis la garantía que
`scripts/reset-db.sh` construye a mano en local: *la única corrida que vale es la primera
sobre una base recién sembrada*.

La alternativa —agregar los pasos al final del job `gate`— reusa los installs y el build,
pero corre sobre la base que `backend · e2e` acaba de mutar: cajas abiertas, cajones con
sesión, stock consumido. Justo el estado que hace que `CajaCajonesGrid` renderice algo
distinto en cada corrida. Ya nos costó tiempo en el e2e de backend (ver
`pendientes.md` y el propio encabezado de `reset-db.sh`). Además suma su tiempo en serie
a cada push.

Correr en paralelo también evita que un fallo de e2e enmascare el resultado del gate: son
dos señales independientes.

**Costo aceptado:** minutos de runner duplicados (`npm ci` de ambos lados y los dos
builds, del orden de 3 minutos). Es plata de runner, no tiempo de espera del dev, porque
el wall-clock por push casi no se mueve.

**Bloqueante.** Si el job falla, el push falla. Un job e2e informativo es el smoke manual
otra vez, con más ceremonia. `retries: 1` en CI ya está configurado.

## 5. Decisión técnica: cómo arranca el stack en el runner

**Sin Docker.** El runner ya tiene todo: Node 22, un servicio Postgres, y los dos
proyectos se construyen con sus propios scripts.

1. `nest build` → `node dist/main` en background, puerto 3000. `synchronize` crea el
   schema porque `NODE_ENV != production`, y el seeder corre al bootstrap — igual que hoy
   en el paso de e2e de backend. El CORS del `main.ts` ya trae `http://localhost:5173`
   por default, que es lo que usa el runner.
2. `nuxt build` → `node .output/server/index.mjs` con **`PORT=5173`**. El server de Nitro
   escucha 3000 por default y chocaría con el backend.
3. `playwright install --with-deps chromium`.
4. `npm run e2e`.

### 5.1 Readiness: el puerto abierto *es* la señal de seed terminado

Este es el punto donde estos pipelines se vuelven intermitentes, y acá tiene una
respuesta exacta y verificada, no una espera fija.

`SeederService` implementa `OnApplicationBootstrap`. En `@nestjs/core` **11.1.26**,
`NestApplication.listen()` llama a `init()` si la app no está inicializada
(`node_modules/@nestjs/core/nest-application.js:174-178`), e `init()` ejecuta
`callBootstrapHook()` en la línea `:107`, **antes** de `httpAdapter.listen()` en la
`:190`. Es decir: **el puerto 3000 no acepta conexiones hasta que el seed terminó.**

No hace falta parsear los logs esperando `Seed complete.`, ni un `sleep`. Que el backend
responda es prueba suficiente de que la base está sembrada. (No existe endpoint de health
en el backend; cualquier respuesta HTTP del puerto sirve como señal, incluido un 404.)

### 5.2 `webServer` de Playwright, solo bajo `CI`

El arranque y la espera los maneja **Playwright con la opción `webServer`**, no un `&` con
un bucle de espera a mano: declara los dos comandos, espera a que cada URL responda con su
propio timeout, vuelca el stdout del proceso al reporte si algo no levanta, y hace el
teardown solo.

Se define **únicamente cuando `process.env.CI` está presente.** En local no se define
nada, así que el comportamiento actual no cambia: `playwright.config.ts` sigue apuntando
al `docker-compose up` que ya corre el dev. El comentario de cabecera del archivo, que hoy
afirma que la config no levanta servidores, se actualiza para decir la verdad de los dos
entornos.

## 6. El spec de layout

Se mantienen los dos proyectos que ya existen (`setup` → `chromium`): **no se agrega un
proyecto por viewport**. Los anchos los declara el propio spec con `test.use`, para no
duplicar la suite entera solo para probar dos.

Dos aserciones por caso:

- **el elemento recortó** — `scrollWidth > clientWidth` sobre el elemento que lleva
  `truncate`: es lo que hace un truncado que funciona;
- **el contenedor no creció** — `scrollWidth <= clientWidth` sobre su padre flex, más la
  página sin scroll horizontal
  (`documentElement.scrollWidth <= documentElement.clientWidth`).

Un `truncate` sano cumple las dos. El roto invierte las dos: no recorta nada
(`scrollWidth === clientWidth`, se quedó con todo el ancho que quiso) y empuja al hermano
afuera del contenedor.

La aserción de página sin scroll horizontal es la más valiosa de las dos porque **no
depende de acertarle a un pixel**: una app no debe scrollear horizontalmente a los anchos
que declara soportar, y esa sola regla caza los cuatro candidatos y cualquier futuro.

### 6.1 Lo que este spec deliberadamente NO decide

Las dos aserciones **solo detectan algo si el texto realmente no entra**. Con los nombres
del seed —"Caja Principal", "Demo Restaurante"— puede que a 768 entren de sobra, y
entonces el spec pasaría en verde sin haber probado nada. **Nadie lo midió todavía.**

Por eso **la primera tarea del plan es un sondeo, no un test**: levantar el stack, ir a
las pantallas de caja y al dashboard a 1280 y 768, y medir los cuatro candidatos. Las
aserciones se escriben contra ese número.

- Si el ancho angosto ya los rompe, el spec queda sin ninguna pieza artificial.
- Si no, hace falta contenido largo, y el orden de preferencia es: **dato real creado por
  la API del propio sistema** primero; **un registro de nombre largo en el seed** después;
  y **pisar el DOM a mano solo con aprobación explícita del owner**, porque un test que
  reescribe el DOM deja de probar el componente y pasa a probar únicamente CSS.

El plan **no fija el cuerpo de estos tests antes de que el sondeo conteste**. Es la
lección registrada de la Entrega A: fijar código antes del spike produjo tests que hubo
que reescribir al despacharlos.

El sondeo también decide el destino de los cuatro candidatos: los confirmados se corrigen
con `min-w-0` en esta misma entrega y se mueven a `docs/agent/resueltos.md`; los
descartados se cierran ahí también, con la medición como evidencia.

## 7. Archivos tocados

| Archivo | Cambio |
|---|---|
| `.github/workflows/ci.yml` | job `e2e-navegador` nuevo, en paralelo, con su Postgres |
| `frontend/playwright.config.ts` | `webServer` bajo `CI`; cabecera actualizada |
| `frontend/e2e/layout/truncado.spec.ts` | spec de layout nuevo |
| `frontend/app/components/caja/*.vue`, `app/layouts/dashboard.vue` | `min-w-0` solo en los candidatos que el sondeo confirme |
| `docs/PRODUCTO.md` | anchos soportados: escritorio y tablet; móvil fuera |
| `docs/agent/pendientes.md` | se cierra la entrada de los 4 candidatos; se registra la decisión de móvil |
| `docs/agent/resueltos.md` | el detalle de los 4, con la medición |
| `docs/patterns/frontend.md` | patrón de aserción de layout, al lado del §15 de render |

`docs/ESTADO.md` **no se toca**: rastrea funcionalidades del SaaS, no infraestructura de
tests. La Entrega A tampoco lo tocó, por lo mismo.

## 8. Criterios de aceptación

1. Un push a `main` corre la suite de navegador sin que nadie levante nada a mano, y el
   push falla si la suite falla.
2. El job corre sobre una base sembrada de cero, sin estado de corridas anteriores.
3. La espera de arranque es por readiness observada, no por tiempo fijo: **no hay ningún
   `sleep` ni timeout arbitrario** en el camino feliz.
4. El spec de layout **falla** si se le quita el `min-w-0` a un caso confirmado, y
   **pasa** con el código correcto. Se verifica mutando, no razonando.
5. Los cuatro candidatos de `pendientes.md` quedan resueltos —corregidos o descartados—
   con la medición como evidencia, y su entrada cerrada.
6. Correr la suite en local sigue funcionando igual que hoy, con `docker-compose up`.
7. El gate completo del proyecto queda en verde
   ([CLAUDE.md](../../../CLAUDE.md#-checklist-antes-de-dar-una-tarea-por-terminada)).

## 9. Riesgos

- **El sondeo puede no encontrar ningún desborde.** Es un resultado válido, no un
  fracaso: significa que los cuatro candidatos eran falsos positivos del análisis
  estático, y hay que decirlo con la medición al lado. Pero el spec de layout necesita
  entonces contenido largo deliberado para tener algo que afirmar, y esa decisión vuelve
  al owner (§6.1).
- **Minutos de runner.** El job duplica installs y builds. Aceptado explícitamente a
  cambio de la base limpia.
- **Intermitencia.** El riesgo clásico —arrancar los tests antes de que el seed termine—
  está cerrado por §5.1. El riesgo que queda es el propio de un navegador real
  (animaciones, hidratación); se mitiga con `retries: 1`, ya configurado, y con la regla
  ya vigente en el repo de **cero esperas fijas** en los specs.
- **Falso sentido de cobertura.** Un job e2e en verde con un solo smoke y un spec de
  layout no prueba ningún flujo de negocio. Los seis flujos siguen pendientes y esta
  entrega no los adelanta.
