# Backend Patterns — Playbook

**Status**: Living
**Last Updated**: 2026-07-15

Patrón de referencia para construir un módulo de feature (NestJS + TypeORM),
extraído del código real (`modules/monedas/`, `modules/tenants/`). **Léelo antes de
planificar una feature**: cada sección condensa el patrón y apunta al archivo real
para copiar/adaptar.

> Convenciones transversales obligatorias (no repetidas en cada sección):
> - **Soft delete en todo**: `@DeleteDateColumn({ name: 'eliminado_el' })`; toda
>   lectura filtra `eliminado_el IS NULL` (o `eliminadoEl: IsNull()`).
> - **`type: 'uuid'` explícito** en toda columna PK/FK de UUID ([ADR-004](../adr/004-uuid-column-types.md)).
> - **`tenant_id` siempre del token** (`req.user.tenantId`), nunca del body.
> - **Decimal.js / `numeric`** para dinero y porcentajes; nunca `number` nativo.
>   Porcentajes en decimal (`0.19` = 19%).

---

## 1. Esqueleto de un módulo

```
backend/src/modules/<feature>/
├── entities/<feature>.entity.ts
├── dto/{create,update}-<feature>.dto.ts
├── <feature>.service.ts + <feature>.service.spec.ts   # tests junto al service (TDD)
├── <feature>.controller.ts
└── <feature>.module.ts
```

Registrar en `app.module.ts`: entities en el array `entities` del
`TypeOrmModule.forRoot` y `<Feature>Module` en `imports`.

---

## 2. Entity

- **PK simple:** ver `modules/tenants/entities/tenant.entity.ts` —
  `@PrimaryGeneratedColumn('uuid')` + `@CreateDateColumn({ name: 'creado_el' })`,
  `@UpdateDateColumn({ name: 'actualizado_el' })`, `@DeleteDateColumn({ name: 'eliminado_el' })`.
- **PK compuesta (tabla puente / por tenant):** ver
  `modules/monedas/entities/tenant-moneda.entity.ts` — dos `@PrimaryColumn({ type: 'uuid' })`.
- Nombres de columna DB en `snake_case` vía `name:`; propiedades en `camelCase`.
- `numeric` (`type: 'numeric', precision, scale`) se mapea a **`string`** en JS —
  no operar con `+`/`*`, usar Decimal.js. Tipar la propiedad `string | null`.

---

## 3. DTO

`class-validator` con `ValidationPipe` global (`main.ts`). Campos opcionales en
update con `@IsOptional()`. Campos `numeric` con `@IsNumberString()`.

> **Contrato con el frontend:** `@IsNumberString` exige un **string** (`"10.50"`), no
> un `number`. El cliente lo maneja string de punta a punta con `UInput`
> `inputmode="decimal"` (nunca `type="number"`) — ver [frontend.md §7](./frontend.md).
> Mandar un `number` produce `400 "X must be a number string"`.

---

## 4. Controller — guards y `tenantId` del token

`tenantId` siempre se extrae con `const user = req.user as { tenantId: string }` y
se pasa al service. Ejemplo completo: `monedas.controller.ts`.

**Guards disponibles** (`src/common/guards/`, exportados por `CommonModule` `@Global`
— no hay que importar nada extra):

| Guard | Verifica |
|---|---|
| `JwtAuthGuard` | token válido |
| `TenantGuard` | membresía en el tenant del token |
| `TenantAdminGuard` | rol admin (fijo) en el tenant |
| `PermisosGuard` | permiso RBAC granular (`rol → módulo contratado → permiso`) |

**Dos estándares según el tipo de pantalla:**

- **Catálogos de configuración financiera** (monedas, impuestos, descuentos,
  recargos, categorías, métodos-pago, tipos-regla, roles):
  `@UseGuards(JwtAuthGuard, TenantGuard)` en la clase + `TenantAdminGuard`
  por-handler en las mutaciones. Admin-only por producto, no son módulos RBAC.
- **Módulos de negocio** (Caja, Ventas, Pagos, Inventario, Items, Terceros, Tienda
  Online, Suscripciones): `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)` a
  nivel de controller + `@RequiresPermiso('<Modulo>', '<Permiso>')` por handler
  (ej.: `caja.controller.ts`). Un rol `es_fijo` (admin) tiene acceso total vía
  short-circuit en `RbacService.userHasPermiso`.

> Al agregar un módulo de negocio nuevo: registrar el `modulo_app` y sus
> `modulo_app_permisos` (CRUD estándar Leer/Crear/Actualizar/Eliminar/Ver todas)
> en `seeder.service.ts`, luego aplicar `PermisosGuard` + `@RequiresPermiso(...)`.
> Ocultar el link en el sidebar (`can(modulo, permiso)`) es complementario, no un
> sustituto del enforcement en el backend.

---

## 5. Module

`TypeOrmModule.forFeature([...])` con las entities que el service inyecta;
`exports: [<Feature>Service]` si otro módulo lo usa. No importar `RbacModule` ni
`CommonModule` (los guards son globales). Ej.: `monedas.module.ts`.

---

## 6. Service

- **Lectura con SQL raw (joins multi-tabla):** `this.dataSource.query` con
  parámetros posicionales (`$1`), filtrando `eliminado_el IS NULL` **en cada join**,
  y mapeo de filas `snake_case` → objeto `camelCase`. Ver
  `monedas.service.ts → findMonedas`.
- **Mutación con transacción (regla "solo uno"):** dentro de
  `dataSource.transaction`, limpiar el flag de todos
  (`UPDATE ... SET x = false WHERE tenant_id = $1 AND eliminado_el IS NULL`) y
  marcar el nuevo. Validar precondiciones antes. Ver `setDefault` en `monedas.service.ts`.
- **Upsert con restauración de soft-deleted:** buscar con `withDeleted: true`; si
  existe, `existing.eliminadoEl = null` (restaurar); si no, `manager.create(...)`.
- **Errores de negocio:** `BadRequestException` con mensaje en español (el frontend
  lo muestra tal cual desde `e.data.message`); `NotFoundException` cuando el recurso
  no aplica al tenant/país.
- **POST/PATCH sin refetch:** armar la respuesta con `RETURNING` + valores ya
  conocidos en la mutación (p. ej. `costoActual` recién costado). **No** llamar
  `findOne` después del write. Create → entidad para insertar en lista; update →
  patch mergeable (`{ id, ...camposTocados }`). El front hace
  `{ ...prev, ...saved }` sin otro GET.

---

## 7. Tests (TDD, junto al service)

`<feature>.service.spec.ts` con mocks de repositorio + `DataSource`
(ver `monedas.service.spec.ts`):
- `getRepositoryToken(Entity)` para el repo, `getDataSourceToken()` para el DataSource.
- Mockear `dataSource.query` **y** `dataSource.manager.*`; `transaction` se mockea
  como `(cb) => cb(managerMock)`.
- Un test por regla de negocio (rechazos incluidos) + happy path del upsert.

Correr: `cd backend && npm test`. Antes de cerrar: `npm test`, `tsc` limpio, `npm run lint`.

---

## 8. Seeding

Dos lugares, ambos en el **mismo commit**:

1. **Al crear el tenant** (`tenants.service.ts → create()`, dentro de la transacción
   que ya siembra rol admin + fórmula de precio + caja virtual): agregar lo que todo
   tenant nuevo necesita.
2. **Seeder de desarrollo** (`modules/seeder/seeder.service.ts` — **fuente de
   verdad**, corre al arrancar): un método privado `seed<Entidad>()` idempotente,
   llamado en `onApplicationBootstrap` después de sus dependencias. IDs fijos
   `550e8400-e29b-41d4-a716-446655440XXX` (siguiente número libre); PKs compuestas
   no necesitan ID fijo. Registrar la entity en `seeder.module.ts` (`forFeature`).

---

## 10. Paginación server-side

Para listados grandes (pagos, ventas, kardex):

- **DTO:** extender `common/dto/pagination-query.dto.ts` (`page` 1-based default 1,
  `pageSize` default 15 max 100) con los filtros del recurso.
- **Utils:** `common/utils/pagination.util.ts` — `resolvePagination(query)` →
  `{ page, pageSize, offset }`; `buildPaginationMeta(page, pageSize, total)`.
- **Respuesta:** `PaginatedResponse<T>` (`common/interfaces/`) = `{ data, meta }`.
- **Service (SQL raw):** `WHERE` compartido (tenant + soft delete + filtros) →
  `COUNT(*)` → `SELECT ... ORDER BY ... LIMIT $n OFFSET $m`.
- **Controller:** rutas estáticas (`/resumen`, `/preferencias`) **antes** de rutas
  con params. KPIs/agregados globales van en endpoint separado (`GET /pagos/resumen`),
  no en `data[]`.

---

## 11. Preferencias de usuario

Preferencias **personales** (UX), distintas de las financieras del tenant.
Columna `usuarios.preferencias JSONB NOT NULL DEFAULT '{}'`
(shape `{ ui?: { colorMode?, pageSize? } }`); utils en
`common/utils/usuario-preferencias.util.ts` (`normalize`/`merge`).
API: `GET /auth/me` incluye `preferencias`; `PATCH /me/preferencias` hace merge
parcial validado con DTO anidado. Defaults en código: `colorMode: 'light'`,
`pageSize: 15`. Alcance **usuario**, no tenant.

---

## 13. Callback desacoplado entre módulos (registry + `onModuleInit`)

Cuando un módulo "core" debe notificar a uno de negocio **sin importarlo** (p. ej.
`pasarela` NO importa `online`/`ventas`): el core define una interfaz de handler y
un **registry singleton** (`register(h)` / `get()`) que **exporta**; el módulo de
negocio importa el core y declara un provider que implementa la interfaz y se
registra en `onModuleInit`. El borde se cruza en una sola dirección (negocio → core).
Implementación de referencia: `modules/pasarela` (`PagoCallbackRegistry` +
`OnlineCallbackHandler`).

Claves: el dispatcher hace `registry.get()?.onOrdenResuelta(orden)` con `await`
(monolito) o POST fire-and-forget (destinos externos); el handler debe ser
**idempotente**; un fallo del callback no rompe el flujo del core (`try/catch` + log).

---

## 12. Docs vivas a tocar en el mismo commit

- `startup-pos.sql` — agregar las tablas nuevas.
- `docs/features/<feature>.md` (desde `docs/features/TEMPLATE.md`) + link en `docs/README.md`.
- `docs/ESTADO.md` — marcar ✅ / agregar la fila de la funcionalidad.
- ADR nuevo en `docs/adr/` (+ índice) si hubo una decisión arquitectónica.

Ver [frontend.md](./frontend.md) para la capa de UI.
