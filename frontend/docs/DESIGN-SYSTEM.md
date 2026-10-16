# Design System — Nuxt UI Semantic Tokens

## Overview
All pages and components use Nuxt UI v4 semantic design tokens for colors, spacing, and typography. This ensures consistency across the entire application and makes dark mode support automatic.

## Identidad Venka

La marca de la app es **Venka** (fuente de la marca, fuera del monorepo:
`/Users/m2pro/cmatheus/publicidad/marca/IDENTIDAD.md`). Paleta "Petróleo y menta", fondo blanco.

| Token | Valor | Uso |
|---|---|---|
| `primary` = escala `venka` | 50 `#E9F8FB` · 100 `#D9ECEF` · 200 `#B9D3D8` · 300 `#8EB2B9` · 400 `#588993` · **500 `#0E4D57`** · 600 `#003E48` · 700 `#003038` · 800 `#002329` · 900 `#00181D` · 950 `#000D11` | `--ui-primary` en claro es el 500, el petróleo de marca exacto (blanco encima: 9,47:1) |
| `neutral` | `slate` | Grises fríos de Nuxt UI |
| `menta` (`bg-menta`, `text-menta`) | `#7FD8C3` | Sello, marca de la sección activa, acentos sobre petróleo |
| `lima` (`bg-lima`) | `#C9E77E` | Acento de la línea Almacén (sin validar por el owner) |
| `success` = escala `exito` | **500 `#00786F`** (verde petróleo) | Pagada, caja abierta, cifras positivas. Texto: 5,36:1 sobre blanco, 4,68:1 sobre el fondo `/10` |
| `warning` = escala `alerta` | **500 `#C53C00`** | Avisos, pendientes. Texto: 5,22:1 sobre blanco, 4,52:1 sobre `/10` |
| `error` = escala `peligro` | **500 `#C10007`** | Errores, anulado, cifras negativas. Texto: 6,42:1 sobre blanco, 5,35:1 sobre `/10` |

- **Tonos de estado** (owner, 2026-10-16, opción B de la lámina; auditoría UX 00.8): los de Nuxt UI
  por defecto medían 2,22 / 1,91 / 3,81 sobre blanco, debajo del 4,5:1 de un texto. Como en
  `venka`, el 500 es el tono elegido (es el que resuelve `text-success` y compañía) y el resto de
  la escala sale del mismo matiz en OKLCH. Ojo: el `/15` del hover de los botones suaves da 4,18
  en ámbar; es transitorio y no se usa para texto quieto. `e2e/layout/marca.spec.ts` mide lo que
  resuelve el navegador.
- **Insignias: 12 px como mínimo** (owner, 2026-10-16; auditoría UX 01.17 y 05.17). `UBadge` en
  `xs` y `sm` venía en 8 y 10 px; `app.config.ts` les pone `text-xs` y deja su relleno compacto.

- **Letras:** DM Sans es `--font-sans`, la de toda la interfaz. Bricolage Grotesque es
  `font-display`, **solo** para títulos de pantalla (`AppNavbar`, `AppMarco`) y titulares de marca.
  Las dos se sirven desde `public/fonts/` (woff2 latino, variables, `font-display: swap`, con su
  `OFL-*.txt`) y se precargan en `nuxt.config.ts`; nada de Google Fonts ni `@nuxt/fonts`.
  **Las cifras de DM Sans miden lo mismo** (modificada, ver el aviso en `OFL-dm-sans.txt`): el
  original las trae proporcionales y sin `tnum`, así que se regenera con
  `scripts/fuente-digitos-fijos.py` desde el TTF de origen. No hace falta `tabular-nums` para
  alinear montos (con la fuente nueva es inocuo). El avance está igualado en `hmtx`, en `HVAR`
  **y** en los puntos fantasma de `gvar`, porque cada motor lee el avance de un lugar distinto.
  Con solo `hmtx` y `HVAR` igualados, macOS medía bien y el Chromium de Linux del CI no: diez
  «1» medían 30 px menos que diez «0» a 32 px. `e2e/layout/marca.spec.ts`
  lo vigila (los diez dígitos, 4 pesos, 2 tamaños) y corre en Linux en CI.
- **Logos:** `public/marca/venka-positivo.svg` (fondo claro), `venka-negativo.svg` (petróleo) y
  `venka-sello.svg` (cuadrado, menú colapsado). El texto va en trazos: no depende de la fuente.
- **Dónde vive:** las escalas, `menta`, `lima` y las fuentes en el `@theme static` de
  `app/assets/css/main.css` (`static` porque Nuxt UI arma `--ui-color-primary-*` en runtime y
  Tailwind descartaría las variables sin uso); la asignación de colores (`primary`, `neutral` y los tres de estado) y el tamaño de las insignias en
  **`app/app.config.ts`**, el único: Nuxt 4 lee el de `app/` (srcDir). Hasta el 2026-10-16 había
  otro en la raíz de `frontend/` con alias y overrides de `card`, `modal` y `formField` que nunca se
  cargaron; se borró (owner, auditoría UX 00.1) y la app quedó con los rellenos por defecto de Nuxt UI.
- **Lo que no cambia de color:** los colores financieros de Caja y el verde y rojo de sube/baja.

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
- **text-error / text-warning / text-success**: estados. Resuelven al 500 de `peligro`,
  `alerta` y `exito` (ver Identidad Venka); no usar `text-red-*` ni similares.

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

| Patrón | Dónde | Motivo |
|--------|-------|--------|
| Marco de las pantallas sin layout | `components/AppMarco.vue`, usado por `login`, `register`, `forgot-password`, `select-tenant`, `no-tenant` y las tres de link (`confirmacion`, `verificar`, `invitacion`) | Logo positivo arriba, título en `font-display`; el ícono de la acción va en una placa `bg-primary/10` con `text-primary` |
| Panel de marca del ingreso | `pages/login.vue` (slot `lateral` de `AppMarco`, solo ≥ `lg`) | `bg-primary` con texto blanco, `primary-100` y `primary-200` (≥ 6:1 medido); tarjeta de cierre en `bg-primary-600`; puntos `bg-menta` y `bg-lima` |
| Menú lateral petróleo | `layouts/dashboard.vue` (`sobrePetroleo`) | Reasigna los tokens semánticos **dentro** del lateral a la escala clara, así los estados de `UNavigationMenu` salen solos sobre petróleo; la sección activa lleva una marca `bg-menta` de 3 px; el nombre del local usa `text-highlighted`, que ahí resuelve a `primary-50` |
| `bg-primary-50 dark:bg-primary-950` | `index.vue` | Superficie de acento decorativa en la bienvenida |
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
3. **Shell con borde** — `AppDrawer` lleva **`px-6`** horizontal y **`py-4`** vertical en header/body/footer. `UCard` y `UModal` usan los rellenos **por defecto de Nuxt UI** (no hay override global); si una pantalla necesita otro, va por su prop `ui`.
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

### Elección entre alternativas — selector, no radio buttons

Para elegir entre opciones homogéneas (ej. la opción de un grupo de
modificadores: "elige tu proteína"), usar `USelectMenu`/`USelect` de Nuxt UI
— **simple** cuando solo se puede elegir 1 (`max === 1`), **múltiple** cuando
se pueden elegir varias (`max > 1`). No usar radio buttons/checkboxes para
esto: con varios bloques de elección en el mismo drawer (ej. un combo que
pregunta el grupo de cada componente, por unidad), una lista de radios por
bloque crece demasiado. Ejemplo real: `components/ventas/ItemPersonalizacionGrupo.vue`
(ver `docs/adr/015-grupos-anidados-combo-un-nivel.md`).

```vue
<USelectMenu
  v-model="opcionElegida"
  :items="opciones"
  :multiple="grupo.max > 1"
  placeholder="Elegir..."
/>
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
| `CrudTable` | `UCard` + `UTable` con empty state por defecto y ancho completo (`w-full`) |
| `CrudListItem` | Celda nombre: título + subtítulo muted |
| `CrudModal` | Confirmación de eliminación (cancel + confirm) |
| `CrudPausarModal` | Confirmación de **pausa** sobre `CrudModal`: dice a cuántos ítems afecta y promete la reversibilidad. Va con `usePausaRegla()` |

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
- **Buscar iconos:** [icones.js.org/collection/lucide](https://icones.js.org/collection/lucide), MCP `search_icons` de Nuxt UI, o copiar del menú lateral (`composables/useMenuLateral.ts`) / `pages/configuracion.vue`.
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
- [ ] Page sections: `space-y-6`; form fields: `space-y-4`; drawer shell: `px-6 py-4` (card y modal: relleno por defecto de Nuxt UI); nested bordered UI: `px-4`
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

La paleta y las letras viven en el `@theme static` de `frontend/app/assets/css/main.css`; la asignación de colores de Nuxt UI (`ui.colors`) y los defaults de componentes, en **`frontend/app/app.config.ts`**, que es el que Nuxt 4 carga (no hay otro: ver [Identidad Venka](#identidad-venka)).

## Dark Mode Support

Nuxt UI v4 provides automatic dark mode support via Tailwind CSS's `dark:` prefix. All semantic tokens include both light and dark variants. No additional configuration is needed — dark mode is enabled by default based on system preferences or user selection in the UI.

To test dark mode during development:
1. Open DevTools (F12)
2. Cmd+Shift+P (or Ctrl+Shift+P on Linux/Windows)
3. Search "prefers-color-scheme"
4. Select "dark" to emulate dark mode

All pages should render consistently with proper contrast and readability in both modes.
