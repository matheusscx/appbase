# Deuda con el proveedor — investigación de mercado

**Fecha:** 2026-09-28
**Estado:** 🔎 Investigación, sin decisiones
**Antecedente:** [`2026-09-18-compras.md`](2026-09-18-compras.md) (decisión 3, ya tomada por
el owner: "deuda desde la primera fase", pago en efectivo sale de caja en el mismo acto,
compra al contado en un gesto)

> ⚠️ Método ([`../investigacion-mercado.md`](../investigacion-mercado.md)): lo que sigue es
> **insumo para cruzar, no verdad a copiar**. Cada afirmación lleva fuente y confianza:
> **[PRIMARIA]** (norma o doc oficial), **[SECUNDARIA]** (blog, consultora, foro) o
> **[NO VERIFICADO]**. Esta pasada construye sobre `2026-09-18-compras.md` — no repite lo
> que ya está ahí (tipos de documento, costo provisorio, escuelas de corrección de costo).
>
> **Verificación propia (sesión que diseña, 2026-09-28):** se volvieron a abrir las tres
> fuentes que más pesan. El artículo de Fudo se leyó entero (§2, §5 y §7 corregidos con
> lo que dice textual; la primera versión le atribuía una casilla "Usar en arqueo" en el
> pago que el artículo no describe). El PDF del SII `formato_dte_202602.pdf` se abrió y
> confirma `FmaPago`, `FchVenc`, `TermPagoCdg/Glosa/Dias` y la tabla `MntPagos` (§1, §8).
> Carey confirma el plazo desde la recepción y la excepción por acuerdo inscrito; es el
> resumen de un estudio jurídico, así que va como [SECUNDARIA], no como la ley.

---

## 1. De dónde sale el vencimiento

**Odoo** separa dos caminos: fijar la fecha de vencimiento a mano, o elegir un
**término de pago** (`Payment Terms`) que la calcula — "neto a 15 días", "30% al emitir y
el resto a fin del mes siguiente", con descuento por pronto pago. La doc dice
textualmente que los términos de pago sirven sobre todo para instalments o descuentos;
*"de lo contrario, fijar la fecha a mano alcanza"* **[PRIMARIA]**
([Payment terms and installment plans](https://www.odoo.com/documentation/19.0/applications/finance/accounting/customer_invoices/payment_terms.html)).
El término de pago se puede asignar por proveedor como default y queda editable en cada
factura.

**Relbase** documenta una acción explícita **"¿Cómo modificar la fecha de vencimiento de
una compra?"** dentro de "Pago a Proveedores" **[SECUNDARIA]** — confirma que la fecha se
tipea/edita por compra, pero el índice no dice si hay un default por proveedor
([Relbase: Compras](https://ayuda.relbase.cl/compras)).

**SII (DTE):** el nodo `IdDoc` de una factura trae `FmaPago` (1=contado, 2=crédito,
default 2 si no se informa), `FchVenc` (fecha de vencimiento, AAAA-MM-DD),
`TermPagoCdg` + `TermPagoDias` (un código acordado y sus días: "5 días desde la entrega
de mercaderías", código `FEM`), `TermPagoGlosa` (texto libre) y la tabla **`MntPagos`**:
hasta 30 cuotas programadas, cada una con `FchPago` y `MntPago` **[PRIMARIA]**
([Formato DTE 2026-02](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf),
campos 13 y 18-30 del encabezado). En la factura, `FmaPago` es obligatorio (si falta se
entiende crédito) y `FchVenc` es **condicional**: no viene siempre. Los términos y la
tabla de cuotas son opcionales.

→ **Para nosotros:** el patrón universal es "plazo por proveedor, editable por compra".
El lector de XML que ya está en main (`frontend/app/composables/useDte.ts`) hoy lee
`FchEmis` pero **no** `FchVenc`, `FmaPago` ni `MntPagos`: agregarlos es barato, y cuando
`FchVenc` viene, el vencimiento sale sin tipear. Como es condicional, no alcanza como
única fuente. Una factura en cuotas (`MntPagos`) es un caso que "una fecha de vencimiento
por compra" no expresa.

---

## 2. Un pago que cubre varias facturas

**Odoo:** reconcilia un pago (u otro documento con saldo, como una devolución) contra
**una o varias** facturas de proveedor a la vez, con reconciliación **parcial** también
soportada — se puede editar el monto "a pagar" de cada factura en la pantalla de
reconciliación **[SECUNDARIA]**. La documentación oficial no dice que el orden sea
estrictamente FIFO; lo que se verificó es que las líneas de reconciliación se muestran
**ordenadas por fecha**, lo cual sugiere un orden sugerido pero no confirma una regla de
aplicación automática obligatoria **[NO VERIFICADO]**
([Odoo: Payments](https://www.odoo.com/documentation/19.0/applications/finance/accounting/payments.html)).
El nombre estándar de la industria es **"bill payment"** aplicado contra vendor bills, y
"reconciliación" (reconciliation) para el acto de calzar pago↔factura.

**QuickBooks:** el flujo es **"Pay Bills"** — se listan las facturas pendientes del
proveedor, el usuario **marca (checkbox)** cuáles paga y por cuánto; no hay automatismo
FIFO documentado, es elección manual **[SECUNDARIA]**
([QuickBooks: Pay Bills / credits](https://quickbooks.intuit.com/learn-support/en-us/payments/applying-credits-against-vendor-bills/00/969057)).

**Relbase** tiene **"Pagar documentos de forma masiva"**: selección de varios documentos
recibidos y pago total conjunto — mismo patrón de selección manual, no automática
**[SECUNDARIA]**. No se encontró si permite pago parcial dentro del pago masivo.

**Fudo** tiene las dos formas, y separa por plan **[PRIMARIA]**
([Fudo: cuentas corrientes de proveedores](https://soporte.fu.do/es/articles/11730969-cuentas-corrientes-de-proveedores)).
El pago se registra en Proveedores → Cuentas corrientes → "+ Nueva transacción". En el
plan Pro se le pueden asociar "el o los gastos" que paga ("pueden ser más de uno"), y cada
gasto asociado pasa de "A pagar" a "Pagado". Sin asociar, el pago baja el saldo del
proveedor y el gasto sigue figurando como "A pagar". El artículo no dice qué pasa si el
pago asociado es menor que los gastos elegidos.

→ **Para nosotros:** ningún sistema relevado hace FIFO automático estricto; el patrón
dominante es **elegir qué facturas paga cada pago**, con reparto parcial permitido. La
"cuenta corriente" pura (el pago baja el saldo del proveedor sin atarse a una factura) es
la alternativa simple, y Fudo la ofrece como plan básico, con el costo visible en su
propio artículo: el gasto queda "A pagar" aunque ya se haya pagado.

---

## 3. Pagar de más / anticipo / saldo a favor

**QuickBooks** sí lo permite: un pago mayor a la factura genera un **"vendor credit"**
que queda como **saldo negativo en la cuenta del proveedor** (dentro de cuentas por
pagar, no por cobrar) y se aplica después a cualquier factura futura, incluso con fecha
posterior al anticipo **[SECUNDARIA]**
([QuickBooks: vendor overpayment](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/i-overpaid-a-vendor-s-invoice-how-do-i-record-the-actual/00/1421855)).

**Colppy** (contable latinoamericano, no relevado en la pasada anterior) tiene
"Pagos a cuenta en cuenta corriente — Proveedores": el pago se registra sin factura
asociada y **queda a cuenta**, para asociar más tarde **[SECUNDARIA]**
([Colppy](https://intercom.help/Colppy/es/articles/1263184-pagos-a-cuenta-en-cuenta-corriente-proveedores)).

**Odoo** también permite un pago sin factura (standalone payment) y reconciliarlo
después contra una o varias facturas futuras **[SECUNDARIA, coherente con §2]**.

No se encontró en Fudo/Relbase/Bsale una confirmación textual explícita de "anticipo /
saldo a favor de proveedor" — el modelo de cuenta corriente de Fudo lo permite
implícitamente (el saldo puede quedar negativo) pero no hay cita que lo diga con esas
palabras **[NO VERIFICADO]**.

→ **Para nosotros:** el mercado sí soporta pagar de más y dejarlo como crédito aplicable
después; el nombre estándar es "vendor credit" (QuickBooks) o simplemente saldo negativo
de la cuenta corriente (modelo latino). Es una decisión de alcance: soportarlo agrega el
estado "saldo a favor del proveedor" y su aplicación a compras futuras.

---

## 4. Vista de lo que se debe

El nombre estándar de la industria es **"accounts payable aging report"** (o "AP aging"),
con **buckets de 30 días**: current/0-30, 31-60, 61-90, 90+ — variantes menores en el
primer corte pero la estructura de 30 en 30 es constante **[SECUNDARIA, consistente entre
Tipalti, AccountingTools, Bill.com, Microsoft Business Central]**
([Bill.com: aging report](https://www.bill.com/learning/aging-report);
[AccountingTools](https://www.accountingtools.com/articles/the-accounts-payable-aging-report.html)).
El reporte agrupa por proveedor, muestra saldo total y el desglose por antigüedad, y su
uso declarado es priorizar pagos y evitar mora.

Relbase expone estados explícitos por documento: **pagado / pendiente / vencido**
(§2 de `2026-09-18-compras.md`), que es un aging simplificado a 3 estados en vez de
buckets.

No se encontró documentación pública de MarketMan sobre un reporte de aging propio
**[NO VERIFICADO]**.

→ **Para nosotros:** el mínimo que documenta el mercado es **saldo por proveedor +
estado por factura (pendiente/vencida)**; el aging por buckets de 30 días es un nivel
más, común en software contable pero no necesariamente en POS operativos (Relbase, que sí
es un POS/ERP chileno, se queda en 3 estados).

---

## 5. Choque con "el pago en efectivo sale de una caja en el mismo acto"

**Toast** tiene **"Pay Out"** dentro de Cash Management: una salida de caja con motivo
configurable (incluye pagar a un proveedor en efectivo), que queda en la actividad del
cajón y en el reporte de auditoría de caja **[SECUNDARIA]**
([Toast: cash drawer operations](https://doc.toasttab.com/doc/platformguide/adminCashDrawerPOSOperations.html)).
No se encontró que Toast ate ese Pay Out a una factura de proveedor específica — es una
salida de caja con glosa, no una aplicación a deuda **[NO VERIFICADO]**.

**Square** tiene **"Cash Management"**: registra ingresos/egresos de caja fuera de las
ventas, con descripción y monto, mismo patrón que Toast — salida de caja genérica, sin
enlace documentado a una factura de proveedor puntual **[SECUNDARIA]**.

**Fudo** es el único de los relevados que ata explícitamente el pago a proveedor con el
arqueo **[PRIMARIA]**
([Fudo: cuentas corrientes de proveedores](https://soporte.fu.do/es/articles/11730969-cuentas-corrientes-de-proveedores)).
Al cargar un gasto con medio "Cta. Corriente", el gasto **no** impacta el arqueo en curso
y se inhabilitan sus campos "Caja" y "Usar en Arqueo" (en un gasto pagado en el momento,
esos dos campos existen: el gasto elige caja y si cuenta en el arqueo). Cuando después se
registra el pago, aparece en el arqueo como "Gasto" si está asociado a un gasto, o como
"Pago proveedores ctas ctes" si no. Advierte además que un gasto con fecha anterior al
arqueo en curso, pagado con cuenta corriente, no aparece en ese arqueo. El artículo no
dice de qué caja sale el pago ni si se puede registrar sin tocar el arqueo (una
transferencia, por ejemplo).
→ Es el mismo mecanismo que ya decidió el owner (la salida la genera el sistema en el
mismo acto que el pago). La diferencia visible es que en Fudo la caja y el "usar en
arqueo" son campos que se eligen en el gasto; acá lo decide el medio de pago.

No se encontró documentación pública de **Relbase, Bsale, Lightspeed o Square** sobre
"desde la caja de quién" sale el pago cuando hay varias cajas físicas abiertas
simultáneamente, ni sobre qué pasa si se anula el pago o la compra **después** de que esa
caja ya cerró **[NO VERIFICADO — hueco de mercado, ver §7]**.

→ **Para nosotros:** Fudo confirma el patrón general (efectivo del pago sale del cajón,
con una descripción de sistema), pero es la excepción entre los relevados en documentarlo
con ese detalle. Ninguno resuelve públicamente "caja de quién" ni "pago que sobrevive al
cierre de la caja que lo originó" — eso queda como decisión propia, cruzando contra
`gestion-cajas.md` como ya señalaba la investigación previa.

---

## 6. Anular

**QuickBooks** documenta que un vendor credit se puede aplicar y des-aplicar, y una
factura pagada de más queda con saldo negativo reversible — no se encontró una página
específica sobre "anular un pago ya aplicado" con sus efectos **[NO VERIFICADO]**.

**Odoo** trata el caso de la **factura corregida a un total menor que lo pagado** como
el mismo mecanismo de vendor credit / reconciliación parcial: el sobrante queda como
saldo a favor reconciliable después (mismo camino que §3) **[SECUNDARIA, inferido del
patrón general de reconciliación, no de una cita textual sobre este caso puntual]**.

No se encontró en ningún sistema relevado una página dedicada a "compra anulada que ya
tenía pagos" — es un hueco de documentación público (ver §7).

→ **Para nosotros:** el mercado resuelve "factura corregida a menos de lo pagado" con el
mismo mecanismo que el saldo a favor (§3), no con un flujo de anulación aparte. "Pago
registrado por error" y "compra anulada con pagos" quedan sin precedente documentado — es
terreno propio.

---

## 7. Permisos

**Odoo** separa el derecho **"Billing"** (crear/gestionar facturas de proveedor y sus
pagos, cobros, notas de crédito) del módulo **"Purchase"** (órdenes de compra) como
grupos de acceso distintos, configurables con reglas de registro más finas
(`account.move`, `account.payment`) para restringir quién ve o crea pagos
**[SECUNDARIA]**
([Odoo: Access rights](https://www.odoo.com/documentation/19.0/applications/general/users/access_rights.html)).
Es decir: en Odoo, **recibir mercadería/cargar la factura y registrar el pago pueden ser
permisos distintos**, aunque conviven en el mismo módulo de Accounting.

**Fudo** dice que desde Roles de Usuarios "se pueden asignar permisos relacionados con
proveedores y cuentas corrientes" **[PRIMARIA]** (mismo artículo que §5), pero no publica
la lista: no se sabe si cargar el gasto y pagar son permisos separados. No se encontró en
Relbase, Bsale, Toast o Square una página pública con esa separación **[NO VERIFICADO]**.

→ **Para nosotros:** Odoo es la única señal pública de que el mercado separa estos dos
permisos. La spec de recepción ya anticipó "el bodeguero recibe y el dueño paga"; si
pagar es un permiso aparte dentro del módulo `Compras` es decisión del owner, no algo
que el mercado imponga.

---

## 8. Realidad chilena

### Ley 21.131 — pago a 30 días

- **Plazo:** 30 días corridos, **contados desde la recepción de la factura**, no desde su
  emisión **[SECUNDARIA]** ([Carey Abogados](https://www.carey.cl/ley-n-21-131-establece-pago-a-treinta-dias),
  resume el texto legal).
- **Vigencia:** entró a regir el 16 de mayo de 2019; hubo un régimen transitorio con
  plazo de 60 días durante los primeros 24 meses, reducido a 30 días desde enero de 2021.
  Organismos públicos, salud y municipios tuvieron plazos escalonados hasta 2021-2022
  **[SECUNDARIA, vía Carey]**.
- **Excepciones:** las partes pueden pactar un plazo mayor, pero el acuerdo debe ser
  **por escrito, firmado por todas las partes**, no puede constituir abuso hacia el
  acreedor, y debe **inscribirse en un registro del Ministerio de Economía dentro de 5
  días hábiles**; un acuerdo que no cumpla estos requisitos **"se tiene por no escrito"**
  **[SECUNDARIA, vía Carey]**.
- **Contado:** la ley no menciona un régimen distinto para facturas pagadas al contado —
  es coherente con que el plazo de 30 días es un **tope**, no una obligación de crédito;
  si se paga antes, no hay conflicto **[NO VERIFICADO, inferido de que el resumen no lo menciona]**.
- **Mora:** intereses corrientes desde el primer día de atraso, más 1% fijo de comisión
  de recupero sobre el saldo **[SECUNDARIA, vía Buk]**.
- **Verificado contra el texto legal (2026-09-28)**, en el
  [texto publicado de la Ley 21.131](http://www.sice.oas.org/SME_CH/CHL/Ley_21131_s.pdf)
  (generado por la BCN) **[PRIMARIA]**: el plazo, la excepción inscrita y el "se tendrán
  por no escritas" dicen lo que resume Carey. Dos cosas que el resumen no traía: una
  cláusula que cuente el plazo "desde una fecha distinta de la recepción de la factura" no
  produce efecto, y si la factura no menciona plazo, la ley lo fija en treinta días corridos
  desde la recepción.

### Campos del DTE para derivar el vencimiento

- `FmaPago`: 1 = contado, 2 = crédito, **3 = sin costo** (entrega gratuita) — default 2 si
  no viene **[PRIMARIA]**.
- `FchVenc`: fecha de vencimiento explícita, formato `AAAA-MM-DD` **[PRIMARIA]**.
- `TermPagoCdg` / `TermPagoGlosa` / `TermPagoDias`: código acordado entre las empresas,
  su glosa y sus días ("5 días desde la entrega de mercaderías") **[PRIMARIA]**.
- `MntPagos`: hasta 30 pagos programados, con `FchPago` y `MntPago` cada uno
  **[PRIMARIA]**.
- `FchVenc` es condicional en la factura; los términos y `MntPagos` son opcionales
  **[PRIMARIA]** (leyenda de obligatoriedad del mismo PDF).

→ **Para nosotros:** `FchVenc` del XML es la señal más fuerte cuando viene; el lector de
XML que ya está en main no lo lee todavía (§1). `FmaPago=1` (contado) es la señal para el gesto "¿la pagaste ya?" que ya
decidió el owner. La ley 21.131 da el **tope legal** (30 días desde la recepción) que
podría usarse como default cuando no hay `FchVenc` ni plazo configurado por proveedor —
eso es diseño, no algo que el mercado imponga.

---

## Lo que el mercado NO resuelve

- **Desde qué caja sale un pago a proveedor cuando hay varias cajas físicas abiertas a la
  vez**, y **qué pasa si se anula el pago o la compra después de que esa caja cerró.**
  Ningún sistema relevado (Fudo incluido) lo documenta públicamente.
- **Compra anulada que ya tenía pagos registrados** — ningún sistema tiene una página
  dedicada a este flujo; el mecanismo más cercano (saldo a favor / vendor credit) resuelve
  el caso "factura corregida a menos", no la anulación completa de la compra.
- **Permisos separados para "cargar factura" vs. "pagar a proveedor"** — solo Odoo lo deja
  ver con claridad; el resto de los sistemas relevados (todos con público más chico que
  Odoo) no publica su matriz de permisos.
- **Reglas de aplicación automática de un pago contra varias facturas** (FIFO u otra) —
  todos los sistemas relevados dejan la elección al usuario; no se encontró un sistema que
  documente una regla automática obligatoria.

---

## Fuentes

1. Odoo — [Payment terms and installment plans (19.0)](https://www.odoo.com/documentation/19.0/applications/finance/accounting/customer_invoices/payment_terms.html)
2. Odoo — [Payments (19.0)](https://www.odoo.com/documentation/19.0/applications/finance/accounting/payments.html)
3. Odoo — [Access rights (19.0)](https://www.odoo.com/documentation/19.0/applications/general/users/access_rights.html)
4. QuickBooks — [Applying credits against vendor bills](https://quickbooks.intuit.com/learn-support/en-us/payments/applying-credits-against-vendor-bills/00/969057)
5. QuickBooks — [Vendor overpayment / apply to future bills](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/i-overpaid-a-vendor-s-invoice-how-do-i-record-the-actual/00/1421855)
6. Toast — [Cash drawer POS operations](https://doc.toasttab.com/doc/platformguide/adminCashDrawerPOSOperations.html)
7. Square — [Cash Management (comunidad)](https://community.squareup.com/t5/Payments-Troubleshooting/How-to-pay-out-vendors-from-the-Cash-Register-using-Square-s/m-p/819533)
8. Fudo — [Cuentas corrientes de proveedores](https://soporte.fu.do/es/articles/11730969-cuentas-corrientes-de-proveedores)
9. Relbase — [Compras](https://ayuda.relbase.cl/compras)
10. Relbase — [Pagar documentos de forma masiva en Módulo de Pago de Proveedores](https://ayuda.relbase.cl/pagar-documentos-de-forma-masiva-en-m%C3%B3dulo-de-pago-de-proveedores)
11. Colppy — [Pagos a cuenta en cuenta corriente — Proveedores](https://intercom.help/Colppy/es/articles/1263184-pagos-a-cuenta-en-cuenta-corriente-proveedores)
12. Bill.com — [What is an Aging Report?](https://www.bill.com/learning/aging-report)
13. AccountingTools — [Accounts payable aging report](https://www.accountingtools.com/articles/the-accounts-payable-aging-report.html)
14. SII — [Formato DTE 2026-02](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf)
15. facturacion.cl — [Formato de archivo plano para facturación electrónica](https://www.facturacion.cl/manualintegracion/archivofacturaelectronica.php)
16. Carey Abogados — [Ley N° 21.131 establece pago a treinta días](https://www.carey.cl/ley-n-21-131-establece-pago-a-treinta-dias)
17. Buk — [Ley de Pago a 30 Días: qué es y cómo funciona](https://www.buk.cl/novedades/finanzas/ley-pago-30-dias-chile) (mora e intereses)
