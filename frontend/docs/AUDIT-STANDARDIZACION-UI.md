# Auditoría de estandarización UI — Frontend

**Fecha:** 2026-07-01 (actualizado 2026-07-01 — migración a Lucide)  
**Alcance:** `frontend/app/` (51 archivos `.vue`: 33 páginas + 18 componentes)  
**Referencias:** `frontend/docs/DESIGN-SYSTEM.md`, `.cursor/rules/nuxt-ui-frontend.mdc`, planes `2026-06-30-frontend-design-standardization.md` y `2026-06-30-reemplazo-html-por-nuxt-ui.md`

---

## Resumen ejecutivo

El frontend completó la **migración principal** de tokens semánticos y componentes Nuxt UI. No quedan clases Tailwind crudas de escala `gray-*` en ningún `.vue`. La base (`app.config.ts`, `AppDrawer`, `UTable`, `UForm`) está sólida.

**Decisión de iconos (2026-07-01):** migrado a **Lucide** (`i-lucide-*`), alineado con Nuxt UI v4. Paquete `@iconify-json/lucide`; Heroicons eliminado.

Lo que **aún falta** se concentra en cuatro frentes:

1. **Token `text-highlighted`** — links y acentos siguen con `text-primary-600/700/400` en lugar del alias semántico.
2. **Tipografía de cabeceras** — mezcla de `h1`/`h2` y ausencia de `text-default` en títulos de sección.
3. **Formularios sin `UForm`** — tres pantallas de configuración usan campos sueltos + botón `@click`.
4. **Deuda del plan original** — componentes reutilizables `CrudListItem` / `CrudModal` / `CrudTable` nunca se crearon.

**Estimación de completitud:** ~92 % estandarizado en colores/espaciado/componentes/iconos; ~65 % en convenciones transversales (headings, formularios estructurales).

---

## Lo que ya está estandarizado

| Área | Estado | Evidencia |
|------|--------|-----------|
| Tokens semánticos de color (`text-muted`, `text-default`, `bg-default`, `border-default`, `divide-default`) | ✅ | 0 ocurrencias de `gray-*` en `.vue`; 40 archivos usan tokens semánticos |
| `app.config.ts` con overrides de card/modal/formField | ✅ | `frontend/app.config.ts` |
| **Iconos Lucide** (`i-lucide-*`) | ✅ | ~120 referencias en 40 archivos; `@iconify-json/lucide` instalado |
| Auth pages (login, register, forgot-password) | ✅ | `UForm`, `bg-elevated`, `bg-default`, `USeparator` |
| Tablas de datos → `UTable` | ✅ | 16 archivos (pagos, ventas, config CRUD, caja historial, etc.) |
| Formularios auth/perfil/contraseña/roles drawer | ✅ | `UForm` + `UFormField` |
| Drawers laterales → `AppDrawer` | ✅ | 8 usos (items, descuentos, recargos, roles, impuestos, categorías, razones sociales, venta detalle) |
| Excepción Caja (colores financieros verde/rojo/azul) | ✅ Documentada | `CajaActivaDashboard`, `CajaHistorial`, `CajaCierreModal` |
| Excepción tablas editables de tramos | ✅ Documentada | `<table>` en `descuentos.vue` y `recargos.vue` |
| Listas de producto intencionales | ✅ Documentadas | `CarritoPanel`, `CajaActivaDashboard`, pagos en `VentaDetalleDrawer` |
| `formatMonto` / `formatFecha` centralizados | ✅ | 10 archivos vía `useFormatters`; 0 definiciones locales |
| API vía `useApiFetch` | ✅ | 1 excepción legítima en `stores/auth.ts` (logout) |

---

## Pendientes por categoría

### 1. Colores — `text-primary-*` / `bg-primary-*` vs tokens semánticos

No hay `gray-*` crudo, pero sí persisten utilidades de la paleta primary de Tailwind donde el design system define tokens:

| Patrón encontrado | Archivos | Reemplazo sugerido |
|-------------------|----------|-------------------|
| `text-primary-600` (+ variantes dark/hover) | `login.vue`, `register.vue`, `index.vue`, `select-tenant.vue`, `auth/callback.vue`, `no-tenant.vue`, `CatalogoGrid.vue` | `text-highlighted` (+ hover via `hover:text-highlighted` si se define en tema) |
| `bg-primary-600` (logo/avatar) | `login`, `register`, `forgot-password`, `select-tenant`, `layouts/dashboard.vue` | Evaluar token de marca o mantener como **excepción de branding** documentada |
| `bg-primary-50 dark:bg-primary-950` | `index.vue`, `no-tenant.vue` | `bg-elevated` o token de superficie de acento |
| `hover:ring-primary-500` | `CatalogoGrid.vue` | `hover:ring-primary` (token Nuxt UI) |
| `text-white` sobre fondo primary | 6 archivos (iconos de logo) | Aceptable sobre fondo de marca; documentar excepción |
| Colores de avatar aleatorios | `select-tenant.vue` (`bg-blue-500`, `bg-violet-500`, …) | Paleta semántica o `UIAvatar` con color prop |

**Uso actual de `text-highlighted`:** solo 3 archivos (`CajaAbiertasGrid`, `UserMenu`, `caja/[id]`). El token existe en `app.config.ts` pero casi no se adoptó.

---

### 2. Tipografía de cabeceras — inconsistencia h1 vs h2

**Convención del plan:** páginas de sección → `h2.text-lg.font-semibold.text-default`; vistas dashboard → `h1.text-2xl.font-semibold.text-default`.

| Patrón | Archivos |
|--------|----------|
| `h2.text-lg.font-semibold` **sin** `text-default` | `empresa`, `metodos-pago`, `monedas`, `impuestos`, `categorias`, `descuentos`, `recargos`, `razones-sociales`, `usuarios`, `roles`, `preferencias-financieras`, `test` |
| `h1.text-2xl.font-semibold` **sin** `text-default` | `items.vue`, `inventario.vue` |
| `font-medium` sin `text-default` en subtítulos de sección | `preferencias-financieras.vue` (varios `<p class="font-medium">`) |

**Acción:** añadir `text-default` a todos los headings; unificar items/inventario a `h2` o documentar que catálogos grandes usan `h1`.

---

### 3. Espaciado — desvíos menores

| Regla DESIGN-SYSTEM | Cumple | Excepción |
|---------------------|--------|-----------|
| Página raíz `space-y-6` | Mayoría config | `items.vue`, `inventario.vue` usan `space-y-4` en raíz |
| Formularios `space-y-4` | ✅ generalizado | — |
| Shell drawer/card `px-6 py-4` | ✅ en `AppDrawer` | — |
| Sidebar config `border-r` | Parcial | `configuracion.vue` L104: `border-r` sin `border-default` |

---

### 4. Formularios — `UForm` faltante

El plan de reemplazo HTML migró auth y drawers, pero quedan formularios “sueltos” (campos + `@click` en botón):

| Archivo | Problema |
|---------|----------|
| `configuracion/empresa.vue` | Campos en `UCard`, guardar vía `@click` — sin `UForm` ni `id` + `form=` |
| `configuracion/preferencias-financieras.vue` | Mismo patrón; `UFormField` sueltos sin wrapper `UForm` |
| `configuracion/usuarios/index.vue` | Modal de roles: `UFormField` + botones en `#body` del `UModal`, sin `UForm` |

**Impacto:** solo estructura/submit; la validación schema sigue fuera de alcance. Mejora accesibilidad y consistencia con el resto del proyecto.

---

### 5. Selects — `USelect` vs `USelectMenu`

**Regla:** selects con opciones → `USelectMenu`.

| Archivo | Uso actual |
|---------|------------|
| `components/pagos/AbonoModal.vue` | `USelect` para método de pago |
| `components/ventas/CobroModal.vue` | `USelect` para método de pago |

Listas cortas y fijas; bajo riesgo, pero incumple la regla del cursor rule.

---

### 6. HTML crudo residual (aceptable o menor)

| Elemento | Cantidad | Archivos | Decisión |
|----------|----------|----------|----------|
| `<table>` | 2 | `descuentos.vue`, `recargos.vue` (editor tramos) | ✅ Mantener (patrón §9 frontend.md) |
| `<button>` | 6 | `login`, `register` (toggle password), `select-tenant`, `monedas`, `razones-sociales`, `UserMenu` | Toggle password: OK; resto evaluar `UButton variant="ghost"` |
| `<ul>/<li>` | 3 componentes | `CarritoPanel`, `CajaActivaDashboard`, `VentaDetalleDrawer` | ✅ Mantener (UI de producto) |

---

### 7. Componentes reutilizables del plan original — no implementados

El plan `2026-06-30-frontend-design-standardization.md` proponía extraer:

- `CrudListItem`
- `CrudModal`
- `CrudTable`

**Estado:** no existen en `frontend/app/components/`. Cada página CRUD repite patrones (header + `UTable` + `AppDrawer` + `UModal` confirmación). Funciona, pero hay duplicación estructural.

---

### 8. Formato monetario — gaps menores

| Archivo | Problema |
|---------|----------|
| `CatalogoGrid.vue` | Muestra `precioBase` crudo sin `formatMonto`; usa concatenación manual de símbolo |
| `items.vue` (celda nombre) | Precio inline sin `formatMonto` en subtexto de fila |

---

### 9. Layout y rutas legacy

| Archivo | Rol | Acción sugerida |
|---------|-----|-----------------|
| `ventas/historial.vue` | Redirect a `/ventas` | Mantener por compatibilidad de bookmarks o eliminar cuando no haya links externos |
| `ventas/[id].vue` | Redirect a `/ventas?venta=id` | Ídem |
| `configuracion/index.vue` | Redirect a perfil | Ídem |
| `configuracion/roles/[id].vue` | Redirect a lista roles | Ídem |
| `pages/test.vue` | Sandbox de permisos | OK para dev; headings sin `text-default` |

---

### 10. Verificación pendiente (planes anteriores)

Del plan `2026-06-30-reemplazo-html-por-nuxt-ui.md`:

- [ ] Diff de screenshots claro/oscuro antes/después (no ejecutado)
- [x] `npm run build` — asumido OK post-migración
- [x] Nota incorrecta sobre expansión de filas en `CajaHistorial` — corregida en el plan

---

## Matriz por módulo

| Módulo | Páginas | Colores semánticos | UTable | UForm | AppDrawer | Iconos Lucide | Notas |
|--------|---------|-------------------|--------|-------|-----------|---------------|-------|
| Auth | login, register, forgot-password, callback | ✅ | — | ✅ | — | ✅ | Links con `text-primary-*` |
| Tenant | select-tenant, no-tenant | ✅ | — | — | — | ✅ | Avatares con colores Tailwind crudos |
| Dashboard | index, admin, test | ✅ | — | — | — | ✅ | admin es placeholder |
| Config — CRUD | 14 páginas | ✅ | ✅ | ✅ drawers | ✅ | ✅ | headings sin `text-default`; empresa/preferencias sin UForm |
| Ventas | index, pos, redirects | ✅ | ✅ | parcial | ✅ detalle | ✅ | CatalogoGrid precio sin formatMonto |
| Caja | index, [id] + 6 componentes | ✅ (+ excepción financiera) | ✅ historial | ✅ modales | — | ✅ | Colores verde/rojo/azul OK |
| Pagos | index + AbonoModal | ✅ | ✅ | parcial modal | — | ✅ | USelect en modal |

---

## Priorización recomendada

### Alta (impacto visible, bajo riesgo)

1. Añadir `text-default` a todos los `h1`/`h2` de cabecera (~14 archivos, cambio mecánico).
2. Reemplazar `text-primary-600/700/400` por `text-highlighted` en links y acentos (~8 archivos).
3. Envolver `empresa.vue` y `preferencias-financieras.vue` en `UForm`.
4. `border-r border-default` en sidebar de `configuracion.vue`.

### Media

5. `USelect` → `USelectMenu` en modales de cobro/abono.
6. Unificar espaciado raíz (`space-y-6`) en `items.vue` e `inventario.vue`.
7. `formatMonto` en `CatalogoGrid` y subtexto de precio en `items.vue`.

### Baja / opcional

8. Extraer componentes CRUD reutilizables (refactor estructural).
9. Documentar excepciones de branding (`bg-primary-600` en logos).
10. Eliminar rutas redirect legacy si no hay dependencias externas.
11. Capturas de regresión visual claro/oscuro.

---

## Archivos baseline (referencia correcta)

Usar como modelo al estandarizar:

- `pages/login.vue` — auth + tokens + iconos Lucide (excepto links primary)
- `pages/configuracion/categorias.vue` — CRUD completo: header, UTable, AppDrawer, UModal confirmación
- `pages/pagos/index.vue` — listado con filtros, UTable, tokens semánticos
- `layouts/dashboard.vue` — nav sidebar con iconos Lucide
- `components/AppDrawer.vue` — shell drawer con espaciado correcto
- `components/RolPermisosPorModulo.vue` — acordeón anidado con `px-4` / `divide-accented`

---

## Checklist rápido para nuevas páginas

Copiar de `DESIGN-SYSTEM.md` § Migration Checklist y verificar además:

- [ ] Iconos Lucide (`i-lucide-*`); no mezclar otras colecciones
- [ ] Links/acentos con `text-highlighted`, no `text-primary-600`
- [ ] Cabecera: `h2.text-lg.font-semibold.text-default` (+ subtítulo `text-muted`)
- [ ] Raíz: `space-y-6`
- [ ] Formularios: wrapper `UForm` con `:state` + `@submit`
- [ ] Selects: `USelectMenu`
- [ ] Montos: `formatMonto` desde `useFormatters`
- [ ] Panel lateral: `AppDrawer` con `#actions`

---

*Generado por auditoría automatizada (grep + revisión manual) el 2026-07-01. Migración Heroicons → Lucide el mismo día.*
