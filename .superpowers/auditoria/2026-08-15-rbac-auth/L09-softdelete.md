## Lente: Soft delete y forma de las consultas
## Veredicto: 1 hallazgo

### Qué revisé para poder afirmarlo

- **`rbac.service.ts` (165 líneas, las 6 queries SQL crudas completas):** 2 en
  `userHasPermiso`, 1 en `userIsTenantAdmin`, 3 en `getMisPermisos`. Seguí la cadena
  `roles_usuarios → roles → modulos_roles → tenant_modulos → modulos_app →
  roles_permisos_modulos → modulo_app_permisos → permisos` eslabón por eslabón (7 tablas)
  y abrí cada entidad para confirmar si declara `@DeleteDateColumn` antes de exigirle el
  filtro (evitando el falso positivo que el brief marca).
- **`roles.service.ts`** (10 métodos, archivo entero), **`tenants.service.ts`** (824
  líneas / ~20 métodos, archivo entero), **`auth.service.ts`** (316 líneas / 14 métodos,
  archivo entero), **`tokens-acceso.service.ts`** (6 métodos), **`users.service.ts`** (5
  métodos), **`me.service.ts`** (3 métodos) — todas las queries raw SQL,
  `createQueryBuilder` y llamadas a repos.
- **Los 4 guards** (`tenant.guard.ts`, `permisos.guard.ts`, `tenant-admin.guard.ts`,
  `superadmin.guard.ts`) por N+1 en el camino caliente de autorización: ninguno multiplica
  consultas por fila, son roundtrips constantes por request (no es hallazgo de esta lente).
- **12 entidades** abiertas para confirmar presencia/ausencia real de `eliminado_el`:
  `RolUsuario`, `Rol`, `ModuloRol`, `TenantModulo`, `ModuloApp`, `ModuloAppPermiso`,
  `Permiso`, `RolPermisoModulo` (sin la columna — tabla de asociación pura, se
  hard-deletea con `.delete()` en `setPermissions`, consistente en todo el módulo),
  `Usuario`, `TokenAcceso`, `RefreshToken` (sin la columna, hard delete), `Tenant`.
- Controllers de `roles` y `tenants` completos, para mapear qué guard cubre cada ruta de
  escritura y cruzar contra el service.

### ⚠️ Discrepancia con el brief (no bloqueante, ya verificado abriendo archivo)

El brief dice que `usuarios`, `refresh_tokens` y `tokens_acceso` son tablas "sin la
columna a propósito", citando `docs/patterns/backend.md § "Tablas sin tenant_id"`. Abrí
las tres entidades: **`usuarios` (`usuario.entity.ts:56`) y `tokens_acceso`
(`token-acceso.entity.ts:66`) sí declaran `@DeleteDateColumn('eliminado_el')`**. La
sección citada censa tablas sin `tenant_id` (otra columna), no sin `eliminado_el` — son
censos distintos. Solo `refresh_tokens` (`refresh-token.entity.ts`) de verdad carece de
`eliminado_el` (usa `DELETE` físico en `auth.service.ts` / `logout`, `switchTenant`,
`elegirContrasena`). No paré la pasada por esto (regla 2 ya me obligaba a abrir cada
entidad antes de afirmar nada, así que la discrepancia no contaminó ningún hallazgo), pero
lo marco para que no se repita en la próxima pasada que use este brief como base.

### H1. `assignUser` no valida que el rol exista, sea del tenant activo ni esté vivo

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/roles/roles.service.ts:73-107` (método
  `assignUser`), invocado desde `backend/src/modules/roles/roles.controller.ts:68-77`
  (`POST /roles/:id/users`, guardado por `TenantAdminGuard`). Abrí ambos archivos.
- **Qué está mal:** el método toma el `rolId` de la URL y crea o restaura una fila en
  `roles_usuarios` sin verificar en ningún momento que ese `rol_id` (a) exista, (b)
  pertenezca al tenant activo del token, o (c) no esté soft-eliminado. Solo valida que el
  **usuario destino** sea miembro del tenant (líneas 79-86); nunca toca `roles`. Esto
  contrasta con sus dos hermanos en el mismo módulo, que sí hacen el chequeo:
  - `setPermissions` (mismo archivo, líneas 133-135): `const rol = await
    this.rolRepo.findOne({ where: { id: rolId, tenantId } }); if (!rol) throw new
    NotFoundException(...)`.
  - `crearUsuario` (`tenants.service.ts:465-478`): valida
    `rolesDelTenant.length !== dto.rolIds.length` contra `SELECT rol_id FROM roles WHERE
    rol_id = ANY($1) AND tenant_id = $2 AND eliminado_el IS NULL`, con un comentario en el
    código (línea 441-446) que explica por qué ese chequeo es indispensable.
- **Escenario:** Carla es admin (rol `es_fijo`) del Tenant A y además miembro (no admin)
  del Tenant B — el modelo del sistema permite pertenecer a varios tenants. Operando en
  Tenant B llama `GET /roles` (lectura abierta a cualquier miembro del tenant) y ve el
  `rol_id` de "Contador". Cambia a Tenant A (donde es admin) y llama `POST
  /roles/{rolIdDeContadorDeB}/users` con el `usuarioId` de un cajero de Tenant A. El
  endpoint responde `201` y crea `roles_usuarios(usuario_id=cajero, tenant_id=A,
  rol_id=<rol de Tenant B>)` — nada en el camino lo rechaza porque no hay FK en la entidad
  `RolUsuario` (`rol-usuario.entity.ts`: solo `@PrimaryColumn`, sin `@ManyToOne`, así que
  tampoco hay constraint de base que lo frene). Combinado con el hallazgo **ya reportado
  por otra lente** —que las tres consultas de `rbac.service.ts` no atan `roles.tenant_id`
  con `roles_usuarios.tenant_id`— el cajero de A hereda en la práctica los permisos del
  rol "Contador" de B la próxima vez que un `@RequiresPermiso('Contador', ...)` lo evalúe
  en Tenant A. No repito esa segunda pieza como hallazgo propio, solo explico el alcance
  real de la mía. **Incluso sin esa segunda pieza**, el mismo defecto ya es un bug de esta
  lente por sí solo: permite crear `roles_usuarios` apuntando a un `rol_id`
  **soft-eliminado** — un admin borra el rol "Mesero" (`DELETE /roles/:id` →
  `rolRepo.softDelete`) y, con una pestaña vieja que aún conserva ese id en memoria,
  reasigna a alguien: `201` silencioso, fila huérfana que ninguna pantalla vuelve a
  mostrar porque `findAll` y `findPermissions` sí filtran el rol borrado (por default de
  repo TypeORM), así que la inconsistencia queda invisible.
- **Por qué ningún test lo caza:** no existe `roles.service.spec.ts` (el archivo no está
  en el árbol — confirmado con `find`) ni ningún `*.e2e-spec.ts` que ejercite `POST
  /roles/:id/users`: un grep de `roles/` y `assignUser` sobre
  `backend/test/*.e2e-spec.ts` no encuentra ninguna coincidencia. Los dos e2e del alcance
  (`tenants-members.e2e-spec.ts`, `alta-usuarios-tenant.e2e-spec.ts`) cubren
  `addMember`/`crearUsuario`, nunca `assignUser`.
- **Confianza:** alta — no es una lectura aislada de estilo: comparé línea por línea
  contra los dos métodos hermanos del mismo módulo (`setPermissions`, `crearUsuario`) que
  sí hacen exactamente este chequeo, así que la ausencia en `assignUser` es una
  inconsistencia real y verificable, no una interpretación mía de qué "debería" validar.
