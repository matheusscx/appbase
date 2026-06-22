# Feature: Gestión de Tenants y Razones Sociales

**Módulo:** Configuración — Empresa / Razones sociales  
**Estado:** ✅ Implementado  
**Fecha:** 2026-06-22

## Qué hace

Permite al administrador de un tenant editar los datos de su propia empresa (nombre, correo, teléfono, dirección, provincia) y gestionar el CRUD de sus razones sociales (datos legales para facturación).

## Rutas backend

| Método | Ruta | Guard | Descripción |
|---|---|---|---|
| GET | /api/catalog/paises | JwtAuth | Lista todos los países |
| GET | /api/catalog/provincias?paisId= | JwtAuth | Lista provincias, filtrable por país |
| GET | /api/tenants/me | JwtAuth + Tenant | Datos del tenant activo |
| PATCH | /api/tenants/me | JwtAuth + Tenant + TenantAdmin | Edita datos del tenant |
| GET | /api/tenants/razones-sociales | JwtAuth + Tenant | Lista razones sociales del tenant |
| POST | /api/tenants/razones-sociales | JwtAuth + Tenant + TenantAdmin | Crea razón social |
| PATCH | /api/tenants/razones-sociales/:id | JwtAuth + Tenant + TenantAdmin | Edita razón social |
| DELETE | /api/tenants/razones-sociales/:id | JwtAuth + Tenant + TenantAdmin | Soft delete |

## Páginas frontend

- `/configuracion/empresa` — Form editable con datos del tenant + selector de país/provincia
- `/configuracion/razones-sociales` — Tabla + modal CRUD; visible solo para admins del tenant

## Tablas DB

- `tenants` — se edita vía PATCH /tenants/me
- `razones_sociales` — CRUD completo con soft delete
- `pais`, `provincia` — solo lectura (catálogos)

## Decisiones de diseño

- `tenantId` siempre del JWT, nunca del body.
- `TenantAdminGuard` protege mutaciones (POST/PATCH/DELETE); GET solo requiere `TenantGuard`.
- Sub-tenants (`sub_tenants`) fuera de alcance: tabla reservada.
- `calculo_descuentos` no es editable aquí: corresponde a config de precios.
- `habilitado` default `false` en razones sociales: el admin activa explícitamente.
