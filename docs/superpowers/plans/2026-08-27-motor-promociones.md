# Motor de promociones (Fase 1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el módulo de promociones de Fase 1 —happy hour %, 2x1/NxM, precio
fijo de combo— como campañas configurables que un evaluador cross-carrito aplica dentro
del motor de precios como familia propia, trazable y congelada por venta.

**Architecture:** CRUD de campañas (molde descuentos/recargos, admin-only) + evaluador
puro sin I/O (`promociones.evaluator.ts`, molde del engine) enganchado en
`CalculoPreciosService.calcular`; el motor aplica las aplicaciones como monto fijo dentro
del paso `descuentos` con traza propia y resuelve el interruptor promo-vs-descuento; la
venta congela en `ventas_promociones`.

**Tech Stack:** NestJS + TypeORM (synchronize) + Decimal.js + Jest/supertest; Nuxt 4 +
Nuxt UI en el frontend.

**Spec:** `docs/superpowers/specs/2026-08-27-motor-promociones-design.md` — el plan
argumenta desde ella; ante duda de regla de negocio, **la spec manda** y sus 4 decisiones
del owner no se re-deciden.

## Global Constraints

- ⛔ **Sistema quieto:** toca el motor de precios. No ejecutar mientras otra sesión use el
  stack; correr en el checkout principal con `docker-compose up` propio.
- `tenant_id` siempre del token; dinero/porcentajes con Decimal.js (0.19 = 19%); soft
  delete + `eliminado_el IS NULL` en toda lectura; PK/FK `type: 'uuid'` explícito.
- **Toda entidad nueva va TAMBIÉN en el array `entities` de `app.module.ts`** (no hay
  autoLoadEntities; solo el e2e lo caza).
- `RepositoriosModule.forFeature`, **nunca** `TypeOrmModule.forFeature` (ADR-020).
- Nada de N+1: catálogo de promos en 1 query batch.
- Las promos **nunca** viajan en el request; el instante **nunca** viaja por valor desde
  el cliente.
- Frontend: tokens semánticos Nuxt UI, `useApiFetch`, lógica en composables.
- Commits directo sobre `main`, uno por tarea como mínimo, **sin `--no-verify`** (el
  pre-commit exige el recibo de la revisión independiente cuando el diff toca services o
  `.vue` — correr el paso 7 de `verify-feature` antes de esos commits, o agrupar esos
  diffs en el cierre).
- Los subagentes ejecutores corren **solo su propio spec** de test; el gate completo lo
  corre el principal en serie al final (Tarea 14).
- Antes de cada tarea que modifica un archivo existente: **leerlo primero** (codegraph
  explore o Read). El código citado en este plan para archivos existentes es contrato,
  no copy-paste a ciegas.

---

### Task 1: Entidades + registro + interruptor del tenant

**Files:**
- Create: `backend/src/modules/promociones/entities/promocion.entity.ts`
- Create: `backend/src/modules/promociones/entities/promocion-scope.entity.ts`
- Create: `backend/src/modules/promociones/entities/promocion-scope-item.entity.ts`
- Create: `backend/src/modules/ventas/entities/venta-promocion.entity.ts`
- Modify: `backend/src/app.module.ts` (array `entities`: sumar las 4)
- Modify: `backend/src/modules/tenants/` (entidad tenant/preferencias + `getPreferenciasFinancieras` + su Update DTO — localizar con `codegraph explore "getPreferenciasFinancieras preferencias financieras entity"`)
- Test: `backend/src/modules/tenants/tenants.service.spec.ts` (ampliar el spec existente de preferencias)

**Interfaces (Produces):**
- Entidades `Promocion`, `PromocionScope`, `PromocionScopeItem`, `VentaPromocion` con los
  nombres de columna de la spec §Modelo de datos.
- `getPreferenciasFinancieras(tenantId)` devuelve además
  `promosAcumulanDescuentos: boolean` (columna
  `promos_acumulan_descuentos boolean NOT NULL DEFAULT false`), editable por el PATCH de
  preferencias existente.

- [ ] **Step 1: Leer los moldes.** `venta-descuento.entity.ts` y
  `cuenta-linea.entity.ts` son los patrones (columnas snake_case con `name:`, `type`
  explícito, `CreateDateColumn`/`UpdateDateColumn`/`DeleteDateColumn` →
  `creado_el`/`actualizado_el`/`eliminado_el`). Leer también cómo declara CHECKs el
  repo: `grep -rn "@Check" backend/src --include="*.entity.ts" | head`.

- [ ] **Step 2: Escribir `promocion.entity.ts`** (los CHECKs con la forma que use el
  repo; si no usa `@Check`, la validación de forma queda SOLO en el service — Task 2 —
  y se anota en el docblock):

```typescript
import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TipoPromocion = 'porcentaje' | 'nxm' | 'precio_fijo';

/**
 * Una campaña de promoción (Fase 1). El beneficio va inline: una promo tiene
 * exactamente un beneficio, y sus columnas son las de su `tipo` — el resto NULL
 * (CHECKs de forma: una fila no puede decir dos cosas).
 * Diseño: docs/superpowers/specs/2026-08-27-motor-promociones-design.md
 */
@Entity('promociones')
@Check(`hora_inicio IS NULL = hora_fin IS NULL`)
@Check(
  `(tipo = 'porcentaje' AND valor_porcentaje IS NOT NULL AND cada_n IS NULL AND valor_monto IS NULL)
   OR (tipo = 'nxm' AND valor_porcentaje IS NOT NULL AND cada_n IS NOT NULL AND valor_monto IS NULL)
   OR (tipo = 'precio_fijo' AND valor_monto IS NOT NULL AND valor_porcentaje IS NULL AND cada_n IS NULL)`,
)
export class Promocion {
  @PrimaryGeneratedColumn('uuid', { name: 'promocion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  /** Pausa. Pausada no aplica y NO avisa (spec §Modelo de datos). */
  @Column({ type: 'boolean', default: true })
  activo: boolean;

  /** Los dos NOT NULL: el guardarraíl heredado de eliminar `promocional`. */
  @Column({ name: 'fecha_inicio', type: 'date' })
  fechaInicio: string;

  @Column({ name: 'fecha_fin', type: 'date' })
  fechaFin: string;

  /** Franja en hora local del tenant; inicio > fin = cruza medianoche. */
  @Column({ name: 'hora_inicio', type: 'time', nullable: true })
  horaInicio: string | null;

  @Column({ name: 'hora_fin', type: 'time', nullable: true })
  horaFin: string | null;

  /** ISO-8601: 1=lunes…7=domingo. NULL = todos los días. */
  @Column({ name: 'dias_semana', type: 'smallint', array: true, nullable: true })
  diasSemana: number[] | null;

  /** 'fisico' | 'online'; NULL = ambos. */
  @Column({ type: 'text', nullable: true })
  canal: string | null;

  @Column({ type: 'text' })
  tipo: TipoPromocion;

  /** Decimal: 2x1 = '1.0000', "2do al 50%" = '0.5000'. */
  @Column({
    name: 'valor_porcentaje',
    type: 'decimal',
    precision: 7,
    scale: 4,
    nullable: true,
  })
  valorPorcentaje: string | null;

  @Column({ name: 'cada_n', type: 'smallint', nullable: true })
  cadaN: number | null;

  /** Precio del conjunto en moneda oficial (precio_fijo). */
  @Column({
    name: 'valor_monto',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  valorMonto: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

⚠️ Nota TypeORM del proyecto: **no** estrechar el tipo TS de `tipo` con `import type` ni
unión sin `type: 'text'` explícito en el `@Column` — un design:type `Object` rompe el
arranque y solo lo ve el e2e (memoria del proyecto). El `type: 'text'` ya está puesto.

- [ ] **Step 3: Escribir `promocion-scope.entity.ts` y `promocion-scope-item.entity.ts`:**

```typescript
// promocion-scope.entity.ts
@Entity('promocion_scopes')
@Check(`(tipo_scope = 'categoria') = (categoria_id IS NOT NULL)`)
export class PromocionScope {
  @PrimaryGeneratedColumn('uuid', { name: 'scope_id' })
  id: string;

  @Column({ name: 'promocion_id', type: 'uuid' })
  promocionId: string;

  /** Orden del slot dentro de la promo (0-based). */
  @Column({ type: 'smallint' })
  slot: number;

  /** 'items' | 'categoria' | 'venta' (todo el pedido). */
  @Column({ name: 'tipo_scope', type: 'text' })
  tipoScope: string;

  @Column({ name: 'categoria_id', type: 'uuid', nullable: true })
  categoriaId: string | null;

  /** Unidades que pide el slot; solo significa algo en precio_fijo. */
  @Column({ type: 'smallint', default: 1 })
  cantidad: number;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}

// promocion-scope-item.entity.ts — molde del bridge descuento_metodo_pago:
// leerlo primero y copiar su forma exacta de PK compuesta + soft delete.
@Entity('promocion_scope_items')
export class PromocionScopeItem {
  @PrimaryColumn({ name: 'scope_id', type: 'uuid' })
  scopeId: string;

  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 4: Escribir `venta-promocion.entity.ts`** (molde `VentaDescuento`, mismas
  precisiones):

```typescript
@Entity('ventas_promociones')
export class VentaPromocion {
  @PrimaryGeneratedColumn('uuid', { name: 'venta_promocion_id' })
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  /** Siempre por línea: el monto de una promo aterriza en líneas. */
  @Column({ name: 'detalle_id', type: 'uuid' })
  detalleId: string;

  /** Agrupador: la aplicación #N de la promo tocó estas filas. */
  @Column({ type: 'smallint' })
  aplicacion: number;

  /** Resoluble para siempre: el catálogo es soft delete. */
  @Column({ name: 'promocion_id', type: 'uuid' })
  promocionId: string;

  @Column({ name: 'nombre_promocion', type: 'text' })
  nombrePromocion: string;

  @Column({ type: 'text' })
  tipo: string;

  /** Qué valía: el % (decimal) o el precio fijo — `tipo` dice cómo leerlo. */
  @Column({ name: 'valor_efectivo', type: 'decimal', precision: 18, scale: 4 })
  valorEfectivo: string;

  /** Lo que restó EN ESTA línea. */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  monto: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 5: Registrar las 4 entidades en `app.module.ts`** (array `entities`) y
  correr `cd backend && npm run typecheck`. Expected: PASS.

- [ ] **Step 6 (test primero): ampliar el spec de preferencias.** En
  `tenants.service.spec.ts`, junto a los tests existentes de
  `getPreferenciasFinancieras`, agregar: *"las preferencias incluyen
  promosAcumulanDescuentos y su default es false"* y *"el PATCH de preferencias acepta
  promosAcumulanDescuentos"* (misma mecánica de mocks que los tests vecinos — leerlos y
  copiar la forma). Correr
  `npm test -- --testPathPattern=tenants` → los 2 nuevos FALLAN.

- [ ] **Step 7: Implementar la columna + lectura + escritura.** Columna
  `promos_acumulan_descuentos` (`boolean`, `default: false`) en la entidad donde viven
  las demás preferencias financieras; exponerla en `getPreferenciasFinancieras` (nombre camel
  `promosAcumulanDescuentos`); aceptarla en el Update DTO de preferencias con
  `@IsOptional() @IsBoolean()`. Correr el spec → PASS.

- [ ] **Step 8: Commit** — `feat(promociones): entidades del catálogo, el congelado y el interruptor del tenant`.

---

### Task 2: CRUD de promociones (DTOs + service + controller + module)

**Files:**
- Create: `backend/src/modules/promociones/dto/create-promocion.dto.ts` (+ `update-promocion.dto.ts`, `PartialType`)
- Create: `backend/src/modules/promociones/promociones.service.ts`
- Create: `backend/src/modules/promociones/promociones.controller.ts`
- Create: `backend/src/modules/promociones/promociones.module.ts` (+ registrar en `app.module.ts` imports)
- Test: `backend/src/modules/promociones/promociones.service.spec.ts`

**Interfaces:**
- Consumes: entidades de Task 1.
- Produces: `PromocionesService.findAll(tenantId)` → promos vivas con `scopes` (y sus
  `itemIds`) — la consumen Task 6 y el frontend; CRUD REST en `/api/promociones` con
  `TenantAdminGuard` (lectura abierta a autenticados, escritura admin — copiar el molde
  de guard del controller de descuentos, que es la referencia de "catálogo/config").

- [ ] **Step 1: Leer los moldes**: `descuentos.service.ts` (create/update transaccional
  con reemplazo de hijos, `nombreDisponible`, unique por tenant vivo),
  `descuentos.controller.ts` (guards y rutas) y sus DTOs. El CRUD de promos es la misma
  forma con otros hijos.

- [ ] **Step 2 (tests primero):** `promociones.service.spec.ts`, mismo estilo de mocks
  que `descuentos.service.spec.ts`. Casos (cada uno un `it`, escribirlos todos antes de
  implementar y verlos fallar):
  1. crear `porcentaje` con 1 scope de categoría → persiste promo + scope;
  2. crear sin `fechaFin` → 400 *"Una promoción necesita fecha de término"* (el
     guardarraíl; el DTO ya lo exige, este test cubre el camino service si el campo
     llega `undefined` por PATCH);
  3. crear `nxm` sin `cadaN` → 400; crear `porcentaje` con `valorMonto` → 400 (forma
     exacta por tipo, espejo de `validarFormaDeImporte` de reglas);
  4. `porcentaje`/`nxm` con ≠ 1 slot → 400; `precio_fijo` con 0 slots → 400;
  5. slot `tipo_scope='categoria'` sin `categoriaId` → 400; `tipo_scope='items'` sin
     ítems → 400;
  6. `horaInicio` sin `horaFin` → 400; `horaFin` con formato no `HH:mm` → 400 (el DTO);
  7. `diasSemana` con un 8 → 400;
  8. nombre duplicado vivo en el tenant → 409/400 con el mensaje del molde de
     descuentos;
  9. `update` reemplaza hijos completos (delete-all → insert, como descuentos);
  10. `remove` es soft delete y no toca los hijos;
  11. `precio_fijo` con `valorMonto` que no cabe en la escala de la moneda → lo
      rechaza el borde (`@EsMontoCobrado` — el test del DTO va aparte porque los pipes
      no corren en unit: anotar que la cobertura real del pipe es del e2e, memoria
      "tests de DTO no ejercen el pipe").

- [ ] **Step 3: DTOs.** `CreatePromocionDto`: `nombre` (`@IsString @MinLength(1)`),
  `descripcion?`, `tipo` (`@IsIn(['porcentaje','nxm','precio_fijo'])`), `fechaInicio` y
  `fechaFin` (`@IsDateString`, **ambas requeridas**), `horaInicio?`/`horaFin?`
  (`@Matches(/^\d{2}:\d{2}$/)`), `diasSemana?` (`@IsInt({each:true}) @Min(1,{each:true}) @Max(7,{each:true})`),
  `canal?` (`@IsIn(['fisico','online'])`), `valorPorcentaje?` (`@IsNumberString`),
  `cadaN?` (`@IsInt @Min(2)`), `valorMonto?` (`@IsNumberString @IsDecimalPositivo @EsMontoCobrado`),
  `scopes: ScopePromoDto[]` (`@ValidateNested @ArrayMinSize(1)`) con
  `ScopePromoDto = { tipoScope, categoriaId?, cantidad? (@IsInt @Min(1)), itemIds? (@IsUUID each) }`.
  La correspondencia campo↔tipo y slot↔scope la valida el **service** (es regla entre
  hermanos, un decorador no la lee — precedente documentado en descuentos).

- [ ] **Step 4: Implementar service + controller + module** hasta que el spec pase.
  Module: `RepositoriosModule.forFeature([Promocion, PromocionScope, PromocionScopeItem])`.
  Correr `npm test -- --testPathPattern=promociones` → PASS; `npm run lint` → PASS.

- [ ] **Step 5: Commit** — `feat(promociones): CRUD de campañas con validación de forma por tipo`.

---

### Task 3: Evaluador puro — tipos, elegibilidad, `porcentaje` y `nxm`

**Files:**
- Create: `backend/src/modules/promociones/promociones.evaluator.ts`
- Test: `backend/src/modules/promociones/promociones.evaluator.spec.ts`

**Interfaces (Produces — Tasks 4, 6 y 7 dependen de estas formas exactas):**

```typescript
export interface VentanaPromo {
  fechaInicio: string;            // 'YYYY-MM-DD'
  fechaFin: string;
  horaInicio: string | null;      // 'HH:mm'; inicio > fin = cruza medianoche
  horaFin: string | null;
  diasSemana: number[] | null;    // ISO 1..7; null = todos
  canal: string | null;           // 'fisico' | 'online' | null = ambos
}

export interface ScopePromoResuelto {
  slot: number;
  tipoScope: 'items' | 'categoria' | 'venta';
  categoriaId: string | null;
  cantidad: number;
  itemIds: string[];              // solo tipoScope='items'
}

export interface PromoElegible {
  id: string;
  nombre: string;
  tipo: 'porcentaje' | 'nxm' | 'precio_fijo';
  valorPorcentaje: string | null;
  cadaN: number | null;
  valorMonto: string | null;
  ventana: VentanaPromo;
  scopes: ScopePromoResuelto[];
}

/** El instante LOCAL de una línea, ya colapsado por el service. */
export interface InstanteLocal {
  fecha: string;                  // 'YYYY-MM-DD'
  hora: string;                   // 'HH:mm'
  diaIso: number;                 // 1=lunes..7=domingo
}

export interface LineaPromo {
  index: number;                  // índice en dto.lineas — el cruce es SIEMPRE por índice
  itemId: string;
  categoriaId: string | null;
  cantidad: string;               // canónica (Decimal string)
  netoUnitario: string;           // convertido a oficial, ANTES de descuentos
  instante: InstanteLocal;        // cuándo se pidió (decisión 4 del owner)
}

export interface AplicacionPromo {
  promocionId: string;
  nombre: string;
  tipo: string;
  valorEfectivo: string;          // el % decimal o el precio fijo
  montosPorLinea: { lineaIndex: number; monto: string }[]; // fino, todos > 0
}

export function evaluarPromos(input: {
  promos: PromoElegible[];
  lineas: LineaPromo[];
  canal: 'fisico' | 'online';
}): AplicacionPromo[];

/** Exportada para test directo: ¿este instante local cae en la ventana? */
export function instanteEnVentana(v: VentanaPromo, i: InstanteLocal): boolean;
```

Reglas fijadas por la spec que el código implementa tal cual (§El evaluador):
unidades = línea explotada por ⌊cantidad⌋ para `nxm`/`precio_fijo` (fraccionarias solo
en `porcentaje`, con neto proporcional a la cantidad completa); `instanteEnVentana`
compara strings (`fechaInicio <= fecha <= fechaFin`; hora con wrap si `inicio > fin`:
`hora >= inicio || hora <= fin`, bordes inclusivos); NxM ordena unidades del scope por
neto **desc**, grupos completos de `cadaN`, la más barata de cada grupo recibe
`valorPorcentaje × neto`; scope `venta` = toda unidad; scope `categoria` por
`categoriaId`; scope `items` por pertenencia a `itemIds`.

- [ ] **Step 1 (tests primero):** escribir `promociones.evaluator.spec.ts` con estos
  casos para lo de esta task (helpers de fixture arriba del archivo: `promo()`,
  `linea()` con defaults):
  - `instanteEnVentana`: fecha antes/primer día/último día/después (bordes inclusivos);
    sin horas = todo el día; franja normal 18:00–20:00 (17:59 no, 18:00 sí, 20:00 sí,
    20:01 no); **franja que cruza medianoche 18:00–02:00** (17:59 no, 23:00 sí, 01:59
    sí, 02:00 sí, 02:01 no); `diasSemana [2]` (martes sí, miércoles no); canal `null`
    acepta ambos, `'fisico'` rechaza `'online'`.
  - `porcentaje`: 20% sobre 2 líneas del scope → una aplicación con 2 montos =
    `0.20 × neto × cantidad` finos; línea fuera del scope no aparece; línea con
    instante fuera de franja no aparece **aunque otra línea de la misma venta sí**
    (el caso del bar de la decisión 4, en unit porque el e2e no puede fabricar
    instantes pasados por API).
  - `nxm` 2x1 (`cadaN=2, valorPorcentaje='1'`): 2 cervezas $5.000 y $3.000 → 1
    aplicación, monto $3.000 en la línea de la barata; 4 unidades → 2 aplicaciones;
    3 unidades → 1 aplicación (grupo incompleto afuera); 2 unidades en la MISMA línea
    (cantidad '2') → monto = 1 × neto unitario en esa línea; "2do al 50%"
    (`valorPorcentaje='0.5'`) → 50% de la más barata; cantidad fraccionaria `'0.7'` no
    aporta unidades a un nxm; empate de precios → resultado determinista (fijar con el
    desempate por `index` ascendente).
  Correr `npm test -- --testPathPattern=promociones.evaluator` → FALLAN todos.

- [ ] **Step 2: Implementar** `instanteEnVentana`, la explosión a unidades, el matching
  de scope y las ramas `porcentaje` y `nxm` — aritmética con Decimal.js, nunca
  `number`. La rama `precio_fijo` no existe todavía en esta tarea: el `switch` por
  tipo solo conoce estas dos, y la tercera se agrega en la Task 4 junto con sus
  tests (sin `TODO` ni rama vacía en el código). Correr el spec → PASS.

- [ ] **Step 3: Commit** — `feat(promociones): evaluador puro — ventana, scope, porcentaje y NxM`.

---

### Task 4: Evaluador — `precio_fijo`, prorrateo y conflictos greedy

**Files:**
- Modify: `backend/src/modules/promociones/promociones.evaluator.ts`
- Test: `backend/src/modules/promociones/promociones.evaluator.spec.ts` (ampliar)

**Interfaces:** las de Task 3, sin cambios de firma.

- [ ] **Step 1 (tests primero), casos nuevos:**
  - `precio_fijo` "1 pizza + 1 bebida = $9.990": pizza $8.000 + bebida $3.500 → 1
    aplicación, descuento total $1.510 repartido a prorrata del neto
    (pizza `1510×8000/11500`, bebida el resto), **suma exacta** = $1.510 (residuo por
    mayores restos — verificar contra un caso 333/333/334 dedicado);
  - slots con `cantidad: 2` (2 pizzas + 1 bebida) exige 2 unidades del slot pizza;
  - candidatos de sobra → entran las unidades **más caras** de cada slot (decisión 3:
    pizzas $8.000 y $6.000 → entra la de $8.000, descuento mayor);
  - combo que encarece (`valorMonto` ≥ Σ netos) → 0 aplicaciones;
  - repetible: 2 pizzas + 2 bebidas → 2 combos;
  - **greedy entre promos**: la misma cerveza califica para un 2x1 (descuento $3.000)
    y un happy hour 10% ($500) → solo el 2x1 la toma; la unidad tomada no aparece en
    la otra; con montos invertidos gana la otra; empate de monto → desempate estable
    por id de promo ascendente;
  - una unidad ya usada por la aplicación #1 de una promo no entra en la #2 de la
    misma.

- [ ] **Step 2: Implementar.** Generar TODAS las aplicaciones candidatas por promo
  (cada una con sus unidades concretas), ordenar por monto total desc (desempate id,
  luego orden de generación), aplicar greedy marcando unidades tomadas, y re-generar
  para promos que perdieron unidades **no** (simplicidad F1: las candidatas se
  generan una vez sobre el carrito completo y el greedy descarta las que chocan —
  documentar en el docblock que un óptimo global no se busca, gana-la-mayor es la
  regla). El prorrateo del combo: repartir `descuento` entre líneas afectadas
  proporcional al neto aportado, residuo a la de mayor resto fraccionario, desempate
  por `lineaIndex` (mismo idioma que el prorrateo del motor). Correr spec → PASS.

- [ ] **Step 3: Commit** — `feat(promociones): precio fijo de combo, prorrateo con residuo y greedy entre promos`.

---

### Task 5: El instante local por línea (`instanteLocalTenant`)

**Files:**
- Modify: `backend/src/common/utils/rango-fecha.util.ts` (junto a `fechaLocalTenant`, que es el molde — leerla primero)
- Test: el spec que hoy cubre `fechaLocalTenant` (localizarlo con `grep -rn "fechaLocalTenant" backend/src backend/test --include="*.spec.ts"`), ampliar ahí.

**Interfaces (Produces):**

```typescript
/**
 * Colapsa un instante al {fecha, hora, diaIso} LOCAL del tenant (zona de la
 * provincia). Mismo mecanismo Intl que fechaLocalTenant y por la misma razón
 * (colapsar en memoria, no expandir en SQL — ver su docblock).
 */
export async function instanteLocalTenant(
  db: Db,
  tenantId: string,
  instante: Date,
): Promise<{ fecha: string; hora: string; diaIso: number }>;
```

- [ ] **Step 1 (tests primero):** con la zona `America/Santiago` y `Pacific/Easter`
  (los casos que ya usa la suite de `fechaLocalTenant`): un instante UTC que cae en
  otro día local (`2026-12-01T02:30Z` → fecha `2026-11-30`, hora local coherente),
  `diaIso` correcto en el borde de semana (un domingo → 7, lunes → 1). Correr → FALLA.

- [ ] **Step 2: Implementar** con `Intl.DateTimeFormat('en-CA', { timeZone, ... })`
  para fecha y `hour12: false` para `HH:mm`; `diaIso` desde
  `Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone })` mapeado
  `Mon..Sun → 1..7`. Reusar la resolución de zona que ya usa `fechaLocalTenant`
  (misma query/helper, no duplicarla). Correr → PASS.

- [ ] **Step 3: Commit** — `feat(promociones): instante local del tenant con hora y día ISO`.

---

### Task 6: Integración en `CalculoPreciosService.calcular`

**Files:**
- Modify: `backend/src/modules/promociones/promociones.service.ts` (nuevo método `cargarVigentes`)
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts`
- Modify: `backend/src/modules/calculo-precios/dto/calcular.dto.ts` (`canal?`)
- Modify: `backend/src/modules/calculo-precios/calculo-precios.module.ts` (+`PromocionesModule`)
- Test: `backend/src/modules/calculo-precios/calculo-precios.service.spec.ts` y `promociones.service.spec.ts` (ampliar)

**Interfaces:**
- Consumes: `evaluarPromos` (Task 3/4), `instanteLocalTenant` (Task 5), entidades (Task 1).
- Produces: `PromocionesService.cargarVigentes(tenantId, fechaLocal: string): Promise<PromoElegible[]>`
  — **una** query batch (promos vivas y activas con
  `fecha_inicio <= $fecha AND fecha_fin >= $fecha`, `LEFT JOIN` scopes vivos y sus
  items vivos, `eliminado_el IS NULL` en las tres tablas), ensamblada a
  `PromoElegible[]`; hora/día/canal NO se filtran acá (son por línea, los mira el
  evaluador). Y `calcular()` pasa `promociones: AplicacionPromo[]` al motor (la firma
  del motor cambia en Task 7 — **Tasks 6 y 7 se integran juntas**: 6 deja el service
  llamando `calcularVenta` con el campo nuevo y 7 lo consume; ejecutarlas en orden
  6→7 con el typecheck en verde recién al cierre de 7, commit conjunto o en la rama
  de la misma sesión).

- [ ] **Step 1: Leer** `calculo-precios.service.ts` entero (codegraph `calcular
  resolverLinea instanteDeVigencia`) — el plan ya verificó: `calcular()` resuelve
  `fechaLocal` con `instanteDeVigencia(tenantId, dto.cuentaId)` y arma
  `lineas: LineaResuelta[]` con `resolverLinea` (netos ya convertidos).

- [ ] **Step 2 (tests primero, service):**
  - `cargarVigentes` arma `PromoElegible` completo desde filas mockeadas y NO trae
    pausadas ni fuera de fecha (el SQL se testea de forma; el filtro real lo cubre el
    e2e);
  - `calcular` con una promo vigente → el resultado trae la aplicación (mock de
    `evaluarPromos` no: usar el evaluador real con fixtures — es puro);
  - los instantes: sin `cuentaId`, todas las líneas evalúan con "ahora"; con
    `cuentaId`, cada línea evalúa con el `creado_el` de su línea de cuenta
    (mockear la query de líneas de cuenta);
  - `canal` default `'fisico'`; `'online'` filtra promos de canal físico.

- [ ] **Step 3: Implementar en `calcular()`**, después de armar `lineas` y antes de
  `calcularVenta`:
  1. `const promos = await this.promocionesService.cargarVigentes(tenantId, fechaLocal)`
     — si `[]`, saltear el resto (cero costo para tenants sin promos);
  2. instantes: sin `dto.cuentaId` → un solo `instanteLocalTenant(db, tenantId, new Date())`
     para todas; con `cuentaId` → **una** query a `cuenta_lineas`
     (`WHERE cuenta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`, columnas
     `item_id, cantidad, creado_el` ordenadas por `creado_el`) y cruce contra
     `dto.lineas` por `itemId` + consumo por orden (la venta real arma sus líneas
     desde la cuenta en el mismo orden; una línea del DTO sin fila de cuenta usa
     "ahora" — es una línea agregada en el cobro). Documentar el cruce en el docblock:
     el contrato de la spec es que el instante sale de la BD, jamás del body;
  3. `categoriaId` por línea: ya viene en `cargarBasePorIds`? — **verificar**; si la
     fila base no trae `categoria_id`, agregarlo al SELECT de `cargarBasePorIds`
     (una columna, no una query);
  4. armar `LineaPromo[]` (neto unitario = el `precioUnitario` convertido que ya usa
     `resolverLinea`) y llamar `evaluarPromos({promos, lineas, canal: dto.canal ?? 'fisico'})`;
  5. pasar `promociones` y `config.promosAcumulanDescuentos` (de
     `getPreferenciasFinancieras`, cargado en `cargarConfig` — agregar el campo ahí) a
     `calcularVenta`.
  `CalcularVentaDto` gana `canal?: 'fisico' | 'online'` (`@IsOptional @IsIn`);
  `ventas.service.ts` (paso 4, `calcularDto`) le pasa su `canal` — una línea.

- [ ] **Step 4:** specs de service en verde; typecheck queda rojo por la firma del
  motor → pasar directo a Task 7 en la misma sesión.

---

### Task 7: El motor aplica las promos y resuelve el interruptor

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts`
- Test: `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts` (ampliar)

**Interfaces (Produces):**

```typescript
// engine — tipos nuevos/modificados
export interface TrazaPromo {
  id: string;          // promocionId
  nombre: string;
  monto: string;       // lo que restó en ESTA línea (cuantizado al cierre del paso? NO: fino como TrazaRegla.monto — misma convención que las demás trazas)
  valorEfectivo: string;
  aplicacion: number;  // agrupador de la aplicación (1-based por promo)
}

export interface AplicacionPromoResuelta {
  promocionId: string;
  nombre: string;
  tipo: string;
  valorEfectivo: string;
  montosPorLinea: { lineaIndex: number; monto: string }[];
}

// VentaResuelta gana (REQUERIDOS los dos — nada opcional que cambie plata):
//   promociones: AplicacionPromoResuelta[];
// ConfigCalculo gana:
//   promosAcumulanDescuentos: boolean;
// ResultadoLinea.trazas gana:
//   promociones: TrazaPromo[];
```

**Contrato de aplicación (spec §Integración — el implementador lo respeta leyendo el
engine, no inventando):** el monto de promo entra en el paso `descuentos` de la línea,
**después** de las reglas de catálogo, como resta fija con el mismo guard de piso en
cero (y su advertencia de tope si no cabe); **suma dentro de `descuentoAplicado` y de
`totales.totalDescuentos`** — el beneficio ES un descuento (ADR-010 portable); la
separación promo/catálogo vive en `trazas.promociones` y en el congelado, no en los
agregados. La cuantización al cierre del paso no cambia: cero caminos de redondeo
nuevos. Con `promosAcumulanDescuentos: false`, ANTES de aplicar: por cada aplicación,
`Σ montosPorLinea` vs `Σ descuentoAplicado` (catálogo, de la pasada normal) de las
líneas afectadas — si la promo gana, esas líneas se recalculan **sin** sus descuentos
de catálogo (que quedan en traza con monto `'0'` y `valorEfectivo` intacto, el patrón
"No aplicó") y con la promo; si pierde, la aplicación entera queda descartada — la
promo NO deja traza en ese caso (como la regla fuera de vigencia: sin traza, la
pantalla de config explica). Una aplicación cross-línea se compara ENTERA.

- [ ] **Step 1: Leer el engine completo** (`calcularVenta`, `calcularLinea`,
  `procesarReglas`, el cierre de paso y las dos pasadas del prorrateo de venta) antes
  de tocar nada.

- [ ] **Step 2 (tests primero), en `calculo-precios.engine.spec.ts`** (usar los
  builders de fixtures que el spec ya tiene):
  - una promo de $500 en la línea 0 con acumula=true: `descuentoAplicado` sube $500,
    `trazas.promociones` = 1 con `aplicacion: 1`, `trazas.descuentos` del catálogo
    intactas, y la identidad `totalLinea = neto − desc + rec + ajusteVenta + imp`
    sigue exacta;
  - piso en cero: promo $5.000 sobre línea de $3.000 → aplica $3.000 con advertencia
    de tope (mismo texto-patrón del descuento topeado);
  - interruptor false, promo $3.000 vs descuento catálogo $1.000 en la línea → gana
    promo: descuento catálogo en traza con monto `'0'`, `descuentoAplicado` = $3.000;
  - interruptor false, promo $500 vs descuento $1.000 → la promo desaparece (sin
    traza), descuento intacto;
  - interruptor false, aplicación cross-línea (combo tocando líneas 0 y 1, $1.510
    total) vs descuentos catálogo $2.000 entre esas líneas → la aplicación entera se
    descarta, no se parte;
  - dos aplicaciones de la misma promo → `aplicacion` 1 y 2 en las trazas;
  - el IVA de la línea se calcula sobre la base ya descontada por la promo (una
    línea afecta con promo → `impuestoAplicado` = tasa × base reducida);
  - `config.promosAcumulanDescuentos` viaja en `resultado.config` (el congelado).

- [ ] **Step 3: Implementar** hasta specs en verde. Correr TODO el spec del engine (no
  solo los nuevos): las identidades aditivas existentes no se pueden mover. Después
  `npm run typecheck` (cierra también Task 6) y
  `npm test -- --testPathPattern=calculo-precios` → PASS.

- [ ] **Step 4: Commit conjunto 6+7** — `feat(promociones): el evaluador entra al cálculo y el motor aplica la familia propia con su interruptor`.

---

### Task 8: La venta congela (`ventas_promociones`) y el detalle la expone

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (`crearEnTransaccion` §7c/7d, y `findOne`)
- Modify: `backend/src/modules/ventas/ventas.module.ts` (forFeature + `VentaPromocion`)
- Test: `backend/src/modules/ventas/ventas.service.spec.ts` (ampliar)

**Interfaces:**
- Consumes: `VentaPromocion` (Task 1), `ResultadoLinea.trazas.promociones` (Task 7).
- Produces: filas `ventas_promociones` por venta; `findOne` devuelve
  `promociones: { detalleId, aplicacion, promocionId, nombre, tipo, valorEfectivo, monto }[]`
  (el frontend Task 12 la consume).

- [ ] **Step 1: Leer** `crearEnTransaccion` §7c/7d (el armado de `filasDescuento` por
  índice `detalles[i]` ↔ `resultado.lineas[i]`) y `findOne` (cómo expone
  descuentos/config_calculo — y recordar el precedente: `config_calculo` se escribió
  meses sin que el SELECT lo trajera; acá el SELECT nuevo entra con su test).

- [ ] **Step 2 (tests primero):** en `ventas.service.spec.ts` (mockeando
  `calculoPreciosService.calcular` para devolver `trazas.promociones` pobladas):
  - una venta cuyo resultado trae 2 trazas de promo en líneas 0 y 1 → 2 filas
    `VentaPromocion` con `detalleId` cruzado por índice, `aplicacion`, nombre, tipo,
    `valorEfectivo` y monto congelados;
  - resultado sin promos → cero filas (sin query extra);
  - `findOne` incluye `promociones` con las columnas congeladas.

- [ ] **Step 3: Implementar**: en §7c, tercera familia
  `filasPromocion: VentaPromocion[]` armada desde `rLinea.trazas.promociones` (los
  campos son 1:1 con la entidad; `monto` va cuantizado con la misma conversión que
  usan las demás filas congeladas — copiar cómo 7c trata `traza.monto`), un
  `manager.save` con el array; `findOne` suma el SELECT de `ventas_promociones`
  (filtro `eliminado_el IS NULL`). Specs → PASS.

- [ ] **Step 4: Commit** — `feat(promociones): la venta congela la promo aplicada y el detalle la expone`.

---

### Task 9: E2E de API (`promociones.e2e-spec.ts`)

**Files:**
- Create: `backend/test/promociones.e2e-spec.ts`

**Interfaces:** Consumes: todo lo anterior por HTTP real.

- [ ] **Step 1: Leer el molde e2e**: `reglas-valor.e2e-spec.ts` o
  `calculo-precios.e2e-spec.ts` (login, `app.close()` **en `finally`** — regla del
  backlog, helper de caja). ⚠️ Crear **garzón/usuarios propios** si el spec toca
  salones — la sesión de garzón es única y los del seed se pisan entre suites.

- [ ] **Step 2: Escribir los describe** (la promo se crea por API en cada bloque, con
  fechas que cubren hoy y **sin franja horaria** salvo el caso de franja):
  1. **CRUD**: crear `porcentaje` con scope categoría → 201 y el GET la lista con
     scopes; sin `fechaFin` → 400; escritura con token no-admin → 403; lectura con
     token común → 200.
  2. **Aplica y congela**: promo 10% sobre un ítem del seed; `POST /ventas` (caja
     abierta, molde del e2e de ventas) → `totalDescuentos` refleja el 10%, la
     respuesta trae la traza de promo, y el `GET /ventas/:id` muestra
     `promociones[]` con nombre y monto — **editar la promo al 20% después** y
     verificar que la venta vieja sigue diciendo 10% (el molde de "congela la regla").
  3. **Previsualización = venta**: `POST /calculo-precios/calcular` con las mismas
     líneas → mismos totales que la venta.
  4. **2x1**: promo nxm `cadaN=2` sobre 2 unidades → descuento = neto de la más
     barata; con 3 unidades → igual (grupo incompleto no suma).
  5. **Franja horaria**: promo con franja que NO cubre ahora → la venta no descuenta;
     franja que sí cubre → descuenta. (El instante mixto por línea es unit del
     evaluador — por API no se fabrican instantes pasados, y fabricarlos por SQL
     directo sería el anti-patrón del estado inalcanzable.)
  6. **Cuenta de salón**: abrir cuenta, agregar línea, cerrar → la venta lleva la
     promo vigente y la congela (con garzón propio).
  7. **El interruptor**: ítem con descuento directo 10% + promo 20%; con el default
     (no acumula) la venta aplica SOLO la promo (descuento en `'0'` en trazas);
     `PATCH` preferencias `promosAcumulanDescuentos: true` → otra venta aplica ambos;
     y `config_calculo` de cada venta congela el valor con el que se calculó.
  8. **Canal**: promo `canal='fisico'` → una venta online (caja virtual, pago
     completo — molde del e2e de tienda) no la aplica.
  9. **Pausa**: promo `activo=false` → no aplica y la respuesta NO trae advertencia
     nueva.

- [ ] **Step 3: Correr SOLO este spec** (`./scripts/reset-db.sh` antes;
  `npx jest --config test/jest-e2e.json test/promociones.e2e-spec.ts`). Expected:
  PASS. ⚠️ No tocar `.ts` del backend mientras corre.

- [ ] **Step 4: Commit** — `test(promociones): e2e de campañas, congelado, interruptor y canal`.

---

### Task 10: Seeder — promos demo

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`

- [ ] **Step 1: Leer** el bloque de seed de descuentos del seeder (forma de los IDs
  fijos y de los inserts hijos). **Siguiente UUID libre medido: `…446655440365`**
  (el mayor hoy es `…440364`) — re-verificar con
  `grep -o "446655440[0-9]*" backend/src/modules/seeder/seeder.service.ts | sort | tail -1`
  antes de usar.

- [ ] **Step 2: Sembrar 2 promos demo** para el tenant demo (IDs `440365+`
  correlativos, promo + scopes + scope_items): *"2x1 en tragos (martes)"* (`nxm`,
  `cadaN=2`, `valorPorcentaje='1'`, `diasSemana=[2]`, franja `18:00–20:00`, scope
  items con 2-3 ítems vendibles del seed) y *"Happy hour 20%"* (`porcentaje`,
  `valorPorcentaje='0.20'`, sin días, franja `18:00–02:00` — la que cruza
  medianoche, para que el demo la muestre). Fechas: un rango largo que cubra la demo
  (p.ej. `2026-01-01`→`2027-12-31` — **con fin**, el guardarraíl vale también acá).
  Al crear tenant NO se siembra ninguna promo (spec, trap 3).

- [ ] **Step 3:** `docker-compose up` limpio (`./scripts/reset-db.sh`), verificar en
  el log `Seed complete` y por Swagger que `GET /api/promociones` las lista.

- [ ] **Step 4: Commit** — `feat(seeder): dos promociones demo, una con franja que cruza medianoche`.

---

### Task 11: Frontend — pantalla `/configuracion/promociones`

**Files:**
- Create: `frontend/app/pages/configuracion/promociones.vue`
- Create: `frontend/app/composables/usePromociones.ts`
- Create: `frontend/app/utils/promociones-form-config.ts`
- Test: `frontend/app/utils/promociones-form-config.spec.ts` (o el patrón de spec de utils que use el repo — mirar `reglas-form-config` y su spec)

- [ ] **Step 1: Leer los moldes**: `pages/configuracion/descuentos.vue` (estructura
  CrudPageHeader/CrudTable/AppDrawer, badges de vigencia derivados de fechas,
  `usePausaRegla` si aplica — para promos la pausa es un toggle simple sin modal de
  uso: no hay tabla puente con ítems vendidos), `utils/reglas-form-config.ts` (config
  declarativa por tipo) y el selector de ítems/categorías que usen las pantallas de
  catálogo.

- [ ] **Step 2 (test primero):** spec de `promociones-form-config.ts`: por tipo, qué
  campos pide (`porcentaje` → `%`; `nxm` → `cadaN` + `%`; `precio_fijo` → monto +
  slots), y que los tres exigen fechas (las dos) mientras franja/días/canal son
  opcionales.

- [ ] **Step 3: Implementar** la config, el composable (CRUD contra
  `/api/promociones` con `useApiFetch`, tipos espejo del backend) y la página:
  lista con badges `Programada / Vigente / Vencida / Pausada` (fecha del navegador —
  la limitación asumida de la spec), drawer con formulario por tipo, armado de slots
  para `precio_fijo` (selector de ítems o categoría + cantidad por slot), y
  `MoneyInput` para `valorMonto`. Copiar patrones, no inventar componentes.

- [ ] **Step 4:** `cd frontend && npm test && npm run build && npm run design:check`
  → PASS (el ratchet de typecheck también: `npm run typecheck:ratchet`).

- [ ] **Step 5: Commit** — `feat(promociones): pantalla de campañas con formulario por tipo y badges de vigencia`.

---

### Task 12: Frontend — carrito, drawer de venta, ticket y preferencias

**Files:**
- Modify: `frontend/app/composables/useCalculoPrecios.ts` (tipos: `trazas.promociones`, `canal`)
- Modify: los 3 carritos (`components/ventas/CarritoPanel.vue`, `pages/salones/index.vue`, `components/tienda/CarritoOnline.vue`) — mostrar la promo aplicada en el desglose; la tienda además manda `canal: 'online'` en el cálculo
- Modify: `frontend/app/components/ventas/VentaDetalleDrawer.vue` — familia `Promoción` en el desglose expandido de la línea (desde `venta.promociones` de Task 8, cruzada por `detalleId`)
- Modify: `ticket-builder.ts` (localizar: `grep -rn "ticket-builder" frontend/app`) — línea nombrada `2x1 martes  −$5.000`; promo sin monto no se imprime (molde del recargo en cero, `.gt(0)`)
- Modify: la pantalla de Preferencias financieras — el interruptor con la frase de la spec: *"Cuando una promoción y un descuento tocan el mismo producto: ¿se suman, o aplica solo la rebaja mayor?"*
- Test: los specs de componentes/utils que ya cubran drawer y ticket (mirar `ticket-builder` spec si existe; ampliar con: promo nombrada en el ticket, promo en cero omitida)

- [ ] **Step 1: Leer** cada archivo antes de tocarlo; el drawer tiene reglas duras
  documentadas en `motor-calculo-precios.md` (el rótulo `total` NO se saca; el orden
  sale de `config_calculo`).
- [ ] **Step 2 (tests primero donde hay spec):** ticket con promo → línea nombrada
  con signo negativo; drawer: línea con promo muestra fila `Promoción nombre −monto`.
- [ ] **Step 3: Implementar.** En los carritos, la promo se muestra desde
  `resultado.lineas[i].trazas.promociones` — **cruce por índice** con el resultado
  vigente (`useResultadoCalculado`/`asegurarVigente`, patrón §10.1 de
  `docs/patterns/frontend.md`). Sin toasts nuevos.
- [ ] **Step 4:** `npm test && npm run build && npm run typecheck:ratchet && npm run design:check` → PASS.
- [ ] **Step 5: Smoke en navegador** (memoria del proyecto: build/typecheck no ven
  bugs de runtime de Nuxt): con el stack arriba, crear una promo en la pantalla,
  verla aplicar en el POS y abrir el drawer de la venta. Chrome real con devtools
  (el owner ve esa ventana).
- [ ] **Step 6: Commit** — `feat(promociones): la promo se ve en el carrito, el ticket, el drawer y las preferencias`.

---

### Task 13: Documentación (mismo commit-familia que el código)

**Files:**
- Create: `docs/features/motor-promociones.md` (desde `docs/features/TEMPLATE.md`)
- Create: `docs/adr/023-promociones-familia-propia-del-motor.md` + índice `docs/adr/README.md`
- Modify: `docs/README.md` (link), `docs/ESTADO.md` (fila ✅ con fecha), `docs/PRODUCTO.md` (regla producto-vs-promo, texto de la spec §Pantalla), `docs/superpowers/specs/2026-07-22-motor-promociones-analisis.md` (header: promovido a design/plan, links)

- [ ] **Step 1:** Feature doc: qué es, los 3 tipos, las 4 decisiones del owner con
  fechas, el interruptor, el instante por línea, la asimetría con la vigencia de
  reglas (dicha), endpoints, tablas, cómo se testea. Corta y accionable; el porqué
  fino ya vive en la spec — linkearla, no duplicarla.
- [ ] **Step 2:** ADR-023: contexto (promos medibles como promos), decisión (evaluador
  fuera del motor / aplicación y conflicto adentro / familia propia de traza y
  congelado), alternativas descartadas (reglas sintéticas, post-proceso — copiar de
  la spec §Enfoques descartados), consecuencias (los agregados suman promo dentro de
  totalDescuentos; la medición va por `ventas_promociones`).
- [ ] **Step 3:** `docs/ESTADO.md` + `docs/README.md` + `PRODUCTO.md` + header del
  análisis de julio.
- [ ] **Step 4: Commit** — `docs(promociones): feature doc, ADR-023 y la regla producto-vs-promo`.

---

### Task 14: Cierre — gate completo + verify-feature + backlog

- [ ] **Step 1:** `./scripts/reset-db.sh` (espera del seed) — la base limpia ANTES de
  verificar (memoria del proyecto).
- [ ] **Step 2:** Gate completo, en serie, mirando el exit code de cada uno (nunca
  `| tail`):
  `cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e`
  (**la suite entera**, ~20 min, sin tocar `.ts` mientras corre) y
  `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`.
- [ ] **Step 3:** `./scripts/reset-db.sh --verificar` — ¿la base se movió abajo de la
  suite? Si sí, los rojos no son regresiones: investigar antes de tocar código.
- [ ] **Step 4: Mutantes de la spec** (§Cómo se prueba — cada uno acotado a la
  cláusula, verificando el restart del watcher tras revertir):
  1. quitar la obligatoriedad de `fechaFin` en el DTO → muere el e2e del 400;
  2. `evaluarPromos` devolviendo `[]` → mueren los e2e de aplica/congela;
  3. la comparación del interruptor invertida → muere el e2e del interruptor;
  4. `promosAcumulanDescuentos` sin mapear a `config_calculo` → muere el e2e que lo
     verifica congelado;
  5. el instante por línea reemplazado por `new Date()` fijo → mueren los unit de
     instantes del evaluador/service (el e2e de franja no lo distingue — por eso el
     unit es el que cuenta acá).
- [ ] **Step 5: verify-feature** (skill) — incluye la revisión independiente
  (`domain-reviewer`) sobre el diff completo, cuyo recibo exige el pre-commit para
  los diffs de services/`.vue`. Pedirle explícitamente que busque **consumidores que
  el diff no tocó** (el método que ya cazó el bug del ticket de personalizaciones).
- [ ] **Step 6: Backlog y CLAUDE.md en el mismo commit:** mover la entrada del motor
  de promociones de `docs/agent/pendientes.md` § 3 a `docs/agent/resueltos.md` con el
  texto de su cierre; verificar que `CLAUDE.md` no lo nombre como pendiente en ningún
  párrafo (la lección de la tanda 🔴: el puntero a un frente cerrado se corrige en el
  MISMO commit).
- [ ] **Step 7:** Tras el push a `main`: revisar CI **y el deployment de Railway**
  (el push despliega y este frente toca entidades — memoria del proyecto; si el boot
  falla por esquema, está `railway-sync-db`, avisando antes de arrancarla).

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura de la spec:** modelo de datos → T1; CRUD/pantalla → T2/T11; evaluador →
  T3/T4; instante por línea → T5/T6; motor+interruptor → T7; congelado/drawer/ticket →
  T8/T12; seeder → T10; e2e+mutantes → T9/T14; docs/ADR/PRODUCTO → T13; guardarraíl
  fecha fin → T1 (NOT NULL) + T2 (DTO) + T14 (mutante). El caso "instante mixto en la
  misma mesa" queda en unit (T3) con el porqué escrito en T9.
- **Decisión de agregados** (no estaba explícita en la spec y el plan la fija): el
  monto de promo suma dentro de `descuentoAplicado`/`totalDescuentos` — sin columna
  nueva en `venta_detalles` ni identidad nueva; la medición separada va por trazas y
  `ventas_promociones`. Si el owner prefiere agregados separados, es cambio de T7/T8
  antes de ejecutar.
- **Tipos consistentes:** `AplicacionPromo` (evaluador) y `AplicacionPromoResuelta`
  (motor) comparten forma; `TrazaPromo.aplicacion` alimenta
  `VentaPromocion.aplicacion`; `PromoElegible.ventana` es lo que `instanteEnVentana`
  consume.
