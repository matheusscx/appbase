# ILA y otros impuestos adicionales en la boleta electrónica — investigación (2026-10-14)

> ⛔ **Lo que trae esta investigación NO es lo que hay que hacer.** Es una foto de lo que dicen
> la ley y el SII y de cómo lo resolvieron otros: **insumo para cruzar, analizar y adaptar a
> nuestra realidad**, nunca una verdad única a copiar. Se contrasta contra el código, los docs y la
> decisión del owner **antes** de que se vuelva diseño. Si el SII dice A y el owner decide B,
> gana B, y se documenta por qué. Frente fiscal: va solo y decide el owner (`CLAUDE.md`).

Pedido del owner (2026-10-14): qué pasa con el ILA y otros impuestos adicionales cuando un local
vende con boleta electrónica (39/41). Es la pregunta que
[`emision-electronica.md`](../../features/emision-electronica.md) dejó en "Pendiente de decisión"
y por la que el motor rechaza con `IMPUESTO_ADICIONAL_NO_SOPORTADO`. No repite lo de
[`2026-10-13-emision-electronica-sii.md`](2026-10-13-emision-electronica-sii.md) (qué exige la norma,
quién vende la emisión).

**Marcas de nivel:** **confirmado con fuente** (lo leí en la ley o en un documento del SII),
**inferido** (sale de juntar fuentes, pero ninguna lo dice así), **no encontrado**.
**Marcas de fuente:** **[P]** primaria (ley, circular, resolución, FAQ del SII), **[S]** secundaria
(blog, transcripción de un oficio, comentario). Los PDF y la ley se bajaron y se leyeron enteros
(`pdftotext`; la Circular 10/1980 es un escaneo y se leyó como imagen). La fecha de cada FAQ del SII
es la de "actualizada" que muestra la propia página.

## Resumen (5 líneas)

1. **El ILA lo recargan y enteran el importador, el productor/elaborador, el distribuidor y el vendedor que vende a otro vendedor (art. 43 DL 825). La venta del comerciante minorista al consumidor no está afecta** (inciso final del art. 43): para un bar, restaurante o botillería que solo vende al público, el ILA que le cobraron en la factura de compra es **costo**, no crédito, y no es un impuesto de su venta. **Confirmado con fuente.**
2. Por eso la boleta de esa venta **no debe dar cuenta separada del ILA** (Circular 26/2021, §12) y el total de la boleta es simplemente el precio: neto = total / 1,19, IVA = 19 % de ese neto (fórmula de la Res. 74). **Confirmado.**
3. **El caso que sí necesita ILA propio es el contribuyente afecto que vende al público** (un productor con tienda o brewpub, un importador que vende al detalle, un vendedor que factura a otro vendedor). Ahí el SII exige separar IVA e ILA y **admite que se emita factura en vez de boleta porque el modelo de boleta no puede separarlo** (Ord. 624/2022; **[S]**, no se halló el original en sii.cl).
4. Nuestro motor, con el ILA configurado como adicional de venta, **parte el precio distinto** de como lo parte la ley para el minorista (ejemplo abajo: IVA $631 contra $798 en un trago de $5.000). Para el local típico el ILA no debería ser un adicional de venta.
5. **No se encontró** documentación pública de Bsale, Toteat, Fudo, Haulmer o LibreDTE sobre ILA en boleta, ni un pronunciamiento del SII sobre el restaurante que **prepara** tragos (si "elaborar" un cóctel lo vuelve elaborador del art. 43).

---

## 1. En una venta con boleta, ¿el ILA va en el precio y el total? ¿Se informa?

**Respuesta corta:** depende de **quién vende**, no del producto.

### a) El minorista que vende al consumidor (bar, restaurante, botillería)

- **El ILA no se informa en la boleta y no es un impuesto de esa venta.** La Circular 26 de 2021
  lo dice expresamente: el art. 69 ahora obliga a indicar separadamente "el impuesto" en facturas y
  boletas, y el desglose cubre todos los impuestos de la ley; pero "respecto del impuesto adicional
  a las bebidas alcohólicas, analcohólicas y productos similares […] el inciso final del artículo 43
  […] dispone que no se encuentran afectas […] las ventas del comerciante minorista al consumidor,
  por lo que la boleta que se emite en estas operaciones no deberá dar cuenta separada de este
  tributo". **Confirmado con fuente [P]**
  ([Circular 26/2021, §12](https://www.sii.cl/normativa_legislacion/circulares/2021/circu26.pdf);
  texto de la ley en la pregunta 2). La Circular 12/2025 solo deja sin efecto el N° 6 del Título II
  de la 26, no este punto **[P]**
  ([Circular 12/2025](https://www.sii.cl/normativa_legislacion/circulares/2025/circu12.pdf)).
- **¿Va en el total?** El total de la boleta es lo que paga el cliente. El ILA que pagó el local al
  comprar está dentro de su costo y por lo tanto dentro del precio de carta, pero **no aparece como
  una cifra**. **Inferido** de juntar la Circular 26 con la Res. 74.
- **Qué informa la boleta:** el XSD de boleta (`EnvioBOLETA_v11.xsd`, el que publica el SII y
  tenemos en `backend/src/modules/dte/esquemas/`) tiene en `Totales` solo `MntNeto`, `MntExe`,
  `IVA` y `MntTotal`; ni `ImptoReten` ni, en el detalle, `CodImpAdic` (la factura, `DTE_v10.xsd`,
  tiene los dos). **Confirmado, verificado en el archivo.**
  La Res. 74/2020 define `MntNeto` = (suma de los valores de las líneas afectas − descuentos +
  recargos) / (1 + tasa IVA); `IVA` = tasa × `MntNeto`; `MntTotal` = neto + IVA + exento
  ([Res. Ex. 74/2020, Anexo 1](https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf))
  **[P]**. No hay término para el ILA. Lo único que se imprime del impuesto es "El IVA de esta
  boleta es $X" (Anexo 2 de la misma resolución) **[P]**.

### b) El contribuyente afecto que vende al público (productor, importador, distribuidor)

- **El ILA sí le corresponde en la venta al consumidor** (art. 43 letras a, b, c; el inciso final no
  lo ampara porque no es minorista): la FAQ del SII responde "sí" al importador de licores que solo
  vende al detalle y al fabricante de cerveza artesanal que vende a restaurantes y botillerías
  ([FAQ 001.130.3078](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_3078.htm),
  [FAQ 001.130.5775](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_5775.htm))
  **[P]**. **Confirmado.**
- **Cómo se documentó, según la fecha del criterio.** Los tres puntos se contradicen y el último
  es el más reciente:
  1. **Circular 10/1980**: el débito del ILA "está representado por el total de este tributo
     consignado separadamente en las facturas, o **incluido en el precio total tratándose de
     operaciones con boletas**" **[P]**
     ([circu10c](https://www.sii.cl/documentos/circulares/1980/circu10c.htm), escaneo). Es anterior
     a la boleta electrónica y a la Ley 21.210.
  2. **Ord. 6/2021 de la Dirección Regional Valdivia (11 de enero de 2021)**: el desglose de la
     Res. 74 numeral F.4 cubre "solamente el IVA y los impuestos específicos a los productos
     suntuarios"; el ILA "no resulta comprendido en la obligación de desglosar", aunque sigue
     gravando "tanto las operaciones al por mayor como aquellas ventas al detalle" de los sujetos
     del art. 43 **[P]**
     ([Ord. 6/2021](https://www.sii.cl/documentos/normativa_ddrr/2021/los_rios/ordinario6_62033.pdf)).
     Es un oficio regional, no una circular.
  3. **Circular 26/2021 (21 de abril de 2021)**: el desglose en la boleta "debe ser para todos los
     impuestos regulados en la LIVS", con la única excepción del ILA del minorista (arriba); y se
     eliminó el inciso del art. 69 que decía que en las boletas el impuesto se entendía incluido en
     el precio **[P]**. Esto desplaza al punto 2 para el contribuyente afecto. **Inferido** que lo
     desplaza: la circular no cita el oficio.
  4. **Ord. 624/2022 (28 de febrero de 2022)**, un productor de cerveza artesanal: todas sus ventas,
     a otros vendedores y a consumidores finales, están afectas al 20,5 %; debe emitir boleta en la
     venta directa "consignando, en ambos casos, en forma separada tanto el IVA como ILA"; pero el
     modelo de boleta de la Res. 74 "no contempla la posibilidad de separar el valor
     correspondiente al ILA", así que **excepcionalmente, en las ventas en sus tiendas al público,
     puede emitir facturas electrónicas** (con la aplicación gratuita del SII u otro software)
     **[S]**
     ([vLex](https://vlex.cl/vid/ordinario-n-624-servicio-901744673), transcripción también en un
     [comentario de Círculo Verde](https://www.circuloverde.cl/como-documentar-tributariamente-operaciones-que-tienen-rebajas-o-montos-exentos-de-iva/)).
     **No encontré el original en sii.cl**: las URL del patrón `.../ley_impuesto_ventas/2022/ja624.htm`
     dan 404. Dos transcripciones independientes coinciden.
- **Conclusión del punto b:** hoy el SII reconoce que **la boleta electrónica no puede informar el
  ILA** y deja como salida la factura. **Confirmado con fuente** para "la boleta no tiene dónde
  informarlo"; **[S]** para "la salida es la factura".

---

## 2. ¿Cómo declara y paga el ILA el local que vende al consumidor final?

**Respuesta corta (la que importa): el minorista que solo vende al público no declara ILA propio. No tiene débito de ILA ni crédito imputable; el ILA que le recargaron en la factura de compra lo lleva a costo.** Lo recarga y lo entera quien está más arriba en la cadena.
**Confirmado con fuente** para la regla; **inferido** para aplicársela a un restaurante o bar (la ley no distingue por giro, ver más abajo).

### Lo que dice el DL 825

Texto consolidado de [leychile](https://www.bcn.cl/leychile/navegar?idNorma=6369) (versión 2026-02-05,
leído completo; el mismo texto en
[sii.cl](https://www.sii.cl/normativa_legislacion/sobreventasyservicios.pdf)) **[P]**:

- **Art. 42**: las ventas o importaciones de las especies que lista pagan un impuesto adicional
  "que se aplicará sobre la misma base imponible que la del impuesto al valor agregado". Tasas:
  letra a) analcohólicas, energizantes, jarabes y aguas con colorante, sabor o edulcorante **10 %**
  (**18 %** si superan 15 g de azúcar por 240 ml); letra b) licores, piscos, whisky, aguardientes y
  destilados, vinos licorosos o aromatizados **31,5 %**; letra c) vinos, espumosos, chichas,
  sidras, cervezas y otras bebidas alcohólicas **20,5 %**. Vigentes desde el 2014-10-01
  ([FAQ de tasas](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_1250.htm)).
- **Art. 43**: están afectos "por las ventas o importaciones que realicen": a) los importadores;
  b) los productores, elaboradores y envasadores; c) las empresas distribuidoras; d) "cualquier otro
  vendedor por las operaciones que efectúe con otro vendedor". Y el inciso final: **"No se encuentran
  afectas a este impuesto adicional las ventas del comerciante minorista al consumidor"**, ni la
  venta de vino a granel de productores a otros vendedores afectos.
- **Art. 44**: los contribuyentes del art. 43 tienen **crédito fiscal** contra el ILA por el que "se
  les haya recargado en las facturas que acrediten sus adquisiciones". **Art. 45**: se aplican los
  arts. 21, 22, 24 a 27. **Art. 65**: declaración mensual con el crédito total.
- La ley **no define "comerciante minorista"** ni distingue entre botillería y restaurante o bar. El
  Oficio 359/2007 lo dice: el término aparece solo en el párrafo final del art. 43
  ([Of. 359/2007](https://www.sii.cl/pagina/jurisprudencia/adminis/2007/ventas/ja4053.htm)) **[P]**.
  El art. 16 letra e) sí nombra a "restaurantes, […] bares, tabernas, cantinas, boites" como
  vendedores cuya base del IVA es "el valor total de las ventas, servicios y demás prestaciones", pero
  no habla del ILA.

### Lo que dice el SII sobre el crédito y quién lo recarga

- **FAQ del F29**: tres casos. El minorista que vende a otros vendedores calcula el crédito ILA por
  proporción de ventas afectas; **"los comerciantes minoristas que venden […] sólo a consumidores
  finales no deben determinar el crédito ILA, porque el impuesto pasa a formar parte del costo de
  venta"**; el que vende solo a otros vendedores tiene el 100 %
  ([FAQ 001.130.1899](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_1899.htm),
  actualizada 2025-06-16; [FAQ 001.130.2195](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_2195.htm))
  **[P]**. El Oficio 359/2007 dice lo mismo, según el resumen que leí: la venta del minorista al
  consumidor no lleva ILA y quien la hace no recupera como crédito el ILA de sus compras, lo
  soporta como mayor costo **[P]**.
- **Quién lo recarga**: el productor, importador o distribuidor lo recarga en la **factura de venta**
  (art. 44, Circular 10/1980 §III: "el impuesto adicional soportado en las adquisiciones […] que
  figure recargado separadamente en las facturas") **[P]**. El local lo paga adentro del precio de la
  factura de compra.
- **Dónde se declara** (solo para el contribuyente afecto): reverso del F29, bloque "Impuesto
  adicional a las bebidas alcohólicas, analcohólicas y productos similares". Débitos por tasa en las
  líneas 92 a 96 (códigos 577, 32, 150, 146 y 752); crédito recargado en facturas, líneas 101 a 105
  (575, 574, 580, 582, 753) y crédito imputable (576, 33, 149, 85, 754) "de acuerdo a Circular N° 10
  de 1980"; remanente 508; resultado a pagar 506 o remanente 507
  ([instrucciones del F29, 2024-11-12](https://www.sii.cl/servicios_online/instrucciones_f29_20241112.pdf)) **[P]**.
  Dato útil de la propia tabla del SII: en la factura el ILA de cerveza y bebidas alcohólicas va con
  el código de impuesto 26 y se declara en el código 150; licores 24; vinos 25; analcohólicas 27 y
  azucaradas 271 (anotado en el XSD del SII y en el
  [Formato DTE 2.5 de 2026-02](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf))
  **[P]**. Los códigos 150 y 151 que se mencionaron al armar la pregunta **no son retención de ILA**: el
  150 es el débito por cervezas/bebidas alcohólicas y el 151 es retención de honorarios.
- **Qué no declara el minorista de solo-consumidor**: ningún débito de ILA. Si debe llenar la
  columna informativa de "total recargado en compras" con crédito imputable en cero: **no
  encontrado** (la FAQ del recuadro dice que quienes venden directo al consumidor "deben registrar el
  total del impuesto recargado" y usan como crédito "sólo una proporción"
  ([FAQ 001.130.1606](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_1606.htm));
  para el de solo-consumidor la proporción es cero). Es tema del contador del tenant, no del POS.

### El restaurante o bar que prepara tragos frente a la botillería

- **Inferido, sin pronunciamiento que lo confirme**: el bar que compra el licor (con ILA recargado) y
  lo sirve, solo o mezclado, es un vendedor al detalle que no vende a "otro vendedor"; cae en el
  inciso final y el ILA es costo. La Circular 10/1980 enumera a los afectos: "los licoristas;
  productores, elaboradores y envasadores de vinos; los distribuidores; los fabricantes de cervezas
  u otras bebidas alcohólicas; los productores de chichas y sidras, y los importadores", es decir,
  quienes **fabrican, distribuyen o importan la especie del art. 42**; preparar un pisco sour con piscos ya gravados no encaja con
  esa lista, pero **la ley y las circulares no lo dicen**.
- **Sí hay una zona gris real con elaboradores propios**: un restaurante que **produce** la cerveza
  o el vino que vende (brewpub) es productor del art. 43; el Ord. 624/2022 grava todas las ventas del
  productor, también al público **[S]**. El mismo local, entonces, no es minorista para esa
  cerveza. Oficio 603 de 2026 (productor con sala de venta en el predio, sin llevar a consumir en el
  local): sus ventas minoristas también están gravadas porque vende como productor
  ([comentario de BBSC](https://www.bbsc.cl/oficio-n603-del-2026-impuesto-a-bebidas-alcoholicas-en-venta-efectuada-a-consumidores-finales-2/),
  **[S]**; no traía el link del SII).
- **Otra zona gris, no cubierta**: el minorista que le **factura** a una empresa. El art. 43 letra d)
  afecta "las operaciones que efectúe con otro vendedor"; la FAQ 1899 dice que el minorista que
  vende a otros vendedores calcula crédito proporcional **[P]**. Si una empresa que compra un cajón de
  cervezas para su oficina cuenta como "otro vendedor": **no encontrado**.

---

## 3. ¿Cómo calcula el IVA de la boleta el SII cuando el precio incluye ILA? ¿La base del IVA incluye el ILA?

**Respuesta corta:** la ley saca el ILA de la base del IVA **cuando el ILA grava la operación**; la boleta de un minorista no lleva ILA, así que su base es el precio entero.

- **Art. 15, último inciso**: "No formarán parte de la base imponible el impuesto de este Título, **los de
  los Párrafos 1°, 3° y 4° del Título III** [el Párrafo 3° es el ILA], el [DL 826] […] y aquellos [de los
  combustibles], **que graven la misma operación**". El art. 42 dice a su vez que el ILA se aplica
  "sobre la misma base imponible que la del IVA". Juntos: **IVA = 19 % × neto e ILA = tasa × el mismo
  neto, ninguno sobre el otro**. **Confirmado con fuente [P]** (texto de la ley). El Oficio 359/2007 lo
  resume: no hay impuesto sobre impuesto.
- **Lo mismo se ve en la factura electrónica**: `MntTotal` = neto + exento + IVA + **impuestos
  adicionales** + …; el neto no incluye el ILA ([Formato DTE 2.5, campo 124](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf))
  **[P]**.
- **En la boleta** no hay término de impuestos adicionales: `MntTotal` = neto + IVA + exento y
  `MntNeto` = total afecto / 1,19 (Res. 74, arriba) **[P]**. Para la venta del minorista esto da la
  base correcta: el ILA que pagó el local es costo, así que no lo grava "la misma operación" y queda
  dentro de la base del IVA como cualquier otro componente del costo. **Inferido**: ninguna fuente
  lo enuncia para la boleta; sale de leer el art. 15 junto con el art. 43 inciso final.
- **Para el contribuyente afecto que vende con boleta** la fórmula de la Res. 74 daría un neto inflado
  (dividir por 1,19 un total que ya trae el ILA), y por eso el SII no deja que lo haga por boleta
  (Ord. 624/2022, arriba). **Inferido** de juntar la fórmula con el criterio del oficio **[S]**; no
  encontré nada del SII que cuadre una boleta con ILA.

---

## 4. ¿Cómo lo resuelven los emisores y POS chilenos? (foto, no regla)

**No encontrado para los que pidió el owner.** Se buscó documentación de ayuda, FAQ, foros y la
documentación de API de cada uno:

| Proveedor | Qué salió sobre ILA en boleta |
|---|---|
| Bsale | **Nada público.** |
| Toteat | **Nada público.** Coincide con la investigación del 2026-08-02 (de Toteat no sale nada). |
| Fudo | **Nada público** (se buscó en `soporte.fu.do`). Su ayuda ya decía que no emite exentos ni más de un giro. |
| Haulmer / OpenFactura | **Nada** sobre ILA ni sobre códigos de impuesto en boleta. |
| LibreDTE | **Nada.** El manual de emisión de boleta ([PDF](https://www.libredte.cl/docs/manual/facturacion/emitir-boleta-electronica.pdf), 87 líneas) no menciona impuestos adicionales. |
| Nubox | Blog contable, no ayuda del producto: el ILA "no se debita con el consumidor final, sino que se traspasa vía costo"; quien solo emite boletas lo lleva a costo y "los clientes comunes reciben una boleta con el total final" ([claves del ILA](https://blog.nubox.com/contadores/claves-del-impuesto-ley-de-alcoholes), [impuesto bebidas alcohólicas](https://blog.nubox.com/contadores/impuesto-bebidas-alcoholicas-chile)) **[S]**. Coincide con la Circular 26. |
| Defontana | Su ERP permite asociar un "impuesto adicional" a un artículo y lo aplica en la venta ([ayuda](https://intercom.help/defontanaerp/es/articles/4029592-como-asociar-un-impuesto-especifico-a-un-articulo-en-erp)) **[S]**. **No dice nada de boleta**: es el mecanismo de la factura. |
| SII (facturador gratuito) | Permite registrar las distintas tasas del ILA ([FAQ 001.003.5047](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_5047.htm)) **[P]**: de nuevo, facturas. |

**Lo único que sí se sabe:** el SII mismo no resolvió el problema dentro de la boleta (Ord. 624/2022,
**[S]**), así que lo esperable es que ningún emisor de boleta tenga un campo para esto. Eso es una
**inferencia**, no un hallazgo: nadie publicó cómo lo hace.
Si esto se confirma, es un candidato a `docs/DIFERENCIADORES.md` ("ningún POS documenta cómo trata el
ILA en boleta"); no lo toqué porque el pedido era escribir solo este documento.

---

## 5. ¿Pasa lo mismo con las analcohólicas azucaradas y con los suntuarios?

### Bebidas analcohólicas (10 % y 18 %)

**Sí, es el mismo régimen. Confirmado con fuente.** Están en la letra a) del art. 42, el sujeto es
el del art. 43 y el inciso final del art. 43 ("este impuesto adicional") cubre a todo el art. 42. La
Circular 26 lo dice con las tres palabras: "bebidas alcohólicas, **analcohólicas** y productos
similares" **[P]**. En la factura, el código de impuesto es 27 (10 %) o 271 (18 %, más de 15 g por
240 ml) **[P]** (Formato DTE 2.5).

- Cuidado con un dato que circula: la **Circular 11/2024** (néctares, isotónicas e hipotónicas pasarían
  a la letra a) del art. 42) **fue dejada sin efecto por la Circular 33 del 26 de julio de 2024**
  ([Circular 33/2024](https://www.sii.cl/normativa_legislacion/circulares/2024/circu33.pdf)) **[P]**.
  Una búsqueda genérica la devuelve como vigente. Qué productos están afectos es una pregunta aparte
  y no se investigó acá.

### Suntuarios (art. 37 letras a, b, c: oro, platino y marfil; joyas y piedras preciosas; pieles finas)

**No es el mismo régimen.** Confirmado con fuente **[P]**:

- Tasa **15 %**, sobre la primera venta o importación (art. 37), pero **las letras a), b) y c)
  quedan afectas "por las ventas no gravadas en dicha disposición"** (art. 40): se cobra también en
  la venta al detalle. **No hay excepción del minorista** (esa vive en el art. 43, que es del ILA).
- Para estos sí corre el desglose en la boleta: Res. 74 numeral F.4 ("la boleta electrónica deberá
  indicar separadamente el IVA y los impuestos señalados en las letras a), b) y c) del artículo 37") y
  la Circular 26 (nota 19: "el otro impuesto comprendido en esta obligación es el establecido en el
  artículo 40 […] en relación con el artículo 37 letras a), b) y c)") **[P]**. La FAQ vigente del SII
  repite esa obligación (actualizada 2026-07-14,
  [FAQ 001.380.7672](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7672.htm)).
- **Pero el formato de boleta no tiene un campo para informarlo** (mismo XSD) y la tabla de códigos del
  Formato DTE 2.5 lista el 23 solo para facturas, notas de crédito y de débito **[P]**. **No
  encontré** cómo cumple una joyería con la F.4 dentro de la boleta XML. Para un bar o restaurante
  este punto es irrelevante en la práctica: no vende estas especies.
- El resto del art. 37 (alfombras finas, caviar, pirotecnia, armas de aire) es de primera venta o
  importación y no se cobra al detalle.

---

## 6. Qué implica para nuestro modelo

*Describe opciones y costos. No decide: la decisión es del owner.* Cruzado contra
[`impuestos.md`](../../features/impuestos.md), [`motor-calculo-precios.md`](../../features/motor-calculo-precios.md)
y el código del motor DTE.

### Hechos del código que importan

- Un ítem puede llevar impuestos adicionales (`item_impuestos`, `tipo='otro'`). El motor de precios,
  si el precio incluye impuesto, calcula `neto = precio / (1 + Σ tasas)` y cada tasa sobre ese neto
  ([`motor-calculo-precios.md`](../../features/motor-calculo-precios.md), "Desbruteo"). Esto es
  **consistente con la ley para el afecto** (ILA sobre el mismo neto que el IVA, art. 15 y 42).
- `ventas.monto_impuestos` y los baldes de `venta_documentos` suman IVA y adicionales, y el contrato
  del motor DTE (`MontosBoleta.adicionales`) lo rechaza si es mayor que cero
  (`IMPUESTO_ADICIONAL_NO_SOPORTADO`).
- El ILA **no se siembra** (`impuestos.md`, "NO incluido"): solo existe si un tenant lo crea como
  impuesto personalizado. La tasa 0,205 que cita el doc es la que ese tenant tipearía.

### El desajuste, con números

Trago de **$5.000** con el precio que incluye impuestos y un ILA del 31,5 % configurado como
adicional de venta (el caso del owner: pisco sour), contra lo que la ley y la Res. 74 piden **para
el minorista**:

| | Motor hoy (ILA como adicional) | Ley para el minorista + Res. 74 |
|---|---|---|
| Neto | $3.322 (5.000 / 1,505) | $4.202 (5.000 / 1,19) |
| IVA | $631 | $798 |
| ILA | $1.047 | $0 (es costo) |
| `monto_impuestos` | $1.678 | $798 |

Con cerveza al 20,5 %: IVA $681 contra $798. **Si el local declara ILA como adicional de venta, el
IVA que el sistema congela queda por debajo del que corresponde y no coincide con lo que el XML de la
boleta debe decir** (el XML solo admite neto/IVA/total, y el formato define `IVA = tasa × MntNeto`). El
motor de boleta "verifica lo congelado, no lo recalcula" (ADR-010): así que ese desajuste saldría a
la luz recién al emitir. **Inferido** (cruza el código con las fuentes de las preguntas 1 a 3).

### Opciones

**A. El ILA no es un impuesto de venta para el local típico. El ítem no lleva adicional; el ILA vive en el costo.**
- Es lo que dicen la ley, la Circular 26 y la FAQ del F29, y coincide con lo que ya hace el sistema
  si el tenant no crea el impuesto. El motor sigue rechazando el adicional en la boleta, y esa
  regla pasa de "falta definir" a "correcto para el minorista".
- Costo: casi cero de motor. Hay que **evitar que el tenant lo cree por buena fe**: una nota en la
  pantalla de impuestos o un aviso si el nombre dice ILA/alcohol. Y no sirve al contribuyente afecto
  (opción D).
- Cuidado con lo que implica: el costo de la bebida (con su ILA) sale de compras, no de ventas;
  nada cambia ahí.

**B. Mantener el ILA como adicional de venta y, al emitir la boleta, recalcular neto e IVA como pide la Res. 74 (total / 1,19).**
- Cabe en el XML, pero **rompe la regla de "congelar el hecho fiscal en la transacción"**: el sistema
  tendría dos juegos de montos (el interno y el declarado) que difieren. Es el tipo de divergencia
  que el diseño del motor evitó a propósito.
- Costo: alto (dobles baldes, doble verificación, el reporte de ventas no cuadra con el SII) y
  deja `monto_impuestos` sin sentido. **No recomendable sin una razón que no vi.**

**C. Un marcador por ítem o tenant: "ILA soportado (costo)" frente a "ILA que recargo (afecto)".**
- Separa los dos mundos. El primero es la opción A; el segundo exige una de D o E. Un tenant
  **afecto** (productor, importador, distribuidor, brewpub) es un **estado legal del contribuyente**,
  no de un ítem: pertenece al perfil fiscal del emisor (subproyecto 1), no al catálogo.
- Costo: columna nueva, UI y una decisión de quién la declara (el tenant, con su contador). Hoy no
  hay forma de validarlo desde el sistema.

**D. Para el afecto que vende al público: emitir factura (33) y no boleta, como admitió el Ord. 624/2022 [S].**
- Es la única salida que el SII dio. Requiere un emisor de **factura** (hoy el motor es solo
  39/41), `ImptoReten` con los códigos 24/25/26/27/271 y `CodImpAdic` por línea, un receptor con RUT
  (la venta al paso sería una factura con RUT genérico: **no encontrado** si el SII lo admite, el oficio
  habla de "tiendas al público"), y el débito del ILA en la contabilidad del tenant.
- Costo: un frente entero (factura, nota de crédito 61 para devoluciones, receptor, CAF de otro
  tipo). No es de este motor. Conviene confirmar el oficio original antes de apoyarse en él.

**E. Dejar el rechazo como está y documentar que el local típico no necesita esto.**
- La nota de la spec del motor dice que "un restaurante que vende tragos lo necesita desde el primer
  día". Según esta investigación, **eso es probablemente falso para el restaurante-minorista**
  (opción A) y verdadero solo para el afecto. Costo: cero. Riesgo: que un tenant afecto aparezca
  antes de resolver D.

### Preguntas para el contador o para el SII, antes de decidir

1. ¿Un restaurante o bar que **prepara** el trago (mezcla licores ya gravados) es "comerciante
   minorista" del art. 43 inciso final, o puede considerarse elaborador? (No hay pronunciamiento.)
2. ¿Un restaurante-cervecería (brewpub) que vende cerveza propia a sus clientes en el local es productor
   afecto en todas las ventas, como dice el Ord. 624/2022 para las tiendas?
3. ¿Una **factura** de un minorista a una empresa por alcohol es venta a "otro vendedor" (art. 43 letra
   d) y lleva ILA?
4. ¿Se puede conseguir el texto original del Ord. 624/2022 y el 61/2022 que cita?
5. ¿Cómo cuadra la boleta de un afecto, si el SII la acepta con el ILA adentro, y qué IVA declara?

---

## Tabla de confianza

| # | Afirmación | Nivel | Fuente |
|---|---|---|---|
| 1 | Art. 43: el ILA lo deben importador, productor/elaborador, distribuidor y vendedor a otro vendedor; la venta del minorista al consumidor no está afecta | **Confirmado con fuente** | DL 825 art. 43 (leychile, 2026-02-05) |
| 2 | El minorista de solo-consumidor no determina crédito ILA: es costo | **Confirmado con fuente** | FAQ SII 001.130.1899 (2025); Of. 359/2007 |
| 3 | La boleta de la venta del minorista "no deberá dar cuenta separada" del ILA | **Confirmado con fuente** | Circular 26/2021 §12 (no tocado por la Circ. 12/2025) |
| 4 | La boleta electrónica no tiene campo para impuestos adicionales (ni `ImptoReten` ni `CodImpAdic`) | **Confirmado con fuente** | XSD del SII; Res. 74 Anexo 1 |
| 5 | `MntNeto` = total afecto / 1,19; `MntTotal` = neto + IVA + exento | **Confirmado con fuente** | Res. 74/2020 Anexo 1 |
| 6 | El ILA no integra la base del IVA cuando grava la operación; IVA e ILA se calculan sobre el mismo neto | **Confirmado con fuente** | DL 825 arts. 15 (inciso final) y 42; Of. 359/2007 |
| 7 | En el F29, débitos y créditos del ILA van en líneas 92 a 112 y los llena solo el afecto | **Confirmado** (códigos); **inferido** (que el minorista de solo-consumidor no llena débito) | Instrucciones F29 2024-11-12 |
| 8 | La base del IVA de la boleta del minorista incluye el ILA que pagó el local (por ser costo) | **Inferido** | Art. 15 + art. 43 inciso final; nadie lo enuncia |
| 9 | Un restaurante o bar que prepara tragos es minorista y no elaborador | **Inferido** | Circular 10/1980 (lista de afectos); sin pronunciamiento |
| 10 | El afecto que vende al público con boleta debe separar IVA e ILA; el SII admite factura por la limitación del modelo | **Confirmado** (que hay que separar: Circ. 26); **[S]** (la salida de la factura) | Circular 26/2021; Ord. 624/2022 vía vLex y Círculo Verde |
| 11 | El criterio de 2021 (Ord. 6 regional: el ILA no se desglosa) quedó desplazado por la Circular 26 y el Ord. 624 | **Inferido** | Fechas y textos; ninguna fuente lo declara |
| 12 | Las analcohólicas (10 % y 18 %) siguen el mismo régimen del ILA | **Confirmado con fuente** | Art. 42 letra a), art. 43; Circular 26 §12 |
| 13 | Los suntuarios (art. 37 a, b, c) se cobran también al detalle y sí exigen desglose en la boleta | **Confirmado con fuente** | Arts. 37 y 40; Res. 74 F.4; Circular 26 nota 19; FAQ 7672 |
| 14 | Cómo informa una joyería el suntuario en el XML de boleta | **No encontrado** | — |
| 15 | Cómo lo resuelven Bsale, Toteat, Fudo, Haulmer y LibreDTE | **No encontrado** | — |
| 16 | Nuestro motor parte el precio distinto de la ley para el minorista (tabla de la sección 6) | **Confirmado** (cuentas contra `motor-calculo-precios.md`); **inferido** (que el desajuste aparezca recién al emitir) | Código y docs del repo |

## Qué no se encontró

- **El original del Ord. 624/2022** en sii.cl (solo transcripciones en vLex y un comentario). Tampoco
  el Ord. 61/2022 que cita.
- **Ningún pronunciamiento del SII sobre restaurantes o bares** y el ILA: ni sobre si preparar tragos
  los vuelve elaboradores, ni sobre el cliente corporativo que compra alcohol con factura.
- **Qué hace el SII con la boleta de un contribuyente afecto**: cómo se declara el IVA si el precio
  trae ILA adentro. El oficio dice "factura" y no explica la boleta.
- **Cómo cumple una joyería el desglose de los suntuarios (F.4 de la Res. 74)** dentro del XML.
- **Si el minorista de solo-consumidor debe llenar la columna informativa de crédito en el F29**
  con imputable cero.
- **Documentación pública** de Bsale, Toteat, Fudo, Haulmer/OpenFactura y LibreDTE sobre ILA en
  boleta (ver la pregunta 4). De Toteat y Fudo tampoco hay ayuda indexada sobre impuestos por producto.
- **El texto de la Circular 10/1980 como texto**: es un escaneo; lo leí como imagen. Es de 1980: lo
  de las boletas ("incluido en el precio total") es anterior a la boleta electrónica y a la Ley 21.210.
- **Una lectura consolidada del SII** sobre qué es "comerciante minorista": no hay definición en la ley
  ni en el Oficio 359/2007 que la cita.

## Fuentes

**Ley y normas (SII, leychile)**
[DL 825 en leychile](https://www.bcn.cl/leychile/navegar?idNorma=6369) ·
[DL 825 en sii.cl](https://www.sii.cl/normativa_legislacion/sobreventasyservicios.pdf) ·
[Circular 10/1980](https://www.sii.cl/documentos/circulares/1980/circu10a.htm)
([b](https://www.sii.cl/documentos/circulares/1980/circu10b.htm),
[c](https://www.sii.cl/documentos/circulares/1980/circu10c.htm)) ·
[Circular 26/2021](https://www.sii.cl/normativa_legislacion/circulares/2021/circu26.pdf) ·
[Circular 12/2025](https://www.sii.cl/normativa_legislacion/circulares/2025/circu12.pdf) ·
[Circular 11/2024](https://www.sii.cl/normativa_legislacion/circulares/2024/circu11.pdf) y
[33/2024](https://www.sii.cl/normativa_legislacion/circulares/2024/circu33.pdf) ·
[Res. Ex. 74/2020](https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf) ·
[Instructivo de boleta, 2021-10-28](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf) ·
[Formato DTE 2.5, 2026-02](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) ·
[Instrucciones F29, 2024-11-12](https://www.sii.cl/servicios_online/instrucciones_f29_20241112.pdf)

**Oficios**
[Of. 359/2007](https://www.sii.cl/pagina/jurisprudencia/adminis/2007/ventas/ja4053.htm) ·
[Of. 363/2007](https://www.sii.cl/pagina/jurisprudencia/adminis/2007/ventas/ja4057.htm) ·
[Ord. 6/2021 Valdivia](https://www.sii.cl/documentos/normativa_ddrr/2021/los_rios/ordinario6_62033.pdf) ·
Ord. 624/2022 vía [vLex](https://vlex.cl/vid/ordinario-n-624-servicio-901744673) **[S]** ·
Of. 603/2026 vía [BBSC](https://www.bbsc.cl/oficio-n603-del-2026-impuesto-a-bebidas-alcoholicas-en-venta-efectuada-a-consumidores-finales-2/) **[S]**

**FAQ del SII**
[tasas 1250](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_1250.htm) ·
[1899](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_1899.htm) ·
[2195](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_2195.htm) ·
[1606 (recuadro del F29)](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_1606.htm) ·
[3078](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_3078.htm) ·
[5775](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_5775.htm) ·
[boleta, desglose 7672](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7672.htm) ·
[facturador gratuito 5047](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_5047.htm)

**Proveedores y comentarios [S]**
[Nubox, claves del ILA](https://blog.nubox.com/contadores/claves-del-impuesto-ley-de-alcoholes) ·
[Nubox, impuesto bebidas alcohólicas](https://blog.nubox.com/contadores/impuesto-bebidas-alcoholicas-chile) ·
[Defontana](https://intercom.help/defontanaerp/es/articles/4029592-como-asociar-un-impuesto-especifico-a-un-articulo-en-erp) ·
[LibreDTE, manual de boleta](https://www.libredte.cl/docs/manual/facturacion/emitir-boleta-electronica.pdf) ·
[Círculo Verde (comentario con el Ord. 624)](https://www.circuloverde.cl/como-documentar-tributariamente-operaciones-que-tienen-rebajas-o-montos-exentos-de-iva/)
