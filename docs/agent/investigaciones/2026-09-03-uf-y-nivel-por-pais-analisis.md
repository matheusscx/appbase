# Análisis: la UF y el nivel de redondeo por país — qué se adapta a ESTE producto

> **Qué es esto.** No es investigación de mercado: es un análisis **contra nuestro código y
> nuestros datos**, pedido por el owner el 2026-09-03 después de reabrir dos decisiones del
> [ADR-024](../../adr/024-decimales-redondeo-y-unidades-de-cuenta.md). Todo lo que dice "medido"
> se corrió ese día contra el repo o la base de dev; lo que es inferencia está marcado.
>
> **Para qué sirve.** Que la sesión propia del tema arranque con los pros y contras ya puestos
> sobre la mesa, en vez de con cinco preguntas abiertas.

---

## 0. Lo que el owner dijo que no tenía claro

Textual, al pausarlo:

> *"el tema de la UF no lo tengo claro; el escenario es: ellos pueden llevar toda su operación
> en UF pero esas UF al final se convierten a pesos para poder pagar. **No tengo el alcance de
> lo que implica si solo cotiza o no.** Lo de los países, no sé si en todos la ley…"*

Las dos son preguntas de **alcance**, no de preferencia. Este documento las contesta con
números.

---

## 1. Los hechos del producto — medidos, no recordados

| Hecho | Medido en |
|---|---|
| **Hay UN solo país**: Chile. Moneda oficial CLP (0 decimales); habilitadas CLP, UF y USD | `pais` / `pais_moneda`, base de dev |
| **Un ítem ya se puede cotizar en UF hoy.** `validarMoneda` acepta cualquier moneda que esté en `pais_moneda` del país del tenant — no exige la oficial | `items.service.ts` → `validarMoneda` |
| **Cada línea de venta ya congela el origen**: `moneda_id_origen`, `precio_unitario_origen` y `tasa_cambio` (escala **6**) | `venta-detalle.entity.ts` + `ventas.service.ts` |
| **NO hay historial de tasas.** `tenant_moneda` es (tenant, moneda) con un `valor_del_dia` que se **pisa**: sin fechas de vigencia | `tenant-moneda.entity.ts` |
| **La "moneda oficial" gobierna mucho más que un total**: la escala a la que cuantiza el motor, lo que valida el pipe en el borde, y la moneda de pagos, caja y propinas | 10 usos en `ventas`, 6 en `monedas`, 5 en `tenants`, 5 en `calculo-precios`, 4 en `pagos` |
| **Lo fiscal no está construido** (ADR-010): no hay DTE, así que nada de esto choca todavía con lo que el SII exige de un documento | `docs/ESTADO.md` |

---

## 2. La UF

### 2.1. La distinción que resuelve la mayor parte, y ya estaba investigada

La literatura financiera lo tiene con nombre: **unidad de cuenta** (*unit of account*) vs
**medio de pago** (*means of settlement*). Una unidad indexada **denomina y cotiza** la
obligación; **nunca es el medio en que se liquida**. El pago se ejecuta siempre en moneda de
curso legal. La UF es CLF (990) en ISO 4217, junto con la UVR colombiana, la UI uruguaya y la
UDI mexicana.

👉 **El escenario del owner es literalmente eso**: operan en UF, y al final se convierte a pesos
para pagar. **La UF no compite con el peso: viven en capas distintas.**

### 2.2. Qué del escenario YA funciona hoy — y es más de lo que parecía

Esto es lo que el owner decía no tener dimensionado, y es el hallazgo principal:

1. **Se puede poner la lista de precios en UF hoy.** Un ítem se crea con `monedaId = UF` y el
   sistema lo acepta, porque la UF está habilitada para Chile.
2. **La venta guarda las UF, no solo los pesos.** Cada línea persiste `moneda_id_origen = UF`,
   `precio_unitario_origen = 2.5000` y `tasa_cambio = 38000.000000`. El docblock del campo dice
   que existe **justamente para poder auditar esa conversión**.
3. **Entonces un reporte histórico en UF es reconstruible del dato guardado**, no estimado: está
   la cantidad en UF y está la tasa con la que se cobró.

⛔ **Corrección a [ADR-024](../../adr/024-decimales-redondeo-y-unidades-de-cuenta.md) § 3.** Ahí
escribí como costo aceptado que *"un tenant que piensa en UF ve sus reportes históricos en
pesos, así que comparar dos meses le mezcla la inflación"*. **Eso es falso tal como está
escrito**, y lo escribí sin medir: el monto en UF está persistido por línea. Lo que no existe es
**la pantalla** que lo muestre — que es un problema de otro tamaño y de otro presupuesto.

### 2.3. Qué NO funciona hoy, que es lo que hay que decidir de verdad

| Hueco | Tamaño | ¿Depende de "UF oficial"? |
|---|---|---|
| **No hay reporte en UF.** El dato está; la pantalla no | Feature de reportes | ❌ No |
| **No hay historial de tasas.** `valor_del_dia` se pisa, sin vigencia. Nadie puede re-cotizar a una fecha pasada ni auditar la tasa fuera de las ventas que la congelaron | Cambio de esquema chico + quién la carga | ❌ No |
| **La tasa la carga alguien a mano.** No hay integración con el Banco Central, y la investigación no halló API oficial (solo terceros) | Frente propio | ❌ No |
| **Qué muestra el documento tributario** cuando se cotizó en UF | **Fiscal** | ❌ No — va solo (ADR-010) |
| **Los totales de la venta y la caja están en pesos** | Es el diseño | ✅ Sí |

👉 **Cuatro de los cinco huecos NO se resuelven haciendo a la UF moneda oficial.** Se resuelven
con un reporte y con historial de tasas. Eso reencuadra la pregunta: *"UF oficial sí o no"* no
es lo que le falta al escenario del owner.

### 2.4. Qué pasaría de verdad si la UF fuera moneda oficial

No es "los totales se guardan en UF". La moneda oficial gobierna, medido:

- **La escala a la que el motor cuantiza toda la plata.** UF tiene 4 decimales, así que todo
  monto cobrado pasaría a cuantizarse a 4 en vez de a 0.
- **Lo que el borde de la API acepta.** `@EsMontoCobrado` valida contra los decimales de la
  moneda oficial: hoy rechaza centavos, pasaría a aceptar cuatro decimales en todas partes.
- **La caja, los pagos y las propinas.** El arqueo, el vuelto y el reparto quedarían denominados
  en una unidad **en la que no existen billetes**.
- **El pago.** Nadie paga en UF. Toda entrada de plata necesitaría conversión, y habría que
  decidir a qué fecha se congela cada una — que es justo el hueco que la investigación dejó sin
  confirmar (*"qué valor de UF aplica: emisión, vencimiento o pago"*).

### 2.5. Las dos opciones, con pro y contra

#### A) La UF solo cotiza (lo que decía ADR-024) — **recomendada**

| Pro | Contra |
|---|---|
| Es lo que dice la literatura y lo que hace el mercado: la unidad indexada **nunca** liquida | El negocio que piensa en UF ve la caja y los totales en pesos |
| **Ya está construido**: la lista de precios en UF funciona y la venta congela las UF | Falta la pantalla del reporte en UF (pero no depende de esta decisión) |
| El peso sigue siendo lo que se cuantiza, se cobra y se cuadra — cero decimales, cero centavos que no existen | Si algún día el SII exige el DTE **en** UF, hay que revisar (pero permite UF con total en pesos) |
| No hay que decidir a qué fecha se congela cada pago | |

#### B) La UF puede ser moneda oficial

| Pro | Contra |
|---|---|
| Los reportes salen en UF sin construir nada nuevo | Toda la plata pasa a 4 decimales: caja, vuelto y propinas en una unidad sin billetes |
| El negocio "piensa" en la misma unidad en que el sistema guarda | Cada pago necesita conversión, con una fecha que **nadie fijó todavía** |
| | Resuelve **uno** de los cinco huecos y crea trabajo en cinco módulos |
| | Contradice la distinción unidad de cuenta / medio de pago, que es norma y no gusto |

### 2.6. Recomendación

**Mantener "la UF solo cotiza" — pero por una razón distinta de la que decía el ADR, y bajando
su costo declarado.** El costo real no es *"perdés el histórico en UF"* (falso: está guardado);
es *"no tenés todavía la pantalla que lo muestre"*.

Y lo que de verdad le falta al escenario del owner **no es esta decisión**, son dos cosas
independientes que se pueden construir sin tocar el motor:

1. **Historial de tasas con vigencia** — la investigación ya dice que la UF *"se conoce por
   adelantado"* (ciclo día 10 → día 9), o sea que es **una tasa con vigencia conocida**, no un
   valor del día. El modelo actual (un número que se pisa) representa peor la realidad que la
   realidad misma.
2. **Reporte en UF**, que es leer lo que ya está persistido.

📌 **Y hay un precedente del propio SII que apoya no sobre-diseñar**: la Resolución 44/2025 fija
el umbral de 135 UF **en pesos una sola vez al año**, no lo recalcula venta a venta.

---

## 3. El nivel de redondeo por país

### 3.1. El hecho que cambia la pregunta

**Hay un solo país en el sistema.** La decisión *"lo fija el país"* se tomó sobre una tabla de
**una fila**, y sobre exactamente **dos ejemplos** de la investigación —Reino Unido obliga por
línea, México obliga al total—, ninguno de los cuales es Chile.

Y para Chile, lo que la investigación encontró es que **el dato no está**: la fila de Chile de
la tabla comparativa fue **corregida el 2026-08-20** — que los totales vayan enteros en CLP es
**[INFERENCIA]** desde el silencio del formato, no una frase literal del SII. La regla que
justifica mover la perilla al país, para nuestro país, **no la tenemos escrita**.

### 3.2. Las tres opciones

| Opción | Pro | Contra |
|---|---|---|
| **Lo fija el país, el tenant no lo toca** (ADR-024) | Es una regla tributaria, no un gusto; el molde existe (la moneda oficial ya sale del país) | Se decide sobre **un** país cuya regla **no está confirmada**, y con dos ejemplos ajenos. Deja sin salida al caso raro |
| **Del tenant, con el default puesto por su país** | Arranca bien sin configurar; deja escape | El tenant puede elegir algo que su país no permite, y el error se ve en un documento emitido |
| **Como está hoy: del tenant, default `linea`** | Costo cero; nada que romper | Un tenant mexicano no puede cumplir su regla sin que alguien la configure a mano, y nada se lo avisa |

### 3.3. Recomendación

**No mover la perilla todavía. Anotar la regla por país cuando exista el segundo país.**

El razonamiento es el mismo YAGNI que el owner ya aplicó a la columna de decimales
(*"estamos muy lejos de tener casos como el afgani"*), y acá es más fuerte: **la regla del único
país que tenemos no está confirmada**, así que mover el dato a la tabla de países significaría
sembrar ahí una inferencia, no una norma. Un dato inventado en la tabla que dice "acá vive la
ley" es peor que no tener el dato.

⚠️ **Lo que sí conviene hacer ahora, y es barato:** dejar escrito en la config del tenant que
**esa perilla es candidata a mudarse al país**, y que quien agregue el segundo país tiene que
traer su regla **citada**, no inferida. Cuesta un comentario; evita que el próximo la mude
"porque el ADR lo dice" sobre la misma inferencia.

📌 **Esto NO reabre la decisión 1** (un criterio, con el número puesto por la moneda), que sigue
firme y ya está construida.

---

## 4. Lo que sigo sin poder contestar sin investigar

Marcado para que nadie lo lea como resuelto:

- **La regla de redondeo de Chile**, citada de una norma y no inferida del formato del DTE. Es
  el dato que destraba la decisión 2.
- **Qué valor de UF aplica a un documento** (emisión / vencimiento / pago). La investigación no
  halló la circular; la fuente es secundaria. Solo importa cuando se construya lo fiscal.
- **De dónde sale la tasa de la UF.** No se halló API oficial del Banco Central; hay terceros
  (CMF, mindicador.cl). Es un frente propio, y es el que destraba el historial de tasas.
- **Si el owner quiere el reporte en UF** — que es, según este análisis, lo que su escenario
  realmente pide. Eso es una pregunta de producto y no la contesto yo.
