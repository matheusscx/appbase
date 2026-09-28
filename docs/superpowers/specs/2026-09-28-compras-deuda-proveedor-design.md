# Compras: la deuda con el proveedor y sus pagos, con la salida de caja automática

**Fecha:** 2026-09-28 · **Tipo:** spec de diseño · **Status:** En diseño (preguntas al owner en curso; sin aprobar)
**Frente:** pieza 3 de *"Compras: carga manual, y el DTE del SII como atajo encima"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md). Viene después de las piezas 1 y 2 y
de la lectura del XML; lo que hace hoy compras está en
[`features/compras.md`](../../features/compras.md).
**Investigación:** [`2026-09-18-compras.md`](../../agent/investigaciones/2026-09-18-compras.md) § 5
(las decisiones de origen) y [`2026-09-28-deuda-proveedor.md`](../../agent/investigaciones/2026-09-28-deuda-proveedor.md)
(cómo lo resuelve el mercado).

---

## 2. Decisiones

**Heredadas, sin re-litigar** (owner, 2026-09-18; investigación de compras § 5, decisión 3):

- **Cada compra deja saldo con el proveedor**, con pagos parciales y vencimientos.
- **Un pago en efectivo sale de una caja y la salida la genera el sistema en el mismo acto.**
  Un pago por transferencia no toca la caja. Costo asumido: para pagar en efectivo hay que
  tener caja abierta, y el pago queda en el turno de quien lo hizo. La salida pasa por la
  **misma** validación contra el efectivo real que la salida manual
  ([`gestion-cajas.md`](../../features/gestion-cajas.md)).
- **La compra al contado se registra en un solo gesto**: "¿la pagaste ya?", con medio y caja.
- ⛔ **Lo fiscal va solo** (CLAUDE.md, ADR-010): IVA crédito fiscal, notas de crédito del
  proveedor en lo tributario y retenciones no entran. **Moneda:** siempre la oficial.
- **Gastos sin stock** (pieza 4) no entran en esta pieza.

**Tomadas en este frente:**

| # | Decisión | Quién, cuándo y cómo | Costo asumido |
|---|---|---|---|
| 1 | Investigación de mercado antes de diseñar | Owner, 2026-09-28, por la sesión orquestadora ("A investigación"), entre *investigar primero* y *preguntar directo* | Una ronda más antes de las preguntas |
| 2 | **El pago se asigna a facturas.** Al pagar, la pantalla propone repartirlo desde la compra más vieja; el usuario puede cambiar el reparto. Cada compra muestra su estado: pagada, "te faltan $X" o vencida | Owner, 2026-09-28, por la sesión orquestadora ("Vamos con A"), entre *A: elegir facturas con propuesta* (recomendada), *B: cuenta corriente sin atar a facturas* y *C: automático a la más vieja, sin elegir*. Escena: Don Pedro, $120.000 + $80.000, paga $150.000 | Un paso más al pagar (revisar el reparto propuesto) y lo más trabajoso de construir. Se descartó B porque no dice qué factura está pagada ni vencida, y C porque no se puede corregir sin anular el pago |
| 3 | **El efectivo sale solo de la caja abierta de quien paga.** Si no tiene caja abierta, la abre, o registra el pago alguien que sí la tiene (con el permiso de pagar). Ninguna regla de caja cambia: los movimientos siguen siendo solo del dueño del turno | Owner, 2026-09-28, por la sesión orquestadora ("Vamos con la A"), entre *A: solo la caja propia* (recomendada) y *B: elegir cualquier caja abierta, limitado a quien supervisa cajas*. Escena: Don Pedro cobra $80.000, el dueño sin caja y Marta con la suya abierta. Resolvía el choque entre "se elige de qué caja sale" y "queda en el turno de quien lo hizo" (18/09): manda el segundo | El dueño que no atiende caja no puede pagar en efectivo sin abrir una. Se descartó B porque el descuadre de un error del que paga caería en el cierre de otra persona. **B queda como posible suma futura** si se ve que el dueño nunca abre caja |
| 4 | **El vencimiento sale del plazo en días de cada proveedor**, contado desde la fecha del documento, y se puede cambiar en cada compra. Si el XML de la factura trae `FchVenc`, manda esa fecha. Un proveedor sin plazo cargado usa **30 días** | Owner, 2026-09-28, por la sesión orquestadora ("A"), entre *A: plazo por proveedor, editable por compra* (recomendada) y *B: fecha tipeada en cada compra*. Escena: Don Pedro 30 días, Andina 15, factura de Andina del 1/10 vence el 16/10 | Un dato más en la ficha del proveedor; un plazo mal cargado hace vencer mal todas sus compras hasta corregirlo. Se descartó B porque la compra sin fecha tipeada nunca aparece como vencida |
| 4b | **Una factura en cuotas queda con un solo vencimiento**, el de la fecha final. Las cuotas se pagan como pagos parciales | Tomada por esta sesión y planteada al owner junto con la 4 ("decido yo salvo que digas otra cosa"); **no la objetó** (2026-09-28) | Se pierde el aviso de cada cuota vencida. El XML puede traer hasta 30 pagos programados (`MntPagos`, Formato DTE v2.5) |
| 5 | **Se puede pagar sin factura (anticipo).** El pago sale de la caja ese día y queda **a favor** con el proveedor; al pagar su próxima compra, la pantalla propone usar ese saldo. El mismo saldo a favor recibe lo pagado de más cuando una corrección baja el total de una compra ya pagada | Owner, 2026-09-28, por la sesión orquestadora ("Dale con A"), entre *A: se permite el pago sin factura* (recomendada) y *B: solo se paga contra una compra cargada*. Escenas: Andina corregida de $100.000 a $90.000 después de pagada (saldo a favor en las dos opciones), y $50.000 adelantados a Don Pedro sin factura | Una opción más en la pantalla de pago y un saldo a favor que puede quedar olvidado. Se descartó B porque el efectivo del adelanto sale del cajón sin registro: descuadra, o se paga dos veces al llegar la factura |
| 6 | **Anular un pago en efectivo con su caja ya cerrada no toca ninguna caja.** La deuda vuelve y el cierre queda como quedó. Con la caja todavía abierta, la plata vuelve sola a esa caja, y solo su dueño puede anular (decisión 3) | Owner, 2026-09-28, por la sesión orquestadora ("A"), entre *A: no toca caja* (recomendada), *B: la plata entra a la caja abierta de quien anula* y *C: no se puede anular con la caja cerrada*. Escena: Marta registró por error $80.000 a Don Pedro, cerró con $80.000 de sobrante, y el jueves se anula | Si la plata sí había salido y el proveedor la devuelve, quien la recibe la anota como entrada manual en su caja. Se descartó B porque mete un descuadre en la caja de otro, y C porque deja la compra pagada cuando no lo está |
| 6b | **Anular una compra que ya tenía pagos deja lo pagado a favor** con el proveedor (mecanismo de la decisión 5) | Tomada por esta sesión y mostrada al owner junto con la 6; **no la objetó** (2026-09-28) | — |
| 6c | **Anular un pago por transferencia solo devuelve la deuda**; no toca caja | Tomada por esta sesión y mostrada al owner junto con la 6; **no la objetó** (2026-09-28) | — |

**Los 30 días, verificados contra el texto legal.** Ley 19.983, art. 2, en el texto que le
dio la Ley 21.131 ([texto publicado](http://www.sice.oas.org/SME_CH/CHL/Ley_21131_s.pdf),
generado por la BCN): el plazo máximo es de **treinta días corridos contados desde la
recepción de la factura**; un plazo mayor exige acuerdo escrito, suscrito e **inscrito en un
registro del Ministerio de Economía** dentro de cinco días hábiles, y si no, "se tendrán por
no escritas". Y si la factura no menciona plazo, *"se entenderá que debe ser pagada dentro de
los treinta días corridos siguientes a la recepción de la factura"*: el default de 30 días es
el de la propia ley. **Decisión técnica de esta sesión:** el sistema cuenta desde la fecha del
documento, no desde la recepción, porque la compra no guarda cuándo llegó la factura (la
fecha de confirmación es cuándo llegó la mercadería). Como la recepción nunca es anterior a
la emisión, el vencimiento calculado cae el mismo día o antes que el legal: nunca después.
