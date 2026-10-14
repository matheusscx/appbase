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
- `razones_sociales` — CRUD completo con soft delete. Además de los datos legales lleva los del
  emisor de boleta electrónica: `giro`, `comuna`, `ambiente_sii` (certificación o producción),
  `fecha_resolucion` y `numero_resolucion`. **No se editan en `/configuracion/razones-sociales`**
  sino en `/configuracion/boleta-electronica` (`PATCH /dte/perfil`).
- `pais`, `provincia` — solo lectura (catálogos)

## Decisiones de diseño

- `tenantId` siempre del JWT, nunca del body.
- `TenantAdminGuard` protege mutaciones (POST/PATCH/DELETE); GET solo requiere `TenantGuard`.
- Sub-tenants (`sub_tenants`) fuera de alcance: tabla reservada.
- `calculo_descuentos` no es editable aquí: corresponde a config de precios.
- `habilitado` default `false` en razones sociales: el admin activa explícitamente.
- **Una razón social con folios (CAF) o certificado vigente cargados no cambia de RUT ni se
  borra** (`PATCH` con un RUT distinto y `DELETE` dan 400). Por qué: el CAF y el certificado se
  emitieron para ese RUT; cambiarlo, o borrar la razón social, dejaría esos documentos firmando
  a nombre de otro. La comparación es sobre el RUT normalizado: reescribir el mismo RUT con
  puntos o sin guion no es un cambio, y el resto de los datos se sigue editando. Los folios sin usar
  se quitan desde el perfil fiscal —que lista solo los CAF de la razón social preferida de hoy;
  los de una ex emisora no se ven en ninguna parte, y la salida es volver a marcarla preferida—, pero **un CAF que ya entregó folios no se puede quitar**: una
  razón social que ya emitió queda fija aunque no tenga certificado. El certificado vigente, hoy,
  solo se reemplaza (no hay ruta que lo quite), así que con uno cargado también queda fija. Es
  decisión del owner (2026-10-14): un RUT distinto es otro contribuyente, y para cambiarlo se crea
  otra razón social. El chequeo corre bajo el mismo
  `FOR UPDATE` que las subidas del perfil fiscal, así que no se cruza con una en curso.
