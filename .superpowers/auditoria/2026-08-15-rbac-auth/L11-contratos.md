## Lente: Contratos back↔front y guards del cliente
## Veredicto: 2 hallazgos

### Qué revisé para poder afirmarlo

- **Backend, controladores leídos completos**: `auth.controller.ts` (12 rutas),
  `rbac.controller.ts` (2), `roles.controller.ts` (9), `tenants.controller.ts`
  (`AdminTenantsController` 5 + `TenantsController` 14) — 42 rutas en total, una por
  una, mirando qué guard de clase/método lleva cada una.
- **Los cuatro guards del backend** leídos completos: `tenant.guard.ts`,
  `permisos.guard.ts`, `tenant-admin.guard.ts`, `superadmin.guard.ts`.
- **9 DTOs** cruzados campo a campo contra el body exacto que manda cada pantalla:
  `create-rol`, `update-rol`, `assign-user`, `add-member`, `crear-usuario-tenant`,
  `marcar-totem`, `register`, `elegir-contrasena`, `update-perfil`.
- **Frontend**: los tres middleware (`auth.ts`, `admin.ts`, `permiso.ts`) completos;
  `usePermisosCrud.ts`; `login.vue`, `admin.vue`, `configuracion.vue`,
  `configuracion/roles/index.vue`, `configuracion/roles/[id].vue`,
  `configuracion/usuarios/index.vue`, `invitacion/[token].vue`; `layouts/dashboard.vue`;
  `AppNavbar.vue`; `stores/auth.ts`, `stores/permissions.ts`; `useApiFetch.ts`.
- **Enrutamiento**: confirmé que no hay middleware `.global.ts`, ni `router.beforeEach`,
  ni plugin que envuelva rutas (`grep` en `plugins/` y `app.vue`) — todo el gateo de
  cliente depende de que cada página declare su `middleware` en `definePageMeta`.
- **whitelist/DTO**: confirmé `ValidationPipe({ whitelist: true, transform: true })`
  en `main.ts:18` (sin `forbidNonWhitelisted`, como avisa el brief) y grepeé
  `@Body() body: {` en los seis módulos del alcance — un solo resultado, ver H2.
- **JWT claims**: crucé `jwt.strategy.ts`, `jwt-user.interface.ts` y
  `generateAccessToken` (`auth.service.ts`) contra `stores/auth.ts` (`decodeJwt` +
  `es_superadmin`/`tenant_id`) — nombres de claim consistentes en los dos lados.
- **401 vs 403**: `useApiFetch.ts:22-23` — el único status que dispara refresh+logout
  es 401; cualquier otro (403 incluido) se re-lanza sin tocar el store. Revisé
  también si algún otro punto del front reinterpreta el código y no encontré ninguno.
  **Limpio, no lo reporto** como hallazgo pese a que el brief pedía mirarlo.

### H1. `/admin` no tiene NINGÚN guard de cliente — el chequeo de superadmin documentado nunca corre

- **Severidad:** media
- **Ubicación:** `frontend/app/pages/admin.vue:1-3` (abrí el archivo: sí)
  ```ts
  <script setup lang="ts">
  definePageMeta({ layout: 'dashboard' })
  </script>
  ```
  Comparar con el resto de rutas protegidas del proyecto, que sí declaran
  `middleware: 'auth'` (o `['auth', 'admin']` / `['auth', 'permiso']`) — ver
  `frontend/app/pages/index.vue:3`, `configuracion.vue:4`, etc. `admin.vue` es la
  única página del árbol de rutas con `layout: 'dashboard'` y **cero** `middleware`.
- **Qué está mal:** `middleware/auth.ts:28-31` tiene el chequeo explícito para esta
  ruta:
  ```ts
  // Rutas admin: guard propio. Verificar isSuperadmin.
  if (to.path.startsWith('/admin')) {
    if (!isSuperadmin.value) return navigateTo('/')
    return
  }
  ```
  Pero ese bloque solo se ejecuta si el middleware `auth` corre en la navegación, y
  `auth` no es global (no hay `auth.global.ts`, ni `router.beforeEach`, ni plugin
  — verificado en `plugins/` y `app.vue:1-15`). Cada página tiene que declarar
  `middleware: 'auth'` a mano, y `admin.vue` no lo hace. El resultado: cualquier
  visitante, **sin token**, que navegue a `/admin` monta la página completa (layout
  `dashboard` con sidebar, `AppNavbar`, `UserMenu`) en vez de ser redirigido a
  `/login`.
- **Escenario:** un visitante sin sesión (sin cookie de refresh, sin `access_token`
  en el store) escribe `https://<host>/admin` en la barra. No hay `/admin/` en
  `pages/` — es la única hoja, sin padre que aporte `middleware: 'auth'` (a
  diferencia de `configuracion/roles` y `configuracion/usuarios`, que sí heredan
  `auth` de `pages/configuracion.vue:4` porque son rutas anidadas bajo ese padre).
  La pantalla actual solo muestra un placeholder ("Panel de administración —
  próximamente disponible"), así que hoy no hay dato sensible que se filtre; pero el
  layout dispara en `onMounted` (`layouts/dashboard.vue:12-21`) `fetchPermisos()` y
  `ensureLoaded()` de monedas sin token válido — llamadas que el backend rechaza,
  pero que un visitante anónimo puede disparar igual, y la superficie queda abierta
  para cuando se implemente contenido real de superadmin ahí (hoy es el único punto
  de entrada a `/admin/*`).
- **Por qué ningún test lo caza:** `middleware/auth.spec.ts` y `admin.spec.ts` testean
  la función de middleware **en aislamiento** (dado un `to`, qué hace) — nunca
  verifican que la página `/admin` realmente la tenga enganchada. No hay ningún e2e
  de navegador que visite `/admin` sin sesión (grepeé `/admin` en specs y no aparece
  ese caso). El bug no está en la lógica del guard —que es correcta— sino en el
  cableado: falta el `definePageMeta({ middleware: 'auth' })` en el archivo de la
  página, y eso ningún test unitario del middleware puede detectarlo.
- **Confianza:** alta — verificado abriendo `admin.vue`, `auth.ts`, `nuxt.config.ts`,
  `app.vue` y confirmando ausencia de middleware global. Lo que le faltaría a la
  confianza es un smoke test real en navegador incógnito contra `/admin`, que no
  corrí (auditoría estática, sin stack levantado en esta pasada).

### H2. `PUT /roles/:id/modules/:moduloTenantId/permissions` no valida el body — es el único endpoint del alcance sin DTO de clase

- **Severidad:** media
- **Ubicación:** `backend/src/modules/roles/roles.controller.ts:97-112`
  ```ts
  @Put(':id/modules/:moduloTenantId/permissions')
  @UseGuards(TenantAdminGuard)
  setPermissions(
    @Param('id') id: string,
    @Param('moduloTenantId') moduloTenantId: string,
    @Req() req: Request,
    @Body() body: { moduloAppPermisoIds: string[] },
  ) {
  ```
- **Qué está mal:** todos los demás endpoints de escritura del alcance
  (`create-rol.dto.ts`, `update-rol.dto.ts`, `assign-user.dto.ts`,
  `add-member.dto.ts`, `crear-usuario-tenant.dto.ts`, `marcar-totem.dto.ts`, etc.)
  tipan el `@Body()` con una **clase** decorada con `class-validator`, que es lo que
  `ValidationPipe({ whitelist: true, transform: true })` necesita para actuar. Este
  endpoint tipa el body con una interfaz TS **inline** (`{ moduloAppPermisoIds:
  string[] }`), que en runtime no existe — el `metatype` que Nest refleja para un
  literal de objeto es `Object`, y `ValidationPipe.toValidate()` excluye `Object` de
  la lista de tipos a validar. El resultado: **el pipe no corre en absoluto** para
  este body — ni whitelist, ni type-check, ni chequeo de que
  `moduloAppPermisoIds` sea siquiera un array. No es la variante "el campo se
  descarta en silencio con 200" que ya está anotada en el brief — acá es al revés:
  **nada se descarta porque nada se valida**, cualquier shape pasa.
- **Escenario:** un admin de tenant (autenticado, `TenantAdminGuard` pasa) manda
  `PUT /roles/:id/modules/:moduloTenantId/permissions` con `body: {}` (sin el campo,
  típicamente por un bug de cliente o un curl manual). `RolesService.setPermissions`
  (`roles.service.ts:127-165`) hace `moduloAppPermisoIds.length > 0` en la línea 147
  sobre un `undefined` → `TypeError` no capturado → 500 en vez de un 400 legible.
  Con un shape distinto (string en vez de array, o un array con valores que no son
  UUIDs de `modulo_app_permisos`), el `.map()` de la 153 puede fallar del mismo modo,
  o peor: si el valor es un objeto/array vacío disfrazado, el `else` de la 161-163
  ejecuta `moduloRolRepo.softDelete({ rolId, moduloTenantId })` — desvincula el rol
  del módulo sin que el body lo haya pedido de forma inequívoca. No cruza el borde
  del tenant (el servicio sigue verificando que `rolId`/`moduloTenantId` pertenezcan
  al tenant del token) y no escala permisos — es el propio admin rompiendo su propia
  configuración con una request malformada, no un tercero atacando.
- **Por qué ningún test lo caza:** no hay ningún test — unit ni e2e — que ejercite
  este endpoint en absoluto (grepeé `setPermissions` y `modules/.*permissions` en
  `backend/src` y `backend/test`, cero resultados fuera del controller/service
  mismos). Si existiera un DTO de clase, el ratchet de tests de DTOs del proyecto
  típicamente cubre el caso "body vacío → 400"; acá ni siquiera hay DTO que testear.
- **Confianza:** alta en el diagnóstico (el comportamiento de `ValidationPipe` con
  tipos inline es documentado y consistente con que ningún otro endpoint del alcance
  use este patrón). Media en el impacto real: no lo reproduje contra un servidor
  corriendo en esta pasada (auditoría estática), así que el 500 exacto es inferencia
  de código, no una respuesta HTTP observada.

### Notas — cosas que miré y salieron limpias (no las cuento como hallazgo)

- **401 vs 403** en `useApiFetch.ts`: distinción correcta, ver arriba.
- **`RbacService.userHasPermiso` / `TenantAdminGuard`**: la escritura de permisos de
  un rol `es_fijo` (`setPermissions` sin chequear `esFijo`, a diferencia de `update`
  y `remove` que sí lo hacen en `roles.service.ts:59-60` y `68-69`) es un hueco real
  en el service, pero **sin efecto observable**: el short-circuit de
  `RbacService.userHasPermiso` (`rbac.service.ts:20-30`) ignora por completo las
  filas de `roles_permisos_modulos` para roles fijos. Lo descarté como hallazgo por
  ser puramente teórico — no hay escenario donde cambie el comportamiento del
  sistema.
- **Caso inverso** (front ofrece algo que el back bloquea): `permissions.ts:60-64`,
  `can()` devuelve `true` para cualquier módulo/permiso si `auth.isSuperadmin`, pero
  `RbacService.userHasPermiso` no tiene ningún bypass equivalente para
  `es_superadmin` — un superadmin que además fuera miembro no-admin de un tenant
  vería botones que el backend le rechaza con 403. No lo reporto como hallazgo:
  requiere una combinación de estado (superadmin + miembro raso de un tenant) que no
  confirmé que sea alcanzable hoy por ningún flujo del producto, y el brief pide no
  reportar riesgos teóricos.
- Todas las rutas de escritura de `roles` y `tenants/members*` (alta, roles,
  tótem, baja) llevan `TenantAdminGuard` tanto del lado del guard como del
  middleware de cliente (`admin.ts`) — sin discrepancia entre lo que el menú
  esconde y lo que el backend bloquea.
- `configuracion/roles/index.vue` y `configuracion/usuarios/index.vue` declaran
  `middleware: 'admin'` **solo**, pero heredan `middleware: 'auth'` de su padre
  `pages/configuracion.vue:4` por ser rutas anidadas (`<NuxtPage />` en la 187) —
  confirmé que Nuxt corre el middleware de todos los route records matcheados,
  padre primero. No es el mismo bug que H1: ahí sí hay guard efectivo.
