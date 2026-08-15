## Lente: Concurrencia y transacciones
## Veredicto: 3 hallazgos

### Qué revisé para poder afirmarlo

Leí completos: `backend/src/modules/auth/auth.service.ts` (316), `tokens-acceso.service.ts`
(149) + su entidad, `auth.controller.ts` (198), `tenants/tenants.service.ts` (824 —
las 4 transacciones del archivo: `create`, `crearUsuario`, `setPreferida`,
`updatePreferenciasFinancieras`), `roles/roles.service.ts` (236) y las entidades de
`roles_usuarios`, `roles_permisos_modulos`, `modulos_roles`, `usuarios_tenants`,
`usuarios` (para saber qué índice único respalda cada check-then-act). Los 4 guards de
`common/guards/` (todos de solo lectura, sin escritura → sin superficie de carrera).
`rbac.service.ts` completo. Del lado frontend, `stores/auth.ts` y
`composables/useApiFetch.ts` (el singleton `refreshing`) y el flujo de guardado de
`pages/configuracion/roles/index.vue`. Crucé cada índice único citado contra los **tres**
lugares: la entidad TypeORM, `startup-pos.sql` y `seeder.service.ts` (grep de
`CREATE UNIQUE INDEX`). Confirmé con `grep` que ningún `*.spec.ts` del alcance usa
`Promise.all` ni simula concurrencia, y que `roles.service.ts` no tiene spec propio.

El único item con lock explícito documentado (`quemar()` del token de invitación/reset,
`UPDATE ... WHERE usado_el IS NULL`) lo verifiqué línea por línea contra el docblock que
lo describe — es correcto, no es hallazgo.

### H1. `refresh()` no reclama el token atómicamente: dos requests simultáneos con el mismo refresh token, los DOS canjean

- **Severidad:** media
- **Ubicación:** `backend/src/modules/auth/auth.service.ts:220-242` (método `refresh`)
- **Qué está mal:** `refresh()` hace `findOne` → (si no expiró) `delete({id})` → genera
  access+refresh nuevos. `refreshRepo.delete()` no revisa `affected` ni usa una condición
  atómica (`UPDATE ... WHERE token = $1 RETURNING *` o similar); es un `DELETE` por `id`
  que no falla si la fila ya no existe. No hay transacción ni lock entre el `findOne` y
  el `delete`.
- **Escenario:** dos requests `POST /auth/refresh` llegan casi simultáneos con la
  **misma** cookie `refresh_token` (token `T`, fila `X` en `refresh_tokens`). Orden real:
  A y B hacen `findOne` antes de que cualquiera borre — ambos ven `X` vigente. A borra
  `X` (éxito). B borra `X` (0 filas afectadas, pero `delete()` de TypeORM no lanza por
  eso: resuelve igual). Los dos generan y persisten un `refresh_token` nuevo y distinto.
  Resultado: **dos** sesiones válidas nacen de un solo canje de `T`, sin que ninguna de
  las dos falle ni se invalide la otra — no es "uno gana, uno pierde", es "los dos
  ganan". Disparador realista y concreto, sin necesitar herramientas de carga: el propio
  frontend serializa el refresh **por pestaña** con un singleton de módulo
  (`frontend/app/composables/useApiFetch.ts:1`, variable `refreshing`), pero esa
  variable **no se comparte entre pestañas**. Un usuario con dos pestañas abiertas del
  mismo tenant, cuyo access token vence mientras ambas están activas (típico al volver
  de standby), dispara en cada pestaña su propio `refreshing` y ambas pegan casi a la
  vez a `POST /auth/refresh` con la misma cookie.
- **Distinto de lo ya conocido:** lo ya anotado es que el refresh **rota sin detectar
  reuso** (un token viejo usado más tarde, secuencialmente, no dispara ninguna alarma).
  Esto es otra cosa: **dos usos simultáneos del mismo token vigente**, ninguno
  posterior — ambos caen dentro de la misma ventana de carrera del `findOne`/`delete`
  no atómico, así que ambos tienen éxito en el momento, no en una revisión a posteriori.
- **Por qué ningún test lo caza:** `auth.service.spec.ts` prueba `refresh()` con mocks
  secuenciales de un solo call; no hay ningún test que dispare dos `refresh()` con
  `Promise.all` sobre el mismo token. El e2e corre con `maxWorkers: 1`, así que dos
  requests HTTP realmente concurrentes tampoco existen ahí.
- **Confianza:** alta — el código no tiene ningún mecanismo (columna `usado`, `UPDATE
  ... WHERE`, lock) que lo proteja; a diferencia de `tokens-acceso.service.ts:quemar()`,
  que sí resuelve el mismo problema con un `UPDATE condicionado`. Lo que me falta para
  subirla a "muy alta" sería medir el timing real de la ventana en un entorno con
  latencia de red (la ventana entre `findOne` y `delete` es corta, pero dos pestañas en
  standby-wake es un disparador de uso normal, no un ataque de fuerza bruta).

### H2. `crearUsuario`: el índice único existe, pero el `23505` no se traduce — sale 500 crudo

- **Severidad:** media
- **Ubicación:** `backend/src/modules/tenants/tenants.service.ts:454-598` (método
  `crearUsuario`), rama nueva-cuenta en `523-551` y rama revivir-membresía en `514-522`
- **Qué está mal:** el alta hace check-then-act: `SELECT` por `LOWER(correo)` (línea
  490-494) y, si no hay fila, `INSERT` en `usuarios` (línea 529-538); o, si el usuario ya
  existe pero no es miembro, `findOne` de `UsuarioTenant` (línea 504-507) e `INSERT` si
  no hay fila (línea 517-522). **El índice único sí existe en los tres lugares que pide
  el brief**: `usuarios.correo` tiene `unique: true` en la entidad
  (`backend/src/modules/users/usuario.entity.ts:38`, confirmado también documentado —
  aunque no restringido a vivos, cualquier duplicado colisiona); `usuarios_tenants` tiene
  PK compuesta `(usuario_id, tenant_id)` (`entities/usuario-tenant.entity.ts:12-16`), que
  cubre el caso sin necesitar índice parcial del seeder. Pero **ninguna de las dos ramas
  atrapa el `23505`**: a diferencia de `updateMine()`, 60 líneas más abajo en el mismo
  archivo (`tenants.service.ts:653-661`), que sí hace
  `catch (err) { if (pg.code === '23505') throw new ConflictException(...) }`, y a
  diferencia del patrón que se repite en `descuentos.service.ts`, `recargos.service.ts`,
  `turnos.service.ts`, `cajones.service.ts`, `garzones.service.ts`, etc. — todos con el
  mismo `catch` de `23505` documentado con el mismo comentario. Acá falta.
- **Escenario:** dos admins (de dos tenants distintos, o el mismo admin con doble clic
  en el form aunque el front tenga guard de `saving`, basta con dos requests
  concurrentes) invitan al mismo correo nuevo `nueva@x.cl` casi al mismo tiempo, cada uno
  vía `POST /tenants/usuarios`. Ambas transacciones hacen el `SELECT` y ven `null` (el
  otro no commiteó todavía). Una gana el `INSERT` en `usuarios`; la otra revienta con
  `QueryFailedError` código `23505` **sin catch**, propaga fuera de la transacción, y
  Nest la traduce a un `500 Internal Server Error` genérico — no al `409` accionable que
  el resto del código sabe dar ("Ese correo ya está en uso"). Mismo patrón en la rama de
  `usuarios_tenants` (línea 517-522) si dos requests agregan al mismo usuario existente
  al mismo tenant a la vez. La transacción sí hace rollback limpio (no queda estado a
  medias — eso está bien), pero el admin que pierde la carrera ve un error opaco en vez
  de "ese correo ya se está usando".
- **Por qué ningún test lo caza:** `tenants.service.spec.ts` tiene un describe entero
  `crearUsuario — atomicidad` (línea 479-578) que prueba rollback ante fallo de la
  última sentencia, pero ningún test hace que `manager.save(Usuario, ...)` rechace con
  `{code: '23505'}` — el único test de ese código en todo el archivo
  (`tenants.service.spec.ts:168-173`) es para `updateMine`, no para `crearUsuario`.
- **Confianza:** alta — verificado abriendo las tres fuentes del índice (entidad,
  `startup-pos.sql` no aplica acá porque el índice es de `unique: true` en columna, no
  parcial de seeder) y confirmando por `grep` que el `catch` de `23505` existe en otros
  9 módulos del repo pero no en este método.

### H3. `setPermissions` no es transaccional: dos guardados concurrentes del mismo rol producen una unión, no el último-gana — un permiso "revocado" puede seguir vivo sin que nadie vea error

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/roles/roles.service.ts:127-165` (método
  `setPermissions`), endpoint `PUT /roles/:id/modules/:moduloTenantId/permissions`
  (`roles.controller.ts:97-108`)
- **Qué está mal:** el método reemplaza el conjunto de permisos de un rol+módulo con un
  patrón borrar-todo-e-insertar-lo-nuevo (`delete({rolId, moduloTenantId})` en la línea
  145, luego `save(entries)` en la línea 160), **sin `dataSource.transaction`** y sin
  ningún lock. `RolPermisoModulo` es una tabla con PK compuesta
  `(rol_id, modulo_tenant_id, modulo_app_permiso_id)` y **sin `eliminado_el`**
  (`entities/rol-permiso-modulo.entity.ts`), así que no hay ninguna fila "borrada" que
  desambiguar — el borrado es físico y el insert es un `INSERT` normal (que además, al
  ser un array, TypeORM lo emite como una sola sentencia multi-VALUES: si colisiona un
  solo id, la sentencia entera falla y ninguna fila de esa llamada se inserta).
- **Escenario:** el rol "Cajero" tiene hoy `{Ventas:Ver, Ventas:Crear, Ventas:Anular}` en
  el módulo Ventas. Dos administradores del mismo tenant (o el mismo admin en dos
  pestañas, cada una con su propio `drawerOpen` cargado desde un `GET` anterior)
  guardan casi a la vez sobre el mismo rol+módulo:
  - Admin A quiere sacar `Anular` → su `PUT` manda `[Ver, Crear]`.
  - Admin B, con la pestaña vieja (todavía no vio el cambio de A), guarda sin tocar nada
    → su `PUT` manda `[Ver, Crear, Anular]`.

  Intercalado real y verosímil: `A.DELETE` (borra las 3 filas) → `A.INSERT [Ver,Crear]`
  (éxito, tabla queda en 2 filas) → `B.DELETE` (borra esas 2 filas — el `DELETE` no
  compara contenido, borra lo que haya para ese `rolId+moduloTenantId`) →
  `B.INSERT [Ver,Crear,Anular]` (éxito, tabla vuelve a 3 filas). **Los dos `PUT`
  responden `200`.** El admin A ve éxito y cree que sacó `Anular`; el rol lo sigue
  teniendo, y todo usuario asignado a "Cajero" conserva el permiso de anular ventas que
  un administrador explícitamente intentó revocar — sin ningún error, log ni señal de
  que la escritura de A se perdió.
- **Por qué ningún test lo caza:** no existe `roles.service.spec.ts` en el repo (`find`
  sobre `backend/src/modules/roles` no devuelve ningún `*.spec.ts`) — `setPermissions`
  no tiene cobertura unitaria de ningún tipo, y el único guard frontend contra doble
  envío (`saving` en `pages/configuracion/roles/index.vue:34,165,201,360`) protege una
  sola pestaña contra doble clic, no dos sesiones/pestañas distintas escribiendo el
  mismo rol — que es exactamente el escenario de arriba.
- **Confianza:** media-alta — el mecanismo (delete-then-insert sin transacción, PK sin
  soft-delete que fuerza intercalado en vez de fallo) está verificado leyendo el archivo
  completo. Lo que la baja de "alta" pura a "media-alta": el disparador necesita dos
  sesiones activas guardando el mismo rol+módulo en la misma ventana de milisegundos —
  plausible operativamente (dos admins, o una pestaña vieja olvidada) pero no un ataque
  de un solo actor con un solo request.

### Notas descartadas (no llegaron a hallazgo)

- `elegirContrasena`/`tokens-acceso.service.ts:quemar()` — el canje de un solo uso SÍ es
  atómico (`UPDATE ... WHERE usado_el IS NULL`, revisado línea por línea): **limpio**,
  coincide con lo que documenta el propio código.
- `tenants.service.ts:create()` llama `garzonesService.asegurarMostrador(manager, ...)`
  dentro de la transacción — verifiqué que usa exclusivamente el `manager` pasado, sin
  tocar `this.dataSource` ni otro repo inyectado: **no es una variante del deadlock de
  pool de conexiones ya conocido.**
- `setPreferida()` y `updatePreferenciasFinancieras()` (`tenants.service.ts:709-733,
  764-823) tienen el mismo patrón delete/update-then-insert dentro de una transacción,
  pero ahí SÍ hay transacción y las sentencias tocan las mismas filas existentes, así que
  Postgres serializa por lock de fila en vez de intercalar — no encontré un escenario
  reproducible de corrupción.
- `recuperar()` (`auth.service.ts:145-160`) llama `invalidarAnteriores` + `emitir` sin
  transacción: dos pedidos de reset simultáneos para el mismo correo pueden dejar **dos**
  links vivos en vez de uno (viola el invariante que documenta el propio código), pero
  ninguno de los dos da más poder que un solo link ya daría — no hay escenario de acceso
  indebido, así que no lo conté como hallazgo de esta lente (severidad cosmética).
