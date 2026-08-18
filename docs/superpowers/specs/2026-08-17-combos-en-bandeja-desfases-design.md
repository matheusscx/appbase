# Los combos entran a la bandeja de desfases — Design Spec

**Fecha:** 2026-08-17
**Estado:** 📐 Aprobado por el owner — listo para plan de implementación
**Origen:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) — entrada *"El costo de un combo
se queda viejo y nadie avisa, a diferencia de las recetas"* (auditoría `inventario` 2026-08-15)
**Features relacionadas:** [`simulador-impacto-costos.md`](../../features/simulador-impacto-costos.md),
[`combos.md`](../../features/combos.md)

---

## Contexto

`item_combo.costo_actual` es un caché: se calcula al crear o editar el combo y **no se recalcula
cuando cambia el costo de un componente**. A diferencia de las recetas, que tienen la bandeja de
desfases desde el 2026-07-15, para los combos no hay ningún disparador ni ninguna bandeja. El costo
obsoleto se sigue exponiendo en cada listado igual que el de un producto o una receta, así que el
margen que muestra la pantalla es incorrecto por tiempo indefinido.

`combos.md` ya declaraba la ausencia como fuera de alcance; `simulador-impacto-costos.md` **no**,
así que hoy no es una limitación conocida sino un hueco silencioso.

**Decisión del owner (2026-08-15):** los combos entran a la misma bandeja de desfases que las
recetas. Un solo lugar donde mirar, y el margen que muestra el listado deja de mentir.

### Lo medido antes de diseñar

1. **El costo de un combo se arma distinto que el de una receta.**
   `validarYCostearComponentes` (`items.service.ts:3482`) hace `Σ(costo_actual × cantidad)` leyendo
   el costo **cacheado** de cada componente, y **sin conversión de unidades**. No existe, entonces,
   el caso *"receta sin costo proponible por unidad incompatible"*: ni la tolerancia de lectura ni
   los dos `400` de escritura que las recetas necesitan tienen equivalente acá.
2. **`ingrediente` y `producto` son tipos distintos y los caminos no se cruzan.** Una receta solo
   lleva items `tipo='ingrediente'` (`startup-pos.sql:609`); un componente de combo solo puede ser
   `producto | receta | servicio` (`items.service.ts:3472`).
3. **De ahí sale un segundo defecto, no anotado en el backlog:** `recetasAfectadasPorIngrediente`
   exige `tipo='ingrediente'` (`items.service.ts:3856`), así que **comprar un producto no abre
   ningún modal** — la llamada devuelve `404` y el `catch` de `useSimuladorDesfases.ts:31` la traga
   en silencio. Ese 404 mudo es la mitad del "nadie avisa" de la entrada, y se cierra acá.
4. `filasValidacionPorIds` resuelve el costo de un componente con
   `COALESCE(ip.costo_actual, ir.costo_actual)` sin mirar `item_combo`, coherente con que no haya
   combos anidados.

---

## Decisiones del owner tomadas en este diseño

### Decisión 1 — Un combo se desfasa contra el costo **cacheado** de sus componentes

Un componente **producto** desfasa el combo al instante. Un componente **receta** no: su costo
cacheado no se mueve hasta que alguien aplique el desfase de esa receta.

Con el combo del seed — *Combo Clásico* = 1 Hamburguesa (receta, cacheada $1.200) + 1 Papas
(producto, $500), `item_combo.costo_actual` = $1.700:

| Qué sube | Qué pasa |
|---|---|
| Las papas, a $600 | El combo aparece en la bandeja de inmediato, proponiendo $1.800 |
| La carne (ingrediente de la Hamburguesa) | Aparece la Hamburguesa ($1.200 → $1.350). El combo **no**: su Σ de cacheados sigue dando $1.700. Al aplicar la Hamburguesa, el combo aparece proponiendo $1.850 |

**Por qué así y no expandiendo la receta hasta sus ingredientes:** el número de la bandeja es
entonces exactamente el que produciría volver a guardar el combo, y el costo del combo siempre es
la suma de lo que hoy valen sus componentes según el sistema. No hay un tercer número intermedio.
Es también lo que `combos.md` ya declara: sin recálculo en cascada.

**El costo aceptado:** dos pasadas por la bandeja cuando el que se movió es un ingrediente.

### Decisión 2 — La segunda pasada no obliga a volver a entrar

Aplicar el desfase de una receta responde también con los combos que quedaron desfasados por ese
mismo lote, y el panel los muestra como filas nuevas para resolver ahí mismo. La segunda pasada
existe, pero es un paso más en la misma pantalla: no inventa navegación nueva ni estado
persistente. Descartadas por alcance: dejar el combo esperando sin aviso (que es justo lo que la
entrada del backlog denuncia) y un badge con contador en la navegación (fuera de alcance del
simulador original).

### Decisión 3 — Enfoque: generalizar a "items compuestos"

Los endpoints, el DTO, el panel y la página dejan de hablar de recetas y hablan de items con
`tipo: 'receta' | 'combo'`. Descartados: endpoints paralelos para combos (deja la definición de
"desfase" escrita en dos lugares, que es lo que hace que un día divergan) y extender
`/recetas/desfases` sin renombrar (un `POST /recetas/desfases/aplicar` que escribe en `item_combo`
es deuda que en seis meses no se entiende).

El renombre no arrastra deprecaciones ni compatibilidad: no hay datos productivos ni consumidores
externos de la API.

---

## Modelo de datos

Una columna, espejo de la que ya tiene `item_receta`:

```sql
ALTER TABLE item_combo ADD COLUMN costo_propuesto_omitido NUMERIC(18,4);
```

En `startup-pos.sql` y en la entidad `ItemCombo`
(`backend/src/modules/items/entities/item-combo.entity.ts`), que ya existe y ya está registrada en
`app.module.ts`. Nada más: el costo propuesto de un combo se calcula al vuelo, igual que el de una
receta.

---

## Backend — API

Controller nuevo `desfases.controller.ts` con `@Controller('desfases')`, que reemplaza a
`recetas-desfases.controller.ts`. **No** `@Controller('items')`: `GET /items/desfases` competiría
con `GET /items/:id` y el ganador lo decidiría el orden de registro en el módulo.

| Hoy | Queda |
|---|---|
| `GET /recetas/desfases?ingredienteItemId=` | `GET /desfases?insumoItemId=` |
| `POST /recetas/desfases/aplicar` con `items: [{ recetaItemId, … }]` | `POST /desfases/aplicar` con `items: [{ itemId, … }]` |
| `POST /recetas/desfases/descartar` con `recetaItemIds` | `POST /desfases/descartar` con `itemIds` |
| `GET /items/:id/recetas-afectadas` | `GET /items/:id/afectados` |

`GET /desfases` sin filtro devuelve las recetas y los combos desfasados del tenant en una sola
lista, ordenada por nombre. Permisos sin cambios: `Items:Leer` para la lectura,
`Items:Actualizar` para aplicar y descartar.

`DesfaseRecetaDto` pasa a `DesfaseItemDto`:

- `recetaItemId` → `itemId`
- se agrega `tipo: 'receta' | 'combo'`
- `ingredientesAfectados` → `afectados`: para una receta son sus ingredientes; para un combo, sus
  componentes. Un componente `servicio` va con `costoActual: null`, igual que hoy un ingrediente
  sin costo.

`GET /items/:id/afectados` acepta ahora `tipo IN ('ingrediente','producto')` en vez de solo
`ingrediente`, y devuelve las recetas que usan ese insumo **más** los combos que lo tienen de
componente directo. Es lo que cierra el 404 mudo del punto 3 del contexto.

---

## Backend — reglas de cálculo

El costo propuesto de un combo es `Σ(costo_actual cacheado del componente × cantidad)`, la misma
fórmula de `validarYCostearComponentes`. Comparación a 4 decimales con `eq4`, y
`costo_propuesto_omitido` con el mismo comportamiento que en recetas: descartar guarda el propuesto
del momento, y el combo reaparece cuando ese número cambia.

Tres cosas que **no** aplican a combos, escritas para que nadie las copie de más:

- No hay conversión de unidades → no existe el caso "sin costo proponible", ni su tolerancia de
  lectura, ni los dos `400` de escritura.
- Un combo no puede contener otro combo → la recursión no es un caso.
- Un combo sin componentes vivos se omite de la bandeja, con el mismo guard que hoy omite una
  receta sin ingredientes (`construirFilasDesfase`, `items.service.ts:3801`).

Márgenes y precio sugerido se calculan con los helpers existentes (`margenPct`, `precioSugerido`)
sin cambios: un combo tiene `items.precio_base` propio, así que las fórmulas aplican tal cual.

### Locks y transacción

Aplicar mantiene la transacción atómica y agrega el lock de `item_combo` con el mismo
`ORDER BY item_id FOR UPDATE` que ya usa `item_receta` (`items.service.ts:3901`), **siempre en el
orden recetas → combos**, para que dos lotes con filas en común no se abracen. Es el patrón que ya
está en el código con su comentario; sigue el frente 🔴 de conexiones, no lo abre.

### Respuesta de aplicar, y el lote mixto

`POST /desfases/aplicar` responde `{ aplicados, omitidos, afectados }`.

- `afectados` son los combos que contienen alguna de las recetas aplicadas y quedan desfasados
  después de escribirlas, calculados dentro de la transacción antes del commit. Es el mecanismo
  de la Decisión 2. La regla no distingue si el combo ya estaba desfasado por otro motivo: si
  contiene una receta del lote y está desfasado al terminar, va en la lista.
- `omitidos` resuelve el lote que se pisa a sí mismo: si un lote mezcla una receta y un combo que
  la contiene —alcanzable desde la bandeja si una compra movió un ingrediente y un producto a la
  vez—, el combo **no se aplica**. Sale en `omitidos` con el motivo y vuelve en `afectados` con su
  costo nuevo, para que el usuario lo confirme viendo el número correcto.

**Por qué se omite en vez de escribirlo:** aplicarlo lo escribiría con un costo distinto del que el
usuario aprobó, y con un precio de venta calculado para el número viejo. Rechazar el lote entero
con un `409` era la alternativa; se descartó por ser más ruidosa sin ser más segura.

---

## Frontend

- `RecetasDesfasesPanel.vue` → `DesfasesPanel.vue`, con una columna "Tipo" (Receta / Combo). El
  gate de permiso (`usePermisosCrud('Items')`) y el `highlightIngredienteId` quedan como están: el
  highlight matchea por `itemId`, así que funciona igual para un componente.
- `useSimuladorDesfases.ts` conserva el nombre y cambia en un punto: hoy `onAplicarDesfases` cierra
  el drawer siempre; pasa a cerrarlo solo si `afectados` viene vacío. Si trae combos, reemplaza las
  filas y deja el panel abierto con un toast que dice cuántos combos quedaron desfasados. Es toda
  la mecánica de la segunda pasada.
- `pages/recetas-desfases.vue` → `pages/desfases.vue`. El nav de `layouts/dashboard.vue:138` pasa
  de "Recetas desfasadas" a "Costos desfasados", y el shim que ya existe en
  `configuracion/recetas-desfases.vue` se repunta a la ruta nueva. No se agrega un segundo shim: no
  hay usuarios productivos con la URL vieja guardada.
- Las tres páginas que usan el panel (`recetas-desfases`, `configuracion/items`, `inventario`)
  siguen usándolo sin cambios de contrato más allá del renombre de campos.

---

## Verificación

Unit en `items.service.spec.ts`:

- El caso numérico del seed: $1.200 + $500 = $1.700 → papas a $600 → propuesto $1.800.
- Decisión 1: sube la carne, la Hamburguesa aparece desfasada y el Combo **no**.
- Decisión 2: aplicar la Hamburguesa devuelve el Combo en `afectados`.
- El lote mixto: receta + combo que la contiene → el combo sale en `omitidos` y no se escribe.
- Descartar un combo lo oculta hasta que el propuesto cambie de nuevo.

E2E: se extiende `simulador-costos.e2e-spec.ts` con el recorrido de combos, en vez de crear un spec
nuevo. Incluye el camino que hoy falla en silencio: comprar un producto que es componente de un
combo y verificar que `GET /items/:id/afectados` devuelve el combo en vez de `404`.

Gate completo antes de commitear (skill `verify-feature`), con `npm run test:e2e` entero y no un
subconjunto: el renombre toca endpoints que consumen tres pantallas.

---

## Documentación a actualizar en el mismo commit

| Archivo | Qué cambia |
|---|---|
| `docs/features/simulador-impacto-costos.md` | Combos en el alcance; desaparece la exclusión; endpoints y DTO nuevos |
| `docs/features/combos.md` | Se cae el "NOT included" del recálculo de `costo_actual` |
| `docs/ESTADO.md` | Fila de la funcionalidad |
| `docs/agent/pendientes.md` → `resueltos.md` | La entrada se muda con su cierre |

---

## Fuera de alcance

- Combos anidados (no existen en el modelo).
- Cascada automática de cualquier tipo: aplicar sigue siendo un acto explícito por fila.
- Badge con contador en la navegación.
- Historial auditable de quién aplicó o descartó qué — sigue siendo el "NOT included" del
  simulador original.
- Cola persistente o snooze por fecha.
