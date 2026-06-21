# ADR-003: Decodificar JWT en cliente sin librería + patrón híbrido JWT/store

**Status**: Accepted

**Date**: 2026-06-20

## Context

El backend emite un `access_token` JWT con claims `{ sub, email, tenant_id, es_superadmin, iat, exp }`. El frontend necesita leer `tenant_id` y `es_superadmin` para tomar decisiones de routing (flujo post-login, guard del middleware) y mostrar información contextual (nombre del tenant activo, enlace admin).

Teníamos dos preguntas:
1. ¿Cómo leer los claims del JWT en el cliente?
2. ¿Dónde vive el estado del tenant activo?

## Decision

### 1. Decodificar el JWT en el cliente con `atob` nativo, sin librería

```typescript
function decodeJwt(token: string): JwtPayload | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64)) as JwtPayload
  } catch {
    return null
  }
}
```

No se verifica la firma — eso lo hace el backend en cada request. El cliente solo necesita *leer* los claims para tomar decisiones de UI; la autorización real ocurre server-side.

### 2. Patrón híbrido: JWT como autoridad + store de presentación

- **`activeTenantId` e `isSuperadmin`**: computados derivados del JWT (`decodeJwt(token.value)`). Son la fuente de autoridad. Se actualizan automáticamente tras cada `setToken()` (switch-tenant, refresh).
- **`useTenantStore`**: store de presentación. Guarda `[{ tenantId, nombre }]` obtenidos de `GET /auth/my-tenants`. Solo para nombres y la lista — nunca para saber cuál es el tenant activo.

```
JWT payload  →  activeTenantId (computed, autoridad)
             ↓
useTenantStore.tenants  →  activeTenant.nombre (presentación)
```

## Consequences

### Positive

- No dependencia externa para JWT decode (zero bundle impact)
- `activeTenantId` siempre consistente con el token real — no hay estado duplicado que pueda desincronizarse
- El switch de tenant es atómico: `setToken(newToken)` actualiza `activeTenantId` instantáneamente sin acciones adicionales
- El refresh de token preserva el `tenant_id` porque el backend lo guarda en `active_tenant_id` del refresh token; el frontend no necesita hacer nada extra

### Negative

- El cliente confía en el payload sin verificar la firma; un token manipulado podría hacer que el frontend tome decisiones de routing incorrectas — mitigado porque el backend rechaza tokens inválidos en cada API call
- La dependencia circular `useAuthStore → useTenantStore → useAuthStore` existe en runtime; funciona porque Pinia resuelve stores lazy, pero es una deuda de diseño

### Neutral

- `GET /auth/my-tenants` devuelve todos los tenants del usuario, no solo el activo; el activo se determina cruzando la lista con `activeTenantId` del token
- Los nombres de tenant en `useTenantStore` se cargan on-demand; si el store no tiene datos, la UI muestra `—` hasta que `fetchMyTenants()` complete
