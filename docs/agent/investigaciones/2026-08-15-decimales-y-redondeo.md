# Decimales, redondeo y unidades de cuenta — investigación financiera

**Fecha:** 2026-08-15
**Estado:** 🔎 Investigación cerrada — **insumo, no diseño**. No se tocó código.
**Entrada del backlog:** `docs/agent/pendientes.md` → §6 "Proyectos que van solos" →
*"🔵 Decimales, redondeo y unidades de cuenta"*.
**Tema en cola detrás de este:** fechas y zonas horarias (decisión del owner).

> ⛔ **Esta investigación NO es de mercado de restaurantes.** Corrección explícita del
> owner: el tema es **financiero en general**. Cómo lo hace un POS es un insumo más, no la
> fuente. Por eso las fuentes primarias acá son ISO, bancos centrales, autoridades
> tributarias, redes de pago y normas contables — no competidores.

> ⚠️ **Regla del cruce, con el matiz propio de este tema**
> (`docs/agent/investigacion-mercado.md`): lo que trae la investigación es insumo para
> adaptar, **nunca verdad a copiar** — salvo lo que es norma. **Una regla tributaria o una
> restricción de red de pago no se "adapta": se cumple o se incumple.** Lo adaptable es el
> diseño alrededor, no los decimales que ISO 4217 le asigna al peso.
> Por eso todo hallazgo va etiquetado: **[NORMA]** se cumple · **[PRÁCTICA]** se adapta ·
> **[INFERENCIA]** es lectura, no fuente.

## Cómo se corrió

Seis lentes en paralelo, **ciegas entre sí**, cada una con una sola pregunta y con la lista
de lo que el proyecto ya tiene resuelto (para no gastar cupo redescubriéndolo):

| # | Lente | Qué contestaba |
|---|---|---|
| 1 | ISO 4217 / minor unit | ¿cuántos decimales tiene una moneda, y quién lo dice? |
| 2 | Redes y pasarelas de pago | ¿cómo viaja un monto hasta el cobro? |
| 3 | Patrón `Money` y asignación | ¿cómo se representa y se reparte plata? |
| 4 | Autoridades tributarias | ¿qué impone la ley sobre redondear? |
| 5 | Unidades indexadas (UF/UVR/UI/UDI) | ¿qué es la UF y cuándo se congela? |
| 6 | ERP y normas contables | ¿cómo se modelan monedas y tasas con fecha? |

Las convergencias entre lentes ciegas se marcan ⭐ — es la señal más fuerte del método.

---

## 1. Lo que es NORMA: se cumple, no se adapta

**ISO 4217 no dice absolutamente nada sobre redondeo.** Define el código y, para las
monedas con subunidad, el **minor unit** — cuántos decimales tiene. Nada más. *Cuántos
decimales tiene la moneda* y *cómo se redondea al llegar ahí* son dos preguntas
independientes, y el estándar solo contesta la primera. La segunda es enteramente del
sistema.
→ Fuente: [ISO 4217](https://www.iso.org/standard/64758.html) ·
[SIX Group, Maintenance Agency](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html)

**El monto viaja al cobro como entero en unidades mínimas.** ISO 8583 lo expresa en el
campo **DE4** (`n12`: doce dígitos, **sin punto decimal**); dónde va la coma lo aporta el
código de moneda, fuera del campo. Stripe, Adyen y Worldpay replican el modelo con enteros.
→ [ISO 8583](https://en.wikipedia.org/wiki/ISO_8583) ·
[Stripe currencies](https://docs.stripe.com/currencies) ·
[Adyen currency codes](https://docs.adyen.com/development-resources/currency-codes)

**Transbank tratando CLP como entero es comportamiento documentado, no un bug.** Textual de
la doc oficial: *"Formato número entero para transacciones en peso y decimal para
transacciones en dólares"*. El arreglo va en el redondeo **previo** a la llamada; nunca en
el gateway.
→ [Transbank Developers](https://github.com/TransbankDevelopers/transbank-developers-docs/blob/master/documentacion/webpay/README.md)

**El SII permite emitir un DTE en UF, pero exige el total en pesos enteros.** Textual:
*"el Total del DTE … representa el Monto Total del DTE en pesos chilenos, en notación
decimal sin decimales"*, con el bloque `<OtraMoneda><TpoMoneda>…<MntTotOtrMnda>` para
reportar el monto en la otra unidad. El documento fiscal lleva **dos montos simultáneos**.
→ [SII, Formato DTE v2.5](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf)

**El redondeo de efectivo NO toca el impuesto ni el documento.** Chile, Ley 20.956 +
Decreto 1.266, artículos 1° y 5°, textual: *"Esta operación no generará efecto tributario
alguno y no deberán modificarse los documentos tributarios"*. Canadá dice lo mismo al
retirar el centavo (el redondeo se aplica **solo al total en efectivo, después** de
calculado el impuesto; las transacciones electrónicas no se redondean), y Argentina
(Ley 25.954) resuelve la diferencia siempre a favor del consumidor.
⭐ **Tres jurisdicciones independientes, misma regla.** El redondeo de efectivo es una
diferencia de caja separada, jamás un ajuste de la venta.
→ [Decreto 1.266](https://www.tributariolaboral.cl/610/w3-article-116049.html) ·
[Canadá, retiro del centavo](https://www.canada.ca/en/revenue-agency/programs/about-canada-revenue-agency-cra/federal-government-budgets/archived-budget-2012/archived-eliminating-penny-canada-s-coinage-system.html) ·
[Ley 25.954](https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=101627)

**La moneda funcional se determina por hechos, no se elige.** IAS 21: *"the currency of the
primary economic environment in which the entity operates"*.
✅ El proyecto **ya lo cumple**: la moneda oficial sale del país, no la elige el tenant.
→ [IAS 21](https://www.ifrs.org/issued-standards/list-of-standards/ias-21-the-effects-of-changes-in-foreign-exchange-rates/)

**Half-even NO es el estándar financiero.** Es el default de IEEE 754 y una preferencia
técnica anti-sesgo, pero las normas que **sí** fijan un modo exigen **half-up**: el
Reglamento (CE) 1103/97 art. 5 para la conversión al euro, y el IRS para declaraciones.
✅ Respalda tener `modo_redondeo` configurable en vez de forzar banker's rounding.
→ [Reglamento 1103/97](https://eur-lex.europa.eu/eli/reg/1997/1103/oj/eng)

---

## 2. ⭐ El hallazgo convergente: hay CUATRO precisiones distintas, y no coinciden

Tres lentes ciegas llegaron a la misma pared por caminos distintos. **"¿Cuántos decimales
tiene esta moneda?" no tiene una respuesta: tiene cuatro, y difieren.**

| Precisión | Fuente autoritativa | Gobierna | Evidencia |
|---|---|---|---|
| **Minor unit ISO 4217** | SIX Group | lo contractual, lo que se debe | Lente 1 |
| **CLDR** | Unicode | **mostrar** al usuario | Lente 1 — AFN: 2 en ISO, **0** en CLDR |
| **La del gateway** | cada pasarela | **cobrar** | Lente 2 — Adyen declara que su tabla *"toma precedencia"* sobre ISO 4217 |
| **La de la tasa publicada** | el banco central | convertir | Lente 5 — la UVR se publica con **4** pero su código COU tiene minor unit **2** |

Y adentro de la del gateway hay una quinta grieta: **Stripe trata la misma moneda distinto
según el flujo** — HUF y TWD tienen reglas distintas en *charge* que en *payout*; ISK y UGX
*"can't charge fractions"*, y en UGX redondea al múltiplo de 100 **acreditando la diferencia
al balance del cliente**.

👉 **Consecuencia dura:** `moneda.decimales` es una sola columna y no puede contestar cuatro
preguntas. El diseño va a tener que decidir cuál de las cuatro representa y de dónde salen
las otras.

### Y el minor unit tampoco es el redondeo de efectivo

El caso que lo prueba es el franco suizo: minor unit **2**, pero la moneda física más chica
es de **5 rappen**. CLDR lo modela con un atributo **separado** (`digits=2` +
`cashRounding=5`, y también `cashDigits`). Son dos datos distintos; el proyecto tiene uno.
→ [CLDR `supplementalData.xml`](https://github.com/unicode-org/cldr/blob/main/common/supplemental/supplementalData.xml)

### Lo que rompe un diseño que asuma "0 o 2 decimales"

- **7 monedas con 3 decimales**: BHD, IQD, JOD, KWD, LYD, OMR, TND (→ ×1000; ejemplo textual
  de Adyen: *"BHD 10 → 10000"*). El sistema hoy no tiene ninguna.
- **PayPal las excluye enteras** de su tabla de monedas soportadas. Un gateway global no
  resuelve el problema: lo evita. ⚠️ *"Funciona con todas las monedas"* no es una promesa
  sostenible contra un gateway real.
- **MGA y MRU se dividen en 5, no en 100** — las dos únicas vigentes con base no decimal.
  Una columna `decimales INTEGER` no las representa.
- **XAU/XAG/XPD/XPT** (metales, una onza troy) tienen minor unit **N.A.**; **XXX** significa
  literalmente *"transacción sin moneda"*.
- **El valor cambia**: ISK pasó a 0 decimales cuando el aurar dejó de circular. SIX publica
  enmiendas numeradas. Un `decimales` copiado a mano es un snapshot que envejece sin avisar.

---

## 3. La UF no es "una moneda rara": es una unidad de cuenta, y tiene código ISO

La distinción tiene nombre en la literatura financiera: **unit of account** vs **means of
settlement**. La unidad indexada **denomina y cotiza** la obligación; **nunca es el medio en
que se liquida**. El pago se ejecuta siempre en moneda de curso legal.

| Unidad | País | Emisor | Frecuencia | Decimales publicados | ISO 4217 |
|---|---|---|---|---|---|
| **UF** | Chile | Banco Central | diaria, ciclo día 10 → día 9 interpolado | 4 | **CLF (990)** |
| **UVR** | Colombia | Banco de la República (mandato Corte Constitucional, C-955/2000) | diaria | 4 | **COU** |
| **UI** | Uruguay | INE | diaria | 2 | **UYI** |
| **UDI** | México | Banxico | diaria | no confirmado | **MXV (979)** |
| **UTM** | Chile | SII | **mensual** | — | **ninguno** |

Tres cosas que salen de acá:

**⛔ La UTM es otra clase de cosa.** Mensual, para multas y tramos tributarios, sin código
ISO, no sirve para cotizar una venta. **No va en la misma tabla** que las cuatro de arriba.

**⛔ No vale "unidad indexada ⇒ 4 decimales".** Los minor units de sus códigos difieren entre
sí: UYI=0, COU/MXV=2, CLF/UYW=4. Y ninguno coincide con los decimales con que se **publica**
el valor (§2).

**✅ El valor se conoce por adelantado.** La UF cubre todo el ciclo 10→9 publicado al inicio;
la UVR se publica por boletines que cubren un período futuro completo. No es *"la tasa de
hoy"*: es **una tasa con vigencia conocida de antemano**, que es algo que un modelo puede
representar mejor que un valor que se pisa.

**Precedente de cómo el SII resuelve un umbral en UF:** la Resolución 44/2025 fija el umbral
de 135 UF **en pesos una sola vez al año** (valor de la UF al 31 de diciembre anterior), no
lo recalcula venta a venta.
→ [Resolución SII 44/2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso44.pdf)

⚠️ **Sin confirmar:** qué valor de UF aplica a una factura —emisión, vencimiento o pago—
*"depende del contrato o la norma aplicable"*, y la diferencia posterior sería un **resultado
financiero (reajuste)** que no modifica el IVA ya determinado. La lente no encontró la
circular del SII que lo fije; la fuente es secundaria. **Queda como hueco, no como hallazgo.**

---

## 4. Tasas con fecha: los cuatro ERP hacen lo mismo, y ninguno hace lo que hacemos

| Sistema | Entidad de tasas | Clave |
|---|---|---|
| SAP | `TCURR` | par de monedas + **tipo de tasa** (M/B/G) + `GDATU` (vigencia) |
| Odoo | `res.currency.rate` | único por **(fecha, moneda, empresa)** |
| Oracle GL | `GL_DAILY_RATES` | par + `CONVERSION_TYPE` + `CONVERSION_DATE` |
| NetSuite | diaria + **consolidada** | par + período + subsidiaria + tipo (Current/Average/Historical) |

**Los cuatro versionan por fecha**, porque IAS 21 exige la tasa **de la fecha de la
transacción** para el reconocimiento inicial — no "la vigente ahora".

**El tipo de tasa es una dimensión propia** en los cuatro (compra/venta/promedio/contable).

**Qué hacer cuando falta la tasa de un día** (fin de semana, feriado) es una pregunta que
los cuatro contestan explícitamente: SAP **bloquea** (*"Exchange Rate X/Y on date … Missing"*),
Odoo hace **backward-search** al día anterior más cercano.

**La precisión de la TASA es un problema separado y anterior** al redondeo del monto. SAP
topa `TCURR.UKURS` en **5 decimales** y ofrece cotización indirecta para pares de magnitud
extrema; en Odoo los usuarios reportan necesitar **hasta 9** para pares como USD/CRC.

**Un documento posteado NUNCA se recalcula.** Confirmado en SAP y en Odoo: si la tasa estaba
mal cargada, se **reversa y se repone** (o se hace un asiento de valuación), no se muta el
pasado.

**La diferencia de cambio es un asiento obligatorio con cuenta dedicada** (Odoo exige
configurar journal + cuenta de ganancia + cuenta de pérdida), no un residuo que se absorbe
en silencio.

---

## 5. Qué se redondea y qué no — el criterio del owner tiene respaldo

El owner sostiene: *"los redondeos son para montos; hay cosas que no se deben redondear con
la configuración"*. Dos prácticas independientes lo confirman:

- **Zuora** (SaaS de facturación) **no redondea el precio unitario** aunque tenga más
  decimales que la moneda (`$3.1235/GB` se guarda y calcula tal cual); solo redondea el
  *extended price*.
  → [Zuora rounding](https://docs.zuora.com/en/basics/about-zuora/rounding-and-precision/data-type-rounding-rules)
- **El combustible** es el mismo caso en el mundo físico y regulado: precios en milésimas de
  centavo, legales desde la Coinage Act de 1792.

👉 La lectura consistente: **el precio unitario no es un `Money`, es una tasa** — dinero por
unidad de otra cosa. Se convierte en monto recién al multiplicarse por una cantidad.
⚠️ Ninguna fuente lo declara como principio nombrado; son dos prácticas convergentes.

**Redondear una sola vez al final, no en cada paso.** El SAT mexicano lo instruye
explícitamente (sumar a hasta 6 decimales y redondear una sola vez al total); el IRS
también. El contraejemplo histórico es el **Vancouver Stock Exchange**: `floor()` en cada
paso le comió ~50% del valor al índice en 22 meses.

---

## 6. La pregunta madre: ¿por línea o solo el total? — no hay respuesta universal

**No existe un método único, y eso es norma.** El TJUE lo falló dos veces:

- **C‑484/06 (*Ahold*, 2008)**: *"it is for Member States to decide on the rules and methods
  of rounding amounts of value added tax"*, y el Derecho comunitario *"entails no specific
  obligation for Member States to permit taxable persons to round down per item"*.
- **C‑302/07 (*Wetherspoon*, 2009)** lo confirma: el método es decisión nacional, pero debe
  aplicarse con igualdad de trato, sin distorsionar la competencia.

→ [C‑484/06](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A62006CJ0484)

Y lo que cada país decidió **sí difiere**:

| País | Regla |
|---|---|
| **Reino Unido** (HMRC) | Por **línea** (2 decimales) es la regla general. Redondear el total es una *concesión*, **explícitamente inapropiada para minoristas** |
| **México** (SAT, Anexo 20) | Sumar líneas a **hasta 6 decimales** y redondear **una sola vez al total** |
| **Colombia** (DIAN) | **half-to-even** (NTC 3711), con tolerancias de ±$5 en IVA y ±2.00 en montos |
| **Japón** (NTA) | Una sola vez **por tasa de impuesto, por factura**. Método a elección — pero **exige consistencia** |
| **Chile** (SII) | Montos **enteros en CLP** en cada campo de línea y de total. **No fija el algoritmo** |

⭐ Nótese que UK y México son **opuestos**: uno obliga por línea, el otro obliga al total.
Un sistema multi-país no puede elegir uno y llamarlo "el correcto".

**Y hay un campo estándar para la diferencia.** UBL / EN 16931 define
**`cbc:PayableRoundingAmount`** (BT‑114), con la regla **BR‑CO‑16**:
`Importe a pagar = Total con IVA − Importe pagado + Importe de redondeo`. Colombia lo
reutiliza. **El problema está reconocido oficialmente.**
→ [Peppol BIS, PayableRoundingAmount](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cac-LegalMonetaryTotal/cbc-PayableRoundingAmount/)

⚠️ **Pero el DTE chileno no parece tenerlo**, y además la normativa de 2017 dice que el
ajuste **no puede aplicarse como un descuento que afecte la base del IVA**. O sea: en Chile
la diferencia no tiene dónde ir dentro del documento.

---

## 7. Cruce contra el código — qué sobrevive

### ✅ Lo que ya está bien y tiene respaldo (no tocar)

| Lo que hace el proyecto | Qué lo respalda |
|---|---|
| Moneda oficial **derivada del país**, no elegida | IAS 21 (la funcional se determina por hechos) |
| **Congela `tasa_cambio` por línea** de venta | SAP y Odoo: un documento posteado nunca se recalcula |
| `modo_redondeo` **configurable** en vez de half-even fijo | Reglamento CE 1103/97 y el IRS exigen half-up, no half-even |
| `Decimal.js` sobre `NUMERIC` | El argumento del entero es contra el **binario**, no contra el decimal exacto. TC39 propone `Decimal` nativo usando **dinero** como caso motivador |
| `redondear()` aplicado **solo a montos** (3 usos, `calculo-precios.engine.ts:453,520,581`) | Zuora y el combustible: el precio unitario es una tasa, no un monto |
| Cantidades con escala propia (*"precisión de stock"*), fuera de `modo_redondeo` | Misma separación monto-vs-cantidad |

### ⭐ Lo que el proyecto ya resolvió sin ponerle nombre

**El módulo de propinas tiene el enfoque financiero completo, en chico.** Medido:

1. **Monto en unidades mínimas enteras** — `mayores-restos.ts:41-44`:
   `const factor = new Decimal(10).pow(decimales)`, y el monto se lleva a unidades enteras
   antes de repartir. Es exactamente el `Money` del patrón, para el cálculo.
2. **Asignación por mayores restos** — nombre formal del problema: **apportionment**; el
   método es **Hamilton / Hare-Niemeyer**. Garantía: *nunca viola la cuota*.
3. **Los decimales de la moneda se CONGELAN en el documento** —
   `liquidacion-propinas.entity.ts:57`, columna `decimales_moneda smallint`, al lado de
   `moneda_id` y `configuracion_version`.

👉 El precedente de *"congelar los decimales de la moneda en el comprobante"* **ya existe en
este repo**. La decisión pendiente no es inventarlo: es si se generaliza a ventas y pagos, o
si hay razón para que propinas sea la excepción.

⚠️ **Un matiz, verificado abriendo el archivo:** decir que mayores restos "no tiene sesgo de
orden" sería falso. `mayores-restos.ts:63-69` desempata por `id.localeCompare` — ante restos
iguales gana el id alfabéticamente menor. Lo que gana no es ausencia de sesgo: es
**determinismo auditable**. Y el método tiene un defecto conocido y demostrado, la **paradoja
de Alabama** (subir el total puede bajar lo que recibe alguien). No hay método sin defecto —
es un teorema, no una omisión del diseño.

### ⚠️ Lo que la investigación confirma que falta

| Hueco | Qué lo dice |
|---|---|
| **El momento "cobrable" no tiene dueño** | ISO 8583 y todas las APIs: el monto viaja entero en unidades mínimas. Hoy la pasarela **rechaza** en vez de que el sistema cuantice antes |
| **`moneda.decimales` no tiene consumidor fuera de propinas** | Medido: solo el seeder que lo carga, la entidad y el endpoint que lo lista |
| **La escala 4 está escrita a mano en 97 sitios de 17 archivos** | Medido. `ESCALA_PERSISTIDA` tiene **3 usos** y los tres viven en un solo archivo |
| **La tabla de tasas no tiene fecha** | Los cuatro ERP versionan por fecha. Sin la columna, el sistema **ni siquiera puede plantear** la pregunta "¿falta la tasa de este día?": siempre hay un valor |
| **Nada distingue una unidad de cuenta de una moneda de cobro** | La UF puede hoy ser moneda oficial de un tenant, y ahí los totales se persistirían en una unidad en la que ninguna pasarela cobra |
| **La precisión de la tasa (6) no fue elegida** | Queda entre el tope de SAP (5) y lo que Odoo necesita para pares extremos (9). No está mal — está sin decidir |

### 🔎 Y una contradicción del seed que salió sola

`seeder.service.ts:213-222` siembra la UF con `codigoNumero: '990'` —que **es** el número
ISO de **CLF**, con minor unit 4, coincidiendo con el `decimales: 4` sembrado— y con
`codigoIso: 'UF'`, que **no es un código ISO**. La fila sabe que es CLF por el número y lo
niega por la letra. CLP (152) y USD (840) están correctos en ambos campos.

---

## 8. Lo que NO está normado — o sea, decisión nuestra

Esta lista vale tanto como la de lo obligatorio, porque es donde el sistema decide:

1. **El algoritmo de redondeo** (half-up / half-down / half-even) cuando el país no lo fija.
   El TJUE lo declara expresamente discreción nacional; Chile no lo fija. Japón es la
   excepción parcial: no impone método, **impone consistencia**.
2. **Por línea vs por total** donde la ley no lo especifica — que es la mayoría de los países
   latinoamericanos relevados, salvo México.
3. **⭐ El descuadre de 1 unidad mínima** al despejar la base imponible desde un precio con
   impuesto incluido. **Ninguna autoridad tributaria relevada lo legisla** — ni SII, ni
   HMRC, ni DIAN, ni SAT, ni NTA. Es el hueco más significativo de la lente fiscal.
   → Anotado en [`docs/DIFERENCIADORES.md`](../../DIFERENCIADORES.md).
4. **Dónde contabilizar la diferencia de redondeo de efectivo** — es práctica contable, no
   norma tributaria, salvo el mandato **negativo** chileno (no puede tocar el documento).
5. **Cómo absorber la diferencia si el DTE chileno no tiene el campo** que UBL sí define.

---

## 9. Preguntas abiertas — para el owner, no para resolver por cuenta propia

⛔ `CLAUDE.md` obliga a detenerse y consultar antes de tocar el motor de cálculo de precios
o el cálculo de impuestos. **Este tema es exactamente eso.** La secuencia es
investigación → cruce → **spec** → plan, y cada paso se confirma.

1. **"Un solo criterio" — ¿un solo criterio o un solo número?** Ningún ERP relevado tiene un
   redondeo global: SAP lo pone en `T001R` por **(empresa, moneda)** y manda la diferencia a
   una cuenta dedicada; Odoo tiene *rounding factor* por moneda **más** una config separada
   de redondeo de impuesto. Un CLP de 0 decimales y un BHD de 3 no comparten regla en
   ninguno. **Lectura que reconcilia:** un solo *criterio* ("el monto se lleva siempre a los
   decimales de su moneda, con el modo configurado") con *valor* variable por moneda.
   ¿Es eso lo que querías decir?
2. **¿Por línea o por total?** No hay respuesta universal y UK y México son opuestos. Como
   sea que se decida, hay que **poder cambiarlo por país**.
3. **¿La UF puede ser moneda oficial de un tenant, o solo unidad de cotización?** El SII
   permite el DTE en UF **con el total en pesos**, así que la respuesta no es un simple no:
   es que el documento necesita dos montos.
4. **¿Se generaliza el patrón de propinas** (unidades mínimas + mayores restos + decimales
   congelados en el documento) a ventas, pagos y notas de crédito?
5. **¿Cuántas tablas de decimales queremos?** Mostrar, cobrar y deber pueden pedir números
   distintos (§2). Una columna no alcanza; tres puede ser sobrediseño para hoy.

---

## 10. Huecos de la investigación — qué NO se pudo confirmar

Declarados por las propias lentes. **No tratar como resuelto lo que está acá.**

- **No se leyó el texto primario de ISO 4217 ni de IAS 21** (ambos detrás de paywall). Todo
  lo etiquetado [NORMA] sobre su contenido viene de resúmenes que los citan.
- **No se bajó el XML oficial de List One de SIX** — solo la página descriptiva.
- **No hay lista completa de divergencias CLDR vs ISO 4217**; AFN es el único caso concreto
  citado, aunque la fuente afirma que hay varias.
- **No se halló la circular del SII** que fije el algoritmo de redondeo, ni la que fije qué
  valor de UF aplica a una factura (emisión / vencimiento / pago).
- **Paraguay (PYG) e Islandia (ISK)**: sin normativa hallada sobre redondeo a entero.
- **No se confirmó** si Colombia o Uruguay permiten facturar en UVR/UI (a la UF sí se le
  confirmó).
- **No se halló API oficial** de banco central para la UF; lo que hay son terceros (CMF,
  mindicador.cl) que redistribuyen el dato.
- **No se halló tratamiento** del caso "porcentajes encadenados" (el motor arrastra reglas
  sobre el acumulado) como categoría propia en la literatura de redondeo.
- **Fuentes débiles marcadas como tales**: el comportamiento decimal de Braintree y los
  porcentajes de *tip tolerance* de Visa/Mastercard salen de agregadores, no de las
  regulaciones primarias.
