# Plan: Menú desplegable de usuario en la navbar

**Status:** Done  
**Date:** 2026-06-21  
**Owner:** Cesar Matheus  
**Spec:** [../specs/2026-06-21-user-dropdown-menu-design.md](../specs/2026-06-21-user-dropdown-menu-design.md)

---

## Context

El avatar y nombre en la navbar son decorativos. Se agrega un `UDropdownMenu` que permite acceder a Mi Cuenta, cambio de institución y cerrar sesión directamente desde la navbar.

---

## Tasks

- [x] Crear spec `docs/superpowers/specs/2026-06-21-user-dropdown-menu-design.md`
- [x] Crear `frontend/app/components/UserMenu.vue`
- [x] Modificar `frontend/app/components/AppNavbar.vue`
- [x] Eliminar redirect en `frontend/app/pages/select-tenant.vue` (bloqueaba el acceso con tenant activo)
- [x] Verificar en el navegador
- [x] Commit

---

## Files

| Archivo | Acción |
|---------|--------|
| `frontend/app/components/UserMenu.vue` | Crear |
| `frontend/app/components/AppNavbar.vue` | Modificar (reemplazar div por `<UserMenu />`) |

---

## Verification

1. Clic en avatar/nombre → se abre el dropdown
2. Header muestra nombre, tenant activo y rol (no clickeable)
3. Clic fuera → se cierra
4. "Mi Cuenta" → navega a `/configuracion/perfil`
5. "Cambiar Institución" visible solo si hay 2+ tenants → navega a `/select-tenant`
6. Seleccionar tenant en `/select-tenant` → actualiza contexto y navega a `/`
7. "Cerrar Sesión" → limpia auth, redirige a `/login`
