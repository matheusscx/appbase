# El dashboard de inicio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft · **Date:** 2026-09-18 · **Owner:** Cesar Matheus

**Goal:** que el inicio le muestre al encargado lo que pasa **ahora** en el turno (salón, cajas,
cierres) y al dueño **cómo le fue hoy** (ventas, por cobrar, pérdidas, lo más vendido), cada
bloque según los permisos de quien entra.

**Architecture:** un módulo nuevo `resumen-negocio` sirve `GET /resumen-negocio/hoy` con el permiso
nuevo `Resumen del negocio: Leer`, en una llamada y un número fijo de consultas. El salón suma
`GET /salones/ocupacion` (`Salones: Ver todas`). Cajas y cierres reusan dos rutas que ya existen.
`pages/index.vue` pasa a ser el dashboard: una zona "Ahora" que se refresca cada 60 s con un
composable nuevo, y una zona "Hoy" que carga una vez.

**Tech Stack:** NestJS + TypeORM con SQL crudo vía `Db`; Nuxt 4 + Nuxt UI; Jest (unit + e2e
supertest); Vitest (`*.spec.ts` y `*.nuxt.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-09-18-dashboard-inicio-design.md` — **leerla entera antes de
cualquier tarea**. Las decisiones del owner están en su § 2 y no se reabren desde el plan.

## Global Constraints

- Directo sobre `main`, sin ramas ni PRs. **Push solo si el owner lo pide. Nunca `--no-verify`.**
- **Los implementadores no commitean.** Dejan staged **con rutas explícitas** (nunca `git add -A`:
  hay otra sesión trabajando en el repo, hoy con cambios sin commitear en
  `backend/src/modules/salones/anulaciones-reporte.service.ts`). El controlador revisa y commitea.
- **Antes de tocar un archivo que no es de este plan** (`salones.module.ts`, `salones.controller.ts`,
  `mermas.service.ts`, `seeder.service.ts`): `git status --short <archivo>`. Si tiene cambios sin
  commitear que no son tuyos, **parar y reportar**: no editar encima del trabajo de otra sesión.
- Antes de cada `npm run test:e2e`: `./scripts/reset-db.sh`. **Todo e2e en primer plano.** No tocar
  `backend/src` con un e2e corriendo (el watcher recompila y re-siembra). Ante un e2e raro:
  `./scripts/reset-db.sh --verificar`.
- Gate completo por tarea: backend `npm run lint:check && npm run typecheck && npm test && npm run test:e2e`;
  frontend `npm run build && npm test && npm run typecheck:ratchet && npm run design:check`. **Entero,
  no un subset**, mirando el exit code (nunca `| tail`).
- **Motor de cálculo intocable** (`backend/src/modules/calculo-precios/`): ninguna tarea lo importa ni
  lo llama. El ticket promedio **no** usa `cuantizar` (spec § 4.1).
- **Nada fiscal.** Las notas de crédito se **excluyen** del vendido (como `GET /ventas/resumen`); si
  además se restan es una pregunta del owner en su propio frente.
- `tenant_id` sale del token (`JwtUser`), nunca del body, query ni parámetro.
- Plata con Decimal.js o `numeric` de Postgres, **nunca `number`**. Montos como texto. Ticket promedio
  y variación son **proyecciones de lectura a `ESCALA_COSTO` (4)**
  (`backend/src/common/constants/escalas.ts`). Variación en decimal: `0.1300` = 13%.
- Soft delete: toda lectura nueva filtra `eliminado_el IS NULL`. Una excepción deliberada lleva
  **su porqué escrito dentro del SQL**.
- **Sin N+1:** número fijo de consultas por request, nunca una por fila.
- "Hoy" = día local del tenant, **cortado a medianoche**: `fechaLocalTenant` +
  `bordeFechaSql`/`bordeHastaSql` con `zonaHorariaTenant` (`common/utils/rango-fecha.util.ts`).
  La semana pasada es la misma fecha menos 7 días. **No construir hora de corte** (`pendientes.md` § 3).
- IDs fijos del seed: patrón `550e8400-e29b-41d4-a716-446655440XXX`. Hoy el máximo es `…406`.
  **Verificar con grep antes de usar cada uno**: la otra sesión también siembra.
- Fixtures de e2e **propios**: nunca la garzona Ana ni los garzones del seed.
- Tests con valores que **discriminan**: nada de cantidad 1, montos iguales entre venta y pago, ni
  factores iguales.
- Subagentes en Sonnet salvo decisión del owner.

---

### Task 1: El módulo, su permiso y el bloque de ventas

**Files:**
- Create: `backend/src/modules/resumen-negocio/resumen-negocio.module.ts`
- Create: `backend/src/modules/resumen-negocio/resumen-negocio.controller.ts`
- Create: `backend/src/modules/resumen-negocio/resumen-negocio.service.ts`
- Create: `backend/src/modules/resumen-negocio/resumen-negocio.service.spec.ts`
- Modify: `backend/src/app.module.ts` (import del módulo; **no** hay entidad nueva)
- Modify: `backend/src/modules/seeder/seeder.service.ts` (`seedModulosApp` ~`:623`,
  `seedModuloAppPermisos` ~`:783`, `seedTenantModulo` ~`:1772`)
- Test: `backend/test/resumen-negocio.e2e-spec.ts` (nuevo)
- Docs: `docs/features/dashboard-inicio.md` (nuevo, desde `docs/features/TEMPLATE.md`) + link en
  `docs/README.md`; `docs/PRODUCTO.md`; `docs/ARCHITECTURE.md`; `docs/features/roles-permisos.md`;
  `docs/agent/pendientes.md`

**Interfaces:**
- Produces:
  ```ts
  export interface Comparado<T = string> {
    hoy: T;
    semanaPasada: T;
    variacion: string | null;   // (hoy − semanaPasada) / semanaPasada, toFixed(4); null si semanaPasada = 0
  }
  export interface VentasHoy {
    vendido: Comparado;
    cobrado: Comparado;
    cantidad: Comparado<number>;
    ticketPromedio: Comparado<string | null>;   // null si esa cantidad es 0
    porCanal: { fisico: string; online: string };   // vendido de hoy
  }
  export interface PorCobrar { cantidad: number; saldo: string }
  export interface ResumenNegocioHoy {
    fecha: string;              // 'YYYY-MM-DD', día local del tenant
    ventas: VentasHoy;
    porCobrar: PorCobrar;
    // la Task 2 agrega: perdidas, masVendidos
  }
  // ResumenNegocioService
  hoy(tenantId: string): Promise<ResumenNegocioHoy>
  ```
  `GET /api/resumen-negocio/hoy`, `@RequiresPermiso('Resumen del negocio', 'Leer')`, sin parámetros.

**El molde:** `VentasService.resumen` (`backend/src/modules/ventas/ventas.service.ts` ~`:2797`) es la
cuenta más cercana: **abrirlo** y leer cómo saca el saldo desde `pago_aplicaciones`. El service nuevo
inyecta `Db` como `cuenta-asignaciones.service.ts`. Controller fino: valida y delega.

**El contrato del SQL:**
- **Rango:** `fecha = await fechaLocalTenant(db, tenantId, new Date())` y `zona` una sola vez. Hoy =
  `bordeFechaSql(col, '>=', fecha, …)` + `bordeHastaSql(col, fecha, …)`. Semana pasada = lo mismo con
  la fecha menos 7 días, calculada **en SQL** (`$n::date - 7`) o en TS sobre la fecha pura, no sobre un
  `Date` en UTC.
- **Vendido, cantidad, por canal:** `ventas v` con `v.tenant_id = $1`, `v.eliminado_el IS NULL`,
  `v.estado <> 'cancelada'`, y **sin notas de crédito**: `LEFT JOIN tipos_documento_tributario td ON
  td.tipo_documento_id = v.tipo_documento_id` y `COALESCE(td.es_nota_credito, false) = false`. El
  `JOIN` a `td` va **sin filtro de borrado, con el porqué en el SQL**: *"un tipo de documento dado de
  baja después no deja de marcar como nota de crédito a la venta que ya lo usó"*. Así no hace falta
  copiar `tipoNotaCreditoDelTenant` ni cae la trampa de su docblock (un `IS DISTINCT FROM NULL` que
  deja afuera las ventas sin tipo). Hoy y semana pasada en **una** consulta con `FILTER (WHERE …)`.
- **Cobrado:** `Σ pa.monto` de `pagos p JOIN pago_aplicaciones pa ON pa.pago_id = p.pago_id AND
  pa.tipo = 'venta' AND pa.eliminado_el IS NULL`, con `p.eliminado_el IS NULL` y `p.creado_el` en el
  rango. Una consulta para los dos rangos.
- **Por cobrar:** ventas `estado IN ('pendiente', 'pagada_parcial')`, sin NC, **de cualquier fecha**:
  `COUNT` y `Σ (total_final − lo aplicado)`, con la misma forma que `saldo_pendiente` de
  `VentasService.resumen`.
- **Ticket promedio y variación** en el mapeo, con Decimal y `toFixed(ESCALA_COSTO)`.
- **Tres o cuatro consultas en total**, sin importar cuántas ventas haya.

- [ ] **Step 1: Medir antes de escribir.** Leer `crearNotaCredito` (`ventas.service.ts` ~`:1462`) y el
  camino de anular (`POST /ventas/:id/anular`): ¿la NC escribe `pagos`/`pago_aplicaciones`? ¿Una venta
  cancelada puede tener pagos? Anotar la respuesta en el docblock de la consulta de cobrado. Si la NC
  sí escribe aplicaciones `tipo = 'venta'`, **parar y reportar**: el cobrado las contaría y la
  exclusión es una decisión.
- [ ] **Step 2: Unitarios que fallan** en `resumen-negocio.service.spec.ts`, con `Db.query` mockeado
  por orden de llamada (molde: `backend/src/modules/mermas/mermas.service.spec.ts` ~`:534`):
  - vendido hoy `'184500.0000'` y semana pasada `'150000.0000'` → `variacion '0.2300'`;
  - semana pasada `'0'` → `variacion null`; cantidad 0 → `ticketPromedio.hoy null`;
  - ticket con división no exacta: vendido `'100000.0000'`, cantidad 3 → `'33333.3333'`;
  - el SQL de ventas excluye canceladas y NC: afirmar sobre **la cláusula** (`/v\.estado\s*<>\s*'cancelada'/`,
    `/COALESCE\(td\.es_nota_credito,\s*false\)\s*=\s*false/`), no con un `toContain` suelto que puede
    matchear el comentario;
  - el cobrado lee `pago_aplicaciones` con `tipo = 'venta'`, no `pagos.monto` (que trae el vuelto);
  - **la zona:** con `fechaLocalTenant` devolviendo `'2026-09-18'` (mock de la consulta de zona con
    `America/Santiago`) los parámetros del rango son `'2026-09-18'` y la zona, y el de la semana
    pasada es `'2026-09-11'`. Es el único lugar donde se prueba "22:00 de Chile es hoy" (spec § 9).
- [ ] **Step 3: Verlos fallar.**
- [ ] **Step 4: Implementar** service, controller, módulo, registro en `app.module.ts` y seed:
  - `seedModulosApp`: `{ moduloAppId: '…407', nombre: 'Resumen del negocio', url: '/', icono:
    'mdi-view-dashboard-outline', tieneConfiguracion: false }`.
  - `seedModuloAppPermisos`: `{ moduloAppPermisoId: '…408', moduloAppId: RESUMEN, permisoId: LEER }`.
    **No** se crea una acción nueva.
  - `seedTenantModulo`: `{ moduloTenantId: '…409', tenantId: Paris (…007), moduloAppId: '…407', estado:
    'activo', expiraEn: 2026-12-31 }`, al lado del de Ventas, con el comentario *"se vende junto con
    Ventas (spec 2026-09-18-dashboard-inicio § 5.4); el código no lo obliga"*. **El segundo tenant no
    lo contrata**: es el caso de 403 del e2e.
  - Ningún rol del seed recibe el permiso: el admin lo tiene por ser rol fijo.
- [ ] **Step 5: Verlos pasar.**
- [ ] **Step 6: E2E** `resumen-negocio.e2e-spec.ts` (molde de login y caja:
  `test/ventas.e2e-spec.ts` ~`:160-200` y `test/helpers/caja.ts`):
  - `200` con `admin.paris@paris.cl`; `403` con un usuario del seed que tenga `Ventas: Leer` y no el
    módulo nuevo (buscarlo en `seedRolesUsuarios`; si no hay, crear el rol por API en el `beforeAll`);
    `403` para el admin del segundo tenant (`loginSegundoTenant`, `test/helpers/segundo-tenant.ts`),
    que no contrató el módulo;
  - **delta por el camino de la app**: leer `/hoy`, abrir caja, crear **A** pagada entera y **B**
    pendiente (sin `pagos`), abonar a B un monto **distinto** de los dos totales, volver a leer. El
    total de cada venta lo calcula el servidor: **leerlo de la respuesta** (`totalFinal`), no fijarlo
    en el test. Esperado, con Decimal en el test: vendido `+ (A + B)`, cantidad `+2`, cobrado
    `+ (A + abono)`, por cobrar `+1` y `+ (B − abono)`. Usar un ítem propio con precio que no sea
    redondo, para que A y B difieran;
  - una venta **anulada** no mueve el vendido: crearla pendiente, **sin pagos y sin
    `tipoDocumentoId`** (es lo único que `POST /ventas/:id/anular` acepta, `docs/features/ventas.md`
    ~`:133`), anularla y volver a leer;
  - la ruta no acepta tenant de afuera: `GET /hoy?tenantId=<segundo tenant>` devuelve lo mismo que sin
    el parámetro.
  ⚠️ Todo helper que lea `.body` mira antes el `.status` (`node scripts/check-e2e-status.mjs --staged`).
- [ ] **Step 7: Docs.**
  - `docs/features/dashboard-inicio.md` desde el template: qué muestra, las reglas de § 4 de la spec
    (vendido sin canceladas ni NC, cobrado desde aplicaciones, por cobrar de cualquier fecha, variación
    `null`), y el porqué del permiso propio. Link en `docs/README.md`.
  - `PRODUCTO.md`: el módulo "Resumen del negocio" **se vende con Ventas**, al lado de la regla de
    `MiCaja` + `Cajas`, con la misma advertencia (el código no lo obliga).
  - `ARCHITECTURE.md`: `resumen-negocio` en el mapa de módulos.
  - `roles-permisos.md`: el par `Resumen del negocio: Leer`, qué gobierna, y **por qué no
    `Ventas: Leer`** (la cajera lo necesita para reimprimir y vería la facturación del local).
  - `pendientes.md` § 4, entrada nueva: *"¿El vendido del día resta las notas de crédito?"* — pregunta
    fiscal, va en su propio frente (ADR-010); hoy se excluyen y la pantalla lo rotula "antes de notas
    de crédito".
- [ ] **Step 8: Gate completo**, stagear por ruta. Revisión: `domain-reviewer` **y**
  `api-security-reviewer` (ruta nueva).

---

### Task 2: Pérdidas y lo más vendido

**Files:**
- Modify: `backend/src/modules/resumen-negocio/resumen-negocio.service.ts`
- Modify: `backend/src/modules/resumen-negocio/resumen-negocio.module.ts`
- Modify: `backend/src/modules/salones/salones.module.ts` (exportar `AnulacionesReporteService`)
- Modify: `backend/src/modules/mermas/mermas.service.ts` (método nuevo de agregación)
- Test: `backend/src/modules/resumen-negocio/resumen-negocio.service.spec.ts`
- Test: `backend/src/modules/mermas/mermas.service.spec.ts`
- Test: `backend/test/resumen-negocio.e2e-spec.ts`
- Docs: `docs/features/dashboard-inicio.md`

**Interfaces:**
- Consumes: `AnulacionesReporteService.resumen(tenantId, dto: ResumenAnulacionesDto):
  Promise<ResumenAnulaciones>` y sus tipos `GrupoResumen`, `CostoPorMoneda`
  (`backend/src/modules/salones/anulaciones-reporte.service.ts`); `ResumenNegocioHoy` de la Task 1.
- Produces:
  ```ts
  // MermasService
  resumen(tenantId: string, desde: string, hasta: string): Promise<ResumenMermas>
  export interface ResumenMermas {
    cantidad: number;              // mermas del rango
    costo: CostoPorMoneda[];       // Σ por moneda del ítem, solo las valorizadas
    sinValorizar: number;          // cuántas quedaron con costo null
  }
  // ResumenNegocioHoy suma:
  perdidas: {
    anulaciones: ResumenAnulaciones['porTipo'];
    mermas: ResumenMermas;
  };
  masVendidos: { itemId: string; itemNombre: string; cantidad: string; monto: string }[];  // hasta 5
  ```

**El contrato:**
- **Anulaciones:** llamar a `AnulacionesReporteService.resumen` con `desde = hasta = fecha` (fecha
  pura: su `bordeHastaSql` ya incluye el día entero) y quedarse con `porTipo`. **No** reescribir su
  SQL. ⚠️ Ese archivo tiene cambios sin commitear de otra sesión: leerlo, no editarlo. Si la firma
  difiere de la de arriba, adaptarse a la real y avisar.
- **Mermas:** la agregación vive en `MermasService` (dueño del dato), con **el mismo filtro de tipo
  que su listado** (desde el commit `2e1fad74` el listado deja afuera las cortesías; abrir
  `buildFilters` y reusarlo, no copiarlo). El costo por fila es el mismo número que `costoPerdido`
  (`ROUND(cantidad * costo_unitario, 4)`), agrupado por `items.moneda_id` como hace el reporte de
  anulaciones. Una fila con `costo_unitario IS NULL` **suma 1 a `sinValorizar` y no suma a `costo`**:
  es la regla 6 de la spec del costo sin tipear (`pendientes.md` § 3). **Esa entrada no se cierra**:
  habla de un reporte de mermas.
- **Lo más vendido:** `venta_detalles vd JOIN ventas v` con los mismos filtros de venta que el
  vendido de la Task 1 (sin canceladas, sin NC, rango de hoy), `GROUP BY vd.item_id`, `Σ vd.total_linea`
  como monto, `Σ` de la cantidad en unidad base, `ORDER BY monto DESC, item_id LIMIT 5`. El nombre del
  ítem **sin filtro de borrado, con el porqué en el SQL** (*"se vendió hoy; darlo de baja después no
  lo saca de lo vendido"*). **Abrir `venta-detalle.entity.ts`** para confirmar qué columna es la
  cantidad en unidad base antes de escribir la suma.
- **No hay total de pérdidas** (spec § 4.4): no sumar anulaciones con mermas en ningún lado.

- [ ] **Step 1: Unitarios que fallan.**
  - `MermasService.resumen`: tres mermas (`CLP 4300.0000`, `USD 3.5000`, y una sin costo) →
    `cantidad 3`, `costo` de dos entradas, `sinValorizar 1`; el SQL filtra `eliminado_el` y el tipo como
    el listado.
  - `ResumenNegocioService.hoy`: pasa `{ desde: fecha, hasta: fecha }` al resumen de anulaciones y
    devuelve su `porTipo` tal cual; `masVendidos` mapea hasta 5 filas; la consulta de más vendidos
    excluye canceladas y NC (afirmar sobre la cláusula).
- [ ] **Step 2: Verlos fallar.** **Step 3: Implementar.** **Step 4: Verlos pasar.**
- [ ] **Step 5: E2E**, en el mismo archivo y con delta: anular un plato despachado como **cortesía**
  (molde: `test/salones-anular-linea.e2e-spec.ts`, con salón, mesa y garzón propios) mueve
  `perdidas.anulaciones` de tipo `cortesia`; registrar una merma sin costo cargado (`POST /mermas`,
  molde `test/mermas.e2e-spec.ts`) sube `sinValorizar` en 1 sin mover `costo`; una venta de un ítem
  propio con precio muy alto (p. ej. `'9990000.0000'`, para ganarle a cualquier venta del seed o de
  otros specs del día) sale **primera** en `masVendidos` con su `monto` igual al `totalFinal` de la
  línea.
- [ ] **Step 6: Docs:** `dashboard-inicio.md` suma pérdidas y lo más vendido, y **por qué no hay
  total de pérdidas**.
- [ ] **Step 7: Gate completo**, stagear. Revisión: `domain-reviewer`.

---

### Task 3: La ocupación del salón

**Files:**
- Modify: `backend/src/modules/salones/salones.controller.ts` (ruta estática, junto a `anulaciones`)
- Modify: `backend/src/modules/salones/salones.service.ts`
- Test: `backend/src/modules/salones/salones.service.spec.ts`
- Test: `backend/test/salones-ocupacion.e2e-spec.ts` (nuevo; molde de login con PIN y fixtures de
  salón: `test/salones-anular-linea.e2e-spec.ts`)

**Interfaces:**
- Produces:
  ```ts
  export interface OcupacionSalones { mesasOcupadas: number; mesasTotal: number; cuentasAbiertas: number }
  // SalonesService
  ocupacion(tenantId: string): Promise<OcupacionSalones>
  ```
  `GET /api/salones/ocupacion`, `@RequiresPermiso('Salones', 'Ver todas')`.

**El contrato:** **una** consulta. Mesa ocupada = mesa no borrada, de un salón no borrado, con al
menos una `cuentas.estado = 'abierta'` no borrada. `cuentasAbiertas` cuenta cuentas abiertas no
borradas, tengan mesa o no. **Abrir `listarSalonesOperacion`** y usar su misma noción de "mesa con
cuenta abierta": si la de ahí difiere de la de acá, gana la de ahí y se documenta. La ruta es
estática: declararla **antes** de cualquier `@Get(':id…')` del controller. ⚠️ `salones.controller.ts`
y `salones.module.ts` los toca también la otra sesión: `git status` antes (Global Constraints).

- [ ] **Step 1: Unitario que falla:** el mapeo de la fila (`'14'`, `'20'`, `'16'` como vienen de
  `COUNT` en pg) a números, y el SQL con `estado = 'abierta'` y los filtros de borrado de mesa, salón y
  cuenta, afirmados sobre la cláusula.
- [ ] **Step 2: Verlo fallar.** **Step 3: Implementar.** **Step 4: Verlo pasar.**
- [ ] **Step 5: E2E:** `403` con `ana.torres@paris.cl` (Leer + Operar, sin Ver todas); `200` con
  `encargado.salon@paris.cl` y el admin; abrir una cuenta en una mesa propia sube `mesasOcupadas` y
  `cuentasAbiertas` en 1 (delta); cerrarla o cancelarla los baja.
- [ ] **Step 6: Gate completo**, stagear. Revisión: `domain-reviewer` y `api-security-reviewer`.

---

### Task 4: La zona "Ahora" y el refresco periódico

**Files:**
- Create: `frontend/app/composables/useRefrescoPeriodico.ts`
- Create: `frontend/app/composables/useRefrescoPeriodico.spec.ts`
- Create: `frontend/app/components/inicio/InicioSalon.vue`
- Create: `frontend/app/components/inicio/InicioCajas.vue`
- Create: `frontend/app/components/inicio/InicioCierres.vue`
- Create: `frontend/app/components/inicio/InicioAhora.nuxt.spec.ts`
- Modify: `frontend/app/pages/index.vue`
- Docs: `docs/patterns/frontend.md`, `docs/features/dashboard-inicio.md`

**Interfaces:**
- Consumes: `GET /salones/ocupacion` (Task 3), `GET /caja/cajones-estado` y
  `GET /caja/resumen-descuadres-dia` (existen: **abrir `caja.service.ts`** `cajonesEstado` ~`:1938`
  y el tipo `CajonEstado`, y `docs/features/gestion-cajas.md` "La jornada de un vistazo", para la
  forma exacta de cada respuesta).
- Produces:
  ```ts
  export function useRefrescoPeriodico<T>(
    cargar: () => Promise<T>,
    opts?: { intervaloMs?: number },          // default 60_000
  ): {
    datos: Ref<T | null>;
    actualizadoEl: Ref<Date | null>;          // última carga exitosa
    sinConexion: Ref<boolean>;                // la última carga falló
    oculto: Ref<boolean>;                     // respondió 403: el bloque no se muestra
    refrescar: () => Promise<void>;
  }
  ```

**El contrato del composable:**
- Carga al montar. Después, un `setInterval` de `intervaloMs` que **solo carga si
  `document.visibilityState === 'visible'`**; al volver a visible (`visibilitychange`) carga una vez.
  `onScopeDispose` limpia intervalo y listener.
- Si la carga falla: `datos` conserva el último valor, `sinConexion = true`, **y no se reintenta hasta
  el próximo tick** (el owner no quiere reintentos automáticos: memoria `sin-reintento-automatico`).
  Una carga exitosa pone `sinConexion = false` y actualiza `actualizadoEl`.
- Un **403** pone `oculto = true` y **detiene el intervalo**: es un módulo no contratado, no una falla
  (spec § 6). Leer el status del error como lo hace `apiErrorMsg` / `useApiFetch`.
- Sin dependencias nuevas (no hay `@vueuse/core` declarado en `package.json`).

**La pantalla:**
- `index.vue`: saludo arriba, más chico; debajo la zona **"Ahora"** con los tres bloques, cada uno
  montado solo si `permissionsStore.esAdmin || permissionsStore.can(módulo, permiso)`
  (`Salones`/`Ver todas`, `Cajas`/`Leer`, `Cajas`/`Leer`). **Un bloque no montado no hace su
  llamada.** La página no tiene lógica: ordena componentes.
- Cada bloque usa `useRefrescoPeriodico`, muestra "Actualizado HH:MM" y, con `sinConexion`, un aviso
  "Sin conexión — se reintenta en el próximo ciclo" sin borrar el dato. Con `oculto`, no renderiza nada.
- Cajas: nombre del cajón y quién la tiene, **sin montos**. Cierres: cierres, con descuadre y suma del
  efectivo (`formatMonto`). Salón: "14 de 20 mesas ocupadas · 16 cuentas abiertas".
- Links: Salón → `/salones`; Cajas y Cierres → la bandeja de `/cajas`.
- Solo tokens semánticos de Nuxt UI (`UCard`, `text-muted`, `text-highlighted`…); `design:check` lo
  enforcea. Invocar la skill `nuxt-ui` antes de escribir los `.vue`.

- [ ] **Step 1: Tests que fallan** de `useRefrescoPeriodico.spec.ts`, con `vi.useFakeTimers()` y
  `document.visibilityState` stubbeado:
  - carga al inicio y otra vez a los 60 s;
  - con la pestaña oculta el tick no carga; al volver a visible carga una vez;
  - un fallo conserva `datos`, pone `sinConexion`, y **no** vuelve a llamar antes del próximo tick
    (contar llamadas del mock);
  - un 403 pone `oculto` y no hay más llamadas en los ticks siguientes.
- [ ] **Step 2: Verlos fallar.** **Step 3: Implementar el composable.** **Step 4: Verlos pasar.**
- [ ] **Step 5: Tests de pantalla** `InicioAhora.nuxt.spec.ts` (molde:
  `pages/salones/anulaciones.nuxt.spec.ts`, con `mockNuxtImport` de `usePermissionsStore` y
  `useApiFetch`, registrando las URLs pedidas): sin `Salones: Ver todas` no se pide
  `/salones/ocupacion`; con `Cajas: Leer` se piden las dos de caja; el texto de ocupación sale de la
  respuesta. ⚠️ Los bodies simulados tienen **la forma real** de cada ruta (copiarla del tipo del
  backend), no una inventada: el mock contesta 200 a lo que sea.
- [ ] **Step 6: Implementar** los tres bloques y la página. **Step 7: Verlos pasar.**
- [ ] **Step 8: Docs:** `patterns/frontend.md`, el refresco periódico (cuándo usarlo, por qué no
  reintenta, el 403 que oculta); `dashboard-inicio.md`, la zona "Ahora".
- [ ] **Step 9: Gate completo del frontend**, stagear. Revisión: `domain-reviewer`.

---

### Task 5: La zona "Hoy"

**Files:**
- Create: `frontend/app/types/resumen-negocio.ts`
- Create: `frontend/app/components/inicio/InicioHoy.vue` (zona: carga, "Actualizar", 403 oculta)
- Create: `frontend/app/components/inicio/InicioVentas.vue`
- Create: `frontend/app/components/inicio/InicioPorCobrar.vue`
- Create: `frontend/app/components/inicio/InicioPerdidas.vue`
- Create: `frontend/app/components/inicio/InicioMasVendidos.vue`
- Create: `frontend/app/components/inicio/InicioHoy.nuxt.spec.ts`
- Modify: `frontend/app/pages/index.vue`
- Docs: `docs/features/dashboard-inicio.md`, `docs/ESTADO.md`

**Interfaces:**
- Consumes: `ResumenNegocioHoy` de las Tasks 1 y 2. El tipo del frontend (`types/resumen-negocio.ts`)
  **se copia de la interfaz del backend**, campo por campo.

**La pantalla:**
- Zona **"Hoy"** debajo de "Ahora", montada solo con `esAdmin || can('Resumen del negocio', 'Leer')`.
  Una sola llamada a `/resumen-negocio/hoy` al montar y un botón "Actualizar". **No** usa el refresco
  periódico. Un 403 oculta la zona entera, sin aviso.
- Ventas: vendido (rótulo **"antes de notas de crédito"**) y cobrado grandes; cantidad, ticket
  promedio y local/online chicos. Cada uno con "vs. <día> pasado" y la variación con
  `formatPorcentaje(v, 0)`; `null` sale "—" (ya lo hace `formatPorcentaje`). Montos con `formatMonto`.
- Por cobrar: "N ventas · $X por cobrar".
- Pérdidas: anulaciones por tipo con platos y precio de carta, costo con `formatCostoPorMoneda`; mermas
  con su costo y, si `sinValorizar > 0`, "N sin costo cargado". **Sin total.**
- Lo más vendido: lista de hasta 5, nombre, cantidad y monto.
- Links: Ventas y Por cobrar → `/ventas`; Pérdidas → `/salones/anulaciones` y `/mermas`.

- [ ] **Step 1: Tests que fallan** `InicioHoy.nuxt.spec.ts`: sin el permiso no se pide
  `/resumen-negocio/hoy`; con él, una sola llamada; "Actualizar" hace otra; `variacion null` muestra
  "—"; `sinValorizar 2` muestra el aviso y `0` no; una respuesta 403 no renderiza la zona. Bodies con
  la forma exacta de `ResumenNegocioHoy`.
- [ ] **Step 2: Verlos fallar.** **Step 3: Implementar.** **Step 4: Verlos pasar.**
- [ ] **Step 5: Docs:** `dashboard-inicio.md` completo; fila en `docs/ESTADO.md` (✅ con fecha).
- [ ] **Step 6: Gate completo del frontend**, stagear. Revisión: `domain-reviewer`.

---

### Task 6: Smoke en el navegador, mutantes y cierre

**Files:** los de las tareas anteriores (solo correcciones que salgan de acá).

- [ ] **Step 1:** `./scripts/reset-db.sh` **antes** de probar.
- [ ] **Step 2: Smoke en Chrome con devtools** (no en el navegador de Claude: el owner mira la ventana
  real y ahí se ven las llamadas):
  - admin de Paris: las dos zonas; vender algo en `/ventas` y volver: "Hoy" cambia al tocar
    "Actualizar", "Ahora" no pide `/resumen-negocio/hoy`;
  - abrir una mesa y esperar un ciclo: la ocupación sube sola y "Actualizado" cambia;
  - pestaña oculta más de un minuto: la red no muestra llamadas; al volver, una;
  - `encargado.salon@paris.cl`: ve Salón y no ve "Hoy" ni pide su ruta;
  - admin del segundo tenant: sin "Hoy", sin error en pantalla (el 403 queda en la red, oculto);
  - cortar el backend un ciclo: aviso "Sin conexión" con el dato anterior.
- [ ] **Step 3: Mutantes que revierten** (spec § 9), uno por vez, con el watcher: tras revertir,
  verificar en los logs la hora del restart antes de seguir.

  | Mutante | Test que tiene que caer |
  |---|---|
  | Sacar el filtro de NC del vendido | unitario de la cláusula + e2e si hay NC en el delta |
  | Contar las canceladas | e2e de la venta anulada |
  | Sumar `pagos.monto` en vez de las aplicaciones | unitario de cobrado |
  | Omitir las mermas sin costo en vez de contarlas | unitario de `MermasService.resumen` + e2e |
  | Sacar `eliminado_el IS NULL` de ventas | unitario de la cláusula |
  | El composable reintenta al fallar | test del fallo (cuenta de llamadas) |

  Anotar en el cierre qué test mató a cada uno. Un superviviente se intenta matar con otro fixture
  antes de declararlo, y el motivo se mide.
- [ ] **Step 4: Gate completo** backend y frontend, `./scripts/reset-db.sh --verificar` después del
  e2e, y `verify-feature` entero con la revisión independiente.

---

## Verification

- Backend: `npm run lint:check && npm run typecheck && npm test && npm run test:e2e` (con reset antes
  y `--verificar` después).
- Frontend: `npm run build && npm test && npm run typecheck:ratchet && npm run design:check`.
- Smoke en Chrome (Task 6) y mutantes con su tabla completa.
- Revisión independiente (`domain-reviewer`) por commit; `api-security-reviewer` en las rutas nuevas.

## Decisions / Open questions

- **La acción es `Leer`, no "Ver".** La spec decía "Ver" y se corrigió al escribir este plan: el
  catálogo de permisos ya tiene `Leer` y el reporte de anulaciones tampoco creó acciones nuevas.
  El owner decidió el concepto (un permiso propio del módulo), no el nombre de la acción.
- **El ticket promedio no se cuantiza con la configuración del tenant.** Es proyección de lectura a
  escala 4 y lo formatea la pantalla, como el costo perdido y el precio de carta. Cuantizarlo obligaba
  a importar `cuantizar` del motor. También corregido en la spec.
- **El borde de la zona horaria se prueba en el unitario, no en el e2e**: la ruta no recibe fecha y el
  e2e no controla el reloj. Corregido en la spec.
- **El admin de un tenant sin el módulo ve el bloque y recibe 403** (medido: `mis-permisos` le devuelve
  `[]` y el frontend lo deja pasar por `esAdmin`). Se resuelve ocultando ante 403, sin tocar RBAC.
- **Abierta, para el owner en su frente fiscal:** si el vendido resta las notas de crédito
  (`pendientes.md` § 4, la agrega la Task 1).
- **Diferida:** biblioteca de gráficos (spec § 8) y hora de corte (`pendientes.md` § 3).
