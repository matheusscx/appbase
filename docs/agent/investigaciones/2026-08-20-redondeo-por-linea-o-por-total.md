# Redondeo: ¿por línea o por total? — investigación

**Fecha:** 2026-08-20
**Estado:** 🔎 Investigación cerrada — **insumo, no diseño**. No se tocó código.
**Continúa:** [`2026-08-15-decimales-y-redondeo.md`](2026-08-15-decimales-y-redondeo.md) —
esta pasada **no la repite**: ataca los cuatro huecos que aquella dejó abiertos.
**Estado del código medido el mismo día:**
[`2026-08-20-redondeo-de-plata-estado.md`](../../superpowers/specs/2026-08-20-redondeo-de-plata-estado.md)

> ⚠️ **Regla del cruce** (`docs/agent/investigacion-mercado.md`): lo que trae la
> investigación es insumo para adaptar, **nunca verdad a copiar** — salvo lo que es norma.
> Cada hallazgo va etiquetado: **[NORMA]** se cumple · **[PRÁCTICA]** se adapta ·
> **[INFERENCIA]** es lectura, no fuente.

## Cómo se corrió

Cuatro lentes en paralelo, **ciegas entre sí**, cada una con una sola pregunta y con la lista
de lo ya relevado para no gastar cupo redescubriéndolo:

| # | Lente | Qué contestaba |
|---|---|---|
| 1 | Productos reales | ¿por línea o por total, y dónde ponen el descuadre? |
| 2 | Chile / SII | ¿qué campos admiten decimales y qué impone la norma? |
| 3 | Costos vs precios | ¿un costo se redondea como un precio cobrado? |
| 4 | Reparto del descuadre | ¿cómo se reparte, y qué garantiza cada método? |

Las convergencias entre lentes ciegas se marcan ⭐ — es la señal más fuerte del método.

---

## ⛔ Lo primero: una corrección a la investigación anterior

La pasada del 2026-08-15 anotó como **[NORMA]**: *"Chile (SII): montos enteros en CLP en cada
campo de línea y de total"*. **Es falso para dos campos, y la lente 2 lo verificó extrayendo
el texto de los PDF oficiales con `pdftotext`, no de un snippet de buscador:**

| Campo | Lo que dice literalmente la especificación | ¿Decimales? |
|---|---|---|
| `QtyItem` (cantidad) | *"Cantidad del ítem en 12 enteros y 6 decimales"* | **sí, explícito** |
| `PrcItem` (precio unitario) | *"Precio Unitario del Ítem — 12 enteros, 6 decimales"* | **sí, explícito** |
| `MontoItem` (monto de línea) | `(PrcItem × QtyItem) − DescuentoMonto + RecargoMonto`, NUM largo 18 | sin anotación |
| `MntNeto`, `MntExe`, `IVA`, `MntTotal` | NUM largo 18 | sin anotación |

**[INFERENCIA, no [NORMA]]** Que los totales vayan enteros en CLP sale del **silencio** —el
documento anota los decimales donde los permite— más la nota del propio formato: *"Se cambia
formato de numéricos de montos de tal forma que acepten decimales para hacer documentos
completos en moneda diferente de Pesos"*. O sea: los decimales en montos existen para el
bloque `<OtraMoneda>`, no para CLP. Es una inferencia fuerte, pero **es una inferencia**, y
la anterior la vendía como norma literal.

Fuentes verificadas: [Formato DTE v2.5](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) ·
[Formato Boletas v4.0](https://www.sii.cl/factura_electronica/factura_mercado/formato_boletas_elec_202306.pdf)

---

## 1. ⭐ No hay consenso: hay un setting

Dos lentes ciegas (1 y 4) llegaron a lo mismo por caminos distintos. **Los tres modelos
—por línea, por documento, por tasa de impuesto— coexisten como configuración, y ninguno es
"el correcto".**

| Producto | Qué hace | Configurable |
|---|---|---|
| **Stripe** (tax rates manuales) | *line item level* vs *invoice level* | sí, en el Dashboard |
| **Stripe Tax** (automático) | siempre suma-primero-redondea-después | **no**, a propósito |
| **Odoo** | *Round per Line* vs *Round Globally* | sí |
| **Avalara AvaTax** | `RoundingLevelId`: `Line` o `Document` | sí |
| **NetSuite** | `Item Line Level` vs `Transaction Level` (solo nexus VAT/GST) | sí |
| **Zuora** | por línea por default; *invoice-level rounding* en Early Adopter, se pide a soporte | parcial |
| **Toast** | modo de redondeo **por tasa de impuesto** (`HALF_EVEN`, `HALF_UP`, arriba, abajo) | sí |
| **Square** | banker's rounding; impuesto de alcance orden repartido proporcional al subtotal de cada línea | alcance sí, modo no |
| **Lightspeed** | por línea, y por cada tasa dentro de la línea | no documentado |
| **Clover** | por total de la orden, post-impuesto; **no** altera ítems, impuestos ni descuentos | no |
| **SAP** | por línea vía *condition types* del pricing procedure, no un switch | otra forma |

**[PRÁCTICA] Nadie lo deriva de la jurisdicción.** Todos los que ofrecen la opción la exponen
como setting explícito; **ningún producto relevado detecta el país y elige solo**. La única
excepción es Stripe Tax automático, que **fija** la estrategia justamente para ser consistente
entre jurisdicciones sin exponerle la complejidad al usuario.

**[PRÁCTICA] Stripe es el único que publica el trade-off con números.** Misma factura, dos
resultados: `90.91 + 4.55 = 95.46` por línea contra `95.45` al total. SAP y NetSuite
documentan el fenómeno solo como *troubleshooting* de discrepancias, no como decisión de
diseño explicada.

**[PRÁCTICA] Ninguno garantiza Σ(impuesto por línea) = total del documento en todos sus
modos.** El que lo garantiza lo garantiza *por diseño de ese modo*, y el otro modo lo rompe a
propósito. Odoo *Round per Line* la cumple; *Round Globally* no. Clover evita el problema en
vez de resolverlo: saca el redondeo del cálculo de impuesto.

## 2. ⭐ Dónde va el descuadre: la misma forma en dos mercados

Tres estrategias documentadas, sin convergencia entre productos… salvo una coincidencia que
sí es fuerte:

- **Línea de ajuste dedicada.** **Clover** crea un *rounding adjustment* clasificado
  explícitamente como **no-ingreso y no-impuesto**, mostrado como línea aparte justo antes
  del total, y obligatorio en recibos custom. NetSuite usa dos *Discount Items* dedicados
  (posting / nonposting) con límite de tasa. Odoo ofrece *"agregar línea de redondeo"*.
- **Se absorbe en una línea.** NetSuite (Transaction Level) ajusta la línea de **menor
  impacto porcentual**, o la última si empatan. Odoo ofrece *"ajustar la línea de impuesto
  más grande"*.
- **Se reparte proporcionalmente.** Square, según el peso de cada línea en el subtotal.

⭐ **La convergencia:** la práctica contable chilena documentada (Laudus) para el redondeo de
efectivo es un **"ítem no facturable"** dentro del documento — afecta el total a cobrar y la
cuenta de clientes, **no toca neto ni IVA**, y se contabiliza en una cuenta de ajuste propia.
Es **la misma forma** que el *non-revenue, non-tax* de Clover, hallada por una lente que no
sabía de la otra: un proveedor contable chileno y un POS estadounidense llegaron al mismo
objeto. **[PRÁCTICA]**, en los dos casos: no lo manda ninguna norma.

**[NORMA] Y el DTE chileno no tiene ese campo.** La lente buscó las cadenas `"redonde"`,
`"ajuste"` y `"propina"` en el texto completo de las dos especificaciones oficiales:
**cero coincidencias en ambas**. No hay equivalente al `cbc:PayableRoundingAmount` (BT‑114)
de UBL/EN 16931. Combinado con la Circular 44/2017 —el ajuste no puede aplicarse como
descuento que afecte la base del IVA—, la diferencia **no tiene dónde ir dentro del
documento**: tiene que vivir como otra cosa.

## 3. ⭐ El precio unitario es una tasa, no un monto — y ahora tiene respaldo normativo

La pasada anterior lo sostenía con dos prácticas (Zuora y el combustible). Esta lo confirma
por dos caminos ciegos:

**[PRÁCTICA] Cinco de cinco plataformas de billing** revisadas mantienen precisión propia en
la tasa y redondean recién el monto de línea: Zuora (*unit price* nunca se redondea, solo el
*extended price*), Recurly (hasta 9 decimales, *"rounding only the final line item"*),
Chargebee (multi-decimal), Maxio/Chargify (8-10 decimales), Stripe (`unit_amount_decimal`).
La industria le pone nombre a la distinción: **rate vs amount**.

⭐ **Y el SII hace exactamente la misma distinción** (§ corrección de arriba): le da 6
decimales explícitos a `PrcItem` y `QtyItem`, y no anota decimales en los montos. Una lente
buscaba práctica de billing y la otra norma chilena; las dos encontraron el mismo corte.

**El contraejemplo, que pedí a propósito:** **NetSuite ata la precisión del costo promedio al
formato de la moneda** (2 decimales para USD), con *Standard Costing* como excepción explícita
a 7 decimales. Es el caso donde costo y moneda **sí** comparten escala.

**[PRÁCTICA] Y SAP resuelve el mismo problema por otra puerta:** no expande decimales, expande
la **unidad** — `MBEW-PEINH`, el *price unit*, permite definir el precio "por 1000 unidades"
en vez de "por 1". Es una opción de diseño que no estaba sobre la mesa y aplica al caso feo
del proyecto: el costo de un gramo de harina.

**[PRÁCTICA] Odoo con moneda de 0 decimales (VND):** el costo promedio sigue calculando con
decimales y **no** se alinea solo a la moneda; hay que reconfigurar un bucket de precisión
aparte (*Product Price*), separado de la moneda.

**[NORMA] IAS 2 es agnóstica:** define qué compone el costo y permite técnicas de conveniencia
si aproximan al costo real; **no dice nada de decimales ni de modo de redondeo**. Verificado
contra el texto oficial.

## 4. Mayores restos NO es lo que usan los motores de factura

**[PRÁCTICA]** En facturación domina el **redondeo independiente por línea** (o el redondeo
único al documento): Stripe, Avalara, Vertex y Odoo. El reparto por mayores restos aparece en
librerías de `Money` de propósito general para el caso *"repartir un monto único entre N
partes"* — que es el caso de una propina, no el de una venta.

- **`moneyphp/money`**: reparte el resto de a una unidad al ratio con la fracción perdida más
  alta; **garantiza suma exacta**; lanza excepción con ratios negativos; desempata por la
  **posición en el array**, que es un artefacto de implementación y no una regla de negocio.
- **`dinero.js`**: garantiza suma exacta y permite **inyectar** la función de redondeo, o sea
  el criterio de desempate es decisión explícita del llamador.
- **JSR-354 / Moneta**: **no tiene** operador de reparto. El estándar de Java deja el problema
  afuera.
- **Vertex** tiene una feature llamada literalmente *"Line Item Rounding and Apportionment"*:
  el término existe en la industria, el algoritmo está detrás de documentación paga.

**[NORMA] Teorema de imposibilidad de Balinski-Young (1983):** con cuatro o más partes ningún
método de reparto puede cumplir la regla de cuota y estar libre de paradojas (Alabama,
población, nuevo estado) a la vez. **No hay método sin defecto** — elegir método es elegir qué
defecto se prefiere, no evitarlos.

**[PRÁCTICA] Tip pooling:** la regulación (FLSA en EE.UU.) norma **quién** participa del pool,
no cómo se redondean los centavos. La práctica del rubro coincide con lo que el proyecto ya
implementó.

---

## 5. Cruce contra el código — qué sobrevive

### ✅ Lo que ya está bien y ahora tiene más respaldo

| Lo que hace el proyecto | Qué lo respalda |
|---|---|
| `precio_unitario` con decimales propios, redondeado aparte del monto | 5/5 plataformas de billing + `PrcItem` del SII con 6 decimales explícitos |
| Mayores restos **solo** en propinas, con unidades mínimas enteras y desempate determinista | Es el caso correcto (repartir un monto entre N) y coincide con la práctica de tip pooling |
| `modo_redondeo` configurable en vez de banker's fijo | Toast expone cuatro modos; Reglamento CE 1103/97 e IRS exigen half-up |
| Congelar `decimales_moneda` en la liquidación de propinas | Ningún producto relevado lo contradice; es el patrón del documento inmutable |

### ⚠️ Lo que la investigación confirma que falta

| Hueco | Qué lo dice |
|---|---|
| **No existe el eje "nivel de redondeo"** | Tenemos `modo_redondeo` y `escala_calculo`; **línea vs documento no existe** como concepto. Es un setting en 6 de los productos relevados |
| **Los totales en CLP llevan decimales** | Medido en la base: `16957.5000` y `5057.5000` en una moneda de 0 decimales. Contra la inferencia fuerte del formato DTE |
| **El descuadre no tiene dónde ir** | El DTE chileno no tiene campo de ajuste (cero coincidencias, verificado); la forma disponible es un ítem no facturable, que **nuestro modelo no tiene** |
| **La escala de la moneda no participa del cálculo** | `moneda.decimales` solo se usa en propinas |

### 🔻 Lo que se cae del alcance si el owner acepta la evidencia

Si vale el corte **tasa vs monto** —que es lo que dicen 5 de 5 en billing y lo que hace el
propio SII con `PrcItem`—, entonces **cinco de los once sitios del relevamiento no se tocan**:
el CPP, el costo propuesto de receta y de combo, el precio sugerido y la conversión de costo
por unidad. Son tasas, no montos.
⚠️ **Con el contraejemplo sobre la mesa:** NetSuite ata el costo promedio a la moneda, así que
esto **no es unánime**. Es una decisión, no un hecho.

---

## 6. Preguntas abiertas — para el owner

1. **¿El nivel de redondeo (línea vs documento) es configurable, o fijamos uno?** El mercado
   dice setting, y el proyecto ya tiene dónde ponerlo (preferencias financieras por tenant).
   Pero nadie lo deriva del país, y nuestro modelo **sí** deriva la moneda oficial del país —
   hay una asimetría para decidir a propósito, no por inercia.
2. **¿Los costos quedan fuera del alcance?** Cinco de los once sitios dependen de esta
   respuesta.
3. **La línea de ajuste no facturable, ¿se construye ahora o se difiere?** ADR-010 es explícito
   en no construir infraestructura DTE especulativa, y hoy no hay emisión electrónica. Pero el
   redondeo de efectivo **ya ocurre** en una caja real aunque no haya DTE.
4. **¿`escala_calculo` sigue teniendo sentido** si el importe termina yendo a la escala de la
   moneda? Hoy son dos perillas que pueden contradecirse.

## 7. Huecos declarados — no tratar como resuelto lo que está acá

- **No se pudo confirmar qué hace el SII si Σ líneas ≠ `MntTotal`**: el formato define la
  fórmula, no la consecuencia. La distinción "rechazo por esquema vs reparo por contenido"
  sale de un blog de proveedor y de una FAQ sobre el RCV, que es otro proceso.
- **No apareció la circular del SII que fije el algoritmo de redondeo** — segunda pasada que la
  busca y no la encuentra. A esta altura la hipótesis razonable es que no existe.
- **Zuora y Avalara quedaron en fuente secundaria**: `docs.zuora.com` es una SPA que no
  renderiza para el fetch, y el artículo de Avalara sobre Document vs Line devolvió una página
  de búsqueda interna. Lo citado viene de snippets indexados.
- **Toteat y Softland**: sin documentación pública sobre decimales o redondeo. Bsale documenta
  que se configuran "decimales de redondeo" por moneda pero no el algoritmo; Defontana solo la
  ruta de UI. Confirma lo que el proyecto ya había medido: en Chile la señal está en la norma,
  no en la competencia.
- **Fowler `Money.allocate()`**: el criterio de desempate no se verificó contra el texto del
  libro, solo contra fuentes secundarias.
- **Nadie documenta si al agregar una línea se recalcula el reparto entero o solo el delta.**
  Ni Stripe, ni Avalara, ni Vertex, ni las librerías. Hueco real de la industria, no de la
  búsqueda.
- **Ninguna norma exige reproducibilidad del reparto por auditoría**: las librerías la dan como
  efecto colateral de ser puras, no porque un estándar la pida.
- **Propina chilena:** no se halló en fuente primaria si se redondea a peso entero. Sí se
  confirmó que se consigna en la cuenta de consumo, documento distinto de la boleta, y que no
  es base de IVA.
