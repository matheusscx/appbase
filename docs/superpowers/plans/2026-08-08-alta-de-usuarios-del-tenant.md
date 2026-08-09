# Plan: alta de usuarios del tenant por el admin

**Status**: **Hecho** (2026-08-08) — con una verificación pendiente, ver Verification
**Date**: 2026-08-08
**Owner**: Cesar Matheus

---

## Context

Hoy **el admin de un tenant no puede crear usuarios**. Medido:

- `POST /tenants/members` (`tenants.controller.ts:103`) recibe un **`usuarioId` que ya
  existe** y solo inserta la fila en `usuarios_tenants`. Es idempotente y revive el soft
  delete, pero no crea nada.
- La pantalla de usuarios (`configuracion/usuarios/index.vue`) lista miembros y asigna
  roles. **No tiene alta.**
- El único camino a una cuenta es `POST /auth/register`: **público, de auto-registro**, y
  devuelve tokens. No asocia a ningún tenant.
- **No hay envío de mails** — ni nodemailer, ni SMTP, nada. Un flujo de invitación por link
  no es "un endpoint más": es traer una dependencia y elegir proveedor.

Consecuencia práctica: sumar a alguien al tenant cuesta **4 pasos en 3 pantallas** y arranca
con que la persona se auto-registre en el registro público. Es lo que dejó **bloqueada la
Fase 2** del plan `2026-08-08-elegir-garzon-antes-del-pin.md` (el garzón con tablet propia
necesita ser usuario).

---

## Decisiones tomadas (owner, 2026-08-08)

- **Si el correo ya existe, se asocia.** No se crea una cuenta nueva ni se toca su
  contraseña. Encaja con lo que ya hay: `switchTenant` valida la pertenencia contra
  `usuarios_tenants` (`auth.service.ts:150`), así que insertar esa fila alcanza para que el
  tenant nuevo le aparezca al elegir.
- **Cuenta nueva → contraseña temporal + cambio obligatorio en el primer login.** El admin
  no queda conociendo indefinidamente una contraseña válida de otra persona, que en un
  sistema con auditoría por usuario ensucia el "quién hizo qué".
- **El rol es obligatorio en el alta.** Un usuario sin rol entra y no ve nada: crear sin rol
  es crear algo roto.
- **Confirmación de email: diferida** (decisión explícita del owner).
  ⚠️ Consecuencia asumida, para que no aparezca como sorpresa: un admin va a poder sumar
  **cualquier correo registrado** a su tenant. El daño está acotado —sumarte a mi restaurante
  no me da acceso a tus datos, te da acceso a los míos— pero **filtra si ese correo está
  registrado** (enumeración), y a la persona le aparece un tenant que no pidió. Cuando exista
  el mail, esto se reemplaza por invitación aceptada.

---

## El hallazgo que define el diseño del enforcement

Iba a proponer dos opciones malas —un claim en el JWT (⛔ invariante 4) o un guard que lee la
BD en cada request— y **las dos premisas eran falsas**:

1. **La propiedad "el auth no toca la base" ya no existe.** `JwtStrategy.validate` es
   puramente del payload, sí, pero `TenantGuard` hace **dos** queries por request
   (`tenant.guard.ts:27` y `:38`) y `PermisosGuard` una tercera. Toda request de tenant ya
   consulta 2-3 veces.
2. **Y aun así no hace falta ningún guard nuevo.** `/me` corre con **`JwtAuthGuard` solo, sin
   `TenantGuard`** (`me.controller.ts:16`), y `PATCH /me/contrasena` ya existe. O sea que el
   gate natural es **`switchTenant`**: mientras el flag esté puesto, no se emite token de
   tenant.

**Enforcement elegido:** `switchTenant` rechaza con 403 mientras `debe_cambiar_contrasena`
esté en `true`. La persona **puede** loguearse y llegar a `PATCH /me/contrasena` (no necesita
tenant), y **no puede** operar ningún tenant hasta cambiarla.

- Cero costo por request.
- Un solo lugar que decide, en vez de un guard que hay que acordarse de poner.
- **No toca el sistema de tokens** (invariante 4 intacta): el payload no cambia.
- Un token de tenant emitido **antes** de poner el flag sigue vivo hasta 15 min. Irrelevante
  para el caso real: una cuenta recién creada nunca tuvo uno.

---

## Scope

- `usuarios.debe_cambiar_contrasena` (boolean, default `false`).
- `POST /tenants/usuarios` — crea-o-asocia + asigna rol, en una transacción.
- `switchTenant` corta con 403 mientras el flag esté puesto.
- `PATCH /me/contrasena` baja el flag al cambiarla.
- Alta desde la pantalla de usuarios, con la contraseña temporal mostrada **una sola vez**
  (mismo patrón que el PIN del garzón).

### Out of scope

- Envío de mails, invitación por link y confirmación de email — diferidos por el owner.
- Reset de contraseña ("olvidé la mía"): es otra feature y necesita mail.
- Fase 2 del plan del garzón (vínculo `usuario_id`): esta desbloquea, no la implementa.
- Tocar el flujo de `POST /auth/register`, que sigue siendo el auto-registro público.
  ⚠️ Con una salvedad medida al cerrar: **su comportamiento sí cambió de rebote**.
  `UsersService.findByEmail` pasó a comparar el correo sin distinguir mayúsculas —era
  necesario, porque si no una cuenta creada como `Juan.Perez@x.cl` no entra tipeando
  `juan.perez@x.cl` y no hay reset— y esa búsqueda la comparten el login, el chequeo de
  duplicado del registro y el vínculo con Google. Registrarse con un correo que ya existe
  en otra caja ahora da 409 donde antes creaba una segunda cuenta. Queda fijado por test.

---

## Las tres que quedaban, cerradas

**Q1 — La contraseña temporal la GENERA el sistema** (owner, 2026-08-08) y se muestra **una
sola vez**, mismo patrón que el PIN del garzón. Evita que el admin elija una débil o repita
la misma para todos.

**Q2 — Si el correo ya existe y ya es miembro: 409 con mensaje accionable**, no idempotente.
`addMember` sí lo es, así que esto discrepa a propósito: el alta lleva **roles**, y responder
200 en silencio dejaría dos lecturas posibles —no hacer nada, o pisarle los roles que ya
tenía— y las dos son malas. El 409 manda a editarlo desde la tabla, que es donde eso se hace.
Si el correo existe pero **no** es miembro de este tenant, sí se asocia (decisión del owner).

**Q3 — Sí puede asignar el rol `admin`, y no es una capacidad nueva.** Verificado:
`POST /roles/:id/users` está bajo `TenantAdminGuard` sin filtrar rol
(`roles.controller.ts:68`), y la pantalla de usuarios ofrece todos los roles en un
`USelectMenu` sin excluir `admin`. Un admin ya puede hacer otro admin hoy; el alta solo lo
hace en un paso en vez de dos.

⚠️ **Corrección al propio plan: los roles son MÚLTIPLES, no uno.** La pantalla usa
`USelectMenu multiple` y cada miembro trae `roles: []`. El body del alta lleva `rolIds`, y la
validación es "al menos uno", no "exactamente uno".

---

## Backend

- [x] Columna `debe_cambiar_contrasena` en `usuarios` (boolean, NOT NULL, default `false`).
      Registrar el cambio en `startup-pos.sql` y en la entidad.
- [x] `POST /tenants/usuarios` bajo `TenantAdminGuard` (mismo guard que `members`, que es
      administración del tenant). Body: datos de la persona + `rolIds` (al menos uno). **Una transacción**:
      crear-o-buscar el usuario, asociar al tenant, asignar el rol.
- [x] Si el correo existe: **no** crear ni tocar su contraseña; asociar y dejarle en este
      tenant **exactamente** los roles del alta (los que no vinieron se dan de baja: el
      selector es obligatorio y lo que el admin elige ahí es el conjunto, no un agregado).
- [x] Si es nuevo: **generar** la temporal (patrón `generarPinUnico`), hashearla, poner
      `debe_cambiar_contrasena = true`, y devolverla en claro **una sola vez**.
- [x] `switchTenant`: 403 con mensaje accionable mientras el flag esté puesto.
- [x] `PATCH /me/contrasena`: baja el flag.
- [x] Seed: un usuario con el flag puesto, para que el e2e ejercite el 403 y el camino de
      cambio.

## Frontend

- [x] Alta en `configuracion/usuarios/index.vue`: nombre, correo, rol. La temporal se muestra
      **una sola vez** con aviso.
- [x] El login/selector de tenant maneja el 403 del flag: manda a cambiar la contraseña en
      vez de mostrar un error genérico.
- [x] Pantalla de cambio obligatorio, distinta del cambio voluntario del perfil: sin salida
      hasta cambiarla.

## Verification

- [x] Gate completo **por exit code** (backend lint/typecheck/test/test:e2e con `reset-db.sh`
      antes y `--verificar` después; frontend test/build/ratchet/design).
- [x] Un usuario con el flag **no puede** obtener token de tenant, y **sí** puede cambiar su
      contraseña. Es el par que define la feature.
- [x] Los tres caminos del alta, cada uno con su test: el correo **que ya es miembro** → 409
      sin tocarle los roles (también con otra caja de mayúsculas); el correo que **existe y
      no es miembro** → se asocia sin temporal y su contraseña de siempre sigue sirviendo
      (fixture: el otro tenant sembrado, con `admin@sistema.com` de admin); y el correo
      nuevo → cuenta, temporal y roles.
- [x] Quien fue **eliminado del tenant** y se vuelve a dar de alta queda asociado de verdad
      (no solo un 201) y con **exactamente** los roles del alta. `removeMember` da de baja la
      membresía pero deja vivas las filas de `roles_usuarios`: sin dar de baja las que no
      vinieron, el re-alta le restituía en silencio sus permisos viejos, `Administrador`
      incluido.
- [x] Un alta tipeada en mayúsculas entra escribiendo el correo en minúsculas. Es la mitad
      cara del mismo problema: la temporal se muestra una sola vez y no hay reset, así que
      guardar el correo tal cual se tipeó dejaba una cuenta imposible de usar.
- [x] Alta con `rolIds` vacío → 400, no un usuario huérfano.
- [ ] ⚠️ **NO verificado por ningún test.** La transacción **sí** funciona —comprobado a mano
      rompiendo el `INSERT` de roles: 500, y 0 usuarios / 0 membresías— pero **nada la
      protege de una regresión**: la revisión midió que reemplazar
      `dataSource.transaction(...)` por `dataSource.manager` deja los tests en verde. El
      test "sin roles → 400" no sirve para esto: lo corta el `ValidationPipe` antes de que
      el service arranque. Para cubrirlo hay que forzar un fallo **después** de crear el
      usuario, que desde la API no es trivial. Queda anotado, no marcado.
- [x] `tenant_id` del token en todo el camino; el `usuarioId` nunca de query/params.
- [x] Revisión independiente (`domain-reviewer`).

## Docs a actualizar en el mismo commit

- [x] `docs/features/` — la feature de usuarios/roles (o una nueva si no existe).
- [x] `docs/ESTADO.md` — funcionalidad nueva.
- [x] `docs/agent/pendientes.md` — desbloquea la Fase 2 del plan del garzón; anotar la
      confirmación de email diferida como entrada propia, con su consecuencia.
