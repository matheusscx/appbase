## Lente: Fuga de datos en respuestas y logs
## Veredicto: 1 hallazgo

### Qué revisé para poder afirmarlo

- **Servicios completos, línea a línea**: `auth.service.ts` (317), `tokens-acceso.service.ts`
  (150), `rbac.service.ts` (125), `roles.service.ts` (237), `tenants.service.ts` (825),
  `users.service.ts` (49), `me.service.ts` (58) — cada `return` rastreado hasta el objeto que
  sale por el controller.
- **Los 5 controllers del alcance** (`auth`, `rbac`, `roles`, `tenants` — incluye
  `AdminTenantsController` —, `me`): confirmé qué guard llevan y qué devuelven.
- **Las 10 entidades tocadas** (`Usuario`, `UsuarioTenant`, `RefreshToken`, `TokenAcceso`,
  `Tenant`, `Rol`, `RolUsuario`, `RolPermisoModulo`, `ModuloRol`, `TenantModulo`): campo por
  campo, buscando algo más que el hash ya conocido.
- **Los 4 guards + 2 decoradores + `jwt-user.interface.ts` + 3 estrategias passport**: sin
  hallazgos.
- **Grep de `logger.\|console.`** sobre los 6 módulos de backend del alcance: cero
  resultados directos. Se extendió a `mail/mail.service.ts` porque `auth.service.ts` y
  `tenants.service.ts` lo invocan directamente para emitir los links de invitación/reset —
  ahí apareció el hallazgo.
- **Grep de `@Res(` en los 5 controllers**: todas las rutas usan `passthrough: true` salvo
  `googleCallback` (que solo redirige con `access_token` en la query, sin cuerpo con el
  usuario) — confirma que `ClassSerializerInterceptor` cubre los caminos normales, sin
  atajos que lo esquiven.
- **Grep de `contrasena` en los services fuera de `usuario.entity.ts`**: solo aparece donde
  se hashea/compara, nunca en un objeto de retorno.
- **`findMembers` / `findMembersParaSelector`** (`tenants.controller.ts:108-131`,
  `tenants.service.ts:317-401`): confirmé que la corrección de `GET /tenants/members` que
  cita el brief está completa — `members` quedó con `TenantAdminGuard` y su SQL solo trae
  `correo`+`roles` a un admin; `para-selector` es una query separada que nunca selecciona
  `correo` ni hace el JOIN a roles. Sin variante del bug.
- **`getMyTenants`** (`auth.service.ts:254-266`): filtra siempre por el `userId` del propio
  token — ninguna ruta del alcance acepta un `usuarioId` de otra persona para listar sus
  tenants.
- **Frontend**: `middleware/auth.ts`, `admin.ts`, `permiso.ts`; `stores/auth.ts`,
  `tenant.ts`, `permissions.ts`; `composables/usePermisosCrud.ts`; `pages/login.vue`,
  `admin.vue`, `configuracion/usuarios/index.vue`, `configuracion/roles/{index,[id]}.vue`.
  Grep de `console.\|localStorage\|sessionStorage`: cero resultados. El access token vive en
  `useCookie` (no `localStorage`), fuera del lente de "qué se filtra en logs/respuestas".

### H1. Los links de invitación/reset —el token en claro— quedan en el log del backend

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/mail/mail.service.ts:72-80` (rama `enviar()` cuando
  `SMTP_HOST` está vacío), disparada desde `backend/src/modules/auth/auth.service.ts:145-160`
  (`recuperar`) y `backend/src/modules/tenants/tenants.service.ts:584-596` (`crearUsuario`).
- **Qué está mal:** `TokenAcceso` guarda solo el hash SHA-256 del token — el texto plano
  "existe una sola vez", según su propio docblock (`token-acceso.entity.ts:26-27`). Pero
  cuando `SMTP_HOST` está vacío, `MailService.enviar()` no manda el mail: llama a
  `this.logger.log(...)` con el cuerpo completo, que incluye la URL con el token en claro
  (`mail.service.ts:74-79`). Eso reintroduce el texto plano en un segundo lugar — el log de
  la aplicación — que el diseño de la tabla dice explícitamente que no debería existir.
- **Escenario:** `SMTP_HOST` vacío es el valor por defecto de `.env.example:49`, y no hay
  ningún chequeo de `NODE_ENV` que lo condicione a desarrollo — `mail.service.ts` decide
  solo por si `SMTP_HOST` tiene valor. Si un deploy de producción (p. ej. Railway) no setea
  esa variable, cualquier `POST /auth/recuperar` con un correo válido, o cualquier
  `POST /tenants/usuarios` que invite a alguien nuevo, escribe en el log de la app una URL
  del tipo `.../recuperar/<token-de-256-bits-en-claro>`. Quien tenga acceso de solo-lectura
  a esos logs (un panel de logs compartido, un agregador externo, un compañero con acceso de
  ops pero sin acceso a la base) puede abrir ese link y fijar una contraseña nueva para esa
  cuenta — toma total de una cuenta ajena, sin tocar la base de datos ni el hash.
- **Por qué ningún test lo caza:** el propio `invitacion-y-reset.e2e-spec.ts:20` dice "ningún
  test manda mail: `SMTP_HOST` está vacío en el entorno de test" — la suite corre
  exactamente en el modo que logea el token, y ningún assert revisa qué queda en el log
  (solo se verifica el flujo HTTP). No hay ningún test que falle si el link aparece en
  stdout, y no hay ningún chequeo de arranque que impida bootear con `SMTP_HOST` vacío fuera
  de un entorno de desarrollo/test declarado.
- **Nota:** el mecanismo en sí (loguear en vez de mandar cuando no hay SMTP) es una decisión
  ya documentada y cerrada por el owner — está en `docs/agent/resueltos.md:1157-1163` como
  requisito para no disparar mails reales en cada corrida de e2e/CI. Lo que reporto acá es
  distinto y no está en ese cierre ni en `pendientes.md`: **nada en el código obliga a que
  `SMTP_HOST` esté seteado en producción**, así que la misma rama pensada para el loop de
  desarrollo queda activa por defecto también ahí si la variable no se configura — el
  riesgo es la ausencia de un guardrail para ese caso, no la existencia del fallback.
- **Confianza:** alta — verifiqué el `logger.log` exacto, el valor por defecto en
  `.env.example`, la ausencia de gate por `NODE_ENV`, y el comentario del e2e que confirma
  que la suite corre en el modo que dispara el log. Lo que bajaría más la confianza sería
  saber con certeza que el deploy de Railway sí tiene `SMTP_HOST` seteado hoy (no lo
  verifiqué contra las variables reales del entorno de producción, solo contra el código y
  el `.env.example`).
