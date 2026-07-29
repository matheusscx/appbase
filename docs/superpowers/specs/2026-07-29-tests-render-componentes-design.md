# Tests de render de componentes (Entrega A)

**Fecha:** 2026-07-29
**Estado:** diseño aprobado, pendiente de plan
**Alcance:** infraestructura de tests, no una feature. Dos piezas que enchufan en gates que
ya corren en CI: (1) una capa de tests de render sobre `npm test` para los componentes
compartidos de `frontend/app/components/` raíz, arrancando con tres; (2) un check estático
del bug de `truncate` en hijo flex, dentro de `scripts/check-design-tokens.mjs`. Solo
frontend. Sin dependencias nuevas.
**Origen:** cierre de la feature de advertencias en el carrito (`main` en `a803742`). Cuatro
bugs de esa feature vivían en el template y ninguno fue detectado por build, typecheck, unit
ni las revisiones independientes — solo por el smoke test manual en navegador.

---

## 1. Contexto y problema

El frontend tiene **24 specs y 275 tests, todos de código puro**: composables, stores,
utils y un middleware. Hay **126 archivos `.vue` y cero tests de render**.

No es un olvido. Es la estrategia documentada en
[`docs/patterns/frontend.md`](../../patterns/frontend.md) §10: extraer los helpers a
funciones puras (`composables/useVenta.ts`), testear eso al 100%, y verificar el render a
mano (§8.1). Funciona mientras el bug esté en la lógica. **Se queda corta cuando el bug
vive en el template**, y ahí es donde cayeron los cuatro de la feature de advertencias:

| Bug | Cómo se manifestó |
|---|---|
| Root `Fragment` mataba el fallthrough de `class` | los tres carritos pasaban `mb-1`/`mb-2` y Vue lo descartaba en silencio, con un warning de `Extraneous non-props attributes` en cada render (`79f1e37`) |
| `truncate` sin `min-w-0` en hijo flex | el título nunca truncaba, desbordaba — exactamente el bug que el rediseño existía para arreglar (`31893f7`) |
| Tag de auto-import mal escrito | falla silenciosa en runtime; pasa build, typecheck, lint y unit |
| Cruce de índices `resultado`/`lineas` | advertencia dibujada bajo la línea equivocada (diferido, en `pendientes.md`) |

Los cuatro los cazó una persona mirando el navegador.

### 1.1 Lo que ya está construido

**No hace falta ninguna dependencia nueva.** `@vue/test-utils` (^2.4.11), `happy-dom`
(^20.10.6) y `@nuxt/test-utils` (^4.0.3) se instalaron en el commit que montó Vitest
(`affc00a`) y `vitest.config.ts` ya usa `defineVitestConfig` con `environment: 'happy-dom'`
y un `test.setup.ts` que stubea los globals de Nuxt (`useCookie`, `useRuntimeConfig`,
`navigateTo`, `$fetch`). **`@vue/test-utils` nunca se importó en ningún archivo**: se
instaló y quedó dormido tres meses.

O sea: la infraestructura está, falta usarla.

### 1.2 Por qué Playwright no resuelve esto

La suite Playwright existe (`frontend/e2e/`, con el login ya resuelto vía `storageState`)
pero **no corre en CI**: `.github/workflows/ci.yml` corre backend `lint:check`/`typecheck`/
`test`/`test:e2e` y frontend `build`/`test`/`typecheck:ratchet`/`design:check`. `npm run e2e`
no está en ningún paso.

Agregarle specs de layout sin meterla en CI cambia un ritual manual por otro ritual manual,
con más código. **Meter Playwright en CI es una decisión de infraestructura propia** (levantar
el stack docker completo en el runner) y va en un spec aparte — la Entrega B, fuera de este
documento.

---

## 2. Qué NO cubre esta entrega

Explícito, para que el plan no se expanda:

- **No** se cubren los 126 `.vue`. Una campaña de cobertura retroactiva es mucho trabajo
  contra bugs que ya no existen. El valor está en los compartidos y en que lo nuevo nazca
  con test.
- **No** se tocan páginas. Son orquestación y su lógica ya vive en composables testeados.
- **No** hay cambios en `.github/workflows/ci.yml` ni en `playwright.config.ts`.
- **No** se tocan los otros 27 usos de `truncate` del repo: no son bugs (§4.1).
- **No** se resuelve el cruce de índices `resultado`/`lineas` — sigue diferido en
  [`docs/agent/pendientes.md`](../../agent/pendientes.md). Esta entrega construye la
  herramienta que podría cubrirlo, no el arreglo.

---

## 3. Capa de render

### 3.1 Ubicación y naming

Spec al lado del fuente, siguiendo la convención ya establecida (`useVenta.spec.ts` vive
junto a `useVenta.ts`):

```
app/components/AdvertenciasPrecio.vue
app/components/AdvertenciasPrecio.spec.ts
```

Corre con `npm test`, que **ya está en CI**. Cero cambios de workflow.

### 3.2 Decisión de montaje — se resuelve con una prueba, no discutiendo

Hay dos formas de montar y la diferencia importa por una sola clase de bug:

| | `mountSuspended` (entorno `nuxt`) | `mount` plano + `global.stubs` |
|---|---|---|
| Auto-imports | resuelve de verdad | falsos, definidos a mano |
| Tag mal escrito | **falla el test** | pasa |
| Costo | bootea Nuxt por archivo | instantáneo |

**Primera tarea del plan: una prueba de factibilidad.** Se adopta `mountSuspended` si se
cumplen las tres:

1. el entorno `nuxt` bootea en este repo sin configuración extra;
2. un archivo de spec corre en tiempo tolerable (referencia: que `npm test` no pase de
   ~2× su duración actual);
3. un tag deliberadamente mal escrito (`<AdvertenciasPrecioo>`) **hace fallar el test** —
   si no falla, la ventaja no existe y no hay razón para pagar el boot.

Si alguna falla, se cae a `mount` plano con `global.stubs` explícitos para los `U*`,
**aceptando por escrito que se pierde la detección del tag mal escrito**.

La prueba responde además: **¿`vue-tsc` ya caza el tag inválido** vía el
`GlobalComponents` que Nuxt genera en `.nuxt/components.d.ts`? Si lo caza, el entorno
`nuxt` compra menos y gana `mount` plano por costo. (El repo usa `typecheck:ratchet` con
baseline, así que la prueba debe mirar la salida cruda de `vue-tsc`, no el exit code del
ratchet.)

El resultado de la prueba se documenta en el patrón (§5) para que nadie lo vuelva a
litigar.

### 3.3 Qué afirma un test de render — y qué no

Regla explícita, para que no degeneren en tests que congelan markup:

**Sí:**
- lo que ve el usuario: texto renderizado, cuántos elementos aparecen;
- el caso vacío — que **no renderice nada**;
- `aria-label` y texto accesible;
- eventos emitidos (`update:modelValue`, cierre);
- **fallthrough de atributos**: que la `class` que pasa el padre aterrice en el root.

**No:**
- **clases de estilo** (`text-warning`, `truncate`, `size-3.5`). Eso es afirmar la
  implementación, y happy-dom **no calcula layout** — no hay anchos ni overflow, así que
  el assert no valida nada de lo que importa. Ese bug es de §4.
- **snapshots**. Congelan markup y se aprueban a ciegas cuando cambian.

### 3.4 Los tres componentes y su criterio de validez

Aplica la disciplina de mutación: **un test solo cuenta si falla contra el estado previo
real.** Romper la línea nueva prueba que el test la toca; solo revertir prueba que habría
cazado el bug.

| Componente | Qué cubre | Contra qué se valida |
|---|---|---|
| `AdvertenciasPrecio` | lista vacía → no renderiza nada; N advertencias → N títulos; la `class` del padre llega al root; el `aria-label` del botón lleva el detalle | **revertir al root `Fragment`** (versión previa a `79f1e37`, con el `<p v-for>` como único raíz) tiene que dejarlo en rojo |
| `MoneyInput` | formateo mientras se escribe según la config de moneda; `modelValue` viaja como string de punta a punta; emite `update:modelValue` con el valor sin máscara | mutación deliberada del formateo (p. ej. invertir separador de miles y decimal) |
| `AppDrawer` | qué renderiza abierto vs. cerrado; los slots se proyectan; emite el cierre | mutación deliberada |

**`MoneyInput` depende de `useMonedasStore`** (Pinia). Se monta con
`setActivePinia(createPinia())` y el store sembrado, que es el patrón que ya usan las
specs de stores (`app/stores/monedas.spec.ts`). **No** se agrega `@pinia/testing`: sería
una dependencia nueva y `pinia` sola alcanza.

**Riesgo declarado en `AppDrawer`:** envuelve `UDrawer` de Nuxt UI (reka-ui), que usa
teleport/portal y animación. Puede no montar en happy-dom. La tarea del plan **empieza por
confirmar que monta**; si no monta con un esfuerzo acotado, se sustituye por
**`RolPermisosPorModulo`** (lógica real, sin portal) y se anota el hallazgo — que el
componente sea intesteable en happy-dom es información útil, no un fracaso.

Se eligieron estos tres por razones distintas y deliberadas: `AdvertenciasPrecio` es chico
y tiene **dos bugs reales con estado previo en git** contra los cuales validar;
`MoneyInput` es el de mayor consecuencia si se rompe (formatea dinero); `AppDrawer` es el
que la experiencia previa marca como el lugar donde se colaron bugs de runtime que ni
build ni typecheck ven.

---

## 4. Check estático: `truncate` en hijo flex

### 4.1 La regla correcta (y la incorrecta)

La regla intuitiva —"`truncate` exige `min-w-0`"— **es falsa en este repo**. De 29 usos de
`truncate`, **uno solo** tiene `min-w-0` en el mismo elemento. Los otros 28 no, y están
bien: el patrón real es **`min-w-0` en el wrapper, `truncate` en el descendiente**.

```vue
<!-- ✅ correcto — CarritoPanel.vue:188, UserMenu.vue:66 -->
<div class="flex-1 min-w-0">
  <p class="truncate">{{ nombre }}</p>
</div>
```

La regla intuitiva habría disparado sobre 28 líneas correctas: inservible.

La regla real es más angosta: **un elemento que es él mismo hijo flex (`flex-1`,
`flex-auto`, `basis-*`) y trunca en ese mismo elemento necesita `min-w-0`.**

```vue
<!-- ❌ el elemento es hijo flex Y trunca — sin min-w-0 no trunca nunca -->
<span class="flex-1 truncate">{{ nombre }}</span>

<!-- ✅ AdvertenciasPrecio.vue:15, ya corregido -->
<span class="min-w-0 flex-1 truncate">{{ advertencia.titulo }}</span>
```

**Medida contra los 126 `.vue` del repo: un solo hit** — `app/pages/select-tenant.vue:84`,
que es justamente el bug abierto en `pendientes.md`. Cero falsos positivos. La línea ya
corregida de `AdvertenciasPrecio` pasa.

### 4.2 Dónde vive

Se agrega a **`frontend/scripts/check-design-tokens.mjs`**, no a un script nuevo. Ese
archivo ya camina `app/**/*.vue`, ya tiene modo `--staged`, ya está enganchado en el
pre-commit (guard 4) y ya corre en CI vía `design:check`. Un script paralelo duplicaría
las tres cosas —recorrido de archivos, detección de staged, formato de reporte— que es
justo la duplicación que las convenciones del repo desaconsejan.

**Tensión asumida:** el archivo se llama `check-design-tokens` y va a chequear algo que no
es un token de diseño. El rename es una decisión aparte y **no** entra en esta entrega.

La regla es un predicado compuesto (hijo flex **y** trunca **y** no tiene `min-w-0`), no un
regex suelto, así que no encaja en el array `RULES` existente: va como chequeo propio
dentro del mismo script, reusando el recorrido y el reporte.

**Limitación conocida, a documentar en el propio script:** opera sobre el atributo `class`
estático de una línea. No ve clases que lleguen por `:class` dinámico ni desde un
componente padre. Es un cedazo barato con cero falsos positivos, no una garantía.

### 4.3 Va con su fix

`select-tenant.vue:84` se corrige en el mismo commit — si no, el check nace en rojo. Esa
entrada sale de [`pendientes.md`](../../agent/pendientes.md) y pasa a
[`resueltos.md`](../../agent/resueltos.md) con el detalle del fix.

---

## 5. Documentación

| Archivo | Qué cambia |
|---|---|
| [`docs/patterns/frontend.md`](../../patterns/frontend.md) | **sección nueva** con el patrón de test de render: cómo se monta (el resultado de §3.2), qué se afirma y qué no (§3.3), y la regla de validación por mutación. Es lo que convierte esto en el default para lo que venga. |
| [`docs/agent/pendientes.md`](../../agent/pendientes.md) | sale la entrada de `select-tenant.vue:84` |
| [`docs/agent/resueltos.md`](../../agent/resueltos.md) | entra esa entrada con el detalle |

**No** va a [`anti-patterns.md`](../../agent/anti-patterns.md): ese archivo es para bugs de
patrón que se repitieron y **no** están automatizados, y este queda automatizado por §4.

**No** va a `docs/ESTADO.md`: no es una funcionalidad de producto.

---

## 6. Criterios de éxito

1. `npm test` en `frontend/` corre los tres specs de render en verde, y sigue en CI sin
   tocar el workflow.
2. Cada uno de los tres tests **falla** contra su estado previo o su mutación (§3.4),
   verificado y reportado — no afirmado.
3. `npm run design:check` detecta `select-tenant.vue:84` antes del fix y pasa después, con
   cero hits sobre los otros 28 usos de `truncate`.
4. El pre-commit bloquea un `.vue` staged que introduzca el patrón, sin wiring nuevo.
5. `docs/patterns/frontend.md` documenta el patrón, incluida la decisión de montaje que
   salió de la prueba de §3.2.
6. Gate completo del proyecto en verde (`CLAUDE.md` → checklist de cierre).

---

## 7. Lo que esta entrega deja abierto

Honestidad sobre el alcance, para que no se lea como más de lo que es:

- **El layout sigue sin verificarse automáticamente.** happy-dom no mide anchos. El check
  de §4 cubre *una* forma conocida del bug por inspección de texto; un `truncate` que no
  trunca por cualquier otra razón sigue necesitando ojos. Eso es la Entrega B.
- **12 de los 15 componentes compartidos siguen sin test**, y las 111 vistas restantes
  también. La apuesta es que el patrón documentado haga que lo nuevo nazca cubierto, no
  saldar la deuda vieja.
- **El cruce de índices `resultado`/`lineas`** queda diferido. Con esta capa construida
  pasa a ser testeable, que es precondición para arreglarlo bien.
