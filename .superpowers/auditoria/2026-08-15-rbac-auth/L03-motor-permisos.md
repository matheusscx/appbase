## Lente: El motor de permisos y los cuatro guards (rol → módulo contratado → permisos)
## Veredicto: 2 hallazgos

### Qué revisé para poder afirmarlo

- Los cuatro guards completos: `tenant.guard.ts` (46 líneas), `permisos.guard.ts` (40),
  `tenant-admin.guard.ts` (36), `superadmin.guard.ts` (10), y `rbac.service.ts` completo
  (124 líneas, sus tres métodos: `userHasPermiso`, `userIsTenantAdmin`, `getMisPermisos`).
- El orden real de guards en los **40 controllers** de `backend/src/modules/` (censo con
  `awk` sobre cada archivo, no de memoria): confirmé que `@UseGuards(JwtAuthGuard,
  TenantGuard, PermisosGuard)` es el orden universal — no encontré una sola variante con
  `PermisosGuard` antes de `TenantGuard`.
- **Censo verbo por verbo de las 40 controllers**: cada `@Get/@Post/@Put/@Patch/@Delete`
  y el decorador (`@RequiresPermiso` o `@UseGuards(TenantAdminGuard)`) inmediatamente
  encima, o su ausencia. De las rutas de escritura sin decorador, abrí el archivo completo
  y busqué si hay un chequeo manual reemplazándolo (patrón `resolverEscrituraCompartida` en
  `caja.controller.ts`, o el PIN propio en `garzones.controller.ts`) antes de marcarlas
  como hueco.
- Crucé cada hueco candidato contra `docs/features/roles-permisos.md`,
  `docs/features/tienda-online.md`, `docs/PRODUCTO.md`, `docs/patterns/backend.md` y
  `docs/agent/pendientes.md`/`resueltos.md` para descartar diseño ya documentado antes de
  reportarlo.
- Verifiqué con código (no con la doc) que un tenant nuevo **no** siembra ningún
  `tenant_modulos` (`tenants.service.ts` método `create()`, líneas 111–171): solo crea el
  rol `Administrador` (`es_fijo=true`), la membresía, la fórmula de precio y la caja
  virtual. Los módulos los agrega el superadmin después, uno por uno
  (`POST /admin/tenants/:id/modules` → `addModule`, único punto del código que hace
  `INSERT`/`save` en `tenant_modulos`, grep confirmado).
- Confirmé el contraste `setPermissions` en `roles.service.ts:137-139` (si valida
  `moduloTenantId` pertenece al tenant, o sea que un rol personalizado **no puede** recibir
  permisos de un módulo no contratado) contra el short-circuit de `userHasPermiso`, que
  **no** hace ese chequeo.

### Cadena de decisión real, rama por rama

`JwtAuthGuard` (autentica) → `TenantGuard` (¿el usuario tiene una fila viva en
`usuarios_tenants` para `tenantId` del token, y el tenant no está soft-borrado?) →
`PermisosGuard`:
- Sin `@RequiresPermiso` en el handler → `return true` (diseño, no lo reporto).
- Con decorador → `RbacService.userHasPermiso(userId, tenantId, modulo, permiso)`:
  1. **Query A (short-circuit):** ¿el usuario tiene alguna fila en `roles_usuarios` con un
     rol `es_fijo=true` en este tenant (ambos sin soft-delete)? Si sí → `return true`
     **inmediatamente**, sin tocar `tenant_modulos` para nada.
  2. Si no hay rol fijo, **Query B**: JOIN completo
     `roles_usuarios → roles → modulos_roles → tenant_modulos → modulos_app →
     roles_permisos_modulos → modulo_app_permisos → permisos`, filtrando por
     `ma.nombre = modulo` y `p.nombre = permiso`. Si `tenant_modulos` no tiene fila para
     ese módulo (no contratado), el JOIN da cero filas → `false` → `PermisosGuard` lanza
     `403`.

Esto responde el punto 3 del brief: para un usuario **sin** rol fijo, módulo no
contratado = **403**, correcto. La asimetría está solo en la rama 1.

### H1. El short-circuit de `es_fijo` nunca valida módulo contratado — el admin de un tenant nuevo tiene acceso a módulos que nadie pagó

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/rbac/rbac.service.ts:18-30` (`userHasPermiso`,
  query del short-circuit) — abrí el archivo: sí. Corroborado con
  `backend/src/modules/tenants/tenants.service.ts:111-171` (`create()`, no siembra
  `tenant_modulos`) y `backend/src/modules/tenants/tenants.controller.ts:67-69`
  (`addModule`, único alta de `tenant_modulos`, solo por `SuperadminGuard`).
- **Qué está mal:** la query del short-circuit es
  ```sql
  SELECT 1 FROM roles_usuarios ru
  JOIN roles r ON r.rol_id = ru.rol_id
  WHERE ru.usuario_id = $1 AND ru.tenant_id = $2
    AND r.es_fijo = true AND ru.eliminado_el IS NULL AND r.eliminado_el IS NULL
  ```
  No hay ningún JOIN contra `tenant_modulos`. Cualquier ruta con
  `@RequiresPermiso('<CualquierModulo>', '<Accion>')` se abre para el admin del tenant
  sin importar si ese módulo está contratado. Esto contradice el propio contrato
  documentado del producto: `docs/PRODUCTO.md:127` — *"Cada ruta valida rol + módulo
  contratado + permiso del usuario sobre el tenant activo"* — y es inconsistente con el
  resto del motor: `getMisPermisos` (mismo archivo, líneas 84-101) **sí** filtra por
  `tenant_modulos` incluso para el rol fijo, y `RolesService.setPermissions`
  (`roles.service.ts:137-139`) **sí** exige que `moduloTenantId` pertenezca al tenant antes
  de dejar asignar un permiso a un rol personalizado. El único punto ciego es
  `userHasPermiso`.
- **Escenario:** el superadmin crea un tenant nuevo (`POST /admin/tenants`) — el flujo de
  alta (`tenants.service.ts` → `create()`) siembra rol `Administrador` (`es_fijo=true`),
  caja virtual y fórmula de precio, pero **cero filas en `tenant_modulos`** (confirmado
  leyendo el método completo: no hay ningún `INSERT`/`save` sobre `TenantModulo` ahí). El
  usuario creador ya tiene esa fila `es_fijo=true`. Antes de que el superadmin contrate
  ningún módulo (`POST /admin/tenants/:id/modules`, acción manual y separada), el admin del
  tenant ya puede loguearse, activar ese tenant y pegarle a
  `GET /inventario/movimientos` o `POST /recuentos` (`@RequiresPermiso('Inventario', ...)`)
  — o a cualquier otro módulo de negocio — y obtiene **200**, no el 403 que debería recibir
  un tenant que nunca contrató Inventario. El mismo admin, mirando el menú del frontend
  (que usa `getMisPermisos`, sí filtrado por `tenant_modulos`), ni siquiera vería el enlace
  — la pantalla no aparece, pero el endpoint responde igual si se golpea directo.
- **Por qué ningún test lo caza:** no encontré ningún `*.spec.ts` que arme un tenant con
  rol fijo pero **sin** `tenant_modulos` y verifique 403 contra una ruta con
  `@RequiresPermiso`. Los specs de `rbac`/`roles`/`tenants` que sí tocan el short-circuit
  siembran el módulo contratado como parte del fixture (patrón del seeder), así que nunca
  ejercitan la rama "rol fijo + módulo no contratado". El test que lo cazaría: crear tenant
  vía `TenantsService.create()` (o el endpoint), no llamar `addModule`, y pegarle a una
  ruta de un módulo de negocio con el admin recién creado — hoy pasa en 200 y debería
  pasar en 403.
- **Confianza:** alta — el camino de código está confirmado línea por línea (no hay JOIN
  contra `tenant_modulos` en la query del short-circuit) y el flujo de alta de tenant sin
  módulos está confirmado leyendo `create()` completo, no inferido.

### H2. Variante del "efecto colateral" ya conocido (400 en vez de 403): también pasa en rutas de **lectura** con query DTO, no solo en las dos de escritura documentadas

- **Severidad:** baja
- **Ubicación:** `backend/src/modules/caja/caja.controller.ts:111-122` (`historial`) y
  `:362-381` (`listarMovimientos`) — abrí el archivo: sí. DTOs en
  `backend/src/modules/caja/dto/query-historial-caja.dto.ts` (`usuarioId`/`cajonId` con
  `@IsUUID()`) y `query-movimientos-caja.dto.ts` (`tipo` con `@IsIn(['entrada','salida'])`).
- **Qué está mal:** `docs/agent/pendientes.md` ya anota (como conocido, ítem "`Cajas:Actualizar`
  es un permiso grueso...") que al sacar `@RequiresPermiso` de **dos rutas de escritura**
  (`:id/conteo`, `:id/cerrar`) y resolver el permiso a mano dentro del handler
  (`resolverEscrituraCompartida`), el chequeo de permiso pasa a correr **después** del
  `ValidationPipe` global (`main.ts:19`, `whitelist: true, transform: true`) — un usuario
  sin ningún permiso de caja pero con body inválido recibe `400` en vez de `403`. El mismo
  patrón existe en dos rutas de **lectura** que el brief no menciona: `historial` y
  `listarMovimientos` resuelven el permiso a mano con `resolverLecturaCompartida` (que
  lanza `ForbiddenException` si el usuario no tiene ni `MiCaja:Leer` ni `Cajas:Leer`), pero
  ese chequeo corre **dentro** del handler, después de que `@Query() query:
  QueryHistorialCajaDto` / `QueryMovimientosCajaDto` ya pasaron por el pipe. Un usuario sin
  ningún permiso de caja que llame `GET /caja?usuarioId=no-es-uuid` o
  `GET /caja/:id/movimientos?tipo=foo` recibe `400` (error de validación del DTO) en vez
  del `403` que debería frenarlo primero.
- **Escenario:** un usuario del tenant sin `MiCaja:Leer` ni `Cajas:Leer` (p. ej. un garzón
  con solo `Salones:Operar`) hace `GET /caja?usuarioId=xyz` (no-UUID). Antes de que
  `resolverLecturaCompartida` corra, el `ValidationPipe` global rechaza `usuarioId` por no
  ser UUID → `400 Bad Request` listando el campo inválido. Con un `usuarioId` válido
  (o sin query) sí recibiría el `403` correcto.
- **Por qué ningún test lo caza:** mismo motivo que la instancia ya documentada — no filtra
  datos (el DTO ya está en Swagger) y el `test:e2e` de caja no ejercita "sin permiso +
  query inválida" a propósito, solo "sin permiso + query válida" (que sí da 403) y "con
  permiso + query inválida" (que da 400 esperado). No hay un test que cruce ambas
  condiciones a la vez.
- **Confianza:** alta en el mecanismo (orden Guard→Pipe→Handler es el de NestJS, no
  depende de config del proyecto); media en el impacto real — es el mismo "cambio de
  contrato" cosmético ya aceptado para las rutas de escritura, extendido a dos rutas de
  lectura que el brief no nombraba. Lo reporto como variante distinta, no como hallazgo
  nuevo de fondo.

### Descartado tras verificar (para que quede registrado)

- **`/suscripciones` (self-service: `POST`, `GET`, `PATCH /:id`, `PATCH /:id/tarjeta`) sin
  `@RequiresPermiso`** — parecía un hueco (su hermano `/online/checkout` sí exige
  `Tienda Online:Crear`), pero `docs/features/tienda-online.md:180-220` documenta
  explícitamente que solo las rutas `/suscripciones/admin/*` llevan `@RequiresPermiso`; las
  del cliente son self-service a propósito (mismo criterio que el PIN propio de
  `garzones.controller.ts`). No lo reporto.
- **`medios-pago-online.controller.ts`: `DELETE`/`PATCH` usan `RequiresPermiso('Tienda
  Online', 'Crear')`** — parecía verbo equivocado (debería ser `Eliminar`/`Actualizar`),
  pero el seed (`seeder.service.ts:678-687`) y `docs/features/tienda-online.md:301-302`
  confirman que el módulo `Tienda Online` solo tiene permisos `Leer`/`Crear` definidos — no
  existen `Actualizar`/`Eliminar` para ese módulo. Es el mismo patrón ya documentado como
  "permiso grueso" (como `Cajas:Actualizar`), no un bug nuevo.
- **Orden de guards invertido** (`PermisosGuard` antes de `TenantGuard`) — censado en las
  40 controllers, no encontré ninguna variante. El orden es uniforme.
- Recorrí las **40 controllers** de `backend/src/modules/` verbo por verbo (censo completo
  en el bloque "Qué revisé"); todas las rutas de escritura de módulos de negocio tienen
  `@RequiresPermiso` o `TenantAdminGuard`, o un chequeo manual documentado que lo reemplaza
  (`caja.controller.ts` los dos casos ya conocidos, `garzones.controller.ts` el PIN propio).
  No encontré una ruta de escritura de un módulo de negocio genuinamente huérfana de
  guard/decorador.
