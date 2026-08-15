## Lente: membresías y el paso de un tenant a otro
## Veredicto: 3 hallazgos

### Qué revisé para poder afirmarlo

Mapeé el ciclo de vida completo de `usuarios_tenants` abriendo el archivo en cada paso:
alta (`TenantsService.addMember` y `.crearUsuario`, `tenants.service.ts:403-598`), baja
(`.removeMember`, `:640-642`), tótem (`.marcarTotem`, `:609-638`) y cambio de tenant
(`AuthController.switchTenant` + `AuthService.switchTenant`/`.refresh`/`.getMyTenants`,
`auth.controller.ts:182-197` + `auth.service.ts:220-286`). Crucé la baja contra los tres
colgantes que pide el brief: sesiones vivas (`refresh_tokens`, `TenantGuard`), garzón
vinculado (`garzones.usuario_id`, `garzones.service.ts` completo — `garzonPersonalDe`,
`assertVinculable`, `verificarPin`, `regenerarPin`, `toPublico`) y caja/turno abiertos
(`caja.controller.ts` cierre forzado, `sesiones-garzon.controller.ts:64-69` `cerrarAdmin`).
Verifiqué unicidad de la membresía en los tres lugares que pide el brief: la entidad
(`usuario-tenant.entity.ts`), `startup-pos.sql:260-275` y el seeder
(`seeder.service.ts:1971,1980`) — coinciden, sin discrepancia (ver nota al final). Revisé
`es_totem` como columna de `usuarios_tenants` (no de `usuarios`) en los cuatro puntos donde
se lee o se escribe. Confirmé que las 25 rutas que combinan `PermisosGuard` van siempre
junto con `TenantGuard` (grep sobre los `.controller.ts`, sin excepciones), y que las tres
rutas que llevan `JwtAuthGuard` sin `TenantGuard` (`catalog`, `me`, `tipos-regla`) son
catálogos globales o perfil personal, no datos de tenant.

### H1. `removeMember` deja el garzón vinculado sin ninguna forma de operar, y nadie se entera

- **Severidad:** media
- **Ubicación:** `backend/src/modules/tenants/tenants.service.ts:640-642` (`removeMember`,
  no toca `garzones`); `backend/src/modules/garzones/garzones.service.ts:863-884`
  (`garzonPersonalDe`, filtra `ut.eliminado_el IS NULL`), `:37` (`PIN_INUTILIZABLE = '!'`),
  `:216` (el garzón "con cuenta" nace con `pinHash: PIN_INUTILIZABLE`), `:838-850`
  (`verificarPin`, `bcrypt.compare(pin, garzon.pinHash)`), `:611-649` (`regenerarPin`,
  `tieneCuenta` sigue siendo `true` mientras `garzon.usuarioId` no se limpie), `:134-150`
  (`toPublico`, no expone si la cuenta vinculada sigue siendo miembro del tenant) — los seis
  abiertos y verificados.
- **Qué está mal:** `removeMember` da de baja la membresía sin tocar `garzones` para nada.
  Si el garzón se dio de alta "con cuenta" (`usuarioId` seteado), nace con
  `pinHash = PIN_INUTILIZABLE`, un literal `'!'` que ningún PIN tipeado matchea jamás — la
  única forma de operar como ese garzón es el modo personal por JWT. Al remover la
  membresía, `garzonPersonalDe` deja de resolver a ese garzón (el `WHERE ut.eliminado_el IS
  NULL` no trae fila), así que el modo personal se cierra. El PIN sigue muerto porque nada
  lo reemite. El garzón queda **sin ninguna credencial que funcione**: ni cuenta (removida)
  ni PIN (nunca existió uno usable). Y el listado de garzones (`toPublico`) sigue mostrando
  `usuarioId` seteado con `pinFijado: false`, sin ninguna señal de que la cuenta detrás ya no
  pertenece al tenant — el admin tiene que cruzar manualmente contra la pantalla de usuarios
  para notar el problema.
- **Escenario:** Un tenant da de alta a Juan como garzón "con cuenta" (`POST /tenants/usuarios`
  + `POST /garzones` con `usuarioId` = el de Juan). Juan opera siempre en modo personal desde
  su tablet y nunca llama a `PATCH /garzones/mi-pin` (no tiene necesidad: la cuenta ya lo
  identifica). Juan deja la empresa; el admin hace `DELETE /tenants/members/{juanId}`. El
  garzón "Juan" sigue en la lista de `GET /garzones`, con `usuarioId` apuntando a una cuenta
  que ya no es miembro. Nadie puede volver a operar como ese garzón: no por cuenta (Juan ya no
  entra al tenant — `TenantGuard` lo rechaza en cualquier ruta), no por PIN
  (`PIN_INUTILIZABLE`). La única salida es que el admin, **sin que nada se lo indique**, ejecute
  dos acciones en orden — `PATCH /garzones/:id` con `usuarioId: null` para desvincular y
  después `POST /garzones/:id/regenerar-pin` para emitir uno nuevo — antes de que alguien
  pueda volver a ser ese garzón (o el garzón queda inservible para liquidaciones de propina
  futuras y cualquier operación de salón bajo su nombre).
- **Por qué ningún test lo caza:** No hay ningún `*.e2e-spec.ts` que combine `DELETE
  /tenants/members/:userId` con un garzón previamente vinculado a esa cuenta (grep sobre
  `garzones.service.spec.ts` y los e2e de `garzones`/`salones`/`caja-testigo`: todos prueban
  vincular/desvincular por `PATCH /garzones/:id`, ninguno prueba la baja de membresía como
  disparador). El mutante que probaría esto: borrar el filtro `ut.eliminado_el IS NULL` de
  `garzonPersonalDe` no pone nada en rojo porque ningún test deja una membresía eliminada con
  un garzón todavía vinculado.
- **Confianza:** alta — el camino completo (alta con cuenta → PIN muerto → baja de membresía →
  `garzonPersonalDe` corta → sin PIN vivo → dos acciones no evidentes para recuperar) está
  verificado línea por línea, no inferido.

### H2. `switchTenant` no valida que el tenant destino siga vivo; `getMyTenants` sí

- **Severidad:** baja
- **Ubicación:** `backend/src/modules/auth/auth.service.ts:268-286` (`switchTenant`, la
  consulta solo toca `usuarios_tenants`) vs. `:254-266` (`getMyTenants`, hace `JOIN tenants t
  ... AND t.eliminado_el IS NULL`); `backend/src/modules/tenants/tenants.controller.ts:61-64`
  (`DELETE /admin/tenants/:id`, solo `SuperadminGuard`, hace `softDelete`).
- **Qué está mal:** `switchTenant` valida la membresía (`usuarios_tenants.eliminado_el IS
  NULL`) pero nunca el estado del tenant. Su hermano de lectura, `getMyTenants`, sí filtra
  `t.eliminado_el IS NULL` — las dos consultas deberían decir lo mismo sobre "¿este tenant
  cuenta?" y no lo dicen.
- **Escenario:** un superadmin da de baja un tenant (`DELETE /admin/tenants/{id}`, soft
  delete). Un usuario que seguía siendo miembro (su fila en `usuarios_tenants` no se tocó:
  nada en `remove()` la toca) llama `POST /auth/switch-tenant` con ese `tenantId` — por
  ejemplo desde una pestaña vieja que todavía lo tenía en el selector, o tecleándolo a mano —
  y recibe `200` con un `access_token` nuevo cuyo `tenant_id` es el del tenant eliminado. El
  daño real es bajo: la primera ruta protegida con `TenantGuard` que toque (`tenants.guard.ts`
  sí busca el tenant sin `withDeleted`, así que no lo encuentra) devuelve 403 "El tenant no
  existe o fue eliminado". Pero el `200` inicial es información incoherente — dice que el
  cambio de tenant funcionó cuando no debería haber servido para nada — y el `refresh_token`
  emitido queda con `activeTenantId` apuntando a un tenant muerto, así que cada `POST
  /auth/refresh` posterior repite el mismo token inútil hasta que el usuario cambie de tenant
  de nuevo.
- **Por qué ningún test lo caza:** ningún e2e de auth (`auth.e2e-spec.ts` y afines) borra un
  tenant y después intenta `switch-tenant` hacia él con una membresía todavía viva — el único
  camino ejercitado es "no soy miembro" (`tenantId` ajeno), no "el tenant ya no existe".
- **Confianza:** alta en el gap (verificado abriendo las dos consultas), media en el impacto
  real — no encontré ninguna ruta que use `user.tenantId` del JWT sin pasar por `TenantGuard`
  para datos de negocio (grep de las 3 rutas que llevan solo `JwtAuthGuard`: son catálogos
  globales o perfil personal), así que el 403 downstream parece cerrar el borde real; lo que
  falta es la validación temprana y coherente, no el aislamiento.

### H3. El restore silencioso de una membresía también resucita `es_totem`, no solo los roles

- **Severidad:** baja
- **Ubicación:** `backend/src/modules/tenants/tenants.service.ts:403-420` (`addMember`, rama
  `existing.eliminadoEl` → `existing.eliminadoEl = null; return save(existing)`, línea
  411-413) y `:498-522` (`crearUsuario`, rama `miembro` con `withDeleted`, mismo patrón:
  `miembro.eliminadoEl = null`, línea 515); `backend/src/modules/tenants/entities/usuario-tenant.entity.ts:28-29`
  (`esTotem` vive en la misma fila que `eliminadoEl`).
- **Qué está mal:** el ítem ya conocido dice que `addMember` "no da de baja los roles viejos"
  al re-agregar — eso es sobre `roles_usuarios`, una tabla aparte. Pero el restore de
  `usuarios_tenants` es literal: toma la fila soft-borrada tal cual estaba y solo le limpia
  `eliminadoEl`. Ninguna otra columna se resetea, y `esTotem` vive en esa misma fila. Si la
  cuenta era tótem antes de la baja, vuelve a ser tótem al re-agregarse, sin que el admin lo
  haya pedido en el alta — ni `addMember` (solo recibe `usuarioId`) ni el DTO de `crearUsuario`
  (`CrearUsuarioTenantDto`) tienen un campo para decidirlo.
- **Escenario:** el admin marca la cuenta compartida del mostrador como tótem
  (`PATCH /tenants/members/{id}/totem`, `esTotem: true`). Meses después la da de baja
  (`DELETE /tenants/members/{id}`) por lo que sea — reorganización, cambio de dispositivo. La
  vuelve a sumar más tarde para otra persona real que va a operar con cuenta propia (mismo
  correo, p.ej. se reusó el mismo usuario administrativamente) via `POST /tenants/members` o
  `POST /tenants/usuarios`. La cuenta reaparece **todavía marcada tótem**, sin que nadie lo
  haya elegido en esta alta. Efecto concreto y verificable: si el admin ahora intenta
  vincularle un garzón personal, `assertVinculable` (`garzones.service.ts:527-532`) lo
  rechaza con *"Esa cuenta está marcada como tótem compartido... Desmarcala primero"* — un
  error que no tiene ninguna causa visible en el alta que el admin acaba de hacer.
- **Por qué ningún test lo caza:** `tenants.service.spec.ts` no tiene ningún caso que marque
  tótem, dé de baja y vuelva a dar de alta la misma cuenta para verificar el valor de
  `esTotem` tras el restore (grep del archivo: los tests de `addMember`/`crearUsuario` que
  tocan el camino de restore no leen `esTotem` en absoluto).
- **Confianza:** alta — mismo mecanismo de restore verificado en las dos rutas de alta,
  mismo patrón que el ítem ya conocido de los roles; se reporta como variante porque es una
  columna distinta con un efecto colateral distinto (bloquea vincular un garzón), no una
  repetición del hallazgo ya anotado.

### Nota — lo que salió limpio

- **Unicidad de la membresía:** `usuarios_tenants` usa **PK compuesta** (`usuario_id,
  tenant_id`) en los tres lugares — entidad, `startup-pos.sql:260-275` y (por consistencia,
  el seeder no necesita crear un índice parcial acá, a diferencia de `garzones`, porque la PK
  compuesta ya impide una segunda fila para el mismo par incluso con soft delete: no hay
  file para "restaurar" salvo la misma fila). No hay discrepancia entre los tres.
- **`es_totem` por membresía, no por usuario:** confirmado en la entidad (`usuario-tenant.entity.ts:28-29`,
  no en `usuario.entity.ts`) y en el seed (`seeder.service.ts:1980`, `UPDATE usuarios_tenants
  SET es_totem = true`). Ser tótem en el tenant A no hace tótem en el tenant B: cada fila de
  `usuarios_tenants` tiene su propio valor, default `false` en el alta nueva.
- **`switchTenant` contra membresía inexistente o tenant inventado:** correcto — la consulta
  no devuelve filas y tira `ForbiddenException`, verificado.
- **Usuario sin ninguna membresía:** puede loguearse (`POST /auth/login` no exige
  membresía), `GET /auth/me` funciona (no depende de tenant), `GET /auth/my-tenants` devuelve
  `[]`. Es el estado esperado de alguien sin tenants asignados, no un hueco.
- **Rutas con `PermisosGuard`:** las 25 que lo usan (`grep` sobre los `.controller.ts` del
  alcance) van siempre combinadas con `TenantGuard`, así que la membresía se revalida en
  vivo en cada request — la falta de revalidación de membresía en `AuthService.refresh`
  (`:220-242`, re-emite el `access_token` con el `activeTenantId` guardado sin volver a
  chequear `usuarios_tenants`) queda sin efecto práctico: la primera ruta de negocio que se
  toque con ese token corta en `TenantGuard`. No lo reporto como hallazgo aparte porque no
  encontré un escenario donde ese token sirva para algo — es la misma raíz que H2, con el
  mismo cierre downstream.
