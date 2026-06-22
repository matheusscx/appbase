---
name: razon-social-preferida
description: Agregar campo "preferida" a razones sociales — una por tenant, marcada con estrella en la UI, usada como default en selects
metadata:
  type: project
  status: Approved
  date: 2026-06-22
  owner: Cesar Matheus
---

# Plan: Razón social preferida

## Context

Las razones sociales de un tenant necesitan tener una "preferida" que se use como valor por defecto en los selects de facturación. El usuario la marca desde la tabla de configuración haciendo clic en un ícono de estrella. Solo puede haber una preferida por tenant a la vez. Hacer clic en la estrella de la ya preferida no hace nada.

## Scope

**In scope:**
- Columna `preferida` en `razones_sociales`
- Endpoint `PATCH /tenants/razones-sociales/:id/preferida`
- Estrella interactiva en cada row de la tabla (antes del switch)
- Update optimista en frontend con rollback en error
- Toast de éxito

**Out of scope:**
- Integración con selects de facturación (se hace cuando se construya ese módulo)
- Restricción de que la preferida deba estar habilitada

## Backend

### Entidad
Agregar a `RazonSocial`:
```typescript
@Column({ default: false })
preferida: boolean;
```
TypeORM sync crea la columna automáticamente en dev.

### Service — `setPreferida(tenantId: string, id: string): Promise<RazonSocial>`
Dentro de una transacción:
1. Verificar que la razon social existe y pertenece al tenant (404 si no).
2. `UPDATE razones_sociales SET preferida = false WHERE tenant_id = $tenantId AND eliminado_el IS NULL`
3. `UPDATE razones_sociales SET preferida = true WHERE razon_social_id = $id`
4. Retornar la entidad actualizada.

### Controller
```
PATCH /api/tenants/razones-sociales/:id/preferida
```
- Guard: `TenantAuthGuard` (usuario autenticado con tenant activo)
- Sin body
- Responde con la `RazonSocial` actualizada

## Frontend

### Interface
```typescript
interface RazonSocial {
  // ...existentes...
  preferida: boolean
}
```

### Función `togglePreferida(rs: RazonSocial)`
- Si `rs.preferida === true` → return (no-op)
- Si hay otro en `razones.value` con `preferida = true` → se limpia localmente
- `rs.preferida = true` (optimista)
- Llama `PATCH /tenants/razones-sociales/:id/preferida`
- En error: revierte y muestra toast de error
- En éxito: toast "Razón social preferida actualizada"

### UI — estrella en el row
- Antes del `USwitch`, separado del grupo de botones
- `i-heroicons-star` solid + color amarillo (`text-yellow-400`) cuando `preferida === true`
- `i-heroicons-star` outline + color neutro cuando `preferida === false`
- `cursor-pointer` y hover sutil
- Deshabilitado mientras se procesa (`toggling.has(rs.id)`)

## Decisions

- **No se puede des-marcar la preferida** haciendo clic en ella — solo se puede cambiar seleccionando otra.
- **No hay índice único parcial en BD** en esta fase (dev usa sync, no migrations). La unicidad se garantiza a nivel de servicio dentro de una transacción.
- **No se valida** que la preferida deba estar habilitada — el producto no lo requiere.
