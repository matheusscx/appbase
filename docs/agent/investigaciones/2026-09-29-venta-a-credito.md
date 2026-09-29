# Investigación de mercado — venta a crédito, mora, pronto pago, interés simple/compuesto

> Esta investigación **informa, no decide**. Es insumo para cruzar contra el código y
> las tres preguntas del owner (`docs/agent/pendientes.md`, entrada "Los tipos de regla
> por TIEMPO", 2026-08-24) — no reemplaza su decisión. [PRIMARIA] = ley/norma/doc oficial.
> [SECUNDARIA] = blog, foro, ayuda de producto no oficial. Sin marca = inferencia propia,
> señalada explícitamente como tal.

## Resumen (10 líneas)

1. El plazo de crédito en todos los sistemas revisados vive en una entidad **reutilizable**
   ("condición de pago" / "credit terms"), aplicada por defecto al cliente y **sobreescribible
   por venta/documento** — nunca hardcodeada en el motor.
2. Ningún sistema revisado (POS retail/restaurante ni ERP) **recalcula intereses o mora
   dentro del documento original**: el patrón dominante es generar un **documento aparte**
   (finance charge / nota de débito) cuando corresponde cobrar.
3. En Chile, la mora legal (Ley 19.983) **no se documenta con factura ni nota de débito** —
   cambio de criterio del SII en 2020: alcanza un recibo o documento interno. Esto es lo
   opuesto a lo que muchos ERP genéricos hacen (factura/nota de débito aparte).
4. Chile tiene **dos regímenes de mora distintos** que no hay que confundir: mora tributaria
   (deuda con el SII, tasa diaria fijada por resolución) y mora comercial B2B (Ley 19.983,
   ligada a la tasa de interés corriente de la CMF + eventual comisión de cobranza).
5. El interés máximo convencional (TMC, CMF) es un **techo legal**, no una tasa a aplicar:
   cualquier interés pactado sobre la TMC es nulo y se pierde el derecho a cobrar la
   totalidad, no solo el exceso.
6. **No encontré evidencia de que ningún POS/ERP comercial capitalice interés compuesto
   sobre facturas vencidas en la práctica** — todo lo que se documenta es interés simple
   sobre saldo o mora fija. Esto es candidato a diferenciador o a simplificación del
   alcance; el owner debería confirmarlo.
7. El pronto pago (`2/10 net 30`) es universal como concepto contable, pero **se calcula al
   momento del pago**, no al vender — el documento original no se toca, el descuento se
   contabiliza aparte ("fuera de factura") o como nota de crédito si ya se facturó.
8. Toast, Square y Clover (POS retail/restaurante US) **prácticamente no modelan crédito
   B2B ni vencimiento de venta** — su unidad de negocio es venta con pago inmediato. El
   patrón de "cuenta de crédito con vencimiento" aparece en sistemas orientados a B2B/mayor
   (Lightspeed Retail, NetSuite, QuickBooks, y los ERP chilenos).
9. Bsale (Chile) sí modela explícitamente "Crédito a clientes" como forma de pago con
   vencimiento configurable (15/30/60/90 días u otro), pero la fuente es un artículo de
   ayuda, no documentación de su motor — no dice si recalcula o congela.
10. Ningún sistema documentado explica con precisión pública **si el cálculo de mora/interés
    queda congelado en el documento fiscal o se recalcula al cobrar**; es la pregunta que
    menos señal de mercado trae y la que más depende de nuestra regla fiscal (ADR-010).

---

## Pregunta 1 — De dónde sale el plazo de una venta a crédito

**Qué hace cada sistema:**

- **Bsale (Chile)** — modela "Crédito a clientes" como una **forma de pago** de la venta;
  requiere cupo de crédito configurado por cliente y **fecha de vencimiento definida en la
  factura** (ej. 15, 30, 60, 90 días "u otro que necesites"). El plazo por defecto parece
  vivir en el cliente/cupo, pero se fija efectivamente **por documento**.
  [SECUNDARIA] — https://ayuda.bsale.app/support/solutions/articles/151000155995 (fetch
  directo bloqueado por login OAuth de Freshdesk; contenido tomado del snippet indexado por
  el buscador, no de la página completa — **verificar con el owner si puede pegar el texto
  completo, la fuente no es 100% confiable**).

- **Defontana (Chile)** — tiene una entidad explícita **"Condición de pago"** configurable
  en el ERP, que define "cómo tu empresa maneja las transacciones de ventas y compras,
  incluyendo plazos y modalidades de cobro y pago". Es un catálogo reutilizable (se crea
  una vez, se asigna a clientes/documentos), típico patrón "payment terms" de ERP.
  [SECUNDARIA] — https://defontana.atlassian.net/wiki/spaces/CDAV2/pages/20545778 (el
  fetch solo devolvió la navegación, no el cuerpo del artículo; confirmado solo por el
  snippet del buscador).

- **Nubox (Chile)** — describe cuentas por cobrar con "plazos de pago establecidos (30,
  60 o 90 días)" sin detalle de dónde vive el plazo en su modelo de datos.
  [SECUNDARIA] — https://blog.nubox.com/empresas/como-llevar-las-cuentas-por-cobrar

- **Laudus** — no se encontró documentación pública específica sobre condiciones de pago o
  crédito. **Gap de la investigación**, no se puede citar.

- **Lightspeed Retail (R-Series)** — el plazo por defecto se configura **a nivel de cuenta
  de crédito** (Settings → Credit Account Settings): "Due upon receipt", net 15/30/60,
  duración custom hasta 365 días, o día fijo del mes. Es la configuración de la cuenta del
  cliente, y **cada factura individual puede sobreescribirlo**.
  [SECUNDARIA] — https://retail-support.lightspeedhq.com/hc/en-us/articles/20656766930459-Managing-customer-credit-accounts

- **Patrón genérico B2B (2/10 net 30, etc.)** — la industria llama a esto "payment terms" /
  "términos de crédito", una entidad de catálogo (a veces por cliente, a veces por
  transacción) independiente del motor de precios.
  [SECUNDARIA] — https://tipalti.com/resources/learn/210-net-30/ ,
  https://upflow.io/blog/ar-metrics/net-30-terms

**Patrón dominante:** el plazo vive en una **entidad "condición de pago" reutilizable**
(catálogo, asociada normalmente al cliente o a un cupo de crédito) que se aplica como
**default al crear el documento**, pero el documento final guarda su **propio vencimiento
resuelto** (no una referencia viva a la condición, porque la condición puede cambiar
después y el documento ya emitido no debe moverse). Ningún sistema revisado calcula el
plazo "por ítem" o "por línea" — siempre es a nivel de documento/venta completo.

**Trade-offs:**
- *Plazo por cliente (default) + override por venta* (Bsale, Lightspeed): flexible, más
  natural para "el cliente frecuente tiene 30 días pero esta venta puntual es distinta";
  requiere guardar el vencimiento resuelto en la venta, no solo la referencia al cliente.
- *Catálogo de "condiciones de pago" reutilizable* (Defontana, patrón ERP genérico "payment
  terms"): más escalable para tenants con muchas variantes (30/60/90, fin de mes, etc.),
  pero es una entidad más para administrar — sobre-ingeniería si el catálogo real del
  negocio chileno-pyme rara vez pasa de 2-3 variantes.
- Ninguna fuente resolvió explícitamente "¿el vencimiento se fija en días corridos o
  hábiles?" — ver casos borde.

---

## Pregunta 2 — ¿Se calcula al vender (congelado) o al cobrar (sigue la realidad)? ¿Documento aparte o dentro de la venta?

**Qué hace cada sistema:**

- **QuickBooks** — los finance charges (interés/mora) generan **facturas separadas** para el
  cargo por mora; el cargo **no se mete en la factura original**. Alternativa manual: editarla
  y agregar el cargo como línea nueva (pero esto reabre un documento ya emitido, algo que nuestro
  ADR-010 prohibiría para un documento fiscal chileno).
  [SECUNDARIA] — https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/how-do-i-apply-a-finance-charge-or-late-fee/00/1270412

- **NetSuite** — al guardar el registro de "finance charge" se genera **una nueva Invoice**
  para el cliente con el monto del cargo. Documento aparte, mismo patrón que QuickBooks.
  [SECUNDARIA] — https://netsuiteblogs.curiousrubik.com/blog/accounting/know-how-to-calculate-finance-charges-in-netsuite

- **Chile — régimen legal (Ley 19.983, mora B2B):** el criterio del SII **cambió con el
  tiempo** y es la evidencia más fuerte de toda la investigación:
  - Oficio N°1304 (mayo 2019) exigía documentar el interés moratorio con **factura exenta
    o no afecta a IVA**.
    [PRIMARIA/derivado] — resumido en
    https://www.circuloverde.cl/el-sii-indica-que-los-intereses-moratorios-legales-por-atraso-en-el-pago-de-facturas-seran-no-gravados-con-iva-y-se-deben-documentar-con-facturas-exentas-o-no-gravadas/
  - Oficio N°2011 (14-sep-2020) **revirtió ese criterio explícitamente** ("cambio de
    criterio... a consecuencia de un nuevo estudio"): **no se debe emitir ningún documento
    tributario** (ni factura, ni nota de débito, ni exenta) por el interés moratorio del
    art. 2° bis ni por la comisión fija de cobranza del art. 2° ter de la Ley 19.983.
    Basta un **documento interno**: recibo, email, comprobante bancario, etc.
    [PRIMARIA/derivado] — resumido en
    https://www.circuloverde.cl/cambios-en-la-documentacion-del-cobro-de-los-intereses-moratorios-por-atraso-en-el-pago-de-facturas/
    (cita Oficio SII N°2011/2020; ratificado por Oficio N°694 de marzo 2026 para entidades
    públicas). **No pude leer el oficio original del SII directamente** — esto es la lectura
    de una fuente secundaria especializada en tributación (Círculo Verde), consistente en
    dos artículos separados, pero recomiendo verificar el oficio contra sii.cl antes de
    diseñar el flujo fiscal.
  - Fundamento legal: el interés moratorio es de fuente **legal, no convencional** (no es un
    "precio" ni una prestación de servicio) — por eso no gatilla IVA ni documento tributario.
    Civil Code art. 1595 (Chile): un pago parcial se imputa primero a intereses, luego a
    capital. [PRIMARIA — Código Civil, citado por la misma fuente]

- **Mora tributaria (deuda con el SII, NO es lo mismo que mora B2B):** el SII fija por
  resolución la tasa de interés penal para **deudas de impuestos**, ahora diaria en vez de
  mensual (antes 1,5% mensual). Esto es un régimen **distinto** al de la Ley 19.983 y no
  aplica a facturas entre privados — riesgo real de confundirlos al diseñar.
  [PRIMARIA] — https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso205.pdf ,
  https://www.sii.cl/normativa_legislacion/resoluciones/2024/reso133.pdf

- **⚠️ Contradicción sin resolver en las fuentes:** un resultado de búsqueda (Lexology/
  Garrigues, sin fecha verificada) menciona que los intereses moratorios "se deben
  documentar con una Factura de venta y servicio no afecta o exenta de IVA" — esto choca
  con el Oficio 2011/2020 recién citado. Es probable que ese resultado describa el régimen
  **anterior** (Oficio 1304/2019) o un contexto distinto (mora tributaria vs. mora B2B) y
  no lo pude desambiguar con certeza. **No lo tomo como definitivo** — el owner o quien
  diseñe el frente fiscal debería confirmar contra el texto de los oficios en sii.cl antes
  de decidir el formato del "documento aparte".

**Patrón dominante:** el mercado (QuickBooks, NetSuite) resuelve "documento aparte", nunca
reabrir el documento original — coincide con lo que pide ADR-010 (congelar el hecho fiscal).
Pero en Chile, para la mora legal específicamente, **el "documento aparte" ni siquiera es
tributario** — es un registro interno, no una nota de débito. Esto es una diferencia
importante frente a la intuición "recargo = nota de débito" que trae el brief: **la fuente
dice que NO es nota de débito**, al menos para la mora legal de Ley 19.983.

Ninguna fuente resuelve explícitamente "¿el interés se calcula al vender (congelado) o al
cobrar (recalculado)?" en términos de diseño de sistema — es coherente con que, si el cargo
vive en un documento aparte generado en el momento del cobro/vencimiento, la pregunta
"¿se congela al vender?" pierde sentido: **el documento original (boleta/factura) nunca
lleva el interés**, el interés nace después, cuando efectivamente hay mora, en un
registro/documento propio con su propia fecha. Esto es lectura mía (no de una fuente única),
cruzando QuickBooks/NetSuite (documento aparte) + SII (documento aparte no tributario para
la mora legal chilena) — **inferencia, no hecho citado literal, marcarlo así al diseñar**.

**Trade-offs:**
- *Documento aparte* (patrón dominante): respeta ADR-010 sin esfuerzo — el documento fiscal
  original nunca cambia. Requiere un concepto nuevo ("cargo por mora"/"registro de interés")
  que hoy no existe en el sistema.
- *Recalcular dentro de la venta* (lo que insinúan `interes_simple`/`interes_compuesto` hoy,
  aplicando la tasa sobre el total): ningún sistema revisado lo hace así para crédito B2B con
  documento fiscal ya emitido — contradice tanto la práctica de mercado como (para Chile)
  el criterio del SII de que la mora ni siquiera es parte del documento original.

---

## Pregunta 3 — Periodicidad de capitalización del interés compuesto; ¿se usa en la práctica?

**Qué encontré:**

- Contenido genérico de cobranza (no de un POS/ERP específico) afirma: **"es habitual en
  mora comercial usar interés simple sobre el capital original, en lugar de interés
  compuesto."**
  [SECUNDARIA] — https://blog.cobranzaonline.com/post/interes-por-mora

- Fórmula de mora típica encontrada repetidamente: `deuda × tasa diaria × días de mora`
  (interés simple, diario) — coincide con el régimen tributario chileno (tasa penal diaria)
  y con la lógica de "late fee = % mensual aplicado día a día desde el vencimiento" de las
  fuentes genéricas de invoicing (Ramp, Bill.com, Brex).
  [SECUNDARIA] — https://ramp.com/blog/accounts-payable/how-to-calculate-late-fees-on-invoices ,
  https://www.bill.com/blog/late-fees-on-invoices

- **No encontré ningún POS ni ERP (chileno o internacional) que documente públicamente
  capitalización de interés compuesto sobre facturas vencidas** — ni con qué periodicidad
  (diaria/mensual) lo haría. Todo lo que aparece sobre "interés compuesto" en los resultados
  es contenido educativo/financiero genérico (calculadoras de interés compuesto para
  inversión/crédito de consumo), no un caso de producto POS/ERP.

**Patrón dominante (con baja confianza — ausencia de evidencia no es evidencia de
ausencia):** el mercado de POS/ERP para PYME parece resolver la mora con **interés simple
diario o mensual fijo sobre el saldo**, no con capitalización compuesta. La distinción
"simple vs. compuesto" que hoy existe en el motor (`interes_simple` / `interes_compuesto`)
**no tiene un paralelo claro documentado en ningún producto de mercado revisado** — es más
un concepto de matemática financiera de créditos bancarios/inversión que de mora comercial
POS.

**Esto es explícitamente lo que la plantilla de investigación pide marcar:** *"si el
mercado dice que NO lo hace, va a `docs/DIFERENCIADORES.md`"*. Acá el hallazgo es más débil
que eso — no es "el mercado activamente no lo hace" sino "no encontré quién lo hace" —, así
que lo dejo como **señal para que el owner decida**, no como diferenciador confirmado.

**Trade-off si el owner igual quiere mantener interés compuesto como regla separada:**
- Definir la periodicidad de capitalización (diaria/mensual) es indispensable para que
  `interes_compuesto` sea distinto de `interes_simple` en algo más que el nombre — hoy no
  lo es (ver pendientes.md).
- Si el mercado real no lo usa, una alternativa más barata es **no implementar
  `interes_compuesto` como regla separada** y dejar una sola regla de interés (simple,
  diario o mensual) + mora fija — pero esto es una decisión de alcance del owner, no algo
  que la investigación pueda resolver.

---

## Casos borde (mencionados en el brief)

- **Pago parcial antes del vencimiento:** ninguna fuente de POS documenta esto en detalle.
  El patrón contable genérico (Código Civil art. 1595, Chile) dice que un pago se imputa
  primero a intereses y después a capital — relevante si algún día hay intereses ya
  devengados al momento del pago parcial. [PRIMARIA — Código Civil, vía fuente secundaria]
- **Pronto pago con pago parcial:** no encontré ninguna fuente que diga si el descuento por
  pronto pago aplica sobre un pago parcial o solo sobre el pago total antes del plazo. La
  lógica contable de "descuento fuera de factura" (nota de crédito posterior) sugiere que
  normalmente se calcula **sobre lo efectivamente pagado dentro del plazo**, no sobre el
  saldo total — pero esto es inferencia mía, no una cita.
  [SECUNDARIA, base] — https://www.plangeneralcontable.com/?tit=contabilizacion-de-descuento-por-pronto-pago-sobre-ventas-fuera-de-factura
- **Mora sobre saldo vs. sobre total:** las fórmulas genéricas de mora que encontré (Ramp,
  cobranzaonline, publiedictos) calculan siempre `deuda × tasa × días`, donde "deuda" es el
  **saldo pendiente**, no el total original — consistente con que si hubo pago parcial antes
  del vencimiento, la mora debería calcularse sobre el remanente. Ninguna fuente lo dice
  explícitamente para el caso "pago parcial + luego mora", es una lectura razonable de la
  fórmula genérica, no una cita literal de ese escenario compuesto.
- **Días corridos vs. hábiles:** Ley 19.983 especifica **"30 días corridos"** para el plazo
  general de pago de facturas en Chile. [PRIMARIA] —
  https://www.economia.gob.cl/ley-pago-a-30-dias/conoce-la-ley . No encontré fuente que
  discuta días hábiles para mora/vencimiento en ningún POS — es razonable asumir que, si la
  norma madre usa días corridos, el default del sistema debería also (inferencia, no cita).

---

## Realidad chilena (obligatoria)

- **Ley 19.983 / Ley 21.131 — plazo de pago de facturas:** máximo **30 días corridos**
  desde la recepción de la factura, salvo pacto distinto dentro de los márgenes que permite
  la ley (y el registro de acuerdos de plazo excepcional). [PRIMARIA] —
  https://www.bcn.cl/leychile/navegar?idNorma=233421 (Ley 19.983),
  https://www.bcn.cl/leychile/navegar?idNorma=1127890 (Ley 21.131),
  https://www.economia.gob.cl/ley-pago-a-30-dias/conoce-la-ley
- **Mora legal B2B (art. 2° bis/2° ter Ley 19.983):** desde el primer día de atraso corre
  interés (de fuente legal, no convencional) **más una comisión fija de cobranza de 1%** del
  saldo adeudado. [PRIMARIA/derivado] —
  https://www.prieto.cl/entrada-en-vigencia-de-obligacion-pago-de-facturas-en-30-dias/ ,
  https://www.lot.cl/articulo.php?noti=98
- **Tasa Máxima Convencional (TMC), CMF:** techo legal (150% del interés corriente del
  segmento) — cualquier interés pactado por sobre la TMC es **nulo**, y el acreedor pierde
  el derecho a cobrar no solo el exceso sino **la totalidad del interés pactado** (Ley
  18.010). Julio 2026: 41,26% anual para operaciones ≤200 UF. [PRIMARIA] —
  https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-29487.html ,
  https://creditolab.com/cl/noticias/cmf-chile-tmc-julio-2026 (secundaria, sobre datos
  primarios de CMF)
- **Documentación SII de la mora comercial:** no requiere factura ni nota de débito desde
  2020 (Oficio 2011) — ver Pregunta 2. **Esto es lo más importante para el diseño**: si el
  sistema hoy solo sabe emitir boletas/facturas/notas de crédito (documentos DTE), un
  "cargo por mora" **no encaja en ese modelo de documentos** — sería un registro interno
  nuevo, no un tipo de documento tributario nuevo.
- **Mora tributaria (deuda con el SII) ≠ mora B2B:** régimen aparte, tasa diaria fijada por
  resolución del SII, no aplica a facturas entre privados. [PRIMARIA] —
  https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso205.pdf
- **POS locales (Bsale, Defontana, Nubox):** documentan la **UI** de condiciones de
  pago/crédito (qué campo llenar), no el motor de cálculo — coincide con lo que ya advierte
  la plantilla (`docs/agent/investigacion-mercado.md` línea 38-47): en Chile la señal fuerte
  está en la norma, no en la competencia. **Laudus no dio señal alguna** — gap.
- **Pronto pago en Chile:** no encontré ninguna norma chilena que regule el descuento por
  pronto pago (es una condición comercial libre, no legal, a diferencia de la mora que sí
  tiene piso legal). Esto es consistente con el patrón internacional (2/10 net 30 es
  puramente contractual).

---

## Para cruzar con el código

Lo que habría que verificar en el repo antes de diseñar (no lo hice — la tarea era research-only,
sin tocar código):

1. **Modelo de documentos fiscales existente** — ¿el sistema hoy modela boleta/factura/nota
   de crédito como tipos separados? Si la mora chilena legal no requiere documento
   tributario, ¿dónde vive un "registro de mora" — una tabla nueva, o se fuerza a un tipo de
   documento que hoy no aplica? Ver `docs/features/impuestos.md` y ADR-010.
2. **Dónde vive hoy el "cliente" de una venta** (`venta_customer`, según la terminología del
   CLAUDE.md) — ¿tiene ya un lugar natural para guardar un plazo de crédito por defecto
   (cupo, condición de pago), o habría que agregarlo?
3. **Si `movimientos_inventario`/caja/pagos ya modelan "pago parcial imputado primero a
   intereses"** (Código Civil art. 1595) o si los pagos parciales hoy se imputan directo al
   total de la venta sin distinguir componentes — revisar `docs/features/pagos.md` y el
   motor de precios (`docs/features/motor-calculo-precios.md`) antes de decidir si la mora
   se modela como un paso más del motor o como algo aparte.
4. **Confirmar con el owner si `interes_compuesto` sigue teniendo sentido como regla
   separada** dado que no encontré evidencia de mercado que la sustente — si se mantiene,
   la periodicidad de capitalización es una decisión de negocio pura, sin referencia de
   mercado que la informe.
5. **Verificar el Oficio SII N°2011/2020 directamente en sii.cl** antes de decidir el
   formato del "cargo por mora" — la fuente usada acá es secundaria (Círculo Verde), aunque
   consistente en dos artículos independientes y citando número de oficio y fecha.
6. Este documento es investigación pura, **sin diseño todavía** — según
   `docs/agent/investigacion-mercado.md` (paso "Cómo se cierra el loop"), si esto avanza a
   diseño debería moverse a `docs/agent/investigaciones/2026-09-29-credito-mora-interes.md`
   con el cruce contra código hecho, no quedar en el scratchpad.
