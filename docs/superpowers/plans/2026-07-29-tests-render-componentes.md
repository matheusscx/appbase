# Tests de render de componentes (Entrega A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el frontend tenga tests que monten componentes de verdad, y que el bug de
`truncate` en hijo flex lo cace un gate en vez de una persona mirando el navegador.

**Architecture:** dos piezas independientes que enchufan en gates que ya corren en CI.
(1) Tres specs de render en `frontend/app/components/`, al lado de su `.vue`, ejecutados por
`npm test` — que ya está en el workflow. (2) Un chequeo estático dentro de
`frontend/scripts/check-design-tokens.mjs`, que ya está en `design:check` y en el
pre-commit. No se toca `ci.yml`, no se toca Playwright, no se instala nada.

**Tech Stack:** Vitest 4.1.9, `@vue/test-utils` 2.4.11, `happy-dom` 20.10.6,
`@nuxt/test-utils` 4.0.3 (**las cuatro ya instaladas** desde `affc00a`), Nuxt 4, Vue 3,
Pinia, Node para el script de chequeo.

**Spec:** [`docs/superpowers/specs/2026-07-29-tests-render-componentes-design.md`](../specs/2026-07-29-tests-render-componentes-design.md) (commit `2a3ff1f`).

## Global Constraints

- **Cero dependencias nuevas.** Ni `@pinia/testing`, ni `@testing-library/*`, ni nada. Si
  una tarea parece necesitar una, **detenerse y reportar `BLOCKED`** — no instalarla.
- **Specs al lado del fuente:** `app/components/Foo.spec.ts` junto a `app/components/Foo.vue`.
  Es la convención ya establecida (`useVenta.spec.ts` junto a `useVenta.ts`).
- **Un test de render afirma lo que ve el usuario:** texto renderizado, cuántos elementos,
  el caso vacío, `aria-label`, eventos emitidos, y el fallthrough de `class` al root.
- **Nunca afirmar clases de estilo** (`text-warning`, `truncate`, `size-3.5`). happy-dom no
  calcula layout: el assert no validaría nada. Excepción: ninguna.
- **Nunca snapshots.** Congelan markup y se aprueban a ciegas.
- **Ningún test cuenta hasta fallar contra su estado previo o su mutación.** Romper la línea
  nueva prueba que el test la toca; solo revertir prueba que habría cazado el bug. La
  verificación se **ejecuta y se reporta**, no se afirma.
- **No crear un helper de montaje compartido.** Envolver el `mount` de una librería de tests
  agrega indirección y hace los tests más difíciles de leer. Una línea de import por archivo.
- **No tocar los otros 27 usos de `truncate`** del repo: no son bugs, el patrón correcto es
  `min-w-0` en el wrapper y `truncate` en el descendiente.
- **No modificar** `.github/workflows/ci.yml`, `playwright.config.ts` ni `frontend/e2e/`.
- **No cubrir páginas** ni los otros 12 componentes compartidos. Fuera de alcance.
- **No agregar nada a `docs/agent/anti-patterns.md`**: ese archivo es para bugs de patrón
  que se repitieron y **no** están automatizados, y el del truncado queda automatizado por
  la Tarea 4. **Tampoco a `docs/ESTADO.md`**: esto no es una funcionalidad de producto.
- **Trabajo directo sobre `main`.** Sin ramas, sin PRs (`CLAUDE.md`).
- **Nunca `git add .` ni `git add -A`.** Siempre rutas explícitas. Nunca commitear
  `.claude/settings.local.json`.
- Commits en español, estilo conventional commits, terminados en
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `frontend/app/components/AdvertenciasPrecio.spec.ts` | *crear* — render del aviso: caso vacío, N títulos, fallthrough de `class`, `aria-label` | 1 |
| `frontend/app/components/MoneyInput.spec.ts` | *crear* — formateo según moneda, vacío ≠ em dash, deshabilitado sin moneda | 2 |
| `frontend/app/components/AppDrawer.spec.ts` **o** `RolPermisosPorModulo.spec.ts` | *crear* — el que monte (ver Tarea 3) | 3 |
| `frontend/scripts/check-design-tokens.mjs` | *modificar* — suma el chequeo de hijo flex que trunca | 4 |
| `frontend/app/pages/select-tenant.vue` | *modificar* — línea 84, el único hit del chequeo nuevo | 4 |
| `.githooks/pre-commit` | *modificar* — el mensaje de la guard 4 deja de mentir | 4 |
| `docs/agent/pendientes.md` / `resueltos.md` | *modificar* — muda la entrada cerrada | 4 |
| `docs/patterns/frontend.md` | *modificar* — sección 15 nueva con el patrón | 5 |

---

### Task 1: Decidir el montaje y cubrir `AdvertenciasPrecio`

Esta tarea entrega **dos cosas**: la decisión de cómo se montan los componentes en este
repo (con evidencia medida, no con opinión) y el primer spec de render funcionando.

**Files:**
- Create: `frontend/app/components/AdvertenciasPrecio.spec.ts`
- Read-only: `frontend/app/components/AdvertenciasPrecio.vue`, `frontend/vitest.config.ts`,
  `frontend/test.setup.ts`

**Interfaces:**
- Consumes: `AdvertenciaPrecio` desde `~/composables/useCalculoPrecios`, forma
  `{ titulo: string, detalle: string }`.
- Produces: **la decisión de montaje** que usan las tareas 2 y 3 — o `mount` de
  `@vue/test-utils` (entorno `happy-dom`, el default actual), o `mountSuspended` de
  `@nuxt/test-utils/runtime` con el docblock `// @vitest-environment nuxt` en la primera
  línea del archivo. La decisión se escribe en el mensaje del commit de esta tarea.

**Contexto del componente** (`AdvertenciasPrecio.vue`, 29 líneas): recibe
`advertencias: AdvertenciaPrecio[]`. Root único `<div v-if="advertencias.length">` que
envuelve un `<p v-for>`. Cada `<p>` tiene un `<UIcon>`, un `<span>` con el `titulo`, y un
`<UTooltip>` que envuelve un `<UButton>` cuyo `aria-label` es `` `Detalle: ${detalle}` ``.

- [ ] **Step 1: Sondear el camino barato primero — `mount` plano**

Escribir un archivo desechable `frontend/app/components/_sonda.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AdvertenciasPrecio from './AdvertenciasPrecio.vue'

describe('sonda', () => {
  it('monta y resuelve los auto-imports de Nuxt UI', () => {
    const wrapper = mount(AdvertenciasPrecio, {
      props: { advertencias: [{ titulo: 'T', detalle: 'D' }] },
    })
    console.log('HTML:', wrapper.html())
    expect(wrapper.text()).toContain('T')
  })
})
```

Run: `cd frontend && npm test -- _sonda`

Lo que importa del output: si el HTML muestra el icono, el tooltip y el botón renderizados,
los auto-imports de componentes **se resuelven** en el entorno actual. Si aparecen tags sin
resolver o Vue avisa `Failed to resolve component`, no se resuelven.

- [ ] **Step 2: Sondear si un tag mal escrito falla**

Editar temporalmente `AdvertenciasPrecio.vue` línea 14, cambiando `<UIcon` por `<UIconn`
(y su cierre). Correr de nuevo:

Run: `cd frontend && npm test -- _sonda`

Anotar si el test **falla** o pasa igual. Después revertir el `.vue` a su estado original
(`git checkout -- app/components/AdvertenciasPrecio.vue`).

Correr también, con el tag roto, para saber si el typecheck ya lo cubre:

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "UIconn" || echo "vue-tsc NO lo caza"`

Nota: mirar la salida cruda de `vue-tsc`, no el exit code de `typecheck:ratchet`, que tiene
baseline.

- [ ] **Step 3: Si el Step 1 no resolvió los componentes, sondear `mountSuspended`**

Solo si hace falta. Reemplazar el contenido de `_sonda.spec.ts` por:

```ts
// @vitest-environment nuxt
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AdvertenciasPrecio from './AdvertenciasPrecio.vue'

describe('sonda', () => {
  it('monta con el entorno nuxt', async () => {
    const wrapper = await mountSuspended(AdvertenciasPrecio, {
      props: { advertencias: [{ titulo: 'T', detalle: 'D' }] },
    })
    console.log('HTML:', wrapper.html())
    expect(wrapper.text()).toContain('T')
  })
})
```

Run: `cd frontend && time npm test`

Medir la duración total. **Baseline: 275 tests, 24 archivos, 1.68 s** (3.7 s de reloj).
Umbral de aceptación: **`npm test` completo bajo 60 s**.

- [ ] **Step 4: Decidir y borrar la sonda**

Regla de decisión, en orden:

1. Si `mount` plano resuelve los componentes **y** el tag mal escrito hace fallar el test →
   **`mount` plano**. Es el más barato y cubre todo.
2. Si `mount` plano resuelve los componentes pero el tag mal escrito **no** hace fallar, y
   `vue-tsc` **sí** lo caza → **`mount` plano**. El typecheck ya cubre esa clase de bug.
3. Si `mount` plano no resuelve los componentes, o el tag mal escrito no falla en ningún
   lado, y `mountSuspended` bootea bajo el umbral → **`mountSuspended`**.
4. Si `mountSuspended` no bootea o excede 60 s → **`mount` plano con `global.stubs`
   explícitos** para `UIcon`/`UTooltip`/`UButton`, dejando **escrito en el commit** que se
   pierde la detección del tag mal escrito.

Borrar `frontend/app/components/_sonda.spec.ts`.

- [ ] **Step 5: Escribir el spec**

Crear `frontend/app/components/AdvertenciasPrecio.spec.ts`. El cuerpo de los tests es el
mismo cualquiera sea la decisión; solo cambia el import y si `montar` es `await` o no.

Con `mount` plano:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AdvertenciasPrecio from './AdvertenciasPrecio.vue'

describe('AdvertenciasPrecio', () => {
  it('sin advertencias no renderiza nada', () => {
    const wrapper = mount(AdvertenciasPrecio, { props: { advertencias: [] } })

    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('renderiza un título por advertencia', () => {
    const wrapper = mount(AdvertenciasPrecio, {
      props: {
        advertencias: [
          { titulo: 'Descuento "Promo fija $5.000"', detalle: 'no se aplicó completo porque superaba el monto disponible' },
          { titulo: 'Descuento "Segunda promo"', detalle: 'no se aplicó completo porque superaba el monto disponible' },
        ],
      },
    })

    expect(wrapper.findAll('p')).toHaveLength(2)
    expect(wrapper.text()).toContain('Descuento "Promo fija $5.000"')
    expect(wrapper.text()).toContain('Descuento "Segunda promo"')
  })

  // Este es el test que la versión con root Fragment no pasa: Vue descartaba en
  // silencio el class que le pasan los tres carritos (fix 79f1e37).
  it('recibe el class que le pasa el padre en su elemento raíz', () => {
    const wrapper = mount(AdvertenciasPrecio, {
      props: { advertencias: [{ titulo: 'T', detalle: 'D' }] },
      attrs: { class: 'mb-2' },
    })

    expect(wrapper.classes()).toContain('mb-2')
  })

  it('el detalle viaja en el aria-label, no en el texto visible', () => {
    const wrapper = mount(AdvertenciasPrecio, {
      props: { advertencias: [{ titulo: 'Descuento "Promo"', detalle: 'no se aplicó completo' }] },
    })

    expect(wrapper.text()).not.toContain('no se aplicó completo')
    expect(wrapper.find('[aria-label="Detalle: no se aplicó completo"]').exists()).toBe(true)
  })
})
```

Con `mountSuspended`: agregar `// @vitest-environment nuxt` como **primera línea**,
reemplazar el import por `import { mountSuspended } from '@nuxt/test-utils/runtime'`, y
volver cada test `async` con `await mountSuspended(...)` en vez de `mount(...)`.

Con `global.stubs` (opción 4 del Step 4): agregar a cada `mount` el objeto
`{ global: { stubs: { UIcon: true, UTooltip: { template: '<div><slot /></div>' }, UButton: true } } }`.
El stub de `UTooltip` necesita template propio porque tiene que proyectar su slot para que
el botón exista; los otros dos alcanzan con `true`, que preserva los atributos.

- [ ] **Step 6: Correr y verificar verde**

Run: `cd frontend && npm test -- AdvertenciasPrecio`
Expected: 4 tests PASS.

- [ ] **Step 7: Validar por reversión — el paso que hace que el test cuente**

Revertir el componente a su estado previo al fix del Fragment, dejando el `<p v-for>` como
único nodo raíz. Reemplazar el bloque `<template>` de `AdvertenciasPrecio.vue` por:

```vue
<template>
  <p
    v-for="(advertencia, i) in advertencias"
    :key="i"
    class="flex items-center gap-1 text-xs text-warning"
  >
    <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
    <span class="min-w-0 flex-1 truncate">{{ advertencia.titulo }}</span>
    <UTooltip :text="advertencia.detalle">
      <UButton
        icon="i-lucide-info"
        variant="ghost"
        color="neutral"
        size="xs"
        square
        class="shrink-0"
        :aria-label="`Detalle: ${advertencia.detalle}`"
      />
    </UTooltip>
  </p>
</template>
```

Run: `cd frontend && npm test -- AdvertenciasPrecio`
Expected: **FAIL** en `recibe el class que le pasa el padre en su elemento raíz`.

Si pasa en verde, el test no sirve: **detenerse y reportarlo**, no seguir adelante.

Restaurar: `git checkout -- app/components/AdvertenciasPrecio.vue`

Run: `cd frontend && npm test -- AdvertenciasPrecio`
Expected: 4 tests PASS otra vez.

- [ ] **Step 8: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/app/components/AdvertenciasPrecio.spec.ts
git commit -m "$(cat <<'EOF'
test(frontend): primer test de render — AdvertenciasPrecio

El frontend tenía 275 tests y ninguno montaba un componente. Este es el
primero: caso vacío, un título por advertencia, el detalle solo en el
aria-label, y el fallthrough del class al root.

Montaje elegido: <COMPLETAR con la decisión del Step 4 y su evidencia:
qué resolvió los auto-imports, si el tag mal escrito falla, y a qué costo
quedó npm test>.

Validado por reversión: con el <p v-for> como único raíz (estado previo a
79f1e37) el test del fallthrough queda en rojo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Cubrir `MoneyInput`

**Files:**
- Create: `frontend/app/components/MoneyInput.spec.ts`
- Read-only: `frontend/app/components/MoneyInput.vue`, `frontend/app/stores/monedas.ts`,
  `frontend/app/types/moneda.ts`

**Interfaces:**
- Consumes: la decisión de montaje de la Tarea 1.
- Produces: nada que otra tarea consuma.

**Contexto:** `MoneyInput.vue` (90 líneas) renderiza un único `<UInput>` con
`:model-value="display"`. `display` se recalcula en un `watch` con `immediate: true`:
vale `''` si `modelValue` es `''` o `undefined` **o** si no hay moneda resuelta, y si no
vale `formatMontoDisplay(props.modelValue, cfg)`. El input va `:disabled="disabled || !cfg"`.
La moneda sale de `useMonedasStore()`: `monedaOficial` si la prop `oficial` es true,
`getById(monedaId)` si viene `monedaId`, y `undefined` si no.

El store se siembra con `hydrate(list: MonedaTenantApi[], tenantId: string)`. `MonedaTenantApi`
tiene: `monedaId`, `nombre`, `codigoIso`, `simbolo`, `decimales`, `separadorDecimal`,
`separadorMiles`, `locale`, `habilitada`, `esDefault`, `esOficial`, `valorDelDia`.

`formatMontoDisplay('1500000', <CLP>)` devuelve `'$1.500.000'` — valor ya fijado por
`app/utils/currency-format.spec.ts:69`, no derivado del código.

- [ ] **Step 1: Escribir el spec**

Crear `frontend/app/components/MoneyInput.spec.ts` (variante `mount` plano; adaptar el
montaje a lo que decidió la Tarea 1):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import MoneyInput from './MoneyInput.vue'
import { useMonedasStore } from '~/stores/monedas'
import type { MonedaTenantApi } from '~/types/moneda'

const CLP: MonedaTenantApi = {
  monedaId: 'clp-1',
  nombre: 'Peso Chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esDefault: true,
  esOficial: true,
  valorDelDia: null,
}

describe('MoneyInput', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useMonedasStore().hydrate([CLP], 'tenant-1')
  })

  it('muestra el monto formateado según la moneda', () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '1500000', monedaId: 'clp-1' },
    })

    expect(wrapper.find('input').element.value).toBe('$1.500.000')
  })

  // formatMontoDisplay devuelve '—' para vacío; el input NO debe mostrar eso, tiene que
  // quedar vacío para que el usuario pueda escribir.
  it('con modelValue vacío el input queda vacío, no con el em dash', () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '', monedaId: 'clp-1' },
    })

    expect(wrapper.find('input').element.value).toBe('')
  })

  it('sin moneda resuelta el input queda deshabilitado', () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '1500000', monedaId: 'no-existe' },
    })

    expect(wrapper.find('input').element.disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Correr**

Run: `cd frontend && npm test -- MoneyInput`
Expected: 3 tests PASS.

Si Pinia entra en conflicto con la instancia que trae el entorno `nuxt` (solo aplica si la
Tarea 1 eligió `mountSuspended`), sembrar el store **después** de montar, o pasar la
instancia por `global: { plugins: [pinia] }`. Si ninguna de las dos funciona, **detenerse y
reportar `BLOCKED`** — no instalar `@pinia/testing`.

- [ ] **Step 3: Validar por mutación**

Mutación 1 — borrar la rama del vacío en `MoneyInput.vue` líneas 69-72:

```ts
    if (props.modelValue === '' || props.modelValue === undefined) {
      display.value = ''
      return
    }
```

Run: `cd frontend && npm test -- MoneyInput`
Expected: **FAIL** en `con modelValue vacío el input queda vacío` (el input muestra `—`).

Mutación 2 — en la línea 84 del template, cambiar `:disabled="disabled || !cfg"` por
`:disabled="disabled"`.

Run: `cd frontend && npm test -- MoneyInput`
Expected: **FAIL** en `sin moneda resuelta el input queda deshabilitado`.

Si alguna mutación deja todo en verde, ese test no cubre nada: **detenerse y reportarlo**.

Restaurar: `git checkout -- app/components/MoneyInput.vue`

Run: `cd frontend && npm test -- MoneyInput`
Expected: 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/app/components/MoneyInput.spec.ts
git commit -m "$(cat <<'EOF'
test(frontend): render de MoneyInput con el store de monedas sembrado

Formatea según la config de la moneda, deja el input vacío (no el em dash
que devuelve formatMontoDisplay) cuando el modelValue es vacío, y se
deshabilita si no hay moneda resuelta.

El store se siembra con hydrate() sobre una Pinia nueva por test, que es
el patrón de app/stores/monedas.spec.ts. Sin @pinia/testing: pinia sola
alcanza.

Dos mutantes verificados: borrar la rama del vacío deja el em dash en el
input; sacar `|| !cfg` del disabled deja el input activo sin moneda.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Cubrir `AppDrawer` — o su sustituto

**Files:**
- Create: `frontend/app/components/AppDrawer.spec.ts` **o**
  `frontend/app/components/RolPermisosPorModulo.spec.ts`
- Read-only: `frontend/app/components/AppDrawer.vue`,
  `frontend/app/components/RolPermisosPorModulo.vue`

**Interfaces:**
- Consumes: la decisión de montaje de la Tarea 1.
- Produces: nada que otra tarea consuma.

**Riesgo declarado:** `AppDrawer.vue` es un wrapper sobre `<UDrawer>` de Nuxt UI (reka-ui),
que usa teleport/portal y animación, y con `open: false` no renderiza contenido. Puede no
montar en happy-dom.

- [ ] **Step 1: Confirmar si `AppDrawer` monta**

Crear `frontend/app/components/AppDrawer.spec.ts` con un solo test mínimo:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppDrawer from './AppDrawer.vue'

describe('AppDrawer', () => {
  it('monta abierto y proyecta el slot body', () => {
    const wrapper = mount(AppDrawer, {
      props: { open: true, title: 'Editar ítem' },
      slots: { body: '<p>contenido del cuerpo</p>' },
    })

    console.log('HTML:', wrapper.html())
    expect(wrapper.text()).toContain('contenido del cuerpo')
  })
})
```

Run: `cd frontend && npm test -- AppDrawer`

**Timebox: un intento de ajuste.** Si falla, se permite **un** intento —por ejemplo montar
con `attachTo: document.body`, o buscar el contenido teleportado en `document.body.innerHTML`
en vez de en `wrapper`. Si después de ese intento sigue sin montar, se para: borrar
`AppDrawer.spec.ts` e ir al Step 2. Que el drawer sea intesteable en happy-dom **es un
hallazgo que se reporta**, no un fracaso a esconder.

Si monta: completar el spec con dos tests más — que con `open: false` el contenido del body
**no** esté en el DOM, y que emita `update:open` al cerrarse — validarlos por mutación
(cambiar el `v-model:open` del template por `:open` fijo debe romper el de la emisión), y
saltar al Step 3.

- [ ] **Step 2: Sustituto — `RolPermisosPorModulo`**

Solo si `AppDrawer` no montó. Crear
`frontend/app/components/RolPermisosPorModulo.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RolPermisosPorModulo from './RolPermisosPorModulo.vue'
import type { ModuloDisponible } from './RolPermisosPorModulo.vue'

const MODULOS: ModuloDisponible[] = [
  {
    moduloTenantId: 'm-ventas',
    moduloAppId: 'app-ventas',
    nombre: 'Ventas',
    icono: null,
    permisos: [
      { moduloAppPermisoId: 'p-leer', permisoNombre: 'Leer' },
      { moduloAppPermisoId: 'p-crear', permisoNombre: 'Crear' },
    ],
  },
  {
    moduloTenantId: 'm-inventario',
    moduloAppId: 'app-inventario',
    nombre: 'Inventario',
    icono: null,
    permisos: [{ moduloAppPermisoId: 'p-inv-leer', permisoNombre: 'Leer' }],
  },
]

describe('RolPermisosPorModulo', () => {
  it('sin módulos muestra el mensaje por defecto', () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: [], seleccionados: new Set<string>() },
    })

    expect(wrapper.text()).toContain('El tenant no tiene módulos contratados.')
  })

  it('deshabilitado muestra su mensaje y no ofrece el buscador', () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: {
        modulos: MODULOS,
        seleccionados: new Set<string>(),
        disabled: true,
        disabledMessage: 'El rol admin no se edita.',
      },
    })

    expect(wrapper.text()).toContain('El rol admin no se edita.')
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('lista un módulo por cada uno recibido', () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: MODULOS, seleccionados: new Set<string>() },
    })

    expect(wrapper.text()).toContain('Ventas')
    expect(wrapper.text()).toContain('Inventario')
  })

  it('la búsqueda filtra por nombre de módulo', async () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: MODULOS, seleccionados: new Set<string>() },
    })

    await wrapper.find('input').setValue('inven')

    expect(wrapper.text()).toContain('Inventario')
    expect(wrapper.text()).not.toContain('Ventas')
  })

  it('sin coincidencias avisa con el término buscado', async () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: MODULOS, seleccionados: new Set<string>() },
    })

    await wrapper.find('input').setValue('zzz')

    expect(wrapper.text()).toContain('Ningún módulo coincide con «zzz».')
  })

  it('el conteo muestra seleccionados sobre total del módulo', () => {
    const wrapper = mount(RolPermisosPorModulo, {
      props: { modulos: MODULOS, seleccionados: new Set(['p-leer']) },
    })

    expect(wrapper.text()).toContain('1/2')
    expect(wrapper.text()).toContain('0/1')
  })
})
```

Run: `cd frontend && npm test -- RolPermisosPorModulo`
Expected: 6 tests PASS.

Nota sobre el conteo: el componente pasa `:unmount-on-hide="false"` al `UAccordion`, así que
los cuerpos están en el DOM aunque el acordeón esté colapsado. Si el `UAccordion` no
renderiza el slot `#trailing` en happy-dom, los dos tests que dependen de él —el del conteo—
se caen; en ese caso **detenerse y reportar** qué renderizó, en vez de aflojar la aserción.

- [ ] **Step 3: Validar por mutación**

Sobre el componente que haya quedado. Para `RolPermisosPorModulo`, en la línea 29:

```ts
  return props.modulos.filter(m => m.nombre.toLowerCase().includes(q))
```

cambiar `.includes(q)` por `.includes('')`.

Run: `cd frontend && npm test -- RolPermisosPorModulo`
Expected: **FAIL** en `la búsqueda filtra por nombre de módulo` y en
`sin coincidencias avisa con el término buscado`.

Segunda mutación, línea 47: invertir `` `${c.sel}/${c.total}` `` por `` `${c.total}/${c.sel}` ``.

Run: `cd frontend && npm test -- RolPermisosPorModulo`
Expected: **FAIL** en `el conteo muestra seleccionados sobre total del módulo`.

Restaurar: `git checkout -- app/components/RolPermisosPorModulo.vue`

Para `AppDrawer`, la mutación es la del Step 1: `v-model:open` → `:open`, que debe romper el
test de la emisión.

- [ ] **Step 4: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/app/components/<el spec que haya quedado>.spec.ts
git commit -m "$(cat <<'EOF'
test(frontend): render de <componente>

<Qué cubre: mensajes vacío/deshabilitado, filtrado por búsqueda, conteo
seleccionados/total.>

<Si aplica: AppDrawer no monta en happy-dom porque UDrawer teletransporta
su contenido; queda anotado como límite de la capa de render y se cubre
el sustituto.>

Mutantes verificados: <cuáles y qué test mata cada uno>.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Chequeo estático de `truncate` en hijo flex

**Files:**
- Modify: `frontend/scripts/check-design-tokens.mjs` (líneas 22-31 y 50-71)
- Modify: `frontend/app/pages/select-tenant.vue:84`
- Modify: `.githooks/pre-commit:73`
- Modify: `docs/agent/pendientes.md` (sacar la entrada), `docs/agent/resueltos.md` (agregarla)

**Interfaces:**
- Consumes: nada de las tareas anteriores. Esta tarea es independiente y podría ir primera.
- Produces: nada que otra tarea consuma.

**La regla.** Un elemento que es él mismo hijo flex (`flex-1`, `flex-auto`, `basis-*`) **y**
trunca en ese mismo elemento necesita `min-w-0`: los ítems flex tienen `min-width: auto` por
default y sin eso `truncate` no corta nunca, el texto desborda.

**No** es "todo `truncate` necesita `min-w-0`": de 29 usos en el repo, 28 no lo tienen y
están bien, porque el patrón correcto es `min-w-0` en el wrapper y `truncate` en el
descendiente (`CarritoPanel.vue:188`, `UserMenu.vue:66`). La regla acotada da **un solo hit**
en los 126 `.vue`.

- [ ] **Step 1: Agregar el chequeo al script**

En `frontend/scripts/check-design-tokens.mjs`, después de la constante `EXCLUDE` (línea 31),
agregar:

```js
// Hijo flex que trunca en el MISMO elemento: los ítems flex tienen min-width:auto por
// default, así que sin min-w-0 el `truncate` no entra en efecto y el texto desborda.
// El patrón correcto cuando min-w-0 va en un wrapper ancestro NO dispara acá.
// Límite conocido: mira el `class` estático de una línea. No ve `:class` dinámico ni
// clases que ponga un componente padre. Es un cedazo barato, no una garantía.
const FLEX_CHILD = /\b(flex-1|flex-auto|basis-[\w./[\]-]+)\b/
const LAYOUT_HINT = 'agregá min-w-0: un ítem flex tiene min-width:auto y sin eso truncate no corta'
```

Reemplazar el cálculo de `files` (líneas 47-48) por:

```js
const allFiles = staged ? stagedVueFiles() : allVueFiles(join(root, 'app'))
// La excepción de app/components/caja/ es SOLO para los colores financieros. El chequeo
// de layout corre sobre TODOS los .vue: heredar ese filtro dejaría 13 componentes sin
// revisar en silencio.
const tokenFiles = allFiles.filter((f) => !relative(root, f).replace(/\\/g, '/').includes(EXCLUDE))
const tokenSet = new Set(tokenFiles)
```

Reemplazar el bloque de recolección (líneas 50-60) por:

```js
const violations = []
const layoutViolations = []
for (const file of allFiles) {
  let content
  try { content = readFileSync(file, 'utf8') } catch { continue }
  const revisarTokens = tokenSet.has(file)
  content.split('\n').forEach((line, i) => {
    if (revisarTokens) {
      for (const rule of RULES) {
        const m = rule.re.exec(line)
        if (m) violations.push({ file: relative(root, file), line: i + 1, cls: m[0], hint: rule.hint })
      }
    }
    const flex = FLEX_CHILD.exec(line)
    if (flex && line.includes('truncate') && !line.includes('min-w-0')) {
      layoutViolations.push({
        file: relative(root, file),
        line: i + 1,
        cls: `${flex[0]} + truncate`,
        hint: LAYOUT_HINT,
      })
    }
  })
}
```

Reemplazar el bloque de reporte (líneas 62-71) por:

```js
if (violations.length) {
  console.error('✗ Clases Tailwind neutrales hardcodeadas (usá tokens semánticos de Nuxt UI):')
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  «${v.cls}»  → ${v.hint}`)
  }
  console.error('\nExcepción única: colores financieros en app/components/caja/.')
}

if (layoutViolations.length) {
  console.error('✗ Hijo flex que trunca sin min-w-0 (el texto desborda en vez de cortarse):')
  for (const v of layoutViolations) {
    console.error(`  ${v.file}:${v.line}  «${v.cls}»  → ${v.hint}`)
  }
}

if (violations.length || layoutViolations.length) process.exit(1)

console.log(`✓ Design tokens (${tokenFiles.length} .vue) y layout flex (${allFiles.length} .vue) OK.`)
process.exit(0)
```

Los dos conteos son distintos a propósito y el mensaje lo muestra: los tokens saltean
`app/components/caja/`, el layout no.

- [ ] **Step 2: Correr y verificar que detecta exactamente un caso**

Run: `cd frontend && npm run design:check`
Expected: **FAIL** con exactamente una línea de layout:
`app/pages/select-tenant.vue:84  «flex-1 + truncate»`

Si aparece más de un archivo, la regla está mal escrita: **detenerse y reportarlo** en vez de
corregir los otros archivos, que están fuera de alcance.

- [ ] **Step 3: Arreglar `select-tenant.vue`**

En `frontend/app/pages/select-tenant.vue` línea 84, cambiar:

```vue
          <span class="font-medium text-default text-sm flex-1 truncate">
```

por:

```vue
          <span class="min-w-0 font-medium text-default text-sm flex-1 truncate">
```

- [ ] **Step 4: Correr y verificar verde**

Run: `cd frontend && npm run design:check`
Expected: PASS — `✓ Design tokens (113 .vue) y layout flex (126 .vue) OK.`

Los conteos son los reales de hoy: `design:check` revisa 113 archivos para tokens porque
excluye `app/components/caja/`, y el repo tiene 126 `.vue` en total.

- [ ] **Step 5: Corregir el mensaje del pre-commit**

En `.githooks/pre-commit` línea 73, cambiar:

```sh
    red "✗ Clases Tailwind neutrales hardcodeadas en .vue staged (ver arriba)."
```

por:

```sh
    red "✗ Tokens de diseño o layout flex en .vue staged (ver arriba)."
```

El guard ahora corre dos chequeos y el mensaje viejo describiría mal la mitad de los casos.

- [ ] **Step 6: Verificar que el pre-commit bloquea de verdad**

Reintroducir el bug en `select-tenant.vue:84` (sacar el `min-w-0`), stagearlo, e intentar
commitear:

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/app/pages/select-tenant.vue
git commit -m "prueba que debe ser bloqueada"
```

Expected: el commit **falla** con el mensaje de layout. Después restaurar el `min-w-0`.

- [ ] **Step 7: Mudar la entrada de pendientes a resueltos**

Sacar de `docs/agent/pendientes.md` la entrada que empieza
`- [ ] **`select-tenant.vue` tiene el mismo bug de truncado que se corrigió acá**` (líneas
536-540, cinco líneas más su línea en blanco).

Agregar en `docs/agent/resueltos.md`, bajo la sección `## Limpiezas menores`:

```markdown
- [x] ~~**`select-tenant.vue` tiene el mismo bug de truncado que se corrigió acá**~~ —
  cerrado 2026-07-29: `pages/select-tenant.vue:84` tenía `flex-1 truncate` sin `min-w-0`, el
  mismo defecto que `31893f7` arregló en `AdvertenciasPrecio.vue`. Se agregó el `min-w-0`.
  Lo que cambia respecto de un fix suelto es que **ahora lo caza un gate**:
  `scripts/check-design-tokens.mjs` chequea el elemento que es hijo flex (`flex-1`,
  `flex-auto`, `basis-*`) **y** trunca en sí mismo, sin `min-w-0`.
  La regla intuitiva —"todo `truncate` necesita `min-w-0`"— es falsa en este repo: 28 de los
  29 usos no lo tienen y están bien, porque el patrón correcto es `min-w-0` en el wrapper y
  `truncate` en el descendiente. La regla acotada da un solo hit en los 126 `.vue`, que era
  justamente este bug. Corre en `design:check` (CI) y en el pre-commit sobre `.vue` staged.
```

- [ ] **Step 8: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/scripts/check-design-tokens.mjs frontend/app/pages/select-tenant.vue \
        .githooks/pre-commit docs/agent/pendientes.md docs/agent/resueltos.md
git commit -m "$(cat <<'EOF'
feat(frontend): el gate caza el truncado roto en hijos flex

Un elemento que es hijo flex y trunca en sí mismo necesita min-w-0: los
ítems flex tienen min-width:auto y sin eso truncate no corta nunca. Pasó
dos veces —AdvertenciasPrecio (31893f7) y select-tenant.vue:84, abierto
en pendientes— y ninguna la vio build, typecheck ni las revisiones.

La regla intuitiva "todo truncate necesita min-w-0" es falsa acá: 28 de
29 usos no lo tienen y están bien, porque el min-w-0 va en el wrapper y
el truncate en el descendiente. La regla acotada al mismo elemento da un
solo hit en los 126 .vue: el bug abierto, que se corrige en este commit.

Va dentro de check-design-tokens.mjs en vez de un script nuevo: ese
archivo ya camina app/**/*.vue, ya tiene modo --staged, ya está en el
pre-commit y ya corre en CI. El mensaje del guard 4 se ajusta porque
ahora cubre dos chequeos.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Documentar el patrón y cerrar

**Files:**
- Modify: `docs/patterns/frontend.md` (agregar sección 15 al final, después de la línea 407)

**Interfaces:**
- Consumes: la decisión de montaje de la Tarea 1 y los hallazgos de las Tareas 2 y 3
  (conflictos de Pinia, si `AppDrawer` montó o no).
- Produces: nada.

Esta es la tarea que convierte tres specs sueltos en el default para lo que venga.

- [ ] **Step 1: Escribir la sección**

Agregar al final de `docs/patterns/frontend.md`:

```markdown

---

## 15. Tests de render de componentes

Los helpers puros van a composables y se testean ahí (§10). Lo que **no** se puede extraer
—qué renderiza el template, qué llega por props, qué sale por eventos— se cubre montando el
componente.

Spec al lado del fuente: `app/components/Foo.spec.ts` junto a `app/components/Foo.vue`.
Corre con `npm test`, que ya está en CI.

**Cómo se monta:** <COMPLETAR con la decisión de la Tarea 1 y la evidencia que la sostiene:
qué resuelve los auto-imports de Nuxt UI, si un tag mal escrito hace fallar el test o lo
caza `vue-tsc`, y qué costo tiene. Si quedó `mountSuspended`, anotar que el docblock
`// @vitest-environment nuxt` va en la primera línea y que las specs puras siguen en
happy-dom.>

**Qué afirma un test de render:**

- lo que ve el usuario: texto renderizado, cuántos elementos aparecen;
- el caso vacío — que **no renderice nada**;
- `aria-label` y texto accesible;
- eventos emitidos;
- **fallthrough de atributos**: que la `class` que pasa el padre aterrice en el root. Un
  componente cuyo único nodo raíz es un `v-for` compila a `Fragment` y Vue **descarta el
  `class` en silencio** — ese bug es invisible para build, typecheck y lint.

**Qué NO afirma:**

- **clases de estilo** (`text-warning`, `truncate`, `size-3.5`). Es afirmar la
  implementación, y happy-dom no calcula layout, así que el assert no valida nada. El
  truncado roto en hijos flex lo cubre `scripts/check-design-tokens.mjs`;
- **snapshots**. Congelan markup y se aprueban a ciegas cuando cambian.

**Un test no cuenta hasta fallar contra su estado previo o su mutación.** Romper la línea
nueva solo prueba que el test la toca; hay que revertir al comportamiento anterior y ver el
rojo. Si un mutante deja todo en verde, eso **es** el hallazgo: ese código no está cubierto.

**Store de Pinia:** `setActivePinia(createPinia())` en un `beforeEach` y sembrar con el
método de hidratación del store —`useMonedasStore().hydrate(list, tenantId)`—, que es el
patrón de `app/stores/monedas.spec.ts`. Sin `@pinia/testing`.

**Límites conocidos:** <COMPLETAR con lo que salió de las Tareas 2 y 3 — p. ej. si
`AppDrawer` no monta porque `UDrawer` teletransporta su contenido, dejarlo escrito acá para
que nadie lo vuelva a intentar a ciegas.>
```

- [ ] **Step 2: Correr el gate completo del frontend**

```bash
cd /Users/m2pro/cmatheus/startup-app/frontend
npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Expected: los cuatro en verde. `npm test` con **más de 275 tests** (los nuevos) en más de
24 archivos.

- [ ] **Step 3: Correr el gate completo del proyecto**

La checklist de cierre de `CLAUDE.md` no es condicional —"ejecutar, no afirmar"— aunque
esta entrega no toque `backend/`. Requiere `docker-compose up` corriendo.

```bash
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd /Users/m2pro/cmatheus/startup-app/backend
npm run lint:check && npm run typecheck && npm test && npm run test:e2e
```

Expected: los cuatro en verde. Referencia de la última corrida conocida: 1074/1074
unitarios, e2e 169 passed + 2 skipped (sandbox de Transbank, preexistente).

`reset-db.sh` va **inmediatamente antes** de `test:e2e`, sin nada en el medio.

Confirmar además que el alcance no se desbordó:

```bash
cd /Users/m2pro/cmatheus/startup-app
git status --short
```

Expected: nada sin commitear, y ningún archivo de `backend/` en el diff de la entrega
(`git diff --stat <commit-previo-a-la-tarea-1>..HEAD`).

- [ ] **Step 4: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add docs/patterns/frontend.md
git commit -m "$(cat <<'EOF'
docs(patterns): sección 15 — tests de render de componentes

Qué se monta y cómo, qué afirma un test de render y qué no (nada de
clases de estilo ni snapshots), y la regla de que un test no cuenta hasta
fallar contra su estado previo. Deja escrito el límite de la capa: happy-dom
no calcula layout, así que el truncado lo cubre check-design-tokens.mjs.

Es lo que convierte tres specs sueltos en el default para lo que venga.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Lo que esta entrega deja abierto

Para que el cierre no se lea como más de lo que es:

- **El layout sigue sin verificación automática.** happy-dom no mide anchos. El chequeo de
  la Tarea 4 cubre *una* forma conocida del bug por inspección de texto; un `truncate` que no
  trunca por otra razón sigue necesitando ojos. Eso es la Entrega B (Playwright en CI), que
  tiene su propio spec por escribir.
- **12 de los 15 componentes compartidos siguen sin test**, y las 111 vistas restantes
  también. La apuesta es que el patrón documentado haga que lo nuevo nazca cubierto.
- **El cruce de índices `resultado`/`lineas`** sigue diferido en `pendientes.md`. Con esta
  capa construida pasa a ser testeable, que es precondición para arreglarlo bien.
