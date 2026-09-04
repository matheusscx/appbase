# Investigación: facturación electrónica en LatAm — SII, ARCA, DIAN y SAT

> ⛔ **Regla del cruce** ([`../investigacion-mercado.md`](../investigacion-mercado.md)): lo que
> trae la investigación es **insumo para cruzar y adaptar**, nunca verdad a copiar. Con el
> mismo matiz que tuvo la de redondeo: **una norma tributaria no se "adapta"** — se cumple o
> se incumple. Lo adaptable es el diseño alrededor.
>
> **Por qué se corrió** (owner, 2026-09-03): *"la facturación la vamos a dejar para después;
> acá tenemos que investigar SII, DIAN, ARCA y lo que esté MX — no para implementarlas todas
> de una, pero sí para saber cómo hacerlo escalable. Al principio empezamos con Chile, pero
> la estructura tiene que ser escalable en lo posible."*
>
> ⚠️ **No es "cómo lo hacen los POS".** La señal está en la **norma**, igual que en el frente
> de redondeo. Se relevaron autoridades tributarias, no competidores.
>
> 📌 **Esto NO es un diseño y NO habilita implementar nada.** [ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md)
> y el punto *"Lo fiscal va solo"* de `CLAUDE.md` siguen mandando: la regla la pone el owner.

**Nivel de evidencia** — **[PRIMARIA]** = texto de la autoridad, abierto y verificado acá.
**[SECUNDARIA]** = fuentes concordantes que citan la norma, sin abrir el original.
**[NO VERIFICADO]** = se relevó pero no se contrastó contra la norma.

---

## 1. La conclusión, antes de la tabla

Los cuatro países emiten "un documento electrónico con validez fiscal", y ahí termina el
parecido. **Lo que varía no es el formato del documento —eso es un emisor por país y se
resuelve tarde— sino cuatro ejes que tocan el modelo de datos y el flujo de venta.** La
estructura escalable es la que deja esos cuatro ejes abiertos; el resto se puede decidir
cuando entre cada país.

Y hay un quinto hallazgo que no es un eje sino un aviso: **Chile es el más permisivo de los
cuatro**, así que una estructura calcada del chileno es exactamente la que no escala.

---

## 2. Los cuatro ejes que varían

### Eje A — Quién otorga la validez del número

| País | Cómo se numera | Quién da la validez |
|---|---|---|
| **Chile** (SII) | El SII entrega **rangos de folios por adelantado**: el CAF, un XML firmado por el SII, por tipo de documento. Se consumen en orden, sin saltar ni reutilizar | El propio emisor, con el folio que ya tiene |
| **Argentina** (ARCA, ex AFIP) | **Punto de venta** (4-5 dígitos) + numeración correlativa propia por punto de venta | ARCA, **por comprobante**: el **CAE** (14 dígitos), pedido online al emitir |
| **Colombia** (DIAN) | La DIAN autoriza un **rango de numeración** por resolución: prefijo + rango + vigencia | La DIAN valida cada documento; el identificador es el **CUFE** (96 caracteres), derivado del contenido |
| **México** (SAT) | **Nadie autoriza numeración.** Serie y folio son internos y libres | Un **PAC** (tercero obligatorio) timbra y devuelve el **UUID** (folio fiscal) |

📌 **Consecuencia de diseño.** [ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md) ya
dijo *"la PK interna ≠ folio"*. Los cuatro países juntos lo extienden: son **tres cosas
distintas** —serie/punto de emisión, número, e identificador de la autoridad— y ninguna se
deriva de las otras. Un solo campo `folio` no alcanza para México (donde el número es libre y
el que importa es el UUID) ni para Argentina (donde el número no vale nada sin el CAE).

### Eje B — Cuándo ocurre respecto del cobro ⚠️ **el más caro**

| País | Momento | ¿Se puede vender con internet caído? |
|---|---|---|
| **Chile** | **Asincrónico.** El folio ya está en el CAF; se emite y se informa después | **Sí** |
| **Argentina** | **Sincrónico y bloqueante.** Sin CAE el comprobante no tiene validez fiscal | No, salvo régimen de contingencia **[NO VERIFICADO]** |
| **Colombia** | **Validación previa** — la DIAN valida antes de entregarla al comprador | No, salvo contingencia **[NO VERIFICADO]** |
| **México** | **Sincrónico** — el timbrado del PAC es parte de la emisión | No, salvo contingencia **[NO VERIFICADO]** |

⚠️ **Este es el hallazgo que más pesa para "escalable".** Chile es el único de los cuatro
donde el POS puede cobrar primero y emitir después. **Si el flujo de venta se diseña con el
supuesto chileno —"cierro la venta, ya emitiré"—, los otros tres no entran sin rehacerlo**,
porque en ellos la emisión es un paso que puede **fallar** y que ocurre **antes** de darle el
documento al cliente. Eso no es un emisor distinto: es un estado más en la venta.

📌 Lo que la estructura tiene que dejar abierto no es "el formato del XML" sino **que emitir
sea una operación con resultado, que puede quedar pendiente, fallar o reintentarse**.

### Eje C — Qué determina el tipo de documento

En los cuatro el disparador es el receptor, pero **el dato que decide es distinto y sólo en
Chile es un booleano**:

| País | Qué decide | Documentos |
|---|---|---|
| **Chile** | ¿El receptor es contribuyente? | Factura (33) / factura exenta (34) vs **boleta** (39) / boleta exenta (41) |
| **Argentina** | **Matriz**: condición frente al IVA **del emisor × la del receptor** | Letra **A** (RI→RI, discrimina IVA), **B** (RI→consumidor final/monotributista/exento), **C** (monotributista o exento emisor), **E** (exportación) |
| **Colombia** | ¿El comprador se identifica? | **Factura electrónica de venta** vs **documento equivalente electrónico** (tiquete POS) |
| **México** | ¿El cliente pide factura? | CFDI nominativo vs **CFDI global** — uno por **período**, no por ticket |

⚠️ **Dos cosas rompen el modelo actual:**
- `tipos_documento_tributario.customer_requerido` es un **booleano**, y alcanza para Chile.
  En Argentina el tipo sale de una matriz de dos condiciones fiscales, no de "¿hay cliente?".
- En México el documento fiscal **no es por venta**: la factura global agrupa todos los
  tickets no facturados de un período (con periodicidad diaria/semanal/mensual, RFC genérico
  `XAXX010101000`, nombre `PUBLICO EN GENERAL`, régimen 616, uso `S01`). O sea: **la relación
  venta → documento no es 1:1**. Hoy `ventas.tipo_documento_id` la asume 1:1.

### Eje D — Qué datos del receptor hay que congelar ⚠️ **lo único urgente**

| País | Lo que exige, además del nombre |
|---|---|
| **Chile** | RUT + **giro** (para factura) |
| **Argentina** | CUIT + **condición frente al IVA del receptor** — obligatoria por **RG 5616**, con prórrogas sucesivas hasta volverse estrictamente exigible |
| **Colombia** | NIT + **responsabilidades del RUT** (régimen) |
| **México** | RFC + **régimen fiscal** + **código postal del receptor** + **uso del CFDI** |

📌 **Esto es exactamente el punto de ADR-010**: un hecho fiscal no capturado en el momento de
la venta **se pierde para siempre**. Si no se guarda la condición frente al IVA del comprador
argentino cuando compró, después no hay forma de emitir su comprobante — y no es un dato que
se pueda "deducir".

### Eje E — Anular no es lo mismo que acreditar

| País | Cómo se deshace |
|---|---|
| **Chile** | Nota de crédito **61**, referenciando el DTE original |
| **Argentina** | Nota de crédito A/B/C, **con su propio CAE** |
| **Colombia** | Nota crédito con **CUDE**, referenciando el CUFE original |
| **México** | **Dos mecanismos distintos**: (a) **cancelación** del CFDI, con **motivo** obligatorio (`01` con sustitución, `02` sin, `03` no se realizó la operación, `04` operación nominativa en factura global) y, en varios escenarios, **aceptación del receptor**; (b) **CFDI de egreso** relacionado, que es la nota de crédito propiamente dicha |

⚠️ México separa *"esto nunca debió existir"* de *"esto existió y lo devuelvo"*. Nuestro
modelo tiene **una sola forma** (`venta_referencia_id` + tipo NC), y además `ventas.cancelada_el`
por otro lado. El eje "anular vs acreditar" existe en el código pero no está unificado con lo
fiscal.

---

## 3. El impuesto SÍ es un eje — corrección del 2026-09-03

⛔ **Esta sección decía lo contrario y era falsa.** Afirmaba que *"el impuesto no es un eje —
y esa es la buena noticia"*, que el motor absorbe los cuatro países **sin cambio de esquema**,
y que el INC colombiano *"entra como una fila más gracias a ADR-018"*, cerrando con un *"no hay
nada que hacer acá"*. Se escribió mirando **dónde se guarda** el impuesto y no **cómo se
decide cuál corresponde**. Lo destapó el owner preguntando, simplemente, cuáles serían los
impuestos de sistema de AR/CO/MX.

Lo que sigue en pie: `ventas_impuestos` congela por línea el `nombre_regla`, el
`porcentaje_aplicado` y el `valor_aplicado`, así que **guardar** cualquiera de estos impuestos
no requiere migrar nada. Lo que se cae es lo otro: **elegir** cuál aplica.

### Las tasas, por país y por tipo de local

Hoy Chile es **una sola fila** —IVA 19%, `tipo: 'iva'`— y alcanza porque Chile tiene **una**
tasa.

| País | Restaurante | Minimarket / retail |
|---|---|---|
| **Chile** | IVA 19% | IVA 19% |
| **Argentina** | IVA **21%** | 21% general + **10,5%** reducida (varios alimentos básicos) |
| **Colombia** | **INC 8%** — *no es IVA* (impoconsumo, art. 512-1 ET). Excepción: las franquicias facturan IVA 19% | IVA **19%** general, **5%** algunos procesados, y muchos alimentos básicos **excluidos** |
| **México** | IVA **16%** (8% en zona fronteriza) | **0%** alimentos básicos sin industrializar, **16%** preparados |

**[SECUNDARIA]** salvo el artículo 2-A de la Ley del IVA mexicana, que es del SAT.
⚠️ **Ninguna de estas tasas debería sembrarse sin verificarla contra la norma**, con el mismo
criterio que se usó en el frente de redondeo: la cita al lado del valor.

### Los tres problemas de modelo que esto destapa

**1. "El IVA del país" deja de ser un número.** [ADR-018](../../adr/018-iva-derivado-de-la-clasificacion.md)
deriva el IVA de la **clasificación** del ítem en vez de leerlo de `item_impuestos`. Con una
tasa sola eso cierra. Con dos o tres —21/10,5 · 19/5/excluido · 16/0— la clasificación
`afecto | exento` ya no alcanza: hay que saber **qué tasa** le toca a **ese** ítem.

**2. Colombia rompe el significado de la clasificación, no solo el número.** Un restaurante
colombiano **no cobra IVA**: cobra 8% de impoconsumo. En este modelo eso cae como
`tipo: 'otro'`, y entonces **no pasa por el mecanismo derivado**. O sea que `afecto` significa
una cosa en Chile y otra en Colombia, dentro del mismo motor. Y el mismo tenant, si opera bajo
franquicia, vuelve a IVA 19%.

**3. México: el mismo ítem con dos tasas según cómo se venda.** El criterio del art. 2-A no es
el producto sino el **contexto de la venta**: la misma comida va a 0% empaquetada para llevar
y a 16% servida para consumir en el local. Hoy el impuesto cuelga del **ítem**; esto lo pide
colgado de la **línea**.

📌 **Consecuencia para el backlog:** la pregunta *"¿qué porcentaje sembramos?"* está mal
planteada. **El porcentaje es lo fácil**; lo que falta es una decisión de modelo, y es
distinta en cada uno de los tres países. Frente fiscal propio, uno por país.

## 4. El cruce contra lo que ya existe

### Lo que ya está bien elegido y no hay que tocar

| Decisión existente | Por qué aguanta los cuatro países |
|---|---|
| `tipos_documento_tributario` **por país, desde tabla y no enum** | Es exactamente el eje que varía; agregar país es agregar filas |
| `ventas_impuestos` congelado por línea, con nombre y porcentaje | Absorbe **guardar** INC, IEPS y adicionales sin migrar. ⚠️ **Elegir** cuál aplica es otra historia — § 3 |
| ADR-010: **PK ≠ folio** | Correcto; sólo hay que extenderlo a tres identificadores (eje A) |
| `ventas.config_calculo` en `jsonb` | Ya existe el precedente de **congelar el contexto** de una venta |
| `razones_sociales` por tenant (emisor) | La forma es correcta; le faltan campos por país |

### Lo que no alcanza

| Hueco | Eje | Por qué importa |
|---|---|---|
| `venta_customer` tiene nombre/rut/dirección/teléfono/email, y **ninguno** de los campos fiscales de AR/CO/MX | **D** | Es lo único **irrecuperable**: si no se captura en la venta, no se puede emitir después |
| `razones_sociales` no tiene punto de venta (AR), prefijo/resolución (CO), régimen+CP (MX) ni giro (CL) | **A**, **D** | Recuperable —es config del tenant—, pero condiciona el alta |
| `customer_requerido` es booleano | **C** | No expresa la matriz argentina |
| `ventas.tipo_documento_id` asume **una venta = un documento** | **C** | La factura global mexicana agrupa un período |
| No hay dónde guardar folio, serie, CAE/CUFE/UUID, estado de emisión ni fecha de autorización | **A**, **B** | Es lo que ADR-010 difirió a propósito; sigue bien diferido |
| Una sola forma de deshacer (`venta_referencia_id` + NC) | **E** | México separa cancelar de acreditar |
| ⛔ `TIPO_DOCUMENTO_NC_ID` es una **constante hardcodeada de la fila chilena código 61**, usada sin mirar el país | **C** | Ya anotado en [`pendientes.md` § 4](../pendientes.md); un reembolso en un tenant argentino congela hoy un tipo de documento chileno |

---

## 5. Qué sale de acá — y qué explícitamente no

### Lo barato ahora (capturar, no emitir) — sigue la regla de ADR-010

1. **Los campos fiscales del receptor.** Es el único hueco irrecuperable (eje D). No exige
   emisor, ni XML, ni certificado: exige saber **qué campo pide cada país** y tener dónde
   ponerlo.
2. **Los campos fiscales del emisor** en `razones_sociales`.
3. **No cerrar la puerta** a que una venta se relacione con un documento que no es suyo solo
   (eje C, factura global) ni a que emitir sea una operación con estado (eje B).

### Lo que NO hay que construir — y esto es tan importante como lo anterior

XML, firma digital, gestión de CAF, integración con PAC, web services de ARCA o DIAN, folios,
y **los tipos de documento de AR/CO/MX en el seeder**. Sigue siendo re-trabajo casi seguro
(ADR-010, *"Diferir explícitamente"*), y qué documentos emite un local en cada país **no es
algo que un agente deba inventar desde un seeder**.

### Lo que la investigación no contesta porque es del owner

1. **¿El producto va a emitir de verdad fuera de Chile, o AR/CO/MX son catálogo demo?** De
   esto depende todo lo demás: si son demo, alcanza con cortar la NC fuera de Chile; si no,
   los campos del eje D hay que capturarlos desde ya.
2. **La nota de crédito chilena hardcodeada** — la pregunta ya abierta en `pendientes.md` § 4.
3. **¿Integración propia o vía proveedor?** En México el PAC es **obligatorio**, así que la
   estructura tiene que admitir emisión delegada aunque en Chile se emita con certificado
   propio. En Chile y Colombia hay certificación previa con set de pruebas (Colombia: 60
   facturas, 20 notas crédito, 20 notas débito).

---

## 6. Fuentes

**Chile (SII)** — [instructivo técnico factura electrónica](https://www.sii.cl/factura_electronica/factura_mercado/instructivo_emision.pdf) ·
[proceso de certificación](https://www.sii.cl/factura_electronica/factura_mercado/proceso_certificacion.htm) ·
[postulación y autorización](https://www.sii.cl/factura_electronica/factura_mercado/proc_postulacion.htm) ·
[el RVD dejó de ser obligatorio (ago-2022)](https://www.sii.cl/noticias/2022/160622noti01rp.htm) · **[SECUNDARIA]** salvo lo indicado

**Argentina (ARCA/AFIP)** — [RG 3561, texto actualizado en InfoLEG](https://servicios.infoleg.gob.ar/infolegInternet/anexos/220000-224999/223930/texact.htm) **[PRIMARIA]** ·
[RG 4292/2018](https://www.boletinoficial.gob.ar/detalleAviso/primera/189309/20180803) ·
[monotributo y facturación](https://www.afip.gob.ar/monotributo/ayuda/facturacion.asp) ·
[prórrogas de RG 5616 — condición IVA del receptor](https://gosocket.net/centro-de-recursos/arca-prorroga-la-obligatoriedad-del-campo-de-condicion-frente-al-iva-del-receptor/)

⚠️ **Corrección hecha en esta misma pasada.** Se entró creyendo que un restaurante argentino
está **obligado** a usar controlador fiscal (hardware certificado), lo que habría sacado al
POS del rol de emisor. Abierto el texto de RG 3561 en InfoLEG, **el artículo 3° —el que
listaba las actividades obligadas— está derogado por RG 4292/2018**, y el régimen vigente
(RG 4290/4291/4292) deja **optar** entre factura electrónica y controlador fiscal. El dato
equivocado venía de fuentes secundarias que citan el texto viejo.

**Colombia (DIAN)** — [requerimientos para ser facturador electrónico](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/requerimientos-para-ser-facturador-electronico/) ·
[registro y habilitación](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/proceso-de-registro-y-habilitacion-como-facturador-electronico/) ·
[Resolución 000165 de 2023](https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000165%20de%2001-11-2023.pdf) ·
[INC en restaurantes](https://blog.alegra.com/colombia/inc-o-iva-en-restaurantes-colombia/)

**México (SAT)** — [artículo 2-A de la Ley del IVA](https://wwwmatnp.sat.gob.mx/articulo/06071/articulo-2-a) (tasa 0% vs 16% según el contexto de la venta) ·
[guía de llenado del CFDI global 4.0](http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/GuiallenadoCFDIglobal311221.pdf)
(⚠️ el host rechazó la conexión al intentar abrirlo el 2026-09-03; queda **[NO VERIFICADO]**) ·
[motivos de cancelación](https://www.facturapi.io/blog/cfdi-substitution-reason-01-cancellation) ·
[RFC genérico](https://rfcgenerico.com.mx/rfc-generico-nacional/)

---

## 7. Relacionados

- [ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md) — congelar el hecho fiscal, diferir la emisión
- [ADR-018](../../adr/018-iva-derivado-de-la-clasificacion.md) — el IVA se deriva, los demás se leen
- [`pendientes.md` § 4](../pendientes.md) — la NC chilena en tenants de otros países
- [`features/impuestos.md`](../../features/impuestos.md) · [`features/reembolsos-nota-credito.md`](../../features/reembolsos-nota-credito.md)
- [`2026-09-03-redondeo-por-pais-latam.md`](2026-09-03-redondeo-por-pais-latam.md) — la pasada anterior sobre las mismas cuatro autoridades
