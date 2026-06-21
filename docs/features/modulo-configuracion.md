# Feature: Módulo de Configuración — Perfil de Usuario

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-06-21

---

## Overview

### What is it?

Una página `/configuracion` accesible para todos los usuarios autenticados (ítem fijo al fondo del sidebar, sin RBAC). Permite al usuario editar su información personal (nombre, apellido, teléfono) y cambiar su contraseña.

### Why does it exist?

El sistema no tenía forma de que los usuarios actualizaran sus propios datos ni cambiaran su contraseña. Es la base del módulo de configuración, sobre el que se construirán secciones de administración de tenant en fases futuras.

### Scope

- **Incluido:**
  - `PATCH /me/perfil` — actualizar nombre, apellido, teléfono
  - `PATCH /me/contrasena` — cambiar contraseña (valida actual, hashea nueva con bcrypt)
  - Página `/configuracion` con dos formularios: información personal + cambio de contraseña
  - Ítem "Configuración" fijo en el footer del sidebar, visible para todos los usuarios autenticados
  - El navbar se actualiza automáticamente tras guardar cambios de nombre

- **NO incluido (fases futuras):**
  - Gestión de usuarios del tenant
  - Configuración de datos de la empresa/tenant
  - Configuración de monedas, catálogos financieros
  - Avatar/foto de perfil
  - Preferencias de UI (idioma, tema)

---

## API Endpoints

### PATCH /me/perfil

```
PATCH /api/me/perfil

Authorization: Bearer <token>

Request:
{
  "nombre": "Juan",
  "apellido": "Pérez",
  "telefono": "+56 9 1234 5678"
}

Response (200): Usuario actualizado (sin campo contrasena)
```

### PATCH /me/contrasena

```
PATCH /api/me/contrasena

Authorization: Bearer <token>

Request:
{
  "contrasenaActual": "oldpass",
  "contrasenaNueva": "newpass123",
  "confirmarContrasena": "newpass123"
}

Response (200):
{
  "message": "Contraseña actualizada"
}

Errors:
- 401: Contraseña actual incorrecta
- 400: Las contraseñas no coinciden
- 400: Usuario sin contraseña (OAuth)
```

---

## Backend

### Module & Services

- **Module**: `src/modules/me/me.module.ts`
- **Controller**: `src/modules/me/me.controller.ts`
- **Service**: `src/modules/me/me.service.ts`

### DTOs

- `UpdatePerfilDto` — `nombre?`, `apellido?`, `telefono?` (todos opcionales, IsString)
- `UpdateContrasenaDto` — `contrasenaActual` (required), `contrasenaNueva` (required, min 8), `confirmarContrasena` (required)

### Key Methods

- `meService.updatePerfil(userId, dto)` — PATCH nombre/apellido/teléfono, retorna usuario actualizado
- `meService.updateContrasena(userId, dto)` — valida actual con bcrypt, hashea nueva, actualiza BD

### Guards

Solo `JwtAuthGuard` — sin RBAC, sin tenant context. El `userId` viene del payload JWT (`req.user.id`).

---

## Frontend

### Pages

- `pages/configuracion.vue` — página única con dos secciones

### Components

- `components/configuracion/PerfilForm.vue` — formulario de datos personales, actualiza `authStore.user` tras éxito
- `components/configuracion/ContrasenaForm.vue` — formulario de cambio de contraseña, siempre vacío

### Pinia Store

No requiere store dedicado. Usa `$fetch` vía `useApiFetch` directamente en los componentes.

Tras un `PATCH /me/perfil` exitoso, llama `authStore.updateUser({ nombre, apellido, telefono })` para que el sidebar refleje el nombre actualizado en tiempo real.

### Sidebar

En `layouts/dashboard.vue`, ítem "Configuración" agregado como `settingsItems` en el footer del `UDashboardSidebar`, usando `UNavigationMenu`. Siempre visible para usuarios autenticados.

---

## Data Flow

```
[Usuario edita nombre en PerfilForm]
  ↓ @submit.prevent="guardar"
[PATCH /api/me/perfil]
  ↓
[MeController → MeService.updatePerfil(userId, dto)]
  ↓
[repo.update(userId, dto) → repo.findOneOrFail]
  ↓
[Retorna Usuario actualizado]
  ↓
[authStore.updateUser({ nombre, apellido, telefono })]
  ↓
[Sidebar muestra nuevo nombre inmediatamente]
```

---

## Testing

### Manual Testing

1. Levantar: `docker-compose up --build`
2. Login con cualquier usuario (ej. `vendedor@paris.cl`, contraseña `vendedor123`)
3. Verificar ítem "Configuración" en el footer del sidebar
4. Navegar a `/configuracion` — ver formularios pre-rellenos
5. Editar nombre → guardar → toast éxito → nombre actualizado en sidebar
6. Cambiar contraseña con contraseña correcta → éxito, campos se limpian
7. Intentar contraseña actual incorrecta → toast error "Contraseña actual incorrecta"
8. Verificar en Swagger (`/api/docs`) que `PATCH /me/perfil` sin Bearer → 401

---

## Related Features

- [Autenticación JWT](auth.md)
- [Multi-tenant frontend](frontend-multitenant.md)
