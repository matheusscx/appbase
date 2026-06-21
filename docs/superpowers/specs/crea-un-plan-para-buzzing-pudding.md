# Plan: Perfiles Multi-Tenant y RBAC

## Contexto

El proyecto tiene autenticación JWT funcionando pero cero lógica multi-tenant. La entidad
`User` actual apunta a la tabla `users` (nombres en inglés), pero el esquema canónico de
referencia (`startup-pos.sql`) usa `usuarios` con columnas en español. Hay que alinear la
entidad existente y construir el sistema RBAC completo sobre esa base.

El `tenant_id` activo siempre viaja en el JWT (según CLAUDE.md, nunca en el body). Requiere un
endpoint `switch-tenant` para cambiar de tenant sin re-login.

### Decisión de base de datos (condiciona todo el plan)

Estamos en construcción temprana, sin producción y con esquema fluido. **Estrategia elegida:
`synchronize: true` en dev + seeder programático.**

- **Las entidades TypeORM son la fuente de verdad del esquema**, no `startup-pos.sql`.
- `startup-pos.sql` pasa a ser **documento de diseño vivo** (referencia), ya **no se ejecuta**.
  Se mantiene sincronizado por la regla de doc viva cuando cambia una entidad.
- `seed.sql` **tampoco se ejecuta**: su contenido se reimplementa como `SeederService`
  idempotente que corre al boot solo en dev. Así `docker-compose up` deja la BD lista
  (admin + tenant Paris + catálogos) sin montar SQL ni cargar nada a mano.
- Cuando se acerquen a producción: congelar esquema → generar **una** migración inicial desde
  el estado actual → apagar `synchronize`. Ese, y no antes, es el momento de migrar.

> **Importante:** el volumen `postgres_data` persiste entre reinicios y aún contiene la vieja
> tabla `users`. Antes de la primera corrida de este plan: `docker-compose down -v`.

---

## Fase 0 — Estrategia de BD y Seeder

**Objetivo:** que `docker-compose up` deje la BD utilizable sin pasos manuales, y dejar la
configuración de esquema explícita.

### 0.1 — Confirmar/forzar `synchronize` por entorno

`app.module.ts` ya hace `synchronize: NODE_ENV !== 'production'`. Mantener. Añadir comentario
explicando que en dev el esquema lo dictan las entidades y que producción usará migraciones.

### 0.2 — Modelar como entidades los catálogos que el seeder necesita

El seeder solo puede hacer upsert de tablas que synchronize haya creado. Crear entidades
mínimas (read-mostly) para los catálogos globales que siembra:

- `Pais` → `pais`
- `Provincia` → `provincia`
- `Moneda` → `moneda`
- `ModuloApp` → `modulos_app`  *(reutilizada también en Fase 2)*
- `Permiso` → `permisos`  *(idem)*
- `ModuloAppPermiso` → `modulo_app_permisos`  *(idem)*

> Métodos de pago, monedas-por-tenant, tipos de documento, etc. del `seed.sql` original **no**
> son necesarios para Tenants/RBAC. Se siembran en las fases que introduzcan sus entidades, no
> aquí. El seeder de Fase 0 solo cubre lo que requieren login + multi-tenant + RBAC.

### 0.3 — `SeederService` idempotente

**Nuevo módulo:** `backend/src/modules/seeder/` (o `src/database/seeder/`).

- Implementa `OnApplicationBootstrap`.
- **No-op si `NODE_ENV === 'production'`.**
- Todo es **upsert por clave única / PK fija** (usar los mismos UUIDs del `seed.sql` actual para
  reproducibilidad y para que sea idempotente entre reinicios). Patrón: `repo.upsert(row, [pk])`
  o "buscar y crear si no existe".
- Siembra en orden de dependencia:
  1. `pais` (Chile) → luego `moneda` (CLP/UF/USD) → set `pais.moneda_oficial_id`
  2. `provincia` (RM, Isla de Pascua)
  3. `modulos_app` (Facturación, Caja), `permisos` (Leer/Crear/Actualizar/Eliminar),
     `modulo_app_permisos` (cross product sembrado)
  4. **Dev tenant Paris** + **usuario admin** (`es_superadmin = true`, hash bcrypt del seed) +
     `usuarios_tenants` + rol `Administrador` (`es_fijo = true`) + `roles_usuarios` +
     `tenant_modulos` (Caja) + `tenant_formula_precio` (descuentos→recargos→impuestos).

**Verificación Fase 0:** `docker-compose down -v && docker-compose up --build` → sin errores de
sincronización; consultar la BD y ver `usuarios.admin` y `tenants.Paris`.

---

## Fase 1 — Migrar entidad `User` → `Usuario`

**Archivo principal:** `backend/src/modules/users/user.entity.ts`

Cambios en la entidad:
- `@Entity('users')` → `@Entity('usuarios')`
- `id` → PK mapeado a `usuario_id` (`@PrimaryGeneratedColumn('uuid', { name: 'usuario_id' })`)
- `name` → split en `nombre` + `apellido`
- `email` → `correo`
- `password` → `contrasena`
- Nuevo: `nombreUsuario: string` → `nombre_usuario` (UNIQUE)
- Nuevo: `telefono: string`
- Nuevo: `esSuperadmin: boolean` → `es_superadmin` DEFAULT false
- `googleId` → `google_id` (nullable; existe solo vía synchronize, no en el SQL canónico)
- Timestamps: `creado_el`, `actualizado_el`, `eliminado_el` (`@DeleteDateColumn`)

### Nullabilidad — divergencia deliberada del SQL canónico

Como **la entidad manda**, y para soportar usuarios OAuth, se declaran **nullable** los campos
que el SQL marca `NOT NULL` pero que un alta por Google no puede llenar:

- `contrasena` → nullable (usuarios OAuth no tienen contraseña)
- `apellido`, `telefono`, `nombre_usuario` → nullable **o** con default generado en el alta OAuth.

> Decidir por campo. Recomendado: `contrasena` nullable; `apellido`/`telefono` nullable;
> `nombre_usuario` derivado del correo en el alta OAuth (debe ser UNIQUE). Documentar la
> divergencia respecto a `startup-pos.sql` en el ADR de Fase 0.

**Archivos a actualizar tras migración:**

| Archivo | Cambio |
|---|---|
| `users/users.service.ts` | `findByEmail` usa `{ correo: email }`; `findByGoogleId` usa `{ googleId }`; `create`/`linkGoogleId` adaptan campos |
| `users/dto/create-user.dto.ts` | Añadir `apellido?`, `nombreUsuario?`, `telefono?`; renombrar `name`→`nombre`, `password`→`contrasena` |
| `auth/dto/register.dto.ts` | Añadir `apellido`, `nombreUsuario`, `telefono`; renombrar campos |
| `auth/entities/refresh-token.entity.ts` | Import `User` → `Usuario`; el FK `user_id` ahora referencia `usuarios.usuario_id` |
| `auth/auth.service.ts` | `user.password`→`user.contrasena`, `user.email`→`user.correo`; **arreglar `googleLogin`** (ver abajo) |
| `auth/strategies/jwt.strategy.ts` | Ver Fase 4 — leer `tenant_id`/`es_superadmin` **del payload** |
| `app.module.ts` | `entities: [User, ...]` → `entities: [Usuario, ...]` |

### Arreglo obligatorio: `auth.service.ts → googleLogin`

El path actual crea el usuario solo con `{ googleId, name, email }`. Tras la migración eso viola
las columnas nuevas. Actualizar el alta OAuth para construir un `Usuario` válido:
`nombre`/`apellido` desde el perfil de Google, `nombre_usuario` derivado del correo (único),
`contrasena = null`, `telefono = null`.

**Verificación Fase 1:** `POST /auth/login` con `admin` (sembrado por el seeder) → JWT válido.

---

## Fase 2 — Módulo Catalog (catálogo global, solo lectura)

**Nuevo módulo:** `backend/src/modules/catalog/`

Reutiliza las entidades creadas en Fase 0 (`ModuloApp`, `Permiso`, `ModuloAppPermiso`).

Endpoints:
- `GET /catalog/modulos` — `JwtAuthGuard`
- `GET /catalog/permisos` — `JwtAuthGuard`

---

## Fase 3 — Módulo Tenants

**Nuevo módulo:** `backend/src/modules/tenants/`

Entidades:
- `Tenant` → `tenants`
- `UsuarioTenant` → `usuarios_tenants` (composite PK: `usuario_id + tenant_id`)
- `TenantModulo` → `tenant_modulos` (PK: `modulo_tenant_id` UUID)
- `TenantFormulaPrecio` → `tenant_formula_precio` (stub para auto-seed)
- `Caja` → `cajas` (stub para auto-seed de caja virtual)

Endpoints:

| Método | Ruta | Guards |
|---|---|---|
| POST | `/admin/tenants` | `JwtAuthGuard, SuperadminGuard` |
| GET | `/admin/tenants` | `JwtAuthGuard, SuperadminGuard` |
| GET | `/admin/tenants/:id` | `JwtAuthGuard, SuperadminGuard` |
| PATCH | `/admin/tenants/:id` | `JwtAuthGuard, SuperadminGuard` |
| DELETE | `/admin/tenants/:id` | `JwtAuthGuard, SuperadminGuard` |
| GET | `/tenants/me` | `JwtAuthGuard, TenantGuard` |
| POST | `/tenants/members` | `JwtAuthGuard, TenantGuard, PermisosGuard` |
| GET | `/tenants/members` | `JwtAuthGuard, TenantGuard` |
| DELETE | `/tenants/members/:userId` | `JwtAuthGuard, TenantGuard, PermisosGuard` |
| GET | `/tenants/modules` | `JwtAuthGuard, TenantGuard` |
| POST | `/admin/tenants/:id/modules` | `JwtAuthGuard, SuperadminGuard` |

> **Cambio respecto al plan original:** las rutas de tenant activo **ya no llevan `:id`** del
> tenant en la URL. El tenant siempre se deriva de `req.user.tenantId` (token), nunca del path
> ni del body (regla CLAUDE.md). Esto elimina el riesgo de IDOR. Solo las rutas `/admin/*`
> (superadmin) referencian un tenant arbitrario por `:id`.

**Auto-seeding en `TenantsService.create()` — una sola transacción:**
1. Crear fila en `tenants`
2. Crear rol `Administrador` (`es_fijo = true`) vinculado al nuevo tenant
3. Crear fila en `usuarios_tenants` para el usuario creador
4. Crear fila en `roles_usuarios` (creatorId + tenantId + adminRolId)
5. Crear filas en `tenant_formula_precio` (descuentos → recargos → impuestos)
6. Crear fila en `cajas` tipo `'virtual'`, estado `'abierta'`, saldo_inicial 0

---

## Fase 4 — Infraestructura común (Guards, Decoradores, JWT extendido)

### JWT extendido

Payload: `{ sub, email, tenant_id, es_superadmin }`

`auth.service.ts`:
```ts
generateAccessToken(user: Usuario, tenantId: string | null = null)
// payload: { sub: user.id, email: user.correo, tenant_id: tenantId, es_superadmin: user.esSuperadmin }
```

**`jwt.strategy.ts` — leer del payload (NO hardcodear):**
```ts
async validate(payload: { sub; email; tenant_id; es_superadmin }) {
  return {
    id: payload.sub,
    email: payload.email,
    tenantId: payload.tenant_id ?? null,
    esSuperadmin: payload.es_superadmin ?? false,
  };
}
```
> Corrección de un bug del plan original: si `validate()` hardcodea `esSuperadmin: false`, el
> `SuperadminGuard` (que lee `req.user.esSuperadmin`) rechaza **siempre** → ningún superadmin
> podría crear tenants. Debe propagar lo que viene firmado en el token.

### Persistir el tenant activo a través del refresh

El `refresh()` actual re-emite el access token **sin** tenant, así que tras un refresh el usuario
"se sale" del tenant activo. Corrección:
- Añadir columna `activeTenantId` (`active_tenant_id`, nullable) a `RefreshToken`.
- `switch-tenant` rota el refresh token guardando el `activeTenantId` elegido (tras verificar
  membresía).
- `refresh()` re-emite el access token con `existing.activeTenantId`.

### Nuevos endpoints en `AuthController`

- `GET /auth/my-tenants` — `JwtAuthGuard` → lista tenants del usuario (vía `usuarios_tenants`)
- `POST /auth/switch-tenant` — `JwtAuthGuard` + body `{ tenant_id }` → verifica membresía, emite
  nuevo access token con `tenant_id` y rota el refresh token con `active_tenant_id`

### Archivos nuevos en `src/common/`

```
src/common/
├── interfaces/jwt-user.interface.ts       { id, email, tenantId, esSuperadmin }
├── decorators/current-user.decorator.ts   @CurrentUser()
├── decorators/requires-permiso.decorator.ts  @RequiresPermiso(modulo, permiso)
└── guards/
    ├── superadmin.guard.ts    — chequea req.user.esSuperadmin (sin DB, lee del token)
    ├── tenant.guard.ts        — exige req.user.tenantId presente y membresía activa en
    │                            usuarios_tenants (eliminado_el IS NULL); 403 si no
    └── permisos.guard.ts      — lee metadata @RequiresPermiso, delega a RbacService
```

---

## Fase 5 — Módulo Roles y RBAC

**Nuevo módulo:** `backend/src/modules/roles/`

Entidades:
- `Rol` → `roles` (tenant_id nullable)
- `RolUsuario` → `roles_usuarios` (composite PK: `usuario_id + tenant_id + rol_id`)
- `ModuloRol` → `modulos_roles` (composite PK: `rol_id + modulo_tenant_id`)
- `RolPermisoModulo` → `roles_permisos_modulos` (composite PK 3-way, **sin soft-delete**)

Endpoints (todos derivan el tenant del token, no de la URL):

| Método | Ruta | Guards | Notes |
|---|---|---|---|
| GET | `/roles` | `JwtAuthGuard, TenantGuard` | Roles del tenant activo |
| POST | `/roles` | `JwtAuthGuard, TenantGuard, PermisosGuard` | |
| PATCH | `/roles/:id` | `JwtAuthGuard, TenantGuard, PermisosGuard` | Rechaza si `es_fijo` |
| DELETE | `/roles/:id` | `JwtAuthGuard, TenantGuard, PermisosGuard` | Rechaza si `es_fijo` |
| POST | `/roles/:id/users` | `JwtAuthGuard, TenantGuard, PermisosGuard` | Asignar rol a usuario |
| DELETE | `/roles/:id/users/:userId` | `JwtAuthGuard, TenantGuard, PermisosGuard` | Quitar rol |
| GET | `/roles/:id/permissions` | `JwtAuthGuard, TenantGuard` | |
| PUT | `/roles/:id/modules/:moduloTenantId/permissions` | `JwtAuthGuard, TenantGuard, PermisosGuard` | Set permisos |

**Nuevo módulo global:** `backend/src/modules/rbac/` — `@Global()`

`RbacService.userHasPermiso(userId, tenantId, moduloNombre, permisoNombre)`:
1. Short-circuit si el usuario tiene rol `es_fijo = true` en ese tenant → retorna `true`
2. Si no, corre query JOIN completo: `roles_usuarios → roles → modulos_roles → tenant_modulos →
   modulos_app → roles_permisos_modulos → modulo_app_permisos → permisos`

> **Orden de implementación:** aunque `PermisosGuard` (Fase 4) se usa en rutas de Fase 3, depende
> de `RbacService` (Fase 5). Implementar `RbacModule` **antes** de cablear `PermisosGuard` en
> rutas reales, o las rutas de Fase 3 no resolverán la dependencia. La verificación de rutas con
> `PermisosGuard` es, por tanto, post-Fase 5.

---

## Manejo de soft-delete en tablas de unión

`usuarios_tenants`, `roles_usuarios`, `modulos_roles` tienen PK compuesta **y** `eliminado_el`.
Una fila soft-deleteada **sigue ocupando la PK**, así que re-insertar (re-agregar un miembro o
re-asignar un rol quitado) lanza **duplicate key**.

**Patrón obligatorio en los services:** al "agregar", buscar primero una fila existente
(incluyendo soft-deleteadas, con `withDeleted: true`); si existe y está soft-deleteada,
**restaurarla** (`eliminado_el = null`) en vez de insertar. Aplica a: agregar miembro a tenant,
asignar rol a usuario, asignar módulo a rol.

`roles_permisos_modulos` **no** tiene `eliminado_el` (según esquema) → se borra/recrea sin este
problema.

---

## Patrón de soft delete (lecturas)

Todas las entidades con `@DeleteDateColumn({ name: 'eliminado_el' })` reciben filtrado automático
en queries TypeORM (`find*`). Para `QueryBuilder` manual, agregar `.andWhere('entity.eliminadoEl
IS NULL')`. El JOIN de `RbacService` (QueryBuilder) debe filtrar `eliminado_el IS NULL` en cada
tabla con soft-delete.

---

## Registro en `app.module.ts`

Todas las entidades nuevas se agregan al array `entities: []`. Todos los módulos nuevos se importan
en `imports: []`.

Orden recomendado: `SeederModule` (Fase 0) → `CatalogModule` → `TenantsModule` → `RbacModule` →
`RolesModule`. (`RbacModule` antes de `RolesModule`/rutas que usan `PermisosGuard`.)

---

## Documentación viva (regla CLAUDE.md — incluir en el mismo PR)

- `docs/features/multi-tenant-rbac.md` (desde `docs/features/TEMPLATE.md`) + link en `docs/README.md`
- Nuevo ADR en `docs/adr/`: **"synchronize + seeder en dev; migraciones en producción"** —
  registra la decisión y la divergencia de nullabilidad de `usuarios` respecto a `startup-pos.sql`
- `docs/MIGRACION-FUNCIONALIDADES.md` + tabla "Estado actual" de `CLAUDE.md`: marcar
  Perfil multi-tenant y RBAC como ✅
- Mantener `startup-pos.sql` sincronizado con las entidades cambiadas (ahora es doc, no ejecutable)

---

## Verificación end-to-end

1. `docker-compose down -v && docker-compose up --build` — sin errores de sincronización; el
   seeder deja la BD lista
2. `POST /auth/login` con `admin` → JWT válido con `es_superadmin: true`
3. `GET /auth/my-tenants` → lista el tenant "Paris"
4. `POST /auth/switch-tenant` `{ tenant_id: "<paris_id>" }` → nuevo JWT con `tenant_id`
5. **Refresh preserva tenant:** `POST /auth/refresh` tras el switch → access token sigue con
   `tenant_id` de Paris (no null)
6. `POST /admin/tenants` (JWT superadmin) → crea tenant; verificar en BD las filas auto-seed
   (rol admin, usuarios_tenants, roles_usuarios, formula_precio, caja virtual)
7. `GET /roles` (JWT con tenant activo) → lista rol Administrador
8. Usuario normal sin rol admin en un tenant → ruta protegida con `PermisosGuard` devuelve 403
9. `PUT /roles/:id/modules/:mid/permissions` → asignar permisos → verificar acceso concedido
10. **Soft-delete idempotente:** quitar un miembro y volver a agregarlo → restaura la fila, sin
    error de duplicate key
