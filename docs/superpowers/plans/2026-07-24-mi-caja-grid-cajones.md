# `/mi-caja` grid de cajones disponibles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el formulario único de apertura en `/mi-caja` por un grid de cards de cajones disponibles; al clickear una card se abre un drawer que pide saldo inicial + comentario y abre la caja sobre ese cajón.

**Architecture:** Cambio 100% frontend. Un componente nuevo `CajaAperturaGrid.vue` (grid de cards + `AppDrawer`), análogo a `CajaAbiertasGrid.vue`, consume el store existente (`cajaStore.cargarCajonesDisponibles` / `cajaStore.cajonesDisponibles` / `cajaStore.abrir`). La página `mi-caja/index.vue` cambia un componente por otro. Nada de backend, store, ni `CajaAperturaForm` (que se sigue usando en el modal de `/cajas`).

**Tech Stack:** Nuxt 4 (Vue 3, `<script setup lang="ts">`), Nuxt UI v4 (`UCard`, `UForm`, `UInput`, `UButton`, `UIcon`), componentes propios `AppDrawer` y `MoneyInput`, Pinia store `useCajaStore`.

## Global Constraints

- **Design System:** solo tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado. Excepción documentada: colores financieros del módulo Caja. Reusar exactamente las clases del grid de `CajaAbiertasGrid.vue`.
- **Frontend:** `$fetch`/`useApiFetch` vía store, nunca axios. Lógica de presentación en el componente, la página no contiene lógica de negocio.
- **Archivos:** no crear helpers de un solo uso. El componente nuevo es la única unidad nueva.
- **Dinero:** el saldo se captura con `MoneyInput` (string) y se pasa tal cual a `cajaStore.abrir`; nunca convertir a `number` nativo.
- **Verificación de cierre:** gate frontend + smoke test de navegador del drawer (bugs de runtime del drawer no los ve build/typecheck).

---

## Referencia — contratos existentes (no modificar)

Copiados verbatim para que el implementador no tenga que abrir los archivos:

**Store `useCajaStore` (`app/stores/caja.ts`):**
- `cajaStore.cajonesDisponibles: { cajonId: string; nombre: string }[]` (ref reactiva).
- `cajaStore.cargarCajonesDisponibles(): Promise<void>` — llena `cajonesDisponibles`.
- `cajaStore.abrir(payload: { saldoInicial: string; comentario?: string; cajonId: string }): Promise<Caja>` — abre y setea `cajaStore.activa`. `Caja` tiene `id: string`.

**`AppDrawer` (`app/components/AppDrawer.vue`):**
- `v-model:open` (boolean), prop `width` (ej. `"40%"`), slots `#header`, `#body`, `#actions`.

**`MoneyInput` (`app/components/MoneyInput.vue`):**
- `v-model` (string) + prop booleano `oficial`.

**Clases del grid a reusar (de `CajaAbiertasGrid.vue`):**
- Contenedor grid: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`.
- Card clickeable: `cursor-pointer transition hover:ring-2 hover:ring-primary-500`.

**`CajaAperturaForm.vue`** — patrón de `abrir()` a replicar (validación + toast de error con fallback `e.data.message`).

---

## Task 1: Componente `CajaAperturaGrid.vue`

**Files:**
- Create: `frontend/app/components/caja/CajaAperturaGrid.vue`

**Interfaces:**
- Consumes: `cajaStore.cajonesDisponibles`, `cajaStore.cargarCajonesDisponibles()`, `cajaStore.abrir(...)` (firmas arriba). Auto-imports de Nuxt: `useCajaStore`, `useToast`, `ref`, `computed`, `watch`, `onMounted`. Componentes auto-importados: `AppDrawer`, `MoneyInput`.
- Produces: emite `opened: [cajaId: string]` — consumido por `mi-caja/index.vue` (Task 2).

- [ ] **Step 1: Crear el componente completo**

Crear `frontend/app/components/caja/CajaAperturaGrid.vue` con este contenido exacto:

```vue
<script setup lang="ts">
const emit = defineEmits<{ opened: [cajaId: string] }>()

const cajaStore = useCajaStore()
const toast = useToast()
const loadingCajones = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const seleccionado = ref<{ cajonId: string, nombre: string } | null>(null)

const form = ref({ saldoInicial: '', comentario: '' })

const sinCajones = computed(
  () => !loadingCajones.value && cajaStore.cajonesDisponibles.length === 0,
)

const drawerTitle = computed(() =>
  seleccionado.value ? `Abrir caja — ${seleccionado.value.nombre}` : 'Abrir caja',
)

onMounted(async () => {
  loadingCajones.value = true
  try {
    await cajaStore.cargarCajonesDisponibles()
  }
  catch {
    toast.add({ title: 'Error al cargar los cajones disponibles', color: 'error' })
  }
  finally {
    loadingCajones.value = false
  }
})

watch(drawerOpen, (open) => {
  if (!open) {
    seleccionado.value = null
    form.value = { saldoInicial: '', comentario: '' }
  }
})

function abrirDrawer(cajon: { cajonId: string, nombre: string }) {
  seleccionado.value = { cajonId: cajon.cajonId, nombre: cajon.nombre }
  form.value = { saldoInicial: '', comentario: '' }
  drawerOpen.value = true
}

async function abrir() {
  if (!seleccionado.value) return
  if (!form.value.saldoInicial) {
    toast.add({ title: 'Ingresa el saldo inicial', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const caja = await cajaStore.abrir({
      saldoInicial: form.value.saldoInicial,
      comentario: form.value.comentario || undefined,
      cajonId: seleccionado.value.cajonId,
    })
    toast.add({ title: 'Caja abierta correctamente', color: 'success' })
    drawerOpen.value = false
    emit('opened', caja.id)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al abrir la caja'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="w-full">
    <div v-if="loadingCajones" class="py-12 text-center text-sm text-muted">
      <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando cajones…
    </div>

    <p v-else-if="sinCajones" class="text-sm text-warning">
      No hay cajas disponibles para abrir. Pedí al administrador que te habilite una.
    </p>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard
        v-for="cajon in cajaStore.cajonesDisponibles"
        :key="cajon.cajonId"
        class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
        @click="abrirDrawer(cajon)"
      >
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-lock-open" class="w-5 h-5 text-primary-500" />
            <span class="font-semibold text-default truncate">{{ cajon.nombre }}</span>
          </div>
        </template>
        <p class="text-sm text-muted">
          Disponible. Hacé click para abrir tu caja en este cajón.
        </p>
      </UCard>
    </div>

    <AppDrawer v-model:open="drawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="caja-apertura-grid-form" :state="form" class="space-y-4" @submit="abrir">
          <UFormField label="Saldo inicial" required>
            <MoneyInput v-model="form.saldoInicial" oficial class="w-full" />
          </UFormField>

          <UFormField label="Comentario">
            <UInput
              v-model="form.comentario"
              placeholder="Observaciones del turno (opcional)"
              class="w-full"
            />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="caja-apertura-grid-form"
          icon="i-lucide-lock-open"
          :loading="saving"
        >
          Abrir caja
        </UButton>
      </template>
    </AppDrawer>
  </div>
</template>
```

- [ ] **Step 2: Typecheck del componente**

Run: `cd frontend && npm run typecheck:ratchet`
Expected: PASS (sin nuevos errores de `vue-tsc`; el ratchet no debe subir).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/caja/CajaAperturaGrid.vue
git commit -m "feat(mi-caja): componente CajaAperturaGrid (grid de cajones + drawer de apertura)"
```

---

## Task 2: Cablear el grid en `mi-caja/index.vue`

**Files:**
- Modify: `frontend/app/pages/mi-caja/index.vue`

**Interfaces:**
- Consumes: `<CajaAperturaGrid @opened="onOpened" />` de Task 1 (emit `opened: [cajaId: string]`). `onOpened` ya existe en la página y navega a `/mi-caja/[id]`.

- [ ] **Step 1: Reemplazar el componente en el template**

En `frontend/app/pages/mi-caja/index.vue`, dentro del bloque `<template v-else-if="!cajaStore.activa">`, cambiar la línea:

```vue
            <CajaAperturaForm @opened="onOpened" />
```

por:

```vue
            <CajaAperturaGrid @opened="onOpened" />
```

No tocar nada más del archivo (permisos, `onMounted`, watch de seguridad, link "Ver historial", loading, bloque "Redirigiendo…" quedan igual). `CajaAperturaForm` ya no se usa en esta página pero **no** se borra (lo usa `/cajas`).

- [ ] **Step 2: Verificar que no quedó referencia muerta**

Run: `cd frontend && grep -n "CajaAperturaForm\|CajaAperturaGrid" app/pages/mi-caja/index.vue`
Expected: solo aparece `CajaAperturaGrid`; `CajaAperturaForm` ya no aparece en este archivo.

- [ ] **Step 3: Build + typecheck**

Run: `cd frontend && npm run build && npm run typecheck:ratchet`
Expected: PASS ambos.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/mi-caja/index.vue
git commit -m "feat(mi-caja): usar CajaAperturaGrid en lugar del form único"
```

---

## Task 3: Docs + verificación de cierre

**Files:**
- Modify: `docs/features/gestion-cajas.md`
- Modify: `docs/ESTADO.md` (solo si hay una fila de Mi caja / cajas cuyo detalle de UX cambie; si no aplica, omitir)

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Nota de UX en `docs/features/gestion-cajas.md`**

Agregar una nota breve (1–2 frases) en la sección de apertura / Mi caja indicando: *"En `/mi-caja`, cuando el usuario no tiene caja abierta, se presenta un grid de cajones disponibles; al elegir uno se abre un drawer que pide el saldo inicial y un comentario opcional para abrir la caja sobre ese cajón."* Ajustar la redacción al estilo del doc.

- [ ] **Step 2: Design check**

Run: `cd frontend && npm run design:check`
Expected: PASS (sin tokens hardcodeados; se reusan clases del grid existente).

- [ ] **Step 3: Gate frontend completo**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: los tres PASS.

- [ ] **Step 4: Smoke test de navegador del drawer (obligatorio)**

Con el stack levantado (`docker-compose up`), en `http://localhost:5173/mi-caja` (usuario **sin** caja abierta y con cajones disponibles):
1. Se ve el grid de cards de cajones disponibles (no el form viejo).
2. Click en una card → abre el drawer con título `Abrir caja — {nombre del cajón}`.
3. Ingresar saldo inicial → *Abrir caja* → toast de éxito y redirección a `/mi-caja/[id]`.
4. (Caso vacío) Con un usuario sin cajones disponibles: se ve el mensaje *"No hay cajas disponibles para abrir…"* en lugar del grid.
5. Verificar consola del navegador sin errores (auto-import / runtime del drawer).

- [ ] **Step 5: Commit de docs**

```bash
git add docs/features/gestion-cajas.md
git commit -m "docs(caja): documentar grid de cajones + drawer de apertura en mi-caja"
```

---

## Notas de verificación

- Backend sin cambios → no hace falta correr `npm test` / `test:e2e` del backend para esta feature; el gate de CI igual los corre en cada push.
- Si el smoke test revela un bug de runtime del drawer (auto-import faltante, estado que no resetea, `form` que arrastra valores entre aperturas), corregir en Task 1 antes de dar por cerrada la feature.
