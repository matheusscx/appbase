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

> ⛔ **CORRECCIÓN DE PREMISA (owner, 2026-09-03).** La primera versión de este documento razonó
> con *"hay un solo país, entonces YAGNI"*. **Está mal de raíz:** el producto es multi-tenant
> **para América Latina**, así que multi-país es el **objetivo de diseño**, no una hipótesis
> lejana. Que hoy haya una fila en `pais` es el estado, no el alcance. La § 3 se reescribió
> entera con la premisa correcta y **la recomendación se dio vuelta**.

| Hecho | Medido en |
|---|---|
| **Hoy hay un país cargado**: Chile. Moneda oficial CLP (0 decimales); habilitadas CLP, UF y USD. ⚠️ El objetivo es **LatAm**: esto es el estado, no el alcance | `pais` / `pais_moneda`, base de dev |
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

## 3. El nivel de redondeo por país — **reescrita con la premisa correcta**

> La primera versión decía *"hay un país, no lo muevas todavía"*. Con **LatAm como objetivo**,
> ese argumento no se sostiene: la recomendación **se da vuelta**.

### 3.1. La región es el caso, no la excepción

De los cinco países que la investigación relevó, **dos son LatAm y los dos tienen la regla
citada** — y no coinciden entre sí ni con Chile:

| País | Qué fija su norma | Qué perilla nuestra es |
|---|---|---|
| **México** (SAT, Anexo 20) | sumar a hasta 6 decimales y redondear **una sola vez al total** | `nivelRedondeo = documento` |
| **Colombia** (DIAN, NTC 3711) | **half-to-even**, con tolerancias de ±$5 en IVA | `modo_redondeo` |
| **Chile** (SII) | totales enteros en CLP — ⛔ **[INFERENCIA]**, corregida el 2026-08-20 | `nivelRedondeo` (sin confirmar) |

Con LatAm como objetivo, **esto deja de ser hipotético**: el segundo tenant de la región puede
entrar con una regla distinta de la del primero, y hoy la perilla es una **preferencia del
tenant** que nadie le va a saber configurar.

### 3.2. ⭐ El hallazgo nuevo: el país gobierna DOS perillas, no una

El ADR-024 movió al país solo el **nivel**. Pero la única regla LatAm citada sobre el **modo**
—Colombia, half-to-even— también es del país, y hoy `modo_redondeo` es **preferencia del
tenant con default `HALF_UP`**. O sea: **un tenant colombiano que no toque nada queda fuera de
su norma**, y nada se lo dice.

⚠️ **Y la investigación se contradice a sí misma justo ahí.** Su § 1 afirma que *"las normas
que sí fijan un modo exigen **half-up**"* (Reglamento CE 1103/97, IRS) y lo usa para respaldar
que `modo_redondeo` sea configurable. Su propia § 6 dice que **Colombia exige half-to-even**.
La generalización es falsa, y la falsifica un país de nuestra región. **No es un detalle
académico:** es el argumento con el que se decidió dejar el modo en manos del tenant.

### 3.3. Las tres opciones, con la premisa corregida

| Opción | Pro | Contra |
|---|---|---|
| **Lo fija el país** (ADR-024, extendido al modo) | Es donde vive la norma. Con LatAm como objetivo el caso es real, no futuro. El molde existe: la moneda oficial ya sale del país. Cierra el agujero de Colombia, que hoy nadie ve | Hay que sembrar la regla de cada país, y **la de Chile no la tenemos citada**. Deja sin salida al caso raro que la norma no contemple |
| **Del tenant, con el default puesto por su país** | Arranca cumpliendo sin configurar, y deja escape | El tenant puede moverlo a algo que su país no permite, y el error se ve en un documento ya emitido |
| **Como está hoy: del tenant, defaults `linea` + `HALF_UP`** | Costo cero | Un tenant mexicano y uno colombiano incumplen **por default**, y nada se los avisa |

### 3.4. ⭐ Lo que la investigación de países confirmó y dio vuelta (2026-09-03, mismo día)

Se relevaron ocho países →
[`2026-09-03-redondeo-por-pais-latam.md`](./2026-09-03-redondeo-por-pais-latam.md). Tres cosas
cambian lo de arriba:

1. **El modo está peor que el nivel.** Argentina lo fija **literal** en el manual de ARCA
   (*"Round Half Even"*) y Colombia por NTC 3711: **los dos únicos países de LatAm donde se
   halló un modo fijado piden half-even, y nuestro default es half-up**. Si algo se mueve al
   país primero, es **el modo**, no el nivel.
2. **El nivel casi nadie lo fija.** De ocho países, **uno solo** fija el nivel (México, al
   total). El resto no lo fija o valida con **tolerancia**. La tabla por país arrancaría con una
   fila con dato y el resto en default.
3. **Ningún país de la región obliga por línea.** El único que lo hace es Reino Unido, fuera
   del mercado.

### 3.5. Recomendación

✅ **SUPERADA por la propuesta del owner (2026-09-03), que es mejor** — ver el bloque en
[ADR-024](../../adr/024-decimales-redondeo-y-unidades-de-cuenta.md): **la config sigue siendo
del tenant, con default por país, y candado solo donde es ley**. Cubre las ocho reglas
relevadas y resuelve el problema que tenía mi versión —"lo fija el país" a secas—: **no inventa
una ley donde no la hay**, que era justo el riesgo con Chile, que es inferencia.

Lo que sobrevive de mi recomendación es el orden: **empezar por el modo**, que es donde hay
datos suficientes para afirmar que el default de hoy incumple (Argentina y Colombia exigen
half-even; nuestro default es half-up).

<details><summary>Mi recomendación anterior, para que no se pierda el razonamiento</summary>

**Mover las dos perillas al país** —`nivelRedondeo` y `modo_redondeo`— y que el tenant no las
contradiga, **pero empezando por el modo**. El agujero que tenía: obliga a sembrar una regla por
país aunque no exista, y con Chile eso significaba sembrar una inferencia en la tabla que dice
*"acá vive la ley"*.

</details> Con LatAm de objetivo, dejarlas en el tenant significa que **el default incumple**
en al menos dos de los países a los que apuntamos, y el incumplimiento se ve en un documento ya
emitido.

⚠️ **Pero con una regla de carga que no se puede saltear: cada país entra con su norma
CITADA.** Hoy tenemos dos de LatAm citadas (México, Colombia) y **la de Chile es una
inferencia**. Sembrar una inferencia en la tabla que dice *"acá vive la ley"* es peor que no
tener el dato: el próximo la lee como norma. Entonces:

1. **México y Colombia se siembran con su regla y su cita.**
2. **Chile entra marcado como inferencia** —o no entra y usa el default— hasta que alguien traiga
   la norma. Ese es el dato que más falta, porque es donde opera el producto hoy.
3. **El default de un país sin regla cargada** tiene que ser explícito y conservador, no un
   silencio que parezca decisión.

📌 **Lo que cambia respecto de la primera versión de este análisis:** antes dije "no lo muevas
hasta que exista el segundo país". Con LatAm como objetivo eso es esperar a que el problema
llegue con un cliente adentro. Lo que sí sostengo es la otra mitad: **no inventar la regla de
Chile** para poder mover la perilla.

---

## 4. Lo que sigo sin poder contestar sin investigar

Marcado para que nadie lo lea como resuelto:

- **La regla de redondeo de Chile**, citada de una norma y no inferida del formato del DTE. Es
  el dato que destraba la decisión 2, y el que más falta: es donde el producto opera hoy.
- **El resto de LatAm.** Tenemos México y Colombia citados; faltan Argentina, Perú, Uruguay,
  Ecuador, Bolivia, Paraguay… Con la región como objetivo, **relevar la regla de redondeo por
  país es un frente propio**, y conviene saberlo antes de prometer el multi-país.
- **Si la contradicción de la investigación cambia algo más.** Afirma que *"las normas que fijan
  un modo exigen half-up"* y su propia tabla dice que Colombia exige half-to-even. Hay que ver
  qué otras conclusiones colgaban de esa generalización.
- **Qué valor de UF aplica a un documento** (emisión / vencimiento / pago). La investigación no
  halló la circular; la fuente es secundaria. Solo importa cuando se construya lo fiscal.
- **De dónde sale la tasa de la UF.** No se halló API oficial del Banco Central; hay terceros
  (CMF, mindicador.cl). Es un frente propio, y es el que destraba el historial de tasas.
- **Si el owner quiere el reporte en UF** — que es, según este análisis, lo que su escenario
  realmente pide. Eso es una pregunta de producto y no la contesto yo.
