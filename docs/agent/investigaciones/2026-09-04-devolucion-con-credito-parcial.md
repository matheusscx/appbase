# Devolución con crédito menor que la mercadería — investigación de mercado

**Corrida el 2026-09-04**, a pedido del owner, antes de decidir la regla. Alimenta la entrada
de [`pendientes.md` § 4](../pendientes.md) *"Devolver mercadería que vale más que la nota de
crédito"*.

> ⛔ **Esto es una foto de cómo lo resolvieron otros, no lo que hay que hacer.** Insumo para
> cruzar contra nuestro modelo y nuestra realidad. Si el mercado dice A y el owner dice B,
> **gana B** — y se documenta por qué ([`investigacion-mercado.md`](../investigacion-mercado.md)).

## La pregunta

Un cliente devuelve mercadería que costó **$2.380** y se le acreditan **$500**. Puede ser un
error de tipeo, o una operación legítima: cargo por reposición, producto abierto, mercadería
que vuelve dañada. ¿Cómo lo resuelve el mercado, y qué exige la norma chilena?

## Lo que ya sabíamos, medido en el repo antes de investigar

1. El caso **siempre fue alcanzable**: el monto se topea contra el disponible y la cantidad
   contra lo vendido, y las dos validaciones nunca se hablan.
2. **El rechazo que se construyó el 2026-09-04 no impide el estado**: la vuelta a stock desde
   Inventario existe y es legal (`PATCH /items/:id/stock`, medido: 200).
3. **Y llega peor**: ese movimiento queda sin `venta_id`, suelto en el kardex.
4. **El documento sale idéntico** en los dos casos, porque la línea que no entra no se escribe.

---

## 1. Lo que trajo el mercado — el hallazgo que ordena todo

**Los dos ejes que nuestro modelo funde, el mercado los mantiene separados: *qué volvió* y
*cuánta plata sale*.** Es la observación que más pesa, y viene de la fuente más dura del
relevamiento — el ejemplo oficial de *exchange* de la Orders API de Square, donde
`return_amounts.total_money` (1.875) y `refunds[].amount_money` (625) son **campos distintos con
valores distintos**. El documento guarda el valor real de la mercadería; la plata que sale es
otra cosa. **No se falsea la línea para que cuadre con la caja.**

Nuestro modelo, en cambio, exige `Σ líneas = total_final` — y **de esa exigencia nace todo el
conflicto**. No es una restricción arbitraria: es lo que pide un documento tributario. Ahí es
donde la pata chilena decide (§ 3).

### 1.1 La línea negativa: nadie la usa en el POS, dos ERP sí

| Dónde vive el descuadre | Quién |
|---|---|
| **Entidad separada, automática** (*order adjustment*) | Shopify |
| **Se pierde la itemización entera** | Square (refund por monto → `item_type: CUSTOM_AMOUNT`, *"and no other catalog item information"*) |
| **Prohibido**: los precios de las líneas de retorno no se editan | Lightspeed X-Series (el escape lo habilita el fabricante, no el comercio) |
| **Cargo misceláneo suelto** en la pestaña de refund | Lightspeed R-Series |
| **Línea negativa dentro del documento** | **Ningún POS.** Sí SAP Business One, como *debit line* explícita |
| **Producto de catálogo dedicado**, con tarifa por motivo | Oracle PeopleSoft (`Restocking product ID`) |

📌 **La opción "crédito por monto sin itemizar" —que es lo que nuestro código hace hoy— es la
que ningún ERP usa**, y en Square está documentada como el camino que **borra qué volvió**.
⚠️ **Pero nuestra implementación no tiene ese defecto**: nosotros conservamos el movimiento de
inventario **atado al id de la nota**. Perdemos la itemización *en el documento*, no el rastro.
La diferencia importa y no hay que leer el hallazgo de Square como si nos aplicara entero.

### 1.2 El vocabulario estándar

- **Restocking fee** — el cargo por reposición. Es el término de la industria, pero **solo
  Shopify lo tiene como feature y como término** entre los POS; Toast, Square, Lightspeed y
  Clover no lo nombran. En ERP: PeopleSoft (nativo) y SAP (vía línea negativa).
- **Credit memo ≡ credit note** — sinónimos exactos (SAP lo declara así). Y **≠ refund**: la
  nota crea saldo a favor, el refund lo paga.
- **RMA / Return Authorization** — el documento *padre* del que cuelgan tanto el movimiento de
  mercadería como el documento de crédito.
- **Return** (recibir la mercadería) vs **Refund** (devolver la plata) — dos objetos separados
  en Shopify, NetSuite, SAP, Odoo.
- **Partial refund**, **unreferenced/unlinked refund**, **store credit**, **final sale**,
  **restock type** (`no_restock` / `cancel` / `return`).

### 1.3 Cómo frenan al operador

**Ninguno de los cinco POS documenta un modal de confirmación.** El patrón real es otro:

> **Donde el monto es libre, el motivo es obligatorio.** (Square y Toast.)

Los otros frenos son estructurales: Lightspeed apaga el camino y lo habilita el fabricante;
Clover pone un tope diario acumulado.

### 1.4 El caso borde más caro

**Toast: una tarjeta se reembolsa UNA sola vez.** *"If you issue a partial refund on a credit
card payment, you cannot issue a second refund on that same credit card."* Si se acredita de
menos y el cliente después reclama la diferencia, **por ese medio no hay segundo movimiento**.

### 1.5 Dos advertencias de los ERP que valen para nosotros

- **NetSuite**: una nota de crédito *standalone* repone cantidad pero **no acredita el COGS**,
  y eso corrompe el costeo. Su regla: siempre pasar por la RMA, que es la portadora del costo
  original. 📌 **Nosotros ya hacemos lo correcto acá**: el movimiento toma el costo congelado de
  la venta original (`costosDeSalidaPorItem`), no el CPP del momento.
- **SAP**: el valor de lo devuelto **no vuelve a la cuenta de stock original**, a propósito,
  *"in order to keep it separate from the value of the undamaged goods"*. O sea: SAP asume que
  lo que vuelve **no vale lo mismo** que lo que salió, y lo resuelve en el plan de cuentas, no
  en el monto de la nota.

### 1.6 El vínculo de auditoría — acá el mercado NO nos da respuesta

⚠️ **En ninguno de los cinco ERP el movimiento de stock referencia directamente al documento de
crédito.** Todos referencian al documento *padre* (RMA, entrega, factura). Nuestro
`movimientos_inventario.venta_id → id de la nota` **es una decisión propia, no un estándar
heredado** — y es justamente lo que el rechazo actual rompe.

Lightspeed documenta el ajuste suelto y lo asume: para producto dañado manda dos operaciones y
enseña a **nombrar los stocktakes con una convención** para poder filtrarlos después. Es la
confesión de que ahí el vínculo no existe.

---

## 2. Qué NO pudo verificar el relevamiento

Se declaran en vez de rellenarse, que es lo que hace útil una investigación:

| Hueco | Estado |
|---|---|
| La UI de Clover (Register) | Su help center no entrega contenido a ningún fetcher. Clover es el producto con menos respaldo acá |
| Si el `amount` por ítem de Clover puede ser menor al precio de la línea | No documentado |
| Qué imprime el comprobante de devolución en Toast y Clover | No documentado |
| Si el prompt de restock de Toast aparece tras un refund por monto libre | **No documentado — y es justo la combinación que nos interesa** |
| Restocking fee en Toast, Square, Lightspeed, Clover | El término **no existe** en su documentación oficial |
| IVA del cargo por reposición en LatAm | Sin fuente. Ningún ERP documenta el tratamiento; lo dejan como ítem con código de impuesto configurable |

Sobre impuestos hay **un solo dato duro, y es de otra jurisdicción**: el Departamento de
Ingresos de Washington dice que el restocking fee **no es venta minorista gravada** y que el
impuesto de la venta original **se devuelve completo, sin prorratear por el cargo**. Si eso se
aplicara acá, el documento no sería "crédito neto + IVA sobre el neto" sino **dos hechos
fiscales distintos**. ⛔ **No es transferible a Chile sin verificar**, y de eso se ocupa la § 3.

---

## 3. La pata chilena — y acá se decide

Relevada sobre el **Formato DTE v2.5 (2026-02)**, el DL 825, el DS 55 y la Res. Ex. SII
N°45/2003, leídos directamente y no por resúmenes.

### 3.1 La respuesta a la pregunta que importaba

> **Una nota de crédito por $500 con una sola línea "Ajuste", que no mencione las 2 unidades
> devueltas, es un DTE válidamente formado y aceptado.**

En la Zona Detalle de una **nota de crédito**, lo único obligatorio es `NroLinDet`, `NmbItem` y
`MontoItem`. **`QtyItem` (cantidad) y `PrcItem` (precio unitario) son *condicionales*.** Y
ninguna regla del Formato ata las líneas de la NC a las del documento referenciado.

Hay una tensión con el Reglamento (DS 55, art. 69 A N°6, que pide "detalle de la mercadería y
precio unitario"), pero **no puede leerse como "toda NC enumera bienes"**: el propio art. 57 del
DL 825 obliga a emitir NC por **descuentos y bonificaciones**, donde no hay mercadería alguna. Y
el SII, en la Res. 45/2003, manda poner **texto libre** en el Detalle de una NC que corrige datos
(*"Donde dice… debe decir…"*).

### 3.2 El SII no valida el contenido — y está escrito

Las causales de rechazo son una **lista cerrada de cinco** (Res. 45/2003, resolutivo Cuarto
N°12): archivo ilegible, campos de identificación faltantes, RUT inválido, firma inválida, folio
no autorizado. **Ninguna sobre el detalle.** La inconsistencia aritmética genera **reparo**, no
rechazo — el documento entra igual. El Formato lo dice con todas las letras: *"No se rechazan
documentos por errores de contenido…"*.

### 3.3 No existe un "cargo por reposición" en el DTE

Se barrieron las cuatro zonas donde podría vivir. **No hay campo con ese nombre ni con esa
semántica.** Lo que sí hay para acreditar menos: `DescuentoMonto` por línea, y la zona
`DscRcgGlobal` con una **glosa libre de 45 caracteres**. La zona *Comisiones y Otros Cargos*
—que por nombre parecía la candidata— está acotada a Liquidaciones-Factura y a NC que corrigen
Facturas de Compra: **no aplica a una NC de retail**.

⚠️ Y el signo es contraintuitivo: dentro de una NC, el que **reduce** el crédito es `TpoMov = D`
(descuento), no el recargo.

### 3.4 El código de referencia no registra esta distinción

Para una devolución parcial corresponde **`CodRef = 3` (corrige montos)** — el 1 está reservado
a eliminar el documento *"en forma completa"*, y el 2 (corrige texto) **no puede llevar plata**
(`MontoItem = 0` obligatorio). **Que el crédito no cubra la mercadería no cambia el `CodRef`**:
la taxonomía del SII es correctiva (anula / corrige texto / corrige montos), no causal. No hay
ningún campo del DTE donde esta situación se declare.

### 3.5 La norma separa el movimiento físico del documento de crédito

La mercadería devuelta tiene **su propio documento**: la Guía de Despacho con
`IndTraslado = 7` ("Devolución de Mercaderías"). El vínculo entre el hecho físico y el efecto
tributario de la NC es **normativo, no documental**: el art. 21 N°2 del DL 825 condiciona la
deducción del débito fiscal a que la devolución haya ocurrido dentro de plazo.

📌 O sea que **la separación que el mercado hace por diseño, en Chile la hace la norma.**

### 3.6 Los POS locales: dos interruptores, nunca un concepto

**Ninguno de los cuatro usa las palabras "cargo por reposición".** Y los cuatro tratan
"acreditar menos plata" y "mover stock" como **decisiones independientes**:

- **Bsale** separa los flujos y lo rotula literalmente: *"Ajuste de precios seleccionamos (nota
  de crédito, **no modifica stock**)"*. El flujo pide crear una **glosa libre** y borrar los
  ítems que el sistema precarga.
- **Defontana** documenta exactamente los tres `CodRef` del SII y **no tiene un cuarto motivo
  "devolución de mercadería"**. Su API tiene endpoints pareados —`SaveCreditNote` y
  `SaveCreditNoteAsyncStockMovement`— que prueban que el movimiento de inventario es una
  decisión aparte.
- **Nubox** documenta la NC por monto menor, **sin mencionar inventario en ningún artículo**.
- **Toteat**: confirmado el vacío con evidencia positiva —sus 14 endpoints públicos no crean ni
  modifican notas de crédito—. En su POS la anulación es todo-o-nada y el número de la NC se
  anota de forma *"referencial"*.

### 3.7 Huecos de la pata chilena, declarados

1. **Si el detalle de una NC por devolución física debe enumerar las unidades devueltas**: sin
   pronunciamiento del SII. El Reglamento y el Formato apuntan distinto y nadie los concilia.
2. **La regla "el SII rechaza una NC que supere el monto del documento referenciado"** circula
   en blogs de proveedores y **no está en ninguna de las tres fuentes oficiales**. Puede ser un
   guard de los propios proveedores presentado como norma.
3. **Si el cargo por reposición es servicio afecto a IVA o indemnización no gravada**: sin
   doctrina del SII. Desde la Ley 21.420 (01-01-2023) todo servicio es afecto, así que la
   pregunta es de **calificación**, no de tasa. **Es del owner o de un asesor tributario.**
4. El plazo del art. 21 N°2: dos documentos del propio SII dicen tres meses y seis meses.

---

## 4. El cruce contra nuestro modelo

La regla del repo: el hallazgo se contrasta contra el código **antes** de convertirse en diseño.

### 4.1 Lo que construimos está bien, y ahora con respaldo

Nuestra NC por monto, con líneas de ajuste que declaran su neto e IVA, **es un DTE válido**. Lo
que el 2026-09-04 se hizo por criterio propio —descomponer el monto en lugar de declarar cero—
resulta ser **más de lo que el SII exige**, no menos. No hay nada que deshacer.

### 4.2 Lo que el rechazo actual no tiene: fundamento

| Lo que se creía | Lo que dice la evidencia |
|---|---|
| Rechazar protege el documento | **No.** El documento sale idéntico se acepte o se rechace (medido en el repo) |
| Rechazar protege el estado | **No.** La vuelta a stock desde Inventario existe y es legal (medido: 200) |
| La norma exige que la nota refleje la mercadería | **No.** Cantidad y precio unitario son condicionales en la NC |
| El SII valida esta consistencia | **No.** Cinco causales cerradas, ninguna sobre el detalle |
| El mercado rechaza este caso | **Casi nadie.** Solo Lightspeed X lo prohíbe en el camino ligado — y su escape lo habilita el fabricante |

📌 **Y lo que sí rompe el rechazo está medido:** el hilo de auditoría, porque empuja al operador
a una vuelta a stock que queda **sin `venta_id`**.

### 4.3 La fusión que causa todo el conflicto es nuestra, no del SII

El mercado —internacional, ERP y chileno— mantiene **"qué volvió"** y **"cuánta plata sale"**
como magnitudes independientes. Nosotros las fundimos al exigir `Σ líneas = total_final`.

**Esa exigencia es nuestra decisión de diseño, no un requisito fiscal**: el SII pide que
`MntTotal` cuadre con neto + exento + IVA, y eso lo seguimos cumpliendo. No pide que las líneas
reflejen la mercadería. 📌 Vale la pena tenerlo escrito porque **es la restricción de la que
nace el conflicto entero**, y ahora sabemos que es reversible si algún día conviene.

### 4.4 La línea negativa se descarta, y con dos razones independientes

- **El mercado no la usa**: ningún POS; solo SAP y PeopleSoft entre los ERP.
- **El DTE no la nombra**: no hay campo de cargo por reposición; lo más cercano es un descuento
  global con glosa libre de 45 caracteres.

### 4.5 El freno: motivo obligatorio, no modal

**Ningún POS usa confirmación modal.** El patrón real, en Square y Toast, es:

> **Donde el monto es libre, el motivo es obligatorio.**

📌 **Y nosotros ya tenemos la pieza**: `comentario` existe, es opcional, y **ya viaja como glosa
de la línea de ajuste** (`descripcion: params.comentario ?? 'Ajuste'`). Hacerlo obligatorio
cuando la mercadería excede el monto es un cambio chico que además **mejora el documento**: la
glosa es exactamente el campo que el DTE deja libre para explicar por qué se acredita menos.

### 4.6 Dos cosas que ya hacemos bien, y conviene no perder

- **El costo congelado.** NetSuite advierte que una nota *standalone* corrompe el costeo porque
  repone cantidad sin acreditar el COGS. Nosotros tomamos el costo de la venta original
  (`costosDeSalidaPorItem`), que es justo lo que su RMA existe para transportar.
- **El vínculo `movimiento → nota`.** Ningún ERP lo tiene: todos atan al documento padre. Es una
  decisión propia y **es mejor que el estándar** — por eso perderla es el costo real del rechazo.

### 4.7 El caso borde que hay que mirar antes de decidir

**Toast: una tarjeta se reembolsa una sola vez.** Si se acredita de menos y el cliente después
reclama la diferencia, por ese medio no hay segundo movimiento. ⚠️ **No verificado contra
Transbank** — es de la documentación de Toast, jurisdicción distinta. Si acá vale igual, es un
argumento para que el operador **vea el número antes de confirmar**, que es lo que el motivo
obligatorio consigue de paso.


## Fuentes

**POS:** [Square Orders API — refunds &amp; exchanges](https://developer.squareup.com/docs/orders-api/order-returns-exchanges) ·
[Square — manage refunds](https://squareup.com/help/us/en/article/6116-process-refunds) ·
[Toast — issuing a refund](https://support.toasttab.com/en/article/Issuing-a-Refund) ·
[Toast — retail returns](https://support.toasttab.com/en/article/Process-Retail-Returns-on-the-POS) ·
[Lightspeed X — returns and refunds](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534237536411-Processing-returns-and-refunds) ·
[Lightspeed X — damaged return](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25533911726363-How-to-process-a-warranty-damaged-product-return) ·
[Lightspeed R — refunding and exchanging](https://retail-support.lightspeedhq.com/hc/en-us/articles/229130768-Refunding-and-exchanging) ·
[Clover — refunds and voids](https://docs.clover.com/dev/docs/ecommerce-refunding-payments) ·
[Shopify — refunding orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/refunding-orders) ·
[Shopify — return rules](https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/return-rules) ·
[Shopify REST Refund](https://shopify.dev/docs/api/admin-rest/latest/resources/refund)

**ERP:** [NetSuite — Customer Return Management](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1302852.html) ·
[NetSuite — Customer Credit Memos](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1311306.html) ·
[NetSuite — Stand Alone Credit Memo](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4337971641.html) ·
[SAP B1 — Returns and Exchanges](https://help.sap.com/doc/download_multimedia_ebooks_businessone90_tb1000_03_06_story_html/9.0/en-US/story_content/external_files/B1_90_TB1000_03_06.pdf) ·
[SAP B1 — A/R Credit Memos](https://help.sap.com/doc/download_multimedia_ebooks_businessone90_tb1000_03_07_story_html/9.0/en-US/story_content/external_files/B1_90_TB1000_03_07.pdf) ·
[Odoo — Returns and refunds](https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/returns.html) ·
[Xero — API CreditNotes](https://developer.xero.com/documentation/api/accounting/creditnotes) ·
[PeopleSoft — Return Type Codes and Restocking Fees](https://docs.oracle.com/en/applications/peoplesoft/financials-and-supply-chain-management/9.2.056/peoplesoft-order-to-cash-common-information/establishing-return-type-codes-restocking-fees.html)

**Chile — normativa:** [DL 825 (copia del SII)](https://www.sii.cl/pagina/jurisprudencia/legislacion/basica/dl825.doc) ·
[DS 55/1977 — Reglamento](https://www.sii.cl/normativa_legislacion/ds_55_reglamento.pdf) ·
[Res. Ex. SII N°45/2003](https://www.sii.cl/documentos/resoluciones/2003/reso45.htm) ·
[Circular SII N°50/2022 — Ley 21.420](https://www.sii.cl/normativa_legislacion/circulares/2022/circu50.pdf)

**Chile — especificación:** [Formato DTE v2.5, 2026-02](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) ·
[Nuevas validaciones a la IECV y DTE](https://www.sii.cl/factura_electronica/compra_venta.pdf) ·
[Guías de nota de crédito del SII](https://www.sii.cl/destacados/factura_electronica/guias_ayuda/nota_credito.html)

**Chile — POS/ERP:** [Bsale — API devoluciones](https://docs.bsale.dev/devoluciones/) ·
[Bsale — NC por monto específico](https://ayuda.bsale.io/support/solutions/articles/151000212255--c%C3%B3mo-realizar-nota-de-cr%C3%A9dito-por-un-monto-en-espec%C3%ADfico-) ·
[Defontana — NC corrige monto](https://intercom.help/defontanaerp/es/articles/4092681-nota-de-credito-corrige-monto) ·
[Defontana — API pública](https://api-doc.defontana.com/) ·
[Nubox — rebajar el monto de una factura](https://help.nubox.com/es/articles/4812177-como-puedo-rebajar-el-monto-de-una-factura-que-fue-anulada-con-nota-de-credito) ·
[Toteat — anular órdenes cerradas](https://toteat.com/ayuda/operacion-en-restaurante/articulo-ayuda/anular-eliminar-ordenes-cerradas) ·
[Toteat — API](https://developers.toteat.com/)

**Impuestos (otra jurisdicción):** [WA Dept. of Revenue — Restocking fees](https://dor.wa.gov/forms-publications/publications-subject/tax-topics/restocking-fees-returned-merchandise)
