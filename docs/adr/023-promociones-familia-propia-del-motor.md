# ADR-023: Promociones como familia propia del motor — evaluador afuera, aplicación y conflicto adentro

**Status**: Accepted

**Date**: 2026-08-27

## Context

El análisis de julio 2026 (`docs/superpowers/specs/2026-07-22-motor-promociones-analisis.md`)
cerró el alcance de Fase 1 de un motor de promociones: 2x1/NxM, happy hour por porcentaje y
combo a precio fijo, activadas solo automáticamente, sin acumulación por default entre
promos. El motor de cálculo de precios ya resolvía descuentos/recargos de catálogo
(`descuentos`/`recargos`, con tramos, método de pago y vigencia por fecha) sobre cada línea.

La pregunta de arquitectura era **dónde vive la promoción respecto de ese motor existente**,
y tenía tres respuestas candidatas:

1. Fabricar promociones como filas sintéticas del mismo shape que una regla de descuento
   (`ReglaResuelta`) e inyectarlas en el paso de descuentos que ya existe.
2. Calcular el motor normal y, después, aplicar las promociones como un post-proceso sobre
   el resultado.
3. Tratar la promoción como una familia propia — con su propio evaluador, su propia traza y
   su propio congelado — que el motor conoce y compone, sin fundirla con `descuentos`.

El negocio necesita medir "cuánto descontamos en promos este mes" como una pregunta
independiente de "cuánto descontamos en catálogo" — son dos presupuestos distintos para
quien dirige el local — y necesita que el ticket muestre la promo **nombrada**
(`2x1 martes  −$5.000`), no fundida en un agregado genérico.

## Decision

**Promociones es una familia propia del motor, con tres piezas separadas:**

1. **El evaluador (`promociones.evaluator.ts`) vive AFUERA del motor**, como función pura
   sin BD ni NestJS — mismo molde que `calculo-precios.engine.ts`. Recibe promos elegibles +
   líneas resueltas (precio de lista, categoría, instante) y devuelve las aplicaciones que
   ganan el arbitraje **entre promos** (greedy por monto descendente, conteo de unidades por
   línea). El motor no importa nada del módulo `promociones`; la forma de entrada
   (`AplicacionPromoResuelta`) es la única frontera, tipada en el propio motor.
2. **La aplicación y el conflicto promo-vs-catálogo viven ADENTRO del motor**
   (`calculo-precios.engine.ts`): el monto de cada aplicación se resta como un descuento más
   dentro del paso `descuentos` de cada línea (monto fijo, después de los porcentajes de
   catálogo), con el mismo piso en cero y la misma cuantización al cierre de paso que
   cualquier otro monto. El arbitraje promo-vs-descuento de catálogo (el interruptor
   `promosAcumulanDescuentos`) también se resuelve acá, porque es el único lugar que conoce
   los montos de las dos familias completos (tramos, método de pago, base/compuesto).
3. **Familia propia de traza y de congelado.** `ResultadoLinea.trazas.promociones` es un
   array separado de `trazas.descuentos`, y `ventas_promociones` es una tabla propia — molde
   de `ventas_descuentos`, mismas garantías (NOT NULL, un solo camino de escritura), pero sin
   compartir filas ni flags con ella.

## Alternatives Considered

### (1) Reglas sintéticas — fabricar `ReglaResuelta` e inyectarlas en `descuentos`

El motor no necesitaría cambios de forma: una promo se traduciría a una fila con la misma
interfaz que ya consume el paso de descuentos. Descartada porque la parte difícil del
problema — el evaluador que decide qué unidades gana cada promo — es exactamente igual en
las dos alternativas; lo único que esta ahorraba era tocar el motor, y eso es justo lo que
se pierde: promos y descuentos quedarían mezclados en la misma traza y el mismo congelado
(`ventas_descuentos` con un flag para distinguir el origen, ids sintéticos contra un esquema
de congelado que hoy es invariante), y "¿cuánto desconté en promos?" dependería de un filtro
frágil sobre datos de dos orígenes distintos en vez de un `SUM` directo sobre una tabla
propia.

### (2) Post-proceso sobre el resultado del motor

Calcular la venta normal y, después, aplicar el descuento de la promo sobre los totales ya
cerrados. Descartada porque duplica la aritmética de cierre — cuantización, prorrateo del
combo, piso en cero — **fuera** del motor: sería el segundo camino de redondeo que el frente
de la plata (2026-08-21) eliminó a propósito, reintroducido por la puerta de atrás. Además
perdería el mecanismo del "ancla del cierre" (cómo un combo cierra exacto en su precio
declarado, IVA adentro): ese mecanismo depende de que la promo participe de la misma pasada
que deriva el impuesto por resta, no de una resta posterior sobre un total ya congelado.

## Consequences

### Positive

- **Medible sin filtros frágiles**: "¿cuánto descontamos en promos este mes?" es un `SUM`
  sobre `ventas_promociones`, sin tocar `ventas_descuentos` ni depender de un flag que
  alguien podría olvidar mapear.
- **El ticket nombra la promo** sin duplicar plata: `agregarPromocionesVenta` funde las
  aplicaciones de la misma promo en una fila propia, y el agregado `Descuento` del ticket se
  calcula como `totalDescuentos − Σ promociones` para no contarla dos veces — posible
  precisamente porque las dos familias están separadas en la traza desde el motor.
- **Cero segundo camino de redondeo.** La promo participa de la misma pasada de cierre que
  el resto de la línea (piso en cero, cuantización, y el ancla que deriva el impuesto por
  resta), así que un combo a precio fijo cierra exacto en su precio declarado sin aritmética
  aparte.
- **El evaluador es 100% testeable aislado** (43 casos unit sin BD ni NestJS), igual que ya
  lo es `calculo-precios.engine.ts` — el precedente de arquitectura se mantiene.

### Negative

- **Dos módulos que un cambio de reglas de negocio puede tocar a la vez**: agregar un cuarto
  tipo de promo exige tocar el evaluador (`promociones.evaluator.ts`) Y el punto de
  integración del motor si cambia la forma de `AplicacionPromoResuelta` — no hay tabla de
  "tipos" que permita agregar uno sin código, a diferencia de `tipos_regla` en descuentos
  (decisión deliberada, ver la spec §"Modelo de datos": un tipo nuevo de promo siempre exige
  una rama nueva en el evaluador, así que la flexibilidad de una tabla no se estaba
  comprando nada real).
- **El motor crece una familia más de traza y de config requerida**
  (`promosAcumulanDescuentos`, `AplicacionPromoResuelta[]`): quien lea
  `calculo-precios.engine.ts` por primera vez tiene una superficie más que entender antes de
  seguir el flujo completo de una línea.

### Neutral

- Los agregados de venta (`totalDescuentos`) siguen sumando el monto de promo dentro de sí
  —no hay un `totalPromociones` en los totales generales—; la separación vive en la traza
  por línea y en `ventas_promociones`, no en los totales agregados. Un reporte que necesite
  el número agregado lo obtiene de `ventas_promociones`, no de `totales`.
- La familia B de promociones (regalar un ítem no pedido, combo automático que agrega
  líneas) queda completamente fuera de este ADR: cambia el número de líneas de la venta, no
  solo su precio, y es un problema de otra forma que Fase 2 evaluará aparte.
