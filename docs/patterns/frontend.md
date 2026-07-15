# Frontend Patterns — Playbook

**Status**: Living
**Last Updated**: 2026-07-15

Patrón de referencia para pantallas del frontend (Nuxt 4 + Vue 3 + `@nuxt/ui` v4),
extraído del código real (`app/pages/configuracion/razones-sociales.vue`). **Léelo
antes de planificar una feature**: cada sección condensa el patrón y apunta al
archivo real para copiar/adaptar.

> Convenciones transversales:
> - **Iconos: Lucide** — formato `i-lucide-{name}` (ver `frontend/docs/DESIGN-SYSTEM.md` § Iconos).
> - **Llamadas API: `useApiFetch`** (`composables/useApiFetch.ts`), NO `$fetch`
>   directo ni axios. Inyecta el Bearer token y reintenta tras refresh en 401.
> - **Sin store** para pantallas CRUD de config: estado local con `ref`/`reactive`.
> - **Update optimista con revert** para toggles/estrellas (no re-fetch).
> - **Tras POST/PATCH/DELETE: no re-fetch.** El backend devuelve la entidad
>   mutada; el front la inserta/reemplaza/elimina en el `ref` local (y en
>   catálogos derivados, p. ej. selector de ingredientes de receta). Ver §5.
> - Mensajes de error del backend vía `e.data.message`, mostrados en un `useToast`.
> - URL base: `useRuntimeConfig().public.apiUrl`.
> - **Campos decimales/monetarios → string de punta a punta** (ver §7): `UInput`
>   `inputmode="decimal"`, nunca `type="number"`.
> - **Toda página suelta con `layout: 'dashboard'` lleva header** (ver §2).

---

## 1. Navegación

Agregar el item al computed `navItems` de `app/pages/configuracion.vue` (dentro del
bloque `permissionsStore.esAdmin` si es solo admin):

```typescript
{ label: 'Monedas', icon: 'i-lucide-dollar-sign', to: '/configuracion/monedas' }
```

Pantallas CRUD simples pueden usar `app/components/crud/` (`CrudPageHeader`,
`CrudTable`, `CrudListItem`, `CrudModal`) — ver `DESIGN-SYSTEM.md` § Componentes CRUD
y `configuracion/categorias.vue`.

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

> Las páginas de `configuracion/` heredan `middleware`/`layout` del padre
> `configuracion.vue` (que ya provee el header vía `AppNavbar`): su `<template>` va
> directo al contenido sin `UDashboardPanel`.
>
> Para una página suelta (no anidada) usar
> `definePageMeta({ middleware: 'auth', layout: 'dashboard' })` **y** envolver el
> `<template>` en `UDashboardPanel` — el layout `dashboard.vue` solo aporta el
> sidebar, cada página es responsable de su header:
>
> ```vue
> <template>
>   <UDashboardPanel>
>     <template #header>
>       <AppNavbar title="Historial de ventas" />
>     </template>
>     <template #body>
>       <div class="max-w-5xl mx-auto py-6"><!-- contenido --></div>
>     </template>
>   </UDashboardPanel>
> </template>
> ```
>
> `AppNavbar` (`app/components/AppNavbar.vue`) ya incluye el collapse del sidebar y
> el `UserMenu` en `#right` — no usar `UDashboardNavbar` directo ni duplicar el
> `UserMenu`. Referencias: `pages/index.vue`, `pages/ventas/index.vue`, `pages/caja/index.vue`.

---

## 3. Update optimista con revert (toggle y estrella "solo uno")

Patrón único para toggles (`habilitado`) y distintivos únicos (`preferida`/default):
guardar el valor previo, mutar la UI de inmediato, llamar la API, y en `catch`
revertir. `toggling` (Set) evita doble click.

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

Para el distintivo único (estrella), la regla "solo uno" se refleja optimistamente:
limpiar el anterior (`prev = items.find(x => x.preferida)`), marcar el nuevo, y en
`catch` **revertir ambos**. Precondiciones (p. ej. debe estar habilitado) se validan
en cliente con toast `warning` antes de mutar. Ver `togglePreferida` en
`razones-sociales.vue` o `configuracion/monedas.vue`.

---

## 5. Crear / editar / eliminar

- **Crear/editar**: un `UModal`/`AppDrawer` con `v-model:open`,
  `form = ref(emptyForm())`, `editingId = ref<string | null>(null)`.
  `guardar()` hace POST o PATCH según `editingId`, **captura la entidad
  devuelta** y la mergea en el `ref` de la lista (y en cualquier catálogo
  derivado en memoria). **No** llamar otra vez a `cargar()` / `fetch()`.
- **Eliminar**: segundo modal de confirmación; tras DELETE exitoso, sacar el
  id del array local (y de catálogos derivados). Sin re-fetch.
- **Contrato backend**: POST/PATCH arman la respuesta con `RETURNING` + datos
  de la mutación (sin `findOne` post-write). Create → fila usable en lista;
  update → patch mergeable. Así el front actualiza `costoActual`/stock sin GET.

```typescript
const saved = editingId.value
  ? await useApiFetch<Item>(`${apiUrl}/items/${editingId.value}`, {
      method: 'PATCH',
      body: payload,
    })
  : await useApiFetch<Item>(`${apiUrl}/items`, {
      method: 'POST',
      body: payload,
    })

upsertItemEnLista(saved, !editingId.value) // respeta filtros de la página
syncCatalogoDerivado(saved)                 // p. ej. productosIngrediente
```

Referencia: `app/pages/configuracion/items.vue` (`upsertItemEnLista`,
`syncProductoIngrediente`). Para toggles sigue valiendo §3 (optimista +
revert). Archivo CRUD clásico con toggle: `razones-sociales.vue`.

---

## 6. Template (`@nuxt/ui` v4)

| Necesidad | Componente |
|---|---|
| Contenedor | `UCard` |
| Lista | `<ul class="divide-y …">` con `<li v-for>` |
| Toggle habilitar | `USwitch` con `:model-value` + `@update:model-value` y `:disabled` |
| Estrella default | `<button>` + `UIcon` (`i-lucide-star` + `fill-current` si activo) |
| Distintivo | `UBadge` |
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
mantiene string, y viaja string en el body **sin conversiones**.

- **Campos monetarios con moneda:** usar `MoneyInput` con `v-model` string (ver §8).
- **Otros decimales (stock, porcentajes, tasas):** `UInput` de texto con
  `inputmode="decimal"` (teclado numérico en móvil). **Prohibido `type="number"`**
  en campos `@IsNumberString`: hace que `v-model` escriba un **`number`** y produce
  `400 "X must be a number string"`.

```vue
<!-- ✅ Precio / monto con moneda → MoneyInput (string limpio al API) -->
<MoneyInput v-model="form.precioBase" :moneda-id="form.monedaId" />
<MoneyInput v-model="form.saldoInicial" oficial />

<!-- ✅ Stock, porcentaje, tasa de cambio → UInput decimal sin maska de moneda -->
<UInput v-model="form.stock" inputmode="decimal" placeholder="0" />

<!-- ❌ type="number" → v-model pasa a number → 400 "must be a number string" -->
<UInput v-model="form.precioBase" type="number" />
```

El payload va directo, sin `String(...)` (el valor ya es string); defaults tipo
`form.value.stock || '0'` solo para no mandar `''`.

> **Excepción — enteros reales** (`@IsInt`, p. ej. `duracionEstimada`): el backend
> espera `number`, ahí **sí** se usa `type="number"`. La regla `inputmode` aplica
> solo a los `@IsNumberString`.

---

## 8. Monedas — store, formato (Intl) e inputs (maska)

Detalle funcional completo (arquitectura, tablas de uso por pantalla, alta de
monedas nuevas): [features/configuracion-monedas.md](../features/configuracion-monedas.md).

| Necesidad | Solución |
|-----------|----------|
| Mostrar precio en lista / solo lectura | `formatMonto(value, monedaId?)` — sin `monedaId` usa la **oficial** del tenant |
| Input con formato en tiempo real | `<MoneyInput v-model="..." :moneda-id="..." />` o prop `oficial` (maska) |
| Lookup O(1) por moneda | `monedasStore.getById(uuid)` (Pinia, un fetch por sesión/tenant) |
| Valor al API | **string** limpio (`"1500000"`, `"1500.5"`) |

Reglas:
- La config de presentación (`locale`, `simbolo`, `decimales`, separadores) viene de
  la tabla `moneda` vía `GET /monedas` → `useMonedasStore` (`ensureLoaded()` en
  `dashboard.vue`; `reset()` en logout/switch-tenant). **No** duplicar `GET /monedas`
  en páginas. **No** concatenar `monedaSimbolo + monto`.
- Monedas ISO 4217 → `Intl.NumberFormat`; códigos custom (UF) → formato manual.
  Vacío / `null` → `'—'`.
- `MoneyInput` NO se usa para stock, cantidades, porcentajes ni `valorDelDia`
  (ahí va `UInput inputmode="decimal"`, ver §7).

Archivos: `app/stores/monedas.ts`, `app/types/moneda.ts`,
`app/utils/currency-format.ts` (+ `.spec.ts`), `app/composables/useCurrency.ts`,
`app/composables/useFormatters.ts`, `app/components/MoneyInput.vue`.

Tests: `cd frontend && npm test -- --run app/utils/currency-format.spec.ts app/stores/monedas.spec.ts`

---

## 8.1 Verificación manual (pantallas de configuración)

Login como admin → `/configuracion/<feature>`: ver datos, probar toggle (con revert
ante error simulado), mover la estrella, crear/editar/eliminar. Confirmar que los
`message` del backend aparecen en los toasts.

**Monedas / precios:** una sola llamada `GET /monedas` en Network tras login;
catálogo POS muestra CLP sin decimales y USD con separador US; `MoneyInput` formatea
mientras se escribe; totales de venta/caja usan moneda oficial.

Ver [backend.md](./backend.md) para la API que consume esta capa.

---

## 9. Tabla editable con add/remove de filas (tramos)

Array inmutable — nunca mutar directamente:

```typescript
function agregarTramo() {
  form.value.tramos = [...form.value.tramos, { minimo: '', valor: '' }]
}
function eliminarTramo(i: number) {
  form.value.tramos = form.value.tramos.filter((_, idx) => idx !== i)
}
```

En el template, `<tr v-for="(tramo, i) in form.tramos" :key="i">` con `UInput`
`inputmode="decimal"` por celda y `UButton i-lucide-trash-2` para eliminar (ver §7).

---

## 10. Pantalla POS (dos paneles + carrito con recálculo)

Para pantallas complejas con múltiples paneles orquestados, ver
`app/pages/ventas/index.vue`. Patrón clave: **helpers puros testeables en
`composables/useVenta.ts`** (funciones sin Nuxt/Vue, 100% Vitest) + composable
reactivo que los envuelve con `computed`. Componentes pequeños (`CarritoPanel`,
`CobroModal`, `ClienteForm`) que no contienen lógica sino que la consumen de arriba.

---

## 12. Listados paginados (server-side)

Para tablas con dataset grande: paginar en backend, no en cliente.

```typescript
const filtroEstado = ref<string | undefined>()
const listFilters = computed(() => ({ ventaEstado: filtroEstado.value }))

const { items, meta, page, pageSize, loading } = usePaginatedList<Item>({
  path: '/pagos',
  pageSize: 15,
  filters: listFilters,
})
```

- `page` es 1-based (alineado con `UPagination`); al cambiar filtros → reset a
  página 1 y refetch automático; errores vía `useToast`.
- UI: `<UTable :data="items" :columns="columns" />` + `UPagination`
  (`v-model:page`, `:items-per-page`, `:total="meta.total"`). **Sin** TanStack
  `getPaginationRowModel`.
- KPIs/resumen: endpoint dedicado (`GET /pagos/resumen`), cargado una vez en
  `onMounted`, independiente de filtros/página.
- Filtros: preferir `USelectMenu` con IDs del backend en vez de búsqueda texto.

Referencia: `app/pages/pagos/index.vue`, `app/pages/configuracion/items.vue`.

---

## 13. Preferencias de usuario

Composable `useUserPreferences()` — lee/escribe `authStore.user.preferencias`.

| Pref | Default | Persistencia |
|------|---------|--------------|
| `pageSize` | 15 | Solo servidor (`PATCH /me/preferencias`) |
| `colorMode` | light | Cookie `@nuxtjs/color-mode` + mirror servidor |

UI en `/configuracion/perfil` → `UserPreferencesForm`; plugin
`plugins/color-mode-sync.client.ts` aplica el tema del servidor tras `fetchMe`;
cambios sincronizados con debounce 300 ms. Uso:
`usePaginatedList({ path, pageSize, filters })` con el `pageSize` del composable.

---

## 14. Coordinar skill `frontend-design` con `nuxt-ui` / tokens semánticos

Orden de trabajo (siempre): **1)** `frontend-design` decide dirección estética
(paleta 4-6 hex nombrados, tipografía, layout, elemento firma) → **2)** traducir ese
plan a `frontend/app.config.ts` **antes** de escribir componentes → **3)** `nuxt-ui`
construye con componentes reales consumiendo esos tokens.

Puntos de choque (resueltos por ese orden):
- **Hex sueltos:** la paleta nunca se escribe literal en un `.vue` (nada de
  `bg-[#F4F1EA]`); se mapea a escalas `primary`/`neutral` o alias semánticos en
  `app.config.ts` (patrón `text.highlighted`).
- **CSS bespoke:** preferir prop `ui`/`class` del componente; markup verdaderamente
  custom va en componente propio con `<style scoped>`, nunca selectores globales
  (revisar `.nuxt/ui/<component>.ts` antes de escribir CSS custom).
- **Orden de invocación entre skills:** el flujo de 3 pasos de arriba.
