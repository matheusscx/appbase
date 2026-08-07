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

### ✅ Columna de fecha sin `type: 'timestamptz'` explícito — AUTOMATIZADO

Mismo molde que el de arriba, misma causa: sin `type`, TypeORM elige por vos y para fechas
elige `timestamp` **sin zona**. Llegó a 195 columnas partidas por accidente. Comparar una con
zona contra una sin zona no da error — Postgres castea con el `TimeZone` de la sesión que
compara, así que matchea 1 de 3 combinaciones y las otras 2 afectan 0 filas **en silencio**.

Enforced por dos tests: `src/common/invariants/timestamptz-columns.invariant.spec.ts` (mira
la metadata de TypeORM, no el texto — hay 5 entities que usan `@Column` a secas y un grep del
decorador no las ve) y `test/esquema.e2e-spec.ts` (mira `information_schema`, y va sobre
TODAS las columnas: `refresh_tokens.expires_at` se escapó del primero por no llamarse como
una columna de auditoría). El porqué vive en
[ADR-019](../adr/019-timestamptz-en-toda-columna-de-fecha.md).

**El corolario que sí es nuevo, y no lo caza ningún test:** un cast de zona horaria es una
respuesta al TIPO de la columna, no una verdad permanente. `items.service.ts` tenía
`NOW() AT TIME ZONE 'UTC'` puesto a propósito para tapar el mismatch; con la columna ya en
`timestamptz` ese mismo cast **reintroduce el bug que arreglaba** (medido: 4 horas de
corrimiento con la sesión en `America/Santiago`). Si cambiás el tipo de una columna, releé
los casts que la tocan en vez de conservarlos.

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

**Tres variantes que cuestan más que el N+1 de manual** (las dos primeras encontradas en
jul-2026 en el camino caliente del POS, corregidas en la auditoría de `ventas`+`pagos`):

1. **Traer de más y descartarlo.** `crearEnTransaccion` llamaba `itemsService.findOne` por
   línea del carrito. Cada `findOne` abre 4-8 queries construyendo impuestos, recargos,
   descuentos, ingredientes, componentes y grupos… de los que la venta **no lee ninguno**:
   solo usa campos del row base. Antes de batchear, preguntar *qué campos usa realmente el
   llamador*: a veces el arreglo no es "N queries → 1", es "N×8 queries → 1".
2. **N+1 anidado dentro del método que ya parecía el problema.** El hallazgo reportado era
   "una resolución de personalización por línea". Al abrirlo, `resolverGruposDeItem` tenía
   adentro **una query por grupo de modificadores**, que multiplicaba a la anterior. El
   interno se arregla sin tocar firmas y beneficia a todos los llamadores; conviene
   cerrarlo antes de decidir si vale batchear el externo. Cuando el batch necesita un par
   de claves (acá `grupo ↔ item_grupo`, por el override), `= ANY($1)` sobre una sola trae
   filas cruzadas: van dos arrays paralelos con `unnest($1::uuid[], $2::uuid[])`.
3. **Cargar el catálogo "una vez por función" en un clúster que se llama entre sí.** El
   arreglo obvio —`const convertir = await crearConversor()` arriba de cada función que
   convertía dentro de un loop— no cierra nada si esas funciones se invocan mutuamente:
   `venderComponentesCombo` → `venderIngredientesReceta` → `venderOpcionesGrupos` → de
   vuelta a la receta. "Una vez por función" seguía siendo una lectura del catálogo **por
   componente**. El recurso cargado se crea en los **puntos de entrada** y **baja por
   parámetro** por todo el árbol; en las privadas va como parámetro **requerido**, para que
   una rama nueva no pueda olvidarse y volver a leer (jul-2026, `items.service.ts`).
   Se fija con un test que cuenta las cargas, no las conversiones:
   `expect(crearConversor).toHaveBeenCalledTimes(1)`. Sin él, el arreglo se revierte sin
   que falle nada — el resultado de la venta es idéntico, solo cambia cuántas queries hizo.

4. **N+1 sosteniendo un lock pesimista.** `fusionarCuentas` leía las líneas del destino
   una vez por línea de cada origen, **dentro de la transacción que ya tenía
   `pessimistic_write` sobre todas las cuentas de la mesa**. Ahí el costo no es latencia:
   es el tiempo que nadie más puede agregar líneas ni cerrar en esa mesa. Un N+1 en una
   lectura suelta se paga en milisegundos propios; adentro de un lock se lo cobra a todos
   los demás. Cuando el bucle vive dentro de una transacción con lock, la pregunta no es
   "¿cuántas queries?" sino "¿cuánto dura el lock?" (ago-2026, `salones.service.ts`).
   El batch necesita **mantener el índice al día**: la línea que se mueve al destino tiene
   que poder recibir la suma de una igual que venga de un origen posterior. Armar el mapa
   una vez y no actualizarlo duplica líneas en vez de acumularlas — es la conducta que la
   consulta repetida daba gratis.

**Medir el N+1 en las dos dimensiones, no en una.** Este tenía la forma "una lectura por
línea, dentro de una lectura por origen". Un test que varía solo las líneas pasa en verde
con el bucle por origen intacto: lo comprobamos midiendo el mutante, que sobrevivió. El
test cuenta lecturas variando **cada** dimensión por separado y las dos juntas.

**No todo bucle con `await` es un N+1.** Son tres cosas distintas y confundirlas costó dos
falsos positivos en la auditoría de jul-2026. Antes de tocar un bucle, clasificarlo:

| Forma | Qué es | Qué se hace |
|---|---|---|
| Una **query por fila** para derivar un dato | El N+1 de arriba | Sale siempre: `JOIN`, agregación o `= ANY($1)` |
| **N filas que hay que escribir** | No es un defecto de diseño: son N filas | Se batchea — un `save` con el array, no un `await` por fila |
| Escrituras con **orden de lock deliberado** | El orden ES la protección | **No se toca** sin analizar dónde se decide el lock (ver abajo) |

La segunda no es la misma falta que la primera, pero vale arreglarla igual: en
`crearEnTransaccion` las tres tablas de reglas se escribían con un `await save()` por traza
**en serie**, sobre un resultado que ya estaba entero en memoria (ago-2026, `a149e621`). La
tercera es el bucle de movimientos de inventario de esa misma función, y batchearlo
cambiaría la semántica de deadlock.

Un batch de escrituras **no puede mover ningún número**: mismas filas, mismos montos, misma
atribución, mismo orden. Se fija con un test que afirma sobre el array que recibe el `save`,
no sobre el resultado de la venta — que es idéntico antes y después.

### ❌ Tomar `FOR UPDATE` en un orden que decide el cliente (o el heap)

Dos transacciones que bloquean las mismas filas en orden distinto se esperan en cruz y
Postgres mata a una: la venta se cae con un error opaco, sin corrupción pero sin
explicación. El orden de bloqueo tiene que ser **una propiedad del sistema, no del
payload**.

```ts
// MAL — el orden lo pone el cliente al armar el carrito
for (const linea of dto.lineas) await registrarMovimiento(linea.itemId)
// MAL — el orden lo pone el heap de Postgres, y cambia solo con cada UPDATE
`SELECT ingrediente_item_id FROM receta_ingredientes WHERE receta_item_id = $1`
// BIEN — orden fijo por id, en la query y en memoria
`… WHERE receta_item_id = $1 ORDER BY ingrediente_item_id`
opciones.sort((a, b) => a.itemId.localeCompare(b.itemId))
```

**Este reapareció cuatro veces en el mismo camino de venta** (jul-2026), y ahí está la
lección: se arregló en `ventas.service.ts` (`ordenLocks`, orden de las líneas) y quedó
vivo **un nivel adentro**, en los ids expandidos que ese fix no ve — ingredientes de la
receta, componentes del combo, opciones de grupo (orden del snapshot) y extras del
snapshot concatenados detrás de una lista ya ordenada. Al arreglar un orden de bloqueo,
preguntar **qué se bloquea después de eso**: casi siempre hay una expansión más abajo.

Ordenar cada nivel **no cierra el ciclo global**: el orden resultante es *(orden de
línea) × (orden dentro de la línea)*, que no es ascendente global. Contraejemplo: A vende
`RecetaX(ing3, ing5)` → bloquea 3→5; B vende `[RecetaY(ing5), RecetaZ(ing3)]` → bloquea
5→3. Por eso el cierre real es **reintentar ante `40P01`**, que además cubre los ciclos
que nadie enumeró; el orden determinista reduce la frecuencia. Reintentar es seguro
porque el deadlock aborta la transacción entera —Postgres revierte todo antes de devolver
el error—, así que no hay nada que deduplicar. Solo `40P01`: reintentar un error de
negocio lo convierte en tres intentos silenciosos.

**Variante: el ciclo no es entre filas de una tabla, sino entre dos tablas.** Ordenar por
id no lo cubre — no hay un id que comparar. Pasó al cerrar la carrera de
`item_receta.costo_actual` (jul-2026): el `FOR UPDATE` se puso pegado a la lectura que
protege, sin mirar que en `update()` esa lectura ocurre **después** del `UPDATE items`.

```ts
// MAL — cada método toma los dos locks en el orden que le queda cómodo
update():          UPDATE items …            → SELECT item_receta FOR UPDATE
aplicarDesfases(): SELECT item_receta FOR UPDATE → UPDATE items SET precio_base
// BIEN — un orden entre tablas, igual en los dos caminos
update():          SELECT item_receta FOR UPDATE → UPDATE items …
```

Se dispara con un uso normal (un PATCH de receta con nombre + ingredientes contra un
"aplicar desfase con actualizar precio"), y no lo caza ningún test: los unit corren con un
solo manager mockeado y el e2e es secuencial. Lo cazó la revisión independiente.

**Regla:** agregar un `FOR UPDATE` **no es un cambio local**. Antes de ponerlo, listar qué
otros locks toma ese método —incluidos los implícitos de cada `UPDATE`— y en qué orden, y
cruzarlo con los demás métodos que tocan esas mismas tablas. La pregunta no es "¿qué
protege esta línea?" sino "¿en qué orden quedan **todos** los locks de este camino?".

### ❌ Campo que escribe estado derivado sin pasar por su choke point

`item_producto.costo_actual` y `item_producto.stock` son valores derivados del kardex
(`costo_actual`: promedio ponderado móvil, ver
[ADR-016](../adr/016-costeo-promedio-ponderado-movil.md); `stock`: saldo materializado de
`movimientos_inventario`) — su única puerta legítima es
`InventarioService.registrarMovimiento`. `PATCH /items/:id` aceptaba `dto.costo` y
después, por el mismo motivo, `dto.stock`, y los escribía directo en la columna, sin
generar ningún movimiento de inventario: el número quedaba corrompido sin rastro de quién
lo cambió ni por qué. Para `stock` pesaba más todavía: la feature de
[recuento de inventario](../features/recuento-inventario.md) existe precisamente para
reemplazar el seteo absoluto por una sesión auditada con causa tipificada, y este camino
la saltaba entera desde el formulario de item.

```ts
// MAL — escribe el campo derivado directo, sin movimiento de inventario
if (dto.costo !== undefined) {
  await repo.update(id, { costoActual: dto.costo });
}
if (dto.stock !== undefined) {
  await repo.update(id, { stock: dto.stock });
}

// BIEN — el campo se rechaza siempre, con un validador que siempre falla
@ValidatorConstraint({ name: 'costoNoEditable', async: false })
class CostoNoEditableConstraint implements ValidatorConstraintInterface {
  validate(): boolean { return false; }
  defaultMessage(): string {
    return 'El costo no se edita desde el item: usá Inventario → Ajuste de costo';
  }
}
@ValidatorConstraint({ name: 'stockNoEditable', async: false })
class StockNoEditableConstraint implements ValidatorConstraintInterface {
  validate(): boolean { return false; }
  defaultMessage(): string {
    return 'El stock no se edita desde el item: usá PATCH /items/:id/stock (ajuste con motivo) o un recuento de inventario';
  }
}
// @ValidateIf, no @IsOptional: @IsOptional también saltea la validación cuando
// el valor es `null` explícito, no solo cuando la propiedad falta — dejaría
// pasar `{ "costo": null }`/`{ "stock": null }` con 200. @ValidateIf solo
// saltea si falta.
@ValidateIf((o) => o.costo !== undefined)
@Validate(CostoNoEditableConstraint)
costo?: string;

@ValidateIf((o) => o.stock !== undefined)
@Validate(StockNoEditableConstraint)
stock?: string;
```

**La trampa del `ValidationPipe`:** el pipe global usa `whitelist: true` **sin**
`forbidNonWhitelisted` (`main.ts`). Si la solución es simplemente *borrar* el campo del
DTO, la propiedad no autorizada se **descarta en silencio** — el request devuelve **200**
sin haber cambiado nada, un fallo callado peor que el bug original. Hay que rechazarlo
**explícitamente** con un validador que siempre falla y un mensaje que diga dónde sí
hacerlo; activar `forbidNonWhitelisted` globalmente cambiaría el comportamiento de todos
los endpoints y es una decisión aparte, no el parche de un campo.

**Límite conocido del test de invariante que lo enforca**
(`backend/src/common/invariants/costo-stock-choke-point.invariant.spec.ts`): es una
heurística de texto sobre template literals SQL (busca `costo_actual\s*=\s*\$` y
`stock\s*=\s*\$` fuera de `inventario.service.ts`). **No detectaría** una escritura hecha
vía el `Repository<ItemProducto>` inyectado en `items.service.ts` (hoy sin uso) llamando a
`.save()`/`.update()` con la propiedad camelCase `costoActual`/`stock` — el texto literal
`costo_actual`/`stock` no aparece en un `.ts` que arma el UPDATE vía TypeORM en vez de SQL
crudo. El test frena el patrón de bug real (SQL directo, que es como se rompió antes) y el
copy-paste accidental de ese SQL; no es un parser que entienda TypeORM. Si alguna vez se
usa ese repositorio para escribir en `item_producto`, la revisión de código —no el test—
es quien tiene que atajarlo.

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

### ❌ Leer una respuesta asíncrona sin comprobar que corresponde al estado actual

```ts
// MAL — el carrito cambió, la respuesta guardada es del carrito anterior
watch(lineas, () => { setTimeout(() => { resultado.value = await calcular(...) }, 300) })
// …y el template cruza por índice contra las líneas de AHORA
<AdvertenciasPrecio :advertencias="resultado?.lineas[index]?.advertencias ?? []" />
// …y el modal de cobro pide el total que salió de ahí
@cobrar="cobroOpen = true"

// BIEN — el resultado sabe a qué carrito pertenece
const { resultado, vigente, asegurarVigente } = useResultadoCalculado(() => input())
const calculoVigente = computed(() => vigente.value ? resultado.value : null)
async function abrirCobro() { if (await asegurarVigente()) cobroOpen.value = true }
```

Apareció en los tres carritos a la vez. El bug no es el cruce por índice —ese es el
correcto— sino que **nadie garantizaba que el par índice↔línea siguiera siendo el
mismo**: borrar la primera línea dibujaba su advertencia bajo la segunda, y hacer clic
en Cobrar dentro de la ventana del debounce abría el modal con el total anterior.

La regla general: si un dato se guarda desde un `await` y se cruza con estado que
pudo cambiar mientras tanto, guardar **junto al dato la identidad del estado que lo
produjo**. Un booleano "cargando" no alcanza: hay que poder responder *¿este
resultado es de esto que estoy mirando?*, no solo *¿hay algo en vuelo?*.
Detalle: `docs/patterns/frontend.md` §10.1.

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

### ❌ Dependencia nueva sin `optimizeDeps.include` en `nuxt.config.ts`

```ts
// Al importar un paquete nuevo (sobre todo CJS) desde un composable/componente,
// Vite lo descubre en runtime y fuerza un reload de página:
//   ℹ Vite discovered new dependencies at runtime: qz-tray ← ./app/composables/useImpresoras.ts

// BIEN — registrarlo en el pre-bundle en el mismo cambio que lo agrega
vite: {
  optimizeDeps: {
    include: ['@internationalized/date', 'decimal.js', 'maska/vue', 'qz-tray'],
  },
},
```

Si no se pre-bundlea, el dev server recarga la página la primera vez que se ejecuta
la ruta que lo importa (peor con paquetes CJS). Al `npm install` de una dependencia
nueva de runtime, sumarla a `include` en el mismo commit — no esperar a ver el warning.

### ❌ Control con permiso propio anidado bajo el `v-if` de otro permiso

```vue
<!-- MAL — "Aplicar" hereda el gate de readOnly, que es el permiso de CONTAR -->
<div v-if="!readOnly">
  <UButton @click="cancelar">Cancelar recuento</UButton>
  <UButton v-if="puedeAplicar">Aplicar</UButton>
</div>

<!-- BIEN — cada control con el permiso que exige SU endpoint -->
<div v-if="esBorrador && (puedeContar || puedeAplicar)">
  <UButton v-if="puedeContar" @click="cancelar">Cancelar recuento</UButton>
  <UButton v-if="puedeAplicar">Aplicar</UButton>
</div>
```

`readOnly` incluye `!puedeContar` (`Inventario/Crear`), pero aplicar exige
`Inventario/Actualizar`. Anidado, el rol aprobador —`Leer` + `Actualizar`, sin `Crear`—
se quedaba sin la acción que le corresponde, rompiendo la asimetría que el diseño existe
para sostener. Los dos computeds eran correctos por separado: el defecto vivía en el
anidamiento, así que ningún unit test de la lógica lo habría visto. Regla completa y
trampa: `docs/patterns/frontend.md` §1.1.

## Pruebas (unit)

### ❌ Aserción que no puede fallar

```ts
// MAL — el servicio nunca emite ese SQL: todo el stock se mueve por
// registrarMovimiento, que en esta suite está mockeado.
const tocaStock = manager.query.mock.calls.find((c) =>
  String(c[0]).includes('UPDATE item_producto'),
)
expect(tocaStock).toBeUndefined()

// BIEN — asertar sobre el colaborador que haría el trabajo
expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled()
```

La misma aserción pasaba en verde sobre `aplicar()`, que **sí** mueve stock: buscaba un
string que el código bajo prueba no puede producir. Antes de asertar la ausencia de algo,
verificar que ese algo podría aparecer si el bug existiera.

### ❌ Test cuyo resultado lo decide el mock

```ts
// MAL — el mock ya trae la respuesta; el branch que el título dice probar
// ("referenciado solo por un recuento") nunca se ejerce.
queryMock.mockResolvedValueOnce([{ existe: true }])
await expect(service.remove(TENANT, ID)).rejects.toThrow('en uso')
expect(sql).toContain('recuento_inventario_linea') // sobrevive aunque el WHERE esté roto

// BIEN — en unit, solo lo que el mock NO decide…
expect(queryMock).toHaveBeenCalledTimes(2) // una query, no tres: sin N+1
expect(
  queryMock.mock.calls.some((c) => String(c[0]).includes('eliminado_el = NOW()')),
).toBe(false) // no borró
// …y el branch real, contra la BD, en el e2e.
```

Dos tests con títulos distintos y setup idéntico son un solo test. Un branch de SQL
(columna equivocada, `WHERE` que nunca matchea) solo lo prueba la base real.

### ❌ Cambiar un vocabulario compartido y actualizar solo los consumidores del módulo que tenés delante

Un valor de un enum, un motivo del kardex, un estado: viven en **más lugares que su
módulo**. Pasó dos veces en jul-2026, las dos con el mismo síntoma —el gate completo en
verde y la feature rota— y las dos las cazó la revisión independiente, no un test.

```
// Sacar `borrador` de EstadoVenta: se limpiaron pages/ventas y components/ventas…
// …y quedó vivo en pages/pagos/index.vue, que ofrecía el filtro y recibía 400.

// Agregar el motivo `anulacion` al kardex: se escribía bien, pero
// find-movimientos.dto.ts seguía con el whitelist viejo (@IsIn) →
// GET /inventario/movimientos?motivo=anulacion respondía 400.
```

**Antes de tocar un valor compartido, greapear el repo ENTERO** (no la carpeta del
módulo) y clasificar cada consumidor en dos grupos, porque no todos van:

- **Lectura** (filtros, whitelists de query, desplegables de consulta, mapas de
  color/etiqueta) → casi siempre hay que actualizarlos.
- **Escritura** (DTOs de creación manual, selectores de formulario) → a veces el valor
  nuevo **no corresponde**: `anulacion` no va en el ajuste manual de stock, porque nadie
  la elige a mano — la genera el flujo.

Un valor nuevo que se escribe pero no se puede consultar deja media feature invisible, y
la doc del mismo commit suele afirmar que funciona.

### ❌ Test que pasa por una razón distinta de la que dice probar

Un test verde no prueba nada si el escenario dispara **otra** regla antes de llegar a la
que se quería cubrir. Pasó tres veces en jul-2026, y las tres fueron descubiertas
apagando el fix a mano, nunca leyendo el test.

```ts
// MAL — "rechaza el método de pago no contratado": 400 verde… emitido por la regla
// del vuelto, porque 10000 supera el total. El gate del método nunca se ejecutó.
pagos: [{ metodoPagoId: METODO_AJENO, monto: '10000.0000' }]   // total = 5950
  .expect(400)

// MAL — "el vuelto va al método que lo permite": el método con vuelto era el primero
// del array Y el primero por orden de id, así que elegir-por-permiso, elegir-el-primero
// y elegir-por-id dan lo mismo. El test no distingue entre las tres.

// PEOR — el 2º intento del mismo test, con el orden dado vuelta. Con SOLO DOS
// elementos el ganador es inevitablemente "el último", "el de id mayor" y "el de
// monto mayor" a la vez: es imposible aislar el criterio. Hacen falta TRES, con el
// caso correcto en el MEDIO de cada dimensión que podría confundirse.

// MAL — "rechaza un garzón de otro tenant" con un UUID inexistente: pasa por
// "garzón no encontrado" sin tocar nunca el chequeo de tenant.
```

**Regla:** construir el escenario de modo que **la regla bajo prueba sea la única que
puede fallar** —monto por debajo del total, el caso correcto en la posición que ninguna
heurística acierta, un garzón real de otro tenant sembrado a propósito— y **aseverar el
mensaje**, no solo el status.

**Cómo se detecta, siempre igual:** apagar el fix en el código de producción y correr el
test. Si sigue verde, no prueba lo que dice. Son treinta segundos y es lo único que
separa un test real de uno decorativo.

⚠️ **Un solo mutante no alcanza cuando lo que se prueba es una *elección* entre
candidatos.** El 2º intento del test del vuelto sobrevivió al mutante obvio (el bug
histórico: "elegir el primero") y aun así no probaba nada, porque otras tres heurísticas
igual de plausibles daban el mismo resultado. Para una elección hay que enumerar **todas
las heurísticas alternativas que el fixture no descarta** —posición, orden de id, monto,
cantidad— y correr un mutante por cada una. Si con dos elementos alguna es indistinguible,
el fixture necesita un tercero.

## Pruebas E2E de navegador

*(Sección a poblar cuando exista la suite. Entradas previstas según el diseño acordado:
esperas fijas en lugar de aserciones web-first, tests que dependen del estado dejado
por otro test, y aserciones de montos copiadas de la salida del código en vez de
derivadas de `docs/features/`. No se documentan aquí hasta que ocurran de verdad.)*
