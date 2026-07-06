# Feature: Terceros

**Status**: Complete
**Owner**: —
**Last Updated**: 2026-07-04

---

## Overview

### What is it?

Un directorio de entidades externas del tenant: proveedores, empresas compradoras y
personas naturales recurrentes. No tienen acceso al sistema — son registros de
referencia reutilizables. Cada tercero tiene datos de contacto y datos de facturación
(nombre legal / RUT fiscal).

Al registrar una venta en el POS, se puede seleccionar un tercero existente para
autocompletar los datos del cliente (nombre, RUT, dirección, teléfono, correo) en
vez de reingresarlos.

### Why does it exist?

`docs/PRODUCTO.md §4b`. Evita reingresar datos de compradores frecuentes en cada
venta y sirve como referencia para proveedores en compras/documentos futuros.

### Scope

- Included: CRUD de terceros (tenant-scoped, soft delete); selector de tercero en el
  POS que autocompleta los datos de facturación de la venta (`venta_customer.tercero_id`);
  módulo RBAC propio "Terceros" (`Leer`/`Crear`/`Actualizar`/`Eliminar`), asignable a
  roles no-admin.
- NOT included (future): módulo de compras a proveedores; búsqueda remota paginada
  en el picker (hoy precarga los terceros activos).

---

## API Endpoints

### `GET /terceros`

Lista los terceros del tenant (ordenados por nombre). Requiere `Terceros:Leer`
(`PermisosGuard` + `@RequiresPermiso`). El picker del POS es "atajo opcional": si el
usuario no tiene el permiso, el fetch falla en silencio y el formulario de cliente se
completa a mano.

### `POST /terceros`

Requiere `Terceros:Crear`.

```
Request:
{
  "tipo": "proveedor",       // 'proveedor' | 'empresa' | 'persona_natural'
  "nombre": "Distribuidora Andina",
  "rut": "76.123.456-7",
  "nombreLegal": "Distribuidora Andina SpA",
  "rutFiscal": "76.123.456-7",
  "correo": "contacto@andina.cl",
  "telefono": "+56 2 2345 6789",
  "direccion": "Av. Providencia 1234, Santiago",
  "activo": true
}

Response (201): el tercero creado (incluye tercero_id, creado_el, etc.)
```

### `PATCH /terceros/:id`

Requiere `Terceros:Actualizar`. Mismos campos, todos opcionales.

### `DELETE /terceros/:id`

Requiere `Terceros:Eliminar`. Soft delete (`eliminado_el`).

---

## Backend

### Module & Services

- **Module**: `backend/src/modules/terceros/terceros.module.ts`
- **Controller**: `backend/src/modules/terceros/terceros.controller.ts`
- **Service**: `backend/src/modules/terceros/terceros.service.ts`

### Entity & Database

**Table**: `terceros` (definida en `startup-pos.sql`, sin cambios de esquema)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `tercero_id` | UUID | PK | |
| `tenant_id` | UUID | FK → `tenants` | siempre desde el token |
| `tipo` | TEXT | NOT NULL | `proveedor` \| `empresa` \| `persona_natural` |
| `nombre` | VARCHAR(100) | NOT NULL | |
| `rut` | VARCHAR(50) | nullable | |
| `nombre_legal` | VARCHAR(100) | nullable | razón social para facturación |
| `rut_fiscal` | VARCHAR(50) | nullable | |
| `correo` | VARCHAR(100) | nullable | |
| `telefono` | VARCHAR(50) | nullable | |
| `direccion` | TEXT | nullable | |
| `activo` | BOOLEAN | default true | |
| `eliminado_el` | TIMESTAMPTZ | nullable | soft delete |

`venta_customer.tercero_id` referencia esta tabla (FK nullable, ya existente).

### DTOs

- `CreateTerceroDto` — `tipo` (`@IsIn`), `nombre` requerido, resto opcional
- `UpdateTerceroDto` — mismos campos, todos opcionales

### Key Methods

- `TercerosService.findAll(tenantId)` — lista ordenada por nombre
- `TercerosService.create(tenantId, dto)` — crea con `activo` default `true`
- `TercerosService.update(tenantId, id, dto)` — 404 si no pertenece al tenant
- `TercerosService.remove(tenantId, id)` — soft delete

### Seed

`SeederService.seedTerceros()` — 3 terceros de ejemplo (un proveedor, una empresa,
una persona natural) en el tenant PARIS, IDs fijos desde
`550e8400-e29b-41d4-a716-446655440147`.

---

## Frontend

### Pages

- `frontend/app/pages/terceros.vue` — CRUD completo (listar, crear, editar,
  eliminar, activar/desactivar), página top-level en el sidebar principal.

### Components

- Reusa `app/components/crud/` (`CrudPageHeader`, `CrudTable`, `CrudListItem`,
  `CrudModal`) y `AppDrawer` para el formulario — mismo patrón que
  `pages/configuracion/categorias.vue`.
- `frontend/app/components/ventas/ClienteForm.vue` — agrega un `USelectMenu`
  "Tercero registrado" que precarga `GET /terceros` y autocompleta
  nombre/rut/dirección/teléfono/correo al seleccionar uno.

### State

Estado local (`ref`), sin store — sigue la convención de páginas de configuración
(Pinia se reserva para datos cacheados entre pantallas).

---

## Data Flow

### Seleccionar tercero en el POS

```
[Usuario abre "Datos del cliente" en el POS]
  ↓
[ClienteForm carga GET /terceros al montar]
  ↓
[Usuario selecciona un tercero en el USelectMenu]
  ↓ watch(terceroSeleccionado)
[Autocompleta nombre/rut/direccion/telefono/email + fija terceroId]
  ↓ confirmarCobro() en pos.vue
[POST /ventas con body.customer.terceroId]
  ↓
[VentasService persiste venta_customer.tercero_id]
```

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/terceros/terceros.service.spec.ts
```

### Manual Testing (Frontend)

1. `docker-compose up`
2. Navegar a `/terceros`: crear, editar, desactivar y eliminar un tercero
3. En `/ventas/pos`, abrir datos del cliente y seleccionar un tercero → verificar
   autocompletado
4. Confirmar la venta y verificar `customer.terceroId` en el detalle (`GET /ventas/:id`)

---

## Acceptance Criteria

- [x] Endpoints CRUD implementados y con tests unitarios de servicio
- [x] Página `/terceros` y nav en sidebar
- [x] Seed de datos de desarrollo
- [x] Selector de tercero en el POS con autocompletado
- [x] Docs actualizadas (este archivo, `docs/README.md`, `CLAUDE.md`)

---

## Related Features

- [ventas.md](./ventas.md) — flujo de venta donde se integra el selector de tercero
