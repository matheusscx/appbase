## Lente: Escalada de privilegios
## Veredicto: 2 hallazgos

### Qué revisé para poder afirmarlo

Backend, archivo por archivo, abiertos enteros: los 4 guards
(`tenant.guard.ts`, `permisos.guard.ts`, `tenant-admin.guard.ts`,
`superadmin.guard.ts`), los 2 decorators (`current-user`, `requires-permiso`) +
`jwt-user.interface.ts`; `rbac.service.ts` (sus 3 métodos, las 3 queries SQL
completas) + `rbac.controller.ts`; `roles.controller.ts` (8 rutas) +
`roles.service.ts` (9 métodos) + sus 3 DTOs + las 4 entidades del módulo;
`tenants.controller.ts` (2 controllers, 21 rutas) + `tenants.service.ts` (~20
métodos) + sus 9 DTOs; `auth.controller.ts` (14 rutas) + `auth.service.ts` +
`tokens-acceso.service.ts` + sus 5 DTOs + `jwt.strategy.ts` +
`google.strategy.ts` + `jwt-auth.guard.ts`; `me.controller.ts` (3 rutas) +
`me.service.ts` + sus 3 DTOs; `users.service.ts` + `usuario.entity.ts` (sin
controller propio — solo lo usan otros módulos). Frontend: los 3 middleware de
autorización (`auth.ts`, `admin.ts`, `permiso.ts`) — confirmado que son UX
(invariante 6, documentado en sus propios docblocks) y que el candado real es
el guard del backend; no profundicé en `.vue` ni en `usePermisosCrud.ts`
porque no cambian esa conclusión.

Contrasté cada ruta mutadora contra el criterio de `roles-permisos.md` (admin-
only vs `@RequiresPermiso`) y crucé cada bullet del brief (auto-asignación,
rol fijo, `es_superadmin`, `es_totem`, módulos contratados, último admin,
invitaciones) contra el código, no de memoria. Grep de todo `roles_usuarios` y
`es_totem` en `backend/src` para confirmar que no hay un segundo camino de
escritura fuera de los que leí.

### H1. El último admin puede quitarse a sí mismo el único rol fijo, o auto-eliminarse del tenant, sin ningún freno

- **Severidad:** media
- **Ubicación:**
  - `backend/src/modules/roles/roles.service.ts:109-115` (`removeUser`)
  - `backend/src/modules/roles/roles.controller.ts:79-89` (`DELETE /roles/:id/users/:userId`)
  - `backend/src/modules/tenants/tenants.service.ts:640-642` (`removeMember`)
  - `backend/src/modules/tenants/tenants.controller.ts:177-183` (`DELETE /tenants/members/:userId`)
- **Qué está mal:** `RolesService.remove` (borrar el ROL) sí bloquea `esFijo`
  (`roles.service.ts:65-71`), pero `removeUser` (desasignar a una PERSONA del
  rol) no verifica nada: es un `softDelete` incondicional. Lo mismo
  `TenantsService.removeMember`: da de baja la membresía del tenant sin
  chequear si el usuario es el único admin. Ninguno de los dos pregunta "¿esta
  fila es el último `roles_usuarios` con `es_fijo=true` de este tenant?".
- **Escenario:** Tenant con un solo admin (el caso normal: se crea uno al
  crear el tenant, `TenantsService.create` líneas 128-134). Ese admin, con su
  propio token válido, hace `DELETE /roles/{rolAdministradorId}/users/{suPropioUserId}`
  — pasa `TenantAdminGuard` porque en ese momento SÍ es admin. El `softDelete`
  corre igual. A partir de ahí, `RbacService.userIsTenantAdmin` devuelve
  `false` para todos los usuarios del tenant: nadie puede volver a pasar
  `TenantAdminGuard`, así que nadie puede crear un rol nuevo, reasignar el rol
  fijo, gestionar miembros, tocar razones sociales ni preferencias
  financieras. `AdminTenantsController` (superadmin) no tiene ninguna ruta
  para asignar un rol a un usuario de un tenant ajeno — no hay salida desde la
  API. Mismo resultado con `DELETE /tenants/members/{suPropioUserId}` (se
  autoelimina del tenant entero) o si hay dos admins y uno elimina al otro sin
  querer, dejando uno, y ese uno repite la acción sobre sí mismo.
- **Por qué ningún test lo caza:** No existe ningún `.spec.ts` en
  `backend/src/modules/roles/` ni `backend/src/modules/rbac/` (busqué,
  cero archivos). El único e2e que toca estas rutas,
  `backend/test/tenants-members.e2e-spec.ts`, prueba que un no-admin recibe
  403 en `DELETE /tenants/members/:userId` (línea 141) pero no hay ningún caso
  con el admin borrándose a sí mismo o quedando el tenant en cero admins;
  tampoco hay ningún e2e que llame `POST/DELETE /roles/:id/users` en absoluto
  (grep sin resultados). El único freno que existe hoy —el `esFijo` bloqueado
  en `remove()` del ROL— no cubre este camino porque el rol nunca se borra,
  solo se vacía de gente.
- **Confianza:** alta — el código se abrió completo en las cuatro ubicaciones,
  no hay constraint de BD (`startup-pos.sql` no tiene trigger ni check sobre
  "al menos un admin"), y confirmé que `AdminTenantsController` no ofrece
  ninguna ruta de recuperación.

### H2. `RolesService.assignUser` no valida que el rol pertenezca al tenant activo — la única escritura de `roles_usuarios` sin ese chequeo

- **Severidad:** media (ver nota de alcance real en Confianza)
- **Ubicación:** `backend/src/modules/roles/roles.service.ts:73-107`
- **Qué está mal:** `assignUser(rolId, tenantId, usuarioId)` valida que
  `usuarioId` sea miembro de `tenantId` (líneas 79-86), pero nunca valida que
  `rolId` pertenezca a `tenantId`. Compará con sus tres hermanos en el mismo
  archivo, que sí lo hacen: `findPermissions` (línea 122: `rolRepo.findOne({
  where: { id: rolId, tenantId } })` → 404 si no matchea), `setPermissions`
  (línea 134, idéntico chequeo) y `TenantsService.crearUsuario`
  (`tenants.service.ts:468-478`, que además lo explica en su propio docblock:
  *"Y se validan contra este tenant — no hay roles globales, así que sin ese
  chequeo un admin podría asignar el rol de otra empresa pasando su id"*).
  `assignUser` es el único punto de escritura de `roles_usuarios` que se salta
  exactamente el chequeo que el propio código documenta como necesario en el
  método vecino.
  Esto es explotable porque el atajo `es_fijo` de `RbacService` (las tres
  queries en `rbac.service.ts:18-30`, `53-67` y `69-83`) hace `JOIN roles r ON
  r.rol_id = ru.rol_id` y filtra `r.es_fijo = true`, pero **nunca filtra
  `r.tenant_id`** — solo filtra `ru.tenant_id` (la fila de asignación, no el
  rol referenciado). Si `roles_usuarios` llega a tener una fila con
  `tenant_id = A` pero `rol_id` de un rol `es_fijo` de otro tenant, el
  short-circuit de admin dispara igual.
- **Escenario:** admin de Tenant A ejecuta `POST /roles/{rolAdminDeTenantB}/users`
  con `{ usuarioId: <miembro de A> }`. `assignUser` no rechaza el `rolId`
  ajeno (a diferencia de `setPermissions`/`findPermissions`, que responderían
  404), y crea `roles_usuarios(usuario_id=X, tenant_id=A, rol_id=<rol de B>)`.
  Si ese rol de B es `es_fijo=true`, X pasa a ser admin de A vía el
  short-circuit, con una fila que no pasa por ningún otro control de
  integridad (no hay FK compuesta `(tenant_id, rol_id)` en
  `rol-usuario.entity.ts` — son tres `@PrimaryColumn` sueltas, sin
  `@ManyToOne`).
- **Por qué ningún test lo caza:** cero e2e sobre `POST /roles/:id/users`
  (confirmé con grep sobre `backend/test/*.e2e-spec.ts`, sin resultados), y
  cero `.spec.ts` de `roles.service.ts`.
- **Confianza:** media — el chequeo faltante es real y verificado abriendo el
  archivo, y viola un invariante que el propio proyecto documenta en el método
  vecino. Pero el alcance real de la escalada es más chico de lo que parece a
  primera vista: `assignUser` solo es alcanzable con `TenantAdminGuard`
  (rules 1-2 del brief no ceden ese punto), y la fila que se crea siempre
  queda con `tenant_id` = el tenant ACTIVO del que llama, no el del rol
  referenciado — así que un admin de A que se auto-promueve "vía B" no gana
  nada que no tuviera ya (ya es admin de A por su propio rol). Lo que sí
  cambia con el bug es que ese mismo admin de A podría promover a un TERCERO
  de su tenant a admin usando el id de un rol ajeno en vez del propio — pero
  promover a un tercero a admin de su propio tenant es algo que un admin de A
  ya puede hacer legítimamente con el rol correcto. No until construí un
  escenario donde alguien termine con privilegios que un guard le negaba: para
  llegar a este método hay que YA ser admin. Lo marco igual porque (a) es una
  violación de dato verificable y silenciosa —la fila queda corrupta
  (`rol_id` de otro tenant) sin que nada la detecte ni la pueda limpiar desde
  la UI de ese tenant—, y (b) si `assignUser` alguna vez se abre a un actor con
  menos que `TenantAdminGuard` (p.ej. un permiso granular de "puede invitar"),
  el chequeo que falta hoy se vuelve una escalada real de un día para el otro,
  sin tocar `RbacService`. Lo que me faltaría para subir la confianza a alta:
  un escenario donde el `usuarioId` objetivo NO sea ya alcanzable con el rol
  propio del tenant A — no lo encontré.
