# Diseño: Pasarela de pagos multi-proveedor (v1: Oneclick + API keys + Admin UI)

- **Status:** Approved
- **Date:** 2026-07-07
- **Owner:** Cesar Matheus

## Contexto

El checkout de la Tienda Online y las suscripciones hoy usan una pasarela
dummy (URL mock, tarjeta `marca`/`last4` sin tokenización real). Esta fase
construye la **pasarela de pagos real** como módulo independiente dentro del
mismo backend NestJS — *"junto pero no revuelto"*:

- Vive en `backend/src/modules/pasarela/` siguiendo el patrón de módulos del
  repo, con una **regla de frontera estricta**: el módulo pasarela NO importa
  módulos de negocio (ventas, pagos, suscripciones); ellos sí pueden inyectar
  sus services públicos. Extraíble a microservicio sin reescritura.
- Un tenant puede contratar **solo** el módulo Pasarelas y consumirlo desde
  sus propias apps externas vía API keys (ej: tenant "bodega" con su app
  móvil), sin usar POS ni tienda.
- El diseño de datos es **agnóstico del proveedor** (nombres genéricos +
  `jsonb` para lo específico), basado en la investigación previa de
  `pasarela/` adaptada a las convenciones del repo.

Base de la investigación: `pasarela/# Diseño Base - Pasarela de Pagos Multit
opcion 2.md` y `# Arquitectura y Patrones de Diseño.md`.

## Decisiones validadas con el usuario

1. **Proveedor v1: Transbank Oneclick** (tokenización + cobro recurrente),
   contra su ambiente de integración real. Webpay Plus y otros quedan para
   fases futuras — el modelo ya los soporta sin cambios estructurales.
2. **Alcance v1**: módulo gateway completo (endpoints + API keys, probado
   contra integración de Transbank) + pantalla de administración del tenant.
   NO incluye: reconectar suscripciones/tienda a la pasarela real, ni el job
   de cobro recurrente automático (fases siguientes).
3. **Pagador con referencia externa genérica**: `pagador_ref` es un
   `varchar(100)` opaco que aporta la app consumidora (uuid, rut, email, id
   numérico — lo que use). La pasarela no valida ni resuelve esa entidad.
   Igual para `referencia_externa` en órdenes: **sin FK duras** a
   `ventas`/`pagos`.
4. **Módulo contratable + API keys**: "Pasarelas" entra al RBAC como módulo
   de `tenant_modulos`. El admin del tenant configura sus pasarelas (modo
   MALL o INDIVIDUAL, ambiente) y genera/revoca las API keys que sus apps
   externas usan contra `/pasarela/api/*`.
5. **Credenciales cifradas app-level**: AES-256-GCM con clave maestra
   `PASARELA_ENCRYPTION_KEY` en `.env`. API keys de tenant guardadas solo
   hasheadas (SHA-256).
6. **Estructura interna: patrón del repo** (controller/service/entity/dto)
   con carpeta `providers/` (interfaz común + factory), NO la Clean
   Architecture completa del doc de investigación (inconsistente con los
   otros 24 módulos y ~2× archivos sin beneficio a este tamaño).

## Modelo de datos

Convenciones del repo en todas las tablas: PK UUID (`type: 'uuid'` explícito,
ADR-004), soft delete `eliminado_el`, `creado_el`/`actualizado_el`,
`tenant_id` siempre del token (JWT o API key), montos `numeric` en BD y
Decimal.js/string en código.

### 1. `pasarelas` — catálogo global de proveedores (seed, no editable por tenant)

| Columna | Tipo | Notas |
|---|---|---|
| `pasarela_id` | UUID PK | |
| `codigo` | varchar único | `oneclick`, `webpay_plus`, `stripe`… |
| `nombre` | varchar | |
| `soporta_tokenizacion` | boolean | |
| `soporta_cobro_recurrente` | boolean | |
| `soporta_mall` | boolean | |
| `url_produccion` / `url_pruebas` | varchar | base URL del proveedor |
| `configuracion_produccion` / `configuracion_pruebas` | jsonb **cifrado** | credenciales mall de la plataforma |
| `activo` | boolean | |

### 2. `tenant_pasarela` — qué pasarela usa cada tenant y cómo

| Columna | Tipo | Notas |
|---|---|---|
| `tenant_pasarela_id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `pasarela_id` | UUID FK | |
| `ambiente` | text | `'pruebas' \| 'produccion'` |
| `modo_integracion` | text | `'mall' \| 'individual'` |
| `configuracion` | jsonb **cifrado** | ver mapeo MALL/INDIVIDUAL abajo |
| `activo` | boolean | |
| `prioridad` | integer | para failover futuro entre pasarelas |

### 3. `pasarela_api_keys` — llaves m2m del tenant

| Columna | Tipo | Notas |
|---|---|---|
| `api_key_id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `nombre` | varchar | descriptivo ("app móvil bodega") |
| `prefijo` | varchar | visible en UI: `pk_a1b2…` |
| `key_hash` | varchar | SHA-256 de la key completa; la key se muestra UNA vez |
| `ultimo_uso_el` | timestamptz nullable | |
| `revocada_el` | timestamptz nullable | revocada ⇒ 401 |

### 4. `pasarela_inscripciones` — registro del pagador en el proveedor

| Columna | Tipo | Notas |
|---|---|---|
| `inscripcion_id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `tenant_pasarela_id` | UUID FK | |
| `pagador_ref` | varchar(100) | opaco, lo aporta la app consumidora; índice `(tenant_id, pagador_ref)` |
| `identificador_externo` | text **cifrado** | tbkUser — con él + commerce code se puede cobrar |
| `identificador_usuario_externo` | varchar | username generado por nosotros desde el UUID (`insc-…`), nunca el `pagador_ref` crudo |
| `estado` | text | `'pendiente' \| 'activa' \| 'fallida' \| 'eliminada'` |
| `token_proveedor` | varchar nullable | token temporal del start (correlación del retorno) |
| `url_retorno_app` | varchar | a dónde redirigir a la app al terminar |
| `metadata` | jsonb | |

### 5. `pasarela_medios_pago` — instrumentos registrados

| Columna | Tipo | Notas |
|---|---|---|
| `medio_pago_id` | UUID PK | |
| `inscripcion_id` | UUID FK | |
| `tipo` | varchar | `TARJETA_CREDITO`, `TARJETA_DEBITO`… |
| `marca` | varchar nullable | Visa, Mastercard… |
| `ultimos_4` | varchar(4) | |
| `fecha_expiracion` | varchar nullable | si el proveedor la entrega |
| `token_externo` | text **cifrado** nullable | para proveedores con token por tarjeta (Stripe) |
| `estado` | text | `'activo' \| 'eliminado'` |
| `metadata` | jsonb | |

En Oneclick la inscripción retorna la tarjeta (1 inscripción = 1 tarjeta), se
llenan juntas en la misma transacción. La separación queda lista para
proveedores multi-tarjeta.

### 6. `pasarela_ordenes` — intención de pago

| Columna | Tipo | Notas |
|---|---|---|
| `orden_id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `pagador_ref` | varchar(100) nullable | |
| `referencia_externa` | varchar nullable | correlación de la app: venta_id interno, folio externo… |
| `codigo_orden` | varchar único | buyOrder generado por nosotros |
| `descripcion` | varchar | |
| `monto` | numeric | |
| `moneda` | varchar(3) | CLP en v1 |
| `estado` | text | ver máquina de estados |
| `fecha_expiracion` | timestamptz nullable | |
| `origen` | text | `'interno' \| 'api'` |
| `api_key_id` | UUID FK nullable | qué llave la creó (trazabilidad) |
| `metadata` | jsonb | |

### 7. `pasarela_transacciones` — historial inmutable

| Columna | Tipo | Notas |
|---|---|---|
| `transaccion_id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `orden_id` | UUID FK nullable | null para INSCRIPTION |
| `tenant_pasarela_id` | UUID FK | |
| `inscripcion_id` / `medio_pago_id` | UUID FK nullable | |
| `transaccion_padre_id` | UUID FK nullable | liga REFUND/REVERSAL a su AUTHORIZATION |
| `tipo` | text | `INSCRIPTION \| AUTHORIZATION \| CAPTURE \| REVERSAL \| REFUND \| RECURRENT_PAYMENT` |
| `estado` | text | `'iniciada' \| 'aprobada' \| 'rechazada' \| 'error'` (inmutable una vez terminal) |
| `monto` / `moneda` | numeric / varchar(3) | |
| `codigo_orden` | varchar | |
| `codigo_autorizacion` | varchar nullable | |
| `identificador_transaccion_externo` | varchar nullable | único por `(tenant_pasarela_id, identificador_transaccion_externo)` → idempotencia |
| `codigo_respuesta` | varchar nullable | |
| `tipo_pago` / `numero_cuotas` / `monto_cuota` | varchar / int / numeric, nullables | |
| `request` / `response` | jsonb **redactado** | nunca credenciales/tokens en claro |
| `metadata` | jsonb | |
| `fecha_transaccion` | timestamptz | |

Cada operación contra el proveedor es una fila nueva; nunca se actualiza una
transacción terminal.

### Máquinas de estado (separadas)

- **Orden:** `creada → en_proceso → pagada | fallida | expirada`
  (+ `reembolsada` cuando la suma de REFUND aprobados == monto).
- **Transacción:** `iniciada → aprobada | rechazada | error`.

## Arquitectura del módulo

```
backend/src/modules/pasarela/
├── pasarela.module.ts
├── controllers/
│   ├── pasarela-admin.controller.ts   # /pasarela/admin/* — JWT+TenantGuard+PermisosGuard (módulo RBAC "Pasarelas")
│   ├── pasarela-api.controller.ts     # /pasarela/api/*   — ApiKeyGuard
│   └── pasarela-retorno.controller.ts # /pasarela/retorno/* — público (valida token del proveedor)
├── services/
│   ├── tenant-pasarela.service.ts     # CRUD configuración por tenant
│   ├── api-keys.service.ts            # generar/revocar/validar keys
│   ├── credenciales.service.ts        # AES-256-GCM + merge MALL/INDIVIDUAL por ambiente
│   ├── inscripciones.service.ts       # orquesta start/finish/eliminar
│   ├── cobros.service.ts              # órdenes + authorize + reembolsos + verificar
│   └── transacciones.service.ts       # persistencia del historial + redacción
├── providers/
│   ├── payment-provider.interface.ts
│   ├── provider.factory.ts            # codigo pasarela → instancia
│   └── oneclick/oneclick.provider.ts
├── guards/api-key.guard.ts
├── entities/  (7 entidades)
└── dto/
```

**Regla de frontera** (la garantía de "junto pero no revuelto"): este módulo
solo importa de `common/` y `auth/` (guards). Nunca de ventas, pagos,
suscripciones, items, etc. Los módulos de negocio que quieran cobrar inyectan
`InscripcionesService`/`CobrosService`.

### Contrato del provider

```typescript
interface PaymentProvider {
  iniciarInscripcion(cred, p): Promise<{ tokenExterno; urlRedireccion }>;
  confirmarInscripcion(cred, token): Promise<ResultadoInscripcion>;
  eliminarInscripcion(cred, p): Promise<void>;
  autorizarCobro(cred, p): Promise<ResultadoCobro>;
  reembolsar(cred, p): Promise<ResultadoReembolso>;
  consultarEstado(cred, codigoOrden): Promise<ResultadoEstado>;
}
```

`cred` llega ya resuelto por `CredencialesService`; los providers solo
traducen al dialecto del proveedor (Oneclick: montos a entero CLP en el
borde, headers `Tbk-Api-Key-Id`/`Tbk-Api-Key-Secret`). Los services
orquestan: crean órdenes, persisten transacciones, manejan estados.

### Mapeo MALL / INDIVIDUAL en Oneclick

La API actual de Oneclick es Mall siempre:

- **MALL:** mall code + api key secret de la **plataforma** en
  `pasarelas.configuracion_{ambiente}`; el tenant solo aporta su commerce
  code hijo en `tenant_pasarela.configuracion`.
- **INDIVIDUAL:** contrato propio del tenant — mall code, secret y comercios
  hijos completos en `tenant_pasarela.configuracion`.

`CredencialesService.resolver(tenantPasarela)` descifra y mezcla según modo +
ambiente en un solo punto.

## Flujos

### Inscripción (con redirección Webpay)

1. `POST /pasarela/api/inscripciones` `{ pagador_ref, email, url_retorno }` →
   inscripción `pendiente`, username generado desde el UUID, `start` contra
   Transbank → responde `{ inscripcion_id, url_webpay, token }`. La app
   redirige al usuario.
2. Transbank retorna con `TBK_TOKEN` a `/pasarela/retorno/inscripcion`
   (nuestro backend, público). Ahí: `finish` (PUT), persistir tbkUser cifrado
   + tarjeta en `pasarela_medios_pago`, transacción `INSCRIPTION`, redirect
   302 al `url_retorno` de la app con `?inscripcion_id=…&estado=…`.
3. La app consulta `GET /pasarela/api/inscripciones/:id` (nunca se expone
   tbkUser).

### Cobro (síncrono)

`POST /pasarela/api/cobros` `{ inscripcion_id | pagador_ref,
referencia_externa, monto, descripcion, cuotas? }` → orden
(`creada → en_proceso`) + buyOrder → `authorize` → transacción
`AUTHORIZATION` → orden `pagada` o `fallida` según `response_code`. Resultado
completo en la misma respuesta HTTP.

### Reembolso y eliminación

- `POST /pasarela/api/cobros/:ordenId/reembolsos` `{ monto }` → transacción
  `REFUND` hija de la autorización; parcial o total.
- `DELETE /pasarela/api/inscripciones/:id` → delete en Transbank + soft
  delete local + medios de pago `eliminado`.

### Endpoints admin (JWT + RBAC "Pasarelas")

- CRUD `tenant_pasarela` (`/pasarela/admin/config`)
- API keys: listar/crear/revocar (`/pasarela/admin/api-keys`)
- Consulta de órdenes y transacciones (`/pasarela/admin/ordenes`, `…/transacciones`)

## Seguridad

- **API keys:** formato `pk_<40 chars aleatorios>` — la key es agnóstica del
  ambiente (pruebas/producción lo define cada `tenant_pasarela`); en BD solo
  `key_hash` (SHA-256 — secreto de alta entropía) + `prefijo`. `ApiKeyGuard`
  resuelve `tenant_id` desde la key (la app externa jamás manda tenant_id),
  actualiza `ultimo_uso_el`, rechaza revocadas. Alcance: solo
  `/pasarela/api/*`.
- **Cifrado:** AES-256-GCM, clave `PASARELA_ENCRYPTION_KEY` (32 bytes
  base64) en `.env`. IV aleatorio por registro, formato `iv:tag:data`.
  Cifrados: configuraciones de `pasarelas` y `tenant_pasarela`,
  `identificador_externo`, `token_externo`.
- **Redacción:** antes de persistir `request`/`response`: headers de auth,
  tbk_user y tokens → `"[REDACTADO]"`.
- **Credenciales write-only en la UI:** se escriben pero nunca se releen; al
  editar se muestra `••••` y solo se reemplazan si se tipea algo nuevo.
- Multi-tenancy estándar del repo: `tenant_id` del token, filtro
  `eliminado_el IS NULL` en toda lectura.

## Manejo de errores

- **Rechazo del proveedor** (`response_code != 0`): transacción `rechazada`,
  orden `fallida`, HTTP 200 con el detalle — un rechazo no es un error HTTP.
- **Timeout/error de red en authorize:** NO se asume rechazo. Transacción
  `error`, orden queda `en_proceso`, y
  `POST /pasarela/api/ordenes/:id/verificar` llama `consultarEstado` del
  proveedor y cierra la orden según lo que realmente ocurrió.
- **Expiración:** órdenes `en_proceso` con `fecha_expiracion` vencida →
  `expirada`, evaluada perezosamente al leer (sin job en v1).
- **Config inválida** (pasarela inactiva, credenciales faltantes): 4xx claro
  antes de tocar al proveedor.

## Frontend — página de administración

`frontend/app/pages/pasarelas.vue` (patrón CRUD del repo: `CrudPageHeader`,
`CrudTable`, `AppDrawer`, `CrudModal`; tokens semánticos del design system),
con dos tabs:

1. **Mis pasarelas:** lista de `tenant_pasarela` (pasarela, ambiente, modo,
   prioridad, activa). Drawer alta/edición: pasarela global, ambiente, modo
   MALL (solo commerce code hijo) / INDIVIDUAL (credenciales completas,
   write-only).
2. **API Keys:** lista (nombre, prefijo, último uso, estado), crear (modal
   con la key completa + copiar + aviso "no volverás a verla") y revocar
   (confirmación).

Visible solo con el módulo RBAC "Pasarelas"; botones según permisos.

## Seed (desarrollo)

En `seeder.service.ts`:

- Pasarela global `oneclick` con las credenciales públicas del ambiente de
  integración de Transbank (mall `597055555541` + comercios hijos
  `597055555542`/`597055555543`) en `configuracion_pruebas`.
- Módulo RBAC "Pasarelas" + permisos para el rol admin.
- Un `tenant_pasarela` de ejemplo (modo MALL, ambiente pruebas) para el
  tenant de desarrollo.

## Testing / Verificación

- **Unit (`*.spec.ts`, patrón del repo):** services con provider mockeado —
  máquina de estados de órdenes, idempotencia por
  `identificador_transaccion_externo`, redacción de request/response,
  cifrado round-trip, `ApiKeyGuard` (key válida/revocada/inexistente),
  generación de API keys (hash, prefijo, una sola exposición).
- **E2E opt-in contra Transbank integración:** `OneclickProvider` real —
  inscripción start/finish, authorize, refund, status. No corre en
  `npm test` normal.
- **Verificación manual de punta a punta:** configurar tenant_pasarela en la
  UI → generar API key → inscripción con tarjeta de prueba
  `4051 8856 0044 6623` → cobro → reembolso → historial visible en la UI
  admin.

## Fuera de alcance (fases futuras)

- Reconectar suscripciones y checkout de la tienda a la pasarela real.
- Job/scheduler de cobro recurrente automático (`proximo_cobro`).
- Webpay Plus, Stripe, MercadoPago (el modelo ya los soporta).
- Webhooks entrantes de proveedores (Oneclick es síncrono; el esqueleto se
  agrega cuando llegue un proveedor que los necesite).
- Failover entre pasarelas usando `prioridad`.
- Rotación automática de la clave de cifrado.
