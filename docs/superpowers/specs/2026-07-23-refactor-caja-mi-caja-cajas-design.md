# Spec: Refactor Caja → "Mi caja" (operario) / "Cajas" (gestión)

**Fecha**: 2026-07-23
**Owner**: Cesar Matheus
**Status**: Diseño aprobado — pendiente de plan

---

## Problema

Hoy toda la caja convive en **un solo módulo `Caja`** y una sola pantalla `/caja`
que se bifurca según el permiso `Caja:Ver todas`:

- **Sin `Ver todas`** (cajero/operario): opera su propio turno — abre, movimientos,
  cierra, ve su historial.
- **Con `Ver todas`** (encargado/supervisor): además ve todas las cajas abiertas del
  tenant, el historial de todos, y el detalle read-only de cualquier caja.

`pages/caja/index.vue` termina mezclando las dos mentalidades con `if (verTodas)`, y el
permiso **`Ver todas` está haciendo de "rol supervisor" disfrazado de acción CRUD**. Es
deuda de modelado: operar tu caja y supervisar todas las cajas son dos responsabilidades
distintas atadas a una sola bolsa de permisos.

La investigación de mercado ([`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](../../agent/investigaciones/2026-07-23-gestion-caja.md))
confirma que la industria separa explícitamente el rol **operario** (opera una sesión de
cajón) del rol **encargado** (supervisa, revisa cuadres) — en Chile, Defontana lo modela
como cajero vs. supervisor.

## Objetivo

Separar las dos responsabilidades en **dos módulos de permiso y dos superficies de
navegación** distintas:

- **Mi caja** — operación del cajero sobre su propio turno.
- **Cajas** — supervisión (solo lectura) del encargado sobre todas las cajas del tenant.

La lógica de dominio (mecánica de caja) **no se duplica**: sigue en un único
`caja.service.ts`. La separación se expresa en permisos y arquitectura de información.

## No incluido (YAGNI / diferido)

Registrado en [`docs/agent/pendientes.md`](../../agent/pendientes.md) para no perderlo:

- **Cierre forzado de caja ajena** por el encargado (escenario del cajero que se va de
  urgencia). Requiere agregar `cerrada_por` a `cajas` (quién cerró ≠ dueño del turno) y
  romper el owner-only del cierre. Es un cambio de **modelo con implicancias de auditoría**
  → fuera de este refactor de IA/permisos.
- **Aprobación de cierre por umbral** de diferencia (patrón Toast).
- El hallazgo **§3 de la investigación** (`saldo_esperado` mezcla efectivo y tarjeta) —
  decisión de negocio independiente, sin resolver.
- Blind count, motivos categorizados, retiro a bóveda — ya listados en la investigación.

Este refactor **no cambia ninguna regla de cálculo ni el modelo de datos de `cajas`**: es
reorganización de permisos + navegación reusando la lógica existente.

---

## Decisiones de diseño (tomadas con el owner)

1. **Alcance: frontend + RBAC.** Se tocan permisos (seed + guards) y navegación. **No** se
   reorganiza el backend en rutas nuevas.
2. **Enfoque B — renombrar, no solo agregar.** El módulo `Caja` se **renombra a `MiCaja`**
   (nombres internos limpios que calzan con las etiquetas, "para no generar confusión
   futura"), y se **crea un módulo nuevo `Cajas`**. Se asume la migración a cambio de cero
   ambigüedad.
3. **`Cajas` arranca solo lectura.** El encargado supervisa; no escribe sobre cajas ajenas.
   Todo poder de escritura (cierre forzado, aprobación) queda diferido.
4. **URLs del backend se quedan en `/caja/*`.** El usuario nunca las ve (las llama el
   frontend). Solo cambian los `@RequiresPermiso` por endpoint. Un solo controller, un solo
   service. Es el alcance mínimo de la decisión 1.
5. **Un solo `caja.service.ts`.** La mecánica de `saldo_esperado`, el `FOR UPDATE` y la
   inserción de movimientos son un dominio único; no se duplican por módulo de permiso.

---

## Diseño

### 1. RBAC — permisos (seed)

Modelo actual: **módulos** (`modulos_app`) × **acciones globales** (`permisos`:
`Leer`/`Crear`/`Actualizar`/`Ver todas`…) unidas por `modulo_app_permiso`. El decorador
`@RequiresPermiso('Caja', 'Leer')` referencia el módulo **por nombre**. `Ver todas` es una
acción **global compartida** (la usan otros módulos) — no se borra.

Cambios en `seeder.service.ts`:

- **Renombrar** el módulo `Caja` (id `550e8400-…-446655440011`): `nombre` `'Caja'` →
  `'MiCaja'`, `url` `/caja` → `/mi-caja`. Conserva su id y sus acciones
  `Leer`/`Crear`/`Actualizar`.
- **Crear** módulo `Cajas` con el **siguiente id libre** del patrón
  `550e8400-e29b-41d4-a716-446655440XXX`, `url` `/cajas`, ícono propio (p. ej.
  `mdi-cash-register` con variante o `mdi-cash-multiple`), `tieneConfiguracion: false`.
  Asociarle **solo la acción `Leer`** vía `modulo_app_permiso`.
- **Dejar de asociar** `Ver todas` al módulo de caja (quitar su fila
  `modulo_app_permiso`). La acción global permanece para otros módulos.
- **Re-mapear asignaciones de rol** existentes en el seed:
  - `seedVendedorPermisosCaja` (Paris) → apunta a `MiCaja` (`Leer`/`Crear`/`Actualizar`),
    sin `Ver todas`.
  - Rol **admin** del tenant (automático) → recibe **ambos** módulos: `MiCaja` completo +
    `Cajas:Leer`.
  - Cualquier rol/seed que hoy tenga `Caja:Ver todas` → `Cajas:Leer`.

> ⚠️ **Etiqueta de presentación**: si el frontend muestra `modulo.nombre` crudo en el
> sidebar, `MiCaja` se vería pegado. Verificar cómo se renderiza el nombre del módulo; si
> hace falta, mapear `MiCaja` → "Mi caja" en la capa de presentación (no en datos).

### 2. Frontend — arquitectura de información

Dos superficies, dos entradas de sidebar (gated por su módulo):

| Superficie | Rutas | Permiso | Contenido |
|---|---|---|---|
| **Mi caja** | `/mi-caja`, `/mi-caja/[id]`, `/mi-caja/historial` | `MiCaja` (`Leer`/`Crear`/`Actualizar`) | Apertura, movimientos, cierre del propio turno; historial propio. **Operable.** |
| **Cajas** | `/cajas`, `/cajas/[id]`, `/cajas/historial` | `Cajas:Leer` | Grid de cajas abiertas del tenant; historial de todos (filtro por cajero); detalle **read-only** de cualquier caja. |

- **`pages/caja/*` → se reubica y parte** en `pages/mi-caja/*` y `pages/cajas/*`. El
  `index.vue` que hoy bifurca con `if (verTodas)` se separa en dos páginas limpias, cada
  una con una sola mentalidad.
- **Componentes se reusan casi sin cambios** (la lógica de presentación ya está resuelta):
  - `CajaActivaDashboard` — ya tiene modo read-only → sirve a "Mi caja" (operable) y a
    "Cajas/[id]" (read-only).
  - `CajaHistorial` — ya acepta scope/`?usuarioId=` → historial propio vs. de todos.
  - `CajaAbiertasGrid`, `CajaTurnoHeader`, `CajaTurnoResumen`, `CajaMovimientosTable`,
    `CajaAperturaForm`, `CajaMovimientoDrawer`, `CajaCierreDrawer` — sin cambio de lógica.
  - Se decide en el plan si la carpeta de componentes se renombra (`components/caja/` →
    `components/mi-caja/` + `components/cajas/`) o se deja como `caja/` compartida. Preferir
    **dejar `components/caja/` compartida** (son piezas comunes a ambas superficies) para
    no duplicar ni renombrar imports masivamente.
- **Store `useCajaStore`** — un solo store sigue sirviendo a ambas superficies (ya expone
  `cajaActiva`/`movimientos` para operar y `abiertas`/`detalle`/`historial` para
  supervisar). No se parte.
- **Caso "admin que también opera":** con ambos permisos ve **las dos entradas**
  independientes. "Mi caja" = su turno; "Cajas" = supervisión de todas. Sin lógica especial.
- **Redirecciones de compatibilidad:** decidir en el plan si `/caja*` redirige a
  `/mi-caja*` (evita romper bookmarks/enlaces internos durante la transición).

### 3. Backend — guards por endpoint (mismo controller y service)

`caja.controller.ts` conserva el prefijo `/caja` y los métodos. Solo cambia el
`@RequiresPermiso` de cada uno:

| Endpoint | Hoy | Nuevo |
|---|---|---|
| `GET /caja/activa` | `Caja:Leer` | `MiCaja:Leer` |
| `POST /caja/abrir` | `Caja:Crear` | `MiCaja:Crear` |
| `POST /caja/:id/movimientos` | `Caja:Crear` | `MiCaja:Crear` |
| `GET /caja/:id/movimientos` | `Caja:Leer` | `MiCaja:Leer` **o** `Cajas:Leer` (ver nota) |
| `GET /caja/:id/movimientos/resumen` | `Caja:Leer` | ídem |
| `POST /caja/:id/cerrar` | `Caja:Actualizar` | `MiCaja:Actualizar` |
| `GET /caja/abiertas` | `Caja:Leer` | `Cajas:Leer` |
| `GET /caja` (historial) | `Caja:Leer` (+`Ver todas` si `todas=true`) | `MiCaja:Leer`; `todas=true` o `usuarioId` ajeno → `Cajas:Leer` |
| `GET /caja/:id` (detalle) | `Caja:Leer` | `MiCaja:Leer` (propia) **o** `Cajas:Leer` (ajena) |

**Nota — endpoints de lectura compartida** (`GET /caja/:id`, `/:id/movimientos`,
`/:id/movimientos/resumen`, `GET /caja`): hoy sirven tanto al dueño (su propia caja) como
al supervisor (caja ajena con `Ver todas`). La lógica **owner-vs-verTodas ya vive en el
service** (`registrarMovimiento`/`listarMovimientos`/`findAll` reciben el flag `verTodas`).
El re-mapeo debe preservar esa semántica:

- El **flag `verTodas`** que el controller pasa al service pasa a derivarse de
  **`Cajas:Leer`** (antes: `Caja:Ver todas`).
- El acceso a la **propia** caja sigue habilitado por `MiCaja:Leer`.
- Un endpoint de lectura compartida requiere **`MiCaja:Leer` OR `Cajas:Leer`** — el service
  decide alcance (propia vs. todas) según cuál tenga. Definir en el plan si esto se resuelve
  con un guard que acepte cualquiera de los dos permisos, o dos rutas. **Preferir: guard que
  acepte cualquiera + el service filtra por alcance** (mantiene un solo controller).
- **Escrituras siguen owner-only** en el service (`POST movimientos`, `POST cerrar`):
  `Cajas:Leer` NO habilita escribir. Invariante preservada.

`caja.service.ts` **no cambia su lógica**; a lo sumo se renombra el parámetro `verTodas`
por claridad (opcional, decisión del plan).

### 4. Migración de datos (BD ya poblada)

- Dev/local se resetea con `docker-compose down -v` → el seed reconstruye todo con los
  nombres nuevos. No requiere migración manual.
- El renombre del módulo `MiCaja` conserva el **id** (`…011`), así que las filas
  `rol_permiso`/`tenant_modulo` que apuntan a ese id **siguen válidas** — solo cambia el
  nombre visible.
- El módulo `Cajas` es nuevo (id nuevo): las asignaciones se crean en el seed. En una BD ya
  poblada sin reseed haría falta un script que (a) inserte el módulo `Cajas` + su
  `Leer`, (b) copie a `Cajas:Leer` los roles que tenían `Caja:Ver todas`, (c) borre esas
  filas de `Ver todas` para caja. **En dev basta el reseed**; el script queda anotado por si
  hay algún entorno persistente.

---

## Testing

- **Unit backend** (`caja.controller.spec.ts`): los endpoints exigen el permiso correcto
  (`MiCaja:*` operativos, `Cajas:Leer` supervisión); las escrituras siguen owner-only aun
  con `Cajas:Leer`.
- **E2E API** (`caja.e2e-spec.ts`): actualizar el setup de permisos de los usuarios de
  prueba a `MiCaja`/`Cajas`. Casos: cajero (`MiCaja`) opera su caja pero **no** ve
  `/caja/abiertas` (403 sin `Cajas:Leer`); supervisor (`Cajas:Leer`) lista todas y lee
  detalle ajeno pero **no** puede cerrar caja ajena (403/owner-only).
- **Seed**: `seeder.service` reconstruye `MiCaja` + `Cajas` sin colisión de ids; el rol
  admin recibe ambos; Vendedor de Paris recibe `MiCaja` sin `Cajas`.
- **Frontend**: build + `typecheck:ratchet` + `design:check`. **Smoke manual en navegador**
  (el flujo de drawers no tiene test unit): cajero ve solo "Mi caja" y opera; supervisor ve
  "Cajas" y navega grid → detalle read-only sin botones de operar; admin ve ambas entradas.

## Documentación a actualizar (mismo commit)

- `docs/features/gestion-cajas.md` — reescribir el "Modelo de acceso por permiso" y las
  rutas: dos módulos (`MiCaja`/`Cajas`) y dos superficies en vez de `/caja` + `Ver todas`.
- `docs/features/roles-permisos.md` — reflejar el módulo nuevo `Cajas` y el renombre.
- `docs/ESTADO.md` — fila de la feature (refactor de caja).
- `docs/agent/pendientes.md` — ya registra los diferidos; marcar el refactor como hecho al
  cerrar.

---

## Invariantes / detenerse

- **No** toca el motor de cálculo de precios ni impuestos.
- **No** escribe en `movimientos_inventario` ni altera `modo_inventario`.
- **No** modifica el modelo de datos de `cajas`/`movimientos_caja` (el `cerrada_por` es
  diferido).
- `tenant_id`/`usuario_id` siguen saliendo del token. Soft delete intacto.
- **Enforcement real en backend** (invariante 6): la separación vive en guards por ruta, no
  solo en el sidebar. `Cajas:Leer` no habilita escribir — owner-only preservado en el
  service.
- **No** toca el sistema de tokens JWT.

## Riesgos / notas

- **Semántica de lectura compartida**: el punto más delicado es preservar owner-vs-`verTodas`
  al re-mapear permisos (§3, nota). El plan debe verificar que `Cajas:Leer` da alcance
  "todas" **sin** dar escritura, y que el dueño sigue accediendo a lo suyo con `MiCaja:Leer`.
- **Renombre de módulo y sidebar**: confirmar que ningún lugar rompe por asumir el string
  `'Caja'` (buscar `'Caja'`/`"Caja"` en front y back). El id del módulo no cambia → las
  FKs aguantan.
- **Enlaces/bookmarks a `/caja`**: considerar redirect de compatibilidad a `/mi-caja`.
- **Componentes compartidos**: no renombrar `components/caja/` salvo que el plan lo
  justifique — son piezas comunes a ambas superficies; renombrar dispararía churn de imports
  sin ganancia.
