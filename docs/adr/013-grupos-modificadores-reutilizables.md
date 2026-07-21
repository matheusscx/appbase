# ADR-013: Grupos de modificadores reutilizables — sin tipo declarado, precio en el grupo, min/max en unidades, opción siempre bloqueante

**Status**: Accepted

**Date**: 2026-07-20

## Context

Combos (ADR-012) cubrió exclusivamente **componentes fijos** — sin elección
del customer. El caso pendiente ("elige tu bebida entre Coca-Cola / Sprite /
agua", "elige tu proteína") necesitaba un modelo de datos nuevo. Además,
recetas ya tenía `receta_extras_permitidos` para extras opcionales sin límite
de elección (ver `docs/features/personalizacion-recetas.md`), que no modela
"elección obligatoria/acotada entre alternativas homogéneas" — un caso
distinto, no una extensión natural del modelo de extras.

Food-service suele repetir la misma elección en varios combos (5 combos
distintos ofreciendo la misma lista de bebidas). Cuatro decisiones de diseño
quedaban abiertas:

1. ¿Un grupo de modificadores es propio de un item (combo/receta), o
   reutilizable a nivel tenant?
2. ¿Cómo se determina de qué "tipo" es un grupo (ingrediente vs. producto
   vendible) — un campo declarado, o algo derivado?
3. ¿El recargo de una opción vive en el grupo (compartido) o se puede
   sobrescribir por item que lo usa?
4. ¿`min`/`max` limitan cantidad de **opciones distintas** elegidas, o
   **unidades totales**? ¿Una opción de grupo sin stock bloquea la venta o
   solo advierte, como los ingredientes no bloqueantes de receta?

## Decision

### (a) Grupos reutilizables a nivel tenant, no por item

`grupos_modificadores` vive a nivel tenant, independiente de cualquier combo o
receta. La asociación a un item concreto es una tabla aparte
(`item_grupos_modificadores`, con `min`/`max`/`orden` propios de esa
asociación) — el mismo grupo "Bebida" puede asociarse a N combos distintos sin
duplicar su catálogo de opciones. Editar las opciones del grupo (agregar una
bebida nueva, cambiar un precio) propaga a todos los items que lo usan sin
tocarlos uno por uno.

**Alternativa descartada:** un grupo embebido en el item (ej. un array
`gruposModificadores` con sus propias opciones dentro de cada combo). Se
descarta porque duplicaría el catálogo de opciones en cada combo que ofrezca
la misma elección, y cualquier cambio (agregar una bebida nueva) requeriría
editar cada combo por separado.

### (b) Familia de efecto derivada, no declarada

`grupos_modificadores` no tiene columna `tipo` ni `familia`. La familia de
efecto (`'ingrediente'` — descuenta con conversión de unidad, requiere
`modo_inventario='cantidad'` — o `'vendible'` — `producto | receta |
servicio`, descuenta como cualquier venta de ese tipo) se **deriva** del
`tipo` de la primera opción viva y se **verifica homogénea** al guardar: si se
intenta mezclar una opción `ingrediente` con una `producto` en el mismo grupo,
`400`.

**Alternativa descartada:** un campo `tipo` explícito en `grupos_modificadores`
que el usuario elige al crear el grupo, con validación de que las opciones
coincidan con ese tipo declarado. Se descarta por redundancia: el tipo ya está
determinado por qué opciones tiene el grupo — pedirle al usuario que lo
declare aparte introduce un estado que puede desincronizarse (¿qué pasa si el
usuario declara "ingrediente" pero agrega una opción producto?) sin ganar
nada que la derivación no dé gratis.

### (c) Precio en la opción del grupo, sin override por item

`precio_extra` vive en `grupo_modificador_opciones` — es el mismo recargo para
todos los items que usan ese grupo. No existe una tabla de "override de precio
por asociación item↔grupo".

**Alternativa descartada:** permitir que cada asociación item↔grupo
sobrescriba el `precioExtra` de una opción (ej. "Bebida premium" cuesta +$800
en el Combo Clásico pero +$1.000 en el Combo Familiar). Se descarta por ahora:
añade una tabla de overrides y una regla de precedencia (override > default)
que ningún caso real del cluster food-service necesita hoy. **Trade-off
asumido:** si dos combos necesitan precios distintos para la "misma"
elección, hoy se modelan como **dos grupos** (ej. "Bebida" y "Bebida
Familiar") — cuesta duplicar el grupo, no el catálogo de opciones (los items
subyacentes — Coca-Cola, Bebida premium — se reutilizan igual). Override
aditivo queda como fase futura si aparece un caso real.

### (d) `min`/`max` en unidades totales; opción siempre bloqueante

`item_grupos_modificadores.min`/`max` limitan la **suma de unidades**
elegidas en el grupo, no la cantidad de opciones distintas tocadas — un grupo
`min:1, max:2` permite 2 unidades de la misma opción o 1+1 de dos distintas.
El backend (`ItemsService.resolverGruposDeItem`) revalida esto contra el
catálogo vivo al vender, sin confiar en lo que mande el frontend.

Al vender, una opción de grupo elegida por el customer es **siempre
bloqueante** (`ItemsService.venderOpcionesGrupos`): si no hay stock, la venta
aborta. Esto es una regla fija, no configurable por opción — a diferencia de
un ingrediente fijo de receta (que puede marcarse no bloqueante, para
ingredientes menores como el toque de queso), una opción de grupo es algo que
el customer **explícitamente pidió**; venderla "igual, sin eso" sería
entregar algo distinto de lo pedido sin avisar.

**Alternativa descartada:** exponer un flag `bloqueante` por opción de grupo,
igual que en `receta_ingredientes`. Se descarta: el caso de uso de un
ingrediente "menor, se puede omitir sin avisar" no aplica a algo que el
customer eligió activamente entre alternativas — ahí "no bloqueante" sería
sorpresa, no conveniencia.

## Consequences

### Positive

- Un grupo se edita una sola vez y propaga a todos los combos/recetas que lo
  usan — sin el "editar N combos para agregar una bebida nueva" que tendría
  un modelo embebido.
- Sin estado redundante: sin un campo `tipo`/`familia` que declarar y mantener
  sincronizado con las opciones reales.
- El combo puede existir compuesto solo por grupos (sin componentes fijos) —
  relaja la regla de ADR-012 ("≥1 componente") a "≥1 componente o grupo" sin
  reescribir esa validación, solo ampliarla.
- El snapshot congelado (`personalizacion.grupos`) ya guarda todo lo necesario
  para futuros consumidores (impresión térmica de la opción elegida) sin
  requerir migración cuando se implementen — solo trabajo de plantilla.

### Negative

- Sin override de precio por item: un caso real de "misma elección, precio
  distinto según el combo" obliga a duplicar el grupo (más filas en
  `grupos_modificadores`, aunque los items de opción se reutilizan). Aceptado
  como trade-off; revisar si aparece con frecuencia en clientes reales.
- `item_combo.costo_actual = '0'` cuando un combo no tiene componentes fijos
  (solo grupos) es una foto temporalmente inexacta hasta la primera venta —
  mismo tipo de limitación que el costo cacheado de combos/recetas ya
  documentado en ADR-012 (no se recalcula solo si cambia el costo de una
  opción).
- Sin impresión térmica de la opción elegida (diferido a otro ticket,
  confirmado por el usuario) — hoy la comanda imprime el nombre del item, no
  el desglose de qué se eligió dentro de cada grupo.

### Neutral

- Grupos anidados (una opción de grupo con grupos propios) y evaluación de
  condiciones para habilitar/deshabilitar opciones quedan fuera de este ADR —
  ningún caso del cluster food-service actual los requiere.
