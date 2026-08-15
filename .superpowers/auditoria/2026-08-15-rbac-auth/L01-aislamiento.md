## Lente: Aislamiento entre tenants (RBAC + auth + tenants)
## Veredicto: 1 hallazgo

### Qué revisé para poder afirmarlo

- **Guards (los 4, completos):** `tenant.guard.ts`, `permisos.guard.ts`,
  `tenant-admin.guard.ts`, `superadmin.guard.ts` — cómo resuelven `tenantId`/`esAdmin`/
  `esSuperadmin` y de dónde lo sacan (siempre `request.user`, poblado únicamente por
  `JwtStrategy.validate` desde el payload firmado — nunca de body/query/param).
- **Controllers, ruta por ruta (~46):** `auth.controller.ts` (12), `rbac.controller.ts` (2),
  `roles.controller.ts` (8), `tenants.controller.ts` (`AdminTenantsController` 6 +
  `TenantsController` 15), `me.controller.ts` (3). Para cada una: guard aplicado, y si
  `tenantId` sale de `req.user.tenantId` o de otro lado. Grep de `@Query` en todo el
  alcance: cero resultados — no hay vector por query string.
- **Services completos:** `auth.service.ts` (316), `tokens-acceso.service.ts` (149),
  `rbac.service.ts` (124, sus 3 queries SQL crudas), `roles.service.ts` (236 — las 10
  funciones), `tenants.service.ts` (824 — todas), `me.service.ts` (57), `users.service.ts`
  (48).
- **DTOs del alcance:** grep de `tenantId`/`tenant_id` en `modules/{auth,roles,tenants,
  users,me}/dto/*.ts` — el único que lo declara es `switch-tenant.dto.ts` (esperado: es
  el endpoint que pide *a qué* tenant cambiar, y el service verifica membresía antes de
  emitir el token nuevo).
- **Entidades + constraints:** `usuario.entity.ts`, `rol.entity.ts`, `rol-usuario.entity.ts`
  — columnas y PKs. Confirmé en los **tres lugares** (entidad, `startup-pos.sql`, seeder)
  que no existe FK ni índice que ate `roles_usuarios.tenant_id` a `roles.tenant_id`: el
  único freno posible es el código de aplicación.
- **Frontend:** `middleware/auth.ts`, `admin.ts`, `permiso.ts`, `usePermisosCrud.ts` — los
  tres se declaran a sí mismos como UX (invariante 6, comentado explícito en el código);
  el candado real es el backend. No encontré ningún lugar que mande un `tenantId`
  elegido por el cliente a un endpoint que lo use.
- **Tests:** confirmé que `modules/roles/` no tiene **ningún** spec (ni unit ni e2e) —
  ni `roles.service.spec.ts` ni un `roles*.e2e-spec.ts` existen.

### H1. `POST /roles/:id/users` no verifica que el rol pertenezca al tenant del token

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/roles/roles.service.ts:73-107` (`assignUser`),
  invocado desde `backend/src/modules/roles/roles.controller.ts:68-77`
  (`POST /roles/:id/users`)
- **Qué está mal:** `assignUser(rolId, tenantId, usuarioId)` verifica que `usuarioId`
  sea miembro de `tenantId` (líneas 79-86), pero **nunca verifica que `rolId` pertenezca
  a `tenantId`**. Compárese con **todas** las demás mutaciones del mismo service —
  `update` (56-58), `remove` (65-67), `findPermissions` (117-123), `setPermissions`
  (127-142)— que abren con exactamente `this.rolRepo.findOne({ where: { id, tenantId } })`
  y tiran `NotFoundException` si no matchea. `assignUser` es la única que se salta ese
  chequeo, y es justo la que recibe el `id` más peligroso: un rol ajeno.

  El JOIN de `RbacService.userHasPermiso` (`rbac.service.ts:33-49`) y el short-circuit de
  rol fijo (`rbac.service.ts:19-29`, reusado por `userIsTenantAdmin`) tampoco filtran por
  `roles.tenant_id` — solo por `roles_usuarios.tenant_id` (la fila que `assignUser` deja
  escribir sin validar). El caso más severo es el short-circuit: filtra únicamente
  `ru.tenant_id = $2 AND r.es_fijo = true`, sin tocar el tenant real del rol. Con eso,
  `roles_usuarios` es la única defensa contra un rol ajeno, y es exactamente la fila que
  el bug deja escribir sin chequeo.

- **Escenario:** El admin del tenant A (pasa `TenantAdminGuard` porque `es_fijo=true` en
  A — no hace falta ningún privilegio extra) conoce o consigue el UUID de un rol de
  otro tenant B (en el propio seed del proyecto los roles nacen con UUID **fijo y
  documentado**, patrón `550e8400-e29b-41d4-a716-446655440XXX` — `seeder.service.ts:2171,
  2227,3483`; los roles creados desde la UI en producción sí llevan `randomUUID()`, así
  que ahí el vector exige que el UUID se filtre por otro lado). Llama
  `POST /roles/{rolIdDeB}/users` con `{ usuarioId: <un usuario de A> }`. `esMiembro`
  pasa porque valida al usuario contra A, no al rol. Queda insertada
  `roles_usuarios(usuario_id=userA, tenant_id=A, rol_id=rolDeB)`. A partir de ahí,
  `userHasPermiso(userA, A, modulo, accion)` evalúa permisos de un rol que en realidad
  administra B — incluido el caso extremo de apuntar al rol `Administrador` (`es_fijo`)
  de B, que dispara el short-circuit y da acceso total dentro de A. El efecto concreto:
  el admin de A puede otorgarle a un usuario suyo acceso a un **módulo que A nunca
  contrató** (`tenant_modulos` es de B, no de A) — exactamente "obtiene permisos que no
  tiene" de la rúbrica de severidad. No es lectura cruzada de *datos* de B (los servicios
  de negocio siguen acotando por `user.tenantId=A` del JWT), pero sí es un bypass del
  gate de contratación/permisos vía IDOR, en el módulo que administra permisos.

- **Por qué ningún test lo caza:** `modules/roles/` no tiene ni un solo `*.spec.ts` ni
  `*.e2e-spec.ts` — ni siquiera el camino feliz de `assignUser` está cubierto, mucho
  menos un caso de rol ajeno. El test que debería existir: dos tenants sembrados (A, B),
  admin de A llama `POST /roles/:id/users` con el `rolId` de un rol de B y un `usuarioId`
  de A → debe responder 400/404, no 201.
- **Confianza:** alta — el código se abrió y se comparó línea a línea contra sus cuatro
  hermanos del mismo archivo, que sí hacen el chequeo; y se confirmó en los tres lugares
  (entidad, `startup-pos.sql`, seeder) que no hay ninguna constraint de base que lo cubra
  por detrás. Lo único que baja un poco la explotabilidad práctica en producción (no la
  severidad del bug) es que un rol creado desde la UI tiene UUID aleatorio y hace falta
  otro canal para conocerlo; el propio seed del proyecto, en cambio, ya expone IDs fijos.

### Fuera de mi lente / no reportado

Encontré (y descarté como no aplicable a esta lente, o ya cubierto por `YA CONOCIDO`):
`GET /roles` y `GET /roles/:id/permissions` abiertos a cualquier miembro del tenant sin
`TenantAdminGuard` — es lectura documentada como abierta a propósito, no cruza tenant.
`Rol.tenantId` nullable en la entidad — no se usa en ningún alta real (seeder ni service),
no hay roles globales en la práctica.
