# Detalle de "Mi caja" — layout por foco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar la página `mi-caja/[id].vue` para que el layout se enfoque según el estado de la caja (abierta → operar; en_conciliacion → finalizar; cerrada → auditar el resultado), en vez de un molde único apilado.

**Architecture:** La página ramifica por `estado`: la caja abierta usa `CajaActivaDashboard` (trabajo); los estados de cierre (`en_conciliacion`/`cerrada`) usan un nuevo `CajaCierreDetalle` que pone el arqueo de protagonista, agrega una tira de resultado (`CajaCierreResumen`) y colapsa los movimientos. Cambio **solo de frontend**.

**Tech Stack:** Nuxt 4 + Vue 3 + Pinia + Nuxt UI v4, Decimal.js. Sin backend.

**Spec:** `docs/superpowers/specs/2026-07-25-mi-caja-detalle-por-foco-design.md`

## Global Constraints

- **Solo frontend.** No tocar backend, motor de arqueo/cierre, máquina de estados ni la lógica de modo ciego (solo se respeta el `ciego` que ya expone el backend).
- **Design System:** tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado. **Excepción:** colores financieros hardcodeados (`text-green-600`, `text-red-600`, `bg-blue-50`, etc.) **permitidos solo en el módulo Caja**. `design:check` lo enforce.
- **No inventar datos.** "Quién contó/cerró" no se muestra (no existe `cerrada_por`). El nombre de usuario del turno no está en la interfaz `Caja` del store → el header muestra **cajón · apertura**, no usuario.
- **Página thin:** `mi-caja/[id].vue` solo ramifica y pasa props; sin lógica de negocio.
- **Dinero con Decimal.js**; presentación vía `useFormatters().formatMonto` (acepta `string | Decimal`).
- Frontend usa `$fetch`/`useApiFetch`, nunca axios (no aplica acá — no hay fetch nuevo).
- **Antes de escribir Vue, invocar el skill `nuxt-ui`** (convención del proyecto) y verificar la API exacta de los componentes usados (`UCollapsible`/`UAlert`).

## File Structure

- `frontend/app/components/caja/CajaMovimientosTable.vue` — prop `colapsable` + conteo desde `meta.total` (autocontenido).
- `frontend/app/components/caja/CajaTurnoHeader.vue` — título cajón·apertura; acciones solo en abierta.
- `frontend/app/components/caja/CajaTurnoResumen.vue` — jerarquía: Saldo esperado destacado.
- `frontend/app/components/caja/CajaCierreResumen.vue` — **NUEVO** — tira de resultado del cierre.
- `frontend/app/components/caja/CajaCierreDetalle.vue` — **NUEVO** — composición de la vista de cierre.
- `frontend/app/components/caja/CajaActivaDashboard.vue` — se acota a la caja abierta.
- `frontend/app/pages/mi-caja/[id].vue` — ramifica por estado; carga arqueo también en `en_conciliacion`.

---

### Task 1: `CajaMovimientosTable` — prop `colapsable` + conteo autocontenido

**Files:**
- Modify: `frontend/app/components/caja/CajaMovimientosTable.vue`

**Interfaces:**
- Produces: `<CajaMovimientosTable :caja-id="string" :colapsable="boolean" />`. Con `colapsable` (default `false`) la tabla se renderiza colapsada por defecto, con el header como disparador. El conteo `(N)` sale de `meta.total` (no de `resumenTurno`, que puede ser de otra caja en la vista de cierre).

- [ ] **Step 1: Agregar el prop `colapsable` y el estado de apertura**

En `CajaMovimientosTable.vue`, reemplazar `const props = defineProps<{ cajaId: string }>()` por:

```ts
const props = defineProps<{ cajaId: string, colapsable?: boolean }>()

// En modo colapsable arranca cerrado; sin colapsar, siempre visible.
const abierto = ref(false)
```

- [ ] **Step 2: Conteo desde `meta.total` + chevron disparador en el header**

Reemplazar el `<template #header>` completo por:

```vue
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <UButton
            v-if="colapsable"
            :icon="abierto ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            variant="ghost"
            color="neutral"
            size="xs"
            square
            :aria-label="abierto ? 'Colapsar movimientos' : 'Expandir movimientos'"
            @click="abierto = !abierto"
          />
          <h3 class="text-sm font-semibold text-default">
            Movimientos del turno
            <span class="text-muted font-normal">({{ meta.total }})</span>
          </h3>
        </div>
        <div class="flex items-center gap-2">
          <USelect
            v-model="filtroTipo"
            :items="tipoOptions"
            placeholder="Tipo"
            class="w-36"
          />
          <UButton
            v-if="hayFiltrosActivos"
            label="Limpiar"
            icon="i-lucide-x"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="limpiarFiltros"
          />
        </div>
      </div>
    </template>
```

- [ ] **Step 3: Envolver el cuerpo con `v-show` para conservar el conteo**

El cuerpo (loading + tabla + paginación) se muestra siempre si no es colapsable, o según `abierto`. Se usa `v-show` (no `UCollapsible`) a propósito: mantiene la tabla montada, así `meta.total` (el conteo del header) queda disponible aunque esté colapsada, sin re-fetch al expandir.

Reemplazar todo el cuerpo entre el `</template>` del `#header` y el `</UCard>` — es decir, el `<div v-if="loading">` y el `<template v-else>` — por esta versión envuelta en un `<div v-show>` (el contenido interno no cambia; solo se agrega el wrapper):

```vue
    <div v-show="!colapsable || abierto">
      <div v-if="loading" class="py-8 text-center text-sm text-muted">
        <UIcon name="i-lucide-loader" class="w-5 h-5 animate-spin mx-auto mb-1" />
        Cargando movimientos…
      </div>

      <template v-else>
        <UTable
          :data="movimientos"
          :columns="columns"
          :ui="{
            root: 'max-h-[min(480px,60vh)] overflow-y-auto',
            thead: 'sticky top-0 z-10 bg-default',
          }"
        >
          <template #fecha-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatFecha(row.original.fecha) }}</span>
          </template>
          <template #tipo-cell="{ row }">
            <UBadge
              :color="row.original.tipo === 'entrada' ? 'success' : 'error'"
              variant="subtle"
              size="sm"
              :label="row.original.tipo === 'entrada' ? 'Entrada' : 'Salida'"
            />
          </template>
          <template #concepto-cell="{ row }">
            <div class="min-w-0">
              <p class="truncate">{{ row.original.concepto }}</p>
              <NuxtLink
                v-if="row.original.ventaId"
                :to="{ path: '/ventas', query: { venta: row.original.ventaId } }"
                class="text-xs text-highlighted hover:underline"
              >
                Ver venta
              </NuxtLink>
            </div>
          </template>
          <template #referencia-cell="{ row }">
            <span class="text-muted">{{ row.original.referencia ?? '—' }}</span>
          </template>
          <template #monto-cell="{ row }">
            <span
              class="font-mono font-semibold"
              :class="row.original.tipo === 'entrada'
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'"
            >
              {{ row.original.tipo === 'entrada' ? '+' : '-' }}
              {{ formatMonto(row.original.monto) }}
            </span>
          </template>
          <template #empty>
            <div class="py-10 text-center text-sm text-muted">
              <UIcon name="i-lucide-inbox" class="w-8 h-8 mx-auto mb-2 opacity-40" />
              {{ hayFiltrosActivos
                ? 'Ningún movimiento coincide con los filtros.'
                : 'Sin movimientos registrados en este turno.' }}
            </div>
          </template>
        </UTable>

        <div v-if="meta.total > pageSize" class="flex justify-end pt-4">
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="meta.total"
          />
        </div>
      </template>
    </div>
```

- [ ] **Step 4: Verificar typecheck y build**

Run: `docker compose exec -T frontend sh -lc "npm run typecheck:ratchet && npm run build"`
Expected: sin errores nuevos de tipo; build OK. El uso actual (sin `colapsable`) queda visible como hoy.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/caja/CajaMovimientosTable.vue
git commit -m "feat(caja): CajaMovimientosTable colapsable + conteo autocontenido (meta.total)"
```

---

### Task 2: `CajaTurnoHeader` — título cajón·apertura, acciones solo en abierta

**Files:**
- Modify: `frontend/app/components/caja/CajaTurnoHeader.vue`

**Interfaces:**
- Consumes: `caja` ahora incluye `cajonNombre?: string | null`.
- Produces: header con título = `cajonNombre` (fallback "Caja") + badge + apertura; acciones `+ Movimiento` / `Cerrar caja` **solo** cuando `estado === 'abierta' && !readonly`. Emite `movimiento` y `cerrar`. "Continuar conciliación" se elimina de acá (pasa al banner de `CajaCierreDetalle`).

- [ ] **Step 1: Ampliar el prop `caja` y quitar el computed `enConciliacion`**

Reemplazar el `<script setup>` completo por:

```vue
<script setup lang="ts">
const props = defineProps<{
  caja: {
    estado: string
    fechaApertura: string
    cajonNombre?: string | null
  }
  readonly?: boolean
  historialUrl?: string
  historialLabel?: string
}>()

const emit = defineEmits<{
  movimiento: []
  cerrar: []
}>()

const { formatFecha } = useFormatters()

const badgeColor = computed(() => {
  if (props.caja.estado === 'abierta') return 'success'
  if (props.caja.estado === 'en_conciliacion') return 'warning'
  return 'neutral'
})

// Las acciones de operación solo existen para la caja abierta propia.
const puedeOperar = computed(
  () => props.caja.estado === 'abierta' && !props.readonly,
)
</script>
```

- [ ] **Step 2: Título por cajón y acciones acotadas a abierta**

Reemplazar el `<template>` completo por:

```vue
<template>
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <div class="flex items-center gap-2">
        <h2 class="text-base font-semibold text-default">
          {{ caja.cajonNombre ?? 'Caja' }}
        </h2>
        <UBadge :color="badgeColor" variant="soft">
          {{ caja.estado.toUpperCase() }}
        </UBadge>
      </div>
      <p class="text-sm text-muted mt-0.5">
        Apertura: {{ formatFecha(caja.fechaApertura) }}
      </p>
    </div>
    <div v-if="historialUrl || puedeOperar" class="flex flex-wrap justify-end gap-2">
      <UButton
        v-if="historialUrl"
        :to="historialUrl"
        icon="i-lucide-history"
        color="neutral"
        variant="outline"
        :label="historialLabel ?? 'Ver historial'"
      />
      <template v-if="puedeOperar">
        <UButton
          icon="i-lucide-circle-plus"
          color="neutral"
          variant="outline"
          @click="emit('movimiento')"
        >
          + Movimiento
        </UButton>
        <UButton
          icon="i-lucide-lock"
          color="error"
          variant="soft"
          @click="emit('cerrar')"
        >
          Cerrar caja
        </UButton>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Verificar typecheck, design y build**

Run: `docker compose exec -T frontend sh -lc "npm run typecheck:ratchet && npm run design:check && npm run build"`
Expected: sin errores. (El caller `CajaActivaDashboard` pasará `cajonNombre` en Task 6; el prop es opcional, así que compila igual.)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/caja/CajaTurnoHeader.vue
git commit -m "feat(caja): header muestra cajón·apertura y acota acciones a la caja abierta"
```

---

### Task 3: `CajaTurnoResumen` — destacar Saldo esperado

**Files:**
- Modify: `frontend/app/components/caja/CajaTurnoResumen.vue`

**Interfaces:**
- Consumes/Produces: mismos props (`saldoInicial: string`, `totalEntradas/totalSalidas/saldoEsperado: Decimal`, `ciego?`, `loading?`). Cambia solo el layout: en no-ciego, **Saldo esperado** es el bloque principal (número grande) y `Saldo inicial / Entradas / Salidas` van en una fila secundaria compacta. En ciego, solo `Saldo inicial` (como hoy).

- [ ] **Step 1: Reescribir el template con jerarquía**

Reemplazar el `<template>` completo por:

```vue
<template>
  <!-- Ciego: solo saldo inicial, el resto lo oculta el backend. -->
  <div v-if="ciego" class="rounded-lg bg-muted p-3 max-w-xs">
    <p class="text-xs text-muted uppercase tracking-wide">
      Saldo inicial
    </p>
    <p class="text-lg font-semibold text-default mt-1">
      {{ formatMonto(saldoInicial) }}
    </p>
  </div>

  <div v-else class="grid gap-4 sm:grid-cols-3">
    <!-- Protagonista: saldo esperado. -->
    <div class="sm:col-span-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4">
      <p class="text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wide">
        Saldo esperado
      </p>
      <p class="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">
        <template v-if="loading">
          —
        </template>
        <template v-else>
          {{ formatMonto(saldoEsperado) }}
        </template>
      </p>
    </div>

    <!-- Secundarias: inicial / entradas / salidas. -->
    <div class="sm:col-span-2 grid grid-cols-3 gap-3">
      <div class="rounded-lg bg-muted p-3">
        <p class="text-xs text-muted uppercase tracking-wide">
          Saldo inicial
        </p>
        <p class="text-base font-semibold text-default mt-1">
          {{ formatMonto(saldoInicial) }}
        </p>
      </div>
      <div class="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
        <p class="text-xs text-green-600 dark:text-green-400 uppercase tracking-wide">
          Entradas
        </p>
        <p class="text-base font-semibold text-green-700 dark:text-green-300 mt-1">
          <template v-if="loading">
            —
          </template>
          <template v-else>
            + {{ formatMonto(totalEntradas) }}
          </template>
        </p>
      </div>
      <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
        <p class="text-xs text-red-600 dark:text-red-400 uppercase tracking-wide">
          Salidas
        </p>
        <p class="text-base font-semibold text-red-700 dark:text-red-300 mt-1">
          <template v-if="loading">
            —
          </template>
          <template v-else>
            - {{ formatMonto(totalSalidas) }}
          </template>
        </p>
      </div>
    </div>
  </div>
</template>
```

El `<script setup>` no cambia (mismos props + `formatMonto`).

- [ ] **Step 2: Verificar typecheck, design y build**

Run: `docker compose exec -T frontend sh -lc "npm run typecheck:ratchet && npm run design:check && npm run build"`
Expected: sin errores. `design:check` permite los colores financieros en Caja.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/caja/CajaTurnoResumen.vue
git commit -m "feat(caja): resumen del turno destaca el Saldo esperado sobre el resto"
```

---

### Task 4: `CajaCierreResumen` (NUEVO) — tira de resultado del cierre

**Files:**
- Create: `frontend/app/components/caja/CajaCierreResumen.vue`

**Interfaces:**
- Produces: `<CajaCierreResumen :arqueo="ArqueoLinea[]" :caja="Caja" />`. Deriva la diferencia total (Σ `linea.diferencia` con Decimal). Muestra "Cuadró" si es 0, o "Diferencia −$X" (color financiero) si no; más cajón y hora de cierre (los que existan).

- [ ] **Step 1: Crear el componente**

Crear `frontend/app/components/caja/CajaCierreResumen.vue`:

```vue
<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ArqueoLinea, Caja } from '~/stores/caja'

const props = defineProps<{
  arqueo: ArqueoLinea[]
  caja: Caja
}>()

const { formatMonto, formatFecha } = useFormatters()

const diferenciaTotal = computed(() =>
  props.arqueo.reduce(
    (acc, l) => (l.diferencia != null ? acc.plus(l.diferencia) : acc),
    new Decimal(0),
  ),
)

const cuadro = computed(() => diferenciaTotal.value.isZero())
</script>

<template>
  <div class="rounded-lg border border-default p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
    <div class="flex items-center gap-2">
      <UIcon
        :name="cuadro ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
        class="w-5 h-5"
        :class="cuadro ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
      />
      <span
        class="font-semibold"
        :class="cuadro ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'"
      >
        <template v-if="cuadro">
          Cuadró
        </template>
        <template v-else>
          Diferencia {{ formatMonto(diferenciaTotal) }}
        </template>
      </span>
    </div>
    <span v-if="caja.cajonNombre" class="text-sm text-muted">
      Cajón {{ caja.cajonNombre }}
    </span>
    <span v-if="caja.fechaCierre" class="text-sm text-muted">
      Cerrada {{ formatFecha(caja.fechaCierre) }}
    </span>
  </div>
</template>
```

- [ ] **Step 2: Verificar typecheck, design y build**

Run: `docker compose exec -T frontend sh -lc "npm run typecheck:ratchet && npm run design:check && npm run build"`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/caja/CajaCierreResumen.vue
git commit -m "feat(caja): CajaCierreResumen — tira de resultado (cuadró/diferencia) del cierre"
```

---

### Task 5: `CajaCierreDetalle` (NUEVO) — composición de la vista de cierre

**Files:**
- Create: `frontend/app/components/caja/CajaCierreDetalle.vue`

**Interfaces:**
- Consumes: `CajaTurnoHeader` (Task 2), `CajaCierreResumen` (Task 4), `CajaArqueoTable` (existente), `CajaMovimientosTable` con `colapsable` (Task 1), `CajaCierreDrawer` (existente, `resumir` para fase 2).
- Produces: `<CajaCierreDetalle :caja="Caja" :arqueo="ArqueoLinea[]" :readonly="boolean" :historial-url="string" />`. En `en_conciliacion` (no readonly) muestra un banner con el CTA que abre el drawer de fase 2.

- [ ] **Step 1: Crear el componente**

Crear `frontend/app/components/caja/CajaCierreDetalle.vue`. **Antes, invocar el skill `nuxt-ui`** para confirmar la API de `UAlert` (prop `title`, slot de acciones):

```vue
<script setup lang="ts">
import type { ArqueoLinea, Caja } from '~/stores/caja'

const props = defineProps<{
  caja: Caja
  arqueo: ArqueoLinea[]
  readonly?: boolean
  historialUrl?: string
}>()

const perms = usePermissionsStore()
const cierreDrawerOpen = ref(false)

const enConciliacion = computed(() => props.caja.estado === 'en_conciliacion')
const puedeFinalizar = computed(() => enConciliacion.value && !props.readonly)
</script>

<template>
  <div class="w-full space-y-6">
    <UCard class="w-full">
      <template #header>
        <CajaTurnoHeader
          :caja="caja"
          :readonly="readonly"
          :historial-url="historialUrl"
        />
      </template>

      <div class="space-y-4">
        <UAlert
          v-if="puedeFinalizar"
          color="warning"
          variant="soft"
          icon="i-lucide-scale"
          title="En conciliación — falta finalizar el cierre"
        >
          <template #actions>
            <UButton
              color="warning"
              variant="solid"
              size="sm"
              @click="cierreDrawerOpen = true"
            >
              Continuar conciliación
            </UButton>
          </template>
        </UAlert>

        <CajaCierreResumen :arqueo="arqueo" :caja="caja" />
      </div>
    </UCard>

    <UCard class="w-full">
      <template #header>
        <h3 class="text-sm font-semibold text-default">
          Arqueo del cierre
        </h3>
      </template>
      <CajaArqueoTable
        :lineas="arqueo"
        :puede-justificar="perms.esAdmin"
        :caja-id="caja.id"
      />
    </UCard>

    <CajaMovimientosTable :caja-id="caja.id" colapsable />

    <CajaCierreDrawer
      v-if="puedeFinalizar"
      v-model:open="cierreDrawerOpen"
      :caja-id="caja.id"
      resumir
    />
  </div>
</template>
```

- [ ] **Step 2: Verificar typecheck, design y build**

Run: `docker compose exec -T frontend sh -lc "npm run typecheck:ratchet && npm run design:check && npm run build"`
Expected: sin errores. Si `UAlert` no tiene slot `#actions` en esta versión, usar el prop `:actions="[...]"` o poner el botón como contenido por defecto del slot — resolver con lo que confirme el skill `nuxt-ui`, sin inventar API.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/caja/CajaCierreDetalle.vue
git commit -m "feat(caja): CajaCierreDetalle — vista de cierre con arqueo protagonista + movimientos colapsados"
```

---

### Task 6: Acotar `CajaActivaDashboard` a la caja abierta + ramificar la página

**Files:**
- Modify: `frontend/app/components/caja/CajaActivaDashboard.vue`
- Modify: `frontend/app/pages/mi-caja/[id].vue`

**Interfaces:**
- Consumes: `CajaCierreDetalle` (Task 5), `CajaActivaDashboard` (abierta).
- Produces: la página `mi-caja/[id].vue` renderiza `CajaActivaDashboard` si `estado === 'abierta'`, si no `CajaCierreDetalle`; carga el arqueo también en `en_conciliacion`.

- [ ] **Step 1: `CajaActivaDashboard` — pasar `cajonNombre` y quitar el modo conciliación**

En `CajaActivaDashboard.vue`, ampliar el prop `caja` para incluir `cajonNombre` (así el header lo muestra). Reemplazar el `defineProps`:

```ts
const props = defineProps<{
  caja: {
    id: string
    estado: string
    saldoInicial: string
    fechaApertura: string
    cajonNombre?: string | null
  }
  readonly?: boolean
  historialUrl?: string
  historialLabel?: string
}>()
```

En el template, el `CajaCierreDrawer` deja de resumir (el dashboard solo opera la caja abierta → fase 1). Reemplazar:

```vue
      <CajaCierreDrawer
        v-model:open="cierreDrawerOpen"
        :caja-id="caja.id"
        :resumir="caja.estado === 'en_conciliacion'"
      />
```

por:

```vue
      <CajaCierreDrawer
        v-model:open="cierreDrawerOpen"
        :caja-id="caja.id"
      />
```

- [ ] **Step 2: Página — cargar arqueo en `en_conciliacion`**

En `frontend/app/pages/mi-caja/[id].vue`, reemplazar el bloque de carga:

```ts
    if (cajaStore.detalle.estado === 'cerrada') {
      await cajaStore.cargarArqueo(cajaId.value)
    }
```

por:

```ts
    if (
      cajaStore.detalle.estado === 'cerrada'
      || cajaStore.detalle.estado === 'en_conciliacion'
    ) {
      await cajaStore.cargarArqueo(cajaId.value)
    }
```

- [ ] **Step 3: Página — ramificar el body por estado**

Reemplazar el bloque `<div v-else-if="cajaStore.detalle" class="space-y-6">` … `</div>` (el que hoy renderiza `CajaActivaDashboard` + la `UCard` "Arqueo del cierre") por:

```vue
        <div v-else-if="cajaStore.detalle" class="space-y-6">
          <CajaActivaDashboard
            v-if="cajaStore.detalle.estado === 'abierta'"
            :caja="cajaStore.detalle"
            :readonly="readonly"
            historial-url="/mi-caja/historial"
          />
          <CajaCierreDetalle
            v-else
            :caja="cajaStore.detalle"
            :arqueo="cajaStore.arqueo"
            :readonly="readonly"
            historial-url="/mi-caja/historial"
          />
        </div>
```

(La `UCard` "Arqueo del cierre" desaparece de la página: ahora vive dentro de `CajaCierreDetalle`.)

- [ ] **Step 4: Verificar typecheck, design y build**

Run: `docker compose exec -T frontend sh -lc "npm run typecheck:ratchet && npm run design:check && npm run build"`
Expected: sin errores; build OK.

- [ ] **Step 5: Smoke de navegador (las tres vistas)**

Con el stack corriendo, login `admin.paris@paris.cl` / `admin`:
1. **Abierta:** abrir una caja. El header muestra el **nombre del cajón** (no "Caja") + apertura; el **Saldo esperado** se ve destacado (número grande) y inicial/entradas/salidas secundarios; la tabla de movimientos está **visible**; botones `+ Movimiento` y `Cerrar caja`.
2. Registrar una salida → el conteo del header de movimientos incrementa; el esperado baja.
3. **En conciliación:** enviar un conteo con descuadre. La vista cambia: **banner** "En conciliación — falta finalizar" con CTA que abre el drawer de fase 2; **tira de resultado** con la diferencia; **arqueo** visible; **movimientos colapsados** (se despliegan con el chevron). Finalizar con motivo desde el drawer.
4. **Cerrada (desde historial):** abrir una caja cerrada. Tira "✓ Cuadró" (o "Diferencia −$X"); **sin** tarjetas de operación; arqueo protagonista; movimientos colapsados; si sos admin, el override del arqueo sigue disponible.
5. **Ciego (cajero):** con `arqueo_ciego` on y un cajero, la caja abierta muestra solo "Saldo inicial" y sin movimientos (sin regresión).
6. Consola del navegador sin errores.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/caja/CajaActivaDashboard.vue frontend/app/pages/mi-caja/[id].vue
git commit -m "feat(caja): mi-caja ramifica el detalle por estado (trabajo vs cierre)"
```

---

## Verificación de cierre

```bash
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Todo verde, más el smoke de navegador de las tres vistas (Task 6, paso 5) — el render de `.vue` no lo cubre ningún unit test. Backend sin cambios: no aplica su gate (igual CI lo corre entero al pushear).
