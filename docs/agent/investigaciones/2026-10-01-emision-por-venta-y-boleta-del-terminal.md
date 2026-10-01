# Emitir al SII por venta, y la boleta que ya emitió la máquina — investigación (2026-10-01)

Insumo para la entrada de [`pendientes.md`](../pendientes.md) § 6 ("Emitir al SII se elige
al cerrar cada venta, y lo emitido por la máquina se registra con su número"), a partir de
la regla del owner en [`PRODUCTO.md`](../../PRODUCTO.md) § 10 ("Emitir al SII es una
elección de cada venta"). No es decisión — la trae un agente con WebSearch/WebFetch.
Pedido explícito del owner: investigación **general**, no acotada a los referentes
internacionales de siempre. Cruza con [ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md)
(la emisión queda diferida; esto solo informa el diseño futuro) y con la investigación
hermana [`2026-10-01-reembolso-sin-nota-credito.md`](2026-10-01-reembolso-sin-nota-credito.md)
(no se repite lo que ya trae: duplicación de NC, reembolso de pasarela, saldo).

## Qué hace hoy el sistema

Ya descrito en `PRODUCTO.md` § 10 y la entrada de pendientes: hoy el sistema **no emite
nada al SII** (ADR-010). `tipo_documento_id` es solo una etiqueta — POS y salones ponen
Boleta por defecto, la venta online nace sin tipo. No hay campo para el número que dio una
máquina externa, ni lógica que distinga "emitido por el sistema" de "emitido por un
tercero". Esta investigación no agrega nada nuevo sobre el código — ver la investigación
hermana para el detalle de dónde falta esa distinción en el flujo de reembolso.

## Qué hace el mercado — el mecanismo chileno es normativo, no de producto

**Hallazgo central, distinto de lo que se esperaba al preguntar "cómo lo resuelven los POS
chilenos":** la pregunta 2 del pedido ("¿por venta, por caja, por medio de pago?") tiene
una respuesta que no es de ningún POS — es del propio SII, y es **por negocio (RUT), no
por venta**. El SII llama a esto **"modelo de emisión"**, declarado una vez en
`sii.cl → Servicios Online → Boleta de Ventas y Servicios → Declaración de modelo de
emisión`, con dos opciones. La declaración y sus dos modelos salen de
[SumUp — Modelo de emisión](https://www.sumup.com/es-cl/boletas-y-facturas/modelo-de-emision/)
(fuente secundaria, publicada el 24-04-2026). ⚠️ **Corregido por la orquestadora al
re-abrir las fuentes:** la noticia del SII que el borrador citaba como respaldo
([Resolución N°176, 2021](https://www.sii.cl/noticias/2021/050121noti01er.htm)) **no menciona
ninguna declaración**. Dice, como regla, que con pago electrónico el comprobante de pago es el
documento válido y no se emite boleta. Que hoy se pueda optar entre los dos modelos lo dice solo
SumUp. Que la declaración valga por RUT es una inferencia: SumUp no lo afirma.

1. **"Siempre emito boleta electrónica aun cuando reciba un pago electrónico"** — el
   comercio emite boleta/factura por todo, y el voucher de la máquina queda como simple
   comprobante de pago sin valor tributario adicional.
2. **"No emito boleta cuando recibo un pago electrónico"** (el nombre que usan los
   proveedores; el texto oficial dice que el voucher **reemplaza** la boleta) — para pagos
   con tarjeta, el voucher de la máquina **es** la boleta ante el SII; el comercio solo
   emite boleta propia cuando el pago fue en efectivo o transferencia.

Esto no es un ajuste por caja ni por terminal: es una declaración de todo el RUT. Un
tenant multi-local en este sistema (varias cajas, varios locales) declara **un** modelo,
no uno por caja. Eso no choca necesariamente con la regla del owner ("se elige por venta,
al cerrarla") — el modelo declarado fija el **default** que corresponde a cada medio de
pago (tarjeta → ya cubierto por el voucher bajo modelo 2; efectivo → el sistema tiene que
emitir sí o sí), pero sigue habiendo una decisión *por venta* dentro de ese default: por
ejemplo si el cliente pide factura en vez de boleta, o si el modelo declarado es "siempre
emito" y entonces cada venta con tarjeta igual necesita que el sistema emita. El cruce
entre "modelo declarado" (nivel negocio) y "elección por venta" (nivel transacción) es
exactamente el tipo de cosa que el diseño va a tener que resolver — se anota como tensión,
no como hallazgo cerrado, porque ningún POS consultado explica cómo modela esa capa
intermedia en su propio dato.

### 1. Boleta emitida por el terminal — qué terminales, cómo se configura, qué devuelven

| Terminal / adquirente | ¿Emite boleta/factura él mismo? | Cómo | Qué devuelve al sistema que integra | Fuente |
|---|---|---|---|---|
| **Transbank POS (Boleta Electrónica)** | Sí, pero **solo en la variante "POS Integrado"** con contrato de Boleta Electrónica activo — requiere firma digital propia (≈ UF 0,42/año) para timbrar y consumir folios | El terminal captura la venta con tarjeta y la envía a una plataforma conectada en línea al SII; **desde 2024-05-23 ya no emite boleta para efectivo ni otros medios distintos de tarjeta** (instrucción de la CMF) | El SDK `transbank-pos-sdk-web` / **POS Integrado** devuelve un `SaleResponse` con código de autorización, monto, cuotas, últimos 4 dígitos, número de operación, tipo/marca de tarjeta, fecha/hora y **campos de impresión** (`PrintingField`) para el voucher — **no se encontró evidencia de que devuelva folio DTE, tipo de documento ni timbre**; el documento tributario (cuando existe) vive en la plataforma de boleta electrónica de Transbank, no en la respuesta de venta del SDK | [POS Integrado — Transbank Developers](https://www.transbankdevelopers.cl/documentacion/posintegrado) (verificado la estructura de `SaleResponse`; **no verificado** si existe un endpoint separado para consultar el folio emitido) |
| **Getnet (Appboleta / Smart POS)** | Sí, vía una app de facturación propia (**Appboleta**, de Getnet) integrada al Smart POS | Certificado digital incluido (3 años), documentos ilimitados, impresión directa en el propio Smart POS | No se encontró documentación pública de una API para que un POS externo consulte el folio emitido | [Getnet — preguntas frecuentes](https://www.getnet.cl/preguntas-frecuentes/no-clientes-getnet/ventas-y-comprobantes-de-pago/detalles) (parcialmente verificado — no se abrió la doc técnica de Appboleta) |
| **Klap (Multicaja)** | Sí, servicio de boleta electrónica sobre el mismo POS de cobro, tarifa 0,39 UF + IVA/mes | Envío diario y automático de boletas al SII; emite tanto para pagos con tarjeta como en efectivo (es un servicio de facturación propio, no el voucher del medio de pago) | Las transacciones y boletas se consultan en el **Portal Comercio** (web), no se encontró API pública hacia terceros | [Klap — Boleta Electrónica](https://www.klap.cl/en/home-comercios/cambiate-a-boleta) (verificado parcial) |
| **SumUp** | Sí, servicio propio de "boleta electrónica y facturas" activable sobre la cuenta SumUp, cubre **tarjeta y efectivo** | Declara su propio "modelo de emisión" (ver arriba) | Portal de fiscalización propio para consultar/anular documentos | [SumUp — boleta electrónica](https://www.sumup.com/es-cl/boleta-electronica/) (verificado) |
| **Mercado Pago Point** | **No** — el comprobante que entrega **no tiene validez tributaria**; hay que facturar aparte (manual o con un software de facturación) | — | Solo da un recibo de transacción, sin valor como boleta/voucher-válido-como-boleta | [Comparativa SumUp vs Mercado Pago](https://comocobro.cl/quiero-emprender/que-pos-elegir-sumup-vs-mercadopago) (fuente secundaria, no abierta la doc oficial de Mercado Pago) |
| **Fudo (Terminal Fudo)** | Sí — la terminal propia de Fudo (lanzada 2024) ofrece "emisión de factura electrónica gratuita" integrada a su software de gestión | Terminal vendida como parte del ecosistema de gestión Fudo (restaurantes/bares), pagos en mesa | No se encontró documentación técnica de la API/respuesta | [Chócale — terminal Fudo](https://chocale.cl/2024/10/terminal-fudo-pos-gestion-y-pagos-restaurantes-y-bares/) (verificado que el producto existe; **no verificado** el detalle técnico) |
| Compraquí (BancoEstado) | Sin verificar en esta pasada si emite boleta propia o solo procesa el voucher-válido-como-boleta genérico | — | — | Sin verificar |

**El "voucher válido como boleta" — base normativa (verificado, [SII — destacados](https://www.sii.cl/destacados/boleta_electronica_voucher/index.html) y
[Resolución N°176](https://www.sii.cl/noticias/2021/050121noti01er.htm)):**
- Desde el **1 de enero de 2021**, el comprobante de pago electrónico (voucher) de una
  transacción con tarjeta de débito o crédito (u otro medio de pago electrónico) tiene
  validez como Boleta de Ventas y Servicios Electrónica — **"el recibo generado por pagos
  a través de tarjetas de débito o crédito... tiene validez como boleta electrónica"**.
- **Siempre se debe emitir boleta electrónica por pagos en efectivo y transferencias
  electrónicas** — el voucher **solo** cubre tarjeta y medios electrónicos equivalentes.
- No hay un monto mínimo distinto para esta regla.
- Requiere que el **emisor del voucher** (Transbank, Getnet, etc.) esté registrado y
  autorizado ante el SII como tal.

**Representación impresa (hallazgo nuevo, relevante a "qué devuelven las máquinas" — la
norma cambió mientras se diseñaba esto):** la **Resolución Exenta SII N°12** (17-ene-2025,
vigencia original 1-may-2025) obligó a entregar la representación **impresa** de la
boleta o del voucher en toda venta presencial. Transbank presentó un recurso de protección
(pérdidas declaradas de USD 10 millones, por el parque de máquinas sin impresora) y el SII
lo rechazó en la Corte, pero **el propio SII dio marcha atrás después** y flexibilizó la
resolución: acepta representación **impresa o virtual**, y los comercios con equipos sin
impresora (mPOS, etc.) tienen plazo hasta el **1 de marzo de 2026** para adaptarse
(verificado parcialmente — varias notas de prensa, no se abrió el texto resolutivo
definitivo). **Esto importa para el diseño:** si la máquina no imprime y el sistema
tampoco, la venta puede quedar sin ningún comprobante entregado al cliente — un caso borde
que la norma ya identificó y todavía está en ajuste.

### 2. Elegir por venta — ya cubierto arriba (modelo de emisión a nivel RUT + elección por venta dentro de ese marco).

### 3. Registrar el documento ajeno — integración automática vs carga manual

No se encontró, en ninguno de los proveedores relevados, una **API pública hacia terceros**
para que un POS externo consulte automáticamente el folio/tipo que una máquina (Transbank,
Getnet, Klap, SumUp) terminó asignando a una venta — lo que existe son **portales web**
(Portal Comercio de Klap, portal de Getnet, panel de SumUp) para que el comercio consulte
sus documentos emitidos. La integración técnica documentada (Transbank POS Integrado SDK)
devuelve datos de la transacción de pago (autorización, monto, tarjeta) pero no un folio
DTE. Esto sugiere que, salvo que exista un convenio de integración directa no público, la
carga del número al sistema **sería manual** (el cajero tipea el folio que imprimió la
máquina) — coincide con lo que ya anticipa la entrada de `pendientes.md` ("cómo entra el
número que dio la máquina: tipeado o traído por la integración" — sigue sin resolverse
con fuente pública).

**Lo que sí se encontró y es señal fuerte sobre qué dato hay que guardar como "número":**
para anular/corregir un voucher-válido-como-boleta, la nota de crédito que lo anula debe
**referenciar el voucher** con su **número de autorización** (ver punto 4) — es ese dato
(no un folio DTE propio, porque el voucher no tiene folio DTE en el sentido de boleta
SII — es el propio comprobante bancario) el que hay que poder guardar si la máquina emitió
bajo el modelo "voucher = boleta". Si en cambio la máquina emite boleta propia vía una app
de facturación (Getnet Appboleta, Klap, SumUp, Fudo), el número relevante **sí** es un
folio DTE real (33/39) emitido por esa plataforma, con su propio emisor fiscal — son dos
naturalezas de "número" distintas y el modelo de datos tendría que distinguir cuál es cuál.

### 4. Corrección posterior — quién emite la NC

Dos casos distintos, verificados por separado:

- **El "documento" fue el voucher-válido-como-boleta (modelo "no emito"):** el **comercio**
  (no Transbank/Getnet/etc.) emite la nota de crédito, por su propio medio de facturación
  electrónica o por el sitio del SII, y **debe agregar como referencia el número de
  autorización del voucher a anular**; la anulación queda efectiva recién cuando el SII
  aprueba esa NC (verificado,
  [Facto — cómo anular un voucher válido como boleta](https://ayuda.facto.cl/como-anular-un-voucher-que-es-valido-como-boleta-emitido-por-transbank-getnet-redelcom-etc)).
  Transbank/Getnet no participan de la anulación tributaria — solo informan al SII la
  transacción original.
- **El documento fue una boleta/factura DTE emitida por la plataforma de facturación de la
  máquina (Getnet Appboleta, Klap, SumUp, Fudo):** la NC se emite **desde esa misma
  plataforma** (ej. "si tienes el servicio de Boleta Electrónica activo [de SumUp], puedes
  emitir una nota de crédito directamente desde su portal de fiscalización"; para Klap, "se
  debe emitir una NC a través del sitio del SII o la plataforma de facturación propia,
  referenciando el número del comprobante a anular") — verificado parcialmente vía SumUp y
  Klap/Multicaja.
- **No se encontró ninguna fuente que describa el caso "el sistema (POS) emite la NC
  referenciando un folio que emitió la máquina"** — en todos los casos relevados, quien
  emitió el documento original es quien tiene la capacidad (certificado, folios) de
  emitir su corrección. Esto es información directamente relevante para el diseño: si la
  máquina emitió, el sistema probablemente **no puede** emitir la NC él mismo salvo que
  comparta el mismo emisor fiscal — tendría que, como mínimo, registrar que la corrección
  se hizo en otro lado (como ya se señaló en la investigación hermana para el caso del
  reembolso de pasarela sin NC).
- **Qué pasa si el sistema y la máquina no coinciden:** no se encontró una fuente que
  describa este escenario directamente. Es una pregunta abierta — ver "Sin verificar".

### 5. Venta sin documento — obligación de emitir y resumen de ventas diarias

- **Monto mínimo:** desde el 1-jul-2023 (Resolución Exenta SII N°60, 17-may-2023) el monto
  mínimo para emitir boleta bajó de $180 a **$1**, afecta o exenta — en la práctica no hay
  piso: toda venta debe tener boleta, sin importar el monto (verificado,
  [gosocket — Resolución N°60](https://gosocket.net/centro-de-recursos/el-sii-de-chile-emitio-la-resolucion-exenta-n60-que-modifica-el-monto-minimo-en-la-emision-de-boletas-de-ventas-electronicas-de-bienes-y-servicios/)).
- **Resumen de Ventas Diarias (RVD):** **eliminado como obligación separada desde agosto de
  2022** (Resolución Exenta SII N°53/2022) — el Registro de Ventas del contribuyente se
  alimenta directamente de las boletas electrónicas recibidas por el SII, no de un archivo
  de resumen aparte (verificado,
  [SII — noticia 04-08-2022](https://www.sii.cl/noticias/2022/040822noti01rp.htm)). Esto
  contradice la mención del pedido original de "resumen de ventas diarias si sigue
  existiendo" — **ya no existe** como obligación de envío; sigue existiendo como una
  vista/reporte dentro del Registro de Compras y Ventas.
- **Devolución de una venta sin documento en el sistema:** no se encontró, en ningún POS
  ni fuente normativa relevada, un procedimiento específico para "devolver una venta que
  nunca tuvo boleta/voucher" más allá del caso ya cubierto por la investigación hermana
  (pasarela online). No es un vacío nuevo — es el mismo vacío, visto desde otro ángulo.

### 6. Casos borde

- **Pago mixto (efectivo + tarjeta, "pago dividido"):** Transbank documenta el "pago
  dividido" como una función del terminal para que el cliente separe el pago entre dos
  medios (ej. tarjeta + efectivo, o tarjeta + tarjeta) en una misma compra (verificado,
  [Transbank — pago dividido](https://ayuda.transbank.cl/pago-dividido)). **Consecuencia
  fiscal no resuelta en una sola fuente, pero coherente con la regla del voucher:** el
  voucher solo cubre la porción pagada con tarjeta — la porción en efectivo, bajo el
  modelo "no emito", necesitaría su propia boleta. Una venta con pago mixto podría terminar
  con **dos documentos** (el voucher por la parte tarjeta + una boleta del sistema por la
  parte efectivo), no uno. No se encontró una fuente que lo diga en esos términos exactos
  — es una inferencia a partir de la regla de voucher + la existencia documentada del pago
  dividido; queda marcada como tal.
- **Propina:** el voucher estándar de Transbank no tiene un campo separado para propina en
  todas sus variantes; si no se desglosa, el comprobante trata el monto completo (consumo +
  propina) como afecto a IVA, porque no hay forma de distinguir cuánto es propina — fuente
  secundaria/contable, no SII directo
  ([Lanzatesolo — vouchers de Transbank](https://www.lanzatesolo.cl/consejos/vouchers-de-transbank-no-es-equivalente-a-emitir-boleta)).
  Esto es compatible con lo que ya tiene el sistema documentado (propina fuera del
  documento tributario) — el riesgo es específico del *voucher como boleta*, no del
  documento que emite el propio sistema (que ya sabe separar propina).
- **Pago dividido entre varias tarjetas:** Transbank lo soporta como variante del "pago
  dividido" (misma función, dos tarjetas en vez de tarjeta+efectivo) — ambas porciones son
  electrónicas, así que bajo modelo "no emito" ambos vouchers (o uno combinado, no
  verificado cuál) cubrirían la venta sin necesidad de boleta del sistema. Sin verificar el
  detalle de si el terminal emite un voucher por cada tarjeta o uno consolidado.
- **Factura que el cliente pide después de cobrar:** no se encontró una fuente que
  describa este flujo específicamente para Chile vía terminal (emitir boleta/voucher al
  momento y luego, a pedido, una factura). Es una pregunta de diseño abierta — la norma SII
  de voucher-válido-como-boleta habla de *reemplazar* la boleta, no de la factura; una
  factura casi siempre se pide con datos del receptor (RUT/giro) que recién se conocen
  después del cobro, así que el camino más plausible (no verificado con fuente) es que el
  sistema emita una factura nueva aparte, con el voucher/boleta original quedando como el
  documento de la venta en el punto de venta — y una nota de crédito sobre ese documento
  original si se requiere anularlo para no duplicar.

## Cuando el sistema y la máquina no coinciden

Pedido explícito del owner: los cinco escenarios de desacuerdo entre lo que emite el
sistema y lo que emite la máquina de cobro. **Hallazgo que reencuadra el resto de esta
sección (verificado, primario, [SII — Declarar modelo de emisión de boletas
electrónicas](https://www.sii.cl/ayudas/boleta_electronica/declarar_modelo_emision_boletas_electronicas.pdf),
guía oficial F13432025, junio 2025):** el propio SII dice por qué existe la declaración
de modelo de emisión — **"permitirá registrar una sola vez sus ventas en el Registro de
Compras y Ventas (RCV) del SII"**. No es una formalidad administrativa: es el mecanismo
que el SII diseñó específicamente para que un pago con tarjeta no quede contado dos veces
(voucher + boleta propia). Esto responde directo a la pregunta 1 del pedido ("¿hay doble
débito fiscal?") — el riesgo que describe el owner es exactamente el que el SII nombra
como motivo de la declaración, no una situación que la norma no haya previsto. La misma
guía confirma, con texto literal de las dos opciones, que la declaración es **por RUT
completo** (se autentica "con RUT y Clave Tributaria de la empresa", sin mención de
sucursal, caja ni terminal) y que **solo se puede modificar una vez por día**, rigiendo
desde el día en que se declara — el cambio recién aplica al día siguiente de solicitado.
Esto corrige lo que la sección anterior dejaba apoyado solo en una fuente secundaria
(SumUp): la declaración de modelo de emisión existe, con ese nombre y ese mecanismo,
directamente en sii.cl.

### 1. Los dos emiten — el costo es el IVA no recuperable, no una infracción

- **Corrección, mecanismo verificado (primario, [SII — Anular una boleta electrónica
  estando inscrito en Factura Electrónica](https://www.sii.cl/ayudas/boleta_electronica/anular_una_boleta_electronica_estando_inscrito_en_facturacion_electronica.pdf),
  guía F13472025, junio 2025):** cualquier boleta —incluida una emitida de más o
  duplicada— se anula con una Nota de Crédito Electrónica que la referencia por folio y
  fecha. El trámite no distingue "por qué" se anula (duplicidad, error de monto, venta
  caída): el mecanismo es el mismo. No hay plazo para **anular** (la guía no lo menciona,
  consistente con la FAQ general del SII sobre boletas: "no existe un plazo para anular
  una boleta de venta electrónica").
- **Plazo para no perder el IVA (parcialmente verificado — no se abrió el texto de la Ley
  N°21.398 ni el DL 825 directamente; coincide entre dos fuentes contables independientes
  y una cita un Oficio SII específico):** si la Nota de Crédito se emite dentro de los
  **6 meses** (plazo ampliado desde 3 por la Ley N°21.398, que modificó los arts. 21 y 70
  del DL 825), el débito fiscal se reduce y no hay doble pago de IVA. Pasado ese plazo, el
  débito fiscal del documento sobrante **ya no se puede rebajar** — ahí sí hay IVA pagado
  dos veces sobre la misma venta, pero como costo no recuperado, no como sanción.
- **¿Es infracción?** No se encontró ninguna fuente que trate "emitir de más y corregir
  (o no corregir) con NC" como una conducta sancionada por el art. 97 N°10 del Código
  Tributario — esa norma sanciona el **no otorgamiento** de boleta, no el otorgamiento de
  más de una. Es una inferencia razonable a partir del texto de la infracción (confirmado
  por jurisprudencia de Tribunales Tributarios y Aduaneros vía sii.cl, ver escenario 2),
  no una fuente que lo diga para este caso específico.
- **Caso no resuelto por ninguna fuente, construido sobre el hallazgo ya existente en este
  documento (punto 4 de la sección anterior):** si los "dos documentos" vienen de **dos
  emisores fiscales distintos** — boleta propia del sistema + boleta propia de la máquina
  emitida por su propia plataforma de facturación (Getnet Appboleta, Klap, SumUp, Fudo),
  no un voucher-válido-como-boleta — cada emisor anula lo suyo; no hay un mecanismo
  encontrado para que uno anule el folio del otro. Corregir la duplicación completa
  requeriría **dos** Notas de Crédito, una por cada emisor — inferencia, no verificado.

### 2. Ninguno emite — la infracción del art. 97 N°10, con el riesgo repartido distinto por medio de pago

- **Sanción, verificada (primaria, [SII — ¿Qué sanciones se aplican por incumplir estas
  nuevas obligaciones?](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_8795.htm)
  y jurisprudencia de Tribunales Tributarios y Aduaneros publicada en sii.cl):** el no
  otorgamiento o no disponibilidad de la boleta electrónica (o su comprobante de pago) se
  sanciona por el **art. 97 N°10 del Código Tributario** — multa del 50% al 500% del monto
  de la operación (mínimo 2 UTM, máximo 40 UTA) y **clausura de hasta 20 días** del local.
  La misma FAQ distingue dos sanciones más: otros incumplimientos de la Resolución
  N°53/2025 (representación impresa/virtual) van por el art. 109 del Código Tributario; el
  consumidor final que no exige su documento puede sancionarse por el art. 97 N°19 — esto
  último no aplica al comercio, pero marca que la norma también mira al cliente.
- **Regularización posterior:** no se encontró un procedimiento oficial para "emitir
  tarde" una boleta que debió emitirse al momento de la venta — ni una boleta con fecha
  retroactiva, ni una rectificación específica para este caso. El hueco entre la venta real
  y la boleta (si se emite después, con la fecha real de emisión) queda como evidencia de
  que no se emitió a tiempo. Sin verificar con fuente directa.
- **Riesgo de detección, distinto por medio de pago (inferencia a partir de datos ya
  verificados en este documento, reforzada por una fuente secundaria — [blog Tuu — el
  algoritmo del SII](https://blog.tuu.cl/fiscalizacion-del-sii-por-que-el-algoritmo-ya-conoce-tu-negocio)):**
  un pago con tarjeta queda reportado al SII por el emisor del voucher (Transbank, Getnet,
  etc. — ya registrados y autorizados ante el SII, según lo verificado en la sección
  anterior), así que una venta con tarjeta sin boleta ni voucher válido es, en principio,
  cruzable. Un pago en efectivo no deja ese rastro de un tercero — el riesgo ahí depende de
  arqueo de caja o fiscalización directa, no de un cruce automático. No se encontró una
  fuente que confirme que el SII efectivamente hace ese cruce en la práctica, más allá de
  notas de prensa/blog sobre "fiscalización con datos".

### 3. Montos distintos — depende de si el documento es boleta o factura

- **Verificado, primario ([SII — Anular una boleta electrónica estando inscrito en
  Factura Electrónica](https://www.sii.cl/ayudas/boleta_electronica/anular_una_boleta_electronica_estando_inscrito_en_facturacion_electronica.pdf),
  texto literal):** *"no existe la opción de modificar el monto de una boleta. Si necesita
  disminuir el precio, debe anular la boleta mediante una nota de crédito y luego emitir
  una nueva con el monto correcto. Si necesita aumentar el precio, debe emitir otra boleta
  por el monto adicional."* Para boletas no hay Nota de Débito de corrección — la SII
  resuelve el monto de menos con una boleta adicional, no con un documento que "suma"
  sobre el original.
- **Para facturas sí existe Nota de Débito de corrección de montos** (verificado,
  observado en el flujo oficial de anulación de facturas — opción "Generar Nota de Débito
  para Corregir Montos", normada junto con la NC general por el art. 57 del DL 825 y el
  art. 71 del Reglamento de la Ley de IVA) — la distinción boleta/factura importa para el
  diseño: el documento que haya que ajustar define si el camino es "NC + nueva boleta" o
  "ND sobre la factura existente".
  Este marco sirve igual para contexto chileno general (no es específico de pago
  dividido/propina, que ya cubre la sección anterior, punto 6).
- **Qué documento "manda":** no se encontró una fuente que compare explícitamente "lo que
  registró el sistema" contra "lo que emitió la máquina" en términos de cuál prevalece
  ante el SII. Es inferencia, pero se sostiene en lo ya verificado: el que tiene validez
  tributaria es el DTE efectivamente emitido y recibido por el SII (folio, timbre) — un
  monto distinto registrado solo internamente en el sistema no tiene, por sí mismo, ningún
  efecto fiscal; es un problema de conciliación interna hasta que alguien emite el
  documento de corrección (boleta adicional, NC, o ND) que sí llega al SII.

### 4. Tipo distinto — boleta y factura no son intercambiables, hay que anular y re-emitir

- **Verificado (mecanismo general, mismo trámite de anulación citado en el escenario 1):**
  no existe un "cambiar tipo de documento" — cambiar una boleta por factura (o viceversa)
  es anular la boleta con una NC y emitir la factura como documento nuevo e independiente.
  Mismo plazo aplicable: sin límite para anular, 6 meses (DL 825, ver escenario 1) para que
  la NC rebaje el débito fiscal de la boleta anulada.
- **Si el documento original lo emitió la máquina (voucher-válido-como-boleta o boleta
  propia de su plataforma de facturación), no el sistema:** esto ya está cubierto en el
  punto 4 de la sección anterior y no se repite aquí — el emisor original es quien puede
  anular, el sistema no puede emitir una NC sobre un folio que no es suyo.

### 5. Modelo de emisión declarado vs. práctica — hallazgo sin resolver, igual que antes

- Lo verificado en esta pasada (RUT completo, cambio 1x/día, propósito explícito de evitar
  duplicar el registro en el RCV) ya está arriba, al inicio de esta sección.
- **Lo que sigue sin encontrarse:** ninguna fuente —ni la guía oficial del SII, ni Nubox,
  ni Fudo (que documenta el trámite para su propio POS pero no pasó de la tabla de
  contenidos al abrir el artículo)— dice qué pasa si el contribuyente declaró un modelo y
  en la práctica emite distinto (por ejemplo, declaró "no emito" pero el sistema sigue
  emitiendo boleta propia para pagos con tarjeta). La hipótesis más simple, no verificada,
  es que no hay una sanción *por la inconsistencia en sí* — el riesgo fiscal real sigue
  siendo el que ya describen los escenarios 1 y 2 (doble registro en RCV, o no otorgamiento),
  y el modelo declarado es la señal que el propio RCV usa para esperar un solo documento
  por venta con tarjeta, no una regla con sanción propia.

## Opciones que aparecen, con su costo

Ninguna es recomendación — las trae esta pasada para que el owner y el diseño las cruce.

1. **Modelar "modelo de emisión" como configuración del tenant (no de la venta) y dejar que
   la elección por venta viva dentro de ese marco** (ej.: con modelo "no emito", la venta
   con tarjeta por defecto es "no emite el sistema"; con efectivo, el sistema emite sí o
   sí; el cajero puede igual forzar "sí emite" si el cliente pide factura). Costo: el
   sistema necesita saber, antes de cerrar la venta, qué modelo tiene declarado el tenant
   ante el SII — un dato nuevo, hoy inexistente, que además puede estar desincronizado si
   el tenant lo cambia en el sitio del SII sin avisarle al sistema.
2. **Modelar dos tipos de "número externo"** distintos: número de autorización de voucher
   (cuando el "documento" es el comprobante de pago) vs. folio DTE de la plataforma de
   facturación de la máquina (cuando la máquina factura por su cuenta). Costo: más
   complejidad de modelo de datos por algo que hoy ni siquiera tiene un campo; pero
   mezclar los dos en un solo "número" probablemente rompe la nota de crédito posterior
   (cada uno se referencia distinto).
3. **No permitir que el sistema emita NC sobre un documento que no emitió él** (ni boleta
   propia, ni factura propia) — solo registrar "esta venta se corrigió afuera, con este
   número de NC externo", igual que la opción 3 de la investigación hermana para el
   reembolso de pasarela. Costo: dos frentes (este y el de pasarela) terminan necesitando
   el mismo campo/mecanismo de "documento externo referenciado" — podría valer la pena
   diseñarlos juntos en vez de por separado, aunque cada uno abre su propio frente fiscal
   (regla del owner, ADR-010).
4. **Tratar el pago dividido con porción en efectivo como un caso que siempre fuerza
   emisión del sistema** (independiente del modelo declarado), ya que el voucher de la
   porción tarjeta nunca cubre la porción efectivo. Costo: requiere que el motor de pagos
   exponga, al momento de decidir si emitir, el desglose por medio de pago de esa venta
   específica (hoy existen pagos múltiples por venta — `pagos` — así que el dato ya
   existiría, falta la regla que lo lea).

## Sin verificar

- Compraquí (BancoEstado): si emite boleta/factura propia o solo procesa el
  voucher-válido-como-boleta genérico.
- Clover y otros adquirentes no nombrados en el pedido: no se buscaron en esta pasada
  (el pedido los dejaba fuera explícitamente salvo que aportaran algo distinto).
- Documentación técnica de Getnet Appboleta, API de Klap/SumUp hacia terceros para
  consultar folios — no se abrió ninguna doc técnica más allá de lo que aparece en
  preguntas frecuentes/blogs.
- Si el SDK de Transbank POS Integrado tiene un endpoint separado (fuera de `SaleResponse`)
  para consultar el folio DTE de la boleta que generó — solo se leyó la página de
  documentación general, no el detalle completo del SDK.
- Devolución de una venta con pago dividido entre tarjeta y efectivo donde solo una porción
  tiene voucher — no se encontró fuente, es inferencia.
- Si el terminal emite un voucher por cada tarjeta en un pago dividido entre varias
  tarjetas, o uno consolidado.
- Flujo exacto para cuando un cliente pide factura después de haber pagado con **voucher**
  (no boleta del sistema) — el mecanismo general (anular con NC + emitir factura nueva) sí
  quedó verificado en "Cuando el sistema y la máquina no coinciden" § 4, pero específico al
  voucher-de-máquina-como-boleta no se encontró fuente dedicada.
- Texto resolutivo definitivo y vigente de la Resolución N°12 tras la rectificación del
  SII (se leyeron solo notas de prensa, no el texto oficial final en sii.cl/normativa).
- Si Fudo, Getnet Appboleta o Klap exponen alguna API pública hacia software de terceros
  (más allá de portales web de consulta) — no se encontró, pero tampoco se agotó la
  búsqueda en cada doc técnica particular.
- Si dos documentos de **dos emisores fiscales distintos** (boleta propia del sistema +
  boleta propia de la máquina) sobre la misma venta requieren dos Notas de Crédito
  separadas, una de cada emisor, o existe algún mecanismo que las cruce — inferencia, sin
  fuente.
- Procedimiento oficial para regularizar una venta que no generó ningún documento (ni
  boleta del sistema ni voucher/boleta de la máquina) — no se encontró un mecanismo de
  "boleta tardía" o rectificación específica para este caso.
- Si el SII efectivamente cruza, en la práctica y no solo como capacidad declarada, los
  pagos con tarjeta reportados por los emisores de voucher contra las boletas electrónicas
  recibidas, para detectar ventas sin documento — solo hay notas de prensa/blog
  (secundarias) sobre "fiscalización con datos", no una fuente que describa el cruce
  mismo.
- Consecuencia de declarar un modelo de emisión y operar distinto en la práctica —
  tampoco la trae la guía oficial del SII sobre la declaración (verificada esta pasada):
  sigue sin encontrarse en ninguna fuente, oficial o secundaria.
