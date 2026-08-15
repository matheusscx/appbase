## Lente: Superficie pública — todo lo que se puede hacer SIN token

## Veredicto: 3 hallazgos

### Qué revisé para poder afirmarlo

- **Censo completo**: los 43 `*.controller.ts` de `backend/src` (`find backend/src -name
  "*.controller.ts"`), uno por uno, mirando `@Controller`, `@UseGuards` de clase y de
  handler, y cada ruta declarada. No existe un decorator `@Public()` en el repo (`grep -rl
  "Public()"` → vacío) ni un `APP_GUARD` global (`grep "APP_GUARD" app.module.ts` → vacío):
  los guards se aplican **solo** por controller/handler, así que la ausencia de
  `@UseGuards` en un archivo es la señal completa, no hay un segundo mecanismo que revisar.
- Rutas sin `JwtAuthGuard` encontradas (18, agrupadas):
  - `AppController`: `GET /`, `GET /health` — anónimo a propósito (healthcheck Railway),
    documentado en el propio archivo.
  - `AuthController` (sin `@UseGuards` de clase): `POST /auth/register`, `GET/POST
    /auth/invitacion/:token`, `GET /auth/recuperar/:token`, `POST /auth/recuperar`, `POST
    /auth/recuperar/:token`, `POST /auth/login` (`LocalAuthGuard`), `GET
    /auth/google[/callback]` (`AuthGuard('google')`), `POST /auth/refresh`, `POST
    /auth/logout` (estas dos se autentican con la cookie `refresh_token`, no con guard).
  - `PasarelaRetornoController` (`pasarela/retorno/*`, 4 rutas): anónimo a propósito
    (retorno de Webpay, token de un solo uso de Transbank) — leí el controller entero,
    solo hace `redirect(302, urlRedireccion)`, no devuelve datos del pago ni del tenant.
  - `PasarelaApiController` (`pasarela/api/*`): no lleva `JwtAuthGuard` pero sí
    `ApiKeyGuard` (credencial m2m) — no es superficie "sin credencial", quedó fuera de esta
    lente.
- Sobre las rutas públicas a propósito, leí completos `auth.controller.ts` (198 líneas),
  `auth.service.ts` (316), `tokens-acceso.service.ts` (141) y las partes de
  `tenants.service.ts` que arman el alta de usuario del tenant (`crearUsuario`,
  líneas 454-598), buscando específicamente: enumeración de usuarios/tenants, qué revela
  cada respuesta pública, qué crea `register`, y qué distingue un token vencido de uno
  inexistente.
- Confirmé que el hash de contraseña **no** se filtra: `Usuario.contrasena` lleva
  `@Exclude()` (`usuario.entity.ts:26`) y `ClassSerializerInterceptor` está registrado
  global en `main.ts:20`, antes de cualquier ruta — se aplica igual con
  `@Res({passthrough:true})`.
- **Limpio, verificado explícitamente:**
  - `POST /auth/login`: mismo mensaje `"Credenciales inválidas"` exista o no el correo
    (`local.strategy.ts`, vía `validateUser` que devuelve `null` en ambos casos). No hay
    oráculo de enumeración acá.
  - `POST /auth/recuperar`: responde el mismo `200` y el mismo mensaje exista o no la
    cuenta (`auth.service.ts:145-160`), con comentario explícito de por qué.
  - `GET /auth/invitacion/:token` y `GET /auth/recuperar/:token`: mismo mensaje
    `"Ese link ya no sirve..."` para token inexistente, vencido o ya usado —
    `buscarVigente` (`tokens-acceso.service.ts:66-76`) no distingue los tres casos.
  - `RegisterDto` no acepta `tenant_id`, `rolId` ni ningún campo de privilegio — no hay
    forma de auto-asignarse a un tenant existente ni de pedir un rol.
  - Ninguna ruta pública devuelve nombres de tenant, cantidad de usuarios ni slugs — el
    único dato de tenant que sale de una ruta autenticada (`GET /auth/my-tenants`) está
    detrás de `JwtAuthGuard`.

---

### H1. `POST /auth/register` es un oráculo de enumeración de cuentas (correo ya registrado vs. no)

- **Severidad:** media
- **Ubicación:** `backend/src/modules/auth/auth.service.ts:60-61`
- **Qué está mal:** `register()` hace `findByEmail` y si existe tira
  `ConflictException('El correo ya esta registrado')` (`409`). Si no existe, crea la
  cuenta y responde `201` con `access_token` + `user`. La respuesta (status **y** cuerpo)
  difiere de forma directa según si el correo ya tiene cuenta.
- **Escenario:** un atacante sin ningún token hace `POST /api/auth/register` con
  `{correo: "gerente@empresa-objetivo.cl", contrasena: "x", nombre: "x"}`. Si la empresa ya
  usa el sistema, recibe `409 "El correo ya esta registrado"`; si no, `201`. Repitiendo con
  una lista de correos (`gerente@`, `admin@`, `ventas@...`) el atacante arma la lista de
  quién tiene cuenta en el SaaS sin autenticarse — el mismo patrón que `recuperar` (líneas
  91-98 y 141-160 de `auth.service.ts`) fue **escrito explícitamente** para evitar,
  documentado con el comentario `⚠️ Responde lo mismo exista o no el correo... este
  endpoint... sería un oráculo`. Ese cuidado no se replicó en `register`.
- **Por qué ningún test lo caza:** el test esperable es "registrar dos veces el mismo
  correo distingue de un correo nunca visto, y eso no debería ser observable desde afuera
  sin autenticarse". Los específicos que sí existen (`auth.e2e-spec.ts`, si los hay) prueban
  que el segundo registro falla con `409`, no que ESO sea un problema — el 409 es el
  comportamiento intencional que quería el feature, la enumeración es el efecto colateral
  no evaluado.
- **Confianza:** alta. Verificado abriendo `auth.service.ts` y `auth.controller.ts:56-64`;
  no hay rate limiting que lo mitigue (ya conocido y fuera de esta lista) ni ningún paso
  intermedio (captcha, verificación) entre el request y la respuesta distinguible.
- Variante de lo ya conocido: **no** es el punto 5 ("register no verifica el correo") — ese
  ítem es sobre que cualquiera puede reclamar un correo ajeno; este es sobre que el
  endpoint revela, sin necesidad de reclamar nada, si ese correo ya tiene cuenta.

### H2. El alta de usuario del tenant reutiliza en silencio una cuenta pre-registrada por un desconocido, sin avisar a nadie

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/tenants/tenants.service.ts:490-522` (rama
  `usuarioPrevio`) y `:597` (`invitado: invitacion !== undefined`)
- **Qué está mal:** `crearUsuario` (el alta de un usuario del tenant, disparada por un
  admin vía `POST /tenants/usuarios`) busca por correo. Si ya existe un `Usuario` con ese
  correo (`usuarioPrevio`, línea 490-494), **reutiliza esa cuenta tal cual está** —contraseña
  incluida— y solo agrega la membresía y los roles. No dispara ningún mail ni token: la
  variable `invitacion` queda `undefined` en esa rama, así que `invitado: false` en la
  respuesta y el `if (invitacion)` de la línea 588 nunca manda el mail. El propio docblock
  del método (líneas 448-452) asume que "si el correo ya existía, la cuenta es de esa
  persona" — asunción que rompe el punto 5 de lo ya conocido (`register` no verifica
  correo): cualquiera pudo haber creado esa cuenta con **su propia contraseña**, apuntando
  al correo de un tercero, sin que el tercero se entere.
- **Escenario:** un atacante sin ninguna cuenta ni token hace `POST /api/auth/register`
  con `correo: "ana.perez@restaurante-objetivo.cl"` (correo real de una futura empleada,
  adivinado o conocido) y una contraseña propia — `201`, cuenta creada, sin verificación de
  mail. Semanas después, el admin de `restaurante-objetivo` (que nunca supo de este ataque)
  invita normalmente a `ana.perez@restaurante-objetivo.cl` con `POST /tenants/usuarios`
  eligiendo sus roles reales (p. ej. `Cajero`). El backend entra en la rama `usuarioPrevio`:
  suma la membresía y los roles a la cuenta que **el atacante controla**, no manda mail,
  responde `invitado: false`. El atacante hace `POST /auth/login` con el correo de Ana y
  **su propia contraseña**, y entra al tenant con los roles que el admin le asignó a Ana —
  acceso real a ventas, caja, etc. de ese tenant, sin que nadie lo haya autorizado a él.
  Ana solo recupera la cuenta si algún día usa `recuperar` (lo que sí mata sesiones y
  contraseña vieja), pero nada en el flujo se lo sugiere: no le llegó ningún mail de
  invitación que la alertara.
- **Por qué ningún test lo caza:** el test que existe (si existe) prueba que invitar un
  correo ya-miembro tira `409` y que invitar un correo nuevo crea cuenta + manda mail. El
  caso "correo existe pero **no** es miembro de este tenant, y esa cuenta la creó un
  tercero no verificado" no está cubierto — requiere dos actores (registro público +
  invitación de admin) que ningún e2e de `tenants` cruza hoy.
- **Confianza:** alta — la ruta de código, la condición exacta (`invitacion !==
  undefined`) y la ausencia de mail están verificadas leyendo el archivo completo. Lo que
  bajaría la confianza a "sería teórico" sería que `register` verificara el correo antes de
  crear la cuenta — pero eso es justamente el punto 5 ya conocido y confirmado no
  implementado.
- No es el punto 3 (`addMember` no da de baja roles viejos — trata de re-agregar a alguien
  YA conocido del tenant) ni el punto 4 (correo soft-borrado, 500 — este camino ni pasa por
  ahí, la cuenta está activa). Es una consecuencia no explorada del punto 5, encadenada con
  el alta del tenant.

### H3. El login con Google entrega el `access_token` por query string en la URL del redirect

- **Severidad:** alta (la rúbrica del brief clasifica como alta cualquier filtración de
  credencial; ver matiz de confianza)
- **Ubicación:** `backend/src/modules/auth/auth.controller.ts:135-143`
  (`googleCallback` → `res.redirect(`${frontendUrl}/auth/callback?token=${access_token}`)`)
  y `frontend/app/pages/auth/callback.vue:1-14` (lee `route.query.token` recién en
  `onMounted`, sin `history.replaceState` antes de eso).
- **Qué está mal:** a diferencia de `login`/`register`/`refresh` (que ponen el
  `refresh_token` en cookie `httpOnly`) y de que el propio `access_token` normalmente solo
  vive en memoria del store, el flujo de Google lo manda en la **URL** del redirect del
  navegador. Un `access_token` en URL queda en: el historial del navegador, cualquier log
  de acceso del servidor/CDN que sirva el frontend, y el header `Referer` de cualquier
  request de terceros que la página `/auth/callback` dispare antes de terminar su
  `onMounted` (fuentes, analytics, etc. si los hubiera).
- **Escenario:** un usuario inicia sesión con Google. El navegador aterriza en
  `https://frontend/auth/callback?token=eyJhbGci...`. Ese token queda en el historial local
  del dispositivo (recuperable por cualquiera con acceso físico/forense al navegador, o por
  una extensión de Chrome maliciosa que lea `chrome.history`) y en cualquier log de acceso
  que el hosting del frontend conserve — nada de esto pasa con el login por contraseña, que
  nunca pone el `access_token` en una URL.
- **Por qué ningún test lo caza:** ni el e2e de backend ni el de frontend verifican qué
  transporta la URL del redirect de Google — el e2e de Google típicamente mockea el
  provider y verifica que la sesión quede iniciada, no dónde viajó el token en el camino.
- **Confianza:** media — el vector real depende de que alguien tenga acceso al historial
  del navegador o a logs del hosting del frontend; no es explotable de forma remota pura
  como H1/H2. Subiría a alta si se confirma que el hosting de producción (Railway) loguea
  la query string completa de los requests.

---

**Nota de alcance:** revisé los 43 controllers completos para el censo, pero el resto del
análisis profundo (RBAC dentro del tenant, `PermisosGuard`, roles) es explícitamente otra
lente — no la crucé a propósito, salvo donde la propia superficie pública la atraviesa
(H2, que empieza en `POST /auth/register` sin token y termina con acceso real al tenant).
