# L05 — el 401 intermitente del e2e completo

## H1. Causa mejor sostenida: el helper `login()` de cada spec no verifica el `status` de
`/auth/login` ni de `/auth/switch-tenant`, así que un 500/401 transitorio en cualquiera de
esos dos endpoints se guarda en silencio como `access_token: undefined` y reaparece minutos
después como un 401 en una ruta sin relación

**Esto es mitad medición, mitad inferencia — lo digo explícito en cada paso.**

### La cadena, con lo que es medición y lo que es inferencia

1. **[MEDIDO]** `JwtAuthGuard` (`backend/src/modules/auth/guards/jwt-auth.guard.ts:5`) es
   `AuthGuard('jwt')` sin overrides. `JwtStrategy.validate()`
   (`backend/src/modules/auth/strategies/jwt.strategy.ts:15-27`) es **puro**: no toca la
   base de datos, solo arma `{id, email, tenantId, esSuperadmin}` desde el payload que
   `passport-jwt` ya validó. Los cuatro guards del alcance que sí tocan la base
   (`tenant.guard.ts:22-45`, `permisos.guard.ts:19-39`, `tenant-admin.guard.ts:19-35`,
   `rbac.service.ts` completo) **no tienen ningún `try/catch`**, y no hay ningún
   `ExceptionFilter` global (`backend/src/main.ts` completo, sin `useGlobalFilters`; grep
   de `ExceptionFilter`/`APP_FILTER` en todo `backend/src` sin resultados). Un error de
   base de datos en esos cuatro guards se propaga sin atrapar → Nest lo traduce a **500**,
   no a 401.
   → **Esto refuta, tal como está escrito, la hipótesis del brief "el guard traduce
   cualquier error a no-autorizado"**: no hay ningún punto en el camino de
   `TenantGuard`/`PermisosGuard`/`TenantAdminGuard`/`RbacService` que pueda convertir un
   agotamiento de pool en un 401. El único emisor de 401 en esas tres rutas es
   `JwtAuthGuard`, y ese guard no consulta la base.

2. **[MEDIDO]** 23 de los 32 archivos `*.e2e-spec.ts` definen su propio helper
   `login()`/`loginSuelto()` (grep: `^async function login`). **Ninguno de los 23**
   verifica `resLogin.status` ni `resTenant.status` antes de leer `.body.access_token`
   (grep de `.status` dentro del cuerpo de cada función: cero coincidencias en los 23).
   Patrón idéntico en todos, ejemplo de `backend/test/recetas.e2e-spec.ts:33-43`:
   ```ts
   async function login(app: INestApplication<App>): Promise<string> {
     const resLogin = await request(app.getHttpServer())
       .post('/api/auth/login')
       .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
     const initialToken = (resLogin.body as TokenResponse).access_token;
     const resTenant = await request(app.getHttpServer())
       .post('/api/auth/switch-tenant')
       .set('Authorization', `Bearer ${initialToken}`)
       .send({ tenantId: PARIS_TENANT_ID });
     return (resTenant.body as TokenResponse).access_token;
   }
   ```
   Si `/auth/login` o `/auth/switch-tenant` responde con cualquier status que no sea 200
   (un 500 de la base, por ejemplo), `access_token` es `undefined` **sin que nada lo
   note**, y ese `undefined` se guarda en la variable `token` del `describe` para el resto
   del bloque.

3. **[MEDIDO]** `AuthService.login` (invocado por `POST /auth/login`) y
   `AuthService.switchTenant` (`backend/src/modules/auth/auth.service.ts:268-286`) hacen
   trabajo de base de datos real en el camino feliz: `login` escribe un `refresh_token`
   (`createRefreshToken`, INSERT); `switchTenant` hace **cuatro** operaciones —
   `SELECT` de membresía, `findById` del usuario, `DELETE` de refresh tokens viejos,
   `INSERT` del nuevo — antes de devolver el token. Ninguna de las dos tiene manejo
   especial de errores: si cualquiera de esas queries falla (por ejemplo, un error real de
   Postgres bajo presión de conexiones), la excepción sube sin atrapar y Nest la traduce a
   500. `login()`/`switchTenant()` corren **una vez por cada `beforeAll` de cada
   `describe`** — o sea decenas de veces por corrida completa de la suite (68 `beforeAll`
   contados con grep en `backend/test/*.e2e-spec.ts`), cada una una oportunidad distinta
   para el mismo fallo transitorio.

4. **[INFERENCIA, pero directa]** Con `token = undefined`, cada request siguiente del
   `describe` manda `Authorization: Bearer undefined`. `ExtractJwt.fromAuthHeaderAsBearerToken()`
   extrae el string literal `"undefined"`, `jwt.verify("undefined", secret)` tira
   `JsonWebTokenError` (malformado, no expirado), y el `handleRequest` default de
   `@nestjs/passport` (`err || new UnauthorizedException()`) devuelve **401** — en
   cualquier ruta que sea la siguiente en pedirse, no en la que originó el problema. Esto
   coincide exactamente con el patrón de los cuatro avistajes: un solo test por corrida,
   siempre una ruta distinta (la que resultó ser "la siguiente" en ese `describe`), nunca
   reproduce en la corrida siguiente (el hipo transitorio de base ya pasó), y **nunca
   apunta al verdadero punto de falla** (`/auth/login` o `/auth/switch-tenant`) porque ahí
   nadie mira el status.

5. **[MEDIDO — conecta directo con el primer avistaje]** El síntoma de `caja.e2e-spec.ts`
   (`resMiembros.body.find is not a function`) viene de `liberarCajeroSiQuedoOcupado`
   (`backend/test/caja.e2e-spec.ts:159-186`), que llama `GET /tenants/members` con
   `tokenAdmin` — el mismo `token` que arma el `login()` sin chequeo del `describe`
   "aislamiento cajero" (línea 253). La corrección del 2026-08-11 (línea 242-243, ahora
   afirma `resMiembros.status` y `Array.isArray`) **arregla el síntoma en ESE call site
   puntual**, no la causa: el `login()` de ese mismo archivo (línea 68-…) sigue sin
   verificar su propio status, y los otros 22 archivos con el mismo helper tampoco.

### Qué NO sostiene esta medición (hipótesis descartadas o debilitadas)

- **Expiración del access token a mitad de suite — DEBILITADA.**
  `JWT_EXPIRATION=15m` (`.env:` y `.github/workflows/ci.yml:50,156`, con default `?? '15m'`
  en `auth.module.ts:26` si faltara). La corrida local completa mide **55 s** (31 suites,
  428 tests, dato dado). Además cada `describe` saca su **propio** token en su propio
  `beforeAll` — no hay un solo `login()` al principio del archivo reusado por 1.110 líneas:
  en `recuentos.e2e-spec.ts` hay **5** `describe`s de nivel superior y **5** llamadas a
  `login(app)` independientes (líneas 123, 216, 509, 810, y una inline en 1020). Ningún
  bloque individual tiene evidencia de acercarse a 15 minutos. 15 minutos es ~16× la
  duración de la suite entera corriendo local. **Queda abierto**: no medí la duración de la
  suite en CI (se me pidió explícitamente no correrla ni leer logs de `gh`) — si CI fuera
  >16× más lento que local, esta hipótesis reviviría. Es la única medición que falta para
  cerrarla del todo.

- **Pool de conexiones agotado, traducido a 401 por el guard — REFUTADA tal como está
  escrita en el brief**, ver punto 1 arriba: ningún guard del camino atrapa errores de
  base y no hay filtro global; un fallo de base ahí da 500, no 401.

- **El deadlock ya documentado de "10 ventas simultáneas cuelgan para siempre"**
  (`docs/agent/pendientes.md`, sección 🔴) **no es la misma familia de síntoma**: ese bug
  *cuelga* la request (nunca vuelve), no devuelve 401. Además requiere ≥10 transacciones
  **concurrentes** tomando una segunda conexión sin `manager` — el e2e corre con
  `maxWorkers: 1` y ninguno de los tres specs afectados (`caja`, `ventas`, `recetas`) usa
  `Promise.all` (grep: los 4 archivos que sí lo usan son otros —
  `garzones-selector`, `garzon-modo-personal`, `items-pausados`, `invitacion-y-reset` —
  ninguno de los tres avistados). Sí es plausible que la **misma familia** de fragilidad de
  conexiones (medida y documentada en ese mismo archivo) explique por qué `login()` o
  `switchTenant()` fallan transitoriamente de vez en cuando bajo 31 ciclos de vida de app
  sucesivos — pero esa conexión causal específica **no la medí**, es la inferencia del
  punto 3-4 arriba, no un hecho verificado con `pg_stat_activity` durante una corrida real.

### La única medición que falta para cerrar esto del todo

Correr la suite completa **una vez**, con un log temporal en `login()`/`switchTenant()` de
los 23 archivos (o mejor: centralizar el helper y loguear ahí) que imprima el `status` de
`/auth/login` y `/auth/switch-tenant` en cada llamada, hasta que la corrida vuelva a
fallar. Si aparece un `500` (o cualquier no-200) justo antes del 401 reportado en el test
siguiente, la cadena queda demostrada end-to-end. Explícitamente **no la corrí** — la
consigna pidió mediciones baratas solamente y no correr el e2e completo.

### Corrección de alcance, no de rutina

El arreglo evidente — que `login()`/`switchTenant()` en los 23 archivos verifiquen
`status === 200` y lancen un error legible si no, igual que ya se hizo para
`/tenants/members` — **no toca el sistema de JWT** (no cambia expiración, algoritmo,
claims ni el guard). Es higiene de test, misma clase que la ya aplicada. No lleva
`⛔ TOCA JWT`.

- **Severidad:** alta para la confiabilidad de CI (cualquier corrida puede fallar sin
  regresión real — exactamente lo que ya señaló el cuarto avistaje), no es un hallazgo de
  seguridad de producción: no cruza tenants ni filtra credenciales.
- **Confianza:** media-alta en la cadena causal completa (pasos 1-2-3 son medición directa,
  el paso 4 es la única inferencia, pero es mecánica y no hay otra ruta de 401 en esas tres
  rutas salvo `JwtAuthGuard`). Lo que falta para subirla a alta es la corrida instrumentada
  del punto anterior.

---

## Nota de método — por qué este reporte no sigue el formato exacto del brief

El brief de esta pasada (`.superpowers/auditoria/2026-08-15-rbac-auth/BRIEF.md`) trae el
formato estándar de "buscador de una sola lente" (Hn por hallazgo, tope 6, severidad
alta/media/baja de aislamiento tenant). **La consigna específica de esta tarea lo
reemplaza explícitamente**: "tu H1 debe ser la causa (o la hipótesis mejor sostenida)". Por
eso este documento tiene un único H1 (la causa) en vez de una lista de hallazgos
independientes — es la instrucción de la tarea, no una desviación del brief.

## Qué revisé para poder afirmarlo

- `docs/agent/pendientes.md:452-524` — la entrada completa de los cuatro avistajes, íntegra.
- `backend/src/modules/auth/auth.module.ts`, `.env`, `.env.example`,
  `.github/workflows/ci.yml` (líneas 42-52 y 149-159) — `JWT_EXPIRATION` en las tres
  fuentes, las tres en `15m`.
- `backend/src/modules/auth/strategies/jwt.strategy.ts`,
  `backend/src/modules/auth/guards/jwt-auth.guard.ts`,
  `backend/src/common/guards/{tenant,permisos,tenant-admin,superadmin}.guard.ts`,
  `backend/src/modules/rbac/rbac.service.ts` — los cuatro guards del alcance más
  `RbacService` completo, línea por línea, buscando `try/catch` y llamadas a base.
- `backend/src/main.ts` completo — sin `ExceptionFilter` global; grep de
  `ExceptionFilter|useGlobalFilters|APP_FILTER` en `backend/src` sin resultados.
- `backend/src/modules/auth/auth.service.ts` completo (330 líneas) — `login`,
  `switchTenant`, `generateTokens`, `createRefreshToken`.
- Los 32 `backend/test/*.e2e-spec.ts`: grep de `^async function login` (23 coincidencias)
  y verificación de que ninguna de las 23 comprueba `.status`; lectura completa de
  `recetas.e2e-spec.ts` (líneas 1-186) y de las secciones relevantes de `caja.e2e-spec.ts`
  (líneas 145-343, 1411-2108) y `ventas.e2e-spec.ts` (líneas 1-170); conteo de `describe`s
  y `beforeAll`s en `recuentos.e2e-spec.ts` (5 y 5) para descartar el token único de
  archivo largo; grep de `Promise.all` en los 32 archivos (4 coincidencias, ninguna en los
  3 specs avistados).
- `backend/test/jest-e2e.json`, `backend/test/setup-env.ts` — `maxWorkers: 1`, y que el
  `.env` de raíz se carga vía `dotenv` (no la sustitución de `docker-compose.yml`, que
  tiene un default `7d` que no aplica al e2e).
- `docs/agent/pendientes.md` — la entrada del deadlock de 10 ventas simultáneas (líneas
  60-170), para descartarla como mecanismo directo (cuelga, no devuelve 401; necesita
  concurrencia real que la suite no produce).
