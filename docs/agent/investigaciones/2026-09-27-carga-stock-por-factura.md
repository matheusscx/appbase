# Carga de stock mediante factura (lectura del DTE) — investigación de mercado

**Fecha:** 2026-09-27. **Pregunta del owner:** un cliente pidió "cargar el stock mediante
facturas". **Antecedentes:** [`2026-09-18-compras.md`](2026-09-18-compras.md) (pieza 1 de
compras, ya construida) y la entrada *"Compras: carga manual, y el DTE del SII como atajo
encima"* en [`../pendientes.md`](../pendientes.md).

> ⛔ **Esto es insumo, no diseño.** Cruza contra el código y la decisión ya tomada del owner
> (2026-09-03): la carga manual es el camino base y el DTE **pre-llena el mismo formulario**,
> nunca un segundo flujo. Nada de lo que sigue autoriza tocar el motor de cálculo ni lo fiscal
> — eso va en su propio frente (CLAUDE.md, ADR-010).

Método: [`../investigacion-mercado.md`](../investigacion-mercado.md). **[PRIMARIA]** = norma
o documentación oficial del producto/SII. **[SECUNDARIA]** = blog, ayuda de terceros, foro.

---

## 0. Qué hay hoy (para no repetir lo ya investigado)

Pieza 1 de compras existe: borrador con proveedor, documento, ubicación, líneas en la unidad
de la factura, precio opcional; confirmar mete stock y CPP
([`../../features/compras.md`](../../features/compras.md)). **De la lectura del DTE no existe
nada**: ni credenciales SII, ni cliente, ni mapeo proveedor→ítem. Tampoco existe la "unidad de
compra por proveedor" (pieza 2 pendiente) — varias de las respuestas de abajo dependen de ella.

---

## 1. Qué significa "cargar stock con la factura" en el mercado

Cuatro variantes conviven, no una sola "mejor":

**(a) Subir el XML del DTE** (correo de intercambio o backup manual) es el camino chileno
mayoritario. **Nubox**: *"si tienes el XML, puedes cargarlo directamente… tus proveedores
deben enviar los documentos a la casilla intercambio@dte.nubox.com"* **[SECUNDARIA]**
([Nubox](https://help.nubox.com/es/articles/5379769-como-se-recepciona-los-xml-desde-el-sii-en-factura-electronica-nubox)).
**Laudus** revisa su casilla al abrir la app y descarga a `Pendientes_Importar`, a importar a
mano desde Compras **[SECUNDARIA]**
([Laudus](https://www.laudus.cl/ayuda/importacion_dte_compras.html)). **Defontana** distingue
"Pendientes → Aceptar (con XML)" de "Nuevo (ingreso manual)" **[SECUNDARIA]**
([Defontana](https://intercom.help/defontanaerp/es/articles/3925891-recepcion-de-facturas-de-compra)).
**Fudo** carga la factura al importar el XML, sin detalle técnico verificable
**[SECUNDARIA]**
([Fudo](https://soporte.fu.do/es/articles/11731469-seccion-documentos-recibidos-gestion-de-facturas-de-proveedores)).

**(b) Traer los DTE desde el SII automáticamente.** Nadie lo hace vía API oficial del SII —
todos pasan por la **casilla de intercambio** o por scripts de terceros sobre el **Portal
MIPYME** (ver §2). **Bsale** *"recibe todas las facturas electrónicas de compra que envían
los proveedores y arma el libro de compra con ellas"* **[SECUNDARIA]**
([Bsale](https://www.bsale.cl/sheet/caracteristicas-documentos)); **Kame** *"sincroniza tus
documentos de compra desde el SII"*, sin detalle del mecanismo **[SECUNDARIA]**
([Kame](https://www.kame.cl/sistema-de-gestion-compras/)).

**(c) Foto/PDF con OCR o IA** — el patrón de los internacionales, para el proveedor sin
factura electrónica. **Toast xtraCHEF**: OCR que *"lee vendor, invoice number, product name,
unit of measure, quantity y cost"*, con control de calidad humano, datos en 24 h **[PRIMARIA]**
([xtraCHEF](https://pos.toasttab.com/blog/on-the-line/benefits-restaurant-invoice-processing/)).
**MarketMan**: *"scan, snap or upload any invoice… extracts data from both printed and
handwritten copies"* **[PRIMARIA]**
([MarketMan](https://www.marketman.com/platform/marketman-accounts-payable-automation)).
**Restaurant365**: OCR vía "AP Capture AI" más email dedicado y EDI **[PRIMARIA]**
([R365](https://docs.restaurant365.com/docs/documents-to-process-uploading-files-with-ap-automation)).
**Lightspeed**, el más nuevo: OCR+IA que lee foto de guía/factura y arma un **borrador de
orden de compra para revisar**, en beta desde 2026 **[PRIMARIA]**
([Lightspeed](https://www.lightspeedhq.com/news/lightspeed-commerce-launches-ai-powered-automation-to-help-retailers-eliminate-manual-inventory-entry/)).
Ningún chileno relevado (Bsale, Nubox, Defontana, Toteat, Relbase, Laudus, Kame, Obuma)
documenta OCR de foto/PDF — todos dependen del XML, porque el DTE ya nace electrónico.

**(d) Import estructurado (CSV/Excel/EDI).** **Square for Retail** importa la *orden de
compra* por CSV pero es explícito: *"At this time, the ability to import invoices from other
vendors isn't available"* **[PRIMARIA]**
([Square](https://squareup.com/help/us/en/article/7656-import-purchase-orders-with-square-for-retail)).
Bsale ofrece "importación masiva" por Excel para generar documentos — un mecanismo distinto
de leer la factura del proveedor **[SECUNDARIA]**.

→ **Para Chile, (a) es el camino real**: el DTE ya nace en XML, así que no hace falta OCR
para la mayoría de los proveedores — la pregunta es de dónde sale ese XML, no cómo leerlo.
OCR (c) queda para el proveedor sin factura electrónica, el mismo caso que ya cubre "sin
documento" en la pieza 1.

---

## 2. Chile, clave técnica — qué entrega el SII

**El Registro de Compras y Ventas (RCV) NO trae detalle de productos, ni siquiera su
antecesor lo trajo.** Verificado contra el **[PRIMARIA]** *Formato de Información Electrónica
de Compras y Ventas* del propio SII (v3.0, usado para las DJ 3327/3328, la base de lo que hoy
es el RCV): la Zona "Detalle" es *expresamente por documento, no por producto* — **"En esta
Zona se debe detallar una línea por cada documento"** (§1.2.d, pág. 8,
[formato_iecv.pdf](https://www.sii.cl/factura_electronica/factura_mercado/formato_iecv.pdf)).
Cada línea de Detalle trae folio, montos neto/exento/IVA y el tipo de documento — nunca un
producto. Esto **confirma con fuente primaria** lo que la investigación de compras del
2026-09-18 solo infería de la práctica de los ERP.

**De dónde sale el XML con las líneas de producto**, entonces:

1. **Casilla de intercambio** (correo): *"el emisor debe enviar el XML de la factura al
   correo de intercambio del receptor registrado en el SII"* **[PRIMARIA]**
   ([SII](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6423.htm) vía
   el instructivo técnico) — el camino de Nubox, Laudus y Defontana (§1). **Obuma** agrega
   algo que no aparecía en ninguna otra fuente: *"El SII no permite hasta el momento que los
   softwares de mercado obtengan los XML de las facturas de compra desde su sistema"* y, sin
   XML, *"al sincronizar solo vienen montos totales"* **[SECUNDARIA]**
   ([Obuma](https://www.obuma.cl/ayuda/articulo/425/como-funciona-la-recepcion-de-dte-por-compras-a-proveedores)).
2. **Portal MIPYME del SII**: permite descargar un respaldo XML de los DTE recibidos, *"en el
   formato estándar XML establecido por el SII"* **[PRIMARIA]**. ⚠️ Qué credencial pide (clave
   tributaria o certificado) **la guía del SII no lo dice**: lo de "alcanza la clave" sale de
   terceros **[SECUNDARIA]** (revisado por la orquestadora el 2026-09-27)
   ([SII, guía paso a paso](https://www.sii.cl/portales/mipyme/administracion/Guia_Respaldo_DTEs_recibidos.html) —
   confirma el mecanismo pero no si el respaldo trae el XML íntegro con detalle; un wrapper
   comercial de terceros que scriptea ese portal (`apigateway.cl`) sí lo afirma —*"El XML
   contiene el documento tributario completo… incluyendo… todos los datos del DTE"*—, pero
   **no está confirmado por el SII mismo** **[SECUNDARIA]**. Es la vía que usan
   Openfactura/SimpleAPI/LibreDTE/BaseAPI (ya citados en la investigación de compras).
3. **Certificado digital vs. clave tributaria — no es lo mismo, y esto no estaba resuelto
   antes:** el certificado (representante legal) hace falta para **emitir/aceptar-rechazar**
   por la casilla de intercambio; para **leer/respaldar** desde el Portal MIPYME, según
   terceros, alcanzaría el RUT + clave tributaria del contribuyente **[SECUNDARIA, sin
   confirmar en el SII]** — una credencial más barata, aunque siempre la del tenant, nunca la
   nuestra.

**Plazos (Ley 19.983, modificada por Ley 20.956):** el receptor tiene **8 días corridos**
desde que el DTE llega al SII para acusar recibo, reclamar el contenido, o reclamar por falta
total o parcial de mercadería/servicio. Pasado ese plazo sin acción, el acuse se da **por el
solo transcurso del tiempo** y la factura gana mérito ejecutivo **[SECUNDARIA, no se abrió el
texto de la ley]**
([Nubox](https://blog.nubox.com/empresas/plazo-para-rechazar-factura),
[elrincontributario](https://elrincontributario.blogspot.com/2016/11/acuse-de-recibo-y-credito-fiscal-ley.html)).
El SII (fuente primaria de la investigación anterior) ya confirmó que el crédito fiscal no se
pierde si el acuse llega tarde: se corre al período siguiente.

**Lo que no se pudo confirmar:** bajo qué mandato un tercero (nosotros, como software) puede
aceptar/reclamar un DTE en nombre del tenant — sigue sin cita, igual que en la investigación
de compras del 2026-09-18.

---

## 3. Mapeo línea de factura → producto del catálogo

Ningún sistema relevado lo hace sin intervención humana la primera vez. **R365** matchea
automático por **"Vendor Item Number"** (el código del proveedor) y lo que no calza **"queda
para revisión manual"** **[PRIMARIA]** (ya citado en la investigación de compras). **Nubox**
tiene una pantalla dedicada, **"Inventariar compras"**, donde *"puedes asociar la factura que
ha llegado del proveedor con un producto"* — sin aclarar si el mapeo se recuerda para la
próxima factura del mismo proveedor+código **[SECUNDARIA]**
([Nubox](https://help.nubox.com/es/articles/4811975-donde-se-pueden-ver-las-facturas-recibidas-de-nuestros-proveedores)).
**Lightspeed** (OCR beta 2026) entrega un **borrador de orden de compra para revisar y
aprobar**, nunca una escritura directa a stock **[PRIMARIA]**. **MarketMan/R365/Odoo**
coinciden (ya citado antes) en que la unidad de compra es un par (proveedor, ítem) con
factor de conversión — exactamente la pieza 2 pendiente de nuestro roadmap.

**Sobre la unidad ("3 CJ x 12" vs. unidades de stock):** nadie resuelve esto leyendo el XML
sin la tabla de conversión ya cargada — el DTE trae la **unidad y cantidad tal como la tipeó
el proveedor** ("CJ", 3), no la conversión a unidades sueltas. Sin la unidad de compra por
proveedor (pieza 2), leer el DTE se limita a traer líneas con "CJ" como texto libre, lo mismo
que ya puede tipear un humano hoy. **Es la dependencia más dura de esta pregunta.**

**Productos nuevos:** ningún producto documenta el comportamiento. La inferencia razonable —
consistente con el borrador-para-revisar de Lightspeed y la pantalla manual de Nubox— es que
**queda pendiente de asociar** y no entra a stock hasta que alguien lo resuelve
**[NO VERIFICADO, inferido]**.

---

## 4. Casos borde

- **Factura antes/después de la mercadería:** ya resuelto (owner, 2026-09-03/18): el costo
  puede faltar al recibir y se completa después. Aplica igual si el precio "falta" viene de
  una factura sin XML todavía en vez de un papel sin tipear.
- **Guía de despacho vs. factura:** *"la guía solo respalda el traslado físico… la factura
  acredita la venta"* **[SECUNDARIA]**. Defontana/Laudus usan la guía como costo
  **provisorio** hasta que llega la factura — un caso más de "costo que falta al recibir".
- **Ítems que no son stock (flete, gastos):** el XML no distingue línea de producto de línea
  de gasto salvo por el código del ítem — el mapeo humano decide. Coincide con la decisión ya
  tomada: gasto sin stock, con categoría propia.
- **Notas de crédito del proveedor:** llegan como su propio DTE (tipo 61), con las mismas dos
  vías de lectura. El **efecto fiscal es frente aparte** (ADR-010); el efecto en la deuda ya
  está decidido (rebaja el saldo).
- **Recepción parcial** (factura dice 20, llegan 17): es un problema de **conteo físico**, no
  de lectura de XML — el DTE siempre dirá "20". La lectura pre-llena "20"; el encargado
  corrige a "17" a mano, con el mismo camino que ya existe en la pieza 1.
- **Descuentos por línea y global:** el formato DTE expone `DescuentoPct`/`DescuentoMonto` por
  línea y `DscRcgGlobal` a nivel de documento **[PRIMARIA]** — coincide con lo que la
  investigación de compras del 2026-09-18 ya modeló. Leer el DTE no cambia esa cuenta, solo
  evita tipearla.
- **ILA:** solo se nombra — sin regla textual confirmada para un minorista a consumidor final
  (mismo hueco que antes). Frente fiscal aparte.

---

## 5. Trade-offs por variante, para un restaurante/minimarket chico chileno

| Variante | Costo de integrar | Fricción para el encargado | Confiabilidad |
|---|---|---|---|
| **(a) XML por casilla de intercambio** | Medio: hay que operar la casilla del tenant (crearla/monitorearla), parsear el XML del formato SII, y el mapeo proveedor→ítem sigue siendo manual la primera vez | Baja una vez configurado: el borrador llega pre-llenado, el encargado solo revisa y confirma — es exactamente el modelo que el owner ya decidió | Alta si el proveedor emite DTE y configura bien su envío; **cero** si el proveedor no es electrónico (feria, productor chico) |
| **(b) Traer desde el SII (Portal MIPYME con clave tributaria)** | Medio-alto: automatizar un login+descarga sobre un portal web no pensado para eso, con el riesgo de que el SII cambie el portal sin aviso (a diferencia de una API estable) | Ninguna si funciona: no depende de que el proveedor configure su casilla | Depende de un mecanismo no oficial (scraping/backup), más fragil que (a); además solo trae lo que el SII ya recibió, con el mismo desfase de 1-2 días que hoy tiene el RCV |
| **(c) Foto/OCR** | Alto: motor de OCR + IA, cola de revisión humana, y sigue sin resolver la Chile-realidad de que el DTE ya es XML — resuelve solo al proveedor sin factura electrónica | Baja para el caso que cubre (sacar una foto), pero ese caso ya está cubierto hoy por "sin documento" con tipeo manual | Media: depende de calidad de imagen y de un proveedor externo de OCR |
| **(d) CSV/Excel** | Bajo, pero no ataca el problema real (nadie tipea un CSV a mano en vez de la factura) | Alta: exige que alguien arme el archivo, que es más trabajo que tipear el formulario actual | Alta técnicamente, irrelevante para este caso de uso |

→ **Para nuestro tenant típico (restaurante/minimarket chico), (a) es la única variante que
ataca el problema que el cliente pidió** sin duplicar trabajo ya resuelto. (b) es un
complemento razonable para proveedores que no configuran bien su casilla, pero depende de un
mecanismo no garantizado por el SII. (c) y (d) no aportan sobre lo que la pieza 1 ya cubre.

---

## Cruce con lo que ya tenemos

- **Encaja limpio** con la regla de diseño ya fijada: "una sola recepción, dos formas de
  llenarla" — el DTE por (a) pre-llena proveedor, folio, líneas y montos del mismo formulario
  de borrador que hoy se tipea a mano. No hace falta un segundo modelo de datos.
- **Choca con nada nuevo** — lo fiscal (IVA no recuperable, ILA, NC) sigue siendo frente
  aparte, y esta pasada no encontró una razón para adelantarlo.
- **Depende por completo de la pieza 2** (unidad de compra por proveedor): sin ella, leer el
  DTE trae la cantidad y unidad *tal cual las tipeó el proveedor* ("3 CJ"), que no es
  utilizable para mover stock en unidades — es lo mismo que ya se puede tipear hoy. **La
  lectura del DTE no tiene sentido productivo hasta que la pieza 2 exista.**
- **La credencial podría ser más liviana de lo que se asumía** (sin confirmar en el SII): para
  *leer* (Portal MIPYME) alcanzaría RUT + clave tributaria del tenant; el certificado digital solo hace falta para
  aceptar/rechazar por la casilla de intercambio. Vale la pena separar ambas preguntas cuando
  se diseñe: "leer" y "responder" no piden la misma credencial ni el mismo riesgo.
- **Nueva pieza que la investigación anterior no había puesto en un lugar:** la **fuente
  primaria del SII (`formato_iecv.pdf`) confirma con su propio texto** que ni el RCV ni su
  antecesor traen detalle de producto — cierra una duda que la investigación de compras había
  dejado como "[NO VERIFICADO]".

## Lo que no se pudo verificar

Si el respaldo XML del Portal MIPYME trae el detalle de líneas íntegro (solo lo afirma un
wrapper comercial, no el SII) · qué credencial pide ese portal para respaldar (la guía del SII
no lo dice) · el mandato legal para que un tercero acepte/reclame DTE a
nombre del tenant · qué pasa en Nubox/Lightspeed/R365 cuando la línea no matchea ningún
producto existente (se infiere "queda pendiente", ninguno lo documenta) · el detalle técnico
del procesamiento de Fudo (XML → líneas → stock) · el texto exacto de la Ley 19.983/20.956
(todo lo citado sobre el plazo de 8 días es [SECUNDARIA], vía blogs, no el texto legal).

## Lo que el mercado NO hace (candidato a diferenciador — lo decide el owner)

Ningún POS relevado, chileno o internacional, documenta **recordar el mapeo proveedor+código
→ ítem** de forma explícita y reusable (a diferencia de R365 con su "Vendor Item Number").
Nubox e implícitamente los demás piden re-mapear factura por factura. Si nuestra pieza 2
(unidad de compra por proveedor) guarda el código del proveedor y lo usa para auto-matchear
la próxima factura del mismo proveedor, sería un diferenciador real — pero depende de diseñar
la pieza 2 primero. No se anota en `DIFERENCIADORES.md` porque todavía no hay decisión.

---

## Fuentes

**Internacionales:** [Toast xtraCHEF](https://pos.toasttab.com/blog/on-the-line/benefits-restaurant-invoice-processing/) · [MarketMan](https://www.marketman.com/platform/marketman-accounts-payable-automation) · [Square](https://squareup.com/help/us/en/article/7656-import-purchase-orders-with-square-for-retail) · [Lightspeed](https://www.lightspeedhq.com/news/lightspeed-commerce-launches-ai-powered-automation-to-help-retailers-eliminate-manual-inventory-entry/) · [Restaurant365](https://docs.restaurant365.com/docs/documents-to-process-uploading-files-with-ap-automation)

**Chile — SII (primarias):** [Formato IECV v3.0](https://www.sii.cl/factura_electronica/factura_mercado/formato_iecv.pdf) · [Formato DTE 2026-02](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) · [FAQ reenvío DTE](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6423.htm) · [Guía respaldo DTEs, Portal MIPYME](https://www.sii.cl/portales/mipyme/administracion/Guia_Respaldo_DTEs_recibidos.html)

**Chile — POS/ERP:** [Obuma](https://www.obuma.cl/ayuda/articulo/425/como-funciona-la-recepcion-de-dte-por-compras-a-proveedores) · [Nubox — XML desde el SII](https://help.nubox.com/es/articles/5379769-como-se-recepciona-los-xml-desde-el-sii-en-factura-electronica-nubox) · [Nubox — facturas recibidas](https://help.nubox.com/es/articles/4811975-donde-se-pueden-ver-las-facturas-recibidas-de-nuestros-proveedores) · [Laudus](https://www.laudus.cl/ayuda/importacion_dte_compras.html) · [Defontana](https://intercom.help/defontanaerp/es/articles/3925891-recepcion-de-facturas-de-compra) · [Bsale](https://www.bsale.cl/sheet/caracteristicas-documentos) · [Kame](https://www.kame.cl/sistema-de-gestion-compras/) · [Fudo](https://soporte.fu.do/es/articles/11731469-seccion-documentos-recibidos-gestion-de-facturas-de-proveedores) · [apigateway.cl (wrapper de terceros)](https://www.apigateway.cl/products/sii/portal-mipyme)

**Plazos legales:** [Nubox](https://blog.nubox.com/empresas/plazo-para-rechazar-factura) · [El Rincón Tributario](https://elrincontributario.blogspot.com/2016/11/acuse-de-recibo-y-credito-fiscal-ley.html)
