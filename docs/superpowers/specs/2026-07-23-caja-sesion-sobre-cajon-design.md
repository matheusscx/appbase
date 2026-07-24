# Sesión de caja sobre un cajón (apertura autorizada y libre) — Design Spec

**Fecha:** 2026-07-23
**Estado:** ✅ Aprobado por el owner — listo para plan de implementación
**Sub-proyecto:** 3 de 3 del refactor general de caja
**Investigación:** [`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](../../agent/investigaciones/2026-07-23-gestion-caja.md) (§9 el roadmap)
**Depende de:** sub-proyecto 1 (entidad `cajones`) y sub-proyecto 2 (allow-list `cajon_usuario`), ambos implementados.
**Feature relacionada:** [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md)

---

## Contexto

Los sub-proyectos 1 y 2 entregaron la **definición de cajones** (el mueble físico) y el
**allow-list** (qué usuarios pueden abrir qué cajones). Ambas piezas son hoy **inertes**: la
sesión de caja (tabla `cajas`) no conoce el cajón, así que nada consulta el allow-list ni la
existencia del cajón al abrir.

Este sub-proyecto (3 de 3, cierra la estructura del refactor) conecta las piezas: la **sesión
gana `cajon_id`** y la apertura pasa a validar **autorizado** (allow-list, que recién acá se
hace valer) **+ libre** (sin otra sesión abierta en ese cajón) **+ activo**. Con esto el cajón
deja de ser inerte.

**Terminología:** se resolvió **no renombrar** nada. La terminología quedó consistente en
sub-1/sub-2 (`cajones` = mueble físico, `cajas` = sesión/turno, superficies `MiCaja`/`Cajas`);
un rename de la tabla `cajas` sería un refactor amplio y riesgoso sin beneficio real. Solo se
**muestra** el nombre del cajón donde haga falta.

## Recordatorio del dominio (para no romper invariantes)

- **Caja `física`:** la abre un cajero manualmente (saldo inicial), opera un turno, la cierra
  con arqueo. Regla actual: **una abierta por tenant+usuario**. Es la que se abre *sobre* un
  cajón.
- **Caja `virtual`:** una por tenant, siempre abierta, para el canal `online`. **No tiene
  mueble** → `cajon_id` queda **null**. No pasa por `abrir`.
- El motor de precios, `movimientos_inventario` y el sistema JWT **no se tocan**.

## Alcance

**Incluido (núcleo + dos extras de integridad aprobados):**
- `cajon_id` en `cajas` (nullable; física lo lleva, virtual null) + índice único parcial (una
  sesión abierta por cajón).
- `abrir` valida **autorizado + libre + activo**; `cajonId` **obligatorio** para abrir física.
- Endpoint del picker: cajones disponibles para el usuario (activos + autorizados + libres).
- **Integridad:** bloquear soft-delete/desactivar un cajón con sesión abierta → 409.
- **Supervisión/Mi caja:** mostrar el nombre del cajón de cada sesión.

**Fuera de alcance (features de negocio diferidas, §9):**
- Modelo del "esperado" (efectivo vs. arqueo multi-medio) → §3 diferido.
- Cierre forzado + `cerrada_por` → §6 diferido.
- Blind count / motivos de diferencia → §5 diferido.
- Rename terminológico de la tabla `cajas` → descartado (ver Contexto).
- Backfill de cajas abiertas preexistentes sin `cajon_id` → no se hace (cierran normalmente;
  dev usa `synchronize`, sin migración).

## Modelo de datos

**Tabla `cajas` (existente) — se agrega una columna:**

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `cajon_id` | UUID | nullable, FK → `cajones(cajon_id)` | física lo lleva; virtual null |

**Índice único parcial (nuevo):** `cajas(cajon_id) WHERE estado = 'abierta' AND eliminado_el
IS NULL` — máximo **una sesión abierta por cajón** (garantía dura bajo concurrencia). No
colisiona con la virtual (su `cajon_id` es null; los NULL no participan del índice único).

Se conserva la regla actual (una abierta por usuario), hoy verificada por `findActiva`.

## Backend — apertura

**DTO** `AbrirCajaDto` gana `cajonId` (obligatorio): `@IsUUID('4')`. `saldoInicial`
(`@IsNumberString`) y `comentario` (`@IsOptional @IsString`) sin cambios.

**`abrir(tenantId, usuarioId, dto)`** — dentro de una transacción con lock (patrón `FOR
UPDATE` ya usado en el módulo), valida **en orden**:

1. **Usuario libre** — `findActiva` (una física abierta por usuario); si existe → **409** "Ya
   tienes una caja abierta".
2. **Cajón válido** — existe, es del tenant, `activo = true`; si no existe/otro tenant →
   **404**; si inactivo → **409** "El cajón está inactivo".
3. **Autorizado (allow-list)** — si el cajón tiene ≥1 fila viva en `cajon_usuario` y el
   usuario **no** está entre ellas → **403** "No estás autorizado a abrir este cajón". Si la
   lista está **vacía → permisivo** (basta `MiCaja:Crear`, ya exigido por el guard de ruta).
4. **Cajón libre** — no hay otra sesión `estado='abierta'` con ese `cajon_id`. Check bajo
   lock (`SELECT … FOR UPDATE`) **+** el índice único parcial como backstop; colisión → **409**
   "El cajón ya tiene una caja abierta".
5. Crea la caja `física` con `cajon_id`, `saldoInicial`, `comentario`, `estado='abierta'`.

Toda query filtra `eliminado_el IS NULL`. `tenant_id`/`usuario_id` del token.

**Endpoint del picker** — `GET /caja/cajones-disponibles`, permiso `@RequiresPermiso('MiCaja',
'Crear')`. Devuelve los cajones del tenant **activos + autorizados para el usuario + libres**
(sin sesión abierta), en **una sola query** (JOIN a `cajon_usuario` aplicando la regla de
lista-vacía = permisivo, `NOT EXISTS` de sesión abierta por cajón). Sin N+1. Forma:
`{ cajonId, nombre }[]`.

## Backend — integridad (cajón en uso)

En `cajones.service`, `update` (cuando pasa `activo=false`) y `remove` (soft-delete) validan
**antes** de aplicar que el cajón **no tenga una sesión abierta** (`cajas` con ese `cajon_id`,
`estado='abierta'`, `eliminado_el IS NULL`). Si la tiene → **409** "El cajón tiene una caja
abierta; ciérrala antes de {desactivar|eliminar}". Una sola query de existencia (sin N+1).

Esto acopla `cajones.service` a la tabla `cajas` (registrar la entidad `Caja` en el
`forFeature` del módulo `cajones`) — **solo lectura de verificación**, no modifica la sesión ni
el `caja.service`.

## Backend — supervisión / Mi caja

Las queries de listado y detalle de sesiones (`caja.service`, SQL con joins) suman
**`cajones.nombre`** vía `LEFT JOIN cajones` (LEFT porque la virtual no tiene cajón → nombre
null). El campo se agrega a los DTOs de respuesta de sesión como `cajonNombre: string | null`.
No se altera ninguna otra columna ni la lógica de cálculo de saldos.

## Frontend

- **Abrir caja (Mi caja):** el formulario de apertura suma un **selector de cajón** poblado
  desde `GET /caja/cajones-disponibles`. Si no hay cajones disponibles (ninguno autorizado y
  libre), se muestra un mensaje y no se puede abrir. El `cajonId` elegido va en el `POST` de
  apertura. `useApiFetch`, tokens semánticos.
- **Supervisión (`Cajas`) y Mi caja:** mostrar el `cajonNombre` de cada sesión (columna/campo;
  "—" o "Online" cuando es null/virtual).

## Reglas de negocio

1. `cajonId` **obligatorio** para abrir caja física.
2. Una sesión abierta **por usuario** (regla actual) **y** una **por cajón** (nueva, índice
   único parcial).
3. Allow-list vacía = **permisivo**; no vacía = solo los usuarios listados → 403 al resto.
4. Cajón **inactivo** no se puede abrir → 409.
5. No se puede **desactivar ni borrar** un cajón con sesión abierta → 409.
6. `tenant_id`/`usuario_id` del token; soft delete; toda lectura filtra `eliminado_el IS NULL`.
7. La caja **virtual** no se ve afectada (`cajon_id` null, no pasa por `abrir`).

## Testing

- **Unit** (`caja.service.spec`): abrir con cajón autorizado+libre OK; usuario con caja
  abierta → 409; cajón inactivo → 409; allow-list no vacía sin el usuario → 403; allow-list
  vacía → permite; cajón ocupado → 409. (`cajones.service.spec`): desactivar/borrar cajón con
  sesión abierta → 409; sin sesión → OK.
- **E2E** (`caja.e2e-spec` / `cajones.e2e-spec`): abrir sobre un cajón → cerrar; segundo
  usuario no puede abrir el mismo cajón → 409; usuario no autorizado → 403;
  `GET /caja/cajones-disponibles` filtra por autorizado+libre+activo; desactivar un cajón con
  caja abierta → 409.
- **Smoke navegador:** abrir caja eligiendo cajón del picker; un cajón ocupado no aparece
  disponible; ver el nombre del cajón en supervisión.

## Seed

Sin datos nuevos. El "Mostrador" sembrado (sub-1) queda como el cajón disponible por defecto
para abrir caja. La caja virtual sembrada queda con `cajon_id` null.

## Docs a actualizar (mismo commit que el código)

- `docs/features/gestion-cajas.md` — sección de apertura sobre cajón (validaciones, picker),
  integridad (cajón en uso), y que el allow-list del sub-2 ya se hace valer aquí.
- `docs/ESTADO.md` — fila de la feature; marcar el refactor de caja (estructura) completo.
- `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9 — marcar sub-proyecto 3
  implementado y la estructura (opción A) cerrada.
- `startup-pos.sql` — columna `cajon_id` en `cajas` + índice único parcial.

## Criterios de aceptación

- [ ] `cajas.cajon_id` (nullable, FK a `cajones`) + índice único parcial `cajas(cajon_id)
  WHERE estado='abierta' AND eliminado_el IS NULL`.
- [ ] `abrir` exige `cajonId` y valida en orden: usuario libre (409), cajón válido/activo
  (404/409), autorizado (403 si allow-list no vacía sin el usuario; permisivo si vacía), libre
  (409), bajo lock.
- [ ] `GET /caja/cajones-disponibles` (`MiCaja:Crear`) devuelve activos+autorizados+libres en
  una query, sin N+1.
- [ ] Desactivar/borrar un cajón con sesión abierta → 409.
- [ ] Listados/detalle de sesión incluyen `cajonNombre` (null para virtual); superficies
  `Cajas` y `Mi caja` lo muestran.
- [ ] Frontend: selector de cajón al abrir caja (solo disponibles); manejo de "sin cajones
  disponibles".
- [ ] `tenant_id`/`usuario_id` del token; soft delete; virtual sin afectar.
- [ ] Unit + e2e verdes; smoke navegador OK.
- [ ] Docs actualizadas (gestion-cajas.md, ESTADO.md, §9, startup-pos.sql).
