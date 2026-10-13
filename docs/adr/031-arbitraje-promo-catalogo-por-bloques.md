# ADR-031: Con "no se suman", la promo y el catálogo se comparan por bloques de líneas compartidas

**Status**: Accepted

**Date**: 2026-10-13

## Context

Con el interruptor `promosAcumulanDescuentos` apagado (el default), en cada línea aplica solo
la rebaja mayor entre la promo y el descuento de catálogo
([ADR-023](023-promociones-familia-propia-del-motor.md) ubica ese arbitraje en el motor). Desde
el 2026-08-27 la unidad de comparación era **la aplicación**: cada tanda de un NxM y cada combo
se comparaban solos contra el catálogo de las líneas que tocaban, con un catálogo calculado una
vez (baseline fijo).

El catálogo, en cambio, se anula **por línea**. Cuando dos tandas caían en la misma línea, la
segunda competía contra un catálogo que la primera ya había anulado. Lo vio la revisión del
NxM (`30622fcf`). Ejemplo: martes de 3x1, 5 cervezas de $1.000 al 30 % y un agua de $100. La
primera tanda le gana al 30 % y lo anula. La segunda regala $1.100 contra los $1.500 de un 30 %
que ya no corre, pierde y se descarta. La venta cobraba $3.100, cuando las dos tandas aplicadas
dan $2.000. El 2x1 cobraba $3.500 en lugar de $3.000.

## Decision

**La unidad de comparación es el bloque: las aplicaciones que comparten alguna línea, de la
misma promo o de otra, transitivamente.** Cada bloque suma lo que regala, en neto y cuantizado,
y lo compara contra los descuentos de catálogo de sus líneas, tomados de la pasada normal. Si
gana, aplican todas sus aplicaciones y el catálogo se anula en esas líneas. Si no gana, sale
entero y sin traza. El empate es del catálogo. "Las líneas que toca" son las que reciben plata
de la promo: la unidad que paga en un grupo no cuenta.

Procedencia: owner, 2026-10-13, por AskUserQuestion de la orquestadora, segunda pregunta del
día: *"Juntas solo si comparten producto"*.

Implementación: `resolverPromociones` en `calculo-precios.engine.ts`. Los bloques salen por
unión-búsqueda sobre los índices de las aplicaciones: la primera que toca una línea queda como
su dueña, y cada una que llega después se une a ella. Es una pasada por los montos, en memoria y
sin consultas.

## Alternatives Considered

### La aplicación sola (la regla del 2026-08-27)

Es el bug descrito en Context.

### "La promo entera contra el catálogo de lo que toca"

Sumar todas las tandas de una misma promo. El owner la eligió primero, el mismo 2026-10-13. Se
le había mostrado solo el carrito de las cervezas, donde da lo mismo que la regla de bloques
($2.000 y $3.000). Al diseñarla, la sesión midió dos carritos donde cobra **más que la regla
anterior**. Los dos llevan un 2x1 sobre 2 vinos de $5.000 y 2 cervezas de $1.000 sin descuento:

- Con el vino al 65 %, la promo regala $6.000 contra $6.500, pierde entera y cobra $5.500. Antes
  cobraba $4.500: la tanda de las cervezas ganaba sola.
- Con el vino al 55 %, la promo gana en total y le saca al vino $500 de catálogo que daba más que
  su tanda. Cobra $6.000, antes $5.500.

Tampoco cubría dos promos distintas sobre la misma línea: un 3x1 y un 2x1 sobre las mismas 5
cervezas seguían cobrando $3.000 en vez de $2.000. La orquestadora reabrió la decisión con esa
evidencia, y el owner la cambió.

### La literal, más "las promos que comparten línea se comparan juntas"

Arreglaba el caso de las dos promos, pero conservaba el sobrecobro en los dos carritos de vinos.
La descartó el owner en la misma pregunta.

### "Cada tanda contra el catálogo que todavía se está aplicando"

El resultado depende del orden en que se miran las tandas, y el 2x1 seguía en $3.500. La
descartó el owner en la primera pregunta, junto con "dejarlo".

## Consequences

### Positive

- El carrito de las cervezas cobra lo que el local anunció: $2.000 con el 3x1 y $3.000 con el
  2x1, por `/calcular`, POS, cuenta de salón y online.
- No depende del orden: los bloques no comparten líneas, así que ninguno le anula el catálogo
  a otro.
- El combo y la promo de `porcentaje` no cambian cuando son una sola aplicación.

### Negative

- Una promo puede aplicarse a medias: sus tandas sobre líneas disjuntas compiten por separado
  (el carrito de vinos al 65 %). Es lo que se eligió, pero el ticket puede mostrar "2x1" en las
  cervezas y no en los vinos.
- El bloque sigue siendo todo o nada: una aplicación que toca una línea con mucho catálogo
  puede hacer perder a todo su bloque, como ya pasaba con el combo.

### Neutral

- Con el interruptor encendido ("se suman") no hay arbitraje, y nada de esto corre.
- Las tablas y el congelado no cambian. Solo cambia qué aplicaciones llegan a la traza.
