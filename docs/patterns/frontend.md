# Frontend Patterns — Playbook

**Status**: Living
**Last Updated**: 2026-06-22

Patrón de referencia para una pantalla de configuración en el frontend (Nuxt 4 +
Vue 3 + `@nuxt/ui` v4). Extraído del código real más reciente
(`app/pages/configuracion/razones-sociales.vue`). **Léelo antes de planificar una
feature** para no re-escanear: aquí está la página completa, el fetch con auth, el
update optimista con revert y la navegación.

> Convenciones transversales:
> - **Llamadas API: `useApiFetch`** (`composables/useApiFetch.ts`), NO `$fetch`
>   directo ni axios. Inyecta el Bearer token y reintenta tras refresh en 401.
> - **Sin store** para las pantallas CRUD de config: estado local con `ref`/`reactive`.
> - **Update optimista con revert** para toggles/estrellas (no re-fetch).
> - Mensajes de error del backend vía `e.data.message`, mostrados en un `useToast`.
> - URL base: `useRuntimeConfig().public.apiUrl`.

---

## 1. Navegación

Agregar el item al computed `navItems` de `app/pages/configuracion.vue` (dentro del
bloque `permissionsStore.esAdmin` si la pantalla es solo admin):

```typescript
{ label: 'Monedas', icon: 'i-heroicons-currency-dollar', to: '/configuracion/monedas' }
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
> `configuracion.vue`. Para una página suelta usar
> `definePageMeta({ middleware: 'auth', layout: 'dashboard' })`.

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
| Estrella default | `<button>` + `UIcon` (`i-heroicons-star-solid` / `i-heroicons-star`) |
| Distintivo (p. ej. "Oficial") | `UBadge` |
| Acciones | `UButton` con `icon`, `variant="ghost"`, `color` |
| Modal | `UModal` con `v-model:open` y slots `#body` / `#footer` |
| Campo de form | `UFormField` + `UInput` / `USwitch` |

Estados de carga/vacío: bloques `v-if="loading"` / `v-else-if="!items.length"` con
texto centrado gris antes de la lista.

---

## 7. Verificación manual

Login como admin → `/configuracion/<feature>`: ver datos, probar toggle (con su
revert ante error simulado), mover la estrella, crear/editar/eliminar. Confirmar
que los `message` de reglas de negocio del backend aparecen en los toasts.

Ver [backend.md](./backend.md) para la API que consume esta capa.
