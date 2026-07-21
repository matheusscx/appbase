# ADR-014: Cantidades de consumo por item — modelo híbrido default+override sobre grupos de modificadores

**Status**: Accepted

**Date**: 2026-07-21

## Context

ADR-013 modeló los grupos de modificadores como catálogo reutilizable a nivel
tenant, con `cantidad`/`unidadCodigo`/`precioExtra` viviendo **en la opción
del grupo** — el mismo valor para todos los items (combos/recetas) que
asocian ese grupo. Su punto (c) descartó explícitamente un override por item,
asumiendo como trade-off que "si dos combos necesitan precios distintos para
la misma elección, se modelan como dos grupos".

Ese trade-off no sobrevivió el primer caso real de food-service con
**cantidad** (no solo precio): una hamburguesa "Clásica" y una "XL" quieren
ofrecer la misma elección de proteína (carne/pollo/chuleta, mismas opciones,
mismo recargo de chuleta) pero con **porciones distintas** (150 g vs. 250 g).
Duplicar el grupo entero (`Proteína` y `Proteína XL`) para variar solo la
cantidad habría duplicado también el catálogo de opciones y roto la premisa
central de ADR-013(a) — un grupo se edita una vez y propaga a todos los items
que lo usan.

Tres decisiones de diseño quedaban abiertas:

1. ¿La cantidad/recargo por receta se modela con override (grupo sigue
   siendo la fuente del default) o se mueve **enteramente** a la receta
   (el grupo deja de tener cantidad/precio propios)?
2. ¿Qué pasa con una opción que ninguna receta ha overrideado y que el grupo
   tampoco define por default?
3. ¿Cómo se referencia el override — por una llave de negocio estable, o por
   los UUIDs ya existentes de la asociación y la opción?

## Decision

### (a) Híbrido: el grupo mantiene un default opcional; la receta overridea

`grupo_modificador_opciones.cantidad` pasa a ser **nullable** (antes
`NOT NULL`) y sigue funcionando como **default**. Una tabla nueva,
`item_grupo_modificador_opciones`, guarda el **override** por asociación
item↔grupo: una fila por (`item_grupo_id`, `grupo_opcion_id`) cuando esa
receta necesita un valor distinto del default. La cantidad/recargo
**efectivo** para una receta es `COALESCE(override.cantidad,
default.cantidad)` (ídem `unidadCodigo`/`precioExtra`) — resuelto en toda
lectura (`GET /items/:id`) y al vender (`resolverGruposDeItem`), nunca
persistiendo el default crudo en el snapshot de venta.

`precioExtra` sigue la misma mecánica de default+override que `cantidad` (no
solo esta última) — su default en el grupo sigue siendo `NOT NULL DEFAULT 0`,
así que el valor efectivo nunca es `NULL` aunque nadie lo overridee.

**Alternativa descartada: modelo puro (cantidad/precio solo en la receta,
nada en el grupo).** Habría exigido que **toda** receta que asocia un grupo
declare cantidad/precio para **todas** sus opciones antes de poder vender —
sin default, no hay pre-llenado posible, y cada opción nueva agregada al
grupo quedaría inutilizable en todas las recetas existentes hasta que cada
una la overridee explícitamente. También habría requerido backfill de
`item_grupo_modificador_opciones` para todo item↔grupo existente el día del
deploy (dato que hoy no existe en ninguna tabla). Se descarta: el costo de
migración y de fricción de UI no compensa frente al híbrido, que da lo mismo
resultado final (override cuando se necesita) sin ninguna de las dos
penalidades.

### (b) Sin cantidad efectiva (ni override ni default) → opción *pendiente*, no error

Si `COALESCE(override.cantidad, default.cantidad)` resuelve a `NULL`, la
opción queda **pendiente** para esa receta: se marca `esPendiente: true` en
la respuesta, el POS/drawer de personalización **no la ofrece** para elegir,
y `ItemsService.resolverGruposDeItem` la **rechaza** (`400`) si de todos
modos llega elegida desde el frontend (el backend no confía en lo que mande
el cliente).

Explícitamente, **no** se bloquea:
- Guardar el grupo con una opción sin `cantidad` default — es válido, solo
  pendiente hasta que alguna receta la overridee o el grupo defina un
  default más adelante.
- Asociar el grupo a una receta sin overridear nada — la receta puede
  asociarse hoy (heredando lo que el grupo tenga, pendiente o no) y
  overridear después, vía el drawer de recetas del grupo.

**Alternativa descartada:** exigir `cantidad` no nula en toda opción del
grupo (mantener el `NOT NULL` original) y forzar que cualquier receta nueva
declare overrides completos al asociar el grupo. Se descarta por la misma
razón que en (a): reintroduce la fricción de "N formularios vacíos" que el
híbrido evita, y no hay urgencia de negocio real que lo justifique — una
opción pendiente simplemente no se ofrece hasta que alguien la resuelva.

### (c) Llave del override: UUIDs preservados de la asociación y la opción, no llave de negocio

El override se referencia por (`item_grupo_id`, `grupo_opcion_id`) — los
UUIDs ya existentes de la asociación item↔grupo y de la opción del grupo —
en vez de una llave de negocio estable (ej. nombre de la opción o del
item). Esto es más simple (no requiere inventar ni mantener una llave nueva)
pero exige que ambos UUIDs se **preserven** entre ediciones: si guardar de
nuevo las opciones de un grupo, o los grupos asociados a un item, regenerara
esos UUIDs (soft-delete-todo + insert-todo, el patrón "reemplazo total" ya
usado en el resto del código), cada edición huerfanaría silenciosamente
cualquier override existente — seguiría apuntando a un `grupo_opcion_id` o
`item_grupo_id` ya soft-deleted, y el override dejaría de aplicar sin que
nadie lo notara ni lo borrara explícitamente.

Se reescriben ambos flujos de reemplazo total a **upsert-preservando** (ver
`docs/patterns/backend.md` §14): la opción/asociación cuya llave de negocio
(`itemId` de la opción; `grupoModificadorId` de la asociación) ya existía
reutiliza su mismo UUID (`UPDATE`), solo lo que ya no viene se soft-deletea,
y ese soft-delete cae en cascada sobre los overrides que colgaban de la fila
eliminada.

**Alternativa descartada:** una llave de negocio propia para el override
(ej. `(item_id_de_la_receta, item_id_de_la_opcion)`), que sobreviviría un
reemplazo total sin necesidad de tocar esos dos flujos. Se descarta porque
esos flujos ya necesitaban revisarse por otras razones de integridad de
datos del cluster (evitar huérfanos en general, no solo para este ADR), y
reusar los UUIDs existentes evita una tabla de mapeo adicional y una segunda
noción de "identidad" para la misma fila.

### (d) Cero migración de datos

Ningún backfill: `grupo_modificador_opciones.cantidad` pasa a nullable pero
todas las filas existentes ya tienen un valor (el que tenían antes de este
cambio, ahora interpretado como default); `item_grupo_modificador_opciones`
nace vacía — sin overrides, toda receta existente resuelve exactamente al
mismo valor que tenía antes (`COALESCE(NULL, default) = default`). Ninguna
venta pasada cambia de comportamiento: el snapshot de `personalizacion` ya
congelaba la cantidad al momento de vender, independiente de si esa cantidad
viene hoy de un default o de un override.

## Consequences

### Positive

- Un mismo grupo cubre recetas con distinta porción/precio sin duplicar el
  catálogo de opciones — el caso real que motivó este ADR (150 g vs. 250 g de
  proteína) se resuelve con 3 filas de override, no con un segundo grupo.
- Cero migración: el deploy no requiere backfill ni cambia el comportamiento
  de datos existentes.
- Opciones nuevas agregadas a un grupo son vendibles desde el día 1 en toda
  receta que ya lo asocia, mientras el grupo tenga default — no hace falta
  que cada receta las overridee antes de poder venderlas.
- El drawer de recetas se pre-llena con el default en vez de exigir
  formularios vacíos por receta.

### Negative

- Dos flujos de reemplazo total (opciones de un grupo; grupos asociados a un
  item) se vuelven más complejos (upsert-preservando + cascada en vez de
  soft-delete-todo+insert) — más superficie de tests de preservación y de
  cascada de soft-delete sobre código que ya estaba en producción de dev.
- Una opción puede quedar *pendiente* (sin cantidad efectiva) de forma
  silenciosa si un grupo se crea sin default y nadie la overridea todavía —
  mitigado por el flag `esPendiente` visible en la UI, pero requiere que el
  usuario lo note.
- La resolución efectiva ahora es siempre un `COALESCE` de dos tablas en vez
  de una lectura directa — una query más por opción resuelta (mitigado: es
  un solo `LEFT JOIN`, no N+1).

### Neutral

- `precioExtra` gana la misma mecánica de override que `cantidad`, aunque el
  caso real que motivó este ADR era de cantidad — se decidió tratarlas
  simétricamente en vez de overridear solo `cantidad` para no introducir dos
  reglas de resolución distintas en la misma tabla.
- Supersede parcialmente ADR-013(c) ("precio en el grupo, sin override por
  item"): el override ahora existe, pero el grupo sigue siendo la fuente del
  default — ADR-013(a) (grupos reutilizables a nivel tenant) y (b) (familia
  derivada) no cambian.
