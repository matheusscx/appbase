# Auditoría de estandarización UI — Frontend

**Fecha:** 2026-07-01 (cierre completo)  
**Alcance:** `frontend/app/` (51 archivos `.vue`: 33 páginas + 18 componentes)  
**Referencias:** `frontend/docs/DESIGN-SYSTEM.md`, `.cursor/rules/nuxt-ui-frontend.mdc`, `docs/ARCHITECTURE.md` (rutas)

---

## Resumen ejecutivo

El frontend está **estandarizado** en tokens semánticos, componentes Nuxt UI, iconos Lucide, convenciones transversales y componentes CRUD reutilizables. No quedan clases Tailwind crudas de escala `gray-*` en ningún `.vue`.

**Completado (2026-07-01):**

| Área | Estado |
|------|--------|
| Tokens semánticos (`text-muted`, `text-default`, `border-default`, …) | ✅ |
| `text-highlighted` en links/acentos | ✅ |
| `text-default` en cabeceras (`CrudPageHeader` o manual) | ✅ |
| `UForm` en empresa, preferencias, usuarios (modal roles) | ✅ |
| `USelectMenu` en modales cobro/abono | ✅ |
| `formatMonto` en CatalogoGrid e items | ✅ |
| `space-y-6` raíz en items/inventario | ✅ |
| `border-default` sidebar config | ✅ |
| Iconos Lucide (`i-lucide-*`) | ✅ |
| Componentes CRUD (`app/components/crud/`) en todas las páginas config CRUD | ✅ |
| Excepciones branding documentadas | ✅ |
| Avatares tenant → `UAvatar` semántico | ✅ |
| Rutas canónicas documentadas | ✅ |

**Único pendiente manual:** capturas de regresión visual claro/oscuro (opcional, en browser).

---

## Excepciones intencionales (no deuda)

| Patrón | Ubicación | Motivo |
|--------|-----------|--------|
| `bg-primary-600` + `text-white` en logos | auth, dashboard sidebar | Branding fijo |
| `bg-primary-50 dark:bg-primary-950` | index, no-tenant | Superficie decorativa |
| Colores financieros verde/rojo/azul | módulo Caja | Claridad contable |
| `<table>` editable | descuentos, recargos (tramos) | Patrón §9 `frontend.md` |
| `<ul>/<li>` | CarritoPanel, CajaActivaDashboard, VentaDetalleDrawer | UI de producto |
| `<button>` toggle password | login, register | Patrón Nuxt UI en trailing slot |
| Redirects legacy | ver § Rutas | Compat. bookmarks |

---

## Componentes CRUD (`app/components/crud/`)

| Componente | Uso |
|------------|-----|
| `CrudPageHeader` | Título + subtítulo; prop `large` para catálogos (`items`, `inventario`) |
| `CrudTable` | `UCard` + `UTable` + empty state |
| `CrudListItem` | Celda nombre (título + subtítulo) |
| `CrudModal` | Confirmación eliminar |

**Adoptado en:** categorias, metodos-pago, impuestos, descuentos, recargos, razones-sociales, roles, monedas, usuarios, inventario, items (+ empresa/preferencias solo header).

---

## Rutas canónicas (frontend)

| Pantalla | Ruta |
|----------|------|
| Historial ventas + detalle drawer | `/ventas` · `?venta={uuid}` |
| Punto de venta | `/ventas/pos` |
| Ledger pagos | `/pagos` |
| Config perfil (hub) | `/configuracion/perfil` |
| Roles (lista + editor drawer) | `/configuracion/roles` |

**Redirects compatibilidad:** `/ventas/historial` → `/ventas` · `/ventas/:id` → `/ventas?venta=:id` · `/configuracion` → `/configuracion/perfil` · `/configuracion/roles/:id` → `/configuracion/roles`

Detalle: `docs/ARCHITECTURE.md`, `docs/features/ventas.md`.

---

## Matriz por módulo

| Módulo | Colores | UTable | UForm | AppDrawer | Lucide | CRUD components |
|--------|---------|--------|-------|-----------|--------|-----------------|
| Auth | ✅ | — | ✅ | — | ✅ | — |
| Tenant | ✅ | — | — | — | ✅ | — |
| Dashboard | ✅ | — | — | — | ✅ | — |
| Config | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ventas | ✅ | ✅ | parcial POS | ✅ detalle | ✅ | — |
| Caja | ✅ (+ fin.) | ✅ | ✅ | — | ✅ | — |
| Pagos | ✅ | ✅ | ✅ modal | — | ✅ | — |

---

## Baselines (referencia)

- `pages/configuracion/categorias.vue` — CRUD completo con componentes `crud/*`
- `pages/login.vue` — auth + tokens + Lucide
- `pages/pagos/index.vue` — listado filtros + UTable
- `pages/ventas/index.vue` — historial + drawer detalle
- `components/AppDrawer.vue` — shell drawer
- `layouts/dashboard.vue` — nav Lucide, `/configuracion/perfil`

---

## Checklist nuevas páginas

- [ ] Iconos Lucide (`i-lucide-*`)
- [ ] Links/acentos: `text-highlighted`
- [ ] Cabecera: `CrudPageHeader` o `h2.text-lg.font-semibold.text-default`
- [ ] Raíz: `space-y-6`
- [ ] Formularios: `UForm` + `@submit`
- [ ] Selects: `USelectMenu`
- [ ] Montos: `formatMonto` desde `useFormatters`
- [ ] Panel lateral: `AppDrawer` con `#actions`

---

*Auditoría inicial 2026-07-01. Cierre y alineación documentación 2026-07-01.*
