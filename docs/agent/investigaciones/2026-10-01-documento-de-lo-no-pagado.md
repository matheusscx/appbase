# Cuándo se documenta lo que todavía no se pagó — investigación fiscal chilena (2026-10-01)

Insumo para reabrir la regla **E1** del frente de emisión por venta ("lo que todavía no se
pagó tiene su documento recién al pagarlo": [`PRODUCTO.md`](../../PRODUCTO.md) § 10, plan
[`2026-10-01-emision-por-venta.md`](../../superpowers/plans/2026-10-01-emision-por-venta.md),
sección "La E1 está reabierta"). Lo trae un agente con WebSearch/WebFetch y lectura directa
de las fuentes del SII. **Informa, no decide**: el criterio fiscal lo pone el owner
([ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md)) y conviene validarlo con el
contador antes de escribirlo en código. Complementa a
[`2026-10-01-emision-por-venta-y-boleta-del-terminal.md`](2026-10-01-emision-por-venta-y-boleta-del-terminal.md)
(qué es el voucher y cómo se anula); no repite eso.

**Cómo leer las marcas.** *Verificado en la fuente*: abrí el texto oficial (sii.cl) y lo leí,
no me quedé con un resumen. *Dicho por un tercero*: lo afirma una fuente que no es la norma.
*Inferencia*: lo concluyo yo a partir de lo verificado. Aviso: varias de mis primeras lecturas
por resumen automático salieron mal (el Oficio 1.280/2007 no dice lo que el resumen decía), así
que lo que cito abajo está contrastado con el texto, no con el resumen.

## Respuesta corta

- **Un restaurante vende, no presta un servicio.** El SII lo dejó escrito en 2003: en una mesa
  lo esencial es entregar la comida, así que es una *venta*, y la boleta sale **antes o junto con
  el cobro, y en todo caso antes de que el cliente se retire**, aunque no haya pagado todavía.
- **Por eso la regla E1 no se sostiene para la mesa.** Los $100.000 de la mesa se documentan
  antes de que el cliente se vaya: $40.000 con el voucher de la máquina y los $60.000 que quedan
  con una boleta del sistema, aunque se cobren otro día. Cuando después paga esa deuda, no hay
  una boleta nueva: ya estaba documentada (si no, el IVA se declararía dos veces).
- **En una tienda pasa lo mismo.** Si entrega la mercadería, la boleta sale al entregar, haya
  pagado o no. La ley habla de la entrega, no del pago. El voucher cubre solo lo que se pagó
  con tarjeta; lo demás (efectivo o fiado) va en una boleta del sistema.
- **Solo los servicios se documentan al cobrar** (peluquería, taller, hotel con su restaurante
  para los pasajeros). Y un anticipo por algo que se entrega más adelante no obliga a boleta
  hasta la entrega.
- **La factura diferida (guía de despacho y factura hasta el día 10 del mes siguiente) existe
  solo para facturas.** La boleta no tiene esa prórroga.
- **Emitir tarde o no emitir** cae en la misma infracción (multa del 50% al 500% de la operación,
  más clausura hasta 20 días). No encontré una regla del SII que trate distinto lo tardío.
- **Queda sin respuesta del SII:** qué pasa cuando la deuda ya boleteada se paga después con
  tarjeta (el voucher vale como boleta y la máquina lo informa al SII): sería un duplicado.
  Hay que consultarlo al contador o al SII (sección 2).

## 1. ¿El restaurante vende o presta un servicio? ¿Cuándo emite la boleta?

**Respuesta: es una venta de bienes, y la boleta se emite al entregar, que el SII fija como "antes
del cobro o junto con él, y en todo caso antes de que el cliente se retire".**

**Evidencia principal — Resolución Exenta SII N° 58, 15-oct-2003** (*verificado en la fuente*:
[sii.cl/documentos/resoluciones/2003/reso58.htm](https://www.sii.cl/documentos/resoluciones/2003/reso58.htm)).
Materia: "emisión de documentos tributarios en restaurantes, establecimientos que venden
comidas preparadas, bebidas o similares para ser consumidas en el mismo local". Lo que dice:

1. Considerando 2: "en las operaciones que se realizan en los restaurantes [...] la
   transferencia de las especies es el elemento esencial de la convención, circunstancia
   determinante para otorgar el carácter de venta". Cita el art. 2 N° 1 (venta) y el 55.
2. Considerando 4: la entrega en un restaurante "se materializa en una serie de actos
   interconectados" sin un hecho que marque su fin, así que el SII interpreta que "esta entrega
   termina en el momento en que el vendedor realiza el cobro"; la documentación va "antes o en
   forma coetánea a este hecho y, en todo caso, previo al retiro del cliente del establecimiento".
3. Resolutivo 1: la boleta, guía de despacho o factura "deberá ser otorgada antes de efectuar el
   cobro respectivo o en forma simultánea a ese hecho. Si la acción de cobro, por cualquier
   motivo no se realiza al terminar el consumo, los documentos respectivos deberán otorgarse
   obligatoriamente en forma previa a que el consumidor se retire del establecimiento."
4. Resolutivo 2: la comanda o cuenta interna no reemplaza al documento tributario; si se le
   muestra al cliente para cobrar, tiene que ir adjunta a la boleta.
5. Resolutivo 3 (excepción, **servicio**): en el restaurante de un hotel, el consumo de los
   pasajeros durante su estadía es parte del servicio de hotelería y la boleta sale "en el
   momento en que la remuneración se perciba".

**Qué significa para la mesa que se va debiendo.** Si el cobro no se hace al terminar de comer,
el SII exige igual el documento *antes de que el cliente salga*. No acepta "cuando pague". La
regla E1 (documento recién al abono) contradice el resolutivo 1 para este caso. *Inferencia
mía*: el documento debe cubrir lo consumido ($100.000), repartido entre el voucher de lo pagado
con tarjeta y una boleta por el resto (ver sección 2).

**Vigencia.** No encontré ninguna resolución que la derogue; la Res. Ex. N° 121 de
19-dic-2024 (facturas en supermercados y restaurantes) no la menciona en sus "Vistos" (*verificado
en la fuente*: [sii.cl/normativa_legislacion/resoluciones/2024/reso121.pdf](https://www.sii.cl/normativa_legislacion/resoluciones/2024/reso121.pdf)).
Los tribunales tributarios la citan como "obligatoria" hasta hoy (ver abajo). Una duda: la
Res. Ex. N° 5/2015 declaraba que la 58 "no será aplicable" a las transacciones pagadas con el
voucher; esa resolución fue **dejada sin efecto** por la Res. Ex. N° 176/2020 y la 176 no
repite la exclusión (*verificado en la fuente*:
[sii.cl/normativa_legislacion/resoluciones/2020/reso176.pdf](https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso176.pdf),
punto 3° y texto completo). Mi lectura: hoy no hay excepción para el voucher.

**Por qué importa el art. 55 y qué dice (*verificado en la fuente*,
[texto actualizado del DL 825 en sii.cl](https://www.sii.cl/normativa_legislacion/dl825.pdf),
versión actualizada a la Ley 21.045 de 2017; no revisé si una ley posterior lo cambió, pero la
Circular 50/2022 y el Oficio 2.147/2016 lo citan con el mismo texto):**

- Bienes: "las facturas deberán ser emitidas en el mismo momento en que se efectúe la entrega
  real o simbólica de las especies". "Las boletas deberán ser emitidas en el momento de la
  entrega real o simbólica de las especies."
- Servicios: las facturas "en el mismo período tributario en que la remuneración se perciba o
  se ponga [...] a disposición del prestador" y las boletas "en el momento mismo en que la
  remuneración se perciba".

**Qué cambió con la Ley 21.420.** Desde el 1-ene-2023 todo servicio remunerado está afecto a IVA
(antes solo los de los N° 3 y 4 del art. 20 de la Ley de la Renta). *Verificado en la fuente*:
[Circular SII N° 50 del 27-oct-2022](https://www.sii.cl/normativa_legislacion/circulares/2022/circu50.pdf),
punto II.1, que además repite que "las facturas y las boletas deberán emitirse [...] en el mismo
momento" en que se percibe la remuneración, "sin perjuicio que la emisión del documento se pueda
anticipar". Resultado práctico: ya no importa para saber *si* paga IVA, importa solo para el
*cuándo*. Y para el restaurante el cuándo lo fija la Res. 58 por ser venta.

**Jurisprudencia de tribunales (no vinculante, *verificado en la fuente*; citada solo como
señal de que la regla se aplica):**

- Tribunal Tributario de Tarapacá, RIT ES-02-00043-2014, 15-jul-2014
  ([sii.cl, jj4070](https://www.sii.cl/pagina/jurisprudencia/judicial/2014/tta/jj4070.htm)):
  el SII cita la Res. 58 y sostiene que en un local con delivery el documento tributario va con
  el pedido. El tribunal **dejó sin efecto** la infracción por falta de prueba directa. Un testigo
  del SII reconoció en la audiencia que "no hay una circular" para el delivery (a diferencia del
  consumo en el local) y que su criterio sobre cuándo es la entrega es "un punto discutido
  jurídicamente".
- Tribunal Tributario de La Araucanía (Temuco), 5-feb-2016
  ([jj4329](https://www.sii.cl/pagina/jurisprudencia/judicial/2016/tta/jj4329.htm)): en un
  restaurante, da igual si la comanda es anterior o posterior a la boleta; lo que cuenta es que la
  boleta se emita en la entrega.

**Matices que cambian la respuesta (todos *sin norma específica encontrada*, salvo el hotel):**

- **Consumo en el local:** venta; documento antes de que el cliente se retire (Res. 58). *Verificado.*
- **Restaurante de hotel, pasajero hospedado:** servicio; boleta al percibir el pago (Res. 58 n° 3). *Verificado.*
- **Delivery o para llevar:** no hay instrucción del SII equivalente a la 58. El art. 55 dice
  "al entregar". *Inferencia*: boleta junto con el pedido, que es lo que el SII sostuvo en el caso
  de Tarapacá. No es instrucción formal.
- **Banquetes, eventos con anticipo, catering por encargo:** no los investigué. Hay un oficio
  sobre anticipos (sección 3) que podría aplicar, pero no lo cruzo con catering.

## 2. Tienda o almacén que entrega la mercadería y cobra una parte, o nada

**Respuesta: la boleta por todo lo entregado sale al entregar, haya pagado o no. El voucher
cubre solo la parte pagada con tarjeta. El saldo impago necesita su documento al entregar, no al
cobrarlo.**

**Qué dice la ley (*verificado en la fuente*, mismo texto del DL 825):**

- Art. 55: la boleta sale "en el momento de la entrega real o simbólica de las especies". No
  menciona el pago en ninguna parte para los bienes. El pago solo cuenta en los servicios.
- Art. 9 letra a): el IVA se devenga "en la fecha de emisión de la factura o boleta"; y si la
  entrega es anterior, "el impuesto se devengará en la fecha de la entrega real o simbólica".
  Reglamento (DS 55/1977) art. 15 dice lo mismo
  ([sii.cl/normativa_legislacion/ds_55_reglamento.pdf](https://www.sii.cl/normativa_legislacion/ds_55_reglamento.pdf)).
  Es decir: el IVA de lo fiado se debe al entregar, no al cobrar.
- Reglamento art. 17: hay "entrega real" cuando el vendedor permite al comprador "la aprehensión
  material" de la especie, es decir, cuando se lleva el producto.
- Art. 52: hay que emitir factura o boleta "por las operaciones que efectúen", y la obligación
  rige aunque no se cobre el impuesto.

**Cómo convive con el voucher (*verificado en la fuente*).** La Res. Ex. N° 176 de 31-dic-2020,
punto 2° (se cita el texto): si se paga "parte del precio" con medio electrónico "y el saldo en
dinero efectivo o utilizando un medio de pago distinto", el contribuyente "deberá emitir la boleta
de ventas y servicios correspondiente por la parte del saldo del precio que se haya solucionado
por los modos indicados"
([reso176.pdf](https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso176.pdf)). Y la
página del SII ["Tu Voucher es tu Boleta"](https://www.sii.cl/destacados/boleta_electronica_voucher/)
trae la tabla: con "efectivo y pago electrónico", el efectivo va con boleta electrónica y el pago
electrónico va con el voucher. O sea, el voucher vale como boleta solo por lo que se pagó con
tarjeta, y esto ya estaba en la investigación hermana.

**Lo que esa resolución no dice, y no hay que sobre-leer.** La 176 habla de la parte *pagada*
("solucionado"). No dice que lo *no pagado* pueda esperar. Quien la lea sola puede concluir lo de
la E1; leída junto con el art. 55 y la Res. 58, no alcanza para postergar. *Inferencia mía*:
la 176 ordena qué documento corresponde a cada pago, no el momento en que nace la obligación de
documentar la venta.

**Anticipos y encargos (verificado, [Oficio SII N° 3.008 del 4-nov-2016](https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_ventas/2016/ja3008.htm)):**
no hay obligación de boleta ni factura por un *anticipo* cuando la entrega se pacta a futuro, "por
lo que si no se hace, no es posible aplicar sanción alguna". Si igual se emite (o se paga con
tarjeta, cuyo voucher vale como boleta), el IVA se devenga por ese monto y no corresponde nota de
crédito; al entregar se factura el saldo. El caso era una moto, no un almacén, pero el criterio
es sobre entrega futura. *Aplica al abono previo a la entrega, no al fiado posterior a ella.*

**Punto abierto (importante para el diseño):** una venta fiada, ya boleteada al entregar, que
después se paga con tarjeta. El voucher "tiene el valor de boleta de ventas y servicios para todos
los efectos legales" y la máquina lo informa al SII, que lo anota en el Registro de Ventas
(Res. 176, secciones B, C y D). Si el sistema ya emitió la boleta por esa venta, queda duplicada, y
la Res. 176 (sección B) dice qué hacer cuando eso ocurre por error: una nota de crédito de
anulación por el duplicado. Hay una pista del SII sobre el caso inverso: bajo el modelo "siempre
emito boleta aun cuando reciba pago electrónico" se emiten "ambos documentos (boleta y voucher)"
sin que se cuenten dos veces (página "Tu Voucher es tu Boleta"). **No encontré un pronunciamiento
del SII sobre el pago posterior con tarjeta de una venta ya documentada.** Es una pregunta para
el contador o una consulta formal al SII; no la resuelvo yo. Una pista más, también verificada:
la Res. 74/2020, sección H, dice que el equipo de boletas puede usarse para recibir "el pago de
cuotas, cuentas [...] u otra recepción de dinero que no corresponda a ventas", emitiendo un
"comprobante" (no una boleta). Sirve de argumento de que cobrar una cuenta no es una venta nueva,
pero habla de equipos de boleta electrónica, no del voucher de la máquina.

## 3. Excepciones de oportunidad — qué aplica a un comercio minorista

Todo *verificado en la fuente* (art. 55 del DL 825; Reglamento arts. 69 y 70) salvo lo marcado.

- **Factura diferida con guía de despacho.** Si la factura no se emite al entregar, se entrega
  una guía de despacho numerada, y la factura puede postergarse "hasta el décimo día posterior a
  la terminación del período", con fecha dentro del período en que se hizo la operación. El SII lo
  repite en su
  [FAQ de factura electrónica](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_4136.htm).
  **Es solo para facturas.** El texto dice "postergar la emisión de sus facturas"; la boleta del
  inciso siguiente no tiene prórroga. *Para el minorista*: aplica únicamente cuando el cliente
  pide factura y el comercio quiere agrupar varias entregas del mes en una sola factura.
- **Boletas de servicios:** al percibir la remuneración (art. 55). Se puede anticipar, y el
  impuesto se declara en el período en que se emite
  ([Oficio SII N° 2.147 del 1-ago-2016](https://www.sii.cl/pagina/jurisprudencia/adminis/2016/ventas/ja2147.htm),
  que habla de facturas, pero repite el criterio de anticipar).
- **Ventas a plazo / crédito:** no hay una oportunidad especial para la boleta. El plazo de pago
  no mueve la entrega; el art. 9 devenga el IVA al entregar. Los intereses o reajustes pactados
  sobre el saldo se devengan aparte "a medida que sean exigibles" (art. 9 letra d). *Inferencia*:
  el fiado sin interés es una venta entregada con pago diferido, documentada al entregar. No
  encontré ningún oficio sobre "fiado de almacén" en boleta.
- **Anticipos por entrega futura:** sin obligación hasta la entrega (Oficio 3.008/2016, sección 2).
- **Contratos del art. 8 letras e) y l)** (arriendo con opción de compra, inmuebles): factura al
  percibir el pago. No aplican a un POS de comercio.

## 4. Factura a crédito — cómo se marca en el DTE

Confirmado (*verificado en la fuente*: [Formato de Documentos Tributarios Electrónicos, versión
2.5, feb-2026](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf)):

- Campo **Forma de Pago `<FmaPago>`**, en el encabezado: `1` = Contado, `2` = Crédito, `3` = Sin
  costo (entrega gratuita). Es obligatorio en factura electrónica, factura exenta y liquidación
  factura; si falta, "se considerará por defecto" `2` (crédito). Una factura con saldo impago al
  emitirse (crédito) para usar el crédito fiscal requiere que el comprador otorgue (o se entienda
  otorgado) el recibo de las mercaderías.
- **Fecha de vencimiento `<FchVenc>`** (AAAA-MM-DD, entre 2002 y 2050): en la tabla del formato
  aparece como dato condicional (nivel 2) para factura y factura exenta. Hay además campos
  opcionales de monto cancelado y saldo insoluto para pagos parciales.
- La factura se emite al entregar aunque se pague después; el crédito solo se marca. Es lo que el
  sistema ya hace.

## 5. Sanción por emitir tarde vs no emitir (art. 97 N° 10 del Código Tributario)

*Verificado en la fuente* ([Código Tributario actualizado a 2020 en sii.cl](https://www.sii.cl/normativa_legislacion/codigo_tributario.pdf),
no revisé si una ley posterior lo modificó; la Res. 121/2024 repite la misma sanción):

- Infracción: "el no otorgamiento de guías de despacho, de facturas, notas de débito, notas de
  crédito o boletas **en los casos y en la forma exigidos por las leyes**" (también boletas no
  autorizadas, documentos sin timbre y fraccionar ventas para eludir la boleta).
- Multa: **50% al 500% del monto de la operación**, mínimo 2 UTM y máximo 40 UTA; **y clausura de
  hasta 20 días** del establecimiento. La reiteración (dos o más infracciones en tres años) agrega
  presidio o relegación menor en su grado máximo.
- **No encontré una regla o un oficio del SII que distinga "emisión tardía" de "no emisión".** El
  texto dice "casos y forma exigidos", y la oportunidad es parte de lo que el art. 55 exige. Dos
  fallos de tribunales (no vinculantes, *verificados*): en La Serena (RIT ES-06-00012-2012,
  [jj3059](https://www.sii.cl/pagina/jurisprudencia/judicial/2012/tta/jj3059.htm)) se sancionó con
  100% de la operación más 2 días de clausura al que emitió la factura solo cuando el SII se la
  pidió (siete meses después); en Temuco ([jj4329](https://www.sii.cl/pagina/jurisprudencia/judicial/2016/tta/jj4329.htm))
  se dejó sin efecto la infracción porque las boletas sí existían, aunque el orden respecto de la
  comanda variara. Son hechos distintos, no una regla.

## Qué cambia en la regla E1

La E1 dice: *"El documento de lo que todavía no se pagó sale al pagarlo: cada cobro sigue la regla
de su medio."* Lo investigado la desmiente para las ventas de bienes, que es el caso de la mesa y
de la tienda. Salen **dos reglas**, una por caso, y una pregunta abierta. Son propuestas de
redacción; las decide el owner con su contador.

**E1-restaurante (consumo en el local).** *"Una mesa es una venta: se documenta todo lo
consumido antes de que el cliente se retire del local, aunque no haya pagado. La parte pagada
con tarjeta queda cubierta por el voucher de la máquina; el resto (efectivo o lo que se va
debiendo) lleva una boleta del sistema, emitida en ese momento. Cuando el cliente cobra después
lo que debía, no se emite un documento nuevo: ya estaba documentado. Ejemplo: mesa de $100.000,
$40.000 con tarjeta y $60.000 que queda debiendo: el voucher cubre $40.000 y la boleta del
sistema $60.000, ambos antes de que se vaya. La excepción es el pasajero de un hotel que paga
con su estadía: ahí es servicio y el documento va al cobrar."* Base: Res. Ex. SII N° 58/2003 y
art. 55 del DL 825.

**E1-tienda (venta de bienes con entrega).** *"Lo que se entrega se documenta al entregarlo, haya
pagado o no. La parte pagada con tarjeta queda cubierta por el voucher; todo lo demás entregado
(efectivo o fiado) lleva una boleta del sistema, emitida al entregar. Un cobro posterior de una
venta ya entregada no genera boleta nueva. Lo que se paga antes de entregar (abono, encargo) no
exige boleta hasta la entrega; el que lo documente antes lo hace por su cuenta."* Base: art. 55,
art. 9 letra a), Res. Ex. SII N° 176/2020 y Oficio N° 3.008/2016.

**Servicios y la excepción de la factura (sin cambio):** la boleta de un servicio sale al percibir
el pago; la factura de bienes sale al entregar (o con guía de despacho, hasta el día 10 del mes
siguiente), con la forma de pago `<FmaPago>` en crédito si queda saldo.

**Pregunta que la E1 no puede cerrar sola, para el contador:** la deuda ya boleteada que se paga
más tarde con tarjeta. Opciones sin decidir: (a) el sistema registra el cobro sin documento
nuevo y el voucher queda como duplicado a anular con una nota de crédito (la Res. 176 lo prevé
para el error, pero eso es costo operativo); (b) obligar a cobrar ese saldo con otro medio;
(c) consultar al SII si el voucher de un cobro de cuenta se puede informar como "no venta". Hasta
tener respuesta, el sistema no debería inventar una.

**Qué arrastra del plan** (según su propia tabla): las tareas 4, 5, 7, 8, 10 y 12 dependen de
esta regla. Si el documento nace al entregar, una venta pendiente ya tiene documento, la parte
impaga deja de caer en "devolución interna", y "sin documento todavía" deja de significar
"venta pendiente". Esto es **fiscal** (invariante: "lo fiscal va solo"), así que va en su
propio frente y con su propia verificación.

## Límites de esta investigación

- No abrí estudios contables: las fuentes son el SII y los tribunales, salvo lo marcado.
- No investigué si la Res. 58 de 2003 fue modificada en silencio; no encontré una derogación.
- No cubrí delivery de plataformas, catering ni propinas.
- Los textos del DL 825 y del Código Tributario que cito son los de las versiones actualizadas que
  publica el SII (2017 y 2020). No revisé las leyes posteriores artículo por artículo.
- La Circular 50/2022 (cita el art. 55 con el mismo texto) es la que usé para saber que el
  texto no cambió en lo que importa.
