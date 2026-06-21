# Plan: Módulo "Test" para validar permisos (frontend + backend)

## Context

Se necesita una forma concreta de **probar que el RBAC funciona de punta a punta**: que los
permisos se respeten tanto en la UI (botones deshabilitados) como en el backend (endpoints que
rechazan con 403 aunque el frontend no valide nada). Para eso se crea un módulo demostrativo
**Test** con 4 acciones CRUD (Leer, Crear, Actualizar, Eliminar), se siembra y se asocia al rol
**Vendedor** del tenant Paris con un subconjunto de permisos (**Leer + Crear**), de modo que la
prueba muestre simultáneamente el caso permitido y el denegado.

El usuario de prueba ya existe: `vendedor@paris.cl` / contraseña `admin`, con rol **Vendedor**
(`es_fijo = false`) en el tenant **Paris**. Como el rol no es fijo, el backend evalúa la cadena
completa de permisos — ideal para esta validación.

### Cómo funciona el RBAC hoy (verificado)
- Guard `PermisosGuard` (`backend/src/common/guards/permisos.guard.ts`) + decorador
  `@RequiresPermiso(modulo, permiso)` (`backend/src/common/decorators/requires-permiso.decorator.ts`).
- `RbacService.userHasPermiso()` (`backend/src/modules/rbac/rbac.service.ts`): atajo si el usuario
  tiene un rol `es_fijo = true` (acceso total); si no, hace el JOIN completo:
  `roles_usuarios → roles → modulos_roles → tenant_modulos → modulos_app → roles_permisos_modulos → modulo_app_permisos → permisos`.
- **Implicación clave:** para que el Vendedor tenga permisos sobre Test hay que sembrar **3 piezas**:
  `tenant_modulos` (Paris contrata Test), `modulos_roles` (rol Vendedor ↔ ese tenant_modulo) y
  `roles_permisos_modulos` (los permisos concretos Leer/Crear).
- `CommonModule` es `@Global` y exporta `TenantGuard` y `PermisosGuard`; `RbacModule` es `@Global`
  y exporta `RbacService`. El nuevo módulo Test puede usar los guards sin re-cablear repos.
- **No existe** endpoint que devuelva los permisos del usuario → el frontend hoy no puede saber qué
  habilitar. Hay que crearlo.

---

## Backend

### 1. Seed — `backend/src/modules/seeder/seeder.service.ts`
IDs nuevos en el rango libre `...4466554400XX` (usados hasta 046; 047+ libres).

- **`seedModulosApp()`**: agregar módulo Test
  `moduloAppId: 550e8400-e29b-41d4-a716-446655440050`, `nombre: 'Test'`, `url: '/test'`,
  `icono: 'mdi-test-tube'`, `tieneConfiguracion: false`.
- **`seedModuloAppPermisos()`**: 4 entradas Test+CRUD reusando los `permisoId` globales existentes
  (Leer ...012, Crear ...013, Actualizar ...014, Eliminar ...015):
  `...440051`=Test+Leer, `...440052`=Test+Crear, `...440053`=Test+Actualizar, `...440054`=Test+Eliminar.
- **`seedTenantModulo()`**: Paris contrata Test →
  `moduloTenantId: 550e8400-e29b-41d4-a716-446655440055`, `tenantId: ...440007` (Paris),
  `moduloAppId: ...440050`, `estado: 'activo'`, `expiraEn: 2026-12-31`.
- **Nuevo método `seedVendedorPermisosTest()`** (llamarlo al final de `onApplicationBootstrap`, tras
  `seedRolesUsuarios()`), vía `dataSource.query` con `ON CONFLICT DO NOTHING` (patrón ya usado en el
  archivo). Resolver el `rol_id` de Vendedor por nombre+tenant (como hace `seedRolesUsuarios`), y:
  1. `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, ...)` → Vendedor ↔ tenant_modulo Test (...055).
  2. `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id, ...)` para
     **Leer (...051) y Crear (...052) únicamente** (decisión del usuario). No se siembran Actualizar/Eliminar.

### 2. Módulo Test — `backend/src/modules/test/`
Sin entidad/tabla: las acciones solo devuelven un mensaje. Estructura:
- `test.controller.ts`: `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`, `@Controller('test')`.
  - `@Get('leer')` + `@RequiresPermiso('Test','Leer')` → `{ message: 'Leyendo' }`
  - `@Post('crear')` + `@RequiresPermiso('Test','Crear')` → `{ message: 'Creando' }`
  - `@Patch('actualizar')` + `@RequiresPermiso('Test','Actualizar')` → `{ message: 'Actualizando' }`
  - `@Delete('eliminar')` + `@RequiresPermiso('Test','Eliminar')` → `{ message: 'Eliminando' }`
  - Añadir `@ApiTags('test')` + `@ApiBearerAuth()` (consistencia con otros controllers).
- `test.service.ts`: 4 métodos que retornan los mensajes.
- `test.module.ts`: `controllers: [TestController]`, `providers: [TestService]` (sin TypeOrm; guards vienen de los módulos globales).
- Registrar `TestModule` en `backend/src/app.module.ts` (array `imports`).

### 3. Endpoint de permisos del usuario (para que el frontend sepa qué habilitar)
- **`RbacService.getMisPermisos(userId, tenantId): Promise<string[]>`** → devuelve `['Test:Leer', ...]`.
  - Si hay rol `es_fijo = true`: devolver todos los `modulo:permiso` de los módulos contratados por el tenant
    (`tenant_modulos → modulos_app → modulo_app_permisos → permisos`).
  - Si no: el mismo JOIN de `userHasPermiso` pero sin filtrar por módulo/permiso, proyectando `ma.nombre, p.nombre`.
- **Nuevo `backend/src/modules/rbac/rbac.controller.ts`**: `@UseGuards(JwtAuthGuard, TenantGuard)`,
  `@Get('rbac/mis-permisos')` → `rbacService.getMisPermisos(user.id, user.tenantId)`.
  Registrar el controller en `RbacModule` (`controllers: [RbacController]`).

---

## Frontend

### 4. Store de permisos — `frontend/app/stores/permissions.ts` (nuevo)
Mismo patrón que `stores/tenant.ts`. Estado `permisos: string[]`, acción `fetchPermisos()` que llama
`useApiFetch<string[]>(\`${apiUrl}/rbac/mis-permisos\`)`, y getter/función
`can(modulo, permiso)` → `auth.isSuperadmin || permisos.includes(\`${modulo}:${permiso}\`)`.
Cargar tras seleccionar tenant (en `onMounted` de la página Test basta para el alcance pedido).

### 5. Página — `frontend/app/pages/test.vue` (nuevo)
`definePageMeta({ middleware: 'auth', layout: 'dashboard' })`. Envolver en `UDashboardPanel` con
`<AppNavbar title="Test" />`. Usar `useToast()` para los mensajes. Dos secciones:

- **Sección A — Validación Frontend (4 botones):** cada uno `:disabled="!can('Test', <perm>)"`; al hacer
  click muestran toast local (`'Leyendo'`/`'Creando'`/`'Actualizando'`/`'Eliminando'`). **No llaman al backend.**
  Con Leer+Crear sembrados: Leer/Crear habilitados; Actualizar/Eliminar deshabilitados.
- **Sección B — Validación Backend (4 botones, siempre habilitados):** llaman a los endpoints
  (`GET /test/leer`, `POST /test/crear`, `PATCH /test/actualizar`, `DELETE /test/eliminar`) vía
  `useApiFetch`. En éxito muestran el `message` del backend; en 403 muestran toast de error con el
  mensaje del backend. Demuestra el enforcement server-side aunque el front no restrinja.

### 6. Navegación — `frontend/app/layouts/dashboard.vue`
Agregar item `{ label: 'Test', icon: 'i-heroicons-beaker', to: '/test' }` al array `base` del computed
`items` (visible para cualquier usuario autenticado).

---

## Documentación
- Crear `docs/features/test-permisos.md` desde `docs/features/TEMPLATE.md` y enlazarlo en `docs/README.md`.
- Actualizar `README.md` (sección de seed) y el `seed.sql` de referencia si se quiere mantener sincronizado
  (módulo Test + permisos + asociación Vendedor), en el mismo commit.

---

## Verificación (end-to-end)
1. `docker-compose down -v && docker-compose up --build` (reset de BD para correr el seed limpio).
2. **Backend directo** (vendedor, sin pasar por la UI) — obtener token de `vendedor@paris.cl`/`admin`,
   seleccionar tenant Paris, y:
   - `GET /api/test/leer` → 200 `{ "message": "Leyendo" }`.
   - `POST /api/test/crear` → 200 `{ "message": "Creando" }`.
   - `PATCH /api/test/actualizar` → **403** "No tienes permiso para esta acción".
   - `DELETE /api/test/eliminar` → **403**.
   - `GET /api/rbac/mis-permisos` → `["Test:Leer","Test:Crear"]`.
3. Repetir con `admin.paris@paris.cl` (rol fijo) → las 4 dan 200 y `mis-permisos` lista los 4.
4. **Frontend** en http://localhost:5173 como `vendedor@paris.cl`: en `/test`, Sección A muestra
   Leer/Crear habilitados y Actualizar/Eliminar deshabilitados; Sección B: Leer/Crear → toast de éxito,
   Actualizar/Eliminar → toast de error 403.
5. `cd backend && npm run lint && npm test` para validar build/lint.

## Decisiones tomadas
- Vendedor recibe **solo Leer + Crear** (confirmado por el usuario) para mostrar permitido y denegado.
- El módulo Test **no persiste datos** (sin entidad/tabla); las acciones devuelven mensajes simples.
