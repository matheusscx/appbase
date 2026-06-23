# Plan: Catálogos de reglas de precio (Punto 7)

**Status:** Done
**Date:** 2026-06-22
**Owner:** Cesar Matheus

## Context

El punto 7 de `docs/MIGRACION-FUNCIONALIDADES.md` pide los **catálogos financieros por
tenant** que luego consumen items (punto 8) y ventas (punto 10): categorías, impuestos,
descuentos, recargos y métodos de pago. Hoy no existe ningún módulo ni entity para estos
catálogos (solo están las tablas en `startup-pos.sql` y los enums `modo_regla` /
`condicion_tipo`). Sin ellos no se puede construir el catálogo de items ni el motor de
precios.

Se construye replicando los patrones de-facto ya establecidos en el repo
(`modules/monedas/`, `pages/configuracion/razones-sociales.vue`) descritos en
`docs/patterns/backend.md` y `docs/patterns/frontend.md`.

## Decisiones tomadas

- **Despacho:** 3 subagentes por afinidad (ver "Estrategia de subagentes"). Cada agente crea
  **solo** archivos dentro de sus propios módulos/páginas; la integración de archivos
  compartidos (`app.module.ts`, seeder, `configuracion.vue`, `startup-pos.sql`, docs) la hace
  el orquestador para evitar conflictos.
- **Métodos de pago:** modelo espejo de monedas. Se **agrega la tabla `metodo_pago_pais`**
  (análoga a `pais_moneda`): catálogo global → disponibilidad por país → habilitación por
  tenant. El tenant solo ve los métodos disponibles en su país. **Al crear un tenant, los
  métodos de pago de su país quedan habilitados automáticamente** (igual que la moneda
  oficial). CRUD del catálogo global = fase superadmin posterior; aquí se siembra.
- **Descuentos/recargos:** persistir TODO el esquema (`modo`, `valor`, `condicion_tipo`,
  `condicion_valor`, `fecha_inicio`, `fecha_fin`) y exponerlo completo en la UI. La
  **evaluación** de condiciones/vigencia queda para fase posterior (CLAUDE.md), pero los datos
  se capturan ya.
- **Tipos de regla:** se agrega un **catálogo global** `tipos_regla` (una sola tabla con
  columna discriminadora `clase` = `'descuento'` | `'recargo'`), sembrado por el sistema
  (ej. descuentos: pronto pago, al por mayor; recargos: interés simple, interés compuesto).
  Cada fila lleva un `codigo` estable para que el motor de precios (fase 9) ramifique su
  cálculo. **`descuentos` y `recargos` referencian su tipo con FK `tipo_regla_id` NOT NULL**;
  el service valida que el `clase` del tipo coincida (un descuento solo acepta tipos
  `clase='descuento'`). El tenant no edita este catálogo (CRUD = fase superadmin posterior).
- **Porcentajes/dinero:** `numeric` ↦ string en JS, Decimal.js para operar, porcentajes en
  decimal (`0.19` = 19%).

## Scope / Out of scope

**In:** 5 catálogos por tenant (backend módulos + frontend páginas + seed + docs), tabla nueva
`metodo_pago_pais`, guards (`JwtAuthGuard` + `TenantGuard`, mutaciones con `TenantAdminGuard`),
tests unitarios de cada service.

**Out:** evaluación de condiciones/vigencia de descuentos/recargos; CRUD superadmin del
catálogo global de métodos de pago; asociación item↔regla (punto 8); cálculo de precios
(punto 9).

---

## Estrategia de subagentes (3 grupos por afinidad)

Cada agente entrega los archivos **dentro de su propio directorio de módulo + página(s) +
spec**. NO toca `app.module.ts`, `seeder.*`, `configuracion.vue`, `startup-pos.sql` ni docs.

- **Grupo A — `categorias` + `impuestos`** (CRUD simple, single-table por tenant).
- **Grupo B — `descuentos` + `recargos` + `tipos-regla`** (forma idéntica; comparten enums
  `ModoRegla` / `CondicionTipo` en `src/common/enums/reglas.enums.ts`; el módulo read-only
  `tipos-regla` provee el selector de tipo).
- **Grupo C — `metodos-pago`** (estilo monedas: 3 entities, SQL raw con joins país, toggle).

El orquestador integra los archivos compartidos tras recibir los 3 grupos.

---

## Backend

Patrón base (todos): `docs/patterns/backend.md`. Estructura por módulo en
`backend/src/modules/<feature>/` con `entities/`, `dto/`, `<f>.service.ts`,
`<f>.service.spec.ts`, `<f>.controller.ts`, `<f>.module.ts`. Guards de clase
`@UseGuards(JwtAuthGuard, TenantGuard)`; mutaciones `@UseGuards(TenantAdminGuard)`. `tenantId`
siempre de `req.user`. Soft delete (`@DeleteDateColumn name: 'eliminado_el'`), columnas UUID
con `type: 'uuid'`.

### Grupo A — categorías + impuestos

**`categorias`** (tabla `categorias`: `categoria_id`, `tenant_id`, `nombre`,
`aplica_a` `'productos'|'servicios'|'ambos'` default `'ambos'`, `activo`):
- Entity `Categoria` con `@PrimaryGeneratedColumn('uuid')`.
- DTOs: create (`nombre` requerido, `aplicaA` `@IsIn(['productos','servicios','ambos'])`,
  `activo?`), update (todo `@IsOptional`).
- Service repo-based (sin joins): `findAll(tenantId)`, `create`, `update`, `remove`
  (soft delete + valida pertenencia al tenant, como `items.remove` en migración).
- Controller: `GET /categorias`, `POST /categorias`, `PATCH /categorias/:id`,
  `DELETE /categorias/:id`.

**`impuestos`** (tabla `impuestos`: `impuesto_id`, `tenant_id`, `nombre`,
`porcentaje` `numeric(7,4)` decimal, `activo`):
- Misma estructura CRUD. `porcentaje` como `string` (`@IsNumberString`), validar `> 0` con
  Decimal.js en el service (`BadRequestException` si inválido).
- Endpoints: `GET/POST /impuestos`, `PATCH/DELETE /impuestos/:id`.

### Grupo B — descuentos + recargos

Tablas idénticas (`descuentos`/`recargos`): `nombre`, `modo` (`modo_regla`),
`valor` `numeric(18,4)`, `tipo_regla_id` UUID NOT NULL (FK a `tipos_regla`),
`condicion_tipo` (`condicion_tipo`, default `'ninguna'`), `condicion_valor` text null,
`fecha_inicio`/`fecha_fin` date null, `activo`.

- Enums compartidos en `src/common/enums/reglas.enums.ts`:
  `ModoRegla` (`porcentaje`, `monto_fijo`), `CondicionTipo` (`ninguna`, `customer`,
  `producto`, `categoria`, `fecha`, `metodo_pago`, `vencimiento`, `monto_minimo`,
  `cantidad_minima`).
- **Módulo `tipos-regla`** (catálogo global read-only): entity `TipoRegla` (tabla
  `tipos_regla`: `tipo_regla_id`, `clase` `'descuento'|'recargo'`, `codigo` único, `nombre`,
  `descripcion?`, `activo`). Controller `GET /tipos-regla?clase=descuento|recargo`
  (`JwtAuthGuard`), service filtra por `clase` + `activo` + `eliminado_el IS NULL`. Sin
  mutaciones (se siembra).
- Dos módulos espejo (`descuentos/`, `recargos/`) con entity + DTOs + service + controller
  + spec idénticos salvo nombre de tabla/columna PK.
- DTO: `tipoReglaId` `@IsUUID` **requerido**, `modo` `@IsEnum(ModoRegla)`, `valor`
  `@IsNumberString`, `condicionTipo` `@IsEnum(CondicionTipo)` `@IsOptional` (default
  `'ninguna'`), `condicionValor?` string, `fechaInicio?`/`fechaFin?` `@IsDateString
  @IsOptional`.
- Service repo-based CRUD (igual que Grupo A) + **validar** que el tipo exista y que
  `tipo.clase` coincida con la entidad (`BadRequestException` si un descuento referencia un
  tipo `clase='recargo'` o viceversa). Sin lógica de evaluación de condiciones.
- Endpoints: `GET/POST /descuentos`, `PATCH/DELETE /descuentos/:id`; ídem `/recargos`;
  `GET /tipos-regla`.

### Grupo C — métodos de pago (espejo de monedas)

Entities (en `modules/metodos-pago/entities/`):
- `MetodoPago` (tabla global `metodos_pago`: `metodo_pago_id`, `nombre`, `abreviatura`,
  `activo`).
- `MetodoPagoPais` (**tabla nueva** `metodo_pago_pais`, PK compuesta `pais_id` +
  `metodo_pago_id`, soft delete) — espejo de `PaisMoneda`.
- `TenantMetodoPago` (tabla `tenant_metodo_pago`, PK compuesta `tenant_id` +
  `metodo_pago_id`, `permite_vuelto` bool, `habilitada` bool) — espejo de `TenantMoneda`.

Service (espejo de `monedas.service.ts`):
- `findMetodosPago(tenantId)`: SQL raw `dataSource.query` uniendo
  `tenants → provincia → pais → metodo_pago_pais → metodos_pago` + LEFT JOIN
  `tenant_metodo_pago` (filtrando `eliminado_el IS NULL` en cada join). Mapear filas
  `snake_case` → objeto camelCase (`metodoPagoId`, `nombre`, `abreviatura`, `habilitada`,
  `permiteVuelto`).
- `updateMetodoPago(tenantId, metodoPagoId, dto)`: dentro de `dataSource.transaction`, upsert
  con restauración de soft-deleted (patrón `upsertRow` de monedas) para setear
  `habilitada` / `permiteVuelto`.

Controller: `GET /metodos-pago` (TenantGuard), `PATCH /metodos-pago/:metodoPagoId`
(TenantAdminGuard, body `{ habilitada?, permiteVuelto? }`). Sin concepto default/preferida.

---

## Integración (orquestador — archivos compartidos)

- [ ] **`startup-pos.sql`**:
  - Agregar tabla `metodo_pago_pais` (espejo de `pais_moneda`):
    ```sql
    CREATE TABLE "metodo_pago_pais" (
      "pais_id"        UUID        NOT NULL REFERENCES "pais" ("pais_id"),
      "metodo_pago_id" UUID        NOT NULL REFERENCES "metodos_pago" ("metodo_pago_id"),
      "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "actualizado_el" TIMESTAMPTZ,
      "eliminado_el"   TIMESTAMPTZ,
      PRIMARY KEY ("pais_id", "metodo_pago_id")
    );
    ```
  - Agregar catálogo global `tipos_regla`:
    ```sql
    CREATE TABLE "tipos_regla" (
      "tipo_regla_id"  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      "clase"          TEXT        NOT NULL,   -- 'descuento' | 'recargo'
      "codigo"         TEXT        NOT NULL UNIQUE,
      "nombre"         TEXT        NOT NULL,
      "descripcion"    TEXT,
      "activo"         BOOLEAN     NOT NULL DEFAULT true,
      "creado_el"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "actualizado_el" TIMESTAMPTZ,
      "eliminado_el"   TIMESTAMPTZ
    );
    ```
  - Agregar columna `"tipo_regla_id" UUID NOT NULL REFERENCES "tipos_regla" ("tipo_regla_id")`
    a las tablas `descuentos` y `recargos`.
- [ ] **`app.module.ts`**: registrar entities (`Categoria`, `Impuesto`, `Descuento`,
  `Recargo`, `TipoRegla`, `MetodoPago`, `MetodoPagoPais`, `TenantMetodoPago`) en el array
  `entities` y los 6 módulos (`CategoriasModule`, `ImpuestosModule`, `DescuentosModule`,
  `RecargosModule`, `TiposReglaModule`, `MetodosPagoModule`) en `imports`.
- [ ] **`seeder.service.ts` + `seeder.module.ts`** (IDs fijos desde `...440100`):
  - `seedMetodosPago()` — catálogo global (efectivo, tarjeta, transferencia…).
  - `seedMetodoPagoPais()` — vincular métodos a los países sembrados.
  - `seedTiposRegla()` — catálogo global de tipos (descuentos: `pronto_pago`, `por_mayor`,
    `rango_fechas`; recargos: `interes_simple`, `interes_compuesto`), con `clase` y `codigo`.
  - `seedCategorias()` / `seedImpuestos()` / `seedDescuentos()` / `seedRecargos()` — datos demo
    para el tenant de desarrollo (los descuentos/recargos demo referencian un `tipo_regla_id`
    sembrado; `seedTiposRegla()` debe correr antes).
  - `seedTenantMetodosPago()` — habilitar para el tenant demo los métodos disponibles en su
    país (coherente con el auto-habilitado de `create()`).
  - Registrar entities en `seeder.module.ts` (`forFeature`) y añadir las llamadas en
    `onApplicationBootstrap` en orden (métodos globales y país antes de datos de tenant).
- [ ] **`tenants.service.ts → create()`**: al crear el tenant, **habilitar automáticamente**
  los métodos de pago disponibles en su país (igual que ya habilita la moneda oficial). Dentro
  de la transacción, tras resolver el `pais_id` del tenant (vía `provincia`), insertar en
  `tenant_metodo_pago` una fila por cada `metodo_pago_pais` del país con `habilitada = true`
  (`permite_vuelto` default `false`), usando `ON CONFLICT (tenant_id, metodo_pago_id) DO NOTHING`.
  El admin luego puede deshabilitar o ajustar `permite_vuelto` en pantalla.

---

## Frontend

Patrón base: `docs/patterns/frontend.md`. Páginas en
`frontend/app/pages/configuracion/`. `useApiFetch` para API, sin store, update optimista con
revert, errores vía `e.data.message` en `useToast`, `useRuntimeConfig().public.apiUrl`.

- [ ] **`configuracion.vue`**: agregar 5 items al computed `navItems` dentro del bloque
  `permissionsStore.esAdmin` (iconos heroicons: `i-heroicons-tag` categorías,
  `i-heroicons-receipt-percent` impuestos, `i-heroicons-arrow-trending-down` descuentos,
  `i-heroicons-arrow-trending-up` recargos, `i-heroicons-credit-card` métodos de pago).

- [ ] **`categorias.vue`, `impuestos.vue`, `descuentos.vue`, `recargos.vue`** — patrón CRUD de
  `razones-sociales.vue`: lista en `UCard`, modal crear/editar (`UModal` +
  `UFormField`/`UInput`/`USelectMenu`), modal de confirmación de borrado, toggle `activo`
  optimista (`USwitch`), re-`cargar()` tras crear/editar/borrar.
  - descuentos/recargos: form completo con **`tipoReglaId` (`USelectMenu` obligatorio,
    poblado desde `GET /tipos-regla?clase=descuento|recargo`)**, `modo` (select), `valor`,
    `condicionTipo` (select), `condicionValor`, `fechaInicio`/`fechaFin` (date), `activo`.
- [ ] **`metodos-pago.vue`** — patrón de `monedas.vue` (solo lectura + toggles, sin modal de
  alta): lista con `USwitch` `habilitada` y `USwitch` `permiteVuelto` por método, ambos con
  update optimista + revert.

---

## Verification

**Backend** (`cd backend`):
- [ ] `npm test` — specs de los 5 services en verde (un test por regla de negocio + happy path).
- [ ] `npx tsc --noEmit` limpio.
- [ ] `npm run lint` sin errores.

**End-to-end** (`docker-compose up`):
- [ ] El seeder corre sin error y crea catálogo global de métodos + `metodo_pago_pais` + datos
  demo. Verificar en Swagger (`3000/api/docs`) o `curl` con token:
  `GET /categorias`, `/impuestos`, `/descuentos`, `/recargos`, `/metodos-pago` devuelven datos
  del tenant.
- [ ] `metodos-pago` solo lista los métodos disponibles en el país del tenant (verificar el
  join país filtra correctamente).

**Frontend** (login como admin del tenant):
- [ ] Cada `/configuracion/<catálogo>`: ver datos, crear/editar/eliminar (A y B), toggles con
  revert ante error simulado (todos), y que los `message` de reglas del backend aparezcan en
  toasts.

**Docs vivas** (mismo cambio):
- [ ] `docs/features/<feature>.md` (desde TEMPLATE) + link en `docs/README.md`.
- [ ] `docs/MIGRACION-FUNCIONALIDADES.md` (fila punto 7 → ✅) y tabla "Estado actual" de
  `CLAUDE.md`.

## Open questions

- Ninguna pendiente.
