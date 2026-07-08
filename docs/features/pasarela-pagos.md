# Feature: Pasarela de pagos multi-proveedor (v1 Oneclick)

**Status**: Complete (v1)
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-08

---

## Overview

### What is it?

Un módulo de pasarela de pagos **independiente** dentro del backend
(*"junto pero no revuelto"*): modela integraciones con proveedores de pago
de forma agnóstica y expone dos superficies de consumo:

- **Administración del tenant** (`/pasarela/admin/*`, JWT + RBAC): el admin
  configura qué pasarelas usa (Oneclick, y a futuro Webpay/Stripe…), en modo
  **MALL** (bajo el comercio de la plataforma) o **INDIVIDUAL** (con sus
  propias credenciales), y genera/revoca **API keys** para sus apps externas.
- **API máquina-a-máquina** (`/pasarela/api/*`, API key): las apps del tenant
  inscriben medios de pago, cobran, reembolsan y consultan estado — sin pasar
  por el login de usuarios. Un tenant puede contratar **solo** la pasarela.

v1 integra **Transbank Oneclick** (tokenización de tarjeta + cobro recurrente)
contra su ambiente de integración real.

### Why does it exist?

Habilita cobros reales (hoy el checkout de la tienda y las suscripciones usan
una pasarela dummy) y abre la pasarela como servicio consumible por apps
externas del tenant, con el modelo de datos preparado para sumar proveedores
sin cambios estructurales.

### Scope

- **Incluido (v1)**: módulo `gateway` con Oneclick real, API keys por tenant,
  cifrado de credenciales, historial inmutable de transacciones, pantalla de
  administración del tenant (config, API keys, órdenes).
- **NO incluido (fases futuras)**: reconectar suscripciones/tienda a la
  pasarela real, job de cobro recurrente automático, Webpay Plus / Stripe /
  MercadoPago, webhooks entrantes, failover por `prioridad`, y rotación de la
  clave de cifrado.

---

## API Endpoints

Prefijo global `/api`. Dos mundos de autenticación + un retorno público.

### Administración (JWT + TenantGuard + PermisosGuard, módulo RBAC "Pasarelas")

```
GET    /api/pasarela/admin/pasarelas-disponibles   # catálogo global (Leer)
GET    /api/pasarela/admin/config                  # config del tenant (Leer)
POST   /api/pasarela/admin/config                  # alta (Crear)
PATCH  /api/pasarela/admin/config/:id              # edición write-only (Actualizar)
DELETE /api/pasarela/admin/config/:id              # baja (Eliminar)
GET    /api/pasarela/admin/api-keys                # listar (Leer)
POST   /api/pasarela/admin/api-keys                # crear — key visible UNA vez (Crear)
DELETE /api/pasarela/admin/api-keys/:id            # revocar (Eliminar)
GET    /api/pasarela/admin/ordenes                 # listado paginado (Leer)
GET    /api/pasarela/admin/ordenes/:id             # detalle + transacciones (Leer)
```

### API m2m (ApiKeyGuard — `Authorization: Bearer pk_...`)

```
POST   /api/pasarela/api/inscripciones             # inicia tokenización → {inscripcionId, urlWebpay, token}
GET    /api/pasarela/api/inscripciones?pagadorRef= # inscripciones del pagador
GET    /api/pasarela/api/inscripciones/:id         # detalle (nunca expone tbkUser)
DELETE /api/pasarela/api/inscripciones/:id         # elimina en proveedor + soft delete
POST   /api/pasarela/api/cobros                     # cobra con tarjeta guardada
POST   /api/pasarela/api/cobros/:ordenId/reembolsos # reembolso parcial/total
POST   /api/pasarela/api/ordenes/:id/verificar      # reconcilia una orden en_proceso
GET    /api/pasarela/api/ordenes/:id                # detalle de orden
```

### Retorno de Webpay (público — la credencial es el TBK_TOKEN de un solo uso)

```
GET|POST /api/pasarela/retorno/inscripcion         # confirma y redirige 302 a la app
```

### Ejemplo — cobro

```
POST /api/pasarela/api/cobros
Authorization: Bearer pk_<40 chars>

Request:
{
  "pagadorRef": "cliente-demo-1",
  "referenciaExterna": "venta-42",
  "monto": "5990",
  "descripcion": "Cobro de prueba"
}

Response (200):
{
  "ordenId": "uuid",
  "codigoOrden": "O...",
  "estado": "pagada",
  "monto": "5990",
  "moneda": "CLP",
  "codigoAutorizacion": "1213",
  "tipoPago": "VN"
}
```

---

## Backend

### Módulo y estructura

`src/modules/pasarela/` — regla de frontera: **no importa** módulos de
negocio (ventas/pagos/suscripciones/items); ellos importan `PasarelaModule`
e inyectan sus services públicos.

- **Controllers**: `pasarela-admin`, `pasarela-api`, `pasarela-retorno`.
- **Services**: `credenciales` (AES-256-GCM + resolución MALL/INDIVIDUAL),
  `api-keys` (SHA-256), `tenant-pasarela` (config write-only),
  `transacciones` (historial inmutable + redacción), `inscripciones`
  (tokenización), `cobros` (orden→authorize→estados, reembolso, verificar).
- **Providers**: interfaz `PaymentProvider` + `ProviderFactory` +
  `OneclickProvider` (HTTP con `fetch` nativo).
- **Guard**: `ApiKeyGuard` (resuelve `tenantId` desde la key).

### Tablas (7)

| Tabla | Rol |
|---|---|
| `pasarelas` | catálogo global de proveedores (seed); credenciales mall de la plataforma **cifradas** |
| `tenant_pasarela` | qué pasarela usa el tenant, modo/ambiente, `configuracion` **cifrada** |
| `pasarela_api_keys` | keys m2m — solo `key_hash` (SHA-256) + `prefijo` |
| `pasarela_inscripciones` | inscripción del pagador; `identificador_externo` (tbkUser) **cifrado**; `pagador_ref` opaco |
| `pasarela_medios_pago` | tarjetas registradas (marca, últimos 4) |
| `pasarela_ordenes` | intención de pago; sin FK duras a ventas/pagos (`referencia_externa` opaca) |
| `pasarela_transacciones` | historial **inmutable**; `request`/`response` **redactados**; único parcial por idempotencia |

Convenciones del repo: UUID PK/FK `type:'uuid'`, soft delete `eliminado_el`,
`creado_el`/`actualizado_el`, `numeric` para dinero (Decimal.js).

### Máquinas de estado

- **Orden**: `creada → en_proceso → pagada | fallida | expirada` (+ `reembolsada`).
- **Transacción**: `iniciada → aprobada | rechazada | error`.
- **Inscripción**: `pendiente → procesando → activa | fallida | eliminada`
  (`procesando` es el claim atómico transitorio del retorno de Webpay).

### Invariante crítico

Un **timeout / error de red** contra el proveedor NUNCA se interpreta como
rechazo: la transacción queda `error`, la orden **permanece `en_proceso`**, y
se responde `502` indicando verificar el estado con `.../verificar`. Solo un
`response_code != 0` explícito del proveedor marca `fallida`.

---

## Frontend

### Página

`frontend/app/pages/pasarelas.vue` (layout dashboard, tokens semánticos,
componentes CRUD del repo), con tres tabs:

1. **Mis pasarelas**: lista de `tenant_pasarela`; drawer de alta/edición con
   credenciales **write-only** (al editar muestran `••••`; en modo individual
   exige reingresar las 3 credenciales juntas para no borrar las intactas).
2. **API Keys**: lista + crear (modal muestra la key completa **una sola vez**
   con botón copiar) + revocar.
3. **Órdenes**: listado paginado (`usePaginatedList`) con estado y monto.

Link del sidebar y botones gated por RBAC (`can('Pasarelas', <permiso>)`).

---

## Seguridad

- **API keys**: formato `pk_<40 chars>`; en BD solo `key_hash` (SHA-256) +
  `prefijo`. El guard resuelve `tenantId` desde la key (la app externa jamás
  manda tenant_id).
- **Cifrado en reposo**: AES-256-GCM, clave `PASARELA_ENCRYPTION_KEY` (32
  bytes base64) en `.env`, blob `v1:iv:tag:data`. Cifra configuraciones,
  `identificador_externo` y `token_externo`. Verificado: el commerce code no
  aparece en claro en la BD.
- **Redacción**: `request`/`response` de transacciones enmascaran
  credenciales/tokens (`tbk_user`, `Tbk-Api-Key-Secret`, `authorization`…)
  antes de persistir.

---

## Testing

### Unit (backend)

```bash
cd backend && npm test -- pasarela   # 42 tests, 7 suites
```

Cubren: cifrado round-trip, API keys (hash/prefijo/exposición única),
contrato del provider (rechazo ≠ error, CLP entero, timeout), config
write-only, redacción + inmutabilidad del historial, flujo de inscripción
(claim atómico, compensación), cobro/reembolso/verificar (timeout seguro,
saldo Decimal.js).

### E2E opt-in contra Transbank

```bash
cd backend && RUN_TRANSBANK_E2E=1 npx jest --config ./test/jest-e2e.json pasarela-oneclick
```

Golpea el ambiente de integración real (skipped en `npm test` normal).

### Verificación manual de punta a punta

Con el stack arriba (`docker-compose up -d`):

1. Login admin (`admin.paris@paris.cl` / `admin`) → `switch-tenant` al tenant
   Paris → el sidebar muestra "Pasarelas".
2. Tab "Mis pasarelas": aparece Transbank Oneclick (Mall · Pruebas, sembrada).
3. Tab "API Keys": crear → la key `pk_...` se muestra una sola vez.
4. Inscripción vía API key (`POST /api/pasarela/api/inscripciones`) → abrir
   `urlWebpay`, ingresar la tarjeta de prueba **VISA 4051 8856 0044 6623**
   (CVV cualquiera, RUT `11.111.111-1`, clave `123`) → el backend redirige a
   la `urlRetorno` con `?inscripcionId=…&estado=activa`.
5. Cobro (`POST /api/pasarela/api/cobros`) → `estado: "pagada"`.
6. Reembolso (`POST /api/pasarela/api/cobros/:ordenId/reembolsos`).
7. Tab "Órdenes": la orden aparece con su estado y monto.
8. Revocar la API key → reintentar el cobro → 401.

---

## Risks & Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Timeout del proveedor malinterpretado como rechazo | Cobro perdido / doble cobro | Orden queda `en_proceso`; endpoint `.../verificar` reconcilia contra el proveedor |
| Doble retorno de Webpay (reintento) | Inscripción/medio duplicado | Claim atómico `pendiente→procesando`; compensación a `pendiente` si el provider falla |
| Reembolsos concurrentes exceden el total | Sobre-reembolso | `reembolsar()` corre dentro de una transacción con lock pesimista (`SELECT … FOR UPDATE`) de la fila de la orden: dos reembolsos sobre la misma orden se serializan; el segundo ve el REFUND del primero y no puede exceder el saldo. La auditoría de un timeout se registra **fuera** de la transacción (tras el rollback que libera el lock) para no auto-bloquearse contra el `FOR UPDATE` vía la FK de `pasarela_transacciones` |
| Orden con timeout marcada `expirada` por reloj (deja de ser reconciliable) | Cobro real dado por perdido | `obtenerOrden()` no expira perezosamente órdenes con una transacción `AUTHORIZATION 'error'` (hubo intento); `verificar()` además acepta órdenes `expirada`. Solo la reconciliación con el proveedor las cierra |
| Credenciales expuestas | Fraude | Cifrado AES-256-GCM en reposo, API keys hasheadas, redacción de logs |

---

## Related Features

- [Suscripciones](./suscripciones.md) — consumidor futuro (cobro recurrente).
- Tienda Online — checkout, consumidor futuro.
- [ADR-008](../adr/008-cifrado-credenciales-pasarela.md) — cifrado de credenciales.

---

## Notes

- El módulo es extraíble a microservicio sin reescritura (regla de frontera).
- `pagador_ref` y `referencia_externa` son `varchar` opacos: la app
  consumidora correlaciona con lo que use (uuid, rut, folio); la pasarela no
  valida esa entidad.
