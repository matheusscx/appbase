# Descuento global vs. base del IVA — decisiones del owner

**Fecha:** 2026-08-21
**Estado:** ✅ Ronda de decisiones cerrada — **insumo directo del plan.** No toca código.
**Sobre qué se decidió:**
[investigación del DTE](../../agent/investigaciones/2026-08-21-descuento-global-vs-base-del-iva.md) ·
decisión (f) de [redondeo de plata](2026-08-20-redondeo-de-plata-decisiones.md) ·
entrada 🔴 de [`pendientes.md`](../../agent/pendientes.md)

> Seis decisiones. Cada una dice **qué se decidió**, **por qué** y **qué obliga** — la
> tercera es la que el plan tiene que honrar, y es lo que se pierde si solo se anota el "sí".

---

## Resumen

| # | Pregunta | Decisión |
|---|---|---|
| a | ¿Un descuento fijo se resta del neto o de lo cobrado? | **De lo cobrado** |
| b | ¿Cómo baja el descuento global al IVA? | **Prorrateo por peso a las líneas** |
| c | Con afecto y exento mezclados, ¿a qué base pega? | **Prorrata, calculada por el sistema** |
| d | ¿Quién se queda con el residuo del reparto? | **El resto más grande; desempata la posición** |
| e | ¿El descuento global apaga el cierre a góndola? | **No: le mueve el ancla** (enmendada) |
| f | ¿El frente va entero o por partes? | **Dos pasos: contrato fiscal, después prorrateo** |

---

## a) Un descuento de monto fijo se resta de lo cobrado, no del neto

**Decidido:** `$10.000` de descuento global significa que el cliente paga `$10.000` menos.
El neto y el IVA se derivan hacia atrás desde el total cobrado.

**Por qué:** es lo que la gente entiende por "te hago diez mil de descuento", y es el mismo
criterio que la decisión **(e)** del redondeo de plata —*lo cobrado es el dato firme, el
reparto interno se acomoda*—. Aplicar el criterio contrario obligaría a explicarle al cliente
que su descuento de `$10.000` le ahorró `$11.900`.

**Qué obliga:**
- ⚠️ **Solo cambia algo con montos fijos.** Con un `%`, restar del neto y restar del total dan
  el mismo número: bajar 10% del neto y 10% del IVA *es* bajar 10% del total. Verificado
  contra los números que el motor ya tiene medidos (góndola 993 con 10% → neto 751, IVA 143).
- El bug de hoy **no es ninguna de las dos lecturas**: calcula el `%` sobre el neto
  (`procesarReglas`, `base = params.neto`) y lo resta del total (`totalFinal.minus(dv.total)`).
  Eso da 909,6 sobre una góndola de 993 y un IVA de 159 donde el correcto es 143 — el mismo
  número que el comentario del motor ya identificó como incorrecto.
- Con un fijo, el total de la línea queda **anclado** y el impuesto puede no reproducirlo con
  `tasa × base`. El residuo lo absorbe quien dice (d).

## b) El descuento global se prorratea a las líneas, por peso

**Decidido:** cada línea recibe el descuento en proporción a lo que aporta. El impuesto se
recalcula por línea sobre la base nueva. No existe un "paso impuestos a nivel documento".

**Por qué:** es lo único que funciona con **tasas distintas en la misma boleta** — nuestras
líneas llevan IVA y `'otro'` (el ILA de una botella), y no hay una tasa única aplicable al
neto agregado. No es preferencia: la alternativa no es implementable en nuestro modelo. Es
además el mecanismo real de la industria: Square no tiene descuentos de documento, crea un
`OrderLineItemAppliedDiscount` por línea para cada descuento de scope `ORDER`.

**Qué obliga:**
- El descuento de documento pasa a ser **presentación**; el cálculo vive en las líneas.
- La suma de las asignaciones tiene que dar **exactamente** el descuento. Ver (d).
- El DTE se sigue emitiendo con `DscRcgGlobal` a nivel documento: el prorrateo es interno.

## c) El reparto entre base afecta y exenta lo calcula el sistema

**Decidido:** con líneas afectas y exentas en la misma boleta, el descuento se reparte
**a prorrata por peso** entre las dos bases. **No se le pregunta al usuario.**

**Por qué:** el mismo descuento puede dar tres IVA distintos según a qué base se impute
(medido: `$100.000` = `$80.000` afecto + `$20.000` exento con `$10.000` de descuento da IVA
13.300 / 15.200 / 13.680 según la imputación — `$1.900` de diferencia). Es una pregunta
tributaria, y el dueño de un restaurante no tiene por qué saber contestarla: es el criterio
ya escrito en [`DIFERENCIADORES.md`](../../DIFERENCIADORES.md) para el nivel de redondeo.

**Qué obliga:**
- 🛑 **Prerrequisito duro:** el motor tiene que **recibir el estado fiscal de la línea**. Hoy
  no lo recibe —lo dice el docblock de `elegirAbsorbente`— y una línea sin IVA puede ser un
  ítem exento *o* un ingrediente con `clasificacion_tributaria` nula. Derivarlo violaría la
  **invariante 5**. Por eso existe la decisión (f).
- El DTE sale con **dos líneas `DscRcgGlobal`**, una con `IndExeDR = 0` y otra con `1`, que es
  lo que el formato espera cuando el descuento toca las dos bases. La prorrata no es una
  interpretación nuestra: es lo que se declara.
- Si una boleta es toda afecta o toda exenta, la prorrata degenera en el caso simple y no
  hay que tratarlo aparte.

## d) El residuo va al resto más grande, y desempata el `id`

**Decidido:** repartido el descuento, la unidad mínima que sobra se asigna a la línea con el
**resto fraccionario más grande**; si dos empatan, desempata el `id` de la línea.

**Por qué:** es el criterio que el motor ya usa en `elegirAbsorbente` para el residuo del
desbruteo, y por la razón que está escrita ahí: sin desempate estable, **la misma venta
declara montos distintos según el orden en que la query devolvió las líneas.** Shopify le
tira el centavo a la primera línea; nosotros ya sabemos que "la primera" depende de quién
ordenó la lista.

**Qué obliga:**
- El reparto tiene que ser **determinista y testeable sin depender del orden de entrada**.
- ⚠️ **Enmendada al implementar (2026-08-21):** la decisión decía *"desempata el `id`"*, copiando
  a `elegirAbsorbente`. **Una línea no tiene un id propio** —dos líneas pueden ser del mismo
  ítem— así que se desempata por **posición**. Cumple el porqué de la decisión original, que era
  que el resultado no dependiera del orden de una consulta: la posición de una línea es el orden
  del documento, lo que el comprobante imprime, no el orden en que volvió un `SELECT`.
- Test con el caso numérico exacto: `$10.000` entre tres líneas iguales en CLP da
  `3.333 + 3.333 + 3.334`, no `3.333 × 3`.

## e) Un descuento global apaga el cierre a góndola, y queda dicho

**Decidido:** en una venta con descuento global, las líneas con `precio_incluye_impuesto`
**dejan de cerrar a la etiqueta** y su impuesto se calcula por el camino normal.

**Por qué:** con un descuento el cliente ya no paga la etiqueta, así que no hay góndola que
cerrar. El motor ya considera correcto eso para descuentos de línea y lo tiene medido en su
comentario; esta decisión lo extiende al descuento global sin cambiar el criterio.

**Qué obliga:**
- **Escribirlo en `docs/features/impuestos.md`**, no solo en el código. Es exactamente el
  tipo de cosa que alguien "arregla" seis meses después al ver que el total de una boleta con
  descuento no cierra a la etiqueta.
- ⚠️ **No confundirlo con la consecuencia elegida de la decisión (e) del redondeo**, donde el
  IVA difiere de `tasa × base` en un peso y **está bien**. Los dos casos viven en el mismo
  archivo y se parecen.
- ⚠️ **Enmendada el 2026-08-21, con el spike y con el owner.** La versión original decía que
  la línea *"deja de cerrar y su impuesto se calcula por el camino normal"*, y afirmaba —desde
  **un solo ejemplo**— que eso no contradecía (a). Un barrido de 11.604 casos dice que derivar
  por resta y aplicar `tasa × base` **difieren en 1.815 (15,6%)**, y que en esos casos
  `tasa × base` rompe que `base + impuesto` sea el total: `87 + 17 = 104` sobre un total de
  103. Como (a) **ancla lo que el cliente paga**, esa identidad no es negociable.
- **La decisión corregida:** el cierre **no se apaga, se le mueve el ancla** — de "el precio de
  etiqueta" a "el precio de etiqueta menos la parte prorrateada". El impuesto se sigue
  derivando por resta, que cierra siempre por construcción.

## f) El frente va en dos pasos, y el primero va solo

**Decidido:** **Paso 0** — el motor recibe el estado fiscal de la línea. **Paso 1** — el
prorrateo. El Paso 0 se entrega y verifica **antes** de empezar el Paso 1.

**Por qué:** (b), (c) y (d) son todas inimplementables sin el Paso 0, y el Paso 0 es un
cambio de **contrato de entrada** sin lógica nueva. Mezclarlos sería otra vez dos cambios del
motor en una pasada — que es lo que obligó a revertir el arreglo anterior del redondeo.

**Qué obliga:**
- El Paso 0 toca territorio de **ADR-018** (de dónde sale la clasificación tributaria de una
  línea). Si el cambio contradice el ADR, se detiene y se consulta antes de seguir.
- Cada paso cierra con el gate completo y con e2e, no solo unit.
- 📌 **No hay apuro y está medido:** ninguna pantalla manda `descuentosVentaIds` (cero
  productores en `frontend/app`). El endpoint existe y dos e2e lo ejercen, pero no hay
  consumidor de pantalla. **No construir la pantalla antes de terminar el Paso 1.**
