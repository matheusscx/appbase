# Frontend Design Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize all 32 Vue pages + components to use Nuxt UI semantic design tokens consistently, eliminating hardcoded Tailwind colors and establishing a coherent visual system across Dashboard, Auth, Configuration, Caja, Ventas, and Pagos modules.

**Architecture:** 
- Create `app.config.ts` to define Nuxt UI design tokens (colors, typography, spacing) as single source of truth
- Migrate hardcoded Tailwind utilities (`text-gray-500`, `divide-gray-100 dark:divide-gray-800`, etc.) to semantic tokens (`text-muted`, `divide-default`, `border-default`)
- Standardize page header styling (h2 text-lg for section pages, h1 text-2xl for dashboard views)
- Unify table rendering: UTable for interactive crud lists, consistent `<table>` styling for data-only views
- Extract 3 reusable components: CrudListItem, CrudModal, CrudTable
- Create design token documentation in `docs/DESIGN-SYSTEM.md`

**Tech Stack:** 
- Nuxt 4, Nuxt UI v4, Vue 3, TypeScript, Tailwind CSS
- Design tokens defined in app.config.ts, enforced via Tailwind config and component usage

## Global Constraints

- No breaking changes to API or data flow
- Maintain 100% backward compatibility with existing components
- All changes use semantic tokens from Nuxt UI (text-muted, text-default, border-default, bg-default, etc.)
- **Icons:** Lucide only — `i-lucide-{name}` via `@iconify-json/lucide`. Aligned with Nuxt UI v4 defaults. Reference: `layouts/dashboard.vue`, `configuracion.vue` nav.
- Dark mode support required for all changes
- Frequent commits — one per file/component group modified
- Pages tested in browser at 1024px and 375px viewport widths
- No new dependencies added

---

## Phase 1: Foundation (Design Token System)

### Task 1: Create app.config.ts with Nuxt UI Design Token Customization

**Files:**
- Create: `frontend/app.config.ts`

**Interfaces:**
- Produces: Nuxt UI app config with `ui` property defining custom design token mappings
- Later tasks consume: `text-muted`, `text-default`, `border-default`, `bg-default`, `bg-elevated`, `text-highlighted`

**Steps:**

- [ ] **Step 1: Create app.config.ts with Nuxt UI ui config**

```typescript
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'primary',
    },
    // Semantic color aliases
    text: {
      default: { light: 'text-gray-900', dark: 'dark:text-white' },
      muted: { light: 'text-gray-500', dark: 'dark:text-gray-400' },
      highlighted: { light: 'text-primary-600', dark: 'dark:text-primary-400' },
    },
    border: {
      default: { light: 'border-gray-200', dark: 'dark:border-gray-700' },
    },
    bg: {
      default: { light: 'bg-white', dark: 'dark:bg-gray-900' },
      elevated: { light: 'bg-gray-50', dark: 'dark:bg-gray-800' },
      muted: { light: 'bg-gray-100', dark: 'dark:bg-gray-800' },
    },
    divider: { light: 'divide-gray-100', dark: 'dark:divide-gray-800' },
  },
})
```

- [ ] **Step 2: Verify app.config.ts loads without errors**

Run: `cd frontend && npm run dev`
Expected: Dev server starts, no console errors related to app.config.ts

- [ ] **Step 3: Commit**

```bash
cd frontend
git add app.config.ts
git commit -m "feat(design): add Nuxt UI design token config via app.config.ts"
```

---

## Phase 2: Migrate Dashboard Pages (Baseline - Already Using Semantic Tokens)

### Task 2: Audit & Document Current Dashboard Page Patterns

**Files:**
- Read only: `frontend/app/pages/index.vue`, `frontend/app/pages/test.vue`, `frontend/app/pages/admin.vue`
- Read only: `frontend/app/layouts/dashboard.vue`

**Produces:** Understanding that dashboard pages already use semantic tokens correctly — no changes needed.

**Steps:**

- [ ] **Step 1: Verify dashboard pages use semantic tokens**

Confirm index.vue (line 23): `text-default`, `text-muted`, `text-primary-600` ✓  
Confirm test.vue: `text-default`, `text-sm text-gray-500` (minor: update gray-500 to text-muted) ✓  
Confirm admin.vue: Uses only hardcoded `text-gray-*` — needs update ✓

Expected: Dashboard pages are the baseline for correct token usage

- [ ] **Step 2: No code changes needed for index.vue and test.vue**

index.vue and test.vue already follow best practices with semantic tokens and UDashboardPanel. Document as exemplar for other modules.

- [ ] **Step 3: Document current state in design notes**

Create a mental note: Dashboard layout pattern = model for consistency:
```
- Use UDashboardPanel with #header (AppNavbar), #body slots
- Use semantic tokens throughout
- Minimal custom styling
```

---

## Phase 3: Migrate Auth Pages (Login, Register, Forgot Password, OAuth Callback)

### Task 3: Standardize Auth Pages - Login & Register Forms

**Files:**
- Modify: `frontend/app/pages/login.vue`
- Modify: `frontend/app/pages/register.vue`

**Interfaces:**
- Consumes: No dependencies
- Produces: Auth pages using semantic tokens for all text, borders, backgrounds

**Steps:**

- [ ] **Step 1: Update login.vue colors to semantic tokens**

Replace:
- Line 24: `bg-gray-50 dark:bg-gray-950` → `bg-elevated`
- Line 31: `text-gray-900 dark:text-white` → `text-default`
- Line 37: `bg-white dark:bg-gray-900 rounded-2xl shadow-sm ring-1 ring-gray-200 dark:ring-gray-800` → `bg-default rounded-2xl shadow-sm ring-1 ring-border-default`
- Line 44: Keep as is (UAlert is semantic)
- Line 69: `bg-gray-200 dark:bg-gray-800` → `bg-gray-200 dark:bg-gray-700` (border divider — update for consistency)
- Line 100: `text-gray-400 hover:text-gray-600 dark:hover:text-gray-300` → Add class `text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300`
- Line 114: `text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300` → Keep as is (already semantic primary)
- Line 132: `text-gray-500 dark:text-gray-400` → `text-muted`
- Line 136: Keep as is (semantic primary)

```vue
<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-4">
          <UIcon name="i-heroicons-bolt" class="text-white w-5 h-5" />
        </div>
        <h1 class="text-xl font-semibold text-default">
          Prueba Técnica
        </h1>
      </div>

      <!-- Card -->
      <div class="bg-default rounded-2xl shadow-sm ring-1 ring-border-default p-8 space-y-5">
        <!-- Error -->
        <UAlert
          v-if="store.error"
          color="error"
          variant="subtle"
          :description="store.error"
          icon="i-heroicons-exclamation-circle"
        />

        <!-- Google button, form, etc. with text-muted for secondary text -->
        <div class="flex items-center gap-3">
          <div class="flex-1 h-px border-t border-gray-200 dark:border-gray-700" />
          <span class="text-xs text-muted">o</span>
          <div class="flex-1 h-px border-t border-gray-200 dark:border-gray-700" />
        </div>
      </div>

      <!-- Register link -->
      <p class="mt-6 text-center text-sm text-muted">
        ¿No tienes cuenta?
        <NuxtLink
          to="/register"
          class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors"
        >
          Crear cuenta
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Apply same pattern to register.vue**

Follow identical color replacements as login.vue. Structure is nearly identical (only 3 form fields instead of 2).

- [ ] **Step 3: Run dev server and verify login page in browser**

Run: `cd frontend && npm run dev`
Navigate to: `http://localhost:5173/login`
Expected: Light mode = white card on light gray background; dark mode = dark gray card on darker background. All text readable. No hardcoded grays visible.

- [ ] **Step 4: Test register page**

Navigate to: `http://localhost:5173/register`
Expected: Same visual consistency as login

- [ ] **Step 5: Commit**

```bash
cd frontend
git add app/pages/login.vue app/pages/register.vue
git commit -m "refactor(auth): migrate login & register to semantic color tokens"
```

---

### Task 4: Standardize Auth Pages - Forgot Password & Callback

**Files:**
- Modify: `frontend/app/pages/forgot-password.vue`
- Modify: `frontend/app/pages/auth/callback.vue`

**Steps:**

- [ ] **Step 1: Update forgot-password.vue**

Replace:
- Line 24: `bg-gray-50 dark:bg-gray-950` → `bg-elevated`
- Line 31: `text-gray-900 dark:text-white` → `text-default`
- Line 48: `text-gray-500 dark:text-gray-400` → `text-muted`

- [ ] **Step 2: Update auth/callback.vue**

Replace:
- Line 24: `bg-gray-50 dark:bg-gray-950` → `bg-elevated`
- Line 25: `text-primary-600` → Keep as is
- Line 26: `text-gray-500 dark:text-gray-400` → `text-muted`

- [ ] **Step 3: Verify in browser**

Navigate to: `http://localhost:5173/forgot-password`
Expected: Consistent styling with login/register pages

- [ ] **Step 4: Commit**

```bash
cd frontend
git add app/pages/forgot-password.vue app/pages/auth/callback.vue
git commit -m "refactor(auth): migrate forgot-password & callback to semantic tokens"
```

---

### Task 5: Standardize Tenant Selection Pages

**Files:**
- Modify: `frontend/app/pages/no-tenant.vue`
- Modify: `frontend/app/pages/select-tenant.vue`

**Steps:**

- [ ] **Step 1: Update no-tenant.vue to use neutral/primary semantic approach**

Replace:
- Line 24: `bg-neutral-50 dark:bg-neutral-950` → `bg-elevated` (switch to primary color scheme)
- Line 31: `bg-amber-100 dark:bg-amber-950` → `bg-primary-50 dark:bg-primary-900/20` (update to primary accent)
- Line 32: `bg-amber-100 dark:bg-amber-950` → `bg-primary-50 dark:bg-primary-900/20`
- Line 32: `text-amber-500` → `text-primary-600 dark:text-primary-400`
- Line 34: `text-gray-900 dark:text-white` → `text-default`
- Line 36: `text-gray-500 dark:text-gray-400` → `text-muted`

- [ ] **Step 2: Update select-tenant.vue header and tenant buttons**

Replace:
- Line 24: `bg-neutral-50 dark:bg-neutral-950` → `bg-elevated`
- Line 31: `text-gray-900 dark:text-white` → `text-default`
- Line 32: `text-gray-500 dark:text-gray-400` → `text-muted`
- Lines 52-73 (tenant button grid): Keep tenant-specific avatar colors (blue-500, violet-500, etc.) — these are intentional for visual distinction — but update card backgrounds:
  - `bg-white dark:bg-gray-900` → `bg-default`
  - `ring-gray-200 dark:ring-gray-800` → `ring-border-default`

Tenant avatars remain branded; cards now use semantic bg-default.

- [ ] **Step 3: Test in browser at mobile and desktop**

Run dev server; navigate to `/no-tenant` and `/select-tenant`
Expected: 
- Light mode: white cards on light gray background
- Dark mode: dark gray cards on darker background
- Tenant avatars still have colored backgrounds (blue, violet, emerald, amber, rose, cyan)

- [ ] **Step 4: Commit**

```bash
cd frontend
git add app/pages/no-tenant.vue app/pages/select-tenant.vue
git commit -m "refactor(auth): migrate tenant selection pages to semantic tokens"
```

---

## Phase 4: Migrate Configuration Pages (Largest Module)

### Task 6: Update app.config.ts - Add Configuration-Specific Patterns

**Files:**
- Modify: `frontend/app.config.ts`

**Steps:**

- [ ] **Step 1: Add Nuxt UI component-specific overrides to app.config.ts**

These allow fine-tuning of UCard, UModal, UFormField defaults for the config pages:

```typescript
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'primary',
    },
    card: {
      base: 'bg-default divide-y divide-default',
      header: {
        base: 'px-6 py-5 border-b border-default',
      },
    },
    modal: {
      base: 'relative text-default',
      body: {
        base: 'p-6 space-y-4',
      },
      footer: {
        base: 'px-6 py-4 border-t border-default flex justify-end gap-2',
      },
    },
    formField: {
      label: { base: 'font-medium text-default' },
      description: { base: 'text-sm text-muted' },
    },
  },
})
```

- [ ] **Step 2: Verify app.config.ts still loads**

Run: `cd frontend && npm run dev`
Expected: No console errors

- [ ] **Step 3: Commit**

```bash
cd frontend
git add app.config.ts
git commit -m "refactor(design): add component-specific token overrides to app.config.ts"
```

---

### Task 7: Migrate Simple CRUD Pages (Metodos Pago, Impuestos, Categorias, Monedas, Razones Sociales)

**Files:**
- Modify: `frontend/app/pages/configuracion/metodos-pago.vue`
- Modify: `frontend/app/pages/configuracion/impuestos.vue`
- Modify: `frontend/app/pages/configuracion/categorias.vue`
- Modify: `frontend/app/pages/configuracion/monedas.vue`
- Modify: `frontend/app/pages/configuracion/razones-sociales.vue`

**Pattern:** These 5 pages follow identical structure: simple list with CRUD modals. Replace all hardcoded colors with semantic tokens.

**Steps:**

- [ ] **Step 1: Update all 5 pages - Headers**

In each file, find the header `<h2 class="text-lg font-semibold">` and description `<p class="text-sm text-gray-500">`:

Replace:
- `text-gray-500` → `text-muted`
- Keep `text-lg font-semibold` as is

Example (metodos-pago.vue line ~10):
```vue
<h2 class="text-lg font-semibold">Métodos de Pago</h2>
<p class="text-sm text-muted">Gestiona los métodos de pago disponibles en tu sistema.</p>
```

- [ ] **Step 2: Update all 5 pages - List Dividers**

Find: `<ul class="divide-y divide-gray-100 dark:divide-gray-800">`

Replace with: `<ul class="divide-y divide-default">`

- [ ] **Step 3: Update all 5 pages - Secondary Text in List Items**

Find: `<p class="text-sm text-gray-500">` (description/details in list items)

Replace with: `<p class="text-sm text-muted">`

- [ ] **Step 4: Update all 5 pages - Empty States**

Find: `<div class="py-8 text-center text-sm text-gray-500">` (loading, no items)

Replace with: `<div class="py-8 text-center text-sm text-muted">`

- [ ] **Step 5: Test all 5 pages in browser**

Run: `cd frontend && npm run dev`
Navigate to: `/configuracion/metodos-pago`, `/configuracion/impuestos`, `/configuracion/categorias`, `/configuracion/monedas`, `/configuracion/razones-sociales`
Expected: Consistent styling. No visible hardcoded grays. Text readable in light/dark modes.

- [ ] **Step 6: Commit**

```bash
cd frontend
git add app/pages/configuracion/metodos-pago.vue app/pages/configuracion/impuestos.vue app/pages/configuracion/categorias.vue app/pages/configuracion/monedas.vue app/pages/configuracion/razones-sociales.vue
git commit -m "refactor(config): migrate simple CRUD pages to semantic tokens"
```

---

### Task 8: Migrate Complex Configuration Pages (Descuentos, Recargos, Preferencias Financieras)

**Files:**
- Modify: `frontend/app/pages/configuracion/descuentos.vue`
- Modify: `frontend/app/pages/configuracion/recargos.vue`
- Modify: `frontend/app/pages/configuracion/preferencias-financieras.vue`

**Pattern:** Larger pages with complex modals, custom styling for form sections.

**Steps:**

- [ ] **Step 1: Update descuentos.vue headers and lists (identical to Task 7)**

- Line ~10: `text-gray-500` → `text-muted`
- List dividers: `divide-gray-100 dark:divide-gray-800` → `divide-default`
- Empty states: `text-gray-500` → `text-muted`

Additional for descuentos.vue (complex modal):
- Line ~250 (inside modal): `text-gray-500` → `text-muted` (field descriptions)

- [ ] **Step 2: Update recargos.vue (identical structure to descuentos)**

Apply same replacements as descuentos.vue (descuentos and recargos are near-duplicates).

- [ ] **Step 3: Update preferencias-financieras.vue**

This page has additional hardcoded styling for form sections:

Find (line ~150): `<div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">`

Replace with: `<div class="bg-elevated rounded-lg p-4">`

Also update:
- Line ~10: `text-gray-500` → `text-muted`
- Any `text-gray-400` → `text-muted`
- USeparator dividers: Keep as is (semantic)

- [ ] **Step 4: Test all 3 pages in browser**

Navigate to: `/configuracion/descuentos`, `/configuracion/recargos`, `/configuracion/preferencias-financieras`
Expected: Modals and form sections render with consistent token-based colors. Sections are visually distinct but use semantic tokens.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add app/pages/configuracion/descuentos.vue app/pages/configuracion/recargos.vue app/pages/configuracion/preferencias-financieras.vue
git commit -m "refactor(config): migrate complex config pages to semantic tokens"
```

---

### Task 9: Migrate Enterprise Configuration Pages (Items, Inventario, Roles, Usuarios, Empresa)

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue` (1,199 lines — largest)
- Modify: `frontend/app/pages/configuracion/inventario.vue`
- Modify: `frontend/app/pages/configuracion/empresa.vue`
- Modify: `frontend/app/pages/configuracion/roles/index.vue`
- Modify: `frontend/app/pages/configuracion/roles/[id].vue`
- Modify: `frontend/app/pages/configuracion/usuarios/index.vue`

**Pattern:** items.vue already uses semantic tokens (text-muted, divide-default) — serves as model. Others need standardization.

**Steps:**

- [ ] **Step 1: Verify items.vue already uses semantic tokens**

Scan items.vue:
- Uses `text-muted`, `divide-default`, `border-default` ✓
- No hardcoded gray-500 ✓
- Uses h1 text-2xl for header ✓

No changes needed for items.vue. Document as exemplar.

- [ ] **Step 2: Update inventario.vue (currently uses semantic tokens but inconsistently)**

Inventory page uses:
- Line ~10: h1 text-2xl ✓ (matches items.vue)
- Line ~30: `text-muted` ✓
- Line ~40 (table headers): `text-muted` ✓
- Line ~50 (table borders): `divide-default` ✓

Already good. Minor verification: confirm no hardcoded gray-500 exists. No changes needed.

- [ ] **Step 3: Update empresa.vue**

Find:
- Line ~10: `text-gray-500` → `text-muted`
- Line ~40: `text-gray-500` → `text-muted`
- Replace `text-gray-900 dark:text-white` → `text-default` if present

- [ ] **Step 4: Update roles/index.vue**

Find:
- Line ~10: `text-gray-500` → `text-muted`
- Line ~30: List items: `text-gray-500` → `text-muted` (secondary text)
- List dividers: `divide-gray-100 dark:divide-gray-800` → `divide-default`

- [ ] **Step 5: Update roles/[id].vue**

Find:
- Line ~10: `text-gray-500` → `text-muted`
- Line ~40: Section headers: `text-gray-500` → `text-muted` (descriptions)
- Replace any `divide-gray-100 dark:divide-gray-800` → `divide-default`

- [ ] **Step 6: Update usuarios/index.vue**

Find:
- Line ~10: `text-gray-500` → `text-muted`
- Line ~30: List items: `text-gray-500` → `text-muted`
- List dividers: `divide-gray-100 dark:divide-gray-800` → `divide-default`

- [ ] **Step 7: Test all 5 pages in browser (items already passes)**

Navigate to: `/configuracion/items`, `/configuracion/inventario`, `/configuracion/empresa`, `/configuracion/roles`, `/configuracion/roles/1` (pick a real role ID)
Expected: All pages use consistent semantic tokens. No visible hardcoded grays.

- [ ] **Step 8: Commit enterprise pages**

```bash
cd frontend
git add app/pages/configuracion/empresa.vue app/pages/configuracion/roles/index.vue app/pages/configuracion/roles/[id].vue app/pages/configuracion/usuarios/index.vue
git commit -m "refactor(config): migrate enterprise config pages to semantic tokens"
```

---

### Task 10: Migrate Configuration Profile Components

**Files:**
- Modify: `frontend/app/components/configuracion/PerfilForm.vue`
- Modify: `frontend/app/components/configuracion/ContrasenaForm.vue`

**Steps:**

- [ ] **Step 1: Update PerfilForm.vue**

Find:
- Any `text-gray-500` → `text-muted`
- Any `divide-gray-100 dark:divide-gray-800` → `divide-default`
- Field descriptions: `text-gray-500` → `text-muted`

- [ ] **Step 2: Update ContrasenaForm.vue**

Same replacements as PerfilForm.vue.

- [ ] **Step 3: Test in browser (navigate to any profile/settings page if available)**

Expected: Form components render with consistent semantic tokens.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add app/components/configuracion/PerfilForm.vue app/components/configuracion/ContrasenaForm.vue
git commit -m "refactor(config): migrate profile components to semantic tokens"
```

---

## Phase 5: Migrate Caja Pages & Components (High-Priority: Semantic Color Coding)

### Task 11: Standardize Caja Pages - Index & Detail Views

**Files:**
- Modify: `frontend/app/pages/caja/index.vue`
- Modify: `frontend/app/pages/caja/[id].vue`

**Pattern:** Caja pages use hardcoded gray-500 for secondary text. Update to semantic tokens.

**Steps:**

- [ ] **Step 1: Update caja/index.vue**

Find:
- Line ~10: `text-gray-900 dark:text-white` → `text-default`
- Line ~15: `text-gray-500` → `text-muted`

- [ ] **Step 2: Update caja/[id].vue**

Find:
- Line ~10: `text-gray-500` → `text-muted`
- Any `text-gray-900 dark:text-white` → `text-default`

- [ ] **Step 3: Test in browser**

Navigate to: `/caja`
Expected: Pages render with semantic tokens. No hardcoded grays visible.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add app/pages/caja/index.vue app/pages/caja/[id].vue
git commit -m "refactor(caja): migrate caja pages to semantic tokens"
```

---

### Task 12: Update Caja Components - Maintain Semantic Color Scheme (Green/Red/Blue for Financial Data)

**Files:**
- Modify: `frontend/app/components/caja/CajaAbiertasGrid.vue`
- Modify: `frontend/app/components/caja/CajaActivaDashboard.vue` (197 lines — complex)
- Modify: `frontend/app/components/caja/CajaCierreModal.vue`
- Modify: `frontend/app/components/caja/CajaHistorial.vue`
- Modify: `frontend/app/components/caja/CajaMovimientoModal.vue`
- Modify: `frontend/app/components/caja/CajaAperturaForm.vue`

**Important Design Decision:** Keep green/red/blue semantic color coding for financial indicators (income/expense/balance). Replace only general neutral grays with tokens.

**Steps:**

- [ ] **Step 1: Update CajaAbiertasGrid.vue**

Find neutral text/borders:
- `text-gray-500` → `text-muted`
- `text-gray-400 pt-1` → `text-muted`
- `divide-gray-100` → `divide-default`
- Keep: `border-primary-300 dark:border-primary-700` (intentional primary accent for "add new" card)
- Keep: `hover:border-primary-500` (hover state)

- [ ] **Step 2: Update CajaActivaDashboard.vue (LARGEST - 197 lines)**

This file has extensive hardcoded semantic color coding. Strategy:
- Replace ALL neutral gray-500, gray-400, gray-200 with tokens (text-muted, border-default, etc.)
- KEEP all green-50/green-600/green-400 (income indicators)
- KEEP all red-50/red-600/red-400 (expense indicators)
- KEEP all blue-50/blue-600/blue-400 (balance indicators)
- KEEP all gray-50/gray-800 (neutral/summary background)

Specific replacements:
- Line ~20: `text-gray-500` → `text-muted`
- Line ~88: `bg-gray-50 dark:bg-gray-800` → Keep as is (intentional neutral background for summary)
- Line ~100: `text-gray-600 dark:text-gray-400` → `text-muted` (replace with token, not primary-colored)
- List dividers: `divide-gray-100 dark:divide-gray-800` → `divide-default`
- Keep: All green-600, red-600, blue-600 (financial semantic colors) and their dark variants

Example block to keep (income section):
```vue
<div class="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
  <div class="text-xs text-green-600 dark:text-green-400">Entradas</div>
  <div class="text-lg font-semibold text-green-700 dark:text-green-300">{{ entradas }}</div>
</div>
```

- [ ] **Step 3: Update CajaCierreModal.vue**

Find:
- Neutral text: `text-gray-500` → `text-muted`
- Neutral borders: `border-gray-200 dark:border-gray-700` → `border-default`
- Neutral background: `bg-gray-50 dark:bg-gray-800` → Keep as is (info box background)
- Keep: `text-green-600 dark:text-green-400`, `text-red-600 dark:text-red-400` (financial indicators)

- [ ] **Step 4: Update CajaHistorial.vue**

Find:
- Line ~20: `text-gray-500` → `text-muted`
- Line ~30: `text-gray-200 dark:text-gray-700` → `border-default` (table borders)
- Table: `border-gray-100 dark:border-gray-800` → `border-default`
- Keep: `text-green-600 dark:text-green-400`, `text-red-600 dark:text-red-400` (income/expense colors)

- [ ] **Step 5: Update CajaMovimientoModal.vue**

Find:
- Custom button styling (lines ~74-95) — these are intentionally green/red for entrada/salida selection
- Keep all green-50, red-50, border-green-400, border-red-400, text-green-700, text-red-700 (this is intentional UX)

No changes needed for button styling — they're semantically correct (green = income, red = expense).

- [ ] **Step 6: Update CajaAperturaForm.vue**

Find:
- Any `text-gray-500` → `text-muted`
- Any `divide-gray-100` → `divide-default`

- [ ] **Step 7: Test all caja components in browser**

Navigate to: Open a caja, close it, view history
Expected:
- Text: Uses semantic tokens (text-muted)
- Borders/dividers: Use token-based borders
- Financial indicators (green/red/blue) remain visually distinct and unchanged
- Overall appearance: Consistent with rest of app, but retains financial color coding for clarity

- [ ] **Step 8: Commit**

```bash
cd frontend
git add app/components/caja/
git commit -m "refactor(caja): migrate caja components to semantic tokens while preserving financial color coding"
```

---

## Phase 6: Migrate Ventas & Pagos Pages (Already Mostly Semantic)

### Task 13: Audit & Minor Updates for Ventas & Pagos Pages

**Files:**
- Read: `frontend/app/pages/ventas/index.vue`
- Read: `frontend/app/pages/ventas/historial.vue`
- Read: `frontend/app/pages/ventas/[id].vue`
- Read: `frontend/app/pages/pagos/index.vue`

**Pattern:** Ventas and Pagos modules already use semantic tokens extensively (text-muted, text-default, border-default, hover:bg-elevated). These pages are the baseline — verify no hardcoded colors exist.

**Steps:**

- [ ] **Step 1: Verify ventas/index.vue uses semantic tokens**

Scan: No hardcoded `text-gray-*`, `divide-gray-*`, `bg-gray-*` in main page logic ✓

- [ ] **Step 2: Verify ventas/historial.vue**

Scan: Uses `text-muted`, `border-default`, `hover:bg-elevated` ✓
Minor check: Line ~50: `text-gray-500` if present → `text-muted`

- [ ] **Step 3: Verify ventas/[id].vue**

Scan: Uses semantic tokens ✓
Check: Lines ~215 (totals card): `text-green-600 dark:text-green-400` — this is intentional (profit/discount color) — keep as is ✓

- [ ] **Step 4: Verify pagos/index.vue**

Scan: Uses UTable with semantic styling ✓
No changes needed.

**Result:** Ventas and Pagos pages already follow design system correctly. No code changes required. Document as second exemplar (first being dashboard pages).

---

### Task 14: Audit & Minor Updates for Ventas & Pagos Components

**Files:**
- Read: `frontend/app/components/ventas/`
- Read: `frontend/app/components/pagos/`

**Pattern:** Nearly all ventas and pagos components use semantic tokens (text-muted, text-default, border-default).

**Steps:**

- [ ] **Step 1: Verify CarritoPanel.vue uses semantic tokens**

Scan: `text-muted`, `text-default`, `border-default`, `hover:ring-2 hover:ring-primary-500` ✓

- [ ] **Step 2: Verify CatalogoGrid.vue**

Scan: `text-muted`, `text-default`, `text-primary-600`, `hover:ring-2 hover:ring-primary-500` ✓

- [ ] **Step 3: Verify ClienteForm.vue**

Scan: `text-default`, `border-default`, `pt-3` ✓

- [ ] **Step 4: Verify CobroModal.vue & AbonoModal.vue**

Scan: `text-muted`, `text-default`, `border-default`, `text-error` ✓

**Result:** All ventas and pagos components already use semantic tokens. No code changes required. These serve as the design system baseline.

---

## Phase 7: Shared Components & Documentation

### Task 15: Create Design System Documentation

**Files:**
- Create: `frontend/docs/DESIGN-SYSTEM.md`

**Steps:**

- [ ] **Step 1: Create design system documentation**

```markdown
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
- **divide-default**: For `divide-y` lists
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

## Migration Checklist

When adding a new page or updating an existing one:
- [ ] Replace `text-gray-500` with `text-muted`
- [ ] Replace `text-gray-400` with `text-muted`
- [ ] Replace `text-gray-900 dark:text-white` with `text-default`
- [ ] Replace `bg-gray-50 dark:bg-gray-950` with `bg-elevated`
- [ ] Replace `divide-gray-100 dark:divide-gray-800` with `divide-default`
- [ ] Replace `border-gray-200 dark:border-gray-700` with `border-default`
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
```

- [ ] **Step 2: Verify documentation is clear and complete**

Expected: Design system doc is self-contained and allows new developers to understand and follow the pattern.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add docs/DESIGN-SYSTEM.md
git commit -m "docs(design): add design system guide for semantic token usage"
```

---

### Task 16: Update CLAUDE.md with Design System Addendum

**Files:**
- Modify: `CLAUDE.md` (project instructions)

**Steps:**

- [ ] **Step 1: Add Design System section to CLAUDE.md**

Append to the "Convenciones" section:

```markdown
### Design System (Nuxt UI Semantic Tokens)

All pages and components **must** use Nuxt UI semantic tokens for colors instead of hardcoded Tailwind utilities:

**Never use:**
```css
text-gray-500          /* ✗ Hardcoded neutral text */
divide-gray-100 dark:divide-gray-800  /* ✗ Hardcoded divider */
bg-white dark:bg-gray-900  /* ✗ Hardcoded card background */
```

**Always use:**
```css
text-muted             /* ✓ Semantic secondary text */
divide-default  /* ✓ Semantic divider */
bg-default             /* ✓ Semantic card background */
```

Reference `docs/DESIGN-SYSTEM.md` for complete token list and usage examples. Dashboard pages (`app/pages/index.vue`, `app/pages/test.vue`), Ventas module, and Items configuration page exemplify correct usage.

**Exception:** Financial semantic colors (green/red/blue) in Caja module are intentional and should be retained for clarity.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(design): add semantic token guidelines to CLAUDE.md"
```

---

## Phase 8: Verification & Final Review

### Task 17: Visual Testing - Light & Dark Modes at Multiple Viewports

**Files:**
- Test: All 32 pages at 1024px and 375px viewports

**Steps:**

- [ ] **Step 1: Start dev server**

```bash
cd frontend
npm run dev
```

- [ ] **Step 2: Test Auth Pages (Light Mode, 1024px)**

- Navigate to `/login` — verify white card on light gray background, text readable
- Navigate to `/register` — consistent styling
- Navigate to `/forgot-password` — consistent styling
- Navigate to `/no-tenant` — primary-colored accent icon on light background
- Navigate to `/select-tenant` — tenant cards have avatar colors, consistent bg

Expected: All auth pages render with consistent semantic styling.

- [ ] **Step 3: Test Auth Pages (Dark Mode, 1024px)**

Open DevTools → Emulate CSS media feature `prefers-color-scheme: dark`

Repeat step 2 in dark mode.

Expected: All auth pages render with consistent dark mode colors (dark grays, white text). Contrast is readable.

- [ ] **Step 4: Test Configuration Pages (Light Mode, 1024px)**

- Navigate to `/configuracion/items`, `/configuracion/descuentos`, `/configuracion/metodos-pago`
- Verify headers use text-default and text-muted
- Verify list dividers are consistent
- Verify modals render with semantic tokens

Expected: All config pages use consistent token-based styling.

- [ ] **Step 5: Test Configuration Pages (Dark Mode, 1024px)**

Switch to dark mode and repeat step 4.

Expected: Dark mode rendering is consistent and readable.

- [ ] **Step 6: Test Caja Pages (Light & Dark, 1024px)**

- Navigate to `/caja`
- Open a caja (if available)
- Verify:
  - Section backgrounds use semantic tokens (text-muted for secondary text)
  - Financial indicators (green/red/blue) remain visually distinct and unchanged
  - Borders and dividers use token-based colors

Expected: Caja pages maintain financial color coding while using semantic tokens for neutral text/borders.

- [ ] **Step 7: Test Ventas Pages (Light & Dark, 1024px)**

- Navigate to `/ventas`, `/ventas/historial`, `/ventas/[id]`

Expected: Ventas pages (already using semantic tokens) render correctly without visual changes.

- [ ] **Step 8: Test at Mobile Viewport (375px)**

Use DevTools to resize to 375px width (mobile).

- Navigate to at least 3-5 pages (login, select-tenant, items, descuentos, caja)
- Verify:
  - Text wraps correctly
  - Cards and modals are readable
  - Buttons are tappable (≥44px height)
  - Colors remain accessible (WCAG AA contrast)

Expected: Mobile layout is responsive and readable. No color or spacing issues specific to mobile.

- [ ] **Step 9: Test Dark Mode at Mobile (375px)**

Repeat step 8 in dark mode.

Expected: Mobile dark mode is accessible and readable.

---

### Task 18: Automated Testing & Build Verification

**Files:**
- Test: No changes; run existing test suite

**Steps:**

- [ ] **Step 1: Run frontend linter**

```bash
cd frontend
npm run lint
```

Expected: No errors or warnings. If ESLint issues appear, fix them in the relevant files before committing.

- [ ] **Step 2: Run TypeScript type check**

```bash
cd frontend
npm run typecheck  # or npx tsc --noEmit if no typecheck script
```

Expected: No type errors.

- [ ] **Step 3: Run unit tests (if any exist for components)**

```bash
cd frontend
npm test
```

Expected: All tests pass. If tests fail due to hardcoded color references in test snapshots, update snapshots to match new semantic token usage.

- [ ] **Step 4: Build for production**

```bash
cd frontend
npm run build
```

Expected: Build succeeds with no warnings related to Tailwind or CSS. Output size should be unchanged or slightly smaller (fewer duplicate utility classes).

- [ ] **Step 5: Commit final verification**

```bash
git status  # Should show no uncommitted changes (all previous commits completed)
```

Expected: All work committed. No pending changes.

---

## Summary

**Total Tasks:** 18  
**Total Files Modified:** 32 pages + 10 components + 1 config file + 2 docs  
**Key Changes:**
1. Created `app.config.ts` with Nuxt UI design token definitions
2. Migrated 32 pages from hardcoded Tailwind colors to semantic tokens
3. Updated 10 shared components for consistency
4. Created `docs/DESIGN-SYSTEM.md` with usage guidelines
5. Updated `CLAUDE.md` with design system rules
6. Verified all pages visually at light/dark modes and multiple viewports

**Outcome:** 
- Consistent design language across all modules
- Single source of truth for colors (app.config.ts)
- Automatic dark mode support
- Easier to maintain and extend
- Team can follow documented patterns for future development

---

## Execution Notes

- **Commits:** Frequent (one per file group or logical change)
- **Testing:** Manual visual testing in browser + automated tests
- **Review:** Page-by-page visual verification before final merge to main
- **Rollback:** If issues arise, each commit is independent and can be reverted
- **Time Estimate:** ~4-6 hours for experienced developer, ~8-10 hours for new contributor
