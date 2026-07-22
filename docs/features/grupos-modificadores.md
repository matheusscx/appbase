# Feature: Grupos de modificadores reutilizables

**Status**: Complete
**Owner**: SDD Team
**Last Updated**: 2026-07-22

---

## Overview

### What is it?

Un **grupo de modificadores** (`grupos_modificadores`) es un conjunto reutilizable
de opciones — a nivel tenant, no por item — que se asocia a N combos o recetas
distintos (ej. el grupo "Bebida" puede vivir tanto en "Combo Clásico" como en
"Combo Familiar"). Cada opción del grupo es un item existente del catálogo
(`producto`, `receta`, `servicio` o `ingrediente`) con una **cantidad** y un
**recargo** (`precioExtra`) propios de esa opción dentro del grupo. Al asociar
un grupo a un item (combo o receta) se declara cuántas unidades totales debe
elegir el customer: `min`/`max` en **unidades**, no en cantidad de opciones
distintas.

Ejemplos del seed demo:
- **Proteína** (familia ingrediente): carne / pollo (+$0), chuleta (+$1.500),
  150 g cada una (default del grupo). Asociado a **dos** recetas: "Hamburguesa
  Especial" (`min:1, max:1` — obligatorio, una sola proteína, y a diferencia
  de "Hamburguesa Clásica" no la lleva como `receta_ingrediente` fijo) usa los
  150 g por defecto sin overridear, y "Hamburguesa Especial XL" reutiliza el
  **mismo grupo** con la cantidad overrideada a 250 g por opción (ver
  "Cantidades de consumo por item" más abajo).
- **Bebida** (familia vendible): Coca-Cola (+$0), Bebida premium (+$800).
  Asociado al **Combo Clásico** existente (`min:1, max:1` — obligatorio).

### Why does it exist?

Combos (`docs/features/combos.md`, Ticket A) solo cubría **componentes
fijos** — sin elección del customer. Food-service necesita "elige tu bebida" /
"elige tu proteína" sin duplicar el mismo catálogo de opciones en cada combo o
receta que lo requiera (ej. si 5 combos distintos ofrecen la misma elección de
bebida, se define **una vez** el grupo "Bebida" y se asocia a los 5). Recetas
ya tenía `receta_extras_permitidos` (extras opcionales, sin límite de
elección) — los grupos añaden el caso de **elección obligatoria/acotada entre
alternativas homogéneas**, que `receta_extras_permitidos` no modela.

### Scope

**Included:**
- Módulo `GruposModificadoresModule`: CRUD de grupos + sus opciones
  (`grupos_modificadores`, `grupo_modificador_opciones`).
- **Familia derivada, no persistida**: `ingrediente` (todas las opciones
  `tipo='ingrediente'`) o `vendible` (todas `producto | receta | servicio`).
  Se recalcula en cada lectura a partir del `tipo` de la primera opción viva —
  ningún campo `familia` existe en la tabla.
- **Homogeneidad verificada al guardar**: todas las opciones de un grupo deben
  resolver a la misma familia; si no, `400`.
- Validación por tipo de opción: `ingrediente` requiere `modo_inventario =
  'cantidad'` y `unidadCodigo` convertible contra la unidad base del
  ingrediente (mismo `CatalogService.convertirUnidad` que usan recetas);
  `vendible` nunca admite `combo` ni `suscripcion` como opción (sin combos ni
  suscripciones anidadas dentro de un grupo).
- Asociación item↔grupo (`item_grupos_modificadores`, `min`/`max`/`orden`) —
  un combo o una receta puede tener 0..N grupos asociados.
- **Combos**: la validación "≥1 componente" se relaja a "≥1 componente fijo o
  ≥1 grupo" — un combo puede existir compuesto **solo** por grupos (sin
  componentes fijos), en cuyo caso `item_combo.costo_actual = '0'` (el costo
  real se realiza al vender, vía el movimiento de inventario de la opción
  elegida — ver `docs/adr/013-grupos-modificadores-reutilizables.md`).
- `GET /items/:id` (combo o receta) devuelve `grupos[]` con sus opciones y
  stock; `GET /items?tipo=combo` marca `disponibleCondicional: true` si el
  combo tiene ≥1 grupo asociado (la disponibilidad real depende de qué opción
  elige el customer, no es un número fijo).
- Bloqueo de borrado: un item que es opción viva de un grupo no puede
  eliminarse (`400`); un grupo asociado a items vivos no puede eliminarse.
- **Snapshot congelado en la venta**: `resolverGruposDeItem` valida que cada
  opción elegida pertenezca al grupo asociado y que `min ≤ Σunidades ≤ max`,
  calcula el recargo (`Σ precioExtra × unidades`) y persiste todo
  (`grupoId`, `grupoNombre`, opciones con `cantidad`/`unidadCodigo`/
  `precioExtra`/`unidades`) en `personalizacion` (`cuenta_lineas` /
  `venta_detalles`) — el backend nunca confía en el precio que mande el
  frontend, siempre revalida contra el catálogo vivo al momento de vender.
- **Descuento de inventario por opción elegida** (`venderOpcionesGrupos`):
  efecto según el `tipo` de la opción — `receta` expande a sus ingredientes
  (`venderIngredientesReceta`), `producto`/`ingrediente` genera una salida
  directa (con conversión de unidad si aplica), `servicio` no genera
  movimiento. **Siempre bloqueante** — a diferencia de los ingredientes fijos
  de receta (que pueden ser no bloqueantes), una opción de grupo elegida por
  el customer sin stock **aborta la venta** (regla fija, no configurable — es
  lo que el customer explícitamente pidió).
- CRUD de grupos en Configuración → Grupos de modificadores
  (`pages/configuracion/grupos-modificadores.vue`); sección de grupos
  compartida en el editor de Items (combo + receta, `pages/configuracion/items.vue`).
- Drawer de personalización unificado y renombrado
  (`components/ventas/ItemPersonalizacionDrawer.vue`, antes específico de
  recetas) — ahora también renderiza grupos para combos y recetas, exige
  min/max antes de habilitar "Agregar", y hace merge de líneas en Salones por
  la misma personalización congelada (grupos incluidos en la clave de merge).
- **Cantidad/recargo overrideables por receta** (`item_grupo_modificador_opciones`,
  2026-07-21): el grupo mantiene `cantidad`/`unidadCodigo`/`precioExtra` como
  default opcional por opción; cada asociación item↔grupo puede overridear esos
  valores para SU receta sin tocar el grupo ni las demás recetas que lo usan.
  Ver "Cantidades de consumo por item" más abajo.
- Seed demo: grupos "Proteína" (con override 150 g / 250 g entre dos recetas)
  y "Bebida" (ver sección Seed demo).
- **Grupos anidados en combos, un nivel** (2026-07-22): un combo expone
  automáticamente los grupos de sus componentes **receta** al vender — ver
  sección "Grupos anidados en combos (un nivel)" más abajo.

**NOT included (future):**
- **Impresión térmica de las opciones elegidas de un grupo** — diferida
  explícitamente a un ticket aparte (decisión confirmada por el usuario,
  2026-07-20). Hoy la comanda/boleta imprime el item (combo o receta) por su
  nombre, sin desglosar qué opción de grupo se eligió (ej. "Hamburguesa
  Especial" sin indicar "con chuleta"). **No es un olvido**: el snapshot
  `personalizacion.grupos` ya congela todo lo necesario (nombre de grupo,
  opción elegida, unidades) para implementarlo después **sin migración** — el
  trabajo pendiente es puramente de plantilla de impresión
  (`docs/features/impresion-termica.md`), no de modelo de datos.
- **Anidamiento de más de un nivel** (combo → componente → grupo de una
  OPCIÓN del grupo del componente) — solo un nivel de profundidad (combo →
  componente receta → sus grupos).
- **Grupos en `producto` puro** (sin ser receta) — hoy solo `receta` (y
  `combo`) pueden tener grupos asociados; un `producto` no.
- **Curaduría por combo** de los grupos heredados de un componente (min/max
  propios del combo sobre el grupo del componente, distintos de los que ya
  tiene la receta) — sigue siendo automático y 1:1 con lo que la receta
  declara.
- Evaluación de condiciones para habilitar/deshabilitar opciones (fase futura,
  igual que descuentos/recargos condicionales).

---

## Modelo de datos

### `grupos_modificadores`

| Column | Type | Notes |
|--------|------|-------|
| `grupo_modificador_id` | UUID PK | |
| `tenant_id` | UUID | Del token |
| `nombre` | TEXT | Único por tenant entre grupos vivos (case-insensitive) |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete |

Sin columna `familia` ni `tipo` — se deriva en cada lectura del `tipo` de la
primera opción viva (`ingrediente` → familia `ingrediente`; cualquier otro
tipo permitido → familia `vendible`).

### `grupo_modificador_opciones`

| Column | Type | Notes |
|--------|------|-------|
| `grupo_opcion_id` | UUID PK | Preservado en updates (upsert-preservando, ver `docs/patterns/backend.md` §14) |
| `tenant_id` | UUID | |
| `grupo_modificador_id` | UUID FK | |
| `item_id` | UUID FK → items | `producto \| receta \| servicio \| ingrediente` |
| `cantidad` | NUMERIC(18,4), **nullable** | Default por 1 unidad elegida; `NULL` = sin default (toda receta que use esta opción sin override queda *pendiente*, ver sección "Cantidades de consumo por item") |
| `unidad_codigo` | TEXT, nullable | Solo familia `ingrediente`; `NULL` en `vendible` |
| `precio_extra` | NUMERIC(18,4) NOT NULL DEFAULT 0 | Recargo ≥ 0 default, por unidad elegida — nunca `NULL` |
| `orden` | INT | Orden de presentación |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete al reemplazar lista (mismo patrón que `combo_componentes`) |

Índice único parcial: `(grupo_modificador_id, item_id) WHERE eliminado_el IS NULL`
— un item no puede aparecer dos veces como opción del mismo grupo vivo.

### `item_grupos_modificadores`

| Column | Type | Notes |
|--------|------|-------|
| `item_grupo_id` | UUID PK | Preservado en updates (upsert-preservando) — es la llave del override, ver abajo |
| `tenant_id` | UUID | |
| `item_id` | UUID FK → items | Combo o receta |
| `grupo_modificador_id` | UUID FK | |
| `min` | INT | Default 1. Unidades mínimas totales a elegir |
| `max` | INT | Unidades máximas totales a elegir |
| `orden` | INT | |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete |

Índice único parcial: `(item_id, grupo_modificador_id) WHERE eliminado_el IS NULL`
— un item no puede asociar el mismo grupo dos veces mientras esté vivo.

**`min`/`max` son unidades totales del grupo, no cantidad de opciones
distintas.** Ej. "Proteína" con `min:1, max:1` significa "elegí 1 unidad entre
todas las opciones" (una sola proteína, cualquiera sea); un grupo con `min:1,
max:2` permitiría elegir 2 unidades de la misma opción o 1+1 de dos distintas
— la suma de `unidades` por opción elegida es lo que se valida contra
`min`/`max`, nunca la cantidad de opciones distintas elegidas.

### `item_grupo_modificador_opciones`

| Column | Type | Notes |
|--------|------|-------|
| `item_grupo_opcion_id` | UUID PK | |
| `tenant_id` | UUID | |
| `item_grupo_id` | UUID FK → `item_grupos_modificadores` | La asociación item↔grupo que overridea |
| `grupo_opcion_id` | UUID FK → `grupo_modificador_opciones` | La opción reutilizable que overridea |
| `cantidad` | NUMERIC(18,4), nullable | `NULL` = hereda el default del grupo (`COALESCE(override, default)`) |
| `unidad_codigo` | TEXT, nullable | Idem — override de unidad, solo familia `ingrediente` |
| `precio_extra` | NUMERIC(18,4), nullable | `NULL` = hereda el default del grupo (que nunca es `NULL`, así el efectivo tampoco) |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete — un override eliminado vuelve a heredar el default |

Fila **por opción efectivamente overrideada** de una asociación, no una fila
por cada opción del grupo — si una receta no overridea nada, esta tabla no
tiene filas para su `item_grupo_id` y toda opción resuelve al default del
grupo. Detalle completo del modelo en "Cantidades de consumo por item" más
abajo.

---

## Cantidades de consumo por item

**Modelo híbrido**, no puro: el grupo sigue siendo un **catálogo reutilizable**
con `cantidad`/`unidadCodigo`/`precioExtra` como **default opcional** por
opción (`grupo_modificador_opciones`); cada receta (o combo) que usa el grupo
puede **overridear** esos valores para SU propio consumo, sin tocar el grupo
ni afectar a las demás recetas que lo comparten. El caso demo del seed: el
grupo "Proteína" tiene default de 150 g por opción; "Hamburguesa Especial" lo
usa tal cual (150 g), "Hamburguesa Especial XL" overridea a 250 g — el mismo
grupo, dos cantidades de consumo distintas.

**Por qué híbrido y no puro** (cantidad solo en el grupo, o solo por receta):
- **Cero migración de datos.** Los grupos y recetas ya existentes (creados
  antes de este cambio) siguen funcionando exactamente igual: sin filas de
  override, todo resuelve al default del grupo — ninguna venta pasada ni
  receta viva cambia de comportamiento.
- **Opciones nuevas vendibles desde el día 1** si el grupo ya tiene default —
  agregar una opción al grupo no exige que cada receta que lo usa declare
  antes su propia cantidad.
- **El drawer de recetas se pre-llena**, no exige N formularios vacíos: al
  asociar un grupo a una receta, el formulario ya muestra el default como
  punto de partida; el usuario solo overridea lo que necesita distinto.

**Resolución — `COALESCE(override, default)`.** Toda lectura de la cantidad
(y del recargo) efectiva de una opción para una receta hace `LEFT JOIN
item_grupo_modificador_opciones ovr ON ovr.grupo_opcion_id = o.grupo_opcion_id
AND ovr.item_grupo_id = <esta asociación> AND ovr.eliminado_el IS NULL` y
selecciona `COALESCE(ovr.cantidad, o.cantidad)` / `COALESCE(ovr.unidad_codigo,
o.unidad_codigo)` / `COALESCE(ovr.precio_extra, o.precio_extra)`. Misma query
en `ItemsService` (detalle de item, `GET /items/:id`) y en
`resolverGruposDeItem` (al vender) — el snapshot de venta congela el valor
efectivo, nunca el default crudo.

**Estado *pendiente*.** Si una opción no tiene `cantidad` ni en el override ni
en el default del grupo (`COALESCE` resuelve a `NULL`), esa opción queda
*pendiente* para esa receta: `esPendiente: true` en la respuesta, el POS no la
ofrece para elegir, y `resolverGruposDeItem` la **rechaza** (`400`) si llega
elegida desde el frontend. **No bloquea** guardar el grupo (una opción sin
default es válida, solo pendiente hasta que alguna receta la overridee o el
grupo defina un default) ni guardar la asociación item↔grupo (una receta
puede asociar el grupo hoy y overridear cantidades después, vía el drawer de
recetas).

**`precioExtra` sigue la misma lógica de default+override.** A diferencia de
`cantidad`, el default de `precioExtra` en el grupo es `NOT NULL DEFAULT 0` —
el valor efectivo nunca es `NULL` incluso sin override (nunca queda
"recargo pendiente", solo cantidad).

**Llave del override — UUIDs preservados, no llave de negocio.** Un override
en `item_grupo_modificador_opciones` se identifica por el par
(`item_grupo_id`, `grupo_opcion_id`) — los UUIDs de la asociación item↔grupo y
de la opción del grupo, **preservados** entre updates en vez de una llave de
negocio estable (ej. nombre de opción). Esto exige que los dos flujos de
"reemplazo total" existentes (guardar opciones de un grupo; guardar grupos
asociados a un item) se comporten como **upsert-preservando** en vez de
soft-delete-todo-e-insertar-todo — de lo contrario, cada edición generaría
UUIDs nuevos y **huérfanaría** cualquier override existente (el override
seguiría apuntando al `grupo_opcion_id` viejo, ya soft-deleted). Ver
`docs/patterns/backend.md` §14 ("Upsert-preservando UUID por llave de
negocio") para el patrón general y ADR-014 para la decisión completa.

**Upsert-preservando con cascada.** Al guardar de nuevo las opciones de un
grupo (o los grupos asociados a un item), cada fila que coincide con una
existente por su llave de negocio (`itemId` de la opción; `grupoModificadorId`
de la asociación) **reutiliza el mismo UUID** (`UPDATE`, no
soft-delete+insert); solo lo que ya no viene se soft-deletea. Las opciones/
asociaciones soft-deletadas en esa pasada arrastran en cascada el soft-delete
de sus overrides en `item_grupo_modificador_opciones` (para que no queden
overrides vivos apuntando a algo eliminado). Un override eliminado (porque la
receta dejó de overridear esa opción, o porque la opción/asociación fue
eliminada) simplemente vuelve a heredar el default del grupo la próxima vez
que se lea — nunca hay que "reconstruir" el override manualmente.

---

## Grupos anidados en combos (un nivel)

**Problema que resuelve (2026-07-22):** un combo con un componente **receta**
que a su vez tiene su propio grupo de modificadores no exponía ese grupo al
vender el combo. Ejemplo real: "Combo Clásico" = Hamburguesa Clásica (receta) +
Bebida (grupo del combo) — la Hamburguesa Clásica tiene su propio grupo
"Proteína", pero agregar el combo al carrito solo ofrecía elegir la Bebida
(grupo del combo), nunca la Proteína (grupo del componente). Esto no era un
bug: los grupos anidados estaban explícitamente fuera de alcance del diseño
original (ver Scope arriba, versión anterior a esta fecha).

**Decisiones cerradas (owner, ver `docs/superpowers/specs/2026-07-22-grupos-modificadores-anidados-combo-design.md`):**
- **Automático (estilo Square):** cualquier componente receta con grupos los
  expone al vender el combo, sin configuración extra ni curaduría del combo.
- **Por unidad:** un componente con `cantidad = N` pregunta N veces —
  independientes entre sí (2 hamburguesas → una proteína por cada una, pueden
  ser distintas). El snapshot y el descuento de stock trackean por unidad.
- **Solo recetas:** hoy solo `receta` (y `combo`) pueden tener grupos; un
  `producto` puro no.
- **Un nivel de profundidad:** combo → componente receta → sus grupos, sin ir
  más hondo (coincide con el tope de Toast/Square).

**Reuso de la maquinaria existente — cero tablas nuevas.**
`ItemsService.resolverGruposDeItem(manager, tenantId, itemId, gruposDto)` ya
era agnóstico del item: resuelve los grupos de cualquier item por su propia
`item_grupos_modificadores` y devuelve `{ grupos, precioExtraTotal }`. Se
reutiliza tal cual pasándole el `itemId` de cada componente. El recargo viaja
por el mismo canal (`precioExtraTotal` sumado a la línea) — **el motor de
cálculo de precios no se toca**. El descuento de stock por opción reutiliza
`venderOpcionesGrupos` (siempre bloqueante, igual que los grupos propios del
combo). Solo se agregó: una dimensión en el snapshot, lectura batched en `GET
/items/:id`, un loop de validación/resolución en la venta, el DTO de entrada y
el render del drawer.

**Lectura — `GET /items/:id` (combo).** Cada componente **receta** trae
`grupos` con la misma forma que los grupos propios del combo (ver ejemplo en
"API" más abajo), cargados **batched** (2 queries fijas, sin N+1
proporcional a la cantidad de componentes). `disponibleCondicional` pasa a
`true` si el combo tiene grupos propios **o** algún componente los tiene.

**Venta — snapshot por (componente, unidad).** El body de venta acepta
`personalizacion.componentes: { componenteItemId, unidad, grupos }[]` — una
entrada por cada (componente, unidad) con elección. El backend:
1. Valida que `componenteItemId` sea un componente **vivo** de ESTE combo y
   de tipo `receta` (rechaza con `400` cualquier item ajeno al combo o que no
   admita grupos — el frontend no puede inyectar grupos de items arbitrarios).
2. Valida `unidad ∈ 1..cantidad` del componente, sin `unidad` duplicada.
3. Resuelve cada (componente, unidad) vía `resolverGruposDeItem` — incluso las
   que el frontend omitió, para que un grupo obligatorio sin elección dispare
   la validación de `min` igual que hoy.
4. Suma el `precioExtraTotal` de todas (Decimal.js) al recargo del combo.
5. Congela el snapshot en `personalizacion.componentes[]` (`componenteItemId`,
   `componenteNombre`, `unidad`, `grupos`) — aditivo y opcional: un snapshot
   viejo sin este campo sigue siendo válido (retrocompatibilidad total, cero
   migración).

**Stock por unidad.** Además del descuento normal por componente (producto →
salida; receta → expande a sus ingredientes fijos; servicio → nada), por cada
(componente, unidad) con grupos congelados se llama a `venderOpcionesGrupos`
— descuenta la opción elegida (ej. la proteína), siempre bloqueante, dentro de
la misma transacción de la venta.

**Merge en Salones.** La clave de merge de línea incluye componente/unidad/
opción — dos combos idénticos con proteínas distintas por unidad no se
mergean en una sola línea.

**UX — selector en vez de radio buttons (cambio global).** El drawer de
personalización (`ItemPersonalizacionDrawer.vue` /
`ItemPersonalizacionGrupo.vue`) pasó de radio buttons a `USelectMenu` de Nuxt
UI para elegir la opción de un grupo — simple cuando `max === 1`, múltiple
cuando `max > 1`. Este cambio aplica a **todos** los grupos (propios de combo/
receta, no solo a los anidados de componente): con varios componentes
preguntando su propio grupo por unidad, una lista de radios crecía demasiado
en el drawer.

Ver `docs/adr/015-grupos-anidados-combo-un-nivel.md` para la decisión completa
y las alternativas descartadas.

---

## API

### CRUD de grupos (`/grupos-modificadores`)

```
POST /api/grupos-modificadores
Authorization: Bearer <token>  (requiere TenantAdminGuard)

Request:
{
  "nombre": "Proteína",
  "opciones": [
    { "itemId": "<carne>", "cantidad": "150", "unidadCodigo": "g", "precioExtra": "0" },
    { "itemId": "<pollo>", "cantidad": "150", "unidadCodigo": "g", "precioExtra": "0" },
    { "itemId": "<chuleta>", "cantidad": "150", "unidadCodigo": "g", "precioExtra": "1500" }
  ]
}

Response (201):
{
  "grupoModificadorId": "<uuid>",
  "nombre": "Proteína",
  "familia": "ingrediente",
  "opciones": [ ... ]
}
```

- `GET /grupos-modificadores` — lista grupos vivos del tenant, con familia
  derivada, opciones vivas y `itemsUsandoCount` (cuántos items vivos lo usan).
- `GET /grupos-modificadores/:id` — detalle (mismo shape que un elemento de la
  lista).
- `PATCH /grupos-modificadores/:id` — `nombre` y/o `opciones` (reemplazo total
  **upsert-preservando**: la opción cuyo `itemId` ya existía reutiliza su
  mismo `grupo_opcion_id`, `UPDATE` en vez de soft-delete+insert; solo lo que
  ya no viene se soft-deletea, con cascada de soft-delete a sus overrides en
  `item_grupo_modificador_opciones` — así una edición no huérfana overrides
  existentes de otras recetas. Ver `docs/patterns/backend.md` §14). Reusa la
  misma validación de homogeneidad que `create`.
- `DELETE /grupos-modificadores/:id` — `400` si el grupo está asociado a algún
  item vivo (`item_grupos_modificadores`).
- `GET /grupos-modificadores/:id/items` — drawer de recetas: cada asociación
  (`itemGrupoId`, item que usa el grupo) con sus opciones y `cantidad`
  efectiva/`cantidadDefault`/`esPendiente` por opción — para editar los
  overrides de cantidad/precio de cada receta desde el grupo.
- `PATCH /grupos-modificadores/:id/overrides` (`AplicarOverridesDto`) —
  aplica en **lote** el mismo override (`cantidad`/`unidadCodigo`/
  `precioExtra`) a una `grupoOpcionId` en varias asociaciones (`itemGrupoIds[]`)
  a la vez (ej. "cambiar la porción de chuleta a 200 g en todas las recetas
  que la usan" sin editar receta por receta). Mismo upsert-preservando que
  el resto de los overrides.

### Asociación item↔grupo (extensión de `/items`)

`POST /items` y `PATCH /items/:id` (tipo `combo` o `receta`) aceptan
`gruposModificadores: { grupoModificadorId, min, max, orden?, opciones? }[]`,
donde `opciones?: { grupoOpcionId, cantidad?, unidadCodigo?, precioExtra? }[]`
son los **overrides** de cantidad/recargo de ESTA receta para opciones del
grupo asociado (omitir una opción = sin override, hereda el default del
grupo). Para combos, `componentes` y `gruposModificadores` son independientes:
se requiere al menos uno de los dos (nunca ambos vacíos). `PATCH` reemplaza
`gruposModificadores` completo pero vía **upsert-preservando** (mismo
`item_grupo_id` para el grupo que sigue asociado, mismo `item_grupo_opcion_id`
para el override que sigue viniendo) — ver `docs/patterns/backend.md` §14.

`GET /items/:id` de un combo o receta agrega:

```
"grupos": [
  {
    "grupoModificadorId": "<uuid>",
    "nombre": "Proteína",
    "min": 1,
    "max": 1,
    "orden": 0,
    "opciones": [
      { "grupoOpcionId": "...", "itemId": "...", "itemNombre": "Chuleta de cerdo",
        "tipo": "ingrediente", "cantidad": "250.0000", "cantidadDefault": "150.0000",
        "unidadCodigo": "g", "precioExtra": "1500.0000", "orden": 2,
        "stock": "6.0000", "esPendiente": false }
    ]
  }
],
"disponibleCondicional": true   // solo combos: true si tiene ≥1 grupo asociado
```

`cantidad` es el valor **efectivo** para ESTA receta (`COALESCE(override,
default)`, ver "Cantidades de consumo por item"); `cantidadDefault` es el
default del grupo sin overridear (para que el frontend pueda mostrar "vs.
default" o pre-llenar el formulario de override). `esPendiente: true` cuando
ni el override ni el default tienen `cantidad` — ver esa misma sección.

`GET /items?tipo=combo` incluye `disponibleCondicional` en cada fila (una sola
query extra para todos los combos, no N+1).

**Combo — grupos de sus componentes receta.** `GET /items/:id` de un combo
agrega `grupos` (misma forma de arriba) a cada entrada de `componentes[]`
cuyo componente sea `receta` y tenga ≥1 grupo asociado:

```
"componentes": [
  {
    "componenteItemId": "<hamburguesa especial>",
    "componenteNombre": "Hamburguesa Especial",
    "tipo": "receta",
    "cantidad": "1",
    "bloqueante": true,
    "stock": null,
    "grupos": [
      {
        "grupoModificadorId": "<proteína>",
        "nombre": "Proteína",
        "min": 1,
        "max": 1,
        "orden": 0,
        "opciones": [
          { "grupoOpcionId": "...", "itemId": "<chuleta>", "itemNombre": "Chuleta de cerdo",
            "tipo": "ingrediente", "cantidad": "150.0000", "cantidadDefault": "150.0000",
            "unidadCodigo": "g", "precioExtra": "1500.0000", "orden": 2,
            "stock": "6.0000", "esPendiente": false }
        ]
      }
    ]
  }
]
```

### Personalización al vender (extensión de `/ventas`, cuentas de mesa)

El body de venta/línea de cuenta acepta `personalizacion.grupos: {
grupoId, opciones: { itemId, unidades }[] }[]`. El backend
(`ItemsService.resolverGruposDeItem`) revalida contra el catálogo vivo —
ignora cualquier precio que mande el frontend — y congela el snapshot en
`cuenta_lineas.personalizacion` / `venta_detalles.personalizacion`.

**Combo — grupos por componente/unidad.** Un combo acepta además
`personalizacion.componentes: { componenteItemId, unidad, grupos }[]` — una
entrada por cada (componente receta, unidad) con elección:

```
{
  "lineas": [{
    "itemId": "<combo especial>",
    "cantidad": "1",
    "personalizacion": {
      "componentes": [
        {
          "componenteItemId": "<hamburguesa especial>",
          "unidad": 1,
          "grupos": [
            { "grupoId": "<proteína>", "opciones": [{ "itemId": "<chuleta>", "unidades": 1 }] }
          ]
        }
      ]
    }
  }]
}
```

`400` si `componenteItemId` no es un componente vivo de ESE combo, o si
`unidad` está fuera de `1..cantidad` del componente o duplicada. El recargo se
suma (Decimal.js) al del combo; el descuento de stock por opción es siempre
bloqueante, igual que los grupos propios. Ver "Grupos anidados en combos (un
nivel)" arriba para el detalle completo.

---

## Backend

### Módulo & Servicios

- **Módulo**: `GruposModificadoresModule`
  (`src/modules/grupos-modificadores/grupos-modificadores.module.ts`)
- **Controller**: `grupos-modificadores.controller.ts`
- **Service**: `grupos-modificadores.service.ts`
- **Entidades**: `entities/grupo-modificador.entity.ts`,
  `entities/grupo-modificador-opcion.entity.ts` (ambas en el módulo de
  grupos); `item-grupos-modificadores` vive como
  `src/modules/items/entities/item-grupo-modificador.entity.ts` (asociación,
  no se registra `TypeOrmModule.forFeature` para ella — el acceso es siempre
  vía SQL raw, mismo patrón que `combo_componentes`/`receta_ingredientes`).

### Key methods

- `GruposModificadoresService.validarYResolverOpciones` (privado) —
  homogeneidad de familia + validación por tipo; reusado por `create`/`update`.
- `GruposModificadoresService.familiaDeTipo` (privado) — deriva
  `'ingrediente' | 'vendible'` del `tipo` del item.
- `ItemsService.resolverGruposDeItem` — valida elección contra `min`/`max`,
  congela snapshot, calcula recargo. Reusado por recetas (`resolverIngredientesYExtras`),
  por `resolverPersonalizacionCombo` (grupos propios del combo) y por sí mismo
  otra vez para los grupos de **cada componente receta** (grupos anidados en
  combos, un nivel — pasándole el `itemId` del componente).
- `ItemsService.resolverPersonalizacionCombo` — además de los grupos propios,
  valida (`componenteItemId` vivo de este combo + `unidad` en rango, sin
  duplicar) y resuelve los grupos de cada (componente, unidad) vía
  `resolverGruposDeItem`, sumando el recargo total y congelando
  `snapshot.componentes[]`.
- `ItemsService.venderComponentesCombo` — además del descuento normal por
  componente, itera `snapshot.componentes[]` y llama a
  `venderOpcionesGrupos` por cada (componente, unidad) con grupos congelados.
- `ItemsService.venderOpcionesGrupos` (privado) — efecto de inventario por
  tipo de opción al vender, siempre bloqueante.

---

## Frontend

- `pages/configuracion/grupos-modificadores.vue` — CRUD de grupos (nombre +
  tabla de opciones con selector de item, cantidad **opcional** (default),
  unidad si ingrediente, precio extra); drawer de recetas por grupo (`GET
  /grupos-modificadores/:id/items`) para ver/editar los overrides de cantidad
  por receta y aplicar un override en lote a varias recetas a la vez
  (`PATCH .../overrides`, selección múltiple).
- `pages/configuracion/items.vue` — sección "Grupos de modificadores"
  compartida entre combo y receta (selector de grupo + `min`/`max`/`orden` +
  override de `cantidad`/`precioExtra` por opción, pre-llenado con el default
  del grupo; opciones sin cantidad efectiva se marcan *pendiente* en la UI).
- `components/ventas/ItemPersonalizacionDrawer.vue` — drawer unificado
  (renombrado desde el drawer específico de recetas): renderiza ingredientes
  omitibles + extras (receta) y/o grupos (combo y receta) según lo que el
  item tenga; exige `min ≤ Σunidades ≤ max` por grupo antes de habilitar
  "Agregar"; combos con ≥1 grupo asociado ahora abren el drawer (antes, sin
  grupos, se agregaban con un click). El POS/drawer **oculta** opciones
  *pendientes* (`esPendiente: true`) — no se pueden elegir hasta que la
  receta tenga una cantidad efectiva. Para un combo con componentes receta
  con grupos, repite el bloque de grupos **una vez por unidad** del
  componente, etiquetado ("Hamburguesa #1", "Hamburguesa #2").
- `components/ventas/ItemPersonalizacionGrupo.vue` — render de un grupo
  (propio o de componente); usa `USelectMenu` (selector), **no** radio
  buttons — simple cuando `max === 1`, múltiple cuando `max > 1`. Cambio
  global: aplica a todos los grupos, no solo a los anidados de componente
  (una lista de radios con varios componentes preguntando por unidad crecía
  demasiado en el drawer).
- `composables/useRecetaPersonalizacion.ts` — resolución de grupos en el
  frontend (espejo de `resolverGruposDeItem`, para UX inmediata; el backend
  revalida igual), incluyendo los grupos por componente/unidad de un combo.
- Catálogo POS/Salones: `Disponible*` en vez de un número fijo para combos con
  `disponibleCondicional: true` (la disponibilidad depende de la opción
  elegida).
- Merge de líneas en Salones: la clave de merge incluye los grupos elegidos,
  también los de componente/unidad (dos líneas del mismo combo con distinta
  proteína/bebida — propia o de un componente — no se mergean).

---

## Seed demo

`seedGruposModificadores()` en `backend/src/modules/seeder/seeder.service.ts`,
invocado tras `seedCombos()` (idempotente, guarda por la existencia del grupo
"Proteína"). IDs `550e8400-e29b-41d4-a716-446655440XXX`:

| Entidad | ID | Notas |
|---|---|---|
| Ingrediente "Pechuga de pollo" | `…440286` | Nuevo, 8 kg stock, costo 6000/kg |
| Ingrediente "Chuleta de cerdo" | `…440288` | Nuevo, 6 kg stock, costo 9000/kg |
| Grupo "Proteína" | `…440290` | Familia `ingrediente`, default 150 g/opción |
| Opción carne (reutiliza `…440257`) | `…440291` | Default 150 g, +$0 |
| Opción pollo | `…440292` | Default 150 g, +$0 |
| Opción chuleta | `…440293` | Default 150 g, +$1.500 |
| Item "Hamburguesa Especial" (receta) | `…440294` | Pan + queso fijos, SIN proteína fija; `min:1, max:1` con "Proteína", **sin override** (usa 150 g default) |
| Item "Coca-Cola" (producto) | `…440298` | Nuevo, 100 unidad stock, costo 500 |
| Item "Bebida premium" (producto) | `…440300` | Nuevo, 40 unidad stock, costo 1200 |
| Grupo "Bebida" | `…440302` | Familia `vendible` |
| Opción Coca-Cola | `…440303` | +$0 |
| Opción Bebida premium | `…440304` | +$800 |
| Asociación "Bebida" ↔ Combo Clásico (`…440283`) | `…440305` | `min:1, max:1` |
| Item "Hamburguesa Especial XL" (receta) | `…440306` | Mismos ingredientes fijos que "Hamburguesa Especial"; `min:1, max:1` con el **mismo** grupo "Proteína" (`…440290`) |
| Asociación "Proteína" ↔ Hamburguesa Especial XL | `…440309` | `item_grupos_modificadores` |
| Override cantidad carne/pollo/chuleta → 250 g | `…440310`–`…440312` | `item_grupo_modificador_opciones`, llavado por (`…440309`, cada `grupo_opcion_id` `…440291`–`…440293`); `precioExtra` sin overridear (hereda el default) |

Demo viva del modelo híbrido: **mismo grupo, dos cantidades de consumo** —
"Hamburguesa Especial" resuelve 150 g (default puro, sin fila de override);
"Hamburguesa Especial XL" resuelve 250 g (override explícito), sin que el
grupo ni la primera receta cambien.

Verificado tras `docker-compose up` / restart del backend: log `Seed
complete.` sin errores; `GET /grupos-modificadores` devuelve ambos grupos;
`GET /items?tipo=combo` muestra "Combo Clásico" con `disponibleCondicional:
true`; `GET /items/<…440294>` muestra las 3 opciones de "Proteína" con
`cantidad: "150.0000"`; `GET /items/<…440306>` muestra las mismas 3 opciones
con `cantidad: "250.0000"` y `cantidadDefault: "150.0000"` (verificado en vivo
el 2026-07-21 contra el stack Docker corriendo).

**Grupos anidados en combos — "Combo Especial" (2026-07-22).**
`seedComboEspecial()`, invocado tras `seedGruposModificadores()` (idempotente,
guarda por la existencia del propio combo). Cero cambio al "Combo Clásico"
existente — combo nuevo, aparte, para no acoplar el caso de "componente con
grupo" a un combo que ya tenía su propio grupo "Bebida":

| Entidad | ID | Notas |
|---|---|---|
| Item "Combo Especial" (combo) | `…440313` | Precio propio $4.300; componentes: Hamburguesa Especial (receta, `…440294`) + Papas fritas (producto, `…440281`, reutilizada del Combo Clásico) |
| Componente Hamburguesa Especial | `…440314` | `combo_componentes`, cantidad 1, bloqueante |
| Componente Papas fritas | `…440315` | `combo_componentes`, cantidad 1, bloqueante |

Como "Hamburguesa Especial" (`…440294`) ya trae asociado el grupo "Proteína"
(`…440290`, `min:1, max:1`), el "Combo Especial" expone esa elección
**automáticamente** al vender — sin asociar nada al combo mismo. Verificado
vía `combos.e2e-spec.ts`: `GET /items/<…440313>` trae `componentes[].grupos`
para la Hamburguesa Especial con la opción chuleta a `precioExtra:
"1500.0000"`; vender eligiendo chuleta cobra `precioBase (4300) + 1500 =
5800.0000` y descuenta `0.15` kg (150 g convertidos a la unidad base del
ingrediente) de chuleta.

---

## Testing

```bash
cd backend && npm test -- grupos-modificadores.service.spec.ts items.service.spec.ts ventas.service.spec.ts
cd backend && npm run test:e2e -- grupos-modificadores.e2e-spec.ts grupos-modificadores-overrides.e2e-spec.ts combos.e2e-spec.ts
```

`combos.e2e-spec.ts` cubre los grupos anidados: `GET /items/:id` del "Combo
Especial" expone el grupo de su componente receta; vender eligiendo la opción
premium suma el recargo al total y descuenta la opción por unidad; un
`componenteItemId` que no pertenece al combo → `400`.

---

## Acceptance Criteria

- [x] CRUD de grupos + opciones, homogeneidad verificada
- [x] Asociación item↔grupo (`min`/`max`/`orden`); combo relaja "≥1
      componente" a "≥1 componente o grupo"
- [x] `GET /items/:id` con `grupos[]`; `disponibleCondicional` en combo
- [x] Bloqueo de borrado (opción de grupo vivo / grupo asociado a items vivos)
- [x] Snapshot congelado en personalización; revalidación server-side
- [x] Descuento de inventario por opción elegida (siempre bloqueante)
- [x] CRUD de grupos en Configuración + sección compartida en Items
- [x] Drawer de personalización unificado con grupos
- [x] Cantidad/precioExtra overrideables por receta (híbrido, `COALESCE`),
      estado *pendiente*, upsert-preservando en ambos flujos de reemplazo
      total, endpoints de drawer + aplicar override en lote
- [x] Seed demo (Proteína con override 150 g/250 g + Bebida) + Docs (este
      archivo) + ESTADO + PRODUCTO + patterns/backend + ADR-014
- [x] Grupos anidados en combos, un nivel: automático + por unidad + solo
      recetas; `GET /items/:id` batched; snapshot `personalizacion.componentes`;
      descuento de stock por componente/unidad; selector en vez de radio
      (cambio global); seed "Combo Especial" + E2E + Docs + ADR-015

---

## Related Features

- [combos.md](./combos.md) — combos de componentes fijos; los grupos son la
  pieza de "combo con elección" que ese ticket dejó fuera de alcance
- [recetas.md](./recetas.md) — recetas base; los grupos son una segunda forma
  de personalización además de omitir ingredientes/extras
- [personalizacion-recetas.md](./personalizacion-recetas.md) — drawer de
  personalización, ahora compartido con grupos
- [inventario-kardex.md](./inventario-kardex.md) — movimientos de salida por
  opción elegida
- [impresion-termica.md](./impresion-termica.md) — pendiente: imprimir la
  opción elegida de un grupo en comanda/boleta (diferido, ver Scope)
- ADR: [013](../adr/013-grupos-modificadores-reutilizables.md) — grupos
  reutilizables sin tipo declarado, `min`/`max` en unidades, opción siempre
  bloqueante (su punto (c), "sin override por item", queda parcialmente
  revisado por ADR-014)
- ADR: [014](../adr/014-cantidades-consumo-por-item.md) — modelo híbrido
  default+override para cantidad/precioExtra por receta, llave del override
  por UUIDs preservados, cero migración de datos
- ADR: [015](../adr/015-grupos-anidados-combo-un-nivel.md) — grupos anidados
  en combos: automático + por unidad + un nivel + cero tablas nuevas, reuso de
  `resolverGruposDeItem`/`venderOpcionesGrupos`

## Notes

**Impresión térmica (diferida, no un olvido):** confirmado con el usuario el
2026-07-20 que la impresión de la opción elegida de un grupo en
comanda/precuenta/boleta queda para un ticket aparte. El snapshot
`personalizacion.grupos` ya persiste `grupoNombre` + `itemNombre` + `unidades`
de cada opción elegida — implementar la impresión después es un cambio de
plantilla, no requiere migración ni cambio de modelo de datos.

**Grupos anidados en combos, un nivel (2026-07-22):** confirmado con el owner
que la exposición del grupo de un componente receta es **automática** (sin
curaduría por combo) y limitada a **un nivel** (combo → componente receta →
sus grupos) — anidar más hondo, o habilitar grupos en `producto` puro, queda
fuera de alcance hasta que aparezca un caso real. Ver
`docs/superpowers/specs/2026-07-22-grupos-modificadores-anidados-combo-design.md`
para la investigación de mercado (Square/Toast) que respaldó estas decisiones.
