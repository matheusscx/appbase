# Nota de crédito electrónica (61) sobre boleta electrónica (39/41) — investigación (2026-10-15)

> ⛔ **Lo que trae esta investigación NO es lo que hay que hacer.** Es una foto de lo que dicen
> la ley y el SII y de cómo lo resolvieron otros: **insumo para cruzar, analizar y adaptar a
> nuestra realidad**, nunca una verdad única a copiar. Se contrasta contra el código, los docs y la
> decisión del owner **antes** de que se vuelva diseño. Si el SII dice A y el owner decide B,
> gana B, y se documenta por qué. Frente fiscal: va solo y decide el owner (`CLAUDE.md`).

Pedido: antes de construir el frente 2 de [`emision-electronica.md`](../../features/emision-electronica.md)
(la nota de crédito electrónica que corrige o anula una boleta ya emitida), qué dice la norma y
qué hace el mercado. No repite lo de
[`2026-10-13-emision-electronica-sii.md`](2026-10-13-emision-electronica-sii.md) (qué exige la
norma, quién vende la emisión) ni el ciclo de vida de la anulación de
[`2026-07-27-anulacion-y-notas-credito.md`](2026-07-27-anulacion-y-notas-credito.md); donde esta
pasada los corrige o los matiza, lo dice.

**Marcas de nivel:** **confirmado con fuente** (lo leí en el documento), **inferido** (sale de
juntar fuentes, ninguna lo dice así), **no encontrado**. **Marcas de fuente:** **[P]** primaria
(ley, circular, resolución, FAQ, formato o manual del SII), **[S]** secundaria (proveedor, blog).
Los PDF se bajaron y se leyeron con `pdftotext`; las FAQ del SII se abrieron una por una (la fecha
es la de "actualización" de la propia página). El OpenAPI de la API de boletas se leyó entero
(versión 1.0.5). Los XSD locales (`backend/src/modules/dte/esquemas/`) se contrastaron con el
formato publicado.

## Resumen (≤8 líneas)

1. **Certificación de factura (pregunta 1):** el SII no publica ninguna frase que diga "para emitir
   la 61 hay que ser facturador", pero todo lo que publica apunta ahí: la FAQ oficial manda a los
   **no** facturadores al portal del SII y a los facturadores a su software; la Res. 45/2003 exige
   como mínimo certificar Factura + NC + ND; y el menú de envío de DTE exige "ser facturador". **Inferido**, con riesgo alto.
2. **Canal (5):** la 61 **no** va por la API REST de boletas (su OpenAPI solo enumera tipos 39 y 41);
   va por el SOAP/upload de factura (palena/maullin) en un `EnvioDTE` aparte, con `RutReceptor` 60803000-K.
3. **Receptor (2):** el SII dice que, si no se obtienen los datos del comprador, el receptor de la NC es
   el **propio emisor** (su RUT y razón social), no `66666666-6`. `RznSocRecep` es lo único obligatorio además del RUT.
4. **Montos y referencia (3, 4):** formato factura; `CodRef` 1 para anular la boleta entera (una sola
   referencia) y 3 para rebajar montos (la elección parcial es **inferida**); para anular conviene
   repetir al peso el neto, el IVA, el exento y el total de la boleta (si no, reparo `REF-2-780` [S]).
5. **Orden (6):** una NC que referencia un DTE que el SII no tiene o no aceptó se rechaza [S, código
   `REF-3-750`]; hay que esperar el estado de la boleta antes de enviar la 61.
6. **Plazos (7):** el único plazo de ley es de **6 meses** para rebajar el débito fiscal (Circular
   19/2022 [P]); la NC se puede emitir después, con `IndNoRebaja`. El "mismo período o el siguiente" es de facturas, no de boletas.
7. **CAF y entrega (8, 9):** el CAF de la 61 tiene su propio rango; vence a los 6 meses (Res. 58/2017
   [P], el 61 incluido [S]). El timbre impreso opcional (Res. 207/2025) es solo de la boleta.
8. **Mercado (10):** los POS publican poco; lo que sí publican (LibreDTE, Defontana, Nubox) coincide con el SII, y Nubox exige estar habilitado como facturador.

---

## 1. ¿Puede emitir NC 61 un contribuyente certificado solo para boleta?

**Respuesta corta:** con lo publicado, **no hay una vía documentada** para que un emisor habilitado
solo para boleta envíe una 61 desde su propio software. La vía oficial para ese contribuyente es el
**portal del SII, a mano**. Si la respuesta es "hay que certificar factura", la certificación es la
de factura completa. **Inferido** (cinco fuentes primarias convergen; ninguna lo afirma en una frase).

Lo que dice cada fuente:

- **La anulación de una boleta es con NC electrónica**: **confirmado**
  ([FAQ 001.380.5352](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_5352.htm),
  Res. 74/2020 letra F n.º 7 y 8) **[P]**. La Res. 74 obliga a todo emisor de boleta, no solo a los facturadores.
- **El SII separa por si el contribuyente es facturador**: **confirmado**
  ([FAQ 001.380.7812](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7812.htm),
  actualizada el 23/07/2026) **[P]**. Si **no** está habilitado como facturador electrónico, la NC se
  emite en el sitio del SII (Servicios online, Boleta de ventas y servicios electrónica). Si **sí** lo
  está, debe emitirla desde el Sistema de Facturación Gratuito del SII o desde el software propio o de
  mercado que use. La lectura natural es que el software propio es para quien es facturador; la FAQ no lo dice con esas palabras.
- **Las guías de ayuda del SII repiten la partición** (junio y julio de 2025) **[P]**:
  [estando inscrito en factura](https://www.sii.cl/ayudas/boleta_electronica/anular_una_boleta_electronica_estando_inscrito_en_facturacion_electronica.pdf)
  (NC "en blanco" desde el sistema de facturación, con certificado digital) y
  [sin estar inscrito](https://www.sii.cl/ayudas/boleta_electronica/anular_boleta_electronica_sin_estar_inscrito_en_facturacion_electronica.pdf)
  (portal de boletas, con Clave Tributaria o Clave Única, **sin certificado**, con captcha).
  El portal sin factura está pensado para anular una boleta por su monto total.
- **Qué exige ser "facturador"**: **confirmado**
  ([Res. Ex. 45/2003](https://www.sii.cl/documentos/resoluciones/2003/reso45.htm), resolutivo segundo n.º 3) **[P]**.
  Para ser autorizado como emisor electrónico hay que aprobar **a lo menos** las pruebas de Factura,
  Nota de Crédito y Nota de Débito; los demás documentos son certificación adicional. El
  [modelo de operación](https://www.sii.cl/factura_electronica/factura_mercado/modelo_operacion.pdf)
  (2003) dice lo mismo en otras palabras: quien se autoriza para factura queda autorizado también para NC y ND. La 61 no se certifica sola.
- **El set de pruebas es de factura**: **confirmado**
  ([instrucciones del set](https://www.sii.cl/factura_electronica/factura_mercado/inst_set_pruebas.pdf)) **[P]**.
  Sus NC referencian facturas, con folios de factura, y el envío va al RUT 60803000-K. No hay una variante "NC sobre boleta".
- **El menú del SII para software de mercado** marca con asterisco los servicios que requieren "ser
  facturador electrónico y contar con certificado digital": enviar DTE, consultar el estado de un envío
  y solicitar timbraje ([menú](https://www.sii.cl/factura_electronica/factura_mercado/menu_certificacion.html)) **[P]**.
  El upload SOAP, además, devuelve el status 6, "empresa no autorizada a enviar archivos"
  ([manual de envío](https://www.sii.cl/factura_electronica/factura_mercado/envio.pdf), 2003) **[P]**.
- **No encontrado:** una excepción para la NC que solo anula o corrige boletas, y cualquier texto del
  SII que diga que un emisor habilitado por la Res. 74 puede enviar una 61 sin pasar por la certificación de factura.

⚠️ **Contradicción dentro del SII, sin resolver.** La
[guía de certificación de boletas](https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm)
(modificada el 04/03/2025) dice que, para ser autorizado a emitir boleta con software propio o de
mercado, hay que estar **previamente** autorizado como emisor de DTE o certificarse en paralelo. La
Res. 74/2020, considerando 5.º, dice que **eliminó** la condición de ser facturador y exige solo ser
contribuyente de primera categoría **[P]**. Si rige la guía, ningún tenant emite boleta propia sin pasar por factura, y la pregunta 1 se vuelve trivial.
Esta contradicción va a la lista de preguntas al SII.

**Qué dicen los terceros [S]:** Nubox pide "estar inscrito y habilitado como facturador electrónico" para emitir la NC de una boleta
([blog](https://blog.nubox.com/empresas/como-hacer-nota-de-credito-para-boleta-electronica)); Cuaderno Rojo
describe tres escenarios idénticos a los del SII, y para el que solo tiene boletas manda al portal
([ayuda](https://intercom.help/cuaderno-rojo/es/articles/11652673-perfil-administrador-como-emitir-una-nota-de-credito-de-una-boleta-sii)).

**Cómo cerrar la duda con una prueba barata (no la hice):** en el ambiente de certificación (maullin),
con un RUT que solo haya pasado el set de boletas, pedir semilla y token SOAP y subir una 61. Un
status 6 o un estado `EMP` ([QueryEstDte](https://www.sii.cl/factura_electronica/factura_mercado/estado_dte.pdf)) lo confirma. Una aceptación no prueba nada en producción.

## 2. Receptor de una NC que referencia una boleta sin RUT del comprador

**Respuesta corta:** el **RUT del propio emisor** (con su razón social), no `66666666-6`.
**Confirmado** para el RUT del emisor **[P]**; que `66666666-6` no sirva está **inferido**.

- **El SII:** "excepcionalmente y sólo cuando sea infructuosa la obtención de los datos del comprador"
  la NC se emite con el mismo contribuyente emisor como receptor
  ([FAQ boletas 001.380.6571](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_6571.htm),
  actualizada 14/07/2026; la copia de factura 001.003.6571 dice lo mismo, 21/12/2022) **[P]**.
  La guía para inscritos en factura agrega: si no hay datos, "digite el RUT de su propia empresa", y el
  documento queda en la categoría "no incluir" del Registro de Compras y Ventas **[P]**. Si la NC cae en un período ya declarado, hay que rectificar el F29 **[P]**.
- **El RUT genérico es solo de la boleta.** El formato de boletas lo creó para las boletas de ventas y
  servicios no periódicas ni domiciliarias (formato de boletas v2.0) y la Res. 74 lo repite para la
  boleta **[P]**. El formato de DTE (v2.2) no menciona `66666666-6`. Su RUT de receptor solo admite un
  cuerpo numérico válido, así que el esquema lo dejaría pasar; que el SII lo acepte en una 61 no está dicho **[no encontrado]**.
- **Mercado [S]:** LibreDTE documenta que para una boleta no nominativa (`66.666.666-6`) la NC se
  emite al RUT de la propia empresa
  ([manual](https://www.libredte.cl/docs/solucion-de-problemas/anulacion-o-rectificacion-de-un-dte.pdf?full=1),
  actualizado 10/10/2026). Coincide con el SII.
- **Campos del receptor en una 61** (formato v2.2, columna "Nota de crédito") **[P]**:

| Campo | Obligatoriedad en la NC |
|---|---|
| `RUTRecep` | Obligatorio (si falta, rechazo) |
| `RznSocRecep` | Obligatorio |
| `GiroRecep` | Opcional (el XSD lo declara opcional) |
| `DirRecep` | Opcional |
| `CmnaRecep` | Opcional |

  Para la NC que va al propio emisor, el nombre, el giro y la dirección salen del perfil fiscal.
  Si la boleta fue **nominativa** (RUT real), el receptor es ese comprador **[inferido]**; las FAQ solo
  tratan el caso sin datos como excepción.

## 3. Montos: formato factura sobre una boleta con montos brutos

**Respuesta corta:** la 61 informa `MntNeto`, `TasaIVA`, `IVA`, `MntExe` y `MntTotal`. Para pasar de
brutos a netos el formato ofrece `MntBruto=1`. El redondeo no está especificado.

- **Los campos son condicionales en la NC** (código 2 del formato v2.2): `MntNeto`, `IVA`, `TasaIVA` y
  `MntExe` aparecen si corresponden. El XSD los declara opcionales; `MntTotal` es obligatorio **[P]**.
- **`MntBruto` (Indicador de Montos Brutos):** `1` significa que las líneas de detalle, descuentos y
  recargos vienen con IVA; es condicional en la NC y vale **solo para documentos sin impuestos
  adicionales** **[P]**. Con el indicador encendido, `MntNeto` es la suma de las líneas afectas dividida por
  (1 + tasa); el `IVA` es `MntNeto × tasa`; el total es `MntNeto + IVA + MntExe` **[P]**. Es la misma lógica
  que la Res. 74 da para la boleta ("dividir por 1 + tasa de IVA", IVA igual a la tasa sobre el neto).
- **Redondeo:** **no encontrado**. El formato dice que el SII no rechaza por errores de contenido
  como que el IVA no sea `tasa × neto`, y que esos errores se corrigen con NC o ND **[P]**. La
  [Res. 121/2026](https://www.sii.cl/normativa_legislacion/resoluciones/2026/reso121.pdf) crea el estado
  "aceptado con reparos" y da como ejemplo una "inconsistencia en decimales" **[P]**; las fases se
  publican aparte y la primera etapa (instructivo de junio 2026) trata combustibles, ILA/IABA y adicionales,
  sin nada específico de la NC. Es la misma deuda de redondeo de [`impuestos.md`](../../features/impuestos.md) y el mismo `diferenciaIvaRedondeo` del motor de boleta.
- **Cuadre con la boleta [S]:** el SII marca como reparo `REF-2-780` una anulación cuyos montos difieren
  del documento referenciado (LibreDTE, [estados](https://www.libredte.cl/docs/procesos-sii/cuales-son-los-estados-al-enviar-un-dte-al-sii.pdf)).
  Recomendación **inferida**: para anular la boleta entera, **copiar** los cuatro montos congelados de la
  boleta (neto, IVA, exento, total) en vez de recalcular desde las líneas. Con un precio de góndola de $993 (neto 834, IVA 159) la fórmula da 158 y el total
  no cierra; la NC repetiría la misma diferencia que la boleta, que es lo más cercano a "documento
  idéntico" que se puede ofrecer.
- **Boleta exenta 41:** la NC lleva todo en `MntExe` y `MntTotal`, sin `MntNeto`, `TasaIVA` ni `IVA`,
  y las líneas con `IndExe=1` **[inferido de los códigos de obligatoriedad y del XSD]**. No existe una
  "NC exenta" como documento aparte: es la misma 61 sin IVA ([Laudus](https://laudus.cl/contenidos/contabilidad-sii/nota-de-credito-exenta/) **[S]**, que cita la FAQ 001.012.3566; esa URL no abre, **no encontrado en el SII**). Una NC con IVA sobre un documento exento se rechaza
  (`REF L[1]-3-764`, [Simplo](https://simplo.cl/herramientas/facturacion-electronica/esquema-dte/codref/) **[S]**).
- **Boleta con líneas afectas y exentas:** la boleta 39 admite ambas (Res. 74, definición de boleta electrónica **[P]**).
  La NC repite el reparto: líneas afectas con IVA incluido, líneas exentas con `IndExe=1`, `MntNeto` solo
  de las afectas. Una devolución parcial rebaja cada balde por separado; si el balde exento se pasa de
  lo que la boleta tenía, es el mismo problema de tope de la pregunta 4 **[inferido]**.
- **Los descuentos globales** se informan en `DscRcgGlobal` y entran en la base **[P]**; la NC de una boleta con descuento global debe reproducirlo.

## 4. Referencia: TpoDocRef, FolioRef, FchRef, CodRef, RazonRef

**Respuesta corta:** referencia con tipo 39 o 41, folio y fecha de la boleta; `CodRef` 1 para anular
entera, 3 para corregir montos (devolución parcial); `RazonRef` libre.

- **Los tipos 39 y 41 son válidos como documento de referencia** (tabla de `TpoDocRef` del formato v2.2) **[P]**.
  `FolioRef` y `FchRef` son obligatorios; `RazonRef` es opcional (hasta 90 caracteres) **[P]**.
- **`CodRef`** (1 anula, 2 corrige texto, 3 corrige montos): en el formato es **obligatorio en la NC**,
  aunque el XSD lo deja opcional **[P]**. Los casos de anulación completa y de corrección de texto
  **deben tener un único documento de referencia** **[P]**.
- **Anular la boleta entera: `CodRef=1`.** Lo da la FAQ de plazos y la Res. 45 para facturas ("campo
  que indique que se trata de una anulación"); para boletas el SII dice "se anula con una NC" sin
  nombrar el código **[inferido]**. LibreDTE y Nubox usan "Anula documento" **[S]**.
- **Devolución parcial: `CodRef=3`** **[inferido]**. El formato lo define para las NC "que corrigen
  montos de otro documento" **[P]**; el SII no lo ata expresamente a la boleta. LibreDTE lo usa así
  ("corrige montos", razón "Devolución") **[S]**. Un `CodRef=1` con montos de corrección da el reparo `REF-2-780` **[S]**.
- **Cambio de mercadería:** por un artículo de **menor** valor, NC por la diferencia, con referencia a
  la primera boleta; por uno de **mayor** valor, una **boleta nueva** por la diferencia que referencia la
  primera (Res. 74 F.9 y [FAQ 001.380.6570](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_6570.htm)) **[P]**. La
  [FAQ 001.380.6572](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_6572.htm) agrega que ese cambio sin NC se acepta solo si es por mayor valor.
- **Varias NC sobre la misma boleta:** no hay una regla escrita que las prohíba. Los estados de consulta del SII
  (`MMC` "existe NC que modifica montos", `ANC` "existe NC que anula", `TMC`) están pensados para eso
  ([API de boletas](https://www4c.sii.cl/bolcoreinternetui/api/openapi.json), [QueryEstDte](https://www.sii.cl/factura_electronica/factura_mercado/estado_dte.pdf)) **[P]**.
- **El tope (la suma de NC no supera la boleta):** **no encontrado en fuente primaria.** La investigación
  de julio lo da como "regla dura del SII"; esta pasada no halló el texto. Solo hay terceros que lo dicen
  de forma general: "una NC no puede rebajar más de lo que contenía el original" y no aclaran si es por
  NC o acumulado ([Simplo](https://simplo.cl/nota-de-credito-sii/)) **[S]**. El tope propio del sistema
  (`total_final − Σ NC`) se mantiene igual: es regla nuestra y barata, no depende de lo que valide el SII.

## 5. Canal de envío

**Respuesta corta:** la 61 va por el **SOAP/upload de factura**, en un `EnvioDTE` aparte; no hay
variante REST de factura publicada. **Confirmado**.

- **La API REST de boletas no acepta la 61:** su OpenAPI (v1.0.5) enumera solo los tipos 39 y 41 en las
  estadísticas de envío y en el detalle de reparos y rechazos **[P]**. El instructivo de boleta dice
  que esa plataforma es distinta de la de factura (otros servidores, otro token, track id de 15 dígitos) **[P]**.
  Los hosts de producción son `api.sii.cl` y `rahue.sii.cl` para boleta; `palena.sii.cl` recibe "DTE y RVD" **[P]** (descripción del OpenAPI).
- **El esquema lo confirma:** `DTEType` de `SiiTypes_v10.xsd` solo tiene 33, 34, 46, 52, 56 y 61; el
  envío de boletas usa otro esquema (`EnvioBOLETA_v11.xsd`) **[P, XSD local]**. Una 61 no puede ir en un `EnvioBOLETA`, ni una 39 en un `EnvioDTE`.
- **Flujo:** `CrSeed.jws` (semilla) y `GetTokenFromSeed.jws` (token) en
  `palena.sii.cl` (producción) o `maullin.sii.cl` (certificación); upload multipart a
  `/cgi_dte/UPL/DTEUpload` con la cookie `TOKEN`; consulta con `QueryEstUp.jws` (por track id) y
  `QueryEstDte.jws` (por documento: RUT del emisor, **RUT del receptor**, tipo, folio, fecha y monto)
  **[P]** ([autenticación](https://www.sii.cl/factura_electronica/factura_mercado/autenticacion.pdf),
  [envío](https://www.sii.cl/factura_electronica/factura_mercado/envio.pdf),
  [estado del envío](https://www.sii.cl/factura_electronica/factura_mercado/estado_envio.pdf)). Son
  manuales de 2003 a 2007 que el SII sigue enlazando; la guía de Blackend (2026) describe el mismo flujo **[S]**.
  **No encontré** un anuncio de una API REST de factura que lo reemplace (búsqueda en sii.cl y en la web).
  **El token de factura no sirve para boleta**: el instructivo de boleta pide uno específico para esa plataforma, así que son dos autenticaciones **[P]**.
- **Carátula del `EnvioDTE`** **[P]**: `RutEmisor`, `RutEnvia`, `RutReceptor`, `FchResol`, `NroResol`,
  `TmstFirmaEnv` y hasta 20 `SubTotDTE` (`TpoDTE` 61, `NroDTE` con la cantidad). El `RutReceptor` es
  **60803000-K**, "el RUT del SII", **confirmado para certificación** (instrucciones del set de pruebas);
  para producción lo usan las librerías que revisé **[S]**, sin una frase del SII. `FchResol` y
  `NroResol` son los de la resolución que autoriza el envío de DTE (en certificación, los publicados en los datos de empresa) **[inferido]**. El perfil fiscal guarda hoy una sola resolución, la de boleta; la de factura sería otra.
- **Estados de la respuesta** **[P]**. Del envío (`QueryEstUp`): `RSC` (rechazado por schema), `SOK`
  (schema validado), `RFR` (rechazado por firma), `FOK` (firma validada), `CRT`/`RCT` (carátula OK o
  rechazada), `PDR`/`PRD` (en proceso) y `EPR` (procesado), este último con los contadores
  informados, aceptados, rechazados y reparos. La API de boletas agrega `REC`, `RCH`, `RCO`, `RPR`
  (aceptado con reparos), `RPT` (repetido) y `VOF`. El detalle por documento de una factura llega por
  **correo** a la casilla registrada ("Factura electrónica continuará recibiendo sus diagnósticos a través de e-mail", instructivo de boleta); eso es un
  componente que la boleta no necesita. El estado del documento (`DOK`, `DNK`, `FAU`, `FNA`, `FAN`, `EMP` y los de NC existente) sale de `QueryEstDte`.
- **Aceptado con reparos (Res. 121/2026)** **[P]**: la resolución define aceptado, aceptado con reparos
  (inconsistencias menores que se corrigen "en documentos posteriores") y rechazado (schema, firma,
  TED, emisor, folio). Son documentos válidos y guardados; el SII indica que el reparo se
  puede corregir con una NC. Los niveles del OpenAPI de boletas son 1 (reparo leve), 2 (reparo) y 3 (rechazo).
- **Límites:** hasta **2.000 documentos por envío** (instructivo de factura A.3.3.4 y XSD) **[P]**. Para
  boleta son 500 por envío y se recomiendan 50 **[P]**. Un tamaño máximo en bytes **no se encontró**
  (el upload tiene un status 2 por tamaño, sin cifra). Las dos primeras líneas del XML deben tener el
  encoding ISO-8859-1 y el `schemaLocation`; con saltos de línea entre tags **[P]**.

## 6. Orden y dependencia: la boleta primero

**Respuesta corta:** sí, hay que esperar a que el SII tenga la boleta aceptada. **Confirmado** en
fuentes secundarias coincidentes; sin texto primario.

- **El SII rechaza una NC cuyo documento referenciado no recibió o no aceptó**: código `REF-3-750`,
  "DTE referenciado no recibido en el SII" (LibreDTE, Defontana y Simplo lo listan como rechazo) **[S]**.
  Un rechazo exige emitir un DTE nuevo, con otro folio de la 61 **[inferido]**.
- **LibreDTE lo previene en su software:** no deja referenciar un DTE que no tenga estado del SII o que
  esté rechazado ([manual](https://www.libredte.cl/docs/solucion-de-problemas/anulacion-o-rectificacion-de-un-dte.pdf?full=1)) **[S]**.
- **La norma primaria habla de documentos "aceptados"** (Res. 45/2003, resolutivo cuarto n.º 16, para anular facturas) **[P]**.
- **Qué hacer con una boleta rechazada:** no se anula con NC; se emite una boleta nueva (la rechazada
  no entró a las bases del SII). **Inferido** de la Res. 121 ("impidiendo su incorporación en las bases").
- **Cómo saber que la boleta está:** el estado del envío de boletas (REST) y la consulta por documento
  (`GET /boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado`, que pide RUT del receptor, monto o fecha)
  devuelven `DOK` (recibida) o `FAU` (no recibida) **[P]**. Esa misma consulta devuelve después `ANC` o `MMC` cuando la 61 entra: sirve para reconciliar.

## 7. Plazos

**Respuesta corta:** no hay plazo para *emitir* una NC sobre boleta; el plazo de **6 meses** limita el
derecho a **rebajar el débito fiscal**. Lo de "mismo período o el siguiente" es de facturas.

- **Seis meses (Ley 21.398, art. 4):** modificó los arts. 21 y 70 del DL 825, ampliando de tres a seis meses el plazo
  de la deducción por devoluciones y resciliaciones. **Confirmado**
  ([Circular 19/2022](https://www.sii.cl/normativa_legislacion/circulares/2022/circu19.pdf), 19-abr-2022) **[P]**.
  - **Bienes:** seis meses desde la **entrega** al comprador. Si la venta fue con boleta y el producto
    se despachó después, cuenta la fecha de la guía de despacho; si la entrega fue con la boleta, la fecha de la boleta.
  - **Servicios:** seis meses desde que se percibió la remuneración; si hubo boleta antes del pago, desde la boleta.
  - Aplica a devoluciones hechas desde la vigencia de la ley, aunque la venta sea anterior.
- **Los tres meses del art. 70 quedaron atrás**; el art. 70 hoy dice seis meses entre entrega y devolución
  y 30 días para pedir la devolución del impuesto, **pero esos 30 días son para los tributos que no son IVA**
  (la circular excluye el Título II, el art. 40 y el párrafo 3.º del Título III) **[P]**. El IVA se rebaja por el art. 21 n.º 2.
- **Después de los seis meses:** el emisor no puede rebajar su débito ([FAQ 001.003.7335](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_7335.htm),
  30/06/2025) **[P]**, y el formato tiene el campo `IndNoRebaja` para la NC "sin derecho a descontar
  débito (art. 70 DL 825)" **[P]**; que sea el que corresponde acá es **inferido**. Las operaciones **exentas** no tienen el límite de seis meses (misma FAQ).
- **"Mismo período o el siguiente":** es el plazo de la Res. 45/2003 (resolutivo cuarto n.º 16) y de las FAQ 001.003.7335 y
  [001.003.2167](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_2167.htm) para **anular facturas** (33, 46, 34) con
  la NC; si es posterior, se pide por formulario 2117 **[P]**. Ninguna de las dos menciona boletas.
  Para boletas **no encontré** un plazo de emisión de la NC. El portal de boletas solo advierte que, si la NC cae en un período ya declarado, hay que rectificar el F29 **[P]**.
- **Contraste con 2026-07-27:** coincide en lo central (seis meses desde la entrega, no desde el
  documento). Se suma que el cómputo cambia para servicios y para el despacho posterior, y que el
  tope de seis meses limita la **rebaja del débito**, no la emisión.
- **La afirmación de TUU** (solo se anula una boleta del mismo día) sigue sin respaldo: ni las FAQ ni
  las guías de anulación del SII la dicen, y el propio portal prevé NC en períodos ya declarados **[P]**.

## 8. CAF de la 61

**Respuesta corta:** el CAF de la 61 se pide aparte, por el mismo mecanismo de timbraje, y **vence a los
seis meses**. Hay que renovar y anular los folios que vencen sin uso.

- **Res. 58/2017 [P]:** los CAF autorizados desde el 01-07-2018 valen **seis meses** desde la fecha de
  autorización (`FA` del CAF). La restricción rige para los CAF "asociados a los documentos
  tributarios electrónicos que otorgan derecho al crédito fiscal" y **no enumera tipos**. Pasado el plazo, los
  folios sin usar "no podrán ser emitidos" y el SII **rechaza** el documento al recibirlo; los folios
  vencidos no usados **deben anularse** en el sitio del SII.
- **Que el 61 esté dentro:** Defontana ("folios de factura electrónica, nota de crédito y nota de
  débito valen 6 meses") y LibreDTE (`CAF-3-517`, "CAF vencido") lo afirman **[S]**. La
  [FAQ 001.003.6422](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6422.htm) **[P]**
  confirma que la 61 está sujeta a controles de antigüedad del CAF: reparo si es mayor a **24 meses**
  ("próximamente rechazo"), para facturas, liquidaciones, compras, NC y ND. Corrige entonces lo que decía la
  investigación del 13/10: la lista "33, 61, 56 vencen a los 6 meses" no está en la Res. 58, sale de terceros.
- **La boleta (39/41) queda fuera** de la restricción de seis meses (no da crédito fiscal): **inferido**;
  no hay frase del SII que lo diga.
- **Obtención:** por el portal, con certificado de firmante autorizado ("Timbraje electrónico", asterisco de facturador en el menú) **[P]**. Un CAF por tipo
  de documento: el de la 61 no sirve para la 39. El instructivo de boleta dice que en folios "no hay cambios" **[P]**.
- **Qué implica para el diseño [inferido]:** guardar la `FA` del CAF de la 61 y no tomar folios de un CAF con más de seis
  meses (el rechazo de un vencido es del SII, pero el envío ya habrá gastado el folio). Con pocas NC al mes,
  casi todo el CAF de 61 se va a vencer sin usar: pedir rangos chicos.

## 9. Entrega al cliente y timbre en la impresión

**Respuesta corta:** no encontré obligación de entregar la NC al consumidor; el timbre impreso sigue
siendo obligatorio para la 61, porque la Res. 207/2025 es solo de la boleta.

- **Entrega:** la obligación de entregar copia impresa o virtual (Res. 53/2025, del 29-abr-2025) es de la **boleta y el comprobante de
  pago** en ventas presenciales; la NC no se nombra **[P]**. Las normas de boleta no obligan a entregar la NC. No hay norma
  que la prohíba; entregar un comprobante es lo prudente cuando el local devuelve plata **[inferido]**.
  Cuando la NC va a nombre del propio emisor no hay "receptor" que la reciba.
- **Corrección a la investigación del 13/10:** esa investigación cita la Res. 12/2025 para la entrega.
  La [FAQ 001.380.8793](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_8793.htm) y el
  título de la [Res. 53/2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso53.pdf) dicen
  que la 53/2025 **deja sin efecto la Res. 12/2025** y la reemplaza por un solo texto **[P]**. Ojo: hay dos resoluciones 53 (2022, RCOF, y 2025, entrega); no son la misma.
  La [FAQ 001.380.7673](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7673.htm) (14/07/2026) todavía dice que lo virtual es la regla general, algo que la Res. 53/2025 quitó: la FAQ está desactualizada.
- **Timbre impreso:** la [Res. 207/2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso207.pdf) lo hizo
  opcional desde el 01-01-2026 para "las boletas electrónicas emitidas según Res. 74"; el TED sigue obligatorio en el XML **[P]**.
  Para la 61 rige el [manual de muestras impresas](https://www.sii.cl/factura_electronica/factura_mercado/manual_muestras_impresas.pdf)
  (v4.0, 2014): todos los DTE llevan el timbre PDF417 (mínimo 2×5 cm, abajo a 2 cm del borde izquierdo),
  con la leyenda "Timbre electrónico SII" y "Verifique documento: www.sii.cl" **[P]**. La NC **no** lleva cuadro de acuse ni copia cedible **[P]**.
  Que el SII haya relajado el timbre impreso de la 61: **no encontrado**.

## 10. Realidad chilena: cómo lo resuelven otros

Solo lo que publican; todo **[S]**.

| Quién | Qué publica |
|---|---|
| **LibreDTE** | NC 61 con la boleta referenciada y razón "Anula" desde el documento emitido; para boleta no nominativa (`66.666.666-6`), receptor = RUT de la propia empresa; no deja referenciar un DTE sin estado del SII o rechazado; una NC para varias boletas pide consultar al SII antes (referencia global, folio 0, rangos en el detalle). Documentación del 10/10/2026 ([anular](https://www.libredte.cl/docs/manual/facturacion/anular-documentos-emitidos.pdf)). |
| **Defontana** | NC con CAF 61 cargado; motivo "Anula", "corrige monto" o "corrige texto"; se elige la boleta y se importan sus datos; si la boleta rebajó stock, la NC debe reponerlo ([ayuda](https://intercom.help/defontanaerp/es/articles/3972390-anular-boleta-electronica)). No dice receptor, `CodRef` ni plazos. |
| **Nubox** | NC desde la boleta con motivo "Anula documento"; pide estar "inscrito y habilitado como facturador electrónico"; receptor normal o el emisor si no hay datos ([blog](https://blog.nubox.com/empresas/como-hacer-nota-de-credito-para-boleta-electronica)). |
| **Cuaderno Rojo** | Tres escenarios iguales a los del SII; el que solo tiene boletas va al portal del SII ([ayuda](https://intercom.help/cuaderno-rojo/es/articles/11652673-perfil-administrador-como-emitir-una-nota-de-credito-de-una-boleta-sii)). |
| **Toteat** | Anular una orden cerrada con boleta permite anotar el número y monto de la NC "solo como referencia"; si no se emitió una NC real, la boleta no queda anulada. La orden cerrada se anula hasta 7 días (configurable) ([ayuda](https://toteat.com/ayuda/operacion-en-restaurante/articulo-ayuda/anular-eliminar-ordenes-cerradas)). El límite de 7 días es de su POS, no del SII. |
| **Bsale** | No se pudo leer la página de ayuda (403). La investigación del 13/10 documentó su onboarding, no su NC. **No encontrado.** |
| **Fudo, Haulmer/OpenFactura, SimpleFactura** | No publican (o no se pudo abrir) cómo anulan o devuelven una boleta con NC. **No encontrado.** |

Lo común: ninguno publica que la NC de una boleta salga por el canal de boletas, y los que se
pronuncian sobre requisitos (Nubox, Cuaderno Rojo) la atan a la habilitación de factura. Toteat es el contraejemplo
útil: el POS puede **registrar** que la NC existe sin emitirla, que es lo que hoy hace nuestra "NC electrónica pendiente".

## 11. Casos borde que un emisor nuevo suele olvidar

1. **La NC es del mismo emisor que la boleta.** El `RUTOtr` del formato es para documentos de contribuyentes fusionados o absorbidos, no para boletas emitidas por otro. Una boleta de un tercero no se anula con nuestra 61 **[P, formato]**.
2. **Anular una boleta aún "en la cola"** (sin emitir, o enviada y sin respuesta): no hay nada que referenciar; se anula en el sistema y, si la boleta ya salió, hay que esperar su estado (pregunta 6).
3. **Una boleta rechazada no se anula con NC**; se reemplaza (pregunta 6, inferido).
4. **Un solo documento por NC de anulación** (`CodRef=1` exige referencia única). Una venta con varias boletas necesita varias NC **[P]**.
5. **Reparar el redondeo**: la NC que repite el IVA "mal redondeado" de la boleta hereda el reparo, no lo arregla (pregunta 3).
6. **Tope por balde** (neto, IVA, exento): una devolución parcial puede dejar el IVA de las NC sumando uno más que el de la boleta. No hay regla del SII escrita **[no encontrado]**.
7. **`IndNoRebaja` pasados los seis meses**, y exentas sin el límite (pregunta 7).
8. **La fecha:** la NC sale con su propia `FchEmis`; `FchRef` es la de la boleta. Hay un reparo leve si el envío excede las 12 horas desde la fecha del timbre (`DTE-1-650`) **[S]**; la boleta tiene su propia hora máxima (Res. 74 F.6), la 61 no tiene una regla publicada.
9. **Dos autenticaciones con el SII.** Token REST para boleta, token SOAP para factura; renovaciones distintas, hosts distintos, errores de formato distintos. Y un correo de diagnóstico que hay que leer.
10. **Los folios se gastan con el rechazo** (por esquema, por referencia): la 61 necesita el mismo cuidado de "tomar folio dentro de la transacción y no devolverlo" que ya tiene la boleta; la diferencia es que el CAF de la 61 vence.
11. **Boleta del terminal / voucher** ([`2026-10-01-emision-por-venta-y-boleta-del-terminal.md`](2026-10-01-emision-por-venta-y-boleta-del-terminal.md)): si la boleta no la emitió el local con su propio folio, la 61 no tiene folio ni fecha que referenciar **[inferido]**.
12. **ILA o impuestos adicionales:** `MntBruto` vale solo para documentos sin impuestos adicionales [P]; mientras el motor de boleta rechace `IMPUESTO_ADICIONAL_NO_SOPORTADO`, la NC no los ve, pero el día que entren, el mecanismo de brutos no sirve ([ILA en boleta](2026-10-14-ila-en-boleta-electronica.md)).
13. **Dos formatos publicados.** La página "Descripción del formato" enlaza `servicios_online/docs/formato_dte.pdf`, que es la versión 2.0 de 2014; la vigente es la 2.2 de 2019 (bajo `factura_mercado/`). Contrastar siempre con el XSD.
14. **El F29** (período ya declarado) y el **Registro de Compras y Ventas** (categoría "no incluir" cuando el receptor es el propio emisor) son del contador, no del emisor técnico **[P]**.

## Preguntas para el contador o el SII

Lo que quedó sin fuente o con fuentes que se contradicen. Las seis primeras son las que bloquean el diseño.

1. **(Bloqueante)** ¿Un contribuyente habilitado como emisor de boleta (Res. 74), sin certificación de
   factura, puede enviar por `DTEUpload` una 61 que anula o corrige una boleta propia? Si no: ¿es la
   certificación de factura completa (set de Factura + NC + ND) o hay un set reducido?
2. **(Bloqueante)** La guía de certificación de boletas dice que hay que ser emisor DTE previamente o
   certificarse en paralelo; la Res. 74 considerando 5.º dice que se eliminó esa condición. ¿Cuál rige hoy?
3. ¿Qué receptor acepta el SII para la NC de una boleta anónima: el RUT del emisor (lo que dicen las FAQ y las guías) o también `66666666-6`? ¿Y con razón social, giro y dirección del emisor?
4. ¿El SII valida que la suma de NC sobre una boleta no supere la boleta, por total o por balde? ¿Con qué código?
5. ¿`CodRef=3` es el correcto para la devolución parcial de una boleta, o corresponde `CodRef=1` con montos menores, o una boleta de reemplazo?
6. Tolerancia de redondeo del IVA en una 61 con `MntBruto=1`, y cuándo la Res. 121/2026 pasa a ser reparo o rechazo para la NC.
7. ¿Aplica a una NC sobre boleta el "mismo período o el siguiente" de la Res. 45/2003? ¿Y qué se hace con la NC emitida después de los seis meses (`IndNoRebaja`, F29, Registro de Ventas)? **Contador.**
8. ¿La Res. 58/2017 incluye expresamente a la 61? ¿Cuándo el reparo por CAF de más de 24 meses pasa a rechazo?
9. ¿Una NC para varias boletas con referencia global (`IndGlobal`, folio 0) es aceptada por el SII, o es una práctica de LibreDTE que hay que consultar caso a caso?
10. ¿Alguna resolución relajó el timbre impreso de la 61 como la 207/2025 lo hizo con la boleta?
11. ¿Existe una API REST de factura (o está prevista) que reemplace al SOAP? ¿El `RutReceptor` de producción es 60803000-K, como en certificación?
12. ¿La NC debe entregarse al consumidor cuando el local devuelve plata, o basta con el registro interno?

## Fuentes

**SII, normativa y documentos técnicos [P]:**

- [Res. Ex. SII 74/2020](https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf): boleta electrónica; F.7 a F.9 (NC para modificar, anular y cambios).
- [Res. Ex. SII 45/2003](https://www.sii.cl/documentos/resoluciones/2003/reso45.htm): certificación mínima (segundo n.º 3) y anulación de facturas (cuarto n.º 16).
- [Res. Ex. SII 58/2017](https://www.sii.cl/documentos/resoluciones/2017/reso58.pdf): vigencia del CAF, seis meses.
- [Res. Ex. SII 121/2026](https://www.sii.cl/normativa_legislacion/resoluciones/2026/reso121.pdf) y [instructivo de validaciones (junio 2026)](https://www.sii.cl/servicios_online/docs/instructivo_sobre_validaciones_dte.pdf).
- [Res. Ex. SII 207/2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso207.pdf) y [Res. Ex. SII 53/2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso53.pdf).
- [Circular SII 19/2022](https://www.sii.cl/normativa_legislacion/circulares/2022/circu19.pdf): Ley 21.398, arts. 21 y 70 DL 825.
- [Formato de DTE v2.2 (2019)](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte.pdf), [formato de boletas v2.0](https://www.sii.cl/servicios_online/docs/boletas_elec.pdf) y XSD locales (`DTE_v10`, `EnvioDTE_v10`, `SiiTypes_v10`).
- [Instructivo de emisión de factura (2021)](https://www.sii.cl/factura_electronica/factura_mercado/instructivo_emision.pdf), [instructivo de boleta (2021)](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf), [modelo de operación](https://www.sii.cl/factura_electronica/factura_mercado/modelo_operacion.pdf), [instrucciones del set de pruebas](https://www.sii.cl/factura_electronica/factura_mercado/inst_set_pruebas.pdf), [manual de muestras impresas](https://www.sii.cl/factura_electronica/factura_mercado/manual_muestras_impresas.pdf), [menú del sistema de mercado](https://www.sii.cl/factura_electronica/factura_mercado/menu_certificacion.html), [guía de certificación de boletas](https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm).
- Manuales SOAP: [autenticación](https://www.sii.cl/factura_electronica/factura_mercado/autenticacion.pdf), [envío](https://www.sii.cl/factura_electronica/factura_mercado/envio.pdf), [estado del envío](https://www.sii.cl/factura_electronica/factura_mercado/estado_envio.pdf), [estado del DTE](https://www.sii.cl/factura_electronica/factura_mercado/estado_dte.pdf).
- [OpenAPI de la API de boletas (v1.0.5)](https://www4c.sii.cl/bolcoreinternetui/api/openapi.json).
- Guías: [anular con factura](https://www.sii.cl/ayudas/boleta_electronica/anular_una_boleta_electronica_estando_inscrito_en_facturacion_electronica.pdf) y [sin factura](https://www.sii.cl/ayudas/boleta_electronica/anular_boleta_electronica_sin_estar_inscrito_en_facturacion_electronica.pdf).
- FAQ boletas: [5352](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_5352.htm), [6570](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_6570.htm), [6571](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_6571.htm), [6572](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_6572.htm), [7812](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7812.htm), [8793](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_8793.htm), [7673](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7673.htm). FAQ factura: [2167](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_2167.htm), [6422](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6422.htm), [7335](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_7335.htm).

**Secundarias [S]:**

- LibreDTE: [anular documentos](https://www.libredte.cl/docs/manual/facturacion/anular-documentos-emitidos.pdf), [anulación o rectificación](https://www.libredte.cl/docs/solucion-de-problemas/anulacion-o-rectificacion-de-un-dte.pdf?full=1), [estados al enviar un DTE](https://www.libredte.cl/docs/procesos-sii/cuales-son-los-estados-al-enviar-un-dte-al-sii.pdf).
- [Simplo, CodRef](https://simplo.cl/herramientas/facturacion-electronica/esquema-dte/codref/), [Simplo, errores del SII](https://simplo.cl/recursos/tabla-errores-sii/), [Simplo, nota de crédito](https://simplo.cl/nota-de-credito-sii/).
- [Defontana, anular boleta](https://intercom.help/defontanaerp/es/articles/3972390-anular-boleta-electronica) y [motivos de rechazo](https://intercom.help/defontanaerp/es/articles/13368894-motivos-de-rechazo-de-un-dte).
- [Nubox, NC para boleta](https://blog.nubox.com/empresas/como-hacer-nota-de-credito-para-boleta-electronica), [Cuaderno Rojo](https://intercom.help/cuaderno-rojo/es/articles/11652673-perfil-administrador-como-emitir-una-nota-de-credito-de-una-boleta-sii), [Toteat](https://toteat.com/ayuda/operacion-en-restaurante/articulo-ayuda/anular-eliminar-ordenes-cerradas), [Laudus, NC exenta](https://laudus.cl/contenidos/contabilidad-sii/nota-de-credito-exenta/).

**No pude abrir:** la ayuda de Bsale (403), la FAQ del SII 001.012.3566 sobre NC en operaciones exentas (404), la documentación de SimpleFactura y de OpenFactura (sin contenido útil).
