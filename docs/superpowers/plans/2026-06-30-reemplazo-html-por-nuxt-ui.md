# Plan: Reemplazo de HTML crudo por componentes Nuxt UI

Status: Draft
Date: 2026-06-30
Owner: Cesar Matheus

## Context

El frontend ya está mayormente construido sobre Nuxt UI v4 (114 `UButton`, 106
`UFormField`, 84 `UInput`, 31 `UCard`, etc.). Sin embargo, quedan focos de HTML
crudo que conviene migrar a componentes Nuxt UI para: (a) consistencia visual
claro/oscuro vía tokens semánticos, (b) accesibilidad, (c) sorting/paginación y
slots de celda gratis en tablas, (d) estructura de formulario consistente.

**Nota de alcance:** este plan es puramente de reemplazo de elementos HTML por
componentes Nuxt UI. **La validación de formularios (Standard Schema, reglas,
mensajes de error) queda fuera de alcance** — no se introduce ni se modifica.

Auditoría inicial (`grep` sobre `app/**/*.vue`):

| Elemento crudo | Ocurrencias | Archivos |
|---|---|---|
| `<table>` (bloques) | 8 | pagos, ventas/historial, ventas/[id], inventario, items, CajaHistorial, descuentos*, recargos* |
| `<form>` | 6 | login, register, roles/index, roles/[id], PerfilForm, ContrasenaForm |
| `<ul>/<li>` (listados) | 13 | páginas de configuración + CarritoPanel, CajaActivaDashboard |
| `<label>` sueltos | 2 | dentro de formularios crudos |
| headings/`<span>` | varios | audit de bajo impacto |

\* `descuentos` y `recargos`: el `<table>` es el **editor de tramos** dentro del
modal — patrón editable documentado (ver §9 de `docs/patterns/frontend.md`), **NO
se convierte**. Su listado principal es `<ul>`.

Referencias leídas antes de planificar: `docs/patterns/frontend.md` (§6 template,
§9 tabla editable de tramos), skill `nuxt-ui` (recipe data-tables, index de
componentes).

## Scope / Out of scope

**In scope**
- Migrar las 6 tablas de **datos de solo lectura** a `UTable`.
- Envolver los 6 `<form>` crudos con `UForm` (estructura/submit, sin schema).
- Mover `<label>` sueltos dentro de `UFormField`.
- Auditar listas `<ul>/<li>`: convertir a `UTable` las que son datos tabulares;
  conservar las de diseño intencional.
- Audit de bajo impacto: `<span>` de estado → `UBadge`, separadores → `USeparator`.

**Out of scope**
- **Validación de formularios** (Standard Schema, `:schema`, reglas de negocio,
  mensajes de error) — no se toca; se conserva la validación/manejo de errores
  que ya exista tal cual está.
- Editor de **tramos** (descuentos/recargos) — patrón editable documentado, se
  mantiene como `<table>` + `<UInput>` por celda (frontend.md §9).
- Listas de diseño intencional: `CarritoPanel`, `CajaActivaDashboard` (no son
  datos tabulares, son UI de producto).
- Cambios de lógica de negocio, endpoints o stores. Solo capa de presentación.
- Colores financieros hardcoded en módulo Caja (excepción documentada en CLAUDE.md).

## Backend

Sin cambios. Este plan es exclusivamente de frontend/presentación.

## Frontend

### Fase 1 — Tablas de datos → `UTable` (mayor valor)

Patrón por tabla: definir `columns: TableColumn<T>[]` en `<script setup>`, usar
slots `#<col>-cell="{ row }"` para monto (`formatMonto` con `font-mono`), badges
de estado y links; `#empty` para el estado vacío; `:loading` atado al status de
fetch. Filas clickeables vía `:ui="{ tr: 'cursor-pointer' }"` + `@select`.
Mantener `formatMonto`/`formatFecha` desde `useFormatters` (no redefinir).

- [ ] `app/pages/pagos/index.vue` — tabla de pagos (badges de estado, celda
  link "Ver venta", paginación ya existente → conectar `UPagination` al table API).
- [ ] `app/pages/ventas/historial.vue` — historial de ventas (filas clickeables a
  detalle, badges de canal/estado, saldo con color de warning).
- [ ] `app/pages/ventas/[id].vue` — tabla de líneas de venta (descripción,
  cantidad, precio unit., total línea; solo lectura).
- [ ] `app/pages/configuracion/inventario.vue` — kardex de movimientos (badges de
  tipo/motivo, cantidades con color).
- [ ] `app/components/caja/CajaHistorial.vue` — historial de cajas. **Nota:** tiene
  filas expandibles (`toggleTodas`). Usar el slot `#expanded` de `UTable` +
  `getExpandedRowModel`; validar que la interacción de expandir se preserve.
- [ ] `app/pages/configuracion/items.vue` — listado principal de items (badges de
  tipo/estado, columna de acciones con `UDropdownMenu`, click de fila → editar).

### Fase 2 — Formularios → `UForm`

**Sin validación por schema** (fuera de alcance). Solo se reemplaza el `<form>`
crudo por `UForm` como wrapper estructural: `:state` con el objeto reactivo ya
existente, `@submit` reemplaza `@submit.prevent`. La validación/manejo de
errores actual (si existe, p.ej. mensajes manuales o checks en el handler) se
deja intacto tal cual está — no se introduce `:schema` ni se cambia la lógica
de error. Conservar estados `:loading`/`:disabled` actuales.

- [ ] `app/pages/login.vue` — `<form @submit.prevent="onLogin">` → `UForm`.
- [ ] `app/pages/register.vue` — `<form @submit.prevent="onRegister">` → `UForm`.
- [ ] `app/pages/configuracion/roles/index.vue` — form de creación en modal.
- [ ] `app/pages/configuracion/roles/[id].vue` — form de edición.
- [ ] `app/components/configuracion/PerfilForm.vue` — datos de perfil.
- [ ] `app/components/configuracion/ContrasenaForm.vue` — cambio de contraseña.

### Fase 3 — `<label>` sueltos → `UFormField`

- [ ] Localizar los `<label>` crudos restantes (`grep -rnE "<label" app`) y
  moverlos al prop `label`/slot de `UFormField`, asegurando `for`/`id` implícito.

### Fase 4 — Listas `<ul>/<li>` (audit + conversión selectiva)

Revisar cada archivo; convertir a `UTable` solo las listas que son **datos
tabulares con columnas**; conservar las de diseño de producto.

- [ ] `app/pages/configuracion/roles/index.vue` — lista de roles → evaluar `UTable`
  (nombre, tipo, acciones) vs mantener como lista de tarjetas.
- [ ] Auditar y decidir por archivo: `categorias`, `impuestos`, `metodos-pago`,
  `monedas`, `razones-sociales`, `usuarios/index`, `descuentos`, `recargos`,
  `items` (listado). Documentar en cada uno: convertir vs conservar (con motivo).
- [ ] **Conservar** (marcar como decididos, sin cambios): `CarritoPanel.vue`,
  `CajaActivaDashboard.vue`, `ventas/[id].vue` (lista de pagos si aplica).

### Fase 5 — Audit de bajo impacto (headings / spans)

- [ ] `grep` de `<span>` con clases de color/estado → reemplazar por `UBadge`
  donde represente un estado/etiqueta.
- [ ] Revisar headings `h1`–`h3` sueltos: mantener como HTML semántico salvo que
  encajen en `UDashboardNavbar`/header de `UCard`. Sin cambios masivos.
- [ ] Reemplazar divisores manuales (`border-t`, `<hr>`) por `USeparator` donde
  aplique.

## Verification

Por cada archivo tocado:
- [ ] `cd frontend && npm run build` sin errores de tipos/plantilla.
- [ ] Verificación manual (frontend.md §8): render en claro y oscuro, sin colores
  Tailwind hardcoded (solo tokens semánticos).
- [ ] Tablas: sorting/paginación/estado vacío/filas clickeables funcionan igual
  que antes; formato monetario con `font-mono` intacto.
- [ ] Formularios: submit y loading funcionan igual que antes; el manejo de
  errores existente (si lo hay) no cambia de comportamiento.
- [ ] `CajaHistorial`: la expansión de filas sigue operando.
- [ ] Diff de screenshots antes/después para confirmar que no hay regresión visual.

## Decisions / Open questions

- **Validación de formularios**: confirmado fuera de alcance. `UForm` se usa solo
  como wrapper estructural (`:state` + `@submit`), sin `:schema`.
- **Tramos (descuentos/recargos)**: confirmado que **se mantienen** como tabla
  editable cruda (patrón documentado §9). No convertir.
- **Filas clickeables en `UTable`**: validar la API vigente (`@select` vs
  `:ui.tr` + `onSelect`) contra la versión instalada de `@nuxt/ui`.
- **Alcance de listas (Fase 4)**: la conversión es selectiva; la decisión final
  por archivo se toma en la auditoría y se registra en el checkbox correspondiente.
