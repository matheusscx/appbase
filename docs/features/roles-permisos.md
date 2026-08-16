# Feature: Configuración de Roles y Permisos

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-08-09 (invitación por link y reset de contraseña)

---

## Overview

### What is it?

Módulo de administración RBAC dentro de **Configuración**. Permite al administrador
del tenant: crear/editar/eliminar roles personalizados, configurar la matriz de
permisos (módulo → Leer/Crear/Actualizar/Eliminar) de cada rol, y asignar uno o más
roles a los usuarios del tenant.

### Why does it exist?

El motor RBAC (guards, chequeo de permisos, tablas) ya existía, pero no había interfaz
para administrarlo. Esta feature expone esa administración y corrige un bug que impedía
que los permisos de roles personalizados surtieran efecto.

### Scope

- Incluido: pantallas Roles (lista + editor con matriz) y Usuarios (asignación de
  roles), endpoints de soporte, guard de administrador, decisión multi-rol.
- NO incluido: invitar/crear usuarios nuevos en el tenant, contratar/desactivar módulos
  (superadmin, `/admin/*`), evaluación de condiciones de descuentos/recargos.

### Modelo: multi-rol por usuario

Un usuario puede tener **varios roles** por tenant. Los permisos son la **unión** de
todos sus roles. Permite roles granulares y componibles (ej. "MiCaja" + "Reportes") en
vez de obligar a crear un rol a medida por usuario. El backend ya unía permisos de
todos los roles (`RbacService.getMisPermisos` / `userHasPermiso`).

### Nota: módulo `Caja` renombrado a `MiCaja` + módulo nuevo `Cajas` (2026-07-23)

El módulo de permiso `Caja` se renombró a **`MiCaja`** (operar el propio turno; acciones
`Leer`/`Crear`/`Actualizar`/`Eliminar`, mismo id de siempre) y se creó un módulo nuevo
**`Cajas`** (supervisar todas). Nació con solo `Leer` y se extendió a
`Crear`/`Actualizar`/`Eliminar` el 2026-07-23 para el **CRUD de cajones**. Desde el
**2026-08-13**, `Cajas:Actualizar` habilita además **forzar el cierre de una caja ajena y
pedir la firma de un testigo**: la misma acción que administra cajones pasó a operar sobre
la plata de otro. Es un ensanche deliberado (el owner prefirió reusar el permiso a crear uno
nuevo) y está anotado como **permiso grueso** en
[`pendientes.md`](../agent/pendientes.md) — tenerlo en cuenta al armar un rol. Ver
[`gestion-cajas.md`](gestion-cajas.md#modelo-de-acceso-por-permiso). La acción global `Ver todas` **dejó de
asociarse a caja**: ya no existe `MiCaja:Ver todas`. El diferenciador "supervisor" pasó
de ser una acción CRUD reutilizada a ser tener contratado el módulo `Cajas` — el patrón
a seguir si otro módulo necesita separar "operar lo propio" de "supervisar todo", en vez
de seguir sobrecargando `Ver todas`. Detalle funcional y de permisos:
[`docs/features/gestion-cajas.md`](./gestion-cajas.md#modelo-de-acceso-por-permiso).

### Admin-only vs permiso de módulo — cuándo cada uno

Dos mecanismos de autorización conviven, y la elección **no es por pantalla sino por la
naturaleza de la acción**:

- **`TenantAdminGuard` (solo admin/dueño, no delegable)** → **configuración y políticas**:
  catálogos que administra el dueño (monedas, impuestos, descuentos, recargos, categorías,
  métodos-pago, motivos de diferencia, roles) y **cualquier política que un rol operativo no
  debería poder cambiarse a sí mismo**. La lectura suele quedar abierta al tenant; solo la
  escritura es admin-only.
- **`@RequiresPermiso('Modulo','Accion')` (permiso de módulo, delegable)** → **operación del
  día a día**: caja (`MiCaja`/`Cajas`), ventas, pagos, inventario, etc. Un rol custom lo puede
  recibir sin ser admin.

**Los tres ejes de rol (no confundir):** el **admin/dueño** fija políticas; el **supervisor
contratado** tiene permisos de módulo (`Cajas:*`), es operativo y es un posible vector de
fraude él mismo; los **cajeros** operan lo suyo (`MiCaja:*`). Corolario anti-fraude: tener
`Cajas:Leer` **no** equivale a "confianza de dueño" — no se le revelan cifras ciegas en vivo ni
se le delegan políticas de control.

**Zona gris — acción operativa que es política de control.** Un módulo operativo puede tener
acciones que, por anti-fraude, deben reservarse al dueño aunque el resto del módulo sea
delegable. La prueba: *¿un rol operativo podría desactivar o eludir el control sobre sí mismo?*
Si la respuesta es sí, la acción es admin-only. Casos ya decididos así:

- **Configurar el arqueo ciego** (`PUT /caja/arqueo-ciego`) → admin-only, aunque Caja sea un
  módulo operativo: si un `Cajas:Actualizar` pudiera apagar el ciego, la política anti-fraude
  quedaría decorativa. El **CRUD de cajones** de la misma pantalla sigue delegable a
  `Cajas:Actualizar` — es operación, no política.
- **Justificar el descuadre** en el cierre ciego (override admin sobre una caja cerrada) →
  admin-only por el mismo motivo.

Ante una acción de esta zona gris, **decidir con el owner, no asumir** (regla del proyecto:
"detenerse y preguntar" ante una regla de negocio de control no documentada).

---

## Alta de usuarios del tenant (2026-08-08)

Hasta acá el admin **no podía crear usuarios**: `POST /tenants/members` recibía un
`usuarioId` que ya existía, y el único camino a una cuenta era `POST /auth/register`,
público y de auto-registro. Sumar a alguien costaba 4 pasos en 3 pantallas y arrancaba
con que la persona se registrara sola.

`POST /tenants/usuarios` (`TenantAdminGuard`, como el resto de la administración del
tenant) hace las tres cosas en **una transacción**: crear-o-asociar el usuario, sumarlo
al tenant y asignarle los roles.

| caso | qué pasa |
|---|---|
| El correo **no existe** | Se crea **sin contraseña**, se asocia, se le asignan los roles y le llega una **invitación por mail** para que elija la suya |
| Existe, **no es miembro** y **no tiene contraseña** (la invitaron en otro lado y nunca la eligió) | Se asocia y le quedan **exactamente** los roles del alta **en este tenant** (los que tenga en otros no se tocan). No hay a quién pedirle permiso: **nadie controla esa cuenta todavía** |
| Existe, **no es miembro** y **sí tiene contraseña** | **No se asocia nada.** Sale un mail *"te están sumando a X"* y la membresía la crea la persona al entrar al link. Ver [Confirmación](#la-confirmación-cuando-la-cuenta-ya-existe) |
| Existe **y ya es miembro** | `409`. **No es idempotente a propósito**, a diferencia de `addMember`: acá vienen roles, y un 200 en silencio tendría dos lecturas —no hice nada, o le pisé los roles que ya tenía— y la segunda le cambia los permisos a alguien sin que nadie lo pida |

**El correo se guarda normalizado** (minúsculas, sin espacios al principio ni al final) y la respuesta devuelve esa
forma canónica, que es la que el admin le dicta. La unique de Postgres **sí** distingue
mayúsculas: comparando exacto, `Juan.Perez@x.cl` y `juan.perez@x.cl` eran dos personas
distintas, y una cuenta creada con la primera no entraba tipeando la segunda. Por eso
`UsersService.findByEmail` —la búsqueda del login, del duplicado del registro y del vínculo
con Google— también compara en minúsculas.

**Los roles son obligatorios y múltiples, y lo elegido en el alta es el conjunto**, no un
agregado a lo que hubiera. Importa porque `removeMember` da de baja la membresía pero deja
vivas las filas de `roles_usuarios`: sin dar de baja las que no vinieron, re-dar de alta a
alguien eliminado le restituía en silencio sus permisos viejos —`Administrador` incluido—
encima de los que el admin acababa de elegir. Un usuario sin rol entra y no ve nada: crear
sin rol es crear algo roto. Y se validan contra **este** tenant — no hay roles globales,
así que sin ese chequeo un admin podría asignar el rol de otra empresa pasando su id.

### La invitación por link

La contraseña **la elige la persona**, desde un link de un solo uso que le llega
por mail. El admin no conoce nunca una credencial ajena — antes dictaba una
temporal, y todo el andamiaje de "cambio obligatorio" (`debe_cambiar_contrasena`,
el 403 de `switchTenant`, la pantalla de cambio forzado) existía **solo por eso**.
Con invitación no se suaviza: se borra.

La cuenta se crea **sin contraseña** (`usuarios.contrasena` es nullable), así que
hasta que use el link no hay con qué entrar. El token vence a los **7 días**.

De regalo resuelve la verificación de correo del invitado: si hizo clic, la
dirección existe y es suya. Queda pendiente solo para el auto-registro público.

⚠️ Un admin puede mandar una invitación a cualquier dirección, así que al dueño
de esa casilla le llega un mail que no pidió. Eso queda asumido: el daño está
acotado y sin el link no se puede usar la cuenta.

### La confirmación (cuando la cuenta ya existe)

**Decisión del owner, 2026-08-15: el alta no adopta una cuenta que ya tiene
contraseña puesta.**

Hasta acá el alta adoptaba cualquier cuenta cuyo correo coincidiera. Alguien
podía pre-registrar `futuro.empleado@empresa.cl` con una contraseña suya y, el
día que el admin diera de alta a esa persona, **el sistema le entregaba la
cuenta del atacante los roles que el admin eligió** — sin una sola señal para
nadie. La premisa era que "el correo coincide" prueba de quién es la cuenta, y
no lo prueba. Lo prueba el clic de quien lee esa casilla.

Ahora ese caso manda un mail y **la persona confirma antes de quedar asociada**.
Dos cosas que definen la forma:

1. **El texto dice "te están sumando a X", no "confirmá tu correo".** El caso
   legítimo más común no es alguien probando su dirección: es alguien que ya
   trabaja en otra empresa del sistema y a quien esta suma. Para esa persona
   "confirmá tu correo" no describe nada —su correo funciona hace meses— y el
   dato que necesita para decidir es **quién la está sumando y a dónde**. Nombrar
   al tenant sirve también por el otro lado: si el alta la disparó alguien que no
   debía, el mail es la única señal que recibe el dueño de la casilla, y una
   señal sin nombre no se puede accionar.
2. **Mientras está pendiente NO es miembro, y el admin lo ve.** Sin eso el admin
   da el alta, no ve nada y cree que falló. Los pendientes salen en
   `GET /tenants/members` marcados con `pendienteConfirmacion: true`, y sus
   `roles` son los que **va a recibir**, no los que tiene.

**Dónde vive el estado "pendiente": en el token, no en `usuarios_tenants`.** La
alternativa era crear la membresía marcada como pendiente, y eso obligaba a que
las **nueve** lecturas de membresía del backend (`TenantGuard`, `switchTenant`,
`getMyTenants`, roles, garzones ×2, cajones, tenants ×2) filtraran el estado
nuevo: un solo olvido deja operar a alguien que nunca confirmó. Guardando la
intención en `tokens_acceso.datos` (`{ tenantId, rolIds }`), quien no confirmó
**no es miembro por construcción** y no hubo que tocar ninguna de las nueve.

Los `rolIds` se congelan al momento del alta y **se revalidan al confirmar**: el
token vive 7 días y en esa semana el admin pudo borrar un rol. Se entra con los
que sobrevivieron; si no sobrevivió ninguno se rechaza el link —entrar sin rol es
entrar y no ver nada— y el admin repite el alta.

#### La otra puerta: `POST /tenants/members`

⚠️ **El mismo criterio rige acá** (owner, 2026-08-15). `addMember` asocia por
`usuarioId` en vez de por correo, pero el efecto es idéntico —una cuenta ajena
entra al tenant— y cerrar sólo el alta dejaba el invariante a medias: el alta
**devuelve el `usuarioId` incluso cuando deja la confirmación pendiente**, así
que el camino completo eran dos requests. Se encontró buscando por conducta
("asociar una cuenta a un tenant"), no por nombre de método.

Con contraseña puesta → no asocia, manda el mismo mail y devuelve
`{ usuarioId, pendienteConfirmacion: true }`. Sin contraseña, o ya miembro vivo
→ conducta de siempre (sigue siendo idempotente).

Se diferencia del alta en una sola cosa: **por acá no vienen roles**, así que el
token viaja con `rolIds: []`.

⚠️ Y eso obliga a distinguir dos vacíos que no son lo mismo:

| `datos.rolIds` | Significa | Al confirmar |
|---|---|---|
| `[]` de origen (`addMember`) | Esta puerta no asigna roles | Entra sin roles, y **no** se toca `roles_usuarios` |
| No vacío, pero ninguno sobrevive al revalidar | Los roles se borraron en la semana | `400`: entrar sin rol es entrar y no ver nada |

El segundo caso no puede disfrazarse del primero porque `CrearUsuarioTenantDto`
tiene `@ArrayMinSize(1)`: el alta nunca emite un array vacío.

Y el salteo de `fijarRolesExactos` en el primer caso **no es una optimización**:
ese método da de baja los roles que no vinieron, y `rol_id <> ALL('{}')` es TRUE
para todos, así que llamarlo con un array vacío borraría todos los roles de esa
persona en el tenant. `addMember` nunca tocó `roles_usuarios` y sigue sin
tocarlos.

### La baja de una membresía (2026-08-16)

Dar de baja a alguien es la transición que nadie mira: hasta el 2026-08-16 eran dos líneas
(`softDelete({ tenantId, usuarioId })`) y podían dejar dos cosas rotas y en silencio.

**1. El tenant sin ningún administrador.** `TenantAdminGuard` verifica que quien llama
**sea** admin en ese instante, nunca que la acción deje al tenant con alguno, así que el
último admin podía sacarse a sí mismo — por la baja o quitándose el rol. Y no hay vuelta:
`/admin/tenants` expone crear, listar, ver, editar, borrar y agregar módulos, y **ninguna
ruta para asignar un rol ni sumar un miembro**. Un tenant sin admin solo se arregla con SQL
directo. Desde el 2026-08-16 las dos puertas —`DELETE /tenants/members/:userId` y
`DELETE /roles/:id/users/:userId`— **bloquean con `400`**.

El criterio de "quién administra" vive en un solo lugar, `RbacService.administradoresDe`,
y tiene un `JOIN` que su vecino `userIsTenantAdmin` no necesita: **`usuarios_tenants`**. La
baja deja vivas las filas de `roles_usuarios` (ver arriba), así que contar solo por ahí
cuenta gente que ya no es miembro — con dos admins, dar de baja a uno y volver a contar
daría 2, y el bloqueo dejaría pasar justo el caso que existe para atajar.
`userIsTenantAdmin` puede prescindir del `JOIN` porque corre detrás de `TenantGuard`, que
ya exigió membresía viva; un conteo no tiene ese guard delante.

Las dos rutas **borran primero y cuentan después**, y el `throw` deshace el borrado con la
transacción. Quitarle un rol fijo a alguien que tiene dos no lo saca del conjunto, y esa
aritmética es donde se cuelan los casos raros: preguntarle a la base cómo quedó el tenant
no tiene ese problema. El conteo previo toma **`FOR UPDATE OF ut, ru`** con un `ORDER BY`
fijo — sin el lock, dos bajas simultáneas de los dos últimos admins pasan los dos chequeos
y el tenant queda huérfano igual; con el mismo `ORDER BY` en los dos caminos, tampoco
pueden deadlockearse entre sí.

**2. El garzón vinculado, sin ninguna credencial.** Un garzón con cuenta nace con
`pinHash = PIN_INUTILIZABLE`: vincular mata el PIN a propósito porque la cuenta pasa a ser
la credencial. Al bajar la membresía, `garzonPersonalDe` deja de resolver el modo personal
**y el PIN sigue muerto**. Desde el 2026-08-16 la baja **exige una decisión explícita**
cuando hay vínculo (`400` nombrando al garzón si no viene):

| `?garzon=` | Qué hace | Respuesta |
|---|---|---|
| `sigue` | Desvincula y le escribe un PIN nuevo usable, con evento `regenerado_por_baja_de_cuenta` | `{ garzon: { accion: 'desvinculado', pin } }` — el PIN en claro, **una sola vez** |
| `no-sigue` | Deja el garzón `activo = false`, con el vínculo intacto | `{ garzon: { accion: 'desactivado', pin: null } }` |

Las dos son reversibles, pero **no cuestan lo mismo**: `sigue` deja al garzón operando ya
mismo, y `no-sigue` lo deja en un estado que necesita **dos** cosas para volver — prender
`activo` **y** resolverle la credencial, porque su cuenta ya no es miembro y sin membresía
no puede entrar a fijarse un PIN. Volver a sumar a la persona, o desvincular y generarle
un PIN, son las dos salidas. ⚠️ Y mientras tanto la ficha lo rotula *"Sin PIN todavía"*,
que promete que él lo resuelve — anotado en `pendientes.md`, es lo que falta para que esa
pantalla no mienta.

**Se descartó la salida automática** (desvincular y dar PIN siempre): asume que el garzón debe seguir operando, y el motivo más común de una baja es
que la persona se fue — darle un PIN funcional a alguien que se fue le deja abrir mesas
desde el tótem. Dar de baja la cuenta y *"ya no trabaja acá"* no son lo mismo.

El vínculo y el PIN se resuelven **antes** de abrir la transacción: generar el PIN cuesta
un `bcrypt.hash` más un `compare` por garzón del tenant, y hacerlo con el BEGIN abierto
retendría la conexión durante todo ese CPU. Que el dato envejezca no rompe nada — la
escritura relee con el `manager` y, si el vínculo ya no está, la baja se hace pero no
promete ningún PIN.

Por eso la ruta devuelve **`200` con cuerpo y no `204`**: sin cuerpo no hay dónde entregar
el PIN, y *"se le genera un PIN usable"* que nadie ve no le sirve a nadie.

⚠️ **Hoy ninguna pantalla llama a esta ruta**: no existe la baja de membresía por UI
(verificado el 2026-08-16). El contrato está listo para cuando se construya.

### Reset de contraseña

`POST /auth/recuperar` manda un link de **1 hora**. Es público, así que **responde
lo mismo exista o no el correo**: distinguir lo convertiría en un enumerador de
cuentas registradas. Pedirlo dos veces deja vivo **un solo** link, el último.

Al fijar la contraseña se cierran todas las sesiones vivas de esa cuenta: si el
reset lo pidió alguien porque le tomaron la cuenta, dejar los refresh tokens del
intruso vivos vaciaría el sentido del reset.

## API Endpoints

Todos bajo `JwtAuthGuard + TenantGuard`, **salvo los marcados "público"**: esos son los
links de invitación y reset, que los usa alguien que justamente no puede autenticarse
todavía —o no puede más—. Ahí la prueba de identidad es el token del link, no un JWT.
Las **mutaciones** agregan `TenantAdminGuard` (requiere rol `es_fijo = true` en el tenant).

| Método | Ruta | Guard extra | Descripción |
|---|---|---|---|
| GET | `/roles` | — | Lista de roles del tenant |
| POST | `/roles` | TenantAdmin | Crear rol |
| PATCH | `/roles/:id` | TenantAdmin | Editar nombre/descripción (bloquea `esFijo`) |
| DELETE | `/roles/:id` | TenantAdmin | Soft-delete (bloquea `esFijo`) |
| GET | `/roles/modulos-disponibles` | — | Módulos contratados activos + sus permisos |
| GET | `/roles/:id/permissions` | — | `roles_permisos_modulos` del rol |
| PUT | `/roles/:id/modules/:moduloTenantId/permissions` | TenantAdmin | Setear permisos del rol en un módulo |
| POST | `/roles/:id/users` | TenantAdmin | Asignar rol a un usuario |
| DELETE | `/roles/:id/users/:userId` | TenantAdmin | Quitar rol a un usuario. `400` si dejaría al tenant sin admin |
| GET | `/tenants/members` | TenantAdmin | Miembros con correo + roles asignados |
| DELETE | `/tenants/members/:userId` | TenantAdmin | Baja de membresía. `?garzon=sigue\|no-sigue` obligatorio si esa cuenta es la credencial de un garzón. `400` si dejaría al tenant sin admin. Devuelve `200 { garzon }` — ver [La baja de una membresía](#la-baja-de-una-membresía-2026-08-16) |
| GET | `/tenants/members/para-selector` | — | Solo nombres, para los selectores de cuenta |
| GET/POST | `/auth/invitacion/:token` | público | Verifica el link / fija la contraseña y lo quema |
| POST | `/auth/recuperar` | público | Pide el link de reset. **Misma respuesta exista o no el correo** |
| GET/POST | `/auth/recuperar/:token` | público | Verifica el link / fija la contraseña y lo quema |
| POST | `/tenants/usuarios` | TenantAdmin | Alta: crea-o-asocia el usuario, lo suma al tenant y le asigna roles |
| GET | `/tenants/confirmacion/:token` | público | Datos para la pantalla del link: `{ correo, tenant }`. **No quema el token** |
| POST | `/tenants/confirmacion/:token` | público | El sí: crea la membresía, asigna los roles revalidados y quema el link |
| GET | `/rbac/es-admin` | — | `{ esAdmin: boolean }` para gating del frontend |

### Formas relevantes

```
GET /roles/modulos-disponibles →
[ { moduloTenantId, moduloAppId, nombre, icono,
    permisos: [ { moduloAppPermisoId, permisoNombre } ] } ]

GET /tenants/members →
[ { usuarioId, nombre, apellido, correo, esTotem, roles: [ { rolId, nombre } ],
    pendienteConfirmacion } ]
// pendienteConfirmacion=true → TODAVÍA NO es miembro (no tiene fila en
// usuarios_tenants) y `roles` son los que va a recibir. Van al final de la lista.

GET /tenants/members/para-selector →
[ { usuarioId, nombre, apellido, esTotem } ]     // sin correo y sin roles
// Solo miembros de verdad: un pendiente no puede abrir un cajón ni ser garzón.

POST /tenants/usuarios
body: { nombre, apellido?, correo, telefono?, rolIds: string[] }   // rolIds: al menos 1
→ { usuarioId, correo, invitado, pendienteConfirmacion }
// invitado=true              → cuenta nueva, salió el link para elegir contraseña
// pendienteConfirmacion=true → la cuenta ya existía CON contraseña: no se asoció
//                              nada y salió el mail "te están sumando a X"
// las dos en false           → cuenta preexistente sin contraseña: se adoptó

GET /tenants/confirmacion/:token → { correo, tenant }
POST /tenants/confirmacion/:token → { message }

PUT /roles/:id/modules/:moduloTenantId/permissions
body: { moduloAppPermisoIds: string[] }
```

---

## Backend

- **Roles**: `backend/src/modules/roles/roles.controller.ts`, `roles.service.ts`
  - `findModulosDisponibles(tenantId)` — JOIN `tenant_modulos → modulos_app → modulo_app_permisos → permisos`.
  - **Fix crítico en `setPermissions`**: además de `roles_permisos_modulos`, ahora
    mantiene `modulos_roles` (crea/restaura la fila al asignar permisos; la soft-borra
    al dejar el módulo sin permisos). El chequeo de permisos hace JOIN por
    `modulos_roles`, así que sin esto los permisos de roles personalizados nunca
    surtían efecto.
- **RBAC**: `backend/src/modules/rbac/rbac.service.ts` — nuevo `userIsTenantAdmin()`;
  controller expone `GET /rbac/es-admin`.
- **Guard**: `backend/src/common/guards/tenant-admin.guard.ts` — verifica rol fijo;
  registrado en `common.module.ts`.
- **Tenants**: `tenants.service.ts` — `findMembers` enriquecido con nombre + roles, y
  con los pendientes de confirmación en la **misma** consulta (`UNION ALL` contra
  `tokens_acceso`, con los `rolIds` del token expandidos por `jsonb_array_elements_text`;
  dos consultas mergeadas en JS serían dos round-trips para una sola pantalla).
  `crearUsuario` + `confirmarIngreso` comparten `fijarRolesExactos`, que es el par
  INSERT/baja que deja al usuario con **exactamente** los roles elegidos.
- **Confirmación**: `TenantsConfirmacionController` (mismo archivo que
  `TenantsController`) tiene controller propio porque aquel lleva
  `JwtAuthGuard + TenantGuard` **a nivel de clase** y estas rutas las usa
  justamente quien todavía no es miembro. Mismo patrón que `/auth/invitacion/:token`.

---

## Frontend

- **Nav**: `pages/configuracion.vue` — items "Roles y permisos" y "Usuarios" visibles
  solo si `permissionsStore.esAdmin`.
- **Roles lista + editor**: `pages/configuracion/roles/index.vue` — tabla, drawer crear/editar rol
  con matriz de permisos (`RolPermisosPorModulo`); eliminar (bloqueado en `esFijo`).
- **Redirect legacy**: `/configuracion/roles` → `/configuracion/roles` (editor unificado en drawer).
- **Usuarios**: `pages/configuracion/usuarios/index.vue` — miembros con chips de roles;
  edición vía `USelectMenu` múltiple, aplicando diffs (POST/DELETE por rol).
- **Store**: `stores/permissions.ts` — agrega `esAdmin` (cargado junto a `mis-permisos`,
  limpiado en `reset()`).

---

## Testing

### Manual (usuarios de desarrollo)

| Usuario | Contraseña | Rol | Tenant |
|---|---|---|---|
| `vendedor@paris.cl` | `admin` | Vendedor | Paris |
| `admin.paris@paris.cl` | `admin` | Admin (fijo) | Paris |
| `supervisor@paris.cl` | `admin` | Cajas · Supervisión (`Cajas:Leer`, no admin) | Paris |

**Pasos:**
1. `docker-compose up --build`
2. Login como admin de Paris → Configuración → "Roles y permisos" y "Usuarios" visibles.
3. Editar rol Vendedor → activar "Eliminar" en módulo MiCaja → Guardar.
4. Re-login como `vendedor@paris.cl` → verificar en `/mi-caja` que la acción de eliminar
   queda habilitada → confirma que `modulos_roles` se pobló (fix).
5. Login como vendedor: el menú Roles/Usuarios no aparece; `PATCH /roles/:id` directo → 403.

---

## Acceptance Criteria

- [x] Admin crea/edita/elimina roles; rol fijo protegido.
- [x] Matriz de permisos persiste y rehidrata correctamente.
- [x] Permisos de rol personalizado surten efecto (fix `modulos_roles`).
- [x] Usuario puede tener múltiples roles; permisos se unen.
- [x] Mutaciones restringidas a admin del tenant (403 en frontend/backend para no-admin).

---

## Related Features

- [Módulo Configuración](./modulo-configuracion.md) — mismo módulo de Configuración.
