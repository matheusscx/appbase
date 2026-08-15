## Lente: ciclo de vida de los tokens (access + refresh + tokens_acceso)
## Veredicto: 4 hallazgos

### Qué revisé para poder afirmarlo

Leí completos: `auth/auth.service.ts` (316), `auth/auth.controller.ts` (198),
`auth/tokens-acceso.service.ts` (149), `auth/entities/refresh-token.entity.ts`,
`auth/entities/token-acceso.entity.ts`, `auth/strategies/jwt.strategy.ts`,
`auth/strategies/google.strategy.ts`, `auth/auth.module.ts`,
`common/guards/{tenant,superadmin,permisos,tenant-admin}.guard.ts`,
`modules/me/me.controller.ts` + `me.service.ts`, `modules/users/users.service.ts`,
`frontend/app/stores/auth.ts`, `frontend/app/composables/useApiFetch.ts`,
`frontend/app/middleware/auth.ts`, `frontend/app/pages/auth/callback.vue`.
Dos sub-búsquedas dirigidas (con `Explore`, sub-agente) para: (a) qué controllers
tienen `TenantGuard` en su cadena — los 43 `*.controller.ts` del backend, y
(b) si existe algún camino para degradar `es_superadmin`, borrar un `Usuario`, o
cambiar contraseña autenticado, y si esos caminos invalidan `refresh_tokens` —
confirmado abriendo `tenants.service.ts:640-642`, `users.service.ts` completo (48
líneas), `me.service.ts` completo. Grep de tests: no existe `me.service.spec.ts`
ni ningún test de `googleLogin`/`linkGoogleId` (`auth.service.spec.ts` solo
cubre `generateTokens`, `refresh`, `logout`).

Lo que verifiqué que está BIEN (no lo reporto, pero está medido):
- El access token lleva `sub`, `email`, `tenant_id`, `es_superadmin`
  (`auth.service.ts:211-218`) — **no** lleva permisos, así que revocar un
  permiso/rol tiene efecto inmediato (`PermisosGuard` consulta
  `RbacService.userHasPermiso` en cada request, `permisos.guard.ts:30-35`).
- La membresía de tenant se re-valida contra `usuarios_tenants` en **cada
  request** vía `TenantGuard` (`tenant.guard.ts:27-33`), no se confía en el
  claim del token. Confirmado: los 4 módulos críticos (ventas, caja, items,
  inventario) tienen `TenantGuard` en su cadena; el único controller con solo
  `JwtAuthGuard` que use algo del JWT es `auth.controller.ts` mismo, y ahí
  `switchTenant` re-valida membresía a mano (`auth.service.ts:272-278`).
- `refresh()` recarga `existing.user` desde la BD (`relations: { user: true }`,
  `auth.service.ts:223-226`) antes de re-firmar, así que `es_superadmin`
  también se refresca cada ciclo (máx. `JWT_EXPIRATION`, 15m por defecto).
- Los `tokens_acceso` (invitación/reset) expiran, son de un solo uso con
  `UPDATE ... WHERE usado_el IS NULL` contra la carrera de doble submit
  (`tokens-acceso.service.ts:86-99`), y `elegirContrasena` mata **todos** los
  tokens vivos de la cuenta + todos los refresh tokens (`auth.service.ts:113-134`).

### H1. Cambiar la contraseña desde `/me` no cierra las demás sesiones
- **Severidad:** alta
- **Ubicación:** `backend/src/modules/me/me.service.ts:28-46` (método
  `updateContrasena`), controller en `backend/src/modules/me/me.controller.ts:26-29`
- **Qué está mal:** `updateContrasena` valida la contraseña actual, hashea la
  nueva y hace `this.repo.update(userId, { contrasena: hashed })` (línea 44).
  No hay ninguna llamada a `refreshRepo` — `MeService` ni siquiera inyecta el
  repo de `RefreshToken` (solo `Repository<Usuario>`, líneas 19-20). Compará
  con el flujo hermano `elegirContrasena` (reset por link), que sí lo hace
  explícito con comentario propio: "Se cierran las sesiones vivas: si el reset
  lo pidió alguien porque le tomaron la cuenta, dejar los refresh tokens del
  intruso vivos vaciaría el sentido del reset" (`auth.service.ts:131-134`,
  `this.refreshRepo.delete({ userId: fila.usuarioId })`).
- **Escenario:** un atacante obtiene la `refresh_token` cookie de la víctima
  (dispositivo compartido, malware, backup de sesión). La víctima nota algo raro
  y cambia su contraseña desde `Configuración → Mi cuenta` (`PATCH
  /me/contrasena`, autenticado con su propio access token). El endpoint responde
  200 y la contraseña queda cambiada — pero el `refresh_token` robado sigue
  siendo una fila viva en `refresh_tokens`. El atacante sigue pidiendo
  `access_token`s nuevos indefinidamente vía `POST /auth/refresh`
  (`auth.service.ts:220-242`, que no valida nada sobre la contraseña), sin
  límite hasta que expire por tiempo (`JWT_REFRESH_EXPIRATION`, 1h por defecto,
  pero se renueva en cada refresh porque `refresh()` emite un refresh token
  nuevo con TTL nuevo cada vez — la sesión robada es indefinida en la práctica).
  Es exactamente el caso que el propio comentario de `elegirContrasena` describe
  como la razón de ser de esa línea, pero el otro camino de cambio de
  contraseña no la tiene.
- **Por qué ningún test lo caza:** no existe `me.service.spec.ts` (`find
  src/modules/me -type f` no devuelve ningún `*.spec.ts`) ni un e2e que ejerza
  `PATCH /me/contrasena` y luego intente `/auth/refresh` con el token viejo.
- **Confianza:** alta — comparación directa con el patrón gemelo ya implementado
  en el mismo archivo (`auth.service.ts`), mismo repo, mismo propósito.
- No requiere tocar cómo se firman/rotan los tokens: es agregar
  `refreshRepo.delete({ userId })` (patrón que ya existe dos veces en
  `auth.service.ts`) al final de `updateContrasena`. No es ⛔ TOCA JWT.

### H2. El access token viaja en la URL del callback de Google y habilita robo de sesión persistente
- **Severidad:** alta
- **Ubicación:** `backend/src/modules/auth/auth.controller.ts:135-143`
  (`googleCallback`), consumido en `frontend/app/pages/auth/callback.vue:7-14`
- **Qué está mal:** `googleCallback` genera los tokens y hace
  `res.redirect(\`${frontendUrl}/auth/callback?token=${access_token}\`)`
  (línea 142) — el **access token en claro** va como query string de una
  navegación real del navegador. Eso lo escribe en: el historial del
  navegador (la entrada de la redirección HTTP es una carga de página real,
  no un cambio de ruta client-side), y en cualquier log de acceso/proxy/CDN
  delante del frontend que registre la URL completa de los requests entrantes.
  `callback.vue` lee `route.query.token` (línea 8) y llama `navigateTo(...)`
  sin `{ replace: true }`, así que ni siquiera se reemplaza la entrada de
  historial que tiene el token.
- **Escenario:** alguien con acceso al historial del navegador de la víctima
  (equipo compartido, sync de Chrome/Google a otra sesión, extensión con
  permiso de historial) o a los logs del hosting del frontend recupera la URL
  `.../auth/callback?token=<JWT>`. Con ese `access_token` (válido ~15 min,
  `tenant_id: null` porque es el primer token tras login, antes de elegir
  tenant) hace, **con curl, sin necesitar el navegador de la víctima**:
  `POST /auth/switch-tenant` con `Authorization: Bearer <token robado>` y
  `{ tenantId: <cualquiera de los tenants de la víctima> }`. Ese endpoint solo
  exige `JwtAuthGuard` (`auth.controller.ts:182-183`), no `TenantGuard` (tiene
  sentido, todavía no hay tenant activo), y `switchTenant`
  (`auth.service.ts:268-286`) responde con un `access_token` nuevo **en el
  body** y un `refresh_token` nuevo **en el header `Set-Cookie`** de la
  respuesta HTTP — visible para cualquier cliente HTTP, no solo un navegador.
  El atacante ahora tiene un refresh token de larga vida para operar sobre
  cualquier tenant de la víctima, obtenido 100% fuera de la ventana de 15
  minutos del token original.
- **Por qué ningún test lo caza:** no existe ningún e2e ni spec de
  `googleCallback`/`googleLogin` (`grep -rln "google"
  src/modules/auth/*.spec.ts test/*.e2e-spec.ts` solo matchea
  `auth.service.spec.ts`, que no tiene ningún `describe('googleLogin')` ni
  `describe('googleCallback')`) — probar el flujo Google real requiere mockear
  passport, y nadie lo hizo.
- **Confianza:** alta en el mecanismo (código leído línea por línea); media en
  qué tan explotable es "acceso al historial/logs" en el mundo real de este
  producto — pero el patrón (token vivo en query string de una navegación de
  servidor) es un antipatrón conocido independientemente de esa duda.
- No es ⛔ TOCA JWT: el arreglo es de transporte (por ejemplo, entregar el
  access token por el mismo mecanismo que ya existe para el refresh —cookie
  httpOnly de corta vida, o un código de intercambio de un solo uso— en vez
  de query string), no cambia cómo se firman, verifican o rotan los tokens.

### H3. La rotación del refresh token no detecta reuso
- **Severidad:** media
- **Ubicación:** `backend/src/modules/auth/auth.service.ts:220-242` (`refresh`)
- **Qué está mal:** `refresh()` sí rota (borra el token usado y emite uno
  nuevo, líneas 232-240), pero no hay ningún mecanismo de "familia de tokens":
  si el refresh token viejo (ya borrado) se vuelve a presentar —la señal
  clásica de que alguien más lo usó primero— la única reacción es
  `UnauthorizedException('Refresh token inválido')` (línea 227), indistinguible
  de "nunca existió" o "ya venció". No hay revocación en cascada de la sesión
  ni ninguna alerta.
- **Escenario:** un atacante copia el `refresh_token` (cookie httpOnly, pero
  igual de copiable si hay acceso al disco/backup del navegador o al tráfico
  antes de TLS) y lo usa una vez en `/auth/refresh` antes que la víctima. Su
  request rota el token: el original queda borrado, el atacante recibe uno
  nuevo. La próxima vez que la víctima —con su sesión legítima, ignorando que
  fue copiada— intente refrescar, su `refresh_token` (el viejo, ya rotado por
  el atacante) da 401 "inválido". El usuario ve un logout inexplicado y
  vuelve a loguearse; nada en el sistema marca esto como sospechoso ni revoca
  la sesión que el atacante ya obtuvo con la rotación.
- **Por qué ningún test lo caza:** `auth.service.spec.ts:114-158` (`describe
  'refresh'`) prueba "no encontrado", "expirado" y "rotación exitosa" en
  aislamiento, pero no un escenario de dos usos del mismo token original
  (uno exitoso + reintento con el ya-borrado) verificando que el segundo uso
  triggeree algo más que un 401 genérico.
- **Confianza:** media — es un gap de diseño real y verificado en el código,
  pero no tengo una vía de robo del refresh token cookie httpOnly más
  concreta que "acceso al dispositivo/tráfico", que es un prerequisito fuerte
  y ya compartido con cualquier sesión web.
- **⛔ TOCA JWT** — el arreglo (detectar reuso de un token ya rotado y
  revocar la familia completa) implica modificar la lógica de rotación de
  `refresh()`, que es parte del sistema de tokens ya implementado. No lo
  propongo como corrección de rutina; queda para que el owner decida si lo
  quiere.

### H4. El login con Google ignora `email_verified` al vincular cuentas por correo
- **Severidad:** media
- **Ubicación:** `backend/src/modules/auth/strategies/google.strategy.ts:7-11`
  (interfaz `GoogleProfile`, sin campo `verified`) y `:32-45` (`validate`,
  solo extrae `emails[0].value`); `backend/src/modules/auth/auth.service.ts:178-201`
  (`googleLogin`, hace `findByEmail` + `linkGoogleId` sin ningún chequeo
  adicional)
- **Qué está mal:** `passport-google-oauth20` sí expone si el correo está
  verificado — confirmado en
  `backend/node_modules/passport-google-oauth20/lib/profile/openid.js:33`:
  `profile.emails = [{ value: json.email, verified: json.email_verified }]`.
  El código de la app declara `GoogleProfile.emails` como
  `Array<{ value: string }>` (sin `verified`) y `googleLogin` nunca lo
  consulta: si existe una cuenta local con ese correo (`findByEmail`,
  `auth.service.ts:185`), la vincula automáticamente
  (`linkGoogleId`, línea 187) sin pedir la contraseña de esa cuenta ni
  verificar que el correo que Google reporta esté confirmado.
- **Escenario:** una cuenta de Google cuyo email para ese dominio no está
  verificado (el caso documentado es Google Workspace con dominios
  recién agregados o alias no confirmados) se autentica contra `GET
  /auth/google` con el correo `victima@empresa.com`, que ya tiene una cuenta
  local en el SaaS con contraseña. `googleLogin` encuentra esa cuenta por
  `findByEmail` y le adjunta el `googleId` del atacante — desde ese momento el
  atacante entra a la cuenta de la víctima con "Iniciar sesión con Google",
  sin haber probado nunca que controla ese correo.
- **Por qué ningún test lo caza:** no existe ningún test de `googleLogin` ni
  de `linkGoogleId` (`grep -n "googleLogin\|linkGoogleId"
  src/modules/auth/auth.service.spec.ts` → sin resultados; `users.service.ts`
  tampoco tiene spec).
- **Confianza:** media — el mecanismo y el campo ignorado están 100%
  verificados en el código; lo que no pude verificar es qué tan realista es
  que Google entregue `email_verified: false` para un flujo OAuth de
  consentimiento estándar (es la vía documentada de este vector, pero es un
  caso de borde de la plataforma de Google, no algo que pueda reproducir sin
  una cuenta de prueba en esas condiciones).
- No es ⛔ TOCA JWT: el arreglo vive en `googleLogin`/`google.strategy.ts`
  (agregar el campo `verified` a la interfaz y rechazar o exigir un paso
  extra si es `false`), no en cómo se emiten o rotan los tokens JWT.
