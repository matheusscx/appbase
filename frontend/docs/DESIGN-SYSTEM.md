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
- **divide-border-default**: For `divide-y` lists
  - Light: `divide-gray-100`
  - Dark: `dark:divide-gray-800`

### Financial Semantic Colors (Context-Specific)
These are intentionally retained in the Caja module for clarity:
- **Green** (income, positive): `text-green-600 dark:text-green-400`, `bg-green-50 dark:bg-green-900/20`
- **Red** (expense, negative): `text-red-600 dark:text-red-400`, `bg-red-50 dark:bg-red-900/20`
- **Blue** (balance, neutral): `text-blue-600 dark:text-blue-400`, `bg-blue-50 dark:bg-blue-900/20`

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
<ul class="divide-y divide-border-default">
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

## Migration Checklist

When adding a new page or updating an existing one:
- [ ] Replace `text-gray-500` with `text-muted`
- [ ] Replace `text-gray-400` with `text-muted`
- [ ] Replace `text-gray-900 dark:text-white` with `text-default`
- [ ] Replace `bg-gray-50 dark:bg-gray-950` with `bg-elevated`
- [ ] Replace `divide-gray-100 dark:divide-gray-800` with `divide-border-default`
- [ ] Replace `border-gray-200 dark:border-gray-700` with `border-border-default`
- [ ] Use UCard, UModal, UFormField for structure
- [ ] Test in both light and dark modes
- [ ] Verify text contrast meets WCAG AA standards

## Component Baseline Examples

These components exemplify correct design system usage:
- **Dashboard pages**: `frontend/app/pages/index.vue` (UDashboardPanel, semantic tokens)
- **Auth pages**: `frontend/app/pages/login.vue` (form styling, bg-default, text-default)
- **Ventas module**: `frontend/app/pages/ventas/historial.vue` (lists, UTable, semantic tokens)
- **Items page**: `frontend/app/pages/configuracion/items.vue` (complex modals, semantic tokens)

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
