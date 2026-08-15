# Brief común — auditoría RBAC + auth + tenants

Sos un **buscador de una sola lente** en la pasada 4 del programa de auditoría de
`startup-app` (SaaS POS multi-tenant: NestJS + Nuxt 4 + Postgres 15). Método:
`docs/agent/auditoria-codigo.md`.

**Este es el eje más sensible del sistema y el único que ninguna pasada tocó.** Si el
aislamiento entre tenants o el control de acceso se rompe, no importa que el resto esté
bien. Buscás **deuda estructural que ningún gate mira**, sobre código que ya pasó lint,
typecheck, unit, e2e, CI y revisión de diff.

## ⛔ Reglas que hacen que esto sirva

1. **Una sola lente: la tuya.** Sos ciego a las demás a propósito. Si ves algo de otra
   lente, ignoralo — hay otro agente en eso.
2. **Todo hallazgo trae `archivo:línea` verificado ABRIENDO el archivo.** Nunca de memoria
   ni de un grep.
3. **Todo hallazgo trae escenario reproducible**: inputs y estado concretos → resultado
   incorrecto. "Podría fallar" no es un escenario. En seguridad la tentación de reportar
   riesgos teóricos es máxima: resistila.
4. **Tope: 6 hallazgos.** No los completes. **Cero hallazgos es un resultado válido y
   bueno.** Si tu lente sale limpia, decilo y contá qué revisaste para poder afirmarlo
   ("las 34 rutas, una por una").
5. **Si algo de este brief no coincide con el código, PARÁ y reportá `BLOCKED`** con la
   discrepancia. El brief lo escribí de memoria; vos tenés el archivo abierto y yo no.

## 🔒 Invariante que te aplica a vos

**`CLAUDE.md` prohíbe modificar el sistema de tokens JWT** (access + refresh, ya
implementado). **Auditarlo sí, y a fondo.** Pero si tu hallazgo implica cambiarlo, decilo
explícitamente con la etiqueta `⛔ TOCA JWT` para que el arreglo pase por el owner antes de
escribirse. No propongas el cambio como si fuera una corrección de rutina.

## Alcance

**Backend** (`backend/src/`):
- `modules/auth/` (988 líneas) — login, refresh, registro público, invitación, recuperación
  de contraseña, estrategia Google, `tokens-acceso.service.ts`
- `modules/rbac/` (165) — el motor de permisos
- `modules/roles/` (495) — roles, `rol_usuario`, `modulo_rol`
- `modules/tenants/` (1.516) — membresías, alta de usuarios del tenant, módulos contratados
- `modules/users/` (147), `modules/me/` (162)
- `common/guards/` — los **cuatro**: `tenant.guard.ts`, `permisos.guard.ts`,
  `tenant-admin.guard.ts`, `superadmin.guard.ts`
- `common/decorators/requires-permiso.decorator.ts`, `current-user.decorator.ts`
- `common/interfaces/jwt-user.interface.ts`

**Frontend** (`frontend/app/`):
- `middleware/auth.ts`, `middleware/admin.ts`, `middleware/permiso.ts` (+ sus specs)
- `composables/usePermisosCrud.ts`
- `pages/login.vue`, `pages/admin.vue`, `pages/configuracion/roles/**`,
  `pages/configuracion/usuarios/**`

**Tests del alcance:** los `*.spec.ts` de esos módulos y los `backend/test/*.e2e-spec.ts`
que ejerciten auth, roles, permisos o tenants.

## Modelo de dominio (leelo antes de reportar)

- **Permisos:** `rol → módulo contratado (tenant_modulos) → permisos`. Un rol `es_fijo`
  (el admin del tenant) tiene acceso total por short-circuit en `RbacService.userHasPermiso`.
- **Superadmin es un eje aparte**: `usuarios.es_superadmin`, rutas `/admin/*`, guard propio.
  No es "un rol más" y no vive en el modelo RBAC del tenant.
- **Un usuario pertenece a VARIOS tenants** y opera en uno a la vez. Por eso `usuarios` no
  tiene `tenant_id` (medido y documentado el 2026-08-15 en `docs/patterns/backend.md`
  § "Tablas sin `tenant_id`" — leelo, tiene el censo de las 39 tablas sin la columna y las
  cuatro familias). La membresía vive en `usuarios_tenants`, que además lleva `es_totem`.
- **`tenant_id` sale SIEMPRE del token**, nunca del body, query ni ruta.
- **Soft delete en todo**: toda lectura filtra `eliminado_el IS NULL`.
- `startup-pos.sql` es **documentación, no se ejecuta**: el esquema real lo crea TypeORM por
  `synchronize` desde las entidades. Los índices únicos **parciales** los crea el seeder
  (`seeder.service.ts`), no `synchronize` — si vas a afirmar que falta un índice, mirá
  **los tres** lugares.
- Docs: `docs/features/roles-permisos.md`, `docs/ARCHITECTURE.md`, `docs/adr/`.

## 🚫 YA CONOCIDO — no lo reportes

1. **No hay rate limiting en ningún endpoint.** `login`, `refresh`, `recuperar`,
   `invitacion/:token`, `recuperar/:token`, `garzones/verificar-pin` y los retornos de
   pasarela. Ya está anotado como **bloqueante de producción** con la lista completa.
2. **`PermisosGuard` devuelve `true` cuando la ruta no tiene `@RequiresPermiso`.** Es el
   diseño. Lo que **sí** es hallazgo es una ruta que **debería** tener el decorador y no lo
   tiene — eso reportalo.
3. **`addMember` no da de baja los roles viejos** al re-agregar a alguien. Decisión
   deliberada, ya anotada con su porqué.
4. **Un correo de usuario soft-borrado haría explotar el alta con 500.** Ya anotado, hoy
   inalcanzable (nada soft-borra un `Usuario`), con la decisión del owner ya tomada.
5. **`POST /auth/register` no verifica el correo.** Ya anotado.
6. **`Cajas:Actualizar` es un permiso grueso** que gobierna cosas de distinto peso. Anotado
   como tema del catálogo de permisos, no como bug.
7. **`synchronize: true` y los secrets en `.env`** — anotados para producción.

Si encontrás una **variante distinta** de alguno, reportala diciendo en qué se diferencia.

## Formato de salida (obligatorio)

Tu texto final ES el resultado; escribí el reporte, no un mensaje para humanos.

```
## Lente: <nombre>
## Veredicto: <N hallazgos> | LIMPIA | BLOCKED

### Qué revisé para poder afirmarlo
<2-5 líneas contables: qué archivos, cuántas rutas/guards/queries/ramas, con qué criterio.>

### H1. <título corto y falsable>
- **Severidad:** alta | media | baja
- **Ubicación:** `ruta/archivo.ts:NN` (abrí el archivo: sí)
- **Qué está mal:** <1-3 frases>
- **Escenario:** <quién, con qué credencial, hace qué request → qué obtiene que no debería>
- **Por qué ningún test lo caza:** <el test que debería existir, o el que existe y no mata
  el mutante>
- **Confianza:** alta | media | baja — <qué te faltaría para subirla>
- **⛔ TOCA JWT** (solo si el arreglo implica modificar el sistema de tokens)
```

Severidad: **alta** = un tenant alcanza datos de otro, alguien obtiene permisos que no
tiene, o una credencial se filtra. **media** = control de acceso incorrecto sin cruzar el
borde del tenant. **baja** = defensa en profundidad o cosmético.
