# Design: Módulo de Configuración — Perfil de Usuario

**Status:** Approved  
**Date:** 2026-06-21  
**Owner:** Cesar Matheus

---

## Context

Primera fase del módulo de Configuración. El sistema no tenía forma de que los usuarios editaran sus propios datos ni cambiaran su contraseña. Esta spec cubre exactamente eso.

---

## Decisions

- **Visibilidad:** Ítem fijo en el footer del sidebar (sin RBAC), visible para todos los usuarios autenticados.
- **Estructura de página:** Una sola `/configuracion` con dos secciones: información personal + cambiar contraseña.
- **Backend:** Módulo dedicado `/me` (no extender `auth`). Solo `JwtAuthGuard`, sin RBAC.
- **Estado frontend:** No requiere store Pinia. Tras éxito, llama `authStore.updateUser(...)` para refrescar nombre en navbar.

---

## Out of scope

- Gestión de usuarios del tenant
- Configuración de datos de la empresa/tenant
- Configuración de monedas, catálogos financieros
- Avatar/foto de perfil

---

## Backend

**Módulo:** `backend/src/modules/me/`

| Método | Ruta | Guard | Descripción |
|--------|------|-------|-------------|
| `PATCH` | `/me/perfil` | JwtAuthGuard | Actualiza nombre, apellido, teléfono |
| `PATCH` | `/me/contrasena` | JwtAuthGuard | Cambia contraseña (valida actual) |

**DTOs:**
- `UpdatePerfilDto`: nombre?, apellido?, telefono? (todos opcionales)
- `UpdateContrasenaDto`: contrasenaActual, contrasenaNueva (min 8), confirmarContrasena

**Seguridad en cambio de contraseña:**
1. `bcrypt.compare(actual, hash)` — si falla → 401
2. `nueva === confirmar` — si falla → 400
3. `bcrypt.hash(nueva, 10)` — guardar nuevo hash

---

## Frontend

**Archivos nuevos:**
- `pages/configuracion.vue` — layout dashboard, dos secciones
- `components/configuracion/PerfilForm.vue`
- `components/configuracion/ContrasenaForm.vue`

**Archivos modificados:**
- `layouts/dashboard.vue` — agregar `settingsItems` con UNavigationMenu en #footer
- `stores/auth.ts` — agregar campo `telefono` al tipo `User` y método `updateUser(partial)`

---

## Verification

1. `docker-compose up --build`
2. Login con cualquier usuario → ítem "Configuración" visible en sidebar
3. `/configuracion` pre-rellena con datos del usuario
4. Guardar nombre → toast éxito → sidebar actualiza nombre
5. Cambiar contraseña con contraseña incorrecta → 401 / toast error
6. `PATCH /me/perfil` sin token → 401
