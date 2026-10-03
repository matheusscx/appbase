# La cortesía de restaurante frente al IVA (Chile) — investigación

**Fecha:** 2026-10-03 · **Pedida por:** frente fiscal "La cortesía como retiro gravado con IVA"
(`pendientes.md` § 6) · **Hecha por:** la Sesión de esfuerzo máximo, con tres pasadas en paralelo
(subagentes Sonnet) y verificación propia de los puntos que deciden.

> ⛔ **Es insumo para cruzar, no verdad ni asesoría tributaria.** La regla la pone el owner
> (ADR-010, "lo fiscal va solo"), idealmente con su contador: no hay ningún pronunciamiento del SII
> sobre cortesías de restaurante a comensales, así que la calificación de la escena (a) es una
> lectura de normas generales, no un criterio publicado.

**Etiquetas.** **[V]** = lo leí yo en la fuente primaria al consolidar. **[VS]** = verificado en
la fuente por un subagente; no lo releí yo (cuando dos pasadas independientes llegaron a lo mismo,
se dice). **[I]** = inferencia. **[NE]** = buscado y no encontrado.

---

## 0. Lo esencial

1. **La premisa "salvo rifas y sorteos" está al revés.** El art. 8 d) **grava** las rifas y los
   sorteos promocionales (inc. 2) y "toda entrega o distribución gratuita" que los vendedores hagan
   con fines promocionales o de propaganda (inc. 3). La única exclusión nueva (inc. 4, Ley 21.210)
   son las entregas del N° 3 del art. 31 LIR: donaciones de bienes sin valor comercial a
   instituciones sin fines de lucro, no cortesías. **[V]** (DL 825 compilado por el SII.)
2. **No es "retiro o descuento": son tres calificaciones posibles**, y la decide la **finalidad**
   de la entrega, no el sistema:
   - **(i) retiro gravado** (art. 8 d) inc. 3): vendedor + finalidad promocional o de propaganda →
     débito de IVA, documento y base del art. 16 b);
   - **(ii) entrega gratuita no afecta**: sin finalidad promocional (liberalidad, compensación) →
     sin débito, pero **sin crédito** por los insumos de lo regalado;
   - **(iii) precio efectivamente cobrado**: un paquete con precio único ("3 por el precio de 2"
     como regla de precio) → venta por lo cobrado, crédito solo en proporción al débito.
   **[I]** que ordena oficios verificados (§ 1). Dos pasadas independientes llegaron a lo mismo.
3. **El SII trata "regalo junto con una venta" como dos transacciones**, no como descuento: una
   venta más una entrega promocional (Oficio 1.420 de 20-08-2010, punto 7) **[V]**. Eso pesa
   contra modelar la cortesía como "descuento del 100%".
4. **La base del retiro está en el art. 16 letra b)**, no en la d): el valor que el contribuyente
   asigna a los bienes, o el valor en plaza si es mayor **[V]**. El art. 15 no habla de descuentos:
   la base general es "el valor de las operaciones" **[V]**.
5. **Hoy el sistema no deja "ningún hecho tributario", y eso no es una posición segura**: si la
   cortesía tiene fin promocional, es un retiro gravado sin documento ni débito (sanción del art.
   97 N° 10 del Código Tributario por no emitir, más las de declarar de menos) **[I]**. Lo que sí
   deja, el egreso de stock con costo, ayuda a justificar el faltante de inventario (Reglamento art.
   10) **[VS]**, pero no decide la calificación.
6. **Hallazgo lateral, ya derivado a `pendientes.md` § 6 (commit 54888cf1):** la Res. Ex. SII
   60/2023 exige emitir boleta cuando el total es $0 por un descuento; ADR-028 (E6) la cita para lo
   contrario **[V]**. No afecta a la cortesía de hoy (la línea sale de la cuenta, no hay
   transacción), pero sí a cualquier diseño que modele la cortesía como descuento del 100%.

---

## 1. ¿Retiro (art. 8 d) o descuento? Por escena

### Texto vigente del art. 8 d) **[V]**
- Inc. 1: retiros del vendedor, dueño, socios, directores o empleados **para uso o consumo
  personal o familiar**. Se presume retirado lo que falte en inventario sin documentación
  fehaciente, salvo caso fortuito o fuerza mayor calificado por el SII u otros que fije el
  Reglamento.
- Inc. 2: son ventas los retiros para rifas y sorteos, aun gratuitos, con fines promocionales.
- Inc. 3: lo mismo para "toda entrega o distribución gratuita" con iguales fines.
- Inc. 4 (Ley 21.210, DO 24-02-2020): no comprende las entregas del art. 31 N° 3 LIR.
- Inc. final: el IVA recargado por estos retiros no da crédito (art. 23).
- Leyes posteriores (21.420, 21.713, 21.806) no tocaron la letra d) **[VS]**.

### Lo que decide la calificación **[VS]**, dos pasadas coinciden
- **Finalidad promocional o de propaganda.** El SII la lee de forma objetiva, aunque el
  contribuyente diga otra cosa (Oficio 3.874 de 03-10-2000, muestrarios: "una forma de promoción").
- **Que quien regala sea "vendedor"** (incs. 2 y 3 solo alcanzan a vendedores: Oficios 737/1998 y
  2.409/2009). Un restaurante es vendedor respecto de la comida de su producción (art. 2 N° 3), y
  el Oficio 734/2002 le aplicó el art. 8 d) a un restaurante **[I]**. El TTA de Talca (31-01-2013)
  trató a un casino como prestador de servicios: sin retiro, pero también **sin crédito** por las
  cortesías (tapaditos, consomés, tragos), y la Corte Suprema (02-09-2014, Rol 10.256-2013)
  rechazó la casación sin entrar al fondo.
- **Sin finalidad promocional, la entrega gratuita no es hecho gravado** (Oficio 977 de
  09-05-2017; Oficio 3.072 de 28-08-2002), pero el IVA de lo regalado no es crédito (Oficio 737 de
  17-03-1998; Oficio 1.750 de 24-04-2001).

### Escena (a): plato regalado a una mesa que paga lo demás
- **Es el caso del sistema hoy** (la línea sale de la cuenta, 100% sin precio).
- Con fin promocional (bienvenida, fidelización, degustación, "por la espera"): **retiro gravado**.
  El Oficio 1.420/2010 lo trata como una transacción **aparte** de la venta, no como descuento de
  ella **[V]**.
- Como pura liberalidad o compensación: **no afecta**, sin crédito por los insumos **[VS]**.
- **[NE]** ningún oficio sobre cortesías de restaurante; ninguno sobre "2x1" de bienes.
- **[I]** La línea entre "promocional" y "compensación" no la puede trazar el sistema: la declara
  quien regala. Si el producto quiere ser defendible, la cortesía necesita guardar esa finalidad.

### Escena (b): mesa entera invitada ($0)
- **No es venta** (falta título oneroso, art. 2 N° 1) **[VS]**. La pregunta es retiro o no afecta,
  y vuelve a depender de la finalidad: prensa, influencers, inauguración, degustación → promocional
  → retiro gravado **[I]**.
- Si el invitado "paga" con publicidad (canje), no es gratuito: el art. 19 trata al restaurante
  como vendedor de lo entregado **[VS]**; el efecto IVA del canje con influencers no se verificó
  **[NE]**.
- Invitación personal del dueño: riesgo de que se lea como retiro de uso personal (inc. 1) **[I]**.

### Escena (c): personal o dueño
- **Personal comiendo dentro del local: no es retiro** (los bienes no salen de la empresa,
  Reglamento art. 11; Circular 126/1977 § 14) ni venta (gratuito): Oficio 734 de 28-02-2002, sobre
  colaciones del personal de un restaurante. **[VS]**, dos pasadas coinciden. Ese oficio pide
  documentarlo con boleta o factura "no afecta" (Res. 6080/1999); hay criterios discrepantes sobre
  si hace falta documento (Oficios 1.750/2001 y Ord. 638/2009 dicen que no; Circular 6/2024 acepta
  "cualquier documento que dé cuenta fehacientemente"). Vigencia del § 5 del Oficio 734: **[NE]**.
- **Si el personal se lo lleva**, sale de la empresa: retiro del inc. 1 **[I]**.
- **Dueño o socios**: el inc. 1 los nombra; el SII pide boleta y base del art. 16 b) (FAQ ID
  001.130.0723.009, act. 23-06-2025) **[VS]**. Consumo del dueño dentro del local: **[NE]**.

## 2. Texto vigente y excepciones
Ver § 1, "Texto vigente". Excepciones reales: caso fortuito o fuerza mayor (inc. 1); entregas del
art. 31 N° 3 LIR (inc. 4); bienes que no salen de la empresa (Reglamento DS 55/1977 art. 11);
documentación fehaciente de faltantes (Reglamento art. 10: inventario permanente, denuncias,
informes de seguro, mermas reconocidas) **[VS]**. Probable origen de la frase invertida: el art. 11
del Reglamento remite al "inciso 2°" en la numeración de 1977 **[I]**.

## 3. Base imponible del retiro
- **Art. 16 letra b):** "el valor que el propio contribuyente tenga asignado a los bienes" o el
  valor en plaza si es superior, según lo determine el SII **[V]**. Desde el 01-03-2020 ya no dice
  "a su juicio exclusivo" (Ley 21.210) **[VS]**.
- **Costo:** ninguna norma ni oficio leído lo usa como base del IVA de un retiro **[I]**; aparece
  solo para inventario y renta.
- **[I]** Para un plato, lo más defendible es el **precio de carta neto de IVA** (el valor que el
  restaurante le asigna, y proxy del valor en plaza). Usar el costo expone a que el SII tase al
  valor en plaza.
- Devengo: en el momento del retiro (art. 9 c)) **[VS]**.

## 4. Cómo se documenta
- **Entrega promocional:** factura (que indique que no da crédito) o boleta según corresponda,
  **al momento de la entrega** (Oficio 1.420/2010, punto 4: el vendedor que regala con fin
  promocional debe "emitir una factura o boleta, según corresponda") **[V]**.
- **Retiro del dueño o socio:** boleta (FAQ citada) **[VS]**.
- **"A nombre del propio contribuyente":** **[NE]**. **Resumen al cierre del período:** **[NE]**
  (el art. 56 del DL 825 permite al SII autorizar otro control por resolución; no se halló ninguna
  para retiros).
- **F29:** no hay línea propia para retiros **[NE]**; el débito entra por la línea del documento
  que lo respalde **[I]**.
- **Formato DTE:** la factura tiene `FmaPago = 3` (sin costo / entrega gratuita, y advierte que no
  da crédito); la guía tiene `IndTraslado = 4`; **la boleta electrónica no tiene indicador
  equivalente** y exige monto neto mayor que 0 en una boleta afecta (Formato Boletas v4.2) **[VS]**.
  **[I]** Un retiro se documenta por su base imponible, nunca por $0.
- **El voucher de la máquina no sirve** para un retiro: vale como boleta solo si hay pago
  electrónico (art. 54), y en una entrega gratuita no hay pago **[I]**.

## 5. ¿No generar débito y en cambio no usar o reversar el crédito?
- **No es una opción elegible:** es la consecuencia cuando la entrega **no** es retiro (calificación
  ii). Si es retiro gravado, hay débito, y renunciar al crédito no lo evita **[I]**, ordenando
  oficios verificados por dos pasadas.
- Retiro gravado: débito sobre la base del art. 16 b); el IVA del retiro no da crédito; el crédito
  de la compra de insumos **se mantiene** **[I]**.
- No afecta: sin débito; el IVA de los insumos de lo regalado **no es crédito** (art. 23 N° 2;
  Reglamento art. 41 N° 1 y 3; Oficio 737/1998) y "siempre será un mayor costo" (Oficio 1.750/2001)
  **[VS]**. Mecánica de reverso en el F29: **[NE]**.

## 6. Qué hacen los POS chilenos
Solo documentación pública (centros de ayuda), leída el 2026-10-03. Como avisa la plantilla, los
POS locales publican cómo cargar el dato, no su lógica fiscal.

- **Ninguno trata la cortesía como concepto propio, ni operativo ni fiscal** **[VS]**. La palabra
  aparece dos veces en todo lo leído: Fudo la da como **nombre de ejemplo de un descuento**, y
  Toteat dice que su "Descuento por ítem" sirve para "cortesías parciales".
- **Tres mecanismos genéricos** **[VS]**:
  - **descuento con nombre o comentario**: Fudo (sin mencionar el 100%), Toteat por ítem con
    comentario obligatorio, Justo, Bsale con tope por perfil, Defontana con tope por cajero;
  - **anulación con comentario y efecto en stock**: Toteat ("anulación no recuperable" descuenta
    como pérdida), Fudo (cancelar devuelve el stock), Justo, TUU (causales fijas);
  - **salida de inventario o forma de pago de "consumo propio"**: Toteat (forma de pago custom
    "Consumo Personal/Dueño", que puede excluirse de la venta y del cierre), Defontana (Consumo
    Interno), Justo (Guía de consumo, para insumos), y **Bsale**, cuyo módulo Consumo tiene un tipo
    **`Retiro`** que su ayuda define como "un regalo que le hiciste a un cliente" o un producto de
    uso personal **[V]**, pero solo como movimiento de stock, sin documento ni IVA.
- **Documento:** ninguna ayuda describe boleta de $0, boleta a nombre propio ni guía para una
  cortesía. En Toteat y Fudo la boleta es un paso manual posterior al cobro; Fudo Chile declara que
  no emite documentos exentos **[VS]**. Bsale y Defontana tienen el tipo "entrega gratuita" en la
  guía de despacho, no ligado a cortesías **[VS]**.
- **IVA y art. 8 d):** ningún POS los menciona **[NE]**. La única advertencia tributaria es un
  descargo de Toteat: usar formas de pago que no emiten boleta para evadir impuestos es
  responsabilidad del usuario **[VS]**.
- **Reportes:** agregados genéricos (total de descuentos, anulaciones por motivo, reporte de
  consumo de Bsale); **ningún "informe de cortesías"** **[NE]**. Contraste internacional: Lightspeed
  K-Series separa los *comps* de los descuentos en su reporte **[VS]**.
- **[I]** Si el owner decide documentar la cortesía como retiro gravado, nadie en el mercado chileno
  lo hace a la vista: por la regla de la plantilla, eso va también a `docs/DIFERENCIADORES.md` en el
  mismo commit. Y el riesgo de copiar al mercado es real: el patrón local (descuento o consumo sin
  documento) es justo la "posición no segura" del § 0.5.

## 7. Costo de no hacerlo
- **No emitir el documento:** art. 97 N° 10 del Código Tributario: multa del 50% al 500% del monto
  de la operación (mínimo 2 UTM, máximo 40 UTA), clausura de hasta 20 días, y presidio en la
  reiteración **[VS]**. Aplica solo si la cortesía es retiro gravado **[I]**.
- **No declarar el débito:** art. 97 N° 3 (5% a 20% de la diferencia), N° 4 si es malicioso
  (100% a 300% más presidio), N° 11 (20% hasta 60% si lo detecta el SII), más reajuste e intereses
  (art. 53) **[VS]**.
- **Fiscalización:** intensa sobre restaurantes por emisión de boletas y uso de facturas (Res. Ex.
  121/2024, Plan de Gestión de Cumplimiento 2025, informe de brechas 2025) **[VS]**; **sobre
  cortesías o retiros en restaurantes, ningún programa** **[NE]**. Antecedentes puntuales: el
  Oficio 734/2002 nace de fiscalizadores que exigieron boletas por la comida del personal, y el caso
  del casino de Talca terminó con $17,7 millones de crédito rechazado por cortesías **[VS]**.

---

## Lo que el diseño tendría que mirar (cruce con el sistema, para el frente)

Todo **[I]**; lo decide el owner:

1. **La finalidad no la sabe el sistema:** la declara quien regala. Si la cortesía va a ser
   defendible, el registro tiene que guardar si fue promocional o compensación (o el owner fija una
   regla única para su local, con su contador).
2. **El kardex dice "merma" para una cortesía** (según tu medición: la cortesía genera un
   movimiento con motivo `merma`). Para el SII, merma documentada (Reglamento art. 10) y entrega
   gratuita son hechos distintos con tratamiento distinto: un kardex que llama merma a un regalo
   puede leerse como justificar un faltante con la causa equivocada. El tipo `cortesia` existe en
   `cuenta_linea_anulaciones`, pero no en el motivo del movimiento.
3. **Modelarla como descuento del 100% no la saca del problema:** el SII lee "regalo junto con una
   venta" como dos transacciones (Oficio 1.420/2010), y una venta que llega a $0 por descuento
   igual exige boleta (Res. Ex. 60/2023). El "descuento" solo es defendible como regla de precio de
   un paquete (calificación iii).
4. **Si es retiro gravado:** documento por la base (precio de carta neto), en el momento, con la
   boleta del sistema (el voucher no sirve), y el débito entra en el F29 por esa boleta. Encaja con
   la emisión registrada por venta (ADR-028) como un documento más, pero no es "una venta": su
   naturaleza (retiro) tiene que quedar congelada (ADR-010).
5. **El personal comiendo en el local no es retiro**, así que el sistema no debería tratar igual la
   "cortesía al cliente" y la "comida del personal".

## Fuentes principales

Primarias leídas por mí al consolidar:
- DL 825 compilado por el SII (arts. 8 d), 15, 16 b)):
  https://www.sii.cl/normativa_legislacion/sobreventasyservicios.pdf
- Res. Ex. SII 60/2023: https://www.sii.cl/normativa_legislacion/resoluciones/2023/reso60.pdf
- Oficio SII 1.420 (20-08-2010): https://www.sii.cl/pagina/jurisprudencia/adminis/2010/ventas/ja1420.htm

Verificadas por las pasadas (selección; la lista completa está en sus informes):
- BCN DL 825: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=6369
- DS 55/1977 (Reglamento IVA): https://www.sii.cl/normativa_legislacion/ds_55_reglamento.pdf
- Oficio 734 (28-02-2002): https://www.sii.cl/pagina/jurisprudencia/adminis/2002/ventas/ja256.doc
- Oficio 977 (09-05-2017): https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_ventas/2017/ja977.doc
- Oficio 3.874 (03-10-2000): https://www.sii.cl/pagina/jurisprudencia/adminis/2000/ventas/octubre06.htm
- Oficio 2.566 (13-06-2001): https://www.sii.cl/pagina/jurisprudencia/adminis/2001/ventas/ja217.htm
- Oficio 737 (17-03-1998): https://www.sii.cl/pagina/jurisprudencia/adminis/1998/ventas/mar15.doc
- Oficio 1.750 (24-04-2001): https://www.sii.cl/pagina/jurisprudencia/adminis/2001/ventas/ja188.doc
- TTA Talca (31-01-2013): https://www.sii.cl/pagina/jurisprudencia/judicial/2012/tta/jj3227.htm
- Corte Suprema (02-09-2014, Rol 10.256-2013): https://www.sii.cl//pagina/jurisprudencia/judicial/2014/codigo/jj3594.doc
- FAQ retiros del dueño: https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_0723.htm
- Formato DTE v2.5: https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf
- Formato Boleta electrónica: https://www.sii.cl/factura_electronica/factura_mercado/formato_boleta_electronica.pdf
- Código Tributario (art. 97): https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=6374
- Instrucciones F29: https://www.sii.cl/servicios_online/instrucciones_f29_20241112.pdf
