# Design: Menú desplegable de usuario

**Status:** Approved  
**Date:** 2026-06-21  
**Owner:** Cesar Matheus

---

## Problem

El avatar y nombre del usuario en `AppNavbar.vue` son decorativos: no tienen interactividad. El usuario necesita acceso rápido a su perfil, cambio de institución (tenant) y cierre de sesión sin abandonar la pantalla actual.

## Solution

Convertir el área de avatar+nombre en un trigger de `UDropdownMenu` (Nuxt UI v4), extrayendo la lógica a un componente `UserMenu.vue`.

---

## Visual

```
┌─────────────────────────┐
│ 👤 Juan Pérez           │  ← header no-clickable (content-top slot)
│    Empresa ABC          │
│    Administrador        │
├─────────────────────────┤
│   Mi Cuenta             │  → /configuracion/perfil
│   Cambiar Institución   │  → /select-tenant  (solo si tenants.length > 1)
├─────────────────────────┤
│   Cerrar Sesión         │  → authStore.logout()
└─────────────────────────┘
```

---

## Architecture

### `UserMenu.vue` (nuevo)

Encapsula:
- **Trigger:** button con `UAvatar` + nombre + rol, reemplaza el `div` actual de AppNavbar
- **Dropdown:** `UDropdownMenu` de Nuxt UI v4 con:
  - Slot `#content-top`: header no-interactivo con avatar grande, nombre, tenant activo, rol
  - Items group 1: Mi Cuenta + Cambiar Institución (condicional)
  - Items group 2: Cerrar Sesión (color error)

### `AppNavbar.vue` (modificado)

El `div.flex.items-center.gap-2` con avatar y nombre se reemplaza por `<UserMenu />`. Los stores `useAuthStore` y `usePermissionsStore` se eliminan del navbar (se mueven al UserMenu).

---

## Data Sources

| Campo           | Fuente                                  |
|-----------------|-----------------------------------------|
| Nombre completo | `authStore.user?.nombre + apellido`     |
| Avatar          | `UAvatar :alt="fullName"`               |
| Tenant activo   | `tenantStore.activeTenant?.nombre`      |
| Rol             | `permissionsStore.esAdmin` / `isSuperadmin` |

---

## Key Decisions

- `tenantStore.tenants` ya está cargado por `handlePostLogin()` — sin fetch extra en el componente
- "Cambiar Institución" navega a `/select-tenant` existente (reutiliza la página, sin lógica nueva)
- La opción se oculta si el usuario tiene un solo tenant (sin sentido cambiar)
- `authStore.logout()` ya hace: POST /auth/logout → clearAuth() → navigateTo('/login')
- `#content-top` slot de `UDropdownMenu` permite header antes del viewport de items sin modificar el array de items
