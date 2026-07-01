# Frontend Patterns — Playbook

**Status**: Living
**Last Updated**: 2026-06-30

Patrón de referencia para una pantalla de configuración en el frontend (Nuxt 4 +
Vue 3 + `@nuxt/ui` v4). Extraído del código real más reciente
(`app/pages/configuracion/razones-sociales.vue`). **Léelo antes de planificar una
feature** para no re-escanear: aquí está la página completa, el fetch con auth, el
update optimista con revert y la navegación.

> Convenciones transversales:
> - **Iconos: Lucide** — formato `i-lucide-{name}` (p. ej. `i-lucide-plus`). Colección
>   oficial del proyecto (Nuxt UI v4); ver `frontend/docs/DESIGN-SYSTEM.md` § Iconos.
> - **Llamadas API: `useApiFetch`** (`composables/useApiFetch.ts`), NO `$fetch`
>   directo ni axios. Inyecta el Bearer token y reintenta tras refresh en 401.
> - **Sin store** para las pantallas CRUD de config: estado local con `ref`/`reactive`.
> - **Update optimista con revert** para toggles/estrellas (no re-fetch).
> - Mensajes de error del backend vía `e.data.message`, mostrados en un `useToast`.
> - URL base: `useRuntimeConfig().public.apiUrl`.
> - **Campos decimales/monetarios → string de punta a punta** (ver §7): `UInput`
>   `inputmode="decimal"`, nunca `type="number"` (emite `number` y rompe `@IsNumberString`).
> - **Toda página suelta con `layout: 'dashboard'` lleva header** (ver §2): `UDashboardPanel`
>   con `#header` → `<AppNavbar title="…">` y `#body` → el contenido.

---

## 1. Navegación

Agregar el item al computed `navItems` de `app/pages/configuracion.vue` (dentro del
bloque `permissionsStore.esAdmin` si la pantalla es solo admin):

```typescript
{ label: 'Monedas', icon: 'i-lucide-dollar-sign', to: '/configuracion/monedas' }
```

---

## 2. Página — estructura `<script setup>`

`app/pages/configuracion/<feature>.vue`. Esqueleto:

```typescript
<script setup lang="ts">
interface Item { id: string; nombre: string; habilitado: boolean; preferida: boolean }

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const items = ref<Item[]>([])
const loading = ref(false)
const toggling = reactive(new Set<string>())   // tracking de filas en vuelo

async function cargar() {
  loading.value = true
  try {
    items.value = await useApiFetch<Item[]>(`${apiUrl}/<recurso>`)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar', color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(cargar)
</script>
```

> Nota: las páginas de `configuracion/` heredan `middleware`/`layout` del padre
> `configuracion.vue` (que ya provee el header vía `AppNavbar`), así que su
> `<template>` va directo al contenido sin `UDashboardPanel`.
>
> Para una página suelta (no anidada bajo `configuracion.vue`) usar
> `definePageMeta({ middleware: 'auth', layout: 'dashboard' })` **y** envolver el
> `<template>` en `UDashboardPanel` para que tenga header — el layout `dashboard.vue`
> solo aporta el sidebar, cada página es responsable de su propio header:
>
> ```vue
> <template>
>   <UDashboardPanel>
>     <template #header>
>       <AppNavbar title="Historial de ventas" />
>     </template>
>     <template #body>
>       <div class="max-w-5xl mx-auto py-6">
>         <!-- contenido -->
>       </div>
>     </template>
>   </UDashboardPanel>
> </template>
> ```
>
> `AppNavbar` (`app/components/AppNavbar.vue`) ya incluye el collapse del sidebar y
> el `UserMenu` en `#right` — no usar `UDashboardNavbar` directo ni duplicar el
> `UserMenu` a mano. Todas las páginas bajo `layout: 'dashboard'` deben seguir este
> esqueleto (ver `pages/index.vue`, `pages/ventas/index.vue`, `pages/caja/index.vue`).

---

## 3. Update optimista con revert (toggle)

Patrón `toggleHabilitado`: guardar en una variable el valor previo, mutar de
inmediato la UI, llamar la API, y en `catch` revertir. `toggling` evita doble click.

```typescript
async function toggleHabilitado(it: Item) {
  if (toggling.has(it.id)) return
  toggling.add(it.id)
  const prev = it.habilitado
  it.habilitado = !prev                          // optimista
  try {
    await useApiFetch(`${apiUrl}/<recurso>/${it.id}`, {
      method: 'PATCH',
      body: { habilitado: it.habilitado },
    })
    toast.add({ title: it.habilitado ? 'Habilitado' : 'Deshabilitado', color: 'success' })
  } catch (e: unknown) {
    it.habilitado = prev                         // revert
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al actualizar', color: 'error' })
  } finally {
    toggling.delete(it.id)
  }
}
```

---

## 4. Distintivo único "estrella" (default / preferida)

Patrón `togglePreferida`: la regla "solo uno" se refleja optimistamente limpiando
el anterior y marcando el nuevo; revertir ambos en `catch`. Validar precondición
(p. ej. debe estar habilitado) en cliente con un toast `warning`.

```typescript
async function togglePreferida(it: Item) {
  if (it.preferida || toggling.has(it.id)) return
  if (!it.habilitado) {
    toast.add({ title: 'Debes habilitar antes de marcarla como preferida', color: 'warning' })
    return
  }
  const prev = items.value.find(x => x.preferida)
  if (prev) prev.preferida = false
  it.preferida = true
  toggling.add(it.id)
  try {
    await useApiFetch(`${apiUrl}/<recurso>/${it.id}/preferida`, { method: 'PATCH' })
    toast.add({ title: 'Preferida actualizada', color: 'success' })
  } catch (e: unknown) {
    it.preferida = false
    if (prev) prev.preferida = true              // revert ambos
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error', color: 'error' })
  } finally {
    toggling.delete(it.id)
  }
}
```

---

## 5. Crear / editar / eliminar

- **Crear/editar**: un `UModal` con `v-model:open`, un `form = ref(emptyForm())`,
  `editingId = ref<string | null>(null)`. `guardar()` hace POST o PATCH según
  `editingId`, luego `await cargar()` (re-fetch tras mutación completa, no optimista).
- **Eliminar**: segundo `UModal` de confirmación con `confirmDeleteId` +
  `confirmModalOpen`; `eliminar(id)` hace DELETE y re-`cargar()`.

Ver el archivo completo en `app/pages/configuracion/razones-sociales.vue`.

---

## 6. Template (`@nuxt/ui` v4)

Componentes usados como estándar:

| Necesidad | Componente |
|---|---|
| Contenedor | `UCard` |
| Lista | `<ul class="divide-y …">` con `<li v-for>` |
| Toggle habilitar | `USwitch` con `:model-value` + `@update:model-value` y `:disabled` |
| Estrella default | `<button>` + `UIcon` (`i-lucide-star` + `fill-current` cuando activo) |
| Distintivo (p. ej. "Oficial") | `UBadge` |
| Acciones | `UButton` con `icon`, `variant="ghost"`, `color` |
| Modal | `UModal` con `v-model:open` y slots `#body` / `#footer` |
| Campo de form | `UFormField` + `UInput` / `USwitch` |

Estados de carga/vacío: bloques `v-if="loading"` / `v-else-if="!items.length"` con
texto centrado gris antes de la lista.

---

## 7. Campos decimales / monetarios → string de punta a punta

**Regla (estilo único):** todo campo que el backend valide con `@IsNumberString`
(precios, montos, porcentajes, stock, cantidades — ver [backend.md §3](./backend.md))
se maneja como **string en todo el flujo**: el `ref` del form es string, el input lo
mantiene string, y viaja string en el body **sin conversiones**. Convención del
proyecto: el dinero y los `numeric` son string con Decimal.js, nunca `number` nativo.

**Cómo:** `UInput` **de texto** con `inputmode="decimal"` (abre teclado numérico en
móvil). **Prohibido `type="number"`** en estos campos: hace que `v-model` escriba un
**`number`** en el form, que rompe la convención y produce `400`:

```json
{ "message": ["precioBase must be a number string", "stock must be a number string"] }
```

```vue
<!-- ✅ Estándar: string end-to-end, sin String() en el payload -->
<UInput v-model="form.precioBase" inputmode="decimal" placeholder="0" />

<!-- ❌ type="number" → v-model pasa a number → 400 "must be a number string" -->
<UInput v-model="form.precioBase" type="number" />
```

Como el valor ya es string, el payload va directo (de `configuracion/items.vue`):

```typescript
const payload: Record<string, unknown> = {
  // ...
  precioBase: form.value.precioBase,        // ya es string, sin String(...)
}
if (form.value.tipo === 'producto') {
  payload.stock = form.value.stock || '0'   // default solo para no mandar ''
}
```

> **Excepción — enteros reales** (`@IsInt`, p. ej. `duracionEstimada`): el backend
> espera `number`, así que ahí **sí** se usa `type="number"`. La regla `inputmode`
> aplica solo a los `@IsNumberString` (decimales/monetarios).

---

## 8. Verificación manual

Login como admin → `/configuracion/<feature>`: ver datos, probar toggle (con su
revert ante error simulado), mover la estrella, crear/editar/eliminar. Confirmar
que los `message` de reglas de negocio del backend aparecen en los toasts.

Ver [backend.md](./backend.md) para la API que consume esta capa.

---

## 9. Tabla editable con add/remove de filas (tramos)

Para tablas inline donde el usuario agrega y elimina filas (p.ej. tramos de descuento):

```typescript
// array inmutable — nunca mutar directamente
function agregarTramo() {
  form.value.tramos = [...form.value.tramos, { minimo: '', valor: '' }]
}
function eliminarTramo(i: number) {
  form.value.tramos = form.value.tramos.filter((_, idx) => idx !== i)
}
```

```vue
<tbody>
  <tr v-for="(tramo, i) in form.tramos" :key="i">
    <td><UInput v-model="tramo.minimo" inputmode="decimal" /></td>
    <td><UInput v-model="tramo.valor"  inputmode="decimal" /></td>
    <td><UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" @click="eliminarTramo(i)" /></td>
  </tr>
</tbody>
```

Usar `inputmode="decimal"` (no `type="number"`) para campos `@IsNumberString` del backend.
Ver §7 para la explicación completa de la regla de campos decimales.

---

## 10. Pantalla POS (dos paneles + carrito con recálculo)

Para pantallas complejas con múltiples paneles orquestados (p. ej. catálogo + carrito en paralelo):

Ver `app/pages/ventas/index.vue` como referencia completa. Patrón clave: **helpers puros testeables en `composables/useVenta.ts`** (funciones sin Nuxt/Vue, 100% Vitest) + composable reactivo que los envuelve.

Ventaja: separa lógica de negocio (`puedeCobrar`, `resumenCobro`, `sumaPagos`) de la capa reactiva de Vue, permitiendo tests unitarios reales sin mocks de Nuxt.

```typescript
// ✅ Función pura — testeable directo con Vitest, sin mocks
function puedeCobrar(tipoDoc: TipoDoc, customer: CustomerForm | null): boolean {
  if (tipoDoc.requiereCustomer) return !!(customer?.nombre?.trim())
  return true
}

// ✅ Composable reactivo que la envuelve
const puedeCobrarReactivo = computed(() => 
  puedeCobrar(tipoDocSeleccionado.value, customerData.value)
)
```

Componentes pequeños (`CarritoPanel`, `CobroModal`, `ClienteForm`) que no contienen lógica sino que la consumen de arriba + composable.

---

## 11. Coordinar skill `frontend-design` con `nuxt-ui` / tokens semánticos

Ambas skills conviven en este repo pero operan en fases distintas: `frontend-design`
decide dirección estética (paleta, tipografía, layout, "elemento firma");
`nuxt-ui` implementa con componentes usando **tokens semánticos** (regla de
`CLAUDE.md` §Design System: nunca Tailwind hardcoded). Sin coordinación chocan en
3 puntos:

**Orden de trabajo (siempre en este orden):**
1. `frontend-design` — brainstorm + plan: paleta (4-6 hex nombrados), tipografía,
   layout, elemento firma.
2. Traducir ese plan a `frontend/app.config.ts` **antes** de escribir ningún
   componente (ver bloque `ui.colors` / `text` / `border` / `bg` / `divider` ya
   existente ahí).
3. `nuxt-ui` — construir la pantalla con componentes reales, consumiendo esos
   tokens ya definidos.

**Punto de choque 1 — hex sueltos vs. tokens semánticos:**
La paleta que entrega `frontend-design` nunca se escribe literal en un `.vue`
(nada de `bg-[#F4F1EA]`). Se mapea en `app.config.ts`:
- Color de marca/acento reutilizable → escala `primary`/`secondary`/`neutral`.
- Alias semántico nuevo de un solo uso (p. ej. el hero de una pantalla) → se
  agrega como alias con nombre siguiendo el patrón de `text.highlighted` ya
  presente (`bg.accent`, `text.accent`, etc.), no como clase inline.

**Punto de choque 2 — CSS bespoke/animaciones vs. slots de Nuxt UI:**
Preferir el prop `ui`/`class` del componente (mismo patrón que los overrides de
`card`/`modal`/`formField` en `app.config.ts`) antes que CSS global. Si el
"elemento firma" necesita markup verdaderamente custom (hero, animación de
scroll), aislarlo en su propio componente con `<style scoped>` — nunca
selectores globales tipo `.section`/`.cta` que puedan chocar con las clases
generadas en `.nuxt/ui/<component>.ts`. Revisar ese archivo generado antes de
escribir CSS custom para no duplicar especificidad.

**Punto de choque 3 — orden de invocación no definido entre skills:**
Resuelto por el flujo de 3 pasos de arriba: primero decisión estética
(`frontend-design`), tokens declarados en `app.config.ts`, recién después
implementación con componentes (`nuxt-ui`).
