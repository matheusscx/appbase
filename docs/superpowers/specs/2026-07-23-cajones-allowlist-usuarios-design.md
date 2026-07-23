# Allow-list de autorización cajón ↔ usuario (Configuración → Cajas) — Design Spec

**Fecha:** 2026-07-23
**Estado:** ✅ Aprobado por el owner — listo para plan de implementación
**Sub-proyecto:** 2 de 3 del refactor general de caja
**Investigación:** [`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](../../agent/investigaciones/2026-07-23-gestion-caja.md) (§9 el roadmap)
**Depende de:** sub-proyecto 1 (entidad `cajones`, ya implementado) — [`2026-07-23-cajones-definicion-admin-design.md`](2026-07-23-cajones-definicion-admin-design.md)
**Feature relacionada:** [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md)

---

## Contexto

El sub-proyecto 1 entregó la **definición de cajones** (el mueble físico: entidad `cajones`,
CRUD admin en Configuración → Cajas). Hoy los cajones son inertes: nadie los "usa" al abrir
caja.

Este sub-proyecto (2 de 3) agrega la **autorización**: el admin define **qué usuarios pueden
abrir qué cajones** — un allow-list N‑a‑N ("puede abrir", no amarre 1‑a‑1). Convive con el
permiso RBAC `MiCaja:Crear` (que dice "puede operar caja"); el allow-list dice "en cuáles
cajones". Los dos ejes son **ortogonales** y se cruzan recién al abrir sesión (sub-proyecto 3).

**Alcance = solo la definición del allow-list** (simétrico al sub-1). El *enforcement* al
abrir caja **no está en este sub-proyecto**: la sesión (tabla `cajas`) todavía no conoce el
cajón (`cajon_id`), eso llega en el sub-proyecto 3. Este entregable es la estructura + su
gestión admin + tests; es testeable por sí solo aunque no tenga efecto visible al cajero
hasta el sub-3.

## Terminología (crítico — no mezclar)

| Concepto | Tabla | Nombre en código |
|---|---|---|
| El mueble físico | `cajones` (sub-1) | `Cajon` |
| **La habilitación cajón↔usuario** | `cajon_usuario` (**nueva**) | `CajonUsuario` |
| El turno/sesión de dinero | `cajas` (**sin cambios acá**) | `Caja` |

## Alcance

**Incluido:**
- Entidad/tabla `cajon_usuario` (mapeo N‑a‑N tenant-owned, soft delete).
- Endpoints para leer y **reemplazar** el conjunto de usuarios habilitados de un cajón,
  gateados por permisos RBAC del módulo `Cajas` (`Leer`/`Actualizar`).
- Gestión desde el frontend: acción "Usuarios" por cajón en Configuración → Cajas (drawer
  con checkboxes de los usuarios del tenant).
- Tests unit + e2e; docs actualizadas.

**Fuera de alcance (sub-proyecto 3 / features diferidas):**
- Enforcement al abrir: `cajon_id` en la sesión, elegir un cajón autorizado y libre,
  unicidad de sesión por cajón → sub-proyecto 3.
- Bypass del admin `es_fijo` en la apertura (se resuelve donde se enforce, sub-3).
- Impedir borrar/desactivar un cajón con habilitaciones → no aplica: al soft-borrar un cajón
  (sub-1) sus filas `cajon_usuario` quedan colgadas pero inertes; el sub-3 las ignora al no
  poder abrir sobre un cajón borrado. No se agrega cascada en este sub-proyecto (YAGNI).

## Modelo de datos

**Tabla `cajon_usuario`:**

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `cajon_usuario_id` | UUID | PK | `@PrimaryGeneratedColumn('uuid')` |
| `cajon_id` | UUID | NOT NULL, FK → `cajones(cajon_id)` | el mueble |
| `usuario_id` | UUID | NOT NULL, FK → `usuarios(usuario_id)` | el habilitado |
| `tenant_id` | UUID | NOT NULL | del token, nunca del body |
| `creado_el` | TIMESTAMPTZ | NOT NULL | `@CreateDateColumn` |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL | `@UpdateDateColumn` |
| `eliminado_el` | TIMESTAMPTZ | nullable | `@DeleteDateColumn` (soft delete) |

**Índice único parcial:** `(cajon_id, usuario_id) WHERE eliminado_el IS NULL` — una misma
habilitación no se repite entre filas vivas. (Al quitar y volver a habilitar, se soft-borra y
se crea una fila nueva; el índice parcial lo permite.)

## Regla de la lista vacía (semántica del dato)

**Permisivo (opt-in):** un cajón **sin usuarios habilitados** = abierto a **cualquiera con
`MiCaja:Crear`**. El allow-list solo restringe cuando tiene **al menos un** usuario asignado.
Preserva el comportamiento actual (nadie queda bloqueado sin querer) y hace del allow-list un
ajuste que se aprieta cuando el admin quiere. El "Mostrador" sembrado (sin asignados) sigue
usable cuando el sub-3 aterrice.

Esta regla **define el significado del dato**; se **hará valer en el sub-proyecto 3** (al
abrir). En este sub-proyecto no hay enforcement — solo se persiste el mapeo.

## Backend

**Se extiende el módulo `cajones`** (controller + service + entidad, del sub-1). No se crea un
módulo nuevo: misma responsabilidad (administrar el cajón y su config).

**Controller** — dos endpoints nuevos en `CajonesController`, clase ya bajo
`@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`:

| Método | Ruta | Permiso | Acción | Respuestas |
|---|---|---|---|---|
| `GET` | `/cajones/:id/usuarios` | `Cajas:Leer` | IDs de usuarios habilitados en el cajón | 200 `string[]` · 404 cajón inexistente |
| `PUT` | `/cajones/:id/usuarios` | `Cajas:Actualizar` | **Reemplaza** el conjunto con `{ usuarioIds }` | 200 `string[]` (set resultante) · 404 · 400 usuarioId inválido/ajeno |

**DTO** (`class-validator`):
- `SetCajonUsuariosDto` — `{ usuarioIds: string[] }` (`@IsArray`, `@IsUUID('4', { each: true })`).
  Array vacío es válido (deja el cajón sin asignados → permisivo).

**Service** — método `setUsuarios(tenantId, cajonId, usuarioIds)`:
1. Verifica que el cajón existe y es del tenant (404 si no).
2. Valida que **todos** los `usuarioIds` pertenecen al tenant, en **una sola query**
   (`WHERE usuario_id = ANY($1) AND tenant_id = ...`); si alguno no matchea → **400**.
3. Calcula el diff contra las filas vivas actuales del cajón: soft-delete de las que salieron,
   alta de las que entraron, deja intactas las que siguen. **En una transacción.**
4. Devuelve el set resultante de `usuarioIds`.
- Método `getUsuarios(tenantId, cajonId)`: valida cajón del tenant (404), devuelve los
  `usuarioIds` vivos. Sin N+1 (una query).
- Toda query filtra `eliminado_el IS NULL`. `tenant_id` del token.

## Reglas de negocio

1. `tenant_id` siempre del token (invariante).
2. El `usuario_id` habilitado **debe pertenecer al tenant** → 400 si se cuela uno ajeno.
3. **Soft delete**: quitar una habilitación marca `eliminado_el`; nunca borrado físico. Toda
   lectura filtra `eliminado_el IS NULL`.
4. **No se exige** que el usuario tenga `MiCaja:Crear` al habilitarlo: allow-list y RBAC son
   ortogonales; se cruzan al abrir (sub-3). Se puede pre-autorizar.
5. Lista vacía = permisivo (ver sección dedicada). Se hace valer en el sub-3.
6. El `PUT` es idempotente: reenviar el mismo conjunto no cambia nada (el diff queda vacío).

## Frontend

**Página** `configuracion/cajas.vue` (la del sub-1): cada fila de cajón suma una acción
**"Usuarios"** (ícono, junto a editar/borrar) que abre un `AppDrawer` con la lista de usuarios
**activos del tenant** como checkboxes; los habilitados vienen marcados (de `GET
/cajones/:id/usuarios`). Guardar → `PUT /cajones/:id/usuarios` con el conjunto marcado.

- Los usuarios del tenant se obtienen del endpoint de config de Usuarios ya existente (se
  reutiliza; no se crea uno nuevo).
- Se muestran **todos** los usuarios activos (no se filtra por `MiCaja:Crear`): allow-list y
  RBAC son ortogonales y el permiso puede cambiar.
- La acción se gatea con `can('Cajas','Actualizar')` (UX; el backend enforcea igual).
- `useApiFetch`, tokens semánticos de Nuxt UI (sin Tailwind hardcodeado), sin lógica de
  negocio en la página.

## Testing

- **Unit** (`cajones.service.spec.ts`, casos de `setUsuarios`/`getUsuarios`): `PUT` crea el
  set inicial; reenviar un set distinto hace el diff correcto (quita/agrega/conserva);
  rechaza (400) un `usuarioId` de otro tenant; quitar hace soft-delete; reenviar el mismo set
  es idempotente (sin cambios); `getUsuarios`/`setUsuarios` sobre cajón inexistente → 404.
- **E2E** (`cajones.e2e-spec.ts` o `cajon-usuarios.e2e-spec.ts`): admin asigna 2 usuarios a un
  cajón y `GET` los devuelve; reemplaza el set (agrega uno, quita otro) y refleja el diff;
  vendedor sin `Cajas:Actualizar` → 403 en `PUT`; aislamiento multi-tenant (no se puede
  asignar un usuario de otro tenant → 400; no se ve el mapeo de otro tenant).

## Seed

Opcional/mínimo. El "Mostrador" sembrado queda **sin asignados** (permisivo), lo que ya es un
estado válido y representativo. Si se quiere un dato demo de allow-list no vacío, habilitar el
usuario admin del tenant en su "Mostrador" (UUIDs fijos, patrón `550e8400-…-446655440XXX`,
siguiente libre tras `440290`). Decisión final en el plan; no es requisito de la feature.

## Docs a actualizar (mismo commit que el código)

- `docs/features/gestion-cajas.md` — sección del allow-list (entidad, endpoints, regla de
  lista vacía, ortogonalidad con `MiCaja:Crear`).
- `docs/ESTADO.md` — fila de la feature.
- `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9 — marcar sub-proyecto 2 con
  enlace a esta spec y su avance.
- `startup-pos.sql` — `CREATE TABLE "cajon_usuario"` + índice único parcial, cerca de `cajones`.

## Criterios de aceptación

- [ ] Tabla `cajon_usuario` con FKs a `cajones`/`usuarios`, soft delete e índice único parcial
  `(cajon_id, usuario_id) WHERE eliminado_el IS NULL`.
- [ ] `GET /cajones/:id/usuarios` (`Cajas:Leer`) devuelve los `usuarioIds` habilitados.
- [ ] `PUT /cajones/:id/usuarios` (`Cajas:Actualizar`) reemplaza el conjunto (diff:
  quita/agrega/conserva) en una transacción, sin N+1; array vacío válido.
- [ ] `usuario_id` ajeno al tenant → 400; cajón inexistente → 404.
- [ ] `tenant_id` siempre del token; soft delete; toda lectura filtra `eliminado_el IS NULL`.
- [ ] Página `configuracion/cajas.vue`: acción "Usuarios" por cajón con drawer de checkboxes;
  gateada por `Cajas:Actualizar`.
- [ ] Unit + e2e verdes; usuario sin `Cajas:Actualizar` → 403; aislamiento multi-tenant.
- [ ] Docs actualizadas (gestion-cajas.md, ESTADO.md, §9, startup-pos.sql).
- [ ] Sin tocar la tabla `cajas`, el `caja.controller/service`, ni agregar enforcement al
  abrir (eso es sub-3).
