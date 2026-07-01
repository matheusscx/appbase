# Design System — Nuxt UI Semantic Tokens

## Overview
All pages and components use Nuxt UI v4 semantic design tokens for colors, spacing, and typography. This ensures consistency across the entire application and makes dark mode support automatic.

## Semantic Color Tokens

### Text Colors
- **text-default**: Primary text (headings, body copy)
  - Light: `text-gray-900`
  - Dark: `dark:text-white`
- **text-muted**: Secondary text (descriptions, hints, meta)
  - Light: `text-gray-500`
  - Dark: `dark:text-gray-400`
- **text-highlighted**: Accent text (links, primary actions)
  - Light: `text-primary-600`
  - Dark: `dark:text-primary-400`
- **text-error**: Error states
  - Light: `text-red-600`
  - Dark: `dark:text-red-400`

### Background Colors
- **bg-default**: Primary background (cards, modals)
  - Light: `bg-white`
  - Dark: `dark:bg-gray-900`
- **bg-elevated**: Elevated background (section backgrounds, form backgrounds)
  - Light: `bg-gray-50`
  - Dark: `dark:bg-gray-800`
- **bg-muted**: Muted background (disabled states)
  - Light: `bg-gray-100`
  - Dark: `dark:bg-gray-800`

### Border Colors
- **border-default**: Dividers, list separators, borders
  - Light: `border-gray-200`
  - Dark: `dark:border-gray-700`
- **divide-default**: For `divide-y` lists (same tone as card/modal dividers)
  - Light: `divide-gray-100`
  - Dark: `dark:divide-gray-800`

### Financial Semantic Colors (Context-Specific)
These are intentionally retained in the Caja module for clarity:
- **Green** (income, positive): `text-green-600 dark:text-green-400`, `bg-green-50 dark:bg-green-900/20`
- **Red** (expense, negative): `text-red-600 dark:text-red-400`, `bg-red-50 dark:bg-red-900/20`
- **Blue** (balance, neutral): `text-blue-600 dark:text-blue-400`, `bg-blue-50 dark:bg-blue-900/20`

### Branding Exceptions (intentional `primary` palette)

Usar tokens semánticos en UI de producto; estas excepciones son **marca fija**, no deuda pendiente:

| Patrón | Archivos | Motivo |
|--------|----------|--------|
| `bg-primary-600` + `text-white` en logo/avatar | `login`, `register`, `forgot-password`, `select-tenant`, `layouts/dashboard.vue` | Icono de producto sobre fondo de marca |
| `bg-primary-50 dark:bg-primary-950` | `index.vue`, `no-tenant.vue` | Superficie de acento decorativa en pantallas de bienvenida |
| `text-white` sobre `bg-primary-*` | Iconos dentro del logo | Contraste sobre marca |
| Avatares de tenant | `select-tenant.vue` | `UAvatar` con colores semánticos Nuxt UI (`primary`, `secondary`, …) |

Links y acentos interactivos usan **`text-highlighted`**, no `text-primary-600`.

## Espaciado (padding, margin, gap)

Escala estándar del proyecto. Usar estas clases de Tailwind de forma consistente; evitar valores arbitrarios (`px-[13px]`) salvo casos excepcionales.

### Escala de referencia

| Token | Clase | px | Uso |
|-------|-------|-----|-----|
| **Tight** | `2` | 8px | Gap entre botones en footer de drawer/modal (`gap-2`) |
| **Inset** | `4` | 16px | Contenido **dentro** de un contenedor con borde (acordeón, panel anidado) |
| **Panel** | `6` | 24px | Shell de página: drawer, card header/body, modal (`px-6`) |
| **Section** | `6` | 24px | Separación vertical entre bloques de página (`space-y-6`) |
| **Form block** | `4` | 16px | Campos de formulario, subsecciones (`space-y-4`, `gap-4`) |

### Reglas

1. **Página de configuración** — contenedor raíz con `space-y-6` entre header, card(s) y drawer.
2. **Formularios** — `space-y-4` entre campos; bloques temáticos (ej. datos + permisos) con `space-y-6`.
3. **Shell con borde** (`AppDrawer`, `UCard`, `UModal`) — padding horizontal **`px-6`**, vertical **`py-4`** en header/body/footer. Ya aplicado en `AppDrawer` y `app.config.ts` (card/modal).
4. **Componente anidado con borde propio** — un nivel menos: **`px-4`** en trigger/body para que iconos y texto no queden pegados al borde. Ejemplo: `UAccordion` dentro del drawer vía prop `ui`:
   ```vue
   :ui="{ trigger: 'px-4 gap-2', body: 'px-4 pb-4' }"
   ```
5. **Grids de filtros o cards** — `gap-4` (`grid`, `flex`).
6. **Listas densas** (checkboxes, ítems apilados) — `gap-3` o `flex flex-col gap-3`.
7. **No duplicar padding** — si el padre ya tiene `px-6`, el hijo con borde propio usa `px-4`; no sumar `px-6` en ambos.

### Jerarquía visual (drawer + acordeón)

```
AppDrawer body          px-6 py-4     ← shell
  UForm                 space-y-6
    campos              space-y-4
    UAccordion          border
      trigger           px-4          ← inset (icono no pegado al borde)
      body (checkboxes) px-4
AppDrawer footer        px-6 py-4, gap-2 entre botones
```

### Ejemplos rápidos

```vue
<!-- Página config -->
<div class="space-y-6">…</div>

<!-- Formulario en drawer -->
<UForm class="space-y-6">
  <div class="space-y-4">…campos…</div>
  <div class="space-y-4">…otra sección…</div>
</UForm>

<!-- Footer de acciones -->
<div class="flex justify-between gap-2">…</div>
```

## Usage Examples

### Page Header
```vue
<div>
  <h1 class="text-2xl font-semibold text-default">Page Title</h1>
  <p class="text-sm text-muted">Description or subtitle</p>
</div>
```

### List Item
```vue
<ul class="divide-y divide-default">
  <li class="flex items-center justify-between py-3">
    <div>
      <p class="font-medium text-default">{{ item.name }}</p>
      <p class="text-sm text-muted">{{ item.description }}</p>
    </div>
  </li>
</ul>
```

### Form Field
```vue
<UFormField label="Label" description="Help text (uses text-muted internally)">
  <UInput placeholder="Enter text" />
</UFormField>
```

### Card
```vue
<UCard>
  <template #header>
    <h2 class="text-lg font-semibold text-default">Card Title</h2>
  </template>
  <p class="text-default">Content goes here</p>
</UCard>
```

### Drawer lateral (`AppDrawer`)

Usar **`AppDrawer`** (wrapper de `UDrawer`) para formularios y paneles laterales. Ancho estándar vía prop `width`:

| Valor | Ancho |
|-------|-------|
| `xs` | 25% |
| `sm` | 33% |
| `md` | 50% (default) |
| `lg` | 75% |
| `xl` | 90% |
| `full` | casi pantalla completa |
| `"50%"`, `"75%"`, `"28rem"` | valor CSS libre |

```vue
<AppDrawer v-model:open="drawerOpen" title="Nuevo rol" width="50%">
  <template #body>
    <UForm id="mi-form" :state="form" class="space-y-4" @submit="guardar">
      <!-- campos -->
    </UForm>
  </template>
  <template #actions>
    <UButton variant="ghost" color="neutral" @click="drawerOpen = false">Cancelar</UButton>
    <UButton type="submit" form="mi-form" :loading="saving">Guardar</UButton>
  </template>
</AppDrawer>
```

Defaults: `direction="right"`, `handle={false}`. Presets en `app/utils/drawer-width.ts`.

Separación header/body/footer con `divide-y divide-accented` (mismo tono gris que el borde de `UInput`: `ring-accented`).

**Acciones siempre en `#actions`** — footer fijo al fondo; el body scrollea. Cancelar primero (izquierda), acción primaria después (derecha). Enlazar submit con `form="id-del-form"` en el botón.

**Permisos por módulo** — usar `RolPermisosPorModulo`: acordeón (`UAccordion`, `type="multiple"`) por módulo con contador `N/M` en el header, buscador por nombre, checkboxes en columna (permisos con nombres largos). Padding del acordeón: `px-4` en trigger/body (ver [Espaciado](#espaciado-padding-margin-gap)).

## Componentes CRUD reutilizables

Patrón extraído de `configuracion/categorias.vue`. Ubicación: `app/components/crud/`.

| Componente | Uso |
|------------|-----|
| `CrudPageHeader` | Título (`h2` o `h1` con `large`) + subtítulo + slot `#actions` |
| `CrudTable` | `UCard` + `UTable` con empty state por defecto |
| `CrudListItem` | Celda nombre: título + subtítulo muted |
| `CrudModal` | Confirmación de eliminación (cancel + confirm) |

```vue
<CrudPageHeader title="Categorías" description="…">
  <template #actions>
    <UButton icon="i-lucide-plus" @click="abrirCrear">Nueva categoría</UButton>
  </template>
</CrudPageHeader>

<CrudTable :data="items" :columns="columns" :loading="loading">
  <template #nombre-cell="{ row }">
    <CrudListItem :title="row.original.nombre" subtitle="…" />
  </template>
</CrudTable>

<CrudModal
  v-model:open="confirmModalOpen"
  title="Eliminar categoría"
  message="¿Estás seguro…?"
  @cancel="confirmDeleteId = null"
  @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
/>
```

Formularios de edición siguen en `AppDrawer` + `UForm`. Referencia completa: `pages/configuracion/categorias.vue`.

## Iconos (Lucide)

Colección oficial del proyecto: **Lucide** vía Iconify — alineada con la recomendación de Nuxt UI v4.

- **Formato:** `i-lucide-{name}` en props `icon` de `UButton`, `UIcon`, nav items, etc.
- **Paquete:** `@iconify-json/lucide` (en `frontend/package.json`).
- **Buscar iconos:** [icones.js.org/collection/lucide](https://icones.js.org/collection/lucide), MCP `search_icons` de Nuxt UI, o copiar de `layouts/dashboard.vue` / `pages/configuracion.vue`.
- **No mezclar colecciones** (Heroicons, Material, etc.) en código nuevo.

### Ejemplos frecuentes

| Uso | Icono |
|-----|-------|
| Crear / agregar | `i-lucide-plus` |
| Editar | `i-lucide-square-pen` |
| Eliminar | `i-lucide-trash-2` |
| Cargando | `i-lucide-loader` (+ `animate-spin`) |
| Vacío | `i-lucide-inbox` |
| Caja / pagos | `i-lucide-banknote` |
| Configuración | `i-lucide-settings` |
| Favorito / default | `i-lucide-star` (+ `fill-current` cuando activo) |

```vue
<UButton icon="i-lucide-plus">Nuevo</UButton>
<UIcon name="i-lucide-inbox" class="w-8 h-8 opacity-40" />
```

## Migration Checklist

When adding a new page or updating an existing one:
- [ ] Replace `text-gray-500` with `text-muted`
- [ ] Replace `text-gray-400` with `text-muted`
- [ ] Replace `text-gray-900 dark:text-white` with `text-default`
- [ ] Replace `bg-gray-50 dark:bg-gray-950` with `bg-elevated`
- [ ] Replace `divide-gray-100 dark:divide-gray-800` with `divide-default`
- [ ] Replace `border-gray-200 dark:border-gray-700` with `border-default`
- [ ] Page sections: `space-y-6`; form fields: `space-y-4`; drawer/card shell: `px-6 py-4`; nested bordered UI: `px-4`
- [ ] Iconos Lucide (`i-lucide-*`); no mezclar otras colecciones
- [ ] Use UCard, UModal, UFormField for structure
- [ ] Test in both light and dark modes
- [ ] Verify text contrast meets WCAG AA standards

## Component Baseline Examples

These components exemplify correct design system usage:
- **Dashboard pages**: `frontend/app/pages/index.vue` (UDashboardPanel, semantic tokens)
- **Auth pages**: `frontend/app/pages/login.vue` (form styling, bg-default, text-default)
- **Ventas module**: `frontend/app/pages/ventas/index.vue` (historial en `/ventas`, drawer con `?venta=`); POS en `ventas/pos.vue`
- **Config CRUD**: `frontend/app/pages/configuracion/categorias.vue` — `CrudPageHeader`, `CrudTable`, `CrudModal`, `AppDrawer`, `UForm`

When in doubt, reference these files.

## Configuration

Design tokens are configured in `frontend/app.config.ts` via Nuxt UI's `ui` property. Modify this file to adjust:
- Color palette
- Component defaults
- Spacing scales
- Typography

All changes propagate globally via Tailwind CSS and Vue component injection.

## Dark Mode Support

Nuxt UI v4 provides automatic dark mode support via Tailwind CSS's `dark:` prefix. All semantic tokens include both light and dark variants. No additional configuration is needed — dark mode is enabled by default based on system preferences or user selection in the UI.

To test dark mode during development:
1. Open DevTools (F12)
2. Cmd+Shift+P (or Ctrl+Shift+P on Linux/Windows)
3. Search "prefers-color-scheme"
4. Select "dark" to emulate dark mode

All pages should render consistently with proper contrast and readability in both modes.
