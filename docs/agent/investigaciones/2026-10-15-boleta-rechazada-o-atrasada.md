# Boleta rechazada por el SII o atrasada — investigación (2026-10-15)

> ⛔ **Lo que trae esta investigación NO es lo que hay que hacer.** Es una foto de lo que dicen
> la ley y el SII y de cómo lo resolvieron otros: **insumo para cruzar, analizar y adaptar a
> nuestra realidad**, nunca una verdad única a copiar. Se contrasta contra el código, los docs y la
> decisión del owner **antes** de que se vuelva diseño. Si el SII dice A y el owner decide B,
> gana B, y se documenta por qué. Frente fiscal: va solo y decide el owner (`CLAUDE.md`).

Pedido: antes de diseñar qué hace el local con una boleta **rechazada** y con una **atrasada** (más
de 1 hora sin llegar al SII), qué dice la norma y qué hace el mercado. No repite
[`emision-electronica.md`](../../features/emision-electronica.md) § "Envío al SII" (cómo funcionan
hoy la cola, los dos jobs y los estados) ni lo de
[`2026-10-13-emision-electronica-sii.md`](2026-10-13-emision-electronica-sii.md) y
[`2026-10-15-nota-credito-sobre-boleta.md`](2026-10-15-nota-credito-sobre-boleta.md); donde esta
pasada los matiza, lo dice.

**Marcas de nivel:** **confirmado con fuente** (lo leí en el documento), **inferido** (sale de
juntar fuentes, ninguna lo dice así), **no encontrado**. **Marcas de fuente:** **[P]** primaria
(ley, resolución, FAQ, formato, instructivo u OpenAPI del SII), **[S]** secundaria (proveedor,
blog). Los PDF se bajaron y se leyeron con `pdftotext`; las FAQ del SII se abrieron una por una (la
fecha es la de "actualización" de la propia página); el OpenAPI de la API de boletas (1.0.5) se
leyó entero; el Código Tributario y la Ley del IVA se leyeron en la versión consolidada de la BCN
(`leychile.cl`, fechas de versión 2025-07-11 y 2026-02-05).

⚠️ **Dos correcciones al encargo.** (1) La FAQ **001.003.6491** no dice lo de anular o reutilizar el
folio: habla de los folios que salta el sistema gratuito de facturación. El texto que el encargo
describe es la **FAQ 001.003.2167** (pregunta 1). (2) El OpenAPI define un cuarto valor por boleta,
**`RLV`** (aceptada con reparos leves), que el código de hoy no reconoce (pregunta 3).

## Resumen (≤8 líneas)

1. **Folio de una rechazada (1):** ninguna fuente del SII dice qué pasa con el folio de una boleta
   rechazada. Lo publicado cubre solo el error detectado **antes** de enviar (anular o reutilizar,
   FAQ 2167) y esa vía no aplica a una boleta ya enviada. Lo prudente, **inferido**: la de
   reemplazo lleva folio nuevo, el rechazado no se reusa ni se anula; el sobre rechazado entero es la excepción dudosa.
2. **Reemplazo (2):** no hay regla sobre su fecha, su plazo ni si referencia a la rechazada. La ley
   (art. 55 DL 825) pide la boleta en el momento de la venta; todo lo demás es **no encontrado**.
3. **Reparos (3):** la boleta aceptada con reparos es válida y **no exige NC**; el SII dice que se
   corrige en los documentos siguientes (Res. 121/2026) **[P]**. `RLV` falta en nuestro reparto.
4. **Atrasada (4):** el art. 97 n.º 10 CT sanciona "el no envío" de la boleta (multa y clausura); no hay
   criterio publicado para un atraso de horas. La única contingencia publicada es **sin cobertura de datos**.
5. **Códigos (5):** el SII **no publica un catálogo** de códigos para la API de boletas; solo secciones,
   niveles y estados. Los códigos concretos que circulan son de terceros.
6. **Mercado (6):** solo LibreDTE publica qué hace (rechazada = documento nuevo, folio saltado); Bsale,
   Haulmer, SimpleFactura, Fudo y Toteat: **no publican** (no encontrado).
7. **Borde (7):** un sobre rechazado por una boleta mala arrastra a las 49 buenas; una NC no puede
   referenciar una boleta rechazada; reenviar tarde puede salir como reparo leve (`DTE-1-650`).
8. **Para el contador o el SII:** 9 preguntas al final; las dos bloqueantes son el folio de la rechazada y la fecha del reemplazo.

---

## 1. Folio de una boleta rechazada

**Respuesta corta:** **no encontrado** un texto del SII que diga si el folio de una boleta rechazada
se considera usado, se puede reusar o se anula en el portal. Lo que sí está escrito cubre el error
**antes de enviar**, y excluye por su letra a una boleta ya enviada. **Inferido**, con riesgo medio:
tratar el folio rechazado como consumido y emitir el reemplazo con folio nuevo.

**Lo que dice el SII**

- **Error detectado antes del envío:** el contribuyente debe informar la nulidad del folio al SII
  **o reutilizar el folio** en futuras emisiones, y no enviar el documento al receptor. **Confirmado**
  ([FAQ 001.003.2167](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_2167.htm),
  actualizada 28/05/2025) **[P]**. Es la FAQ que el encargo citaba como 6491.
- **El texto original de ese criterio es más duro:** el folio informado como nulo "no podrá ser usado
  posteriormente", porque el SII lo considera inválido. **Confirmado** (Res. Ex. SII 45/2003,
  resolutivo cuarto n.º 17, según la numeración de la
  [página de sii.cl](https://www.sii.cl/documentos/resoluciones/2003/reso45.htm); la Res. 99/2019
  renumeró ese resolutivo) **[P]**. Las dos son compatibles si "reutilizar" se entiende como **no
  haber informado nunca el folio**.
- **La anulación de folios existe solo para lo que no se envió:** "sólo cuando los DTEs generados
  erróneamente no hayan sido enviados al SII". **Confirmado**
  ([Instructivo técnico de factura electrónica](https://www.sii.cl/factura_electronica/factura_mercado/instructivo_emision.pdf),
  28/10/2021, § 1.2) **[P]**.
- **Cada folio se usa una sola vez; los que no se usarán se anulan:** **confirmado**
  ([Res. Ex. SII 74/2020](https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf),
  letra F n.º 1 y 2; FAQ [001.380.6569](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_6569.htm)) **[P]**.
- **El SII rechaza un documento cuyo folio ya recibió:** causal del resolutivo cuarto n.º 12 letra e
  de la Res. 45/2003 **[P]**. Un documento **rechazado** "no se incorpora a las bases del SII"
  (Res. 121/2026, resolutivo 2 c) **[P]**. Juntas dicen que el rechazado no quedó en la base; no dicen
  si su folio vuelve a estar libre. **Inferido**: no lo dicen.
- **Sin correlatividad:** "no se exige correlatividad en la emisión de folios", así que un hueco no
  perjudica. **Confirmado**
  ([FAQ 001.003.7870](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_7870.htm),
  sobre el sistema gratuito de boletas) **[P]**.
- **Lo más cercano a "qué hacer con un rechazado":** "enviar nuevamente el DTE" y asegurarse de que
  quede recibido y aceptado, e informar a las partes. **Confirmado**
  ([FAQ 001.003.6216](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6216.htm),
  actualizada 23/09/2022) **[P]**. Habla de facturas con crédito fiscal usado por el receptor y no
  dice si el reenvío lleva el mismo folio.
- **El sistema gratuito del SII anula solo los folios que se salta**
  ([FAQ 001.003.6491](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6491.htm),
  29/05/2025) **[P]**: es lo más parecido a una política oficial para "un folio que no llegó a ser documento".

**Lo que dicen los terceros** (todo **[S]**):

- Simplo: `DTE-3-101` ("folio ya recibido") es rechazo final; el SII da el folio por usado "aun si el
  original volvió con reparos"; anular el folio tampoco sirve cuando ya llegó otro del rango; si
  hay que rehacer el documento, va con folio nuevo
  ([ficha](https://simplo.cl/herramientas/facturacion-electronica/errores/dte-3-101/), revisada 13/08/2026).
- LibreDTE: un rechazado "requiere corrección" y se **emite un DTE nuevo**; el folio saltado por un
  error de esquema no se recupera y el usuario lo anula después en el SII
  ([estados](https://www.libredte.cl/docs/procesos-sii/cuales-son-los-estados-al-enviar-un-dte-al-sii.pdf),
  [salto de folios](https://www.libredte.cl/docs/solucion-de-problemas/anulacion-o-rectificacion-de-un-dte.pdf?full=1)).
- Defontana y Nubox listan los motivos de rechazo pero **no dicen** qué se hace con el folio
  ([Defontana](https://intercom.help/defontanaerp/es/articles/13368894-motivos-de-rechazo-de-un-dte),
  [Nubox, 2021](https://blog.nubox.com/empresas/como-arreglar-un-dte-con-errores)).

**Las dos situaciones**

| | Rechazo del **sobre** entero | Rechazo de **una boleta** |
|---|---|---|
| Qué es | `RSC` (esquema), `RFR` (firma), `RCT` (carátula), `RCH`, `RCO`, `VOF`; en `detalle_rep_rech` llegan `folio` y `tipo` en `null` **[P, OpenAPI]** | El envío queda `EPR` y la boleta lleva `estado: RCH` con errores de nivel 3 **[P, OpenAPI]** |
| ¿El SII evaluó la boleta? | No: el esquema y la firma se validan antes (`RSC`/`RFR` van antes de `EPR` en el orden de estados del SII) **[P]**; Simplo: "ningún documento del envío se procesó" **[S]** | Sí, y la dejó fuera de sus bases **[P, Res. 121]** |
| ¿Folio usado? | **Inferido: no ante el SII.** La boleta nunca fue evaluada. Ninguna fuente lo confirma | **Inferido: sí, tratarlo como usado.** No hay texto; Simplo lo respalda **[S]** |
| ¿Reusar el mismo folio? | Del **mismo XML ya firmado**, en un sobre nuevo: plausible, **no encontrado**. Si hay que **rehacer** el XML con el mismo folio es otro documento con folio repetido: Res. 74 F.2 lo desaconseja y el cliente ya tiene un ticket con los datos viejos | **No** (Res. 74 F.2 + ticket entregado + `DTE-3-101` [S]) |
| ¿Anular en el portal? | La vía publicada exige "no enviado" **[P]**; este sí se envió. **No encontrado** | Igual: la vía publicada no aplica **[P]**; Simplo dice que el portal lo bloquea **[S]** |

**Qué sigue de aquí (inferido):** el folio de una rechazada **no se devuelve**; el reemplazo lleva
folio nuevo; el hueco es inocuo (FAQ 7870). Lo que queda abierto es el sobre rechazado entero, porque
puede haber 49 boletas buenas dentro (ver 7.1).

## 2. La boleta de reemplazo

**Respuesta corta:** el SII no publica nada sobre el reemplazo de una boleta rechazada: ni la fecha,
ni el plazo, ni si referencia a la rechazada. Lo único firme es el marco general: la boleta se emite
en el momento de la venta y se entrega de inmediato.

- **Marco legal:** las boletas se emiten "en el momento de la entrega real o simbólica de las
  especies" y, en servicios, en el momento en que se percibe la remuneración. **Confirmado**
  (art. 55 DL 825, versión BCN 2026-02-05) **[P]**. La boleta se entrega "de manera inmediata" y se
  envía al SII en un máximo de 1 hora (Res. 74 F.3 y F.6) **[P]**.
- **Fecha (`FchEmis`):** **no encontrado.** El formato define el campo como "fecha de emisión del
  documento" ([formato de boletas v2.0](https://www.sii.cl/servicios_online/docs/boletas_elec.pdf))
  **[P]**. La única regla publicada de fecha en contingencia es de **facturas**: emitir al terminar la
  contingencia "indicando la fecha en la cual se realizó la operación"
  ([FAQ 001.003.0891](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_0891.htm)) **[P]**.
  **Inferido:** dos fechas defendibles, la de la venta o la del día del reemplazo, y ninguna tiene
  respaldo. El tercero advierte de un efecto práctico: `TED-1-647` (reparo leve) si el período del
  documento difiere del del timbre y `DTE-1-650` si el timbre pasa de 12 horas al enviarlo **[S, LibreDTE]**.
- **Plazo para reemplazar:** **no encontrado.** El plazo de 6 meses de la Circular 19/2022 es para
  rebajar el débito fiscal de una devolución, no para reemplazar una boleta (ver la
  [investigación de la NC](2026-10-15-nota-credito-sobre-boleta.md#7-plazos)).
- **Referenciar a la rechazada:** **no encontrado.** El esquema de la boleta admite referencias
  (`Referencia`, hasta 40; XSD local `EnvioBOLETA_v11.xsd`) y la Res. 74 F.9 las usa para el cambio
  por un artículo de mayor valor, pero para el reemplazo de un rechazado nada lo pide. Referenciar un
  documento rechazado tiene mala fama: una NC que apunta a un DTE no recibido da `REF-3-750` **[S]**
  y LibreDTE no deja referenciarlo. **Inferido:** no referenciar.
- **El cliente que ya se llevó el ticket:** el encargo pregunta si tiene un derecho o una obligación.
  **No encontrado** texto sobre este caso. Lo que sí hay: no otorgar la boleta o no ponerla a
  disposición se sanciona con el art. 97 n.º 10 CT (Res. 53/2025,
  [FAQ 001.380.8795](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_8795.htm))
  **[P]**. **Inferido:** una boleta que el SII rechazó no cumple "otorgar la boleta", así que lo
  prudente es entregarle la nueva; no hay norma que diga cómo ni cuándo. El consumidor no usa crédito fiscal con la boleta, así que el daño al cliente es menor que en una factura.
- **El ticket impreso es un documento con un folio huérfano:** desde 2026 el timbre impreso es
  opcional (Res. 207/2025) **[P]**, y la representación debe indicar "verifique en www.sii.cl"
  (Res. 74 G). Quien verifique ese folio no lo encontrará. **Inferido.**

## 3. Aceptada con reparos

**Respuesta corta:** la boleta aceptada con reparos **es válida y el emisor no tiene que corregirla
con NC**. Lo que se espera es corregir la causa en los documentos siguientes.

- **Qué es:** "cumple las validaciones críticas (schema, firma, TED, folio…) pero presenta
  inconsistencias menores… que deberá ser corregida en documentos posteriores" (ejemplos: decimales,
  datos opcionales). **Confirmado** (Res. Ex. SII 121/2026, resolutivo 2 b,
  [PDF](https://www.sii.cl/normativa_legislacion/resoluciones/2026/reso121.pdf)) **[P]**. Las fases de
  las validaciones se publican aparte (el instructivo de junio 2026 cubre solo combustibles e ILA)
  **[P]**.
- **¿Hay que hacer algo con el documento?** La norma antigua dice que los reparos "podrán ser
  corregidos con Nota de Débito o Nota de Crédito, si corresponde" (Res. 45/2003, resolutivo cuarto
  n.º 14) **[P]**: es una facultad, no una obligación. LibreDTE agrega que "para reemplazar un
  documento con reparo por uno nuevo… el original debe ser anulado" **[S]**. Con la boleta, anular es
  con NC 61 (Res. 74 F.8), que hoy es el frente 2 y está en pausa. **Inferido:** dejarla.
- **Tres niveles en el OpenAPI, y un estado por boleta que nuestro código no conoce.** El nivel
  del error es 1 "reparo leve", 2 "reparo" o 3 "rechazo", y el estado **por boleta** puede ser `DOK`,
  `RPR`, `RCH` y **`RLV`** ("aceptado con reparos leves") **[P, OpenAPI]**. El reparto de
  `resultado-sii.ts` solo entiende `RCH` y `RPR`: una entrada `RLV` o `DOK` se trata como "código
  desconocido" y la boleta se queda `enviado` con un aviso, o sea **atrasada para siempre** aunque el
  SII la aceptó. **Confirmado** leyendo `repartirResultado`/`observar`. Es un hallazgo del código,
  no de la norma, para el frente.
- **Reparos típicos de una boleta** (el SII no publica la lista):
  - ejemplo del propio OpenAPI: sección `DET`, nivel 1, "valor del detalle distinto de precio ×
    cantidad" **[P, ejemplo]**;
  - la Res. 121 nombra "inconsistencia en decimales" **[P]**;
  - `DTE-1-650` (el timbre excede el plazo de envío: 12 horas), `TED-1-647` (período del timbre),
    `HED-1-232` (monto neto no mayor que cero), `TED-2-510` (firma del timbre: espacios extra en el
    nombre de un ítem) y `REF-2-780` (la NC difiere de lo anulado) **[S, LibreDTE]**;
  - **Inferido:** los reparos de montos y decimales encajan con el redondeo de plata; si el motor
    cuantiza distinto de lo que el formato espera, aparecen como `HED`/`DET`.

## 4. Atrasada (más de 1 hora sin llegar)

**Respuesta corta:** enviar tarde es un incumplimiento de la Res. 74 sancionable por el art. 97 n.º 10
o el 109 del Código Tributario; **no hay criterio publicado de cuánto atraso se sanciona** ni un
procedimiento de contingencia para "el SII no responde" o "nuestro servidor falló". La única
contingencia publicada es **sin cobertura de datos**.

- **La obligación:** enviar "de manera inmediata, con un plazo máximo de 1 hora, asegurando la
  correcta recepción". **Confirmado** (Res. 74 F.6) **[P]**.
- **La excepción:** "en aquellos casos en que no exista cobertura de datos" se autoriza a generar la
  boleta sin enviarla, y el plazo corre "desde el momento en que sea reestablecida la conexión".
  **Confirmado** (Res. 74 F.6 párr. 2, que remite a la Res. 99/2019; [FAQ 001.003.7676](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_7676.htm)) **[P]**.
  **Inferido:** la excepción es del local sin cobertura, **no** de una caída del SII ni de un fallo
  del software; el texto no cubre esos casos.
- **Corte de luz:** si de verdad no se puede emitir, se emite **una** boleta que resume las ventas de
  la contingencia y las copias se emiten después a quien las pida
  ([FAQ 001.380.7837](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7837.htm),
  15/07/2026) **[P]**. No sirve para nuestro caso: ya se emitió la boleta individual.
- **Sanción:** "el no otorgamiento **o el no envío de la información electrónica** al Servicio… de
  boletas": multa de 50 % a 500 % del monto de la operación (mínimo 2 UTM, máximo 40 UTA), clausura
  de hasta 20 días, y presidio o relegación menor por reiteración. **Confirmado** (art. 97 n.º 10 CT,
  versión BCN 2025-07-11) **[P]**.
  - La Res. 74 letra L y la [FAQ 001.380.7675](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7675.htm)
    remiten al n.º 10 "o" al art. 109 "según corresponda" (la letra L suma el n.º 6) **[P]**. El art.
    109 es la multa residual: 1 % a 100 % de una UTA **[P]**.
  - El SII gradúa el n.º 10 en el PASC (leve: 50 % de la operación y 2 días de clausura; grave: 300 %
    y 6 días, con rebajas por condonación)
    ([FAQ 001.145.8654](https://www.sii.cl/preguntas_frecuentes/infracc_pagos_giros_cond/001_145_8654.htm),
    23/06/2025) **[P]**. La tabla habla de "no otorgamiento de documentos".
  - **No encontrado:** ni una resolución ni una FAQ que diga si una boleta enviada con horas de atraso
    cae en el n.º 10 (por "no envío") o en el 109, ni cómo se detecta. **Inferido:** el "no envío" del
    texto de la ley apunta a la boleta que nunca llega; un atraso que se regulariza es más cercano a
    una infracción del 109.
- **Cómo lo ve el SII:** `DTE-1-650`, reparo leve por timbre de más de 12 horas **[S]**. Hoy no hay
  señal oficial de que el SII mida la hora de la Res. 74.
- **Procedimiento de aviso al SII:** **no encontrado.** La única petición administrativa publicada
  (formulario 2117) es para eximirse **de forma permanente** (zona sin cobertura, etc.)
  ([FAQ 001.380.7677](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7677.htm)) **[P]**.
- **Facturas con el SII caído:** se emiten después, con la fecha real de la operación (FAQ 0891)
  **[P]**. Es la única regla de "caída" publicada y es de factura.

## 5. Rechazo por error del emisor: qué códigos publica el SII

**Respuesta corta:** el SII **no publica un catálogo de códigos** para la API de boletas. El OpenAPI
1.0.5 declara `codigo` como entero sin lista, y enumera solo **secciones**, **niveles** y **estados**.
Los códigos con nombre (`DTE-3-101`, `REF-3-750`…) vienen de terceros. **Confirmado** que no hay
catálogo en el OpenAPI; la ausencia en el resto de sii.cl es **no encontrado**. Simplo dice lo mismo de
todo el SII ([tabla](https://simplo.cl/recursos/tabla-errores-sii/), "no es el catálogo oficial") **[S]**.

**Lo que sí publica el OpenAPI** ([openapi.json](https://www4c.sii.cl/bolcoreinternetui/api/openapi.json)) **[P]**:

- **Secciones del error:** `ENV` envío, `CRT` carátula, `TED` timbre, `CAF` autorización de folios,
  `DTE` documento, `HED` encabezado, `DET` detalle, `REF` referencias, `DRG` descuentos y recargos.
- **Niveles:** 1 reparo leve, 2 reparo, 3 rechazo.
- **Estado del envío:** `REC`, `SOK`, `CRT`, `FOK`, `PRD`, `EPR`, `RPR`, `RCH`, `RCO`, `VOF`, `RFR`,
  `RPT`, `RSC`, `RCT`.
- **Estado por boleta:** `DOK`, `RPR`, `RCH`, `RLV`.
- **Consulta por documento** (`/boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado`): `DOK`, `DNK`
  (recibido pero los datos no coinciden), `FAU` (no recibido), `FNA` (documento no autorizado), `FAN`
  (anulado), `EMP` (empresa no autorizada), `TMD`, `TMC`, `MMD`, `MMC`, `AND`, `ANC`.
- **Ejemplos del propio OpenAPI:** `CRT` código 11 "RUT envía diferente al Upload"; `HED` y `DET` con
  "valor del detalle distinto de precio × cantidad". Son ilustraciones, no una lista.

**Quién lo corrige** (**inferido** de la sección y de la causa; el SII no lo clasifica):

| Sección | Causa típica | ¿Lo corrige el local? | ¿Lo corrige el proveedor del software? |
|---|---|---|---|
| `CRT` carátula | RUT del emisor o del que envía, resolución, fecha, mismatch con el certificado (el ejemplo 11) | **Sí, si es dato del emisor**: RUT, razón social, certificado y su autorización en el SII | Si la carátula la arma mal el software |
| `ENV` / `RSC` / `RFR` | Esquema o firma del sobre | Solo si es un certificado vencido o sin autorización (se arregla en el SII) | **Sí**: es un bug de armado |
| `TED` / `CAF` | Timbre, folio no autorizado, fuera de rango o de otro RUT/ambiente; CAF vencido (facturas: 6 meses, `CAF-3-517` [S]; para boleta, Res. 58/2017 solo alcanza a los DTE con crédito fiscal, **sin vencimiento publicado**) | **Sí** si cargó un CAF del RUT o ambiente equivocado | **Sí** si el software asigna mal el folio |
| `DTE` | Folio ya recibido (`DTE-3-101`), repetido (`DTE-3-100`) [S] | No | **Sí**: es un reintento no idempotente o dos instancias con el mismo folio |
| `HED` encabezado | Montos, fecha, RUT receptor, razón social del emisor | **Solo** razón social, giro o dirección del emisor | **Sí** para montos y fechas: los calcula el software |
| `DET` detalle | Precio × cantidad, nombre de ítem (Res. 36/2024: descripción clara) [P, considerando 5 de la Res. 121] | **Sí** el nombre y la descripción del producto del catálogo, **para las ventas siguientes** | **Sí** para cantidades, decimales y redondeo |
| `REF` / `DRG` | No aplican a una boleta simple | No | Sí |

La conclusión de producto, **inferida**: casi todo rechazo de una boleta es del software; lo que el
local puede arreglar es poco y está en los **datos del emisor** y el **catálogo**, y se arregla para
**la siguiente** venta, no para la rechazada.

## 6. Realidad chilena: qué publican los proveedores

Solo lo publicado; todo **[S]** salvo el SII.

| Quién | Qué publica |
|---|---|
| **SII (sistema gratuito)** | Los folios que el sistema se salta "son automáticamente anulados" (FAQ 6491) y los saltos de folio no perjudican (FAQ 7870) **[P]**. No dice qué pasa con una boleta rechazada. |
| **LibreDTE** | El único que lo explica: tres estados (aceptado, con reparos, rechazado); rechazado = "requiere corrección… emisión de nuevo DTE"; actualiza el estado desde el SII; **no deja referenciar** un DTE sin estado o rechazado ("podría resultar rechazado"); el folio saltado por error de esquema no se recupera solo y se anula luego en el SII. Los links están en la pregunta 1. |
| **Simplo** (proveedor de errores) | Tabla de códigos observados; advierte contra re-emitir sin saber si el primero llegó (puede duplicar la venta y gastar otro folio); folio nuevo si se rehace ([guía](https://simplo.cl/herramientas/facturacion-electronica/guias/boleta-electronica-vs-factura/)). |
| **Defontana** | Ocho motivos de rechazo en lenguaje llano; dónde ver el mensaje del SII; nada sobre el folio. |
| **Bsale, Haulmer/OpenFactura, SimpleFactura, Fudo, Toteat** | **No encontrado.** No se halló ayuda publicada sobre una boleta rechazada o no enviada (Bsale, Fudo y Toteat no se pudieron abrir o no devuelven nada útil; `docs.openfactura.cl` rechazó la conexión; el sitio de SimpleFactura solo dice que "se la enviamos al SII"). |

Lo que dice el SII de los proveedores: quien usa software de mercado, "dicha aplicación deberá
enviar las Boletas" ([FAQ 001.380.7808](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7808.htm),
22/07/2026) **[P]**. La responsabilidad del reenvío es del software, no del local.

**Patrón común (inferido):** el reenvío automático de lo que falló en la red es la norma implícita;
una rechazada se resuelve **con un documento nuevo y folio nuevo**, y el reintento a ciegas de un
folio se evita porque puede duplicar.

## 7. Casos borde que un emisor nuevo suele olvidar

1. **Un sobre rechazado arrastra a las buenas.** Con 50 boletas por sobre, una sola con esquema malo
   da `RSC`/`RFR` al sobre entero **[S, Simplo: "ningún documento se procesó"]**. Nuestro reparto marca a las 50
   como `rechazado` (el doc lo dice). **Inferido:** las 49 buenas no están rechazadas por el SII y habría que separar el sobre; validar contra el XSD antes de enviar evita el caso.
2. **`RLV` y `DOK` por boleta se leen como código desconocido** y dejan la boleta `enviado` para siempre
   (pregunta 3). Una boleta aceptada con reparos leves, la más común de las observaciones, queda en la pantalla de atrasadas.
3. **Atrasada y reenvío tardío:** un reenvío fuera de plazo puede volver como reparo leve
   (`DTE-1-650`) [S]; con el `RLV` mal leído, el círculo se cierra.
4. **Una NC no puede referenciar una boleta rechazada** (`REF-3-750`) [S]. Una devolución sobre una
   venta cuya boleta está rechazada o atrasada tiene que esperar el estado o la boleta de reemplazo.
   La investigación de la NC ya tenía el caso "boleta aún en la cola" (caso 2 de su sección 11); este es el hermano.
5. **El ticket ya está entregado con el folio.** A diferencia de un software que emite recién al
   confirmar, nosotros imprimimos antes de que el SII conteste. Un rechazo deja un ticket con folio sin
   respaldo y un cliente que puede volver a exigirlo (Res. 74 F.3 y art. 97 n.º 10).
6. **Reusar un folio duplica un número ante el cliente.** Dos ventas con el mismo folio, una con ticket
   viejo y otra nueva: además del reparo, `DTE-3-100` ("folio usado en otro documento") [S].
7. **El IVA de una venta sin boleta aceptada.** El SII arma el Registro de Ventas con las boletas que
   recibe (Res. 53/2022, ver la investigación del 13/10); una rechazada o atrasada no está ahí aunque
   el local ya vendió. Cómo se declara es del **contador** **[P, no tratado]**.
8. **La hora de la Res. 74 corre desde que se emite**, no desde que se reintenta. La boleta de reemplazo
   abre su propio plazo de 1 hora **[inferido]** pero el atraso de la original ya ocurrió.
9. **Sobre repetido (`RPT`) o `STATUS 99`:** el SII ya tenía el sobre; no reenviar a ciegas
   (el doc de envío ya lo cubre) y reconciliar por `/estado` antes de reemplazar.
10. **CAF de boleta sin vencimiento publicado.** La Res. 58/2017 limita a 6 meses los CAF "de los DTE
    que dan derecho a crédito fiscal" **[P]**; la boleta no lo da. Ver pregunta al SII 8.
11. **Los folios no usados deben anularse.** Res. 74 F.1 y FAQ 6569 **[P]**: cada folio rechazado, saltado o de un CAF que se abandona es deuda de anulación en el portal. El hueco no se penaliza (FAQ 7870) pero el folio sin anular sí está dentro de lo que el SII "podrá requerir" al deshabilitar (Res. 74 M).
12. **Las FAQ del SII tienen fechas distintas y a veces se contradicen** (la FAQ 7871 aún habla del
    "Resumen de Ventas Diarias", derogado en 2022 por la Res. 53/2022 según el doc del 13/10). Contrastar con la resolución.

## Preguntas para el contador o el SII

Las dos primeras bloquean el diseño.

1. **(Bloqueante)** Una boleta **rechazada** (nivel 3, ya enviada): ¿el folio queda consumido, se
   puede reutilizar en la boleta corregida, o se anula en el portal? ¿Y si se rechazó el **sobre**
   entero (`RSC`, `RFR`, `RCT`) y las boletas buenas se reenvían tal cual en otro sobre?
2. **(Bloqueante)** ¿Con qué `FchEmis` se emite la boleta de reemplazo: la de la venta o la del día en
   que se reemite? ¿Hay un plazo para reemplazarla? ¿Debe llevar referencia a la rechazada?
3. ¿El cliente que se llevó el ticket con el folio rechazado debe recibir la nueva boleta? ¿Qué
   obligación hay si no se le puede ubicar (venta de mostrador)?
4. ¿Una boleta enviada con horas de atraso (porque falló el software o el SII) se sanciona por el n.º 10
   o por el 109 del art. 97? ¿Con qué criterio mide el SII la hora de la Res. 74 (fecha del timbre vs. recepción)?
5. ¿Existe un aviso o procedimiento de contingencia cuando el **SII** no responde o el software del
   emisor falla (no la falta de cobertura de datos)?
6. ¿Qué significan `RLV` y `DOK` por boleta en `detalle_rep_rech` y cuándo los devuelve el SII? ¿Hay
   un catálogo de códigos de la API de boletas que no esté en el OpenAPI?
7. ¿El SII acepta una boleta cuyo `FchEmis` es anterior a la fecha del timbre (reemisión)? ¿Con qué reparo?
8. ¿El CAF de la boleta tiene vencimiento (Res. 58/2017 solo cita los DTE con crédito fiscal)?
9. **Contador:** una venta cuya boleta está rechazada o atrasada: ¿el IVA se declara con la de
   reemplazo o la venta ya cuenta en el período original?

## Fuentes

**SII, normativa y documentos técnicos [P]:**

- [Res. Ex. SII 74/2020](https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf): F.1 a F.9, G, L, M. Es el PDF de 2020; las modificaciones posteriores se leyeron por separado, no consolidadas.
- [Res. Ex. SII 121/2026](https://www.sii.cl/normativa_legislacion/resoluciones/2026/reso121.pdf) e [instructivo de validaciones (junio 2026)](https://www.sii.cl/servicios_online/docs/instructivo_sobre_validaciones_dte.pdf).
- [Res. Ex. SII 45/2003](https://www.sii.cl/documentos/resoluciones/2003/reso45.htm), [Res. 58/2017](https://www.sii.cl/documentos/resoluciones/2017/reso58.pdf), [Res. 99/2019](https://www.sii.cl/normativa_legislacion/resoluciones/2019/reso99.pdf) y [Res. 207/2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso207.pdf).
- [Instructivo técnico de factura electrónica (28/10/2021)](https://www.sii.cl/factura_electronica/factura_mercado/instructivo_emision.pdf), [instructivo de boleta (28/10/2021)](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf), [formato de boletas v2.0](https://www.sii.cl/servicios_online/docs/boletas_elec.pdf) y XSD locales (`EnvioBOLETA_v11.xsd`).
- [OpenAPI de la API de boletas (v1.0.5)](https://www4c.sii.cl/bolcoreinternetui/api/openapi.json).
- FAQ de factura: [2167](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_2167.htm), [6216](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6216.htm), [6491](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6491.htm), [7870](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_7870.htm), [7676](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_7676.htm), [0891](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_0891.htm).
- FAQ de boletas: [6569](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_6569.htm), [7675](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7675.htm), [7677](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7677.htm), [7808](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7808.htm), [7837](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7837.htm), [8795](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_8795.htm).
- [FAQ 001.145.8654](https://www.sii.cl/preguntas_frecuentes/infracc_pagos_giros_cond/001_145_8654.htm): sanciones del PASC para el art. 97 n.º 10.
- Código Tributario (DL 830, arts. 97 n.º 6 y 10, y 109) y Ley del IVA (DL 825, art. 55) en la [BCN](https://www.bcn.cl/leychile/consulta/obtxml?opt=7&idNorma=6374) (idNorma 6374 y 6369).

**Secundarias [S]:**

- LibreDTE: [estados al enviar un DTE](https://www.libredte.cl/docs/procesos-sii/cuales-son-los-estados-al-enviar-un-dte-al-sii.pdf) (26/02/2024, actualizado 10/10/2026) y [anulación o rectificación](https://www.libredte.cl/docs/solucion-de-problemas/anulacion-o-rectificacion-de-un-dte.pdf?full=1).
- Simplo: [DTE-3-101](https://simplo.cl/herramientas/facturacion-electronica/errores/dte-3-101/), [errores](https://simplo.cl/herramientas/facturacion-electronica/errores/), [tabla de errores](https://simplo.cl/recursos/tabla-errores-sii/) y [boleta vs. factura](https://simplo.cl/herramientas/facturacion-electronica/guias/boleta-electronica-vs-factura/).
- [Defontana, motivos de rechazo](https://intercom.help/defontanaerp/es/articles/13368894-motivos-de-rechazo-de-un-dte) y [Nubox, arreglar un DTE con errores](https://blog.nubox.com/empresas/como-arreglar-un-dte-con-errores) (2021).

**No pude abrir o no encontré:** ayuda de Bsale, Fudo y Toteat sobre boletas rechazadas; la
documentación de OpenFactura (`docs.openfactura.cl` rechazó la conexión); un catálogo oficial de
códigos de error de la API de boletas; texto del SII sobre el folio de un documento rechazado.
