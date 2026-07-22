# Anti-patrones conocidos en este proyecto

Errores que **ya se cometieron aquí**. Es el único documento del setup que contiene
conocimiento que no se puede derivar leyendo el código correcto.

## Reglas de este archivo

1. **Solo entra lo que ya pasó.** Un anti-patrón especulativo es consejo de estilo
   disfrazado y no aporta nada que el modelo no sepa ya. Cada entrada nace de un bug
   real, un commit de corrección o una revisión que lo detectó.
2. **Cada entrada sale cuando se automatiza.** Si el patrón pasa a ser regla de ESLint
   o test, se borra de aquí y queda la referencia a la regla. Este archivo no crece
   indefinidamente.
3. **Tope: 20 entradas.** Si se llena, la más antigua sin reincidencia se elimina.
4. Formato fijo: qué pasó → ❌ mal → ✅ bien → una línea de porqué.

---

## Backend

### ✅ Columna UUID sin `type: 'uuid'` explícito — AUTOMATIZADO

Ya enforced por test: `src/common/invariants/uuid-columns.invariant.spec.ts` recorre las
entities y falla si una columna `*_id` no declara `type: 'uuid'` (con allowlist para ids
externos como `google_id`). El porqué (JOINs raw fallan `varchar` vs `uuid`) vive en
[ADR-004](../adr/004-uuid-column-types.md). Regla movida del `.md` al test.

### ❌ `tenant_id` tomado del request

```ts
// MAL
const { tenant_id } = dto;

// BIEN — el payload JWT es camelCase (`tenantId`), no la columna DB (`tenant_id`)
const { tenantId } = req.user as { tenantId: string };
// o vía decorador: @CurrentUser() user: JwtUser  →  user.tenantId
```

Cualquier cliente puede enviar otro `tenant_id` en el body y leer o escribir datos
de otro tenant. Es una fuga multi-tenant, no un descuido de estilo. Ojo con el casing:
`req.user.tenant_id` es `undefined` — el campo decodificado es `tenantId`.

### ❌ `number` nativo para dinero o porcentajes

```ts
// MAL
const total = precio * 1.19;

// BIEN
const total = new Decimal(precio).mul(new Decimal(1).plus(tasa));
```

Y las tasas se guardan en decimal: `0.19`, nunca `19`. Un `19` interpretado como tasa
multiplica el impuesto por cien.
→ *Candidato a regla de lint sobre operadores aritméticos en campos de monto.*

### ❌ Borrado físico de filas

El proyecto es mayormente SQL raw, así que el fallo real es una query nueva sin el
filtro, o un `DELETE` físico crudo:

```sql
-- MAL — borra la fila
DELETE FROM ventas WHERE venta_id = $1;
-- MAL — lectura nueva sin filtrar borrados
SELECT * FROM ventas WHERE tenant_id = $1;

-- BIEN — marcar
UPDATE ventas SET eliminado_el = NOW() WHERE venta_id = $1 AND tenant_id = $2;
-- BIEN — toda lectura filtra
SELECT * FROM ventas WHERE tenant_id = $1 AND eliminado_el IS NULL;
```

En los pocos caminos por repositorio de TypeORM, el equivalente es `repo.softDelete(id)`
en vez de `repo.delete(id)`. Omitir el filtro en una query nueva hace reaparecer
registros borrados en listados y reportes.

### ❌ N+1 — una query por iteración sobre un resultado

```ts
// MAL — 1 query para la lista + 1 query por fila (N+1)
const rows = await this.dataSource.query(`SELECT ... FROM items WHERE ...`, [p]);
const data = await Promise.all(
  rows.map(async (r) => ({
    ...this.mapRow(r),
    disponible: await this.calcularDisponible(tenantId, r.id), // query por fila
  })),
);

// BIEN — resolver el dato derivado para todas las filas en una sola query
const ids = rows.map((r) => r.id);
const dispRows = await this.dataSource.query(
  `SELECT item_id, ... FROM ... WHERE item_id = ANY($1) AND eliminado_el IS NULL
   GROUP BY item_id`,
  [ids],
);
const byId = new Map(dispRows.map((d) => [d.item_id, d]));
const data = rows.map((r) => ({ ...this.mapRow(r), disponible: byId.get(r.id) ?? null }));
```

Un `map(async … query)` o un `for` con `await query` dentro escala lineal con las
filas: un listado de 50 items dispara 50+ queries. Resolver siempre en una query con
`JOIN`/agregación, o batch-fetch con `WHERE id = ANY($1)` y mapear en memoria. Aplica
igual a `Promise.all` sobre queries: sigue siendo N round-trips.
→ *Instancia real (deuda viva, aún sin corregir): `items.service.ts` `findAll` llama
`calcularDisponibleReceta`/`Combo` por fila. Difícil de detectar por lint → se revisa en
el cierre con el sub-agente independiente de `verify-feature`.*

---

## Frontend

### ❌ Mutar y luego recargar la lista completa

```ts
// MAL
await $fetch('/ventas', { method: 'POST', body })
await cargar()

// BIEN
const creada = await $fetch('/ventas', { method: 'POST', body })
ventas.value.unshift(creada)
```

El backend devuelve la entidad o un patch mergeable. Recargar duplica el round-trip,
parpadea la UI y pierde el estado local (scroll, filtros, selección).
Detalle: `docs/patterns/frontend.md`.

### ❌ Tailwind hardcoded en vez de tokens semánticos

```vue
<!-- MAL -->
<p class="text-gray-500 bg-white dark:bg-gray-900">

<!-- BIEN -->
<p class="text-muted bg-default">
```

Rompe el modo oscuro y el theming por tenant. Excepción única: colores financieros
(verde/rojo/azul) en el módulo Caja.
→ *AUTOMATIZADO: `frontend/scripts/check-design-tokens.mjs` (`npm run design:check` en el
gate; `--staged` en el pre-commit) falla si un `.vue` fuera de `app/components/caja/` usa
neutrales hardcodeados (`*-gray-N`, `bg-white/black`, `dark:` sobre neutrales). Los
colores de marca (`bg-primary-*`, `text-white` sobre marca) quedan fuera de alcance.*

### ❌ Función de formato definida dentro de un `.vue`

```ts
// MAL — dentro del componente
const formatMonto = (v: number) => `$${v.toLocaleString()}`

// BIEN
const { formatMonto } = useFormatters()
```

Cada copia local diverge en separadores, decimales y moneda. El formato de monto
depende de la moneda oficial del tenant, así que una copia local es un bug de datos,
no de estilo.

### ❌ `@click` con expresión que devuelve valor (TS2322)

```vue
<!-- MAL — la expresión devuelve el array/boolean → handler no es void (vue-tsc estricto) -->
<UButton @click="form.series = [...form.series, { serie: '', condicion: 'nuevo' }]" />
<UButton @click="form.series = form.series.filter((_, i) => i !== idx)" />

<!-- BIEN — extraer a función nombrada en <script setup> (devuelve void) -->
<UButton @click="addSerie" />
<UButton @click="removeSerie(idx)" />
```
```ts
function addSerie() {
  form.series.push({ serie: '', condicion: 'nuevo', garantiaHasta: '' })
}
function removeSerie(idx: number) {
  form.series.splice(idx, 1)
}
```

Un cierre de modal (`@click="drawerOpen = false"`) también devuelve valor (la asignación
evalúa a `boolean`). Ahí no hace falta función nombrada por un one-liner: arrow inline
`@click="() => { drawerOpen = false }"` (el bloque `{}` sin `return` es `void`) — patrón
ya usado en el repo para handlers de varias sentencias.

`nuxt build` no lo detecta; `typecheck:ratchet` sí. Además saca lógica del template.
Fue el patrón dominante de los errores de tipo del frontend (jul-2026): `items.vue`
solo tenía 38 (16 así + 22 del índice de abajo).

### ❌ Acceso por índice sin guard en el template (TS2532)

```vue
<!-- MAL — con noUncheckedIndexedAccess, form.series[idx] es T | undefined -->
<UInput v-model="form.series[idx].serie" />

<!-- BIEN — el índice viene del mismo v-for, existe: aserción no-nula -->
<UInput v-model="form.series[idx]!.serie" />
```

Convención establecida en el repo para `v-model` sobre índice de un `v-for` de la misma
lista. No usar en accesos donde el índice sí puede no existir — ahí, guard real (`v-if`).

**Variante en `<script>` (TS2322, no TS2532):** el mismo `T | undefined` del índice se
propaga al hacer spread y reasignar la fila tras un `findIndex`:

```ts
// MAL — arr.value[idx] es T | undefined; con `saved` parcial el objeto resultante
// tiene todos los campos opcionales → no asignable a T
const idx = configs.value.findIndex(c => c.id === saved.id)
if (idx >= 0) configs.value[idx] = { ...configs.value[idx], ...saved }

// BIEN — el idx viene de findIndex y está guardado por `idx >= 0`: la fila existe
if (idx >= 0) configs.value[idx] = { ...configs.value[idx]!, ...saved }
```

Aserción no-nula sobre el spread source, no sobre `saved`. Solo aplica cuando `saved`
(el patch) es parcial; si trae el tipo completo, no falla (por eso `items.vue` no lo
tenía). Misma justificación que arriba: el índice existe, no es un acceso dudoso.

Igual criterio para índice/destructuring ya guardado en `<script>`/`.ts` (TS2532/18048):
`parts[1]!` tras `if (parts.length !== 3) return`, `list[0]!` dentro de `length === 1`,
`entero!` del `split('.')` de un `toFixed`, o `v-model="map[k]!.campo"` bajo `v-if="map[k]"`.
El `!` solo donde una guarda previa garantiza la existencia — nunca en el índice dudoso.

### ❌ Estado `string | null` bindeado a prop/`v-model` de Nuxt UI (TS2322)

Los inputs de Nuxt UI aceptan `string | undefined`, no `null`. Un ref de error o un
campo de form tipado `| null` no es asignable:

```vue
<!-- MAL — nombreError es string | null; :error quiere string | boolean | undefined -->
<UFormField :error="nombreError" />
<!-- BIEN (una vía) — coerción ya usada en el repo (AppDateInput.vue) -->
<UFormField :error="nombreError ?? undefined" />
```
```ts
// MAL — v-model de dos vías sobre campo string | null (no se puede coercer inline)
const form = ref({ modo: 'porcentaje' as string | null })
// BIEN — el form nunca guarda null: tiparlo string y coercer al cargar
const form = ref({ modo: 'porcentaje' as string })
function abrirEditar(d: Regla) { form.value = { modo: d.modo ?? '', /* … */ } }
```

`?? ''` al cargar es el mismo patrón ya usado en el repo para tramos (`t.minimo ?? ''`).
Antes de aplicarlo verificar que el `null` no viaje al payload: en `descuentos`/`recargos`
el campo solo se manda cuando `cfg` lo habilita, y ahí el valor siempre es un string real,
así que la coerción es payload-neutral. Si el `null` sí llegara al body, es decisión de
negocio (limpiar vs omitir) — preguntar.

### ❌ Mismatch de tipos con handlers/props de Nuxt UI · reka (TS2322/2345/2459)

Casos puntuales de vue-tsc estricto contra los tipos de `@nuxt/ui`/`reka-ui`. Todos con
fix **solo-de-tipo, cero runtime**:

- **Param del handler más estrecho que el emit** — `@update:model-value="(v: Criterio) => f(v)"`
  falla si el componente emite `string`. Ensanchar el param al tipo emitido y castear
  dentro: `(v: string) => f(v as Criterio)`.
- **`$event` de `USwitch`/`UCheckbox`** es `string | boolean` (por `indeterminate`).
  Si el handler quiere `boolean`: `f(id, $event as boolean)`.
- **Forma de `DateRange`** (reka) es `{ start: DateValue | undefined; end: DateValue | undefined }`.
  Un handler que declara `{ start: DateValue; end: DateValue }` no acepta el emit → alinear
  con `| undefined`.
- **Tipo no exportado por el subpath** — `MaskaDetail` no se exporta desde `maska/vue`
  pero sí desde `maska`. Importar el tipo desde la raíz: `import type { MaskaDetail } from 'maska'`.
- **Prop que no modela `style`** — el `content` de `UDrawer` (`DialogContentProps`) no
  declara `style` aunque reka lo reenvía en runtime. Castear a `DrawerProps['content']`
  (importado de `@nuxt/ui`, dep directa — nunca de `reka-ui` transitivo).

### ❌ Tipado estricto en unit tests (vitest) — TS2321/2347/2532/2554

Al entrar los `.spec.ts` bajo vue-tsc estricto salieron cuatro fricciones, todas
solo-de-tipo:

- **Middleware Nuxt tipa `(to, from)`** — llamarlo con un solo arg en el test da TS2554.
  Pasar ambos (el middleware ignora `from`): `authMiddleware(ctx, ctx)`.
- **`require('vue')` es `any`** → `ref<T>(...)` da TS2347. Castear el require:
  `const { ref } = require('vue') as typeof import('vue')`.
- **`$fetch` global (rutas tipadas de Nuxt)** dispara TS2321 (recursión) en `vi.mocked`.
  Alias plano una vez: `const $fetchMock = vi.mocked($fetch as unknown as (...a: unknown[]) => Promise<unknown>)`.
- **Índice tras `expect(x).toHaveLength(n)`** sigue siendo `T | undefined` → `x[0]!.campo`
  (misma convención `!` del índice guardado).

## Pruebas E2E de navegador

*(Sección a poblar cuando exista la suite. Entradas previstas según el diseño acordado:
esperas fijas en lugar de aserciones web-first, tests que dependen del estado dejado
por otro test, y aserciones de montos copiadas de la salida del código en vez de
derivadas de `docs/features/`. No se documentan aquí hasta que ocurran de verdad.)*
