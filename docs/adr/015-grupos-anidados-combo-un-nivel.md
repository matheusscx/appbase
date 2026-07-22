# ADR-015: Grupos anidados en combos — automático, por unidad, un nivel, cero tablas nuevas

**Status**: Accepted

**Date**: 2026-07-22

## Context

Un combo con un componente **receta** que a su vez tiene su propio grupo de
modificadores no exponía ese grupo al vender el combo. Ejemplo real que lo
disparó: "Combo Clásico" = Hamburguesa Clásica (receta) + Bebida (grupo del
combo, ADR-013). La "Hamburguesa Clásica" tiene su propio grupo "Proteína",
pero agregar el combo al carrito solo ofrecía elegir la Bebida (grupo del
combo) — nunca la Proteína (grupo del componente).

Causa raíz: `GET /items/:id` (combo) armaba `grupos[]` solo con los grupos
asociados **directamente** al combo (`item_grupos_modificadores WHERE item_id
= <combo>`). Los `componentes[]` se cargaban aparte y nunca traían sus propios
grupos. El camino de venta (`resolverPersonalizacionCombo`) hacía lo mismo —
sin recursión, el combo nunca miraba dentro de sus componentes. No era un
bug: los "grupos anidados" estaban explícitamente fuera de alcance en ADR-013
y en el diseño original de `docs/features/combos.md`.

Cuatro decisiones de diseño quedaban abiertas:

1. ¿La elección del grupo de un componente se habilita por configuración del
   combo (curaduría), o automáticamente en cuanto el componente la tiene?
2. Un componente con `cantidad > 1` (ej. 2 hamburguesas): ¿una sola elección
   para todo el componente, o una por unidad?
3. ¿Solo componentes receta, o también `producto` puro (hoy sin grupos)?
4. ¿Cuántos niveles de anidamiento soportar (combo → componente → grupo →
   ¿grupo de una opción?)?

## Decision

### (a) Automático (estilo Square), sin curaduría por combo

Cualquier componente receta que tenga grupos asociados los expone
**automáticamente** al vender el combo — sin configuración extra en el combo
mismo. `GET /items/:id` (combo) adjunta `grupos` a cada entrada de
`componentes[]` cuyo componente sea `receta` con ≥1 grupo asociado; la venta
(`resolverPersonalizacionCombo`) resuelve esos mismos grupos por componente.

**Alternativa descartada:** una tabla de curaduría con `min`/`max` propios del
combo sobre el grupo del componente (ej. el combo podría restringir a solo 2
de las 3 opciones de "Proteína"). Se descarta: contradice la decisión
"automático" (YAGNI — ningún caso real del cluster food-service lo pide hoy) y
requeriría una tabla nueva más una regla de precedencia combo-vs-receta.

### (b) Por unidad, elecciones independientes

Un componente con `cantidad = N` pregunta N veces; las elecciones son
independientes entre sí (2 hamburguesas → una proteína por cada una, pueden
ser distintas). El snapshot (`personalizacion.componentes[]`) y el descuento
de stock (`venderOpcionesGrupos`) trackean cada `(componenteItemId, unidad)`
por separado — una entrada de snapshot por (componente, unidad) con
elección, `unidad ∈ 1..cantidad`.

**Alternativa descartada:** una sola elección para todo el componente (ej. "2
hamburguesas, ambas con chuleta" en una sola pregunta). Se descarta: no cubre
el caso real de food-service donde cada unidad puede llevar una proteína
distinta (Square lo modela así — el combo es una línea, pero el modificador
se aplica por unidad de línea del ítem incluido).

### (c) Solo componentes receta (y combo); no `producto` puro

Hoy solo `receta` (y `combo`) pueden tener grupos asociados — un `producto`
puro no. "Topping del helado" funciona si el helado es receta. Habilitar
grupos en productos queda fuera de alcance de este ADR.

**Alternativa descartada:** extender `item_grupos_modificadores` para admitir
también `producto` como item asociable. Se descarta: ningún caso real lo pide
hoy y ampliaría el alcance de este ticket sin necesidad — se evalúa como fase
futura si aparece.

### (d) Un nivel de profundidad

Combo → componente receta → sus grupos. No se soporta un nivel adicional (una
opción de grupo que a su vez tenga sus propios grupos). Coincide con el tope
de Toast/Square (ver Investigación).

**Alternativa descartada:** recursión N niveles. Se descarta: ningún caso real
lo necesita, y la complejidad de UX (Toast advierte explícitamente que
"elegir varios del modificador de arriba" con anidamiento no está soportado)
y de modelo (snapshot recursivo, validación de ciclos) no se justifica sin
un caso real.

## Investigación de mercado (insumo, no verdad — cruzado contra el código)

- **Square:** si los ítems dentro de un combo tienen modificadores, esos
  modificadores se siguen mostrando y aplicando; el combo es una línea,
  upcharge por opción — exactamente el comportamiento pedido.
- **Toast:** modela "modificar un modificador" hasta un nivel; advierte que
  elegir varios del modificador de arriba con selecciones anidadas no está
  soportado (complejidad).
- **Convergencias adoptadas:** (1) una sola línea de venta con las elecciones
  congeladas como snapshot; (2) precio = base + upcharge por opción; (3)
  profundidad un-nivel.
- **Lo que NO se copió:** Square no cuesta modificadores para inventario;
  este proyecto sí descuenta stock por opción (`venderOpcionesGrupos`,
  siempre bloqueante, ADR-013(d)) y lo mantiene sin cambios.

## Reuso de la maquinaria existente — cero tablas nuevas

`ItemsService.resolverGruposDeItem(manager, tenantId, itemId, gruposDto)` ya
era agnóstico del item que le pasan: resuelve los grupos de cualquier item
por su propia `item_grupos_modificadores` y devuelve `{ grupos,
precioExtraTotal }`. Se reutiliza tal cual pasándole el `itemId` de cada
componente. El recargo viaja por el mismo `precioExtraTotal` que el motor de
ventas ya suma a la línea — **el motor de cálculo de precios
(`calculo-precios.engine.ts`) no se toca**. El descuento de stock por opción
reutiliza `venderOpcionesGrupos` (ya existente, siempre bloqueante).

Cero tablas nuevas: los grupos de un componente ya existen como la
asociación propia de esa receta (`item_grupos_modificadores`,
`grupo_modificador_opciones`). Solo se agregó: una dimensión opcional y
aditiva en el snapshot (`personalizacion.componentes[]`), lectura batched en
`GET /items/:id`, un loop de validación/resolución en la venta, el DTO de
entrada (`PersonalizacionComponenteInputDto`) y el render del drawer.

**Alternativas descartadas:**
- **Aplanar** los grupos del componente como "grupos virtuales del combo" con
  claves sintéticas. Se descarta: pierde atribución (¿de qué componente venía
  la elección?), ensucia el merge de líneas en Salones y la futura impresión
  por comanda.
- **Tabla de curaduría** con min/max propios del combo — ver (a) arriba.

## Cambio de UX asociado: selector en vez de radio buttons (global)

El drawer de personalización (`ItemPersonalizacionGrupo.vue`) pasó de radio
buttons a `USelectMenu` de Nuxt UI para elegir la opción de un grupo — simple
cuando `max === 1`, múltiple cuando `max > 1`. Este cambio aplica a **todos**
los grupos existentes (propios de combo/receta), no solo a los anidados de
componente: con varios componentes preguntando su propio grupo por unidad
("Hamburguesa #1", "Hamburguesa #2", ...), una lista de radios por cada
bloque crecía demasiado en el drawer. Se documenta en
`frontend/docs/DESIGN-SYSTEM.md` como el patrón de elección a seguir en
adelante para grupos de opciones homogéneas.

## Consequences

### Positive

- Sin migración: cero tablas nuevas, cero columna nueva en tablas existentes
  — solo forma aditiva y opcional del JSON de `personalizacion`. Snapshots
  viejos (sin `componentes[]`) siguen siendo válidos.
- El caso "combo con componente que tiene grupo" (el que disparó este ADR) se
  resuelve reutilizando exactamente la misma máquina de validación/descuento
  que ya existía para los grupos propios del combo — sin duplicar lógica.
- El snapshot congelado (`personalizacion.componentes[].grupos`) ya guarda
  todo lo necesario para futuros consumidores (impresión térmica de la
  opción elegida por componente) sin requerir migración cuando se
  implemente — solo trabajo de plantilla, mismo trade-off que ADR-013.

### Negative

- Sin curaduría por combo: si dos combos distintos quieren restringir de
  forma diferente las opciones del mismo grupo de un componente compartido,
  hoy no se puede — habría que duplicar la receta componente con un grupo
  distinto (mismo trade-off aceptado en ADR-013(c) para precios por combo).
- El drawer repite el bloque de grupos una vez por unidad del componente —
  con componentes de cantidad alta (ej. 6 hamburguesas) el drawer puede
  volverse largo; no se implementó una vista compacta/agrupada para ese caso
  (ningún caso real del cluster food-service lo pide hoy).
- Cuidado de datos (no introducido por este ADR, ya existía en recetas
  standalone): si una receta lleva la proteína como ingrediente fijo **y**
  como grupo, se descontaría dos veces. Es responsabilidad de modelado del
  tenant, no una validación que este diseño agregue.

### Neutral

- Anidamiento de más de un nivel y grupos en `producto` puro quedan fuera de
  este ADR — se evalúan como fase futura si aparece un caso real (ver
  Fuera de alcance en `docs/features/grupos-modificadores.md`).
