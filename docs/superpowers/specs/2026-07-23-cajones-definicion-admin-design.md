# Definición de cajones (Configuración → Cajas) — Design Spec

**Fecha:** 2026-07-23
**Estado:** ✅ Aprobado por el owner — listo para plan de implementación
**Sub-proyecto:** 1 de 3 del refactor general de caja
**Investigación:** [`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](../../agent/investigaciones/2026-07-23-gestion-caja.md) (§8.1 el hallazgo, §9 el roadmap)
**Feature relacionada:** [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md)

---

## Contexto

Hoy la tabla `cajas` **conflaciona contenedor y sesión** (investigación §8.1): cada `abrir`
inserta una fila que es a la vez "el cajón" y "el turno de dinero". No existe el **cajón
físico** (el mueble: Mostrador, Delivery, Barra) como entidad propia.

El refactor general (roadmap §9) introduce el cajón físico como entidad y separa **definir**
(config del admin) de **operar** (`MiCaja`) y **supervisar** (`Cajas`). Se divide en tres
sub-proyectos; **este es el 1: la definición de cajones**, la base sobre la que se montan los
otros dos.

Modelo acordado (del brainstorming):
- El **admin define** los cajones físicos del tenant.
- El **admin autoriza** qué usuarios abren qué cajones (**allow-list**, sub-proyecto 2).
- Un cajón físico: máx. una sesión abierta; un cajero: máx. una sesión abierta (sub-proyecto 3).

Este sub-proyecto entrega **solo la definición** (CRUD de cajones): entidad, config de admin,
sin vínculo aún con las sesiones. Es entregable y testeable por sí solo.

## Terminología (crítico — no mezclar)

| Concepto | Tabla | Nombre en código | Etiqueta UI |
|---|---|---|---|
| El mueble físico (Mostrador, Delivery) | `cajones` (**nueva**) | `Cajon` | "Cajas" (Configuración) |
| El turno/sesión de dinero (abrir→cerrar) | `cajas` (**existente, sin cambios acá**) | `Caja` | "Mi caja" / "Cajas" |

El código distingue `cajones` ≠ `cajas` para evitar ambigüedad; la UI usa "Cajas" porque es
como el owner los nombra. Este sub-proyecto **no toca** la tabla `cajas` ni los módulos
`MiCaja`/`Cajas` (el vínculo `cajon_id` en la sesión llega en el sub-proyecto 3).

## Alcance

**Incluido:**
- Entidad/tabla `cajones` (tenant-owned).
- CRUD de cajones desde configuración, gateado por **permisos RBAC del módulo `Cajas`** (Leer/Crear/Actualizar/Eliminar): crear, listar, renombrar, activar/desactivar, borrar (soft).
- Unicidad de `nombre` por tenant.
- Seed de un cajón demo por tenant existente.
- Página `configuracion/cajas.vue`.
- Tests unit + e2e; docs actualizadas.

**Fuera de alcance (otros sub-proyectos / features):**
- Autorización "qué usuario abre qué cajón" (allow-list) → sub-proyecto 2.
- La sesión abriendo sobre un cajón, unicidad por cajón, terminología de la sesión → sub-proyecto 3.
- Impedir borrar/desactivar un cajón con sesión abierta → sub-proyecto 3 (no hay vínculo aún).
- Modelo del esperado (§3), cierre forzado (§6), blind count (§5) → features diferidas.

## Modelo de datos

**Tabla `cajones`:**

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `cajon_id` | UUID | PK | `@PrimaryGeneratedColumn('uuid')` |
| `tenant_id` | UUID | NOT NULL | del token, nunca del body |
| `nombre` | TEXT | NOT NULL | ej. "Mostrador", "Caja 1" |
| `activo` | BOOLEAN | NOT NULL, default `true` | desactivar sin borrar |
| `creado_el` | TIMESTAMPTZ | NOT NULL | `@CreateDateColumn` |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL | `@UpdateDateColumn` |
| `eliminado_el` | TIMESTAMPTZ | nullable | `@DeleteDateColumn` (soft delete) |

**Índice único parcial:** `(tenant_id, nombre) WHERE eliminado_el IS NULL` — `nombre` único
por tenant entre cajones no borrados.

## Backend

**Módulo standalone** `src/modules/cajones/` (controller + service + entity + DTOs),
registrado en `app.module.ts`. No se mete en `caja`: distinta responsabilidad (definir el
mueble ≠ operar la sesión) y distintas rutas, aunque ambos usen `PermisosGuard`.

**Gobierno de permisos — extiende el módulo `Cajas` existente.** En vez de un guard
admin-only (`TenantAdminGuard`), el CRUD se gatea con el módulo RBAC `Cajas` (el mismo de la
supervisión de sesiones, creado en el refactor 2026-07-23). Hoy `Cajas` solo tiene `Leer`;
se le agregan `Crear`/`Actualizar`/`Eliminar` (asociaciones `modulo_app_permiso`). Así:
`Cajas:Leer` = supervisar sesiones **+** ver cajones; `Cajas:Crear|Actualizar|Eliminar` =
definir cajones. Operar la sesión sigue owner-only bajo `MiCaja` (sin cambios). El admin
`es_fijo` obtiene todos los permisos de `Cajas` por short-circuit.

**Controller** `@Controller('cajones')`, clase bajo `@UseGuards(JwtAuthGuard, TenantGuard,
PermisosGuard)`; cada endpoint con `@RequiresPermiso('Cajas', <permiso>)`:

| Método | Ruta | Permiso | Acción | Respuestas |
|---|---|---|---|---|
| `GET` | `/cajones` | `Cajas:Leer` | Lista cajones del tenant (activos + inactivos) | 200 `Cajon[]` |
| `POST` | `/cajones` | `Cajas:Crear` | Crea `{ nombre }` | 201 `Cajon` · 409 nombre duplicado |
| `PATCH` | `/cajones/:id` | `Cajas:Actualizar` | Renombra y/o togglea `activo` | 200 `Cajon` · 404 · 409 duplicado |
| `DELETE` | `/cajones/:id` | `Cajas:Eliminar` | Soft delete (`eliminado_el = now()`) | 200 · 404 |

**DTOs** (`class-validator`):
- `CreateCajonDto` — `{ nombre: string }` (`@IsString`, `@IsNotEmpty`, `@MaxLength(60)`).
- `UpdateCajonDto` — `{ nombre?: string; activo?: boolean }` (`@IsOptional` en ambos).

**Service** — métodos: `findAll(tenantId)`, `create(tenantId, dto)`, `update(tenantId, id, dto)`,
`remove(tenantId, id)`. Toda query filtra `eliminado_el IS NULL`. `tenant_id` del token.

## Reglas de negocio

1. `nombre` obligatorio; **único por tenant** entre no-borrados → **409** al repetir (en
   create y en rename).
2. `tenant_id` siempre del token (invariante).
3. **Soft delete**: `DELETE` marca `eliminado_el`; nunca borrado físico. Toda lectura filtra
   `eliminado_el IS NULL`.
4. `activo` es independiente del soft delete: un cajón inactivo sigue existiendo y listándose
   en la gestión (para reactivarlo); recién en el sub-proyecto 3 `activo=false` impide abrir
   sesión.
5. *(Forward, no en este sub-proyecto)*: no borrar/desactivar un cajón con sesión abierta —
   se agrega cuando la sesión referencia al cajón (sub-proyecto 3).

## Seed

Dos cosas en `seeder.service.ts` (UUIDs fijos, patrón `550e8400-e29b-41d4-a716-446655440XXX`,
libres: 286, 287, 288, 289, 290):

1. **Permisos RBAC** — agregar al array `modulo_app_permiso` las asociaciones del módulo
   `Cajas` (`...440282`) con `Crear` (`...440013`), `Actualizar` (`...440014`) y `Eliminar`
   (`...440015`), con IDs `...440288`/`...440289`/`...440290`. `Cajas:Leer` (`...440283`) y
   los `tenant_modulos` de `Cajas` (Paris `...440284`, Falabella `...440285`) ya existen.
2. **Datos demo** — un cajón por tenant existente (Paris `...440286`, Falabella `...440287`),
   nombre "Mostrador".

Todo idempotente como el resto del seed (no duplica si ya existe).

## Frontend

**Página** `pages/configuracion/cajas.vue` (patrón de las demás páginas planas de
`configuracion/`): tabla Nuxt UI de cajones + modal crear/editar (campo `nombre`) + toggle
`activo` + acción borrar (con confirmación). Acceso a datos con store (`stores/cajones.ts`) o
composable (`useCajones`) siguiendo el patrón de config existente — se decide en el plan.

**Sidebar:** entrada "Cajas" dentro de Configuración, visible con `esAdmin || can('Cajas',
'Leer')` (patrón de Salones/Impresoras). Los botones de escritura (Nueva/editar/borrar) se
gatean con `can('Cajas','Crear'|'Actualizar'|'Eliminar')` — UX, no reemplaza el guard del
backend. Tokens semánticos de Nuxt UI (sin Tailwind hardcodeado).

## Testing

- **Unit** (`cajones.service.spec.ts`): crear OK; nombre duplicado → 409; soft delete marca
  `eliminado_el` y desaparece de `findAll`; aislamiento por tenant (un tenant no ve cajones de
  otro); `update` renombra y togglea `activo`.
- **E2E** (`cajones.e2e-spec.ts`): CRUD completo como admin; **403** en create/update/delete
  con usuario no-admin; aislamiento multi-tenant (crear en tenant A, no aparece en B).

## Docs a actualizar (mismo commit que el código)

- `docs/features/gestion-cajas.md` — sección "Definición de cajones" (entidad, endpoints,
  reglas) + nota de terminología `cajones` vs `cajas`.
- `docs/ESTADO.md` — fila de la feature.
- `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9 — marcar sub-proyecto 1 con
  enlace a esta spec (hecho al crear la spec) y su avance.

## Criterios de aceptación

- [ ] Tabla `cajones` con soft delete e índice único parcial `(tenant_id, nombre)`.
- [ ] `GET/POST/PATCH/DELETE /cajones` funcionando, gateados por `@RequiresPermiso('Cajas', Leer/Crear/Actualizar/Eliminar)` + `PermisosGuard`.
- [ ] El módulo `Cajas` extendido con `Crear`/`Actualizar`/`Eliminar` (seed `modulo_app_permiso` `...440288/289/290`).
- [ ] `nombre` único por tenant → 409 en create y rename.
- [ ] `tenant_id` siempre del token; nunca del body.
- [ ] Soft delete; toda lectura filtra `eliminado_el IS NULL`.
- [ ] Seed de un cajón por tenant existente (Paris `...440286`, Falabella `...440287`).
- [ ] Página `configuracion/cajas.vue` con tabla + crear/editar/activar/borrar; nav y botones gateados por `Cajas`.
- [ ] Unit + e2e verdes; usuario sin `Cajas` recibe 403; aislamiento multi-tenant verificado.
- [ ] Docs actualizadas (gestion-cajas.md, ESTADO.md, §9 de la investigación).
