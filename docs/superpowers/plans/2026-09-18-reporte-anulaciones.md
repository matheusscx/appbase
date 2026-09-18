# El reporte de anulaciones — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el dueño vea, en un reporte propio, las cortesías, las mermas en mesa y los platos que no se
llegaron a hacer —con precio de carta, costo, garzón y quién autorizó—, y que Mermas deje de mezclar
cortesías con merma real.

**Architecture:** la anulación congela dos datos nuevos al escribirse (precio de carta y garzón de la
mesa). Un service nuevo del módulo `salones` (`AnulacionesReporteService`) lee anulaciones + costo del
kardex en un número fijo de consultas y lo sirve en `GET /salones/anulaciones` (listado paginado) y
`GET /salones/anulaciones/resumen`, con `Salones:Ver todas`. `GET /mermas` filtra por tipo de motivo y
marca lo que vino de una mesa. Una página nueva `/salones/anulaciones` lo muestra.

**Tech Stack:** NestJS + TypeORM con SQL crudo vía `Db`/`EntityManager`; Nuxt 4 + Nuxt UI; Jest (unit +
e2e supertest); Vitest (`*.nuxt.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-09-18-reporte-anulaciones-design.md` — **leerla entera antes de
cualquier tarea**. Las decisiones del owner están en su § 2 y no se reabren desde el plan.

## Global Constraints

- Directo sobre `main`, sin ramas ni PRs. **Push solo si el owner lo pide. Nunca `--no-verify`.**
- **Los implementadores no commitean.** Dejan staged **con rutas explícitas** (nunca `git add -A`: hay
  otras sesiones en el repo). El controlador revisa y commitea.
- Antes de cada `npm run test:e2e`: `./scripts/reset-db.sh`. **Todo e2e en primer plano.** No tocar
  `backend/src` con un e2e corriendo: el watcher recompila y re-siembra. Ante un e2e raro:
  `./scripts/reset-db.sh --verificar`.
- Gate completo por tarea: backend `npm run lint:check && npm run typecheck && npm test && npm run test:e2e`;
  frontend `npm run build && npm test && npm run typecheck:ratchet && npm run design:check`. **Entero, no
  un subset**, y mirando el exit code (nunca `| tail`).
- **Motor de cálculo intocable** (`backend/src/modules/calculo-precios/`). Ninguna tarea lo llama: el
  precio de carta sale de `cuenta_lineas.precio_unitario`, ya congelado.
- **Nada fiscal.** La cortesía como retiro con IVA es otro frente (spec § 7).
- `tenant_id` y el usuario salen del token (`JwtUser`), nunca del body ni del query.
- Plata con Decimal.js o `numeric` de Postgres, **nunca `number`**. Precio de carta y costo son
  **proyecciones de lectura a `ESCALA_COSTO` (4)** (`backend/src/common/constants/escalas.ts`): no se
  persisten ni se redondean con la configuración del tenant. **El costo nunca se convierte de moneda**:
  va como lista `{ monedaId, monto }`.
- Soft delete: toda lectura nueva filtra `eliminado_el IS NULL`. Las excepciones deliberadas (garzón,
  usuario, cuenta, mesa, salón dados de baja después) llevan **su porqué escrito dentro del SQL**.
- **Sin N+1**: número fijo de consultas por request, nunca una por fila.
- Permiso del reporte: `Salones:Ver todas`. Par nuevo en `modulo_app_permiso` con id
  `550e8400-e29b-41d4-a716-446655440406` (siguiente libre del seeder: el máximo es `…405`; **verificar
  con grep antes de usarlo**). No se crea ninguna acción nueva.
- Fixtures de e2e **propios** (garzón, salón, mesa, ítems): nunca la garzona Ana ni los garzones del
  seed. `ana.torres@paris.cl` se usa **solo como usuario** para el 403 (tiene `Salones:Leer` + `Operar`).
- Tests con valores que **discriminan**: nada de cantidad 1, precio igual a costo, ni factores iguales
  (un mutante que multiplica por el campo equivocado tiene que dar otro número).
- Subagentes en Sonnet salvo decisión del owner.

---

### Task 1: La anulación congela precio de carta y garzón

**Files:**
- Modify: `backend/src/modules/salones/entities/cuenta-linea-anulacion.entity.ts`
- Modify: `backend/src/modules/salones/salones.service.ts` (`escribirAnulacionEnLinea` ~`:1335` y sus
  dos llamadores, `escribirAnulacionDeLinea` ~`:1284` y `escribirCancelacionConMotivo` ~`:1572`)
- Modify: `startup-pos.sql` (documentación del esquema: el esquema real sale de las entities)
- Test: `backend/src/modules/salones/salones.service.spec.ts` (`describe('anularLinea')` ~`:2294`,
  `describe('cancelarConMotivo')` ~`:2752`)
- Test: `backend/test/salones-anular-linea.e2e-spec.ts`
- Docs: `docs/features/salones-mesas.md` (las dos columnas y por qué se congelan)

**Interfaces:**
- Produces: `CuentaLineaAnulacion.precioUnitario: string` (columna `precio_unitario`,
  `numeric(18,4)` NOT NULL) y `CuentaLineaAnulacion.garzonId: string | null` (columna `garzon_id`,
  `uuid` NULL). Las tareas 3 y 4 las leen por SQL con esos nombres de columna.

**Cómo le llega el garzón al escritor:** `escribirAnulacionEnLinea` hoy recibe `cuentaId: string`.
Los dos llamadores ya tienen la cuenta bloqueada (`getCuentaAbiertaConLock`), así que se le pasa
`cuenta.garzonResponsableId` como parámetro nuevo `garzonId: string | null`, al lado de `cuentaId`.
**No** se relee la cuenta adentro del escritor: corre una vez por línea y el llamador ya la tiene. El
precio sale de `linea.precioUnitario`, que el escritor ya recibe.

Las columnas nuevas llevan `type` explícito (memoria del repo: un `@Column` sin tipo explícito deja
`design:type` en `Object` y rompe el arranque, y solo lo ve el e2e). La entidad ya está registrada en
`app.module.ts`: no hay que agregarla.

- [ ] **Step 1: Unitarios que fallan.** En `describe('anularLinea')`, un caso con la línea
  `lineaViva({ precioUnitario: '12900.0000' })` y la cuenta con `garzonResponsableId: 'garzon-pedro'`
  (hoy `mockCuentaYLinea` lo pone en `null`: parametrizarlo), que afirme:

  ```ts
  expect(manager.create).toHaveBeenCalledWith(
    CuentaLineaAnulacion,
    expect.objectContaining({
      precioUnitario: '12900.0000',
      garzonId: 'garzon-pedro',
    }),
  );
  ```

  Otro con `garzonResponsableId: null` que afirme `garzonId: null` (la cuenta sin responsable no
  inventa uno). Y en `describe('cancelarConMotivo')`, uno con **dos** líneas de precios distintos
  (`'12900.0000'` y `'4500.0000'`) que afirme que cada fila de anulación lleva **su** precio y el
  mismo garzón.
- [ ] **Step 2: Verlos fallar** — `cd backend && npx jest src/modules/salones/salones.service.spec.ts -t "anularLinea|cancelarConMotivo"`.
- [ ] **Step 3: Implementar** las dos columnas, el parámetro `garzonId` y los dos llamadores.
  `startup-pos.sql`: las dos columnas en `cuenta_linea_anulaciones`, con el mismo comentario corto.
- [ ] **Step 4: Verlos pasar**, y el unitario entero de salones (`npx jest src/modules/salones`).
- [ ] **Step 5: E2E.** En `salones-anular-linea.e2e-spec.ts`, en el caso que ya anula una cortesía,
  leer la fila con `ds.query` (`SELECT precio_unitario, garzon_id FROM cuenta_linea_anulaciones
  WHERE cuenta_id = $1`) y afirmar que el precio es el de la línea y el garzón el del spec. Es lectura
  de verificación, no montaje de escenario: el escenario se arma por API.
- [ ] **Step 6: Docs** en `salones-mesas.md`, **Step 7: gate completo**, stagear por ruta.

---

### Task 2: El listado del reporte, con su permiso

**Files:**
- Create: `backend/src/modules/salones/anulaciones-reporte.service.ts`
- Create: `backend/src/modules/salones/anulaciones-reporte.service.spec.ts`
- Create: `backend/src/modules/salones/dto/find-anulaciones.dto.ts`
- Modify: `backend/src/modules/salones/salones.controller.ts` (en `SalonesController`, `@Controller('salones')` ~`:45`)
- Modify: `backend/src/modules/salones/salones.module.ts` (provider)
- Modify: `backend/src/modules/seeder/seeder.service.ts` (`seedModuloAppPermisos` ~`:1005-1040` y
  `seedRolEncargadoSalon` ~`:2806`)
- Test: `backend/test/salones-anulaciones-reporte.e2e-spec.ts` (nuevo)
- Docs: `docs/features/roles-permisos.md`

**Interfaces:**
- Consumes: las columnas `precio_unitario` y `garzon_id` de la Task 1.
- Produces:
  ```ts
  export type CostoEstado = 'valorizado' | 'no_aplica' | 'sin_valorizar';
  export interface CostoPorMoneda { monedaId: string; monto: string }
  export interface AnulacionReporteItem {
    id: string;
    creadoEl: Date;
    cuentaId: string;
    cuentaNumero: number;
    mesaNombre: string;
    salonNombre: string;
    itemNombre: string;
    cantidad: string;
    motivoBajaNombre: string;
    tipo: TipoMotivoBaja;
    garzonNombre: string | null;
    autorizadoPorNombre: string;
    precioCarta: string;          // cantidad × precio_unitario, a ESCALA_COSTO
    costoEstado: CostoEstado;
    costo: CostoPorMoneda[];      // [] si no_aplica o sin_valorizar
  }
  // AnulacionesReporteService
  findAll(tenantId: string, query: FindAnulacionesDto): Promise<PaginatedResponse<AnulacionReporteItem>>
  ```
  `FindAnulacionesDto extends PaginationQueryDto` con `desde?`, `hasta?` (`@IsDateString`),
  `garzonId?`, `motivoBajaId?` (`@IsUUID`) y `tipo?` (`@IsEnum(TipoMotivoBaja)`). La Task 3 reusa el
  DTO y el armado de filtros.

**El molde:** `MermasService.findAll` y `buildFilters` (`backend/src/modules/mermas/mermas.service.ts:242-342`):
`resolvePagination`/`buildPaginationMeta` (`common/utils/pagination.util.ts`), `requiereZonaTenant` +
`zonaHorariaTenant` + `bordeFechaSql`/`bordeHastaSql` (`common/utils/rango-fecha.util.ts`), un `COUNT`
y una página. **Abrirlo y copiar esa forma.** El service nuevo inyecta `Db` como
`cuenta-asignaciones.service.ts` del mismo módulo. El armado de filtros va en una función del service
que la Task 3 también llama —no se duplica—.

**El contrato del SQL** (la forma exacta la decide el implementador con el código a la vista):
- Base: `cuenta_linea_anulaciones cla` con `cla.tenant_id = $1 AND cla.eliminado_el IS NULL`, `JOIN
  motivo_baja mb` (tipo y nombre), `LEFT JOIN garzones g ON g.garzon_id = cla.garzon_id`, `JOIN usuarios
  u ON u.usuario_id = cla.autorizado_por`, `JOIN cuentas c`, `JOIN mesas m`, `JOIN salones s`.
- **Garzón, usuario, cuenta, mesa y salón SIN filtro de borrado**, con este porqué en el SQL: *"es algo
  que ya pasó: dar de baja a la persona o borrar la mesa después no puede sacarlo del reporte ni bajar el
  total sin avisar (mismo criterio que Mermas con el producto)"*. En el `COUNT` y en la página.
- Costo: una subconsulta agregada **una sola vez** para todas las anulaciones de la página:
  ```sql
  SELECT mv.cuenta_linea_anulacion_id, i.moneda_id,
         SUM(ROUND(mv.cantidad * mv.costo_unitario, 4)) AS monto,
         bool_or(mv.costo_unitario IS NULL)             AS falta_costo
    FROM movimientos_inventario mv
    JOIN items i ON i.item_id = mv.item_id   -- sin filtro de borrado del ítem: ya pasó
   WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
     AND mv.cuenta_linea_anulacion_id = ANY($2)
   GROUP BY 1, 2
  ```
  `ROUND(…, 4)` por movimiento es el mismo número que `costoPerdido` muestra en Mermas para ese
  movimiento (`Decimal.toFixed(ESCALA_COSTO)`, que redondea igual para positivos). Por eso el costo de
  una anulación es la suma de lo que Mermas muestra, no un recálculo.
- Estado del costo por anulación: `no_aplica` si el tipo es `no_elaborado`; `sin_valorizar` si algún
  grupo tiene `falta_costo`; si no, `valorizado` con la lista por moneda.
  ⚠️ Una merma o cortesía **sin ningún movimiento** (un plato cuyos ingredientes estaban todos borrados)
  cae en `valorizado` con `costo: []`. Es el hueco de la spec § 4: no se inventa un estado para él.
- `precioCarta` = `Decimal(cantidad).mul(precio_unitario).toFixed(ESCALA_COSTO)` en el mapeo.
- Orden: `cla.creado_el DESC`, desempate por id.

**El permiso:** `@Get('anulaciones')` + `@RequiresPermiso('Salones', 'Ver todas')` en
`SalonesController`. No choca con ninguna ruta de ese controller (sus `GET` son `operacion` y `''`), pero
verificar que `GET /salones/anulaciones` no lo capture otra ruta. En el seeder: el par
`{ moduloAppPermisoId: '…406', moduloAppId: SALONES, permisoId: VER_TODAS }` junto a los otros de
Salones, y `SALONES_VER_TODAS` en el loop de `seedRolEncargadoSalon` (actualizar su docblock: hoy lista
cinco permisos).

- [ ] **Step 1: Unitarios que fallan** en `anulaciones-reporte.service.spec.ts`, con `Db.query`
  mockeado por orden de llamada (molde: `mermas.service.spec.ts:534`):
  - mapea una cortesía de `cantidad '2'` y `precio_unitario '12900.0000'` a `precioCarta '25800.0000'`;
  - costo `valorizado` con dos grupos de moneda (`CLP 4300.0000`, `USD 3.5000`) → lista de dos;
  - `no_elaborado` → `costoEstado 'no_aplica'`, `costo []`, y **no** entra al `ANY($2)` de la consulta
    de costo;
  - un grupo con `falta_costo` → `sin_valorizar` y `costo []` (no una cifra parcial);
  - `garzon_nombre null` → `garzonNombre null`;
  - los filtros (`tipo`, `garzonId`, `motivoBajaId`, `desde` con fecha pura) llegan como parámetros.
    Afirmar sobre la **cláusula**, no sobre un `toContain` suelto que puede matchear un comentario.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar** DTO, service, ruta, provider y seed.
- [ ] **Step 4: Verlos pasar.**
- [ ] **Step 5: E2E** `salones-anulaciones-reporte.e2e-spec.ts`, con el molde de
  `salones-anular-linea.e2e-spec.ts` (login `entrar()`, garzón/salón/mesa/ítems propios, limpieza en
  `afterAll`). Escenario armado **por API**:
  - `403` con `ana.torres@paris.cl` (Leer + Operar, sin Ver todas); `200` con
    `encargado.salon@paris.cl` y con el admin;
  - un plato con costo (`costo_actual` cargado por API) anulado como **cortesía** de 2 unidades, otro
    como **merma**, otro como **no se hizo**: cada fila con su `precioCarta`, su `costoEstado` y su
    costo esperado **calculado a mano en el test** a partir de lo cargado;
  - un plato **sin costo cargado** anulado como merma → `sin_valorizar`;
  - **anular y después transferir la cuenta a otro garzón** (`POST /cuentas/:id/transferir` con el PIN
    del destino): la fila sigue con el garzón original;
  - `cancelar-con-motivo` sobre una cuenta con algo despachado deja filas con precio y garzón;
  - el filtro `tipo=cortesia` solo trae la cortesía; `garzonId` solo las del garzón;
  - aislamiento: el reporte de otro tenant no trae estas filas.
  ⚠️ Todo helper que lea `.body` mira antes el `.status` (`node scripts/check-e2e-status.mjs --staged`).
- [ ] **Step 6: Docs** en `roles-permisos.md`: el par `Salones:Ver todas`, qué gobierna, que el seed se
  lo da al encargado, y **por qué no `Salones:Leer`** (el garzón lo necesita para el historial de la
  cuenta y Sesiones).
- [ ] **Step 7: Gate completo**, stagear por ruta. Revisión: `domain-reviewer` **y**
  `api-security-reviewer` (ruta nueva).

---

### Task 3: El resumen

**Files:**
- Modify: `backend/src/modules/salones/anulaciones-reporte.service.ts`
- Modify: `backend/src/modules/salones/salones.controller.ts`
- Test: `backend/src/modules/salones/anulaciones-reporte.service.spec.ts`
- Test: `backend/test/salones-anulaciones-reporte.e2e-spec.ts`

**Interfaces:**
- Consumes: `FindAnulacionesDto`, el armado de filtros y el SQL de costo de la Task 2.
- Produces:
  ```ts
  export interface GrupoResumen {
    platos: string;           // Σ cantidad
    precioCarta: string;      // Σ de los precioCarta de las filas
    costo: CostoPorMoneda[];  // Σ por moneda, solo filas valorizadas
    sinValorizar: number;     // cuántas anulaciones del grupo quedaron sin valorizar
  }
  export interface ResumenAnulaciones {
    porTipo: (GrupoResumen & { tipo: TipoMotivoBaja })[];
    porGarzon: (GrupoResumen & { garzonId: string | null; garzonNombre: string | null })[];
    porAutorizo: (GrupoResumen & { usuarioId: string; usuarioNombre: string })[];
  }
  resumen(tenantId: string, query: FindAnulacionesDto): Promise<ResumenAnulaciones>
  ```
  `GET /salones/anulaciones/resumen`, mismo permiso, mismo DTO (ignora `page`/`pageSize`, como
  `GET /pagos/resumen` no pagina).

**El contrato:** los totales son **la suma de las filas** (spec § 4): `precioCarta` del grupo =
`Σ ROUND(cla.cantidad * cla.precio_unitario, 4)`, no `ROUND(Σ …)`. Una fila `sin_valorizar` suma a
`platos` y a `precioCarta` pero **no** a `costo`, y suma 1 a `sinValorizar`. Número fijo de consultas
(p. ej. una por agrupación, o una sola con `GROUPING SETS`), **sin importar el rango**. Mismas
excepciones de borrado que la Task 2, con el porqué en el SQL. **Declarar `@Get('anulaciones/resumen')`
antes o de forma que no lo capture otra ruta.**

- [ ] **Step 1: Unitarios que fallan:** un grupo con una fila valorizada (`CLP 4300.0000`) y una sin
  valorizar → `costo [CLP 4300.0000]`, `sinValorizar 1`, `platos` y `precioCarta` de las dos; costo de
  dos monedas en un mismo garzón → dos entradas; `garzonId null` es un grupo propio.
- [ ] **Step 2: Verlos fallar.** **Step 3: Implementar.** **Step 4: Verlos pasar.**
- [ ] **Step 5: E2E** en el mismo archivo de la Task 2, sobre el mismo escenario: `403`/`200` en esta
  ruta también; los totales por tipo, por garzón y por quién autorizó **coinciden con la suma de las
  filas del listado** con los mismos filtros (la prueba de fondo: si divergen, uno de los dos miente);
  `sinValorizar` cuenta el plato sin costo.
- [ ] **Step 6: Gate completo**, stagear. Revisión: `domain-reviewer` y `api-security-reviewer`.

---

### Task 4: Mermas deja de listar cortesías y marca lo que vino de una mesa

**Files:**
- Modify: `backend/src/modules/mermas/mermas.service.ts` (`findAll` ~`:242`, `MermaListItem`, `MermaRow`, `mapRow`)
- Modify: `frontend/app/pages/mermas.vue` (interfaz `MermaListItem` y la columna del motivo)
- Test: `backend/src/modules/mermas/mermas.service.spec.ts`
- Test: `backend/test/mermas.e2e-spec.ts`
- Test: `frontend/app/pages/mermas.nuxt.spec.ts`
- Docs: `docs/features/mermas-valorizadas.md`

**Interfaces:**
- Produces: `MermaListItem.deAnulacion: boolean` (`mv.cuenta_linea_anulacion_id IS NOT NULL`).

**El contrato:** el filtro por **tipo del motivo = `merma`** va en el `COUNT` **y** en la página, para
que el total no se mueva sin avisar. Hoy el `JOIN` a `motivo_baja` es `LEFT` con filtro de borrado solo
para leer el nombre: el filtro por tipo no puede depender de ese `LEFT` (un `LEFT JOIN … AND mb.tipo =
'merma'` deja pasar la cortesía con nombre `null`). Tiene que ser una condición en el `WHERE` (o
`EXISTS`) que excluya la fila. Sin filtro de borrado sobre el motivo para esa condición: un motivo en uso
no se borra, pero el filtro por tipo no debe depender de eso — escribirlo en el SQL.

**Consumidores de `GET /mermas`:** solo `frontend/app/pages/mermas.vue` (medido 2026-09-18 con
`grep -rn "mermas" frontend/app backend/src`). Volver a medirlo antes de cerrar.

- [ ] **Step 1: E2E que falla** en `mermas.e2e-spec.ts`: armar por API un plato con costo en una cuenta
  propia, despacharlo y anularlo una vez como **cortesía** y otra como **merma** (los helpers de
  `salones-anular-linea.e2e-spec.ts` son el molde; si no hay helper compartido, copiarlos —dos copias
  son aceptables—). Afirmar: la cortesía **no** aparece en `GET /mermas`; la merma de mesa sí, con
  `deAnulacion: true`; una merma de bodega (`POST /mermas`) con `deAnulacion: false`; y `meta.total`
  coincide con las filas.
- [ ] **Step 2: Verlo fallar** contra el código actual.
- [ ] **Step 3: Implementar** backend (+ unitario de `mapRow` con `de_anulacion`).
- [ ] **Step 4: Verlo pasar.**
- [ ] **Step 5: Frontend.** En `mermas.vue`, `deAnulacion` en la interfaz y un `UBadge` *"Anulación en
  mesa"* (color semántico `neutral`, variante `subtle`) al lado del nombre del motivo cuando es `true`.
  En `mermas.nuxt.spec.ts`, un caso que monte una fila con `deAnulacion: true` y otra con `false` y
  afirme el badge solo en la primera.
- [ ] **Step 6: Docs** en `mermas-valorizadas.md`: sale el párrafo ⚠️ *"Hoy este informe mezcla
  cortesías con merma real…"* (reescribirlo, no anexarle una corrección) y entra qué filtra el listado,
  qué es `deAnulacion` y el puntero al reporte de Anulaciones.
- [ ] **Step 7: Gate completo** (backend y frontend), stagear. Revisión: `domain-reviewer`.

---

### Task 5: La pantalla

**Files:**
- Create: `frontend/app/pages/salones/anulaciones.vue`
- Create: `frontend/app/pages/salones/anulaciones.nuxt.spec.ts`
- Modify: `frontend/app/layouts/dashboard.vue` (entrada de menú, junto a *Sesiones* ~`:81`)

**Interfaces:**
- Consumes: `GET /salones/anulaciones` (Task 2) vía `usePaginatedList`, y
  `GET /salones/anulaciones/resumen` (Task 3) vía `useApiFetch` con los mismos filtros. Los tipos del
  frontend copian las interfaces de las Tasks 2 y 3 (con `creadoEl: string`).

**Molde:** `frontend/app/pages/mermas.vue` (filtros → `listFilters` → `usePaginatedList`, tabla con
`TableColumn`, `useFormatters`) y `frontend/app/pages/pagos/index.vue:69-102` (resumen aparte con
`useApiFetch`). **Invocar el skill `nuxt-ui` antes de escribir**, y buscar los componentes con el MCP de
Nuxt UI en vez de recordarlos.

**Lo que muestra** (spec § 6):
- Filtros: `desde`/`hasta` **por defecto hoy**, como fecha pura `YYYY-MM-DD` (el backend la expande en
  la zona del tenant). Sacarla con `hoyLocal()` de `frontend/app/composables/useVigenciaRegla.ts`
  (exportarlo si no lo está), **nunca** `toISOString().slice(0, 10)`, que da la fecha UTC y a la noche
  en Chile ya es mañana. Tipo (las tres opciones con sus labels: *Cortesía*, *Merma*, *No se hizo*),
  motivo (`GET /motivos-baja` sin `soloActivas`: un motivo desactivado igual tiene historia) y garzón. **Las
  opciones de garzón salen de `resumen.porGarzon`**, no de `GET /garzones`: no suma una llamada ni un
  permiso, y lista justo a quienes tienen algo en el rango.
- Resumen: tres tarjetas —*Cortesías · Mermas en mesa · No se hizo*— con platos, precio de carta
  (`formatMonto(valor)`, moneda oficial) y costo (`formatMonto(monto, monedaId)` por cada moneda; `—`
  en *No se hizo*). Si `sinValorizar > 0`: *"N platos sin valorizar"*.
- Dos tablas chicas: por garzón (`garzonNombre ?? 'Sin garzón'`) y por quién autorizó.
- Detalle paginado: fecha, mesa (`salonNombre · mesaNombre · cuenta N`), plato, cantidad
  (`formatStock`), motivo con badge de tipo, garzón, autorizó, precio de carta, costo (`—` si
  `no_aplica`; `UBadge` *Sin valorizar* si `sin_valorizar`).
- Aviso fijo (`UAlert`, color `info`): *"Las mermas de esta lista también están contadas en Mermas."*
- Menú: *"Anulaciones"* (`i-lucide-ban` o el que devuelva la búsqueda de íconos), `to:
  '/salones/anulaciones'`, visible con `permissionsStore.esAdmin || permissionsStore.can('Salones', 'Ver todas')`.
- Tokens semánticos, cero lógica de negocio en la página (la suma ya viene del backend; la página no
  suma plata). Tiene que andar a 375 px sin scroll horizontal de página.

- [ ] **Step 1: Spec de página que falla** (`anulaciones.nuxt.spec.ts`, molde `mermas.nuxt.spec.ts`:
  `mockNuxtImport` de `useApiFetch` y `usePermissionsStore`): con un resumen y un listado fijos, afirma
  las tres tarjetas con sus cifras, la línea *"1 plato sin valorizar"*, `—` en la fila `no_aplica`, el
  badge en la `sin_valorizar`, el aviso fijo, y que cambiar el filtro de tipo vuelve a pedir **las dos**
  rutas con `tipo=cortesia`.
- [ ] **Step 2: Verlo fallar.** **Step 3: Implementar** página y menú. **Step 4: Verlo pasar.**
- [ ] **Step 5: Gate completo** de frontend (`build`, `npm test`, `typecheck:ratchet`, `design:check`),
  stagear. Revisión: `domain-reviewer`.

---

### Task 6: Smoke en el navegador, mutantes y cierre del frente

**Files:**
- Docs: `docs/features/salones-mesas.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md` (si describe Mermas o
  anulaciones), `docs/agent/pendientes.md`, `docs/agent/resueltos.md`, `docs/README.md` (solo si se
  crea un doc de feature nuevo; este plan no crea ninguno)

- [ ] **Step 1: Smoke en el navegador**, con la base recién reseteada (`./scripts/reset-db.sh` **antes**):
  como encargado del salón, anular en una mesa una cortesía, una merma y un *no se hizo*; abrir
  `/salones/anulaciones` y `/mermas` y verificar lo que dice la spec § 6 (tarjetas, aviso, badge en
  Mermas, la cortesía fuera de Mermas). Como `ana.torres`: la entrada del menú no aparece y la URL
  directa no muestra datos (el `403` del backend). A 375 px de ancho también. Captura para el owner.
- [ ] **Step 2: Mutantes que revierten**, uno por vez, cada uno con el test que lo mata anotado. Tras
  revertir cada uno, confirmar en los logs la hora del restart del watcher antes de correr el siguiente:
  - Mermas sin el filtro por tipo **en la página** (el `COUNT` con filtro);
  - Mermas sin el filtro por tipo **en el `COUNT`** (la página con filtro);
  - la anulación leyendo el garzón **vigente** de la cuenta en vez del congelado;
  - el precio de carta leído de la línea viva en vez del congelado (debe morir con la anulación total,
    que borra la línea);
  - una fila `sin_valorizar` sumando al costo del resumen;
  - la ruta del listado y la del resumen con `Salones:Leer` en vez de `Ver todas`.
  Correr la suite entera en cada uno, no solo el test esperado.
- [ ] **Step 3: Docs de cierre.**
  - `pendientes.md`: la entrada *"El reporte de anulaciones de platos, separando merma de cortesía"*
    (§ 6) pasa a `resueltos.md` con sus commits. La entrada de la **regla 6** se **reescribe** (spec
    § 10): ya existe un reporte agregado que la cumple; sigue abierto uno agregado de Mermas.
  - Entradas nuevas en `pendientes.md`, cada una en su sección por lo que hace falta para tomarla:
    el % sobre ventas por garzón (§ 4, necesita la regla de de quién es la venta); la cortesía como
    retiro con IVA (§ 6, frente fiscal propio, con las fuentes de la spec § 8); el día comercial que
    cruza medianoche; los ingredientes borrados que se saltean sin movimiento al anular.
  - `salones-mesas.md`: el reporte, sus rutas y su permiso. `ESTADO.md`: fila del reporte con fecha.
- [ ] **Step 4: Gate completo** y revisión de **todo el frente**, desde el commit de la spec
  (`57874ab9`) hasta el último: caza contradicciones entre tareas que ninguna revisión por tarea ve.

## Verification

- **Cada tarea:** gate completo en verde (exit code) y `domain-reviewer` LIMPIO sobre lo staged;
  `api-security-reviewer` además en las Tasks 2 y 3.
- **La prueba de fondo:** los totales del resumen coinciden con la suma de las filas del listado para
  los mismos filtros (Task 3, e2e).
- **Mutantes:** Task 6, medidos uno por uno.
- **Railway:** hay columnas nuevas (`cuenta_linea_anulaciones`) y un par de permiso nuevo en el seed.
  Tras el push (solo si el owner lo pide), revisar el deployment además del CI; si el backend no
  arranca por esquema, es el caso del skill `railway-sync-db` (avisar al owner antes: su paso 2 lo
  bloquea el clasificador).

## Decisions / Open questions

- **Decidido por el owner (2026-09-18):** las seis filas de la spec § 2, incluida la reapertura del
  permiso (`Salones:Ver todas`, no `Leer`).
- **Decidido en este plan, no en la spec:**
  - el garzón le llega al escritor como parámetro desde la cuenta ya bloqueada, sin releerla;
  - un service nuevo (`AnulacionesReporteService`) en el módulo `salones`, no más código en
    `salones.service.ts` (2.774 líneas), con el precedente de `cuenta-asignaciones.service.ts`;
  - las opciones del filtro de garzón salen del resumen, no de `GET /garzones`;
  - una merma/cortesía sin ningún movimiento queda `valorizado` con `costo []` (el hueco de la spec § 4).
- **Fuera de alcance:** spec § 7.
