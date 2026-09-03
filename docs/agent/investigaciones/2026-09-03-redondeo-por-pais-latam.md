# Investigación: la regla de redondeo país por país en LatAm

> ⛔ **Regla del cruce** ([`../investigacion-mercado.md`](../investigacion-mercado.md)): lo que
> trae la investigación es **insumo para cruzar y adaptar**, nunca verdad a copiar. Con un
> matiz que este tema sí tiene: **una norma tributaria no se "adapta"** — se cumple o se
> incumple. Lo adaptable es el diseño alrededor.
>
> **Por qué se corrió** (owner, 2026-09-03): el producto es multi-tenant **para América
> Latina**, y el [ADR-024](../../adr/024-decimales-redondeo-y-unidades-de-cuenta.md) decidió
> mover el nivel de redondeo al país teniendo **dos** reglas de la región. Antes de sembrar esa
> tabla hacía falta saber cuántas tenemos de verdad.
>
> ⚠️ **Esto no es "cómo lo hacen los POS"**, que es para lo que sirve la plantilla de
> investigación de mercado. Acá la señal está en la **norma** — la propia plantilla lo dice
> para Chile: *"en Chile la señal está en la norma, no en la competencia"*. Se relevaron
> autoridades tributarias, no competidores.

---

## 1. La tabla, con el nivel de evidencia de cada fila

**[PRIMARIA]** = texto extraído del PDF oficial de la autoridad tributaria, verificado acá.
**[SECUNDARIA]** = fuentes concordantes que citan la norma, sin haber abierto el original.
**[NO HALLADO]** = se buscó y no apareció; **no** significa que no exista.

| País | ¿Por línea o al total? | Modo de redondeo | Decimales de importes | Precio unit. / cantidad | Evidencia |
|---|---|---|---|---|---|
| **Argentina** (ARCA/AFIP) | **No lo fija.** Valida la suma con **tolerancia**: error relativo ≤ 0,01% **o** error absoluto ≤ 0,01 × cantidad de alícuotas | **Round Half Even** — literal | 13 enteros + **2** | tasa `MonCotiz`: 4 + **6** | **[PRIMARIA]** |
| **Colombia** (DIAN) | — | **Half-to-even** (NTC 3711 / JIS Z 8401). Además **aproxima el IVA a múltiplos de $10**, con tolerancia de $5 en IVA y −$2 en el resto | — | — | **[SECUNDARIA]** concordante |
| **México** (SAT, Anexo 20) | **Al total**, una sola vez, sumando las líneas a hasta 6 decimales | — | — | — | investigación 2026-08-15 |
| **Perú** (SUNAT, UBL 2.1) | **No lo fija.** Contempla un *"monto de redondeo aplicable"* dentro del valor de venta, y `PayableAmount` como total a pagar | **No lo fija** | `n(12,2)` — hasta **2** | — | **[PRIMARIA]** |
| **Ecuador** (SRI) | **No lo fija** | **No lo fija** — la ficha técnica **no menciona la palabra "redondeo"** | máximo **2** | hasta **6** | **[PRIMARIA]** |
| **Chile** (SII) | ⛔ **[INFERENCIA]** que los totales van enteros — corregido el 2026-08-20, no es frase literal | **No lo fija** | totales: inferido entero | `PrcItem`/`QtyItem`: 12 + **6** | investigación 2026-08-20 |
| **Uruguay** (DGI) | **[NO HALLADO]** | **[NO HALLADO]** | — | tasa del BCU **"con todos los decimales"**, tomada del propio CFE | **[SECUNDARIA]** |
| **Brasil, Bolivia, Paraguay, Costa Rica, Rep. Dominicana** | **[NO RELEVADOS]** en esta pasada | | | | |

### Las citas literales que sostienen las filas primarias

**Argentina** — manual del desarrollador de facturación electrónica (RG 4291):

> *"El criterio de redondeo que utilizamos en este servicio es **Round Half Even**."*

y, sobre cómo valida:

> *"Margen de error: Error relativo porcentual deberá ser ≤ 0.01% o el error absoluto ≤ 0.01 ×
> cantidad de alícuotas de IVA ingresadas."*

**Ecuador** — ficha técnica de comprobantes electrónicos, § 8.17:

> *"El formato para todo campo correspondiente a valores será 123456.98 (…); se utilizará como
> máximo **dos decimales**, a excepción de los campos de **precio unitario y cantidad** que se
> podrá utilizar hasta **6 decimales**."*

**Perú** — guía de elaboración de documentos XML (UBL 2.1): los importes son `n(12,2)`, y el
valor de venta total *"incluye cualquier **monto de redondeo** aplicable"*.

---

## 2. Los cinco hallazgos que cambian el diseño

### ⭐ 2.1. Dos de la región exigen **half-even**, y nuestro default es **half-up**

Argentina (primaria, literal) y Colombia (NTC 3711). **Son los dos únicos países de LatAm en
los que se halló un modo fijado por norma, y los dos piden lo mismo — y no es lo que hacemos.**

⛔ **Esto falsifica una conclusión de la investigación de agosto.** Su § 1 dice: *"Half-even NO
es el estándar financiero (…) las normas que **sí** fijan un modo exigen **half-up**"*, citando
el Reglamento CE 1103/97 y el IRS, y con eso respalda dejar `modo_redondeo` **configurable por
el tenant**. La generalización es cierta para Europa y EE.UU. y **falsa para LatAm**, que es
nuestro mercado. Peor: su propia § 6 ya listaba a Colombia con half-to-even, así que el
documento se contradecía a sí mismo.

👉 Hoy `modo_redondeo` es preferencia del tenant con default `HALF_UP`. **Un tenant argentino o
colombiano que no toque nada queda fuera de su norma**, y nada se lo dice.

### ⭐ 2.2. **Ningún país de LatAm relevado obliga a redondear por línea** — y nuestro default es `linea`

México obliga **al total**. Argentina y Colombia **no fijan el nivel**: validan el resultado con
una tolerancia. Perú, Ecuador y Chile no lo fijan.

El único caso relevado que obliga por línea es **Reino Unido**, que no es nuestro mercado. O
sea: el ejemplo que sostenía "hay que poder cambiarlo por país" es real, pero **el que empuja en
la dirección contraria a nuestro default está fuera de la región**.

### ⭐ 2.3. La **tolerancia** es el mecanismo de la región, y nuestro motor no la tiene

Tres de los relevados validan con margen, no con igualdad exacta:

| País | Tolerancia |
|---|---|
| Argentina | error relativo ≤ 0,01% **o** absoluto ≤ 0,01 × alícuotas |
| Colombia | $5 en IVA, −$2 en el resto |
| Perú | ±5 en la validación de tasas |

Nuestro motor apunta a **exactitud**: los totales se derivan de sus componentes y la identidad
`total = neto − desc + rec + imp` cierra exacta (fue un frente entero, medido sobre 10.000
carritos). **Eso no choca con la tolerancia — la cumple con margen de sobra.** Pero conviene
saber que la norma de la región admite un colchón que nosotros no necesitamos usar: es un dato
para no sobre-diseñar el día que aparezca un caso borde.

### ⭐ 2.4. **El precio unitario NO es un monto** — y ahora son dos normas, no dos prácticas

Chile (`PrcItem`/`QtyItem`: 6 decimales, con importes enteros) y Ecuador (§ 8.17: **2 decimales
para valores, 6 para precio unitario y cantidad**) dicen literalmente lo mismo.

La investigación de agosto había llegado a esto por convergencia —Zuora y el combustible— y lo
marcó con ⚠️ *"ninguna fuente lo declara como principio nombrado"*. **Ahora dos autoridades
tributarias de la región lo escriben en su formato.** Eso sube de "práctica convergente" a
norma, y respalda directamente que `ESCALA_COSTO = 4` viva separado de los decimales de la
moneda — que es exactamente lo que el sistema ya hace.

### 2.5. La tasa de cambio con **6 decimales** también aparece en la región

Argentina fija `MonCotiz` en 4 enteros + **6 decimales**; Uruguay toma la del BCU *"con todos
los decimales"*, del propio comprobante. Nuestro `venta_detalles.tasa_cambio` es
`NUMERIC(18,6)` y se congela por línea: **coincide con los dos**.

---

## 3. Qué significa esto para las decisiones abiertas

⚠️ Esto es el **cruce**, no la norma: la investigación informa, decide el owner.

### 3.1. Sobre mover el nivel al país (decisión 2 del ADR-024)

**Lo que la investigación sostiene:** que la regla **es** del país — México obliga a una cosa y
Reino Unido a la contraria, y el TJUE lo declaró discreción nacional.

**Lo que la investigación NO sostiene:** que tengamos las reglas para sembrarla. De ocho países
mirados, **una sola fija el nivel** (México). Chile es inferencia; Argentina, Colombia, Perú,
Ecuador y Uruguay **no lo fijan**.

👉 **La lectura honesta:** la tabla por país tendría hoy **una fila con dato y el resto en
default**. Eso no invalida moverla —el mecanismo hay que tenerlo— pero sí dice que el valor
inmediato es chico, y que el dato que más falta sigue siendo **la regla de Chile**, que es donde
opera el producto.

### 3.2. Sobre el modo — y esto es lo nuevo

**Acá el hallazgo sí obliga a algo.** El modo **sí** está fijado por norma en dos países de la
región, los dos piden **half-even**, y nuestro default es **half-up**. Es la única de las dos
perillas donde tenemos datos suficientes para decir que **el default de hoy incumple** en
mercados a los que apuntamos.

Si algo se mueve al país primero, es **el modo**, no el nivel — al revés de lo que decidió el
ADR-024.

### 3.3. Sobre la UF

Nada de esta pasada la toca. Sigue valiendo el análisis de
[`2026-09-03-uf-y-nivel-por-pais-analisis.md`](./2026-09-03-uf-y-nivel-por-pais-analisis.md).

---

## 4. Huecos declarados — lo que NO se pudo confirmar

- **Chile**: no se halló la circular que fije el algoritmo. Sigue siendo **inferencia**, y es el
  dato más importante que falta.
- **Uruguay**: no se halló la regla de redondeo del CFE.
- **Brasil, Bolivia, Paraguay, Costa Rica y República Dominicana**: **no relevados**. Brasil es
  el hueco más grande por tamaño de mercado y por tener un modelo fiscal propio (NF-e).
- **Colombia**: las fuentes son secundarias y concordantes, pero **no se abrió el anexo técnico
  de la DIAN**. Antes de sembrar half-even para Colombia hay que verificarlo en el original.
- **Argentina**: la frase de half-even está en la sección de **margen de error** del manual, o
  sea que describe cómo **valida ARCA**. No se confirmó si además obliga al emisor a usar el
  mismo criterio al calcular.
- **Ningún país** de los relevados dice explícitamente *"redondeá por línea"* salvo por
  inferencia del formato. La pregunta *"¿por línea o al total?"* puede estar mal planteada para
  LatAm: la región parece regular **el resultado y su tolerancia**, no el procedimiento.

---

## Fuentes

- [Manual del desarrollador de facturación electrónica, RG 4291 (AFIP/ARCA, Argentina)](https://www.afip.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf) — PDF descargado y extraído acá
- [Guía de elaboración de documentos XML — Boleta Electrónica UBL 2.1 (SUNAT, Perú)](https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+boleta+version%202-1+1+0_0_0%20(2).pdf) — PDF descargado y extraído acá
- [Ficha técnica de comprobantes electrónicos, esquema offline v2.26 (SRI, Ecuador)](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/ed555352-46c7-4917-9f61-011b6a9f4600/FICHA%20TE%CC%81CNICA%20COMPROBANTES%20ELECTRO%CC%81NICOS%20ESQUEMA%20OFFLINE%20Versio%CC%81n%202.26.pdf) — PDF descargado y extraído acá
- [Anexo técnico de la factura electrónica de venta v1.9 (DIAN, Colombia)](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf) — **no abierto**, citado por las fuentes secundarias
- [DIAN, oficio sobre aproximación del IVA](https://crconsultorescolombia.com/dian-oficio-0100-aproximacion-del-iva.php) — secundaria
- [El redondeo del IVA (Gerencie.com, Colombia)](https://www.gerencie.com/el-iva-se-aproxima-o-se-redondea.html) — secundaria
- [Normativa de factura electrónica (SII, Chile)](https://www.sii.cl/factura_electronica/normativa.htm)
- [Actualización de esquemas de CFE (DGI, Uruguay)](https://gosocket.net/centro-de-recursos/la-dgi-de-uruguay-actualiza-esquemas-de-cfe-formato-de-reporte-diario-y-formato-de-mensaje-de-respuesta-alcance/) — secundaria
