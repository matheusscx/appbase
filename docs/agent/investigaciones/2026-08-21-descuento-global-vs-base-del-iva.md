# Descuento de nivel venta vs. base del IVA — investigación (2026-08-21)

> ✅ **CERRADA — el código contestó todo esto, y empezó el mismo día (cierre escrito 2026-09-03).**
>
> Esta investigación describe un defecto **que ya no existe**. Se corrió el 2026-08-21 y el
> arreglo entró **ese mismo día**, así que quedó como foto de un problema resuelto horas
> después. **No tiene entrada en el backlog y nadie está esperando estas respuestas** — si
> llegaste acá buscando trabajo pendiente, no hay.
>
> **Los commits:**
>
> | Commit | Fecha | Qué cerró |
> |---|---|---|
> | `67a91028` | 2026-08-21 | **El arreglo.** El descuento de nivel venta baja **prorrateado a las líneas** y cada una recalcula su impuesto con **sus** tasas. También movió el ancla del cierre a góndola en vez de apagarlo |
> | `c0a17dcd` | 2026-08-27 | Las promociones **componen** con el ajuste de venta: `etiqueta − promo − parte del descuento global` |
> | `63ec1fb8` | 2026-08-28 | Con `nivel_redondeo = 'documento'`, el reparto deja de cuantizar y el residuo deja de inventar centavos |
>
> **La prorrata entre base afecta y exenta cae sola**, que era la pregunta 2 y el bloqueo del
> hallazgo D. Como cada línea divide su parte por **sus** tasas, una exenta se lleva su parte
> entera como neto y una afecta la parte — **sin que el motor necesite saber cuál es cuál**.
> Medido en el propio commit: *"1 afecta + 1 exenta con 200 de descuento da neto 908 + IVA 173
> + exento 909 = 1.990, y el cliente paga exactamente 200 menos"*.
>
> ⚠️ **Lo único que sobrevive, y es para cuando se integre el DTE:** el SII espera que el
> emisor **declare** sobre qué base pega cada descuento (`IndExeDR`); nosotros lo **derivamos**
> por prorrata. El resultado es equivalente, la forma de declararlo no.
>
> 📌 **Por qué se escribió este cierre.** El 2026-09-03 este documento se leyó como estado
> actual y se le dijo al owner que la proporción afecto/exento *"ya sale mal hoy"* — falso
> desde hacía dos semanas. Una investigación es la foto del día que se corrió; **si el código
> la contesta, el cierre se escribe acá o el próximo la vuelve a creer.**


> ⛔ **Esto no es diseño ni decisión.** Es la pasada de investigación que pide
> [`investigacion-mercado.md`](../investigacion-mercado.md) cuando la regla de negocio no
> está en `docs/`. Lo que trae el mercado es **insumo para cruzar**; si choca con nuestro
> modelo o con el owner, **gana el owner**. Nada de lo de acá se implementa sin decisión.

**Qué la disparó:** la entrada 🔴 del backlog *"Un descuento de nivel venta baja lo cobrado
pero NO la base del IVA"*, y la decisión **(f)** de
[`specs/2026-08-20-redondeo-de-plata-decisiones.md`](../../superpowers/specs/2026-08-20-redondeo-de-plata-decisiones.md),
que documentó el defecto y **explícitamente no decidió cómo se arregla**.

**Estado:** investigación cerrada, **sin spec y sin diseño**. Las preguntas de §6 son del owner.

---

## 1. La norma chilena — acá sí hay respuesta dura

La plantilla avisa (medido 2026-08-02) que en Chile la señal está en la norma y no en la
competencia. Se confirmó: los POS locales documentan la UI, el formato DTE documenta la
aritmética.

El formato de integración de la boleta electrónica define los totales **con fórmula
literal**, no con prosa:

```
MntNeto  = Suma de MontoItem por línea de detalle − Descuentos + Recargos
           · solo items con IndExe = 0
           · descuentos/recargos basados en la etiqueta <DscRcgGlobal>
MntExe   = Suma de ValorExento por línea de detalle   · solo items con IndExe = 1
IVA      = MntNeto * 19%
MntTotal = MntNeto + IVA + MntExe + MontoImp
```

**Tres cosas que se leen de ahí, y son las que importan:**

1. **El descuento global entra en la base, antes del IVA.** No es una resta al final: está
   dentro de la definición de `MntNeto`. La entrada del backlog acierta.
2. **La base está segregada por estado fiscal.** `MntNeto` suma **solo** los items con
   `IndExe = 0`. Un descuento global no cae sobre una bolsa mezclada de afecto y exento.
3. **El emisor declara a qué base pega cada descuento**, con `IndExeDR`:
   `0` = afecto · `1` = exento · `2` = no facturable. Máximo 20 líneas `DscRcgGlobal` por
   documento, cada una con `TpoMov` (`D`/`R`), `TpoValor` (`%`/`$`) y `ValorDR`.
   **No es derivado: es declarado.**

### ⚠️ Lo que NO quedó resuelto de la norma

Si el SII **rechaza** o solo **observa** un DTE donde `IVA ≠ tasa × MntNeto`, las fuentes
secundarias se contradicen: unas describen rechazo por descuadre, otras dicen que el SII no
rechaza por errores de contenido de ese tipo y que se corrige por NC/ND, y que un documento
con reparo es válido. **No lo resolví contra fuente primaria** y no se debería citar en
ninguna dirección. Para el diseño no cambia nada —la fórmula es la fórmula— pero **sí cambia
el discurso de urgencia**: la entrada del backlog dice que el DTE *"exige"* esa relación, y
lo que está verificado es que la **define**, no que la haga cumplir con un rechazo.

## 2. Qué hace el mercado internacional

Los cuatro POS relevados (Toast, Square, Clover, Lightspeed) coinciden en lo grueso: **el
descuento de nivel orden reduce la base imponible**, el impuesto se calcula sobre el
subtotal ya descontado.

Lo interesante es **el mecanismo**, no la conclusión:

- **Square** crea automáticamente un `OrderLineItemAppliedDiscount` en **cada línea** por
  cada descuento con scope `ORDER`. O sea: internamente **no existe** un descuento de
  documento — se prorratea a las líneas y de ahí sale el impuesto.
- **Clover** usa el subtotal posterior a los descuentos de orden para calcular la tasa
  **por línea imponible**.
- Cuando hay **varias bandas de impuesto**, el descuento de orden se parte en tantas líneas
  de descuento como bandas haya, para que el efecto tributario caiga en la banda correcta.
- Con **afecto y exento mezclados**, la recomendación es prorratear por los montos
  pre-descuento (ej.: subtotal 150 = 100 afecto + 50 exento, descuento 7,50 → 5,00 al afecto
  y 2,50 al exento) y **recalcular el impuesto por línea sobre las bases nuevas**.
- Advertencia repetida: **asignar el descuento al centavo por línea y recién ahí calcular el
  impuesto.** Calcular el impuesto sobre un subtotal ya redondeado introduce diferencias.

**El patrón de la industria es el prorrateo a las líneas.** El "descuento de documento" es
presentación; el cálculo vive en las líneas.

## 3. El residuo del prorrateo — el problema que nadie evita

Un descuento no siempre se parte en partes iguales, y la suma de las asignaciones tiene que
dar exactamente el descuento. Es un problema conocido y con soluciones distintas:

- **Shopify** asigna el centavo sobrante silenciosamente **a la primera línea**; su API de
  Functions aplica reglas más estrictas y ahí la discrepancia se hace visible. También
  documenta dos métodos de asignación (`each` vs `across`) que dan resultados distintos:
  10% sobre 7 ítems de $67,96 da **428,15** o **428,19** según el método. Cuatro centavos de
  diferencia por elegir mal.
- La formulación general del problema: si el cálculo es por línea, el resto se **asigna**;
  lo que no se puede es dejar que las partes no sumen el total.

**No hay un estándar.** Hay una restricción (las partes suman el total) y una decisión libre
(quién se come el resto). Nuestro motor **ya tomó esa decisión una vez**, para otro residuo
— ver §4.C.

## 4. El cruce contra nuestro código — lo que la entrada del backlog no dice

Esta es la parte que la investigación no podía traer y que decide el diseño. Todo lo de acá
está verificado leyendo `calculo-precios.engine.ts` hoy, 2026-08-21.

> ⛔ **Cuatro de estos hallazgos ya no describen el código** (verificado el 2026-09-03):
>
> - **A** — *"`totalImpuestos` intacto"*: **corregido**. El ajuste de venta baja a las líneas y
>   `totalImpuestos` sale del recálculo. El comentario engañoso que A pedía arreglar también
>   se reescribió.
> - **D** — *"el motor no recibe el estado fiscal, sin eso `IndExeDR` no se puede implementar"*:
>   **sorteado, no resuelto.** El motor **sigue sin** recibirlo, y no le hace falta: la prorrata
>   por tasas propias produce la segregación sin etiquetar la línea.
> - **E** — *"el descuento global cae sobre una bolsa mezclada"*: **ya no.**
> - **F** — *"apagaría el cierre a góndola"*: **no lo apaga, le mueve el ancla.**
>
> **B, C y G siguen en pie**: B es un descarte de diseño que se sostiene, C es el precedente que
> terminó usándose, y G describe la reachability (el endpoint acepta descuentos de nivel venta y
> **ninguna pantalla los manda** — re-verificado el 2026-09-03: `descuentosVentaIds` solo aparece
> declarado en `useCalculoPrecios.ts`, sin productores).

### A. El defecto se confirma, con las coordenadas corregidas

`totalImpuestos` se acumula **solo de las líneas** y el descuento de venta ajusta tres
totales y no ése:

```ts
totalDescuentos = totalDescuentos.plus(dv.total);
totalRecargos   = totalRecargos.plus(rv.total);
totalFinal      = totalFinal.minus(dv.total).plus(rv.total);
// totalImpuestos: intacto
```

⚠️ La entrada cita `:901-930` y la spec `:633-634`; **el bucle real está en `:937-965`**.
Las coordenadas se vencieron con los commits del 2026-08-21.

⚠️ Además hay un comentario en `:918-919` que afirma *"el paso `impuestos` no aplica a nivel
venta"* **como si fuera diseño deliberado**. Quien arregle esto tiene que corregirlo en el
mismo commit, o el próximo agente lee el comentario y desarregla.

### B. La opción "correr el paso impuestos a nivel venta" no generaliza

Nuestro motor aplica **una lista de impuestos por línea**, con tasas distintas: hay
`tipo === 'iva'` y hay `'otro'` (el ILA de una botella), y los `'otro'` se aplican **también
sin IVA**. Un paso de impuestos a nivel documento tendría que aplicar *una* tasa sobre el
neto agregado, y no existe tal tasa cuando las líneas no comparten impuestos.

**Esto descarta una de las tres opciones que había sobre la mesa**, y no por gusto sino por
el modelo. El prorrateo a las líneas es el único que soporta multi-tasa — que es, no por
casualidad, la razón por la que el mercado prorratea (§2, las "bandas de impuesto").

### C. Ya existe un precedente de cómo se reparte un residuo

`elegirAbsorbente()` (`:634`) resuelve el residuo del desbruteo: absorbe el **IVA**; si no
hay IVA, el adicional de **mayor tasa**; y desempata por `id` — con un comentario que
explica que el desempate **no es cosmético**, porque sin él la misma venta declararía montos
distintos según el orden en que el service devolvió la lista.

Ese es el estándar de la casa para un residuo: **determinista, documentado y no dependiente
del orden de una query.** El residuo del prorrateo debería seguir el mismo criterio. Es más
exigente que lo que hace Shopify (§3) y ya está escrito acá.

### D. 🛑 El motor NO recibe el estado fiscal — y sin eso `IndExeDR` no se puede implementar

El docblock de `elegirAbsorbente` lo dice explícitamente:

> *"Deliberadamente NO dice 'línea exenta': exento es un estado fiscal explícito y **el motor
> no lo recibe**. Lo único que ve acá es una lista sin IVA, y a eso se llega de más de una
> forma —un ítem exento, pero también uno con `clasificacion_tributaria` nula, que es el caso
> de los ingredientes."*

O sea: **hoy el motor no puede distinguir una línea exenta de una línea sin IVA por otro
motivo.** La segregación que la norma exige (`MntNeto` solo con `IndExe = 0`) **no es
implementable sin cambiar qué recibe el motor**.

Y derivarlo —"si no tiene IVA es exenta"— **violaría la invariante 5 de `CLAUDE.md`**:
*"Exento es un estado fiscal explícito, nunca la ausencia de impuesto."* No es una
preferencia de estilo: es exactamente el error que la invariante existe para prevenir.

**Esto es lo más grande que la entrada del backlog subcuenta.** No es "agregar una rama al
bucle": toca el contrato de entrada del motor, que es territorio de **ADR-018**.

### E. Hoy el descuento global cae sobre una bolsa mezclada

`accVenta` arranca en `subtotalNeto`, que suma **todas** las líneas, afectas y exentas. No
hay ninguna forma de expresar `IndExeDR` en nuestro modelo: una regla de nivel venta no
declara sobre qué base pega. Segundo hueco que la entrada no nombra.

### F. El descuento global apagaría el cierre a góndola

`cierraAGondola` (`:803`) exige `descuentoAplicado.isZero()` **a nivel de línea**. Si el
prorrateo mete un descuento en la línea, esa condición se vuelve falsa y la línea deja de
cerrar a la etiqueta — cae al camino `tasa × base`.

Según el propio comentario del motor **eso es lo correcto** (*"con un descuento el cliente ya
no paga la etiqueta, no hay góndola que cerrar"*), y está medido ahí con números. Pero
significa que **habilitar descuentos globales cambia el camino de cálculo de toda línea con
`precio_incluye_impuesto` de esa venta**. Tiene que ser una decisión escrita, no un
descubrimiento de quien audite una boleta seis meses después.

⚠️ **Y es justo el cruce que la entrada del backlog marca en rojo**: no confundir este
defecto con la consecuencia elegida del desbruteo (decisión **e**), donde el IVA difiere de
`tasa × base` y **está bien**.

### G. Reachability, medida hoy

- **Ninguna pantalla manda `descuentosVentaIds`.** El composable `useCalculoPrecios.ts:22-23`
  solo declara el tipo; cero productores en `frontend/app`.
- **Pero la API lo acepta** (`create-venta.dto.ts:164` → `ventas.service.ts:395`) y **dos e2e
  ya lo ejercen**: `ventas.e2e-spec.ts:375` y `:1178` crean ventas reales con un descuento de
  nivel venta.

O sea: hoy no hay una boleta mal emitida por la UI, pero el endpoint público la produce y la
suite ya la está produciendo. **No es teórico y tampoco es urgente**: es un endpoint sin
consumidor de pantalla.

## 5. Lo que este relevamiento NO cubrió

Para no sobreafirmar, y porque `DIFERENCIADORES.md` exige citar en vez de afirmar:

- **No se relevó** cómo resuelve el mercado la combinación **precio con impuesto incluido
  (tax-inclusive) + descuento de nivel orden**. Es el cruce de §4.F y es donde nuestro modelo
  es más particular, porque en EE.UU. el impuesto se agrega en la caja y la pregunta casi no
  se plantea. **No hay entrada en `DIFERENCIADORES.md` por esto**: no medí lo suficiente para
  decir que nadie lo hace, y la regla 2 de ese archivo prohíbe afirmarlo sin el relevamiento.
- **No se resolvió** rechazo vs. observación del SII (§1).
- **Toteat** no publicó nada útil, como la plantilla ya anticipaba.

## 6. Preguntas abiertas — ✅ contestadas por el código, no por el owner

⚠️ **Ninguna de estas cuatro sigue abierta.** Se dejan con su respuesta al lado en vez de
borrarlas, porque el razonamiento de por qué se preguntaban sigue siendo útil.

| # | Pregunta | Cómo quedó |
|---|---|---|
| 1 | ¿Prorrateo a las líneas? | **Sí** — `repartirProporcional` + recálculo de cada línea (`67a91028`) |
| 2 | ¿Sobre qué base pega con afecto y exento? | **Cae sola**: cada línea desbrutea con sus tasas; la exenta se lleva su parte entera |
| 3 | ¿Quién se come el residuo? | Al **resto más grande**, desempatando por posición (`67a91028`), y sin cuantizar en `'documento'` (`63ec1fb8`) |
| 4 | ¿Un descuento global apaga el cierre a góndola? | **No lo apaga: le mueve el ancla.** El owner enmendó la decisión (e) tras el spike |

### El texto original de las preguntas, para el registro

1. **¿Prorrateo a las líneas?** Es lo único que soporta multi-tasa (§4.B) y lo que hace el
   mercado (§2). La alternativa de un paso a nivel documento queda descartada por el modelo,
   no por preferencia.
2. **¿Sobre qué base pega un descuento global cuando hay afecto y exento?** La norma deja que
   el emisor lo declare (`IndExeDR`). Nuestro modelo hoy no puede ni declararlo ni derivarlo
   (§4.D, §4.E). Tres caminos: (a) siempre afecto, (b) repartir entre ambas bases por peso,
   (c) que la regla lo declare. Las tres exigen que el motor reciba el estado fiscal.
3. **¿Quién se come el residuo del prorrateo?** Sugerencia: el mismo criterio determinista de
   `elegirAbsorbente` (§4.C), no el "primera línea" de Shopify.
4. **¿Se acepta que un descuento global apague el cierre a góndola** de las líneas con precio
   con impuesto incluido (§4.F)?
5. **Cruce ya decidido:** el owner decidió el 2026-08-15 que **el modelo distingue el nivel de
   la regla** (línea vs venta). Ese campo es prerrequisito de todo esto y está en el backlog
   con entrada propia.

## 7. Fuentes

**Norma / formato DTE**

- [Formato de Integración Boleta Electrónica — facturacion.cl](https://www.facturacion.cl/manualintegracion/archivoboletaintegracion.php)
  — fórmulas literales de `MntNeto`, `MntExe`, `IVA`, `MntTotal`, e `IndExeDR` 0/1/2.
- [SII — Formato Documentos Tributarios Electrónicos v2.5 (2026-02)](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf)
  — especificación oficial (no se leyó completa; queda como fuente primaria a verificar).
- [SII — Emitir factura electrónica exenta o no afecta](https://www.sii.cl/factura_electronica/factura_sii/guias_ayuda/emitir_factura_exenta.htm)
- [SuperFactura — Descuentos y Recargos](https://blog.superfactura.cl/descuentos-y-recargos/)
  — campos de `DscRcgGlobal`; **no** trae reglas de cálculo.
- [DscRcgGlobal — csc-chile](https://dtem3.csc-chile.com/rest_api/1-emisi%C3%B3n/1-documentos/dscrcgglobal/)
  — límite de 20 líneas; `IndExeDR` "1 ó 2" sin explicar.
- [SimpleDTE — tipos de reparos y rechazos](https://www.simpledte.cl/knowledgebase/tipos-reparos-rechazos-dte-sii/)
  · [LibreDTE — estados de envío](https://www.libredte.cl/docs/procesos-sii/cuales-son-los-estados-al-enviar-un-dte-al-sii)
  — **se contradicen** sobre rechazo vs. reparo (§1).

**Mercado internacional**

- [Square — Apply Taxes, Discounts, and Service Charges](https://developer.squareup.com/docs/orders-api/apply-taxes-and-discounts)
  — `OrderLineItemAppliedDiscount` automático por línea para descuentos de scope `ORDER`.
- [Clover — Calculate order totals](https://docs.clover.com/dev/docs/calculating-order-totals)
- [Toast — Discounting Items and Checks](https://support.toasttab.com/en/article/Discounting-Items-and-Checks)
- [Lightspeed — Applying discount codes after tax](https://ecom-support.lightspeedhq.com/hc/en-us/articles/360043407633-Applying-discount-codes-after-tax)
- [IBM — Discount or charge distribution in an order](https://www.ibm.com/docs/he/SS4QMC_10.0.0/configuration/c_DiscountDistributionInAnOrder.html)
- [Sage 300 — order level discounts with taxable items](https://communityhub.sage.com/us/sage300/f/reports-macros-and-customizations/189959/applying-order-level-discounts-with-taxable-items)
  — el prorrateo afecto/exento con el ejemplo numérico de §2.
- [Spree PR #9461 — Whole Order Discounts That Calculate Tax Per Line Item](https://github.com/spree/spree/pull/9461)

**Residuo del prorrateo**

- [Pixoo — Shopify discount rounding, cents off](https://pixoo.app/blog/shopify-discount-rounding-issue-fixed-amount-cents-off)
- [Shopify Community — inconsistent cents rounding on discounts](https://community.shopify.dev/t/inconsistent-cents-rounding-on-discounts-across-different-stores/28655)
- [Drupal Commerce #3044185 — rounding can cause VAT to be higher than expected](https://www.drupal.org/project/commerce/issues/3044185)

**POS chilenos** (poco, como la plantilla anticipaba)

- [Bsale — Cómo calcular el IVA para una Pyme](https://www.bsale.cl/article/como-calcular-el-iva-para-una-pyme)
  · [Nubox — emisión de venta (API)](https://developers.nubox.com/emision-venta)
  · [Nubox — boleta no afecta o exenta](https://blog.nubox.com/empresas/boleta-no-afecta-o-exenta-electronica)
  — documentan la UI y el campo "afecto SÍ/NO", **no el motor de cálculo**.
